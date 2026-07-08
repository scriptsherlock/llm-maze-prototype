function seededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function keyFor(x, y) {
  return `${x}.${y}`;
}

function shuffle(items, random) {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = out[index];
    out[index] = out[swapIndex];
    out[swapIndex] = temp;
  }
  return out;
}

function createGraph(width, height, seed) {
  const random = seededRandom(seed);
  const nodes = {};

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const potentialEdges = [];
      if (y > 0) potentialEdges.push(keyFor(x, y - 1));
      if (x < width - 1) potentialEdges.push(keyFor(x + 1, y));
      if (y < height - 1) potentialEdges.push(keyFor(x, y + 1));
      if (x > 0) potentialEdges.push(keyFor(x - 1, y));

      nodes[keyFor(x, y)] = {
        x,
        y,
        edges: [],
        potentialEdges,
      };
    }
  }

  const visited = new Set();

  function visit(nodeKey) {
    visited.add(nodeKey);
    const node = nodes[nodeKey];
    const neighbors = shuffle(node.potentialEdges, random);

    for (const nextKey of neighbors) {
      if (visited.has(nextKey)) continue;
      node.edges.push(nextKey);
      nodes[nextKey].edges.push(nodeKey);
      visit(nextKey);
    }
  }

  visit(keyFor(0, 0));
  return nodes;
}

function hasEdge(node, edgeKey) {
  return node.edges.includes(edgeKey);
}

function addEdge(nodes, fromKey, toKey) {
  if (!nodes[fromKey] || !nodes[toKey]) return false;
  if (!hasEdge(nodes[fromKey], toKey)) nodes[fromKey].edges.push(toKey);
  if (!hasEdge(nodes[toKey], fromKey)) nodes[toKey].edges.push(fromKey);
  return true;
}

function addLoopOpenings(nodes, random, probability) {
  for (const nodeKey of Object.keys(nodes)) {
    const node = nodes[nodeKey];
    const candidates = shuffle(
      node.potentialEdges.filter((edgeKey) => !hasEdge(node, edgeKey)),
      random
    );

    for (const edgeKey of candidates) {
      if (random() < probability) addEdge(nodes, nodeKey, edgeKey);
    }
  }
}

function breakLongStraightCorridors(nodes, width, height, maxGraphCells) {
  let changed = true;
  let guard = 0;

  while (changed && guard < 20) {
    changed = false;
    guard += 1;

    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        const run = collectStraightRun(nodes, width, height, x, y, "horizontal");
        if (run.length > maxGraphCells && addPerpendicularOpening(nodes, run, "horizontal")) {
          changed = true;
        }
        x += Math.max(run.length, 1);
      }
    }

    for (let x = 0; x < width; x += 1) {
      let y = 0;
      while (y < height) {
        const run = collectStraightRun(nodes, width, height, x, y, "vertical");
        if (run.length > maxGraphCells && addPerpendicularOpening(nodes, run, "vertical")) {
          changed = true;
        }
        y += Math.max(run.length, 1);
      }
    }
  }
}

function collectStraightRun(nodes, width, height, startX, startY, axis) {
  const run = [];
  let x = startX;
  let y = startY;

  while (x < width && y < height) {
    const node = nodes[keyFor(x, y)];
    const horizontal = [
      x > 0 && hasEdge(node, keyFor(x - 1, y)),
      x < width - 1 && hasEdge(node, keyFor(x + 1, y)),
    ].filter(Boolean).length;
    const vertical = [
      y > 0 && hasEdge(node, keyFor(x, y - 1)),
      y < height - 1 && hasEdge(node, keyFor(x, y + 1)),
    ].filter(Boolean).length;

    const continues = axis === "horizontal"
      ? horizontal > 0 && vertical === 0
      : vertical > 0 && horizontal === 0;
    if (!continues) break;

    run.push(node);
    if (axis === "horizontal") x += 1;
    else y += 1;
  }

  return run;
}

function addPerpendicularOpening(nodes, run, axis) {
  const center = run[Math.floor(run.length / 2)];
  const offsets = axis === "horizontal"
    ? [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }]
    : [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

  for (const offset of offsets) {
    const edgeKey = keyFor(center.x + offset.dx, center.y + offset.dy);
    if (center.potentialEdges.includes(edgeKey) && !hasEdge(center, edgeKey)) {
      return addEdge(nodes, keyFor(center.x, center.y), edgeKey);
    }
  }

  return false;
}

