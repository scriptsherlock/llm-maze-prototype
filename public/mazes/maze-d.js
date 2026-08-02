// Imported from maze-d.svg by scripts/import-svg-maze.mjs.
// Exact conversion of the SVG wall lines — not transcribed by eye.
// 10x10 cells => 21x21 display grid. Solution 61 steps, 21 junctions, 0 loops.
const WALL_ROWS = [
  "111111111011111111111",
  "100010000000100000001",
  "101111111110101010111",
  "100000100010101010001",
  "111011101110101111101",
  "101000000000000010101",
  "101011101111111110101",
  "101010001000000000001",
  "101110111011111111101",
  "100000100000001000001",
  "101110101111111110101",
  "101000101000100000101",
  "101111101010101111111",
  "100010001010100000001",
  "101010111010111011101",
  "101010001010001000101",
  "111011111011101111101",
  "100010000010001000001",
  "101010111010111011101",
  "101000100010100000101",
  "111111111110111111111",
];

export const MAZE_D_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const MAZE_D_MAZE_CONFIG = {
  id: "maze_d-10x10",
  name: "10 by 10 orthogonal maze",
  maze: MAZE_D_MAZE_GRID,
  start: { x: 9, y: 1 },
  entrance: { x: 9, y: 0 },
  startFacing: 2,
  goal: { x: 11, y: 20 },
  chokeCell: { x: 3, y: 19 },
  hintSteps: 3,
  seed: 0,
};
