import * as THREE from "/vendor/three/three.module.js";
import { DIRS, MAZE_CONFIG } from "./maze.js";

const maze = MAZE_CONFIG.maze;
const rows = maze.length;
const cols = maze[0].length;
const start = MAZE_CONFIG.start;
const entrance = MAZE_CONFIG.entrance;
const goal = MAZE_CONFIG.goal;
const aiCueLength = MAZE_CONFIG.hintSteps;
const hintDurationMs = 3200;
const cellSize = 4;
const wallHeight = 3.2;
const wallThickness = 0.28;

let currentView = getInitialView();
let player = { ...start };
let facing = MAZE_CONFIG.startFacing ?? 1;
let moves = 0;
let aiOn = true;
let hintRequestInFlight = false;
let latestLatencyMs = null;
let startTime = Date.now();
let finishedAt = null; // timestamp the goal was reached; freezes the timer
let hintVisibleUntil = 0;
let hintMessageUntil = 0;
let hintBannerText = "AI hint trail visible";
let activeHintPath = [];
let activeFullPath = [];
let visibleAiPath = [];
let planStatus = "none";
let blockedFlashUntil = 0;
let lastEventId = 0;
let lastServerLogFetch = 0;
let lastRemoteStateFetch = 0;
let lastAiStateFetch = 0;
let lastPublishedStateJson = "";
let lastAppliedRemoteUpdate = 0;
let currentResetToken = 0;
let lastAppliedResetToken = 0;
let participantHasInteracted = false;
let isApplyingRemoteState = false;
let serverLogRows = [];
const trialStateStorageKey = "llm_maze_trial_state";
const trialBroadcast = typeof BroadcastChannel === "function"
  ? new BroadcastChannel("llm_maze_trial")
  : null;
const eventLog = [];

function getInitialView() {
  return globalThis.location && globalThis.location.pathname.includes("moderator")
    ? "moderator"
    : "participant";
}

// Experiment condition from the URL: `?ai=off` is the no-AI (control) group, which
// removes the Ask AI button entirely. Default is AI on. Orthogonal to the maze path.
function getAiCondition() {
  const search = globalThis.location ? globalThis.location.search : "";
  const value = (new URLSearchParams(search).get("ai") || "").toLowerCase();
  return !["off", "0", "false", "no"].includes(value);
}

const aiCondition = getAiCondition();

const elements = {
  scene: document.getElementById("scene"),
  participantExperience: document.getElementById("participantExperience"),
  moderatorExperience: document.getElementById("moderatorExperience"),
  participantViewButton: document.getElementById("participantViewButton"),
  moderatorViewButton: document.getElementById("moderatorViewButton"),
  moderatorPanel: document.getElementById("moderatorPanel"),
  moves: document.getElementById("moves"),
  time: document.getElementById("time"),
  facingHud: document.getElementById("facingHud"),
  goalHud: document.getElementById("goalHud"),
  goalBearingText: document.getElementById("goalBearingText"),
  goalDistanceText: document.getElementById("goalDistanceText"),
  hintButton: document.getElementById("hintButton"),
  hintBanner: document.getElementById("hintBanner"),
  aiToggle: document.getElementById("aiToggle"),
  moderatorAiDot: document.getElementById("moderatorAiDot"),
  moderatorAiStatus: document.getElementById("moderatorAiStatus"),
  positionText: document.getElementById("positionText"),
  moderatorFacing: document.getElementById("moderatorFacing"),
  moderatorMoves: document.getElementById("moderatorMoves"),
  moderatorTime: document.getElementById("moderatorTime"),
  storedPathText: document.getElementById("storedPathText"),
  latencyText: document.getElementById("latencyText"),
  logBox: document.getElementById("logBox"),
  serverLogBox: document.getElementById("serverLogBox"),
  moderatorGrid: document.getElementById("moderatorGrid"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xadc7dd);
scene.fog = new THREE.Fog(0xadc7dd, 20, 54);

const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 120);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
elements.scene.appendChild(renderer.domElement);

const hintGroup = new THREE.Group();
const avatarGroup = new THREE.Group();
scene.add(hintGroup, avatarGroup);

const materials = createMaterials();
const reusable = createReusableGeometry();

buildCityScene();
buildAvatar();
bindControls();
setView(currentView);
// No-AI (control) group: mark the controls row so CSS removes the Ask AI button
// and evenly reflows the remaining four buttons (no empty slot).
if (!aiCondition) {
  const controls = document.querySelector(".experiment-controls");
  if (controls) controls.classList.add("no-ai");
}
loadServerState();
logState("start_trial");
resizeRenderer();
renderFrame();
setInterval(updateUi, 500);
setInterval(syncTrialState, 750);
// Keep the hosted serverless function warm so the first Ask AI of a session
// isn't hit by a cold start. Harmless when running locally.
if (aiCondition) {
  setInterval(() => {
    fetch("/api/state").catch(() => {});
  }, 240000);
}

function createMaterials() {
  return {
    street: new THREE.MeshPhysicalMaterial({ color: 0x061a3a, roughness: 0.12, metalness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 }),
    streetAlt: new THREE.MeshPhysicalMaterial({ color: 0x0a2450, roughness: 0.1, metalness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03 }),
    wall: new THREE.MeshPhysicalMaterial({ color: 0xa8bdc9, roughness: 0.2, metalness: 0.56, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    wallCap: new THREE.MeshPhysicalMaterial({ color: 0xd4e6ef, roughness: 0.14, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.06 }),
    destination: new THREE.MeshStandardMaterial({ color: 0xd97706, emissive: 0x92400e, emissiveIntensity: 0.45, roughness: 0.38 }),
    hintLine: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    hintArrow: new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide }),
    goalGlow: new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.5 }),
    doorFrame: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.35 }),
    avatar: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 }),
    avatarSkin: new THREE.MeshStandardMaterial({ color: 0xf2c29b, roughness: 0.55 }),
  };
}

