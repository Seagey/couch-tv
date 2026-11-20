# RESUME nl-homekey (Make Home open Couch TV)

Worktree: tools/couch-tv/wt-nl-homekey, branch nl-homekey (base integrate-0.13.9). Rules: coord/nolater-common.md, coord/resume-builder-brief.md.
Scratchpad below = the shared scratchpad named in coord/resume-builder-brief.md (session b061a7d7, under the private tmp claude folder).

## Done
- 265f08b: the feature (HomeKey.kt, HomeKeyRules.kt, setup screen, /api/homekey, setup.html, app.js About rows, i18n 16 blocks, mock.js ?homekey=, TD help article home-button).
- 36dfe03 (round 2, Fable NO-GO 0736 fixes): all 9 items plus the low ones, each checked against the code on 21 Nov (round 3):
  1 `$` escaped (HomeKeyRules.installScript, /bin/sh stub test theShellLineHandsEveryNameOverWhole); 3 HomeKeyRules.watching for Fire OS 6;
  4 link() && !fireBlocked, STEPS_FIRE, app.js hk_steps_fire; 5 start() under synchronized(Update), update_busy on screen;
  6 setHomeEnabled just before put() (watch APK path keeps its own), switched off again on a failed install; 7 menu note in Kotlin, i18n 16 blocks, Fire TV step points to the help page, TD article;
  8 words_phone / STEPS_PHONE; 9 hkBtn in its own row, dimmed not disabled; low: grep -qx, /api/homekey/start 415 without JSON, hkErr real reasons, DONE hedged.
