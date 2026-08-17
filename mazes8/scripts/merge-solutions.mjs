// Union verified routes from a second solutions folder into the live one. No AI calls.
//
//   node mazes8/scripts/merge-solutions.mjs <other-solutions-dir> [--set=mazes8]
//
// build-solutions.mjs --merge only accumulates across runs of ITSELF, so a set that was
// regenerated from scratch loses every earlier pass. Coverage is what makes the derived
// hints trustworthy -- a branch no route walks gets no cue, and the junction then
// recommends whatever it does know about -- so throwing away verified routes costs
// accuracy for nothing.
//
// Every route on both sides was re-walked against the grid before it was written, and
// the mazes have not changed, so the union is sound without re-validating. It is
// re-validated anyway: a silently corrupt route would poison every hint derived from it.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const argv = process.argv.slice(2);
const SET = (argv.find((a) => a.startsWith("--set=")) || "--set=mazes8").split("=")[1];
const other = argv.find((a) => !a.startsWith("--"));
if (!other) { console.error("usage: merge-solutions.mjs <other-solutions-dir> [--set=mazes8]"); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const liveDir = path.join(root, "public", SET, "solutions");

const sig = (r) => r.path.map((c) => `${c.x},${c.y}`).join(">");
let totalBefore = 0, totalAfter = 0;

for (let n = 1; n <= 8; n += 1) {
  const id = `maze-${n}`;
  const liveFile = path.join(liveDir, `${id}.json`);
  const otherFile = path.join(other, `${id}.json`);
  if (!fs.existsSync(liveFile) || !fs.existsSync(otherFile)) { console.log(`${id}: missing a side, skipped`); continue; }

  const live = JSON.parse(fs.readFileSync(liveFile, "utf8"));
  const incoming = JSON.parse(fs.readFileSync(otherFile, "utf8"));

  const mod = await import(`file://${path.join(root, "public", SET, `${id}.js`).replace(/\\/g, "/")}`);
  const config = Object.values(mod).find((v) => v && typeof v === "object" && v.maze);
  const g = config.maze, G = g.length;
  const isOpen = (x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
  const deg = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => isOpen(x + dx, y + dy)).length;

  // Re-walk rather than trust the file: start, goal, openness, unit steps, no revisits.
  const walkable = (r) => {
    const p = r.path;
    if (!Array.isArray(p) || p.length < 2) return false;
    if (p[0].x !== config.start.x || p[0].y !== config.start.y) return false;
    const last = p[p.length - 1];
    if (last.x !== config.goal.x || last.y !== config.goal.y) return false;
    const seen = new Set();
    for (let i = 0; i < p.length; i += 1) {
      const c = p[i], k = `${c.x},${c.y}`;
      if (!isOpen(c.x, c.y) || seen.has(k)) return false;
      seen.add(k);
      if (i && Math.abs(c.x - p[i - 1].x) + Math.abs(c.y - p[i - 1].y) !== 1) return false;
    }
    return true;
  };

  const seen = new Set(live.routes.map(sig));
  let added = 0, rejected = 0;
  const merged = [...live.routes];
  for (const r of incoming.routes) {
    if (seen.has(sig(r))) continue;
    if (!walkable(r)) { rejected += 1; continue; }
    seen.add(sig(r));
    merged.push({ ...r, steps: r.path.length - 1 });
    added += 1;
  }
  merged.sort((a, b) => a.steps - b.steps);

  const covered = new Set();
  merged.forEach((r) => r.path.forEach((c) => covered.add(`${c.x},${c.y}`)));
  const all = [];
  for (let y = 1; y < G; y += 2) for (let x = 1; x < G; x += 2) if (isOpen(x, y) && deg(x, y) >= 3) all.push(`${x},${y}`);
  const before = new Set();
  live.routes.forEach((r) => r.path.forEach((c) => before.add(`${c.x},${c.y}`)));
  const hitBefore = all.filter((k) => before.has(k)).length;
  const hitAfter = all.filter((k) => covered.has(k)).length;
  totalBefore += hitBefore; totalAfter += hitAfter;

  fs.writeFileSync(liveFile, JSON.stringify({
    ...live,
    merged_at: new Date().toISOString(),
    // The set is no longer the output of one model, and pretending otherwise in the
    // provenance would misdescribe where the hints came from.
    model: live.model === incoming.model ? live.model : `${live.model}+${incoming.model}`,
    routes: merged,
  }, null, 2));

  console.log(`${id}: ${live.routes.length} + ${added} new = ${merged.length} routes` +
    `  coverage ${hitBefore}/${all.length} -> ${hitAfter}/${all.length}` +
    (rejected ? `  (${rejected} incoming route(s) failed re-validation)` : ""));
}

console.log(`\ntotal junction coverage: ${totalBefore}/200 -> ${totalAfter}/200`);
