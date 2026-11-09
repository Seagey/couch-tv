"""LG power-on from the phone: a stale connection ends in Wake-on-LAN, a power-on from the phone
opens couch-tv even inside the quiet time, and a second "off" just after the TV went off turns it on."""
import asyncio
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg
import server

CFG = {"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1", "mac": "",
       "wake_on_lan": True, "extend_devmode": False}


def make_tv():
    t = lg.LGTV(dict(CFG))
    t.devmode_file = str(Path(tempfile.mkdtemp()) / "devmode.json")
    return t


class TurnOn(unittest.TestCase):
    def test_stale_connection_ends_in_wake_on_lan(self):
        t = make_tv()
        tried, woke = [], []

        async def request(uri, payload=None, timeout=6, pairing_wait=30):
            tried.append(uri)
            raise ConnectionResetError("Cannot write to closing transport")

        async def wake():
            woke.append(True)

        t._request, t.wake = request, wake
        asyncio.run(t._turn_on())
        self.assertEqual(tried, ["system/turnOn", "com.webos.service.tvpower/power/turnOnScreen"])
        self.assertEqual(woke, [True])

    def test_turn_on_that_takes_stops_there(self):
        t = make_tv()
        woke = []

        async def request(uri, payload=None, timeout=6, pairing_wait=30):
            return {}

        async def wake():
            woke.append(True)

        t._request, t.wake = request, wake
        asyncio.run(t._turn_on())
        self.assertEqual(woke, [])


class Hook(unittest.TestCase):
    def run_hook(self, t):
        launched = []

        async def read_visible():
            return "com.webos.app.home"

        async def launch(app_id, content_id=None, quiet=True):
            launched.append(app_id)

        t._read_visible, t._launch = read_visible, launch
        real_sleep = asyncio.sleep
        with patch("asyncio.sleep", new=lambda *_: real_sleep(0)):
            asyncio.run(t._hook())
        return launched

    def test_quiet_time_leaves_the_tv_alone(self):
        t = make_tv()
        t.quiet_until = time.monotonic() + 20   # Home was pressed just before it went off
        self.assertEqual(self.run_hook(t), [])

    def test_power_on_from_the_phone_opens_couch_tv_inside_the_quiet_time(self):
        t = make_tv()
        t.quiet_until = time.monotonic() + 20
        t.home_on_wake_until = time.monotonic() + 90
        self.assertEqual(self.run_hook(t), [t.app_id])
        self.assertEqual(t.home_on_wake_until, 0.0)

    def test_power_key_while_off_marks_a_wake(self):
        t = make_tv()

        async def launch(*a, **k):
            pass

        async def button(name):
            pass

        t._launch, t._button, t._turn_on = launch, button, (lambda: asyncio.sleep(0))
        asyncio.run(t.key("power"))
        self.assertGreater(t.home_on_wake_until, time.monotonic())


class SecondOff(unittest.TestCase):
    def test_off_again_right_after_off_turns_on(self):
        class FakeLG:
            connected = True
            is_on = False
            home_on_wake_until = 0.0

            async def _read_power(self):
                pass

        fake = FakeLG()
        asked = []

        async def power_on():
            asked.append("on")

        class Req:
            remote = "127.0.0.1"

            async def json(self):
                return {"state": "off"}

        tv_id = server._current.get()
        with patch.object(server, "tv", fake), patch.object(server, "power_on", power_on), \
                patch.object(server, "body", lambda r: r.json()), \
                patch.object(server, "record_action", lambda *a, **k: None), \
                patch.object(server, "push_now", lambda *a, **k: None), \
                patch.object(server, "_home_after_wake", lambda t: asyncio.sleep(0)), \
                patch.dict(server.power_off_at, {tv_id: time.monotonic() - 5}):
            asyncio.run(server.h_power(Req()))
        self.assertEqual(asked, ["on"])


if __name__ == "__main__":
    unittest.main()
