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

// --set picks which folder under public/ the maze lives in, so the same generator
// serves the original four and the matched eight without a second copy of it.
const argv = process.argv.slice(2);
const SET = (argv.find((a) => a.startsWith("--set=")) || "--set=mazes").split("=")[1];
const [id, countArg] = argv.filter((a) => !a.startsWith("--"));
if (!id) { console.error("usage: build-solutions.mjs <maze-id> [count] [--set=mazes8]"); process.exit(1); }
const count = Number(countArg) || 6;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const mod = await import(`file://${path.join(root, "public", SET, `${id}.js`)}`);
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

console.log(`\nverified routes this run: ${res.routes.length} (in ${((Date.now()-t0)/1000).toFixed(1)}s)`);

const outFile = path.join(root, "public", SET, "solutions", `${id}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });

// --merge keeps routes an earlier run already verified and adds only genuinely new
// ones. Coverage is what makes the derived hints trustworthy: a branch no route
// walks gets no cue at all, and the junction then recommends whatever it does know
// about, which may not be the best way. One pass rarely covers a whole braided maze,
// so accumulating beats overwriting.
const MERGE = argv.includes("--merge");
let routes = res.routes;
if (MERGE && fs.existsSync(outFile)) {
  const old = JSON.parse(fs.readFileSync(outFile, "utf8")).routes || [];
  const sig = (r) => r.path.map((c) => `${c.x},${c.y}`).join(">");
  const seen = new Set(old.map(sig));
  const added = res.routes.filter((r) => !seen.has(sig(r)));
  routes = [...old, ...added].sort((a, b) => a.steps - b.steps);
  console.log(`merged: ${old.length} kept + ${added.length} new = ${routes.length}` +
    ` (${res.routes.length - added.length} were duplicates)`);
}

const covered = new Set();
routes.forEach((r, i) => {
  const js = r.path.filter(isJunction).length;
  r.path.forEach((c) => covered.add(`${c.x},${c.y}`));
  console.log(`  ${i + 1}. ${String(r.steps).padStart(3)} steps  (+${r.steps - best} vs best)  ${js} junctions  — ${r.note}`);
});

const allJ = [];
for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) if (isOpen(x,y) && isJunction({x,y})) allJ.push({x,y});
const hit = allJ.filter((c) => covered.has(`${c.x},${c.y}`)).length;
console.log(`\njunction coverage: ${hit}/${allJ.length} lie on at least one verified route`);

fs.writeFileSync(outFile, JSON.stringify({
  maze: id, generated_at: new Date().toISOString(),
  provider: engine.provider, model: engine.model,
  shortest_possible: best,
  routes,
}, null, 2));
console.log(`wrote ${path.relative(root, outFile)}`);
