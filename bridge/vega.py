"""The connection to an Amazon Fire TV on Vega OS (Fire TV Stick 4K Select and newer), for "kind": "vega".

Written from Amazon's Vega documentation, and tested against a stand-in on the computer, NOT yet on a
real Vega stick (docs/FIRE-VEGA.md). Vega is not Android: there is no ADB, no APK and no way to replace
Amazon's home. What Amazon does document, and what this driver uses:

- The couch-tv app is a small Vega app (vega/ in this repo) that shows the bridge's home page in
  Amazon's WebView. The owner installs it once with Amazon's own free tools (Developer Mode).
- Opening it from the computer: `vega device launch-app` (Amazon's CLI, over the network after
  `vega exec vda connect <ip>:5555`), or DIAL, the standard "second screen" launch (SSDP on port 1900,
  then a POST), which needs no Amazon tools on the computer. Whether DIAL works for a sideloaded app is
  not documented by Amazon, so the CLI is tried first when it is there.
- Netflix and YouTube open through DIAL, the same way a phone's own Cast button does.
- Phone remote keys: Amazon documents no key injection on Vega. So the keys go to the home page itself:
  the page asks the bridge for them (/api/vega/keys, a long poll) and presses them on itself. They work
  while couch-tv is in front. Home, Back out of couch-tv, volume and power belong to the stick.

Same shape as tv.TV, roku.RokuTV and the other drivers, so the server, the phone remote and the Claude
ask work unchanged. Never reads or writes anything on the stick except through Amazon's own commands.
"""
import asyncio
import logging
import os
import re
import shutil
import socket
import time
from urllib.parse import quote, urlparse

import aiohttp

import apps
from samsung import netflix_id, youtube_id
from tv import TVUnavailable

HOME_PACKAGE = "app.couchtv.launcher"
# Amazon's Vega app ids look like "<package>.main". An inference from Amazon's templates, not a
# documented rule: "app_id" in config.json wins, and scripts/check-vega.py lists what is installed.
COUCH_APP = "com.couchtv.home.main"
DIAL_NAME = "CouchTV"
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}")
# The page asks for keys about every 20 seconds, so it counts as in front for a little longer than that.
PAGE_SEEN_FOR = 30.0

# Friendly key name -> the key the page presses on itself (KeyboardEvent.key).
KEYS = {
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "ok": "Enter", "select": "Enter", "enter": "Enter", "back": "Escape",
    "play_pause": "MediaPlayPause", "play": "MediaPlayPause", "pause": "MediaPlayPause",
    "rewind": "MediaRewind", "fast_forward": "MediaFastForward",
    "menu": "ContextMenu", "settings": "ContextMenu",
}
# What the stick keeps for itself: nothing on Vega lets a computer or an app press these.
NOT_POSSIBLE = {"volume_up", "volume_down", "mute", "input", "channel_up", "channel_down", "stop", "next",
                "previous", "info", "search"}

# Netflix and YouTube open through DIAL. The DIAL names are the registry's own; the payloads are the
# ones those apps document for DIAL, never checked on a Vega stick.
DIAL_APPS = {"netflix": "Netflix", "youtube": "YouTube"}


def resolve_key(name):
    if not isinstance(name, str) or not name.strip():
        return None
    return KEYS.get(name.strip().lower())


class VegaError(RuntimeError):
    """Amazon's tools or the stick answered with an error."""


