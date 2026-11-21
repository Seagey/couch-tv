"""Icon packs and your own app icons (social report g24, two people asked).

home.icon_set (config.json) or Home settings, Look, Icon style picks how the home's own tiles (Settings,
More apps, Inputs, Screens) are drawn, from the icon sets in tv-home/web/icon-sets.js. The bridge must
keep the choice in its copy of Home settings, or the TV takes the copy back without it (as g31's quick
buttons were lost). Your own app icons already came in 0.13 (tv-home/tools/app-icons.sh).
"""
import os
import re
import sys
import unittest

ROOT = os.environ.get("COUCHTV_ROOT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import server  # noqa: E402


def icon_set_styles():
    src = open(os.path.join(ROOT, "tv-home", "web", "icon-sets.js"), encoding="utf-8").read()
    block = src[src.index("var STYLES = ["):]
    block = block[:block.index("];")]
    return re.findall(r'id: "([a-z]+)"', block)


class IconSet(unittest.TestCase):
    def test_every_style_in_the_sets_is_accepted(self):
        self.assertEqual(sorted(config.ICON_SETS), sorted(icon_set_styles() + ["builtin"]))

    def test_config_home(self):
        self.assertEqual(config._home({"icon_set": "solid"})["icon_set"], "solid")
        self.assertNotIn("icon_set", config._home({"icon_set": "comic sans"}))
        self.assertNotIn("icon_set", config._home({}))

    def test_home_settings_copy_keeps_it(self):
        self.assertEqual(server.clean_settings({"icon_set": "tile"})["icon_set"], "tile")
        self.assertEqual(server.clean_settings({"icon_set": "builtin"})["icon_set"], "builtin")
        self.assertNotIn("icon_set", server.clean_settings({"icon_set": "../x"}))


class OwnIcons(unittest.TestCase):
    def test_own_app_icons_are_the_0_13_tool(self):
        # your own app icons came in 0.13 (tv-home/tools/app-icons.sh copies a folder named by package to
        # the TV); g24 adds the icon packs and leaves that as it is
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "tv-home", "tools", "app-icons.sh")))
        self.assertIn("## Your own app icons", open(os.path.join(ROOT, "docs", "TV-HOME.md"), encoding="utf-8").read())


if __name__ == "__main__":
    unittest.main()