function createReusableGeometry() {
  return {
    street: new THREE.BoxGeometry(cellSize, 0.08, cellSize),
    wallNorthSouth: new THREE.BoxGeometry(cellSize + wallThickness, wallHeight, wallThickness),
    wallEastWest: new THREE.BoxGeometry(wallThickness, wallHeight, cellSize + wallThickness),
    wallCap: new THREE.BoxGeometry(cellSize + wallThickness, 0.08, wallThickness),
    wallCapSide: new THREE.BoxGeometry(wallThickness, 0.08, cellSize + wallThickness),
    destination: new THREE.CylinderGeometry(1.05, 1.05, 0.12, 32),
    hintLineSegment: new THREE.BoxGeometry(1, 0.045, 1),
    // Flat floor arrowhead (triangle in the XZ plane, tip toward +Z), so it only
    // needs a Y-rotation to aim along the final step direction.
    hintArrow: (() => {
      const tip = 0.95, back = -0.35, halfW = 0.7, y = 0;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0, y, tip,        // tip (forward)
        halfW, y, back,   // back-right
        -halfW, y, back,  // back-left
      ]), 3));
      geo.setIndex([0, 1, 2]);
      geo.computeVertexNormals();
      return geo;
    })(),
    glow: new THREE.SphereGeometry(0.88, 24, 12),
  };
}

function buildCityScene() {
  const ambient = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 2.1);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-18, 28, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(cols * cellSize + 18, rows * cellSize + 18),
    new THREE.MeshStandardMaterial({ color: 0x08111f, roughness: 0.72 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  buildStreetCells();
  buildMazeWallPanels();
  buildGoal();
}

function buildStreetCells() {
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isOpen(x, y)) continue;
      const pos = worldFromCell(x, y);
      const street = new THREE.Mesh(reusable.street, (x + y) % 2 ? materials.streetAlt : materials.street);
      street.position.set(pos.x, 0, pos.z);
      street.receiveShadow = true;
      scene.add(street);
    }
  }
}

function buildMazeWallPanels() {
  const panels = [
    { dx: 0, dy: -1, side: "north", geometry: reusable.wallNorthSouth, cap: reusable.wallCap, offsetX: 0, offsetZ: -cellSize / 2 },
    { dx: 1, dy: 0, side: "east", geometry: reusable.wallEastWest, cap: reusable.wallCapSide, offsetX: cellSize / 2, offsetZ: 0 },
    { dx: 0, dy: 1, side: "south", geometry: reusable.wallNorthSouth, cap: reusable.wallCap, offsetX: 0, offsetZ: cellSize / 2 },
    { dx: -1, dy: 0, side: "west", geometry: reusable.wallEastWest, cap: reusable.wallCapSide, offsetX: -cellSize / 2, offsetZ: 0 },
  ];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isOpen(x, y)) continue;

      const pos = worldFromCell(x, y);
      for (const panel of panels) {
        if (shouldSkipWallPanel(x, y, panel)) continue;
        if (isOpen(x + panel.dx, y + panel.dy)) continue;

        const wall = new THREE.Mesh(panel.geometry, materials.wall);
        wall.position.set(pos.x + panel.offsetX, wallHeight / 2, pos.z + panel.offsetZ);
        wall.castShadow = true;
        wall.receiveShadow = true;

        const cap = new THREE.Mesh(panel.cap, materials.wallCap);
        cap.position.set(pos.x + panel.offsetX, wallHeight + 0.05, pos.z + panel.offsetZ);
        cap.castShadow = true;
        cap.receiveShadow = true;

        scene.add(wall, cap);
      }
    }
  }
}

function shouldSkipWallPanel(x, y, panel) {
  const isEntrance = entrance && x === entrance.x && y === entrance.y;
  const isGoal = x === goal.x && y === goal.y;
  return (isEntrance || isGoal) && panel.side === outwardBoundarySide(x, y);
}

function outwardBoundarySide(x, y) {
  if (y === 0) return "north";
  if (x === cols - 1) return "east";
  if (y === rows - 1) return "south";
  if (x === 0) return "west";
  return null;
}

function makeExitSignTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b91c1c"; // red board
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 16;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 130px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EXIT", canvas.width / 2, canvas.height / 2 + 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

// Render the goal as a framed doorway with a red/white EXIT board, mounted on the
// outward (opening) side and facing the approaching player.
function buildGoal() {
  const pos = worldFromCell(goal.x, goal.y);
  const side = outwardBoundarySide(goal.x, goal.y) || "south";
  const rotationForSide = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };

  const door = new THREE.Group();
  door.position.set(pos.x, 0, pos.z);
  door.rotation.y = rotationForSide[side]; // built facing +z (outward), then rotated

  const postW = 0.4;
  const postDepth = 0.6;
  const doorH = wallHeight + 0.2;
  const edge = cellSize / 2; // outward edge of the goal cell in local space

  const postGeo = new THREE.BoxGeometry(postW, doorH, postDepth);
  for (const sign of [1, -1]) {
    const post = new THREE.Mesh(postGeo, materials.doorFrame);
    post.position.set(sign * (cellSize / 2), doorH / 2, edge);
    post.castShadow = true;
    post.receiveShadow = true;
    door.add(post);
  }

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(cellSize + postW, 0.7, postDepth), materials.doorFrame);
  lintel.position.set(0, doorH - 0.35, edge);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  door.add(lintel);

  // EXIT board, mounted just under the header, facing inward toward the player.
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(cellSize * 0.72, 0.86),
    new THREE.MeshBasicMaterial({ map: makeExitSignTexture(), side: THREE.DoubleSide })
  );
  board.position.set(0, doorH - 0.9, edge - 0.34);
  board.rotation.y = Math.PI; // normal points -z (inward)
  door.add(board);

  scene.add(door);
}

