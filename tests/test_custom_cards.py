"""Custom cards (home.custom_cards, idea from geissmannz on Instagram): display only, capped, off by default."""
import asyncio
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import custom_cards


class CleanTests(unittest.TestCase):
    def test_a_full_card(self):
        out = custom_cards.clean({"cards": [{"title": "Solar today", "subtitle": "Roof panels", "value": "18.4 kWh",
                                             "image": "https://example.com/sun.png", "app": "com.example.solar"}]})
        self.assertEqual(out, [{"title": "Solar today", "subtitle": "Roof panels", "value": "18.4 kWh",
                                "image": "https://example.com/sun.png", "app": "com.example.solar"}])

    def test_a_bare_list_works(self):
        self.assertEqual(custom_cards.clean([{"title": "Bins"}]), [{"title": "Bins"}])

    def test_rubbish_gives_nothing(self):
        for data in (None, "x", 3, {"cards": "x"}, {"cards": {"title": "a"}}, [None, 1, "a", [], {"value": "no title"}]):
            with self.subTest(data=data):
                self.assertEqual(custom_cards.clean(data), [])

    def test_capped_at_eight(self):
        out = custom_cards.clean([{"title": f"Card {i}"} for i in range(30)])
        self.assertEqual(len(out), custom_cards.MAX_CARDS)
        self.assertEqual(out[-1]["title"], "Card 7")

    def test_text_is_trimmed_and_capped(self):
        out = custom_cards.clean([{"title": "T" * 500, "subtitle": "S" * 500, "value": "V" * 500}])[0]
        self.assertEqual(len(out["title"]), custom_cards.TITLE_MAX)
        self.assertEqual(len(out["subtitle"]), custom_cards.SUBTITLE_MAX)
        self.assertEqual(len(out["value"]), custom_cards.VALUE_MAX)
        self.assertEqual(custom_cards.clean([{"title": "a\nb\x00c", "value": 21.5}])[0], {"title": "a b c", "value": "21.5"})
        self.assertEqual(custom_cards.clean([{"title": True}, {"title": {"x": 1}}]), [])

    def test_html_stays_text(self):
        # the bridge keeps the characters; the TV sets them with textContent, so they show as typed
        out = custom_cards.clean([{"title": "<img src=x onerror=alert(1)>"}])
        self.assertEqual(out[0]["title"], "<img src=x onerror=alert(1)>")

    def test_only_http_links(self):
        bad = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "file:///etc/passwd",
               "intent://x#Intent;end", "https://a.b/x'; reboot'", "https://a.b/$(reboot)", "https://a.b/`id`",
               "https://a.b/x y", "//a.b/x", "https://" + "a" * 2000]
        for u in bad:
            with self.subTest(url=u):
                out = custom_cards.clean([{"title": "t", "url": u, "image": u}])[0]
                self.assertNotIn("url", out)
                self.assertNotIn("image", out)
        out = custom_cards.clean([{"title": "t", "url": "https://example.com/a?b=1", "image": "http://raspberrypi:8080/a.png"}])[0]
        self.assertEqual(out["url"], "https://example.com/a?b=1")
        self.assertEqual(out["image"], "http://raspberrypi:8080/a.png")

    def test_app_must_be_a_package(self):
        for app in ("com.x; reboot", "x", "com.x'", "1com.x", "com..x", "a" * 300 + ".b", 5):
            with self.subTest(app=app):
                self.assertNotIn("app", custom_cards.clean([{"title": "t", "app": app}])[0])
        # a good app wins over a url
        out = custom_cards.clean([{"title": "t", "app": "com.netflix.ninja", "url": "https://x.y"}])[0]
        self.assertEqual(out.get("app"), "com.netflix.ninja")
        self.assertNotIn("url", out)


class SourceAndConfigTests(unittest.TestCase):
    def test_off_by_default(self):
        self.assertNotIn("custom_cards", config._home({}))
        for v in (None, "", "  ", 5, True, ["a"], "ftp://x/y.json", "javascript:alert(1)"):
            with self.subTest(v=v):
                self.assertNotIn("custom_cards", config._home({"custom_cards": v}))

    def test_a_link_is_passed_on(self):
        self.assertEqual(config._home({"custom_cards": "https://raw.githubusercontent.com/a/b/main/cards.json"})["custom_cards"],
                         "https://raw.githubusercontent.com/a/b/main/cards.json")

    def test_a_file_path_never_reaches_the_tv(self):
        self.assertIs(config._home({"custom_cards": "/srv/couch/cards.json"})["custom_cards"], True)

    def test_relative_file_is_beside_config(self):
        self.assertEqual(custom_cards.source("cards.json", "/srv/couch"), ("file", "/srv/couch/cards.json"))
        self.assertEqual(custom_cards.source("http://raspberrypi/c.json", "/x"), ("url", "http://raspberrypi/c.json"))


class GetTests(unittest.TestCase):
    def setUp(self):
        custom_cards._cache.update(at=0.0, cards=[])
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "cards.json")

    def tearDown(self):
        self.dir.cleanup()
        custom_cards._cache.update(at=0.0, cards=[])

    def write(self, text):
        with open(self.path, "w") as f:
            f.write(text)

    def get(self, now):
        return asyncio.run(custom_cards.get(("file", self.path), now=now))

    def test_reads_caches_and_keeps_last_good(self):
        self.assertEqual(asyncio.run(custom_cards.get(None)), [])
        self.write(json.dumps({"cards": [{"title": "A"}]}))
        self.assertEqual(self.get(1000), [{"title": "A"}])
        self.write(json.dumps({"cards": [{"title": "B"}]}))
        self.assertEqual(self.get(1010), [{"title": "A"}])          # within a minute: the cached answer
        self.assertEqual(self.get(1100), [{"title": "B"}])
        self.write("{not json")
        self.assertEqual(self.get(1200), [{"title": "B"}])          # a bad file keeps the last good cards
        os.remove(self.path)
        self.assertEqual(self.get(1300), [{"title": "B"}])          # so does a missing one
        self.write(" " * (custom_cards.MAX_BYTES + 10))
        self.assertEqual(self.get(1400), [{"title": "B"}])          # and one too big

    def test_a_bad_file_from_the_start_shows_nothing(self):
        self.write("<html>oops</html>")
        self.assertEqual(self.get(1000), [])


if __name__ == "__main__":
    unittest.main()
