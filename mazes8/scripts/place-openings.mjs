// Find entrance/exit pairs that break the "the exit is straight across" heuristic.
//
//   node mazes8/scripts/place-openings.mjs            # what is available
//   node mazes8/scripts/place-openings.mjs --apply    # write the chosen assignment
//
// The participant has no map and no compass, so map direction means nothing to them:
// rotating a maze produces an identical run. What they can actually learn across eight
// trials is where the exit sits relative to the way they are first facing. With the
// entrance always top centre and the exit always on the bottom wall, that answer was
// always "straight ahead", and by trial three you can push forward without reading a
// thing.
//
// So both openings move. For each maze this searches every (entrance, exit) pair on
// the boundary and keeps those that hold the matched properties exactly -- 53 moves
// and 25 branch points -- then groups them by bearing:
//
//   ahead   exit on the wall opposite the entrance
//   behind  exit on the same wall as the entrance
//   left    exit on the wall to the player's left as they spawn
//   right   and to their right
//
// Interior walls are never touched, so the carve, the loops and the hedge blocks are
// exactly as generated. Only two boundary squares differ.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const APPLY = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");
const G = 21;
const TARGET_MOVES = 53;
const TARGET_JUNCTIONS = 25;

const open = (g, x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
const nbrs = (g, x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]]
  .map(([a, b]) => ({ x: x + a, y: y + b })).filter((c) => open(g, c.x, c.y));

const dmap = (g, s) => {
  const m = new Map([[`${s.x},${s.y}`, 0]]);
  let f = [s], d = 0;
  while (f.length) {
    d += 1;
    const n = [];
    for (const c of f) for (const q of nbrs(g, c.x, c.y)) {
      const k = `${q.x},${q.y}`;
      if (m.has(k)) continue;
      m.set(k, d); n.push(q);
    }
    f = n;
  }
  return m;
};

const junctionCount = (g) => {
  let n = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (open(g, x, y) && nbrs(g, x, y).length >= 3) n += 1;
  }
  return n;
};

// every boundary square that can be opened, with the cell just inside it
const OPENINGS = [];
for (let i = 1; i < G; i += 2) {
  OPENINGS.push({ x: i, y: 0, wall: "top", inside: { x: i, y: 1 } });
  OPENINGS.push({ x: i, y: G - 1, wall: "bottom", inside: { x: i, y: G - 2 } });
  OPENINGS.push({ x: 0, y: i, wall: "left", inside: { x: 1, y: i } });
  OPENINGS.push({ x: G - 1, y: i, wall: "right", inside: { x: G - 2, y: i } });
}

// facing on spawn: into the maze. 0=north 1=east 2=south 3=west, matching startFacing.
const FACING = { top: 2, bottom: 0, left: 1, right: 3 };
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
// walls to the player's left and right given the wall they entered through
const LEFT_OF = { top: "right", bottom: "left", left: "top", right: "bottom" };

const bearing = (inWall, outWall) => {
  if (outWall === OPPOSITE[inWall]) return "ahead";
  if (outWall === inWall) return "behind";
  return outWall === LEFT_OF[inWall] ? "left" : "right";
};

const load = (n) => {
  const src = fs.readFileSync(path.join(dir, `maze-${n}.js`), "utf8");
  const g = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  return { src, g };
};

// Options for one maze, keyed by bearing. Boundary gaps open onto the outside, which
// is not walkable, so interior distances do not depend on which gaps are open -- one
// BFS per candidate start is enough. Junctions do depend on it, since a gap gives the
// cell inside it one more neighbour, so that is recounted per pair.
function optionsFor(n) {
  const { g } = load(n);
  const out = { ahead: [], behind: [], left: [], right: [] };
  for (const ent of OPENINGS) {
    if (!open(g, ent.inside.x, ent.inside.y)) continue;
    const m = dmap(g, ent.inside);
    for (const ex of OPENINGS) {
      if (ex.x === ent.x && ex.y === ent.y) continue;
      if (!open(g, ex.inside.x, ex.inside.y)) continue;
      const d = m.get(`${ex.inside.x},${ex.inside.y}`);
      if (d == null || d + 1 !== TARGET_MOVES) continue;

      const g2 = g.map((r) => r.slice());
      for (let i = 0; i < G; i += 1) { g2[0][i] = 1; g2[G - 1][i] = 1; g2[i][0] = 1; g2[i][G - 1] = 1; }
      g2[ent.y][ent.x] = 0;
      g2[ex.y][ex.x] = 0;
      if (junctionCount(g2) !== TARGET_JUNCTIONS) continue;

      out[bearing(ent.wall, ex.wall)].push({ ent, ex });
    }
  }
  return out;
}

