"""The finish screen's extras (live.py, lane D 28 Nov 2026): Ask AI into the account, the lines for your own AI, the TV's apps,
and what the watching widgets read on this TV. A pretend TV and a pretend account: no real TV, adb or network is used."""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import live, studio  # noqa: E402
from couchtv_setup.helper import config as hconfig  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402

WATCH_NEXT_OUT = (
    "Row: 0 _id=4, title=Bluey, package_name=au.net.abc.iview, browsable=1, last_engagement_time_utc_millis=1764300000000\n"
    "Row: 1 _id=5, title=The Bear, package_name=com.disney.disneyplus, browsable=1, last_engagement_time_utc_millis=1764400000000\n"
    "Row: 2 _id=6, title=Hidden one, package_name=com.netflix.ninja, browsable=0, last_engagement_time_utc_millis=1764500000000\n"
    "Row: 3 _id=7, title=NULL, package_name=com.netflix.ninja, browsable=1, last_engagement_time_utc_millis=NULL\n")
SESSIONS_OUT = """Sessions Stack - have 2 sessions:
    Spotify com.spotify.tv.android/spotify/1 (userId=0)
      package=com.spotify.tv.android
      active=true
      state=PlaybackState {state=PLAYING(3), position=1000, buffered position=0, speed=1.0, updated=5, actions=3, custom actions=[], active item id=-1, error=null}
      metadata: size=6, description=Riptide, Vance Joy, Dream Your Life Away
    YouTube com.google.android.youtube.tv/x (userId=0)
      package=com.google.android.youtube.tv
      state=PlaybackState {state=2, position=0, buffered position=0, speed=0.0, updated=5, actions=3}
"""


class Tv:
    def __init__(self, answers=None, fail=()):
        self.answers, self.fail, self.log = answers or {}, fail, []

    def shell(self, cmd, timeout_s=60):
        self.log.append(cmd)
        for k in self.fail:
            if k in cmd:
                raise TvError("The TV stopped answering", "lost")
        for k, v in self.answers.items():
            if k in cmd:
                return v
        return ""


class Link:
    def __init__(self, signed=True, tv=True):
        self.token = "tok" if signed else None
        self.tv = {"tv_id": "22222222-2222-4222-8222-222222222222"} if tv else None
        self.account = {"email": "me@example.com"}


class S:
    def __init__(self, link=None, tv=None, facts=None):
        self.link, self.tv, self.ip = link or Link(), tv, "192.0.2.20"
        self.facts = facts if facts is not None else {"name": "Lounge TV", "installed": {"home": "0.13.16", "ontv": None}}
        self.profile = {"apps": ["com.netflix.ninja"]}
        self.live_apps = None


def need(s):
    def f():
        if not s.tv:
            raise TvError("This computer is not connected to the TV. Find the TV again.", "no_tv")
        return s.tv
    return f


