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

---

# When participants cannot reach vercel.app (mainland China)

`*.vercel.app` is blocked in mainland China. Qualtrics was tested and works, so this
is a hosting problem only — the questionnaires do not need to move.

**Only the participant's browser needs to reach the host.** The KV store is called
server-side, so Upstash stays exactly as it is wherever the app runs.

## Option A — a custom domain on Vercel (30 minutes, might not work)

Point your own domain at the Vercel project. Sometimes enough, because part of the
block targets the `vercel.app` name itself; often not, because Vercel's IPs are also
blocked. Cheap to try, but it needs the blocked participant to re-test, so a failure
costs a round trip through the supervisor.

## Paying for none of it

**GitHub Student Developer Pack** (education.github.com/pack) — free with an Imperial
email, and the usual reason not to bother paying for any of this. It has typically
included a free domain for a year and hosting credit worth far more than a year of the
small server below. Check what is currently on offer before spending anything.

**Ask Imperial first, though.** Departments often host student project sites, and a
university-hosted URL is easier to defend in an ethics application than a personal VPS.
Dr Zhou may also have an institutional option that is reachable from the mainland
without any of this.

**Oracle Cloud Always Free** has Singapore, Tokyo and Seoul regions and is free
indefinitely rather than for a trial period. Card needed for identity, not billed.

**If none of that works**, recruit around it and say so. One participant unable to
reach the host is a recorded limitation, not a broken study — and it costs nothing.
Weigh that against the effort before assuming the host has to move.

## Option B — a small server in Hong Kong or Singapore (~1 hour, reliable)

Reachable from the mainland without a VPN, and **no ICP licence** — that is only
required to host inside mainland China itself. Vultr, DigitalOcean and Alibaba Cloud
all do this for roughly £5/month.

`server.js` mounts the same `api/` modules the hosted build uses, so this is the same
code, not a port.

```bash
# on the server (Node 18+)
git clone <your repo> && cd llm-maze-prototype
npm install --omit=dev

cat > .env <<'EOF'
PORT=3000
KV_REST_API_URL=...      # same two values as the Vercel project
KV_REST_API_TOKEN=...
EOF

npx pm2 start server.js --name maze && npx pm2 save && npx pm2 startup
```

No LLM key is needed. The study serves pre-generated cues from `public/mazes8/hints/`,
so nothing calls a model at run time and there is no spend to watch.

**HTTPS is not optional.** The questionnaire is shown in an iframe pointing at an
`https://` Qualtrics URL, and a browser on an `http://` page blocks that as mixed
content — the maze would work and the questionnaire would silently fail to appear,
which is the worst way for this to break. Caddy does it in two lines:

```
your-domain.example {
  reverse_proxy localhost:3000
}
```

## Either way, verify before recruiting

Ask the participant who was blocked to open the new link and confirm they reach the
maze, rather than assuming a fix worked. Then re-check `/api/run-log?health=1` from
the new host, since a moved deployment is a new deployment and environment variables
do not follow it.

## Option C — a managed host near China, free or near-free for a student

DigitalOcean was dropped from the Student Pack, so `.do/app.yaml` only applies if you
pay for it. The pack's contents change; check what is actually in yours before
committing to any of these.

What the host has to give you: a **Hong Kong, Singapore or Tokyo** region, **automatic
HTTPS** (the questionnaire is an https iframe and breaks silently on an http page), and
**no cold starts** — a free tier that sleeps makes the first participant of the day wait
a minute on a blank screen and conclude the study is broken.

| | region | HTTPS | cost | setup |
|---|---|---|---|---|
| **Azure for Students** | East Asia (Hong Kong) | automatic | $100 credit, no card | deploy from GitHub |
| **Oracle Always Free** | Singapore, Tokyo | Caddy, two lines | free with no expiry | a real VM to administer |
| **Fly.io** | Hong Kong | automatic | pennies a month | one config file |
| Render free tier | Singapore | automatic | free | **sleeps after 15 min** |

**Azure is the closest replacement for the DigitalOcean plan.** Hong Kong is the best
region on this list for mainland reach. Note the F1 free tier does not do custom domains
or certificates — you need B1, which the $100 student credit covers for several months.
Long enough for a study, not forever.

**Oracle is the one that never expires**, which matters if the project outlives the
credit. The cost is that it is a bare VM: you install Node, run the app under pm2, and
put Caddy in front for HTTPS. Roughly the hour described in Option B.

**Render is tempting and I would not use it.** Free web services sleep when idle, and
the wake-up is slow enough that a participant will give up. Silent dropout that looks
like ordinary non-response is the worst failure mode this study has.

Whichever you pick, the app needs no change: `npm start`, `server.js` reads
`process.env.PORT`, and the two KV secrets are the only configuration.
