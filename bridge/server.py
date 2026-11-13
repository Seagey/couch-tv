"""Couch TV bridge: the HTTP API in API.md, on port 5400 by default.

Run: .venv/bin/python bridge/server.py   (settings come from config.json, see config.example.json)
"""
import asyncio
import contextvars
import hashlib
import hmac
import ipaddress
import json
import logging
import mimetypes
import os
import re
import secrets
import socket
import time
import urllib.parse
from collections.abc import MutableMapping
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from aiohttp import web

import apps
import config
import finder
import history_import
import kids
import store
import taste
from tv import TV, TVUnavailable, intent_to_link
import samsung
import lg
import roku
import appletv
import vidaa
import philips
import vega
import vizio
import panasonic
import tivo
import spotify_now

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REMOTE_DIR = os.path.join(ROOT, "remote", "dist")
LAUNCHER_DIR = os.path.join(ROOT, "tv-home", "web")
TITAN_DIR = os.path.join(ROOT, "titan")   # the start page a Titan OS app opens (docs/PHILIPS-TITAN.md), and a TiVo OS tile
SHIM_PATH = os.path.join(HERE, "web", "shim.js")
PORT = int(os.environ.get("PORT") or config.BRIDGE["port"])
HOME_TZ = ZoneInfo(config.TIMEZONE)   # the home's time zone (weather.timezone in config.json)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("bridge")

# ---------- which TV ----------
# Every request runs for one TV: ?tv= or "tv" in the body, default the living room. The names
# below (tv, playing, media_now, ...) always mean "the TV this request or loop is for".
TV_CONFIG = {"default": config.DEFAULT_TV, "tvs": config.TVS}


def make_tv(cfg):
    """A Samsung ("kind": "samsung", bridge/samsung.py), an LG ("kind": "lg", bridge/lg.py), a Roku
    ("kind": "roku", bridge/roku.py), a Hisense VIDAA ("kind": "vidaa", bridge/vidaa.py), a Philips on
    Titan OS or Saphi ("kind": "philips", bridge/philips.py), an Amazon Fire TV on Vega OS ("kind": "vega",
    bridge/vega.py), a VIZIO ("kind": "vizio", bridge/vizio.py), a Panasonic Viera ("kind": "panasonic",
    bridge/panasonic.py), a TiVo OS TV built by Vestel ("kind": "tivo", bridge/tivo.py), an Apple TV
    ("kind": "appletv", bridge/appletv.py) or an Android or Google TV (tv.py)."""
    if cfg.get("kind") == "samsung":
        return samsung.SamsungTV(cfg)
    if cfg.get("kind") == "lg":
        return lg.LGTV(cfg)
    if cfg.get("kind") == "roku":
        return roku.RokuTV(cfg)
    if cfg.get("kind") == "vidaa":
        return vidaa.VidaaTV(cfg)
    if cfg.get("kind") == "philips":
        return philips.PhilipsTV(cfg)
    if cfg.get("kind") == "vega":
        return vega.VegaTV(cfg)
    if cfg.get("kind") == "vizio":
        return vizio.VizioTV(cfg)
    if cfg.get("kind") == "panasonic":
        return panasonic.PanasonicTV(cfg)
    if cfg.get("kind") == "tivo":
        return tivo.TivoTV(cfg)
    if cfg.get("kind") == "appletv":
        return appletv.AppleTV(cfg)
    return TV(cfg)


TVS = {c["id"]: make_tv(c) for c in TV_CONFIG["tvs"]}
DEFAULT_TV = TV_CONFIG["default"]
_current = contextvars.ContextVar("tv", default=DEFAULT_TV)


class _TVProxy:
    def __getattr__(self, name):
        return getattr(TVS[_current.get()], name)


class _StateProxy(MutableMapping):
    def __init__(self, key):
        self._key = key

    def _d(self):
        return TVS[_current.get()].state[self._key]

    def __getitem__(self, k):
        return self._d()[k]

    def __setitem__(self, k, v):
        self._d()[k] = v

    def __delitem__(self, k):
        del self._d()[k]

    def __iter__(self):
        return iter(self._d())

    def __len__(self):
        return len(self._d())


def with_tv(tv_id, fn, *args):
    token = _current.set(tv_id)
    try:
        return fn(*args)
    finally:
        _current.reset(token)


def for_tv(tv_id, coro_fn):
    """A task that runs coro_fn() for one TV."""
    async def runner():
        _current.set(tv_id)
        await coro_fn()
    return asyncio.create_task(runner())


tv = _TVProxy()
installed = _StateProxy("installed")
playing = _StateProxy("playing")
media_now = _StateProxy("media_now")
seen_playing = _StateProxy("seen_playing")
sleep = _StateProxy("sleep")
waking = _StateProxy("waking")
picture_state = _StateProxy("picture")
asks = {}  # ask id -> list of actions Claude took through the MCP tools

# Extra screens the TV can open (for example a computer through Moonlight). Empty by default;
# see "screens" in config.example.json. Each: {"id", "name", "kind": "moonlight", "package"}.
SCREENS = [dict({"package": "com.limelight", "kind": "moonlight"}, **s) for s in config.SCREENS]


def now_iso():
    return datetime.now(HOME_TZ).isoformat(timespec="seconds")


def cur_who():
    """Who is on the couch at the TV this request or loop is for (each TV keeps its own)."""
    return store.current_who(_current.get())


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def ok(**fields):
    return web.json_response({"ok": True, **fields})


