"""AirPlay 2 speakers on the home Wi-Fi, reported to the account by name (lane C, 28 Nov 2026).

Setup listens for AirPlay announcements (mDNS _airplay._tcp, the same browse it uses for TVs; it only listens, nothing is sent
to a speaker) and tells the account the speakers' names (POST /v1/setup/found { speakers: [{ name }] }). The editor then offers
them for the Speakers widget, and Rooms can give each TV its own. The account keeps names only: never an address.
Apple TVs, Macs, iPhones and iPads also announce AirPlay; the ones that say so in their name are left out.
"""
import re
import threading

from . import mdns, studio

SERVICE = "_airplay._tcp.local."
NOT_SPEAKER = re.compile(r"\b(apple tv|macbook|i?mac|mac (mini|studio|pro)|iphone|ipad)\b", re.I)
NAME = re.compile(r"^[A-Za-z0-9 ._'()&-]{1,40}$")
MAX = 24


def speakers_from(heard):
    """The speakers' names from what mDNS heard: cleaned, de-duplicated, at most 24."""
    out = []
    for h in heard or []:
        if not isinstance(h, dict) or str(h.get("service", "")).lower().rstrip(".") != SERVICE.rstrip(".").lower():
            continue
        raw = str(h.get("instance") or h.get("name") or "")
        # an AirPlay instance can start with the device's id: "AABBCCDDEEFF@Lounge" (that form is RAOP; kept safe here too)
        name = " ".join(raw.split("@", 1)[-1].replace("\\032", " ").split())[:40]
        if not name or not NAME.match(name) or NOT_SPEAKER.search(name):
            continue
        if name.lower() not in [x.lower() for x in out]:
            out.append(name)
    return out[:MAX]


def find(wait=3.0, browse=mdns.browse):
    try:
        return speakers_from(browse([SERVICE], wait))
    except Exception:
        return []


def report(token, names, call=studio.call):
    """Names only to the account; the other lists the account has stay as they are."""
    return call("/v1/setup/found", {"speakers": [{"name": n} for n in names]}, token)


def report_soon(token, wait=3.0, browse=mdns.browse, call=studio.call):
    """Look and report in the background: Setup never waits on it, and a failure changes nothing."""
    if not token or (call is studio.call and studio.mode() != "live"):
        return None                       # signed out, or a test or stub Setup: nothing heard, nothing sent
    def run():
        try:
            names = find(wait, browse)
            if names:
                report(token, names, call)
        except Exception:
            pass
    t = threading.Thread(target=run, daemon=True, name="airplay-find")
    t.start()
    return t
