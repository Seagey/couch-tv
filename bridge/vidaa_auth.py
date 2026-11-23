"""Hisense VIDAA MQTT credentials.

Newer VIDAA firmware (the "modern" transport, 2024 on) does not take a fixed username and password.
It wants a client id in Hisense's own shape and a username and password worked out from the clock, a
fresh pair every time the app connects. This is how Hisense's own phone app gets in. The numbers below
come from reading Hisense's libmqttcrypt.so, confirmed against a real VIDAA 9 TV (docs/VIDAA.md).

The flow the driver uses:
  1. connect with the client certificate and a credentials() pair for the TV's auth method,
  2. pair once with the PIN (the TV then remembers this uuid), and
  3. reconnect with a fresh credentials() pair for the same uuid: the TV now lets the data topics through.

No token is needed on the modern firmware: the pairing is kept against the uuid, not a token. Older
firmware is covered too (legacy and middle), and the static service login is the last thing tried.
"""
import hashlib
import os
import time

# From libmqttcrypt.so. A tester whose TV answers differently corrects these in one place.
PATTERN = "38D65DC30F45109A369A86FCE866A85B"   # salt for the client id's race hash
SUFFIX_MODERN = "h!i@s#$v%i^d&a*a"             # transport >= 3290
SUFFIX_LEGACY = "h*i&s%e!r^v0i1c9"             # transport < 3290
TIME_XOR = 0x5698_1477_2b03_a968
STATIC_USER = "hisenseservice"
STATIC_PASSWORD = "multimqttservice"

# Auth methods, newest first: the order the driver probes when it does not yet know the TV's.
MODERN, MIDDLE, LEGACY, STATIC = "modern", "middle", "legacy", "static"
ORDER = (MODERN, MIDDLE, LEGACY, STATIC)


def _md5_upper(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest().upper()


def new_uuid():
    """A stable, MAC shaped id for this bridge's VIDAA client. Kept per TV, never the TV's own MAC."""
    return "C8:F7:33:" + ":".join(f"{b:02X}" for b in os.urandom(3))


def client_id(uuid, brand="his", operation="vidaacommon"):
    """Hisense's client id shape: <uuid>$<brand>$<race>_<operation>_001."""
    race = _md5_upper(f"{PATTERN}${uuid}")[:6]
    return f"{uuid}${brand}${race}_{operation}_001"


def credentials(uuid, method=MODERN, brand="his", operation="vidaacommon", timestamp=None):
    """(client_id, username, password) for one connection. Call it fresh for every connect: the
    username and password carry the current time and the TV rejects a stale pair."""
    cid = client_id(uuid, brand, operation)
    if method == STATIC:
        flat = uuid.replace(":", "").replace("-", "").upper()
        return f"{flat}$vidaa_common", STATIC_USER, STATIC_PASSWORD
    ts = int(time.time()) if timestamp is None else int(timestamp)
    if method == LEGACY:
        user = f"{brand}${ts}"
        suffix = SUFFIX_LEGACY
    elif method == MIDDLE:
        user = f"{brand}${ts ^ TIME_XOR}"
        suffix = SUFFIX_LEGACY
    else:   # MODERN
        user = f"{brand}${ts ^ TIME_XOR}"
        suffix = SUFFIX_MODERN
    remainder = sum(int(d) for d in str(ts)) % 10
    value_md5 = _md5_upper(f"{brand}{remainder}{suffix}")[:6]
    password = _md5_upper(f"{ts}${value_md5}")
    return cid, user, password
