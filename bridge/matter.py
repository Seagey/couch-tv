"""Matter devices on the home computer (docs/MATTER.md).

People share the smart devices they already have in Google Home, Apple Home, SmartThings or Alexa
("Matter, share" or "Link apps and services" gives an 11 digit code or a QR code). This computer
then joins those devices as one more Matter controller and the TV shows and works them like Home
Assistant devices. Nothing leaves the person's own home app: removing a device here only leaves it.

The controller is the Open Home Foundation Matter Server ("matter-server" on npm, Apache 2.0): Home
Assistant's own Matter controller, written on matter.js, so the same code runs on a Mac (Apple
silicon or Intel), Linux and a Raspberry Pi with nothing to compile. This module starts it as the
bridge's own service (bridge/matter/, installed by scripts/matter-setup.sh), with its fabric keys in
bridge/data/matter (mode 700), and talks to it over its WebSocket API. The service listens on no
network port at all: only on a unix socket in a folder only this user can open (mode 700), so no
web page and no other user on this computer can reach it.

Every device reaches the TV in the shape the contract fixes (the same as a Home Assistant entity):
    { id: "matter:<node>:<endpoint>", name, domain, state, attributes }
Locks, alarms and garage doors (and gates and doors) never show and can never be switched.

    GET  /api/matter/devices   -> { devices, ready, version, reason?, note? }
    POST /api/matter/commission { code, address? } -> { ok, device_ids, error?, reason?, note? }
    POST /api/matter/command   { id, action, value? } -> { ok, state, device? }
    POST /api/matter/remove    { id } -> { ok, removed, reason?, note? }
    POST /api/matter/rename    { id, name } -> { ok, name }
Live state: every change is pushed to the TV pages as an "event: matter" on /api/matter/events.
"""
import asyncio
import atexit
import colorsys
import hashlib
import itertools
import json
import logging
import math
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

log = logging.getLogger("couch.matter")

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.join(HERE, "matter")
ENTRY = os.path.join(SERVICE_DIR, "node_modules", "matter-server", "dist", "esm", "bin.js")
NODE_MIN = (22, 13)
SOCKET = "ws.sock"
SOCKET_MAX = 100     # a unix socket path must fit in 104 bytes on macOS (108 on Linux)
NAMES_FILE = "matter-names.json"
FORGOTTEN_FILE = "matter-forgotten.json"
FABRIC_LABEL = "Couch TV"
MATTER_PORT = 5540   # the port every Matter device listens on; the service only ever tries this one
LOG_MAX = 5 * 1024 * 1024
LOG_CHECK = 60       # seconds between looks at the service's log size

# ---------------------------------------------------------------- the device model

ON_OFF, LEVEL, COLOUR = 6, 8, 768
FAN, COVER, THERMOSTAT = 514, 258, 513
BASIC, BRIDGED, DESCRIPTOR = 40, 57, 29
TEMP, HUMID, LUX, PRESSURE, OCCUPANCY, BOOLEAN = 1026, 1029, 1024, 1027, 1030, 69
AIR, PM25, CO2 = 91, 1066, 1037
DOOR_LOCK, SMOKE_CO = 257, 92
CLOSURE_CONTROL, CLOSURE_DIMENSION = 260, 261
ICD = 70    # ICD management: a sleepy battery device

# Matter device types (Device Library) to the contract's domains
LIGHTS = {256, 257, 268, 269}                  # on/off, dimmable, colour temperature, extended colour light
SWITCHES = {266, 267, 271, 272}                # on/off and dimmable plug in units, mounted on/off and dimmable controls
FANS = {43}
COVERS = {514}
CLIMATES = {769, 114}                          # thermostat, room air conditioner
SENSORS = {770: "temperature", 775: "humidity", 262: "illuminance", 773: "pressure", 263: "occupancy",
           21: "contact", 44: "aqi"}
# never shown, never switched: door lock, smoke and CO alarm, the Matter 1.5 closures (garage doors, gates)
# Device types (matter.js 0.18 standard model, Matter 1.5): door lock 10, smoke and CO alarm 118, Closure
# 560 (garage doors, gates and the like), Closure Panel 561. Clusters: door lock 257, smoke and CO alarm
# 92, Closure Control 260 (0x0104) and Closure Dimension 261 (0x0105), which only closures serve.
BLOCKED_TYPES = {10, 118, 560, 561}
BLOCKED_CLUSTERS = {DOOR_LOCK, SMOKE_CO, CLOSURE_CONTROL, CLOSURE_DIMENSION}
# A name that says the thing opens the house: a garage door, a gate, a door or a lock, as whole words
# ("Outdoor blind", "Margate blind" and "Block out blind" are blinds), in every language the home
# speaks: English, German, Dutch, French, Spanish, Italian, Portuguese, Turkish, Serbian (Latin),
# Polish, Czech, Hebrew and Arabic. Used on blinds, plugs and on/off only lights (a garage door
# opener is usually one of those) and on every name typed on the TV.
OPENS_HOUSE_WORDS = [
    r"garages?", r"gates?", r"doors?", r"locks?",                                              # en
    r"garagen\w*", r"tore?", r"\w*(?:tür|tuer)(?:e|en)?", r"\w*schlo(?:ss|ß)",                 # de
    r"\w*(?:einfahrts|hof|garten|roll|schiebe|flügel|fluegel)tore?",
    r"(?:voor|achter|garage|zij|tuin|schuif|kantel|rol|kelder|balkon|terras)?deur(?:en)?",       # nl
    r"(?:garage|toegangs|tuin|rol|schuif|inrit)?poort(?:en)?", r"slot(?:en)?", r"(?:tuin|toegangs|schuif|draai|inrit)?hek(?:ken)?",
    r"portails?", r"portes?", r"serrures?", r"barrières?",                                      # fr
    r"garajes?", r"cocheras?", r"puertas?", r"port[oó]n(?:es)?", r"verjas?", r"cerraduras?",    # es
    r"cancelas?", r"cerrojos?",
    r"portas?", r"portone", r"portoni", r"cancell[oi]", r"serratur[ae]", r"basculante",          # it
    r"garage[mn]s?", r"port[ãa]o", r"port[õo]es", r"fechaduras?",                                # pt
    r"garaj\w*", r"kap[ıi]\w*", r"kilit\w*", r"kilid\w*",                                        # tr
    r"gara[žżz]\w*", r"kapij\w*", r"vrata", r"brav[au]",                                          # sr, pl, cs
    r"bram(?:a|y|ę|ie|ą|ka|ki|kę)?", r"drzwi", r"zam(?:ek|ka|ku|ki|kiem)",
    r"gar[áa][žz]\w*", r"br[áa]n(?:a|y|u|ou|ě)", r"dve[řr]\w*", r"z[áa]m(?:ek|ku|ky|kem)",
    r"[הבלמו]?(?:מוסך|שער|דלת|מנעול)",                                                         # he
    r"(?:ال)?(?:مرآب|كراج|جراج|بوابة|باب|قفل)",                                                  # ar
]
OPENS_HOUSE = re.compile(r"(?<!\w)(?:" + "|".join(OPENS_HOUSE_WORDS) + r")(?!\w)", re.I)


def opens_house(name):
    """True when a name says garage door, gate, door or lock. Joined names count too: "GarageDoor",
    "MyGarage", "Garage2", "Gate_1" and "Door1" are split at a small letter followed by a capital and
    at digits and underscores before the whole word match ("Outdoor blind" stays a blind)."""
    if not name:
        return False
    s = re.sub(r"(?<=[a-zà-ÿ])(?=[A-ZÀ-Þ])", " ", str(name))
    s = re.sub(r"[\d_]+", " ", s)
    return bool(OPENS_HOUSE.search(s))

MODES = {"off": 0, "heat_cool": 1, "cool": 3, "heat": 4, "fan_only": 7, "dry": 8}
MODE_OF = {0: "off", 1: "heat_cool", 3: "cool", 4: "heat", 5: "heat", 6: "cool", 7: "fan_only", 8: "dry", 9: "auto"}
AIR_WORDS = {0: "unknown", 1: "good", 2: "fair", 3: "moderate", 4: "poor", 5: "very_poor", 6: "extremely_poor"}
ACTIONS = {"on", "off", "toggle", "level", "colour", "temp", "target", "mode", "position"}
# no control characters, no < or >, and no zero width or text direction controls (a name could hide or
# reorder words with them): U+200B to U+200F, U+202A to U+202E, U+2066 to U+2069
NAME = re.compile(r"[^\x00-\x1f\x7f<>\u200b-\u200f\u202a-\u202e\u2066-\u2069]{1,40}")


