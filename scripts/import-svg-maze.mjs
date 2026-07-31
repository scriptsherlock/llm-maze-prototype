// Convert a mazegenerator.net SVG into the app's (2N+1) wall grid — exactly, from
// the line coordinates, so nothing is transcribed by eye.
//
//   node scripts/import-svg-maze.mjs <input.svg> <OUT_NAME> [outFile]
//   e.g. node scripts/import-svg-maze.mjs assets/mazes/10x10-orthogonal.svg NO_AI
//
// The SVG draws walls as <line>s on a lattice: gridline k sits at 2 + 16k, so cell
// (i,j) spans x 2+16i .. 2+16(i+1). The single gaps in the top and bottom borders are
// the entrance and the exit.
import fs from "fs";
import path from "path";

const [svgPath, outName, outFileArg] = process.argv.slice(2);
if (!svgPath || !outName) { console.error("usage: import-svg-maze.mjs <input.svg> <OUT_NAME> [outFile]"); process.exit(1); }

const svg = fs.readFileSync(svgPath, "utf8");
const lines = [...svg.matchAll(/<line\s+x1="(\d+)"\s+y1="(\d+)"\s+x2="(\d+)"\s+y2="(\d+)"/g)]
  .map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
if (!lines.length) { console.error("no <line> elements found"); process.exit(1); }

// Infer the lattice: origin = smallest coord, pitch = smallest gap between gridlines.
const coords = [...new Set(lines.flatMap((l) => [l.x1, l.x2, l.y1, l.y2]))].sort((a,b)=>a-b);
const origin = coords[0];
let pitch = Infinity;
for (let i = 1; i < coords.length; i += 1) pitch = Math.min(pitch, coords[i] - coords[i-1]);
const maxCoord = coords[coords.length - 1];
const N = Math.round((maxCoord - origin) / pitch);          // cells per axis
const G = 2 * N + 1;
const idx = (v) => Math.round((v - origin) / pitch);        // coordinate -> gridline index
console.log(`lattice: origin=${origin} pitch=${pitch} => ${N}x${N} cells, ${G}x${G} display grid`);

// Start all walls, open the cells, then knock through where no wall line covers.
const g = Array.from({ length: G }, () => new Array(G).fill(1));
for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) g[2*j+1][2*i+1] = 0;

// Mark the wall segments the SVG actually draws.
const drawn = new Set();
for (const l of lines) {
  if (l.y1 === l.y2) {                       // horizontal wall along gridline row jy
    const jy = idx(l.y1);
    for (let i = idx(Math.min(l.x1,l.x2)); i < idx(Math.max(l.x1,l.x2)); i += 1) drawn.add(`h:${i}:${jy}`);
  } else if (l.x1 === l.x2) {                // vertical wall along gridline col ix
    const ix = idx(l.x1);
    for (let j = idx(Math.min(l.y1,l.y2)); j < idx(Math.max(l.y1,l.y2)); j += 1) drawn.add(`v:${ix}:${j}`);
  }
}

// Open every wall slot the SVG did NOT draw (that is a passage).
for (let i = 0; i < N; i += 1) for (let jy = 0; jy <= N; jy += 1) {
  if (!drawn.has(`h:${i}:${jy}`)) g[2*jy][2*i+1] = 0;       // between (i,jy-1) and (i,jy)
}
for (let ix = 0; ix <= N; ix += 1) for (let j = 0; j < N; j += 1) {
  if (!drawn.has(`v:${ix}:${j}`)) g[2*j+1][2*ix] = 0;       // between (ix-1,j) and (ix,j)
}

// Entrance / exit = the open slots on the top and bottom borders.
const openTop = [], openBottom = [];
for (let i = 0; i < N; i += 1) {
  if (g[0][2*i+1] === 0) openTop.push(i);
  if (g[2*N][2*i+1] === 0) openBottom.push(i);
}
console.log(`entrance column(s): ${JSON.stringify(openTop)}   exit column(s): ${JSON.stringify(openBottom)}`);
if (openTop.length !== 1 || openBottom.length !== 1) console.warn("WARNING: expected exactly one gap top and bottom");

const entrance = { x: 2*openTop[0] + 1, y: 0 };
const start = { x: entrance.x, y: 1 };
const goal = { x: 2*openBottom[0] + 1, y: 2*N };

// ---- checks: solvable, and how complex is it ----
const isOpen = (x,y) => y>=0&&y<G&&x>=0&&x<G&&g[y][x]===0;
const nbrs = (x,y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(c.x,c.y));
function dist(a,b){const seen=new Set([`${a.x},${a.y}`]);let f=[a],d=0;
  while(f.length){d++;const nx=[];for(const c of f)for(const n of nbrs(c.x,c.y)){if(n.x===b.x&&n.y===b.y)return d;const k=`${n.x},${n.y}`;if(seen.has(k))continue;seen.add(k);nx.push(n);}f=nx;}return Infinity;}
let cells=0, edges=0, junctions=0;
for (let y=0;y<G;y++) for (let x=0;x<G;x++) {
  if (!isOpen(x,y)) continue; cells++;
  if (isOpen(x+1,y)) edges++; if (isOpen(x,y+1)) edges++;
  if (nbrs(x,y).length >= 3) junctions++;
}
const solution = dist(start, goal);
const loops = edges - (cells - 1);
console.log(`solvable: ${solution !== Infinity}   solution: ${solution} steps`);
console.log(`open cells: ${cells}   loops: ${loops} ${loops === 0 ? "(perfect maze)" : ""}   junctions: ${junctions}`);

const outFile = outFileArg || path.join("public", `${outName.toLowerCase()}_maze.js`);
const rows = g.map((r) => r.join(""));
fs.writeFileSync(outFile, `// Imported from ${path.basename(svgPath)} by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// ${N}x${N} cells => ${G}x${G} display grid. Solution ${solution} steps, ${junctions} junctions, ${loops} loops.
const WALL_ROWS = [
${rows.map((r)=>`  "${r}",`).join("\n")}
];

export const ${outName}_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const ${outName}_MAZE_CONFIG = {
  id: "${outName.toLowerCase()}-${N}x${N}",
  name: "${N} by ${N} orthogonal maze",
  maze: ${outName}_MAZE_GRID,
  start: { x: ${start.x}, y: ${start.y} },
  entrance: { x: ${entrance.x}, y: ${entrance.y} },
  startFacing: 2,
  goal: { x: ${goal.x}, y: ${goal.y} },
  hintSteps: 3,
  seed: 0,
};
`);
console.log(`wrote ${outFile}`);
