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
import { MAZE8_1_MAZE_CONFIG } from "./mazes8/maze-1.js";
import { MAZE8_2_MAZE_CONFIG } from "./mazes8/maze-2.js";
import { MAZE8_3_MAZE_CONFIG } from "./mazes8/maze-3.js";
import { MAZE8_4_MAZE_CONFIG } from "./mazes8/maze-4.js";
import { MAZE8_5_MAZE_CONFIG } from "./mazes8/maze-5.js";
import { MAZE8_6_MAZE_CONFIG } from "./mazes8/maze-6.js";
import { MAZE8_7_MAZE_CONFIG } from "./mazes8/maze-7.js";
import { MAZE8_8_MAZE_CONFIG } from "./mazes8/maze-8.js";

// The four study mazes, addressable at /maze-a/participant ... /maze-d/participant.
// The matched set of eight is at /m8-1/participant ... /m8-8/participant. Their keys
// deliberately avoid the "maze-" prefix: the maze is chosen by substring match on the
// path, so an "m8" key cannot be swallowed by the existing "maze-1".
const STUDY_MAZES = {
  "maze-0": MAZE_0_MAZE_CONFIG,
  "maze-1": MAZE_1_MAZE_CONFIG,
  "maze-2": MAZE_2_MAZE_CONFIG,
  "maze-3": MAZE_3_MAZE_CONFIG,
  "maze-a": MAZE_A_MAZE_CONFIG,
  "maze-b": MAZE_B_MAZE_CONFIG,
  "maze-c": MAZE_C_MAZE_CONFIG,
  "maze-d": MAZE_D_MAZE_CONFIG,
  "m8-1": MAZE8_1_MAZE_CONFIG,
  "m8-2": MAZE8_2_MAZE_CONFIG,
  "m8-3": MAZE8_3_MAZE_CONFIG,
  "m8-4": MAZE8_4_MAZE_CONFIG,
  "m8-5": MAZE8_5_MAZE_CONFIG,
  "m8-6": MAZE8_6_MAZE_CONFIG,
  "m8-7": MAZE8_7_MAZE_CONFIG,
  "m8-8": MAZE8_8_MAZE_CONFIG,
};

// Pick the maze from the URL. The two study conditions:
//   /ai-maze/*     the SUPPLIED maze (imported from the 10x10 SVG) WITH AI hints
//   /no-ai-maze/*  the v6 braided maze, with NO AI at all from the start
// /disappear/* and /original/* are the earlier mazes; anything else is the
// default 8x8.
// ---- Study sequence -------------------------------------------------------
// /study/* plays the four mazes back to back on ONE url. Which maze is showing is
// held in storage rather than the address, so the participant never sees the
// sequence position and cannot skip ahead by editing the url. Advancing re-inits
// the page, which is what keeps each trial completely clean.
// Two stores, because one store cannot do both jobs:
//   sessionStorage  the PARTICIPANT's own position. Per-tab, so opening the url in a
//                   fresh tab always starts a new run at maze 1 — closing the tab is
//                   how a session ends. A reload of the same tab resumes, which is
//                   what advancing between mazes relies on.
//   localStorage    a read-only mirror for the MODERATOR tab, which is a separate
//                   browsing context and so cannot see the participant's
//                   sessionStorage at all. The participant writes it, never reads it.
// Putting progress itself in localStorage instead makes the moderator work but leaves
// every later tab resuming a finished run, which is worse.
export const STUDY_SEQUENCE = ["maze-0", "maze-1", "maze-2", "maze-3"];
const STUDY_PROGRESS_KEY = "llm_maze_study_progress";  // sessionStorage, participant
const STUDY_LIVE_KEY = "llm_maze_study_live";          // localStorage, moderator mirror
const studyPath = (globalThis.location && globalThis.location.pathname) || "";
const isStudy = studyPath.includes("study");
const isModeratorView = studyPath.includes("moderator");
// Stored progress is tagged with the sequence it belongs to. Change the sequence
// (add a maze, reorder) and any older progress is discarded rather than pointing at
// the wrong maze — otherwise a stale tab would silently start mid-study.
const SEQUENCE_SIGNATURE = STUDY_SEQUENCE.join(">");

function conditionFromUrl() {
  const v = (new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("condition") || "").toLowerCase();
  return ["no_ai", "stable_ai", "disappear"].includes(v) ? v : "stable_ai";
}

function parseProgress(raw) {
  try {
    const saved = JSON.parse(raw || "null");
    if (!saved || saved.sequence !== SEQUENCE_SIGNATURE) return null; // sequence changed
    const n = Number.parseInt(saved.index, 10);
    if (!Number.isFinite(n)) return null;
    return { condition: saved.condition, index: Math.min(Math.max(n, 0), STUDY_SEQUENCE.length - 1) };
  } catch (_error) {
    return null;
  }
}

function readOwnProgress() {
  try { return parseProgress(globalThis.sessionStorage.getItem(STUDY_PROGRESS_KEY)); } catch (_e) { return null; }
}

function readLiveProgress() {
  try { return parseProgress(globalThis.localStorage.getItem(STUDY_LIVE_KEY)); } catch (_e) { return null; }
}

// The participant records where it is in its own tab AND mirrors it for the moderator.
function writeProgress(condition, index) {
  const payload = JSON.stringify({ sequence: SEQUENCE_SIGNATURE, condition, index });
  try { globalThis.sessionStorage.setItem(STUDY_PROGRESS_KEY, payload); } catch (_e) { /* ignore */ }
  try { globalThis.localStorage.setItem(STUDY_LIVE_KEY, payload); } catch (_e) { /* ignore */ }
}

