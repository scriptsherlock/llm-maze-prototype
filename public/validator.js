import { MAZE_CONFIG } from "./maze.js";

const maze = MAZE_CONFIG.maze;
const rows = maze.length;
const cols = maze[0].length;
const start = MAZE_CONFIG.start;
const goal = MAZE_CONFIG.goal;
const maxHintSteps = MAZE_CONFIG.hintSteps;

let player = { ...start };
let moveCount = 0;
let aiPath = [];
let aiHintSteps = [];
let localPath = [];
let busy = false;

const grid = document.getElementById("validatorGrid");
const positionEl = document.getElementById("validatorPosition");
const goalEl = document.getElementById("validatorGoal");
const localLengthEl = document.getElementById("localPathLength");
const aiLengthEl = document.getElementById("aiPathLength");
const resultEl = document.getElementById("validationResult");
const logEl = document.getElementById("validatorLog");
const askButton = document.getElementById("askButton");

document.getElementById("northButton").addEventListener("click", () => move(0, -1));
document.getElementById("southButton").addEventListener("click", () => move(0, 1));
document.getElementById("westButton").addEventListener("click", () => move(-1, 0));
document.getElementById("eastButton").addEventListener("click", () => move(1, 0));
document.getElementById("resetValidatorButton").addEventListener("click", reset);
askButton.addEventListener("click", callAi);

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowup" || key === "w") move(0, -1);
  if (key === "arrowdown" || key === "s") move(0, 1);
  if (key === "arrowleft" || key === "a") move(-1, 0);
  if (key === "arrowright" || key === "d") move(1, 0);
  if (key === "h") callAi();
});

render();

function move(dx, dy) {
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!isOpen(nx, ny)) return;
  player = { x: nx, y: ny };
  moveCount += 1;
  aiPath = [];
  aiHintSteps = [];
  resultEl.textContent = "Moved. Call AI again to validate this location.";
  render();
}

function reset() {
  player = { ...start };
  moveCount = 0;
  aiPath = [];
  aiHintSteps = [];
  resultEl.textContent = "No AI call yet";
  logEl.textContent = "Waiting for AI call...";
  render();
}

async function callAi() {
  if (busy) return;
  busy = true;
  askButton.disabled = true;
  askButton.textContent = "Calling live AI...";
  resultEl.textContent = "Calling AI from current cell...";
  render();

  try {
    const response = await fetch("/api/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maze,
        player,
        facing: "East",
        goal,
        max_hint_steps: maxHintSteps,
        move_count: moveCount,
        client_event_id: `validator-${Date.now()}`,
      }),
    });
    const data = await response.json();

    if (!response.ok || data.status !== "path_found") {
      throw new Error(data.message || "AI did not return a valid path.");
    }

    aiPath = data.full_path || [];
    aiHintSteps = data.hint_steps || [];
    const validation = validateAiPath(aiPath);
    resultEl.textContent = validation.summary;
    logEl.textContent = JSON.stringify({
      provider: data.provider,
      model: data.model,
      latency_ms: data.latency_ms,
      retry_count: data.retry_count,
      validation_status: data.validation_status,
      local_path_cells: localPath.length,
      ai_path_cells: aiPath.length,
      verdict: validation.summary,
      full_path: aiPath,
      hint_steps: aiHintSteps,
    }, null, 2);
  } catch (error) {
    aiPath = [];
    aiHintSteps = [];
    resultEl.textContent = "AI call failed";
    logEl.textContent = error.message;
  } finally {
    busy = false;
    askButton.disabled = false;
    askButton.textContent = "Call AI from current cell";
    render();
  }
}

function validateAiPath(path) {
  if (!Array.isArray(path) || !path.length) return { ok: false, summary: "Invalid: no full path returned" };
  if (!sameCell(path[0], player)) return { ok: false, summary: "Invalid: AI path does not start at current player cell" };
  if (!sameCell(path[path.length - 1], goal)) return { ok: false, summary: "Invalid: AI path does not end at goal" };

  for (let index = 0; index < path.length; index += 1) {
    const cell = path[index];
    if (!isOpen(cell.x, cell.y)) return { ok: false, summary: `Invalid: wall/out-of-bounds at path index ${index}` };
    if (index > 0 && manhattan(path[index - 1], cell) !== 1) {
      return { ok: false, summary: `Invalid: non-adjacent move at path index ${index}` };
    }
  }

  if (localPath.length && path.length === localPath.length) {
    return { ok: true, summary: "Valid: AI returned a shortest full path from current cell" };
  }

  if (localPath.length && path.length > localPath.length) {
    return { ok: false, summary: `Valid path, but not shortest (${path.length} cells vs local ${localPath.length})` };
  }

  return { ok: true, summary: "Valid path; local path unavailable for comparison" };
}

function render() {
  localPath = shortestPath(player, goal);
  const localSet = pathSet(localPath);
  const aiSet = pathSet(aiPath);
  const hintSet = pathSet(aiHintSteps);

  grid.style.gridTemplateColumns = `repeat(${cols}, 30px)`;
  grid.innerHTML = "";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = document.createElement("div");
      const key = keyFor({ x, y });
      cell.className = "validator-cell";
      if (maze[y][x] === 1) cell.classList.add("wall");
      if (localSet.has(key)) cell.classList.add("local-path");
      if (aiSet.has(key)) cell.classList.add("ai-path");
      if (hintSet.has(key)) cell.classList.add("hint-path");
      if (x === goal.x && y === goal.y) cell.classList.add("goal");
      if (x === player.x && y === player.y) cell.classList.add("player");
      cell.title = `(${x}, ${y})`;
      grid.appendChild(cell);
    }
  }

  positionEl.textContent = `(${player.x}, ${player.y})`;
  goalEl.textContent = `(${goal.x}, ${goal.y})`;
  localLengthEl.textContent = localPath.length ? `${localPath.length} cells` : "no local route";
  aiLengthEl.textContent = aiPath.length ? `${aiPath.length} cells` : "n/a";
}

function shortestPath(from, to) {
  const queue = [{ x: from.x, y: from.y, path: [{ x: from.x, y: from.y }] }];
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  seen[from.y][from.x] = true;
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  while (queue.length) {
    const current = queue.shift();
    if (current.x === to.x && current.y === to.y) return current.path;

    for (const dir of dirs) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (!isOpen(nx, ny) || seen[ny][nx]) continue;
      seen[ny][nx] = true;
      queue.push({ x: nx, y: ny, path: [...current.path, { x: nx, y: ny }] });
    }
  }

  return [];
}

function pathSet(path) {
  return new Set((path || []).map(keyFor));
}

function keyFor(cell) {
  return `${cell.x},${cell.y}`;
}

function isOpen(x, y) {
  return y >= 0 && y < rows && x >= 0 && x < cols && maze[y][x] === 0;
}

function sameCell(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
