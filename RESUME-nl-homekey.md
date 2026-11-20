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

## Left
Nothing in scope. Release gate owned by the coordinator: the help page https://couchtv.joshuaseage.com/help/home-button/ must be deployed (Fable item 2).
