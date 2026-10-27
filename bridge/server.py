"""Couch TV bridge: the HTTP API in API.md, on port 5400 by default.

Run: .venv/bin/python bridge/server.py   (settings come from config.json, see config.example.json)
"""
import asyncio
import contextvars
import json
import logging
import mimetypes
import os
import time
from collections.abc import MutableMapping
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from aiohttp import web

import apps
import config
import finder
import history_import
import store
import taste
from tv import TV, TVUnavailable, intent_to_link
import samsung

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REMOTE_DIR = os.path.join(ROOT, "remote", "dist")
LAUNCHER_DIR = os.path.join(ROOT, "tv-home", "web")
PORT = int(os.environ.get("PORT") or config.BRIDGE["port"])
HOME_TZ = ZoneInfo(config.TIMEZONE)   # the home's time zone (weather.timezone in config.json)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("bridge")

# ---------- which TV ----------
# Every request runs for one TV: ?tv= or "tv" in the body, default the living room. The names
# below (tv, playing, media_now, ...) always mean "the TV this request or loop is for".
TV_CONFIG = {"default": config.DEFAULT_TV, "tvs": config.TVS}


def make_tv(cfg):
    """A Samsung ("kind": "samsung", bridge/samsung.py) or an Android or Google TV (tv.py)."""
    return samsung.SamsungTV(cfg) if cfg.get("kind") == "samsung" else TV(cfg)


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


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def ok(**fields):
    return web.json_response({"ok": True, **fields})


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
@web.middleware
async def middleware(request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
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
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Ask-Id"
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
        out_playing = {k: v for k, v in item.items() if k != "package"} | {"source": "bridge"}
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
    return {
        "tv_connected": tv.connected,
        "adb": tv.adb_ok,
        "power": "unknown" if on is None else ("on" if on else "off"),
        "app": apps.describe_package(pkg),
        "volume": tv.volume,
        "playing": out_playing,
        "sleep": {"ends": sleep["ends"]},
        "waking": waking["on"],
        "who": store.current_who(),
        "picture": picture_state.get("mode"),
    }


# ---------- handlers ----------
async def h_health(request):
    return ok(tv_connected=tv.connected, adb=tv.adb_ok, version="1")


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
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*", "X-Accel-Buffering": "no"})
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
    await tv.key(str(key), hold=bool(data.get("hold")))
    record_action(request, "key", {"key": key}, True)
    return ok(key=key)


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


async def search_in_app(app, title):
    """Open the app on its search with the title typed in, or just the app."""
    from urllib.parse import quote
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
            method, note = await search_in_app(app, best["title"])
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
            await tv.start_intent(link, app["package"], cold=bool(cold))
            if await tv.wait_for_app({app["package"]}, timeout=10):
                method = "deeplink"
        except Exception as e:
            log.warning("deep link failed for %s: %s", app["id"], e)
        if method and app.get("verify") and tv.can_read_media:
            started = await wait_until_playing(app["package"])
            log.info("play %s in %s: %s", best["title"], app["name"],
                     "playing" if started else "not playing yet")
            if started:
                note = f"{best['title']} is playing in {app['name']}."
            else:
                note = (f"{app['name']} is open, but {best['title']} has not started. If it asks "
                        "who is watching, pick a profile, then ask again.")
    if method is None:
        method, note = await search_in_app(app, best["title"])
    result = finish_play(best, app, method, note, season, episode, who)
    if started is not None:
        result["started"] = started
    return result


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
            "package": app["package"]} | extra
    playing["item"] = item
    store.add_history({"title": best["title"], "year": best["year"], "type": best["type"],
                       "poster": best["poster"], "backdrop": best["backdrop"],
                       "service": app["id"], "who": who,
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
    # No season asked for: open the show where they are up to, never episode 1.
    result = await play(title, data.get("season"), data.get("episode"), data.get("service"),
                        store.norm_who(data.get("who")) or store.current_who(),
                        resume=not data.get("season"))
    record_action(request, "play", {k: data[k] for k in ("title", "season", "episode", "service")
                                    if data.get(k)}, True)
    return ok(**result)


async def h_who_get(request):
    return ok(who=store.current_who())


async def h_who_set(request):
    data = await body(request)
    who = store.norm_who(data.get("who"))
    if not who:
        raise ApiError(400, "who must be " + ", ".join(config.PEOPLE_IDS) + " or both")
    store.save_who(who)
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
    if store.current_who() not in (None, "both", *config.PEOPLE_IDS):
        store.save_who(None)   # the person on the couch was removed
    record_action(request, "people", {"count": len(config.PEOPLE)}, True)
    for tv_id in TVS:
        with_tv(tv_id, push_now)
    return ok(people=config.PEOPLE)


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
async def h_power(request):
    data = await body(request)
    state = data.get("state")
    if state not in ("on", "off", "toggle"):
        raise ApiError(400, "state must be on, off or toggle")
    started = time.monotonic()
    log.info("power %s requested (connected=%s, is_on=%s)", state, tv.connected, tv.is_on)
    if state == "on":
        waking["on"] = True
        push_now()
        try:
            await power_on()
        finally:
            waking["on"] = False
            push_now()
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
        if step == "wol":
            await tv.wake()
        else:
            await tv.key(step)
        for _ in range(16):
            await asyncio.sleep(0.25)
            if tv.is_on:
                break
    if not tv.is_on:
        raise TVUnavailable("the TV is on the network but did not switch on; try again")


async def h_volume(request):
    data = await body(request)
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
    result = await claude.ask(text, store.norm_who(data.get("who")) or store.current_who(), asks,
                              _current.get())
    return ok(**result)


async def h_recs(request):
    who = store.norm_who(request.query.get("who"))
    picks, updated = await claude.cached_recs(who)
    return web.json_response({"ok": True, "updated": updated,
                              "continue": store.continue_watching(who), "picks": picks})


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
continue_cache = {"items": [], "links": {}, "ts": 0.0}
# Apps kept out of Keep watching (YouTube here: it can bury
# everything else). The history is still recorded, it just is not listed.
CONTINUE_SKIP = {"youtube"}


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


async def continue_items(who=None):
    # Android's Watch Next rows are not readable over ADB on this TV (needs a system
    # permission), so the list is our own history only. watch_next() stays for a TV that allows it.
    out, links, seen = [], {}, set()
    for it in continue_cache["items"]:
        if it.get("service") in CONTINUE_SKIP:
            continue
        links[it["id"]] = ("link", it["_link"], it.get("app"))
        seen.add(it["title"].lower())
        out.append({k: v for k, v in it.items() if k != "_link"})
    for n, h in enumerate(store.continue_watching(who, limit=60)):
        if h["title"].lower() in seen or h.get("service") in CONTINUE_SKIP:
            continue
        hid = f"h-{n}"
        links[hid] = ("play", h, None)
        app = apps.BY_ID.get(h.get("service"))
        out.append({"id": hid, "title": h["title"], "episode_title": None,
                    "season": h.get("season"), "episode": h.get("episode"),
                    "app": apps.describe_package(app["package"]) if app else None,
                    "service": h.get("service"), "poster": h.get("poster"),
                    "backdrop": h.get("backdrop"), "progress": None, "kind": "continue",
                    "last_played": h.get("last_played"), "source": "bridge"})
    out.sort(key=lambda i: i.get("last_played") or "", reverse=True)
    continue_cache["links"] = links
    return out


async def h_continue(request):
    who = store.norm_who(request.query.get("who"))
    return ok(items=await continue_items(who))


async def h_continue_open(request):
    data = await body(request)
    cid = data.get("id")
    if cid not in continue_cache["links"]:
        await continue_items()
    entry = continue_cache["links"].get(cid)
    if not entry:
        raise ApiError(404, f"unknown continue item: {cid}")
    kind, target, app = entry
    if kind == "play":
        result = await play(target["title"], target.get("season"), target.get("episode"),
                            target.get("service"),
                            store.norm_who(data.get("who")) or store.current_who(), resume=True)
        record_action(request, "continue", {"id": cid}, True)
        return ok(**result)
    if not target:
        if not app:
            raise ApiError(409, "that item has no link to resume")
        got, _ = await launch_app({"id": app["id"], "name": app["name"], "package": app["package"]})
    else:
        await tv.start_intent(target, app["package"] if app else None)
        got = await tv.wait_for_app({app["package"]} if app else set(), timeout=8) if app else True
    record_action(request, "continue", {"id": cid}, bool(got))
    return ok(app=apps.describe_package(tv.current_package))


# ---------- which episode, and how long (only when matched, never a guess) ----------
import re as _re

SXE = [_re.compile(r"\bS(?:eason)?\s*(\d{1,2})\s*[:,.\- ]?\s*E(?:p(?:isode)?)?\s*(\d{1,3})\b", _re.I),
       _re.compile(r"\bSeason\s+(\d{1,2}),?\s+Episode\s+(\d{1,3})\b", _re.I),
       _re.compile(r"\b(\d{1,2})x(\d{1,3})\b")]
episode_cache = {}  # (title, subtitle) -> result dict


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


async def resolve_episode(title, subtitle):
    """Season, episode, episode title and length for what an app reports. Matches the show by
    exact title on JustWatch, then the episode by an SxE number or an exact episode title.
    Films: the film's runtime when the title matches exactly. {} when nothing matches."""
    key = (title or "", subtitle or "")
    if key in episode_cache:
        return episode_cache[key]
    result = {}
    try:
        for show, other in ((title, subtitle), (subtitle, title)):
            if not show:
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
    """Pull package, state, position and title out of `cat /proc/uptime; dumpsys media_session`.
    PlaybackState `updated` is the TV's elapsed time since boot in ms, the same clock as the
    first number in /proc/uptime, so the position can be brought up to the moment of reading."""
    import re
    found, cur = [], None
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
            for key in ("position", "updated"):
                m = re.search(rf"[ {{]{key}=(-?\d+)", line)
                cur[key] = int(m.group(1)) if m else None
            m = re.search(r"speed=([-\d.]+)", line)
            cur["speed"] = float(m.group(1)) if m else 0.0
        elif line.startswith("metadata:") and "description=" in line and cur is not None:
            parts = [p.strip() for p in line.split("description=", 1)[1].split(", ")]
            cur["title"] = parts[0] if parts and parts[0] != "null" else None
            cur["subtitle"] = parts[1] if len(parts) > 1 and parts[1] != "null" else None
    return found


STATES = {"PLAYING": "playing", "PAUSED": "paused", "BUFFERING": "buffering",
          "CONNECTING": "buffering", "FAST_FORWARDING": "playing", "REWINDING": "playing",
          "SKIPPING_TO_NEXT": "buffering", "SKIPPING_TO_PREVIOUS": "buffering",
          "SKIPPING_TO_QUEUE_ITEM": "buffering", "STOPPED": "stopped", "NONE": "stopped",
          "ERROR": "stopped"}


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
                if best:
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
    ep = {}
    if title:
        ep = await resolve_episode(title, episode_title)
        # Some apps (Paramount+) send the episode name first and the show second: "A Different
        # Corner, Mobland". Use the field that matched the show, or the poster comes from the wrong one.
        if ep.get("show") and finder._norm(ep["show"]) != finder._norm(title):
            title, episode_title = ep["show"], title
        s["title"], s["subtitle"] = title, episode_title
    else:
        title, episode_title = _fallback_title(pkg)
        source_title = "bridge" if title else None
    art = await artwork(title)
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
                if s and s.get("state") == "PLAYING" and s.get("title"):
                    key = (pkg, s["title"].lower())
                    item = playing["item"]
                    if time.time() - seen_playing.get(key, 0) >= 1800:
                        seen_playing[key] = time.time()
                        # Our own /api/play already logged it if it is the same show.
                        if not (item and item["title"].lower() in
                                (s["title"].lower(), (s.get("subtitle") or "").lower())):
                            await log_seen(s["title"], s.get("subtitle"), app)
            elif media_now:
                media_now.clear()
                push_now()
        except Exception as e:
            log.warning("media watch skipped: %s: %s", type(e).__name__, e)
        await asyncio.sleep(8 if busy else 10)


async def log_seen(title, subtitle, app):
    poster = backdrop = year = kind = None
    show = title
    try:
        best, _ = await finder.find(title)
        # an exact name match on either field wins over a near miss on the first one
        if subtitle and (not best or finder._norm(best["title"]) != finder._norm(title)):
            alt, _ = await finder.find(subtitle)
            if alt and (not best or finder._norm(alt["title"]) == finder._norm(subtitle)):
                best = alt
        if best:
            show, poster, backdrop, year, kind = (best["title"], best["poster"], best["backdrop"],
                                                  best["year"], best["type"])
    except Exception:
        pass
    store.add_history({"title": show, "year": year, "type": kind, "poster": poster,
                       "backdrop": backdrop, "service": app["id"] or app["package"],
                       "who": store.current_who(),
                       "season": None, "episode": None, "episode_title": subtitle,
                       "when": now_iso(), "method": "seen"})
    log.info("logged %s on %s", show, app["name"])


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


async def keep_disabled_loop():
    """Daily, per TV: re-disable packages listed in that TV's keep-disabled file (the living
    room's is data/keep-disabled.json, written by apply.sh when it switches the Google home screen
    off). A Google TV update can switch them back on. If the TV is off, try again hourly."""
    await asyncio.sleep(60)
    while True:
        done = False
        path = os.path.join(HERE, tv.keep_disabled_file or "")
        try:
            with open(path) as f:
                packages = json.load(f)
        except (FileNotFoundError, IsADirectoryError, json.JSONDecodeError):
            packages = []
        if not packages:
            done = True
        elif tv.paired and await tv.adb_ready():
            try:
                disabled = await tv.adb("shell", "pm", "list", "packages", "-d")
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


async def h_tvs(request):
    out = []
    for tv_id, t in TVS.items():
        on = t.is_on
        row = {"id": tv_id, "name": t.name, "kind": t.kind, "paired": t.paired, "picture": bool(t.picture_cfg),
               "connected": t.connected, "adb": t.adb_ok, "power": "unknown" if on is None else ("on" if on else "off")}
        if t.kind == "samsung":
            row |= {"art_mode": t.art_mode, "hook": [f"{w} {what}" for w, what in t.hook_log]}
        out.append(row)
    return ok(default=DEFAULT_TV, tvs=out)


# ---------- app ----------
def make_app():
    app = web.Application(middlewares=[middleware])
    r = app.router
    r.add_get("/api/health", h_health)
    r.add_get("/api/tvs", h_tvs)
    r.add_get("/api/now", h_now)
    r.add_get("/api/events", h_events)
    r.add_post("/api/key", h_key)
    r.add_post("/api/text", h_text)
    r.add_get("/api/apps", h_apps)
    r.add_post("/api/launch", h_launch)
    r.add_get("/api/find", h_find)
    r.add_post("/api/play", h_play)
    r.add_post("/api/ask", h_ask)
    r.add_get("/api/recs", h_recs)
    r.add_get("/api/history", h_history)
    r.add_get("/api/taste", h_taste)
    r.add_post("/api/import", h_import)
    r.add_get("/api/picture", h_picture_get)
    r.add_post("/api/picture", h_picture_set)
    r.add_get("/api/people", h_people_get)
    r.add_post("/api/people", h_people_set)
    r.add_get("/api/who", h_who_get)
    r.add_post("/api/who", h_who_set)
    r.add_get("/api/weather", h_weather)
    r.add_get("/api/config", h_config)
    r.add_post("/api/home-apps", h_home_apps)
    r.add_get("/api/app-order", h_app_order_get)
    r.add_post("/api/app-order", h_app_order_set)
    r.add_get("/api/continue", h_continue)
    r.add_post("/api/continue/open", h_continue_open)
    r.add_get("/api/sleep", h_sleep_get)
    r.add_post("/api/sleep", h_sleep_set)
    r.add_get("/api/screens", h_screens)
    r.add_post("/api/screens/open", h_screens_open)
    r.add_post("/api/power", h_power)
    r.add_post("/api/volume", h_volume)
    r.add_get("/api/screenshot", h_screenshot)
    agentic.routes(r)
    r.add_route("OPTIONS", "/api/{tail:.*}", h_options)
    r.add_route("*", "/api/{tail:.*}", h_api_missing)
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
            ends = store.sleep_ends(tv_id)
            if ends and datetime.fromisoformat(ends).timestamp() > time.time():
                with_tv(tv_id, _sleep_set, ends)
            await t.start()
            if t.paired:
                app["loops"] += [for_tv(tv_id, keep_disabled_loop), for_tv(tv_id, media_watch_loop)]

    async def on_cleanup(_):
        if finder._session and not finder._session.closed:
            await finder._session.close()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host=os.environ.get("BIND_HOST", "0.0.0.0"), port=PORT,
                access_log=None, print=lambda *_: log.info("listening on %s", PORT))
