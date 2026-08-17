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
const TRAINING_KEY = "llm_maze_training_done";         // per tab, mirrored per participant
const PARTICIPANT_KEY = "llm_maze_participant";         // sessionStorage, per run
const INTRO_KEY = "llm_maze_intro_done";                 // per tab, mirrored per participant

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

// ============================================================================
// QUESTIONNAIRE LINKS  --  paste them in below
// ============================================================================
// Three points in every run:
//
//   start   before maze 1, straight after the practice run
//   mid     after maze 4
//   end     after maze 8, the last screen of the run
//
// Leave a slot as "" and that step still appears and is still logged, but shows only
// a Continue button and links nowhere. That is the safe state: a run can be piloted
// without posting anything into a real response set.
//
// Appended to every link automatically:  ?participant=...&condition=...
// and for mid and end also              &maze=4  /  &maze=8
// For those to survive, add Embedded Data fields named participant, condition and
// maze in the Qualtrics survey flow -- otherwise the values arrive and are dropped.
const SURVEY_LINKS = {
  no_ai: {
    start: "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_a9lhU8KOfXIBJVI",
    mid:   "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_5jB6PWhZC99Xck6",
    end:   "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_cx3eFPRiS1SByPI",
  },
  stable_ai: {
    start: "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_a9lhU8KOfXIBJVI",
    mid:   "",
    end:   "",
  },
  disappear: {
    start: "https://qualtricsxmqjx593lmk.qualtrics.com/jfe/form/SV_a9lhU8KOfXIBJVI",
    mid:   "https://qualtricsxm7pgp8wk2l.qualtrics.com/jfe/form/SV_3miV3rr12vrCT8W",
    end:   "https://qualtricsxm7pgp8wk2l.qualtrics.com/jfe/form/SV_bIBkIfzfRqtosaW",
  },
};

// Which maze each of the numbered points follows, zero-based: 3 is the FOURTH maze.
// "start" is not in here because it comes before any maze rather than after one.
const SURVEY_POINTS = { mid: 3, end: 7 };

// ---- plumbing ---------------------------------------------------------------
export const SURVEY_AFTER_INDEX = Object.values(SURVEY_POINTS).sort((a, b) => a - b);

// Takes "start", or the zero-based index of the maze just finished.
// CONDITION_VALUE is read at call time because it is settled further down the file.
export const surveyUrlFor = (key) => {
  const links = SURVEY_LINKS[CONDITION_VALUE] || {};
  if (key === "start") return links.start || "";
  const point = Object.keys(SURVEY_POINTS).find((name) => SURVEY_POINTS[name] === key);
  return point ? links[point] || "" : "";
};

const studyPath = (globalThis.location && globalThis.location.pathname) || "";
const isStudy = studyPath.includes("study");
const isModeratorView = studyPath.includes("moderator");
// Stored progress is tagged with the sequence it belongs to. Change the sequence
// (add a maze, reorder) and any older progress is discarded rather than pointing at
// the wrong maze — otherwise a stale tab would silently start mid-study.
const SEQUENCE_SIGNATURE = STUDY_SEQUENCE.join(">");

const CONDITIONS = ["no_ai", "stable_ai", "disappear"];

// A mistyped or missing condition used to fall through to stable_ai. That is the
// worst possible default: it is silent, it is a real condition, and it is the one
// whose mid and end questionnaires are deliberately blank -- so "?condition=isappear"
// ran a full eight-maze session that looked normal, never removed the assistant, and
// filed itself under stable_ai. A participant cannot notice, and neither can the
// export. There is no safe guess here, so an unusable link stops the run instead.
function readConditionParam() {
  const raw = (new URLSearchParams(globalThis.location ? globalThis.location.search : "").get("condition") || "").trim().toLowerCase();
  return { raw, valid: CONDITIONS.includes(raw) };
}

// Refuse to run rather than run the wrong study. The moderator view is exempt: it is
// a spectator and adopts whatever condition the participant is actually on.
function haltOnBadCondition({ raw }) {
  const doc = globalThis.document;
  if (!doc) return;
  const said = raw ? `The link says <code>condition=${raw}</code>, which is not one of them.`
    : "The link has no <code>condition</code> on the end of it.";
  doc.body.innerHTML = `
    <div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.5rem;color:#101828">
      <h1 style="font-size:1.35rem;margin:0 0 .75rem">This link is not usable</h1>
      <p style="margin:0 0 1rem">${said} A run must say which of the three it is:
        <code>no_ai</code>, <code>stable_ai</code> or <code>disappear</code>.</p>
      <p style="margin:0;color:#475467">Nothing has been recorded. Please go back to the
        invitation and open the link exactly as it was sent.</p>
    </div>`;
  throw new Error(`unusable study link: condition=${JSON.stringify(raw)}`);
}

