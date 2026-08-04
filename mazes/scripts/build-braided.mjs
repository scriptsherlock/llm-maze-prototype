// Build a BRAIDED maze: loops, so there are genuinely several routes to the exit,
// but with SHALLOW dead ends so every AI claim stays cheaply provable.
//
//   node mazes/scripts/build-braided.mjs <reference.js> <OUT_NAME> <outFile>
//
// Why shallow dead ends: proving "this branch reaches the exit" only needs one
// traced route (easy, loops irrelevant), but proving "this is a dead end" means
// showing NO route exists — you must enumerate the whole pocket. Cap the pockets in
// the maze design and that proof is trivial, so loops stop costing accuracy.
import fs from "fs";
import path from "path";

const [refPath, outName, outFile, seedFromArg, lateArg, earlyArg] = process.argv.slice(2);
const SEED_FROM = Number(seedFromArg) || 1;
const MIN_LATE_JUNCTIONS = Number(lateArg) || 3;
// Decisions BEFORE the cutoff too, so the assistant is actually established before
// it goes quiet — otherwise its removal is not felt.
const MIN_EARLY_JUNCTIONS = Number(earlyArg) || 0;
if (!refPath || !outName || !outFile) { console.error("usage: build-braided.mjs <reference.js> <OUT_NAME> <outFile>"); process.exit(1); }

const MAX_POCKET = 8;      // dead-end cells reachable off a junction (excluding the way back)
const LOOPS = [5, 10];     // how many extra passages to open
const TRIES = 40;          // random loop-sets per base maze

function mulberry32(a){return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}

// ---- reference maze: match its size, entrance/exit and difficulty ----
const refSrc = fs.readFileSync(refPath, "utf8");
const refRows = refSrc.match(/"[01]+"/g).map((s)=>s.replace(/"/g,""));
const refGrid = refRows.map((r)=>r.split("").map(Number));
const G = refGrid.length, N = (G - 1) / 2;
const cellOf = (k, src) => { const m = src.match(new RegExp(`${k}:\\s*\\{\\s*x:\\s*(\\d+),\\s*y:\\s*(\\d+)`)); return { x:+m[1], y:+m[2] }; };
const start = cellOf("start", refSrc), goal = cellOf("goal", refSrc);
const entryCol = (start.x - 1) / 2, exitCol = (goal.x - 1) / 2;

const isOpen = (g,x,y) => y>=0&&y<G&&x>=0&&x<G&&g[y][x]===0;
const nbrs = (g,x,y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(g,c.x,c.y));
const key = (c) => `${c.x},${c.y}`;

function metrics(g, from, to, blockKey) {
  const d = new Map([[key(from), 0]]);
  if (blockKey) d.set(blockKey, -1);
  let f = [from];
  while (f.length) { const nx=[];
    for (const c of f) for (const n of nbrs(g,c.x,c.y)) { const k=key(n); if (d.has(k)) continue; d.set(k, d.get(key(c))+1); nx.push(n); }
    f = nx; }
  return to ? d.get(key(to)) : d;
}

// Recursive backtracker => long winding solutions, like the reference mazes.
function carve(rng) {
  const g = Array.from({ length: G }, () => new Array(G).fill(1));
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) g[2*j+1][2*i+1] = 0;
  const seen = new Set([`${entryCol},0`]);
  const stack = [[entryCol, 0]];
  while (stack.length) {
    const [i,j] = stack[stack.length-1];
    const opts = [[i+1,j],[i-1,j],[i,j+1],[i,j-1]].filter(([a,b])=>a>=0&&a<N&&b>=0&&b<N&&!seen.has(`${a},${b}`));
    if (!opts.length) { stack.pop(); continue; }
    const [a,b] = opts[Math.floor(rng()*opts.length)];
    g[j+b+1][i+a+1] = 0; seen.add(`${a},${b}`); stack.push([a,b]);
  }
  g[0][2*entryCol+1] = 0;
  g[2*N][2*exitCol+1] = 0;
  return g;
}

function candidates(g) {
  const out = [];
  for (let y=1;y<G-1;y++) for (let x=1;x<G-1;x++) {
    if (g[y][x] !== 1) continue;
    // Only the wall BETWEEN two cells may be opened. Corner posts (even,even) must
    // stay solid — opening one merges cells into a 2x2 room instead of a corridor.
    if ((x % 2 === 0) === (y % 2 === 0)) continue;
    const h = isOpen(g,x-1,y) && isOpen(g,x+1,y) && !isOpen(g,x,y-1) && !isOpen(g,x,y+1);
    const v = isOpen(g,x,y-1) && isOpen(g,x,y+1) && !isOpen(g,x-1,y) && !isOpen(g,x+1,y);
    if (h || v) out.push({ x, y });
  }
  return out;
}

function analyse(g) {
  let junctions = 0, multiRoute = 0, maxPocket = 0, deadEnds = 0;
  // Real cells only (odd,odd) — matches how analyse.mjs and the game count junctions.
  for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) {
    if (!isOpen(g,x,y)) continue;
    const ns = nbrs(g,x,y);
    if (ns.length < 3) continue;
    junctions++;
    const jk = `${x},${y}`;
    const dm = metrics(g, goal, null, jk);
    let reaching = 0;
    for (const b of ns) {
      const v = dm.get(key(b));
      if (v != null && v >= 0) { reaching++; continue; }
      // dead-end pocket: flood it, ignoring the side that contains the start
      const seen = new Set([jk, key(b)]); const cells=[b]; const st=[b];
      while (st.length) { const c = st.pop();
        for (const n of nbrs(g,c.x,c.y)) { const k=key(n); if (seen.has(k)) continue; seen.add(k); cells.push(n); st.push(n); } }
      if (cells.some((c)=>c.x===start.x&&c.y===start.y)) continue;  // the way back in
      deadEnds++;
      const size = Math.round(cells.length / 2);   // in cells, not grid squares
      if (size > maxPocket) maxPocket = size;
    }
    if (reaching >= 2) multiRoute++;
  }
  return { junctions, multiRoute, maxPocket, deadEnds };
}

