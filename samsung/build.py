"""Pack couch-tv as a Samsung TV app: build/samsung/CouchTV.wgt (unsigned).

    .venv/bin/python samsung/build.py --bridge http://my-computer.local:5400 [--tv living-room]
    .venv/bin/python samsung/build.py              (no bridge: the home on its own, apps only)
    .venv/bin/python samsung/build.py --release    (the GitHub release files, see below)

Then install it, which signs it with your own Samsung certificate (docs/SAMSUNG.md):

    apps2samsung-cli install build/samsung/CouchTV.wgt --tv <tv address>

What goes in: the TV home (tv-home/web), samsung/app (the Samsung side), the app logos from the
phone remote (any of your own in samsung/my-logos/<package>.png replace them), the Samsung app ids from bridge/apps.py, and the bridge's settings (from config.json,
else config.example.json) as the copy the TV uses when the computer is off.
--tv is the TV's id in config.json, for a house with more than one TV.
--log-url sends the page's console and a copy of the screen's HTML to a computer, for testing.

--release makes the two files a GitHub release carries for Samsung, for people with no AI agent:
build/samsung/couch-tv-samsung.wgt (the app, no bridge and none of this computer's settings: it
always reads config.example.json) and build/samsung/couch-tv-samsung-setup.zip (that app, the
double-click installers for Mac and Windows from samsung/setup, and START HERE.txt).
"""
import argparse
import json
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))
if "--release" in sys.argv:
    # a release never carries this computer's settings, whatever config.json says
    os.environ["COUCH_CONFIG"] = os.path.join(ROOT, "config.example.json")

import apps  # noqa: E402
import config  # noqa: E402

WEB = os.path.join(ROOT, "tv-home", "web")
LOGOS = os.path.join(ROOT, "remote", "src", "app-logos")
ICON = os.path.join(ROOT, "remote", "public", "icons", "icon-512.png")
GRADLE = os.path.join(ROOT, "tv-home", "android", "app", "build.gradle.kts")
SETUP = os.path.join(HERE, "setup")
OUT = os.path.join(ROOT, "build", "samsung")
RELEASE_DIR = "couch-tv for Samsung"


def web_ignore(release=False):
    """shutil.copytree's ignore for tv-home/web: the mock bridge and dotfiles anywhere, and the Loop
    look's folder at the top (loop/, up to 80 MB of footage and stills from scripts/make-loop.sh, git
    ignored). The Samsung app reads the loop from the bridge's /tv/loop/, so nothing in it is ever
    needed here. A release (`release`) also leaves out backgrounds/mine, the photos of this computer's
    own home, so the file everyone downloads never carries them."""
    by_pattern = shutil.ignore_patterns("mock.js", ".*")

    def ignore(folder, names):
        out = set(by_pattern(folder, names))
        here = os.path.abspath(folder)
        if here == os.path.abspath(WEB) and "loop" in names:
            out.add("loop")
        if release and here == os.path.abspath(os.path.join(WEB, "backgrounds")) and "mine" in names:
            out.add("mine")
        return out
    return ignore


