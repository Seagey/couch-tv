"""Samsung TV Plus's free channels, for the Live TV tile on a Samsung (samsung/app/livetv.js).

Samsung's own TV Plus app froze couch-tv in the background, so Samsung's Home button could not bring
couch-tv back (a QN90F in India, Nov 2026). couch-tv plays the same public streams itself instead:
https://jmp2.uk/stvp-<channel id> sends a player on to the channel's stream. The channel list is
i.mjh.nz's (every region's channels, numbers, groups, logos and programmes; about 2 MB), read at
most every 6 hours and handed to the TV one region at a time, and other regions' channels on top
when this TV asks for them ("more_regions").

The stream offers several pictures (a Hindi news channel: 320x180 up to 1920x1080) and a player climbs from the
lowest, so a QN90F looked like 480p for the first minute (27 Nov 2026). best_master() hands the TV a
playlist with only the sharpest picture, so it is sharp from the first second.
"""
import asyncio
import logging
import re
import time
from urllib.parse import urljoin

import config

URL = "https://i.mjh.nz/SamsungTVPlus/.channels.json"
STREAM = "https://jmp2.uk/stvp-"
HEADERS = {"user-agent": "okhttp/4.12.0"}   # what the list itself says to send (its "headers")
EVERY = 6 * 3600       # how long a read list is kept
RETRY = 10 * 60        # after a failed read with an older list to hand: try again this much later
CHANNEL_ID = re.compile(r"[A-Za-z0-9]{1,40}")
log = logging.getLogger("bridge")
_cache = {"at": 0.0, "data": None}


async def _fetch():
    import aiohttp
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
        async with s.get(URL) as r:
            r.raise_for_status()
            return await r.json(content_type=None)


async def _all():
    """The whole list, read again once it is 6 hours old. A failed read keeps the older list."""
    now = time.time()
    if _cache["data"] is None or now - _cache["at"] >= EVERY:
        try:
            data = await _fetch()
            if not isinstance(data, dict) or not isinstance(data.get("regions"), dict):
                raise ValueError("no regions in the Samsung TV Plus list")
            _cache["data"], _cache["at"] = data, now
        except Exception as e:
            if _cache["data"] is None:
                raise
            log.warning("live tv: kept the older channel list (%s)", e)
            _cache["at"] = now - EVERY + RETRY
    return _cache["data"]


def _now_title(programs, now):
    """The title of the programme on at `now`: the latest one that has started."""
    best, title = None, ""
    for p in programs if isinstance(programs, list) else []:
        if isinstance(p, (list, tuple)) and len(p) >= 2 and isinstance(p[0], (int, float)) and p[0] <= now:
            if best is None or p[0] >= best:
                best, title = p[0], str(p[1] or "")
    return title


def region_channels(data, region, now=None, abroad=False):
    """One region's channels in channel number order: id, name, chno, group, logo and what is on now.
    A channel with a licence (DRM, "license_url") is left out: only Samsung's own app may play it.
    `abroad`: another country's, its groups named after it ("USA · Sports") and its code in "region"."""
    now = time.time() if now is None else now
    reg = ((data or {}).get("regions") or {}).get(region) or {}
    chans = reg.get("channels") if isinstance(reg, dict) else None
    country = str(reg.get("name") or region.upper()) if isinstance(reg, dict) else region.upper()
    out = []
    for cid, c in (chans or {}).items():
        if not isinstance(c, dict) or not CHANNEL_ID.fullmatch(str(cid)) or c.get("license_url"):
            continue
        chno = c.get("chno") if isinstance(c.get("chno"), int) and not isinstance(c.get("chno"), bool) else None
        group = str(c.get("group") or "")
        one = {"id": cid, "name": str(c.get("name") or cid), "chno": chno,
               "group": f"{country} · {group}" if abroad and group else country if abroad else group,
               "logo": str(c.get("logo") or ""), "now": _now_title(c.get("programs"), now)}
        if abroad:
            one["region"] = region
        out.append(one)
    out.sort(key=lambda c: (c["group"] if abroad else "", c["chno"] is None, c["chno"] or 0, c["name"].lower()))
    return out


def _region(code):
    code = str(code or "").strip().lower()
    return code if re.fullmatch(r"[a-z]{2}", code) else None


async def channels(region=None, more=()):
    """GET /api/livetv/channels: that region's channels (this home's country by default), then each
    other country picked in Home settings (`more`), by group. Many of those play from anywhere; some
    are refused outside their country, and the player says so and moves on."""
    region = _region(region or config.COUNTRY)
    if not region:
        return []
    data = await _all()
    out = region_channels(data, region)
    regions = data.get("regions") or {}
    for code in dict.fromkeys(filter(None, map(_region, more))):
        if code != region and isinstance(regions.get(code), dict):
            out += region_channels(data, code, abroad=True)
    return out


# "sport" anywhere but in "transport" (talkSPORT, Sportitalia); the short names whole (NFL, not KoNFLikte)
SPORT = re.compile(r"(?<!tran)sport|\b(football|soccer|fifa\+?|futbol|fútbol|calcio|fussball|fußball|nfl|nba|nhl|mlb|"
                   r"milb|cricket|rugby|tennis|golf|motor|racing|f1|ufc|pfl|fight|boxing|wrestling|wwe|olympics?)\b", re.I)
