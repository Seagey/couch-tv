"""Pack couch-tv as a Roku channel (build/roku/couch-tv_<version>.zip), and optionally sideload it.

    .venv/bin/python roku/build.py --bridge http://192.0.2.20:5400 [--tv living-room]
    .venv/bin/python roku/build.py --bridge http://192.0.2.20:5400 --install 192.0.2.30
    .venv/bin/python roku/build.py                      (no bridge: the clock, the date and the Roku's own apps)
    .venv/bin/python roku/build.py --apps-from 192.0.2.30     (no bridge, Roku OS 16: bake the app list in)

Then, if you did not use --install, open http://<roku address> in a browser, sign in as rokudev with the
developer password and upload the zip (docs/ROKU.md has the steps, including turning Developer Mode on).

What goes in: roku/channel (the BrightScript and SceneGraph code, the pictures and fonts, scenes.json),
and a config.json with the bridge's address and this TV's id. No passwords or keys go in the zip.
--tv is the TV's id in config.json, for a house with more than one TV.
--install sideloads over the network with Roku's developer installer (port 80, HTTP digest sign in as
rokudev). The password comes from --password, else the ROKU_DEV_PASSWORD environment variable, else it is
asked for (the ask does not work in every Windows terminal, so use one of the first two there; --password
shows in the process list, the environment variable does not). It is never printed or kept.
--apps-from reads the Roku's app list and icons over ECP from this computer and puts them in the zip,
because Roku OS 16 refuses a channel's own ECP (403). The list is a snapshot: rebuild after installing apps. Replacing an installed copy needs no uninstall.
The pictures are made by roku/make-assets.py from the TV home's own; they are committed, so a build needs
nothing but Python.
"""
import argparse
import getpass
import html
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config
CHANNEL = os.path.join(HERE, "channel")
OUT = os.path.join(ROOT, "build", "roku")
SIZE_LIMIT = 4 * 1024 * 1024   # Roku's documented size for a channel package (developer.roku.com)


def manifest_version():
    with open(os.path.join(CHANNEL, "manifest")) as f:
        text = f.read()
    n = {k: re.search(rf"^{k}=(\d+)", text, re.M).group(1) for k in ("major_version", "minor_version", "build_version")}
    return f"{int(n['major_version'])}.{int(n['minor_version'])}.{int(n['build_version'])}"


def check_bridge(url):
    if not url:
        return ""
    if not re.fullmatch(r"https?://[^\s/]+(:\d+)?", url.rstrip("/")):
        raise SystemExit(f"--bridge: expected an address like http://192.0.2.20:5400, got {url}")
    host = re.sub(r"^https?://", "", url).split(":")[0]
    if host.endswith(".local"):
        print("note: a .local name may not resolve on a Roku. Use the computer's number address if the home stays empty.")
    return url.rstrip("/")


ICON_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
ICON_MAGIC = {"png": b"\x89PNG\r\n\x1a\n", "jpg": b"\xff\xd8\xff", "webp": b"RIFF"}
ICON_MAX = 256 * 1024     # a Roku app icon is a few KB; anything bigger is not one
LIST_MAX = 512 * 1024
APPS_MAX = 200
ICON_DIR = "images/roku-icons"
APP_ID = re.compile(r"[0-9]+|[A-Za-z0-9_]+")


def safe_app_id(aid):
    """Ids from the Roku are written into file names, so only numbers, letters and underscores pass."""
    return bool(aid) and len(aid) <= 40 and APP_ID.fullmatch(aid) is not None


def parse_app_list(body):
    """query/apps XML to [{id, title}]. Skips the sideloaded channel (dev), anything that is not an app,
    and any id that is not safe to use in a file name."""
    apps, seen = [], set()
    for m in re.finditer(r'<app\s([^>]*?)>(.*?)</app>', body, re.S):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        aid = attrs.get("id", "")
        if attrs.get("type") != "appl" or aid == "dev" or not safe_app_id(aid) or aid in seen:
            continue
        title = re.sub(r"[\x00-\x1f\x7f]", "", html.unescape(m.group(2))).strip()[:60] or aid
        seen.add(aid)
        apps.append({"id": aid, "title": title})
        if len(apps) >= APPS_MAX:
            break
    return apps


def icon_file(aid, content_type, data):
    """Where an icon goes in the zip, or None if the Roku's answer is not a small picture we expect.
    The name is built from the checked id and a fixed extension, never from anything else the Roku said."""
    ext = ICON_TYPES.get((content_type or "").split(";")[0].strip().lower())
    if not ext or not safe_app_id(aid) or not data or len(data) > ICON_MAX:
        return None
    if not data.startswith(ICON_MAGIC[ext]):
        return None
    return f"{ICON_DIR}/{aid}.{ext}"


def check_host(host):
    if not re.fullmatch(r"[A-Za-z0-9.\-]{1,253}(:\d{1,5})?", host or ""):
        raise SystemExit(f"--apps-from: expected the Roku's address, like 192.0.2.30, got {host}")
    return host


def ecp_get(url):
    """(content type, body), the body cut off one byte past the largest size anything here accepts."""
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.headers.get_content_type(), r.read(LIST_MAX + 1)


