# RESUME ws2-weather

Branch ws2-weather, worktree tools/couch-tv/wt-ws2-weather, from integrate-0.13.9 (4a705fe).
Rules: tools/couch-tv/coord/swarm2-common.md and coord/resume-builder-brief.md.
Kinds: weather, bigtemp, hourly, rain, uv, sun, moon, air, surf (week stays with ws2-clocks).

## Done

- 9a1ecde: every weather kind has settings, all pre: true and wired (19 settings on 9 kinds).
- Fable check 21 Nov (coord/fable-1121-ws2-weather-partial.md, NO-GO partial), fixed:
  1. CR.weather wide tile now honours "Show the town name" and "Show the high and low".
  2. A widget with a place of its own names it at every size: weather and bigtemp tile (beside the
     icon, hidden when Show the town name is off), hourly wide tile (name before the hours), uv tile,
     sun tile and wide tile. Also found by the new size matrix: Surf at small (360 wide) never drew the
     wind, so "Wind in" did nothing there; the wind now goes under the swell when it is too narrow.
  3. Merge note only (see "Merge" below), nothing to change on this branch.
  4. Moon on a Roku: its own platform note (plain disc, name, % lit, same way round, no next full moon).
  5. sunToday: a picked place with no time zone of its own says "by this TV's clock" (R.sun heading,
     CR.sun tile and wide tile); app.js cleanPlace now also keeps "Etc/GMT+10" style zones.
  6. Words: "Where sunrise and sunset are for."; Air scale "European" / "American".
  7. tests/test_ws2_weather.mjs: a size matrix (every setting x every size the kind comes in, changed,
     then cleared), own place named at every size, long place names stay inside, sun by this TV's clock.
  8. English only, as every caps label on the base: the tv-words.js pass is the coordinator's step 3.

## Merge (Fable finding 3)

In widget-caps.js LATER keep none of the nine weather kinds (this branch moved them all to SETTINGS);
take this branch's weather lines in the before launch block whole; in tests/test_ws_schema.js take this
branch's weather entries in PRE and its LATER without surf and weather. "Keep both sides" duplicates
keys (LATER is concatenated onto SETTINGS).

## Tests, 21 Nov 2026 (all pass)

    node tests/test_ws_schema.js                 3809 checks (84 settings on 45 kinds)
    node tests/test_widget_caps.js               4548 checks
    every tests/*.js                             64 pass, 0 fail
    python3 tests/test_ws_native.py              OK (12 skipped); test_widget_settings_bridge.py OK
    browser (take <scratchpad>/browser.lock with mkdir first, rmdir after), via
    zsh <scratchpad>/ws2-weather-run.sh (logs in <scratchpad>/ws2-weather-logs/):
      tests/test_ws2_weather.mjs                 551 checks (same count at any time of day)
      tests/test_ws_tv.mjs                       1115 checks
      tests/test_design_settings_browser.mjs     107 checks
      tests/test_widget_detail_browser.mjs       295 checks
      tests/test_widget_fit_all.mjs              1640 boxes, 0 problems, 8 checks
    Fable's read only probe (<scratchpad>/fable-ws2-weather/probe.mjs <worktree>): 71 size cases, no
    spill; the only no change cases are a tile with nothing to hide, the surf wide tile (no wind
    drawn) and hours 8 where 8 already fit; real Open-Meteo end to end for Sydney and Bells Beach
    matches a direct call (15°, high 22°, UV 8, swell 0.6 m, wind 15 km/h, EU AQI 15).

## Left

Nothing in this branch's scope. At merge: finding 3 above. After merge: the tv-words.js pass for the
new labels (coordinator step 3, every caps label on the base is English only).
