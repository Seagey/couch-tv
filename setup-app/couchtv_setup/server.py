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
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import errors, finder, guide, health, linkin, pairing, paths, release, scanlog, steps, studio, tvprofile
from .helper import autostart as hautostart, config as hconfig, deeplink
from .identity import Identity
from .tv import Tv, TvError

WEB = (Path(sys._MEIPASS) / "couchtv_setup" if getattr(sys, "frozen", False) else Path(__file__).parent) / "web"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
SECRET = secrets.token_urlsafe(24)
OS = "mac" if sys.platform == "darwin" else "windows" if sys.platform == "win32" else "linux"
ALLOW_WAIT_S = 45     # how long one try waits for Allow on the TV; the page counts it down
IDLE_S = 180         # the page asks every 20 s; this long without it means the tab is closed
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
        self.tv_seen = finder.Seen()    # TVs the last scans found (kept ~30 s, never shown Ready once missed)
        self.started = time.time()
        self.link = studio.Link()      # the Couch TV account, in memory only
        self.handoff = None            # a code from couchtv://setup?handoff=..., not used yet
        self.profile = None            # tvprofile of the connected TV
        self.intent = None             # "helper" when opened by couchtv://helper/on


S = State()


def identity():
    if not S.identity:
        S.identity = Identity()
    return S.identity


def error_payload(e):
    """What the page gets for any error: plain words, a code, and the technical part only as `detail`
    (the page keeps it behind Details). Never a raw exception name in the words."""
    if isinstance(e, TvError):
        return e.payload()
    if isinstance(e, pairing.PairingError):
        root = e.__cause__ or e.__context__
        if root is not None and errors.is_local_network_block(root, dest=getattr(root, "dest", None)):
            msg, code, det = errors.explain(root)
            return {"error": msg, "code": code, "detail": det}
        out = {"error": str(e), "code": e.code}
        if root is not None:
            out["detail"] = errors.detail(root)
        return out
    traceback.print_exc()
    msg, code, det = errors.explain(e)
    return {"error": msg, "code": code, "detail": det}


def run_job(name, fn):
    with S.lock:
        if S.job.get("running"):
            if name == "scan" and S.job.get("name") == "scan":
                return {"started": name}   # the page asked again while a scan is running: it joins that one
            raise TvError("Still busy with the last step.", "busy")
        S.job = {"name": name, "running": True, "progress": 0, "message": ""}

    def progress(frac, msg=None):
        S.job["progress"] = round(frac, 3)
        if msg:
            S.job["message"] = msg

    def work():
        try:
            S.job["result"] = fn(progress)
        except Exception as e:
            S.job.update(error_payload(e))
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
    S.profile = tvprofile.read(tv, S.facts)
    _remember(ip, S.facts, route=route)
    return {"facts": S.facts, "route": route, "profile": S.profile}


