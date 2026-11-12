"""Getting the TV apps from couch-tv's own GitHub Releases page, and checking them.

Only https://api.github.com/repos/Seagey/couch-tv/releases/latest and the download links it gives
are ever fetched. Each file is checked twice before it goes near the TV:
- its size and SHA-256 against the "digest" GitHub itself records for every release file, and
- if the release has a SHA256SUMS.txt (scripts/release-checksums.sh makes one), against that too.
A file that fails either check is deleted and never installed. Android checks the signature on the
TV as well: a couch-tv app can only be updated by one signed with the same key.

COUCHTV_SETUP_APK_DIR=<folder> uses couch-tv-home.apk and couch-tv-ontv.apk from that folder
instead (your own builds, or for tests). Nothing is checked against GitHub then.
"""
import hashlib
import json
import os
import ssl
import urllib.error
import urllib.request

from . import paths
from .tv import TvError

REPO = "Seagey/couch-tv"
LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
HOME_APK = "couch-tv-home.apk"
ONTV_APK = "couch-tv-ontv.apk"
SUMS = "SHA256SUMS.txt"
ALLOWED_HOSTS = ("api.github.com", "github.com", "objects.githubusercontent.com",
                 "release-assets.githubusercontent.com")


def _context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _open(url, timeout=30):
    host = urllib.request.urlparse(url).hostname or ""
    if not url.startswith("https://") or not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise TvError("The download link did not point at GitHub, so it was not used.", "bad_url")
    req = urllib.request.Request(url, headers={"User-Agent": "couch-tv-setup",
                                               "Accept": "application/vnd.github+json, application/octet-stream"})
    return urllib.request.urlopen(req, timeout=timeout, context=_context())


def latest():
    try:
        with _open(LATEST) as r:
            return json.load(r)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise TvError("Could not reach GitHub to get couch-tv. Is this computer online?", "offline") from e


def _sums(release):
    asset = next((a for a in release.get("assets", []) if a.get("name") == SUMS), None)
    if not asset:
        return {}
    with _open(asset["browser_download_url"]) as r:
        text = r.read(65536).decode(errors="replace")
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and len(parts[0]) == 64:
            out[parts[1].lstrip("*")] = parts[0].lower()
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get(name, progress=lambda f, msg=None: None, release=None):
    """Downloads one release file (cached by version) and checks it. Returns {"path", "version", "sha256"}."""
    own = os.environ.get("COUCHTV_SETUP_APK_DIR")
    if own:
        path = os.path.join(own, name)
        if not os.path.isfile(path):
            raise TvError(f"COUCHTV_SETUP_APK_DIR has no {name}.", "no_asset")
        return {"path": path, "version": "your own build", "sha256": sha256(path), "checked": "not checked (your own build)"}
    rel = release or latest()
    asset = next((a for a in rel.get("assets", []) if a.get("name") == name), None)
    if not asset:
        raise TvError(f"The newest couch-tv release has no {name}.", "no_asset")
    digest = (asset.get("digest") or "").lower()
    want = digest.split(":", 1)[1] if digest.startswith("sha256:") else None
    sums = _sums(rel).get(name)
    if want and sums and want != sums:
        raise TvError("The release's two checksums disagree, so nothing was installed. Please tell us on GitHub.", "checksum")
    want = want or sums
    if not want:
        raise TvError("The release does not say what the file should look like (no checksum), so it was not installed.",
                      "no_checksum")
    tag = rel.get("tag_name", "latest")
    safe_tag = "".join(c for c in tag if c.isalnum() or c in ".-_") or "latest"
    dest = paths.cache() / f"{safe_tag}-{name}"
    if dest.is_file() and dest.stat().st_size == asset.get("size") and sha256(dest) == want:
        return {"path": str(dest), "version": tag, "sha256": want, "checked": "GitHub checksum"}
    part = dest.with_name(dest.name + ".part")
    try:
        with _open(asset["browser_download_url"], timeout=60) as r, open(part, "wb") as f:
            total, got = int(asset.get("size") or 0), 0
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if total:
                    progress(min(1.0, got / total), f"Downloading {name} ({tag})")
    except (urllib.error.URLError, OSError) as e:
        part.unlink(missing_ok=True)
        raise TvError("The download stopped part way. Check the internet and try again.", "offline") from e
    if asset.get("size") and part.stat().st_size != asset["size"]:
        part.unlink()
        raise TvError("The download was cut short. Try again.", "short")
    if sha256(part) != want:
        part.unlink()
        raise TvError("The downloaded file did not match the release's checksum, so it was deleted and nothing "
                      "was installed. Try again; if it happens twice, tell us on GitHub.", "checksum")
    part.replace(dest)
    return {"path": str(dest), "version": tag, "sha256": want, "checked": "GitHub checksum" + (" and SHA256SUMS.txt" if sums else "")}
