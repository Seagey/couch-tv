"""Make the fonts and icons the Apple TV app carries, from the ones the TV home already has.

    python3 tvos/make-assets.py

The outputs are committed (tvos/CouchTV/Fonts, tvos/CouchTV/Assets.xcassets), so you only run this to change
the look. It needs ImageMagick (`magick`) and the fonttools and brotli Python packages
(`pip install fonttools brotli`). The scene photos are not copied: the Xcode project points at
tv-home/web/backgrounds, so the TV home and the Apple TV app always show the same scenes.

- fonts: Antonio Light (the clock) and Inter at 400, 500 and 600, as plain TTF, each with its own name so
  the app can ask for a weight by name;
- the app icon on Apple's home row: two layers (the night scene behind, the words couch tv in front), so
  tvOS can give it its parallax when it is focused;
- the Top Shelf pictures Apple's home shows above the row when Couch TV is in the top row.
"""
import json
import os
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "tv-home", "web")
BG = os.path.join(WEB, "backgrounds")
APP = os.path.join(HERE, "CouchTV")
CAT = os.path.join(APP, "Assets.xcassets")


def run(*cmd):
    subprocess.run(cmd, check=True)


def fonts():
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    d = os.path.join(APP, "Fonts")
    os.makedirs(d, exist_ok=True)

    def name(font, family, style):
        t = font["name"]
        ps = f"{family.replace(' ', '')}-{style}"
        for nid, val in ((1, family), (2, "Regular"), (4, f"{family} {style}"), (6, ps), (16, family), (17, style)):
            t.setName(val, nid, 3, 1, 0x409)
            t.setName(val, nid, 1, 0, 0)
        return ps

    f = TTFont(os.path.join(WEB, "fonts", "antonio-latin-300.woff2"))
    f.flavor = None
    name(f, "Couch Antonio", "Light")
    f.save(os.path.join(d, "CouchAntonio-Light.ttf"))
    for style, w in (("Regular", 400), ("Medium", 500), ("SemiBold", 600)):
        v = TTFont(os.path.join(WEB, "fonts", "inter-latin-wght-normal.woff2"))
        v.flavor = None
        instancer.instantiateVariableFont(v, {"wght": w}, inplace=True)
        name(v, "Couch Inter", style)
        v.save(os.path.join(d, f"CouchInter-{style}.ttf"))


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


INFO = {"author": "xcode", "version": 1}
FONT = os.path.join(APP, "Fonts", "CouchAntonio-Light.ttf")
AT2X = "@2x"                    # the 3840x2160 copies are named <name>@2x.jpg
SCENE = os.path.join(BG, f"scene-night{AT2X}.jpg")


def back(path, w, h):
    run("magick", SCENE, "-resize", f"{w}x{h}^", "-gravity", "center", "-extent", f"{w}x{h}",
        "-brightness-contrast", "-14x0", "-strip", "-quality", "88", path)


def front(path, w, h):
    pt = int(h * 0.34)
    run("magick", "-size", f"{w}x{h}", "xc:none", "-font", FONT, "-pointsize", str(pt), "-fill", "white",
        "-gravity", "center", "-annotate", "+0+0", "couch tv", "(", "+clone", "-background", "black",
        "-shadow", "40x8+0+6", ")", "+swap", "-background", "none", "-layers", "merge", "+repage",
        "-gravity", "center", "-extent", f"{w}x{h}", "-strip", "PNG32:" + path)


def imageset(folder, files):
    """files: [(scale, filename)]"""
    write_json(os.path.join(folder, "Contents.json"), {
        "images": [{"idiom": "tv", "filename": f, "scale": s} for s, f in files], "info": INFO})


def stack(folder, sizes):
    """A two layer icon (Front over Back) at the given [(scale, w, h)]."""
    write_json(os.path.join(folder, "Contents.json"),
               {"layers": [{"filename": "Front.imagestacklayer"}, {"filename": "Back.imagestacklayer"}], "info": INFO})
    for layer, draw in (("Front", front), ("Back", back)):
        ld = os.path.join(folder, f"{layer}.imagestacklayer")
        write_json(os.path.join(ld, "Contents.json"), {"info": INFO})
        cd = os.path.join(ld, "Content.imageset")
        os.makedirs(cd, exist_ok=True)
        files = []
        for scale, w, h in sizes:
            fn = f"{layer.lower()}-{w}x{h}." + ("png" if layer == "Front" else "jpg")
            draw(os.path.join(cd, fn), w, h)
            files.append((scale, fn))
        imageset(cd, files)


def icons():
    brand = os.path.join(CAT, "App Icon & Top Shelf Image.brandassets")
    write_json(os.path.join(CAT, "Contents.json"), {"info": INFO})
    write_json(os.path.join(brand, "Contents.json"), {"assets": [
        {"filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"},
        {"filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"},
        {"filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"},
        {"filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"},
    ], "info": INFO})
    stack(os.path.join(brand, "App Icon.imagestack"), [("1x", 400, 240), ("2x", 800, 480)])
    stack(os.path.join(brand, "App Icon - App Store.imagestack"), [("1x", 1280, 768)])
    for folder, w, h in (("Top Shelf Image.imageset", 1920, 720), ("Top Shelf Image Wide.imageset", 2320, 720)):
        d = os.path.join(brand, folder)
        os.makedirs(d, exist_ok=True)
        files = []
        for scale, k in (("1x", 1), ("2x", 2)):
            fn = f"top-shelf-{w * k}x{h * k}.jpg"
            tmp = os.path.join(tempfile.mkdtemp(), "f.png")
            back(os.path.join(d, fn), w * k, h * k)
            front(tmp, w * k, h * k)
            run("magick", os.path.join(d, fn), tmp, "-composite", "-strip", "-quality", "86", os.path.join(d, fn))
            files.append((scale, fn))
        imageset(d, files)
    write_json(os.path.join(CAT, "AccentColor.colorset", "Contents.json"), {
        "colors": [{"idiom": "universal", "color": {"color-space": "srgb", "components": {
            "red": "1.000", "green": "1.000", "blue": "1.000", "alpha": "1.000"}}}], "info": INFO})


if __name__ == "__main__":
    for step in (fonts, icons):
        print(step.__name__)
        step()
    print("done:", subprocess.run(["du", "-sh", APP], capture_output=True, text=True).stdout.strip())
