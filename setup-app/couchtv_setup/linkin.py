"""Opening Setup from the website's "Set up my TV" button (couchtv://setup?handoff=...).

- Windows: Setup adds couchtv:// and couchtv-setup:// for this user only (HKEY_CURRENT_USER, no admin)
  the first time it runs from the built app, pointing at its own .exe. Windows then starts a new copy
  with the link as an argument.
- Mac: the app's Info.plist names both schemes (CFBundleURLTypes, added by the build) and PyInstaller's
  argv emulation turns the open-link event into an argument at start. A link opened while Setup is
  already running goes to the running app as an event Python does not see: the website also shows the
  code to type, and the page has a box for it. Unsigned builds work the same; once the app is signed
  and notarised, macOS stops asking "Open Anyway" before the first link (DREAM-SETUP-BUILD.md).
- When Setup is already running, a second copy opened by a link hands the code to the first one over
  127.0.0.1 (with the first one's page key from running.json in Setup's own folder), opens its page,
  and stops. So there is only ever one Setup page.
"""
import json
import os
import sys
import urllib.request

from . import paths

RUNNING = "running.json"


def write_running(port, secret):
    p = paths.data() / RUNNING
    try:
        p.write_text(json.dumps({"port": port, "key": secret, "pid": os.getpid()}), encoding="utf-8")
        os.chmod(p, 0o600)
    except OSError:
        pass


def clear_running():
    try:
        p = paths.data() / RUNNING
        if json.loads(p.read_text(encoding="utf-8")).get("pid") == os.getpid():
            p.unlink()
    except (OSError, ValueError):
        pass


def hand_to_running(code, opener=None):
    """Gives the code to a Setup that is already running. Returns its page address, or None when no
    Setup answers (then this copy starts as usual)."""
    try:
        info = json.loads((paths.data() / RUNNING).read_text(encoding="utf-8"))
        port, key = int(info["port"]), str(info["key"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/handoff-in", data=json.dumps({"code": code}).encode(),
                                 method="POST", headers={"Content-Type": "application/json", "X-Setup-Key": key})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=3) as r:
            if r.status == 200:
                return f"http://127.0.0.1:{port}/"
    except Exception:
        return None
    return None


def register_windows(exe=None):
    """Adds the two link schemes for this user, pointing at this .exe. Only from the built app on
    Windows; a copy run from source never registers anything."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return False
    import winreg   # noqa: only on Windows
    exe = exe or sys.executable
    for scheme in ("couchtv", "couchtv-setup"):
        base = rf"Software\Classes\{scheme}"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Couch TV Setup")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{exe}" "%1"')
    return True
