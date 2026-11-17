#!/bin/bash
# Double-click this file on a Mac to start Sanctuary Lights.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js is not installed.\n\nDownload the LTS installer from nodejs.org, install it, then double-click start.command again." buttons {"OK"} with icon caution'
  open "https://nodejs.org/en/download"
  exit 1
fi
PORT="${PORT:-8080}"
( sleep 1.5; open "http://localhost:$PORT" ) &
exec node server.js
