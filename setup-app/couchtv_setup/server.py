# The page server's shape (127.0.0.1 only, a secret per run, a background job the page asks about,
# stopping by itself when the page is closed) is adapted from couch-tv-setup by killy10o10
# (couchtv_setup/server.py). MIT License, Copyright (c) 2026 killy10o10. See setup-app/THIRD-PARTY.md.
"""A small web server on this computer only (127.0.0.1, a random port) that serves the setup page
and runs the steps. Nothing else on the network can reach it.

Three locks on the API, because a web page in another tab could otherwise try to call it:
- a secret made fresh each run, put into the page and required in an X-Setup-Key header (another
  site cannot read the page to learn it, and cannot send that header without a CORS preflight,
  which this server never allows);
- the Host header must be this server's own 127.0.0.1 or localhost address, which stops a DNS
  rebinding page from reading the secret out of the page;
- an Origin header, when there is one, must be this server too.
"""
import json
import os
import secrets
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import finder, pairing, release, steps
from .identity import Identity
from .tv import Tv, TvError

WEB = (Path(sys._MEIPASS) / "couchtv_setup" if getattr(sys, "frozen", False) else Path(__file__).parent) / "web"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
SECRET = secrets.token_urlsafe(24)
OS = "mac" if sys.platform == "darwin" else "windows" if sys.platform == "win32" else "linux"
IDLE_S = 180          # the page asks every 20 s; this long without it means the tab is closed
FIRST_S = 600


class State:
    def __init__(self):
        self.tv = None
        self.ip = None
        self.route = None
        self.facts = None
        self.identity = None
        self.lock = threading.Lock()
        self.job = {"running": False}
        self.httpd = None
        self.port = None
        self.seen = None
        self.started = time.time()


S = State()


def identity():
    if not S.identity:
        S.identity = Identity()
    return S.identity


def run_job(name, fn):
    with S.lock:
        if S.job.get("running"):
            raise TvError("Still busy with the last step.", "busy")
        S.job = {"name": name, "running": True, "progress": 0, "message": ""}

    def progress(frac, msg=None):
        S.job["progress"] = round(frac, 3)
        if msg:
            S.job["message"] = msg

    def work():
        try:
            S.job["result"] = fn(progress)
        except TvError as e:
            S.job.update(error=str(e), code=e.code)
        except pairing.PairingError as e:
            S.job.update(error=str(e), code=e.code)
        except Exception as e:
            traceback.print_exc()
            S.job.update(error=f"Something went wrong: {type(e).__name__}. Try that step again.", code="crash")
        finally:
            S.job["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return {"started": name}


def need_tv():
    if not S.tv:
        raise TvError("Connect to the TV first.", "no_tv")
    return S.tv


def home_ip(body):
    ip = str(body.get("ip") or "").strip()
    if not finder.is_home_address(ip):
        raise TvError("That does not look like a TV's address on a home network (it looks like 192.0.2.10, "
                      "with your own numbers).", "bad_ip")
    return ip


def _attach(tv, ip, route):
    if S.tv:
        S.tv.close()
    S.tv, S.ip, S.route = tv, ip, route
    S.facts = steps.facts(tv)
    return {"facts": S.facts, "route": route}


def place_search(q):
    """Suburb or city to latitude, longitude and time zone, with Open-Meteo's free geocoding (no key,
    no account). Only the words typed are sent."""
    q = str(q or "").strip()[:60]
    if len(q) < 2:
        return {"places": []}
    url = "https://geocoding-api.open-meteo.com/v1/search?count=5&format=json&language=en&name=" + urllib.parse.quote(q)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "couch-tv-setup"}),
                                    timeout=10, context=release._context()) as r:
            data = json.load(r)
    except Exception as e:
        raise TvError("Could not look that place up. Check the internet, or skip the weather.", "offline") from e
    out = []
    for p in data.get("results") or []:
        try:
            out.append({"place": str(p["name"])[:60], "area": ", ".join(str(x) for x in (p.get("admin1"), p.get("country")) if x)[:80],
                        "lat": float(p["latitude"]), "lon": float(p["longitude"]), "timezone": str(p.get("timezone") or "")[:60]})
        except (KeyError, TypeError, ValueError):
            continue
    return {"places": [p for p in out if p["timezone"]]}


