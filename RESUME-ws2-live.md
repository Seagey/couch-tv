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

## Results 21 Nov 2026 (resumed builder, after the ladder switch)
- test_ws2_live.mjs fixture mode: All 203 passed (node 116 + browser).
- test_ws2_live.mjs LIVE=1: All 195 passed against the real services. ESPN live answers, all 7 shown on
  the widget: afl 9 games "Starts 17 Mar"; nrl 1 "Season over", Roosters 19 v Knights 18; aleague 2,
  Western Sydney 4 v Adelaide Utd 2; epl 7, Man City v Fulham; nba 9, Hawks v Hornets; bbl 1 "Starts 12 Dec",
  Melbourne Renegades v Perth Scorchers; cricket 9, New Zealand 368 v India 159/1 live.
- node: test_ws_schema 3889, test_widget_caps 4545, test_widget_sports 72, test_widget_pause 36: all pass.
- Nothing red, so no code changed in this session.

## Results 21 Nov 2026, second resumed builder (06:00 to 07:00)
- Browser run under the lock (scratchpad live/locked.sh, log live/run-1121.log), all after the ladder switch:
  test_ws2_live 203, test_design_settings_browser 107, test_web_widgets_browser 48, test_ws_tv 1115,
  test_widget_detail_browser 296, test_widget_fit_all 8 (1640 boxes, 67 kinds, 0 problems),
  test_phone_settings_browser 129. All passed.
- node: every tests/test_*.js file, 61 of 61 pass (test_ws_schema 3889, test_widget_caps 4545,
  test_widget_sports 72, test_widget_pause 36).
- Nothing red, no code changed. Work is finished: final commit is not WIP.

## Next steps
None. Branch is ready to merge. Nothing runs on the MacBook or an emulator.
