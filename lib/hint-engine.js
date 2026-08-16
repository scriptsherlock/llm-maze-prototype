// Shared maze-hint logic used by BOTH the local Express server (server.js) and
// the hosted serverless function (api/hint.js). No file I/O lives here — callers
// inject a logError(action, details) function (file logging locally, console when
// hosted), so the same engine runs in both environments.

// Defaults to gemini, and deliberately so. Every generation command passes
// LLM_PROVIDER=gemini explicitly, but the default is what runs when someone forgets --
// and while OPENAI_API_KEY was a placeholder that mistake failed safely with a
// credential error. With a real key in .env it would instead quietly spend money on
// the provider measured to be worse at this (see "Which model" in IMPLEMENTATION.md).
// The cheap, free-tier provider is the safer thing to fall back to.
const requestedProvider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
const provider = ["openai", "venice", "gemini"].includes(requestedProvider)
  ? requestedProvider
  : "gemini";
const hintTimeoutMs = 20000;
// The batch precompute solves every junction in one call with high reasoning, so it
// legitimately takes longer than an interactive hint. Runtime default 60s (matches
// the Vercel function cap); the offline generator overrides via BATCH_TIMEOUT_MS to
// ride out Gemini's latency variance, since nobody is waiting on it there.
const batchTimeoutMs = Number(process.env.BATCH_TIMEOUT_MS) || 60000;
// Rollback: set false for the original sequential retry (one call, then a
// correction call). true fires both attempts at once and takes the first valid.
const PARALLEL_RETRY = false;

function getModelForProvider() {
  if (provider === "venice") return process.env.VENICE_MODEL || "zai-org-glm-5-1";
  // 3.5-flash-lite is what generated the deployed set and what the model comparison in
  // IMPLEMENTATION.md was measured on. The default used to be 3.1, so a run that
  // forgot GEMINI_MODEL produced hints on a different model than the rest of the set.
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

const model = getModelForProvider();

// Token spend, accumulated across every call this process makes. Generating hints is
// the only thing here that costs money, and it runs offline in batches, so knowing
// what a batch cost matters more than any single call. The Responses API reports
// input/output tokens; chat/completions reports prompt/completion.
const usageTotals = { calls: 0, input: 0, output: 0, reasoning: 0 };
function recordUsage(usage) {
  if (!usage) return;
  usageTotals.calls += 1;
  usageTotals.input += usage.input_tokens ?? usage.prompt_tokens ?? 0;
  usageTotals.output += usage.output_tokens ?? usage.completion_tokens ?? 0;
  usageTotals.reasoning += usage.output_tokens_details?.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoning_tokens ?? 0;
}
const getUsageTotals = () => ({ ...usageTotals });

// ---- spend guardrails --------------------------------------------------------
// Generation is the only thing here that costs money, it runs unattended in batches,
// and a paid key with no top-up available is not something to find out about
// afterwards. Two hard stops, both env vars, both refusing to send rather than
// truncating a reply:
//     MAX_LLM_CALLS   requests this process may make      (default 40)
//     MAX_LLM_TOKENS  input+output it may spend in total  (default 400000)
// A batch that hits either throws, so the caller stops with a clear message and
// whatever it already verified stays on disk.
// Read with Number.isFinite rather than ||: a limit of 0 is a legitimate "make no
// calls at all", and `0 || 40` would quietly turn that into forty.
const envNumber = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};
const MAX_CALLS = envNumber("MAX_LLM_CALLS", 40);
const MAX_TOKENS = envNumber("MAX_LLM_TOKENS", 400000);

// Ceiling on ONE reply. Distinct from MAX_LLM_TOKENS, which is the whole run: this is
// what stops a single call running away, and on a paid key it is the difference
// between a few pence and an open tab. Route generation genuinely needs room -- the
// answer is fifty-odd cells per route and the thinking shares the same budget -- so
// 65536 is deliberate, not generous. Below about 32768 replies truncate mid-route,
// which looks exactly like the model failing.
const MAX_OUTPUT_TOKENS = envNumber("MAX_OUTPUT_TOKENS", 65536);

