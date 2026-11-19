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
  never holds the video: it shows the poster, a still of the loop, with everything else as usual.
  Option A and option C have no bridge, so no footage: the look is still in the cycle there and shows
  its scrim over a dark ground.
- **ffmpeg 7 on the bridge computer** (Debian: `sudo apt install ffmpeg`). Not on the Mac you set
  things up from, unless the bridge runs there.
- **One clip**, yours or a stock one. See the next section.

Switch it on with `"look": "loop"` under `home` in `config.json` ([CONFIG.md](CONFIG.md)), or on
the TV in Home settings, Look, where Look cycles to Loop whether or not the files are there (without
them it shows its scrim over a dark ground until `make-loop.sh` has run and the bridge restarted).
Night, Classic and OLED are untouched by any of this.

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

It writes `tv-home/web/loop/` (git ignores the folder; never commit it), sixteen files:
`dawn.mp4`, `day.mp4`, `dusk.mp4`, `night.mp4`, a `-blur.mp4` copy of each, and a `.jpg` and
`-blur.jpg` poster of each. Then restart the bridge, which reads the folder when it starts, and
pick the Loop look.

Options: `--seconds 45` for a longer loop (15 to 60, default 30), `--slow 2` to slow the clip,
`--only night` to remake one variant after changing its grade, `--out <dir>` for another folder,
`--dry-run` to print every ffmpeg command and write nothing. A run takes a few minutes per
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
  shows them until the video plays, and they are the only part of the folder the launcher keeps
  in its offline copy (the video is streamed from the bridge).

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

## If it stutters

In this order, each one a smaller step than the next:

1. **Glass off:** remove the `-blur.mp4` files from `tv-home/web/loop/` (or never make them) and
   restart the bridge. `home.loop.blur` goes false and the home plays one video, the sharp one.
2. **Lighter home** (Home settings, Look, or `home.lighter`): the Loop look takes the fallback
   recipe everywhere, no second video, no mask.
3. **A shorter or lower loop:** `--seconds 20` makes a smaller file; a clip with less water and
   cloud movement encodes to fewer bits at the same cap.
4. **Another look.** Night, Classic and OLED are as they were.

A Loop look with no files is not an error: the bridge says so once in its log ("the Loop look has
no files yet: run scripts/make-loop.sh"), and `home.loop.variants` is empty until the files are
there.
