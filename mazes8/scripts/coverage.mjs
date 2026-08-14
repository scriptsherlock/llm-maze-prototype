// Junction coverage of the stored routes, without re-running any AI.
//
//   node mazes8/scripts/coverage.mjs
//
// Coverage is the number that decides whether the derived hints are trustworthy: a
// junction no verified route walks gets no cue, and the game then recommends the best
// branch it happens to know about, which need not be the best branch.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");

console.log("maze   routes  steps      coverage   model");
for (let n = 1; n <= 8; n += 1) {
  const mod = await import(`file://${path.join(dir, `maze-${n}.js`).replace(/\\/g, "/")}`);
  const cfg = Object.values(mod).find((v) => v && typeof v === "object" && v.maze);
  const g = cfg.maze;
  const G = g.length;
  const open = (x, y) => y >= 0 && y < G && x >= 0 && x < G && g[y][x] === 0;
  const deg = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => open(x + dx, y + dy)).length;

  const junctions = [];
  for (let y = 1; y < G; y += 2) {
    for (let x = 1; x < G; x += 2) if (open(x, y) && deg(x, y) >= 3) junctions.push(`${x},${y}`);
  }

  const file = path.join(dir, "solutions", `maze-${n}.json`);
  if (!fs.existsSync(file)) { console.log(`maze-${n}  (no solutions file)`); continue; }
  const d = JSON.parse(fs.readFileSync(file, "utf8"));

  const covered = new Set();
  d.routes.forEach((r) => r.path.forEach((c) => covered.add(`${c.x},${c.y}`)));
  const hit = junctions.filter((k) => covered.has(k)).length;
  const steps = d.routes.map((r) => r.steps);
  const range = steps.length ? `${Math.min(...steps)}-${Math.max(...steps)}` : "-";

  console.log(
    `maze-${n}  ${String(d.routes.length).padStart(4)}    ${range.padEnd(9)}  ` +
    `${String(hit).padStart(2)}/${junctions.length}      ${d.model}`,
  );
}
