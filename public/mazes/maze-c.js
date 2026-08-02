// Imported from maze-c.svg by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// 10x10 cells => 21x21 display grid. Solution 65 steps, 21 junctions, 0 loops.
const WALL_ROWS = [
  "111111111011111111111",
  "100000101000001000001",
  "111010101011101111101",
  "100010000000100010101",
  "101111101111111010101",
  "101000000000001000001",
  "111010101111111111111",
  "101010100000000000101",
  "101010101110101111101",
  "100010101000101010001",
  "111111111011101011101",
  "100000100010000000101",
  "101110101110111010101",
  "100010101010100010001",
  "101010111011101110101",
  "101010000010101010101",
  "101011101010101011101",
  "101010001000000000101",
  "101011111111101010101",
  "101000000000101010101",
  "111111111110111111111",
];

export const MAZE_C_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const MAZE_C_MAZE_CONFIG = {
  id: "maze_c-10x10",
  name: "10 by 10 orthogonal maze",
  maze: MAZE_C_MAZE_GRID,
  start: { x: 9, y: 1 },
  entrance: { x: 9, y: 0 },
  startFacing: 2,
  goal: { x: 11, y: 20 },
  chokeCell: { x: 9, y: 15 },
  hintSteps: 3,
  seed: 0,
};
