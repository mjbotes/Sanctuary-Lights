#!/bin/bash
# Double-click on a Mac to build "Sanctuary Lights.app" and a .dmg installer in the dist folder.
# Needs Node.js LTS (nodejs.org) and an internet connection the first time.
cd "$(dirname "$0")"
for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js is not installed. Install the LTS version from nodejs.org, then run this again." buttons {"OK"} with icon caution'
  open "https://nodejs.org/en/download"; exit 1
fi
set -e
echo "Installing build tools (first time takes a few minutes)..."
npm install --no-audit --no-fund
echo "Building the Mac app..."
export CSC_IDENTITY_AUTO_DISCOVERY=false
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
npx electron-builder --mac dmg --"$ARCH" --publish never -c.mac.identity=-
echo
echo "Done. The installer is in the dist folder:"
ls -1 dist/*.dmg
open dist
