"""The connection to an Apple TV, for "kind": "appletv" in config.json.

Written from the public protocol descriptions (the HomeKit pairing steps and the published notes on
Apple's Companion Link protocol, the one the iPhone's Control Centre remote uses), and tested against a
stand-in Apple TV on the computer, NOT yet on a real Apple TV (docs/APPLE-TV.md). Nothing here is copied
from another project, and no key or credential of Apple's is included: the pairing makes a pair of keys
of our own, and the Apple TV is asked to trust them once, with the PIN it shows on screen.

The Companion link is TCP. Each frame is one byte of type, three bytes of length, then the payload.
After pairing, the payloads are ChaCha20-Poly1305 sealed and carry a small binary serialisation (OPACK).

What it can do (docs/APPLE-TV.md): remote keys, sleep and wake, which apps are installed, opening an app
by its bundle id. What it cannot: type text, screenshots, what is playing, a volume level, and put
anything in front of Apple's own home screen. tvOS lets nothing replace its home, so couch-tv on an
Apple TV is an app that opens itself (couch-tv's tvOS app in tvos/, found by its bundle id or named in
"app_id"), not a home screen.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import struct
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

import apps
import config
from tv import TVUnavailable

HOME_PACKAGE = "app.couchtv.launcher"
# couch-tv's own tvOS app (tvos/). A free Apple ID needs a bundle id nobody else has registered, so people
# add their own ending (dev.couchtv.appletv.<something>); any id starting with this one counts as couch-tv.
HOME_BUNDLE = "dev.couchtv.appletv"
PIN_RE_LEN = 4

# ---------- frames ----------
F_PS_START, F_PS_NEXT, F_PV_START, F_PV_NEXT = 3, 4, 5, 6
F_U_OPACK, F_E_OPACK = 7, 8
MAX_FRAME = 1 << 20


class AppleTVError(RuntimeError):
    """The Apple TV refused or answered something unexpected."""


class PairingError(AppleTVError):
    """Pairing failed: usually a wrong PIN."""


# ---------- OPACK ----------
def opack_encode(v):
    """Python value -> OPACK bytes. None, bool, non negative int, float, str, bytes, list and dict."""
    if v is None:
        return b"\x04"
    if v is True:
        return b"\x01"
    if v is False:
        return b"\x02"
    if isinstance(v, int):
        if v < 0:
            raise ValueError("OPACK here has no negative integers")
        if v < 40:
            return bytes([0x08 + v])
        for tag, size in ((0x30, 1), (0x31, 2), (0x32, 4), (0x33, 8)):
            if v < 1 << (8 * size):
                return bytes([tag]) + v.to_bytes(size, "little")
        raise ValueError("integer too large")
    if isinstance(v, float):
        return b"\x36" + struct.pack("<d", v)
    if isinstance(v, str):
        raw = v.encode()
        return _sized(raw, 0x40, 0x61, 0x20) + raw
    if isinstance(v, (bytes, bytearray)):
        raw = bytes(v)
        return _sized(raw, 0x70, 0x91, 0x20) + raw
    if isinstance(v, (list, tuple)):
        body = b"".join(opack_encode(x) for x in v)
        return (bytes([0xD0 + len(v)]) + body) if len(v) < 15 else b"\xdf" + body + b"\x03"
    if isinstance(v, dict):
        body = b"".join(opack_encode(k) + opack_encode(x) for k, x in v.items())
        return (bytes([0xE0 + len(v)]) + body) if len(v) < 15 else b"\xef" + body + b"\x03"
    raise TypeError(f"cannot OPACK a {type(v).__name__}")


def _sized(raw, short_base, long_base, short_max):
    n = len(raw)
    if n <= short_max:
        return bytes([short_base + n])
    for i, size in enumerate((1, 2, 3, 4)):
        if n < 1 << (8 * size):
            return bytes([long_base + i]) + n.to_bytes(size, "little")
    raise ValueError("too long")


def opack_decode(data):
    """OPACK bytes -> Python value. Understands what the encoder writes, plus floats, UUIDs, endless
    collections and back references, which an Apple TV may send."""
    objects = []

    def take(pos):
        tag = data[pos]
        pos += 1
        if tag == 0x01:
            return True, pos
        if tag == 0x02:
            return False, pos
        if tag in (0x03, 0x04):
            return None, pos
        if tag == 0x05:
            return bytes(data[pos:pos + 16]), pos + 16       # a UUID
        if 0x08 <= tag <= 0x2F:
            return tag - 8, pos
        if 0x30 <= tag <= 0x33:
            n = 1 << (tag - 0x30)
            val = int.from_bytes(data[pos:pos + n], "little")
            objects.append(val)
            return val, pos + n
        if tag == 0x35:
            val = struct.unpack("<f", data[pos:pos + 4])[0]
            objects.append(val)
            return val, pos + 4
        if tag == 0x36:
            val = struct.unpack("<d", data[pos:pos + 8])[0]
            objects.append(val)
            return val, pos + 8
        if 0x40 <= tag <= 0x60 or 0x61 <= tag <= 0x64:
            if tag <= 0x60:
                n = tag - 0x40
            else:
                size = tag - 0x60
                n, pos = int.from_bytes(data[pos:pos + size], "little"), pos + size
            if pos + n > len(data):
                raise IndexError
            val = bytes(data[pos:pos + n]).decode()
            objects.append(val)
            return val, pos + n
        if 0x70 <= tag <= 0x90 or 0x91 <= tag <= 0x94:
            if tag <= 0x90:
                n = tag - 0x70
            else:
                size = tag - 0x90
                n, pos = int.from_bytes(data[pos:pos + size], "little"), pos + size
            if pos + n > len(data):
                raise IndexError
            val = bytes(data[pos:pos + n])
            objects.append(val)
            return val, pos + n
        if 0xA0 <= tag <= 0xC0:
            return objects[tag - 0xA0], pos
        if 0xC1 <= tag <= 0xC4:
            n = tag - 0xC0
            return int.from_bytes(data[pos:pos + n], "little"), pos + n
        if 0xD0 <= tag <= 0xDF:
            items, count = [], tag - 0xD0
            while (count != 15 and len(items) < count) or (count == 15 and data[pos] != 0x03):
                val, pos = take(pos)
                items.append(val)
            return items, pos + (1 if count == 15 else 0)
        if 0xE0 <= tag <= 0xEF:
            out, count = {}, tag - 0xE0
            while (count != 15 and len(out) < count) or (count == 15 and data[pos] != 0x03):
                k, pos = take(pos)
                val, pos = take(pos)
                out[k if isinstance(k, (str, int, bytes)) else str(k)] = val
            return out, pos + (1 if count == 15 else 0)
        raise AppleTVError(f"OPACK tag 0x{tag:02x} not understood")

    try:
        val, end = take(0)
    except (IndexError, struct.error, UnicodeDecodeError):
        raise AppleTVError("the Apple TV sent a message that could not be read") from None
    return val


# ---------- TLV8 (HomeKit pairing's small container) ----------
T_METHOD, T_IDENTIFIER, T_SALT, T_PUBLIC_KEY, T_PROOF, T_ENCRYPTED, T_SEQ, T_ERROR, T_SIGNATURE = 0, 1, 2, 3, 4, 5, 6, 7, 10


def tlv_encode(items):
    """[(type, bytes)] -> bytes. A value over 255 bytes is split into runs."""
    out = b""
    for t, v in items:
        v = bytes(v)
        if not v:
            out += bytes([t, 0])
        for i in range(0, len(v), 255):
            chunk = v[i:i + 255]
            out += bytes([t, len(chunk)]) + chunk
    return out


def tlv_decode(data):
    out, i, last = {}, 0, None
    while i + 2 <= len(data):
        t, n = data[i], data[i + 1]
        chunk = data[i + 2:i + 2 + n]
        out[t] = out[t] + chunk if (t == last and t in out) else chunk
        last, i = t, i + 2 + n
    return out


# ---------- SRP-6a, 3072 bit, SHA-512 (the pairing PIN proof) ----------
# The 3072 bit safe prime of RFC 3526 (group 15, the same as RFC 5054's 3072 bit group), generator 5.
SRP_N = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
    "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7"
    "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C"
    "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF", 16)
SRP_G = 5
SRP_LEN = 384


def _h(*parts):
    return hashlib.sha512(b"".join(parts)).digest()


def _i2b(n, pad=False):
    raw = n.to_bytes((n.bit_length() + 7) // 8 or 1, "big")
    return raw.rjust(SRP_LEN, b"\0") if pad else raw


def _b2i(b):
    return int.from_bytes(b, "big")


def srp_k():
    return _b2i(_h(_i2b(SRP_N), _i2b(SRP_G, True)))


def srp_x(salt, user, password):
    return _b2i(_h(salt, _h(user + b":" + password)))


def srp_u(a_pub, b_pub):
    return _b2i(_h(_i2b(a_pub, True), _i2b(b_pub, True)))


def srp_m1(user, salt, a_pub, b_pub, key):
    hn_xor_hg = bytes(x ^ y for x, y in zip(_h(_i2b(SRP_N)), _h(_i2b(SRP_G))))
    return _h(hn_xor_hg, _h(user), salt, _i2b(a_pub), _i2b(b_pub), key)


def srp_m2(a_pub, m1, key):
    return _h(_i2b(a_pub), m1, key)


class SRPClient:
    """The controller (couch-tv) side of the pairing PIN proof."""

    def __init__(self, user=b"Pair-Setup", password=b""):
        self.user, self.password = user, password
        self.a = _b2i(secrets.token_bytes(64)) % SRP_N or 1
        self.a_pub = pow(SRP_G, self.a, SRP_N)

    def process(self, salt, b_pub_bytes):
        b_pub = _b2i(b_pub_bytes)
        if b_pub % SRP_N == 0:
            raise PairingError("the Apple TV sent an invalid key")
        x = srp_x(salt, self.user, self.password)
        u = srp_u(self.a_pub, b_pub)
        s = pow((b_pub - srp_k() * pow(SRP_G, x, SRP_N)) % SRP_N, self.a + u * x, SRP_N)
        self.key = _h(_i2b(s))
        self.m1 = srp_m1(self.user, salt, self.a_pub, b_pub, self.key)
        return self.m1

    def verify_server(self, m2):
        return hmac.compare_digest(m2, srp_m2(self.a_pub, self.m1, self.key))


# ---------- the HomeKit style key steps ----------
def hkdf(secret, salt, info, n=32):
    return HKDF(algorithm=hashes.SHA512(), length=n, salt=salt, info=info).derive(secret)


def _nonce(label):
    return b"\0" * 4 + label if len(label) == 8 else label.rjust(12, b"\0")


def seal(key, label, data):
    return ChaCha20Poly1305(key).encrypt(_nonce(label), data, b"")


def unseal(key, label, data):
    try:
        return ChaCha20Poly1305(key).decrypt(_nonce(label), data, b"")
    except Exception:
        raise AppleTVError("the Apple TV's reply did not check out") from None


def raw_public(key):
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def raw_private(key):
    return key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())


# ---------- remote keys (the Companion link's button codes) ----------
HID = {"up": 1, "down": 2, "left": 3, "right": 4, "menu": 5, "select": 6, "home": 7,
       "volume_up": 8, "volume_down": 9, "siri": 10, "screensaver": 11, "sleep": 12, "wake": 13,
       "play_pause": 14, "channel_up": 15, "channel_down": 16, "guide": 17, "page_up": 18, "page_down": 19}
KEYS = {
    "up": "up", "down": "down", "left": "left", "right": "right",
    "ok": "select", "select": "select", "enter": "select",
    "back": "menu", "menu": "menu", "apple_home": "home", "tv_home": "home",
    "play_pause": "play_pause", "play": "play_pause", "pause": "play_pause",
    "volume_up": "volume_up", "volume_down": "volume_down",
    "channel_up": "channel_up", "channel_down": "channel_down", "guide": "guide", "info": "guide",
    "search": "siri", "page_up": "page_up", "page_down": "page_down",
    "sleep": "sleep", "wake": "wake",
}

# Apple TV attention states from the Companion link
ASLEEP, SCREENSAVER, AWAKE = 1, 2, 3

# Bundle ids of well known tvOS apps. Others are found by their display name in the Apple TV's own list.
BUNDLE_IDS = {
    "netflix": "com.netflix.Netflix", "youtube": "com.google.ios.youtube", "disney-plus": "com.disney.disneyplus",
    "prime-video": "com.amazon.aiv.AIVApp", "apple-tv": "com.apple.TVWatchList",
    "apple-music": "com.apple.TVMusic", "plex": "com.plexapp.plex", "spotify": "com.spotify.client",
}


BUNDLE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.\-_]{2,149}")
URL_RE = re.compile(r"(?:https://|[a-z][a-z0-9+.-]{1,30}://)[^\s\"'<>]{1,1500}")

# Kids mode (bridge/kids.py): apps a kids profile is never handed on an Apple TV, whatever the list says
NOT_FOR_KIDS = {"com.apple.TVSettings", "com.apple.TVAppStore"}

# Show links an Apple TV app is reported to open straight into a title, when the Apple TV is asked over the
# Companion link (the "_urlS" form of _launchApp). From pyatv's and Home Assistant's public notes on deep
# links, NOT yet tried on a real Apple TV here (docs/APPLE-TV.md, "Kids mode"). Each rule turns a JustWatch
# link (web or Android) into the form those notes give; the last value says whether an episode's own link
# is kept (a Netflix /title/ link takes a show's id, never an episode's). Any other app opens on its home.
SHOW_LINKS = {
    "netflix": (re.compile(r"netflix\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?(?:title|watch)/(\d{4,12})"),
                "https://www.netflix.com/title/{}", False),
    "disney-plus": (re.compile(r"disneyplus\.com/(?:[a-z]{2}-[a-z]{2}/)?((?:series|movies|video|play|browse)/[^\s?#\"'<>]{1,200})"),
                    "https://www.disneyplus.com/{}", True),
    "apple-tv": (re.compile(r"tv\.apple\.com/(?:[a-z]{2}/)?((?:show|movie|episode)/[^\s?#\"'<>]{1,200})"),
                 "https://tv.apple.com/{}", True),
    "youtube": (re.compile(r"youtube\.com/watch\?v=([\w-]{6,20})"), "youtube://watch/{}", False),
}


def show_link(app_id, *links, episode=False):
    """The link to hand an Apple TV for a show in this app, from JustWatch's links, or None. With
    episode=True the links are one episode's, and only apps whose links can name an episode use them."""
    rule = SHOW_LINKS.get(app_id)
    if not rule or (episode and not rule[2]):
        return None
    for link in links:
        m = rule[0].search(link) if isinstance(link, str) else None
        if m:
            return rule[1].format(m.group(1))
    return None


