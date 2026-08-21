# AI Disappear Maze

A first-person maze study on **reliance on an AI assistant, and what happens when it is
taken away**. Participants solve eight matched mazes in the browser. In one condition an
assistant suggests routes throughout; in another it is removed half-way; a third has no
assistant at all.

MSc project, Imperial College London.

## The study

Eight mazes, played back to back in one sitting. The condition is fixed by the link a
participant is sent:

| condition | assistant |
|---|---|
| `no_ai` | none, all eight mazes |
| `stable_ai` | present in all eight |
| `disappear` | present in mazes 1–4, **absent from 5–8** |

Every maze is matched on difficulty: **53 moves** on the shortest route, **25 branch
points**, and more than one correct path. The exits are deliberately spread — two ahead
of the spawn, three to the left, three to the right — so no one can learn "the exit is
always south".

**The assistant** is a coloured route line on the floor plus a short caption, shown
automatically on arrival at a junction. Nobody presses anything. The caption names the
shorter branch and its distance; colour tracks distance to the exit across the whole maze
(dark red near, light red far).

## How the hints are made

**Offline, before anyone plays.** Live calls were tried first and abandoned — a reasoning
model takes seconds to minutes, and a participant waiting at a junction is not the
behaviour being measured.

```
build-solutions.mjs   ask an LLM for several whole-maze routes
        |             each route is re-walked against the grid before it is kept
        v
solutions/maze-N.json verified routes only
        |
        |             merge-solutions.mjs  union an earlier set, re-validating
        v
derive-hints.mjs      arithmetic over verified routes -- no AI
        v
hints/maze-N.json     what the study serves
        |
        +--> audit-hints.mjs   derived distances vs BFS ground truth
        +--> verify.mjs        maze structure, path length, exit bearings
        +--> coverage.mjs      routes, step range, junctions cued
```

The model is sent an **`open_cell_graph`** — every open cell with its legal neighbours —
and returns routes as lists of cells. It is never asked about junctions; the per-junction
claims are derived afterwards. So a distance shown to a participant is a sum of verified
segments and cannot be a number a model invented.

Current set: **192 of 200 junctions cued, 88% of distances exact, none understated.**

## Layout

```
public/            everything the browser loads
  mazes8/          THE SERVED SET: maze configs, hints/, solutions/
  game.js          rendering, controls, cues, logging
  maze.js          study sequence, conditions, participant id, questionnaires
mazes8/            HOW THE SET WAS MADE -- never served
  scripts/         generation, derivation and checking tools
  candidates/      the raw generated mazes, before the exits were placed
  manifest.json    the generation record
api/               serverless endpoints (also mounted by server.js)
lib/               store.js (data), hint-engine.js (offline generation)
```

**Why `mazes8/` twice.** `public/mazes8/` is what the study serves; `mazes8/` is the
toolchain and provenance that produced it. The candidates in `mazes8/` are deliberately
*not* identical to the served mazes — they predate the exit placement step. Same name,
different jobs: one is data, the other is how the data was made.

## Running it

```bash
npm install
npm start                                   # http://localhost:3000
```

```
/study/participant?condition=disappear      # a run
/study/participant                          # server assigns the condition
/m8                                         # index of the eight mazes
```

No LLM key is needed to run the study — cues are pre-generated files. A key is only
needed to regenerate them.

## The data

Rows are posted as the run proceeds and stored server-side, so a closed tab loses
nothing. Download as CSV:

```
/api/run-log?export=summaries                     one row per completed maze
/api/run-log?export=summaries&condition=no_ai     one condition
/api/run-log?export=events                        every event
/api/run-log?health=1                             is the store reachable
```

Storage is chosen by environment: `KV_REST_API_URL` + `KV_REST_API_TOKEN` use a
Redis-compatible store over REST; without them the app keeps a JSON file on its own disk,
which is what a self-hosted deployment uses.

## Regenerating the hints

```bash
MAZE_REPR=graph REASONING_EFFORT=high MAX_OUTPUT_TOKENS=65536 \
  node mazes8/scripts/build-solutions.mjs maze-1 6 --set=mazes8
bash mazes8/scripts/derive-all.sh
node mazes8/scripts/verify.mjs
```

`IMPLEMENTATION.md` records why each of those settings is load-bearing.

## Documents

| file | what it holds |
|---|---|
| `IMPLEMENTATION.md` | design decisions and measurements, including model comparisons |
| `DECISIONS.md` | the architectures this passed through, and why each was abandoned |
| `DEPLOY.md` | hosting, including reaching participants in mainland China |
| `ASSETS.md` | third-party assets and licences |
| `docs/history/` | archived design documents that no longer describe the system |
