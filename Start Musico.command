#!/bin/bash
# Double-click this file in Finder to start Musico. Ctrl-c stops the server and any download.

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

pause() {
  read -n 1 -s -r -p "Press any key to close."
  echo
}

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not installed."
  echo "Install it from https://bun.sh, then double-click this file again."
  pause
  exit 1
fi

missing=""
for bin in yt-dlp ffmpeg; do
  command -v "$bin" >/dev/null 2>&1 || missing="$missing $bin"
done
if [ -n "$missing" ]; then
  echo "Musico needs$missing."
  echo "Install them with: brew install yt-dlp ffmpeg"
  pause
  exit 1
fi

URL=http://127.0.0.1:7777

# Already running in another Terminal: just show it.
if curl -sf -o /dev/null "$URL/api/state"; then
  open "$URL"
  exit 0
fi

# One server at a time: two would share the database and race on syncs.
# If 7777 belongs to another app, the server below says so instead of moving aside.
# Show the front page once it answers, without blocking the server in the foreground.
(
  for _ in $(seq 1 80); do
    if curl -sf -o /dev/null "$URL/api/state"; then
      open "$URL"
      break
    fi
    sleep 0.25
  done
) &
OPENER=$!

trap 'kill "$OPENER" 2>/dev/null' EXIT INT TERM

PORT=7777 bun src/cli.ts ui
echo
echo "Musico stopped."