CHECKED = 6 * 3600     # how long "plays from here" is kept for a country
_plays = {}            # region -> (when, played, tried)


def is_sport(c):
    return bool(SPORT.search(c.get("group") or "") or SPORT.search(c.get("name") or ""))


async def _plays_here(session, cid):
    """True when the channel's sharpest picture hands over a real piece of video from this home."""
    try:
        async with session.get(STREAM + cid) as r:
            if r.status != 200:
                return False
            base, text = str(r.url), await r.text()
        master = best_master(text, base)
        media = master.strip().splitlines()[-1] if master else base
        if master:
            async with session.get(media) as r:
                if r.status != 200:
                    return False
                text = await r.text()
        pieces = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
        if not pieces:
            return False
        async with session.get(urljoin(media, pieces[-1].strip()), allow_redirects=True) as r:
            head = await r.content.read(188)
        # MPEG-TS starts 0x47, fragmented MP4 with a box ("ftyp", "styp", "moof"), packed audio with ID3
        return r.status == 200 and len(head) >= 8 and (head[0] == 0x47 or head[4:8] in (b"ftyp", b"styp", b"moof")
                                                        or head[:3] == b"ID3")
    except Exception:
        return False


PROBES = 4                 # channels tried at once: a Pi Zero 2 W with AdGuard beside it stays light
_probing = asyncio.Lock()  # one round of tries at a time, however many pages ask


async def regions(home=None):
    """GET /api/livetv/regions: every other country with its channels, its sports channels (a few
    names, for a football or a fight night) and how many of three tried played from this home, best
    first. The tries are made at most every 6 hours per country, four channels at a time (about
    15 seconds on a Pi Zero 2 W for every country)."""
    import aiohttp
    home = _region(home or config.COUNTRY)
    data = await _all()
    out, samples = [], {}
    for code, reg in sorted((data.get("regions") or {}).items()):
        if code == home or not isinstance(reg, dict) or not _region(code):
            continue
        chans = region_channels(data, code)
        sports = [c for c in chans if is_sport(c)]
        out.append({"code": code, "name": str(reg.get("name") or code.upper()), "channels": len(chans),
                    "sports": len(sports), "examples": [c["name"] for c in (sports or chans)[:4]]})
        if chans:
            samples[code] = (sports or chans)[:3]
    async with _probing:
        due = {code: sample for code, sample in samples.items()
               if not _plays.get(code) or time.time() - _plays[code][0] >= CHECKED}
        if due:
            gate = asyncio.Semaphore(PROBES)

            async def one(session, cid):
                async with gate:
                    return await _plays_here(session, cid)
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12), headers=HEADERS) as s:
                async def country(code, sample):
                    results = await asyncio.gather(*(one(s, c["id"]) for c in sample))
                    _plays[code] = (time.time(), sum(results), len(results))
                await asyncio.gather(*(country(code, sample) for code, sample in due.items()))
    for r in out:
        kept = _plays.get(r["code"])
        r["played"], r["tried"] = (kept[1], kept[2]) if kept else (0, 0)
    out.sort(key=lambda r: (-(r["played"] / r["tried"] if r["tried"] else 0), -r["sports"], r["name"]))
    return out


def _sharpness(inf):
    """How sharp a picture is: its height (RESOLUTION=1920x1080), then its BANDWIDTH."""
    size = re.search(r"[:,]RESOLUTION=(\d+)x(\d+)", inf)
    rate = re.search(r"[:,]BANDWIDTH=(\d+)", inf)
    return (int(size.group(2)) if size else 0, int(rate.group(1)) if rate else 0)


def best_master(text, base):
    """A master playlist with only its sharpest picture (the tallest, then the highest BANDWIDTH),
    every address made whole so the TV can read it from the bridge. Its audio and subtitle tracks
    stay. None when it is not a master playlist (a single picture already)."""
    lines = [line.strip() for line in str(text or "").splitlines()]
    if not lines or lines[0] != "#EXTM3U":
        return None
    head, variants, i = [], [], 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("#EXT-X-STREAM-INF:"):
            j = i + 1
            while j < len(lines) and (not lines[j] or lines[j].startswith("#")):
                j += 1
            if j < len(lines):
                variants.append((_sharpness(line), line, urljoin(base, lines[j])))
            i = j + 1
            continue
        if line.startswith("#EXT-X-I-FRAME-STREAM-INF"):
            pass   # trick-play pictures: not needed for live TV
        elif line.startswith("#"):
            head.append(re.sub(r'URI="([^"]*)"', lambda m: f'URI="{urljoin(base, m.group(1))}"', line))
        i += 1
    if not variants:
        return None
    _, inf, uri = max(variants, key=lambda v: v[0])
    return "\n".join(head + [inf, uri]) + "\n"


async def sharp(cid):
    """GET /api/livetv/play/<id>.m3u8: the channel's playlist with only its sharpest picture, or None
    (then the TV is sent to the stream itself)."""
    import aiohttp
    if not CHANNEL_ID.fullmatch(str(cid)):
        return None
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), headers=HEADERS) as s:
        async with s.get(STREAM + cid) as r:
            r.raise_for_status()
            return best_master(await r.text(), str(r.url))
