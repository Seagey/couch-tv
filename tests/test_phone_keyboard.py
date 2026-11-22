""""phone_keyboard" on a TV: true by default (the TV may offer the phone's keyboard); false
passes enable_ime=False so the TV shows its own on screen keyboard."""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tv  # noqa: E402


def ime_for(extra):
    t = tv.TV({"id": "a", "name": "A", "ip": "192.0.2.10", **extra})
    seen = {}

    class Boom(Exception):
        pass

    def fake(*args, **kw):
        seen.update(kw)
        raise Boom

    with mock.patch.object(tv, "AndroidTVRemote", fake):
        try:
            asyncio.run(t._connect_once("192.0.2.10"))
        except Boom:
            pass
    return seen["enable_ime"]


class PhoneKeyboard(unittest.TestCase):
    def test_default_on(self):
        self.assertTrue(ime_for({}))

    def test_true_on(self):
        self.assertTrue(ime_for({"phone_keyboard": True}))

    def test_false_off(self):
        self.assertFalse(ime_for({"phone_keyboard": False}))


if __name__ == "__main__":
    unittest.main()