def lan_ipv4():
    """This computer's home network IPv4 (a UDP connect sends nothing, it only picks the route)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))   # a documentation address: never sent, only routed
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def host_name(value):
    """The name or address in a Host header or a config entry, lower case, without the port, the
    IPv6 brackets or a trailing dot ("My-Computer.local:5400" -> "my-computer.local", "[::1]:5400" -> "::1")."""
    value = str(value or "").strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    try:
        return (urllib.parse.urlsplit(f"//{value}").hostname or "").rstrip(".")
    except ValueError:
        return ""


def is_ip(name):
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def allowed_hosts():
    """Names and addresses the bridge answers to (Host header check and CORS)."""
    hosts = {"127.0.0.1", "localhost", "::1"}
    for h in [config.BRIDGE.get("host")] + list(config.BRIDGE.get("fallback_hosts") or []):
        h = host_name(h)
        if h:
            hosts.add(h)
    ip = lan_ipv4()
    if ip:
        hosts.add(ip)
    try:
        h = host_name(socket.gethostname())
        if h:
            hosts.add(h)
            hosts.add(h if h.endswith(".local") else f"{h}.local")
    except OSError:
        pass
    return hosts


def is_allowed_host(request):
    """DNS rebinding guard (couch-tv#73). A rebinding page reaches the bridge under the attacker's own
    name, so a Host the bridge does not know is refused. Any IP address passes (rebinding needs a
    name; this also covers a computer with two network connections, and Docker), and so does any
    .local name (only the home network answers for those). No Host header at all is a script, not a
    browser, so it passes too."""
    raw = request.headers.get("Host")
    if raw is None:
        return True
    name = host_name(raw)
    if not name:
        return False
    return is_ip(name) or name.endswith(".local") or name in allowed_hosts()


def is_allowed_origin(request, origin):
    """Origin allowlist for CORS (couch-tv#73): the bridge's own origins and TV front-end origins."""
    if not origin:
        return False
    clean = origin.rstrip("/").lower()
    # 1. Front-end origins used by the TV apps:
    # "null" is sent by browsers for local file:// WebViews (Android WebView, webOS, Tizen).
    # NOTE: Because any website can emit Origin: null (e.g. from a sandboxed iframe),
    # Origin: null is allowed for the TV apps, but only the pairing key (config.PAIRING_KEY)
    # protects against malicious websites sending Origin: null.
    # "file://" is sent literally by some embedded Chromium / WebViews.
    # "http(s)://home.tvos.invalid" is used by couch-tv's Android TV offline launcher.
    if clean == "null" or clean.startswith("file:") or clean in ("http://home.tvos.invalid", "https://home.tvos.invalid"):
        return True
    if clean.startswith(("widget:", "wgt:", "tizen:")):
        return True

    # 2. Bridge's own origins: the page came from the very address this request went to (the Host
    # header passed the DNS rebinding check), or one of the bridge's known names.
    hosts = allowed_hosts()
    try:
        parsed = urllib.parse.urlsplit(clean)
        host_hdr = (request.headers.get("Host") or "").strip().lower() if request is not None else ""
        if parsed.scheme in ("http", "https") and host_hdr and parsed.netloc == host_hdr and is_allowed_host(request):
            return True
        if parsed.scheme in ("http", "https"):
            parsed_host = (parsed.hostname or "").lower()
            parsed_port = parsed.port or (443 if parsed.scheme == "https" else 80)
            allowed_ports = {PORT, 5173, 5400}
            if request and hasattr(request, "url") and request.url.port:
                allowed_ports.add(request.url.port)
            if parsed_host in hosts and parsed_port in allowed_ports:
                return True
    except Exception:
        pass

    return False


def extract_auth_key(request):
    """Extract pairing/API key from Authorization header, X-API-Key, or ?key= / ?token=."""
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if token:
            return token
    api_key = (request.headers.get("X-API-Key") or "").strip()
    if api_key:
        return api_key
    q_key = (request.query.get("key") or request.query.get("token") or "").strip()
    if q_key:
        return q_key
    return None


def is_authed(request):
    if not config.PAIRING_KEY:
        return True
    key = extract_auth_key(request)
    if not key:
        return False
    return key_matches(key)


def key_matches(given):
    # bytes, so a key with non-ASCII characters is simply wrong instead of a 500
    return hmac.compare_digest(str(given).encode(), config.PAIRING_KEY.encode())


# Wrong pairing keys, per client address: {ip: [(time, fingerprint of the wrong key), ...]}.
# Only DIFFERENT wrong keys count, so a phone or TV still holding an old key after the key changed
# (polling every few seconds) never locks itself out, while guessing is limited to 5 keys a minute.
# The address is the TCP peer (aiohttp's request.remote); X-Forwarded-For is never read.
_failed_attempts = {}
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 60.0
RATE_LIMIT_ADDRESSES = 1000   # memory bound: at most this many addresses are remembered


def client_ip(request):
    """The address to rate limit, or None for the computer itself (the MCP server, Claude, scripts:
    anything on the bridge computer can read config.json anyway, and a local reverse proxy would
    otherwise let one wrong key lock everyone out)."""
    ip = (getattr(request, "remote", None) or "").removeprefix("::ffff:")
    if not ip:
        return None
    try:
        if ipaddress.ip_address(ip).is_loopback:
            return None
    except ValueError:
        pass
    return ip


def _recent(ip, now):
    cutoff = now - RATE_LIMIT_WINDOW
    return [a for a in _failed_attempts.get(ip, []) if a[0] > cutoff]


def is_rate_limited(ip, now=None):
    if not ip:
        return False
    now = time.time() if now is None else now
    recent = _recent(ip, now)
    if recent:
        _failed_attempts[ip] = recent
    else:
        _failed_attempts.pop(ip, None)
    return len(recent) >= RATE_LIMIT_MAX


def record_failed_attempt(ip, key, now=None):
    if not ip:
        return
    now = time.time() if now is None else now
    fp = hashlib.sha256(str(key).encode("utf-8", "replace")).hexdigest()[:16]
    recent = _recent(ip, now)
    if any(a[1] == fp for a in recent):
        return                      # the same wrong key again: an old key, not a guess
    recent.append((now, fp))
    _failed_attempts.pop(ip, None)
    _failed_attempts[ip] = recent   # newest last, so the oldest go first below
    if len(_failed_attempts) > RATE_LIMIT_ADDRESSES:
        for k in list(_failed_attempts):
            if not _recent(k, now):
                _failed_attempts.pop(k, None)
        while len(_failed_attempts) > RATE_LIMIT_ADDRESSES:
            _failed_attempts.pop(next(iter(_failed_attempts)))


async def body(request):
    if not request.body_exists:
        return {}
    try:
        data = await request.json()
    except Exception:
        raise ApiError(400, "body must be JSON")
    if not isinstance(data, dict):
        raise ApiError(400, "body must be a JSON object")
    return data


def record_action(request, tool, args, success):
    ask_id = request.headers.get("X-Ask-Id")
    if ask_id and ask_id in asks:
        asks[ask_id].append({"tool": tool, "args": args, "ok": success})


# ---------- middleware: CORS + errors ----------
# /api/vidaa/claim swaps a one time code for the key (below), so it cannot need the key itself.
# The Spotify login (bridge/spotify_now.py) is opened in a browser on the bridge computer, and Spotify's
# redirect back can't carry the pairing key: it is guarded by _loopback_only and a one-time state instead.
OPEN_PATHS = {"/api/health", "/api/pair", "/api/vidaa/claim", "/api/appletv/claim",
              "/api/spotify/login", "/api/spotify/callback"}


@web.middleware
async def middleware(request, handler):
    # 1. Host header validation against DNS rebinding (couch-tv#73)
    if not is_allowed_host(request):
        return web.Response(status=403, text=(
            "forbidden host: the couch-tv bridge does not know the name this page was opened by. "
            "Open it by the computer's number address or its .local name, or add this name to "
            "bridge.fallback_hosts in config.json and restart the bridge."))

    # 2. Origin check: requests from disallowed origins must not run (couch-tv#73)
    origin = request.headers.get("Origin")
    origin_ok = is_allowed_origin(request, origin) if origin else False
    if origin and not origin_ok:
        return web.Response(status=403, text="forbidden origin")

    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            # 3. Refuse POST without application/json (couch-tv#73)
            if request.method == "POST" and request.content_type != "application/json":
                raise ApiError(415, "Content-Type must be application/json")

            # 4. Check pairing key authentication & rate limiting for protected API endpoints (couch-tv#73)
            path = request.path
            is_api = path.startswith("/api/")
            if is_api and path not in OPEN_PATHS and config.PAIRING_KEY:
                ip = client_ip(request)
                if is_rate_limited(ip):
                    raise ApiError(429, "Too many wrong pairing keys. Please wait a minute.")
                key = extract_auth_key(request)
                if key:
                    if not key_matches(key):
                        record_failed_attempt(ip, key)
                        await asyncio.sleep(0.3)
                        raise ApiError(401, "invalid pairing key")
                else:
                    raise ApiError(401, "pairing key required")

            tv_id = request.query.get("tv")
            if not tv_id and request.method == "POST" and request.body_exists:
                try:
                    data = await request.json()  # aiohttp keeps the body, handlers read it again
                    tv_id = data.get("tv") if isinstance(data, dict) else None
                except Exception:
                    tv_id = None
            tv_id = tv_id or DEFAULT_TV
            if tv_id not in TVS:
                raise ApiError(400, f"unknown tv: {tv_id} (try {', '.join(TVS)})")
            _current.set(tv_id)
            resp = await handler(request)
        except ApiError as e:
            resp = web.json_response({"ok": False, "error": e.message}, status=e.status)
        except TVUnavailable as e:
            resp = web.json_response({"ok": False, "error": str(e)}, status=503)
        except ValueError as e:
            resp = web.json_response({"ok": False, "error": str(e)}, status=400)
        except web.HTTPException:
            raise
        except Exception as e:
            log.exception("handler failed")
            resp = web.json_response({"ok": False, "error": f"bridge error: {e}"}, status=500)

    # Set CORS headers only when origin is allowed (couch-tv#73)
    if origin and origin_ok:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Ask-Id, Authorization, X-API-Key"
        resp.headers["Vary"] = "Origin"
    return resp


# ---------- state ----------
async def _refresh_installed():
    try:
        pk = await tv.installed_packages()
    except Exception:
        pk = None
    if pk:
        installed["packages"], installed["checked"] = pk, time.time()


async def installed_packages(max_age=1800, wait=True):
    """Installed apps from ADB, cached. wait=False never blocks a request: it answers from the
    cache (or None) and refreshes in the background."""
    stale = installed["packages"] is None or time.time() - installed["checked"] > max_age
    if stale:
        if wait or installed["packages"] is None and not installed.get("task"):
            task = installed.get("task")
            if not task or task.done():
                task = installed["task"] = asyncio.ensure_future(_refresh_installed())
            if wait:
                await task
        elif not installed.get("task") or installed["task"].done():
            installed["task"] = asyncio.ensure_future(_refresh_installed())
    return installed["packages"]


def is_installed(app):
    pk = installed["packages"]
    if app["id"] in ("home", "settings"):
        return True
    return None if pk is None else app["package"] in pk


def now_payload():
    pkg = tv.current_package
    item = playing["item"]
    if item and pkg and pkg != item.get("package"):
        playing["item"] = item = None
    out_playing = None
    if item:
        out_playing = {k: v for k, v in item.items() if k not in ("package", "ts", "who")} | {"source": "bridge"}
    if media_now and media_now.get("package") == pkg:
        live = {"state": media_now["state"], "position_ms": media_now["position_ms"],
                "updated": datetime.fromtimestamp(media_now["read_at"], HOME_TZ).isoformat(
                    timespec="milliseconds")}
        if out_playing:
            out_playing |= live
            out_playing.setdefault("duration_ms", None)
            out_playing.setdefault("duration_source", None)
            if media_now.get("title_from") == "app" and media_now.get("season"):
                # The app now reports a matched episode (it may have moved on from ours).
                out_playing |= {k: media_now[k] for k in ("season", "episode", "episode_title",
                                                          "duration_ms", "duration_source")}
        elif media_now.get("title") or media_now["state"] in ("playing", "paused", "buffering"):
            out_playing = {"title": media_now.get("title"),
                           "episode_title": media_now.get("episode_title"),
                           "season": media_now.get("season"), "episode": media_now.get("episode"),
                           "duration_ms": media_now.get("duration_ms"),
                           "duration_source": media_now.get("duration_source"),
                           "service": (apps.describe_package(pkg) or {}).get("id"),
                           "poster": media_now.get("poster"), "backdrop": media_now.get("backdrop"),
                           "source": "tv"} | live
    on = tv.is_on
    idle_st = _paused_idle_state()
    return {
        "tv_connected": tv.connected,
        "adb": tv.adb_ok,
        "power": "unknown" if on is None else ("on" if on else "off"),
        "app": apps.describe_package(pkg),
        "volume": tv.volume,
        "playing": out_playing,
        "sleep": {"ends": sleep["ends"]},
        "idle": {"ends": idle_st["ends"], "reason": "paused"} if idle_st.get("ends") else None,
        "waking": waking["on"],
        "who": cur_who(),
        "picture": picture_state.get("mode"),
    }


# ---------- handlers ----------
async def h_health(request):
    authed = is_authed(request)
    return ok(
        tv_connected=tv.connected,
        adb=tv.adb_ok,
        version="1",
        auth="ok" if authed else "required",
        paired=authed,
    )


async def h_pair(request):
    b = await body(request)
    given = str(b.get("key") or "").strip()
    if not config.PAIRING_KEY:
        return ok(paired=True, note="no pairing key required")
    # Checked after the body is read, with no await before the key is compared and the miss is
    # recorded: checked before it, parallel requests could all pass while their bodies arrive.
    ip = client_ip(request)
    if is_rate_limited(ip):
        raise ApiError(429, "Too many wrong pairing keys. Please wait a minute.")
    if not given:
        raise ApiError(400, "pairing key is required")
    if not key_matches(given):
        record_failed_attempt(ip, given)
        await asyncio.sleep(0.3)
        raise ApiError(401, "That pairing key is not right. Check config.json.")
    return ok(paired=True, token=config.PAIRING_KEY, note="paired")


async def h_bridge_shim(request):
    if not os.path.isfile(SHIM_PATH):
        raise web.HTTPNotFound()
    return web.FileResponse(SHIM_PATH, headers={"Cache-Control": "no-cache", "Content-Type": "application/javascript"})


async def h_now(request):
    return ok(**now_payload())


events_clients = set()


def push_now():
    """Send /api/now to everyone watching the current TV's events."""
    tv_id = _current.get()
    payload = "event: now\ndata: " + json.dumps({"ok": True, **now_payload()}) + "\n\n"
    for q, qtv in list(events_clients):
        if qtv == tv_id and q.qsize() < 20:
            q.put_nowait(payload)


async def h_events(request):
    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    origin = request.headers.get("Origin")
    if origin and is_allowed_origin(request, origin):   # sent before the middleware sees it (#73)
        headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
    resp = web.StreamResponse(headers=headers)
    await resp.prepare(request)
    q = asyncio.Queue()
    entry = (q, _current.get())
    events_clients.add(entry)
    try:
        await resp.write(("event: now\ndata: " + json.dumps({"ok": True, **now_payload()}) + "\n\n").encode())
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=20)
            except asyncio.TimeoutError:
                msg = ": keepalive\n\n"
            await resp.write(msg.encode())
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        events_clients.discard(entry)
    return resp


async def h_key(request):
    data = await body(request)
    key = data.get("key")
    if not key:
        raise ApiError(400, "key is required")
    _reset_paused_idle()
    await tv.key(str(key), hold=bool(data.get("hold")))
    record_action(request, "key", {"key": key}, True)
    return ok(key=key)


async def h_pointer(request):
    """LG only: move the TV's pointer ({"dx", "dy"}), click ({"click": true}) or scroll ({"scroll": dy})."""
    data = await body(request)
    if not hasattr(tv, "pointer"):
        raise ApiError(400, "only an LG TV has a pointer")
    tv.require()
    clamp = lambda v: max(-400, min(400, int(v or 0)))
    await tv.pointer(clamp(data.get("dx")), clamp(data.get("dy")), bool(data.get("click")), clamp(data.get("scroll")))
    return ok()


async def h_text(request):
    data = await body(request)
    text = data.get("text")
    if not isinstance(text, str) or not text:
        raise ApiError(400, "text is required")
    await tv.text(text)
    record_action(request, "text", {"text": text}, True)
    return ok()


async def h_apps(request):
    await installed_packages(wait=False)
    out = []
    for a in apps.APPS:
        inst = is_installed(a)
        out.append(apps.public(a, inst) | {"installed": inst})
    return ok(apps=out)


async def launch_app(app):
    method = await tv.launch_package(app["package"])
    got = await tv.wait_for_app({app["package"]}, timeout=8)
    if not got and app["id"] == "home":
        await tv.key("home")
        got = app["package"]
    return got, method


async def h_launch(request):
    data = await body(request)
    target = data.get("app")
    if not target or not isinstance(target, str):
        raise ApiError(400, "app is required")
    if "://" in target:
        await tv.start_intent(target)
        await asyncio.sleep(2)
        record_action(request, "launch", {"app": target}, True)
        return ok(app=apps.describe_package(tv.current_package))
    if target in ("bluetooth", "network") and hasattr(tv, "open_settings_screen"):
        try:
            await tv.open_settings_screen(target)
            record_action(request, "launch", {"app": target}, True)
            return ok(app=target)
        except TVUnavailable as e:
            raise ApiError(503, str(e))
        except Exception as e:
            raise ApiError(500, f"could not open {target} settings: {e}")
    app = apps.BY_ID.get(target) or apps.BY_PACKAGE.get(target)
    if app is None:
        if "." not in target:
            raise ApiError(400, f"unknown app: {target}")
        app = {"id": None, "name": target, "package": target}
    if app.get("id") == "home":
        await tv.key("home")
        record_action(request, "launch", {"app": "home"}, True)
        return ok(app=apps.describe_package(app["package"]))
    got, _ = await launch_app(app)
    record_action(request, "launch", {"app": target}, bool(got))
    if not got:
        await installed_packages(max_age=0)
        if installed["packages"] is not None and app["package"] not in installed["packages"]:
            raise ApiError(404, f"{app['name']} is not installed on the TV")
        raise ApiError(504, f"asked the TV to open {app['name']} but it did not come up")
    return ok(app=apps.describe_package(got))


async def h_find(request):
    title = request.query.get("title", "").strip()
    if not title:
        raise ApiError(400, "title is required")
    await installed_packages()
    best, others = await finder.find(title, request.query.get("type"))
    if not best:
        raise ApiError(404, f"could not find {title}")
    return ok(result=public_result(best), others=others)


def public_result(best):
    provs = []
    for p in best["providers"]:
        app = apps.BY_ID.get(p["service"])
        inst = is_installed(app) if app else False
        provs.append({"service": p["service"], "name": p["name"], "kind": p["kind"],
                      "playable": bool(p["playable"] and inst is not False)})
    return {k: best[k] for k in ("title", "year", "type", "poster", "backdrop", "overview")} | {"providers": provs}


SEARCH_LINKS = {
    # App search pages that open by link, tested on this TV (DEEPLINKS.md).
    "netflix": "https://www.netflix.com/search?q={q}",
    "youtube": "https://www.youtube.com/results?search_query={q}",
}


# Apps not on JustWatch that open a title's page by its IMDb id, tested on this TV (DEEPLINKS.md).
# Nuvio takes only the show or film: "nuvio://series/tt22202452:1:8" is read as one id and fails.
TITLE_LINKS = {
    "nuvio": "nuvio://{type}/{imdb}",
}


def title_link(app, best):
    """The app's own link to the title's page, or None."""
    link = TITLE_LINKS.get(app["id"])
    imdb = (best or {}).get("imdb") or ""
    if not link or not re.fullmatch(r"tt\d+", imdb):
        return None
    return link.format(type="series" if best.get("type") == "tv" else "movie", imdb=imdb)


async def search_in_app(app, title, best=None):
    """Open the app on the title's page or its search with the title typed in, or just the app."""
    from urllib.parse import quote
    link = title_link(app, best) if tv.kind == "android" else None
    # Only over ADB, which pins the link to the app's own package (-p). The remote-link fallback
    # in start_intent would hand a nuvio:// link to whichever app claims it.
    if link and not await tv.adb_ready():
        link = None
    if link:
        try:
            await tv.start_intent(link, app["package"])
            if await tv.wait_for_app({app["package"]}, timeout=8):
                return "deeplink", f"Opened the {title} page in {app['name']}."
        except Exception as e:
            log.warning("title link failed for %s: %s", app["id"], e)
    link = SEARCH_LINKS.get(app["id"]) if tv.kind == "android" else None
    if link:
        await tv.start_intent(link.format(q=quote(title)), app["package"])
        if await tv.wait_for_app({app["package"]}, timeout=8):
            return "search", f"Opened {app['name']} search for {title}."
    # Google TV's own search (GLOBAL_SEARCH) only shows a stuck search bar on this TV, so the
    # fallback is the app itself (DEEPLINKS.md).
    got, _ = await launch_app(app)
    return "app", f"Opened {app['name']}. Search for {title} on the TV."


def resume_link(app_id, link, title):
    """The show's own page instead of an episode. JustWatch's show links for some apps point at
    season 1 episode 1 (Apple TV "failures-contagious", Paramount+ "stick-or-twist", Prime
    "watch...time=0"), so a Keep watching card started the show over. The
    app's show page knows where each person is up to and offers Resume on that episode."""
    import re
    from urllib.parse import parse_qs, urlparse
    slug = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-") or "show"
    if app_id == "apple-tv":
        m = re.search(r"[?&]showId=([^&#]+)", link or "")
        if m:
            return f"intent://tv.apple.com/{config.COUNTRY.lower()}/show/{slug}/{m.group(1)}#Intent;launchFlags=0x00800000;scheme=https;end"
    if app_id == "paramount-plus":
        m = re.search(r"www\.paramountplus\.com/shows/([^/#?]+)/video/", link or "")
        if m:
            return f"intent://www.paramountplus.com/shows/{m.group(1)}/#Intent;scheme=pplusintl;end"
    if app_id == "prime-video" and "app.primevideo.com/watch?" in (link or ""):
        gti = parse_qs(urlparse(link.replace("intent://", "https://", 1)).query).get("gti")
        if gti:
            return (f"intent://app.primevideo.com/detail?gti={gti[0]}&territory={config.COUNTRY}"
                    "#Intent;package=com.amazon.amazonvideo.livingroom;scheme=https;end")
    return link


async def play(title, season=None, episode=None, service=None, who=None, resume=False):
    await installed_packages()
    best, _ = await finder.find(title)
    if not best:
        raise ApiError(404, f"could not find {title}")
    providers = best["providers"]
    ep_info = None
    if season and best["type"] == "tv":
        try:
            ep_info = await finder.episode_providers(best["jw_id"], int(season),
                                                     int(episode) if episode else None)
        except Exception as e:
            log.warning("episode lookup failed: %s", e)

    def usable(p):
        app = apps.BY_ID.get(p["service"])
        return app and p["playable"] and is_installed(app) is not False

    candidates = [p for p in providers if usable(p)]
    if service:
        candidates = [p for p in candidates if p["service"] == service]
        if not candidates:
            app = apps.BY_ID.get(service)
            if not app:
                raise ApiError(400, f"unknown service: {service}")
            # Not listed by JustWatch on that service: open it and search.
            method, note = await search_in_app(app, best["title"], best)
            return finish_play(best, app, method, note, season, episode, who, ep_info)
    if not candidates:
        where = ", ".join(p["name"] for p in providers) or f"nowhere in {config.COUNTRY_NAME} right now"
        raise ApiError(404, f"{best['title']} is not on any app on this TV (streams on: {where})")

    pick = candidates[0]
    app = apps.BY_ID[pick["service"]]
    link = pick["deeplink"]
    if pick["kind"] in ("rent", "buy") and (pick.get("web") or "").startswith("https://"):
        # Never jump straight into a paid "watch" link: open the store page so a person decides.
        link = pick["web"]
    if app.get("use_web") and pick.get("web"):
        import re
        m = re.match(app["use_web"], pick["web"])
        if m:
            link = m.group(1)
    note = "Opened the show page."
    if ep_info:
        ep_link = next((p["deeplink"] for p in ep_info["providers"] if p["service"] == app["id"]), None)
        if ep_link:
            link, note = ep_link, f"Opened season {season} episode {ep_info['episode']}."
        else:
            note = f"Opened the show page. Season {season} is picked on the TV."
    elif season:
        note = f"Opened the show page. Season {season} is picked on the TV."
    elif resume and best["type"] == "tv":
        link = resume_link(app["id"], link, best["title"])

    method, started = None, None
    if app["deeplink"] == "jw" and link and tv.can_deeplink(app):
        cold = app.get("cold")
        if cold == "background":
            cold = await tv.front_package() != app["package"]
        try:
            extra = {"media_type": "series" if best["type"] == "tv" else "movie"} if tv.kind == "roku" else {}
            await tv.start_intent(link, app["package"], cold=bool(cold), **extra)
            if await tv.wait_for_app({app["package"]}, timeout=10):
                method = "deeplink"
        except Exception as e:
            log.warning("deep link failed for %s: %s", app["id"], e)
        if method and tv.can_read_media:
            started, picked = await get_it_playing(app, link, who or cur_who())
            log.info("play %s in %s: %s%s", best["title"], app["name"],
                     "playing" if started else "not playing yet", f" (profile {picked})" if picked else "")
            if started:
                note = f"{best['title']} is playing in {app['name']}" + (f", on {picked}'s profile." if picked else ".")
            else:
                note = (f"{app['name']} is open on {best['title']}, but it has not started playing. "
                        "Press OK on the remote to start it.")
    if method and tv.kind == "samsung" and app["id"] == "netflix":
        note = f"Opened {best['title']} in Netflix and pressed Play. If it is not playing, press OK on the remote."
    if method is None and tv.kind == "samsung" and pick.get("tizen"):
        # Samsung's own title link, handed over by the couch-tv app on the TV (samsung.py open_title)
        try:
            if await tv.open_title(app, pick["tizen"]):
                method = "deeplink"
                note = (f"Opened {best['title']} in {app['name']} and pressed Play. If it is not playing, "
                        "press OK on the remote.")
        except Exception as e:
            log.warning("samsung title link failed for %s: %s", app["id"], e)
    if method is None:
        method, note = await search_in_app(app, best["title"], best)
    result = finish_play(best, app, method, note, season, episode, who)
    if started is not None:
        result["started"] = started
    return result


async def h_tizen_next(request):
    """The couch-tv app on a Samsung TV asks here (long poll) for jobs only it can do."""
    if tv.kind != "samsung":
        raise ApiError(400, "only for Samsung TVs")
    return ok(job=await tv.tizen_next())


async def h_webos_apps(request):
    """The couch-tv app on an LG TV asks here for the TV's apps (webOS may not tell the app)."""
    if tv.kind != "lg":
        raise ApiError(400, "only for LG TVs")
    return ok(apps=await tv.apps_on_tv())


async def h_roku_apps(request):
    """The couch-tv channel on a Roku asks here for the Roku's channels, in the order arranged from the
    phone (the Roku has no app list a channel may read). Each has "icon", the bridge's copy of the Roku's
    own icon, and "logo", true when the channel has a bundled one named after "package"."""
    if tv.kind != "roku":
        raise ApiError(400, "only for Roku TVs")
    tv.require()
    listed = await tv.apps_on_tv()
    saved, _, was_saved = effective_order()
    rank = {a["package"]: i for i, a in enumerate(saved)} if was_saved else {}
    known = {a["package"]: i for i, a in enumerate(apps.APPS)}
    listed.sort(key=lambda c: (rank.get(c["package"], 9999), known.get(c["package"], 9999), c["title"].lower()))
    tv_q = "" if _current.get() == DEFAULT_TV else "?tv=" + _current.get()
    return ok(apps=[{"id": c["id"], "title": c["title"], "package": c["package"],
                     "icon": f"/api/roku/icon/{c['id']}{tv_q}"} for c in listed])


async def h_roku_icon(request):
    if tv.kind != "roku":
        raise ApiError(400, "only for Roku TVs")
    try:
        data, kind = await tv.icon(request.match_info["id"])
    except (roku.RokuError, ValueError, TVUnavailable) as e:
        raise ApiError(404, str(e))
    return web.Response(body=data, content_type=kind.split(";")[0], headers={"Cache-Control": "max-age=86400"})


async def h_vega_keys(request):
    """The couch-tv app on a Vega stick asks here for the phone remote's keys (a long poll: it waits up to
    20 seconds for a key, and the asking is how the bridge knows the page is in front). Vega has no way
    for the network to press a key, so the page presses them on itself (tv-home/web/vega.js)."""
    if tv.kind != "vega":
        raise ApiError(400, "only for Fire TV on Vega OS")
    try:
        after = int(request.query.get("after") or 0)
    except ValueError:
        raise ApiError(400, "after must be a number")
    keys, last = await tv.next_keys(after, timeout=20.0)
    return ok(keys=keys, last=last)


async def h_vidaa_pair(request):
    """VIDAA pairing: {} asks the TV to show its PIN, {"pin": "1234"} sends it back (docs/VIDAA.md)."""
    if tv.kind != "vidaa":
        raise ApiError(400, "only for VIDAA TVs")
    data = await body(request)
    pin = data.get("pin")
    if pin is None:
        await tv.pair_start()
        return ok(step="pin", note="The TV should now show a 4 digit PIN. Send it as {\"pin\": \"1234\"}.")
    if not isinstance(pin, (str, int)) or not vidaa.PIN.match(str(pin).strip()):
        raise ApiError(400, "pin is the 4 digits the TV shows")
    try:
        await tv.pair_finish(str(pin).strip())
    except vidaa.VidaaError as e:
        raise ApiError(409, str(e))
    return ok(paired=True)


async def h_appletv_pair(request):
    """Apple TV pairing: {} asks the Apple TV to show its PIN, {"pin": "1234"} sends it back (docs/APPLE-TV.md)."""
    if tv.kind != "appletv":
        raise ApiError(400, "only for Apple TVs")
    data = await body(request)
    pin = data.get("pin")
    try:
        if pin is None:
            await tv.pair_start()
            return ok(step="pin", note="The Apple TV should now show a 4 digit PIN. Send it as {\"pin\": \"1234\"}.")
        if not isinstance(pin, (str, int)) or not re.fullmatch(r"\d{4}", str(pin).strip()):
            raise ApiError(400, "pin is the 4 digits the Apple TV shows")
        await tv.pair_finish(str(pin).strip())
    except appletv.AppleTVError as e:
        raise ApiError(409, str(e))
    return ok(paired=True)


# ---------- couch-tv's own app on an Apple TV (tvos/, docs/APPLE-TV.md) ----------
# The app finds the bridge on the network by itself (Bonjour, _couchtv._tcp). When the bridge has a pairing
# key, the app asks for it once: someone gets a six digit code (scripts/appletv-home-code.py, or POST
# /api/appletv/code from the phone remote) and types it on the Apple TV, which swaps it here for the key.
APPLETV_CODE_SECS = 600
appletv_codes = {}          # code -> (runs out at, monotonic; tv id)


def _need_appletv():
    if tv.kind != "appletv":
        raise ApiError(400, "only for Apple TVs (add ?tv=<the Apple TV's id>)")


async def h_appletv_code(request):
    """A six digit code for couch-tv's Apple TV app, good once, for ten minutes. Needs the pairing key."""
    _need_appletv()
    now = time.monotonic()
    for c, (exp, _) in list(appletv_codes.items()):
        if exp <= now:
            appletv_codes.pop(c, None)
    while True:
        code = f"{secrets.randbelow(10 ** 6):06d}"
        if code not in appletv_codes:
            break
    appletv_codes[code] = (now + APPLETV_CODE_SECS, _current.get())
    return ok(code=code, expires_in=APPLETV_CODE_SECS, tv=_current.get())


async def h_appletv_claim(request):
    """Open path: the Apple TV app swaps a six digit code for the pairing key, once. Wrong codes count
    towards the same rate limit as a wrong key."""
    data = await body(request)
    code = str(data.get("code") or "").strip()
    ip = client_ip(request)
    if is_rate_limited(ip):
        raise ApiError(429, "Too many wrong codes. Please wait a minute.")
    found = appletv_codes.pop(code, None) if re.fullmatch(r"\d{6}", code) else None
    if not found or found[0] <= time.monotonic() or found[1] not in TVS:
        record_failed_attempt(ip, code)
        await asyncio.sleep(0.3)
        raise ApiError(401, "that code is not valid (a code works once, for ten minutes)")
    t = TVS[found[1]]
    return ok(key=config.PAIRING_KEY, tv=found[1], name=t.name)


def appletv_for(named, ip):
    """Which Apple TV a request is about: the one named (?tv=), else the one at the address the request
    came from, else the first in config.json. None when config.json has no Apple TV."""
    tvs = [i for i, t in TVS.items() if t.kind == "appletv"]
    if named in tvs:
        return named
    for i in tvs:
        if ip and ip in (TVS[i].ip, TVS[i].fallback_ip):
            return i
    return tvs[0] if tvs else None


async def h_appletv_hello(request):
    """The Apple TV app's first question: which TV am I. It needs the key, so it also checks the key."""
    tv_id = appletv_for(request.query.get("tv"), (getattr(request, "remote", None) or "").removeprefix("::ffff:"))
    if not tv_id:
        raise ApiError(404, "no Apple TV in config.json (docs/APPLE-TV.md)")
    t = TVS[tv_id]
    return ok(tv=tv_id, name=t.name, home_bundle=t.home_bundle(), dock_max=DOCK_MAX)


async def h_appletv_apps(request):
    """The apps on this Apple TV for couch-tv's app, in the order arranged from the phone, without couch-tv
    itself. "id" is the bundle id; "package" names the bundled logo when couch-tv knows the app."""
    _need_appletv()
    tv.require()
    listed = await tv.apps_on_tv()
    saved, line, was_saved = effective_order()
    rank = {a["package"]: i for i, a in enumerate(saved)} if was_saved else {}
    known = {a["package"]: i for i, a in enumerate(apps.APPS)}
    listed = sorted(listed, key=lambda c: (rank.get(c["package"], 9999), known.get(c["package"], 9999), c["title"].lower()))
    return ok(apps=[{"id": c["id"], "title": c["title"], "package": c["package"]} for c in listed],
              line=line if was_saved else DOCK_MAX, dock_max=DOCK_MAX)


async def h_appletv_open(request):
    """Open an app on the Apple TV by its bundle id. A tvOS app cannot open another app by its id, so
    couch-tv's app asks here and the bridge asks the Apple TV over the Companion link."""
    _need_appletv()
    data = await body(request)
    bundle = data.get("bundle")
    if not isinstance(bundle, str) or not appletv.BUNDLE_RE.fullmatch(bundle):
        raise ApiError(400, "bundle is an app's bundle id, for example com.netflix.Netflix")
    tv.require()
    kid = _kid_on_appletv(None)
    if kid:
        # kids mode: only the apps on that child's list, whatever the app on the Apple TV asks for
        await tv.refresh_installed()
        if bundle not in {a["id"] for a in appletv_kids_apps(kids.mode(kid))}:
            raise ApiError(403, "Kids mode is on: that app is not on this child's list.")
    try:
        await tv.open_bundle(bundle)
    except appletv.AppleTVError as e:
        raise ApiError(502, f"the Apple TV would not open {bundle}: {e}")
    record_action(request, "launch", {"app": bundle}, True)
    return ok(opened=bundle)


# ---------- kids mode in couch-tv's Apple TV app (bridge/kids.py, docs/APPLE-TV.md "Kids mode") ----------
def _kid_on_appletv(named):
    """The kids profile named (or, with none named, the person watching this Apple TV), or None."""
    pid = store.norm_who(named) if named else cur_who()
    return pid if pid and pid != "both" and kids.is_kid(pid) else None


def appletv_kids_apps(m):
    """A kids profile's allowed apps as apps on this Apple TV: [{id: bundle id, title, package}]. Apps the
    Apple TV does not have are left out, and so are Settings, the App Store and couch-tv itself."""
    names = {c["id"]: c["title"] for c in tv.channels}
    mine = tv.home_bundle()
    out = []
    for pkg in (m or {}).get("apps") or []:
        b = tv.bundle_for(pkg)
        if not b or b in appletv.NOT_FOR_KIDS or b == mine or b.startswith(appletv.HOME_BUNDLE) \
                or any(a["id"] == b for a in out):
            continue
        app = apps.BY_PACKAGE.get(pkg) or apps.BY_ID.get(pkg)
        out.append({"id": b, "title": names.get(b) or (app["name"] if app else b),
                    "package": tv.ids.get(b) or (app["package"] if app else f"appletv.{b}")})
    return out[:kids.MAX_APPS]


async def h_appletv_kids(request):
    """Kids mode for couch-tv's Apple TV app. For the person watching this Apple TV (or ?who=): when they are a
    kids profile, their shelf (with posters and each show's app on this Apple TV), the apps they may open and
    the parent PIN's salted hash, which the app checks a typed PIN against. Never the PIN. Anyone else:
    {"kids": false}."""
    _need_appletv()
    pid = _kid_on_appletv(request.query.get("who"))
    if not pid:
        return ok(kids=False, who=store.norm_who(request.query.get("who")) or cur_who())
    m = kids.mode(pid)
    await kids.enrich(m["shows"], finder.find)
    pub = kids.public_mode(m)
    await tv.refresh_installed()
    shows = []
    for s in pub["shows"]:
        show = {k: s[k] for k in ("id", "title", "season", "episode", "poster", "backdrop") if k in s}
        app = s.get("app")
        if app:
            show["app"] = {**app}
            bundle = tv.bundle_for(app["package"])
            if bundle:
                show["app"]["bundle"] = bundle
        shows.append(show)
    name = next((p["name"] for p in config.PEOPLE if p["id"] == pid), pid)
    return ok(kids=True, who=pid, name=name, shows=shows, apps=appletv_kids_apps(m),
              pin_hash=pub["pin_hash"], pin_salt=pub["pin_salt"], pin_rounds=pub["pin_rounds"],
              grown_ups=[p["id"] for p in config.PEOPLE if not kids.is_kid(p["id"])])


async def _appletv_show_link(show):
    """(app id, the link to hand the Apple TV or None, whether the link reaches the episode) for a shelf show. The show's own "link" from
    config.json first, when it is not an Android intent; else JustWatch, the way the TV home's shelf
    chooses: a free or subscription app the Apple TV has, never a rent or buy page."""
    title = show["title"]
    app_id = show.get("service") or (kids.art.get(title.lower()) or {}).get("service")
    own = show.get("link")
    if own and not own.startswith("intent://") and appletv.URL_RE.fullmatch(own):
        return app_id, own, True
    try:
        best, _ = await finder.find(title)
    except Exception as e:
        log.warning("kids: could not look up %s: %s", title, e)
        return app_id, None, False
    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()
    if not best or norm(best.get("title")) != norm(title):
        return app_id, None, False   # a near name is another show
    for p in best.get("providers") or []:
        app = apps.BY_ID.get(p.get("service"))
        if not app or p.get("kind") in ("rent", "buy") or (app_id and p["service"] != app_id):
            continue
        if not tv.bundle_for(app["package"]):
            continue
        if show.get("season") and best.get("jw_id") and appletv.SHOW_LINKS.get(app["id"], (0, 0, False))[2]:
            try:
                ep = await finder.episode_providers(best["jw_id"], int(show["season"]), show.get("episode"))
                eps = [x.get(k) for x in (ep or {}).get("providers") or [] if x.get("service") == app["id"]
                       for k in ("web", "deeplink")]
                link = appletv.show_link(app["id"], *eps, episode=True)
                if link:
                    return app["id"], link, True
            except Exception as e:
                log.warning("kids: episode lookup failed for %s: %s", title, e)
        return app["id"], appletv.show_link(app["id"], p.get("web"), p.get("deeplink")), False
    return app_id, None, False


def _season_words(show):
    return f"season {show['season']}" + (f" episode {show['episode']}" if show.get("episode") else "")


async def h_appletv_kids_open(request):
    """Open a show from a kids profile's shelf on this Apple TV: {who, id}. Only a show on that shelf. Straight
    into the show where the app takes a link (appletv.SHOW_LINKS), else its app on its own page."""
    _need_appletv()
    data = await body(request)
    pid = _kid_on_appletv(data.get("who"))
    if not pid:
        raise ApiError(404, "That is not a kids profile.")
    show = next((s for s in kids.mode(pid)["shows"] if s["id"] == data.get("id")), None)
    if not show:
        raise ApiError(404, "That show is not on the shelf.")
    tv.require()
    await tv.refresh_installed()
    app_id, link, to_episode = await _appletv_show_link(show)
    if link:
        try:
            await tv.open_url(link)
            record_action(request, "kids_open", {"title": show["title"], "how": "link"}, True)
            pick = "" if to_episode or not show.get("season") else f" Pick {_season_words(show)} there."
            return ok(opened="show", note=f"Opening {show['title']}.{pick}")
        except (appletv.AppleTVError, ValueError) as e:
            log.info("kids: the Apple TV would not open the link for %s: %s", show["title"], e)
    app = apps.BY_ID.get(app_id or "")
    if app:
        try:
            await tv.launch_package(app["package"])
            record_action(request, "kids_open", {"title": show["title"], "how": "app"}, True)
            what = show["title"] + (f", {_season_words(show)}" if show.get("season") else "")
            return ok(opened="app", note=f"{app['name']} is open. Pick {what} there.")
        except (TVUnavailable, ValueError) as e:
            log.info("kids: could not open %s for %s: %s", app["id"], show["title"], e)
    raise ApiError(404, f"{show['title']} is not on an app on this Apple TV.")


def _lan_address():
    """This computer's address on the home network (the one its default route uses), or None."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("192.0.2.1", 9))            # nothing is sent: it only picks the route
            ip = sk.getsockname()[0]
        return None if ipaddress.ip_address(ip).is_loopback else ip
    except OSError:
        return None


async def advertise_for_appletv():
    """Say on the network that a couch-tv bridge is here (Bonjour, _couchtv._tcp), so couch-tv's Apple TV
    app finds it without anyone typing an address. Only when an Apple TV is in config.json. The record
    carries the address and port, never the key."""
    if not any(t.kind == "appletv" for t in TVS.values()) or os.environ.get("COUCHTV_NO_BONJOUR"):
        return None
    ip = _lan_address()
    if not ip:
        log.info("bonjour: no network address, the Apple TV app needs the bridge's address typed in")
        return None
    try:
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import AsyncZeroconf
        info = ServiceInfo("_couchtv._tcp.local.", "couch-tv bridge._couchtv._tcp.local.",
                           addresses=[socket.inet_aton(ip)], port=PORT,
                           properties={"ip": ip, "port": str(PORT), "v": "1"})
        zc = AsyncZeroconf()
        await zc.async_register_service(info, allow_name_change=True)
        log.info("bonjour: couch-tv bridge at %s:%s for the Apple TV app", ip, PORT)
        return zc, info
    except Exception as e:
        log.info("bonjour: not advertised (%s), the Apple TV app needs the bridge's address typed in", e)
        return None


async def h_vidaa_tile(request):
    """VIDAA: ask the TV to add couch-tv to its app row. Newer firmware may refuse (docs/VIDAA.md)."""
    if tv.kind != "vidaa":
        raise ApiError(400, "only for VIDAA TVs")
    added = await tv.install_tile()
    return ok(tile=added, note=None if added else "The TV did not add the tile. The browser stays the way couch-tv opens.")


async def h_vidaa_claim(request):
    """The page a VIDAA or Panasonic TV opens carries a one time code (?vidaa= or ?once=), not the pairing key, because the
    TV's address bar and history are not private. The page swaps the code for the key here, once.
    Open path: a wrong code counts towards the same rate limit as a wrong key."""
    data = await body(request)
    code = data.get("code")
    ip = client_ip(request)
    if is_rate_limited(ip):
        raise ApiError(429, "Too many wrong codes. Please wait a minute.")
    for tv_id, t in TVS.items():
        if t.kind in ("vidaa", "panasonic") and t.claim(code):
            return ok(key=config.PAIRING_KEY, tv=tv_id)
    record_failed_attempt(ip, str(code))
    await asyncio.sleep(0.3)
    raise ApiError(401, "that code is not valid (codes work once, for two minutes)")


async def h_vizio_pair(request):
    """VIZIO pairing: {} asks the TV to show its PIN, {"pin": "1234"} sends it back (docs/VIZIO.md)."""
    if tv.kind != "vizio":
        raise ApiError(400, "only for VIZIO TVs")
    data = await body(request)
    pin = data.get("pin")
    try:
        if pin is None:
            await tv.pair_start()
            return ok(step="pin", note="The TV should now show a 4 digit PIN. Send it as {\"pin\": \"1234\"}.")
        if not isinstance(pin, (str, int)) or not vizio.PIN.match(str(pin).strip()):
            raise ApiError(400, "pin is the 4 digits the TV shows")
        await tv.pair_finish(str(pin).strip())
    except vizio.VizioError as e:
        raise ApiError(409, str(e))
    return ok(paired=True)


async def h_vizio_apps(request):
    """The apps couch-tv knows how to open on a VIZIO (the TV itself does not list them)."""
    if tv.kind != "vizio":
        raise ApiError(400, "only for VIZIO TVs")
    return ok(apps=await tv.apps_on_tv())


async def h_panasonic_pair(request):
    """Panasonic pairing, encrypted sets only: {} asks the TV to show its PIN, {"pin": "1234"} sends it
    back (docs/PANASONIC.md). A set that needs no pairing answers step "none"."""
    if tv.kind != "panasonic":
        raise ApiError(400, "only for Panasonic TVs")
    data = await body(request)
    pin = data.get("pin")
    try:
        if pin is None:
            if not await tv.pair_start():
                return ok(step="none", note="This TV takes commands without pairing.")
            return ok(step="pin", note="The TV should now show a PIN. Send it as {\"pin\": \"1234\"}.")
        if not isinstance(pin, (str, int)) or not re.match(panasonic.PROTOCOL["pin"], str(pin).strip()):
            raise ApiError(400, "pin is the digits the TV shows")
        await tv.pair_finish(str(pin).strip())
    except panasonic.PanasonicError as e:
        raise ApiError(409, str(e))
    return ok(paired=True)


VIDAA_ICON = os.path.join(ROOT, "lg", "app", "largeIcon.png")


async def h_vidaa_icon(request):
    """couch-tv's icon for the VIDAA tile (the same picture as the LG app's)."""
    if not os.path.isfile(VIDAA_ICON):
        raise web.HTTPNotFound()
    return web.FileResponse(VIDAA_ICON, headers={"Cache-Control": "max-age=86400"})
async def h_philips_pair(request):
    """Philips pairing: {} asks the TV to show its PIN, {"pin": "1234"} sends it back
    (docs/PHILIPS-TITAN.md). Needs the pairing key saved first (scripts/philips-secret.py)."""
    if tv.kind != "philips":
        raise ApiError(400, "only for Philips TVs")
    data = await body(request)
    pin = data.get("pin")
    try:
        if pin is None:
            await tv.pair_start()
            return ok(step="pin", note="The TV should now show a PIN. Send it as {\"pin\": \"1234\"}.")
        if not isinstance(pin, (str, int)) or not philips.PIN.match(str(pin).strip()):
            raise ApiError(400, "pin is the digits the TV shows")
        await tv.pair_finish(str(pin).strip())
    except philips.PhilipsError as e:
        raise ApiError(409, str(e))
    return ok(paired=True)


async def h_philips_apps(request):
    """The apps a Philips TV lists, with the one couch-tv opens at power on (if any)."""
    if tv.kind != "philips":
        raise ApiError(400, "only for Philips TVs")
    tv.require()
    listed = await tv.apps_on_tv()
    home = tv._home_entry()
    return ok(apps=listed, home_app=home["label"] if home else None)


async def h_philips_sources(request):
    """A Philips TV's inputs, as the TV lists them."""
    if tv.kind != "philips":
        raise ApiError(400, "only for Philips TVs")
    tv.require()
    try:
        return ok(sources=await tv.read_sources())
    except philips.PhilipsError as e:
        raise ApiError(409, str(e))