// Reasoning effort for OpenAI. Left unset on purpose: `reasoning` is only accepted by
// reasoning models, and sending it to a plain chat model like gpt-4.1-mini is an error
// rather than a no-op. Set OPENAI_REASONING=high (or medium/low) when the model is one
// that takes it.
const OPENAI_REASONING = ["low", "medium", "high"].includes(process.env.OPENAI_REASONING)
  ? process.env.OPENAI_REASONING
  : "";

function assertWithinBudget() {
  if (usageTotals.calls >= MAX_CALLS) {
    throw new Error(`Budget stop: ${usageTotals.calls} calls made, limit is MAX_LLM_CALLS=${MAX_CALLS}.`);
  }
  const spent = usageTotals.input + usageTotals.output;
  if (spent >= MAX_TOKENS) {
    throw new Error(`Budget stop: ${spent} tokens spent, limit is MAX_LLM_TOKENS=${MAX_TOKENS}.`);
  }
}

function getCredentialError() {
  if (provider === "venice" && !process.env.VENICE_API_KEY) {
    return "Set VENICE_API_KEY before requesting live Venice AI hints.";
  }
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return "Set GEMINI_API_KEY before requesting live Gemini AI hints.";
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return "Set OPENAI_API_KEY before requesting live OpenAI hints.";
  }
  return "";
}

async function requestValidatedPath(state, logError = () => {}) {
  // BFS is recomputed only as a reference to validate the AI answer. It is logged
  // for comparison but never shown to the participant and never substituted in.
  const referencePath = findShortestPath(state.player, state.goal, state.maze);
  return PARALLEL_RETRY
    ? resolveParallel(state, logError, referencePath)
    : resolveSequential(state, logError, referencePath);
}

// Original behaviour: one call; if it fails validation, a second call that is told
// what was wrong. Lower cost, but the two calls run back-to-back (double latency).
async function resolveSequential(state, logError, referencePath) {
  let lastValidationError = "";
  let firstAttemptPath = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = parseLlmResponse(await callLlm(buildLlmPayload(state, attempt, lastValidationError)), logError);
    if (firstAttemptPath === null && hasPath(parsed)) firstAttemptPath = parsed.full_path.map(normalizeCell);

    const validation = validateLlmPath(parsed, state);
    if (validation.ok) return validPathResult(parsed.full_path.map(normalizeCell), attempt, referencePath, state.max_hint_steps);

    lastValidationError = validation.message;
    logRejectedAttempt(logError, attempt, validation.message, parsed, state);
  }

  return finalizePath(firstAttemptPath, lastValidationError, referencePath, state.max_hint_steps);
}

// Parallel retry (B): fire both attempts at once (temperature 0.4 gives variety)
// and take the first that validates. Total latency is ~one call, not two.
async function resolveParallel(state, logError, referencePath) {
  const raws = await Promise.allSettled([0, 1].map((attempt) => callLlm(buildLlmPayload(state, attempt, ""))));
  let lastValidationError = "The live LLM did not return a response.";
  let firstAttemptPath = null;

  for (let attempt = 0; attempt < raws.length; attempt += 1) {
    const settled = raws[attempt];
    if (settled.status !== "fulfilled") {
      lastValidationError = (settled.reason && settled.reason.message) || "The live LLM request failed.";
      continue;
    }

    let parsed;
    try {
      parsed = parseLlmResponse(settled.value, logError);
    } catch (error) {
      lastValidationError = error.message;
      continue;
    }

    if (firstAttemptPath === null && hasPath(parsed)) firstAttemptPath = parsed.full_path.map(normalizeCell);

    const validation = validateLlmPath(parsed, state);
    if (validation.ok) return validPathResult(parsed.full_path.map(normalizeCell), attempt, referencePath, state.max_hint_steps);

    lastValidationError = validation.message;
    logRejectedAttempt(logError, attempt, validation.message, parsed, state);
  }

  return finalizePath(firstAttemptPath, lastValidationError, referencePath, state.max_hint_steps);
}

