// Ask the AI for several different whole-maze solutions and keep the ones that are
// provably walkable.
//
//   node mazes/scripts/build-solutions.mjs maze-0 [count]
//
// Junction hints are derived from these routes rather than asked for junction by
// junction, so every distance is a sum of verified segments and cannot be a number
// the model invented.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
require("dotenv").config();
const engine = require("../../lib/hint-engine.js");

const [id, countArg] = process.argv.slice(2);
if (!id) { console.error("usage: build-solutions.mjs <maze-id> [count]"); process.exit(1); }
const count = Number(countArg) || 6;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const mod = await import(`file://${path.join(root, "public", "mazes", `${id}.js`)}`);
const config = Object.values(mod).find((v) => v && typeof v === "object" && v.maze);
if (!config) { console.error(`no maze config exported from ${id}.js`); process.exit(1); }

const credErr = engine.getCredentialError();
if (credErr) { console.error("Cannot generate:", credErr); process.exit(1); }

// ground truth, for reporting only — never shown to a participant
const G = config.maze.length;
const isOpen = (x, y) => y>=0&&y<G&&x>=0&&x<G&&config.maze[y][x]===0;
const nbrs = (x, y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(c.x,c.y));
const best = (() => {
  const seen = new Set([`${config.start.x},${config.start.y}`]); let f=[config.start], d=0;
  while (f.length) { d++; const nx=[];
    for (const c of f) for (const n of nbrs(c.x,c.y)) {
      if (n.x===config.goal.x && n.y===config.goal.y) return d;
      const k=`${n.x},${n.y}`; if (seen.has(k)) continue; seen.add(k); nx.push(n); }
    f=nx; }
  return Infinity;
})();
const isJunction = (c) => nbrs(c.x, c.y).length >= 3;

console.log(`[${id}] asking ${engine.provider}/${engine.model} for up to ${count} different routes (true shortest is ${best} steps)`);
const t0 = Date.now();
const res = await engine.findMazeSolutions(
  { maze: config.maze, start: config.start, goal: config.goal },
  count,
  (a, d) => console.warn("  ", a, JSON.stringify(d).slice(0, 160)),
);

console.log(`\nverified routes: ${res.routes.length} (in ${((Date.now()-t0)/1000).toFixed(1)}s)`);
const covered = new Set();
res.routes.forEach((r, i) => {
  const js = r.path.filter(isJunction).length;
  r.path.forEach((c) => covered.add(`${c.x},${c.y}`));
  console.log(`  ${i + 1}. ${String(r.steps).padStart(3)} steps  (+${r.steps - best} vs best)  ${js} junctions  — ${r.note}`);
});

const allJ = [];
for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) if (isOpen(x,y) && isJunction({x,y})) allJ.push({x,y});
const hit = allJ.filter((c) => covered.has(`${c.x},${c.y}`)).length;
console.log(`\njunction coverage: ${hit}/${allJ.length} lie on at least one verified route`);

const outFile = path.join(root, "public", "mazes", "solutions", `${id}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({
  maze: id, generated_at: new Date().toISOString(),
  provider: engine.provider, model: engine.model,
  shortest_possible: best,
  routes: res.routes,
}, null, 2));
console.log(`wrote ${path.relative(root, outFile)}`);