def _a(node, ep, cluster, attr, default=None):
    v = (node.get("attributes") or {}).get("%d/%d/%d" % (ep, cluster, attr))
    return default if v is None else v


def endpoints(node):
    """{endpoint: set of server cluster ids} from the node's attribute paths."""
    out = {}
    for path in (node.get("attributes") or {}):
        try:
            ep, cl, _ = (int(x) for x in path.split("/"))
        except ValueError:
            continue
        out.setdefault(ep, set()).add(cl)
    return out


def device_types(node, ep):
    out = []
    for d in _a(node, ep, DESCRIPTOR, 0, []) or []:
        if isinstance(d, dict):
            t = d.get("0", d.get("deviceType"))
            if isinstance(t, int):
                out.append(t)
    return out


def _feature(node, ep, cluster, bit):
    f = _a(node, ep, cluster, 65532, 0)
    return isinstance(f, int) and bool(f & (1 << bit))


def kind_of(node, ep, clusters):
    """(domain, sensor class or None) for one endpoint, or None when it is not shown."""
    types = device_types(node, ep)
    if BLOCKED_CLUSTERS & clusters or BLOCKED_TYPES & set(types):
        return None
    for t in types:
        if t in LIGHTS:
            return "light", None
        if t in SWITCHES:
            return "switch", None
        if t in FANS:
            return "fan", None
        if t in COVERS:
            return "cover", None
        if t in CLIMATES:
            return "climate", None
        if t in SENSORS:
            return "sensor", SENSORS[t]
    if types and not {14, 19} & set(types):
        return None   # a device type that is not ours (a switch that only sends, a speaker, a valve)
    # a bridged endpoint or no descriptor: go by the clusters it serves
    if THERMOSTAT in clusters:
        return "climate", None
    if COVER in clusters:
        return "cover", None
    if FAN in clusters:
        return "fan", None
    if ON_OFF in clusters:
        return ("light", None) if LEVEL in clusters or COLOUR in clusters else ("switch", None)
    for cl, cls in ((TEMP, "temperature"), (HUMID, "humidity"), (LUX, "illuminance"), (PRESSURE, "pressure"),
                    (OCCUPANCY, "occupancy"), (BOOLEAN, "contact"), (AIR, "aqi"), (PM25, "pm25")):
        if cl in clusters:
            return "sensor", cls
    return None


def _round(x, step=0.1):
    return round(round(x / step) * step, 2)


def _light(node, ep, clusters):
    on = _a(node, ep, ON_OFF, 0)
    attrs = {"supported_color_modes": ["onoff"]}
    lvl = _a(node, ep, LEVEL, 0)
    if LEVEL in clusters:
        attrs["supported_color_modes"] = ["brightness"]
        if isinstance(lvl, (int, float)):   # kept while off too: the screens show where it comes back on
            attrs["brightness"] = max(1, min(255, round(lvl * 255 / 254)))
            attrs["level"] = max(1, min(100, round(lvl * 100 / 254)))
    if COLOUR in clusters:
        modes = []
        if _feature(node, ep, COLOUR, 4):          # colour temperature
            modes.append("color_temp")
            lo, hi = _a(node, ep, COLOUR, 16395), _a(node, ep, COLOUR, 16396)   # mireds min and max
            if isinstance(hi, int) and hi > 0:
                attrs["min_color_temp_kelvin"] = round(1e6 / hi)
            if isinstance(lo, int) and lo > 0:
                attrs["max_color_temp_kelvin"] = round(1e6 / lo)
            m = _a(node, ep, COLOUR, 7)
            if isinstance(m, int) and m > 0:
                attrs["color_temp_kelvin"] = round(1e6 / m)
        if _feature(node, ep, COLOUR, 0) or _feature(node, ep, COLOUR, 3):   # hue and saturation, or xy
            modes.append("hs" if _feature(node, ep, COLOUR, 0) else "xy")
            if on and _a(node, ep, COLOUR, 8) == 0 and _feature(node, ep, COLOUR, 0):
                attrs["hs_color"] = [round(_a(node, ep, COLOUR, 0, 0) * 360 / 254), round(_a(node, ep, COLOUR, 1, 0) * 100 / 254)]
            elif on and _a(node, ep, COLOUR, 8) == 1:
                x, y = _a(node, ep, COLOUR, 3, 0) / 65536, _a(node, ep, COLOUR, 4, 0) / 65536
                attrs["xy_color"] = [round(x, 4), round(y, 4)]
                attrs["hs_color"] = xy_to_hs(x, y)     # the screens read hs_color whichever way the lamp keeps it
        if modes:
            attrs["supported_color_modes"] = modes
            mode = _a(node, ep, COLOUR, 8)
            attrs["color_mode"] = {0: "hs", 1: "xy", 2: "color_temp"}.get(mode, modes[0]) if on else None
    return ("on" if on else "off"), attrs


def _fan(node, ep, clusters):
    pct = _a(node, ep, FAN, 3, _a(node, ep, FAN, 2))
    mode = _a(node, ep, FAN, 0, 0)
    on = _a(node, ep, ON_OFF, 0) if ON_OFF in clusters else (mode not in (0, None) or (isinstance(pct, int) and pct > 0))
    attrs = {}
    if isinstance(pct, (int, float)):
        attrs["percentage"] = max(0, min(100, int(pct))) if on else 0
    attrs["preset_mode"] = {0: "off", 1: "low", 2: "medium", 3: "high", 4: "on", 5: "auto", 6: "smart"}.get(mode)
    return ("on" if on else "off"), attrs


def _cover(node, ep, clusters):
    pos = _a(node, ep, COVER, 14)                       # current lift, 0 = open, 10000 = closed
    attrs = {}
    status = _a(node, ep, COVER, 10, 0)                 # operational status: 1 opening, 2 closing (bits 0 and 1)
    if isinstance(pos, int):
        attrs["current_position"] = max(0, min(100, 100 - round(pos / 100)))
    moving = status & 3 if isinstance(status, int) else 0
    if moving == 1:
        state = "opening"
    elif moving == 2:
        state = "closing"
    elif "current_position" in attrs:
        state = "closed" if attrs["current_position"] == 0 else "open"
    else:
        state = "unknown"
    return state, attrs


def _climate(node, ep, clusters, types):
    attrs = {}
    heat, cool, auto = _feature(node, ep, THERMOSTAT, 0), _feature(node, ep, THERMOSTAT, 1), _feature(node, ep, THERMOSTAT, 5)
    modes = ["off"] + (["heat"] if heat else []) + (["cool"] if cool else []) + (["heat_cool"] if auto else [])
    if 114 in types:
        modes += ["dry", "fan_only"]
    attrs["hvac_modes"] = modes
    mode = MODE_OF.get(_a(node, ep, THERMOSTAT, 28), "off")
    t = _a(node, ep, THERMOSTAT, 0)
    if isinstance(t, (int, float)):
        attrs["current_temperature"] = _round(t / 100)
    hs, cs = _a(node, ep, THERMOSTAT, 18), _a(node, ep, THERMOSTAT, 17)
    lims = [(_a(node, ep, THERMOSTAT, a)) for a in (3, 4, 5, 6)]   # abs min heat, max heat, min cool, max cool
    lo = [x for x, ok in ((lims[0], heat), (lims[2], cool)) if ok and isinstance(x, int)]
    hi = [x for x, ok in ((lims[1], heat), (lims[3], cool)) if ok and isinstance(x, int)]
    attrs["min_temp"] = _round(min(lo) / 100) if lo else 7.0
    attrs["max_temp"] = _round(max(hi) / 100) if hi else 35.0
    attrs["target_temp_step"] = 0.5
    if mode == "cool" and isinstance(cs, int):
        attrs["temperature"] = _round(cs / 100)
    elif mode == "heat_cool" and isinstance(hs, int) and isinstance(cs, int):
        attrs["target_temp_low"], attrs["target_temp_high"] = _round(hs / 100), _round(cs / 100)
        attrs["temperature"] = _round((hs + cs) / 200, 0.5)
    elif isinstance(hs, int) and heat:
        attrs["temperature"] = _round(hs / 100)
    elif isinstance(cs, int):
        attrs["temperature"] = _round(cs / 100)
    run = _a(node, ep, THERMOSTAT, 41)                   # running state: bit 0 heat, 1 cool, 2 fan
    if mode == "off":
        attrs["hvac_action"] = "off"
    elif isinstance(run, int):
        attrs["hvac_action"] = "heating" if run & 1 else "cooling" if run & 2 else "fan" if run & 4 else "idle"
    else:
        # no ThermostatRunningState (many thermostats leave it out): the heating or cooling demand, else
        # the mode and how far the room is from the set point
        hd, cd = _a(node, ep, THERMOSTAT, 8), _a(node, ep, THERMOSTAT, 7)
        cur, tgt = attrs.get("current_temperature"), attrs.get("temperature")
        lo, hi = attrs.get("target_temp_low", tgt), attrs.get("target_temp_high", tgt)
        if isinstance(hd, int) or isinstance(cd, int):
            attrs["hvac_action"] = "heating" if (hd or 0) > 0 else "cooling" if (cd or 0) > 0 else "idle"
        elif cur is None or tgt is None:
            attrs["hvac_action"] = "idle"
        elif mode in ("heat", "heat_cool") and lo is not None and cur < lo:
            attrs["hvac_action"] = "heating"
        elif mode in ("cool", "heat_cool") and hi is not None and cur > hi:
            attrs["hvac_action"] = "cooling"
        elif mode == "fan_only":
            attrs["hvac_action"] = "fan"
        elif mode == "dry":
            attrs["hvac_action"] = "drying"
        else:
            attrs["hvac_action"] = "idle"
    if FAN in clusters:
        fm = _a(node, ep, FAN, 0)
        attrs["fan_modes"] = ["low", "medium", "high", "auto"]
        attrs["fan_mode"] = {1: "low", 2: "medium", 3: "high", 5: "auto"}.get(fm)
    return mode, attrs


