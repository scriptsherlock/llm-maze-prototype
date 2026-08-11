import * as THREE from "/vendor/three/three.module.js";
import { GLTFLoader } from "/vendor/three/addons/loaders/GLTFLoader.js";
import { DIRS, MAZE_CONFIG, MAZE_KEY, HINTS_URL, SOLUTIONS_URL, CONDITION, MAZE_AI_REMOVED, MID_MAZE_CUTOFF, IS_STUDY, STUDY_INDEX, STUDY_TOTAL, advanceStudyMaze, IS_TRAINING, completeTraining, surveyUrlFor, SURVEY_AFTER_INDEX, PARTICIPANT_ID } from "./maze.js";

const maze = MAZE_CONFIG.maze;
if (typeof window !== "undefined") window.__mazeRows = maze.map((r) => r.join("")).join("");
const rows = maze.length;
const cols = maze[0].length;
const start = MAZE_CONFIG.start;
const entrance = MAZE_CONFIG.entrance;
const goal = MAZE_CONFIG.goal;
// "AI disappears" condition: once the player reaches this central choke cell, the
// AI stops giving hints for the rest of the trial (one-way latch). null on mazes
// without a choke. See aiActive / latchAiOff below.
const chokeCell = MAZE_CONFIG.chokeCell || null;
// The AI stops halfway through the "disappear" condition. A choke cell only works on
// a maze with no loops, where every route must cross it; on a braided maze a walker
// can go round it. Distance-to-exit cannot be dodged — it only reaches 0 at the exit
// — so the fallback trigger is "distance has halved", which always fires.
const AI_CUTOFF_FRACTION = 0.5;
let startGoalDistance = null;
let aiActive = true;
const aiCueLength = MAZE_CONFIG.hintSteps;
const hintDurationMs = 3200;
const cellSize = 4;
const wallHeight = 3.2;
const wallThickness = 0.28;
// RAISED_CAMERA = true: an elevated over-the-shoulder drone view above the hedges
// (like the reference photo), showing the participant avatar and the layout ahead.
// false: eye-level first-person.
const RAISED_CAMERA = true;
const CAMERA_HEIGHT = RAISED_CAMERA ? 5.3 : 1.72;      // above the hedges (~3.3 tall)
const CAMERA_BACK = RAISED_CAMERA ? 4 : 0;             // pull back behind the player
const CAMERA_LOOK_AHEAD = RAISED_CAMERA ? 4 : 3.4;     // aim ahead of the player
const CAMERA_LOOK_HEIGHT = RAISED_CAMERA ? 0.4 : 1.55; // aim low → steep downward tilt

let currentView = getInitialView();
// Rollback flag: set to false to restore the turn-by-turn (facing-relative) hint text.
const STATIC_HINT_TEXT = false;
let player = { ...start };
let facing = MAZE_CONFIG.startFacing ?? 1;
let moves = 0;
const TRAINING_STEPS = [
  { action: "turnLeft",  button: "turnLeftButton",  key: "A", text: "Look to your left." },
  { action: "turnRight", button: "turnRightButton", key: "D", text: "Now look back to your right." },
  { action: "forward",   button: "forwardButton",   key: "W", text: "Walk one step ahead." },
  { action: "back",      button: "backButton",      key: "S", text: "Step backwards, without turning around." },
  { action: "forward",   button: "forwardButton",   key: "W", text: "Walk forward once more, then you are ready to begin." },
];
let trainingAt = 0;

// ---- Per-junction measures ---------------------------------------------------
// Raw dwell and decision time are recorded, with no attempt to subtract time spent
// reading a cue. The comparison that matters is disappear vs no_ai over the last
// four mazes, and neither has an assistant there, so there is no reading-time
// difference to correct for.
let junctionVisit = null;          // { key, arrivedAt, recommended, options }
let visitedCells = new Set();      // for backtracking: cells already stood on
let backtrackMoves = 0;            // moves onto a cell already visited
let reverseMoves = 0;              // presses of Back
const junctionDecisions = [];

let aiOn = true;
let hintRequestInFlight = false;
let latestLatencyMs = null;
let startTime = Date.now();
// Time spent reading the controls card is not time spent on the task: the card shows
// which button does what, so dwelling on it means the controls were unclear, not the
// maze. It is held out of the clock. Both the raw wall time and the paused total stay
// in the log, so a completion time including help time can still be recovered.
let helpPausedMs = 0;
let helpOpenedAt = null;

function elapsedMs() {
  const upTo = helpOpenedAt ?? Date.now();
  return upTo - startTime - helpPausedMs;
}
let finishedAt = null; // timestamp the goal was reached; freezes the timer
let hintVisibleUntil = 0;
let hintMessageUntil = 0;
let hintBannerText = "AI hint trail visible";
let activeHintPath = [];
let activeFullPath = [];
let visibleAiPath = [];
let planStatus = "none";
let remotePrefetchHint = []; // moderator view: the participant's prefetched next hint
let remotePrefetchStatus = "none";
let blockedFlashUntil = 0;
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
// Advancing a maze reloads the page, which used to wipe eventLog: only the maze in
// front of you survived and mazes 1-7 were gone by the end. The run is therefore
// mirrored into localStorage under the participant id and appended to, so one record
// covers the whole session and can be exported at any point.
const RUN_LOG_KEY = `llm_maze_run_${PARTICIPANT_ID}`;

function readRunLog() {
  try { return JSON.parse(localStorage.getItem(RUN_LOG_KEY) || "[]"); } catch (_e) { return []; }
}

function appendToRunLog(row) {
  try {
    const all = readRunLog();
    all.push(row);
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(all));
  } catch (_e) { /* storage full or blocked: the in-page log still holds this maze */ }
  queueForServer(row);
}

// localStorage lives on the participant's machine and leaves with the browser, so it
// is a cache, not the record. Rows are batched to the server as the run proceeds;
// anything that fails to send stays queued and goes with the next batch, and the
// browser copy remains as the fallback if the server never becomes reachable.
let serverQueue = [];
let serverFlushTimer = null;
let serverStorageWorks = null;

function queueForServer(row) {
  serverQueue.push(row);
  if (serverFlushTimer) return;
  serverFlushTimer = setTimeout(flushToServer, 1500);
}

async function flushToServer() {
  serverFlushTimer = null;
  if (!serverQueue.length) return;
  const batch = serverQueue;
  serverQueue = [];
  try {
    const response = await fetch("/api/run-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: PARTICIPANT_ID, rows: batch }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (serverStorageWorks !== true) {
      serverStorageWorks = true;
      logState("run_log_server_ok", { participant_id: PARTICIPANT_ID });
    }
  } catch (_error) {
    serverQueue = batch.concat(serverQueue);       // keep them for the next attempt
    if (serverStorageWorks !== false) {
      serverStorageWorks = false;
      // Not logged through logState: that would queue another row and loop.
      eventLog.push({ timestamp_iso: new Date().toISOString(), action: "run_log_server_unreachable",
        participant_id: PARTICIPANT_ID, queued: serverQueue.length });
    }
  }
}

// A closing tab should not take the last few rows with it.
globalThis.addEventListener("pagehide", () => {
  if (!serverQueue.length || !navigator.sendBeacon) return;
  navigator.sendBeacon("/api/run-log", new Blob(
    [JSON.stringify({ participant_id: PARTICIPANT_ID, rows: serverQueue })],
    { type: "application/json" },
  ));
  serverQueue = [];
});

function getInitialView() {
  return globalThis.location && globalThis.location.pathname.includes("moderator")
    ? "moderator"
    : "participant";
}

