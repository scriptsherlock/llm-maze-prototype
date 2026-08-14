// Check the eight mazes against the brief, and against the rules of the grid format.
//
//   node mazes8/scripts/verify.mjs
//
// The brief: same number of branch points, similar path length, more than one
// correct path. Everything below is measured from the written files, not from the
// generator's own bookkeeping, so a bug in the generator cannot hide here.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { G, profile, dmap, key, isOpen, divergence } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");
const ids = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort(
  (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const mazes = ids.map((f) => {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  const g = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  const goal = { x:+src.match(/goal:\s*\{\s*x:\s*(\d+)/)[1], y:+src.match(/goal:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1] };
  // both openings move per maze, so neither may come from a module constant
  const start = { x:+src.match(/start:\s*\{\s*x:\s*(\d+)/)[1], y:+src.match(/start:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1] };
  return { id: f.replace(/\.js$/, ""), g, goal, start, src };
});

let fails = 0;
const bad = (msg) => { console.log(`  FAIL  ${msg}`); fails += 1; };
const ok = (msg) => console.log(`  ok    ${msg}`);

console.log(`\nmeasured from the files in public/mazes8/ (${mazes.length} mazes)\n`);
console.log("maze      path len  branch pts  choice pts  loops  dead ends  max pocket");
const rows = mazes.map((m) => ({ ...m, p: profile(m.g, m.goal, m.start) }));
for (const r of rows) {
  const p = r.p;
  console.log(`${r.id.padEnd(10)}${String(p.pathLength).padEnd(10)}${String(p.branchPoints).padEnd(12)}` +
    `${String(p.choicePoints).padEnd(12)}${String(p.loops).padEnd(7)}${String(p.deadEndBranches).padEnd(11)}${p.maxPocket}`);
}

console.log("\n--- the brief ---");
const branch = [...new Set(rows.map((r) => r.p.branchPoints))];
if (branch.length === 1) ok(`every maze has exactly ${branch[0]} branch points`);
else bad(`branch points differ across the set: ${branch.sort((a,b)=>a-b).join(", ")}`);

const lens = rows.map((r) => r.p.pathLength);
const spread = Math.max(...lens) - Math.min(...lens);
if (spread === 0) ok(`every maze has exactly the same path length (${lens[0]} moves)`);
else if (spread <= 4) ok(`path lengths within ${spread} moves (${Math.min(...lens)}-${Math.max(...lens)})`);
else bad(`path lengths spread by ${spread} moves (${Math.min(...lens)}-${Math.max(...lens)})`);

const noChoice = rows.filter((r) => r.p.choicePoints < 2);
if (!noChoice.length) ok(`every maze has more than one correct path ` +
  `(${Math.min(...rows.map(r=>r.p.choicePoints))}-${Math.max(...rows.map(r=>r.p.choicePoints))} branch points ` +
  `where 2+ branches independently reach the exit; ${Math.min(...rows.map(r=>r.p.loops))}-${Math.max(...rows.map(r=>r.p.loops))} loops)`);
else bad(`${noChoice.length} maze(s) have no genuine alternative route`);

console.log("\n--- the grid format ---");
for (const r of rows) {
  // corner posts must stay solid, or four cells merge into a 2x2 room
  for (let y = 2; y < G-1; y += 2) for (let x = 2; x < G-1; x += 2) {
    if (isOpen(r.g, x, y)) { bad(`${r.id}: corner post (${x},${y}) is open — that is a 2x2 room, not a corridor`); }
  }
  const d = dmap(r.g, r.start);
  if (d.get(key(r.goal)) == null) bad(`${r.id}: the exit is not reachable from the start`);
  // every open cell should be reachable, or part of the maze is wasted
  let openCells = 0, reached = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (!isOpen(r.g, x, y)) continue;
    openCells += 1;
    if (d.get(`${x},${y}`) != null) reached += 1;
  }
  if (openCells !== reached) bad(`${r.id}: ${openCells - reached} cells are walled off from the maze`);
}
if (!fails) ok("corner posts solid, exit reachable, no orphaned cells, in all eight");

console.log("\n--- all eight are different mazes ---");
let minDiv = 1, pair = "";
for (let i = 0; i < rows.length; i += 1) for (let j = i+1; j < rows.length; j += 1) {
  const d = divergence(rows[i].g, rows[j].g);
  if (d < minDiv) { minDiv = d; pair = `${rows[i].id} vs ${rows[j].id}`; }
}
if (minDiv > 0.05) ok(`closest pair still differs in ${(minDiv*100).toFixed(1)}% of grid squares (${pair})`);
else bad(`${pair} are near-identical (${(minDiv*100).toFixed(1)}% different)`);

// Where the exit is RELATIVE TO THE WAY THE PLAYER SPAWNS FACING. Map position is the
// wrong measure and an earlier version of this check used it: it passed on exits that
// sat in five named "zones" while seven of the eight were on the bottom wall and the
// player, who has no map and no compass, experienced every one of them as straight
// ahead. Rotating a maze does not change a single thing about this number, which is
// the point -- it is measured in the only frame the participant has.
const WALL = (p) => (p.y === 0 ? "top" : p.y === G - 1 ? "bottom" : p.x === 0 ? "left" : p.x === G - 1 ? "right" : "interior");
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
const LEFT_OF = { top: "right", bottom: "left", left: "top", right: "bottom" };
console.log("\n--- where the exit is, from where the player starts ---");
const bearings = rows.map((r) => {
  const inW = WALL({ x: +r.src.match(/entrance:\s*\{\s*x:\s*(\d+)/)[1],
                     y: +r.src.match(/entrance:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1] });
  const outW = WALL(r.goal);
  if (outW === OPPOSITE[inW]) return "ahead";
  if (outW === inW) return "behind";
  return outW === LEFT_OF[inW] ? "left" : "right";
});
const tally = bearings.reduce((a, b) => ({ ...a, [b]: (a[b] || 0) + 1 }), {});
const summary = Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ");
if ((tally.ahead || 0) <= rows.length / 2 && Object.keys(tally).length >= 2) {
  ok(`the exit is not reliably in one direction (${summary})`);
} else {
  bad(`the exit is ${summary} — heading one way wins without navigating`);
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : "\nall checks passed\n");
process.exit(fails ? 1 : 0);
