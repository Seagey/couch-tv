"""LG remote port memory and the Developer Mode wait (couch-tv#71, webOS 10.3.2).

Newer webOS resets port 3000 and only answers on 3001, so the TV that worked on 3001 is remembered
(in this run and across a restart) and tried first. Older webOS, where 3000 works, is unchanged.
After Developer Mode's Extend, its own app takes about 5 s to appear: couch-tv waits for it (up to
20 s) before going back on top.
"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg

CFG = {"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1", "mac": "",
       "wake_on_lan": True, "extend_devmode": False}


def make_tv(**extra):
    d = Path(tempfile.mkdtemp())
    with patch.object(lg.config, "DATA", str(d)):
        t = lg.LGTV({**CFG, **extra})
    t.ip, t.connected = "192.0.2.1", True
    return t, d


class FakeWS:
    closed = False

    async def close(self):
        self.closed = True


class FakeSession:
    """The TV: answers only on the ports in `works`, resets the rest straight away."""
    def __init__(self, works):
        self.works, self.tried = works, []

    async def ws_connect(self, url, **kw):
        self.tried.append(url)
        if int(url.rsplit(":", 1)[1]) not in self.works:
            raise ConnectionResetError("Connection reset by peer")
        return FakeWS()


def connect(t, works):
    session = FakeSession(works)

    async def http():
        return session

    async def handshake(ws, pairing_wait):
        pass

    async def read(ws):
        pass

    t._http, t._handshake, t._read = http, handshake, read
    asyncio.run(t._remote())
    return session


class RemotePort(unittest.TestCase):
    def test_old_webos_tries_3000_first_and_stays_there(self):
        t, d = make_tv()
        s = connect(t, {3000, 3001})
        self.assertEqual(s.tried, ["ws://192.0.2.1:3000"])
        self.assertEqual(json.loads((d / "lg-test-port.json").read_text()), {"port": 3000})

    def test_3001_only_tv_is_tried_second_once_then_first(self):
        t, d = make_tv()
        s = connect(t, {3001})
        self.assertEqual(s.tried, ["ws://192.0.2.1:3000", "wss://192.0.2.1:3001"])
        self.assertEqual(json.loads((d / "lg-test-port.json").read_text()), {"port": 3001})
        # the same run, a dropped connection: straight to 3001
        t._ws = None
        s = connect(t, {3001})
        self.assertEqual(s.tried, ["wss://192.0.2.1:3001"])

    def test_a_restart_goes_straight_to_the_port_that_worked(self):
        t, d = make_tv()
        connect(t, {3001})
        with patch.object(lg.config, "DATA", str(d)):
            fresh = lg.LGTV(dict(CFG))
        fresh.ip, fresh.connected = "192.0.2.1", True
        s = connect(fresh, {3001})
        self.assertEqual(s.tried, ["wss://192.0.2.1:3001"])

    def test_a_remembered_port_that_stops_working_falls_back_and_is_updated(self):
        t, d = make_tv()
        connect(t, {3001})
        with patch.object(lg.config, "DATA", str(d)):
            fresh = lg.LGTV(dict(CFG))
        fresh.ip, fresh.connected = "192.0.2.1", True
        s = connect(fresh, {3000})   # firmware changed its mind
        self.assertEqual(s.tried, ["wss://192.0.2.1:3001", "ws://192.0.2.1:3000"])
        self.assertEqual(json.loads((d / "lg-test-port.json").read_text()), {"port": 3000})

    def test_a_port_set_in_config_is_the_only_one(self):
        t, d = make_tv(port=3001)
        s = connect(t, {3001})
        self.assertEqual(s.tried, ["wss://192.0.2.1:3001"])
        self.assertFalse((d / "lg-test-port.json").exists())

    def test_a_damaged_port_file_is_ignored(self):
        d = Path(tempfile.mkdtemp())
        (d / "lg-test-port.json").write_text("not json")
        with patch.object(lg.config, "DATA", str(d)):
            t = lg.LGTV(dict(CFG))
        t.ip = "192.0.2.1"
        self.assertEqual(t._urls(), ["ws://192.0.2.1:3000", "wss://192.0.2.1:3001"])


class DevModeWait(unittest.TestCase):
    def run_extend(self, shows_after, ok=True):
        """Developer Mode's app shows `shows_after` (fake) seconds after Extend; None means never.
        Returns (launches, clock_seconds_waited)."""
        t, _ = make_tv()
        clock = {"now": 0.0}
        launches = []
        t.leave_inputs = False
        t.quiet_until = 0.0

        async def visible():
            if clock["now"] == 0.0 and not clock.get("extended"):
                return t.app_id
            if shows_after is not None and clock["now"] >= shows_after:
                return lg.DEVMODE_APP
            return t.app_id

        async def extend():
            clock["extended"] = True
            return ok

        async def launch(app_id, content_id=None, quiet=True):
            launches.append((app_id, clock["now"]))

        async def fake_sleep(sec):
            clock["now"] += sec

        t._read_visible, t.extend_devmode_now, t._launch = visible, extend, launch
        with patch("asyncio.sleep", new=fake_sleep), \
                patch.object(lg.time, "monotonic", new=lambda: clock["now"]):
            asyncio.run(t._daily_extend())
        return t, launches, clock["now"]

    def test_waits_for_the_devmode_app_then_puts_couch_tv_back_on_top(self):
        t, launches, waited = self.run_extend(shows_after=5.0)
        self.assertEqual([a for a, _ in launches], [t.app_id])
        self.assertGreaterEqual(launches[0][1], 5.0)     # not after a fixed 2 s
        self.assertLess(waited, 8.0)

    def test_gives_up_after_20_seconds_if_it_never_shows(self):
        t, launches, waited = self.run_extend(shows_after=None)
        self.assertGreaterEqual(waited, 20.0)
        self.assertLess(waited, 22.0)
        self.assertEqual(launches, [])   # couch-tv never left, so nothing to put back

    def test_a_failed_extend_keeps_the_short_wait(self):
        t, launches, waited = self.run_extend(shows_after=1.0, ok=False)
        self.assertLessEqual(waited, 2.0)
        self.assertEqual([a for a, _ in launches], [t.app_id])


if __name__ == "__main__":
    unittest.main()
