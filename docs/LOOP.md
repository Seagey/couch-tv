# The Loop look

A fourth look for the home, next to Night, Classic and OLED. The background is one video of a
place, looping, graded for four times of day; the interface is a caption set on it: a centred
clock under the date line, five bare thumbnails, a row of icons with no bar, and frosted glass on
the two quick buttons; the toast and everything else take the same recipe without the blur. Nothing
else moves: the picture is the only thing that does.

The design is one place, a jagged peak reflected in a still lake with a slow drone push over the
water. Any clip with a slow push over a still subject works the same way.

## What it needs

- **Option B, the bridge.** The bridge computer makes the footage with ffmpeg and serves it; the
  TV streams it from there. The launcher's offline copy of the home (for when the computer is off)
  never holds the video: it shows the poster, a still of the loop (with the clock behind the peak
  when the loop has its cut-outs), with everything else as usual.
  Option A and option C have no bridge, so no footage: the look is still in the cycle there and shows
  its scrim over a dark ground.
- **ffmpeg 7 on the bridge computer** (Debian: `sudo apt install ffmpeg`). Not on the Mac you set
  things up from, unless the bridge runs there.
- **One clip**, yours or a stock one. See the next section.

Switch it on with `"look": "loop"` under `home` in `config.json` ([CONFIG.md](CONFIG.md)), or on
the TV in Home settings, Look, where Look cycles to Loop whether or not the files are there (without
them it shows its scrim over a dark ground until `make-loop.sh` has run and the home reloaded).
Night, Classic and OLED are untouched by any of this.

A couch-tv Studio design is not drawn in the Loop look: the home starts no design there (no design
picture, layers, widgets or video behind the loop), so nothing decodes a picture that the loop would
cover. The design shows again as soon as you pick another look. In the Loop look Home settings,
couch-tv Studio says so in a "Your design" row that switches to Night, getting a design by its code
switches the home to Night so the design's question comes, and Studio's own preview (`?designer=1`)
always opens in Night. In Home settings the Loop look also
leaves out the Glass panels and Mac-style dock rows: it has its own glass and its own dock.

## Picking the footage

- **Where from.** Your own clip, or a free stock clip from Pexels or Pixabay (their licences allow
  it; search "aerial mountain lake reflection" or "drone alpine lake dusk"). Apple's aerial
  screensavers may not be used: they are Apple's and not licensed for this.
- **What works.** A slow aerial push over a still subject, 20 seconds or longer (a second more
  than the loop you want), 1080p or 4K, no people, the sky not blown out. The movement should come
  from the camera, the clouds and the water, not from anything that would jump at the wrap. A
  60 fps clip can be slowed to half speed with `--slow 2`.
- **Which to avoid.** Anything with a person, a car or a bird crossing the frame; a push so fast
  the wrap shows; a clip shorter than the loop plus one second.

## Making the files

On the bridge computer, from the repo:

```sh
scripts/make-loop.sh ~/Downloads/lake.mp4
```

It writes `tv-home/web/loop/` (git ignores the folder; never commit it), seventeen files:
`dawn.mp4`, `day.mp4`, `dusk.mp4`, `night.mp4`, a `-blur.mp4` copy of each, a `.jpg` and
`-blur.jpg` poster of each, and `loop.json` (below). A photo made with `--matte` also has a `-fg.png`
cut-out of each (the depth effect, below), twenty-one files in all. The bridge lists the folder afresh
on every read of `config.js` and marks the files with a version the home puts on each address, so no
restart: pick the Loop look, or press Home to reload it, and the new files play.

**A run never leaves the folder half made.** The script makes every file in a hidden folder inside
`loop/` (`.staging-<number>`, every name in it starting with a dot, so neither the bridge nor the
offline copy lists them) and moves them into place only once every encode has worked. A full run takes
the old `loop.json` away first, moves each variant's sharp `.mp4` in after its blurred copy, posters
and cut-out, and puts the new `loop.json` in last; a run without `--matte` removes any older cut-outs,
which would not match. A TV that loads the home during a run gets the old loop, or for the moment of
the move the new files with no cut-out (the clock in front), never half a file or new footage under
the old motion. A run that fails, or that you stop with Ctrl-C, removes the hidden folder and leaves
the files as they were.

