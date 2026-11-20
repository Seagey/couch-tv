#!/bin/bash
# The release steps, in order, so no check can be skipped or run after the push (Fable review of
# nl-matter-packaging, 21 Nov 2026, items 4a to 4f).
#
#   bash scripts/release.sh build   --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256]
#   bash scripts/release.sh sums    --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256]
#   bash scripts/release.sh publish --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] --version 0.13.9
#
# build    builds the four APKs (home, on-TV, on-TV watch, sync) one gradle run at a time and the two
#          Samsung files into dist/, then does "sums" (4a, 4b, 4c).
# sums     writes dist/SHA256SUMS.txt over exactly the 6 release files (4 APKs + 2 Samsung files, the
#          same 6 lines as v0.13.8) with shasum -a 256, then runs scripts/check-release-apks.py
#          --release --matter --signer ... --previous ...; any failure stops with exit 5. Use this, not
#          release-checksums.sh alone, which hashes whatever is in dist.
# publish  checks again BEFORE anything leaves this computer (4d): a clean, committed tree, the 6 line
#          SHA256SUMS.txt, shasum -a 256 -c, and the full release check. Only then git push, the tag,
#          and the GitHub release with the 6 files and SHA256SUMS.txt.
#
# Always checked against the key TVs already have (4e): --signer defaults to the couch-tv release certificate
# below and is always passed; --previous (last release's couch-tv-ontv.apk) is required and must be an
# absolute path (4f), because the check runs from another folder.
#
# Environment (optional): JAVA_HOME, ANDROID_HOME, GRADLE_LOCK (a folder taken with mkdir so only one
# gradle run happens at a time; default: none), SAMSUNG_PYTHON (python with samsung/build.py's
# packages; default python3), CONFIG (built into the home, default config.example.json),
# REPO (default Seagey/couch-tv), REMOTE (git remote, default origin).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/dist"
CERT=5b5ef39266a1b5bb2425ca8a0023003e895753630fffd4831efcf8c112372116
FILES="couch-tv-home.apk couch-tv-ontv.apk couch-tv-ontv-watch.apk couch-tv-sync.apk couch-tv-samsung-setup.zip couch-tv-samsung.wgt"

usage() { sed -n '5,7p' "$0" | sed 's/^# //'; exit 2; }
[ $# -ge 1 ] || usage
STEP=$1; shift
SIGNER=$CERT; PREVIOUS=""; VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --signer) SIGNER=${2:-}; shift 2 ;;
    --previous) PREVIOUS=${2:-}; shift 2 ;;
    --version) VERSION=${2:-}; shift 2 ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done
case "$STEP" in build|sums|publish) ;; *) usage ;; esac
echo "$SIGNER" | grep -Eq '^[0-9a-f]{64}$' || { echo "--signer must be a SHA-256 (64 hex characters)"; exit 2; }
case "$PREVIOUS" in
  /*) [ -f "$PREVIOUS" ] || { echo "--previous $PREVIOUS: no such file"; exit 2; } ;;
  "") echo "--previous is required: last release's couch-tv-ontv.apk, an absolute path"; exit 2 ;;
  *) echo "--previous must be an absolute path (the check runs from another folder): $PREVIOUS"; exit 2 ;;
esac

if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "/opt/android-sdk"; do
    [ -d "$d/platforms" ] && ANDROID_HOME=$d && break
  done
fi
export ANDROID_HOME

check() {  # the full release check on dist/; exit 5 when any rule is broken
  python3 "$ROOT/scripts/check-release-apks.py" "$DIST" --release --matter --signer "$SIGNER" --previous "$PREVIOUS" \
    || { echo "RELEASE CHECK FAILED: nothing published"; exit 5; }
}

sums_ok() {  # exactly the 6 release files, in that order, each verified
  [ "$(wc -l < "$DIST/SHA256SUMS.txt" | tr -d ' ')" = 6 ] || { echo "SHA256SUMS.txt must have 6 lines"; exit 5; }
  local want got
  want=$(echo $FILES | tr ' ' '\n')
  got=$(awk '{print $2}' "$DIST/SHA256SUMS.txt" | sed 's/^\*//')
  [ "$want" = "$got" ] || { echo "SHA256SUMS.txt must list exactly: $FILES"; exit 5; }
  (cd "$DIST" && shasum -a 256 -c SHA256SUMS.txt) || { echo "SHA256SUMS.txt does not match dist: nothing published"; exit 5; }
}

do_sums() {
  for f in $FILES; do [ -f "$DIST/$f" ] || { echo "$f is missing from $DIST"; exit 5; }; done
  (cd "$DIST" && shasum -a 256 $FILES > SHA256SUMS.txt) || exit 5
  cat "$DIST/SHA256SUMS.txt"
  sums_ok
  check
  echo "SUMS AND CHECK OK: $DIST"
}

