"""Pack couch-tv as a Samsung TV app: build/samsung/CouchTV.wgt (unsigned).

    .venv/bin/python samsung/build.py --bridge http://my-computer.local:5400 [--tv living-room]
    .venv/bin/python samsung/build.py              (no bridge: the home on its own, apps only)

Then install it, which signs it with your own Samsung certificate (docs/SAMSUNG.md):

    apps2samsung-cli install build/samsung/CouchTV.wgt --tv <tv address>

What goes in: the TV home (tv-home/web), samsung/app (the Samsung side), the app logos from the
phone remote (any of your own in samsung/my-logos/<package>.png replace them), the Samsung app ids from bridge/apps.py, and the bridge's settings (from config.json,
else config.example.json) as the copy the TV uses when the computer is off.
--tv is the TV's id in config.json, for a house with more than one TV.
--log-url sends the page's console and a copy of the screen's HTML to a computer, for testing.
"""
import argparse
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))

import apps  # noqa: E402
import config  # noqa: E402

WEB = os.path.join(ROOT, "tv-home", "web")
LOGOS = os.path.join(ROOT, "remote", "src", "app-logos")
ICON = os.path.join(ROOT, "remote", "public", "icons", "icon-512.png")
OUT = os.path.join(ROOT, "build", "samsung")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bridge", default="", help="the bridge's address, e.g. http://my-computer.local:5400")
    ap.add_argument("--key", default="", help="pairing key for the bridge API (defaults to pairing_key in config.json)")
    ap.add_argument("--tv", default="", help="this TV's id in config.json (only with more than one TV)")
    ap.add_argument("--log-url", default="", help="for testing: where the app sends its console")
    a = ap.parse_args()

    stage = os.path.join(OUT, "app")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    shutil.copytree(WEB, stage, ignore=shutil.ignore_patterns("mock.js", ".*"))
    for name in os.listdir(os.path.join(HERE, "app")):
        shutil.copy(os.path.join(HERE, "app", name), stage)
    shutil.copy(ICON, os.path.join(stage, "icon.png"))
    os.makedirs(os.path.join(stage, "logos"))
    logos = set()
    for name in os.listdir(LOGOS):
        if name.endswith(".png"):
            shutil.copy(os.path.join(LOGOS, name), os.path.join(stage, "logos", name))
            logos.add(name[:-4])
    # Your own logo for an app (git ignored): samsung/my-logos/<package>.png beats the bundled one and
    # the TV's own icon, for an app whose Tizen icon looks wrong on the home.
    mine = os.path.join(HERE, "my-logos")
    if os.path.isdir(mine):
        for name in sorted(os.listdir(mine)):
            if name.endswith(".png"):
                shutil.copy(os.path.join(mine, name), os.path.join(stage, "logos", name))
                logos.add(name[:-4])

    # index.html: the Samsung side loads before the bridge settings and app.js
    index = os.path.join(stage, "index.html")
    with open(index) as f:
        html = f.read()
    tag = '<script src="config.js"></script>'
    if tag not in html:
        raise SystemExit("tv-home/web/index.html no longer loads config.js; update samsung/build.py")
    css = '<link rel="stylesheet" href="app.css">'
    if css not in html:
        raise SystemExit("tv-home/web/index.html no longer loads app.css; update samsung/build.py")
    html = html.replace(css, css + '\n<link rel="stylesheet" href="tizen.css">')
    html = html.replace(tag, '<script src="$WEBAPIS/webapis/webapis.js"></script>\n'
                             '<script src="settings.js"></script>\n<script src="tizen-apps.js"></script>\n'
                             '<script src="tizen.js"></script>\n' + tag)
    with open(index, "w") as f:
        f.write(html)

    # config.js: the bridge's latest settings (boot.html keeps them), else the ones built in
    with open(os.path.join(stage, "config.js"), "w") as f:
        f.write("(function () {\n  var t = null;\n"
                "  try { t = localStorage.getItem(\"couch.configjs\"); } catch (e) {}\n"
                "  if (t) try { (0, eval)(t); } catch (e) {}\n"
                "  if (!window.COUCH_CONFIG) window.COUCH_CONFIG = " + json.dumps(config.public()) + ";\n})();\n")
    # Per-TV settings, from this TV's entry in config.json.
    tv_cfg = next((t for t in config.TVS if t["id"] == (a.tv or config.DEFAULT_TV)), None)
    if a.tv and tv_cfg is None:
        raise SystemExit(f"no TV called {a.tv} in config.json")
    tv_cfg = tv_cfg or {}
    sky = tv_cfg.get("sky_hdmi")
    if sky is not None and (not isinstance(sky, int) or isinstance(sky, bool) or not 1 <= sky <= 4):
        raise SystemExit(f"{tv_cfg['id']}: sky_hdmi must be a port number from 1 to 4, or left out")
    key = a.key or config.PAIRING_KEY
    settings = {"bridge": a.bridge.rstrip("/"), "tv": a.tv, "log": a.log_url.rstrip("/"), "sky_hdmi": sky, "key": key}
    with open(os.path.join(stage, "settings.js"), "w") as f:
        f.write("window.COUCH_TIZEN = " + json.dumps(settings) + ";\n")
    table = {}
    for app in apps.APPS:
        t = apps.TIZEN.get(app["id"])
        if t:
            table[app["package"]] = {"id": app["id"], "name": app["name"], "ids": t["ids"],
                                     "app": t.get("app"), "logo": app["package"] in logos}
    with open(os.path.join(stage, "tizen-apps.js"), "w") as f:
        f.write("window.COUCH_TIZEN_APPS = " + json.dumps(table, indent=1) + ";\n")

    wgt = os.path.join(OUT, "CouchTV.wgt")
    if os.path.exists(wgt):
        os.remove(wgt)
    with zipfile.ZipFile(wgt, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, names in os.walk(stage):
            for n in sorted(names):
                full = os.path.join(dirpath, n)
                z.write(full, os.path.relpath(full, stage))
    print(f"built {os.path.relpath(wgt, ROOT)} ({os.path.getsize(wgt) // 1024} KB)"
          + (f", bridge {settings['bridge']}" if settings["bridge"] else ", no bridge (apps only)"))


if __name__ == "__main__":
    main()
