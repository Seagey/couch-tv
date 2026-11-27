"""Widget permissions (lane F, 28 Nov 2026): the one Android "Allow" question three widgets need, given from the computer over
the connection Setup already has, so nobody answers it on the TV with the remote.

  doorbell    "Display over other apps" (app op SYSTEM_ALERT_WINDOW): the doorbell card shows over Netflix and the rest
  screentime  "Usage access" (app op GET_USAGE_STATS): the Screen time widget reads how long each app was on
  battery     "Nearby devices" (permission BLUETOOTH_CONNECT, Android 12 and newer): the Batteries widget reads the remotes' charge

Rules:
- Every switch starts off. Nothing is given unless the person turns it on, for Couch TV's own home app only (steps.HOME_PKG).
- Turning one off puts Android's own default back (app op "default", permission revoked). Undo (steps.undo) and this step's
  "Turn all off" do the same.
- Every change is read back; a TV that refused says so.
- What is on is noted on the TV (RECORD_FILE), so Setup's own home install, which sets "display over other apps" back to
  default, keeps the doorbell card when the person asked for it (keep_after_install).
- Every command is fixed in this file: no text from the page or the TV reaches the TV's shell.
"""
import re

from . import steps
from .tv import TvError

PKG = steps.HOME_PKG
RECORD_FILE = steps.RECORD_DIR + "/perms"
SWITCHES = ("doorbell", "screentime", "battery")
APPOPS = {"doorbell": "SYSTEM_ALERT_WINDOW", "screentime": "GET_USAGE_STATS"}
GRANTS = {"battery": "android.permission.BLUETOOTH_CONNECT"}
BT_SDK = 31                       # Android 12: "Nearby devices" is asked from here on; older TVs ask nothing
WORDS = {
    "doorbell": ("Doorbell card over other apps", "The doorbell card can show while Netflix or any app is on."),
    "screentime": ("Screen time", "The Screen time widget can see how long each app was on this TV."),
    "battery": ("Remote batteries", "The Batteries widget can read the charge of paired remotes."),
}


def _sdk(tv):
    try:
        return int((tv.shell("getprop ro.build.version.sdk") or "0").strip() or 0)
    except ValueError:
        return 0


def _installed(tv):
    return PKG in {l.split(":", 1)[1].strip() for l in (tv.shell(f"pm list packages {PKG}") or "").splitlines() if l.startswith("package:")}


def _is_on(tv, name):
    if name in APPOPS:
        out = tv.shell(f"appops get {PKG} {APPOPS[name]}") or ""
        return bool(re.search(r"\b" + APPOPS[name] + r"\b[^\n]*:\s*allow\b", out))
    out = tv.shell(f"dumpsys package {PKG} | grep {GRANTS[name]}") or ""
    return "granted=true" in out


def _needed(name, sdk):
    return not (name == "battery" and sdk and sdk < BT_SDK)


def _record(tv):
    out = tv.shell(f"cat {RECORD_FILE} 2>/dev/null") or ""
    return [w for w in out.split() if w in SWITCHES]


def _write_record(tv, on):
    on = [w for w in SWITCHES if w in on]
    if on:
        tv.shell(f"mkdir -p {steps.RECORD_DIR}; printf '%s\\n' {' '.join(on)} > {RECORD_FILE}")
    else:
        tv.shell(f"rm -f {RECORD_FILE}")


def state(tv):
    """What each switch is now, read from the TV. needed False: this TV asks nothing for it (battery before Android 12)."""
    if not _installed(tv):
        return {"installed": False, "switches": []}
    sdk = _sdk(tv)
    out = []
    for name in SWITCHES:
        need = _needed(name, sdk)
        out.append({"id": name, "label": WORDS[name][0], "what": WORDS[name][1], "needed": need, "on": need and _is_on(tv, name)})
    return {"installed": True, "switches": out}


def _set(tv, name, on):
    if name in APPOPS:
        tv.shell(f"appops set {PKG} {APPOPS[name]} {'allow' if on else 'default'}")
    else:
        tv.shell(f"pm {'grant' if on else 'revoke'} {PKG} {GRANTS[name]}")


def apply(tv, wants, progress=None):
    """wants: {switch: True or False}. Each is set and read back. Answers {"results": {switch: {status, words}}, "state": ...}."""
    if not _installed(tv):
        raise TvError("Couch TV is not on this TV yet. Set it up first, then come back to this step.", "not_installed")
    sdk = _sdk(tv)
    results = {}
    names = [n for n in SWITCHES if isinstance(wants.get(n), bool)]
    for i, name in enumerate(names):
        if progress:
            progress(i / max(1, len(names)), WORDS[name][0])
        want = wants[name]
        if not _needed(name, sdk):
            results[name] = {"status": "not_needed", "words": "This TV asks nothing for it."}
            continue
        if _is_on(tv, name) == want:
            results[name] = {"status": "done", "words": "On." if want else "Off."}
            continue
        _set(tv, name, want)
        if _is_on(tv, name) == want:
            results[name] = {"status": "done", "words": "On." if want else "Off."}
        else:
            if want:
                _set(tv, name, False)       # a half given permission is taken back
            results[name] = {"status": "refused", "words": "The TV said no. Nothing changed."}
    on = [n for n in SWITCHES if _needed(n, sdk) and _is_on(tv, n)]
    _write_record(tv, on)
    if progress:
        progress(1.0, "Done")
    return {"results": results, "state": state(tv)}


def all_off(tv):
    """Undo: every switch back to Android's default, and the record gone. Safe when Couch TV is not there."""
    for name in APPOPS:
        tv.shell(f"appops set {PKG} {APPOPS[name]} default")
    tv.shell(f"pm revoke {PKG} {GRANTS['battery']}")
    tv.shell(f"rm -f {RECORD_FILE}")


def keep_after_install(tv):
    """After Setup's home install set "display over other apps" back to default: give back what the person turned on here."""
    on = _record(tv)
    for name in on:
        if name in APPOPS:
            tv.shell(f"appops set {PKG} {APPOPS[name]} allow")
    return on


def route(name, body, tv, run_job):
    """The page's routes: /api/perms/<name>."""
    body = body if isinstance(body, dict) else {}
    if name == "state":
        return state(tv)
    if name == "apply":
        wants = {w: body[w] for w in SWITCHES if isinstance(body.get(w), bool)}
        return run_job("perms", lambda p: apply(tv, wants, p))
    if name == "off":
        return run_job("perms", lambda p: (all_off(tv), state(tv))[1])
    raise TvError("No such step.", "404")
