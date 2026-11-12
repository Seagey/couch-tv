"""The agentic abilities behind /api/ask (Round 11, 27 Oct 2026).

Eyes and hands (a short summary of what is on screen, a tap by label), installing an app from the
Play Store by name, HDMI inputs, turning the TV off when this episode ends, restarting an app that
is playing up and carrying on, the latest episode of a show, and what two people both like.

The server sets `S` to itself at start up, so everything here uses the server's own TV proxy,
state and helpers (the bridge stays the only thing that talks to the TV).

Hard lines: never pay, never sign up, never type a password. A purchase or sign in screen stops
the job and the person finishes it on the TV. Uninstall only when someone asked for it.
"""
import asyncio
import json
import logging
import os
import re
import time
import urllib.parse
from datetime import datetime, timedelta

from tv import check_package

S = None  # the server module (set by server.py)
log = logging.getLogger("agentic")

HERE = os.path.dirname(os.path.abspath(__file__))


def _tz():
    """The home's time zone (the server names it SYDNEY or HOME_TZ)."""
    return getattr(S, "HOME_TZ", None) or getattr(S, "SYDNEY")


def _input_names_file():
    cfg = getattr(S, "config", None)
    return os.path.join(getattr(cfg, "DATA", None) or os.path.join(HERE, "data"), "input-names.json")


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


# ---------- the screen: ui() and tap() ----------
UI_DUMP = ("uiautomator dump /sdcard/couch-ui.xml >/dev/null 2>&1; cat /sdcard/couch-ui.xml; "
           "rm /sdcard/couch-ui.xml")
STOP_WORDS = re.compile(
    r"\b(sign in|sign-in|log in|login|password|create account|sign up|subscribe|start (?:your )?free trial|"
    r"buy|purchase|payment|add payment|credit card|redeem|verify it'?s you)\b", re.I)
PRICE = re.compile(r"^(?:A\$|US\$|\$|£|€)\s?\d|^\d+[.,]\d\d\s?(?:\$|€|£)?$")


def _attr(node, name):
    m = re.search(rf' {name}="([^"]*)"', node)
    return m.group(1) if m else ""


def _unescape(s):
    return (s.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
            .replace("&lt;", "<").replace("&gt;", ">"))


def parse_ui(xml):
    """Visible labelled things on screen, top to bottom: label, focused, clickable, centre."""
    items, seen = [], set()
    for node in re.findall(r"<node [^>]*>", xml or ""):
        label = _unescape(_attr(node, "text") or _attr(node, "content-desc")).strip()
        focused = _attr(node, "focused") == "true"
        m = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", _attr(node, "bounds"))
        if not m:
            continue
        x1, y1, x2, y2 = map(int, m.groups())
        if x2 <= x1 or y2 <= y1 or x2 <= 0 or y2 <= 0:
            continue
        if not label and not focused:
            continue
        key = (label, x1, y1)
        if key in seen:
            continue
        seen.add(key)
        items.append({"label": label[:80], "focused": focused,
                      "clickable": _attr(node, "clickable") == "true" or _attr(node, "focusable") == "true",
                      "x": (x1 + x2) // 2, "y": (y1 + y2) // 2, "box": (x1, y1, x2, y2),
                      "id": _attr(node, "resource-id").split("/")[-1]})
    # A focused box with no label of its own: name it after the labels inside it.
    for it in items:
        if it["focused"] and not it["label"]:
            x1, y1, x2, y2 = it["box"]
            inner = [o["label"] for o in items if o["label"] and x1 <= o["x"] <= x2 and y1 <= o["y"] <= y2]
            it["label"] = " / ".join(inner[:3])[:80]
    return items


async def ui_items():
    out = await S.tv.adb("shell", UI_DUMP, timeout=20)
    if "<hierarchy" not in out:
        # Video playing can keep uiautomator from ever seeing the screen idle.
        raise RuntimeError("could not read the screen (" + (out.strip().splitlines() or ["no output"])[-1][:80] + ")")
    return parse_ui(out)


def stop_labels(items):
    """Buttons that mean paying, signing up or signing in. Only short pressable labels count, so
    an app's description ("subscribe to watch...") never stops a job."""
    return [i["label"] for i in items
            if PRICE.match(i["label"].strip())
            or (STOP_WORDS.search(i["label"]) and len(i["label"]) <= 40 and (i["clickable"] or i["focused"]))]


def ui_summary(items, front):
    focused = next((i for i in items if i["focused"]), None)
    lines = []
    for i in items[:60]:
        flag = "*" if i["focused"] else ("+" if i["clickable"] else " ")
        lines.append(f"{flag} {i['label']} @{i['x']},{i['y']}")
    stop = stop_labels(items)
    return {"app": S.apps.describe_package(front), "focused": focused["label"] if focused else None,
            "items": lines, "stop_screen": bool(stop), "stop_labels": stop[:5],
            "legend": "* has focus, + can be pressed; @x,y is the centre for tap"}


