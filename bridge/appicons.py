"""Icons for a Samsung's apps that couch-tv has no logo for (JioHotstar, SmartThings, ...).

The TV hands an app its own icon file only (a 2025 QN90F, Tizen 9.0): another app's iconPath fails as a
picture, and the remote channel's app list (ed.installedApp.get) and icon call (ed.apps.icon) go
unanswered (27 Nov 2026). So the bridge looks the app up by the name the TV gives it in Apple's public
app search (the same apps are on the App Store), keeps the picture in data/app-icons/, and serves it
(GET /api/tizen/icon?name=...). Only an app with the same name, one that starts with it ("Perplexity" for
"Perplexity - Ask Anything") or, for two words or more, has it inside ("Xstream Play" in "Airtel Xstream
Play") counts, so another app's icon is not shown (pick). A name not found is asked again after a week.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import time

import config
import store

SEARCH = "https://itunes.apple.com/search"
ASK_AGAIN = 7 * 86400   # a name not found: asked again this much later
BIGGEST = 2 * 1024 * 1024
DIR = os.path.join(store.DATA, "app-icons")
MISSES = os.path.join(DIR, "misses.json")
log = logging.getLogger("bridge")
_lock = asyncio.Lock()   # one look-up at a time: a home has a few dozen apps, and no lock per name piles up


def _norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def pick(results, name):
    """The icon address of the result named `name`: the same name first, then one that starts with it,
    then, for a name of two words or more, one that has it inside ("Xstream Play" in "Airtel Xstream
    Play"). A one word name never matches inside another ("Workspace" is not "Google Workspace")."""
    want = _norm(name)
    if not want:
        return None
    named = [r for r in results if isinstance(r, dict)]
    same = [r for r in named if _norm(r.get("trackName")) == want]
    starts = [r for r in named if _norm(r.get("trackName")).startswith(want)]
    inside = [r for r in named if len(str(name).split()) >= 2 and want in _norm(r.get("trackName"))]
    for r in same + starts + inside:
        url = r.get("artworkUrl512") or r.get("artworkUrl100")
        if isinstance(url, str) and url.startswith("https://"):
            # Apple's picture server makes any size and kind from the name: a 256 pixel PNG
            return re.sub(r"/\d+x\d+bb\.(jpg|png)$", "/256x256bb.png", url)
    return None


def _file(name):
    return os.path.join(DIR, hashlib.sha1(_norm(name).encode()).hexdigest()[:20] + ".png")


def _misses():
    try:
        with open(MISSES) as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def _miss(name):
    got = _misses()
    got[_norm(name)] = time.time()
    tmp = MISSES + ".tmp"
    with open(tmp, "w") as f:
        json.dump(got, f)
    os.replace(tmp, MISSES)


def names(name):
    """The whole name, then its first part ("ZEE5" for "ZEE5 - Movies, Shows, LiveTV, Originals and Sports"):
    a TV app's name can carry a store tagline the App Store's name does not."""
    out = [name]
    head = re.split(r"\s+[-–—|:]\s+|:\s+", name, maxsplit=1)[0].strip()
    if head and _norm(head) != _norm(name):
        out.append(head)
    return out


async def _look_up(session, name):
    import aiohttp
    url = None
    for want in names(name):
        for country in dict.fromkeys([config.COUNTRY.lower(), "us"]):
            params = {"term": want, "entity": "software", "country": country, "limit": "15"}
            async with session.get(SEARCH, params=params, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    continue
                url = pick((await r.json(content_type=None)).get("results") or [], want)
            if url:
                break
        if url:
            break
    if not url:
        return None
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
        body = b""
        async for chunk in r.content.iter_chunked(65536):   # read() alone hands back one piece
            body += chunk
            if len(body) > BIGGEST:
                return None
    return body if r.status == 200 and body.startswith(b"\x89PNG") else None


async def icon(name):
    """The app's icon (PNG bytes), or None when there is none to be had."""
    name = str(name or "").strip()
    if not _norm(name) or len(name) > 80:
        return None
    path = _file(name)
    try:   # a picture already kept (written with os.replace, so never half a file)
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        pass
    async with _lock:
        if os.path.exists(path):   # another request just fetched it
            with open(path, "rb") as f:
                return f.read()
        if time.time() - _misses().get(_norm(name), 0) < ASK_AGAIN:
            return None
        import aiohttp
        os.makedirs(DIR, exist_ok=True)
        try:
            async with aiohttp.ClientSession() as s:
                body = await _look_up(s, name)
        except Exception as e:
            log.info("app icon for %s: %s", name, e)
            return None   # a network failure is not a miss: asked again next time
        if not body:
            _miss(name)
            return None
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        return body
