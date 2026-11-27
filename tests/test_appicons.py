"""Icons for a Samsung's apps couch-tv has no logo for (bridge/appicons.py): only the app with that name
counts, so a tile never shows another app's icon.

Run: python3 -m unittest tests/test_appicons.py
"""
import os
import sys
import tempfile
import unittest

os.environ.setdefault("COUCH_DATA", tempfile.mkdtemp(prefix="couchtv-icons-"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import appicons  # noqa: E402

ART = "https://is1-ssl.mzstatic.com/image/thumb/Purple/v4/ab/{}/AppIcon.png/512x512bb.jpg"


def app(name, art):
    return {"trackName": name, "artworkUrl512": ART.format(art)}


class Pick(unittest.TestCase):
    def test_the_same_name_first_then_one_that_starts_with_it(self):
        found = [app("Google Workspace", "gw"), app("Perplexity - Ask Anything", "px"), app("Perplexity", "p")]
        self.assertEqual(appicons.pick(found, "Perplexity"), ART.format("p")[:-len("512x512bb.jpg")] + "256x256bb.png")
        self.assertIn("/px/", appicons.pick(found[:2], "perplexity"))
        self.assertIn("/px/", appicons.pick(found[:2], "Perplexity-"), "spaces and dashes do not count")

    def test_another_app_is_never_taken(self):
        self.assertIsNone(appicons.pick([app("Google Workspace", "gw")], "Workspace"))
        self.assertIsNone(appicons.pick([app("Sony LIV", "s")], ""))
        self.assertIsNone(appicons.pick([{"trackName": "JioHotstar", "artworkUrl512": "http://x/a.jpg"}], "JioHotstar"))

    def test_two_words_may_sit_inside_the_store_name(self):
        self.assertIn("/ax/", appicons.pick([app("Airtel Xstream Play: Movies", "ax")], "Xstream Play"))
        self.assertIsNone(appicons.pick([app("Google Workspace", "gw")], "Workspace"))

    def test_a_name_with_a_store_tagline_is_also_tried_without_it(self):
        self.assertEqual(appicons.names("ZEE5 - Movies, Shows, LiveTV, Originals and Sports"),
                         ["ZEE5 - Movies, Shows, LiveTV, Originals and Sports", "ZEE5"])
        self.assertEqual(appicons.names("Perplexity"), ["Perplexity"])


if __name__ == "__main__":
    unittest.main()