async def h_ui(request):
    front = await S.tv.front_package()
    try:
        items = await ui_items()
    except RuntimeError as e:
        raise S.ApiError(409, f"{e}. Use now, or a screenshot, instead.")
    return S.ok(**ui_summary(items, front))


async def h_tap(request):
    data = await S.body(request)
    label = (data.get("label") or "").strip()
    items = await ui_items()
    target = None
    if label:
        want = _norm(label)
        target = (next((i for i in items if _norm(i["label"]) == want), None)
                  or next((i for i in items if want and want in _norm(i["label"])), None))
        if not target:
            raise S.ApiError(404, f"nothing on screen says {label}")
    elif "x" in data and "y" in data:
        target = {"label": "", "x": int(data["x"]), "y": int(data["y"])}
    else:
        raise S.ApiError(400, "label (or x and y) is required")
    if target["label"] and (STOP_WORDS.search(target["label"]) or PRICE.match(target["label"])):
        raise S.ApiError(403, f"not pressing {target['label']}: paying, signing up and signing in "
                              "are for the person to do on the TV")
    await S.tv.adb("shell", f"input tap {target['x']} {target['y']}", timeout=8)
    S.record_action(request, "tap", {"label": target["label"] or f"{target['x']},{target['y']}"}, True)
    await asyncio.sleep(1)
    return S.ok(tapped=target["label"] or None, x=target["x"], y=target["y"])


# ---------- installing apps ----------
# Play Store package for an app name. The TV's own catalogue (apps.py) comes first; these are
# the extra ones, checked on the Play Store web listing on 27 Oct 2026.
STORE_EXTRA = [
    (("ted", "ted tv", "ted talks"), "com.ted.android.tv"),
    (("plex",), "com.plexapp.android"),
    (("crunchyroll",), "com.crunchyroll.crunchyroid"),
    (("britbox", "brit box"), "com.britbox.tv"),
    (("youtube music",), "com.google.android.youtube.tvmusic"),
    (("kodi",), "org.xbmc.kodi"),
    (("vlc",), "org.videolan.vlc"),
]
ALIASES = {"disney": "disney-plus", "disney plus": "disney-plus", "prime": "prime-video",
           "amazon": "prime-video", "amazon prime": "prime-video", "apple tv plus": "apple-tv",
           "paramount": "paramount-plus", "paramount plus": "paramount-plus", "max": "hbo-max",
           "hbo": "hbo-max", "hbo max": "hbo-max"}
# Local names, used only when the finder's country is Australia.
ALIASES_AU = {"stan": "stan", "binge": "binge", "iview": "abc-iview", "abc": "abc-iview",
           "abc iview": "abc-iview", "sbs": "sbs-on-demand", "sbs on demand": "sbs-on-demand",
           "foxtel": "foxtel-go", "channel 9": "9now",
           "nine": "9now", "9 now": "9now", "channel 7": "7plus", "seven": "7plus",
           "7 plus": "7plus", "channel 10": "10play", "ten": "10play", "10 play": "10play",
           "tenplay": "10play"}
NEVER_UNINSTALL = {"com.android.vending", "dev.couchtv.ontv",
                   "com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher"}


def resolve_package(name):
    """(package, display name) for an app name, or (None, name) when only a search can tell."""
    raw = (name or "").strip()
    if re.fullmatch(r"[a-zA-Z][\w]*(\.[\w]+)+", raw):
        app = S.apps.BY_PACKAGE.get(raw)
        return raw, app["name"] if app else raw
    want = re.sub(r"^the |\bapp\b", "", _norm(raw)).strip()
    aliases = ALIASES | (ALIASES_AU if getattr(S.finder, "COUNTRY", "AU") == "AU" else {})
    app_id = aliases.get(want)
    app = S.apps.BY_ID.get(app_id) if app_id else None
    if not app:
        app = next((a for a in S.apps.APPS if _norm(a["name"]) == want or a["id"] == want.replace(" ", "-")), None)
    if app and app["id"] not in ("home", "settings"):
        return app["package"], app["name"]
    for names, pkg in STORE_EXTRA:
        if want in names:
            return pkg, raw
    return None, raw


async def _packages():
    out = await S.tv.adb("shell", "pm list packages", timeout=15)
    return {line.split(":", 1)[1].strip() for line in out.splitlines() if ":" in line}


def _button(items, *words):
    words = [w.lower() for w in words]
    for i in items:
        if i["label"].strip().lower().rstrip("…. ") in words:
            return i
    return None


