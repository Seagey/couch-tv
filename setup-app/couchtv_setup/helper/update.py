"""Updates for the helper, from couch-tv's own GitHub releases, checked three ways before anything is used:
- size and SHA-256 of the download against SHA256SUMS-setup.txt (and GitHub's own digest, as release.py does);
- SHA256SUMS-setup.txt itself against its Ed25519 signature (SHA256SUMS-setup.txt.sig), made with a key that
  is not on GitHub. The public half is in this file. A compromised GitHub account alone cannot push an update;
- a file that fails either check is deleted.
The new version is unpacked beside the app and swapped in when the person presses Restart (or quits), by a
small script that waits for this program to exit. The old version is kept for one click rollback.
The private key lives at ~/.couch-tv-signing/update-ed25519.pem on the release computer, never in the repo
(scripts/sign-setup-sums.py uses it; COUCHTV_SIGNING_KEY names another file).
"""
import base64
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

from .. import __version__, paths, release
from ..tv import TvError

PUBLIC_KEY_B64 = "Zie/b41wh7LHnna3yaS4NSa3jLkuyn9SJOFfezNVKe0="
SUMS = "SHA256SUMS-setup.txt"
SIG = SUMS + ".sig"
NAMES = {"mac-apple-silicon": "couch-tv-Setup-mac-apple-silicon.zip", "mac-intel": "couch-tv-Setup-mac-intel.zip",
         "windows": "couch-tv-Setup-windows.zip", "linux": "couch-tv-Setup-linux.tar.gz"}


def flavour(system=None, machine=None):
    system = system or sys.platform
    machine = (machine or platform.machine()).lower()
    if system == "darwin":
        return "mac-apple-silicon" if machine in ("arm64", "aarch64") else "mac-intel"
    return "windows" if system == "win32" else "linux"


def version_tuple(v):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else None


def newer(tag, current=__version__):
    a, b = version_tuple(tag), version_tuple(current)
    return bool(a and b and a > b)


def verify_signature(message, signature, public_key_b64=PUBLIC_KEY_B64):
    """True only when `signature` (raw 64 bytes, or its base64) is a valid Ed25519 signature of `message`."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        sig = signature
        if len(sig) != 64:     # the .sig file holds base64 text and a newline
            sig = base64.b64decode(bytes(sig).strip(), validate=True)
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64)).verify(bytes(sig), message)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def _asset_bytes(rel, name, limit=65536):
    asset = next((a for a in rel.get("assets", []) if a.get("name") == name), None)
    if not asset:
        raise TvError("The release has no %s, so it was not used." % name, "no_asset")
    with release._open(asset["browser_download_url"]) as r:
        return r.read(limit)


def check(current=__version__, latest=release.latest):
    """{"state": "up_to_date" | "available" | "error", "tag": ..., "release": ...}. Never raises."""
    try:
        rel = latest()
    except TvError:
        return {"state": "error"}
    tag = str(rel.get("tag_name") or "")
    return {"state": "available" if newer(tag, current) else "up_to_date", "tag": tag, "release": rel}


def stage(rel, progress=lambda f, m=None: None, system=None, machine=None, staging=None, fetch=_asset_bytes):
    """Downloads the archive for this computer into the staging folder and checks it. Returns the archive's path.
    Order matters: the signature on SHA256SUMS-setup.txt first, then the archive against that file."""
    name = NAMES[flavour(system, machine)]
    sums_raw, sig = fetch(rel, SUMS), fetch(rel, SIG)
    if not verify_signature(sums_raw, sig):
        raise TvError("The update's checksum list is not signed by Couch TV, so it was not used.", "bad_signature")
    want = release.parse_sums(sums_raw.decode("utf-8", "replace")).get(name)
    asset = next((a for a in rel.get("assets", []) if a.get("name") == name), None)
    if not asset or not want:
        raise TvError("The release has no signed checksum for %s." % name, "no_checksum")
    sha, _ = release.expected(asset.get("digest"), want)
    folder = Path(staging or paths.cache() / "helper-update")
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name
    part = dest.with_name(name + ".part")
    try:
        with release._open(asset["browser_download_url"], timeout=60) as r, open(part, "wb") as f:
            total, got = int(asset.get("size") or 0), 0
            for chunk in iter(lambda: r.read(256 * 1024), b""):
                f.write(chunk)
                got += len(chunk)
                if total:
                    progress(min(1.0, got / total), "Downloading the update")
    except OSError as e:
        part.unlink(missing_ok=True)
        raise TvError("The update download stopped part way.", "offline") from e
    if (asset.get("size") and part.stat().st_size != asset["size"]) or not release.verify(part, sha):
        part.unlink()
        raise TvError("The update did not match its checksum, so it was deleted.", "checksum")
    part.replace(dest)
    (folder / "pending.json").write_text(json.dumps({"tag": rel.get("tag_name"), "archive": name, "sha256": sha}), encoding="utf-8")
    return dest


def unpack(archive, into):
    """Unpacks the verified archive. Refuses any member that would land outside `into`."""
    into = Path(into).resolve()
    into.mkdir(parents=True, exist_ok=True)
    archive = str(archive)
    if archive.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for n in z.namelist():
                if into not in (into / n).resolve().parents:
                    raise TvError("The update held a file outside its folder, so it was not used.", "bad_archive")
            z.extractall(into)
    else:
        with tarfile.open(archive) as t:
            for m in t.getmembers():
                if into not in (into / m.name).resolve().parents or m.issym() or m.islnk():
                    raise TvError("The update held a file outside its folder, so it was not used.", "bad_archive")
            t.extractall(into)
    return [p for p in into.iterdir()]


def app_location(exe=None, system=None):
    """What the swap replaces: the .app on a Mac, the program's folder on Windows and Linux. None from source."""
    if not getattr(sys, "frozen", False) and exe is None:
        return None
    exe = Path(exe or sys.executable).resolve()
    if (system or sys.platform) == "darwin":
        for p in exe.parents:
            if p.suffix == ".app":
                return p
        return None
    return exe.parent