function carveGraphToGrid(nodes, width, height) {
  const rows = height * 2 + 1;
  const cols = width * 2 + 1;
  const maze = Array.from({ length: rows }, () => Array(cols).fill(1));

  for (const node of Object.values(nodes)) {
    const gridX = node.x * 2 + 1;
    const gridY = node.y * 2 + 1;
    maze[gridY][gridX] = 0;

    for (const edgeKey of node.edges) {
      const neighbor = nodes[edgeKey];
      const neighborX = neighbor.x * 2 + 1;
      const neighborY = neighbor.y * 2 + 1;
      maze[(gridY + neighborY) / 2][(gridX + neighborX) / 2] = 0;
    }
  }

  return maze;
}

function breakLongGridRuns(maze, maxSpaces, random) {
  let changed = true;
  let guard = 0;

  while (changed && guard < 30) {
    changed = false;
    guard += 1;
    changed = breakGridRunsOnAxis(maze, maxSpaces, random, "horizontal") || changed;
    changed = breakGridRunsOnAxis(maze, maxSpaces, random, "vertical") || changed;
  }
}

function breakGridRunsOnAxis(maze, maxSpaces, random, axis) {
  const rows = maze.length;
  const cols = maze[0].length;
  let changed = false;
  const outerLimit = axis === "horizontal" ? rows : cols;
  const innerLimit = axis === "horizontal" ? cols : rows;

  for (let outer = 0; outer < outerLimit; outer += 1) {
    let run = [];

    for (let inner = 0; inner <= innerLimit; inner += 1) {
      const x = axis === "horizontal" ? inner : outer;
      const y = axis === "horizontal" ? outer : inner;
      const inBounds = inner < innerLimit;
      const isolated = inBounds && isOpenGrid(maze, x, y) && !hasPerpendicularOpening(maze, x, y, axis);

      if (isolated) {
        run.push({ x, y });
        continue;
      }

      if (run.length > maxSpaces && addGridSideOpening(maze, run, axis, random)) {
        changed = true;
      }
      run = [];
    }
  }

  return changed;
}

function hasPerpendicularOpening(maze, x, y, axis) {
  if (axis === "horizontal") {
    return isOpenGrid(maze, x, y - 1) || isOpenGrid(maze, x, y + 1);
  }
  return isOpenGrid(maze, x - 1, y) || isOpenGrid(maze, x + 1, y);
}

function addGridSideOpening(maze, run, axis, random) {
  const center = Math.floor(run.length / 2);
  const ordered = [];
  for (let distance = 0; distance <= center; distance += 1) {
    if (run[center - distance]) ordered.push(run[center - distance]);
    if (distance > 0 && run[center + distance]) ordered.push(run[center + distance]);
  }

  if (random() > 0.5) ordered.reverse();

  for (const cell of ordered) {
    const offsets = axis === "horizontal"
      ? [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }]
      : [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

    if (random() > 0.5) offsets.reverse();

    for (const offset of offsets) {
      const wallX = cell.x + offset.dx;
      const wallY = cell.y + offset.dy;
      const beyondX = cell.x + offset.dx * 2;
      const beyondY = cell.y + offset.dy * 2;

      if (isOpenGrid(maze, beyondX, beyondY) && isWallGrid(maze, wallX, wallY)) {
        maze[wallY][wallX] = 0;
        return true;
      }
    }
  }

  return false;
}

function isOpenGrid(maze, x, y) {
  return y >= 0 && y < maze.length && x >= 0 && x < maze[0].length && maze[y][x] === 0;
}

function isWallGrid(maze, x, y) {
  return y > 0 && y < maze.length - 1 && x > 0 && x < maze[0].length - 1 && maze[y][x] === 1;
}

export function createMazeConfig(options = {}) {
  const graphWidth = options.graphWidth || 7;
  const graphHeight = options.graphHeight || 7;
  const seed = options.seed || 60000;
  const random = seededRandom(seed ^ 0xA51A6000);
  const graph = createGraph(graphWidth, graphHeight, seed);
  addLoopOpenings(graph, random, options.loopProbability ?? 0.26);
  breakLongStraightCorridors(graph, graphWidth, graphHeight, options.maxStraightGraphCells || 3);
  const maze = carveGraphToGrid(graph, graphWidth, graphHeight);
  breakLongGridRuns(maze, options.maxStraightSpaces || 5, random);
  const entrance = { x: 0, y: 1 };
  const start = { ...entrance };
  const goal = { x: graphWidth * 2 - 1, y: graphHeight * 2 - 1 };

  maze[entrance.y][entrance.x] = 0;

  return {
    maze,
    graph,
    start,
    entrance,
    goal,
    hintSteps: options.hintSteps || 3,
    seed,
  };
}
