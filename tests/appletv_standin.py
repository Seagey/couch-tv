"""A stand-in Apple TV for the tests: a small TCP server that speaks the Companion link the way the public
protocol notes describe it (pairing with a PIN, pair verify, sealed OPACK messages) and keeps a log of
every command it was sent.

    async with StandIn() as atv:
        tv = atv.tv(tmp_dir)          # a bridge/appletv.py AppleTV pointed at it
        await tv.pair_start(); await tv.pair_finish(atv.pin)

It is written from the same notes as the driver, so it proves the driver is consistent with them and
survives the failure paths. It is NOT an Apple TV, and a real one may differ (docs/APPLE-TV.md).
"""
import asyncio
from pathlib import Path
import secrets
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import appletv as A  # noqa: E402
import config  # noqa: E402

APPS = {"com.netflix.Netflix": "Netflix", "com.google.ios.youtube": "YouTube", "com.apple.TVWatchList": "TV",
        "au.example.stan": "Stan", "app.couchtv.tvos": "Couch TV", "com.example.other": "Some Other App"}


class StandIn:
    def __init__(self):
        self.pin = "1234"
        self.attention = A.AWAKE
        self.log = []               # ("hid", code, down/up), ("launch", bundle), ("url", link), ("ask", name)
        self.paired = {}            # client id -> public key (bytes)
        self.fail_launch = set()
        self.fail_url = set()       # links containing any of these are refused
        self.drop_next = False      # close the next connection after pair verify
        self.ltsk = Ed25519PrivateKey.generate()
        self.atv_id = b"standin-apple-tv"
        self._server = None
        self.port = None
        self.connections = 0
        self.apps = dict(APPS)      # what the Apple TV lists; a test can add couch-tv's own app

    async def __aenter__(self):
        self._server = await asyncio.start_server(self._conn, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        self._server.close()
        await self._server.wait_closed()

    def tv(self, data_dir, **cfg):
        config.DATA = str(data_dir)
        t = A.AppleTV({"id": "lounge", "name": "Lounge", "kind": "appletv", "ip": "127.0.0.1", "port": self.port, **cfg})
        t.store_file = str(Path(data_dir) / "appletv-lounge.json")
        t.connected = True
        return t

    # ----- the server side -----
    async def _read(self, r, key, n):
        h = await r.readexactly(4)
        body = await r.readexactly(int.from_bytes(h[1:], "big"))
        if key:
            body = ChaCha20Poly1305(key).decrypt(n.to_bytes(12, "little"), body, h)
        return h[0], body

    @staticmethod
    def _write(w, ftype, payload, key=None, n=0):
        if key:
            header = bytes([ftype]) + (len(payload) + 16).to_bytes(3, "big")
            payload = ChaCha20Poly1305(key).encrypt(n.to_bytes(12, "little"), payload, header)
        w.write(bytes([ftype]) + len(payload).to_bytes(3, "big") + payload)

    async def _conn(self, r, w):
        self.connections += 1
        try:
            await self._serve(r, w)
        except (asyncio.IncompleteReadError, ConnectionError, Exception):
            pass
        finally:
            w.close()

    async def _serve(self, r, w):
        in_key = out_key = None
        in_n = out_n = 0
        srp = None
        verify = None
        while True:
            ftype, body = await self._read(r, in_key, in_n)
            if in_key:
                in_n += 1
            msg = A.opack_decode(body)
            if ftype == A.F_PS_START:
                srp = self._srp_start()
                self._write(w, A.F_PS_START, A.opack_encode({"_pd": A.tlv_encode([
                    (A.T_SEQ, b"\2"), (A.T_PUBLIC_KEY, A._i2b(srp["B"])), (A.T_SALT, srp["salt"])])}))
            elif ftype == A.F_PS_NEXT:
                t = A.tlv_decode(msg["_pd"])
                if t[A.T_SEQ] == b"\3":
                    reply = self._srp_m3(srp, t)
                else:
                    reply = self._srp_m5(srp, t)
                self._write(w, A.F_PS_NEXT, A.opack_encode({"_pd": reply}))
            elif ftype == A.F_PV_START:
                t = A.tlv_decode(msg["_pd"])
                eph = X25519PrivateKey.generate()
                pub = A.raw_public(eph)
                shared = eph.exchange(X25519PublicKey.from_public_bytes(t[A.T_PUBLIC_KEY]))
                key = A.hkdf(shared, b"Pair-Verify-Encrypt-Salt", b"Pair-Verify-Encrypt-Info")
                sig = self.ltsk.sign(pub + self.atv_id + t[A.T_PUBLIC_KEY])
                sub = A.tlv_encode([(A.T_IDENTIFIER, self.atv_id), (A.T_SIGNATURE, sig)])
                verify = (shared, key, t[A.T_PUBLIC_KEY], pub)
                self._write(w, A.F_PV_START, A.opack_encode({"_pd": A.tlv_encode([
                    (A.T_SEQ, b"\2"), (A.T_PUBLIC_KEY, pub), (A.T_ENCRYPTED, A.seal(key, b"PV-Msg02", sub))])}))
            elif ftype == A.F_PV_NEXT:
                shared, key, cpub, spub = verify
                t = A.tlv_decode(msg["_pd"])
                inner = A.tlv_decode(A.unseal(key, b"PV-Msg03", t[A.T_ENCRYPTED]))
                ltpk = self.paired.get(inner[A.T_IDENTIFIER].decode())
                ok = False
                if ltpk:
                    try:
                        Ed25519PublicKey.from_public_bytes(ltpk).verify(inner[A.T_SIGNATURE], cpub + inner[A.T_IDENTIFIER] + spub)
                        ok = True
                    except Exception:
                        pass
                if not ok:
                    self._write(w, A.F_PV_NEXT, A.opack_encode({"_pd": A.tlv_encode([(A.T_SEQ, b"\4"), (A.T_ERROR, b"\2")])}))
                    continue
                self._write(w, A.F_PV_NEXT, A.opack_encode({"_pd": A.tlv_encode([(A.T_SEQ, b"\4")])}))
                in_key, out_key = A.hkdf(shared, b"", b"ClientEncrypt-main"), A.hkdf(shared, b"", b"ServerEncrypt-main")
                in_n = out_n = 0
                if self.drop_next:
                    self.drop_next = False
                    return
            elif ftype == A.F_E_OPACK and in_key:
                for reply in self._handle(msg):
                    self._write(w, A.F_E_OPACK, A.opack_encode(reply), out_key, out_n)
                    out_n += 1
            await w.drain()

    # ----- SRP, the accessory side -----
    def _srp_start(self):
        salt = secrets.token_bytes(16)
        v = pow(A.SRP_G, A.srp_x(salt, b"Pair-Setup", self.pin.encode()), A.SRP_N)
        b = A._b2i(secrets.token_bytes(64)) % A.SRP_N
        return {"salt": salt, "v": v, "b": b, "B": (A.srp_k() * v + pow(A.SRP_G, b, A.SRP_N)) % A.SRP_N}

    def _srp_m3(self, s, t):
        a_pub = A._b2i(t[A.T_PUBLIC_KEY])
        u = A.srp_u(a_pub, s["B"])
        S = pow(a_pub * pow(s["v"], u, A.SRP_N), s["b"], A.SRP_N)
        s["key"] = A._h(A._i2b(S))
        m1 = A.srp_m1(b"Pair-Setup", s["salt"], a_pub, s["B"], s["key"])
        if m1 != t[A.T_PROOF]:
            return A.tlv_encode([(A.T_SEQ, b"\4"), (A.T_ERROR, b"\2")])    # wrong PIN
        return A.tlv_encode([(A.T_SEQ, b"\4"), (A.T_PROOF, A.srp_m2(a_pub, m1, s["key"]))])

    def _srp_m5(self, s, t):
        enc = A.hkdf(s["key"], b"Pair-Setup-Encrypt-Salt", b"Pair-Setup-Encrypt-Info")
        inner = A.tlv_decode(A.unseal(enc, b"PS-Msg05", t[A.T_ENCRYPTED]))
        x = A.hkdf(s["key"], b"Pair-Setup-Controller-Sign-Salt", b"Pair-Setup-Controller-Sign-Info")
        Ed25519PublicKey.from_public_bytes(inner[A.T_PUBLIC_KEY]).verify(
            inner[A.T_SIGNATURE], x + inner[A.T_IDENTIFIER] + inner[A.T_PUBLIC_KEY])
        self.paired[inner[A.T_IDENTIFIER].decode()] = inner[A.T_PUBLIC_KEY]
        ltpk = A.raw_public(self.ltsk)
        ax = A.hkdf(s["key"], b"Pair-Setup-Accessory-Sign-Salt", b"Pair-Setup-Accessory-Sign-Info")
        sub = A.tlv_encode([(A.T_IDENTIFIER, self.atv_id), (A.T_PUBLIC_KEY, ltpk),
                            (A.T_SIGNATURE, self.ltsk.sign(ax + self.atv_id + ltpk))])
        return A.tlv_encode([(A.T_SEQ, b"\6"), (A.T_ENCRYPTED, A.seal(enc, b"PS-Msg06", sub))])

    # ----- the sealed requests -----
    def _handle(self, msg):
        name, c, xid = msg.get("_i"), msg.get("_c") or {}, msg.get("_x")
        self.log.append(("ask", name))
        if name == "_hidC":
            self.log.append(("hid", c["_hidC"], "down" if c["_hBtS"] == 1 else "up"))
            if c["_hBtS"] == 2 and c["_hidC"] == A.HID["sleep"]:
                self.attention = A.ASLEEP
            if c["_hBtS"] == 2 and c["_hidC"] == A.HID["wake"]:
                self.attention = A.AWAKE
            return []                       # button events get no reply
        if name == "_launchApp" and "_urlS" in c:     # a link (a show's page): refused when no app takes it
            u = c["_urlS"]
            self.log.append(("url", u))
            if any(f in u for f in self.fail_url):
                return [{"_t": 4, "_x": xid, "_em": "no app for that link"}]
            return [{"_t": 3, "_x": xid, "_c": {}}]
        if name == "_launchApp":
            b = c.get("_bundleID")
            self.log.append(("launch", b))
            if b in self.fail_launch or b not in self.apps:
                return [{"_t": 4, "_x": xid, "_em": "no such app"}]
            return [{"_t": 3, "_x": xid, "_c": {}}]
        if name == "FetchAttentionState":
            return [{"_t": 3, "_x": xid, "_c": {"state": self.attention}}]
        if name == "FetchLaunchableApplicationsEvent":
            return [{"_t": 3, "_x": xid, "_c": dict(self.apps)}]
        if name == "_sessionStart":
            return [{"_t": 3, "_x": xid, "_c": {"_sid": 7}}]
        if name == "TVRCSessionStart":
            return [{"_t": 4, "_x": xid, "_em": "unsupported"}]     # older tvOS: the driver must carry on
        return [{"_t": 3, "_x": xid, "_c": {}}]
