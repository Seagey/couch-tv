#!/bin/bash
# The release steps, in order, so no check can be skipped or run after the push (Fable review of
# nl-matter-packaging, 21 Nov 2026, items 4a to 4f, and the hardening review after it, M1 to M4, L1 to L3).
#
#   bash scripts/release.sh build   --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] [--version 0.13.9]
#   bash scripts/release.sh sums    --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] [--version 0.13.9]
#   bash scripts/release.sh publish --previous /abs/old/dist/couch-tv-ontv.apk [--signer SHA256] --version 0.13.9
#   bash scripts/release.sh play
#   bash scripts/release.sh setup   --version 0.13.9
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
# setup    the release check for couch-tv Setup: the published release must carry the three Setup zips and
#          SHA256SUMS-setup.txt, which the "Setup app" workflow (.github/workflows/setup-app.yml) builds and adds
#          when a release is published. publish ends with it. It waits for that workflow's run for the tag, runs
#          its failed jobs again when GitHub gave up on one (0.13.11 shipped without the zips because the Apple
#          silicon Mac job never got a runner, so the upload job was skipped), and exits 7 if the four files are
#          still not on the release. SETUP_WAIT (seconds between looks, default 30), SETUP_TIMEOUT (default 3600)
#          and SETUP_RERUNS (default 2) change how long it tries.
#          Then it signs SHA256SUMS-setup.txt with scripts/sign-setup-sums.py (the key stays at
#          ~/.couch-tv-signing/update-ed25519.pem; COUCHTV_SIGNING_KEY names another), checks the signature as an
#          installed helper does, uploads SHA256SUMS-setup.txt.sig and checks the release copy again; exit 8 if any
#          of that fails (installed helpers could then not check for updates).
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
# the on-TV app's own release key (0.13.11 on; also its Google Play app signing key): its two APKs are signed by
# scripts/sign-ontv.sh with the proof of rotation from CERT, so TVs on Android 9 and newer move to it and keep
# their settings, and Android 6 to 8 TVs still see CERT (coord/GOOGLE-PLAY-BUILD.md section 3a)
ONTV_CERT=fab6cebbd4958043be63273fbba15f34447d6169d309f0c8e3bd65ac58469556
SIGN_ONTV=${SIGN_ONTV:-$(cd "$(dirname "$0")" && pwd)/sign-ontv.sh}
FILES="couch-tv-home.apk couch-tv-ontv.apk couch-tv-ontv-watch.apk couch-tv-sync.apk couch-tv-samsung-setup.zip couch-tv-samsung.wgt"
REPO=${REPO:-Seagey/couch-tv}
REMOTE=${REMOTE:-origin}

