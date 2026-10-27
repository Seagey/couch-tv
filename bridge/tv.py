"""The one connection to the living room TV.

Two channels:
- Android TV Remote protocol v2 (androidtvremote2, paired cert in bridge/data/): keys,
  text, power and volume state, the app in front, and https/scheme app links.
- ADB over Wi-Fi (pure Python, adb_shell, with this computer's adb key): open any app by package,
  open a JustWatch intent:// link exactly, screenshots, installed apps. Optional: everything
  still works without it, just less.
"""
import asyncio
import logging
import os
import re
import socket

from adb_shell.adb_device_async import AdbDeviceTcpAsync
from adb_shell.auth.sign_pythonrsa import PythonRSASigner
from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth

import apps
import config

log = logging.getLogger("tv")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT, KEY = os.path.join(config.DATA, "cert.pem"), os.path.join(config.DATA, "key.pem")
ADB_KEY = os.path.expanduser(os.environ.get("ADB_KEY", "~/.android/adbkey"))


def ensure_adb_key(path=None):
    """Make the ADB key pair the TV will ask you to trust, if there is not one yet."""
    path = path or ADB_KEY
    if not os.path.exists(path):
        from adb_shell.auth.keygen import keygen
        os.makedirs(os.path.dirname(path), exist_ok=True)
        keygen(path)
    return path

CLIENT_NAME = config.CLIENT_NAME
TV_BROADCAST = os.environ.get("TV_BROADCAST", "255.255.255.255")  # Wake-on-LAN; set to your subnet broadcast if it does not wake
# Which TVs exist (host, last IP, MAC for Wake-on-LAN, paired or not): config.json.
# The same cert (data/cert.pem, data/key.pem) is paired with each TV once (pair_tv.py).

KEYS = {
    "up": "DPAD_UP", "down": "DPAD_DOWN", "left": "DPAD_LEFT", "right": "DPAD_RIGHT",
    "ok": "DPAD_CENTER", "select": "DPAD_CENTER", "enter": "DPAD_CENTER",
    "back": "BACK", "home": "HOME",
    "play_pause": "MEDIA_PLAY_PAUSE", "play": "MEDIA_PLAY", "pause": "MEDIA_PAUSE",
    "stop": "MEDIA_STOP", "next": "MEDIA_NEXT", "previous": "MEDIA_PREVIOUS",
    "rewind": "MEDIA_REWIND", "fast_forward": "MEDIA_FAST_FORWARD",
    "volume_up": "VOLUME_UP", "volume_down": "VOLUME_DOWN", "mute": "VOLUME_MUTE",
    "power": "POWER", "settings": "SETTINGS", "menu": "MENU", "info": "INFO", "guide": "GUIDE",
    "input": "TV_INPUT", "search": "SEARCH", "captions": "CAPTIONS",
    "channel_up": "CHANNEL_UP", "channel_down": "CHANNEL_DOWN",
    **{str(n): str(n) for n in range(10)},
}


def resolve_key(name):
    """Friendly key name or raw Android key name -> androidtvremote2 key name. None if unknown."""
    if not isinstance(name, str) or not name:
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    raw = k.upper()
    if raw.startswith("KEYCODE_"):
        raw = raw[len("KEYCODE_"):]
    return raw if re.fullmatch(r"[A-Z0-9_]+", raw) and raw in set(KEYS.values()) | _RAW_OK else None


# Raw names accepted beyond the friendly set (the common Android TV ones).
_RAW_OK = {"DPAD_UP_LEFT", "DPAD_UP_RIGHT", "DPAD_DOWN_LEFT", "DPAD_DOWN_RIGHT", "ESCAPE",
           "MOVE_HOME", "MOVE_END", "PAGE_UP", "PAGE_DOWN", "DEL", "FORWARD_DEL", "SPACE", "TAB",
           "ENTER", "MEDIA_RECORD", "MEDIA_AUDIO_TRACK", "PROG_RED", "PROG_GREEN", "PROG_YELLOW",
           "PROG_BLUE", "SLEEP", "WAKEUP", "ASSIST", "BUTTON_A", "BUTTON_B", "BUTTON_X", "BUTTON_Y",
           "APP_SWITCH", "ALL_APPS", "BOOKMARK", "TV", "DVR", "LAST_CHANNEL", "MEDIA_SKIP_FORWARD",
           "MEDIA_SKIP_BACKWARD", "MEDIA_STEP_FORWARD", "MEDIA_STEP_BACKWARD"}


