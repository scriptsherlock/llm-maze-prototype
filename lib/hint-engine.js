// Shared maze-hint logic used by BOTH the local Express server (server.js) and
// the hosted serverless function (api/hint.js). No file I/O lives here — callers
// inject a logError(action, details) function (file logging locally, console when
// hosted), so the same engine runs in both environments.

const requestedProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const provider = ["openai", "venice", "gemini"].includes(requestedProvider)
  ? requestedProvider
  : "openai";
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
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

const model = getModelForProvider();

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

async function callProvider(payload, url, apiKey, label, timeoutMs = hintTimeoutMs) {
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
    if (!response.ok) {
      throw new Error(data.error && data.error.message
        ? data.error.message
        : `${label} API request failed with HTTP ${response.status}.`);
    }
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

// ---- Route evaluation (v5): the AI compares the branches at a junction instead of
// drawing a path. LLM-only — the model estimates each branch's steps/verdict, so it
// can be wrong (that fallibility is the point). No BFS ground truth is injected. ----

function routeEvalInstructions() {
  const example = JSON.stringify({
    branches: [
      { x: 5, y: 2, verdict: "toward_goal", steps: 8, reason: "shortest way here, heads straight toward the goal" },
      { x: 6, y: 3, verdict: "detour", steps: 14, reason: "reaches the goal but loops ~6 steps longer" },
      { x: 5, y: 4, verdict: "dead_end", steps: 3, reason: "closes off after 3 steps, no way through" },
    ],
  });
  return [
    "ROLE",
    "You are the AI navigation assistant in a first-person hedge-maze study. The player is standing at a junction. For EACH candidate next cell in `branches`, work out where it leads and explain it, so the player can decide.",
    "",
    "INPUT (JSON)",
    "- `maze`: array of strings, one per row. '0' = open/walkable, '1' = wall. Cell (x,y) is maze[y][x]; x is the column, y is the row.",
    "- `player`: the junction cell {x,y}. `goal`: the exit cell {x,y}.",
    "- `branches`: the candidate next cells to judge. `open_cell_graph`: for every open cell, its open neighbours — the AUTHORITY for legal moves. Never step onto a wall or a cell not listed.",
    "",
    "HOW TO COUNT STEPS",
    "- Reset your counter to 0 at the junction. Step onto the branch cell (step 1), then keep walking cell by cell via open_cell_graph, +1 per cell.",
    "- At forks inside a branch, follow the sub-route that reaches the goal in the FEWEST steps; that smallest total is `steps`. Do not walk back through the junction.",
    "",
    "FOR EACH BRANCH RETURN",
    "- `verdict`: toward_goal (shortest/near-shortest way here) | detour (reaches goal but clearly longer) | dead_end (cannot reach the goal without coming back; closes off).",
    "- `steps`: for toward_goal/detour = total steps to the goal that way; for dead_end = how many steps in until it closes.",
    "- `reason`: REQUIRED and non-empty for EVERY branch (including toward_goal), under ~12 words. For detour/dead_end say WHY it is worse — how much longer, or that it dead-ends after N steps.",
    "",
    "OUTPUT",
    "Return exactly one entry per branch, in the same order, echoing that branch's x and y. Output only JSON matching the schema.",
    "",
    "EXAMPLE (shape only)",
    "Branches [{x:5,y:2},{x:6,y:3},{x:5,y:4}] could return:",
    example,
  ].join("\n");
}

function buildRouteEvalRequest(state) {
  return {
    task: "Evaluate each branch cell for reaching the goal from the player's junction.",
    coordinate_system: "Each cell is {x,y}. x is the column left to right, y is the row top to bottom. maze[y][x] indexes the grid.",
    encoding: "0=open, 1=wall",
    maze: state.maze.map((row) => row.join("")),
    player: state.player,
    goal: state.goal,
    branches: state.branches,
    open_cell_graph: buildOpenCellGraph(state.maze),
  };
}

function branchEvalSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["x", "y", "verdict", "steps", "reason"],
    properties: {
      x: { type: "integer" },
      y: { type: "integer" },
      verdict: { type: "string", enum: ["toward_goal", "detour", "dead_end"] },
      steps: { type: "integer" },
      reason: { type: "string" },
    },
  };
}

function routeEvalSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["branches"],
    properties: {
      branches: { type: "array", items: branchEvalSchema() },
    },
  };
}

function buildRouteEvalPayload(state) {
  const input = JSON.stringify(buildRouteEvalRequest(state));
  const instructions = routeEvalInstructions();
  const schema = routeEvalSchema();
  if (provider === "venice") {
    return {
      model,
      temperature: 0.2,
      max_completion_tokens: 1200,
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: schema },
      venice_parameters: { disable_thinking: true, strip_thinking_response: true, include_venice_system_prompt: false },
    };
  }
  if (provider === "gemini") {
    return {
      model,
      temperature: 0.4,
      max_completion_tokens: 4096,
      reasoning_effort: "high",
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: { name: "route_evaluation", strict: true, schema } },
    };
  }
  return {
    model,
    instructions,
    input,
    text: { format: { type: "json_schema", name: "route_evaluation", strict: true, schema } },
  };
}

function validateRouteRequest(state) {
  if (!state || typeof state !== "object") return "Request body must be an object.";
  if (!Array.isArray(state.maze) || state.maze.length === 0) return "maze must be a non-empty 2D array.";
  if (!isCellObject(state.player) || !isOpenCell(state.player, state.maze)) return "player must be an open {x,y} cell.";
  if (!isCellObject(state.goal) || !isOpenCell(state.goal, state.maze)) return "goal must be an open {x,y} cell.";
  if (!Array.isArray(state.branches) || state.branches.length === 0) return "branches must be a non-empty array of cells.";
  return "";
}

async function evaluateRoutes(state, logError = () => {}) {
  const raw = await callLlm(buildRouteEvalPayload(state));
  const parsed = parseLlmResponse(raw, logError);
  const branches = Array.isArray(parsed && parsed.branches) ? parsed.branches : [];
  return { status: "evaluated", branches, provider, model };
}

