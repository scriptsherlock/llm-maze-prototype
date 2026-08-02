// Add a chokeCell to a maze: the midpoint of its solution route.
//
//   node mazes/scripts/set-choke.mjs public/mazes/maze-c.js
//
// These mazes are perfect (no loops), so EVERY cell on the solution is a cut vertex —
// there is exactly one route, and it must pass through each of them. The midpoint is
// therefore guaranteed to be crossed, with roughly half the task on either side.
import fs from "fs";

const file = process.argv[2];
if (!file) { console.error("usage: set-choke.mjs <maze.js>"); process.exit(1); }

const src = fs.readFileSync(file, "utf8");
const rows = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, ""));
const g = rows.map((r) => r.split("").map(Number));
const G = g.length;
const cell = (k) => { const m = src.match(new RegExp(`${k}:\\s*\\{\\s*x:\\s*(\\d+),\\s*y:\\s*(\\d+)`)); return { x: +m[1], y: +m[2] }; };
const start = cell("start"), goal = cell("goal");

const isOpen = (x,y) => y>=0&&y<G&&x>=0&&x<G&&g[y][x]===0;
const nbrs = (x,y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(c.x,c.y));
const prev = {}, seen = new Set([`${start.x},${start.y}`]);
let f = [start], route = null;
while (f.length && !route) {
  const nx = [];
  for (const c of f) {
    if (c.x===goal.x && c.y===goal.y) { route=[]; let cur=`${c.x},${c.y}`; while(cur){route.unshift(cur);cur=prev[cur];} break; }
    for (const n of nbrs(c.x,c.y)) { const k=`${n.x},${n.y}`; if (seen.has(k)) continue; seen.add(k); prev[k]=`${c.x},${c.y}`; nx.push(n); }
  }
  f = nx;
}
if (!route) { console.error("maze is not solvable"); process.exit(1); }

// Land on an actual cell (odd,odd), not a wall gap, so the choke is a real location.
let i = Math.floor(route.length / 2);
const isCell = (s) => { const [a,b] = s.split(",").map(Number); return a%2===1 && b%2===1; };
while (i < route.length && !isCell(route[i])) i += 1;
const [cx, cy] = route[i].split(",").map(Number);

const updated = src.includes("chokeCell")
  ? src.replace(/chokeCell:\s*\{[^}]*\}/, `chokeCell: { x: ${cx}, y: ${cy} }`)
  : src.replace(/(goal:\s*\{[^}]*\},)/, `$1\n  chokeCell: { x: ${cx}, y: ${cy} },`);
fs.writeFileSync(file, updated);
console.log(`${file}: choke (${cx},${cy})  ${i} steps in, ${route.length - 1 - i} to go (route ${route.length - 1})`);
