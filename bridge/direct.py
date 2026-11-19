"""Philips Hue and AirTouch 5 straight from this computer, with no Home Assistant.

The same method guest-tv, our sibling project for guest TVs, uses:
  - Philips Hue: the Hue bridge's own local API (http://<hue bridge>/api/<user>/...). The user is made
    once by pressing the round link button on top of the Hue bridge, then "Pair" within 30 seconds.
    Each Hue light shows as a control named light.hue_<number>, beside any Home Assistant ones.
  - AirTouch 5: the wall console's local port (TCP 9005, found with a UDP 49005 call on the Wi-Fi),
    through airtouch5py (Apache 2.0, pinned in requirements.txt). Each zone shows as a room named
    climate.airtouch_<zone number>: on, off and its own temperature. The unit's mode stays as it is set
    on the wall (couch-tv never changes cooling to heating from a TV remote). A TV cannot open the
    console's port from a web page, so AirTouch always goes through this computer, on every TV.

Where the set up comes from, in order: bridge/data/direct.json (made from the TV: Home settings,
couch-tv Studio, Smart home; kept on this computer only, mode 600), then config.json's "hue" and
"airtouch" sections (with HUE_USERNAME in .env). Nothing here is logged or sent to the page except
names and readings. Every call goes to the set up address only and gives up after a few seconds.
"""
import asyncio
import ipaddress
import json
import os
import re
import time

FILE = "direct.json"
HOST = re.compile(r"[A-Za-z0-9.-]{1,253}")
HUE_USER = re.compile(r"[A-Za-z0-9_-]{20,64}")
HUE_ID = re.compile(r"[0-9]{1,4}")
HUE_ENTITY = re.compile(r"light\.hue_([0-9]{1,4})")
AT_ENTITY = re.compile(r"climate\.airtouch_([0-9]{1,2})")
MAX_LIGHTS, MAX_ZONES = 16, 16
AT_MODES = {"auto": "auto", "heat": "heat", "dry": "dry", "fan": "fan_only", "cool": "cool", "auto_heat": "heat_cool", "auto_cool": "heat_cool"}


def clean_host(v):
    """A Hue bridge or AirTouch console address: an IP on this home's network or a plain host name."""
    s = str(v or "").strip()
    s = re.sub(r"^https?://", "", s).rstrip("/")
    if not HOST.fullmatch(s) or ".." in s:
        return ""
    try:
        ip = ipaddress.ip_address(s)
        return s if (ip.is_private or ip.is_link_local) and not ip.is_loopback and not ip.is_multicast else ""
    except ValueError:
        return s if "." in s or s.isalnum() else ""


def _ids(v, ok, most):
    return [str(x) for x in (v if isinstance(v, list) else []) if isinstance(x, (str, int)) and ok.fullmatch(str(x))][:most]


def _names(v, most):
    return [str(x).strip()[:24] for x in (v if isinstance(v, list) else []) if isinstance(x, str) and str(x).strip()][:most]


