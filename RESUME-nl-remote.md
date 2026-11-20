# RESUME nl-remote

Branch nl-remote (worktree wt-nl-remote), from integrate-0.13.9, with nl-haqr merged in at 87fca2b.
Commits take about 5 min (privacy-scan pre-commit hook). Delete on-tv/android/.kotlin/errors/*.log and
on-tv/android/.gradle/kotlin/errors/*.log first (Kotlin daemon logs; the hook refuses *.log files). The hook
also refuses private 192.168 addresses in any file: tests use 192.0.2.x.

## Commits
- 4d7b3e0 pairing lock, 69fa688 phone remote, 472eddf plain words (earlier builder)
- 7de4aef WIP: phone pages in every language (coord 0747 and 0748: phone-words.js for on-tv/web/setup.html and
  ha-phone.html, caps-words.js as the shared widget settings word table, Smart home rows in tv i18n)
- 6ce5e20 WIP: the Fable NO-GO fixes (coord 0814), previous builder's work
- c473fce WIP: Auth.lastPairedAt back on the wall clock (SetupActivity subtracts it from currentTimeMillis;
  the lock clock is elapsedRealtime), setup-app test for the TV's 429 words (3 tests), design settings browser
  test for the Edit on your phone QR asking again every 20 s (3 checks)
- final commit: this file

## Fable NO-GO (coord/msgs-1120/0814), all done
- B1 /ha/done key leak: belongs to nl-haqr (fixed there). NOT merged here: see "Left".
- B2 bridge lock DoS: no lock on /api/pair or the VIDAA/Panasonic claim; Apple TV claim counts only while a
  code is live. tests/test_pair_lock_bridge.py.
- M1 Auth.pair: no live code returns null before counting (PairLockTest.triesWithNoLiveCodeDoNotCount).
- M2 bridge 429: retry_after field and Retry-After header.
- M3 Server.kt /api/phone-link: pairLocked() first; design.js Edit on your phone sheet asks again every 20 s
  (test_design_settings_browser.mjs: new code drawn, locked hides the QR).
- M4 err_adb_not_on words (tv and remote i18n). Lows: "Wait {minutes} min", monotonic lock clocks,
  /api/pair/start pinForQr(minLeft = 90), setup-app passes the TV's 429 message (setup-app/tests/test_server.py
  RemoteCode), err_invalid_pairing_key / err_pairing_key_required without "this phone" on the TV.
- tv-words.js scoped (#settings, .cw-sheet, .cw-tip, .cd-ask, .cd-escaped), 58 new tw_* keys in 15 languages,
  tests/test_tv_words_cover.mjs, translations fixed (de, tw_type_code_phone, ar/he isolates).

## Test counts, 21 Nov (HEAD c473fce plus this file)
- python `../repo/.venv/bin/python -m unittest discover -s tests`: 1365 run, 58 skipped, 1 error =
  tests/test_ha_real_bridge.py (nl-haqr's file) calls sys.exit(0) at import when HA_E2E_URL is not set, which
  discover counts as an import error. Every other test passes. Not changed here (nl-haqr owns it).
- setup-app (`setupvenv314/bin/python -m unittest discover -s tests` in setup-app, the scratchpad venv): 103 OK.
- node, every tests/test_*.js and .mjs without Playwright: 67 files pass, 0 fail.
- browser, all 26 Playwright files (scratchpad nlr-run-browser.sh, under the browser lock): 26 pass, 0 fail
  (tv words 32, phone words 21, phone link fresh 9, design settings 110, ws_tv 1115, widget detail 295, ...).
- gradle on-tv testDebugUnitTest (scratchpad chk-nlremote-gradle.sh, gradle lock): 167 tests, 0 failures, 1 skipped.
- Fable's bidi checker (scratchpad nlr-bidi-run.sh, browser lock): ar and he, sheet line and computer line, 4 of 4 "address in order; code groups in order 482 913".

## Left
1. Re-merge nl-haqr when it lands (coordinator's word). On 21 Nov its tip was a0d4474, still WIP. A trial
   `git merge-tree --write-tree HEAD nl-haqr` shows 16 conflicting files, because nl-haqr merged nl-phonepage,
   which carries older cherry-picked copies of this branch's commits (95a4432, 1457050, 73fac94): bridge/server.py,
   haphone.py, Auth.kt, Server.kt, PairLockTest.kt, setup.html, remote i18n, test_pair_lock_bridge.py,
   test_tv_words_browser.mjs, test_wording_leftovers.mjs, app.js, design.js, i18n.js, index.html, mock.js,
   tv-words.js. For the lock files take this branch's side (it has the Fable fixes); merge setup.html, app.js,
   haphone.py by hand (nl-phonepage's launcher server). Then rerun every count above.
2. Outside this branch's scope, for the coordinator: widgets.js / widget-detail.js English lines (ws2-* agents,
   about 80); "Clear {label}", "Use the design's {label}", "{widget} now shows {place}." wait for caps-words.js
   lines once widget-caps.js labels settle (node scripts/caps-words-todo.mjs lists them).
