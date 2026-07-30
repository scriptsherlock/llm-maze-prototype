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
const { DISAPPEAR_10X10_MAZE_CONFIG } = await import("../public/disappear_10x10_maze.js");

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

async function buildOne(key, config, attempts = 5) {
  const maze = config.maze;
  const goal = config.goal;
  const junctions = findJunctions(maze);
  process.stdout.write(`\n[${key}] ${junctions.length} junctions — calling AI (${engine.provider}/${engine.model}, high reasoning)…\n`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const t0 = Date.now();
    try {
      const result = await engine.evaluateJunctionsBatch({ maze, goal, junctions }, (a, d) => console.warn("  logError:", a, JSON.stringify(d).slice(0, 200)));
      const returned = (result.junctions || []).length;
      const took = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.status === "evaluated" && returned === junctions.length) {
        const payload = {
          maze: key,
          generated_at: new Date().toISOString(),
          provider: engine.provider,
          model: engine.model,
          goal,
          junctions: result.junctions,
        };
        fs.mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, `junction-cues.${key}.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2));
        console.log(`  ✅ ${returned}/${junctions.length} junctions in ${took}s → public/data/junction-cues.${key}.json`);
        return true;
      }
      console.warn(`  ⚠️ attempt ${attempt}: got ${returned}/${junctions.length} (status=${result.status}) in ${took}s — retrying`);
    } catch (error) {
      console.warn(`  ⚠️ attempt ${attempt}: ${error.message} (${((Date.now() - t0) / 1000).toFixed(1)}s) — retrying`);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 4000)); // backoff (503s)
  }
  console.error(`  ❌ [${key}] failed after ${attempts} attempts`);
  return false;
}

const credErr = engine.getCredentialError();
if (credErr) {
  console.error("Cannot generate cues:", credErr);
  process.exit(1);
}

const allTargets = [
  ["default", FIXED_8X8_MAZE_CONFIG],
  ["original", ORIGINAL_15X15_MAZE_CONFIG],
  ["disappear", DISAPPEAR_10X10_MAZE_CONFIG],
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
