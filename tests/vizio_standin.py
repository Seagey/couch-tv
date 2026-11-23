"""A stand in VIZIO SmartCast TV for the tests: a small HTTPS (or plain HTTP) server that answers the
paths bridge/vizio.py uses and keeps a log of everything it was sent.

    async with StandIn() as t:          # plain HTTP, quick
        tv = t.tv()                     # a bridge/vizio.py VizioTV pointed at it (tls false)
        t.power = 0                     # standby
    async with StandIn(tls=True) as t:  # HTTPS with a self signed certificate made at test time
        tv = t.tv()

It answers in the shapes bridge/vizio.py expects, which come from public notes about the SmartCast API
(see PROTOCOL in bridge/vizio.py), so these tests prove the driver is consistent with itself and safe
with what it sends, NOT that a real VIZIO answers the same way.
"""
import json
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import vizio  # noqa: E402

PIN = "4821"
TOKEN = "standin-token-9c2e"
REQ_TOKEN = 551234
INPUTS = [("CAST", "CAST"), ("HDMI-1", "Xbox"), ("HDMI-2", ""), ("COMP", "")]


def self_signed(folder):
    """A throwaway certificate and key for the stand in (needs the openssl command)."""
    cert, key = str(Path(folder) / "c.pem"), str(Path(folder) / "k.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=standin.vizio.test", "-keyout", key, "-out", cert],
                   check=True, capture_output=True)
    return cert, key


def _status(result, detail="Success"):
    return {"STATUS": {"RESULT": result, "DETAIL": detail}}


