"""The setup steps, on a connected TV. Each one looks first and only changes what is not already
done, so running it again is safe.

make_home() is couch-tv's tv-home/tools/apply.sh for option A (no bridge), step for step: install,
make couch-tv the chosen home, switch ambient mode off (only if the person agreed), keep the TV's
own home and setup app ON (and switch them back on if an older couch-tv switched them off), hand
the home its settings, and switch on the Home button watch. undo() is tv-home/tools/undo.sh plus
remove-all.sh. If apply.sh changes, change these to match: tests/test_steps.py checks the commands.

What this setup changed is written down twice, so Undo works from any computer:
on the TV in /data/local/tmp/couchtv-setup/ (survives restarts, belongs to ADB's shell user), and
on this computer in the setup's own folder.
"""
import base64
import json
import re
import time
import urllib.request

from . import paths
from .tv import TvError

HOME_PKG = "app.couchtv.launcher"
HOME_ACT = f"{HOME_PKG}/.MainActivity"
WATCH = f"{HOME_PKG}/.FireWatch"
ONTV_PKG = "dev.couchtv.ontv"
ONTV_ALIAS = f"{ONTV_PKG}/{ONTV_PKG}.HomeAlias"
ONTV_WATCH = f"{ONTV_PKG}/{ONTV_PKG}.WatchService"
WIZARD = "com.google.android.tungsten.setupwraith"
NEVER_OFF = ["com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", WIZARD]
AMBIENT = "com.google.android.apps.tv.dreamx"
STOCK_HOMES = ["com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.amazon.tv.launcher"]
RESOLVE = "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME"
QUERY_HOMES = "pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME"
RECORD_DIR = "/data/local/tmp/couchtv-setup"
PKG_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")
ACT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*/[A-Za-z0-9_.$]+$")

HOMES = {
    "com.google.android.apps.tv.launcherx": "Google TV home",
    "com.google.android.tvlauncher": "Android TV home",
    "com.amazon.tv.launcher": "Fire TV home",
    "com.amazon.firehomestarter": "Fire TV home",
}

FRIENDLY_HOMES = {
    "com.amazon.tv.launcher": "Amazon's home",
    "com.amazon.firehomestarter": "Amazon's home",
    "com.google.android.apps.tv.launcherx": "Google TV's home",
    "com.google.android.tvlauncher": "Android TV's home",
    ONTV_PKG: "couch-tv's other app (the on-TV app)",
    HOME_PKG: "couch-tv's home app",
}


def friendly_home(component):
    """A home screen component in words a person knows. The raw name goes in a details line only."""
    pkg = (component or "").split("/", 1)[0]
    return FRIENDLY_HOMES.get(pkg, "the TV's own home")


# Fire TV model names, from couch-tv-setup by killy10o10 (MIT, Copyright (c) 2026 killy10o10).
FIRE_MODELS = {
    "AFTKM": "Fire TV Stick 4K (2nd gen)",
    "AFTKA": "Fire TV Stick 4K Max",
    "AFTKRT": "Fire TV Stick 4K Max (2nd gen)",
    "AFTMM": "Fire TV Stick 4K",
    "AFTSSS": "Fire TV Stick (3rd gen)",
    "AFTSS": "Fire TV Stick Lite",
    "AFTT": "Fire TV Stick (2nd gen)",
    "AFTR": "Fire TV Cube (2nd gen)",
    "AFTGAZL": "Fire TV Cube (3rd gen)",
}


def _lines(out):
    return [l.strip() for l in out.replace("\r", "").splitlines() if l.strip()]


def _packages(tv, flag=""):
    return {l.replace("package:", "", 1) for l in _lines(tv.shell(f"pm list packages {flag}".strip()))}


# ---- 1. what is this TV ----

