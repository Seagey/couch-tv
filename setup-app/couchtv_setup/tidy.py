"""The optional "Tidy up your TV" step. Three switches, all off until the person turns one on, and a
read only check of how smoothly the TV draws:

  ads   fewer ads and less tracking: pm disable-user on the ad, viewing and report apps this TV has
        (the sourced list in privacylist.py, filtered like tv-home/tools/apply.sh's needed())
  anim  shorter menu animations: the three Android animation scales set to 0.5
  idle  stop idle screen adverts: the ambient mode app switched off (Google TV only)

Rules every change follows:
- Nothing is deleted or uninstalled. Apps are only switched off (pm disable-user) and switched back on.
- The old value is noted FIRST, on this computer (and then on the TV), and only then is anything changed,
  so a crash half way is recoverable. An unset setting is noted as UNSET and put back by deleting it.
- Every change is read back. If the TV refused, the result says so and the half done change is undone.
- Putting things back (a switch turned off, Undo all, or Couch TV's removal) only touches what is still
  as this step left it. A setting the person changed since is left alone.
- Nothing here says the TV got faster, or that there are no ads or no tracking.

All arguments that reach the TV's shell are either fixed in this file or checked against a strict
pattern first: package names against steps.PKG_RE, setting names against SETTINGS, values against VAL_RE.
"""
import json
import os
import re
import threading
import time

from . import health, paths, steps
from .privacylist import PRIVACY
from .tv import TvError

SETTINGS = {                      # name in Settings.Global -> the value this step sets
    "window_animation_scale": "0.5",
    "transition_animation_scale": "0.5",
    "animator_duration_scale": "0.5",
}
UNSET = "UNSET"
VAL_RE = re.compile(r"^-?[0-9]{1,4}(\.[0-9]{1,4})?$")
RECORD_FILE = steps.RECORD_DIR + "/tidy"           # on the TV, one token per line
SWITCHES = ("ads", "anim", "idle")
IDLE_PKGS = steps.AMBIENT_PKGS     # Google TV's ambient mode, and Android TV's Backdrop screen
IDLE_PKG = steps.AMBIENT
SECURE = {"secure.screensaver_enabled": "0"}      # Settings.Secure, used only when the TV refuses to switch the app off
ALLOWED = set(SETTINGS) | set(SECURE)
COMP_RE = re.compile(r"^[A-Za-z0-9_.$/,{}:-]{1,300}$")
ADS_PKGS = [p for p, _ in PRIVACY]
KIND_WORDS = {"ads": "ad", "viewing": "viewing", "reports": "report"}
LOCK = threading.RLock()
_LAST_SPEED = {}                  # serial -> the last speed check this run, for "earlier"

# What Couch TV, updates, Cast, voice, the remote and the TV's home need: apply.sh's second block of
# needed() (the remote, voice, Keep watching), plus updates, Cast and the TV's inputs. Matched on top of
# steps.needed(), which is apply.sh's first block (and the persistent flag).
_NEEDS = re.compile(
    r"bluetooth|pair|\.ble|remote|rcu|voice|assistant|katniss|vizzini|cec|inputmethod|\.ime$|inputdevice|"
    r"providers\.tv|tvinput|tvprovider|listings|watchnext|watch_next|"
    r"launcher|tvhome|wraith|oobe|systemui|vending|venezia|gms|gsf|recommend|channel|tuner|livetv|"
    r"(^|[._])(ota|update|updater|upgrade)($|[._])|systemupdate|mediashell|cast|webview|keyboard|devicecontrol",
    re.I)
EXTRA_NEVER = {"com.quickplay.android.bellmediaplayer", "com.google.android.tungsten.setupwraith"}


def protected(tv, pkg, homes):
    """True when this package must never be switched off, whatever any list says."""
    if not steps.PKG_RE.match(pkg or ""):
        return True
    if pkg in EXTRA_NEVER or pkg.startswith(("app.couchtv.", "dev.couchtv.")):
        return True
    if _NEEDS.search(pkg):
        return True
    return steps.needed(tv, pkg, homes)


def _homes(tv):
    homes = {l.split("/", 1)[0] for l in steps._lines(tv.shell(steps.QUERY_HOMES)) if "/" in l}
    return homes | set(steps.STOCK_HOMES)