class StandIn:
    def __init__(self, tls=False, port=0):
        self.tls = tls
        self.port_wanted = port
        self.power = 1
        self.token = None                 # the token handed out after pairing, None before
        self.pin_shown = False
        self.current_app = {"NAME_SPACE": 4, "APP_ID": "1", "MESSAGE": "http://127.0.0.1:12345/scfs/sctv/main.html"}
        self.app_readable = True
        self.volume = 20
        self.current_input = "CAST"
        self.hashval = 1000
        self.wrong_pins = 0
        self.lock_after = 3
        self.busy = False
        self.log = []                     # [(method, path, body, auth header)]
        self._runner = None
        self._tmp = None

    # ---------- the server ----------
    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", self._handle)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        ctx = None
        if self.tls:
            self._tmp = tempfile.TemporaryDirectory(prefix="vizio-standin-")
            cert, key = self_signed(self._tmp.name)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert, key)
        site = web.TCPSite(self._runner, "127.0.0.1", self.port_wanted, ssl_context=ctx)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *a):
        await self._runner.cleanup()
        if self._tmp:
            self._tmp.cleanup()

    def tv(self, **cfg):
        """A VizioTV pointed at the stand in, as the bridge would make it from config.json."""
        base = {"id": "lounge", "name": "Lounge", "kind": "vizio", "ip": "127.0.0.1", "port": self.port,
                "tls": self.tls}
        t = vizio.VizioTV(base | cfg)
        t.ip, t.connected = "127.0.0.1", True
        return t

    def sent(self, path):
        return [b for m, p, b, _a in self.log if p == path]

    # ---------- the TV ----------
    def _authed(self, request):
        return self.token is not None and request.headers.get("AUTH") == self.token

    async def _handle(self, request):
        path = "/" + request.match_info["tail"]
        text = await request.text()
        try:
            data = json.loads(text) if text else None
        except ValueError:
            data = None
        self.log.append((request.method, path, data, request.headers.get("AUTH")))
        if path.startswith("/pairing/"):
            return web.json_response(self._pairing(path, data))
        if not self._authed(request):
            # a bad or missing token: the shape is our reading (PROTOCOL["needs_pairing"])
            return web.json_response(_status("requires_pairing", "Requires pairing"), status=403)
        if path == "/state/device/power_mode" and request.method == "GET":
            return web.json_response(_status("success") | {"ITEMS": [{"CNAME": "power_mode", "TYPE": "T_VALUE_V1",
                                                                       "NAME": "Power Mode", "VALUE": self.power}]})
        if path == "/key_command/" and request.method == "PUT":
            return web.json_response(self._keys(data))
        if path == "/app/current" and request.method == "GET":
            if not self.app_readable:
                return web.json_response(_status("uri_not_found", "Uri not found"))
            return web.json_response(_status("success") | {"ITEM": {"TYPE": "T_APP_V1", "VALUE": self.current_app}})
        if path == "/app/launch" and request.method == "PUT":
            v = (data or {}).get("VALUE") or {}
            self.current_app = {"NAME_SPACE": v.get("NAME_SPACE"), "APP_ID": v.get("APP_ID"), "MESSAGE": v.get("MESSAGE")}
            return web.json_response(_status("success"))
        if path == vizio.PROTOCOL["volume"] and request.method == "GET":
            return web.json_response(_status("success") | {"ITEMS": [{"CNAME": "volume", "VALUE": self.volume,
                                                                       "HASHVAL": 77}]})
        if path == vizio.PROTOCOL["inputs"] and request.method == "GET":
            return web.json_response(_status("success") | {"ITEMS": [
                {"CNAME": n.lower().replace("-", ""), "NAME": n, "HASHVAL": 10 + i, "ENABLED": "FALSE",
                 "VALUE": {"NAME": label, "METADATA": ""}} for i, (n, label) in enumerate(INPUTS)]})
        if path == vizio.PROTOCOL["current_input"]:
            if request.method == "GET":
                return web.json_response(_status("success") | {"ITEMS": [{"CNAME": "current_input", "NAME": "Current Input",
                                                                           "VALUE": self.current_input, "HASHVAL": self.hashval}]})
            if (data or {}).get("REQUEST") != "MODIFY" or data.get("HASHVAL") != self.hashval:
                return web.json_response(_status("hashval_error", "Hashval mismatch"))
            if data.get("VALUE") not in [n for n, _l in INPUTS]:
                return web.json_response(_status("invalid_parameter", "Invalid parameter"))
            self.current_input, self.hashval = data["VALUE"], self.hashval + 1
            return web.json_response(_status("success"))
        return web.json_response(_status("uri_not_found", "Uri not found"))

    def _pairing(self, path, data):
        data = data or {}
        if path == "/pairing/start":
            if self.busy:
                return _status("BLOCKED", "Blocked")
            if not data.get("DEVICE_ID") or not data.get("DEVICE_NAME"):
                return _status("INVALID_PARAMETER")
            self.pin_shown = True
            return _status("SUCCESS") | {"ITEM": {"PAIRING_REQ_TOKEN": REQ_TOKEN, "CHALLENGE_TYPE": 1}}
        if path == "/pairing/pair":
            if data.get("PAIRING_REQ_TOKEN") != REQ_TOKEN or data.get("CHALLENGE_TYPE") != 1:
                return _status("CHALLENGE_INCORRECT")
            if self.wrong_pins >= self.lock_after:
                return _status("MAX_CHALLENGES_EXCEEDED")
            if data.get("RESPONSE_VALUE") != PIN:
                self.wrong_pins += 1
                return _status("PAIRING_DENIED")
            self.token, self.pin_shown = TOKEN, False
            return _status("SUCCESS") | {"ITEM": {"AUTH_TOKEN": TOKEN}}
        if path == "/pairing/cancel":
            self.pin_shown = False
            return _status("SUCCESS") | {"ITEM": {}}
        return _status("uri_not_found")

    def _keys(self, data):
        rows = (data or {}).get("KEYLIST")
        if not isinstance(rows, list) or not rows:
            return _status("invalid_parameter")
        for k in rows:
            if k.get("ACTION") not in ("KEYPRESS", "KEYDOWN", "KEYUP"):
                return _status("invalid_parameter")
            if k.get("ACTION") == "KEYUP":
                continue
            cs, c = k.get("CODESET"), k.get("CODE")
            if cs == 11:
                self.power = {0: 0, 1: 1, 2: 1 - self.power}.get(c, self.power)
            elif (cs, c) == (5, 1):
                self.volume = min(100, self.volume + 1)
            elif (cs, c) == (5, 0):
                self.volume = max(0, self.volume - 1)
        return _status("success")


class NotAVizio:
    """Something else on the first port: answers HTTP with a web page, not SmartCast JSON."""

    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", lambda r: web.Response(text="<html>router</html>",
                                                                       content_type="text/html", status=403))
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *a):
        await self._runner.cleanup()
