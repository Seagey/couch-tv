"""Watch history, imported history and cached picks, kept as files in bridge/data/.

History is kept forever. Two append-only JSON-lines files, oldest first:
- history.jsonl: what was played on our TVs (through the bridge, or seen playing in an app). A line
  with "type": "video" is a YouTube video seen playing: history() leaves those out, so nothing that
  reads the history (Keep watching, the picks, the taste, the Ask context) ever sees one, and only
  videos() lists them.
- imported.jsonl: what came from the owner's own downloads (Netflix viewing activity, YouTube
  watch history), see history_import.py. Each line has a "key" so re-importing a file adds nothing twice.

Small keyed files next to them, read and written whole under one lock: hidden.json (Keep watching
cards removed by hand), who.json (who is on the couch), sleep.json, recs.json, and video-ids.json
(the YouTube video id found for a video line's title and channel, with the video's length, so a
bridge restart does not lose it; at most VIDEO_IDS_MAX entries, the oldest dropped first).
"""
import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone

import config
import messages
import move   # the video id pattern and the title key, so there is one copy of each

DATA = config.DATA
HISTORY_OLD = os.path.join(DATA, "history.json")  # the older capped list, read once and moved over
HISTORY = os.path.join(DATA, "history.jsonl")
IMPORTED = os.path.join(DATA, "imported.jsonl")
RECS = os.path.join(DATA, "recs.json")
SLEEP = os.path.join(DATA, "sleep.json")
HIDDEN = os.path.join(DATA, "hidden.json")  # Keep watching cards removed by hand: "tv|who|title" -> when
VIDEO_IDS = os.path.join(DATA, "video-ids.json")  # "title|channel" (move._norm) -> {"id", "length_s", "when"}
VIDEO_IDS_MAX = 500
# How far apart two lengths can be and still be the same video: the tolerance move.youtube_pick uses.
VIDEO_LENGTH_SLACK_S = 3
_lock = threading.Lock()
_cache = {}  # path -> (mtime, size, items oldest first)


