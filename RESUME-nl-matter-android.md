# Resume: nl-matter-android (builder "matter-android")

Read first: scratchpad nolater-common.md and matter-contract.md (Changes 1 to 10 are mine).
Worktree: tools/couch-tv/wt-nl-matter-android, branch nl-matter-android (base integrate-0.13.9, nl-matter-packaging merged in).

## Done
- Controller library: scripts/matter/build-controller.sh (connectedhomeip v1.6.1.0, NDK 28.2). `scripts/matter/build-controller.sh remote macbook` builds on the MacBook (~/matter-spike) and copies to on-tv/android/matter/ (jni/<abi>/*.so stripped, libs/*.jar incl. CHIPInteractionModelSlim.jar, assets/matter-paa/*.der 77 roots, SHA256SUMS 88 files, VERSION). `... verify` checks checksums.
- on-tv app: on-tv/android/app/src/main/java/dev/couchtv/ontv/matter/{Matter,MatterModel,MatterCode,MatterStore,MatterResolver}.kt; Server.kt /api/matter/* (devices, commission, command, rename, remove, events SSE); App.kt calls Matter.init; build.gradle.kts jniLibs/assets srcDir + jars.
- Launcher (tv-home/android): MatterPage.kt = window.TVMATTER.request(id, method, path, body) -> CouchMatter.reply(id, jsonString); shares the on-tv matter sources, jars, .so and PAA assets via srcDir; R8 keep rules; multicast permission. Builds (release 36.5 MB). Not yet run on an emulator.
- Unit tests: on-tv suite 142 pass (Matter: Model 11, Code 4, Store 3).
- Emulator (MacBook, avd matter34, Android 14 arm64), on-TV app release build:
  - own light (port 5671): control 15/15, restart 3/3, offline 76 s -> unavailable, back in 5 s
  - own thermostat (port 5681): 9/9
  - matter-fixtures share flow (fx share = Google Home "share"): plug 6/6, cover by hand (IPv6 [fec0::2]:5544; the cover app has no IPv4) position 40 -> device 6000, close, remove 3 -> 2, fan 6/6, sensors 4 endpoints with device classes, lock and alarm: TV joins, lists nothing and leaves again (fabrics 1 -> 1)

## Fixed on the way (keep)
- continueCommissioning and subscribe must run off the Matter thread (io executor) or they hang.
- Resolver fallback must pass a non-null host name and text map (null crashed in strncpy).
- Wait for SubscriptionEstablished (priming done) before deciding what a new device is.
- A device with nothing the TV shows (lock, alarm, garage): the TV leaves it again at once.
- Error 0x7E at SendNOC = already on the TV -> key "already".
- Fan speed above 0 on a fan with OnOff: On first, then PercentSetting.

## Left (next steps)
1. Commit (privacy hook takes about 3 minutes).
2. Launcher runtime check on the emulator (debug build, WebView devtools, call TVMATTER.request).
3. Final report to the coordinator.

## Commands
- Gradle (shared lock): `bash scratchpad/ma-gradle.sh testDebugUnitTest assembleRelease` (launcher: scratchpad/ma-gradle-home.sh)
- APK to emulator: scp app/build/outputs/apk/release/app-release.apk macbook:/tmp/ma-light/ontv.apk; on the MacBook `~/matter-spike/sdk/platform-tools/adb -s emulator-5554 install -r /tmp/ma-light/ontv.apk`, `am start -n dev.couchtv.ontv/.SetupActivity`, `adb forward tcp:5400 tcp:5400`.
- Test client token: /tmp/ma-light/token on the MacBook.
- Tests (copies in scratchpad ma-*.py): `ssh macbook python3 /tmp/ma-light/e2e.py control|restart|remove`, `/tmp/ma-light/thermo.py`, `/tmp/ma-light/fixtures.py [names]` (revoke an open window first: `~/matter-fixtures/fx revoke <name>`).

## Running on the MacBook (stop when done)
- Emulator: avd matter34 (pid /tmp/ma-light/emu.pid). Stop: `adb -s emulator-5554 emu kill`.
- Own light: pid /tmp/ma-light/pid (KVS /tmp/ma-light/kvs5, port 5671, code 30054912331), on the TV as matter:5:1.
- Never touch other agents' devices except through fx share/revoke (fixtures 5541-5548, others 5641, 5651).
