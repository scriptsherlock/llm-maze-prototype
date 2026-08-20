require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const hintEngine = require("./lib/hint-engine");

const app = express();
const port = Number(process.env.PORT || 3000);
const { provider, model } = hintEngine;
const errorLogDir = path.join(__dirname, "error_logs");
const serverErrorLogPath = path.join(errorLogDir, "server_errors.jsonl");

let aiEnabled = true;
let sharedTrialState = null;

app.use(express.json({ limit: "80kb" }));
// public/ holds the frontend AND a static copy of three.js (public/vendor/three),
// so the same assets work locally and on a static host with no node_modules.
app.use(express.static(path.join(__dirname, "public")));

// The bare domain is what someone types or pastes, so it has to land on the study, not
// on the developer index of the eight mazes. No condition on the end: /study/participant
// asks the server for one, which is the anonymous-link behaviour.
app.get("/", (_req, res) => {
  res.redirect("/study/participant");
});

// The eight matched mazes, viewable individually.
app.get("/m8", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "mazes8.html"));
});

app.get(
  Array.from({ length: 8 }, (_v, i) => [`/m8-${i+1}/participant`, `/m8-${i+1}/moderator`]).flat(),
  (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  },
);

// The study run: all eight mazes back to back on one url. Which maze is showing is
// kept in the browser session, so the url never changes and cannot be skipped.
app.get("/study", (_req, res) => {
  res.redirect("/study/participant");
});

app.get(["/study/participant", "/study/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---- Run records -------------------------------------------------------------
// localStorage alone is not a record: it lives on the participant's machine and goes
// with the browser. Rows are posted here as the run proceeds and appended to one
// file per participant, so a session is recoverable even if nobody remembers to
// export it. Append-only and keyed by participant id, so a reconnect or a reload
// adds to the same file rather than replacing it.
const runLogDir = path.join(errorLogDir, "runs");

const safeId = (id) => String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

// Vercel runs everything under api/ as its own function; nothing else does. Mounting
// those same modules here means an ordinary Node host serves identical code, and the
// assign/export/delete routes exist everywhere rather than only in production.
//
// Always, now that lib/store.js falls back to a JSON file on disk. That fallback is the
// point for a server inside mainland China: reaching a store outside the country means
// an outbound call across the border on every write, which fails looking like lost data
// rather than a network problem. A server there keeps its data on its own disk.
const store = require("./lib/store.js");
app.all("/api/assign", require("./api/assign.js"));
app.all("/api/run-log", require("./api/run-log.js"));
console.log(`store: ${store.backend} (${store.location})`);

app.post("/api/run-log", (req, res) => {
  const id = safeId(req.body && req.body.participant_id);
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!id || !rows) {
    res.status(400).json({ status: "bad_request", message: "participant_id and rows are required." });
    return;
  }
  try {
    fs.mkdirSync(runLogDir, { recursive: true });
    const file = path.join(runLogDir, `${id}.jsonl`);
    fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    res.json({ status: "stored", participant_id: id, appended: rows.length });
  } catch (error) {
    res.status(500).json({ status: "write_failed", message: error.message });
  }
});

// Read paths match the Vercel function so one url works in both places: no id lists
// the runs, ?id=... or /api/run-log/<id> returns one.
app.get(["/api/run-log", "/api/run-log/:id"], (req, res) => {
  const id = safeId(req.params.id || (req.query && req.query.id));
  if (!id) {
    try {
      if (!fs.existsSync(runLogDir)) { res.json({ runs: [] }); return; }
      res.json({ runs: fs.readdirSync(runLogDir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, "")) });
    } catch (error) {
      res.status(500).json({ status: "read_failed", message: error.message });
    }
    return;
  }
  const file = path.join(runLogDir, `${id}.jsonl`);
  if (!id || !fs.existsSync(file)) {
    res.status(404).json({ status: "not_found", participant_id: id });
    return;
  }
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_e) { return null; }
  }).filter(Boolean);
  res.json({ participant_id: id, rows: rows.length, summaries: rows.filter((r) => r.action === "maze_summary"), events: rows });
});