def _lux(v):
    return 0 if not isinstance(v, int) or v <= 0 else round(10 ** ((v - 1) / 10000))


def _sensor(node, ep, clusters, cls):
    attrs = {"device_class": cls}

    def num(cl, scale=1.0):
        v = _a(node, ep, cl, 0)
        return None if not isinstance(v, (int, float)) else _round(v * scale, 0.01)
    if cls == "temperature":
        v, attrs["unit_of_measurement"] = num(TEMP, 0.01), "°C"
    elif cls == "humidity":
        v, attrs["unit_of_measurement"] = num(HUMID, 0.01), "%"
    elif cls == "illuminance":
        raw = _a(node, ep, LUX, 0)
        v, attrs["unit_of_measurement"] = (None if raw is None else _lux(raw)), "lx"
    elif cls == "pressure":
        v, attrs["unit_of_measurement"] = num(PRESSURE), "hPa"   # Matter keeps 0.1 kPa, which is 1 hPa
    elif cls == "occupancy":
        o = _a(node, ep, OCCUPANCY, 0)
        v = None if not isinstance(o, int) else ("on" if o & 1 else "off")
    elif cls == "contact":
        c = _a(node, ep, BOOLEAN, 0)                    # true: the two halves touch, so it is closed
        v = None if not isinstance(c, bool) else ("off" if c else "on")
        attrs["reading"] = None if v is None else ("closed" if c else "open")
    elif cls == "aqi":
        q = _a(node, ep, AIR, 0)
        v = AIR_WORDS.get(q) if isinstance(q, int) else None
    else:   # pm25 on its own
        v, attrs["unit_of_measurement"] = num(PM25), "µg/m³"
    if PM25 in clusters and cls != "pm25":
        attrs["pm25"] = num(PM25)
    if CO2 in clusters:
        attrs["co2"] = num(CO2)
    return ("unknown" if v is None else str(v)), attrs


def tidy_name(s):
    """A name as the TV may show it (the NAME rule: 1 to 40 characters, no control characters, no < or >), or None."""
    if not isinstance(s, str):
        return None
    s = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f<>\u200b-\u200f\u202a-\u202e\u2066-\u2069]", " ", s)).strip()[:40].strip()
    return s if s and NAME.fullmatch(s) else None


def node_name(node, ep):
    for v in (_a(node, ep, BRIDGED, 5), _a(node, ep, BRIDGED, 3), _a(node, 0, BASIC, 5), _a(node, 0, BASIC, 3)):
        v = tidy_name(v)
        if v:
            return v
    return None


def hidden_by_name(domain, clusters, name):
    """True when a blind, a plug or an on/off only light is called a garage door, gate, door or lock."""
    if domain in ("cover", "switch") or (domain == "light" and not {LEVEL, COLOUR} & set(clusters)):
        return opens_house(name)
    return False


WORDS = {"light": "Light", "switch": "Plug", "fan": "Fan", "cover": "Blind", "climate": "Air conditioner",
         "temperature": "Temperature", "humidity": "Humidity", "illuminance": "Light level", "pressure": "Air pressure",
         "occupancy": "Motion", "contact": "Door or window", "aqi": "Air quality", "pm25": "Air quality"}


def devices_of(node, names=None):
    """Every device one Matter node gives the TV, in the contract's shape. `names`: the ones renamed here."""
    names = names or {}
    nid = node.get("node_id")
    eps = endpoints(node)
    found = []
    for ep in sorted(eps):
        if ep == 0:
            continue
        k = kind_of(node, ep, eps[ep])
        if k:
            found.append((ep, k))
    out, seen = [], {}
    for ep, (domain, cls) in found:
        did = "matter:%s:%d" % (nid, ep)
        base = node_name(node, ep) or WORDS.get(cls or domain, "Device")
        if domain == "sensor" and len(found) > 1 and node_name(node, ep) and _a(node, ep, BRIDGED, 5) is None:
            base = "%s %s" % (base, WORDS.get(cls, "").lower())    # "Eve Weather temperature"
        seen[base] = seen.get(base, 0) + 1
        name = names.get(did) or (base if seen[base] == 1 else "%s %d" % (base, seen[base]))
        if hidden_by_name(domain, eps[ep], name) or hidden_by_name(domain, eps[ep], base):
            continue   # a garage door, gate or door: never shown, never moved
        types = device_types(node, ep)
        if domain == "light":
            state, attrs = _light(node, ep, eps[ep])
        elif domain == "switch":
            state, attrs = ("on" if _a(node, ep, ON_OFF, 0) else "off"), {}
        elif domain == "fan":
            state, attrs = _fan(node, ep, eps[ep])
        elif domain == "cover":
            state, attrs = _cover(node, ep, eps[ep])
        elif domain == "climate":
            state, attrs = _climate(node, ep, eps[ep], types)
        else:
            state, attrs = _sensor(node, ep, eps[ep], cls)
        if node.get("available") is False:
            state = "unavailable"
        attrs = {k: v for k, v in attrs.items() if v is not None}
        attrs["friendly_name"] = name
        out.append({"id": did, "name": name, "domain": domain, "state": state, "attributes": attrs})
    return out


def blocked_only(node):
    """True when a node has something never allowed (a lock, an alarm) and nothing the TV may show."""
    eps = endpoints(node)
    bad = any(BLOCKED_CLUSTERS & cl or BLOCKED_TYPES & set(device_types(node, ep)) for ep, cl in eps.items())
    return bad and not devices_of(node)


# ---------------------------------------------------------------- codes

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
      [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
      [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4]]
for _i in range(2, 8):
    _P.append([_P[1][_P[_i - 1][j]] for j in range(10)])


def verhoeff_ok(digits):
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


QR = re.compile(r"MT:[0-9A-Z.\-]{19,}")


def clean_code(code):
    """The code as Matter wants it, or None: 11 or 21 digits with a good check digit, or MT: QR text."""
    s = str(code or "").strip()
    if s.upper().startswith("MT:"):
        s = "MT:" + s[3:].strip().upper()
        return s if QR.fullmatch(s) and len(s) <= 512 else None
    d = re.sub(r"[\s\-.]", "", s)
    if not re.fullmatch(r"\d{11}|\d{21}", d) or not verhoeff_ok(d):
        return None
    if int(d[0]) > 7:   # the first digit says the version and the code length; 8 and 9 are never used
        return None
    return d


