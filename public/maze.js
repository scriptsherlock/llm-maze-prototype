import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";
import { ORIGINAL_15X15_MAZE_CONFIG } from "./original_15x15_maze.js";
import { DISAPPEAR_MAZE_CONFIG } from "./disappear_maze.js";
import { AI_MAZE_CONFIG } from "./ai_maze.js";
import { NO_AI_MAZE_CONFIG } from "./no_ai_maze.js";

// Pick the maze from the URL. The two study conditions are /ai-maze/* (AI hints)
// and /no-ai-maze/* (no AI) — two different 10x10 mazes matched on solution length,
// junctions and dead ends, so they differ only in the AI. /disappear/* and
// /original/* are the earlier mazes; anything else is the default 8x8.
const path = (globalThis.location && globalThis.location.pathname) || "";
const mazeKey = path.includes("no-ai-maze") ? "no_ai"
  : path.includes("ai-maze") ? "ai"
  : path.includes("disappear") ? "disappear"
  : path.includes("original") ? "original"
  : "default";

export const MAZE_CONFIG = mazeKey === "no_ai" ? NO_AI_MAZE_CONFIG
  : mazeKey === "ai" ? AI_MAZE_CONFIG
  : mazeKey === "disappear" ? DISAPPEAR_MAZE_CONFIG
  : mazeKey === "original" ? ORIGINAL_15X15_MAZE_CONFIG
  : FIXED_8X8_MAZE_CONFIG;

// Key for the precomputed cue file (public/data/junction-cues.<MAZE_KEY>.json).
export const MAZE_KEY = mazeKey;

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
