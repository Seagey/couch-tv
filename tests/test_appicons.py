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


class FullBleed(unittest.TestCase):
    def png(self, draw):
        import io
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (100, 100), "white")
        draw(ImageDraw.Draw(im))
        out = io.BytesIO()
        im.save(out, "PNG")
        return out.getvalue()

    def corner(self, png):
        import io
        from PIL import Image
        return Image.open(io.BytesIO(png)).convert("RGB").getpixel((0, 0))

    def test_a_rounded_square_on_white_fills_its_square(self):
        rounded = self.png(lambda d: d.rounded_rectangle((0, 0, 99, 99), radius=22, fill=(20, 10, 60)))
        out = appicons.full_bleed(rounded)
        self.assertNotEqual(self.corner(out), (255, 255, 255), "no white corner left")

    def test_a_full_icon_and_a_logo_on_white_are_left_alone(self):
        logo = self.png(lambda d: d.ellipse((30, 30, 70, 70), fill=(250, 40, 70)))
        self.assertEqual(appicons.full_bleed(logo), logo)
        full = self.png(lambda d: [d.rectangle((0, 0, 99, 99), fill=(0, 120, 255)), d.rectangle((0, 0, 9, 9), fill="red")])
        self.assertEqual(appicons.full_bleed(full), full)


if __name__ == "__main__":
    unittest.main()
