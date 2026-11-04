"""Unpaired setup must have zero transport side effects, including phone-page discovery."""
import asyncio
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tv
import server
from aiohttp.test_utils import make_mocked_request


class UnpairedTVTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.device = tv.TV({"id": "test", "name": "Test", "host": "tv.example.org",
                             "paired": False, "wake_on_lan": True, "mac": ""})

    async def test_adb_app_discovery_never_connects_before_remote_pairing(self):
        with patch.object(tv, "ensure_adb_key") as keys, patch.object(tv, "AdbDeviceTcpAsync") as transport:
            self.assertIsNone(await self.device.installed_packages())
            keys.assert_not_called()
            transport.assert_not_called()

    async def test_wake_reconnect_and_port_checks_are_dormant(self):
        self.device.mac = "00" * 6
        with patch.object(tv.socket, "socket") as udp, patch.object(tv.asyncio, "open_connection", new_callable=AsyncMock) as tcp, \
                patch.object(tv, "AndroidTVRemote") as remote:
            self.assertFalse(await self.device.port_open())
            self.assertFalse(await self.device.reconnect_now())
            await self.device.wake()
            udp.assert_not_called()
            tcp.assert_not_called()
            remote.assert_not_called()

    async def test_direct_control_is_rejected_without_network_effects(self):
        with patch.object(tv, "AdbDeviceTcpAsync") as transport:
            with self.assertRaises(tv.TVUnavailable):
                await self.device.launch_package("test.app")
            with self.assertRaises(tv.TVUnavailable):
                await self.device.key("home")
            transport.assert_not_called()

    async def test_phone_app_listing_and_power_do_not_connect_when_unpaired(self):
        with patch.object(tv, "ensure_adb_key") as keys, patch.object(tv, "AdbDeviceTcpAsync") as transport:
            response = await server.h_apps(make_mocked_request("GET", "/api/apps"))
            self.assertEqual(response.status, 200)
            await asyncio.sleep(0)
            with self.assertRaises(tv.TVUnavailable):
                await server.power_on()
            keys.assert_not_called()
            transport.assert_not_called()


if __name__ == "__main__":
    unittest.main()
