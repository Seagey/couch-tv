"""Pack couch-tv as an LG TV app: build/lg/app.couchtv.home_<version>_all.ipk.

    .venv/bin/python lg/build.py --bridge http://my-computer.local:5400 [--tv living-room]
    .venv/bin/python lg/build.py              (no bridge: the home on its own, apps only)
    .venv/bin/python lg/build.py --apps my-tv-apps.json    (no bridge: bake the TV's app list in)
    .venv/bin/python lg/build.py --apps tv --tv living-room  (read it from the TV, see below)
(on Windows the Python is .venv\\Scripts\\python.exe)

Then install it on a TV in Developer Mode (docs/LG.md):

    ares-install --device <tv name> build/lg/app.couchtv.home_1.0.0_all.ipk

or with webOS Dev Manager, which takes the same .ipk.

What goes in: the TV home (tv-home/web), lg/app (the LG side), the app logos from the phone
remote, the LG app ids from bridge/apps.py, and the bridge's settings (from config.json, else
config.example.json) as the copy the TV uses when the computer is off.
--tv is the TV's id in config.json, for a house with more than one TV.
--apps bakes the TV's app list (a JSON list of {id, title, icon}, or the bridge's /api/webos/apps
reply) into the package, for firmware that refuses the list to the app (webOS 5.6.2 and 6.5.3,
couch-tv#28, #40), so an app-only install has a dock. The app keeps it as its first list and a
later reorder on the TV is kept. "--apps tv" reads the list from the TV itself over LG's network
remote (the TV must have accepted the remote once: start the bridge with this TV and press
Accept). Bundled logos (remote/src/app-logos) are used for the tiles, as the TV's own icon
addresses do not load on several TVs. For a baked app with no bundled logo, the build downloads the
TV's own icon into the package, with certificate checks off (the TV's secure port is self-signed).
--log-url sends the page's console and a copy of the screen's HTML to a computer, for testing.

The .ipk is made by this script itself: an .ipk is a Debian-style "ar" archive (debian-binary,
control.tar.gz, data.tar.gz) with the app under usr/palm/applications/<id>/, laid out the way
ares-package does it. --packer ares uses LG's ares-package instead (npm install -g @webos-tools/cli),
but the first real LG (webOS 5.6.2, couch-tv#8) refused that build with "ipk verified failed" and
installed this script's. --packer auto is the old default: ares-package if installed.
"""
import argparse
import asyncio
import io
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))

import apps  # noqa: E402
import config  # noqa: E402

WEB = os.path.join(ROOT, "tv-home", "web")
LOGOS = os.path.join(ROOT, "remote", "src", "app-logos")
OUT = os.path.join(ROOT, "build", "lg")


