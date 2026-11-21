# Musico

Paste a public YouTube Music playlist, rip it to MP3s, skip anything already downloaded.

Two modes share the same tested core (`src/core/`):

| Mode | Entry | Who it serves |
| --- | --- | --- |
| Local | `bun run ui` → http://127.0.0.1:7777 | just you, files land in `downloads/` |
| Hosted | `bun run hosted` → http://localhost:8787 | anyone with the link, one zip per session |

## Local

```bash
bun run ui     # dashboard, paste the playlist link, press Rip new
bun run sync   # same job headless
bun test       # unit tests, no network
```

A playlist is public or unlisted by default. For a private one, set
`"cookiesFromBrowser": "firefox"` in `musico.config.json`.

## Hosted

`src/hosted.ts` keeps everything in memory and on a temp dir:

- a browser gets an `HttpOnly` session cookie, so a reload keeps its list
- one job per session, newest replaces the old one
- `GET /api/zip` streams every finished MP3 as one zip
- `GET /healthz` is there for the host's health check
- job directories are deleted when the TTL passes, and on boot

There is no database, so a container restart drops in-flight sessions. That is
deliberate: the TTL is the whole retention story.

### Limits

Everything is an environment variable, so the same image can run on a 512 MB
free instance or a 1 GB VM.

| Variable | Default | What it does |
| --- | --- | --- |
| `MAX_TRACKS` | 50 | tracks read from one playlist |
| `MAX_DISK_MB` | 800 | temp-dir budget for all sessions together |
| `MAX_CONCURRENT` | 2 | rips running at once |
| `MAX_JOBS` | 20 | live sessions; the oldest finished one is evicted first |
| `RIPS_PER_HOUR` | 3 | per IP |
| `TRACK_TIMEOUT_SECONDS` | 600 | kill one stalled track so the queue moves on |
| `TTL_MINUTES` | 45 | session lifetime |
| `PORT` | 8787 | listen port |

The disk cap is checked before every track, not just at the end: a public burst
stops with an error instead of filling the container. Audio may use 40% of
`MAX_DISK_MB`; the other 60% is headroom for the zip, which is roughly as large
as the audio it holds. One track can overshoot its budget because its size is
not known until it has downloaded, so the real ceiling is
`MAX_DISK_MB` plus at most one track and its zip entry. A second, different
playlist in the same session does not get its old files back: they stay on disk
until the TTL and count against the cap. A 256 MB filesystem reserve is always
left untouched.

## Deploy

The image needs ffmpeg, yt-dlp, Deno and a writable disk. Vercel and Cloudflare
Workers cannot host it: no Python, no child processes, no writable filesystem.

### Render, free and no credit card

Render's free web service runs a Dockerfile from a Git repo and gives a public
`https://<name>.onrender.com` URL. Push this repo to GitHub, then in Render
choose **New → Blueprint** and pick the repo; `render.yaml` declares the
service.

What free costs you:

- 0.1 CPU and 512 MB RAM, so transcoding is slow and `render.yaml` allows one
  rip at a time
- it sleeps after 15 minutes without inbound traffic; the dashboard polls while
  it is open, so keep the tab open during a rip
- roughly 5 GB/month of egress on the free workspace, which is a few dozen zips
- YouTube bot-checks datacenter IPs, so some rips will fail with a sign-in
  prompt. That is between you and YouTube, not something the code can fix

### Fly.io, paid

`fly.toml` is set up for a 1 GB machine:

```bash
fly launch --no-deploy --copy-config --dockerfile Dockerfile
fly deploy
```

Fly has no free tier any more and requires a card. Change `app` in `fly.toml`
if the name `musico` is taken, since app names are global.

### What does not work

- **Hugging Face Docker Spaces**: Docker Spaces need a paid PRO plan (checked
  November 2026), and free accounts only get Gradio/ZeroGPU Spaces
- **Railway free**: $1/month of credit, 1 GB ephemeral disk, and its fair-use
  page names music bots and DMCA content as disallowed
- **GitHub Codespaces**: 120 free core-hours, but its terms forbid hosting a
  production-facing app, and the forwarded port stops with the codespace
- **Oracle Cloud Always Free**: a credit card is required for identity checks
- **Koyeb**: free instance exists, card required

There is no free, card-free host that reliably downloads from YouTube: free
tiers are all datacenter IPs, which YouTube treats as suspicious. Render free
is the closest thing to what you asked for, and it is a demo, not a service.

### Before you make it public

Downloading audio and serving it to the public is against YouTube's terms and
is copyright infringement in most places. Free hosts suspend accounts for it.
Keep it small, keep the rate limits, and keep retention short.

## Layout

```
src/core/     yt-dlp calls, naming, parsing, disk budget, local SQLite state
src/cli.ts    sync / ui commands
src/server.ts local loopback dashboard
src/hosted.ts multi-user hosted dashboard
src/web/      one page, no framework, no build step
tests/        offline unit tests
```
