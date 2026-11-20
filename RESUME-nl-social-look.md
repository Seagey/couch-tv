# RESUME nl-social-look (couch-tv 0.13.9, social build list g01 g23 g30 g17)

Branch nl-social-look off integrate-0.13.9 (4a705fe). Rules: scratchpad nolater-common.md.

## Plan
- g01 lowEndDecision measures at 4 GB (only 8 GB skips), nav frames sampled while the focus moves, one time toast when Lighter home turns itself on; perf cuts with numbers (Chrome CPU throttle).
- g23 Moving tiles and Mac dock rows under Lighter home: "Off while Lighter home is on", OK asks "Turn off Lighter home?"; check #203.
- g30 Look, Sharp pictures on a 4K TV: Auto, Always, Off (ST.hi_res).
- g17 Look, Show the clock (ST.show_clock / home.show_clock).
- i18n 16 blocks, bridge clean_settings + mock BRIDGE_KEYS, docs CONFIG/TV-HOME/PERFORMANCE.

## Done
- (nothing yet)

## Tests
- Baseline node suite (all tests/test_*.js): 61 passed, 0 failed.
- Script: scratchpad/look-node-suite.sh <worktree>
