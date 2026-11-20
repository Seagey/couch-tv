# RESUME ws2-home (widget swarm round 2, group "home")

Brief: coord/swarm2-common.md and coord/resume-builder-brief.md. Kinds: agenda, people, note, list, guide, welcome,
memory, screentime, wifi, card, photo, slideshow, mosaic, artframe. Every setting wired and pre: true.

## Done (committed)
- widget-caps.js: HOME_SET block (all 14 kinds, 27 settings, all pre: true). No pre:false left for these kinds.
  New tvlist sources "guide" and "cards"; many tvlists (people.who, guide.sections) default [].
- design.js: OPT byline, done, ago, range, appcount; WOPT people "names", note "align byline", list "+done", memory "align range ago",
  screentime "align appcount" (agenda "days" and slideshow "shuffle" already in WOPT).
- widgets.js renderers read every setting; widget-detail.js layers follow them; app.js tvlistOptions (calendars, guide, cards),
  homeView photoIds, books (bookings stays as Check in / Check out), memory.week; athome.js nearDay.
- "agenda left LATER" is gone: agenda.calendars and agenda.days are pre: true and wired (renderer agendaEvents/agendaOf, tested).
  test_ws_schema.js now has a HOME block: each of the 14 kinds has exactly its keys, every one pre: true, every design key
  in design.js WOPT itself; slideshow.shuffle and agenda.days removed from PENDING_WOPT.
- tests/test_ws2_home.mjs fixed and GREEN: 263 checks (A 105, B 76, C 82). Fixes were in the test only: headings are .shead
  (not .srow); phone page reloaded via about:blank (same URL with # did not reload); mock people ids are alex/sam/jordan;
  mosaic tiles counted by DOM; card "each in turn" rotates every 20 s so its cleared check reads the stored setting; the
  mock gives both calendar links the same ICS, so the bookings check asserts only stays (Check in/out), no Late swim.
  Debug print removed.
- test_design_settings_browser.mjs: expectations updated for my kinds (Welcome words, Guest Wi-Fi, House guide now have settings;
  #widget=f opens Guest Wi-Fi's box; the "nothing to set" path now uses the App grid "a"). GREEN: 108 checks.

- Studio photo (branch nl-photo): Photo and Art frame draw a photo put in the widget in couch-tv Studio (opts.image, a JPEG
  data: URL from the store) over the photo picked on this TV, with Fill or fit and the frame colour still applied; without
  one, the picked photo shows. New tests/test_ws2_home_photo.js: 94 checks. nl-photo's own tests/test_widget_own_photo.js
  run against this branch: 116 pass (not copied in, it comes with nl-photo). The Photo pick's help now says a Studio photo
  shows instead.

## Test counts (21 Nov, final, all from this worktree via scratchpad ws2home-browser-run.sh, own results folder ws2home-results)
- node tests/test_ws_schema.js: 4130 passed. test_widget_caps.js: 4548. test_athome.js: 72. test_design_widgets.js: 221.
  test_ws2_home_photo.js: 94.
- Browser: test_widget_detail_browser.mjs 296. test_widget_fit_all.mjs 8. test_ws2_home.mjs 263 (second green run).
  test_ws_tv.mjs 1115. test_design_settings_browser.mjs 108.

## Left
Nothing in scope. Branch finished (no push, tag or bump). Merge note: no file in common with nl-photo, so the two merge cleanly (checked with git diff --name-only
against integrate-0.13.9).