function buildAvatar() {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.85, 6, 12), materials.avatar);
  body.position.y = 0.88;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10), materials.avatarSkin);
  head.position.y = 1.58;
  avatarGroup.add(body, head);
  avatarGroup.visible = false;
}

function bindControls() {
  if (elements.participantViewButton) {
    elements.participantViewButton.addEventListener("click", () => setView("participant"));
  }
  if (elements.moderatorViewButton) {
    elements.moderatorViewButton.addEventListener("click", () => setView("moderator"));
  }
  document.getElementById("turnLeftButton").addEventListener("click", turnLeft);
  document.getElementById("turnRightButton").addEventListener("click", turnRight);
  document.getElementById("forwardButton").addEventListener("click", moveForward);
  document.getElementById("backButton").addEventListener("click", moveBackward);
  elements.hintButton.addEventListener("click", showHint);
  elements.aiToggle.addEventListener("click", toggleAI);
  document.getElementById("downloadCsvButton").addEventListener("click", downloadCsv);
  document.getElementById("downloadJsonButton").addEventListener("click", downloadJson);
  document.getElementById("resetButton").addEventListener("click", resetTrial);

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "h"].includes(key)) {
      event.preventDefault();
    }
    if (key === "arrowup" || key === "w") moveForward();
    if (key === "arrowdown" || key === "s") moveBackward();
    if (key === "arrowleft" || key === "a") turnLeft();
    if (key === "arrowright" || key === "d") turnRight();
    if (key === "h") showHint();
  });

  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("storage", (event) => {
    if (event.key !== trialStateStorageKey || !event.newValue) return;
    try {
      applyRemoteTrialState(JSON.parse(event.newValue));
    } catch (_error) {
      // Ignore malformed cross-tab state.
    }
  });

  if (trialBroadcast) {
    trialBroadcast.addEventListener("message", (event) => {
      applyRemoteTrialState(event.data);
    });
  }
}

async function loadServerState() {
  try {
    const response = await fetch("/api/state");
    const data = await response.json();
    aiOn = Boolean(data.ai_enabled);
    logState("server_state_loaded", { ai_enabled: aiOn, provider: data.provider, model: data.model });
  } catch (_error) {
    logState("server_state_unavailable");
  }
}

function setView(view) {
  currentView = view;
  elements.participantExperience.classList.toggle("hidden", view !== "participant");
  elements.moderatorExperience.classList.toggle("hidden", view !== "moderator");
  if (elements.participantViewButton) {
    elements.participantViewButton.classList.toggle("active", view === "participant");
  }
  if (elements.moderatorViewButton) {
    elements.moderatorViewButton.classList.toggle("active", view === "moderator");
  }

  updateUi();
  resizeRenderer();
}

function isInside(x, y) {
  return y >= 0 && y < rows && x >= 0 && x < cols;
}

function isOpen(x, y) {
  return isInside(x, y) && maze[y][x] === 0;
}

function worldFromCell(x, y) {
  return {
    x: (x - cols / 2 + 0.5) * cellSize,
    z: (y - rows / 2 + 0.5) * cellSize,
  };
}