def _known():
    try:
        return json.loads((paths.data() / "known-tvs.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _remember(ip, f=None, route=None, room=None, tv_id=None):
    """What this TV turned out to be, so the list and the kind question know it next time: its model,
    kind, the way in that worked ("tls" means Wireless debugging is paired with this computer) and the
    room name the person gave it ("Living room TV"), and its My TVs row id once an account set it up
    (sent again when Setup sets the same TV up again)."""
    k = _known()
    old = k.get(ip) or {}
    k[ip] = {"name": (f or {}).get("name") or old.get("name"), "kind": (f or {}).get("kind") or old.get("kind"),
             "route": route or old.get("route"), "room": room if room is not None else old.get("room"),
             "tv_id": tv_id or old.get("tv_id")}
    try:
        (paths.data() / "known-tvs.json").write_text(json.dumps(k), encoding="utf-8")
    except OSError:
        pass


def _town_weather(town):
    """The account's town ({name, lat, lon}) as the home's weather setting, which also needs the time
    zone: the nearest Open-Meteo match for the town's name. None when it cannot be looked up."""
    if not town:
        return None
    try:
        places = place_search(town["name"])["places"]
    except TvError:
        return None
    near = sorted(places, key=lambda p: (p["lat"] - town["lat"]) ** 2 + (p["lon"] - town["lon"]) ** 2)
    if not near or abs(near[0]["lat"] - town["lat"]) > 0.5 or abs(near[0]["lon"] - town["lon"]) > 0.5:
        return None
    return {"lat": town["lat"], "lon": town["lon"], "place": town["name"], "timezone": near[0]["timezone"]}


def _from_account(progress):
    """Registers the connected TV with the signed in account and gets what goes onto it. A failure
    here never stops the setup: Couch TV still goes on, without the account parts."""
    progress(0.26, "Linking the TV to your Couch TV account")
    known = _known().get(S.ip) or {}
    name = known.get("room") or (S.facts or {}).get("name") or "TV"
    # set up here before: its My TVs row, but only when the TV at this address is still the same model
    same = known.get("name") and known.get("name") == (S.facts or {}).get("name")
    try:
        reg = studio.register_tv(S.link, tvprofile.clean(S.profile), name, known.get("tv_id") if same else None)
    except TvError:
        return None
    if reg.get("tv_id"):
        _remember(S.ip, tv_id=reg["tv_id"])
    people, town = studio.setup_inputs(reg["home"])
    return {"people": people, "weather": _town_weather(town), "design": reg["design"],
            "extras": {"link": reg["link"], "code": reg["code"]}}


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


def helper_state():
    cfg = hconfig.load()
    return {"mode": cfg["mode"], "autostart": hautostart.is_enabled(), "intent": S.intent,
            "can_autostart": True, "tvs": cfg["tvs"]}


def helper_api(name, body):
    """Extra features (Couch TV Helper): turn on, turn off, add a TV that needs it, start it now."""
    if name == "state":
        return helper_state()
    if name == "intent":
        S.intent = "helper" if body.get("intent") == "helper" else S.intent
        return {"ok": True}
    if name == "add-tv":
        ip, kind = home_ip(body), str(body.get("kind") or "")
        if not hconfig.needs_helper(kind):
            raise TvError("That TV does not need the helper.", "bad_kind")
        hconfig.add_tv(ip, kind, str(body.get("name") or ""))
        return {"ok": True}
    if name == "on":
        want = body.get("autostart") is True
        hconfig.turn_on(want)
        if want:
            hautostart.enable()
        else:
            hautostart.disable()
        S.intent = None
        if body.get("start") is not False and not os.environ.get("COUCHTV_SETUP_NO_HELPER_START"):
            _start_helper()
        return helper_state()
    if name == "off":
        hautostart.disable()
        hconfig.turn_off()
        return helper_state()
    raise TvError("No such step.", "404")


def _start_helper():
    """The helper is the same program started with --helper, apart from this page."""
    import subprocess
    exe = [sys.executable, "--helper"] if getattr(sys, "frozen", False) else [sys.executable, "-m", "couchtv_setup", "--helper"]
    subprocess.Popen(exe, stdin=subprocess.DEVNULL)


def api(method, path, body):
    S.seen = time.time()
    if path == "/api/ping":
        return {"ok": True}
    if path.startswith("/api/helper/"):
        return helper_api(path[len("/api/helper/"):], body)
    if path == "/api/info":
        return {"os": OS, "connected": bool(S.tv), "facts": S.facts, "route": S.route, "ip": S.ip, "profile": S.profile,
                "helper": helper_state()}
    if path == "/api/quit":
        if S.job.get("running"):
            raise TvError("Still busy with the last step. Wait for it to finish, then close.", "busy")
        threading.Timer(0.5, S.httpd.shutdown).start()
        return {"ok": True}
    if path == "/api/job":
        return S.job
    if path == "/api/scan":
        def scan(p):
            fake = os.environ.get("COUCHTV_SETUP_FAKE_SCAN")

            def enrich(tvs):
                for t in tvs:
                    t["profile"] = tvprofile.guess(t)
                    t["route"] = guide.route_for(t)
                return tvs

            def early(rows):
                # the TVs' own announcements are in: show them while the knocking goes on
                S.job["partial"] = {"tvs": S.tv_seen.apply(enrich(rows))}
            diag = {}
            if fake:
                # development and screenshots: recorded answers ({"heard", "knocks", "dial", "confirmed"}),
                # merged exactly as a real scan would be, and nothing is sent on the network
                with open(fake, encoding="utf-8") as f:
                    rec = json.load(f)
                time.sleep(float(rec.get("delay", 0.5)))
                tvs = finder.merge(rec.get("heard", []), [tuple(k) for k in rec.get("knocks", [])], rec.get("dial", {}),
                                   _known(), rec.get("confirmed", {}))
                diag["networks"] = []
            else:
                try:
                    tvs = finder.scan(known=_known(), on_partial=early, diag=diag, hints=S.tv_seen.ips())
                except Exception as e:
                    diag.setdefault("error", str(getattr(e, "code", "") or "scan_failed"))
                    scanlog.write(diag)
                    raise
            tvs = S.tv_seen.apply(enrich(tvs))
            if not fake:
                diag["shown"] = [{"ip": t["ip"], "status": t["status"], "stale": bool(t.get("stale"))} for t in tvs]
                scanlog.write(diag)
            return {"tvs": tvs, "networks": diag.get("networks", [])}
        return run_job("scan", scan)
    if path == "/api/guide":
        row = body.get("row") if isinstance(body.get("row"), dict) else {}
        wireless = body.get("wireless") if isinstance(body.get("wireless"), bool) else None
        kind = "fire" if body.get("kind") == "fire" else None
        android = row.get("android_version") or body.get("android")
        route = str(body.get("route") or "") or guide.route_for(row, android, kind, wireless)
        if route not in ("ready", "pair", "allow", "fire", "choose"):
            route = "choose"
        return {"route": route, "steps": guide.steps(route, android, bool(body.get("google_tv")))}
    if path == "/api/name-tv":
        ip = home_ip(body)
        room = str(body.get("room") or "").strip()[:30]
        _remember(ip, room=room or None)
        return {"ok": True}
    if path == "/api/account":
        return {"mode": studio.mode(), "account": S.link.account if S.link.token else None,
                "handoff": bool(S.handoff), "tv": S.link.tv and {k: S.link.tv.get(k) for k in ("tv_id", "design")}}
    if path in ("/api/handoff", "/api/handoff-in"):
        code = studio.read_code(body.get("code"))
        if path == "/api/handoff-in":
            S.handoff = code or S.handoff   # from a second copy opened by a link: the page picks it up
            return {"ok": bool(code)}
        code = code or S.handoff
        S.handoff = None
        return {"account": studio.handoff(S.link, code)}
    if path == "/api/device/start":
        return studio.device_start(S.link)
    if path == "/api/device/poll":
        return studio.device_poll(S.link)
    if path == "/api/sign-out":
        S.link = studio.Link()
        return {"ok": True}
    if path == "/api/profile":
        need_tv()
        return {"profile": S.profile}
    if path == "/api/health/preview":
        # what a health report would hold, shown in full before the person says yes
        tv = need_tv()
        S.health = health.health_report(tv, (S.facts or {}).get("installed") or {})
        return {"report": S.health, "can_send": bool(S.link.token and S.link.tv)}
    if path == "/api/health/send":
        if body.get("yes") is not True or not getattr(S, "health", None):
            raise TvError("Look at the report first, then press Send.", "no_ok")
        out = studio.send_health(S.link, S.health)
        S.health = None
        return out
    if path == "/api/look":
        ip = home_ip(body)
        r = finder.look(ip)
        r["known"] = _known().get(ip)
        return r
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

        kind = str(body.get("kind") or "")
        try:
            tried = max(0, int(body.get("tried") or 0))
            wait = min(max(int(body.get("wait") or ALLOW_WAIT_S), 10), 60)
        except (TypeError, ValueError):
            tried, wait = 0, ALLOW_WAIT_S

        def connect(progress):
            progress(0.2, "Waiting for you to press Allow on the TV")
            r = finder.knock(ip, 5555, 2.0)
            if r and errors.is_local_network_block(r, dest=ip):
                raise finder.blocked(r)
            if r:
                raise TvError("The TV is not letting computers in yet. Check USB debugging (on Fire TV: ADB debugging) "
                              "is switched on, as in the steps, then try again.", "closed", errors.detail(r),
                              fix=steps.next_fix(kind, ip in _known(), tried, closed=True))
            try:
                return _attach(Tv(ip, identity(), route="tcp", port=5555, allow_wait_s=wait), ip, "tcp")
            except TvError as e:
                if e.code == "not_allowed":
                    # Never a dead end: the page walks through the real fixes, then the phone route.
                    e.extra["fix"] = steps.next_fix(kind, ip in _known(), tried)
                raise
        return run_job("connect", connect)
    if path == "/api/plan":
        tv = need_tv()
        return {"items": steps.plan(tv, S.facts, ambient_off=bool(body.get("ambient_off", True)),
                                    ontv_home_off=bool(body.get("ontv_home_off", True))), "facts": S.facts}
    if path == "/api/place":
        return place_search(body.get("q"))
    if path == "/api/setup":
        tv = need_tv()
        people = [str(x) for x in (body.get("people") or []) if isinstance(x, str)]
        weather = body.get("weather") if isinstance(body.get("weather"), dict) else None
        ambient_off = bool(body.get("ambient_off", True))
        ontv_off = bool(body.get("ontv_home_off", True))

        def setup(progress):
            if not ontv_off and steps.ontv_home(tv)["takes_home"]:
                r = steps.make_home(tv, "", ontv_home_switch_off=False)
                r["apk"] = {"version": "none", "sha256": "", "checked": "nothing installed"}
                return r
            apk = release.get(release.HOME_APK, lambda f, m=None: progress(0.25 * f, m))
            acct = _from_account(progress) if S.link.token else None
            ppl, wx = people, weather
            if acct:
                a_people, a_weather = acct["people"], acct["weather"]
                ppl = a_people or people          # the account's people win over names typed here
                wx = a_weather or weather
            r = steps.make_home(tv, apk["path"], ambient_off=ambient_off, people=ppl, weather=wx,
                                ontv_home_switch_off=ontv_off, progress=lambda f, m=None: progress(0.27 + 0.73 * f, m),
                                account=acct and acct["extras"])
            r["apk"] = {k: apk[k] for k in ("version", "sha256", "checked")}
            if r.get("front"):
                progress(0.99, "Measuring how smoothly this TV draws Couch TV")
                try:
                    S.profile = dict(S.profile or {}, speed=health.speed_test(tv), couchtv=apk.get("version"))
                    r["speed"] = S.profile["speed"]
                except Exception:
                    r["speed"] = None
            if acct:
                r["account"] = {"linked": bool(acct["extras"].get("link")), "design": acct["design"],
                                "people": len(ppl or []), "town": (acct["weather"] or {}).get("place"),
                                "reported": studio.report_done(S.link, r.get("front"), apk.get("version"), tvprofile.clean(S.profile))}
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
        except urllib.error.HTTPError as e:
            # the TV answered: say what it said (429 after too many wrong codes: "Wait 10 min, then try again.")
            try:
                said = (json.loads(e.read().decode("utf-8", "replace")) or {}).get("error")
            except Exception:
                said = None
            if said:
                raise TvError(str(said)[:200], "remote_locked" if e.code == 429 else "remote_said") from e
            raise TvError("The phone remote app on the TV is not answering yet. Open Couch TV on the TV once, then try again.",
                          "remote_down") from e
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
            self._send(400, error_payload(e))
        except Exception as e:
            self._send(500, error_payload(e))

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


def main(argv=None):
    # Opened by the website's "Set up my TV" link: hand the code to a Setup that is already running
    # (then just show its page), or keep it for this run's page.
    argv = argv if argv is not None else sys.argv
    if "--bridge" in argv:      # the helper's child process: the bridge, inside this program
        from .helper import bridge_proc
        return bridge_proc.run_bridge()
    if "--helper" in argv:      # Couch TV Helper: the bridge and the menu bar item, no setup page
        from .helper import app as helper_app
        return sys.exit(helper_app.run())
    if deeplink.find(argv):     # couchtv://helper/on from the account page
        S.intent = "helper"
        try:
            info = json.loads((paths.data() / linkin.RUNNING).read_text(encoding="utf-8"))
            req = urllib.request.Request(f"http://127.0.0.1:{int(info['port'])}/api/helper/intent", data=b'{"intent":"helper"}',
                                         method="POST", headers={"Content-Type": "application/json", "X-Setup-Key": str(info["key"])})
            with urllib.request.urlopen(req, timeout=3):
                if not os.environ.get("COUCHTV_SETUP_NO_BROWSER"):
                    webbrowser.open(f"http://127.0.0.1:{int(info['port'])}/")
                return
        except Exception:
            pass
    link = studio.url_in(argv)
    code = studio.parse_url(link) if link else ""
    if code:
        running = linkin.hand_to_running(code)
        if running:
            if not os.environ.get("COUCHTV_SETUP_NO_BROWSER"):
                webbrowser.open(running)
            print("Couch TV Setup was already open, so the code went to it.")
            return
        S.handoff = code
    try:
        linkin.register_windows()
    except OSError:
        pass   # the link button then falls back to the typed code
    port = int(os.environ.get("COUCHTV_SETUP_PORT") or 0)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    S.httpd, S.port = httpd, httpd.server_address[1]
    linkin.write_running(S.port, SECRET)
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
        linkin.clear_running()
        if S.tv:
            S.tv.close()
