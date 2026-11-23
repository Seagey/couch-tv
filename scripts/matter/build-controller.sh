#!/bin/bash
# Builds the Matter controller library for the on-TV Android app, from connectedhomeip (Apache 2.0),
# and writes it to on-tv/android/matter/ with checksums. Reproducible: one pinned tag, one NDK.
#
# Runs on a Mac with Python 3, git and about 40 GB free (the full build is ~30 minutes on an M5).
#   scripts/matter/build-controller.sh build   [workdir]   # on the build Mac: clone, bootstrap, build, package
#   scripts/matter/build-controller.sh remote  <ssh-host>  # from the repo: run "build" on <ssh-host>, copy the result back, verify
#   scripts/matter/build-controller.sh verify              # check on-tv/android/matter/ against its SHA256SUMS
#   scripts/matter/build-controller.sh remote-finish <ssh-host>  # placeholders + import check + checksums on that host's last build, copy back
#
# Every build ends with an import check: libCHIPController.so may only import what Android 7 (API 24) has
# (the app never loads Matter on Android 6: it lacks getifaddrs/freeifaddrs), and the build fails otherwise.
#
# What lands in on-tv/android/matter/ (docs in on-tv/android/matter/README.md):
#   jni/<abi>/libCHIPController.so, jni/<abi>/libc++_shared.so   stripped, armeabi-v7a and arm64-v8a
#   jni/x86/libcouchtv_placeholder.so, jni/x86_64/libcouchtv_placeholder.so        tiny empty placeholders: an APK with native code
#                                       installs on a TV only if it has a lib folder for that processor
#   libs/CHIPController.jar AndroidPlatform.jar OnboardingPayload.jar libMatterTlv.jar libMatterJson.jar
#   libs/CHIPInteractionModelSlim.jar   CHIPInteractionModel.jar without ChipClusters and ClusterInfoMapping
#                                       (the app talks to devices with paths and JSON, not generated cluster classes:
#                                       8.4 MB down to well under 1 MB)
#   assets/matter-paa/*.der                        the production PAA roots from the DCL mirror in the same tag, plus the two test PAAs
#   SHA256SUMS, VERSION
set -euo pipefail

TAG="v1.6.1.0"
NDK_VERSION="28.2.13676358"
REPO_URL="https://github.com/project-chip/connectedhomeip.git"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DEST="$ROOT/on-tv/android/matter"

verify() {
  local d="${1:-$DEST}"
  [ -f "$d/SHA256SUMS" ] || { echo "no $d/SHA256SUMS"; return 1; }
  (cd "$d" && shasum -a 256 -c SHA256SUMS --quiet) && echo "verify: $(wc -l < "$d/SHA256SUMS" | tr -d ' ') files match SHA256SUMS"
}

