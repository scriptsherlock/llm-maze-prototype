// Generate the 12x12 LOOPED "AI disappears" maze.
//
// Goal: bring back multiple valid routes (so the AI can show several shaded arrows)
// without the accuracy collapse that random braiding caused. Three design rules:
//   1. Two chambers joined by ONE divider passage (the choke). Loops live inside a
//      chamber, never across the divider, so the choke stays a cut vertex by
//      construction — every route still crosses it.
//   2. Loops are added deliberately, and kept only when they create junctions where
//      two branches both reach the exit with a SUBTLE length difference.
//   3. Dead-end pockets stay SMALL: with loops, a dead end can only be proven by
//      enumerating its whole region, so huge pockets would be unprovable.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const N = 12;                 // cells per axis
const G = 2 * N + 1;          // display grid (25)
const DIV = N / 2;            // first cell column of the right chamber
const LOOPS = [4, 8];         // how many extra passages to open
const MAX_POCKET = 14;        // dead-end region cells: keeps AI proofs cheap
const SUBTLE = [2, 6];        // wanted |difference| between the two best routes
const TRIES = 24;             // random loop-sets tried per base maze
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(a){return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const cellG = (i, j) => ({ x: 2 * i + 1, y: 2 * j + 1 });
const isOpen = (g, x, y) => y>=0&&y<G&&x>=0&&x<G&&g[y][x]===0;
const nbrs = (g, x, y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(g,c.x,c.y));
const key = (c) => `${c.x},${c.y}`;

// Randomized Prim's inside one chamber => perfect, low-river, shallow dead ends.
function carveChamber(g, iLo, iHi, rng) {
  const inMaze = new Set([`${iLo},0`]);
  const frontier = [];
  const push = (i, j, pi, pj) => { if (i>=iLo&&i<=iHi&&j>=0&&j<N&&!inMaze.has(`${i},${j}`)) frontier.push([i,j,pi,pj]); };
  push(iLo+1, 0, iLo, 0); push(iLo, 1, iLo, 0);
  while (frontier.length) {
    const [i, j, pi, pj] = frontier.splice(Math.floor(rng()*frontier.length), 1)[0];
    if (inMaze.has(`${i},${j}`)) continue;
    g[pj + j + 1][pi + i + 1] = 0;
    inMaze.add(`${i},${j}`);
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) push(i+di, j+dj, i, j);
  }
}

function baseMaze(seed, chokeJ) {
  const rng = mulberry32(seed);
  const g = Array.from({ length: G }, () => new Array(G).fill(1));
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) { const c=cellG(i,j); g[c.y][c.x]=0; }
  carveChamber(g, 0, DIV-1, rng);
  carveChamber(g, DIV, N-1, rng);
  const choke = { x: 2*DIV, y: 2*chokeJ + 1 };   // the single divider passage
  g[choke.y][choke.x] = 0;
  g[0][1] = 0;                                    // entrance above the start
  return { g, choke, rng };
}

const start = cellG(0, 0);
const goal = cellG(N-1, N-1);

// Distances from `src` to every open cell, optionally with one cell blocked.
function distMap(g, src, blockKey) {
  const d = new Map([[key(src), 0]]);
  let f = [src];
  while (f.length) {
    const nx = [];
    for (const c of f) for (const n of nbrs(g, c.x, c.y)) {
      const k = key(n);
      if (k === blockKey || d.has(k)) continue;
      d.set(k, d.get(key(c)) + 1); nx.push(n);
    }
    f = nx;
  }
  return d;
}
function region(g, junction, branch) {
  const seen = new Set([key(junction), key(branch)]);
  const out = [branch], st = [branch];
  while (st.length) { const c = st.pop();
    for (const n of nbrs(g,c.x,c.y)) { const k = key(n); if (seen.has(k)) continue; seen.add(k); out.push(n); st.push(n); } }
  return out;
}
function loopCount(g) {
  let cells=0, edges=0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) { if (!isOpen(g,x,y)) continue; cells++; if (isOpen(g,x+1,y)) edges++; if (isOpen(g,x,y+1)) edges++; }
  return edges - (cells - 1);
}

// One BFS per junction (goal-side, junction blocked) tells us every branch at once.
function analyse(g) {
  const junctions = [];
  let maxPocket = 0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) {
    if (!isOpen(g,x,y)) continue;
    const ns = nbrs(g,x,y); if (ns.length < 3) continue;
    const jk = `${x},${y}`;
    const dm = distMap(g, goal, jk);
    const routes = [], pockets = [];
    for (const b of ns) {
      const d = dm.get(key(b));
      if (d == null) {
        const cells = region(g, {x,y}, b);
        // A "pocket" containing the START is really the way you came in — the cue
        // never offers it, and the AI is never asked to prove it. Only genuine side
        // pockets have to be small enough for the AI to enumerate.
        const isBackwards = cells.some((c) => c.x === start.x && c.y === start.y);
        pockets.push(cells.length);
        if (!isBackwards && cells.length > maxPocket) maxPocket = cells.length;
      }
      else routes.push(d + 1);
    }
    routes.sort((p,q)=>p-q);
    junctions.push({ x, y, routes, pockets });
  }
  const multi = junctions.filter((j) => j.routes.length >= 2);
  const subtle = multi.filter((j) => { const d = j.routes[1]-j.routes[0]; return d >= SUBTLE[0] && d <= SUBTLE[1]; });
  return { junctions, multi, subtle, maxPocket };
}