// Experiment condition from the URL: `?ai=off` is the no-AI (control) group, which
// removes the Ask AI button entirely. Default is AI on. Orthogonal to the maze path.
function getAiCondition() {
  // Conditions are study design, not user options: no_ai stays AI-free even if the
  // ?ai= parameter is edited away.
  if (CONDITION === "no_ai") return false;
  if (MAZE_AI_REMOVED) return false;   // disappear condition, second half of the run
  if (MAZE_KEY === "no_ai") return false;
  const search = globalThis.location ? globalThis.location.search : "";
  const value = (new URLSearchParams(search).get("ai") || "").toLowerCase();
  return !["off", "0", "false", "no"].includes(value);
}

const aiCondition = getAiCondition();
// v3 herding mode: one AI call at the start, then a rolling 3-step cue (arrow +
// text) that always points at the NEXT steps and advances block by block to the
// goal — no Ask AI button. Set false to restore the manual on-demand hint.
const AUTO_HERD = false;
// v5 route-evaluation mechanic: at every junction the AI compares the branches
// ("Left: ~15 steps · Right: likely a dead end") instead of drawing a path/arrow.
// LLM-only (it can be wrong), automatic at junctions, text only. Set false to
// restore the path-hint arrow mechanic.
const ROUTE_EVAL_MODE = true;
let routeEvalText = "";
let routeEvalInFlight = false;
let lastPlayerCell = null;
// Verified whole-maze routes the AI found (moderator view only).
let aiSolutions = [];
const SOLUTION_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2"];

async function loadAiSolutions() {
  if (!SOLUTIONS_URL || currentView !== "moderator") return;
  try {
    const response = await fetch(SOLUTIONS_URL);
    if (!response.ok) return;                       // not generated for this maze yet
    const data = await response.json();
    aiSolutions = Array.isArray(data.routes) ? data.routes : [];
    renderAiRoutesLegend(data.shortest_possible);
    renderModeratorGrid();
  } catch (_error) { /* no solutions to show */ }
}

