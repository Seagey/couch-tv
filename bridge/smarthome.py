"""Smart home for a TV whose home this computer runs (Samsung, LG, Hisense, Philips, TiVo OS, Panasonic).

On a Google TV, Android TV or Fire TV the couch-tv app talks to Home Assistant itself
(tv-home/android/.../HomeAssistant.kt). A web TV has no app of ours, so its page asks this computer
instead (tv-home/web/smarthome.js, useBridge): the same questions, the same allow lists and the same
answers, ported from HomeAssistant.kt and HaReadings.kt so both TVs behave alike.

Where the set up comes from, in order:
  1. bridge/data/home-assistant.json, made on the TV (Home settings, couch-tv Studio, Smart home):
     the address, the token and the ticks. Kept on this computer only (mode 600), never logged,
     never sent to the page: the page gets names and readings, never the address or the token.
  2. config.json's "home_assistant" section with HOME_ASSISTANT_TOKEN in .env (docs/CONFIG.md).

Only what is ticked may be read or changed. Nothing that opens the house: locks and alarms are never
allowed, and a cover or switch whose id or device class says garage, gate, door or lock is read but
never switched. Every call goes to the set up address only, never follows a redirect, and gives up
after a few seconds.

    /api/ha/info    GET  { info, status }: names only (what HomeAssistant.kt info() and status() say)
    /api/ha         POST { action, entity, value } -> { result }: one allowed ask
    /api/ha/check   POST { url, token } -> { result: { ok, entities } }: checks, lists what can show
    /api/ha/save    POST { picks } -> { result }: keeps the ticks with the address and token checked
    /api/ha/forget  POST -> { result }: smart home off
"""
import base64
import datetime as dt
import json
import os
import re
import time
import urllib.parse

CLIMATE = re.compile(r"climate\.[a-z0-9_]{1,64}")
SCENE = re.compile(r"(scene|script)\.[a-z0-9_]{1,64}")
BELL = re.compile(r"(binary_sensor|input_boolean|event)\.[a-z0-9_]{1,64}")
CAMERA = re.compile(r"camera\.[a-z0-9_]{1,64}")
CONTROL = re.compile(r"(light|switch|fan|cover)\.[a-z0-9_]{1,64}")
SENSOR = re.compile(r"sensor\.[a-z0-9_]{1,64}")
SPEAKER = re.compile(r"media_player\.[a-z0-9_]{1,64}")
TOKEN = re.compile(r"[A-Za-z0-9._-]{20,1024}")
PICKABLE = re.compile(r"(climate|scene|script|light|switch|fan|cover|camera|sensor|media_player|event|binary_sensor|input_boolean)\.[a-z0-9_]{1,64}")
OPENS_HOUSE = re.compile(r"(cover|switch)\.[a-z0-9_]*(garage|gate|door|lock)[a-z0-9_]*")
HOUSE_OPENERS = {"garage", "gate", "door"}
MODES = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"]
FAN = re.compile(r"[A-Za-z0-9 _-]{1,24}")
UNIT = re.compile(r"[^\x00-\x1f<>]{1,12}")
HOUR = 3600 * 1000
FILE = "home-assistant.json"


def pretty(entity):
    s = entity.split(".", 1)[-1].replace("_", " ").strip()
    return s[:1].upper() + s[1:]


def clean_base(u):
    """http(s)://host[:port][/path] and nothing else, or None."""
    try:
        p = urllib.parse.urlsplit(str(u or "").strip())
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.query or p.fragment:
        return None
    try:
        port = p.port
    except ValueError:
        return None
    host = p.hostname if ":" not in p.hostname else "[%s]" % p.hostname
    return "%s://%s%s%s" % (p.scheme, host, ":%d" % port if port else "", p.path.rstrip("/"))


