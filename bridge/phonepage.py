"""The phone's Home settings page (on-tv/web/setup.html) for a TV whose home this computer runs.

The on-TV app serves that page from the TV itself (Server.kt, /setup). Here the home computer serves the
same page with the same endpoints, so a Samsung, LG, VIDAA, Titan, Saphi, Panasonic, TiVo, Vega, Roku,
Apple TV or Android TV home driven by this bridge gets "Change this on your phone" too.

  * Pairing: a 6 digit code, shown only on the TV (inside its Home settings QR, or as a line on the
    home after "Show a code on the TV"). It lasts 3 minutes, is used once, and 5 wrong tries throw it
    away. The right code gets the bridge's pairing key, the same key the phone remote pairs with.
  * At home (the note, lists, guest Wi-Fi, house guide, calendar links) and a design's widget settings
    stay in the TV home's own store on the TV. The phone's change is handed to the TV home the next time
    it asks (GET /api/phone/inbox, every 10 s, every second while a phone page is open), the TV home
    applies it exactly as the on-TV app's hand over does (app.js tv.atHomeEdit) and answers back
    (POST /api/phone/done). What the phone reads back is the TV home's own view (tv.atHomeRead), which
    the TV home hands over when it changes; it is kept in memory only, never written to disk or logged.

Nothing here talks to anything outside the home network.
"""
import asyncio
import os
import re
import itertools
import json
import secrets
import time

PIN_SECS = 180          # a code lasts 3 minutes (Auth.kt)
PIN_WRONG_MAX = 5       # 5 wrong tries throw a code away
PIN_QR_MIN_LEFT = 30    # Home settings' QR reuses a code with more than this left (Auth.pinForQr)
LIVE_MS = 30_000        # the TV home asks at least every 10 s; 30 s of silence means it is not open
FAST_MS = 120_000       # a phone page used in the last 2 minutes: the TV home asks every second
EDIT_WAIT_S = 12.0      # how long a phone's change waits for the TV home's answer
WAIT_MAX = 20           # changes held for a TV home that is not open (HomeActivity.WAIT_MAX)
VIEW_MAX = 256 * 1024   # the TV home's At home view, at most
EDIT_MAX = 64 * 1024    # one change from the phone, at most

_ids = itertools.count(1)
_pin = {"code": None, "until": 0.0, "wrong": 0, "tv": None, "shown_until": 0.0}
_tvs = {}


def _now_ms():
    return int(time.time() * 1000)


def _tv(tv):
    return _tvs.setdefault(tv or "default", {"heard": 0, "view": None, "view_at": 0, "inbox": [], "waiters": {},
                                             "phone_at": 0, "settings_at": None})


def reset():
    """Forget everything (tests)."""
    _tvs.clear()
    _pin.update(code=None, until=0.0, wrong=0, tv=None, shown_until=0.0)


# ---------------------------------------------------------------- pairing codes

def new_pin(tv=None, show=False, now=None):
    now = time.time() if now is None else now
    _pin.update(code="%06d" % secrets.randbelow(1_000_000), until=now + PIN_SECS, wrong=0, tv=tv,
                shown_until=now + PIN_SECS if show else 0.0)
    return _pin["code"]


def current_pin(now=None):
    now = time.time() if now is None else now
    return _pin["code"] if _pin["code"] and now < _pin["until"] else None


def pin_seconds_left(now=None):
    now = time.time() if now is None else now
    return max(0, int(_pin["until"] - now)) if current_pin(now) else 0


def pin_for_qr(tv=None, now=None):
    """The live code if it has more than 30 s left (so a code someone is typing is not swapped), else a new one."""
    if current_pin(now) and pin_seconds_left(now) > PIN_QR_MIN_LEFT:
        return _pin["code"]
    return new_pin(tv, now=now)


def pair(code, now=None):
    """True for the live code (used up by it), False otherwise; 5 wrong tries throw the code away."""
    live = current_pin(now)
    if not live:
        return False
    given = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not secrets.compare_digest(given.encode(), live.encode()):
        _pin["wrong"] += 1
        if _pin["wrong"] >= PIN_WRONG_MAX:
            _pin.update(code=None, until=0.0, shown_until=0.0)
        return False
    _pin.update(code=None, until=0.0, shown_until=0.0)
    return True


