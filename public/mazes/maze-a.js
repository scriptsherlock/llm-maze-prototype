// Imported from maze-a.svg by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// 10x10 cells => 21x21 display grid. Solution 53 steps, 21 junctions, 0 loops.
const WALL_ROWS = [
  "111111111011111111111",
  "101000000010000000001",
  "101011101010111111101",
  "100010101000100000001",
  "111010101111101111101",
  "101010000010101000101",
  "101110111010101010101",
  "100000100010001010101",
  "101110101111101011101",
  "101010100010000010101",
  "111010111011111010111",
  "101000100010101010001",
  "101110111010101110101",
  "100000101000001000101",
  "111011101110111011101",
  "101000001010000010001",
  "101110111011111110101",
  "100000000000000010101",
  "101110111011111110101",
  "101000100010000000101",
  "111111111110111111111",
];

export const MAZE_A_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const MAZE_A_MAZE_CONFIG = {
  id: "maze_a-10x10",
  name: "10 by 10 orthogonal maze",
  maze: MAZE_A_MAZE_GRID,
  start: { x: 9, y: 1 },
  entrance: { x: 9, y: 0 },
  startFacing: 2,
  goal: { x: 11, y: 20 },
  hintSteps: 3,
  seed: 0,
};
