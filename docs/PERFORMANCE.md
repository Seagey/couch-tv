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

## Reported by people using it

Add a row by pasting your result in an issue, or in a pull request that adds the row here.
Please keep the TV model, the settings you labelled and the numbers; leave out anything personal.

| TV | Android, chip / GPU | RAM | Look, Lighter, render_height | Moving focus | Home / renderer memory | Cold start |
|---|---|---|---|---|---|---|
| XGIMI Elfin Flip Plus (WK03C), 0.13.x | 11, MediaTek (m7332) / Mali-G52 | 1.7 GB | Night, on, 720 | about 57 to 58 fps (median 17.3 to 17.6 ms) | 120 to 136 MB / 68 to 80 MB | 1.3 to 2.5 s (5 runs) |
| The same TV with the home at the screen's size (1080), before `render_height` (#197, #278) | the same | 1.7 GB | Night, on, none | about 30 fps (median 33.3 ms) | about 250 MB for the home | not measured |