ADDRESS_NOTES = {
    "address": "That device address does not look right. Type its number from your router, or leave it empty.",
    "port": "Couch TV can only reach a Matter device on port 5540. Leave the port out, or leave the address empty "
            "so Couch TV looks for the device itself.",
    "link_local": "An address starting fe80 cannot be used here. Leave the address empty so Couch TV looks for "
                  "the device itself, or type its other address.",
}


def address_problem(a):
    """(ip, None) for "host", "host:5540", "[v6]" or "[v6]:5540", else (None, reason): "address" (not an
    IP address), "port" (a port other than 5540: the Matter service only ever tries 5540) or "link_local"
    (an fe80 address: the service ignores those and looks for the device instead)."""
    import ipaddress
    s = str(a or "").strip()
    m = re.fullmatch(r"\[([0-9a-fA-F:.]+(?:%[A-Za-z0-9]+)?)\](?::(\d{1,5}))?", s) or re.fullmatch(r"([0-9.]+)(?::(\d{1,5}))?", s) \
        or re.fullmatch(r"([0-9a-fA-F:]+(?:%[A-Za-z0-9]+)?)()", s)
    if not m:
        return None, "address"
    try:
        ip = ipaddress.ip_address(m.group(1).split("%")[0])
    except ValueError:
        return None, "address"
    if m.group(2) and int(m.group(2)) != MATTER_PORT:
        return None, "port"
    if ip.version == 6 and ip.is_link_local:
        return None, "link_local"
    return m.group(1), None


def clean_address(a):
    """The address the Matter service is given, or None (address_problem says why)."""
    return address_problem(a)[0]


def thread_route():
    """True when this computer has a route to a Thread network (a border router's fd00::/8 mesh prefix)."""
    try:
        if sys.platform == "darwin":
            out = subprocess.run(["netstat", "-rn", "-f", "inet6"], capture_output=True, text=True, timeout=5).stdout
            lines = [ln.split() for ln in out.splitlines()]
            return any(p and p[0].lower().startswith("fd") and len(p) > 1 and p[1].lower().startswith("fe80") for p in lines)
        out = subprocess.run(["ip", "-6", "route"], capture_output=True, text=True, timeout=5).stdout
        return any(ln.lower().startswith("fd") and " via fe80" in ln.lower() for ln in out.splitlines())
    except (OSError, subprocess.SubprocessError):
        return True   # cannot tell: do not blame Thread


def multicast_blocked():
    """True when this process may not send multicast on the home network: a Mac where the program
    running the bridge has no Local Network permission. Seen on the MacBook with the bridge as a
    launchd job: mDNS to 224.0.0.251 and ff02::fb failed with errno 65 (No route to host) while
    unicast went out, so Matter found no device and every add ended "expired" after 30 s. Only macOS
    has this rule; elsewhere the answer is False."""
    if sys.platform != "darwin":
        return False
    import errno
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.sendto(b"\x00" * 12, ("224.0.0.251", 5353))   # an empty mDNS header: asks nothing
        return False
    except OSError as e:
        return e.errno in (errno.EHOSTUNREACH, errno.ENETUNREACH)
    finally:
        s.close()


# ---------------------------------------------------------------- colours

def rgb_to_hs(r, g, b):
    h, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360, s * 100


def rgb_to_xy(r, g, b):
    def lin(c):
        c /= 255
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    r, g, b = lin(r), lin(g), lin(b)
    X, Y, Z = r * 0.4124 + g * 0.3576 + b * 0.1805, r * 0.2126 + g * 0.7152 + b * 0.0722, r * 0.0193 + g * 0.1192 + b * 0.9505
    t = X + Y + Z
    return (0.3127, 0.3290) if t == 0 else (X / t, Y / t)


def xy_to_hs(x, y):
    """CIE xy (what a lamp in xy mode keeps) -> [hue 0 to 360, saturation 0 to 100], or None."""
    if not (isinstance(x, (int, float)) and isinstance(y, (int, float))) or y <= 0 or x < 0 or x + y > 1:
        return None
    X, Y, Z = x / y, 1.0, (1 - x - y) / y
    rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z]
    rgb = [max(0.0, c) for c in rgb]
    top = max(rgb)
    if top <= 0:
        return None

    def gamma(c):
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    h, s, _ = colorsys.rgb_to_hsv(*(gamma(c / top) for c in rgb))
    return [round(h * 360) % 360, round(s * 100)]


def parse_colour(value):
    """"#rrggbb", "hue,saturation", [hue, saturation] or {"h", "s"} (0 to 360, 0 to 100) -> ("rgb", r, g, b) or ("hs", h, s), or None."""
    if isinstance(value, dict):
        value = "%s,%s" % (value.get("h"), value.get("s"))
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        value = "%s,%s" % tuple(value)
    s = str(value or "").strip()
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", s)
    if m:
        n = int(m.group(1), 16)
        return ("rgb", n >> 16 & 255, n >> 8 & 255, n & 255)
    m = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)", s)
    if m and float(m.group(1)) <= 360 and float(m.group(2)) <= 100:
        return ("hs", float(m.group(1)), float(m.group(2)))
    return None


def _number(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def plan(dev, node, ep, action, value, last_mode=None):
    """What one action becomes: a list of ("cmd", cluster, name, payload) and ("write", path, value), or None (refused)."""
    domain, attrs, state = dev["domain"], dev["attributes"], dev["state"]
    eps = endpoints(node).get(ep, set())
    T = {"transitionTime": 0, "optionsMask": 0, "optionsOverride": 0}
    if action == "toggle":
        if domain in ("light", "switch") and ON_OFF in eps:
            return [("cmd", ON_OFF, "Toggle", {})]
        if domain == "cover":
            action = "off" if state in ("open", "opening") else "on"
        else:
            action = "off" if state not in ("off", "unavailable", "closed") else "on"
    if domain in ("light", "switch"):
        if action in ("on", "off") and ON_OFF in eps:
            return [("cmd", ON_OFF, "On" if action == "on" else "Off", {})]
        if domain == "light" and action == "level" and LEVEL in eps:
            v = _number(value)
            if v is None:
                return None
            v = max(0, min(100, v))
            if v == 0:
                return [("cmd", ON_OFF, "Off", {})] if ON_OFF in eps else [("cmd", LEVEL, "MoveToLevelWithOnOff", dict(T, level=0))]
            return [("cmd", LEVEL, "MoveToLevelWithOnOff", dict(T, level=max(1, min(254, round(v * 254 / 100)))))]
        if domain == "light" and action == "temp" and "color_temp" in attrs.get("supported_color_modes", []):
            k = _number(value)
            if k is None or k <= 0:
                return None
            k = max(attrs.get("min_color_temp_kelvin", 1000), min(attrs.get("max_color_temp_kelvin", 10000), k))
            return [("cmd", COLOUR, "MoveToColorTemperature", dict(T, colorTemperatureMireds=round(1e6 / k)))] + \
                   ([("cmd", ON_OFF, "On", {})] if state != "on" and ON_OFF in eps else [])
        if domain == "light" and action == "colour":
            c, modes = parse_colour(value), attrs.get("supported_color_modes", [])
            if not c or not ({"hs", "xy"} & set(modes)):
                return None
            on = [("cmd", ON_OFF, "On", {})] if state != "on" and ON_OFF in eps else []
            if "hs" in modes:
                h, s = (c[1], c[2]) if c[0] == "hs" else rgb_to_hs(*c[1:])
                return [("cmd", COLOUR, "MoveToHueAndSaturation", dict(T, hue=min(254, round(h * 254 / 360)), saturation=min(254, round(s * 254 / 100))))] + on
            rgb = c[1:] if c[0] == "rgb" else tuple(round(x * 255) for x in colorsys.hsv_to_rgb(c[1] / 360, c[2] / 100, 1))
            x, y = rgb_to_xy(*rgb)
            return [("cmd", COLOUR, "MoveToColor", dict(T, colorX=min(65279, round(x * 65536)), colorY=min(65279, round(y * 65536))))] + on
        return None
    if domain == "fan":
        if action == "on":
            return [("cmd", ON_OFF, "On", {})] if ON_OFF in eps else [("write", "%d/%d/0" % (ep, FAN), 4)]
        if action == "off":
            return [("cmd", ON_OFF, "Off", {})] if ON_OFF in eps else [("write", "%d/%d/0" % (ep, FAN), 0)]
        if action == "level":
            v = _number(value)
            return None if v is None else [("write", "%d/%d/2" % (ep, FAN), int(max(0, min(100, v))))]
        return None
    if domain == "cover":
        if action in ("on", "off"):
            return [("cmd", COVER, "UpOrOpen" if action == "on" else "DownOrClose", {})]
        if action in ("position", "level"):
            v = _number(value)
            if v is None:
                return None
            return [("cmd", COVER, "GoToLiftPercentage", {"liftPercent100thsValue": int(round((100 - max(0, min(100, v))) * 100))})]
        return None
    if domain == "climate":
        modes = attrs.get("hvac_modes", [])
        if action == "mode":
            m = str(value or "")
            return [("write", "%d/%d/28" % (ep, THERMOSTAT), MODES[m])] if m in modes and m in MODES else None
        if action == "off":
            return [("write", "%d/%d/28" % (ep, THERMOSTAT), 0)]
        if action == "on":
            want = last_mode if last_mode in modes and last_mode != "off" else next((m for m in ("heat_cool", "heat", "cool") if m in modes), None)
            return [("write", "%d/%d/28" % (ep, THERMOSTAT), MODES[want])] if want else None
        if action in ("target", "temp"):
            v = _number(value)
            if v is None:
                return None
            v = round(max(attrs.get("min_temp", 7), min(attrs.get("max_temp", 35), v)) * 2) / 2
            heat, cool = "heat" in modes, "cool" in modes
            if state == "cool" or (not heat and cool):
                return [("write", "%d/%d/17" % (ep, THERMOSTAT), int(v * 100))]
            if state == "heat_cool" and heat and cool:
                gap = max(2.5, (_a(node, ep, THERMOSTAT, 25, 25) or 25) / 10)   # the dead band is kept in 0.1 degrees
                return [("write", "%d/%d/18" % (ep, THERMOSTAT), int((v - gap / 2) * 100)),
                        ("write", "%d/%d/17" % (ep, THERMOSTAT), int((v + gap / 2) * 100))]
            return [("write", "%d/%d/18" % (ep, THERMOSTAT), int(v * 100))] if heat else None
        return None
    return None   # sensors only read


# ---------------------------------------------------------------- the service and the connection

def node_version(node="node"):
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"v(\d+)\.(\d+)", out)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _off(v):
    return v is False or str(v).strip().lower() in ("false", "no", "off", "0")


