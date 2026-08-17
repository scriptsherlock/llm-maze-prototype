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

    // ?health=1 answers whether the store is attached and actually reachable, so a
    // deployment can be checked without running a participant through it.
    if (req.query && req.query.health) {
      const configured = Boolean(KV_URL && KV_TOKEN);
      if (!configured) {
        res.status(503).json({ ok: false, configured: false,
          message: "KV_REST_API_URL and KV_REST_API_TOKEN are not set for this deployment." });
        return;
      }
      try {
        await kv(["SET", "healthcheck", new Date().toISOString()]);
        const value = await kv(["GET", "healthcheck"]);
        const runs = (await kv(["SMEMBERS", INDEX_KEY])) || [];
        res.status(200).json({ ok: true, configured: true, wrote_and_read_back: value, runs_stored: runs.length });
      } catch (error) {
        res.status(503).json({ ok: false, configured: true, message: error.message });
      }
      return;
    }

    // ?export=summaries|events|json collects every stored run and returns one file.
    // Aggregating here rather than in the browser means the moderator can download the
    // whole study from a plain link, without having run any of the sessions themselves
    // -- the existing Save CSV buttons only ever saw the current tab's own rows.
    // &condition=no_ai narrows the file to one group, so each condition can be pulled
    // as its own dataset rather than filtered by hand afterwards. Filtering on the row
    // rather than the id, because the id format has changed once already.
    if (req.query && req.query.export) {
      const kind = String(req.query.export).toLowerCase();
      const onlyCondition = String((req.query && req.query.condition) || "").trim().toLowerCase();
      try {
        const ids = (await kv(["SMEMBERS", INDEX_KEY])) || [];
        const records = [];
        for (const runId of ids) {
          const raw = (await kv(["LRANGE", listKey(runId), 0, -1])) || [];
          const events = raw.map((line) => { try { return JSON.parse(line); } catch (_e) { return null; } }).filter(Boolean);
          records.push({ participant_id: runId, rows: events.length, events });
        }
        const stamp = new Date().toISOString().slice(0, 10);

        const tag = onlyCondition ? `-${onlyCondition}` : "";
        if (kind === "json") {
          const out = onlyCondition
            ? records.filter((r) => r.events.some((e) => e.condition === onlyCondition))
            : records;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Disposition", `attachment; filename="llm-maze-runs${tag}-${stamp}.json"`);
          res.status(200).send(JSON.stringify(out, null, 2));
          return;
        }

        const all = kind === "events"
          ? records.flatMap((r) => r.events.map((e) => ({ participant_id: r.participant_id, ...e })))
          : records.flatMap((r) => r.events.filter((e) => e.action === "maze_summary")
              .map((e) => ({ participant_id: r.participant_id, ...e })));
        const wanted = onlyCondition ? all.filter((r) => r.condition === onlyCondition) : all;

        // Columns from the union of keys present, so a field added to the summary
        // later still comes out without touching this.
        const cols = [...new Set(wanted.flatMap((r) => Object.keys(r)))];
        const esc = (v) => {
          if (v === null || v === undefined) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [cols.join(","), ...wanted.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="llm-maze-${kind}${tag}-${stamp}.csv"`);
        res.status(200).send(csv);
      } catch (error) {
        res.status(503).json({ status: "kv_unavailable", message: error.message });
      }
      return;
    }

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

  // Removing a run: pilot data before collection starts, and a participant who withdraws
  // consent afterwards, which is an ethics requirement rather than a convenience.
  // DELETE rather than a GET parameter on purpose -- a URL that erases data should not
  // be something a browser can follow, prefetch, or leave sitting in history.
  //
  // Unauthenticated, like the rest of this endpoint. That is fine for a pilot and not
  // fine once real data is in: anyone with the URL can erase the study.
  if (req.method === "DELETE") {
    const target = safeId((req.query && req.query.id) || "");
    const wipe = req.query && req.query.confirm === "DELETE-ALL";
    if (!target && !wipe) {
      res.status(400).json({ status: "bad_request", message: "Pass ?id=<participant> to remove one run, or ?confirm=DELETE-ALL to clear the store." });
      return;
    }
    try {
      const ids = target ? [target] : ((await kv(["SMEMBERS", INDEX_KEY])) || []);
      for (const runId of ids) {
        await kv(["DEL", listKey(runId)]);
        await kv(["SREM", INDEX_KEY, runId]);
      }
      // The assignment counter and log are separate keys, so a wipe that left them
      // behind would restart ids at P004 with three dead entries in the allocation.
      if (wipe) await kv(["DEL", "study:assigned", "study:assignments"]);
      res.status(200).json({ status: "deleted", removed: ids, reset_assignment: Boolean(wipe) });
    } catch (error) {
      res.status(503).json({ status: "kv_unavailable", message: error.message });
    }
    return;
  }

  res.status(405).json({ status: "method_not_allowed", message: "Use POST, GET or DELETE." });
};
