// Hand out a participant id and a condition, so everyone can be sent ONE link.
//
//   GET /api/assign  ->  { participant_id: "P007", condition: "disappear", n: 7 }
//
// This is the anonymous-link pattern: the invitation carries no identity, and the
// study assigns one on arrival. The alternative -- a unique pre-built link per person
// -- needs a contact list before recruitment and breaks if anyone forwards their link.
//
// Balance is the reason this lives on the server. A coin flip in the browser drifts:
// with 30 participants a uniform random choice lands three ways unevenly often enough
// to matter. A counter in the store cannot drift, because INCR is atomic -- two people
// arriving in the same second get 7 and 8, never 7 twice.
//
// Within that, assignment is still randomised: conditions are dealt in blocks of three
// and each block is permuted from its own index, so the groups are equal after every
// third participant and the order is not a repeating cycle anyone could predict.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const CONDITIONS = ["no_ai", "stable_ai", "disappear"];
const COUNTER_KEY = "study:assigned";
const ASSIGN_LOG = "study:assignments";

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV is not configured for this deployment.");
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `KV HTTP ${response.status}`);
  return data.result;
}

// Permute one block of three from its index. Deterministic, so the whole allocation can
// be reproduced from the counter alone for the writeup -- no separate record to lose.
function blockOrder(block) {
  // splitmix32. A plain LCG was tried here and every block came out in the SAME order,
  // which is balanced but a fixed repeating cycle -- exactly what randomising is for.
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
  try {
    const n = Number(await kv(["INCR", COUNTER_KEY]));
    const condition = blockOrder(Math.floor((n - 1) / CONDITIONS.length))[(n - 1) % CONDITIONS.length];
    const participant_id = `P${String(n).padStart(3, "0")}`;

    // Written before the participant does anything, so someone who opens the link and
    // leaves still appears in the allocation. Without it, dropouts would be invisible
    // and the groups would look balanced when they were not.
    await kv(["RPUSH", ASSIGN_LOG, JSON.stringify({ participant_id, condition, n, at: new Date().toISOString() })]);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ participant_id, condition, n });
  } catch (error) {
    // No silent fallback to a random condition: an unbalanced study that looks fine is
    // worse than a link that plainly refuses.
    res.status(503).json({ status: "kv_unavailable", message: error.message });
  }
};
