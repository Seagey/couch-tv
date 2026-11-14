"""lg/build.py writes plain values before var() for webOS 3.x (Chrome 38 has no CSS variables)."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "lg"))
import build

CSS = """:root { --safe-x: 5rem; --ease: ease; --tint: red; }
.top { left: var(--safe-x); right: var(--safe-x); top: calc(var(--safe-x) + 1rem); }
.a { transition: opacity 1s var(--ease); }
.b { color: var(--kid); background: var(--tint); }
.c { --tint: blue; }
"""


class CssVarFallbacks(unittest.TestCase):
    def test_constants_get_a_plain_value_first(self):
        out = build.css_var_fallbacks(CSS)
        self.assertIn("left: 5rem; left: var(--safe-x);", out)
        self.assertIn("top: calc(5rem + 1rem); top: calc(var(--safe-x) + 1rem);", out)
        self.assertIn("transition: opacity 1s ease; transition: opacity 1s var(--ease);", out)

    def test_runtime_and_overridden_vars_are_left_alone(self):
        out = build.css_var_fallbacks(CSS)
        self.assertIn(".b { color: var(--kid); background: var(--tint); }", out)   # --kid set by JS, --tint redefined

    def test_real_app_css_keeps_every_var(self):
        css = (Path(__file__).parents[1] / "tv-home" / "web" / "app.css").read_text()
        out = build.css_var_fallbacks(css)
        self.assertEqual(out.count("var("), css.count("var("))
        self.assertIn("top: 3.75rem; top: var(--safe-y);", out)


if __name__ == "__main__":
    unittest.main()
