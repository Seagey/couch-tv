"""The connection to a Roku (TV or box), for "kind": "roku" in config.json.

Built from Roku's External Control Protocol (ECP) documentation, and tested against a stand-in Roku
on the computer, NOT yet on a real Roku (docs/ROKU.md). ECP is plain HTTP on port 8060 on the home
network, with no pairing and no key:

- GET  query/device-info       the model, and power-mode (PowerOn when the TV is on)
- GET  query/active-app        the app in front (no id on Roku's own home)
- GET  query/apps              every channel installed, with its id and name
- GET  query/icon/<id>         a channel's icon
- GET  query/media-player      state, position and duration of whatever is playing (no title)
- POST keypress/<Key>          a remote button; keypress/Lit_<char> types one character
- POST launch/<id>[?contentId=&mediaType=]   open a channel, and a title in it where the channel allows

Same shape as tv.TV, samsung.SamsungTV and lg.LGTV, so the server, the phone remote and the Claude
ask work unchanged. It speaks in the Android package names of apps.py (Netflix is still
"com.netflix.ninja" here); apps.ROKU and the names the Roku lists turn them into Roku channel ids.
A channel couch-tv has no name for gets the package "roku.<id>".

The hook: a watcher checks the Roku every 2 seconds. When the TV comes on and no app is on screen
(Roku's home, live TV, an HDMI input), it launches the couch-tv channel (roku/ in this repo), the
sideloaded channel whose id is "dev". It is a channel that opens itself, not a true home screen:
the remote's Home button still opens Roku's own home.

"Control by mobile apps" (Settings, System, Advanced system settings): newer Roku OS limits ECP
unless it allows network access. A Roku in the limiting mode answers keypress and launch with 403.
That is reported plainly (ecp_status) instead of looking like a dead TV.

What it cannot do (docs/ROKU.md): screenshots, ADB tools, a volume level, a title for what is playing.
"""
import asyncio
import logging
import os
import re
import socket
import time
import xml.etree.ElementTree as ET
from urllib.parse import quote

import aiohttp

import apps
from samsung import netflix_id, youtube_id
from tv import TVUnavailable

# The sideloaded couch-tv channel is always called "dev" on a Roku. "app_id" in config.json wins.
COUCH_APP = "dev"
HOME_PACKAGE = "app.couchtv.launcher"

# What power-mode says. Only PowerOn is documented (developer.roku.com, query/device-info); the other
# values (Ready, DisplayOff, Headless) come from community write-ups, so anything but PowerOn counts as off.
ON_MODE = "PowerOn"

# What is "in front" when no app is: Roku's home and screensavers have no id. Live TV and inputs on a
# Roku TV are "tvinput.*". Neither list is checked on a real Roku.
INPUT = re.compile(r"^tvinput\.(hdmi\d|cvbs|component|av\d)", re.I)
NOTHING = re.compile(r"^$|^tvinput\.", re.I)

# Friendly key name -> ECP key (developer.roku.com, External Control API). Volume and power keys only
# work on a Roku TV; PowerOn is not in Roku's list but is what Roku TVs answer to.
KEYS = {
    "up": "Up", "down": "Down", "left": "Left", "right": "Right",
    "ok": "Select", "select": "Select", "enter": "Select",
    "back": "Back", "roku_home": "Home",
    "play_pause": "Play", "play": "Play", "pause": "Play", "stop": "Play",   # Roku has one Play/Pause key
    "next": "Fwd", "previous": "Rev", "rewind": "Rev", "fast_forward": "Fwd",
    "replay": "InstantReplay",
    "volume_up": "VolumeUp", "volume_down": "VolumeDown", "mute": "VolumeMute",
    "power": "Power", "info": "Info", "settings": "Info", "menu": "Info", "search": "Search",
    "input": "InputTuner", "channel_up": "ChannelUp", "channel_down": "ChannelDown",
    "hdmi1": "InputHDMI1", "hdmi2": "InputHDMI2", "hdmi3": "InputHDMI3", "hdmi4": "InputHDMI4",
}
# The rest of Roku's documented keys, accepted as they are written.
RAW_KEYS = {"Home", "Rev", "Fwd", "Play", "Select", "Left", "Right", "Down", "Up", "Back",
            "InstantReplay", "Info", "Backspace", "Search", "Enter", "FindRemote", "VolumeDown",
            "VolumeMute", "VolumeUp", "PowerOff", "PowerOn", "ChannelUp", "ChannelDown", "InputTuner",
            "InputHDMI1", "InputHDMI2", "InputHDMI3", "InputHDMI4", "InputAV1"}

