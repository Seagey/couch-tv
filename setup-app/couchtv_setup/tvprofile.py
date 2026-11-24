"""What kind of TV this is, in the words Couch TV Studio already uses, so the editor can pick the TV
by itself and show only the designs and widgets that work on it (owner, 24 Nov 2026).

The object ("tv profile", documented in coord/HOME-DETAILS-PAYLOAD.md):

    {"v": 1, "source": "adb" | "guess",
     "platform": "Google TV" | "Android TV" | "Fire OS" | "Tizen" | "webOS" | ...,  (widget-caps keys)
     "brand": "TCL",            Studio's speed bar brand name (tvs.js BRANDS), or "" when not one of them
     "maker": "TCL", "model": "Smart TV Pro",
     "android": "14", "sdk": 34,
     "memMb": 1843,             total memory Android sees (the same number the TV sends as tv.mem)
     "res": "1920x1080",        the screen size Android draws at (wm size, the override if there is one)
     "cls": "b",                Studio's speed class guess from the memory (a to d), only a guess
     "homeRole": true,          Android lets this app hold the Home role (Android 10 or newer, not Fire OS)
     "couchtv": "0.13.12",      Couch TV's version on the TV once installed, else null
     "apps": ["com.netflix.ninja", ...]}   package names of the apps that have a launcher icon (max 300)

Reading it from a connected TV only runs getprop, cat /proc/meminfo, wm size, pm list features and
cmd role and two query-activities lists of launcher apps: nothing on the TV changes. Apps are package
names only, never data or accounts (Android keeps what you are signed into inside each app). A TV found only by its name on the Wi-Fi gets a best guess.
"""
import re

MAX_APPS = 300
PKG_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+")
APP_QUERIES = tuple(
    f"pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.{c}"
    for c in ("LEANBACK_LAUNCHER", "LAUNCHER"))
OWN_PACKAGES = ("dev.couchtv.ontv", "app.couchtv.launcher")

PLATFORM_KEYS = ("Google TV", "Android TV", "Fire OS", "Tizen", "webOS", "Roku OS", "VIDAA", "Titan OS")

# maker as Android reports it (ro.product.manufacturer or brand, lower case) to Studio's brand name
BRANDS = [("tcl", "TCL"), ("sony", "Sony Bravia"), ("hisense", "Hisense"), ("toshiba", "Toshiba"),
          ("philips", "Philips"), ("tpvision", "Philips"), ("xiaomi", "Xiaomi"), ("nvidia", "Nvidia Shield"),
          ("amazon", "Amazon Fire TV"), ("google", "Google (Chromecast, Google TV Streamer)"),
          ("onn", "Walmart onn"), ("kogan", "Kogan"), ("panasonic", "Panasonic"), ("samsung", "Samsung (Tizen)"),
          ("lg electronics", "LG (webOS)"), ("lge", "LG (webOS)")]


def studio_brand(*words):
    text = " ".join(w for w in words if w).lower()
    for key, name in BRANDS:
        if re.search(rf"\b{re.escape(key)}\b", text):
            return name
    return ""


def speed_class(mem_mb):
    """Studio's classes (tvs.js): a about 1 to 1.5 GB, b about 2 GB, c 2 to 4 GB. "d" needs big cores
    that memory alone cannot show, so it is never guessed."""
    if not mem_mb:
        return "b"
    if mem_mb < 1700:
        return "a"
    if mem_mb < 2800:
        return "b"
    return "c"


def mem_mb(meminfo):
    m = re.search(r"MemTotal:\s+(\d+)\s*kB", meminfo or "")
    if not m:
        return None
    mb = int(m.group(1)) // 1024
    return mb if 64 <= mb <= 65536 else None


def screen(wm_size):
    """wm size answers "Physical size: 1920x1080", plus "Override size: ..." when set: the override wins."""
    found = dict(re.findall(r"(Physical|Override) size:\s*(\d{3,5}x\d{3,5})", wm_size or ""))
    return found.get("Override") or found.get("Physical")


def platform_of(facts):
    if facts.get("fire"):
        return "Fire OS"
    if facts.get("google_tv"):
        return "Google TV"
    return "Android TV"


def parse_apps(*outputs):
    """Package names from `pm query-activities --brief` answers ("com.netflix.ninja/.MainActivity" lines,
    with "priority=0 ..." lines between). Leanback apps first, no repeats, Couch TV itself left out,
    at most MAX_APPS, and only names that look like Android package names."""
    seen = {}
    for out in outputs:
        for line in (out or "").splitlines():
            pkg = line.strip().split("/", 1)[0] if "/" in line else ""
            if len(pkg) <= 200 and PKG_RE.fullmatch(pkg) and pkg not in OWN_PACKAGES:
                seen.setdefault(pkg, None)
    return list(seen)[:MAX_APPS]