async def h_philips_source(request):
    """Switch a Philips TV to one of the inputs it listed: {"name": "HDMI 2"} (or its id)."""
    if tv.kind != "philips":
        raise ApiError(400, "only for Philips TVs")
    data = await body(request)
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ApiError(400, "name is required (an input the TV lists)")
    try:
        hit = await tv.switch_source(name)
    except ValueError as e:
        raise ApiError(404, str(e))
    except philips.PhilipsError as e:
        raise ApiError(409, str(e))
    record_action(request, "input", {"name": name, "input": hit["name"]}, True)
    return ok(input=hit["name"])


async def h_tizen_answer(request):
    data = await body(request)
    if tv.kind == "samsung" and data.get("id"):
        tv.tizen_answer(data["id"], {"ok": bool(data.get("ok")), "error": data.get("error")})
    return ok()


# ---------- "Who's watching?" ----------
WHO_SCREEN = re.compile(r"who.?s watching|who is watching|choose (?:a |your )?profile|select (?:a )?profile", re.I)
PLAY_BUTTONS = ("play", "watch", "watch now", "resume", "continue watching", "start watching", "play movie",
                "watch movie", "play episode", "start")


def profile_order(who):
    """Profile names to look for, best first: the watcher's own (people[].app_profiles, else their
    name), then app_profile_fallback, then everyone else's."""
    def names(p):
        return p.get("app_profiles") or [p["name"]]
    me = next((p for p in config.PEOPLE if p["id"] == who), None)
    order = (names(me) if me else []) + config.APP_PROFILE_FALLBACK
    order += [n for p in config.PEOPLE if p is not me for n in names(p)]
    return list(dict.fromkeys(order))


async def get_it_playing(app, link, who):
    """After a deep link: pass a "Who's watching?" screen with the right profile, open the link
    again, and press Play if the app stops on the title page. Returns (started, profile)."""
    pkg = app["package"]
    # Short waits: a profile screen or a title page never plays by itself, and each screen read
    # costs 3 to 4 s already (first real run, Stan, 29 Oct: 36 s from ask to playing).
    if await wait_until_playing(pkg, timeout=1.5):
        return True, None
    picked = None
    for _ in range(2):
        try:
            items = await agentic.ui_items()
        except Exception:
            break
        if any(WHO_SCREEN.search(i["label"]) for i in items):
            names = [i for i in items if i["label"] and not WHO_SCREEN.search(i["label"])]
            hit = next((i for n in profile_order(who) for i in names
                        if agentic._norm(i["label"]) == agentic._norm(n)), None)
            if not hit:
                log.info("profile screen in %s, none of %s on it", app["name"], profile_order(who))
                return False, None
            await tv.adb("shell", f"input tap {hit['x']} {hit['y']}", timeout=8)
            picked = hit["label"]
            log.info("profile screen in %s: picked %s", app["name"], picked)
            await asyncio.sleep(1.2)
            await tv.start_intent(link, pkg, cold=False)
            await tv.wait_for_app({pkg}, timeout=8)
            if await wait_until_playing(pkg, timeout=1.5):
                return True, picked
            continue   # read the screen again: now it is the title page
        button = agentic._button(items, *PLAY_BUTTONS)
        if button and not agentic.stop_labels([button]):
            await tv.adb("shell", f"input tap {button['x']} {button['y']}", timeout=8)
            log.info("pressed %s in %s", button["label"], app["name"])
            return await wait_until_playing(pkg, timeout=15), picked
        break
    return await wait_until_playing(pkg, timeout=6), picked


