#!/bin/sh
# Draw Couch TV's screens to PNG files on this Mac, from the app's own SwiftUI views, against a running
# bridge or the stand-in (tests/appletv_home_standin.py). Needs Xcode (swiftc), not the tvOS Simulator.
#
#   tvos/preview/render.sh <bridge address> <code or pairing key> [out folder]
#   tvos/preview/render.sh 127.0.0.1:5455 123456 build/tvos-preview
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=${3:-"$ROOT/build/tvos-preview"}
BIN="$ROOT/build/tvos-render"
mkdir -p "$ROOT/build"
SOURCES=$(ls "$ROOT"/tvos/CouchTV/*.swift | grep -v CouchTVApp.swift)
# shellcheck disable=SC2086
IFS='
'
xcrun swiftc -parse-as-library -O -target arm64-apple-macos14 -o "$BIN" $SOURCES "$HERE/Render.swift"
"$BIN" "$ROOT" "$1" "$2" "$OUT"