def facts(tv):
    model = tv.prop("ro.product.model")
    maker = tv.prop("ro.product.manufacturer")
    brand = tv.prop("ro.product.brand")
    fire_os = fire_os_version(tv)
    sdk = int(tv.prop("ro.build.version.sdk") or 0)
    release = tv.prop("ro.build.version.release")
    present = _packages(tv)
    fire = maker.lower() == "amazon" or bool(fire_os)
    home_now = (_lines(tv.shell(RESOLVE)) or [""])[-1]
    google_tv = "com.google.android.apps.tv.launcherx" in present
    name = FIRE_MODELS.get(model) if fire else None
    label = brand or maker
    name = name or (f"Fire TV ({model})" if fire else (model if label.lower() in model.lower() else f"{label} {model}".strip()))
    return {
        "model": model, "maker": maker, "brand": brand, "name": name,
        "android": release, "sdk": sdk, "fire": fire, "fire_os": fire_os,
        "google_tv": google_tv,
        "kind": "fire" if fire else ("google" if google_tv else "android"),
        "tv": "android.software.leanback" in tv.shell("pm list features"),
        "home_now": home_now,
        "homes": [HOMES[p] for p in HOMES if p in present],
        "tcl": "tcl" in (maker + " " + brand).lower(),
        "installed": {"home": app_version(tv, HOME_PKG), "ontv": app_version(tv, ONTV_PKG)},
        "ontv_home": ontv_home(tv, present),
        "home_name": friendly_home(home_now),
        "supported": sdk >= 25,
    }


def ontv_home(tv, present=None):
    """Is the on-TV app (dev.couchtv.ontv) already this TV's home? Its HomeAlias is switched on (it shows
    in the list of HOME screens) or its WatchService is in the enabled accessibility services. Two
    couch-tv homes fight, and the one that was there first wins (reported by killy10o10)."""
    present = _packages(tv) if present is None else present
    if ONTV_PKG not in present:
        return {"installed": False, "alias": False, "watch": False, "takes_home": False}
    alias = any(l.startswith(ONTV_PKG + "/") for l in _lines(tv.shell(QUERY_HOMES)))
    cur = tv.shell("settings get secure enabled_accessibility_services").strip()
    watch = any(s.startswith(ONTV_PKG + "/") for s in cur.split(":"))
    return {"installed": True, "alias": alias, "watch": watch, "takes_home": alias or watch}


