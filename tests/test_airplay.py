"""AirPlay 2 speaker groups for the Speakers widget (bridge/airplay.py, GET /api/airplay, POST /api/airplay/play, /stop, /volume).

Never against real speakers (the owner's rule): every test drives a pretend Music.app (airplay.FakeMusic) through the
injected run_osascript, so no AppleScript runs and nothing plays anywhere."""
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp.test_utils import AioHTTPTestCase

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import airplay  # noqa: E402
import config  # noqa: E402
import server  # noqa: E402


def room(cfg=None, music=None):
    d = tempfile.mkdtemp()
    m = music or airplay.FakeMusic()
    return airplay.AirPlay(d, cfg if cfg is not None else {"groups": [{"name": "Downstairs", "speakers": ["Lounge", "Kitchen", "Nowhere"]}]},
                           run_osascript=m, platform="darwin", which=lambda n: None), m, d


class Module(unittest.IsolatedAsyncioTestCase):
    async def test_off_without_config_or_off_a_mac(self):
        a = airplay.AirPlay(tempfile.mkdtemp(), None, platform="darwin", which=lambda n: None)
        self.assertFalse(a.enabled)
        self.assertEqual(a.state(), {"available": False, "reason": "off"})
        b = airplay.AirPlay(tempfile.mkdtemp(), {"groups": []}, platform="linux", which=lambda n: None)
        self.assertFalse(b.enabled)
        self.assertEqual(b.state()["reason"], "mac")
        self.assertEqual(await b.read_devices(), {})

    async def test_reads_speakers_names_and_volume_only(self):
        a, m, _ = room()
        await a.read_devices(force=True)
        st = a.state()
        self.assertTrue(st["available"])
        names = [s["name"] for s in st["speakers"]]
        self.assertEqual(names, ["Lounge", "Kitchen", "Deck"])          # this Mac itself is never a speaker
        self.assertEqual(st["speakers"][0], {"name": "Lounge", "available": True, "selected": False, "volume": 40})
        self.assertFalse(st["spotify"])                                   # no librespot here: speakers and volume only
        self.assertEqual(st["groups"], [{"name": "Downstairs", "speakers": ["Lounge", "Kitchen", "Nowhere"]}])
        self.assertNotIn("http", repr(st))

    async def test_play_a_group_takes_only_known_speakers(self):
        a, m, d = room()
        await a.activate(group="downstairs")
        self.assertEqual(m.current, ["Lounge", "Kitchen"])               # "Nowhere" is not a speaker Music lists
        self.assertTrue(a.active)
        self.assertEqual(a.selected, ["Lounge", "Kitchen"])
        self.assertTrue(os.path.exists(os.path.join(d, "airplay.json")))
        await a.release()
        self.assertFalse(a.active)
        self.assertEqual(m.current, ["This Mac"])

    async def test_refuses_names_music_does_not_list(self):
        a, m, _ = room()
        with self.assertRaises(ValueError):
            await a.activate(speakers=['Evil" & do shell script "x', "This Mac"])
        with self.assertRaises(ValueError):
            await a.activate(group="Upstairs")
        with self.assertRaises(ValueError):
            await a.set_volume("Garage", 10)
        self.assertFalse(any("do shell script" in s for s in m.scripts))

    async def test_quotes_names_in_applescript(self):
        m = airplay.FakeMusic()
        m.devices['Kid\'s "Room"'] = {"kind": "AirPlay device", "available": True, "volume": 10}
        a, _, _ = room({"groups": []}, m)
        await a.read_devices(force=True)
        # a name with a double quote is never a name we accept (clean_name), so it cannot reach AppleScript
        self.assertNotIn('Kid\'s "Room"', [s["name"] for s in a.speakers()])
        self.assertEqual(airplay._q('a"b\\c'), '"a\\"b\\\\c"')

    async def test_volume_clamped_and_set(self):
        a, m, _ = room()
        await a.read_devices(force=True)
        await a.set_volume("kitchen", 140)
        self.assertEqual(m.devices["Kitchen"]["volume"], 100)
        await a.set_volume("Kitchen", 25)
        self.assertEqual(a.seen["Kitchen"]["volume"], 25)

    async def test_unavailable_speakers_alone_fail(self):
        a, m, _ = room()
        with self.assertRaises(RuntimeError):
            await a.activate(speakers=["Deck"])                          # Music lists it but it is not answering
        self.assertFalse(a.active)

    def test_clean_groups(self):
        g = airplay.clean_groups([{"name": "A", "speakers": ["x", "X", ""]}, {"name": "", "speakers": ["y"]}, "bad"] + [{"name": "G%d" % i, "speakers": ["s"]} for i in range(9)])
        self.assertEqual(g[0], {"name": "A", "speakers": ["x"]})
        self.assertEqual(len(g), airplay.MAX_GROUPS)


class Routes(AioHTTPTestCase):
    async def get_application(self):
        self.fake = airplay.FakeMusic()
        self.patch = patch.object(server, "AIRPLAY", airplay.AirPlay(tempfile.mkdtemp(), {"groups": [{"name": "Downstairs", "speakers": ["Lounge", "Kitchen"]}]},
                                                                      run_osascript=self.fake, platform="darwin", which=lambda n: None))
        self.patch.start()
        self.key = patch.object(config, "PAIRING_KEY", "")
        self.key.start()
        return server.make_app()

    async def tearDownAsync(self):
        self.patch.stop()
        self.key.stop()

    async def test_get_play_volume_stop(self):
        r = await self.client.get("/api/airplay")
        j = await r.json()
        self.assertEqual([s["name"] for s in j["airplay"]["speakers"]], ["Lounge", "Kitchen", "Deck"])
        r = await self.client.post("/api/airplay/play", json={"group": "Downstairs"})
        j = await r.json()
        self.assertTrue(j["result"]["ok"])
        self.assertTrue(j["airplay"]["active"])
        self.assertEqual(self.fake.current, ["Lounge", "Kitchen"])
        r = await self.client.post("/api/airplay/volume", json={"name": "Lounge", "value": 55})
        self.assertTrue((await r.json())["result"]["ok"])
        self.assertEqual(self.fake.devices["Lounge"]["volume"], 55)
        r = await self.client.post("/api/airplay/volume", json={"name": "Lounge", "value": "loud"})
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/airplay/play", json={"speakers": ["Nobody"]})
        self.assertEqual((await r.json())["result"], {"ok": False, "error": "speakers"})
        r = await self.client.post("/api/airplay/stop", json={})
        j = await r.json()
        self.assertFalse(j["airplay"]["active"])


if __name__ == "__main__":
    unittest.main()