class Direct:
    """Hue and AirTouch for one house. `http` and `airtouch_session` can be replaced in tests."""

    def __init__(self, data_dir, config=None, env=None):
        self.data_dir = data_dir
        self.config = config if isinstance(config, dict) else {}
        self.env = env if env is not None else os.environ
        self.http = self._http
        self.airtouch_session = self._airtouch_session
        self.find_airtouch = self._find_airtouch
        self.lock = asyncio.Lock()
        self.cache = {"at": 0, "data": None}
        self.names = {"hue": {}, "airtouch": {}}

    # ---------------- the set up
    def _path(self):
        return os.path.join(self.data_dir, FILE)

    def _kept(self):
        try:
            with open(self._path()) as f:
                o = json.load(f)
            return o if isinstance(o, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, o):
        os.makedirs(self.data_dir, exist_ok=True)
        tmp = self._path() + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(o, f)
        os.replace(tmp, self._path())

    def hue(self):
        k = self._kept().get("hue")
        if not isinstance(k, dict):
            c = self.config.get("hue")
            k = dict(c, user=c.get("user") or self.env.get("HUE_USERNAME", "")) if isinstance(c, dict) and c.get("enabled", True) is not False else None
        if not k:
            return None
        addr, user = clean_host(k.get("address") or k.get("bridge")), str(k.get("user") or "")
        if not addr or not HUE_USER.fullmatch(user):
            return None
        return {"address": addr, "user": user, "lights": _ids(k.get("lights"), HUE_ID, MAX_LIGHTS)}

    def airtouch(self):
        k = self._kept().get("airtouch")
        if not isinstance(k, dict):
            c = self.config.get("airtouch")
            k = c if isinstance(c, dict) and c.get("enabled", True) is not False else None
        if not k:
            return None
        addr = clean_host(k.get("address") or k.get("ip"))
        if not addr:
            return None
        return {"address": addr, "zones": _names(k.get("zones"), MAX_ZONES)}

    def on(self):
        return bool(self.hue() or self.airtouch())

    def status(self):
        h, a = self.hue(), self.airtouch()
        return {"hue": bool(h), "hue_lights": len(h["lights"]) if h else 0, "airtouch": bool(a),
                "airtouch_lib": self.airtouch_ready()}

    @staticmethod
    def airtouch_ready():
        try:
            import airtouch5py  # noqa: F401
            return True
        except ImportError:
            return False

    # ---------------- Hue
    async def _http(self, method, url, body=None, limit=512 * 1024):
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=6, connect=3), cookie_jar=aiohttp.DummyCookieJar()) as s:
                async with s.request(method, url, json=body, allow_redirects=False) as r:
                    data = await r.content.read(limit + 1)
                    if r.status != 200 or len(data) > limit:
                        return None
                    return json.loads(data.decode("utf-8", "replace"))
        except Exception:
            return None

    async def hue_pair(self, address):
        """The link button: press it on the Hue bridge, then this, within 30 seconds."""
        addr = clean_host(address)
        if not addr:
            return {"ok": False, "error": "address"}
        r = await self.http("POST", "http://%s/api" % addr, {"devicetype": "couch-tv#home"})
        if not isinstance(r, list) or not r or not isinstance(r[0], dict):
            return {"ok": False, "error": "unreachable"}
        if (r[0].get("error") or {}).get("type") == 101:
            return {"ok": False, "error": "button"}
        user = str((r[0].get("success") or {}).get("username") or "")
        if not HUE_USER.fullmatch(user):
            return {"ok": False, "error": "not_hue"}
        o = self._kept()
        o["hue"] = {"address": addr, "user": user, "lights": []}
        self._write(o)
        return {"ok": True, "lights": await self.hue_all()}

    async def hue_all(self):
        """Every light the Hue bridge knows: [{id, name}], for ticking on the TV."""
        h = self.hue()
        if not h:
            return []
        r = await self.http("GET", "http://%s/api/%s/lights" % (h["address"], h["user"]))
        if not isinstance(r, dict):
            return []
        out = [{"id": k, "name": str((v or {}).get("name") or "Light " + k)[:40]} for k, v in r.items() if HUE_ID.fullmatch(str(k)) and isinstance(v, dict)]
        return sorted(out, key=lambda x: int(x["id"]))[:64]

    def hue_save(self, lights):
        o, h = self._kept(), self.hue()
        if not h or not isinstance(o.get("hue"), dict):
            return {"ok": False, "error": "pair"}
        o["hue"]["lights"] = _ids(lights, HUE_ID, MAX_LIGHTS)
        self._write(o)
        return {"ok": True}

    async def hue_lights(self):
        h = self.hue()
        if not h or not h["lights"]:
            return []
        r = await self.http("GET", "http://%s/api/%s/lights" % (h["address"], h["user"]))
        out = []
        for lid in h["lights"]:
            v = (r or {}).get(lid) if isinstance(r, dict) else None
            name = str((v or {}).get("name") or self.names["hue"].get(lid) or "Light " + lid)[:40]
            self.names["hue"][lid] = name
            o = {"entity": "light.hue_" + lid, "name": name, "kind": "light"}
            st = (v or {}).get("state") if isinstance(v, dict) else None
            if not isinstance(st, dict) or st.get("reachable") is False:
                o["ok"] = False
            else:
                on = st.get("on") is True
                o.update(ok=True, state="on" if on else "off", on=on)
                if on and isinstance(st.get("bri"), (int, float)):
                    o["level"] = max(1, min(100, round(st["bri"] / 254.0 * 100)))
            out.append(o)
        return out

    async def hue_set(self, entity, value):
        h, m = self.hue(), HUE_ENTITY.fullmatch(str(entity or ""))
        if not h or not m or m.group(1) not in h["lights"] or value not in ("on", "off"):
            return {"ok": False, "error": "refused"}
        r = await self.http("PUT", "http://%s/api/%s/lights/%s/state" % (h["address"], h["user"], m.group(1)), {"on": value == "on"})
        ok = isinstance(r, list) and any(isinstance(x, dict) and "success" in x for x in r)
        return {"ok": True} if ok else {"ok": False, "error": "failed"}

    # ---------------- AirTouch 5
    async def _find_airtouch(self):
        from airtouch5py.discovery import AirtouchDiscovery
        d = AirtouchDiscovery()
        await d.establish_server()
        try:
            found = await asyncio.wait_for(d.discover(), 6)
        finally:
            await d.close()
        return [clean_host(x.ip) for x in found if clean_host(x.ip)][:4]

    async def airtouch_find(self):
        if not self.airtouch_ready():
            return {"ok": False, "error": "library"}
        try:
            found = await self.find_airtouch()
        except Exception:
            found = []
        return {"ok": True, "found": found} if found else {"ok": False, "error": "none"}

    async def airtouch_save(self, address, zones=None):
        addr = clean_host(address)
        if not addr:
            return {"ok": False, "error": "address"}
        if not self.airtouch_ready():
            return {"ok": False, "error": "library"}
        try:
            data = await self.airtouch_session(addr)
        except Exception:
            return {"ok": False, "error": "unreachable"}
        o = self._kept()
        o["airtouch"] = {"address": addr, "zones": _names(zones, MAX_ZONES)}
        self._write(o)
        self.cache = {"at": 0, "data": None}
        return {"ok": True, "zones": [z["name"] for z in data["zones"]]}

    async def _airtouch_session(self, address, change=None):
        """One short visit to the console: read every zone, and make one change first if asked."""
        from airtouch5py.airtouch5_simple_client import Airtouch5SimpleClient
        nm = lambda e: str(e).split(".")[-1].lower()  # noqa: E731
        c = Airtouch5SimpleClient(address)
        try:
            await asyncio.wait_for(c.connect_and_stay_connected(), 12)
            if change:
                await change(c)
                await asyncio.sleep(1.5)   # the console answers a change with a fresh status
            st = c.latest_ac_status.get(0) or next(iter(c.latest_ac_status.values()))
            names = {z.zone_number: z.zone_name for z in c.zones}
            zones = []
            for n, z in sorted(c.latest_zone_status.items()):
                if not names.get(n):
                    continue
                zones.append({"id": n, "name": str(names[n])[:24], "on": nm(z.zone_power_state) in ("on", "turbo"),
                              "temp": round(z.temperature, 1) if isinstance(z.temperature, (int, float)) else None,
                              "setpoint": z.set_point if isinstance(z.set_point, (int, float)) else None,
                              "can_set": nm(z.control_method) == "temperature_control" and z.set_point is not None})
            return {"power": nm(st.ac_power_state) in ("on", "away_on", "sleep"), "mode": AT_MODES.get(nm(st.ac_mode), "auto"),
                    "setpoint": st.ac_setpoint, "zones": zones}
        finally:
            try:
                await c.disconnect()
            except Exception:
                pass

    async def _at_read(self, fresh=False):
        a = self.airtouch()
        if not a:
            return None
        async with self.lock:
            if not fresh and self.cache["data"] and time.time() - self.cache["at"] < 20:
                return self.cache["data"]
            try:
                data = await self.airtouch_session(a["address"])
            except Exception:
                return self.cache["data"] if self.cache["data"] and time.time() - self.cache["at"] < 300 else None
            self.cache = {"at": time.time(), "data": data}
            return data

    def _zones(self, data):
        a = self.airtouch() or {"zones": []}
        want = [z.lower() for z in a["zones"]]
        return [z for z in data["zones"] if not want or z["name"].lower() in want]

    async def airtouch_rooms(self):
        a = self.airtouch()
        if not a:
            return []
        data = await self._at_read()
        if not data:
            return [{"entity": "climate.airtouch_%d" % i, "name": n, "ok": False} for i, n in self.names["airtouch"].items()]
        out = []
        for z in self._zones(data):
            self.names["airtouch"][z["id"]] = z["name"]
            on = z["on"] and data["power"]
            o = {"entity": "climate.airtouch_%d" % z["id"], "name": z["name"], "ok": True, "state": data["mode"] if on else "off",
                 "min": 16.0, "max": 30.0, "step": 1.0, "modes": [], "action": "", "direct": "airtouch"}
            if z["temp"] is not None:
                o["current"] = z["temp"]
            if z["can_set"] and z["setpoint"] is not None:
                o["target"] = float(z["setpoint"])
            elif data.get("setpoint") is not None:
                o["target"] = float(data["setpoint"])
            out.append(o)
        return out

    def airtouch_names(self):
        a = self.airtouch()
        if not a:
            return []
        if self.names["airtouch"]:
            return [{"entity": "climate.airtouch_%d" % i, "name": n} for i, n in sorted(self.names["airtouch"].items())]
        return [{"entity": "climate.airtouch_%d" % i, "name": n} for i, n in enumerate(a["zones"])]

    async def airtouch_ask(self, action, entity, value):
        m = AT_ENTITY.fullmatch(str(entity or ""))
        if not m or not self.airtouch() or action not in ("on", "off", "temp"):
            return {"ok": False, "error": "refused"}
        data = await self._at_read()
        if not data:
            return {"ok": False, "error": "failed"}
        zone = next((z for z in self._zones(data) if z["id"] == int(m.group(1))), None)
        if not zone:
            return {"ok": False, "error": "refused"}
        want = None
        if action == "temp":
            try:
                want = max(16, min(30, round(float(value))))
            except (TypeError, ValueError):
                return {"ok": False, "error": "refused"}
            if not zone["can_set"]:
                return {"ok": False, "error": "refused"}
        unit_on = action == "on" and not data["power"]

        async def change(c):
            from airtouch5py.packets.zone_control import ZoneControlZone, ZoneSettingValue, ZoneSettingPower
            from airtouch5py.packets.ac_control import AcControl, SetPowerSetting, SetAcMode, SetAcFanSpeed, SetpointControl
            packets = []
            if want is not None:
                packets.append(c.data_packet_factory.zone_control([ZoneControlZone(
                    zone["id"], ZoneSettingValue.SET_TARGET_SETPOINT, ZoneSettingPower.KEEP_POWER_STATE, want)]))
            if action in ("on", "off"):
                packets.append(c.data_packet_factory.zone_control([ZoneControlZone(
                    zone["id"], ZoneSettingValue.KEEP_SETTING_VALUE, ZoneSettingPower.SET_TO_ON if action == "on" else ZoneSettingPower.SET_TO_OFF, 0)]))
            if unit_on:   # the house's own mode and fan stay as they are
                packets.append(c.data_packet_factory.ac_control([AcControl(
                    SetPowerSetting.SET_TO_ON, 0, SetAcMode.KEEP_AC_MODE, SetAcFanSpeed.KEEP_AC_FAN_SPEED, SetpointControl.KEEP_SETPOINT_VALUE, 0)]))
            for p in packets:
                await c.send_packet(p)
                await asyncio.sleep(0.4)

        async with self.lock:
            try:
                data = await self.airtouch_session(self.airtouch()["address"], change)
            except Exception:
                return {"ok": False, "error": "failed"}
            self.cache = {"at": time.time(), "data": data}
        return {"ok": True}

    def forget(self, which):
        o = self._kept()
        if which in ("hue", "airtouch"):
            o.pop(which, None)
            self.names[which] = {}
            if which == "airtouch":
                self.cache = {"at": 0, "data": None}
            self._write(o)
        return {"ok": True}