def parse(o):
    """A section (config.json's, or one made on the TV), checked as HomeAssistant.kt parse() checks it."""
    if not isinstance(o, dict):
        return None
    base = clean_base(o.get("url"))
    token = str(o.get("token") or "").strip()
    if not base or not TOKEN.fullmatch(token):
        return None

    def lst(key, ok, most):
        out = []
        for x in o.get(key) or []:
            if len(out) >= most:
                break
            if not isinstance(x, dict):
                continue
            ent = str(x.get("entity") or "").strip()
            if not ok.fullmatch(ent) or any(n["entity"] == ent for n in out):
                continue
            out.append({"entity": ent, "name": str(x.get("name") or "").strip()[:40]})
        return out

    bell = None
    b = o.get("doorbell")
    if isinstance(b, dict):
        ent, cam = str(b.get("entity") or "").strip(), str(b.get("camera") or "").strip() or None
        if BELL.fullmatch(ent) and (cam is None or CAMERA.fullmatch(cam)):
            bell = {"entity": ent, "camera": cam, "name": str(b.get("name") or "").strip()[:40]}
    energy = None
    e = o.get("energy")
    if isinstance(e, dict):
        ent, bat = str(e.get("entity") or "").strip(), str(e.get("battery") or "").strip() or None
        if SENSOR.fullmatch(ent) and (bat is None or SENSOR.fullmatch(bat)):
            energy = {"entity": ent, "name": str(e.get("name") or "").strip()[:40], "battery": bat}
    return {"base": base, "token": token, "climate": lst("climate", CLIMATE, 8), "scenes": lst("scenes", SCENE, 10), "doorbell": bell,
            "controls": [c for c in lst("controls", CONTROL, 16) if not OPENS_HOUSE.fullmatch(c["entity"])],
            "cameras": lst("cameras", CAMERA, 4), "sensors": lst("sensors", SENSOR, 8), "energy": energy, "speakers": lst("speakers", SPEAKER, 6)}


# ---------------------------------------------------------------- readings (HaReadings.kt)

def _down(state):
    return state is None or state in ("unavailable", "unknown")


def _base(n, st):
    friendly = str(((st or {}).get("attributes") or {}).get("friendly_name") or "").strip()
    return {"entity": n["entity"], "name": (n["name"] or friendly or pretty(n["entity"]))[:40]}


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def control(n, st):
    o = _base(n, st)
    domain = n["entity"].split(".")[0]
    o["kind"] = domain
    state = (st or {}).get("state")
    if st is None or _down(state):
        o["ok"] = False
        return o
    a = st.get("attributes") or {}
    o.update(ok=True, state=state)
    if domain == "cover":
        o["on"] = state in ("open", "opening")
        if _num(a.get("current_position")) is not None:
            o["level"] = max(0, min(100, int(a["current_position"])))
        if a.get("device_class") in HOUSE_OPENERS:
            o["blocked"] = True
    elif domain == "light":
        o["on"] = state == "on"
        if state == "on" and _num(a.get("brightness")) is not None:
            o["level"] = max(1, min(100, round(float(a["brightness"]) / 255.0 * 100)))
    elif domain == "fan":
        o["on"] = state == "on"
        if state == "on" and _num(a.get("percentage")) is not None:
            o["level"] = max(0, min(100, int(a["percentage"])))
    else:
        o["on"] = state == "on"
    return o


def service_for(entity, value, blocked):
    if blocked:
        return None
    domain = entity.split(".")[0]
    if domain == "cover":
        return {"open": ("cover", "open_cover"), "close": ("cover", "close_cover")}.get(value)
    if domain in ("light", "switch", "fan"):
        return {"on": (domain, "turn_on"), "off": (domain, "turn_off")}.get(value)
    return None


def sensor(n, st):
    o = _base(n, st)
    state = (st or {}).get("state")
    if st is None or _down(state):
        o["ok"] = False
        return o
    a = st.get("attributes") or {}
    o.update(ok=True, value=str(state)[:24])
    if _num(state) is not None:
        o["num"] = _num(state)
    u = a.get("unit_of_measurement")
    if isinstance(u, str) and UNIT.fullmatch(u):
        o["unit"] = u
    c = a.get("device_class")
    if isinstance(c, str) and re.fullmatch(r"[a-z_]{1,32}", c):
        o["cls"] = c
    return o


