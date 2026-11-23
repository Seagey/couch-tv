#!/bin/bash
# The release steps, in order, so no check can be skipped or run after the push (Fable review of
# nl-matter-packaging, 21 Nov 2026, items 4a to 4f, and the hardening review after it, M1 to M4, L1 to L3).
#
#   bash scripts/release.sh build   --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] [--version 0.13.9]
#   bash scripts/release.sh sums    --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] [--version 0.13.9]
#   bash scripts/release.sh publish --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] --version 0.13.9
#   bash scripts/release.sh play
#
# build    from a clean, committed tree only: builds the four APKs (home, on-TV, on-TV watch, sync) one
#          gradle run at a time and the two Samsung files into dist/ (the two on-TV APKs signed by
#          scripts/sign-ontv.sh: the release key with the proof of rotation from CERT), writes the commit to
#          dist/BUILT-FROM, then does "sums" (4a, 4b, 4c). The home always carries config.example.json.
# sums     writes dist/SHA256SUMS.txt over exactly the 6 release files (4 APKs + 2 Samsung files, the
#          same 6 lines as v0.13.8) with shasum -a 256, then runs scripts/check-release-apks.py
#          --release --matter --signer ... --previous ... [--version ...]; any failure stops with exit 5.
#          Use this, not release-checksums.sh alone, which hashes whatever is in dist.
# publish  checks everything BEFORE anything leaves this computer (4d): the version's form, no tag of
#          that name here or on GitHub, gh signed in, a clean tree (untracked files too), dist built
#          from this very commit (BUILT-FROM), the 6 line SHA256SUMS.txt, shasum -a 256 -c, and the full
#          release check with --version (the version inside the APKs, a higher versionCode). Only then
#          the tag, one atomic push of main and the tag (both or neither), and the GitHub release with
#          the 6 files and SHA256SUMS.txt. BUILT-FROM holds the commit and the SHA-256 of SHA256SUMS.txt.
# play     from a clean, committed tree only: the Google Play App Bundle (bundlePlayRelease), signed with the
#          upload key by scripts/sign-ontv.sh, to dist-play/couch-tv-play.aab (with BUILT-FROM). Nothing is uploaded:
#          the owner uploads it in Play Console (coord/GOOGLE-PLAY-BUILD.md).
#
# Always checked against the key TVs already have (4e): --signer defaults to the couch-tv release
# certificate below and is always passed; for Seagey/couch-tv no other is accepted. --previous (last
# release's couch-tv-ontv.apk) is required and must be an absolute path (4f).
#
# Environment (optional): JAVA_HOME, ANDROID_HOME, GRADLE_LOCK (a folder taken with mkdir so only one
# gradle run happens at a time; default: none), SAMSUNG_PYTHON (python with samsung/build.py's
# packages; default python3), REPO (default Seagey/couch-tv), REMOTE (git remote, default origin).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/dist"
CERT=5b5ef39266a1b5bb2425ca8a0023003e895753630fffd4831efcf8c112372116
# the on-TV app's own release key (0.13.10 on; also its Google Play app signing key): its two APKs are signed by
# scripts/sign-ontv.sh with the proof of rotation from CERT, so TVs on Android 9 and newer move to it and keep
# their settings, and Android 6 to 8 TVs still see CERT (coord/GOOGLE-PLAY-BUILD.md section 3a)
ONTV_CERT=fab6cebbd4958043be63273fbba15f34447d6169d309f0c8e3bd65ac58469556
SIGN_ONTV=${SIGN_ONTV:-$(cd "$(dirname "$0")" && pwd)/sign-ontv.sh}
FILES="couch-tv-home.apk couch-tv-ontv.apk couch-tv-ontv-watch.apk couch-tv-sync.apk couch-tv-samsung-setup.zip couch-tv-samsung.wgt"
REPO=${REPO:-Seagey/couch-tv}
REMOTE=${REMOTE:-origin}

