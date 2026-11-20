# RESUME nl-social-bugs (couch-tv 0.13.9 builder)

Brief: coord/SOCIAL-BUILDLIST-0139.md rows g03 g05 g18 g29 g31 g32 g33 g34 g24; rules coord/nolater-common.md.
Branch nl-social-bugs off integrate-0.13.9 (4a705fe). No push, tag or bump.
Playwright: COUCHTV_PLAYWRIGHT=<workspace>/tools/tv-designer/market (see coord/swarm2-common.md), browser lock in the scratchpad.
Scratch: <scratchpad>/nlsb/ (run-browser.sh both|new|base, gradle.sh, node-suite.sh, base/ = integrate-0.13.9 export, remote-dist/ built remote).

## State (code in, tests written)
- [x] g31 bridge QUICK_IDS lacked bluetooth/network: tests/test_quick_buttons_saved.py (5), browser g31
- [x] g03 Keep watching gives up -> app banner, else title; asked again on view/online: browser g03, test_loop_look updated
- [x] g05 photo link reasons (404, page, blocked, too big, slow; stays under row; failed on home): browser g05, 16 langs
- [x] g18 bg clip releases decoder while away, photo until playing: browser g18
- [x] g29 pointer wakes on first real move on any TV: browser g29
- [x] g32 Samsung More keys (bridge KEYS + remote sheet): tests/test_social_bugs_bridge.py, tests/test_social_bugs_remote.mjs, 10 remote langs
- [x] g33 green frame detector (bg-video.js) for scene clips, video link, design video; week mark; Look note: browser g33
- [x] g34 /api/say/scene (bridge, on-TV Say.kt + SayTest), ask.js, app.js phoneScene, remote buttons: bridge, remote, browser g34
- [x] g24 icon packs (home.icon_set, Look Icon style, bridge keeps it): tests/test_icon_packs.py, browser g24. Own icons already exist since 0.13 (app-icons.sh)

## Done (21 Nov)
- tests/test_social_bugs_browser.mjs 82/82 (base integrate-0.13.9: 43 fail), test_social_bugs_remote.mjs 36/36 (base: g34 fails, g32 times out),
  test_ws_tv.mjs OK 1115, node 64/64 files, python 1301 passed / 7 failed (same 7 fail on base), SayTest 8/8.

## Checker NO-GO fixes (21 Nov, after d10600f)
- g33: detector now needs r,b <= 24, g 60..160, flat (max-min <= 16) on 95% of pixels, at both looks (1.5 s, 5 s) with means within 4.
  Writes only couchtv.video.green (never SLOW_KEY); a design's video goes for now with no week mark. Look row is now the action
  Try the video again (clears green and slow, restarts the clips); a new video link clears the green mark. Loop clips: not looked at (docs).
- g34 cause: STILL UNKNOWN. Checked: picking a scene in Home settings reloads the TV home when Home settings closes (restart()), and
  accepting a design reloads it (design.js:2217, ask.js after a phone design). Neither drops a phone remote by code: the phone talks to
  the bridge or to the on-TV app's own server (Server.kt, /api/events), which do not depend on the TV page; /api/phone-link only gives the
  pairing PIN and does not forget paired phones; the phone pages have no scene picker. The comment came from a phone remote app maker and
  most likely means the TV's own clicker goes missing when you want a scene, so the phone remote now has Previous/Next scene.
- Scene buttons only where the TV runs Couch TV's own home (not Roku, Apple TV); ask.js looks at /api/say every 30 s even with no design
  store or Ask AI (still every 6 s when it has them), so the buttons work everywhere within half a minute.
- Pointer wakes only after 8 px of movement within half a second.
- tests/test_fire_launcher_apps.py resets server._current: full python suite 1308 passed, 0 failed.