LIMITED_HELP = ("the Roku is refusing remote control (Control by mobile apps is on a limited mode). On the Roku open "
                "Settings, System, Advanced system settings, Control by mobile apps, Network access, and choose "
                "Permissive (older Roku OS) or Enabled (newer). The names differ by Roku OS version.")


def resolve_key(name):
    """Friendly key name (or one of Roku's own key names) -> the ECP key. "home" is handled before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    for raw in RAW_KEYS:
        if raw.lower() == k.lower():
            return raw
    return None


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


BY_NAME = {}
for _a in apps.APPS:
    for _n in [_a["name"]] + (apps.ROKU.get(_a["id"]) or {}).get("names", []):
        BY_NAME.setdefault(_plain(_n), _a["package"])


class ECPLimited(TVUnavailable):
    """The Roku answered 403: Control by mobile apps is limiting it."""


class RokuError(RuntimeError):
    """The Roku answered a request with an error status."""


class RokuTV:
    kind = "roku"
    can_read_media = False    # no title from ECP; the position comes from query/media-player instead
    native_media = True       # this driver fills state["media_now"] itself (the ADB loop leaves it alone)
    INPUT = INPUT

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"roku.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.port = int(cfg.get("port") or 8060)
        self.app_id = str(cfg.get("app_id") or COUCH_APP)
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.leave_inputs = cfg.get("leave_inputs", False) is True
        self.paired = True          # ECP has no pairing
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # the Roku answers on port 8060
        self.power = None           # power-mode from device-info, None unknown
        self.visible = None         # id of the app in front ("" for none), None when unknown
        self.device = {}            # model, software version and so on, from device-info
        self.ecp_limited = False    # the last command was refused with 403
        self.ids = {}               # channel id -> android style package, for what is installed
        self.channels = []          # every channel the Roku lists: {"id", "title", "package"}
        self._ids_checked = 0.0
        self._listeners = set()
        self._session = None
        self._tasks = []
        self._icons = {}
        self.quiet_until = 0.0      # the hook leaves the TV alone until then (a command just ran)
        self.home_on_wake_until = 0.0   # switched on from the phone: the hook opens couch-tv even if quiet
        self.hook_log = []          # (time, what) for the last few hook decisions, for /api/tvs

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        if not self.connected or self.power is None:
            return None
        return self.power == ON_MODE

    @property
    def current_package(self):
        return self._package_of(self.visible) if self.connected else None

    @property
    def volume(self):
        return {"level": None, "max": None, "muted": None, "known": False}   # ECP has no volume level

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

    def ecp_status(self):
        """For /api/tvs: whether Control by mobile apps is limiting the Roku, in a plain sentence."""
        return {"limited": self.ecp_limited, "message": LIMITED_HELP if self.ecp_limited else None}

    # ---------- app ids ----------
    def _package_of(self, rid):
        if rid is None or NOTHING.match(rid):
            return None
        if rid == self.app_id:
            return HOME_PACKAGE
        return self.ids.get(rid) or apps.ROKU_TO_PACKAGE.get(rid) or f"roku.{rid}"

    def _candidates(self, package):
        """Roku ids to try for an android style package, "roku.<id>", or a bare id."""
        if package in (HOME_PACKAGE, self.app_id):
            return [self.app_id]
        if package and package.startswith("roku."):
            return [package[5:]]
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        if not app:
            return [package] if package and package in self.ids else []
        mine = [i for i, p in self.ids.items() if p == app["package"]]
        known = (apps.ROKU.get(app["id"]) or {}).get("ids", [])
        return mine + [i for i in known if i not in mine]

    # ---------- ECP ----------
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
                self.host, self.port, family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    def _url(self, path):
        return f"http://{self.ip or self.fallback_ip}:{self.port}/{path}"

    async def _ecp(self, method, path, raw=False, timeout=4):
        """One ECP request. 403 means Control by mobile apps is limiting the Roku."""
        s = await self._http()
        try:
            async with s.request(method, self._url(path), timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                if r.status == 403:
                    self.ecp_limited = True
                    raise ECPLimited(LIMITED_HELP)
                if r.status >= 400:
                    raise RokuError(f"the Roku answered {r.status} to {method} {path.split('?')[0]}")
                self.ecp_limited = False
                return await (r.read() if raw else r.text())
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"the Roku did not answer ({type(e).__name__})") from None

    async def _xml(self, path):
        try:
            return ET.fromstring(await self._ecp("GET", path))
        except ET.ParseError:
            raise RokuError(f"the Roku sent something that is not XML for {path}") from None

    # ---------- reading the TV ----------
    async def _read_power(self):
        root = await self._xml("query/device-info")
        self.power = (root.findtext("power-mode") or "").strip() or ON_MODE   # a Roku that does not say is on
        self.device = {k: (root.findtext(k) or "").strip() for k in
                       ("model-name", "software-version", "is-tv", "supports-tv-power-control")}
        return self.power

    async def _read_visible(self):
        try:
            root = await self._xml("query/active-app")
        except (RokuError, TVUnavailable):
            return None
        app = root.find("app")
        return (app.get("id") or "") if app is not None else ""

    async def _read_media(self):
        """What query/media-player says about the app in front: playing, paused or nothing. No title."""
        try:
            root = await self._xml("query/media-player")
        except (RokuError, TVUnavailable):
            return None
        state = {"play": "playing", "pause": "paused", "buffer": "buffering"}.get(root.get("state", ""))
        if not state:
            return None
        ms = lambda tag: int(re.sub(r"\D", "", root.findtext(tag) or "") or 0) or None
        return {"state": state, "position_ms": ms("position"), "duration_ms": ms("duration")}

    async def refresh_installed(self, force=False):
        """Which channels are on the Roku, every 30 minutes: it lists every one with its id and name."""
        if not force and time.time() - self._ids_checked < 1800 and self.channels:
            return self.ids
        try:
            root = await self._xml("query/apps")
        except (RokuError, TVUnavailable) as e:
            self.log.info("app list: %s", e)
            return self.ids
        points, found = [], {}
        for el in root.findall("app"):
            rid, title = el.get("id"), (el.text or "").strip()
            if not rid or not title:
                continue
            known = apps.ROKU_TO_PACKAGE.get(rid) or BY_NAME.get(_plain(title))
            if known:
                found[rid] = known
            points.append({"id": rid, "title": title, "package": known or f"roku.{rid}"})
        if points:
            self.channels, self.ids, self._ids_checked = points, found, time.time()
        return self.ids

    async def apps_on_tv(self):
        """Every channel the Roku lists, for the couch-tv channel (/api/roku/apps)."""
        await self.refresh_installed()
        return [c for c in self.channels if c["id"] != self.app_id]

    async def icon(self, rid):
        """A channel's icon (bytes, content type), kept in memory. Newer Roku OS may refuse it (403)."""
        if rid in self._icons:
            return self._icons[rid]
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", rid or ""):
            raise ValueError("not a channel id")
        s = await self._http()
        async with s.get(self._url(f"query/icon/{rid}")) as r:
            if r.status != 200:
                raise RokuError(f"the Roku has no icon for {rid} ({r.status})")
            self._icons[rid] = (await r.read(), r.headers.get("Content-Type", "image/jpeg"))
        return self._icons[rid]

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.power, self.visible, dict(self.state["media_now"]))
                try:
                    await self._read_power()
                    self.connected = True
                except ECPLimited:
                    self.connected = True
                except (TVUnavailable, RokuError):
                    self.connected = False
                    if ticks % 30 == 0:
                        await self._resolve()   # it may have come back on a new address
                if self.connected and not self.ecp_limited:
                    if self.is_on:
                        self.visible = await self._read_visible()
                        await self.refresh_installed()
                        await self._watch_media()
                    else:
                        self.visible = None
                        self.state["media_now"].clear()
                elif not self.connected:
                    self.power, self.visible = None, None
                    self.state["media_now"].clear()
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False   # gone from the network counts as off
                if (self.connected, self.power, self.visible, dict(self.state["media_now"])) != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            ticks += 1
            await asyncio.sleep(2)

    async def _watch_media(self):
        """Keep state["media_now"] for /api/now: the state and position of what plays in the front app."""
        media = self.state["media_now"]
        if not self.visible or NOTHING.match(self.visible) or self.visible == self.app_id:
            media.clear()
            return
        m = await self._read_media()
        if not m:
            media.clear()
            return
        pkg = self.current_package
        old = dict(media)
        media.clear()
        media.update({"title": None, "episode_title": None, "season": None, "episode": None,
                      "package": pkg, "state": m["state"], "poster": None, "backdrop": None,
                      "position_ms": m["position_ms"], "duration_ms": None, "duration_source": None,
                      "read_at": time.time(), "title_from": None})
        # keep read_at steady unless something changed, so /api/now is not pushed on every tick
        if old.get("package") == pkg and old.get("state") == m["state"] and abs((old.get("position_ms") or 0) - (m["position_ms"] or 0)) < 4000:
            media["read_at"] = old["read_at"]

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The TV just came on. If nothing else is on screen, open couch-tv."""
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0   # switched on from the phone: the home, even inside the quiet time
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        await asyncio.sleep(1.5)   # let the TV settle on whatever it opens by itself
        front = await self._read_visible()
        if front and front == self.app_id:
            self._note("TV came on, couch-tv already open")
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
        if not self.open_on_power_on:
            return
        try:
            await self._launch(self.app_id, quiet=False)
            self._note("TV came on, opened couch-tv")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- the remote ----------
    async def _keypress(self, key):
        await self._ecp("POST", f"keypress/{key}")

    async def key(self, name, hold=False):
        # A power press from the phone should land on couch-tv, like one from the TV's own remote.
        code = resolve_key(name)
        power = code == "Power"
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if power and not self.is_on:
            self.home_on_wake_until = time.monotonic() + 90
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our channel; Roku's own home is "roku_home".
            await self._launch(self.app_id)
            return "couch-tv"
        if not code:
            raise ValueError(f"unknown key: {name}")
        self.require()
        if power:
            if self.is_on:
                await self._keypress("PowerOff")
            else:
                await self._turn_on()
        else:
            await self._keypress(code)   # ECP has no long press for a remote key here: a hold is a press
        return code

    async def _turn_on(self):
        """PowerOn works on a Roku TV that answers on the network (not in the ECP list, but Roku TVs take it).
        A TV in deep standby has left the network: Wake-on-LAN, if the TV allows it (Fast TV start)."""
        try:
            await self._keypress("PowerOn")
        except Exception as e:
            self.log.info("power on: PowerOn did not take (%s)", type(e).__name__)
            await self.wake()

    async def text(self, text):
        """Types into the box on screen, one character at a time (ECP's Lit_ keys)."""
        self.require()
        for ch in text:
            await self._keypress("Lit_" + quote(ch, safe=""))
            await asyncio.sleep(0.05)

    async def _launch(self, rid, content_id=None, media_type=None, quiet=True):
        """Open a channel. quiet: the hook then leaves the TV alone for 20 seconds (a command from the
        phone or Claude wins); the bridge's own chores pass False."""
        if quiet:
            self.quiet_until = time.monotonic() + 20
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", str(rid)):
            raise ValueError(f"not a Roku channel id: {rid}")
        q = ""
        if content_id:
            q = f"?contentId={quote(str(content_id), safe='')}" + (f"&mediaType={media_type}" if media_type else "")
        await self._ecp("POST", f"launch/{rid}{q}", timeout=8)

    async def launch_package(self, package):
        """Open a channel. Tries each id the app is known by, installed ones first."""
        self.require()
        await self.refresh_installed()
        ids = self._candidates(package)
        if not ids:
            raise ValueError(f"no Roku channel id known for {package}")
        listed = {c["id"] for c in self.channels}
        installed = [i for i in ids if i in listed or i == self.app_id]
        last = None
        for rid in (installed if self.channels else ids):
            try:
                await self._launch(rid)
                return "remote"
            except RokuError as e:
                last = e
        if self.channels and not installed:
            raise TVUnavailable(f"{package} is not installed on the Roku")
        raise TVUnavailable(f"the Roku would not open {package}: {last}")

    async def start_intent(self, uri, package=None, cold=False, media_type=None):
        """Open a show. Netflix and YouTube links open the title through ECP's deep link (contentId and
        mediaType); any other app just opens. UNVERIFIED on a real Roku (docs/ROKU.md). media_type is
        "series" or "movie" when the caller knows (Netflix wants it)."""
        self.require()
        self.quiet_until = time.monotonic() + 20
        nid, yid = netflix_id(uri), youtube_id(uri)
        pkg = package or apps.BY_ID.get("netflix" if nid else "youtube" if yid else "", {}).get("package")
        app = apps.BY_PACKAGE.get(pkg or "")
        if app and app["id"] == "netflix" and nid:
            await self.refresh_installed()
            rid = (self._candidates(app["package"]) or ["12"])[0]
            await self._launch(rid, content_id=nid, media_type=media_type or "series")
            return "remote"
        if app and app["id"] == "youtube" and yid:
            await self.refresh_installed()
            rid = (self._candidates(app["package"]) or ["837"])[0]
            await self._launch(rid, content_id=yid, media_type="live")
            return "remote"
        if not pkg:
            raise ValueError("Roku only opens links for Netflix and YouTube")
        await self.launch_package(pkg)
        return "app"

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

    # ---------- what a Roku does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a Roku: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("Roku does not give screenshots over the network")

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
                await self._read_power()
                self.visible = await self._read_visible()
            except ECPLimited:
                pass
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake-on-LAN, for a Roku TV that is fully off. It only wakes this way if the TV allows it
        (Fast TV start on, or "Wake on LAN" in the TV's network settings)."""
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