- Round 3 (21 Nov):
  - update_busy words were only true while Update checks; HomeKey.start also refuses while Update downloads or installs. Now "Couch TV is busy with an update right now. Press again in a moment." in Kotlin and all 16 i18n blocks (1c95b6f).
  - SetupWords.homeNote's two Google TV watch lines got the menu note "(on some TVs inside System or Device Preferences)" (Google TV keeps Accessibility under System); SetupWordsTest asserts it.
  - Emulator proof script fixed and kept in the repo as tests/emu_homekey.mjs (was scratchpad/hk-emu.mjs): the DONE words are hedged now; GitHub's 0.13.8 (what scenario A installs) has no /api/homekey, so its 404 answer means "the new version is up"; the home check now reads Android's HOME role holder (Google TV's resolve-activity always ranks launcherx first, priority 2, whatever the default is; checked by hand: set-home-activity says Success and the role moves to dev.couchtv.ontv), with a before check that Google TV holds the role first.

## Test counts (round 3, 21 Nov)
- Kotlin testReleaseUnitTest: 135 tests, 0 failures, 0 skipped (HomeKeyRulesTest 15, SetupWordsTest 14). Run: `scratchpad/hk-gradle.sh testReleaseUnitTest` (takes the gradle lock).
- Emulator proof (couchtv_gtv34, Android 14 Google TV, emulator-5594): 33 of 33 passed on the final APKs. Run: `node tests/emu_homekey.mjs emulator-5594 scratchpad/hk-apks <out dir>`.
- Node tests: zh, arabic, polish, romanian i18n, design_words, settings_key, custom_cards, headphones_ui, keep_watching_toggle, screensaver_early_resume, loop_look, start_focus, shelf_follows_app, weather_header, widget_caps (4548 checks): all pass.
- Browser: see the final commit message (scratchpad/hk-r3-browser.sh runs them under the browser lock).

## APKs (scratchpad/hk-apks, built 21 Nov from the final code)
plain22.apk (assembleRelease, 22/0.13.9), watch22.apk (assembleWatch), plain21.apk (versionCode 21 / 0.13.8 test build: build.gradle.kts edited, built, restored; git diff empty).

## Round 4 (21 Nov, 05:38 to 05:45): final checks, all on the final code
- Browser (under browser.lock, scratchpad/hk-r3-browser.log): test_homekey_browser 327 checks, test_one_button_update_browser 29, test_phone_settings_browser 129, test_tcl_fixes_browser 26: all pass.
- Kotlin testReleaseUnitTest: 135 tests, 0 failures, 0 errors, 0 skipped (HomeKeyRulesTest 15, SetupWordsTest 14); results from 05:27, after the last Kotlin edit (05:26), gradle up to date.
- Node: the 15 regression tests listed above all pass (widget_caps 4548 checks).
- Emulator proof 33 of 33 (05:29) on APKs built 05:27, after the last Kotlin edit. No emulator running now.

## Round 5 (21 Nov, 06:00 to 07:00): Fable NO-GO at ac9f9a0, all fixed
- Words cut off at the bottom of the TV: SetupActivity has one row under homeNote (hkQr, hkBtn GONE by default, hkLine weight 1 beside it, padding 14 on top); hkBtnRow gone; visibility on hkBtn itself; a failed press on the ready view shows the reason alone.
- Failed install proof: emulator scenario D (plain21, a folder at /data/local/tmp/couch-tv-homekey.apk so the copy fails after every check). HomeKey logs "home on for the install" and "home off again"; D checks the app's log runs in that order, home_on false, no Couch TV in Android's HOME list, still 21.
- Sticky busy words cleared in state() once Update is done; a blocked Fire TV gets no "adb" error in fail().
- The flag is in the "homekey" store (home_turned_on), not in memory; resume() uses HomeKeyRules.resumeStep (finish / clear / wait / undo). On the phone version it waits out the install window (INSTALL_WINDOW, 10 min), then switches Home off if that try switched it on. Unit tests: aRestartNeverLosesWhatThisTrySwitchedOn, theCodeKeepsTheFlagAndTheWordsTrue.
- AGENTS.md and on-tv/README.md: "0.13.9 or newer".
- The emulator proof now answers Google TV's "Set up Device Lock" prompt with Not now, brings a hidden "Allow USB debugging?" to the front (am task lock), and asks for the link again if the first ask goes unanswered (all of this happened on a cold boot).
- Counts: Kotlin 137 tests, 0 failures (HomeKeyRulesTest 17, SetupWordsTest 14); browser homekey 327, one button update 29, phone settings 129, TCL fixes 26 (scratchpad/hk-r5-browser.log); emulator 45 of 45, A to D (scratchpad/hk-emu-r5.log, shots in scratchpad/hk-emu-out-r5), on APKs built by scratchpad/hk-r5-apks.sh after the last Kotlin edit. Emulator stopped.

## Round 6 (21 Nov, 06:55 to 07:45): GO at 2258a15, two lows and two checks
- Slow install: put() answers "slow" (not "failed") when pm install has not answered in 5 minutes; the copy stays. HomeKeyRules.afterInstall("slow") = "wait": HomeKey.slow() keeps "installing" and home_turned_on, says "slow" (Kotlin errorWords and i18n hk_err_slow in all 16 blocks, app.js About row, mock ?homekey=slow), and runs resume() when INSTALL_WINDOW ends (finish if the watch APK starts, undo and "failed" if not). start() holds a second press while a slow install may still finish. Unit test aSlowInstallKeepsTheMarksAndHomeOn; browser test About row slow (2 checks).
- Steps view: the help page QR moved from the row under the buttons to the right of the top block (150 dp, the same as the phone's QR, so no taller); STEPS and STEPS_FIRE say "scan the code on the right for the steps". Emulator scenario S (plain22, no link): steps line bottom 1021, the code on screen at the right.
- Emulator proof: old pictures and results are deleted at the start; a picture that cannot be taken is a FAIL (5 tries, maxBuffer 64 MB: the home's picture is 1.7 MB, over Node's 1 MB default, which is why A-after-home was missing before); the setup screen is started again until the app is up (Android's removal of the old task killed the new process once); the pin is read again if the dump comes back empty; A polls every 250 ms.
- GitHub's API allows 60 calls an hour from this address, shared with other agents: an "error net" in A, C and D means that limit, not the code (`curl -s https://api.github.com/rate_limit`).
- Unit tests now write a real log: scratchpad/hk-r6-unit.sh writes scratchpad/hk-r6-unit.log (every class with counts, from the XML of that run).
- Counts: Kotlin 138 tests, 0 failures (HomeKeyRulesTest 18, SetupWordsTest 14); emulator 48 of 48, S and A to D (scratchpad/hk-emu-r6.log, pictures in scratchpad/hk-emu-out-r6, all from 07:32 to 07:35); 15 node tests pass (widget_caps 4548). Browser (scratchpad/hk-r6-browser.log, 07:59 to 08:01): homekey 344, one button update 29, phone settings 129, TCL fixes 26, all pass. Emulator stopped.

## Left
Nothing in scope. Release gate owned by the coordinator: the help page https://couchtv.joshuaseage.com/help/home-button/ must be deployed (Fable item 2).