function renderAiRoutesLegend(shortest) {
  const box = document.getElementById("aiRoutesLegend");
  if (!box) return;
  if (!aiSolutions.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>AI routes (${aiSolutions.length})</strong>` + aiSolutions.map((r, i) => {
    const over = shortest ? ` (+${r.steps - shortest})` : "";
    return `<span class="ai-route-item"><span class="ai-route-dot" style="background:${SOLUTION_COLORS[i % SOLUTION_COLORS.length]}"></span>${r.steps} steps${over}</span>`;
  }).join("") + (shortest ? `<span class="ai-route-item muted">true shortest ${shortest}</span>` : "");
}

const junctionEvals = new Map(); // "x,y" -> [{x,y,verdict,steps,reason}] (precomputed)
let precomputing = false;
// CUE_SOURCE selects who produces the junction cues:
//   "file" – load cues precomputed offline by scripts/build-cues.mjs from
//            public/mazes8/hints/maze-N.json (no runtime AI call — the AI
//            was run once at build time; instant, deploy-safe). DEPLOYMENT DEFAULT.
//   "ai"   – the LLM solves the maze and returns the cues live at trial start
//            (its own verdicts/steps/reasons, fallible; used to (re)generate).
//   "bfs"  – computed locally from the known maze with exact BFS ground truth.
// Default is set here; override per-session with ?cues=file / ?cues=ai / ?cues=bfs.
const CUE_SOURCE_DEFAULT = "file";
const CUE_SOURCE = (() => {
  const search = globalThis.location ? globalThis.location.search : "";
  const value = (new URLSearchParams(search).get("cues") || "").toLowerCase();
  return ["file", "ai", "bfs"].includes(value) ? value : CUE_SOURCE_DEFAULT;
})();
// AI_PRECOMPUTE_ONLY (ai mode): use ONLY the cues precomputed once at trial start.
// Never make a live per-junction call — so there is no wait at a junction, and no
// "AI couldn't assess" when the participant has moved. A junction missing from the
// precompute simply shows no cue. Set false to allow the live per-junction fallback.
const AI_PRECOMPUTE_ONLY = true;
// Rollback: set false to disable background prefetch of the next AI hint.
const PREFETCH_HINTS = false;

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
  hintButton: document.getElementById("hintButton"),
  hintBanner: document.getElementById("hintBanner"),
  moderatorMoves: document.getElementById("moderatorMoves"),
  moderatorTime: document.getElementById("moderatorTime"),
  logBox: document.getElementById("logBox"),
  moderatorGrid: document.getElementById("moderatorGrid"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xadc7dd);
scene.fog = new THREE.Fog(0xadc7dd, 20, 54);

// Hedge-maze walls (v4): the Quaternius hedge model fills each wall cell to form
// continuous green hedge walls, replacing the procedural box walls. `fill` stretches
// the model to the cell footprint so hedges tile seamlessly. Empty list = no-op
// fallback (box walls stay), so the app always works.
// Walls are the procedural boxes skinned with the hedge leaf texture (lighter than
// 100+ hedge model instances). Add { url: HEDGE_URL, fill: true, height: 3.8 } here
// to switch back to real hedge geometry.
const WALL_MODELS = [];
const wallMeshes = []; // procedural box walls, hidden once wall models load

const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 120);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
elements.scene.appendChild(renderer.domElement);

const hintGroup = new THREE.Group();
const avatarGroup = new THREE.Group();
const routeCueGroup = new THREE.Group(); // shaded route lines at a junction
scene.add(hintGroup, avatarGroup, routeCueGroup);

// VISUAL_CUES: at each junction, draw a shaded line on the floor for every VALID
// branch — darker = shorter route, lighter = longer — tracing up to CUE_LINE_STEPS
// cells (like the old hint trail). Dead ends draw no line but stay in the text.
// Set false for text-only. The text hints are unchanged either way.
const VISUAL_CUES = true;
const CUE_LINE_STEPS = 12;       // how far a cue line runs; longer = more directive
// Show the AI's step estimate beside each option. The numbers are the length of the
// route the AI actually traced, which is an upper bound rather than the true
// shortest, hence the "~". ?steps=0 hides them again.
const SHOW_STEP_COUNTS = (() => {
  const v = new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("steps");
  return !(v === "0" || v === "false");
})();
const CUE_LINE_OPACITY = 0.62;   // lines read as an overlay, not paint
// MULTI_ROUTE_ONLY: say nothing at junctions with only one usable route, so the AI
// speaks only where there is an actual choice to make. Override per session with
// ?multi=1 / ?multi=0.
const MULTI_ROUTE_ONLY = (() => {
  const v = new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("multi");
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return false;   // default: speak wherever anything is known
})();
const CUE_COLOR_SHORT = new THREE.Color(0x7f1d1d); // dark red = closer to the exit
const CUE_COLOR_LONG = new THREE.Color(0xfca5a5);  // light red = further from the exit
// Shading scale: cue colour tracks the branch's distance to the exit across the whole
// maze (dark = nearly there, light = far), so a single route still carries meaning.
// Set from the loaded cues; falls back until they arrive.
let cueStepsRange = { min: 0, max: 40 };

const materials = createMaterials();
const reusable = createReusableGeometry();

buildCityScene();
buildAvatar();
bindControls();
setView(currentView);
// Remove the Ask AI button (and reflow to four buttons) for the no-AI control group
// AND for herding mode, where the hint is automatic rather than requested.
if (!aiCondition || AUTO_HERD || ROUTE_EVAL_MODE) {
  const controls = document.querySelector(".experiment-controls");
  if (controls) controls.classList.add("no-ai");
}
loadServerState().then(() => { startAutoHerd(); startRouteEval(); });
loadAiSolutions();
logState("start_trial");
if (IS_TRAINING) {
  logState("training_start");
  showTrainingStep();
  document.getElementById("helpButton")?.classList.add("hidden");
}
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

// Seamless mottled-green hedge/foliage texture drawn on a canvas — reads as clipped
// hedge on the flat wall panels, with none of the dark gaps of a leaf-sprite atlas.
function makeHedgeTexture(repeatX, repeatY) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3f5e30";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 60 + Math.random() * 80;
    ctx.fillStyle = `rgb(${Math.round(shade * 0.55)}, ${Math.round(shade)}, ${Math.round(shade * 0.42)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + Math.random() * 2.4, 0, Math.PI * 2);
    ctx.fill();
    // Wrap speckles across edges so the texture tiles seamlessly.
    if (x < 3 || x > size - 3 || y < 3 || y > size - 3) {
      ctx.beginPath();
      ctx.arc((x + size / 2) % size, (y + size / 2) % size, 1 + Math.random() * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMaterials() {
  return {
    street: new THREE.MeshStandardMaterial({ color: 0x7fa25a, roughness: 0.97 }),
    streetAlt: new THREE.MeshStandardMaterial({ color: 0x769754, roughness: 0.97 }),
    // Hedge walls: box panels skinned with a mottled-green foliage texture.
    wall: new THREE.MeshStandardMaterial({ map: makeHedgeTexture(4, 3), roughness: 0.95 }),
    wallCap: new THREE.MeshStandardMaterial({ map: makeHedgeTexture(4, 1), roughness: 0.95 }),
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
    new THREE.MeshStandardMaterial({ color: 0x6f8a55, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  buildStreetCells();
  buildMazeWallPanels();
  buildGoal();
  buildBuildings();
}

function buildBuildings() {
  if (!WALL_MODELS.length) return; // no models configured -> keep box walls
  const loader = new GLTFLoader();
  Promise.all(WALL_MODELS.map((config) => new Promise((resolve) => {
    loader.load(
      config.url,
      (gltf) => resolve({ scene: gltf.scene, config }),
      undefined,
      () => resolve(null)
    );
  }))).then((loaded) => placeBuildings(loaded.filter(Boolean)))
    .catch((error) => console.warn("Wall models failed to load; keeping box walls.", error));
}

function placeBuildings(models) {
  if (!models.length) return;
  wallMeshes.forEach((mesh) => { mesh.visible = false; }); // buildings replace the boxes

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (maze[y][x] !== 1) continue;        // wall cells only
      if (!hasOpenNeighbor(x, y)) continue;  // only walls a participant can actually see

      const model = models[deterministicPick(x, y, models.length)];
      const building = model.scene.clone(true); // clones share geometry/materials
      fitModelToCell(building, model.config);
      const pos = worldFromCell(x, y);
      building.position.x = pos.x;
      building.position.z = pos.z;
      building.rotation.y = streetFacingYaw(x, y);
      building.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
      scene.add(building);
    }
  }
}

function hasOpenNeighbor(x, y) {
  return isOpen(x - 1, y) || isOpen(x + 1, y) || isOpen(x, y - 1) || isOpen(x, y + 1);
}

// Face the building toward an adjacent street (best-effort; a model's "front" may
// vary, but this orients the row sensibly along the corridor).
function streetFacingYaw(x, y) {
  if (isOpen(x, y + 1)) return 0;             // street to the south
  if (isOpen(x, y - 1)) return Math.PI;       // north
  if (isOpen(x + 1, y)) return -Math.PI / 2;  // east
  if (isOpen(x - 1, y)) return Math.PI / 2;   // west
  return 0;
}

// Same choice for the same cell on every run/participant (consistent stimulus).
function deterministicPick(x, y, count) {
  const hash = (x * 73856093) ^ (y * 19349663);
  return Math.abs(hash) % count;
}

function fitModelToCell(object, config) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  if (config.fill) {
    // Stretch to fill the whole cell footprint + a target height, so tiles form a
    // continuous, seamless wall (hedge maze).
    object.scale.set(
      (cellSize * 1.02) / (size.x || 1),
      (config.height || wallHeight) / (size.y || 1),
      (cellSize * 1.02) / (size.z || 1)
    );
  } else {
    // Fit the footprint just under the cell so neighbours don't visibly clip.
    const footprint = Math.max(size.x, size.z) || 1;
    object.scale.setScalar((cellSize * 0.94 / footprint) * (config.scale || 1));
  }
  // Sit the base on the floor (bbox y-min to 0).
  const scaledBounds = new THREE.Box3().setFromObject(object);
  object.position.y = -scaledBounds.min.y;
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
        wallMeshes.push(wall, cap);
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
  const nextMazeButton = document.getElementById("nextMazeButton");
  if (nextMazeButton) nextMazeButton.addEventListener("click", handleNextMaze);
  document.getElementById("backButton").addEventListener("click", moveBackward);
  elements.hintButton.addEventListener("click", showHint);
  document.getElementById("downloadJsonButton").addEventListener("click", downloadJson);
  const helpButton = document.getElementById("helpButton");
  const helpCloseButton = document.getElementById("helpCloseButton");
  if (helpButton) helpButton.addEventListener("click", () => toggleHelp(true));
  if (helpCloseButton) helpCloseButton.addEventListener("click", () => toggleHelp(false));
  const helpDismissButton = document.getElementById("helpDismissButton");
  if (helpDismissButton) helpDismissButton.addEventListener("click", () => toggleHelp(false));

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

  // Anchor at the player's current cell on the trail so the text describes the steps
  // AHEAD of them (relative to current facing), not steps already walked.
  const playerIndex = cells.findIndex((cell) => sameCell(cell, player));
  if (playerIndex === -1) return "Head back to the highlighted path";
  if (playerIndex >= cells.length - 1) return "";

  let heading = { dx: DIRS[facing].dx, dy: DIRS[facing].dy };
  const moves = [];
  for (let i = playerIndex; i < cells.length - 1 && moves.length < aiCueLength; i += 1) {
    const dx = cells[i + 1].x - cells[i].x;
    const dy = cells[i + 1].y - cells[i].y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) break;
    moves.push(relativeTurn(heading, dx, dy));
    heading = { dx, dy };
  }
  if (!moves.length) return "";

  const start = cells[playerIndex];
  const end = cells[playerIndex + moves.length];
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

  const cameFrom = { ...player };
  recordJunctionDecision({ x: nx, y: ny });
  const revisit = visitedCells.has(`${nx},${ny}`);
  if (revisit) backtrackMoves += 1;
  if (action === "backward") reverseMoves += 1;   // the Back control, not a revisit
  visitedCells.add(`${cameFrom.x},${cameFrom.y}`);
  visitedCells.add(`${nx},${ny}`);
  player = { x: nx, y: ny };
  moves += 1;
  advanceStoredPathAfterMove();
  schedulePrefetch();
  logState("move", { attempted_move: action, attempted_x: nx, attempted_y: ny, plan_status: planStatus, revisit });

  if (MID_MAZE_CUTOFF && aiActive) {
    if (chokeCell) {
      if (sameCell(player, chokeCell)) latchAiOff();
    } else {
      if (startGoalDistance == null) startGoalDistance = shortestPath(start, goal).length - 1;
      const left = shortestPath(player, goal).length - 1;
      if (left <= Math.floor(startGoalDistance * AI_CUTOFF_FRACTION)) latchAiOff();
    }
  }

  if (ROUTE_EVAL_MODE) {
    lastPlayerCell = cameFrom;
    maybeEvaluateJunction();
  }

  if (player.x === goal.x && player.y === goal.y) {
    if (finishedAt == null) finishedAt = Date.now();
    const optimal = Math.max(0, shortestPath(start, goal).length - 1);
    const withCue = junctionDecisions.filter((d) => d.followed !== null);
    logState("goal_reached");
    // Excess is measured against the shortest route, as agreed: with several correct
    // paths any other benchmark is arbitrary.
    logState("maze_summary", {
      completion_ms: finishedAt - startTime - helpPausedMs,
      help_paused_ms: helpPausedMs,
      completion_ms_including_help: finishedAt - startTime,
      moves_taken: moves,
      shortest_possible: optimal,
      excess_moves: moves - optimal,
      revisited_cell_moves: backtrackMoves,
      back_button_moves: reverseMoves,
      junctions_passed: junctionDecisions.length,
      junctions_with_a_cue: withCue.length,
      followed_cue: withCue.filter((d) => d.followed).length,
      median_decision_ms: (() => {
        if (!junctionDecisions.length) return null;
        const v = junctionDecisions.map((d) => d.decision_ms).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)];
      })(),
    });
    hintBannerText = "Goal reached";
    hintMessageUntil = Date.now() + 2500;
    showTaskComplete();
  }

  updateUi();
}

// ---- Route-evaluation mechanic (v5) ----------------------------------------
function openNeighborCount(cell) {
  return DIRS.reduce((n, d) => n + (isOpen(cell.x + d.dx, cell.y + d.dy) ? 1 : 0), 0);
}

// Branches at a junction: the open neighbours except the cell we came from.
function junctionBranches(cell, cameFrom) {
  const branches = [];
  for (const d of DIRS) {
    const next = { x: cell.x + d.dx, y: cell.y + d.dy };
    if (!isOpen(next.x, next.y)) continue;
    if (cameFrom && sameCell(next, cameFrom)) continue;
    branches.push(next);
  }
  return branches;
}

function egoLabel(dx, dy) {
  return { straight: "Ahead", right: "Right", left: "Left", back: "Back" }[relativeTurn(DIRS[facing], dx, dy)];
}


// Shade for a branch: dark near the exit, light far from it. Shared by the floor
// lines and the swatch in the banner, so the two always agree.
function cueColor(steps) {
  const span = Math.max(1, cueStepsRange.max - cueStepsRange.min);
  const t = Math.min(1, Math.max(0, ((Number(steps) || 0) - cueStepsRange.min) / span));
  return new THREE.Color().lerpColors(CUE_COLOR_SHORT, CUE_COLOR_LONG, t);
}

// Returns HTML: each branch that has a line on the floor is prefixed with a swatch
// of that line's colour, so the participant can match text to ground.
function formatRouteEval(branches) {
  setCueRangeForJunction(branches);
  const shown = branches.filter((b) => Math.abs(b.x - player.x) + Math.abs(b.y - player.y) === 1);
  // Shorter/longer is judged against the options actually on screen — the branch the
  // player came from is already gone, so comparing to the stored verdict would be wrong.
  const routeSteps = shown.filter((b) => b.verdict !== "dead_end").map((b) => Number(b.steps) || 0);
  const shortest = routeSteps.length ? Math.min(...routeSteps) : null;
  if (MULTI_ROUTE_ONLY && routeSteps.length < 2) return "";
  const allSame = routeSteps.length > 1 && Math.max(...routeSteps) === shortest;

  // Branches that cost the same are one option, not two: say "Ahead, Right: same
  // length" rather than repeating the identical number twice. Groups are then read
  // out shortest first, which is also darkest first — so the order of the text
  // matches the order of the shading on the floor and the two can be scanned together.
  const groups = new Map();
  for (const b of shown) {
    if (b.verdict === "dead_end") continue;   // no line drawn, and nothing to compare
    const steps = Number(b.steps) || 0;
    if (!groups.has(steps)) groups.set(steps, []);
    groups.get(steps).push(b);
  }

  const parts = [];
  for (const [steps, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const phrase = routeSteps.length < 2 ? "this way looks promising"
      // "same length" rather than bare "same": on a loop both branches genuinely cost
      // the same, and that should read as an answer about distance rather than the
      // assistant declining to choose.
      : allSame ? "same length"
      : steps === shortest ? "shorter" : "longer";
    const stepText = SHOW_STEP_COUNTS && Number.isFinite(steps) ? `, ~${steps} steps` : "";
    const swatch = `<span class="cue-dot" style="background:#${cueColor(steps).getHexString()}"></span>`;
    const where = members.map((b) => egoLabel(b.x - player.x, b.y - player.y)).join(", ");
    parts.push(`${swatch}${where}: ${phrase}${stepText}`);
  }
  return parts.join("   ·   ");
}

// ---- Precompute at trial start: one call evaluates every junction, so the cue is
// ready instantly at each one (no per-junction wait). ----
function allJunctions() {
  const list = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isOpen(x, y)) continue;
      const branches = junctionBranches({ x, y }, null);
      if (branches.length >= 3) list.push({ x, y, branches });
    }
  }
  return list;
}