def api(method, path, body):
    S.seen = time.time()
    if path == "/api/ping":
        return {"ok": True}
    if path == "/api/info":
        return {"os": OS, "connected": bool(S.tv), "facts": S.facts, "route": S.route, "ip": S.ip}
    if path == "/api/quit":
        if S.job.get("running"):
            raise TvError("Still busy with the last step. Wait for it to finish, then close.", "busy")
        threading.Timer(0.5, S.httpd.shutdown).start()
        return {"ok": True}
    if path == "/api/job":
        return S.job
    if path == "/api/scan":
        return run_job("scan", lambda p: {"tvs": finder.scan(), "networks": [str(n) for n in finder.home_networks()]})
    if path == "/api/look":
        ip = home_ip(body)
        return finder.look(ip)
    if path == "/api/pairing-port":
        ip = home_ip(body)
        return {"port": finder.pairing_port(ip, 2.0)}
    if path == "/api/pair":
        ip = home_ip(body)
        code, port = str(body.get("code") or ""), int(body.get("port") or 0)
        if not 0 < port < 65536:
            raise TvError("Type the port: the numbers after the colon under \"IP address & Port\" on the TV.", "bad_port")

        def pair(progress):
            ident = identity()
            progress(0.1, "Pairing with the code")
            pairing.pair(ip, port, code, ident.cert, ident.key, ident.public_text)
            progress(0.5, "Paired. Looking for the TV's Wireless debugging port")
            cport = None
            for _ in range(5):
                cport = finder.connect_port(ip, 2.0)
                if cport:
                    break
            if not cport:
                return {"paired": True, "need_port": True}
            progress(0.8, "Connecting")
            return _attach(Tv(ip, ident, route="tls", port=cport), ip, "tls")
        return run_job("pair", pair)
    if path == "/api/connect-tls":
        ip = home_ip(body)
        port = int(body.get("port") or 0)
        if not 0 < port < 65536:
            raise TvError("Type the port shown under \"IP address & Port\" on the Wireless debugging screen.", "bad_port")
        return run_job("connect", lambda p: _attach(Tv(ip, identity(), route="tls", port=port), ip, "tls"))
    if path == "/api/connect":
        ip = home_ip(body)

        def connect(progress):
            progress(0.2, "Waiting for you to press Allow on the TV")
            if not finder.answers(ip, 5555, 2.0):
                raise TvError("The TV is not answering on its debugging port yet. Check debugging is switched on "
                              "(see the steps above), then try again.", "closed")
            return _attach(Tv(ip, identity(), route="tcp", port=5555, allow_wait_s=90), ip, "tcp")
        return run_job("connect", connect)
    if path == "/api/plan":
        tv = need_tv()
        return {"items": steps.plan(tv, S.facts, ambient_off=bool(body.get("ambient_off", True))), "facts": S.facts}
    if path == "/api/place":
        return place_search(body.get("q"))
    if path == "/api/setup":
        tv = need_tv()
        people = [str(x) for x in (body.get("people") or []) if isinstance(x, str)]
        weather = body.get("weather") if isinstance(body.get("weather"), dict) else None
        ambient_off = bool(body.get("ambient_off", True))

        def setup(progress):
            apk = release.get(release.HOME_APK, lambda f, m=None: progress(0.25 * f, m))
            r = steps.make_home(tv, apk["path"], ambient_off=ambient_off, people=people, weather=weather,
                                progress=lambda f, m=None: progress(0.25 + 0.75 * f, m))
            r["apk"] = {k: apk[k] for k in ("version", "sha256", "checked")}
            return r
        return run_job("setup", setup)
    if path == "/api/check":
        tv = need_tv()
        return run_job("check", lambda p: steps.check_home(tv))
    if path == "/api/remote":
        tv = need_tv()

        def remote(progress):
            apk = release.get(release.ONTV_APK, lambda f, m=None: progress(0.3 * f, m))
            return steps.phone_remote(tv, apk["path"], S.facts, lambda f, m=None: progress(0.3 + 0.7 * f, m))
        return run_job("remote", remote)
    if path == "/api/remote/code":
        need_tv()
        req = urllib.request.Request(f"http://{S.ip}:5400/api/pair/start", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.load(r)
        except Exception as e:
            raise TvError("The phone remote app on the TV is not answering yet. Open Couch TV on the TV once, then try again.",
                          "remote_down") from e
    if path == "/api/debug-off":
        tv = need_tv()
        steps.debugging_off(tv, S.route)
        S.tv = None
        return {"ok": True}
    if path == "/api/undo/plan":
        return steps.undo_plan(need_tv())
    if path == "/api/undo":
        tv = need_tv()
        return run_job("undo", lambda p: steps.undo(tv, p))
    raise TvError("No such step.", "404")


class Handler(BaseHTTPRequestHandler):
    server_version = "couch-tv-setup"
    sys_version = ""

    def log_message(self, fmt, *args):
        if os.environ.get("COUCHTV_SETUP_DEBUG"):
            super().log_message(fmt, *args)

    def _send(self, code, data, ctype="application/json"):
        raw = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if ctype.startswith("text/html"):
            self.send_header("Content-Security-Policy", CSP)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _host_ok(self):
        allowed = {f"127.0.0.1:{S.port}", f"localhost:{S.port}"}
        if (self.headers.get("Host") or "") not in allowed:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in allowed}

    def _api(self, method):
        if not self._host_ok() or not secrets.compare_digest(self.headers.get("X-Setup-Key") or "", SECRET):
            return self._send(403, {"error": "not this page"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > 65536:
            return self._send(413, {"error": "too big"})
        try:
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            if not isinstance(body, dict):
                body = {}
        except ValueError:
            body = {}
        try:
            self._send(200, api(method, self.path.split("?")[0], body))
        except (TvError, pairing.PairingError) as e:
            self._send(400, {"error": str(e), "code": e.code})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": f"Something went wrong: {type(e).__name__}. Try that step again."})

    def do_POST(self):
        if not self.path.startswith("/api/"):
            return self._send(404, b"not found", "text/plain")
        self._api("POST")

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, b"not this page", "text/plain")
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            return self._send(405, {"error": "POST only"})
        name = "index.html" if path in ("", "/") else path.lstrip("/")
        f = (WEB / name).resolve()
        if WEB.resolve() not in f.parents or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        raw = f.read_bytes()
        if name == "index.html":
            raw = raw.replace(b"__SETUP_KEY__", SECRET.encode()).replace(b"__SETUP_OS__", OS.encode())
        self._send(200, raw, TYPES.get(f.suffix, "application/octet-stream"))


def main():
    port = int(os.environ.get("COUCHTV_SETUP_PORT") or 0)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    S.httpd, S.port = httpd, httpd.server_address[1]
    url = f"http://127.0.0.1:{S.port}/"
    print(f"couch-tv Setup is open in your browser: {url}")
    print("Keep this running until you are done. Press Close setup on the page, or Ctrl+C here, to stop.")
    if not os.environ.get("COUCHTV_SETUP_NO_BROWSER"):
        webbrowser.open(url)

    def stop_when_closed():
        while True:
            time.sleep(10)
            now = time.time()
            if (S.seen is None and now - S.started > FIRST_S) or \
                    (S.seen is not None and now - S.seen > IDLE_S and not S.job.get("running")):
                print("The setup page was closed, so couch-tv Setup has stopped.")
                httpd.shutdown()
                return
    threading.Thread(target=stop_when_closed, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if S.tv:
            S.tv.close()
