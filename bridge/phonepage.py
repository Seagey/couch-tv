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

PIN_START_MIN_LEFT = 90 # "Show a code on the TV" keeps a live code with more than this left (Server.kt pinForQr(90))
LOCK_PER_ADDRESS = 5    # one address adds at most this many wrong codes to the pairing lock in its window

_ids = itertools.count(1)
# gen: changes whenever the code does (made, used, thrown away), so the TV home redraws its QR at once
# guessed: (address, wrong code) pairs already tried on this code; the same one again is not a new try
_pin = {"code": None, "until": 0.0, "wrong": 0, "tv": None, "shown_until": 0.0, "gen": 0, "guessed": set()}
_tvs = {}
_lock_tries = {}        # address -> [(time, guess fingerprint)], the wrong codes it added to the pairing lock


def _now_ms():
    return int(time.time() * 1000)


def _tv(tv):
    return _tvs.setdefault(tv or "default", {"heard": 0, "view": None, "view_at": 0, "inbox": [], "waiters": {},
                                             "phone_at": 0, "settings_at": None})


def reset():
    """Forget everything (tests)."""
    _tvs.clear()
    _lock_tries.clear()
    _pin.update(code=None, until=0.0, wrong=0, tv=None, shown_until=0.0, gen=0, guessed=set())


# ---------------------------------------------------------------- pairing codes

def new_pin(tv=None, show=False, now=None):
    now = time.time() if now is None else now
    _pin.update(code="%06d" % secrets.randbelow(1_000_000), until=now + PIN_SECS, wrong=0, tv=tv, guessed=set(),
                shown_until=now + PIN_SECS if show else 0.0, gen=_pin["gen"] + 1)
    return _pin["code"]


def _drop_pin():
    _pin.update(code=None, until=0.0, shown_until=0.0, gen=_pin["gen"] + 1)


def pin_gen():
    """Changes whenever the code does: the TV home asks for its QR again (phone-page.js), so a used or
    thrown away code never stays in it."""
    return _pin["gen"]


def current_pin(now=None):
    now = time.time() if now is None else now
    return _pin["code"] if _pin["code"] and now < _pin["until"] else None


def pin_seconds_left(now=None):
    now = time.time() if now is None else now
    return max(0, int(_pin["until"] - now)) if current_pin(now) else 0


def pin_for_qr(tv=None, now=None, min_left=PIN_QR_MIN_LEFT):
    """The live code if it has more than 30 s left (so a code someone is typing is not swapped), else a new one."""
    if current_pin(now) and pin_seconds_left(now) > min_left:
        return _pin["code"]
    return new_pin(tv, now=now)


def show_pin(tv, now=None):
    """"Show a code on the TV": the live code (the one inside the TV's QR) when it has more than 90 s left,
    else a new one, shown as a line on that TV's home. Never swaps a live code for a new one, so nobody on
    the Wi-Fi can keep the QR's code dead by asking again and again."""
    now = time.time() if now is None else now
    code = pin_for_qr(tv, now, PIN_START_MIN_LEFT)
    _pin.update(tv=tv, shown_until=_pin["until"])
    return code


def pair(code, ip=None, now=None):
    """True for the live code (used up by it), False otherwise; 5 different wrong tries throw the code away.
    The same wrong code again from the same address is not a new try, so one phone repeating "000000" can
    never kill the code in the TV's QR."""
    live = current_pin(now)
    if not live:
        return False
    given = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not secrets.compare_digest(given.encode(), live.encode()):
        seen = (ip or "this computer", given[:12])
        if seen in _pin["guessed"]:
            return False
        _pin["guessed"].add(seen)
        _pin["wrong"] += 1
        if _pin["wrong"] >= PIN_WRONG_MAX:
            _drop_pin()
        return False
    _drop_pin()
    return True


def counts_for_lock(ip, code, window, now=None):
    """Whether a wrong code adds to the pairing lock (server.pair_wrong). Only called while a code was live.
    The same wrong code again from one address is not a new guess, and one address adds at most 5 in the
    lock's window: so one phone or script alone can never lock pairing for everyone (its own limit is the
    per address one, server.is_rate_limited). It takes guesses from several addresses to lock it."""
    now = time.time() if now is None else now
    ip = ip or "this computer"
    fp = "".join(ch for ch in str(code or "") if ch.isdigit())[:12]
    for k in list(_lock_tries):
        _lock_tries[k] = [t for t in _lock_tries[k] if now - t[0] < window]
        if not _lock_tries[k]:
            del _lock_tries[k]
    mine = _lock_tries.setdefault(ip, [])
    if any(t[1] == fp for t in mine) or len(mine) >= LOCK_PER_ADDRESS:
        return False
    mine.append((now, fp))
    while len(_lock_tries) > 1000:   # memory bound, as server.RATE_LIMIT_ADDRESSES
        _lock_tries.pop(next(iter(_lock_tries)))
    return True


