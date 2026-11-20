# RESUME nl-matter-packaging (21 Nov 2026, packaging fixer)

Task: "FOR THE PACKAGING FIXER" in coord/fable-1121-nl-matter-packaging.md (items 1, 5, 6, 7, 9, 10).
Do not edit nl-matter-android or the release scripts in coord/. Gradle lock for any gradle run. No TV.
Scratch for this work: shared scratchpad mp-fix/ (neg.sh, rc.sh, mut.py, unit.sh and their .log).

## Done (tested)
- 1 HIGH scripts/check-release-apks.py check_libs: an APK with any native library must have lib/ for
  armeabi-v7a, arm64-v8a, x86 and x86_64 ("native libraries inside but no lib/<abi> folder ...").
  Intel-only libraries with "placeholder" in the name are allowed (for nl-matter-android's item 1b:
  tell that builder to name its tiny Intel .so e.g. libcouchtv_placeholder.so).
- 5 MEDIUM check_plain_and_watch: aapt2 xmltree, couch-tv-ontv.apk must have 0 and
  couch-tv-ontv-watch.apk exactly 1 android:permission="...BIND_ACCESSIBILITY_SERVICE" (count_accessibility).
- 6 LOW check_sums verifies the SHA-256 of every listed file (Samsung files too). Also
  scripts/release-checksums.sh now adds couch-tv-samsung-setup.zip and couch-tv-samsung.wgt when in dist (6 lines).
- 7 LOW .github/workflows/build.yml runs `sh scripts/release-checksums.sh --matter` (YAML parses).
- Tests: python3 -I tests/test_release_apks.py -> 20 tests, OK (1 skipped: RealBuild).
  With COUCHTV_RELEASE_DIST=<scratchpad>/mp/dist COUCHTV_RELEASE_ARGS="--release --matter --signer 5b5ef392...2116"
  ANDROID_HOME=~/Library/Android/sdk: 20/20 OK.
  bash <scratchpad>/mp-fix/neg.sh (real APKs): 8 passed, 0 failed (swapped, two plain, two watch, real
  nl-matter-android launcher without Intel folders, wrong Samsung sum all fail; good + 6 line sums pass).
  bash <scratchpad>/mp-fix/rc.sh: release-checksums.sh writes 6 lines, check ok, shasum -c 6 OK.
  python3 -I <scratchpad>/mp-fix/mut.py <worktree>: 5/5 mutants killed.

## Written, NOT yet tested (next step)
- 10 LOW on-tv Update.kt: free space check now UpdateRules.spaceNeeded(size, Build.SUPPORTED_ABIS.firstOrNull())
  = 2.5 x file + unpacked libraries (arm64 15.7 MB, armv7 8.6 MB, x86_64 2.6 MB, x86 2.4 MB, unknown 15.7 MB;
  measured lib bytes from mp/apks/C.apk: 15,646,680 / 8,586,668 / 2,536,560 / 2,309,184).
  New test UpdateRulesTest.spaceCountsTheLibrariesAndroidUnpacks (UpdateRulesTest now 13 tests).
  NEXT: run `bash <scratchpad>/mp-fix/unit.sh` (takes the gradle lock, clean testDebugUnitTest, prints
  UpdateRulesTest per test and all counts); expect 13/13 UpdateRulesTest and 0 failures overall.

## Left
- Run unit.sh (above), record counts here, final non-WIP commit, report with STATUS line.
- 9: this file (done once counts are in).
- 8 is a merge note for the coordinator (tv-home build.gradle.kts conflicts with nl-haqr and nl-remote: keep both lines).
- Note for the commit hook: the privacy scan pre-commit hook ("your denylist" step) ran over 2 minutes.
