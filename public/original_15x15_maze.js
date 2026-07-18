// Exact wall/passage transcription of the original 7 by 7 orthogonal maze
// (llm-input-og-maze.json). 1 = wall, 0 = passage. The 7x7 source becomes a
// 15x15 display grid.
const WALL_ROWS = [
  "111111111111111",
  "000010000000001",
  "101010111010101",
  "100010001000101",
  "101110101010101",
  "100000001000101",
  "111010111010101",
  "100000000000001",
  "101010101010101",
  "100000001000001",
  "101110101110101",
  "100000001000001",
  "101111101010101",
  "100000000000001",
  "111111111111111",
];

export const ORIGINAL_15X15_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const ORIGINAL_15X15_MAZE_CONFIG = {
  id: "original-7x7",
  name: "Original 7 by 7 orthogonal maze",
  maze: ORIGINAL_15X15_MAZE_GRID,
  start: { x: 0, y: 1 },
  entrance: { x: 0, y: 1 },
  startFacing: 1,
  goal: { x: 13, y: 13 },
  hintSteps: 3,
  seed: 990001,
};
