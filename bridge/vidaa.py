"""The connection to a Hisense VIDAA TV, for "kind": "vidaa" in config.json.

Confirmed on a real Hisense 55U7N (VIDAA 9, build Q0705) by Matthew Klette (#128), and tested against a
stand-in TV on the computer (tests/vidaa_standin.py, docs/VIDAA.md). Hisense publishes nothing for this, so
another model or firmware may need a fix: turn on "trace" (below) so the messages can be read.

How a VIDAA TV is reached: an MQTT broker on the TV, over TLS, on port 36669 (36668 on older builds).
The TV's own phone app speaks to it. Newer firmware (2024 on) wants a client certificate in the TLS
handshake. couch-tv never ships that certificate: the owner takes it from their own copy of the app
(scripts/vidaa-cert.py) and it stays in bridge/data/vidaa/, which git ignores.

Topics, as far as they are known. "tv" topics are what the bridge publishes, "mobile" topics are what
the TV answers on. <client> is this bridge's client id.

  /remoteapp/tv/ui_service/<client>/actions/vidaa_app_connect     pairing: the TV shows a 4 digit PIN
  /remoteapp/tv/ui_service/<client>/actions/authenticationcode    pairing: the PIN goes back
  /remoteapp/tv/platform_service/<client>/data/gettoken           pairing: a token is given out
  /remoteapp/tv/ui_service/<client>/actions/launchapp             open an app: appId, name, url, urlType, storeType
  /remoteapp/tv/ui_service/<client>/actions/applist               the installed apps, with the same fields
  /remoteapp/tv/ui_service/<client>/actions/uievent               {"type": "app_install", "app_info": {...}}: a tile
  /remoteapp/mobile/<client>/ui_service/data/state                where the TV is ("statetype")
  /remoteapp/mobile/broadcast/ui_service/state                    the same, sent to every client

Confirmed on the 55U7N: the state request, the answer topics, the key service and key names, and the PIN
fields. Older firmware may differ, and the protocol details are all in PROTOCOL below, so a trace from
another model can correct them in one place.

The hook: a watcher checks the TV every second (a power on is also pushed at once). When the TV comes on and lands on its own home
("statetype" remote_launcher) or live TV, the bridge opens couch-tv: its tile, if one was added
(POST /api/vidaa/tile), else the TV's browser at the bridge's home page. It is a page that opens
itself, not a true home screen: the remote's Home button still opens VIDAA's home unless "keep_home": true
is set (opt in, Beta). No root, ever.

What it cannot do (docs/VIDAA.md): read which app is in front, a volume level, typing, screenshots,
deep links into a show, ADB tools.
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
from urllib.parse import quote

import apps
import config
from tinymqtt import Client, MQTTError, Refused
from tv import TVUnavailable
import vidaa_auth

HOME_PACKAGE = "app.couchtv.launcher"
COUCH_APP = "couch-tv"           # what the hook opens; not an id on the TV (see open_home)
TILE_ID = "app.couchtv.home"     # the id couch-tv's own tile is added under (POST /api/vidaa/tile)
TILE_TITLE = "Couch TV"
PORTS = [36669, 36668]
WATCH_EVERY = 1.0   # seconds between looks at the TV (the backup path; the push fires at once)
SETTLE = 0.3        # seconds the hook lets the TV settle after it comes on
HOME_PAUSE = 30     # seconds a double Home press keeps VIDAA's own home up before couch-tv returns
INPUT_PAUSE = 30    # seconds after the Input key that keep_home leaves VIDAA's home alone (the source picker, #145)

# Every topic and payload shape in one place, so a tester's trace can correct them here.
PROTOCOL = {
    "action": "/remoteapp/tv/{service}/{client}/actions/{name}",
    "token": "/remoteapp/tv/platform_service/{client}/data/gettoken",
    # The TV refuses a # wildcard subscription, so every topic is named. It also refuses the data
    # topics until this client is paired, and refuses the per-client state topic even then, so the
    # driver subscribes one at a time and ignores a refusal. The broadcast state topic is the one
    # the hook needs and it is allowed once paired. (Confirmed on a VIDAA 9 TV, docs/VIDAA.md.)
    "state_broadcast": "/remoteapp/mobile/broadcast/ui_service/state",
    "subscribe": [
        "/remoteapp/mobile/broadcast/ui_service/state",
        "/remoteapp/mobile/{client}/ui_service/data/state",
        "/remoteapp/mobile/{client}/ui_service/data/applist",
        "/remoteapp/mobile/{client}/ui_service/data/sourcelist",
        "/remoteapp/mobile/{client}/ui_service/data/authentication",
        "/remoteapp/mobile/{client}/ui_service/data/authenticationcode",
        "/remoteapp/mobile/{client}/platform_service/data/tokenissuance",
        "/remoteapp/mobile/{client}/platform_service/data/gettoken",   # older firmware's token answer
    ],
    "state_request": ("ui_service", "gettvstate"),     # CONFIRMED on a VIDAA 9 TV
    "key_service": "remote_service",                   # CONFIRMED (sendkey)
    "pin_field": "authNum",                            # CONFIRMED (an integer, not a string)
    "app_connect": {"app_version": 2, "connect_result": 0, "device_type": "Mobile App"},  # CONFIRMED
    "token_fields": ("accesstoken", "access_token", "token"),   # only older firmware issues one
    # where a token comes back: gettoken on older firmware; tokenissuance (with accesstoken and
    # refreshtoken) on a 43A6N, VIDAA Q0707 (#145), sometimes before gettoken is even asked
    "token_answers": ("gettoken", "tokenissuance"),
}

# What a trace hides: the PIN and the value of any key whose name holds token, secret or password
# (accesstoken, refreshtoken, refresh_token, ...), whether the value is a string or a number.
TRACE_HIDE = re.compile(r'("(?:%s|[^"]*(?:token|secret|passw(?:or)?d)[^"]*)"\s*:\s*)(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)'
                        % PROTOCOL["pin_field"], re.IGNORECASE)


def _token_in(data):
    """The access token in a gettoken or tokenissuance answer, or None."""
    if not isinstance(data, dict):
        return None
    return next((data[f] for f in PROTOCOL["token_fields"] if isinstance(data.get(f), str) and data[f]), None)

# statetype values (the home, live TV, an input, a settings menu, standby, waking).
LAUNCHER, LIVE_TV, INPUT_STATE = "remote_launcher", "livetv", "sourceswitch"
OFF_STATES = {"fake_sleep_0", "fake_sleep_1"}
NOTHING = re.compile(r"^(remote_launcher|livetv|sourceswitch)$")   # nothing of anyone's is on screen
INPUT = re.compile(r"^sourceswitch$")

# Friendly key name -> VIDAA key name. Confirmed on a Hisense 55U7N (VIDAA 9).
KEYS = {
    "up": "KEY_UP", "down": "KEY_DOWN", "left": "KEY_LEFT", "right": "KEY_RIGHT",
    "ok": "KEY_OK", "select": "KEY_OK", "enter": "KEY_OK",
    "back": "KEY_RETURNS", "exit": "KEY_EXIT", "vidaa_home": "KEY_HOME", "menu": "KEY_MENU",
    "settings": "KEY_MENU",
    "play_pause": "KEY_PLAY", "play": "KEY_PLAY", "pause": "KEY_PAUSE", "stop": "KEY_STOP",
    "fast_forward": "KEY_FORWARDS", "rewind": "KEY_BACK", "next": "KEY_FORWARDS", "previous": "KEY_BACK",
    "volume_up": "KEY_VOLUMEUP", "volume_down": "KEY_VOLUMEDOWN", "mute": "KEY_MUTE",
    "power": "KEY_POWER", "channel_up": "KEY_CHANNELUP", "channel_down": "KEY_CHANNELDOWN",
    "input": "KEY_INPUT",
    **{str(n): f"KEY_{n}" for n in range(10)},
}
RAW_KEY = re.compile(r"^KEY_[A-Z0-9_]{1,24}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")       # an app id the TV listed, before it is sent back
SAFE_CLIENT = re.compile(r"^[A-Za-z0-9._:$-]{4,80}$")  # no MQTT wildcards or slashes in a topic level (: is fine)
SAFE_UUID = re.compile(r"^[A-Za-z0-9:._-]{4,40}$")    # goes into the client id and so into topic levels
PIN = re.compile(r"^\d{4}$")
BROWSER_NAMES = ("browser", "webbrowser", "internet", "web")


def resolve_key(name):
    """Friendly name, or a VIDAA key name such as KEY_RED -> the key sent. "home" is handled before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    return k.upper() if RAW_KEY.match(k.upper()) else None


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# Catalogue apps by the names a TV may list them under (our LG and Roku tables add a few).
BY_NAME = {}
for _a in apps.APPS:
    for _n in ([_a["name"]] + (apps.WEBOS.get(_a["id"]) or {}).get("names", [])
               + (apps.ROKU.get(_a["id"]) or {}).get("names", [])):
        BY_NAME.setdefault(_plain(_n), _a["package"])


