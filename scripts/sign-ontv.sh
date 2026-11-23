#!/bin/bash
# Signs the on-TV app for release (coord/GOOGLE-PLAY-PLAN.md section 3, choice B; coord/GOOGLE-PLAY-BUILD.md).
#
#   bash scripts/sign-ontv.sh apk <in.apk> <out.apk>   a GitHub APK (couch-tv-ontv.apk, couch-tv-ontv-watch.apk)
#   bash scripts/sign-ontv.sh aab <in.aab> <out.aab>   the Google Play bundle, with the upload key
#
# apk: the old key (the Mac's debug key, which every GitHub release up to and including 0.13.10 carries) signs v1 and v2, so
#      Android 6 to 8 TVs still take the update; the Couch TV release key signs v3 with the proof of rotation
#      (~/.couchtv-keys/couchtv.lineage, debug key -> release key, --rotation-min-sdk-version 28; public, but
#      kept beside the keys because the repo privacy scan trips on its binary bytes), so
#      Android 9 and newer move to the release key and keep the app's data. That release key is also Google
#      Play's app signing key (uploaded once by the owner with PEPK), so a TV can later move to Play.
# aab: jarsigner with the upload key (Play checks it and signs what it delivers with the app signing key).
#
# The keys live only on the maintainer's signing Mac (~/.couchtv-keys, folder 700, files 600) and their passwords only in
# the macOS login keychain; nothing here prints, logs or writes a password. Environment (all optional):
#   COUCHTV_RELEASE_KEYSTORE  default ~/.couchtv-keys/couchtv-release.jks, alias COUCHTV_RELEASE_ALIAS (couchtv)
#   COUCHTV_RELEASE_STORE_PASS, COUCHTV_RELEASE_KEY_PASS  default: keychain couchtv-release-store / -key
#   COUCHTV_UPLOAD_KEYSTORE   default ~/.couchtv-keys/couchtv-upload.jks, alias COUCHTV_UPLOAD_ALIAS (couchtv-upload)
#   COUCHTV_UPLOAD_STORE_PASS, COUCHTV_UPLOAD_KEY_PASS    default: keychain couchtv-upload-store / -key
#   COUCHTV_OLD_KEYSTORE      default ~/.android/debug.keystore (alias androiddebugkey, password android)
#   COUCHTV_LINEAGE           default ~/.couchtv-keys/couchtv.lineage (also inside every rotated APK: apksigner rotate --in)
#   ANDROID_HOME, JAVA_HOME
set -eu
set +x
ROOT=$(cd "$(dirname "$0")/.." && pwd)
usage() { sed -n '4,5p' "$0" | sed 's/^# //'; exit 2; }
[ $# -eq 3 ] || usage
KIND=$1; IN=$2; OUT=$3
[ -f "$IN" ] || { echo "$IN: no such file"; exit 2; }
[ "$IN" != "$OUT" ] || { echo "write the signed file to another name"; exit 2; }

if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "/opt/android-sdk"; do [ -d "$d/build-tools" ] && ANDROID_HOME=$d && break; done
fi
[ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ] && JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true)
[ -n "${JAVA_HOME:-}" ] && export JAVA_HOME && export PATH="$JAVA_HOME/bin:$PATH"

# a password from the environment, else from the login keychain; never echoed
secret() {  # <env name> <keychain service>
  local v="${!1:-}"
  if [ -z "$v" ]; then
    v=$(security find-generic-password -s "$2" -a couchtv -w 2>/dev/null) || { echo "no $1 and no keychain item $2 (only the maintainer's signing Mac signs releases)" >&2; return 1; }
  fi
  printf '%s' "$v"
}
quiet() { grep -v '^WARNING' || true; }

case "$KIND" in
  apk)
    AS=$(ls -d "${ANDROID_HOME:-/nonexistent}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
    [ -x "$AS" ] || { echo "apksigner not found (set ANDROID_HOME)"; exit 2; }
    KS=${COUCHTV_RELEASE_KEYSTORE:-$HOME/.couchtv-keys/couchtv-release.jks}
    OLD=${COUCHTV_OLD_KEYSTORE:-$HOME/.android/debug.keystore}
    LIN=${COUCHTV_LINEAGE:-$HOME/.couchtv-keys/couchtv.lineage}
    for f in "$KS" "$OLD" "$LIN"; do [ -f "$f" ] || { echo "$f is missing"; exit 2; }; done
    CTV_SP=$(secret COUCHTV_RELEASE_STORE_PASS couchtv-release-store); CTV_KP=$(secret COUCHTV_RELEASE_KEY_PASS couchtv-release-key)
    export CTV_SP CTV_KP
    "$AS" sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
      --ks "$OLD" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
      --next-signer --ks "$KS" --ks-key-alias "${COUCHTV_RELEASE_ALIAS:-couchtv}" --ks-pass env:CTV_SP --key-pass env:CTV_KP \
      --lineage "$LIN" --rotation-min-sdk-version 28 --out "$OUT" "$IN" 2>&1 | quiet
    unset CTV_SP CTV_KP
    [ -f "$OUT" ] || { echo "signing failed"; exit 1; }
    "$AS" verify --min-sdk-version 23 "$OUT" 2>&1 | quiet
    echo "signed $OUT (v1 and v2: the old key; v3: the Couch TV release key with the rotation proof, Android 9 and newer)"
    ;;
  aab)
    command -v jarsigner >/dev/null || { echo "jarsigner not found (set JAVA_HOME to a JDK)"; exit 2; }
    KS=${COUCHTV_UPLOAD_KEYSTORE:-$HOME/.couchtv-keys/couchtv-upload.jks}
    [ -f "$KS" ] || { echo "$KS is missing"; exit 2; }
    CTV_SP=$(secret COUCHTV_UPLOAD_STORE_PASS couchtv-upload-store); CTV_KP=$(secret COUCHTV_UPLOAD_KEY_PASS couchtv-upload-key)
    export CTV_SP CTV_KP
    cp "$IN" "$OUT"
    # the bundle Gradle made carries the build machine's debug signature: off with it, then the upload key's
    zip -q -d "$OUT" 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.EC' 'META-INF/*.DSA' 'META-INF/MANIFEST.MF' >/dev/null 2>&1 || true
    jarsigner -keystore "$KS" -storepass:env CTV_SP -keypass:env CTV_KP -sigalg SHA256withRSA -digestalg SHA-256 \
      "$OUT" "${COUCHTV_UPLOAD_ALIAS:-couchtv-upload}" 2>&1 | quiet
    unset CTV_SP CTV_KP
    jarsigner -verify "$OUT" 2>&1 | grep -q "jar verified" || { echo "the signed bundle does not verify"; exit 1; }
    echo "signed $OUT with the upload key"
    ;;
  *) usage ;;
esac
