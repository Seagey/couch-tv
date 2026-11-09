#!/bin/sh
# Builds the sync helper (dev.couchtv.sync) and, with "test", the test player (dev.couchtv.synctest).
# Both are signed with ~/.android/debug.keystore, as the other couch-tv apps are.
#   sync/build.sh            -> sync/build/couch-tv-sync.apk
#   sync/build.sh test       -> sync/build/synctest-player.apk (for an emulator only)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true); export JAVA_HOME; fi
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"; export ANDROID_HOME
gw="$here/../tv-home/android/gradlew"
mkdir -p "$here/build"
if [ "${1:-}" = "test" ]; then
  "$gw" -p "$here/testplayer" --no-daemon -q assembleDebug
  cp "$here/testplayer/app/build/outputs/apk/debug/app-debug.apk" "$here/build/synctest-player.apk"
  echo "$here/build/synctest-player.apk"
else
  "$gw" -p "$here/android" --no-daemon -q assembleRelease
  cp "$here/android/app/build/outputs/apk/release/app-release.apk" "$here/build/couch-tv-sync.apk"
  echo "$here/build/couch-tv-sync.apk"
fi
