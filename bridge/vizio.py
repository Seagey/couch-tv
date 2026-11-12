"""The connection to a VIZIO TV on SmartCast or VIZIO OS, for "kind": "vizio" in config.json.

NEW (BETA). Tested against a stand in TV on the computer only (tests/vizio_standin.py,
docs/VIZIO.md). Not one line of this has been seen from a real VIZIO yet: expect the first tester to
find something that needs fixing. scripts/vizio-check.py prints what the TV really answers, and
"trace": true logs every request and answer with the PIN and the token hidden.

How a VIZIO is reached: the SmartCast API, JSON over HTTPS on port 7345 (firmware 4.0 and newer,
and VIZIO OS) or 9000 (older firmware), with the TV's own self signed certificate (accepted for this
TV's address only, never anywhere else). The TV shows a 4 digit PIN once; the token it then hands
back goes in an AUTH header on every later request and is kept in bridge/data at 0600, never logged.

  PUT  /pairing/start                     the TV shows a PIN
  PUT  /pairing/pair                      the PIN goes back, the token comes back
  GET  /state/device/power_mode           1 on, 0 off (standby)
  PUT  /key_command/                      a remote button, as a codeset and a code
  PUT  /app/launch                        open an app, by its name space and id
  GET  /app/current                       the app in front
  GET  .../tv_settings/devices/name_input     the inputs
  GET, PUT  .../tv_settings/devices/current_input   the input on screen, and switching it
  GET  .../tv_settings/audio/volume       the volume level

Every path, field and code is in PROTOCOL, KEYS and APPS below, each marked with where it comes from.
"documented" means two public references agree on it (the open pyvizio library's constants and the
community Vizio_SmartCast_API notes). "VIZIO list" means VIZIO's own public app list. UNCONFIRMED
means one source or our own reading. None of it is seen on a real set yet.

THE HOME: couch-tv's page cannot be opened on a VIZIO by the bridge. VIZIO OS has no browser, takes no
sideloaded app, and its developer programme is a closed partner scheme. Its built in Chromecast only
opens registered receivers, and nobody has shown a VIZIO opening a page that is not Google's. So this
is a phone remote: power, keys, volume, inputs and opening apps. open_home() says so plainly. The
remote's Home (and the phone's Home) press VIZIO's own Home.

What it cannot do (docs/VIZIO.md): couch-tv's home on the TV, what is playing (only which app), typing,
screenshots, deep links into a show, ADB tools.
"""
import asyncio
import json
import logging
import os
import re
import secrets
import socket
import ssl
import time

import aiohttp

import apps
import config
from tv import TVUnavailable

HOME_PACKAGE = "app.couchtv.launcher"
PORTS = [7345, 9000]       # 7345 on firmware 4.0 and newer and VIZIO OS, 9000 before (documented)
WATCH_EVERY = 2.0          # seconds between looks at the TV
SETTINGS = "/menu_native/dynamic/tv_settings"

