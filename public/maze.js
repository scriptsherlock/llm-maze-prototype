import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";
import { ORIGINAL_15X15_MAZE_CONFIG } from "./original_15x15_maze.js";
import { DISAPPEAR_MAZE_CONFIG } from "./disappear_maze.js";
import { LOOPED_MAZE_CONFIG } from "./looped_maze.js";

// Pick the maze from the URL: /looped/* loads the looped AI-disappears maze (several
// valid routes), /disappear/* the loopless one, /original/* the original maze, and
// anything else the default 8x8. The AI hint logic is unchanged — the server derives
// everything from the maze sent per request.
const path = (globalThis.location && globalThis.location.pathname) || "";
const mazeKey = path.includes("looped") ? "looped"
  : path.includes("disappear") ? "disappear"
  : path.includes("original") ? "original"
  : "default";

export const MAZE_CONFIG = mazeKey === "looped" ? LOOPED_MAZE_CONFIG
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
