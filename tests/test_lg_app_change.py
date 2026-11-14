"""LG: the watcher hears at once when the app in front changes (the foreground app subscription),
and still notices a change by itself on a firmware that sends no message."""
import asyncio
from pathlib import Path
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg

CFG = {"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1"}


class AppChange(unittest.TestCase):
    def test_message_ends_the_wait_at_once(self):
        async def run():
            t = lg.LGTV(dict(CFG))
            t.visible = "netflix"
            async def tv_says_changed():
                await asyncio.sleep(0.05)
                t._fg_changed.set()
            asyncio.ensure_future(tv_says_changed())
            t0 = time.monotonic()
            await t._wait_app_change(2.0)
            return time.monotonic() - t0
        self.assertLess(asyncio.run(run()), 0.5)

    def test_no_message_still_noticed_by_looking(self):
        async def run():
            t = lg.LGTV(dict(CFG))
            t.visible = "netflix"
            async def read_visible():
                return "com.webos.app.home"   # the app closed, but no message came
            t._read_visible = read_visible
            t0 = time.monotonic()
            await t._wait_app_change(2.0, look_every=0.1)
            return time.monotonic() - t0
        self.assertLess(asyncio.run(run()), 0.5)

    def test_nothing_changes_waits_the_whole_time(self):
        async def run():
            t = lg.LGTV(dict(CFG))
            t.visible = "netflix"
            async def read_visible():
                return "netflix"
            t._read_visible = read_visible
            t0 = time.monotonic()
            await t._wait_app_change(0.4, look_every=0.1)
            return time.monotonic() - t0
        self.assertGreaterEqual(asyncio.run(run()), 0.39)

    def test_subscription_messages_do_not_answer_requests(self):
        # the subscription's own messages set the flag and are not taken for a reply
        t = lg.LGTV(dict(CFG))
        self.assertEqual(lg.FG_SUB, "fg-sub")
        self.assertNotIn(lg.FG_SUB, t._pending)


if __name__ == "__main__":
    unittest.main()