async def wait_until_playing(pkg, timeout=30):
    """True once the app's media session says PLAYING and its position moves on (a profile
    screen or a stuck page never gets there). Netflix started fresh takes about 20 s."""
    end = time.monotonic() + timeout
    first = None
    while time.monotonic() < end:
        await asyncio.sleep(1.5)
        try:
            out = await tv.adb("shell", "dumpsys media_session", timeout=8)
        except Exception:
            continue
        s = next((s for s in _sessions(out) if s.get("package") == pkg and s.get("state")), None)
        if not s or s["state"] != "PLAYING" or s.get("position") is None:
            first = None
            continue
        if first is None:
            first = s["position"]
        elif s["position"] != first:
            return True
    return False


def finish_play(best, app, method, note, season, episode, who, ep_info=None):
    extra = {}
    if ep_info and ep_info.get("episode"):
        extra = _episode_fields(ep_info)
        season, episode = extra["season"], extra["episode"]
    elif best["type"] == "movie" and best.get("runtime_min"):
        extra = {"duration_ms": best["runtime_min"] * 60000, "duration_source": "justwatch"}
    item = {"title": best["title"], "year": best["year"], "type": best["type"],
            "poster": best["poster"], "backdrop": best["backdrop"], "service": app["id"],
            "season": season, "episode": episode, "started": now_iso(),
            "package": app["package"], "who": who, "ts": time.time()} | extra
    playing["item"] = item
    store.add_history({"title": best["title"], "year": best["year"], "type": best["type"],
                       "poster": best["poster"], "backdrop": best["backdrop"],
                       "service": app["id"], "who": who, "tv": _current.get(),
                       "season": season, "episode": episode,
                       "episode_title": extra.get("episode_title"),
                       "duration_ms": extra.get("duration_ms"), "when": item["started"],
                       "method": method})
    push_now()
    asyncio.get_running_loop().call_later(5, lambda: asyncio.ensure_future(recs_refresh_soon()))
    return {"title": best["title"], "year": best["year"], "type": best["type"],
            "poster": best["poster"], "backdrop": best["backdrop"], "service": app["id"],
            "app": apps.describe_package(app["package"]), "method": method, "note": note}


async def h_play(request):
    data = await body(request)
    title = (data.get("title") or "").strip()
    if not title:
        raise ApiError(400, "title is required")
    _reset_paused_idle()
    # No season asked for: open the show where they are up to, never episode 1.
    result = await play(title, data.get("season"), data.get("episode"), data.get("service"),
                        store.norm_who(data.get("who")) or cur_who(),
                        resume=not data.get("season"))
    record_action(request, "play", {k: data[k] for k in ("title", "season", "episode", "service")
                                    if data.get(k)}, True)
    return ok(**result)


async def h_who_get(request):
    return ok(who=cur_who())


async def h_who_set(request):
    data = await body(request)
    who = store.norm_who(data.get("who"))
    if not who:
        raise ApiError(400, "who must be " + ", ".join(config.PEOPLE_IDS) + " or both")
    # Kids mode: moving this TV away from a kids profile needs the parent PIN (docs/CONFIG.md)
    was = cur_who()
    if was != who and kids.is_kid(was):
        check_kids_pin(request, was, data.get("pin"))
    store.save_who(who, _current.get())
    push_now()
    return ok(who=who)


# ---------- people (profiles): any number, ordered, edited from the phone or the TV remote ----------
async def h_people_get(request):
    return ok(people=config.PEOPLE)


async def h_people_set(request):
    """{"people": [...]} replaces the list (order, names, adds and removes).
    {"order": [ids]} only reorders; ids left out keep their place at the end."""
    data = await body(request)
    if isinstance(data.get("people"), list):
        if len(data["people"]) > config.MAX_PEOPLE:
            raise ApiError(400, f"at most {config.MAX_PEOPLE} people")
        people = data["people"]
    elif isinstance(data.get("order"), list):
        by = {p["id"]: p for p in config.PEOPLE}
        order = [i for i in dict.fromkeys(data["order"]) if isinstance(i, str) and i in by]
        people = [by[i] for i in order] + [p for p in config.PEOPLE if p["id"] not in order]
    else:
        raise ApiError(400, "people (a list) or order (a list of ids) is required")
    for item in people:
        if isinstance(item, dict) and not " ".join(str(item.get("name") or "").split()):
            raise ApiError(400, "every person needs a name")
    # The phone only edits names and order: keep each person's kid and guest marks from config.
    old = {p["id"]: p for p in config.PEOPLE}
    people = [{**{k: old[i["id"]][k] for k in ("kid", "guest") if k in old.get(i.get("id"), {})}, **i}
              if isinstance(i, dict) and i.get("id") in old else i for i in people]
    config.set_people(people)
    for tv_id in TVS:   # the person on the couch at a TV was removed
        if store.current_who(tv_id) not in (None, "both", *config.PEOPLE_IDS):
            store.save_who(None, tv_id)
    record_action(request, "people", {"count": len(config.PEOPLE)}, True)
    for tv_id in TVS:
        with_tv(tv_id, push_now)
    return ok(people=config.PEOPLE)


# ---------- kids mode: a shelf of chosen shows, behind a parent PIN (bridge/kids.py) ----------
def check_kids_pin(request, pid, pin):
    """Raise 403 unless pin is the parent PIN for this kids profile; 429 after too many wrong ones."""
    addr = client_ip(request) or "local"
    if kids.locked_out(addr):
        raise ApiError(429, "Too many wrong PINs. Wait a few minutes and try again.")
    if not kids.verify(pid, pin):
        kids.wrong_pin(addr)
        raise ApiError(403, "That PIN is not right." if pin else "The parent PIN is needed for that.")


async def kids_list():
    out = []
    for p in config.PEOPLE:
        m = kids.mode(p["id"])
        if not m:
            continue
        await kids.enrich(m["shows"], finder.find)
        pub = kids.public_mode(m)
        names = {a["package"]: a["name"] for a in apps.APPS}
        out.append({"id": p["id"], "name": p["name"], "shows": pub["shows"],
                    "apps": [{"package": k, "name": names.get(k, k)} for k in pub["apps"]],
                    # the same hash config.js carries, so a PIN changed on the phone reaches the TV
                    # without a restart. Never the PIN itself.
                    "pin_hash": pub["pin_hash"], "pin_salt": pub["pin_salt"], "pin_rounds": pub["pin_rounds"]})
    return out


async def h_kids_get(request):
    """The kids profiles, their shelves (with posters) and apps, and each PIN's salted hash (never the PIN)."""
    return ok(kids=await kids_list(),
              people=[{"id": p["id"], "name": p["name"], "kids": kids.is_kid(p["id"])} for p in config.PEOPLE])


async def h_kids_set(request):
    """Change a kids profile, always with its PIN: {who, pin, action, ...}. action is one of
    check, add (show: {title, service, season, episode, poster}), remove (id), apps (apps: [...]),
    pin (new_pin), off, and on (new_pin, for someone who is not a kids profile yet)."""
    data = await body(request)
    pid = store.norm_who(data.get("who"))
    if not pid or pid == "both":
        raise ApiError(400, "who must be one person's id")
    action = data.get("action")
    m = kids.mode(pid)
    if action == "on":
        if m:
            raise ApiError(409, "That is a kids profile already.")
        if not kids.good_pin(data.get("new_pin")):
            raise ApiError(400, "The PIN must be 4 to 8 digits.")
        kids.turn_on(pid, str(data["new_pin"]))
    else:
        if not m:
            raise ApiError(404, "That is not a kids profile.")
        check_kids_pin(request, pid, data.get("pin"))
        if action == "add":
            show = kids.clean_show(data.get("show"))
            if not show:
                raise ApiError(400, "show needs a title")
            if len(m["shows"]) >= kids.MAX_SHOWS:
                raise ApiError(400, f"A shelf holds {kids.MAX_SHOWS} shows. Remove one first.")
            kids.set_shows(pid, m["shows"] + [show])
        elif action == "remove":
            kids.set_shows(pid, [s for s in m["shows"] if s["id"] != data.get("id")])
        elif action == "apps":
            kids.set_apps(pid, data.get("apps"))
        elif action == "pin":
            if not kids.good_pin(data.get("new_pin")):
                raise ApiError(400, "The PIN must be 4 to 8 digits.")
            kids.set_pin(pid, str(data["new_pin"]))
        elif action == "off":
            kids.turn_off(pid)
        elif action != "check":
            raise ApiError(400, "action must be check, add, remove, apps, pin, on or off")
    record_action(request, "kids", {"action": action}, True)
    for tv_id in TVS:
        with_tv(tv_id, push_now)
    return ok(kids=await kids_list())


async def h_history(request):
    return ok(items=store.history()[:200])


# ---------- screens ----------
async def screens_list():
    await installed_packages(wait=False)
    out = []
    for s in SCREENS:
        app = apps.BY_PACKAGE.get(s["package"])
        inst = is_installed(app) if app else None
        ready = inst is True
        out.append({"id": s["id"], "name": s["name"], "kind": s["kind"], "ready": ready,
                    "note": None if ready else "Needs Sunshine on the computer and Moonlight on the TV."})
    return out


async def h_screens(request):
    return ok(screens=await screens_list())


async def h_screens_open(request):
    data = await body(request)
    sid = data.get("id")
    screen = next((s for s in SCREENS if s["id"] == sid), None)
    if not screen:
        raise ApiError(404, f"unknown screen: {sid}")
    listed = next(s for s in await screens_list() if s["id"] == sid)
    if not listed["ready"]:
        raise ApiError(409, listed["note"])
    got, _ = await launch_app(apps.BY_PACKAGE[screen["package"]])
    record_action(request, "screens_open", {"id": sid}, bool(got))
    return ok(id=sid, note=f"Opened Moonlight. Pick the {screen['name']} on the TV.")


# ---------- power and volume ----------
power_off_at = {}   # per TV: when the phone last turned it off


async def _home_after_wake(t):
    """LG, after a power-on from the phone: if the power-on hook did not run (off and on again
    quicker than the watcher reads the TV), open couch-tv anyway. An input is left alone with
    leave_inputs, as the hook does."""
    await asyncio.sleep(6)
    if not (t.is_on and t.home_on_wake_until and t.visible is not None and t.visible != t.app_id):
        return
    if t.leave_inputs and t.INPUT.match(t.visible):
        return
    t.home_on_wake_until = 0.0
    try:
        await t._launch(t.app_id, quiet=False)
        t._note("switched on from the phone, opened couch-tv")
    except Exception as e:
        log.warning("home after wake: %s", e)


async def h_power(request):
    data = await body(request)
    state = data.get("state")
    if state not in ("on", "off", "toggle"):
        raise ApiError(400, "state must be on, off or toggle")
    started = time.monotonic()
    if hasattr(tv, "home_on_wake_until") and tv.connected:
        # LG: the phone's idea of on or off can be seconds behind (Quick Start+ standby still
        # answers). Read the TV now; and a second "off" just after it went off means "on again":
        # the button was pressed to wake it.
        try:
            await tv._read_power()
        except Exception:
            pass
        if state == "off" and tv.is_on is False and time.monotonic() - power_off_at.get(_current.get(), -99) < 20:
            log.info("power off asked again just after it went off: turning it on")
            state = "on"
        elif state == "toggle":
            state = "off" if tv.is_on else "on"
    log.info("power %s requested (connected=%s, is_on=%s)", state, tv.connected, tv.is_on)
    if state == "on":
        waking["on"] = True
        push_now()
        try:
            await power_on()
        finally:
            waking["on"] = False
            push_now()
        if hasattr(tv, "home_on_wake_until"):
            asyncio.create_task(_home_after_wake(TVS[_current.get()]))
    else:
        tv.require()
        cur = tv.is_on
        if state == "toggle" or (state == "off" and cur):
            await tv.key("power")
            target = not cur
            for _ in range(20):
                await asyncio.sleep(0.25)
                if tv.is_on == target:
                    break
    if state == "off":
        power_off_at[_current.get()] = time.monotonic()
    record_action(request, "power", {"state": state}, True)
    on = tv.is_on
    log.info("power %s done in %.1fs (connected=%s, is_on=%s)", state,
             time.monotonic() - started, tv.connected, on)
    return ok(power="unknown" if on is None else ("on" if on else "off"))


POWER_ON_BUDGET = 32  # seconds; the phone app waits 40


async def power_on():
    """Turn the TV on and only return once it says it is on (or the budget runs out).

    When the TV is off it drops off the Wi-Fi, and androidtvremote2 then retries with gaps
    growing to 30 s, so the bridge could miss the TV coming back. So:
    send Wake-on-LAN every 2 s, check the remote port every second, and reconnect the moment it
    opens. Then press POWER if it is still in standby, and press again once if it did not take.
    """
    loop = asyncio.get_running_loop()
    end = loop.time() + POWER_ON_BUDGET
    if not tv.connected:
        last_wake = 0.0
        while loop.time() < end and not tv.connected:
            if loop.time() - last_wake >= 2:
                await tv.wake()
                last_wake = loop.time()
            if await tv.port_open():
                log.info("power on: TV is back on the network, reconnecting now")
                if not await tv.reconnect_now():
                    await asyncio.sleep(1)
            else:
                await asyncio.sleep(1)
        if not tv.connected:
            raise TVUnavailable("the TV did not wake over the network (turn it on with its remote)")
        await asyncio.sleep(1)  # let the TV report its power state
    # Still in standby but on the network ("light" standby, the first minute or so after off):
    # POWER switches it on in under a second. WAKEUP did nothing. A wake packet
    # is the fallback.
    for step in ("power", "wol"):
        if tv.is_on or loop.time() >= end:
            break
        log.info("power on: TV in standby, trying %s", step)
        try:
            if step == "wol":
                await tv.wake()
            else:
                await tv.key(step)
        except Exception as e:
            # An LG woken by Wake-on-LAN refuses POWER while it is still starting up. Keep waiting
            # for it to say it is on instead of failing the request (#56).
            log.info("power on: %s press failed (%s), still waiting", step, e)
        for _ in range(16):
            await asyncio.sleep(0.25)
            if tv.is_on:
                break
    if not tv.is_on:
        raise TVUnavailable("the TV is on the network but did not switch on; try again")


async def h_volume(request):
    data = await body(request)
    if "level" in data and hasattr(tv, "set_volume"):
        await tv.set_volume(max(0, min(100, int(data["level"]))))   # Panasonic: set over UPnP in one step
        record_action(request, "volume", data, True)
        return ok(volume=tv.volume)
    if "level" in data:
        vol = tv.volume
        if not vol["known"]:
            raise ApiError(409, "this TV does not report a volume level, use up and down")
        target = max(0, min(100, int(data["level"])))
        want = round(target * vol["max"] / 100)
        diff = want - (vol["level"] or 0)
        for _ in range(min(abs(diff), 50)):
            await tv.key("volume_up" if diff > 0 else "volume_down")
            await asyncio.sleep(0.08)
    else:
        action = data.get("action")
        keys = {"up": "volume_up", "down": "volume_down", "mute": "mute"}
        if action not in keys:
            raise ApiError(400, "action must be up, down or mute, or send level")
        steps = 1 if action == "mute" else max(1, min(int(data.get("steps", 1)), 20))
        if action == "mute" and hasattr(tv, "set_mute") and tv.volume["known"]:
            await tv.set_mute(not tv.volume["muted"])   # Samsung: set over UPnP, its mute key is ignored. LG: over SSAP
            steps = 0
        for _ in range(steps):
            await tv.key(keys[action])
            await asyncio.sleep(0.08)
    await asyncio.sleep(0.4)
    record_action(request, "volume", data, True)
    return ok(volume=tv.volume)


async def h_screenshot(request):
    png = await tv.screenshot()
    return web.Response(body=png, content_type="image/png", headers={"Cache-Control": "no-store"})


# ---------- Claude ----------
import claude  # noqa: E402  (needs the helpers above)
import agentic  # noqa: E402  (the ask's eyes, installs, inputs, off after this episode)
import sys as _sys  # noqa: E402

agentic.S = _sys.modules[__name__]


async def recs_refresh_soon():
    await claude.refresh_recs(force=True)


async def h_ask(request):
    if not config.ASK_ENABLED:
        raise ApiError(409, "The Claude ask is switched off (ask.enabled in config.json).")
    data = await body(request)
    text = (data.get("text") or "").strip()
    if not text:
        raise ApiError(400, "text is required")
    if kids.is_kid(store.norm_who(data.get("who")) or cur_who()):
        raise ApiError(403, "Ask is off for a kids profile.")
    result = await claude.ask(text, store.norm_who(data.get("who")) or cur_who(), asks,
                              _current.get())
    return ok(**result)


async def h_recs(request):
    who = store.norm_who(request.query.get("who"))
    picks, updated = await claude.cached_recs(who)
    return web.json_response({"ok": True, "updated": updated,
                              "continue": continue_items(who), "picks": picks})


async def h_api_missing(request):
    raise ApiError(404, "no such endpoint")


async def h_options(request):
    return web.Response(status=204)