def _tar_gz(entries):
    """entries: (name in the archive, bytes or None for a folder). Same order every time."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.mtime, info.uid, info.gid, info.uname, info.gname = now, 0, 0, "root", "root"
            if data is None:
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                t.addfile(info)
            else:
                info.size, info.mode = len(data), 0o644
                t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _ar(members):
    """A System V "ar" archive, as ares-package writes it."""
    out = [b"!<arch>\n"]
    now = str(int(time.time())).encode()
    for name, data in members:
        out.append(name.encode().ljust(16) + now.ljust(12) + b"0".ljust(6) + b"0".ljust(6)
                   + b"100644".ljust(8) + str(len(data)).encode().ljust(10) + b"\x60\n")
        out.append(data)
        if len(data) % 2:
            out.append(b"\n")
    return b"".join(out)


def read_apps(path, tv_id):
    """The baked app list: a JSON file, or "tv" to read it from the TV over the network remote."""
    if path == "tv":
        import lg
        cfg = next((t for t in config.TVS if t.get("kind") == "lg" and (not tv_id or t["id"] == tv_id)), None)
        if not cfg:
            raise SystemExit("--apps tv: no LG TV (\"kind\": \"lg\") in config.json" + (f" with id {tv_id}" if tv_id else ""))
        tv = lg.LGTV(cfg)
        if not os.path.exists(tv.key_file):
            raise SystemExit(f"--apps tv: this TV has not accepted the remote yet ({os.path.relpath(tv.key_file, ROOT)} "
                             "is missing). Start the bridge with this TV and press Accept on the TV, or use --apps <file>.")

        async def run():
            await tv._resolve()
            tv.connected = await tv.port_open()
            await tv._remote(pairing_wait=90)
            points = await tv.apps_on_tv()
            await tv._close()
            return points
        try:
            data = asyncio.run(run())
        except Exception as e:
            raise SystemExit(f"--apps tv: could not read the app list: {e}")
    else:
        with open(path) as f:
            data = json.load(f)
    if isinstance(data, dict):
        data = data.get("apps") or data.get("launchPoints")
    if not isinstance(data, list):
        raise SystemExit("--apps: expected a JSON list of {id, title, icon}")
    out = []
    for a in data:
        if isinstance(a, dict) and a.get("id"):
            out.append({"id": str(a["id"]), "title": str(a.get("title") or a["id"]),
                        "icon": a.get("icon") or a.get("largeIcon") or None})
    if not out:
        raise SystemExit("--apps: the list has no apps")
    return out


def _plain(name):
    """The app's name the way lg/app/webos.js compares them: lower case, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


# LG's own parts, which the app does not show (the same pattern as SYSTEM in lg/app/webos.js)
LG_SYSTEM = re.compile(r"^(com\.webos\.|com\.palm\.|com\.lge\.|com\.palmdts\.)")


def fetch_tv_icons(baked, logos_dir, logos):
    """Download the TV's own icon for each baked app with no bundled logo, into the package.

    The icon addresses the TV gives are on its self-signed secure port (https://<tv>:3001/...),
    which the page cannot load, so the tile would show a letter (couch-tv#56). The computer can
    fetch them with certificate checks off. Each icon is saved under the name lg/app/webos.js
    looks for: the Android package for an app couch-tv knows, else the LG app id.
    """
    by_lg, by_name = {}, {}
    for app in apps.APPS:
        w = apps.WEBOS.get(app["id"]) or {}
        for i in w.get("ids", []):
            by_lg[i] = app["package"]
        for n in [app["name"]] + w.get("names", []):
            by_name[_plain(n)] = app["package"]
    for lg_id, name in apps.WEBOS_ONLY.items():
        by_lg[lg_id] = lg_id
        by_name[_plain(name)] = lg_id
    insecure = ssl.create_default_context()
    insecure.check_hostname = False
    insecure.verify_mode = ssl.CERT_NONE
    got, failed = 0, []
    for a in baked:
        icon = a.get("icon") or ""
        if not re.match(r"https?://", icon) or LG_SYSTEM.match(a["id"]):
            continue
        key = by_lg.get(a["id"]) or by_name.get(_plain(a["title"])) or a["id"]
        if key in logos:
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", key):   # the id becomes a file name
            failed.append(f"{a['title']} (unusual app id)")
            continue
        try:
            with urllib.request.urlopen(icon, timeout=5, context=insecure) as r:
                data = r.read(2_000_001)
        except Exception as e:
            failed.append(f"{a['title']} ({e})")
            continue
        if len(data) > 2_000_000 or not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")):
            failed.append(f"{a['title']} (not a PNG or JPEG under 2 MB)")
            continue
        with open(os.path.join(logos_dir, key + ".png"), "wb") as f:
            f.write(data)
        logos.add(key)
        got += 1
    if got or failed:
        print(f"icons from the TV: {got} saved" + (f", {len(failed)} not: " + "; ".join(failed) if failed else ""))
    return got


