"""YouTube videos as a list of their own (store.videos, /api/continue "videos"): a video that played
the minute is a history line with "type": "video", written by its own name with no show finder, that
the shared Keep watching row, the picks, the taste and every other reader of the history never see.
A video card hides by its id like any card, and opens YouTube's installed build on a search."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).parents[1]
# The repo's example settings, not the owner's config.json (see tests/test_plex_keep_watching.py).
os.environ["COUCH_CONFIG"] = str(ROOT / "config.example.json")
os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-videos-")
sys.path.insert(0, str(ROOT / "bridge"))
import apps  # noqa: E402
import config  # noqa: E402
import store  # noqa: E402
import taste  # noqa: E402
import server  # noqa: E402

FIRE_YOUTUBE = "com.amazon.firetv.youtube"
GOOGLE_YOUTUBE = "com.google.android.youtube.tv"
NOW = datetime.now(timezone.utc)


def request(data):
    req = MagicMock()
    req.headers = {}
    return req, patch.object(server, "body", new=AsyncMock(return_value=data))


def no_finder():
    """The show finder must not be asked about a video."""
    return patch.object(server.finder, "find", new=AsyncMock(side_effect=AssertionError("finder.find was called")))


class Videos(unittest.IsolatedAsyncioTestCase):
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
        server.installed["packages"], server.installed["checked"] = {FIRE_YOUTUBE, "com.netflix.ninja"}, 1e12
        store.save_who("person1", self.tv)

    def tearDown(self):
        server.installed.clear()
        server.installed.update(self._installed)
        config.PEOPLE, config.PEOPLE_IDS = self._people

    def youtube(self, package=FIRE_YOUTUBE):
        return apps.describe_package(package)

    def show(self, title, who="person1", days_ago=0.0, **extra):
        store.add_history({"title": title, "tv": self.tv, "who": who, "service": "netflix", "type": "tv",
                           "when": (NOW - timedelta(days=days_ago)).isoformat(timespec="seconds"), **extra})

    async def test_log_seen_writes_a_video_line_without_the_finder(self):
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), {"season": 3, "episode": 1},
                                  who="person1")
        lines = store.videos()
        self.assertEqual(len(lines), 1)
        v = lines[0]
        self.assertEqual((v["title"], v["type"], v["service"], v["method"]), ("How Trains Work", "video", "youtube", "seen"))
        self.assertEqual((v["poster"], v["year"], v["season"], v["episode"]), (None, None, None, None))
        self.assertEqual((v["tv"], v["who"]), (self.tv, "person1"))
        self.assertTrue(v["id"])
        self.assertEqual(store.history(), [])                    # not a show

    async def test_music_and_streams_are_still_never_logged(self):
        with no_finder():
            for app_id in ("spotify", "twitch", "moonlight"):
                await server.log_seen("A song", None, apps.describe_package(apps.BY_ID[app_id]["package"]), who="person1")
        self.assertEqual(store._all_history(), [])

    async def test_a_watch_next_naming_never_makes_a_video(self):
        with no_finder():
            await server.log_seen("Clip", None, self.youtube(), who="person1", method="watch-next")
        self.assertEqual(store._all_history(), [])

    async def test_videos_are_their_own_list_and_never_items(self):
        self.show("Dark")
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1")
            await server.log_seen("How Planes Work", None, self.youtube(), who="person1")
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1")   # again: one card
            await server.log_seen("Someone else's", None, self.youtube(), who="person2")
        items = server.continue_items("person1")
        self.assertEqual([c["title"] for c in items], ["Dark"])
        videos = server.continue_videos("person1")
        self.assertEqual([v["title"] for v in videos], ["How Trains Work", "How Planes Work"])   # newest first
        v = videos[0]
        self.assertEqual(v["app"], {"id": "youtube", "name": "YouTube", "package": FIRE_YOUTUBE})
        self.assertEqual((v["service"], v["kind"], v["source"], v["poster"], v["progress"]), ("youtube", "video", "bridge", None, None))
        self.assertEqual((v["episode_title"], v["season"], v["episode"]), (None, None, None))
        self.assertEqual(v["id"], next(x["id"] for x in store.videos() if x["title"] == "How Trains Work"))   # the newest line
        self.assertEqual([x["title"] for x in server.continue_videos("person2")], ["Someone else's"])
        req = MagicMock(query={"who": "person1"}, scheme="http", host="bridge.test:5400")
        resp = await server.h_continue(req)
        self.assertIn(b'"videos"', resp.body)
        self.assertIn(b'"How Trains Work"', resp.body)
        body = resp.body.decode()
        self.assertLess(body.index('"items"'), body.index('"videos"'))
        self.assertNotIn("How Trains Work", body[:body.index('"videos"')])   # not among the items

    async def test_at_most_ten_within_the_keep_days(self):
        with no_finder():
            for i in range(12):
                await server.log_seen(f"Video {i}", None, self.youtube(), who="person1")
        store._append(store.HISTORY, [{"id": "old1", "title": "Old video", "type": "video", "service": "youtube",
                                       "tv": self.tv, "who": "person1",
                                       "when": (NOW - timedelta(days=store.KEEP_DAYS + 1)).isoformat(timespec="seconds")}])
        titles = [v["title"] for v in server.continue_videos("person1")]
        self.assertEqual(len(titles), 10)
        self.assertEqual(titles[0], "Video 11")
        self.assertNotIn("Old video", titles)

    async def test_every_other_reader_of_the_history_skips_videos(self):
        self.show("Dark")
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1")
        self.assertEqual([h["title"] for h in store.history()], ["Dark"])
        self.assertEqual([h["title"] for h in store.keep_watching(self.tv, "person1")], ["Dark"])
        self.assertEqual([e["title"] for e in taste._events()], ["Dark"])          # the household's taste
        self.assertEqual(store.continue_watching("person1")[0]["title"], "Dark")
        self.assertEqual(len(store.continue_watching("person1")), 1)
        resp = await server.h_history(MagicMock())
        self.assertIn(b'"Dark"', resp.body)
        self.assertNotIn(b'"How Trains Work"', resp.body)
        self.assertEqual(server._fallback_title(FIRE_YOUTUBE), (None, None))      # no video as a fallback title
        self.assertEqual(server.continue_items("person1")[0]["title"], "Dark")

    async def test_hide_by_id(self):
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1")
        vid = store.videos()[0]["id"]
        req, body = request({"id": vid})
        with body:
            await server.h_continue_hide(req)
        self.assertEqual(server.continue_videos("person1"), [])
        # watching it again (after the hide, not in the same second) brings it back
        store._append(store.HISTORY, [{"id": "later", "title": "How Trains Work", "type": "video", "service": "youtube",
                                       "tv": self.tv, "who": "person1",
                                       "when": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(timespec="seconds")}])
        self.assertEqual([v["title"] for v in server.continue_videos("person1")], ["How Trains Work"])

    async def test_hiding_a_video_leaves_a_show_of_the_same_name_and_the_other_way_round(self):
        # "Bluey" the Netflix show and a Bluey video on YouTube: two cards, hidden one at a time
        self.show("Bluey", days_ago=0.01)
        with no_finder():
            await server.log_seen("Bluey", None, self.youtube(), who="person1")
        self.assertEqual([c["title"] for c in server.continue_items("person1")], ["Bluey"])
        self.assertEqual([v["title"] for v in server.continue_videos("person1")], ["Bluey"])
        req, body = request({"id": store.videos()[0]["id"]})
        with body:
            await server.h_continue_hide(req)
        self.assertEqual(server.continue_videos("person1"), [])
        self.assertEqual([c["title"] for c in server.continue_items("person1")], ["Bluey"], "the show stays")
        # now the show: the video comes back when it is watched again, and the show stays hidden
        req, body = request({"id": store.history()[0]["id"]})
        with body:
            await server.h_continue_hide(req)
        self.assertEqual(server.continue_items("person1"), [])
        store._append(store.HISTORY, [{"id": "later", "title": "Bluey", "type": "video", "service": "youtube",
                                       "tv": self.tv, "who": "person1",
                                       "when": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(timespec="seconds")}])
        self.assertEqual([v["title"] for v in server.continue_videos("person1")], ["Bluey"])
        self.assertEqual(server.continue_items("person1"), [], "hiding the show never hid the video, nor the other way")
        # the hidden file keeps the two apart
        self.assertEqual(set(store.hidden_times(self.tv, "person1")), {"bluey", "video:bluey"})

    async def test_open_searches_the_installed_youtube_and_never_asks_the_finder(self):
        with no_finder():
            await server.log_seen("How Trains Work & More", None, self.youtube(), who="person1")
        vid = store.videos()[0]["id"]
        t = server.TVS[self.tv]
        req, body = request({"id": vid})
        with body, no_finder(), patch.object(server, "play", new=AsyncMock(side_effect=AssertionError("play() was called"))), \
                patch.object(t, "start_intent", new=AsyncMock(return_value="adb")) as start, \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value=FIRE_YOUTUBE)), \
                patch.object(t, "launch_package", new=AsyncMock()) as launch:
            resp = await server.h_continue_open(req)
        start.assert_awaited_once_with("https://www.youtube.com/results?search_query=How%20Trains%20Work%20%26%20More",
                                       FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn(b'"method": "search"', resp.body)
        self.assertIn(b'"service": "youtube"', resp.body)
        self.assertIn(FIRE_YOUTUBE.encode(), resp.body)
        self.assertIn(b'"note_opened_app_search"', resp.body)

    async def test_open_falls_back_to_the_app_when_the_link_does_not_take(self):
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1")
        vid = store.videos()[0]["id"]
        t = server.TVS[self.tv]
        req, body = request({"id": vid})
        with body, no_finder(), patch.object(t, "start_intent", new=AsyncMock(side_effect=RuntimeError("Error: no activity"))), \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value=FIRE_YOUTUBE)), \
                patch.object(t, "launch_package", new=AsyncMock(return_value="adb")) as launch:
            resp = await server.h_continue_open(req)
        launch.assert_awaited_once_with(FIRE_YOUTUBE)
        self.assertIn(b'"method": "app"', resp.body)
        self.assertIn(b'"note_opened_app_manual_search"', resp.body)

    async def test_on_a_google_tv_the_card_and_the_search_use_googles_youtube(self):
        server.installed["packages"] = {GOOGLE_YOUTUBE}
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(GOOGLE_YOUTUBE), who="person1")
        self.assertEqual(server.continue_videos("person1")[0]["app"]["package"], GOOGLE_YOUTUBE)
        t = server.TVS[self.tv]
        req, body = request({"id": store.videos()[0]["id"]})
        with body, no_finder(), patch.object(t, "start_intent", new=AsyncMock()) as start, \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value=GOOGLE_YOUTUBE)):
            await server.h_continue_open(req)
        self.assertEqual(start.await_args.args[1], GOOGLE_YOUTUBE)


if __name__ == "__main__":
    unittest.main()