def _plain(name):
    return "".join(c for c in (name or "").lower() if c.isalnum())


class Link:
    """One Companion connection: framing, pairing, the sealed session, request and reply."""

    def __init__(self, host, port, timeout=6):
        self.host, self.port, self.timeout = host, port, timeout
        self.r = self.w = None
        self.out_key = self.in_key = None
        self.out_n = self.in_n = 0
        self.xid = secrets.randbelow(0xFFFF)

    async def open(self):
        try:
            self.r, self.w = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), self.timeout)
        except (OSError, asyncio.TimeoutError) as e:
            raise TVUnavailable(f"the Apple TV did not answer ({type(e).__name__})") from None

    async def close(self):
        if self.w:
            self.w.close()
            try:
                await self.w.wait_closed()
            except Exception:
                pass
        self.r = self.w = None
        self.out_key = self.in_key = None

    async def send(self, ftype, payload):
        if self.out_key:
            header = bytes([ftype]) + (len(payload) + 16).to_bytes(3, "big")
            nonce = self.out_n.to_bytes(12, "little")
            self.out_n += 1
            payload = ChaCha20Poly1305(self.out_key).encrypt(nonce, payload, header)
        self.w.write(bytes([ftype]) + len(payload).to_bytes(3, "big") + payload)
        await self.w.drain()

    async def recv(self):
        try:
            header = await asyncio.wait_for(self.r.readexactly(4), self.timeout)
            n = int.from_bytes(header[1:], "big")
            if n > MAX_FRAME:
                raise AppleTVError("a frame that is too big")
            payload = await asyncio.wait_for(self.r.readexactly(n), self.timeout)
        except (asyncio.IncompleteReadError, OSError, asyncio.TimeoutError) as e:
            raise TVUnavailable(f"the Apple TV stopped answering ({type(e).__name__})") from None
        if self.in_key:
            nonce = self.in_n.to_bytes(12, "little")
            self.in_n += 1
            try:
                payload = ChaCha20Poly1305(self.in_key).decrypt(nonce, payload, header)
            except Exception:
                raise AppleTVError("a sealed message from the Apple TV did not check out") from None
        return header[0], payload

    async def step(self, ftype, fields):
        """Send an OPACK dict, read one OPACK dict back (the pairing steps)."""
        await self.send(ftype, opack_encode(fields))
        _, payload = await self.recv()
        return opack_decode(payload)

    # ----- pairing: once, with the PIN on screen -----
    async def pair_setup_start(self):
        m2 = await self.step(F_PS_START, {"_pd": tlv_encode([(T_METHOD, b"\0"), (T_SEQ, b"\1")]), "_pwTy": 1})
        return self._tlv(m2, 2)

    def _tlv(self, msg, seq):
        t = tlv_decode(msg.get("_pd", b"")) if isinstance(msg, dict) else {}
        if T_ERROR in t:
            raise PairingError(f"the Apple TV refused (error {t[T_ERROR][0]}). Start again and use the PIN it shows now.")
        if t.get(T_SEQ) != bytes([seq]):
            raise AppleTVError("the Apple TV answered the wrong pairing step")
        return t

    async def pair_setup_finish(self, t2, pin):
        srp = SRPClient(password=str(pin).encode())
        m1 = srp.process(t2[T_SALT], t2[T_PUBLIC_KEY])
        m4 = await self.step(F_PS_NEXT, {"_pd": tlv_encode([(T_SEQ, b"\3"), (T_PUBLIC_KEY, _i2b(srp.a_pub)),
                                                           (T_PROOF, m1)]), "_pwTy": 1})
        try:
            t4 = self._tlv(m4, 4)
        except PairingError:
            raise PairingError("the PIN was not accepted") from None
        if not srp.verify_server(t4[T_PROOF]):
            raise PairingError("the Apple TV's proof did not match")
        ltsk = Ed25519PrivateKey.generate()
        ltpk = raw_public(ltsk)
        client_id = secrets.token_hex(8).upper().encode()
        x = hkdf(srp.key, b"Pair-Setup-Controller-Sign-Salt", b"Pair-Setup-Controller-Sign-Info")
        sub = tlv_encode([(T_IDENTIFIER, client_id), (T_PUBLIC_KEY, ltpk),
                          (T_SIGNATURE, ltsk.sign(x + client_id + ltpk))])
        enc_key = hkdf(srp.key, b"Pair-Setup-Encrypt-Salt", b"Pair-Setup-Encrypt-Info")
        m6 = await self.step(F_PS_NEXT, {"_pd": tlv_encode([(T_SEQ, b"\5"), (T_ENCRYPTED, seal(enc_key, b"PS-Msg05", sub))]),
                                         "_pwTy": 1})
        t6 = self._tlv(m6, 6)
        acc = tlv_decode(unseal(enc_key, b"PS-Msg06", t6[T_ENCRYPTED]))
        ax = hkdf(srp.key, b"Pair-Setup-Accessory-Sign-Salt", b"Pair-Setup-Accessory-Sign-Info")
        try:
            Ed25519PublicKey.from_public_bytes(acc[T_PUBLIC_KEY]).verify(acc[T_SIGNATURE], ax + acc[T_IDENTIFIER] + acc[T_PUBLIC_KEY])
        except (InvalidSignature, KeyError):
            raise PairingError("the Apple TV's signature did not check out") from None
        return {"client_id": client_id.decode(), "ltsk": raw_private(ltsk).hex(),
                "atv_id": acc[T_IDENTIFIER].decode(errors="replace"), "atv_ltpk": acc[T_PUBLIC_KEY].hex()}

    # ----- pair verify: every connection, with what pairing kept -----
    async def verify(self, cred):
        eph = X25519PrivateKey.generate()
        pub = raw_public(eph)
        m2 = await self.step(F_PV_START, {"_pd": tlv_encode([(T_SEQ, b"\1"), (T_PUBLIC_KEY, pub)]), "_auTy": 4})
        t2 = self._tlv(m2, 2)
        server_pub = t2[T_PUBLIC_KEY]
        shared = eph.exchange(X25519PublicKey.from_public_bytes(server_pub))
        key = hkdf(shared, b"Pair-Verify-Encrypt-Salt", b"Pair-Verify-Encrypt-Info")
        inner = tlv_decode(unseal(key, b"PV-Msg02", t2[T_ENCRYPTED]))
        try:
            Ed25519PublicKey.from_public_bytes(bytes.fromhex(cred["atv_ltpk"])).verify(
                inner[T_SIGNATURE], server_pub + inner[T_IDENTIFIER] + pub)
        except (InvalidSignature, KeyError):
            raise PairingError("this is not the Apple TV that was paired (or it was reset): pair again") from None
        client_id = cred["client_id"].encode()
        ltsk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(cred["ltsk"]))
        sub = tlv_encode([(T_IDENTIFIER, client_id), (T_SIGNATURE, ltsk.sign(pub + client_id + server_pub))])
        m4 = await self.step(F_PV_NEXT, {"_pd": tlv_encode([(T_SEQ, b"\3"), (T_ENCRYPTED, seal(key, b"PV-Msg03", sub))])})
        try:
            self._tlv(m4, 4)
        except PairingError:
            raise PairingError("the Apple TV does not know this pairing any more: pair again") from None
        self.out_key = hkdf(shared, b"", b"ClientEncrypt-main")
        self.in_key = hkdf(shared, b"", b"ServerEncrypt-main")
        self.out_n = self.in_n = 0

    # ----- requests -----
    async def ask(self, name, content=None, kind=2, wait=True):
        self.xid = (self.xid + 1) & 0xFFFF
        await self.send(F_E_OPACK, opack_encode({"_i": name, "_x": self.xid, "_t": kind, "_c": content if content is not None else {}}))
        if not wait:
            return None
        for _ in range(20):     # events may arrive between: skip them
            _, payload = await self.recv()
            msg = opack_decode(payload)
            if isinstance(msg, dict) and msg.get("_x") == self.xid and msg.get("_t") in (3, 4):
                if msg.get("_t") == 4 or "_em" in msg:
                    raise AppleTVError(str(msg.get("_em") or "the Apple TV refused"))
                return msg.get("_c") or {}
        raise AppleTVError("no answer to " + name)

    async def start_session(self):
        await self.ask("_systemInfo", {"_bf": 0, "_cf": 512, "_clFl": 128, "_i": "couch-tv", "_idsID": secrets.token_hex(8),
                                       "_pubID": "couch-tv", "_sf": 256, "_sv": "170.18", "model": "iPhone10,6",
                                       "name": "couch-tv"})
        sid = secrets.randbits(32)
        reply = await self.ask("_sessionStart", {"_srvT": "com.apple.tvremoteservices", "_sid": sid})
        self.sid = (int(reply.get("_sid") or 0) << 32) | sid
        try:
            await self.ask("TVRCSessionStart", {"ProtocolVersionKey": "1.2"})   # older tvOS answers an error: fine
        except AppleTVError:
            pass


