"""Booking emails: read Airbnb's "reservation confirmed" emails and pull out the guest's first name and
how many are coming, so the TV can say "Welcome, Sarah" without the host typing it.

Taken from guest-tv, our sibling project for guest TVs, which reads the same emails the same way.
Airbnb's calendar link only says "Reserved" (no name, since Dec 2019). The booking email has the name,
the reservation code (HM...) and the guest count. The TV (app.js, the Welcome widget's guest) asks
GET /api/stay-names and matches each booking to a stay in its own calendar by the arrival day.

Two places to read from, both optional, both on this computer only:
  bridge/data/bookings-inbox/*.eml   forwarded or saved emails
  config.json "bookings": {"imap": {"host": "imap.gmail.com", "user": "you@example.com"}}
                                     with an app password in .env as BOOKINGS_PASSWORD (read only:
                                     BODY.PEEK leaves every email unread)

The names never leave this computer and the TV: not logged, not in the action history, not in a design.
What it reads: an email from Airbnb (or forwarded from one, "Fwd:" and "Fw:" taken off) whose subject
says "Reservation confirmed" or "New booking" with "<name> arrives <month> <day>", in plain text or
HTML; the reservation code (HM...) and "<n> guests" from its body; and a "cancelled" email with the
same code takes that booking away. The patterns were written from Airbnb's emails as guest-tv describes
them and checked against made up emails (tests/fixtures/bookings), so they are loose on purpose, and a
name the host types on the TV always wins over one read here.
"""
import datetime as dt, email, email.policy, email.utils, glob, html, imaplib, os, re, ssl, time

HERE = os.path.dirname(os.path.abspath(__file__))
INBOX = os.environ.get("BOOKINGS_INBOX") or os.path.join(os.environ.get("COUCH_DATA") or os.path.join(HERE, "data"), "bookings-inbox")
CODE = re.compile(r"\bHM[A-Z0-9]{6,10}\b")
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def text_of(msg):
    """The readable text of an email: the plain part, or the HTML part with the tags taken out."""
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    body = part.get_content()
    if part.get_content_type() == "text/html":
        body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
        body = html.unescape(re.sub(r"<[^>]+>", "\n", body))
    return re.sub(r"[ \t]+", " ", body)


def month_day(s):
    """'Nov 2', '2 Nov', 'November 2' -> (11, 2). No year: the calendar stay gives it."""
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\b", s) or re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b", s)
    if not m:
        return None
    a, b = m.groups()
    day, mon = (a, b) if a.isdigit() else (b, a)
    mon = MONTHS.get(mon[:3].lower())
    return (mon, int(day)) if mon and 1 <= int(day) <= 31 else None


