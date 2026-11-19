"""YouTube videos as a list of their own (store.videos, /api/continue "videos"): a video that played
the minute is a history line with "type": "video", written by its own name with no show finder, that
the shared Keep watching row, the picks, the taste and every other reader of the history never see.
A video card hides by its id like any card, and opens the exact video when move.youtube_video_id is
sure of it (the line keeps the channel and the length the session gave), else YouTube's installed
build on a search, else the app. A found id is kept on disk (store.video_id, bridge/data/video-ids.json)
so a restart does not lose it, and the card shows YouTube's own thumbnail for it as its backdrop.

Every test gets a data folder of its own (Videos.setUp points store's files at it): the COUCH_DATA
set below only counts when this module is the first to import config, and under
`unittest discover` an earlier module has already pointed store at the repo's bridge/data."""
import asyncio
import json
import os
import sys
import tempfile
import time
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
import move  # noqa: E402
import server  # noqa: E402

FIRE_YOUTUBE = "com.amazon.firetv.youtube"
GOOGLE_YOUTUBE = "com.google.android.youtube.tv"
NOW = datetime.now(timezone.utc)
VIDEO_ID = "dQw4w9WgXcQ"
WATCH_LINK = "https://www.youtube.com/watch?v=" + VIDEO_ID
THUMBNAIL = "https://i.ytimg.com/vi/" + VIDEO_ID + "/mqdefault.jpg"
# dumpsys media_session as Amazon's YouTube printed it on a Fire TV Cube: the channel is the
# description's second field and the length is the metadata's duration
DUMPSYS = """1234.56 2.00
  package=com.amazon.firetv.youtube
    active=true
    state=PlaybackState {state=PLAYING(3), position=120000, buffered position=0, speed=1.0, updated=1230000, actions=0, custom actions=[], active item id=-1, error=null}
    metadata:size=5, description=How Trains Work, Some Channel, null
    metadata: android.media.metadata.DURATION=600000
"""


def request(data):
    req = MagicMock()
    req.headers = {}
    return req, patch.object(server, "body", new=AsyncMock(return_value=data))


def no_finder():
    """The show finder must not be asked about a video."""
    return patch.object(server.finder, "find", new=AsyncMock(side_effect=AssertionError("finder.find was called")))


STORE_FILES = {"HISTORY_OLD": "history.json", "HISTORY": "history.jsonl", "IMPORTED": "imported.jsonl",
               "RECS": "recs.json", "SLEEP": "sleep.json", "HIDDEN": "hidden.json",
               "VIDEO_IDS": "video-ids.json", "WHO_FILE": "who.json"}


def own_data_folder(case):
    """Point every file store keeps at a new temporary folder for this test, undone afterwards, so a
    test never reads or writes the bridge's real bridge/data whatever imported config first."""
    folder = tempfile.mkdtemp(prefix="couchtv-videos-")
    case.addCleanup(lambda: __import__("shutil").rmtree(folder, ignore_errors=True))
    for name, file in [("DATA", None)] + list(STORE_FILES.items()):
        p = patch.object(store, name, folder if file is None else os.path.join(folder, file))
        p.start()
        case.addCleanup(p.stop)
    tmp = os.path.realpath(tempfile.gettempdir())
    for name in ["DATA"] + list(STORE_FILES):
        path = os.path.realpath(getattr(store, name))
        assert path.startswith(tmp + os.sep), f"store.{name} is outside the temporary folder: {path}"
    store._cache.clear()
    case.addCleanup(store._cache.clear)
    return folder