gradle_run() {  # <project dir> <tasks...>
  local dir="$1"; shift
  local tries=0
  if [ -n "${GRADLE_LOCK:-}" ]; then
    until mkdir "$GRADLE_LOCK" 2>/dev/null; do
      tries=$((tries+1)); [ $tries -gt 60 ] && { echo "gradle lock still held after 60 min"; exit 3; }
      echo "gradle lock held, waiting 60 s"; sleep 60
    done
  fi
  echo "=== gradle $dir: $*"
  "$ROOT/tv-home/android/gradlew" -p "$ROOT/$dir" --no-daemon -q "$@"; local rc=$?
  "$ROOT/tv-home/android/gradlew" -p "$ROOT/$dir" --stop >/dev/null 2>&1
  [ -n "${GRADLE_LOCK:-}" ] && rmdir "$GRADLE_LOCK"
  [ $rc -eq 0 ] || { echo "GRADLE FAILED in $dir (rc $rc)"; exit $rc; }
}

do_build() {
  [ -n "${JAVA_HOME:-}" ] || { [ -x /usr/libexec/java_home ] && JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null); }
  [ -n "${JAVA_HOME:-}" ] || { echo "Set JAVA_HOME to a JDK 21"; exit 1; }
  export JAVA_HOME
  unset COUCHTV_KEYSTORE
  [ -f "$ROOT/remote/dist/index.html" ] || { echo "remote/dist is missing: build the phone remote first (cd remote; npm ci; npm run build)"; exit 1; }
  mkdir -p "$DIST"
  # 4a: a fresh build every time, so dist never holds files from before the last merge
  for f in $FILES SHA256SUMS.txt; do [ -f "$DIST/$f" ] && rm "$DIST/$f"; done
  gradle_run tv-home/android clean assembleRelease "-PconfigJson=${CONFIG:-$ROOT/config.example.json}"
  cp "$ROOT/tv-home/android/app/build/outputs/apk/release/app-release.apk" "$DIST/couch-tv-home.apk"
  gradle_run on-tv/android clean assembleRelease assembleWatch
  cp "$ROOT/on-tv/android/app/build/outputs/apk/release/app-release.apk" "$DIST/couch-tv-ontv.apk"
  cp "$ROOT/on-tv/android/app/build/outputs/apk/watch/app-watch.apk" "$DIST/couch-tv-ontv-watch.apk"
  gradle_run sync/android clean assembleRelease
  cp "$ROOT/sync/android/app/build/outputs/apk/release/app-release.apk" "$DIST/couch-tv-sync.apk"
  echo "=== samsung/build.py --release"
  "${SAMSUNG_PYTHON:-python3}" "$ROOT/samsung/build.py" --release || { echo "SAMSUNG BUILD FAILED"; exit 4; }
  cp "$ROOT/build/samsung/couch-tv-samsung.wgt" "$DIST/couch-tv-samsung.wgt"
  cp "$ROOT/build/samsung/couch-tv-samsung-setup.zip" "$DIST/couch-tv-samsung-setup.zip"
  echo "BUILD DONE"
  do_sums
}

do_publish() {
  [ -n "$VERSION" ] || { echo "publish needs --version, for example --version 0.13.9"; exit 2; }
  local repo=${REPO:-Seagey/couch-tv} remote=${REMOTE:-origin} tag="v$VERSION"
  local notes="$ROOT/RELEASE-NOTES-$VERSION.md"
  [ -f "$notes" ] || { echo "$notes is missing"; exit 1; }
  # 4d: every check first, while nothing has left this computer
  [ -z "$(git -C "$ROOT" status --short --untracked-files=no)" ] || { echo "uncommitted changes: stop"; exit 1; }
  sums_ok
  check
  git -C "$ROOT" fetch -q "$remote" || exit 1
  git -C "$ROOT" merge-base --is-ancestor "$remote/main" HEAD || { echo "main moved: stop"; exit 1; }
  echo "=== every check passed; publishing $tag to $repo"
  git -C "$ROOT" push "$remote" HEAD:main || exit 1
  git -C "$ROOT" tag -a "$tag" -m "couch-tv $VERSION" || exit 1
  git -C "$ROOT" push "$remote" "$tag" || exit 1
  (cd "$DIST" && gh release create "$tag" --repo "$repo" --title "couch-tv $VERSION" --notes-file "$notes" --verify-tag \
    $FILES SHA256SUMS.txt) || exit 1
  gh release view "$tag" --repo "$repo" --json url,assets --jq '.url, (.assets | length)'
}

case "$STEP" in
  build) do_build ;;
  sums) do_sums ;;
  publish) do_publish ;;
esac
