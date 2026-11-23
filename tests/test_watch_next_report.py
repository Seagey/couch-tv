"""Why an untitled play never gets its Watch Next row (couch-tv#23): the matcher says so in the log
and in GET /api/watch-next, and a good row still names the play."""
import asyncio
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-wn-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import server  # noqa: E402

NETFLIX = {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja"}


def play(since_ago=300):
    now = time.time()
    return {"pkg": "com.netflix.ninja", "app": NETFLIX, "who": None, "since": now - since_ago,
            "last": now, "qualified": True, "done": False}


class Report(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        server.seen_playing.pop("_wn_rows", None)
        server.seen_playing["_untitled"] = None

    def test_each_way_a_row_can_fail_is_named(self):
        u = play()
        rows = [
            {"package": "com.netflix.ninja", "title": "Ozark", "engaged": None},
            {"package": "com.netflix.ninja", "title": "Dark", "engaged": u["since"] - 3600},
            {"package": "com.netflix.ninja", "title": "Netflix", "engaged": u["since"] + 5},
            {"package": "com.netflix.ninja", "title": "Narcos", "engaged": u["since"] + 5},
            {"package": "com.amazon.amazonvideo.livingroom", "title": "Citadel", "engaged": u["since"] + 5},
        ]
        rep = server.wn_report(rows, u, time.time())
        self.assertEqual(rep["rows"], 5)
        self.assertEqual(rep["apps"], {"com.netflix.ninja": 4, "com.amazon.amazonvideo.livingroom": 1})
        self.assertEqual([m["why"] for m in rep["for_this_app"]],
                         ["no engagement time", "engaged 3600 s before the play started",
                          "title is only the app's name", "matches"])

    async def test_no_row_logs_once_a_minute_and_does_not_name_the_play(self):
        u = play()
        server.seen_playing["_untitled"] = u
        server.seen_playing["_wn_rows"] = [
            {"package": "com.amazon.amazonvideo.livingroom", "title": "Citadel", "engaged": time.time()}]
        with patch.object(server, "log_seen", new=AsyncMock()) as seen, \
                patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)), \
                self.assertLogs(server.log, "INFO") as cm:
            await server.untitled_resolve()
            await server.untitled_resolve()
        seen.assert_not_called()
        lines = [m for m in cm.output if "no Watch Next row yet" in m]
        self.assertEqual(len(lines), 1)
        self.assertIn("1 rows from 1 apps, 0 for this app", lines[0])
        self.assertFalse(u["done"])

    async def test_a_good_row_still_names_the_play(self):
        u = play()
        server.seen_playing["_untitled"] = u
        server.seen_playing["_wn_rows"] = [
            {"package": "com.netflix.ninja", "title": "Ozark", "episode_title": "Ruling Days",
             "season": "1", "episode": "10", "poster": None, "engaged": time.time()}]
        with patch.object(server, "log_seen", new=AsyncMock()) as seen, \
                patch.object(server.tv, "adb_ready", new=AsyncMock(return_value=False)):
            await server.untitled_resolve()
        self.assertEqual(seen.call_args.args[0], "Ozark")
        self.assertTrue(u["done"])

    async def test_get_endpoint(self):
        u = play()
        server.seen_playing["_untitled"] = u
        server.seen_playing["_wn_rows"] = [
            {"package": "com.netflix.ninja", "title": "Ozark", "engaged": None}]
        server.seen_playing["_wn_at"] = time.time() - 10
        resp = await server.h_watch_next_get(None)
        import json
        j = json.loads(resp.text)
        self.assertTrue(j["ok"])
        self.assertEqual(j["untitled"]["package"], "com.netflix.ninja")
        self.assertEqual(j["report"]["for_this_app"][0]["why"], "no engagement time")
        self.assertGreaterEqual(j["received_s_ago"], 10)


if __name__ == "__main__":
    unittest.main()