// ---- Deterministic BFS ground truth (no AI) --------------------------------
// Shortest number of steps from `from` to the goal, treating cell `blockedKey`
// ("x,y") as a wall. Infinity means the goal is unreachable without passing back
// through the blocked cell — i.e. `from` is inside a dead-end pocket.
function distToGoalBlocking(from, blockedKey) {
  if (from.x === goal.x && from.y === goal.y) return 0;
  const seen = new Set([`${from.x},${from.y}`, blockedKey]);
  let frontier = [from];
  let dist = 0;
  while (frontier.length) {
    dist += 1;
    const next = [];
    for (const c of frontier) {
      for (const d of DIRS) {
        const nx = c.x + d.dx;
        const ny = c.y + d.dy;
        const key = `${nx},${ny}`;
        if (!isOpen(nx, ny) || seen.has(key)) continue;
        if (nx === goal.x && ny === goal.y) return dist;
        seen.add(key);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return Infinity;
}

// Depth of a dead-end pocket: steps from the junction to its farthest cell, with
// the junction removed. `from` is the branch cell (1 step in), so we add that step.
function pocketDepthBlocking(from, blockedKey) {
  const seen = new Set([`${from.x},${from.y}`, blockedKey]);
  let frontier = [from];
  let layers = 0;
  while (true) {
    const next = [];
    for (const c of frontier) {
      for (const d of DIRS) {
        const nx = c.x + d.dx;
        const ny = c.y + d.dy;
        const key = `${nx},${ny}`;
        if (!isOpen(nx, ny) || seen.has(key)) continue;
        seen.add(key);
        next.push({ x: nx, y: ny });
      }
    }
    if (!next.length) break;
    layers += 1;
    frontier = next;
  }
  return layers + 1; // +1 for the junction -> branch step
}


// Fill junctionEvals with exact cues for every junction — verdict, step counts,
// and a justification for why each losing branch fails — all from BFS.
function computeJunctionCues() {
  for (const j of allJunctions()) {
    const blockedKey = `${j.x},${j.y}`;
    const branchCells = junctionBranches({ x: j.x, y: j.y }, null);
    const evals = branchCells.map((b) => {
      const dist = distToGoalBlocking(b, blockedKey);
      if (dist === Infinity) {
        const depth = pocketDepthBlocking(b, blockedKey);
        return { x: b.x, y: b.y, verdict: "dead_end", steps: depth, reason: `closes off after ${depth} step${plural(depth)}` };
      }
      return { x: b.x, y: b.y, cost: dist + 1 }; // onward; classify once we know the best
    });
    const onward = evals.filter((e) => e.cost != null);
    if (onward.length) {
      const best = Math.min(...onward.map((e) => e.cost));
      for (const e of onward) {
        e.steps = e.cost;
        if (e.cost === best) {
          e.verdict = "toward_goal";
          e.reason = "";
        } else {
          const longerBy = e.cost - best;
          e.verdict = "detour";
          e.reason = `~${longerBy} step${plural(longerBy)} longer than the direct route`;
        }
        delete e.cost;
      }
    }
    junctionEvals.set(blockedKey, evals);
  }
}

async function precomputeJunctions() {
  const junctions = allJunctions();
  if (!junctions.length) return;
  if (CUE_SOURCE === "bfs") {
    // No AI call: exact cues computed locally and instantly.
    computeJunctionCues();
    logState("route_eval_precomputed", { junctions: junctionEvals.size, source: "bfs" });
    maybeEvaluateJunction(); // reveal the starting junction immediately
    updateUi();
    return;
  }
  if (CUE_SOURCE === "file") {
    // No runtime AI call: load cues the offline generator already produced. A maze
    // with no hints yet has no url at all, and asks for nothing.
    if (!HINTS_URL) { maybeEvaluateJunction(); updateUi(); return; }
    try {
      const response = await fetch(HINTS_URL);
      if (!response.ok) throw new Error(`cue file HTTP ${response.status}`);
      const data = await response.json();
      for (const j of data.junctions || []) junctionEvals.set(`${j.x},${j.y}`, j.branches || []);
      logState("route_eval_precomputed", { junctions: junctionEvals.size, source: "file", generated_at: data.generated_at });
    } catch (error) {
      logState("route_eval_precompute_failed", { source: "file", message: error.message });
    }
    maybeEvaluateJunction(); // reveal the starting junction immediately
    updateUi();
    return;
  }
  precomputing = true;
  updateUi();
  try {
    const response = await fetch("/api/route-eval-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maze, goal, junctions }),
    });
    const data = await response.json();
    // Surface the raw AI output for inspection: `window.__aiCues` in the console,
    // and a one-line dump. The server also writes it to error_logs/ai_cues.json.
    window.__aiCues = data;
    console.log("[AI cues JSON]", JSON.stringify(data, null, 2));
    if (response.ok && data.status === "evaluated") {
      for (const j of data.junctions || []) junctionEvals.set(`${j.x},${j.y}`, j.branches || []);
      latestLatencyMs = data.latency_ms ?? latestLatencyMs;
      logState("route_eval_precomputed", { junctions: junctionEvals.size, llm_latency_ms: data.latency_ms });
    } else {
      logState("route_eval_precompute_failed", { message: data.message });
    }
  } catch (error) {
    logState("route_eval_precompute_failed", { message: error.message });
  } finally {
    precomputing = false;
    maybeEvaluateJunction(); // reveal the starting junction now that cues are ready
    updateUi();
  }
}

function startRouteEval() {
  if (!ROUTE_EVAL_MODE || !aiCondition || currentView !== "participant") return;
  precomputeJunctions();
}

// Only a real junction (3+ open neighbours) is a decision point worth evaluating.
function noteJunctionArrival() {
  const key = `${player.x},${player.y}`;
  if (junctionVisit && junctionVisit.key === key) return;   // still the same junction
  if (openNeighborCount(player) < 3) { junctionVisit = null; return; }
  const evals = junctionEvals.get(key) || [];
  const live = evals.filter((b) => b.verdict !== "dead_end" && Number.isFinite(Number(b.steps)));
  const best = live.length ? live.reduce((a, b) => (Number(b.steps) < Number(a.steps) ? b : a)) : null;
  junctionVisit = {
    key,
    arrivedAt: Date.now(),
    pausedAtArrival: helpPausedMs,
    // What the participant was shown, if anything. Null in no_ai and after the
    // assistant goes, which is exactly the contrast the analysis needs.
    recommended: aiActive && aiCondition && best ? `${best.x},${best.y}` : null,
    options: live.map((b) => ({ cell: `${b.x},${b.y}`, steps: Number(b.steps) })),
  };
}

// Called on the move that leaves a junction: how long they stood there, which way
// they went, and whether that first choice was the branch the assistant named.
function recordJunctionDecision(toCell) {
  if (!junctionVisit) return;
  const chosen = `${toCell.x},${toCell.y}`;
  const decision = {
    junction: junctionVisit.key,
    chosen,
    recommended: junctionVisit.recommended,
    followed: junctionVisit.recommended == null ? null : chosen === junctionVisit.recommended,
    decision_ms: Date.now() - junctionVisit.arrivedAt - (junctionVisit.pausedAtArrival !== undefined ? helpPausedMs - junctionVisit.pausedAtArrival : 0),
    options: junctionVisit.options,
  };
  junctionDecisions.push(decision);
  logState("junction_decision", decision);
  junctionVisit = null;
}

function maybeEvaluateJunction() {
  computeJunctionCueText();
  drawRouteCues(); // keep the floor lines in sync with the text cue
  noteJunctionArrival();
}

// One-way latch: the AI is gone for the rest of the trial once the choke is reached.
function latchAiOff() {
  aiActive = false;
  routeEvalText = "";
  clearRouteCues();
  logState("ai_disappeared", { x: player.x, y: player.y });
}

function computeJunctionCueText() {
  if (IS_TRAINING) { routeEvalText = ""; return; }
  if (!aiActive) { routeEvalText = ""; return; } // AI has disappeared for this trial
  if (!aiOn || openNeighborCount(player) < 3) {
    routeEvalText = ""; // corridor / dead-end: no comparison to make
    return;
  }
  const precomputed = junctionEvals.get(`${player.x},${player.y}`);
  if (precomputed) {
    // Instant: drop the branch we came from, label the rest relative to facing.
    // Every branch with a verified route is shown, including the one just walked in
    // from. Hiding the arrival branch made the advice depend on movement history:
    // the same cell with the same facing gave different hints depending on whether
    // the participant had stepped forward-then-back or back-then-forward, and a
    // branch could be made to vanish by stepping off the junction and returning.
    routeEvalText = formatRouteEval(precomputed);
    return;
  }
  if (precomputing) { routeEvalText = ""; return; } // cues still loading at start
  // No live call: bfs is local, and ai precompute-only relies solely on trial-start cues.
  if (CUE_SOURCE === "bfs" || AI_PRECOMPUTE_ONLY) { routeEvalText = ""; return; }
  evaluateJunction(); // ai live-fallback mode: this junction wasn't precomputed → live call
}

// ---- Visual route cues: shaded floor lines at a junction (darker = shorter route) ----
function openNeighbors(cell) {
  return DIRS.map((d) => ({ x: cell.x + d.dx, y: cell.y + d.dy })).filter((c) => isOpen(c.x, c.y));
}

// Cells to draw for a branch. If the AI stored the start of its own route we follow
// that exactly, so the line shows where the path really leads — including round
// corners and past further junctions. Otherwise fall back to following the corridor,
// which now bends too (the old straight-only rule existed for arrowheads, and the
// arrowheads are gone).
function traceBranchCells(junction, firstCell, maxSteps, storedPath) {
  if (Array.isArray(storedPath) && storedPath.length) {
    return [junction, ...storedPath.slice(0, maxSteps)];
  }
  const path = [junction, firstCell];
  let prev = junction;
  let cur = firstCell;
  while (path.length <= maxSteps) {
    const nexts = openNeighbors(cur).filter((n) => !sameCell(n, prev));
    if (nexts.length !== 1) break; // dead end (0) or a further junction (>=2) -> stop
    prev = cur;
    cur = nexts[0];
    path.push(cur);
  }
  return path;
}

// Shade scale is set from the branches AT THIS JUNCTION, not the whole maze: the
// question the participant is answering is "which of these is closer", so the nearer
// option should always be clearly dark and the farther clearly light. A maze-wide
// scale made two branches a few steps apart look almost identical.
function setCueRangeForJunction(branches) {
  const steps = branches
    .filter((b) => b.verdict !== "dead_end")
    .map((b) => Number(b.steps) || 0);
  if (!steps.length) return;
  const min = Math.min(...steps);
  const max = Math.max(...steps);
  cueStepsRange = { min, max: max > min ? max : min + 1 }; // a lone branch reads as closest
}

function clearRouteCues() {
  for (const child of routeCueGroup.children) {
    if (child.material && child.material.dispose) child.material.dispose();
  }
  routeCueGroup.clear();
}

// Draw a shaded line per VALID branch at the current junction: darker = fewer steps
// to the goal, lighter = more. Dead ends draw nothing (still listed in the text).
function drawRouteCues() {
  clearRouteCues();
  if (IS_TRAINING) return;   // practice is about the controls, not the assistant
  window.__routeCues = []; // debug snapshot of the drawn lines (like window.__aiCues)
  window.__aiActive = aiActive;
  window.__playerPos = { x: player.x, y: player.y, facing };
  if (!aiActive) return; // AI has disappeared for this trial
  if (!VISUAL_CUES || !aiOn || currentView !== "participant") return;
  if (openNeighborCount(player) < 3) return; // only at a junction
  const evals = junctionEvals.get(`${player.x},${player.y}`);
  if (!evals) return;

  const valid = evals.filter((b) => {
    if (b.verdict === "dead_end") return false; // no line for dead ends
    if (Math.abs(b.x - player.x) + Math.abs(b.y - player.y) !== 1) return false; // adjacent branch only
    return true;
  });
  if (!valid.length) return;
  if (MULTI_ROUTE_ONLY && valid.length < 2) return;   // no choice here, so draw nothing
  setCueRangeForJunction(valid);

  for (const b of valid) {
    // Distance-based shade: dark near the exit, light when far. Consistent maze-wide,
    // so the colour still informs even when a junction has a single valid route.
    const color = cueColor(b.steps);
    // Slightly transparent so the line reads as an overlay on the ground, not paint.
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: CUE_LINE_OPACITY });
    const cells = traceBranchCells(player, { x: b.x, y: b.y }, CUE_LINE_STEPS, b.path);
    drawCueSegments(cells, material);
    window.__routeCues.push({ x: b.x, y: b.y, steps: Number(b.steps) || 0, verdict: b.verdict, hex: color.getHexString(), cells: cells.length });
  }
}

