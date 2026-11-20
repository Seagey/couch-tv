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

## Left
- perf: headless rAF shows 16.7 ms everywhere at 6x throttle; probe2 (trace PipelineReporter + main thread ms) in scratchpad/look-perf.
- perf cuts in app.css, tests/test_lag_perf_browser.mjs, docs/PERFORMANCE.md, run browser suites.

## Tests
- Baseline node suite (all tests/test_*.js): 61 passed, 0 failed.
- Script: scratchpad/look-node-suite.sh <worktree>
