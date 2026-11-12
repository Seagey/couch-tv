"""The connection to a TiVo OS TV built by Vestel (JVC, Telefunken, Medion and others), for "kind": "tivo"
in config.json.

BETA. Run on one real TV so far: a JVC LT-50VUQ3455 (TiVo OS, software V.2.85.2.0, Vestel chassis MB180,
browser Vewd Core 4.23 on Chrome 108). Confirmed there: finding the TV, the key format, volume up and
down, the browser key, and the four keys that get couch-tv's page on screen. The lines marked UNCONFIRMED
come from public descriptions of older Vestel sets and have not run on TiVo OS. Turn on "trace" (below)
so another model's log can settle them, and run scripts/tivo-check.py first: it only reads.

How a TiVo OS TV is reached: Vestel's Smart Center, plain HTTP on port 56789. It is a DIAL server with one
extra app, SmartCenter, that takes the remote's keys. The TV must have Devices, Virtual Remote switched
on (it is on out of the box).

  GET  :56790/dd.xml               the device description (maker, chassis), with the DIAL address in its headers
  GET  :56789/apps/SmartCenter     DIAL state: "running" while the TV is on
  POST :56789/apps/SmartCenter     a key: <remote><key code=1016/></remote>
                                   a character: <keyboard><key value='46'/></keyboard>
  GET  :56789/apps/<name>          DIAL: does the TV know this app (Netflix, AmazonInstantVideo)
  POST :56789/apps/<name>          DIAL: open it (UNCONFIRMED on TiVo OS)

The TV answers HTTP 200 to every key, also to one it ignores. A bare <key code=.../> without <remote>
around it is such a key: accepted, nothing happens. So the bridge never knows whether a key arrived.

couch-tv's page: TiVo OS takes no outside apps and has no app store, but it ships a browser (Vewd Browser).
The browser has no start page setting and its address field drops digits, so the page cannot be typed in
from here. The owner adds it once as the first Speed Dial tile (docs/TIVO.md). To open it the bridge
presses the browser key, waits for the browser, then presses "browser_path": yellow (shows the bar),
right, OK (Speed Dial), OK (the first tile). With the browser's "Always show menu bar" off the page fills
the screen. It is a page that opens itself, not a true home screen: the remote's Home button still opens
TiVo's home.

The hook: a watcher knocks on port 56789 every 2 seconds. When the TV comes on it waits a few seconds and
opens couch-tv. TiVo OS does not say what is on screen, so the hook opens on power on only, and stays
quiet for 20 seconds after anything the phone asked for. The TV counts as off only after 30 seconds
without any answer: it goes silent for a while each time it starts an app.

What it cannot do (docs/TIVO.md): read which app is in front or what is playing, a volume level, typing
digits into the browser's address field, screenshots, deep links into a show, ADB tools. The colour keys
belong to the browser (yellow shows its bar, others change the zoom), so couch-tv's page cannot use them.
"""
import asyncio
import logging
import os
import re
import socket
import time

import aiohttp

import apps
import config
from tv import TVUnavailable

HOME_PACKAGE = "app.couchtv.launcher"
COUCH_APP = "couch-tv"   # what the hook opens: the Speed Dial tile in the TV's browser, not an id on the TV
PORT = 56789
DESCRIPTION_PORT = 56790
WATCH_EVERY = 2.0        # seconds between knocks on the TV's port
SETTLE = 8.0             # seconds the hook lets the TV settle after it comes on

# Everything about the wire that one real TV confirmed or that is still a guess, in one place, so a trace
# from another model corrects it here and the tests can shorten the waits.
PROTOCOL = {
    "smart_center": "SmartCenter",
    "key": "<remote><key code={code}/></remote>",
    "char": "<?xml version='1.0' ?><keyboard><key value='{value}'/></keyboard>",
    "content_type": "text/plain; charset=ISO-8859-1",
    "description": "dd.xml",
    "browser_wait": 9.0,     # seconds from the browser key until its first page (Google) is up
    "key_gap": 2.5,          # seconds between the keys of browser_path: Speed Dial needs time to draw
    "browser_path": ("yellow", "right", "ok", "ok"),
    "text_gap": 0.3,
    "off_after": 30.0,       # seconds without any answer before the TV counts as switched off
}