// Where the AI stops in the "disappear" condition, and how many decision points sit
// on each side of it. If the route has no junctions after the cutoff the participant
// never gets a chance to notice the AI has gone quiet.
function routeJunctionSplit(g) {
  const prev = {}, seen = new Set([key(start)]);
  let f = [start], route = null;
  while (f.length && !route) {
    const nx = [];
    for (const c of f) {
      if (key(c) === key(goal)) { route = []; let cur = key(c); while (cur) { const [a,b] = cur.split(",").map(Number); route.unshift({x:a,y:b}); cur = prev[cur]; } break; }
      for (const n of nbrs(g,c.x,c.y)) { const k = key(n); if (seen.has(k)) continue; seen.add(k); prev[k] = key(c); nx.push(n); }
    }
    f = nx;
  }
  if (!route) return { before: 0, after: 0, total: 0 };
  const dGoal = metrics(g, goal);
  const startDist = dGoal.get(key(start));
  const cutoff = Math.floor(startDist * 0.5);
  const cutIdx = route.findIndex((c) => dGoal.get(key(c)) <= cutoff);
  const isJ = (c) => nbrs(g,c.x,c.y).length >= 3;
  let before = 0, after = 0;
  route.forEach((c, i) => { if (!isJ(c)) return; if (i < cutIdx) before += 1; else after += 1; });
  return { before, after, total: before + after, cutIdx, routeLen: route.length - 1 };
}

function loopCount(g) {
  let cells=0, edges=0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) { if (!isOpen(g,x,y)) continue; cells++; if (isOpen(g,x+1,y)) edges++; if (isOpen(g,x,y+1)) edges++; }
  return edges - (cells - 1);
}

// reference difficulty to match
const refSolution = metrics(refGrid, start, goal);
const refA = (() => { const saved = { isOpen }; return analyse(refGrid); })();
console.log(`reference ${path.basename(refPath)}: ${N}x${N}, solution ${refSolution}, junctions ${refA.junctions}`);

let best = null;
for (let seed = SEED_FROM; seed <= SEED_FROM + 4000 && !best; seed += 1) {
  const base = carve(mulberry32(seed));
  const cands = candidates(base);
  if (cands.length < LOOPS[1]) continue;
  const rng = mulberry32(seed * 6151 + 17);
  for (let t = 0; t < TRIES; t += 1) {
    const g = base.map((r)=>r.slice());
    const n = LOOPS[0] + Math.floor(rng() * (LOOPS[1] - LOOPS[0] + 1));
    for (const w of [...cands].sort(()=>rng()-0.5).slice(0, n)) g[w.y][w.x] = 0;

    const sol = metrics(g, start, goal);
    if (sol == null) continue;
    if (sol < refSolution - 12 || sol > refSolution + 12) continue;     // similar length
    const a = analyse(g);
    if (a.maxPocket > MAX_POCKET) continue;                            // keep proofs cheap
    if (a.multiRoute < 4) continue;                                    // real alternatives
    if (Math.abs(a.junctions - refA.junctions) > 5) continue;          // similar branchiness
    const split = routeJunctionSplit(g);
    if (split.after < MIN_LATE_JUNCTIONS) continue;                    // decisions after the AI goes
    if (split.before < MIN_EARLY_JUNCTIONS) continue;                  // and enough before it
    best = { seed, g, sol, cost: 0, ...a, split };
    break;
  }
}

if (!best) { console.error("nothing met the targets — relax MAX_POCKET or LOOPS"); process.exit(1); }
const { g, seed, sol, junctions, multiRoute, maxPocket, deadEnds } = best;
console.log(`braided  ${outName}: solution ${sol}, junctions ${junctions}, loops ${loopCount(g)}, multi-route ${multiRoute}, dead ends ${deadEnds} (max pocket ${maxPocket})  [seed ${seed}]`);
console.log(`  junctions on the route: ${best.split.total}  ->  ${best.split.before} before the AI cutoff, ${best.split.after} AFTER it (cutoff at step ${best.split.cutIdx} of ${best.split.routeLen})`);

fs.writeFileSync(outFile, `// Auto-generated by mazes/scripts/build-braided.mjs (seed ${seed}).
// BRAIDED ${N}x${N} maze: ${loopCount(g)} loops give genuinely several routes to the exit
// (${multiRoute} junctions have more than one branch that reaches it), while dead-end
// pockets are capped at ${maxPocket} cells so the AI can still prove every claim cheaply.
// Matched to ${path.basename(refPath)}: solution ${sol} vs ${refSolution}, junctions ${junctions} vs ${refA.junctions}.
const WALL_ROWS = [
${g.map((r)=>`  "${r.join("")}",`).join("\n")}
];

export const ${outName}_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const ${outName}_MAZE_CONFIG = {
  id: "${outName.toLowerCase().replace(/_/g,"-")}-${N}x${N}",
  name: "${N} by ${N} braided maze",
  maze: ${outName}_MAZE_GRID,
  start: { x: ${start.x}, y: ${start.y} },
  entrance: { x: ${start.x}, y: 0 },
  startFacing: 2,
  goal: { x: ${goal.x}, y: ${goal.y} },
  hintSteps: 3,
  seed: ${seed},
};
`);
console.log(`wrote ${outFile}`);
