"""couch-tv#72: an app name must never carry shell characters to the TV."""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tv  # noqa: E402

BAD = ["a.b;touch /sdcard/proof", "a.b && reboot", "a.b'", "a.b$(id)", "a.b`id`", "a.b|sh",
       "a.b\nid", "nodots", ".a.b", "a..b", "", None, 5, "a." * 150 + "b"]
GOOD = ["com.netflix.ninja", "com.google.android.youtube.tv", "au.net.abc.iview", "tv.twitch.android.app",
        "com.disney.disneyplus", "dev.couchtv.ontv"]


class CheckPackage(unittest.TestCase):
    def test_real_package_names_pass(self):
        for p in GOOD:
            self.assertEqual(tv.check_package(p), p)

    def test_shell_characters_are_refused(self):
        for p in BAD:
            with self.assertRaises(tv.UnsafeInput, msg=repr(p)):
                tv.check_package(p)

    def test_launch_package_never_reaches_adb_with_a_bad_name(self):
        t = tv.TV.__new__(tv.TV)
        calls = []

        async def adb(*a, **k):
            calls.append(a)
            return ""

        async def ready():
            return True
        t.adb, t.adb_ready = adb, ready
        with self.assertRaises(tv.UnsafeInput):
            asyncio.run(t.launch_package("a.b;touch /sdcard/proof"))
        self.assertEqual(calls, [])
        asyncio.run(t.launch_package("com.netflix.ninja"))
        self.assertEqual(calls[0][:3], ("shell", "monkey", "-p"))

    def test_start_intent_refuses_a_bad_package(self):
        t = tv.TV.__new__(tv.TV)

        async def ready():
            return True

        async def adb(*a, **k):
            raise AssertionError("adb must not run")
        t.adb, t.adb_ready = adb, ready
        with self.assertRaises(tv.UnsafeInput):
            asyncio.run(t.start_intent("https://example.com", package="a.b'; reboot"))


if __name__ == "__main__":
    unittest.main()
