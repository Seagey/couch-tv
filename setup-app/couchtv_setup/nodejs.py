"""N13 (28 Nov 2026): Node.js for Matter on the Couch TV Helper's bridge (web TVs: Samsung, LG), for a computer that has none.

The bridge's Matter controller is a Node.js program (bridge/matter.py, docs/MATTER.md) and needs Node 22.13 or newer. Instead of putting
a runtime into every download of the app (about 100 MB more on disk and about 50 MB more to download, per computer type), Setup fetches
the official Node.js release the first time Matter is added on a computer that has no usable Node, and keeps it in the Helper's own folder
(helper-data/node/<version>/), never anywhere else on the computer:
- one exact pinned version (NODE_VERSION), from nodejs.org/dist only (https);
- the archive's SHA-256 must equal the pin in this file AND the line for that file in nodejs.org's own SHASUMS256.txt for that version;
- only the one program is taken out of the archive (a fixed member name), nothing else is unpacked, nothing is run until it checks out;
- it is made in a temporary name and moved into place whole, then asked its version before it is used.
A Node the computer already has (22.13 or newer) is always used first and nothing is downloaded.
"""
import hashlib
import io
import os
import platform
import re
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

from . import paths
from .tv import TvError

NODE_VERSION = "22.23.5"
NODE_MIN = (22, 13)
DIST = "https://nodejs.org/dist"
MAX_BYTES = 80 * 1024 * 1024     # the biggest pinned archive is 51 MB

# file name -> sha256, copied from https://nodejs.org/dist/v22.23.5/SHASUMS256.txt (checked again against that file at download time)
PINNED = {
    "darwin-arm64": ("node-v22.23.5-darwin-arm64.tar.gz", "e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d"),
    "darwin-x64": ("node-v22.23.5-darwin-x64.tar.gz", "c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422"),
    "linux-arm64": ("node-v22.23.5-linux-arm64.tar.gz", "8bd3dc69eee8f3f226315a80d7d1d4faccf217a4c8fae500168ac2e38f3bdba3"),
    "linux-x64": ("node-v22.23.5-linux-x64.tar.gz", "c54118104acc524633b5abe106bbf44a53126ec8b4e5fa105cb92b5d7de8a1a1"),
    "win-arm64": ("node-v22.23.5-win-arm64.zip", "c1856817f611738c77534efbff8a5a17990593eab24046bc8d2c23a77a160d13"),
    "win-x64": ("node-v22.23.5-win-x64.zip", "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3"),
}
SIZES_MB = {"darwin-arm64": 50, "darwin-x64": 51, "linux-arm64": 57, "linux-x64": 57, "win-arm64": 31, "win-x64": 36}   # download, about


def platform_key(system=None, machine=None):
    s = (system or sys.platform).lower()
    m = (machine or platform.machine()).lower()
    arch = "arm64" if m in ("arm64", "aarch64") else "x64" if m in ("x86_64", "amd64", "x64") else None
    os_ = "darwin" if s.startswith("darwin") else "win" if s.startswith(("win", "cygwin")) else "linux" if s.startswith("linux") else None
    return f"{os_}-{arch}" if os_ and arch and f"{os_}-{arch}" in PINNED else None


def node_dir():
    return paths.data() / "helper-data" / "node" / ("v" + NODE_VERSION)


def helper_node(key=None):
    """The Helper's own node program, if it is there (not checked for working)."""
    key = key or platform_key()
    p = node_dir() / ("node.exe" if (key or "").startswith("win") else "node")
    return p if p.is_file() else None


def version_of(node):
    """(major, minor, patch) of a node program, or None."""
    try:
        out = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", out)
    return tuple(int(x) for x in m.groups()) if m else None


def system_node():
    """The computer's own node if it is 22.13 or newer: its path and version, else None."""
    import shutil
    n = shutil.which("node")
    v = version_of(n) if n else None
    return (n, v) if v and v[:2] >= NODE_MIN else None


def usable():
    """(path, how) of a Node the bridge can use now: the computer's own first, then the Helper's own downloaded one. Or None."""
    s = system_node()
    if s:
        return s[0], "computer"
    h = helper_node()
    v = version_of(h) if h else None
    if h and v and v[:2] >= NODE_MIN:
        return str(h), "helper"
    return None