Options: `--seconds 45` for a longer loop (15 to 60, default 30), `--slow 2` to slow the clip,
`--only night` to remake one variant after changing its grade (with the same `--seconds` and
`--matte` as the run that made the others: `loop.json` is one file for all four, so the script refuses
an `--only` run that would change it), `--out <dir>` for another folder,
`--matte <image>` for the depth effect (a photo only), `--dry-run` to print every ffmpeg command and the
`loop.json` it would write, and write nothing. A run takes a few minutes per
variant on a small computer: the encode is `-preset slow` on purpose, for the smallest file at
the quality.

What each file is:

- **The sharp file**, 1280x720, H.264 main profile level 4.0, yuv420p, 30 fps, one keyframe a
  second, crf 20 capped at 4 Mbps, no sound, 13 to 20 MB each. The pixel format and level are
  pinned so a 10 bit source cannot make a file the TV refuses. The seam: the last second dissolves
  into the first with ffmpeg's xfade, so the last frame flows into the first and no frame is shown
  twice (a frame hold would replay half a second of the push at every wrap). The script's header
  has the arithmetic.
- **The four grades.** Day is the clip as it is. Dawn warms the highlights and cools the shadows;
  dusk warms the midtones and darkens a little; night darkens, desaturates and blues the shadows.
  They are a ladder, neighbours differing mostly in warmth and level, so the cut between two reads
  as a cloud passing. The values in the script are a starting point: change them there and run
  `--only <variant>`.
- **The blurred copy** (the glass, below), 160x90, blurred, 10 fps, crf 26 capped at 300 kbps,
  under 1 MB, cut from the finished sharp file so it has the same seam and length.
- **The posters**, 960x540 JPEG, the first frame of the sharp and of the blurred file. The home
  shows them until the video plays, and the launcher's offline copy shows them in place of the video
  (which is streamed from the bridge, never saved on the TV).
- **`loop.json`**, written once per run: the loop's length and motion, which the bridge passes to the
  home as `home.loop.meta`. For a photo `{"still": true, "seconds": 34, "fps": 30, "zoom": 0.06,
  "sway": 0.3, "fg": {"x": 480, "y": 162, "w": 960, "h": 318}}` (`fg` is null without `--matte`), for
  a clip `{"still": false, "seconds": 30, "fps": 30, "zoom": 0, "sway": 0, "fg": null}`. The bridge
  ignores a file whose numbers are out of range (seconds 15 to 60, fps 30, zoom 0 to 0.2, sway 0 to
  1, the rectangle in whole pixels inside 1920x1080), or one without `sway` (the first version's
  `drift`, a different motion), and says so once in its log.

**Colour.** Every encode is converted to BT.709 limited range (the HD standard) and tagged as such
(`-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`), and the posters to
JPEG's own BT.601 full range. An untagged file leaves the TV's decoder to guess the matrix, and a guess
of BT.601 for a BT.709 file moves the colours by a few levels: unseen on its own, but a box around the
cut-out, whose colours ffmpeg decoded, would show it. Tagged, the TV and ffmpeg turn the same YUV into
the same RGB.

The footage stays on the bridge computer: only the bridge's own copy of the home plays it. What each
other copy of `tv-home/web` takes from `loop/`, so a computer that has run `make-loop.sh` still builds
apps of the usual size:

- **The launcher's offline copy** (`/tv/manifest.json`, option B): everything but the video
  (`loop/*.mp4`). The posters, the cut-outs and `loop.json` are small, so a Loop home with the
  computer off shows the still of its loop with the clock still behind the peak.
- **The TV home app** (`scripts/build-apk.sh`): the posters (`loop/*.jpg`) only.
- **The on-TV app (option C), the LG app and the Samsung app:** nothing from `loop/`. The on-TV app
  has no bridge to stream from; the LG and Samsung apps read the loop from the bridge's `/tv/loop/`.
