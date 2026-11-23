"""Kids mode: a person whose home shows only the shows a parent picked (docs/CONFIG.md, "Kids mode").

A person in config.json can carry "kids_mode": {"pin": "2580", "shows": [...], "apps": [...]}. On the
TV that person's home is one shelf of big posters, each opening straight into its show, plus the
few apps listed. Leaving the profile, or reaching settings, needs the parent PIN.

The PIN is never handed to a page. What the TV gets is a salted hash (PIN_ROUNDS rounds of SHA-256,
the same sum kids.js does), and the bridge checks a typed PIN against that same hash. A four digit
PIN behind a hash is still only ten thousand guesses for a computer: it keeps a child at the TV with
a remote out, it is not a password against someone on the Wi-Fi with a laptop. The docs say so.

The phone remote can change the shelf (add, remove), the allowed apps and the PIN, always with the
PIN, and can make someone a kids profile. Those changes are kept in data/kids.json, which wins over
config.json from then on (like data/people.json). Delete it to start again from config.json.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import tempfile
import time

import apps
import config

PIN_ROUNDS = 4000
PIN_RE = re.compile(r"\d{4,8}")
MAX_SHOWS = 24
MAX_APPS = 6
KIDS_FILE = os.path.join(config.DATA, "kids.json")
# wrong PINs: this many in WRONG_WINDOW seconds from one address, and that address waits
WRONG_MAX, WRONG_WINDOW = 5, 300
_wrong = {}   # address -> [times]
_warned = set()   # people whose config.json kids_mode was skipped, said once


# ---------- the PIN ----------
def pin_hash(pin, salt, rounds=PIN_ROUNDS):
    """Hex of SHA-256 applied `rounds` times, starting from "salt:pin" (kids.js does the same)."""
    h = f"{salt}:{pin}".encode()
    for _ in range(rounds):
        h = hashlib.sha256(h).digest()
    return h.hex()


def good_pin(pin):
    return isinstance(pin, (str, int)) and not isinstance(pin, bool) and bool(PIN_RE.fullmatch(str(pin)))


def locked_out(addr, now=None):
    now = now or time.time()
    times = [t for t in _wrong.get(addr, []) if now - t < WRONG_WINDOW]
    if times:
        _wrong[addr] = times
    else:
        _wrong.pop(addr, None)
    return len(times) >= WRONG_MAX


def wrong_pin(addr, now=None):
    _wrong.setdefault(addr, []).append(now or time.time())
    while len(_wrong) > 256:   # bounded: the oldest address goes
        _wrong.pop(next(iter(_wrong)))


# ---------- shows and apps ----------
def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:40]


def _int(v, hi):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= hi and not isinstance(v, bool) else None


LINK_RE = re.compile(r"^(?:intent://|https://|[a-z][a-z0-9+.-]{1,30}://)[^\s\"'<>]{1,1500}$")
POSTER_RE = re.compile(r"^https://[^\s\"'<>()]{1,500}$")


def clean_show(s):
    """One shelf show, or None. A plain string is a title."""
    if isinstance(s, str):
        s = {"title": s}
    if not isinstance(s, dict):
        return None
    title = " ".join(str(s.get("title") or "").split())[:80]
    if not title:
        return None
    out = {"title": title}
    svc = s.get("service")
    if isinstance(svc, str) and svc.strip():
        svc = svc.strip().lower()
        app = apps.BY_ID.get(svc) or apps.BY_PACKAGE.get(s["service"].strip())
        if app:
            out["service"] = app["id"]
    season = _int(s.get("season"), 99)
    if season:
        out["season"] = season
        episode = _int(s.get("episode"), 999)
        if episode:
            out["episode"] = episode
    for key, rx in (("poster", POSTER_RE), ("backdrop", POSTER_RE), ("link", LINK_RE)):
        v = s.get(key)
        if isinstance(v, str) and rx.match(v.strip()):
            out[key] = v.strip()
    pkg = s.get("package")
    if isinstance(pkg, str) and re.fullmatch(r"[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+", pkg):
        out["package"] = pkg
    out["id"] = _slug("-".join(str(x) for x in (title, out.get("service", ""), season or "", out.get("episode", "")) if x))
    return out


def clean_shows(items):
    out, ids = [], set()
    for s in items if isinstance(items, list) else []:
        c = clean_show(s)
        if c and c["id"] not in ids:
            ids.add(c["id"])
            out.append(c)
        if len(out) >= MAX_SHOWS:
            break
    return out


def clean_apps(items):
    """Package names, from app ids ("abc-iview") or package names ("au.net.abc.iview")."""
    out = []
    for a in items if isinstance(items, list) else []:
        if not isinstance(a, str):
            continue
        a = a.strip()
        app = apps.BY_ID.get(a.lower())
        pkg = app["package"] if app else a
        if re.fullmatch(r"[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+", pkg) and pkg not in out and pkg != "com.android.tv.settings":
            out.append(pkg)
        if len(out) >= MAX_APPS:
            break
    return out


# ---------- where kids mode comes from: config.json, then data/kids.json ----------
def _read():
    try:
        with open(KIDS_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(data):
    folder = os.path.dirname(KIDS_FILE)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, KIDS_FILE)


def house_salt():
    """One salt for the PINs written in config.json, made once and kept in data/kids.json, so the
    TV's copy of the home does not change every time the bridge restarts."""
    data = _read()
    salt = data.get("salt")
    if not (isinstance(salt, str) and re.fullmatch(r"[0-9a-f]{16,64}", salt)):
        data["salt"] = salt = secrets.token_hex(12)
        _write(data)
    return salt