# Every request shape in one place, so a tester's output can correct it here.
PROTOCOL = {
    # documented: PUT {"DEVICE_NAME", "DEVICE_ID"} -> ITEM {"PAIRING_REQ_TOKEN": int, "CHALLENGE_TYPE": int}
    "pair_start": "/pairing/start",
    # documented: PUT {"DEVICE_ID", "CHALLENGE_TYPE", "RESPONSE_VALUE": PIN, "PAIRING_REQ_TOKEN"} -> ITEM {"AUTH_TOKEN"}
    "pair_finish": "/pairing/pair",
    "pair_cancel": "/pairing/cancel",              # documented: the same body as pair_finish
    "auth_header": "AUTH",                         # documented
    # documented path; ITEMS[0].VALUE. That 1 is on and 0 is standby: UNCONFIRMED (pyvizio reads it so)
    "power": "/state/device/power_mode",
    "device_info": "/state/device/deviceinfo",     # UNCONFIRMED (pyvizio only), read by vizio-check.py
    # documented: PUT {"KEYLIST": [{"CODESET": n, "CODE": n, "ACTION": "KEYPRESS"}]}, also KEYDOWN, KEYUP
    "key": "/key_command/",
    # documented path and body {"VALUE": {"NAME_SPACE": n, "APP_ID": "s", "MESSAGE": ...}}
    "launch": "/app/launch",
    "launch_message": None,                        # UNCONFIRMED: VIZIO's own list sends null, some notes ""
    # UNCONFIRMED (pyvizio only): ITEM.VALUE {"NAME_SPACE", "APP_ID", "MESSAGE"}, empty when nothing
    "current_app": "/app/current",
    # documented: ITEMS [{"CNAME", "NAME": "HDMI-1", "VALUE": {"NAME": <owner's label>}, "HASHVAL"}]
    "inputs": SETTINGS + "/devices/name_input",
    # documented: GET ITEMS[0] {"VALUE": "HDMI-1", "HASHVAL": n}; PUT {"REQUEST": "MODIFY", "VALUE", "HASHVAL"}
    # with HASHVAL from that GET, not from the list. The exact PUT shape is UNCONFIRMED on VIZIO OS.
    "current_input": SETTINGS + "/devices/current_input",
    "volume": SETTINGS + "/audio/volume",          # UNCONFIRMED: ITEMS[0].VALUE, 0 to 100
    "volume_max": 100,                             # pyvizio's figure for TVs (UNCONFIRMED)
    # documented: the answer is in STATUS.RESULT; HTTP status codes are not reliable
    "ok": {"SUCCESS"},
    "needs_pairing": {"REQUIRES_PAIRING", "REQUIRES_SYSTEM_PIN"},   # UNCONFIRMED which one a bad token gets
    "pin_wrong": {"PAIRING_DENIED", "CHALLENGE_INCORRECT", "VALUE_OUT_OF_RANGE"},
    "pin_locked": {"MAX_CHALLENGES_EXCEEDED"},
    "busy": {"BLOCKED", "BUSY"},
    # UNCONFIRMED: what /app/current says on VIZIO's own home (pyvizio's SmartCast Home)
    "home_app": (4, "1"),
    # inputs that are not a device on a socket: the TV's own apps and Cast (pyvizio)
    "app_inputs": {"SMARTCAST", "CAST"},
}

# Friendly key name -> (CODESET, CODE). From pyvizio's TV key table (one public source), so all
# UNCONFIRMED on a real set except volume and power, which the community notes also list.
KEYS = {
    "up": (3, 8), "down": (3, 0), "left": (3, 1), "right": (3, 7),
    "ok": (3, 2), "select": (3, 2), "enter": (3, 2),
    "back": (4, 0), "vizio_home": (4, 15), "menu": (4, 8), "settings": (4, 8), "info": (4, 6),
    "smartcast": (4, 3), "captions": (4, 4), "exit": (9, 0),
    "play": (2, 3), "pause": (2, 2), "fast_forward": (2, 0), "rewind": (2, 1),
    "next": (2, 0), "previous": (2, 1),
    "volume_up": (5, 1), "volume_down": (5, 0), "mute": (5, 4), "mute_on": (5, 3), "mute_off": (5, 2),
    "input": (7, 1), "channel_up": (8, 1), "channel_down": (8, 0), "channel_previous": (8, 2),
    "picture_mode": (6, 0), "picture_size": (6, 2),
    "power_off": (11, 0), "power_on": (11, 1), "power_toggle": (11, 2),
}
POWER = 11
RAW_KEY = re.compile(r"^(\d{1,2})[:/](\d{1,3})$")   # "4:15": a codeset and code typed as they are
SAFE_APP = re.compile(r"^vizio\.(\d{1,2})\.([A-Za-z0-9]{1,16})$")   # "vizio.<name space>.<app id>"
PIN = re.compile(r"^\d{4}$")
SAFE_DEVICE = re.compile(r"^[A-Za-z0-9._-]{4,64}$")

# Catalogue app -> (NAME_SPACE, APP_ID, MESSAGE), from VIZIO's own public app list
# (scfs.vizio.com/appservice, read 12 Nov 2026; the "*" chipset entry). Netflix and Hulu also match
# the community notes. None launched on a real set yet. VIZIO sells in the US, Canada and Mexico, so
# the Australian apps (Stan, Binge, iview and the rest) are not on its list at all.
APPS = {
    "netflix": (3, "1", None),
    "youtube": (5, "1", None),
    "youtube-tv": (5, "3", None),
    "prime-video": (2, "4", None),
    "hulu": (2, "3", None),
    "disney-plus": (2, "75", None),
    "paramount-plus": (2, "37", None),
    "peacock": (2, "88", None),
    "plex": (2, "9", None),
    "hbo-max": (2, "128", None),
    "apple-tv": (3, "4", None),
}
EQUIVALENT = {2: 4, 4: 2}   # name spaces 2 and 4 name the same apps (pyvizio, UNCONFIRMED)


