"""couch-tv#72: an app name must never carry shell characters to the TV."""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import tv  # noqa: E402
import server  # noqa: E402

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

    def test_force_stop_skips_bad_packages(self):
        t = tv.TV.__new__(tv.TV)
        t.id = "test_tv"
        t.paired = True
        calls = []

        async def ready():
            return True

        async def adb(*a, **k):
            calls.append(a)
            return ""

        t.adb, t.adb_ready = adb, ready
        asyncio.run(server._force_stop(t, [
            "com.netflix.ninja",
            "a.b;touch /sdcard/proof",
            "com.disney.disneyplus",
            None,
            "bad'name",
        ]))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], ("shell", "am", "force-stop", "com.netflix.ninja"))
        self.assertEqual(calls[1], ("shell", "am", "force-stop", "com.disney.disneyplus"))

    def test_keep_disabled_sanitization(self):
        raw_list = [
            "com.google.android.apps.tv.launcherx",
            "com.google.android.tvlauncher",
            "com.example.adtracker",
            "a.b;touch /sdcard/proof",
            None,
            123,
            "invalid..pkg",
        ]
        packages, to_enable = server._keep_disabled_lists(raw_list, "test_tv")
        self.assertEqual(to_enable, [
            "com.google.android.apps.tv.launcherx",
            "com.google.android.tvlauncher",
        ])
        self.assertEqual(packages, ["com.example.adtracker"])
        # Not a list (a hand edited file): nothing to do, no crash
        self.assertEqual(server._keep_disabled_lists({"a.b": 1}), ([], []))
        self.assertEqual(server._keep_disabled_lists("com.example.app"), ([], []))


if __name__ == "__main__":
    unittest.main()