class AskAi(unittest.TestCase):
    def test_saved_to_the_account_with_https_and_this_tv_only(self):
        sent = {}

        def call(path, body, token=None, timeout=15):
            sent.update(path=path, body=body, token=token)
            return {"kind": "ai", "shown": {"last4": "7Kq2", "provider": "anthropic"}, "money_line": live.MONEY_LINE, "trusted": True, "sent": True}
        with mock.patch.object(studio, "call", call):
            r = live.route("ask-save", {"provider": "anthropic", "key": " sk-ant-SECRET 7Kq2 ", "model": ""}, S(), None)
        self.assertEqual(sent["path"], "/v1/setup/key")
        self.assertEqual(sent["token"], "tok")
        self.assertEqual(sent["body"]["kind"], "ai")
        self.assertEqual(sent["body"]["tv_id"], "22222222-2222-4222-8222-222222222222")
        self.assertEqual(sent["body"]["base"], "https://api.anthropic.com", "the service's own address, never one typed for a known one")
        self.assertEqual(sent["body"]["key"], "sk-ant-SECRET7Kq2", "spaces taken out")
        self.assertEqual(sent["body"]["model"], "claude-haiku-5-5")
        self.assertEqual(r["last4"], "7Kq2")
        self.assertTrue(r["sent"])
        self.assertIn("spend your money", r["money_line"])
        self.assertNotIn("SECRET", json.dumps(r), "the key is never handed back to the page")

    def test_refused_before_anything_is_sent(self):
        with mock.patch.object(studio, "call", side_effect=AssertionError("must not call the account")):
            for body, code in [({"provider": "other", "base": "http://api.example.com/v1", "key": "abcdefghij"}, "bad_base"),
                               ({"provider": "other", "base": "https://a.example/v1?x=1", "key": "abcdefghij"}, "bad_base"),
                               ({"provider": "anthropic", "key": "short"}, "bad_key"),
                               ({"provider": "local", "key": "abcdefghij"}, "bad_provider"),
                               ({"provider": "nope", "key": "abcdefghij"}, "bad_provider")]:
                with self.assertRaises(TvError) as e:
                    live.route("ask-save", body, S(), None)
                self.assertEqual(e.exception.code, code, body)
            for link in (Link(signed=False), Link(tv=False)):
                with self.assertRaises(TvError) as e:
                    live.route("ask-save", {"provider": "anthropic", "key": "abcdefghij"}, S(link=link), None)
                self.assertEqual(e.exception.code, "no_account")

    def test_other_service_takes_its_https_address(self):
        sent = {}
        with mock.patch.object(studio, "call", lambda p, b, t=None, timeout=15: sent.update(b) or {"shown": {}}):
            live.route("ask-save", {"provider": "other", "base": "https://llm.example.com/v1/", "key": "abcdefghij"}, S(), None)
        self.assertEqual(sent["base"], "https://llm.example.com/v1")

    def test_remove(self):
        sent = {}
        with mock.patch.object(studio, "call", lambda p, b, t=None, timeout=15: sent.update(b) or {"removed": True}):
            self.assertEqual(live.route("ask-remove", {}, S(), None), {"removed": True})
        self.assertTrue(sent["remove"])

    def test_state_lists_no_local_model_and_says_the_money_line(self):
        st = live.route("state", {}, S(), None)
        self.assertNotIn("local", [p["id"] for p in st["providers"]])
        self.assertIn("spend your money", st["money_line"])
        self.assertTrue(st["linked"])
        self.assertEqual(st["tv"], "Lounge TV")


class OwnAi(unittest.TestCase):
    def test_lines_use_the_helper_when_it_is_on(self):
        hconfig.turn_on(False)
        try:
            r = live.route("agent-helper", {}, S(), None)
        finally:
            hconfig.turn_off()
        self.assertTrue(r["helper"])
        self.assertEqual(r["url"], "http://127.0.0.1:5400")
        d = json.loads("{" + r["desktop"].strip()[1:-1] + "}")["couch-tv"]
        self.assertIn("--mcp", d["args"])
        self.assertEqual(d["env"]["BRIDGE_URL"], "http://127.0.0.1:5400")
        self.assertRegex(d["env"]["BRIDGE_KEY"], r"^[A-Za-z0-9_-]{12,}$")
        self.assertIn("claude mcp add couch-tv --env BRIDGE_URL=http://127.0.0.1:5400", r["code"])
        self.assertIn("--mcp", r["code"])

    def test_no_helper_says_so(self):
        hconfig.turn_off()
        self.assertEqual(live.route("agent-helper", {}, S(), None), {"helper": False})

    def test_tv_app_pairing(self):
        s = S(tv=Tv())
        calls = []

        def tv_call(ip, path, body):
            calls.append((ip, path, body))
            return {"token": "AbCdEfGhIjKlMnOp"} if path == "/api/pair" else {"ok": True}
        with mock.patch.object(live, "_tv_call", tv_call):
            live.route("agent-tv-code", {}, s, need(s))
            with self.assertRaises(TvError):
                live.route("agent-tv-pair", {"pin": "12a"}, s, need(s))
            r = live.route("agent-tv-pair", {"pin": "123 456"}, s, need(s))
        self.assertEqual(calls[0][1], "/api/pair/start")
        self.assertEqual(calls[1], ("192.0.2.20", "/api/pair", {"pin": "123456", "name": "My AI"}))
        self.assertEqual(r["url"], "http://192.0.2.20:5400")
        self.assertIn("AbCdEfGhIjKlMnOp", r["desktop"])

    def test_paths_with_spaces_are_quoted_for_the_shell(self):
        with mock.patch.object(live, "mcp_command", lambda: ("/Applications/Couch TV Setup.app/Contents/MacOS/Couch TV Setup", ["--mcp"])):
            r = live.agent_lines("http://127.0.0.1:5400", "keykeykeykeykey")
        self.assertIn('-- "/Applications/Couch TV Setup.app/Contents/MacOS/Couch TV Setup" --mcp', r["code"])