// Batch: evaluate EVERY junction's branches in ONE call, so the client can precompute
// all cues at trial start and have them ready instantly at every junction.
function batchInstructions() {
  const example1 = JSON.stringify({
    x: 5, y: 3,
    branches: [
      { x: 5, y: 2, verdict: "toward_goal", steps: 8, reason: "shortest way here, heads straight toward the goal" },
      { x: 6, y: 3, verdict: "detour", steps: 14, reason: "reaches the goal but loops ~6 steps longer" },
      { x: 5, y: 4, verdict: "dead_end", steps: 3, reason: "closes off after 3 steps, no way through" },
    ],
  });
  const example2 = JSON.stringify({
    x: 1, y: 1,
    branches: [
      { x: 2, y: 1, verdict: "dead_end", steps: 2, reason: "short pocket, dead-ends after 2 steps" },
      { x: 1, y: 2, verdict: "toward_goal", steps: 11, reason: "only branch that keeps going toward the goal" },
    ],
  });
  return [
    "ROLE",
    "You are the AI navigation assistant in a first-person hedge-maze study. At every junction you compare the branches and explain each one, so the participant can decide which way to go. Be accurate: your job is to actually work out where each branch leads.",
    "",
    "INPUT (JSON)",
    "- `maze`: array of strings, one per row. Each character is a cell: '0' = open/walkable, '1' = wall. Cell (x,y) is maze[y][x]; x is the column (left->right), y is the row (top->bottom).",
    "- `goal`: the exit cell {x,y}.",
    "- `junctions`: the cells you must evaluate. Each is {x,y, branches:[{x,y}, ...]}. A branch cell is the first cell you step onto if you leave the junction that way.",
    "- `open_cell_graph`: for every open cell \"x,y\", the list of its open neighbour cells. This is the AUTHORITY for legal moves. Never step onto a wall, onto a cell not listed, or outside the grid.",
    "",
    "TASK",
    "For EVERY junction, evaluate EVERY one of its branches. Return exactly one object per branch. Never skip a branch, never merge two branches, never invent a branch that was not given.",
    "",
    "HOW TO COUNT STEPS (do this carefully)",
    "- Evaluate each junction on its own. RESET your step counter to 0 at the junction you are currently working on.",
    "- Step onto the branch cell (that is step 1), then keep walking cell by cell using open_cell_graph, adding 1 for every cell you move onto.",
    "- Inside a branch you may hit forks; follow the sub-route that reaches the goal in the FEWEST steps. That smallest total is the branch's `steps`.",
    "- Do not walk back through the junction you started from while evaluating that branch.",
    "- When you move to the NEXT junction, discard the old count and start again from 0.",
    "",
    "VERDICTS (pick exactly one per branch)",
    "- toward_goal: the shortest or near-shortest way to the goal from THIS junction.",
    "- detour: it does reach the goal, but clearly longer than the best branch at this junction.",
    "- dead_end: it cannot reach the goal without coming back through this junction; it closes off.",
    "",
    "STEPS FIELD",
    "- toward_goal / detour: `steps` = total steps from the junction to the goal along that branch (counted as above).",
    "- dead_end: `steps` = how many steps you can walk into it before it closes (its depth).",
    "",
    "REASON FIELD - REQUIRED FOR EVERY BRANCH",
    "- Every branch object MUST have a non-empty `reason`, including the toward_goal branch. Never leave it blank.",
    "- Keep it under ~12 words, concrete and plain.",
    "- For detour and dead_end the reason MUST say WHY it is worse: roughly how many steps longer, or that it closes off after N steps.",
    "",
    "OUTPUT RULES",
    "- Echo each junction's x,y, and each branch's x,y, in the SAME order they were given.",
    "- `steps` is a whole number. Output only JSON matching the schema, with no extra text.",
    "",
    "EXAMPLES (illustrative shape only)",
    "A junction {x:5,y:3} with branches [{x:5,y:2},{x:6,y:3},{x:5,y:4}] could return:",
    example1,
    "A junction {x:1,y:1} with branches [{x:2,y:1},{x:1,y:2}] could return:",
    example2,
  ].join("\n");
}

function buildBatchRequest(state) {
  return {
    task: "Evaluate every branch of every junction for reaching the goal.",
    coordinate_system: "Each cell is {x,y}. x column left-to-right, y row top-to-bottom. maze[y][x] indexes the grid.",
    encoding: "0=open, 1=wall",
    maze: state.maze.map((row) => row.join("")),
    goal: state.goal,
    junctions: state.junctions,
    open_cell_graph: buildOpenCellGraph(state.maze),
  };
}

function batchSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["junctions"],
    properties: {
      junctions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "branches"],
          properties: {
            x: { type: "integer" },
            y: { type: "integer" },
            branches: { type: "array", items: branchEvalSchema() },
          },
        },
      },
    },
  };
}

function buildBatchPayload(state) {
  const input = JSON.stringify(buildBatchRequest(state));
  const instructions = batchInstructions();
  const schema = batchSchema();
  if (provider === "venice") {
    return {
      model,
      temperature: 0.2,
      max_completion_tokens: 8192,
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: schema },
      venice_parameters: { disable_thinking: true, strip_thinking_response: true, include_venice_system_prompt: false },
    };
  }
  if (provider === "gemini") {
    return {
      model,
      temperature: 0.4,
      // High reasoning + many junctions in one call: reasoning tokens share this
      // budget, so keep a large ceiling or the JSON truncates (finish_reason=length).
      max_completion_tokens: 32768,
      reasoning_effort: "high",
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: { name: "junction_evaluations", strict: true, schema } },
    };
  }
  return {
    model,
    instructions,
    input,
    text: { format: { type: "json_schema", name: "junction_evaluations", strict: true, schema } },
  };
}

