import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";

const { maze, start, goal } = FIXED_8X8_MAZE_CONFIG;
const rows = maze.length;
const cols = maze[0].length;
const path = shortestPath(start, goal);
const pathCells = new Set(path.map(({ x, y }) => `${x},${y}`));
const grid = document.getElementById("pdfMazeGrid");

grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
grid.style.gap = "3px";

for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const cell = document.createElement("div");
    cell.className = "validator-cell live-cell";
    if (maze[y][x] === 1) cell.classList.add("wall");
    if (pathCells.has(`${x},${y}`)) cell.classList.add("local-path");
    if (x === goal.x && y === goal.y) cell.classList.add("goal");
    if (x === start.x && y === start.y) {
      cell.classList.add("player");
      cell.dataset.facing = "E";
    }
    cell.title = `(${x}, ${y})`;
    grid.appendChild(cell);
  }
}

document.getElementById("gridSize").textContent = `${cols} x ${rows}`;
document.getElementById("startCell").textContent = `(${start.x}, ${start.y})`;
document.getElementById("goalCell").textContent = `(${goal.x}, ${goal.y})`;
document.getElementById("pathLength").textContent = `${path.length} cells`;

function shortestPath(from, to) {
  const queue = [{ ...from, path: [{ ...from }] }];
  const seen = new Set([`${from.x},${from.y}`]);
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.x === to.x && current.y === to.y) return current.path;

    for (const [dx, dy] of directions) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = `${x},${y}`;
      const open = y >= 0 && y < rows && x >= 0 && x < cols && maze[y][x] === 0;
      if (!open || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y, path: [...current.path, { x, y }] });
    }
  }

  return [];
}
