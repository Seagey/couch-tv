"""The connection to a Samsung TV (Tizen, 2016 and later), for "kind": "samsung" in config.json.

Same shape as tv.TV, so the server, the phone remote and the Claude ask work unchanged. It speaks
in the Android package names of apps.py (Netflix is still "com.netflix.ninja" here), and apps.TIZEN
turns them into Samsung app ids. Four channels, all on the home network:

- REST on port 8001 (no pairing): power state, and whether each app is on screen.
- The network remote, a websocket on 8002 (the TV asks "Allow" once, then gives a token, kept in
  data/samsung-<id>-token.txt): keys, typing, and opening apps.
- DIAL on 8080 (no pairing): Netflix and YouTube links that open a title, not just the app.
- UPnP on 9197 (no pairing): the volume level and mute.
A Frame TV also gets the art channel (8002, no prompt), to tell Art Mode from watching TV.

The hook: a watcher checks the TV every 2 seconds. When the TV comes on (from standby, or a Frame
leaving Art Mode) and no app is on screen, it opens the couch-tv app (samsung/ in this repo). That
is how a Samsung "looks for" couch-tv every time it is switched on. It is an app that opens itself,
not a true home screen: Samsung's own Home button still opens Samsung's menu.

What it cannot do (docs/SAMSUNG.md): screenshots, reading what is playing, ADB tools.
"""
import asyncio
import base64
import json
import logging
import os
import re
import socket
import ssl
import time
import uuid
from urllib.parse import quote

import aiohttp

import apps
import config
from tv import TVUnavailable

# The couch-tv app's id on the TV (samsung/app/config.xml). "app_id" on the TV in config.json wins.
COUCH_APP = "CouchTVApp.Home"
HOME_PACKAGE = "app.couchtv.launcher"

KEYS = {
    "up": "KEY_UP", "down": "KEY_DOWN", "left": "KEY_LEFT", "right": "KEY_RIGHT",
    "ok": "KEY_ENTER", "select": "KEY_ENTER", "enter": "KEY_ENTER",
    "back": "KEY_RETURN", "exit": "KEY_EXIT", "smart_hub": "KEY_HOME",
    # Samsung remotes have no play/pause toggle on the network remote: play_pause sends play.
    "play_pause": "KEY_PLAY", "play": "KEY_PLAY", "pause": "KEY_PAUSE", "stop": "KEY_STOP",
    "next": "KEY_FF", "previous": "KEY_REWIND", "rewind": "KEY_REWIND", "fast_forward": "KEY_FF",
    "volume_up": "KEY_VOLUP", "volume_down": "KEY_VOLDOWN", "mute": "KEY_MUTE",
    "power": "KEY_POWER", "settings": "KEY_MENU", "menu": "KEY_TOOLS", "info": "KEY_INFO",
    "guide": "KEY_GUIDE", "input": "KEY_SOURCE", "captions": "KEY_CAPTION",
    "channel_up": "KEY_CHUP", "channel_down": "KEY_CHDOWN",
    **{str(n): f"KEY_{n}" for n in range(10)},
}


