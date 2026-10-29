#!/usr/bin/env python3
"""Make your own home scene from any photo, a landscape or a personal one: the photo at 1920x1080
and the frosted copy the glass clock is filled with. The clock is drawn over the photo.
docs/MAKE-A-SCENE.md walks through it.

    python3 tv-home/tools/make-scene.py PHOTO ID                       the photo and its glass copy
    python3 tv-home/tools/make-scene.py PHOTO ID --depth --preview     plus the cut-out, found without AI
    python3 tv-home/tools/make-scene.py PHOTO ID --sky-edit EDIT --preview    plus the cut-out, from an image model's edit

  PHOTO   any photo Pillow reads (JPEG, PNG, WebP; HEIC with pillow-heif). It is cut to a 16:9
          band (--top says where) and made 1920x1080.
  ID      the scene's id in config.json, lowercase letters and digits, e.g. "valley". Writes
          tv-home/web/backgrounds/mine/scene-ID.jpg and scene-ID-glass.jpg (git ignores that folder).

Extra depth, optional: scene-ID-fg.webp, a cut-out of everything in front of the sky, drawn over
the clock so the skyline overlaps its digits (what the built-in scenes do). Two ways to find the sky:

  --sky-edit EDIT (best edges): EDIT is the same photo with the sky painted flat magenta by an
    image model (the prompt is in docs/MAKE-A-SCENE.md). Every pixel that is magenta in the edit
    is sky. The edit is checked against the photo first: image models sometimes move or redraw the
    scene, and a cut-out from a moved scene shows a ghost edge, so if the two do not line up the
    cut-out is skipped and the clock simply sits in front.
  --depth (no AI): the sky is grown down from the top edge: a pixel is sky when it is close to the
    sky just above it (and beside it), so a smooth gradient (a sunset) stays sky while a skyline,
    which changes sharply, stops it. This route is roliusz's (github.com/roliusz, their fork of
    couch-tv), kept with their options: --step, --far, --floor, --paint, --smooth, --treeline,
    --thin, --spread, --fill and the exact edge (alpha matting with pymatting).

--preview [DIR] also writes DIR/ID-check.jpg (default build/scenes/): the cut-out over magenta,
so a bad edge is easy to see before it reaches the TV. Nothing leaves the computer, and nothing
from the photo's metadata (EXIF, camera, location) is copied into the files.

Needs numpy and Pillow; scipy for --depth. Optional: pymatting (exact edges with --depth) and
pillow-heif (iPhone HEIC photos). Into the repo's .venv:
    .venv/bin/pip install numpy Pillow scipy pymatting pillow-heif
"""
import argparse
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

W, H = 1920, 1080
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "tv-home", "web", "backgrounds", "mine")
BUILT_IN = {"night", "golden", "water", "fog", "dawn", "own", "mine"}


