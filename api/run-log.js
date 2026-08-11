// Run records on Vercel, where the filesystem is ephemeral: a file written by a
// serverless function is gone by the next request, so error_logs/runs/ only works
// under the local server (server.js keeps that path for lab sessions).
//
// Talks to a Redis-compatible KV over its REST API using the two variables a Vercel
// KV / Upstash integration sets:
//     KV_REST_API_URL
//     KV_REST_API_TOKEN
// Commands go as a JSON array, which is the generic Upstash REST form, so this works
// with whichever of those the project ends up attached to and needs no SDK.
//
// One Redis list per participant, appended to, plus a set of ids so a session can be
// found later without knowing what it was called.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const safeId = (id) => String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
const listKey = (id) => `run:${id}`;
const INDEX_KEY = "runs";

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

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_e) { return {}; }
  }
  return req.body;
}

module.exports = async (req, res) => {
  // A closing tab sends its last rows by sendBeacon, which cannot set headers, so the
  // body may arrive as text even though it is JSON.
  if (req.method === "POST") {
    const body = parseBody(req);
    const id = safeId(body.participant_id);
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!id || !rows || !rows.length) {
      res.status(400).json({ status: "bad_request", message: "participant_id and a non-empty rows array are required." });
      return;
    }
    try {
      await kv(["RPUSH", listKey(id), ...rows.map((r) => JSON.stringify(r))]);
      await kv(["SADD", INDEX_KEY, id]);
      res.status(200).json({ status: "stored", participant_id: id, appended: rows.length });
    } catch (error) {
      // 503 rather than 500: the client keeps the rows queued and retries, and the
      // browser copy is still there, so this is "not yet" rather than "lost".
      res.status(503).json({ status: "kv_unavailable", message: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    const id = safeId((req.query && req.query.id) || "");
    try {
      if (!id) {
        const ids = (await kv(["SMEMBERS", INDEX_KEY])) || [];
        res.status(200).json({ runs: ids });
        return;
      }
      const raw = (await kv(["LRANGE", listKey(id), 0, -1])) || [];
      const events = raw.map((line) => { try { return JSON.parse(line); } catch (_e) { return null; } }).filter(Boolean);
      res.status(200).json({
        participant_id: id,
        rows: events.length,
        summaries: events.filter((r) => r.action === "maze_summary"),
        events,
      });
    } catch (error) {
      res.status(503).json({ status: "kv_unavailable", message: error.message });
    }
    return;
  }

  res.status(405).json({ status: "method_not_allowed", message: "Use POST or GET." });
};
