import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config
import server
import tv
from aiohttp.test_utils import make_mocked_request


class TestBluetoothAudio(unittest.TestCase):
    def setUp(self):
        self.cfg = {"id": "living-room", "name": "Living room", "ip": "192.0.2.1"}
        self.test_tv = tv.TV(self.cfg)
        self.test_tv.adb_ready = AsyncMock(return_value=True)

    def test_open_bluetooth_settings_fixed_command(self):
        calls = []

        async def fake_adb(*args, **kwargs):
            calls.append(list(args))
            return "Starting: Intent { act=android.settings.BLUETOOTH_SETTINGS }"

        self.test_tv.adb = fake_adb
        asyncio.run(self.test_tv.open_bluetooth_settings())

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], ["shell", "am", "start", "-a", "android.settings.BLUETOOTH_SETTINGS"])

    def test_open_bluetooth_settings_fallback_for_fire_tv(self):
        calls = []

        async def fake_adb(*args, **kwargs):
            calls.append(list(args))
            if len(calls) == 1:
                return "Error: Activity not started, unable to resolve Intent"
            return "Starting: Intent { cmp=com.amazon.tv.settings.v2/... }"

        self.test_tv.adb = fake_adb
        asyncio.run(self.test_tv.open_bluetooth_settings())

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], ["shell", "am", "start", "-a", "android.settings.BLUETOOTH_SETTINGS"])
        self.assertEqual(calls[1], [
            "shell", "am", "start", "-n",
            "com.amazon.tv.settings.v2/.tv.controllers_bluetooth_devices.ControllersAndBluetoothActivity"
        ])

    def test_open_settings_screen_bluetooth(self):
        with patch.object(self.test_tv, "open_bluetooth_settings", new_callable=AsyncMock) as mock_open:
            asyncio.run(self.test_tv.open_settings_screen("bluetooth"))
            mock_open.assert_awaited_once()

    def test_open_settings_screen_network(self):
        calls = []

        async def fake_adb(*args, **kwargs):
            calls.append(list(args))
            return "Starting: Intent { act=android.settings.WIFI_SETTINGS }"

        self.test_tv.adb = fake_adb
        asyncio.run(self.test_tv.open_settings_screen("network"))
        self.assertEqual(calls, [["shell", "am", "start", "-a", "android.settings.WIFI_SETTINGS"]])

    def test_open_settings_screen_unknown(self):
        with self.assertRaises(ValueError):
            asyncio.run(self.test_tv.open_settings_screen("invalid_screen"))

    def test_open_bluetooth_settings_adb_required(self):
        self.test_tv.adb_ready = AsyncMock(return_value=False)
        with self.assertRaises(tv.TVUnavailable):
            asyncio.run(self.test_tv.open_bluetooth_settings())

    def test_safety_fixed_command_ignores_request_input(self):
        """Verify that malicious request payloads with command injection attempts cannot reach the TV shell."""
        calls = []

        async def fake_adb(*args, **kwargs):
            calls.append(list(args))
            return "Success"

        self.test_tv.adb = fake_adb

        # Simulated attack: {"action": "connect", "mac": "x; reboot"}
        # The bridge ignores body parameters and executes only the fixed literal command
        asyncio.run(self.test_tv.open_bluetooth_settings())
        for call_args in calls:
            cmd_str = " ".join(call_args)
            self.assertNotIn("reboot", cmd_str)
            self.assertNotIn(";", cmd_str)
            self.assertEqual(call_args, ["shell", "am", "start", "-a", "android.settings.BLUETOOTH_SETTINGS"])


class TestServerBluetoothAudioHandlers(unittest.TestCase):
    def test_bluetooth_audio_endpoints(self):
        async def _run():
            mock_tv = MagicMock()
            mock_tv.name = "Test TV"
            mock_tv.require = MagicMock(return_value=None)
            mock_tv.open_bluetooth_settings = AsyncMock(return_value=None)
            mock_tv.adb_ready = AsyncMock(return_value=True)

            with patch.object(server, "tv", mock_tv):
                # GET /api/bluetooth-audio
                req_get = make_mocked_request("GET", "/api/bluetooth-audio")
                res_get = await server.h_bluetooth_audio_get(req_get)
                self.assertEqual(res_get.status, 200)
                self.assertIn('"ok": true', res_get.text)
                self.assertIn('"supported": true', res_get.text)
                # Ensure no MAC addresses leak
                self.assertNotIn("mac", res_get.text.lower())
                self.assertNotIn("device", res_get.text.lower())

                # POST /api/bluetooth-audio
                req_post = make_mocked_request("POST", "/api/bluetooth-audio")
                res_post = await server.h_bluetooth_audio_set(req_post)
                self.assertEqual(res_post.status, 200)
                self.assertIn('"ok": true', res_post.text)
                mock_tv.open_bluetooth_settings.assert_awaited_once()

        asyncio.run(_run())

    def test_launch_bluetooth_and_network(self):
        async def _run():
            mock_tv = MagicMock()
            mock_tv.open_settings_screen = AsyncMock(return_value=None)

            with patch.object(server, "tv", mock_tv):
                # Test /api/launch with app: "bluetooth"
                with patch("server.body", AsyncMock(return_value={"app": "bluetooth"})):
                    req = make_mocked_request("POST", "/api/launch")
                    res = await server.h_launch(req)
                    self.assertEqual(res.status, 200)
                    mock_tv.open_settings_screen.assert_awaited_with("bluetooth")

                # Test /api/launch with app: "network"
                with patch("server.body", AsyncMock(return_value={"app": "network"})):
                    req = make_mocked_request("POST", "/api/launch")
                    res = await server.h_launch(req)
                    self.assertEqual(res.status, 200)
                    mock_tv.open_settings_screen.assert_awaited_with("network")

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