# Friendly key name -> Smart Center code. The first group ran on the real TV. The rest is from the public
# key lists for older Vestel sets: UNCONFIRMED on TiVo OS.
KEYS = {
    "volume_up": 1016, "volume_down": 1017, "right": 1022, "ok": 1053, "select": 1053, "enter": 1053,
    "yellow": 1050, "browser": 1065,
    # UNCONFIRMED from here
    "up": 1020, "down": 1019, "left": 1021, "back": 1010, "exit": 1037,
    "power": 1012, "mute": 1013, "info": 1018, "input": 1056, "menu": 1048, "settings": 1048,
    "tivo_home": 1046, "guide": 1047,
    "play": 1025, "play_pause": 1025, "pause": 1049, "stop": 1024, "fast_forward": 1028, "rewind": 1027,
    "next": 1028, "previous": 1027, "channel_up": 1032, "channel_down": 1033,
    "red": 1055, "green": 1054, "blue": 1052,
    **{str(n): 1000 + n for n in range(10)},
}
RAW_KEY = re.compile(r"^10\d\d$")                 # a Smart Center code given as it is, 1000 to 1099
DIAL_NAME = re.compile(r"^[A-Za-z0-9._-]{1,40}$")   # an app name, before it goes into an address
# Catalogue id -> the name the TV's DIAL server knows it by. Netflix and AmazonInstantVideo answered on the
# real TV. YouTube answered 403 there, so it is asked for but only listed if the TV says yes.
DIAL_NAMES = {"netflix": "Netflix", "prime-video": "AmazonInstantVideo", "youtube": "YouTube"}
TEXT_MAX = 200
TYPED = "(a character, hidden)"   # what the trace shows instead of typed text: it may be a password


def resolve_key(name):
    """Friendly name, or a Smart Center code such as 1043 -> the code sent. "home" is handled before this."""
    if isinstance(name, int) and not isinstance(name, bool):
        name = str(name)
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip().lower()
    if k in KEYS:
        return KEYS[k]
    return int(k) if RAW_KEY.match(k) else None


def field(xml, tag):
    """The text of the first <tag> in the TV's XML, or None."""
    m = re.search(rf"<{tag}(?:\s[^>]*)?>([^<]*)</{tag}>", xml or "")
    return m.group(1).strip() if m else None


class TivoError(RuntimeError):
    """The TV did not do what was asked, or answered with something unusable."""


class Wire:
    """Plain HTTP to the TV. A new connection for every request: Vestel's web server stalls on a reused
    one, and refuses a knock right after it served a page on the same port."""

    def __init__(self, log, trace=False, on_answer=None):
        self.log = log
        self.trace = trace
        self.on_answer = on_answer   # called for every answer, whatever it says: the TV is there
        self._session = None

    async def _http(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5),
                                                  connector=aiohttp.TCPConnector(force_close=True))
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    async def request(self, method, url, body=None, shown=None):
        """(status, headers, text). `shown` replaces the body in the trace, for typed characters."""
        if self.trace:
            self.log.info("trace out %s %s %s", method, url, shown if shown is not None else (body or ""))
        headers = {"Content-Type": PROTOCOL["content_type"]} if body is not None else {}
        try:
            session = await self._http()
            async with session.request(method, url, data=body.encode("latin-1") if body is not None else None,
                                       headers=headers, allow_redirects=False) as reply:
                text = await reply.text(errors="replace")
                if self.on_answer:
                    self.on_answer()
                if self.trace:
                    self.log.info("trace in %s %s", reply.status, text[:400])
                return reply.status, reply.headers, text
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"the TV did not answer ({type(e).__name__})") from None


class SmartCenter:
    """The remote's keys, and typed characters. The TV says 200 to all of it, so nothing here can tell
    whether a key did anything."""

    def __init__(self, wire, base_of):
        self.wire = wire
        self.base_of = base_of

    async def state(self):
        status, _, text = await self.wire.request("GET", self.base_of() + PROTOCOL["smart_center"])
        return field(text, "state") if status == 200 else None

    async def press(self, code, typed=False):
        """`typed`: the key is part of something the owner typed (a number key), so it stays out of the trace."""
        await self._send(PROTOCOL["key"].format(code=int(code)), shown=TYPED if typed else None)

    async def type_char(self, value):
        await self._send(PROTOCOL["char"].format(value=int(value)), shown=TYPED)

    async def _send(self, body, shown=None):
        status, _, _ = await self.wire.request("POST", self.base_of() + PROTOCOL["smart_center"], body, shown)
        if status == 403:
            raise TivoError("the TV refused the key: switch on Devices, Virtual Remote in the TV's settings")
        if status not in (200, 201):
            raise TivoError(f"the TV answered {status} to a key")


