# RESUME nl-remote

Branch nl-remote (worktree wt-nl-remote), from integrate-0.13.9, with nl-haqr merged in (87fca2b).
B1 (/ha/done key leak) is fixed on nl-haqr by another builder: do NOT fix it here, do not re-merge nl-haqr.
Commits take about 5 min (privacy-scan pre-commit hook). Delete on-tv/android/.kotlin/errors/*.log and
on-tv/android/.gradle/kotlin/errors/*.log first (Kotlin daemon logs; the hook refuses *.log files).

## Done and committed
- 4d7b3e0 pairing lock, 69fa688 phone remote, 472eddf plain words (earlier builder)
- 7de4aef WIP: phone pages in every language (phone-words.js, caps-words.js, Smart home rows)
- next WIP commit (21 Nov): the Fable NO-GO fixes below

## Fable NO-GO (coord/msgs-1120/0814_*), status
- B2 bridge lock DoS: DONE. bridge/server.py: no lock on /api/pair or VIDAA/Panasonic claim; Apple TV claim
  counts only while a code is live; comment updated. tests/test_pair_lock_bridge.py: 6 tests OK
  (`../repo/.venv/bin/python -m unittest discover -s tests -p "test_pair_lock*.py"`).
- M1 Auth.kt: DONE in code (`currentPin() ?: return null` before counting; PairLockTest.triesWithNoLiveCodeDoNotCount).
  NOT YET RUN: gradle on-tv testDebugUnitTest (gradle lock). CHECK: Auth.clock is now
  SystemClock.elapsedRealtime(); PairLockTest.tearDown no longer resets it (left as `{ now }`). In plain JVM
  tests elapsedRealtime is "not mocked" unless returnDefaultValues; build.gradle.kts has no such option, so
  any other test calling Auth without a fake clock may fail: run the suite; if so, reset Auth.clock in
  tearDown to a plain JVM clock ({ System.nanoTime() / 1_000_000 }). Also check Auth.kt:75 lastPairedAt =
  clock() is not compared with wall clock time anywhere (grep lastPairedAt).
- M2 bridge 429 retry_after + Retry-After header: DONE (ApiError retry_after; tested in test_pair_lock_bridge).
- M3 Server.kt /api/phone-link pairLocked() first: DONE. design.js Edit on your phone sheet asks
  hooks.phoneLink() every 20 s and redraws on change: DONE in code, no browser test yet.
- M4 err_adb_not_on new words (tv i18n en/zh-CN/pl, remote en/zh-CN/pl): DONE (test_wording_leftovers).
- Lows: "Wait {minutes} min" (bridge, Server.kt, tv+remote i18n, phone-words line + mock.js): DONE;
  monotonic clock (bridge time.monotonic, Auth elapsedRealtime): DONE; /api/pair/start pinForQr(minLeft=90): DONE;
  setup-app server.py passes the TV's 429 message (HTTPError branch): DONE, no test yet; err_invalid_pairing_key
  / err_pairing_key_required without "this phone" on the TV (en, zh-CN, pl): DONE (tested).
- tv-words.js scoped to #settings, .cw-sheet, .cw-tip, .cd-ask, .cd-escaped; never .cd-o or a typed .sv value
  (OWN_VALUES incl. Kept on this TV): DONE. 58 new tw_* keys in all 15 languages (Smart home paste key rows,
  Hue, At home intro, screen time, calendar errors, Updates (UPD_ONTV), design-code inbox messages,
  switched off banner, Hold OK menu note, Up to {n}, Where to: {place}, Updated to {v}): DONE
  (scratchpad of this session: nlr/tw_new.json + nlr/add_tw.py).
  New tests/test_tv_words_cover.mjs: every English line added since v0.13.8 in app.js/design.js/design-code.js
  has a tw_ line or is a phone error in phone-words.js (9 checks pass). Phone errors (designEdit, setApps,
  At home) added to phone-words.js (15 lines). tests/test_tv_words_browser.mjs extended (whole lines with
  gaps and tails, banner, .cd-o, isolates): NOT YET RUN (browser lock).
- Translations: de tw_keep_home/tw_check_first "Meinen Startbildschirm behalten": DONE; tw_type_code_phone
  fixed in de, pl, ar, he, nl, cs, sr, pt, tr, ro (es, it, fr, zh were right): DONE; ar/he isolates
  U+2066..U+2069 in tw_scan_widget, set_phone_pc, tw_ha_connected (and phone-words {host}): DONE
  (test_wording_leftovers 139 checks pass). Fable's checker chk-nlremote-bidi.mjs: NOT YET RUN (browser lock).

## Left, exact next steps
1. Run with the browser lock (mkdir .../b061a7d7-.../scratchpad/browser.lock, rmdir after):
   COUCHTV_PLAYWRIGHT=".../tools/reel-machine" node tests/test_tv_words_browser.mjs, test_phone_words_browser.mjs,
   test_phone_link_fresh_browser.mjs, and node .../scratchpad/chk-nlremote-bidi.mjs <worktree> <png>
   (both ar and he lines should say "address in order" and "code groups in order").
2. Gradle with the gradle lock: on-tv testDebugUnitTest (128 passed before), see the clock CHECK above.
3. Full node tests (all tests/test_*.js and non-browser .mjs; 67 passed before) and
   `../repo/.venv/bin/python -m unittest discover -s tests` (1355 OK before).
4. Not in scope, report to coordinator: widgets.js / widget-detail.js English lines (owned by ws2-* agents,
   about 80 lines); "Clear {label}" / "Use the design's {label}" and "{widget} now shows {place}." need the
   caps label words (caps-words.js); legacy English-only At home rows (pre 0.13.8).
5. Final commit (not WIP) and report with counts.
