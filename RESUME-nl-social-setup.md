# nl-social-setup resume notes

Brief: g12 "Can't connect?" check + Copy a report (setup.html, Server.kt), g16 Start here pages + Studio help article + video shot lists (coord/), g09 LG docs.

## Done (committed)
- on-tv ConnectCheck.kt (diagnose, mask, sameNetwork, report, Android facts) + ConnectCheckTest.kt (15 tests)
- Server.kt: one route GET /api/adb/check; Adb.kt: portOpen made public
- on-tv/web/connect-check.js (UI + words in the 16 phone page languages); setup.html: 3 small hunks (script tag, `<div id="cc">` under adb-msg, mount line before load())
- tests/test_connect_check_browser.mjs (stand-in TV; every code, unreachable by drop and by hang, copy via clipboard API and via the box on a non-secure host, all 16 languages)
- docs/START-HERE.md (Google TV phone, Android TV phone, Samsung computer), linked from docs/README.md and docs/SETUP.md
- docs/LG.md "If LG says no"; docs/TROUBLESHOOTING.md two new sections
- TD: help/src/articles.mjs new article phone-keys (backup in scratchpad/td-backup-nl-social-setup/help), help rebuilt (only phone-keys/, index.html, index.json, all.txt, src/paths.txt changed)
- coord/START-HERE-VIDEO-SHOTLISTS.md (not queued)

## Scripts
- scratchpad/nlss/run-phone-tests.sh (browser lock; 4 phone page browser tests)
- scratchpad/nlss/gradle.sh testDebugUnitTest (gradle lock)

## Not done
- step photos from a real TV in START-HERE (needs an owner-approved TCL/Frame session)
- tools/ig-comment-dm/facts.md LG lines (buildlist row; not in this brief)
