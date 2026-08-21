# What the system does, and what it used to do

A record of the architectures this prototype passed through, why each was abandoned, and
which code still belongs to them. Written because the repository carries fifteen
branches and 172 commits across `v1`–`v9`, and the shape of the current system is not
obvious from any single one of them.

## The system as it stands

Eight matched mazes. Each participant plays all eight in one sitting, in one of three
conditions fixed by the link they were sent:

| condition | assistant |
|---|---|
| `no_ai` | none, all eight mazes |
| `stable_ai` | present in all eight |
| `disappear` | present in mazes 1–4, absent from 5–8 |

The assistant is a coloured route line and a short caption at each junction, saying which
branch is shorter and by how many steps. It appears **automatically** on arrival at a
junction; nobody presses anything. Colour tracks distance to the exit across the whole
maze — dark red is nearer, light red is further — so a single route still carries meaning.

**Hints are precomputed offline, never at run time.** `mazes8/scripts/build-solutions.mjs`
asks an LLM for several whole-maze routes; every route is re-walked against the grid
before it is kept; `derive-hints.mjs` then turns the verified routes into per-junction
claims by arithmetic. A distance shown to a participant is therefore a sum of verified
segments, and cannot be a number a model invented.

**The direction of the graph matters and is easy to state backwards.** We build the
`open_cell_graph` — every open cell with its legal neighbours — and send it TO the model.
The model returns routes as lists of cells. It is not asked about junctions at all; the
junction-level claims are derived afterwards.

Data goes to a Redis-compatible store over REST and is downloaded as CSV from
`/api/run-log?export=summaries`. A second deployment exists for participants who cannot
reach the first; ids from it carry a `cn-` prefix.

## Superseded iterations

### v1–v4: live hints on demand

A button labelled "Ask AI". Each press posted the maze, the player's position and facing
to the backend, which prompted an LLM for a full path to the exit, validated it, and
returned the first few steps.

**Why abandoned: latency.** A reasoning model takes seconds to minutes on a 21x21 maze,
and a participant standing still at a junction waiting for an assistant is not the
behaviour the study is trying to measure. Precomputing removes the wait entirely and, as
a side effect, removes per-participant API cost and run-to-run variation in the cue
itself — every participant in a condition now sees identical hints.

**Still in the tree:** `api/hint.js`, `POST /api/hint` in `server.js`, and roughly half of
`lib/hint-engine.js` (`requestValidatedPath`, `resolveSequential`, `buildLlmPayload`,
`validateLlmPath`, `parseLlmResponse`, `finalizePath`). In `public/game.js`:
`showHint`, `fetchHintData`, the prefetch machinery, and the thinking indicator.

The button is hidden, but **`showHint` is still bound to the `h` key**, so a keypress can
still trigger a live call mid-study.

### Herding mode (`AUTO_HERD`)

An earlier automatic-hint mode: show the assistant's suggestion on arrival rather than on
request. Superseded by the junction-cue system, which does the same thing from
precomputed data. The constant is now hard-coded `false`, so its branches cannot run.

### Mid-maze cutoff (`?cutoff=mid`)

The assistant stopped part-way through a single maze, once the exit was half as far. The
design moved to removing it **between** mazes instead — four with, four without — so the
loss is felt at a task boundary rather than mid-task. Kept as a manual testing flag; not
used by the study.

### BFS cue source (`?cues=bfs`)

Computes cues locally by breadth-first search instead of reading the AI-derived files.
A comparison and debugging tool: it shows what a perfect assistant would say. Not a study
condition, and must never be one — the study is about reliance on an *AI* assistant.

### Moderator AI toggle

The moderator could enable or disable the assistant mid-run from a second browser view.
Superseded when the condition became a property of the participant's link. The endpoint
has been removed; the `aiEnabled` flag it set survives in `server.js` and is now always
true.

### Live-AI cue mode and route-eval endpoints

Per-junction AI evaluation, asking the model to compare branches at each junction as the
participant arrived. Removed: it multiplied the latency problem by the number of
junctions, and the same claims can be derived from whole-maze routes for one call
instead of twenty-five.

### Venice provider

A third LLM provider alongside OpenAI and Gemini. Benchmarked, never used for the
deployed hint set.

## Documents that describe a system that no longer exists

`README.md` and `plan.md` both describe the v1 live-hint architecture. They are the
original design documents and are now actively misleading: read on their own, they
describe a system where every hint is a live LLM call.

## What to do with the abandoned code

Removing it is the honest option for a submitted artefact — git history preserves it, and
this file records what it was. The live-hint path is the large one; the flags are small
and mostly harmless, though the `h` key binding is a live risk rather than dead weight.