class Dial:
    """The apps the TV opens when asked by name. Only names from DIAL_NAMES or "dial_apps" in config.json
    are ever put into an address."""

    def __init__(self, wire, base_of):
        self.wire = wire
        self.base_of = base_of

    async def state(self, name):
        """"running", "stopped", or None when the TV does not know the app (or will not say)."""
        status, _, text = await self.wire.request("GET", self.base_of() + name)
        return field(text, "state") if status == 200 else None

    async def launch(self, name):
        status, _, _ = await self.wire.request("POST", self.base_of() + name, "")
        if status == 404:
            raise TivoError(f"the TV does not know {name}")
        if status not in (200, 201):
            raise TivoError(f"the TV answered {status} when asked to open {name}")


class TivoTV:
    kind = "tivo"
    can_read_media = False
    INPUT = re.compile(r"^$")   # TiVo OS never says which input is on screen

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"tivo.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.port = int(cfg.get("port") or PORT)
        self.description_port = int(cfg.get("description_port") or DESCRIPTION_PORT)
        self.trace = cfg.get("trace", False) is True
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.leave_inputs = False
        self.settle = float(cfg.get("settle", SETTLE))
        self.home_url_cfg = (cfg.get("home_url") or "").strip() or None
        self.browser_path = self._path_from(cfg.get("browser_path"))
        self.browser_wait = self._seconds(cfg.get("browser_wait"), PROTOCOL["browser_wait"])
        self.key_gap = self._seconds(cfg.get("key_gap"), PROTOCOL["key_gap"])
        self.dial_names = dict(DIAL_NAMES)
        for app_id, dial_name in (cfg.get("dial_apps") or {}).items() if isinstance(cfg.get("dial_apps"), dict) else ():
            if app_id in apps.BY_ID and isinstance(dial_name, str) and DIAL_NAME.match(dial_name):
                self.dial_names[app_id] = dial_name
        self.app_id = COUCH_APP
        self.paired = True          # Smart Center asks for no pairing
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # port 56789 answered in the last PROTOCOL["off_after"] seconds
        self._checked = False       # the watcher has knocked at least once
        self._last_answer = 0.0     # when the TV last answered anything (monotonic), 0.0 for never
        self.visible = None         # never known on TiVo OS
        self.model = None
        self.smart_center_state = None
        self.applist = []           # [{"dial", "name", "package"}]
        self._apps_checked = 0.0
        self._front = (None, 0.0)   # (package, when) the last app the bridge opened
        self._opening = asyncio.Lock()   # one run of browser_path at a time
        self._listeners = set()
        self._tasks = []
        self.last_error = None
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []
        self.wire = Wire(self.log, self.trace, self._answered)
        self.smart_center = SmartCenter(self.wire, self._apps_base)
        self.dial = Dial(self.wire, self._apps_base)

    @staticmethod
    def _seconds(value, default):
        try:
            return max(0.0, min(60.0, float(value)))
        except (TypeError, ValueError):
            return float(default)

    @staticmethod
    def _path_from(value):
        """The keys that lead from the browser's first page to couch-tv's tile. A list from config.json is
        used only if every entry is a key this file knows."""
        if isinstance(value, list) and value and all(resolve_key(k) is not None for k in value) and len(value) <= 12:
            return tuple(str(k).strip().lower() for k in value)
        return tuple(PROTOCOL["browser_path"])

    def _apps_base(self):
        return f"http://{self.ip or self.fallback_ip}:{self.port}/apps/"

    def _answered(self):
        self._last_answer = time.monotonic()

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        """The TV answering on port 56789 counts as on. UNCONFIRMED: a set in networked standby may answer too."""
        return self.connected if self._checked else None

    @property
    def current_package(self):
        """TiVo OS does not say which app is in front. The app the bridge last opened counts while the TV
        stays on, for up to four hours."""
        if not self.connected:
            return None
        pkg, at = self._front
        return pkg if pkg and time.monotonic() - at < 4 * 3600 else None

    @property
    def volume(self):
        return {"level": None, "max": None, "muted": None, "known": False}   # keys only, no level to read

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
        return False   # no deep link into a show is known on TiVo OS: apps open on their own page

    def tivo_status(self):
        """For /api/tvs: the parts a tester needs to see at a glance. "home_url" is the address the owner
        gives the Speed Dial tile."""
        return {"port": self.connected, "model": self.model, "smart_center": self.smart_center_state,
                "apps": len(self.applist), "home_url": self.home_url(), "error": self.last_error}

    async def close(self):
        await self.wire.close()

    # ---------- reading the TV ----------
    async def detect(self):
        """Who the TV says it is, and whether Smart Center is up. A read: nothing shows on the TV."""
        try:
            status, _, text = await self.wire.request(
                "GET", f"http://{self.ip or self.fallback_ip}:{self.description_port}/{PROTOCOL['description']}")
            if status == 200:
                parts = [field(text, t) for t in ("manufacturer", "modelName", "friendlyName")]
                self.model = " ".join(p for p in parts if p) or None
        except TVUnavailable:
            pass   # the description is only for show; Smart Center below is what matters
        self.smart_center_state = await self.smart_center.state()
        self.last_error = None if self.smart_center_state else "Smart Center did not answer"
        return self.smart_center_state

    async def refresh_installed(self, force=False):
        """Which catalogue apps the TV's DIAL server knows, every 30 minutes."""
        if not force and time.time() - self._apps_checked < 1800 and self.applist:
            return self.applist
        listed = []
        for app_id, dial_name in self.dial_names.items():
            try:
                known = await self.dial.state(dial_name)
            except TVUnavailable as e:
                self.log.info("app list: %s", e)
                return self.applist
            if known:
                listed.append({"dial": dial_name, "name": apps.BY_ID[app_id]["name"],
                               "package": apps.BY_ID[app_id]["package"]})
        self.applist, self._apps_checked = listed, time.time()
        return self.applist

    async def apps_on_tv(self):
        await self.refresh_installed()
        return list(self.applist)

    def _entry(self, package):
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        pkg = app["package"] if app else package
        return next((a for a in self.applist if a["package"] == pkg), None)

    # ---------- couch-tv's page ----------
    def home_url(self):
        """The address for the Speed Dial tile: "home_url" in config.json, else the bridge's /titan/ page on
        this computer's address towards the TV (it asks for the pairing key once, with the remote, then
        opens the home; the key is never in the address)."""
        base = self.home_url_cfg
        if not base:
            port = int(os.environ.get("PORT") or config.BRIDGE.get("port") or 5400)
            base = f"http://{self._my_address()}:{port}/titan/"
        if self.id != config.DEFAULT_TV and re.fullmatch(r"[a-z-]{1,40}", self.id):
            base += ("&" if "?" in base else "?") + "tv=" + self.id
        return base

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

    async def open_home(self):
        """Open couch-tv: the browser key, a wait, then browser_path into the Speed Dial tile. Blind: the
        TV gives no sign of where it is, so a slow browser makes the keys land somewhere else. The browser
        key from inside the browser goes to TiVo's home and back in, so every run starts from the same
        place."""
        self.require()
        if self._opening.locked():
            return   # a run is already on its way: a second one would press into the middle of it
        async with self._opening:
            await self.smart_center.press(KEYS["browser"])
            await asyncio.sleep(self.browser_wait)
            for name in self.browser_path:
                await self.smart_center.press(resolve_key(name))
                await asyncio.sleep(self.key_gap)
            self._front = (HOME_PACKAGE, time.monotonic())

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
                before = self.connected
                await self._read_power()
                if not self.connected:
                    self._front = (None, 0.0)
                    if ticks % 30 == 0:
                        await self._resolve()
                elif before is not True:
                    try:
                        await self.detect()
                    except (TivoError, TVUnavailable) as e:
                        self.log.info("%s", e)
                if self.connected and ticks % 15 == 0:
                    await self.refresh_installed()
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                was_on = on
                if self.connected != before:
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
        """The TV just came on: after a short settle, open couch-tv in the browser. TiVo OS cannot say what
        is on screen, so a command from the phone in the last 20 seconds is the only thing that wins."""
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0   # switched on from the phone: couch-tv, even inside the quiet time
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        if not self.open_on_power_on:
            return
        quiet = self.quiet_until
        await asyncio.sleep(self.settle)
        if not self.connected:
            self._note("TV came on and went off again, left alone")
            return
        if self.quiet_until != quiet and time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (the phone asked for something meanwhile)")
            return
        try:
            await self.open_home()
            self._note("TV came on, pressed the keys that open couch-tv in the browser")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- the remote ----------
    async def key(self, name, hold=False):
        code = resolve_key(name)
        power = code == KEYS["power"]
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our page; TiVo's own home is "tivo_home".
            await self.open_home()
            return "couch-tv"
        if code is None:
            raise ValueError(f"unknown key: {name}")
        if power and not self.connected:
            await self.wake()   # fully off, or deep standby: the port is gone with it
            return str(code)
        self.require()
        if power and not self.is_on:
            self.home_on_wake_until = time.monotonic() + 90
        await self.smart_center.press(code)   # a hold is a press
        return str(code)

    async def text(self, text):
        """Type into the field that has the focus. Letters and signs go as characters. Digits go as the
        remote's number keys, because the TV drops a digit sent as a character. The browser's own address
        field takes neither kind of digit, a field on a web page takes the number keys. Letters are
        UNCONFIRMED on TiVo OS, signs ran on the real TV."""
        if not isinstance(text, str) or not text or len(text) > TEXT_MAX:
            raise ValueError(f"text is 1 to {TEXT_MAX} characters")
        if any(ord(c) < 32 or ord(c) > 0xFFFF for c in text):
            raise ValueError("only printable characters can be typed")
        self.require()
        self.quiet_until = time.monotonic() + 20
        for c in text:
            if c in "0123456789":
                await self.smart_center.press(KEYS[c], typed=True)
            else:
                await self.smart_center.type_char(ord(c))
            await asyncio.sleep(PROTOCOL["text_gap"])

    async def launch_package(self, package):
        """Open an app the TV's DIAL server knows, or couch-tv's page."""
        self.require()
        if package in (HOME_PACKAGE, self.app_id):
            self.quiet_until = time.monotonic() + 20
            await self.open_home()
            return "remote"
        await self.refresh_installed()
        entry = self._entry(package)
        if not entry:
            raise TVUnavailable(f"{package} is not an app this TV opens when asked")
        self.quiet_until = time.monotonic() + 20
        await self.dial.launch(entry["dial"])
        self._front = (entry["package"], time.monotonic())
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """No deep link into a show is known on TiVo OS: the app opens on its own page."""
        self.require()
        if not package:
            raise ValueError("TiVo OS TVs only open apps, not links: name the app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        """The TV cannot say what is in front: the app the bridge just opened counts."""
        pkg, at = self._front
        return pkg if pkg in {p for p in packages if p} and time.monotonic() - at < 30 else None

    async def installed_packages(self):
        if not self.connected:
            return None
        await self.refresh_installed()
        return {a["package"] for a in self.applist} or None

    # ---------- what TiVo OS does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a TiVo OS TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("TiVo OS TVs do not give screenshots over the network")

    # ---------- power ----------
    async def _read_power(self):
        """On or off. A missed knock is not "off": the real TV stops answering for many seconds while it
        starts Netflix, and its web server takes one request at a time, so a key that hangs there makes the
        next knock fail as well. Read as "off, then on", that sent the power on hook into the middle of
        Netflix. Off is PROTOCOL["off_after"] seconds without any answer."""
        if await self.port_open():
            self._answered()
        self.connected = bool(self._last_answer) and time.monotonic() - self._last_answer < PROTOCOL["off_after"]
        self._checked = True

    async def port_open(self, port=None, timeout=1.5):
        """Two knocks: the real TV refused the first one right after it had served a page on the same port."""
        for _ in range(2):
            try:
                _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port or self.port), timeout)
                w.close()
                return True
            except Exception:
                await asyncio.sleep(0.3)
        return False

    async def reconnect_now(self):
        await self._read_power()
        if self.connected:
            try:
                await self.detect()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake on LAN, for a TV whose port is gone. UNCONFIRMED on TiVo OS: the real TV has not been woken
        this way yet."""
        self.quiet_until = 0.0
        self.home_on_wake_until = time.monotonic() + 90
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
