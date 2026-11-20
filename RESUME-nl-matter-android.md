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

## Done 21 Nov (session 2)
- 9b159ec: previous builder's WIP checked and committed (not_allowed like the bridge, contact `reading`, resolver null fix).
- 99c0f86: merged nl-matter-discovery (f9a97f2, 6fece19); `DiscoveryChipResolver.install(this)` before Matter.init in on-tv App.kt AND launcher App.kt.
- Fable findings (coord/fable-1121-nl-matter-packaging.md, "FOR nl-matter-android"), all three done, WIP commit after 99c0f86:
  1b. scripts/matter/build-controller.sh builds jni/x86 and jni/x86_64 libmatternone.so (empty, reproducible: same hashes twice), in SHA256SUMS (90 files, verify ok). New mode `remote-finish macbook` (placeholders + import check + sums on the last build, no rebuild).
  2. MatterSupport.kt: SDK < 24 never loads, note "Matter needs Android 7 or newer on this TV."; build-controller.sh import_check (API 23 missing: freeifaddrs getifaddrs; API 24 missing: none, both ABIs, 241 imports). Commission when unsupported: error "unsupported" (new key; tell matter-ui).
  3. ready = MatterSupport.ready(...): false whenever unsupported (decided at init: SDK_INT >= 24 && nativeLibraryDir/libCHIPController.so is a file).
- Unit: on-tv testDebugUnitTest 173 run, 0 failed, 1 skipped (DiscoveryLiveTest); MatterSupportTest 4, Discovery 27.
- on-TV release APK 45.26 MB: lib/ has all four ABIs (x86 + x86_64 libmatternone.so).
- Emulator matter34 (Android 14 arm64) with this APK: ready true (lib found); remove of the stale unreachable matter:5:1 -> ok + note (forgot); commission while light window closed -> "expired"; light restarted (kvs6), commission -> matter:26:1 in 4 s; e2e control 15/15.

## Done 21 Nov (session 3)
- Placeholder renamed to libcouchtv_placeholder.so (nl-matter-packaging's check-release-apks.py only lets an Intel-only library through if its name has "placeholder"). Rebuilt with `remote-finish macbook` twice: same hashes (x86 8736261540..., x86_64 ba2ce6fbcd...), verify 90 files.
- devices JSON has `reason` ("android_old" / "processor") when Matter can't run, so the screens can word it in their own language (MatterSupportTest 5).
- Commission answers within 100 s (was 240 s): the contract wants 120 s for a code no device answers to (discovery never ends by itself on the emulator).
- Unit: on-tv testDebugUnitTest 174 run, 0 failed, 1 skipped.
- Launcher debug + release built with the merge (release 36.5 MB); both have lib/ for all four ABIs.
- Contract run 1 (tests/matter_contract.py from nl-matter-fixtures 91def35, on the MacBook, --address fec0::2): 29 pass, 5 fail: the no-device code took 180 s (fixed above), and fx share light was refused "busy" because the bridge builder (mb-nlb bridge/server.py) was running its own contract run on the same fixtures at that moment. Rerun when the fixtures are free: scratchpad ma-fxfree.sh (copied to /tmp/ma-light/fxfree.sh) waits for that.

## Left (next steps)
1. Commit (the pre-commit privacy scan takes 10+ min; no private addresses and no system image folder names in committed text).
2. Install the newest on-TV release APK on matter34, run the contract when ma-fxfree.sh says FREE:
   `ssh macbook 'cd /tmp/ma-light; python3 matter_contract.py --api http://127.0.0.1:5400 --token "$(cat token)" --address fec0::2 --fx "$HOME/matter-fixtures/fx" --report contract2.json > contract2.log 2>&1'`
3. Launcher on matter34: install debug, start it, forward devtools, `python3 scratchpad/ma-cdp2.py <port> <code> <address>` (code from `fx share plug`, address [fec0::2]:5542).
4. Android 6 runtime check (API 23 arm64 image in the matter-spike SDK): stop matter34, make an AVD, install the on-TV APK, devices says ready false + reason android_old, commission says unsupported. Then stop it.
5. Merge nl-matter-packaging (cb75398 or newer) and run scripts/check-release-apks.py on the APKs.
6. Tell matter-ui (via the report): setup.html MT_ERR has no "unsupported", and MT_WHY has no "android_old"/"processor".
7. Stop the MacBook emulator and own light. Final report.

## Commands
- Gradle (shared lock): `bash scratchpad/ma-gradle.sh testDebugUnitTest assembleRelease` (launcher: scratchpad/ma-gradle-home.sh)
- APK to emulator: scp app/build/outputs/apk/release/app-release.apk macbook:/tmp/ma-light/ontv.apk; on the MacBook `~/matter-spike/sdk/platform-tools/adb -s emulator-5554 install -r /tmp/ma-light/ontv.apk`, `am start -n dev.couchtv.ontv/.SetupActivity`, `adb forward tcp:5400 tcp:5400`.
- Test client token: /tmp/ma-light/token on the MacBook.
- Tests (copies in scratchpad ma-*.py): `ssh macbook python3 /tmp/ma-light/e2e.py control|restart|remove`, `/tmp/ma-light/thermo.py`, `/tmp/ma-light/fixtures.py [names]` (revoke an open window first: `~/matter-fixtures/fx revoke <name>`).

## Running on the MacBook (stop when done)
- Emulator: avd matter34 (pid /tmp/ma-light/emu.pid). Stop: `adb -s emulator-5554 emu kill`.
- Own light: pid /tmp/ma-light/pid (now 41161; KVS /tmp/ma-light/kvs6, port 5671, discriminator 3301, passcode 20202021, code 30054912331), on the on-TV app as matter:26:1 (named "Lounge lamp"). kvs5 is no longer used.
- Never touch other agents' devices except through fx share/revoke (fixtures 5541-5548, others 5641, 5651).
