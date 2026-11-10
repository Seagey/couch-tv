import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config
import tv

def _mac(*parts):
    return ":".join(parts)


class TestBluetoothAudioParsing(unittest.TestCase):
    def test_parse_bonded_bluetooth(self):
        m1 = _mac("AA", "BB", "CC", "DD", "EE", "01")
        m2 = _mac("11", "22", "33", "44", "55", "66")
        m3 = _mac("99", "88", "77", "66", "55", "44")
        sample_dumpsys = f"""
Bluetooth Status
  enabled: true
  state: ON
  Bonded devices:
    {m1} (AirPods Pro) [A2DP]
    {m2} (Sony WH-1000XM4)
    Address: {m3} Name: Bose QC35
  Connected devices:
    {m1}
"""
        devices = tv.parse_bonded_bluetooth(sample_dumpsys)
        self.assertEqual(len(devices), 3)
        macs = [d["mac"] for d in devices]
        self.assertIn(m1, macs)
        self.assertIn(m2, macs)
        self.assertIn(m3, macs)
        self.assertEqual(devices[0]["name"], "AirPods Pro")
        self.assertEqual(devices[1]["name"], "Sony WH-1000XM4")
        self.assertEqual(devices[2]["name"], "Bose QC35")

    def test_parse_a2dp_state_active(self):
        m1 = _mac("AA", "BB", "CC", "DD", "EE", "01")
        audio_dumpsys = """
- Stream: STREAM_MUSIC
  Current Audio Routes:
    mBluetoothA2dpOn=true
    devices=0x80 (DEVICE_OUT_BLUETOOTH_A2DP)
"""
        bt_dumpsys = f"""
A2DP active device: {m1}
"""
        is_active, mac = tv.parse_a2dp_state(audio_dumpsys, bt_dumpsys)
        self.assertTrue(is_active)
        self.assertEqual(mac, m1)

    def test_parse_a2dp_state_inactive(self):
        audio_dumpsys = """
- Stream: STREAM_MUSIC
  Current Audio Routes:
    mBluetoothA2dpOn=false
    devices=0x2 (DEVICE_OUT_SPEAKER)
"""
        bt_dumpsys = "Active Device: null"
        is_active, mac = tv.parse_a2dp_state(audio_dumpsys, bt_dumpsys)
        self.assertFalse(is_active)
        self.assertIsNone(mac)

    def test_bluetooth_audio_config_normalization(self):
        m_lower = _mac("aa", "bb", "cc", "dd", "ee", "ff")
        m_upper = _mac("AA", "BB", "CC", "DD", "EE", "FF")
        m_num = _mac("11", "22", "33", "44", "55", "66")

        # Dict format with MAC and Name
        c1 = config.bluetooth_audio_for({"bluetooth_audio": {"name": "AirPods", "mac": m_lower}})
        self.assertEqual(c1, {"name": "AirPods", "mac": m_upper})

        # String format (name)
        c2 = config.bluetooth_audio_for({"bluetooth_audio": "Bose Headphones"})
        self.assertEqual(c2, {"name": "Bose Headphones", "mac": None})

        # String format (MAC)
        c3 = config.bluetooth_audio_for({"bluetooth_audio": m_num})
        self.assertEqual(c3, {"name": "Headphones", "mac": m_num})

        # Empty / None
        self.assertIsNone(config.bluetooth_audio_for({}))
        self.assertIsNone(config.bluetooth_audio_for({"bluetooth_audio": ""}))


class TestTVBluetoothAudioMethods(unittest.IsolatedAsyncioTestCase):
    async def test_get_bluetooth_audio_connected(self):
        m = _mac("AA", "BB", "CC", "DD", "EE", "FF")
        cfg = {
            "id": "living-room",
            "name": "Living room",
            "ip": "192.0.2.1",
            "bluetooth_audio": {"name": "AirPods Pro", "mac": m}
        }
        test_tv = tv.TV(cfg)
        test_tv.adb_ready = AsyncMock(return_value=True)

        audio_dump = "mBluetoothA2dpOn=true\nDEVICE_OUT_BLUETOOTH_A2DP"
        bt_dump = f"Bonded devices:\n  {m} (AirPods Pro)\nA2DP active device: {m}"

        async def fake_adb(*args, **kwargs):
            cmd = " ".join(args)
            if "dumpsys audio" in cmd:
                return audio_dump
            if "dumpsys bluetooth_manager" in cmd:
                return bt_dump
            return ""

        test_tv.adb = fake_adb

        res = await test_tv.get_bluetooth_audio()
        self.assertTrue(res["supported"])
        self.assertTrue(res["connected"])
        self.assertEqual(res["device"]["name"], "AirPods Pro")
        self.assertEqual(res["device"]["mac"], m)

    async def test_set_bluetooth_audio_toggle_to_connect(self):
        m = _mac("AA", "BB", "CC", "DD", "EE", "FF")
        cfg = {
            "id": "living-room",
            "name": "Living room",
            "ip": "192.0.2.1",
            "bluetooth_audio": {"name": "AirPods Pro", "mac": m}
        }
        test_tv = tv.TV(cfg)
        test_tv.adb_ready = AsyncMock(return_value=True)

        calls = []

        async def fake_adb(*args, **kwargs):
            calls.append(list(args))
            cmd = " ".join(args)
            if "dumpsys audio" in cmd:
                return "devices=0x2 (DEVICE_OUT_SPEAKER)"
            if "dumpsys bluetooth_manager" in cmd:
                return f"Bonded devices:\n  {m} (AirPods Pro)"
            return "Connected"

        test_tv.adb = fake_adb

        await test_tv.set_bluetooth_audio(action="toggle")
        self.assertTrue(any("connect" in c for c in calls))


if __name__ == "__main__":
    unittest.main()
