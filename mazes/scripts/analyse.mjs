// Complexity profile of one or more maze configs — the numbers used to decide
// whether mazes are matched, and to read off the generator's E/R character.
//
//   node mazes/scripts/analyse.mjs public/mazes/maze-a.js [more...]
//   node mazes/scripts/analyse.mjs public/mazes/*.js
//
// coverage% is the elitism signal (LOW E-value => solution wanders => HIGH coverage).
// dead-end depth is the river signal (LOW R => many shallow, HIGH R => few deep).
import fs from "fs";
import path from "path";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: analyse.mjs <maze.js> [more...]"); process.exit(1); }

function load(file) {
  const src = fs.readFileSync(file, "utf8");
  const rows = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, ""));
  const grid = rows.map((r) => r.split("").map(Number));
  const num = (k, c) => { const m = src.match(new RegExp(`${k}:\\s*\\{\\s*x:\\s*(\\d+),\\s*y:\\s*(\\d+)`)); return m ? { x: +m[1], y: +m[2] } : null; };
  return { grid, start: num("start"), goal: num("goal") };
}

export function profile(file) {
  const { grid, start, goal } = load(file);
  const G = grid.length;
  const isOpen = (x,y) => y>=0&&y<G&&x>=0&&x<G&&grid[y][x]===0;
  const nbrs = (x,y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(c.x,c.y));

  let openCells = 0, edges = 0, cellCount = 0, junctions = 0;
  for (let y=0;y<G;y++) for (let x=0;x<G;x++) {
    if (!isOpen(x,y)) continue;
    openCells++;
    if (isOpen(x+1,y)) edges++;
    if (isOpen(x,y+1)) edges++;
  }
  for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) {
    if (!isOpen(x,y)) continue;
    cellCount++;
    if (nbrs(x,y).length >= 3) junctions++;
  }

  // shortest route start -> goal
  const prev = {}, seen = new Set([`${start.x},${start.y}`]);
  let f = [start], route = null;
  while (f.length && !route) {
    const nx = [];
    for (const c of f) {
      if (c.x===goal.x && c.y===goal.y) { route=[]; let cur=`${c.x},${c.y}`; while(cur){route.push(cur);cur=prev[cur];} break; }
      for (const n of nbrs(c.x,c.y)) { const k=`${n.x},${n.y}`; if (seen.has(k)) continue; seen.add(k); prev[k]=`${c.x},${c.y}`; nx.push(n); }
    }
    f = nx;
  }
  const onRoute = new Set(route || []);
  const routeCells = (route||[]).filter((p) => { const [a,b]=p.split(",").map(Number); return a%2===1 && b%2===1; }).length;

  // dead-end branches hanging off the route, measured in cells
  const depths = [];
  for (const p of route || []) {
    const [cx,cy] = p.split(",").map(Number);
    for (const n of nbrs(cx,cy)) {
      if (onRoute.has(`${n.x},${n.y}`)) continue;
      const s = new Set([p, `${n.x},${n.y}`]);
      let fr=[n], d=1, mx=1;
      while (fr.length) { const nx2=[];
        for (const q of fr) for (const m of nbrs(q.x,q.y)) { const k=`${m.x},${m.y}`; if (s.has(k)||onRoute.has(k)) continue; s.add(k); nx2.push(m); }
        if (nx2.length) { d++; mx=d; } fr=nx2; }
      depths.push(Math.round(mx/2));
    }
  }
  const avg = (a) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
  return {
    name: path.basename(file),
    size: `${(G-1)/2}x${(G-1)/2}`,
    solution: (route ? route.length - 1 : Infinity),
    coverage: cellCount ? Math.round(100 * routeCells / cellCount) : 0,
    junctions,
    deadEnds: depths.length,
    deadEndAvg: +avg(depths).toFixed(1),
    deadEndMax: depths.length ? Math.max(...depths) : 0,
    loops: edges - (openCells - 1),
  };
}

const rows = files.map(profile);
const head = ["maze","size","solution","coverage%","junctions","deadEnds","avgDepth","maxDepth","loops"];
const widths = head.map((h,i) => Math.max(h.length, ...rows.map((r)=>String(Object.values(r)[i]).length)) + 2);
console.log(head.map((h,i)=>h.padEnd(widths[i])).join(""));
for (const r of rows) console.log(Object.values(r).map((v,i)=>String(v).padEnd(widths[i])).join(""));
console.log(`
coverage%  how much of the maze the solution walks through -> LOW E-value gives a HIGH number
avgDepth   dead-end length in cells -> LOW R-value gives MANY SHALLOW, HIGH R gives FEW DEEP
loops      0 = perfect maze (exactly one route between any two cells)`);
