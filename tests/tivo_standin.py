"""A stand-in TiVo OS TV for the tests: a small web server that answers Smart Center and DIAL the way a real
JVC LT-50VUQ3455 did (scripts/tivo-check.py, docs/TIVO.md), and keeps a log of everything it was sent.

    async with StandIn() as t:
        tv = t.tv()                    # a bridge/tivo.py TivoTV pointed at it
        t.virtual_remote = False       # Devices, Virtual Remote switched off: keys are refused

What it copies from the real TV:
  - every key is answered 200, also one the TV ignores (a bare <key code=.../> with no <remote> around it)
  - a digit sent as a character is dropped, signs and backspace arrive
  - YouTube answers 403 to a DIAL question, Netflix and AmazonInstantVideo answer "stopped"
  - the browser key opens the browser on its first page; yellow, right, OK, OK lead to the first Speed
    Dial tile, and the browser key from inside the browser starts over

What is NOT from a real TV: opening an app over DIAL (201 here), and letters as characters. Those are
UNCONFIRMED in bridge/tivo.py too, so these tests prove the driver is consistent with itself and careful
with what it sends, not that a real TV answers the same way.
"""
import re
import sys
import time
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tivo  # noqa: E402

DIAL = ('<?xml version="1.0" encoding="UTF-8"?>\n<service xmlns="urn:dial-multiscreen-org:schemas:dial" '
        'dialVer="2.2">\n  <name>{name}</name>\n  <options allowStop="{stop}"/>\n  <state>{state}</state>\n'
        '  <link rel="run" href="run"/>\n</service>\n')
# The browser as the remote sees it: (screen, key code) -> the screen that key leads to.
BROWSER = {("first page", 1050): "bar", ("bar", 1022): "bar, speed dial", ("bar, speed dial", 1053): "speed dial",
           ("speed dial", 1053): "couch-tv"}


class StandIn:
    def __init__(self):
        self.virtual_remote = True
        self.apps = {"Netflix": "stopped", "AmazonInstantVideo": "stopped"}
        self.forbidden = {"YouTube"}      # names the TV answers 403 for
        self.keys = []                    # codes that arrived inside <remote>
        self.ignored = []                 # codes sent bare: answered 200, nothing happens
        self.typed = ""                   # what the focused field holds
        self.dropped = []                 # characters the TV threw away (digits)
        self.bodies = []                  # every POST body to Smart Center, as it came
        self.requests = []                # (method, path) of every request
        self.screen = "home"
        self._runner = None
        self.port = None

    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        await self._runner.cleanup()

    def tv(self, **cfg):
        t = tivo.TivoTV({"id": "lounge", "name": "Lounge", "kind": "tivo", "ip": "127.0.0.1",
                         "port": self.port, "description_port": self.port, "mac": "", **cfg})
        t.ip = "127.0.0.1"
        t.connected = True
        t._checked = True
        t._last_answer = time.monotonic()
        return t

    # ---------- the web server ----------
    async def _handle(self, request):
        path = request.match_info["path"]
        self.requests.append((request.method, path))
        if request.method == "GET" and path == "dd.xml":
            return web.Response(content_type="text/xml", headers={
                "Application-URL": f"http://127.0.0.1:{self.port}/apps/"}, text=(
                '<?xml version="1.0"?><root><device><friendlyName>JVC_</friendlyName>'
                '<manufacturer>VESTEL</manufacturer><modelName>MB180</modelName></device></root>'))
        if not path.startswith("apps/"):
            return web.Response(status=404)
        name = path[5:]
        if name == "SmartCenter":
            if request.method == "GET":
                return web.Response(content_type="text/xml", text=DIAL.format(name=name, stop="false", state="running"))
            if request.method == "POST":
                return self._smart_center(await request.text())
        if name in self.forbidden:
            return web.Response(status=403)
        if name not in self.apps:
            return web.Response(status=404)
        if request.method == "GET":
            return web.Response(content_type="text/xml", text=DIAL.format(name=name, stop="true", state=self.apps[name]))
        if request.method == "POST":
            self.apps[name] = "running"
            self.screen = name
            return web.Response(status=201, headers={"Location": f"http://127.0.0.1:{self.port}/apps/{name}/run"})
        return web.Response(status=405)

    def _smart_center(self, body):
        self.bodies.append(body)
        if not self.virtual_remote:
            return web.Response(status=403)
        answer = web.Response(status=200, content_type="text/plain", headers={
            "Location": f"http://127.0.0.1:{self.port}/apps/SmartCenter/run"})
        character = re.fullmatch(r"(?:<\?xml version='1\.0' \?>)?<keyboard><key value='(\d+)'/></keyboard>", body)
        if character:
            self._type(int(character.group(1)))
            return answer
        key = re.fullmatch(r"<remote><key code=(\d+)/></remote>", body)
        if key:
            self._press(int(key.group(1)))
        else:
            bare = re.fullmatch(r"<key code=(\d+)\s?/>", body)
            if bare:
                self.ignored.append(int(bare.group(1)))
        return answer

    def _type(self, value):
        if 48 <= value <= 57:
            self.dropped.append(chr(value))
        elif value == 8:
            self.typed = self.typed[:-1]
        else:
            self.typed += chr(value)

    def _press(self, code):
        self.keys.append(code)
        if code == 1065:
            self.screen = "first page"
        elif 1000 <= code <= 1009 and self.screen == "couch-tv":
            self.typed += str(code - 1000)   # a field on a web page takes the remote's number keys
        elif self.screen in ("first page", "bar", "bar, speed dial", "speed dial"):
            self.screen = BROWSER.get((self.screen, code), "somewhere else in the browser")
