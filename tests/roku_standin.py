"""A stand-in Roku for the tests: a small web server that answers Roku's External Control Protocol (ECP)
the way Roku's documentation says a Roku does, and keeps a log of every command it was sent.

    async with StandIn() as roku:
        tv = roku.tv()          # a bridge/roku.py RokuTV pointed at it
        roku.limited = True     # now keypress and launch answer 403, like "Control by mobile apps" on Limited

It answers only what the driver uses. It is not a Roku, and a real one may differ (see docs/ROKU.md).
"""
from pathlib import Path
import sys

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import roku  # noqa: E402

APPS = [("12", "Netflix"), ("837", "YouTube"), ("13", "Prime Video"), ("99001", "Stan"),
        ("99002", "SBS On Demand"), ("dev", "Couch TV"), ("5", "Some Local App")]
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


class StandIn:
    def __init__(self):
        self.power = "PowerOn"      # power-mode
        self.active = ("12", "Netflix")   # (id, name); id "" is Roku's home
        self.player = None          # None, or ("play", position_ms, duration_ms)
        self.limited = False        # Control by mobile apps on a limiting mode: 403 on commands
        self.log = []               # ("POST", "keypress/Up"), ("POST", "launch/12?contentId=1&mediaType=series")
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
        t = roku.RokuTV({"id": "lounge", "name": "Lounge", "kind": "roku", "ip": "127.0.0.1",
                         "port": self.port, "mac": "", **cfg})
        t.ip = "127.0.0.1"
        t.connected = True
        return t

    async def _handle(self, request):
        path = request.match_info["path"]
        full = request.raw_path.lstrip("/")   # as sent, still URL encoded
        if path.startswith(("keypress/", "launch/", "query/icon/")) and self.limited:
            self.log.append((request.method, full + " [403]"))
            return web.Response(status=403, text="Forbidden")
        if request.method == "POST":
            if not path.startswith(("keypress/", "launch/", "input")):
                return web.Response(status=404)
            self.log.append(("POST", full))
            if path.startswith("launch/"):
                rid = path.split("/", 1)[1]
                name = dict(APPS).get(rid)
                if name is None:
                    return web.Response(status=404)
                self.active = (rid, name)
            elif path == "keypress/PowerOff":
                self.power = "Ready"
            elif path == "keypress/PowerOn":
                self.power = "PowerOn"
            elif path == "keypress/Home":
                self.active = ("", "Roku")
            return web.Response(status=200)
        if request.method != "GET":
            return web.Response(status=405)
        if path == "query/device-info":
            return web.Response(content_type="text/xml", text=(
                "<device-info><model-name>Stand-in Roku TV</model-name><software-version>14.1.0</software-version>"
                f"<is-tv>true</is-tv><power-mode>{self.power}</power-mode></device-info>"))
        if path == "query/active-app":
            rid, name = self.active
            inner = f'<app id="{rid}">{name}</app>' if rid else "<app>Roku</app>"
            return web.Response(content_type="text/xml", text=f"<active-app>{inner}</active-app>")
        if path == "query/apps":
            rows = "".join(f'<app id="{i}" type="appl" version="1.0">{n}</app>' for i, n in APPS)
            return web.Response(content_type="text/xml", text=f"<apps>{rows}</apps>")
        if path.startswith("query/icon/"):
            return web.Response(body=PNG, content_type="image/png")
        if path == "query/media-player":
            if not self.player:
                return web.Response(content_type="text/xml", text='<player state="close"/>')
            state, pos, dur = self.player
            return web.Response(content_type="text/xml", text=(
                f'<player state="{state}"><position>{pos} ms</position><duration>{dur} ms</duration></player>'))
        return web.Response(status=404)
