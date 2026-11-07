"""Watch history, imported history and cached picks, kept as files in bridge/data/.

History is kept forever. Two append-only JSON-lines files, oldest first:
- history.jsonl: what was played on our TVs (through the bridge, or seen playing in an app).
- imported.jsonl: what came from the owner's own downloads (Netflix viewing activity, YouTube
  watch history), see history_import.py. Each line has a "key" so re-importing a file adds nothing twice.
"""
import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone

import config

DATA = config.DATA
HISTORY_OLD = os.path.join(DATA, "history.json")  # the older capped list, read once and moved over
HISTORY = os.path.join(DATA, "history.jsonl")
IMPORTED = os.path.join(DATA, "imported.jsonl")
RECS = os.path.join(DATA, "recs.json")
SLEEP = os.path.join(DATA, "sleep.json")
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


def history():
    """Plays on our TVs, newest first. Kept forever."""
    _migrate()
    return list(reversed(_lines(HISTORY)))


def add_history(item):
    """Every new line gets its own id, so a Keep watching card always opens the line it shows."""
    _migrate()
    _append(HISTORY, [{"id": uuid.uuid4().hex[:16], **item}])


def history_item(item_id):
    """One history line by its id, or None."""
    for h in history():
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
        raise ValueError("who must be " + ", ".join(config.PEOPLE_IDS) + " or both")
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
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    seen, out = set(), []
    for h in history():
        if not h.get("id") or h.get("tv") != tv_id or h.get("who") != who:
            continue
        when = _when(h)
        if when is None or when < cutoff:
            continue
        key = (h.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(h)
        if len(out) >= limit:
            break
    return out


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