def ontv_api_home_off(ip, token):
    """Asks the on-TV app itself to stop being the home (POST /api/home {"on": false} on port 5400).
    Needs a phone token: without one the app answers 401, so this only tries when it has one."""
    if not token or not ip:
        return False
    req = urllib.request.Request(f"http://{ip}:5400/api/home", data=b'{"on": false}', method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def ontv_home_off(tv):
    """Takes the on-TV app's Home and Home button watch out. It stays installed. Its grant to change
    secure settings is taken back too, so it cannot put its own watch on again by itself.
    Fire OS will not let a computer switch a component off ("Shell cannot change component state", seen
    by killy10o10 on Fire OS 8.1.8.5): that refusal is not a failure. The on-TV app is asked to switch its
    own home off when we hold a token for it, and otherwise it is left, harmless without its watch."""
    out = tv.shell(f"pm disable {ONTV_ALIAS}") or ""
    refused = bool(re.search(r"Shell cannot change component state|SecurityException", out))
    via_api = ontv_api_home_off(getattr(tv, "ip", None), getattr(tv, "ontv_token", None)) if refused else False
    cur = tv.shell("settings get secure enabled_accessibility_services").strip()
    parts = [s for s in cur.split(":") if s and s != "null"]
    keep = [s for s in parts if not s.startswith(ONTV_PKG + "/")]
    if keep != parts:
        if keep:
            tv.shell(f"settings put secure enabled_accessibility_services {':'.join(keep)}")
        else:
            tv.shell("settings delete secure enabled_accessibility_services")
    tv.shell(f"pm revoke {ONTV_PKG} android.permission.WRITE_SECURE_SETTINGS")
    return {"alias_refused": refused, "alias_off_via_api": via_api, "alias_left": refused and not via_api}


def fire_os_version(tv):
    """The Fire OS version as the TV shows it. ro.build.version.name has the full one ("Fire OS 8.1.8.5
    (RS8185/3898)"); ro.build.version.fireos only says "8.0" on that same stick (reported by killy10o10)."""
    m = re.search(r"Fire OS\s+([0-9][0-9.]*)", tv.prop("ro.build.version.name"))
    return m.group(1) if m else tv.prop("ro.build.version.fireos")


def is_fire(tv):
    return tv.prop("ro.product.manufacturer").lower() == "amazon" or bool(fire_os_version(tv))


def app_version(tv, pkg):
    out = tv.shell(f"dumpsys package {pkg} | grep -m1 versionName")
    m = re.search(r"versionName=(\S+)", out)
    return m.group(1) if m else None


def plan(tv, f, ambient_off=True, ontv_home_off=True):
    """What make_home would change, in plain words, for the read back before the yes."""
    present = _packages(tv)
    disabled = _packages(tv, "-d")
    items = []
    ontv = f.get("ontv_home") or {}
    if ontv.get("takes_home"):
        if ontv_home_off and f.get("fire"):
            items.append("couch-tv's other app (the on-TV app) is already this TV's home screen, with its own Home button "
                         "watch. This switches the on-TV app's Home button watch off and takes back its permission, then makes "
                         "couch-tv's home app the home. Fire OS won't let a computer switch its home entry off, which is fine "
                         "because without its watch it stays in the background. The on-TV app stays installed.")
        elif ontv_home_off:
            items.append("couch-tv's other app (the on-TV app) is already this TV's home screen, with its own Home button "
                         "watch. Two couch-tv homes would fight and the on-TV app would keep winning. This switches its "
                         "home and watch off first (the on-TV app stays installed), then makes couch-tv's home app the home.")
        else:
            items.append("couch-tv's other app (the on-TV app) is already this TV's home screen, and you are keeping it "
                         "that way. Nothing will be installed, because a second home would fight it.")
    if f["installed"]["home"]:
        items.append(f"couch-tv {f['installed']['home']} is already on this TV. If a computer at home runs it for you (the "
                     "bridge, option B), stop here: this app sets couch-tv up to run on the TV by itself, and the computer's "
                     "phone remote and settings would no longer reach it. Otherwise this updates it.")
    items.append(f"Put the couch-tv home on the TV ({'update it' if f['installed']['home'] else 'install it'}) and make it the home screen.")
    back_on = [p for p in NEVER_OFF if p in disabled]
    if back_on:
        items.append("Switch the TV's own home and setup app back on (an older couch-tv switched them off; that is the fix "
                     "for TVs that loop after a restart).")
    if ambient_off and AMBIENT in present and AMBIENT not in disabled:
        items.append("Switch off ambient mode (the adverts and photos the TV shows when idle). It is switched off, not deleted.")
    if any(p in present for p in STOCK_HOMES):
        items.append("Switch on couch-tv's Home button watch. It only notices when the TV's own home comes forward and puts "
                     "couch-tv back on top, so the TV's own home may flash up for a moment. It never reads the screen.")
    items.append("Leave the TV's own home screen and setup app switched on, so the TV always has them when it starts. "
                 "Nothing is deleted.")
    if f.get("tcl"):
        items.append("TCL only: let couch-tv start by itself after a restart (TCL's AUTO_START setting).")
    warn = watch_warning(other_watches(tv))
    if warn:
        items.append(warn)
    if ontv.get("takes_home") and not ontv_home_off:
        return items[:1] + ([warn] if warn else [])
    return items


KNOWN_WATCHES = {"com.spocky.projengmenu": "Projectivy Launcher", "com.wolf.firelauncher": "Wolf Launcher"}


def other_watches(tv):
    """Other launchers with their own accessibility service switched on. Their Home override would fight
    couch-tv's Home button watch. A launcher is anything with a HOME screen; plus a few known by name."""
    cur = tv.shell("settings get secure enabled_accessibility_services").strip()
    pkgs = {s.split("/", 1)[0] for s in cur.split(":") if "/" in s}
    homes = {l.split("/", 1)[0] for l in _lines(tv.shell(QUERY_HOMES)) if "/" in l}
    ours = {HOME_PKG, ONTV_PKG} | set(STOCK_HOMES) | set(NEVER_OFF)
    found = sorted(p for p in pkgs if p not in ours and (p in KNOWN_WATCHES or p in homes))
    return [KNOWN_WATCHES.get(p, p) for p in found]


def watch_warning(names):
    if not names:
        return None
    return (f"{' and '.join(names)} also takes over the Home button on this TV. The two will fight: switch its Home "
            "override off in its own settings (it can stay installed).")


# ---- records, on the TV and here ----

def serial(tv):
    s = tv.prop("ro.serialno") or tv.ip
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)