def address_wait(ip, window, now=None):
    """Seconds one address waits (0: none): 5 different wrong codes from it within the lock's window (10
    minutes) and it waits until the oldest falls out, nobody else does. About 720 guesses a day at most,
    instead of 7,200. Never the computer itself."""
    if not ip:
        return 0
    now = time.time() if now is None else now
    mine = sorted(t[0] for t in _lock_tries.get(ip, []) if now - t[0] < window)
    if len(mine) < LOCK_PER_ADDRESS:
        return 0
    return max(1, int(-(-(mine[-LOCK_PER_ADDRESS] + window - now) // 1)))


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
            "pin": pin, "pin_gen": _pin["gen"], "settings_at": s["settings_at"], "want_view": s["view"] is None}


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
    def __init__(self, status, message, key="err_something_wrong"):
        super().__init__(message)
        self.status = status
        self.key = key   # the words' key for a home in another language (bridge/messages.py)


async def edit(tv, change, wait=EDIT_WAIT_S):
    """Hands one change to the TV home. Returns its answer, or None when the TV home is not open and the
    change waits for it (as the on-TV app keeps it until the home opens). Lists and the guide are sent
    whole, so they are only taken while the TV home can say what is there now, never queued blind."""
    phone_used(tv)
    s = _tv(tv)
    if not live(tv):
        if "lists" in change or "guide" in change or "widget_set" in change or "design_apps" in change:
            raise Refused(409, "Open the Couch TV home on the TV first, then save again.", "err_tv_home_closed")
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
# (Photos.kt): 25 MB, 100 megapixels, JPEG, PNG or WebP, one photo at a time (server.py).
PHOTO_MAX_UPLOAD = 25 * 1024 * 1024
PHOTO_W, PHOTO_H = 1920, 1080
PHOTO_MAX_PIXELS = 100_000_000
PHOTO_MAX_PIXELS_OTHER = 40_000_000   # a PNG or WebP (decoded whole): 40 megapixels at most
PHOTO_FORMATS = ["JPEG", "PNG", "WEBP"]   # what a phone sends as a photo (a JPEG with a second picture opens as MPO)
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
        from PIL import Image
    except ImportError:
        raise Refused(501, "Photos from the phone need one more part on the home computer. In the couch-tv "
                           "folder there, install what bridge/requirements.txt lists (docs/UPDATES.md says how), "
                           "then restart Couch TV there.")
    import io
    # one rule for size: Pillow itself refuses a picture over twice this (DecompressionBombError) before decoding
    Image.MAX_IMAGE_PIXELS = PHOTO_MAX_PIXELS
    too_big = Refused(413, "That photo is too big. Pick one under 100 megapixels.")
    try:
        # only photo formats: Pillow can also read PostScript (it runs Ghostscript), PSD, TIFF and many more,
        # none of which a phone sends as a photo, and none of which should run on the home computer
        img = Image.open(io.BytesIO(raw), formats=PHOTO_FORMATS)
        w, h = img.size
    except Image.DecompressionBombError:
        raise too_big
    except Exception:
        raise Refused(415, "That is not a photo the TV can read. Send a JPEG or PNG.")
    # a picture far bigger than any camera's (a crafted PNG of a few KB can claim this) is refused before decoding
    if w * h > PHOTO_MAX_PIXELS:
        raise too_big
    # a PNG or WebP is decoded whole (only a JPEG can be decoded smaller): a lower limit keeps the memory down
    if img.format not in ("JPEG", "MPO") and w * h > PHOTO_MAX_PIXELS_OTHER:
        raise Refused(413, "That picture is too big. Send it as a JPEG, or pick one under 40 megapixels.")
    try:
        if img.format in ("JPEG", "MPO"):
            # a JPEG is decoded at 1/2, 1/4 or 1/8 size when that is still at least screen size: a 50 megapixel
            # photo then never takes 150 MB of memory on the home computer
            img.draft(None, fit(w, h))
        taken, turn = None, None
        try:
            ex0 = img.getexif()
            turn = ex0.get(0x0112)                          # the camera's note of which way is up
            taken = ex0.get_ifd(0x8769).get(0x9003)         # the day it was taken, for On this day
        except Exception:
            pass
        # made screen size first, then turned and made RGB, so no second full size copy is ever made
        # (fit gives the same size either way round)
        if img.mode == "1":
            img = img.convert("L")
        elif img.mode not in ("RGB", "RGBA", "L", "LA"):
            img = img.convert("RGBA" if "A" in img.mode or "transparency" in img.info else "RGB")
        tw, th = fit(*img.size)
        if (tw, th) != img.size:
            img = img.resize((tw, th), Image.LANCZOS, reducing_gap=3.0)
        img = img.convert("RGB")
        how = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180, 4: Image.Transpose.FLIP_TOP_BOTTOM,
               5: Image.Transpose.TRANSPOSE, 6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
               8: Image.Transpose.ROTATE_90}.get(turn)
        if how is not None:
            img = img.transpose(how)
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
