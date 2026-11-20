# RESUME ws2-clocks (widget swarm 2, clocks group)

Brief: <session scratchpad>/swarm2-common.md
Kinds: clock, tallclock, glassclock, analog, flipclock, wordclock, worldclock, date, month, week, countdown, timer.
Worktree: tools/couch-tv/wt-ws2-clocks, branch ws2-clocks off integrate-0.13.9 (4a705fe). No push, tag or version bump.

## Done (all settings pre:true, no "later" left in these kinds)
- widget-caps.js: settings per kind
  clock format,seconds,date,ampm | tallclock format,align | glassclock format,scene | analog seconds,numbers |
  flipclock format | wordclock precise,dayline | worldclock cities,format,label | date show,dfmt,place(when show=weather) |
  month wstart | week town(tv, private),place | countdown label,day,month,year,unit | timer minutes,label.
  Caps text (setup steps, needs, ok) updated for these kinds: Hold OK, Edit on the TV.
- design.js: OPT numbers, precise, dayline, wstart; WOPT analog/wordclock/worldclock/month.
- widgets.js: renderers read each setting via setting(): clockParts seconds, R.clock, tallclock align,
  glassclock scene (GLASS list), analog second hand + numbers, wordclock precise (timeWords(d, precise)) + day line,
  worldclock worldOf()/tzShow() (cities, 24 hour, heading; one ticker, no leaking live()), date dateWords() + show + place,
  month weekStart()/weekHead(), week place toggle, timer timerOwn() (name, "OK starts N minutes"). Kit exports added.
- widget-detail.js: Timers layer Quick start (starts on OK, not in Studio, not over a running timer) and name;
  World clocks layer uses worldOf (same cities, 24 hour); Calendar monthGrid week start for the Month widget.
- Real data: Open-Meteo forecast called once (2026-11-20, a NSW town: current 21.9, 7 daily days) for week/date
  weather; clocks use the TV clock; world clock Intl time zones checked in node for all 10 cities.
- Node tests green: test_ws_schema.js (4019 checks), test_widget_caps.js (4545), test_design_widgets.js (221),
  test_design_code.js, test_widget_pause.js, test_design_words.js.

## In progress
- tests/test_ws2_clocks.mjs (Playwright). Sections 1 (TV list) and Home settings Widgets on this home pass.
  FAILING: Hold OK, Edit on the TV, for clock "c": the page opens at Designs, not the widget page (no page errors).
  Debugging: run with DBG=1 to log the head for every kind (debug prints DEBUG/DEBUG2/HEAD are temporary: remove).
  Suspect: settings Enter key also handled after the sheet act, or SET.sub dropped by renderSettings when rows empty.
- After that: sections 2 to 5 of the test have never run yet (every setting changed and cleared via tv.atHomeEdit,
  layers, phone list, widget removed from the design).

## Next steps
1. Fix the Hold OK test (or the real bug if it is one), remove the debug prints.
2. Get test_ws2_clocks.mjs green; then run test_ws_tv.mjs, test_design_settings_browser.mjs, test_widget_detail_browser.mjs,
   test_widget_fit_all.mjs (update expectations only for these kinds).
3. Commit, report table per kind.

## How to run
Browser runs need the shared lock: use the scratchpad script (it takes and frees the lock):
  zsh <session scratchpad>/clocks-run.sh test_ws2_clocks.mjs
  (TAILN=60 for more output; DBG=1 for the Hold OK debug.)
Node: node tests/test_ws_schema.js; node tests/test_widget_caps.js
Nothing running on the MacBook or an emulator.