function normalizeAngle(angle) {
  let out = angle;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

function getGoalBearing() {
  const centerX = player.x + 0.5;
  const centerY = player.y + 0.5;
  const targetX = goal.x + 0.5;
  const targetY = goal.y + 0.5;
  const targetAngle = Math.atan2(targetY - centerY, targetX - centerX);
  const relative = normalizeAngle(targetAngle - DIRS[facing].angle);
  const deg = relative * 180 / Math.PI;
  const absDeg = Math.abs(deg);

  if (absDeg < 22.5) return { label: "Ahead", mark: "A" };
  if (absDeg < 67.5) return { label: deg > 0 ? "Ahead-right" : "Ahead-left", mark: deg > 0 ? "AR" : "AL" };
  if (absDeg < 112.5) return { label: deg > 0 ? "Right" : "Left", mark: deg > 0 ? "R" : "L" };
  if (absDeg < 157.5) return { label: deg > 0 ? "Behind-right" : "Behind-left", mark: deg > 0 ? "BR" : "BL" };
  return { label: "Behind", mark: "B" };
}

function getGoalDistance() {
  return Math.abs(goal.x - player.x) + Math.abs(goal.y - player.y);
}

function sameCell(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function getHintMessageForCue(cue) {
  const cueAngle = Math.atan2(cue.y - player.y, cue.x - player.x);
  const relative = normalizeAngle(cueAngle - DIRS[facing].angle);
  const deg = relative * 180 / Math.PI;
  const absDeg = Math.abs(deg);

  if (absDeg <= 35) return "AI hint trail visible";
  if (absDeg >= 145) return "Turn around to see the AI hint";
  return deg > 0 ? "Turn right to see the AI hint" : "Turn left to see the AI hint";
}

// Short hedged turn-by-turn justification of the visible hint (the next few legal
// steps). Deterministic and recomputed live, so it updates as the player turns.
// The reason is derived from goal distance, never fabricated.
function describeHintPlan() {
  const cells = visibleAiPath;
  if (cells.length < 2) return "";

  let heading = { dx: DIRS[facing].dx, dy: DIRS[facing].dy };
  const moves = [];
  for (let i = 0; i < cells.length - 1 && moves.length < aiCueLength; i += 1) {
    const dx = cells[i + 1].x - cells[i].x;
    const dy = cells[i + 1].y - cells[i].y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) break;
    moves.push(relativeTurn(heading, dx, dy));
    heading = { dx, dy };
  }
  if (!moves.length) return "";

  const start = cells[0];
  const end = cells[moves.length];
  const distTo = (c) => Math.hypot(goal.x - c.x, goal.y - c.y);
  const reason = distTo(end) < distTo(start)
    ? "it heads toward the exit"
    : "it goes around the wall ahead";
  return `${joinHintMoves(moves)} — looks promising, ${reason}.`;
}

function relativeTurn(heading, dx, dy) {
  const dot = heading.dx * dx + heading.dy * dy;
  if (dot === 1) return "straight";
  if (dot === -1) return "back";
  const cross = heading.dx * dy - heading.dy * dx;
  return cross > 0 ? "right" : "left";
}

function joinHintMoves(moves) {
  // Group consecutive identical moves (mainly runs of "straight") for readability.
  const groups = [];
  for (const move of moves) {
    const last = groups[groups.length - 1];
    if (last && last.move === move) last.count += 1;
    else groups.push({ move, count: 1 });
  }
  const firstWord = { straight: "Go straight", right: "Turn right", left: "Turn left", back: "Turn around" };
  const contWord = { straight: "go straight", right: "turn right", left: "turn left", back: "turn around" };
  const label = (group, isFirst) => {
    const base = (isFirst ? firstWord : contWord)[group.move];
    return group.move === "straight" && group.count > 1 ? `${base} for ${group.count}` : base;
  };
  let sentence = label(groups[0], true);
  for (let i = 1; i < groups.length; i += 1) sentence += `, then ${label(groups[i], false)}`;
  return sentence;
}

function attemptMove(dx, dy, action) {
  if (currentView !== "participant") return;
  participantHasInteracted = true;

  const nx = player.x + dx;
  const ny = player.y + dy;

  if (!isOpen(nx, ny)) {
    blockedFlashUntil = Date.now() + 900;
    logState("blocked_move", { attempted_move: action, attempted_x: nx, attempted_y: ny });
    updateUi();
    return;
  }

  player = { x: nx, y: ny };
  moves += 1;
  advanceStoredPathAfterMove();
  logState("move", { attempted_move: action, attempted_x: nx, attempted_y: ny, plan_status: planStatus });

  if (player.x === goal.x && player.y === goal.y) {
    if (finishedAt == null) finishedAt = Date.now();
    logState("goal_reached");
    hintBannerText = "Goal reached";
    hintMessageUntil = Date.now() + 2500;
  }

  updateUi();
}

function moveForward() {
  const dir = DIRS[facing];
  attemptMove(dir.dx, dir.dy, "forward");
}

function moveBackward() {
  const dir = DIRS[facing];
  attemptMove(-dir.dx, -dir.dy, "backward");
}

function turnLeft() {
  if (currentView !== "participant") return;
  participantHasInteracted = true;
  facing = (facing + 3) % 4;
  logState("turn_left");
  updateUi();
}

function turnRight() {
  if (currentView !== "participant") return;
  participantHasInteracted = true;
  facing = (facing + 1) % 4;
  logState("turn_right");
  updateUi();
}

// Build the visible hint from an AI path: the next few steps only (cap), trimmed
// at the first illegal step so the trail never draws onto or across a wall. The
// AI's full answer is still stored/logged; this only governs what is rendered.
function clampHint(path) {
  const legal = [];
  for (let i = 0; i < path.length && legal.length < aiCueLength + 1; i += 1) {
    const cell = path[i];
    if (!isOpen(cell.x, cell.y)) break; // don't render onto a wall / out of bounds
    if (i > 0) {
      const step = Math.abs(path[i - 1].x - cell.x) + Math.abs(path[i - 1].y - cell.y);
      if (step !== 1) break; // don't render a jump across a wall
    }
    legal.push(cell);
  }
  return legal;
}

function advanceStoredPathAfterMove() {
  // The full AI route survives beyond the visible hint window: advance it while
  // the participant stays on it so later hints can be served instantly from it,
  // and drop it the moment they step off (a fresh AI call is needed then).
  if (activeFullPath.length > 1 && sameCell(activeFullPath[1], player)) {
    activeFullPath = activeFullPath.slice(1);
  } else if (activeFullPath.length && !sameCell(activeFullPath[0], player)) {
    activeFullPath = [];
  }

  // Visible hint: stays fully drawn (all shown steps) while the participant walks
  // through it — it does NOT shrink per step — so it also remains visible when they
  // turn around. It clears only when they reach its final cell (all steps taken) or
  // step off the window entirely.
  if (visibleAiPath.length < 2) {
    if (!activeFullPath.length) planStatus = "none";
    return;
  }

  const atLastCell = sameCell(visibleAiPath[visibleAiPath.length - 1], player);
  const onWindow = visibleAiPath.some((cell) => sameCell(cell, player));

  if (atLastCell) {
    // Only a completed hint (reached its final cell) clears the trail.
    planStatus = "complete";
    clearVisibleHint();
  } else if (onWindow) {
    planStatus = "following";
  } else {
    // Stepped off the hint (e.g. an accidental Back): keep the trail fully drawn
    // so the participant can rejoin it. It is NOT cleared on deviation. (The stored
    // full route was already dropped above, so a re-press does a fresh AI call.)
    planStatus = "deviated";
  }
}

function clearVisibleHint() {
  fadeOutCurrentHint();
  hintVisibleUntil = 0;
  hintMessageUntil = 0;
  activeHintPath = [];
  visibleAiPath = [];
  refreshHintMarkers();
}

// Fade the current hint trail out (~600ms) instead of letting it vanish abruptly.
// The segments are moved to a temporary group with a cloned material so a new
// hint can be drawn while the old one is still fading.
let activeHintFade = null;

function fadeOutCurrentHint() {
  if (!hintGroup.children.length) return;
  cancelHintFade();

  const fadeGroup = new THREE.Group();
  const fadeMaterial = materials.hintLine.clone();
  fadeMaterial.transparent = true;
  fadeMaterial.side = THREE.DoubleSide;
  while (hintGroup.children.length) {
    const segment = hintGroup.children[0];
    segment.material = fadeMaterial;
    fadeGroup.add(segment);
  }
  scene.add(fadeGroup);

  const startedAt = performance.now();
  const durationMs = 600;
  const fade = { group: fadeGroup, material: fadeMaterial };
  activeHintFade = fade;

  (function step() {
    if (activeHintFade !== fade) return;
    const t = Math.min(1, (performance.now() - startedAt) / durationMs);
    fadeMaterial.opacity = 1 - t;
    renderer.render(scene, camera);
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    cancelHintFade();
  })();
}

function cancelHintFade() {
  if (!activeHintFade) return;
  scene.remove(activeHintFade.group);
  activeHintFade.material.dispose();
  activeHintFade = null;
  renderer.render(scene, camera);
}

// Pulsing ring at the participant's feet while the AI request is in flight, so
// the wait reads as "thinking" instead of a frozen scene.
let thinkingIndicator = null;

function startThinkingIndicator() {
  if (thinkingIndicator) return;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.05, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.75 })
  );
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  thinkingIndicator = ring;

  (function pulse() {
    if (!thinkingIndicator) return;
    if (!hintRequestInFlight) {
      stopThinkingIndicator();
      return;
    }
    const t = (performance.now() % 1200) / 1200;
    // Place the ring on the floor just ahead of the player — at their feet it
    // would sit under the first-person camera, outside the view.
    const pos = worldFromCell(player.x, player.y);
    const dir = DIRS[facing];
    thinkingIndicator.position.set(pos.x + dir.dx * 2.4, 0.14, pos.z + dir.dy * 2.4);
    const scale = 1 + t * 0.9;
    thinkingIndicator.scale.set(scale, scale, scale);
    thinkingIndicator.material.opacity = 0.75 * (1 - t);
    renderer.render(scene, camera);
    requestAnimationFrame(pulse);
  })();
}

