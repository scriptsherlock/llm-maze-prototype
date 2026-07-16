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
loadServerState();
logState("start_trial");
resizeRenderer();
renderFrame();
setInterval(updateUi, 500);
setInterval(syncTrialState, 750);

function createMaterials() {
  return {
    street: new THREE.MeshPhysicalMaterial({ color: 0x061a3a, roughness: 0.12, metalness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 }),
    streetAlt: new THREE.MeshPhysicalMaterial({ color: 0x0a2450, roughness: 0.1, metalness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03 }),
    wall: new THREE.MeshPhysicalMaterial({ color: 0xa8bdc9, roughness: 0.2, metalness: 0.56, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    wallCap: new THREE.MeshPhysicalMaterial({ color: 0xd4e6ef, roughness: 0.14, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.06 }),
    destination: new THREE.MeshStandardMaterial({ color: 0xd97706, emissive: 0x92400e, emissiveIntensity: 0.45, roughness: 0.38 }),
    hintLine: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    goalGlow: new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.5 }),
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

function buildGoal() {
  const pos = worldFromCell(goal.x, goal.y);
  const destination = new THREE.Mesh(reusable.destination, materials.destination);
  destination.position.set(pos.x, 0.12, pos.z);
  destination.receiveShadow = true;
  scene.add(destination);

  const glow = new THREE.Mesh(reusable.glow, materials.goalGlow);
  glow.position.set(pos.x, 0.8, pos.z);
  scene.add(glow);

  const light = new THREE.PointLight(0xfacc15, 2.4, 13);
  light.position.set(pos.x, 1.2, pos.z);
  scene.add(light);
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

function attemptMove(dx, dy, action) {
  if (currentView !== "participant") return;
  participantHasInteracted = true;

  const nx = player.x + dx;
  const ny = player.y + dy;

  if (!isOpen(nx, ny)) {
    blockedFlashUntil = Date.now() + 260;
    logState("blocked_move", { attempted_move: action, attempted_x: nx, attempted_y: ny });
    updateUi();
    return;
  }

  player = { x: nx, y: ny };
  moves += 1;
  advanceStoredPathAfterMove();
  logState("move", { attempted_move: action, attempted_x: nx, attempted_y: ny, plan_status: planStatus });

  if (player.x === goal.x && player.y === goal.y) {
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

function advanceStoredPathAfterMove() {
  if (!activeFullPath.length) {
    planStatus = "none";
    return;
  }

  const nextStoredStep = activeFullPath[1];
  if (sameCell(nextStoredStep, player)) {
    activeFullPath = activeFullPath.slice(1);
    planStatus = activeFullPath.length > 1 ? "following" : "complete";
  } else {
    planStatus = "deviated";
  }
}

function clearVisibleHint() {
  hintVisibleUntil = 0;
  hintMessageUntil = 0;
  activeHintPath = [];
  visibleAiPath = [];
  refreshHintMarkers();
}

async function showHint() {
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

  hintRequestInFlight = true;
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
    visibleAiPath = data.full_path;
    activeHintPath = data.hint_steps;
    planStatus = "fresh";
    hintBannerText = activeHintPath[0] ? getHintMessageForCue(activeHintPath[0]) : "You are at the goal";
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

  elements.moderatorGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  elements.moderatorGrid.style.gap = cols > 60 ? "1px" : cols > 30 ? "2px" : "3px";
  elements.moderatorGrid.innerHTML = "";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = document.createElement("div");
      const key = `${x},${y}`;
      cell.className = "validator-cell live-cell";
      if (maze[y][x] === 1) cell.classList.add("wall");
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
    elapsed_ms: Date.now() - startTime,
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
  const elapsed = formatTime(Date.now() - startTime);
  const bearing = getGoalBearing();
  const now = Date.now();
  const hintActive = aiOn && now <= hintVisibleUntil;
  const hintMessageActive = aiOn && now <= hintMessageUntil;

  hintGroup.visible = hintActive;
  elements.facingHud.textContent = DIRS[facing].name;
  elements.goalHud.textContent = bearing.label;
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
  elements.hintBanner.textContent = hintBannerText;
  elements.hintBanner.classList.toggle("visible", hintActive || hintMessageActive || Date.now() <= blockedFlashUntil);
  if (Date.now() <= blockedFlashUntil) elements.hintBanner.textContent = "Blocked";
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
