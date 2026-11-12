"""Spotify's Web API as a Now playing source (bridge/spotify_now.py): the card item it makes, that it
stays quiet until set up, and that music_now() only falls back to it when the TV shows nothing."""
import os
import sys
import time
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import server  # noqa: E402
import spotify_now  # noqa: E402

TRACK = {
    "is_playing": True, "currently_playing_type": "track", "progress_ms": 61500,
    "device": {"name": "a phone", "type": "Smartphone"},
    "item": {"name": "Eiskalt - Short Mix", "duration_ms": 200000,
             "artists": [{"name": "KUKO"}, {"name": "KOBOSIL"}],
             "album": {"name": "Eiskalt", "images": [{"url": "big", "width": 640}, {"url": "mid", "width": 300}]}},
}


class CardItem(unittest.TestCase):
    def test_track(self):
        it = spotify_now.card_item(TRACK)
        self.assertEqual(it["title"], "Eiskalt - Short Mix")
        self.assertEqual(it["artist"], "KUKO, KOBOSIL")
        self.assertEqual(it["album"], "Eiskalt")
        self.assertEqual(it["state"], "playing")
        self.assertEqual(it["app"]["id"], "spotify")
        self.assertEqual(it["source"], "spotify")
        self.assertEqual(it["art"], "mid")            # the picture nearest 300 px
        self.assertEqual((it["position"], it["duration"]), (61, 200))
        self.assertEqual(it["device"], "a phone")

    def test_episode_uses_the_show(self):
        ep = {"is_playing": True, "currently_playing_type": "episode",
              "item": {"name": "Episode 4", "show": {"name": "A Podcast", "images": [{"url": "show", "width": 300}]}}}
        it = spotify_now.card_item(ep)
        self.assertEqual((it["title"], it["artist"], it["art"]), ("Episode 4", "A Podcast", "show"))

    def test_paused_or_empty_is_none(self):
        self.assertIsNone(spotify_now.card_item(dict(TRACK, is_playing=False)))
        self.assertIsNone(spotify_now.card_item({}))
        self.assertIsNone(spotify_now.card_item(None))


class NotSetUp(unittest.IsolatedAsyncioTestCase):
    async def test_quiet_without_a_client_id(self):
        with patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": ""}):
            self.assertEqual(spotify_now.status(), {"configured": False, "connected": False})
            self.assertIsNone(await spotify_now.now_playing())

    def test_login_needs_a_client_id(self):
        with patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": ""}):
            with self.assertRaises(ValueError):
                spotify_now.login_url("http://127.0.0.1:5400/api/spotify/callback")

    def test_login_url_uses_pkce(self):
        with patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": "abc123"}):
            url = spotify_now.login_url("http://127.0.0.1:5400/api/spotify/callback")
        self.assertIn("code_challenge_method=S256", url)
        self.assertIn("redirect_uri=http%3A%2F%2F127.0.0.1%3A5400%2Fapi%2Fspotify%2Fcallback", url)
        self.assertNotIn("client_secret", url)


class MusicNowFallback(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tv = next(iter(server.TVS))
        server._current.set(self.tv)
        server.music_states.pop(self.tv, None)

    async def test_spotify_fills_the_card_when_the_tv_shows_nothing(self):
        item = spotify_now.card_item(TRACK)
        with patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)), \
                patch.object(spotify_now, "now_playing", new=AsyncMock(return_value=item)):
            self.assertEqual(await server.music_now(), item)

    async def test_nothing_set_up_means_no_card(self):
        with patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)), \
                patch.object(spotify_now, "now_playing", new=AsyncMock(return_value=None)):
            self.assertIsNone(await server.music_now())

    async def test_cached_for_a_moment(self):
        server.music_states[self.tv] = {"read_at": time.time(), "item": {"title": "kept"}, "last": None}
        spy = AsyncMock(return_value=None)
        with patch.object(spotify_now, "now_playing", new=spy):
            self.assertEqual(await server.music_now(), {"title": "kept"})
        spy.assert_not_called()


class LoginThroughTheMiddleware(AioHTTPTestCase):
    """The login is opened in a browser on the bridge computer and Spotify's redirect can't carry the
    pairing key, so with a key set it must still get through (guarded by loopback + state instead)."""
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/spotify/login", server.h_spotify_login)
        app.router.add_get("/api/spotify/callback", server.h_spotify_callback)
        app.router.add_get("/api/spotify/status", server.h_spotify_status)
        return app

    async def test_login_needs_no_pairing_key_but_status_does(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"), \
                patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": "abc123"}):
            r = await self.client.get("/api/spotify/login", allow_redirects=False)
            self.assertEqual(r.status, 302)
            self.assertTrue(r.headers["Location"].startswith("https://accounts.spotify.com/authorize?"))
            r = await self.client.get("/api/spotify/callback?state=nope&code=x")
            self.assertEqual(r.status, 400)            # reached the handler: a stale state, not a 401
            r = await self.client.get("/api/spotify/status")
            self.assertEqual(r.status, 401)


if __name__ == "__main__":
    unittest.main()
