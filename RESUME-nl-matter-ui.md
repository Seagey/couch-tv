# Resume: nl-matter-ui (builder "matter-ui")

Rules: scratchpad nolater-common.md and matter-contract.md. Base integrate-0.13.9. No push, tag or version bump.

## Done (committed)
- tv-home/web/matter.js: client for /api/matter/* (devices, commission, command, remove, rename). In the page a device is `<domain>.matter_<node>_<ep>`, so design.js checks and the pick-lists work unchanged. Transport: window.TVMATTER (launcher, if matter-android adds it), else the api that app.js hands to smartHome.useBridge, else mock.js MOCK_MATTER. Verhoeff pairing code check. Locks, alarms and garage covers dropped.
- smarthome.js (shared hunks): info() merges Matter; enabled/available count Matter; ask() routes Matter ids to matter.js and merges climate/controls/sensors lists; useBridge hands the api to CouchMatter; reload() signature includes Matter.
- index.html: matter.js script line. mock.js: ?matter=1 / empty / down pretend controller.
- app.js: Smart home screen Matter rows (matterRows, openMatterAdd, openMatterDevice: rename, remove, add by code, where each app keeps the code); openSmartSetup rows wrapper.
- on-tv/web/setup.html: "Matter devices" section (list, rename, remove, per-app steps, paste code, photo of QR where BarcodeDetector exists), loadMatter() in load().
- tests/test_matter_ui.js: `node tests/test_matter_ui.js` -> ok 59 checks. All 65 node tests in tests/*.js pass.
- TD help: new article matter-devices, widgets-smart note, TREE entry, glossary "Matter". Backup in scratchpad td-backup-nl-matter-ui/help. help-build ran: 10 TD files changed (help/src/articles.mjs, help/src/paths.txt, help/all.txt, help/glossary.json, help/index.html, help/index.json, help/widget.js, help/widgets-smart/index.html, help/words/index.html, new help/matter-devices/).
- Trial merges: nl-haqr conflicts only on the openSmartSetup line (resolution: keep haqr's SHP line and `smart: true`, use `rows: function () { return matterRows(smartRows()); }`, keep the CouchMatter.refresh line); 66/66 node tests pass merged. ws2-smarthome working files merge with 0 conflicts and its devices() lists Matter devices (scratchpad ws2_check.js, 4 checks).

## Left
1. Run tests/test_matter_ui_browser.mjs under the browser lock: `sh <scratchpad>/matter-ui-browser.sh <worktree>/tests/test_matter_ui_browser.mjs` (takes the lock, uses Playwright from tv-designer/market). Fix what fails, commit.
2. Wire to the real endpoints once nl-matter-android / nl-matter-bridge commit: check their /api/matter/devices shape and attribute names against scratchpad matter-ui-needs.md (mode action, rename endpoint, error keys), adjust matter.js converters, rerun tests.