class VidaaError(RuntimeError):
    """The TV did not do what was asked, or answered with something unusable."""


class VidaaTV:
    kind = "vidaa"
    can_read_media = False
    INPUT = INPUT

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"vidaa.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.ports = [int(cfg["port"])] if cfg.get("port") else list(PORTS)
        self.tls = cfg.get("tls", True) is not False
        self.trace = cfg.get("trace", False) is True
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.leave_inputs = cfg.get("leave_inputs", False) is True
        self.browser = (cfg.get("browser") or "").strip() or None
        self.home_url_cfg = (cfg.get("home_url") or "").strip() or None
        # opt in: the page takes clicks from the TV Browser's mouse cursor (the arrows move a cursor there, #145)
        self.pointer = cfg.get("pointer", False) is True
        # The id couch-tv's tile is added under. VIDAA keeps the address a tile was first added with
        # (installing again under the same id does not change it), so moving the home elsewhere, for
        # example to a hosted standalone copy (docs/VIDAA.md), needs a new id here.
        tid = str(cfg.get("tile_id") or "").strip()
        self.tile_id = tid if SAFE_ID.match(tid) else TILE_ID
        self.mqtt_user = cfg.get("mqtt_user")
        self.mqtt_password = cfg.get("mqtt_password")
        folder = os.path.join(config.DATA, "vidaa")
        self.cert = cfg.get("cert") or os.path.join(folder, "client.pem")
        self.cert_key = cfg.get("cert_key") or os.path.join(folder, "client.key")
        self.store_file = os.path.join(config.DATA, f"vidaa-{self.id}.json")
        stored = self._stored()
        # Newer VIDAA firmware wants a client id in Hisense's own shape, built from a uuid that the
        # pairing is kept against. The uuid is ours (not the TV's) and stays for this TV.
        self.uuid = str(cfg.get("uuid") or stored.get("uuid") or vidaa_auth.new_uuid())
        if not SAFE_UUID.match(self.uuid):
            raise SystemExit(f"tvs[{self.id}].uuid: letters, digits and : . _ - only")
        self.auth_method = cfg.get("auth_method") or stored.get("auth_method")   # None: probe on connect
        if self.auth_method is not None and self.auth_method not in vidaa_auth.ORDER:
            raise SystemExit(f"tvs[{self.id}].auth_method: one of {', '.join(vidaa_auth.ORDER)}")
        cid = str(cfg.get("client_id") or stored.get("client_id") or vidaa_auth.client_id(self.uuid))
        if cid and not SAFE_CLIENT.match(cid):
            raise SystemExit(f"tvs[{self.id}].client_id: letters, digits and . _ : - $ only")
        self.client_id = cid
        self.app_id = COUCH_APP
        self.paired = bool(stored.get("paired"))   # this firmware sends nothing until the PIN is done
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the TV's MQTT port is open
        self.statetype = None       # the last "statetype" the TV sent, None unknown
        self.visible = None         # the same, for the shared power on code in server.py
        self.applist = []           # [{"appId", "name", "url", "urlType", "storeType", "package"}]
        self.ids = {}               # appId -> android style package
        self._ids_checked = 0.0
        self._mqtt = None
        self._connect_lock = asyncio.Lock()
        self._retry_at = 0.0
        self._waiters = {}          # answer name -> [futures]
        self._codes = {}            # one time codes for the home page -> when they run out
        self._front = (None, 0.0)   # (package, when) the last app the bridge opened
        self._listeners = set()
        self._tasks = []
        self.last_error = None      # why the last connection or pairing failed, in plain words
        self.pin_shown_at = 0.0
        self._hooked_at = 0.0       # debounce: the push path and the poll path both call _hook
        self.keep_home = cfg.get("keep_home", False) is True   # opt in: bounce VIDAA's home back to couch-tv
        self._phone_home_at = 0.0   # when the phone remote last sent VIDAA's own Home key (never bounced)
        self._last_home = 0.0       # when the TV last landed on VIDAA's home (to catch a double press)
        self._home_pause_until = 0.0   # a double Home press parks the bounce so VIDAA home is reachable
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []
        self._issued = (None, 0.0)     # (token, when) the last token the TV handed out, on either answer topic
        self._input_until = 0.0        # the Input key was pressed: keep_home leaves VIDAA's home alone until then

    # ---------- what the bridge keeps for this TV ----------
    def _stored(self):
        try:
            with open(self.store_file) as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _keep(self, **changes):
        d = self._stored() | {"client_id": self.client_id, "uuid": self.uuid} | changes
        os.makedirs(os.path.dirname(self.store_file), exist_ok=True)
        tmp = self.store_file + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(d, f)
        os.replace(tmp, self.store_file)

    @property
    def token(self):
        t = self._stored().get("token")
        return t if isinstance(t, str) and t else None

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        if not self.connected or self.statetype is None:
            return None
        return self.statetype not in OFF_STATES

    @property
    def current_package(self):
        """VIDAA does not say which app is in front. The app the bridge last opened counts, until the TV
        goes back to its home, live TV, an input or standby."""
        if not self.connected or self.statetype is None or self.statetype in OFF_STATES or NOTHING.match(self.statetype):
            return None
        pkg, at = self._front
        return pkg if pkg and time.monotonic() - at < 6 * 3600 else None

    @property
    def volume(self):
        return {"level": None, "max": None, "muted": None, "known": False}

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
        return False   # no deep link into a show is known on VIDAA: apps open on their own page

    def vidaa_status(self):
        """For /api/tvs: the parts a tester needs to see at a glance."""
        return {"mqtt": bool(self._mqtt and self._mqtt.alive), "statetype": self.statetype,
                "token": bool(self.token), "certificate": self._have_cert(),
                "tile": bool(self._tile()), "browser": (self._browser() or {}).get("name"),
                "error": self.last_error}

    # ---------- the connection ----------
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

    def _have_cert(self):
        return os.path.isfile(self.cert) and os.path.isfile(self.cert_key)

    def _ssl(self):
        """TLS to the TV. The TV's own certificate is its own, so it is not checked against anything;
        the client certificate goes in when the owner has made one (docs/VIDAA.md, step 2)."""
        if not self.tls:
            return None
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        if self._have_cert():
            try:
                ctx.load_cert_chain(self.cert, self.cert_key)
            except (ssl.SSLError, OSError) as e:
                raise VidaaError(f"the client certificate in {os.path.dirname(self.cert)} could not be "
                                 f"loaded ({type(e).__name__}): run scripts/vidaa-cert.py again") from None
        return ctx

    def _topic(self, service, name):
        return PROTOCOL["action"].format(service=service, client=self.client_id, name=name)

    def _trace(self, way, topic, payload):
        if not self.trace:
            return
        text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload)
        # never the PIN or any token in a log someone may paste into an issue (the PIN now goes as a
        # number). tokenissuance carries refreshtoken next to accesstoken (#145), so any key with
        # token, secret, password or passwd in its name is hidden, not only the ones we read.
        text = TRACE_HIDE.sub(r'\1"(hidden)"', text)
        self.log.info("trace %s %s %s", way, topic, text[:600])

    async def _connection(self):
        """The MQTT connection, opened once and kept. A refusal waits 30 s before the next try."""
        if self._mqtt and self._mqtt.alive:
            return self._mqtt
        async with self._connect_lock:
            if self._mqtt and self._mqtt.alive:
                return self._mqtt
            self.require()
            if time.monotonic() < self._retry_at:
                raise TVUnavailable(self.last_error or "the TV refused the connection a moment ago")
            ctx = self._ssl()
            # The broker wants credentials worked out from the clock, a fresh pair every connect
            # (vidaa_auth). A tester who set mqtt_user/mqtt_password overrides that. The method is
            # the TV's transport era: the known one first, else probe newest to oldest.
            methods = [self.auth_method] if self.auth_method else list(vidaa_auth.ORDER)
            if self.mqtt_user is not None:
                methods = methods[:1]   # the tester's own login: the same pair every time, so try it once
            errors = []   # one entry per (port, scheme) tried, so a later failure never hides an earlier one
            for port in self.ports:
                for method in methods:
                    if self.mqtt_user is not None:
                        cid, user, password = self.client_id, self.mqtt_user, self.mqtt_password
                    else:
                        cid, user, password = vidaa_auth.credentials(self.uuid, method)
                    c = Client(cid, username=user, password=password, on_message=self._message)
                    try:
                        await c.connect(self.ip or self.fallback_ip, port, ssl=ctx)
                    except Refused as e:
                        errors.append((port, method, str(e) + (": check the certificate step and that the TV and "
                                       "this computer agree on the time (docs/VIDAA.md)" if e.code in (4, 5) else "")))
                        await c.close()
                        continue
                    except ssl.SSLError as e:
                        errors.append((port, method, f"the TV ended the secure handshake ({e.reason or type(e).__name__}): "
                                       "usually this means it wants the client certificate (docs/VIDAA.md, step 2). "
                                       "It can also happen when the TV is busy after many attempts in a row "
                                       "(wait a minute) or on firmware with an older TLS setup"))
                        await c.close()
                        break   # a cert problem: another credential scheme will not help
                    except (MQTTError, OSError) as e:
                        errors.append((port, method, str(e) or type(e).__name__))
                        await c.close()
                        continue
                    self.client_id = cid
                    await self._subscribe(c)
                    self._mqtt, self.last_error = c, None
                    if self.auth_method != method or self._stored().get("client_id") != cid:
                        self.auth_method = method
                        self._keep(auth_method=method)   # the working scheme and uuid stay for next time
                    self.log.info("connected on port %s (%s auth)%s", port, method,
                                  " with the client certificate" if ctx and self._have_cert() else "")
                    return c
            last = "; ".join(f"port {p} ({m}): {msg}" for p, m, msg in errors)
            self.last_error = last
            self._retry_at = time.monotonic() + 30
            raise TVUnavailable(f"could not talk to the TV: {last}")

    async def _subscribe(self, c):
        """Subscribe to the data topics one at a time. The TV refuses a # wildcard and refuses the
        data topics until this client is paired, so a refusal here is expected and ignored."""
        for tmpl in PROTOCOL["subscribe"]:
            try:
                await c.subscribe([tmpl.format(client=c.client_id)])
            except MQTTError:
                pass

    async def _drop(self):
        if self._mqtt:
            await self._mqtt.close()
        self._mqtt = None

    def _message(self, topic, payload):
        self._trace("in ", topic, payload)
        try:
            data = json.loads(payload.decode("utf-8")) if payload else None
        except (ValueError, UnicodeDecodeError):
            data = payload.decode("utf-8", "replace")
        name = topic.rstrip("/").rsplit("/", 1)[-1]
        if name == "state" and isinstance(data, dict) and isinstance(data.get("statetype"), str):
            old, new = self.statetype, data["statetype"]
            if new != old:
                self.log.info("screen: %s -> %s", old or "unknown", new)
            self.statetype = self.visible = new
            if NOTHING.match(new) or new in OFF_STATES:
                self._front = (None, 0.0)
            if new == INPUT_STATE:
                self._input_until = 0.0   # a source was picked: Home bounces as usual again
            # Woke from standby straight onto VIDAA's own home: open couch-tv at once, the moment
            # the TV says so, instead of waiting for the next poll (the watch loop stays the backup).
            if old in OFF_STATES and NOTHING.match(new):
                try:
                    asyncio.get_running_loop().create_task(self._hook())
                except RuntimeError:
                    pass
            # Home button, pressed while the TV was on, lands on VIDAA's own home (not live TV or an
            # input): bounce back to couch-tv, so Home feels like it belongs to couch-tv. Two quick
            # Home presses park it for a minute, so VIDAA's own home and settings stay reachable.
            elif self.keep_home and old is not None and old not in OFF_STATES and new == LAUNCHER and new != old:
                now = time.monotonic()
                if now < self._input_until:
                    self._note("VIDAA home while choosing an input: left alone")
                    now = self._last_home   # not a Home press: a Home straight after still bounces once
                elif now < self._home_pause_until:
                    self._home_pause_until = 0.0     # parked on VIDAA; a further Home press = take me back
                    self._note("Home pressed again: returning to couch-tv")
                    self._bounce_home()
                elif now - self._last_home < 5:
                    self._home_pause_until = now + HOME_PAUSE   # two quick presses: keep VIDAA up
                    self._note("Home pressed twice: staying on VIDAA (couch-tv returns shortly, or at once "
                               "from any VIDAA menu)")
                    try:
                        asyncio.get_running_loop().create_task(self._auto_return(HOME_PAUSE))
                    except RuntimeError:
                        pass
                else:
                    self._bounce_home()
                self._last_home = now
        names = (name,)
        if name in PROTOCOL["token_answers"]:
            names = PROTOCOL["token_answers"]   # a token on either topic answers the other's waiter too
            tok = _token_in(data)
            if tok:
                self._issued = (tok, time.monotonic())
        for n in names:
            for fut in self._waiters.pop(n, []):
                if not fut.done():
                    fut.set_result(data)

    async def _publish(self, topic, payload):
        c = await self._connection()
        body = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
        self._trace("out", topic, body)
        try:
            await c.publish(topic, body)
        except MQTTError as e:
            await self._drop()
            raise TVUnavailable(f"the TV closed the connection ({e})") from None

    async def _ask(self, service, name, payload=None, answer=None, timeout=5, topic=None):
        """Publish and wait for the answer whose topic ends in `answer` (default `name`)."""
        fut = asyncio.get_running_loop().create_future()
        self._waiters.setdefault(answer or name, []).append(fut)
        try:
            await self._publish(topic or self._topic(service, name), payload if payload is not None else {})
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise TVUnavailable(f"the TV did not answer {name}") from None
        finally:
            lst = self._waiters.get(answer or name)
            if lst and fut in lst:
                lst.remove(fut)

    async def _send(self, service, name, payload=None):
        await self._publish(self._topic(service, name), payload if payload is not None else {})

    # ---------- pairing (the PIN on the TV) ----------
    async def pair_start(self):
        """Ask the TV to show its 4 digit PIN."""
        self.require()
        await self._send("ui_service", "vidaa_app_connect", dict(PROTOCOL["app_connect"]))
        self.pin_shown_at = time.monotonic()
        return True

    async def pair_finish(self, pin):
        """Send the PIN. The TV answers the authenticationcode with result 1 and binds this client's
        uuid; modern firmware issues no token, so a token is kept only when one is sent."""
        pin = str(pin or "").strip()
        if not PIN.match(pin):
            raise ValueError("the PIN is the 4 digits the TV shows")
        self.require()
        asked = time.monotonic()
        ans = await self._ask("ui_service", "authenticationcode", {PROTOCOL["pin_field"]: int(pin)},
                              answer="authenticationcode")
        if not (isinstance(ans, dict) and ans.get("result") == 1):
            self.last_error = "the TV did not accept that PIN"
            raise VidaaError("the TV did not accept that PIN (it shows a fresh one each time: try again)")

        def issued():   # a token the TV pushed since the PIN went, on gettoken or tokenissuance
            tok, at = self._issued
            return tok if tok and at >= asked else None

        token = issued()
        if not token:
            try:   # older firmware sends a token; modern keeps the pairing against the uuid instead
                got = await self._ask("platform_service", "gettoken", {}, answer="gettoken", timeout=4,
                                      topic=PROTOCOL["token"].format(client=self.client_id))
                token = _token_in(got) or issued()
            except TVUnavailable:
                token = issued()
        self.paired = True
        self._keep(paired=True, auth_method=self.auth_method, **({"token": token} if token else {}))
        self.last_error = None
        self.log.info("paired (kept in %s%s)", os.path.basename(self.store_file),
                      ", with a token" if token else ", no token on this firmware")
        await self._drop()   # reconnect as the paired uuid; the data topics then open
        return True

    # ---------- reading the TV ----------
    async def read_state(self, timeout=4):
        """Ask where the TV is. The answer also updates self.statetype through _message."""
        service, name = PROTOCOL["state_request"]
        try:
            data = await self._ask(service, name, {}, answer="state", timeout=timeout)
        except TVUnavailable:
            return self.statetype   # the TV pushes state on the broadcast topic at connect; use that
        return (data.get("statetype") if isinstance(data, dict) else None) or self.statetype

    async def refresh_installed(self, force=False):
        """The apps on the TV, every 30 minutes."""
        if not force and time.time() - self._ids_checked < 1800 and self.applist:
            return self.ids
        try:
            data = await self._ask("ui_service", "applist", {}, timeout=6)
        except TVUnavailable as e:
            self.log.info("app list: %s", e)
            return self.ids
        rows = data if isinstance(data, list) else []
        if isinstance(data, dict):   # the list may come wrapped in an object
            rows = next((v for v in data.values() if isinstance(v, list)), [])
        listed, found = [], {}
        for r in rows:
            if not isinstance(r, dict):
                continue
            aid, title = str(r.get("appId") or r.get("id") or ""), str(r.get("name") or "").strip()
            if not SAFE_ID.match(aid) or not title:
                continue
            # a VIDAA TV may list "Spotify : Music & Podcasts": the whole name first, then its first word
            pkg = (HOME_PACKAGE if aid == self.tile_id
                   else BY_NAME.get(_plain(title)) or BY_NAME.get(_plain(title.split(" ")[0])))
            if pkg:
                found[aid] = pkg
            listed.append({"appId": aid, "name": title, "url": str(r.get("url") or ""),
                           "urlType": r.get("urlType"), "storeType": r.get("storeType"),
                           "package": pkg or f"vidaa.{aid}"})
        if listed:
            self.applist, self.ids, self._ids_checked = listed, found, time.time()
        return self.ids

    async def apps_on_tv(self):
        await self.refresh_installed()
        return [a for a in self.applist if a["appId"] != self.tile_id]

    def _entry(self, package):
        """The TV's own app list entry for a package, "vidaa.<appId>", or a catalogue id. Only an entry
        the TV listed is ever sent back to it."""
        if package and package.startswith("vidaa."):
            return next((a for a in self.applist if a["appId"] == package[6:]), None)
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        pkg = app["package"] if app else package
        return next((a for a in self.applist if a["package"] == pkg), None)

    def _tile(self):
        return next((a for a in self.applist if a["appId"] == self.tile_id), None)

    def _browser(self):
        want = _plain(self.browser) if self.browser else None
        for a in self.applist:
            n = _plain(a["name"])
            # with a name from config, match it exactly; otherwise take a known browser name, or any
            # app whose name carries "browser" or "internet" (a VIDAA 9 set lists it as "TV Browser").
            if (want and n == want) or (not want and (n in BROWSER_NAMES or "browser" in n or "internet" in n)):
                return a
        return None

    # ---------- couch-tv's page ----------
    def home_url(self, code=None):
        """The bridge's home page as the TV reaches it. "home_url" in config.json wins; else this
        computer's address on the network the TV is on."""
        base = self.home_url_cfg
        if not base:
            port = int(os.environ.get("PORT") or config.BRIDGE.get("port") or 5400)
            base = f"http://{self._my_address()}:{port}/tv/"
        q = []
        if self.id != config.DEFAULT_TV:
            q.append("tv=" + quote(self.id, safe=""))
        if self.pointer:
            q.append("pointer=1")
        if code:
            q.append("vidaa=" + code)
        return base + (("&" if "?" in base else "?") + "&".join(q) if q else "")

    def _my_address(self):
        """This computer's address towards the TV (a UDP socket sends nothing when it connects)."""
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((self.ip or self.fallback_ip or "192.0.2.1", 9))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"
        finally:
            s.close()

    def new_code(self):
        """A one time code for the page the bridge opens, swapped for the pairing key at
        /api/vidaa/claim, so the key itself is never in the page's address."""
        now = time.monotonic()
        self._codes = {c: t for c, t in self._codes.items() if t > now}
        code = secrets.token_urlsafe(18)
        self._codes[code] = now + 120
        return code

    def claim(self, code):
        """True once for a code this TV handed out in the last two minutes."""
        exp = self._codes.pop(code, None) if isinstance(code, str) else None
        return exp is not None and exp > time.monotonic()

    async def open_home(self):
        """Open couch-tv: its tile when one was added, else the TV's browser at the bridge's page."""
        await self.refresh_installed()
        entry = self._tile() or self._browser()
        if not entry:
            raise TVUnavailable("the TV lists no couch-tv tile and no browser to open couch-tv in "
                                "(set \"browser\" to the browser's name in config.json, docs/VIDAA.md)")
        await self._launch_entry(entry, url=self.home_url(self.new_code()))
        self._front = (HOME_PACKAGE, time.monotonic())

    async def install_tile(self, wait=8.0):
        """Ask the TV to add couch-tv to its app row (newer firmware may refuse: then the browser
        stays the way in). True when the tile is in the app list afterwards."""
        self.require()
        base = self.home_url()
        # the bridge's own icon, or icon.png next to a home hosted elsewhere (scripts/build-standalone.sh puts one there)
        icon = base.split("/tv/")[0] + "/vidaa/icon.png" if "/tv/" in base else base.split("?")[0].rstrip("/") + "/icon.png"
        info = {"Title": TILE_TITLE, "Id": self.tile_id, "URL": base, "StoreType": 99}
        if icon:
            info["Image"] = icon
        await self._send("ui_service", "uievent", {"type": "app_install", "app_info": info})
        await asyncio.sleep(wait)
        await self.refresh_installed(force=True)
        return bool(self._tile())

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.statetype)
                self.connected = await self.port_open()
                if not self.connected:
                    self.statetype = self.visible = None
                    await self._drop()
                    if ticks % 30 == 0:
                        await self._resolve()
                else:
                    try:
                        await self._connection()
                        if ticks % 3 == 0 or self.statetype is None:
                            await self.read_state()
                        if self.is_on:
                            await self.refresh_installed()
                    except TVUnavailable as e:
                        if ticks % 30 == 0:
                            self.log.info("%s", e)
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False   # gone from the network counts as off
                if (self.connected, self.statetype) != before:
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

    def _bounce_home(self):
        try:
            asyncio.get_running_loop().create_task(self._reopen())
        except RuntimeError:
            pass

    async def _auto_return(self, after):
        """After a double Home press parks us on VIDAA, come back on our own once the window is up,
        unless the user is still inside a VIDAA menu or has already left the home screen."""
        await asyncio.sleep(after)
        if self.keep_home and self.statetype == LAUNCHER and time.monotonic() >= self._home_pause_until:
            self._home_pause_until = 0.0
            self._note("VIDAA window ended, returning to couch-tv")
            await self._reopen()

    async def _reopen(self):
        """The Home button landed the TV on VIDAA's own home: bring couch-tv back."""
        await asyncio.sleep(0.1)         # the TV already reports it is on its home: bounce fast
        if self.statetype != LAUNCHER or time.monotonic() < self._home_pause_until:
            return                       # the user moved on, or asked for VIDAA's home
        if time.monotonic() - self._phone_home_at < 20:
            return                       # the phone remote's "vidaa_home" key asked for VIDAA's home
        if time.monotonic() < self._input_until:
            return                       # the Input key: VIDAA's source picker sits on its home
        if not self.open_on_power_on:
            return
        # note: no quiet_until check here on purpose, couch-tv never lands the TV on VIDAA's own
        # home itself, so reaching LAUNCHER always means the Home button, which should bounce back.
        try:
            await self._launch(self.app_id, quiet=False)
            self._note("Home pressed, reopened couch-tv")
        except Exception as e:
            self._note(f"Home pressed, could not reopen couch-tv: {e}")

    async def _hook(self):
        """The TV just came on. If it is on its own home or live TV, open couch-tv."""
        if time.monotonic() - self._hooked_at < 8:
            return                       # already opening from the other path
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return                       # not stamped: a phone wake straight after still opens couch-tv
        self._hooked_at = time.monotonic()
        await asyncio.sleep(SETTLE)   # let the TV settle on whatever it opens by itself
        # the TV pushes its state on the broadcast topic the moment it changes, so statetype is
        # already current; only fall back to a (short) read if we somehow have nothing.
        front = self.statetype or await self.read_state(timeout=1.5)
        if front is None:
            self._note("TV came on, could not read where it is, left alone")
            return
        if self.leave_inputs and INPUT.match(front):
            self._note(f"TV came on in {front}, left alone (leave_inputs)")
            return
        if not NOTHING.match(front):
            self._note(f"TV came on in {front}, left alone")
            return
        if not self.open_on_power_on:
            return
        try:
            await self._launch(self.app_id, quiet=False)
            self._note("TV came on, opened couch-tv")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- the remote ----------
    async def key(self, name, hold=False):
        code = resolve_key(name)
        power = code == "KEY_POWER"
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if power and not self.is_on:
            self.home_on_wake_until = time.monotonic() + 90
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our page; VIDAA's own home is "vidaa_home".
            await self._launch(self.app_id)
            return "couch-tv"
        if not code:
            raise ValueError(f"unknown key: {name}")
        self.require()
        if code == "KEY_HOME":
            self._phone_home_at = time.monotonic()   # keep_home must not bounce a home asked for on purpose
        if code == "KEY_INPUT":
            self._input_until = time.monotonic() + INPUT_PAUSE   # nor the source picker the Input key opens
        if power and not self.is_on and not (self._mqtt and self._mqtt.alive):
            await self.wake()   # fully off: the broker is gone with it
            return code
        await self._send(PROTOCOL["key_service"], "sendkey", code)   # a hold is a press
        return code

    async def text(self, text):
        raise TVUnavailable("typing into a VIDAA TV from the phone is not built yet: use the TV's own keyboard")

    async def _launch(self, app_id, quiet=True):
        if quiet:
            self.quiet_until = time.monotonic() + 20
        if app_id == self.app_id:
            await self.open_home()
            return
        entry = next((a for a in self.applist if a["appId"] == app_id), None)
        if not entry:
            raise ValueError(f"not an app the TV listed: {app_id}")
        await self._launch_entry(entry)

    async def _launch_entry(self, entry, url=None):
        """launchapp with the TV's own fields for the app (only ever an entry from its app list)."""
        if not SAFE_ID.match(entry.get("appId") or ""):
            raise ValueError("not a VIDAA app id")
        await self._send("ui_service", "launchapp", {
            "appId": entry["appId"], "name": entry["name"], "url": url if url is not None else entry.get("url") or "",
            "urlType": entry.get("urlType"), "storeType": entry.get("storeType")})

    async def launch_package(self, package):
        """Open an app the TV lists: a catalogue app found by its name, or "vidaa.<appId>"."""
        self.require()
        if package in (HOME_PACKAGE, self.app_id):
            await self._launch(self.app_id)
            return "remote"
        await self.refresh_installed()
        entry = self._entry(package)
        if not entry:
            if not self.applist:
                raise TVUnavailable("the TV has not said which apps it has yet")
            raise TVUnavailable(f"{package} is not installed on the TV")
        self.quiet_until = time.monotonic() + 20
        await self._launch_entry(entry)
        self._front = (entry["package"], time.monotonic())
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """No deep link into a show is known on VIDAA: the app opens on its own page."""
        self.require()
        if not package:
            raise ValueError("VIDAA TVs only open apps, not links: name the app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        """The TV cannot say what is in front: the app the bridge just opened counts once the TV
        has left its home (or right away, when the state cannot be read)."""
        packages = {p for p in packages if p}
        pkg, at = self._front
        if pkg not in packages or time.monotonic() - at > 30:
            return None
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.statetype is None or not NOTHING.match(self.statetype) or pkg == HOME_PACKAGE:
                return pkg
            await asyncio.sleep(0.7)
        return pkg

    async def installed_packages(self):
        if not self.connected:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- what VIDAA does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a VIDAA TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("VIDAA TVs do not give screenshots over the network")

    # ---------- power ----------
    async def _read_power(self):
        await self.read_state()

    async def port_open(self, port=None, timeout=1.0):
        for p in [port] if port else self.ports:
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
                await self._connection()
                await self.read_state()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake-on-LAN, for a TV that is fully off (its MQTT broker goes with it). Only if the TV
        allows it ("Wake on LAN" or "Wake on Wireless Network" in its network settings)."""
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
