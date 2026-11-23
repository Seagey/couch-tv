"""The on-TV setup page's Xiaomi card (on-tv/web/setup.html) names the watch APK.

Fable review of 0.13.3: the plain couch-tv-ontv.apk has no Home button watch (Play Protect), but the
PatchWall switch only said to switch the watch on in Accessibility, where it is not listed. The card
and its state line now say it is in couch-tv-ontv-watch.apk, from a computer.

Run: python3 -m unittest tests/test_ontv_setup_xiaomi.py
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class XiaomiCardTests(unittest.TestCase):
    def test_card_names_the_watch_apk(self):
        html = read("on-tv", "web", "setup.html")
        card = re.search(r'<section class="card" id="xiaomi".*?</section>', html, re.S).group(0)
        self.assertIn("couch-tv-ontv-watch.apk", card)

    def test_state_line_tells_the_plain_apk_to_install_the_watch_apk(self):
        html = read("on-tv", "web", "setup.html")
        line = html[html.index("$('pw-state')"):]
        line = line[:line.index(";\n")]
        self.assertIn("j.watch_apk", line)
        self.assertIn("couch-tv-ontv-watch.apk", line)

    def test_the_tv_says_which_apk_it_is(self):
        kt = read("on-tv", "android", "app", "src", "main", "java", "dev", "couchtv", "ontv", "Server.kt")
        # the GitHub watch APK, or the Google Play build (which has the watch inside, PlayRules.kt)
        self.assertIn('.put("watch_apk", BuildConfig.BUILD_TYPE == "watch" || Variant.play)', kt)


if __name__ == "__main__":
    unittest.main()
