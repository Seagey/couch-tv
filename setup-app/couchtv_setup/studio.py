"""Linking the TV to the person's Couch TV Studio account, and bringing their home with it.

How Setup gets signed in (no password ever typed into Setup):
1. Handoff: the website's "Set up my TV" button opens couchtv://setup?handoff=<one time code>
   (couchtv-setup://link?t=<code> works too). The same code can be typed: the website shows it as
   ABCD-EFGH for a person whose browser could not open the app.
2. Device code: Setup shows a 6 letter code and opens <studio>/link-setup, where the signed in person
   presses Allow (like signing in to a TV app).
Either way Setup ends up with a short lived setup token for that account, kept in memory only. Before that the
person is shown whose account it is (POST /v1/setup/who looks at a code without using it) and says Yes: a code that
came in by itself (a link anyone can make) never signs Setup in (server.py, /api/link-yes).

Then, once the TV is connected (DREAM-SETUP-BUILD.md has the whole contract):
- POST /v1/setup/tv  {tv: <tv profile>, name}  -> {tv_id, link, code, design, home}
  link: a token only for this TV, written into Couch TV on the TV over ADB (it never leaves the
        TV again except to Studio);
  code: a send code (CTV1) for the account's design, made for this tv_id, so the TV's own fetch gets
        the design and the home pack (HOME-DETAILS-PAYLOAD.md);
  home: the same home pack, so Setup can hand people and town to TV apps that predate the pack.
- POST /v1/setup/done {tv_id, ok, couchtv, linked, link}  -> linked: true (the TV said it took the link), "sent"
  (an older Couch TV cannot say) or false (it did not: the link the TV had before still works); the website's My TVs shows "Living room TV is ready".

The Studio API is live, and linking is ON in every build (25 Nov 2026: it was off unless an environment variable
said "live", which no release ever set, so no Setup ever linked an account). COUCHTV_SETUP_STUDIO=off switches it
off (development, and the tests that must send nothing). COUCHTV_SETUP_STUDIO_STUB=<file.json> answers from a
file instead (development and tests).
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from .tv import TvError

DEFAULT_STUDIO = "https://couchtv.joshuaseage.com"
SHORT = "23456789ABCDEFGHJKMNPQRSTVWXYZ"   # the same letters the TV's design codes use (no 0 1 I L O U)
LONG_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
TV_ID_RE = re.compile(r"[A-Za-z0-9_-]{4,64}")   # a My TVs row id
SCHEMES = ("couchtv", "couchtv-setup")


def mode():
    """ "live" (the default), "stub" or "off"."""
    v = os.environ.get("COUCHTV_SETUP_STUDIO", "").lower()
    if v == "off":
        return "off"
    if os.environ.get("COUCHTV_SETUP_STUDIO_STUB"):
        return "stub"
    return "live"


def base():
    u = os.environ.get("COUCHTV_SETUP_STUDIO_URL") or DEFAULT_STUDIO
    m = re.match(r"^(https://[a-z0-9.-]+(:\d{1,5})?|http://(127\.0\.0\.1|localhost)(:\d{1,5})?)/?$", u.strip(), re.I)
    if not m:
        raise TvError("The Couch TV Studio address is not a safe one, so it was not used.", "bad_studio")
    return m.group(1).lower()


# ---- the code from the website ----

def read_code(s):
    """A handoff as typed or opened: the long one from the link, or the short ABCD-EFGH one. Returns the
    code to send ("ABCD-EFGH" or the long one), or "" when it is not a code (then nothing is sent)."""
    s = str(s or "").strip()
    if not s:
        return ""
    if "://" in s:
        return parse_url(s)
    if LONG_RE.match(s):
        return s
    c = s.upper().replace("-", "").replace(" ", "")
    if len(c) == 8 and all(ch in SHORT for ch in c):
        return c[:4] + "-" + c[4:]
    return ""


def parse_url(url):
    """couchtv://setup?handoff=<code>, couchtv-setup://link?t=<code> or couchtv-setup://setup?handoff=.
    Anything else gives ""."""
    try:
        u = urllib.parse.urlsplit(str(url or "").strip())
    except ValueError:
        return ""
    if u.scheme.lower() not in SCHEMES or u.netloc.lower() not in ("setup", "link"):
        return ""
    q = urllib.parse.parse_qs(u.query)
    raw = (q.get("handoff") or q.get("t") or [""])[0]
    return read_code(raw) if "://" not in raw else ""


def url_in(argv):
    """The first couchtv link this program was opened with (Windows passes it as an argument; the Mac
    build's argv emulation does the same), or None."""
    for a in argv[1:]:
        if str(a).lower().startswith(tuple(s + "://" for s in SCHEMES)):
            return a
    return None


# ---- the home pack (HOME-DETAILS-PAYLOAD.md, version 1) ----

PERSON_ID = re.compile(r"^p_[a-z0-9]{6,12}$")
COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
PHOTO = re.compile(r"^data:image/jpeg;base64,[A-Za-z0-9+/=]+$")


def check_home(pack):
    """The home pack, kept only where it follows the contract; None when it is not one. People with a
    bad id or name are dropped, not the whole pack. A higher "v" keeps people and town only."""
    if not isinstance(pack, dict) or not isinstance(pack.get("v"), int) or pack["v"] < 1:
        return None
    if not isinstance(pack.get("rev"), int) or pack["rev"] < 0:
        return None
    out = {"v": pack["v"], "rev": pack["rev"], "wipe": pack.get("wipe") is True}
    if out["wipe"]:
        return out
    if isinstance(pack.get("people"), list):
        people = []
        for p in pack["people"][:8]:
            if not isinstance(p, dict) or not PERSON_ID.match(str(p.get("id") or "")):
                continue
            name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(p.get("name") or "")).strip()
            if not 1 <= len(name) <= 24:
                continue
            photo = p.get("photo")
            people.append({"id": p["id"], "name": name, "kids": p.get("kids") is True,
                           "colour": p.get("colour") if isinstance(p.get("colour"), str) and COLOUR.match(p["colour"]) else None,
                           "photo": photo if isinstance(photo, str) and len(photo) <= 60000 and PHOTO.match(photo) else None})
        out["people"] = people
    t = pack.get("town")
    if isinstance(t, dict):
        try:
            name = str(t.get("name") or "").strip()
            lat, lon = round(float(t["lat"]), 2), round(float(t["lon"]), 2)
            if 1 <= len(name) <= 40 and -90 <= lat <= 90 and -180 <= lon <= 180:
                out["town"] = {"name": name, "lat": lat, "lon": lon}
        except (KeyError, TypeError, ValueError):
            pass
    if pack["v"] == 1 and "wifi" in pack:
        w = pack["wifi"]
        if w is None:
            out["wifi"] = None
        elif isinstance(w, dict) and isinstance(w.get("name"), str) and 1 <= len(w["name"]) <= 32 \
                and isinstance(w.get("password", ""), str) and len(w.get("password", "")) <= 63:
            out["wifi"] = {"name": w["name"], "password": w.get("password", "")}
    return out