# ---- the record: computer first, then the TV ----

def _local_path():
    return paths.data() / "tidy.json"


def _local_all():
    try:
        data = json.loads(_local_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _clean(rec):
    """Only well formed entries: a record file on the TV is data, never trusted."""
    out = {"settings": {}, "pkgs": []}
    for name, v in ((rec or {}).get("settings") or {}).items():
        if name in ALLOWED and isinstance(v, dict) and isinstance(v.get("prev"), str) and isinstance(v.get("set"), str) \
                and (v["prev"] == UNSET or VAL_RE.match(v["prev"])) and VAL_RE.match(v["set"]):
            out["settings"][name] = {"prev": v["prev"], "set": v["set"]}
    for p in (rec or {}).get("pkgs") or []:
        if isinstance(p, str) and steps.PKG_RE.match(p) and p not in out["pkgs"]:
            out["pkgs"].append(p)
    return out


def _parse_tv(text):
    rec = {"settings": {}, "pkgs": []}
    for line in steps._lines(text):
        parts = line.split(":")
        if len(parts) == 4 and parts[0] == "S":
            rec["settings"][parts[1]] = {"prev": parts[2], "set": parts[3]}
        elif len(parts) == 2 and parts[0] == "P":
            rec["pkgs"].append(parts[1])
    return _clean(rec)


def load(tv):
    """Everything this step changed on this TV, from this computer and from the TV (either may be missing:
    the record may come from an earlier session, or from another computer)."""
    here = _clean(_local_all().get(steps.serial(tv)))
    there = _parse_tv(tv.shell(f"cat {RECORD_FILE} 2>/dev/null"))
    settings = dict(there["settings"])
    settings.update(here["settings"])
    return {"settings": settings, "pkgs": list(dict.fromkeys(here["pkgs"] + there["pkgs"]))}


def save(tv, rec):
    """Writes the computer's copy (atomically, to disk) and then the TV's. Raises before the caller changes
    anything if either fails."""
    rec = _clean(rec)
    all_ = _local_all()
    if rec["settings"] or rec["pkgs"]:
        all_[steps.serial(tv)] = rec
    else:
        all_.pop(steps.serial(tv), None)
    path = _local_path()
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(all_, indent=1))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    tokens = [f"S:{n}:{v['prev']}:{v['set']}" for n, v in rec["settings"].items()] + [f"P:{p}" for p in rec["pkgs"]]
    if tokens:
        tv.shell(f"mkdir -p {steps.RECORD_DIR}; printf '%s\\n' {' '.join(tokens)} > {RECORD_FILE}")
    else:
        tv.shell(f"rm -f {RECORD_FILE}")


def has_record(tv):
    rec = load(tv)
    return bool(rec["settings"] or rec["pkgs"])


# ---- reading the TV ----

def _get(tv, name):
    """The setting's value, UNSET when it has none, None when the TV's answer is not a setting value."""
    if name not in ALLOWED:
        return None
    out = tv.shell(f"settings get {_ns(name)}").strip()
    if out == "null":
        return UNSET
    return out if VAL_RE.match(out) else None


def _same(a, b):
    if a is None or b is None:
        return False
    if a == UNSET or b == UNSET:
        return a == b
    return abs(float(a) - float(b)) < 1e-6


def _ns(name):
    """"secure.screensaver_enabled" -> "secure screensaver_enabled"; a plain name is a Settings.Global one."""
    return "secure " + name[7:] if name.startswith("secure.") else "global " + name


def _put(tv, name, value):
    if name not in ALLOWED:
        return
    if value == UNSET:
        tv.shell(f"settings delete {_ns(name)}")
    else:
        tv.shell(f"settings put {_ns(name)} {value}")


def _disabled(tv):
    return steps._packages(tv, "-d")


def _ads_candidates(tv):
    present = steps._packages(tv)
    homes = _homes(tv)
    kinds = dict(PRIVACY)
    return [(p, kinds[p]) for p in ADS_PKGS if p in present and not protected(tv, p, homes)]


def _idle_pkgs(tv):
    """The idle screen apps this TV has (Google TV's ambient mode, Android TV's Backdrop) that may be switched off."""
    present = steps._packages(tv)
    homes = _homes(tv)
    return [p for p in IDLE_PKGS if p in present and not protected(tv, p, homes)]


