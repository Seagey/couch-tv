"""Keep watching from a Plex Media Server's own Continue Watching list (option B, optional).

The bridge only learns of a Plex play it sees on the TV (a minute of playback in Plex's media
session), so a show left half way on a phone, on another TV or before couch-tv existed never got a
card. The server itself keeps that list, per Plex account: GET /hubs/continueWatching (the global
Continue Watching hub, developer.plex.tv/pms/, Hubs). Off unless config.json has a "plex" section
with the server's address and .env has PLEX_TOKEN. The token stays here: the TV and the phone get
the pictures through the bridge (/api/plex/art), never Plex's address or the token.

The hub is asked every POLL_S seconds while the bridge runs, and the last good list is kept when
the server is off or away. Each item becomes a card like a history line: the show (grandparentTitle)
with its season, episode and episode title, or the film, with viewOffset / duration as progress and
lastViewedAt as the card's time. Only "episode" and "movie" items count: music, clips and photos
have no place in Keep watching.
"""
import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import aiohttp

import config
import store

log = logging.getLogger("plex")

POLL_S = 300                    # how often the hub is asked
TIMEOUT_S = 10
COUNT = 30                      # items asked for; Keep watching shows at most 10 per person
HUB = "/hubs/continueWatching"
KINDS = {"episode": "tv", "movie": "movie"}
# the transcoder's sizes for the two pictures a card uses (width, height), minSize keeps the ratio
PICTURES = {"poster": (600, 900), "backdrop": (1280, 720)}

_state = {"items": [], "by_id": {}, "at": 0.0, "ok_at": None, "error": None, "server": None}
_HOME_TZ = ZoneInfo(config.TIMEZONE)


def settings():
    """The "plex" section as config.py read it, or None when there is none (or it is switched off)."""
    return config.PLEX


def token():
    return (os.environ.get("PLEX_TOKEN") or "").strip()


def enabled():
    return bool(settings() and token())


def _headers():
    # The token identifies the Plex account whose list this is (header, so it is never in a URL).
    return {"X-Plex-Token": token(), "Accept": "application/json",
            "X-Plex-Product": "couch-tv", "X-Plex-Client-Identifier": "couch-tv-bridge"}


def _url(path):
    return settings()["url"] + path


async def _get_json(path, params=None):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)) as cs:
        async with cs.get(_url(path), params=params, headers=_headers(), allow_redirects=False) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status} from {path}")
            return await r.json(content_type=None)


def _int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def _item(m):
    """One hub Metadata item as a card, or None when it is not a film or an episode."""
    if not isinstance(m, dict) or m.get("type") not in KINDS or m.get("ratingKey") in (None, ""):
        return None
    episode = m["type"] == "episode"
    title = (m.get("grandparentTitle") if episode else m.get("title")) or m.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    when = _int(m.get("lastViewedAt"))
    offset, duration = _int(m.get("viewOffset")), _int(m.get("duration"))
    progress = None
    if offset and duration and duration > 0:
        progress = round(min(1.0, max(0.0, offset / duration)), 3)
    pictures = {"poster": (m.get("grandparentThumb") if episode else None) or m.get("thumb"),
                "backdrop": (m.get("grandparentArt") if episode else None) or m.get("art")}
    return {
        "id": f"plex-{m['ratingKey']}",
        "type": KINDS[m["type"]],
        "title": title.strip(),
        "episode_title": (m.get("title") or None) if episode else None,
        "season": _int(m.get("parentIndex")) if episode else None,
        "episode": _int(m.get("index")) if episode else None,
        "year": None if episode else _int(m.get("year")),
        "progress": progress,
        "duration_ms": duration,
        "ts": float(when) if when else None,
        "when": datetime.fromtimestamp(when, _HOME_TZ).isoformat(timespec="seconds") if when else None,
        # the server's own picture paths, only ever fetched by the bridge (see picture())
        "pictures": {k: v for k, v in pictures.items() if isinstance(v, str) and v.startswith("/")},
    }


def items_from(hub_json):
    """The cards in a /hubs/continueWatching answer, newest first (the hub nests them under Hub[])."""
    container = (hub_json or {}).get("MediaContainer") or {}
    rows = []
    for hub in container.get("Hub") or []:
        rows += (hub or {}).get("Metadata") or []
    rows += container.get("Metadata") or []   # a server that answers with the items flat
    out, seen = [], set()
    for m in rows:
        it = _item(m)
        if it and it["id"] not in seen:
            seen.add(it["id"])
            out.append(it)
    out.sort(key=lambda it: it["ts"] or 0, reverse=True)
    return out