def parse(raw):
    """One email (bytes) -> {kind: confirmed|cancelled, guest, guests, code, arrives: (month, day)} or None."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    subject = str(msg.get("subject", "")).strip()
    body = text_of(msg)
    if "airbnb" not in (str(msg.get("from", "")) + subject + body).lower():
        return None
    subject = re.sub(r"^(?:fwd?|fw):\s*", "", subject, flags=re.I)
    if re.search(r"cancel", subject, re.I):
        kind = "cancelled"
    elif re.search(r"confirmed|new booking", subject, re.I):
        kind = "confirmed"
    else:
        return None
    # "Reservation confirmed - Sarah Smith arrives Nov 2"
    m = re.search(r"[-\u2013\u2014:]\s*([^-\u2013\u2014:]+?)\s+arrives\b(.*)$", subject, re.I)
    name, when = (m.group(1), m.group(2)) if m else ("", "")
    if not name:
        m = re.search(r"\b([A-Z][\w'’-]+)(?:'s|’s| has)\s+(?:reservation|booking|trip)", body)
        name = m.group(1) if m else ""
    guests = 0
    m = re.search(r"\b(\d{1,2})[ \t]+guests?\b", body, re.I)
    if m:
        guests = int(m.group(1))
    else:
        guests = sum(int(n) for n in re.findall(r"\b(\d{1,2})[ \t]+(?:adults?|children|child)\b", body, re.I))
    code = CODE.search(subject + "\n" + body)
    return {"kind": kind, "guest": (name.split() or [""])[0][:30], "guests": guests,
            "code": code.group(0) if code else "", "arrives": month_day(when) if when else None,
            "date": msg.get("date", "")}


def from_folder():
    out = []
    for p in sorted(glob.glob(os.path.join(INBOX, "*.eml"))):
        with open(p, "rb") as f:
            out.append(f.read())
    return out


def from_imap(cfg, password, days=120):
    """Airbnb emails from the last few months. Read only (BODY.PEEK leaves them unread)."""
    # the mail server's certificate and name are checked (the default context), so the app password is
    # only ever sent to the real mailbox
    box = imaplib.IMAP4_SSL(cfg["host"], int(cfg.get("port", 993)), ssl_context=ssl.create_default_context(), timeout=20)
    try:
        box.login(cfg["user"], password)
        box.select(cfg.get("folder", "INBOX"), readonly=True)
        since = (dt.date.today() - dt.timedelta(days=days)).strftime("%d-%b-%Y")
        _, ids = box.search(None, '(FROM "airbnb" SINCE %s)' % since)
        out = []
        for i in (ids[0].split() if ids and ids[0] else [])[-200:]:
            _, data = box.fetch(i, "(BODY.PEEK[])")
            if data and isinstance(data[0], tuple):
                out.append(data[0][1])
        return out
    finally:
        try:
            box.logout()
        except Exception:
            pass


def collect(settings, pv):
    """Every booking email we can read, parsed, oldest first (so a cancel lands after its booking)."""
    raws, errors = from_folder(), []
    cfg = (settings.get("bookings") or {}).get("imap")
    if cfg and pv.get("bookings_password"):
        try:
            raws += from_imap(cfg, pv["bookings_password"])
        except Exception as e:
            errors.append("mailbox: %s" % e)
    found = [b for b in (parse(r) for r in raws) if b]

    def when(b):
        try:
            return email.utils.parsedate_to_datetime(b["date"]).timestamp()
        except Exception:
            return 0
    return sorted(found, key=when), errors


def match(bookings, stays):
    """Calendar stays [{from, to, code}] + bookings -> {"2026-11-02": {guest, guests, code}}."""
    names = {}
    for b in bookings:
        hit = next((s for s in stays if b["code"] and s.get("code") == b["code"]), None)
        if not hit and b["arrives"]:
            hit = next((s for s in stays if (s["from"].month, s["from"].day) == b["arrives"]), None)
        if not hit:
            continue
        key = hit["from"].isoformat()
        if b["kind"] == "cancelled":
            names.pop(key, None)
        elif b["guest"]:
            names[key] = {"guest": b["guest"], "guests": b["guests"], "code": b["code"]}
    return names


def for_tv(bookings):
    """The bookings still on, for the TV to match by arrival day: [{"arrives": "11-02", "guest", "guests"}].
    A cancel takes out the booking with its code (or, with no code, the one arriving that day)."""
    live = []
    for b in bookings:
        if b["kind"] == "cancelled":
            live = [x for x in live if not ((b["code"] and x["code"] == b["code"]) or (not b["code"] and b["arrives"] and x["arrives"] == b["arrives"]))]
        elif b["guest"] and b["arrives"]:
            live = [x for x in live if not (b["code"] and x["code"] == b["code"])] + [b]
    return [{"arrives": "%02d-%02d" % x["arrives"], "guest": x["guest"], "guests": x["guests"]} for x in live]


class Reader:
    """Reads the emails at most every 15 minutes (from config.json "bookings" and .env BOOKINGS_PASSWORD)."""

    def __init__(self, settings, password, every=900):
        self.settings, self.password, self.every = settings if isinstance(settings, dict) else {}, password or "", every
        self.at, self.names, self.errors = 0, [], []

    def on(self):
        return bool(from_folder()) or bool((self.settings.get("imap") and self.password))

    def read(self):
        if time.time() - self.at < self.every:
            return self.names
        self.at = time.time()
        found, self.errors = collect({"bookings": self.settings}, {"bookings_password": self.password})
        self.names = for_tv(found)
        return self.names
