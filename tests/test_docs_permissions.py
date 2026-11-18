"""The README's permissions tables and couch-tv Studio section, and the links in the docs.

- Every permission and every bound service in the shipped Android manifests (tv-home, on-tv, sync)
  is explained in the README's "Android permissions, and why".
- The couch-tv Studio section says what the owner decided: couch-tv free and open source, Studio
  optional and not open source, the gallery takes 20%, with the Studio link.
- Every relative link in README.md and docs/*.md points at a file that exists, and every #anchor at
  a heading (GitHub's slug rules) or an <a name> in that file.
- The old name "TV Designer" is gone from the docs.

Run: python3 -m unittest tests/test_docs_permissions.py"""
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parents[1]
README = ROOT / "README.md"
A = "{http://schemas.android.com/apk/res/android}"
SHIPPED = [
    ROOT / "tv-home/android/app/src/main/AndroidManifest.xml",
    ROOT / "on-tv/android/app/src/main/AndroidManifest.xml",
    ROOT / "sync/android/app/src/main/AndroidManifest.xml",
]
STUDIO = "https://tvdesigner.sites.underseage.studio"


def section(text, title):
    m = re.search(r"^## " + re.escape(title) + r"\n(.*?)(?=^## )", text, re.S | re.M)
    return m.group(1) if m else ""


def slug(heading):
    s = heading.strip().lower()
    s = re.sub(r"[^\w\- ]", "", s)
    return s.replace(" ", "-")


def anchors(path):
    text = path.read_text(encoding="utf-8")
    out = set(re.findall(r'<a name="([^"]+)"', text))
    seen = {}
    in_code = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        m = None if in_code else re.match(r"^#{1,6} (.+)$", line)
        if m:
            base = slug(m.group(1))
            n = seen.get(base, 0)
            out.add(base if n == 0 else f"{base}-{n}")
            seen[base] = n + 1
    return out


def links(path):
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", "", text)
    found = re.findall(r"\]\(([^)\s]+)\)", text) + re.findall(r'href="([^"]+)"', text)
    return [l for l in found if not re.match(r"^[a-z]+:", l)]


class Permissions(unittest.TestCase):
    def setUp(self):
        self.text = section(README.read_text(encoding="utf-8"), "Android permissions, and why")
        self.assertTrue(self.text, "README has no 'Android permissions, and why' section")

    def test_every_permission_is_explained(self):
        missing = []
        for m in SHIPPED:
            for p in ET.parse(m).getroot().iter("uses-permission"):
                short = p.get(A + "name").rsplit(".", 1)[-1]
                if f"`{short}`" not in self.text:
                    missing.append(f"{m.relative_to(ROOT)}: {short}")
        self.assertEqual(missing, [])

    def test_every_bound_service_is_explained(self):
        missing = []
        for m in SHIPPED:
            for s in ET.parse(m).getroot().iter("service"):
                if (s.get(A + "permission") or "").startswith("android.permission.BIND_"):
                    name = s.get(A + "name").lstrip(".").rsplit(".", 1)[-1]
                    if f"`{name}`" not in self.text:
                        missing.append(f"{m.relative_to(ROOT)}: {name}")
        self.assertEqual(missing, [])

    def test_no_dashes(self):
        self.assertNotRegex(self.text, "[–—]")


class Studio(unittest.TestCase):
    def test_owner_wording(self):
        t = section(README.read_text(encoding="utf-8"), "couch-tv Studio (optional)")
        self.assertIn(STUDIO, t)
        self.assertIn("couch-tv stays free and open source", t)
        self.assertIn("its source is not open", t)
        self.assertIn("20%", t)
        self.assertIn("Off until you turn it on", t)
        self.assertNotRegex(t, "[–—]")
        self.assertNotIn("50", t)  # no minimum fee

    def test_no_old_name(self):
        hits = subprocess.run(["git", "-C", str(ROOT), "grep", "-n", "-i", "TV Designer", "--", "*.md"],
                              capture_output=True, text=True).stdout.strip()
        self.assertEqual(hits, "")


class Links(unittest.TestCase):
    def test_relative_links_and_anchors(self):
        broken = []
        for doc in [README] + sorted((ROOT / "docs").glob("*.md")):
            for link in links(doc):
                target, _, frag = link.partition("#")
                path = (doc.parent / target).resolve() if target else doc
                if not path.exists():
                    broken.append(f"{doc.relative_to(ROOT)}: {link} (no file)")
                    continue
                if frag and path.suffix == ".md" and frag not in anchors(path):
                    broken.append(f"{doc.relative_to(ROOT)}: {link} (no anchor)")
        self.assertEqual(broken, [])


if __name__ == "__main__":
    unittest.main()
