"""Keep watching from a Plex Media Server's Continue Watching hub (bridge/plex.py): the cards it
makes from the hub's JSON, how they merge with the bridge's own history, whose they are, that a
removed card stays off, how one opens, and that nothing happens until it is set up."""
import asyncio
import os
import sys
import tempfile
import time
import unittest

import aiohttp
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).parents[1]
# The repo's example settings, not the owner's config.json: its pairing key, people and time zone
# would change the answers below. This only takes when this module is the first to import config
# (another test module may have loaded it already), so setUp patches what the tests read as well.
os.environ["COUCH_CONFIG"] = str(ROOT / "config.example.json")
os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-plex-")
sys.path.insert(0, str(ROOT / "bridge"))
import config  # noqa: E402
import plex  # noqa: E402
import store  # noqa: E402
import server  # noqa: E402

NOW = datetime.now(timezone.utc)
SETTINGS = {"url": "http://plex.test:32400", "who": None}


def ago(**kw):
    return int((NOW - timedelta(**kw)).timestamp())


def hub(*items):
    return {"MediaContainer": {"size": len(items), "Hub": [
        {"key": "/hubs/home/continueWatching", "title": "Continue Watching", "hubIdentifier": "home.continue",
         "type": "mixed", "size": len(items), "Metadata": list(items)}]}}


EPISODE = {"ratingKey": "4411", "type": "episode", "title": "Andy's Play", "grandparentTitle": "The Office (US)",
           "grandparentRatingKey": "4001", "parentIndex": 7, "index": 3, "viewOffset": 630000, "duration": 1260000,
           "lastViewedAt": ago(hours=3), "thumb": "/library/metadata/4411/thumb/1700000001",
           "grandparentThumb": "/library/metadata/4001/thumb/1700000002", "grandparentArt": "/library/metadata/4001/art/1700000003"}
FILM = {"ratingKey": "9001", "type": "movie", "title": "Heat", "year": 1995, "viewOffset": 1000000, "duration": 10200000,
        "lastViewedAt": ago(days=2), "thumb": "/library/metadata/9001/thumb/1700000004", "art": "/library/metadata/9001/art/1700000005"}
NEXT_UP = {"ratingKey": "5102", "type": "episode", "title": "Pilot", "grandparentTitle": "Severance", "parentIndex": 1, "index": 1,
           "duration": 3400000, "lastViewedAt": ago(days=1), "grandparentThumb": "/library/metadata/5000/thumb/1"}
TRACK = {"ratingKey": "777", "type": "track", "title": "A song", "lastViewedAt": ago(hours=1)}


def line(title, tv, who, days_ago=0.0, **extra):
    return {"title": title, "tv": tv, "who": who, "service": "plex",
            "when": (NOW - timedelta(days=days_ago)).isoformat(timespec="seconds"), **extra}


def request(data):
    req = MagicMock()
    req.headers = {}
    return req, patch.object(server, "body", new=AsyncMock(return_value=data))


def load(*items):
    """Put a hub answer in place of the last read."""
    got = plex.items_from(hub(*items))
    plex._state.update(items=got, by_id={it["id"]: it for it in got}, ok_at=time.time(), error=None)


class CardsFromTheHub(unittest.TestCase):
    def test_an_episode_is_its_show_with_season_episode_and_progress(self):
        it = plex.items_from(hub(EPISODE))[0]
        self.assertEqual((it["id"], it["type"], it["title"], it["episode_title"]), ("plex-4411", "tv", "The Office (US)", "Andy's Play"))
        self.assertEqual((it["season"], it["episode"], it["progress"]), (7, 3, 0.5))
        self.assertEqual(it["ts"], EPISODE["lastViewedAt"])
        self.assertTrue(it["when"].startswith(str(NOW.year)))
        # the show's pictures, not the episode's still
        self.assertEqual(it["pictures"], {"poster": EPISODE["grandparentThumb"], "backdrop": EPISODE["grandparentArt"]})

    def test_a_film_a_next_up_episode_and_a_song(self):
        got = plex.items_from(hub(TRACK, FILM, NEXT_UP))
        self.assertEqual([it["title"] for it in got], ["Severance", "Heat"])   # newest first, the song left out
        film = got[1]
        self.assertEqual((film["type"], film["year"], film["season"], film["episode_title"]), ("movie", 1995, None, None))
        self.assertAlmostEqual(film["progress"], 0.098, places=3)
        self.assertIsNone(got[0]["progress"])            # not started: the hub's next episode of a show
        self.assertEqual(got[0]["pictures"], {"poster": NEXT_UP["grandparentThumb"]})

    def test_items_flat_under_the_container_and_rubbish(self):
        flat = {"MediaContainer": {"Metadata": [FILM, {"type": "movie"}, "x", {"ratingKey": "1", "type": "movie", "title": " "}]}}
        self.assertEqual([it["id"] for it in plex.items_from(flat)], ["plex-9001"])
        self.assertEqual(plex.items_from({}), [])
        self.assertEqual(plex.items_from(None), [])


