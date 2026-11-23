"""The Up next widget's songs (bridge/spotify_now.py queue, GET /api/music/queue): Spotify's own queue
answer made small (title, artist, a cover only from Spotify's picture host), quiet until Spotify is
connected, cached, and behind the pairing key like the rest of the API. No real Spotify is asked."""
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

QUEUE = {"currently_playing": {"name": "Now"}, "queue": [
    {"type": "track", "name": "Low Tide", "artists": [{"name": "Saltwater Radio"}, {"name": "Guest"}],
     "album": {"images": [{"url": "https://i.scdn.co/image/big", "width": 640}, {"url": "https://i.scdn.co/image/mid", "width": 300}]}},
    {"type": "episode", "name": "Episode 9", "show": {"name": "A Podcast", "images": [{"url": "https://i.scdn.co/image/show", "width": 300}]}},
    {"type": "track", "name": "Odd cover", "artists": [], "album": {"images": [{"url": "http://elsewhere.example/x.jpg", "width": 300}]}},
    {"type": "track"},
] + [{"type": "track", "name": "Song %d" % i, "artists": [{"name": "A"}], "album": {}} for i in range(12)]}


class QueueItems(unittest.TestCase):
    def test_small_and_safe(self):
        q = spotify_now.queue_items(QUEUE)
        self.assertEqual(len(q), 10)
        self.assertEqual(q[0], {"title": "Low Tide", "artist": "Saltwater Radio, Guest", "art": "https://i.scdn.co/image/mid"})
        self.assertEqual(q[1], {"title": "Episode 9", "artist": "A Podcast", "art": "https://i.scdn.co/image/show"})
        self.assertIsNone(q[2]["art"])          # a cover from anywhere else is dropped
        self.assertEqual(q[3]["title"], "Song 0")  # an item with no name is skipped

    def test_empty(self):
        self.assertEqual(spotify_now.queue_items({}), [])
        self.assertEqual(spotify_now.queue_items(None), [])


class NotConnected(unittest.IsolatedAsyncioTestCase):
    async def test_quiet_without_spotify(self):
        with patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": ""}):
            self.assertIsNone(await spotify_now.queue())

    async def test_cached_reading_is_reused(self):
        spotify_now._queue_cache.update(at=time.time(), items=[{"title": "kept"}], backoff_until=0.0)
        spy = AsyncMock(return_value="token")
        with patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": "abc123"}), \
                patch.object(spotify_now, "_read_tokens", return_value={"refresh_token": "r"}), \
                patch.object(spotify_now, "_access_token", new=spy):
            self.assertEqual(await spotify_now.queue(), [{"title": "kept"}])
        spy.assert_not_called()
        spotify_now._queue_cache.update(at=0.0, items=None, backoff_until=0.0)


class QueueRoute(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/music/queue", server.h_music_queue)
        return app

    async def test_route_and_pairing_key(self):
        items = [{"title": "Low Tide", "artist": "Saltwater Radio", "art": None}]
        with patch.object(spotify_now, "queue", new=AsyncMock(return_value=items)), \
                patch.object(spotify_now, "status", return_value={"configured": True, "connected": True}):
            r = await self.client.get("/api/music/queue")
            self.assertEqual(r.status, 200)
            self.assertEqual(await r.json(), {"ok": True, "configured": True, "queue": items})
            with patch.object(config, "PAIRING_KEY", "couchpass123"):
                r = await self.client.get("/api/music/queue")
                self.assertEqual(r.status, 401)

    async def test_not_connected_is_null(self):
        with patch.object(spotify_now, "queue", new=AsyncMock(return_value=None)), \
                patch.object(spotify_now, "status", return_value={"configured": False, "connected": False}):
            r = await self.client.get("/api/music/queue")
            self.assertEqual((await r.json())["queue"], None)


if __name__ == "__main__":
    unittest.main()
