"""The connection to an LG TV (webOS), for "kind": "lg" in config.json.

Built from LG's documentation and the open source libraries that speak to LG TVs (aiowebostv,
PyWebOSTV), and tested against a stand-in TV on the computer, not yet on a real LG (docs/LG.md).

Same shape as tv.TV and samsung.SamsungTV, so the server, the phone remote and the Claude ask work
unchanged. It speaks in the Android package names of apps.py (Netflix is still "com.netflix.ninja"
here); apps.WEBOS and the app names the TV lists turn them into LG app ids. Two channels, both on
the home network:

- LG's network remote (SSAP), a websocket on port 3000, or 3001 with encryption (newer firmware).
  The first time, the TV asks to accept the remote, then gives a client key, kept in
  data/lg-<id>-key.txt. Everything goes over it: power state, the app on screen, the apps on the
  TV, opening apps, volume and mute, typing.
- The pointer socket, a second websocket the TV hands out over the first: arrows, OK, Back and
  the rest of the remote's buttons.
Turning the TV on from fully off is Wake-on-LAN.

The hook: a watcher checks the TV every 2 seconds. When the TV comes on and no app is on screen
(live TV, an HDMI input or LG's home), it opens the couch-tv app (lg/ in this repo). That is how an
LG "looks for" couch-tv every time it is switched on. It is an app that opens itself, not a true
home screen: LG's own Home button still opens LG's menu.

Developer Mode: an app installed in Developer Mode is removed when the Developer Mode session runs
out. So once a day while the TV is on, the bridge presses Developer Mode's Extend, with LG's
`ares-launch com.palmdts.devmode -p '{"extend":true}'` when the ares tools are on this computer
(the way reported to work), else by opening the Developer Mode app with the same setting over the
network remote (untested). It does that as the TV comes on, just before couch-tv opens, or, on a
TV left on all day, while couch-tv or live TV is in front, and puts back what was on screen.

What it cannot do (docs/LG.md): screenshots, reading what is playing, ADB tools.
"""
import asyncio
import json
import logging
import os
import re
import shutil
import socket
import time

import aiohttp

import apps
import config
from samsung import netflix_id, youtube_id
from tv import TVUnavailable

# The couch-tv app's id on the TV (lg/app/appinfo.json). "app_id" on the TV in config.json wins.
COUCH_APP = "app.couchtv.home"
HOME_PACKAGE = "app.couchtv.launcher"
DEVMODE_APP = "com.palmdts.devmode"
# How often the Developer Mode countdown is read from LG (it needs the TV on).
LEFT_EVERY_HOURS = 6


