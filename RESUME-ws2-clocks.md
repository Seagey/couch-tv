# RESUME ws2-clocks (widget swarm 2, clocks group)

Brief: tools/couch-tv/coord/swarm2-common.md (and coord/resume-builder-brief.md)
Kinds: clock, tallclock, glassclock, analog, flipclock, wordclock, worldclock, date, month, week, countdown, timer.
Worktree: tools/couch-tv/wt-ws2-clocks, branch ws2-clocks off integrate-0.13.9 (4a705fe). No push, tag or version bump.

## State: DONE (21 Nov 2026). Nothing left in scope.

## Done
- widget-caps.js: settings per kind, all pre:true
  clock format,seconds,date,ampm | tallclock format,align | glassclock format,scene | analog seconds,numbers |
  flipclock format | wordclock precise,dayline | worldclock cities,format,label | date show,dfmt,place(when show=weather) |
  month wstart | week town(tv, private),place | countdown label,day,month,year,unit | timer minutes,label.
- design.js: OPT numbers, precise, dayline, wstart; WOPT analog/wordclock/worldclock/month.
- widgets.js: renderers read each setting via setting(). 21 Nov: a countdown with no name says its date
  ("25 January"), never "The big day"; words never cut at any listed size (fitWords/fitLab/fitNum, the home's own
  helpers): world clock names (tile, wide tile, list, faces), a heading of its own also over the faces at wide sizes,
  countdown name and unit, timer name and line (a tile drops its icon when the words need two lines), the date's
  wrapping styles keep every line that fits (the year on a tile).
- widget-detail.js: Timers layer Quick start and name; World clocks layer uses worldOf; Calendar week start.
- Real data: Open-Meteo forecast called 21 Nov from this Mac for a NSW town: current 23.2, code 3,
  7 daily days. World clock: Intl time zones for all 10 cities answered in node. Clocks use the TV's clock.

## Tests (counts, 21 Nov)
- tests/test_ws2_clocks.mjs: 271 checks (TV list, Home settings, Hold OK Edit on the TV for all 12, 29 settings each
  changed and cleared, layers, phone list, off the design and back).
  The page clock is fixed: the test steps it 5 s before each Back and the menu OK (design.js times a held OK and five
  Backs by Date.now), and opens a fresh page after the Hold OK part. These were test artifacts, not product bugs.
- tests/test_ws2_clocks_visible.mjs: 2089 checks, 742 kind x size x setting x time cases, 181 same by design
  (each reason in SAME). WS2_SOFT=1 lists all failures; WS2_VISIBLE_LOG=<file> logs what each case shows;
  WS2_SHOT=kind,w,h WS2_SHOT_FILE=x.png takes one picture.
- test_ws_tv.mjs 1115, test_design_settings_browser.mjs 107, test_widget_detail_browser.mjs 296,
  test_widget_fit_all.mjs 1640 boxes 0 problems (8 checks).
- Node: test_ws_schema.js 4019, test_widget_caps.js 4545, test_design_widgets.js 221, test_design_code.js,
  test_widget_pause.js 36, test_design_words.js: all pass.

## How to run
Browser tests run on the MacBook (owner's standing permission), one at a time:
  zsh <scratchpad>/clocks-mb-run.sh test_ws2_clocks.mjs test_ws2_clocks_visible.mjs ...
  (rsyncs this worktree to macbook:~/ws2-clocks-run, Playwright 1.65.1 in macbook:~/ws2-clocks-pw)
Or on this computer under the shared browser lock: zsh <scratchpad>/clocks-run.sh <test>.
Node: node tests/test_ws_schema.js; node tests/test_widget_caps.js
