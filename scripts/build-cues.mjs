// Offline cue generator. We know the mazes ahead of time, so call the AI HERE
// (once, on our machine, with high reasoning and retries) and write the junction
// cues to a committed JSON file. At deployment the app just reads that file — no
// live AI call, no wait, no timeout/Vercel limits. Re-run when the prompt/maze
// changes:  node scripts/build-cues.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
require("dotenv").config();
const engine = require("../lib/hint-engine.js");
const { FIXED_8X8_MAZE_CONFIG } = await import("../public/fixed_8x8_maze.js");
const { ORIGINAL_15X15_MAZE_CONFIG } = await import("../public/original_15x15_maze.js");
const { DISAPPEAR_MAZE_CONFIG } = await import("../public/disappear_maze.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "data");

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Every open cell with 3+ open neighbours is a junction (matches the client).
function findJunctions(maze) {
  const rows = maze.length;
  const cols = maze[0].length;
  const isOpen = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && maze[y][x] === 0;
  const junctions = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isOpen(x, y)) continue;
      const branches = DIRS.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter((c) => isOpen(c.x, c.y));
      if (branches.length >= 3) junctions.push({ x, y, branches });
    }
  }
  return junctions;
}

// Per-junction "show your work": the AI traces a path for every branch and we
// validate it (adjacency only, no BFS), deriving verdict/steps from the proven path.
async function buildOne(key, config) {
  const maze = config.maze;
  const goal = config.goal;
  const junctions = findJunctions(maze);
  process.stdout.write(`\n[${key}] ${junctions.length} junctions — per-junction traced eval (${engine.provider}/${engine.model}, high reasoning)\n`);

  const out = [];
  let full = 0, partial = 0;
  const t0 = Date.now();
  for (const j of junctions) {
    try {
      const res = await engine.evaluateJunctionTraced({ maze, goal, junction: { x: j.x, y: j.y }, branches: j.branches }, () => {});
      out.push({ x: j.x, y: j.y, branches: res.branches });
      full += 1;
      process.stdout.write(`  (${j.x},${j.y}) ✅ ${res.attempts} attempt(s)\n`);
    } catch (error) {
      const parts = error.partial || [];
      out.push({ x: j.x, y: j.y, branches: parts });
      partial += 1;
      process.stdout.write(`  (${j.x},${j.y}) ⚠️ partial (${parts.length}/${j.branches.length} branches validated)\n`);
    }
  }

  const payload = {
    maze: key, generated_at: new Date().toISOString(),
    provider: engine.provider, model: engine.model, method: "traced-validated",
    goal, junctions: out,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `junction-cues.${key}.json`), JSON.stringify(payload, null, 2));
  console.log(`  wrote ${out.length} junctions (${full} full, ${partial} partial) in ${((Date.now() - t0) / 1000).toFixed(1)}s → junction-cues.${key}.json`);
  return partial === 0;
}

const credErr = engine.getCredentialError();
if (credErr) {
  console.error("Cannot generate cues:", credErr);
  process.exit(1);
}

const allTargets = [
  ["default", FIXED_8X8_MAZE_CONFIG],
  ["original", ORIGINAL_15X15_MAZE_CONFIG],
  ["disappear", DISAPPEAR_MAZE_CONFIG],
];
// Optional CLI filter: `node build-cues.mjs disappear` builds only that maze
// (so we don't re-spend quota regenerating the ones already committed).
const wanted = process.argv.slice(2);
const targets = wanted.length ? allTargets.filter(([k]) => wanted.includes(k)) : allTargets;
let ok = true;
for (const [key, config] of targets) {
  const done = await buildOne(key, config);
  if (!done) ok = false;
}
console.log(`\n${ok ? "All cue files written." : "Some cue files failed — see above."}`);
process.exit(ok ? 0 : 1);
