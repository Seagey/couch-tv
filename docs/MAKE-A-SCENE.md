# Make your own home scene

The Night look's scenes are a photo with a big glass clock over it, Apple TV and iPhone lock screen
style. This guide makes one of your own from any picture: a landscape, a place you describe, or a
personal photo. You design its clock too: where it sits, how big, which font, where the date goes,
light or dark.

The simple way is all most people need: the photo, and the glass clock drawn over it. As an
optional extra, the clock can also sit *behind* the skyline, so the hills or trees overlap the
bottom of the digits the way the built-in scenes do ([step 6](#6-optional-extra-depth-the-clock-behind-the-skyline)).

It is written so an AI agent can follow it end to end. If you are that agent: do the steps in
order, look at the result yourself before going on, and ask the person only what the steps say to
ask.

## What a scene is

Files in `tv-home/web/backgrounds/mine/` (git ignores that folder, so they stay yours and are never
committed):

| File | What it is |
|---|---|
| `scene-<id>.jpg` | The photo, 1920x1080. |
| `scene-<id>-glass.jpg` | A blurred, brightened copy. The clock's digits are filled with it, which is what makes them look like frosted glass. |
| `scene-<id>-fg.webp` | Optional, for extra depth: everything in front of the sky with the sky transparent, drawn over the clock. |

Plus one entry in `config.json` (`home.my_scenes`) that names the scene and designs its clock.

`tv-home/tools/make-scene.py` makes the files. It needs Python 3 with numpy and Pillow, into the
repo's `.venv` (README step 2 makes it):

```sh
.venv/bin/pip install numpy Pillow
.venv/bin/pip install pillow-heif   # optional: iPhone HEIC photos
```

## 1. Get a picture

Ask: **"Want your own background? Describe a place, or give me a photo."**

**A photo of theirs**, a landscape or a personal one (the family at the beach, the dog, the view
from the deck). What works best:

- **Landscape shape, ideally 16:9.** A taller photo works too: the tool cuts a 16:9 band from it
  (`--top` says where, as a share of the height; `0` is the very top).
- **A calm area where the clock goes**, usually the top half: sky, water, a wall, soft background.
  Faces and busy detail right behind the digits make the time hard to read, so a portrait with
  people low in the frame works better than one with faces at the top.
- At least 1920 pixels wide, so it is sharp on the TV.

The tool copies only the pixels: no EXIF, no camera, no GPS. The files stay on this computer and
the TV, and git ignores them. If the person ever shares their copy of couch-tv, the pictures are
not in it.

**A place they describe.** Use any text-to-image model the agent can reach (ask first if it costs
money). The prompt that made our own scenes, with their place in it:

> Wide cinematic photograph, 16:9. *[The place, in their words: what is there, the season, the
> time of day, the light.]* The *[hills, trees, buildings]* sit in the lower half of the frame; the
> upper half is open, calm sky with no birds and no clouds crossing the top centre. Shot on a full
> frame camera, 24mm, natural colour, high end landscape photography. No people, no text, no logos.

Ask for 16:9 at about 2K. Look at the result before going on, and make it again if it is wrong.

## 2. Make the scene

```sh
.venv/bin/python tv-home/tools/make-scene.py photo.jpg beach
```

`beach` is the scene's id: lowercase letters and digits, up to 24, not a built-in scene's name. It
writes `scene-beach.jpg` and `scene-beach-glass.jpg`, and prints an entry to paste into
`config.json`.

## 3. Design the clock

Add the scene to `home.my_scenes` in `config.json`:

```json
"home": {
  "my_scenes": [
    {
      "id": "beach",
      "name": "Summer at the beach",
      "clock": { "x": "centre", "y": 0.14, "size": 0.37, "font": "antonio" },
      "date": "above",
      "text": "light"
    }
  ]
}
```

| Key | What it does |
|---|---|
| `id` (needed) | The id from step 2. |
| `name` | What Home settings calls it. Without it: "Your scene 1". |
| `clock.x` ["centre"] | `left`, `centre` or `right`. |
| `clock.y` [0.14] | Where the top of the clock sits, as a share of the screen's height (0.12 to 0.6). |
| `clock.size` [0.37] | How big the digits are, as a share of the screen's height (0.2 to 0.45). 0.37 is the built-in size. |
| `clock.font` ["antonio"] | `antonio` (tall and narrow, the built-in clock) or `inter` (rounder and wider). |
| `clock.weight` [600] | Only with `inter`: 100 (thin) to 900 (heavy). |
| `date` ["above"] | The date and weather line: `above` the clock or `below` it. It lines up with the clock's side. |
| `text` ["light"] | `light`: white date, bright glass. `dark`: dark date and a smoky glass, for a pale picture. |
| `cutout` [false] | `true` only when step 6 made `scene-<id>-fg.webp`. The tool prints it when it did. |

The page keeps the clock above Keep watching and the dock whatever the numbers say, and the date
moves aside if it would run into the people switch or the quick buttons.

**What makes a good clock.**

- **Put it over the calmest part of the picture**, and move it (`x`, `y`) off faces.
- Over a pale, bright area the white glass is faint: try `"text": "dark"`.
- `inter` at 600 is closer to the iPhone lock screen; `antonio` is the couch-tv look.

## 4. Try it before the TV

Serve the repo folder and open the home with the scene and a preview of its settings (the
`myscenes` value is the same JSON as in `config.json`, as one list):

```sh
python3 -m http.server 8000
```

```
http://127.0.0.1:8000/tv-home/web/index.html?mock=1&scene=beach&myscenes=[{"id":"beach","clock":{"x":"left","y":0.16}}]
```

Change the numbers in the address until it looks right, then copy them into `config.json`.

## 5. Put it on the TV

Your scenes take turns after the built-in ones. To choose the order, or leave some built-in ones
out, list ids in `home.scenes`, for example `"scenes": ["beach", "night", "fog"]`. Home settings,
Look and scenes, can also switch any of them off or move them, like the built-in ones.

**Option B (computer bridge).** The bridge serves `tv-home/web` straight from the repo, so the new
files are there already. Restart the bridge (it reads `config.json` once, when it starts), then
press Home on the TV. The TV's copy for when the computer is off picks up the scene by itself.

**Option A (no computer).** Here the home is the copy built *into* the app, and `apply.sh` can hand
the app new settings but not new pictures. So:

1. Build the app yourself with the scene in place: `sh scripts/build-apk.sh` (README, "Building
   the app": JDK 21 and the Android SDK). The app downloaded from the Releases page does not have
   your scene.
2. Install it: `APK=dist/couch-tv-home.apk TV_IP=<tv address> sh tv-home/tools/apply.sh`.

Changing only the clock or the name of a scene already built in needs no rebuild: edit
`config.json` and run `apply.sh` again.

**Samsung.** `samsung/build.py` packs `tv-home/web`, so the scene goes in with the next build and
install (docs/SAMSUNG.md).

**Option C (the on-TV app)** carries its own copy of the home and its own settings; own scenes are
not wired into it yet.

A scene named in `config.json` whose photo is not on the TV (an app built before you made it) is
simply skipped: the others take turns as before.

## 6. Optional: extra depth, the clock behind the skyline

For a picture with open sky above a clear edge (a skyline, a mountain ridge, a line of trees,
rooftops), a cut-out of everything in front of the sky can be drawn over the clock, so the scenery
overlaps the bottom of the digits. Two ways to find the sky; both add `--preview`, which writes
`build/scenes/<id>-check.jpg`, the cut-out over flat magenta. **Open it and look.** Magenta should be
exactly where the sky was, and only there. Then add `"cutout": true` to the scene in `config.json`
(the tool prints the entry with it).

### A. With an image model (the best edges)

This is how the built-in scenes were made. Give an image *edit* model the photo (the original, or
the 16:9 `scene-<id>.jpg` from step 2, either works) with exactly this prompt:

> Edit this photograph: replace the entire sky with one flat, solid, pure magenta colour (#FF00FF),
> with no gradient, no clouds and no glow. Every other pixel stays exactly the same: the house, the
> trees and every leaf and branch, the hills, mountains and their edges, the water and reflections,
> the grass. Do not move, resize, crop or redraw anything. Only the sky changes.

Ask for the same shape as the photo you gave it. Save the result, then:

```sh
.venv/bin/python tv-home/tools/make-scene.py photo.jpg valley --sky-edit valley-sky.png --preview
```

It prints how well the edit lines up with the photo, for example `mismatch outside the sky 3.8
(under 14 is fine)`. Image models sometimes shift or redraw the scene a little; a cut-out from a
shifted scene shows a ghost edge over the digits, so when the mismatch is too high the tool
**skips the cut-out** and says so. Run the edit again (a fresh try usually lines up), then the
tool again.

- Clouds or haze the model left unpainted, just under the magenta: `--open-sky` (everything above
  the lowest magenta in each column is sky), and `--extend 20` to carry it 20 pixels further.
- A hazy photo that still fails at `14` once it clearly lines up: `--limit 18`.

### B. Without AI

No image model, nothing leaves the computer. The sky is grown down from the top edge, so it works
best on a clear or smoothly graded sky. This route is roliusz's, from their fork of couch-tv. It
needs scipy, and pymatting for the sharpest edge:

```sh
.venv/bin/pip install scipy pymatting
.venv/bin/python tv-home/tools/make-scene.py photo.jpg valley --depth --preview
```

### Where the clock goes with a cut-out

With a cut-out the tool suggests the side with the most open sky and a height that puts the
skyline across the lowest third of the digits. **Keep at least the top 60% of every digit clear**
of the scenery so the time reads at a glance: too much hidden, make `y` smaller (the clock moves
up) or `size` smaller. The clock goes behind *everything* in the cut-out, including a tree or a
cliff at the side of the picture; if a digit vanishes, move the clock.

### Bad cut-out?

| What you see | Try |
|---|---|
| Patches of sky left in the corners (not magenta) | Route B: `--far 70` (the sky may drift further from the top's colour). Small corners away from the clock do not matter. |
| Magenta runs down into the hills, a lake or the trees | Route B: `--far 30`, or `--floor 0.5` (nothing below half way is sky). |
| A cloudy, colourful or sunset sky comes out in pieces | Route B cannot tell clouds from scenery. Use route A, or no cut-out. |
| Fog or mist between the sky and the trees | Route B: `--smooth 4`, or `--floor 0.45 --treeline 3.5` to carry the sky down through the fog to the treetops. |
| Narrow slivers of magenta cutting into a snowy face | Route B: `--fill 40`. |
| Power lines or poles stay in front of the clock | Route B: `--thin 6`. |
| A soft halo along the skyline | Route B: install pymatting for the exact edge (on by default once it is there). |
| Route A says the edit moved the scene | Make the edit again; never raise `--limit` to force a cut-out that does not line up. |
| Nothing works | Run step 2 again without `--depth` or `--sky-edit` and leave `cutout` out. The clock sits over the photo, which is fine. |

## Credits

The magenta-sky method and the glass fill come from the couch-tv scenes. The sky-growing route,
its options and the exact edge (alpha matting) are roliusz's work, from their fork.
