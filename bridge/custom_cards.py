"""Custom cards on the TV home (idea from geissmannz on Instagram).

The household points home.custom_cards in config.json at a small JSON file, either a file on this
computer or an http(s) link (a raw GitHub file, a Raspberry Pi on the home network). couch-tv only
shows what is in it: a title, a short line or value, a picture, and what OK opens (an installed app
or a web link). It never runs anything from the file. Whatever writes the file is up to you.

The file:

    {"cards": [
      {"title": "Solar today", "value": "18.4 kWh", "subtitle": "Roof panels",
       "image": "https://example.com/sun.png", "app": "com.example.solar"},
      {"title": "Bin night", "value": "Recycling", "url": "https://example.com/bins"}
    ]}

A bare list of cards works too. Anything else in the file is ignored, and so is any card without
a title. The TV home asks the bridge (GET /api/custom-cards) every 10 minutes.
"""
import json
import os
import re
import time

MAX_CARDS = 8
MAX_BYTES = 64 * 1024        # the whole file
TITLE_MAX, SUBTITLE_MAX, VALUE_MAX = 40, 60, 24
URL_MAX = 1000
FETCH_EVERY = 60             # seconds the bridge keeps an answer before reading the source again

PACKAGE_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+")   # the same check as tv.check_package
# http(s) only, and nothing a shell or an HTML attribute could trip on (quotes, spaces, backslashes, $ and `)
URL_RE = re.compile(r"https?://[^\s'\"<>\\`$]+", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _text(v, most):
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return ""
    s = _CONTROL.sub(" ", str(v)).strip()
    return s[:most].rstrip()


def _url(v):
    if isinstance(v, str) and len(v) <= URL_MAX and URL_RE.fullmatch(v.strip()):
        return v.strip()
    return ""


def clean(data):
    """The cards the TV may show, from whatever the file held. Never raises."""
    raw = data.get("cards") if isinstance(data, dict) else data
    out = []
    for c in raw if isinstance(raw, list) else []:
        if len(out) >= MAX_CARDS:
            break
        if not isinstance(c, dict):
            continue
        title = _text(c.get("title"), TITLE_MAX)
        if not title:
            continue
        card = {"title": title}
        sub = _text(c.get("subtitle"), SUBTITLE_MAX)
        if sub:
            card["subtitle"] = sub
        val = _text(c.get("value"), VALUE_MAX)
        if val:
            card["value"] = val
        img = _url(c.get("image"))
        if img:
            card["image"] = img
        app = c.get("app")
        if isinstance(app, str) and len(app) <= 200 and PACKAGE_RE.fullmatch(app):
            card["app"] = app
        else:
            link = _url(c.get("url"))
            if link:
                card["url"] = link
        out.append(card)
    return out


def source(value, config_dir):
    """home.custom_cards -> ("url", link) or ("file", absolute path), or None when it is not set."""
    if not isinstance(value, str) or not value.strip() or len(value) > 2000:
        return None
    value = value.strip()
    if re.match(r"https?://", value, re.IGNORECASE):
        return ("url", value) if _url(value) else None
    if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", value):   # any other scheme (file:, javascript:, ftp://)
        return None
    path = os.path.expanduser(value)
    if not os.path.isabs(path):
        path = os.path.join(config_dir, path)
    return ("file", os.path.normpath(path))


_cache = {"at": 0.0, "cards": []}


async def _read(src):
    kind, where = src
    if kind == "file":
        with open(where, "rb") as f:
            raw = f.read(MAX_BYTES + 1)
    else:
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.get(where, headers={"Accept": "application/json"}) as r:
                if r.status != 200:
                    raise ValueError(f"HTTP {r.status}")
                raw = await r.content.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("larger than 64 KB")
    return json.loads(raw.decode("utf-8"))


async def get(src, log=None, now=None):
    """The cards to show. A file or link that cannot be read, or is not JSON, keeps the last good
    cards (none if there never were any), so a hiccup never empties the row or slows the home."""
    if not src:
        return []
    now = time.time() if now is None else now
    if _cache["at"] and now - _cache["at"] < FETCH_EVERY:
        return _cache["cards"]
    _cache["at"] = now
    try:
        _cache["cards"] = clean(await _read(src))
    except Exception as e:
        if log:
            log.warning("custom cards: %s", e)
    return _cache["cards"]
