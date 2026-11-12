"""A stand-in Fire TV on Vega OS for the tests: a fake `vega` command that logs what it was asked, and a
DIAL server (SSDP on UDP plus the REST service) that answers the way Amazon's DIAL page says a stick does.

    async with StandIn(tmp) as s:
        tv = s.tv()

It answers only what bridge/vega.py uses. It is not a Fire TV, and a real one may differ (docs/FIRE-VEGA.md).
"""
import asyncio
import json
from pathlib import Path
import sys

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import vega  # noqa: E402

FAKE_CLI = """#!/usr/bin/env python3
import json, os, sys
log = os.environ["VEGA_STANDIN_LOG"]
with open(log, "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
if os.environ.get("VEGA_STANDIN_FAIL") and "launch-app" in sys.argv:
    print("error: app not installed"); sys.exit(1)
if "is-app-installed" in sys.argv:
    print("true")
"""


class _Ssdp(asyncio.DatagramProtocol):
    def __init__(self, owner):
        self.owner = owner

    def connection_made(self, transport):
        self.t = transport

    def datagram_received(self, data, addr):
        self.owner.ssdp.append(data.decode(errors="replace"))
        if b"urn:dial-multiscreen-org:service:dial:1" in data and self.owner.dial_on:
            body = (f"HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:{self.owner.port}/dd.xml\r\n"
                    "ST: urn:dial-multiscreen-org:service:dial:1\r\nUSN: uuid:standin\r\n\r\n")
            self.t.sendto(body.encode(), addr)


class StandIn:
    def __init__(self, tmp):
        self.tmp = Path(tmp)
        self.cli = self.tmp / "vega"
        self.cli.write_text(FAKE_CLI)
        self.cli.chmod(0o755)
        self.cli_log = self.tmp / "cli.log"
        self.cli_log.write_text("")
        self.dial_on = True
        self.ssdp = []
        self.dial_log = []        # ("POST", "/apps/Netflix", "m=...")
        self.base_override = None
        self._runner = None
        self._udp = None
        self.port = None
        self.dial_port = None
        self.adb_server = None
        self.adb_port = None

    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        loop = asyncio.get_running_loop()
        self._udp, _ = await loop.create_datagram_endpoint(lambda: _Ssdp(self), local_addr=("127.0.0.1", 0))
        self.dial_port = self._udp.get_extra_info("sockname")[1]
        self.adb_server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
        self.adb_port = self.adb_server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        self._udp.close()
        self.adb_server.close()
        await self._runner.cleanup()

    def stop_port(self):
        """The stick going to sleep: its network port closes."""
        self.adb_server.close()

    def tv(self, **cfg):
        t = vega.VegaTV({"id": "bed", "name": "Bedroom", "kind": "vega", "ip": "127.0.0.1",
                         "port": self.adb_port, "dial_port": self.dial_port, "cli": str(self.cli),
                         "mac": "", **cfg})
        t.connected = True
        t.power = True
        return t

    def cli_calls(self):
        return [json.loads(l) for l in self.cli_log.read_text().splitlines() if l]

    async def _handle(self, request):
        path = request.match_info["path"]
        if path == "dd.xml":
            base = self.base_override or f"http://127.0.0.1:{self.port}/apps"
            return web.Response(text="<root/>", headers={"Application-URL": base})
        if path.startswith("apps/"):
            body = (await request.read()).decode()
            self.dial_log.append((request.method, "/" + path, body))
            name = path.split("/", 1)[1]
            if name not in ("Netflix", "YouTube", "CouchTV"):
                return web.Response(status=404)
            return web.Response(status=201 if request.method == "POST" else 200, text="<service/>")
        return web.Response(status=404)