def for_bridge():
    """The path to put in the bridge's config (matter.node) when the bridge cannot find a Node by itself, else None."""
    u = usable()
    return u[0] if u and u[1] == "helper" else None


def _get(url, limit, opener, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "couch-tv-setup"})
    with opener(req, timeout=timeout) as r:
        chunks, total = [], 0
        while True:
            c = r.read(1024 * 1024)
            if not c:
                break
            total += len(c)
            if total > limit:
                raise TvError("The Node.js download was bigger than expected, so it was not used.", "node_big")
            chunks.append(c)
    return b"".join(chunks)


def _sums(text):
    out = {}
    for line in text.splitlines():
        m = re.fullmatch(r"([0-9a-f]{64})  (\S+)", line.strip())
        if m:
            out[m.group(2)] = m.group(1)
    return out


def _take(data, name, key):
    """The node program out of the archive, by its one fixed member name. Nothing else is read or written."""
    base = name[:-len(".tar.gz")] if name.endswith(".tar.gz") else name[:-len(".zip")]
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return z.read(base + "/node.exe")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        m = t.getmember(base + "/bin/node")
        if not m.isfile() or m.size > 400 * 1024 * 1024:
            raise TvError("The Node.js download did not hold what was expected, so it was not used.", "node_bad")
        f = t.extractfile(m)
        return f.read(m.size)


def ensure(progress=lambda f, msg=None: None, dist=None, opener=None, key=None):
    """A Node the bridge can use: the computer's own, the Helper's already downloaded one, or one downloaded now (checked as the module
    words say). Returns {"path", "how": computer|helper|downloaded, "version"}. Raises TvError in plain words."""
    u = usable()
    if u:
        return {"path": u[0], "how": u[1], "version": ".".join(map(str, version_of(u[0])))}
    key = key or platform_key()
    if key is None:
        raise TvError("Matter needs Node.js 22.13 or newer, and this computer type cannot fetch it by itself. Get it from nodejs.org, then try again.",
                      "node_platform")
    name, want = PINNED[key]
    base = (dist or DIST).rstrip("/") + "/v" + NODE_VERSION + "/"
    if dist is None and not base.startswith("https://nodejs.org/"):
        raise TvError("That is not nodejs.org.", "node_host")
    opener = opener or urllib.request.urlopen
    progress(0.05, "Getting Node.js for Matter (about %d MB, once)" % SIZES_MB.get(key, 50))
    try:
        sums = _sums(_get(base + "SHASUMS256.txt", 256 * 1024, opener).decode("utf-8", "replace"))
        data = _get(base + name, MAX_BYTES, opener, timeout=300)
    except TvError:
        raise
    except Exception as e:
        raise TvError("Could not get Node.js from nodejs.org. Check this computer is online, then try again.", "node_download") from e
    progress(0.7, "Checking the download")
    got = hashlib.sha256(data).hexdigest()
    if got != want or sums.get(name) != want:
        raise TvError("The Node.js download did not match its checksum, so it was thrown away and nothing was installed.", "node_checksum")
    try:
        exe = _take(data, name, key)
    except TvError:
        raise
    except Exception as e:
        raise TvError("The Node.js download did not hold what was expected, so it was not used.", "node_bad") from e
    d = node_dir()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    dest = d / ("node.exe" if key.startswith("win") else "node")
    tmp = d / ("node-new.exe" if key.startswith("win") else "node.part")
    tmp.write_bytes(exe)
    tmp.chmod(stat.S_IRWXU)
    v = version_of(tmp) if not key.startswith("win") or sys.platform == "win32" else None
    if v is None or ".".join(map(str, v)) != NODE_VERSION:
        tmp.unlink(missing_ok=True)
        raise TvError("The downloaded Node.js would not start on this computer, so it was not kept.", "node_run")
    os.replace(tmp, dest)
    progress(1.0, "Node.js is ready")
    return {"path": str(dest), "how": "downloaded", "version": NODE_VERSION}
