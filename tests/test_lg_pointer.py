"""POST /api/pointer: LG only, values clamped, and the pointer socket gets move, scroll and click."""
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg
import server


class Req:
    def __init__(self, data):
        self.data = data

    async def json(self):
        return self.data


class Endpoint(unittest.TestCase):
    def call(self, fake, data):
        with patch.object(server, "tv", fake), patch.object(server, "body", lambda r: r.json()):
            return asyncio.run(server.h_pointer(Req(data)))

    def test_lg_gets_clamped_values(self):
        got = []

        class FakeLG:
            def require(self):
                pass

            async def pointer(self, dx, dy, click, scroll):
                got.append((dx, dy, click, scroll))

        self.call(FakeLG(), {"dx": 1000, "dy": -5, "click": True, "scroll": -900})
        self.assertEqual(got, [(400, -5, True, -400)])

    def test_other_tvs_are_refused(self):
        class FakeOther:
            def require(self):
                pass

        with self.assertRaises(server.ApiError):
            self.call(FakeOther(), {"dx": 3})


class Socket(unittest.TestCase):
    def test_messages_on_the_pointer_socket(self):
        sent = []

        class WS:
            async def send_str(self, m):
                sent.append(m)

        t = lg.LGTV({"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1"})

        async def pointer_ws():
            return WS()

        t._pointer = pointer_ws
        asyncio.run(t.pointer(5, -3, click=True, scroll=20))
        self.assertEqual(sent, ["type:move\ndx:5\ndy:-3\ndown:0\n\n", "type:scroll\ndx:0\ndy:20\n\n", "type:click\n\n"])


if __name__ == "__main__":
    unittest.main()