function stopThinkingIndicator() {
  if (!thinkingIndicator) return;
  scene.remove(thinkingIndicator);
  thinkingIndicator.geometry.dispose();
  thinkingIndicator.material.dispose();
  thinkingIndicator = null;
  renderer.render(scene, camera);
}

async function showHint() {
  if (!aiCondition) return; // no-AI (control) group: hints are disabled
  if (currentView !== "participant") return;
  if (hintRequestInFlight) return;
  participantHasInteracted = true;

  if (!aiOn) {
    logState("hint_requested_ai_off");
    hintBannerText = "AI assistance is disabled";
    hintMessageUntil = Date.now() + hintDurationMs;
    updateUi();
    return;
  }

  // Serve instantly from the stored AI route when the participant is still on it.
  // It is the same AI-computed answer (a shortest path's remainder is still the
  // shortest path), so no new LLM call — and no "AI thinking" wait — is needed.
  if (activeFullPath.length > 1 && sameCell(activeFullPath[0], player)) {
    visibleAiPath = clampHint(activeFullPath);
    activeHintPath = visibleAiPath.slice(1);
    planStatus = "fresh";
    hintBannerText = activeHintPath[0]
      ? getHintMessageForCue(activeHintPath[0])
      : sameCell(player, goal)
        ? "You are at the goal"
        : "AI hint unavailable — try again";
    hintMessageUntil = Date.now() + hintDurationMs;
    hintVisibleUntil = visibleAiPath.length > 1 ? Number.POSITIVE_INFINITY : 0;
    refreshHintMarkers();
    logState("hint_served_from_stored_path", { remaining_cells: activeFullPath.length });
    updateUi();
    return;
  }

  hintRequestInFlight = true;
  startThinkingIndicator();
  elements.hintButton.disabled = true;
  elements.hintButton.textContent = "AI thinking...";
  const clientEventId = `hint-${Date.now()}-${++lastEventId}`;
  const requestedAt = Date.now();
  logState("hint_requested", { client_event_id: clientEventId });
  updateUi();

  try {
    const response = await fetch("/api/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maze,
        player,
        facing: DIRS[facing].name,
        goal,
        max_hint_steps: aiCueLength,
        move_count: moves,
        client_event_id: clientEventId,
      }),
    });

    const data = await response.json();
    latestLatencyMs = data.latency_ms ?? Date.now() - requestedAt;

    if (!response.ok || data.status !== "path_found") {
      throw new Error(data.message || "AI did not return a valid path.");
    }

    activeFullPath = data.full_path;
    // Reveal only the next few legal steps as the hint (not the whole route,
    // and never through a wall).
    visibleAiPath = clampHint(data.full_path);
    activeHintPath = data.hint_steps;
    planStatus = "fresh";
    hintBannerText = activeHintPath[0]
      ? getHintMessageForCue(activeHintPath[0])
      : sameCell(player, goal)
        ? "You are at the goal"
        : "AI hint unavailable — try again";
    hintMessageUntil = Date.now() + hintDurationMs;
    hintVisibleUntil = visibleAiPath.length > 1 ? Number.POSITIVE_INFINITY : 0;
    refreshHintMarkers();
    logState("llm_response_received", {
      client_event_id: clientEventId,
      full_path_length: activeFullPath.length,
      hint_steps_count: activeHintPath.length,
      llm_latency_ms: latestLatencyMs,
      retry_count: data.retry_count,
      validation_status: data.validation_status,
      validation_error: data.validation_error ?? null,
      required_shortest_path_cells: data.required_shortest_path_cells ?? null,
      reason: data.reason,
    });
  } catch (error) {
    activeHintPath = [];
    refreshHintMarkers();
    hintVisibleUntil = visibleAiPath.length > 1 ? Number.POSITIVE_INFINITY : 0;
    hintMessageUntil = Date.now() + hintDurationMs;
    hintBannerText = "AI could not provide a valid path";
    logState("llm_response_invalid", {
      client_event_id: clientEventId,
      message: error.message,
      llm_latency_ms: latestLatencyMs,
    });
  } finally {
    hintRequestInFlight = false;
    stopThinkingIndicator();
    updateUi();
  }
}