usage() { sed -n '5,9p' "$0" | sed 's/^# //'; exit 2; }
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
case "$STEP" in build|sums|publish|play|setup) ;; *) usage ;; esac
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
[ "$STEP" = play ] || [ "$STEP" = setup ] || { case "$PREVIOUS" in
  /*) [ -f "$PREVIOUS" ] || { echo "--previous $PREVIOUS: no such file"; exit 2; } ;;
  "") echo "--previous is required: last release's couch-tv-ontv.apk, an absolute path"; exit 2 ;;
  *) echo "--previous must be an absolute path (the check runs from another folder): $PREVIOUS"; exit 2 ;;
esac; }
if [ -n "$VERSION" ]; then
  echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$' || { echo "--version must look like 0.13.9 (no v in front): $VERSION"; exit 2; }
fi
# couch-tv's own on-TV APKs rotate to ONTV_CERT from 0.13.11; a fork signs everything with its own --signer key,
# as before. ONTV_SIGN=0: signed with the debug key alone. It is the default for a --version before 0.13.11
# (0.13.10 is the one more release with the debug key alone: TVs on 0.13.9 and older refuse a rotated file in
# Update now, because their own check predates the rotation; coord/GOOGLE-PLAY-BUILD.md section 3a), so
# "publish --version 0.13.10" checks the files that "build" made without ONTV_SIGN set again.
ver_lt() { awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".")
  for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) exit 0; if (x[i] + 0 > y[i] + 0) exit 1 } exit 1 }'; }
ONTV_DEFAULT=1
[ -n "$VERSION" ] && ver_lt "$VERSION" 0.13.11 && ONTV_DEFAULT=0
ONTV=""
[ $OURS = 1 ] && [ "${ONTV_SIGN:-$ONTV_DEFAULT}" != 0 ] && ONTV=$ONTV_CERT
# 0.13.10 was the last release with the debug key alone: publishing 0.13.11 or later to Seagey/couch-tv with
# ONTV_SIGN=0 would put out on-TV APKs without the rotation the next update expects, so it stops here
if [ "$STEP" = publish ] && [ $OURS = 1 ] && [ "${ONTV_SIGN:-}" = 0 ] && [ -n "$VERSION" ] && ! ver_lt "$VERSION" 0.13.11; then
  echo "ONTV_SIGN=0 is refused for --version $VERSION on Seagey/couch-tv: from 0.13.11 the on-TV APKs carry the rotated key. Build and publish without ONTV_SIGN."; exit 2
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
  echo "=== waiting for the Setup app workflow to add couch-tv Setup to $tag"
  do_setup
}

# couch-tv Setup's files on every release (the website links releases/latest/download/couch-tv-Setup-*); Linux from 0.13.13
SETUP_FILES="couch-tv-Setup-mac-apple-silicon.zip couch-tv-Setup-mac-intel.zip couch-tv-Setup-windows.zip couch-tv-Setup-linux.tar.gz SHA256SUMS-setup.txt"
setup_missing() {  # <tag>: the Setup files the release does not have, one a line (all of them when it cannot be read)
  local have
  have=$(gh release view "$1" --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null) || have=""
  for f in $SETUP_FILES; do printf '%s\n' "$have" | grep -qxF "$f" || echo "$f"; done
}
# The helper only trusts an update when SHA256SUMS-setup.txt carries a signature made with a key that is not on GitHub
# (setup-app/couchtv_setup/helper/update.py). The key stays on this computer; this never prints it. It signs the very
# file that is on the release, checks the signature the way an installed helper does, uploads the .sig, then downloads
# both again and checks once more. Without the .sig on the release, installed helpers say "Could not check for updates".
SETUP_SUMS=SHA256SUMS-setup.txt
SETUP_ARCHIVES="couch-tv-Setup-mac-apple-silicon.zip couch-tv-Setup-mac-intel.zip couch-tv-Setup-windows.zip couch-tv-Setup-linux.tar.gz"
# Signing makes whatever is in the sums file trusted by every installed helper, so first: it lists exactly the four
# archives, each hash is the one GitHub itself reports for that asset (the digest), and the Setup app workflow run
# that built them ran on the commit the tag points at. Any doubt: nothing is signed.
check_setup_sums() {  # <tag> <sums file>; prints why and returns 1 when it must not be signed
  local tag=$1 file=$2 names digests tag_sha run_sha sha name got
  awk 'NF && (NF != 2 || $1 !~ /^[0-9a-f]{64}$/) { bad = 1 } END { exit bad }' "$file" \
    || { echo "NOT SIGNING: $SETUP_SUMS has a line that is not '<sha256>  <file name>'"; return 1; }
  names=$(awk 'NF { n = $2; sub(/^\*/, "", n); print n }' "$file" | sort)
  [ "$names" = "$(printf '%s\n' $SETUP_ARCHIVES | sort)" ] \
    || { echo "NOT SIGNING: $SETUP_SUMS must list exactly: $SETUP_ARCHIVES"; return 1; }
  digests=$(gh release view "$tag" --repo "$REPO" --json assets --jq '.assets[] | "\(.name) \(.digest)"') \
    || { echo "NOT SIGNING: could not read the digests of the assets on $tag"; return 1; }
  while read -r sha name; do
    name=${name#\*}
    got=$(printf '%s\n' "$digests" | awk -v n="$name" '$1 == n { print $2 }')
    [ "$got" = "sha256:$sha" ] || { echo "NOT SIGNING: $name is $sha in $SETUP_SUMS but GitHub reports '${got:-nothing}' for it"; return 1; }
  done < <(awk 'NF' "$file")
  tag_sha=$(gh api "repos/$REPO/commits/$tag" --jq .sha 2> /dev/null) || tag_sha=""
  run_sha=$(gh run list --repo "$REPO" --workflow setup-app.yml --event release --branch "$tag" --limit 1 \
    --json headSha --jq '.[0].headSha // empty' 2> /dev/null) || run_sha=""
  { [ -n "$tag_sha" ] && [ "$tag_sha" = "$run_sha" ]; } \
    || { echo "NOT SIGNING: the Setup app workflow run is on '${run_sha:-no run}', the tag $tag is on '${tag_sha:-unknown}'"; return 1; }
  echo "SETUP SUMS CHECKED on $tag: the four archives, GitHub's digests, and the workflow run on ${tag_sha:0:12}"
}
sign_setup_sums() {  # <tag>
  local tag=$1 key=${COUCHTV_SIGNING_KEY:-$HOME/.couch-tv-signing/update-ed25519.pem} dir="$DIST/setup-sign" f
  [ -f "$key" ] || { echo "The Setup signing key is not on this computer (COUCHTV_SIGNING_KEY or ~/.couch-tv-signing/update-ed25519.pem): not signing"; exit 8; }
  mkdir -p "$dir"
  for f in $SETUP_SUMS $SETUP_SUMS.sig; do [ -f "$dir/$f" ] && rm "$dir/$f"; done
  gh release download "$tag" --repo "$REPO" --pattern "$SETUP_SUMS" --dir "$dir" || { echo "Could not download $SETUP_SUMS from $tag"; exit 8; }
  check_setup_sums "$tag" "$dir/$SETUP_SUMS" || { rm -f "$dir/$SETUP_SUMS"; rmdir "$dir" 2> /dev/null; exit 8; }
  python3 "$ROOT/scripts/sign-setup-sums.py" "$dir/$SETUP_SUMS" "$tag" > /dev/null || { echo "SIGNING $SETUP_SUMS FAILED"; exit 8; }
  python3 "$ROOT/scripts/verify-setup-sig.py" "$dir/$SETUP_SUMS" "$dir/$SETUP_SUMS.sig" "$tag" || { echo "The new signature does not check against the public key in the app"; exit 8; }
  gh release upload "$tag" "$dir/$SETUP_SUMS.sig" --repo "$REPO" --clobber || { echo "Could not upload $SETUP_SUMS.sig to $tag"; exit 8; }
  # what is on the release now, not what is on this disk
  for f in $SETUP_SUMS $SETUP_SUMS.sig; do rm "$dir/$f"; done
  gh release download "$tag" --repo "$REPO" --pattern "$SETUP_SUMS" --pattern "$SETUP_SUMS.sig" --dir "$dir" || { echo "Could not download the signed files again"; exit 8; }
  python3 "$ROOT/scripts/verify-setup-sig.py" "$dir/$SETUP_SUMS" "$dir/$SETUP_SUMS.sig" "$tag" || { echo "The signature on $tag does not check"; exit 8; }
  for f in $SETUP_SUMS $SETUP_SUMS.sig; do rm "$dir/$f"; done
  rmdir "$dir"
  echo "SETUP SUMS SIGNED on $tag: $SETUP_SUMS.sig checked against the key in the app"
}
do_setup() {
  [ -n "$VERSION" ] || { echo "setup needs --version, for example --version 0.13.9"; exit 2; }
  local tag="v$VERSION" wait=${SETUP_WAIT:-30} limit=${SETUP_TIMEOUT:-3600} reruns=${SETUP_RERUNS:-2}
  local waited=0 done_reruns=0 missing run id status conclusion
  while :; do
    missing=$(setup_missing "$tag")
    [ -z "$missing" ] && { echo "SETUP FILES OK on $tag: $SETUP_FILES"; sign_setup_sums "$tag"; return 0; }
    # the Setup app workflow's run for this release (a release event runs on the tag)
    run=$(gh run list --repo "$REPO" --workflow setup-app.yml --event release --branch "$tag" --limit 1 \
      --json databaseId,status,conclusion --jq '.[0] | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null) || run=""
    read -r id status conclusion <<< "$run"
    if [ "${status:-}" = completed ]; then
      if [ "${conclusion:-}" != success ] && [ "$done_reruns" -lt "$reruns" ]; then
        # GitHub gave up on a job (0.13.11: the Apple silicon Mac job never got a runner) and so skipped the upload
        echo "Setup app run $id ended $conclusion: running its failed jobs again"
        gh run rerun "$id" --repo "$REPO" --failed || true
        done_reruns=$((done_reruns + 1))
        # give the rerun time to show as queued, so the next look does not spend another rerun on the old result
        sleep $((wait * 4)); waited=$((waited + wait * 4))
      elif [ "${conclusion:-}" = success ] || [ "$done_reruns" -ge "$reruns" ]; then
        # one more look: the upload may have landed between the two calls
        missing=$(setup_missing "$tag")
        [ -z "$missing" ] && { echo "SETUP FILES OK on $tag: $SETUP_FILES"; sign_setup_sums "$tag"; return 0; }
        echo "SETUP FILES MISSING on $tag after the Setup app run $id ($conclusion):" $missing
        echo "Run its failed jobs again (gh run rerun $id --failed), then: bash scripts/release.sh setup --version $VERSION"
        exit 7
      fi
    fi
    if [ "$waited" -ge "$limit" ]; then
      echo "SETUP FILES MISSING on $tag after ${limit}s:" $missing
      echo "When the Setup app workflow has run: bash scripts/release.sh setup --version $VERSION"
      exit 7
    fi
    sleep "$wait"; waited=$((waited + wait))
  done
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
  setup) do_setup ;;
esac