function drawCueSegments(cells, material) {
  const lineWidth = 0.24;
  for (let i = 0; i < cells.length - 1; i += 1) {
    const cur = cells[i];
    const next = cells[i + 1];
    const dx = next.x - cur.x;
    const dy = next.y - cur.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
    const from = worldFromCell(cur.x, cur.y);
    const to = worldFromCell(next.x, next.y);
    const horizontal = dy === 0;
    const seg = new THREE.Mesh(reusable.hintLineSegment, material);
    seg.position.set((from.x + to.x) / 2, 0.105, (from.z + to.z) / 2);
    seg.scale.set(horizontal ? cellSize + lineWidth : lineWidth, 1, horizontal ? lineWidth : cellSize + lineWidth);
    routeCueGroup.add(seg);
  }
}


// Re-align the already-computed junction cue to the current facing when the player
// turns in place: Ahead/Left/Right shift with the view. Uses only stored cues —
// never a new AI call. Safe in every mode (bfs + ai).
function realignJunctionCue() {
  if (!ROUTE_EVAL_MODE || !aiOn || !aiActive) return;
  if (openNeighborCount(player) < 3) return; // only meaningful at a junction
  const precomputed = junctionEvals.get(`${player.x},${player.y}`);
  if (!precomputed) return; // nothing stored → leave the banner untouched
  routeEvalText = formatRouteEval(precomputed);
}