def _from_config():
    """{person id: kids_mode} from config.json, PINs hashed. A kids_mode with no good PIN is skipped."""
    out = {}
    for p in config.CONFIG.get("people") or []:
        if not isinstance(p, dict) or not isinstance(p.get("kids_mode"), dict):
            continue
        km, pid = p["kids_mode"], p.get("id")
        if not isinstance(pid, str):
            continue
        if not good_pin(km.get("pin")):
            if pid not in _warned:   # once, and never on stdout (home-config.py prints the config there)
                _warned.add(pid)
                print(f"kids mode for {pid}: needs a \"pin\" of 4 to 8 digits in config.json, so it stays off",
                      file=sys.stderr)
            continue
        salt = house_salt()
        out[pid] = {"pin_hash": pin_hash(str(km["pin"]), salt), "pin_salt": salt,
                    "shows": clean_shows(km.get("shows")), "apps": clean_apps(km.get("apps"))}
    return out


def modes():
    """{person id: {pin_hash, pin_salt, shows, apps}} for the people on the list now."""
    base = _from_config()
    saved = _read().get("people") or {}
    out = {}
    for pid in config.PEOPLE_IDS:
        m = dict(base.get(pid) or {})
        s = saved.get(pid) if isinstance(saved.get(pid), dict) else {}
        if s.get("off"):
            continue
        if isinstance(s.get("pin_hash"), str) and isinstance(s.get("pin_salt"), str):
            m["pin_hash"], m["pin_salt"] = s["pin_hash"], s["pin_salt"]
        if "shows" in s:
            m["shows"] = clean_shows(s["shows"])
        if "apps" in s:
            m["apps"] = clean_apps(s["apps"])
        if m.get("pin_hash"):
            m.setdefault("shows", [])
            m.setdefault("apps", [])
            out[pid] = m
    return out


def mode(pid):
    return modes().get(pid) if pid else None


def is_kid(pid):
    return bool(mode(pid))


def verify(pid, pin):
    m = mode(pid)
    if not m or not good_pin(pin):
        return False
    return hmac.compare_digest(pin_hash(str(pin), m["pin_salt"]), m["pin_hash"])


def _save_person(pid, **fields):
    data = _read()
    people = data.get("people") if isinstance(data.get("people"), dict) else {}
    rec = people.get(pid) if isinstance(people.get(pid), dict) else {}
    rec.update(fields)
    people[pid] = rec
    data["people"] = people
    _write(data)