// One link for everyone: with no condition on the URL, ask the server for an id and a
// condition and come back with them in the address bar. From that point on the run is
// an ordinary explicit link, so reloads, the survey hand-off and the moderator mirror
// all keep working unchanged.
const ASSIGNED_KEY = "llm_maze_assigned";   // localStorage, survives a new tab

// Reuse the assignment this browser already has. Without it, reopening the invitation
// mints a second participant and splits one person's data across two ids -- the same
// problem Qualtrics solves with its "prevent multiple responses" cookie. ?new=1 forces
// a fresh one, which is what piloting needs.
function rememberedAssignment() {
  try {
    if (new URLSearchParams(globalThis.location.search).get("new")) return null;
    const saved = JSON.parse(globalThis.localStorage.getItem(ASSIGNED_KEY) || "null");
    return saved && CONDITIONS.includes(saved.condition) && saved.participant_id ? saved : null;
  } catch (_e) { return null; }
}

function showAssigningScreen() {
  const doc = globalThis.document;
  if (doc) doc.body.innerHTML = `
    <div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.5rem;color:#101828">
      <h1 style="font-size:1.35rem;margin:0 0 .75rem">Setting up your session…</h1>
      <p style="margin:0;color:#475467">This takes a moment. Please do not close the tab.</p>
    </div>`;
}