def _summary(e):
    """What went wrong, for the TV and the phone: never the server's address (aiohttp puts it in
    its connection errors) and never the token. The log gets the exception itself."""
    if isinstance(e, RuntimeError):            # _get_json's own "HTTP 401 from /hubs/..."
        return str(e)[:120]
    if isinstance(e, asyncio.TimeoutError):
        return "the server did not answer in time"
    if isinstance(e, aiohttp.ClientConnectionError):
        return "the server is not reachable"
    return "the server's answer could not be read"


async def refresh():
    """Ask the server once. Keeps the last good list on a failure and says why in the log, once
    per outage (the next line is when the server answers again)."""
    _state["at"] = time.time()
    try:
        if _state["server"] is None:
            info = (await _get_json("/")).get("MediaContainer") or {}
            _state["server"] = {"name": info.get("friendlyName") or "", "version": info.get("version") or ""}
            log.info("plex: Continue Watching from %s (%s)", _state["server"]["name"] or settings()["url"],
                     _state["server"]["version"])
        items = items_from(await _get_json(HUB, {"count": str(COUNT)}))
        if _state["error"]:
            log.info("plex: Continue Watching read again (%d items)", len(items))
        _state.update(items=items, by_id={it["id"]: it for it in items}, ok_at=time.time(), error=None)
    except Exception as e:   # the address, the token or the server: the log says which, never the token
        first = _state["error"] is None
        _state["error"] = _summary(e)
        (log.warning if first else log.debug)("plex: Continue Watching not read (%s: %s); keeping the last list",
                                              type(e).__name__, str(e)[:200])
    return _state["items"]


async def loop():
    """Every POLL_S seconds while the bridge runs."""
    await asyncio.sleep(5)
    while True:
        await refresh()
        await asyncio.sleep(POLL_S)


def _for(who):
    """Does this person get the Plex cards? "who" in the plex section names one person (by id or
    name); without it the list belongs to everyone. An unknown name goes to nobody, and the log says."""
    want = (settings() or {}).get("who")
    if not want:
        return True
    try:
        owner = store.norm_who(want)
    except ValueError:
        if not _state.get("who_warned"):
            _state["who_warned"] = True
            log.warning("plex.who %r is not a person in config.json: the Plex cards are shown to nobody", want)
        return False
    return owner in (None, "both") or who == owner


def cards(who=None, now=None, days=30):
    """This person's Plex cards from the last read, newest first, nothing older than `days` days.
    Each is shaped like a history line (title, episode_title, season, episode, when, progress)."""
    if not enabled() or not _for(who):
        return []
    cutoff = (now or datetime.now(timezone.utc)).timestamp() - days * 86400
    return [dict(it) for it in _state["items"] if it["ts"] and it["ts"] >= cutoff]


def item(card_id):
    """A card by its id ("plex-<ratingKey>"), from the last read, or None."""
    return _state["by_id"].get(card_id) if enabled() else None


def picture_url(base, card_id, kind):
    """Where the TV and the phone fetch a card's picture: the bridge, which adds the token itself.
    `base` is the bridge as the page reached it (scheme and host), so the saved copy of the home,
    served from the TV's own storage, resolves it too."""
    url = f"{base}/api/plex/art?id={card_id}&kind={kind}"
    if config.PAIRING_KEY:
        url += "&key=" + config.PAIRING_KEY
    return url


async def picture(card_id, kind):
    """(bytes, content type) of a card's poster or backdrop, scaled by the server's own transcoder
    (/photo/:/transcode, developer.plex.tv/pms/), or None when the card or the picture is not there."""
    it = item(card_id)
    path = (it or {}).get("pictures", {}).get(kind)
    if not path or kind not in PICTURES:
        return None
    width, height = PICTURES[kind]
    params = {"url": path, "width": str(width), "height": str(height), "minSize": "1", "upscale": "1"}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)) as cs:
        async with cs.get(_url("/photo/:/transcode"), params=params, headers=_headers(), allow_redirects=False) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status} for a picture")
            ctype = (r.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
            if not ctype.startswith("image/"):
                raise RuntimeError(f"not a picture: {ctype}")
            return await r.read(), ctype


def status():
    """For GET /api/plex/status: what is set up and how the last read went. Never the token."""
    if not settings():
        return {"configured": False, "error": config.PLEX_ERROR} if config.PLEX_ERROR else {"configured": False}
    out = {"configured": True, "enabled": enabled(), "who": settings().get("who"),
           "items": len(_state["items"]), "server": _state["server"],
           "read_s_ago": round(time.time() - _state["at"]) if _state["at"] else None,
           "ok_s_ago": round(time.time() - _state["ok_at"]) if _state["ok_at"] else None,
           "error": _state["error"]}
    if not enabled():
        out["error"] = "PLEX_TOKEN is not set in .env"
    return out
