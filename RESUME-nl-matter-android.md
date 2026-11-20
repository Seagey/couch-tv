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

## Done 21 Nov (session 3) - branch finished
- c0c8672: Fable fixes committed; placeholder renamed libcouchtv_placeholder.so (remote-finish macbook run twice: same hashes, x86 87362615..., x86_64 ba2ce6fb...; verify 90 files; import check 241 imports per ARM ABI, API 24 missing none, API 23 missing freeifaddrs getifaddrs). devices JSON has `reason` (android_old / processor) when Matter can't run. Commission answers within 100 s (was 240 s: the contract wants 120 s).
- f06a036: merged nl-matter-packaging e3bebc1 (release check, release.sh).
- Unit: on-tv testDebugUnitTest 175 run, 0 failed, 1 skipped (MatterSupportTest 5).
- Release check (packaging's scripts/check-release-apks.py --matter --skip-signer) on this branch's couch-tv-home.apk 36.5 MB, couch-tv-ontv.apk 45.3 MB, couch-tv-ontv-watch.apk 45.3 MB: "release check ok". All three have lib/ for armeabi-v7a, arm64-v8a, x86, x86_64.
- CONTRACT (tests/matter_contract.py, nl-matter-fixtures 7ed915d) against the on-TV app on emulator matter34 (Android 14 arm64), --address fec0::2: **262 passed, 0 failed, 0 warnings, 262 checks, 300 s.** By group: auth 4, errors 25, commission 34, list 52, light 22, plug 13, thermostat 19, cover 13, fan 9, sensors 2, live 13, events 3, rename 6, forbidden 14, offline 2, remove 31. Every device back to 1 fabric after.
  - Ran on a private copy of the fixtures (~/ma-fixtures on the MacBook, made by scratchpad ma-mkfx.py: ports 5741-5748, other discriminators, own home controller), because the bridge builder's runs on the shared fixtures (5541-5548) overlapped mine twice (light "busy", 3 fabrics). Earlier runs 1-4 on the shared set are void for that reason.
  - Local one-line patch in the harness copy (scratchpad ma-matter_contract.py, Fixtures.fabrics): fx 7ed915d answers `fx fabrics <name>` as {name: {...}}, the harness reads ["fabrics"] and stops with KeyError at start. Tell the fixtures builder.
- Launcher (debug build) on matter34 through window.TVMATTER / CouchMatter.reply (scratchpad ma-cdp2.py): 9 passed, 0 failed (devices, commission a fresh own light, on, level 30, rename, list, unknown id 404, remove).
- Android 6 (AVD matter23, API 23 arm64, MacBook): release APK installs; devices = ready false, note "Matter needs Android 7 or newer on this TV.", reason android_old; commission = 400 error "unsupported"; events stream sends the same at once; libCHIPController.so is in the app's lib folder but not in the process maps (0): never loaded. 5 checks.
- Intel TV install: no Intel emulator on Apple silicon; proof is the APK listing above and the release check.

## Done 21 Nov (session 4): checker NO-GO at ae3e6c1, all 8 items
1. Backups: launcher backup_rules.xml and both sections of data_extraction_rules.xml leave out sharedpref chip.platform.KeyValueStore.xml, chip.platform.ConfigurationManager.xml and file matter/. on-TV manifest has dataExtractionRules (new res/xml/data_extraction_rules.xml: root, file, database, sharedpref, external out of cloud-backup and device-transfer). tests/test_matter_backup_rules.py: 4 pass (3 of 4 fail on the ae3e6c1 files). Built APKs: on-TV rules 10 excludes, launcher 5 + 10.
2. House rule: MatterModel.OPENS_HOUSE_WORDS = the bridge's 13 language list word for word (scratchpad ma-parity.py: 52 = 52, same; 58 names, 0 disagreements with bridge/matter.py 50ac34c). hiddenByName on cover, switch and on/off only light; domainOf checks the device's own name AND the custom one; CamelCase split, digits and underscores to spaces (GarageDoor, Garage2, MyGarage, Gate_1, Door1); cleanName drops control/format (bidi, zero width) characters, also on device names. rename: 404 unless the id is in devices(), refuses a name that would hide it (400, reason opens_house), @Synchronized.
3. primed(): on a node's first SubscriptionEstablished outside a commission, a node that shows nothing is left at once.
4. Pair calls wrapped (exception -> unreachable, plain note); address checked (MatterCode.address: number address, port 1 to 65535, bare fe80 refused) -> unreachable with reason address / port / link_local; leave() runCatching so the TV always forgets; Server.matter and MatterPage catch everything else -> 500 "Matter could not do that just now." reason failed.
5. Release (R8) launcher on matter34 via TVMATTER (ma-cdp2.py): 9 passed, 0 failed.
6. One deadline of 110 s for every stage; a second commission answers at once: error busy, reason busy.
7. rename as in 2.
8. devices reasons: android_old, processor, not_started, starting. Refused answers carry reason (not_found, not_allowed, bad_request, bad_name, opens_house, not_ready or the devices reason, not_answering, device_refused, failed). commission not_allowed has reason blocked; remove note has reason offline / not_answering.
Tests: on-TV unit 184 run, 0 failed, 1 skipped (new MatterOpensHouseTest 7, MatterAddressTest 3). Contract (nl-matter-fixtures 6b82489 harness, --no-lock, private ~/ma-fixtures refreshed from the new fx.py): 261 passed, 0 failed, 0 warnings, 261 checks (list 51: the stale test lamp is gone). Live probe (scratchpad ma-probe.py, on-TV app on matter34 with the fixtures plug): 16 passed, 0 failed (address reasons x3, busy at once, first answer 110 s, rename refusals x4 incl. Porte du garage and GarageDoor, cleanName, 404 reasons, remove). Release check ok on all three APKs.

## Left
Nothing in this branch. For others (in the final report):
- matter-ui: setup.html MT_ERR has no "unsupported"; MT_WHY has no "android_old" / "processor" (the note is English only).
- nl-matter-fixtures: harness Fixtures.fabrics vs fx fabrics output (above); shared fixtures have no lock between builders.

## Commands
- Gradle (shared lock): `bash scratchpad/ma-gradle.sh testDebugUnitTest assembleRelease` (launcher: scratchpad/ma-gradle-home.sh)
- APK to emulator: scp app/build/outputs/apk/release/app-release.apk macbook:/tmp/ma-light/ontv.apk; on the MacBook `~/matter-spike/sdk/platform-tools/adb -s emulator-5554 install -r /tmp/ma-light/ontv.apk`, `am start -n dev.couchtv.ontv/.SetupActivity`, `adb forward tcp:5400 tcp:5400`.
- Test client token: /tmp/ma-light/token on the MacBook.
- Tests (copies in scratchpad ma-*.py): `ssh macbook python3 /tmp/ma-light/e2e.py control|restart|remove`, `/tmp/ma-light/thermo.py`, `/tmp/ma-light/fixtures.py [names]` (revoke an open window first: `~/matter-fixtures/fx revoke <name>`).

## Running on the MacBook
Nothing: emulator matter34 stopped, own light (kvs6) stopped, private fixtures stopped (`~/ma-fixtures/fx up` starts them again, same storage; `~/matter-fixtures/fx` is the shared set). AVDs matter34 and matter23 kept.
