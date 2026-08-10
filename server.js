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
const aiCuesPath = path.join(errorLogDir, "ai_cues.json");

let aiEnabled = true;
let sharedTrialState = null;

app.use(express.json({ limit: "80kb" }));
// public/ holds the frontend AND a static copy of three.js (public/vendor/three),
// so the same assets work locally and on a static host with no node_modules.
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.redirect("/participant");
});

app.get(["/participant", "/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Original 7x7 maze served at its own hyperlink. Same page/logic as the default
// maze; maze.js selects the original grid because the path contains "original".
app.get("/original", (_req, res) => {
  res.redirect("/original/participant");
});

app.get(["/original/participant", "/original/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 10x10 "AI disappears" maze at its own hyperlink. Same page/logic; maze.js
// selects the disappear grid because the path contains "disappear".
app.get("/disappear", (_req, res) => {
  res.redirect("/disappear/participant");
});

app.get(["/disappear/participant", "/disappear/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// The two study conditions: matched 10x10 mazes, one with AI hints and one without.
app.get("/ai-maze", (_req, res) => {
  res.redirect("/ai-maze/participant");
});

app.get("/no-ai-maze", (_req, res) => {
  res.redirect("/no-ai-maze/participant");
});

app.get([
  "/ai-maze/participant", "/ai-maze/moderator",
  "/no-ai-maze/participant", "/no-ai-maze/moderator",
], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// The four study mazes, viewable individually.
app.get([
  "/maze-0/participant", "/maze-0/moderator",
  "/maze-1/participant", "/maze-1/moderator",
  "/maze-2/participant", "/maze-2/moderator",
  "/maze-3/participant", "/maze-3/moderator",
  "/maze-a/participant", "/maze-a/moderator",
  "/maze-b/participant", "/maze-b/moderator",
  "/maze-c/participant", "/maze-c/moderator",
  "/maze-d/participant", "/maze-d/moderator",
], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// The matched set of eight (mazes8/), viewable individually while it is reviewed.
app.get("/m8", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "mazes8.html"));
});

app.get(
  Array.from({ length: 8 }, (_v, i) => [`/m8-${i+1}/participant`, `/m8-${i+1}/moderator`]).flat(),
  (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  },
);


// The study run: the four mazes back to back on one url. Which maze is showing is
// kept in the browser session, so the url never changes and cannot be skipped.
app.get("/study", (_req, res) => {
  res.redirect("/study/participant");
});

app.get(["/study/participant", "/study/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/state", (_req, res) => {
  res.json({ ai_enabled: aiEnabled, provider, model });
});

app.get("/api/server-logs", (_req, res) => {
  res.json({ logs: readServerLogs(40) });
});

// The most recent AI-produced junction cues (ai mode). Viewable in the browser
// at /api/ai-cues; also written to error_logs/ai_cues.json on disk.
app.get("/api/ai-cues", (_req, res) => {
  try {
    if (!fs.existsSync(aiCuesPath)) {
      res.json({ status: "empty", message: "No AI cues yet — run a trial with ?cues=ai." });
      return;
    }
    res.type("application/json").send(fs.readFileSync(aiCuesPath, "utf8"));
  } catch (error) {
    res.status(500).json({ status: "read_failed", message: error.message });
  }
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

// v5: the AI evaluates the branches at a junction (route-evaluation mechanic).
app.post("/api/route-eval", async (req, res) => {
  const startedAt = Date.now();
  if (!aiEnabled) {
    res.status(403).json({ status: "ai_disabled", message: "AI assistance is disabled.", latency_ms: Date.now() - startedAt });
    return;
  }
  const credentialError = hintEngine.getCredentialError();
  if (credentialError) {
    res.status(503).json({ status: "missing_api_key", message: credentialError, latency_ms: Date.now() - startedAt });
    return;
  }
  const stateError = hintEngine.validateRouteRequest(req.body);
  if (stateError) {
    res.status(400).json({ status: "bad_request", message: stateError, latency_ms: Date.now() - startedAt });
    return;
  }
  try {
    const result = await hintEngine.evaluateRoutes(req.body, logServerError);
    res.json({ ...result, latency_ms: Date.now() - startedAt });
  } catch (error) {
    logServerError("route_eval_failed", { provider, model, message: error.message, player: req.body && req.body.player, goal: req.body && req.body.goal });
    res.status(error.statusCode || 502).json({ status: "llm_failed", message: error.message || "Route evaluation failed.", latency_ms: Date.now() - startedAt });
  }
});

// v5: evaluate ALL junctions at once (precomputed at trial start).
app.post("/api/route-eval-batch", async (req, res) => {
  const startedAt = Date.now();
  if (!aiEnabled) {
    res.status(403).json({ status: "ai_disabled", message: "AI assistance is disabled.", latency_ms: Date.now() - startedAt });
    return;
  }
  const credentialError = hintEngine.getCredentialError();
  if (credentialError) {
    res.status(503).json({ status: "missing_api_key", message: credentialError, latency_ms: Date.now() - startedAt });
    return;
  }
  const stateError = hintEngine.validateBatchRequest(req.body);
  if (stateError) {
    res.status(400).json({ status: "bad_request", message: stateError, latency_ms: Date.now() - startedAt });
    return;
  }
  try {
    const result = await hintEngine.evaluateJunctionsBatch(req.body, logServerError);
    saveAiCues(req.body, result);
    res.json({ ...result, latency_ms: Date.now() - startedAt });
  } catch (error) {
    logServerError("route_eval_batch_failed", { provider, model, message: error.message });
    res.status(error.statusCode || 502).json({ status: "llm_failed", message: error.message || "Batch route evaluation failed.", latency_ms: Date.now() - startedAt });
  }
});

// Persist the AI's raw junction cues so they can be inspected (and later refined).
function saveAiCues(request, result) {
  try {
    fs.mkdirSync(errorLogDir, { recursive: true });
    const payload = {
      generated_at: new Date().toISOString(),
      provider,
      model,
      goal: request && request.goal,
      status: result && result.status,
      junctions: (result && result.junctions) || [],
    };
    fs.writeFileSync(aiCuesPath, JSON.stringify(payload, null, 2));
  } catch (_error) {
    // Never let cue-logging break the participant flow.
  }
}

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
