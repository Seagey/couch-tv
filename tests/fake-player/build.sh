#!/bin/sh
# Tests only (README.md): builds the fake player under one package name, signed with a throwaway
# key made here in build/ (never the couch-tv key).   tests/fake-player/build.sh com.netflix.ninja
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
id="${1:-com.netflix.ninja}"
case "$id" in com.netflix.ninja|com.amazon.amazonvideo.livingroom|com.spotify.tv.android) ;; *) echo "unknown package: $id"; exit 2 ;; esac
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true); export JAVA_HOME; fi
mkdir -p "$here/build"
if [ ! -f "$here/build/fake.keystore" ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$here/build/fake.keystore" -storepass fakeplayer -keypass fakeplayer \
    -alias fakeplayer -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=couch-tv fake player (tests only)" >/dev/null 2>&1
fi
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"   # no local.properties: it would hold a home folder path
export ANDROID_HOME
gw="$here/../../tv-home/android/gradlew"
(cd "$here" && "$gw" -p "$here" --no-daemon -q -PfakeId="$id" assembleDebug)
cp "$here/app/build/outputs/apk/debug/app-debug.apk" "$here/build/fake-$id.apk"
echo "$here/build/fake-$id.apk"
