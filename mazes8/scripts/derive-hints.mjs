// Derive the junction hints the game reads from the AI's VERIFIED whole-maze routes.
//
//   node mazes8/scripts/derive-hints.mjs maze-1 --set=mazes8
//
// No AI calls: every number here is arithmetic over routes that were already checked
// to be walkable. Distance down a branch = 1 step onto it + that cell's remaining
// distance along the best verified route through it. A branch no verified route
// touches gets no claim at all, unless an earlier run PROVED it is a closed pocket.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// --set picks which folder under public/ the maze lives in, matching build-solutions.
const argv = process.argv.slice(2);
const SET = (argv.find((a) => a.startsWith("--set=")) || "--set=mazes").split("=")[1];
const id = argv.filter((a) => !a.startsWith("--"))[0];
if (!id) { console.error("usage: derive-hints.mjs <maze-id> [--set=mazes8]"); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const mod = await import(`file://${path.join(root, "public", SET, `${id}.js`)}`);
const config = Object.values(mod).find((v) => v && typeof v === "object" && v.maze);
const maze = config.maze, goal = config.goal;
const G = maze.length;
const isOpen = (x, y) => y>=0&&y<G&&x>=0&&x<G&&maze[y][x]===0;
const nbrs = (x, y) => [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter((c)=>isOpen(c.x,c.y));
const K = (c) => `${c.x},${c.y}`;

const solFile = path.join(root, "public", SET, "solutions", `${id}.json`);
const sol = JSON.parse(fs.readFileSync(solFile, "utf8"));
if (!sol.routes || !sol.routes.length) { console.error("no verified routes to derive from"); process.exit(1); }

// Remaining distance from a branch, for a specific junction. A route may loop back
// through that junction on its way to the exit; a participant who has committed to a
// branch cannot rely on doing that, so any suffix that returns through the junction
// is not usable here. Only suffixes that stay away from it count.
// How many cells of the route to keep for drawing. Enough to run to the edge of
// view without storing whole 54-cell paths in every branch.
const CUE_PATH_CELLS = 14;

function remainingFrom(branch, junction) {
  let best = null;
  for (const r of sol.routes) {
    for (let i = 0; i < r.path.length; i += 1) {
      if (K(r.path[i]) !== K(branch)) continue;
      const suffix = r.path.slice(i);
      if (suffix.some((c) => K(c) === K(junction))) continue;   // comes back through here
      const left = suffix.length - 1;
      if (best == null || left < best) best = { left, path: suffix.slice(0, CUE_PATH_CELLS) };
    }
  }
  return best;
}

// Dead ends that an earlier per-junction run PROVED by enumerating the whole pocket.
// Anything unproven from that file is discarded — those were guesses.
const provenDeadEnds = new Map();
const hintsFile = path.join(root, "public", SET, "hints", `${id}.json`);
fs.mkdirSync(path.dirname(hintsFile), { recursive: true });   // a new set has no folder yet
if (fs.existsSync(hintsFile)) {
  const old = JSON.parse(fs.readFileSync(hintsFile, "utf8"));
  for (const j of old.junctions || []) {
    for (const b of j.branches || []) {
      if (b.verdict === "dead_end" && b.proven) provenDeadEnds.set(`${j.x},${j.y}|${b.x},${b.y}`, b);
    }
  }
}

const junctions = [];
let claimed = 0, possible = 0, skipped = 0;
for (let y = 1; y < G; y += 2) {
  for (let x = 1; x < G; x += 2) {
    if (!isOpen(x, y)) continue;
    const ns = nbrs(x, y);
    if (ns.length < 3) continue;
    possible += ns.length;

    const branches = [];
    for (const b of ns) {
      const found = remainingFrom(b, { x, y });
      if (found != null) {
        // `path` is the start of the AI's own route down this branch, so the line on
        // the floor traces where it actually leads rather than guessing a corridor.
        branches.push({ x: b.x, y: b.y, steps: 1 + found.left, verdict: null, proven: true, path: found.path });
        continue;
      }
      const dead = provenDeadEnds.get(`${x},${y}|${b.x},${b.y}`);
      if (dead) branches.push({ ...dead, verdict: "dead_end", proven: true });
      // otherwise: nothing verified to say about this branch, so say nothing
    }

    const routes = branches.filter((b) => b.verdict !== "dead_end");
    if (!routes.length) { skipped += 1; continue; }
    const best = Math.min(...routes.map((b) => b.steps));
    for (const b of routes) {
      b.verdict = b.steps === best ? "toward_goal" : "detour";
      b.reason = b.steps === best ? "" : `~${b.steps - best} steps longer than the AI's best way from here`;
    }
    claimed += branches.length;
    junctions.push({ x, y, branches });
  }
}

fs.writeFileSync(hintsFile, JSON.stringify({
  maze: id,
  generated_at: new Date().toISOString(),
  method: "derived-from-verified-routes",
  source_routes: sol.routes.map((r) => r.steps),
  provider: sol.provider, model: sol.model,
  complete: true,
  goal,
  junctions,
}, null, 2));

console.log(`[${id}] junctions with a cue: ${junctions.length} (${skipped} had nothing verified)`);
console.log(`branches with a claim   : ${claimed}/${possible}`);
console.log(`every claim is derived from a verified route or a proven pocket`);
console.log(`wrote ${path.relative(root, hintsFile)}`);
