// Imported from maze-b.svg by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// 10x10 cells => 21x21 display grid. Solution 61 steps, 22 junctions, 0 loops.
const WALL_ROWS = [
  "111111111011111111111",
  "101000100000100000001",
  "101011111011101010111",
  "101010000000001010001",
  "101010111111101011101",
  "100000000010101010101",
  "111011111010111110111",
  "100000101010000000101",
  "101010101110111110101",
  "101010001010100000001",
  "101011101010101111101",
  "101010100000100000101",
  "101110111110111110101",
  "101010001000100010101",
  "101011101111101010101",
  "100000001010001010101",
  "101011111010101110101",
  "101000000000101000101",
  "111011101111111011101",
  "100000100010000010001",
  "111111111110111111111",
];

export const MAZE_B_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const MAZE_B_MAZE_CONFIG = {
  id: "maze_b-10x10",
  name: "10 by 10 orthogonal maze",
  maze: MAZE_B_MAZE_GRID,
  start: { x: 9, y: 1 },
  entrance: { x: 9, y: 0 },
  startFacing: 2,
  goal: { x: 11, y: 20 },
  hintSteps: 3,
  seed: 0,
};
