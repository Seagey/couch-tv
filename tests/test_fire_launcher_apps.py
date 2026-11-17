"""Fire TV apps with no LEANBACK_LAUNCHER (like Audible, issue #238, and Appstore, issue #169).

Fire OS apps do not always declare CATEGORY_LEANBACK_LAUNCHER.
This test verifies:
1. Manifests declare known Fire TV LAUNCHER packages under <queries> for Android 11+ (Fire OS 8).
2. App list resolution in tv-home (MainActivity.kt) and on-tv (Tv.kt) queries known Fire TV
   LAUNCHER apps and packages saved in app order.
3. on-tv Server.kt appOrder() resolves installed apps from order even before home-apps.json updates.
4. bridge/apps.py and on-tv Apps.kt register Audible.
5. bridge/server.py effective_order() preserves apps placed in app-order.
"""
import os
import pathlib
import re
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
TV_HOME_SRC = ROOT / "tv-home/android/app/src/main"
ON_TV_SRC = ROOT / "on-tv/android/app/src/main"
BRIDGE_SRC = ROOT / "bridge"


class FireLauncherAppsTests(unittest.TestCase):
    def test_manifest_queries_include_audible_and_appstore(self):
        """Android 11+ (Fire OS 8) requires <queries> to see packages not matching queried intents."""
        for path in [
            TV_HOME_SRC / "AndroidManifest.xml",
            ON_TV_SRC / "AndroidManifest.xml",
        ]:
            text = path.read_text(encoding="utf-8")
            queries_section = text.split("<queries>", 1)[1].split("</queries>", 1)[0]
            self.assertIn(
                'package android:name="com.amazon.venezia"',
                queries_section,
                f"Missing com.amazon.venezia in {path}",
            )
            self.assertIn(
                'package android:name="com.audible.application.firetv"',
                queries_section,
                f"Missing com.audible.application.firetv in {path}",
            )

    def test_tv_home_queries_known_and_ordered_launcher_apps(self):
        """tv-home appList() queries LEANBACK_LAUNCHER, known Fire apps, and saved order packages."""
        main_kt = (TV_HOME_SRC / "java/app/couchtv/launcher/MainActivity.kt").read_text(encoding="utf-8")
        # appList() hands out the cached list; buildAppList(), right after it, does the reading
        app_list = main_kt.split("private fun appList()", 1)[1].split("private fun warmApps()", 1)[0]
        self.assertIn("CATEGORY_LEANBACK_LAUNCHER", app_list)
        self.assertIn("com.amazon.venezia", app_list)
        self.assertIn("com.audible.application.firetv", app_list)
        self.assertIn("CATEGORY_LAUNCHER", app_list)
        self.assertIn("tvhome.order.tv", app_list)

    def test_on_tv_queries_known_and_ordered_launcher_apps(self):
        """on-tv Tv.kt queries LEANBACK_LAUNCHER, known Fire apps, and saved order packages."""
        tv_kt = (ON_TV_SRC / "java/dev/couchtv/ontv/Tv.kt").read_text(encoding="utf-8")
        self.assertIn("LAUNCHER_ONLY", tv_kt)
        self.assertIn('"com.amazon.venezia"', tv_kt)
        self.assertIn('"com.audible.application.firetv"', tv_kt)
        self.assertIn("app-order.json", tv_kt)
        self.assertIn("CATEGORY_LAUNCHER", tv_kt)

    def test_on_tv_server_app_order_resolves_packages_not_in_home_apps(self):
        """Server.kt appOrder() checks package manager so POST /api/app-order doesn't drop apps."""
        server_kt = (ON_TV_SRC / "java/dev/couchtv/ontv/Server.kt").read_text(encoding="utf-8")
        app_order = server_kt.split("private fun appOrder(): JSONObject", 1)[1].split("private fun", 1)[0]
        self.assertIn("CATEGORY_LAUNCHER", app_order)
        self.assertIn("CATEGORY_LEANBACK_LAUNCHER", app_order)
        self.assertIn("resolveActivity", app_order)

    def test_audible_registered_in_apps_tables(self):
        """Audible is registered in on-tv Apps.kt and bridge/apps.py."""
        ontv_apps = (ON_TV_SRC / "java/dev/couchtv/ontv/Apps.kt").read_text(encoding="utf-8")
        self.assertIn('"audible"', ontv_apps)
        self.assertIn('"com.audible.application.firetv"', ontv_apps)

        bridge_apps = (BRIDGE_SRC / "apps.py").read_text(encoding="utf-8")
        self.assertIn('"audible"', bridge_apps)
        self.assertIn('"com.audible.application.firetv"', bridge_apps)

    def test_bridge_effective_order_preserves_known_apps(self):
        """effective_order() in bridge/server.py retains known apps in order even before home-apps sync."""
        import sys
        if str(BRIDGE_SRC) not in sys.path:
            sys.path.insert(0, str(BRIDGE_SRC))
        import server, store

        with tempfile.TemporaryDirectory() as td:
            old_data = store.DATA
            try:
                store.DATA = td
                server._current.set("test_tv")
                apps_path = os.path.join(td, "home-apps.test_tv.json")
                order_path = os.path.join(td, "app-order.test_tv.json")

                # home-apps only has Netflix and Prime Video initially
                store._write(apps_path, {
                    "apps": [
                        {"package": "com.netflix.ninja", "name": "Netflix"},
                        {"package": "com.amazon.amazonvideo.livingroom", "name": "Prime Video"},
                    ],
                    "line": 2,
                })

                # app-order adds Audible to the dock in second place with line=3
                store._write(order_path, {
                    "order": [
                        "com.netflix.ninja",
                        "com.audible.application.firetv",
                        "com.amazon.amazonvideo.livingroom",
                    ],
                    "line": 3,
                })

                listed, line, saved = server.effective_order()
                self.assertTrue(saved)
                self.assertEqual(line, 3, "Dock line count must not drop by one when Audible is in order")
                pkgs = [a["package"] for a in listed]
                self.assertIn("com.audible.application.firetv", pkgs)
                self.assertEqual(pkgs[:3], [
                    "com.netflix.ninja",
                    "com.audible.application.firetv",
                    "com.amazon.amazonvideo.livingroom",
                ])
                audible_entry = next(a for a in listed if a["package"] == "com.audible.application.firetv")
                self.assertEqual(audible_entry["name"], "Audible")
            finally:
                store.DATA = old_data


if __name__ == "__main__":
    unittest.main()
