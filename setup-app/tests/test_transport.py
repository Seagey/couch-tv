"""The Wireless debugging connection (adbtls.py) against a pretend TV that speaks the same
handshake as adbd: CNXN, STLS, TLS 1.3 with the client's certificate, then CNXN inside TLS and a
shell command. Also the mDNS parser and the release checks."""
import hashlib
import io
import json
import os
import socket
import ssl
import struct
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import adbtls, mdns, release  # noqa: E402
from couchtv_setup.identity import Identity  # noqa: E402
from couchtv_setup.tv import Tv, TvError  # noqa: E402

CMDS = {name: struct.unpack("<I", name)[0] for name in (b"CNXN", b"STLS", b"OPEN", b"OKAY", b"WRTE", b"CLSE")}


def packet(cmd, a0, a1, data=b""):
    c = CMDS[cmd]
    return struct.pack("<6I", c, a0, a1, len(data), sum(data) & 0xFFFFFFFF, c ^ 0xFFFFFFFF) + data


def read_packet(s):
    head = b""
    while len(head) < 24:
        chunk = s.recv(24 - len(head))
        if not chunk:
            raise ConnectionError
        head += chunk
    cmd, a0, a1, n = struct.unpack("<4I", head[:16])
    data = b""
    while len(data) < n:
        data += s.recv(n - len(data))
    return struct.pack("<I", cmd), a0, a1, data


class FakeTlsTv(threading.Thread):
    """Accepts one connection, wants a client certificate whose key it knows, answers one shell."""

    def __init__(self, server_ident, allowed_cert_der):
        super().__init__(daemon=True)
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ctx.minimum_version = ssl.TLSVersion.TLSv1_3
        self.ctx.load_cert_chain(server_ident.cert_path, server_ident.key_path)
        self.ctx.verify_mode = ssl.CERT_OPTIONAL
        self.ctx.check_hostname = False
        self.ctx.load_verify_locations(cadata=allowed_cert_der)
        self.got = []
        self.error = None

    def run(self):
        try:
            raw, _ = self.listener.accept()
            cmd, *_ = read_packet(raw)
            self.got.append(cmd)
            raw.sendall(packet(b"STLS", 0x01000000, 0))
            cmd, *_ = read_packet(raw)
            self.got.append(cmd)
            tls = self.ctx.wrap_socket(raw, server_side=True)
            if not tls.getpeercert(binary_form=True):
                raise ConnectionError("no client certificate")
            tls.sendall(packet(b"CNXN", 0x01000000, 4096, b"device::ro.product.model=Fake;\x00"))
            while True:
                cmd, a0, a1, data = read_packet(tls)
                self.got.append(cmd)
                if cmd == b"OPEN":
                    tls.sendall(packet(b"OKAY", 7, a0))
                    tls.sendall(packet(b"WRTE", 7, a0, b"uid=2000(shell)\n"))
                elif cmd == b"OKAY":
                    tls.sendall(packet(b"CLSE", 7, a0))
                elif cmd == b"CLSE":
                    break
        except Exception as e:
            self.error = e
        finally:
            self.listener.close()


class Transport(unittest.TestCase):
    def test_tls_connect_and_shell(self):
        client, server = Identity(tempfile.mkdtemp()), Identity(tempfile.mkdtemp())
        from cryptography.hazmat.primitives import serialization
        tv = FakeTlsTv(server, client.cert.public_bytes(serialization.Encoding.DER))
        tv.start()
        conn = Tv("127.0.0.1", client, route="tls", port=tv.port)
        out = conn.shell("id", timeout_s=10)
        conn.close()
        tv.join(10)
        self.assertIsNone(tv.error)
        self.assertEqual(tv.got[:2], [b"CNXN", b"STLS"])
        self.assertNotIn(b"CNXN", tv.got[2:])      # adb-shell's own CNXN never reached the TV
        self.assertIn("uid=2000", out)

    def test_unknown_key_is_refused(self):
        client, server, stranger = (Identity(tempfile.mkdtemp()) for _ in range(3))
        from cryptography.hazmat.primitives import serialization
        tv = FakeTlsTv(server, stranger.cert.public_bytes(serialization.Encoding.DER))
        tv.ctx.verify_mode = ssl.CERT_REQUIRED
        tv.start()
        with self.assertRaises(TvError) as e:
            Tv("127.0.0.1", client, route="tls", port=tv.port)
        self.assertEqual(e.exception.code, "not_paired")


