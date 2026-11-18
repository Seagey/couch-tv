"""Helpers for "move what is playing to another TV" (POST /api/move in server.py, issue #268).

Nothing here talks to a TV. It holds the small pure parts the move needs:
- is the other TV near the first TV's spot,
- which YouTube video a title and channel are (a TV's media session carries no video id),
- the command for the optional seek through the sync helper app (docs/SYNC.md).
"""
import asyncio
import json
import os
import re
import time
import unicodedata

import aiohttp

from tv import check_package

# How far from the first TV's spot still counts as "the app resumed by itself". Past this, the saved
# spot is used as a backup (a YouTube link with a time, or a seek through the sync helper). 15 s was
# tried first and let a YouTube video that started from the beginning stay 10 s behind.
NEAR_MS = 5_000

SYNC_HELPER = "dev.couchtv.sync"   # the helper app of docs/SYNC.md; the only way to seek inside another app

# Apps where the move may press OK on a screen it cannot read (server.move_nudge). A blind OK is only
# safe where it cannot buy anything: Netflix sells nothing inside its TV app. An app with rentals or
# add-on channels (Prime Video) could have Rent or Subscribe in focus instead of Play, so it is not
# here. COUCHTV_MOVE_BLIND_OK adds app ids (comma separated) for a household that accepts that: it
# can cost money (docs/MOVE.md says so).
BLIND_OK_APPS = {"netflix"} | {a.strip() for a in os.environ.get("COUCHTV_MOVE_BLIND_OK", "").split(",") if a.strip()}

YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")
YOUTUBE_RESULTS = "https://www.youtube.com/results"
_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def near(a_ms, b_ms, within_ms=NEAR_MS):
    """True when both spots are known and close. An unknown spot (live TV) is never "near"."""
    if a_ms is None or b_ms is None:
        return False
    return abs(int(a_ms) - int(b_ms)) <= within_ms


def same_name(a, b):
    """The same title, in any script: compared after Unicode folding, letters and digits only.
    finder.same_title keeps Latin letters and digits only, so two identical Japanese or Arabic
    titles are both empty to it and never match."""
    a, b = _norm(a), _norm(b)
    return bool(a) and a == b