class KeepWatchingWithPlex(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._people = (config.PEOPLE, config.PEOPLE_IDS)
        config.PEOPLE = [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}]
        config.PEOPLE_IDS = ["person1", "person2"]
        for f in (store.HISTORY, store.WHO_FILE, store.HIDDEN):
            if os.path.exists(f):
                os.remove(f)
        store._cache.clear()
        plex._state.update(items=[], by_id={}, at=0.0, ok_at=None, error=None, server=None)
        plex._state.pop("who_warned", None)
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)
        self._patches = [patch.object(config, "PLEX", dict(SETTINGS)), patch.object(config, "PAIRING_KEY", ""),
                         patch.dict(os.environ, {"PLEX_TOKEN": "secret-token"})]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        config.PEOPLE, config.PEOPLE_IDS = self._people

    def cards(self, who, base="http://bridge.test:5400"):
        server._current.set(self.tv)
        return server.continue_items(who, base)

    def test_plex_cards_join_the_row_with_pictures_through_the_bridge(self):
        load(EPISODE, FILM)
        got = self.cards("person1")
        self.assertEqual([c["title"] for c in got], ["The Office (US)", "Heat"])
        c = got[0]
        self.assertEqual((c["id"], c["source"], c["service"], c["app"]["package"]), ("plex-4411", "plex", "plex", "com.plexapp.android"))
        self.assertEqual((c["season"], c["episode"], c["episode_title"], c["progress"], c["kind"]), (7, 3, "Andy's Play", 0.5, "continue"))
        self.assertEqual(c["poster"], "http://bridge.test:5400/api/plex/art?id=plex-4411&kind=poster")
        self.assertEqual(c["backdrop"], "http://bridge.test:5400/api/plex/art?id=plex-4411&kind=backdrop")
        self.assertNotIn("secret-token", str(got))             # the token never leaves the bridge
        self.assertNotIn("plex.test", str(got))                # nor the server's address
        with patch.object(config, "PAIRING_KEY", "a-key-of-twelve-or-more"):
            self.assertTrue(self.cards("person1")[0]["poster"].endswith("&key=a-key-of-twelve-or-more"))
        # the same list for everyone when plex.who is not set
        self.assertEqual([c["title"] for c in self.cards("person2")], ["The Office (US)", "Heat"])

    def test_one_card_per_show_the_newest_wins(self):
        load(EPISODE, FILM)
        # the bridge logged The Office (JustWatch's name) before Plex's last play: Plex's card wins
        store.add_history(line("The Office", self.tv, "person1", days_ago=1, season=7, episode=2, poster="p"))
        # the bridge saw Heat played after Plex's lastViewedAt: the bridge's line wins
        store.add_history(line("Heat", self.tv, "person1", days_ago=0.5, poster="heat.jpg"))
        store.add_history(line("Dark", self.tv, "person1", days_ago=3, service="netflix"))
        got = self.cards("person1")
        self.assertEqual([(c["title"], c["source"]) for c in got], [("The Office (US)", "plex"), ("Heat", "bridge"), ("Dark", "bridge")])
        self.assertEqual(got[1]["poster"], "heat.jpg")

    def test_newest_ten_across_both_lists_and_thirty_days(self):
        old = dict(FILM, ratingKey="1", title="Old film", lastViewedAt=ago(days=31))
        many = [dict(FILM, ratingKey=str(100 + i), title=f"Film {i}", lastViewedAt=ago(hours=i)) for i in range(8)]
        load(old, *many)
        for i in range(4):
            store.add_history(line(f"Show {i}", self.tv, "person1", days_ago=0.1 + i))
        got = self.cards("person1")
        self.assertEqual(len(got), 10)
        self.assertNotIn("Old film", [c["title"] for c in got])
        # newest first across both lists: Show 0 (2.4 hours old) sits between Film 2 and Film 3
        self.assertEqual([c["title"] for c in got][:5], ["Film 0", "Film 1", "Film 2", "Show 0", "Film 3"])

    def test_the_order_is_by_the_instant_whatever_the_home_time_zone(self):
        # A history line is written in UTC and a Plex card in the home's time zone. Behind UTC
        # (Los Angeles, -08:00) the Plex text reads earlier than a UTC text of the same hour, and
        # ahead of it (Sydney, +11:00) later: the order must follow the instant, not the text.
        for zone in ("America/Los_Angeles", "Australia/Sydney", "UTC"):
            with patch.object(plex, "_HOME_TZ", ZoneInfo(zone)):
                load(dict(FILM, ratingKey="21", title="Film an hour ago", lastViewedAt=ago(hours=1)),
                     dict(FILM, ratingKey="22", title="Film four hours ago", lastViewedAt=ago(hours=4)))
                store.add_history(line("Show two hours ago", self.tv, "person1", days_ago=2 / 24))
                got = [c["title"] for c in self.cards("person1")]
                self.assertEqual(got[:3], ["Film an hour ago", "Show two hours ago", "Film four hours ago"], zone)

    def test_whose_cards(self):
        load(EPISODE)
        with patch.object(config, "PLEX", dict(SETTINGS, who="Person 2")):   # by name or id
            self.assertEqual(self.cards("person1"), [])
            self.assertEqual([c["title"] for c in self.cards("person2")], ["The Office (US)"])
        with patch.object(config, "PLEX", dict(SETTINGS, who="nobody-here")), self.assertLogs("plex", "WARNING") as logs:
            self.assertEqual(self.cards("person1"), [])
            self.assertEqual(self.cards("person2"), [])
        self.assertIn("nobody-here", logs.output[0])

    async def test_a_removed_card_stays_off_until_watched_again(self):
        load(EPISODE, FILM)
        store.add_history(line("The Office", self.tv, "person1", days_ago=1))   # the bridge's own, older line
        req, body = request({"id": "plex-4411", "who": "person1"})
        with body:
            await server.h_continue_hide(req)
        self.assertEqual([c["title"] for c in self.cards("person1")], ["Heat"])   # neither name comes back
        self.assertEqual([c["title"] for c in self.cards("person2")], ["The Office (US)", "Heat"])   # only hers
        # watched again on Plex: back
        load(dict(EPISODE, lastViewedAt=int(time.time()) + 60), FILM)
        self.assertEqual([c["title"] for c in self.cards("person1")], ["The Office (US)", "Heat"])
        # removed with nobody picked: off for everyone, and off the list with nobody picked too
        self.assertEqual([c["title"] for c in self.cards(None)], ["The Office (US)", "Heat"])
        req, body = request({"id": "plex-9001"})
        with body, patch.object(server, "cur_who", return_value=None):
            await server.h_continue_hide(req)
        self.assertEqual([c["title"] for c in self.cards("person1")], ["The Office (US)"])
        self.assertEqual([c["title"] for c in self.cards("person2")], ["The Office (US)"])
        self.assertEqual([c["title"] for c in self.cards(None)], ["The Office (US)"])
        self.assertEqual([c["title"] for c in self.cards("both")], ["The Office (US)"])
        # a household with nobody in people: the list is "both", and a hide still holds
        load(EPISODE, FILM)                       # The Office as last read, not the play 60 s ahead
        with patch.object(config, "PEOPLE_IDS", []):
            req, body = request({"id": "plex-4411", "who": "both"})
            with body:
                await server.h_continue_hide(req)
            self.assertEqual(self.cards("both"), [])

    def test_two_countries_are_two_shows(self):
        uk = dict(EPISODE, ratingKey="4500", grandparentTitle="The Office (UK)", parentIndex=1, index=2,
                  lastViewedAt=ago(days=1))
        load(EPISODE, uk)
        self.assertEqual([c["title"] for c in self.cards("person1")], ["The Office (US)", "The Office (UK)"])
        req, body = request({"id": "plex-4411", "who": "person1"})
        with body:
            asyncio.run(server.h_continue_hide(req))
        self.assertEqual([c["title"] for c in self.cards("person1")], ["The Office (UK)"])

    async def test_a_plex_card_opens_in_plex(self):
        load(EPISODE, FILM)
        req, body = request({"id": "plex-4411", "who": "person1"})
        with body, patch.object(server, "play", new=AsyncMock(return_value={"title": "The Office"})) as play:
            await server.h_continue_open(req)
        play.assert_awaited_once_with("The Office (US)", 7, 3, "plex", "person1", resume=True, exact=True)
        # a title JustWatch does not know: the Plex app opens instead of an error
        unknown = server.ApiError(404, "could not find Heat", key="err_title_not_found")
        req, body = request({"id": "plex-9001", "who": "person1"})
        with body, patch.object(server, "play", new=AsyncMock(side_effect=unknown)), \
                patch.object(server, "search_in_app", new=AsyncMock(return_value=("app", "Opened Plex."))) as search:
            resp = await server.h_continue_open(req)
        search.assert_awaited_once_with(server.apps.BY_ID["plex"], "Heat")
        self.assertIn(b'"note_opened_app_manual_search"', resp.body)
        # a card the last read did not have
        req, body = request({"id": "plex-1", "who": "person1"})
        with body, self.assertRaises(server.ApiError) as e:
            await server.h_continue_open(req)
        self.assertEqual(e.exception.status, 404)

    async def test_a_title_the_search_guesses_at_opens_the_plex_app_not_the_guess(self):
        # JustWatch's search has a best guess for any text; for a home video that guess is another
        # film, and play() with exact=True refuses it, so the Plex app is searched for the card's title
        load(dict(FILM, ratingKey="123", title="Family Holiday 2019"))
        guess = {"title": "Holiday", "type": "movie", "jw_id": "tm-holiday", "providers": [], "year": 2006}
        req, body = request({"id": "plex-123", "who": "person1"})
        with body, patch.object(server, "installed_packages", new=AsyncMock()), \
                patch.object(server.finder, "find", new=AsyncMock(return_value=(guess, []))), \
                patch.object(server, "search_in_app", new=AsyncMock(return_value=("app", "Opened Plex."))) as search:
            resp = await server.h_continue_open(req)
        search.assert_awaited_once_with(server.apps.BY_ID["plex"], "Family Holiday 2019")
        self.assertNotIn(b'"Holiday"', resp.body)
        self.assertIn(b'"Family Holiday 2019"', resp.body)

    async def test_the_hub_is_read_and_a_failure_keeps_the_last_list(self):
        answers = {"/": {"MediaContainer": {"friendlyName": "Lounge", "version": "1.41.0"}}, plex.HUB: hub(EPISODE)}
        get = AsyncMock(side_effect=lambda path, params=None: answers[path])
        with patch.object(plex, "_get_json", get):
            items = await plex.refresh()
        self.assertEqual([it["title"] for it in items], ["The Office (US)"])
        self.assertEqual(get.await_args_list[1].args, (plex.HUB, {"count": "30"}))
        self.assertEqual(plex.status()["server"], {"name": "Lounge", "version": "1.41.0"})
        with patch.object(plex, "_get_json", AsyncMock(side_effect=RuntimeError("HTTP 401 from /hubs/continueWatching"))), \
                self.assertLogs("plex", "WARNING"):
            items = await plex.refresh()
        self.assertEqual([it["title"] for it in items], ["The Office (US)"])
        st = plex.status()
        self.assertEqual((st["configured"], st["enabled"], st["items"]), (True, True, 1))
        self.assertIn("HTTP 401", st["error"])
        self.assertNotIn("secret-token", str(st))

    async def test_an_outage_is_one_warning_and_never_the_address(self):
        load(EPISODE)
        plex._state["server"] = {"name": "Lounge", "version": "1"}
        down = aiohttp.ClientConnectionError("Cannot connect to host plex.test:32400 ssl:default [Connection refused]")
        with patch.object(plex, "_get_json", AsyncMock(side_effect=down)), self.assertLogs("plex", "DEBUG") as logs:
            await plex.refresh()
            await plex.refresh()
            await plex.refresh()
        self.assertEqual([r.levelname for r in logs.records], ["WARNING", "DEBUG", "DEBUG"])   # once per outage
        st = plex.status()
        self.assertEqual(st["error"], "the server is not reachable")
        self.assertNotIn("plex.test", str(st))
        self.assertNotIn("32400", str(st))
        self.assertEqual(st["items"], 1)                                                 # the last list kept
        with patch.object(plex, "_get_json", AsyncMock(side_effect=asyncio.TimeoutError())):
            await plex.refresh()
        self.assertEqual(plex.status()["error"], "the server did not answer in time")
        with patch.object(plex, "_get_json", AsyncMock(side_effect=ValueError("bad json"))):
            await plex.refresh()
        self.assertEqual(plex.status()["error"], "the server's answer could not be read")
        # back: one line says so, and the error is gone
        with patch.object(plex, "_get_json", AsyncMock(return_value=hub(EPISODE))), self.assertLogs("plex", "INFO") as logs:
            await plex.refresh()
        self.assertEqual([r.levelname for r in logs.records], ["INFO"])
        self.assertIsNone(plex.status()["error"])

    async def test_pictures_come_through_the_bridge(self):
        load(EPISODE)
        req = MagicMock()
        req.query = {"id": "plex-4411", "kind": "poster"}
        with patch.object(plex, "picture", new=AsyncMock(return_value=(b"JPEG", "image/jpeg"))) as pic:
            resp = await server.h_plex_art(req)
        pic.assert_awaited_once_with("plex-4411", "poster")
        self.assertEqual((resp.body, resp.content_type, resp.headers["Cache-Control"]), (b"JPEG", "image/jpeg", "public, max-age=3600"))
        req.query = {"id": "plex-4411", "kind": "backdrop"}
        with patch.object(plex, "picture", new=AsyncMock(return_value=None)), self.assertRaises(server.ApiError) as e:
            await server.h_plex_art(req)
        self.assertEqual(e.exception.status, 404)
        # the server not answering: the client gets a plain 502, the log the reason
        down = aiohttp.ClientConnectionError("Cannot connect to host plex.test:32400")
        with patch.object(plex, "picture", new=AsyncMock(side_effect=down)), self.assertRaises(server.ApiError) as e, \
                self.assertLogs("bridge", "WARNING"):
            await server.h_plex_art(req)
        self.assertEqual(e.exception.status, 502)
        self.assertNotIn("plex.test", str(e.exception))
        self.assertNotIn("32400", str(e.exception))

    def test_the_token_goes_in_a_header(self):
        h = plex._headers()
        self.assertEqual((h["X-Plex-Token"], h["Accept"]), ("secret-token", "application/json"))
        self.assertEqual(plex._url(plex.HUB), "http://plex.test:32400/hubs/continueWatching")


