"""Keep watching on the bridge: per TV and per person, one card per show, up to 10, 30 days, fixed ids."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

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
        for f in (store.HISTORY, store.WHO_FILE):
            if os.path.exists(f):
                os.remove(f)
        store._cache.clear()
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)

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


if __name__ == "__main__":
    unittest.main()
