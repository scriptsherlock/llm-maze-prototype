// Shared maze maths for the matched set of eight.
//
// Grid encoding is the same (2N+1) thin-wall scheme the rest of the project uses:
// (odd,odd) are real cells, (even,odd)/(odd,even) are the wall tracks between them,
// (even,even) are corner posts that must never be opened — opening one merges four
// cells into a 2x2 room instead of a corridor.
export const N = 10;
export const G = 2 * N + 1;
export const ENTRY_COL = 4;
export const EXIT_COL = 5;
export const START = { x: 2 * ENTRY_COL + 1, y: 1 };
export const GOAL = { x: 2 * EXIT_COL + 1, y: 2 * N };

export const key = (c) => `${c.x},${c.y}`;
export const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const isOpen = (g, x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
export const nbrs = (g, x, y) => [[0,-1],[1,0],[0,1],[-1,0]]
  .map(([dx,dy]) => ({ x: x+dx, y: y+dy })).filter((c) => isOpen(g, c.x, c.y));

// Distances from `from`, optionally with one cell walled off.
export function dmap(g, from, blockKey) {
  const d = new Map([[key(from), 0]]);
  if (blockKey) d.set(blockKey, -1);
  let f = [from];
  while (f.length) {
    const nx = [];
    for (const c of f) for (const n of nbrs(g, c.x, c.y)) {
      const k = key(n);
      if (d.has(k)) continue;
      d.set(k, d.get(key(c)) + 1);
      nx.push(n);
    }
    f = nx;
  }
  return d;
}

// Recursive backtracker: long winding corridors, like the existing mazes.
export function carve(rng) {
  const g = Array.from({ length: G }, () => new Array(G).fill(1));
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) g[2*j+1][2*i+1] = 0;
  const seen = new Set([`${ENTRY_COL},0`]);
  const stack = [[ENTRY_COL, 0]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = [[i+1,j],[i-1,j],[i,j+1],[i,j-1]]
      .filter(([a,b]) => a >= 0 && a < N && b >= 0 && b < N && !seen.has(`${a},${b}`));
    if (!opts.length) { stack.pop(); continue; }
    const [a, b] = opts[Math.floor(rng() * opts.length)];
    g[j+b+1][i+a+1] = 0;
    seen.add(`${a},${b}`);
    stack.push([a, b]);
  }
  g[0][2*ENTRY_COL+1] = 0;        // entrance gap
  g[2*N][2*EXIT_COL+1] = 0;       // exit gap
  return g;
}

// Walls that may be opened to create a loop: only the track BETWEEN two cells.
export function candidates(g) {
  const out = [];
  for (let y = 1; y < G-1; y += 1) for (let x = 1; x < G-1; x += 1) {
    if (g[y][x] !== 1) continue;
    if ((x % 2 === 0) === (y % 2 === 0)) continue;   // never a corner post
    const h = isOpen(g,x-1,y) && isOpen(g,x+1,y) && !isOpen(g,x,y-1) && !isOpen(g,x,y+1);
    const v = isOpen(g,x,y-1) && isOpen(g,x,y+1) && !isOpen(g,x-1,y) && !isOpen(g,x+1,y);
    if (h || v) out.push({ x, y });
  }
  return out;
}

export function loopCount(g) {
  let cells = 0, edges = 0;
  for (let y = 0; y < G; y += 1) for (let x = 0; x < G; x += 1) {
    if (!isOpen(g, x, y)) continue;
    cells += 1;
    if (isOpen(g, x+1, y)) edges += 1;
    if (isOpen(g, x, y+1)) edges += 1;
  }
  return edges - (cells - 1);
}

// The numbers the brief is written in.
//   branchPoints  cells with 3+ ways out
//   choicePoints  branch points where 2+ ways out independently reach the exit,
//                 i.e. where there really is more than one correct path
//   pathLength    shortest route, in player moves
export function profile(g) {
  let branchPoints = 0, choicePoints = 0, maxPocket = 0, deadEndBranches = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (!isOpen(g, x, y)) continue;
    const ns = nbrs(g, x, y);
    if (ns.length < 3) continue;
    branchPoints += 1;
    const jk = `${x},${y}`;
    const dm = dmap(g, GOAL, jk);
    let reaching = 0;
    for (const b of ns) {
      const v = dm.get(key(b));
      if (v != null && v >= 0) { reaching += 1; continue; }
      const seen = new Set([jk, key(b)]);
      const cells = [b], st = [b];
      while (st.length) {
        const c = st.pop();
        for (const n of nbrs(g, c.x, c.y)) {
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k); cells.push(n); st.push(n);
        }
      }
      if (cells.some((c) => c.x === START.x && c.y === START.y)) continue;  // the way back out
      deadEndBranches += 1;
      const size = Math.round(cells.length / 2);
      if (size > maxPocket) maxPocket = size;
    }
    if (reaching >= 2) choicePoints += 1;
  }
  const pathLength = dmap(g, START).get(key(GOAL));
  return { pathLength, branchPoints, choicePoints, loops: loopCount(g), deadEndBranches, maxPocket };
}