class VegaTV:
    kind = "vega"
    can_read_media = False
    native_media = True
    INPUT = re.compile(r"^$a")   # no inputs to leave alone: a stick has none

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"vega.{self.id}")
        self.ip = cfg.get("ip")
        self.fallback_ip = self.ip
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.port = int(cfg.get("port") or 5555)                 # Vega's network developer port
        self.dial_port = int(cfg.get("dial_port") or 1900)       # DIAL discovery
        self.cli = cfg.get("cli") or "vega"                      # Amazon's Vega CLI, if installed here
        self.app_id = str(cfg.get("app_id") or COUCH_APP)
        self.dial_name = str(cfg.get("dial_name") or DIAL_NAME)
        self.dial_url = cfg.get("dial_url")                      # found by discovery when not given
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.paired = True
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False
        self.power = None            # True when the stick answers on the network
        self.last_cli = None         # what the last Amazon command said, for /api/tvs
        self.page_seen = 0.0         # when the home page in the app last asked for keys
        self._keys = []              # [(n, key)] waiting for the page
        self._n = 0
        self._wait = asyncio.Event()
        self._listeners = set()
        self._session = None
        self._tasks = []
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        return None if self.power is None else bool(self.power)

    @property
    def current_package(self):
        return HOME_PACKAGE if self.page_in_front() else None

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
        return app.get("id") in DIAL_APPS

    def page_in_front(self):
        return time.monotonic() - self.page_seen < PAGE_SEEN_FOR if self.page_seen else False

    def vega_status(self):
        """For /api/tvs: what a person setting this up wants to see, in plain words."""
        return {"cli": bool(shutil.which(self.cli)), "page_in_front": self.page_in_front(),
                "last_command": self.last_cli, "dial": bool(self.dial_url)}

    # ---------- Amazon's CLI ----------
    def _target(self):
        return f"{self.ip or self.fallback_ip}:{self.port}"

    async def _cli(self, *args, timeout=20):
        """Run one `vega ...` command. Arguments are passed as a list, never through a shell."""
        exe = shutil.which(self.cli)
        if not exe:
            raise TVUnavailable("Amazon's Vega CLI is not installed on this computer (docs/FIRE-VEGA.md)")
        try:
            p = await asyncio.create_subprocess_exec(exe, *args, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.STDOUT)
            out, _ = await asyncio.wait_for(p.communicate(), timeout)
        except asyncio.TimeoutError:
            p.kill()
            raise TVUnavailable("Amazon's Vega CLI did not answer in time") from None
        except OSError as e:
            raise TVUnavailable(f"could not run the Vega CLI ({type(e).__name__})") from None
        text = out.decode("utf-8", "replace").strip()
        self.last_cli = f"{' '.join(args[:3])}: {'ok' if p.returncode == 0 else 'failed'}"
        if p.returncode != 0:
            raise VegaError(f"vega {' '.join(args[:2])} failed: {text[-200:]}")
        return text

    async def _connect(self):
        """Amazon's step: `vega exec vda connect <ip>:5555` (it needs Developer Mode and network
        access switched on, once, over USB). Harmless to repeat."""
        await self._cli("exec", "vda", "connect", self._target())

    async def _cli_launch(self, app_id):
        if not ID_RE.fullmatch(str(app_id)):
            raise ValueError(f"not a Vega app id: {app_id}")
        await self._connect()
        await self._cli("device", "launch-app", "--appName", str(app_id), "-d", self._target(), timeout=30)

    async def installed(self, app_id=None):
        """Whether the couch-tv app is installed (None when the CLI is not here to ask)."""
        if not shutil.which(self.cli):
            return None
        await self._connect()
        out = await self._cli("device", "is-app-installed", "--appName", app_id or self.app_id,
                              "-d", self._target())
        low = out.lower()
        return "true" in low or ("installed" in low and "not" not in low)

    # ---------- DIAL ----------
    async def _http(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4))
        return self._session

    async def _discover(self):
        """DIAL discovery, sent straight to the stick (SSDP M-SEARCH on UDP 1900), then the device
        description, whose Application-URL header is the base of DIAL's REST service."""
        if self.dial_url:
            return self.dial_url
        ip = self.ip or self.fallback_ip
        msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n"
               "ST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n").encode()
        loop = asyncio.get_running_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setblocking(False)
        try:
            sock.sendto(msg, (ip, self.dial_port))
            data = await asyncio.wait_for(loop.sock_recv(sock, 4096), 3)
        except (asyncio.TimeoutError, OSError):
            raise TVUnavailable("the stick did not answer DIAL discovery") from None
        finally:
            sock.close()
        loc = re.search(rb"(?im)^location:\s*(\S+)", data)
        if not loc:
            raise TVUnavailable("the stick's DIAL answer had no LOCATION")
        s = await self._http()
        try:
            async with s.get(loc.group(1).decode()) as r:
                base = r.headers.get("Application-URL")
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"could not read the stick's DIAL description ({type(e).__name__})") from None
        if not base:
            raise TVUnavailable("the stick's DIAL description had no Application-URL")
        u = urlparse(base)
        # only ever talk to the stick itself
        if u.hostname != ip:
            raise TVUnavailable("the DIAL address did not match the stick, left alone")
        self.dial_url = base.rstrip("/")
        return self.dial_url

    async def _dial_launch(self, name, payload=""):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", name):
            raise ValueError(f"not a DIAL app name: {name}")
        base = await self._discover()
        s = await self._http()
        try:
            async with s.post(f"{base}/{name}", data=payload.encode(),
                              headers={"Content-Type": "text/plain; charset=utf-8"}) as r:
                if r.status == 404:
                    raise TVUnavailable(f"the stick does not know {name} over DIAL")
                if r.status >= 400:
                    raise VegaError(f"DIAL answered {r.status} for {name}")
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"DIAL did not answer ({type(e).__name__})") from None

    # ---------- keys, through the page ----------
    def push_key(self, key):
        self._n += 1
        self._keys = (self._keys + [(self._n, key)])[-50:]
        self._wait.set()

    async def next_keys(self, after=0, timeout=20.0):
        """The page's long poll. Everything newer than `after`, waiting up to `timeout` for a key."""
        self.page_seen = time.monotonic()
        end = time.monotonic() + timeout
        while True:
            new = [(n, k) for n, k in self._keys if n > after]
            if new or time.monotonic() >= end:
                self.page_seen = time.monotonic()
                return [{"n": n, "key": k} for n, k in new], self._n
            self._wait.clear()
            try:
                await asyncio.wait_for(self._wait.wait(), max(0.05, end - time.monotonic()))
            except asyncio.TimeoutError:
                pass

    async def key(self, name, hold=False):
        n = (name or "").strip().lower() if isinstance(name, str) else ""
        self.quiet_until = time.monotonic() + 20
        if n == "home":
            await self._launch_home()
            return "couch-tv"
        if n == "power":
            if self.is_on:
                raise TVUnavailable("a Vega stick cannot be switched off from the network: press the power key on its remote")
            self.home_on_wake_until = time.monotonic() + 90
            await self.wake()
            return "power"
        code = resolve_key(name)
        if not code:
            if n in NOT_POSSIBLE:
                raise TVUnavailable(f"{n} is the stick's own: nothing on a Vega stick lets the network press it")
            raise ValueError(f"unknown key: {name}")
        self.require()
        if not self.page_in_front():
            raise TVUnavailable("couch-tv is not in front on the stick, so there is nothing to press the key on: "
                                "open it first (Home on the phone remote)")
        self.push_key(code)
        return code

    async def text(self, text):
        raise TVUnavailable("typing from the phone is not built for Vega yet")

    # ---------- opening things ----------
    async def _launch_home(self):
        self.require()
        errs = []
        if shutil.which(self.cli):
            try:
                await self._cli_launch(self.app_id)
                return
            except (VegaError, TVUnavailable, ValueError) as e:
                errs.append(str(e))
        try:
            await self._dial_launch(self.dial_name)
            return
        except (VegaError, TVUnavailable) as e:
            errs.append(str(e))
        raise TVUnavailable("could not open couch-tv on the stick: " + "; ".join(errs))

    async def launch_package(self, package):
        self.require()
        self.quiet_until = time.monotonic() + 20
        if package in (HOME_PACKAGE, self.app_id):
            await self._launch_home()
            return "remote"
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        name = DIAL_APPS.get(app["id"]) if app else None
        if not name:
            raise TVUnavailable("on a Vega stick only couch-tv, Netflix and YouTube can be opened from the "
                                "computer: pick the other apps with the stick's own remote")
        await self._dial_launch(name)
        return "remote"

    async def start_intent(self, uri, package=None, cold=False, media_type=None):
        self.require()
        self.quiet_until = time.monotonic() + 20
        nid, yid = netflix_id(uri), youtube_id(uri)
        if yid:
            await self._dial_launch("YouTube", "v=" + quote(yid, safe=""))
            return "remote"
        if nid:
            await self._dial_launch("Netflix", "m=" + quote(f"https://www.netflix.com/watch/{nid}", safe=""))
            return "remote"
        if package:
            return await self.launch_package(package)
        raise ValueError("a Vega stick only opens Netflix and YouTube links")

    async def front_package(self):
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        packages = {p for p in packages if p}
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.current_package in packages:
                return self.current_package
            await asyncio.sleep(0.5)
        return None

    async def installed_packages(self):
        return None   # a Vega stick does not list its apps to the network

    # ---------- watcher and hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def port_open(self, port=None, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port or self.port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def _watch(self):
        was_on = None
        while True:
            try:
                before = (self.connected, self.power, self.page_in_front())
                up = await self.port_open()
                self.connected, self.power = up, up
                if up and was_on is False:
                    asyncio.create_task(self._hook())
                was_on = up
                if (self.connected, self.power, self.page_in_front()) != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            await asyncio.sleep(3)

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The stick just came up. Open couch-tv, unless a command from the phone just ran."""
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0
        elif time.monotonic() < self.quiet_until:
            self._note("stick came up, left alone (a command is running)")
            return
        if not self.open_on_power_on:
            return
        await asyncio.sleep(8)   # let Amazon's home finish drawing before ours goes in front
        if self.page_in_front():
            self._note("stick came up, couch-tv already open")
            return
        try:
            await self._launch_home()
            self._note("stick came up, opened couch-tv")
        except Exception as e:
            self._note(f"stick came up, could not open couch-tv: {e}")

    # ---------- what a Vega stick does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a Vega stick: ADB does not exist on Vega OS")

    async def screenshot(self):
        raise TVUnavailable("screenshots are not built for Vega")

    async def reconnect_now(self):
        self.connected = self.power = await self.port_open()
        self._changed()
        return self.connected

    async def wake(self):
        """Wake-on-LAN, for a stick that has left the network. Whether a Vega stick wakes this way is not
        documented (the DIAL answer may carry a WAKEUP header: it is not read here)."""
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
                    except OSError:
                        pass
        finally:
            s.close()