def resolve_key(name):
    """Friendly key name (or a raw KEY_ name) -> the Samsung key. "home" is handled before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    raw = k.upper()
    return raw if re.fullmatch(r"KEY_[A-Z0-9_]{1,30}", raw) else None


def _b64(text):
    return base64.b64encode(text.encode()).decode()


def youtube_id(link):
    m = re.search(r"(?:[?&]v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})", link or "")
    return m.group(1) if m else None


def netflix_id(link):
    m = re.search(r"netflix\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?(?:title|watch)/(\d+)", link or "")
    return m.group(1) if m else None


class SamsungTV:
    kind = "samsung"
    can_read_media = False

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"samsung.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.app_id = cfg.get("app_id") or COUCH_APP
        # Jobs for the couch-tv app on the TV (it collects them from /api/tizen/next): launching
        # another app with Samsung's title data, which only an app on the TV may do.
        self._tv_jobs = asyncio.Queue()
        self._tv_answers = {}
        # Open couch-tv when the TV comes on ("open_on_power_on": false to stop it).
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.remote_name = cfg.get("remote_name") or config.CLIENT_NAME
        self.token_file = os.path.join(config.DATA, f"samsung-{self.id}-token.txt")
        # Paired means the TV has said Allow once (a token is kept). Keys need it; the rest does not.
        self.paired = True
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the TV answers on the network
        self.power = None           # "on" / "standby" from the TV, None when it does not answer
        self.frame = False
        self.art_mode = None        # Frame only: True in Art Mode
        self.visible = None         # the Tizen id of the app on screen, None for TV/HDMI/menus
        self.ids = {}               # Tizen id -> android-style package, for what is installed
        self._ids_checked = 0.0
        self._vol = {}
        self._listeners = set()
        self._session = None
        self._ws = None
        self._ws_lock = asyncio.Lock()
        self._art_task = None
        self._tasks = []
        self.quiet_until = 0.0      # the hook leaves the TV alone until then (a command just ran)
        self._hook_at = -60.0
        self.hook_log = []          # (time, what) for the last few hook decisions, for /api/tvs

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        """True when someone is watching: powered on and, on a Frame, not in Art Mode."""
        if not self.connected or self.power is None:
            return None
        if self.power != "on":
            return False
        if self.frame and self.art_mode:
            return False
        return True

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
    def _package_of(self, tizen_id):
        if not tizen_id:
            return None
        if tizen_id == self.app_id:
            return HOME_PACKAGE
        return self.ids.get(tizen_id) or apps.TIZEN_TO_PACKAGE.get(tizen_id) or tizen_id

    def _candidates(self, package):
        """Tizen ids to try for an android-style package (or a Tizen id given as it is)."""
        if package in (HOME_PACKAGE,) or package == self.app_id:
            return [self.app_id]
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        t = apps.TIZEN.get(app["id"]) if app else None
        if not t:
            return [package] if package and "." in package or (package or "").isdigit() else []
        mine = [i for i, p in self.ids.items() if p == app["package"]]
        return mine + [i for i in t["ids"] if i not in mine]

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
                self.host, 8001, family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    async def _get_json(self, path, timeout=3):
        s = await self._http()
        async with s.get(f"http://{self.ip}:8001{path}", timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            if r.status == 404:
                return None
            return await r.json(content_type=None)

    async def _read_device(self):
        try:
            j = await self._get_json("/api/v2/", timeout=2)
            dev = (j or {}).get("device") or {}
            self.power = dev.get("PowerState") or "on"   # older TVs leave it out and only answer when on
            self.frame = str(dev.get("FrameTVSupport")).lower() == "true"
            return True
        except Exception:
            self.power = None
            return False

    async def _app_state(self, tizen_id):
        try:
            return await self._get_json(f"/api/v2/applications/{quote(tizen_id)}")
        except Exception:
            return None

    async def refresh_installed(self, force=False):
        """Which catalogue apps are on the TV: asks the TV about each known id (Samsung removed the
        call that listed them all). Every 30 minutes, about 30 quick requests."""
        if not force and time.time() - self._ids_checked < 1800 and self.ids:
            return self.ids
        found = {}
        jobs = [(tid, app["package"]) for app in apps.APPS for tid in (apps.TIZEN.get(app["id"]) or {}).get("ids", [])]
        jobs.append((self.app_id, HOME_PACKAGE))
        results = await asyncio.gather(*(self._app_state(tid) for tid, _ in jobs))
        for (tid, pkg), res in zip(jobs, results):
            if res and res.get("id"):
                found[tid] = pkg
        if found:
            self.ids, self._ids_checked = found, time.time()
        return self.ids

    async def _read_visible(self):
        ids = list(self.ids) or [self.app_id]
        results = await asyncio.gather(*(self._app_state(t) for t in ids))
        return next((t for t, r in zip(ids, results) if r and r.get("visible")), None)

    @staticmethod
    def _soap(action, extra=""):
        return ('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
                's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
                f'<u:{action} xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">'
                f'<InstanceID>0</InstanceID><Channel>Master</Channel>{extra}'
                f'</u:{action}></s:Body></s:Envelope>')

    async def set_mute(self, on):
        """Mute on or off over UPnP. The remote's KEY_MUTE is ignored by a 2021 Frame (seen 29 Oct:
        four presses, still unmuted), and a set cannot leave it the wrong way round like a toggle."""
        s = await self._http()
        async with s.post(f"http://{self.ip}:9197/upnp/control/RenderingControl1",
                          data=self._soap("SetMute", "<DesiredMute>%d</DesiredMute>" % (1 if on else 0)),
                          headers={"Content-Type": 'text/xml; charset="utf-8"',
                                   "SOAPACTION": '"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"'},
                          timeout=aiohttp.ClientTimeout(total=3)) as r:
            await r.text()
        await self._read_volume()

    async def _read_volume(self):
        soap = self._soap
        s = await self._http()
        out = {}
        for action, tag, key in (("GetVolume", "CurrentVolume", "level"), ("GetMute", "CurrentMute", "muted")):
            try:
                async with s.post(f"http://{self.ip}:9197/upnp/control/RenderingControl1", data=soap(action),
                                  headers={"Content-Type": 'text/xml; charset="utf-8"',
                                           "SOAPACTION": f'"urn:schemas-upnp-org:service:RenderingControl:1#{action}"'},
                                  timeout=aiohttp.ClientTimeout(total=3)) as r:
                    m = re.search(rf"<{tag}>(\d+)</{tag}>", await r.text())
                    if m:
                        out[key] = int(m.group(1)) if key == "level" else m.group(1) == "1"
            except Exception:
                pass
        self._vol = out

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.power, self.art_mode, self.visible, self._vol.get("level"), self._vol.get("muted"))
                self.connected = await self._read_device()
                if not self.connected and ticks % 30 == 0:
                    await self._resolve()   # it may have come back on a new address
                if self.connected:
                    if self.frame and (self._art_task is None or self._art_task.done()):
                        self._art_task = asyncio.create_task(self._art_loop())
                    await self.refresh_installed()
                    if self.power == "on" and self.frame and self.art_mode:
                        self.visible = None   # Art Mode: no app on screen
                    elif self.power == "on":
                        # one request per installed app, so every other tick (the hook reads its own)
                        if ticks % 2 == 0:
                            self.visible = await self._read_visible()
                        if ticks % 3 == 0:
                            await self._read_volume()
                    else:
                        self.visible = None
                else:
                    self.visible, self.art_mode = None, None
                    await self._ws_close()
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False   # gone from the network counts as off
                after = (self.connected, self.power, self.art_mode, self.visible, self._vol.get("level"), self._vol.get("muted"))
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
        """The TV just came on. If nothing else is on screen, open couch-tv."""
        if not self.open_on_power_on:
            return
        if time.monotonic() - self._hook_at < 15:
            return   # the art channel and the watcher both saw the same switch-on
        self._hook_at = time.monotonic()
        if time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        await asyncio.sleep(1.5)   # let the TV settle on whatever it opens by itself
        front = await self._read_visible()
        if front == self.app_id:
            self._note("TV came on, couch-tv already open")
            return
        if front:
            self._note(f"TV came on in {self._package_of(front)}, left alone")
            return
        try:
            await self._launch_tizen(self.app_id)
            self._note("TV came on, opened couch-tv")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    async def _art_loop(self):
        """Frame TVs: keep the art channel open and follow Art Mode on and off."""
        url = (f"wss://{self.ip}:8002/api/v2/channels/com.samsung.art-app?name={quote(_b64(self.remote_name))}")
        try:
            s = await self._http()
            async with s.ws_connect(url, ssl=_no_verify(), heartbeat=30, timeout=aiohttp.ClientWSTimeout(ws_close=5)) as ws:
                ask = lambda: ws.send_json({"method": "ms.channel.emit", "params": {
                    "event": "art_app_request", "to": "host",
                    "data": json.dumps({"request": "get_artmode_status", "id": str(uuid.uuid4())})}})
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        break
                    j = json.loads(msg.data)
                    ev = j.get("event")
                    if ev == "ms.channel.ready":
                        await ask()
                    elif ev == "d2d_service_message":
                        d = json.loads(j.get("data") or "{}")
                        sub = d.get("event", "")
                        new = self.art_mode
                        if "artmode_status" in sub or sub == "art_mode_changed":
                            new = (d.get("value") or d.get("status")) == "on"
                        elif sub == "go_to_standby":
                            new = False
                        elif "wakeup" in sub:
                            await ask()
                        if new != self.art_mode:
                            left = self.art_mode is True and new is False
                            self.art_mode = new
                            self.log.info("Art Mode %s", "on" if new else "off")
                            if left and self.power == "on":
                                asyncio.create_task(self._hook())   # straight away, not on the next tick
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.log.debug("art channel: %s %s", type(e).__name__, e)
        await asyncio.sleep(3)

    # ---------- the network remote ----------
    def _token(self):
        try:
            with open(self.token_file) as f:
                return f.read().strip() or None
        except FileNotFoundError:
            return None

    async def _ws_close(self):
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        self._ws = None

    async def _remote(self, pairing_wait=30):
        """The remote websocket, opened once and kept. The first time, the TV shows an Allow
        prompt; this waits up to pairing_wait seconds for someone to press it."""
        if self._ws is not None and not self._ws.closed:
            return self._ws
        self.require()
        url = (f"wss://{self.ip}:8002/api/v2/channels/samsung.remote.control"
               f"?name={quote(_b64(self.remote_name))}")
        tok = self._token()
        if tok:
            url += f"&token={quote(tok)}"
        s = await self._http()
        ws = await s.ws_connect(url, ssl=_no_verify(), heartbeat=30, timeout=aiohttp.ClientWSTimeout(ws_close=5))
        try:
            while True:
                msg = await asyncio.wait_for(ws.receive(), pairing_wait)
                if msg.type != aiohttp.WSMsgType.TEXT:
                    raise TVUnavailable("the TV closed the remote connection")
                j = json.loads(msg.data)
                if j.get("event") == "ms.channel.connect":
                    new = (j.get("data") or {}).get("token")
                    if new and new != tok:
                        os.makedirs(os.path.dirname(self.token_file), exist_ok=True)
                        with open(self.token_file, "w") as f:
                            f.write(str(new))
                        os.chmod(self.token_file, 0o600)
                        self.log.info("the TV allowed the remote (token kept)")
                    break
                if j.get("event") == "ms.channel.unauthorized":
                    raise TVUnavailable("the TV said no to the remote: press Allow on the TV when it asks "
                                        "(Settings, General, External Device Manager, Device Connection Manager)")
        except asyncio.TimeoutError:
            await ws.close()
            raise TVUnavailable("the TV is waiting for someone to press Allow on its screen")
        except Exception:
            await ws.close()
            raise
        self._ws = ws
        asyncio.create_task(self._drain(ws))
        return ws

    async def _drain(self, ws):
        try:
            async for _ in ws:
                pass
        except Exception:
            pass
        if self._ws is ws:
            self._ws = None

    async def _send(self, payload):
        async with self._ws_lock:
            for attempt in (1, 2):
                ws = await self._remote()
                try:
                    await ws.send_json(payload)
                    return
                except Exception:
                    await self._ws_close()
                    if attempt == 2:
                        raise

    async def _key(self, code, cmd="Click"):
        await self._send({"method": "ms.remote.control", "params": {
            "Cmd": cmd, "DataOfCmd": code, "Option": "false", "TypeOfRemote": "SendRemoteKey"}})

    async def key(self, name, hold=False):
        self.quiet_until = time.monotonic() + 20
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our app; Samsung's own menu is "smart_hub".
            await self._launch_tizen(self.app_id)
            return "couch-tv"
        code = resolve_key(name)
        if not code:
            raise ValueError(f"unknown key: {name}")
        if hold:
            # A Frame: holding power switches it fully off (a press only goes to Art Mode).
            await self._key(code, "Press")
            await asyncio.sleep(3.0 if code == "KEY_POWER" else 0.8)
            await self._key(code, "Release")
        else:
            await self._key(code)
        return code

    async def text(self, text):
        """Types into the box on screen (only works while the TV shows its keyboard)."""
        await self._send({"method": "ms.remote.control", "params": {
            "Cmd": _b64(text), "DataOfCmd": "base64", "TypeOfRemote": "SendInputString"}})
        await self._send({"method": "ms.remote.control", "params": {"TypeOfRemote": "SendInputEnd"}})

    async def _launch_tizen(self, tizen_id, meta=""):
        """Open an app. The TV's REST call (port 8001, no pairing) is what works: on a 2021 Frame
        the remote's ed.apps.launch was ignored, for store apps and sideloaded ones alike, while
        the same TV took keys on that channel. The remote call stays as the fallback."""
        self.quiet_until = time.monotonic() + 20
        try:
            s = await self._http()
            async with s.post(f"http://{self.ip}:8001/api/v2/applications/{quote(tizen_id)}",
                              timeout=aiohttp.ClientTimeout(total=5)) as r:
                if r.status == 200 and (await r.text()).strip() == "true":
                    return
        except Exception as e:
            self.log.info("REST launch of %s failed: %s", tizen_id, e)
        await self._send({"method": "ms.channel.emit", "params": {
            "event": "ed.apps.launch", "to": "host",
            "data": {"appId": tizen_id, "action_type": "DEEP_LINK", "metaTag": meta}}})

    async def _dial(self, name, body):
        s = await self._http()
        headers = {"Content-Type": "text/plain; charset=utf-8"}
        if name == "YouTube":
            headers["Origin"] = "https://www.youtube.com"   # without it the TV answers 403
        async with s.post(f"http://{self.ip}:8080/ws/apps/{name}", data=body.encode(), headers=headers,
                          timeout=aiohttp.ClientTimeout(total=8)) as r:
            if r.status not in (200, 201):
                raise RuntimeError(f"DIAL {name} said {r.status}")

    async def launch_package(self, package):
        """Open an app. Tries each Tizen id the app is known by, installed ones first."""
        self.require()
        ids = self._candidates(package)
        if not ids:
            raise ValueError(f"no Samsung app id known for {package}")
        await self.refresh_installed()
        installed = [i for i in ids if i in self.ids or i == self.app_id]
        await self._launch_tizen((installed or ids)[0])
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """Open a show. Netflix and YouTube links open the title through DIAL; any other app just
        opens (Samsung apps take no outside links)."""
        self.require()
        self.quiet_until = time.monotonic() + 20
        pkg = package or apps.BY_ID.get("netflix" if netflix_id(uri) else "youtube" if youtube_id(uri) else "", {}).get("package")
        app = apps.BY_PACKAGE.get(pkg or "")
        if app and app["id"] == "netflix" and netflix_id(uri):
            body = f"m=https://api-global.netflix.com/catalog/titles/movies/{netflix_id(uri)}&source_type=4"
            cold = not ((await self._app_state(await self._installed_id(app, "Netflix")) or {}).get("running"))
            await self._dial("Netflix", body)
            await self.press_through(app, cold, lambda: self._dial("Netflix", body))
            return "dial"
        if app and app["id"] == "youtube" and youtube_id(uri):
            await self._dial("YouTube", f"v={youtube_id(uri)}")
            return "dial"
        if not pkg:
            raise ValueError("Samsung TVs only open links for Netflix and YouTube")
        await self.launch_package(pkg)
        return "app"

    # ---------- titles through the couch-tv app on the TV ----------
    # JustWatch gives Samsung title links as {"id", "action_data"} (finder.py). A 2021 Frame ignores
    # them over the remote channel, but an app on the TV can pass them on with launchAppControl
    # (operation eden_resume, PAYLOAD {"values": action_data}): field notes from a 2024 Samsung
    # opened Prime titles that way. Without a screen to read, the profile screen and Play are
    # pressed blind, timed per app (BLIND).
    BLIND = {
        # app id: (seconds to the profile screen on a cold start, [seconds before each OK after
        # the title opens]). Netflix (his 2021 Frame, 29 Oct): the link lands on the show's card,
        # OK opens it full screen, a second OK plays; an OK at 5 s came too early.
        "prime-video": (9, [6]),
        "stan": (8, []),          # Stan starts by itself with "play": true
        "netflix": (8, [8, 3]),
    }

    async def tizen_next(self, wait=25):
        """For the app on the TV: the next job, or None after `wait` seconds."""
        try:
            return await asyncio.wait_for(self._tv_jobs.get(), wait)
        except asyncio.TimeoutError:
            return None

    def tizen_answer(self, job_id, answer):
        fut = self._tv_answers.pop(job_id, None)
        if fut and not fut.done():
            fut.set_result(answer)

    async def via_tv_app(self, job, timeout=8):
        """Hand a job to the couch-tv app on the TV and wait for its answer."""
        job = {"id": f"j{time.monotonic_ns()}", **job}
        fut = asyncio.get_running_loop().create_future()
        self._tv_answers[job["id"]] = fut
        await self._tv_jobs.put(job)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            self._tv_answers.pop(job["id"], None)
            return {"ok": False, "error": "the couch-tv app on the TV did not answer"}

    async def _installed_id(self, app, given):
        await self.refresh_installed()
        ids = self._candidates(app["package"])
        return next((i for i in ids if i in self.ids), None) or given

    async def open_title(self, app, link, play=True):
        """Open one title with Samsung's own link data, then pass the profile screen (the first
        profile) and press Play, blind. Returns True once the app was handed the title."""
        self.require()
        self.quiet_until = time.monotonic() + 40
        target = await self._installed_id(app, link["id"])
        data = link.get("action_data") or ""
        if app["id"] == "stan" and play:
            data = data.replace('"play": false', '"play": true').replace('"play":false', '"play":true')
        state = await self._app_state(target) or {}
        cold = not state.get("running")
        # The app on the TV only runs while it is in front, so bring couch-tv forward first.
        if self.visible != self.app_id:
            await self._launch_tizen(self.app_id)
            await asyncio.sleep(2.5)
        job = {"do": "appcontrol", "app": target, "data": data}
        answer = await self.via_tv_app(job)
        if not answer.get("ok"):
            self.log.info("title link for %s refused: %s", app["id"], answer.get("error"))
            return False
        self.log.info("title link for %s handed to %s (%s)", app["id"], target, "cold" if cold else "warm")
        if play:
            async def again():
                await self._launch_tizen(self.app_id)
                await asyncio.sleep(2.5)
                await self.via_tv_app(job)
            await self.press_through(app, cold, again)
        return True

    async def press_through(self, app, cold, again):
        """Blind: on a cold start take the profile screen with OK (the highlighted profile,
        normally the first), open the title again, then OK on the title page's Play."""
        blind = self.BLIND.get(app["id"])
        if not blind:
            return
        to_profile, presses = blind
        if cold:
            await asyncio.sleep(to_profile)
            await self._key("KEY_ENTER")
            await asyncio.sleep(3)
            await again()
        for wait in presses:
            await asyncio.sleep(wait)
            await self._key("KEY_ENTER")

    async def front_package(self):
        if not self.connected:
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
        if not self.connected:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- what Samsung does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a Samsung TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("Samsung TVs do not give screenshots over the network")

    # ---------- power ----------
    async def port_open(self, port=8001, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def reconnect_now(self):
        self.connected = await self._read_device()
        self._changed()
        return self.connected

    async def wake(self):
        """Wake-on-LAN, for a TV that is fully off. A Samsung on Wi-Fi only wakes this way when
        "Power on with mobile" (or "Network standby") is on in its settings."""
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


def _no_verify():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # the TV's certificate is self-signed
    return ctx

