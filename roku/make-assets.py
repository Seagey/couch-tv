"""Make the pictures and fonts the Roku channel carries, from the ones the TV home already has.

    .venv/bin/python roku/make-assets.py

The outputs are committed (roku/channel/images, roku/channel/fonts, roku/channel/scenes.json), so you only
run this to change the look. It needs ImageMagick (`magick`), `dwebp` (libwebp) and the fonttools and brotli
Python packages (`pip install fonttools brotli`).

Why this exists: a Roku channel is a zip of at most a few megabytes, it cannot read WebP, and it cannot
cut a photo out in the shape of a clock's digits the way a web page does. So:

- scene photos: the 1920x1080 backgrounds, re-saved smaller;
- the cut-out in front of each clock (peaks, trees): only the strip that crosses the digits, as a PNG with
  transparency, drawn over the clock so the scenery overlaps it (scenes.json says where);
- app logos: the phone remote's, shrunk to the size of a tile;
- stretchy rounded panels (9 patches) for the glass look, and the shade under the dock;
- Antonio (the clock) and Inter (everything else) as plain TTF, because Roku wants TTF or OTF.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "tv-home", "web")
BG = os.path.join(WEB, "backgrounds")
OUT = os.path.join(HERE, "channel")
LOGOS = os.path.join(ROOT, "remote", "src", "app-logos")


def run(*cmd):
    subprocess.run(cmd, check=True)


# Each scene's clock, from the TV home's own style sheet (tv-home/web/app.css, .s-<id> and .scene-<id> .date, in
# pixels at 1920 wide: 1rem is 16 px). "top" is where the clock's line box starts, "size" its font size.
# "ink" is the digits' colour and alpha, a stand-in for the web page's glass fill (a Roku cannot fill digits
# with a picture). "bright" dims the photo as the web page does (night is 0.86).
SCENES = [
    {"id": "night", "fg": True, "clock": {"top": 150, "size": 400, "x": "centre"}, "date": {"y": 96, "x": "centre"},
     "ink": "E8C8DC", "alpha": 0.62, "bright": 0.86, "text": "FFE8EE"},
    {"id": "golden", "fg": True, "clock": {"top": 152, "size": 390, "x": "centre"}, "date": {"y": 106, "x": "centre"},
     "ink": "FFE2B8", "alpha": 0.72, "bright": 1.0, "text": "FFFFFF"},
    {"id": "water", "fg": False, "clock": {"top": 268, "size": 420, "x": "centre"}, "date": {"y": 216, "x": "centre"},
     "ink": "CFF3FF", "alpha": 0.62, "bright": 1.0, "text": "FFFFFF"},
    {"id": "fog", "fg": True, "clock": {"top": 172, "size": 470, "x": "left", "left": 96}, "date": {"y": 116, "x": "left", "left": 104},
     "ink": "26322E", "alpha": 0.6, "bright": 1.0, "text": "16201D"},
    {"id": "dawn", "fg": True, "clock": {"top": 230, "size": 400, "x": "centre"}, "date": {"y": 176, "x": "centre"},
     "ink": "FFE9D2", "alpha": 0.74, "bright": 1.0, "text": "FFFFFF"},
]


def scenes():
    meta = []
    for s in SCENES:
        sid = s["id"]
        photo = os.path.join(BG, f"scene-{sid}.jpg")
        run("magick", photo, "-resize", "1920x1080!", "-strip", "-sampling-factor", "4:2:0", "-quality", "74",
            os.path.join(OUT, "images", "scenes", f"{sid}.jpg"))
        entry = {"id": sid, "photo": f"pkg:/images/scenes/{sid}.jpg", "fg": None, "clock": s["clock"], "date": s["date"],
                 "ink": s["ink"], "alpha": s["alpha"], "bright": s["bright"], "text": s["text"]}
        if s["fg"]:
            # the strip of the cut-out that the digits can reach: 480 px of height under the clock's top, and
            # as wide as five characters of that size
            c = s["clock"]
            h = min(1080 - c["top"], int(c["size"] * 1.0))
            w = int(c["size"] * 2.5)
            x = 96 if c["x"] == "left" else (1920 - w) // 2
            if c["x"] == "left":
                w = int(c["size"] * 2.2)
            tmp = os.path.join(tempfile.mkdtemp(), "fg.png")
            run("dwebp", "-quiet", os.path.join(BG, f"scene-{sid}-fg.webp"), "-o", tmp)
            run("magick", tmp, "-crop", f"{w}x{h}+{x}+{c['top']}", "+repage", "-strip", "-define", "png:compression-level=9",
                os.path.join(OUT, "images", "scenes", f"{sid}-fg.png"))
            entry["fg"] = {"uri": f"pkg:/images/scenes/{sid}-fg.png", "x": x, "y": c["top"], "w": w, "h": h}
        meta.append(entry)
    with open(os.path.join(OUT, "scenes.json"), "w") as f:
        json.dump({"scenes": meta}, f, indent=1)
        f.write("\n")


def logos():
    d = os.path.join(OUT, "images", "logos")
    for n in sorted(os.listdir(LOGOS)):
        if n.endswith(".png"):
            run("magick", os.path.join(LOGOS, n), "-resize", "128x128", "-strip", "PNG8:" + os.path.join(d, n))


def panel(path, fill, stroke, stroke_w, radius=28, size=96):
    """A rounded panel as a Roku 9 patch: the picture is padded by 1 px, and black dots on the top and left
    edge mark the part that stretches (the middle, between the corners)."""
    a, b = radius + 1, size - radius + 1
    draw = f"roundrectangle {stroke_w / 2},{stroke_w / 2} {size - 1 - stroke_w / 2},{size - 1 - stroke_w / 2} {radius},{radius}"
    run("magick", "-size", f"{size}x{size}", "xc:none", "-fill", fill, "-stroke", stroke, "-strokewidth", str(stroke_w),
        "-draw", draw, "-bordercolor", "none", "-border", "1",
        "-fill", "black", "-stroke", "none", "-draw", f"rectangle {a},0 {b},0", "-draw", f"rectangle 0,{a} 0,{b}",
        "-strip", "PNG32:" + path)


def ui():
    d = os.path.join(OUT, "images", "ui")
    panel(os.path.join(d, "panel.9.png"), "rgba(28,20,30,0.50)", "rgba(255,215,225,0.20)", 2)
    panel(os.path.join(d, "focus.9.png"), "rgba(255,255,255,0.10)", "rgba(255,255,255,0.95)", 6)
    panel(os.path.join(d, "pill.9.png"), "rgba(255,255,255,0.14)", "rgba(255,255,255,0.28)", 2, radius=22, size=64)
    panel(os.path.join(d, "pill-on.9.png"), "rgba(255,255,255,0.95)", "rgba(255,255,255,0.95)", 2, radius=22, size=64)
    # the shade under Keep watching and the dock: clear for the top 60%, then to half black
    run("magick", "-size", "1x648", "xc:none", "(", "-size", "1x432", "gradient:rgba(0,0,0,0)-rgba(0,0,0,0.5)", ")",
        "-append", "-strip", "PNG32:" + os.path.join(d, "scrim.png"))


def fonts():
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    d = os.path.join(OUT, "fonts")
    f = TTFont(os.path.join(WEB, "fonts", "antonio-latin-300.woff2"))
    f.flavor = None
    f.save(os.path.join(d, "Antonio-Light.ttf"))
    for name, w in (("Regular", 400), ("Medium", 500)):
        v = TTFont(os.path.join(WEB, "fonts", "inter-latin-wght-normal.woff2"))
        v.flavor = None
        instancer.instantiateVariableFont(v, {"wght": w}, inplace=True)
        v.save(os.path.join(d, f"Inter-{name}.ttf"))


def icons():
    """The icon on Roku's home row (4:3) and the splash (16:9): the night scene and the words couch-tv."""
    src = os.path.join(BG, "scene-night.jpg")
    font = os.path.join(OUT, "fonts", "Antonio-Light.ttf")
    d = os.path.join(OUT, "images")
    for name, w, h, pt in (("icon_focus_hd.png", 290, 218, 64), ("icon_focus_fhd.png", 540, 405, 120)):
        run("magick", src, "-gravity", "center", "-crop", f"{h * 4 // 3}x{h}+0+0", "+repage", "-resize", f"{w}x{h}!",
            "-brightness-contrast", "-18x0", "-font", font, "-fill", "white", "-pointsize", str(pt), "-gravity", "center",
            "-annotate", "+0+0", "couch tv", "-strip", os.path.join(d, name))
    run("magick", src, "-brightness-contrast", "-18x0", "-font", font, "-fill", "white", "-pointsize", "220",
        "-gravity", "center", "-annotate", "+0+0", "couch tv", "-quality", "80", "-strip", os.path.join(d, "splash_fhd.jpg"))


if __name__ == "__main__":
    for step in (fonts, scenes, logos, ui, icons):
        print(step.__name__)
        step()
    print("done:", subprocess.run(["du", "-sh", OUT], capture_output=True, text=True).stdout.strip())
