import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";
import { ORIGINAL_15X15_MAZE_CONFIG } from "./original_15x15_maze.js";

// Pick the maze from the URL: /original/* loads the original 7x7 maze,
// anything else keeps the default 8x8 maze. The AI hint logic is unchanged —
// the server derives everything from the maze sent in each /api/hint request.
const useOriginalMaze = Boolean(
  globalThis.location && globalThis.location.pathname.includes("original")
);

export const MAZE_CONFIG = useOriginalMaze
  ? ORIGINAL_15X15_MAZE_CONFIG
  : FIXED_8X8_MAZE_CONFIG;

// Key for the precomputed cue file (public/data/junction-cues.<MAZE_KEY>.json).
export const MAZE_KEY = useOriginalMaze ? "original" : "default";

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