def pack_python(stage, info, ipk):
    app_id, version = info["id"], info["version"]
    files = []
    for dirpath, dirnames, names in os.walk(stage):
        dirnames.sort()
        rel = os.path.relpath(dirpath, stage)
        rel = "" if rel == "." else rel.replace(os.sep, "/") + "/"
        if rel:
            files.append((rel, None))
        for n in sorted(names):
            files.append((rel + n, os.path.join(dirpath, n)))
    entries, size = [], 0
    for d in ("usr", "usr/palm", "usr/palm/applications", "usr/palm/packages",
              f"usr/palm/applications/{app_id}", f"usr/palm/packages/{app_id}"):
        entries.append((d + "/", None))
    for rel, full in files:
        name = f"usr/palm/applications/{app_id}/{rel}"
        if full is None:
            entries.append((name, None))
        else:
            with open(full, "rb") as f:
                data = f.read()
            size += len(data)
            entries.append((name, data))
    pkginfo = json.dumps({"id": app_id, "version": version, "app": app_id}, indent=2).encode() + b"\n"
    entries.append((f"usr/palm/packages/{app_id}/packageinfo.json", pkginfo))
    control = "\n".join([
        f"Package: {app_id}", f"Version: {version}", "Section: misc", "Priority: optional",
        "Architecture: all", f"Installed-Size: {size}", "Maintainer: N/A <nobody@example.com>",
        "Description: This is a webOS application.", "webOS-Package-Format-Version: 2",
        "webOS-Packager-Version: x.y.x"]) + "\n"
    with open(ipk, "wb") as f:
        f.write(_ar([("debian-binary", b"2.0\n"),
                     ("control.tar.gz", _tar_gz([("control", control.encode())])),
                     ("data.tar.gz", _tar_gz(entries))]))