def clock(ms):
    """83000 -> "1:23", 3723000 -> "1:02:03"."""
    s = max(0, int(ms or 0) // 1000)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ---------- YouTube: which video is this ----------
def _norm(text):
    text = unicodedata.normalize("NFKC", text or "").lower()
    return " ".join(re.sub(r"[^\w]+", " ", text).split())


def _text(node):
    if not isinstance(node, dict):
        return None
    if "simpleText" in node:
        return node["simpleText"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join(r.get("text", "") for r in runs if isinstance(r, dict))
    return None


def _length_s(text):
    """"4:13" or "1:02:03" -> seconds, None when it is not a length."""
    try:
        parts = [int(p) for p in (text or "").strip().split(":")]
    except ValueError:
        return None
    total = 0
    for n in parts:
        total = total * 60 + n
    return total if parts else None


def youtube_results(html, limit=8):
    """The videos on a YouTube results page: [{"id", "title", "channel", "length_s"}]."""
    m = re.search(r"(?:var ytInitialData|window\[\"ytInitialData\"\])\s*=\s*(\{.*?\});\s*</script>", html or "", re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return []
    out = []

    def walk(node):
        if len(out) >= limit:
            return
        if isinstance(node, dict):
            video = node.get("videoRenderer")
            if isinstance(video, dict) and YOUTUBE_ID.fullmatch(str(video.get("videoId", ""))):
                out.append({"id": video["videoId"], "title": _text(video.get("title")) or "",
                            "channel": _text(video.get("ownerText")) or _text(video.get("longBylineText")),
                            "length_s": _length_s(_text(video.get("lengthText")))})
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return out


def youtube_pick(results, title, channel=None, duration_ms=None):
    """The id of the result that is surely this video, or None. The title must match; a channel or
    a length (within 3 s) that disagrees rules a result out, and one of them must agree when the TV
    gave either. A wrong video is worse than none."""
    want, chan = _norm(title), _norm(channel)
    length = round(duration_ms / 1000) if duration_ms else None
    if not want:
        return None
    for r in results:
        if _norm(r.get("title")) != want:
            continue
        chan_known = bool(chan) and bool(_norm(r.get("channel")))
        chan_ok = chan_known and _norm(r.get("channel")) == chan
        if chan_known and not chan_ok:
            continue
        len_known = length is not None and r.get("length_s") is not None
        len_ok = len_known and abs(r["length_s"] - length) <= 3
        if len_known and not len_ok:
            continue
        if chan_ok or len_ok or (not chan and length is None):
            return r["id"]
    return None


_found = {}   # (title, channel) -> (video id, when found): a video moved to and fro is looked up once
FOUND_KEEP_S = 6 * 3600
LOOKUP_TRIES = 3


async def _results_page(query):
    """YouTube's results page for a search, or "" when it cannot be had."""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(YOUTUBE_RESULTS, params={"search_query": query},
                                   headers={"user-agent": _UA, "accept-language": "en"}) as r:
                if r.status != 200 or "consent." in str(r.url):
                    return ""
                return await r.text()
    except Exception:
        return ""


async def youtube_video_id(title, channel=None, duration_ms=None):
    """Search YouTube's public results page for the title and channel the TV reports. None when
    unsure or when the page cannot be read (a consent page, a change on YouTube's side).

    YouTube does not always send the same page: now and then the results come in another layout,
    of which this reads one video or none (seen: the very same search gave eight results, then one,
    then eight again). So a page that gives no sure answer is asked for again, twice at most. A
    video that was found is remembered for six hours."""
    if not (title or "").strip():
        return None
    # the length is part of what was found: a channel can have two videos of one title
    key = (_norm(title), _norm(channel), round(duration_ms / 1000) if duration_ms else None)
    hit = _found.get(key)
    if hit and time.time() - hit[1] < FOUND_KEEP_S:
        return hit[0]
    query = " ".join(x for x in (title, channel) if x)
    for attempt in range(LOOKUP_TRIES):
        if attempt:
            await asyncio.sleep(1)
        video = youtube_pick(youtube_results(await _results_page(query)), title, channel, duration_ms)
        if video:
            _found[key] = (video, time.time())
            return video
    return None


def youtube_link(video_id, seconds=None):
    """The watch link for a video. Without `seconds` YouTube resumes from the account's own watch
    history; with it the video starts at that second (the backup)."""
    if not YOUTUBE_ID.fullmatch(str(video_id or "")):
        raise ValueError("not a YouTube video id")
    link = f"https://www.youtube.com/watch?v={video_id}"
    return link if seconds is None else f"{link}&t={max(0, int(seconds))}"


# ---------- the sync helper: seek inside another app ----------
def _helper(op, package):
    return (f"am broadcast -a {SYNC_HELPER}.CMD -n {SYNC_HELPER}/.CmdReceiver "
            f"--es op {op} --es pkg {check_package(package)}")


def can_seek_command(package):
    """The `adb shell` line that asks the sync helper what `package`'s media session allows."""
    return _helper("state", package)


def pause_command(package):
    """The `adb shell` line that asks the sync helper to pause `package` itself. A pause key goes to
    whichever app Android thinks owns the media keys, which is not always the one on screen."""
    return _helper("pause", package)


def seek_command(package, position_ms):
    """The `adb shell` line that asks the sync helper to move `package` to `position_ms`. The package
    goes through check_package and the spot is a whole number, so nothing else can reach the shell."""
    return _helper("seek", package) + f" --es pos_ms {max(0, int(position_ms))}"


def _reply(out):
    """The helper's answer: the broadcast's data="{...}" as a dict, {} when there is none."""
    m = re.search(r'data="(.*)"\s*$', (out or "").strip(), re.S)
    try:
        got = json.loads(m.group(1)) if m else {}
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def can_seek(out):
    """Does the app take a seek from outside? Prime Video does not (seen on a Google TV Streamer:
    "can_seek": false, and a seek sent anyway changed nothing)."""
    return _reply(out).get("can_seek") is True


def seek_ok(out):
    """Did the helper say it sent the seek?"""
    return _reply(out).get("result") == "ok"
