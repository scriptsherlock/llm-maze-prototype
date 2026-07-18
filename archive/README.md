# Archived logic

## `game.rolling-hint.js`

Snapshot of `public/game.js` from the **rolling / persistent hint** version (taken 2026-07-18).

In this version, after pressing **Ask AI** once:
- the hint (trail + arrow + text) stays visible indefinitely (`hintVisibleUntil = Infinity`),
- the 3-step window **rolls forward** through the whole AI route as the participant follows it,
- it only clears on **Reset** or when **AI is disabled** (not on deviation or reaching the goal).

`public/game.js` was then changed to **one-shot** behaviour (show the next 3 steps; clear once
walked, on deviation, or at the goal; press Ask AI again for a fresh calculation).

To restore the rolling behaviour: copy this file back over `public/game.js`.
