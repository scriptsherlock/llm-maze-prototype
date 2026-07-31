// Imported from 10x10-orthogonal.svg by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// 10x10 cells => 21x21 display grid. Solution 93 steps, 12 junctions, 0 loops.
const WALL_ROWS = [
  "111111111011111111111",
  "100010000000000000101",
  "101011111111111110101",
  "101010001000000000101",
  "111010101010111111101",
  "100010101010000000101",
  "101011101111101111101",
  "101000000000100000001",
  "101111111110111111101",
  "100000001010101000101",
  "101111101010101010101",
  "100000101010100010101",
  "111011101010111110101",
  "100010001010000010001",
  "101110111010111010111",
  "101000001010001000101",
  "101011101011101111101",
  "101010101000000000101",
  "101010101111101111101",
  "101000100000100000001",
  "111111111110111111111",
];

export const NO_AI_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const NO_AI_MAZE_CONFIG = {
  id: "no_ai-10x10",
  name: "10 by 10 orthogonal maze",
  maze: NO_AI_MAZE_GRID,
  start: { x: 9, y: 1 },
  entrance: { x: 9, y: 0 },
  startFacing: 2,
  goal: { x: 11, y: 20 },
  hintSteps: 3,
  seed: 0,
};