def _local():
    p = paths.data() / "changed.json"
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _save_local(key, rec):
    all_ = _local()
    if rec:
        all_[key] = rec
    else:
        all_.pop(key, None)
    (paths.data() / "changed.json").write_text(json.dumps(all_, indent=1))


def _read_tv_record(tv):
    home = (_lines(tv.shell(f"cat {RECORD_DIR}/home 2>/dev/null")) or [""])[0]
    disabled = _lines(tv.shell(f"cat {RECORD_DIR}/disabled 2>/dev/null"))
    return {"home": home if ACT_RE.match(home) else "", "disabled": [p for p in disabled if PKG_RE.match(p)]}


def record(tv):
    """What this setup (or an earlier run on any computer) changed on this TV."""
    on_tv = _read_tv_record(tv)
    here = _local().get(serial(tv), {})
    return {
        "home": on_tv["home"] or here.get("home", ""),
        "disabled": sorted(set(on_tv["disabled"]) | {p for p in here.get("disabled", []) if PKG_RE.match(p)}),
    }


def _write_record(tv, rec):
    home = rec.get("home", "")
    disabled = [p for p in rec.get("disabled", []) if PKG_RE.match(p)]
    cmds = [f"mkdir -p {RECORD_DIR}"]
    cmds.append(f"echo '{home}' > {RECORD_DIR}/home" if ACT_RE.match(home or "") else f"rm -f {RECORD_DIR}/home")
    cmds.append(f"printf '%s\\n' {' '.join(disabled)} > {RECORD_DIR}/disabled" if disabled else f"rm -f {RECORD_DIR}/disabled")
    tv.shell("; ".join(cmds))
    _save_local(serial(tv), {"home": home, "disabled": disabled})


# ---- 2. the home (apply.sh, option A) ----

def needed(tv, pkg, homes):
    """apply.sh's needed(): never switched off, whatever anyone asks."""
    if pkg in NEVER_OFF:
        return True
    if re.match(r"^(android|app\.couchtv\..*|com\.android\..*|com\.google\.android\.gms|com\.google\.android\.gsf|.*webview.*|"
                r"com\.google\.android\.trichromelibrary|com\.google\.android\.tv\.remote\.service|com\.google\.android\.katniss|"
                r"com\.google\.android\.permissioncontroller|com\.google\.android\.packageinstaller|com\.google\.android\.networkstack.*|"
                r"com\.google\.android\.ext\..*|com\.google\.android\.providers\..*|com\.sony\.dtv\.sonysystemservice|com\.sony\.dtv\.tvx|"
                r".*setupwizard.*|.*\.setup|.*provision.*)$", pkg):
        return True
    if pkg in homes:
        return True
    return bool(re.search(r"(pkgFlags|flags)=\[.*PERSISTENT", tv.shell(f"dumpsys package {pkg}")))


def home_config(people=None, weather=None):
    """The home's settings for its built-in copy, the shape tv-home/tools/home-config.py makes. Only
    what the person gave: names and a weather place. Settings changed later on the TV itself
    (Home settings) are kept by the TV and win over these."""
    names = [n.strip()[:30] for n in (people or []) if n and n.strip()][:8]
    cfg = {
        "people": [{"id": f"person{i + 1}", "name": n} for i, n in enumerate(names)] or [{"id": "person1", "name": "Me"}],
        "home": {"hide_packages": [], "look": "night", "scenes": ["night", "golden", "water", "fog", "dawn"],
                 "scene_seconds": 20, "dock_size": 10, "my_scenes": [], "sun_sync": False, "skip_watch_next": [],
                 "bedtime_dim": False, "watch_next_per_app": 5},
        "tvs": [{"id": "living-room", "name": "TV", "quick": ["look"], "picture_modes": []}],
        "default_tv": "living-room",
        "ask": {"enabled": False},
        "phone_remote": False,
    }
    if weather and all(k in weather for k in ("lat", "lon", "place", "timezone")):
        cfg["weather"] = {"lat": float(weather["lat"]), "lon": float(weather["lon"]),
                          "place": str(weather["place"])[:60], "timezone": str(weather["timezone"])[:60]}
    return base64.b64encode(json.dumps(cfg, separators=(",", ":")).encode()).decode()


