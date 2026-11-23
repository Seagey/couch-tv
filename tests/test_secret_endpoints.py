"""Endpoints that use a secret kept on the home computer (the Home Assistant token, the Hue key, the
bookings mailbox password) answer only a TV in config.json, the computer itself, or a caller with the
pairing key. With no pairing key, a phone or any other device on the Wi-Fi is refused before the
handler runs, so it can never send the kept token anywhere or read the guests' names."""
import asyncio
import os
import sys
import unittest
from unittest.mock import patch

from aiohttp.test_utils import make_mocked_request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import tempfile  # noqa: E402
import config  # noqa: E402
import direct  # noqa: E402
import server  # noqa: E402
import smarthome  # noqa: E402

GUARDED = ["h_ha", "h_ha_check", "h_ha_save", "h_ha_forget", "h_direct", "h_stay_names"]


def call(name, ip, key=""):
    req = make_mocked_request("POST", "/api/ha/check", headers={"Content-Type": "application/json"})
    ran = []

    async def body(_r):
        ran.append(name)
        return {"url": "http://attacker.example:8123", "token": ""}
    home = smarthome.Home(tempfile.mkdtemp())   # never this computer's own set up
    home.direct = direct.Direct(tempfile.mkdtemp(), {}, env={})
    with patch.object(server, "HA", home), patch.object(config, "PAIRING_KEY", key), patch.object(server, "client_ip", lambda r: ip), \
            patch.object(server, "_tv_ips", lambda: {"192.0.2.50"}), patch.object(server, "body", body):
        try:
            asyncio.run(getattr(server, name)(req))
            return "ran", ran
        except server.ApiError as e:
            return e.status, ran


class SecretEndpoints(unittest.TestCase):
    def test_a_phone_on_the_wifi_is_refused_without_a_pairing_key(self):
        for name in GUARDED:
            status, ran = call(name, "192.0.2.99")
            self.assertEqual(status, 403, name)
            self.assertEqual(ran, [], name + ": the handler never ran")

    def test_the_tv_and_this_computer_are_allowed(self):
        for name in ["h_ha_check", "h_ha_forget"]:
            self.assertEqual(call(name, "192.0.2.50")[0], "ran", name + " from the TV")
            self.assertEqual(call(name, None)[0], "ran", name + " from this computer")

    def test_with_a_pairing_key_the_middleware_decides(self):
        # the key itself is checked for every /api/ call before any handler (test_bridge_security.py)
        self.assertEqual(call("h_ha_forget", "192.0.2.99", key="a-long-enough-pairing-key")[0], "ran")

    def test_names_only_stay_open(self):
        # names and readings only, no secret used: the phone remote and previews may read them
        self.assertEqual(call("h_ha_info", "192.0.2.99")[0], "ran")


if __name__ == "__main__":
    unittest.main()