class Apps(unittest.TestCase):
    def test_read_and_send_names_only(self):
        tv = Tv({"LEANBACK_LAUNCHER": "priority=0\ncom.netflix.ninja/.Main\nau.net.abc.iview/.Main\napp.couchtv.launcher/.Main",
                 "category.LAUNCHER": "com.spotify.tv.android/.Main\ncom.netflix.ninja/.Main"})
        s = S(tv=tv)
        r = live.route("apps", {}, s, need(s))
        self.assertEqual([a["pkg"] for a in r["apps"]], ["com.netflix.ninja", "au.net.abc.iview", "com.spotify.tv.android"])
        self.assertEqual([a["name"] for a in r["apps"]], ["Netflix", "ABC iview", "Spotify"])
        self.assertTrue(all(not c.startswith(("pm disable", "pm uninstall", "am ", "settings put")) for c in tv.log), "read only")
        sent = {}
        with mock.patch.object(studio, "call", lambda p, b, t=None, timeout=15: sent.update(path=p, body=b) or {"apps": 3}):
            live.route("apps-send", {}, s, need(s))
        self.assertEqual(sent["path"], "/v1/setup/apps")
        self.assertEqual(sent["body"]["apps"], ["com.netflix.ninja", "au.net.abc.iview", "com.spotify.tv.android"])

    def test_unknown_app_gets_a_plain_name(self):
        self.assertEqual(live.app_name("com.example.coolplayer"), "Coolplayer")

    def test_send_needs_the_account(self):
        with self.assertRaises(TvError):
            live.route("apps-send", {}, S(link=Link(signed=False), tv=Tv()), None)


class Watch(unittest.TestCase):
    def test_watch_next_and_now_playing_are_read_and_nothing_changes(self):
        tv = Tv({"watch_next_program": WATCH_NEXT_OUT, "dumpsys media_session": SESSIONS_OUT})
        s = S(tv=tv)
        r = live.route("watch", {}, s, need(s))
        self.assertEqual(r["keep"]["count"], 2, "hidden and untitled rows are left out")
        self.assertEqual(r["keep"]["shows"][0], {"title": "The Bear", "app": "Disney+"}, "newest first")
        self.assertEqual(r["now"]["playing"], {"title": "Riptide", "app": "Spotify"})
        self.assertTrue(r["now"]["spotify_only"], "no Couch TV app on the TV: Spotify only")
        self.assertEqual(len(tv.log), 2)
        self.assertTrue(all(c.startswith(("content query", "dumpsys")) for c in tv.log), "read only")

    def test_with_the_tv_app_any_music_app(self):
        s = S(tv=Tv(), facts={"name": "Lounge TV", "installed": {"home": "0.13.16", "ontv": "0.13.16"}})
        r = live.route("watch", {}, s, need(s))
        self.assertTrue(r["now"]["any_app"])
        self.assertEqual(r["keep"]["count"], 0)

    def test_a_tv_that_will_not_answer(self):
        s = S(tv=Tv(fail=("content query", "dumpsys")))
        r = live.route("watch", {}, s, need(s))
        self.assertFalse(r["keep"]["ok"])
        self.assertIsNone(r["now"]["playing"])

    def test_no_tv(self):
        s = S(tv=None)
        with self.assertRaises(TvError):
            live.route("watch", {}, s, need(s))

    def test_old_android_numbers(self):
        self.assertTrue(live.parse_sessions("package=x\nstate=PlaybackState {state=3, position=0}")[0]["playing"])
        self.assertFalse(live.parse_sessions("package=x\nstate=PlaybackState {state=2, position=0}")[0]["playing"])


if __name__ == "__main__":
    unittest.main()