def shown_pin(tv, now=None):
    """The code the TV home shows as a line ("Show a code on the TV"), for the TV it was asked for."""
    now = time.time() if now is None else now
    if current_pin(now) and _pin["shown_until"] > now and (_pin["tv"] or "default") == (tv or "default"):
        return {"code": _pin["code"], "seconds": max(1, int(_pin["shown_until"] - now))}
    return None


# ---------------------------------------------------------------- the TV home's side

def live(tv, now=None):
    """Whether the TV home asked in the last 30 seconds (it is open and takes a change at once)."""
    now = _now_ms() if now is None else now
    return now - _tv(tv)["heard"] < LIVE_MS


def phone_used(tv, now=None):
    _tv(tv)["phone_at"] = _now_ms() if now is None else now


def settings_changed(tv, updated):
    """A phone changed Home settings (the town, a photo): the TV home takes the copy at its next ask."""
    _tv(tv)["settings_at"] = updated


def inbox(tv, now=None):
    """What the TV home takes when it asks: the phone's changes waiting for it, whether to ask every
    second (a phone page is open), a code to show, and the Home settings stamp the phone last made."""
    now = _now_ms() if now is None else now
    s = _tv(tv)
    s["heard"] = now
    edits, s["inbox"] = s["inbox"], []
    pin = shown_pin(tv, now / 1000)
    return {"edits": [{"id": e["id"], "edit": e["edit"]} for e in edits],
            "fast": now - s["phone_at"] < FAST_MS or pin is not None,
            "pin": pin, "settings_at": s["settings_at"], "want_view": s["view"] is None}


def done(tv, edit_id, result):
    """The TV home's answer to one change."""
    fut = _tv(tv)["waiters"].pop(edit_id, None)
    if fut is not None and not fut.done():
        fut.set_result(result if isinstance(result, dict) else {"ok": False, "error": "The TV home did not answer. Try again."})
        return True
    return False


def take_view(tv, view, now=None):
    """The TV home's At home view (app.js atHomeView): kept in memory only, for the phone to read."""
    s = _tv(tv)
    s["view"] = view if isinstance(view, dict) else None
    s["view_at"] = _now_ms() if now is None else now
    s["heard"] = s["view_at"]


def read(tv, now=None):
    """The TV home's view for the phone, or None when the TV home is not open."""
    phone_used(tv, now)
    s = _tv(tv)
    return s["view"] if live(tv, now) and s["view"] is not None else None


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


async def edit(tv, change, wait=EDIT_WAIT_S):
    """Hands one change to the TV home. Returns its answer, or None when the TV home is not open and the
    change waits for it (as the on-TV app keeps it until the home opens). Lists and the guide are sent
    whole, so they are only taken while the TV home can say what is there now, never queued blind."""
    phone_used(tv)
    s = _tv(tv)
    if not live(tv):
        if "lists" in change or "guide" in change or "widget_set" in change or "design_apps" in change:
            raise Refused(409, "Open the Couch TV home on the TV first, then save again.")
        if len(s["inbox"]) >= WAIT_MAX:
            raise Refused(409, f"The TV is holding {WAIT_MAX} changes already. Open the Couch TV home on the TV, then save again.")
        s["inbox"].append({"id": next(_ids), "edit": change})
        return None
    eid = next(_ids)
    fut = asyncio.get_running_loop().create_future()
    s["waiters"][eid] = fut
    s["inbox"].append({"id": eid, "edit": change})
    try:
        return await asyncio.wait_for(fut, wait)
    except asyncio.TimeoutError:
        s["inbox"] = [e for e in s["inbox"] if e["id"] != eid]
        return {"ok": False, "error": "The TV home did not answer. Try again."}
    finally:
        s["waiters"].pop(eid, None)


def json_size(v):
    try:
        return len(json.dumps(v))
    except (TypeError, ValueError):
        return 1 << 30


# ---------------------------------------------------------------- photos from the phone