async function evaluateJunction() {
  const branches = junctionBranches(player, null);
  if (branches.length < 2) { routeEvalText = ""; return; }

  routeEvalInFlight = true;
  const requestedAt = Date.now();
  logState("route_eval_requested", { x: player.x, y: player.y, branches: branches.length });
  updateUi();

  try {
    const response = await fetch("/api/route-eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maze, player, goal, branches }),
    });
    const data = await response.json();
    if (!response.ok || data.status !== "evaluated") throw new Error(data.message || "Route evaluation failed.");
    junctionEvals.set(`${player.x},${player.y}`, data.branches || []); // cache so cues can draw
    routeEvalText = formatRouteEval(data.branches || []);
    drawRouteCues();
    latestLatencyMs = data.latency_ms ?? Date.now() - requestedAt;
    logState("route_eval_received", { llm_latency_ms: latestLatencyMs, count: (data.branches || []).length, text: routeEvalText });
  } catch (error) {
    routeEvalText = "AI couldn't assess the paths — your call.";
    logState("route_eval_failed", { message: error.message });
  } finally {
    routeEvalInFlight = false;
    updateUi();
  }
}

// ---- Task complete overlay ------------------------------------------------
// Shown on reaching the exit. In a /study run the button advances to the next maze
// on the SAME url; on the last maze (or outside a study run) it just reports done.
// ---- Practice run -----------------------------------------------------------
// Controls only. Each step is finished by actually pressing the control, so nobody
// reaches maze 1 without having turned, walked and stepped back at least once. No
// assistant here: in the no_ai condition a cue shown in practice would be the only
// one that participant ever saw.

// Highlight the control being asked for, and name both ways of pressing it. The
// participant can use the on-screen button or the key; the study logs neither
// differently, but people reach for one or the other.
function highlightTrainingButton(id) {
  for (const el of document.querySelectorAll(".experiment-controls button")) {
    el.classList.toggle("training-target", Boolean(id) && el.id === id);
  }
}

// Opening and closing are both logged, so time spent reading the reminder can be
// separated from time spent solving if it matters to the analysis.
function toggleHelp(open) {
  const card = document.getElementById("helpCard");
  const button = document.getElementById("helpButton");
  if (!card) return;
  card.classList.toggle("hidden", !open);
  if (button) button.classList.toggle("hidden", open);
  if (open) {
    if (helpOpenedAt == null) helpOpenedAt = Date.now();
    logState("help_opened", { maze: MAZE_KEY });
  } else {
    // logged before the clock restarts, so the row carries the frozen time
    logState("help_closed", { maze: MAZE_KEY, help_ms: helpOpenedAt ? Date.now() - helpOpenedAt : 0 });
    if (helpOpenedAt != null) helpPausedMs += Date.now() - helpOpenedAt;
    helpOpenedAt = null;
  }
  updateUi();
}

function showTrainingStep() {
  const panel = document.getElementById("trainingPanel");
  const step = document.getElementById("trainingStep");
  const progress = document.getElementById("trainingProgress");
  if (!panel || !step) return;
  const current = TRAINING_STEPS[trainingAt];
  panel.classList.remove("hidden");
  step.textContent = current.text;
  if (progress) {
    progress.innerHTML = `Press the highlighted button, or <span class="training-key">${current.key}</span>` +
      ` &nbsp;·&nbsp; step ${trainingAt + 1} of ${TRAINING_STEPS.length}`;
  }
  highlightTrainingButton(current.button);
}

// Called after every control press while practising. A press only counts if it is
// the control being asked for, so the prompts cannot be clicked past.
function noteTrainingAction(action) {
  if (!IS_TRAINING || trainingAt >= TRAINING_STEPS.length) return;
  if (TRAINING_STEPS[trainingAt].action !== action) return;
  trainingAt += 1;
  logState("training_step", { step: trainingAt, action });
  if (trainingAt < TRAINING_STEPS.length) { showTrainingStep(); return; }
  const step = document.getElementById("trainingStep");
  const progress = document.getElementById("trainingProgress");
  if (step) step.textContent = "That is all the controls. Your goal is to find the exit. Starting the first maze…";
  if (progress) progress.textContent = "";
  highlightTrainingButton(null);
  logState("training_complete");
  setTimeout(completeTraining, 1400);
}