// ?restart clears progress, for re-running without hunting through devtools.
const wantsRestart = isStudy
  && new URLSearchParams((globalThis.location && globalThis.location.search) || "").has("restart");
if (wantsRestart) {
  resetStudyProgress();
  // Drop it from the address bar: advancing reloads the page, and a lingering
  // ?restart would reset progress every time and trap the run on maze 1.
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("restart");
    globalThis.history.replaceState({}, "", url);
  } catch (_e) { /* ignore */ }
}

// The participant reads only its own tab; the moderator reads only the mirror.
const savedProgress = !isStudy || wantsRestart ? null
  : isModeratorView ? readLiveProgress()
  : readOwnProgress();
// Progress is tagged with the CONDITION as well as the sequence. Switching condition
// is a different run, so it must start from the first maze — otherwise finishing one
// condition and changing the url resumes on the last maze of the previous run.
// The moderator is a spectator: it adopts whatever run the participant is on, so
// /study/moderator lands on the right maze and the right AI state even when it was
// opened without ?condition.
const CONDITION_VALUE = (isModeratorView && savedProgress && savedProgress.condition)
  ? savedProgress.condition
  : conditionFromUrl();

export const STUDY_INDEX = !isStudy ? -1
  : (savedProgress && savedProgress.condition === CONDITION_VALUE) ? savedProgress.index
  : 0;

// Publish on load as well as on advance, so a restart or a change of condition
// reaches an already-open moderator immediately.
if (isStudy && !isModeratorView) writeProgress(CONDITION_VALUE, STUDY_INDEX);

// Progress briefly lived in localStorage under the progress key, which left every
// new tab resuming a finished run. Nothing reads it now; drop it so it cannot be
// mistaken for live state when inspecting a participant's browser.
if (isStudy) {
  try { globalThis.localStorage.removeItem(STUDY_PROGRESS_KEY); } catch (_e) { /* ignore */ }
}

// The moderator learns about an advance through the storage event, which only fires
// in OTHER tabs. Re-init by reload, exactly as advancing does, so nothing carries
// over from the maze before.
if (isStudy && isModeratorView && globalThis.addEventListener) {
  globalThis.addEventListener("storage", (event) => {
    if (event.key !== STUDY_LIVE_KEY) return;
    const next = readLiveProgress();
    if (!next) return;
    if (next.index !== STUDY_INDEX || next.condition !== CONDITION_VALUE) globalThis.location.reload();
  });
}
export const STUDY_TOTAL = STUDY_SEQUENCE.length;
export const IS_STUDY = isStudy;
// In the disappear condition the assistant is present for the first two mazes and
// absent for the last two: the removal happens between tasks, not part-way through
// one. The first two establish the assistant so its loss is felt.
const DISAPPEAR_LAST_N = 2;
export const MAZE_AI_REMOVED = isStudy
  && CONDITION_VALUE === "disappear"
  && STUDY_INDEX >= STUDY_SEQUENCE.length - DISAPPEAR_LAST_N;

// The mid-maze cutoff (AI stops once the exit is half as far) is kept for testing
// the mechanism itself: ?cutoff=mid on a single maze. It is not used by the study.
export const MID_MAZE_CUTOFF = (new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("cutoff") || "") === "mid";

// Move to the next maze and re-init on the same url. Returns false at the end.
export function advanceStudyMaze() {
  if (!isStudy) return false;
  const next = STUDY_INDEX + 1;
  if (next >= STUDY_SEQUENCE.length) return false;
  writeProgress(CONDITION_VALUE, next);
  globalThis.location.reload();
  return true;
}

export function resetStudyProgress() {
  try { globalThis.sessionStorage.removeItem(STUDY_PROGRESS_KEY); } catch (_error) { /* ignore */ }
  try { globalThis.localStorage.removeItem(STUDY_LIVE_KEY); } catch (_error) { /* ignore */ }
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
// The matched eight are addressed as m8-N but their files are named maze-N inside
// public/mazes8/, so the url is mapped rather than pasted from the key.
const m8 = studyId ? studyId.match(/^m8-(\d+)$/) : null;
export const HINTS_URL = m8 ? `/mazes8/hints/maze-${m8[1]}.json`
  : studyId ? `/mazes/hints/${studyId}.json`
  : `/data/junction-cues.${mazeKey}.json`;

// Verified whole-maze routes the AI found, drawn on the moderator view. Study
// mazes only — the older mazes have none.
export const SOLUTIONS_URL = m8 ? `/mazes8/solutions/maze-${m8[1]}.json`
  : studyId ? `/mazes/solutions/${studyId}.json`
  : null;

// ---- Study condition -------------------------------------------------------
//   no_ai      no AI at all
//   stable_ai  AI throughout
//   disappear  AI throughout, then it stops about halfway
// Set with ?condition=... ; defaults to stable_ai so an unqualified link still
// shows the assistant.
export const CONDITION = CONDITION_VALUE;

export const DIRS = [
  { dx: 0, dy: -1, name: "North", short: "N", angle: -Math.PI / 2 },
  { dx: 1, dy: 0, name: "East", short: "E", angle: 0 },
  { dx: 0, dy: 1, name: "South", short: "S", angle: Math.PI / 2 },
  { dx: -1, dy: 0, name: "West", short: "W", angle: Math.PI },
];
