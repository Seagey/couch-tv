# Resume: ws2-watching (widget swarm round 2, group "watching")

Brief: swarm2-common.md in the session scratchpad (the coordinator's).
Kinds: keep, keeprow, upnext, picks, nowplaying, queue, soundscape, games, app, appgrid, dock, folder, quick, stack.
Branch ws2-watching off integrate-0.13.9 (4a705fe). No push, tag or version bump.

## Done
- widget-caps.js: a WATCHING block sets every kind's settings (27 settings, all pre: true, none "later").
  keep person; keeprow label shows person; upnext sport apps (choice, many, catalogue ids); picks label mix;
  nowplaying buttons cover; queue label count; soundscape sound volume; games apps label; app apps;
  folder label apps cols; dock apps more; appgrid apps cols names; quick quick; stack turn.
- widgets.js: renderers read each one (showsFor, appIn, picksFor, colsOf, rowBreaks, stackTurn).
- widget-detail.js: keep layer follows Whose shows; picks layer follows Picks from.
- design.js: OPT mix buttons cover turn; WOPT picks nowplaying queue stack; widgetList lists the stack
  itself; Hold OK on a stack adds "Edit the stack on the TV".
- app.js: wsOptions (tvlist own options first), wsCur/wsWords for apps type (TV edits, names), apps row
  shows its value; acts "pshow" (another person's show) and "sound" (widgetSound); playOwned;
  quickCan (design quick buttons run any button the TV can do, data().quickCan).
- tests/test_ws2_watching.mjs: 172 checks pass (27 settings changed and cleared).
- tests/test_design_settings_browser.mjs: App grid now listed (it has settings).

## Test results so far
- node tests/test_ws_schema.js: 4430 pass. node tests/test_widget_caps.js: 4548 pass. All tests/test_*.js node tests pass.
- test_ws_tv.mjs 1115 OK, test_design_settings_browser.mjs 108 OK, test_widget_detail_browser.mjs 295 OK (before the rowBreaks change).
- test_widget_fit_all.mjs failed on folder (max-width fix); replaced by rowBreaks; rerun pending.

## Session 21 Nov (05:10 to 05:35), stopped by the coordinator
- Worktree was clean at bf32b38; no code changes this session.
- node tests/test_ws_schema.js 4430 pass, tests/test_widget_caps.js 4548 pass, all 61 tests/test_*.js node files pass.
- Browser suites NOT rerun: watching-run.sh (checked: points at wt-ws2-watching) waited 20 min on browser.lock held by other branches
  (wt-ws2-home was running test_widget_detail_browser.mjs) and was stopped before it got the lock. No lock of ours left behind.
  The logs in scratchpad/watching-out/ are all from 20 Nov 19:12 to 19:24 (fit_all OK 8 checks, 1640 boxes, 0 problems; ws2_watching 172 pass).
- Real data checked (read only, local home bridge 127.0.0.1:5400, no TV touched):
  /api/history 29 real items (title, app, who, tv fields) = keep/keeprow/upnext/picks source shape;
  /api/people 2 real people = Whose shows options. /api/music/queue answers "no such endpoint" there (that bridge is wt-home, older build),
  and /api/music reads the TV's media sessions over ADB, so nowplaying/queue live data was NOT called (TV off limits).
  Soundscape is made on the TV (no service). Apps/dock/folder/appgrid/games/app/quick come from the TV's own app list and buttons (not called: /api/apps asks the TV).

## Session 21 Nov (05:38 to 06:05): finished
- watching-run.sh (checked: T= points at wt-ws2-watching, output in scratchpad/watching-out) ran all five
  browser suites under browser.lock, one at a time, every one exit 0, on bf32b38 code (no code change since):
  test_widget_fit_all.mjs OK 8 checks (1640 boxes, 67 kinds, 0 problems); test_ws2_watching.mjs 172 pass
  (27 settings changed and cleared); test_ws_tv.mjs 1115 OK; test_design_settings_browser.mjs 108 OK;
  test_widget_detail_browser.mjs 296 OK.
- Node: test_ws_schema.js 4430 pass, test_widget_caps.js 4548 pass, all 61 tests/test_*.js pass.
- Not possible here: a live Spotify call for nowplaying/queue. The bridge on 127.0.0.1:5400 is an older build
  (/api/spotify/status and /api/music/queue answer "no such endpoint"), and looking for Spotify tokens in other
  worktrees was refused by the permission check (not bypassed). The parsers (spotify_now.card_item,
  queue_items) are unchanged on this branch.

- test_ws2_watching.mjs extended: all 14 kinds taken off the design (only a clock left) leave the phone's list,
  Home settings Widgets on this home, the phone page, Hold OK and the home. Rerun 21 Nov 05:55 under the lock: 216 pass.

## Checker GO at b6a0a1b, then five fixes (21 Nov)
1. TD tools/tv-designer/app/designer.js HAND_KEYS gets "turn" (backup: scratchpad/td-backup-ws2-watching/app/designer.js),
   so Studio draws only its own Turns control. Check: node scratchpad/ws2-watching-handkeys.cjs <designer.js> <widget-caps.js>
   OK 3 (the backup fails it, as it should).
2. design.js widgetList: a stack's top level o.turn reaches its settings (phone shows Every minute for 60).
3. widget-detail.js Picks full screen subtitle follows Picks from (mine, others, everyone).
4. design.js Hold OK on a stack showing a widget with nothing to set: note "Nothing to set for the widget showing now."
5. setup.html (generic): a many choice setting with max takes no more ticks (Pick up to N., the rest disabled);
   widgets.js R.upnext uses at most the caps max (6) apps.
These screens' words are English only (design.js notes, widget-detail, setup.html have no language blocks).
Tests: test_ws2_watching 230 pass; test_ws_tv 1115 OK; test_widget_detail_browser 296 OK; test_ws_schema 4430;
test_widget_caps 4548; all 61 node files pass.

## Gate 3 (checker's size probe): settings that did nothing where there was room, and cut words (21 Nov)
New test tests/test_ws2_watching_visible.mjs (from the checker's gate3 probe, shaped like wt-ws2-weather's
test_ws2_weather_visible.mjs): 14 kinds, every listed size, every setting vs default, 10:00 and 19:30, visible
characters; SAME holds 50 cases, each with its reason. WS2_SOFT=1 lists every failure; scratchpad/watching-vis.sh
runs it soft under the lock (log in scratchpad/watching-out/visible.log).
Fixes in widgets.js:
- nowplaying: Previous, play, next under the song in the upright layout when b.h >= 560.
- appgrid: sized in the inner box (b.w-48, b.h-48); small takes Apps across (default 2); rows only while an app
  keeps 72 px and its name (maxRows = floor(H0/(72+gy+nameH)), the margins are gy a row), more across otherwise;
  names fitted (fitT, a cell wide) instead of cut.
- keeprow: at most what fits (260 px a show), posters sized inside the padding (they spilled 24 px each side,
  which made the fitting pass clamp titles), titles fitted like Picks.
- keep tile (b.h < 300) and games: titles fitted (fitT) and fitLater called (fitT does nothing without it).
- soundscape wide tile: "Volume N%".  upnext title line-height 1.22 (a glyph is 1.2 em tall).
Help words (widget-caps.js): keeprow shows "At most what fits in the widget."; nowplaying buttons "... A tile or small
widget has no room for them."; queue count "At most this many."; appgrid names "Not shown on a small grid.";
folder name "... On a tile it shows when the folder is opened. ..."; folder Apps across "... A tile always shows
four small apps." (ACROSS takes an extra sentence; App grid keeps "How many apps in each row.").
Tests: test_ws2_watching_visible 1727 pass (592 cases, 154 same by design, 50 named); test_ws2_watching 231
(new: folder tile name shows when opened; the App grid check is 800 high, room for 4 rows of names);
test_widget_fit_all OK 8 (1640 boxes, 0 problems); test_ws_tv 1115; test_widget_detail_browser 295 (296 before:
its only conditional checks are the Right/Left or Down/Up moves inside a layer); test_design_settings_browser 108;
test_ws_schema 4445; test_widget_caps 4548; 61 node files pass.

## Next steps
None in scope. Branch is ready to merge.
Nothing runs on the MacBook or an emulator.
