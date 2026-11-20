#!/bin/sh
# Installs the Matter controller the bridge runs as its own service (docs/MATTER.md): the Open Home
# Foundation Matter Server (npm "matter-server", Apache 2.0, written on matter.js), at the exact
# versions in bridge/matter/package-lock.json, into bridge/matter/node_modules (git ignores it).
# Works the same on macOS, Linux and a Raspberry Pi: nothing is compiled. Needs Node.js 22.13 or newer.
# Run it again after updating couch-tv. Then restart the bridge.
#
#   scripts/matter-setup.sh          install
#   scripts/matter-setup.sh --check  only say whether it is installed and Node is new enough
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIR="$ROOT/bridge/matter"
ENTRY="$DIR/node_modules/matter-server/dist/esm/bin.js"

if ! command -v node >/dev/null 2>&1; then
  echo "Matter needs Node.js 22.13 or newer, and this computer has no Node.js."
  echo "macOS: brew install node@22 (or the installer from nodejs.org). Linux and Raspberry Pi: nodejs.org, or your distribution's nodejs 22."
  exit 1
fi
V=$(node -p 'process.versions.node')
MAJOR=${V%%.*}
REST=${V#*.}
MINOR=${REST%%.*}
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 13 ]; }; then
  echo "Matter needs Node.js 22.13 or newer. This computer has $V."
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  if [ -f "$ENTRY" ]; then
    echo "matter: installed ($(node -p "require('$DIR/node_modules/matter-server/package.json').version"), Node.js $V)"
    exit 0
  fi
  echo "matter: not installed yet (run scripts/matter-setup.sh)"
  exit 1
fi

# --ignore-scripts: only optional Bluetooth and USB add ons have install scripts, and the bridge
# never uses them (a shared Matter device is always added over the home network).
npm ci --prefix "$DIR" --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
node "$ENTRY" --version >/dev/null
echo "matter: installed $(node -p "require('$DIR/node_modules/matter-server/package.json').version") in bridge/matter. Restart the bridge to start it."