# Your photos for the home's scenes, sent from the phone's Home settings page. The picture goes from the
# phone to this computer only. It is turned the right way up, made no bigger than the screen (1920 by
# 1080, a portrait photo fits the screen turned), saved as a JPEG in data/photos, and listed in that
# TV's Home settings (photos) as {id, file}. The TV home shows a "bridge...jpg" file from this computer
# (GET /api/photo/<file>, with the pairing key), never from anywhere else. Same limits as the on-TV app
# (Photos.kt): 25 MB, 100 megapixels, JPEG or PNG (and anything else Pillow reads, such as WebP).
PHOTO_MAX_UPLOAD = 25 * 1024 * 1024
PHOTO_W, PHOTO_H = 1920, 1080
PHOTO_MAX_PIXELS = 100_000_000
PHOTO_NAME = re.compile(r"bridge[a-z0-9]{6,40}\.jpg")
STRAY_AGE_S = 3600     # a file nobody lists is deleted only once it is an hour old (an upload in flight is never)


def photo_dir(data):
    d = os.path.join(data, "photos")
    os.makedirs(d, exist_ok=True)
    return d


def photo_path(data, name):
    """The file for a name, only ever inside the photos folder, or None."""
    if not isinstance(name, str) or not PHOTO_NAME.fullmatch(name):
        return None
    p = os.path.join(photo_dir(data), name)
    return p if os.path.isfile(p) else None


def fit(w, h, max_w=PHOTO_W, max_h=PHOTO_H):
    """The size to scale (w, h) to so it fits inside the screen; never made bigger (Photos.fit)."""
    if w <= 0 or h <= 0:
        return 0, 0
    mw, mh = (max_h, max_w) if h > w else (max_w, max_h)
    s = min(1.0, mw / w, mh / h)
    return max(1, round(w * s)), max(1, round(h * s))


def make_photo(raw, data):
    """One picture from the phone, kept. Returns its file name, or raises Refused with words for the phone."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise Refused(501, "Photos from the phone need one more part on the home computer. On it, run: "
                           ".venv/bin/pip install -r bridge/requirements.txt, then restart Couch TV there.")
    import io
    try:
        img = Image.open(io.BytesIO(raw))
        w, h = img.size
    except Exception:
        raise Refused(415, "That is not a photo the TV can read. Send a JPEG or PNG.")
    # a picture far bigger than any camera's (a crafted PNG of a few KB can claim this) is refused before decoding
    if w * h > PHOTO_MAX_PIXELS:
        raise Refused(413, "That photo is too big. Pick one under 100 megapixels.")
    try:
        taken = None
        try:
            taken = img.getexif().get_ifd(0x8769).get(0x9003)   # the day it was taken, for On this day
        except Exception:
            pass
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        tw, th = fit(*img.size)
        if (tw, th) != img.size:
            img = img.resize((tw, th), Image.LANCZOS)
        name = "bridge" + secrets.token_hex(12) + ".jpg"
        out = os.path.join(photo_dir(data), name)
        kw = {"quality": 88}
        if isinstance(taken, str) and len(taken) <= 40:
            ex = Image.Exif()
            ex.get_ifd(0x8769)[0x9003] = taken
            kw["exif"] = ex
        tmp = out + ".part"
        img.save(tmp, "JPEG", **kw)
        os.replace(tmp, out)
        return name
    except Refused:
        raise
    except Exception:
        raise Refused(415, "That is not a photo the TV can read. Send a JPEG or PNG.")


def strays(listed, files):
    """From the file names every TV's Home settings list and the files in the photos folder: the phone
    photo files nobody lists (to delete). Files not made here ("bridge...jpg") are never touched."""
    return {f for f in files if PHOTO_NAME.fullmatch(f) and f not in listed}


def drop_strays(data, listed, now=None):
    now = time.time() if now is None else now
    d = photo_dir(data)
    gone = 0
    for f in strays(set(listed), set(os.listdir(d))):
        p = os.path.join(d, f)
        try:
            if now - os.path.getmtime(p) > STRAY_AGE_S:
                os.remove(p)
                gone += 1
        except OSError:
            pass
    return gone
