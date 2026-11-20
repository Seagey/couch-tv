# Resume: ws2-smarthome (widget swarm round 2, smart home group)

Brief: scratchpad swarm2-common.md. Kinds: aircon, controls, camera, doorbell, sensor, energy, solar, battery, speakers, scenes, bins.

## Done (committed on ws2-smarthome)
- widget-caps.js: every setting of the 11 kinds is wired and pre:true (none left for later). New: aircon `others`, doorbell `picture`, energy `now`, battery `low` (5 to 50), solar `town` (pre), speakers `players` (pre), scenes `scenes` (pre), bins `lid_a`/`lid_b` (pre). Honest steps: bins set on the TV, solar place per widget, device kinds say "Hold OK, Edit on the TV, to pick". Control Centre help: garage doors show but never open.
- widgets.js / widget-detail.js renderers read each setting (scenes picks also in the OK layer; battery short box shows the lowest charge).
- design.js WOPT/OPT for the new design keys.
- Device pick list (shared hunks): smarthome.js `devices(domain)`; app.js wsOptions/deviceOptions, wsWords, oneWidgetRows (device = cycle or tick list), designView value, designEdit validation; on-tv/web/setup.html device = select or ticks.
- Home Assistant's own unit for aircon rooms: bridge/smarthome.py (ha_unit, Home.unit) + test; HomeAssistant.kt (haUnit), gradle compileDebugKotlin passed. NOTE: branch nl-haqr moved HomeAssistant.kt to tv-home/android/shared/ (package app.couchtv.ha): re-apply the haUnit hunk there on merge.

## Tests
- node tests/test_ws_schema.js (3760), tests/test_widget_caps.js (4548), test_ha_token_never_leaves.js (28), test_design_widgets.js (221); pytest tests/test_smarthome_bridge.py tests/test_ha_widgets_config.py (12).
- tests/test_ws2_smarthome.mjs: 181 checks passed (Playwright, COUCHTV_PLAYWRIGHT=".../tools/tv-designer/market").
- Browser suite (ws_tv, design_settings, widget_detail, widget_fit_all, phone_settings, smart_widgets): see the latest commit message / report for results.
- Browser runs must hold scratchpad/browser.lock: use scratchpad/smarthome-run.sh <test files> (waits for the lock, logs to scratchpad/smarthome-results/).
- In browser tests press Back slowly: five Back presses within 4 s switch a design off (design.js escapeDesign).

## Left
- Nothing running on the MacBook or an emulator. No real Home Assistant was used (mock.js ?ha=1 and the bridge test fakes).