def clean_apps(apps):
    if not isinstance(apps, list):
        return []
    return parse_apps("\n".join(a + "/x" for a in apps if isinstance(a, str)))


def from_facts(facts, meminfo="", wm_size="", role_out="", apps=None):
    """The profile from steps.facts() and three read only answers from the TV."""
    sdk = int(facts.get("sdk") or 0)
    mem = mem_mb(meminfo)
    role_ok = sdk >= 29 and not facts.get("fire") and "add-role-holder" in (role_out or "")
    installed = (facts.get("installed") or {}).get("home")
    return {
        "v": 1, "source": "adb", "platform": platform_of(facts),
        "brand": studio_brand(facts.get("maker"), facts.get("brand")),
        "maker": facts.get("maker") or "", "model": facts.get("model") or "",
        "android": str(facts.get("android") or ""), "sdk": sdk or None,
        "memMb": mem, "res": screen(wm_size), "cls": speed_class(mem),
        "homeRole": bool(role_ok), "couchtv": installed or None,
        "apps": clean_apps(apps),
    }


def read(tv, facts):
    """Asks the connected TV (read only) and builds the profile."""
    def ask(cmd):
        try:
            return tv.shell(cmd)
        except Exception:
            return ""
    return from_facts(facts, ask("cat /proc/meminfo"), ask("wm size"),
                      ask("cmd role help"), parse_apps(*[ask(q) for q in APP_QUERIES]))


def guess(row):
    """A best guess for a TV found on the Wi-Fi but not connected: from what it announced."""
    row = row or {}
    other = row.get("other")
    maker, model = row.get("maker") or "", row.get("model") or ""
    if other:
        platform = other
    elif row.get("remote") or row.get("wireless_debugging") or row.get("pairing_port"):
        # Android TV Remote is on both; Google TV is far more common on anything sold since 2021
        platform = "Google TV"
    elif row.get("adb_5555"):
        platform = "Android TV"
    else:
        platform = None
    return {"v": 1, "source": "guess", "platform": platform,
            "brand": studio_brand(maker, model, row.get("name"), row.get("announced")),
            "maker": maker, "model": model, "android": "", "sdk": None, "memMb": None, "res": None,
            "cls": "b", "homeRole": None, "couchtv": None, "apps": []}


def clean(p):
    """Only the known keys, with safe types, before it leaves this computer."""
    if not isinstance(p, dict):
        return None
    s = lambda v, n=40: re.sub(r"[\x00-\x1f\x7f<>]", "", str(v))[:n] if v not in (None, "") else ""
    out = {"v": 1, "source": "adb" if p.get("source") == "adb" else "guess",
           "platform": p.get("platform") if p.get("platform") in PLATFORM_KEYS else None,
           "brand": s(p.get("brand"), 60), "maker": s(p.get("maker")), "model": s(p.get("model")),
           "android": s(p.get("android"), 8),
           "sdk": p.get("sdk") if isinstance(p.get("sdk"), int) and 1 <= p["sdk"] <= 99 else None,
           "memMb": p.get("memMb") if isinstance(p.get("memMb"), int) and 64 <= p["memMb"] <= 65536 else None,
           "res": p.get("res") if isinstance(p.get("res"), str) and re.fullmatch(r"\d{3,5}x\d{3,5}", p["res"]) else None,
           "cls": p.get("cls") if p.get("cls") in ("a", "b", "c", "d") else "b",
           "homeRole": p.get("homeRole") if isinstance(p.get("homeRole"), bool) else None,
           "couchtv": s(p.get("couchtv"), 20) or None,
           "apps": clean_apps(p.get("apps"))}
    sp = p.get("speed")
    if isinstance(sp, dict):
        n = lambda v, hi: v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= hi else None
        out["speed"] = {"measured": True, "cls": sp.get("cls") if sp.get("cls") in ("a", "b", "c", "d") else None,
                        "frames": n(sp.get("frames"), 100000), "janky": n(sp.get("janky"), 100000),
                        "p50": n(sp.get("p50"), 5000), "p90": n(sp.get("p90"), 5000), "p99": n(sp.get("p99"), 5000),
                        "seconds": n(sp.get("seconds"), 120), "cores": n(sp.get("cores"), 64), "mhz": n(sp.get("mhz"), 10000),
                        "soc": s(sp.get("soc")) or None, "gpu": s(sp.get("gpu"), 80) or None}
        if out["speed"]["cls"]:
            out["cls"] = out["speed"]["cls"]   # measured beats the guess from memory
    return out
