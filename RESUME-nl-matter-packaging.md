# RESUME nl-matter-packaging (21 Nov 2026, packaging fixer): DONE (Fable GO on e3bebc1, then hardening M1-M4, L1-L6)

Task: "FOR THE PACKAGING FIXER" in coord/fable-1121-nl-matter-packaging.md (items 1, 5, 6, 7, 9, 10), plus
the coordinator's release items 4a to 4f written into scripts/release.sh, plus the coordinator's hardening
list after the Fable GO (M1 to M4, L1 to L6). No TV touched. Nothing pushed.
Scratch for this work: shared scratchpad mp-fix/ (neg.sh, rc.sh, rr.sh, mut.py, mut-release.py, unit.sh,
strip-intel.py, fakes/ and their .log).

## Done (each tested)
- 1 HIGH scripts/check-release-apks.py check_libs: an APK with any native library must have lib/ for
  armeabi-v7a, arm64-v8a, x86 and x86_64. A library only in the Intel folders is allowed when it is a
  placeholder: 4096 bytes or less (PLACEHOLDER_MAX), decided by size, not name. nl-matter-android's real
  launcher (built 21 Nov 05:43) ships lib/x86/libmatternone.so 1,300 bytes and lib/x86_64 1,880 bytes:
  it passes; the same APK with its Intel folders stripped fails ("no lib/x86 folder").
- 5 MEDIUM check_plain_and_watch: aapt2 xmltree, couch-tv-ontv.apk 0 and couch-tv-ontv-watch.apk exactly 1
  android:permission=BIND_ACCESSIBILITY_SERVICE.
- 6 LOW check_sums verifies the SHA-256 of every listed file (Samsung files too). release-checksums.sh
  adds the 2 Samsung files when in dist (6 lines) and points at scripts/release.sh.
- 7 LOW .github/workflows/build.yml: `sh scripts/release-checksums.sh --matter`, and runs
  tests/test_release_script.py (YAML parses). CI with --matter is red until nl-matter-android merges.
- 10 LOW on-tv Update.kt: free space = UpdateRules.spaceNeeded(size, Build.SUPPORTED_ABIS.firstOrNull())
  = 2.5 x file + unpacked libraries (arm64 15.7 MB, armv7 8.6 MB, x86_64 2.6 MB, x86 2.4 MB, unknown 15.7 MB).
- 4a-f scripts/release.sh (build | sums | publish), see its header.
- 9 this file.

## Hardening after the Fable GO (coordinator, 21 Nov), each with a test and a mutant
- M1 publish stops before any push on: a version not like 0.13 or 0.13.9, the tag here, the tag on the
  remote (git ls-remote --tags), gh not signed in.
- M2 check-release-apks.py --version: versionName of couch-tv-home.apk and couch-tv-ontv.apk must equal it;
  with --previous the on-TV versionCode must be higher. release.sh passes --version (always on publish).
- M3 build only from a clean tree (untracked files too), writes dist/BUILT-FROM (HEAD); publish stops
  unless BUILT-FROM equals HEAD ("dist was not built from this commit: run build again"); untracked files
  stop publish too.
- M4 the home is always built with -PconfigJson=$ROOT/config.example.json (CONFIG is no longer read).
- L1 a flag with no value stops (exit 2) instead of looping. L2 for Seagey/couch-tv only the pinned
  certificate is accepted as --signer. L3 an EXIT trap removes the gradle lock only when this run holds it.
- L4 any lib/<abi>/ file not named lib* fails; PLACEHOLDER_MAX = 4096. L5 an APK (or --previous) that does
  not verify is a listed error, not a traceback. L6 on-TV per processor unpacked limits = the
  UpdateRules.kt figures (the test reads them from the Kotlin source).

## Last three (checker GO on 04c33ce), each with tests and mutants
- 1 No partial release: the tag is made first, then ONE `git push --atomic <remote> HEAD:main refs/tags/vX`
  (main and the tag both or neither); a refused push deletes the local tag (`git tag -d`) and stops
  before gh release create.
- 2 The certificate pin: REPO compared case-insensitively with seagey/couch-tv, and also applied when
  `git remote get-url $REMOTE` contains seagey/couch-tv (any case).
- 3 BUILT-FROM line 2 = SHA-256 of SHA256SUMS.txt after build's own sums; publish compares it, so a file
  swapped in after build (and sums run again) stops publish (exit 1).

## Test counts (21 Nov, after the last change)
- python3 -I tests/test_release_apks.py: 29 tests OK (1 skipped: RealBuild). With
  COUCHTV_RELEASE_DIST=<scratchpad>/mp/dist, COUCHTV_RELEASE_ARGS of --release --matter --signer 5b5ef392...2116
  --version 0.13.9 --previous '<abs>/wt-release-0138/dist/couch-tv-ontv.apk' (quoted: shlex) and
  ANDROID_HOME=~/Library/Android/sdk: 29/29 OK. With --version 0.13.10 RealBuild fails, as it must.
- python3 -I tests/test_release_script.py: 33 tests OK (stand-in check, gradlew, Samsung build, git, gh:
  nothing leaves).
- bash <scratchpad>/mp-fix/neg.sh (real APKs): 9 passed, 0 failed.
- bash <scratchpad>/mp-fix/rr.sh (release.sh on real APKs, real check, fake git/gh): 18 passed, 0 failed
  (good build: 6 lines, shasum -c, then tag, one atomic push, gh release create; publish as 0.13.10 exit 5;
  --previous with the same versionCode exit 5; BUILT-FROM of another commit exit 1; the 0.13.8 on-TV APK
  swapped in after build exit 1; wt-release-0139/dist without Matter: sums exit 5, publish exit 1;
  swapped on-TV files exit 5; relative --previous exit 2; 0 pushes on every stop).
- bash <scratchpad>/mp-fix/rc.sh: release-checksums.sh 6 lines, check ok, shasum -c 6 OK.
- python3 -I <scratchpad>/mp-fix/mut.py <worktree>: 14/14 mutants killed (check script).
- python3 -I <scratchpad>/mp-fix/mut-release.py <worktree>: 29/29 mutants killed (release.sh).
- bash <scratchpad>/mp-fix/unit.sh (gradle lock, clean testDebugUnitTest, on-tv): UpdateRulesTest 13/13,
  all 125 tests, 0 failures, 0 errors.

## Notes for the coordinator
- 8: tv-home/android/app/build.gradle.kts conflicts with nl-haqr and nl-remote (each adds a line after
  kotlinOptions): keep both.
- At rebuild, from the merged release worktree (committed and clean, untracked files too):
  `GRADLE_LOCK=<scratchpad>/gradle.lock SAMSUNG_PYTHON=<wt-release-0138>/.venv/bin/python bash scripts/release.sh build --previous <abs>/wt-release-0138/dist/couch-tv-ontv.apk --version 0.13.9`
  then `bash scripts/release.sh publish --previous <same> --version 0.13.9` (publish only with the owner's yes).
  remote/dist must exist before build (it says so and stops if not).
- The current wt-release-0139/dist fails the check (no Matter, stored libraries): it must be rebuilt (4a).