async function toggleAI() {
  const next = !aiOn;
  try {
    const response = await fetch("/api/moderator/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const data = await response.json();
    aiOn = Boolean(data.ai_enabled);
  } catch (_error) {
    aiOn = next;
  }

  if (!aiOn) {
    clearVisibleHint();
  }

  logState(aiOn ? "moderator_enabled_ai" : "moderator_disabled_ai");
  updateUi();
}

function resetTrial() {
  participantHasInteracted = true;
  currentResetToken = Date.now();
  lastAppliedResetToken = currentResetToken;
  resetLocalTrial();
  logState("reset_trial", { reset_token: currentResetToken });
  publishTrialState({ reset_token: currentResetToken }, true);
  updateUi();
}

function resetLocalTrial() {
  player = { ...start };
  facing = MAZE_CONFIG.startFacing ?? 1;
  moves = 0;
  startTime = Date.now();
  finishedAt = null;
  clearVisibleHint();
  activeFullPath = [];
  visibleAiPath = [];
  planStatus = "none";
  latestLatencyMs = null;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function logState(action, extra = {}) {
  eventLog.push({
    timestamp_iso: new Date().toISOString(),
    elapsed_ms: Date.now() - startTime,
    action,
    current_view: currentView,
    x: player.x,
    y: player.y,
    facing: DIRS[facing].name,
    moves,
    ai_enabled: aiOn,
    maze_seed: MAZE_CONFIG.seed,
    maze_size: `${cols}x${rows}`,
    plan_status: planStatus,
    stored_path_length: activeFullPath.length,
    ...extra,
  });
  updateLogBox();
  if (currentView === "participant" && participantHasInteracted) publishTrialState();
}

function updateLogBox() {
  const latestRows = eventLog.slice(-9);
  const firstNumber = eventLog.length - latestRows.length + 1;
  elements.logBox.textContent = latestRows.map((row, index) => {
    return `${firstNumber + index}. ${row.action} | pos=(${row.x},${row.y}) | AI=${row.ai_enabled ? "on" : "off"} | path=${row.stored_path_length}`;
  }).join("\n");
  elements.logBox.scrollTop = elements.logBox.scrollHeight;
}

function renderModeratorGrid() {
  if (!elements.moderatorGrid) return;

  const localPath = shortestPath(player, goal);
  const localSet = pathSet(localPath);
  const aiSet = pathSet(visibleAiPath);

  // Render as a line maze: this is a (2N+1) thin-wall grid, so odd tracks are the
  // real maze cells (wide) and even tracks are wall tracks drawn as thin lines.
  // Wall thickness comes from the --maze-wall-track CSS var. Works for any odd
  // grid size (8x8 -> 17 tracks, 7x7 -> 15 tracks).
  const trackSize = (i) => (i % 2 === 0 ? "var(--maze-wall-track)" : "1fr");
  elements.moderatorGrid.style.gridTemplateColumns = Array.from({ length: cols }, (_, i) => trackSize(i)).join(" ");
  elements.moderatorGrid.style.gridTemplateRows = Array.from({ length: rows }, (_, i) => trackSize(i)).join(" ");
  elements.moderatorGrid.style.gap = "0";
  elements.moderatorGrid.classList.add("line-maze");
  elements.moderatorGrid.innerHTML = "";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = document.createElement("div");
      const key = `${x},${y}`;
      cell.className = "validator-cell live-cell";
      // Draw walls as lines, but hide isolated (even,even) pillar posts that have
      // no wall attached — they'd otherwise show as floating dots in open space.
      const noWall = (px, py) => !isInside(px, py) || maze[py][px] === 0;
      const isIsolatedPillar = x % 2 === 0 && y % 2 === 0 &&
        noWall(x - 1, y) && noWall(x + 1, y) && noWall(x, y - 1) && noWall(x, y + 1);
      if (maze[y][x] === 1 && !isIsolatedPillar) cell.classList.add("wall");
      if (localSet.has(key)) cell.classList.add("local-path");
      if (aiSet.has(key)) cell.classList.add("ai-path");
      if (x === goal.x && y === goal.y) cell.classList.add("goal");
      if (x === player.x && y === player.y) {
        cell.classList.add("player");
        cell.dataset.facing = DIRS[facing].short;
      }
      cell.title = `(${x}, ${y})`;
      elements.moderatorGrid.appendChild(cell);
    }
  }
}

function shortestPath(from, to) {
  const queue = [{ x: from.x, y: from.y, path: [{ x: from.x, y: from.y }] }];
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  seen[from.y][from.x] = true;
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  while (queue.length) {
    const current = queue.shift();
    if (sameCell(current, to)) return current.path;

    for (const direction of directions) {
      const next = { x: current.x + direction.dx, y: current.y + direction.dy };
      if (!isOpen(next.x, next.y) || seen[next.y][next.x]) continue;
      seen[next.y][next.x] = true;
      queue.push({ ...next, path: [...current.path, next] });
    }
  }

  return [];
}

function pathSet(path) {
  return new Set((path || []).map((cell) => `${cell.x},${cell.y}`));
}

async function refreshServerLogsIfNeeded() {
  if (!elements.serverLogBox) return;
  const now = Date.now();
  if (now - lastServerLogFetch < 3000) return;
  lastServerLogFetch = now;

  try {
    const response = await fetch("/api/server-logs");
    const data = await response.json();
    serverLogRows = Array.isArray(data.logs) ? data.logs : [];
  } catch (error) {
    serverLogRows = [{
      timestamp_iso: new Date().toISOString(),
      action: "server_log_fetch_failed",
      message: error.message,
    }];
  }

  updateServerLogBox();
}

