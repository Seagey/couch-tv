"""Keep watching when the TV's adb is down (seen 22 Nov 2026 on a real Google TV): port 5555 closes
after a restart or deep sleep, every adb call waits for a timeout, and the TV showed "Opening Ozark
in Netflix..." for a minute. Now, when the bridge knows adb is down, play() hands the show's link
over the remote protocol at once (without checking that it plays), or answers err_tv_link_lost when
that link is down too. With adb up, nothing changes."""
import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-adb-down-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import store  # noqa: E402
import server  # noqa: E402

LINK = "intent://www.netflix.com/title/80117552#Intent;scheme=https;package=com.netflix.ninja;end"
BEST = {"title": "Ozark", "year": 2017, "type": "tv", "jw_id": "ts1", "poster": None, "backdrop": None,
        "providers": [{"service": "netflix", "name": "Netflix", "playable": True, "kind": "flatrate",
                       "deeplink": LINK, "web": "https://www.netflix.com/title/80117552"}]}
# on that app, but with no link to hand over (only adb could search in the app)
NO_LINK = dict(BEST, providers=[dict(BEST["providers"][0], deeplink=None, web=None)])
LINE = {"id": "h-ozark", "title": "Ozark", "type": "tv", "service": "netflix", "season": 2, "episode": 3,
        "who": "person1"}


def request(data):
    req = MagicMock()
    req.headers = {}
    return req, patch.object(server, "body", new=AsyncMock(return_value=data))


async def never(*a, **kw):
    raise AssertionError("adb was used while it is known to be down")


class AdbKnownDown(unittest.TestCase):
    """tv.py's cheap flag: from the last connect, never a probe."""

    def setUp(self):
        self.t = server.TVS[next(iter(server.TVS))]
        self.saved = (self.t.adb_ok, self.t._adb_lost_at, self.t.adb_only)

    def tearDown(self):
        self.t.adb_ok, self.t._adb_lost_at, self.t.adb_only = self.saved

    def test_a_fresh_failure_is_down(self):
        self.t.adb_ok, self.t.adb_only, self.t._adb_lost_at = False, False, time.monotonic()
        self.assertTrue(self.t.adb_known_down)

    def test_never_tried_or_an_old_failure_is_not(self):
        self.t.adb_ok, self.t.adb_only = False, False
        self.t._adb_lost_at = None
        self.assertFalse(self.t.adb_known_down)
        self.t._adb_lost_at = time.monotonic() - self.t.ADB_LOST_FOR - 1
        self.assertFalse(self.t.adb_known_down)

    def test_connected_or_adb_only_is_not(self):
        self.t.adb_only, self.t._adb_lost_at = False, time.monotonic()
        self.t.adb_ok = True
        self.assertFalse(self.t.adb_known_down)
        self.t.adb_ok, self.t.adb_only = False, True
        self.assertFalse(self.t.adb_known_down)

    def test_one_background_reconnect_at_a_time_and_its_error_is_kept_quiet(self):
        t = self.t
        saved = t._adb_retry
        calls = []

        async def connect():
            calls.append(1)
            await asyncio.sleep(0.05)
            raise OSError("no route to host")

        async def go():
            with patch.object(t, "adb_connect", new=connect):
                a = t.retry_adb_soon()
                b = t.retry_adb_soon()   # while the first runs: the same one
                self.assertIs(a, b)
                await asyncio.gather(a, return_exceptions=True)
                c = t.retry_adb_soon()   # after it ended: a new one
                self.assertIsNot(a, c)
                await asyncio.gather(c, return_exceptions=True)

        t.adb_only = False
        try:
            asyncio.run(go())
        finally:
            t._adb_retry = saved
        self.assertEqual(len(calls), 2)

    def test_a_failed_connect_marks_it_and_a_good_one_clears_it(self):
        t = self.t
        t.adb_only, t.adb_ok, t._adb_lost_at = False, False, None
        saved = (t.paired, t.ip, t._signer)
        t.paired, t.ip, t._signer = True, "192.0.2.10", object()

        class Dev:
            ok = False

            def __init__(self, *a, **kw):
                pass

            async def connect(self, **kw):
                if not Dev.ok:
                    raise TimeoutError("timed out (9 seconds)")
                return True

            async def close(self):
                pass

        import tv as tvmod
        try:
            with patch.object(tvmod, "AdbDeviceTcpAsync", Dev):
                self.assertFalse(asyncio.run(t._adb_connect()))
                self.assertTrue(t.adb_known_down)
                Dev.ok = True
                self.assertTrue(asyncio.run(t._adb_connect()))
                self.assertFalse(t.adb_known_down)
                self.assertIsNone(t._adb_lost_at)
        finally:
            t.paired, t.ip, t._signer = saved
            t._dev = None


    def test_a_failed_connect_closes_its_socket_and_waits_for_allow(self):
        t = self.t
        t.adb_only, t.adb_ok, t._adb_lost_at = False, False, None
        saved = (t.paired, t.ip, t._signer)
        t.paired, t.ip, t._signer = True, "192.0.2.10", object()
        made = []

        class Dev:
            result = "raise"

            def __init__(self, *a, **kw):
                self.closed = 0
                self.kw = None
                made.append(self)

            async def connect(self, **kw):
                self.kw = kw
                if Dev.result == "raise":
                    raise TimeoutError("timed out (9 seconds)")
                return Dev.result

            async def close(self):
                self.closed += 1

        import tv as tvmod
        waits = []
        real_wait_for = asyncio.wait_for

        async def wait_for(aw, timeout):
            waits.append(timeout)
            return await real_wait_for(aw, timeout)

        try:
            with patch.object(tvmod, "AdbDeviceTcpAsync", Dev), patch.object(tvmod.asyncio, "wait_for", wait_for):
                self.assertFalse(asyncio.run(t._adb_connect()))
                self.assertEqual(made[-1].closed, 1, "a connect that raised is closed")
                self.assertEqual(made[-1].kw["auth_timeout_s"], 60, "a person has 60 s to press Allow")
                self.assertEqual(waits[-1], 75)
                self.assertIsNone(t._dev)
                Dev.result = False
                self.assertFalse(asyncio.run(t._adb_connect()))
                self.assertEqual(made[-1].closed, 1, "a refused connect is closed")
                self.assertIsNone(t._dev)
                Dev.result = True
                self.assertTrue(asyncio.run(t._adb_connect()))
                self.assertEqual(made[-1].closed, 0, "a good connect stays open")
                self.assertIs(t._dev, made[-1])
        finally:
            t.paired, t.ip, t._signer = saved
            t._dev = None