def make_home(tv, apk_path, ambient_off=True, people=None, weather=None, progress=lambda f, msg=None: None,
              ontv_home_switch_off=True):
    done = []
    ontv = ontv_home(tv)
    alias_left = False
    if ontv["takes_home"]:
        if not ontv_home_switch_off:
            # The person keeps the on-TV app as the home: a second home would only fight it.
            return {"changed": [], "front": False, "kept_ontv": True, "home_key_opens": "couch-tv's other app (the on-TV app)",
                    "watch": False, "watch_bound": None, "fire": is_fire(tv), "disabled": record(tv)["disabled"],
                    "warning": watch_warning(other_watches(tv))}
        progress(0.01, "Switching off the on-TV app's home and Home button watch")
        off = ontv_home_off(tv)
        alias_left = off["alias_left"]
        done.append("on-TV app's watch off" if off["alias_left"] else "on-TV app's home and watch off")
    rec = record(tv)
    progress(0.02, "Noting the TV's own home, for Undo")
    if not rec["home"]:
        prev = (_lines(tv.shell(RESOLVE)) or [""])[-1]
        if ACT_RE.match(prev) and not prev.startswith((HOME_PKG + "/", ONTV_PKG + "/", WIZARD + "/")):
            rec["home"] = prev
    _write_record(tv, rec)

    progress(0.05, "Copying couch-tv to the TV")
    tv.install(apk_path, lambda f: progress(0.05 + 0.6 * f, "Copying couch-tv to the TV" if f < 1 else "Installing it"))
    done.append("installed")
    tv.shell(f"cmd package set-home-activity {HOME_ACT}")
    now = tv.shell("cmd shortcut get-default-launcher")
    fire = is_fire(tv)
    # Fire OS keeps Amazon's home as the chosen one whatever is set (priority 950, seen by killy10o10 on a
    # Fire TV Stick 4K 2nd gen): there the Home button watch is what brings couch-tv back, so carry on.
    if f"{HOME_PKG}/" not in now and not fire:
        raise TvError("The TV did not take couch-tv as its home screen, so nothing was switched off. "
                      "Undo takes the app off again.", "home_refused")
    tv.shell(f"pm grant {HOME_PKG} android.permission.READ_TV_LISTINGS")
    tv.shell(f"appops set {HOME_PKG} WRITE_SETTINGS allow")

    progress(0.7, "Keeping the TV's own home and setup on")
    present = _packages(tv)
    disabled = _packages(tv, "-d")
    for p in NEVER_OFF:
        if p in disabled:
            tv.shell(f"pm enable {p}")
            done.append("switched back on: " + p)
    homes = {l.split("/", 1)[0] for l in _lines(tv.shell(QUERY_HOMES)) if "/" in l}
    want = [AMBIENT] if ambient_off else []
    for p in want:
        if p not in present:
            continue
        if needed(tv, p, homes):
            if p in disabled and p not in rec["disabled"]:
                rec["disabled"].append(p)
            continue
        if p not in disabled:
            tv.shell(f"pm disable-user --user 0 {p}")
            done.append("switched off: " + p)
        if p not in rec["disabled"]:
            rec["disabled"].append(p)
    _write_record(tv, rec)

    progress(0.8, "Making couch-tv the home and sending your settings")
    tv.shell(f"cmd package set-home-activity {HOME_ACT}")
    resolved = (_lines(tv.shell(RESOLVE)) or [""])[-1]
    if tv.shell(f"appops get {HOME_PKG} SYSTEM_ALERT_WINDOW").find("allow") >= 0:
        tv.shell(f"appops set {HOME_PKG} SYSTEM_ALERT_WINDOW default")   # no doorbell card in this setup
    cfg = home_config(people, weather)
    tv.shell(f'am force-stop {HOME_PKG}; am start -n {HOME_ACT} --es bridge none --es config_b64 {cfg} --es ha_b64 none --es key ""')
    if facts_tcl(tv):
        tv.shell(f"appops set {HOME_PKG} AUTO_START allow")
        done.append("TCL: AUTO_START allowed")

    progress(0.88, "Switching on the Home button watch")
    watch = any(p in present for p in STOCK_HOMES)
    if watch:
        tv.shell(f"pm grant {HOME_PKG} android.permission.WRITE_SECURE_SETTINGS")
        cur = tv.shell("settings get secure enabled_accessibility_services").strip()
        parts = [s for s in cur.split(":") if s and s != "null"]
        ours = [s for s in parts if "FireWatch" in s and s.startswith(HOME_PKG + "/")]
        rest = [s for s in parts if s not in ours]
        if ours:
            # Listed already, but after the force-stop Android shows it as crashed and never binds it
            # again (couch-tv issue #37): take it out and put it back.
            if rest:
                tv.shell(f"settings put secure enabled_accessibility_services {':'.join(rest)}")
            else:
                tv.shell("settings delete secure enabled_accessibility_services")
            time.sleep(2)
        tv.shell(f"settings put secure enabled_accessibility_services {':'.join(rest + [WATCH])}")
        tv.shell("settings put secure accessibility_enabled 1")
        done.append("Home button watch on")

    bound = None
    if watch:
        progress(0.92, "Checking the Home button watch is running")
        bound = wait_watch_bound(tv)
    progress(0.95, "Pressing Home")
    result = check_home(tv)
    progress(1.0, "Done")
    return {"changed": done, "front": result["ok"], "home_key_opens": "couch-tv" if resolved.startswith(HOME_PKG + "/") else resolved,
            "watch": watch, "watch_bound": bound, "fire": fire, "disabled": rec["disabled"],
            "warning": watch_warning(other_watches(tv)), "other_front": result.get("other_front"),
            "ontv_alias_left": alias_left}


