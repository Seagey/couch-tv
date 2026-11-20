# Resume: nl-matter-ui (builder "matter-ui")

Rules: scratchpad nolater-common.md and matter-contract.md. Base integrate-0.13.9. No push, tag or version bump.

## Done (committed)
- tv-home/web/matter.js: client for /api/matter/* (devices, commission, command, remove, rename). In the page a device is `<domain>.matter_<node>_<ep>`, so design.js checks and the pick-lists work unchanged. Transport: window.TVMATTER (launcher, if matter-android adds it), else the api that app.js hands to smartHome.useBridge, else mock.js MOCK_MATTER. Verhoeff pairing code check. Locks, alarms and garage covers dropped.
- smarthome.js (shared hunks): info() merges Matter; enabled/available count Matter; ask() routes Matter ids to matter.js and merges climate/controls/sensors lists; useBridge hands the api to CouchMatter; reload() signature includes Matter.
- index.html: matter.js script line. mock.js: ?matter=1 / empty / down pretend controller.
- app.js: Smart home screen Matter rows (matterRows, openMatterAdd, openMatterDevice: rename, remove, add by code, where each app keeps the code); openSmartSetup rows wrapper.
- on-tv/web/setup.html: "Matter devices" section (list, rename, remove, per-app steps, paste code, photo of QR where BarcodeDetector exists), loadMatter() in load().
- tests/test_matter_ui.js: `node tests/test_matter_ui.js` -> ok 63 checks (incl. live push on /api/matter/events). All 65 node tests in tests/*.js pass.
- TD help: new article matter-devices, widgets-smart note, TREE entry, glossary "Matter". Backup in scratchpad td-backup-nl-matter-ui/help. help-build ran: 10 TD files changed (help/src/articles.mjs, help/src/paths.txt, help/all.txt, help/glossary.json, help/index.html, help/index.json, help/widget.js, help/widgets-smart/index.html, help/words/index.html, new help/matter-devices/).
- Trial merges: nl-haqr conflicts only on the openSmartSetup line (resolution: keep haqr's SHP line and `smart: true`, use `rows: function () { return matterRows(smartRows()); }`, keep the CouchMatter.refresh line); 66/66 node tests pass merged. ws2-smarthome working files merge with 0 conflicts and its devices() lists Matter devices (scratchpad ws2_check.js, 4 checks).

## Done 21 Nov (resumed builder)
- Browser test run under the lock: first run 48/48 (before any change).
- Checked against nl-matter-android ea574c2 (Server.kt, Matter.kt, MatterCode.kt, MatterPage.kt) and nl-matter-bridge 8254a5a (bridge/matter.py, server.py, API.md). Changes:
  - matter.js: window.TVMATTER (launcher, MatterPage.kt) asked at page load (no bridge needed); its ok:false answers fail like app.js api() (a refused page = Matter off); error sentences kept as the note; on-TV "ok, no ids, note" (a lock joined and left again) = not_allowed; remove note -> unanswered; command answer `device` read at once; `reason` key kept (M.reason()); rename turns down a light/plug/blind name with garage/gate/door/lock (error name_hides) before sending.
  - app.js and setup.html: words for already, not_allowed, unavailable, name_hides, the 6 reason keys (off, not_installed, node_missing, node_old, starting, stopped), the remove note, "Added. It shows here once the device answers." Both screens are English only (setup.html has no language blocks; the app.js Home settings Smart home section is hard coded English), so English is every language block they support.
  - mock.js: ?matter=nodeold, code 20000000000 = not_allowed; fixed a stray "var jw =function" space from the earlier WIP.
  - Coordinator 21 Nov (Fable NO-GO on nl-matter-bridge): matter.js listens on /api/matter/events only (never /api/events); reason keys in plain words; not_allowed message; rename refusal message; remove note.
- TD help: matter-devices notes (a lock shared by mistake is not kept; names that hide a device). help-build 61 articles; help-check 105/105. TD files changed (same 10 as before): help/src/articles.mjs, help/src/paths.txt, help/all.txt, help/glossary.json, help/index.html, help/index.json, help/widget.js, help/widgets-smart/index.html, help/words/index.html, new help/matter-devices/.
- Tests: `node tests/test_matter_ui.js` -> ok 80; all 65 node tests in tests/*.js pass. Browser: `sh <scratchpad>/matter-ui-browser.sh <worktree>/tests/test_matter_ui_browser.mjs` (count in the final commit message).

## Done 21 Nov, second resume (words in every language)
- tv-home/web/matter-words.js: one table (82 keys x 15 languages) for the TV (app.js, via I18N.lang()) and the phone card (setup.html, via PhoneWords.lang()); every English line also handed to window.CouchCapsWords so nl-remote's tv-words.js / phone-words.js swap the phone card's static HTML. app.js and setup.html Matter code use mw(key); matter.js describe() in the language (contact open/closed, occupancy someone/no one there; zh comma).
- app.js api() and setup.html api(): the thrown error keeps the whole answer (err.reply), so a commission refused because the home computer's Matter is not running shows the reason in words (bridge fixer: unreachable + reason).
- tests/test_matter_words.js (25 checks, incl. nl-remote phone-words.js swapping the card to French via git show). Browser test: /tv/ mapped, new 2c (TV in German) and 2d (phone in French).

## Left (exact next steps)
1. Browser test under the lock: `sh <scratchpad>/matter-ui-browser.sh "<worktree>/tests/test_matter_ui_browser.mjs"`.
2. Coordinator's bridge API changes (Fable NO-GO list coord/fable-1121-nl-matter-bridge.md) are all done here (see above). When the bridge fixer commits, check its rename refusal key and its reason keys match MT_WHY / MT_ERR in app.js and setup.html.
3. Note for the report: on 21 Nov `node tv-designer/scripts/help-check.mjs` (it launches Chromium) was run once WITHOUT the browser lock by mistake; 105/105 passed.
- If the nl-matter-bridge fixer names the rename refusal key something other than refused or not_allowed, add it to MT_ERR (app.js, setup.html) as name_hides.

## Old notes (20 Nov)
1. Run tests/test_matter_ui_browser.mjs under the browser lock: `sh <scratchpad>/matter-ui-browser.sh <worktree>/tests/test_matter_ui_browser.mjs` (takes the lock, uses Playwright from tv-designer/market). Fix what fails, commit.
2. Wire to the real endpoints once nl-matter-android / nl-matter-bridge commit: check their /api/matter/devices shape and attribute names against scratchpad matter-ui-needs.md (mode action, rename endpoint, error keys), adjust matter.js converters, rerun tests.
- Checked against nl-matter-android (d4d98ef, Server.kt + MatterModel.kt): same paths, HA attribute names, actions on/off/target/mode/position, rename, error keys expired/wrong_code/unreachable/thread with a 400. TV page reaches it by the internal cookie. matter.js listens on /api/matter/events (both siblings push "event: matter").