def setup_inputs(home):
    """What the current setup step (steps.make_home) can take today: names in order, and a town for the
    weather. Photos, colours and guest Wi-Fi arrive with the design code instead, for TV apps that read
    the home pack."""
    if not home or home.get("wipe"):
        return [], None
    return [{"id": p["id"], "name": p["name"]} for p in home.get("people") or []], home.get("town")


# ---- the calls ----

class Link:
    """One sign in, in memory only. Never written to disk."""

    def __init__(self):
        self.token = None
        self.account = None
        self.device = None
        self.tv = None


def _stub():
    with open(os.environ["COUCHTV_SETUP_STUDIO_STUB"], encoding="utf-8") as f:
        return json.load(f)


def call(path, body, token=None, timeout=15):
    """POST to Couch TV Studio. "off": raises "studio_off"; "stub": the answer under that path in the stub
    file; "live": the real call, https only, no cookies, no redirects followed."""
    m = mode()
    if m == "off":
        raise TvError("Couch TV Studio linking is switched off in this Setup.", "studio_off")
    if m == "stub":
        ans = _stub().get(path)
        if ans is None:
            raise TvError("Could not reach your Couch TV account.", "studio_down")
        if isinstance(ans, dict) and ans.get("_status") and ans["_status"] >= 400:
            raise TvError(ans.get("error") or "Your Couch TV account said no.", ans.get("code") or "studio_said")
        return ans
    req = urllib.request.Request(base() + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "couch-tv-setup",
                                          **({"Authorization": "Bearer " + token} if token else {})})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    from .release import _context
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=_context()))
    try:
        with opener.open(req, timeout=timeout) as r:
            return json.loads(r.read(1_000_000).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            said = json.loads(e.read(4000).decode("utf-8", "replace"))
        except Exception:
            said = {}
        if e.code == 428:
            return {"pending": True}
        # Studio's errors are {error: "<short code>", message: "<words>"} (DREAM-SETUP-BUILD.md, "Studio side as
        # built"): the words are shown, the short code is kept as the code. Older answers put words in "error".
        said = said if isinstance(said, dict) else {}
        err = said.get("error") if isinstance(said.get("error"), str) else ""
        short = err if re.fullmatch(r"[a-z_]{2,40}", err) else ""
        words = said.get("message") if isinstance(said.get("message"), str) and said.get("message").strip() else \
            (err if err and not short else "Your Couch TV account said no. Try the button on the website again.")
        code = said.get("code") if isinstance(said.get("code"), str) else \
            ("slow_down" if e.code == 429 else short or ("expired" if e.code in (401, 410) else "studio_said"))
        raise TvError(re.sub(r"[\x00-\x1f\x7f<>]", "", str(words))[:200], code) from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise TvError("Could not reach your Couch TV account. Check the internet and try again.", "studio_down") from e


OLD_SITE = "The website is not ready for this Setup yet. Try again later."


def clean_account(acct):
    """The account as the page may show it: name, covered email ("s***@example.com") and design name."""
    acct = acct if isinstance(acct, dict) else {}
    mail = acct.get("email")
    ok = isinstance(mail, str) and re.fullmatch(r"[^\s@<>\x00-\x1f]{1,4}\*\*\*@[A-Za-z0-9.-]{1,80}", mail)
    # the name is whatever its account says: letters that turn text round, and what makes it look like an email, go
    name = re.sub(r"[^\w .,'\u2019-]+", " ", str(acct.get("name") or ""))
    return {"name": re.sub(r"\s+", " ", name).strip()[:40] or None,
            "email": mail if ok else None,
            "design": re.sub(r"[\x00-\x1f\x7f<>]", "", str(acct.get("design") or ""))[:60] or None}


def who(code):
    """Whose account a code from the website is for, WITHOUT using it. A website from before this answers 404:
    then nothing is used and nothing is linked."""
    c = read_code(code)
    if not c:
        raise TvError("That is not a code from the Couch TV website. It looks like ABCD-EFGH.", "bad_code")
    try:
        ans = call("/v1/setup/who", {"handoff": c})
    except TvError as e:
        if e.code in ("not_found", "method_not_allowed"):
            raise TvError(OLD_SITE, "studio_old") from e
        raise
    acct = clean_account(ans.get("account") if isinstance(ans, dict) else None)
    if not acct["email"]:
        raise TvError(OLD_SITE, "studio_old")
    return c, acct


def end(link):
    """Signs this Setup out at the account too. Never raises: it is forgotten here either way."""
    if not link or not link.token:
        return False
    try:
        call("/v1/setup/end", {}, link.token, timeout=6)
        return True
    except TvError:
        return False


def _signed_in(link, ans):
    tok = ans.get("token") if isinstance(ans, dict) else None
    if not isinstance(tok, str) or not LONG_RE.match(tok):
        raise TvError("Your Couch TV account sent back something unexpected. Try the button on the website again.",
                      "studio_bad")
    link.token = tok
    link.account = clean_account(ans.get("account"))
    return link.account


def handoff(link, code):
    c = read_code(code)
    if not c:
        raise TvError("That is not a code from the Couch TV website. It looks like ABCD-EFGH.", "bad_code")
    return _signed_in(link, call("/v1/setup/handoff", {"handoff": c}))


def device_start(link):
    ans = call("/v1/setup/device", {})
    code, dev = str(ans.get("user_code") or ""), str(ans.get("device_code") or "")
    if not (re.fullmatch(r"[A-Z0-9]{4}-?[A-Z0-9]{4}", code) and LONG_RE.match(dev)):
        raise TvError("Your Couch TV account sent back something unexpected.", "studio_bad")
    link.device = dev
    verify = str(ans.get("verify") or base() + "/link-setup")
    if not verify.startswith(base() + "/"):
        verify = base() + "/link-setup"
    return {"user_code": code, "verify": verify, "interval": max(2, min(int(ans.get("interval") or 3), 10))}


def device_poll(link):
    if not link.device:
        raise TvError("Start signing in first.", "no_device")
    try:
        ans = call("/v1/setup/device/poll", {"device_code": link.device})
    except TvError as e:
        if e.code == "slow_down":      # 429: asked a little early; the next look is soon enough
            return {"pending": True}
        raise
    if ans.get("pending"):
        return {"pending": True}
    link.device = None
    return {"account": _signed_in(link, ans)}


def register_tv(link, profile, name, tv_id=None):
    """Tells the account about this TV and gets what goes onto it. Returns
    {"tv_id", "link", "code", "design", "home"} with every part checked."""
    if not link.token:
        raise TvError("Sign in to your Couch TV account first.", "no_account")
    body = {"tv": profile, "name": str(name or "")[:40]}
    # Setting this TV up again: its My TVs row, so Studio uses that row (and makes a new link for it)
    # instead of making "Living room TV 2". Only a well formed id goes.
    if isinstance(tv_id, str) and TV_ID_RE.fullmatch(tv_id):
        body["tv_id"] = tv_id
    try:
        ans = call("/v1/setup/tv", body, link.token)
    except TvError as e:
        if "tv_id" not in body or e.code != "not_found":
            raise
        # an id another account made, or a row deleted since: set it up as a new TV of this account
        del body["tv_id"]
        ans = call("/v1/setup/tv", body, link.token)
    out = {"tv_id": None, "link": None, "code": None, "design": None, "home": None}
    if isinstance(ans.get("tv_id"), str) and TV_ID_RE.fullmatch(ans["tv_id"]):
        out["tv_id"] = ans["tv_id"]
    if isinstance(ans.get("link"), str) and LONG_RE.match(ans["link"]):
        out["link"] = ans["link"]
    code = ans.get("code")
    if isinstance(code, str) and re.fullmatch(r"CTV1-[A-Za-z0-9_-]{43}", code):
        out["code"] = code
    if isinstance(ans.get("design"), str):
        out["design"] = re.sub(r"[\x00-\x1f\x7f<>]", "", ans["design"])[:60]
    out["home"] = check_home(ans.get("home"))
    link.tv = out
    return out


def report_done(link, ok, couchtv=None, profile=None, linked=None):
    """Tells the account the TV is set up, with the TV profile again now that it has the measured speed.
    linked: True, "sent" or False, for the link this run registered (the module's words above)."""
    if not link.token or not link.tv or not link.tv.get("tv_id"):
        return False
    try:
        call("/v1/setup/done", {"tv_id": link.tv["tv_id"], "ok": bool(ok), "couchtv": couchtv, "tv": profile,
                                "linked": linked, "link": link.tv.get("link")}, link.token)
        return True
    except TvError:
        return False


def tv_seen(link):
    """Has the TV used its new link yet? False when it has not, or when nobody can say."""
    if not link.token or not link.tv or not link.tv.get("tv_id"):
        return False
    try:
        return call("/v1/setup/seen", {"tv_id": link.tv["tv_id"]}, link.token).get("linked") is True
    except TvError:
        return False


def send_health(link, report):
    """Posts a health report the person said yes to. Only to their own account, only for this TV."""
    if not link.token or not link.tv or not link.tv.get("tv_id"):
        raise TvError("Link your Couch TV account first, then send the report.", "no_account")
    ans = call("/v1/setup/health", {"tv_id": link.tv["tv_id"], "report": report}, link.token)
    ref = ans.get("ref") if isinstance(ans, dict) else None
    return {"sent": True, "ref": ref if isinstance(ref, str) and re.fullmatch(r"[A-Za-z0-9_-]{3,40}", ref) else None}
