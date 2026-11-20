#!/bin/bash
# Builds the Matter controller library for the on-TV Android app, from connectedhomeip (Apache 2.0),
# and writes it to on-tv/android/matter/ with checksums. Reproducible: one pinned tag, one NDK.
#
# Runs on a Mac with Python 3, git and about 40 GB free (the full build is ~30 minutes on an M5).
#   scripts/matter/build-controller.sh build   [workdir]   # on the build Mac: clone, bootstrap, build, package
#   scripts/matter/build-controller.sh remote  <ssh-host>  # from the repo: run "build" on <ssh-host>, copy the result back, verify
#   scripts/matter/build-controller.sh verify              # check on-tv/android/matter/ against its SHA256SUMS
#
# What lands in on-tv/android/matter/ (docs in on-tv/android/matter/README.md):
#   jni/<abi>/libCHIPController.so, jni/<abi>/libc++_shared.so   stripped, armeabi-v7a and arm64-v8a
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
  # the exact source commit and NDK, and a sorted checksum list
  printf '%s\n' "connectedhomeip $TAG $(git -C "$C" rev-parse HEAD)" "ndk $NDK_VERSION" > "$STAGE/VERSION"
  (cd "$STAGE" && find . -type f ! -name SHA256SUMS | sed 's#^\./##' | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS)
  [ -d "$OUT" ] && mv "$OUT" "$OUT.old.$$"
  mv "$STAGE" "$OUT"
  echo "built: $OUT"
  du -sh "$OUT"/jni/* "$OUT"/libs
}

case "${1:-}" in
  build) build "${2:-}" ;;
  verify) verify ;;
  remote)
    HOST="${2:?ssh host}"
    scp -q "$0" "$HOST:/tmp/couchtv-build-controller.sh"
    ssh "$HOST" "bash /tmp/couchtv-build-controller.sh build"
    mkdir -p "$DEST"
    # README.md and .gitattributes in $DEST are the repo's own; everything else comes from the build
    rsync -a --delete --exclude README.md --exclude .gitattributes "$HOST:matter-spike/couchtv-matter-out/" "$DEST/"
    verify
    ;;
  *) sed -n 2,20p "$0"; exit 2 ;;
esac
