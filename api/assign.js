// Hand out a participant id, and a condition if the link did not already fix one.
//
//   GET /api/assign?condition=no_ai  ->  { participant_id: "no_ai-001", condition: "no_ai" }
//   GET /api/assign                  ->  { participant_id: "disappear-004", condition: "disappear" }
//
// Two ways to run the study, and the link chooses which:
//
//   ONE LINK PER CONDITION (?condition=... on the invitation). The condition is fixed
//   by which link a participant was sent, so each group is a separate recruitment with
//   a separate dataset. Ids are numbered per condition and carry it -- "no_ai-001" --
//   so a row is attributable from the id alone, with no join needed to read a CSV.
//
//   ONE LINK FOR EVERYONE (no ?condition). The server assigns, balanced in permuted
//   blocks of three. More like a real deployment, and the only way to keep allocation
//   out of the recruiter's hands, but the groups are then interleaved in one dataset.
//
// Either way the ID comes from here rather than the browser. A page that mints its own
// gets an id nothing else knows about, which is where the stray "p_msxb389n_3cc324"
// records came from: real rows, no condition, attributable to nobody.
const { kv } = require("../lib/store.js");

const CONDITIONS = ["no_ai", "stable_ai", "disappear"];

// Two deployments means two counters that both start at 1, so both would hand out
// "no_ai-001" to different people and the datasets could not be concatenated. SITE_CODE
// goes in the id -- "no_ai-cn-001" against "no_ai-001" -- so the merged file is unique
// on participant_id and every row still says where it was collected.
const SITE_CODE = String(process.env.SITE_CODE || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const BALANCED_COUNTER = "study:assigned";
const counterFor = (condition) => `study:assigned:${condition}`;
const ASSIGN_LOG = "study:assignments";

// Permute one block of three from its index, so the groups are equal after every third
// participant without the order being a repeating cycle. splitmix32: a plain LCG was
// tried here and dealt every block in the SAME order, which is balanced but predictable.
function blockOrder(block) {
  let h = block + 1;
  const next = () => {
    h = (h + 0x9e3779b9) | 0;
    let t = h ^ (h >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
  const pool = [...CONDITIONS];
  const out = [];
  while (pool.length) out.push(...pool.splice(Math.floor(next() * pool.length), 1));
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ status: "method_not_allowed", message: "Use GET." });
    return;
  }
  const asked = String((req.query && req.query.condition) || "").trim().toLowerCase();
  if (asked && !CONDITIONS.includes(asked)) {
    // Same reasoning as the client-side guard: a misspelled condition is a broken link
    // someone built, and guessing would hide it behind a run that looks normal.
    res.status(400).json({ status: "bad_request", message: `Unknown condition "${asked}".` });
    return;
  }

  try {
    let condition = asked;
    let n;
    if (condition) {
      // Numbered within its own condition, so each link produces its own 001, 002, ...
      n = Number(await kv(["INCR", counterFor(condition)]));
    } else {
      const overall = Number(await kv(["INCR", BALANCED_COUNTER]));
      condition = blockOrder(Math.floor((overall - 1) / CONDITIONS.length))[(overall - 1) % CONDITIONS.length];
      n = Number(await kv(["INCR", counterFor(condition)]));
    }
    // Site first, so ids group and sort by where they were collected: cn-no_ai-001.
    // Hyphen between the segments, not underscore -- "no_ai" and "stable_ai" already
    // contain underscores, so splitting an id on "_" would not give back its parts.
    const participant_id = SITE_CODE
      ? `${SITE_CODE}-${condition}-${String(n).padStart(3, "0")}`
      : `${condition}-${String(n).padStart(3, "0")}`;

    // Written before the participant does anything, so someone who opens the link and
    // leaves still appears in the allocation. Without it, dropouts are invisible and
    // the groups look balanced when they are not.
    await kv(["RPUSH", ASSIGN_LOG, JSON.stringify({
      participant_id, condition, n, site: SITE_CODE || "default", assigned_by: asked ? "link" : "server", at: new Date().toISOString(),
    })]);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ participant_id, condition, n, site: SITE_CODE || "default", assigned_by: asked ? "link" : "server" });
  } catch (error) {
    // No silent fallback to a random condition: an unbalanced study that looks fine is
    // worse than a link that plainly refuses.
    res.status(503).json({ status: "kv_unavailable", message: error.message });
  }
};