class Videos(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._people = (config.PEOPLE, config.PEOPLE_IDS)
        config.PEOPLE = [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}]
        config.PEOPLE_IDS = ["person1", "person2"]
        self.real_video_ids = store.VIDEO_IDS
        self.data = own_data_folder(self)
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)
        self._installed = dict(server.installed)
        server.installed["packages"], server.installed["checked"] = {FIRE_YOUTUBE, "com.netflix.ninja"}, 1e12
        store.save_who("person1", self.tv)
        # the id lookup never goes to YouTube from a test: unsure unless a test says otherwise
        self._lookup = patch.object(move, "youtube_video_id", new=AsyncMock(return_value=None))
        self.lookup = self._lookup.start()
        move._found.clear()
        server._video_tasks.clear()
        server._video_unsure.clear()

    def tearDown(self):
        self._lookup.stop()
        server.installed.clear()
        server.installed.update(self._installed)
        config.PEOPLE, config.PEOPLE_IDS = self._people

    def video_line(self, title="How Trains Work", **extra):
        """A video line as an older bridge wrote it (no channel, no duration_ms) unless `extra` says."""
        line = {"id": "line-" + title.lower().replace(" ", "-"), "title": title, "type": "video", "service": "youtube",
                "tv": self.tv, "who": "person1", "when": NOW.isoformat(timespec="seconds"), **extra}
        store._append(store.HISTORY, [line])
        return line["id"]

    def opening(self, start=None, wait=None, launch=None):
        """The TV mocked for an open: start_intent, wait_for_app and launch_package, plus play() and
        the finder, which a video must never reach."""
        t = server.TVS[self.tv]
        self._mocks = (patch.object(t, "start_intent", new=start or AsyncMock(return_value="adb")),
                       patch.object(t, "wait_for_app", new=wait or AsyncMock(return_value=FIRE_YOUTUBE)),
                       patch.object(t, "launch_package", new=launch or AsyncMock(return_value="adb")),
                       patch.object(server, "play", new=AsyncMock(side_effect=AssertionError("play() was called"))),
                       no_finder())
        return self._mocks

    async def open(self, vid, **mocks):
        req, body = request({"id": vid})
        start, wait, launch, play_, finder_ = self.opening(**mocks)
        with body, start as s, wait, launch as l, play_, finder_:
            resp = await server.h_continue_open(req)
        return resp.body.decode(), s, l

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
        self.assertEqual((v["channel"], v["duration_ms"]), (None, None))   # the session gave neither
        await asyncio.sleep(0)
        self.lookup.assert_not_awaited()   # nothing to be sure by: no warm up, the card will search
        self.assertEqual(server._video_tasks, {})

    async def test_the_line_keeps_the_channel_and_the_length_the_session_gave(self):
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), {"duration_ms": None},
                                  who="person1", channel="Some Channel", duration_ms=600000)
            await server.log_seen("A live stream", "Some Channel", self.youtube(), {}, who="person1",
                                  channel="Some Channel", duration_ms=None)
        by_title = {v["title"]: v for v in store.videos()}
        self.assertEqual((by_title["How Trains Work"]["channel"], by_title["How Trains Work"]["duration_ms"]),
                         ("Some Channel", 600000))
        self.assertEqual((by_title["A live stream"]["channel"], by_title["A live stream"]["duration_ms"]),
                         ("Some Channel", None))
        # the warm up got the same three
        await asyncio.sleep(0)
        self.assertEqual([c.args for c in self.lookup.await_args_list],
                         [("How Trains Work", "Some Channel", 600000), ("A live stream", "Some Channel", None)])

    async def test_media_read_keeps_the_channel_and_the_length_from_the_session(self):
        t = server.TVS[self.tv]
        with patch.object(t, "adb", new=AsyncMock(return_value=DUMPSYS)), \
                patch.object(server, "resolve_episode", new=AsyncMock(return_value={})), \
                patch.object(server, "artwork_soon", return_value={}):
            s = await server.media_read(FIRE_YOUTUBE, self.youtube())
        self.assertEqual((s["title"], s["app_subtitle"], s["duration"]), ("How Trains Work", "Some Channel", 600000))
        self.assertIsNone(server.media_now["duration_ms"])   # JustWatch's, not the session's: None for a video

    async def test_media_read_never_sends_a_video_to_the_show_finder(self):
        # resolve_episode unpatched: a channel named like a show and a video named like one of its
        # episodes used to come back as that episode, with the show's name swapped into the title
        t = server.TVS[self.tv]
        dumpsys = DUMPSYS.replace("How Trains Work, Some Channel", "Keepy Uppy, Bluey")
        server.episode_cache.clear()
        with patch.object(t, "adb", new=AsyncMock(return_value=dumpsys)), no_finder(), \
                patch.object(server, "artwork_soon", return_value={}):
            s = await server.media_read(FIRE_YOUTUBE, self.youtube())
        self.assertEqual((s["title"], s["subtitle"], s["app_subtitle"]), ("Keepy Uppy", "Bluey", "Bluey"))
        self.assertEqual((server.media_now["title"], server.media_now["episode_title"], server.media_now["season"]),
                         ("Keepy Uppy", "Bluey", None))

    async def test_the_watch_loop_hands_the_channel_and_the_length_to_log_seen(self):
        s = {"package": FIRE_YOUTUBE, "state": "PLAYING", "title": "How Trains Work", "subtitle": "Some Channel",
             "app_subtitle": "Some Channel", "duration": 600000}
        key = (FIRE_YOUTUBE, "how trains work")
        server.seen_playing.clear()
        server.seen_playing["_playing"] = (key, time.time() - server.SEEN_AFTER_S - 5)
        server.seen_playing["_playing_last"] = time.time()
        server.playing["item"] = None
        server.media_now.clear()
        server.media_now.update({"title": "How Trains Work", "state": "playing", "position_ms": None, "duration_ms": None})

        class Stop(Exception):
            pass
        fake_tv = MagicMock(picture_cfg=None, connected=True, is_on=True, current_package=FIRE_YOUTUBE,
                            adb_ready=AsyncMock(return_value=True), native_media=False)
        with patch.object(server, "tv", fake_tv), patch.object(server, "media_read", new=AsyncMock(return_value=s)), \
                patch.object(server, "log_seen", new=AsyncMock()) as seen, \
                patch.object(server, "untitled_step"), patch.object(server, "_paused_idle_step", new=AsyncMock()), \
                patch.object(server, "untitled_resolve", new=AsyncMock()), \
                patch.object(server.asyncio, "sleep", new=AsyncMock(side_effect=Stop())):
            with self.assertRaises(Stop):
                await server.media_watch_loop()
        seen.assert_awaited_once()
        self.assertEqual(seen.await_args.args[:3], ("How Trains Work", "Some Channel", self.youtube()))
        self.assertEqual(seen.await_args.kwargs, {"channel": "Some Channel", "duration_ms": 600000})

    async def test_the_warm_up_is_scheduled_and_never_awaited_inline(self):
        never = asyncio.Event()   # a lookup that never answers
        calls = []

        async def stuck(title, channel=None, duration_ms=None):
            calls.append((title, channel, duration_ms))
            await never.wait()
        self.lookup.side_effect = stuck
        with no_finder():
            await asyncio.wait_for(server.log_seen("How Trains Work", "Some Channel", self.youtube(), who="person1",
                                                   channel="Some Channel", duration_ms=600000), timeout=2)
        self.assertEqual(len(store.videos()), 1, "the line is written before the lookup answers")
        await asyncio.sleep(0)   # lets the scheduled task start
        self.assertEqual(calls, [("How Trains Work", "Some Channel", 600000)])
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
        self.assertEqual(len(pending), 1, "the warm up runs in a task of its own")
        # the bridge holds the task (the loop keeps only weak references, so it could be dropped mid flight)
        self.assertEqual(list(server._video_tasks.values()), pending)
        pending[0].cancel()

    async def test_a_failing_warm_up_is_swallowed(self):
        self.lookup.side_effect = RuntimeError("no network")
        with no_finder():
            await server.log_seen("How Trains Work", None, self.youtube(), who="person1", channel="Some Channel")
        self.assertEqual(len(server._video_tasks), 1)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.lookup.assert_awaited_once_with("How Trains Work", "Some Channel", None)
        self.assertEqual(len(store.videos()), 1)
        self.assertFalse([t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()])
        self.assertEqual(server._video_tasks, {})   # let go once done
        self.assertIn(server._video_key("How Trains Work", "Some Channel", None), server._video_unsure)

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

    async def test_open_with_a_sure_id_sends_the_watch_link_to_the_installed_build(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        self.lookup.return_value = VIDEO_ID
        body, start, launch = await self.open(vid)
        # the line's channel and length tell the lookup which "How Trains Work" it is
        self.lookup.assert_awaited_once_with("How Trains Work", "Some Channel", 600000)
        # the watch link, no time in it: YouTube resumes from the account's own history (seen on a Cube)
        start.assert_awaited_once_with(WATCH_LINK, FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn('"method": "deeplink"', body)
        self.assertIn(f'"video_id": "{VIDEO_ID}"', body)
        self.assertIn('"service": "youtube"', body)
        self.assertIn(FIRE_YOUTUBE, body)
        self.assertIn('"note_opened_title_page"', body)
        self.assertIn("Opened How Trains Work in YouTube.", body)

    async def test_open_with_an_unsure_lookup_searches_the_installed_youtube_and_never_asks_the_finder(self):
        vid = self.video_line("How Trains Work & More", channel="Some Channel", duration_ms=600000)
        body, start, launch = await self.open(vid)
        self.lookup.assert_awaited_once_with("How Trains Work & More", "Some Channel", 600000)
        # Amazon's build shows its home for the web results link: it gets the link Alexa's voice search sends
        start.assert_awaited_once_with("youtube://search?query=How%20Trains%20Work%20%26%20More", FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn('"method": "search"', body)
        self.assertIn('"video_id": null', body)
        self.assertIn('"service": "youtube"', body)
        self.assertIn(FIRE_YOUTUBE, body)
        self.assertIn('"note_opened_app_search"', body)

    async def test_an_unsure_warm_up_is_remembered_so_the_open_goes_straight_to_the_search(self):
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), who="person1",
                                  channel="Some Channel", duration_ms=600000)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.lookup.assert_awaited_once_with("How Trains Work", "Some Channel", 600000)   # the warm up: unsure
        vid = store.videos()[0]["id"]
        body, start, launch = await self.open(vid)
        self.lookup.assert_awaited_once()   # not again: the press does not pay the lookup a second time
        start.assert_awaited_once_with("youtube://search?query=How%20Trains%20Work", FIRE_YOUTUBE)
        self.assertIn('"method": "search"', body)
        # until the memory runs out: then the lookup is tried once more
        key = server._video_key("How Trains Work", "Some Channel", 600000)
        self.assertEqual(server._video_unsure[key][1], 1, "one unsure answer so far")
        server._video_unsure[key] = (time.time() - server.VIDEO_UNSURE_KEEP_S - 1, 1)
        self.lookup.return_value = VIDEO_ID
        body, start, launch = await self.open(vid)
        self.assertEqual(self.lookup.await_count, 2)
        start.assert_awaited_once_with(WATCH_LINK, FIRE_YOUTUBE)
        self.assertIn('"method": "deeplink"', body)
        self.assertNotIn(key, server._video_unsure)   # found: forgotten as unsure

    async def test_an_open_while_the_warm_up_runs_waits_on_it_instead_of_a_second_lookup(self):
        answer = asyncio.Event()

        async def slow(title, channel=None, duration_ms=None):
            await answer.wait()
            return VIDEO_ID
        self.lookup.side_effect = slow
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), who="person1",
                                  channel="Some Channel", duration_ms=600000)
        vid = store.videos()[0]["id"]
        asyncio.get_running_loop().call_later(0.05, answer.set)
        body, start, launch = await self.open(vid)
        self.assertEqual(self.lookup.await_count, 1)
        start.assert_awaited_once_with(WATCH_LINK, FIRE_YOUTUBE)
        self.assertIn('"method": "deeplink"', body)
        self.assertIn(f'"video_id": "{VIDEO_ID}"', body)

    async def test_open_with_a_lookup_that_raises_still_searches(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        self.lookup.side_effect = RuntimeError("YouTube gave a consent page")
        body, start, launch = await self.open(vid)
        start.assert_awaited_once_with("youtube://search?query=How%20Trains%20Work", FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn('"method": "search"', body)

    async def test_open_with_a_lookup_that_hangs_still_searches(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        async def hang(*a):
            await asyncio.Event().wait()
        self.lookup.side_effect = hang
        with patch.object(server, "OPEN_VIDEO_LOOKUP_S", 0.05):
            body, start, launch = await self.open(vid)
        start.assert_awaited_once_with("youtube://search?query=How%20Trains%20Work", FIRE_YOUTUBE)
        self.assertIn('"method": "search"', body)
        # the lookup runs on for the next press; the press that ran out is what was let go
        task, = server._video_tasks.values()
        self.assertFalse(task.done())
        task.cancel()

    async def test_open_falls_back_to_the_search_when_the_watch_link_does_not_take(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        self.lookup.return_value = VIDEO_ID
        start = AsyncMock(side_effect=[RuntimeError("Error: no activity"), "adb"])
        body, start, launch = await self.open(vid, start=start)
        self.assertEqual([c.args for c in start.await_args_list],
                         [(WATCH_LINK, FIRE_YOUTUBE), ("youtube://search?query=How%20Trains%20Work", FIRE_YOUTUBE)])
        launch.assert_not_awaited()
        self.assertIn('"method": "search"', body)
        self.assertIn('"video_id": null', body)

    async def test_an_old_line_without_channel_or_length_goes_straight_to_the_search(self):
        # written before the bridge kept them: a title alone cannot be sure of the video (the lookup
        # would take the first result of that name, from any channel), so there is no lookup at all
        vid = self.video_line()
        self.lookup.return_value = VIDEO_ID
        body, start, launch = await self.open(vid)
        self.lookup.assert_not_awaited()
        start.assert_awaited_once_with("youtube://search?query=How%20Trains%20Work", FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn('"method": "search"', body)
        self.assertIn('"video_id": null', body)
        # a live stream has no length: the channel alone is enough to ask
        vid = self.video_line("A live stream", channel="Some Channel", duration_ms=None)
        body, start, launch = await self.open(vid)
        self.lookup.assert_awaited_once_with("A live stream", "Some Channel", None)
        self.assertIn('"method": "deeplink"', body)

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
        # Google's build keeps the web results link, which opens its results there
        self.assertEqual(start.await_args.args[0], "https://www.youtube.com/results?search_query=How%20Trains%20Work")

    # ---------- the id kept on disk, and the card's thumbnail ----------

    def forget_everything_in_memory(self):
        """Every in memory memory of a lookup, as a bridge restart loses them: only the file is left."""
        move._found.clear()
        server._video_tasks.clear()
        server._video_unsure.clear()

    def test_store_keeps_a_found_id_by_title_and_channel(self):
        self.assertIsNone(store.video_id("How Trains Work", "Some Channel"))
        store.remember_video_id("How Trains Work", "Some Channel", VIDEO_ID)
        self.assertEqual(store.video_id("How Trains Work", "Some Channel"), VIDEO_ID)
        # the key is the normalised title and channel, the way move tells videos apart
        self.assertEqual(store.video_id("  how trains WORK! ", "some channel"), VIDEO_ID)
        self.assertIsNone(store.video_id("How Trains Work", "Another Channel"), "one id per channel")
        self.assertIsNone(store.video_id("How Trains Work", None))
        with open(store.VIDEO_IDS) as f:
            data = json.load(f)
        entry, = data.values()
        self.assertEqual(entry[-1]["id"], VIDEO_ID)
        self.assertIsNone(entry[-1]["length_s"])   # remembered without a length
        self.assertTrue(datetime.fromisoformat(entry[-1]["when"]).tzinfo)
        # written again: the newer id wins
        store.remember_video_id("How Trains Work", "Some Channel", "abcdefghijk")
        self.assertEqual(store.video_id("How Trains Work", "Some Channel"), "abcdefghijk")
        with open(store.VIDEO_IDS) as f:
            self.assertEqual(len(json.load(f)), 1)

    def test_store_refuses_an_id_that_is_not_one(self):
        for bad in ("", None, "short", "dQw4w9WgXcQ&t=1", "x" * 12, "javascript:", 12345678901):
            self.assertFalse(store.remember_video_id("How Trains Work", "Some Channel", bad), repr(bad))
        self.assertFalse(os.path.exists(store.VIDEO_IDS), "nothing written")
        self.assertTrue(store.remember_video_id("How Trains Work", "Some Channel", VIDEO_ID))
        os.remove(store.VIDEO_IDS)
        # nor is one given back when something else put it in the file
        with open(store.VIDEO_IDS, "w") as f:
            json.dump({store._video_ids_key("How Trains Work", "Some Channel"): {"id": "../evil", "when": "2030-01-01T00:00:00+00:00"},
                       store._video_ids_key("Other", "Some Channel"): "not a dict"}, f)
        self.assertIsNone(store.video_id("How Trains Work", "Some Channel"))
        self.assertIsNone(store.video_id("Other", "Some Channel"))

    async def test_store_reads_a_file_that_is_not_an_object_as_empty(self):
        # a hand edited file: the reader and the writer treat it the same, and the row still answers
        self.video_line(channel="Some Channel", duration_ms=600000)
        for text in ("[]", "null", '"x"', "1"):
            with open(store.VIDEO_IDS, "w") as f:
                f.write(text)
            self.assertIsNone(store.video_id("How Trains Work", "Some Channel"), text)
            card, = server.continue_videos("person1")
            self.assertEqual((card["backdrop"], card["video_id"]), (None, None), text)
            self.assertTrue(store.remember_video_id("How Trains Work", "Some Channel", VIDEO_ID, 600000), text)
            self.assertEqual(store.video_id("How Trains Work", "Some Channel", 600000), VIDEO_ID, text)
        for task in server._video_tasks.values():
            task.cancel()

    def test_store_caps_the_file_whatever_a_hand_edited_when_holds(self):
        with open(store.VIDEO_IDS, "w") as f:
            json.dump({"a|": {"id": "aaaaaaaaaaa", "when": 5},
                       "b|": {"id": "bbbbbbbbbbb", "when": "2026-01-01T00:00:00+00:00"},
                       "c|": "not a dict"}, f)
        with patch.object(store, "VIDEO_IDS_MAX", 2):
            self.assertTrue(store.remember_video_id("d", None, "ddddddddddd", 60000))
        self.assertEqual(store.video_id("d", None, 60000), "ddddddddddd")
        with open(store.VIDEO_IDS) as f:
            data = json.load(f)
        self.assertEqual(len(data), 2)
        self.assertIn("d|", data)
        self.assertIn("b|", data, "the one with a real time outlives the ones without")

    def test_store_keeps_at_most_the_newest_five_hundred(self):
        with patch.object(store, "VIDEO_IDS_MAX", 5):
            for i in range(7):
                store.remember_video_id(f"Video {i}", "Some Channel", f"id{i:09d}")
            with open(store.VIDEO_IDS) as f:
                data = json.load(f)
            self.assertEqual(len(data), 5)
            self.assertIsNone(store.video_id("Video 0", "Some Channel"), "the oldest went")
            self.assertIsNone(store.video_id("Video 1", "Some Channel"))
            self.assertEqual(store.video_id("Video 2", "Some Channel"), "id000000002")
            self.assertEqual(store.video_id("Video 6", "Some Channel"), "id000000006")
            # writing one again makes it the newest, so it outlives the ones written between
            store.remember_video_id("Video 2", "Some Channel", "id000000002")
            store.remember_video_id("Video 7", "Some Channel", "id000000007")
            self.assertIsNone(store.video_id("Video 3", "Some Channel"))
            self.assertEqual(store.video_id("Video 2", "Some Channel"), "id000000002")
        self.assertEqual(store.VIDEO_IDS_MAX, 500)

    async def test_a_found_lookup_is_kept_on_disk(self):
        self.lookup.return_value = VIDEO_ID
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), who="person1",
                                  channel="Some Channel", duration_ms=600000)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.lookup.assert_awaited_once_with("How Trains Work", "Some Channel", 600000)
        self.assertEqual(store.video_id("How Trains Work", "Some Channel", 600000), VIDEO_ID)
        # an unsure one is not
        self.lookup.return_value = None
        with no_finder():
            await server.log_seen("How Planes Work", "Some Channel", self.youtube(), who="person1",
                                  channel="Some Channel", duration_ms=600000)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.assertIsNone(store.video_id("How Planes Work", "Some Channel", 600000))

    async def test_an_open_after_a_restart_deep_links_from_the_id_on_disk_without_the_lookup(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        store.remember_video_id("How Trains Work", "Some Channel", VIDEO_ID, 600000)
        self.forget_everything_in_memory()
        body, start, launch = await self.open(vid)
        self.lookup.assert_not_awaited()   # the id was on disk: no task, no network
        self.assertEqual(server._video_tasks, {})
        start.assert_awaited_once_with(WATCH_LINK, FIRE_YOUTUBE)
        launch.assert_not_awaited()
        self.assertIn('"method": "deeplink"', body)
        self.assertIn(f'"video_id": "{VIDEO_ID}"', body)
        # the warm up of a line written again does not go to the network either
        with no_finder():
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), who="person1",
                                  channel="Some Channel", duration_ms=600000)
        await asyncio.sleep(0)
        self.lookup.assert_not_awaited()
        self.assertEqual(server._video_tasks, {})

    async def test_the_card_shows_youtubes_thumbnail_once_the_video_is_known(self):
        self.video_line(channel="Some Channel", duration_ms=600000)
        store.remember_video_id("How Trains Work", "Some Channel", VIDEO_ID, 600000)
        self.forget_everything_in_memory()
        card, = server.continue_videos("person1")
        self.assertEqual((card["backdrop"], card["video_id"]), (THUMBNAIL, VIDEO_ID))
        self.assertIsNone(card["poster"])   # the page draws the backdrop first
        self.assertEqual((card["title"], card["kind"], card["service"], card["source"], card["progress"]),
                         ("How Trains Work", "video", "youtube", "bridge", None))
        self.assertEqual((card["episode_title"], card["season"], card["episode"]), (None, None, None))
        self.assertEqual(card["app"], {"id": "youtube", "name": "YouTube", "package": FIRE_YOUTUBE})
        self.assertIs(card["live"], False)   # a video with a length is not live
        self.lookup.assert_not_awaited()   # known: nothing to look up
        self.assertEqual(server._video_tasks, {})
        # and the row carries it
        req = MagicMock(query={"who": "person1"}, scheme="http", host="bridge.test:5400")
        resp = await server.h_continue(req)
        self.assertIn(THUMBNAIL.encode(), resp.body)

    def test_the_thumbnail_is_the_medium_one_on_youtubes_image_host(self):
        # mqdefault.jpg: 320x180, 16:9 with no black bars; hqdefault is 4:3 with bars and
        # maxresdefault is not there for every video
        self.assertEqual(server.video_thumbnail(VIDEO_ID), "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg")
        self.assertTrue(server.video_thumbnail("a-b_c123456").startswith("https://i.ytimg.com/vi/"))
        self.assertIsNone(server.video_thumbnail("not an id"))
        self.assertIsNone(server.video_thumbnail(None))

    async def test_a_card_not_yet_found_has_no_picture_and_starts_the_lookup_without_waiting(self):
        self.video_line(channel="Some Channel", duration_ms=600000)
        never = asyncio.Event()
        calls = []

        async def stuck(title, channel=None, duration_ms=None):
            calls.append((title, channel, duration_ms))
            await never.wait()
        self.lookup.side_effect = stuck
        before = time.monotonic()
        card, = server.continue_videos("person1")
        self.assertLess(time.monotonic() - before, 0.5, "continue_videos returned at once")
        self.assertEqual((card["backdrop"], card["video_id"], card["poster"]), (None, None, None))
        # the lookup was scheduled, not awaited: it starts once the loop gets a turn
        self.assertEqual(calls, [])
        task, = server._video_tasks.values()
        self.assertFalse(task.done())
        await asyncio.sleep(0)
        self.assertEqual(calls, [("How Trains Work", "Some Channel", 600000)])
        # the next fetch of the row, while it still runs, starts no second one
        server.continue_videos("person1")
        await asyncio.sleep(0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(list(server._video_tasks.values()), [task])
        task.cancel()

    async def test_the_next_fetch_of_the_row_has_the_picture(self):
        self.video_line(channel="Some Channel", duration_ms=600000)
        self.lookup.return_value = VIDEO_ID
        card, = server.continue_videos("person1")
        self.assertIsNone(card["backdrop"])
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.forget_everything_in_memory()   # the file alone is enough
        card, = server.continue_videos("person1")
        self.assertEqual((card["backdrop"], card["video_id"]), (THUMBNAIL, VIDEO_ID))
        self.lookup.assert_awaited_once()

    async def test_an_old_line_without_channel_or_length_gets_no_picture_and_no_lookup(self):
        self.video_line()
        self.lookup.return_value = VIDEO_ID
        card, = server.continue_videos("person1")
        self.assertEqual((card["backdrop"], card["video_id"], card["poster"]), (None, None, None))
        await asyncio.sleep(0)
        self.lookup.assert_not_awaited()
        self.assertEqual(server._video_tasks, {})

    async def test_an_unsure_mark_stops_the_row_from_starting_a_lookup_again(self):
        self.video_line(channel="Some Channel", duration_ms=600000)
        key = server._video_key("How Trains Work", "Some Channel", 600000)
        server._video_unsure[key] = (time.time(), 1)
        card, = server.continue_videos("person1")
        self.assertEqual((card["backdrop"], card["video_id"]), (None, None))
        await asyncio.sleep(0)
        self.lookup.assert_not_awaited()
        self.assertEqual(server._video_tasks, {})
        # once the memory runs out the row asks again
        server._video_unsure[key] = (time.time() - server.VIDEO_UNSURE_KEEP_S - 1, 1)
        server.continue_videos("person1")
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.lookup.assert_awaited_once_with("How Trains Work", "Some Channel", 600000)


    # ---------- the saved id is for one length (finding: a weekly video of one title) ----------

    def test_the_saved_id_is_only_given_back_for_the_same_length(self):
        store.remember_video_id("Weekly update", "Some Channel", "AAAAAAAAAAA", 600000)
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 600000), "AAAAAAAAAAA")
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 602900), "AAAAAAAAAAA", "within 3 s")
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 597000), "AAAAAAAAAAA")
        self.assertIsNone(store.video_id("Weekly update", "Some Channel", 610000), "10 s apart: another video")
        self.assertIsNone(store.video_id("Weekly update", "Some Channel", 754000))
        self.assertIsNone(store.video_id("Weekly update", "Some Channel"), "no length against a saved one")
        with open(store.VIDEO_IDS) as f:
            self.assertEqual(json.load(f)[store._video_ids_key("Weekly update", "Some Channel")][-1]["length_s"], 600)
        # the new one's lookup is kept beside it, each for its own length
        store.remember_video_id("Weekly update", "Some Channel", "BBBBBBBBBBB", 754000)
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 754000), "BBBBBBBBBBB")
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 600000), "AAAAAAAAAAA")

    def test_with_no_length_on_either_side_the_channel_has_to_say(self):
        store.remember_video_id("A live stream", "Some Channel", "AAAAAAAAAAA")
        self.assertEqual(store.video_id("A live stream", "Some Channel"), "AAAAAAAAAAA")
        self.assertIsNone(store.video_id("A live stream", "Some Channel", 600000), "a length against none saved")
        # a line with no channel has only the length to go by
        store.remember_video_id("A clip", None, "CCCCCCCCCCC")
        self.assertIsNone(store.video_id("A clip", None))
        store.remember_video_id("A clip", None, "CCCCCCCCCCC", 120000)
        self.assertEqual(store.video_id("A clip", None, 121000), "CCCCCCCCCCC")
        self.assertIsNone(store.video_id("A clip", None, 300000), "no channel and another length: another video")

    def test_an_older_file_stays_readable(self):
        # {"id", "when"} as the first version wrote it, and a bare id string: no length saved
        with open(store.VIDEO_IDS, "w") as f:
            json.dump({store._video_ids_key("How Trains Work", "Some Channel"): {"id": VIDEO_ID, "when": "2026-01-01T00:00:00+00:00"},
                       store._video_ids_key("Old Bare", "Some Channel"): "abcdefghijk",
                       store._video_ids_key("Odd Length", "Some Channel"): {"id": "abcdefghijk", "length_s": "ten"}}, f)
        self.assertEqual(store.video_id("How Trains Work", "Some Channel"), VIDEO_ID)
        self.assertEqual(store.video_id("Old Bare", "Some Channel"), "abcdefghijk")
        self.assertEqual(store.video_id("Odd Length", "Some Channel"), "abcdefghijk", "a length that is not one reads as none")
        # a line with a length looks again rather than trust an id saved without one
        self.assertIsNone(store.video_id("How Trains Work", "Some Channel", 600000))
        self.assertIsNone(store.video_id("Old Bare", "Some Channel", 600000))
        # and writing over a file that holds a bare string works
        self.assertTrue(store.remember_video_id("Another", "Some Channel", VIDEO_ID, 1000))
        self.assertEqual(store.video_id("Old Bare", "Some Channel"), "abcdefghijk")

    async def test_a_newer_video_of_the_same_title_and_channel_is_looked_up_not_the_old_one(self):
        store.remember_video_id("Weekly update", "Some Channel", "AAAAAAAAAAA", 600000)
        self.lookup.return_value = "BBBBBBBBBBB"
        self.assertEqual(await server._find_video("Weekly update", "Some Channel", 754000, 15), "BBBBBBBBBBB")
        self.lookup.assert_awaited_once_with("Weekly update", "Some Channel", 754000)
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 754000), "BBBBBBBBBBB")
        # last week's, played again, keeps its own id beside this week's: no second lookup
        self.assertEqual(await server._find_video("Weekly update", "Some Channel", 600000, 15), "AAAAAAAAAAA")
        self.assertEqual(self.lookup.await_count, 1)

    def test_each_length_keeps_its_own_id_up_to_a_few(self):
        for i, vid in enumerate(["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD", "EEEEEEEEEEE"]):
            self.assertTrue(store.remember_video_id("Weekly update", "Some Channel", vid, (600 + 100 * i) * 1000))
        self.assertIsNone(store.video_id("Weekly update", "Some Channel", 600000), "the oldest of five lengths is dropped")
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 700000), "BBBBBBBBBBB")
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 1001000), "EEEEEEEEEEE", "within 3 s")
        # the same length found again replaces its id, and stays one entry
        store.remember_video_id("Weekly update", "Some Channel", "FFFFFFFFFFF", 700000)
        self.assertEqual(store.video_id("Weekly update", "Some Channel", 700000), "FFFFFFFFFFF")
        with open(store.VIDEO_IDS) as f:
            self.assertEqual(len(json.load(f)[store._video_ids_key("Weekly update", "Some Channel")]), store.VIDEO_IDS_PER_TITLE)

    async def test_the_row_shows_the_new_videos_picture_not_the_old_ones(self):
        store.remember_video_id("Weekly update", "Some Channel", "AAAAAAAAAAA", 600000)
        self.video_line("Weekly update", channel="Some Channel", duration_ms=754000)
        self.lookup.return_value = "BBBBBBBBBBB"
        card, = server.continue_videos("person1")
        self.assertEqual((card["video_id"], card["backdrop"]), (None, None), "not last week's")
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.lookup.assert_awaited_once_with("Weekly update", "Some Channel", 754000)
        card, = server.continue_videos("person1")
        self.assertEqual(card["video_id"], "BBBBBBBBBBB")

    async def test_two_lengths_of_one_title_are_two_lookups_and_two_unsure_marks(self):
        never = asyncio.Event()

        async def stuck(title, channel=None, duration_ms=None):
            await never.wait()
        self.lookup.side_effect = stuck
        a = server._video_lookup("Weekly update", "Some Channel", 600000)
        b = server._video_lookup("Weekly update", "Some Channel", 754000)
        self.assertIsNot(a, b, "a running lookup for one video does not stand in for the other")
        self.assertIs(server._video_lookup("Weekly update", "Some Channel", 600400), a, "the same video, rounded")
        a.cancel()
        b.cancel()
        server._video_tasks.clear()
        server._video_unsure[server._video_key("Weekly update", "Some Channel", 600000)] = (time.time(), 1)
        self.assertTrue(server._video_unsure_lately("Weekly update", "Some Channel", 600000))
        self.assertFalse(server._video_unsure_lately("Weekly update", "Some Channel", 754000))

    # ---------- the row backs off a video that keeps coming back unsure ----------

    def test_the_rows_wait_doubles_up_to_a_day(self):
        keep = server.VIDEO_UNSURE_KEEP_S
        self.assertEqual([server._video_unsure_hold(n) for n in (1, 2, 3, 4)], [keep, 2 * keep, 4 * keep, 8 * keep])
        self.assertEqual(server._video_unsure_hold(9), server.VIDEO_UNSURE_MAX_S)
        self.assertEqual(server._video_unsure_hold(500), 24 * 3600)

    async def test_each_unsure_answer_in_a_row_makes_the_row_wait_longer(self):
        self.video_line(channel="Some Channel", duration_ms=600000)
        key = server._video_key("How Trains Work", "Some Channel", 600000)

        async def ask_the_row():
            server.continue_videos("person1")
            await asyncio.sleep(0)
            await asyncio.sleep(0)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 1)
        self.assertEqual(server._video_unsure[key][1], 1)
        # 11 minutes on: the row asks again, unsure again, and now waits 20 minutes
        server._video_unsure[key] = (time.time() - 11 * 60, 1)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 2)
        self.assertEqual(server._video_unsure[key][1], 2)
        server._video_unsure[key] = (time.time() - 11 * 60, 2)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 2, "11 minutes is not 20")
        server._video_unsure[key] = (time.time() - 21 * 60, 2)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 3)
        self.assertEqual(server._video_unsure[key][1], 3)
        # many in a row: a day, never more
        server._video_unsure[key] = (time.time() - 23 * 3600, 30)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 3)
        server._video_unsure[key] = (time.time() - 24 * 3600 - 1, 30)
        await ask_the_row()
        self.assertEqual(self.lookup.await_count, 4)
        # a sure answer forgets the count
        self.lookup.return_value = VIDEO_ID
        server._video_unsure[key] = (time.time() - 24 * 3600 - 1, 31)
        await ask_the_row()
        self.assertNotIn(key, server._video_unsure)

    async def test_an_ok_press_keeps_the_short_wait(self):
        vid = self.video_line(channel="Some Channel", duration_ms=600000)
        key = server._video_key("How Trains Work", "Some Channel", 600000)
        server._video_unsure[key] = (time.time() - server.VIDEO_UNSURE_KEEP_S - 1, 6)   # the row waits hours
        self.lookup.return_value = VIDEO_ID
        body, start, launch = await self.open(vid)
        self.lookup.assert_awaited_once()   # the press still asks after ten minutes
        self.assertIn('"method": "deeplink"', body)

    async def test_at_most_two_results_pages_are_fetched_at_once(self):
        running, most, release = 0, 0, asyncio.Event()

        class Response:
            status = 200
            url = "https://www.youtube.com/results"

            async def __aenter__(self):
                nonlocal running, most
                running += 1
                most = max(most, running)
                await release.wait()
                return self

            async def __aexit__(self, *exc):
                nonlocal running
                running -= 1

            async def text(self):
                return "<html></html>"

        class Session:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def get(self, *a, **k):
                return Response()
        with patch.object(move.aiohttp, "ClientSession", Session):
            fetches = [asyncio.ensure_future(move._results_page(f"video {i}")) for i in range(6)]
            for _ in range(5):
                await asyncio.sleep(0)
            self.assertEqual(running, move.RESULTS_AT_ONCE)
            release.set()
            pages = await asyncio.gather(*fetches)
        self.assertEqual(pages, ["<html></html>"] * 6)
        self.assertEqual(most, 2)
        self.assertEqual(move.RESULTS_AT_ONCE, 2)

    # ---------- a live stream says so ----------

    async def test_a_live_stream_is_marked_live_on_its_line_and_its_card(self):
        with no_finder():
            await server.log_seen("Al Jazeera English", "Al Jazeera English", self.youtube(), {}, who="person1",
                                  channel="Al Jazeera English", duration_ms=None)
            await server.log_seen("How Trains Work", "Some Channel", self.youtube(), {}, who="person1",
                                  channel="Some Channel", duration_ms=600000)
            await server.log_seen("No Channel", None, self.youtube(), {}, who="person1")
        by_title = {v["title"]: v for v in store.videos()}
        self.assertIs(by_title["Al Jazeera English"].get("live"), True)
        self.assertNotIn("live", by_title["How Trains Work"])
        self.assertNotIn("live", by_title["No Channel"], "no channel: nothing says it is live")
        cards = {c["title"]: c for c in server.continue_videos("person1")}
        self.assertIs(cards["Al Jazeera English"]["live"], True)
        self.assertIs(cards["How Trains Work"]["live"], False)
        self.assertIs(cards["No Channel"]["live"], False)
        for task in server._video_tasks.values():
            task.cancel()

    async def test_an_older_line_with_no_length_is_not_called_live(self):
        # a line written before live was kept: a missing length alone does not make it live
        self.video_line("Old Line", channel="Some Channel", duration_ms=None)
        self.video_line("Odd Line", channel="Some Channel", live="yes")
        cards = {c["title"]: c for c in server.continue_videos("person1")}
        self.assertIs(cards["Old Line"]["live"], False)
        self.assertIs(cards["Odd Line"]["live"], False)
        for task in server._video_tasks.values():
            task.cancel()

    # ---------- the tests keep off the real data ----------

    def test_every_store_file_is_in_this_tests_own_folder(self):
        for name in ["DATA"] + list(STORE_FILES):
            self.assertTrue(os.path.realpath(getattr(store, name)).startswith(os.path.realpath(self.data)), name)
        self.assertNotEqual(os.path.realpath(self.real_video_ids), os.path.realpath(store.VIDEO_IDS))

if __name__ == "__main__":
    unittest.main()
