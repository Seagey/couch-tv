# RESUME nl-phonepage (phone's Home settings page for every TV)

Branch nl-phonepage, worktree wt-nl-phonepage, from integrate-0.13.9. nl-remote commits 4d7b3e0, 69fa688, 472eddf cherry-picked in (pairing lock, phone remote gate, plain words) as 95a4432, 1457050, 73fac94.

## Done before 21 Nov (see git log)
Bridge serves /setup + /ontv/shim.js and the page's calls (bridge/phonepage.py, server.py); TV home phone-page.js and one QR gate in app.js; setup.html modes on-tv / bridge / launcher; launcher option A PhoneServer.kt, PhoneAuth.kt, PairLock.kt.

## 21 Nov: Fable NO-GO (coord/fable-1121-nl-phonepage-partial.md), every finding fixed
1. Photos: Pillow opens only JPEG, PNG, WebP (EPS, PSD, TIFF, GIF, BMP: 415).
2. Code lock: a wrong code counts only while a code is live; the same wrong code again from one address is not counted; one address adds at most 5 (bridge phonepage.counts_for_lock, launcher PhoneAuth.pair addr). One address alone never locks; launcher also has a per address limit (5 different wrong codes a minute, 429 there only). Bridge lock hunks mirror nl-remote 6ce5e20 exactly (h_pair and VIDAA never locked, Apple TV only while live, monotonic clock, retry_after, "Wait N min"), so server.py auto-merges with nl-remote.
3. Show a code on the TV keeps a live code with more than 90 s (bridge phonepage.show_pin, launcher pinForQr(90)).
4. Phone remote links name the driven TV: /setup?tv=<id> and /setup?tv=<id>#widget=<id> (phonePage.setupLink, api.getTvId).
5. shim.js asks /api/pair/start?tv=<page's TV>.
6. /api/pair with a pin and /api/pair/start refuse Origin null and file: (403), bridge and launcher; docs/CONFIG.md and bridge/API.md list /api/pair/start.
7. A used or thrown away code redraws the QR: bridge inbox pin_gen -> phone-page.js o.qr() -> tv.phoneLink(); launcher Host.codeChanged() -> tv.phoneLink().
8. One photo decoded at a time (asyncio semaphore), JPEG draft decode, resize before RGB and turn, Image.MAX_IMAGE_PIXELS = 100 MP and DecompressionBombError -> 413. Measured (scratchpad nlpp/mem_probe.py): 9999x9999 PNG 408 -> 201 MB, 9000x9000 JPEG 615 -> 21 MB.
9. Launcher Phones card (GET /api/phones, POST /api/phones/forget) shown in launcher mode; phonepage.xml left out of both backup rule files (3 places).
10. VIZIO (home "none"): no Town card, "only the people are here".
11. No key cookie: shim no longer sets it (moves an old one into storage and deletes it); setup.html fetches photos with the header into blob URLs; bridge and launcher no longer accept the cookie.
12. Bridge deletes a phone photo's file when the TV home's push drops it (_drop_unlisted_photos); a push with no "seen" keeps the phone's photos.
13. Launcher upload temp file is File.createTempFile; the phone server stops when a computer is set (onNewIntent -> startPhonePage).
14. RELEASE-NOTES-0.13.9.md and docs/UPDATES.md: option B pip step (Mac/Linux and Windows) and Docker rebuild; Home settings on your phone is for every TV; the 501 message no longer names .venv/bin/pip.
15. The 7 messages in every language block: tv-home i18n 16 of 16, remote i18n 11 of 11 (scratchpad nlpp/add_err_words.mjs, idempotent).
16. Counts below are this run's.
Also: launcher serves /tv/phone-words.js and /tv/caps-words.js from www/tv when bundled (nl-remote's words files), 404 otherwise.

## 21 Nov, second check (NO-GO at 79e1a4c, N1 to N4)
- N1: the same wrong code again from the same address is not a new try (bridge phonepage.pair(code, ip): _pin["guessed"], reset by new_pin; launcher PhoneAuth: wrong += 1 only for a new guess). Probe: 0 of 20 QR codes killed.
- N2: one address gets 5 different wrong codes per 10 minutes, then 429 err_pairing_locked with retry_after (bridge phonepage.address_wait; launcher addressLimited over LOCK_WINDOW_MS). Probe: 15 in 30 simulated minutes, about 720 a day. docs/CONFIG.md and bridge/API.md updated.
- N3: a PNG or WebP over 40 megapixels answers 413 (PHOTO_MAX_PIXELS_OTHER); JPEG keeps 100.
- N4: launcher /api/pair needs Content-Type application/json (415) and a Host that is an IP address or the TV's own address (403).
- Do not rebase or drop the cherry-picks: the coordinator merges with normal merges.

## Tests (21 Nov run)
- Python: test_phone_page_bridge 52 (after N1 to N4), test_pair_lock_bridge 6 (nl-remote's file), test_bridge_phone_page_flag 3. Whole suite one file at a time (scratchpad nlpp/run_py_all.sh): 88 of 88 files, 1405 tests.
- Browser, all rc=0: phone_settings_bridge 93, phone_settings (on-TV) 129, phone_link_fresh 9, remote_phone_page_browser 15, design_settings 107, widget_detail 295, tv_words 12.
- JS: node tests/test_phone_page.js 22, tests/test_remote_phone_page.mjs 51; all JS unit files: scratchpad nlpp/run_js_units.sh, 71 of 71 (the two emulator sims, keep-watching-sim and now-playing-sim, need adb emulators and are not unit tests).
- Gradle tv-home (gradle.lock, scratchpad nlpp/gradle_tvhome.sh): testDebugUnitTest 81 tests, 0 failures (PhoneServerTest 30, after N1 to N4), assembleDebug ok.
- Browser (browser.lock, scratchpad nlpp/run_browser.sh; needs remote/dist: remote/node_modules is a symlink to ../../repo/remote/node_modules, excluded in .git/info/exclude, then npm run build in remote/).

## Merge notes
- nl-haqr: git merge-tree HEAD nl-haqr is clean (PhoneServer Host.codeChanged sits apart from its Host.ha; the status line is the same as its).
- nl-remote: conflicts in on-TV Auth.kt, Server.kt, PairLockTest.kt, setup.html, Sheets.jsx, phonePage.js, i18n files, design.js, mock.js, index.html, tv-words.js and tests: the coordinator merges with normal merges (no rebase). bridge/server.py auto-merges. The new English lines in setup.html applyMode need entries in nl-remote's phone-words.js.
- Not in this branch: the on-TV app's own Auth.kt live code rule (nl-remote M1, in nl-remote 6ce5e20).

## Left
Nothing in scope. No real TV touched (owner away; covered by unit, gradle and browser tests).
