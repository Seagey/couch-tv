#!/bin/sh
# Writes dist/SHA256SUMS.txt for the TV apps in dist/, to upload with them to each GitHub release.
# couch-tv Setup checks every APK it downloads against this file AND against the SHA-256 GitHub
# itself records for each release file; if either is missing or they disagree, it installs nothing.
#
# In the release steps, after scripts/build-apk.sh and before `gh release create`:
#   sh scripts/release-checksums.sh
#   gh release create vX.Y dist/couch-tv-home.apk dist/couch-tv-ontv.apk dist/couch-tv-sync.apk dist/SHA256SUMS.txt ...
# For a release that is already out: gh release upload vX.Y dist/SHA256SUMS.txt
set -e
cd "$(dirname "$0")/../dist"
ls ./*.apk > /dev/null 2>&1 || { echo "No APKs in dist/. Build or download them first."; exit 1; }
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum ./*.apk | sed 's|  \./|  |' > SHA256SUMS.txt
else
  shasum -a 256 ./*.apk | sed 's|  \./|  |' > SHA256SUMS.txt
fi
cat SHA256SUMS.txt