usage() { sed -n '5,8p' "$0" | sed 's/^# //'; exit 2; }
[ $# -ge 1 ] || usage
STEP=$1; shift
SIGNER=$CERT; PREVIOUS=""; VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --signer) [ $# -ge 2 ] || usage; SIGNER=$2; shift 2 ;;
    --previous) [ $# -ge 2 ] || usage; PREVIOUS=$2; shift 2 ;;
    --version) [ $# -ge 2 ] || usage; VERSION=$2; shift 2 ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done
case "$STEP" in build|sums|publish|play) ;; *) usage ;; esac
echo "$SIGNER" | grep -Eq '^[0-9a-f]{64}$' || { echo "--signer must be a SHA-256 (64 hex characters)"; exit 2; }
# L2: couch-tv's own releases take only its own certificate, however REPO is spelt and whatever the
# remote's name: also when the git remote points at Seagey/couch-tv
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
REMOTE_URL=$(git -C "$ROOT" remote get-url "$REMOTE" 2>/dev/null || true)
OURS=0
[ "$(lower "$REPO")" = seagey/couch-tv ] && OURS=1
case "$(lower "$REMOTE_URL")" in *seagey/couch-tv*) OURS=1 ;; esac
if [ $OURS = 1 ] && [ "$SIGNER" != "$CERT" ]; then
  echo "--signer must be couch-tv's own certificate ($CERT) for Seagey/couch-tv: TVs refuse any other"; exit 2
