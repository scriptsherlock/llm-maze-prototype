import { MAZE8_1_MAZE_CONFIG } from "./mazes8/maze-1.js";
import { MAZE8_2_MAZE_CONFIG } from "./mazes8/maze-2.js";
import { MAZE8_3_MAZE_CONFIG } from "./mazes8/maze-3.js";
import { MAZE8_4_MAZE_CONFIG } from "./mazes8/maze-4.js";
import { MAZE8_5_MAZE_CONFIG } from "./mazes8/maze-5.js";
import { MAZE8_6_MAZE_CONFIG } from "./mazes8/maze-6.js";
import { MAZE8_7_MAZE_CONFIG } from "./mazes8/maze-7.js";
import { MAZE8_8_MAZE_CONFIG } from "./mazes8/maze-8.js";

// The eight matched mazes, addressable at /m8-1/participant ... /m8-8/participant.
// They are the whole set now: every earlier maze has been removed.
const STUDY_MAZES = {
  "m8-1": MAZE8_1_MAZE_CONFIG,
  "m8-2": MAZE8_2_MAZE_CONFIG,
  "m8-3": MAZE8_3_MAZE_CONFIG,
  "m8-4": MAZE8_4_MAZE_CONFIG,
  "m8-5": MAZE8_5_MAZE_CONFIG,
  "m8-6": MAZE8_6_MAZE_CONFIG,
  "m8-7": MAZE8_7_MAZE_CONFIG,
  "m8-8": MAZE8_8_MAZE_CONFIG,
};

// ---- Study sequence -------------------------------------------------------
// /study/* plays all eight mazes back to back on ONE url. Which maze is showing is
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
export const STUDY_SEQUENCE = ["m8-1", "m8-2", "m8-3", "m8-4", "m8-5", "m8-6", "m8-7", "m8-8"];
const STUDY_PROGRESS_KEY = "llm_maze_study_progress";  // sessionStorage, participant
const STUDY_LIVE_KEY = "llm_maze_study_live";          // localStorage, moderator mirror
const TRAINING_KEY = "llm_maze_training_done";         // sessionStorage, per run
const PARTICIPANT_KEY = "llm_maze_participant";         // sessionStorage, per run
const START_SURVEY_KEY = "llm_maze_start_survey";       // sessionStorage, per run

// One id per run, so the eight mazes can be stitched back into a single record.
// ?pid=... lets a moderator set it from a recruitment link; otherwise one is minted.
// Per tab, like the run position: a fresh tab is a fresh participant.
export const PARTICIPANT_ID = (() => {
  const fromUrl = new URLSearchParams((globalThis.location && globalThis.location.search) || "").get("pid");
  try {
    if (fromUrl) { globalThis.sessionStorage.setItem(PARTICIPANT_KEY, fromUrl); return fromUrl; }
    const existing = globalThis.sessionStorage.getItem(PARTICIPANT_KEY);
    if (existing) return existing;
    const minted = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    globalThis.sessionStorage.setItem(PARTICIPANT_KEY, minted);
    return minted;
  } catch (_e) {
    return fromUrl || "p_unknown";
  }
})();

// ---- Questionnaires ----------------------------------------------------------
// Three points in a run:
//   "start"  before maze 1, once the practice is done
//   3        after the FOURTH maze  (numeric keys are zero-based maze positions)
//   7        after the eighth, so the end of the run
//
// Note "start" is not 0: key 0 would mean AFTER the first maze, which is a different
// place. Participant id and condition are appended to every url, plus the maze number
// for the numeric steps, so a response can be matched to the run it came from.
//
// An EMPTY url still shows the step and still logs it, but offers only Continue --
// which is how to run before a form exists, without posting into a response set.
const SURVEY_STEPS = {
  start: "",
  3: "",
  7: "",
};

// Each condition gets its own forms. Anything left empty falls back to SURVEY_STEPS
// above, and an empty string there means the step appears with no link.
const SURVEY_STEPS_BY_CONDITION = {
  no_ai: {
    start: "",
    3: "",
    7: "",
  },
  stable_ai: {
    start: "",
    3: "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_a9lhU8KOfXIBJVI",
    7: "",
  },
  disappear: {
    start: "",
    3: "",
    7: "",
  },
};