def _idle_present(tv):
    return bool(_idle_pkgs(tv))


def _idle_ours(tv, rec, disabled):
    srec = steps.record(tv)["disabled"]
    return any(p in disabled and (p in rec["pkgs"] or p in srec) for p in IDLE_PKGS) or \
        ("secure.screensaver_enabled" in rec["settings"] and _same(_get(tv, "secure.screensaver_enabled"), "0"))


def _clip(text):
    """One line from the TV, only if it looks like a setting value or a component name."""
    t = (text or "").strip().splitlines()[0].strip() if (text or "").strip() else ""
    return t if COMP_RE.match(t) else ("not set" if t in ("", "null") else "unreadable")


def idle_report(tv):
    """What the TV says about its idle screen right now: the screen saver component(s) it is set to, whether the
    screen saver is on, the app(s) of ours that are switched off, and what is dreaming (read only)."""
    disabled = _disabled(tv)
    present = steps._packages(tv)
    dream = tv.shell("dumpsys dreams")
    m = re.search(r"mCurrentDream(?:Name|Component)=(?:ComponentInfo\{)?([A-Za-z0-9_.$]+/[A-Za-z0-9_.$]+)", dream or "")
    return {"components": _clip(tv.shell("settings get secure screensaver_components")),
            "enabled": _clip(tv.shell("settings get secure screensaver_enabled")),
            "off": [p for p in IDLE_PKGS if p in present and p in disabled],
            "on": [p for p in IDLE_PKGS if p in present and p not in disabled],
            "dreaming": m.group(1) if m else "nothing"}


# ---- the screen's state ----

def state(tv):
    """What to show: only the switches this TV can do, whether each is on (as this step left it), and whether
    there is anything to undo."""
    rec = load(tv)
    disabled = _disabled(tv)
    out = []
    cands = _ads_candidates(tv)
    ours = [p for p, _ in cands if p in rec["pkgs"] and p in disabled]
    left = [(p, k) for p, k in cands if p not in disabled]
    if left or ours:
        out.append({"id": "ads", "on": bool(ours), "count": len(left) + len(ours),
                    "kinds": sorted({KIND_WORDS[k] for _, k in left + [c for c in cands if c[0] in ours]})})
    cur = {n: _get(tv, n) for n in SETTINGS}
    if all(v is not None for v in cur.values()):
        on = all(n in rec["settings"] and _same(cur[n], SETTINGS[n]) for n in SETTINGS)
        already = all(_same(cur[n], SETTINGS[n]) for n in SETTINGS)
        if on or not already:
            out.append({"id": "anim", "on": on})
    if _idle_present(tv):
        on = _idle_ours(tv, rec, disabled)
        if on or any(p not in disabled for p in _idle_pkgs(tv)):
            out.append({"id": "idle", "on": on})
    return {"switches": out, "speed": steps.HOME_PKG in steps._packages(tv),
            "undo": bool(rec["settings"] or rec["pkgs"] or _idle_ours(tv, rec, disabled))}


# ---- turning a switch on ----

def _on_anim(tv, rec):
    cur = {n: _get(tv, n) for n in SETTINGS}
    if any(v is None for v in cur.values()):
        return {"status": "unsupported", "words": "This TV does not show these settings."}
    todo = [n for n in SETTINGS if not (n in rec["settings"] and _same(cur[n], SETTINGS[n]))
            and not _same(cur[n], SETTINGS[n])]
    if not todo:
        return {"status": "unchanged", "words": "Already set this way. Nothing changed."}
    for n in todo:
        rec["settings"][n] = {"prev": cur[n], "set": SETTINGS[n]}     # noted first, with the old value
    save(tv, rec)
    for n in todo:
        _put(tv, n, SETTINGS[n])
    bad = [n for n in todo if not _same(_get(tv, n), SETTINGS[n])]
    if not bad:
        return {"status": "done", "words": "Menu animations now play for half as long. Checked on the TV."}
    for n in todo:                                  # put back whatever did change
        if _same(_get(tv, n), SETTINGS[n]):
            _put(tv, n, cur[n])
        if _same(_get(tv, n), cur[n]):
            rec["settings"].pop(n, None)
    save(tv, rec)
    return {"status": "refused", "words": "The TV refused this change. Settings are as they were.",
            "refused": len(bad)}