async def install_app(name=None, package=None, wait_s=150):
    started = time.monotonic()
    pkg, shown = (package, package) if package else resolve_package(name)
    before = await _packages()
    if pkg and pkg in before:
        return {"installed": True, "already": True, "package": pkg, "name": shown,
                "note": f"{shown} is already on the TV."}
    if pkg:
        check_package(pkg)
    link = (f"market://details?id={pkg}" if pkg
            else "market://search?q=" + urllib.parse.quote(name or "") + "&c=apps")
    await S.tv.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"'{link}'", timeout=15)
    items, button = [], None
    for _ in range(6):
        await asyncio.sleep(2)
        try:
            items = await ui_items()
        except RuntimeError:
            continue
        button = _button(items, "install", "open", "update", "installing", "pending", "cancel")
        price = next((i for i in items if PRICE.match(i["label"].strip())), None)
        if price and not button:
            return {"installed": False, "stopped": "paid",
                    "note": f"{shown} costs {price['label']} on the Play Store. I never buy apps, so it "
                            "is left on screen for you to decide."}
        if button:
            break
    if not button:
        stop = stop_labels(items)
        why = (f"the Play Store is asking to {stop[0].lower()}, which is for you to do"
               if stop else "I could not find an Install button")
        return {"installed": False, "stopped": "no_button", "screen": ui_summary(items, "com.android.vending"),
                "note": f"Opened the Play Store for {shown}, but {why}."}
    if not pkg:
        # A search: the first result is the one with the Install button; its name is the top label.
        top = next((i for i in items if i["y"] < button["y"] and len(i["label"]) > 2
                    and _norm(i["label"]) != _norm(name) and not i["label"].lower().startswith("search")), None)
        shown = top["label"] if top else shown
    label = button["label"].lower()
    if label.startswith("open"):
        return {"installed": True, "already": True, "package": pkg, "name": shown,
                "note": f"{shown} is already on the TV."}
    if label.startswith("install") or label.startswith("update"):
        if button["focused"]:
            await S.tv.adb("shell", "input keyevent KEYCODE_DPAD_CENTER", timeout=8)
        else:
            await S.tv.adb("shell", f"input tap {button['x']} {button['y']}", timeout=8)
    end = time.monotonic() + wait_s
    tick = 0
    while time.monotonic() < end:
        await asyncio.sleep(3)
        tick += 1
        now_pk = await _packages()
        new = (now_pk - before) if not pkg else ({pkg} & now_pk)
        if new:
            got = pkg or sorted(new)[0]
            await S.installed_packages(max_age=0)
            return {"installed": True, "package": got, "name": shown,
                    "seconds": round(time.monotonic() - started), "note": f"Installed {shown}."}
        if tick % 3 == 0:
            try:
                items = await ui_items()
            except RuntimeError:
                continue
            stop = stop_labels(items)
            if stop:
                return {"installed": False, "stopped": "sign_in_or_payment", "name": shown,
                        "note": f"The Play Store wants something only you can do ({stop[0]}). "
                                "It is on the TV for you to finish."}
            if _button(items, "install") and not _button(items, "installing", "pending", "cancel"):
                b = _button(items, "install")
                await S.tv.adb("shell", f"input tap {b['x']} {b['y']}", timeout=8)
    return {"installed": False, "stopped": "timeout", "name": shown,
            "note": f"{shown} was still installing after {wait_s} s. It will finish by itself."}


async def h_install(request):
    data = await S.body(request)
    if not (data.get("name") or data.get("package")):
        raise S.ApiError(400, "name is required")
    result = await install_app(data.get("name"), data.get("package"))
    S.record_action(request, "install_app", {"name": data.get("name") or data.get("package")},
                    bool(result.get("installed")))
    return S.ok(**result)


async def h_uninstall(request):
    data = await S.body(request)
    pkg, shown = resolve_package(data.get("package") or data.get("name"))
    if not pkg:
        # An app installed from a search: match the name against the installed package names.
        token = _norm(shown).replace(" ", "")
        hits = sorted(p for p in await _packages() if token and token in p.replace(".", "").replace("_", ""))
        pkg = hits[0] if len(hits) == 1 else None
    if not pkg:
        raise S.ApiError(404, f"do not know which app {shown} is")
    keep = set(NEVER_UNINSTALL) | set(S.apps.HOME_PACKAGES)  # the home screen app stays
    try:
        with open(os.path.join(HERE, S.tv.keep_disabled_file or "")) as f:
            keep |= set(json.load(f))
    except (OSError, ValueError):
        pass
    if pkg in keep:
        raise S.ApiError(403, f"{shown} is part of how the TV works, so it stays")
    system = await S.tv.adb("shell", "pm list packages -s", timeout=15)
    if pkg in {line.split(":", 1)[1].strip() for line in system.splitlines() if ":" in line}:
        raise S.ApiError(403, f"{shown} came with the TV and cannot be removed")
    if pkg not in await _packages():
        return S.ok(uninstalled=False, note=f"{shown} is not on the TV.")
    out = await S.tv.adb("shell", f"pm uninstall {check_package(pkg)}", timeout=30)
    done = "Success" in out
    await S.installed_packages(max_age=0)
    S.record_action(request, "uninstall_app", {"name": shown}, done)
    return S.ok(uninstalled=done, package=pkg, note=f"Removed {shown}." if done else out.strip()[:120])


