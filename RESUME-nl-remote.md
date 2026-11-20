# RESUME nl-remote

Branch nl-remote (worktree wt-nl-remote), from integrate-0.13.9, with nl-haqr merged in (87fca2b).

## Done and committed (tests green)
- 4d7b3e0 pairing lock (S1, TV and bridge) and no dead code in the QR (S2)
- 69fa688 phone remote: Home settings on this phone, Widgets on this TV
- 472eddf plain words, tw_* TV words (16 languages), ds_* Send a design (11 phone languages)

## In progress (WIP commit): phone pages in every language
- tv-home/web/phone-words.js: language system and word table (361 lines x 15 languages, from the
  translations in the scratchpad pw/out-*.json). Follows Home settings' language (setup.html calls
  PhoneWords.set), the TV's ?l= on the Smart home QR, then the phone's own.
- tv-home/web/caps-words.js: empty shared table for widget-caps.js labels/help (TV tv-words.js and phone
  phone-words.js both read it). Not written yet: scripts/caps-words-todo.mjs (list caps labels/help with
  no line in caps-words.js, via CouchWidgetCaps.settings(kind) for every kind).
- setup.html loads /tv/caps-words.js and /tv/phone-words.js; ha-phone.html loads caps-words.js and
  phone-words.js (routes added: HaPhone.kt and bridge/haphone.py /ha/phone-words.js, /ha/caps-words.js).
- app.js: the Smart home QR link gets &l=<TV language>.

## Next steps
1. Add the "tv" entries of pw/src.json (nl-haqr Smart home rows) as tw_* keys in tv-home/web/i18n.js
   (all 15 languages from pw/out-*.json; addkeys.py in the scratchpad, indent 4 spaces).
2. Browser test tests/test_phone_words_browser.mjs: serve the repo, open on-tv/web/setup.html with a
   fake /api/* (settings.lang pl, then ar): Polish words, Arabic dir=rtl and lang=ar, a block with <b>,
   a pattern, the pairing box; ha-phone.html with ?l=pl; a caps-words entry injected translates on TV
   and phone.
3. scripts/caps-words-todo.mjs and a node test for it.
4. Run: node tests (all test_*.js and non-browser .mjs: 67 passed before), python3 -m unittest discover
   -s tests (1355 OK before), gradle on-tv testDebugUnitTest with the gradle lock (128 passed), launcher
   tests for HaPhone.kt if the tv-home gradle has them, the browser tests with the browser lock
   (COUCHTV_PLAYWRIGHT=".../tools/reel-machine").
5. Commit, report to the coordinator: nl-phonepage's bridge must also serve /tv/ (it already does) so
   setup.html finds the word files there.