def _disable_pkgs(tv, rec, pkgs):
    """Notes them, switches them off, reads back. Returns (switched off, refused)."""
    for p in pkgs:
        if p not in rec["pkgs"]:
            rec["pkgs"].append(p)
    save(tv, rec)
    for p in pkgs:
        tv.shell(f"pm disable-user --user 0 {p}")
    now = _disabled(tv)
    ok = [p for p in pkgs if p in now]
    bad = [p for p in pkgs if p not in now]
    if bad:
        rec["pkgs"] = [p for p in rec["pkgs"] if p not in bad]
        save(tv, rec)
    return ok, bad


def _on_ads(tv, rec):
    disabled = _disabled(tv)
    todo = [p for p, _ in _ads_candidates(tv) if p not in disabled]
    if not todo:
        return {"status": "unchanged", "words": "This TV has none of them left on. Nothing changed."}
    ok, bad = _disable_pkgs(tv, rec, todo)
    if not bad:
        return {"status": "done", "count": len(ok), "words": f"Switched off {len(ok)} apps. Checked on the TV."}
    if ok:
        return {"status": "partial", "count": len(ok), "refused": len(bad),
                "words": f"Switched off {len(ok)}. The TV refused {len(bad)}, which stay on."}
    return {"status": "refused", "refused": len(bad), "words": "The TV refused this change. Nothing was changed."}


def _on_idle(tv, rec):
    if not _idle_present(tv):
        return {"status": "unsupported", "words": "This TV does not have an idle screen to switch off."}
    disabled = _disabled(tv)
    todo = [p for p in _idle_pkgs(tv) if p not in disabled]
    if not todo:
        return {"status": "unchanged", "words": "Already off. Nothing changed."}
    ok, bad = _disable_pkgs(tv, rec, todo)
    if not bad:
        rep = idle_report(tv)
        return {"status": "done", "report": rep,
                "words": "The idle screen app is switched off. Checked on the TV."}
    # The TV kept the app on. Try the screen saver setting itself, note it first, and read both back.
    cur = _get(tv, "secure.screensaver_enabled")
    took = False
    if cur is not None and not _same(cur, "0"):
        rec["settings"]["secure.screensaver_enabled"] = {"prev": cur, "set": "0"}
        save(tv, rec)
        _put(tv, "secure.screensaver_enabled", "0")
        took = _same(_get(tv, "secure.screensaver_enabled"), "0")
        if not took:
            _put(tv, "secure.screensaver_enabled", cur)
            rec["settings"].pop("secure.screensaver_enabled", None)
            save(tv, rec)
    rep = idle_report(tv)
    if took or ok:
        return {"status": "partial", "report": rep,
                "words": "The TV would not switch the idle screen app off. "
                         + ("Its screen saver setting is off now, but a TV can ignore that. " if took else "")
                         + "If adverts still show, tell us."}
    return {"status": "refused", "report": rep, "words": "The TV refused this change. Nothing was changed."}


# ---- putting things back ----

def _restore_settings(tv, rec, names):
    back = left = refused = 0
    for n in list(names):
        v = rec["settings"].get(n)
        if not v:
            continue
        cur = _get(tv, n)
        if cur is None:
            refused += 1                            # cannot read it now: keep the note, try again later
            continue
        if _same(cur, v["set"]) and not _same(cur, v["prev"]):
            _put(tv, n, v["prev"])
            if not _same(_get(tv, n), v["prev"]):
                refused += 1
                continue
            back += 1
        elif not _same(cur, v["prev"]):
            left += 1                               # the person changed it since: leave it alone
        rec["settings"].pop(n, None)
    return back, left, refused


def _restore_pkgs(tv, rec, pkgs):
    back = refused = 0
    for p in pkgs:
        if p not in rec["pkgs"] or not steps.PKG_RE.match(p):
            continue
        if p not in steps._packages(tv):
            rec["pkgs"].remove(p)
            continue
        if p in _disabled(tv):
            tv.shell(f"pm enable {p}")
            if p in _disabled(tv):
                refused += 1
                continue
            back += 1
        rec["pkgs"].remove(p)
    return back, refused