// Who has run so far, newest first.
app.get("/api/runs", (_req, res) => {
  try {
    if (!fs.existsSync(runLogDir)) { res.json({ runs: [] }); return; }
    const runs = fs.readdirSync(runLogDir).filter((f) => f.endsWith(".jsonl")).map((f) => {
      const stat = fs.statSync(path.join(runLogDir, f));
      return { participant_id: f.replace(/\.jsonl$/, ""), bytes: stat.size, updated_at: stat.mtime.toISOString() };
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ status: "read_failed", message: error.message });
  }
});

app.get("/api/state", (_req, res) => {
  res.json({ ai_enabled: aiEnabled, provider, model });
});

app.get("/api/server-logs", (_req, res) => {
  res.json({ logs: readServerLogs(40) });
});

app.get("/api/trial-state", (_req, res) => {
  res.json({ state: sharedTrialState });
});

app.post("/api/trial-state", (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object") {
    res.status(400).json({ status: "bad_request", message: "state must be an object." });
    return;
  }

  sharedTrialState = { ...state, server_received_at: Date.now() };
  res.json({ status: "stored" });
});

app.post("/api/moderator/ai", (req, res) => {
  aiEnabled = Boolean(req.body && req.body.enabled);
  res.json({ ai_enabled: aiEnabled });
});

app.post("/api/hint", async (req, res) => {
  const startedAt = Date.now();

  if (!aiEnabled) {
    res.status(403).json({
      status: "ai_disabled",
      message: "AI assistance is disabled by the moderator.",
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  const credentialError = hintEngine.getCredentialError();
  if (credentialError) {
    res.status(503).json({
      status: "missing_api_key",
      message: credentialError,
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  const stateError = hintEngine.validateRequestState(req.body);
  if (stateError) {
    res.status(400).json({
      status: "bad_request",
      message: stateError,
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  try {
    const result = await hintEngine.requestValidatedPath(req.body, logServerError);
    res.json({ ...result, latency_ms: Date.now() - startedAt, provider, model });
  } catch (error) {
    logServerError("hint_request_failed", {
      provider,
      model,
      message: error.message || "The live LLM path request failed.",
      retry_count: error.retryCount || 0,
      validation_error: error.validationError || null,
      player: req.body && req.body.player,
      goal: req.body && req.body.goal,
      elapsed_ms: Date.now() - startedAt,
    });
    res.status(error.statusCode || 502).json({
      status: "llm_failed",
      message: error.message || "The live LLM path request failed.",
      retry_count: error.retryCount || 0,
      validation_error: error.validationError || null,
      latency_ms: Date.now() - startedAt,
    });
  }
});

function logServerError(action, details) {
  try {
    fs.mkdirSync(errorLogDir, { recursive: true });
    fs.appendFileSync(
      serverErrorLogPath,
      JSON.stringify({ timestamp_iso: new Date().toISOString(), action, ...details }) + "\n"
    );
  } catch (_error) {
    // Do not let logging failures break the participant flow.
  }
}

function readServerLogs(limit) {
  try {
    if (!fs.existsSync(serverErrorLogPath)) return [];
    const lines = fs.readFileSync(serverErrorLogPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit);

    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return { raw: line };
      }
    });
  } catch (error) {
    return [{
      timestamp_iso: new Date().toISOString(),
      action: "server_log_read_failed",
      message: error.message,
    }];
  }
}

function openInBrowser(url) {
  const command = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

app.listen(port, () => {
  console.log(`LLM maze prototype running at http://localhost:${port}`);
  // Only auto-open when launched via the clickable launcher (OPEN_BROWSER=1),
  // so `npm start` and the test scripts stay quiet.
  if (process.env.OPEN_BROWSER === "1") {
    openInBrowser(`http://localhost:${port}/participant`);
    openInBrowser(`http://localhost:${port}/moderator`);
  }
});
