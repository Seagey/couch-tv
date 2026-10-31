"""Settings for the bridge, read once at start-up.

Looks for config.json in the repo root (or the file named by COUCH_CONFIG). If there is none it
falls back to config.example.json, so the bridge always starts. Copy the example to config.json
and edit it. config.json is in .gitignore: it never gets committed.

Secrets never go in here. They are environment variables (see env.example).
"""
import json
import os
import re
import shutil
import tempfile

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
CLIENT_NAME = CONFIG.get("client_name", "Couch TV bridge")

# The languages the TV home and the phone remote speak (tv-home/web/i18n.js, remote/src/i18n.js).
LANGUAGES = ("en", "es", "es-MX", "it")
# Where shows stream (JustWatch) and what the prompts call the country: "country" in config.json.
# Without it: the country of the home's language, where it has one of its own (Italian: IT), else AU.
_LANGUAGE_COUNTRY = {"it": "IT"}
_language = CONFIG["home"].get("language") if isinstance(CONFIG.get("home"), dict) else None
COUNTRY = str(CONFIG.get("country") or _LANGUAGE_COUNTRY.get(str(_language)) or "AU").upper()
_COUNTRY_NAMES = {
    "AU": "Australia", "NZ": "New Zealand", "US": "the United States", "GB": "the United Kingdom",
    "UK": "the United Kingdom", "IE": "Ireland", "CA": "Canada", "IN": "India", "ZA": "South Africa",
    "SG": "Singapore", "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy",
    "NL": "the Netherlands", "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland",
    "BR": "Brazil", "MX": "Mexico", "JP": "Japan", "KR": "South Korea", "PH": "the Philippines",
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
        if isinstance(m.get("name"), str) and m["name"].strip():
            item["name"] = m["name"].strip()[:40]
        out.append(item)
        if len(out) >= 20:
            break
    return out


def _home(h):
    h = h if isinstance(h, dict) else {}
    mine = _my_scenes(h.get("my_scenes"))
    ids = SCENE_IDS + [m["id"] for m in mine]
    scenes = [s for s in dict.fromkeys(h.get("scenes") or []) if s in ids] if isinstance(h.get("scenes"), list) else []
    hide = h.get("hide_packages") if isinstance(h.get("hide_packages"), list) else []
    out = {
        # Android package names never shown on the home or in More apps (a maker's own clutter).
        "hide_packages": [p for p in dict.fromkeys(hide) if isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.]{1,200}", p)],
        "look": h.get("look") if h.get("look") in ("night", "classic") else "night",
        "scenes": scenes or list(SCENE_IDS),
        "scene_seconds": _int(h.get("scene_seconds"), 20, 5, 3600),
        "dock_size": _int(h.get("dock_size"), DOCK_LIMIT, 1, DOCK_LIMIT),
        # your own scenes, in backgrounds/mine/ (docs/MAKE-A-SCENE.md)
        "my_scenes": mine,
    }
    # Only when config.json gives them. Without "language" the TV home speaks the TV's own language
    # (English if it is not one of LANGUAGES), and without "clock" it uses that language's usual
    # clock (24 hour in Italian, else 12 hour). Home settings on the TV win over both.
    clock = str(h.get("clock") or "").lower()
    if clock in ("12h", "24h"):
        out["clock"] = clock
    if h.get("language") in LANGUAGES:
        out["language"] = h["language"]
    return out


HOME = _home(CONFIG.get("home"))

# ---------- quick settings (per TV) and picture modes ----------
QUICK_IDS = ["sleep", "picture", "look", "input"]


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


# ---------- the phone remote and the Claude ask ----------
PHONE_REMOTE = CONFIG.get("phone_remote", True) is not False


def _claude_present():
    given = os.environ.get("CLAUDE_BIN")
    return bool((given and os.path.exists(given)) or shutil.which("claude") or os.path.exists("/opt/homebrew/bin/claude"))


_ask = CONFIG.get("ask") if isinstance(CONFIG.get("ask"), dict) else {}
ASK_ENABLED = bool(_ask["enabled"]) if isinstance(_ask.get("enabled"), bool) else _claude_present()


def save_tvs():
    """Write the TV list back (used by pair_tv.py after pairing). Writes config.json."""
    data = dict(CONFIG)
    data["tvs"] = TVS
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def public():
    """The parts the TV home and the phone remote are allowed to see."""
    return {"people": PEOPLE, "weather": WEATHER, "home": HOME,
            "tvs": [{"id": t["id"], "name": t["name"], "quick": quick_for(t),
                     "picture_modes": [m["name"] for m in picture_modes(t.get("picture"))]} for t in TVS],
            "default_tv": DEFAULT_TV, "ask": {"enabled": ASK_ENABLED}, "phone_remote": PHONE_REMOTE}