function hasPath(parsed) {
  return Array.isArray(parsed && parsed.full_path) && parsed.full_path.length > 0;
}

function validPathResult(fullPath, attempt, referencePath, maxHintSteps) {
  return {
    status: "path_found",
    full_path: fullPath,
    hint_steps: fullPath.slice(1, 1 + maxHintSteps),
    reason: "Valid full path returned by the live LLM.",
    retry_count: attempt,
    validation_status: "valid",
    reference_path: referencePath,
    required_shortest_path_cells: referencePath.length,
  };
}

// The AI never returned a valid shortest path. Per study design we still surface the
// AI's own first answer (flagged invalid) rather than hiding it; if nothing was even
// parseable there is genuinely nothing to draw, so we error.
function finalizePath(firstAttemptPath, lastValidationError, referencePath, maxHintSteps) {
  if (firstAttemptPath && firstAttemptPath.length > 0) {
    return {
      status: "path_found",
      full_path: firstAttemptPath,
      hint_steps: firstAttemptPath.slice(1, 1 + maxHintSteps),
      reason: "AI path shown without validation; it did not match the shortest legal path.",
      retry_count: 1,
      validation_status: "invalid",
      validation_error: lastValidationError,
      reference_path: referencePath,
      required_shortest_path_cells: referencePath.length,
    };
  }

  const error = new Error("The live LLM did not return any usable path.");
  error.statusCode = 422;
  error.retryCount = 1;
  error.validationError = lastValidationError;
  throw error;
}

function logRejectedAttempt(logError, attempt, message, parsed, state) {
  logError("llm_response_rejected", {
    provider,
    model,
    attempt,
    validation_error: message,
    parsed_status: parsed && parsed.status,
    full_path_length: Array.isArray(parsed && parsed.full_path) ? parsed.full_path.length : 0,
    full_path: Array.isArray(parsed && parsed.full_path) ? parsed.full_path.map(normalizeCell) : null,
    player: state.player,
    goal: state.goal,
    client_event_id: state.client_event_id,
  });
}

function buildLlmPayload(state, attempt, previousError) {
  if (provider === "venice") return buildVenicePayload(state, attempt, previousError);
  if (provider === "gemini") return buildGeminiPayload(state, attempt, previousError);
  return buildOpenAiPayload(state, attempt, previousError);
}

function systemInstructions(correction) {
  return [
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
  ].filter(Boolean).join(" ");
}

function correctionText(attempt, previousError) {
  return attempt === 0
    ? ""
    : `The previous response was invalid: ${previousError}. Return a corrected full path.`;
}

function buildOpenAiPayload(state, attempt, previousError) {
  return {
    model,
    instructions: systemInstructions(correctionText(attempt, previousError)),
    input: JSON.stringify(buildPathRequest(state)),
    text: {
      format: {
        type: "json_schema",
        name: "maze_path_response",
        strict: true,
        schema: pathResponseSchema(),
      },
    },
  };
}

function buildVenicePayload(state, attempt, previousError) {
  return {
    model,
    temperature: 0,
    max_completion_tokens: 1400,
    messages: [
      { role: "system", content: systemInstructions(correctionText(attempt, previousError)) },
      { role: "user", content: JSON.stringify(buildPathRequest(state)) },
    ],
    response_format: { type: "json_schema", json_schema: pathResponseSchema() },
    venice_parameters: {
      disable_thinking: true,
      strip_thinking_response: true,
      include_venice_system_prompt: false,
    },
  };
}

function buildGeminiPayload(state, attempt, previousError) {
  return {
    model,
    temperature: 0.4,
    // Reasoning tokens count toward the completion budget, so keep generous
    // headroom for the answer not to be truncated. "low" is too weak for this
    // maze task (it steps onto walls); "high" trades latency for accuracy.
    max_completion_tokens: 8192,
    reasoning_effort: "high",
    messages: [
      { role: "system", content: systemInstructions(correctionText(attempt, previousError)) },
      { role: "user", content: JSON.stringify(buildPathRequest(state)) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "maze_path_response", strict: true, schema: pathResponseSchema() },
    },
  };
}

