// Build the participant links, balanced across the three conditions.
//
//   node mazes8/scripts/make-links.mjs 30 https://<deployment>.vercel.app
//   node mazes8/scripts/make-links.mjs 30 https://... --prefix=P --seed=7
//
// Writes error_logs/participants.csv: pid, condition, url. That file IS the allocation
// record -- which participant was assigned to which condition, decided before anyone
// ran anything, rather than reconstructed from the results afterwards.
//
// Why generate them at all, rather than typing links: the id has to be in the URL. An
// auto-minted id (p_msx6ln10_uirew9) cannot be joined to a recruitment sheet or to a
// questionnaire response, and that is not fixable after the run.
import fs from "fs";
import path from "path";

const CONDITIONS = ["no_ai", "stable_ai", "disappear"];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const positional = argv.filter((a) => !a.startsWith("--"));
const count = Number(positional[0]);
const base = (positional[1] || "").replace(/\/$/, "");
const prefix = flag("prefix", "P");
const seed = Number(flag("seed", 1));
const outFile = flag("out", "error_logs/participants.csv");

if (!Number.isInteger(count) || count < 1 || !base) {
  console.error("usage: make-links.mjs <count> <base-url> [--prefix=P] [--seed=1] [--out=path]");
  process.exit(1);
}
if (count % CONDITIONS.length !== 0) {
  console.warn(`note: ${count} does not divide by ${CONDITIONS.length}, so the groups will differ by one.`);
}

// Deterministic shuffle, so re-running with the same seed reproduces the same
// allocation. A study that cannot regenerate its own assignment is hard to write up.
let state = seed >>> 0 || 1;
const rand = () => {
  state ^= state << 13; state >>>= 0;
  state ^= state >> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0xffffffff;
};

// Block randomisation: fill whole blocks of the three conditions and shuffle within
// each block, so the groups stay balanced even if recruitment stops early.
const assignment = [];
for (let i = 0; i < count; i += CONDITIONS.length) {
  const block = CONDITIONS.slice(0, Math.min(CONDITIONS.length, count - i));
  for (let j = block.length - 1; j > 0; j -= 1) {
    const k = Math.floor(rand() * (j + 1));
    [block[j], block[k]] = [block[k], block[j]];
  }
  assignment.push(...block);
}

const pad = String(count).length;
const rows = assignment.map((condition, i) => {
  const pid = `${prefix}${String(i + 1).padStart(pad, "0")}`;
  return { pid, condition, url: `${base}/study/participant?pid=${pid}&condition=${condition}` };
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ["pid,condition,url", ...rows.map((r) => `${r.pid},${r.condition},${r.url}`)].join("\n"));

const tally = CONDITIONS.map((c) => `${c} ${rows.filter((r) => r.condition === c).length}`).join("  |  ");
console.log(`${rows.length} links, seed ${seed}`);
console.log(`  ${tally}`);
console.log(`\nfirst three:`);
rows.slice(0, 3).forEach((r) => console.log(`  ${r.pid}  ${r.url}`));
console.log(`\nwrote ${outFile}`);
