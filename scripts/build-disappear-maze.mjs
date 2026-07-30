// Generate the 12x12 "AI disappears" maze: a PERFECT maze (no loops) tuned for
// complexity. Loops are deliberately avoided — with loops the LLM's junction
// verdicts collapse (~59% accurate, invents dead ends); loopless it is ~97%.
// Complexity comes from a long winding solution, many junctions on the route, and
// deep dead-end branches instead. In a perfect maze every solution cell is a cut
// vertex, so the choke (midpoint of the solution) is guaranteed to be crossed.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const N = 12;              // cells per axis
const G = 2 * N + 1;       // display grid (25)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cellG = (i, j) => ({ x: 2 * i + 1, y: 2 * j + 1 });

// Randomized Prim's: PERFECT (no loops) and "low river" — it branches often, giving
// many decision points and short-to-moderate solutions, rather than the one endless
// snaking corridor a recursive backtracker produces.
function carvePerfect(rng) {
  const grid = Array.from({ length: G }, () => new Array(G).fill(1));
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const c = cellG(i, j); grid[c.y][c.x] = 0; }
  const inMaze = new Set(["0,0"]);
  let frontier = [[1, 0, 0, 0], [0, 1, 0, 0]].filter(([a, b]) => a < N && b < N).map(([a, b, pi, pj]) => [a, b, pi, pj]);
  while (frontier.length) {
    const idx = Math.floor(rng() * frontier.length);
    const [i, j, pi, pj] = frontier.splice(idx, 1)[0];
    if (inMaze.has(`${i},${j}`)) continue;
    grid[pj + j + 1][pi + i + 1] = 0; // wall between the frontier cell and its parent
    inMaze.add(`${i},${j}`);
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const a = i + di, b = j + dj;
      if (a>=0&&a<N&&b>=0&&b<N&&!inMaze.has(`${a},${b}`)) frontier.push([a, b, i, j]);
    }
  }
  return grid;
}

const isOpen = (grid, x, y) => y>=0&&y<G&&x>=0&&x<G&&grid[y][x]===0;
const nbrs = (grid, x, y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(grid,c.x,c.y));

function solutionPath(grid, a, b) {
  const prev = {}; const seen = new Set([`${a.x},${a.y}`]); let f = [a];
  while (f.length) {
    const nx = [];
    for (const c of f) {
      if (c.x === b.x && c.y === b.y) {
        const out = []; let cur = `${b.x},${b.y}`;
        while (cur) { const [px, py] = cur.split(",").map(Number); out.unshift({ x: px, y: py }); cur = prev[cur]; }
        return out;
      }
      for (const n of nbrs(grid, c.x, c.y)) { const k = `${n.x},${n.y}`; if (seen.has(k)) continue; seen.add(k); prev[k] = `${c.x},${c.y}`; nx.push(n); }
    }
    f = nx;
  }
  return null;
}

function loopEdges(grid) {
  let cells = 0, edges = 0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) { if (!isOpen(grid,x,y)) continue; cells++; if (isOpen(grid,x+1,y)) edges++; if (isOpen(grid,x,y+1)) edges++; }
  return edges - (cells - 1); // 0 => perfect (no loops)
}

// Depth of each dead-end branch hanging off the solution path (how costly a wrong turn is).
function offPathStats(grid, sol) {
  const onPath = new Set(sol.map((c) => `${c.x},${c.y}`));
  let junctions = 0; const depths = [];
  for (const c of sol) {
    const ns = nbrs(grid, c.x, c.y);
    if (ns.length >= 3) junctions += 1;
    for (const n of ns) {
      if (onPath.has(`${n.x},${n.y}`)) continue;
      // flood the off-path branch to find its depth
      const seen = new Set([`${c.x},${c.y}`, `${n.x},${n.y}`]); let f = [n], d = 1, max = 1;
      while (f.length) { const nx=[]; for (const q of f) for (const m of nbrs(grid,q.x,q.y)) { const k=`${m.x},${m.y}`; if (seen.has(k)||onPath.has(k)) continue; seen.add(k); nx.push(m); } if (nx.length) { d++; max=d; } f=nx; }
      depths.push(max);
    }
  }
  const mean = depths.length ? depths.reduce((s,x)=>s+x,0)/depths.length : 0;
  return { junctions, meanDeadDepth: mean, branches: depths.length };
}

const start = cellG(0, 0);
const goal = cellG(N - 1, N - 1);

let best = null;
for (let seed = 1; seed <= 400; seed += 1) {
  const grid = carvePerfect(mulberry32(seed));
  if (loopEdges(grid) !== 0) continue;                 // must be perfect
  const sol = solutionPath(grid, start, goal);
  if (!sol) continue;
  const st = offPathStats(grid, sol);
  const steps = sol.length - 1;
  if (steps < 45 || steps > 85) continue;              // a trial-sized route, not a marathon
  if (st.junctions < 8) continue;                      // enough decision points
  // Within that band, favour many junctions and costly wrong turns (real complexity).
  const score = 6 * st.junctions + 4 * st.meanDeadDepth + steps * 0.1;
  if (!best || score > best.score) best = { seed, grid, sol, ...st, score };
}

if (!best) { console.error("no maze met the criteria"); process.exit(1); }
const { grid, sol, seed, junctions, meanDeadDepth } = best;
const choke = sol[Math.floor(sol.length / 2)];         // midpoint => guaranteed crossing
const dSC = sol.findIndex((c) => c.x === choke.x && c.y === choke.y);
console.log(`seed=${seed} loops=${loopEdges(grid)} solution=${sol.length - 1} steps | junctions on route=${junctions} | mean dead-end depth=${meanDeadDepth.toFixed(1)}`);
console.log(`choke=(${choke.x},${choke.y})  start->choke=${dSC}  choke->goal=${sol.length - 1 - dSC}`);

const rows = grid.map((r) => r.join(""));
const out = `// Auto-generated by scripts/build-disappear-maze.mjs (seed ${seed}).
// 12x12 PERFECT maze (no loops) for the "AI disappears" condition. Loopless by
// design: with loops the LLM's junction verdicts collapse, loopless it is ~97%
// accurate. Complexity comes from a long winding solution (${sol.length - 1} steps),
// ${junctions} junctions on the route, and dead-end branches ~${meanDeadDepth.toFixed(1)} deep.
// Every solution cell is a cut vertex here, so chokeCell is always crossed.
const WALL_ROWS = [
${rows.map((r) => `  "${r}",`).join("\n")}
];

export const DISAPPEAR_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const DISAPPEAR_MAZE_CONFIG = {
  id: "disappear-12x12",
  name: "12 by 12 AI-disappears maze",
  maze: DISAPPEAR_MAZE_GRID,
  start: { x: ${start.x}, y: ${start.y} },
  entrance: { x: 1, y: 0 },
  startFacing: 1,
  goal: { x: ${goal.x}, y: ${goal.y} },
  chokeCell: { x: ${choke.x}, y: ${choke.y} },
  hintSteps: 3,
  seed: ${seed},
};
`;
fs.writeFileSync(path.join(__dirname, "..", "public", "disappear_maze.js"), out);
console.log("wrote public/disappear_maze.js");
