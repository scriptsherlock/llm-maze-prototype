# Deploying the maze as a shareable web link (Vercel)

This turns the app into a URL you send to participants — they click it and play.
No download, no install, no Node on their side. The AI hint runs as a serverless
function with your Gemini key kept **server-side** (never sent to the browser).

## What you need
- A **GitHub** account (free)
- A **Vercel** account (free — sign in with GitHub)
- Your **Gemini API key** (use a rate-limited / disposable one for a public demo)

## One-time setup (~5 minutes)

1. **Push this project to a GitHub repo.**
   (The `.env` file is gitignored, so your key does NOT get committed — good.)

2. **Import it into Vercel:** vercel.com → *Add New… → Project* → pick the repo.
   - Framework Preset: **Other**
   - Build Command: **(leave empty)**
   - Output Directory: **public** (already set in `vercel.json`)

3. **Add Environment Variables** (Project → Settings → Environment Variables).
   Use the same values as your local `.env`:
   - `LLM_PROVIDER` = `gemini`
   - `GEMINI_API_KEY` = *your key*
   - `GEMINI_MODEL` = *your model* (optional; e.g. `gemini-3.1-flash-lite`)

4. **Deploy.** You get a URL like `https://your-maze.vercel.app`.

5. **Share** `https://your-maze.vercel.app/participant` with participants.

## Updating later
Push to GitHub → Vercel redeploys automatically. **The URL stays the same.**

## Good to know
- **Moderator view** (`/moderator`) is your local researcher tool. Its live sync
  with a participant only works on the same machine, so remote participants just
  use the `/participant` link.
- **No data logging** in this demo build (you chose demo-only). For real remote
  data collection, results need to be captured somewhere (downloadable file at the
  end, Google Sheet, or a database) — ask to add it.
- **The key stays private** — it lives in Vercel's env vars and only the serverless
  function reads it; it is never in the page source.

## Local development is unchanged
`npm start` (or `Start Maze.bat`) still runs the full Express server from your
`.env`. Hosting and local dev share the same hint logic (`lib/hint-engine.js`).
