// Does sending the maze as a grid, as an adjacency list, or as both produce more
// usable routes? Measured, not guessed.
//
//   MAZE_REPR=graph node mazes8/scripts/repr-test.mjs maze-5 6
//
// Writes nothing. The stored solutions are what the study serves, so a measurement
// must not overwrite them -- this prints and exits.
//
// The number that matters is verified routes and junction coverage, not tokens. A
// route is re-walked against the real grid before it counts, so a representation the
// model reads badly shows up as fewer routes, never as a wrong distance.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
require("dotenv").config();
const engine = require("../../lib/hint-engine.js");

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const id = argv[0] || "maze-5";
const count = Number(argv[1]) || 6;
const repr = process.env.MAZE_REPR || "both";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const mod = await import(`file://${path.join(root, "public", "mazes8", `${id}.js`).replace(/\\/g, "/")}`);
const config = Object.values(mod).find((v) => v && typeof v === "object" && v.maze);

const credErr = engine.getCredentialError();
if (credErr) { console.error("cannot run:", credErr); process.exit(1); }

const g = config.maze;
const G = g.length;
const open = (x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
const deg = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => open(x + dx, y + dy)).length;
const junctions = [];
for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) if (open(x, y) && deg(x, y) >= 3) junctions.push(`${x},${y}`);

const rejects = [];
// Errors matter as much as rejections: a request refused by the API reports zero
// routes and zero rejections, which reads identically to a model that found nothing.
const errors = [];
const t0 = Date.now();
const res = await engine.findMazeSolutions(
  { maze: config.maze, start: config.start, goal: config.goal },
  count,
  (action, d) => {
    if (action === "solution_rejected") rejects.push(d.why);
    if (action === "solutions_error") errors.push(d.message);
  },
);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const covered = new Set();
res.routes.forEach((r) => r.path.forEach((c) => covered.add(`${c.x},${c.y}`)));
const hit = junctions.filter((k) => covered.has(k)).length;
const steps = res.routes.map((r) => r.steps);
const u = engine.getUsageTotals();

console.log(JSON.stringify({
  repr, maze: id,
  routes: res.routes.length,
  coverage: `${hit}/${junctions.length}`,
  shortest: steps.length ? Math.min(...steps) : null,
  seconds: Number(secs),
  calls: u.calls, input_tokens: u.input, output_tokens: u.output,
  rejected: rejects.length,
  why: rejects.slice(0, 3),
  errors: errors.slice(0, 2),
}));
