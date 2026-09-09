# When AI Disappears: Human performance and behaviour in a disrupted workflow

MSc Individual Project, Department of Computing, Imperial College London.

This repository holds the task participants played, the instrumentation that recorded them, and the
analysis that produced the results.

The study set out to inquire whether losing AI support is not the same as never having had it at
all. Real participants played a game in which they had to find their way through a maze. Some were
given hints towards the goal and then had those hints taken away midway through. 

<!-- Once the support
was gone they became slower, took more moves than they needed, revisited more cells, got lost more
often and spent longer at junctions working out where to go next. Participants who had never been
given hints at all did better on every one of those measures. 150 participants completed 1,151
mazes between them. -->


## The task

A participant walks through a hedge maze in a modified first person view, using the keyboard or the
on-screen controls. Each participant worked through eight mazes in a single sitting, with questionnaires
before the first, after the fourth and after the eighth, and a practice run beforehand to learn the
controls. Where an assistant was present it marked, at each junction, the branches that lead to the
exit, shading the shorter route more darkly and naming the direction and the relative distance.

Every maze has exactly 25 junctions and a shortest route of exactly 53 moves, so difficulty is held
constant across the eight. The grids, the cues and the verified routes are committed under
`public/mazes8`.

## The three conditions

| Condition | Mazes 1 to 4 | Mazes 5 to 8 |
| --- | --- | --- |
| `no_ai` | unaided | unaided |
| `stable_ai` | assistant present | assistant present |
| `disappear` | assistant present | assistant removed without warning |

The withdrawal falls at the boundary between two mazes rather than partway through one, so that it
reads as a change in the conditions of the study rather than as something breaking mid attempt.
`DISAPPEAR_LAST_N` in `public/maze.js` fixes the split at four and four.

## Layout

```
public/          the task as served to a participant
  index.html       the study page, and a single maze under /m8-N
  game.js          the scene, the movement, the cue rendering, the event log
  maze.js          the study sequence, the conditions, the survey links, the identifier
  mazes8/          the eight mazes, their hints and their verified routes
  vendor/three/    three.js, shipped rather than fetched from a CDN
api/             one file per endpoint, mounted by server.js and deployed as functions
lib/store.js     the handful of Redis commands the study uses, over REST or a local file
server.js        the Express app
analysis.R       every model, table and figure in the analysis chapter
```


## Where the cues come from

A model was asked offline for
several complete routes through each maze, every route was re-walked against the grid and discarded
unless every step was legal, routes from independent passes were merged, and the per junction
claims were then computed from the survivors by arithmetic.

The prompts and the generation settings are in the report. Their output is
`public/mazes8/hints/maze-N.json`.

## Identifiers and allocation

Identifiers come from the server. `GET /api/assign?condition=no_ai` fixes
the condition by the link a participant was sent, which is how the study ran. Without the parameter
the server allocates one itself, dealing conditions in randomly permuted blocks of three.
Allocation is recorded before the participant does anything, which is what makes dropout visible.
`SITE_CODE` prefixes a site code so that two deployments cannot both issue `no_ai-001`.

## What is recorded

Every meaningful action produces an event, and the completion of each maze produces a summary row. A summary carries the
identifier and condition, whether the assistant was present for that maze, completion time, moves
against the shortest possible, revisited cells, Back presses, junctions passed and cued, cues
followed, and the median deliberation time at a junction.

## Getting the data

| Request | What it returns |
| --- | --- |
| `GET /api/run-log?health=1` | whether a store is attached and reachable |
| `GET /api/run-log?id=no_ai-001` | one run, its summaries and its events |
| `GET /api/run-log?export=summaries` | one CSV row per completed maze |
| `GET /api/run-log?export=events` | one CSV row per event |
| `DELETE /api/run-log?id=no_ai-001` | removes one participant |



## Running it

Prerequisites: Node 18 or newer.

```
npm install
npm start
```

The study runs at `http://localhost:3000` and the bare address redirects to `/study/participant`. Position in the sequence is held in `sessionStorage`
rather than in the address, so a participant cannot skip ahead and a fresh tab always starts a new
run.

`npm run check` parses the server without starting it.

## Configuration

Copy `.env.example` to `.env`. None of it is needed to play a maze.

| Variable | What it does |
| --- | --- |
| `PORT` | where the server listens, default = `3000` |
| `SITE_CODE` | a site code carried in every identifier this deployment issues |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | the hosted key value store |
| `STORE_FILE` | where the file backend writes instead |
| `LLM_PROVIDER` and a provider key | for regenerating guidance|

The store picks its backend by whether the two key value variables are set. The file backend exists
for a host that has to keep its data on its own disk, and reports itself unusable on a serverless
platform rather than accepting writes it cannot keep.

## The analysis

`analysis.R` fits every model reported in the analysis chapter and writes the figures under
`report/figures`. It needs `tidyverse`, `glmmTMB`, `DHARMa`, `emmeans` and `patchwork`, and it
reads the exports from `error_logs/kv-export`, which are participant data and are not committed.
Run it from the project root.

## Deployment

`vercel.json` and `.github/workflows` describe the two targets. The study opened on
Vercel and finished on Azure App Service, because addresses under `vercel.app` are not reachable
from some countries and participants recruited there could not open the study at all. The key value
store is called from the server rather than the browser, so the move did not require the data to
move with it.

<!-- ## What is not here

The maze generator, the route generation scripts and the audit that checked every claim against a
breadth first search were offline tooling and were removed once the study was complete. Their
outputs are committed under `public/mazes8`, and the history records the successive designs the
report refers to, including those that were abandoned. -->

<!-- ## One known fault

`GET /api/server-logs` returns 500 under `server.js`, because it calls a helper that no longer
exists. It affects the moderator's log panel only, and on the hosted deployments the endpoint is a
stub returning an empty list, so it was never visible to a participant and never touched the data. -->
