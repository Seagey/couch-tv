"""Tests for SSE events stream and client queue lifecycle in bridge/server.py."""
import asyncio
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import server


class TestSSEEvents(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        server.events_clients.clear()
        self.tok = server._current.set("living-room")

    def tearDown(self):
        server.events_clients.clear()
        server._current.reset(self.tok)

    async def test_push_now_enqueues_to_matching_tv(self):
        q1 = asyncio.Queue()
        q2 = asyncio.Queue()
        server.events_clients.add((q1, "living-room"))
        server.events_clients.add((q2, "bedroom"))

        with patch.object(server, "now_payload", return_value={"title": "Test Show"}):
            server.push_now()

        self.assertEqual(q1.qsize(), 1)
        self.assertEqual(q2.qsize(), 0)
        msg = q1.get_nowait()
        self.assertTrue(msg.startswith("event: now\ndata: "))
        data = json.loads(msg.split("data: ", 1)[1].strip())
        self.assertEqual(data.get("title"), "Test Show")

    async def test_push_now_prunes_closed_transport(self):
        q = asyncio.Queue()
        req = MagicMock()
        req.transport.is_closing.return_value = True
        q._request = req
        entry = (q, "living-room")
        server.events_clients.add(entry)

        with patch.object(server, "now_payload", return_value={"title": "Test Show"}):
            server.push_now()

        self.assertNotIn(entry, server.events_clients)
        self.assertEqual(q.qsize(), 0)

    async def test_push_now_discards_overflowing_client_queue(self):
        q = asyncio.Queue()
        entry = (q, "living-room")
        server.events_clients.add(entry)

        for _ in range(20):
            q.put_nowait("existing")

        with patch.object(server, "now_payload", return_value={"title": "Test Show"}):
            server.push_now()

        # The queue reached capacity 20, so entry should be pruned from subscribers
        self.assertNotIn(entry, server.events_clients)

    async def test_h_events_registers_and_cleans_up_on_cancellation(self):
        req = MagicMock()
        req.headers = {}
        req.transport.is_closing.return_value = False

        with patch.object(server, "now_payload", return_value={"title": "Now Playing"}), \
             patch.object(server.web, "StreamResponse") as mock_stream_cls:
            mock_stream = MagicMock()
            mock_stream.prepare = AsyncMock()
            mock_stream.write = AsyncMock()
            mock_stream_cls.return_value = mock_stream

            task = asyncio.create_task(server.h_events(req))
            await asyncio.sleep(0.05)

            self.assertEqual(len(server.events_clients), 1)

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

            # Should be discarded on cancellation
            self.assertEqual(len(server.events_clients), 0)


if __name__ == "__main__":
    unittest.main()