# ---------- HDMI inputs ----------
STATES = {"0": "connected", "1": "standby", "2": "nothing plugged in"}
DEVICE_WORDS = {"playstation": ("playstation", "ps5", "ps4", "ps 5", "ps 4", "sony"),
                "xbox": ("xbox", "microsoft"), "switch": ("nintendo", "switch"),
                "apple tv": ("apple",), "foxtel": ("foxtel", "iq"), "chromecast": ("chromecast",),
                "blu-ray": ("blu", "bluray", "dvd")}
CONSOLE = ("playstation", "ps5", "ps4", "xbox", "switch", "nintendo", "console", "game")


def _saved_names():
    try:
        with open(_input_names_file()) as f:
            return json.load(f).get(S._current.get(), {})
    except (OSError, ValueError):
        return {}


def _save_name(name, input_id):
    try:
        with open(_input_names_file()) as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    data.setdefault(S._current.get(), {})[_norm(name)] = input_id
    os.makedirs(os.path.dirname(_input_names_file()), exist_ok=True)
    with open(_input_names_file(), "w") as f:
        json.dump(data, f, indent=2)


async def list_inputs():
    out = await S.tv.adb("shell", "dumpsys tv_input | grep 'TvInputInfo{id='; echo =====; "
                         "settings get secure tv_input_custom_labels; echo =====; "
                         "settings get secure tv_input_hidden_inputs; echo =====; "
                         "dumpsys hdmi_control | grep 'CEC: logical_address'", timeout=15)
    parts = (out.split("=====") + ["", "", "", ""])[:4]
    labels = {}
    for pair in parts[1].strip().split(":"):
        if "," in pair:
            k, v = pair.split(",", 1)
            labels[urllib.parse.unquote(k)] = urllib.parse.unquote(v)
    hidden = {urllib.parse.unquote(x) for x in parts[2].strip().split(":") if x and x != "null"}
    devices = {}
    for line in parts[3].splitlines():
        m = re.search(r"logical_address: 0x([0-9a-f]+) device_type: (\d+).*display_name: (.*?) power_status: (\d+)"
                      r" physical_address: 0x([0-9a-f]+) port_id: (\d+)", line, re.I)
        if not m or m.group(1) == "00":
            continue
        port = int(m.group(6)) or int(m.group(5)[0], 16)
        devices.setdefault(port, {})[m.group(3).strip()] = {
            "type": {"1": "recorder", "3": "tuner", "4": "player", "5": "audio"}.get(m.group(2), "other"),
            "on": m.group(4) == "0"}
    hdmi = []
    for line in parts[0].splitlines():
        m = re.search(r"TvInputInfo\{id=([^,]+), pkg=([^,]+).*?state: (\d)", line)
        if not m:
            continue
        iid = m.group(1)
        if "hdmi" not in iid.lower():
            continue
        hw = re.search(r"HW(\d+)", iid)
        hdmi.append({"id": iid, "hw": int(hw.group(1)) if hw else 99, "state": STATES.get(m.group(3), m.group(3)),
                     "label": labels.get(iid), "hidden": iid in hidden})
    hdmi.sort(key=lambda x: (x["hw"], x["id"]))
    for n, h in enumerate(hdmi, 1):
        m = re.search(r"HDMI\s*(\d)", h["label"] or "", re.I)
        h["port"] = int(m.group(1)) if m else n
        h["name"] = f"HDMI {h['port']}"
        h["devices"] = [{"name": k, **v} for k, v in devices.get(h["port"], {}).items()]
        del h["hw"]
    return hdmi


def pick_input(inputs, name):
    """(input, how) for what the person said, best guess allowed. None when there is nothing."""
    want = _norm(name)
    saved = _saved_names()
    if want in saved:
        hit = next((i for i in inputs if i["id"] == saved[want]), None)
        if hit:
            return hit, "remembered"
    m = re.search(r"(?:hdmi|input|port)?\s*(\d)\b", want)
    if m and ("hdmi" in want or "input" in want or "port" in want or want.isdigit()):
        hit = next((i for i in inputs if i["port"] == int(m.group(1))), None)
        if hit:
            return hit, "number"
    words = next((w for k, w in DEVICE_WORDS.items() if k in want or any(x in want for x in w)), (want,))
    for i in inputs:
        names = " ".join(_norm(d["name"]) for d in i["devices"]) + " " + _norm(i["label"])
        if any(w and w in names for w in words):
            return i, "device"
    usable = [i for i in inputs if not i["hidden"] and i["state"] != "nothing plugged in"
              and not all(d["type"] == "audio" for d in i["devices"] or [{"type": "x"}])]
    players = [i for i in usable if any(d["type"] == "player" for d in i["devices"])]
    if players:
        return players[0], "guess"
    if usable:
        live = [i for i in usable if i["state"] == "connected"]
        return (live or usable)[0], "guess"
    return None, None