def _on(v):
    return v is True or str(v).strip().lower() in ("true", "yes", "on", "1")


def short_private_dir(key):
    """A folder with a short path that only this user can open, for the service's socket when the
    bridge's own folder is too deep for one (a unix socket path must fit in 104 bytes on macOS)."""
    uid = os.getuid()
    name = "couchtv-matter-%d-%s" % (uid, hashlib.sha256(key.encode()).hexdigest()[:8])
    for base in (tempfile.gettempdir(), "/tmp"):
        d = os.path.join(base, name)
        if len(os.path.join(d, SOCKET).encode()) > SOCKET_MAX:
            continue
        try:
            os.mkdir(d, 0o700)
        except FileExistsError:
            pass
        except OSError:
            continue
        try:
            st = os.lstat(d)       # never follows a link someone else left there
            if stat.S_ISDIR(st.st_mode) and st.st_uid == uid:
                if stat.S_IMODE(st.st_mode) != 0o700:
                    os.chmod(d, 0o700)
                return d
        except OSError:
            pass
    return tempfile.mkdtemp(prefix="ctvm-", dir="/tmp")   # someone else holds the usual name: a fresh one


STARTING = "Matter is starting. Try again in a minute."
LOCAL_NETWORK_NOTE = ("macOS does not let the bridge look for devices on your home network yet. On the home computer: "
                      "System Settings, Privacy and Security, Local Network, switch on Couch TV bridge (or Python), "
                      "then try again.")
BUSY_NOTE = "Couch TV is still adding another device. Try again when it has finished."
LOCK_NOTE = "Couch TV does not add locks, alarms or garage doors. It is still in your other home app."
UNSUPPORTED_NOTE = ("Couch TV cannot show or work this kind of device (it shows lights, plugs, fans, blinds, air "
                    "conditioners and sensors), so it left it again. It is still in your other home app.")
OFFLINE_NOTE = ("The device was not answering, so Couch TV forgot it without telling it. If your other home app "
                "still lists Couch TV for this device, remove it there too.")
NOT_ANSWERING_NOTE = ("The device did not answer, so Couch TV forgot it here and leaves it properly the next time "
                      "it answers. It is still in your other home app.")
NAME_HIDES_NOTE = "Couch TV never shows a garage door, gate, door or lock, so that name would hide this device. Pick another name."
PROBE_EVERY = 15       # seconds between looks for devices that went quiet
PROBE_QUIET = 45       # a device not heard from for this long is asked for one value
PROBE_TIMEOUT = 10     # and is shown unavailable when it does not answer within this
NODE_NOT_EXISTS = 5    # the service's error code for a node it does not hold
DISCOVERY_S = 30       # how long the service looks for the device (left to itself it looks for minutes)
COMMISSION_WAIT = 150  # the discovery time plus adding it, over Thread too


def already(dev, action, value):
    """True when the action changes nothing the device would report, so the answer need not wait for a report."""
    d, st, a = dev["domain"], dev["state"], dev["attributes"]
    v = _number(value)
    if d == "cover":
        pos = a.get("current_position")
        want = {"on": 100, "off": 0}.get(action, None if v is None else round(max(0, min(100, v))))
        return action in ("on", "off", "level", "position") and pos is not None and pos == want
    if action == "on":
        return st == "on" if d != "climate" else False
    if action == "off":
        return st == "off"
    if action == "mode":
        return d == "climate" and st == str(value or "")
    if action == "level" and v is not None:
        if d == "light":
            return st == "off" if v <= 0 else st == "on" and a.get("level") == max(1, min(100, round(v)))
        if d == "fan":
            return a.get("percentage") == int(max(0, min(100, v)))
    if action == "target" and v is not None and d == "climate":
        return a.get("temperature") == round(max(a.get("min_temp", 7), min(a.get("max_temp", 35), v)) * 2) / 2
    return False