def speaker(n, st):
    o = _base(n, st)
    state = (st or {}).get("state")
    if st is None or _down(state):
        o["ok"] = False
        return o
    a = st.get("attributes") or {}
    f = int(a.get("supported_features") or 0)
    o.update(ok=True, state=state, can_volume=bool(f & 4), can_pause=bool(f & (1 | 16384)))
    if _num(a.get("volume_level")) is not None:
        o["volume"] = max(0, min(100, round(float(a["volume_level"]) * 100)))
    if a.get("is_volume_muted") is True:
        o["muted"] = True
    if str(a.get("media_title") or "").strip():
        o["title"] = str(a["media_title"]).strip()[:80]
    artist = str(a.get("media_artist") or a.get("media_album_artist") or "").strip()
    if artist:
        o["artist"] = artist[:80]
    return o


def room(n, st, limits):
    o = {"entity": n["entity"], "name": n["name"] or pretty(n["entity"])}
    state = (st or {}).get("state")
    if st is None or _down(state):
        o["ok"] = False
        return o
    a = st.get("attributes") or {}
    mx = _num(a.get("max_temp"))
    mx = 35.0 if mx is None else mx
    step = _num(a.get("target_temp_step")) or (1.0 if mx > 50 else 0.5)
    mn = _num(a.get("min_temp"))
    mn = 7.0 if mn is None else mn
    modes = [m for m in (a.get("hvac_modes") or []) if m in MODES]
    fans = [f for f in (a.get("fan_modes") or [])[:8] if isinstance(f, str) and FAN.fullmatch(f)]
    limits[n["entity"]] = {"min": mn, "max": mx, "step": step, "modes": modes, "fans": fans}
    if fans:
        o["fan_modes"] = fans
    if a.get("fan_mode") in fans:
        o["fan"] = a["fan_mode"]
    o.update(ok=True, state=state, min=mn, max=mx, step=step, modes=modes, action=str(a.get("hvac_action") or ""))
    for k, key in (("current", "current_temperature"), ("target", "temperature"), ("low", "target_temp_low"), ("high", "target_temp_high")):
        if _num(a.get(key)) is not None:
            o[k] = _num(a.get(key))
    if not n["name"] and a.get("friendly_name"):
        o["name"] = str(a["friendly_name"])[:40]
    return o


def parse_time(s):
    """Home Assistant's ISO 8601 time as epoch ms, or None."""
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        d = dt.datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp() * 1000)