function updateServerLogBox() {
  if (!elements.serverLogBox) return;
  if (!serverLogRows.length) {
    elements.serverLogBox.textContent = "No server-side log entries yet.";
    return;
  }

  elements.serverLogBox.textContent = serverLogRows.slice(-12).map((row, index) => {
    const timestamp = row.timestamp_iso ? row.timestamp_iso.slice(11, 19) : "--:--:--";
    const message = row.validation_error || row.message || row.action || "server event";
    return `${index + 1}. ${timestamp} ${row.action || "log"} | ${message}`;
  }).join("\n");
  elements.serverLogBox.scrollTop = elements.serverLogBox.scrollHeight;
}

async function syncTrialState() {
  await refreshAiAvailabilityIfNeeded();

  if (currentView === "participant") {
    await fetchRemoteTrialStateIfNeeded();
    if (participantHasInteracted) publishTrialState();
    return;
  }

  if (currentView === "moderator") {
    await fetchRemoteTrialStateIfNeeded();
  }
}

async function refreshAiAvailabilityIfNeeded() {
  const now = Date.now();
  if (now - lastAiStateFetch < 1200) return;
  lastAiStateFetch = now;

  try {
    const response = await fetch("/api/state");
    const data = await response.json();
    const wasAiOn = aiOn;
    aiOn = Boolean(data.ai_enabled);
    if (wasAiOn && !aiOn) clearVisibleHint();
  } catch (_error) {
    // Keep the current local value if the state check fails.
  }
}

function serializeTrialState() {
  return {
    updated_at: Date.now(),
    maze_seed: MAZE_CONFIG.seed,
    maze_size: `${cols}x${rows}`,
    player: { ...player },
    facing,
    facing_name: DIRS[facing].name,
    moves,
    ai_enabled: aiOn,
    start_time: startTime,
    elapsed_ms: (finishedAt ?? Date.now()) - startTime,
    finished: finishedAt != null,
    active_hint_path: activeHintPath,
    active_full_path: activeFullPath,
    visible_ai_path: visibleAiPath,
    plan_status: planStatus,
    latest_latency_ms: latestLatencyMs,
    hint_visible: visibleAiPath.length > 1 && hintVisibleUntil > 0,
    reset_token: currentResetToken,
    event_log: eventLog.slice(-60),
  };
}

function publishTrialState(extra = {}, force = false) {
  if (isApplyingRemoteState) return;
  const state = {
    ...serializeTrialState(),
    ...extra,
  };
  const stateJson = JSON.stringify(state);
  if (!force && stateJson === lastPublishedStateJson) return;
  lastPublishedStateJson = stateJson;

  try {
    localStorage.setItem(trialStateStorageKey, stateJson);
  } catch (_error) {
    // Local storage is a convenience channel only.
  }

  if (trialBroadcast) trialBroadcast.postMessage(state);

  fetch("/api/trial-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  }).catch(() => {
    // Cross-tab local sync still works if the local server write is unavailable.
  });
}

async function fetchRemoteTrialStateIfNeeded() {
  const now = Date.now();
  if (now - lastRemoteStateFetch < 600) return;
  lastRemoteStateFetch = now;

  try {
    const response = await fetch("/api/trial-state");
    const data = await response.json();
    if (data && data.state) applyRemoteTrialState(data.state);
  } catch (_error) {
    // Storage and BroadcastChannel may still provide same-browser updates.
  }
}

function applyRemoteTrialState(state) {
  if (!state || typeof state !== "object") return;
  if (state.maze_seed !== MAZE_CONFIG.seed) return;

  if (currentView === "participant") {
    applyRemoteResetIfNeeded(state);
    return;
  }

  if (currentView !== "moderator") return;
  if (!state.updated_at || state.updated_at <= lastAppliedRemoteUpdate) return;

  isApplyingRemoteState = true;
  lastAppliedRemoteUpdate = state.updated_at;
  player = isCellLike(state.player) ? { x: state.player.x, y: state.player.y } : player;
  facing = Number.isInteger(state.facing) && DIRS[state.facing] ? state.facing : facing;
  moves = Number.isInteger(state.moves) ? state.moves : moves;
  aiOn = Boolean(state.ai_enabled);
  startTime = Number.isFinite(state.elapsed_ms) ? Date.now() - state.elapsed_ms : startTime;
  finishedAt = state.finished ? Date.now() : null;
  activeHintPath = Array.isArray(state.active_hint_path) ? state.active_hint_path.map(normalizeCell) : [];
  activeFullPath = Array.isArray(state.active_full_path) ? state.active_full_path.map(normalizeCell) : [];
  visibleAiPath = Array.isArray(state.visible_ai_path)
    ? state.visible_ai_path.map(normalizeCell)
    : activeFullPath.map((cell) => ({ ...cell }));
  planStatus = typeof state.plan_status === "string" ? state.plan_status : planStatus;
  latestLatencyMs = state.latest_latency_ms == null ? null : Number(state.latest_latency_ms);
  hintVisibleUntil = state.hint_visible ? Number.POSITIVE_INFINITY : 0;
  if (Array.isArray(state.event_log)) {
    eventLog.splice(0, eventLog.length, ...state.event_log);
  }
  refreshHintMarkers();
  updateUi();
  isApplyingRemoteState = false;
}

function applyRemoteResetIfNeeded(state) {
  if (!state.reset_token || state.reset_token <= lastAppliedResetToken) return;

  isApplyingRemoteState = true;
  lastAppliedResetToken = state.reset_token;
  currentResetToken = state.reset_token;
  resetLocalTrial();
  logState("remote_reset_trial", { reset_token: state.reset_token });
  refreshHintMarkers();
  updateUi();
  isApplyingRemoteState = false;
}

