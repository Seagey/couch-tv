"""The connection to a Philips TV on Titan OS (or an older Philips Linux TV), for "kind": "philips".

NOT YET RUN ON A REAL TITAN OS TV. Tested against a stand in TV on the computer only
(tests/philips_standin.py, docs/PHILIPS-TITAN.md). Expect the first tester to find something that
needs fixing: scripts/philips-check.py prints what the TV really answers.

How a Titan OS Philips is reached: Philips's JointSpace API, HTTPS on port 1926 with HTTP digest
login, the TV's own self signed certificate (accepted for this TV's address only, never anywhere
else). Paths start with an API version, usually /6/; some firmware drops it, so the first answer to
"system" decides (VERSIONS below).

  GET  system                  the TV's name, model and API version
  GET  powerstate              {"powerstate": "On"} or "Standby"; POST the same to switch
  POST input/key               {"key": "CursorUp"}: one remote button
  GET  audio/volume            {"current", "min", "max", "muted"}; POST the same to set
  GET  sources                 the inputs; POST sources/current {"id": ...} to switch
  GET  applications            the apps the TV lists; POST activities/launch with one of them
  GET  activities/current      the app in front (UNCONFIRMED on Titan OS)
  POST pair/request, pair/grant   pairing: the TV shows a PIN, the PIN goes back

Pairing needs a shared key that belongs to Philips (it is in Philips's own TV Remote app). couch-tv
never ships it: the owner saves their own copy with scripts/philips-secret.py, into bridge/data/,
which git ignores. The login the TV hands back is kept there too.

The home: Titan OS has no way to replace its home screen. couch-tv opens itself only through an app
the TV lists that shows couch-tv's page (a published couch-tv app, or Titan's DevView developer app
pointed at it, docs/PHILIPS-TITAN.md). Set "home_app" to that app's name, or leave it and an app
called "Couch TV" is used when the TV lists one. With neither, this is a phone remote only: Home
presses the TV's own Home button and nothing opens at power on.

Everything not written in Philips's own material, or not yet seen from a Titan OS TV, is in PROTOCOL
below, marked UNCONFIRMED, so a tester's output can correct it in one place.
"""
import asyncio
import base64
import hashlib
import hmac
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
COUCH_LABEL = "Couch TV"     # an app with this name on the TV is couch-tv's home, unless home_app says otherwise
PORT_TLS, PORT_PLAIN = 1926, 1925
VERSIONS = ["6/", "5/", "1/", ""]   # tried in this order; the first one that answers "system" is kept
WATCH_EVERY = 2.0
SETTLE = 1.5
ON = "On"

PROTOCOL = {
    # Pairing. UNCONFIRMED on Titan OS: the field names and the signature recipe are our best
    # reading of how Philips's v6 pairing works, and the first tester settles them.
    "pair_scope": ["read", "write", "control"],
    "pair_ok": "SUCCESS",
    "app_id": "1",
    "sign": "hex-base64",     # base64 of the hex HMAC-SHA1 of timestamp + PIN, keyed with the shared key
    # What counts as "nothing in front": Philips's own home and live TV. UNCONFIRMED on Titan OS.
    "nothing": r"^$|launcher|home|playtv|watchtv|^tv$|^na$",
    "input": r"hdmi|^ext|^av|scart",
}

# Friendly key name -> JointSpace key name (the names in Philips's JointSpace documentation).
KEYS = {
    "up": "CursorUp", "down": "CursorDown", "left": "CursorLeft", "right": "CursorRight",
    "ok": "Confirm", "select": "Confirm", "enter": "Confirm",
    "back": "Back", "philips_home": "Home", "menu": "Options", "settings": "Adjust", "options": "Options",
    "info": "Info", "search": "Find",
    "play_pause": "PlayPause", "play": "PlayPause", "pause": "Pause", "stop": "Stop",
    "fast_forward": "FastForward", "rewind": "Rewind", "next": "Next", "previous": "Previous",
    "volume_up": "VolumeUp", "volume_down": "VolumeDown", "mute": "Mute",
    "power": "Standby", "channel_up": "ChannelStepUp", "channel_down": "ChannelStepDown",
    "input": "Source", "red": "RedColour", "green": "GreenColour", "yellow": "YellowColour",
    "blue": "BlueColour", "subtitle": "Subtitle", "live_tv": "WatchTV",
    **{str(n): f"Digit{n}" for n in range(10)},
}
RAW_KEYS = {v.lower(): v for v in KEYS.values()} | {k.lower(): k for k in (
    "Dot", "Teletext", "Viewmode", "Record", "Online", "AmbilightOnOff")}
