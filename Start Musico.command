#!/bin/bash
# Double-click this file in Finder to start Musico. Ctrl-c stops the server and any rip.

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not on PATH."
  echo "Install it from https://bun.sh, then double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

URL=http://127.0.0.1:7777

# Show the dashboard once it answers, without blocking the server in the foreground.
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

bun src/cli.ts ui
echo
echo "Musico stopped."
