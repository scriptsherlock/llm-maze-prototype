// Shared maze-hint logic used by BOTH the local Express server (server.js) and
// the hosted serverless function (api/hint.js). No file I/O lives here — callers
// inject a logError(action, details) function (file logging locally, console when
// hosted), so the same engine runs in both environments.

const requestedProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const provider = ["openai", "venice", "gemini"].includes(requestedProvider)
  ? requestedProvider
  : "openai";
const hintTimeoutMs = 20000;

function getModelForProvider() {
  if (provider === "venice") return process.env.VENICE_MODEL || "zai-org-glm-5-1";
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
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
  let lastValidationError = "";
  let firstAttemptPath = null;
  // BFS is recomputed only as a reference to validate the AI answer. It is logged
  // for comparison but never shown to the participant and never substituted in.
  const referencePath = findShortestPath(state.player, state.goal, state.maze);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const llmPayload = buildLlmPayload(state, attempt, lastValidationError);
    const raw = await callLlm(llmPayload);
    const parsed = parseLlmResponse(raw, logError);

    // The model returns a compact move string (e.g. "EESSW"); expand it to cells
    // starting from the player. This is much shorter to generate than a coordinate
    // array and, by construction, cannot contain non-adjacent jumps.
    const candidatePath = expandMoves(state.player, parsed && parsed.moves);
    const candidate = { status: parsed && parsed.status, full_path: candidatePath };

    // Remember the AI's first answer so we can still surface it if nothing validates.
    if (firstAttemptPath === null && candidatePath.length > 1) {
      firstAttemptPath = candidatePath;
    }

    const validation = validateLlmPath(candidate, state);

    if (validation.ok) {
      const derivedHintSteps = candidatePath.slice(1, 1 + state.max_hint_steps);
      return {
        status: "path_found",
        full_path: candidatePath,
        hint_steps: derivedHintSteps,
        reason: "Valid full path returned by the live LLM.",
        retry_count: attempt,
        validation_status: "valid",
        reference_path: referencePath,
        required_shortest_path_cells: referencePath.length,
      };
    }

    lastValidationError = validation.message;
    logError("llm_response_rejected", {
      provider,
      model,
      attempt,
      validation_error: validation.message,
      parsed_status: parsed && parsed.status,
      moves: parsed && parsed.moves,
      full_path_length: candidatePath.length,
      full_path: candidatePath,
      player: state.player,
      goal: state.goal,
      client_event_id: state.client_event_id,
    });
  }

  // The AI never returned a valid shortest path. Per study design we still surface the
  // AI's own first answer so the participant always sees an AI hint; the failure is
  // logged above and flagged as invalid below rather than being hidden or replaced.
  if (firstAttemptPath && firstAttemptPath.length > 0) {
    return {
      status: "path_found",
      full_path: firstAttemptPath,
      hint_steps: firstAttemptPath.slice(1, 1 + state.max_hint_steps),
      reason: "AI path shown without validation; it did not match the shortest legal path.",
      retry_count: 1,
      validation_status: "invalid",
      validation_error: lastValidationError,
      reference_path: referencePath,
      required_shortest_path_cells: referencePath.length,
    };
  }

  // Genuinely nothing to draw: the LLM never returned a parseable path at all.
  const error = new Error("The live LLM did not return any usable path.");
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

function systemInstructions(correction) {
  return [
    "You are the AI path planner for a maze navigation study.",
    "Return only JSON matching the requested schema.",
    "Find the shortest valid path from the player cell to the goal.",
    "Coordinates use x for column and y for row. 0 means open, 1 means wall.",
    "Output the path as `moves`: a string of cardinal-direction letters, one per step,",
    "where N = up (y-1), S = down (y+1), E = right (x+1), W = left (x-1).",
    "Applying the moves in order, starting at the player cell, must land exactly on the goal.",
    "Use open_cell_graph as the authority for legal movement: never step onto a wall or off the grid.",
    "Use the fewest moves (the shortest path): the letter count must equal required_shortest_path_cells minus 1.",
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
    // maze task (it steps onto walls); "medium" is the accuracy/latency balance.
    max_completion_tokens: 8192,
    reasoning_effort: "medium",
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
      "Return `moves`: a string of the letters N, S, E, W — one letter per step from player to goal.",
      "N = y-1, S = y+1, E = x+1, W = x-1.",
      "Starting at the player cell and applying the moves in order must reach the goal.",
      "Each intermediate cell must be an open cell (see open_cell_graph); never cross a wall.",
      "Use the fewest moves: the string length must equal required_shortest_path_cells - 1.",
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
  // Compact output: a move string (e.g. "EESSW") instead of a coordinate array.
  // Far fewer tokens to generate, and adjacency is guaranteed by construction.
  // The server expands it to cells and validates as before.
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "moves"],
    properties: {
      status: { type: "string", enum: ["path_found", "no_path"] },
      moves: {
        type: "string",
        description: "Cardinal moves from the player to the goal, one letter per step: N=up (y-1), S=down (y+1), E=right (x+1), W=left (x-1).",
      },
    },
  };
}

const MOVE_DELTAS = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

// Expand a move string ("EESSW") into a cell path starting at the player. Ignores
// any non-NSEW characters (stray separators) so minor formatting doesn't break it.
function expandMoves(player, moves) {
  const cells = [{ x: Number(player.x), y: Number(player.y) }];
  if (typeof moves !== "string") return cells;
  for (const character of moves.toUpperCase()) {
    const delta = MOVE_DELTAS[character];
    if (!delta) continue;
    const prev = cells[cells.length - 1];
    cells.push({ x: prev.x + delta.x, y: prev.y + delta.y });
  }
  return cells;
}

async function callLlm(payload) {
  if (provider === "venice") return callProvider(payload, "https://api.venice.ai/api/v1/chat/completions", process.env.VENICE_API_KEY, "Venice");
  if (provider === "gemini") return callProvider(payload, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", process.env.GEMINI_API_KEY, "Gemini");
  return callProvider(payload, "https://api.openai.com/v1/responses", process.env.OPENAI_API_KEY, "OpenAI");
}

async function callProvider(payload, url, apiKey, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hintTimeoutMs);

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

module.exports = {
  provider,
  model,
  hintTimeoutMs,
  getCredentialError,
  validateRequestState,
  requestValidatedPath,
};
