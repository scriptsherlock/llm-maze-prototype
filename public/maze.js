import { FIXED_8X8_MAZE_CONFIG } from "./fixed_8x8_maze.js";
import { ORIGINAL_15X15_MAZE_CONFIG } from "./original_15x15_maze.js";
import { DISAPPEAR_MAZE_CONFIG } from "./disappear_maze.js";
import { SUPPLIED_MAZE_CONFIG } from "./supplied_maze.js";
import { V6_MAZE_CONFIG } from "./v6_maze.js";
import { MAZE_0_MAZE_CONFIG } from "./mazes/maze-0.js";
import { MAZE_1_MAZE_CONFIG } from "./mazes/maze-1.js";
import { MAZE_2_MAZE_CONFIG } from "./mazes/maze-2.js";
import { MAZE_3_MAZE_CONFIG } from "./mazes/maze-3.js";
import { MAZE_A_MAZE_CONFIG } from "./mazes/maze-a.js";
import { MAZE_B_MAZE_CONFIG } from "./mazes/maze-b.js";
import { MAZE_C_MAZE_CONFIG } from "./mazes/maze-c.js";
import { MAZE_D_MAZE_CONFIG } from "./mazes/maze-d.js";

// The four study mazes, addressable at /maze-a/participant ... /maze-d/participant.
const STUDY_MAZES = {
  "maze-0": MAZE_0_MAZE_CONFIG,
  "maze-1": MAZE_1_MAZE_CONFIG,
  "maze-2": MAZE_2_MAZE_CONFIG,
  "maze-3": MAZE_3_MAZE_CONFIG,
  "maze-a": MAZE_A_MAZE_CONFIG,
  "maze-b": MAZE_B_MAZE_CONFIG,
  "maze-c": MAZE_C_MAZE_CONFIG,
  "maze-d": MAZE_D_MAZE_CONFIG,
};

// Pick the maze from the URL. The two study conditions:
//   /ai-maze/*     the SUPPLIED maze (imported from the 10x10 SVG) WITH AI hints
//   /no-ai-maze/*  the v6 braided maze, with NO AI at all from the start
// /disappear/* and /original/* are the earlier mazes; anything else is the
// default 8x8.
// ---- Study sequence -------------------------------------------------------
// /study/* plays the four mazes back to back on ONE url. Which maze is showing is
// held in sessionStorage rather than the address, so the participant never sees the
// sequence position and cannot skip ahead by editing the url. Advancing re-inits
// the page, which is what keeps each trial completely clean.
export const STUDY_SEQUENCE = ["maze-0", "maze-1", "maze-2", "maze-3"];
const STUDY_PROGRESS_KEY = "llm_maze_study_progress";
const isStudy = ((globalThis.location && globalThis.location.pathname) || "").includes("study");
// Stored progress is tagged with the sequence it belongs to. Change the sequence
// (add a maze, reorder) and any older progress is discarded rather than pointing at
// the wrong maze — otherwise a stale tab would silently start mid-study.
function conditionFromUrl() {
  const v = (new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("condition") || "").toLowerCase();
  return ["no_ai", "stable_ai", "disappear"].includes(v) ? v : "stable_ai";
}
// Progress is tagged with the CONDITION as well as the sequence. Switching condition
// is a different run, so it must start from the first maze — otherwise finishing one
// condition and changing the url resumes on the last maze of the previous run.
const SEQUENCE_SIGNATURE = `${STUDY_SEQUENCE.join(">")}|${conditionFromUrl()}`;

