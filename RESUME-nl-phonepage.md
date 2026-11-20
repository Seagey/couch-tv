# RESUME nl-phonepage (phone's Home settings page for every TV)

Branch nl-phonepage, worktree wt-nl-phonepage, from integrate-0.13.9. nl-remote commits 4d7b3e0, 69fa688, 472eddf cherry-picked in (pairing lock, phone remote gate, plain words).

## Done (all committed)
- Bridge serves /setup + /ontv/shim.js and the page's calls (bridge/phonepage.py, server.py): code pairing for the key, /api/pair/start, /api/phone-link, settings_patch place with seen merge ("kept"), /api/athome relayed to the TV home (/api/phone/inbox, /done, /view), photos (Pillow, data/photos/bridge*.jpg), /api/weather uses the TV's town (Roku, Apple TV). Pairing lock respected (check_pair_lock, pair_wrong). Health reports phone_page (nl-remote's serves_phone_page).
- TV home: tv-home/web/phone-page.js (inbox poll), app.js one gate (phoneLinkFn / phoneLinkKnown, BRIDGE_PHONE from /api/settings mode), kept keys, bridge photo src, tv.phonePage ops for the launcher; design.js regex accepts ?tv=; i18n phone_code in 16 languages; err_code_* keys (en, zh, pl) in tv-home and remote i18n.
- setup.html: modes on-tv / bridge / launcher, home kind web/roku/appletv/none, ?tv=; shim reads couchtv.key and opens with no code on a keyless computer.
- Launcher option A: PhoneServer.kt, PhoneAuth.kt, PairLock.kt (NanoHTTPD), MainActivity starts it when alone(); TV.phoneLink; on-tv/web bundled as assets/www/ontv.

## Tests (last run, all green)
- `.venv/bin/python -m unittest tests.test_phone_page_bridge` 35 tests; whole Python suite 88/88 files.
- `node tests/test_phone_page.js` 18; all JS unit files 62/62.
- Browser (take scratchpad browser.lock; COUCHTV_PLAYWRIGHT=".../tools/tv-designer/market"): test_phone_settings_bridge_browser.mjs 76, test_phone_settings_browser.mjs 129, test_phone_settings_stale 12, test_widget_detail_browser 296, test_design_settings_browser 107 (before the cherry-picks; a rerun after them was in progress).
- Gradle (gradle.lock): tv-home testDebugUnitTest 69 tests (PhoneServerTest 18), assembleDebug ok. on-tv gradle needs remote/dist (npm run build in remote/) in this worktree.

## Left
- Confirm the browser rerun after the cherry-picks (the four tests above plus test_phone_link_fresh_browser.mjs).
- Report to the coordinator.
