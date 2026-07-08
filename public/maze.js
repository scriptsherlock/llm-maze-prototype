import { createMazeConfig } from "./maze_gen.js";

export const MAZE_CONFIG = createMazeConfig({
  graphWidth: 7,
  graphHeight: 7,
  seed: resolveMazeSeed(),
  loopProbability: 0.3,
  maxStraightGraphCells: 3,
  maxStraightSpaces: 5,
  hintSteps: 3,
});

function resolveMazeSeed() {
  const querySeed = getQuerySeed();
  if (querySeed != null) {
    storeSeed(querySeed);
    return querySeed;
  }

  const storedSeed = getStoredSeed();
  if (storedSeed != null) return storedSeed;

  let generatedSeed;
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    generatedSeed = values[0];
  } else {
    generatedSeed = Math.floor(Math.random() * 4294967295);
  }

  storeSeed(generatedSeed);
  return generatedSeed;
}

function getQuerySeed() {
  if (!globalThis.location) return null;
  const params = new URLSearchParams(globalThis.location.search || "");
  const seed = Number(params.get("seed"));
  return Number.isInteger(seed) && seed >= 0 ? seed : null;
}

function getStoredSeed() {
  try {
    const seed = Number(globalThis.localStorage && globalThis.localStorage.getItem("llm_maze_seed"));
    return Number.isInteger(seed) && seed >= 0 ? seed : null;
  } catch (_error) {
    return null;
  }
}

function storeSeed(seed) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem("llm_maze_seed", String(seed));
  } catch (_error) {
    // Local storage is optional; URL seeds still make the maze reproducible.
  }
}

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
