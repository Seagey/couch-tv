#!/bin/sh
# Builds the couch-tv TV apps (release APKs) and prints where they are.
#   dist/couch-tv-home.apk    the TV home (options A and B), from tv-home/android
#   dist/couch-tv-ontv.apk    the "lives on the TV" app (option C), from on-tv/android, if present
#
# Needs JDK 21 and the Android SDK with platform 34 and build tools 34 (README, "Building the
# app"). Gradle itself is not needed: the Gradle wrapper (tv-home/android/gradlew) fetches 8.11.1.
#
# Usage, from the repo root:
#   [JAVA_HOME=/path/to/jdk-21] [ANDROID_HOME=/path/to/android-sdk] [CONFIG=config.json]
#   [BRIDGE_URLS=http://my-computer.local:5400] sh scripts/build-apk.sh
# CONFIG is the settings file built into the home's own copy (default: config.example.json, so a
# build is the same on every computer). apply.sh hands the TV your config.json at install time
# anyway, so the default is fine for everyone.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG=${CONFIG:-$ROOT/config.example.json}
case "$CONFIG" in /*) ;; *) CONFIG="$ROOT/$CONFIG" ;; esac

if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "/opt/android-sdk"; do
    [ -d "$d/platforms" ] && ANDROID_HOME=$d && break
  done
fi
[ -n "${ANDROID_HOME:-}" ] || { echo "Set ANDROID_HOME to your Android SDK (README, Building the app)."; exit 1; }
[ -d "$ANDROID_HOME/platforms/android-34" ] || { echo "No Android platform 34 in $ANDROID_HOME: sdkmanager \"platforms;android-34\" \"build-tools;34.0.0\""; exit 1; }
export ANDROID_HOME
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true)
fi
[ -n "${JAVA_HOME:-}" ] || { echo "Set JAVA_HOME to a JDK 21 (README, Building the app)."; exit 1; }
export JAVA_HOME

GW="$ROOT/tv-home/android/gradlew"
mkdir -p "$ROOT/dist"
EXTRA=""
[ -n "${BRIDGE_URLS:-}" ] && EXTRA="-PbridgeUrls=$BRIDGE_URLS"

echo "Building the TV home (settings built in: $CONFIG)"
"$GW" -p "$ROOT/tv-home/android" --no-daemon -q clean assembleRelease "-PconfigJson=$CONFIG" $EXTRA
cp "$ROOT/tv-home/android/app/build/outputs/apk/release/app-release.apk" "$ROOT/dist/couch-tv-home.apk"
OUT="$ROOT/dist/couch-tv-home.apk"

STATUS=0
if [ -f "$ROOT/on-tv/android/settings.gradle.kts" ] || [ -f "$ROOT/on-tv/android/settings.gradle" ]; then
  # The on-TV app carries the phone remote inside it, so remote/dist has to exist first. A fresh
  # clone has no remote/dist (it is a build output), so build it here. Needs Node 20 or newer.
  if [ ! -f "$ROOT/remote/dist/index.html" ]; then
    if command -v npm > /dev/null 2>&1; then
      echo "Building the phone remote first (the on-TV app carries it)"
      (cd "$ROOT/remote" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent)
    else
      echo "Skipping the on-TV app (option C): it needs the phone remote built first, and that needs"
      echo "Node 20 or newer (npm), which this computer does not have. Install Node and run this again,"
      echo "or download couch-tv-ontv.apk from the GitHub Releases page."
      STATUS=1
    fi
  fi
  if [ -f "$ROOT/remote/dist/index.html" ]; then
    echo "Building the on-TV app (option C)"
    "$GW" -p "$ROOT/on-tv/android" --no-daemon -q clean assembleRelease
    cp "$ROOT/on-tv/android/app/build/outputs/apk/release/app-release.apk" "$ROOT/dist/couch-tv-ontv.apk"
    OUT="$OUT
$ROOT/dist/couch-tv-ontv.apk"
  fi
fi

echo "Built:"
echo "$OUT" | while read -r f; do
  echo "  $f  sha256 $(shasum -a 256 "$f" 2>/dev/null | cut -d' ' -f1 || sha256sum "$f" | cut -d' ' -f1)"
done
exit $STATUS