async def h_inputs(request):
    if S.tv.kind == "philips":   # the TV lists its own inputs (bridge/philips.py)
        return S.ok(inputs=[{"id": x["id"], "name": x["name"]} for x in await S.tv.read_sources()], remembered={})
    if S.tv.kind == "vizio":   # the TV lists its own inputs (bridge/vizio.py)
        return S.ok(inputs=await S.tv.read_sources(), remembered={})
    inputs = await list_inputs()
    saved = {k: next((i["name"] for i in inputs if i["id"] == v), v) for k, v in _saved_names().items()}
    return S.ok(inputs=inputs, remembered=saved)


async def h_input(request):
    data = await S.body(request)
    name = (data.get("name") or "").strip()
    if not name:
        raise S.ApiError(400, "name is required (for example playstation, hdmi 2, or home)")
    if _norm(name) in ("home", "tv", "apps", "google tv", "android", "smart tv"):
        await S.tv.key("home")
        S.record_action(request, "input", {"name": "home"}, True)
        return S.ok(input="home", note="Back to the home screen.")
    if S.tv.kind in ("philips", "vizio"):   # an input the TV listed, by its name or id (bridge/philips.py, bridge/vizio.py)
        try:
            src = await S.tv.switch_source(name)
        except ValueError as e:
            raise S.ApiError(404, str(e))
        S.record_action(request, "input", {"name": name, "input": src["name"]}, True)
        return S.ok(input=src["name"], how="listed", switched=True, note=f"Switched to {src['name']}.")
    inputs = await list_inputs()
    hit, how = pick_input(inputs, name)
    if not hit:
        raise S.ApiError(404, "this TV reports no HDMI inputs")
    uri = "content://android.media.tv/passthrough/" + urllib.parse.quote(hit["id"], safe="")
    await S.tv.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"'{uri}'", timeout=15)
    await asyncio.sleep(2)
    front = await S.tv.front_package()
    switched = bool(front) and ("inputplayer" in front or "tvinput" in front or "tvcenter" in front
                                or front not in S.apps.HOME_PACKAGES)
    if data.get("remember_as"):
        _save_name(data["remember_as"], hit["id"])
    elif how == "number" and any(w in _norm(name) for w in CONSOLE):
        _save_name(name, hit["id"])
    dev = ", ".join(d["name"] for d in hit["devices"] if d["type"] != "audio")
    note = f"Switched to {hit['name']}" + (f" ({dev})" if dev else "") + "."
    if how == "guess":
        note += (f" The TV could not tell me where the {name} is, so {hit['name']} is my best guess. "
                 "If it is wrong, say which HDMI it is on and I will remember.")
    if hit["state"] != "connected" and not dev:
        note += " If it says no signal, turn the device on with its own controller or remote."
    S.record_action(request, "input", {"name": name, "input": hit["name"]}, switched)
    return S.ok(input=hit["name"], how=how, switched=switched, note=note)


# ---------- off when this episode ends ----------
watchers = {}  # tv id -> {"task", "base", "threshold", "dry_run", "fired", "armed_at", "reason"}


def episode_over(base, prev, cur, threshold_ms, misses):
    """Why the episode is over, or None. Pure, so it can be tested without a TV.
    base: what was on when armed; prev/cur: two media readings (dicts, cur may be None)."""
    if cur is None or cur.get("state") == "stopped":
        return "playback ended" if misses >= 2 else None
    bt, ct = _norm(base.get("title")), _norm(cur.get("title"))
    if bt and ct and bt != ct:
        return "the next thing started"
    if base.get("episode") and cur.get("episode") and (
            (cur.get("season"), cur.get("episode")) != (base.get("season"), base.get("episode"))):
        return "the next episode started"
    be, ce = _norm(base.get("episode_title")), _norm(cur.get("episode_title"))
    if be and ce and be != ce:
        return "the next episode started"
    pp, cp = (prev or {}).get("position_ms"), cur.get("position_ms")
    if pp is not None and cp is not None and pp > 120000 and cp < 30000:
        return "the next episode started"
    dur = cur.get("duration_ms") or base.get("duration_ms")
    if dur and cp is not None and cp >= dur - threshold_ms:
        return "the credits are rolling"
    return None


def _reading():
    m = S.media_now
    if not m:
        return None
    return {k: m.get(k) for k in ("title", "episode_title", "season", "episode", "state",
                                  "position_ms", "duration_ms", "package")}


