"""phone_keyboard config flag: false turns off enable_ime so the TV keeps its own keyboard."""
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))

import tv  # noqa: E402


def make(**extra):
    cfg = {"id": "t", "name": "T", "host": "tv.example.org", "paired": True}
    cfg.update(extra)
    return tv.TV(cfg)


class PhoneKeyboardTests(unittest.IsolatedAsyncioTestCase):
    async def connect(self, device):
        with patch.object(tv, "AndroidTVRemote") as remote:
            remote.return_value.async_connect = AsyncMock()
            remote.return_value.add_is_on_updated_callback = MagicMock()
            try:
                await device._connect_once("192.0.2.1")
            except Exception:
                pass
            return remote.call_args

    def test_default_is_true(self):
        self.assertTrue(make().phone_keyboard)
        self.assertTrue(make(phone_keyboard="nonsense").phone_keyboard)

    def test_false_is_read(self):
        self.assertFalse(make(phone_keyboard=False).phone_keyboard)

    async def test_default_keeps_ime_on(self):
        call = await self.connect(make())
        self.assertIs(call.kwargs["enable_ime"], True)

    async def test_false_turns_ime_off(self):
        call = await self.connect(make(phone_keyboard=False))
        self.assertIs(call.kwargs["enable_ime"], False)


if __name__ == "__main__":
    unittest.main()
