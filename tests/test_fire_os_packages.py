"""Fire OS package names (bridge/apps.py "packages", server.pkg_of): on a Fire TV the same apps are
Amazon's builds under other package names (seen on a Fire TV Cube, Fire OS 7.7), and the bridge has to
open, watch and card the build the TV has. A Google TV with the usual packages behaves as before."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).parents[1]
# The repo's example settings, not the owner's config.json (see tests/test_plex_keep_watching.py).
os.environ["COUCH_CONFIG"] = str(ROOT / "config.example.json")
os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-fireos-")
sys.path.insert(0, str(ROOT / "bridge"))
import apps  # noqa: E402
import config  # noqa: E402
import store  # noqa: E402
import server  # noqa: E402

FIRE_YOUTUBE = "com.amazon.firetv.youtube"
FIRE_PRIME = "com.amazon.firebat"
FIRE_HBO = "com.hbo.hbonow"
GOOGLE_YOUTUBE = "com.google.android.youtube.tv"
# What `pm list packages` on the Cube had of the apps the bridge knows (and nothing of Google's builds)
ON_THE_CUBE = {FIRE_YOUTUBE, FIRE_PRIME, FIRE_HBO, "com.plexapp.android", "com.amazon.tv.settings.v2",
               "app.couchtv.launcher"}
ON_A_GOOGLE_TV = {GOOGLE_YOUTUBE, "com.amazon.amazonvideo.livingroom", "com.wbd.stream", "com.netflix.ninja"}
NOW = datetime.now(timezone.utc)


class TheTable(unittest.TestCase):
    def test_the_alternates_are_known_packages(self):
        for pkg, app_id in ((FIRE_YOUTUBE, "youtube"), (FIRE_PRIME, "prime-video"), (FIRE_HBO, "hbo-max"),
                            ("com.amazon.tv.settings.v2", "settings")):
            self.assertEqual(apps.BY_PACKAGE[pkg]["id"], app_id, pkg)
        # the Google TV one stays the canonical package
        self.assertEqual(apps.BY_ID["youtube"]["package"], GOOGLE_YOUTUBE)
        self.assertEqual(apps.BY_PACKAGE[GOOGLE_YOUTUBE]["id"], "youtube")

    def test_describe_package_of_an_alternate_is_the_app_with_the_package_asked_about(self):
        got = apps.describe_package(FIRE_YOUTUBE)
        self.assertEqual(got, {"id": "youtube", "name": "YouTube", "package": FIRE_YOUTUBE})
        self.assertEqual(apps.describe_package(FIRE_PRIME)["id"], "prime-video")
        # so the watch loop no longer takes Amazon's YouTube for an unknown app and skips it
        self.assertNotIn(got["id"], server.NOT_VIEWING)
        self.assertIsNone(apps.describe_package("com.amazon.bueller.music")["id"])   # still unknown

    def test_public_lists_the_packages_only_where_there_are_alternates(self):
        yt = apps.public(apps.BY_ID["youtube"])
        self.assertEqual(yt["package"], GOOGLE_YOUTUBE)
        self.assertEqual(yt["packages"], [GOOGLE_YOUTUBE, FIRE_YOUTUBE])
        self.assertNotIn("packages", apps.public(apps.BY_ID["netflix"]))


class OnATV(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._people = (config.PEOPLE, config.PEOPLE_IDS)
        config.PEOPLE = [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}]
        config.PEOPLE_IDS = ["person1", "person2"]
        for f in (store.HISTORY, store.WHO_FILE, store.HIDDEN):
            if os.path.exists(f):
                os.remove(f)
        store._cache.clear()
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)
        self._installed = dict(server.installed)
        server.installed["packages"] = None

    def tearDown(self):
        server.installed.clear()
        server.installed.update(self._installed)
        config.PEOPLE, config.PEOPLE_IDS = self._people

    def on_tv(self, packages):
        server.installed["packages"], server.installed["checked"] = set(packages), 1e12

    def test_pkg_of_and_is_installed_with_only_the_fire_build(self):
        yt, prime, hbo, netflix = (apps.BY_ID[i] for i in ("youtube", "prime-video", "hbo-max", "netflix"))
        self.assertEqual(server.pkg_of(yt), GOOGLE_YOUTUBE)          # no list yet: the canonical one
        self.assertIsNone(server.is_installed(yt))
        self.on_tv(ON_THE_CUBE)
        self.assertEqual(server.pkg_of(yt), FIRE_YOUTUBE)
        self.assertEqual(server.pkg_of(prime), FIRE_PRIME)
        self.assertEqual(server.pkg_of(hbo), FIRE_HBO)
        self.assertTrue(server.is_installed(yt))
        self.assertTrue(server.is_installed(prime))
        self.assertFalse(server.is_installed(netflix))
        self.assertEqual(server.pkg_of(netflix), "com.netflix.ninja")   # not there under any name

    def test_a_google_tv_is_exactly_as_before(self):
        self.on_tv(ON_A_GOOGLE_TV)
        for app_id in ("youtube", "prime-video", "hbo-max", "netflix"):
            app = apps.BY_ID[app_id]
            self.assertEqual(server.pkg_of(app), app["package"])
            self.assertTrue(server.is_installed(app))

    def test_a_card_and_a_launch_use_the_installed_build(self):
        self.on_tv(ON_THE_CUBE)
        store.add_history({"title": "The Boys", "tv": self.tv, "who": "person1", "service": "prime-video",
                           "type": "tv", "when": NOW.isoformat(timespec="seconds")})
        cards = server.continue_items("person1")
        self.assertEqual([c["title"] for c in cards], ["The Boys"])
        self.assertEqual(cards[0]["app"], {"id": "prime-video", "name": "Prime Video", "package": FIRE_PRIME})

    async def test_launch_app_opens_the_fire_build(self):
        self.on_tv(ON_THE_CUBE)
        t = server.TVS[self.tv]
        with patch.object(t, "launch_package", new=AsyncMock(return_value="adb")) as launch, \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value=FIRE_YOUTUBE)) as wait:
            got, method = await server.launch_app(apps.BY_ID["youtube"])
        launch.assert_awaited_once_with(FIRE_YOUTUBE)
        wait.assert_awaited_once_with({FIRE_YOUTUBE}, timeout=8)
        self.assertEqual(got, FIRE_YOUTUBE)

    def test_a_watch_next_row_from_the_fire_build_brings_the_card_up_to_date(self):
        self.on_tv(ON_THE_CUBE)
        line = {"title": "The Boys", "service": "prime-video", "season": 1, "episode": 2,
                "when": (NOW - timedelta(hours=2)).isoformat(timespec="seconds")}
        rows = [{"package": FIRE_PRIME, "title": "The Boys", "season": "2", "episode": "5",
                 "episode_title": "We Gotta Go Now", "engaged": NOW.timestamp()}]
        got = server.wn_fresher(line, rows)
        self.assertEqual((got["season"], got["episode"], got["episode_title"]), (2, 5, "We Gotta Go Now"))
        # a row from some other app's package says nothing
        self.assertEqual(server.wn_fresher(line, [dict(rows[0], package="com.netflix.ninja")]), line)


if __name__ == "__main__":
    unittest.main()
