// Move each maze's exit, without touching its interior.
//
//   node mazes8/scripts/set-exits.mjs [--dry]
//
// Every maze had its exit in the same place -- bottom edge, column 11 -- so by the
// third trial a participant can head south and be roughly right without reading
// anything. That is a learnable shortcut sitting exactly where the disappear
// manipulation needs navigation to matter.
//
// Only a gap in a boundary wall moves, so the interior, and therefore the junction
// structure, is preserved: measured 24-25 junctions against 25 before. Path length is
// the real constraint, and each exit below was chosen because it keeps that maze at
// exactly 53 moves. A left-hand exit was not usable anywhere: the start sits top
// centre, so the left wall is simply nearer and every left exit came out at 35-47.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { G, START, isOpen, nbrs, key, dmap } from "./lib.mjs";

const DRY = process.argv.includes("--dry");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");

// maze -> [x, y] of the new gap, and the zone it reads as from inside
// Chosen to hold BOTH matched properties: every maze stays at 53 moves and 25 branch
// points. A fourth zone was reachable (a right-hand exit on maze-7) but only by
// dropping that maze to 24 branch points, and the set being matched is worth more than
// one extra direction -- three zones already break the "always south, same column"
// shortcut, which is the whole point.
const EXITS = {
  1: { cell: [11, 20], zone: "bottom" },
  2: { cell: [11, 20], zone: "bottom" },
  3: { cell: [11, 20], zone: "bottom" },
  4: { cell: [15, 20], zone: "bottom-right" },
  5: { cell: [7, 20],  zone: "bottom-left" },
  6: { cell: [11, 20], zone: "bottom" },
  7: { cell: [20, 15], zone: "bottom-right" },
  8: { cell: [7, 20],  zone: "bottom-left" },
};

console.log(`moving exits${DRY ? "  (dry run)" : ""}\n`);
console.log("maze   old exit   new exit   zone            path len   junctions   moved?");
let changed = 0;
for (let n = 1; n <= 8; n += 1) {
  const file = path.join(dir, `maze-${n}.js`);
  const src = fs.readFileSync(file, "utf8");
  const g = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  const oldGoal = {
    x: +src.match(/goal:\s*\{\s*x:\s*(\d+)/)[1],
    y: +src.match(/goal:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1],
  };
  const [nx, ny] = EXITS[n].cell;

  if (oldGoal.x !== nx || oldGoal.y !== ny) {
    g[oldGoal.y][oldGoal.x] = 1;     // wall the old gap back up
    g[ny][nx] = 0;                   // and open the new one
    changed += 1;
  }

  const len = dmap(g, START).get(key({ x: nx, y: ny }));
  let junctions = 0;
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (isOpen(g, x, y) && nbrs(g, x, y).length >= 3) junctions += 1;
  }
  const moved = oldGoal.x !== nx || oldGoal.y !== ny;
  console.log(`maze-${n}  ${(oldGoal.x+","+oldGoal.y).padEnd(11)}${(nx+","+ny).padEnd(11)}` +
    `${EXITS[n].zone.padEnd(16)}${String(len).padEnd(11)}${String(junctions).padEnd(12)}${moved ? "yes" : "no"}`);

  if (len !== 53) console.log(`   [!] maze-${n} is ${len} moves, not 53`);

  if (!DRY && moved) {
    const rows = g.map((r) => `  "${r.join("")}",`).join("\n");
    let out = src.replace(/const WALL_ROWS = \[[\s\S]*?\n\];/, `const WALL_ROWS = [\n${rows}\n];`);
    out = out.replace(/goal: \{ x: \d+, y: \d+ \}/, `goal: { x: ${nx}, y: ${ny} }`);
    fs.writeFileSync(file, out);
  }
}
console.log(`\n${changed} maze(s) changed`);
if (!DRY && changed) {
  console.log("every stored route ends at the OLD exit, so the hints must be rebuilt:");
  console.log("  node mazes8/scripts/build-solutions.mjs maze-N 6 --set=mazes8");
  console.log("  bash mazes8/scripts/derive-all.sh");
}
