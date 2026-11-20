# RESUME ws2-home (widget swarm round 2, group "home")

Brief: coord/swarm2-common.md and coord/resume-builder-brief.md. Kinds: agenda, people, note, list, guide, welcome,
memory, screentime, wifi, card, photo, slideshow, mosaic, artframe. Every setting wired and pre: true.

## Done (committed)
- widget-caps.js: HOME_SET block (all 14 kinds, 28 settings, all pre: true). No pre:false left for these kinds.
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

## Checker NO-GO at d91973c, all 9 fixed (21 Nov)
1. athome.js nearDay: how long ago counts from the photo's own day (31556952000 ms a year), each item carries year;
   widgets.js and widget-detail.js show q.year. New Year cases in test_athome.js (80 checks).
2. app.js booksEvents: each day ends at the next calendar midnight (dayAfter), right on Sydney's 23 and 25 hour days.
3. widgets.js agendaOf: Studio's sample on This week shows its events.
4. Guest Wi-Fi (widgets.js, widget-detail.js): Hide the password only when there is a code to scan.
5. widgets.js mixed: Park and Miller count (48271 mod 2147483647), no number past 2^53; mirrored in test_ws2_home.mjs;
   kit.mixed exported for the spread test.
6. widgets.js agendaEvents: with every calendar, what was read shows; the error card only when neither was read.
7. Small sizes: memory.ago works on a tile (number, "years ago" under it); note.byline works from 140 px high (on a narrow tile
   the name alone, 23 px, as test_widget_fit_all requires; help says so); list.done on a wide tile counts the ticked ones ("2 left, 2 ticked"); screentime.appcount help says
   Medium or bigger. Fit checked in the browser with scrollWidth vs clientWidth at 160x160 and 360x160.
8. widgets.js photos(): a photo picked past the 50th is looked up in the whole list.
9. Words: 28 settings here; welcome needs say the words can be typed on the TV or the phone too.
New tests/test_ws2_home_dates.js (TZ=Australia/Sydney set inside): 33 checks; the DST check fails on the old app.js.

## Checker size probe (probe4) at b5c2c9e, fixed (21 Nov)
- Welcome on a wide tile: the line under is one small line ("Check out Mon 10:00am" there) and the greeting gets the
  rest; on a wide line (760x60) the greeting and the line under sit side by side.
- Note on a tile: the name line is 28 px and the words may go to 23 px. Guest Wi-Fi Small shows the password under the
  name, so Hide the password changes it; under 1000 px wide "Password in the code" and "Scan with a phone camera".
- Agenda tile: the event's own day ("SUN 22") and its time, the title on two lines; Agenda tall (under 600 px wide):
  each time on its own line. Custom card tile: a live number's title on two lines and the number fitted under it.
  Screen time tile: "5m over", "15m left", "On goal" or "Today".
- New tests/test_ws2_home_visible.mjs (from probe4): every kind, every listed size (line to full), every setting vs
  the default, words measured character by character, a SAME list of 24 with reasons, EMPTY_OK of 1. The clock is a
  time near 10:00 found so each slideshow setting and the card's each in turn really differ; photo picks are never the
  default photo. 334 cases, 951 checks.

## Test counts (21 Nov, after probe4, this worktree, scratchpad ws2home-browser-run.sh, results in ws2home-results)
- node: test_ws_schema.js 4130, test_widget_caps.js 4548, test_athome.js 80, test_design_widgets.js 221,
  test_ws2_home_photo.js 94, test_ws2_home_dates.js 33.
- Browser: test_ws2_home_visible.mjs 952 (334 cases, 24 SAME), test_ws2_home.mjs 269, test_widget_fit_all.mjs 8,
  test_widget_detail_browser.mjs 296 (295 on some runs: its focus round trip checks count only when the focus moves),
  test_ws_tv.mjs 1115, test_design_settings_browser.mjs 108.

## Left
Nothing in scope. Branch finished (no push, tag or bump). Merge note: no file in common with nl-photo, so the two merge cleanly (checked with git diff --name-only
against integrate-0.13.9).
