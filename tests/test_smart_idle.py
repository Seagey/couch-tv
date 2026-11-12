import asyncio
import os
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config
import server


class TestSmartIdleConfig(unittest.TestCase):
    def test_defaults_and_sanitization(self):
        d = config._smart_idle(None)
        self.assertEqual(d, {
            "enabled": False,
            "home_idle_minutes": 15,
            "home_action": "ambient_clock",
            "paused_idle_minutes": 30,
            "quiet_hours": {
                "enabled": False,
                "start": "23:00",
                "end": "06:00",
                "idle_minutes": 15,
            },
        })

        custom = config._smart_idle({
            "enabled": True,
            "home_idle_minutes": 0,
            "home_action": "tv_off",
            "paused_idle_minutes": 45,
            "quiet_hours": {"enabled": True, "start": "22:30", "end": "07:00", "idle_minutes": 10},
        })
        self.assertTrue(custom["enabled"])
        self.assertEqual(custom["home_idle_minutes"], 0)
        self.assertEqual(custom["home_action"], "tv_off")
        self.assertEqual(custom["paused_idle_minutes"], 45)
        self.assertEqual(custom["quiet_hours"], {"enabled": True, "start": "22:30", "end": "07:00", "idle_minutes": 10})

        bad = config._smart_idle({
            "home_idle_minutes": True,
            "home_action": "bogus",
            "paused_idle_minutes": 999,
            "quiet_hours": {"start": "25:99", "end": "abc", "idle_minutes": False},
        })
        self.assertEqual(bad["home_idle_minutes"], 15)
        self.assertEqual(bad["home_action"], "ambient_clock")
        self.assertEqual(bad["paused_idle_minutes"], 30)
        self.assertEqual(bad["quiet_hours"]["start"], "23:00")
        self.assertEqual(bad["quiet_hours"]["end"], "06:00")
        self.assertEqual(bad["quiet_hours"]["idle_minutes"], 15)

    def test_clean_settings_roundtrip(self):
        cleaned = server.clean_settings({
            "smart_idle": {
                "enabled": True,
                "home_idle_minutes": 10,
                "home_action": "screen_off",
                "paused_idle_minutes": 0,
            }
        })
        self.assertIn("smart_idle", cleaned)
        self.assertTrue(cleaned["smart_idle"]["enabled"])
        self.assertEqual(cleaned["smart_idle"]["home_idle_minutes"], 10)
        self.assertEqual(cleaned["smart_idle"]["home_action"], "screen_off")
        self.assertEqual(cleaned["smart_idle"]["paused_idle_minutes"], 0)


class TestSmartIdleRuntime(unittest.TestCase):
    def test_quiet_hours_overnight_and_daytime(self):
        qh = {"enabled": True, "start": "23:00", "end": "06:00"}
        self.assertTrue(server._in_quiet_hours(qh, datetime(2026, 11, 12, 23, 30)))
        self.assertTrue(server._in_quiet_hours(qh, datetime(2026, 11, 12, 3, 0)))
        self.assertFalse(server._in_quiet_hours(qh, datetime(2026, 11, 12, 12, 0)))
        self.assertFalse(server._in_quiet_hours(qh, datetime(2026, 11, 12, 6, 0)))

        day_qh = {"enabled": True, "start": "09:00", "end": "17:00"}
        self.assertTrue(server._in_quiet_hours(day_qh, datetime(2026, 11, 12, 10, 0)))
        self.assertFalse(server._in_quiet_hours(day_qh, datetime(2026, 11, 12, 18, 0)))

    def test_paused_idle_state_machine(self):
        fake_tv = MagicMock()
        fake_tv.connected = True
        fake_tv.is_on = True
        fake_tv.state = {}
        fake_tv.key = AsyncMock()

        cfg = config._smart_idle({"enabled": True, "paused_idle_minutes": 10})

        with patch.object(server, "tv", fake_tv), \
             patch.object(server, "_smart_idle_cfg", return_value=cfg), \
             patch.object(server, "push_now"), \
             patch.object(server, "sleep", {"ends": "2026-11-12T23:00:00", "handle": None}), \
             patch.object(server, "_sleep_set") as mock_sleep_set:

            async def run():
                # 1. No media session (HDMI/game) must never trigger
                self.assertFalse(await server._paused_idle_step(None, "com.android.tv.input", now_ts=1000.0))
                self.assertIsNone(server._paused_idle_state()["since"])

                # 2. Paused starts timer; 6 min in -> imminent warning (<= 5 min left)
                self.assertFalse(await server._paused_idle_step("paused", "com.netflix.ninja", now_ts=1000.0))
                self.assertFalse(await server._paused_idle_step("paused", "com.netflix.ninja", now_ts=1360.0))
                self.assertIsNotNone(server._paused_idle_state()["ends"])

                # 3. Playing resets timer and clears ends
                self.assertFalse(await server._paused_idle_step("playing", "com.netflix.ninja", now_ts=1400.0))
                self.assertIsNone(server._paused_idle_state()["since"])
                self.assertIsNone(server._paused_idle_state()["ends"])

                # 4. Paused for full 10 min powers TV off and clears sleep timer
                self.assertFalse(await server._paused_idle_step("paused", "com.netflix.ninja", now_ts=2000.0))
                self.assertTrue(await server._paused_idle_step("paused", "com.netflix.ninja", now_ts=2600.0))
                fake_tv.key.assert_awaited_once_with("power")
                mock_sleep_set.assert_called_once_with(None)

            asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