WATCH_LABEL = "Home button watch"   # FireWatch's android:label in tv-home's AndroidManifest.xml


def bound_services(tv):
    """The "Bound services" part of dumpsys accessibility, all of it: with more than one service bound
    (Projectivy's, say) it runs over several lines (reported by killy10o10)."""
    out = tv.shell("dumpsys accessibility")
    if "Bound services:" not in out:
        return ""
    part = out.split("Bound services:", 1)[1]
    for end in ("Enabled services:", "Binding services:", "Crashed services:"):
        part = part.split(end, 1)[0]
    return part


def watch_bound(tv):
    part = bound_services(tv)
    return WATCH_LABEL in part or f"{HOME_PKG}/" in part


def wait_watch_bound(tv, seconds=10):
    for _ in range(seconds):
        if watch_bound(tv):
            return True
        time.sleep(1)
    return False


def facts_tcl(tv):
    return "tcl" in (tv.prop("ro.product.manufacturer") + " " + tv.prop("ro.product.brand")).lower()


def front(tv):
    out = tv.shell("dumpsys window | grep -m1 mCurrentFocus")
    if not out.strip():
        out = tv.shell("dumpsys activity activities | grep -m1 mResumedActivity")
    return out.strip()


def check_home(tv, pkg=HOME_PKG):
    """Presses Home and looks at what came forward. Waits a moment first, so the screen from before
    the press is not counted."""
    tv.key("HOME")
    time.sleep(2)
    seen = ""
    ok = False
    for _ in range(6):
        seen = front(tv)
        if pkg in seen:
            ok = True
            break
        time.sleep(1)
    listed = WATCH in tv.shell("settings get secure enabled_accessibility_services")
    # In front but not couch-tv's home: say which, so the page does not blame "the TV's own home" for
    # couch-tv's other app (the on-TV app) holding the Home button.
    other = "ontv" if (not ok and ONTV_PKG in seen) else None
    return {"ok": ok, "front": seen, "watch_bound": watch_bound(tv) if listed else None,
            "warning": watch_warning(other_watches(tv)), "other_front": other}


# ---- 3. the phone remote (the on-TV app, optional) ----

