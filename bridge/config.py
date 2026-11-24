"""Settings for the bridge, read once at start-up.

Looks for config.json in the repo root (or the file named by COUCH_CONFIG). If there is none it
falls back to config.example.json, so the bridge always starts. Copy the example to config.json
and edit it. config.json is in .gitignore: it never gets committed.

Secrets never go in here. They are environment variables (see env.example).
"""
import json
import logging
import os
import re
import shutil
import tempfile

import custom_cards

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _load_dotenv():
    """Read KEY=value lines from .env in the repo root into the environment (never overrides)."""
    try:
        with open(os.path.join(ROOT, ".env")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    except FileNotFoundError:
        pass


_load_dotenv()
CONFIG_FILE = os.environ.get("COUCH_CONFIG") or os.path.join(ROOT, "config.json")
EXAMPLE_FILE = os.path.join(ROOT, "config.example.json")

# Runtime files (watch history, taste, pairing certs). Never committed.
DATA = os.environ.get("COUCH_DATA") or os.path.join(HERE, "data")


def _load():
    for path in (CONFIG_FILE, EXAMPLE_FILE):
        try:
            with open(path) as f:
                return json.load(f), path
        except FileNotFoundError:
            continue
    raise SystemExit("No config.json or config.example.json found in " + ROOT)


CONFIG, LOADED_FROM = _load()

TVS = CONFIG["tvs"]
DEFAULT_TV = CONFIG.get("default_tv") or TVS[0]["id"]
WEATHER = {"lat": -33.8688, "lon": 151.2093, "place": "Sydney", "timezone": "Australia/Sydney",
           **(CONFIG.get("weather") or {})}
SCREENS = CONFIG.get("screens") or []
BRIDGE = {"host": "your-computer.local", "port": 5400, "fallback_hosts": [], **(CONFIG.get("bridge") or {})}
PAIRING_KEY = str(BRIDGE.get("pairing_key") or os.environ.get("BRIDGE_KEY") or "").strip()
# The key travels in URLs (TV homes, Roku, the events stream) and on the TV's shell command line
# (apply.sh), so it is letters, digits, - and _ only, and long enough that guessing it is no use.
if PAIRING_KEY and not re.fullmatch(r"[A-Za-z0-9_-]{12,128}", PAIRING_KEY):
    raise SystemExit("bridge.pairing_key: use 12 to 128 letters, digits, - or _ "
                     "(for example: python3 -c 'import secrets; print(secrets.token_urlsafe(18))')")
CLIENT_NAME = CONFIG.get("client_name", "Couch TV bridge")

# Languages accepted by the TV home and its settings (tv-home/web/i18n.js).
LANGUAGES = ("en", "es", "es-MX", "it", "de", "tr", "fr", "sr-Latn-RS", "nl", "he", "cs", "pl", "pt", "ar", "ro", "zh-CN")
# Where shows stream (JustWatch) and what the prompts call the country: "country" in config.json.
# Without it: the country of the home's language, where it has one of its own (Italian: IT,
# German: DE, Turkish: TR, Serbian: RS, Dutch: BE, Hebrew: IL, Czech: CZ, Polish: PL, Brazilian Portuguese: BR, Arabic: SA, Romanian: RO, Simplified Chinese: CN), else AU.
_LANGUAGE_COUNTRY = {"it": "IT", "de": "DE", "tr": "TR", "sr-Latn-RS": "RS", "nl": "BE", "he": "IL", "cs": "CZ", "pl": "PL", "pt": "BR", "ar": "SA", "ro": "RO", "zh-CN": "CN"}
_language = CONFIG["home"].get("language") if isinstance(CONFIG.get("home"), dict) else None
COUNTRY = str(CONFIG.get("country") or _LANGUAGE_COUNTRY.get(str(_language)) or "AU").upper()
_COUNTRY_NAMES = {
    "AU": "Australia", "NZ": "New Zealand", "US": "the United States", "GB": "the United Kingdom",
    "UK": "the United Kingdom", "IE": "Ireland", "CA": "Canada", "IN": "India", "ZA": "South Africa",
    "SG": "Singapore", "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy",
    "NL": "the Netherlands", "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland",
    "BR": "Brazil", "MX": "Mexico", "JP": "Japan", "KR": "South Korea", "PH": "the Philippines",
    "RS": "Serbia", "IL": "Israel", "CZ": "Czechia", "PL": "Poland", "SA": "Saudi Arabia",
    "RO": "Romania", "CN": "China",
}
COUNTRY_NAME = CONFIG.get("country_name") or _COUNTRY_NAMES.get(COUNTRY, COUNTRY)
# The home's time zone, for times the bridge writes down: "timezone" under "weather".
TIMEZONE = WEATHER.get("timezone") or "UTC"


def tv_host(tv_cfg):
    """The TV's address: its "host" name when one is set (an empty string counts as none), else "ip"."""
    return (tv_cfg.get("host") or "").strip() or tv_cfg.get("ip")


def adb_port(tv_cfg=None):
    """The TV's ADB port: "adb_port" on that TV in config.json, else ADB_PORT, else 5555."""
    for v in ((tv_cfg or {}).get("adb_port"), os.environ.get("ADB_PORT")):
        try:
            if v not in (None, "") and 0 < int(v) < 65536:
                return int(v)
        except (TypeError, ValueError):
            pass
    return 5555


def slug(text, fallback="item"):
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:32]
    return s or fallback


