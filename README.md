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
bun test       # 20 unit tests, no network
```

A playlist is public or unlisted by default. For a private one, set
`"cookiesFromBrowser": "firefox"` in `musico.config.json`.

## Hosted

`src/hosted.ts` keeps everything in memory and on a temp dir:

- a browser gets an `HttpOnly` session cookie, so a reload keeps its list
- one job per session, newest replaces the old one
- `GET /api/zip` streams every finished MP3 as one zip
- at most 50 tracks per playlist, 3 rips per IP per hour, 2 rips at once
- job directories are deleted 45 minutes after they start, and on boot

There is no database, so a container restart drops in-flight sessions. That is
deliberate: 45 minutes is the whole retention story.

### Deploy

The image needs ffmpeg, yt-dlp, a JS runtime and a writable disk. Vercel and
Cloudflare Workers cannot host this. Use a container host:

```bash
# Fly.io — gives you https://musico.fly.dev
fly launch --no-deploy --copy-config --dockerfile Dockerfile
fly deploy
```

Render and Railway work the same way: point them at this repo and they will
build the Dockerfile. Set `PORT` only if the host requires it.

If Fly rejects the name `musico` (app names are global), change `app` in
`fly.toml` — the URL follows it.

A short custom domain needs to be bought and pointed at the host; `*.fly.dev`
and `*.onrender.com` are free.

### Before you make it public

YouTube rate-limits and bot-checks datacenter IPs, so expect some rips to fail
with a sign-in prompt. Downloading audio and serving it to the public is
against YouTube's terms and is copyright infringement in most places; hosting
this openly is a good way to lose the host account. Keep it small, keep the
rate limits, and keep retention short.

## Layout

```
src/core/     yt-dlp calls, naming, parsing, local SQLite state
src/cli.ts    sync / ui commands
src/server.ts local loopback dashboard
src/hosted.ts multi-user hosted dashboard
src/web/      one page, no framework, no build step
tests/        offline unit tests
```
