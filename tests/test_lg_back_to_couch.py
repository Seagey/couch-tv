"""LG back_to_couch: an app closing to LG's home reopens couch-tv; with back_to_couch_inputs, an app
closing straight to an HDMI input does too (holding Back in Netflix on an LG OLED65CX lands on the
Apple TV's HDMI 2). An input picked from LG's input screen, or couch-tv's own, is left alone."""
import asyncio
from pathlib import Path
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg

HOME, HDMI2, PICKER = "com.webos.app.home", "com.webos.app.hdmi2", "com.webos.app.homeconnect"


def tv(**cfg):
    return lg.LGTV({"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1", **cfg})


class ClosedTo(unittest.TestCase):
    def test_app_to_lg_home(self):
        self.assertTrue(tv(back_to_couch=True)._closed_to_couch_target("netflix", HOME))
        self.assertFalse(tv()._closed_to_couch_target("netflix", HOME))   # off by default

    def test_app_straight_to_an_input_only_when_asked(self):
        self.assertFalse(tv(back_to_couch=True)._closed_to_couch_target("netflix", HDMI2))
        t = tv(back_to_couch=True, back_to_couch_inputs=True)
        self.assertTrue(t._closed_to_couch_target("netflix", HDMI2))
        self.assertTrue(t._closed_to_couch_target("netflix", "com.webos.app.externalinput.av1"))
        # inputs alone does nothing without back_to_couch, and leave_inputs wins
        self.assertFalse(tv(back_to_couch_inputs=True)._closed_to_couch_target("netflix", HDMI2))
        self.assertFalse(tv(back_to_couch=True, back_to_couch_inputs=True, leave_inputs=True)
                         ._closed_to_couch_target("netflix", HDMI2))

    def test_picked_inputs_and_couch_tv_itself_are_left_alone(self):
        t = tv(back_to_couch=True, back_to_couch_inputs=True)
        self.assertFalse(t._closed_to_couch_target(PICKER, HDMI2))            # LG's input screen
        self.assertFalse(t._closed_to_couch_target(t.app_id, HDMI2))         # couch-tv's input tile
        self.assertFalse(t._closed_to_couch_target(lg.DEVMODE_APP, HOME))    # the daily Extend
        self.assertFalse(t._closed_to_couch_target("", HDMI2))
        self.assertFalse(t._closed_to_couch_target("com.webos.app.livetv", HDMI2))
        self.assertFalse(t._closed_to_couch_target("netflix", "youtube.leanback.v4"))   # app to app

    def test_quiet_after_a_command_and_while_extending(self):
        t = tv(back_to_couch=True, back_to_couch_inputs=True)
        t.quiet_until = time.monotonic() + 20   # the phone just switched the input
        self.assertFalse(t._closed_to_couch_target("netflix", HDMI2))
        t.quiet_until = 0
        t._extending = True
        self.assertFalse(t._closed_to_couch_target("netflix", HDMI2))


class Reopen(unittest.TestCase):
    def run_back(self, now, where):
        t = tv(back_to_couch=True, back_to_couch_inputs=True)
        launched = []

        async def read_visible():
            return now

        async def launch(app_id, **kw):
            launched.append(app_id)
        t._read_visible, t._launch = read_visible, launch
        asyncio.run(t._back_to_couch("netflix", where))
        return launched, t.hook_log

    def test_reopens_on_the_same_input(self):
        launched, log = self.run_back(HDMI2, HDMI2)
        self.assertEqual(launched, ["app.couchtv.home"])
        self.assertIn("netflix closed to com.webos.app.hdmi2, reopened couch-tv", log[-1][1])

    def test_still_reopens_on_lg_home(self):
        launched, log = self.run_back(HOME, HOME)
        self.assertEqual(launched, ["app.couchtv.home"])
        self.assertIn("closed to LG home", log[-1][1])

    def test_something_else_came_up_meanwhile(self):
        launched, _ = self.run_back("youtube.leanback.v4", HDMI2)
        self.assertEqual(launched, [])


if __name__ == "__main__":
    unittest.main()
