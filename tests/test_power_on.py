"""power_on keeps waiting when the TV refuses a key while it is still starting up (#56)."""
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import server


class FakeLG:
    """Connected, in standby, refuses POWER with a plain exception, then reports on a moment later."""
    connected = True

    def __init__(self):
        self._on = False
        self.keys = []

    @property
    def is_on(self):
        return self._on

    async def key(self, name):
        self.keys.append(name)
        asyncio.get_running_loop().call_later(0.3, self._come_on)
        raise RuntimeError("busy starting up")

    async def wake(self):
        pass

    def _come_on(self):
        self._on = True


class PowerOnTests(unittest.IsolatedAsyncioTestCase):
    async def test_refused_key_does_not_fail_the_request(self):
        fake = FakeLG()
        with patch.object(server, "tv", fake):
            await server.power_on()   # must not raise
        self.assertEqual(fake.keys, ["power"])
        self.assertTrue(fake.is_on)

    async def test_still_unavailable_when_it_never_comes_on(self):
        fake = FakeLG()
        fake.key = lambda name: (_ for _ in ()).throw(RuntimeError("busy"))
        with patch.object(server, "tv", fake), patch.object(server, "POWER_ON_BUDGET", 1):
            with self.assertRaises(server.TVUnavailable):
                await server.power_on()


if __name__ == "__main__":
    unittest.main()
