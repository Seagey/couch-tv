"""The few things a person does with the TV remote, for their TV's Android version, as short
picture style steps. The page draws each step as a little TV screen: the menu path along the top,
the item to press lit up, and one to three plain lines under it.

Rules every line keeps (tests/test_guide.py checks them):
- 14 words or fewer;
- no dashes of any kind between words, no TV maker's name, "Couch TV" written that way;
- only what this TV needs: a TV that already answers skips straight to the Allow box.

Routes:
- "pair":  Android 11 or newer with Wireless debugging. Developer options, Wireless debugging, then
           "Pair device with pairing code"; the person types the 6 numbers into Setup.
- "allow": Android 7.1 to 11 without Wireless debugging. Developer options, USB debugging (and
           Network debugging if the TV lists it), then the "Allow USB debugging?" box.
- "fire":  Fire OS sticks and TVs. Developer options from My Fire TV, ADB debugging, then Allow.
- "ready": debugging is already on. Only the Allow box (or nothing, for a TV paired before).
"""
import re

MAX_WORDS = 14


def _menu(android, google_tv):
    """Where About and Developer options live. Google TV and Android 12 or newer: Settings, System.
    Android TV 7.1 to 11: Settings, Device Preferences. Not known yet: say both, shortly."""
    if google_tv or (android is not None and android >= 12):
        return ["Settings", "System"], None
    if android is not None and android <= 11:
        return ["Settings", "Device Preferences"], None
    return ["Settings", "System"], "No System? Use Device Preferences instead."


def _version(v):
    try:
        return int(str(v).split(".")[0])
    except (TypeError, ValueError):
        return None


def route_for(row=None, android=None, kind=None, wireless=None):
    """Which steps this TV needs, from what the scan heard and what is known about it.
    row: a finder.merge() row (or None); android: the Android version if known; kind: "fire" for
    Fire OS; wireless: True when the person said Developer options has Wireless debugging."""
    row = row or {}
    if row.get("status") == "ready" or row.get("adb_5555"):
        return "ready"
    if kind == "fire":
        return "fire"
    if row.get("pairing_port") or row.get("wireless_debugging") or wireless is True:
        return "pair"
    v = _version(android)
    if wireless is False or (v is not None and v <= 10):
        return "allow"
    if v is not None and v >= 12:
        return "pair"
    return "choose"   # Android 11 or not known: the page asks which switch the TV shows


def developer_options(android=None, google_tv=False):
    path, alt = _menu(_version(android), google_tv)
    build = "Android TV OS build" if (google_tv or (_version(android) or 12) >= 12) else "Build"
    lines = [f"Open {', '.join(path)}, About.",
             f"Press OK on {build} seven times.",
             "Stop when it says you are a developer. Press Back."]
    if alt:
        lines.insert(1, alt)
    return {"id": "devopts", "title": "Turn on Developer options", "path": path + ["About"], "pick": build,
            "lines": lines}


def steps(route, android=None, google_tv=False):
    """The steps for one route, in order. Each is {"id", "title", "path", "pick", "lines"}."""
    v = _version(android)
    path, _ = _menu(v, google_tv)
    dev = path + ["Developer options"]
    allow_box = {"id": "allow", "title": "Press Allow on the TV", "path": ["Allow USB debugging?"],
                 "pick": "Allow",
                 "lines": ["Tick Always allow from this computer.",
                           "Then press Allow. About four presses on the remote."]}
    if route == "ready":
        return [allow_box]
    if route == "fire":
        return [
            {"id": "devopts", "title": "Turn on Developer options", "path": ["Settings", "My Fire TV", "About"],
             "pick": "the device name",
             "lines": ["Open Settings, My Fire TV, About.",
                       "Press OK on the device name seven times.",
                       "Already see Developer options? Skip this step."]},
            {"id": "debug", "title": "Turn on ADB debugging", "path": ["Settings", "My Fire TV", "Developer options"],
             "pick": "ADB debugging",
             "lines": ["Open Developer options. Turn on ADB debugging.", "Say OK to the warning."]},
            allow_box,
        ]
    if route == "pair":
        return [
            developer_options(v, google_tv),
            {"id": "wireless", "title": "Turn on Wireless debugging", "path": dev, "pick": "Wireless debugging",
             "lines": ["Open Developer options, then Wireless debugging. Turn it on.",
                       "Asked about this network? Tick Always allow, then Allow."]},
            {"id": "code", "title": "Show the pairing code", "path": dev + ["Wireless debugging"],
             "pick": "Pair device with pairing code",
             "lines": ["Choose Pair device with pairing code.",
                       "Type the 6 numbers it shows into Couch TV Setup.",
                       "Leave that screen open until Setup says paired."]},
        ]
    if route == "allow":
        return [
            developer_options(v, google_tv),
            {"id": "debug", "title": "Turn on USB debugging", "path": dev, "pick": "USB debugging",
             "lines": ["Open Developer options. Turn on USB debugging.",
                       "See Network debugging too? Turn that on as well.",
                       "No cable needed. The TV asks this computer over Wi-Fi."]},
            allow_box,
        ]
    # "choose": Developer options first, then the page asks which switch the TV lists
    return [
        developer_options(v, google_tv),
        {"id": "which", "title": "Which switch does your TV have?", "path": dev, "pick": "Wireless debugging",
         "lines": ["Open Developer options and look down the list.",
                   "Wireless debugging? Choose that below. Only USB debugging? Choose that."]},
    ]


def words(line):
    return len(re.findall(r"[A-Za-z0-9']+", line))


def check(step_list):
    """Lines that break the rules, for the tests: [(step id, line, why)]."""
    bad = []
    for s in step_list:
        for line in s["lines"] + [s["title"]]:
            if words(line) > MAX_WORDS:
                bad.append((s["id"], line, "more than 14 words"))
            if re.search("[‒–—―]| - ", line):
                bad.append((s["id"], line, "a dash"))
    return bad