fi
# couch-tv's own on-TV APKs rotate to ONTV_CERT; a fork signs everything with its own --signer key, as before
# ONTV_SIGN=0: one more release signed with the debug key alone (TVs on 0.13.9 and older refuse a rotated
# file in Update now, because their own check predates the rotation; coord/GOOGLE-PLAY-BUILD.md section 3a)
ONTV=""
[ $OURS = 1 ] && [ "${ONTV_SIGN:-1}" != 0 ] && ONTV=$ONTV_CERT
[ "$STEP" = play ] || { case "$PREVIOUS" in
  /*) [ -f "$PREVIOUS" ] || { echo "--previous $PREVIOUS: no such file"; exit 2; } ;;
  "") echo "--previous is required: last release's couch-tv-ontv.apk, an absolute path"; exit 2 ;;
  *) echo "--previous must be an absolute path (the check runs from another folder): $PREVIOUS"; exit 2 ;;
esac; }
if [ -n "$VERSION" ]; then
  echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$' || { echo "--version must look like 0.13.9 (no v in front): $VERSION"; exit 2; }
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "/opt/android-sdk"; do
    [ -d "$d/platforms" ] && ANDROID_HOME=$d && break
  done
fi
export ANDROID_HOME

# the gradle lock is removed on any exit, but only when this run holds it (L3)
HOLD_LOCK=0
release_lock() { [ "$HOLD_LOCK" = 1 ] && rmdir "$GRADLE_LOCK" 2>/dev/null; HOLD_LOCK=0; return 0; }
trap release_lock EXIT

check() {  # the full release check on dist/; exit 5 when any rule is broken
  local v=()
  [ -n "$VERSION" ] && v=(--version "$VERSION")
  [ -n "$ONTV" ] && v=(--ontv-signer "$ONTV" ${v[@]+"${v[@]}"})
  python3 "$ROOT/scripts/check-release-apks.py" "$DIST" --release --matter --signer "$SIGNER" --previous "$PREVIOUS" ${v[@]+"${v[@]}"} \
    || { echo "RELEASE CHECK FAILED: nothing published"; exit 5; }
}

sums_ok() {  # exactly the 6 release files, in that order, each verified
  [ -f "$DIST/SHA256SUMS.txt" ] || { echo "SHA256SUMS.txt is missing: run sums"; exit 5; }
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
    HOLD_LOCK=1
  fi
  echo "=== gradle $dir: $*"
  "$ROOT/tv-home/android/gradlew" -p "$ROOT/$dir" --no-daemon -q "$@"; local rc=$?
  "$ROOT/tv-home/android/gradlew" -p "$ROOT/$dir" --stop >/dev/null 2>&1
  release_lock
  [ $rc -eq 0 ] || { echo "GRADLE FAILED in $dir (rc $rc)"; exit $rc; }
}

do_build() {
  # M3: dist is tied to one commit, so nothing uncommitted can end up in a release
  [ -z "$(git -C "$ROOT" status --short)" ] || { echo "uncommitted or untracked files: commit them first, build only from a clean tree"; exit 1; }
  local head
  head=$(git -C "$ROOT" rev-parse HEAD) || exit 1
  [ -n "${JAVA_HOME:-}" ] || { [ -x /usr/libexec/java_home ] && JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null); }
  [ -n "${JAVA_HOME:-}" ] || { echo "Set JAVA_HOME to a JDK 21"; exit 1; }
  export JAVA_HOME
  unset COUCHTV_KEYSTORE
  [ -f "$ROOT/remote/dist/index.html" ] || { echo "remote/dist is missing: build the phone remote first (cd remote; npm ci; npm run build)"; exit 1; }
  mkdir -p "$DIST"
  # 4a: a fresh build every time, so dist never holds files from before the last merge
  for f in $FILES SHA256SUMS.txt BUILT-FROM; do [ -f "$DIST/$f" ] && rm "$DIST/$f"; done
  # M4: every release home carries the example settings, never this computer's own config.json
  gradle_run tv-home/android clean assembleRelease "-PconfigJson=$ROOT/config.example.json"
  cp "$ROOT/tv-home/android/app/build/outputs/apk/release/app-release.apk" "$DIST/couch-tv-home.apk"
  gradle_run on-tv/android clean assembleGithubRelease assembleGithubWatch
  local out="$ROOT/on-tv/android/app/build/outputs/apk/github"
  if [ -n "$ONTV" ]; then
    # the release key and its passwords: only on the maintainer's signing Mac (~/.couchtv-keys, the login keychain)
    bash "$SIGN_ONTV" apk "$out/release/app-github-release.apk" "$DIST/couch-tv-ontv.apk" || { echo "SIGNING FAILED"; exit 6; }
    bash "$SIGN_ONTV" apk "$out/watch/app-github-watch.apk" "$DIST/couch-tv-ontv-watch.apk" || { echo "SIGNING FAILED"; exit 6; }
  else
    cp "$out/release/app-github-release.apk" "$DIST/couch-tv-ontv.apk"
    cp "$out/watch/app-github-watch.apk" "$DIST/couch-tv-ontv-watch.apk"
  fi
  gradle_run sync/android clean assembleRelease
  cp "$ROOT/sync/android/app/build/outputs/apk/release/app-release.apk" "$DIST/couch-tv-sync.apk"
  echo "=== samsung/build.py --release"
  "${SAMSUNG_PYTHON:-python3}" "$ROOT/samsung/build.py" --release || { echo "SAMSUNG BUILD FAILED"; exit 4; }
  cp "$ROOT/build/samsung/couch-tv-samsung.wgt" "$DIST/couch-tv-samsung.wgt"
  cp "$ROOT/build/samsung/couch-tv-samsung-setup.zip" "$DIST/couch-tv-samsung-setup.zip"
  echo "$head" > "$DIST/BUILT-FROM"
  echo "BUILD DONE from $head"
  do_sums
  # the second line ties dist to these very files: a file swapped in later (and sums run again) no
  # longer matches what this build checked
  sums_sha >> "$DIST/BUILT-FROM"
}

sums_sha() { shasum -a 256 "$DIST/SHA256SUMS.txt" | awk '{print $1}'; }

do_publish() {
  [ -n "$VERSION" ] || { echo "publish needs --version, for example --version 0.13.9"; exit 2; }
  local tag="v$VERSION"
  local notes="$ROOT/RELEASE-NOTES-$VERSION.md"
  [ -f "$notes" ] || { echo "$notes is missing"; exit 1; }
  # 4d, M1, M3: every check first, while nothing has left this computer
  [ -z "$(git -C "$ROOT" status --short)" ] || { echo "uncommitted or untracked files: stop"; exit 1; }
  [ -f "$DIST/BUILT-FROM" ] && [ "$(sed -n 1p "$DIST/BUILT-FROM")" = "$(git -C "$ROOT" rev-parse HEAD)" ] \
    || { echo "dist was not built from this commit: run build again"; exit 1; }
  sums_ok
  [ "$(sed -n 2p "$DIST/BUILT-FROM")" = "$(sums_sha)" ] \
    || { echo "dist holds files that build did not make (SHA256SUMS.txt changed since build): run build again"; exit 1; }
  check
  if git -C "$ROOT" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then echo "tag $tag already exists here: stop"; exit 1; fi
  git -C "$ROOT" fetch -q "$REMOTE" || exit 1
  local remote_tags
  remote_tags=$(git -C "$ROOT" ls-remote --tags "$REMOTE" "refs/tags/$tag") || { echo "cannot list $REMOTE's tags: stop"; exit 1; }
  [ -z "$remote_tags" ] || { echo "tag $tag is already on $REMOTE: stop"; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "gh is not signed in (gh auth login): stop before pushing anything"; exit 1; }
  git -C "$ROOT" merge-base --is-ancestor "$REMOTE/main" HEAD || { echo "main moved: stop"; exit 1; }
  echo "=== every check passed; publishing $tag to $REPO"
  # main and the tag go up together or not at all (--atomic); a refused push takes the local tag back
  git -C "$ROOT" tag -a "$tag" -m "couch-tv $VERSION" || exit 1
  git -C "$ROOT" push --atomic "$REMOTE" HEAD:main "refs/tags/$tag" || { git -C "$ROOT" tag -d "$tag"; exit 1; }
  (cd "$DIST" && gh release create "$tag" --repo "$REPO" --title "couch-tv $VERSION" --notes-file "$notes" --verify-tag \
    $FILES SHA256SUMS.txt) || exit 1
  gh release view "$tag" --repo "$REPO" --json url,assets --jq '.url, (.assets | length)'
}

do_play() {
  [ -z "$(git -C "$ROOT" status --short)" ] || { echo "uncommitted or untracked files: commit them first, build only from a clean tree"; exit 1; }
  [ -n "${JAVA_HOME:-}" ] || { [ -x /usr/libexec/java_home ] && JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null); }
  [ -n "${JAVA_HOME:-}" ] || { echo "Set JAVA_HOME to a JDK 21"; exit 1; }
  export JAVA_HOME
  unset COUCHTV_KEYSTORE
  [ -f "$ROOT/remote/dist/index.html" ] || { echo "remote/dist is missing: build the phone remote first (cd remote; npm ci; npm run build)"; exit 1; }
  local out="$ROOT/dist-play"
  mkdir -p "$out"
  for f in couch-tv-play.aab BUILT-FROM; do [ -f "$out/$f" ] && rm "$out/$f"; done
  gradle_run on-tv/android clean bundlePlayRelease
  bash "$SIGN_ONTV" aab "$ROOT/on-tv/android/app/build/outputs/bundle/playRelease/app-play-release.aab" "$out/couch-tv-play.aab" || { echo "SIGNING FAILED"; exit 6; }
  git -C "$ROOT" rev-parse HEAD > "$out/BUILT-FROM"
  echo "PLAY BUNDLE DONE: $out/couch-tv-play.aab"
}

case "$STEP" in
  build) do_build ;;
  play) do_play ;;
  sums) do_sums ;;
  publish) do_publish ;;
esac