async def _watch(tv_id, base, threshold_ms, dry_run, set_timer):
    w = watchers[tv_id]
    prev, misses = dict(base), 0
    give_up = time.time() + 5 * 3600
    try:
        while time.time() < give_up:
            await asyncio.sleep(4)
            if not (S.tv.connected and S.tv.is_on):
                w["reason"] = "the TV went off"
                return
            front = S.tv.current_package
            if front != base["package"]:
                # They went somewhere else on purpose: drop the plan (and our timer).
                w["reason"] = "you left the app, so I stopped watching for the end"
                if set_timer and not dry_run and S.sleep["ends"]:
                    S._sleep_set(None)
                return
            try:
                await S.media_read(front, S.apps.describe_package(front))
            except Exception as e:
                log.info("off-after read skipped: %s", e)
                continue
            cur = _reading()
            if cur and cur.get("title") and not base.get("title"):
                # Armed before the app said what it is (YouTube takes a few seconds): the first
                # title seen is the one we are waiting on, not a change.
                for k in ("title", "episode_title", "season", "episode", "duration_ms"):
                    base[k] = base.get(k) or cur.get(k)
                w["base"] = base
            misses = misses + 1 if (cur is None or cur.get("state") == "stopped") else 0
            why = episode_over(base, prev, cur, threshold_ms, misses)
            if why:
                w["fired"], w["reason"] = time.time(), why
                log.info("off after episode: %s (%s)", why, "dry run" if dry_run else "turning off")
                if dry_run:
                    return
                if S.sleep["ends"]:
                    S._sleep_set(None)
                await S._sleep_fire()
                return
            if set_timer and cur and cur.get("position_ms") is not None:
                dur = cur.get("duration_ms") or base.get("duration_ms")
                if dur:
                    left = max(0, dur - cur["position_ms"] - threshold_ms) / 1000
                    if cur.get("state") != "playing":
                        left += 60  # paused: keep pushing the end out
                    ends = datetime.fromtimestamp(time.time() + left, _tz())
                    old = S.sleep["ends"]
                    if not old or abs(datetime.fromisoformat(old).timestamp() - ends.timestamp()) > 20:
                        if not dry_run:
                            S._sleep_set(ends.isoformat(timespec="seconds"))
            if cur:
                prev = cur
        w["reason"] = "gave up after 5 hours"
    finally:
        w["task"] = None


def cancel(tv_id=None, clear_timer=True):
    tv_id = tv_id or S._current.get()
    w = watchers.get(tv_id)
    if not w or not w.get("task"):
        return False
    w["task"].cancel()
    w["task"] = None
    w["reason"] = "cancelled"
    if clear_timer and w.get("set_timer") and not w.get("dry_run") and S.sleep["ends"]:
        S._sleep_set(None)
    return True


def status(tv_id=None):
    w = watchers.get(tv_id or S._current.get())
    if not w:
        return {"active": False}
    return {"active": bool(w.get("task")), "title": w["base"].get("title"),
            "episode": w["base"].get("episode"), "dry_run": w["dry_run"], "reason": w.get("reason"),
            "fired": bool(w.get("fired")), "sleep_ends": S.sleep["ends"]}


async def h_off_after_get(request):
    return S.ok(**status())


async def h_off_after(request):
    data = await S.body(request)
    tv_id = S._current.get()
    if data.get("cancel"):
        was = cancel(tv_id)
        S.record_action(request, "off_after_episode", {"cancel": True}, True)
        return S.ok(cancelled=was, note="Cancelled, the TV will stay on." if was else "Nothing was set.")
    front = await S.tv.front_package()
    app = S.apps.describe_package(front)
    if not app or app["id"] in S.NOT_VIEWING:
        raise S.ApiError(409, "nothing is playing, so there is no episode to wait for")
    await S.media_read(front, app)
    base = _reading()
    for _ in range(3):  # give the app a moment to say what is playing
        if not base or base.get("title"):
            break
        await asyncio.sleep(2)
        await S.media_read(front, app)
        base = _reading() or base
    if not base or base.get("state") not in ("playing", "paused", "buffering"):
        raise S.ApiError(409, f"{app['name']} is open but not playing anything I can follow")
    threshold = int(max(0, min(float(data.get("threshold_s", 30)), 600)) * 1000)
    dry_run = bool(data.get("dry_run"))
    cancel(tv_id, clear_timer=True)
    base["package"] = front
    dur, pos = base.get("duration_ms"), base.get("position_ms")
    set_timer = bool(dur and pos is not None)
    watchers[tv_id] = {"base": base, "threshold": threshold, "dry_run": dry_run, "fired": None,
                       "armed_at": time.time(), "reason": None, "set_timer": set_timer}
    if set_timer and not dry_run:
        left = max(0, dur - pos - threshold) / 1000
        S._sleep_set(datetime.fromtimestamp(time.time() + left, _tz()).isoformat(timespec="seconds"))
    watchers[tv_id]["task"] = S.for_tv(tv_id, lambda: _watch(tv_id, base, threshold, dry_run, set_timer))
    what = base.get("title") or "this"
    if base.get("season") and base.get("episode"):
        what += f" S{base['season']} E{base['episode']}"
    if set_timer:
        mins = max(1, round((dur - pos - threshold) / 60000))
        note = f"The TV goes off when {what} ends, in about {mins} min."
    else:
        note = (f"The TV goes off when {what} ends. {app['name']} does not say how long it is, so I "
                "will turn it off when it stops or the next one starts.")
    S.record_action(request, "off_after_episode", {"title": base.get("title"), "dry_run": dry_run}, True)
    return S.ok(armed=True, title=base.get("title"), season=base.get("season"), episode=base.get("episode"),
                minutes_left=round((dur - pos) / 60000, 1) if set_timer else None,
                dry_run=dry_run, note=note)


