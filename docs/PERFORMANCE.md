# Measuring how the home runs on your TV

If moving along the rows feels slow, or you want to know how much memory the home uses, measure it
instead of guessing. `tv-home/tools/bench-tv.py` reads the TV over ADB and prints one block you can
paste into an issue. It has no address, network name, serial number or account in it.

## Run it

You need the same setup as `apply.sh` (ADB to the TV, `.venv` with the bridge requirements; see
[SETUP.md](SETUP.md)). With the TV on and the home in front:

```sh
TV_IP=<your tv address> .venv/bin/python tv-home/tools/bench-tv.py --look night --lighter yes --render-height 720
```

It takes about 40 seconds. It moves the focus right three times and left three times, three rounds,
and reads what the screen really showed. It changes no setting.

| Option | What it does |
|---|---|
| `--look`, `--lighter`, `--render-height` | Only label the result (the TV does not tell the tool which look or settings you use). Say what you have set |
| `--moves N` | More rounds of moving the focus (default 3, at most 20) |
| `--cold-start` | Also times a cold start (`am start -W` after a force stop). It **restarts the home**, so the Home button watch is switched off and on again afterwards, as `apply.sh` does; the tool checks it is running again and says so if not |
| `--json` | Prints JSON instead of the table |

## Reading the result

| Line | What it means |
|---|---|
| Moving focus | The time between frames the screen showed. About 60 fps (17 ms) is smooth. About 30 fps (33 ms) with a page that itself runs at 60 means the GPU cannot composite the home at the screen's size: try `"render_height": 720` ([CONFIG.md](CONFIG.md)). A few slow frames at the start of a move are normal |
| Home process | The home's own memory (PSS). Graphics is the part the GPU holds, usually the biggest. It falls by about a third while another app is in front |
| WebView renderer | The WebView's separate process. If other apps on the TV use a WebView at the same time, they are counted here too |
| Memory (TV) | Total RAM, what Android calls available, and how much has been swapped out. A TV with a lot swapped out is short of memory whatever the home does |
| Cold start | From a force stop to the first frame. One run varies a lot (1.3 to 2.5 s over five runs on one TV), so run it a few times |

The numbers move with what is on screen and what else is running, so treat one run as a data point.
Why the frame time is read from SurfaceFlinger and not from the page: the page's own timer cannot see a
screen stuck at 30 frames a second (#197).

## Lighter home by itself, and what the Night dock costs (0.13.9)

31 people on the owner's socials said the home was laggy, many on 4 GB boxes (a Google TV Streamer, Homatics,
TCL, Sony, Fire TV; #197, #213). Lighter home turned itself on only at 1 GB, and a TV reporting 4 GB or more was
never measured, so it never got it. Since 0.13.9:

- Only 8 GB or more skips the check. Anything else, 4 GB included, measures its frames for 1.5 s, 20 s after the
  home opens and only while it is showing (kept for a week), and also times the frames while the focus really
  moves along a row (arrow presses from 30 s on, 90 frames, nothing runs between presses).
- Slow means a median frame over 22 ms or over 1.3 times the screen's own frame time, measured at rest first, so a
  smooth 30, 25 or 24 Hz screen is not a slow TV. A stutter while moving is a strike; a second start within a week
  that stutters too turns Lighter home on, and that answer is kept for 30 days.
- A median frame over 250 ms is not a slow TV but a screen that was not drawing: a 2021 Samsung Frame (Tizen 6,
  2 GB) kept a 2849.7 ms reading taken in Art Mode, where the app stays loaded and believes it is visible, and ran
  Lighter home for days on it. With its screen on it measured a 19.2 ms median (13.1 ms at rest). Such a reading,
  kept or new, now decides nothing, is not kept, and is measured again a minute later.
- The home then says once: "This TV is a bit slow, so Lighter home is on. Home settings, Look and scenes to change it."
- A choice in Home settings or `home.lighter` always wins.

What moving along the Night dock costs, measured in Chromium on a desktop Mac with the CPU slowed 6 times
(Chrome's throttle), 16 arrow presses, from a trace of each frame (`tests/test_lag_perf_browser.mjs`). "Main" is
the page's own thread, "commit" handing the frame's layers on, "draw" compositing it (in software here; the
GPU's job on a TV). Each figure is per arrow press; the lines with a range are 2 or 3 runs.

| Home | Main | Commit | Draw |
|---|---|---|---|
| Night, Glass panels on, as on integrate-0.13.9 | 10.4 to 10.8 ms | 5.7 to 5.8 ms | 7.7 to 7.8 ms |
| the same, cut 1 (no empty weather layers) | 4.4 to 6.6 ms | 0.7 to 1.3 ms | 7.3 to 8.7 ms |
| the same, cut 1 and cut 2 (no live blur on the people and quick buttons) | | | 4.0 ms |
| Night, default (Glass panels off), as on integrate-0.13.9 | 5.6 to 7.5 ms | 0.9 to 1.2 ms | 5.8 to 6.3 ms |
| Night, default, this release | 5.6 to 8.6 ms | 0.5 to 1.0 ms | 5.2 to 6.0 ms |
| Night, Lighter home | 5.5 to 7.5 ms | 0.5 to 0.7 ms | 0.7 to 0.8 ms |

One run of the test on 21 Nov 2026 (median of three each): Glass on as on integrate-0.13.9 main 13.4, commit 6.9,
draw 10.1 ms; cut 1 only 6.4, 0.6, 9.9 ms; both cuts 7.8, 0.8, 4.8 ms; the default home 6.2, 0.8, 5.4 ms; Lighter
home 4.9, 0.4, 0.7 ms.

The top costs, found by switching one thing off at a time:

1. **Two empty full screen layers.** The weather canvas and the lighting tint stayed in the page with the weather
   effects and the sun's colour off. With Glass panels on they made every panel and tile above them a layer of its
   own, so each frame took 5.8 ms of commit. They are now only in the page while one of them is in use.
2. **The live blur on the small top panels.** Every blurred panel is drawn again on every frame the dock moves,
   and each one is a blur of its own. With Glass panels on, the people pill and the quick buttons were half the
   drawing (7.7 to 4.0 ms with them flat). They now keep their tint with no blur; the dock, the cards and the date
   keep their glass. With Glass panels off the saving is small (about 6%).
3. What was left is the blur behind the dock, the cards and the date (0.3 to 1.5 ms of drawing each), and Lighter home takes all
   of it away: under an eighth of the default home's drawing. That is why a slow TV now gets Lighter home by itself.
   The focused tile's sway made no measurable difference (it already stops 6 s after the last press).

These are browser figures, not a TV's: no TV was measured for this release. To check yours, run
`tv-home/tools/bench-tv.py` (above) before and after, with Lighter home on and off.

## Reported by people using it

Add a row by pasting your result in an issue, or in a pull request that adds the row here.
Please keep the TV model, the settings you labelled and the numbers; leave out anything personal.

| TV | Android, chip / GPU | RAM | Look, Lighter, render_height | Moving focus | Home / renderer memory | Cold start |
|---|---|---|---|---|---|---|
| XGIMI Elfin Flip Plus (WK03C), 0.13.x | 11, MediaTek (m7332) / Mali-G52 | 1.7 GB | Night, on, 720 | about 57 to 58 fps (median 17.3 to 17.6 ms) | 120 to 136 MB / 68 to 80 MB | 1.3 to 2.5 s (5 runs) |
| The same TV with the home at the screen's size (1080), before `render_height` (#197, #278) | the same | 1.7 GB | Night, on, none | about 30 fps (median 33.3 ms) | about 250 MB for the home | not measured |
