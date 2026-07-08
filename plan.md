# Prototype-First Live LLM Maze Repository

## Summary
This prototype turns the current standalone first-person maze into a small JavaScript/CSS game with a Node/Express backend. Every AI assistance button press must call a live LLM. The browser sends the current maze state, player position, facing direction, and goal to the backend; the backend prompts the LLM to return a full valid path from the current player cell to the goal.

The browser never sees the LLM API key. It only receives a validated path response from the local backend.

The backend supports two providers:
- `LLM_PROVIDER=openai`: uses OpenAI's Responses API with `OPENAI_API_KEY`.
- `LLM_PROVIDER=venice`: uses Venice's OpenAI-compatible chat completions API with `VENICE_API_KEY`.
- `LLM_PROVIDER=gemini`: uses Google's Gemini structured-output API with `GEMINI_API_KEY`.

Venice credits do not transfer into an OpenAI account. They are used through Venice's API and Venice-hosted model IDs.
Gemini API keys also do not transfer into an OpenAI account. They are used through Google's Gemini API and Gemini model IDs.

## Live LLM Hint Flow
- Player clicks the AI assistance button.
- Browser sends current state to `POST /api/hint`:
  - maze grid
  - player position
  - facing direction
  - goal position
  - max visible hint steps
  - current move count
  - client event id
- Backend sends a structured prompt to the LLM.
- LLM response must include:
  - `status`
  - `full_path`: the full path from the player's current cell to the maze goal
  - `hint_steps`: the next 2-3 visible steps from that full path
  - optional short `reason`
- Backend validates the full path:
  - starts at the current player position
  - ends at the goal
  - every move is north, south, east, or west
  - no step crosses a wall
  - no step leaves the grid
- If valid, the browser stores the full path and renders only the next 2-3 hint steps.
- If invalid, the backend retries once with a correction prompt.
- If still invalid, the UI shows an AI failure message and logs the failed request.

## Implementation Details
- Use a Node/Express backend for the prototype because live LLM calls need a secret API key.
- Store the API key in `.env`; never place it in browser JavaScript.
- Choose the provider with `LLM_PROVIDER=openai`, `LLM_PROVIDER=venice`, or `LLM_PROVIDER=gemini`.
- Use structured JSON output from the LLM so the path can be parsed reliably.
- Add a loading state on the hint button while the LLM call is running.
- Add a server-side timeout of about 8 seconds.
- Do not silently replace failed LLM output with BFS because the study requires live LLM behavior.
- Keep moderator AI enable/disable in the prototype as a local/server toggle first; later this can become an oTree session-level control.
- Keep the current first-person canvas approach for the first prototype, with CSS and canvas drawing upgraded toward a street-like scene.

## Prototype File Structure
- `server.js`: local backend, protected LLM API call, AI toggle, path validation.
- `public/index.html`: game page.
- `public/styles.css`: UI and street styling.
- `public/game.js`: maze state, rendering, controls, hint display, metrics.
- `public/maze.js`: maze/grid/start/goal config.
- `public/assets/`: placeholder folder for street/player assets.
- `plan.md`: this implementation plan.

## Metrics
Log each event in browser memory and allow JSON/CSV download:
- move
- turn
- blocked move
- hint requested
- LLM response received
- LLM response invalid
- AI disabled/enabled
- goal reached

For each hint, log:
- player position
- full path length returned
- hint steps shown
- LLM latency
- validation status
- retry count
- AI enabled state

## Test Plan
- Hint request returns a full valid path from current position to goal.
- UI displays only the next 2-3 steps from the full path.
- Moving along the path advances the stored plan.
- Deviating from the stored path marks the stored plan as stale.
- Every hint request still calls the live LLM.
- Invalid LLM path is rejected and retried once.
- AI disabled state prevents LLM calls.
- Goal reached event is logged.
- Existing first-person movement and wall collision behavior still works.

## Assumptions
- New repo name: `llm-maze-prototype`.
- Prototype first means not oTree yet.
- Use JavaScript/CSS now; Three.js can be added after the first working LLM prototype.
- Live LLM call is mandatory on every hint request.
- The full path returned by the LLM is stored internally, but participants only see short hint steps.
