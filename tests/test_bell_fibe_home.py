"""Bell Streamer: Fibe TV is the home (issue #168).

The watch is Kotlin on the TV, so this checks the source: Fibe is a stock home, only its HOME
activity counts, opening it from couch-tv is spared, and apply.sh switches the watch on for it
and never switches Fibe off.
"""
import pathlib, re, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tv-home/android/app/src/main/java/app/couchtv/launcher"
WATCH = (SRC / "FireWatch.kt").read_text()
MAIN = (SRC / "MainActivity.kt").read_text()
APPLY = (ROOT / "tv-home/tools/apply.sh").read_text()
FIBE = "com.quickplay.android.bellmediaplayer"


class BellFibeHome(unittest.TestCase):
    def test_constant_and_stock_homes(self):
        self.assertIn(f'BELL_FIBE_HOME = "{FIBE}"', WATCH)
        line = re.search(r"STOCK_HOMES = listOf\((.*)\)", WATCH).group(1)
        self.assertIn("BELL_FIBE_HOME", line)

    def test_only_the_home_activity_counts(self):
        rule = WATCH.split("BELL_FIBE_HOME ->", 1)[1].split("\n", 1)[0]
        self.assertIn("BELL_FIBE_ACTIVITY", rule)
        self.assertIn("cls in homes", rule)
        self.assertIn('"ca.bell.fiberemote.tv.MainTvActivity"', WATCH)

    def test_fibe_opened_from_couch_tv_is_left_alone(self):
        self.assertRegex(WATCH, r"pkg == BELL_FIBE_HOME && fibeOpenedOnPurpose")
        body = MAIN.split("private fun launchPackage", 1)[1].split("private fun start", 1)[0]
        self.assertIn("FireWatch.fibeOpenedNow()", body)

    def test_apply_switches_the_watch_on_for_fibe(self):
        line = next(l for l in APPLY.splitlines() if l.startswith('if echo "$present" | grep -qx -E'))
        self.assertIn(FIBE, line)

    def test_apply_never_switches_fibe_off(self):
        line = next(l for l in APPLY.splitlines() if l.startswith("NEVER_OFF="))
        self.assertIn(FIBE, line)


if __name__ == "__main__":
    unittest.main()