function validateBatchRequest(state) {
  if (!state || typeof state !== "object") return "Request body must be an object.";
  if (!Array.isArray(state.maze) || state.maze.length === 0) return "maze must be a non-empty 2D array.";
  if (!isCellObject(state.goal) || !isOpenCell(state.goal, state.maze)) return "goal must be an open {x,y} cell.";
  if (!Array.isArray(state.junctions) || state.junctions.length === 0) return "junctions must be a non-empty array.";
  return "";
}

async function evaluateJunctionsBatch(state, logError = () => {}) {
  const raw = await callLlm(buildBatchPayload(state), batchTimeoutMs);
  const parsed = parseLlmResponse(raw, logError);
  const junctions = Array.isArray(parsed && parsed.junctions) ? parsed.junctions : [];
  return { status: "evaluated", junctions, provider, model };
}

// ---- Show-your-work per-junction evaluation (accurate, no BFS from us) ----------
// The model must TRACE a path for every branch: to the goal if reachable, else into
// the dead-end pocket. We validate each path cheaply (adjacency + open cells +
// endpoint — NOT a search) and derive verdict/steps from the validated paths, so the
// model proves its own answer. Invalid paths are re-asked with specific feedback.
function junctionTraceInstructions(loopless) {
  return [
    "ROLE",
    "You are the AI navigation assistant in a first-person hedge-maze study. The player is at ONE junction. Evaluate each branch by ACTUALLY TRACING it cell by cell.",
    "",
    "INPUT (JSON): `maze` rows ('0'=open, '1'=wall; cell (x,y)=maze[y][x]), the `junction` {x,y}, the `goal` {x,y}, the `branches` to judge, and `open_cell_graph` (each open cell -> its open neighbours = the ONLY legal moves).",
    "",
    loopless
      ? "KEY FACT: this maze has no loops, so exactly ONE branch here leads onward to the exit and the rest are closed pockets. Two ways to settle it — do whichever is less work:\n  (a) trace the full route to the goal from the branch that leads onward, or\n  (b) fully explore the OTHER branches and show each is a closed pocket (usually only a handful of cells) — then the remaining branch is the way on."
      : "KEY FACT: this maze HAS loops, so MORE THAN ONE branch here may reach the exit by different routes of different lengths. Judge every branch on its own: trace a route to the goal for each branch that has one (the route you trace is the length you are claiming, so find the shortest you can), and fully explore any branch that is a closed pocket.",
    "",
    "FOR EACH BRANCH decide reaches_goal, then:",
    "- reaches_goal=true (it reaches the exit): put the route in `path` (branch cell first, goal cell last) and give `steps_estimate`. Leave `region` empty.",
    "- reaches_goal=false (a DEAD END): you must EXPLORE THE WHOLE POCKET and list EVERY cell of it in `region`. Leave `path` empty.",
    "",
    "HOW TO EXPLORE A POCKET (do this exhaustively — one wall is NOT a dead end):",
    "1. Keep a TO-VISIT list, starting with the branch cell, and a VISITED list (this becomes `region`).",
    "2. Take a cell off TO-VISIT, add it to VISITED, and look up ALL its open neighbours in open_cell_graph.",
    "3. Add every neighbour that is not the junction and not already VISITED to TO-VISIT — INCLUDING side turnings you are not currently walking down.",
    "4. Repeat until TO-VISIT is EMPTY. Only then is the branch a dead end.",
    "5. If at ANY point you can step onto the goal cell, STOP: it is NOT a dead end — set reaches_goal=true instead.",
    "Walking down one corridor until it stops is NOT enough: every side turning you passed must also be explored. A `region` that misses even one reachable cell is REJECTED.",
    "",
    "HARD RULES for `path` (they are checked, and a wrong path is rejected):",
    "- The first cell MUST be the branch cell, and it must be adjacent to the junction.",
    "- EVERY consecutive pair must differ by exactly 1 in x OR y and BOTH be open — an edge in open_cell_graph. Never jump, never cross a wall.",
    "- Never revisit a cell; never pass back through the junction.",
    "- If reaches_goal=true and you DO give a path, it must end exactly at the goal.",
    "",
    "RULES for `region` (checked cell by cell):",
    "- It must contain the branch cell and every cell reachable from it without passing through the junction.",
    "- Every cell in it must be open, and it must NOT contain the goal.",
    "- CLOSURE: for every cell in `region`, each of its open neighbours must also be in `region` (or be the junction). Any neighbour left out means you missed a turning.",
    "",
    "Give a short `reason` (<=12 words) per branch and echo its x,y. Output only JSON matching the schema.",
  ].join("\n");
}

