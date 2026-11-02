"""Pack couch-tv as an LG TV app: build/lg/app.couchtv.home_<version>_all.ipk.

    .venv/bin/python lg/build.py --bridge http://my-computer.local:5400 [--tv living-room]
    .venv/bin/python lg/build.py              (no bridge: the home on its own, apps only)

Then install it on a TV in Developer Mode (docs/LG.md):

    ares-install --device <tv name> build/lg/app.couchtv.home_1.0.0_all.ipk

or with webOS Dev Manager, which takes the same .ipk.

What goes in: the TV home (tv-home/web), lg/app (the LG side), the app logos from the phone
remote, the LG app ids from bridge/apps.py, and the bridge's settings (from config.json, else
config.example.json) as the copy the TV uses when the computer is off.
--tv is the TV's id in config.json, for a house with more than one TV.
--log-url sends the page's console and a copy of the screen's HTML to a computer, for testing.

The .ipk is made by this script itself: an .ipk is a Debian-style "ar" archive (debian-binary,
control.tar.gz, data.tar.gz) with the app under usr/palm/applications/<id>/, laid out the way
ares-package does it. --packer ares uses LG's ares-package instead (npm install -g @webos-tools/cli),
but the first real LG (webOS 5.6.2, couch-tv#8) refused that build with "ipk verified failed" and
installed this script's. --packer auto is the old default: ares-package if installed.
"""
import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time

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
    ap.add_argument("--tv", default="", help="this TV's id in config.json (only with more than one TV)")
    ap.add_argument("--log-url", default="", help="for testing: where the app sends its console")
    ap.add_argument("--packer", choices=("python", "ares", "auto"), default="python",
                    help="make the .ipk with this script (default) or with LG's ares-package "
                         "(auto: ares-package if installed)")
    a = ap.parse_args()

    stage = os.path.join(OUT, "app")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    shutil.copytree(WEB, stage, ignore=shutil.ignore_patterns("mock.js", ".*"))
    for name in os.listdir(os.path.join(HERE, "app")):
        shutil.copy(os.path.join(HERE, "app", name), stage)
    os.makedirs(os.path.join(stage, "logos"))
    logos = set()
    for name in os.listdir(LOGOS):
        if name.endswith(".png"):
            shutil.copy(os.path.join(LOGOS, name), os.path.join(stage, "logos", name))
            logos.add(name[:-4])

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
    settings = {"bridge": a.bridge.rstrip("/"), "tv": a.tv, "log": a.log_url.rstrip("/")}
    with open(os.path.join(stage, "settings.js"), "w") as f:
        f.write("window.COUCH_WEBOS = " + json.dumps(settings) + ";\n")
    table = {}
    for app in apps.APPS:
        w = apps.WEBOS.get(app["id"]) or {}
        table[app["package"]] = {"id": app["id"], "name": app["name"], "ids": w.get("ids", []),
                                 "names": w.get("names", []), "logo": app["package"] in logos}
    with open(os.path.join(stage, "webos-apps.js"), "w") as f:
        f.write("window.COUCH_WEBOS_APPS = " + json.dumps(table, indent=1) + ";\n")

    with open(os.path.join(stage, "appinfo.json")) as f:
        info = json.load(f)
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
          + (f", bridge {settings['bridge']}" if settings["bridge"] else ", no bridge (apps only)"))


if __name__ == "__main__":
    main()
