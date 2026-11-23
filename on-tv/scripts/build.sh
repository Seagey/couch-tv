#!/usr/bin/env bash
# Builds the on-TV app: android/app/build/outputs/apk/github/release/app-github-release.apk
# Needs JDK 17+ (JAVA_HOME), the Android SDK (ANDROID_HOME, or sdk.dir in android/local.properties)
# and Gradle 8.9+ on PATH (or GRADLE=/path/to/gradle). Builds the phone remote first if it has no dist/.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/.." && pwd)"
remote="${REMOTE_DIR:-$root/remote}"
[ -d "$remote" ] || remote="$root/repo/remote"     # staging layout

if [ ! -f "$remote/dist/index.html" ]; then
  echo "Building the phone remote in $remote"
  (cd "$remote" && npm install --no-audit --no-fund && npm run build)
fi

cd "$here/android"
if [ ! -f local.properties ] && [ -n "${ANDROID_HOME:-}" ]; then echo "sdk.dir=$ANDROID_HOME" > local.properties; fi
"${GRADLE:-gradle}" --no-daemon -q assembleGithubRelease
echo "APK: $here/android/app/build/outputs/apk/github/release/app-github-release.apk"