// Numeric steps only: "start" is handled before the run rather than on a task-complete
// screen, so it is not part of this list.
export const SURVEY_AFTER_INDEX = [...new Set([
  ...Object.keys(SURVEY_STEPS),
  ...Object.values(SURVEY_STEPS_BY_CONDITION).flatMap((m) => Object.keys(m)),
].filter((k) => k !== "start").map(Number))].sort((a, b) => a - b);

// Read at call time, not at module load: CONDITION_VALUE is settled further down.
export const surveyUrlFor = (key) => {
  const perCondition = SURVEY_STEPS_BY_CONDITION[CONDITION_VALUE] || {};
  return (key in perCondition ? perCondition[key] : SURVEY_STEPS[key]) || "";
};

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
// In the disappear condition the assistant is present for the first half of the run
// and absent for the second: the removal happens between tasks, not part-way through
// one. The first half establishes the assistant so its loss is felt.
// This was 2-of-4. With eight mazes it is 4-of-4, which keeps the same half-and-half
// split rather than silently shifting the design to 6 with and 2 without.
const DISAPPEAR_LAST_N = 4;
export const MAZE_AI_REMOVED = isStudy
  && CONDITION_VALUE === "disappear"
  && STUDY_INDEX >= STUDY_SEQUENCE.length - DISAPPEAR_LAST_N;

// The mid-maze cutoff (AI stops once the exit is half as far) is kept for testing
// the mechanism itself: ?cutoff=mid on a single maze. It is not used by the study.
export const MID_MAZE_CUTOFF = (new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("cutoff") || "") === "mid";

// ---- Training ---------------------------------------------------------------
// A controls-only practice run before maze 1: turn, walk, and step back, with no
// assistant and no exit to find. Held per tab like the run position, so a fresh tab
// gets the practice again and a reload inside a run does not repeat it.
// Tagged with the condition, like the run position is. Opening the no_ai link after
// practising the stable_ai one is a different run and should practise again --
// without the tag the flag carried over and the second condition skipped straight
// into maze 1.
export const IS_TRAINING = isStudy && !isModeratorView && (() => {
  if (wantsRestart) return true;
  try { return globalThis.sessionStorage.getItem(TRAINING_KEY) !== CONDITION_VALUE; } catch (_e) { return true; }
})();

export function completeTraining() {
  try { globalThis.sessionStorage.setItem(TRAINING_KEY, CONDITION_VALUE); } catch (_e) { /* ignore */ }
  globalThis.location.reload();
}

// The start questionnaire sits between the practice run and maze 1, so a participant
// answers it having seen the controls but not yet any maze. Tagged with the condition
// like the practice flag, so switching condition asks again.
export const NEEDS_START_SURVEY = isStudy && !isModeratorView && !IS_TRAINING
  && STUDY_INDEX === 0 && (() => {
    if (wantsRestart) return true;
    try { return globalThis.sessionStorage.getItem(START_SURVEY_KEY) !== CONDITION_VALUE; } catch (_e) { return true; }
  })();

export function completeStartSurvey() {
  try { globalThis.sessionStorage.setItem(START_SURVEY_KEY, CONDITION_VALUE); } catch (_e) { /* ignore */ }
}

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
  try { globalThis.sessionStorage.removeItem(TRAINING_KEY); } catch (_error) { /* ignore */ }
  try { globalThis.sessionStorage.removeItem(START_SURVEY_KEY); } catch (_error) { /* ignore */ }
  try { globalThis.localStorage.removeItem(STUDY_LIVE_KEY); } catch (_error) { /* ignore */ }
}

const path = (globalThis.location && globalThis.location.pathname) || "";
const studyId = isStudy
  ? STUDY_SEQUENCE[STUDY_INDEX]
  : (Object.keys(STUDY_MAZES).find((id) => path.includes(id)) || null);
// Every maze is one of the eight now, so an unrecognised path falls back to the
// first rather than to a differently-shaped legacy maze.
const mazeKey = studyId || STUDY_SEQUENCE[0];

export const MAZE_CONFIG = STUDY_MAZES[mazeKey];

export const MAZE_KEY = mazeKey;

// Where the precomputed cues live. The mazes are addressed as m8-N but their files
// are named maze-N inside public/mazes8/, so the url is mapped, not pasted.
const m8 = mazeKey.match(/^m8-(\d+)$/);
export const HINTS_URL = m8 ? `/mazes8/hints/maze-${m8[1]}.json` : null;

// Verified whole-maze routes the AI found, drawn on the moderator view.
export const SOLUTIONS_URL = m8 ? `/mazes8/solutions/maze-${m8[1]}.json` : null;

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
