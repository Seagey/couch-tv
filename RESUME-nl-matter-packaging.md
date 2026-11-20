# RESUME nl-matter-packaging (21 Nov 2026, packaging fixer): DONE

Task: "FOR THE PACKAGING FIXER" in coord/fable-1121-nl-matter-packaging.md (items 1, 5, 6, 7, 9, 10), plus
the coordinator's release items 4a to 4f written into scripts/release.sh. No TV touched. Nothing pushed.
Scratch for this work: shared scratchpad mp-fix/ (neg.sh, rc.sh, rr.sh, mut.py, mut-release.py, unit.sh,
strip-intel.py and their .log).

## Done (each tested)
- 1 HIGH scripts/check-release-apks.py check_libs: an APK with any native library must have lib/ for
  armeabi-v7a, arm64-v8a, x86 and x86_64. A library only in the Intel folders is allowed when it is a
  placeholder: 16 KB or less (PLACEHOLDER_MAX), decided by size, not name. nl-matter-android's real
  launcher (built 21 Nov 05:43) ships lib/x86/libmatternone.so 1,300 bytes and lib/x86_64 1,880 bytes:
  it now passes; the same APK with its Intel folders stripped fails ("no lib/x86 folder").
- 5 MEDIUM check_plain_and_watch: aapt2 xmltree, couch-tv-ontv.apk 0 and couch-tv-ontv-watch.apk exactly 1
  android:permission=BIND_ACCESSIBILITY_SERVICE.
- 6 LOW check_sums verifies the SHA-256 of every listed file (Samsung files too). release-checksums.sh
  adds the 2 Samsung files when in dist (6 lines) and points at scripts/release.sh.
- 7 LOW .github/workflows/build.yml: `sh scripts/release-checksums.sh --matter`, and runs
  tests/test_release_script.py (YAML parses).
- 10 LOW on-tv Update.kt: free space = UpdateRules.spaceNeeded(size, Build.SUPPORTED_ABIS.firstOrNull())
  = 2.5 x file + unpacked libraries (arm64 15.7 MB, armv7 8.6 MB, x86_64 2.6 MB, x86 2.4 MB, unknown 15.7 MB).
- 4a-f scripts/release.sh (build | sums | publish): build = 3 gradle runs (optional GRADLE_LOCK) + Samsung,
  old dist files removed first (4a); sums = shasum -a 256 over exactly the 6 release files, 6 lines, then
  check-release-apks.py --release --matter --signer <key, default 5b5ef392...2116> --previous <absolute,
  required> || exit 5 (4b, 4c, 4e, 4f); publish = clean tree, 6 line sums of exactly those files,
  shasum -c, full check, all BEFORE git push / tag / gh release create (4d).
- 9 this file.

## Test counts (21 Nov, after the last change)
- python3 -I tests/test_release_apks.py: 21 tests OK (1 skipped: RealBuild). With
  COUCHTV_RELEASE_DIST=<scratchpad>/mp/dist COUCHTV_RELEASE_ARGS="--release --matter --signer 5b5ef392...2116"
  ANDROID_HOME=~/Library/Android/sdk: 21/21 OK.
- python3 -I tests/test_release_script.py: 15 tests OK (stand-in check, fake git and gh: nothing leaves).
- bash <scratchpad>/mp-fix/neg.sh (real APKs): 9 passed, 0 failed.
- bash <scratchpad>/mp-fix/rr.sh (release.sh on real APKs, real check, fake git/gh): 10 passed, 0 failed
  (good Matter build: sums 6 lines + shasum -c + publish reaches push after check; wt-release-0139/dist
  without Matter: sums and publish exit 5, 0 pushes; swapped on-TV files exit 5; relative --previous exit 2).
- bash <scratchpad>/mp-fix/rc.sh: release-checksums.sh 6 lines, check ok, shasum -c 6 OK.
- python3 -I <scratchpad>/mp-fix/mut.py <worktree>: 5/5 mutants killed (check script).
- python3 -I <scratchpad>/mp-fix/mut-release.py <worktree>: 7/7 mutants killed (release.sh).
- bash <scratchpad>/mp-fix/unit.sh (gradle lock, clean testDebugUnitTest, on-tv): UpdateRulesTest 13/13,
  all 125 tests, 0 failures, 0 errors.

## Notes for the coordinator
- 8: tv-home/android/app/build.gradle.kts conflicts with nl-haqr and nl-remote (each adds a line after
  kotlinOptions): keep both.
- At rebuild run, from the merged release worktree:
  `GRADLE_LOCK=<scratchpad>/gradle.lock SAMSUNG_PYTHON=<wt-release-0138>/.venv/bin/python bash scripts/release.sh build --previous <abs>/wt-release-0138/dist/couch-tv-ontv.apk`
  then `bash scripts/release.sh publish --previous <same> --version 0.13.9` (publish only with the owner's yes).
  remote/dist must exist before build (it says so and stops if not).
- The current wt-release-0139/dist fails the check (no Matter, stored libraries): it must be rebuilt (4a).