def set_shows(pid, shows):
    _save_person(pid, shows=clean_shows(shows), off=False)


def set_apps(pid, pkgs):
    _save_person(pid, apps=clean_apps(pkgs), off=False)


def set_pin(pid, pin):
    salt = secrets.token_hex(12)
    _save_person(pid, pin_hash=pin_hash(str(pin), salt), pin_salt=salt, off=False)


def turn_on(pid, pin):
    """Make someone a kids profile from the phone (an empty shelf until shows are added)."""
    salt = secrets.token_hex(12)
    data = _read().get("people") or {}
    had = data.get(pid) if isinstance(data.get(pid), dict) else {}
    _save_person(pid, pin_hash=pin_hash(str(pin), salt), pin_salt=salt, off=False,
                 shows=had.get("shows", []), apps=had.get("apps", []))


def turn_off(pid):
    _save_person(pid, off=True)


# ---------- what pages may see ----------
PUBLIC_SHOW = ("id", "title", "service", "season", "episode", "poster", "backdrop", "link", "package")


def public_show(s, art=None):
    out = {k: s[k] for k in PUBLIC_SHOW if k in s}
    for k in ("poster", "backdrop", "service"):
        if k not in out and art and art.get(k):
            out[k] = art[k]
    app = apps.BY_ID.get(out.get("service") or "")
    if app:
        out.setdefault("package", app["package"])
        out["app"] = {"id": app["id"], "name": app["name"], "package": app["package"]}
    return out


# posters found for titles with none, by lower case title (filled by enrich(), read by attach())
art = {}


def public_mode(m):
    """The kids_mode a page gets: the shelf, the apps and the PIN's hash. Never the PIN."""
    return {"shows": [public_show(s, art.get(s["title"].lower())) for s in m["shows"]],
            "apps": list(m["apps"]), "pin_hash": m["pin_hash"], "pin_salt": m["pin_salt"],
            "pin_rounds": PIN_ROUNDS}


def attach(people):
    """Copies of the people list, with "kids_mode" on each kids profile (config.public uses this)."""
    ms = modes()
    return [{**p, "kids_mode": public_mode(ms[p["id"]])} if p.get("id") in ms else dict(p) for p in people]


async def enrich(shows, find):
    """Find a poster for each show that has none (finder.find, cached in `art`). A near name is
    another show, so only an exact title match counts: no picture beats the wrong one."""
    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()
    for s in shows:
        key = s["title"].lower()
        if s.get("poster") or key in art:
            continue
        art[key] = {}
        try:
            best, _ = await find(s["title"])
        except Exception:
            continue
        if best and norm(best.get("title")) == norm(s["title"]):
            art[key] = {"poster": best.get("poster"), "backdrop": best.get("backdrop")}
            # no app named: the first free or subscription app it streams on, so the TV never
            # lands a child on a rent or buy page
            got = None if s.get("service") else link_for(best, s)
            if got:
                art[key]["service"] = got["service"]


def link_for(best, show, ep_info=None):
    """For a TV with no computer (option A): the app and the link that opens this show, chosen the
    way the bridge's play() chooses (a free or subscription offer, never rent or buy). None if none."""
    want = show.get("service")
    for p in best.get("providers") or []:
        app = apps.BY_ID.get(p.get("service"))
        if not app or p.get("kind") in ("rent", "buy") or (want and p["service"] != want):
            continue
        link = p.get("deeplink")
        if app.get("use_web") and p.get("web"):
            m = re.match(app["use_web"], p["web"])
            if m:
                link = m.group(1)
        if ep_info:
            ep = next((x.get("deeplink") for x in ep_info.get("providers") or [] if x.get("service") == app["id"]), None)
            link = ep or link
        if app.get("deeplink") != "jw":
            link = None   # this app takes no show links: only the app opens
        return {"service": app["id"], "package": app["package"], "link": link}
    return None