class Mdns(unittest.TestCase):
    def test_parse_and_resolve(self):
        def name(n):
            return b"".join(bytes([len(p)]) + p.encode() for p in n.split(".")) + b"\x00"

        def rr(n, t, data):
            return name(n) + struct.pack(">HHIH", t, 1, 120, len(data)) + data
        svc = "_adb-tls-pairing._tcp.local."
        inst = "adb-ABC-xyz." + svc.rstrip(".")
        pkt = struct.pack(">6H", 0, 0x8400, 0, 1, 0, 2)
        pkt += rr(svc.rstrip("."), mdns.PTR, name(inst))
        pkt += rr(inst, mdns.SRV, struct.pack(">HHH", 0, 0, 37123) + name("android-3.example.local"))
        pkt += rr("android-3.example.local", mdns.A, socket.inet_aton("192.0.2.10"))
        found = mdns.resolve([r + ("192.0.2.10",) for r in mdns.parse(pkt)], [svc.rstrip(".")])
        self.assertEqual(found, [{"service": svc.rstrip("."), "instance": inst.lower(), "ip": "192.0.2.10", "port": 37123, "name": "adb-ABC-xyz"}])

    def test_garbage_is_ignored(self):
        self.assertEqual(mdns.parse(b"\x00\x01garbage"), [])


class Release(unittest.TestCase):
    def setUp(self):
        self.data = b"pretend apk" * 1000
        self.sha = hashlib.sha256(self.data).hexdigest()

    def _release(self, digest=None, sums=None):
        assets = [{"name": "couch-tv-home.apk", "size": len(self.data), "digest": digest,
                   "browser_download_url": "https://github.com/Seagey/couch-tv/releases/download/v9/couch-tv-home.apk"}]
        if sums is not None:
            assets.append({"name": "SHA256SUMS.txt", "size": 1,
                           "browser_download_url": "https://github.com/Seagey/couch-tv/releases/download/v9/SHA256SUMS.txt"})
        self.sums_text = sums
        return {"tag_name": "v9", "assets": assets}

    def _fake_open(self, url, timeout=30):
        body = self.sums_text.encode() if url.endswith("SHA256SUMS.txt") else self.data
        return io.BytesIO(body)

    def test_good_download(self):
        with mock.patch.object(release, "_open", self._fake_open):
            r = release.get("couch-tv-home.apk", release=self._release("sha256:" + self.sha, f"{self.sha}  couch-tv-home.apk\n"))
        self.assertEqual(r["sha256"], self.sha)
        self.assertIn("SHA256SUMS", r["checked"])

    def test_tampered_download_is_deleted(self):
        rel = self._release("sha256:" + "0" * 64)
        with mock.patch.object(release, "_open", self._fake_open):
            with self.assertRaises(TvError) as e:
                release.get("couch-tv-home.apk", release=rel)
        self.assertEqual(e.exception.code, "checksum")
        self.assertFalse(any(p.name.endswith(".part") for p in release.paths.cache().iterdir()))

    def test_checksums_that_disagree(self):
        rel = self._release("sha256:" + self.sha, "1" * 64 + "  couch-tv-home.apk\n")
        with mock.patch.object(release, "_open", self._fake_open):
            with self.assertRaises(TvError) as e:
                release.get("couch-tv-home.apk", release=rel)
        self.assertEqual(e.exception.code, "checksum")

    def test_no_checksum_no_install(self):
        with mock.patch.object(release, "_open", self._fake_open):
            with self.assertRaises(TvError) as e:
                release.get("couch-tv-home.apk", release=self._release(None))
        self.assertEqual(e.exception.code, "no_checksum")

    def test_only_github(self):
        with self.assertRaises(TvError):
            release._open("https://example.com/x.apk")
        with self.assertRaises(TvError):
            release._open("http://github.com/x.apk")


if __name__ == "__main__":
    unittest.main()