- **The standalone site** (`scripts/build-standalone.sh`): the posters only, and its `config.js`
  turns the cut-out off (`home.loop.fg` false, no `meta`), so the page never asks for one. The site is
  public to anyone with its address, and the posters are stills of the photo or clip you made the loop
  from: the script says so when it finishes.

## The four variants and when each shows

The home already works out the sun's height at `weather.lat` and `weather.lon` (`sunPhase()` in
`app.js`), so it picks the variant itself:

| Sun | Variant |
|---|---|
| below -6 degrees | night |
| rising, -6 to +10 degrees | dawn |
| above +10 degrees | day |
| setting, +10 to -6 degrees | dusk |

`sun_sync` (Follow the sun, in `config.json` or Home settings, Look, Scenes) is the switch: on,
the variant follows the table; off, it is day all day. The change is a cut at the loop's wrap,
held while the remote is moving, with the new posters decoded first so nothing goes black. There
is no crossfade: with the glass copy that would be four videos decoding at once.

The bridge tells the home which variants it has (`home.loop` in `/tv/config.js`, read only), so
the home only ever asks for a file that is there.

## The glass copy, and why it exists

Frosted glass drawn with `backdrop-filter` blurs whatever is behind it again on every frame, per
element. Over a video that is a blur of a whole region sixty times a second; the Lighter setting
already had to take it out of today's home over still photos. So in the Loop look the blur is
baked into a file: the bridge serves a 160x90 blurred copy of the playing variant, the home plays
it in a second, hidden video kept in step with the sharp one, and shows it only through the shapes
of the glass (the two quick buttons) with a mask the page rebuilds only when a button appears or
leaves. The toast takes the same shape on the no blur tint: the Cube measurement below decided that.
Nothing is blurred per frame. The two videos drift
apart a little at each wrap, and the page pulls them back together; through a blur that does not
show.

`home.loop.blur` is true only when every present variant has its `-blur.mp4`. Without it the home
uses the fallback recipe: the same shapes, a slightly darker tint, no blur behind them.

## Measured on a Fire TV Cube, 18 November 2026

A synthetic 720p 4 Mbps 30 s loop and a 160x90 blurred copy, served by the bridge, in the real
launcher's WebView (Fire OS 7.7, 2 GB):

- **The sharp video alone:** the launcher at 156 MB (PSS), 80 MB of GPU textures, 21 percent CPU,
  frame times 10 ms at the median, 19 ms at the 90th and 25 ms at the 99th percentile, 0 dropped
  frames of 2800. The video costs more GPU than the design guessed (the WebView copies each frame
  into a texture rather than overlaying it), and the whole page is still about 100 MB under what
  today's home peaks at (250 MB).
- **Two videos, the blurred copy masked to the two 64 px quick buttons:** 153 MB, 82 MB of
  textures, 31 percent CPU, frames 7, 17 and 24 ms; the two elements within 0.16 s of each other
  with small playback rate nudges and one seek at the wrap; the blurred copy dropped about 77
  percent of its frames, which does not show behind a blur. That is why the blurred copy is
  encoded at 10 fps.
- **The same with a toast sized mask (about 1314x484):** 100 MB of textures (18 MB more), the
  compositor ran on every video frame, 38 percent CPU. So the glass shows through the mask only on
  the two quick buttons; the toast takes the fallback recipe, as do the all apps panel, the dock,
  the cards and the plates.
- The WebView plays a muted inline video by itself (the launcher allows it), and seeks inside a
  fully buffered file work.

These numbers are for the video and its glass. They were taken before the photo loop and the depth
cut-out were added, so the cut-out (one 640x212 picture moved by a CSS animation) is not in them.

## If it stutters

In this order, each one a smaller step than the next:

1. **Glass off:** remove the `-blur.mp4` files from `tv-home/web/loop/` (or never make them) and
   reload the home. `home.loop.blur` goes false and the home plays one video, the sharp one. (With
   no quick button on the home there is no glass to show, and the blurred copy already pauses.)