def couch_version():
    """couch-tv's version (the TV home's versionName), also the Samsung app's version."""
    with open(GRADLE) as f:
        m = re.search(r'versionName\s*=\s*"(\d+\.\d+\.\d+)"', f.read())
    if not m:
        raise SystemExit("no versionName in tv-home/android/app/build.gradle.kts; update samsung/build.py")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bridge", default="", help="the bridge's address, e.g. http://my-computer.local:5400")
    ap.add_argument("--key", default="", help="pairing key for the bridge API (defaults to pairing_key in config.json)")
    ap.add_argument("--tv", default="", help="this TV's id in config.json (only with more than one TV)")
    ap.add_argument("--log-url", default="", help="for testing: where the app sends its console")
    ap.add_argument("--release", action="store_true", help="the GitHub release files: no bridge, no settings of this computer")
    a = ap.parse_args()
    if a.release and (a.bridge or a.key or a.tv or a.log_url):
        raise SystemExit("--release takes no --bridge, --key, --tv or --log-url: it is the same file for everyone")
    version = couch_version()

    stage = os.path.join(OUT, "app")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    shutil.copytree(WEB, stage, ignore=web_ignore(a.release))
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
    if os.path.isdir(mine) and not a.release:
        for name in sorted(os.listdir(mine)):
            if name.endswith(".png"):
                shutil.copy(os.path.join(mine, name), os.path.join(stage, "logos", name))
                logos.add(name[:-4])

    # config.xml: the app's version is couch-tv's (update.js compares it with the latest release)
    cfg_xml = os.path.join(stage, "config.xml")
    with open(cfg_xml) as f:
        xml = f.read()
    xml, n = re.subn(r'(<widget[^>]*\sversion=")[^"]*(")', r"\g<1>" + version + r"\g<2>", xml, count=1)
    if n != 1:
        raise SystemExit("samsung/app/config.xml has no version on <widget>; update samsung/build.py")
    with open(cfg_xml, "w") as f:
        f.write(xml)

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
                             '<script src="settings.js"></script>\n<script src="kept.js"></script>\n'
                             '<script src="tizen-apps.js"></script>\n'
                             '<script src="tizen.js"></script>\n<script src="update.js"></script>\n' + tag)
    gate = '<script src="designer-gate.js"></script>'
    if gate not in html:
        raise SystemExit("tv-home/web/index.html no longer loads designer-gate.js; update samsung/build.py")
    html = html.replace(gate, gate + '\n<script src="tizen-policy.js"></script>')
    with open(index, "w") as f:
        f.write(html)

    # config.js: the bridge's latest settings (boot.html keeps them), else the ones built in
    with open(os.path.join(stage, "config.js"), "w") as f:
        f.write("(function () {\n  var t = null;\n"
                "  try { t = localStorage.getItem(\"couch.configjs\"); } catch (e) {}\n"
                "  if (t) try { (0, eval)(t); } catch (e) {}\n"
                "  if (!window.COUCH_CONFIG) window.COUCH_CONFIG = " + json.dumps(config.public()) + ";\n})();\n")
    # Per-TV settings, from this TV's entry in config.json.
    tv_cfg = None if a.release else next((t for t in config.TVS if t["id"] == (a.tv or config.DEFAULT_TV)), None)
    if a.tv and tv_cfg is None:
        raise SystemExit(f"no TV called {a.tv} in config.json")
    tv_cfg = tv_cfg or {}
    sky = tv_cfg.get("sky_hdmi")
    if sky is not None and (not isinstance(sky, int) or isinstance(sky, bool) or not 1 <= sky <= 4):
        raise SystemExit(f"{tv_cfg['id']}: sky_hdmi must be a port number from 1 to 4, or left out")
    key = "" if a.release else (a.key or config.PAIRING_KEY)
    settings = {"bridge": a.bridge.rstrip("/"), "tv": a.tv, "log": a.log_url.rstrip("/"), "sky_hdmi": sky, "key": key,
                "version": version}
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
    print(f"built {os.path.relpath(wgt, ROOT)} ({os.path.getsize(wgt) // 1024} KB), couch-tv {version}"
          + (f", bridge {settings['bridge']}" if settings["bridge"] else ", no bridge (apps only)"))
    if a.release:
        release(wgt, version)


def release(wgt, version):
    """The release's Samsung files: the app on its own, and the setup zip around it."""
    plain = os.path.join(OUT, "couch-tv-samsung.wgt")
    shutil.copy(wgt, plain)
    out = os.path.join(OUT, "couch-tv-samsung-setup.zip")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        def add(src, name, mode=0o644):
            info = zipfile.ZipInfo(f"{RELEASE_DIR}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = (0o100000 | mode) << 16   # Unix mode, so the Mac script stays runnable
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(src, "rb") as f:
                z.writestr(info, f.read())
        add(wgt, "CouchTV.wgt")
        with open(os.path.join(SETUP, "START HERE.txt")) as f:
            start = f.read().replace("{VERSION}", version)
        tmp = os.path.join(OUT, "START HERE.txt")
        with open(tmp, "w", newline="\r\n") as f:   # Windows Notepad shows it with line breaks too
            f.write(start)
        add(tmp, "START HERE.txt")
        add(os.path.join(SETUP, "Install on Mac.command"), "Install on Mac.command", 0o755)
        for name in ("Install on Windows.cmd", "install-windows.ps1"):   # Windows line ends
            with open(os.path.join(SETUP, name)) as f:
                text = f.read()
            tmp = os.path.join(OUT, name)
            with open(tmp, "w", newline="\r\n") as f:
                f.write(text)
            add(tmp, name)
    print(f"built {os.path.relpath(plain, ROOT)} and {os.path.relpath(out, ROOT)} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
