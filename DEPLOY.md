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

**HTTPS matters, for a reason I got wrong earlier.** Not mixed content — an `http`
page embedding an `https` iframe is allowed, so the questionnaire loads fine. The real
problem is that participant data would cross the network unencrypted, which is an ethics
and data-protection failure rather than a visible bug. Caddy does it in two lines:

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
HTTPS** (so participant data is not sent in the clear), and
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

## Azure App Service, step by step

**Create a "Web App", not a "Static Web App".** Static Web Apps serve static files plus
Azure Functions, and the handlers in `api/` are Express-style `(req, res)` — every one
would need rewriting. A Web App runs `server.js` as it stands.

- **Publish:** Code
- **Runtime:** Node 20 LTS
- **OS:** Linux
- **Region:** East Asia (Hong Kong)
- **Plan:** B1. The F1 free tier has no custom domains, a daily CPU quota, and sleeps
  when idle. The student credit covers B1 for months, and this study will not run for
  that long.

Then, in **Configuration → Application settings**:

| setting | value | why |
|---|---|---|
| `KV_REST_API_URL` | from Vercel | the store does not move |
| `KV_REST_API_TOKEN` | from Vercel | |
| `NPM_CONFIG_PRODUCTION` | `true` | **see below** |

Turn **Always On** on, under General settings. Without it the app idles out and the
first participant of the day waits on a blank screen.

**`NPM_CONFIG_PRODUCTION=true` is not optional.** Azure's build runs a plain
`npm install`, which pulls devDependencies — and Playwright is one, which downloads
browser binaries and can hang or fail the deploy. `vercel.json` avoids this with
`--omit=dev`; App Service needs the app setting instead.

**You may not need a custom domain at all.** `*.azurewebsites.net` is not blocked in
mainland China the way `*.vercel.app` is, and Azure serves HTTPS on it by default. Try
the default URL with the participant first. A custom domain is still worth having later,
for the corporate filters that block shared hosting domains — but it is not the thing
standing between you and a working pilot.

**Deploy:** Deployment Center → GitHub → this repo, branch `v9-mazes-module`. Azure
writes the workflow itself and redeploys on push, the same as Vercel did.

---

# Hosting inside mainland China (Alibaba Cloud)

Needs an ICP filing (备案), which normally takes weeks and a mainland entity. If a
collaborator already has an ICP-registered domain, that is the hard part done — what
remains is a server for it to point at.

**The filing is tied to the server**, so the ECS has to be with the provider the domain
is filed against, in a mainland region. Real-name verification for a mainland Alibaba
Cloud account generally needs Chinese ID, so in practice the collaborator owns the
account and the server; the app just runs on it.

## What the server needs

Nothing unusual, and nothing outside China:

- Node 18+ (`npm install --omit=dev`, then `npm start`)
- 1 vCPU, 1 GB RAM
- HTTPS, so participant data is not transmitted unencrypted. The questionnaire itself
  works either way: an http page may embed an https iframe, and only the reverse is
  blocked. This is a data-protection requirement, not a functional one
- a writable disk

**No database service and no API keys.** With `KV_REST_API_*` unset, `lib/store.js`
keeps everything in `error_logs/store.json` on the server's own disk. That is deliberate:
a mainland server calling a store abroad means an outbound trip across the border on
every write, which fails looking like lost data rather than a network problem. Cues are
pre-generated files, so nothing calls a model at run time either.

Back up `error_logs/store.json` — on this setup it is the entire study.

## Ping will not tell you anything useful

Managed hosts commonly drop ICMP, so a server can be perfectly reachable and still fail
a ping. The test that matters is whether the page loads in a browser from inside China.
On a plain Alibaba ECS ping does work, and its public IP is stable — which is exactly
why this route suits the filing better than managed hosting does.

## One instance only, on the file store

`pm2 start server.js` — **not** `-i max` or cluster mode. The JSON store is
read-modify-write, which is safe because Node handles one request at a time per
process. Two processes on the same file can interleave and lose rows.

If the study ever outgrows one instance, that is the point to move to a real database,
not before.