async function assignAndRedirect() {
  showAssigningScreen();
  let assigned = rememberedAssignment();
  if (!assigned) {
    try {
      const response = await fetch("/api/assign", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      assigned = await response.json();
      if (!CONDITIONS.includes(assigned.condition)) throw new Error("bad condition from server");
      try { globalThis.localStorage.setItem(ASSIGNED_KEY, JSON.stringify(assigned)); } catch (_e) { /* private mode */ }
    } catch (error) {
      haltOnAssignFailure(error);
      return new Promise(() => {});
    }
  }
  const url = new URL(globalThis.location.href);
  url.searchParams.set("pid", assigned.participant_id);
  url.searchParams.set("condition", assigned.condition);
  url.searchParams.delete("new");
  globalThis.location.replace(url.toString());
  // replace() does not stop this script, and the rest of the module would run against
  // the un-assigned URL. Never resolving parks it until the navigation lands.
  return new Promise(() => {});
}

function haltOnAssignFailure(error) {
  const doc = globalThis.document;
  if (!doc) return;
  doc.body.innerHTML = `
    <div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.5rem;color:#101828">
      <h1 style="font-size:1.35rem;margin:0 0 .75rem">We could not start your session</h1>
      <p style="margin:0 0 1rem">Something went wrong setting up. Nothing has been recorded.</p>
      <p style="margin:0;color:#475467">Please refresh the page. If it happens again, let the
        researcher know.</p>
    </div>`;
  console.error("assignment failed:", error);
}

function parseProgress(raw) {
  try {
    const saved = JSON.parse(raw || "null");
    if (!saved || saved.sequence !== SEQUENCE_SIGNATURE) return null; // sequence changed
    const n = Number.parseInt(saved.index, 10);
    if (!Number.isFinite(n)) return null;
    return {
      condition: saved.condition,
      index: Math.min(Math.max(n, 0), STUDY_SEQUENCE.length - 1),
      participant: saved.participant || "",
      done: Boolean(saved.done),
    };
  } catch (_error) {
    return null;
  }
}

// Progress lives in sessionStorage, which dies with the tab. That was right when a tab
// WAS the session; now that the id survives in localStorage, a reopened invitation came
// back as the same participant on maze 1 and appended a second set of eight summaries
// to one record. So fall back to the mirror when it belongs to this same participant:
// the tab is gone, the person is not.
function readOwnProgress() {
  try {
    const own = parseProgress(globalThis.sessionStorage.getItem(STUDY_PROGRESS_KEY));
    if (own) return own;
    const mirrored = parseProgress(globalThis.localStorage.getItem(STUDY_LIVE_KEY));
    return mirrored && mirrored.participant === PARTICIPANT_ID ? mirrored : null;
  } catch (_e) { return null; }
}

// The introduction and the practice maze are remembered per tab too, and they have the
// same problem progress had: a reopened invitation is a new tab but the same person, so
// without a mirror a resumed run replays both before reaching the maze it stopped on.
// Mirrored under the participant, so a different person on this browser is unaffected.
function readRunFlag(key) {
  try {
    const own = globalThis.sessionStorage.getItem(key);
    if (own !== null) return own;
    const mirrored = JSON.parse(globalThis.localStorage.getItem(`${key}_mirror`) || "null");
    return mirrored && mirrored.participant === PARTICIPANT_ID ? mirrored.value : null;
  } catch (_e) { return null; }
}

function writeRunFlag(key, value) {
  try { globalThis.sessionStorage.setItem(key, value); } catch (_e) { /* ignore */ }
  try {
    globalThis.localStorage.setItem(`${key}_mirror`, JSON.stringify({ participant: PARTICIPANT_ID, value }));
  } catch (_e) { /* ignore */ }
}

function readLiveProgress() {
  try { return parseProgress(globalThis.localStorage.getItem(STUDY_LIVE_KEY)); } catch (_e) { return null; }
}

// The participant records where it is in its own tab AND mirrors it for the moderator.
function writeProgress(condition, index, done = false) {
  // participant goes in so the mirror can be told apart from someone else's run on the
  // same browser -- without it, resuming from the mirror would adopt a stranger's place.
  const payload = JSON.stringify({ sequence: SEQUENCE_SIGNATURE, condition, index, done, participant: PARTICIPANT_ID });
  try { globalThis.sessionStorage.setItem(STUDY_PROGRESS_KEY, payload); } catch (_e) { /* ignore */ }
  try { globalThis.localStorage.setItem(STUDY_LIVE_KEY, payload); } catch (_e) { /* ignore */ }
}

// The end of maze 8. advanceStudyMaze never records this -- it returns false without
// writing once there is no next maze -- so without an explicit mark a finished run is
// indistinguishable from one that has not started.
export function markRunComplete() {
  if (!isStudy) return;
  writeProgress(CONDITION_VALUE, STUDY_SEQUENCE.length - 1, true);
}

function haltOnAlreadyDone() {
  const doc = globalThis.document;
  if (!doc) return;
  doc.body.innerHTML = `
    <div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.5rem;color:#101828">
      <h1 style="font-size:1.35rem;margin:0 0 .75rem">You have already completed this study</h1>
      <p style="margin:0 0 1rem">Your answers are saved. There is nothing more to do, and
        there is no need to go through the mazes again.</p>
      <p style="margin:0;color:#475467">Thank you for taking part.</p>
    </div>`;
  throw new Error("run already completed");
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
const conditionParam = readConditionParam();
// Checked before anything is stored or logged, so a bad link leaves no trace.
//
// No condition at all means the plain invitation link: assign one and come back. A
// condition that is present but misspelled is a DIFFERENT case and still refuses --
// "?condition=isappear" is a broken link someone built, not an anonymous arrival, and
// silently assigning would hide the mistake behind a run that looks normal.
if (isStudy && !isModeratorView && !conditionParam.valid) {
  if (conditionParam.raw === "") await assignAndRedirect();
  else haltOnBadCondition(conditionParam);
}

const CONDITION_VALUE = (isModeratorView && savedProgress && savedProgress.condition)
  ? savedProgress.condition
  : (conditionParam.valid ? conditionParam.raw : "stable_ai");

// A finished run must not start again: the rows would append to the same record and the
// export would show sixteen maze summaries for one person. ?restart still overrides,
// which is what piloting needs.
if (isStudy && !isModeratorView && !wantsRestart
  && savedProgress && savedProgress.done && savedProgress.condition === CONDITION_VALUE) {
  haltOnAlreadyDone();
}

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
// The run opens with an introduction, before the practice and before any maze:
//
//   1. the start questionnaire
//   2. a page saying what is about to happen
//
// It runs on its own screen with the maze hidden, so nothing about maze 1 is visible
// while a participant is still answering questions about what they expect. Tagged with
// the condition like the other per-run flags, so switching condition shows it again.
export const NEEDS_INTRO = isStudy && !isModeratorView && (() => {
  if (wantsRestart) return true;
  return readRunFlag(INTRO_KEY) !== CONDITION_VALUE;
})();

export function completeIntro() {
  writeRunFlag(INTRO_KEY, CONDITION_VALUE);
  globalThis.location.reload();
}

// A controls-only practice run before maze 1: turn, walk, and step back, with no
// assistant and no exit to find. Held per tab like the run position, so a fresh tab
// gets the practice again and a reload inside a run does not repeat it.
// Tagged with the condition, like the run position is. Opening the no_ai link after
// practising the stable_ai one is a different run and should practise again --
// without the tag the flag carried over and the second condition skipped straight
// into maze 1.
export const IS_TRAINING = isStudy && !isModeratorView && !NEEDS_INTRO && (() => {
  if (wantsRestart) return false;   // the introduction comes first after a restart
  return readRunFlag(TRAINING_KEY) !== CONDITION_VALUE;
})();

export function completeTraining() {
  writeRunFlag(TRAINING_KEY, CONDITION_VALUE);
  globalThis.location.reload();
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
  try { globalThis.sessionStorage.removeItem(INTRO_KEY); } catch (_error) { /* ignore */ }
  try { globalThis.localStorage.removeItem(STUDY_LIVE_KEY); } catch (_error) { /* ignore */ }
  // the mirrors too, or ?restart replays nothing and drops straight into maze 1
  try { globalThis.localStorage.removeItem(`${TRAINING_KEY}_mirror`); } catch (_error) { /* ignore */ }
  try { globalThis.localStorage.removeItem(`${INTRO_KEY}_mirror`); } catch (_error) { /* ignore */ }
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