def phone_remote(tv, apk_path, f, progress=lambda fr, msg=None: None):
    """Installs the "lives on the TV" app next to the home, for the phone remote. It does not take
    the Home button (the home above does). Its grants are the ones on-tv/README.md lists."""
    tv.install(apk_path, lambda fr: progress(0.8 * fr, "Copying the phone remote app" if fr < 1 else "Installing it"))
    progress(0.85, "Giving it its permissions")
    tv.shell(f"pm grant {ONTV_PKG} android.permission.WRITE_SECURE_SETTINGS")
    tv.shell(f"appops set {ONTV_PKG} SYSTEM_ALERT_WINDOW allow")
    if f.get("fire"):
        tv.shell(f"appops set {ONTV_PKG} GET_USAGE_STATS allow")
    tv.shell(f"am start -n {ONTV_PKG}/.SetupActivity")
    time.sleep(3)
    # Installing an app can make Android drop couch-tv as the chosen home (seen on a TCL): say it again.
    tv.shell(f"cmd package set-home-activity {HOME_ACT}")
    progress(1.0, "Done")
    return {"address": f"http://{tv.ip}:5400", "setup": f"http://{tv.ip}:5400/setup"}


# ---- 4. debugging off again (optional, at the end) ----

def debugging_off(tv, route):
    """Wireless debugging off (route tls), or every kind of debugging off (route tcp, as remove-all.sh
    DEV_OFF=1). The connection drops straight after, which is expected."""
    cmd = "settings put global adb_wifi_enabled 0" if route == "tls" else \
        "settings put global adb_wifi_enabled 0; settings put global adb_enabled 0"
    try:
        tv.dev.shell(cmd, timeout_s=10, read_timeout_s=10)
    except Exception:
        pass
    tv.close()


# ---- 5. undo (undo.sh, then remove-all.sh) ----

def undo_plan(tv):
    rec = record(tv)
    present = _packages(tv)
    disabled = _packages(tv, "-d")
    back = [p for p in NEVER_OFF + (rec["disabled"] or [AMBIENT]) if p in present and p in disabled]
    return {
        "home_installed": HOME_PKG in present, "ontv_installed": ONTV_PKG in present,
        "switch_back_on": sorted(set(back)), "home": rec["home"] or "the TV's own home",
        "home_name": friendly_home(rec["home"]) if rec["home"] else "the TV's own home",
    }


def undo(tv, progress=lambda f, msg=None: None):
    done = []
    rec = record(tv)
    present = _packages(tv)
    pkgs = list(NEVER_OFF) + (rec["disabled"] or [AMBIENT])
    progress(0.1, "Switching back on what couch-tv switched off")
    for p in dict.fromkeys(pkgs):
        if p in present:
            tv.shell(f"pm enable {p}")
    done.append("switched back on")
    tv.shell(f"appops set {HOME_PKG} SYSTEM_ALERT_WINDOW default; appops set {HOME_PKG} WRITE_SETTINGS default; "
             f"pm revoke {HOME_PKG} android.permission.WRITE_SECURE_SETTINGS")
    progress(0.3, "Switching off the Home button watch")
    cur = tv.shell("settings get secure enabled_accessibility_services").strip()
    parts = [s for s in cur.split(":") if s and s != "null"]
    keep = [s for s in parts if not s.startswith(HOME_PKG + "/") and not s.startswith(ONTV_PKG + "/")]
    if keep != parts:
        if keep:
            tv.shell(f"settings put secure enabled_accessibility_services {':'.join(keep)}")
        else:
            tv.shell("settings delete secure enabled_accessibility_services")
        done.append("Home button watch off")
    home = rec["home"]
    if not home:
        homes = _lines(tv.shell(QUERY_HOMES))
        for pkg in ("com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.amazon.tv.launcher"):
            if pkg in present:
                home = next((h for h in homes if h.startswith(pkg + "/")), "")
                if home:
                    break
    if home and ACT_RE.match(home):
        tv.shell(f"cmd package set-home-activity {home}")
        done.append("home back to " + home)
    progress(0.5, "Removing the couch-tv apps")
    for p in (HOME_PKG, ONTV_PKG):
        if p in present:
            out = tv.shell(f"pm uninstall {p}", 120)
            if "Success" not in out:
                raise TvError(f"The TV did not remove {p}: " + out.strip()[-160:], "uninstall_failed")
            done.append("removed " + p)
    tv.shell(f"rm -rf {RECORD_DIR} {RECORD_DIR}.apk {RECORD_DIR}.parts {RECORD_DIR}.b64")
    _save_local(serial(tv), None)
    progress(0.85, "Pressing Home")
    tv.key("HOME")
    time.sleep(2)
    now = (_lines(tv.shell(RESOLVE)) or [""])[-1]
    progress(1.0, "Done")
    return {"changed": done, "home_now": now}
