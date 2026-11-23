"""A stand in Philips Titan OS TV for the tests: a small HTTPS server that answers JointSpace the way
bridge/philips.py expects, asks for a digest login on everything but "system" and pairing, and keeps
a log of every request it was sent.

    async with StandIn(folder) as t:     # folder: where its throwaway certificate goes
        tv = t.tv()                      # a bridge/philips.py PhilipsTV pointed at it
        t.power = "Standby"
        t.front = None                   # activities/current answers 404, as it may on Titan OS

A Saphi mode (StandIn.saphi(folder)) is an older Philips Linux TV as some owners report it: plain http,
no login on anything, API /1/, no powerstate and no app list, and a "browser" activity in "system" with
activities/browser to open a page. Every part of that is UNCONFIRMED on a real Saphi TV
(docs/PHILIPS-SAPHI.md).

It answers only what the driver uses, in shapes that are partly our own reading (PROTOCOL in
bridge/philips.py), so these tests prove the driver is consistent with itself and careful with what
it sends, NOT that a real Titan OS TV answers the same way (docs/PHILIPS-TITAN.md).

The digest check and the pairing signature here are written separately from the driver's, so a
mistake in one is not copied into the other.
"""
import base64
import secrets
import hashlib
import hmac
import json
import re
import ssl
import subprocess
import sys
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import philips  # noqa: E402

SECRET = base64.b64encode(b"stand in shared key, not Philips's").decode()   # a made up key for the tests
PIN = "4821"
REALM = "standin"
SERIAL = "standin-serial-0001"   # what "system" gives as the TV's serial number: never to be printed
APPS = [
    {"id": "netflix", "label": "Netflix", "type": "app"},
    {"id": "youtube", "label": "YouTube", "type": "app"},
    {"id": "prime", "label": "Prime Video", "type": "app"},
    {"id": "devview", "label": "DevView", "type": "app"},
    {"id": "side.1", "label": "Some Local App", "type": "app"},
]
SOURCES = {"tv": {"name": "Watch TV"}, "hdmi1": {"name": "HDMI 1"}, "hdmi2": {"name": "HDMI 2"}}


def make_cert(folder):
    """A throwaway self signed certificate for the stand in (needs the openssl command)."""
    cert, key = str(Path(folder) / "standin.pem"), str(Path(folder) / "standin.key")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=standin",
                    "-keyout", key, "-out", cert], check=True, capture_output=True)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx


def _md5(s):
    return hashlib.md5(s.encode()).hexdigest()


