// Rotate whole mazes so the exits land on all four walls.
//
//   node mazes8/scripts/rotate-mazes.mjs [--dry]
//
// Moving only the exit gap could not spread the set: with the start pinned at top
// centre, almost no other boundary square is 53 moves away, so seven of eight exits
// stayed on the bottom wall and four sat on the very same square. "Head south" was
// still a winning strategy without reading anything.
//
// Rotating the whole grid is the way out. A rotated maze IS the same maze, so every
// matched property survives by construction -- 53 moves, 25 branch points, 24 choice
// points, the same hedge blocks -- while the exit, and the start with it, move to a
// different wall. Nothing needs regenerating either: the stored routes and hints are
// lists of cells, so they rotate along with the grid and stay exactly as valid.
//
// Parity is what makes it safe. The grid is (2N+1) square, so a rotation maps
// (x,y) -> (G-1-y, x) with G-1 even: odd stays odd. Cells land on cells, wall tracks
// on wall tracks, corner posts on corner posts.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DRY = process.argv.includes("--dry");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");
const G = 21;

// Quarter-turns clockwise per maze, chosen so exactly two mazes exit on each wall.
// Maze-7 needs a different turn from the rest because its exit already sat on the
// right wall rather than the bottom, so the same rotation sends it somewhere else.
const TURNS = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 0, 6: 1, 7: 3, 8: 3 };

const rotPoint = (p, turns) => {
  let { x, y } = p;
  for (let i = 0; i < turns; i += 1) { const nx = G - 1 - y; y = x; x = nx; }
  return { x, y };
};
const rotGrid = (g, turns) => {
  let out = g;
  for (let i = 0; i < turns; i += 1) {
    const next = Array.from({ length: G }, () => new Array(G).fill(1));
    for (let y = 0; y < G; y += 1) for (let x = 0; x < G; x += 1) next[x][G - 1 - y] = out[y][x];
    out = next;
  }
  return out;
};

const open = (g, x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
const nbrs = (g, x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]]
  .map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter((c) => open(g, c.x, c.y));
const dist = (g, from, to) => {
  const seen = new Set([`${from.x},${from.y}`]);
  let frontier = [from], d = 0;
  while (frontier.length) {
    d += 1;
    const next = [];
    for (const c of frontier) for (const n of nbrs(g, c.x, c.y)) {
      if (n.x === to.x && n.y === to.y) return d;
      const k = `${n.x},${n.y}`;
      if (seen.has(k)) continue;
      seen.add(k); next.push(n);
    }
    frontier = next;
  }
  return Infinity;
};
const junctionCount = (g) => {
  let n = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (open(g, x, y) && nbrs(g, x, y).length >= 3) n += 1;
  }
  return n;
};
const edgeOf = (p) => (p.y === 0 ? "top" : p.y === G - 1 ? "bottom" : p.x === 0 ? "left" : p.x === G - 1 ? "right" : "interior");

// walk every cell pair of a route to prove the rotation did not break adjacency
const routeWalks = (g, pathCells, start, goal) => {
  if (!pathCells.length) return true;
  const first = pathCells[0], last = pathCells[pathCells.length - 1];
  if (first.x !== start.x || first.y !== start.y) return false;
  if (last.x !== goal.x || last.y !== goal.y) return false;
  for (let i = 0; i < pathCells.length; i += 1) {
    const c = pathCells[i];
    if (!open(g, c.x, c.y)) return false;
    if (i) {
      const p = pathCells[i - 1];
      if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) !== 1) return false;
    }
  }
  return true;
};

console.log(`rotating${DRY ? "  (dry run)" : ""}\n`);
console.log("maze   turns  start      exit       wall     moves  junctions  routes ok");
let bad = 0;
for (let n = 1; n <= 8; n += 1) {
  const turns = TURNS[n];
  const file = path.join(dir, `maze-${n}.js`);
  const src = fs.readFileSync(file, "utf8");
  const g0 = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  const start0 = {
    x: +src.match(/start:\s*\{\s*x:\s*(\d+)/)[1],
    y: +src.match(/start:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1],
  };
  const goal0 = {
    x: +src.match(/goal:\s*\{\s*x:\s*(\d+)/)[1],
    y: +src.match(/goal:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1],
  };

  const g = rotGrid(g0, turns);
  const start = rotPoint(start0, turns);
  const goal = rotPoint(goal0, turns);
  const moves = dist(g, start, goal);
  const junctions = junctionCount(g);

  // rotate the stored routes and hints in step, and re-verify every route on the
  // rotated grid rather than trusting the transform
  const solFile = path.join(dir, "solutions", `maze-${n}.json`);
  const hintFile = path.join(dir, "hints", `maze-${n}.json`);
  const sol = JSON.parse(fs.readFileSync(solFile, "utf8"));
  const hints = JSON.parse(fs.readFileSync(hintFile, "utf8"));

  sol.routes = sol.routes.map((r) => ({ ...r, path: r.path.map((c) => rotPoint(c, turns)) }));
  const ok = sol.routes.filter((r) => routeWalks(g, r.path, start, goal)).length;

  hints.goal = rotPoint(hints.goal, turns);
  hints.junctions = hints.junctions.map((j) => ({
    ...rotPoint(j, turns),
    branches: j.branches.map((b) => ({
      ...b, ...rotPoint(b, turns),
      ...(b.path ? { path: b.path.map((c) => rotPoint(c, turns)) } : {}),
    })),
  }));

  const good = moves === 53 && junctions === 25 && ok === sol.routes.length;
  if (!good) bad += 1;
  console.log(`maze-${n}  ${String(turns).padEnd(7)}${(start.x + "," + start.y).padEnd(11)}` +
    `${(goal.x + "," + goal.y).padEnd(11)}${edgeOf(goal).padEnd(9)}${String(moves).padEnd(7)}` +
    `${String(junctions).padEnd(11)}${ok}/${sol.routes.length}${good ? "" : "   [!]"}`);

  if (!DRY && good && turns) {
    const rows = g.map((r) => `  "${r.join("")}",`).join("\n");
    let out = src.replace(/const WALL_ROWS = \[[\s\S]*?\n\];/, `const WALL_ROWS = [\n${rows}\n];`);
    out = out.replace(/start: \{ x: \d+, y: \d+ \}/, `start: { x: ${start.x}, y: ${start.y} }`);
    out = out.replace(/goal: \{ x: \d+, y: \d+ \}/, `goal: { x: ${goal.x}, y: ${goal.y} }`);
    fs.writeFileSync(file, out);
    fs.writeFileSync(solFile, JSON.stringify(sol, null, 2));
    fs.writeFileSync(hintFile, JSON.stringify(hints, null, 2));
  }
}

const walls = {};
for (let n = 1; n <= 8; n += 1) walls[TURNS[n]] = (walls[TURNS[n]] || 0) + 1;
console.log(`\n${bad ? `[!] ${bad} maze(s) failed a check -- nothing written for those` : "all eight hold 53 moves and 25 junctions, and every stored route still walks"}`);
if (DRY) console.log("dry run: no files written");
