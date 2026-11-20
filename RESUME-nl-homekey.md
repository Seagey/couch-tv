# RESUME nl-homekey (Make Home open Couch TV)

Worktree: tools/couch-tv/wt-nl-homekey, branch nl-homekey (base integrate-0.13.9). Rules: scratchpad/nolater-common.md.
Scratchpad below = the session scratchpad folder that holds nolater-common.md (session b061a7d7, under the private tmp claude folder).

## Done
- 265f08b: the feature (HomeKey.kt, HomeKeyRules.kt, setup screen, /api/homekey, setup.html, app.js About rows, i18n 16 blocks, mock.js ?homekey=, TD help article home-button).
- Round 2 (Fable NO-GO fixes, this WIP commit): `$` escaped in the install line (+ /bin/sh stub test, proven to fail without the fix); grep -qx Success; Fire OS 6 counts usage access as watching; Fire words when the link is blocked; start() check-and-set under synchronized(Update), "update_busy" said on screen; Use as home screen switched on only just before the install (and off again if it fails); Accessibility menu note everywhere (Kotlin, i18n all 16 blocks); Fire TV points to the help page; phone page has its own steps line (words_phone); setup screen button in its own row, dimmed not disabled; /api/homekey/start needs JSON content type; About row gives the real reason; DONE words hedged ("should ... press Home to check"). TD help/src/articles.mjs Fire TV step (backups: scratchpad/td-backup-nl-homekey and td-backup-nl-homekey-round2), help rebuilt.

## Test counts
- Kotlin testReleaseUnitTest: 135 tests, 0 failures (HomeKeyRulesTest 15). Run: `scratchpad/hk-gradle.sh testReleaseUnitTest` (takes the gradle lock).
- tests/test_homekey_browser.mjs: 185 checks passed in round 1; round 2 version NOT yet confirmed green at the time of this commit (was waiting on the browser lock). Run: take scratchpad/browser.lock, `COUCHTV_PLAYWRIGHT=".../tools/tv-designer/market" node tests/test_homekey_browser.mjs`, rmdir the lock.
- Also green in round 1: test_one_button_update_browser 29, test_phone_settings_browser 129, test_tcl_fixes_browser 26, i18n node tests (zh, arabic, polish, romanian), test_design_words, test_settings_key. Rerun after round 2.

## Left
1. Confirm round 2 browser test green; rerun the regression browser tests above.
2. Rebuild APKs: `scratchpad/hk-gradle.sh assembleRelease assembleWatch`, copy to scratchpad/hk-apks/plain22.apk and watch22.apk. plain21.apk (versionCode 21 test build of OUR code, same debug key as GitHub v0.13.8) must be rebuilt too: temporarily set versionCode 21 / versionName 0.13.8 in on-tv/android/app/build.gradle.kts, assembleRelease, copy, RESTORE the file (git diff must be empty).
3. Emulator proof, only when no other emulator runs (`adb devices`, `pgrep -fl qemu-system`) and load allows:
   `~/Library/Android/sdk/emulator/emulator -avd couchtv_gtv34 -port 5594 -read-only -no-window -no-audio -no-snapshot -no-boot-anim -memory 2048 -gpu swiftshader_indirect` (background), wait for `adb -s emulator-5594 shell getprop sys.boot_completed` = 1, then
   `node scratchpad/hk-emu.mjs emulator-5594 scratchpad/hk-apks scratchpad/hk-emu-out`. Always `-s emulator-5594` (real TVs are on this adb). Then `adb -s emulator-5594 emu kill`.
4. Commit (non-WIP) with counts, report to coordinator (commits, files, shared hunks, counts, what's not done).
