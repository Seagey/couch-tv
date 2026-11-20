# RESUME nl-social-look (couch-tv 0.13.9, social build list g01 g23 g30 g17)

Branch nl-social-look off integrate-0.13.9 (4a705fe). Rules: scratchpad nolater-common.md.

## Plan
- g01 lowEndDecision measures at 4 GB (only 8 GB skips), nav frames sampled while the focus moves, one time toast when Lighter home turns itself on; perf cuts with numbers (Chrome CPU throttle).
- g23 Moving tiles and Mac dock rows under Lighter home: "Off while Lighter home is on", OK asks "Turn off Lighter home?"; check #203.
- g30 Look, Sharp pictures on a 4K TV: Auto, Always, Off (ST.hi_res).
- g17 Look, Show the clock (ST.show_clock / home.show_clock).
- i18n 16 blocks, bridge clean_settings + mock BRIDGE_KEYS, docs CONFIG/TV-HOME/PERFORMANCE.

## Done
- app.js: lowEndDecision (8 GB skip, 4 GB measured, navMs), lowEndNav (frames while moving), lighterTold toast once;
  heldByLighter rows + setLighter + r.ask confirm; hiResSetting + Sharp pictures row; SHOW_CLOCK + clockShown + row.
- app.css html.no-clock; i18n 9 keys x 16 langs; bridge clean_settings/config._home/API.md; mock BRIDGE_KEYS + showclock/hires args.
- docs CONFIG.md, TV-HOME.md. tests/test_low_end.js updated, test_loop_look.js regex for heldByLighter.
- tests/test_look_switches_browser.mjs written (note: closing Home settings reloads the page and drops ?theme=, use look=).

- Perf cuts: cut 1 html.amb-fx (ambientSync) hides the empty weather canvas and lighting tint; cut 2 Night people and
  quick buttons drop the live blur (app.css end). tests/test_lag_perf_browser.mjs, docs/PERFORMANCE.md section.
- tests/test_look_switches_bridge.py (bridge keys).

## Left
- Nothing in scope. Not done on purpose: no real TV run (bench-tv.py on the TCL), no GitHub replies (read only).

## Tests (final, 21 Nov)
- node suite (all tests/test_*.js): 61 passed, 0 failed (baseline 61).
- browser: test_look_switches_browser 71 checks; test_lag_perf_browser 9 checks; test_ws_tv 1115 checks;
  test_design_settings_browser 107 checks.
- python: test_look_switches_bridge 5; test_hi_res 4; test_start_focus 4; test_production_features 16; others touching clean_settings pass.
- Run browser tests with scratchpad/look-browser.sh <tests...> (takes the browser lock).
