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

## Next steps
1. Rerun browser suites (one at a time, under the lock):
   zsh <session scratchpad>/watching-run.sh test_widget_fit_all.mjs test_ws2_watching.mjs test_ws_tv.mjs test_design_settings_browser.mjs test_widget_detail_browser.mjs
   Results: scratchpad/watching-out/summary.txt and <test>.log. Lock rule: mkdir scratchpad/browser.lock first, rmdir after.
2. Fix anything red, commit, report to the coordinator (table per kind).
Nothing runs on the MacBook or an emulator.
