"""Words a beginner reads in Setup, from the emulator beginner test of 28 Nov 2026 (coord emu-test-1128/REPORT.md):
the step counter on a card matches the header, and the Allow USB debugging picture shows both buttons and says how
to reach Allow, because on Google TV pressing Down from the tick lands on Cancel."""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "couchtv_setup", "web")


def read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


class StepCounter(unittest.TestCase):
    def test_every_step_line_matches_the_header(self):
        html, js = read("index.html"), read("app.js")
        stages = len(re.findall(r'id="st-\d"', html))
        stage_of = {"done": 2, "extras": 2, "helper-on": 2}
        m = re.search(r"var STAGE = (\{[^}]*\})", js)
        self.assertIsNotNone(m)
        for k, v in re.findall(r'"?([\w-]+)"?: (\d)', m.group(1)):
            stage_of[k] = int(v)
        found = 0
        for step, body in re.findall(r'<section data-step="([\w-]+)"[^>]*>(.*?)</section>', html, re.S):
            for x, y in re.findall(r"Step (\d+) of (\d+)", body):
                found += 1
                self.assertEqual(int(y), stages, step)
                self.assertEqual(int(x), stage_of.get(step, 1) + 1, step)
        self.assertGreaterEqual(found, 1)


class AllowPicture(unittest.TestCase):
    def test_both_buttons_and_how_to_reach_allow(self):
        html = read("index.html")
        allow = re.search(r'<section data-step="allow".*?</section>', html, re.S).group(0)
        self.assertIn('class="lit">Allow<', allow)
        self.assertIn('class="off">Cancel<', allow)
        self.assertRegex(allow, r"Press Down, then Left, so <b>Allow</b> is lit")
        self.assertIn("not Cancel", allow)
        self.assertIn("then press Allow on the TV, not Cancel", read("app.js"))


class GatePolish(unittest.TestCase):
    """The 0.13.15 gate's polish list: no text walls on the fallback screens, plain Finish names."""

    def test_fallback_screens_say_it_in_short_lines(self):
        import html as h
        page = read("index.html")
        for step in ("fix-home", "fix-toggle", "fix-revoke", "fix-restart", "phone-route", "undo"):
            body = re.search(r'<section data-step="%s".*?</section>' % step, page, re.S).group(0)
            body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
            text = h.unescape(re.sub(r"<br>|</li>|</p>|</h1>", "\n", body))
            text = re.sub(r"<[^>]+>", "", text)
            for line in text.split("\n"):
                for sentence in re.split(r"(?<=[.?!])\s+", line.strip()):
                    self.assertLessEqual(len(sentence.split()), 14, (step, sentence))

    def test_finish_names_say_what_they_do(self):
        page, js = read("index.html"), read("app.js")
        self.assertNotIn("Keep this one", page + js)
        self.assertNotIn("Check it again", page + js)
        self.assertIn(">Check the TV again<", page)
        self.assertIn('$("close-top").hidden = step === "closed"', js)

    def test_header_stays_one_row_up_to_1500(self):
        css = read("style.css")
        self.assertRegex(css, r"@media \(min-width: 1101px\) and \(max-width: 1500px\) \{\s*\.top \{ flex-wrap: nowrap; \}")
        self.assertIn("@media (min-width: 1101px) and (max-height: 820px)", css)


if __name__ == "__main__":
    unittest.main()