def band(img, top):
    """A 16:9 band of the photo, the right way up, 1920x1080."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size
    bh = round(w * 9 / 16)
    if bh <= h:   # taller than 16:9: a band of the full width
        y = round(min(max(top, 0.0), 1.0) * (h - bh))
        img = img.crop((0, y, w, y + bh))
    else:         # wider: the middle
        bw = round(h * 16 / 9)
        x = (w - bw) // 2
        img = img.crop((x, 0, x + bw, h))
    return img.resize((W, H), Image.LANCZOS)


def clean(img):
    """The pixels only: a fresh image, so no EXIF, GPS, ICC or comment can ride along."""
    return Image.fromarray(np.array(img))


# ---------------------------------------------------------------- with an image model's edit

def magenta_sky(img, edit_path, top, limit, open_sky, extend):
    """The sky from the magenta edit, or None when the edit does not line up with the photo."""
    raw = Image.open(edit_path)
    edit = ImageOps.exif_transpose(raw).convert("RGB")
    ew, eh = edit.size
    src_aspect = PHOTO_ASPECT
    if abs(ew / eh - 16 / 9) < 0.02:
        edit = edit.resize((W, H), Image.LANCZOS)   # an edit of the 16:9 copy (or a 16:9 photo)
    elif abs(ew / eh - src_aspect) < 0.02:
        edit = band(raw, top)                        # an edit of the original: the same band of it
    else:
        print(f"cut-out SKIPPED: the edit is {ew}x{eh}, not the shape of the photo or of 16:9")
        return None
    s = np.asarray(edit).astype(np.int16)
    h = np.asarray(img).astype(np.int16)
    # magenta: red and blue high, green low
    sky = (s[..., 0] > 200) & (s[..., 2] > 200) & (s[..., 1] < 90)
    if open_sky:
        # open skies: everything above the lowest magenta in each column is sky (for clouds or a
        # haze the edit left unpainted); --extend carries it a few rows further down
        rows = np.arange(H)[:, None]
        low = np.where(sky.any(axis=0), H - 1 - np.argmax(sky[::-1], axis=0), -1)
        sky = rows <= (low + np.where(low >= 0, extend, 0))[None, :]
    share = sky.mean()
    if share < 0.02:
        print("cut-out SKIPPED: the edit has no magenta sky in it")
        return None
    # how well do the two line up where the edit kept the scene?
    err = np.abs(s - h).mean(axis=2)[~sky].mean()
    print(f"sky {share:.0%} of the picture, mismatch outside the sky {err:.1f} (under {limit:g} is fine)")
    if err >= limit:
        print("cut-out SKIPPED: the edit moved or redrew the scene (try the edit again, or --limit "
              "a little higher for a hazy photo once it lines up)")
        return None
    # close pin holes, then soften the edge a little so it does not show a rim over the digits
    a = Image.fromarray(np.where(sky, 0, 255).astype(np.uint8))
    a = a.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(a, dtype=np.float64) / 255.0


# ---------------------------------------------------------------- without AI (roliusz's route)

def grown_sky(img, step, far, floor=1.0, spread=6, paint=0.0, thin=0, smooth=0.0, treeline=0.0, fill=0):
    from scipy import ndimage
    a = np.asarray(img.filter(ImageFilter.GaussianBlur(1.6)), dtype=np.float32)
    sky = np.zeros((H, W), bool)
    # the top row: whatever is close to its typical colour
    top = np.median(a[0], axis=0)
    sky[0] = np.linalg.norm(a[0] - top, axis=1) < far
    ref = a[0].copy()   # per column, the sky colour seen most recently
    for y in range(1, min(H, int(floor * H))):   # below the horizon (--floor) nothing is sky
        near = np.linalg.norm(a[y] - a[y - 1], axis=1) < step
        drift = np.linalg.norm(a[y] - ref, axis=1) < far
        ok = near & drift
        row = ok & (sky[y - 1] | np.roll(sky[y - 1], 1) | np.roll(sky[y - 1], -1))
        # spread along the row to neighbours that are just as sky-like (around the sides of things)
        for _ in range(spread):
            grow = ok & (np.roll(row, 1) | np.roll(row, -1))
            if (grow == row).all():
                break
            row = row | grow
        sky[y] = row
        ref[row] = 0.85 * ref[row] + 0.15 * a[y][row]
    # sky walled in by wires or branches: anything above the horizon this close to the sky's
    # colour at the top (--paint) is sky too
    if paint:
        rows = np.arange(H)[:, None] < int(floor * H)
        sky |= rows & (np.linalg.norm(a - top, axis=2) < paint)
    # fog and cloud (--smooth): whatever has no texture and reaches the top is sky too, whatever
    # its colour (the colour test stops where blue sky turns to fog; texture does not change there)
    if smooth:
        g = a.mean(axis=2)
        m = ndimage.uniform_filter(g, 15); m2 = ndimage.uniform_filter(g * g, 15)
        calm = np.sqrt(np.maximum(m2 - m * m, 0)) < smooth
        calm &= np.arange(H)[:, None] < int(floor * H)
        lab, n = ndimage.label(calm | sky)
        if n:
            sky |= np.isin(lab, list(set(np.unique(lab[0])) - {0})) & calm
    # fog down to the trees (--treeline): from the horizon floor, each column that is still sky
    # carries on down through anything without texture (haze, fog) and stops at the first rows
    # with real texture (treetops), so the trees' own ragged edge is the skyline, not a straight line
    if treeline:
        g = a.mean(axis=2)
        m = ndimage.uniform_filter(g, 9); m2 = ndimage.uniform_filter(g * g, 9)
        rough = np.sqrt(np.maximum(m2 - m * m, 0)) > treeline
        # a few textured rows in a row, so a speck in the fog does not stop it
        rough = ndimage.binary_opening(rough, structure=np.ones((5, 1), bool))
        start = max(0, int(floor * H) - 2)
        edge = np.full(W, start)
        # columns that are sky at the floor, or just above it (the colour test can stop a few rows short)
        open_col = sky[max(0, start - 40):start + 1].any(axis=0)
        for x in range(W):
            if not open_col[x]:
                continue
            hit = np.nonzero(rough[start:, x])[0]
            edge[x] = start + (hit[0] if len(hit) else 0)
        edge = ndimage.median_filter(edge, size=5)   # treetops, not single-pixel spikes
        # narrow blocks rising out of the fog are specks of texture in the haze, not trees (crowns
        # are wider): close them over
        edge = ndimage.grey_closing(edge, size=25)
        for x in range(W):
            if open_col[x]:
                top_sky = start - 40 + int(np.nonzero(sky[max(0, start - 40):start + 1, x])[0].max()) if start >= 40 else start
                sky[min(top_sky, start):edge[x], x] = True
    # wires and poles across the sky (--thin): too thin to be scenery, they leave the cut-out
    if thin:
        fg = ~sky
        fg = ndimage.binary_opening(fg, structure=np.ones((1, thin), bool))
        fg = ndimage.binary_opening(fg, structure=np.ones((thin, 1), bool))
        sky = ~fg
    # tidy: no pin-holes in the sky, no stray specks of sky below the skyline
    sky = ndimage.binary_closing(sky, iterations=2, border_value=1)   # past the edge counts as sky, or the top row is lost
    lab, n = ndimage.label(sky)
    if n:
        sky = np.isin(lab, list(set(np.unique(lab[0])) - {0}))
    fg = ~sky
    fg = ndimage.binary_opening(fg, iterations=1)
    # narrow slivers of "sky" cutting down into the scenery (a snow face as smooth as the sky):
    # filled, they are scenery (--fill: widest sliver, in pixels)
    if fill:
        fg = ndimage.binary_closing(fg, structure=np.ones((1, fill), bool), border_value=0) | fg
        fg = ndimage.binary_closing(fg, structure=np.ones((fill // 2, 1), bool), border_value=0) | fg
    # scenery floating in the sky (stars, bits of cloud) is not scenery: only what reaches the
    # bottom of the picture, or the sides, stays
    lab, n = ndimage.label(fg)
    if n:
        edges = set(np.unique(lab[-1])) | set(np.unique(lab[:, 0])) | set(np.unique(lab[:, -1]))
        fg = np.isin(lab, list(edges - {0}))
    return ~fg


def fade(img, sky, floor, rough, hard):
    """Trees in fog (with --treeline): below the horizon floor, in the columns that were sky there,
    the trees grow solid as their texture shows through the mist, so the clock's digits melt into
    the foggy forest instead of meeting a hard edge. Once solid, solid all the way down."""
    from scipy import ndimage
    a = np.asarray(img.filter(ImageFilter.GaussianBlur(1.6)), dtype=np.float32).mean(axis=2)
    m = ndimage.uniform_filter(a, 9); m2 = ndimage.uniform_filter(a * a, 9)
    tex = np.sqrt(np.maximum(m2 - m * m, 0))
    lo, hi = rough * 0.5, rough * 1.8
    soft = ndimage.gaussian_filter(np.clip((tex - lo) / (hi - lo), 0, 1), 5)
    start = max(1, int(floor * H) - 2)
    soft[start:] = np.maximum.accumulate(soft[start:], axis=0)
    open_col = sky[start - 1]
    out = hard.copy()
    region = out[start:, open_col]
    out[start:, open_col] = np.maximum(np.minimum(region, soft[start:, open_col]), 0)
    return out


def refine(img, sky, width):
    """The exact edge (alpha matting): the rough sky mask, shrunk away from its edge on both sides,
    says what is surely sky and surely scenery; in the band between, every pixel's share of scenery
    is worked out from the photo's own colours, so sharp ridges, needle peaks, building corners and
    single trees keep their real outline instead of a smoothed one. None without pymatting."""
    try:
        from pymatting import estimate_alpha_cf
    except ImportError:
        print("note: pymatting is not installed, so the edge is the softer one "
              "(.venv/bin/pip install pymatting for the exact edge)")
        return None
    from scipy import ndimage
    fg = ~sky
    sure_fg = ndimage.binary_erosion(fg, iterations=width, border_value=1)
    sure_sky = ndimage.binary_erosion(sky, iterations=width, border_value=1)
    tri = np.full(sky.shape, 0.5)
    tri[sure_fg] = 1.0; tri[sure_sky] = 0.0
    a = np.clip(estimate_alpha_cf(np.asarray(img, dtype=np.float64) / 255.0, tri), 0, 1)
    # tidy the matte: near-certain values snap, so no faint haze of sky is drawn over the clock
    a[a < 0.15] = 0; a[a > 0.8] = 1
    return a


def soft_edge(sky):
    return np.asarray(Image.fromarray(((~sky) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))) / 255.0


# ---------------------------------------------------------------- the three files

def main():
    ap = argparse.ArgumentParser(description="Make your own home scene (docs/MAKE-A-SCENE.md).")
    ap.add_argument("photo"); ap.add_argument("id")
    ap.add_argument("--top", type=float, default=0.1, help="where the 16:9 band starts in a taller photo, as a share of its height (0 = the top)")
    ap.add_argument("--out", default=OUT, help="where the files go (default tv-home/web/backgrounds/mine)")
    ap.add_argument("--preview", nargs="?", const=os.path.join(ROOT, "build", "scenes"), help="also write DIR/ID-check.jpg, the cut-out over magenta (default build/scenes)")
    ap.add_argument("--bright", type=float, default=1.3, help="how much brighter the clock's frosted fill is than the photo")
    g = ap.add_argument_group("extra depth, with an image model's magenta-sky edit")
    g.add_argument("--sky-edit", help="the same photo with its sky painted flat magenta (#FF00FF): makes the cut-out")
    g.add_argument("--limit", type=float, default=14, help="how far the edit may differ from the photo outside the sky (default 14)")
    g.add_argument("--open-sky", action="store_true", help="everything above the lowest magenta in each column is sky (clouds or haze the edit left)")
    g.add_argument("--extend", type=int, default=0, help="with --open-sky: carry the sky this many pixels further down")
    g = ap.add_argument_group("extra depth, without AI (the sky grown down from the top)")
    g.add_argument("--depth", action="store_true", help="make the cut-out by finding the sky without AI")
    g.add_argument("--step", type=float, default=9.0, help="how much the sky may change from one row to the next and still be sky")
    g.add_argument("--far", type=float, default=46.0, help="how far it may drift from the sky just above (stops it running into a hazy sea)")
    g.add_argument("--floor", type=float, default=1.0, help="the horizon, as a share of the height: nothing below it is sky")
    g.add_argument("--paint", type=float, default=0.0, help="also sky: anything above the horizon this close to the top's colour")
    g.add_argument("--smooth", type=float, default=0.0, help="also sky: texture-free areas (fog, cloud) reaching the top; how calm, e.g. 4")
    g.add_argument("--treeline", type=float, default=0.0, help="from the horizon floor, carry the sky down through fog to the first texture this rough (trees), e.g. 3.5")
    g.add_argument("--thin", type=int, default=0, help="drop anything thinner than this many pixels (wires, poles) from the cut-out")
    g.add_argument("--spread", type=int, default=6, help="how far the sky may spread sideways per row (around wires, posts)")
    g.add_argument("--fill", type=int, default=0, help="fill slivers of sky this narrow that cut down into the scenery, e.g. 40")
    g.add_argument("--band", type=int, default=10, help="how far either side of the rough edge the exact edge is looked for, in pixels")
    g.add_argument("--no-refine", action="store_true", help="skip the exact-edge step (faster, softer edge)")
    o = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9]{1,24}", o.id) or o.id in BUILT_IN:
        sys.exit(f'"{o.id}": use lowercase letters and digits only (up to 24), and not a built-in scene\'s name')
    global PHOTO_ASPECT
    src = Image.open(o.photo)
    sw, sh = ImageOps.exif_transpose(src).size
    PHOTO_ASPECT = sw / sh
    img = clean(band(src, o.top))
    os.makedirs(o.out, exist_ok=True)
    name = os.path.join(o.out, "scene-" + o.id)

    img.save(name + ".jpg", quality=86, optimize=True, progressive=True)
    # the clock's frosted fill: blurred, a little brighter and richer
    glass = img.filter(ImageFilter.GaussianBlur(16))
    glass = ImageEnhance.Color(ImageEnhance.Brightness(glass).enhance(o.bright)).enhance(1.25)
    clean(glass).save(name + "-glass.jpg", quality=80, optimize=True)

    a, fg_rgb, wanted = None, img, bool(o.sky_edit or o.depth)
    if o.sky_edit:
        a = magenta_sky(img, o.sky_edit, o.top, o.limit, o.open_sky, o.extend)
    elif o.depth:
        sky = grown_sky(img, o.step, o.far, o.floor, o.spread, o.paint, o.thin, o.smooth, o.treeline, o.fill)
        a = None if o.no_refine else refine(img, sky, o.band)
        if a is not None:
            # the edge's own colours, without the sky mixed in, so no sky-coloured fringe is drawn
            from pymatting import estimate_foreground_ml
            f = estimate_foreground_ml(np.asarray(img, dtype=np.float64) / 255.0, a)
            fg_rgb = Image.fromarray((np.clip(f, 0, 1) * 255).astype(np.uint8))
        else:
            a = soft_edge(sky)
        if o.treeline:
            a = fade(img, sky, o.floor, o.treeline, a)
        share = 1 - a.mean()
        print(f"sky {share:.0%} of the picture (grown from the top edge)")
        if share < 0.03 or share > 0.97:
            print("cut-out SKIPPED: no clear sky found at the top (try --far higher, or the magenta route)")
            a = None

    fg_path = name + "-fg.webp"
    if a is None:
        if os.path.exists(fg_path):
            os.remove(fg_path)   # an old cut-out would no longer match
        print("no cut-out: the clock sits over the whole photo" +
              ("" if wanted else " (add --depth or --sky-edit for the skyline in front of it)"))
    else:
        fg = fg_rgb.convert("RGB")
        fg.putalpha(Image.fromarray((a * 255).round().astype(np.uint8)))
        clean(fg).save(fg_path, quality=88, method=6)
        print("cut-out written")
        if o.preview:
            os.makedirs(o.preview, exist_ok=True)
            check = Image.new("RGB", (W, H), (255, 0, 255))
            check.paste(fg, (0, 0), fg)
            p = os.path.join(o.preview, o.id + "-check.jpg")
            check.save(p, quality=88)
            print("check image:", p)

    for f in (name + ".jpg", name + "-glass.jpg") + ((fg_path,) if a is not None else ()):
        print("  " + (os.path.relpath(f, ROOT) if f.startswith(ROOT + os.sep) else f))
    # a starting point for the clock: on the side with the most open sky (left, centre or right,
    # where a clock about 700 px wide would sit), high enough that the skyline there crosses only
    # the lowest third of the digits (Antonio's ink runs from 0.05 to 0.92 of the font size below
    # the clock's top)
    x, y = "centre", 0.14
    if a is not None:
        solid = a >= 0.5
        sky_to = np.where(solid.any(axis=0), np.argmax(solid, axis=0), H)   # per column, where the scenery starts
        zones = {"centre": (610, 1310), "left": (96, 796), "right": (1124, 1824)}
        low = {k: float(np.median(sky_to[x0:x1])) for k, (x0, x1) in zones.items()}
        x = max(low, key=lambda k: low[k] + (1 if k == "centre" else 0))   # a tie goes to the centre
        y = round(min(max(low[x] / H - 0.66 * 0.37, 0.12), 0.62 - 0.92 * 0.37), 2)
    entry = {"id": o.id, "name": o.id.capitalize(), "clock": {"x": x, "y": y, "size": 0.37, "font": "antonio"},
             "date": "above", "text": "light"}
    if a is not None:
        entry["cutout"] = True   # the page then draws scene-ID-fg.webp over the clock
    print("\nAdd it to home.my_scenes in config.json (docs/MAKE-A-SCENE.md has every key):")
    print(json.dumps(entry))


PHOTO_ASPECT = 16 / 9

if __name__ == "__main__":
    sys.exit(main())