function cellListSchema() {
  return { type: "array", items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer" }, y: { type: "integer" } } } };
}

function junctionTraceSchema() {
  return {
    type: "object", additionalProperties: false, required: ["branches"],
    properties: { branches: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["x", "y", "reaches_goal", "steps_estimate", "path", "region", "reason"],
      properties: { x: { type: "integer" }, y: { type: "integer" }, reaches_goal: { type: "boolean" }, steps_estimate: { type: "integer" }, path: cellListSchema(), region: cellListSchema(), reason: { type: "string" } },
    } } },
  };
}

function buildJunctionTraceRequest(state, feedback) {
  return {
    task: "Trace each branch: a full path to the goal if reachable, else into the dead-end pocket.",
    encoding: "0=open, 1=wall",
    maze: state.maze.map((row) => row.join("")),
    junction: state.junction,
    goal: state.goal,
    branches: state.branches,
    open_cell_graph: buildOpenCellGraph(state.maze),
    ...(feedback ? { previous_errors: feedback } : {}),
  };
}

function buildJunctionTracePayload(state, feedback, loopless) {
  const instructions = junctionTraceInstructions(loopless);
  const input = JSON.stringify(buildJunctionTraceRequest(state, feedback));
  const schema = junctionTraceSchema();
  if (provider === "venice") {
    return { model, temperature: 0.2, max_completion_tokens: 8192, messages: [{ role: "system", content: instructions }, { role: "user", content: input }], response_format: { type: "json_schema", json_schema: schema }, venice_parameters: { disable_thinking: true, strip_thinking_response: true, include_venice_system_prompt: false } };
  }
  if (provider === "gemini") {
    // Per-junction scope is small (2-3 branches), so medium reasoning is enough —
    // and any unproven dead-end claim is rejected and re-asked anyway.
    return { model, temperature: 0.4, max_completion_tokens: 16384, reasoning_effort: "medium", messages: [{ role: "system", content: instructions }, { role: "user", content: input }], response_format: { type: "json_schema", json_schema: { name: "junction_trace", strict: true, schema } } };
  }
  return { model, instructions, input, text: { format: { type: "json_schema", name: "junction_trace", strict: true, schema } } };
}

function openNeighborCountMaze(cell, maze) {
  return [[0,-1],[1,0],[0,1],[-1,0]].reduce((n, [dx, dy]) => n + (isOpenCell({ x: cell.x + dx, y: cell.y + dy }, maze) ? 1 : 0), 0);
}

// Cheap, search-free check that a traced path is legal (adjacency + open + endpoint).
function validateTracedPath(junction, branch, path, maze, goal) {
  if (!Array.isArray(path) || path.length === 0) return { valid: false, why: "empty path" };
  const cells = path.map(normalizeCell);
  if (cells[0].x !== branch.x || cells[0].y !== branch.y) return { valid: false, why: "path must start at the branch cell" };
  if (manhattan(junction, cells[0]) !== 1) return { valid: false, why: "branch cell not adjacent to the junction" };
  const seen = new Set([`${junction.x},${junction.y}`]);
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    if (!isOpenCell(c, maze)) return { valid: false, why: `cell ${c.x},${c.y} is a wall or out of bounds` };
    if (i > 0 && manhattan(cells[i - 1], c) !== 1) return { valid: false, why: `${cells[i-1].x},${cells[i-1].y} -> ${c.x},${c.y} not adjacent` };
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) return { valid: false, why: `cell ${key} revisited` };
    seen.add(key);
  }
  const end = cells[cells.length - 1];
  return { valid: true, endsAtGoal: end.x === goal.x && end.y === goal.y, endIsDeadEnd: openNeighborCountMaze(end, maze) === 1, steps: cells.length };
}