class StandIn:
    def __init__(self, folder, version="6/", tls=True, login=True, browser=False, powerstate=True, applist=True):
        self.folder = folder
        self.tls = tls
        self.login = login              # False: everything answers without a login (Saphi)
        self.browser = browser          # "system" lists a browser activity, and activities/browser opens a page
        self.has_powerstate = powerstate
        self.has_applist = applist
        self.pages = []                 # the addresses activities/browser was asked to open
        self.authorization = []         # every Authorization header sent, None when there was none
        self.connections = set()        # every connection a request came in on
        self.broken = set()             # paths that answer 500 with a page that is not JSON (unreliable sets)
        self.version = version          # the one API prefix this TV answers on
        self.power = "On"
        self.front = ""                 # the app id in front, "" for the home, None: activities/current is missing
        self.apps = [dict(a) for a in APPS]
        self.volume = {"current": 12, "min": 0, "max": 60, "muted": False}
        self.source = "tv"
        self.logins = {}                # device id -> auth key, once paired
        self.pending = {}               # device id -> (auth key, timestamp) while a PIN is on screen
        self.pin_on_screen = False
        self.log = []                   # (method, path, body) of pairing, "system" and every logged in request
        self.nonce = "n0nce-1"
        self._runner = None
        self.port = None

    @classmethod
    def saphi(cls, folder, **kw):
        return cls(folder, **({"version": "1/", "tls": False, "login": False, "browser": True, "powerstate": False,
                               "applist": False} | kw))

    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0, ssl_context=make_cert(self.folder) if self.tls else None)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        await self._runner.cleanup()

    def tv(self, **cfg):
        t = philips.PhilipsTV({"id": "lounge", "name": "Lounge", "kind": "philips", "ip": "127.0.0.1",
                               "port": self.port, "tls": self.tls, "mac": "", **cfg})
        t.ip = "127.0.0.1"
        t.connected = True
        return t

    def pair_now(self, tv):
        """Skip the PIN: give the bridge a login as pairing would."""
        # a throwaway login made fresh each run, so no fixed credential sits in the repo
        self.test_login = secrets.token_hex(8)
        self.logins["dev-test"] = self.test_login
        tv._keep(user="dev-test", password=self.test_login)

    def sent(self, path):
        return [json.loads(b) if b else None for m, p, b in self.log if p == path and m == "POST"]

    # ---------- digest ----------
    def _challenge(self):
        return web.Response(status=401, headers={
            "WWW-Authenticate": f'Digest realm="{REALM}", qop="auth", nonce="{self.nonce}", opaque="op"'})

    def _logged_in(self, request, users):
        h = request.headers.get("Authorization", "")
        if not h.startswith("Digest "):
            return False
        f = dict(re.findall(r'(\w+)="?([^",]*)"?', h[7:]))
        pw = users.get(f.get("username"))
        if pw is None or f.get("nonce") != self.nonce or f.get("uri") != request.raw_path:
            return False
        ha1 = _md5(f"{f['username']}:{REALM}:{pw}")
        ha2 = _md5(f"{request.method}:{f['uri']}")
        want = _md5(f"{ha1}:{self.nonce}:{f.get('nc')}:{f.get('cnonce')}:auth:{ha2}")
        return f.get("response") == want

    # ---------- the TV ----------
    async def _handle(self, request):
        raw = request.match_info["path"]
        text = await request.text()
        self.authorization.append(request.headers.get("Authorization"))
        self.connections.add(request.transport)
        if not raw.startswith(self.version):
            return web.Response(status=404)
        path = raw[len(self.version):]
        if path in self.broken:
            return web.Response(status=500, text="<html>error</html>")
        if path in ("system", "pair/request", "pair/grant"):
            self.log.append((request.method, path, text))
        data = json.loads(text) if text else None
        if path == "system" and request.method == "GET":
            about = {"name": "Stand in Philips", "model": "00XX0000/12", "serialnumber_encrypted": SERIAL,
                     "api_version": {"Major": int(self.version.strip("/") or 6), "Minor": 0}}
            if self.browser:
                about["featuring"] = {"jsonfeatures": {"activities": ["browser"]}}
            return web.json_response(about)
        if path == "pair/request" and request.method == "POST":
            dev = ((data or {}).get("device") or {}).get("id")
            if not dev or sorted((data or {}).get("scope") or []) != ["control", "read", "write"]:
                return web.json_response({"error_id": "INVALID_PARAMETER"})
            self.pending[dev] = ("auth-" + dev, 1700000000)
            self.pin_on_screen = True
            return web.json_response({"error_id": "SUCCESS", "auth_key": "auth-" + dev, "timestamp": 1700000000,
                                      "timeout": 60})
        if path == "pair/grant" and request.method == "POST":
            users = {d: k for d, (k, _) in self.pending.items()}
            if not self._logged_in(request, users):
                return self._challenge()
            auth = (data or {}).get("auth") or {}
            dev = ((data or {}).get("device") or {}).get("id")
            key, ts = self.pending.get(dev, (None, None))
            mac = hmac.new(base64.b64decode(SECRET), f"{ts}{PIN}".encode(), hashlib.sha1).hexdigest()
            good = base64.b64encode(mac.encode()).decode()
            if auth.get("pin") != PIN or auth.get("auth_signature") != good:
                return web.json_response({"error_id": "INVALID_PIN"})
            self.logins[dev] = key
            self.pin_on_screen = False
            return web.json_response({"error_id": "SUCCESS"})
        if self.login and not self._logged_in(request, self.logins):
            return self._challenge()
        self.log.append((request.method, path, text))   # only what got past the login
        if path == "powerstate" and not self.has_powerstate:
            return web.Response(status=404)
        if path == "applications" and not self.has_applist:
            return web.Response(status=404)
        if path == "activities/browser" and request.method == "POST":
            url = (data or {}).get("url") if isinstance(data, dict) else None
            if not self.browser or not isinstance(url, str) or not re.match(r"^https?://", url):
                return web.Response(status=400 if self.browser else 404)
            self.pages.append(url)
            if self.front is not None:
                self.front = "browser"
            # what a real 43PUS8909/12 answers: 200 with a page, not JSON
            return web.Response(text="<html><head><title>Ok</title></head><body>Ok</body></html>", content_type="text/html")
        if path == "powerstate":
            if request.method == "POST":
                self.power = data["powerstate"]
                return web.json_response({})
            return web.json_response({"powerstate": self.power})
        if path == "input/key" and request.method == "POST":
            if data.get("key") == "Home":
                self.front = ""
            if data.get("key") == "Standby":
                self.power = "Standby"
            return web.json_response({})
        if path == "audio/volume":
            if request.method == "POST":
                self.volume.update({k: v for k, v in data.items() if k in ("current", "muted")})
                return web.json_response({})
            return web.json_response(self.volume)
        if path == "sources":
            return web.json_response(SOURCES)
        if path == "sources/current" and request.method == "POST":
            if data.get("id") not in SOURCES:
                return web.Response(status=400)
            self.source = data["id"]
            self.front = "" if data["id"] == "tv" else data["id"]
            return web.json_response({})
        if path == "applications":
            return web.json_response({"version": 1, "applications": self.apps})
        if path == "activities/current":
            if self.front is None:
                return web.Response(status=404)
            return web.json_response({"component": {"packageName": self.front or "NA", "className": "NA"}})
        if path == "activities/launch" and request.method == "POST":
            hit = next((a for a in self.apps if a == data), None)
            if not hit:
                return web.Response(status=400)
            if self.front is not None:
                self.front = hit["id"]
            return web.json_response({})
        return web.Response(status=404)
