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

# Power states that mean off. "Active Standby" is "off" with Quick Start+ on: the TV still answers.
OFF_STATES = {"Power Off", "Suspend", "Active Standby"}
# What is on screen when no app is: LG's home, live TV, an input. Not checked on a real LG.
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
        self.ares_device = cfg.get("ares_device") or self.id
        self.ares_launch = cfg.get("ares_launch") or os.environ.get("ARES_LAUNCH") or None
        self.ports = [int(cfg["port"])] if cfg.get("port") else [3000, 3001]
        self.key_file = os.path.join(config.DATA, f"lg-{self.id}-key.txt")
        self.devmode_file = os.path.join(config.DATA, f"lg-{self.id}-devmode.json")
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

    def _urls(self):
        """Plain on 3000 first, then encrypted on 3001 (newer firmware refuses the plain one)."""
        urls = [f"ws://{self.ip}:{p}" if p != 3001 else f"wss://{self.ip}:{p}" for p in self.ports]
        if self._url in urls:
            urls.remove(self._url)
            urls.insert(0, self._url)
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
                    self.visible = await self._read_visible()
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

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The TV just came on. If nothing else is on screen, open couch-tv (and, once a day,
        press Developer Mode's Extend first, so couch-tv covers whatever that shows)."""
        # Only the watcher calls this, once per switch-on (a Samsung also has its art channel, so it
        # skips a second call within 15 s; an LG switched off and on quickly should still get it).
        self._hook_at = time.monotonic()
        if time.monotonic() < self.quiet_until:
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
        if not NOTHING.match(front):
            self._note(f"TV came on in {self._package_of(front)}, left alone")
            return
        if self._devmode_due():
            await self.extend_devmode_now()
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
        """At most once a day (by the computer's date), only when switched on in config.json."""
        return self.extend_devmode and self._devmode_state().get("date") != time.strftime("%Y-%m-%d")

    async def _daily_extend(self):
        """A TV left on: extend while couch-tv or live TV is in front, then put that back."""
        if self._extending or time.monotonic() < self.quiet_until:
            return
        front = await self._read_visible()
        if front is None or not (front == self.app_id or NOTHING.match(front)):
            return   # an app is on screen: try again later
        await self.extend_devmode_now()
        await asyncio.sleep(2)
        now = await self._read_visible()
        if front and now != front:
            try:
                await self._launch(front, quiet=False)
            except Exception as e:
                self.log.info("could not put %s back: %s", front, e)

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
        try:
            os.makedirs(os.path.dirname(self.devmode_file), exist_ok=True)
            with open(self.devmode_file, "w") as f:
                json.dump(state, f)
        except OSError as e:
            self.log.warning("could not keep the Developer Mode date: %s", e)
        self._note(f"Developer Mode extended ({state['how']})" if state["ok"]
                   else f"Developer Mode extend failed ({state.get('how')}): {state.get('error')}")
        return state["ok"]

    def devmode_status(self):
        s = self._devmode_state()
        return {"on": self.extend_devmode, "last": s.get("at"), "ok": s.get("ok"), "how": s.get("how"),
                "error": s.get("error")}

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
                await self._request("system/turnOn")   # from Quick Start+ standby
        elif code in ("VOLUMEUP", "VOLUMEDOWN"):
            await self._request("audio/volumeUp" if code == "VOLUMEUP" else "audio/volumeDown")
        elif code == "MUTE":
            await self.set_mute(not self._vol.get("muted"))
        else:
            await self._button(code)
        return code

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
