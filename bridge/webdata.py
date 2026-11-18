"""The relay for the TV home's web widgets (tv-home/web/widget-web.js).

A news feed or a share price sends no CORS header, so a web page on the TV may not read it itself.
The home asks here instead: GET /api/webdata?src=news&id=abc. This only knows the sources named
below, each by an id, never a link, so it can never be pointed anywhere else. It hands back the
source's own text ({"ok": true, "text": "..."}); the home reads it (widget-web.js parseRss and the
rest), so there is one reader, on the TV.

Every source is free, needs no key and no account: public RSS feeds (each outlet's terms allow
personal, non commercial reading) and Yahoo Finance's public chart data (unofficial; personal use,
prices about 20 minutes late on the ASX). Nothing is kept but the last answer, in memory, for a few
minutes, so several TVs or a reload ask the source once.

The same lists are in the launcher (tv-home/android .../WebData.kt) and the on-TV app
(on-tv/android .../WebData.kt): change all three together.
"""
import re
import time
import urllib.parse

FEEDS = {
    "abc": "https://www.abc.net.au/news/feed/45910/rss.xml",
    "abc-justin": "https://www.abc.net.au/news/feed/51120/rss.xml",
    "abc-sport": "https://www.abc.net.au/news/feed/2942460/rss.xml",
    "abc-business": "https://www.abc.net.au/news/feed/51892/rss.xml",
    "sbs": "https://www.sbs.com.au/news/topic/latest/feed",
    "guardian": "https://www.theguardian.com/au/rss",
    "bbc": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "rnz": "https://www.rnz.co.nz/rss/national.xml",
}
# a symbol as Yahoo writes it: BHP.AX, ^AXJO, AUDUSD=X, BTC-AUD (letters, digits, one joiner)
SYMBOL = re.compile(r"\^?[A-Z0-9]{1,8}([.=-][A-Z0-9]{1,4})?")
MAX_SYMBOLS = 8
KEEP = {"news": 10 * 60, "stocks": 2 * 60}      # seconds an answer is kept
MAX_BYTES = 300 * 1024                           # the first part of a long feed is plenty
UA = "couch-tv (+https://github.com/Seagey/couch-tv)"

_cache = {}


class BadSource(ValueError):
    """The id is not one this relay knows."""


def url_for(src, ident):
    """The one link for a source and id, or BadSource."""
    ident = str(ident or "")
    if src == "news":
        if ident not in FEEDS:
            raise BadSource("unknown feed")
        return FEEDS[ident]
    if src == "stocks":
        syms = [s for s in ident.split(",") if s]
        if not syms or len(syms) > MAX_SYMBOLS or not all(SYMBOL.fullmatch(s) for s in syms):
            raise BadSource("unknown symbols")
        return ("https://query2.finance.yahoo.com/v7/finance/spark?symbols="
                + urllib.parse.quote(",".join(syms), safe=",") + "&range=1d&interval=15m")
    raise BadSource("unknown source")


async def _fetch(url):
    import aiohttp
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), headers={"User-Agent": UA}) as s:
        async with s.get(url, allow_redirects=True) as r:
            if r.status != 200:
                raise OSError("source answered %d" % r.status)
            raw = await r.content.read(MAX_BYTES)
    return raw.decode("utf-8", "replace")


async def get(src, ident, fetch=None, now=None):
    """The source's text for src and id: from the last few minutes, else asked once now."""
    url = url_for(src, ident)
    t = now if now is not None else time.time()
    hit = _cache.get(url)
    if hit and t - hit[0] < KEEP[src]:
        return hit[1]
    text = await (fetch or _fetch)(url)
    _cache[url] = (t, text)
    if len(_cache) > 64:   # a small household: drop the oldest
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:16]:
            _cache.pop(k, None)
    return text