# ---------- static front ends ----------
PLACEHOLDER = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>{name}</title><body style="font:16px system-ui;background:#111;color:#eee;padding:24px">
<h1>{name}</h1><p>Not built yet. The bridge API is live at <a style="color:#8cf" href="/api/now">/api/now</a>.</p>"""


def static_handler(folder, name):
    async def handler(request):
        rel = request.match_info.get("path", "")
        target = os.path.normpath(os.path.join(folder, rel))
        if not target.startswith(os.path.normpath(folder)):
            raise web.HTTPForbidden()
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            # Single page app: unknown paths without a file extension get index.html.
            index = os.path.join(folder, "index.html")
            if "." in os.path.basename(rel) or not os.path.isfile(index):
                if not os.path.isfile(index):
                    return web.Response(text=PLACEHOLDER.format(name=name), content_type="text/html")
                raise web.HTTPNotFound()
            target = index
        if os.path.basename(target) == "index.html":
            # Tell the page this computer's number address (the one the phone reached), so a page
            # opened by the .local name can move to it before the icon is added.
            sock = request.transport.get_extra_info("sockname") if request.transport else None
            ip = (sock[0] if sock else "").removeprefix("::ffff:")
            if ip.count(".") != 3 and not ip.startswith("::1"):
                ip = lan_ipv4()   # the phone came in over IPv6: hand it the IPv4 instead
            with open(target, encoding="utf-8") as f:
                html = f.read()
            tags = []
            if ip.count(".") == 3 and not ip.startswith("127."):
                tags.append('<meta name="lan-ip" content="%s">' % ip)
            if folder == REMOTE_DIR:
                tags.append('<script src="/bridge/shim.js"></script>')
            if tags and "<head>" in html:
                html = html.replace("<head>", "<head>\n  " + "\n  ".join(tags), 1)
            return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-cache"})
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if target.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        return web.FileResponse(target, headers={"Cache-Control": "no-cache", "Content-Type": ctype})
    return handler



# ---------- the TV's offline copy of its home ----------
# The TV app copies these files into its own storage, so its home still works with the computer off.
# The fingerprint changes whenever any file changes; the TV only copies when it does.
OFFLINE_SKIP = ("mock",)
async def h_tv_manifest(request):
    import hashlib
    files, h = [], hashlib.sha256()
    for dirpath, _, names in sorted(os.walk(LAUNCHER_DIR)):
        for n in sorted(names):
            full = os.path.join(dirpath, n)
            rel = os.path.relpath(full, LAUNCHER_DIR).replace(os.sep, "/")
            if n.startswith(".") or rel.startswith(OFFLINE_SKIP):
                continue
            st = os.stat(full)
            files.append({"path": rel, "size": st.st_size})
            h.update(f"{rel}:{st.st_size}:{int(st.st_mtime)}\n".encode())
    cj = _config_js().encode()
    files.append({"path": "config.js", "size": len(cj)})
    h.update(cj)
    return web.json_response({"ok": True, "version": h.hexdigest()[:16], "files": files},
                             headers={"Cache-Control": "no-cache"})

def _config_js():
    return "window.COUCH_CONFIG = " + json.dumps(config.public()) + ";\n"


async def h_tv_config_js(request):
    """The home page reads its people and weather place from here (and saves a copy offline)."""
    return web.Response(text=_config_js(), content_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})


async def h_config(request):
    return ok(**config.public())


async def h_tv_redirect(request):
    raise web.HTTPFound("/tv/")


# ---------- sleep timer ----------


def _sleep_set(ends_iso):
    if sleep["handle"]:
        sleep["handle"].cancel()
        sleep["handle"] = None
    sleep["ends"] = ends_iso
    store.save_sleep(ends_iso, _current.get())
    if ends_iso:
        delay = max(0.0, datetime.fromisoformat(ends_iso).timestamp() - time.time())
        sleep["handle"] = asyncio.get_running_loop().call_later(
            delay, lambda: asyncio.ensure_future(_sleep_fire()))
    push_now()


async def _sleep_fire():
    sleep["handle"] = None
    log.info("sleep timer: pausing and turning the TV off")
    try:
        if tv.connected and tv.is_on:
            await tv.key("pause")
            await asyncio.sleep(1.5)
            if tv.is_on:
                await tv.key("power")
    except Exception as e:
        log.warning("sleep timer could not turn the TV off: %s", e)
    sleep["ends"] = None
    store.save_sleep(None, _current.get())
    push_now()


# ---------- smart idle (paused-media auto-off) ----------


def _paused_idle_state():
    return tv.state.setdefault("paused_idle", {"since": None, "pkg": None, "ends": None, "snoozed_until": 0.0})


def _smart_idle_cfg():
    raw = home_settings().get("settings", {}).get("smart_idle")
    return config._smart_idle(raw if isinstance(raw, dict) else config.HOME.get("smart_idle"))


def _in_quiet_hours(qh, now_dt=None):
    if not isinstance(qh, dict) or not qh.get("enabled"):
        return False
    dt = now_dt or datetime.now(HOME_TZ)
    cur = dt.hour * 60 + dt.minute
    sh, sm = (int(x) for x in config._hhmm(qh.get("start"), "23:00").split(":"))
    eh, em = (int(x) for x in config._hhmm(qh.get("end"), "06:00").split(":"))
    start, end = sh * 60 + sm, eh * 60 + em
    if start == end:
        return True
    return (start <= cur < end) if start < end else (cur >= start or cur < end)


def _reset_paused_idle(snooze_seconds=0.0):
    st = _paused_idle_state()
    changed = st.get("ends") is not None
    st["since"] = None
    st["pkg"] = None
    st["ends"] = None
    if snooze_seconds > 0:
        st["snoozed_until"] = time.time() + snooze_seconds
    if changed:
        push_now()


async def _paused_idle_step(state_str, pkg, now_ts=None):
    """Track paused playback and power off the TV when paused_idle_minutes elapses.
    Never triggers when state_str is empty/None (e.g. HDMI inputs or games with no media session)."""
    st = _paused_idle_state()
    cfg = _smart_idle_cfg()
    now_t = time.time() if now_ts is None else now_ts
    if not cfg["enabled"] or not tv.connected or not tv.is_on or not pkg or state_str != "paused":
        if st.get("since") is not None or st.get("ends") is not None:
            _reset_paused_idle()
        return False
    if now_t < st.get("snoozed_until", 0.0):
        return False
    qh = cfg["quiet_hours"]
    mins = qh["idle_minutes"] if _in_quiet_hours(qh) else cfg["paused_idle_minutes"]
    if mins <= 0:
        if st.get("since") is not None or st.get("ends") is not None:
            _reset_paused_idle()
        return False
    if st.get("since") is None or st.get("pkg") != pkg:
        st["since"] = now_t
        st["pkg"] = pkg
    deadline = st["since"] + mins * 60
    new_ends = datetime.fromtimestamp(deadline, HOME_TZ).isoformat(timespec="seconds") if deadline - now_t <= 300 else None
    if new_ends != st.get("ends"):
        st["ends"] = new_ends
        push_now()
    if now_t < deadline:
        return False
    log.info("smart idle: %s paused for %d min, turning TV off", pkg, mins)
    st["since"] = None
    st["pkg"] = None
    st["ends"] = None
    if sleep.get("ends"):
        _sleep_set(None)
    try:
        if tv.is_on:
            await tv.key("power")
    except Exception as e:
        log.warning("smart idle could not turn TV off: %s", e)
    push_now()
    return True


async def h_idle_cancel(request):
    cfg = _smart_idle_cfg()
    qh = cfg["quiet_hours"]
    mins = qh["idle_minutes"] if _in_quiet_hours(qh) else cfg["paused_idle_minutes"]
    _reset_paused_idle(snooze_seconds=max(300, mins * 60))
    return ok(snoozed=True)


# ---------- weather for the home (Open-Meteo: free, no account, no key) ----------
# The place comes from "weather" in config.json. Fetched at most every 30 minutes.
WEATHER_AT = {k: config.WEATHER[k] for k in ("lat", "lon", "place")}
WEATHER_EVERY = 30 * 60
WMO = {0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog",
       51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 56: "Drizzle", 57: "Drizzle",
       61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Rain", 67: "Rain",
       80: "Showers", 81: "Showers", 82: "Heavy showers", 95: "Storms", 96: "Storms", 99: "Storms"}
weather_cache = {"at": 0.0, "data": None}


async def get_weather():
    if weather_cache["data"] and time.time() - weather_cache["at"] < WEATHER_EVERY:
        return weather_cache["data"]
    import aiohttp
    url = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min"
           "&timezone={tz}&forecast_days=1").format(tz=config.WEATHER["timezone"].replace("/", "%2F"), **WEATHER_AT)
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.get(url) as r:
                j = await r.json()
        cur, day = j["current"], j.get("daily", {})
        code = int(cur.get("weather_code", -1))
        weather_cache["data"] = {
            "place": WEATHER_AT["place"], "temp": round(cur["temperature_2m"]),
            "code": code, "text": WMO.get(code, ""), "is_day": bool(cur.get("is_day")),
            "high": round(day["temperature_2m_max"][0]) if day.get("temperature_2m_max") else None,
            "low": round(day["temperature_2m_min"][0]) if day.get("temperature_2m_min") else None,
        }
        weather_cache["at"] = time.time()
    except Exception as e:  # keep the last good reading; the home shows the date alone without one
        log.warning("weather: %s", e)
    return weather_cache["data"]


async def h_weather(request):
    w = await get_weather()
    if not w:
        raise ApiError(503, "No weather right now.")
    return ok(**w)


# ---------- app order, arranged from the phone ----------
# The TV home reports the apps it has (home-apps.<tv>.json, in its default order); the phone saves
# the order and where the "More apps" line sits (app-order.<tv>.json). Apps above the line show in
# the dock, which holds home.dock_size (10 unless set). Settings is not in the list: it always closes the dock.
DOCK_MAX = config.HOME["dock_size"]   # home.dock_size in config.json, 1 to 10


def _order_paths():
    tv_id = _current.get()
    return (os.path.join(store.DATA, f"home-apps.{tv_id}.json"), os.path.join(store.DATA, f"app-order.{tv_id}.json"))


def _clean_apps(items):
    out, seen = [], set()
    for a in items if isinstance(items, list) else []:
        if isinstance(a, dict) and isinstance(a.get("package"), str) and a["package"] not in seen:
            seen.add(a["package"])
            out.append({"package": a["package"], "name": str(a.get("name") or a["package"])[:60]})
    return out


def effective_order():
    """The apps in the saved order, apps the TV gained since at the end (below the line)."""
    apps_path, order_path = _order_paths()
    known = store._read(apps_path, {})
    apps = known.get("apps", [])
    saved = store._read(order_path, None)
    if not saved:
        return apps, min(int(known.get("line", DOCK_MAX)), DOCK_MAX, len(apps)), False
    by = {a["package"]: a for a in apps}
    listed = [by[p] for p in saved.get("order", []) if p in by]
    above = sum(1 for p in saved.get("order", [])[:saved.get("line", 0)] if p in by)
    listed += [a for a in apps if a["package"] not in set(saved.get("order", []))]
    return listed, min(above, DOCK_MAX), True


async def h_home_apps(request):
    data = await body(request)
    apps = _clean_apps(data.get("apps"))
    if not apps:
        raise ApiError(400, "apps is required")
    line = data.get("line")
    store._write(_order_paths()[0], {"apps": apps, "line": int(line) if isinstance(line, int) else DOCK_MAX,
                                     "at": datetime.now(HOME_TZ).isoformat(timespec="seconds")})
    return ok()


async def h_app_order_get(request):
    apps, line, saved = effective_order()
    return ok(apps=apps, line=line, saved=saved, dock_max=DOCK_MAX)


async def h_app_order_set(request):
    data = await body(request)
    order = data.get("order")
    if not isinstance(order, list) or not all(isinstance(p, str) for p in order):
        raise ApiError(400, "order must be a list of app packages")
    try:
        line = int(data.get("line"))
    except (TypeError, ValueError):
        raise ApiError(400, "line is required")
    line = max(0, min(line, DOCK_MAX, len(order)))
    store._write(_order_paths()[1], {"order": order, "line": line,
                                     "at": datetime.now(HOME_TZ).isoformat(timespec="seconds")})
    record_action(request, "app-order", {"line": line, "count": len(order)}, True)
    apps, line, saved = effective_order()
    return ok(apps=apps, line=line, saved=saved, dock_max=DOCK_MAX)


# ---------- Home settings made on the TV (the gear tile on the home) ----------
# The TV home keeps its own settings (language, weather place and units, look, scenes, photos,
# quick buttons, hidden apps) and hands the bridge a copy, so the phone remote and the TV agree and
# a TV whose storage was cleared gets them back. One file per TV: data/settings.<tv>.json. They win
# over config.json on that TV (docs/CONFIG.md). The bridge only checks their shape; it does not act
# on them. Anything it does not know is dropped.
SETTINGS_MAX = 32 * 1024
SETTINGS_LANGS = config.LANGUAGES
# The most personal photos the home keeps. The TV home (tv-home/web/app.js MAX_PHOTOS) and the
# launcher (MainActivity.kt MAX_PHOTOS) use the same number: change all three together.
MAX_PHOTOS = 50
_PHOTO_FILE = re.compile(r"[A-Za-z0-9_-]{1,64}\.jpg")
_PACKAGE = re.compile(r"[A-Za-z0-9_.:-]{1,200}")


def _settings_path():
    return os.path.join(store.DATA, f"settings.{_current.get()}.json")


def home_settings():
    data = store._read(_settings_path(), None)
    if isinstance(data, dict) and isinstance(data.get("settings"), dict):
        return {"settings": data["settings"], "updated": data.get("updated")}
    return {"settings": {}, "updated": None}


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def _ids(v, limit=40):
    if not isinstance(v, list):
        return None
    return [x for x in dict.fromkeys(v) if isinstance(x, str) and 0 < len(x) <= 40][:limit]


def clean_settings(s):
    """The keys the TV home knows, each in the shape it writes them."""
    out = {}
    if s.get("lang") in SETTINGS_LANGS:
        out["lang"] = s["lang"]
    p = s.get("place")
    if isinstance(p, dict) and _num(p.get("lat"), -90, 90) and _num(p.get("lon"), -180, 180):
        # two decimals is the town, never the house
        out["place"] = {"name": str(p.get("name") or "")[:80], "lat": round(p["lat"], 2), "lon": round(p["lon"], 2),
                        "timezone": str(p.get("timezone") or "auto")[:64]}
    if isinstance(s.get("wx_show"), bool):
        out["wx_show"] = s["wx_show"]
    if s.get("wx_unit") in ("c", "f"):
        out["wx_unit"] = s["wx_unit"]
    if s.get("wx_every") in (15, 30, 60):
        out["wx_every"] = s["wx_every"]
    if s.get("look") in ("night", "oled", "classic"):
        out["look"] = s["look"]
    idle_photo_seconds = s.get("idle_photo_seconds")
    if type(idle_photo_seconds) is int and idle_photo_seconds in (0, 5, 10, 15, 30, 60):
        out["idle_photo_seconds"] = idle_photo_seconds
    if isinstance(s.get("keep_photo"), bool):   # Classic keeps one photo (#127)
        out["keep_photo"] = s["keep_photo"]
    if isinstance(s.get("keep_photo_pick"), str) and 0 < len(s["keep_photo_pick"]) <= 300:
        out["keep_photo_pick"] = s["keep_photo_pick"]
    if s.get("glass") in ("off", "on", "lite"):
        out["glass"] = s["glass"]
    if isinstance(s.get("glass_icons"), bool):
        out["glass_icons"] = s["glass_icons"]
    if isinstance(s.get("moving_tiles"), bool):   # the focused tile's slow sway (#52)
        out["moving_tiles"] = s["moving_tiles"]
    if isinstance(s.get("lighter"), bool):   # lighter home for a slow box (#58)
        out["lighter"] = s["lighter"]
    if isinstance(s.get("glass_amount"), int) and not isinstance(s.get("glass_amount"), bool) and 1 <= s["glass_amount"] <= 5:
        out["glass_amount"] = s["glass_amount"]
    if s.get("clock_style") in ("frosted", "liquid"):
        out["clock_style"] = s["clock_style"]
    # Now playing on or off (#31), and the navigation sound: the TV's own, soft or off (#32)
    if isinstance(s.get("now_playing"), bool):
        out["now_playing"] = s["now_playing"]
    if isinstance(s.get("keep_watching"), bool):
        out["keep_watching"] = s["keep_watching"]
    if isinstance(s.get("ambient_music"), bool):
        out["ambient_music"] = s["ambient_music"]
    if isinstance(s.get("sun_sync"), bool):
        out["sun_sync"] = s["sun_sync"]
    if isinstance(s.get("ambient_weather"), bool):
        out["ambient_weather"] = s["ambient_weather"]
    if isinstance(s.get("ambient_sun_grade"), bool):
        out["ambient_sun_grade"] = s["ambient_sun_grade"]
    if s.get("nav_sound") in ("system", "soft", "off"):
        out["nav_sound"] = s["nav_sound"]
    if s.get("glass_focus") in ("colour", "glass"):   # glass app icons: the focused app (#32)
        out["glass_focus"] = s["glass_focus"]
    if isinstance(s.get("video"), bool):
        out["video"] = s["video"]
    # "" means the video link was removed on the TV (it then wins over home.video_url)
    if isinstance(s.get("video_url"), str) and (s["video_url"] == "" or (re.match(r"https?://", s["video_url"]) and len(s["video_url"]) <= 2000)):
        out["video_url"] = s["video_url"]
    for k in ("scene_order", "scenes_off"):
        ids = _ids(s.get(k))
        if ids is not None:
            out[k] = ids
    if _num(s.get("scene_seconds"), 5, 3600):
        out["scene_seconds"] = int(s["scene_seconds"])
    if s.get("clock") in ("12h", "24h"):
        out["clock"] = s["clock"]
    if isinstance(s.get("photos"), list):
        photos = []
        for ph in s["photos"][:MAX_PHOTOS]:
            if not isinstance(ph, dict) or not isinstance(ph.get("id"), str) or not 0 < len(ph["id"]) <= 32:
                continue
            if isinstance(ph.get("file"), str) and _PHOTO_FILE.fullmatch(ph["file"]):
                photos.append({"id": ph["id"], "file": ph["file"]})
            elif isinstance(ph.get("url"), str) and re.match(r"https?://", ph["url"]) and len(ph["url"]) <= 2000:
                photos.append({"id": ph["id"], "url": ph["url"]})
        out["photos"] = photos
    if isinstance(s.get("hidden_apps"), list):
        out["hidden_apps"] = [x for x in dict.fromkeys(s["hidden_apps"]) if isinstance(x, str) and _PACKAGE.fullmatch(x)][:200]
    if isinstance(s.get("quick"), list):
        out["quick"] = [x for x in dict.fromkeys(s["quick"]) if x in config.QUICK_IDS]
    sc = s.get("soundscape")
    if isinstance(sc, dict) and sc.get("type") in config.SOUNDSCAPE_TYPES:
        out["soundscape"] = {"type": sc["type"], "volume": config._float(sc.get("volume"), 0.5, 0.0, 1.0),
                             "fade_with_sleep": sc.get("fade_with_sleep") is not False}
    if isinstance(s.get("smart_idle"), dict):
        out["smart_idle"] = config._smart_idle(s["smart_idle"])
    return out


async def h_settings_get(request):
    return ok(**home_settings())


async def h_settings_set(request):
    data = await body(request)
    s = data.get("settings")
    if not isinstance(s, dict):
        raise ApiError(400, "settings (an object) is required")
    if len(json.dumps(s)) > SETTINGS_MAX:
        raise ApiError(413, "settings are too big")
    cleaned = clean_settings(s)
    updated = now_iso()
    store._write(_settings_path(), {"settings": cleaned, "updated": updated})
    record_action(request, "settings", {"keys": sorted(cleaned)}, True)
    return ok(settings=cleaned, updated=updated)


async def h_sleep_get(request):
    return ok(ends=sleep["ends"])


async def h_sleep_set(request):
    data = await body(request)
    try:
        minutes = float(data.get("minutes"))
    except (TypeError, ValueError):
        raise ApiError(400, "minutes is required (0 cancels)")
    if minutes < 0 or minutes > 600:
        raise ApiError(400, "minutes must be 0 to 600")
    agentic.cancel(clear_timer=False)  # a timer set by hand replaces "off when this episode ends"
    ends = None
    if minutes > 0:
        ends = datetime.fromtimestamp(time.time() + minutes * 60, HOME_TZ).isoformat(timespec="seconds")
    _sleep_set(ends)
    record_action(request, "sleep", {"minutes": minutes}, True)
    return ok(ends=sleep["ends"])


# ---------- keep watching (the TV's own Watch Next row + our history) ----------
WATCH_NEXT_COLS = ["_id", "package_name", "title", "episode_title", "season_display_number",
                   "episode_display_number", "poster_art_uri", "thumbnail_uri", "intent_uri",
                   "last_engagement_time_utc_millis", "last_playback_position_millis",
                   "duration_millis", "watch_next_type", "type", "browsable"]
WATCH_NEXT_TYPES = {"0": "continue", "1": "next", "2": "new", "3": "watchlist"}
# Apps kept out of Keep watching (YouTube here: it can bury
# everything else). The history is still recorded, it just is not listed.
CONTINUE_SKIP = {"youtube"}
# Never logged as watched at all: videos, music and streams are not shows to keep watching, and a
# video title matched to a film would put that film in the household's taste (issue #23: a
# Veritasium video logged as "Fear of Rain"). The on-TV app has the same list (Now.NOT_KEPT).
NOT_KEPT = {"youtube", "spotify", "twitch", "moonlight"}


def _parse_rows(out, cols):
    """Parse `content query` output. Values can hold ", " so split on the known column names."""
    import re
    rows = []
    pat = re.compile(r"(?:^|, )(" + "|".join(map(re.escape, cols)) + r")=")
    for line in out.splitlines():
        m = re.match(r"Row: \d+ (.*)", line)
        if not m:
            continue
        text, row = m.group(1), {}
        hits = list(pat.finditer(text))
        for i, h in enumerate(hits):
            end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
            val = text[h.end():end]
            row[h.group(1)] = None if val == "NULL" else val
        rows.append(row)
    return rows


async def watch_next():
    """Rows the apps themselves put in Android's Watch Next (what Google's home shows as
    Continue watching). Needs ADB. Empty list if the TV will not share it."""
    if not await tv.adb_ready():
        return []
    out = await tv.adb("shell", "content", "query", "--uri",
                       "content://android.media.tv/watch_next_program",
                       "--projection", ":".join(WATCH_NEXT_COLS), timeout=15)
    items = []
    for r in _parse_rows(out, WATCH_NEXT_COLS):
        if r.get("browsable") == "0" or not r.get("title"):
            continue
        app = apps.describe_package(r.get("package_name"))
        pos, dur = r.get("last_playback_position_millis"), r.get("duration_millis")
        progress = None
        if pos and dur and dur.isdigit() and int(dur) > 0 and pos.isdigit():
            progress = round(min(1.0, int(pos) / int(dur)), 3)
        when = r.get("last_engagement_time_utc_millis")
        items.append({
            "id": f"wn-{r.get('_id')}",
            "title": r["title"],
            "episode_title": r.get("episode_title"),
            "season": r.get("season_display_number"),
            "episode": r.get("episode_display_number"),
            "app": app,
            "service": app["id"] if app else None,
            "poster": r.get("poster_art_uri"),
            "backdrop": r.get("thumbnail_uri") or r.get("poster_art_uri"),
            "progress": progress,
            "kind": WATCH_NEXT_TYPES.get(r.get("watch_next_type") or "", "continue"),
            "last_played": datetime.fromtimestamp(int(when) / 1000, HOME_TZ).isoformat(timespec="seconds")
            if when and when.isdigit() else None,
            "source": "tv",
            "_link": r.get("intent_uri"),
        })
    return items


def continue_items(who=None):
    """Keep watching for the person on the couch (or `who`) at this TV: one card per show, newest
    first, up to 10, nothing older than 30 days. A card's id is its history line's own id."""
    who = who or cur_who()
    out = []
    rows = _wn_rows()
    for h in store.keep_watching(_current.get(), who):
        if h.get("service") in CONTINUE_SKIP:
            continue
        h = wn_fresher(h, rows)   # the app's own row, when it was watched after our line
        app = apps.BY_ID.get(h.get("service"))
        out.append({"id": h["id"], "title": h["title"], "episode_title": h.get("episode_title"),
                    "season": h.get("season"), "episode": h.get("episode"),
                    "app": apps.describe_package(app["package"]) if app else None,
                    "service": h.get("service"), "poster": h.get("poster"),
                    "backdrop": h.get("backdrop"), "progress": None, "kind": "continue",
                    "last_played": h.get("when"), "source": "bridge"})
    return out


def _wn_num(v):
    """A Watch Next season or episode ("2", 2) as a whole number, or None."""
    if isinstance(v, int) and not isinstance(v, bool):
        return v if v > 0 else None
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip()) or None
    return None


def wn_fresher(h, rows):
    """A history line (Keep watching card or the line a card opens), brought up to date from this
    TV's Watch Next rows. The app knows where a show is up to: a play couch-tv opened records the
    episode it asked for, and then autoplay, the app's own Resume or watching on without couch-tv
    moves on without us (12 Nov: Ozark stuck on season 1 episode 10 while Netflix's own row said
    season 2 episode 3). So when the app's row for the same show, in the same app, was engaged after
    the line was written and names a season and episode, those win, and the card's time is the
    row's. Otherwise the line is returned as it is (apps with no Watch Next row change nothing)."""
    if not h or not rows:
        return h
    try:
        line_ts = datetime.fromisoformat(h.get("when") or "").timestamp()
    except (TypeError, ValueError):
        return h
    title = finder._norm(h.get("title") or "")
    service = h.get("service")
    app = apps.BY_ID.get(service)
    pkg = app["package"] if app else service
    best = None
    for r in rows:
        eng = r.get("engaged")
        if not isinstance(eng, (int, float)) or eng <= line_ts:
            continue
        if not title or r.get("package") != pkg or finder._norm(r.get("title") or "") != title:
            continue
        season, episode = _wn_num(r.get("season")), _wn_num(r.get("episode"))
        if not (season and episode):
            continue   # a row with no episode says nothing about where the show is up to
        if not best or eng > best[0]:
            best = (eng, season, episode, r.get("episode_title"))
    if not best:
        return h
    eng, season, episode, ep_title = best
    same = (_wn_num(h.get("season")), _wn_num(h.get("episode"))) == (season, episode)
    return {**h, "season": season, "episode": episode,
            "episode_title": h.get("episode_title") if same and not ep_title else ep_title,
            "when": datetime.fromtimestamp(eng, HOME_TZ).isoformat(timespec="seconds"),
            "from_watch_next": True}