function showTaskComplete() {
  if (currentView !== "participant" || IS_TRAINING) return;
  const panel = document.getElementById("taskComplete");
  const title = document.getElementById("taskCompleteTitle");
  const sub = document.getElementById("taskCompleteSub");
  const button = document.getElementById("nextMazeButton");
  if (!panel || !button) return;

  const hasNext = IS_STUDY && STUDY_INDEX < STUDY_TOTAL - 1;

  // Deliberately no moves/time here: showing a participant their score mid-study
  // invites them to compare trials and change strategy. It is all still logged.
  if (IS_STUDY) {
    title.textContent = hasNext ? "Task complete!" : "All tasks complete!";
    sub.textContent = `Maze ${STUDY_INDEX + 1} of ${STUDY_TOTAL}`;
  } else {
    title.textContent = "Task complete!";
    sub.textContent = "";
  }
  // The questionnaire sits between maze 4 and maze 5 in every condition. With no url
  // configured the step still appears, but only offers Continue, so piloting cannot
  // post test responses into the real response set.
  const note = document.getElementById("surveyNote");
  const link = document.getElementById("surveyLink");
  const atSurvey = IS_STUDY && SURVEY_AFTER_INDEX.includes(STUDY_INDEX);
  const surveyUrl = atSurvey ? surveyUrlFor(STUDY_INDEX) : "";
  if (note) note.classList.toggle("hidden", !atSurvey);
  if (link) link.classList.toggle("hidden", !atSurvey || !surveyUrl);
  if (atSurvey) {
    if (note) {
      note.textContent = surveyUrl
        ? "Please answer a short questionnaire before continuing. It opens in a new tab; come back here afterwards."
        : "A questionnaire goes here. It is not connected yet, so continue straight on.";
    }
    if (link && surveyUrl) {
      const url = new URL(surveyUrl);
      url.searchParams.set("participant", PARTICIPANT_ID);
      url.searchParams.set("condition", CONDITION);
      url.searchParams.set("maze", String(STUDY_INDEX + 1));
      link.href = url.toString();
    }
    logState("survey_step_shown", { after_maze: STUDY_INDEX + 1, linked: Boolean(surveyUrl) });
  }

  button.textContent = !hasNext ? "Finished" : atSurvey ? "Skip and continue" : "Next maze";
  button.disabled = !hasNext;
  if (atSurvey && !hasNext && note) {
    note.textContent = surveyUrl
      ? "One last questionnaire, then you are done. Thank you."
      : "That is the end of the run. Thank you.";
  }
  panel.classList.remove("hidden");
}

function handleNextMaze() {
  const button = document.getElementById("nextMazeButton");
  if (button) { button.disabled = true; button.textContent = "Loading…"; }
  logState("next_maze_clicked", { from_index: STUDY_INDEX });
  // Re-inits the page on the same url; false means there is nothing left to load.
  if (!advanceStudyMaze() && button) {
    button.textContent = "Finished";
  }
}

function moveForward() {
  if (IS_TRAINING) noteTrainingAction("forward");
  const dir = DIRS[facing];
  attemptMove(dir.dx, dir.dy, "forward");
}

function moveBackward() {
  if (IS_TRAINING) noteTrainingAction("back");
  const dir = DIRS[facing];
  attemptMove(-dir.dx, -dir.dy, "backward");
}

function turnLeft() {
  if (IS_TRAINING) noteTrainingAction("turnLeft");
  if (currentView !== "participant") return;
  participantHasInteracted = true;
  facing = (facing + 3) % 4;
  realignJunctionCue(); // shift Ahead/Left/Right to the new facing (no AI call)
  logState("turn_left");
  updateUi();
}