def snapshot_apps(host, get=ecp_get):
    """Read the Roku's app list and icons over ECP from this computer.

    Roku OS 16 answers 403 when a channel asks its own TV (127.0.0.1:8060) for query/apps, even with
    Control by mobile apps on Permissive, so with no bridge the dock stayed empty. The list and icons
    go into the zip instead. Returns (apps, {path in the zip: bytes}). `get` is for tests."""
    base = f"http://{check_host(host)}:8060" if ":" not in host else f"http://{check_host(host)}"
    _, body = get(base + "/query/apps")
    if len(body) > LIST_MAX:
        raise SystemExit("the Roku's app list is far bigger than expected, so it was not used")
    apps, files = parse_app_list(body.decode(errors="replace")), {}
    for a in apps:
        try:
            ctype, data = get(f"{base}/query/icon/{a['id']}")
        except (urllib.error.URLError, OSError):
            continue
        name = icon_file(a["id"], ctype, data)
        if name:
            files[name] = data
            a["icon"] = "pkg:/" + name
    return apps, files


def build(bridge="", tv="", out=None, key="", apps_from=""):
    """Make the zip. Returns its path."""
    bridge = check_bridge(bridge)
    if tv and not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", tv):
        raise SystemExit("--tv: letters, numbers and dashes only")
    key = key or config.PAIRING_KEY
    out = out or OUT
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"couch-tv_{manifest_version()}.zip")
    apps, icons = snapshot_apps(apps_from) if apps_from else ([], {})
    entries = {}
    for dirpath, dirnames, names in os.walk(CHANNEL):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for n in sorted(names):
            if n.startswith("."):
                continue
            full = os.path.join(dirpath, n)
            entries[os.path.relpath(full, CHANNEL).replace(os.sep, "/")] = full
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(entries.pop("manifest"), "manifest")   # first, as Roku's own tools do
        for name, full in entries.items():
            z.write(full, name)
        for name, data in icons.items():
            z.writestr(name, data)
        cfg = {"bridge": bridge, "tv": tv}
        if key:
            cfg["key"] = key
        if apps_from:
            cfg["apps"] = apps
        z.writestr("config.json", json.dumps(cfg) + "\n")
    size = os.path.getsize(path)
    shown = os.path.relpath(path, ROOT) if path.startswith(ROOT) else path
    print(f"{shown}  {size / 1024 / 1024:.2f} MB, bridge {bridge or 'none'}")
    if apps_from:
        print(f"apps from {apps_from}: {len(apps)} apps, {len(icons)} icons (a snapshot: rebuild after installing apps)")
    if size > SIZE_LIMIT:
        print("warning: that is over 4 MB. Roku may refuse it.")
    return path


def multipart(fields, filename, data):
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    body.write((f'--{boundary}\r\nContent-Disposition: form-data; name="archive"; filename="{filename}"\r\n'
                "Content-Type: application/x-zip-compressed\r\n\r\n").encode())
    body.write(data)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


def install(zip_path, host, password, port=80):
    """Sideload with the developer installer. Returns (ok, what the Roku said)."""
    base = f"http://{host}" + (f":{port}" if port != 80 else "")
    mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    mgr.add_password(None, base, "rokudev", password)
    opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(mgr))
    with open(zip_path, "rb") as f:
        body, ctype = multipart({"mysubmit": "Replace"}, os.path.basename(zip_path), f.read())
    req = urllib.request.Request(base + "/plugin_install", data=body, headers={"Content-Type": ctype}, method="POST")
    try:
        with opener.open(req, timeout=60) as r:
            page = r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False, "the Roku refused the developer password (user rokudev)"
        return False, f"the Roku answered {e.code}"
    except (urllib.error.URLError, OSError) as e:
        return False, f"could not reach the Roku's developer installer at {host}: {getattr(e, 'reason', e)} (is Developer Mode on?)"
    m = re.search(r'<font color="red">(.*?)</font>', page, re.S)
    said = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
    if re.search(r"Install Success|Application Received|Identical to previous", page, re.I):
        return True, said or "installed"
    return False, said or "the Roku did not say it installed (open http://%s in a browser to see why)" % host


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bridge", default="", help="the bridge's address, e.g. http://192.0.2.20:5400 (left out: no bridge)")
    ap.add_argument("--key", default="", help="pairing key for the bridge API (defaults to pairing_key in config.json)")
    ap.add_argument("--tv", default="", help="this TV's id in config.json (only with more than one TV)")
    ap.add_argument("--install", default="", metavar="ROKU_ADDRESS", help="sideload the zip to this Roku (Developer Mode must be on)")
    ap.add_argument("--apps-from", default="", metavar="ROKU_ADDRESS",
                    help="no bridge: copy this Roku's app list and icons into the channel (Roku OS 16 refuses a channel's own ECP)")
    ap.add_argument("--password", default="", help="the developer password for --install (else ROKU_DEV_PASSWORD, else asked for)")
    a = ap.parse_args()
    path = build(a.bridge, a.tv, key=a.key, apps_from=a.apps_from)
    if a.install:
        pw = a.password or os.environ.get("ROKU_DEV_PASSWORD") or getpass.getpass("Roku developer password: ")
        ok, said = install(path, a.install, pw)
        print(("installed: " if ok else "not installed: ") + said)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
