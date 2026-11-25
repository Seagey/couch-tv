"""Start with the computer: a LaunchAgent on Mac, the HKCU Run key on Windows, an XDG autostart file on Linux.
All three are for this user only (no admin, no sudo). Turning the helper off removes it.

`home` and `registry` exist so the tests write to a temp folder and a fake registry, never the real ones.
"""
import os
import plistlib
import sys
from pathlib import Path

LABEL = "app.couchtv.helper"
RUN_VALUE = "CouchTVHelper"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
DESKTOP = "couch-tv-helper.desktop"


def command(exe=None, frozen=None):
    """The program and arguments that start the helper. From the built app: itself with --helper."""
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    if frozen:
        return [exe or sys.executable, "--helper"]
    return [exe or sys.executable, "-m", "couchtv_setup", "--helper"]


def _plat(platform):
    p = platform or sys.platform
    return "mac" if p == "darwin" else "windows" if p == "win32" else "linux"


def file_path(platform=None, home=None):
    home = Path(home) if home else Path.home()
    plat = _plat(platform)
    if plat == "mac":
        return home / "Library" / "LaunchAgents" / (LABEL + ".plist")
    if plat == "linux":
        base = Path(os.environ["XDG_CONFIG_HOME"]) if os.environ.get("XDG_CONFIG_HOME") and home == Path.home() else home / ".config"
        return base / "autostart" / DESKTOP
    return None


def mac_plist(cmd):
    """RunAtLoad only: KeepAlive stays off, the app restarts its own bridge."""
    return plistlib.dumps({"Label": LABEL, "ProgramArguments": list(cmd), "RunAtLoad": True, "KeepAlive": False,
                           "ProcessType": "Background"})


def _quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("`", "\\`") + '"'


def linux_desktop(cmd):
    return ("[Desktop Entry]\nType=Application\nName=Couch TV Helper\n"
            "Comment=Extra features for your TV while this computer is on\n"
            "Exec=" + " ".join(_quote(c) for c in cmd) + "\nTerminal=false\nX-GNOME-Autostart-enabled=true\n")


def windows_command(cmd):
    return " ".join('"' + c + '"' for c in cmd)


def _winreg(registry):
    if registry is not None:
        return registry
    import winreg   # noqa: only on Windows
    return winreg


def enable(cmd=None, platform=None, home=None, registry=None):
    """Writes the login item. Returns where it went (a path, or the registry value's name)."""
    cmd = cmd or command()
    plat = _plat(platform)
    if plat == "windows":
        w = _winreg(registry)
        with w.CreateKey(w.HKEY_CURRENT_USER, RUN_KEY) as k:
            w.SetValueEx(k, RUN_VALUE, 0, w.REG_SZ, windows_command(cmd))
        return "HKCU\\" + RUN_KEY + "\\" + RUN_VALUE
    p = file_path(platform, home)
    p.parent.mkdir(parents=True, exist_ok=True)
    if plat == "mac":
        p.write_bytes(mac_plist(cmd))
    else:
        p.write_bytes(linux_desktop(cmd).encode("utf-8"))
    return str(p)


def disable(platform=None, home=None, registry=None):
    """Removes it. True when something was removed."""
    if _plat(platform) == "windows":
        w = _winreg(registry)
        try:
            with w.OpenKey(w.HKEY_CURRENT_USER, RUN_KEY, 0, w.KEY_SET_VALUE) as k:
                w.DeleteValue(k, RUN_VALUE)
            return True
        except OSError:
            return False
    p = file_path(platform, home)
    try:
        p.unlink()
        return True
    except OSError:
        return False


def is_enabled(platform=None, home=None, registry=None):
    if _plat(platform) == "windows":
        w = _winreg(registry)
        try:
            with w.OpenKey(w.HKEY_CURRENT_USER, RUN_KEY, 0, w.KEY_READ) as k:
                return bool(w.QueryValueEx(k, RUN_VALUE)[0])
        except OSError:
            return False
    return file_path(platform, home).is_file()


def refresh(cmd=None, platform=None, home=None, registry=None, frozen=None):
    """After an update that renamed the program (couch-tv Setup became Couch TV Setup in 0.13.15) the login item
    still points at the old path. If one is switched on and does not say what the running program says, write it
    again. Only from the built app (a source run has no program of its own). True when it was rewritten."""
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    if not frozen or not is_enabled(platform, home, registry):
        return False
    cmd = cmd or command(frozen=True)
    plat = _plat(platform)
    if plat == "windows":
        w = _winreg(registry)
        with w.OpenKey(w.HKEY_CURRENT_USER, RUN_KEY, 0, w.KEY_READ) as k:
            same = w.QueryValueEx(k, RUN_VALUE)[0] == windows_command(cmd)
    else:
        p = file_path(platform, home)
        want = mac_plist(cmd) if plat == "mac" else linux_desktop(cmd).encode("utf-8")
        try:
            same = p.read_bytes() == want
        except OSError:
            same = False
    if same:
        return False
    enable(cmd, platform, home, registry)
    return True
