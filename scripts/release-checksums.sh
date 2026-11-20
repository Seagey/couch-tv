#!/bin/sh
# Writes dist/SHA256SUMS.txt for the TV apps in dist/, to upload with them to each GitHub release.
# couch-tv Setup checks every APK it downloads against this file AND against the SHA-256 GitHub
# itself records for each release file; if either is missing or they disagree, it installs nothing.
#
# For a real release use scripts/release.sh (build, sums, publish): it hashes exactly the 6 release
# files, always checks with --matter and the TVs' key, and checks again before anything is pushed.
# In the release steps, after scripts/build-apk.sh and before `gh release create`:
#   sh scripts/release-checksums.sh
#   gh release create vX.Y dist/couch-tv-home.apk dist/couch-tv-ontv.apk dist/couch-tv-ontv-watch.apk dist/couch-tv-sync.apk dist/SHA256SUMS.txt ...
# For a release that is already out: gh release upload vX.Y dist/SHA256SUMS.txt
#
# Then it runs scripts/check-release-apks.py --release (the same names, one APK per app with every
# processor inside, compressed native libraries, one signer) and fails if any rule is broken. Extra
# arguments go to that check, for example: sh scripts/release-checksums.sh --matter --signer <sha256> --previous /abs/old.apk
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/../dist"
ls ./*.apk > /dev/null 2>&1 || { echo "No APKs in dist/. Build or download them first."; exit 1; }
# the Samsung files too when they are here (0.13.8 published 6 lines: 4 APKs and these 2), so Setup can
# check them; the check below verifies every line
SAMSUNG=""
for f in couch-tv-samsung-setup.zip couch-tv-samsung.wgt; do [ -f "$f" ] && SAMSUNG="$SAMSUNG ./$f"; done
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum ./*.apk $SAMSUNG | sed 's|  \./|  |' > SHA256SUMS.txt
else
  shasum -a 256 ./*.apk $SAMSUNG | sed 's|  \./|  |' > SHA256SUMS.txt
fi
cat SHA256SUMS.txt
python3 "$HERE/check-release-apks.py" . --release "$@"
