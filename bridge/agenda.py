"""The Agenda widget's calendar, read for a TV whose home this computer runs (couch-tv Studio).

A Samsung, LG, Philips, TiVo OS or Panasonic TV (and a Hisense with a computer) shows the home as a web
page, and a web page cannot read a Google, Apple or Outlook calendar by itself (those sites do not let
other pages read them). So the TV hands this computer the calendar's private address it keeps
(Home settings, Designs, At home), and this reads it and hands the words straight back.

The address is a password (it opens the calendar), so it is never written down here: not in a file, not
in the log, not in the action history. Only https, no name or password inside the address, nothing on
the home network or this computer (so the TV cannot be used to look around the house), at most three
redirects, each checked the same way, 4 MB, and only an answer that is a calendar.
"""
import ipaddress
import re
import socket
import urllib.parse

MAX_BYTES = 4 * 1024 * 1024
URL_MAX = 2000
TIMEOUT = 20


class CalendarError(Exception):
    pass


def check_url(url):
    """The address if it may be read, else raises CalendarError. A calendar app's own link (the same
    address with a scheme ending in "cal") is read as https://."""
    if not isinstance(url, str):
        raise CalendarError("not a calendar link")
    u = url.strip()
    m = re.match(r"[a-z]+cals?://", u, re.I)
    if m:
        u = "https://" + u[m.end():]
    if len(u) > URL_MAX or any(c.isspace() for c in u):
        raise CalendarError("not a calendar link")
    p = urllib.parse.urlsplit(u)
    if p.scheme.lower() != "https" or not p.hostname or p.username is not None or p.password is not None:
        raise CalendarError("not a calendar link")
    return u


def public_host(host, port=443, resolve=socket.getaddrinfo):
    """True when every address the host has is out on the internet (not this house, not this computer)."""
    try:
        infos = resolve(host, port, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
    return True


def is_calendar(text):
    return "BEGIN:VCALENDAR" in text[:2000].upper()


async def fetch(url, session=None, resolve=socket.getaddrinfo):
    """The calendar's words. Raises CalendarError with a short reason (never the address)."""
    import aiohttp
    at = check_url(url)
    own = session is None
    s = session or aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT), cookie_jar=aiohttp.DummyCookieJar())
    try:
        for _ in range(4):
            p = urllib.parse.urlsplit(at)
            if not public_host(p.hostname, p.port or 443, resolve):
                raise CalendarError("that address is not on the internet")
            async with s.get(at, allow_redirects=False, headers={"Accept": "text/calendar, text/plain;q=0.5"}) as r:
                if 300 <= r.status < 400:
                    loc = r.headers.get("Location")
                    if not loc:
                        raise CalendarError("http %d" % r.status)
                    at = check_url(urllib.parse.urljoin(at, loc))
                    continue
                if r.status < 200 or r.status >= 300:
                    raise CalendarError("http %d" % r.status)
                data = await r.content.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise CalendarError("too big")
                text = data.decode("utf-8", "replace")
                if not is_calendar(text):
                    raise CalendarError("not a calendar")
                return text
        raise CalendarError("too many redirects")
    except CalendarError:
        raise
    except Exception:
        raise CalendarError("unreachable")
    finally:
        if own:
            await s.close()