def swap_script(old, new, keep, pid, relaunch, system=None):
    """The script that waits for this program to exit, keeps the old version as `keep`, puts the new one in
    its place and starts it. On a failed move the old one is put back."""
    if (system or sys.platform) == "win32":
        return ('@echo off\r\n:wait\r\ntasklist /FI "PID eq %d" 2>NUL | find "%d" >NUL\r\nif not errorlevel 1 (timeout /t 1 >NUL & goto wait)\r\n'
                'if exist "%s" rmdir /S /Q "%s"\r\nmove "%s" "%s" || goto done\r\nmove "%s" "%s" || move "%s" "%s"\r\n:done\r\nstart "" %s\r\n'
                % (pid, pid, keep, keep, old, keep, new, old, keep, old, relaunch))
    q = lambda s: "'" + str(s).replace("'", "'\\''") + "'"
    return ("#!/bin/sh\nwhile kill -0 %d 2>/dev/null; do sleep 1; done\nrm -rf %s\n"
            "mv %s %s || exit 1\nmv %s %s || mv %s %s\n%s &\n" % (pid, q(keep), q(old), q(keep), q(new), q(old), q(keep), q(old), relaunch))


def apply(staging=None, spawn=subprocess.Popen, system=None):
    """Unpacks the staged update and starts the swap. The caller quits right after. Returns False when
    there is nothing staged or this is not the built app."""
    folder = Path(staging or paths.cache() / "helper-update")
    try:
        pending = json.loads((folder / "pending.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    old = app_location(system=system)
    if not old:
        return False
    out = folder / "new"
    shutil.rmtree(out, ignore_errors=True)
    unpack(folder / pending["archive"], out)
    items = [p for p in out.iterdir()]
    if len(items) != 1:
        return False
    keep = folder / "previous" / old.name
    keep.parent.mkdir(parents=True, exist_ok=True)
    plat = system or sys.platform
    if plat == "win32":
        script = folder / "swap.cmd"
        relaunch = '"%s" --helper' % (old / Path(sys.executable).name)
    else:
        script = folder / "swap.sh"
        if plat == "darwin":
            relaunch = "open -a '%s' --args --helper" % old
        else:
            relaunch = "'%s' --helper" % (old / Path(sys.executable).name)
    script.write_text(swap_script(old, items[0], keep, os.getpid(), relaunch, system), encoding="utf-8")
    os.chmod(script, 0o700)
    spawn(["cmd", "/c", str(script)] if (system or sys.platform) == "win32" else ["/bin/sh", str(script)],
          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return True


def rollback_available(staging=None):
    return any((Path(staging or paths.cache() / "helper-update") / "previous").glob("*"))