function readStudyIndex() {
  try {
    if (!globalThis.sessionStorage) return 0;
    // ?restart clears progress, for re-running without hunting through devtools.
    const search = (globalThis.location && globalThis.location.search) || "";
    if (new URLSearchParams(search).has("restart")) {
      globalThis.sessionStorage.removeItem(STUDY_PROGRESS_KEY);
      // Drop it from the address bar: advancing reloads the page, and a lingering
      // ?restart would reset progress every time and trap the run on maze 1.
      try {
        const url = new URL(globalThis.location.href);
        url.searchParams.delete("restart");
        globalThis.history.replaceState({}, "", url);
      } catch (_e) { /* ignore */ }
      return 0;
    }
    const raw = globalThis.sessionStorage.getItem(STUDY_PROGRESS_KEY);
    if (!raw) return 0;
    const saved = JSON.parse(raw);
    if (!saved || saved.sequence !== SEQUENCE_SIGNATURE) {
      globalThis.sessionStorage.removeItem(STUDY_PROGRESS_KEY); // sequence changed
      return 0;
    }
    const n = Number.parseInt(saved.index, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), STUDY_SEQUENCE.length - 1) : 0;
  } catch (_error) {
    return 0;
  }
}

export const STUDY_INDEX = isStudy ? readStudyIndex() : -1;
export const STUDY_TOTAL = STUDY_SEQUENCE.length;
export const IS_STUDY = isStudy;
// Disappearance applies to the last two mazes of a study run; the earlier ones act
// as stable AI so the assistant is established before it is taken away. A single
// maze opened directly always uses it, which is what makes it testable.
const DISAPPEAR_LAST_N = 2;
export const MAZE_HAS_CUTOFF = !isStudy || STUDY_INDEX >= STUDY_SEQUENCE.length - DISAPPEAR_LAST_N;

// Move to the next maze and re-init on the same url. Returns false at the end.
export function advanceStudyMaze() {
  if (!isStudy) return false;
  const next = STUDY_INDEX + 1;
  if (next >= STUDY_SEQUENCE.length) return false;
  try {
    globalThis.sessionStorage.setItem(STUDY_PROGRESS_KEY, JSON.stringify({ sequence: SEQUENCE_SIGNATURE, index: next }));
  } catch (_error) { /* ignore */ }
  globalThis.location.reload();
  return true;
}

export function resetStudyProgress() {
  try { globalThis.sessionStorage.removeItem(STUDY_PROGRESS_KEY); } catch (_error) { /* ignore */ }
}

const path = (globalThis.location && globalThis.location.pathname) || "";
const studyId = isStudy
  ? STUDY_SEQUENCE[STUDY_INDEX]
  : (Object.keys(STUDY_MAZES).find((id) => path.includes(id)) || null);
const mazeKey = studyId
  || (path.includes("no-ai-maze") ? "no_ai"
  : path.includes("ai-maze") ? "ai"
  : path.includes("disappear") ? "disappear"
  : path.includes("original") ? "original"
  : "default");

export const MAZE_CONFIG = studyId ? STUDY_MAZES[studyId]
  : mazeKey === "no_ai" ? V6_MAZE_CONFIG
  : mazeKey === "ai" ? SUPPLIED_MAZE_CONFIG
  : mazeKey === "disappear" ? DISAPPEAR_MAZE_CONFIG
  : mazeKey === "original" ? ORIGINAL_15X15_MAZE_CONFIG
  : FIXED_8X8_MAZE_CONFIG;

export const MAZE_KEY = mazeKey;

// Where the precomputed cues live. The study mazes keep theirs alongside the maze
// module (public/mazes/hints/), the older ones use the original data folder.
export const HINTS_URL = studyId
  ? `/mazes/hints/${studyId}.json`
  : `/data/junction-cues.${mazeKey}.json`;

// Verified whole-maze routes the AI found, drawn on the moderator view. Study
// mazes only — the older mazes have none.
export const SOLUTIONS_URL = studyId ? `/mazes/solutions/${studyId}.json` : null;

// ---- Study condition -------------------------------------------------------
//   no_ai      no AI at all
//   stable_ai  AI throughout
//   disappear  AI throughout, then it stops about halfway
// Set with ?condition=... ; defaults to stable_ai so an unqualified link still
// shows the assistant.
export const CONDITION = conditionFromUrl();

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