def _off_words(back, left, refused):
    if refused:
        return "The TV would not put everything back. Try Undo all again."
    if left and not back:
        return "Left alone. You changed it since."
    if left:
        return "Put back. One setting you changed since was left alone."
    return "Back to how it was. Checked on the TV." if back else "Already as it was. Nothing changed."


def _off(tv, rec, which):
    back = left = refused = 0
    if which == "anim":
        back, left, refused = _restore_settings(tv, rec, list(SETTINGS))
    elif which == "ads":
        back, refused = _restore_pkgs(tv, rec, ADS_PKGS)
    elif which == "idle":
        back, refused = _restore_pkgs(tv, rec, list(IDLE_PKGS))
        b2, l2, r2 = _restore_settings(tv, rec, list(SECURE))
        back, left, refused = back + b2, left + l2, refused + r2
        sr = steps.record(tv)                       # switched off by Setup's own plan (older callers)
        for pkg in IDLE_PKGS:
            if pkg in sr["disabled"] and not refused:
                if pkg in _disabled(tv):
                    tv.shell(f"pm enable {pkg}")
                if pkg in _disabled(tv):
                    refused += 1
                else:
                    back += 1 if not back else 0
                    sr["disabled"] = [p for p in sr["disabled"] if p != pkg]
                    steps._write_record(tv, sr)
    save(tv, rec)
    return {"status": "refused" if refused else ("left" if left and not back else "off"),
            "words": _off_words(back, left, refused)}


def restore_all(tv):
    """Undo all, and Couch TV's removal: everything this step changed, back as it was."""
    with LOCK:
        rec = load(tv)
        res = {w: _off(tv, rec, w) for w in SWITCHES}
        return {"results": res, "state": state(tv)}


# ---- the entry points ----

def apply(tv, wants, progress=lambda f, m=None: None):
    """wants: {"ads": True, "anim": False, ...}. True turns a switch on, False puts it back (only if this
    step changed it). A switch left out is not touched. Returns each one's result and the new state."""
    with LOCK:
        steps_todo = [w for w in SWITCHES if isinstance((wants or {}).get(w), bool)]
        out = {}
        for i, w in enumerate(steps_todo):
            progress(i / max(len(steps_todo), 1), "Checking each change on the TV")
            rec = load(tv)
            if wants[w]:
                out[w] = {"ads": _on_ads, "anim": _on_anim, "idle": _on_idle}[w](tv, rec)
            else:
                out[w] = _off(tv, rec, w)
        progress(1.0, "Done")
        return {"results": out, "state": state(tv)}


def _p(frames, key):
    v = (frames or {}).get(key)
    return v if isinstance(v, int) else None


def speed_words(now, earlier=None):
    """Plain words for a speed check. It reports what was measured and nothing more."""
    if not now or (_p(now, "frames") or 0) < 30 or _p(now, "p90") is None:
        return ["Not enough frames to judge. Show the Couch TV home, then try again."]
    words = [f"{now['frames']} frames drawn. Nine in ten took {now['p90']} ms or less."]
    if earlier and _p(earlier, "p90") is not None:
        d = now["p90"] - earlier["p90"]
        words.append("About the same as the earlier check." if abs(d) <= 2 else
                     f"Earlier check: {earlier['p90']} ms. One run proves little.")
    return words


def speed(tv, sleep=time.sleep):
    """Read only. The same check Setup makes after install (health.speed_test), with an earlier one beside it."""
    if steps.HOME_PKG not in steps._packages(tv):
        raise TvError("Couch TV is not on this TV yet. Set it up first, then check.", "no_home")
    key = steps.serial(tv)
    earlier = _LAST_SPEED.get(key)
    now = health.speed_test(tv, sleep=sleep)
    _LAST_SPEED[key] = now
    return {"speed": now, "words": speed_words(now, earlier)}


def route(name, body, tv, run_job):
    """The page's small routes: /api/tidy/<name>. run_job is the server's background job runner."""
    body = body if isinstance(body, dict) else {}
    if name == "state":
        return state(tv)
    if name == "apply":
        wants = {w: body[w] for w in SWITCHES if isinstance(body.get(w), bool)}
        return run_job("tidy", lambda p: apply(tv, wants, p))
    if name == "undo":
        return run_job("tidy", lambda p: restore_all(tv))
    if name == "speed":
        return run_job("tidy-speed", lambda p: speed(tv))
    raise TvError("No such step.", "404")