2. **Lighter home** (Home settings, Look, or `home.lighter`): the Loop look takes the fallback
   recipe everywhere, no second video, no mask.
3. **A shorter or lower loop:** `--seconds 20` makes a smaller file; a clip with less water and
   cloud movement encodes to fewer bits at the same cap.
4. **Another look.** Night, Classic and OLED are as they were.

A Loop look with no files is not an error: `home.loop.variants` is empty until the files are there,
and the home shows its scrim over a dark ground. When `config.json` sets `home.look` to `loop`, the
bridge also says so once in its log as it starts ("the Loop look has no files yet: run
scripts/make-loop.sh"). A Loop look picked on the TV (Home settings, Look, or the Look quick button)
logs nothing, so check `home.loop.variants` in `/tv/config.js` there.

**When something covers the home.** While Smart Idle's OLED Ambient Clock or a kids mode home is on
the screen, both videos pause and the cut-out hides, so nothing decodes behind them; when the home
comes back they start again, in step. With Hide rows when idle, or while the Ambient music screen is
open, the glass fades out with the quick buttons.

## A photo instead of a clip

`make-loop.sh` takes a photo too (`.jpg`, `.png` or `.webp`, or any file with `--still`): the loop
becomes a slow push into the picture and back out over its whole length, six percent at most, swaying a
little sideways, eased so the first and the last frame are the same window and the motion is
still at both. No seam, no footage to find, and the same four grades, blurred copies and posters. The
home's own scenes work: `tv-home/web/backgrounds/scene-night@2x.jpg` is the lake peak the design
mockup used (use the `@2x` file, the push crops into it). On the bridge computer:

```
scripts/make-loop.sh tv-home/web/backgrounds/scene-night@2x.jpg --seconds 34
```

The picture is scaled up four times the output width first so the push moves in quarter pixel
steps, which takes a few minutes per variant on a small box. A photo that is not 16:9 (a phone's 4:3,
a portrait) is cut to its centre 16:9 band, so keep what matters in the middle; a 16:9 photo is used
whole.

## The depth effect: the clock behind the peak

The original couch-tv design puts the clock behind the mountain: in the Night look, a transparent copy
of everything in front of the sky (`backgrounds/<scene>-fg.webp`) is drawn over the clock. The Loop look
does the same for a photo's loop, with one difference: the picture moves (the push and the sway), so a
still cut-out would slide out of register. It does not need to be still. The motion is a formula, so the
home moves the cut-out by the same formula, locked to the video's clock.

On the bridge computer, with the scene's own cut-out as the matte:

```
scripts/make-loop.sh tv-home/web/backgrounds/scene-night@2x.jpg --matte tv-home/web/backgrounds/scene-night-fg@2x.webp --seconds 34
```

The matte is any image with transparency, aligned with the photo: transparent where the sky is, opaque
in front of it. For your own photo, step 6 of [MAKE-A-SCENE.md](MAKE-A-SCENE.md) makes one
(`scene-<id>-fg.webp`). The matte may be smaller than the photo, at the same shape: the script
scales it to the 1280x720 frame and cuts it to the same centre 16:9 band as the photo, so the two stay
in register to within half a 720p pixel whatever the photo's shape.
`--matte` is for a photo only: a clip's own motion cannot be followed by a still cut-out, so the script
refuses it there.

**What the script makes.** For each variant, `<variant>-fg.png`, 640x212 RGBA:

- **Colour:** the finished sharp file's first frame, decoded as BT.709 limited range, so its colours are
  the video's, grade and all. The first frame is the neutral position: zoompan's zoom
  `z = 1 + 0.06*(1 - cos(2*PI*on/N))/2` is 1 at `on = 0`, which leaves no room to sway, so the window is
  the whole picture.
- **The rectangle:** x 480, y 162, w 960, h 318 on the 1920x1080 screen, around the clock and the peak.
  Each is a multiple of 3, so on the 1280x720 frame it is x 320, y 108, w 640, h 212 in whole pixels.
- **Alpha:** the matte scaled to 1280x720, the same crop, multiplied by `min(1, d/24)`, `d` the distance
  in 720p pixels from the pixel's centre to the nearest crop edge. A sub-pixel mismatch at the crop's
  border fades in over 24 pixels (36 on the screen) instead of showing as a seam.
- **The scrim, baked in:** the cut-out is drawn above the scrim, so its colour already carries it:
  `out = c*(1-a) + ink*a`, ink `#0B0A10` (11, 10, 16), `a = 1 - (1 - top)*(1 - bottom)`, `top` and
  `bottom` the scrim's two gradients (the same stops as `app.css`) at the row's screen y. A 720p row `Y`
  of the crop covers screen y `1.5*(Y+108)` to `1.5*(Y+108) + 1.5`, so its centre is
  `ys = 1.5*(Y+108) + 0.75`. It is one `geq` expression per channel with `st()` and `ld()`, which
  ffmpeg 7.1 has; `tests/test_make_loop.py` checks it against `app.css`.

The zoom and the sway are two variables in the script (`ZOOM=0.06`, `SWAY=0.3`), used by both
zoompan and `loop.json`, so the two can never differ. zoompan's window at frame `on` is
`iw/z` wide from `x = (iw - iw/z)/2 * (1 + 0.3*sin(2*PI*on/N))`: centred, then moved sideways by 0.3 of
the room the zoom leaves on each side, up to 11 screen pixels. The sway is a share of that room because
zoompan clamps `x` into it: the first version drifted by 0.6 percent of the width, which asked for more
room than there was in the first and last 4 s of a 34 s loop, and the video then left the formula by up
to 2.2 screen pixels, a doubled edge on the spire. zoompan also makes `x` and `y` whole pixels (even ones
for 4:2:0 input) and the window `int(iw/z)` wide, so the picture goes in as 4:4:4, each expression adds
0.5 to round, and `x` and `y` add half of what `int()` takes off the window. Simulated over the 1020
frames of a 34 s loop (`tests/test_make_loop.py` models zoompan's arithmetic), the video stays within
0.43 screen pixels of the formula at the cut-out's corners and on the peak, where it was 2.7.

**What the home does.** With `home.loop.fg` true (the bridge sets it when `loop.json` has the rectangle
and every variant has its cut-out), the home puts one image right after the clock, so it covers the
clock's lower part and stays under the date line and the buttons, at the rectangle, scaled about the
screen's centre. Its motion is zoompan's mapping in screen space: a point at x `p` at the neutral
position is at `W/2 + z*(p - W/2) - sway*(z - 1)/2*W*sin(2*PI*t/T)` at loop time `t`, which is
`translateX(-(sway*(z - 1)/2*100vw)*sin) scale(z)` about the centre. That runs as a CSS animation on the
compositor (keyframes every 2.5 percent, 0.11 px off at most), started with a delay of minus the video's
time when the video plays, again at each wrap, after a variant switch and when the home comes back;
held at 0, the poster's position, while a file loads, and where the frame stopped while the video waits
for data (a stall leaves the video's `paused` false, so the home goes by `readyState`); hidden while an
app is in front. While the Ambient music screen is open the cut-out is hidden (it keeps time, so it is
in place when the screen closes) and the clock and the date line go back up, clear of the album art. The clock and
the date line move down 80 px with it: the digits run from about y 231 to 405, and the spire, from
y 350, covers a little of the colon and the inner digits, each still readable. Lighter home keeps it,
since the video keeps moving.

One approximation: the scrim is fixed to the screen while the cut-out zooms, so at the deepest zoom a
row of the cut-out sits up to 11 px from where its scrim was baked, about 4 percent of opacity at the
peak's tip, which the eye does not separate from the picture around it.

**A preview** of the layering on a desktop: serve the repo root and open
`tv-home/web/index.html?mock=1&look=loop`. The Night look's whole frame cut-out stands over the night
scene's photo, with no motion (`depth=0` turns it off). It has no scrim baked in, so it looks brighter
than the TV's.