class NotSetUp(unittest.TestCase):
    def setUp(self):
        load(EPISODE)

    def test_no_section_means_nothing(self):
        with patch.object(config, "PLEX", None), patch.dict(os.environ, {"PLEX_TOKEN": "x"}):
            self.assertFalse(plex.enabled())
            self.assertEqual(plex.cards("person1"), [])
            self.assertIsNone(plex.item("plex-4411"))
            self.assertEqual(plex.status(), {"configured": False})

    def test_a_section_without_the_token_is_off_and_says_so(self):
        with patch.object(config, "PLEX", dict(SETTINGS)), patch.dict(os.environ, {"PLEX_TOKEN": ""}):
            self.assertFalse(plex.enabled())
            self.assertEqual(plex.cards("person1"), [])
            self.assertEqual(plex.status()["error"], "PLEX_TOKEN is not set in .env")

    def test_the_section_is_read_carefully(self):
        self.assertEqual(config._plex({"url": "http://your-computer.local:32400/", "who": " person1 "}), {"url": "http://your-computer.local:32400", "who": "person1"})
        self.assertIsNone(config._plex({"url": "http://your-computer.local:32400", "enabled": False}))
        self.assertIsNone(config._plex({"url": "your-computer.local:32400"}))
        self.assertIn("your-computer.local:32400", config.PLEX_ERROR)                  # a refused address says why
        self.assertIsNone(config._plex({"url": "http://your-computer.local:32400/web?x=1"}))
        self.assertIn("no path", config.PLEX_ERROR)
        self.assertIsNone(config._plex({"who": "person1"}))
        self.assertEqual(config.PLEX_ERROR, "the plex section has no url")
        self.assertIsNone(config._plex(None))
        self.assertIsNone(config.PLEX_ERROR)                                   # no section: nothing to say
        self.assertIsNone(config._plex("http://your-computer.local:32400"))
        self.assertIsNone(config._plex({"url": "http://your-computer.local:32400", "enabled": False}))
        self.assertIsNone(config.PLEX_ERROR)
        with patch.object(config, "PLEX", None), patch.object(config, "PLEX_ERROR", "the plex section has no url"):
            self.assertEqual(plex.status(), {"configured": False, "error": "the plex section has no url"})
        with patch.object(config, "PLEX", None), patch.object(config, "PLEX_ERROR", None):
            self.assertEqual(plex.status(), {"configured": False})


if __name__ == "__main__":
    unittest.main()