function turnRight() {
  if (IS_TRAINING) noteTrainingAction("turnRight");
  if (currentView !== "participant") return;
  participantHasInteracted = true;
  facing = (facing + 1) % 4;
  realignJunctionCue(); // shift Ahead/Left/Right to the new facing (no AI call)
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

// v3 herding: keep the full precomputed route; the visible window always shows the
// next few legal steps from the player's CURRENT cell and rolls forward — persistent
// but never stale — guiding them block by block to the goal.
function advanceHerd() {
  if (!activeFullPath.length) {
    planStatus = "none";
    return;
  }
  const idx = activeFullPath.findIndex((cell) => sameCell(cell, player));
  if (idx === -1) {
    // Off the route (a wrong turn at a junction): herd them back, no trail.
    planStatus = "deviated";
    visibleAiPath = [];
    activeHintPath = [];
    hintBannerText = "Head back to the route";
    hintVisibleUntil = Number.POSITIVE_INFINITY;
    refreshHintMarkers();
    return;
  }
  visibleAiPath = clampHint(activeFullPath.slice(idx)); // next few steps from the player
  activeHintPath = visibleAiPath.slice(1);
  hintVisibleUntil = visibleAiPath.length > 1 ? Number.POSITIVE_INFINITY : 0;
  planStatus = idx >= activeFullPath.length - 1 ? "complete" : "following";
  refreshHintMarkers();
}

function advanceStoredPathAfterMove() {
  if (AUTO_HERD) {
    advanceHerd();
    return;
  }
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

// ---- Prefetch (A): fetch the next hint in the background while the participant
// walks, so a later Ask AI can be served instantly. All gated by PREFETCH_HINTS. ----
let prefetch = { key: null, promise: null, data: null };
let prefetchTimer = null;

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

async function fetchHintData(playerCell, facingName, clientEventId) {
  const response = await fetch("/api/hint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maze,
      player: playerCell,
      facing: facingName,
      goal,
      max_hint_steps: aiCueLength,
      move_count: moves,
      client_event_id: clientEventId,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.status !== "path_found") {
    throw new Error(data.message || "AI did not return a valid path.");
  }
  return data;
}

function schedulePrefetch() {
  if (!PREFETCH_HINTS || !aiCondition || !aiOn || currentView !== "participant") return;
  // Only worth prefetching when a fresh call would otherwise be needed, i.e. the
  // stored route no longer starts at the player (they consumed or left it).
  if (activeFullPath.length > 1 && sameCell(activeFullPath[0], player)) return;
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(runPrefetch, 700); // debounce: only when they pause
}

function runPrefetch() {
  if (!PREFETCH_HINTS || hintRequestInFlight) return;
  const key = cellKey(player);
  if (prefetch.key === key) return; // already have / fetching this cell
  const snapshot = { ...player };
  const eventId = `prefetch-${Date.now()}-${++lastEventId}`;
  const promise = fetchHintData(snapshot, DIRS[facing].name, eventId)
    .then((data) => {
      if (prefetch.key === key) prefetch.data = data; // ignore if player has moved on
      return data;
    })
    .catch(() => {
      if (prefetch.key === key) clearPrefetch();
      return null;
    });
  prefetch = { key, promise, data: null };
}

function clearPrefetch() {
  clearTimeout(prefetchTimer);
  prefetch = { key: null, promise: null, data: null };
}

// v3 herding: fire the single AI call at trial start; advanceHerd() then rolls the
// window to the goal on its own. Only the participant fetches.
function startAutoHerd() {
  if (!AUTO_HERD || !aiCondition || currentView !== "participant") return;
  showHint();
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
    // Use a ready (or in-flight) prefetch for this exact cell if we have one.
    let data = null;
    const key = cellKey(player);
    if (PREFETCH_HINTS && prefetch.key === key && (prefetch.data || prefetch.promise)) {
      const cached = prefetch.data || await prefetch.promise;
      clearPrefetch();
      if (cached && cached.status === "path_found") data = cached;
    }
    const servedFromPrefetch = data != null;
    if (!data) {
      clearPrefetch(); // cancel any pending/stale prefetch; fetching directly now
      data = await fetchHintData(player, DIRS[facing].name, clientEventId);
    }
    latestLatencyMs = data.latency_ms ?? Date.now() - requestedAt;

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
      served_from_prefetch: servedFromPrefetch,
      felt_latency_ms: Date.now() - requestedAt,
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

function resetLocalTrial() {
  player = { ...start };
  facing = MAZE_CONFIG.startFacing ?? 1;
  moves = 0;
  startTime = Date.now();
  helpPausedMs = 0;
  helpOpenedAt = null;
  finishedAt = null;
  aiActive = true; // the AI is back for the new trial
  clearRouteCues();
  clearVisibleHint();
  clearPrefetch();
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
  const row = {
    timestamp_iso: new Date().toISOString(),
    elapsed_ms: elapsedMs(),
    participant_id: PARTICIPANT_ID,
    condition: CONDITION,
    maze: MAZE_KEY,
    maze_index: STUDY_INDEX,
    action,
    current_view: currentView,
    x: player.x,
    y: player.y,
    facing: DIRS[facing].name,
    moves,
    ai_enabled: aiOn,
    ai_present: aiCondition,
    maze_seed: MAZE_CONFIG.seed,
    maze_size: `${cols}x${rows}`,
    plan_status: planStatus,
    stored_path_length: activeFullPath.length,
    ...extra,
  };
  eventLog.push(row);
  if (currentView === "participant") appendToRunLog(row);
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

  const aiSet = pathSet(visibleAiPath);
  // Each verified AI route drawn as a thin line through the cell centres rather
  // than a filled block, so the maze stays visible underneath. A cell records one
  // bar per direction the route leaves by, which makes straight runs and corners
  // both come out continuous. Where routes overlap the earlier (shorter) one still
  // supplies the colour, but the directions are UNIONED — otherwise a later route
  // turning a different way through a shared cell would draw a broken line.
  const routeLines = new Map(); // "x,y" -> { color, dirs:Set<"up"|"down"|"left"|"right"> }
  const stepDir = (from, to) => (to.x > from.x ? "right"
    : to.x < from.x ? "left"
    : to.y > from.y ? "down" : "up");
  aiSolutions.forEach((r, i) => {
    const color = SOLUTION_COLORS[i % SOLUTION_COLORS.length];
    const path = r.path || [];
    path.forEach((c, j) => {
      const k = `${c.x},${c.y}`;
      if (!routeLines.has(k)) routeLines.set(k, { color, dirs: new Set() });
      const entry = routeLines.get(k);
      if (j > 0) entry.dirs.add(stepDir(c, path[j - 1]));
      if (j < path.length - 1) entry.dirs.add(stepDir(c, path[j + 1]));
    });
  });
  const prefetchSet = pathSet(remotePrefetchHint);

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
      const routeLine = routeLines.get(key);
      if (prefetchSet.has(key)) cell.classList.add("prefetch-path");
      if (aiSet.has(key)) cell.classList.add("ai-path");
      if (x === goal.x && y === goal.y) cell.classList.add("goal");
      if (x === player.x && y === player.y) {
        cell.classList.add("player");
        cell.dataset.facing = DIRS[facing].short;
      }
      cell.title = `(${x}, ${y})`;
      if (routeLine) {
        for (const dir of routeLine.dirs) {
          const seg = document.createElement("i");
          seg.className = `route-seg ${dir}`;
          seg.style.setProperty("--route-color", routeLine.color);
          cell.appendChild(seg);
        }
      }
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
    elapsed_ms: (finishedAt ? finishedAt - startTime - helpPausedMs : elapsedMs()),
    finished: finishedAt != null,
    active_hint_path: activeHintPath,
    active_full_path: activeFullPath,
    visible_ai_path: visibleAiPath,
    plan_status: planStatus,
    latest_latency_ms: latestLatencyMs,
    hint_visible: visibleAiPath.length > 1 && hintVisibleUntil > 0,
    // Prefetch overlay for the moderator: status + the hint the participant would
    // get if they pressed Ask AI right now (from the background-fetched route).
    prefetch_status: prefetch.key ? (prefetch.data ? "ready" : "fetching") : "none",
    prefetch_hint: prefetch.data ? clampHint(prefetch.data.full_path) : [],
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
  remotePrefetchStatus = typeof state.prefetch_status === "string" ? state.prefetch_status : "none";
  remotePrefetchHint = Array.isArray(state.prefetch_hint) ? state.prefetch_hint.map(normalizeCell) : [];
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

function downloadJson() {
  const run = readRunLog();
  const payload = {
    participant_id: PARTICIPANT_ID,
    condition: CONDITION,
    exported_at: new Date().toISOString(),
    mazes_seen: [...new Set(run.map((r) => r.maze))],
    summaries: run.filter((r) => r.action === "maze_summary"),
    events: run.length ? run : eventLog,
  };
  downloadBlob(`llm_maze_${PARTICIPANT_ID}.json`, JSON.stringify(payload, null, 2), "application/json");
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
  camera.position.set(pos.x - dir.dx * CAMERA_BACK, CAMERA_HEIGHT, pos.z - dir.dy * CAMERA_BACK);
  camera.lookAt(pos.x + dir.dx * CAMERA_LOOK_AHEAD, CAMERA_LOOK_HEIGHT, pos.z + dir.dy * CAMERA_LOOK_AHEAD);

  avatarGroup.position.set(pos.x, 0, pos.z);
  avatarGroup.rotation.y = -DIRS[facing].angle + Math.PI / 2;
  // Show the participant avatar in the raised (third-person) view.
  avatarGroup.visible = RAISED_CAMERA;
}

function updateUi() {
  updateCamera();
  const elapsed = formatTime(finishedAt ? finishedAt - startTime - helpPausedMs : elapsedMs());
  const bearing = getGoalBearing();
  const now = Date.now();
  const hintActive = aiOn && now <= hintVisibleUntil;
  const hintMessageActive = aiOn && now <= hintMessageUntil;

  hintGroup.visible = hintActive;
  elements.facingHud.textContent = DIRS[facing].name;
  elements.goalHud.textContent = "Find the exit";
  elements.moves.textContent = moves;
  elements.time.textContent = elapsed;
  elements.moderatorMoves.textContent = moves;
  elements.moderatorTime.textContent = elapsed;

  elements.hintButton.disabled = !aiOn || hintRequestInFlight;
  elements.hintButton.textContent = hintRequestInFlight
    ? "AI thinking..."
    : aiOn ? "Ask AI" : "AI unavailable";

  const hintPlan = hintActive
    ? (STATIC_HINT_TEXT ? "Follow the red path to the exit" : describeHintPlan())
    : "";
  const blockedFlashActive = Date.now() <= blockedFlashUntil;
  elements.hintBanner.textContent = hintPlan || hintBannerText;
  let bannerVisible = !IS_TRAINING && (hintActive || hintMessageActive || blockedFlashActive);
  if (!aiCondition && currentView === "participant") {
    // Control group: keep a neutral, non-directional status line in the banner
    // area so both conditions have comparable UI presence.
    if (!hintMessageActive && !blockedFlashActive) {
      elements.hintBanner.textContent = "Explore the maze and find the EXIT";
    }
    bannerVisible = true;
  }
  if (ROUTE_EVAL_MODE && aiCondition && currentView === "participant" && !blockedFlashActive) {
    // Route-evaluation mechanic: show the AI's junction comparison (or its status).
    const evalText = precomputing
      ? "AI is studying the maze…"
      : routeEvalInFlight
        ? "AI weighing up the paths…"
        : routeEvalText || "Explore the maze and find the EXIT";
    elements.hintBanner.innerHTML = evalText;
    bannerVisible = true;
  }
  // Nothing in the banner while practising: it sits in the same part of the scene as
  // the practice prompt, and the practice run is about the controls, not the maze.
  elements.hintBanner.classList.toggle("visible", bannerVisible && !IS_TRAINING);
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
