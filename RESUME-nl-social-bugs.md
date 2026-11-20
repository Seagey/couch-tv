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