// PROOF that a branch is a dead end: the model's `region` must be CLOSED — every
// open neighbour of every cell in it is also in it (or is the junction) — contain
// the branch cell, and exclude the goal. Closure means nothing can escape the
// pocket, so the dead end is certain. This is a single verification pass over the
// model's own cells, not a search for the answer.
function validateRegionClosure(junction, branch, region, maze, goal) {
  if (!Array.isArray(region) || region.length === 0) return { valid: false, why: "no region given — list every cell of the pocket" };
  const cells = region.map(normalizeCell);
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  if (!set.has(`${branch.x},${branch.y}`)) return { valid: false, why: "region must contain the branch cell" };
  if (set.has(`${goal.x},${goal.y}`)) return { valid: false, why: "region contains the goal, so it is not a dead end" };
  const junctionKey = `${junction.x},${junction.y}`;
  for (const c of cells) {
    if (!isOpenCell(c, maze)) return { valid: false, why: `region cell ${c.x},${c.y} is a wall or out of bounds` };
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (!isOpenCell(n, maze)) continue;
      const key = `${n.x},${n.y}`;
      if (key === junctionKey || set.has(key)) continue;
      return { valid: false, why: `cell ${c.x},${c.y} opens onto ${key}, which you left out — you missed that turning, so explore it` };
    }
  }
  return { valid: true, size: cells.length };
}

// A maze with no loops is a tree: open edges === open cells - 1. Counted in one
// pass (no search). In a tree, removing a junction splits the maze into one piece
// per branch, and the goal lies in EXACTLY ONE of them — which is what lets a
// single validated route prove every other branch is a dead end.
function isLooplessMaze(maze) {
  let cells = 0, edges = 0;
  for (let y = 0; y < maze.length; y += 1) {
    for (let x = 0; x < maze[y].length; x += 1) {
      if (maze[y][x] !== 0) continue;
      cells += 1;
      if (isOpenCell({ x: x + 1, y }, maze)) edges += 1;
      if (isOpenCell({ x, y: y + 1 }, maze)) edges += 1;
    }
  }
  return cells > 0 && edges === cells - 1;
}

function deriveVerdicts(results) {
  const reaching = results.filter((r) => r.reaches);
  const best = reaching.length ? Math.min(...reaching.map((r) => r.steps)) : Infinity;
  return results.map((r) => ({
    x: r.branch.x, y: r.branch.y,
    verdict: r.reaches ? (r.steps === best ? "toward_goal" : "detour") : "dead_end",
    steps: r.steps,
    reason: r.reason,
    proven: Boolean(r.proven), // true = derived from a validated traced path
  }));
}