def _read(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path, data):
    os.makedirs(DATA, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def _migrate():
    """Move the old capped history.json into history.jsonl once."""
    if os.path.exists(HISTORY_OLD) and not os.path.exists(HISTORY):
        old = _read(HISTORY_OLD, [])
        os.makedirs(DATA, exist_ok=True)
        with open(HISTORY, "w") as f:
            for item in reversed(old):  # the old file was newest first
                f.write(json.dumps(item) + "\n")
        os.replace(HISTORY_OLD, HISTORY_OLD + ".migrated")


def _lines(path):
    """All items in a JSON-lines file, oldest first, cached until the file changes."""
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return []
    hit = _cache.get(path)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    items = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    items.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a half-written last line after a crash
    _cache[path] = (st.st_mtime, st.st_size, items)
    return items


def _append(path, items):
    os.makedirs(DATA, exist_ok=True)
    with _lock, open(path, "a") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def _all_history():
    """Every line, shows and videos, newest first."""
    _migrate()
    return list(reversed(_lines(HISTORY)))


def history():
    """Shows and films played on our TVs, newest first. Kept forever. Never a YouTube video line
    (videos()): a video's name matched to a film would put that film in the household's taste
    (issue #23), and YouTube would bury everything else in Keep watching."""
    return [h for h in _all_history() if h.get("type") != "video"]


def videos():
    """YouTube videos seen playing on our TVs, newest first: the lines history() leaves out."""
    return [h for h in _all_history() if h.get("type") == "video"]


def add_history(item):
    """Every new line gets its own id, so a Keep watching card always opens the line it shows."""
    _migrate()
    _append(HISTORY, [{"id": uuid.uuid4().hex[:16], **item}])


def history_item(item_id):
    """One history line by its id (a show or a video), or None."""
    for h in _all_history():
        if h.get("id") == item_id:
            return h
    return None


def imported():
    """Imported history (Netflix, YouTube, ...), oldest first."""
    return _lines(IMPORTED)


def add_imported(items):
    """Append imported items whose "key" is not there yet. Returns how many were new."""
    seen = {i.get("key") for i in imported()}
    new = []
    for item in items:
        if item.get("key") and item["key"] not in seen:
            seen.add(item["key"])
            new.append(item)
    if new:
        _append(IMPORTED, new)
    return len(new)


def who_map():
    """Every word that means a person (id or name, any case), read fresh so edits count at once."""
    out = {"both": "both", "all": "both", "everyone": "both"}
    for p in config.PEOPLE:
        out[p["id"].lower()] = p["id"]
        out[p["name"].lower()] = p["id"]
    return out


def norm_who(value):
    """A person id from the people list, or both (None when not given). Raises ValueError on anything else."""
    if value in (None, ""):
        return None
    who = who_map().get(str(value).strip().lower())
    if not who:
        raise messages.with_key(
            ValueError("who must be " + ", ".join(config.PEOPLE_IDS) + " or both"),
            "err_who_must_be",
            choices=", ".join(config.PEOPLE_IDS),
        )
    return who


def matches(item, who):
    """Does a history item belong in this person's view? Shared plays count for both."""
    return who in (None, "both") or item.get("who") in (who, "both", None)


def continue_watching(who=None, limit=12):
    seen, out = set(), []
    for h in history():
        if not matches(h, who):
            continue
        key = (h["title"].lower(), h.get("year"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": h["title"], "type": h.get("type"), "service": h.get("service"),
                    "poster": h.get("poster"), "backdrop": h.get("backdrop"), "last_played": h.get("when"),
                    "season": h.get("season"), "episode": h.get("episode")})
        if len(out) >= limit:
            break
    return out


# Keep watching: per TV and per person. Only lines that say which TV and which person count;
# older lines (before 0.9) say neither and are kept for suggestions, never shown here.
KEEP_MAX = 10
KEEP_DAYS = 30


def _when(h):
    try:
        t = datetime.fromisoformat(h.get("when") or "")
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def keep_watching(tv_id, who, now=None, limit=KEEP_MAX, days=KEEP_DAYS):
    """What this person watched on this TV, one line per show (the latest), newest first, at most
    `limit`, nothing older than `days` days."""
    return _keep(history(), tv_id, who, now, limit, days)


def keep_videos(tv_id, who, now=None, limit=KEEP_MAX, days=KEEP_DAYS):
    """The YouTube videos this person watched on this TV, the same way: one line per title (the
    latest), newest first, at most `limit`, within `days` days, minus the ones removed by hand."""
    return _keep(videos(), tv_id, who, now, limit, days, VIDEO_KEY)


# A video is hidden under its own key, "video:<title>", so taking a video off the YouTube row never
# takes a show of the same name off Keep watching ("Bluey" the show and a Bluey video), or the other way.
VIDEO_KEY = "video:"


def _hidden_key(h):
    """The lower case title a history line is hidden under, with the video mark on a video line."""
    return (VIDEO_KEY if h.get("type") == "video" else "") + (h.get("title") or "").strip().lower()


def _keep(lines, tv_id, who, now, limit, days, kind=""):
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    seen, out = set(), []
    hidden = hidden_times(tv_id, who)
    for h in lines:
        if not h.get("id") or h.get("tv") != tv_id or h.get("who") != who:
            continue
        when = _when(h)
        if when is None or when < cutoff:
            continue
        key = (h.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        hid = hidden.get(kind + key)
        if hid and when <= hid:
            continue   # removed by hand; watching it again brings it back
        out.append(h)
        if len(out) >= limit:
            break
    return out


def hidden_times(tv_id, who):
    """The shows removed by hand from this person's Keep watching on this TV: lower case title ->
    when it was removed (a video under "video:<title>"). A card is hidden while its own time is not
    after that."""
    out = {}
    for key, when in _read(HIDDEN, {}).items():
        tv, _, rest = key.partition("|")
        person, _, title = rest.partition("|")
        t = _when({"when": when})
        if tv == tv_id and person == str(who) and title and t:
            out[title] = t
    return out


def hide_keep_watching(h):
    """Take a show (or a video, under its own key) off Keep watching, for the TV and person of its
    history line, until it is played again."""
    key = _hidden_key(h)
    with _lock:
        data = _read(HIDDEN, {})
        data[f"{h.get('tv')}|{h.get('who')}|{key}"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write(HIDDEN, data)


def _video_ids_key(title, channel):
    """The key a video's id is kept under: the title and the channel the way move's lookup tells
    them apart (move._norm), so a title many channels reuse keeps one id per channel."""
    return move._norm(title) + "|" + move._norm(channel)


def _length_s(duration_ms):
    """A session's length in whole seconds, or None when it gave none (a live stream, an older line)."""
    if isinstance(duration_ms, bool) or not isinstance(duration_ms, (int, float)) or duration_ms <= 0:
        return None
    return round(duration_ms / 1000)


VIDEO_IDS_PER_TITLE = 4   # lengths kept for one title and channel ("Weekly update" each week)


def _video_entries(entry):
    """The saved (id, length_s, when) for one title and channel, newest last. An entry is a list of
    objects (one per length), or, from before that, one object or a bare id string. Anything not
    shaped like an id (move.YOUTUBE_ID) is left out, whatever is in the file."""
    items = entry if isinstance(entry, list) else [entry]
    out = []
    for e in items:
        if isinstance(e, str):
            vid, saved, when = e, None, ""
        elif isinstance(e, dict):
            vid, saved, when = e.get("id"), e.get("length_s"), e.get("when")
            if isinstance(saved, bool) or not isinstance(saved, (int, float)) or saved <= 0:
                saved = None
            if not isinstance(when, str):
                when = ""
        else:
            continue
        if isinstance(vid, str) and move.YOUTUBE_ID.fullmatch(vid):
            out.append((vid, saved, when))
    return out


def _same_length(saved, length):
    return (saved is None and length is None) or (
        saved is not None and length is not None and abs(saved - length) <= VIDEO_LENGTH_SLACK_S)


def video_id(title, channel, duration_ms=None):
    """The YouTube video id found for this title and channel on an earlier lookup, or None. A
    channel can put out two videos of one title ("Weekly update"), so each length keeps its own id
    (VIDEO_IDS_PER_TITLE of them), and an id is only given back when the video's length agrees
    with the one saved with it, within VIDEO_LENGTH_SLACK_S, or when neither has a length and there
    is a channel to be sure by. Anything else reads as unknown, so a new lookup runs. An entry
    written before the length was kept (an object with no "length_s", or a bare id string) has no
    length. A file that is not an object (hand edited) reads as empty, the way remember_video_id
    treats it."""
    data = _read(VIDEO_IDS, {})
    entry = data.get(_video_ids_key(title, channel)) if isinstance(data, dict) else None
    length = _length_s(duration_ms)
    for vid, saved, _ in reversed(_video_entries(entry)):
        if _same_length(saved, length):
            if saved is None and not move._norm(channel):
                return None
            return vid
    return None


def remember_video_id(title, channel, vid, duration_ms=None):
    """Keep a found video id on disk for this title and channel, with the length it was found for
    (`duration_ms`, None for a live stream), so a bridge restart and the six hours move's own
    memory lasts do not lose it and an OK press never waits on the network for a video already
    found. An id for the same length replaces the one kept; another length is kept beside it, up to
    VIDEO_IDS_PER_TITLE. True when written. An id not shaped like one is refused, False and nothing
    written (this is called with the lookup's own answer in a background task, never with a
    person's input, so it is not a keyed ValueError like norm_who's). The file holds VIDEO_IDS_MAX
    titles at most: past that the least recently written are dropped."""
    if not (isinstance(vid, str) and move.YOUTUBE_ID.fullmatch(vid)):
        return False
    key = _video_ids_key(title, channel)
    length = _length_s(duration_ms)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _lock:
        data = _read(VIDEO_IDS, {})
        if not isinstance(data, dict):
            data = {}
        kept = [e for e in _video_entries(data.pop(key, None)) if not _same_length(e[1], length)]
        kept.append((vid, length, now))
        # written again: it goes to the end, the newest
        data[key] = [{"id": v, "length_s": l, "when": w} for v, l, w in kept[-VIDEO_IDS_PER_TITLE:]]
        if len(data) > VIDEO_IDS_MAX:
            def when(kv):
                # always a string, so a hand edited "when" of another type cannot break the sort
                return max([w for _, _, w in _video_entries(kv[1])] or [""])
            data = dict(sorted(data.items(), key=when)[-VIDEO_IDS_MAX:])   # stable: equal times keep their order
        _write(VIDEO_IDS, data)
    return True


WHO_FILE = os.path.join(DATA, "who.json")


def _whos():
    data = _read(WHO_FILE, {})
    tvs = data.get("tvs") if isinstance(data.get("tvs"), dict) else {}
    return data.get("who"), tvs   # "who": the older one-for-the-house value


def current_who(tv_id=None):
    """Who is on the couch at this TV (set from that TV's home or a phone). None means not said."""
    old, tvs = _whos()
    if tv_id is None:
        return old
    return tvs.get(tv_id, old)


def save_who(who, tv_id=None):
    old, tvs = _whos()
    if tv_id is None:
        old = who
        tvs = {k: who for k in tvs}
    else:
        tvs[tv_id] = who
    _write(WHO_FILE, {"who": old, "tvs": tvs})


def _sleeps():
    data = _read(SLEEP, {})
    if "ends" in data:  # the older one-TV format
        data = {"living-room": data["ends"]}
    return data


def sleep_ends(tv_id):
    return _sleeps().get(tv_id)


def save_sleep(ends, tv_id):
    data = _sleeps()
    data[tv_id] = ends
    _write(SLEEP, data)


def recs():
    return _read(RECS, {})


def save_recs(data):
    _write(RECS, data)