# ---------- restart an app that is playing up, then carry on ----------
async def h_restart_app(request):
    data = await S.body(request)
    want = data.get("app")
    front = await S.tv.front_package()
    if want:
        app = S.apps.BY_ID.get(want) or S.apps.BY_PACKAGE.get(want)
        if not app:
            raise S.ApiError(400, f"unknown app: {want}")
    else:
        app = S.apps.BY_PACKAGE.get(front)
        if not app or app["id"] in ("home", "settings"):
            raise S.ApiError(409, "no app is open to restart")
    pkg = app["package"]
    title = season = episode = None
    m = S.media_now
    if m and m.get("package") == pkg and m.get("title"):
        title, season, episode = m.get("title"), m.get("season"), m.get("episode")
    item = S.playing["item"]
    if not title and item and item.get("package") == pkg:
        title, season, episode = item.get("title"), item.get("season"), item.get("episode")
    if not title:
        for h in S.store.history()[:10]:
            if h.get("service") == app["id"]:
                when = datetime.fromisoformat(h["when"]) if h.get("when") else None
                if when and datetime.now(when.tzinfo) - when < timedelta(hours=3):
                    title, season, episode = h["title"], h.get("season"), h.get("episode")
                break
    await S.tv.adb("shell", f"am force-stop {check_package(pkg)}", timeout=15)
    await asyncio.sleep(1.5)
    result = {"restarted": app["name"], "resumed": None, "started": None}
    if title and app["id"] == "youtube":
        method, note = await S.search_in_app(app, title)
        result |= {"resumed": title, "note": f"Restarted YouTube and searched for {title}."}
    elif title and app.get("deeplink") == "jw":
        try:
            r = await S.play(title, service=app["id"], who=S.cur_who(), resume=True)
            result |= {"resumed": r["title"], "started": r.get("started"),
                       "note": f"Restarted {app['name']}. " + (r.get("note") or "")}
        except S.ApiError as e:
            await S.launch_app(app)
            result |= {"note": f"Restarted {app['name']}, but could not reopen {title}: {e.message}"}
    else:
        got, _ = await S.launch_app(app)
        result |= {"note": f"Restarted {app['name']}." + (f" Pick {title} again on the TV." if title else "")}
    S.record_action(request, "restart_app", {"app": app["id"]}, True)
    return S.ok(**result)


# ---------- is the new episode out yet ----------
LATEST = """
query($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges { node { id objectType
      content(country: $country, language: $language) { title originalReleaseYear
        upcomingReleases { releaseDate label package { clearName } } }
      ... on Show { totalSeasonCount seasons {
        content(country: $country, language: $language) { seasonNumber }
        episodes { content(country: $country, language: $language) { episodeNumber title originalReleaseDate }
          offers(country: $country, platform: ANDROID_TV) { monetizationType package { clearName technicalName } } } } } } } } }
"""


async def latest_episode(title):
    finder = S.finder
    data = await finder._post(LATEST, {"first": 5, "filter": {"searchQuery": title, "objectTypes": ["SHOW"]}})
    edges = data["popularTitles"]["edges"]
    if not edges:
        return None
    node = next((e["node"] for e in edges if _norm(e["node"]["content"]["title"]) == _norm(title)), edges[0]["node"])
    today = datetime.now(_tz()).date().isoformat()
    out_eps = []
    for s in node.get("seasons") or []:
        sn = s["content"]["seasonNumber"]
        for e in s.get("episodes") or []:
            c = e["content"]
            out_eps.append({"season": sn, "episode": c["episodeNumber"], "name": c.get("title"),
                            "released": c.get("originalReleaseDate"),
                            "on": sorted({o["package"]["clearName"] for o in e.get("offers") or []})})
    out_eps.sort(key=lambda x: (x["season"] or 0, x["episode"] or 0))
    out_now = [e for e in out_eps if e["on"] or (e["released"] and e["released"] <= today)]
    upcoming = [e for e in out_eps if e["released"] and e["released"] > today]
    upcoming += [{"released": u.get("releaseDate"), "label": u.get("label"),
                  "on": (u.get("package") or {}).get("clearName")}
                 for u in node["content"].get("upcomingReleases") or []]
    name = node["content"]["title"]
    seen = [h for h in S.store.history() if _norm(h["title"]) == _norm(name)]
    last = None
    for h in seen:
        if h.get("season") and h.get("episode"):
            last = {"season": h["season"], "episode": h["episode"], "when": h.get("when")}
            break
    if not last and seen:
        last = {"season": None, "episode": None, "when": seen[0].get("when")}
    newest = out_now[-1] if out_now else None

    def day(iso):
        # The weekday spelt out, so nobody has to work out what day the 30th is.
        try:
            return datetime.fromisoformat(iso[:10]).strftime("%A %d %B %Y").replace(" 0", " ")
        except (TypeError, ValueError):
            return None
    for e in ([newest] if newest else []) + upcoming:
        if e.get("released"):
            e["day"] = day(e["released"])
    new_since = None
    if newest and last and last.get("season"):
        new_since = (newest["season"], newest["episode"]) > (int(last["season"]), int(last["episode"]))
    return {"show": name, "seasons": node.get("totalSeasonCount"), "latest_available": newest,
            "upcoming": upcoming[:3], "last_watched_here": last, "newer_than_last_watched": new_since,
            "today": day(today)}


