"""AstralPool Connect 10 for TVs whose home this computer runs (Samsung, LG, VIDAA and the other web TVs), lane C 28 Nov 2026.

A Google TV, Android TV or Fire TV asks Couch TV Studio, which keeps the pool's approval code locked in the account
(tv-designer server/lib/connect10.mjs). A web TV has no account link of its own, so here the home computer is the controller,
the same way it holds Home Assistant's token for these TVs: the approval code is in .env (CONNECTMYPOOL_CODE), never in
config.json, never sent to a TV or a phone, and only ever to ConnectMyPool's own https address.

ConnectMyPool's Home Automation API (its Home Automation Integration Guide): JSON POSTs to /api/poolconfig, /api/poolstatus and
/api/poolaction with the pool's API code. Config and status answer at most once every 60 seconds, so the last answer is kept and
shared by every TV this computer runs. The TV gets the same readings as from the account: { ok, unit, temp, spa?, pump?, heater?, light? }.
Only three switches: the pump (cycle its mode), the heater (off or on) and the lights (off, auto or on), each on a device the pool has.
"""
from __future__ import annotations

import asyncio
import json
import re
import time

BASE = "https://www.connectmypool.com.au"
STATUS_TTL = 60
CONFIG_TTL = 6 * 3600
CODE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
FAIL = {1: "error", 2: "offline", 3: "no_key", 4: "no_key", 5: "no_key", 6: "throttle", 7: "offline", 8: "refused", 9: "refused",
        10: "refused", 11: "refused", 13: "refused", 15: "refused"}
COLOURS = ["", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "White", "User 1", "User 2", "Disco", "Smooth", "Fade", "Magenta", "Cyan",
           "Pattern", "Rainbow", "Ocean", "Voodoo Lounge", "Deep Blue Sea", "Royal Blue", "Afternoon Skies", "Aqua Green", "Emerald", "Warm Red",
           "Flamingo", "Vivid Violet", "Sangria", "Twilight", "Tranquillity", "Gemstone", "USA", "Mardi Gras", "Cool Cabaret", "Sam", "Party",
           "Romance", "Caribbean", "American", "California Sunset", "Royal", "Hold", "Recall", "Peruvian Paradise", "Super Nova",
           "Northern Lights", "Tidal Wave", "Patriot Dream", "Desert Skies", "Nova", "Pink"]


class PoolError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and re.match(r"^-?\d{1,4}$", v):
        return int(v)
    return None


def _name(v, dflt):
    s = re.sub(r"[\x00-\x1f\x7f<>]", "", v) if isinstance(v, str) else ""
    s = " ".join(s.split())[:24]
    return s or dflt


def _num(d, *keys):
    for k in keys:
        if isinstance(d, dict) and _int(d.get(k)) is not None:
            return _int(d.get(k))
    return None


def pool_view(cfg, st, unit="c"):
    """The readings a TV gets (the same as connect10.mjs poolView)."""
    cfg = cfg if isinstance(cfg, dict) else {}
    st = st if isinstance(st, dict) else {}
    out = {"ok": True, "unit": "f" if unit == "f" else "c", "temp": _int(st.get("temperature"))}
    if cfg.get("pool_spa_selection_enabled") is True and st.get("pool_spa_selection") in (0, 1):
        out["spa"] = st.get("pool_spa_selection") == 0
    chans = [c for c in cfg.get("channels") or [] if isinstance(c, dict)]
    ch = next((c for c in chans if _int(c.get("function")) == 1), chans[0] if chans else None)
    if ch:
        n = _num(ch, "channel_number", "channel_ number")
        s = next((x for x in st.get("channels") or [] if isinstance(x, dict) and _int(x.get("channel_number")) == n), {})
        m = _int(s.get("mode"))
        if n is not None:
            out["pump"] = {"n": n, "name": _name(ch.get("name"), "Filter"), "mode": m if m is not None and 0 <= m <= 5 else 0}
    hs = [h for h in st.get("heaters") or [] if isinstance(h, dict)]
    hc = [h for h in cfg.get("heaters") or [] if isinstance(h, dict)]
    if hs or hc:
        h = hs[0] if hs else {}
        n = _num(h, "heater_number")
        if n is None and hc:
            n = _num(hc[0], "heater_number", "heater_ number")
        if n is not None:
            s = _int(h.get("spa_set_temperature")) if out.get("spa") and _int(h.get("spa_set_temperature")) is not None else _int(h.get("set_temperature"))
            out["heater"] = {"n": n, "mode": 1 if _int(h.get("mode")) == 1 else 0, **({"set": s} if s is not None else {})}
    zones = [z for z in cfg.get("lighting_zones") or [] if isinstance(z, dict)]
    if zones:
        z = zones[0]
        n = _int(z.get("lighting_zone_number"))
        s = next((x for x in st.get("lighting_zones") or [] if isinstance(x, dict) and _int(x.get("lighting_zone_number")) == n), {})
        m, col = _int(s.get("mode")), _int(s.get("color"))
        if n is not None:
            out["light"] = {"n": n, "name": _name(z.get("name"), "Lights"), "mode": m if m in (0, 1, 2) else 0,
                            **({"colour": COLOURS[col]} if z.get("color_enabled") is True and col and 0 < col < len(COLOURS) else {})}
    return out


