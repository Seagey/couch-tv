# Resume: nl-matter-discovery (builder "matter-discovery", supports nl-matter-android)

Brief: scratchpad nolater-common.md and matter-contract.md (Changes item 9: Matter.resolverFactory and Matter.threadRouteCheck hooks).

## Done
- Commit f9a97f2: pure discovery module in on-tv/android/app/src/main/java/dev/couchtv/ontv/matter/
  DiscoveryDns.kt (DNS/mDNS reader+writer), DiscoveryModel.kt (records to devices, border routers),
  DiscoveryMdns.kt (java.net sockets: one-shot unicast + 5353 multicast listener), Discovery.kt
  (MatterDiscovery: discover, findCommissionable, resolveOperational, resolveInstance, canReach,
  routeSnapshot, diagnose; NsdManager beside our mDNS, multicast lock), DiscoveryRoutes.kt (routes,
  Thread diagnosis in plain words), DiscoveryJson.kt.
- Tests (src/test/.../matter): DiscoveryDnsTest 13, DiscoveryRoutesTest 13, DiscoveryLiveTest 1 (skipped unless MATTER_LIVE=1).
  Fixtures src/test/resources/matter/*.txt: real captured packets, scrubbed to documentation values (same byte lengths).
- Live run on the real LAN (a computer on the network, MATTER_LIVE=1 MATTER_LIVE_NODE=7A11 MATTER_LIVE_DISCRIMINATOR=3333): passed, 187 packets, 0 bad.
- WIP commit: Node.txt field; DiscoveryChipResolver.kt (chip.platform.ServiceResolver with IPv6 fallback + install()).
  It needs nl-matter-android's jars and Matter.kt, so this branch alone no longer compiles. Compiled and all
  tests passed (164 run, 1 skipped) in a combined copy: scratchpad md-combo (matter-android's staged tree + these files).

- Emulator check DONE (on-tv/android/tools/matter-discovery-check/DevCheck.java, run with app_process, no app):
  a fake responder replays the fixtures; the emulators also heard the real LAN.
  Android 6 (couchtv_api23): 5353 listener bound, 354 packets, 0 bad, 26 devices, 4 border routers.
  Android 14 (couchtv_gtv34): 5353 shared with the system mDNS, 277 packets, 0 bad, 20 devices, 4 border routers.
  How: javac (JDK 21, --release 17) DevCheck.java against the Discovery*.class files and kotlin-stdlib 2.0.21, then
  `d8 --min-api 23` to classes.dex; `adb -s <emu> push` it and the fixtures to /data/local/tmp; then
  `adb -s <emu> shell CLASSPATH=/data/local/tmp/md.dex app_process /system/bin DevCheck /data/local/tmp/<fixture>.txt ...`.
  Emulator port must be in 5555..5585 (not 5584: another agent's).

## Left
1. Hand matter-android: add `DiscoveryChipResolver.install(this)` in App.onCreate before Matter.init (their file).
2. Report to coordinator.

## Commands
- Tests: `bash <scratchpad>/md-gradle.sh testDebugUnitTest --tests 'dev.couchtv.ontv.matter.*'` (takes the gradle lock).
  Works only for commit f9a97f2 alone; with DiscoveryChipResolver.kt use `<scratchpad>/md-combo-gradle.sh testDebugUnitTest` after re-syncing md-combo.