async def h_latest(request):
    title = (request.query.get("title") or "").strip()
    if not title:
        raise S.ApiError(400, "title is required")
    r = await latest_episode(title)
    if not r:
        raise S.ApiError(404, f"could not find a show called {title}")
    return S.ok(**r)


# ---------- something we would both like ----------
def _person_name(pid):
    cfg = getattr(S, "config", None)
    name = cfg.person_name(pid) if cfg and hasattr(cfg, "person_name") else None
    return name or pid.replace("_", " ").title()


async def h_both(request):
    """Each person's genres and shows, what they share, what either dropped, and the household's
    ready picks. ?who=a,b narrows it to those people (default: everyone with a profile)."""
    data = S.taste.load()
    people = {k: v for k, v in (data.get("people") or {}).items() if k != "everyone"}
    want = [w.strip() for w in (request.query.get("who") or "").split(",") if w.strip()]
    if want:
        people = {k: v for k, v in people.items() if k in want}

    def shows_of(p):
        recent = p.get("recent_shows") or []
        return recent + [s["title"] for s in p.get("shows") or [] if s["title"] not in recent]
    out, genre_sets, show_sets, dropped = {}, [], [], set()
    for pid, p in people.items():
        genres, shows = p.get("genres") or [], shows_of(p)
        out[pid] = {"name": _person_name(pid), "things_watched": p.get("events", 0),
                    "genres": genres[:6], "shows": shows[:8]}
        if genres:
            genre_sets.append(genres)
        if shows:
            show_sets.append(set(shows))
        dropped |= {s["title"] for s in p.get("shows") or [] if str(s.get("status", "")).startswith("dropped")}
    shared = [g for g in (genre_sets[0] if genre_sets else []) if all(g in gs for gs in genre_sets[1:])]
    watched_by_all = sorted(set.intersection(*show_sets)) if len(show_sets) > 1 else []
    picks, updated = await S.claude.cached_recs("both")
    watched = {h["title"].lower() for h in S.store.history()}
    picks = [{k: p.get(k) for k in ("title", "year", "type", "reason", "service", "playable")}
             for p in picks if p["title"].lower() not in watched][:12]
    thin = [v["name"] for v in out.values() if not v["genres"] and not v["shows"]]
    return S.ok(people=out, shared_genres=shared[:8], watched_by_all=watched_by_all[:12],
                dropped_by_anyone=sorted(dropped)[:10], household_picks=picks, picks_updated=updated,
                little_history_for=thin)


# ---------- a small screenshot for Claude ----------
async def h_screen_small(request):
    """The screen as a 960 wide JPEG (a full PNG is 1.3 MB and slow for Claude to read), plus
    X-Screen-Black: 1 when the picture is all black (Netflix and other protected video)."""
    from aiohttp import web
    png = await S.tv.screenshot()
    black = "0"
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(png)).convert("RGB")
        lo, hi = img.convert("L").getextrema()
        black = "1" if hi < 12 else "0"
        img.thumbnail((960, 540))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=70)
        data, kind = buf.getvalue(), "image/jpeg"
    except ImportError:
        data, kind = png, "image/png"
    return web.Response(body=data, content_type=kind,
                        headers={"Cache-Control": "no-store", "X-Screen-Black": black})


def routes(r):
    r.add_get("/api/screen-small", h_screen_small)
    r.add_get("/api/ui", h_ui)
    r.add_post("/api/tap", h_tap)
    r.add_post("/api/install", h_install)
    r.add_post("/api/uninstall", h_uninstall)
    r.add_get("/api/inputs", h_inputs)
    r.add_post("/api/input", h_input)
    r.add_get("/api/off-after", h_off_after_get)
    r.add_post("/api/off-after", h_off_after)
    r.add_post("/api/restart-app", h_restart_app)
    r.add_get("/api/latest", h_latest)
    r.add_get("/api/both", h_both)