// Walls whose removal creates a loop INSIDE one chamber (never the divider).
function candidates(g) {
  const out = [];
  for (let y=1;y<G-1;y++) for (let x=1;x<G-1;x++) {
    if (g[y][x] !== 1) continue;
    if (x === 2*DIV) continue;                                   // never breach the divider
    const h = isOpen(g,x-1,y) && isOpen(g,x+1,y) && !isOpen(g,x,y-1) && !isOpen(g,x,y+1);
    const v = isOpen(g,x,y-1) && isOpen(g,x,y+1) && !isOpen(g,x-1,y) && !isOpen(g,x+1,y);
    if (h || v) out.push({ x, y });
  }
  return out;
}

let best = null;
for (let seed = 1; seed <= 120 && !best; seed += 1) {
  for (const chokeJ of [5, 6]) {
    const base = baseMaze(seed, chokeJ);
    if (distMap(base.g, start).get(key(goal)) == null) continue;
    const cands = candidates(base.g);
    if (cands.length < LOOPS[1]) continue;
    const rng = mulberry32(seed * 7919 + chokeJ);

    for (let t = 0; t < TRIES; t += 1) {
      const g = base.g.map((r) => r.slice());
      const pick = [...cands].sort(() => rng() - 0.5).slice(0, LOOPS[0] + Math.floor(rng() * (LOOPS[1] - LOOPS[0] + 1)));
      for (const w of pick) g[w.y][w.x] = 0;

      const sol = distMap(g, start).get(key(goal));
      if (sol == null || sol < 40 || sol > 90) continue;          // trial-sized route
      const a = analyse(g);
      if (a.maxPocket > MAX_POCKET) continue;                     // dead ends stay provable
      if (a.subtle.length < 4) continue;                          // enough real judgement calls
      // The choke must still be the only way across.
      const cut = g.map((r)=>r.slice()); cut[base.choke.y][base.choke.x] = 1;
      if (distMap(cut, start).get(key(goal)) != null) continue;
      const dSC = distMap(g, start).get(key(base.choke));
      const dCG = distMap(g, base.choke).get(key(goal));
      const ratio = dSC / (dSC + dCG);
      if (ratio < 0.38 || ratio > 0.62) continue;                 // AI on for roughly half
      const score = a.subtle.length * 3 + a.multi.length;
      if (!best || score > best.score) best = { seed, chokeJ, g, choke: base.choke, added: pick.length, sol, dSC, dCG, score, ...a };
    }
    if (best) break;
  }
}

if (!best) { console.error("no looped maze met the criteria — relax LOOPS/SUBTLE/MAX_POCKET"); process.exit(1); }
const { g, choke, seed, added, sol, dSC, dCG, multi, subtle, maxPocket, junctions } = best;
const diffs = subtle.map((j) => j.routes[1]-j.routes[0]).sort((a,b)=>a-b);
console.log(`seed=${seed}  loops=${loopCount(g)} (${added} opened)  solution=${sol} steps`);
console.log(`junctions=${junctions.length}  multi-route=${multi.length}  subtle(${SUBTLE[0]}-${SUBTLE[1]} apart)=${subtle.length}`);
console.log(`route differences at subtle junctions: ${JSON.stringify(diffs)}`);
console.log(`largest dead-end pocket=${maxPocket} cells (cap ${MAX_POCKET})`);
console.log(`choke=(${choke.x},${choke.y})  start->choke=${dSC}  choke->goal=${dCG}`);

const rows = g.map((r)=>r.join(""));
const out = `// Auto-generated by scripts/build-looped-maze.mjs (seed ${seed}).
// 12x12 LOOPED maze for the "AI disappears" condition.
// Two chambers joined by ONE divider passage (chokeCell): loops are confined inside
// a chamber, so the choke stays a cut vertex and every route crosses it.
// ${added} extra passages give ${multi.length} junctions with more than one valid route
// (${subtle.length} of them a subtle ${SUBTLE[0]}-${SUBTLE[1]} step judgement call), while dead-end
// pockets stay <= ${maxPocket} cells so the AI can still prove them by enumeration.
const WALL_ROWS = [
${rows.map((r)=>`  "${r}",`).join("\n")}
];

export const LOOPED_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const LOOPED_MAZE_CONFIG = {
  id: "looped-12x12",
  name: "12 by 12 looped AI-disappears maze",
  maze: LOOPED_MAZE_GRID,
  start: { x: ${start.x}, y: ${start.y} },
  entrance: { x: 1, y: 0 },
  startFacing: 1,
  goal: { x: ${goal.x}, y: ${goal.y} },
  chokeCell: { x: ${choke.x}, y: ${choke.y} },
  hintSteps: 3,
  seed: ${seed},
};
`;
fs.writeFileSync(path.join(__dirname, "..", "public", "looped_maze.js"), out);
console.log("wrote public/looped_maze.js");