def iso_utc(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def midnight(now_ms):
    d = dt.datetime.fromtimestamp(now_ms / 1000).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(d.timestamp() * 1000)


def points(history):
    lst = history[0] if isinstance(history, list) and history and isinstance(history[0], list) else []
    out = []
    for x in lst:
        if isinstance(x, dict):
            t = parse_time(x.get("last_changed") or x.get("last_updated"))
            if t is not None:
                out.append((t, str(x.get("state"))))
    out.sort(key=lambda p: p[0])
    return out


def _numbers(p):
    return [(t, _num(s)) for t, s in p if _num(s) is not None]


def hourly_means(p, start, hours):
    n, out, held, k = _numbers(p), [None] * hours, None, 0
    for h in range(hours):
        frm, to = start + h * HOUR, start + (h + 1) * HOUR
        while k < len(n) and n[k][0] < frm:
            held = n[k][1]
            k += 1
        s = c = 0
        while k < len(n) and n[k][0] < to:
            s += n[k][1]
            c += 1
            held = n[k][1]
            k += 1
        out[h] = s / c if c else held
    return out


def energy_hours(p, start, now, unit):
    n = _numbers(p)
    last = max(0, min(23, (now - start) // HOUR))
    hours = [0.0 if h <= last else None for h in range(24)]
    e = {"Wh": 0.001, "kWh": 1.0, "MWh": 1000.0}.get(unit.strip())
    w = {"W": 0.001, "kW": 1.0, "MW": 1000.0}.get(unit.strip())
    if e is None and w is None:
        return None

    def add(at, kwh):
        h = (at - start) // HOUR
        if 0 <= h <= last and kwh > 0:
            hours[h] = (hours[h] or 0.0) + kwh
    if e is not None:
        prev = None
        for t, v in n:
            before, prev = prev, v
            if before is None or t < start:
                continue
            add(t, (v - before if v >= before else v) * e)
    else:
        for i, (t, v) in enumerate(n):
            frm, to = max(t, start), min(n[i + 1][0] if i + 1 < len(n) else now, now)
            while frm < to:
                edge = min(to, start + ((frm - start) // HOUR + 1) * HOUR)
                add(frm, v * w * (edge - frm) / HOUR)
                frm = edge
    return hours


def last_on(p):
    at, was = None, "off"
    for t, s in p:
        if s == "on" and was != "on":
            at = t
        was = s
    return at


def series(a):
    return [None if v is None else round(v * 100) / 100.0 for v in a]


def pickable(states):
    out = []
    for st in states if isinstance(states, list) else []:
        if not isinstance(st, dict):
            continue
        ent = str(st.get("entity_id") or "")
        if not PICKABLE.fullmatch(ent) or OPENS_HOUSE.fullmatch(ent):
            continue
        a = st.get("attributes") or {}
        if ent.startswith("cover.") and a.get("device_class") in HOUSE_OPENERS:
            continue
        o = {"entity": ent, "name": (str(a.get("friendly_name") or "").strip()[:40] or pretty(ent))}
        u = a.get("unit_of_measurement")
        if isinstance(u, str) and 1 <= len(u) <= 12 and "<" not in u:
            o["unit"] = u
        c = a.get("device_class")
        if isinstance(c, str) and re.fullmatch(r"[a-z_]{1,32}", c):
            o["cls"] = c
        out.append(o)
    out.sort(key=lambda o: (o["entity"].split(".")[0], o["name"].lower()))
    return out[:400]


# ---------------------------------------------------------------- talking to Home Assistant

class Home:
    """One house's Home Assistant, as this computer sees it. `call` can be replaced in tests."""

    def __init__(self, data_dir, config_section=None, env_token=None):
        self.data_dir = data_dir
        self.config_section = config_section
        self.env_token = env_token
        self.limits, self.read_controls, self.read_speakers = {}, {}, {}
        self.pending = None
        self.call = self._call
        self.direct = None   # Philips Hue and AirTouch 5 with no Home Assistant (bridge/direct.py)

    def _direct_on(self):
        return bool(self.direct and self.direct.on())

    # where the set up lives
    def _path(self):
        return os.path.join(self.data_dir, FILE)

    def _kept(self):
        try:
            with open(self._path()) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def settings(self):
        k = self._kept()
        if k:
            s = parse(k)
            if s:
                return s
        c = self.config_section
        if isinstance(c, dict) and c.get("enabled", True) is not False:
            o = dict(c)
            o.setdefault("token", self.env_token or "")
            return parse(o)
        return None

    def made_on_tv(self):
        return bool(self._kept())

    def _write(self, o):
        os.makedirs(self.data_dir, exist_ok=True)
        tmp = self._path() + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(o, f)
        os.replace(tmp, self._path())

    async def _call(self, base, token, method, path, body=None, limit=512 * 1024):
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8, connect=3), cookie_jar=aiohttp.DummyCookieJar()) as s:
                async with s.request(method, base + path, json=body, allow_redirects=False,
                                     headers={"Authorization": "Bearer " + token}) as r:
                    if r.status < 200 or r.status >= 300:
                        return r.status, None
                    data = await r.content.read(limit + 1)
                    return (-1, None) if len(data) > limit else (r.status, data)
        except Exception:
            return -1, None

    async def _json(self, s, path, limit=256 * 1024):
        code, data = await self.call(s["base"], s["token"], "GET", path, None, limit)
        if code != 200 or data is None:
            return None
        try:
            return json.loads(data.decode("utf-8", "replace"))
        except ValueError:
            return None

    async def state(self, s, entity):
        return await self._json(s, "/api/states/" + entity)

    async def service(self, s, domain, svc, data):
        code, _ = await self.call(s["base"], s["token"], "POST", "/api/services/%s/%s" % (domain, svc), data, 512 * 1024)
        return 200 <= code < 300

    async def history(self, s, entity, frm, to, limit=6 * 1024 * 1024):
        path = "/api/history/period/%s?filter_entity_id=%s&end_time=%s&minimal_response&no_attributes" % (iso_utc(frm), entity, iso_utc(to))
        h = await self._json(s, path, limit)
        return None if h is None else points(h)

    # ---------------- what the page may ask
    def info(self):
        s = self.settings()
        if not s and not self._direct_on():
            return {}

        def names(lst):
            return [{"entity": n["entity"], "name": n["name"] or pretty(n["entity"])} for n in lst]
        if s:
            o = {"climate": names(s["climate"]), "scenes": names(s["scenes"]), "doorbell": s["doorbell"] is not None,
                 "controls": names(s["controls"]), "cameras": names(s["cameras"]), "sensors": names(s["sensors"]),
                 "speakers": names(s["speakers"]), "energy": s["energy"] is not None,
                 "doorbell_camera": bool(s["doorbell"] and s["doorbell"]["camera"])}
        else:
            o = {"climate": [], "scenes": [], "doorbell": False, "controls": [], "cameras": [], "sensors": [], "speakers": [],
                 "energy": False, "doorbell_camera": False}
        if self._direct_on():
            o["climate"] = o["climate"] + self.direct.airtouch_names()
            h = self.direct.hue()
            if h:
                o["controls"] = o["controls"] + [{"entity": "light.hue_" + i, "name": self.direct.names["hue"].get(i) or "Light " + i} for i in h["lights"]]
        return o

    def status(self):
        s = self.settings()
        d = self.direct.status() if self.direct else {}
        if not s:
            return {"set": False, "direct": d} if self.direct else {"set": False}
        ids = lambda lst: [n["entity"] for n in lst]  # noqa: E731
        return {"set": True, "direct": d, "host": urllib.parse.urlsplit(s["base"]).hostname or "", "made_on_tv": self.made_on_tv(),
                "climate": ids(s["climate"]), "scenes": ids(s["scenes"]), "controls": ids(s["controls"]), "cameras": ids(s["cameras"]),
                "sensors": ids(s["sensors"]), "speakers": ids(s["speakers"]), "energy": (s["energy"] or {}).get("entity", ""), "battery": (s["energy"] or {}).get("battery") or "",
                "doorbell": (s["doorbell"] or {}).get("entity", ""), "doorbell_camera": (s["doorbell"] or {}).get("camera") or ""}

    async def answer(self, action, entity="", value="", now_ms=None):
        r = await self._direct_answer(action, str(entity or ""), str(value if value is not None else ""))
        if r is not None:
            return r
        return await self._ha_answer(action, entity, value, now_ms)

    async def _direct_answer(self, action, entity, value):
        """Hue lights and AirTouch zones, by their own names; None means it is Home Assistant's to answer."""
        if not self._direct_on():
            return None
        d = self.direct
        if action in ("temp", "on", "off", "mode", "fan") and entity.startswith("climate.airtouch_"):
            return await d.airtouch_ask(action, entity, value)
        if action == "set" and entity.startswith("light.hue_"):
            return await d.hue_set(entity, value)
        if action == "climate":
            rooms = (await self._ha_answer("climate", "", "")).get("rooms", []) if self.settings() else []
            return {"ok": True, "rooms": rooms + await d.airtouch_rooms()}
        if action == "controls":
            ctl = (await self._ha_answer("controls", "", "")).get("controls", []) if self.settings() else []
            return {"ok": True, "controls": ctl + await d.hue_lights()}
        if not self.settings():
            return {"ok": True, "sensors": []} if action == "sensors" else {"ok": True, "speakers": []} if action == "speakers" else {"ok": False, "error": "refused"}
        return None

    async def _ha_answer(self, action, entity="", value="", now_ms=None):
        s = self.settings()
        if not s:
            return {"ok": False, "error": "off"}
        refused, failed = {"ok": False, "error": "refused"}, {"ok": False, "error": "failed"}
        entity, value = str(entity or ""), str(value if value is not None else "")
        done = lambda ok: {"ok": True} if ok else failed  # noqa: E731
        idd = {"entity_id": entity}
        now = now_ms or int(time.time() * 1000)
        climate = any(c["entity"] == entity for c in s["climate"])
        if action == "climate":
            return {"ok": True, "rooms": [room(n, await self.state(s, n["entity"]), self.limits) for n in s["climate"]]}
        if action == "temp":
            lim, want = self.limits.get(entity), _num(value)
            if not climate or not lim or want is None:
                return refused
            t = round(max(lim["min"], min(lim["max"], want)) / lim["step"]) * lim["step"]
            return done(await self.service(s, "climate", "set_temperature", dict(idd, temperature=t)))
        if action == "mode":
            lim = self.limits.get(entity)
            if not climate or not lim or value not in MODES or value not in lim["modes"]:
                return refused
            return done(await self.service(s, "climate", "set_hvac_mode", dict(idd, hvac_mode=value)))
        if action == "fan":
            lim = self.limits.get(entity)
            if not climate or not lim or value not in lim["fans"]:
                return refused
            return done(await self.service(s, "climate", "set_fan_mode", dict(idd, fan_mode=value)))
        if action in ("on", "off"):
            if not climate:
                return refused
            return done(await self.service(s, "climate", "turn_on" if action == "on" else "turn_off", idd))
        if action == "scene":
            sc = next((x for x in s["scenes"] if x["entity"] == entity), None)
            if not sc:
                return refused
            return done(await self.service(s, sc["entity"].split(".")[0], "turn_on", idd))
        if action == "controls":
            out = []
            for n in s["controls"]:
                r = control(n, await self.state(s, n["entity"]))
                if r.get("ok"):
                    self.read_controls[n["entity"]] = bool(r.get("blocked"))
                out.append(r)
            return {"ok": True, "controls": out}
        if action == "set":
            if not any(c["entity"] == entity for c in s["controls"]) or entity not in self.read_controls:
                return refused
            svc = service_for(entity, value, self.read_controls[entity])
            return done(await self.service(s, svc[0], svc[1], idd)) if svc else refused
        if action == "sensors":
            return {"ok": True, "sensors": [sensor(n, await self.state(s, n["entity"])) for n in s["sensors"]]}
        if action == "history":
            if not any(x["entity"] == entity for x in s["sensors"]):
                return refused
            start = now // HOUR * HOUR - 23 * HOUR
            p = await self.history(s, entity, start, now)
            return failed if p is None else {"ok": True, "start": start, "points": series(hourly_means(p, start, 24))}
        if action == "energy":
            e = s["energy"]
            if not e:
                return refused
            st = await self.state(s, e["entity"])
            if not st:
                return failed
            a = st.get("attributes") or {}
            unit = str(a.get("unit_of_measurement") or "")
            start = midnight(now)
            p = await self.history(s, e["entity"], start, now)
            if p is None:
                return failed
            hours = energy_hours(p, start, now, unit)
            if hours is None:
                return {"ok": False, "error": "unit"}
            o = {"ok": True, "name": e["name"] or str(a.get("friendly_name") or "")[:40], "start": start, "hours": series(hours),
                 "total": round(sum(h or 0 for h in hours) * 100) / 100.0}
            if unit.strip() in ("W", "kW", "MW") and _num(st.get("state")) is not None:
                o.update(power=_num(st.get("state")), power_unit=unit.strip())
            if e["battery"]:
                b = await self.state(s, e["battery"])
                if b and _num(b.get("state")) is not None:
                    o["battery"] = max(0, min(100, round(_num(b.get("state")))))
            return o
        if action == "speakers":
            out = []
            for n in s["speakers"]:
                r = speaker(n, await self.state(s, n["entity"]))
                if r.get("ok"):
                    self.read_speakers[n["entity"]] = r
                out.append(r)
            return {"ok": True, "speakers": out}
        if action == "volume":
            r = self.read_speakers.get(entity)
            v = _num(value)
            if not any(x["entity"] == entity for x in s["speakers"]) or not r or not r.get("can_volume") or v is None:
                return refused
            return done(await self.service(s, "media_player", "volume_set", dict(idd, volume_level=max(0, min(100, int(v))) / 100.0)))
        if action == "playpause":
            r = self.read_speakers.get(entity)
            if not any(x["entity"] == entity for x in s["speakers"]) or not r or not r.get("can_pause"):
                return refused
            return done(await self.service(s, "media_player", "media_play_pause", idd))
        if action == "bell":
            b = s["doorbell"]
            if not b:
                return refused
            st = await self.state(s, b["entity"])
            if not st:
                return failed
            state, ringing = st.get("state"), False
            if b["entity"].startswith("event."):
                at = parse_time(state)
            elif state == "on":
                ringing, at = True, parse_time(st.get("last_changed"))
            else:
                p = await self.history(s, b["entity"], now - 7 * 24 * HOUR, now, 512 * 1024)
                at = last_on(p) if p else None
            o = {"ok": True, "name": b["name"] or str((st.get("attributes") or {}).get("friendly_name") or "")[:40], "ringing": ringing,
                 "camera": b["camera"] is not None, "kept": False}
            if at is not None:
                o["at"] = at
            return o
        if action == "still":
            cam = (s["doorbell"] or {}).get("camera") if entity == "doorbell" else entity
            if not cam or (not any(c["entity"] == cam for c in s["cameras"]) and (s["doorbell"] or {}).get("camera") != cam):
                return refused
            code, data = await self.call(s["base"], s["token"], "GET", "/api/camera_proxy/" + cam, None, 3 * 1024 * 1024)
            if code != 200 or not data:
                return failed
            kind = "png" if data[:4] == b"\x89PNG" else "jpeg" if data[:2] == b"\xff\xd8" else None
            if not kind:
                return failed
            return {"ok": True, "src": "data:image/%s;base64,%s" % (kind, base64.b64encode(data).decode())}
        if action == "ringstill":
            return {"ok": False, "error": "none"} if s["doorbell"] else refused
        return refused

    # ---------------- set up from the TV
    async def check(self, url, token):
        tok = str(token or "").strip()
        if not tok:
            # change the ticks later: the token kept on this computer, and only ever with the address
            # kept with it. A blank token with any other address is refused, so the kept token can never
            # be sent to a new host.
            s = self.settings()
            if not s:
                return {"ok": False, "error": "token"}
            asked = clean_base(url) if str(url or "").strip() else s["base"]
            if asked != s["base"]:
                return {"ok": False, "error": "token"}
            base, tok = s["base"], s["token"]
        else:
            base = clean_base(url)
            if not base:
                return {"ok": False, "error": "address"}
        if not TOKEN.fullmatch(tok):
            return {"ok": False, "error": "token"}
        code, data = await self.call(base, tok, "GET", "/api/", None, 64 * 1024)
        if code in (401, 403):
            return {"ok": False, "error": "token"}
        if code == -1:
            return {"ok": False, "error": "unreachable"}
        if code != 200 or not data or b"API running" not in data:
            return {"ok": False, "error": "not_ha"}
        code, data = await self.call(base, tok, "GET", "/api/states", None, 12 * 1024 * 1024)
        if code != 200 or not data:
            return {"ok": False, "error": "unreachable"}
        try:
            lst = pickable(json.loads(data.decode("utf-8", "replace")))
        except ValueError:
            return {"ok": False, "error": "not_ha"}
        self.pending = (base, tok)
        return {"ok": True, "entities": lst}

    def save(self, picks):
        p = self.pending
        if not p:
            s = self.settings()
            p = (s["base"], s["token"]) if s else None
        if not p:
            return {"ok": False, "error": "check"}
        o = dict(picks if isinstance(picks, dict) else {}, url=p[0], token=p[1])
        if not parse(o):
            return {"ok": False, "error": "picks"}
        self._write(o)
        self.limits.clear(); self.read_controls.clear(); self.read_speakers.clear()
        return {"ok": True}

    def forget(self):
        self.pending = None
        try:
            os.remove(self._path())
        except OSError:
            pass
        self.limits.clear(); self.read_controls.clear(); self.read_speakers.clear()
        return {"ok": True}


ACTIONS = {"climate", "temp", "mode", "fan", "on", "off", "scene", "controls", "set", "sensors", "history", "energy",
           "speakers", "volume", "playpause", "bell", "still", "ringstill"}
