// Exact wall/passage transcription of the supplied 8 by 8 orthogonal maze PDF.
// 1 = wall, 0 = passage. The 8x8 source becomes a 17x17 display grid.
const WALL_ROWS = [
  "11111110111111111",
  "10001000000000001",
  "11101011101011101",
  "10001000101010001",
  "10111010111011111",
  "10100010100000101",
  "10111110101110101",
  "10000000101000101",
  "11111110101110101",
  "10000000100010101",
  "10111111111010101",
  "10100010000010001",
  "10101010101011111",
  "10101000101000101",
  "10101111111010101",
  "10100000001010001",
  "11111111101111111",
];

export const FIXED_8X8_MAZE_GRID = WALL_ROWS.map((row) => [...row].map(Number));

export const FIXED_8X8_MAZE_CONFIG = {
  id: "fixed-8x8-pdf",
  name: "8 by 8 orthogonal maze",
  maze: FIXED_8X8_MAZE_GRID,
  start: { x: 7, y: 1 },
  entrance: { x: 7, y: 0 },
  startFacing: 1,
  goal: { x: 9, y: 16 },
  hintSteps: 3,
  seed: 880001,
};