async function evaluateJunctionTraced(state, logError = () => {}, maxAttempts = 4) {
  let feedback = "";
  let lastResults = null;
  const loopless = isLooplessMaze(state.maze);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let parsed;
    try {
      parsed = parseLlmResponse(await callLlm(buildJunctionTracePayload(state, feedback, loopless), batchTimeoutMs), logError);
    } catch (error) {
      feedback = error.message; logError("junction_trace_error", { attempt, message: error.message }); continue;
    }
    const modelBranches = Array.isArray(parsed && parsed.branches) ? parsed.branches : [];

    // In a loopless maze exactly one branch leads onward, so EITHER proof settles the
    // whole junction:
    //   route      — one branch has a validated route to the goal  => all others dead
    //   elimination— all branches but one have a validated CLOSED pocket => that one leads on
    // Pockets are usually tiny (median ~6 cells) while routes are long, so elimination
    // is often the cheap way; we accept whichever the model manages.
    if (loopless) {
      const info = state.branches.map((b) => {
        const mb = modelBranches.find((m) => Number(m.x) === b.x && Number(m.y) === b.y);
        const estimate = mb && Number.isFinite(Number(mb.steps_estimate)) ? Math.max(1, Number(mb.steps_estimate)) : 1;
        const reason = String((mb && mb.reason) || "");
        let routeSteps = null;
        if (mb && mb.reaches_goal) {
          const v = validateTracedPath(state.junction, b, mb.path || [], state.maze, state.goal);
          if (v.valid && v.endsAtGoal) routeSteps = v.steps;
        }
        const closed = mb && !mb.reaches_goal
          ? validateRegionClosure(state.junction, b, mb.region || [], state.maze, state.goal).valid
          : false;
        return { b, estimate, reason, routeSteps, closed };
      });

      const routed = info.filter((i) => i.routeSteps != null);
      const deadProven = info.filter((i) => i.closed);
      const undecided = info.filter((i) => i.routeSteps == null && !i.closed);
      let winner = null, proof = "";
      if (routed.length === 1) { winner = routed[0]; proof = "tree-route"; }
      else if (routed.length === 0 && undecided.length === 1 && deadProven.length === info.length - 1) {
        winner = undecided[0]; proof = "tree-elimination";
      }

      if (winner) {
        const branches = info.map((i) => (i === winner
          ? { x: i.b.x, y: i.b.y, verdict: "toward_goal", steps: i.routeSteps != null ? i.routeSteps : i.estimate, reason: i.reason, proven: true }
          : { x: i.b.x, y: i.b.y, verdict: "dead_end", steps: i.estimate, reason: i.reason, proven: true }));
        return { status: "evaluated", branches, provider, model, attempts: attempt + 1, proof };
      }
    }

    const results = [];
    const bad = [];
    for (const b of state.branches) {
      const mb = modelBranches.find((m) => Number(m.x) === b.x && Number(m.y) === b.y);
      if (!mb) { bad.push(`${b.x},${b.y}: missing from response`); continue; }
      const reason = String(mb.reason || "");
      const estimate = Number.isFinite(Number(mb.steps_estimate)) ? Math.max(1, Number(mb.steps_estimate)) : 1;
      const v = validateTracedPath(state.junction, b, mb.path || [], state.maze, state.goal);

      if (!mb.reaches_goal) {
        // DEAD END: accepted only if the explored region is CLOSED. Walking one
        // corridor into a wall is not proof — the pocket must have no way out.
        const rc = validateRegionClosure(state.junction, b, mb.region || [], state.maze, state.goal);
        if (!rc.valid) { bad.push(`${b.x},${b.y}: dead-end not proven — ${rc.why}`); continue; }
        results.push({ branch: b, reaches: false, steps: estimate, reason, proven: true });
        continue;
      }
      // REACHES GOAL: a valid full trace gives exact steps; otherwise take the
      // model's estimate (shown as "~N" in the UI) so coverage stays complete.
      if (v.valid && v.endsAtGoal) results.push({ branch: b, reaches: true, steps: v.steps, reason, proven: true });
      else results.push({ branch: b, reaches: true, steps: estimate, reason, proven: false });
    }
    lastResults = results;
    if (!bad.length) return { status: "evaluated", branches: deriveVerdicts(results), provider, model, attempts: attempt + 1 };
    feedback = `Some branches were rejected: ${bad.join("; ")}. Fix ONLY these. For a dead end, keep exploring every side turning until the TO-VISIT list is empty and list EVERY cell in region; if a turning leads onward to the goal, it is NOT a dead end — set reaches_goal=true and give the path instead.`;
    logError("junction_trace_retry", { attempt, bad });
  }
  const err = new Error("junction trace did not fully validate after retries");
  err.partial = lastResults ? deriveVerdicts(lastResults) : [];
  throw err;
}

module.exports = {
  provider,
  model,
  hintTimeoutMs,
  getCredentialError,
  validateRequestState,
  requestValidatedPath,
  validateRouteRequest,
  evaluateRoutes,
  validateBatchRequest,
  evaluateJunctionsBatch,
  evaluateJunctionTraced,
};
