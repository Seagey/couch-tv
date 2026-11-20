# RESUME ws2-home (widget swarm round 2, group "home")

Brief: scratchpad swarm2-common.md (also summarised here). Kinds: agenda, people, note, list, guide, welcome,
memory, screentime, wifi, card, photo, slideshow, mosaic, artframe. Every setting wired and pre: true.

## Done (committed as WIP)
- widget-caps.js: HOME_SET block (all 14 kinds, 27 settings, all pre: true). Old pre:false entries for these kinds removed.
  New tvlist sources "guide" and "cards"; many tvlists (people.who, guide.sections) default [].
- design.js: OPT byline, done, ago, range, appcount; WOPT people "names", note "align byline", list "+done", memory "align range ago", screentime "align appcount".
- widgets.js: renderers read settings (setting()/wsetOf, validated): photo id fix (photoIds), slideshow seconds_each + shuffle (mixed()),
  mosaic count ("auto" bug fixed), artframe mat (TV value only from the four), people who/names, card label/text/live,
  agenda calendars (main/bookings/all, agendaEvents) + days (today/two/week), note byline, list done, guide sections (guidePart),
  wifi hidepass, welcome text/sub/source/times, memory range/ago, screentime appcount. kit exports guidePart, agendaEvents, memoryList, memoryWeek.
- widget-detail.js: agenda layer uses agendaEvents; wifi layer hidepass; guide layer guidePart; photos layer memoryList + ago.
- app.js: tvlistOptions calendars (all/main/bookings), guide, cards; homeView photoIds, books (stays as Check in / Check out events), memory.week; ahTick reads bookings for the agenda; booksSet/booksEvents.
- athome.js: nearDay(photos, today, days).
- tests: test_ws_schema.js (TVLISTS + guide, cards; many tvlist default list; agenda left LATER), test_design_settings_browser.mjs
  (Welcome, Wi-Fi, Guide now have settings: expectations updated), new tests/test_ws2_home.mjs.
- Real data checked: public Google holiday .ics fetched with curl and parsed by CouchAtHome.parseIcs (5 events, all day); bridge custom_cards.clean gives titles.

## Status of tests
- node tests/test_ws_schema.js: All 4053 passed. test_widget_caps.js: 4548. test_athome.js: 72. test_design_widgets.js: 221.
- tests/test_ws2_home.mjs: part A (every setting drawn) passes; part B was failing at "agenda in Home settings, Widgets on this home"
  (debug print added: "(Designs rows: ...)"). Fix that, then run to green.

## Next steps
1. Run test_ws2_home.mjs (take the browser lock first: mkdir scratchpad/browser.lock, wait 30 s if it exists, rmdir after):
   COUCHTV_PLAYWRIGHT=<the tools/tv-designer/market folder beside couch-tv> node tests/test_ws2_home.mjs
2. Then test_ws_tv.mjs, test_design_settings_browser.mjs, test_widget_detail_browser.mjs, test_widget_fit_all.mjs (same lock), fix what my kinds broke.
3. Commit (no push/tag/bump), report table to the coordinator.
Nothing runs on the MacBook or an emulator.
