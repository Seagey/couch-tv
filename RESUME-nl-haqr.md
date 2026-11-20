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

## Status (21 Nov, resumed run)
All 10 Fable items are implemented (table above) and the port unify (one launcher server) is done.
Item 9 words: "Sign in again" and the TV's QR line now also in all 16 language blocks (i18n.js tw_ha_signin_again,
tw_ha_signed_out, swapped on screen by tv-words.js).
Green on 21 Nov (real Home Assistant = MacBook ha-haqr through the tunnel on 18124):
- python: test_ha_phone_bridge 12, test_smarthome_bridge 5, test_ha_widgets_config 6, test_bridge_phone_page_flag 3,
  test_phone_page_bridge 36; node: test_ha_phone_setup.js 26, test_ha_token_never_leaves.js 31, test_phone_page.js 18.
- real HA: tests/test_ha_real_bridge.py 45 checks.
- gradle (haqr/gradle-tests.sh <wt> both, HA_E2E_URL set): launcher 89 tests 0 fail 0 skipped (PhoneServerTest 21,
  HaPhoneTest 5, HaRealTest 1 against real HA); on-TV 172 tests 0 fail 0 skipped (HaPhoneTest 5, HaRealTest 1).
- emulator couchtv_gtv34 (-read-only, port 5610), launcher debug APK, real HA:
  haqr/e2e_launcher_oneserver.py emulator-5610 5400: 26 checks (on-TV app stopped, phone page on 5400, nothing on 5402..5409);
  the same with 5401: 26 checks (the on-TV app installed there holds 5400, the launcher's phone page took 5401 and /ha with it);
  haqr/e2e_launcher_haserver.py (launcher started with --es bridge, so no phone page; HaServer on 5402, bound to the
  LAN address, reached with `adb emu redir add tcp:15403:5402`): 16 checks.

- browser (lock taken): test_integrations_browser.mjs 40 checks (Sign in again in English and German),
  test_tv_words_browser.mjs 12 checks (every tw_ word in every language), haqr/phone_browser.mjs 18 checks through
  Home Assistant's real sign in page (4 forged /ha/done with no key, "That took too long. Try again.").
- MacBook ha-haqr and colima stopped again, tunnel closed, emulator killed.

## Left
Nothing. Done 21 Nov.