function buildPathRequest(state) {
  const shortestPath = findShortestPath(state.player, state.goal, state.maze);
  // Grounded to only what is needed to compute the shortest path. Fields that do
  // not affect pathfinding (facing, move_count, client_event_id, max_hint_steps)
  // are intentionally omitted to keep the model focused on the required output.
  return {
    task: "Find the shortest full legal path from player to goal.",
    coordinate_system: "Each cell is {x,y}. x is the column from left to right. y is the row from top to bottom. maze[y][x] indexes the grid.",
    maze_size: { rows: state.maze.length, cols: state.maze[0].length },
    encoding: "0=open, 1=wall",
    maze: state.maze.map((row) => row.join("")),
    player: state.player,
    goal: state.goal,
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
  // Only the fields the server actually consumes: the status and the full path.
  // hint_steps is derived server-side from full_path; reason is not needed.
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "full_path"],
    properties: {
      status: { type: "string", enum: ["path_found", "no_path"] },
      full_path: { type: "array", minItems: 1, items: cellSchema() },
    },
  };
}

async function callLlm(payload, timeoutMs = hintTimeoutMs) {
  if (provider === "venice") return callProvider(payload, "https://api.venice.ai/api/v1/chat/completions", process.env.VENICE_API_KEY, "Venice", timeoutMs);
  if (provider === "gemini") return callProvider(payload, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", process.env.GEMINI_API_KEY, "Gemini", timeoutMs);
  return callProvider(payload, "https://api.openai.com/v1/responses", process.env.OPENAI_API_KEY, "OpenAI", timeoutMs);
}

// Waits of 20s then 40s: enough for a per-minute window to roll over. Used only when
// the provider does not tell us how long to wait.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 20000;
// Longest we will sit on a single retry, however long the provider asks for.
const RATE_LIMIT_MAX_WAIT_MS = envNumber("RATE_LIMIT_MAX_WAIT_MS", 90000);

async function callProvider(payload, url, apiKey, label, timeoutMs = hintTimeoutMs, retriesLeft = RATE_LIMIT_RETRIES) {
  assertWithinBudget();          // checked before sending, never after
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    // 429 is "too fast", not "wrong". Retrying it immediately -- which is what the
    // attempt loop above does -- spends every attempt in a fraction of a second and
    // reports the maze as unsolvable. Back off and try again instead; a rate limit is
    // the one error where waiting is the whole fix.
    // 5xx is the server having a moment, not a bad request, so it is worth the same
    // patience as a rate limit rather than burning an attempt on it.
    if ((response.status === 429 || response.status >= 500) && retriesLeft > 0) {
      // Honour Retry-After when the API sends one -- it knows when the window rolls
      // over and a fixed guess does not. Seconds or an HTTP date are both legal.
      const header = response.headers && response.headers.get && response.headers.get("retry-after");
      const asSeconds = Number(header);
      const asDate = header ? Date.parse(header) : NaN;
      const advised = Number.isFinite(asSeconds) && asSeconds >= 0 ? asSeconds * 1000
        : Number.isFinite(asDate) ? Math.max(0, asDate - Date.now())
        : NaN;
      const fallback = RATE_LIMIT_BACKOFF_MS * (RATE_LIMIT_RETRIES - retriesLeft + 1);
      // Cap it: a provider asking for ten minutes should fail the run, not silently
      // hang a batch that nobody is watching.
      const waitMs = Math.min(Number.isFinite(advised) ? Math.max(advised, 1000) : fallback, RATE_LIMIT_MAX_WAIT_MS);
      await new Promise((r) => setTimeout(r, waitMs));
      return callProvider(payload, url, apiKey, label, timeoutMs, retriesLeft - 1);
    }
    if (!response.ok) {
      throw new Error(data.error && data.error.message
        ? data.error.message
        : `${label} API request failed with HTTP ${response.status}.`);
    }
    recordUsage(data.usage);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`The live ${label} LLM request timed out.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLlmResponse(raw, logError = () => {}) {
  const text = extractOutputText(raw);
  if (!text) {
    throw new Error("The live LLM response did not include output text.");
  }

  try {
    return JSON.parse(extractJsonObject(text));
  } catch (_error) {
    const finishReason = Array.isArray(raw.choices) && raw.choices[0]
      ? raw.choices[0].finish_reason
      : null;
    // Log the raw output so unparsable responses are diagnosable, not a black box.
    logError("llm_unparsable_response", {
      provider,
      model,
      finish_reason: finishReason,
      raw_text: String(text).slice(0, 1200),
    });
    if (finishReason === "length") {
      throw new Error("The live LLM response was truncated before valid JSON (raise max_completion_tokens or lower reasoning_effort).");
    }
    throw new Error("The live LLM response was not valid JSON.");
  }
}

// Tolerate reasoning/markdown wrappers around the JSON: strip code fences and
// take the outermost { ... } object. (Does not repair truncated JSON.)
function extractJsonObject(text) {
  const withoutFences = String(text).trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start !== -1 && end > start) return withoutFences.slice(start, end + 1);
  return withoutFences;
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


// Shared by the solutions schema below: a plain ordered list of {x,y} cells.
function cellListSchema() {
  return { type: "array", items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer" }, y: { type: "integer" } } } };
}

// ---- Whole-maze solutions -------------------------------------------------
// Ask the AI for SEVERAL different start->exit routes at once, and verify each is a
// legal walk. Every route it returns is either provably walkable or thrown away, so
// the lengths that come out of here can never be numbers it made up. Junction hints
// are derived from these routes rather than asked for separately, which is what
// keeps them consistent with each other.
// Routes come back as a LIST OF CELLS, not a string of moves.
//
// A move string is ~15x smaller, and it was tried: output fell from ~1,130 tokens to
// 129 and every route became invalid, drifting into a wall around move 17-39. Writing
// the coordinates out is the model thinking aloud -- it externalises its position at
// every step. A move string forces it to track x,y internally across fifty-odd moves
// with nothing written down, and it cannot. The same model that produced 13-21 valid
// routes per maze on cell lists produced zero on move strings.
//
// So the verbose format is the working one, and the tokens are the point rather than
// the waste. `moves` is still accepted if a model volunteers it.
const MOVE_VECTORS = { U: { dx: 0, dy: -1 }, D: { dx: 0, dy: 1 }, L: { dx: -1, dy: 0 }, R: { dx: 1, dy: 0 } };

// The maze used to be sent twice over, as a grid AND as an adjacency list, both
// derived from the same array so they could not disagree. Measured on maze-5, same
// model, same route count, one run each:
//
//   repr    routes  coverage  calls  in tokens  out tokens  rejected for
//   graph      6      25/25     2      7,286      5,768     wrong endpoint
//   both       6      24/25     3     12,372     15,500     revisits
//   grid       2       9/25     3      2,361      2,830     WALKING INTO WALLS
//
// So the adjacency list is the one to send. Made to derive adjacency from raw rows
// the model walks through hedges -- the same failure the old move-string output gave
// -- and the 4x saving on input tokens buys nothing when two thirds of the maze ends
// up with no cue. Sending both is worse than sending the graph alone on every count,
// output tokens included, so the grid is not merely redundant but a distraction.
//
// Whichever is chosen, a route is still re-walked against the real grid before it is
// kept, so a weaker representation costs verified routes, never correctness.
const MAZE_REPR = ["graph", "grid", "both"].includes(process.env.MAZE_REPR) ? process.env.MAZE_REPR : "graph";

function solutionsInstructions(count, state) {
  const rows = state.maze.length, cols = state.maze[0].length;
  const describeGrid = MAZE_REPR !== "graph";
  const describeGraph = MAZE_REPR !== "grid";
  return [
    "You are a maze pathfinding engine.",
    "",
    describeGrid
      ? `The maze is a ${rows}x${cols} binary grid. '0' = open, '1' = wall.`
      : `The maze is ${rows}x${cols}.`,
    describeGrid
      ? "Coordinates are zero-indexed {x,y}: x is the column from left to right, y is the row from top to bottom. maze[y][x] indexes the grid."
      : "Coordinates are zero-indexed {x,y}: x is the column from left to right, y is the row from top to bottom.",
    describeGraph
      ? "`open_cell_graph` lists, for each open cell, its open neighbours — these are the ONLY legal moves."
      : "",
    "",
    "Moves: U = y-1, D = y+1, L = x-1, R = x+1.",
    "",
    "Rules:",
    "- Start at `start`. End at `goal`.",
    "- You cannot move outside the grid.",
    describeGrid ? "- You cannot move onto a wall ('1')." : "- You cannot move onto a cell that is not in `open_cell_graph`.",
    "- You cannot move diagonally.",
    describeGraph
      ? "- Every move must be to one of that cell's neighbours in `open_cell_graph`."
      : "- Every move must be to an adjacent open cell.",
    "- Never revisit a cell within one route.",
    "- Verify the complete route cell by cell before responding.",
    "",
    // This maze has loops, so the useful answer is several routes, not the one
    // shortest. Coverage is what the hints are derived from: a branch no route walks
    // gets no cue at all, so breadth here matters more than optimality.
    `TASK: find up to ${count} DIFFERENT routes from start to goal.`,
    "- Routes must be GENUINELY different: each must use at least one passage the others do not.",
    "- Give the shortest route you find first, then the alternatives.",
    "",
    "Return every cell of each route in order, starting at `start` and ending at `goal`.",
    'Return ONLY this JSON: {"routes":[{"path":[{"x":9,"y":1},{"x":10,"y":1}]}]}',
    "Do not provide an explanation.",
  ].join("\n");
}

function solutionsSchema() {
  return {
    type: "object", additionalProperties: false, required: ["routes"],
    properties: { routes: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["path"],
      properties: { path: cellListSchema() },
    } } },
  };
}

// Walk a move string from the start. Returns the cells, or null with the reason —
// the string is only ever trusted after this has re-walked every step on the grid.
function expandMoves(moves, state) {
  if (typeof moves !== "string" || !moves.length) return { cells: null, why: "empty move string" };
  const cells = [{ x: state.start.x, y: state.start.y }];
  const seen = new Set([`${state.start.x},${state.start.y}`]);
  for (let i = 0; i < moves.length; i += 1) {
    const step = MOVE_VECTORS[moves[i].toUpperCase()];
    if (!step) return { cells: null, why: `move ${i + 1} is '${moves[i]}', not one of U D L R` };
    const prev = cells[cells.length - 1];
    const next = { x: prev.x + step.dx, y: prev.y + step.dy };
    if (!isOpenAt(next.x, next.y, state.maze)) return { cells: null, why: `move ${i + 1} walks into a wall at ${next.x},${next.y}` };
    const key = `${next.x},${next.y}`;
    if (seen.has(key)) return { cells: null, why: `move ${i + 1} revisits ${key}` };
    seen.add(key);
    cells.push(next);
  }
  return { cells, why: "" };
}

// Named apart from isOpenCell(cell, maze) above on purpose: two function declarations
// sharing a name silently leave only the last one, and this took the whole validator
// down with it -- every traced path came back "cell 9,1 is a wall".
function isOpenAt(x, y, maze) {
  return y >= 0 && y < maze.length && x >= 0 && x < maze[0].length && Number(maze[y][x]) === 0;
}

function buildSolutionsPayload(state, count) {
  const instructions = solutionsInstructions(count, state);
  const input = JSON.stringify({
    maze_size: { rows: state.maze.length, cols: state.maze[0].length },
    ...(MAZE_REPR === "graph" ? {} : { maze: state.maze.map((row) => row.join("")) }),
    start: state.start,
    goal: state.goal,
    ...(MAZE_REPR === "grid" ? {} : { open_cell_graph: buildOpenCellGraph(state.maze) }),
  });
  const schema = solutionsSchema();
  if (provider === "gemini") {
    // The budget covers thinking AND the answer, and here the answer IS the thinking:
    // several routes of fifty-odd cells each runs to thousands of tokens on its own.
    // At 32768 with high effort the reply was cut off mid-route every time
    // ("finish_reason: length"), which reads as the model failing when it is really
    // the ceiling. Effort stays high: dropped to medium the reply came back in three
    // seconds with a route that looped through the start, so the thinking is doing
    // real work -- it just needs room alongside the answer.
    return { model, temperature: 0.6, max_completion_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "high",
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: { name: "maze_solutions", strict: true, schema } } };
  }
  if (provider === "venice") {
    return { model, temperature: 0.6, max_completion_tokens: 16384,
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: schema },
      venice_parameters: { disable_thinking: true, strip_thinking_response: true, include_venice_system_prompt: false } };
  }
  // Unlike the two branches above this one used to send no ceiling at all, so a
  // long reply was bounded only by the model default -- no truncation guard and,
  // on a paid key, no spend guard either.
  return {
    model, instructions, input,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    ...(OPENAI_REASONING ? { reasoning: { effort: OPENAI_REASONING } } : {}),
    text: { format: { type: "json_schema", name: "maze_solutions", strict: true, schema } },
  };
}

// A route counts only if it really is walkable end to end.
function validateSolution(path, state) {
  if (!Array.isArray(path) || path.length < 2) return { valid: false, why: "empty route" };
  const cells = path.map(normalizeCell);
  if (cells[0].x !== state.start.x || cells[0].y !== state.start.y) return { valid: false, why: "does not start at the start" };
  const last = cells[cells.length - 1];
  if (last.x !== state.goal.x || last.y !== state.goal.y) return { valid: false, why: "does not end at the goal" };
  const seen = new Set();
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    if (!isOpenCell(c, state.maze)) return { valid: false, why: `cell ${c.x},${c.y} is a wall or out of bounds` };
    if (i > 0 && manhattan(cells[i - 1], c) !== 1) return { valid: false, why: `${cells[i-1].x},${cells[i-1].y} -> ${c.x},${c.y} is not a single step` };
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) return { valid: false, why: `revisits ${k}` };
    seen.add(k);
  }
  return { valid: true, cells, steps: cells.length - 1 };
}

async function findMazeSolutions(state, count = 6, logError = () => {}, maxAttempts = 3) {
  const found = [];
  const signatures = new Set();
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts && found.length < count; attempt += 1) {
    let parsed;
    try {
      parsed = parseLlmResponse(await callLlm(buildSolutionsPayload(state, count), batchTimeoutMs), logError);
    } catch (error) { lastError = error.message; logError("solutions_error", { attempt, message: error.message }); continue; }
    for (const r of (parsed && parsed.routes) || []) {
      // A model may answer with either shape; cells are what we ask for.
      let cells = r.path;
      if (!cells && typeof r.moves === "string") {
        const expanded = expandMoves(r.moves, state);
        if (!expanded.cells) { logError("solution_rejected", { attempt, why: expanded.why }); continue; }
        cells = expanded.cells;
      }
      const v = validateSolution(cells || [], state);
      if (!v.valid) { logError("solution_rejected", { attempt, why: v.why }); continue; }
      const sig = v.cells.map((c) => `${c.x},${c.y}`).join(">");
      if (signatures.has(sig)) continue;              // identical route returned twice
      signatures.add(sig);
      found.push({ steps: v.steps, path: v.cells });
    }
  }
  found.sort((a, b) => a.steps - b.steps);
  return { status: found.length ? "solved" : "none", routes: found, provider, model, lastError };
}

module.exports = {
  provider,
  model,
  getUsageTotals,
  findMazeSolutions,
  hintTimeoutMs,
  getCredentialError,
  validateRequestState,
  requestValidatedPath,
};