class AppleTV:
    kind = "appletv"
    can_read_media = False
    native_media = True
    INPUT = None

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"appletv.{self.id}")
        self.ip = cfg.get("ip")
        self.fallback_ip = self.ip
        self.mac = cfg.get("mac")
        self.port = int(cfg.get("port") or 49153)   # the Companion port is advertised on the network and can change
        self.app_id = (cfg.get("app_id") or "").strip()    # bundle id of couch-tv's tvOS app; found by itself when left out
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.store_file = os.path.join(config.DATA, f"appletv-{self.id}.json")
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False
        self.attention = None       # ASLEEP, SCREENSAVER, AWAKE, None unknown
        self.channels = []          # [{"id": bundle id, "title": name, "package": ...}]
        self.ids = {}
        self._listeners = set()
        self._link = None
        self._lock = asyncio.Lock()
        self._tasks = []
        self._pairing = None
        self._apps_checked = 0.0
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []

    # ---------- shape shared with tv.TV ----------
    @property
    def paired(self):
        return bool(self._cred())

    @property
    def is_on(self):
        if not self.connected or self.attention is None:
            return None
        return self.attention == AWAKE

    @property
    def current_package(self):
        return None

    @property
    def volume(self):
        return {"level": None, "max": None, "muted": None, "known": False}

    @property
    def visible(self):
        return None

    def on_change(self, fn):
        self._listeners.add(fn)

    def _changed(self):
        for fn in list(self._listeners):
            try:
                fn()
            except Exception:
                self.log.exception("listener failed")

    def require(self):
        if not self.connected:
            raise TVUnavailable(f"the {self.name.lower()} Apple TV is not answering on the network")

    def can_deeplink(self, app):
        return False

    def status(self):
        """For /api/tvs, in plain words."""
        return {"paired": self.paired, "port": self.port, "app_id": self.home_bundle(),
                "note": None if self.paired else "Not paired yet: POST /api/appletv/pair, or run scripts/appletv-check.py --pair"}

    # ---------- the pairing, kept in bridge/data (git ignores it), never printed or logged ----------
    def _cred(self):
        try:
            with open(self.store_file) as f:
                c = json.load(f)
            return c if all(k in c for k in ("client_id", "ltsk", "atv_id", "atv_ltpk")) else None
        except (OSError, ValueError):
            return None

    def _keep(self, cred):
        os.makedirs(config.DATA, exist_ok=True)
        fd = os.open(self.store_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(cred, f)

    async def pair_start(self):
        """Ask the Apple TV to show its PIN (on the TV, in Settings, Remotes and Devices, it must be
        awake). The PIN is then sent to pair_finish."""
        link = Link(self.ip, self.port)
        await link.open()
        try:
            t2 = await link.pair_setup_start()
        except Exception:
            await link.close()
            raise
        if self._pairing:
            await self._pairing[0].close()
        self._pairing = (link, t2)

    async def pair_finish(self, pin):
        if not self._pairing:
            raise PairingError("ask for the PIN first")
        link, t2 = self._pairing
        self._pairing = None
        try:
            cred = await link.pair_setup_finish(t2, pin)
        finally:
            await link.close()
        self._keep(cred)
        return True

    # ---------- the session ----------
    async def _session(self):
        """A verified, sealed connection, opened when needed and kept."""
        if self._link and self._link.w and not self._link.w.is_closing():
            return self._link
        cred = self._cred()
        if not cred:
            raise TVUnavailable("this Apple TV is not paired with couch-tv yet (docs/APPLE-TV.md)")
        link = Link(self.ip, self.port)
        await link.open()
        try:
            await link.verify(cred)
            await link.start_session()
        except Exception:
            await link.close()
            raise
        self._link = link
        return link

    async def _drop(self):
        if self._link:
            await self._link.close()
        self._link = None

    async def _ask(self, name, content=None, kind=2, wait=True):
        async with self._lock:
            try:
                return await (await self._session()).ask(name, content, kind, wait)
            except (TVUnavailable, AppleTVError):
                await self._drop()
                raise
            except OSError as e:
                await self._drop()
                raise TVUnavailable(f"the Apple TV did not answer ({type(e).__name__})") from None

    async def _read_attention(self):
        c = await self._ask("FetchAttentionState")
        self.attention = c.get("state") if isinstance(c.get("state"), int) else None
        return self.attention

    # ---------- apps ----------
    async def refresh_installed(self, force=False):
        if not force and time.time() - self._apps_checked < 1800 and self.channels:
            return self.ids
        try:
            c = await self._ask("FetchLaunchableApplicationsEvent")
        except (TVUnavailable, AppleTVError) as e:
            self.log.info("app list: %s", e)
            return self.ids
        by_name = {}
        for a in apps.APPS:
            by_name.setdefault(_plain(a["name"]), a["package"])
        points, found = [], {}
        for bundle, title in (c or {}).items():
            if not isinstance(bundle, str) or not isinstance(title, str):
                continue
            known = by_name.get(_plain(title))
            for aid, b in BUNDLE_IDS.items():
                if b == bundle and apps.BY_ID.get(aid):
                    known = apps.BY_ID[aid]["package"]
            if known:
                found[bundle] = known
            points.append({"id": bundle, "title": title, "package": known or f"appletv.{bundle}"})
        if points:
            self.channels, self.ids, self._apps_checked = points, found, time.time()
        return self.ids

    def home_bundle(self):
        """The bundle id of couch-tv's own app on this Apple TV: app_id from config.json, else an installed app
        whose id is dev.couchtv.appletv or starts with it (tvos/, docs/APPLE-TV.md). None when there is none."""
        if self.app_id:
            return self.app_id
        for c in self.channels:
            if c["id"] == HOME_BUNDLE or c["id"].startswith(HOME_BUNDLE + "."):
                return c["id"]
        return None

    async def apps_on_tv(self):
        await self.refresh_installed()
        mine = self.home_bundle()
        return [c for c in self.channels if c["id"] != mine]

    def _candidates(self, package):
        mine = self.home_bundle()
        if package in (HOME_PACKAGE, mine) or (package and package == self.app_id):
            return [mine] if mine else []
        if package and package.startswith("appletv."):
            return [package[len("appletv."):]]
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        if not app:
            return []
        mine = [b for b, p in self.ids.items() if p == app["package"]]
        known = BUNDLE_IDS.get(app["id"])
        return mine + ([known] if known and known not in mine else [])

    async def _launch(self, bundle, quiet=True):
        if quiet:
            self.quiet_until = time.monotonic() + 20
        if not isinstance(bundle, str) or not BUNDLE_RE.fullmatch(bundle):
            raise ValueError(f"not a bundle id: {bundle}")
        await self._ask("_launchApp", {"_bundleID": bundle})

    async def open_bundle(self, bundle):
        """Open an app by its bundle id, for couch-tv's own Apple TV app (it cannot open other apps itself).
        When the Apple TV's app list is known, only an app on it."""
        if not isinstance(bundle, str) or not BUNDLE_RE.fullmatch(bundle):
            raise ValueError(f"not a bundle id: {bundle}")
        self.require()
        await self.refresh_installed()
        if self.channels and bundle not in {c["id"] for c in self.channels}:
            raise TVUnavailable(f"{bundle} is not installed on the Apple TV")
        await self._launch(bundle)

    async def open_url(self, url):
        """Ask the Apple TV to open a link (a show's page in its app), the way the iPhone's remote can.
        Which app takes which link is the app's own business: an app that takes none is refused here."""
        if not isinstance(url, str) or not URL_RE.fullmatch(url):
            raise ValueError("not a link the Apple TV can open")
        self.require()
        self.quiet_until = time.monotonic() + 20
        await self._ask("_launchApp", {"_urlS": url})

    def bundle_for(self, package):
        """The bundle id on this Apple TV for an app named in kids mode (an app id, an Android package name,
        appletv.<bundle> from the phone's app list, or a bundle id). None when the Apple TV does not have it.
        Before the app list is known, the well known bundle id. Call refresh_installed() first."""
        if not isinstance(package, str) or not package:
            return None
        listed = {c["id"] for c in self.channels}
        if package in listed:
            return package
        for b in self._candidates(package):
            if b in listed or (not self.channels and BUNDLE_RE.fullmatch(b)):
                return b
        return None

    async def launch_package(self, package):
        self.require()
        await self.refresh_installed()
        ids = self._candidates(package)
        if not ids:
            raise ValueError(f"no Apple TV bundle id known for {package}")
        listed = {c["id"] for c in self.channels}
        usable = [i for i in ids if i in listed or i == self.home_bundle()] if self.channels else ids
        if not usable:
            raise TVUnavailable(f"{package} is not installed on the Apple TV")
        last = None
        for b in usable:
            try:
                await self._launch(b)
                return "remote"
            except AppleTVError as e:
                last = e
        raise TVUnavailable(f"the Apple TV would not open {package}: {last}")

    async def start_intent(self, uri, package=None, cold=False, media_type=None):
        """Open the app a show is in. No deep link: it opens on its own home and the reply says to pick
        the show there (docs/APPLE-TV.md)."""
        self.require()
        if not package:
            raise ValueError("the Apple TV opens the app, not the show: name an app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        return None

    async def wait_for_app(self, packages, timeout=8.0):
        return None

    async def installed_packages(self):
        if not self.connected:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- the remote ----------
    async def key(self, name, hold=False):
        raw = (name or "").strip().lower() if isinstance(name, str) else ""
        self.quiet_until = 0.0 if raw in ("sleep", "power") else time.monotonic() + 20
        if raw == "home":
            await self.refresh_installed()
            mine = self.home_bundle()
            if not mine:
                raise ValueError("couch-tv's app is not on this Apple TV (tvos/, docs/APPLE-TV.md): use apple_home for Apple's own home")
            await self._launch(mine)
            return "couch-tv"
        if raw == "power":
            self.require()
            if self.is_on:
                await self._press("sleep")
            else:
                self.home_on_wake_until = time.monotonic() + 90
                await self._press("wake")
            return "power"
        code = KEYS.get(raw) or (raw if raw in HID else None)
        if not code:
            raise ValueError(f"unknown key: {name}")
        self.require()
        if code == "wake":
            self.home_on_wake_until = time.monotonic() + 90
        await self._press(code, hold)
        return code

    async def _press(self, code, hold=False):
        c = HID[code]
        await self._ask("_hidC", {"_hBtS": 1, "_hidC": c}, wait=False)
        await asyncio.sleep(1.0 if hold else 0.05)
        await self._ask("_hidC", {"_hBtS": 2, "_hidC": c}, wait=False)

    async def text(self, text):
        raise TVUnavailable("typing into an Apple TV is not supported yet: use the on screen keyboard with the arrows")

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _watch(self):
        was_on, ticks = None, 0
        while True:
            try:
                before = (self.connected, self.attention)
                try:
                    if not self.paired:
                        self.connected = await self.port_open()
                    else:
                        await self._read_attention()
                        self.connected = True
                        if self.is_on:
                            await self.refresh_installed()
                except (TVUnavailable, AppleTVError, ValueError) as e:
                    self.connected = False if isinstance(e, TVUnavailable) else self.connected
                    if ticks % 30 == 0:
                        self.log.info("watch: %s", e)
                if not self.connected:
                    self.attention = None
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                if on is not None:
                    was_on = on
                elif not self.connected:
                    was_on = False
                if (self.connected, self.attention) != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            ticks += 1
            await asyncio.sleep(3)

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The Apple TV just woke. Open couch-tv's app, if it is installed. The Companion link cannot say
        which app is in front, so this opens it every time the Apple TV wakes (unless a command just ran)."""
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0
        elif time.monotonic() < self.quiet_until:
            self._note("Apple TV woke, left alone (a command is running)")
            return
        if self.open_on_power_on and not self.app_id:
            await self.refresh_installed()
        mine = self.home_bundle()
        if not self.open_on_power_on or not mine:
            self._note("Apple TV woke, no couch-tv app installed or set (app_id), left alone"
                       if self.open_on_power_on else "Apple TV woke, open_on_power_on is off, left alone")
            return
        await asyncio.sleep(1.5)
        try:
            await self._launch(mine, quiet=False)
            self._note("Apple TV woke, opened couch-tv")
        except Exception as e:
            self._note(f"Apple TV woke, could not open couch-tv: {e}")

    # ---------- what an Apple TV does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is an Apple TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("an Apple TV does not give screenshots over the network")

    async def port_open(self, port=None, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip, port or self.port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def reconnect_now(self):
        await self._drop()
        self.connected = await self.port_open()
        if self.connected and self.paired:
            try:
                await self._read_attention()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wakes the Apple TV with the remote's wake key (it keeps listening while it sleeps)."""
        self.home_on_wake_until = time.monotonic() + 90
        try:
            await self._press("wake")
        except Exception as e:
            self.log.info("wake: %s", e)