// ---- blocks ----------------------------------------------------------------
// Two things read in the first-person view as a block rather than a wall:
//   a hedge run only one cell long, standing between two gaps
//   a corner post with open track on all four sides, holding nothing up
//
// Neither can be avoided while carving. A perfect maze has no orphaned posts at all
// (one needs a cycle, and a spanning tree has none) but averages 24 one-cell runs,
// and braiding adds the posts. Greedy repair does not work either: opening a stub
// orphans a post, re-attaching that post lays a fresh stub, and the two chase each
// other -- measured, 98.6% of mazes never settled, and extend-only failed outright.
//
// Hill-climbing does work, because it accepts a move that leaves the count unchanged
// and so can cross the flat ground the greedy version got stuck on.
export function countBlocks(g) {
  let bad = 0;
  const w = (x, y) => g[y][x] === 1;
  for (let x = 2; x < G-1; x += 2) {
    let r = 0;
    for (let y = 1; y < G; y += 2) { if (w(x,y)) r += 1; else { if (r === 1) bad += 1; r = 0; } }
    if (r === 1) bad += 1;
  }
  for (let y = 2; y < G-1; y += 2) {
    let r = 0;
    for (let x = 1; x < G; x += 2) { if (w(x,y)) r += 1; else { if (r === 1) bad += 1; r = 0; } }
    if (r === 1) bad += 1;
  }
  for (let y = 2; y < G-1; y += 2) for (let x = 2; x < G-1; x += 2)
    if (g[y][x] === 1 && isOpen(g,x-1,y) && isOpen(g,x+1,y) && isOpen(g,x,y-1) && isOpen(g,x,y+1)) bad += 1;
  return bad;
}

function fullyConnected(g) {
  let total = 0;
  for (let y = 0; y < G; y += 1) for (let x = 0; x < G; x += 1) if (isOpen(g, x, y)) total += 1;
  const seen = new Set([key(START)]);
  let f = [START];
  while (f.length) {
    const nx = [];
    for (const c of f) for (const n of nbrs(g, c.x, c.y)) {
      if (seen.has(key(n))) continue;
      seen.add(key(n)); nx.push(n);
    }
    f = nx;
  }
  return seen.size === total && seen.has(key(GOAL));
}

// Blocks are not the only thing that matters, so climb on all of it at once. Left to
// itself the block term alone walks the maze somewhere useless -- loops fell from 9
// to 2 and dead-end pockets grew to 26 cells against a cap of 6 -- because closing
// tracks removes blocks and loops together. Loops and pocket size are therefore part
// of the score rather than filters applied afterwards.
function cost(g, wantLoops, maxPocket) {
  const blocks = countBlocks(g);
  const missingLoops = Math.max(0, wantLoops - loopCount(g));
  const overPocket = Math.max(0, maxPocketOf(g) - maxPocket);
  return blocks * 4 + missingLoops * 3 + overPocket;
}

// Largest dead-end pocket hanging off a junction, in cells.
export function maxPocketOf(g) {
  let worst = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (!isOpen(g, x, y)) continue;
    const ns = nbrs(g, x, y);
    if (ns.length < 3) continue;
    const jk = `${x},${y}`;
    for (const b of ns) {
      const seen = new Set([jk, key(b)]);
      const cells = [b], st = [b];
      let escapes = false;
      while (st.length) {
        const c = st.pop();
        if ((c.x === START.x && c.y === START.y) || (c.x === GOAL.x && c.y === GOAL.y)) { escapes = true; break; }
        for (const n of nbrs(g, c.x, c.y)) {
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k); cells.push(n); st.push(n);
        }
      }
      if (!escapes) worst = Math.max(worst, Math.round(cells.length / 2));
    }
  }
  return worst;
}

export function removeBlocks(g, rng, maxSteps = 30000, wantLoops = 8, maxPocket = 6) {
  const isTrack = (x,y) => x>0 && x<G-1 && y>0 && y<G-1 && ((x%2===0) !== (y%2===0));
  let cur = cost(g, wantLoops, maxPocket);
  for (let step = 0; step < maxSteps && cur > 0; step += 1) {
    const x = 1 + Math.floor(rng() * (G-2));
    const y = 1 + Math.floor(rng() * (G-2));
    if (!isTrack(x, y)) continue;
    g[y][x] = g[y][x] === 1 ? 0 : 1;
    const next = cost(g, wantLoops, maxPocket);
    if (next > cur || !fullyConnected(g)) { g[y][x] = g[y][x] === 1 ? 0 : 1; continue; }
    cur = next;
  }
  return cur === 0;
}

// One braided candidate from a seed. Returns null if the exit got sealed off.
export function build(seed, tryIndex, loopRange = [6, 12], removeBlockDefects = false) {
  const base = carve(mulberry32(seed));
  const cands = candidates(base);
  if (cands.length < loopRange[1]) return null;
  const rng = mulberry32(seed * 6151 + 17 + tryIndex * 7919);
  const g = base.map((r) => r.slice());
  const n = loopRange[0] + Math.floor(rng() * (loopRange[1] - loopRange[0] + 1));
  for (const w of [...cands].sort(() => rng() - 0.5).slice(0, n)) g[w.y][w.x] = 0;
  if (removeBlockDefects && !removeBlocks(g, mulberry32(seed * 31 + tryIndex))) return null;
  const p = profile(g);
  if (p.pathLength == null) return null;
  return { g, seed, tryIndex, ...p };
}

export const rowsOf = (g) => g.map((r) => r.join(""));
export const fingerprint = (g) => rowsOf(g).join("");
// How different two mazes are, as a fraction of grid squares that differ.
export function divergence(a, b) {
  const A = fingerprint(a), B = fingerprint(b);
  let diff = 0;
  for (let i = 0; i < A.length; i += 1) if (A[i] !== B[i]) diff += 1;
  return diff / A.length;
}
