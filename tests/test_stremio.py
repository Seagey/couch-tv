"""Stremio in Keep watching: the Continue Watching rule, and the key apply.sh hands the TV app.

Stremio puts nothing in Android's Watch Next list, so the TV home app reads Stremio's own Continue
Watching from the household's Stremio account instead (Stremio.kt, scripts/stremio-link.py,
docs/CONFIG.md). Seen on an onn 4K Pro (Android 14) with Stremio 1.12.1: Keep watching showed the
other apps' shows and never Stremio's.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).parents[1]
_spec = importlib.util.spec_from_file_location("stremio_link", ROOT / "scripts" / "stremio-link.py")
link = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(link)


def item(name, offset=60_000, last="2026-11-10T02:58:12.979029754Z", **kw):
    """A library item as api.strem.io's datastoreGet returns it (only the fields the rule reads)."""
    it = {"_id": "tt" + str(sum(map(ord, name))), "name": name, "type": "series",
          "removed": False, "temp": False, "_mtime": "2026-01-01T00:00:00.000Z",
          "state": {"timeOffset": offset, "duration": 1_300_000, "lastWatched": last,
                    "video_id": None, "season": 0, "episode": 0}}
    it.update(kw)
    return it


class ContinueWatching(unittest.TestCase):
    def names(self, items):
        return [it["name"] for it in link.pick(items)]

    def test_part_way_items_come_newest_first(self):
        items = [item("Older", last="2026-10-21T06:42:32.056604872Z"),
                 item("Newest", last="2026-11-10T02:58:12.979029754Z"),
                 item("Middle", last="2026-11-08T13:01:29.461919443Z")]
        self.assertEqual(self.names(items), ["Newest", "Middle", "Older"])

    def test_no_last_watched_falls_back_to_when_the_item_changed(self):
        items = [item("Watched", last="2026-11-01T00:00:00Z"),
                 item("Never", last=None, _mtime="2026-11-05T00:00:00Z")]
        self.assertEqual(self.names(items), ["Never", "Watched"])

    def test_not_started_or_finished_items_are_left_out(self):
        self.assertEqual(self.names([item("Not started", offset=0), item("Started")]), ["Started"])

    def test_removed_items_are_left_out_unless_temporary(self):
        items = [item("Removed", removed=True), item("Temporary", removed=True, temp=True)]
        self.assertEqual(self.names(items), ["Temporary"])

    def test_other_types_are_left_out(self):
        self.assertEqual(self.names([item("A channel", type="other"), item("A film", type="movie")]),
                         ["A film"])

    def test_nothing_from_stremio_is_an_empty_row(self):
        self.assertEqual(link.pick(None), [])
        self.assertEqual(link.pick([]), [])


class KeyForTheTv(unittest.TestCase):
    """home-config.py --stremio: what apply.sh hands the app ("stremio_b64"), never the key in clear."""

    def run_home_config(self, key, *args):
        env = dict(os.environ, COUCH_CONFIG=str(ROOT / "config.example.json"), STREMIO_AUTH_KEY=key)
        return subprocess.run([sys.executable, str(ROOT / "tv-home" / "tools" / "home-config.py"), "--stremio", *args],
                              env=env, capture_output=True, text=True, check=True, cwd=str(ROOT)).stdout.strip()

    def test_a_key_goes_over_as_base64_json(self):
        key = "Qm9n" * 10 + "Ab-=" # Stremio's keys are base64, with "=" padding
        out = self.run_home_config(key)
        self.assertNotIn(key, out)
        self.assertEqual(json.loads(base64.b64decode(out)), {"authKey": key})
        self.assertEqual(self.run_home_config(key, "--check"), "stremio: on")

    def test_no_key_or_a_bad_one_switches_it_off(self):
        for key in ("", "short", "has a space " + "a" * 20, 'a quote" ' + "a" * 20):
            with self.subTest(key=key):
                self.assertEqual(self.run_home_config(key), "none")
                self.assertEqual(self.run_home_config(key, "--check"), "stremio: off")

    def test_the_link_script_accepts_the_same_keys(self):
        self.assertTrue(link.KEY.fullmatch("Qm9n" * 10 + "Ab-="))
        self.assertFalse(link.KEY.fullmatch("short"))


if __name__ == "__main__":
    unittest.main()