class Matter:
    """This computer's Matter controller. `on_change(devices)` is called (at most every quarter second)
    when a device is added, removed, renamed or changes state.

    `socket_path` and `spawn=False` are for the tests: talk to a pretend service on that socket instead
    of starting the real one."""

    def __init__(self, data_dir, section=None, on_change=None, socket_path=None, spawn=True):
        section = section if isinstance(section, dict) else {}
        self.data_dir = data_dir
        self.enabled = not _off(section.get("enabled", True))
        self.spawn = spawn
        self.test_devices = _on(section.get("test_devices"))   # development boards and the SDK's sample apps
        node = section.get("node")
        self.node_bin = node.strip() if isinstance(node, str) and node.strip() else (shutil.which("node") or "node")
        for old in ("server", "port"):
            if old in section:
                log.warning("matter: config.json matter.%s is no longer used: the bridge runs its own Matter service "
                            "on a private socket (docs/MATTER.md)", old)
        self.on_change = on_change
        self.nodes = {}
        self.ready = False
        self.reason = None
        self.note = None
        self.proc = None
        self.ws = None
        self._sock = socket_path
        self._ids = itertools.count(1)
        self._pending = {}
        self._tasks = []
        self._stopping = False
        self._push = None
        self._last_mode = {}
        self._names = self._load_names()
        self._forgotten = self._load_forgotten()
        self._heard = {}   # node id -> when it last reported a change
        self._down = set()   # nodes that stopped answering a check (shown unavailable until they answer)
        self.version = 0
        self._atexit = False
        self._adding = False   # a commission is running

    # ---------------- names kept here, and devices left that did not answer
    def _names_path(self):
        return os.path.join(self.data_dir, NAMES_FILE)

    def _load_names(self):
        try:
            with open(self._names_path()) as f:
                o = json.load(f)
            return {k: v for k, v in o.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(o, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, name, obj):
        os.makedirs(self.data_dir, exist_ok=True)
        path = os.path.join(self.data_dir, name)
        tmp = path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f)
        os.replace(tmp, path)

    def _save_names(self):
        self._write(NAMES_FILE, self._names)

    def _load_forgotten(self):
        try:
            with open(os.path.join(self.data_dir, FORGOTTEN_FILE)) as f:
                o = json.load(f)
            return {str(x) for x in o if re.fullmatch(r"\d{1,20}", str(x))} if isinstance(o, list) else set()
        except (OSError, ValueError, TypeError):
            return set()

    def _save_forgotten(self):
        self._write(FORGOTTEN_FILE, sorted(self._forgotten))

    # ---------------- what the TV reads
    def devices(self):
        out = []
        for nid in sorted(self.nodes, key=lambda n: int(n) if str(n).isdigit() else 0):
            if nid not in self._forgotten:
                out += devices_of(self._view(nid), self._names)
        return out

    def _view(self, nid):
        """The node as the TV sees it: one that stopped answering a check is unavailable."""
        node = self.nodes.get(nid)
        return dict(node, available=False) if node is not None and nid in self._down else node

    def answer(self):
        o = {"devices": self.devices(), "ready": self.ready, "version": self.version}
        if not self.ready:
            if self.reason:
                o["reason"] = self.reason
            if self.note:
                o["note"] = self.note
        return o

    def _changed(self):
        self.version += 1
        if not self.on_change or self._push:
            return
        loop = asyncio.get_running_loop()

        def fire():
            self._push = None
            try:
                self.on_change(self.devices())
            except Exception:
                log.exception("matter: pushing a change failed")
        self._push = loop.call_later(0.25, fire)

    # ---------------- start and stop
    def why_not(self):
        """(reason key, plain words) for why Matter cannot start here, or None. The keys are for the screens,
        which say it in the TV's language: off, not_installed, node_missing, node_old."""
        if not self.enabled:
            return "off", "Matter is switched off on the home computer (config.json, matter, enabled)."
        if not self.spawn:
            return None
        if not os.path.isfile(ENTRY):
            return "not_installed", "Matter needs a one time set up on the home computer: run scripts/matter-setup.sh in the couch-tv folder there."
        v = node_version(self.node_bin)
        if not v:
            return "node_missing", "Matter needs Node.js 22.13 or newer on the home computer. It is not installed there."
        if v < NODE_MIN:
            return "node_old", "Matter needs Node.js 22.13 or newer on the home computer. It has %d.%d." % v
        return None

    async def start(self):
        why = await asyncio.to_thread(self.why_not)   # runs node --version: never on the event loop
        if why:
            self.reason, self.note = why
            log.info("matter: %s", self.note)
            return
        self.reason, self.note = "starting", STARTING
        if self.spawn:
            self._tasks.append(asyncio.ensure_future(self._service_loop()))
            self._tasks.append(asyncio.ensure_future(self._log_loop()))
        self._tasks.append(asyncio.ensure_future(self._connect_loop()))
        self._tasks.append(asyncio.ensure_future(self._probe_loop()))

    async def stop(self):
        self._stopping = True
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        if self.ws is not None and not self.ws.closed:
            await self.ws.close()
        if self._push:
            self._push.cancel()
            self._push = None
        await self._end_service()

    def _pidfile(self):
        return os.path.join(self._storage(), "service.pid")

    def _logpath(self):
        return os.path.join(self._storage(), "service.log")

    @staticmethod
    async def _command_line(pid):
        """The command line of a process, or "" (Linux: /proc; macOS: ps)."""
        try:
            with open("/proc/%d/cmdline" % pid, "rb") as f:
                return f.read().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            pass
        try:
            p = await asyncio.create_subprocess_exec("ps", "-p", str(pid), "-o", "command=", stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(p.communicate(), 5)
            return out.decode(errors="replace")
        except (OSError, asyncio.TimeoutError):
            return ""

    async def _end_leftover(self):
        """A service left running by a bridge that was killed holds the fabric store: end it. Only a
        process whose command line is this bridge's own Matter service is touched. True when one was ended."""
        try:
            with open(self._pidfile()) as f:
                pid = int(f.read().strip())
        except (OSError, ValueError):
            return False
        cmd = await self._command_line(pid)
        if not (ENTRY in cmd and self._storage() in cmd):
            return False
        log.info("matter: ending a Matter service left running (pid %s)", pid)
        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(40):
                await asyncio.sleep(0.2)
                os.kill(pid, 0)
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
        return True

    def _kill_at_exit(self):
        p = self.proc
        if p and p.returncode is None:
            try:
                p.terminate()
            except (OSError, ProcessLookupError):
                pass

    async def _end_service(self):
        p, self.proc = self.proc, None
        if p and p.returncode is None:
            p.terminate()
            try:
                await asyncio.wait_for(p.wait(), 8)
            except asyncio.TimeoutError:
                p.kill()
                await p.wait()
        if p:
            try:
                os.remove(self._pidfile())
            except OSError:
                pass

    def _storage(self):
        d = os.path.join(self.data_dir, "matter")
        os.makedirs(d, mode=0o700, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass
        return d

    def socket_path(self):
        """Where the service listens: a unix socket in a folder only this user can open (mode 700), never
        a network port, so no web page and no other user of this computer can reach it."""
        if not self._sock:
            p = os.path.join(self._storage(), SOCKET)
            if len(p.encode()) > SOCKET_MAX:
                p = os.path.join(short_private_dir(self._storage()), SOCKET)
            self._sock = p
        return self._sock

    def service_args(self):
        args = [self.node_bin, ENTRY, "--storage-path", self._storage(), "--listen-address", self.socket_path(),
                "--disable-dashboard", "--disable-ota", "--disable-thread-diagnostics",
                "--default-fabric-label", FABRIC_LABEL, "--log-level", "warn"]
        if self.test_devices:
            args.append("--enable-test-net-dcl")
        return args

    def _trim_log(self):
        """Keeps the service's log under 5 MB while it runs: the full log goes to service.log.1 and the
        log starts again (the service writes to the end of it, wherever that is)."""
        path = self._logpath()
        try:
            if os.path.getsize(path) <= LOG_MAX:
                return False
            shutil.copyfile(path, path + ".1")
            os.truncate(path, 0)
            return True
        except OSError:
            return False

    async def _log_loop(self):
        while not self._stopping:
            await asyncio.sleep(LOG_CHECK)
            self._trim_log()

    async def _service_loop(self):
        wait = 3
        while not self._stopping:
            logpath = self._logpath()
            self._trim_log()
            started = time.time()
            await self._end_leftover()
            try:
                with open(logpath, "ab") as lf:
                    self.proc = await asyncio.create_subprocess_exec(*self.service_args(), stdin=asyncio.subprocess.DEVNULL,
                                                                     stdout=lf, stderr=lf, cwd=SERVICE_DIR)
                log.info("matter: the Matter service started (pid %s, %s)", self.proc.pid, self.socket_path())
                with open(self._pidfile(), "w") as f:
                    f.write(str(self.proc.pid))
                if not self._atexit:
                    atexit.register(self._kill_at_exit)   # the bridge ending any way but a kill ends the service too
                    self._atexit = True
                code = await self.proc.wait()
            except asyncio.CancelledError:
                raise
            except OSError as e:
                code = str(e)
            self.proc = None
            if self._stopping:
                return
            log.warning("matter: the Matter service stopped (%s); starting it again in %ss (log: %s)", code, wait, logpath)
            self.ready, self.reason, self.note = False, "stopped", "Matter stopped on the home computer. It is starting again."
            await asyncio.sleep(wait)
            wait = 3 if time.time() - started > 300 else min(wait * 2, 120)

    async def _connect_loop(self):
        import aiohttp
        while not self._stopping:
            try:
                async with aiohttp.ClientSession(connector=aiohttp.UnixConnector(path=self.socket_path())) as session:
                    async with session.ws_connect("http://localhost/ws", heartbeat=30, max_msg_size=64 * 1024 * 1024) as ws:
                        self.ws = ws
                        await self._listen(ws)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("matter: not connected (%s)", e)
            self.ws = None
            if self.ready:
                log.warning("matter: lost the Matter service; trying again")
            self.ready = False
            if self.reason != "stopped":
                self.reason, self.note = "starting", STARTING
            for f in self._pending.values():
                if not f.done():
                    f.set_exception(ConnectionError("lost the Matter service"))
            self._pending.clear()
            await asyncio.sleep(2)

    async def _listen(self, ws):
        import aiohttp
        first = await ws.receive(timeout=30)
        info = json.loads(first.data) if first.type == aiohttp.WSMsgType.TEXT else {}
        log.info("matter: connected to %s", info.get("sdk_version", "the Matter service"))
        reader = asyncio.ensure_future(self._read(ws))
        try:
            nodes = await self.request("start_listening", {}, timeout=120)
            self.nodes = {str(n["node_id"]): n for n in nodes or [] if isinstance(n, dict)}
            done = {n for n in self._forgotten if n not in self.nodes}
            if done:
                self._forgotten -= done
                self._save_forgotten()
            for nid in sorted(self._forgotten):
                self._tasks.append(asyncio.ensure_future(self._leave_again(nid)))
            self.ready, self.reason, self.note = True, None, None
            self._changed()
            await reader
        finally:
            reader.cancel()

    async def _leave_again(self, nid):
        """A device forgotten while it did not answer: leave its fabric properly now."""
        await self._tell_to_drop(nid)
        try:
            await self.request("remove_node", {"node_id": int(nid)}, timeout=60)
        except (MatterError, ConnectionError) as e:
            log.info("matter: leaving node %s again failed (%s)", nid, e)
            return
        self._forgotten.discard(nid)
        self._save_forgotten()
        self.nodes.pop(nid, None)

    async def _read(self, ws):
        import aiohttp
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
                continue
            try:
                d = json.loads(msg.data)
            except ValueError:
                continue
            if "event" in d:
                self._event(d["event"], d.get("data"))
            elif "message_id" in d:
                f = self._pending.pop(str(d["message_id"]), None)
                if f and not f.done():
                    f.set_result(d)

    def _event(self, name, data):
        if name in ("node_added", "node_updated") and isinstance(data, dict):
            self.nodes[str(data.get("node_id"))] = data
            if data.get("available") is True:
                self._down.discard(str(data.get("node_id")))
        elif name == "node_removed":
            self.nodes.pop(str(data), None)
            if str(data) in self._forgotten:
                self._forgotten.discard(str(data))
                self._save_forgotten()
        elif name == "attribute_updated" and isinstance(data, list) and len(data) == 3:
            n = self.nodes.get(str(data[0]))
            if n is None:
                return
            n.setdefault("attributes", {})[data[1]] = data[2]
            self._heard[str(data[0])] = time.monotonic()
            self._down.discard(str(data[0]))
        else:
            return
        self._changed()

    async def _probe_loop(self):
        """The service notices a device that stopped answering only when its subscription runs out, which
        can take many minutes. So a device not heard from for PROBE_QUIET seconds is asked for one value;
        one that does not answer is shown unavailable until it answers again (contract: "unavailable").
        A sleepy battery device (it has the ICD cluster) is left to the service, so no extra wake ups."""
        probing = set()
        while not self._stopping:
            await asyncio.sleep(PROBE_EVERY)
            if not self.ready:
                continue
            now = time.monotonic()
            for nid, node in list(self.nodes.items()):
                if nid in self._forgotten or nid in probing or ICD in endpoints(node).get(0, set()):
                    continue
                if nid not in self._down and now - self._heard.setdefault(nid, now) < PROBE_QUIET:
                    continue
                probing.add(nid)
                fut = asyncio.ensure_future(self._probe(nid))
                fut.add_done_callback(lambda _f, n=nid: probing.discard(n))

    async def _probe(self, nid):
        try:
            r = await self.request("read_attribute", {"node_id": int(nid), "attribute_path": "0/40/0"}, timeout=PROBE_TIMEOUT)
            answered = bool(r)
        except MatterError:
            answered = False
        if nid not in self.nodes:
            return
        if answered:
            self._heard[nid] = time.monotonic()
            if nid in self._down:
                self._down.discard(nid)
                self._changed()
                try:   # back again: read everything once, in case reports were missed while it was away
                    await self.request("interview_node", {"node_id": int(nid)}, timeout=60)
                except MatterError as e:
                    log.info("matter: reading node %s again failed (%s)", nid, e.reason)
        elif nid not in self._down:
            log.info("matter: node %s stopped answering", nid)
            self._down.add(nid)
            self._changed()

    async def request(self, command, args, timeout=30):
        """One API command. Returns its result; raises MatterError with the service's answer."""
        ws = self.ws
        if ws is None or ws.closed:
            raise MatterError("not_ready", None, "")
        mid = str(next(self._ids))
        f = asyncio.get_running_loop().create_future()
        self._pending[mid] = f
        await ws.send_str(json.dumps({"message_id": mid, "command": command, "args": args}))
        try:
            d = await asyncio.wait_for(f, timeout)
        except asyncio.TimeoutError:
            self._pending.pop(mid, None)
            raise MatterError("timeout", None, "no answer")
        except ConnectionError as e:
            raise MatterError("not_ready", None, str(e))
        if "error_code" in d:
            raise MatterError(d.get("reason") or "error", d.get("error_code"), str(d.get("details") or ""))
        return d.get("result")

    # ---------------- what the TV asks
    def _node_of(self, did):
        """(node id, node, endpoint) for any id of a node this computer holds, shown or not, else (None, None, None)."""
        m = re.fullmatch(r"matter:(\d{1,20}):(\d{1,5})", str(did or ""))
        if not m or m.group(1) in self._forgotten:
            return None, None, None
        node = self._view(m.group(1))
        if not node or int(m.group(2)) not in endpoints(node):
            return None, None, None
        return m.group(1), node, int(m.group(2))

    def _find(self, did):
        nid, node, ep = self._node_of(did)
        if not node:
            return None, None, None
        dev = next((d for d in devices_of(node, self._names) if d["id"] == did), None)
        return (dev, node, ep) if dev else (None, None, None)

    async def _tell_to_drop(self, nid):
        """Asks the device itself to drop Couch TV's fabric (OperationalCredentials RemoveFabric with the
        fabric index it gave us). The service's remove_node only does that while it holds a live
        subscription to the device, and straight after adding a device it has none: the fixture lock
        and alarm kept Couch TV's keys that way.

        The device usually drops the secure session before it answers, so the answer says nothing:
        Couch TV checks instead. If it can still read the device as itself, the fabric is still there
        and it tries again (a device just restarted can miss the first one: the plug did, live).
        True when the device no longer answers Couch TV after a RemoveFabric."""
        sent = False
        for attempt in range(3):
            try:
                r = await self.request("read_attribute", {"node_id": int(nid), "attribute_path": "0/62/5"},
                                       timeout=20 if attempt == 0 else 10)
            except MatterError as e:
                if sent:
                    return True      # Couch TV cannot reach it as itself any more: the fabric is gone
                log.info("matter: node %s did not answer before leaving (%s %s)", nid, e.reason, e.code)
                return False
            idx = r.get("0/62/5") if isinstance(r, dict) else None
            if not isinstance(idx, int) or idx <= 0:
                return False
            try:
                await self.request("device_command", {"node_id": int(nid), "endpoint_id": 0, "cluster_id": 62,
                                                      "command_name": "RemoveFabric", "payload": {"fabricIndex": idx}}, timeout=15)
            except MatterError:
                pass                 # the expected end: the session closed under the answer
            sent = True
            await asyncio.sleep(1)
        log.info("matter: node %s still answers Couch TV after three RemoveFabric", nid)
        return False

    async def _leave(self, nid, tell=True):
        """Leave a node's fabric: the device is told to drop it, then the service forgets the node. True
        when the service did it. Otherwise the node is forgotten here anyway (never shown again) and
        left properly the next time the service is reached."""
        if tell:
            await self._tell_to_drop(nid)
        try:
            await self.request("remove_node", {"node_id": int(nid)}, timeout=60)
            return True
        except MatterError as e:
            if e.code == NODE_NOT_EXISTS:
                # the device took RemoveFabric and the service let the node go by itself (seen live):
                # it is left, nothing to do later
                self.nodes.pop(str(nid), None)
                return True
            log.info("matter: leaving node %s failed (%s %s); forgotten here", nid, e.reason, e.code)
            self._forgotten.add(str(nid))
            self._save_forgotten()
            return False

    async def commission(self, code, address=None):
        """Adds a shared device. One at a time: a second one while the first is still being added answers
        at once with error and reason "busy" (contract change 15), never waits behind it."""
        if self._adding:
            return {"ok": False, "device_ids": [], "error": "busy", "reason": "busy", "note": BUSY_NOTE}
        self._adding = True
        try:
            return await self._commission(code, address)
        finally:
            self._adding = False

    async def _commission(self, code, address=None):
        c = clean_code(code)
        if not c:
            return {"ok": False, "device_ids": [], "error": "wrong_code", "reason": "wrong_code",
                    "note": "That code does not look right. Check the 11 digits, or make a new code in the other app."}
        ip = None
        if address not in (None, ""):
            ip, why = address_problem(address)
            if not ip:
                return {"ok": False, "device_ids": [], "error": "unreachable", "reason": why, "note": ADDRESS_NOTES[why]}
        if not self.ready:
            return {"ok": False, "device_ids": [], "error": "unreachable", "reason": self.reason or "starting",
                    "note": self.note or STARTING}
        try:
            # a wrong code is known in seconds, but the service keeps looking for another device with the
            # same discriminator until its discovery time runs out (minutes when left to itself)
            if ip:
                pin = (await self.request("parse_onboarding_payload", {"code": c}, timeout=15)) or {}
                pin = pin.get("setup_pin_code") or next((x.get("setup_pin_code") for x in pin.get("payloads") or []), None)
                if not pin:
                    return {"ok": False, "device_ids": [], "error": "wrong_code", "reason": "wrong_code",
                            "note": "That code did not work."}
                node = await self.request("commission_on_network", {"setup_pin_code": pin, "ip_addr": ip,
                                                                     "discovery_timeout_s": DISCOVERY_S}, timeout=COMMISSION_WAIT)
            else:
                node = await self.request("commission_with_code", {"code": c, "network_only": True,
                                                                   "discovery_timeout_s": DISCOVERY_S}, timeout=COMMISSION_WAIT)
        except MatterError as e:
            return await self._commission_error(e)
        if not isinstance(node, dict) or node.get("node_id") is None:
            return {"ok": False, "device_ids": [], "error": "unreachable", "reason": "unreachable",
                    "note": "The device did not answer."}
        nid = str(node["node_id"])
        self.nodes[nid] = node
        if not devices_of(node, self._names):
            # a lock, an alarm, a garage door, or a kind of device Couch TV cannot show: never kept on
            # this computer's fabric, where it would be invisible and could not be removed from the TV
            blocked = blocked_only(node) or any(kind_of(node, ep, cl) for ep, cl in endpoints(node).items() if ep)
            await self._leave(nid)
            self.nodes.pop(nid, None)
            self._changed()
            return {"ok": False, "device_ids": [], "error": "not_allowed", "reason": "blocked" if blocked else "unsupported",
                    "note": LOCK_NOTE if blocked else UNSUPPORTED_NOTE}
        self._changed()
        return {"ok": True, "device_ids": [d["id"] for d in devices_of(node, self._names)]}

    async def _commission_error(self, e):
        details = e.details.lower()
        reason = None   # the error key itself unless a branch says more
        if e.reason in ("passcode-mismatch", "invalid-payload") or "passcode" in details or "invalid" in details and "code" in details:
            key, note = "wrong_code", "That code did not work. Make a new code in the other app and type it in again."
        elif "already commissioned" in details or "already-commissioned" in details:
            key, note = "already", "This device is already on Couch TV."
        elif e.reason == "not-discovered":
            key, note = "expired", ("The device did not answer to that code. A shared code works for a few minutes only: "
                                    "make a new one and try again, with the device switched on.")
        elif e.reason == "timeout" or "timeout" in details or "timed out" in details:
            if not await asyncio.to_thread(thread_route):   # netstat or ip: never on the event loop
                key, note = "thread", ("The home computer cannot reach your Thread network. A Thread hub (a Google Nest hub, "
                                       "an Apple TV or HomePod, or a SmartThings hub) must be on, on the same Wi-Fi.")
            else:
                key, note = "unreachable", "The device stopped answering. Check it is switched on and try again."
        elif e.reason == "attestation-rejected":
            key, note = "unreachable", "This device is not a certified Matter device, so it cannot be added."
            reason = "not_certified"
        elif e.reason == "not_ready":
            key, note, reason = "unreachable", STARTING, "not_ready"
        else:
            key, note = "unreachable", "The device could not be added. Make a new code and try again."
            reason = "failed"
        if key in ("expired", "unreachable", "thread") and reason is None and await asyncio.to_thread(multicast_blocked):
            # not the code or the device: this Mac blocks the bridge from looking (Local Network permission)
            key, note, reason = "unreachable", LOCAL_NETWORK_NOTE, "local_network"
        log.info("matter: adding a device failed (%s, %s)", e.reason, e.code)
        return {"ok": False, "device_ids": [], "error": key, "reason": reason or key, "note": note}

    async def command(self, did, action, value=None):
        action = str(action or "")
        if action not in ACTIONS:
            return {"ok": False, "error": "refused", "reason": "bad_request"}
        dev, node, ep = self._find(did)
        if not dev:
            return {"ok": False, "error": "refused", "reason": "not_found"}
        if dev["state"] == "unavailable":
            return {"ok": False, "error": "unavailable", "reason": "not_ready", "state": "unavailable"}
        steps = plan(dev, node, ep, action, value, self._last_mode.get(did))
        if not steps:   # this device cannot do that action, or the value is not one it takes
            return {"ok": False, "error": "refused", "reason": "bad_request", "state": dev["state"]}
        if dev["domain"] == "climate" and dev["state"] != "off":
            self._last_mode[did] = dev["state"]
        nid = str(node["node_id"])
        wait = not already(dev, action, value)   # nothing will change: no report is coming, so no wait for one
        sent = time.monotonic()
        try:
            for s in steps:
                if s[0] == "cmd":
                    await self.request("device_command", {"node_id": node["node_id"], "endpoint_id": ep, "cluster_id": s[1],
                                                          "command_name": s[2], "payload": s[3]}, timeout=20)
                else:
                    r = await self.request("write_attribute", {"node_id": node["node_id"], "attribute_path": s[1], "value": s[2]}, timeout=20)
                    if isinstance(r, list) and any(isinstance(x, dict) and x.get("Status") not in (0, None) for x in r):
                        raise MatterError("status", None, "write refused")
            # the device's own report of the change: the first one within 2.5 seconds, then until it goes quiet
            while wait and time.monotonic() - sent < 2.5:
                heard = self._heard.get(nid, 0)
                if heard > sent and time.monotonic() - heard > 0.3:
                    break
                await asyncio.sleep(0.05)
        except MatterError as e:
            log.info("matter: %s on %s failed (%s %s)", action, did, e.reason, e.code)
            if e.code in (3, 4):
                return {"ok": False, "error": "unavailable", "reason": "not_ready", "state": dev["state"]}
            return {"ok": False, "error": "failed", "reason": "device_refused" if e.reason == "status" else "failed",
                    "state": dev["state"]}
        now, _, _ = self._find(did)
        now = now or dev
        return {"ok": True, "state": now["state"], "device": now}

    async def remove(self, did):
        """Couch TV leaves the device's fabric: every id of that node goes, shown or not. A device that
        does not answer is forgotten here anyway (contract change 7), with a note saying so."""
        nid, node, _ = self._node_of(did)
        if not node:
            return {"ok": False, "error": "refused", "reason": "not_found"}
        removed = [d["id"] for d in devices_of(node, self._names)]
        offline = node.get("available") is False
        left = await self._leave(nid, tell=not offline)
        self.nodes.pop(nid, None)
        gone = [k for k in self._names if k.startswith("matter:%s:" % nid)]
        for k in gone:
            self._names.pop(k)
        if gone:
            self._save_names()
        self._changed()
        out = {"ok": True, "removed": removed}
        if not left:
            out.update(reason="not_answering", note=NOT_ANSWERING_NOTE)
        elif offline:
            out.update(reason="offline", note=OFFLINE_NOTE)
        return out

    def rename(self, did, name):
        dev, node, ep = self._find(did)
        name = re.sub(r"\s+", " ", str(name or "")).strip()
        if not dev:
            return {"ok": False, "error": "refused", "reason": "not_found"}
        if not NAME.fullmatch(name):
            return {"ok": False, "error": "refused", "reason": "bad_name",
                    "note": "A name is 1 to 40 letters, numbers or spaces."}
        if hidden_by_name(dev["domain"], endpoints(node).get(ep, set()), name):
            return {"ok": False, "error": "refused", "reason": "opens_house", "note": NAME_HIDES_NOTE}
        self._names[did] = name
        self._save_names()
        self._changed()
        return {"ok": True, "name": name}


class MatterError(Exception):
    def __init__(self, reason, code, details):
        super().__init__("%s %s %s" % (reason, code, details))
        self.reason, self.code, self.details = reason, code, details