// Which maze takes which bearing, fixed rather than searched so the set is
// reproducible. Two constraints came out of the search and shaped this:
//
//   "behind" is impossible on all eight. Entering and leaving through the same wall
//   cannot be done in 53 moves in any of these carves, so that bearing is simply not
//   available while the set stays matched.
//
//   mazes 1 and 5 have no side option either -- every 53-move pair they admit is
//   entrance-to-opposite-wall -- so both are forced to "ahead".
//
// That leaves 2 ahead and 6 to the sides, split 3/3. Down from 8 of 8 straight across,
// which is what made pushing forward a winning strategy.
const PLAN = { 1: "ahead", 2: "left", 3: "left", 4: "left", 5: "ahead", 6: "right", 7: "right", 8: "right" };

const all = {};
console.log("options at exactly 53 moves and 25 branch points\n");
console.log("maze   ahead  behind  left  right    plan     chosen entrance -> exit");
for (let n = 1; n <= 8; n += 1) {
  const o = optionsFor(n);
  all[n] = o;
  const want = PLAN[n];
  const pick = o[want][0];
  console.log(`maze-${n} ${String(o.ahead.length).padStart(6)}${String(o.behind.length).padStart(8)}` +
    `${String(o.left.length).padStart(6)}${String(o.right.length).padStart(7)}    ${want.padEnd(9)}` +
    (pick ? `${pick.ent.wall} ${pick.ent.x},${pick.ent.y} -> ${pick.ex.wall} ${pick.ex.x},${pick.ex.y}` : "NONE AVAILABLE"));
}

const missing = Object.keys(PLAN).filter((n) => !all[n][PLAN[n]].length);
if (missing.length) {
  console.log(`\n[!] no option for the planned bearing on maze ${missing.join(", ")} -- adjust PLAN`);
  process.exit(1);
}

if (!APPLY) { console.log("\nnothing written. re-run with --apply"); process.exit(0); }

for (let n = 1; n <= 8; n += 1) {
  const { src, g } = load(n);
  const { ent, ex } = all[n][PLAN[n]][0];
  const g2 = g.map((r) => r.slice());
  for (let i = 0; i < G; i += 1) { g2[0][i] = 1; g2[G - 1][i] = 1; g2[i][0] = 1; g2[i][G - 1] = 1; }
  g2[ent.y][ent.x] = 0;
  g2[ex.y][ex.x] = 0;

  const rows = g2.map((r) => `  "${r.join("")}",`).join("\n");
  let out = src.replace(/const WALL_ROWS = \[[\s\S]*?\n\];/, `const WALL_ROWS = [\n${rows}\n];`);
  out = out.replace(/start: \{ x: \d+, y: \d+ \}/, `start: { x: ${ent.inside.x}, y: ${ent.inside.y} }`);
  out = out.replace(/entrance: \{ x: \d+, y: \d+ \}/, `entrance: { x: ${ent.x}, y: ${ent.y} }`);
  out = out.replace(/startFacing: \d+/, `startFacing: ${FACING[ent.wall]}`);
  out = out.replace(/goal: \{ x: \d+, y: \d+ \}/, `goal: { x: ${ex.x}, y: ${ex.y} }`);
  fs.writeFileSync(path.join(dir, `maze-${n}.js`), out);
}
console.log("\nwritten. every stored route now ends at the wrong place -- rebuild:");
console.log("  for n in 1 2 3 4 5 6 7 8; do node mazes8/scripts/build-solutions.mjs maze-$n 6 --set=mazes8; done");
console.log("  bash mazes8/scripts/derive-all.sh");