function isCellLike(cell) {
  return cell &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    isOpen(cell.x, cell.y);
}

function normalizeCell(cell) {
  return { x: Number(cell.x), y: Number(cell.y) };
}

function downloadCsv() {
  if (!eventLog.length) return;
  const headers = Array.from(new Set(eventLog.flatMap((row) => Object.keys(row))));
  const rows = eventLog.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  downloadBlob("llm_maze_trial_log.csv", [headers.join(","), ...rows].join("\n"), "text/csv");
}

function downloadJson() {
  downloadBlob("llm_maze_trial_log.json", JSON.stringify(eventLog, null, 2), "application/json");
}

function downloadBlob(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function refreshHintMarkers() {
  if (visibleAiPath.length > 1) cancelHintFade(); // a new trail replaces any fading one
  hintGroup.clear();
  const lineWidth = 0.24;
  for (let index = 0; index < visibleAiPath.length - 1; index += 1) {
    const current = visibleAiPath[index];
    const next = visibleAiPath[index + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;

    const from = worldFromCell(current.x, current.y);
    const to = worldFromCell(next.x, next.y);
    const horizontal = dy === 0;
    const segment = new THREE.Mesh(reusable.hintLineSegment, materials.hintLine);
    segment.position.set((from.x + to.x) / 2, 0.105, (from.z + to.z) / 2);
    segment.scale.set(
      horizontal ? cellSize + lineWidth : lineWidth,
      1,
      horizontal ? lineWidth : cellSize + lineWidth
    );
    hintGroup.add(segment);
  }

  // Arrowhead at the end of the trail, aimed along the final step direction.
  if (visibleAiPath.length >= 2) {
    const prev = visibleAiPath[visibleAiPath.length - 2];
    const last = visibleAiPath[visibleAiPath.length - 1];
    const dx = last.x - prev.x;
    const dz = last.y - prev.y; // grid y maps to world z
    if (Math.abs(dx) + Math.abs(dz) === 1) {
      const end = worldFromCell(last.x, last.y);
      const arrow = new THREE.Mesh(reusable.hintArrow, materials.hintArrow);
      arrow.position.set(end.x, 0.12, end.z);
      arrow.rotation.y = Math.atan2(dx, dz);
      hintGroup.add(arrow);
    }
  }
}

function updateCamera() {
  const pos = worldFromCell(player.x, player.y);
  const dir = DIRS[facing];
  camera.position.set(pos.x, 1.72, pos.z);
  camera.lookAt(pos.x + dir.dx * 3.4, 1.55, pos.z + dir.dy * 3.4);

  avatarGroup.position.set(pos.x, 0, pos.z);
  avatarGroup.rotation.y = -DIRS[facing].angle + Math.PI / 2;
}

function updateUi() {
  updateCamera();
  const elapsed = formatTime((finishedAt ?? Date.now()) - startTime);
  const bearing = getGoalBearing();
  const now = Date.now();
  const hintActive = aiOn && now <= hintVisibleUntil;
  const hintMessageActive = aiOn && now <= hintMessageUntil;

  hintGroup.visible = hintActive;
  elements.facingHud.textContent = DIRS[facing].name;
  elements.goalHud.textContent = "Find the exit";
  elements.goalBearingText.textContent = bearing.label;
  elements.goalDistanceText.textContent = `${getGoalDistance()} cells`;
  elements.moves.textContent = moves;
  elements.time.textContent = elapsed;
  elements.moderatorMoves.textContent = moves;
  elements.moderatorTime.textContent = elapsed;
  elements.positionText.textContent = `(${player.x}, ${player.y})`;
  elements.moderatorFacing.textContent = DIRS[facing].name;
  elements.storedPathText.textContent = activeFullPath.length ? `${activeFullPath.length} cells (${planStatus})` : "none";
  elements.latencyText.textContent = latestLatencyMs == null ? "n/a" : `${latestLatencyMs} ms`;

  elements.hintButton.disabled = !aiOn || hintRequestInFlight;
  elements.hintButton.textContent = hintRequestInFlight
    ? "AI thinking..."
    : aiOn ? "Ask AI" : "AI unavailable";

  elements.aiToggle.textContent = aiOn ? "Disable AI for participant" : "Enable AI for participant";
  elements.aiToggle.className = aiOn ? "ai-action" : "";
  elements.moderatorAiDot.className = aiOn ? "dot on" : "dot";
  elements.moderatorAiStatus.textContent = aiOn ? "AI assistance ON" : "AI assistance OFF";
  const hintPlan = hintActive ? describeHintPlan() : "";
  const blockedFlashActive = Date.now() <= blockedFlashUntil;
  elements.hintBanner.textContent = hintPlan || hintBannerText;
  let bannerVisible = hintActive || hintMessageActive || blockedFlashActive;
  if (!aiCondition && currentView === "participant") {
    // Control group: keep a neutral, non-directional status line in the banner
    // area so both conditions have comparable UI presence.
    if (!hintMessageActive && !blockedFlashActive) {
      elements.hintBanner.textContent = "Explore the streets and find the EXIT";
    }
    bannerVisible = true;
  }
  elements.hintBanner.classList.toggle("visible", bannerVisible);
  if (blockedFlashActive) elements.hintBanner.textContent = "A wall is ahead — try another direction";
  updateLogBox();
  if (currentView === "moderator") {
    renderModeratorGrid();
    refreshServerLogsIfNeeded();
  }
  renderer.render(scene, camera);
}

function resizeRenderer() {
  const rect = elements.scene.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height || width * 0.604));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderFrame();
}

function renderFrame() {
  updateUi();
}
