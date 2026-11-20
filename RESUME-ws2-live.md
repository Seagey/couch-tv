# Resume: ws2-live (widget swarm round 2, group "live")

Worktree: tools/couch-tv/wt-ws2-live, branch ws2-live off integrate-0.13.9 (4a705fe). No push, tag or version bump.
Brief: scratchpad swarm2-common.md. Kinds: sports, news, stocks, commute, word, quote, ask, agent.

## Done (all wired, every setting pre: true)
- sports: league, team (real picker from ESPN's ladder `apis/v2/sports/<path>/standings`, CORS open; ESPN's
  /teams list has no CORS header so a TV page cannot read it), games (every / live and my team / only my team).
  Cricket has no ladder: typed team checked against teams in its games. Out of season: "Season over",
  "Starts 17 Mar"; Big Bash whole names (ESPN short names are letters). Team from another competition: refused
  on phone (designEdit), said on the widget.
- news: feed, count. stocks: tickers (honest help, bad codes said, no-price codes said), price.
- commute: to, arrive_h, arrive_m, buffer, weekdays, from. quote: mood, text, sub. word: lang (es fr it de ja
  lists in widget-words.js), meaning. ask: keep. agent: keep, who (ask.js drawAsk/drawAgent).
- design.js OPT/WOPT: team (no tokens, digits only in short words), mood, lang, meaning, keep, who.
- Shared hunks (report these): app.js wsOptions(s, w) + teamOptions/teamCheck, team choice row on TV,
  team typed validation, designView team as choice, designEdit team check, wsSet ticks loader for
  news/sports/stocks too. widget-detail.js B.ask keep, B.sports which games.
- Tests: tests/test_ws2_live.mjs (node 116 + browser; fixtures tests/fixtures/widgets-data/live-20261120,
  real answers saved 20 Nov 2026). Updated expectations: test_ws_schema.js, test_widget_sports.js,
  test_widget_pause.js, test_design_settings_browser.mjs (news count now offered), test_web_widgets_browser.mjs
  (sports maxAsks 2: scoreboard + ladder).

## Results so far
- test_ws2_live.mjs fixture mode: 200 passed (before the ladder switch; rerun pending).
- test_ws_schema 3889, test_widget_caps 4545, test_widget_sports 72, test_widget_pause 36, all node tests/test_*.js green.
- test_ws_tv 1115, test_widget_detail_browser 296, test_widget_fit_all 8 (1640 boxes, 0 problems),
  test_phone_settings_browser 129, test_design_settings_browser 107, test_web_widgets_browser 48.
- LIVE: node probes hit ESPN (7), Yahoo, OSRM, 8 RSS feeds: all real answers. Headless Chromium is refused by ESPN
  (403 for "HeadlessChrome"), so LIVE=1 routes the page's requests through node fetch.

## Next steps
1. Run under the browser lock: `zsh <scratchpad>/live/locked.sh test_ws2_live.mjs LIVE` (lock dir
   scratchpad/browser.lock; script waits for it and always removes it). Fix anything red.
2. Rerun test_design_settings_browser, test_web_widgets_browser, test_ws_tv, test_widget_detail_browser,
   test_widget_fit_all once more after the ladder switch.
3. Commit (privacy hook: no home suburb, no private IPs, no fixture with emails/phones), then report table.
Nothing runs on the MacBook or an emulator.