SAFE_ID = re.compile(r"^[A-Za-z0-9 ._:/+-]{1,120}$")
PIN = re.compile(r"^\d{4,6}$")


def resolve_key(name):
    """Friendly name, or a JointSpace key name such as RedColour -> the key sent. "home" is handled first."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip().lower()
    return KEYS.get(k) or RAW_KEYS.get(k)


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


BY_NAME = {}
for _a in apps.APPS:
    for _n in [_a["name"]] + (apps.WEBOS.get(_a["id"]) or {}).get("names", []):
        BY_NAME.setdefault(_plain(_n), _a["package"])


def sign(secret, timestamp, pin):
    """The pairing signature. UNCONFIRMED recipe (PROTOCOL["sign"]): HMAC-SHA1 keyed with the
    shared key (as saved, base64), over the timestamp the TV sent followed by the PIN, as hex,
    then base64."""
    key = base64.b64decode(secret)
    mac = hmac.new(key, (str(timestamp) + str(pin)).encode(), hashlib.sha1).hexdigest()
    return base64.b64encode(mac.encode()).decode()


class PhilipsError(RuntimeError):
    """The TV did not do what was asked, or answered with something unusable."""


class NeedsLogin(PhilipsError):
    """The TV answered 401: it is there, but wants the login pairing gives."""


class Digest:
    """HTTP digest login (RFC 7616, MD5, qop auth), written for this driver. The TV's challenge is
    kept and reused with a rising counter; a new one is fetched when the TV asks again."""

    def __init__(self, user, password):
        self.user, self.password = user, password
        self.challenge = None
        self.count = 0

    def take(self, header):
        if not header or not header.lower().startswith("digest "):
            return False
        parts = dict((k.lower(), v.strip('"')) for k, v in re.findall(r'(\w+)=("[^"]*"|[^,\s]+)', header[7:]))
        if "nonce" not in parts:
            return False
        self.challenge, self.count = parts, 0
        return True

    def header(self, method, uri):
        c = self.challenge
        if not c:
            return None
        h = lambda s: hashlib.md5(s.encode()).hexdigest()
        self.count += 1
        nc, cnonce = f"{self.count:08x}", secrets.token_hex(8)
        ha1 = h(f"{self.user}:{c.get('realm', '')}:{self.password}")
        ha2 = h(f"{method}:{uri}")
        qop = "auth" if "auth" in (c.get("qop") or "").split(",") else None
        resp = h(f"{ha1}:{c['nonce']}:{nc}:{cnonce}:auth:{ha2}") if qop else h(f"{ha1}:{c['nonce']}:{ha2}")
        out = (f'Digest username="{self.user}", realm="{c.get("realm", "")}", nonce="{c["nonce"]}", '
               f'uri="{uri}", response="{resp}"')
        if c.get("opaque"):
            out += f', opaque="{c["opaque"]}"'
        if qop:
            out += f', qop=auth, nc={nc}, cnonce="{cnonce}"'
        return out


class PhilipsTV:
    kind = "philips"
    can_read_media = False

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"philips.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.tls = cfg.get("tls", True) is not False
        self.port = int(cfg.get("port") or (PORT_TLS if self.tls else PORT_PLAIN))
        self.version = cfg.get("api_version")   # "6/" etc, else found from "system"
        if self.version is not None:
            self.version = str(self.version).strip("/") + "/" if str(self.version).strip("/") else ""
        self.home_app = (cfg.get("home_app") or "").strip() or None
        hk = cfg.get("home_keys") or []
        if not isinstance(hk, list) or len(hk) > 6 or any(resolve_key(k) is None for k in hk):
            raise SystemExit(f"tvs[{self.id}].home_keys: up to 6 key names, for example [\"ok\"]")
        self.home_keys = [resolve_key(k) for k in hk]
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.leave_inputs = cfg.get("leave_inputs", False) is True
        self.trace = cfg.get("trace", False) is True
        self.INPUT = re.compile(PROTOCOL["input"], re.I)
        self.NOTHING = re.compile(PROTOCOL["nothing"], re.I)
        folder = os.path.join(config.DATA, "philips")
        self.secret_file = cfg.get("pair_secret_file") or os.path.join(folder, "pair-secret")
        self.store_file = os.path.join(config.DATA, f"philips-{self.id}.json")
        self.app_id = COUCH_LABEL
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the JointSpace port answers
        self.power = None           # "On", "Standby", ... None unknown
        self.visible = None         # the TV's id for the app in front, "" for none, None unknown
        self.front_readable = None  # whether activities/current answers at all on this TV
        self.system = {}
        self.vol = {}
        self.applist = []           # [{"id", "label", "package", "entry"}], entry is the TV's own object
        self.ids = {}               # TV app id -> android style package
        self.sources = []           # [{"id", "name"}]
        self._ids_checked = 0.0
        self._listeners = set()
        self._session = None
        self._auth = None
        self._tasks = []
        self._pairing = None        # (device id, auth key, timestamp) between pair_start and pair_finish
        self.last_error = None
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []

    # ---------- what the bridge keeps ----------
    def _stored(self):
        try:
            with open(self.store_file) as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _keep(self, **changes):
        d = self._stored() | changes
        os.makedirs(os.path.dirname(self.store_file), exist_ok=True)
        tmp = self.store_file + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(d, f)
        os.replace(tmp, self.store_file)

    @property
    def paired(self):
        s = self._stored()
        return bool(s.get("user") and s.get("password"))

    def _secret(self):
        try:
            with open(self.secret_file) as f:
                return f.read().strip() or None
        except OSError:
            return None

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        if not self.connected or self.power is None:
            return None
        return self.power == ON

    @property
    def current_package(self):
        if not self.connected or not self.is_on or not self.visible:
            return None
        return self._package_of(self.visible)

    @property
    def volume(self):
        v = self.vol
        if not isinstance(v.get("current"), int) or not isinstance(v.get("max"), int):
            return {"level": None, "max": None, "muted": None, "known": False}
        return {"level": v["current"], "max": v["max"], "muted": bool(v.get("muted")), "known": True}

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
        return False   # no deep link into a show is known on Titan OS: apps open on their own page

    def philips_status(self):
        """For /api/tvs: what a tester needs to see at a glance."""
        home = self._home_entry()
        return {"paired": self.paired, "secret": bool(self._secret()), "api": self.version,
                "power": self.power, "front": self.visible, "front_readable": self.front_readable,
                "apps": len(self.applist), "home_app": home["label"] if home else None,
                "model": self.system.get("model") or self.system.get("name"), "error": self.last_error}

    # ---------- HTTP ----------
    def _ssl(self):
        """The TV's own certificate is self signed: it is accepted for this TV only (this context is
        passed on its requests and nowhere else)."""
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

    def _base(self):
        return f"{'https' if self.tls else 'http'}://{self.ip or self.fallback_ip}:{self.port}"

    def _login(self):
        s = self._stored()
        if s.get("user") and s.get("password"):
            if not self._auth or self._auth.user != s["user"]:
                self._auth = Digest(s["user"], s["password"])
            return self._auth
        return None

    def _show(self, way, path, text):
        if not self.trace:
            return
        text = re.sub(r'("(?:pin|auth_key|auth_signature|password|auth_timestamp)"\s*:\s*)"?[^",}]*"?',
                      r'\1"(hidden)"', text or "")
        self.log.info("trace %s %s %s", way, path, text[:600])

    async def _call(self, method, path, payload=None, auth=None, timeout=5, version=None):
        """One JointSpace request. auth: a Digest, else the kept login (when there is one)."""
        if version is None and self.version is None:
            await self.find_version()
        s = await self._http()
        uri = "/" + (self.version if version is None else version or "") + path
        body = None if payload is None else json.dumps(payload, separators=(",", ":"))
        self._show("out", f"{method} {uri}", body)
        digest = auth or self._login()
        for attempt in range(2):
            headers = {"Content-Type": "application/json"} if body is not None else {}
            if digest and digest.challenge:
                headers["Authorization"] = digest.header(method, uri)
            try:
                async with s.request(method, self._base() + uri, data=body, headers=headers, ssl=self._ssl(),
                                     timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                    text = await r.text()
                    if r.status == 401 and digest and attempt == 0 and digest.take(r.headers.get("WWW-Authenticate")):
                        continue
                    self._show("in ", f"{r.status} {uri}", text)
                    if r.status == 401:
                        raise NeedsLogin("the TV wants a login: pair first (docs/PHILIPS-TITAN.md, step 3)")
                    if r.status >= 400:
                        raise PhilipsError(f"the TV answered {r.status} to {method} {path}")
                    if not text.strip():
                        return {}
                    try:
                        return json.loads(text)
                    except ValueError:
                        raise PhilipsError(f"the TV sent something that is not JSON for {path}") from None
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                raise TVUnavailable(f"the TV did not answer ({type(e).__name__})") from None
        raise PhilipsError("the TV refused the login")

    async def find_version(self):
        """The API version prefix this TV answers on (/6/, /5/, /1/ or none), from "system"."""
        if self.version is not None:
            return self.version
        for v in VERSIONS:
            try:
                data = await self._call("GET", "system", version=v)
            except NeedsLogin:
                data = {"login": True}   # this version is there, it only wants a login
            except PhilipsError:
                continue
            if isinstance(data, dict) and data:
                self.version, self.system = v, ({} if data.get("login") else data)
                self.log.info("JointSpace answers on /%s", v)
                return v
        raise PhilipsError("the TV did not answer \"system\" on any API version")

    # ---------- pairing ----------
    def _device(self, device_id):
        return {"device_name": config.CLIENT_NAME[:40], "device_os": "couch-tv", "app_id": "app.couchtv",
                "app_name": "couch-tv", "type": "native", "id": device_id}

    async def pair_start(self):
        """Ask the TV to show its PIN."""
        self.require()
        if not self._secret():
            raise PhilipsError("no pairing key saved yet: run scripts/philips-secret.py first (docs/PHILIPS-TITAN.md)")
        await self.find_version()
        device_id = secrets.token_hex(8)
        got = await self._call("POST", "pair/request", {"scope": PROTOCOL["pair_scope"], "device": self._device(device_id)})
        if not isinstance(got, dict) or got.get("error_id") != PROTOCOL["pair_ok"] or not got.get("auth_key"):
            self.last_error = "the TV did not start pairing"
            raise PhilipsError(f"the TV did not start pairing ({(got or {}).get('error_id') or 'no answer'})")
        self._pairing = (device_id, str(got["auth_key"]), got.get("timestamp"))
        self._keep(pending=list(self._pairing))   # so the PIN can be sent from another run (philips-check.py --pin)
        return True

    async def pair_finish(self, pin):
        """Send the PIN back, signed, and keep the login the TV gave (bridge/data, never in git)."""
        pin = str(pin or "").strip()
        if not PIN.match(pin):
            raise ValueError("the PIN is the 4 digits the TV shows")
        if not self._pairing and isinstance(self._stored().get("pending"), list) and len(self._stored()["pending"]) == 3:
            self._pairing = tuple(self._stored()["pending"])
        if not self._pairing:
            raise PhilipsError("ask the TV for a PIN first")
        secret = self._secret()
        if not secret:
            raise PhilipsError("no pairing key saved: run scripts/philips-secret.py first")
        device_id, auth_key, ts = self._pairing
        grant = {"auth": {"auth_AppId": PROTOCOL["app_id"], "pin": pin, "auth_timestamp": ts,
                          "auth_signature": sign(secret, ts, pin)},
                 "device": self._device(device_id)}
        got = await self._call("POST", "pair/grant", grant, auth=Digest(device_id, auth_key))
        if isinstance(got, dict) and got.get("error_id") not in (None, PROTOCOL["pair_ok"]):
            self.last_error = f"the TV refused the PIN ({got.get('error_id')})"
            raise PhilipsError(self.last_error)
        self._keep(user=device_id, password=auth_key, pending=None)
        self._pairing, self._auth, self.last_error = None, None, None
        self.log.info("paired (login kept in %s)", os.path.basename(self.store_file))
        return True

    # ---------- reading the TV ----------
    async def _read_power(self):
        data = await self._call("GET", "powerstate")
        p = data.get("powerstate") if isinstance(data, dict) else None
        self.power = p if isinstance(p, str) and p else None
        return self.power

    async def _read_front(self):
        """The app in front, "" for none, None when the TV does not say."""
        try:
            data = await self._call("GET", "activities/current")
        except (PhilipsError, TVUnavailable):
            self.front_readable = False
            return None
        self.front_readable = True
        if not isinstance(data, dict):
            return None
        comp = data.get("component") if isinstance(data.get("component"), dict) else {}
        front = comp.get("packageName") or data.get("id") or data.get("label") or ""
        return str(front)

    async def read_volume(self):
        try:
            data = await self._call("GET", "audio/volume")
        except (PhilipsError, TVUnavailable):
            return self.volume
        if isinstance(data, dict):
            self.vol = data
        return self.volume

    async def refresh_installed(self, force=False):
        """The apps the TV lists, every 30 minutes."""
        if not force and time.time() - self._ids_checked < 1800 and self.applist:
            return self.ids
        try:
            data = await self._call("GET", "applications")
        except (PhilipsError, TVUnavailable) as e:
            self.log.info("app list: %s", e)
            return self.ids
        rows = data.get("applications") if isinstance(data, dict) else data
        listed, found = [], {}
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict):
                continue
            comp = ((r.get("intent") or {}).get("component") or {}) if isinstance(r.get("intent"), dict) else {}
            aid = str(r.get("id") or comp.get("packageName") or "")
            label = str(r.get("label") or r.get("name") or "").strip()
            if not SAFE_ID.match(aid) or not label:
                continue
            pkg = apps.BY_PACKAGE.get(comp.get("packageName") or "", {}).get("package") or BY_NAME.get(_plain(label))
            if _plain(label) == _plain(self.home_app or COUCH_LABEL):
                pkg = HOME_PACKAGE
            if pkg:
                found[aid] = pkg
            listed.append({"id": aid, "label": label, "package": pkg or f"philips.{aid}", "entry": r})
        if listed:
            self.applist, self.ids, self._ids_checked = listed, found, time.time()
        return self.ids

    async def apps_on_tv(self):
        await self.refresh_installed()
        return [{"id": a["id"], "label": a["label"], "package": a["package"]} for a in self.applist]

    async def read_sources(self):
        """The TV's inputs: [{"id", "name"}]."""
        data = await self._call("GET", "sources")
        out = []
        if isinstance(data, dict):
            for sid, v in data.items():
                name = v.get("name") if isinstance(v, dict) else v
                if SAFE_ID.match(str(sid)) and isinstance(name, str):
                    out.append({"id": str(sid), "name": name})
        elif isinstance(data, list):
            for v in data:
                if isinstance(v, dict) and SAFE_ID.match(str(v.get("id") or "")):
                    out.append({"id": str(v["id"]), "name": str(v.get("name") or v["id"])})
        self.sources = out
        return out

    async def switch_source(self, name):
        """Switch to an input the TV listed, by its id or name (\"HDMI 2\", \"hdmi2\", \"2\")."""
        self.require()
        srcs = self.sources or await self.read_sources()
        want = _plain(name)
        hit = next((s for s in srcs if _plain(s["id"]) == want or _plain(s["name"]) == want), None)
        if not hit and want.isdigit():
            hit = next((s for s in srcs if re.search(rf"\D{want}$", _plain(s["name"]))), None)
        if not hit:
            raise ValueError(f"not an input the TV listed: {name}")
        self.quiet_until = time.monotonic() + 20
        await self._call("POST", "sources/current", {"id": hit["id"]})
        return hit

    def _package_of(self, front):
        if not front or self.NOTHING.search(front):
            return None
        hit = next((a for a in self.applist if a["id"] == front or a["label"] == front
                    or ((a["entry"].get("intent") or {}).get("component") or {}).get("packageName") == front), None)
        if hit:
            return hit["package"]
        return apps.BY_PACKAGE.get(front, {}).get("package") or f"philips.{front}"

    # ---------- the home (only when the TV lists an app that shows couch-tv) ----------
    def _home_entry(self):
        want = _plain(self.home_app or COUCH_LABEL)
        return next((a for a in self.applist if _plain(a["label"]) == want), None)

    async def open_home(self):
        """Open the app that shows couch-tv, then press home_keys (DevView: into the couch-tv entry)."""
        await self.refresh_installed()
        entry = self._home_entry()
        if not entry:
            raise TVUnavailable("this TV lists no app that shows couch-tv, so couch-tv cannot open on it "
                                "(docs/PHILIPS-TITAN.md, \"The home\")")
        await self._launch_entry(entry)
        for k in self.home_keys:
            await asyncio.sleep(1.0)
            await self._call("POST", "input/key", {"key": k})
        self.visible = entry["id"]

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _resolve(self):
        if not self.host:
            self.ip = self.ip or self.fallback_ip
            return self.ip
        try:
            infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
                self.host, self.port, family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.power, self.visible, self.volume["level"])
                try:
                    await self.find_version()
                    await self._read_power()
                    self.connected, self.last_error = True, None
                except PhilipsError as e:
                    self.connected, self.last_error = True, str(e)   # it answers, but not to us yet
                except TVUnavailable:
                    self.connected, self.power, self.visible = False, None, None
                    if ticks % 30 == 0:
                        await self._resolve()
                if self.connected and self.is_on:
                    if self.front_readable is not False or ticks % 30 == 0:
                        self.visible = await self._read_front()
                    if ticks % 3 == 0:
                        await self.read_volume()
                    await self.refresh_installed()
                elif self.connected:
                    self.visible = None
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False
                if (self.connected, self.power, self.visible, self.volume["level"]) != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            ticks += 1
            await asyncio.sleep(WATCH_EVERY)

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The TV just came on. With an app that shows couch-tv, open it when nothing else is in front."""
        if not self.open_on_power_on:
            return
        await self.refresh_installed()
        if not self._home_entry():
            self._note("TV came on, no couch-tv app on this TV (remote only)")
            return
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        await asyncio.sleep(SETTLE)
        front = await self._read_front()
        if front is None:
            if self.leave_inputs:
                self._note("TV came on, cannot tell what is in front, left alone (leave_inputs)")
                return
        elif self.leave_inputs and self.INPUT.search(front):
            self._note(f"TV came on in {front}, left alone (leave_inputs)")
            return
        elif _plain(front) in (_plain((self._home_entry() or {}).get("id")), _plain(self.home_app or COUCH_LABEL)):
            self._note("TV came on, couch-tv already open")
            return
        elif not self.NOTHING.search(front):
            self._note(f"TV came on in {self._package_of(front)}, left alone")
            return
        try:
            await self.open_home()
            self._note("TV came on, opened couch-tv")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- the remote ----------
    async def key(self, name, hold=False):
        code = resolve_key(name)
        power = code == "Standby"
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is couch-tv when the TV has an app for it, else the TV's own Home.
            await self.refresh_installed()
            if self._home_entry():
                await self.open_home()
                return "couch-tv"
            code = "Home"
        if not code:
            raise ValueError(f"unknown key: {name}")
        self.require()
        if power:
            if self.is_on:
                await self._call("POST", "powerstate", {"powerstate": "Standby"})
                self.power = "Standby"
            else:
                self.home_on_wake_until = time.monotonic() + 90
                await self._turn_on()
            return code
        await self._call("POST", "input/key", {"key": code})   # a hold is a press
        return code

    async def _turn_on(self):
        """From networked standby the TV takes powerstate On; fully off, it needs Wake on LAN."""
        try:
            await self._call("POST", "powerstate", {"powerstate": ON})
        except (PhilipsError, TVUnavailable) as e:
            self.log.info("power on: powerstate did not take (%s)", type(e).__name__)
            await self.wake()

    async def set_mute(self, muted):
        v = dict(self.vol or await self._call("GET", "audio/volume"))
        await self._call("POST", "audio/volume", {"muted": bool(muted), "current": v.get("current")})
        self.vol = v | {"muted": bool(muted)}

    async def text(self, text):
        raise TVUnavailable("typing into a Philips Titan OS TV from the phone is not built: use the TV's own keyboard")

    async def _launch(self, app_id, quiet=True):
        if quiet:
            self.quiet_until = time.monotonic() + 20
        if app_id == self.app_id:
            await self.open_home()
            return
        entry = next((a for a in self.applist if a["id"] == app_id), None)
        if not entry:
            raise ValueError(f"not an app the TV listed: {app_id}")
        await self._launch_entry(entry)

    async def _launch_entry(self, entry):
        """activities/launch with the TV's own object for the app, exactly as it listed it."""
        if entry not in self.applist or not SAFE_ID.match(entry.get("id") or ""):
            raise ValueError("not an app the TV listed")
        await self._call("POST", "activities/launch", entry["entry"], timeout=8)

    async def launch_package(self, package):
        """Open an app the TV lists: a catalogue app found by its name, or "philips.<id>"."""
        self.require()
        if package in (HOME_PACKAGE, self.app_id):
            await self._launch(self.app_id)
            return "remote"
        await self.refresh_installed()
        if package and package.startswith("philips."):
            entry = next((a for a in self.applist if a["id"] == package[8:]), None)
        else:
            app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
            pkg = app["package"] if app else package
            entry = next((a for a in self.applist if a["package"] == pkg), None)
        if not entry:
            if not self.applist:
                raise TVUnavailable("the TV has not said which apps it has yet")
            raise TVUnavailable(f"{package} is not on the TV's app list")
        self.quiet_until = time.monotonic() + 20
        await self._launch_entry(entry)
        self.visible = entry["id"]
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """No deep link into a show is known on Titan OS: the app opens on its own page."""
        self.require()
        if not package:
            raise ValueError("Philips Titan OS TVs only open apps, not links: name the app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        if self.connected and self.is_on:
            front = await self._read_front()
            if front is not None:
                self.visible = front
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        packages = {p for p in packages if p}
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.front_readable is False:
                return self.current_package if self.current_package in packages else None
            if await self.front_package() in packages:
                return self.current_package
            await asyncio.sleep(0.7)
        return None

    async def installed_packages(self):
        if not self.connected:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- what Titan OS does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a Philips Titan OS TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("Philips Titan OS TVs do not give screenshots over the network")

    # ---------- power ----------
    async def port_open(self, port=None, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port or self.port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def reconnect_now(self):
        self.connected = await self.port_open()
        if self.connected:
            try:
                await self.find_version()
                await self._read_power()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake on LAN, for a TV that is fully off (only if its network settings allow it)."""
        if not self.mac or not self.wake_on_lan:
            return
        self.quiet_until = 0.0
        self.home_on_wake_until = time.monotonic() + 90
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
