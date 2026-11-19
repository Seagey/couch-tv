"""SPAKE2 and Wireless debugging pairing, without a TV.

The pairing client is checked against this module's own server half here. The server half was
itself checked against Google's adb (`adb pair` from Android Debug Bridge 1.0.41 paired with it, and a wrong
code was refused), and the client paired with a real Google TV on Android 14, so a pass here means
the two halves still agree with what was tested for real.
"""
import hashlib
import os
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from couchtv_setup import pairing, spake2  # noqa: E402
from couchtv_setup.identity import Identity  # noqa: E402


class Spake2Points(unittest.TestCase):
    def test_m_and_n_come_from_boringssls_seeds(self):
        # BoringSSL's genpoint(): SHA-256 of the seed, then SHA-256 again until it decodes to a point.
        for seed, want in ((b"edwards25519 point generation seed (M)", spake2.M_HEX),
                           (b"edwards25519 point generation seed (N)", spake2.N_HEX)):
            v = hashlib.sha256(seed).digest()
            while spake2.decode(v) is None:
                v = hashlib.sha256(v).digest()
            self.assertEqual(spake2.encode(spake2.decode(v)).hex(), want)

    def test_base_point_order(self):
        self.assertEqual(spake2.encode(spake2.mul(spake2.L, spake2.BASE)), spake2.encode(spake2.IDENTITY))

    def test_same_password_same_key(self):
        a = spake2.Spake2(True, b"a\x00", b"b\x00")
        b = spake2.Spake2(False, b"b\x00", b"a\x00")
        ma, mb = a.generate(b"123456"), b.generate(b"123456")
        self.assertEqual(a.process(mb), b.process(ma))

    def test_other_password_other_key(self):
        a = spake2.Spake2(True, b"a\x00", b"b\x00")
        b = spake2.Spake2(False, b"b\x00", b"a\x00")
        ma, mb = a.generate(b"123456"), b.generate(b"654321")
        self.assertNotEqual(a.process(mb), b.process(ma))

    def test_not_a_point_is_refused(self):
        a = spake2.Spake2(True, b"a", b"b")
        a.generate(b"1")
        bad = next(bytes([i]) + b"\x00" * 31 for i in range(2, 255) if spake2.decode(bytes([i]) + b"\x00" * 31) is None)
        with self.assertRaises(ValueError):
            a.process(bad)


class Pairing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = Identity(tempfile.mkdtemp())
        cls.server = Identity(tempfile.mkdtemp())

    def _serve(self, code):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        result = {}

        def run():
            try:
                result["key"] = pairing.serve_once(listener, code, self.server.cert, self.server.key, guid="adb-TEST-1")
            except Exception as e:
                result["error"] = e
            finally:
                listener.close()
        t = threading.Thread(target=run)
        t.start()
        return listener.getsockname()[1], t, result

    def test_right_code(self):
        port, t, result = self._serve("123456")
        guid = pairing.pair("127.0.0.1", port, "123 456", self.client.cert, self.client.key, self.client.public_text)
        t.join(10)
        self.assertEqual(guid, "adb-TEST-1")
        self.assertEqual(result["key"], self.client.public_text)

    def test_wrong_code(self):
        port, t, result = self._serve("123456")
        with self.assertRaises(pairing.PairingError) as e:
            pairing.pair("127.0.0.1", port, "111111", self.client.cert, self.client.key, self.client.public_text)
        t.join(10)
        self.assertEqual(e.exception.code, "wrong_code")
        self.assertIn("error", result)

    def test_nothing_listening(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with self.assertRaises(pairing.PairingError) as e:
            pairing.pair("127.0.0.1", port, "123456", self.client.cert, self.client.key, self.client.public_text, timeout=3)
        self.assertEqual(e.exception.code, "unreachable")

    def test_code_must_be_six_digits(self):
        with self.assertRaises(pairing.PairingError):
            pairing.pair("127.0.0.1", 1, "12345", self.client.cert, self.client.key, self.client.public_text)


if __name__ == "__main__":
    unittest.main()
