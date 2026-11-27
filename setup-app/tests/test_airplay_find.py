"""Setup hears AirPlay 2 speakers on the Wi-Fi and tells the account their names only (couchtv_setup/airplay_find.py, lane C).
Nothing is sent to a speaker; a pretend mDNS and a pretend Studio are used here."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from couchtv_setup import airplay_find  # noqa: E402

AP = airplay_find.SERVICE.rstrip(".")          # the AirPlay service's mDNS name
CAST = AP.replace("_airplay", "_googlecast")
HEARD = [
    {"service": AP, "instance": "Lounge", "ip": "192.0.2.10", "port": 7000, "name": "Lounge"},
    {"service": AP + ".", "instance": "Kitchen Ceiling", "ip": "192.0.2.11", "port": 7000},
    {"service": AP, "instance": "lounge", "ip": "192.0.2.12", "port": 7000},
    {"service": AP, "instance": "Living Room Apple TV", "ip": "192.0.2.13", "port": 7000},
    {"service": AP, "instance": "Sam's MacBook Pro", "ip": "192.0.2.14", "port": 7000},
    {"service": AP, "instance": "https://evil.example", "ip": "192.0.2.15", "port": 7000},
    {"service": CAST, "instance": "Bedroom TV", "ip": "192.0.2.16", "port": 8009},
    {"service": AP, "instance": "AABBCCDDEEFF@Deck", "ip": "192.0.2.17", "port": 7000},
]


class Find(unittest.TestCase):
    def test_names_only_speakers_only(self):
        self.assertEqual(airplay_find.speakers_from(HEARD), ["Lounge", "Kitchen Ceiling", "Deck"])

    def test_report_sends_names_only(self):
        sent = []
        airplay_find.report("t" * 43, ["Lounge", "Deck"], call=lambda path, body, token: sent.append((path, body, token)) or {"ok": True})
        path, body, token = sent[0]
        self.assertEqual(path, "/v1/setup/found")
        self.assertEqual(body, {"speakers": [{"name": "Lounge"}, {"name": "Deck"}]})
        self.assertNotIn("192.0.2", repr(body), "never an address")

    def test_background_look_and_report(self):
        sent = []
        t = airplay_find.report_soon("t" * 43, 0.1, browse=lambda services, wait: HEARD, call=lambda p, b, tok: sent.append(b))
        t.join(5)
        self.assertEqual(sent, [{"speakers": [{"name": "Lounge"}, {"name": "Kitchen Ceiling"}, {"name": "Deck"}]}])

    def test_nothing_when_signed_out_or_stub(self):
        self.assertIsNone(airplay_find.report_soon(None))
        os.environ["COUCHTV_SETUP_STUDIO"] = "off"
        try:
            self.assertIsNone(airplay_find.report_soon("t" * 43))
        finally:
            del os.environ["COUCHTV_SETUP_STUDIO"]

    def test_a_failing_look_changes_nothing(self):
        def boom(*a):
            raise OSError("no network")
        self.assertEqual(airplay_find.find(0.1, browse=boom), [])


if __name__ == "__main__":
    unittest.main()