def pack_ares(stage, ipk):
    subprocess.run(["ares-package", "--outdir", os.path.dirname(ipk), stage],
                   check=True, stdout=subprocess.DEVNULL)
    if not os.path.exists(ipk):
        raise SystemExit(f"ares-package did not make {os.path.relpath(ipk, ROOT)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bridge", default="", help="the bridge's address, e.g. http://my-computer.local:5400")
    ap.add_argument("--key", default="", help="pairing key for the bridge API (defaults to pairing_key in config.json)")
    ap.add_argument("--tv", default="", help="this TV's id in config.json (only with more than one TV)")
    ap.add_argument("--apps", default="", metavar="FILE|tv",
                    help="bake this TV's app list into the app (a JSON file, or \"tv\" to read it from the TV)")
    ap.add_argument("--log-url", default="", help="for testing: where the app sends its console")
    ap.add_argument("--packer", choices=("python", "ares", "auto"), default="python",
                    help="make the .ipk with this script (default) or with LG's ares-package "
                         "(auto: ares-package if installed)")
    a = ap.parse_args()

    baked = read_apps(a.apps, a.tv) if a.apps else []
    stage = os.path.join(OUT, "app")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    skip = ["mock.js", ".*"]
    if (config.HOME or {}).get("hi_res") is False:
        skip.append("*@2x.*")    # home.hi_res false: the 4K copies are never shown, so leave them out
    shutil.copytree(WEB, stage, ignore=shutil.ignore_patterns(*skip))
    for name in os.listdir(os.path.join(HERE, "app")):
        shutil.copy(os.path.join(HERE, "app", name), stage)
    os.makedirs(os.path.join(stage, "logos"))
    logos = set()
    for name in os.listdir(LOGOS):
        if name.endswith(".png"):
            shutil.copy(os.path.join(LOGOS, name), os.path.join(stage, "logos", name))
            logos.add(name[:-4])
    if baked:
        fetch_tv_icons(baked, os.path.join(stage, "logos"), logos)

    # index.html: the LG side loads before the bridge settings and app.js
    index = os.path.join(stage, "index.html")
    with open(index) as f:
        html = f.read()
    tag = '<script src="config.js"></script>'
    if tag not in html:
        raise SystemExit("tv-home/web/index.html no longer loads config.js; update lg/build.py")
    html = html.replace(tag, '<script src="settings.js"></script>\n<script src="webos-apps.js"></script>\n'
                             '<script src="webos.js"></script>\n' + tag)
    with open(index, "w") as f:
        f.write(html)

    # config.js: the bridge's latest settings (boot.html keeps them), else the ones built in
    with open(os.path.join(stage, "config.js"), "w") as f:
        f.write("(function () {\n  var t = null;\n"
                "  try { t = localStorage.getItem(\"couch.configjs\"); } catch (e) {}\n"
                "  if (t) try { (0, eval)(t); } catch (e) {}\n"
                "  if (!window.COUCH_CONFIG) window.COUCH_CONFIG = " + json.dumps(config.public()) + ";\n})();\n")
    key = a.key or config.PAIRING_KEY
    settings = {"bridge": a.bridge.rstrip("/"), "tv": a.tv, "log": a.log_url.rstrip("/"), "key": key}
    with open(os.path.join(stage, "settings.js"), "w") as f:
        f.write("window.COUCH_WEBOS = " + json.dumps(settings) + ";\n")
    table = {}
    for app in apps.APPS:
        w = apps.WEBOS.get(app["id"]) or {}
        table[app["package"]] = {"id": app["id"], "name": app["name"], "ids": w.get("ids", []),
                                 "names": w.get("names", []), "logo": app["package"] in logos}
    # LG-only apps (no Android twin): keyed by their LG id, so a logo named <LG id>.png is picked up
    for lg_id, name in apps.WEBOS_ONLY.items():
        table[lg_id] = {"id": lg_id, "name": name, "ids": [lg_id], "names": [], "logo": lg_id in logos}
    with open(os.path.join(stage, "webos-apps.js"), "w") as f:
        f.write("window.COUCH_WEBOS_APPS = " + json.dumps(table, indent=1) + ";\n"
                "window.COUCH_WEBOS_LOGOS = " + json.dumps({n: True for n in sorted(logos)}) + ";\n")
    # the baked app list (empty without --apps). The version changes with every build, so the app
    # seeds its list from this once per build and keeps any reorder made on the TV after that.
    with open(os.path.join(stage, "webos-tv-apps.js"), "w") as f:
        f.write("window.COUCH_WEBOS_TV_APPS_VERSION = " + json.dumps(time.strftime("%Y-%m-%dT%H%M%S") if baked else "") + ";\n"
                "window.COUCH_WEBOS_TV_APPS = " + json.dumps(baked, indent=1) + ";\n")

    with open(os.path.join(stage, "appinfo.json")) as f:
        info = json.load(f)
    if not settings["bridge"]:
        # App-only: opening the app while it runs brings it forward instead of relaunching it (webOS
        # shows a black flash otherwise, couch-tv#40). Not with a bridge: the bridge's open has to
        # reload the page, so it can switch from the offline copy to the live home when the
        # computer comes back.
        info["handlesRelaunch"] = True
        with open(os.path.join(stage, "appinfo.json"), "w") as f:
            json.dump(info, f, indent=2)
            f.write("\n")
    ipk = os.path.join(OUT, f"{info['id']}_{info['version']}_all.ipk")
    if os.path.exists(ipk):
        os.remove(ipk)
    use_ares = a.packer == "ares" or (a.packer == "auto" and shutil.which("ares-package"))
    if use_ares:
        pack_ares(stage, ipk)
    else:
        pack_python(stage, info, ipk)
    print(f"built {os.path.relpath(ipk, ROOT)} ({os.path.getsize(ipk) // 1024} KB, "
          f"{'ares-package' if use_ares else 'packed by lg/build.py'})"
          + (f", bridge {settings['bridge']}" if settings["bridge"] else ", no bridge (apps only)")
          + (f", {len(baked)} apps baked in" if baked else ""))


if __name__ == "__main__":
    main()
