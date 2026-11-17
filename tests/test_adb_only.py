"""A Fire TV on Fire OS has no Android TV Remote protocol: with "adb_only": true the bridge drives
it over ADB alone (keys, typing, links), and nothing it sends can carry shell characters."""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tv  # noqa: E402

CFG = {"id": "cube", "name": "Cube", "ip": "192.0.2.10", "adb_only": True}


class FakeAdb(tv.TV):
    """The TV class with the ADB transport replaced by a recorder."""

    def __init__(self, cfg, connected=True):
        super().__init__(cfg)
        self.sent = []
        self.adb_ok = connected
        self.connected = connected

    async def adb_ready(self):
        return self.adb_ok

    async def adb(self, *args, timeout=15, binary=False):
        self.sent.append(" ".join(args))
        return "Status: ok"


def run(coro):
    return asyncio.run(coro)


class AdbText(unittest.TestCase):
    def test_spaces_become_percent_s_and_quotes_wrap(self):
        self.assertEqual(tv.adb_text("hello world"), "'hello%sworld'")

    def test_shell_characters_are_dropped(self):
        self.assertEqual(tv.adb_text("it's $(id) `id` | ; \"x\" <y> \\z"), "'its%s(id)%sid%s%s%sx%sy%sz'")

    def test_nothing_safe_gives_empty(self):
        self.assertEqual(tv.adb_text("$`\"'"), "")
        self.assertEqual(tv.adb_text(None), "")


class AdbOnlyTV(unittest.TestCase):
    def test_adb_only_counts_as_paired(self):
        t = tv.TV(CFG)
        self.assertTrue(t.paired)
        self.assertTrue(t.adb_only)
        self.assertFalse(tv.TV({"id": "g", "name": "G", "ip": "1.2.3.4"}).adb_only)

    def test_key_goes_over_adb(self):
        t = FakeAdb(CFG)
        self.assertEqual(run(t.key("up")), "DPAD_UP")
        self.assertEqual(t.sent, ["shell input keyevent KEYCODE_DPAD_UP"])
        run(t.key("back", hold=True))
        self.assertEqual(t.sent[-1], "shell input keyevent --longpress KEYCODE_BACK")

    def test_unknown_key_is_refused_before_adb(self):
        t = FakeAdb(CFG)
        with self.assertRaises(ValueError):
            run(t.key("x; reboot"))
        self.assertEqual(t.sent, [])

    def test_text_is_sanitised(self):
        t = FakeAdb(CFG)
        run(t.text("Bluey $(rm -rf /)"))
        self.assertEqual(t.sent, ["shell input text 'Bluey%s(rm%s-rf%s/)'"])
        run(t.text("'\"`"))
        self.assertEqual(len(t.sent), 1, "nothing sent when nothing safe is left")

    def test_open_link_uses_am_start(self):
        t = FakeAdb(CFG)
        run(t.open_link("https://www.youtube.com/watch?v=abc'; id"))
        self.assertEqual(t.sent, ["shell am start -W -a android.intent.action.VIEW -d 'https://www.youtube.com/watch?v=abc; id'"])

    def test_disconnected_raises_tv_unavailable(self):
        t = FakeAdb(CFG, connected=False)
        with self.assertRaises(tv.TVUnavailable):
            run(t.key("ok"))
        with self.assertRaises(tv.TVUnavailable):
            t.require()
        self.assertIsNone(t.is_on)
        self.assertIsNone(t.current_package)
        self.assertFalse(t.volume["known"])

    def test_state_comes_from_poll(self):
        t = FakeAdb(CFG)
        t._adb_on, t._adb_front = True, "com.plexapp.android"
        self.assertTrue(t.is_on)
        self.assertEqual(t.current_package, "com.plexapp.android")

    def test_port_open_defaults_to_adb_port(self):
        t = tv.TV(CFG | {"adb_port": 5555})
        self.assertEqual(t.adb_port, 5555)
        self.assertFalse(tv.TV({"id": "g", "name": "G", "ip": "1.2.3.4"}).adb_only)


if __name__ == "__main__":
    unittest.main()
