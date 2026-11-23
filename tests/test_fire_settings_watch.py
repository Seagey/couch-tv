"""Fire TV Settings must stay open under the Home button watch (issues #75, #123).

The watch is Kotlin on the TV, so this checks the source for the pieces that keep Settings open:
Amazon's Settings screens are not "home", the Settings tile opens Fire OS Settings by name, and
opening Settings tells the watch for a few seconds that Amazon's home coming forward is us.
"""
import pathlib, re, unittest

SRC = pathlib.Path(__file__).resolve().parent.parent / "tv-home/android/app/src/main/java/app/couchtv/launcher"
WATCH = (SRC / "FireWatch.kt").read_text()
MAIN = (SRC / "MainActivity.kt").read_text()


class FireSettingsWatch(unittest.TestCase):
    def test_amazon_settings_screens_are_not_home(self):
        rule = WATCH.split('AMAZON_HOME ->', 1)[1].split('\n', 1)[0]
        self.assertIn('HomeActivity_vNext', rule)
        self.assertNotIn('contains("Settings")', rule)

    def test_settings_opened_by_name(self):
        self.assertIn('AMAZON_HOME.ui.MainSettingsActivity', WATCH)
        self.assertIn("FireWatch.amazonSettings(packageManager) ?: Intent(Settings.ACTION_SETTINGS)", MAIN)

    def test_settings_tile_package_goes_by_name_on_fire(self):
        body = MAIN.split("private fun launchPackage", 1)[1].split("val i =", 1)[0]
        self.assertIn('"com.android.tv.settings"', body)
        self.assertIn("AMAZON_SETTINGS_PKG", body)
        self.assertIn("startSettings", body)

    def test_every_settings_entry_point_tells_the_watch(self):
        self.assertNotRegex(MAIN, r"(?<!fun )\bstart\(tvSettingsIntent\(\)\)")
        self.assertIn("FireWatch.allowSettingsNow()", MAIN)

    def test_grace_only_spares_amazon_windows(self):
        self.assertRegex(WATCH, r"pkg == AMAZON_HOME && settingsAllowed\(\)")


if __name__ == "__main__":
    unittest.main()
