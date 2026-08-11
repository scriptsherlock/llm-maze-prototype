// Get rid of one-cell hedge stubs.
//
//   node mazes8/scripts/repair-walls.mjs [--min=2] [--dry]
//
// A hedge run of a single cell reads in the first-person view as a block floating
// between two gaps rather than as a wall. 60% of the runs in the set were one cell.
//
// They cannot be avoided at generation: over 5,400 sampled braided mazes, NONE had a
// minimum run of even 2, and the count stays at roughly 20-28 whatever the junction
// count, so it is a property of the thin-wall encoding rather than of branchiness.
// The fix has to be a repair pass.
//
// Each too-short run is either EXTENDED, by closing a passage at one end, or if that
// would cut the maze in two it is REMOVED, which simply opens a passage and adds a
// loop. Extending is preferred because removing makes the maze more open.
//
// One extra rule that matters: a passage used by any stored AI route is never closed.
// The hints are derived from those routes by arithmetic, so as long as every route is
// still walkable afterwards the hints can be re-derived with no new model calls --
// which is the difference between a free change and one blocked by the API quota.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const MIN = Number((argv.find((a) => a.startsWith("--min=")) || "--min=2").split("=")[1]);
const DRY = argv.includes("--dry");
// --free lets the repair close a passage even if a stored route uses it. Better maze,
// at the cost of invalidating routes and so needing the hints regenerated.
const FREE = argv.includes("--free");
const D = [[0,-1],[1,0],[0,1],[-1,0]];
const K = (c) => `${c.x},${c.y}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");

// Maximal straight runs of hedge PANELS. A panel is (even,odd) or (odd,even); the
// squares between panels along the same line are corner posts, not panels.
function runsOf(g) {
  const G = g.length, out = [];
  const wall = (x,y) => g[y][x] === 1;
  for (let x = 2; x < G-1; x += 2) {
    let cells = [];
    for (let y = 1; y < G; y += 2) {
      if (wall(x,y)) cells.push({ x, y });
      else { if (cells.length) out.push({ dir: "v", cells }); cells = []; }
    }
    if (cells.length) out.push({ dir: "v", cells });
  }
  for (let y = 2; y < G-1; y += 2) {
    let cells = [];
    for (let x = 1; x < G; x += 2) {
      if (wall(x,y)) cells.push({ x, y });
      else { if (cells.length) out.push({ dir: "h", cells }); cells = []; }
    }
    if (cells.length) out.push({ dir: "h", cells });
  }
  return out;
}

const isOpen = (g,x,y) => y>=0&&y<g.length&&x>=0&&x<g.length&&g[y][x]===0;

// Every open square must stay reachable, or part of the maze is walled off.
function allConnected(g, from) {
  const G = g.length;
  let total = 0;
  for (let y=0;y<G;y+=1) for (let x=0;x<G;x+=1) if (isOpen(g,x,y)) total += 1;
  const seen = new Set([K(from)]);
  let f = [from];
  while (f.length) {
    const nx = [];
    for (const c of f) for (const [dx,dy] of D) {
      const n = { x:c.x+dx, y:c.y+dy };
      if (!isOpen(g,n.x,n.y) || seen.has(K(n))) continue;
      seen.add(K(n)); nx.push(n);
    }
    f = nx;
  }
  return seen.size === total;
}

function repair(g, start, protectedSquares) {
  let extended = 0, removed = 0;
  for (let pass = 0; pass < 60; pass += 1) {
    const short = runsOf(g).filter((r) => r.cells.length < MIN)
      .sort((a,b) => a.cells.length - b.cells.length);
    if (!short.length) break;
    let acted = false;
    for (const run of short) {
      if (run.cells.length >= MIN) continue;                    // fixed by an earlier step
      const step = run.dir === "v" ? { dx:0, dy:2 } : { dx:2, dy:0 };
      const ends = [
        { x: run.cells[0].x - step.dx, y: run.cells[0].y - step.dy },
        { x: run.cells[run.cells.length-1].x + step.dx, y: run.cells[run.cells.length-1].y + step.dy },
      ];
      let done = false;
      for (const e of ends) {
        if (e.x < 1 || e.x >= g.length-1 || e.y < 1 || e.y >= g.length-1) continue;
        if (!isOpen(g, e.x, e.y)) continue;
        if (!FREE && protectedSquares.has(K(e))) continue;       // an AI route walks here
        g[e.y][e.x] = 1;
        if (allConnected(g, start)) { extended += 1; done = true; acted = true; break; }
        g[e.y][e.x] = 0;
      }
      if (done) continue;
      for (const c of run.cells) g[c.y][c.x] = 0;               // open it instead
      removed += 1; acted = true;
    }
    if (!acted) break;
  }
  return { extended, removed };
}

function profile(g, start, goal) {
  const G = g.length;
  const nb = (x,y) => D.map(([dx,dy])=>({x:x+dx,y:y+dy})).filter(c=>isOpen(g,c.x,c.y));
  const dist = (from, to, bl) => {
    const seen = new Set([K(from)]); let f=[from], d=0;
    while (f.length) {
      if (f.some(c=>c.x===to.x&&c.y===to.y)) return d;
      const nx=[];
      for (const c of f) for (const n of nb(c.x,c.y)) {
        if (seen.has(K(n)) || (bl && bl.has(K(n)))) continue;
        seen.add(K(n)); nx.push(n);
      }
      f=nx; d+=1;
    }
    return Infinity;
  };
  let branch=0, choice=0;
  for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) {
    if (!isOpen(g,x,y)) continue;
    const ns = nb(x,y);
    if (ns.length < 3) continue;
    branch += 1;
    const bl = new Set([`${x},${y}`]);
    let reach = 0;
    for (const b of ns) if (Number.isFinite(dist(b, goal, bl))) reach += 1;
    if (reach >= 2) choice += 1;
  }
  let cells=0, edges=0;
  for (let y=0;y<G;y+=1) for (let x=0;x<G;x+=1) {
    if (!isOpen(g,x,y)) continue;
    cells += 1;
    if (isOpen(g,x+1,y)) edges += 1;
    if (isOpen(g,x,y+1)) edges += 1;
  }
  return { len: dist(start, goal), branch, choice, loops: edges-(cells-1) };
}

console.log(`repairing hedge runs shorter than ${MIN} cells${DRY ? "  (dry run)" : ""}\n`);
console.log("maze     stubs   extended   removed   min run   branch pts   path len   loops   routes still valid");
const summary = [];
for (let n = 1; n <= 8; n += 1) {
  const file = path.join(dir, `maze-${n}.js`);
  const src = fs.readFileSync(file, "utf8");
  const g = src.match(/"[01]+"/g).map((s)=>s.replace(/"/g,"")).map((r)=>r.split("").map(Number));
  const start = { x:+src.match(/start:\s*\{\s*x:\s*(\d+)/)[1], y:+src.match(/start:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1] };
  const goal  = { x:+src.match(/goal:\s*\{\s*x:\s*(\d+)/)[1],  y:+src.match(/goal:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1] };

  const solFile = path.join(dir, "solutions", `maze-${n}.json`);
  const sol = fs.existsSync(solFile) ? JSON.parse(fs.readFileSync(solFile, "utf8")) : { routes: [] };
  const protectedSquares = new Set();
  for (const r of sol.routes) for (const c of r.path) protectedSquares.add(K(c));
  // the entrance and exit gaps are not ours to close either
  protectedSquares.add(`${start.x},0`);
  protectedSquares.add(K(goal));

  const before = runsOf(g).filter((r) => r.cells.length < MIN).length;
  const { extended, removed } = repair(g, start, protectedSquares);
  const after = runsOf(g).filter((r) => r.cells.length < MIN).length;
  const minRun = Math.min(...runsOf(g).map((r) => r.cells.length));
  const p = profile(g, start, goal);

  const stillValid = sol.routes.filter((r) => r.path.every((c) => isOpen(g, c.x, c.y))).length;
  summary.push({ n, before, after, minRun, ...p, stillValid, total: sol.routes.length });
  console.log(`maze-${n}  ${String(before).padEnd(8)}${String(extended).padEnd(11)}${String(removed).padEnd(10)}` +
    `${String(minRun).padEnd(10)}${String(p.branch).padEnd(13)}${String(p.len).padEnd(11)}${String(p.loops).padEnd(8)}` +
    `${stillValid}/${sol.routes.length}`);

  if (!DRY) {
    const rows = g.map((r) => `  "${r.join("")}",`).join("\n");
    fs.writeFileSync(file, src.replace(/const WALL_ROWS = \[[\s\S]*?\n\];/, `const WALL_ROWS = [\n${rows}\n];`));
  }
}
const bad = summary.filter((s) => s.after > 0);
console.log(bad.length ? `\n${bad.length} maze(s) still have a short run` : `\nno hedge run shorter than ${MIN} cells remains`);
const brokeRoutes = summary.filter((s) => s.stillValid !== s.total);
console.log(brokeRoutes.length ? `[!] ${brokeRoutes.length} maze(s) lost a stored route` : "every stored AI route is still walkable");
if (!DRY) console.log("\nwritten. re-run derive-all.sh to rebuild the hints from the same routes.");
