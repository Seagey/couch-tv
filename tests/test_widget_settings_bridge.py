"""Each widget's own settings (ST.widgets) survive the bridge's copy of Home settings.

Every bridge TV (Samsung, LG and the other web TVs) hands Home settings to the bridge and takes its copy
back. clean_settings dropped `widgets`, so the copy wiped every widget's settings and the home started
again. They are kept now, checked: widget keys "<id>|<kind>", setting names, and values the TV writes.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import server


class WidgetSettingsBridgeTests(unittest.TestCase):
    def test_kept(self):
        w = {"s|surf": {"place": {"name": "Bells Beach", "area": "Victoria", "lat": -38.3683, "lon": 144.2817, "timezone": "Australia/Melbourne"}, "units": "ft"},
             "n|news": {"feed": "bbc", "count": 3}, "st/0|stocks": {"tickers": ["BHP.AX", "^AXJO"], "price": False}}
        out = server.clean_settings({"widgets": w})["widgets"]
        self.assertEqual(out["s|surf"]["place"], {"name": "Bells Beach", "area": "Victoria", "lat": -38.37, "lon": 144.28, "timezone": "Australia/Melbourne"})
        self.assertEqual(out["s|surf"]["units"], "ft")
        self.assertEqual(out["n|news"], {"feed": "bbc", "count": 3})
        self.assertEqual(out["st/0|stocks"], {"tickers": ["BHP.AX", "^AXJO"], "price": False})

    def test_absent_stays_absent(self):
        self.assertNotIn("widgets", server.clean_settings({}))
        self.assertNotIn("widgets", server.clean_settings({"widgets": "x"}))

    def test_bad_keys_and_values_dropped(self):
        w = {"bad key|surf": {"place": "x"}, "a|Surf": {"x": 1}, "a|surf": {"bad name": 1, "ok": 1, "nan": float("nan"), "long": "x" * 601,
             "list": list(range(17)), "obj": {"no": "place"}, "deep": [{"a": 1}]}, "b|news": "not a dict"}
        out = server.clean_settings({"widgets": w})["widgets"]
        self.assertEqual(out, {"a|surf": {"ok": 1}})
        # every number in a list is finite too
        self.assertEqual(server.clean_settings({"widgets": {"b|stocks": {"tickers": ["BHP.AX", float("inf")]}}})["widgets"], {})

    def test_limits(self):
        w = {"w%d|news" % i: {"feed": "abc"} for i in range(80)}
        self.assertEqual(len(server.clean_settings({"widgets": w})["widgets"]), 60)
        one = {"a|news": {"k%d" % i: i for i in range(30)}}
        self.assertEqual(len(server.clean_settings({"widgets": one})["widgets"]["a|news"]), 16)

    def test_base_kept(self):
        # what the design said for each design-kept setting (app.js wsNewDesign): kept, so a resend that
        # changes one choice drops only that override
        b = {"k|clock": {"format": "v1a2b3c"}, "n|news": {"feed": "vzz9"}}
        self.assertEqual(server.clean_settings({"widgets_base": b})["widgets_base"], b)
        self.assertNotIn("widgets_base", server.clean_settings({}))


if __name__ == "__main__":
    unittest.main()
