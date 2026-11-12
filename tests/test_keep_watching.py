"""Keep watching on the bridge: per TV and per person, one card per show, up to 10, 30 days, fixed ids."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-keep-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import store  # noqa: E402
import server  # noqa: E402

NOW = datetime.now(timezone.utc)


def line(title, tv, who, days_ago=0.0, **extra):
    return {"title": title, "tv": tv, "who": who, "service": "netflix",
            "when": (NOW - timedelta(days=days_ago)).isoformat(timespec="seconds"), **extra}


class KeepWatchingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        import config
        self._orig_people = config.PEOPLE
        self._orig_people_ids = config.PEOPLE_IDS
        config.PEOPLE = [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}]
        config.PEOPLE_IDS = ["person1", "person2"]
        for f in (store.HISTORY, store.WHO_FILE):
            if os.path.exists(f):
                os.remove(f)
        store._cache.clear()
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)

    def tearDown(self):
        import config
        config.PEOPLE = self._orig_people
        config.PEOPLE_IDS = self._orig_people_ids

    def add(self, *items):
        for i in items:
            store.add_history(i)

    def titles(self, who, tv=None):
        server._current.set(tv or self.tv)
        return [c["title"] for c in server.continue_items(who)]

    def test_per_tv_and_per_person(self):
        self.add(line("Dark", self.tv, "person1", 2), line("Ozark", self.tv, "person2", 1),
                 line("Narcos", "bedroom", "person1", 1))
        self.assertEqual(self.titles("person1"), ["Dark"])
        self.assertEqual(self.titles("person2"), ["Ozark"])
        self.assertEqual(self.titles("person1", "bedroom"), ["Narcos"])   # the other TV keeps its own

    def test_untagged_and_shared_lines_are_shown_to_nobody(self):
        store._append(store.HISTORY, [{"title": "Old show", "who": "person1", "when": NOW.isoformat()},
                                      {"title": "Old shared", "who": None, "when": NOW.isoformat()}])
        self.add(line("Everyone's", self.tv, "both"))
        self.assertEqual(self.titles("person1"), [])

    def test_one_card_per_show_newest_first_up_to_ten(self):
        self.add(*[line(f"Show {i}", self.tv, "person1", days_ago=20 - i) for i in range(12)])
        self.add(line("Show 3", self.tv, "person1", days_ago=0, season=2, episode=5))
        got = server.continue_items("person1")
        self.assertEqual(len(got), 10)
        self.assertEqual(got[0]["title"], "Show 3")
        self.assertEqual((got[0]["season"], got[0]["episode"]), (2, 5))
        self.assertEqual([c["title"] for c in got].count("Show 3"), 1)

    def test_thirty_day_drop_off(self):
        self.add(line("Fresh", self.tv, "person1", 29.5), line("Stale", self.tv, "person1", 30.5))
        self.assertEqual(self.titles("person1"), ["Fresh"])

    def test_youtube_stays_out(self):
        self.add(line("A video", self.tv, "person1", service="youtube"))
        self.assertEqual(self.titles("person1"), [])

    async def test_a_card_opens_the_line_it_shows(self):
        self.add(line("Dark", self.tv, "person1", 3), line("Ozark", self.tv, "person2", 2),
                 line("Wednesday", self.tv, "person1", 1))
        cards = server.continue_items("person1")
        self.add(line("Squid Game", self.tv, "person1"))   # something new lands before the press
        with patch.object(server, "play", new=AsyncMock(return_value={"title": "x"})) as play:
            for c in cards:
                req = AsyncMock()
                with patch.object(server, "body", new=AsyncMock(return_value={"id": c["id"], "who": "person1"})):
                    await server.h_continue_open(req)
                self.assertEqual(play.await_args.args[0], c["title"])

    def test_who_is_kept_per_tv(self):
        store.save_who("person2", "living-room")
        store.save_who("person1", "bedroom")
        self.assertEqual(store.current_who("living-room"), "person2")
        self.assertEqual(store.current_who("bedroom"), "person1")
        store._write(store.WHO_FILE, {"who": "person1"})   # the older one-for-the-house file
        self.assertEqual(store.current_who("living-room"), "person1")

    async def test_seen_play_is_tagged_with_tv_person_and_episode(self):
        store.save_who("person2", self.tv)
        best = {"title": "Dark", "poster": "p", "backdrop": "b", "year": 2017, "type": "show"}
        with patch.object(server.finder, "find", new=AsyncMock(return_value=(best, []))):
            await server.log_seen("Dark", "Secrets", {"id": "netflix", "package": "com.netflix.ninja", "name": "Netflix"},
                                  {"season": 1, "episode": 2, "episode_title": "Lies"})
        h = store.history()[0]
        self.assertEqual((h["tv"], h["who"], h["season"], h["episode"], h["poster"]), (self.tv, "person2", 1, 2, "p"))
        self.assertTrue(h["id"])

    async def test_a_near_name_keeps_the_apps_own_title_and_no_picture(self):
        store.save_who("person1", self.tv)
        best = {"title": "Dark Matter", "poster": "p", "backdrop": "b", "year": 2024, "type": "show"}
        with patch.object(server.finder, "find", new=AsyncMock(return_value=(best, []))):
            await server.log_seen("Dark", None, {"id": "netflix", "package": "com.netflix.ninja", "name": "Netflix"}, {})
        h = store.history()[0]
        self.assertEqual((h["title"], h["poster"]), ("Dark", None))


    def test_an_apps_own_name_is_not_a_title(self):
        prime = {"id": "prime-video", "name": "Prime Video"}
        for t in ("PrimeVideo", "Prime Video", "prime video ", "Netflix", "YouTube", "amazonvideo", "Advertisement", "", None):
            self.assertTrue(server.generic_title(t, "com.amazon.amazonvideo.livingroom", prime), t)
        for t in ("Man of Steel", "The Dark Knight", "Citadel: Diana"):
            self.assertFalse(server.generic_title(t, "com.amazon.amazonvideo.livingroom", prime), t)

    def test_queue_title_is_read(self):
        out = ("12.5 1.0\n    package=com.amazon.amazonvideo.livingroom\n    active=true\n"
               "    state=PlaybackState {state=PLAYING(3), position=90000, buffered position=0, speed=1.0, updated=1000}\n"
               "    metadata: size=2, description=PrimeVideo, null, null\n    queueTitle=Man of Steel, size=0\n")
        s = server._sessions(out)[0]
        self.assertEqual((s["title"], s["queue_title"], s["state"]), ("PrimeVideo", "Man of Steel", "PLAYING"))


    async def test_nuvio_is_read_and_a_year_is_no_show(self):
        import apps
        self.assertNotIn(apps.describe_package("com.nuvio.tv")["id"], server.NOT_VIEWING)
        out = ("12.5 1.0\n    package=com.nuvio.tv\n    active=true\n"
               "    state=PlaybackState {state=PLAYING(3), position=900000, buffered position=0, speed=1.0, updated=1000}\n"
               "    metadata: size=3, description=Pluribus, S1:E8 \u2013 Charm Offensive, null\n")
        s = server._sessions(out)[0]
        self.assertEqual((s["package"], s["state"]), ("com.nuvio.tv", "PLAYING"))
        self.assertEqual((s["title"], s["subtitle"]), ("Pluribus", "S1:E8 \u2013 Charm Offensive"))
        # Nuvio sends a film's year as the subtitle, and "2012" is a film on JustWatch
        self.assertTrue(server.generic_title("2012"))
        film = {"title": "2012", "type": "movie", "jw_id": "x", "runtime_min": 158}
        server.episode_cache.clear()
        find = AsyncMock(side_effect=lambda q, *a: (film if q == "2012" else None, []))
        with patch.object(server.finder, "find", find):
            self.assertEqual(await server.resolve_episode("Some Unlisted Film", "2012", True), {})
        self.assertNotIn("2012", [c.args[0] for c in find.call_args_list])
        server.episode_cache.clear()
        # other apps can send a show named with a number ("1923") as the subtitle: still tried
        self.assertIn("nuvio", server.YEAR_SUBTITLE_APPS)
        self.assertNotIn("paramountplus", server.YEAR_SUBTITLE_APPS)
        find = AsyncMock(return_value=(None, []))
        with patch.object(server.finder, "find", find):
            await server.resolve_episode("Nature's Empty Throne", "1923")
        self.assertIn("1923", [c.args[0] for c in find.call_args_list])
        server.episode_cache.clear()

    def test_nuvio_link_is_the_show_or_film_page_by_imdb_id(self):
        import apps
        nuvio = apps.BY_ID["nuvio"]
        self.assertEqual(server.title_link(nuvio, {"type": "tv", "imdb": "tt22202452"}), "nuvio://series/tt22202452")
        self.assertEqual(server.title_link(nuvio, {"type": "movie", "imdb": "tt15239678"}), "nuvio://movie/tt15239678")
        self.assertIsNone(server.title_link(nuvio, {"type": "tv", "imdb": None}))
        self.assertIsNone(server.title_link(nuvio, {"type": "tv", "imdb": "tt1'; reboot"}))
        self.assertIsNone(server.title_link(apps.BY_ID["plex"], {"type": "tv", "imdb": "tt22202452"}))

    async def test_a_nuvio_card_opens_the_show_page(self):
        import apps
        nuvio = apps.BY_ID["nuvio"]
        fake = MagicMock(kind="android", adb_ready=AsyncMock(return_value=True), start_intent=AsyncMock(), wait_for_app=AsyncMock(return_value="com.nuvio.tv"))
        with patch.object(server, "tv", fake), patch.object(server, "launch_app", AsyncMock(return_value=("com.nuvio.tv", "adb"))) as launch:
            method, note = await server.search_in_app(nuvio, "Pluribus", {"type": "tv", "imdb": "tt22202452"})
            self.assertEqual(method, "deeplink")
            fake.start_intent.assert_awaited_once_with("nuvio://series/tt22202452", "com.nuvio.tv")
            launch.assert_not_awaited()
            # no IMDb id: only the app opens, as before
            fake.start_intent.reset_mock()
            method, _ = await server.search_in_app(nuvio, "Home Video", {"type": "movie", "imdb": None})
            self.assertEqual(method, "app")
            fake.start_intent.assert_not_awaited()
            launch.assert_awaited_once()
            # no ADB: the link is never handed to the remote, which would not pin it to Nuvio
            fake.adb_ready = AsyncMock(return_value=False)
            fake.start_intent.reset_mock()
            launch.reset_mock()
            await server.search_in_app(nuvio, "Pluribus", {"type": "tv", "imdb": "tt22202452"})
            fake.start_intent.assert_not_awaited()

if __name__ == "__main__":
    unittest.main()