class ContinueWithAdbDown(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.t = server.TVS[next(iter(server.TVS))]
        server._current.set(self.t.id)
        server.playing["item"] = None
        t = self.t
        self.saved = {k: getattr(t, k) for k in ("paired", "remote", "connected", "adb_ok", "_adb_lost_at", "adb_only", "_adb_retry")}
        t.paired, t.adb_only = True, False
        t.remote = MagicMock()
        self.retry = MagicMock()   # the background adb reconnect: recorded here, run for real in one test
        self.patches = [
            patch.object(t, "retry_adb_soon", new=self.retry),
            patch.object(server.finder, "find", new=AsyncMock(return_value=(BEST, None))),
            patch.object(server.finder, "episode_providers", new=AsyncMock(return_value=None)),
            patch.object(server, "push_now"),
            patch.object(server, "record_action"),
            patch.object(server.store, "history_item", return_value=dict(LINE)),
            patch.object(server, "wn_fresher", side_effect=lambda h, rows: h),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        for k, v in self.saved.items():
            setattr(self.t, k, v)

    def adb_down(self, remote_up):
        t = self.t
        t.adb_ok, t._adb_lost_at, t.connected = False, time.monotonic(), remote_up

    async def open_card(self):
        req, b = request({"id": "h-ozark", "who": "person1"})
        with b:
            return await server.h_continue_open(req)

    async def test_adb_down_remote_up_opens_by_remote_at_once(self):
        self.adb_down(remote_up=True)
        inst = AsyncMock(return_value=None)
        with patch.object(self.t, "adb", new=never), patch.object(self.t, "adb_connect", new=never), \
                patch.object(self.t, "start_intent", new=never), patch.object(self.t, "front_package", new=never), \
                patch.object(server, "get_it_playing", new=never), patch.object(server, "installed_packages", new=inst):
            started = time.monotonic()
            resp = await self.open_card()
            took = time.monotonic() - started
        self.assertLess(took, 2.0)
        self.assertEqual(inst.await_args.kwargs.get("wait"), False)   # no waiting on adb for the app list
        self.t.remote.send_launch_app_command.assert_called_once_with("https://www.netflix.com/title/80117552")
        res = json.loads(resp.text)
        self.assertTrue(res["ok"])
        self.assertEqual(res["note_key"], "note_opened_title_page")
        self.assertEqual(res["note_vars"], {"title": "Ozark", "app": "Netflix"})
        self.assertEqual(res["note"], "Opened the Ozark page in Netflix.")
        self.assertNotIn("started", res)   # not checked, so not claimed
        self.retry.assert_called_once()     # and adb is tried again in the background, not waited on

    async def test_adb_down_and_the_tv_off_says_not_connected_at_once(self):
        """The TV is off or out of reach (the remote protocol is down too): that is what it says, not
        "lost its link", whose advice would be wrong."""
        self.adb_down(remote_up=False)
        with patch.object(self.t, "adb", new=never), patch.object(self.t, "adb_connect", new=never), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            started = time.monotonic()
            with self.assertRaises(server.TVUnavailable) as cm:
                await self.open_card()
            took = time.monotonic() - started
        self.assertLess(took, 2.0)
        self.assertEqual(cm.exception.key, "err_tv_not_connected")
        self.t.remote.send_launch_app_command.assert_not_called()

    async def test_adb_down_and_the_tv_off_with_no_link_says_not_connected(self):
        self.adb_down(remote_up=False)
        with patch.object(server.finder, "find", new=AsyncMock(return_value=(NO_LINK, None))), \
                patch.object(self.t, "adb", new=never), patch.object(self.t, "adb_connect", new=never), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            with self.assertRaises(server.TVUnavailable) as cm:
                await self.open_card()
        self.assertEqual(cm.exception.key, "err_tv_not_connected")

    async def test_adb_down_no_link_says_how_to_fix_the_link_at_once(self):
        """The TV is on (remote protocol up) but the show has no link to hand over: only adb could open
        it, so the answer is the fix for adb."""
        self.adb_down(remote_up=True)
        with patch.object(server.finder, "find", new=AsyncMock(return_value=(NO_LINK, None))), \
                patch.object(self.t, "adb", new=never), patch.object(self.t, "adb_connect", new=never), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            started = time.monotonic()
            with self.assertRaises(server.ApiError) as cm:
                await self.open_card()
            took = time.monotonic() - started
        self.assertLess(took, 2.0)
        e = cm.exception
        self.assertEqual((e.status, e.key), (503, "err_tv_link_lost"))
        self.assertEqual(e.message, "Couch TV lost its link to this TV. On the TV, switch Network debugging "
                                    "off and on in Developer options.")
        self.t.remote.send_launch_app_command.assert_not_called()

    async def test_adb_down_and_the_remote_refuses_the_link(self):
        self.adb_down(remote_up=True)
        self.t.remote.send_launch_app_command.side_effect = ConnectionResetError("gone")
        with patch.object(self.t, "adb", new=never), patch.object(self.t, "adb_connect", new=never), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            with self.assertRaises(server.ApiError) as cm:
                await self.open_card()
        self.assertEqual(cm.exception.key, "err_tv_link_lost")

    async def test_the_background_reconnect_brings_the_next_play_back_to_adb(self):
        """Someone follows the advice (Network debugging off and on): the reconnect play() started in
        the background succeeds, and the next press takes the normal adb path."""
        t = self.t
        self.adb_down(remote_up=True)
        self.retry.side_effect = lambda: server.TV.retry_adb_soon(t)

        async def back(*a, **kw):
            t.adb_ok, t._adb_lost_at = True, None
            return True

        with patch.object(t, "adb_connect", new=back), patch.object(t, "adb", new=never), \
                patch.object(t, "start_intent", new=never), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            res = json.loads((await self.open_card()).text)
            self.assertEqual(res["note_key"], "note_opened_title_page")
            self.assertIsNotNone(t._adb_retry)
            await t._adb_retry
        self.assertTrue(t.adb_ok)
        self.assertFalse(t.adb_known_down)
        t.remote.send_launch_app_command.reset_mock()
        start = AsyncMock(return_value="adb")
        with patch.object(t, "start_intent", new=start), \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value="com.netflix.ninja")), \
                patch.object(t, "front_package", new=AsyncMock(return_value="com.netflix.ninja")), \
                patch.object(server, "get_it_playing", new=AsyncMock(return_value=(True, None))), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)):
            res = json.loads((await self.open_card()).text)
        self.assertEqual(start.await_args.args[0], LINK)
        t.remote.send_launch_app_command.assert_not_called()
        self.assertEqual(res["note_key"], "note_playing_in_app")
        self.assertEqual(self.retry.call_count, 1)   # adb up: no second reconnect

    async def test_adb_up_takes_the_same_path_as_before(self):
        t = self.t
        t.adb_ok, t._adb_lost_at, t.connected = True, None, True
        start = AsyncMock(return_value="adb")
        playing = AsyncMock(return_value=(True, None))
        with patch.object(t, "start_intent", new=start), \
                patch.object(t, "wait_for_app", new=AsyncMock(return_value="com.netflix.ninja")), \
                patch.object(t, "front_package", new=AsyncMock(return_value="com.netflix.ninja")), \
                patch.object(server, "get_it_playing", new=playing), \
                patch.object(server, "installed_packages", new=AsyncMock(return_value=None)) as inst:
            resp = await self.open_card()
        self.assertEqual(inst.await_args.kwargs.get("wait"), True)
        self.assertEqual(start.await_args.args[0], LINK)
        playing.assert_awaited_once()
        t.remote.send_launch_app_command.assert_not_called()
        res = json.loads(resp.text)
        self.assertEqual(res["note_key"], "note_playing_in_app")
        self.assertTrue(res["started"])


if __name__ == "__main__":
    unittest.main()
