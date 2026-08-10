// How good are the generated hints, measured against BFS ground truth?
//
//   node mazes8/scripts/audit-hints.mjs
//
// Three things matter, and they are not the same thing:
//   1. is the stated distance the true distance
//   2. does the cue name the branch that is genuinely shortest — including when the
//      better branch is one the AI never covered, so the cue stays SILENT about it
//   3. how much of each maze is covered at all
// (2) is the one that misleads a participant, and the one an audit that only compares
// claimed branches will miss entirely.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { G, GOAL, isOpen, nbrs, dmap, key } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const dir = path.join(root, "public", "mazes8");

const ids = Array.from({ length: 8 }, (_v, i) => `maze-${i+1}`)
  .filter((id) => fs.existsSync(path.join(dir, "hints", `${id}.json`)));
if (!ids.length) { console.error("no hint files yet — run build-solutions then derive-hints"); process.exit(1); }

const T = { branches: 0, exact: 0, over: 0, under: 0, silent: 0, junctions: 0, misled: 0, single: 0 };
const misleading = [];

console.log("maze     junctions  cued  branches  exact  overstated  understated  silent  misleading");
for (const id of ids) {
  const src = fs.readFileSync(path.join(dir, `${id}.js`), "utf8");
  const g = src.match(/"[01]+"/g).map((s)=>s.replace(/"/g,"")).map((r)=>r.split("").map(Number));
  const hints = JSON.parse(fs.readFileSync(path.join(dir, "hints", `${id}.json`), "utf8"));

  let allJunctions = 0;
  for (let y=1;y<G;y+=2) for (let x=1;x<G;x+=2) {
    if (isOpen(g,x,y) && nbrs(g,x,y).length >= 3) allJunctions += 1;
  }
  let exact=0, over=0, under=0, silent=0, misled=0, single=0;
  for (const j of hints.junctions) {
    const bl = new Set([`${j.x},${j.y}`]);
    const truth = new Map();
    for (const n of nbrs(g, j.x, j.y)) {
      const d = dmap(g, n, `${j.x},${j.y}`).get(key(GOAL));
      truth.set(key(n), d == null ? Infinity : 1 + d);
    }
    const claimed = j.branches.filter((b) => b.verdict !== "dead_end" && Number.isFinite(b.steps));
    silent += [...truth.keys()].filter((k) => !j.branches.some((b) => key(b) === k)).length;
    for (const b of claimed) {
      const t = truth.get(key(b));
      if (!Number.isFinite(t)) continue;
      if (b.steps === t) exact += 1; else if (b.steps > t) over += 1; else under += 1;
    }
    if (!claimed.length) continue;
    if (claimed.length < 2) single += 1;
    const rec = claimed.reduce((a,b) => (b.steps < a.steps ? b : a));
    const bestTrue = Math.min(...truth.values());
    if (Number.isFinite(truth.get(key(rec))) && truth.get(key(rec)) > bestTrue) {
      misled += 1;
      const better = [...truth.entries()].filter(([,d]) => d === bestTrue)
        .map(([k]) => `${k}${j.branches.some((b)=>key(b)===k) ? "" : " SILENT"}`).join(" ");
      misleading.push(`${id} (${j.x},${j.y}): points at (${rec.x},${rec.y})=${rec.steps} ` +
        `[true ${truth.get(key(rec))}], but ${better} is ${bestTrue}  (+${truth.get(key(rec)) - bestTrue})` +
        `${claimed.length < 2 ? "  — single cue" : ""}`);
    }
  }
  const nB = exact + over + under;
  T.branches += nB; T.exact += exact; T.over += over; T.under += under;
  T.silent += silent; T.junctions += allJunctions; T.misled += misled; T.single += single;
  console.log(`${id.padEnd(9)}${String(allJunctions).padEnd(11)}${String(hints.junctions.length).padEnd(6)}` +
    `${String(nB).padEnd(10)}${String(exact).padEnd(7)}${String(over).padEnd(12)}${String(under).padEnd(13)}` +
    `${String(silent).padEnd(8)}${misled}`);
}

console.log(`\ntotals across ${ids.length} mazes`);
console.log(`  branches with a claim : ${T.branches}   (${T.silent} branches left silent)`);
console.log(`  distance exact        : ${T.exact}/${T.branches}` +
  `  (${T.over} overstated, ${T.under} UNDERSTATED)`);
console.log(`  junctions cued        : ${T.junctions ? "" : ""}${T.single} of them show a single cue`);
console.log(`  cue points the wrong way at ${T.misled} junction(s)`);
if (T.under) console.log(`\n  [!] an understated distance claims a branch is closer than it can be — always a bug`);
if (misleading.length) {
  console.log("\njunctions where the cue does not name the truly shortest branch:");
  for (const m of misleading) console.log("  " + m);
}