# ---------- now playing (#31): music any app is playing, for the home's card ----------
# Read from the same `dumpsys media_session` as Keep watching, but not only the app in front: the
# point is music (Spotify, YouTube Music) carrying on behind the home. A session counts while it
# plays, and stays a while after a pause so the card's play button can start it again.
MUSIC_PAUSE_KEEP = 600          # seconds a paused session stays on the card
OWN_PACKAGES = {"app.couchtv.launcher", "dev.couchtv.ontv"}
music_states = {}             # per TV: {"read_at", "item", "last"}
music_art = {}                  # (artist, title) -> picture url or ""
music_art_pending = set()


async def _music_artwork(artist, title):
    """The album picture from Apple's free iTunes search (no key), once per song."""
    key = ((artist or "").lower(), (title or "").lower())
    try:
        import aiohttp
        q = f"{artist or ''} {title or ''}".strip()
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as cs:
            async with cs.get("https://itunes.apple.com/search", params={"term": q, "entity": "song", "limit": "1"},
                              headers={"user-agent": "couch-tv-bridge/1"}) as r:
                j = await r.json(content_type=None)
        hit = (j.get("results") or [None])[0]
        url = hit.get("artworkUrl100") if hit else None
        music_art[key] = url.replace("100x100bb", "600x600bb") if url else ""
    except Exception:
        music_art[key] = ""
    finally:
        music_art_pending.discard(key)


async def music_now():
    """The song on the card: playing now, or paused in the last ten minutes. Cached for 3 s."""
    music_state = music_states.setdefault(_current.get(), {"read_at": 0.0, "item": None, "last": None})
    if time.time() - music_state["read_at"] < 3:
        return music_state["item"]
    music_state["read_at"] = time.time()
    item = None
    if tv.connected and tv.is_on and await tv.adb_ready():
        try:
            out = await tv.adb("shell", "cat /proc/uptime; dumpsys media_session", timeout=8)
        except Exception:
            return music_state["item"]   # ADB busy or away for a moment: keep the card as it was
        found = [x for x in _sessions(out) if x.get("package") not in OWN_PACKAGES and x.get("title")]
        playing = [x for x in found if x.get("state") == "PLAYING"]
        playing.sort(key=lambda x: not x.get("active"))
        last = music_state["last"]
        pick = playing[0] if playing else None
        if not pick and last and time.time() - last["seen"] < MUSIC_PAUSE_KEEP:
            pick = next((x for x in found if x["package"] == last["package"] and x.get("state") in ("PAUSED", "STOPPED")), None)
        if pick:
            app = apps.describe_package(pick["package"]) or {"id": None, "name": pick["package"], "package": pick["package"]}
            if not generic_title(pick["title"], pick["package"], app):
                if pick.get("state") == "PLAYING":
                    music_state["last"] = {"package": pick["package"], "seen": time.time()}
                key = ((pick.get("subtitle") or "").lower(), pick["title"].lower())
                if key not in music_art and key not in music_art_pending:
                    music_art_pending.add(key)
                    asyncio.ensure_future(_music_artwork(pick.get("subtitle"), pick["title"]))
                item = {"title": pick["title"], "artist": pick.get("subtitle"), "album": pick.get("album"),
                        "state": STATES.get(pick.get("state"), "stopped"), "app": app,
                        "art": music_art.get(key) or None}
                if pick.get("pos_s") is not None:
                    item["position"] = pick["pos_s"]
                if pick.get("dur_s") is not None:
                    item["duration"] = pick["dur_s"]
    # Nothing from the TV's own media sessions (no ADB on VIDAA, LG, Samsung or Roku, or the music is
    # playing on a phone): Spotify's Web API, when it has been set up (bridge/spotify_now.py)
    if item is None:
        item = await spotify_now.now_playing()
    music_state["item"] = item
    return item


async def h_music(request):
    return ok(music=await music_now())


# ---------- Spotify's now playing for the whole account (bridge/spotify_now.py, optional) ----------
def _bridge_port(request):
    return request.url.port or int(os.environ.get("PORT") or config.BRIDGE.get("port") or 5400)


def _loopback_only(request):
    """The Spotify login is for the bridge computer itself, never another device on the Wi-Fi. (Behind a
    reverse proxy on the same computer every client would look local: couch-tv does not run behind one.)"""
    ip = (request.remote or "").removeprefix("::ffff:")
    try:
        local = ipaddress.ip_address(ip).is_loopback
    except ValueError:
        local = False
    if not local:
        raise web.HTTPForbidden(text="Open this on the bridge computer: http://127.0.0.1:%s%s" % (_bridge_port(request), request.path))


async def h_spotify_login(request):
    _loopback_only(request)
    try:
        url = spotify_now.login_url("http://127.0.0.1:%s/api/spotify/callback" % _bridge_port(request))
    except ValueError as e:
        return web.Response(text=str(e), status=400)
    raise web.HTTPFound(url)


async def h_spotify_callback(request):
    _loopback_only(request)
    q = request.query
    if q.get("error"):
        return web.Response(text="Spotify said: " + q["error"], status=400)
    try:
        await spotify_now.finish_login(q.get("state"), q.get("code"))
    except (ValueError, RuntimeError) as e:
        return web.Response(text=str(e), status=400)
    return web.Response(text="Spotify is connected to couch-tv. You can close this tab.")


async def h_spotify_status(request):
    return ok(**spotify_now.status())


async def h_continue(request):
    who = store.norm_who(request.query.get("who"))
    return ok(items=continue_items(who))


async def h_continue_open(request):
    data = await body(request)
    cid = data.get("id")
    h = store.history_item(cid) if cid else None
    if not h:
        raise ApiError(404, f"unknown continue item: {cid}")
    # the episode the card shows: the app's own Watch Next row when it is newer than the line, so
    # the play opens (and history records) where the show is really up to, not the stale episode
    h = wn_fresher(h, _wn_rows())
    result = await play(h["title"], h.get("season"), h.get("episode"), h.get("service"),
                        store.norm_who(data.get("who")) or cur_who(), resume=True)
    record_action(request, "continue", {"id": cid}, True)
    return ok(**result)


# ---------- which episode, and how long (only when matched, never a guess) ----------
import re as _re

SXE = [_re.compile(r"\bS(?:eason)?\s*(\d{1,2})\s*[:,.\- ]?\s*E(?:p(?:isode)?)?\s*(\d{1,3})\b", _re.I),
       _re.compile(r"\bSeason\s+(\d{1,2}),?\s+Episode\s+(\d{1,3})\b", _re.I),
       _re.compile(r"\b(\d{1,2})x(\d{1,3})\b")]
episode_cache = {}  # (title, subtitle, year_subtitle) -> result dict


def _sxe(*texts):
    for t in texts:
        for pat in SXE:
            m = pat.search(t or "")
            if m:
                return int(m.group(1)), int(m.group(2))
    return None


def _clean_episode_name(text):
    """'S2:E3 "The Pollywog"' -> 'The Pollywog'."""
    t = text or ""
    for pat in SXE:
        t = pat.sub("", t)
    return t.strip(" :-|\"'\u201c\u201d")


def _episode_fields(ep):
    run = ep.get("runtime_min")
    return {"season": ep["season"], "episode": ep["episode"], "episode_title": ep.get("name"),
            "duration_ms": run * 60000 if run else None,
            "duration_source": "justwatch" if run else None}


# Apps that put a film's release year in the subtitle. A bare number is a year only for these: in
# others (Paramount+) it can be a show's name, "1923" or "1883".
YEAR_SUBTITLE_APPS = {"nuvio"}


async def resolve_episode(title, subtitle, year_subtitle=False):
    """Season, episode, episode title and length for what an app reports. Matches the show by
    exact title on JustWatch, then the episode by an SxE number or an exact episode title.
    Films: the film's runtime when the title matches exactly. {} when nothing matches."""
    key = (title or "", subtitle or "", bool(year_subtitle))
    if key in episode_cache:
        return episode_cache[key]
    result = {}
    try:
        for show, other in ((title, subtitle), (subtitle, title)):
            # Nuvio sends a film's year as the subtitle, and "2012" is a film: not a show name there
            if not show or (year_subtitle and show is subtitle and str(show).strip().isdigit()):
                continue
            best, _ = await finder.find(show)
            if not best or finder._norm(best["title"]) != finder._norm(show):
                continue
            if best["type"] == "movie":
                if not other and best.get("runtime_min"):
                    result = {"duration_ms": best["runtime_min"] * 60000,
                              "duration_source": "justwatch"}
                result["show"] = best["title"]
                break
            num = _sxe(other, show)
            ep = None
            if num:
                ep = await finder.episode_providers(best["jw_id"], num[0], num[1])
            elif other:
                ep = await finder.episode_by_name(best["jw_id"], _clean_episode_name(other))
            if ep:
                result = _episode_fields(ep)
                result["show"] = best["title"]   # which of the two fields was the show
                break
    except Exception as e:
        log.info("episode lookup failed: %s", e)
        return {}  # not cached, try again next read
    episode_cache[key] = result
    return result


# ---------- what is playing in any app (logs hand-started viewing too) ----------
NOT_VIEWING = {"home", "settings", None}


def _sessions(out):
    """Pull package, state, position, duration and title out of `cat /proc/uptime; dumpsys media_session`.
    PlaybackState `updated` is the TV's elapsed time since boot in ms, the same clock as the
    first number in /proc/uptime, so the position can be brought up to the moment of reading."""
    import re
    found, cur = [], None
    try:
        first_token = out.split()[0] if out else ""
        uptime_ms = int(float(first_token) * 1000)
    except (ValueError, IndexError):
        uptime_ms = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("package="):
            cur = {"package": line.split("=", 1)[1]}
            found.append(cur)
        elif line.startswith("active=") and cur is not None:
            cur["active"] = line.endswith("true")
        elif line.startswith("state=PlaybackState") and cur is not None:
            m = re.search(r"\{state=([A-Z_]+)\(", line)
            cur["state"] = m.group(1) if m else None
            if not m:   # older Android prints a number: PlaybackState {state=3, ...}
                m = re.search(r"\{state=(\d+)[,}]", line)
                n = int(m.group(1)) if m else -1
                cur["state"] = STATE_NAMES[n] if 0 <= n < len(STATE_NAMES) else None
            for key in ("position", "updated"):
                m = re.search(rf"[ {{]{key}=(-?\d+)", line)
                cur[key] = int(m.group(1)) if m else None
            m = re.search(r"speed=([-\d.]+)", line)
            cur["speed"] = float(m.group(1)) if m else 0.0
            pos = cur.get("position")
            if pos is not None and pos >= 0:
                if uptime_ms and cur.get("updated") and cur.get("state") == "PLAYING" and cur.get("speed", 0.0) > 0:
                    pos = pos + int((uptime_ms - cur["updated"]) * cur["speed"])
                cur["pos_s"] = round(pos / 1000.0, 1)
        elif line.startswith("metadata:") and cur is not None:
            if "description=" in line:
                parts = [p.strip() for p in line.split("description=", 1)[1].split(", ")]
                cur["title"] = parts[0] if parts and parts[0] != "null" else None
                cur["subtitle"] = parts[1] if len(parts) > 1 and parts[1] != "null" else None
                cur["album"] = parts[2] if len(parts) > 2 and parts[2] != "null" else None
            m_dur = re.search(r"(?:duration|DURATION)=(\d+)", line)
            if m_dur:
                cur["duration"] = int(m_dur.group(1))
                cur["dur_s"] = round(int(m_dur.group(1)) / 1000.0, 1)
        elif cur is not None and ("duration" in line.lower() or "android.media.metadata.duration" in line.lower()):
            m_dur = re.search(r"(?:duration|DURATION)=(\d+)", line)
            if m_dur:
                cur["duration"] = int(m_dur.group(1))
                cur["dur_s"] = round(int(m_dur.group(1)) / 1000.0, 1)
        elif line.startswith("queueTitle=") and cur is not None:
            q = line.split("=", 1)[1].rsplit(", size=", 1)[0].strip()
            cur["queue_title"] = q if q and q != "null" else None
    return found


# What some apps report as the title while a film plays, or on their browse screen: their own
# name ("PrimeVideo" on a Sony, issue #23) or a placeholder. Never a show to keep watching.
GENERIC_TITLES = {"primevideo", "amazonprimevideo", "amazonvideo", "prime", "amazon", "netflix", "youtube", "disney",
                  "advertisement", "ad", "ads", "sponsored", "trailer", "preview", "loading", "nowplaying",
                  "unknown", "null", "untitled", "video", "tv", "live", "home"}


def generic_title(title, pkg=None, app=None):
    n = re.sub(r"[^a-z0-9]", "", (title or "").lower())
    if not n or n in GENERIC_TITLES or n.isdigit():
        return True
    own = {re.sub(r"[^a-z0-9]", "", (x or "").lower())
           for x in ((app or {}).get("name"), (app or {}).get("id"), pkg, (pkg or "").rsplit(".", 1)[-1])}
    return n in own


STATES = {"PLAYING": "playing", "PAUSED": "paused", "BUFFERING": "buffering",
          "CONNECTING": "buffering", "FAST_FORWARDING": "playing", "REWINDING": "playing",
          "SKIPPING_TO_NEXT": "buffering", "SKIPPING_TO_PREVIOUS": "buffering",
          "SKIPPING_TO_QUEUE_ITEM": "buffering", "STOPPED": "stopped", "NONE": "stopped",
          "ERROR": "stopped"}
# PlaybackState's numbers, for older Android that prints state=3 rather than state=PLAYING(3)
STATE_NAMES = ("NONE", "STOPPED", "PAUSED", "PLAYING", "FAST_FORWARDING", "REWINDING", "BUFFERING",
               "ERROR", "CONNECTING", "SKIPPING_TO_PREVIOUS", "SKIPPING_TO_NEXT", "SKIPPING_TO_QUEUE_ITEM")


