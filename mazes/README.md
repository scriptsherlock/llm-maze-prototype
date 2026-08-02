# mazes — the study's maze module

Everything that turns a maze into a playable trial lives here. Authoring files stay
in this folder; anything the browser has to load is written into `public/mazes/`
(only `public/` is deployed).

```
mazes/
  manifest.json      the 4 mazes and the 3 conditions — single source of truth
  svg/               source SVGs exported from mazegenerator.net
  scripts/
    import-svg.mjs   SVG -> playable maze module
    analyse.mjs      complexity profile (are two mazes matched?)
    build-matched.mjs generate a complexity-matched twin of a maze
public/mazes/
  <id>.js            maze module the game imports
  hints/<id>.json    precomputed AI cues
```

## Adding a maze

1. **Generate** on <https://www.mazegenerator.net/> and export **SVG** (not PDF —
   the SVG carries exact wall coordinates, so nothing is transcribed by eye).
   Use the settings in `manifest.json → targetProfile`.

2. **Import**
   ```bash
   node mazes/scripts/import-svg.mjs mazes/svg/maze-b.svg MAZE_B public/mazes/maze-b.js
   ```
   It infers the lattice, finds the entrance/exit from the gaps in the border, and
   reports solvability, junctions and loops.

3. **Check it matches the others**
   ```bash
   node mazes/scripts/analyse.mjs public/mazes/*.js
   ```
   All four mazes should land close together, and near `targetProfile`.

4. **Precompute the AI hints** (only needed for the AI conditions)
   ```bash
   node scripts/build-cues.mjs maze-b
   ```
   Roughly 5–8 minutes for a 10x10. It checkpoints after every junction, so an
   interrupted run is not lost. Hints are proven, not guessed: a dead end is only
   accepted if the model can enumerate the whole closed pocket.

5. **Record it** in `manifest.json` (id, paths, order, profile).

## Choosing generator settings

The two knobs on mazegenerator.net, and what they do for this study:

| Setting | Effect | Want |
|---|---|---|
| **E-value** (elitism) | High E = short solution relative to maze size | **Low (0–25)** — the solution should wander through ≥40% of the maze, giving a longer task and more junctions |
| **R-value** (river) | High R = few but long dead ends | **Low–medium (30–50)** — many dead ends of 4–9 cells: deep enough that a warning is worth having, shallow enough that the AI can prove them |

Measured example — `maze-a` has the profile we want, `maze-c` does not:

```
maze      size   solution  coverage%  junctions  deadEnds  avgDepth  maxDepth  loops
maze-a    10x10  93        47         12         11        4.1       9         0
maze-c    10x10  45        23          8          3       14.7      23         0
```

**These mazes are always perfect (no loops)** — exactly one route between any two
cells, whatever E and R are set to. No generator setting produces alternative
routes; that needs braiding, which costs AI accuracy (measured: 97% → 82%, and
false dead ends reappear). So the AI compares "this way ~N steps / that way is a
dead end" rather than ranking two routes.

## Conditions

The **same four mazes** are used in all three conditions, so difficulty is
identical and only the AI differs (between-subjects — one condition per
participant; a participant must not see the same maze twice).

| Condition | AI | AI disappears |
|---|---|---|
| `no_ai` | off throughout | — |
| `stable_ai` | on throughout | — |
| `disappear` | on | on mazes 3 and 4, at the choke cell (~halfway) |

`chokeOn` in the manifest lists which mazes lose the AI. A maze needs a
`chokeCell` in its module for that to work — every cell on the solution of a
perfect maze is a valid choke, so the midpoint of the route is the natural pick.
