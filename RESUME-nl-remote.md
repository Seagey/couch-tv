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
- 1b32b3b nl-remote: Fable 0814 done; resume notes
- next commit (21 Nov, second Fable NO-GO at 1b32b3b, items 2 to 5, and the coordinator's two pairing holes): see "Round 2"

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

## Round 2 (second Fable NO-GO at 1b32b3b, items 2 to 5, plus the coordinator's two pairing holes), all done
- Pairing rules, the same as nl-phonepage's phonepage.py and PhoneAuth.kt (Auth.kt, Server.kt):
  a code dies after 5 different wrong tries; the same wrong code again from one address is refused without
  counting (per code set of (address, code)); one address may make 5 different wrong tries in 10 minutes, then
  it gets 429 "Wait N min" and nobody else does; 15 in 10 minutes across all addresses lock everyone (so 3+
  addresses); an address is its IPv4 or IPv6 /64; at most 1000 addresses kept. /api/pair and /api/pair/start
  check the caller's address; /api/phone-link (the TV's own QR) only the lock for everyone.
  Setup screen: New phone code = Auth.resetLocks() + newPin(); while locked for everyone it shows "Too many wrong
  codes. Pairing opens again in N min" and "press New phone code", never a code that would be refused.
  Tests: PairLockTest 13 (theSameWrongCodeSixTimesFromOneAddressLeavesTheLiveCodeWorking,
  oneAddressIsLimitedAfterFiveDifferentWrongCodes, wrongTriesFromThreeAddressesLockPairingForEveryone, IPv6 /64,
  1000 addresses, New phone code opens every lock), SetupWordsTest +1.
- Bridge Apple TV claim (bridge/server.py): the same rules (5 per address with repeats not counted, 15 for
  everyone, IPv6 /64, 1000 addresses). tests/test_pair_lock_bridge.py 11. The bridge's phone page
  pair_start/pair_with_code is not in this tree (nl-phonepage's phonepage.py has its own rules).
- caps-words.js filled: 130 lines in 14 languages (es-MX where Mexico differs) + 28 that read the same
  (years, news services, competitions) in `same`; scripts/caps-words-todo.mjs counts `same`: 0 of 158 left.
  Generator kept in the scratchpad: nlr-caps-gen.mjs <worktree>. test_phone_words.mjs checks every line, every
  language, no dashes, no markup, sentence case, same gaps (25 checks).
- err_pairing_locked and err_adb_not_on in every TV block (15 incl. en; es-MX takes es) and every phone remote
  block (10; es-MX takes es). Script: scratchpad nlr-add-err.mjs.
- shim.js (the on-TV pairing box): every line and the TV's answers through phone-words.js. Server.kt index()
  adds `<script src="/tv/phone-words.js" data-manual>` before shim.js; data-manual = table only, nothing swapped
  on the remote's screen (PhoneWords.inLang); language = the remote's tv.lang, else tv.lang.tv, else the phone's.
  New phone-words line "Pairing…". tests/test_shim_words_browser.mjs.
- de tw_escaped, tw_add_list_in and tw_screen_old say "Startbildschirm-Einstellungen".

## Round 2 test counts, 21 Nov (the round 2 commit)
- gradle on-tv `testDebugUnitTest --rerun` (scratchpad nlr-gradle.sh, gradle lock): 173 tests, 0 failures,
  1 skipped (PairLockTest 13, SetupWordsTest 15).
- python `../repo/.venv/bin/python -m unittest discover -s tests`: 1370 run, 58 skipped, the same 1 error
  (nl-haqr's test_ha_real_bridge.py sys.exit at import); tests/test_pair_lock_bridge.py alone: 11 OK.
- setup-app (scratchpad setupvenv314, `-m unittest discover -s tests` in setup-app): 103 OK.
- node without Playwright (scratchpad nlr-run-tests.sh): 67 files pass, 0 fail (phone words 25, wording
  leftovers 139, tv words cover 9, widget caps 4548).
- browser (scratchpad nlr-run-browser.sh, browser lock): shim words 14 (new), tv words 32, phone words 21,
  phone settings 129, remote phone page 10, phone link fresh 9, phone settings stale 12: 7 of 7 pass.

## Round 1 test counts, 21 Nov (HEAD c473fce plus this file)
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
1. Do NOT merge nl-haqr into this branch (coordinator, 21 Nov). The coordinator merges at integration in
   the safe order: nl-phonepage and nl-haqr (f32179c) first, then nl-remote. Merging nl-haqr straight in here
   silently brings B2's lock back in bridge/server.py (h_pair and the VIDAA claim). For the record: a trial
   `git merge-tree --write-tree HEAD nl-haqr` showed 16 conflicting files (nl-haqr carries older cherry-picked
   copies of this branch's commits). At integration take this branch's side of the lock code (Auth.kt,
   Server.kt pairing, bridge/server.py lock block, PairLockTest.kt, test_pair_lock_bridge.py).
2. Outside this branch's scope, for the coordinator: widgets.js / widget-detail.js English lines (ws2-* agents,
   about 80); "Clear {label}", "Use the design's {label}", "{widget} now shows {place}." wait for caps-words.js
   lines once widget-caps.js labels settle (node scripts/caps-words-todo.mjs lists them).