def _fallback_title(pkg):
    """Apps like Apple TV report no title. Use what the bridge last played in that app (6 h)."""
    item = playing["item"]
    if item and item.get("package") == pkg:
        return item["title"], item.get("episode_title")
    app = apps.BY_PACKAGE.get(pkg)
    for h in store.history()[:20]:
        if app and h.get("service") == app["id"]:
            try:
                age = time.time() - datetime.fromisoformat(h["when"]).timestamp()
            except (KeyError, ValueError):
                continue
            if age < 6 * 3600:
                return h["title"], h.get("episode_title")
            break
    return None, None


art_cache = {}  # title -> {"poster", "backdrop"} from JustWatch
art_pending = set()


def artwork_soon(title):
    """The picture if it is known now, else none, with the lookup started in the background. The
    watch loop uses this, so a slow show finder never holds it up past the minute a show needs."""
    key = (title or "").lower()
    if not key:
        return {}
    if key in art_cache:
        return art_cache[key]
    if key not in art_pending:
        art_pending.add(key)

        async def fetch():
            try:
                await artwork(title)
            finally:
                art_pending.discard(key)
        asyncio.ensure_future(fetch())
    return {}


async def artwork(title):
    if not title:
        return {}
    key = title.lower()
    if key not in art_cache:
        art_cache[key] = {}
        for h in store.history()[:50]:
            if h["title"].lower() == key and h.get("poster"):
                art_cache[key] = {"poster": h["poster"], "backdrop": h.get("backdrop")}
                break
        else:
            try:
                best, _ = await finder.find(title)
                # a near name is another show: no picture beats the wrong one
                if best and finder._norm(best["title"]) == finder._norm(title):
                    art_cache[key] = {"poster": best["poster"], "backdrop": best["backdrop"]}
            except Exception:
                pass
    return art_cache[key]


async def media_read(pkg, app):
    out = await tv.adb("shell", "cat /proc/uptime; dumpsys media_session", timeout=10)
    try:
        uptime_ms = int(float(out.split()[0]) * 1000)
    except (ValueError, IndexError):
        uptime_ms = None
    mine = [s for s in _sessions(out) if s.get("package") == pkg and s.get("state")]
    if not mine:
        if media_now:
            media_now.clear()
            push_now()
        return None
    s = sorted(mine, key=lambda x: (not x.get("active"), x.get("state") == "NONE"))[0]
    state = STATES.get(s["state"], "stopped")
    pos = s.get("position")
    if pos is not None and pos >= 0 and uptime_ms and s.get("updated") and state == "playing":
        pos = pos + int((uptime_ms - s["updated"]) * (s.get("speed") or 1.0))
    if pos is not None and pos < 0:
        pos = None
    title, episode_title, source_title = s.get("title"), s.get("subtitle"), "app"
    if generic_title(title, pkg, app):   # "PrimeVideo" while a film plays: try the queue's title
        title = s.get("queue_title") if not generic_title(s.get("queue_title"), pkg, app) else None
        if not title:
            episode_title = None
    s["title"] = title
    ep = {}
    if title:
        ep = await resolve_episode(title, episode_title, (app or {}).get("id") in YEAR_SUBTITLE_APPS)
        # Some apps (Paramount+) send the episode name first and the show second: "A Different
        # Corner, Mobland". Use the field that matched the show, or the poster comes from the wrong one.
        if ep.get("show") and finder._norm(ep["show"]) != finder._norm(title):
            title, episode_title = ep["show"], title
        s["title"], s["subtitle"] = title, episode_title
    else:
        title, episode_title = _fallback_title(pkg)
        source_title = "bridge" if title else None
    art = artwork_soon(title)
    new = {"title": title, "episode_title": ep.get("episode_title") or episode_title,
           "season": ep.get("season"), "episode": ep.get("episode"), "package": pkg,
           "state": state, "poster": art.get("poster"), "backdrop": art.get("backdrop"),
           "position_ms": pos, "duration_ms": ep.get("duration_ms"),
           "duration_source": ep.get("duration_source"), "read_at": time.time(),
           "title_from": source_title}
    old = dict(media_now)
    drift = None
    if old.get("position_ms") is not None and pos is not None:
        expected = old["position_ms"] + (int((new["read_at"] - old["read_at"]) * 1000)
                                         if old.get("state") == "playing" else 0)
        drift = abs(expected - pos)
    media_now.clear()
    media_now.update(new)
    if (old.get("title"), old.get("state")) != (title, state):
        log.info("now playing: %s (%s) in %s", title, state, app["name"])
    if (old.get("title"), old.get("state")) != (title, state) or drift is None or drift > 3000:
        push_now()
    return s


# A title counts as watched (Keep watching) once it has played this long, so a trailer that
# autoplays while browsing stays out. COUCHTV_SEEN_AFTER_S lowers it for the emulator tests.
SEEN_AFTER_S = float(os.environ.get("COUCHTV_SEEN_AFTER_S") or 60)


def _blip(cand):
    """A show is being counted: up to two readings in a row with nothing playing (a slow dumpsys, the
    front app read as the home for a moment), within 40 s of the last reading that showed it, are
    forgiven, as the on-TV app does (Now.remember). Only a different title, or nothing for longer,
    starts it again. Counted here, so call it once per reading."""
    if not (cand and cand[0]) or seen_playing.get("_empty_reads", 0) >= 2 \
            or time.time() - seen_playing.get("_playing_last", 0) >= 40:
        return False
    seen_playing["_empty_reads"] = seen_playing.get("_empty_reads", 0) + 1
    return True


async def media_watch_loop():
    """Every 8 s while an app is in front (checks every 10 s otherwise): read what it says is playing, for
    /api/now (title, state, position) and to log shows started by hand."""
    last_picture = 0.0
    while True:
        busy = False
        try:
            if tv.picture_cfg and tv.connected and tv.is_on and time.time() - last_picture > 30:
                last_picture = time.time()
                await read_picture()  # for `picture` in /api/now; one quick settings read
            pkg = tv.current_package
            app = apps.describe_package(pkg)
            if (tv.connected and tv.is_on and app and app["id"] not in NOT_VIEWING
                    and await tv.adb_ready()):
                busy = True
                s = await media_read(pkg, app)
                key = (pkg, s["title"].lower()) if s and s.get("state") == "PLAYING" and s.get("title") else None
                # the app's own position has to be past the minute too, when it gives one: a preview
                # that autoplays on a browse screen starts at 0 each time
                pos = media_now.get("position_ms")
                young = pos is not None and pos < SEEN_AFTER_S * 1000
                cand = seen_playing.get("_playing")
                if key:
                    seen_playing["_empty_reads"] = 0
                if key and key == (cand and cand[0]):
                    seen_playing["_playing_last"] = time.time()
                if key is None and _blip(cand):
                    pass   # one reading with nothing playing does not start the minute again
                elif key != (cand and cand[0]):
                    seen_playing["_playing"] = (key, time.time())   # something new (or nothing) playing
                    seen_playing["_playing_last"] = time.time()
                elif key and not young and time.time() - cand[1] >= SEEN_AFTER_S and time.time() - seen_playing.get(key + (cur_who(),), 0) >= 1800:
                    seen_playing[key + (cur_who(),)] = time.time()
                    item = playing["item"]
                    # Our own /api/play already logged it if it is the same show, for the same person,
                    # in the last three hours.
                    # Unless the app says it is on another episode than the one that play logged
                    # (a Keep watching card resumed somewhere else, or autoplay moved on).
                    ours = (item and item.get("who") == cur_who() and item.get("ts", 0) > time.time() - 3 * 3600
                            and item["title"].lower() in (s["title"].lower(), (s.get("subtitle") or "").lower()))
                    said = (_wn_num(media_now.get("season")), _wn_num(media_now.get("episode")))
                    moved = ours and all(said) and said != (_wn_num(item.get("season")), _wn_num(item.get("episode")))
                    if not ours or moved:
                        await log_seen(s["title"], s.get("subtitle"), app, dict(media_now))
                        if moved:
                            item["season"], item["episode"] = said
                untitled_step(pkg, app, bool(s and s.get("state") == "PLAYING" and not s.get("title")), pos,
                              titled=bool(s and s.get("state") == "PLAYING" and s.get("title")))
                await _paused_idle_step(media_now.get("state"), pkg)
            else:
                if not _blip(seen_playing.get("_playing")):
                    seen_playing["_playing"] = (None, time.time())   # the minute starts again after a break
                untitled_step(None, None, False, None)
                if media_now and not getattr(tv, "native_media", False):   # a Roku fills media_now itself
                    media_now.clear()
                    push_now()
                await _paused_idle_step(media_now.get("state") if getattr(tv, "native_media", False) else None, pkg)
            await untitled_resolve()
        except Exception as e:
            log.warning("media watch skipped: %s: %s", type(e).__name__, e)
        await asyncio.sleep(8 if busy else 10)


UNTITLED_KEEP_S = 3 * 3600   # how long after an untitled play its Watch Next row may still turn up
OPENED_WINDOW_S = 600        # a show couch-tv opened this long before the play started covers it


def untitled_step(pkg, app, untitled, pos, titled=False):
    """Netflix sends no title while it plays and Prime only its own name (issue #23), so there is
    nothing to log. Remember such a play here, per TV and with the person on the couch, once it has
    played continuously for the minute (and, when the app gives a position, past the minute too).
    untitled_resolve() then names it from Android's Watch Next row for that app."""
    now = time.time()
    u = seen_playing.get("_untitled")
    if not untitled or not app or app["id"] in NOT_KEPT:
        # a break before the minute starts it again; and once the same app names what it plays, a
        # later Watch Next row would be that show, not the earlier unnamed one
        if u and not u["done"] and ((not u["qualified"] and now - u["last"] >= 40) or (titled and pkg == u["pkg"])):
            seen_playing["_untitled"] = None
        return
    if not u or u["pkg"] != pkg or u["who"] != cur_who() or \
            ((u["done"] or u.get("opened")) and now - u["last"] > 600):
        u = {"pkg": pkg, "app": app, "who": cur_who(), "since": now, "last": now,
             "qualified": False, "done": False}
        # A show couch-tv itself opened in this app just before (phone search, Ask, a Keep
        # watching card) was logged when it was opened (play()): that already names the show. The
        # episode it logged is the one it asked for, so untitled_resolve() still reads the app's
        # Watch Next row for that show, and logs the episode the app says, if it is another one.
        item = playing["item"]
        if (item and item.get("package") == pkg and item.get("who") == cur_who()
                and now - OPENED_WINDOW_S <= item.get("ts", 0) <= now + 60):
            u["opened"], u["named_by"] = {"title": item.get("title"), "season": item.get("season"),
                                          "episode": item.get("episode")}, "opened"
    u["last"] = now
    if (not u["qualified"] and now - u["since"] >= SEEN_AFTER_S
            and (pos is None or pos >= SEEN_AFTER_S * 1000)):
        u["qualified"] = True
        log.info("untitled play counted in %s for %s: looking for its Watch Next row",
                 app["name"], u["who"] or "nobody")
    seen_playing["_untitled"] = u


def _wn_rows():
    """Watch Next rows for this TV: from the TV home app (POST /api/watch-next; the launcher holds
    READ_TV_LISTINGS, ADB's shell user cannot read other apps' rows) and from ADB where a TV allows it."""
    return list(seen_playing.get("_wn_rows") or [])


def wn_report(rows, u, now):
    """What the Watch Next matcher is looking at, for the log line and GET /api/watch-next: how many
    rows the home sent, from which apps, and for the app being played how each row failed the match
    (no engagement time, older than the play, or a title that is just the app's name)."""
    pkgs = {}
    for r in rows:
        pkgs[r.get("package")] = pkgs.get(r.get("package"), 0) + 1
    mine = []
    for r in rows:
        if u and r.get("package") == u["pkg"]:
            eng = r.get("engaged")
            if not eng:
                why = "no engagement time"
            elif eng < u["since"] - 120:
                why = f"engaged {round(u['since'] - eng)} s before the play started"
            elif generic_title(r.get("title"), u["pkg"], u["app"]):
                why = "title is only the app's name"
            else:
                why = "matches"
            mine.append({"title": r.get("title"), "engaged": eng, "why": why})
    return {"rows": len(rows), "apps": pkgs, "for_this_app": mine}


def _why_no_row(u, rows, now):
    """One log line a minute while an untitled play still has no Watch Next row, so a TV where it
    never arrives (couch-tv#23, Netflix on an Android 11 Xiaomi) says why instead of staying quiet."""
    if now - u.get("logged_at", 0) < 60:
        return
    u["logged_at"] = now
    rep = wn_report(rows, u, now)
    log.info("untitled play in %s: no Watch Next row yet. The home sent %d rows from %d apps, %d for this app%s",
             u["app"]["name"], rep["rows"], len(rep["apps"]), len(rep["for_this_app"]),
             "".join(f"; '{m['title']}': {m['why']}" for m in rep["for_this_app"][:3]))


async def untitled_resolve():
    u = seen_playing.get("_untitled")
    if not u or u["done"] or not u["qualified"]:
        return
    now = time.time()
    if now - u["last"] > UNTITLED_KEEP_S:
        seen_playing["_untitled"] = None
        return
    rows = _wn_rows()
    if now - seen_playing.get("_wn_adb_at", 0) > 60 and tv.connected and await tv.adb_ready():
        seen_playing["_wn_adb_at"] = now
        try:
            for it in await watch_next():
                pkg = (it.get("app") or {}).get("package")
                when = it.get("last_played")
                rows.append({"package": pkg, "title": it.get("title"), "episode_title": it.get("episode_title"),
                             "season": it.get("season"), "episode": it.get("episode"),
                             "poster": it.get("poster"),
                             "engaged": datetime.fromisoformat(when).timestamp() if when else None})
        except Exception:
            pass
    opened = u.get("opened")
    best = None
    for r in rows:
        if (r.get("package") == u["pkg"] and r.get("engaged") and r["engaged"] >= u["since"] - 120
                and not generic_title(r.get("title"), u["pkg"], u["app"])
                and (not opened or finder._norm(r.get("title") or "") == finder._norm(opened.get("title") or ""))):
            if not best or r["engaged"] > best["engaged"]:
                best = r
    if not best:
        if not opened:   # a play couch-tv opened is already logged: nothing to say while it waits
            _why_no_row(u, rows, now)
        return
    if opened:
        season, episode = _wn_num(best.get("season")), _wn_num(best.get("episode"))
        if not (season and episode) or (season, episode) == (_wn_num(opened.get("season")),
                                                           _wn_num(opened.get("episode"))):
            u["done"] = True   # the app agrees with what was logged when it was opened
            seen_playing["_untitled"] = u
            return
        # the app resumed (or moved on to) another episode than the one couch-tv logged
        best = {**best, "season": season, "episode": episode}
    u["done"], u["named_by"] = True, "watch-next"
    seen_playing["_untitled"] = u
    poster = best.get("poster") if str(best.get("poster") or "").startswith("https://") else None
    await log_seen(best["title"], best.get("episode_title"), u["app"],
                   {"season": best.get("season"), "episode": best.get("episode"),
                    "episode_title": best.get("episode_title")},
                   who=u["who"], method="watch-next", poster=poster)


async def h_watch_next(request):
    """The TV home app's copy of Android's Watch Next rows (it can read them, ADB cannot)."""
    data = await body(request)
    rows = []
    for r in (data.get("rows") or [])[:40]:
        if not isinstance(r, dict) or not isinstance(r.get("title"), str) or not isinstance(r.get("package"), str):
            continue
        try:
            engaged = float(r.get("engaged") or 0) / 1000 or None
        except (TypeError, ValueError):
            engaged = None
        rows.append({"package": r["package"][:200], "title": r["title"][:200],
                     "episode_title": (r.get("episode_title") or None) and str(r["episode_title"])[:200],
                     "season": str(r.get("season") or "")[:6] or None, "episode": str(r.get("episode") or "")[:6] or None,
                     "poster": None, "engaged": engaged})
    seen_playing["_wn_rows"] = rows
    seen_playing["_wn_at"] = time.time()
    await untitled_resolve()
    return ok(rows=len(rows))


async def h_watch_next_get(request):
    """What the home last sent, and how the matcher sees it, for finding out why an app's play never
    gets named (couch-tv#23). Read only."""
    u = seen_playing.get("_untitled")
    rows = _wn_rows()
    at = seen_playing.get("_wn_at")
    return ok(received_s_ago=round(time.time() - at) if at else None,
              untitled=None if not u else {"package": u["pkg"], "qualified": u["qualified"], "done": u["done"],
                                           "named_by": u.get("named_by"),
                                           "started_s_ago": round(time.time() - u["since"])},
              report=wn_report(rows, u, time.time()),
              rows=rows)


async def log_seen(title, subtitle, app, now=None, who=None, method="seen", poster=None):
    """Log a show seen playing, with the season and episode media_read worked out (`now`, a copy of
    media_now), on this TV for the person on the couch here (or `who`, the person picked when it
    played). Only a show of the same name gets the finder's title and picture; a near miss keeps the
    app's own title and no picture. Videos and music are never logged (NOT_KEPT)."""
    if app.get("id") in NOT_KEPT:
        return
    now = now or {}
    fallback_poster = poster
    poster = backdrop = year = kind = None
    show = title
    try:
        names = [finder._norm(title)] + ([finder._norm(subtitle)] if subtitle else [])
        best, _ = await finder.find(title)
        if subtitle and not (app.get("id") in YEAR_SUBTITLE_APPS and str(subtitle).strip().isdigit()) and (not best or finder._norm(best["title"]) not in names):
            alt, _ = await finder.find(subtitle)
            if alt and finder._norm(alt["title"]) in names:
                best = alt
        if best and finder._norm(best["title"]) in names:
            show, poster, backdrop, year, kind = (best["title"], best["poster"], best["backdrop"],
                                                  best["year"], best["type"])
    except Exception:
        pass
    store.add_history({"title": show, "year": year, "type": kind, "poster": poster or fallback_poster,
                       "backdrop": backdrop, "service": app["id"] or app["package"],
                       "who": who if who is not None else cur_who(), "tv": _current.get(),
                       "season": now.get("season"), "episode": now.get("episode"),
                       "episode_title": now.get("episode_title") or subtitle,
                       "when": now_iso(), "method": method})
    log.info("logged %s on %s (%s)", show, app["name"], method)


# ---------- picture mode: a switch between the TV's two modes in picture.modes ----------
def _picture_ids():
    return list((tv.picture_cfg.get("values") or {}).keys())[:2]


def _other_mode(cur):
    ids = _picture_ids()
    if len(ids) < 2:
        raise ApiError(409, "picture.modes needs two mode names in config.json")
    return ids[1] if cur == ids[0] else ids[0]

async def read_picture():
    """The TV's picture mode (one of the two mode ids, or "other"), or None when it cannot be read.
    Only for TVs with a "picture" entry in config.json."""
    if not tv.picture_cfg or not (tv.paired and tv.connected and await tv.adb_ready()):
        return None
    if tv.picture_cfg.get("method") == "panel":
        # Reading means opening the panel on screen, so between switches report what we last saw.
        return picture_state.get("mode")
    raw = (await tv.adb("shell", "settings", "get", "global", "picture_mode", timeout=8)).strip()
    values = tv.picture_cfg.get("values") or {}
    mode = next((name for name, v in values.items() if str(v) == raw), "other")
    old = picture_state.get("mode")
    picture_state.update({"mode": mode, "raw": raw, "read_at": time.time()})
    if old != mode:
        push_now()
    return mode