ndk_bin() { ls -d "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/*/bin | head -1; }

# The Intel placeholder: a tiny empty library for lib/x86 and lib/x86_64. Android installs an APK on a
# TV only if the APK has a lib/ folder for the TV's processor (or none at all). The Matter library is
# ARM only, so without these the launcher (which has no other native code) would not install on an
# Intel TV. Nothing ever loads it; Matter there says its processor is not supported (MatterSupport.kt).
placeholders() {
  local D="$1" BIN; BIN="$(ndk_bin)"
  local SRC; SRC="$(mktemp -d)/placeholder.c"
  printf '%s\n' '/* Couch TV: placeholder so the APK has a library folder for Intel TVs. Matter is ARM only. */' \
    'int couchtv_matter_none(void) { return 0; }' > "$SRC"
  for pair in "i686:x86" "x86_64:x86_64"; do
    local t="${pair%%:*}" abi="${pair##*:}"
    mkdir -p "$D/jni/$abi"
    "$BIN/clang" --target="$t-linux-android23" -shared -nostdlib -O2 -fPIC -Wl,--build-id=none -Wl,-soname,libcouchtv_placeholder.so \
      -o "$D/jni/$abi/libcouchtv_placeholder.so" "$SRC"
    "$BIN/llvm-strip" --strip-unneeded "$D/jni/$abi/libcouchtv_placeholder.so"
  done
  rm -f "$SRC"; rmdir "$(dirname "$SRC")"
}

# Import check: every symbol libCHIPController.so needs must be in Android 7 (API 24), the oldest
# Android the app loads Matter on (MatterSupport.MIN_SDK). It also lists what Android 6 (API 23) lacks,
# which is why the app never loads Matter there (getifaddrs and freeifaddrs). Fails the build otherwise.
import_check() {
  local D="$1" BIN; BIN="$(ndk_bin)"
  local SYS; SYS="$(ls -d "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/*/sysroot/usr/lib | head -1)"
  local T; T="$(mktemp -d)"
  local bad=0
  for pair in "armeabi-v7a:arm-linux-androideabi" "arm64-v8a:aarch64-linux-android"; do
    local abi="${pair%%:*}" tri="${pair##*:}"
    local f="$D/jni/$abi/libCHIPController.so" g
    "$BIN/llvm-nm" -D --undefined-only "$f" | awk '{print $NF}' | sed 's/@.*//' | LC_ALL=C sort -u > "$T/undef"
    for api in 23 24; do
      : > "$T/have"
      for lib in $("$BIN/llvm-readelf" -d "$f" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p'); do
        if [ -f "$D/jni/$abi/$lib" ]; then g="$D/jni/$abi/$lib"
        elif [ -f "$SYS/$tri/$api/$lib" ]; then g="$SYS/$tri/$api/$lib"
        else echo "import check: $abi needs $lib, which is not in Android API $api or next to it"; bad=1; continue; fi
        "$BIN/llvm-nm" -D --defined-only "$g" | awk '{print $NF}' | sed 's/@.*//' >> "$T/have"
      done
      LC_ALL=C sort -u "$T/have" -o "$T/have"
      local miss; miss="$(LC_ALL=C comm -23 "$T/undef" "$T/have" | tr '\n' ' ')"
      echo "import check: $abi, $(wc -l < "$T/undef" | tr -d ' ') imports, missing at API $api: ${miss:-none}"
      [ "$api" = 24 ] && [ -n "$miss" ] && bad=1
    done
  done
  rm -f "$T/undef" "$T/have"; rmdir "$T"
  [ "$bad" = 0 ] || { echo "import check FAILED: libCHIPController.so needs something Android 7 does not have"; return 1; }
}

# Placeholders, import check and the sorted checksum list, for a staged (or existing) output folder.
finish() {
  local D="$1"
  placeholders "$D"
  import_check "$D"
  (cd "$D" && find . -type f ! -name SHA256SUMS | sed 's#^\./##' | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS)
}

ndk_env() {
  local W="$1"
  export ANDROID_HOME="${ANDROID_HOME:-$W/sdk}"
  export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"
  [ -d "$ANDROID_NDK_HOME" ] || { echo "Needs Android NDK $NDK_VERSION at $ANDROID_NDK_HOME (sdkmanager 'ndk;$NDK_VERSION')"; exit 1; }
}

build() {
  local W="${1:-$HOME/matter-spike}"
  export JAVA_HOME="${JAVA_HOME:-$(ls -d "$W"/jdk/*/Contents/Home 2>/dev/null | head -1)}"
  export ANDROID_HOME="${ANDROID_HOME:-$W/sdk}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"
  [ -d "$ANDROID_NDK_HOME" ] || { echo "Needs Android NDK $NDK_VERSION at $ANDROID_NDK_HOME (sdkmanager 'ndk;$NDK_VERSION')"; exit 1; }
  # zap: the Apple silicon build (the x64 one zap downloads by default does not run under the build's sandbox)
  [ -d "$W/zap-arm64" ] && export ZAP_INSTALL_PATH="$W/zap-arm64"
  export PATH="$JAVA_HOME/bin:${W}/kotlinc/bin:$PATH"

  local C="$W/connectedhomeip"
  if [ ! -d "$C/.git" ]; then
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$C"
  fi
  local have; have="$(git -C "$C" describe --tags --exact-match 2>/dev/null || true)"
  [ "$have" = "$TAG" ] || { echo "$C is at '$have', not $TAG. Check out $TAG first."; exit 1; }
  ( cd "$C" && [ -d .environment ] || { set +u; source scripts/bootstrap.sh -p all,android,darwin; } )

  ( cd "$C" && set +u && source scripts/activate.sh >/dev/null 2>&1 && set -u &&
    ./scripts/build/build_examples.py --target android-arm-chip-tool --target android-arm64-chip-tool build )

  local OUT; OUT="$W/couchtv-matter-out"
  local STAGE="$OUT.new.$$"
  mkdir -p "$STAGE/jni/armeabi-v7a" "$STAGE/jni/arm64-v8a" "$STAGE/libs" "$STAGE/assets/matter-paa"
  local STRIP; STRIP="$(ls "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/*/bin/llvm-strip | head -1)"
  for pair in "arm:armeabi-v7a" "arm64:arm64-v8a"; do
    local t="${pair%%:*}" abi="${pair##*:}"
    for so in libCHIPController.so libc++_shared.so; do
      "$STRIP" --strip-unneeded -o "$STAGE/jni/$abi/$so" "$C/out/android-$t-chip-tool/lib/jni/$abi/$so"
    done
  done
  local L="$C/examples/android/CHIPTool/app/libs"
  for j in CHIPController.jar AndroidPlatform.jar OnboardingPayload.jar libMatterTlv.jar libMatterJson.jar; do
    cp "$L/$j" "$STAGE/libs/$j"
  done
  cp "$L/CHIPInteractionModel.jar" "$STAGE/libs/CHIPInteractionModelSlim.jar"
  zip -q -d "$STAGE/libs/CHIPInteractionModelSlim.jar" 'chip/devicecontroller/ChipClusters*' \
    'chip/devicecontroller/ClusterInfoMapping*' 'chip/clusterinfo/*' >/dev/null
  cp "$C"/credentials/production/paa-root-certs/*.der "$STAGE/assets/matter-paa/"
  cp "$C"/credentials/test/attestation/Chip-Test-PAA-FFF1-Cert.der "$C"/credentials/test/attestation/Chip-Test-PAA-NoVID-Cert.der "$STAGE/assets/matter-paa/"
  # the exact source commit and NDK
  printf '%s\n' "connectedhomeip $TAG $(git -C "$C" rev-parse HEAD)" "ndk $NDK_VERSION" > "$STAGE/VERSION"
  finish "$STAGE"
  [ -d "$OUT" ] && mv "$OUT" "$OUT.old.$$"
  mv "$STAGE" "$OUT"
  echo "built: $OUT"
  du -sh "$OUT"/jni/* "$OUT"/libs
}

case "${1:-}" in
  build) build "${2:-}" ;;
  verify) verify ;;
  # on the build Mac: placeholders, import check and checksums again on the last build (no 30 minute rebuild)
  finish)
    W="${2:-$HOME/matter-spike}"; ndk_env "$W"
    finish "$W/couchtv-matter-out"
    echo "finished: $W/couchtv-matter-out"
    ;;
  remote|remote-finish)
    HOST="${2:?ssh host}"
    scp -q "$0" "$HOST:/tmp/couchtv-build-controller.sh"
    if [ "$1" = remote ]; then ssh "$HOST" "bash /tmp/couchtv-build-controller.sh build"
    else ssh "$HOST" "bash /tmp/couchtv-build-controller.sh finish"; fi
    mkdir -p "$DEST"
    # README.md and .gitattributes in $DEST are the repo's own; everything else comes from the build
    rsync -a --delete --exclude README.md --exclude .gitattributes "$HOST:matter-spike/couchtv-matter-out/" "$DEST/"
    verify
    ;;
  *) sed -n 2,20p "$0"; exit 2 ;;
esac
