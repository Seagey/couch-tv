# RESUME nl-haqr

Worktree: tools/couch-tv/wt-nl-haqr (branch nl-haqr, base integrate-0.13.9).
Tasks: coord/msgs-1120/0811 (Fable NO-GO, items 1 to 10) and coord/msgs-1120/0817 (launcher port clash with nl-phonepage).
HA: MacBook ~/ha-haqr (docker container ha-haqr via colima, port 8124; tunnel `ssh -f -N -L 18124:127.0.0.1:8124 macbook`). Never ~/ha-test.
Colima on the MacBook was OFF when this run began (21 Nov): start it for the tests, stop it after (`colima stop`), and stop the ha-haqr container.
Creds and scripts: the shared scratchpad's haqr/ folder (creds.json, gradle-tests.sh, browser-tests2.sh, phone_browser.mjs, e2e_*.py). Check a script points at this worktree before running it.

## Port clash choice (0817): one launcher server
nl-phonepage (5e9b600) is merged into this branch. With no computer at home (option A) the launcher's
PhoneServer (5400, or 5401) answers /ha itself (PhoneServer.ha -> Host.ha -> HaPhone.handle, the same Host
check and /ha/done rules). HaPage.phone asks MainActivity.phonePagePort() first and only starts HaServer
when no PhoneServer runs (a launcher with a computer at home). HaServer's ports moved to 5402..5409
(HaServer.PORTS), so neither server can take the other's port whichever starts first.

## Fable items (0811)
1 /ha/done key leak: fixed in HaPhone.kt and bridge/haphone.py (state first, every failure /ha/?e=expired with no key); phone page keeps K in sessionStorage. Tests: test_ha_phone_bridge (done test), HaPhoneTest, PhoneServerTest, test_ha_real_bridge (4 forged/missing states), phone_browser.mjs (4 + page).
2 OPENS_HOUSE widened (cover|switch|script|scene ... garage|gate|door|lock|alarm), scenes filtered in parse: HomeAssistant.kt, smarthome.py, and tv-home/tools/home-config.py (config path) + docs/CONFIG.md.
3 Host check in HaPhone.handleFor (403 unless ipv4:port or .local:port).
4 client id only when the Host IP is one of the device's own addresses; PKCE S256 always.
5 saves rebuilt from parsed settings, old names kept (HomeAssistant.rebuilt, Home.rebuilt).
6 saved ids checked against the last listFor (listed).
7 bridge save(): _picks_of + rebuilt; delegates to keep_picks for a phone sign in.
8 HaServer: idle checked after every accept, 8 workers, 5 s read timeout, binds the LAN address.
9 refused refresh token: 60 s backoff, status signin_again, "Sign in again" on TV (app.js) and phone.
10 stale comments fixed, SHOTS only, refresh token cases in test_ha_token_never_leaves.js.

## Status (21 Nov, stopped by the coordinator mid run)
All 10 Fable items are implemented (table above) and the port unify (one launcher server) is done.
Tests run green at this point: test_ha_phone_bridge 12/12, test_smarthome_bridge 5/5, test_ha_widgets_config 6/6,
test_ha_phone_setup.js 26, test_ha_token_never_leaves.js 31, test_phone_page.js 18; real Home Assistant:
test_ha_real_bridge.py 45 checks (incl. forged /ha/done and the sign out backoff); gradle: launcher 89 tests 0 fail
(PhoneServerTest 21 incl. 3 new /ha tests, HaPhoneTest 5, HaRealTest 1 run against real HA), on-TV 172 tests 0 fail
(before the last HaPhoneTest/HaRealTest additions: rerun both).

## Left (exact next steps)
1. Rerun gradle (scratchpad haqr/gradle-tests.sh <worktree> both) with the tunnel up, so HaRealTest's new backoff
   checks run on both apps; count tests.
2. Browser: test_integrations_browser.mjs (new Sign in again check, mock MOCK_HA_SIGNED_OUT) and
   haqr/browser-tests2.sh (phone_browser.mjs now checks 4 forged /ha/done and the expired message). Not run yet:
   the browser lock was held by another agent the whole time.
3. Emulator proof of the one server path: launcher debug APK is built (tv-home/android/app/build/outputs/apk/debug);
   boot couchtv_gtv34 with -read-only -no-window -port 5610, install, start, adb forward tcp:15402 tcp:5400 and
   the WebView devtools to tcp:9335, run scratchpad haqr/e2e_launcher_oneserver.py emulator-5610. Always pass -s
   emulator-5610 to adb: adb devices also showed the forbidden TV ending .4.32 port 5555, connected by someone else.
4. MacBook: colima was OFF at start; this run started it and stopped it again with ha-haqr. Start both for step 1
   to 3 (colima start; docker start ha-haqr) and stop both after.
5. Final non WIP commit and report.
