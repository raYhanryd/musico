# Musico

Downloads a YouTube Music playlist as MP3s on your own Mac. Nothing is uploaded
anywhere; yt-dlp talks to YouTube directly from your machine.

## Use it

1. Double-click **Start Musico.command**. The Musico front page opens at
   <http://127.0.0.1:7777>; press **Open the deck** to reach the dashboard.
2. Paste a playlist link (YouTube Music → menu next to the playlist → Share →
   Copy link) and press **Save and download**.
3. Files land in `downloads/<playlist name>/`.

Run it again any time: MP3s already on disk are skipped, new tracks are added.
To switch playlists, press **Change playlist** in the header, paste the new link
and press **Save and download**. The last playlist is remembered in
`musico.config.json`.

**Private playlists, or “sign in to confirm you're not a bot”:** set
`"cookiesFromBrowser": "firefox"` (or `chrome`, `safari`, `edge`) in
`musico.config.json` and start again. If YouTube still complains, update yt-dlp
with `brew upgrade yt-dlp`.

## Requirements

- [Bun](https://bun.sh)
- yt-dlp and ffmpeg: `brew install yt-dlp ffmpeg`

The launcher checks all three and tells you what is missing.

## Terminal (optional)

```bash
bun run ui     # front page and dashboard
bun run sync   # download the saved playlist without opening the browser
bun test       # offline unit tests
```

## Layout

```
Start Musico.command   double-click launcher
src/core/              yt-dlp calls, naming, parsing, SQLite state
src/server.ts          local dashboard server
src/web/               front page and dashboard, no build step
downloads/             your MP3s (git-ignored)
data/                  local SQLite state (git-ignored)
```