# ---------- people (profiles) ----------
# Any number, in the order they show. config.json seeds the list; edits and the order made from the
# phone or the TV remote are kept in data/people.json, which wins from then on.
PEOPLE_FILE = os.path.join(DATA, "people.json")
RESERVED_WHO = {"both", "all", "everyone", "shared", "together"}
MAX_PEOPLE = 12


def clean_people(items):
    """A tidy people list: every entry has a unique id and a name, colour only if it is a hex colour."""
    out, ids = [], set()
    for p in items if isinstance(items, list) else []:
        if isinstance(p, str):
            p = {"name": p}
        if not isinstance(p, dict):
            continue
        name = " ".join(str(p.get("name") or "").split())[:40]
        if not name:
            continue
        given = p.get("id")
        pid = given if isinstance(given, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", given) else slug(name, "person")
        if pid.lower() in RESERVED_WHO:
            pid += "-1"
        base, n = pid, 2
        while pid.lower() in ids:
            pid, n = f"{base}-{n}", n + 1
        ids.add(pid.lower())
        item = {"id": pid, "name": name}
        if isinstance(p.get("colour"), str) and re.fullmatch(r"#[0-9a-fA-F]{3,8}", p["colour"]):
            item["colour"] = p["colour"]
        # Kids and guests are left out of the household's taste (what "everyone" picks are based on).
        for flag in ("kid", "guest"):
            if p.get(flag) is True:
                item[flag] = True
        # Their profile names inside Netflix, Stan, Disney+ and the rest, best first, for the
        # "Who's watching?" screen. Without it their own name is tried.
        names = [" ".join(str(n).split())[:40] for n in p.get("app_profiles") or [] if isinstance(n, str)]
        if [n for n in names if n]:
            item["app_profiles"] = [n for n in names if n][:10]
        out.append(item)
        if len(out) >= MAX_PEOPLE:
            break
    return out


def _saved_people():
    try:
        with open(PEOPLE_FILE) as f:
            data = json.load(f)
        return clean_people(data.get("people") if isinstance(data, dict) else data)
    except (FileNotFoundError, json.JSONDecodeError, AttributeError):
        return None


# A people key that is there (even an empty list) is used as it is; no key at all keeps the old default.
PEOPLE = clean_people(CONFIG["people"]) if isinstance(CONFIG.get("people"), list) else [{"id": "person1", "name": "Person 1"}]
_saved = _saved_people()
if _saved is not None and os.path.exists(PEOPLE_FILE):
    PEOPLE = _saved
# Profile names to try on a "Who's watching?" screen when none of the watcher's own are there.
APP_PROFILE_FALLBACK = [" ".join(str(n).split())[:40] for n in CONFIG.get("app_profile_fallback") or []
                        if isinstance(n, str) and n.strip()][:10]
# These two lists are changed in place by set_people, so every module that holds them sees edits.
PEOPLE_IDS = [p["id"] for p in PEOPLE]


def set_people(items):
    """Replace the people list (order and edits) and keep it in data/people.json."""
    cleaned = clean_people(items)
    os.makedirs(DATA, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump({"people": cleaned}, f, indent=1)
    os.replace(tmp, PEOPLE_FILE)
    PEOPLE[:] = cleaned
    PEOPLE_IDS[:] = [p["id"] for p in cleaned]
    return PEOPLE


def left_out_of_taste():
    """Ids of the people marked "kid": true or "guest": true (read now: the phone can edit people)."""
    return {p["id"] for p in PEOPLE if p.get("kid") or p.get("guest")}


def person_name(pid):
    return next((p["name"] for p in PEOPLE if p["id"] == pid), None)


# ---------- the home's look ----------
SCENE_IDS = ["night", "golden", "water", "fog", "dawn"]
DOCK_LIMIT = 10   # apps in the dock before Settings and More apps; 10 fills a 1080p screen


def _int(value, default, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(lo, min(hi, int(value)))


def _share(value, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(max(lo, min(hi, float(value))), 3)


SOUNDSCAPE_TYPES = ("off", "rain", "fire", "waves", "brown")
SMART_IDLE_ACTIONS = ("ambient_clock", "screen_off", "tv_off")


def _int_choice(value, default, choices):
    """Return int(value) if it is a non-bool number in choices, else default."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    v = int(value)
    return v if v in choices else default


def _hhmm(value, default):
    """Validate a 24-hour HH:MM string, returning default if invalid."""
    if isinstance(value, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value.strip()):
        return value.strip()
    return default


def _smart_idle(raw):
    """Normalize home.smart_idle settings; 0 minutes disables that trigger."""
    d = raw if isinstance(raw, dict) else {}
    qh = d.get("quiet_hours") if isinstance(d.get("quiet_hours"), dict) else {}
    return {
        "enabled": bool(d.get("enabled", False)),
        "home_idle_minutes": _int_choice(d.get("home_idle_minutes"), 15, (0, 5, 10, 15, 30, 60)),
        "home_action": d.get("home_action") if d.get("home_action") in SMART_IDLE_ACTIONS else "ambient_clock",
        "paused_idle_minutes": _int_choice(d.get("paused_idle_minutes"), 30, (0, 10, 15, 20, 30, 45, 60)),
        "quiet_hours": {
            "enabled": bool(qh.get("enabled", False)),
            "start": _hhmm(qh.get("start"), "23:00"),
            "end": _hhmm(qh.get("end"), "06:00"),
            "idle_minutes": _int_choice(qh.get("idle_minutes"), 15, (5, 10, 15, 20, 30)),
        },
    }


def _float(value, default, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return round(max(lo, min(hi, float(value))), 2)


def _my_scenes(items):
    """home.my_scenes: your own scenes (tv-home/tools/make-scene.py, docs/MAKE-A-SCENE.md). Only the
    keys the TV home reads, with safe values; the page checks them again."""
    out, seen = [], set(SCENE_IDS) | {"own", "mine"}
    for m in items if isinstance(items, list) else []:
        if not isinstance(m, dict) or not isinstance(m.get("id"), str) or not re.fullmatch(r"[a-z0-9]{1,24}", m["id"]):
            continue
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        c = m.get("clock") if isinstance(m.get("clock"), dict) else {}
        clock = {"x": c.get("x") if c.get("x") in ("left", "centre", "right") else "centre",
                 "font": "inter" if c.get("font") == "inter" else "antonio"}
        for key, lo, hi in (("y", 0.12, 0.6), ("size", 0.2, 0.45), ("weight", 100, 900)):
            v = _share(c.get(key), lo, hi)
            if v is not None:
                clock[key] = v
        item = {"id": m["id"], "clock": clock, "date": "below" if m.get("date") == "below" else "above",
                "text": "dark" if m.get("text") == "dark" else "light", "cutout": m.get("cutout") is True}
        if m.get("video") is True:   # backgrounds/mine/scene-<id>.mp4 loops over the photo
            item["video"] = True
        if m.get("when") in ("dawn", "day", "dusk", "night"):   # Follow the sun shows it then (app.js)
            item["when"] = m["when"]
        if isinstance(m.get("name"), str) and m["name"].strip():
            item["name"] = m["name"].strip()[:40]
        out.append(item)
        if len(out) >= 20:
            break
    return out


# The four looks the home can wear. Loop is the video one (docs/LOOP.md): it needs the files below.
LOOKS = ("night", "classic", "oled", "loop")

# The Loop look's footage, made by scripts/make-loop.sh on this computer (git ignores the folder):
# <variant>.mp4 and its 160x90 blurred copy <variant>-blur.mp4 for the glass, with a poster of
# each (<variant>.jpg, <variant>-blur.jpg). One variant per time of day, in this order. A photo's
# loop made with --matte also has <variant>-fg.png, the cut-out the home draws over the clock, and
# every run writes loop.json, the loop's length and motion (docs/LOOP.md, the depth effect).
LOOP_DIR = os.path.join(ROOT, "tv-home", "web", "loop")
LOOP_VARIANTS = ("dawn", "day", "dusk", "night")
LOOP_SCREEN = (1920, 1080)   # the home's design pixels, which loop.json's fg rectangle is in
_log = logging.getLogger("config")
_loop_json_told = set()      # the loop.json files (path, size, time) already logged as ignored


def loop_files(folder):
    """What the Loop look can play from `folder`: the variants whose .mp4 is there, in the order
    dawn, day, dusk, night, and `blur` true only when every present variant has its blurred copy
    (one without it would make the glass go dark at that time of day). A missing folder gives an
    empty list, so the key is always there for the home to read. `meta` is loop.json when it is
    there and sound, else None; `fg` is true only when meta has a cut-out rectangle and every
    present variant has its <variant>-fg.png (one without it would lose the depth at that time of
    day).

    Only those exact names count, in `folder` itself: make-loop.sh makes each run's files in a hidden
    folder inside it (.staging-<pid>/.dawn.mp4 and so on) and moves them in only when every encode has
    worked, loop.json last, so a run under way, or one that failed or was stopped, is never listed. A
    dotfile, a temp name (dawn.mp4.part, .dawn.mp4) or anything in a subfolder is not a variant."""
    variants = [v for v in LOOP_VARIANTS if os.path.isfile(os.path.join(folder, v + ".mp4"))]
    blur = bool(variants) and all(os.path.isfile(os.path.join(folder, v + "-blur.mp4")) for v in variants)
    meta = loop_meta(folder)
    fg = bool(variants) and bool(meta and meta["fg"]) and \
        all(os.path.isfile(os.path.join(folder, v + "-fg.png")) for v in variants)
    return {"variants": variants, "blur": blur, "version": loop_version(folder, variants), "meta": meta, "fg": fg}


def _in_range(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def _whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def loop_meta(folder):
    """loop.json from make-loop.sh: {"still", "seconds", "fps", "zoom", "sway", "fg"}, checked:
    seconds 15 to 60, fps 30, zoom 0 to 0.2, sway 0 to 1 (a share of the room the zoom leaves, so
    ffmpeg never clamps it), fg null or whole numbers x, y, w, h
    with the rectangle inside the 1920x1080 screen. None when the file is missing; when it is there
    but not sound, None and one log line (once for each version of the file, since this is read on
    every request for config.js)."""
    path = os.path.join(folder, "loop.json")
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None
    except OSError as e:
        return _loop_meta_bad(path, None, "it could not be read (%s)" % e)
    try:
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        return _loop_meta_bad(path, st, "it could not be read (%s)" % e)
    if not isinstance(m, dict):
        return _loop_meta_bad(path, st, "it is not an object")
    fg = m.get("fg")
    sw, sh = LOOP_SCREEN
    why = None
    if not isinstance(m.get("still"), bool):
        why = "still is not true or false"
    elif not _in_range(m.get("seconds"), 15, 60):
        why = "seconds is not from 15 to 60"
    elif m.get("fps") != 30 or isinstance(m.get("fps"), bool):
        why = "fps is not 30"
    elif not _in_range(m.get("zoom"), 0, 0.2):
        why = "zoom is not from 0 to 0.2"
    elif not _in_range(m.get("sway"), 0, 1):
        why = "sway is not from 0 to 1"
    elif fg is not None:
        if not (isinstance(fg, dict) and all(_whole(fg.get(k)) for k in ("x", "y", "w", "h"))):
            why = "fg is not whole numbers x, y, w and h"
        elif not (fg["x"] >= 0 and fg["y"] >= 0 and fg["w"] > 0 and fg["h"] > 0
                  and fg["x"] + fg["w"] <= sw and fg["y"] + fg["h"] <= sh):
            why = "fg is not inside the %dx%d screen" % (sw, sh)
    if why:
        return _loop_meta_bad(path, st, why)
    return {"still": m["still"], "seconds": m["seconds"], "fps": 30, "zoom": m["zoom"], "sway": m["sway"],
            "fg": None if fg is None else {k: fg[k] for k in ("x", "y", "w", "h")}}


def _loop_meta_bad(path, st, why):
    key = (path, st.st_size, st.st_mtime_ns) if st else (path, why)
    if key not in _loop_json_told:
        _loop_json_told.add(key)
        _log.warning("the Loop look ignores %s: %s; run scripts/make-loop.sh again (docs/LOOP.md)", path, why)
    return None


def loop_version(folder, variants):
    """A short mark of the loop files as they are now (names, sizes and times), which the home adds to
    the files' addresses: the bridge serves them with an hour of caching, and without it a TV would go
    on playing the old files for an hour after make-loop.sh made new ones. loop.json counts too, as the
    cut-out's motion lives there. Empty with no variants."""
    import hashlib
    h = hashlib.sha1()
    names = [v + suffix for v in variants for suffix in (".mp4", "-blur.mp4", ".jpg", "-blur.jpg", "-fg.png")]
    for name in names + ["loop.json"]:
        try:
            st = os.stat(os.path.join(folder, name))
        except OSError:
            continue
        h.update(f"{name}:{st.st_size}:{int(st.st_mtime)}\n".encode())
    return h.hexdigest()[:10] if variants else ""


# g24: icon packs. home.icon_set (or Home settings, Look, Icon style) draws the home's own tiles (Settings,
# More apps, Inputs, Screens) from couch-tv's icon sets (tv-home/web/icon-sets.js STYLES); "builtin" is
# the usual drawing. Your own app icons are tv-home/tools/app-icons.sh (since 0.13, docs/TV-HOME.md).
ICON_SETS = ("builtin", "line", "solid", "duotone", "tile", "glass", "playful")


def _home(h):
    h = h if isinstance(h, dict) else {}
    mine = _my_scenes(h.get("my_scenes"))
    ids = SCENE_IDS + [m["id"] for m in mine]
    scenes = [s for s in dict.fromkeys(h.get("scenes") or []) if s in ids] if isinstance(h.get("scenes"), list) else []
    hide = h.get("hide_packages") if isinstance(h.get("hide_packages"), list) else []
    out = {
        # Android package names never shown on the home or in More apps (a maker's own clutter).
        "hide_packages": [p for p in dict.fromkeys(hide) if isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.]{1,200}", p)],
        # Android package names the built-in hidden list would hide, shown anyway (the Google TV app, say).
        "show_packages": [p for p in dict.fromkeys(h.get("show_packages") if isinstance(h.get("show_packages"), list) else []) if isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.]{1,200}", p)],
        "look": h.get("look") if h.get("look") in LOOKS else "night",
        "scenes": scenes or list(SCENE_IDS),
        "scene_seconds": _int(h.get("scene_seconds"), 20, 5, 3600),
        "dock_size": _int(h.get("dock_size"), DOCK_LIMIT, 1, DOCK_LIMIT),
        # your own scenes, in backgrounds/mine/ (docs/MAKE-A-SCENE.md)
        "my_scenes": mine,
    }
    if h.get("icon_set") in ICON_SETS:
        out["icon_set"] = h["icon_set"]
    idle_photo_seconds = h.get("idle_photo_seconds")
    if type(idle_photo_seconds) is int and idle_photo_seconds in (0, 5, 10, 15, 30, 60):
        out["idle_photo_seconds"] = idle_photo_seconds
    # Only when config.json gives them. Without "language" the TV home speaks the TV's own language
    # (English if it is not one of LANGUAGES), and without "clock" it uses that language's usual
    # clock (24 hour in Italian, German, Turkish, French, Serbian, Polish and Brazilian Portuguese, else 12 hour). Home settings on the TV win over both.
    clock = str(h.get("clock") or "").lower()
    if clock in ("12h", "24h"):
        out["clock"] = clock
    if isinstance(h.get("clock_seconds"), bool):
        out["clock_seconds"] = h["clock_seconds"]
    if h.get("language") in LANGUAGES:
        out["language"] = h["language"]
    # The setup's answer to "tell you when a new version is out?": notify (the TV looks once a week)
    # or manual (only "Check for updates now"). Without it the TV home asks once on screen.
    if h.get("updates") in ("notify", "manual"):
        out["updates"] = h["updates"]
    # Glass panels (on, or lite: no blur for slower TVs) and a looping video background, a link to
    # an MP4 or MOV. Both off unless config.json or Home settings on the TV switches them on.
    if h.get("glass") in ("off", "on", "lite"):
        out["glass"] = h["glass"]
    if isinstance(h.get("glass_icons"), bool):
        out["glass_icons"] = h["glass_icons"]
    # the Night dock shows each app's wide TV banner instead of its square icon (six apps fit)
    if isinstance(h.get("dock_banners"), bool):
        out["dock_banners"] = h["dock_banners"]
    # the focused tile's slow sway (#52): on, or off for a TV that flickers
    if isinstance(h.get("keep_photo"), bool):
        out["keep_photo"] = h["keep_photo"]
    if isinstance(h.get("moving_tiles"), bool):
        out["moving_tiles"] = h["moving_tiles"]
    # the Mac-style dock: the focused app and its neighbours grow in a wave, its name in a bubble
    if h.get("dock") in ("mac", "classic"):
        out["dock"] = h["dock"]
    # lighter home for a slow box (#58): no blur, no soft shadows, a still photo, smaller pictures
    if isinstance(h.get("lighter"), bool):
        out["lighter"] = h["lighter"]
    # the clock on the home (g17): false hides it in the Night, Classic, OLED and Loop looks
    if isinstance(h.get("show_clock"), bool):
        out["show_clock"] = h["show_clock"]
    # draw the home at a lower resolution and let the TV scale it up (weak GPUs, MediaTek/Mali projectors):
    # the app reads it from the saved settings, so it only needs to get through here
    if isinstance(h.get("render_height"), int) and not isinstance(h.get("render_height"), bool) and 360 <= h["render_height"] <= 2160:
        out["render_height"] = h["render_height"]
    # remote buttons that open an app (KeyWatch.kt): "KEYCODE_BUTTON_3:org.smarttube.stable", "190:pkg" or "scan384:pkg"
    if isinstance(h.get("app_keys"), list):
        keys = [k for k in h["app_keys"] if isinstance(k, str) and re.fullmatch(
            r"(KEYCODE_[A-Z0-9_]{1,40}|\d{1,4}|scan\d{1,4}):(gear|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+)", k)]
        if keys:
            out["app_keys"] = keys[:30]
    # "always": the 4K copies on a 4K panel whose interface is drawn at 1080 (#191). false: a 4K screen with a weak chip keeps the 1080 backgrounds (lg/build.py then leaves the 4K copies out)
    if isinstance(h.get("hi_res"), bool) or h.get("hi_res") == "always":
        out["hi_res"] = h["hi_res"]
    # how clear the glass is, 1 (frosted) to 5 (very clear), and the Night clock's style
    if isinstance(h.get("glass_amount"), int) and not isinstance(h.get("glass_amount"), bool) and 1 <= h["glass_amount"] <= 5:
        out["glass_amount"] = h["glass_amount"]
    if h.get("clock_style") in ("frosted", "liquid"):
        out["clock_style"] = h["clock_style"]
    # temperature unit for the weather: c or f (#56). Home settings on the TV win over it.
    if h.get("wx_unit") in ("c", "f"):
        out["wx_unit"] = h["wx_unit"]
    # Now playing on or off (#31), and the navigation sound: the TV's own, soft or off (#32)
    if isinstance(h.get("now_playing"), bool):
        out["now_playing"] = h["now_playing"]
    if h.get("spotify_player") is True:
        out["spotify_player"] = True
    if h.get("football_scores") is True:
        out["football_scores"] = True
    # false hides the whole Keep watching row and stops the home asking for it. Home settings win over it.
    if isinstance(h.get("keep_watching"), bool):
        out["keep_watching"] = h["keep_watching"]
    # "poster" shows the Night look's Keep watching as Classic poster tiles, more to a row (#192)
    if h.get("keep_watching_style") in ("card", "poster"):
        out["keep_watching_style"] = h["keep_watching_style"]
    # true puts an Inputs tile first in the dock (#154). Home settings win over it.
    if isinstance(h.get("input_tile"), bool):
        out["input_tile"] = h["input_tile"]
    # true makes the row follow the app the remote is on ("Recently on <app>"). Home settings win over it.
    if isinstance(h.get("shelf_follows_app"), bool):
        out["shelf_follows_app"] = h["shelf_follows_app"]
    if isinstance(h.get("ambient_music"), bool):
        out["ambient_music"] = h["ambient_music"]
    if isinstance(h.get("sun_sync"), bool):
        out["sun_sync"] = h["sun_sync"]
    # the built-in scenes' slow depth zoom (off unless true)
    if isinstance(h.get("scene_zoom"), bool):
        out["scene_zoom"] = h["scene_zoom"]

    # a greeting and a short line under the clock (off unless true)
    if isinstance(h.get("greeting"), bool):
        out["greeting"] = h["greeting"]
    # each person's own style of greeting and lines: {"<person id>": "gentle" | "electric"}
    ps = h.get("person_styles")
    if isinstance(ps, dict):
        ps = {k: v for k, v in ps.items() if isinstance(k, str) and v in ("gentle", "electric")}
        if ps:
            out["person_styles"] = ps
    # with sun_sync: how long each scene of the time of day stays, 5 to 240 minutes (app.js)
    srm = h.get("sun_rotate_minutes")
    if isinstance(srm, int) and not isinstance(srm, bool) and 5 <= srm <= 240:
        out["sun_rotate_minutes"] = srm
    # your own scenes' clips keep playing with Lighter home on
    if isinstance(h.get("scene_clips_lighter"), bool):
        out["scene_clips_lighter"] = h["scene_clips_lighter"]
    # false: the clips never pause when the home sits idle, and the home never starts the screensaver
    if isinstance(h.get("scene_clips_idle"), bool):
        out["scene_clips_idle"] = h["scene_clips_idle"]
    if isinstance(h.get("ambient_weather"), bool):
        out["ambient_weather"] = h["ambient_weather"]
    if isinstance(h.get("ambient_sun_grade"), bool):
        out["ambient_sun_grade"] = h["ambient_sun_grade"]
    if h.get("nav_sound") in ("system", "soft", "off"):
        out["nav_sound"] = h["nav_sound"]
    # where the remote starts on Home: people (default, as before), keep_watching or apps (#211)
    if h.get("start_focus") in ("people", "apps", "keep_watching"):
        out["start_focus"] = h["start_focus"]
    if h.get("glass_focus") in ("colour", "glass"):   # glass app icons: the focused app (#32)
        out["glass_focus"] = h["glass_focus"]
    vid = h.get("video_url")
    if isinstance(vid, str) and re.match(r"https?://", vid) and len(vid) <= 2000:
        out["video_url"] = vid
    if h.get("bing_daily_background") is True:
        out["bing_daily_background"] = True
    skip_wn = h.get("skip_watch_next") if isinstance(h.get("skip_watch_next"), list) else []
    out["skip_watch_next"] = [p for p in dict.fromkeys(skip_wn) if isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.]{1,200}", p)]
    out["bedtime_dim"] = h.get("bedtime_dim") is True
    soundscape = h.get("soundscape")
    if isinstance(soundscape, dict):
        snd_type = soundscape.get("type")
        if snd_type in SOUNDSCAPE_TYPES:
            out["soundscape"] = {
                "type": snd_type,
                "volume": _float(soundscape.get("volume"), 0.5, 0.0, 1.0),
                "fade_with_sleep": soundscape.get("fade_with_sleep") is not False,
            }
    elif isinstance(soundscape, str) and soundscape in SOUNDSCAPE_TYPES:
        out["soundscape"] = {
            "type": soundscape,
            "volume": 0.5,
            "fade_with_sleep": True,
        }
    # custom cards (geissmannz on Instagram): a JSON file on this computer or an http(s) link. The TV
    # sees the link (so the on-TV app, with no bridge, can read it too) or just true for a file,
    # never the file's path. Off unless set.
    src = custom_cards.source(h.get("custom_cards"), os.path.dirname(os.path.abspath(CONFIG_FILE)))
    if src:
        out["custom_cards"] = src[1] if src[0] == "url" else True
    out["watch_next_per_app"] = _int(h.get("watch_next_per_app"), 5, 1, 20)
    # the Loop look's files on this computer (read only: the bridge builds it, config.json cannot set it)
    out["loop"] = loop_files(LOOP_DIR)
    out["smart_idle"] = _smart_idle(h.get("smart_idle"))
    if "inputs" in h:
        out["inputs"] = _inputs(h.get("inputs"))
    return out


def _inputs(raw_list):
    if not isinstance(raw_list, list):
        return []
    valid_icons = {"ps5", "xbox", "switch", "hdmi", "cable", "pc"}
    out = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or item.get("name") or "").strip()[:30]
        if not label:
            continue
        icon = str(item.get("icon") or "").strip().lower()
        if icon not in valid_icons:
            icon = "hdmi"
        entry = {"label": label, "icon": icon}
        if "port" in item and isinstance(item["port"], int) and 1 <= item["port"] <= 8:
            entry["port"] = item["port"]
        if "match" in item and isinstance(item["match"], str) and item["match"].strip():
            entry["match"] = item["match"].strip()[:50]
        if "id" in item and isinstance(item["id"], str) and item["id"].strip():
            entry["id"] = item["id"].strip()[:200]
        if "device" in item and isinstance(item["device"], str) and item["device"].strip():
            entry["device"] = item["device"].strip()[:50]
        # a picture for the tile, a file inside the TV app (backgrounds/mine/...): no addresses
        if isinstance(item.get("image"), str) and re.fullmatch(r"\w[\w./-]*\.(svg|png|jpe?g|webp)", item["image"].strip(), re.I) \
                and ".." not in item["image"] and "//" not in item["image"]:
            entry["image"] = item["image"].strip()
        if "port" in entry or "match" in entry or "id" in entry or "device" in entry:
            out.append(entry)
        if len(out) >= 8:
            break
    return out


HOME = _home(CONFIG.get("home"))


# A design is untrusted input that runs on a TV. tv-home/web/design.js is the real gate (it rebuilds
# the design from an allowed list); this is a second one, so nothing that looks like a link or markup
# is even handed to the home: such a value is dropped, with a note.
_DESIGN_PICTURE = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
_DESIGN_BAD = re.compile(r"(?i)(\b(javascript|vbscript|https?|ftp|file|blob)\s*:|^\s*//|<\s*/?\s*(script|iframe|object|embed|svg|img|style|link)\b|\bon\w+\s*=|url\s*\(|@import|expression\s*\()")


def _design_clean(v, depth=0, dropped=None):
    if depth > 8:
        return None
    if isinstance(v, dict):
        out = {}
        for k, x in list(v.items())[:200]:
            if not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", k):
                dropped.append(str(k)[:40])
                continue
            c = _design_clean(x, depth + 1, dropped)
            if c is not None:
                out[k] = c
        return out
    if isinstance(v, list):
        return [c for c in (_design_clean(x, depth + 1, dropped) for x in v[:200]) if c is not None]
    if isinstance(v, str):
        if _DESIGN_PICTURE.match(v):
            return v
        if len(v) > 2000 or _DESIGN_BAD.search(v):
            dropped.append(v[:40])
            return None
        return v
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return v if abs(v) < 1e9 else None
    return None


def _design(d):
    """couch-tv Studio's design block (docs/CONFIG.md, "Design"), cleaned of anything that looks like
    a link or markup, then handed to the TV home, whose design.js checks every value again. Only an
    object, and not too big for the TV to keep (an uploaded background travels inside it)."""
    if not isinstance(d, dict) or not d:
        return None
    if len(json.dumps(d)) > 4_000_000:
        print("config: design is over 4 MB (a smaller background picture fixes it), the home stays as it is")
        return None
    dropped = []
    clean = _design_clean(d, 0, dropped)
    if dropped:
        print("config: design: left out %d value(s) that looked like a link or markup" % len(dropped))
    return clean or None


DESIGN = _design(CONFIG.get("design"))


def _design_store(u):
    """couch-tv Studio's design store (docs/CONFIG.md, "Design"): the one server the TV may ask for a
    design by code. https only (plain http only to this computer, for development); no path."""
    if not isinstance(u, str):
        return None
    if not u.strip():
        return ""   # "design_store": "" turns getting a design by code off, and the TV is told so
    m = re.fullmatch(r"(?i)(https://[a-z0-9.-]+(:\d{1,5})?|http://(127\.0\.0\.1|localhost)(:\d{1,5})?)/?", u.strip())
    if not m:
        if u:
            print("config: design_store must be an https address with no path, it was left out")
        return None
    return m.group(1).lower()


DESIGN_STORE = _design_store(CONFIG.get("design_store"))

# the source of the custom cards (home.custom_cards), kept here: the TV only sees HOME["custom_cards"]
CUSTOM_CARDS = custom_cards.source((CONFIG.get("home") or {}).get("custom_cards") if isinstance(CONFIG.get("home"), dict) else None,
                                   os.path.dirname(os.path.abspath(CONFIG_FILE)))

# ---------- quick settings (per TV) and picture modes ----------
# Every button the TV home offers (QUICK_ALL in tv-home/web/app.js): an id missing here is dropped from
# the bridge's copy of Home settings, and the TV takes that copy back, so the button vanished (g31).
QUICK_IDS = ["sleep", "picture", "look", "soundscape", "screen_off", "input", "screensaver", "headphones", "tvsettings", "extend",
             "bluetooth", "network", "reminder"]


def quick_for(tv_cfg):
    """The quick buttons for one TV, in order. No "quick" key: the sleep timer, plus the picture
    switch on a TV that has a "picture" entry (how it was before the key existed)."""
    q = tv_cfg.get("quick")
    if isinstance(q, list):
        return [x for x in dict.fromkeys(q) if x in QUICK_IDS]
    return ["sleep"] + (["picture"] if tv_cfg.get("picture") else [])


def picture_cfg(pic):
    """Normalise a TV's "picture" entry. The simple form {"modes": ["Calibrated", "Dynamic"]} becomes
    the panel method (open the TV's picture mode settings, pick the row with that name)."""
    if not isinstance(pic, dict) or not pic:
        return {}
    pic = dict(pic)
    modes = [str(m).strip() for m in pic.get("modes") or [] if str(m).strip()][:2]
    if modes and not pic.get("values"):
        pic["values"] = {slug(m, f"mode-{i + 1}"): m for i, m in enumerate(modes)}
        pic.setdefault("method", "panel")
        pic.setdefault("can_set", True)
    return pic


def picture_modes(pic):
    """[{"id", "name"}] for the two modes, for labels on the TV and the phone."""
    pic = picture_cfg(pic)
    values = pic.get("values") or {}
    panel = pic.get("method") == "panel"
    return [{"id": k, "name": str(v) if panel else k.replace("-", " ").title()} for k, v in list(values.items())[:2]]


# ---------- Plex (optional, option B): Keep watching from the server's own Continue Watching ----------
# The server's address as the bridge reaches it, and (optional) whose cards they are. The token is
# PLEX_TOKEN in .env, never here (bridge/plex.py). None: no section, "enabled": false, or no address.
PLEX_ERROR = None   # why a plex section that is there was refused (the bridge's log and /api/plex/status say)


def _plex(raw):
    global PLEX_ERROR
    PLEX_ERROR = None
    p = raw if isinstance(raw, dict) else {}
    url = str(p.get("url") or "").strip().rstrip("/")
    if p.get("enabled") is False:
        return None
    if not re.fullmatch(r"https?://[^/\s?#]+", url):
        if url:
            PLEX_ERROR = f"plex.url must be http(s)://<name or address>[:port] with no path, not {url!r}"
        elif raw:
            PLEX_ERROR = "the plex section has no url"
        return None
    who = str(p.get("who") or "").strip()
    return {"url": url, "who": who or None}


PLEX = _plex(CONFIG.get("plex"))


# ---------- the phone remote and the Claude ask ----------
PHONE_REMOTE = CONFIG.get("phone_remote", True) is not False


def _claude_present():
    given = os.environ.get("CLAUDE_BIN")
    return bool((given and os.path.exists(given)) or shutil.which("claude") or os.path.exists("/opt/homebrew/bin/claude"))


_ask = CONFIG.get("ask") if isinstance(CONFIG.get("ask"), dict) else {}
ASK_ENABLED = bool(_ask["enabled"]) if isinstance(_ask.get("enabled"), bool) else _claude_present()


# The Spotify card's skip step, in seconds: the one rule for config.json, Home settings (server.clean_settings)
# and the home itself (app.js cycles through the same four). Anything else is the default, 10.
SPOTIFY_SEEK_STEPS = (5, 10, 15, 30)


def spotify_seek(v):
    """v when it is one of SPOTIFY_SEEK_STEPS (a whole number, never True or False), else None."""
    return v if isinstance(v, int) and not isinstance(v, bool) and v in SPOTIFY_SEEK_STEPS else None


def _spotify(raw):
    """Configuration for Spotify local media session integration."""
    defaults = {
        "enabled": False,
        "seek_seconds": 10,
        "hide_idle": False,
        "title_mode": "pingpong",
        "show_app": True,
        "align": "classic",
        "mini_align": "classic",
        "mini_art": "wide",
        "scrub_bar": True,
        "show_shuffle_repeat": True,
        "adaptive_tint": True,
        "waveform": True,
        "card_style": "compact",
        "show_up_next": True,
        "show_jump_app": True,
        "show_sleep_timer": True,
        "show_audio_output": True,
        "separate_row": True,
        "sync_theme_colors": False,
    }
    if not isinstance(raw, dict):
        return dict(defaults)
    out = {}
    out["enabled"] = bool(raw.get("enabled", False))
    out["seek_seconds"] = spotify_seek(raw.get("seek_seconds")) or 10
    out["hide_idle"] = bool(raw.get("hide_idle", False))
    mode = raw.get("title_mode")
    out["title_mode"] = mode if mode in ("dots", "pingpong", "continuous") else "pingpong"
    out["show_app"] = bool(raw.get("show_app", True))
    align = raw.get("align")
    out["align"] = align if align in ("classic", "center", "dock_center") else "classic"
    mini_align = raw.get("mini_align")
    out["mini_align"] = mini_align if mini_align in ("classic", "right") else "classic"
    mini_art = raw.get("mini_art")
    out["mini_art"] = mini_art if mini_art in ("square", "wide") else "wide"
    out["scrub_bar"] = bool(raw.get("scrub_bar", True))
    out["show_shuffle_repeat"] = bool(raw.get("show_shuffle_repeat", True))
    out["adaptive_tint"] = bool(raw.get("adaptive_tint", True))
    out["waveform"] = bool(raw.get("waveform", True))
    style = raw.get("card_style")
    out["card_style"] = style if style in ("compact", "mini") else "compact"
    out["show_up_next"] = bool(raw.get("show_up_next", True))
    out["show_jump_app"] = bool(raw.get("show_jump_app", True))
    out["show_sleep_timer"] = bool(raw.get("show_sleep_timer", True))
    out["show_audio_output"] = bool(raw.get("show_audio_output", True))
    out["separate_row"] = bool(raw.get("separate_row", True))
    out["sync_theme_colors"] = bool(raw.get("sync_theme_colors", False))
    return out


SPOTIFY = _spotify(CONFIG.get("spotify"))


def save_tvs():
    """Write the TV list back (used by pair_tv.py after pairing). Writes config.json."""
    data = dict(CONFIG)
    data["tvs"] = TVS
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def public():
    """The parts the TV home and the phone remote are allowed to see."""
    import kids   # kids mode: the shelf and the PIN's hash (never the PIN) on each kids profile
    # home.loop is read afresh: make-loop.sh may have run since the bridge started
    return {"people": kids.attach(PEOPLE), "weather": WEATHER, "home": dict(HOME, loop=loop_files(LOOP_DIR)),
            "tvs": [dict({"id": t["id"], "name": t["name"], "quick": quick_for(t),
                          "extend_devmode": t.get("extend_devmode", True) is not False,
                          "picture_modes": [m["name"] for m in picture_modes(t.get("picture"))]},
                         # input tiles for this TV only (its own HDMI devices); else home.inputs
                         **({"inputs": _inputs(t["inputs"])} if isinstance(t.get("inputs"), list) else {}))
                     for t in TVS],
            "default_tv": DEFAULT_TV, "ask": {"enabled": ASK_ENABLED}, "phone_remote": PHONE_REMOTE,
            "spotify": SPOTIFY,
            # only when config.json has one: without it the home is exactly as before
            **({"design": DESIGN} if DESIGN else {}),
            **({"design_store": DESIGN_STORE} if DESIGN_STORE is not None else {})}
