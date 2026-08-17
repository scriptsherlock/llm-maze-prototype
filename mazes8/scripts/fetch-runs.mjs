// Pull every stored run out of the deployment's KV and write them locally, so analysis
// happens on a file rather than against a live endpoint.
//
//   node mazes8/scripts/fetch-runs.mjs https://<deployment>.vercel.app [outdir]
//
// Writes <outdir>/runs.json (everything) and <outdir>/summaries.csv (one row per
// completed maze, which is the unit most of the analysis is about).
import fs from "fs";
import path from "path";

const base = (process.argv[2] || "").replace(/\/$/, "");
const outDir = process.argv[3] || "error_logs/kv-export";
if (!base) { console.error("usage: fetch-runs.mjs <deployment-url> [outdir]"); process.exit(1); }

const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.json();
};

const { runs = [] } = await get(`${base}/api/run-log`);
console.log(`${runs.length} run(s) stored`);

const all = [];
for (const id of runs) {
  const rec = await get(`${base}/api/run-log?id=${encodeURIComponent(id)}`);
  all.push(rec);
  console.log(`  ${id}: ${rec.rows} rows, ${(rec.summaries || []).length} maze summary(s)`);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(all, null, 2));

// One row per completed maze. Columns are taken from the union of keys actually
// present rather than a fixed list, so a summary field added later still comes out.
const rows = all.flatMap((r) => (r.summaries || []).map((s) => ({ participant_id: r.participant_id, ...s })));
if (rows.length) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(path.join(outDir, "summaries.csv"),
    [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
}

console.log(`\nwrote ${outDir}/runs.json (${all.length} runs) and ${outDir}/summaries.csv (${rows.length} maze rows)`);
