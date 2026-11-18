"""What the TV home shows from Ask AI and from the person's own AI agent (docs/AI-AGENT.md).

The home's Ask AI widget (tv-home/web/ask.js) reads GET /api/say every few seconds while it is on
screen, so an answer asked from the phone remote shows on the TV too. An AI agent the person
connected (bridge/mcp_server.py, or any program holding the pairing key) can:

  POST /api/say/message {"text", "from"?, "seconds"?}   a short message shown on the TV
  POST /api/say/design  {"code"}                        a couch-tv Studio design code; the TV gets it
                                                         and asks "Use this design?" first, as always

Nothing here is kept on disk and nothing leaves this computer. A message is plain text (no links are
made clickable, nothing is run), at most 280 characters. A design code is only a code: the TV fetches
the design itself from couch-tv Studio's store and puts it through its own gate, exactly as if the
code had been typed with the remote.
"""
import itertools
import re
import time

MAX_TEXT = 280
MAX_FROM = 24
SHORT = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
_ids = itertools.count(1)
_state = {}   # tv id -> {"message": {...}, "design": {...}}


def plain(s, limit):
    """One plain line of words: control characters out, spaces squeezed, cut to `limit`."""
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", str(s or ""))
    s = re.sub(r"[ \t]+", " ", s).strip()
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s[:limit]


def read_code(s):
    """A design code as the TV reads it (tv-home/web/design-code.js readCode), or "" when it is not one."""
    s = str(s or "").strip()
    long = re.sub(r"^CTV1-", "", s, flags=re.I)
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", long):
        return "CTV1-" + long
    c = re.sub(r"[\s-]", "", s.upper())
    if len(c) != 10 or any(ch not in SHORT for ch in c):
        return ""
    return c[:5] + "-" + c[5:]


def _tv(tv):
    return _state.setdefault(tv or "default", {})


def message(tv, text, sender=None, seconds=None):
    text = plain(text, MAX_TEXT)
    if not text:
        raise ValueError("text is required: the words to show on the TV")
    sender = plain(sender, MAX_FROM) if sender else "Your AI"
    try:
        seconds = int(seconds) if seconds is not None else 30
    except (TypeError, ValueError):
        raise ValueError("seconds must be a whole number from 5 to 600")
    seconds = max(5, min(600, seconds))
    m = {"id": next(_ids), "text": text, "from": sender, "seconds": seconds, "at": int(time.time() * 1000)}
    _tv(tv)["message"] = m
    return m


def design(tv, code):
    c = read_code(code)
    if not c:
        raise ValueError("code must be a couch-tv Studio design code, like ABCDE-FGHJK or CTV1-...")
    d = {"id": next(_ids), "code": c, "at": int(time.time() * 1000)}
    _tv(tv)["design"] = d
    return d


def snapshot(tv, last_ask=None):
    """What the TV shows now. last_ask is claude.py's record for this TV ({"text", "reply", "ts", ...})."""
    s = _tv(tv)
    out = {"message": s.get("message"), "design": s.get("design"), "ask": None}
    if last_ask and last_ask.get("text"):
        out["ask"] = {"q": plain(last_ask.get("text"), 400), "a": plain(last_ask.get("reply"), 1200),
                      "at": int(float(last_ask.get("ts") or 0) * 1000), "pending": bool(last_ask.get("pending")),
                      "by": "Claude on the home computer"}
    return out


def clear():
    _state.clear()
