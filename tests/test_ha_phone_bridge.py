"""Smart home set up from a phone through the bridge (bridge/haphone.py, bridge/smarthome.py), for the
web TVs: a refresh token kept with its client id, the access token refreshed only when it runs out and
once when Home Assistant refuses it, a refused refresh token means sign in again, the ticks kept when
the same Home Assistant signs in again, the client id is the computer on the home network, PKCE as
RFC 7636 makes it, and Home Assistant's announcement turned into an address. Made up tokens only.
Run: .venv/bin/python tests/test_ha_phone_bridge.py"""
import asyncio
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import haphone  # noqa: E402
import smarthome  # noqa: E402


def lan(c, d):
    """A home network address for the tests, made here so no real one is ever written down."""
    return "192.168.%d.%d" % (c, d)


def ip(a, b, c, d):
    return "%d.%d.%d.%d" % (a, b, c, d)


REFRESH = "refresh-made-up-for-a-test-0000000001"
CLIENT = "http://" + lan(1, 50) + ":5400/"


class PhoneBridgeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.home = smarthome.Home(self.dir)
        self.now = 1000.0
        self.home.clock = lambda: self.now
        self.refreshes, self.bearers = 0, []
        self.refuse = False

        async def form(url, data):
            if url.endswith("/auth/token"):
                self.refreshes += 1
                if self.refuse or data.get("client_id") != CLIENT:
                    return 400, {"error": "invalid_grant"}
                return 200, {"access_token": "access-%03d-made-up-for-a-test-0000" % self.refreshes, "expires_in": 1800}
            return 200, None
        self.home.form = form

        async def call(base, token, method, path, body=None, limit=0):
            self.bearers.append(token)
            if token.startswith("stale"):
                return 401, None
            return 200, json.dumps({"entity_id": "climate.lounge", "state": "cool", "attributes": {}}).encode()
        self.home.call = call
        self.home._write({"url": "http://ha.example:8123", "refresh_token": REFRESH, "client_id": CLIENT, "climate": [{"entity": "climate.lounge"}]})

    def run_(self, c):
        return asyncio.run(c)

    def test_signed_in_section(self):
        s = self.home.settings()
        self.assertEqual(s["token"], "")
        self.assertEqual(s["refresh"], REFRESH)
        self.assertIsNone(smarthome.parse({"url": "http://ha.example:8123", "refresh_token": REFRESH}))   # no client id
        self.assertTrue(self.home.status()["signed_in"])
        self.assertEqual(self.home.status()["count"], 1)

    def test_refreshed_only_when_it_runs_out(self):
        s = self.home.settings()
        self.run_(self.home.state(s, "climate.lounge"))
        self.run_(self.home.state(s, "climate.lounge"))
        self.assertEqual(self.refreshes, 1)
        self.now += 1800
        self.run_(self.home.state(s, "climate.lounge"))
        self.assertEqual(self.refreshes, 2)

    def test_refused_access_token_is_refreshed_once(self):
        self.home.access[REFRESH] = ("stale-access-made-up-0000000000000", self.now + 1800)
        r = self.run_(self.home.state(self.home.settings(), "climate.lounge"))
        self.assertIsNotNone(r)
        self.assertEqual(self.refreshes, 1)
        self.assertTrue(self.bearers[0].startswith("stale") and not self.bearers[-1].startswith("stale"))

    def test_refused_refresh_means_sign_in_again(self):
        self.refuse = True
        s = self.home.settings()
        self.assertIsNone(self.run_(self.home.state(s, "climate.lounge")))
        self.assertEqual(self.bearers, [])   # nothing sent without a token
        self.assertEqual(self.run_(self.home.list_for(s))["error"], "token")

    def test_same_home_assistant_keeps_ticks(self):
        self.assertTrue(self.home.keep_sign_in("http://ha.example:8123", {"access_token": "a" * 30, "refresh_token": "r" * 30, "expires_in": 1800}, CLIENT))
        self.assertEqual([c["entity"] for c in self.home.settings()["climate"]], ["climate.lounge"])
        self.assertTrue(self.home.keep_sign_in("http://other.example:8123", {"access_token": "a" * 30, "refresh_token": "s" * 30, "expires_in": 1800}, CLIENT))
        self.assertEqual(self.home.settings()["climate"], [])
        self.assertTrue(self.home.keep_picks({"scenes": [{"entity": "scene.movie"}], "token": "sneaky-token-not-kept-000000"}))
        kept = json.load(open(os.path.join(self.dir, "home-assistant.json")))
        self.assertNotIn("token", kept)
        self.assertEqual(kept["refresh_token"], "s" * 30)

    def test_disconnect_revokes(self):
        seen = []

        async def form(url, data):
            seen.append(url)
            return 200, None
        self.home.form = form
        self.run_(self.home.disconnect())
        self.assertTrue(seen[-1].endswith("/auth/revoke"))
        self.assertIsNone(self.home.settings())

    def test_client_id_and_pkce_and_announcement(self):
        self.assertEqual(haphone.client_for(lan(1, 50) + ":5400", None, 5400), "http://" + lan(1, 50) + ":5400/")
        self.assertEqual(haphone.client_for("evil.example:5400", lan(1, 50), 5400), "http://" + lan(1, 50) + ":5400/")
        self.assertEqual(haphone.client_for(lan(1, 50) + ":80", ip(10, 0, 0, 2), 5400), "http://" + ip(10, 0, 0, 2) + ":5400/")
        self.assertIsNone(haphone.client_for("8.8.8.8:5400", "8.8.4.4", 5400))
        self.assertEqual(haphone.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        u = haphone.authorize_url("http://ha:8123", CLIENT, "st", "ch")
        self.assertIn("redirect_uri=http%3A%2F%2F" + lan(1, 50) + "%3A5400%2Fha%2Fdone", u)
        self.assertTrue(u.endswith("code_challenge=ch&code_challenge_method=S256"))
        self.assertEqual(haphone.url_from({"internal_url": "http://homeassistant.local:8123"}, lan(1, 20), 8123), "http://" + lan(1, 20) + ":8123")
        self.assertEqual(haphone.url_from({"internal_url": "https://ha.example.com"}, lan(1, 20), 8123), "https://ha.example.com")
        self.assertEqual(haphone.url_from({}, lan(1, 20), 8123), "http://" + lan(1, 20) + ":8123")


if __name__ == "__main__":
    unittest.main()
