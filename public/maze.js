import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";
import { ORIGINAL_15X15_MAZE_CONFIG } from "./original_15x15_maze.js";
import { DISAPPEAR_MAZE_CONFIG } from "./disappear_maze.js";
import { SUPPLIED_MAZE_CONFIG } from "./supplied_maze.js";
import { V6_MAZE_CONFIG } from "./v6_maze.js";
import { MAZE_A_MAZE_CONFIG } from "./mazes/maze-a.js";
import { MAZE_B_MAZE_CONFIG } from "./mazes/maze-b.js";
import { MAZE_C_MAZE_CONFIG } from "./mazes/maze-c.js";
import { MAZE_D_MAZE_CONFIG } from "./mazes/maze-d.js";

// The four study mazes, addressable at /maze-a/participant ... /maze-d/participant.
const STUDY_MAZES = {
  "maze-a": MAZE_A_MAZE_CONFIG,
  "maze-b": MAZE_B_MAZE_CONFIG,
  "maze-c": MAZE_C_MAZE_CONFIG,
  "maze-d": MAZE_D_MAZE_CONFIG,
};

// Pick the maze from the URL. The two study conditions:
//   /ai-maze/*     the SUPPLIED maze (imported from the 10x10 SVG) WITH AI hints
//   /no-ai-maze/*  the v6 braided maze, with NO AI at all from the start
// /disappear/* and /original/* are the earlier mazes; anything else is the
// default 8x8.
const path = (globalThis.location && globalThis.location.pathname) || "";
const studyId = Object.keys(STUDY_MAZES).find((id) => path.includes(id)) || null;
const mazeKey = studyId
  || (path.includes("no-ai-maze") ? "no_ai"
  : path.includes("ai-maze") ? "ai"
  : path.includes("disappear") ? "disappear"
  : path.includes("original") ? "original"
  : "default");

export const MAZE_CONFIG = studyId ? STUDY_MAZES[studyId]
  : mazeKey === "no_ai" ? V6_MAZE_CONFIG
  : mazeKey === "ai" ? SUPPLIED_MAZE_CONFIG
  : mazeKey === "disappear" ? DISAPPEAR_MAZE_CONFIG
  : mazeKey === "original" ? ORIGINAL_15X15_MAZE_CONFIG
  : FIXED_8X8_MAZE_CONFIG;

export const MAZE_KEY = mazeKey;

// Where the precomputed cues live. The study mazes keep theirs alongside the maze
// module (public/mazes/hints/), the older ones use the original data folder.
export const HINTS_URL = studyId
  ? `/mazes/hints/${studyId}.json`
  : `/data/junction-cues.${mazeKey}.json`;

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