def action_body(code, cfg, a, unit="c"):
    """Only three switches, only on devices the pool's config has (the same as connect10.mjs actionBody)."""
    cfg = cfg if isinstance(cfg, dict) else {}
    if not isinstance(a, dict):
        raise PoolError("refused")
    dev, v = _int(a.get("dev")), (None if a.get("value") is None else _int(a.get("value")))

    def has(lst, *keys):
        return any(isinstance(x, dict) and _num(x, *keys) == dev for x in lst or [])
    kind = a.get("kind")
    if kind == "pump" and has(cfg.get("channels"), "channel_number", "channel_ number"):
        ac, val = 1, ""
    elif kind == "heater" and has(cfg.get("heaters"), "heater_number", "heater_ number") and v in (0, 1):
        ac, val = 4, str(v)
    elif kind == "light" and has(cfg.get("lighting_zones"), "lighting_zone_number") and v in (0, 1, 2):
        ac, val = 6, str(v)
    else:
        raise PoolError("refused")
    return {"pool_api_code": code, "action_code": ac, "device_number": dev, "value": val,
            "temperature_scale": 1 if unit == "f" else 0, "wait_for_execution": True}


class Pool:
    def __init__(self, cfg, code, post=None, clock=time.monotonic):
        cfg = cfg if isinstance(cfg, dict) else {}
        self.code = code.strip() if isinstance(code, str) and CODE.match(code.strip()) else None
        self.enabled = cfg.get("brand") == "connect10" and self.code is not None
        self.unit = "f" if cfg.get("unit") == "f" else "c"
        self._post = post or self._http_post
        self._clock = clock
        self._cfg, self._cfg_at = None, -1e9
        self._view, self._view_at = None, -1e9
        self._lock = asyncio.Lock()

    def state(self):
        return {"available": self.enabled}

    async def _http_post(self, path, body, timeout=15):
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
                async with s.post(BASE + path, json=body, allow_redirects=False, headers={"accept": "application/json"}) as r:
                    text = await r.text()
                    return r.status, text
        except Exception:
            raise PoolError("offline")

    async def _call(self, path, body, timeout=15):
        status, text = await self._post(path, body, timeout)
        if len(text or "") > 64 * 1024:
            raise PoolError("error")
        try:
            j = json.loads(text)
        except ValueError:
            j = None
        if isinstance(j, dict) and isinstance(j.get("failure_code"), int):
            raise PoolError(FAIL.get(j["failure_code"], "error"))
        if status != 200 or not isinstance(j, dict):
            raise PoolError("error")
        return j

    async def _config(self):
        if self._cfg is not None and self._clock() - self._cfg_at < CONFIG_TTL:
            return self._cfg
        self._cfg = await self._call("/api/poolconfig", {"pool_api_code": self.code})
        self._cfg_at = self._clock()
        return self._cfg

    async def status(self):
        """The readings, at most one ConnectMyPool read a minute for every TV this computer runs."""
        if not self.enabled:
            raise PoolError("no_key")
        async with self._lock:
            if self._view is not None and self._clock() - self._view_at < STATUS_TTL:
                return self._view
            cfg = await self._config()
            try:
                st = await self._call("/api/poolstatus", {"pool_api_code": self.code, "temperature_scale": 1 if self.unit == "f" else 0})
            except PoolError as e:
                if e.code == "throttle" and self._view is not None:
                    return self._view
                raise
            self._view = pool_view(cfg, st, self.unit)
            self._view_at = self._clock()
            return self._view

    async def act(self, a):
        if not self.enabled:
            raise PoolError("no_key")
        async with self._lock:
            cfg = await self._config()
            r = await self._call("/api/poolaction", action_body(self.code, cfg, a, self.unit), 25)
            self._view_at = -1e9          # fresh readings next (no throttle for 5 minutes after an action)
        if r.get("execution_status") == 2:
            raise PoolError("refused")
        if r.get("execution_status") == 3:
            raise PoolError("offline")
        return {"ok": True}
