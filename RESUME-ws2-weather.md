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

- Re-check NO-GO at c61392f (real tile sizes, tools/tv-designer/app/grid.js: tile 160 x 160, wide tile
  360 x 160; words were cut by "…" though textContent had them), fixed:
  A. Weather wide tile under 460 wide: "High 28°" in place of "Mostly clear, 28°" (the icon says the
     sky); in the evening "Tomorrow" and "High 28°" on two lines; the temperature 60 px there.
  B. Weather and Big number tiles: the own place name on its own line in place of the icon. Air tile:
     the place name alone as the label; Air wide tile: "Air, <place>".
  C. Test: hours 4 (a real option); "hourly.hours wtile" added to the same list (5 cases now).
  D. Sun "by this TV's clock": R.sun a line of its own; wide tile "Sun, <place>" shrinks, "by TV
     clock" never does; tile "TV clock" on its own line.
  E. CR.hourly: one divisor (64) with or without a place of its own.
  F. Test: the always true clause of "both off" removed.
  The test now measures what shows: each element's words, character by character, inside its own box
  and the widget's and before any "…" (draw().leaves, .seen). The size matrix compares what shows;
  every own place name must show at least 4 letters; the high and the clock words must show in full.
- Gate NO-GO at 45ad888 (names still cut: 4 letters was too weak), fixed:
  - No word is cut anywhere now, for every kind, every listed size, every setting value, at 10:00 and
    19:30: tests/test_ws2_weather_visible.mjs (from the gate's probe3), 386 cases.
  - Weather wide tile under 460: no icon; place cw-t25, sky words, "High N°" each on their own line.
  - Tiles with a place of its own (weather, Big number, Air, UV, Sun): 16 px padding, the name over two
    lines broken between words (widgets.js TWO), a smaller number; Air tile band word two lines too.
  - Air wide tile: "Air", then the place on its own line, the number 72 px.
  - Rain wide tile: the place as the heading, the rain line under it.
  - Under 600 wide, a place of its own is the heading by itself (wxHead(o, env, dflt, b)): rain, UV,
    air, sun.
  - Hourly small: the place on its own line; the sky column keeps its room. Hourly wide tile: 5 hours
    fit (room / 60), so 4 changes it; with a place's name 2 fit.
  - Surf wide tile: the wind under the swell (Wind in works there now), no icon beside its own place.
  - Moon wide tile: the phase over two lines.
  - Weather wide tile in the evening: place / Tomorrow / tomorrow's sky in words / High N° (line height 1.1).
  - Weather and surf wide tiles: columns spread edge to edge (the fit audit's centring), surf unit 23 px.
  - Help lines: Show the town name (weather, Big number) and Show the high and low say what a tile shows.
  - Main test: names fit in full (Long Beach at every size, Port Macquarie from the wide tile up),
    surf wide tile shows knots; SAME is 3 cases now.

## Merge (Fable finding 3)

In widget-caps.js LATER keep none of the nine weather kinds (this branch moved them all to SETTINGS);
take this branch's weather lines in the before launch block whole; in tests/test_ws_schema.js take this
branch's weather entries in PRE and its LATER without surf and weather. "Keep both sides" duplicates
keys (LATER is concatenated onto SETTINGS).

## Tests, 21 Nov 2026 after the gate fixes (all pass)

    node tests/test_ws_schema.js                 3809 checks (84 settings on 45 kinds)
    node tests/test_widget_caps.js               4548 checks
    every tests/*.js                             64 pass, 0 fail
    python3 tests/test_ws_native.py              OK (12 skipped); test_widget_settings_bridge.py OK
    browser (take <scratchpad>/browser.lock with mkdir first, rmdir after), via
    zsh <scratchpad>/ws2-weather-run.sh (logs in <scratchpad>/ws2-weather-logs/):
      tests/test_ws2_weather.mjs                 644 checks (same count at any time of day)
      tests/test_ws2_weather_visible.mjs         1116 checks (386 cases, 70 the same by design)
      tests/test_ws_tv.mjs                       1115 checks
      tests/test_design_settings_browser.mjs     107 checks
      tests/test_widget_detail_browser.mjs       296 checks
      tests/test_widget_fit_all.mjs              1640 boxes, 0 problems, 8 checks
    WS2_SOFT=1 lists every failure in either weather test instead of stopping at the first.
    Fable's read only probe (<scratchpad>/fable-ws2-weather/probe.mjs <worktree>): 71 size cases, no
    spill; the only no change cases are a tile with nothing to hide, the surf wide tile (no wind
    drawn) and hours 8 where 8 already fit; real Open-Meteo end to end for Sydney and Bells Beach
    matches a direct call (15°, high 22°, UV 8, swell 0.6 m, wind 15 km/h, EU AQI 15).

## Left

Nothing in this branch's scope. At merge: finding 3 above. After merge: the tv-words.js pass for the
new labels (coordinator step 3, every caps label on the base is English only).
