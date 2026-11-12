"""Keep watching shows, opens and records the episode the app says it is up to.

The case reported on 12 Nov 2026: couch-tv's history had Ozark at season 1 episode 10 (a Keep
watching card had opened that episode, and so recorded it, on 10 and 11 Nov), while Netflix's own
Watch Next row, engaged later that evening, said season 2 episode 3. Keep watching kept showing, and
opening, season 1 episode 10."""
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-kw-episode-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import store  # noqa: E402
import server  # noqa: E402

NETFLIX = {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja"}
NOW = datetime.now(timezone.utc)
PLAYED = NOW - timedelta(hours=21)        # "11 Nov 18:19": the stale line couch-tv wrote
ENGAGED = PLAYED + timedelta(hours=1)     # "11 Nov 19:21": Netflix's row, later


def ms(dt):
    return int(dt.timestamp() * 1000)


def request(data):
    req = MagicMock()
    req.headers = {}
    return req, patch.object(server, "body", new=AsyncMock(return_value=data))


class KeepWatchingEpisode(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        import config
        self._people = (config.PEOPLE, config.PEOPLE_IDS)
        config.PEOPLE = [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}]
        config.PEOPLE_IDS = ["person1", "person2"]
        for f in os.listdir(store.DATA):
            if f.endswith(".jsonl") or f.startswith(("watch-next", "who")):
                os.remove(os.path.join(store.DATA, f))
        store._cache.clear()
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)
        server.seen_playing.pop("_wn_rows", None)
        server.seen_playing["_untitled"] = None
        server.playing["item"] = None

    def tearDown(self):
        import config
        config.PEOPLE, config.PEOPLE_IDS = self._people

    def ozark_line(self, when=PLAYED, season=1, episode=10):
        store.add_history({"title": "Ozark", "year": 2017, "type": "tv", "service": "netflix",
                           "who": "person1", "tv": self.tv, "season": season, "episode": episode,
                           "episode_title": None, "when": when.isoformat(timespec="seconds"),
                           "method": "deeplink"})

    async def send_rows(self, rows):
        """What the TV home sends (POST /api/watch-next): engaged in milliseconds."""
        req, b = request({"rows": rows})
        with b, patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)):
            await server.h_watch_next(req)

    async def netflix_rows(self, engaged=ENGAGED):
        # the live TV's two Netflix rows for Ozark: the one with the episode, and an older one with none
        await self.send_rows([
            {"package": "com.netflix.ninja", "title": "Ozark", "season": "2", "episode": "3",
             "engaged": ms(engaged), "id": "5546446"},
            {"package": "com.netflix.ninja", "title": "Ozark", "season": None, "episode": None,
             "engaged": ms(PLAYED - timedelta(hours=7))},
        ])

    def card(self):
        cards = [c for c in server.continue_items("person1") if c["title"] == "Ozark"]
        self.assertEqual(len(cards), 1, cards)   # still one card per show
        return cards[0]

    async def test_newer_watch_next_row_wins_on_the_card(self):
        self.ozark_line()
        await self.netflix_rows()
        c = self.card()
        self.assertEqual((c["season"], c["episode"]), (2, 3))
        self.assertEqual(datetime.fromisoformat(c["last_played"]).timestamp(), int(ENGAGED.timestamp()))

    async def test_the_card_opens_and_records_the_newer_episode(self):
        self.ozark_line()
        await self.netflix_rows()
        cid = self.card()["id"]
        best = {"title": "Ozark", "year": 2017, "type": "tv", "poster": None, "backdrop": None}

        async def fake_play(title, season, episode, service, who, resume=False):
            # what play() does once the app is open: finish_play() writes the history line
            return server.finish_play(best, server.apps.BY_ID[service], "deeplink", "", season, episode, who)

        req, b = request({"id": cid, "who": "person1"})
        with b, patch.object(server, "play", new=AsyncMock(side_effect=fake_play)) as play, \
                patch.object(server, "push_now"):
            await server.h_continue_open(req)
        self.assertEqual(play.await_args.args[:4], ("Ozark", 2, 3, "netflix"))
        newest = store.history()[0]
        self.assertEqual((newest["title"], newest["season"], newest["episode"]), ("Ozark", 2, 3))
        c = self.card()   # and the card stays on it, from our own line now
        self.assertEqual((c["season"], c["episode"]), (2, 3))

    async def test_an_older_watch_next_row_does_not_win(self):
        self.ozark_line()
        await self.netflix_rows(engaged=PLAYED - timedelta(minutes=5))
        c = self.card()
        self.assertEqual((c["season"], c["episode"]), (1, 10))

    async def test_no_watch_next_row_changes_nothing(self):
        self.ozark_line()
        c = self.card()
        self.assertEqual((c["season"], c["episode"], c["last_played"]),
                         (1, 10, PLAYED.isoformat(timespec="seconds")))
        with patch.object(server, "play", new=AsyncMock(return_value={"title": "Ozark"})) as play:
            req, b = request({"id": c["id"], "who": "person1"})
            with b:
                await server.h_continue_open(req)
        self.assertEqual(play.await_args.args[:3], ("Ozark", 1, 10))

    async def test_rows_from_another_app_or_show_or_with_no_episode_change_nothing(self):
        self.ozark_line()
        await self.send_rows([
            {"package": "com.amazon.amazonvideo.livingroom", "title": "Ozark", "season": "3",
             "episode": "1", "engaged": ms(ENGAGED)},
            {"package": "com.netflix.ninja", "title": "Ozark: Behind the Scenes", "season": "1",
             "episode": "2", "engaged": ms(ENGAGED)},
            {"package": "com.netflix.ninja", "title": "Ozark", "season": None, "episode": None,
             "engaged": ms(ENGAGED)},
        ])
        c = self.card()
        self.assertEqual((c["season"], c["episode"]), (1, 10))

    async def test_an_opened_play_that_resumes_another_episode_is_logged(self):
        """A Netflix play couch-tv opened is logged as the episode it asked for. If Netflix's row for
        that show then says another episode, that episode is logged too, so history is right."""
        since = time.time() - 300
        server.playing["item"] = {"title": "Ozark", "season": 1, "episode": 10, "package": "com.netflix.ninja",
                                  "who": None, "ts": since - 5}
        with patch.object(server, "cur_who", return_value=None):
            server.untitled_step("com.netflix.ninja", NETFLIX, True, None)
        u = server.seen_playing["_untitled"]
        self.assertEqual(u["named_by"], "opened")
        self.assertFalse(u["done"])
        await self.send_rows([{"package": "com.netflix.ninja", "title": "Ozark", "season": "2", "episode": "3",
                               "engaged": int(time.time() * 1000)}])
        u.update(since=since, qualified=True)   # past the minute only now: the resolve below is the one
        server.seen_playing["_untitled"] = u
        with patch.object(server, "log_seen", new=AsyncMock()) as seen, \
                patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)):
            await server.untitled_resolve()
        seen.assert_awaited_once()
        self.assertEqual(seen.await_args.args[0], "Ozark")
        self.assertEqual((seen.await_args.args[3]["season"], seen.await_args.args[3]["episode"]), (2, 3))
        self.assertEqual(seen.await_args.kwargs["method"], "watch-next")
        self.assertTrue(server.seen_playing["_untitled"]["done"])

    async def test_an_opened_play_on_the_same_episode_is_not_logged_twice(self):
        since = time.time() - 300
        server.playing["item"] = {"title": "Ozark", "season": 2, "episode": 3, "package": "com.netflix.ninja",
                                  "who": None, "ts": since - 5}
        with patch.object(server, "cur_who", return_value=None):
            server.untitled_step("com.netflix.ninja", NETFLIX, True, None)
        u = server.seen_playing["_untitled"]
        await self.send_rows([
            {"package": "com.netflix.ninja", "title": "Ozark", "season": "2", "episode": "3",
             "engaged": int(time.time() * 1000)},
            # another show's row in the same app is not this play
            {"package": "com.netflix.ninja", "title": "Dark", "season": "1", "episode": "1",
             "engaged": int(time.time() * 1000) + 1000},
        ])
        u.update(since=since, qualified=True)
        server.seen_playing["_untitled"] = u
        with patch.object(server, "log_seen", new=AsyncMock()) as seen, \
                patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)):
            await server.untitled_resolve()
        seen.assert_not_called()
        self.assertTrue(server.seen_playing["_untitled"]["done"])


if __name__ == "__main__":
    unittest.main()