def _ts(iso):
    """A local "YYYY-MM-DDTHH:MM:SS" as seconds since the epoch, or None."""
    try:
        return time.mktime(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None

# Power states that mean off. "Active Standby" is "off" with Quick Start+ on: the TV still answers.
OFF_STATES = {"Power Off", "Suspend", "Active Standby"}
# What is on screen when no app is: LG's home, live TV, an input. Not checked on a real LG.
# An HDMI or external input (leave_inputs), and LG's own home (back_to_couch).
INPUT = re.compile(r"^com\.webos\.app\.(hdmi\d*|externalinput\..+)$")
LG_HOME = re.compile(r"^com\.webos\.app\.(home|homeconnect|launcher)$")
NOTHING = re.compile(r"^$|^com\.webos\.app\.(home|homeconnect|launcher|livetv|hdmi\d*|externalinput\..+|inputcommon)$")

# Friendly key name -> the pointer socket's button name (aiowebostv's list).
KEYS = {
    "up": "UP", "down": "DOWN", "left": "LEFT", "right": "RIGHT",
    "ok": "ENTER", "select": "ENTER", "enter": "ENTER",
    "back": "BACK", "exit": "EXIT", "smart_hub": "HOME",
    # LG's network remote has no play/pause toggle either: play_pause sends play.
    "play_pause": "PLAY", "play": "PLAY", "pause": "PAUSE", "stop": "STOP",
    "next": "FASTFORWARD", "previous": "REWIND", "rewind": "REWIND", "fast_forward": "FASTFORWARD",
    "volume_up": "VOLUMEUP", "volume_down": "VOLUMEDOWN", "mute": "MUTE",
    "power": "POWER", "settings": "MENU", "menu": "QMENU", "info": "INFO",
    "guide": "GUIDE", "input": "INPUT_HUB", "captions": "CC",
    "channel_up": "CHANNELUP", "channel_down": "CHANNELDOWN",
    "red": "RED", "green": "GREEN", "yellow": "YELLOW", "blue": "BLUE",
    **{str(n): str(n) for n in range(10)},
}

# The rights the bridge asks for when the TV first shows its prompt (aiowebostv's list, the one
# Home Assistant uses).
PERMISSIONS = [
    "APP_TO_APP", "CLOSE", "CONTROL_AUDIO", "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK",
    "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_MEDIA_RECORDING", "CONTROL_INPUT_TEXT",
    "CONTROL_INPUT_TV", "CONTROL_MOUSE_AND_KEYBOARD", "CONTROL_POWER", "CONTROL_TV_SCREEN", "LAUNCH",
    "LAUNCH_WEBAPP", "READ_APP_STATUS", "READ_COUNTRY_INFO", "READ_CURRENT_CHANNEL",
    "READ_INPUT_DEVICE_LIST", "READ_INSTALLED_APPS", "READ_LGE_SDX", "READ_LGE_TV_INPUT_EVENTS",
    "READ_NETWORK_STATE", "READ_NOTIFICATIONS", "READ_POWER_STATE", "READ_RUNNING_APPS",
    "READ_SETTINGS", "READ_TV_CHANNEL_LIST", "READ_TV_CURRENT_TIME", "READ_UPDATE_INFO", "SEARCH",
    "TEST_OPEN", "TEST_PROTECTED", "TEST_SECURE", "UPDATE_FROM_REMOTE_APP",
    "WRITE_NOTIFICATION_ALERT", "WRITE_NOTIFICATION_TOAST", "WRITE_SETTINGS",
]


def resolve_key(name):
    """Friendly key name (or a raw button name such as RED) -> the LG button. "home" is handled
    before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    raw = k.upper()
    return raw if re.fullmatch(r"[A-Z][A-Z0-9_]{1,30}", raw) else None


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# Catalogue apps by the names an LG lists them under (apps.WEBOS "names" too).
BY_NAME = {}
for _a in apps.APPS:
    for _n in [_a["name"]] + (apps.WEBOS.get(_a["id"]) or {}).get("names", []):
        BY_NAME.setdefault(_plain(_n), _a["package"])


class LGError(RuntimeError):
    """The TV answered a request with an error."""


class LGTV:
    kind = "lg"
    can_read_media = False
    INPUT = INPUT

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"lg.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.app_id = cfg.get("app_id") or COUCH_APP
        # Open couch-tv when the TV comes on ("open_on_power_on": false to stop it).
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        # Press Developer Mode's Extend once a day ("extend_devmode": false to stop it). The name of
        # this TV in LG's ares tools (ares-setup-device) is "ares_device", else the TV's id.
        self.extend_devmode = cfg.get("extend_devmode", True) is not False
        # true: an HDMI or external input counts as in use (a computer or console on it)
        self.leave_inputs = cfg.get("leave_inputs", False) is True
        # true: an app closing to LG's home reopens couch-tv. Home pressed from couch-tv is left alone.
        self.back_to_couch = cfg.get("back_to_couch", False) is True
        self.ares_device = cfg.get("ares_device") or self.id
        self.ares_launch = cfg.get("ares_launch") or os.environ.get("ARES_LAUNCH") or None
        self.ports = [int(cfg["port"])] if cfg.get("port") else [3000, 3001]
        self.key_file = os.path.join(config.DATA, f"lg-{self.id}-key.txt")
        self.devmode_file = os.path.join(config.DATA, f"lg-{self.id}-devmode.json")
        self.devleft_file = os.path.join(config.DATA, f"lg-{self.id}-devleft.json")
        # The port that worked last time, kept per TV so a restart goes straight to it (newer webOS
        # resets port 3000 and only answers on 3001, couch-tv#71).
        self.port_file = os.path.join(config.DATA, f"lg-{self.id}-port.json")
        self._port_seen = self._read_port()
        # Paired means the TV accepted the remote once (a client key is kept). Unlike a Samsung, an
        # LG answers nothing before that, so the watcher asks for it (see _watch).
        self.paired = True
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the TV answers on the network (its remote port is open)
        self.power = None           # the TV's power state, "?" on a webOS too old to say, None unknown
        self.visible = None         # the LG id of the app on screen ("" for none), None when unknown
        self._left_app = (None, 0.0)   # (LG id, when) the last app that went to an empty screen
        self.ids = {}               # LG id -> android-style package, for what is installed
        self.launch_points = []     # every app the TV lists: {"id", "title", "icon"}
        self._ids_checked = 0.0
        self._vol = {}
        self._listeners = set()
        self._session = None
        self._ws = None             # the SSAP websocket, once the TV has accepted the remote
        self._url = None
        self._pending = {}
        self._n = 0
        self._connect_lock = asyncio.Lock()
        self._pointer_ws = None
        self._pointer_lock = asyncio.Lock()
        self._prompt_at = -3600.0
        self._tasks = []
        self.quiet_until = 0.0      # the hook leaves the TV alone until then (a command just ran)
        self.home_on_wake_until = 0.0   # switched on from the phone: the hook opens couch-tv even if quiet
        self._hook_at = -60.0
        self._extending = False
        self.hook_log = []          # (time, what) for the last few hook decisions, for /api/tvs

    # ---------- shape shared with tv.TV ----------
    @property
    def registered(self):
        return self._ws is not None and not self._ws.closed

    @property
    def is_on(self):
        """True when the TV is switched on (a screen-off TV still playing sound counts as on)."""
        if not self.connected or not self.registered:
            return None
        if self.power == "?":
            return bool(self.visible)   # older webOS: an app in front means on
        if self.power is None:
            return None
        return self.power not in OFF_STATES

    @property
    def current_package(self):
        return self._package_of(self.visible) if self.connected else None

    @property
    def volume(self):
        v = self._vol if self.connected else {}
        return {"level": v.get("level"), "max": 100 if "level" in v else None,
                "muted": v.get("muted"), "known": "level" in v}

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
        return app.get("id") in ("netflix", "youtube")

    # ---------- app ids ----------
    def _package_of(self, lg_id):
        if lg_id is None or NOTHING.match(lg_id):
            return None
        if lg_id == self.app_id:
            return HOME_PACKAGE
        return self.ids.get(lg_id) or apps.WEBOS_TO_PACKAGE.get(lg_id) or lg_id

    def _candidates(self, package):
        """LG ids to try for an android-style package (or an LG id given as it is)."""
        if package == HOME_PACKAGE or package == self.app_id:
            return [self.app_id]
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        if not app:
            return [package] if package and "." in package or package in self.ids else []
        mine = [i for i, p in self.ids.items() if p == app["package"]]
        known = (apps.WEBOS.get(app["id"]) or {}).get("ids", [])
        return mine + [i for i in known if i not in mine]

    # ---------- network ----------
    async def _http(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4))
        return self._session

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

    def _key(self):
        try:
            with open(self.key_file) as f:
                return f.read().strip() or None
        except FileNotFoundError:
            return None

    def _read_port(self):
        try:
            with open(self.port_file) as f:
                p = int(json.load(f).get("port"))
            return p if p in self.ports else None
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def _keep_port(self, url):
        """Remember which port answered, so the next start tries it first."""
        try:
            port = int(url.rsplit(":", 1)[1])
        except (ValueError, IndexError):
            return
        if port == self._port_seen or len(self.ports) < 2:
            return
        self._port_seen = port
        try:
            os.makedirs(os.path.dirname(self.port_file), exist_ok=True)
            with open(self.port_file, "w") as f:
                json.dump({"port": port}, f)
        except OSError as e:
            self.log.warning("could not keep the remote port: %s", e)

    def _urls(self):
        """Plain on 3000 first, then encrypted on 3001 (newer firmware refuses the plain one). The
        one that worked last time, in this run or the last, goes first."""
        urls = [f"ws://{self.ip}:{p}" if p != 3001 else f"wss://{self.ip}:{p}" for p in self.ports]
        first = self._url if self._url in urls else next(
            (u for u in urls if self._port_seen and u.endswith(f":{self._port_seen}")), None)
        if first:
            urls.remove(first)
            urls.insert(0, first)
        return urls

    async def _remote(self, pairing_wait=30):
        """The SSAP websocket, opened once and kept. The first time, the TV shows a prompt to
        accept the remote; this waits up to pairing_wait seconds for someone to press it."""
        if self.registered:
            return self._ws
        async with self._connect_lock:
            if self.registered:
                return self._ws
            self.require()
            s = await self._http()
            ws, last = None, None
            for url in self._urls():
                try:
                    ws = await asyncio.wait_for(s.ws_connect(
                        url, ssl=False, heartbeat=20, max_msg_size=8 * 1024 * 1024,
                        timeout=aiohttp.ClientWSTimeout(ws_close=5)), 5)
                    self._url = url
                    self._keep_port(url)
                    break
                except Exception as e:
                    last = e
            if ws is None:
                raise TVUnavailable(f"the TV's remote port did not open ({type(last).__name__})")
            try:
                await self._handshake(ws, pairing_wait)
            except Exception:
                await ws.close()
                raise
            self._ws = ws
            asyncio.create_task(self._read(ws))
            return ws

    async def _handshake(self, ws, pairing_wait):
        async def next_msg(wait):
            msg = await asyncio.wait_for(ws.receive(), wait)
            if msg.type != aiohttp.WSMsgType.TEXT:
                raise TVUnavailable("the TV closed the remote connection")
            return json.loads(msg.data)

        # hello, and the system info newer webOS wants before the register (as aiowebostv does)
        await ws.send_json({"id": "hello", "type": "hello", "payload": {}})
        await next_msg(5)
        await ws.send_json({"id": "sysinfo", "type": "request", "uri": "ssap://system/getSystemInfo", "payload": {}})
        await next_msg(5)
        key = self._key()
        payload = {"forcePairing": False, "pairingType": "PROMPT",
                   "manifest": {"appVersion": "1.1", "manifestVersion": 1, "permissions": PERMISSIONS}}
        if key:
            payload["client-key"] = key
        await ws.send_json({"id": "register_0", "type": "register", "payload": payload})
        end = time.monotonic() + 8
        prompting = False
        try:
            while True:
                j = await next_msg(max(0.1, end - time.monotonic()))
                if j.get("id") != "register_0":
                    continue
                if j.get("type") == "response" and (j.get("payload") or {}).get("pairingType") == "PROMPT":
                    prompting = True
                    self._prompt_at = time.monotonic()
                    end = time.monotonic() + pairing_wait
                    self.log.info("the TV is asking to accept the remote")
                elif j.get("type") == "registered":
                    new = (j.get("payload") or {}).get("client-key")
                    if new and new != key:
                        os.makedirs(os.path.dirname(self.key_file), exist_ok=True)
                        with open(self.key_file, "w") as f:
                            f.write(str(new))
                        os.chmod(self.key_file, 0o600)
                        self.log.info("the TV accepted the remote (client key kept)")
                    return
                elif j.get("type") == "error":
                    raise TVUnavailable(f"the TV said no to the remote ({j.get('error')}): accept it on the TV "
                                        "when it asks, and check LG Connect Apps is on in its network settings")
        except asyncio.TimeoutError:
            raise TVUnavailable("the TV is waiting for someone to accept the remote on its screen" if prompting
                                else "the TV did not answer the remote's hello") from None

    async def _read(self, ws):
        try:
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    break
                try:
                    j = json.loads(msg.data)
                except ValueError:
                    continue
                fut = self._pending.get(j.get("id"))
                if fut and not fut.done():
                    fut.set_result(j)
        except Exception:
            pass
        if self._ws is ws:
            self._ws = None
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(TVUnavailable("the TV closed the remote connection"))

    async def _close(self):
        for ws in (self._ws, self._pointer_ws):
            if ws is not None:
                try:
                    await ws.close()
                except Exception:
                    pass
        self._ws = self._pointer_ws = None

    async def _request(self, uri, payload=None, timeout=6, pairing_wait=30):
        ws = await self._remote(pairing_wait)
        self._n += 1
        rid = f"c{self._n}"
        fut = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        try:
            await ws.send_json({"id": rid, "type": "request", "uri": f"ssap://{uri}", "payload": payload or {}})
            j = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise TVUnavailable(f"the TV did not answer {uri}") from None
        finally:
            self._pending.pop(rid, None)
        if j.get("type") == "error":
            raise LGError(j.get("error") or "error")
        p = j.get("payload") or {}
        if p.get("returnValue") is False:
            raise LGError(p.get("errorText") or p.get("errorCode") or "returnValue false")
        return p

    async def _command(self, uri, payload=None):
        """Send without waiting for the answer (turning off: the TV may not answer)."""
        ws = await self._remote()
        self._n += 1
        await ws.send_json({"id": f"c{self._n}", "type": "request", "uri": f"ssap://{uri}", "payload": payload or {}})

    # ---------- reading the TV ----------
    async def _read_power(self):
        if self.power == "?":
            return
        try:
            self.power = (await self._request("com.webos.service.tvpower/power/getPowerState")).get("state")
        except LGError as e:
            if "404" in str(e):
                self.power = "?"   # older webOS has no power state service
            else:
                raise

    async def _read_visible(self):
        try:
            return (await self._request("com.webos.applicationManager/getForegroundAppInfo")).get("appId") or ""
        except (LGError, TVUnavailable):
            return None

    async def _read_volume(self):
        out = {}
        try:
            p = await self._request("audio/getVolume")
            v = p.get("volumeStatus") or p   # newer webOS nests it
            if isinstance(v.get("volume"), int):
                out["level"] = v["volume"]
            muted = v.get("muteStatus", v.get("muted"))
            if muted is None:
                muted = (await self._request("audio/getStatus")).get("mute")
            if muted is not None:
                out["muted"] = bool(muted)
        except (LGError, TVUnavailable):
            pass
        self._vol = out

    async def refresh_installed(self, force=False):
        """Which apps are on the TV, every 30 minutes: LG lists them all with their names."""
        if not force and time.time() - self._ids_checked < 1800 and self.launch_points:
            return self.ids
        try:
            p = await self._request("com.webos.applicationManager/listLaunchPoints", timeout=10)
        except (LGError, TVUnavailable) as e:
            self.log.info("app list: %s", e)
            return self.ids
        points, found = [], {}
        for lp in p.get("launchPoints") or []:
            lid = lp.get("id")
            if not lid:
                continue
            points.append({"id": lid, "title": lp.get("title") or lid, "icon": lp.get("icon") or lp.get("largeIcon")})
            pkg = HOME_PACKAGE if lid == self.app_id else apps.WEBOS_TO_PACKAGE.get(lid) or BY_NAME.get(_plain(lp.get("title")))
            if pkg:
                found[lid] = pkg
        if points:
            self.launch_points, self.ids, self._ids_checked = points, found, time.time()
        return self.ids

    async def apps_on_tv(self):
        """Every app the TV lists, for the couch-tv app on the TV (/api/webos/apps)."""
        await self.refresh_installed()
        return self.launch_points

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.power, self.visible, self._vol.get("level"), self._vol.get("muted"))
                self.connected = await self.port_open()
                if not self.connected and ticks % 30 == 0:
                    await self._resolve()   # it may have come back on a new address
                if self.connected and not self.registered:
                    # With a client key this is quick and silent. Without one the TV shows its
                    # prompt: asked again at most every 10 minutes, so nobody is pestered.
                    if self._key() or time.monotonic() - self._prompt_at > 600:
                        try:
                            await self._remote(pairing_wait=60)
                        except TVUnavailable as e:
                            self._prompt_at = time.monotonic()
                            self.log.info("remote: %s", e)
                if self.connected and self.registered:
                    await self._read_power()
                    prev = self.visible
                    self.visible = await self._read_visible()
                    if self.visible != prev and prev is not None and self.visible is not None:
                        self.log.info("screen: %s -> %s", prev or "nothing", self.visible or "nothing")
                        came = prev
                        # webOS 26 closes some apps (Disney+) through an empty screen: app -> "" -> LG home
                        if self.visible == "" and prev and not NOTHING.match(prev):
                            self._left_app = (prev, time.monotonic())
                        elif prev == "" and time.monotonic() - self._left_app[1] < 6:
                            came = self._left_app[0]
                        if (self.back_to_couch and was_on and LG_HOME.match(self.visible)
                                and came not in ("", self.app_id, DEVMODE_APP) and not NOTHING.match(came)
                                and not self._extending and time.monotonic() >= self.quiet_until):
                            asyncio.create_task(self._back_to_couch(came))
                    if self.is_on:
                        await self.refresh_installed()
                        if ticks % 3 == 0:
                            await self._read_volume()
                elif not self.connected:
                    self.power, self.visible = None, None
                    await self._close()
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                elif (on and self._devmode_due() and not self._extending and ticks % 15 == 0
                      and ticks >= 30 and time.monotonic() - self._hook_at > 30):
                    # a TV left on: every 30 s, from a minute after the bridge starts
                    asyncio.create_task(self._daily_extend())
                if on and ticks % 300 == 45 and not self._extending:
                    # the countdown, read at most every LEFT_EVERY_HOURS (it needs the TV on)
                    asyncio.create_task(self.check_devmode_left())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False   # gone from the network counts as off
                after = (self.connected, self.power, self.visible, self._vol.get("level"), self._vol.get("muted"))
                if after != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            ticks += 1
            await asyncio.sleep(2)

    async def _back_to_couch(self, came_from):
        """An app closed to LG's home: put couch-tv back, unless something else came up."""
        await asyncio.sleep(1)
        if not LG_HOME.match(await self._read_visible() or ""):
            return
        try:
            await self._launch(self.app_id, quiet=False)
            self._note(f"{came_from} closed to LG home, reopened couch-tv")
        except Exception as e:
            self._note(f"{came_from} closed to LG home, could not reopen couch-tv: {e}")

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The TV just came on. If nothing else is on screen, open couch-tv (and, once a day,
        press Developer Mode's Extend first, so couch-tv covers whatever that shows)."""
        # Only the watcher calls this, once per switch-on (a Samsung also has its art channel, so it
        # skips a second call within 15 s; an LG switched off and on quickly should still get it).
        self._hook_at = time.monotonic()
        if time.monotonic() < self.home_on_wake_until:
            # switched on from the phone: the home, even if a command (a Home press, an app opened
            # just before it went off) still holds the quiet time
            self.home_on_wake_until = 0.0
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        await asyncio.sleep(1.5)   # let the TV settle on whatever it opens by itself
        front = await self._read_visible()
        if front and front == self.app_id:
            self._note("TV came on, couch-tv already open")
            if self._devmode_due():
                await self._daily_extend()
            return
        if front is None:
            self._note("TV came on, could not read what is on screen, left alone")
            return
        if self.leave_inputs and INPUT.match(front):
            self._note(f"TV came on in {front}, left alone (leave_inputs)")
            return
        if not NOTHING.match(front):
            self._note(f"TV came on in {self._package_of(front)}, left alone")
            return
        if self._devmode_due():
            if await self.extend_devmode_now():
                await self._wait_devmode_app()
        if not self.open_on_power_on:
            return
        try:
            await self._launch(self.app_id, quiet=False)
            self._note("TV came on, opened couch-tv")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- Developer Mode ----------
    def _devmode_state(self):
        try:
            with open(self.devmode_file) as f:
                return json.load(f)
        except (FileNotFoundError, ValueError):
            return {}

    def _devmode_due(self):
        """At most once a day (by the computer's date), only when switched on in config.json. A try
        that failed does not count as the day's: it is tried again an hour later (couch-tv#45)."""
        if not self.extend_devmode:
            return False
        s = self._devmode_state()
        if s.get("date") != time.strftime("%Y-%m-%d"):
            return True
        if s.get("ok"):
            return False
        try:
            return time.time() - time.mktime(time.strptime(s["at"], "%Y-%m-%dT%H:%M:%S")) >= 3600
        except (KeyError, ValueError, OverflowError):
            return True

    async def _daily_extend(self):
        """A TV left on: extend while couch-tv or live TV is in front, then put that back."""
        if self._extending or time.monotonic() < self.quiet_until:
            return
        front = await self._read_visible()
        if front is None or not (front == self.app_id or NOTHING.match(front)):
            return   # an app is on screen: try again later
        if self.leave_inputs and INPUT.match(front):
            return   # an input in use: try again later
        if await self.extend_devmode_now():
            await self._wait_devmode_app()
        else:
            await asyncio.sleep(2)
        now = await self._read_visible()
        if front and now != front:
            try:
                await self._launch(front, quiet=False)
            except Exception as e:
                self.log.info("could not put %s back: %s", front, e)

    async def _wait_devmode_app(self, timeout=20.0):
        """After Extend, Developer Mode's own app takes a few seconds to come up (about 5 s on webOS
        10) and covers whatever is on screen. Wait for it, up to timeout, so couch-tv goes back on
        top of it and not underneath it (couch-tv#71). A TV where it never shows is waited on for the
        full time, so the caller then carries on as before. Returns True when the app appeared."""
        end = time.monotonic() + timeout
        while True:
            try:
                if await self._read_visible() == DEVMODE_APP:
                    await asyncio.sleep(0.5)
                    return True
            except Exception:
                pass
            if time.monotonic() >= end:
                return False
            await asyncio.sleep(0.5)

    async def extend_devmode_now(self):
        """Press Developer Mode's Extend. Returns True when it reported success."""
        if self._extending:
            return False
        self._extending = True
        state = {"date": time.strftime("%Y-%m-%d"), "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": False}
        try:
            ares = self.ares_launch or shutil.which("ares-launch")
            if ares:
                state["how"] = "ares-launch"
                proc = await asyncio.create_subprocess_exec(
                    ares, "--device", self.ares_device, DEVMODE_APP, "-p", json.dumps({"extend": True}),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
                try:
                    out, _ = await asyncio.wait_for(proc.communicate(), 60)
                except asyncio.TimeoutError:
                    proc.kill()
                    out = b"timed out after 60 s"
                state["ok"] = proc.returncode == 0
                if not state["ok"]:
                    lines = (out or b"").decode(errors="replace").strip().splitlines()
                    state["error"] = (lines[-1] if lines else f"exit {proc.returncode}")[:200]
            else:
                state["how"] = "remote"
                await self._launch(DEVMODE_APP, params={"extend": True}, quiet=False)
                state["ok"] = True
        except Exception as e:
            state["error"] = f"{type(e).__name__}: {e}"[:200]
        finally:
            self._extending = False
        prev = self._devmode_state()
        state["last_ok_at"] = state["at"] if state["ok"] else (
            prev.get("last_ok_at") or (prev.get("at") if prev.get("ok") else None))
        state["fails"] = 0 if state["ok"] else int(prev.get("fails") or 0) + 1
        if state["ok"]:
            asyncio.create_task(self.check_devmode_left(force=True))
        try:
            os.makedirs(os.path.dirname(self.devmode_file), exist_ok=True)
            with open(self.devmode_file, "w") as f:
                json.dump(state, f)
        except OSError as e:
            self.log.warning("could not keep the Developer Mode date: %s", e)
        self._note(f"Developer Mode extended ({state['how']})" if state["ok"]
                   else f"Developer Mode extend failed ({state.get('how')}): {state.get('error')}")
        return state["ok"]

    # ---------- Developer Mode health ----------
    def _left_state(self):
        try:
            with open(self.devleft_file) as f:
                return json.load(f)
        except (FileNotFoundError, ValueError):
            return {}

    async def check_devmode_left(self, force=False):
        """Read the Developer Mode countdown, at most every LEFT_EVERY_HOURS: the session token from the
        TV (over Developer Mode's ssh, with LG's ares tools), then LG's own session check.
        The token is never logged or kept."""
        last = self._left_state()
        if not force and time.time() - (_ts(last.get("at")) or 0) < LEFT_EVERY_HOURS * 3600:
            return last
        out = {"at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            ares = shutil.which("ares-novacom", path=os.path.dirname(self.ares_launch)) if self.ares_launch else None
            ares = ares or shutil.which("ares-novacom")
            if not ares:
                raise RuntimeError("ares-novacom not found")
            proc = await asyncio.create_subprocess_exec(
                ares, "--device", self.ares_device, "--run", "cat /var/luna/preferences/devmode_enabled",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            raw, _ = await asyncio.wait_for(proc.communicate(), 60)
            token = "".join(l for l in raw.decode(errors="replace").splitlines() if not l.startswith("[")).strip()
            if not re.fullmatch(r"[0-9A-Za-z]{16,128}", token):
                raise RuntimeError("no session token on the TV")
            async with aiohttp.ClientSession() as s:
                async with s.get("https://developer.lge.com/secure/CheckDevModeSession.dev",
                                 params={"sessionToken": token}, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    j = await r.json(content_type=None)
            m = re.fullmatch(r"(\d+):(\d+):(\d+)", str(j.get("errorMsg", "")))
            if j.get("result") != "success" or not m:
                raise RuntimeError(f"LG answered {j.get('errorCode')}: {str(j.get('errorMsg'))[:60]}")
            out["hours"] = round(int(m.group(1)) + int(m.group(2)) / 60, 1)
        except Exception as e:
            # only the bridge's own messages: an aiohttp error's text can carry the request address,
            # and with it the session token
            out["error"] = (str(e) if isinstance(e, RuntimeError) else type(e).__name__)[:160]
            out["hours"] = last.get("hours")
            out["hours_at"] = last.get("hours_at")
        else:
            out["hours_at"] = out["at"]
        try:
            with open(self.devleft_file, "w") as f:
                json.dump(out, f)
        except OSError:
            pass
        self.log.info("Developer Mode left: %s", out.get("hours") if "error" not in out else out["error"])
        return out

    # The warning as a key and numbers, so the TV home and the phone can say it in their language
    # (devmode_* in tv-home/web/i18n.js and remote/src/i18n.js). The English text below is also sent,
    # for a TV home or phone that is older than these keys.
    DEVMODE_WARNINGS = {
        "devmode_gone": "couch-tv is no longer installed on the TV. Developer Mode probably ran out. "
                        "Switch Developer Mode on again and ask Claude to reinstall couch-tv.",
        "devmode_runs_out": "Developer Mode runs out in {days} days, and then LG removes couch-tv. "
                            "Turn the TV on for a minute so it can be renewed, or press Extend in the "
                            "Developer Mode app on the TV.",
        "devmode_not_renewed_left": "Developer Mode has not been renewed for {days} days ({left} days left). "
                                    "It renews the next time the TV is on.",
        "devmode_not_renewed": "Developer Mode has not been renewed for {days} days. "
                               "It renews the next time the TV is on.",
    }

    def devmode_warning_parts(self):
        """(level, key, vars) when couch-tv is at risk, else None. level is "alert" or "warn"."""
        ids = {p.get("id") for p in self.launch_points}
        if self.launch_points and self.app_id not in ids:
            return ("alert", "devmode_gone", {})
        if not self.extend_devmode:
            return None
        left = self._left_state()
        h, h_at = left.get("hours"), _ts(left.get("hours_at"))
        if h is not None and h_at:
            h -= (time.time() - h_at) / 3600   # it keeps counting down since it was read
            if h < 168:
                return ("alert", "devmode_runs_out", {"days": max(0, int(h // 24))})
            if h < 900:
                return ("warn", "devmode_not_renewed_left", {"days": int((999 - h) // 24), "left": int(h // 24)})
            return None
        st = self._devmode_state()
        ok_at = _ts(st.get("last_ok_at") or (st.get("at") if st.get("ok") else None))
        if ok_at and time.time() - ok_at > 3 * 86400:
            return ("warn", "devmode_not_renewed", {"days": int((time.time() - ok_at) // 86400)})
        return None

    def devmode_warning(self):
        """A plain English sentence when couch-tv is at risk, else None. ("alert" or "warn", text)"""
        w = self.devmode_warning_parts()
        return (w[0], self.DEVMODE_WARNINGS[w[1]].format(**w[2])) if w else None

    def devmode_status(self):
        s = self._devmode_state()
        left, w = self._left_state(), self.devmode_warning_parts()
        text = self.DEVMODE_WARNINGS[w[1]].format(**w[2]) if w else None
        return {"on": self.extend_devmode, "last": s.get("at"), "ok": s.get("ok"), "how": s.get("how"),
                "error": s.get("error"), "last_ok": s.get("last_ok_at") or (s.get("at") if s.get("ok") else None), "fails": s.get("fails", 0),
                "hours_left": left.get("hours"), "hours_read": left.get("hours_at"),
                "warning": text, "level": w[0] if w else None,
                "warning_key": w[1] if w else None, "warning_vars": w[2] if w else None}

    # ---------- the remote ----------
    async def _pointer(self):
        """The pointer socket, for the remote's buttons. The TV gives its address over SSAP."""
        if self._pointer_ws is not None and not self._pointer_ws.closed:
            return self._pointer_ws
        path = (await self._request("com.webos.service.networkinput/getPointerInputSocket")).get("socketPath")
        if not path:
            raise TVUnavailable("the TV did not give a pointer socket")
        tries = [path]
        if path.startswith("ws://") and (self._url or "").startswith("wss://"):
            tries.append("wss://" + path[5:].replace(":3000/", ":3001/", 1))
        s = await self._http()
        last = None
        for url in tries:
            try:
                self._pointer_ws = await asyncio.wait_for(s.ws_connect(url, ssl=False, heartbeat=20), 5)
                asyncio.create_task(self._drain(self._pointer_ws))
                return self._pointer_ws
            except Exception as e:
                last = e
        raise TVUnavailable(f"the TV's pointer socket did not open ({type(last).__name__})")

    async def _drain(self, ws):
        try:
            async for _ in ws:
                pass
        except Exception:
            pass
        if self._pointer_ws is ws:
            self._pointer_ws = None

    async def pointer(self, dx=0, dy=0, click=False, scroll=0):
        """LG's pointer, over the same socket as the buttons: move by (dx, dy), click, or scroll."""
        self.quiet_until = time.monotonic() + 20
        msgs = []
        if dx or dy:
            msgs.append(f"type:move\ndx:{int(dx)}\ndy:{int(dy)}\ndown:0\n\n")
        if scroll:
            msgs.append(f"type:scroll\ndx:0\ndy:{int(scroll)}\n\n")
        if click:
            msgs.append("type:click\n\n")
        if not msgs:
            return
        async with self._pointer_lock:
            for attempt in (1, 2):
                ws = await self._pointer()
                try:
                    for m in msgs:
                        await ws.send_str(m)
                    return
                except Exception:
                    self._pointer_ws = None
                    if attempt == 2:
                        raise

    async def _button(self, name):
        async with self._pointer_lock:
            for attempt in (1, 2):
                ws = await self._pointer()
                try:
                    await ws.send_str(f"type:button\nname:{name}\n\n")
                    return
                except Exception:
                    self._pointer_ws = None
                    if attempt == 2:
                        raise

    async def key(self, name, hold=False):
        # A power press from the phone should land on couch-tv, like one from the TV's own remote.
        power = isinstance(name, str) and resolve_key(name) == "POWER"
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if power and not self.is_on:
            self.home_on_wake_until = time.monotonic() + 90
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our app; LG's own menu is "smart_hub".
            await self._launch(self.app_id)
            return "couch-tv"
        code = resolve_key(name)
        if not code:
            raise ValueError(f"unknown key: {name}")
        # The pointer socket has no press and release, so a hold is a press.
        if code == "POWER":
            if self.is_on:
                await self._command("system/turnOff")
            else:
                await self._turn_on()   # from Quick Start+ standby
        elif code in ("VOLUMEUP", "VOLUMEDOWN"):
            await self._request("audio/volumeUp" if code == "VOLUMEUP" else "audio/volumeDown")
        elif code == "MUTE":
            await self.set_mute(not self._vol.get("muted"))
        else:
            await self._button(code)
        return code

    async def _turn_on(self):
        """webOS 4 has no system/turnOn (404): try the power service's turnOnScreen, then
        Wake-on-LAN (couch-tv#46). Any failure on the way ends in Wake-on-LAN, never an error: a
        remote connection that went stale while the TV slept raises "Cannot write to closing
        transport" (ClientConnectionResetError), not a 404, and a TV in standby can refuse both."""
        for uri in ("system/turnOn", "com.webos.service.tvpower/power/turnOnScreen"):
            try:
                await self._request(uri, timeout=3)
                return
            except Exception as e:
                self.log.info("power on: %s did not take (%s)", uri, type(e).__name__)
        await self.wake()

    async def text(self, text):
        """Types into the box on screen (only works while the TV shows its keyboard)."""
        await self._request("com.webos.service.ime/insertText", {"text": text, "replace": 0})
        await self._request("com.webos.service.ime/sendEnterKey")

    async def set_mute(self, on):
        await self._request("audio/setMute", {"mute": bool(on)})
        await self._read_volume()

    async def _launch(self, lg_id, content_id=None, params=None, quiet=True):
        """Open an app. quiet: the hook then leaves the TV alone for 20 seconds (a command from
        the phone or Claude wins); the bridge's own Developer Mode chores pass False."""
        if quiet:
            self.quiet_until = time.monotonic() + 20
        payload = {"id": lg_id}
        if content_id:
            payload["contentId"] = content_id
        if params:
            payload["params"] = params
        await self._request("system.launcher/launch", payload, timeout=10)

    async def launch_package(self, package):
        """Open an app. Tries each LG id the app is known by, installed ones first."""
        self.require()
        ids = self._candidates(package)
        if not ids:
            raise ValueError(f"no LG app id known for {package}")
        await self.refresh_installed()
        installed = [i for i in ids if i in self.ids or i == self.app_id]
        last = None
        for lid in installed or ids:
            try:
                await self._launch(lid)
                return "remote"
            except LGError as e:
                last = e
        raise TVUnavailable(f"the TV would not open {package}: {last}")

    async def start_intent(self, uri, package=None, cold=False):
        """Open a show. Netflix and YouTube links open the title (as LG's own integrations do it);
        any other app just opens."""
        self.require()
        self.quiet_until = time.monotonic() + 20
        pkg = package or apps.BY_ID.get("netflix" if netflix_id(uri) else "youtube" if youtube_id(uri) else "", {}).get("package")
        app = apps.BY_PACKAGE.get(pkg or "")
        if app and app["id"] == "netflix" and netflix_id(uri):
            lid = (self._candidates(app["package"]) or ["netflix"])[0]
            await self._launch(lid, content_id=f"m=https://api-global.netflix.com/catalog/titles/movies/{netflix_id(uri)}&source_type=4")
            return "remote"
        if app and app["id"] == "youtube" and youtube_id(uri):
            lid = (self._candidates(app["package"]) or ["youtube.leanback.v4"])[0]
            await self._launch(lid, params={"contentTarget": f"https://www.youtube.com/tv?v={youtube_id(uri)}"})
            return "remote"
        if not pkg:
            raise ValueError("LG TVs only open links for Netflix and YouTube")
        await self.launch_package(pkg)
        return "app"

    async def front_package(self):
        if not self.connected or not self.registered:
            return None
        self.visible = await self._read_visible()
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        packages = {p for p in packages if p}
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            front = await self.front_package()
            if front in packages:
                return front
            await asyncio.sleep(0.7)
        return None

    async def installed_packages(self):
        if not self.connected or not self.registered:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- what LG does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is an LG TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("LG TVs do not give screenshots over the network")

    # ---------- power ----------
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
                await self._remote(pairing_wait=10)
                await self._read_power()
                self.visible = await self._read_visible()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake-on-LAN, for a TV that is fully off. An LG only wakes this way when "Mobile TV On,
        Turn on via Wi-Fi" (2017 and later) or "Wake on LAN" (2025 models) is on in its settings."""
        if not self.mac or not self.wake_on_lan:
            return
        self.quiet_until = 0.0   # a wake from the phone should land on couch-tv
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
                    except OSError:
                        pass
        finally:
            s.close()