def resolve_key(name):
    """Friendly name, or "codeset:code" -> (codeset, code). Power and home are handled before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip().lower()
    if k in KEYS:
        return KEYS[k]
    m = RAW_KEY.match(k)
    if m and int(m.group(1)) <= 15 and int(m.group(2)) <= 255:
        return int(m.group(1)), int(m.group(2))
    return None


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _result(data):
    """STATUS.RESULT, upper case, "" when there is none."""
    st = data.get("STATUS") if isinstance(data, dict) else None
    r = st.get("RESULT") if isinstance(st, dict) else None
    return str(r).upper() if r is not None else ""


def _first_item(data):
    items = data.get("ITEMS") if isinstance(data, dict) else None
    return items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}


class VizioError(RuntimeError):
    """The TV did not do what was asked, or answered with something unusable."""


class NeedsPairing(VizioError):
    """The TV is there, but wants the token pairing gives (or the one kept is no longer good)."""


class VizioTV:
    kind = "vizio"
    can_read_media = False      # the app in front only, never a title
    INPUT = re.compile(r"^(hdmi|comp|av|tv|ota|antenna)", re.I)

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"vizio.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.ports = [int(cfg["port"])] if cfg.get("port") else list(PORTS)
        self.port = None            # the port that answered, from find_port()
        self.tls = cfg.get("tls", True) is not False   # false only for the stand in TV in the tests
        self.trace = cfg.get("trace", False) is True
        self.store_file = os.path.join(config.DATA, f"vizio-{self.id}.json")
        stored = self._stored()
        did = str(cfg.get("device_id") or stored.get("device_id") or "")
        if did and not SAFE_DEVICE.match(did):
            raise SystemExit(f"tvs[{self.id}].device_id: 4 to 64 letters, digits and . _ - only")
        self.device_id = did or "couchtv-" + secrets.token_hex(6)
        self.app_id = None          # there is no couch-tv app on a VIZIO
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the SmartCast port answers
        self.power = None           # 1 on, 0 standby, None unknown
        self.visible = None         # (name space, app id) in front, () for none, None unknown
        self.front_readable = None  # whether /app/current answers at all on this TV
        self.vol = None             # the level, None unknown
        self.muted = None           # the TV does not say; a mute press flips what we last knew
        self.sources = []           # [{"id": "HDMI-1", "name": "Xbox"}]
        self._played = False        # the last of play and pause sent, for play_pause
        self._listeners = set()
        self._session = None
        self._tasks = []
        self.last_error = None      # why the last request or pairing failed, in plain words

    # ---------- what the bridge keeps for this TV (bridge/data, 0600, git ignores it) ----------
    def _stored(self):
        try:
            with open(self.store_file) as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _keep(self, **changes):
        d = self._stored() | {"device_id": self.device_id} | changes
        d = {k: v for k, v in d.items() if v is not None}
        os.makedirs(os.path.dirname(self.store_file), exist_ok=True)
        tmp = self.store_file + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(d, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.store_file)

    @property
    def token(self):
        t = self._stored().get("token")
        return t if isinstance(t, str) and t else None

    @property
    def paired(self):
        return bool(self.token)

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        if not self.connected or self.power is None:
            return None
        return self.power == 1

    @property
    def current_package(self):
        if not self.is_on or not self.visible:
            return None
        return self._package_of(self.visible)

    @property
    def volume(self):
        if not isinstance(self.vol, int):
            return {"level": None, "max": None, "muted": None, "known": False}
        return {"level": self.vol, "max": PROTOCOL["volume_max"], "muted": self.muted, "known": True}

    def on_change(self, fn):
        self._listeners.add(fn)

    def _changed(self):
        for fn in list(self._listeners):
            try:
                fn()
            except Exception:
                self.log.exception("listener failed")

    def require(self):
        if not self.connected:
            raise TVUnavailable(f"the {self.name.lower()} TV is not answering on the network")

    def can_deeplink(self, app):
        return False   # no deep link into a show is known on VIZIO: apps open on their own page

    def vizio_status(self):
        """For /api/tvs: what a tester needs to see at a glance."""
        return {"port": self.port, "paired": self.paired, "power": self.power,
                "app": list(self.visible) if self.visible else self.visible,
                "app_readable": self.front_readable, "volume": self.vol, "error": self.last_error}

    # ---------- HTTPS ----------
    def _ssl(self):
        """The TV's certificate is its own, self signed, issued to a VIZIO name rather than this
        address. It is accepted for this TV only: this context is passed on this TV's requests and
        nowhere else."""
        if not self.tls:
            return False
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    async def _http(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5))
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    def _base(self, port=None):
        return f"{'https' if self.tls else 'http'}://{self.ip or self.fallback_ip}:{port or self.port}"

    def _show(self, way, what, text):
        if not self.trace:
            return
        # never the PIN, the token or the pairing request token in a log someone may paste into an issue
        text = re.sub(r'("(?:RESPONSE_VALUE|AUTH_TOKEN|PAIRING_REQ_TOKEN|AUTH)"\s*:\s*)("[^"]*"|-?\d+)',
                      r'\1"(hidden)"', text or "", flags=re.I)
        self.log.info("trace %s %s %s", way, what, text[:600])

    async def _call(self, method, path, payload=None, auth=True, timeout=5, port=None):
        """One SmartCast request. Returns the JSON answer; raises NeedsPairing, VizioError or
        TVUnavailable. The answer is judged by STATUS.RESULT, not the HTTP status."""
        if port is None and self.port is None:
            await self.find_port()
        s = await self._http()
        body = None if payload is None else json.dumps(payload, separators=(",", ":"))
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if auth and self.token:
            headers[PROTOCOL["auth_header"]] = self.token
        self._show("out", f"{method} {path}", body)
        try:
            async with s.request(method, self._base(port) + path, data=body, headers=headers, ssl=self._ssl(),
                                 timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                text = await r.text()
                status = r.status
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ssl.SSLError) as e:
            raise TVUnavailable(f"the TV did not answer ({type(e).__name__})") from None
        self._show("in ", f"{status} {path}", text)
        try:
            data = json.loads(text) if text.strip() else {}
        except ValueError:
            data = None
        result = _result(data)
        if result in PROTOCOL["needs_pairing"] or (status in (401, 403) and data is not None and result not in PROTOCOL["ok"]):
            raise NeedsPairing("the TV wants pairing first (docs/VIZIO.md, step 3)" if not self.token
                               else "the TV no longer accepts the kept token: pair again (docs/VIZIO.md, step 3)")
        if data is None:
            raise VizioError(f"the TV sent something that is not JSON for {path} (HTTP {status})")
        if result and result not in PROTOCOL["ok"]:
            raise VizioError(f"the TV answered {result.lower()} to {method} {path}")
        if status >= 400 and not result:
            raise VizioError(f"the TV answered HTTP {status} to {method} {path}")
        return data

    async def find_port(self):
        """The first port that answers like a SmartCast TV (any STATUS, even "requires pairing")."""
        if self.port is not None:
            return self.port
        last = None
        for p in self.ports:
            try:
                await self._call("GET", PROTOCOL["power"], port=p, timeout=3)
            except NeedsPairing:
                pass                     # it is a SmartCast TV, it only wants the token
            except VizioError as e:
                if "not JSON" in str(e):
                    last = f"port {p} answers, but not like a VIZIO"
                    continue
            except TVUnavailable as e:
                last = f"port {p}: {e}"
                continue
            self.port = p
            self.log.info("SmartCast answers on port %s", p)
            return p
        raise TVUnavailable(f"no SmartCast answer on port {' or '.join(map(str, self.ports))} ({last})")

    # ---------- pairing (the PIN on the TV) ----------
    async def pair_start(self):
        """Ask the TV to show its 4 digit PIN. What pair_finish needs is kept, so the PIN can be
        sent from another run (vizio-check.py --pin)."""
        self.require()
        body = {"DEVICE_NAME": (config.CLIENT_NAME or "couch-tv")[:40], "DEVICE_ID": self.device_id}
        try:
            got = await self._call("PUT", PROTOCOL["pair_start"], body, auth=False)
        except VizioError as e:
            if any(b.lower() in str(e) for b in PROTOCOL["busy"]):
                self.last_error = "the TV is already pairing with something"
                raise VizioError("the TV is already showing a PIN for something else: press Back on the TV, "
                                 "wait a minute and try again") from None
            self.last_error = str(e)
            raise
        item = got.get("ITEM") if isinstance(got, dict) else None
        if not isinstance(item, dict) or item.get("PAIRING_REQ_TOKEN") is None:
            self.last_error = "the TV did not start pairing"
            raise VizioError("the TV did not start pairing (no PAIRING_REQ_TOKEN): turn on trace and send the log")
        self._keep(pending={"req": item.get("PAIRING_REQ_TOKEN"), "challenge": item.get("CHALLENGE_TYPE", 1)})
        return True

    async def pair_finish(self, pin):
        """Send the PIN, keep the token the TV gives back (bridge/data, 0600, never logged)."""
        pin = str(pin or "").strip()
        if not PIN.match(pin):
            raise ValueError("the PIN is the 4 digits the TV shows")
        pending = self._stored().get("pending")
        if not isinstance(pending, dict) or pending.get("req") is None:
            raise VizioError("ask the TV for a PIN first")
        self.require()
        body = {"DEVICE_ID": self.device_id, "CHALLENGE_TYPE": pending.get("challenge", 1),
                "RESPONSE_VALUE": pin, "PAIRING_REQ_TOKEN": pending["req"]}
        try:
            got = await self._call("PUT", PROTOCOL["pair_finish"], body, auth=False)
        except VizioError as e:
            text = str(e)
            if any(w.lower() in text for w in PROTOCOL["pin_wrong"]):
                self._keep(pending=None)
                self.last_error = "the TV refused the PIN"
                raise VizioError("the TV refused the PIN: ask for a new one and try again") from None
            if any(w.lower() in text for w in PROTOCOL["pin_locked"]):
                self._keep(pending=None)
                self.last_error = "too many wrong PINs"
                raise VizioError("too many wrong PINs: wait a few minutes before asking for a new one") from None
            self.last_error = text
            raise
        item = got.get("ITEM") if isinstance(got, dict) else None
        token = item.get("AUTH_TOKEN") if isinstance(item, dict) else None
        if not isinstance(token, str) or not token:
            self.last_error = "the TV accepted the PIN but sent no token"
            raise VizioError("the TV accepted the PIN but sent no token (turn on trace and send the log)")
        self._keep(token=token, pending=None)
        self.last_error = None
        self.log.info("paired (token kept in %s)", os.path.basename(self.store_file))
        return True

    # ---------- reading the TV ----------
    async def _read_power(self):
        data = await self._call("GET", PROTOCOL["power"])
        v = _first_item(data).get("VALUE")
        self.power = v if isinstance(v, int) and not isinstance(v, bool) else None
        return self.power

    async def _read_front(self):
        """The app in front as (name space, app id), () for none, None when the TV does not say."""
        try:
            data = await self._call("GET", PROTOCOL["current_app"])
        except (VizioError, TVUnavailable):
            self.front_readable = False
            return None
        self.front_readable = True
        item = data.get("ITEM") if isinstance(data, dict) else None
        v = item.get("VALUE") if isinstance(item, dict) else None
        if not isinstance(v, dict) or v.get("APP_ID") in (None, ""):
            return ()
        try:
            return int(v.get("NAME_SPACE")), str(v["APP_ID"])
        except (TypeError, ValueError):
            return ()

    async def read_volume(self):
        try:
            data = await self._call("GET", PROTOCOL["volume"])
        except (VizioError, TVUnavailable):
            return self.volume
        v = _first_item(data).get("VALUE")
        if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= PROTOCOL["volume_max"]:
            self.vol = v
        return self.volume

    def _package_of(self, front):
        """(name space, app id) -> a catalogue package, "vizio.<ns>.<id>", or None for VIZIO's home."""
        if not front:
            return None
        ns, aid = front
        if (ns, aid) == PROTOCOL["home_app"]:
            return None
        for app_id, (n, a, _m) in APPS.items():
            if a == aid and (n == ns or EQUIVALENT.get(n) == ns):
                app = apps.BY_ID.get(app_id)
                if app:
                    return app["package"]
        return f"vizio.{ns}.{aid}"

    async def apps_on_tv(self):
        """VIZIO keeps its app list in its cloud, not on the TV: this is couch-tv's own table."""
        out = []
        for app_id, (ns, aid, _m) in APPS.items():
            app = apps.BY_ID.get(app_id)
            if app:
                out.append({"id": app_id, "name": app["name"], "package": app["package"],
                            "name_space": ns, "app_id": aid})
        return out

    async def refresh_installed(self, force=False):
        return {}

    async def installed_packages(self):
        return None   # the TV does not say which apps it has

    async def read_sources(self):
        """The TV's inputs: [{"id": "HDMI-1", "name": <the owner's label, else the same>}]."""
        data = await self._call("GET", PROTOCOL["inputs"])
        out = []
        rows = data.get("ITEMS") if isinstance(data, dict) else None
        for it in rows if isinstance(rows, list) else []:
            if not isinstance(it, dict) or not isinstance(it.get("NAME"), str):
                continue
            sid = it["NAME"]
            if not re.match(r"^[A-Za-z0-9 ._-]{1,40}$", sid):
                continue
            label = it.get("VALUE", {}).get("NAME") if isinstance(it.get("VALUE"), dict) else None
            out.append({"id": sid, "name": label if isinstance(label, str) and label.strip() else sid})
        self.sources = out
        return out

    async def current_input(self):
        """(input name, HASHVAL) of the input on screen."""
        it = _first_item(await self._call("GET", PROTOCOL["current_input"]))
        return it.get("VALUE"), it.get("HASHVAL")

    async def switch_source(self, name):
        """Switch to an input the TV listed, by its id or label ("HDMI-2", "hdmi 2", "2", "Xbox")."""
        self.require()
        srcs = self.sources or await self.read_sources()
        want = _plain(name)
        hit = next((s for s in srcs if _plain(s["id"]) == want or _plain(s["name"]) == want), None)
        if not hit and want.isdigit():
            hit = next((s for s in srcs if re.search(rf"\D{want}$", _plain(s["id"]))), None)
        if not hit and want.startswith("hdmi") and want[4:].isdigit():
            hit = next((s for s in srcs if _plain(s["id"]) == want), None)
        if not hit:
            raise ValueError(f"not an input the TV listed: {name}")
        _now, hashval = await self.current_input()
        if hashval is None:
            raise VizioError("the TV did not give the HASHVAL needed to switch inputs (turn on trace and send the log)")
        await self._call("PUT", PROTOCOL["current_input"], {"REQUEST": "MODIFY", "VALUE": hit["id"], "HASHVAL": hashval})
        return hit

    # ---------- the home (not possible on a VIZIO) ----------
    async def open_home(self):
        raise TVUnavailable("couch-tv's home cannot open on a VIZIO TV: VIZIO OS has no browser and takes no "
                            "outside apps. couch-tv is the phone remote here (docs/VIZIO.md, \"The home\")")

    # ---------- the watcher ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _resolve(self):
        if not self.host:
            self.ip = self.ip or self.fallback_ip
            return self.ip
        try:
            infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
                self.host, self.ports[0], family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    async def poll(self, tick=0):
        """One look at the TV: power, the app in front, now and then the volume."""
        before = (self.connected, self.power, self.visible, self.vol)
        if not await self.port_open():
            self.connected, self.power, self.visible = False, None, None
        else:
            self.connected = True
            try:
                await self._read_power()
                self.last_error = None
            except VizioError as e:
                self.power, self.last_error = None, str(e)   # it answers, but not to us yet
            except TVUnavailable:
                self.power = None
            if self.is_on:
                if self.front_readable is not False or tick % 30 == 0:
                    self.visible = await self._read_front()
                if tick % 3 == 0:
                    await self.read_volume()
            else:
                self.visible = None
        if (self.connected, self.power, self.visible, self.vol) != before:
            self._changed()

    async def _watch(self):
        await self._resolve()
        tick = 0
        while True:
            try:
                await self.poll(tick)
                if not self.connected and tick % 30 == 0:
                    await self._resolve()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            tick += 1
            await asyncio.sleep(WATCH_EVERY)

    # ---------- the remote ----------
    async def _press(self, code, action="KEYPRESS"):
        await self._call("PUT", PROTOCOL["key"], {"KEYLIST": [{"CODESET": code[0], "CODE": code[1], "ACTION": action}]})

    async def key(self, name, hold=False):
        k = name.strip().lower() if isinstance(name, str) else ""
        if k == "home":
            code = KEYS["vizio_home"]     # couch-tv's home cannot open here: VIZIO's own Home
        elif k == "play_pause":
            code = KEYS["pause" if self._played else "play"]   # VIZIO has separate play and pause keys
            self._played = not self._played
        elif k in ("power", "power_toggle"):
            # off: switch on (or Wake on LAN when the TV is fully off); on: off; unknown: the toggle
            if not self.connected:
                await self.wake()
                return "wake"
            code = KEYS["power_off" if self.is_on else "power_on" if self.is_on is False else "power_toggle"]
        else:
            code = resolve_key(name)
        if not code:
            raise ValueError(f"unknown key: {name}")
        self.require()
        if k in ("play", "pause"):
            self._played = k == "play"
        if hold and code[0] != POWER:
            await self._press(code, "KEYDOWN")      # a hold: down, a moment, up (UNCONFIRMED timing)
            await asyncio.sleep(0.8)
            await self._press(code, "KEYUP")
        else:
            await self._press(code)
        if code[0] == POWER:
            self.power = 0 if code[1] == 0 else 1 if code[1] == 1 else self.power
        elif code == KEYS["mute"] and self.muted is not None:
            self.muted = not self.muted
        return f"{code[0]}:{code[1]}"

    async def text(self, text):
        raise TVUnavailable("typing into a VIZIO TV from the phone is not built: use the TV's own keyboard")

    def _app_entry(self, package):
        """(name space, app id, message) for a catalogue package or id, or "vizio.<ns>.<id>"."""
        if not isinstance(package, str):
            return None
        m = SAFE_APP.match(package)
        if m:
            return int(m.group(1)), m.group(2), PROTOCOL["launch_message"]
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        return APPS.get(app["id"]) if app else None

    async def launch_package(self, package):
        """Open an app from couch-tv's VIZIO table, or "vizio.<name space>.<app id>"."""
        self.require()
        if package in (HOME_PACKAGE, "home"):
            await self.key("home")
            return "remote"
        entry = self._app_entry(package)
        if not entry:
            raise TVUnavailable(f"couch-tv does not know {package}'s id on a VIZIO (docs/VIZIO.md, \"Apps\")")
        ns, aid, msg = entry
        await self._call("PUT", PROTOCOL["launch"], {"VALUE": {"NAME_SPACE": ns, "APP_ID": aid, "MESSAGE": msg}}, timeout=8)
        self.visible = (ns, aid)
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """No deep link into a show is known on VIZIO: the app opens on its own page."""
        self.require()
        if not package:
            raise ValueError("VIZIO TVs only open apps, not links: name the app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        if self.is_on and self.front_readable is not False:
            front = await self._read_front()
            if front is not None:
                self.visible = front
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        """The app in front, once it is one of packages. When the TV does not say which app is in
        front, the one the bridge just opened counts."""
        packages = {p for p in packages if p}
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.front_readable is False:
                return self.current_package if self.current_package in packages else None
            if await self.front_package() in packages:
                return self.current_package
            await asyncio.sleep(0.7)
        return None

    # ---------- what VIZIO does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a VIZIO TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("VIZIO TVs do not give screenshots over the network")

    # ---------- power ----------
    async def port_open(self, port=None, timeout=1.0):
        for p in [port] if port else ([self.port] if self.port else self.ports):
            try:
                _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, p), timeout)
                w.close()
                return True
            except Exception:
                pass
        return False

    async def reconnect_now(self):
        self.connected = await self.port_open()
        if self.connected:
            try:
                await self._read_power()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake on LAN, for a TV whose network goes off with it (not in Eco mode, documented)."""
        if not self.mac or not self.wake_on_lan:
            return
        mac = bytes.fromhex(self.mac.replace(":", "").replace("-", ""))
        packet = b"\xff" * 6 + mac * 16
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            for addr in ("255.255.255.255", os.environ.get("TV_BROADCAST", "255.255.255.255"), self.ip or self.fallback_ip):
                for port in (9, 7):
                    try:
                        s.sendto(packet, (addr, port))
                    except (OSError, TypeError):
                        pass
        finally:
            s.close()