def intent_to_link(uri):
    """intent://host/path#Intent;scheme=x;...;end -> x://host/path (what the remote protocol takes)."""
    if not uri or not uri.startswith("intent://"):
        return uri
    body, _, extras = uri[len("intent://"):].partition("#Intent;")
    m = re.search(r"(?:^|;)scheme=([^;]+)", extras)
    return f"{m.group(1) if m else 'https'}://{body}"


def intent_package(uri):
    if not uri:
        return None
    m = re.search(r"(?:;|#Intent;)package=([^;]+)", uri)
    if m:
        return m.group(1)
    m = re.search(r"(?:;|#Intent;)component=([^/;]+)/", uri)
    return m.group(1) if m else None


class TV:
    kind = "android"
    can_read_media = True   # what is playing, from the media session (ADB)

    def can_deeplink(self, app):
        return True

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.log = logging.getLogger(f"tv.{self.id}")
        self.name = cfg["name"]
        # "host" (a name) is tried first, then "ip". An empty "host" counts as none: resolving ""
        # gives this computer's own address, not the TV's.
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.adb_port = config.adb_port(cfg)
        self.mac = cfg.get("mac")
        self.paired = bool(cfg.get("paired"))
        self.keep_disabled_file = cfg.get("keep_disabled")
        # Picture mode: which number in `settings get global picture_mode` is which mode, and
        # whether switching has been tested on this TV. Filled in config.json once found.
        self.picture_cfg = config.picture_cfg(cfg.get("picture"))
        # Wake-on-LAN is tried when a mac is set, unless "wake_on_lan": false.
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        # Per-TV state the server keeps (what is playing, sleep timer, picture mode, ...).
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.remote = None
        self.connected = False
        self.adb_ok = False
        self.ip = None
        self._listeners = set()
        self._lock = asyncio.Lock()
        self._adb_lock = asyncio.Lock()
        self._adb_cmd_lock = asyncio.Lock()
        self._dev = None
        self._signer = None
        self._task = None

    # ---------- state ----------
    @property
    def is_on(self):
        return self.remote.is_on if (self.remote and self.connected) else None

    @property
    def current_package(self):
        return self.remote.current_app if (self.remote and self.connected) else None

    @property
    def volume(self):
        v = (self.remote.volume_info if (self.remote and self.connected) else None) or {}
        mx = v.get("max") or 0
        return {"level": v.get("level") if mx else None, "max": mx or None,
                "muted": v.get("muted"), "known": bool(mx)}

    def on_change(self, fn):
        self._listeners.add(fn)

    def _changed(self, *_):
        for fn in list(self._listeners):
            try:
                fn()
            except Exception:  # a listener must never break the TV connection
                self.log.exception("listener failed")

    # ---------- connecting ----------
    async def _resolve(self):
        loop = asyncio.get_running_loop()
        if not self.host:
            self.ip = self.ip or self.fallback_ip
            return self.ip
        try:
            infos = await asyncio.wait_for(
                loop.getaddrinfo(self.host, 6466, family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    async def start(self):
        if not self.paired:
            self.log.info("not paired yet, not connecting (run pair_tv.py %s)", self.id)
            return
        self._task = asyncio.create_task(self._run())
        self._watch = asyncio.create_task(self._watch_ip())

    async def _watch_ip(self):
        """While the TV is unreachable: every 3 s, see if its remote port answers and reconnect
        straight away (the library's own retries back off to 30 s, so a TV switched on with its
        own remote would look "off" on the phone for up to half a minute). Every minute, also
        check whether it came back on a new IP (Wi-Fi reconnects can change it)."""
        ticks = 0
        while True:
            await asyncio.sleep(3)
            ticks += 1
            if self.connected or (self._task and not self._task.done()):
                continue
            if await self.port_open(timeout=1.0):
                self.log.info("TV answering again, reconnecting now")
                await self.reconnect_now()
                continue
            if ticks % 20 == 0:
                old = self.ip
                new = await self._resolve()
                if new and new != old:
                    self.log.warning("TV moved from %s to %s, reconnecting", old, new)
                    await self.reconnect_now()

    async def _connect_once(self, ip, timeout=10):
        """One connect attempt to a known address. Raises on failure."""
        remote = AndroidTVRemote(CLIENT_NAME, CERT, KEY, ip)
        remote.add_is_on_updated_callback(self._changed)
        remote.add_is_on_updated_callback(lambda on: self.log.info("TV reports %s", "on" if on else "standby"))
        remote.add_current_app_updated_callback(self._changed)
        remote.add_volume_info_updated_callback(self._changed)
        remote.add_is_available_updated_callback(self._on_available)
        try:
            await asyncio.wait_for(remote.async_connect(), timeout)
        except asyncio.TimeoutError:
            remote.disconnect()
            raise CannotConnect(f"timed out connecting to {ip}")
        self.remote = remote
        self.connected = True
        self.log.info("remote connected to %s", ip)
        remote.keep_reconnecting()
        self._changed()

    async def _run(self):
        delay = 5
        while True:
            try:
                ip = await self._resolve()
                await self._connect_once(ip)
                await self.adb_connect()
                return
            except InvalidAuth:
                self.log.error("TV says the pairing is no longer valid. Re-run pair.py.")
                self.connected = False
                await asyncio.sleep(60)
            except (CannotConnect, ConnectionClosed, OSError) as e:
                if delay == 5:
                    self.log.warning("TV not reachable (%s), watching for it", e)
                self.connected = False
                self._changed()
                # Check the remote port every 3 s so a TV switched on with its own remote is
                # picked up within seconds, but only try a full connect when it answers.
                waited = 0
                while waited < delay and not await self.port_open(timeout=1.0):
                    await asyncio.sleep(3)
                    waited += 4
                delay = min(delay * 2, 60)

    def _on_available(self, available):
        self.connected = bool(available)
        if not available:
            self.adb_ok = False
        self.log.info("remote %s", "back" if available else "lost")
        self._changed()
        if available:
            asyncio.create_task(self.adb_connect())

    def require(self):
        if not self.paired:
            raise TVUnavailable(f"the {self.name.lower()} TV is not paired yet")
        if not (self.remote and self.connected):
            raise TVUnavailable("TV not connected")

    # ---------- remote protocol ----------
    async def key(self, name, hold=False):
        self.require()
        code = resolve_key(name)
        if not code:
            raise ValueError(f"unknown key: {name}")
        if hold:
            self.remote.send_key_command(code, "START_LONG")
            await asyncio.sleep(0.8)
            self.remote.send_key_command(code, "END_LONG")
        else:
            self.remote.send_key_command(code)
        return code

    async def text(self, text):
        self.require()
        self.remote.send_text(text)

    async def open_link(self, link):
        """Open an https or app-scheme link through the remote protocol."""
        self.require()
        self.remote.send_launch_app_command(link)

    async def front_package(self):
        """The app really on screen, from ADB (the remote protocol's report lags by seconds)."""
        if await self.adb_ready():
            try:
                out = await self.adb("shell", "dumpsys", "activity", "activities", timeout=8)
                m = re.search(r"topResumedActivity=ActivityRecord\{\S+ u0 ([^/\s]+)/", out)
                if m:
                    return m.group(1)
            except Exception:
                pass
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        """Wait until one of these packages is in front. Returns the package or None."""
        packages = {p for p in packages if p}
        end = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < end:
            front = await self.front_package()
            if front in packages:
                return front
            await asyncio.sleep(0.5)
        return None

    # ---------- ADB ----------
    async def adb(self, *args, timeout=15, binary=False):
        """Run an adb command on the TV. If the link dropped, reconnect once and retry."""
        try:
            return await self._adb(*args, timeout=timeout, binary=binary)
        except RuntimeError:
            if self.adb_ok or not await self.adb_connect():
                raise
            return await self._adb(*args, timeout=timeout, binary=binary)

    async def _adb(self, *args, timeout=15, binary=False):
        """Mirror of the adb CLI forms we use ("shell ...", "exec-out ...", "get-state"), sent
        over the bridge's own ADB connection."""
        if args and args[0] == "get-state":
            return "device" if (self._dev and self._dev.available) else "offline"
        if not (self._dev and self._dev.available):
            self.adb_ok = False
            raise RuntimeError("adb not connected")
        kind, cmd = args[0], " ".join(args[1:])
        async with self._adb_cmd_lock:
            try:
                if kind == "exec-out":
                    coro = self._dev.exec_out(cmd, decode=not binary)
                else:
                    coro = self._dev.shell(cmd, read_timeout_s=timeout, decode=not binary)
                return await asyncio.wait_for(coro, timeout + 5)
            except Exception as e:
                # Any transport error: drop the connection, the next call reconnects.
                self.adb_ok = False
                await self._adb_close()
                self._changed()
                raise RuntimeError(f"adb: {type(e).__name__} {e}"[:200])

    async def _adb_close(self):
        if self._dev:
            try:
                await self._dev.close()
            except Exception:
                pass
        self._dev = None

    async def adb_connect(self):
        # One connect at a time.
        async with self._adb_lock:
            if self.adb_ok and self._dev and self._dev.available:
                return True
            return await self._adb_connect()

    async def _adb_connect(self):
        """Connect with this computer's adb key (the one the TV said "Always
        allow" to). Pure Python, inside the bridge process: the launchd python has macOS Local
        Network permission, the separate `adb` program does not ("No route to host")."""
        try:
            if not self.ip:
                await self._resolve()
            if self._signer is None:
                ensure_adb_key()
                with open(ADB_KEY) as f:
                    priv = f.read()
                with open(ADB_KEY + ".pub") as f:
                    pub = f.read()
                self._signer = PythonRSASigner(pub, priv)
            await self._adb_close()
            dev = AdbDeviceTcpAsync(self.ip, self.adb_port, default_transport_timeout_s=9)
            ok = await asyncio.wait_for(dev.connect(rsa_keys=[self._signer], auth_timeout_s=10), 25)
            self._dev = dev if ok else None
            self.adb_ok = bool(ok)
        except Exception as e:
            self.log.info("adb not available: %s %s", type(e).__name__, e)
            await self._adb_close()
            self.adb_ok = False
        self._changed()
        return self.adb_ok

    async def adb_ready(self):
        if self.adb_ok:
            return True
        return await self.adb_connect()

    async def launch_package(self, package):
        """Open an app by package. ADB first (always works), then the remote protocol."""
        if await self.adb_ready():
            await self.adb("shell", "monkey", "-p", package, "-c",
                           "android.intent.category.LEANBACK_LAUNCHER", "1")
            return "adb"
        self.require()
        self.remote.send_launch_app_command(package)  # market://launch?id=... (unreliable on this TV)
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """Open a JustWatch intent:// link exactly (with ADB), else its plain-link form.
        cold=True restarts the app first (some apps ignore links when already open)."""
        uri = uri.replace("'", "")
        # JustWatch sometimes names an inner screen that newer app versions no longer have
        # (SBS); naming just the app lets Android pick the screen that takes the link.
        uri = re.sub(r"component=([^/;]+)/[^;]+", r"package=\1", uri)
        start = ["shell", "am", "start", "-W"] + (["-S"] if cold else [])
        if uri.startswith("intent:") and await self.adb_ready():
            out = await self.adb(*start, f"'{uri}'", timeout=25)
            if "Error" in out:
                raise RuntimeError(out.strip().splitlines()[-1][:160])
            return "adb"
        if uri.startswith("http") or ("://" in uri and not uri.startswith("intent:")):
            if await self.adb_ready():
                args = start + ["-a", "android.intent.action.VIEW", "-d", f"'{uri}'"]
                if package:
                    args += ["-p", package]
                await self.adb(*args, timeout=25)
                return "adb"
        await self.open_link(intent_to_link(uri))
        return "remote"

    async def port_open(self, port=6466, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def reconnect_now(self):
        """Drop the library's own reconnect loop (it backs off to 30 s between tries) and connect
        straight away to the address we already know (no name lookup). Used when we know the TV
        just came back. Returns True when connected."""
        if self._task and not self._task.done():
            self._task.cancel()
        try:
            if self.remote:
                self.remote.disconnect()
        except Exception:
            pass
        self.connected = False
        try:
            await self._connect_once(self.ip or self.fallback_ip, timeout=8)
        except Exception as e:
            self.log.info("reconnect_now failed: %s", e)
            return False
        asyncio.ensure_future(self.adb_connect())
        return True

    async def wake(self):
        """Wake-on-LAN. When the TV is off it leaves the network, so a magic packet is the only
        way to reach it. Works only if the TV keeps its network card awake in standby."""
        if not self.mac or not self.wake_on_lan:
            return
        mac = bytes.fromhex(self.mac.replace(":", ""))
        packet = b"\xff" * 6 + mac * 16
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            for addr in ("255.255.255.255", TV_BROADCAST):
                for port in (9, 7):
                    try:
                        s.sendto(packet, (addr, port))
                    except OSError as e:
                        self.log.warning("wake packet to %s failed: %s", addr, e)
        finally:
            s.close()

    async def screenshot(self):
        if not await self.adb_ready():
            raise TVUnavailable("ADB is not on")
        raw = await self.adb("exec-out", "screencap", "-p", binary=True, timeout=20)
        # This TV's screencap prints a debug line ("Init wrapper sys mutex...") before the PNG.
        start = raw.find(b"\x89PNG")
        if start < 0:
            raise TVUnavailable("no screenshot (some apps, like Netflix, block them)")
        return raw[start:]

    async def installed_packages(self):
        if not await self.adb_ready():
            return None
        out = await self.adb("shell", "pm", "list", "packages")
        return {line.split(":", 1)[1].strip() for line in out.splitlines() if ":" in line}


class TVUnavailable(Exception):
    pass
