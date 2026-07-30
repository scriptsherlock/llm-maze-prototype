// Generate a 10x10 "AI disappears" maze: two braided chambers (loops => multiple
// valid routes) joined by a SINGLE central passage (the choke). The choke is a cut
// vertex, so every start->goal path crosses it — that's where the AI cuts off.
// Seeded + validated (solvable, choke really is a cut vertex, enough multi-valid
// junctions, balanced split). Writes public/disappear_10x10_maze.js.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const N = 10;                 // cells per axis
const G = 2 * N + 1;          // grid size (21)
const DIV = N / 2;            // cell column index splitting the chambers (5)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cellG = (i, j) => ({ x: 2 * i + 1, y: 2 * j + 1 });

function carve(grid, iLo, iHi, rng) {
  const seen = new Set();
  const startI = iLo, startJ = 0;
  const stack = [[startI, startJ]]; seen.add(`${startI},${startJ}`);
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = [[i+1,j],[i-1,j],[i,j+1],[i,j-1]].filter(([a,b]) => a>=iLo&&a<=iHi&&b>=0&&b<N&&!seen.has(`${a},${b}`));
    if (!opts.length) { stack.pop(); continue; }
    const [a, b] = opts[Math.floor(rng() * opts.length)];
    grid[j + b + 1][i + a + 1] = 0; // knock the wall between the two cells
    seen.add(`${a},${b}`); stack.push([a, b]);
  }
}

// Braid: remove dead-ends by opening one extra in-chamber wall, creating loops.
function braid(grid, iLo, iHi, rng, prob) {
  for (let i = iLo; i <= iHi; i += 1) for (let j = 0; j < N; j += 1) {
    const c = cellG(i, j);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const open = dirs.filter(([dx,dy]) => grid[c.y+dy][c.x+dx] === 0);
    if (open.length !== 1) continue;           // only dead-ends
    if (rng() > prob) continue;
    const closed = dirs.filter(([dx,dy]) => grid[c.y+dy][c.x+dx] === 1)
      .filter(([dx,dy]) => { const ni = i+dx, nj = j+dy; return ni>=iLo&&ni<=iHi&&nj>=0&&nj<N; });
    if (!closed.length) continue;
    const [dx,dy] = closed[Math.floor(rng() * closed.length)];
    grid[c.y+dy][c.x+dx] = 0;
  }
}

const isOpen = (grid, x, y) => y>=0&&y<G&&x>=0&&x<G&&grid[y][x]===0;
const nbrs = (grid, x, y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(grid,c.x,c.y));
function dist(grid, a, b) {
  const seen = new Set([`${a.x},${a.y}`]); let f=[{...a,d:0}];
  while (f.length){const nx=[];for(const c of f){if(c.x===b.x&&c.y===b.y)return c.d;for(const n of nbrs(grid,c.x,c.y)){const k=`${n.x},${n.y}`;if(seen.has(k))continue;seen.add(k);nx.push({...n,d:c.d+1});}}f=nx;}
  return Infinity;
}
function reaches(grid, from, blocked, goal) {
  const seen = new Set([`${from.x},${from.y}`, blocked]); let f=[from];
  while (f.length){const nx=[];for(const c of f)for(const n of nbrs(grid,c.x,c.y)){if(n.x===goal.x&&n.y===goal.y)return true;const k=`${n.x},${n.y}`;if(seen.has(k))continue;seen.add(k);nx.push(n);}f=nx;}
  return false;
}
function multiValidJunctions(grid, goal) {
  let count = 0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) {
    if (!isOpen(grid,x,y)) continue;
    const ns = nbrs(grid,x,y); if (ns.length < 3) continue;
    const valid = ns.filter((n)=>reaches(grid,n,`${x},${y}`,goal)).length;
    if (valid >= 2) count += 1;
  }
  return count;
}

function build(seed, chokeJ) {
  const rng = mulberry32(seed);
  const grid = Array.from({ length: G }, () => new Array(G).fill(1));
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) { const c=cellG(i,j); grid[c.y][c.x]=0; }
  carve(grid, 0, DIV - 1, rng);       // left chamber (cells 0..4)
  carve(grid, DIV, N - 1, rng);       // right chamber (cells 5..9)
  braid(grid, 0, DIV - 1, rng, 0.9);
  braid(grid, DIV, N - 1, rng, 0.9);
  // choke: the ONLY gap in the divider, between cell (DIV-1,chokeJ) and (DIV,chokeJ)
  const choke = { x: DIV + DIV, y: 2 * chokeJ + 1 }; // grid x = (DIV-1)+DIV+1 = 2*DIV = 10
  grid[choke.y][choke.x] = 0;
  grid[0][1] = 0; // entrance opening above the start
  return { grid, choke };
}

const start = cellG(0, 0);          // (1,1) top-left of left chamber
const goal = cellG(N - 1, N - 1);   // (19,19) bottom-right of right chamber

let chosen = null;
outer:
for (let seed = 1; seed <= 5000 && !chosen; seed += 1) {
  for (const chokeJ of [5, 4, 6, 3, 7]) {
    const { grid, choke } = build(seed, chokeJ);
    if (dist(grid, start, goal) === Infinity) continue;              // solvable
    const withoutChoke = grid.map((r) => r.slice()); withoutChoke[choke.y][choke.x] = 1;
    if (dist(withoutChoke, start, goal) !== Infinity) continue;      // choke must be a cut vertex
    const dSC = dist(grid, start, choke), dCG = dist(grid, choke, goal), tot = dSC + dCG;
    const ratio = dSC / tot;
    if (ratio < 0.38 || ratio > 0.6) continue;                      // balanced split
    const mv = multiValidJunctions(grid, goal);
    if (mv < 6) continue;                                            // enough real forks
    chosen = { seed, chokeJ, grid, choke, dSC, dCG, mv, ratio };
    break outer;
  }
}

if (!chosen) { console.error("No valid maze found — widen the search."); process.exit(1); }
const { grid, choke, seed, dSC, dCG, mv, ratio } = chosen;
const rows = grid.map((r) => r.join(""));
console.log(`seed=${seed} choke=(${choke.x},${choke.y}) start->choke=${dSC} choke->goal=${dCG} ratio=${ratio.toFixed(2)} multiValidJunctions=${mv}`);

const out = `// Auto-generated by scripts/build-disappear-maze.mjs (seed ${seed}).
// 10x10 "AI disappears" maze: two braided chambers (loops => multiple valid routes)
// joined by ONE central passage (chokeCell). The choke is a cut vertex, so every
// route from start to goal crosses it — the AI's hints stop once the player passes it.
const WALL_ROWS = [
${rows.map((r) => `  "${r}",`).join("\n")}
];

export const DISAPPEAR_10X10_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const DISAPPEAR_10X10_MAZE_CONFIG = {
  id: "disappear-10x10",
  name: "10 by 10 AI-disappears maze",
  maze: DISAPPEAR_10X10_MAZE_GRID,
  start: { x: ${start.x}, y: ${start.y} },
  entrance: { x: 1, y: 0 },
  startFacing: 1,
  goal: { x: ${goal.x}, y: ${goal.y} },
  chokeCell: { x: ${choke.x}, y: ${choke.y} },
  hintSteps: 3,
  seed: ${seed},
};
`;
fs.writeFileSync(path.join(__dirname, "..", "public", "disappear_10x10_maze.js"), out);
console.log("wrote public/disappear_10x10_maze.js");
