// Which junctions have no cue, and CAN they ever get one?
//
//   node mazes8/scripts/uncovered.mjs [maze-2 ...]
//
// Hints are derived from start->goal routes, so a junction only gets a cue if some
// route walks through it. A junction sitting inside a dead-end pocket can never do
// that: you enter and must leave the same way, which is a revisit, so no simple route
// passes through it. More --merge passes cannot help those, and knowing which is which
// is the difference between "run it again" and "this is the ceiling".
//
// The test: from the junction, how many of its neighbours can reach the goal without
// passing back through the junction? Two or more means a route can pass through.
// Exactly one means it is a pocket -- reachable only as an out-and-back detour.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = ids.length ? ids : Array.from({ length: 8 }, (_v, i) => `maze-${i + 1}`);

console.log("maze     cued  uncovered  of those, reachable  pocket (never cueable)");
for (const id of targets) {
  const src = fs.readFileSync(path.join(dir, `${id}.js`), "utf8");
  const g = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  const G = g.length;
  const goal = {
    x: +src.match(/goal:\s*\{\s*x:\s*(\d+)/)[1],
    y: +src.match(/goal:\s*\{\s*x:\s*\d+,\s*y:\s*(\d+)/)[1],
  };
  const open = (x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
  const nbrs = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]]
    .map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter((c) => open(c.x, c.y));

  // can `from` reach the goal without ever stepping on `blocked`?
  const reachesGoal = (from, blocked) => {
    const seen = new Set([`${blocked.x},${blocked.y}`, `${from.x},${from.y}`]);
    const stack = [from];
    while (stack.length) {
      const c = stack.pop();
      if (c.x === goal.x && c.y === goal.y) return true;
      for (const n of nbrs(c.x, c.y)) {
        const k = `${n.x},${n.y}`;
        if (seen.has(k)) continue;
        seen.add(k); stack.push(n);
      }
    }
    return false;
  };

  const junctions = [];
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) {
    if (open(g, x, y) === undefined) continue;
    if (open(x, y) && nbrs(x, y).length >= 3) junctions.push({ x, y });
  }

  const sol = JSON.parse(fs.readFileSync(path.join(dir, "solutions", `${id}.json`), "utf8"));
  const covered = new Set();
  sol.routes.forEach((r) => r.path.forEach((c) => covered.add(`${c.x},${c.y}`)));

  const uncovered = junctions.filter((j) => !covered.has(`${j.x},${j.y}`));
  let pocket = 0, reachable = 0;
  const pocketList = [];
  for (const j of uncovered) {
    const ways = nbrs(j.x, j.y).filter((n) => reachesGoal(n, j)).length;
    if (ways >= 2) reachable += 1; else { pocket += 1; pocketList.push(`${j.x},${j.y}`); }
  }
  console.log(`${id.padEnd(9)}${String(junctions.length - uncovered.length).padStart(4)}` +
    `${String(uncovered.length).padStart(11)}${String(reachable).padStart(21)}${String(pocket).padStart(24)}` +
    (pocketList.length ? `   [${pocketList.join(" ")}]` : ""));
}
