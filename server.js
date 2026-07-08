require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const requestedProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const provider = ["openai", "venice", "gemini"].includes(requestedProvider)
  ? requestedProvider
  : "openai";
const model = getModelForProvider();
const hintTimeoutMs = 20000;
const errorLogDir = path.join(__dirname, "error_logs");
const serverErrorLogPath = path.join(errorLogDir, "server_errors.jsonl");

let aiEnabled = true;
let sharedTrialState = null;

app.use(express.json({ limit: "80kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three", "build")));

app.get("/", (_req, res) => {
  res.redirect("/participant");
});

app.get(["/participant", "/moderator"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/state", (_req, res) => {
  res.json({ ai_enabled: aiEnabled, provider, model });
});

app.get("/api/server-logs", (_req, res) => {
  res.json({
    logs: readServerLogs(40),
  });
});

app.get("/api/trial-state", (_req, res) => {
  res.json({
    state: sharedTrialState,
  });
});

app.post("/api/trial-state", (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object") {
    res.status(400).json({ status: "bad_request", message: "state must be an object." });
    return;
  }

  sharedTrialState = {
    ...state,
    server_received_at: Date.now(),
  };
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

  const credentialError = getCredentialError();
  if (credentialError) {
    res.status(503).json({
      status: "missing_api_key",
      message: credentialError,
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  const stateError = validateRequestState(req.body);
  if (stateError) {
    res.status(400).json({
      status: "bad_request",
      message: stateError,
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  try {
    const result = await requestValidatedPath(req.body);
    res.json({
      ...result,
      latency_ms: Date.now() - startedAt,
      provider,
      model,
    });
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

async function requestValidatedPath(state) {
  let lastValidationError = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const llmPayload = buildLlmPayload(state, attempt, lastValidationError);
    const raw = await callLlm(llmPayload);
    const parsed = parseLlmResponse(raw);
    const validation = validateLlmPath(parsed, state);

    if (validation.ok) {
      const fullPath = parsed.full_path.map(normalizeCell);
      const derivedHintSteps = fullPath.slice(1, 1 + state.max_hint_steps);
      return {
        status: "path_found",
        full_path: fullPath,
        hint_steps: derivedHintSteps,
        reason: parsed.reason || "Valid full path returned by the live LLM.",
        retry_count: attempt,
        validation_status: "valid",
      };
    }

    lastValidationError = validation.message;
    logServerError("llm_response_rejected", {
      provider,
      model,
      attempt,
      validation_error: validation.message,
      parsed_status: parsed && parsed.status,
      full_path_length: Array.isArray(parsed && parsed.full_path) ? parsed.full_path.length : 0,
      full_path: Array.isArray(parsed && parsed.full_path)
        ? parsed.full_path.map(normalizeCell)
        : null,
      player: state.player,
      goal: state.goal,
      client_event_id: state.client_event_id,
    });
  }

  const error = new Error("The live LLM did not return a valid full path after retry.");
  error.statusCode = 422;
  error.retryCount = 1;
  error.validationError = lastValidationError;
  throw error;
}

function buildLlmPayload(state, attempt, previousError) {
  if (provider === "venice") return buildVenicePayload(state, attempt, previousError);
  if (provider === "gemini") return buildGeminiPayload(state, attempt, previousError);
  return buildOpenAiPayload(state, attempt, previousError);
}

function buildOpenAiPayload(state, attempt, previousError) {
  const correction = attempt === 0
    ? ""
    : `The previous response was invalid: ${previousError}. Return a corrected full path.`;

  return {
    model,
    instructions: [
      "You are the AI path planner for a maze navigation study.",
      "Return only data matching the requested JSON schema.",
      "Compute the shortest valid full path from the current player cell to the goal.",
      "Coordinates use x for column and y for row. 0 means open, 1 means wall.",
      "Use open_cell_graph as the authority for legal movement.",
      "Every consecutive path pair must be an edge in open_cell_graph.",
      "The full_path cell count must equal required_shortest_path_cells.",
      "The path must include the current player cell as the first cell and the goal as the last cell.",
      "Each step may move only one cell north, south, east, or west.",
      "Never include wall cells or out-of-bounds cells.",
      correction,
    ].filter(Boolean).join(" "),
    input: JSON.stringify(buildPathRequest(state)),
    text: {
      format: {
        type: "json_schema",
        name: "maze_path_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["status", "full_path", "hint_steps", "reason"],
          properties: {
            status: {
              type: "string",
              enum: ["path_found", "no_path"],
            },
            full_path: {
              type: "array",
              minItems: 1,
              items: cellSchema(),
            },
            hint_steps: {
              type: "array",
              items: cellSchema(),
            },
            reason: {
              type: "string",
            },
          },
        },
      },
    },
  };
}

function buildVenicePayload(state, attempt, previousError) {
  const correction = attempt === 0
    ? ""
    : `The previous response was invalid: ${previousError}. Return a corrected full path.`;

  return {
    model,
    temperature: 0,
    max_completion_tokens: 1400,
    messages: [
      {
        role: "system",
        content: [
          "You are the AI path planner for a maze navigation study.",
          "Return only JSON matching the schema.",
          "Compute the shortest valid full path from the current player cell to the goal.",
          "Coordinates use x for column and y for row. 0 means open, 1 means wall.",
          "Use open_cell_graph as the authority for legal movement.",
          "Every consecutive path pair must be an edge in open_cell_graph.",
          "The full_path cell count must equal required_shortest_path_cells.",
          "The path must include the current player cell as the first cell and the goal as the last cell.",
          "Each step may move only one cell north, south, east, or west.",
          "Never include wall cells or out-of-bounds cells.",
          correction,
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(buildPathRequest(state)),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: pathResponseSchema(),
    },
    venice_parameters: {
      disable_thinking: true,
      strip_thinking_response: true,
      include_venice_system_prompt: false,
    },
  };
}

function buildGeminiPayload(state, attempt, previousError) {
  const correction = attempt === 0
    ? ""
    : `The previous response was invalid: ${previousError}. Return a corrected full path.`;

  return {
    model,
    temperature: 0,
    max_completion_tokens: 1600,
    reasoning_effort: "none",
    messages: [
      {
        role: "system",
        content: [
          "You are the AI path planner for a maze navigation study.",
          "Return only JSON matching the requested schema.",
          "Compute the shortest valid full path from the current player cell to the goal.",
          "Coordinates use x for column and y for row. 0 means open, 1 means wall.",
          "Use open_cell_graph as the authority for legal movement.",
          "Every consecutive path pair must be an edge in open_cell_graph.",
          "The full_path cell count must equal required_shortest_path_cells.",
          "The path must include the current player cell as the first cell and the goal as the last cell.",
          "Each step may move only one cell north, south, east, or west.",
          "Never include wall cells or out-of-bounds cells.",
          correction,
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(buildPathRequest(state)),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "maze_path_response",
        strict: true,
        schema: pathResponseSchema(),
      },
    },
  };
}

function buildPathRequest(state) {
  const shortestPath = findShortestPath(state.player, state.goal, state.maze);
  return {
    task: "Find the shortest full legal path from player to goal.",
    coordinate_system: "Each cell is {x,y}. x is the column from left to right. y is the row from top to bottom. maze[y][x] indexes the grid.",
    maze_size: { rows: state.maze.length, cols: state.maze[0].length },
    encoding: "0=open, 1=wall",
    maze: state.maze.map((row) => row.join("")),
    player: state.player,
    facing: state.facing,
    goal: state.goal,
    max_hint_steps: state.max_hint_steps,
    move_count: state.move_count,
    client_event_id: state.client_event_id,
    path_rules: [
      "full_path[0] must equal player.",
      "full_path[last] must equal goal.",
      "full_path.length must equal required_shortest_path_cells.",
      "Every step after the first must be one of the neighbor keys listed for the previous cell in open_cell_graph.",
      "Return coordinates as objects like {\"x\":1,\"y\":1}, not strings.",
    ],
    required_shortest_path_cells: shortestPath.length,
    open_cell_graph: buildOpenCellGraph(state.maze),
  };
}

function buildOpenCellGraph(maze) {
  const graph = {};
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  for (let y = 0; y < maze.length; y += 1) {
    for (let x = 0; x < maze[y].length; x += 1) {
      if (maze[y][x] !== 0) continue;

      const neighbors = [];
      for (const direction of directions) {
        const next = { x: x + direction.dx, y: y + direction.dy };
        if (isOpenCell(next, maze)) neighbors.push(`${next.x},${next.y}`);
      }

      graph[`${x},${y}`] = neighbors;
    }
  }

  return graph;
}

function cellSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["x", "y"],
    properties: {
      x: { type: "integer" },
      y: { type: "integer" },
    },
  };
}

function pathResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "full_path", "hint_steps", "reason"],
    properties: {
      status: {
        type: "string",
        enum: ["path_found", "no_path"],
      },
      full_path: {
        type: "array",
        minItems: 1,
        items: cellSchema(),
      },
      hint_steps: {
        type: "array",
        items: cellSchema(),
      },
      reason: {
        type: "string",
      },
    },
  };
}

function getModelForProvider() {
  if (provider === "venice") return process.env.VENICE_MODEL || "zai-org-glm-5-1";
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function getCredentialError() {
  if (provider === "venice" && !process.env.VENICE_API_KEY) {
    return "Set VENICE_API_KEY in .env before requesting live Venice AI hints.";
  }
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return "Set GEMINI_API_KEY in .env before requesting live Gemini AI hints.";
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return "Set OPENAI_API_KEY in .env before requesting live OpenAI hints.";
  }
  return "";
}

async function callLlm(payload) {
  if (provider === "venice") return callVenice(payload);
  if (provider === "gemini") return callGemini(payload);
  return callOpenAI(payload);
}

async function callOpenAI(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hintTimeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error && data.error.message
        ? data.error.message
        : `OpenAI API request failed with HTTP ${response.status}.`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The live LLM request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callVenice(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hintTimeoutMs);

  try {
    const response = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error && data.error.message
        ? data.error.message
        : `Venice API request failed with HTTP ${response.status}.`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The live Venice LLM request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hintTimeoutMs);

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error && data.error.message
        ? data.error.message
        : `Gemini API request failed with HTTP ${response.status}.`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The live Gemini LLM request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLlmResponse(raw) {
  const text = extractOutputText(raw);
  if (!text) {
    throw new Error("The live LLM response did not include output text.");
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error("The live LLM response was not valid JSON.");
  }
}

function extractOutputText(raw) {
  if (Array.isArray(raw.choices) && raw.choices[0] && raw.choices[0].message) {
    return raw.choices[0].message.content || "";
  }

  if (typeof raw.output_text === "string") return raw.output_text;

  if (!Array.isArray(raw.output)) return "";

  for (const item of raw.output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content.text === "string") return content.text;
      if (typeof content.output_text === "string") return content.output_text;
    }
  }

  return "";
}

function validateRequestState(state) {
  if (!state || typeof state !== "object") return "Request body must be an object.";
  if (!Array.isArray(state.maze) || state.maze.length === 0) return "maze must be a non-empty 2D array.";
  if (!state.maze.every((row) => Array.isArray(row) && row.length === state.maze[0].length)) {
    return "maze rows must all have the same length.";
  }
  if (!state.maze.every((row) => row.every((cell) => cell === 0 || cell === 1))) {
    return "maze cells must be 0 or 1.";
  }
  if (!isCellObject(state.player)) return "player must be an {x,y} object.";
  if (!isCellObject(state.goal)) return "goal must be an {x,y} object.";
  if (!isOpenCell(state.player, state.maze)) return "player must be inside an open maze cell.";
  if (!isOpenCell(state.goal, state.maze)) return "goal must be inside an open maze cell.";
  if (!Number.isInteger(state.max_hint_steps) || state.max_hint_steps < 1 || state.max_hint_steps > 10) {
    return "max_hint_steps must be an integer from 1 to 10.";
  }
  return "";
}

function validateLlmPath(response, state) {
  if (!response || typeof response !== "object") return invalid("LLM response must be an object.");
  if (response.status !== "path_found") return invalid("LLM did not report path_found.");
  if (!Array.isArray(response.full_path) || response.full_path.length < 1) {
    return invalid("full_path must be a non-empty array.");
  }

  const pathCells = response.full_path.map(normalizeCell);
  if (!sameCell(pathCells[0], state.player)) return invalid("full_path must start at the player position.");
  if (!sameCell(pathCells[pathCells.length - 1], state.goal)) return invalid("full_path must end at the goal.");

  for (let index = 0; index < pathCells.length; index += 1) {
    const cell = pathCells[index];
    if (!isOpenCell(cell, state.maze)) {
      return invalid(`full_path contains a wall or out-of-bounds cell at index ${index}.`);
    }
    if (index > 0 && manhattan(pathCells[index - 1], cell) !== 1) {
      return invalid(`full_path contains a non-adjacent move at index ${index}.`);
    }
  }

  const shortestPath = findShortestPath(state.player, state.goal, state.maze);
  if (!shortestPath.length) return invalid("No local shortest path exists for validation.");
  if (pathCells.length !== shortestPath.length) {
    return invalid(`full_path is valid but not shortest: expected ${shortestPath.length} cells, got ${pathCells.length}.`);
  }

  return { ok: true };
}

function findShortestPath(from, to, maze) {
  const queue = [{ x: from.x, y: from.y, path: [{ x: from.x, y: from.y }] }];
  const seen = Array.from({ length: maze.length }, () => Array(maze[0].length).fill(false));
  seen[from.y][from.x] = true;
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  while (queue.length) {
    const current = queue.shift();
    if (sameCell(current, to)) return current.path;

    for (const direction of directions) {
      const next = { x: current.x + direction.dx, y: current.y + direction.dy };
      if (!isOpenCell(next, maze) || seen[next.y][next.x]) continue;
      seen[next.y][next.x] = true;
      queue.push({ ...next, path: [...current.path, next] });
    }
  }

  return [];
}

function invalid(message) {
  return { ok: false, message };
}

function normalizeCell(cell) {
  return { x: Number(cell.x), y: Number(cell.y) };
}

function isCellObject(cell) {
  return cell &&
    typeof cell === "object" &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y);
}

function isOpenCell(cell, maze) {
  return Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.y >= 0 &&
    cell.y < maze.length &&
    cell.x >= 0 &&
    cell.x < maze[0].length &&
    maze[cell.y][cell.x] === 0;
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function logServerError(action, details) {
  try {
    fs.mkdirSync(errorLogDir, { recursive: true });
    fs.appendFileSync(
      serverErrorLogPath,
      JSON.stringify({
        timestamp_iso: new Date().toISOString(),
        action,
        ...details,
      }) + "\n"
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

app.listen(port, () => {
  console.log(`LLM maze prototype running at http://localhost:${port}`);
});