async def h_picture_get(request):
    if not tv.picture_cfg:
        return ok(mode=None, supported=False, can_set=False)
    mode = await read_picture()
    return ok(mode=mode, raw=picture_state.get("raw"), supported=True,
              can_set=bool(tv.picture_cfg.get("can_set")), modes=config.picture_modes(tv.picture_cfg))


async def h_picture_set(request):
    data = await body(request)
    want = data.get("mode")
    if not tv.picture_cfg:
        raise ApiError(409, f"picture mode is not supported on the {tv.name.lower()} TV")
    if want not in (*_picture_ids(), "toggle"):
        raise ApiError(400, "mode must be " + ", ".join(_picture_ids()) + " or toggle")
    if not tv.picture_cfg.get("can_set"):
        raise ApiError(409, "picture mode switching is not set up on this TV yet")
    tv.require()
    if tv.picture_cfg.get("method") == "panel":
        mode = await set_picture_panel(want)
        record_action(request, "picture", {"mode": mode}, True)
        return ok(mode=mode, can_set=True)
    cur = await read_picture()
    if want == "toggle":
        want = _other_mode(cur)
    if cur != want:
        await set_picture(want)
        for _ in range(12):
            await asyncio.sleep(0.25)
            if await read_picture() == want:
                break
    record_action(request, "picture", {"mode": want}, True)
    return ok(mode=picture_state.get("mode"), can_set=True)


async def h_bluetooth_audio_get(request):
    supported = hasattr(tv, "open_bluetooth_settings") and bool(await tv.adb_ready())
    return ok(supported=supported)


async def h_bluetooth_audio_set(request):
    tv.require()
    if not hasattr(tv, "open_bluetooth_settings"):
        raise ApiError(409, f"Bluetooth screen is not supported on this {tv.name} TV")
    try:
        await tv.open_bluetooth_settings()
        record_action(request, "bluetooth_audio", {"action": "open_settings"}, True)
        return ok()
    except TVUnavailable as e:
        raise ApiError(503, str(e))
    except Exception as e:
        raise ApiError(500, f"could not open Bluetooth settings: {e}")


async def set_picture(mode):
    """Filled in once the switch method is tested on the TV (see API.md, picture mode)."""
    raise ApiError(409, "picture mode switching is not set up on this TV yet")


# Some TVs only change picture mode inside its own settings app, so we open its
# Picture Mode panel, read the ticked row, move to the wanted row and press OK.
PANEL_DUMP = "uiautomator dump /sdcard/couch-ui.xml >/dev/null && cat /sdcard/couch-ui.xml"


def _panel_rows(xml):
    """Rows of the panel in screen order: title, ticked, focused, enabled."""
    def attr(n, name):
        m = _re.search(f' {name}="([^"]*)"', n)
        return m.group(1) if m else ""
    rows = []
    for n in _re.findall(r"<node [^>]*>", xml):
        cls = attr(n, "class")
        if cls.endswith("LinearLayout") and attr(n, "focusable") == "true":
            rows.append({"title": None, "checked": False, "focused": attr(n, "focused") == "true",
                         "enabled": attr(n, "enabled") == "true"})
        elif rows and cls.endswith("TextView") and rows[-1]["title"] is None:
            rows[-1]["title"] = attr(n, "text")
        elif rows and cls.endswith("RadioButton"):
            rows[-1]["checked"] = attr(n, "checked") == "true"
    return [r for r in rows if r["title"]]


picture_panel_lock = asyncio.Lock()


async def set_picture_panel(want):
    # One switch at a time: two presses driving the same panel mix up the cursor moves, and a
    # queued second press would only switch it back. So a press during a switch is turned away.
    if picture_panel_lock.locked():
        raise ApiError(409, "Still switching the picture, one moment.")
    async with picture_panel_lock:
        return await _set_picture_panel(want)


async def _set_picture_panel(want):
    titles = tv.picture_cfg.get("values") or {}   # {"calibrated": "Calibrated", "dynamic": "Dynamic"}
    names = {t.lower(): name for name, t in titles.items()}
    # One round trip: open the panel, let it draw, read it (the read alone is about 3.5 s).
    rows = _panel_rows(await tv.adb(
        "shell", "am start -a android.settings.PICTURE_MODE_SETTINGS >/dev/null && sleep 1 && "
        + PANEL_DUMP, timeout=15))
    ticked = next((r["title"] for r in rows if r["checked"]), None)
    cur = names.get((ticked or "").lower(), "other")
    if want == "toggle":
        want = _other_mode(cur)
    if cur == want:
        await tv.adb("shell", "input keyevent KEYCODE_BACK", timeout=5)
        picture_state.update({"mode": cur, "raw": ticked, "read_at": time.time()})
        push_now()
        return cur
    usable = [r for r in rows if r["enabled"]]   # the cursor skips greyed rows (Game)
    at = next((i for i, r in enumerate(usable) if r["focused"]), None)
    to = next((i for i, r in enumerate(usable) if r["title"].lower() == titles[want].lower()), None)
    if at is None or to is None:
        await tv.adb("shell", "input keyevent KEYCODE_BACK", timeout=5)
        raise ApiError(502, f"could not find {titles[want]} in the TV's Picture Mode panel")
    log.info("picture panel: ticked %s, want %s, cursor row %s -> %s, rows %s", ticked, want, at, to,
             [r["title"] for r in usable])
    key = "KEYCODE_DPAD_DOWN" if to > at else "KEYCODE_DPAD_UP"
    # One `input` call for the moves and OK: each call costs about 1.5 s on this TV. A second
    # read to check the cursor cost 4 s more and never caught a miss in testing, so it went.
    await tv.adb("shell", "input keyevent " + " ".join([key] * abs(to - at) + ["KEYCODE_DPAD_CENTER"]),
                 timeout=8)
    await asyncio.sleep(0.8)
    front = await tv.adb("shell", "dumpsys activity activities | grep -m1 mResumedActivity", timeout=8)
    if "PictureModeActivity" in front:   # the panel usually closes itself after OK
        await tv.adb("shell", "input keyevent KEYCODE_BACK", timeout=5)
    picture_state.update({"mode": want, "raw": titles[want], "read_at": time.time()})
    push_now()
    return want


# ---------- imported history and taste ----------
_import_lock = asyncio.Lock()


async def run_import():
    """Import whatever is in data/inbox/, then rebuild the taste profile and picks."""
    async with _import_lock:
        report = await asyncio.get_running_loop().run_in_executor(None, history_import.run)
        new = sum(r.get("new") or 0 for r in report)
        if new:
            log.info("imported %s new history items", new)
        if new or not os.path.exists(taste.TASTE):
            await taste.build()
            for who in (None, *config.PEOPLE_IDS):
                asyncio.ensure_future(claude.refresh_recs(who, force=True))
        return report


async def history_loop():
    """Hourly: pick up files dropped in data/inbox/. Daily: rebuild the taste profile (new plays
    on the TVs, and "watching now" turning into "dropped")."""
    await asyncio.sleep(30)
    last_build = 0.0
    while True:
        try:
            done = os.path.join(history_import.INBOX, "done")
            waiting = [f for root, _, fs in os.walk(history_import.INBOX)
                       if not root.startswith(done) for f in fs if not f.startswith(".")]
            if waiting:
                await run_import()
            if time.time() - last_build > 24 * 3600:
                await taste.build()
                last_build = time.time()
        except Exception as e:
            log.warning("history import/taste failed: %s: %s", type(e).__name__, e)
        await asyncio.sleep(3600)


async def h_import(request):
    report = await run_import()
    return ok(report=report, imported_total=len(store.imported()))


async def h_taste(request):
    who = store.norm_who(request.query.get("who"))
    data = taste.load()
    if request.query.get("rebuild") or not data:
        data = await taste.build()
    person = who if who in config.PEOPLE_IDS else "everyone"
    return ok(built=data.get("built"), sources=data.get("sources"), who=person,
              profile=(data.get("people") or {}).get(person), summary=taste.summary(who))


# ---------- keep the stock home screen off ----------


# Never switched off by the guard, even when an old keep-disabled file lists them: couch-tv 0.10 and
# older wrote the TV's own homes and the setup wizard there, and with them off some Google TVs loop
# at power on (docs/TROUBLESHOOTING.md, "If your TV loops after a restart").
NEVER_DISABLE = {"com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher",
                 "com.google.android.tungsten.setupwraith"}


stock_home_done = set()


async def keep_disabled_loop():
    """Daily, per TV: re-disable packages listed in that TV's keep-disabled file (the living
    room's is data/keep-disabled.json, written by apply.sh: ambient mode and any ad tracker). A
    Google TV update can switch them back on. If the TV is off, try again hourly. The TV's own home
    screens and setup wizard are never switched off (NEVER_DISABLE)."""
    await asyncio.sleep(60)
    while True:
        done = False
        path = os.path.join(HERE, tv.keep_disabled_file or "")
        try:
            with open(path) as f:
                listed = json.load(f)
            packages = [p for p in listed if p not in NEVER_DISABLE]
            to_enable = [p for p in listed if p in NEVER_DISABLE]   # only what couch-tv's own file says it switched off
        except (FileNotFoundError, IsADirectoryError, json.JSONDecodeError, TypeError):
            packages, to_enable = [], []
        if not packages and not to_enable:
            done = True
        elif tv.paired and await tv.adb_ready():
            try:
                disabled = await tv.adb("shell", "pm", "list", "packages", "-d")
                # One time, per TV: couch-tv 0.10 and older switched the TV's own homes and setup
                # wizard off (that is the boot loop). Switch back on any that are installed and off.
                if tv.id not in stock_home_done:
                    for pkg in to_enable:
                        if f"package:{pkg}" in disabled.split():
                            await tv.adb("shell", "pm", "enable", pkg)
                            log.warning("%s: switched %s back on (couch-tv 0.10 and older had switched it off)", tv.id, pkg)
                    stock_home_done.add(tv.id)
                for pkg in packages:
                    if f"package:{pkg}" not in disabled.split():
                        await tv.adb("shell", "pm", "disable-user", "--user", "0", pkg)
                        log.warning("%s: re-disabled %s (it had been switched back on)", tv.id, pkg)
                done = True
            except Exception as e:
                log.warning("%s: keep-disabled check failed: %s", tv.id, e)
        await asyncio.sleep(24 * 3600 if done else 3600)


def _maybe_refresh_installed():
    if tv.adb_ok and installed["packages"] is None:
        asyncio.ensure_future(installed_packages(wait=False))


# ---------- close apps when the TV turns off ----------
# Some apps refresh their sign-in the moment the TV wakes, before its Wi-Fi is back, and sign out
# when that fails (Disney+ 26.20, November 2026: the network returned 1 s after it gave up). Apps
# listed in "close_on_off" for a TV in config.json are force-stopped when that TV turns off, so
# the next time they open they start fresh, with the network already up.
_last_on = {}


def _close_on_off():
    t = TVS[_current.get()]
    on, was = t.is_on, _last_on.get(t.id)
    if on is not None:
        _last_on[t.id] = on
    if was is True and on is False and t.kind == "android":
        cfg = next((c for c in config.TVS if c["id"] == t.id), {})
        packages = [p for p in cfg.get("close_on_off") or [] if isinstance(p, str) and p]
        if packages:
            asyncio.ensure_future(_force_stop(t, packages))


async def _force_stop(t, packages):
    try:
        if not (t.paired and await t.adb_ready()):
            log.info("%s: turned off, could not reach ADB to close %s", t.id, ", ".join(packages))
            return
        for pkg in packages:
            await t.adb("shell", "am", "force-stop", pkg)
        log.info("%s: turned off, closed %s", t.id, ", ".join(packages))
    except Exception as e:
        log.warning("%s: closing apps on turn off failed: %s", t.id, e)


async def h_tvs(request):
    out = []
    for tv_id, t in TVS.items():
        on = t.is_on
        row = {"id": tv_id, "name": t.name, "kind": t.kind, "paired": t.paired, "picture": bool(t.picture_cfg),
               "connected": t.connected, "adb": t.adb_ok, "power": "unknown" if on is None else ("on" if on else "off")}
        if t.kind == "samsung":
            row |= {"art_mode": t.art_mode, "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "lg":
            row |= {"devmode": t.devmode_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "roku":
            row |= {"ecp": t.ecp_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "vidaa":
            row |= {"vidaa": t.vidaa_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "philips":
            row |= {"philips": t.philips_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "vega":
            row |= {"vega": t.vega_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "vizio":
            row |= {"vizio": t.vizio_status()}
        elif t.kind == "panasonic":
            row |= {"panasonic": t.panasonic_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "tivo":
            row |= {"tivo": t.tivo_status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        elif t.kind == "appletv":
            row |= {"appletv": t.status(), "hook": [f"{w} {what}" for w, what in t.hook_log]}
        out.append(row)
    return ok(default=DEFAULT_TV, tvs=out)


# ---------- app ----------
def make_app():
    app = web.Application(middlewares=[middleware])
    r = app.router
    r.add_get("/api/health", h_health)
    r.add_post("/api/pair", h_pair)
    r.add_get("/bridge/shim.js", h_bridge_shim)
    r.add_get("/api/tvs", h_tvs)
    r.add_get("/api/now", h_now)
    r.add_get("/api/events", h_events)
    r.add_post("/api/key", h_key)
    r.add_post("/api/pointer", h_pointer)
    r.add_post("/api/text", h_text)
    r.add_get("/api/apps", h_apps)
    r.add_post("/api/launch", h_launch)
    r.add_get("/api/find", h_find)
    r.add_post("/api/play", h_play)
    r.add_post("/api/ask", h_ask)
    r.add_get("/api/tizen/next", h_tizen_next)
    r.add_post("/api/tizen/answer", h_tizen_answer)
    r.add_get("/api/webos/apps", h_webos_apps)
    r.add_get("/api/roku/apps", h_roku_apps)
    r.add_get("/api/roku/icon/{id}", h_roku_icon)
    r.add_get("/api/vega/keys", h_vega_keys)
    r.add_post("/api/appletv/pair", h_appletv_pair)
    r.add_post("/api/appletv/code", h_appletv_code)
    r.add_post("/api/appletv/claim", h_appletv_claim)
    r.add_get("/api/appletv/hello", h_appletv_hello)
    r.add_get("/api/appletv/apps", h_appletv_apps)
    r.add_post("/api/appletv/open", h_appletv_open)
    r.add_get("/api/appletv/kids", h_appletv_kids)
    r.add_post("/api/appletv/kids/open", h_appletv_kids_open)
    r.add_post("/api/vidaa/pair", h_vidaa_pair)
    r.add_post("/api/vidaa/tile", h_vidaa_tile)
    r.add_post("/api/vidaa/claim", h_vidaa_claim)
    r.add_post("/api/philips/pair", h_philips_pair)
    r.add_get("/api/philips/apps", h_philips_apps)
    r.add_get("/api/philips/sources", h_philips_sources)
    r.add_post("/api/philips/source", h_philips_source)
    r.add_post("/api/vizio/pair", h_vizio_pair)
    r.add_get("/api/vizio/apps", h_vizio_apps)
    r.add_post("/api/panasonic/pair", h_panasonic_pair)
    r.add_get("/api/recs", h_recs)
    r.add_get("/api/history", h_history)
    r.add_get("/api/taste", h_taste)
    r.add_post("/api/import", h_import)
    r.add_get("/api/picture", h_picture_get)
    r.add_post("/api/picture", h_picture_set)
    r.add_get("/api/bluetooth-audio", h_bluetooth_audio_get)
    r.add_post("/api/bluetooth-audio", h_bluetooth_audio_set)
    r.add_get("/api/people", h_people_get)
    r.add_post("/api/people", h_people_set)
    r.add_get("/api/who", h_who_get)
    r.add_get("/api/kids", h_kids_get)
    r.add_post("/api/kids", h_kids_set)
    r.add_post("/api/who", h_who_set)
    r.add_get("/api/weather", h_weather)
    r.add_get("/api/config", h_config)
    r.add_post("/api/home-apps", h_home_apps)
    r.add_get("/api/app-order", h_app_order_get)
    r.add_post("/api/app-order", h_app_order_set)
    r.add_get("/api/settings", h_settings_get)
    r.add_post("/api/settings", h_settings_set)
    r.add_get("/api/continue", h_continue)
    r.add_get("/api/music", h_music)
    r.add_get("/api/spotify/login", h_spotify_login)
    r.add_get("/api/spotify/callback", h_spotify_callback)
    r.add_get("/api/spotify/status", h_spotify_status)
    r.add_post("/api/continue/open", h_continue_open)
    r.add_post("/api/watch-next", h_watch_next)
    r.add_get("/api/watch-next", h_watch_next_get)
    r.add_get("/api/sleep", h_sleep_get)
    r.add_post("/api/sleep", h_sleep_set)
    r.add_post("/api/idle/cancel", h_idle_cancel)
    r.add_get("/api/screens", h_screens)
    r.add_post("/api/screens/open", h_screens_open)
    r.add_post("/api/power", h_power)
    r.add_post("/api/volume", h_volume)
    r.add_get("/api/screenshot", h_screenshot)
    agentic.routes(r)
    r.add_route("OPTIONS", "/api/{tail:.*}", h_options)
    r.add_route("*", "/api/{tail:.*}", h_api_missing)
    r.add_get("/vidaa/icon.png", h_vidaa_icon)
    r.add_get("/titan/{path:.*}", static_handler(TITAN_DIR, "Titan OS start page"))
    r.add_get("/tv", h_tv_redirect)
    r.add_get("/tv/manifest.json", h_tv_manifest)
    r.add_get("/tv/config.js", h_tv_config_js)
    r.add_get("/tv/{path:.*}", static_handler(LAUNCHER_DIR, "TV home screen"))
    r.add_get("/{path:.*}", static_handler(REMOTE_DIR, "Remote"))

    async def on_startup(_):
        # Keep references so the loops are never garbage collected.
        app["loops"] = [asyncio.create_task(claude.background_loop()),
                        asyncio.create_task(history_loop())]
        for tv_id, t in TVS.items():
            t.on_change(lambda tv_id=tv_id: with_tv(tv_id, push_now))
            t.on_change(lambda tv_id=tv_id: with_tv(tv_id, _maybe_refresh_installed))
            t.on_change(lambda tv_id=tv_id: with_tv(tv_id, _close_on_off))
            ends = store.sleep_ends(tv_id)
            if ends and datetime.fromisoformat(ends).timestamp() > time.time():
                with_tv(tv_id, _sleep_set, ends)
            await t.start()
            if t.paired:
                app["loops"] += [for_tv(tv_id, keep_disabled_loop), for_tv(tv_id, media_watch_loop)]
        app["bonjour"] = await advertise_for_appletv()

    async def on_cleanup(_):
        if finder._session and not finder._session.closed:
            await finder._session.close()
        if app.get("bonjour"):
            zc, info = app["bonjour"]
            await zc.async_unregister_service(info)
            await zc.async_close()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host=os.environ.get("BIND_HOST", "0.0.0.0"), port=PORT,
                access_log=None, print=lambda *_: log.info("listening on %s", PORT))
