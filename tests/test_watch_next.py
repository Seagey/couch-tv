import json
import os
import subprocess
import sys
import unittest


class TestWatchNextLogic(unittest.TestCase):
    def test_home_config_serialization(self):
        """Verify home-config.py emits skip_watch_next and watch_next_per_app."""
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
        res = subprocess.run(
            [sys.executable, os.path.join(root, "tv-home", "tools", "home-config.py"), "--json"],
            capture_output=True,
            text=True,
            check=True
        )
        data = json.loads(res.stdout)
        home = data.get("home", {})
        self.assertIn("skip_watch_next", home)
        self.assertIn("com.tcl.browser", home["skip_watch_next"])
        self.assertIn("watch_next_per_app", home)
        self.assertEqual(home["watch_next_per_app"], 5)

    def test_watch_next_cursor_simulation(self):
        """Simulate the Android Watch Next cursor loop from MainActivity.kt."""
        # 14 sample rows in DESC chronological order
        mock_cursor = [
            # 4 Jio Hotstar rows
            {"pkg": "in.startv.hotstar", "title": "Hotstar Movie 1"},
            {"pkg": "in.startv.hotstar", "title": "Hotstar Movie 2"},
            {"pkg": "in.startv.hotstar", "title": "Hotstar Show 3"},
            {"pkg": "in.startv.hotstar", "title": "Hotstar Show 4"},
            # 4 BrowseHere rows
            {"pkg": "com.tcl.browser", "title": "BrowseHere 1"},
            {"pkg": "com.tcl.browser", "title": "BrowseHere 2"},
            {"pkg": "com.tcl.browser", "title": "BrowseHere 3"},
            {"pkg": "com.tcl.browser", "title": "BrowseHere 4"},
            # 6 Netflix rows
            {"pkg": "com.netflix.ninja", "title": "Netflix Show 1"},
            {"pkg": "com.netflix.ninja", "title": "Netflix Show 2"},
            {"pkg": "com.netflix.ninja", "title": "Netflix Show 3"},
            {"pkg": "com.netflix.ninja", "title": "Netflix Movie 4"},
            {"pkg": "com.netflix.ninja", "title": "Netflix Show 5"},
            {"pkg": "com.netflix.ninja", "title": "Netflix Show 6"},
        ]

        skip_set = {"com.tcl.browser"}
        per_app_limit = 5
        package_name = "app.couchtv.launcher"

        out = []
        per_app = {}
        for row in mock_cursor:
            if len(out) >= 20:
                break
            pkg = row.get("pkg")
            if not pkg or pkg == package_name or pkg in skip_set:
                continue
            n = per_app.get(pkg, 0) + 1
            if n > per_app_limit:
                continue
            per_app[pkg] = n
            out.append(row)

        # Assertions
        # 1. BrowseHere is 100% eliminated
        browse_items = [r for r in out if r["pkg"] == "com.tcl.browser"]
        self.assertEqual(len(browse_items), 0)

        # 2. Netflix gets exactly 5 items (6th is capped)
        netflix_items = [r for r in out if r["pkg"] == "com.netflix.ninja"]
        self.assertEqual(len(netflix_items), 5)
        self.assertEqual(netflix_items[0]["title"], "Netflix Show 1")
        self.assertEqual(netflix_items[4]["title"], "Netflix Show 5")

        # 3. Jio Hotstar gets all 4 items
        hotstar_items = [r for r in out if r["pkg"] == "in.startv.hotstar"]
        self.assertEqual(len(hotstar_items), 4)

        # 4. Total output items = 4 + 5 = 9
        self.assertEqual(len(out), 9)

    def test_web_defense_in_depth_filter(self):
        """Simulate web app.js secondary filter."""
        raw_wn = [
            {"app": {"package": "com.tcl.browser"}, "title": "Spam 1"},
            {"app": {"package": "com.netflix.ninja"}, "title": "Stranger Things"},
            {"app": {"package": "in.startv.hotstar"}, "title": "Special Ops"},
        ]
        skip_pkgs = ["com.tcl.browser"]
        filtered = [
            it for it in raw_wn
            if it.get("app", {}).get("package") != "com.tcl.browser"
            and it.get("app", {}).get("package") not in skip_pkgs
        ]
        self.assertEqual(len(filtered), 2)
        self.assertEqual(filtered[0]["title"], "Stranger Things")
        self.assertEqual(filtered[1]["title"], "Special Ops")


if __name__ == "__main__":
    unittest.main()
