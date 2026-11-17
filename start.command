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
# Install the MIDI module the first time (needs internet once; optional).
if [ ! -d node_modules/@julusian/midi ] && command -v npm >/dev/null 2>&1; then
  echo "Installing MIDI support (one time)..."
  npm install --omit=dev --no-audit --no-fund || echo "MIDI module could not be installed. Lights still work; MIDI can use the browser bridge."
fi
PORT="${PORT:-8080}"
( sleep 1.5; open "http://localhost:$PORT" ) &
exec node server.js
