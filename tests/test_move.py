"""Move what is playing to another TV (POST /api/move, #268): the steps, in order, on two pretend TVs."""
import asyncio
import os
import time
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-move-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import move  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402
import tv as tvmod  # noqa: E402

NETFLIX, YOUTUBE = "com.netflix.ninja", "com.google.android.youtube.tv"
A, B = "tv-a", "tv-b"


REAL_PLAY = server.play     # the tests below put a pretend one in its place


class FakeTV:
    """A pretend Android TV: remembers every key, ADB line and link it was sent."""
    kind = "android"
    paired = True
    connected = True

    def __init__(self, tv_id, name, log, front=None, on=True):
        self.id, self.name, self.log = tv_id, name, log
        self.front, self.is_on = front, on
        self.adb_out = ""          # what `dumpsys media_session` and the sync helper answer
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}

    def require(self):
        pass

    async def adb_ready(self):
        return True

    async def front_package(self):
        return self.front

    async def key(self, name, hold=False):
        self.log.append((self.id, "key", name))

    async def adb(self, *args, **kw):
        self.log.append((self.id, "adb", " ".join(args)))
        return self.adb_out

    async def start_intent(self, uri, package=None, cold=False):
        self.log.append((self.id, "link", uri, package, cold))
        self.front = package
        return "adb"

    async def wait_for_app(self, packages, timeout=8.0):
        return self.front


def playing(title, pos, state="playing", **extra):
    return {"title": title, "state": state, "position_ms": pos, "season": None, "episode": None} | extra


class MoveSteps(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.log = []
        self.a = FakeTV(A, "Lounge", self.log, front=NETFLIX)
        self.b = FakeTV(B, "Den", self.log)
        self.media = {A: playing("Some Show", 600_000, season=2, episode=3), B: None}
        self.after_seek = None       # what TV B reports once a seek or a timed link has gone out
        self.started = True          # does the show start playing on TV B
        self.installed = {NETFLIX, YOUTUBE}
        self.video = "abcdefghijk"
        for f in (store.WHO_FILE,):
            if os.path.exists(f):
                os.remove(f)
        store._cache.clear()
        store.save_who("person1", A)
        store.save_who("person2", B)

        async def media_read(pkg, app):
            tv_id = server._current.get()
            if tv_id == B and self.after_seek is not None and any(
                    e[0] == B and ("op seek" in str(e[2:]) or "&t=" in str(e[2:])) for e in self.log):
                self.media[B] = self.after_seek
            got = self.media[tv_id]
            self.log.append((tv_id, "read"))
            server.media_now.clear()
            if got is None:
                return None
            server.media_now.update(got, package=pkg)
            return {"title": got["title"], "subtitle": got.get("channel"), "duration": got.get("duration"),
                    "state": got["state"].upper()}

        async def play(title, season=None, episode=None, service=None, who=None, resume=False, exact=False,
                       same=None):
            tv_id = server._current.get()
            self.log.append((tv_id, "play", title, season, episode, service, who, resume, exact,
                             store.current_who(tv_id)))
            self.media[tv_id] = self.media.get("after_play")
            server.TVS[tv_id].front = server.apps.BY_ID[service]["package"]   # the app came to the front
            return {"title": title, "method": "deeplink", "started": self.started}

        async def get_it_playing(app, link, who):
            self.log.append((server._current.get(), "profile", who))
            self.media[server._current.get()] = self.media.get("after_play")
            return self.started, None

        async def power_on():
            self.log.append((server._current.get(), "power_on"))
            server.TVS[server._current.get()].is_on = True

        async def installed_packages(max_age=1800, wait=True):
            return self.installed

        async def youtube_video_id(title, channel=None, duration_ms=None):
            return self.video

        async def search_in_app(app, title, best=None):
            self.log.append((server._current.get(), "search", app["id"], title))
            return "search", "note"

        async def no_sleep(_):
            return None

        async def find(title, type_=None):   # the show finder is never asked for real in these tests
            return None, []

        async def ui_items():
            self.log.append((server._current.get(), "screen"))
            if self.screen is None:
                raise RuntimeError("could not read the screen")
            return self.screen

        async def wait_until_playing(pkg, timeout=30):
            self.log.append((server._current.get(), "wait"))
            keys = [e[2] for e in self.did(server._current.get(), "key")]
            return self.slow_start or len(keys) >= self.plays_after_presses
        self.slow_start = False   # the show starts by itself, a little late
        self.screen = [{"label": "Play", "x": 1, "y": 1}]   # what the screen reader sees on TV B
        blind = patch.object(move, "BLIND_OK_APPS", {"netflix", "youtube"})
        blind.start()
        self.addCleanup(blind.stop)
        self.plays_after_presses = 2

        self.media["after_play"] = playing("Some Show", 598_000)
        for p in (patch.dict(server.TVS, {A: self.a, B: self.b}, clear=True),
                  patch.object(server, "media_read", media_read),
                  patch.object(server, "play", play),
                  patch.object(server, "get_it_playing", get_it_playing),
                  patch.object(server, "power_on", power_on),
                  patch.object(server, "installed_packages", installed_packages),
                  patch.object(server, "search_in_app", search_in_app),
                  patch.object(server, "push_now", lambda: None),
                  patch.object(server.asyncio, "sleep", no_sleep),
                  patch.object(server.agentic, "ui_items", ui_items),
                  patch.object(server.finder, "find", find),
                  patch.object(server, "move_wait_playing", wait_until_playing),
                  patch.object(move, "youtube_video_id", youtube_video_id)):
            p.start()
            self.addCleanup(p.stop)
        token = server._current.set(A)
        self.addCleanup(server._current.reset, token)

    def did(self, tv_id, what):
        return [e for e in self.log if e[0] == tv_id and e[1] == what]

    def index(self, tv_id, what, has=None):
        return next(i for i, e in enumerate(self.log)
                    if e[0] == tv_id and e[1] == what and (has is None or has in str(e[2])))

    async def test_the_steps_run_in_order(self):
        r = await server.move_playing(A, B)
        read_a = self.index(A, "read")
        pause_a = self.index(A, "key", "pause")
        stop_b = self.index(B, "adb", "force-stop")
        play_b = self.index(B, "play")
        self.assertLess(read_a, pause_a)
        self.assertLess(pause_a, stop_b)
        self.assertLess(stop_b, play_b)
        self.assertEqual(self.log[stop_b][2], f"shell am force-stop {NETFLIX}")
        # the same title, season and episode, pinned to the same app, and only that exact title
        self.assertEqual(self.log[play_b][2:9], ("Some Show", 2, 3, "netflix", "person1", False, True))
        self.assertEqual((r["from"], r["to"], r["title"], r["who"]), (A, B, "Some Show", "person1"))
        self.assertTrue(r["started"])
        self.assertEqual(r["note_key"], "note_moved")
        self.assertEqual(r["position_ms"], 600_000)
        self.assertEqual(r["target_position_ms"], 598_000)

    async def test_who_is_read_on_a_and_set_on_b_before_the_show_opens(self):
        await server.move_playing(A, B)
        self.assertEqual(store.current_who(B), "person1")
        self.assertEqual(self.did(B, "play")[0][9], "person1")   # already set when play ran
        self.assertEqual(store.current_who(A), "person1")

    async def test_nobody_set_on_a_leaves_b_alone(self):
        os.remove(store.WHO_FILE)
        store._cache.clear()
        store.save_who("person2", B)
        r = await server.move_playing(A, B)
        self.assertIsNone(r["who"])
        self.assertEqual(store.current_who(B), "person2")

    async def test_a_paused_show_is_not_paused_again(self):
        self.media[A] = playing("Some Show", 600_000, state="paused")
        await server.move_playing(A, B)
        self.assertEqual(self.did(A, "key"), [])

    async def test_b_is_woken_before_the_show_opens(self):
        self.b.is_on = False
        await server.move_playing(A, B)
        self.assertLess(self.index(B, "power_on"), self.index(B, "play"))
        self.assertFalse(self.b.state["waking"]["on"])

    async def test_b_awake_is_not_woken(self):
        await server.move_playing(A, B)
        self.assertEqual(self.did(B, "power_on"), [])

    async def test_b_will_not_wake_so_a_plays_on(self):
        self.b.is_on = False

        async def power_on():
            raise server.TVUnavailable("did not wake", key="err_tv_did_not_wake")
        with patch.object(server, "power_on", power_on):
            with self.assertRaises(server.TVUnavailable):
                await server.move_playing(A, B, power_off=True)
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause", "play"])
        self.assertEqual(self.did(B, "play"), [])
        self.assertEqual(self.did(B, "adb"), [])

    async def test_near_the_spot_means_no_seek(self):
        self.installed.add(move.SYNC_HELPER)
        r = await server.move_playing(A, B)
        self.assertIsNone(r["seek"])
        self.assertEqual([e for e in self.did(B, "adb") if "broadcast" in e[2]], [])

    async def test_off_the_spot_seeks_through_the_sync_helper(self):
        self.installed.add(move.SYNC_HELPER)
        self.media["after_play"] = playing("Some Show", 10_000)
        self.after_seek = playing("Some Show", 600_500)
        self.b.adb_out = 'Broadcast completed: result=0, data="{"id":1,"result":"ok","can_seek":true}"'
        r = await server.move_playing(A, B)
        seeks = [e[2] for e in self.did(B, "adb") if "broadcast" in e[2]]
        helper = "shell am broadcast -a dev.couchtv.sync.CMD -n dev.couchtv.sync/.CmdReceiver --es op"
        self.assertEqual(seeks, [f"{helper} state --es pkg {NETFLIX}",       # asked first: does it take a seek
                                 f"{helper} seek --es pkg {NETFLIX} --es pos_ms 600000"])
        self.assertEqual(r["seek"], "helper")
        self.assertEqual(r["target_position_ms"], 600_500)
        self.assertEqual(r["note_key"], "note_moved")

    async def test_not_playing_after_the_seek_is_not_a_move(self):
        self.installed.add(move.SYNC_HELPER)
        self.media["after_play"] = playing("Some Show", 10_000)
        self.after_seek = playing("Some Show", 600_500, state="paused")
        self.plays_after_presses = 99        # and it does not start again
        self.b.adb_out = (f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state=PAUSED(2), position=5}}\n"
                          'Broadcast completed: result=0, data="{"id":1,"result":"ok","can_seek":true}"')
        r = await server.move_playing(A, B, power_off=True, force=True)
        self.assertEqual(r["seek"], "helper")
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])                         # TV A stays on
        self.assertNotIn("power", [e[2] for e in self.did(A, "key")])
        self.assertEqual(r["note_key"], "note_move_not_playing")

    async def test_an_app_that_takes_no_seek_is_not_sent_one(self):
        self.installed.add(move.SYNC_HELPER)
        self.media["after_play"] = playing("Some Show", 10_000)
        self.b.adb_out = 'Broadcast completed: result=0, data="{"state":3,"can_seek":false}"'
        r = await server.move_playing(A, B)
        self.assertEqual(len([e for e in self.did(B, "adb") if "op seek" in e[2]]), 0)
        self.assertIsNone(r["seek"])
        self.assertEqual(r["note_key"], "note_move_other_spot")

    async def test_off_the_spot_without_the_helper_says_so(self):
        self.media["after_play"] = playing("Some Show", 10_000)
        r = await server.move_playing(A, B)
        self.assertIsNone(r["seek"])
        self.assertEqual([e for e in self.did(B, "adb") if "broadcast" in e[2]], [])
        self.assertEqual(r["note_key"], "note_move_other_spot")
        self.assertEqual(r["note_vars"], {"title": "Some Show", "tv": "Den", "from": "Lounge", "time": "10:00"})

    async def test_live_tv_has_no_spot_and_no_seek(self):
        self.installed.add(move.SYNC_HELPER)
        self.media[A] = playing("Channel One", None)
        self.media["after_play"] = playing("Channel One", None)
        r = await server.move_playing(A, B)
        self.assertIsNone(r["seek"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_not_playing_on_b_is_said_and_a_stays_on(self):
        self.started = False
        r = await server.move_playing(A, B, power_off=True)
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual(r["note_key"], "note_move_not_playing")
        self.assertNotIn("power", [e[2] for e in self.did(A, "key")])

    async def test_a_screen_that_cannot_be_read_gets_ok_until_it_plays(self):
        self.started = False
        for screen in ([], None, [{"label": "", "x": 960, "y": 540}]):
            self.log.clear()
            self.screen = screen
            r = await server.move_playing(A, B)
            self.assertEqual([e[2] for e in self.did(B, "key")], ["ok", "ok"])   # the first press was lost
            self.assertTrue(r["started"])
            self.assertEqual(r["note_key"], "note_moved")

    async def test_ok_is_never_pressed_on_a_show_that_plays_and_a_paused_one_gets_play(self):
        self.started, self.screen, self.plays_after_presses = False, [], 1
        for state, keys in (("PLAYING(3)", []), ("BUFFERING(6)", []), ("PAUSED(2)", ["play"])):
            self.log.clear()
            self.b.adb_out = f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state={state}, position=5}}"
            await server.move_playing(A, B, force=True)
            self.assertEqual([e[2] for e in self.did(B, "key")], keys, state)

    async def test_ok_is_only_pressed_blind_in_apps_that_sell_nothing(self):
        self.started, self.screen = False, []
        with patch.object(move, "BLIND_OK_APPS", {"some-other-app"}):
            r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "key"), [])
        self.assertFalse(r["started"])

    async def test_a_profile_screen_that_came_up_late_gets_a_second_go(self):
        self.started = False
        self.screen = [{"label": "Who's watching?"}, {"label": "Access Sam's profile"}]
        self.plays_after_presses = 99
        calls = []

        async def play(title, season=None, episode=None, service=None, who=None, resume=False, exact=False, same=None):
            calls.append(title)
            self.b.front = server.apps.BY_ID[service]["package"]
            return {"method": "deeplink", "started": len(calls) > 1}   # the second go picks the profile and plays
        with patch.object(server, "play", play):
            r = await server.move_playing(A, B)
        self.assertEqual(calls, ["Some Show", "Some Show"])
        self.assertEqual(len([e for e in self.did(B, "adb") if "force-stop" in e[2]]), 1)   # not started afresh again
        self.assertEqual(self.did(B, "key"), [])
        self.assertTrue(r["started"])

    async def test_no_second_go_without_a_profile_screen(self):
        self.started, self.plays_after_presses = False, 99
        r = await server.move_playing(A, B)
        self.assertEqual(len(self.did(B, "play")), 1)
        self.assertFalse(r["started"])

    async def test_a_slow_start_is_waited_for_and_nothing_is_pressed(self):
        self.started, self.screen, self.slow_start = False, [], True
        r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "key"), [])
        self.assertTrue(r["started"])

    async def test_a_screen_that_can_be_read_is_not_pressed_blind(self):
        self.started = False   # for example a profile screen without this person's name on it
        r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "key"), [])
        self.assertFalse(r["started"])

    async def test_ok_gives_up_after_three_presses(self):
        self.started, self.screen, self.plays_after_presses = False, [], 99
        r = await server.move_playing(A, B)
        self.assertEqual([e[2] for e in self.did(B, "key")], ["ok"] * 3)
        self.assertFalse(r["started"])
        self.assertEqual(r["note_key"], "note_move_not_playing")

    async def test_a_pause_that_did_not_take_is_sent_again(self):
        self.a.adb_out = f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        r = await server.move_playing(A, B)
        # three key presses at the start, three when the other TV has opened the show, and three
        # more once it plays; no helper on this TV
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause"] * 9)
        self.assertEqual([e for e in self.did(A, "adb") if "op pause" in e[2]], [])
        self.assertTrue(r["started"])
        self.assertFalse(r["source_paused"])                    # and it says so
        self.assertEqual(r["note_key"], "note_move_still_playing")
        self.assertEqual(r["note_vars"]["from"], "Lounge")

    async def test_the_sync_helper_is_asked_to_pause_when_the_key_does_not_take(self):
        self.installed.add(move.SYNC_HELPER)
        self.a.adb_out = f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        real_adb = self.a.adb

        async def adb(*args, **kw):
            out = await real_adb(*args, **kw)
            if "op pause" in " ".join(args):     # the helper's pause is the one that takes
                self.a.adb_out = self.a.adb_out.replace("PLAYING(3)", "PAUSED(2)")
            return out
        self.a.adb = adb
        r = await server.move_playing(A, B)
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause", "pause"])
        self.assertEqual([e[2] for e in self.did(A, "adb") if "op pause" in e[2]],
                         [f"shell am broadcast -a dev.couchtv.sync.CMD -n dev.couchtv.sync/.CmdReceiver "
                          f"--es op pause --es pkg {self.a.front}"])
        self.assertTrue(r["source_paused"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_a_pause_that_landed_late_counts_as_paused(self):
        playing_out = f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        self.a.adb_out = playing_out
        real_power_on, self.b.is_on = None, True

        async def play_then_a_is_paused(*a, **k):
            self.a.adb_out = playing_out.replace("PLAYING(3)", "PAUSED(2)")   # it took while B was starting
            self.b.front = self.a.front
            return {"method": "deeplink", "started": True}
        with patch.object(server, "play", play_then_a_is_paused), \
             patch.object(server, "get_it_playing", lambda *a, **k: play_then_a_is_paused()):
            r = await server.move_playing(A, B)
        self.assertTrue(r["source_paused"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_a_tv_that_was_turned_off_is_not_reported_as_still_playing(self):
        self.a.adb_out = f"package={self.a.front}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        r = await server.move_playing(A, B, power_off=True)
        self.assertTrue(r["powered_off"])
        self.assertTrue(r["source_paused"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_a_tv_that_does_not_answer_is_not_counted_as_paused(self):
        async def dead(*args, **kw):
            self.log.append((A, "adb", " ".join(args)))
            raise RuntimeError("adb: connection lost")
        self.a.adb = dead
        r = await server.move_playing(A, B)
        self.assertTrue(r["started"])
        self.assertFalse(r["source_paused"])                      # not "paused" on no answer
        self.assertEqual(r["note_key"], "note_move_still_playing")
        self.assertGreaterEqual(len([e for e in self.did(A, "key") if e[2] == "pause"]), 3)   # it kept trying

    async def test_no_blind_ok_when_the_tv_does_not_answer(self):
        self.started, self.screen, self.plays_after_presses = False, [], 99

        async def dead(*args, **kw):
            raise RuntimeError("adb: connection lost")
        real_play = server.play

        async def play_then_b_goes_quiet(*a, **k):
            r = await real_play(*a, **k)
            self.b.adb = dead
            return r
        with patch.object(server, "play", play_then_b_goes_quiet), \
             patch.object(server, "get_it_playing", lambda *a, **k: play_then_b_goes_quiet()):
            r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "key"), [])
        self.assertFalse(r["started"])

    async def test_a_pause_that_takes_is_sent_once(self):
        r = await server.move_playing(A, B)
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause"])
        self.assertTrue(r["source_paused"])

    async def test_a_stays_on_unless_asked(self):
        r = await server.move_playing(A, B)
        self.assertFalse(r["powered_off"])
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause"])

    async def test_a_turns_off_when_asked_once_b_plays(self):
        r = await server.move_playing(A, B, power_off=True)
        self.assertTrue(r["powered_off"])
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause", "power"])
        self.assertGreater(self.index(A, "key", "power"), self.index(B, "play"))

    async def test_a_tv_someone_is_watching_is_left_alone(self):
        self.b.front = YOUTUBE
        self.b.adb_out = f"package={YOUTUBE}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_tv_in_use"))
        self.assertEqual(self.did(A, "key"), [])          # A was not paused
        self.assertEqual(self.did(B, "play"), [])
        self.assertEqual(store.current_who(B), "person2")  # and B keeps its person

    async def test_a_tv_that_is_buffering_or_winding_is_being_watched_too(self):
        self.b.front = YOUTUBE
        for state in ("BUFFERING(6)", "CONNECTING(8)", "FAST_FORWARDING(4)", "REWINDING(5)"):
            self.b.adb_out = f"package={YOUTUBE}\nactive=true\nstate=PlaybackState {{state={state}, position=5}}"
            with self.assertRaises(server.ApiError, msg=state) as ctx:
                await server.move_playing(A, B)
            self.assertEqual(ctx.exception.key, "err_move_tv_in_use", state)
        for state in ("PAUSED(2)", "STOPPED(1)", "NONE(0)"):
            self.log.clear()
            self.b.adb_out = f"package={YOUTUBE}\nactive=true\nstate=PlaybackState {{state={state}, position=5}}"
            r = await server.move_playing(A, B)       # free: nobody is watching a paused TV
            self.assertIn("to", r)
        self.assertEqual(self.did(A, "key")[0][2], "pause")

    async def test_force_takes_the_tv_over(self):
        self.b.front = YOUTUBE
        self.b.adb_out = f"package={YOUTUBE}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=5}}"
        r = await server.move_playing(A, B, force=True)
        self.assertTrue(r["started"])

    async def test_nothing_playing(self):
        for media, front in ((None, NETFLIX), (playing("Some Show", 5, state="stopped"), NETFLIX),
                             (playing("Some Show", 5), "com.google.android.tvlauncher")):
            self.media[A], self.a.front = media, front
            with self.assertRaises(server.ApiError) as ctx:
                await server.move_playing(A, B)
            self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_nothing_playing"))
        self.assertEqual(self.did(A, "key"), [])
        self.assertEqual(self.did(B, "adb"), [])

    async def test_an_app_the_bridge_does_not_know(self):
        self.a.front = "tv.example.someapp"
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_app_not_known"))
        self.assertEqual(self.did(A, "key"), [])
        self.assertEqual(self.did(B, "adb"), [])

    async def test_a_title_that_comes_a_moment_late_is_waited_for(self):
        late = playing("Some Show", 600_000)
        self.media[A] = playing(None, 600_000)
        reads = []
        real = server.media_read

        async def media_read(pkg, app):
            if server._current.get() == A:
                reads.append(1)
                if len(reads) == 2:
                    self.media[A] = late     # the second look has the title
            return await real(pkg, app)
        with patch.object(server, "media_read", media_read):
            r = await server.move_playing(A, B)
        self.assertEqual(len(reads), 2)
        self.assertEqual(r["title"], "Some Show")
        self.assertTrue(r["started"])

    async def test_a_title_the_bridge_only_guessed_is_not_moved(self):
        # the app gave no title; media_read took one from the watch history (title_from "bridge")
        self.media[A] = playing("Some Show", 600_000, title_from="bridge")
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_no_title"))
        self.assertEqual(self.did(A, "key"), [])
        self.assertEqual(self.did(B, "adb"), [])

    async def test_a_title_the_bridge_opened_itself_is_moved_and_the_app_picks_the_episode(self):
        import time
        self.media[A] = playing("Some Show", 600_000, title_from="bridge")
        self.a.state["playing"]["item"] = {"title": "Some Show", "package": self.a.front, "season": 2, "episode": 5,
                                           "ts": time.time() - 600}
        r = await server.move_playing(A, B)
        self.assertTrue(r["started"])
        if self.a.front == NETFLIX:
            # not the episode the bridge opened back then: autoplay may have moved on, the app knows
            self.assertEqual(self.did(B, "play")[0][2:5], ("Some Show", None, None))

    async def test_what_the_bridge_opened_hours_ago_does_not_count(self):
        import time
        self.media[A] = playing("Some Show", 600_000, title_from="bridge")
        self.a.state["playing"]["item"] = {"title": "Some Show", "package": self.a.front,
                                           "ts": time.time() - server.MOVE_OPENED_S - 60}
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual(ctx.exception.key, "err_move_no_title")

    async def test_what_the_bridge_opened_in_another_app_does_not_count(self):
        self.media[A] = playing("Some Show", 600_000, title_from="bridge")
        import time
        self.a.state["playing"]["item"] = {"title": "Some Show", "package": "com.example.other", "ts": time.time()}
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual(ctx.exception.key, "err_move_no_title")

    async def test_an_app_that_gives_no_title(self):
        self.media[A] = playing(None, 5)
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_no_title"))
        self.assertEqual(self.did(A, "key"), [])

    async def test_a_tv_in_kids_mode_needs_the_parent_pin(self):
        store.save_who("kid1", B)
        with patch.object(server.kids, "is_kid", lambda pid: pid == "kid1"), \
             patch.object(server.kids, "verify", lambda pid, pin: pin == "2468"), \
             patch.object(server.kids, "locked_out", lambda addr: False), \
             patch.object(server.kids, "wrong_pin", lambda addr: None):
            with self.assertRaises(server.ApiError) as ctx:
                await server.move_playing(A, B)
            self.assertEqual(ctx.exception.status, 403)
            self.assertEqual(self.did(A, "key"), [])
            self.assertEqual(store.current_who(B), "kid1")
            r = await server.move_playing(A, B, pin="2468")
        self.assertTrue(r["started"])
        self.assertEqual(store.current_who(B), "person1")

    async def test_a_title_the_finder_does_not_know_opens_the_app_search(self):
        async def play(*a, **k):
            raise server.ApiError(404, "could not find it", key="err_title_not_found")
        with patch.object(server, "play", play):
            r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "search"), [(B, "search", "netflix", "Some Show")])
        self.assertEqual((r["method"], r["started"]), ("search", False))
        self.assertEqual(r["note_key"], "note_move_app_only")
        self.assertEqual(r["note_vars"], {"title": "Some Show", "tv": "Den", "app": "Netflix"})

    async def test_another_title_playing_on_b_is_paused_and_said(self):
        # both apps name what they play; B came up on something else (Disney+ did this for "Bluey")
        self.installed.add(move.SYNC_HELPER)
        self.media[A] = playing("Some Show", 600_000, title_from="app")
        self.media["after_play"] = playing("Some Show Specials", 5_000, title_from="app")
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(r["wrong_title"], "Some Show Specials")
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertIsNone(r["seek"])                                   # no seek inside the wrong title
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause"])
        self.assertEqual(r["note_key"], "note_move_wrong_title")
        self.assertEqual(r["note_vars"], {"app": server.apps.describe_package(self.a.front)["name"],
                                          "other": "Some Show Specials", "tv": "Den", "title": "Some Show"})

    async def test_the_same_title_on_b_is_fine_and_a_title_b_does_not_give_is_not_judged(self):
        self.media[A] = playing("Some Show", 600_000, title_from="app")
        self.media["after_play"] = playing("some show", 598_000, title_from="app")
        r = await server.move_playing(A, B)
        self.assertIsNone(r["wrong_title"])
        self.assertTrue(r["started"])
        self.log.clear()
        self.media["after_play"] = playing("Whatever The Bridge Guessed", 598_000, title_from="bridge")
        r = await server.move_playing(A, B, force=True)
        self.assertIsNone(r["wrong_title"])
        self.assertTrue(r["started"])

    async def test_a_title_in_another_script_is_opened_when_the_finder_has_that_very_title(self):
        name = "\u5343\u3068\u5343\u5c0b\u306e\u795e\u96a0\u3057"
        self.media[A] = playing(name, 600_000, title_from="app")
        self.media["after_play"] = playing(name, 598_000, title_from="app")
        opened = await self.move_with_lookups([name])
        self.assertEqual(opened, [name])
        self.assertTrue(self.result["started"])
        self.assertIsNone(self.result["wrong_title"])  # and the same name on TV B is the same title

    async def move_with_lookups(self, answers):
        """Run a move where the show finder gives these titles, one per lookup (the last one again
        after that), and play works the way the real one does: one lookup, checked, then opened."""
        opened, left = [], list(answers)

        async def find(title, type_=None):
            return {"title": left.pop(0) if len(left) > 1 else left[0]}, []

        async def play(title, season=None, episode=None, service=None, who=None, resume=False, exact=False,
                       same=None):
            best, _ = await server.finder.find(title)
            if exact and not (same or server.finder.same_title)(best["title"], title):
                raise server.ApiError(404, "could not find it", key="err_title_not_found", vars={"title": title})
            opened.append(best["title"])
            self.b.front = server.apps.BY_ID[service]["package"]
            self.media[B] = self.media["after_play"]
            return {"method": "deeplink", "started": True}
        with patch.object(server.finder, "find", find), patch.object(server, "play", play):
            self.result = await server.move_playing(A, B)
        return opened

    async def test_the_title_that_was_checked_is_the_one_that_is_opened(self):
        # the finder's answer can change between two lookups; whichever one play gets is the one checked
        name, other = "\u5343\u3068\u5343\u5c0b\u306e\u795e\u96a0\u3057", "\u3082\u306e\u306e\u3051\u59eb"
        import time
        for answers in ([name, other], [other, name]):
            self.log.clear()
            self.b.front = None
            self.media[B] = None
            # a title the bridge opened itself: the later "same title on TV B" check does not run
            self.media[A] = playing(name, 600_000, title_from="bridge")
            self.a.state["playing"]["item"] = {"title": name, "package": self.a.front, "ts": time.time() - 60}
            opened = await self.move_with_lookups(answers)
            self.assertNotIn(other, opened, answers)
            if not opened:
                self.assertEqual((self.result["started"], self.result["note_key"]),
                                 (False, "note_move_app_only"), answers)

    async def test_a_title_in_another_script_the_finder_has_another_name_for_is_not_opened(self):
        name = "\u5343\u3068\u5343\u5c0b\u306e\u795e\u96a0\u3057"
        self.media[A] = playing(name, 600_000)
        opened = await self.move_with_lookups(["\u3082\u306e\u306e\u3051\u59eb"])
        self.assertEqual(opened, [])
        self.assertEqual((self.result["started"], self.result["note_key"]), (False, "note_move_app_only"))

    async def test_the_real_play_checks_the_result_it_uses(self):
        name = "\u5343\u3068\u5343\u5c0b\u306e\u795e\u96a0\u3057"

        async def find(title, type_=None):
            return {"title": "\u3082\u306e\u306e\u3051\u59eb"}, []
        with patch.object(server.finder, "find", find):
            for same in (move.same_name, None):
                with self.assertRaises(server.ApiError) as ctx:
                    await REAL_PLAY(name, service="netflix", exact=True, same=same)
                self.assertEqual(ctx.exception.key, "err_title_not_found")

    async def test_a_near_name_is_never_opened_in_its_place(self):
        # "Some Show Fancy Dinner" is a series of its own; the finder only knows "Some Show", which
        # even has an episode called "Fancy Dinner". The move must not open that.
        self.media[A] = playing("Some Show Fancy Dinner", 600_000)
        asked = []

        async def play(title, season=None, episode=None, service=None, who=None, resume=False, exact=False, same=None):
            asked.append((title, exact))
            raise server.ApiError(404, "could not find it", key="err_title_not_found")
        with patch.object(server, "play", play):
            r = await server.move_playing(A, B)
        self.assertEqual(asked, [("Some Show Fancy Dinner", True)])      # asked once, exactly, and nothing else
        self.assertEqual(self.did(B, "search"), [(B, "search", "netflix", "Some Show Fancy Dinner")])
        self.assertEqual((r["started"], r["note_key"]), (False, "note_move_app_only"))

    async def test_a_failure_after_the_pause_puts_things_back(self):
        async def play(*a, **k):
            raise RuntimeError("adb: connection lost")
        with patch.object(server, "play", play):
            with self.assertRaises(RuntimeError):
                await server.move_playing(A, B)
        self.assertEqual([e[2] for e in self.did(A, "key")], ["pause", "play"])
        self.assertEqual(store.current_who(B), "person2")   # B has its own person back

    async def test_nobody_set_on_a_never_takes_b_out_of_kids_mode(self):
        os.remove(store.WHO_FILE)
        store._cache.clear()
        store.save_who("kid1", B)
        with patch.object(server.kids, "is_kid", lambda pid: pid == "kid1"):
            await server.move_playing(A, B)
        self.assertEqual(store.current_who(B), "kid1")

    async def test_the_app_has_to_be_on_the_other_tv(self):
        self.installed.discard(self.a.front)
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_not_installed"))
        self.assertEqual(self.did(A, "key"), [])

    async def test_ok_is_not_pressed_when_another_app_has_come_to_the_front(self):
        self.started, self.screen = False, []

        async def play(*a, **k):
            self.b.front = "com.example.somethingelse"
            return {"method": "deeplink", "started": False}
        with patch.object(server, "play", play):
            r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "key"), [])
        self.assertFalse(r["started"])

    async def test_only_android_tvs(self):
        self.b.kind = "roku"
        with self.assertRaises(server.ApiError) as ctx:
            await server.move_playing(A, B)
        self.assertEqual((ctx.exception.status, ctx.exception.key), (400, "err_move_not_supported"))
        self.assertEqual(self.log, [])

    async def test_a_package_that_is_not_one_never_reaches_b(self):
        bad = "a.b;touch /sdcard/proof"
        self.a.front = bad
        with patch.object(server.apps, "describe_package",
                          lambda p: {"id": "netflix", "name": "Netflix", "package": p}):
            with self.assertRaises(tvmod.UnsafeInput):
                await server.move_playing(A, B)
        self.assertEqual(self.did(B, "adb"), [])
        self.assertEqual(self.did(A, "key"), [])


class MoveAskedTitle(unittest.IsolatedAsyncioTestCase):
    """The app names another title than the one the bridge opened: Disney+, asked for "Bluey", plays
    the series "Bluey Fancy Restaurant", which the show finder does not know."""
    did = MoveSteps.did

    def setUp(self):
        MoveSteps.setUp(self)   # the same two pretend TVs, without running MoveSteps' own tests again
        self.media[A] = playing("Show Extra", 60_000, title_from="app")
        self.media["after_play"] = playing("Show Extra", 58_000, title_from="app")
        self.a.state["playing"]["item"] = {"title": "Show", "season": None, "episode": None,
                                           "package": NETFLIX, "ts": time.time() - 60}
        outer = self

        async def play(title, season=None, episode=None, service=None, who=None, resume=False, exact=False,
                       same=None):
            tv_id = server._current.get()
            outer.log.append((tv_id, "play", title, season, episode, service, who, resume, exact))
            if title != "Show":      # the show finder only knows the name the bridge asked for
                raise server.ApiError(404, "could not find it", key="err_title_not_found")
            outer.media[tv_id] = outer.media.get("after_play")
            return {"title": title, "method": "deeplink", "started": outer.started}
        p = patch.object(server, "play", play)
        p.start()
        self.addCleanup(p.stop)

    async def test_the_title_the_bridge_opened_is_used_and_the_tvs_agree(self):
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual([e[2] for e in self.did(B, "play")], ["Show Extra", "Show"])
        self.assertEqual(self.did(B, "play")[1][8], True)              # still only that exact title
        self.assertEqual(self.did(B, "search"), [])
        self.assertTrue(r["started"])
        self.assertIsNone(r["wrong_title"])
        self.assertEqual(r["title"], "Show Extra")                     # the name the TVs give
        self.assertEqual(r["note_key"], "note_moved")
        self.assertTrue(r["powered_off"])

    async def test_the_episode_is_the_one_tv_a_is_on_now_not_the_one_the_bridge_opened(self):
        self.a.state["playing"]["item"] |= {"season": 2, "episode": 5}
        self.media[A] = playing("Show Extra", 60_000, title_from="app") | {"season": 2, "episode": 6}
        await server.move_playing(A, B)
        self.assertEqual(self.did(B, "play")[1][2:5], ("Show", 2, 6))

    async def test_a_title_that_matches_is_not_read_again(self):
        await server.move_playing(A, B)
        self.assertLessEqual(len(self.did(B, "read")), 3)   # no waiting once TV B has named it

    async def test_another_title_on_b_is_paused_and_said(self):
        self.media["after_play"] = playing("Show", 0, title_from="app")
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(r["wrong_title"], "Show")
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause"])
        self.assertEqual(r["note_key"], "note_move_wrong_title")

    async def test_a_tv_b_that_names_nothing_has_not_confirmed_it(self):
        # opened by the asked-for name, and TV B's app gives no title: nothing says it is the same show
        self.media["after_play"] = playing(None, 58_000, title_from=None)
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(r["wrong_title"], "Show")
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause"])
        self.assertGreaterEqual(len(self.did(B, "read")), 4)           # it looked again first

    async def test_without_a_fresh_bridge_play_in_this_app_the_search_opens_as_before(self):
        for item in (None,
                     {"title": "Show", "package": NETFLIX, "ts": time.time() - server.MOVE_OPENED_S - 5},
                     {"title": "Show", "package": YOUTUBE, "ts": time.time() - 60}):
            with self.subTest(item=item):
                self.log.clear()
                self.a.state["playing"]["item"] = item
                self.b.state["playing"]["item"] = None
                self.media[B] = None
                r = await server.move_playing(A, B)
                self.assertEqual([e[2] for e in self.did(B, "play")], ["Show Extra"])
                self.assertEqual(self.did(B, "search"), [(B, "search", "netflix", "Show Extra")])
                self.assertEqual((r["method"], r["started"]), ("search", False))

    def test_move_asked_is_none_when_the_names_agree_or_the_app_gives_none(self):
        with server.on_tv(A):
            now = {"title": "Show Extra", "title_from": "app"}
            self.assertEqual(server.move_asked(now, NETFLIX), "Show")
            self.assertIsNone(server.move_asked({"title": "Show", "title_from": "app"}, NETFLIX))
            self.assertIsNone(server.move_asked({"title": "SHOW!", "title_from": "app"}, NETFLIX))
            self.assertIsNone(server.move_asked({"title": "Show", "title_from": "bridge"}, NETFLIX))
            self.assertIsNone(server.move_asked({"title": None, "title_from": None}, NETFLIX))


class MoveSiblingTitle(unittest.IsolatedAsyncioTestCase):
    """TV B came up on another title whose own page has the right one as a tile. Seen on a Sony
    Google TV: JustWatch's one Disney+ link for the film "Tangled" is the page of "Tangled
    Sing-Along", and the plain film is a tile under Suggested there."""
    did = MoveSteps.did
    PAGE = "https://www.example.com/browse/entity-1"
    OTHER = [{"label": "Some Show Sing-Along", "x": 300, "y": 280, "clickable": False},
             {"label": "CONTINUE", "x": 293, "y": 709, "clickable": False},
             {"label": "Some Show, Select for details on this title., 1 of 8 items.", "x": 330, "y": 1065,
              "clickable": True},
             {"label": "Some Show Ever After, Select for details on this title., 2 of 8 items.", "x": 750,
              "y": 1065, "clickable": True}]
    RIGHT = [{"label": "Some Show", "x": 340, "y": 286, "clickable": False},
             {"label": "CONTINUE", "x": 293, "y": 709, "clickable": False},
             {"label": "RESTART", "x": 518, "y": 709, "clickable": False}]

    def setUp(self):
        MoveSteps.setUp(self)   # the same two pretend TVs, without running MoveSteps' own tests again
        self.media[A] = playing("Some Show", 600_000, title_from="app")
        self.media["after_play"] = playing("Some Show Sing-Along", 5_000, title_from="app")
        self.screens = [self.OTHER, self.RIGHT]            # what the screen reader sees, read by read
        self.then_plays = playing("Some Show", 598_000, title_from="app")   # after the page's button
        self.finds = []
        self.found_as = None          # the title the show finder answers with (None: the one asked)
        self.starts = True            # does the app say it plays within the wait after Play
        outer = self

        async def find(title, type_=None):
            outer.finds.append(title)
            return {"title": outer.found_as or title, "providers": [{"service": "netflix", "web": outer.PAGE}]}, []

        async def ui_items():
            outer.log.append((server._current.get(), "screen"))
            if not outer.screens:
                raise RuntimeError("could not read the screen")
            return outer.screens.pop(0)

        async def wait_until_playing(pkg, timeout=30, seen=None):
            outer.log.append((server._current.get(), "wait"))
            outer.media[server._current.get()] = outer.then_plays
            return outer.starts
        for p in (patch.object(move, "SIBLING_TITLE_APPS", {"netflix": "example.com"}),
                  patch.object(server.finder, "find", find),
                  patch.object(server.agentic, "ui_items", ui_items),
                  patch.object(server, "wait_until_playing", wait_until_playing)):
            p.start()
            self.addCleanup(p.stop)

    def taps(self):
        return [e[2] for e in self.did(B, "adb") if "input tap" in e[2]]

    async def test_the_tile_with_the_title_is_pressed_and_the_show_is_moved(self):
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(self.finds, ["Some Show"])
        self.assertIn((B, "link", self.PAGE, NETFLIX, False), self.log)     # the page, into the open app
        self.assertEqual(self.taps(), ["shell input tap 330 1065", "shell input tap 293 709"])
        self.assertIsNone(r["wrong_title"])
        self.assertTrue(r["started"])
        self.assertTrue(r["powered_off"])                                    # A goes off only now
        self.assertEqual(r["note_key"], "note_moved")
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause"])     # the other title was paused first

    async def _nothing_pressed(self, wrong="Some Show Sing-Along"):
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(self.taps(), [])
        self.assertEqual(r["wrong_title"], wrong)
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual(r["note_key"], "note_move_wrong_title")
        return r

    async def test_no_tile_with_the_title_leaves_it_paused_and_said(self):
        self.screens = [[i for i in self.OTHER if not i["label"].startswith("Some Show,")]]
        await self._nothing_pressed()

    async def test_two_tiles_with_the_title_are_not_guessed_between(self):
        self.screens = [self.OTHER + [dict(self.OTHER[2], x=1170)]]
        await self._nothing_pressed()

    async def test_a_page_that_is_not_the_other_title_s_is_left_alone(self):
        self.screens = [[dict(self.OTHER[0], label="Home")] + self.OTHER[1:]]
        await self._nothing_pressed()

    async def test_a_button_to_pay_or_sign_in_on_the_page_stops_it(self):
        self.screens = [self.OTHER + [{"label": "Subscribe", "x": 1, "y": 1, "clickable": True}]]
        await self._nothing_pressed()

    async def test_words_about_paying_that_cannot_be_pressed_stop_it_too(self):
        self.screens = [self.OTHER + [{"label": "RENT", "x": 1, "y": 1, "clickable": False}]]
        await self._nothing_pressed()

    async def test_nothing_is_pressed_once_another_app_is_in_front(self):
        outer = self

        async def front_package():
            return "com.some.other.app"
        with patch.object(self.b, "front_package", front_package):
            await outer._nothing_pressed()

    async def test_a_page_link_on_another_site_is_not_opened(self):
        with patch.object(move, "SIBLING_TITLE_APPS", {"netflix": "netflix.com"}):
            await self._nothing_pressed()
        self.assertNotIn(self.PAGE, [e[2] for e in self.did(B, "link")])

    async def test_a_screen_that_cannot_be_read_is_left_alone(self):
        self.screens = []
        await self._nothing_pressed()

    async def test_an_app_not_on_the_list_is_not_looked_at(self):
        with patch.object(move, "SIBLING_TITLE_APPS", {"some-other-app": "example.com"}):
            await self._nothing_pressed()
        self.assertEqual(self.finds, [])
        self.assertEqual(self.did(B, "screen"), [])

    async def test_a_tile_that_leads_to_a_page_without_play_is_not_pressed_further(self):
        self.screens = [self.OTHER, [self.RIGHT[0], {"label": "Rent", "x": 293, "y": 709, "clickable": True}]]
        r = await server.move_playing(A, B)
        self.assertEqual(self.taps(), ["shell input tap 330 1065"])         # the tile, and then no button
        self.assertEqual(r["note_key"], "note_move_wrong_title")
        self.assertFalse(r["started"])

    async def test_a_tile_that_leads_to_a_page_of_another_title_is_not_played(self):
        self.screens = [self.OTHER, [dict(self.RIGHT[0], label="Some Show Ever After")] + self.RIGHT[1:]]
        r = await server.move_playing(A, B)
        self.assertEqual(self.taps(), ["shell input tap 330 1065"])
        self.assertFalse(r["started"])

    async def test_b_s_own_word_still_decides_after_the_button(self):
        self.then_plays = playing("Some Show Ever After", 0, title_from="app")
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(len(self.taps()), 2)
        self.assertEqual(r["wrong_title"], "Some Show Ever After")
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause", "pause"])   # paused again
        self.assertEqual(r["note_vars"]["other"], "Some Show Ever After")

    async def test_a_slow_start_after_play_still_counts_once_b_names_the_title(self):
        self.starts = False                                   # not playing yet when the wait ran out
        r = await server.move_playing(A, B, power_off=True)
        self.assertEqual(len(self.taps()), 2)
        self.assertIsNone(r["wrong_title"])
        self.assertTrue(r["started"])                         # B names the title and says it plays
        self.assertEqual(r["note_key"], "note_moved")

    async def test_play_pressed_and_still_not_playing_is_said_as_not_playing(self):
        self.starts = False
        self.then_plays = playing("Some Show", 598_000, state="paused", title_from="app")
        r = await server.move_playing(A, B, power_off=True)
        self.assertIsNone(r["wrong_title"])                   # it is the right title's page now
        self.assertFalse(r["started"])
        self.assertFalse(r["powered_off"])
        self.assertEqual(r["note_key"], "note_move_not_playing")

    async def test_a_title_the_finder_only_guesses_at_opens_no_page(self):
        self.found_as = "Some Other Show"
        await self._nothing_pressed()
        self.assertNotIn(self.PAGE, [e[2] for e in self.did(B, "link")])
        self.assertEqual(self.did(B, "screen"), [])

    async def test_a_page_that_is_slow_to_draw_is_read_once_more(self):
        self.screens = [[{"label": "Loading", "x": 1, "y": 1, "clickable": False}], self.OTHER, self.RIGHT]
        r = await server.move_playing(A, B)
        self.assertEqual(len(self.did(B, "screen")), 3)
        self.assertEqual(r["note_key"], "note_moved")

    async def _moved_reading(self, *names):
        """Run a move where TV B, once Play is pressed, names these titles read by read (the last
        one from then on). Returns the result and how many reads the move made after the press."""
        real, reads = server.media_read, []

        async def media_read(pkg, app):
            if server._current.get() == B and len(self.taps()) == 2:
                name = names[min(len(reads), len(names) - 1)]
                reads.append(name)
                self.media[B] = self.then_plays if name == "Some Show" else playing(name, 5_000, title_from="app")
            return await real(pkg, app)
        with patch.object(server, "media_read", media_read):
            r = await server.move_playing(A, B, power_off=True)
        return r, len(reads)

    async def test_the_other_title_s_name_a_moment_after_play_is_read_again(self):
        # the app says it plays before it names the new title (Codex review on #285)
        r, reads = await self._moved_reading("Some Show Sing-Along", "Some Show")
        self.assertEqual(reads, 2)
        self.assertIsNone(r["wrong_title"])
        self.assertTrue(r["started"])
        self.assertEqual(r["note_key"], "note_moved")
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause"])     # the right film is not paused

    async def test_the_other_title_s_name_on_every_read_is_paused_after_four(self):
        r, reads = await self._moved_reading("Some Show Sing-Along")
        self.assertEqual(reads, 4)
        self.assertEqual(r["wrong_title"], "Some Show Sing-Along")
        self.assertFalse(r["started"])
        self.assertEqual([e[2] for e in self.did(B, "key")], ["pause", "pause"])

    async def test_a_third_title_after_play_is_paused_at_the_first_read(self):
        # only the name B was on before the press may linger: any other name is B's word already
        r, reads = await self._moved_reading("Some Show Ever After")
        self.assertEqual(reads, 1)
        self.assertEqual(r["wrong_title"], "Some Show Ever After")
        self.assertFalse(r["started"])

    def _clock(self, buffered, played, in_the_wait=True):
        """Patches for a move on a clock the test moves: after Play the app takes `buffered` s to
        start, is seen playing, and plays `played` s more while the bridge confirms it. With
        `in_the_wait` False the wait runs out first and it is playing only at the read after."""
        clock = [1000.0]

        async def wait_until_playing(pkg, timeout=30, seen=None):
            clock[0] += buffered
            if seen is not None and in_the_wait:
                seen["at"] = clock[0]
            clock[0] += played
            self.media[server._current.get()] = self.then_plays
            return in_the_wait

        class Clock:   # the server's `time` with that clock; everything else is the real module
            monotonic = staticmethod(lambda: clock[0])

            def __getattr__(self, name):
                return getattr(time, name)
        return patch.object(server, "wait_until_playing", wait_until_playing), patch.object(server, "time", Clock())

    async def test_the_time_b_played_while_it_was_confirmed_is_allowed_for(self):
        # no sync helper: B resumed at A's spot and played 12 s while the bridge waited and read
        # (Codex review on #285). That is not "another spot".
        self.then_plays = playing("Some Show", 612_000, title_from="app")
        wait, clock = self._clock(buffered=8, played=12)
        with wait, clock:
            r = await server.move_playing(A, B)
        self.assertTrue(r["started"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_the_time_b_took_to_start_is_not_time_it_played(self):
        # B resumed 25 s past A's spot, after 20 s of loading: that is another spot, and is said
        self.then_plays = playing("Some Show", 625_000, title_from="app")
        wait, clock = self._clock(buffered=20, played=3)
        with wait, clock:
            r = await server.move_playing(A, B)
        self.assertTrue(r["started"])
        self.assertEqual(r["note_key"], "note_move_other_spot")

    async def test_a_film_that_starts_after_the_wait_has_played_only_from_then(self):
        # Codex review on #295: the wait ran out after 16 s with nothing playing, and the film is
        # read as playing only after it, 17 s past A's spot. None of that wait was time it played.
        self.then_plays = playing("Some Show", 617_000, title_from="app")
        wait, clock = self._clock(buffered=16, played=0, in_the_wait=False)
        with wait, clock:
            r = await server.move_playing(A, B)
        self.assertTrue(r["started"])
        self.assertEqual(r["note_key"], "note_move_other_spot")

    async def test_a_move_that_came_up_right_never_looks(self):
        self.media["after_play"] = playing("Some Show", 598_000, title_from="app")
        r = await server.move_playing(A, B)
        self.assertEqual(r["note_key"], "note_moved")
        self.assertEqual(self.finds, [])
        self.assertEqual(self.did(B, "screen"), [])
        self.assertEqual(self.taps(), [])


class SiblingItem(unittest.TestCase):
    def tile(self, label, **extra):
        return {"label": label, "x": 5, "y": 6, "clickable": True} | extra

    def test_only_the_title_then_a_comma_is_it(self):
        items = [self.tile("Tangled Sing-Along, Select for details on this title., 1 of 8 items."),
                 self.tile("Tangled Ever After, Select for details on this title., 2 of 8 items."),
                 self.tile("Tangled, Select for details on this title., 3 of 8 items.", x=9)]
        self.assertEqual(move.sibling_item(items, "Tangled")["x"], 9)
        self.assertEqual(move.sibling_item(items, "tangled ")["x"], 9)          # case and edge spaces
        self.assertIsNone(move.sibling_item(items, "Moana"))
        self.assertIsNone(move.sibling_item(items, ""))
        self.assertIsNone(move.sibling_item(items, None))

    def test_a_title_with_a_comma_in_it(self):
        items = [self.tile("Monsters, Inc., Select for details on this title., 1 of 8 items."),
                 self.tile("Monsters University, Select for details on this title., 2 of 8 items.")]
        self.assertIsNotNone(move.sibling_item(items, "Monsters, Inc."))
        self.assertIsNone(move.sibling_item(items[1:], "Monsters"))
        # a longer title with a comma right there is a tile too: the page it leads to is what is
        # checked before Play (MoveSiblingTitle: a page of another title is not played)
        self.assertIsNotNone(move.sibling_item(items, "Monsters"))

    def test_only_apps_seen_on_a_real_tv_are_on_the_list(self):
        self.assertEqual(move.SIBLING_TITLE_APPS, {"disney-plus": "disneyplus.com"})
        self.assertNotIn("ok", move.PAGE_PLAY_BUTTONS)

    def test_the_page_link_has_to_be_on_the_app_s_own_site(self):
        ok = move.page_host_ok
        self.assertTrue(ok("disney-plus", "https://www.disneyplus.com/browse/entity-1"))
        self.assertTrue(ok("disney-plus", "https://disneyplus.com/browse/entity-1"))
        self.assertFalse(ok("disney-plus", "http://www.disneyplus.com/browse/entity-1"))
        self.assertFalse(ok("disney-plus", "https://www.disneyplus.com.example.org/browse/entity-1"))
        self.assertFalse(ok("disney-plus", "https://notdisneyplus.com/browse/entity-1"))
        self.assertFalse(ok("disney-plus", "intent://www.disneyplus.com/play/1#Intent;scheme=https;end"))
        self.assertFalse(ok("disney-plus", None))
        self.assertFalse(ok("netflix", "https://www.netflix.com/title/1"))

    def test_page_stops_reads_buttons_that_are_not_pressable_too(self):
        def stops(*labels):
            return move.page_stops([{"label": x, "clickable": False} for x in labels])
        for label in ("SUBSCRIBE", "Rent", "Rent $4.99", "CA$4.99", "From $3.99", "LOG IN", "Upgrade",
                      "Agree & Continue", "Enter PIN", "Start free trial", "4,99 €"):
            self.assertTrue(stops(label), label)
        # everything a real Disney+ title page showed (Sony Google TV), and a tile for a film named Rent
        self.assertEqual(stops("Tangled", "PG", "4K Ultra HD", "Dolby Vision", "5.1", "Subtitles / CC",
                               "Audio Description", "1h 13m remaining", "CONTINUE", "RESTART", "TRAILER", "PLAY",
                               "Remove from Continue Watching", "SUGGESTED", "EXTRAS", "DETAILS",
                               "Select to add Tangled to your watchlist.",
                               "2010 • 1h 43m • Action and Adventure, Animation",
                               "Rent, Select for details on this title., 3 of 8 items."), [])

    def test_a_bare_continue_only_counts_next_to_restart(self):
        def button(items, *words):
            return next((i for i in items if i["label"].lower() in words), None)
        page = [{"label": "CONTINUE"}, {"label": "RESTART"}]
        self.assertEqual(move.page_play_button(page, button)["label"], "CONTINUE")
        self.assertIsNone(move.page_play_button([{"label": "Continue"}], button))       # a dialog's button
        self.assertEqual(move.page_play_button([{"label": "PLAY"}], button)["label"], "PLAY")

    def test_a_label_that_cannot_be_pressed_or_has_no_place_is_not_a_tile(self):
        self.assertIsNone(move.sibling_item([self.tile("Tangled, Select", clickable=False)], "Tangled"))
        self.assertIsNone(move.sibling_item([{"label": "Tangled, Select", "clickable": True}], "Tangled"))

    def test_two_of_them_is_none(self):
        self.assertIsNone(move.sibling_item([self.tile("Tangled, a"), self.tile("Tangled, b")], "Tangled"))

    def test_page_names_wants_the_whole_title(self):
        items = [{"label": "Tangled Sing-Along"}, {"label": "CONTINUE"}]
        self.assertTrue(move.page_names(items, "tangled sing along"))
        self.assertFalse(move.page_names(items, "Tangled"))
        self.assertFalse(move.page_names([], "Tangled"))


class MoveYouTube(MoveSteps):
    """YouTube: a video link, not the show finder. The time goes in the link only as the backup."""

    def setUp(self):
        super().setUp()
        self.a.front = YOUTUBE
        self.media[A] = playing("A Video", 300_000, channel="A Channel", duration=900_000)
        self.media["after_play"] = playing("A Video", 299_000)

    # the show-finder tests of the parent class do not apply to the YouTube path
    test_the_steps_run_in_order = None
    test_who_is_read_on_a_and_set_on_b_before_the_show_opens = None
    test_a_title_the_finder_does_not_know_opens_the_app_search = None
    test_off_the_spot_seeks_through_the_sync_helper = None
    test_off_the_spot_without_the_helper_says_so = None
    test_a_failure_after_the_pause_puts_things_back = None
    test_a_near_name_is_never_opened_in_its_place = None
    test_a_title_in_another_script_is_opened_when_the_finder_has_that_very_title = None
    test_a_title_in_another_script_the_finder_has_another_name_for_is_not_opened = None
    test_the_title_that_was_checked_is_the_one_that_is_opened = None
    test_the_real_play_checks_the_result_it_uses = None
    test_not_playing_after_the_seek_is_not_a_move = None
    test_no_blind_ok_when_the_tv_does_not_answer = None
    test_a_profile_screen_that_came_up_late_gets_a_second_go = None
    test_no_second_go_without_a_profile_screen = None
    test_ok_is_not_pressed_when_another_app_has_come_to_the_front = None
    test_an_app_that_takes_no_seek_is_not_sent_one = None
    test_a_package_that_is_not_one_never_reaches_b = None
    test_a_turns_off_when_asked_once_b_plays = None
    test_b_is_woken_before_the_show_opens = None
    test_b_will_not_wake_so_a_plays_on = None

    async def test_the_video_opens_fresh_with_no_time_and_the_profile_is_the_watcher(self):
        r = await server.move_playing(A, B)
        links = self.did(B, "link")
        self.assertEqual(links, [(B, "link", "https://www.youtube.com/watch?v=abcdefghijk", YOUTUBE, True)])
        self.assertEqual(self.did(B, "profile"), [(B, "profile", "person1")])
        self.assertEqual(self.did(B, "play"), [])
        self.assertIsNone(r["seek"])
        self.assertEqual(r["note_key"], "note_moved")

    async def test_off_the_spot_opens_the_link_again_with_the_time(self):
        self.media["after_play"] = playing("A Video", 0)
        self.after_seek = playing("A Video", 300_400)
        r = await server.move_playing(A, B)
        self.assertEqual([e[2:] for e in self.did(B, "link")],
                         [("https://www.youtube.com/watch?v=abcdefghijk", YOUTUBE, True),
                          ("https://www.youtube.com/watch?v=abcdefghijk&t=300", YOUTUBE, False)])
        self.assertEqual(r["seek"], "link")
        self.assertEqual(r["target_position_ms"], 300_400)

    async def test_a_video_that_cannot_be_found_opens_the_search(self):
        self.video = None
        r = await server.move_playing(A, B)
        self.assertEqual(self.did(B, "link"), [])
        self.assertEqual(self.did(B, "search"), [(B, "search", "youtube", "A Video")])
        self.assertFalse(r["started"])
        self.assertEqual(r["note_key"], "note_move_app_only")


class MoveWaitPlaying(unittest.IsolatedAsyncioTestCase):
    """What a real Google TV Streamer printed for YouTube: the position is reported once and stays."""
    PLAYING = (f"package={YOUTUBE}\nactive=false\nstate=PlaybackState {{state=STOPPED(1), position=0}}\n"
               f"package={YOUTUBE}\nactive=true\nstate=PlaybackState {{state=PLAYING(3), position=356, speed=1.0}}")

    async def wait(self, out):
        t = FakeTV(B, "Den", [])
        t.adb_out = out

        async def no_sleep(_):
            return None
        token = server._current.set(B)
        self.addCleanup(server._current.reset, token)
        with patch.dict(server.TVS, {B: t}, clear=True), patch.object(server.asyncio, "sleep", no_sleep):
            return await server.move_wait_playing(YOUTUBE, timeout=0.2)

    async def test_playing_with_a_position_that_never_moves_counts(self):
        self.assertTrue(await self.wait(self.PLAYING))

    async def test_paused_stopped_or_another_app_does_not(self):
        self.assertFalse(await self.wait(self.PLAYING.replace("PLAYING(3)", "PAUSED(2)")))
        self.assertFalse(await self.wait(self.PLAYING.replace(YOUTUBE, NETFLIX)))
        self.assertFalse(await self.wait(""))


class WaitUntilPlayingSeen(unittest.IsolatedAsyncioTestCase):
    """`seen`: the moment wait_until_playing first read the app as playing, for move_sibling_title."""

    @staticmethod
    def out(state, position):
        return f"package={NETFLIX}\nactive=true\nstate=PlaybackState {{state={state}, position={position}, speed=1.0}}"

    async def wait(self, *outs):
        t, seen, left = FakeTV(B, "Den", []), {}, list(outs)

        async def adb(*args, **kw):
            return left.pop(0) if len(left) > 1 else left[0]   # read by read, the last one from then on

        async def no_sleep(_):
            return None
        t.adb = adb
        token = server._current.set(B)
        self.addCleanup(server._current.reset, token)
        with patch.dict(server.TVS, {B: t}, clear=True), patch.object(server.asyncio, "sleep", no_sleep):
            return await server.wait_until_playing(NETFLIX, timeout=0.2, seen=seen), seen

    async def test_the_first_read_as_playing_is_kept(self):
        before = time.monotonic()
        started, seen = await self.wait(self.out("PLAYING(3)", 1000), self.out("PLAYING(3)", 2500))
        self.assertTrue(started)
        self.assertTrue(before <= seen["at"] <= time.monotonic())

    async def test_playing_once_and_then_buffering_is_not_playing_since_then(self):
        # Codex review on #295: the moment of that one read would count the buffering as time played
        started, seen = await self.wait(self.out("PLAYING(3)", 1000), self.out("BUFFERING(6)", 1000))
        self.assertFalse(started)
        self.assertEqual(seen, {})


class ProfileItem(unittest.TestCase):
    """Picking a profile on a "Who's watching?" screen (get_it_playing), which the move leans on."""
    SCREEN = [{"label": "Access Sam's profile"}, {"label": "Access Samantha's profile"},
              {"label": "Access Kids's profile"}, {"label": "Add Profile"}, {"label": "EDIT PROFILES"}]

    def pick(self, order, items=None, own=None):
        hit = server.profile_item(self.SCREEN if items is None else items, order, own=order if own is None else own)
        return hit and hit["label"]

    def test_a_name_with_the_apps_words_around_it_is_found(self):
        self.assertEqual(self.pick(["Sam"]), "Access Sam's profile")
        self.assertEqual(self.pick(["Samantha"]), "Access Samantha's profile")
        self.assertEqual(self.pick(["samantha", "Sam"]), "Access Samantha's profile")   # the order decides
        self.assertEqual(self.pick(["Kids"]), "Access Kids's profile")
        self.assertEqual(self.pick(["Mary Ann"], [{"label": "Access Mary Ann's profile"}]), "Access Mary Ann's profile")
        self.assertEqual(self.pick(["New House"], [{"label": "Access New House's profile"}]), "Access New House's profile")
        for name in ("Saman", "Jo", "", "S", "Profile", "Add", "Edit", "Access"):
            self.assertIsNone(self.pick([name]), name)
        self.assertIsNone(self.pick([]))

    def test_a_wrapped_profile_is_called_by_the_name(self):
        hit = server.profile_item(self.SCREEN + [{"label": "Jo"}], ["Sam", "Jo"], own=["Sam"])
        self.assertEqual((hit["label"], hit["profile"]), ("Access Sam's profile", "Sam"))
        self.assertNotIn("profile", server.profile_item([{"label": "Jo"}], ["Jo"], own=["Jo"]))

    def test_buttons_that_only_mention_the_name_are_never_picked(self):
        items = [{"label": "Sign out Sam"}, {"label": "Edit Sam"}, {"label": "Welcome back, Sam"},
                 {"label": "Sam and Jo"}, {"label": "Create Kids Profile"}, {"label": "Add Profile"}]
        for name in ("Sam", "Jo", "Kids", "Add"):
            self.assertIsNone(self.pick([name], items), name)
        self.assertEqual(self.pick(["Sam"], items + self.SCREEN), "Access Sam's profile")

    def test_an_exact_label_is_enough_and_comes_first_for_each_name(self):
        items = [{"label": "Access Sam's profile"}, {"label": "Sam"}, {"label": "Jo"}]
        self.assertEqual(self.pick(["Sam"], items), "Sam")
        self.assertEqual(self.pick(["Sam", "Jo"], items[:1] + items[2:]), "Access Sam's profile")   # own, wrapped, before Jo

    def test_another_persons_name_has_to_match_exactly(self):
        # Sam is watching and has no profile here: Jo's wrapped label is not taken for Sam
        items = [{"label": "Access Jo's profile"}]
        self.assertIsNone(self.pick(["Sam", "Jo"], items, own=["Sam"]))
        self.assertEqual(self.pick(["Sam", "Jo"], [{"label": "Jo"}], own=["Sam"]), "Jo")   # as before this change

    def test_own_names_come_from_the_person_and_the_fallback(self):
        import config
        people = [{"id": "p1", "name": "Sam", "app_profiles": ["Sam", "Sammy"]}, {"id": "p2", "name": "Jo"}]
        with patch.object(config, "PEOPLE", people), patch.object(config, "APP_PROFILE_FALLBACK", ["Guest"]):
            self.assertEqual(server.profile_order("p1"), ["Sam", "Sammy", "Guest", "Jo"])
            self.assertEqual(server.profile_order("p1", own_only=True), ["Sam", "Sammy", "Guest"])
            self.assertEqual(server.profile_order(None, own_only=True), ["Guest"])


class MoveTarget(unittest.TestCase):
    def tvs(self, **kinds):
        out = {}
        for tv_id, kind in kinds.items():
            t = FakeTV(tv_id, tv_id, [])
            t.kind = kind
            out[tv_id] = t
        return patch.dict(server.TVS, out, clear=True)

    def test_the_only_other_android_tv_is_picked(self):
        with self.tvs(a="android", b="android", c="roku"):
            self.assertEqual(server.move_target("a"), "b")
            self.assertEqual(server.move_target("a", "b"), "b")

    def test_more_than_one_choice_has_to_be_named(self):
        with self.tvs(a="android", b="android", c="android"):
            with self.assertRaises(server.ApiError) as ctx:
                server.move_target("a")
            self.assertEqual(ctx.exception.key, "err_move_which_tv")
            self.assertEqual(server.move_target("a", "c"), "c")

    def test_no_other_tv_the_same_tv_and_an_unknown_tv(self):
        with self.tvs(a="android", c="roku"):
            for wanted, key in ((None, "err_move_which_tv"), ("a", "err_move_same_tv"), ("zz", "err_unknown_tv"),
                                ("a.b;reboot", "err_unknown_tv"), (["a"], "err_unknown_tv"), ({}, "err_unknown_tv"),
                                (5, "err_unknown_tv")):
                with self.assertRaises(server.ApiError) as ctx:
                    server.move_target("a", wanted)
                self.assertEqual((ctx.exception.status, ctx.exception.key), (400, key))


class MoveHandler(unittest.IsolatedAsyncioTestCase):
    async def test_one_move_at_a_time_and_off_stays_off_by_default(self):
        seen = []

        async def body(_request):
            return {"to": "b", "power_off": "yes"}   # only a real true turns TV A off

        async def move_playing(src, dst, **kw):
            seen.append((src, dst, kw["power_off"], kw["force"]))
            return {"started": True, "title": "Some Show"}
        token = server._current.set("a")
        self.addCleanup(server._current.reset, token)
        with patch.dict(server.TVS, {"a": FakeTV("a", "a", []), "b": FakeTV("b", "b", [])}, clear=True), \
             patch.object(server, "body", body), patch.object(server, "move_playing", move_playing):
            resp = await server.h_move(object())
            self.assertEqual(resp.status, 200)
            self.assertEqual(seen, [("a", "b", False, False)])
            async with server._move_lock:
                with self.assertRaises(server.ApiError) as ctx:
                    await server.h_move(object())
            self.assertEqual((ctx.exception.status, ctx.exception.key), (409, "err_move_busy"))

    def test_the_route_is_there(self):
        routes = {(r.method, r.resource.canonical) for r in server.make_app().router.routes()}
        self.assertIn(("POST", "/api/move"), routes)


class MoveHelpers(unittest.TestCase):
    def test_blind_ok_is_netflix_and_nothing_else_unless_asked(self):
        if not os.environ.get("COUCHTV_MOVE_BLIND_OK"):
            self.assertEqual(move.BLIND_OK_APPS, {"netflix"})

    def test_near(self):
        self.assertTrue(move.near(600_000, 600_000 + move.NEAR_MS))
        self.assertFalse(move.near(600_000, 600_001 + move.NEAR_MS))
        self.assertFalse(move.near(None, 5))
        self.assertFalse(move.near(5, None))

    def test_youtube_lookup_asks_again_when_the_page_gives_no_sure_answer(self):
        good = ('<script>var ytInitialData = {"c": [{"videoRenderer": {"videoId": "bbbbbbbbbbb", '
                '"title": {"simpleText": "A Video"}, "ownerText": {"simpleText": "A Channel"}}}]};</script>')
        other = ('<script>var ytInitialData = {"c": [{"videoRenderer": {"videoId": "ccccccccccc", '
                 '"title": {"simpleText": "A Video (reupload)"}, "ownerText": {"simpleText": "Someone"}}}]};</script>')
        pages = [other, "", good]     # another layout with one wrong video, a failed fetch, then the usual page
        asked = []

        async def page(query):
            asked.append(query)
            return pages[len(asked) - 1] if len(asked) <= len(pages) else ""

        async def no_sleep(_):
            return None
        move._found.clear()
        with patch.object(move, "_results_page", page), patch.object(move.asyncio, "sleep", no_sleep):
            self.assertEqual(asyncio.run(move.youtube_video_id("A Video", "A Channel")), "bbbbbbbbbbb")
            self.assertEqual(len(asked), 3)
            # found once, remembered: no new request
            self.assertEqual(asyncio.run(move.youtube_video_id("a video", "A CHANNEL")), "bbbbbbbbbbb")
            self.assertEqual(len(asked), 3)
            # never sure: three tries, then None, and nothing is remembered
            self.assertIsNone(asyncio.run(move.youtube_video_id("Another Video", "A Channel")))
            self.assertEqual(len(asked), 6)
            self.assertNotIn((move._norm("Another Video"), move._norm("A Channel")), move._found)
        move._found.clear()

    def test_same_name_in_any_script(self):
        a = "\u5343\u3068\u5343\u5c0b\u306e\u795e\u96a0\u3057"
        self.assertTrue(move.same_name(a, a))
        self.assertTrue(move.same_name("Caf\u00e9 Society", "caf\u00e9  society!"))
        self.assertFalse(move.same_name(a, "\u3082\u306e\u306e\u3051\u59eb"))
        self.assertFalse(move.same_name("", ""))
        self.assertFalse(move.same_name("!!!", "???"))

    def test_a_remembered_video_is_for_that_length_only(self):
        five = ('<script>var ytInitialData = {"c": [{"videoRenderer": {"videoId": "aaaaaaaaaaa", "title": '
                '{"simpleText": "A Video"}, "ownerText": {"simpleText": "A Channel"}, "lengthText": {"simpleText": "5:00"}}}, '
                '{"videoRenderer": {"videoId": "bbbbbbbbbbb", "title": {"simpleText": "A Video"}, "ownerText": '
                '{"simpleText": "A Channel"}, "lengthText": {"simpleText": "10:00"}}}]};</script>')
        asked = []

        async def page(query):
            asked.append(query)
            return five
        move._found.clear()
        with patch.object(move, "_results_page", page):
            self.assertEqual(asyncio.run(move.youtube_video_id("A Video", "A Channel", 300_000)), "aaaaaaaaaaa")
            self.assertEqual(asyncio.run(move.youtube_video_id("A Video", "A Channel", 600_000)), "bbbbbbbbbbb")
            self.assertEqual(len(asked), 2)
            self.assertEqual(asyncio.run(move.youtube_video_id("A Video", "A Channel", 600_400)), "bbbbbbbbbbb")
            self.assertEqual(len(asked), 2)      # the same length again: remembered
        move._found.clear()

    def test_clock(self):
        self.assertEqual([move.clock(x) for x in (0, 83_000, 3_723_000, None)], ["0:00", "1:23", "1:02:03", "0:00"])

    def test_seek_command_checks_the_package(self):
        self.assertTrue(move.seek_command(NETFLIX, 1234.9).endswith(f"--es pkg {NETFLIX} --es pos_ms 1234"))
        self.assertTrue(move.seek_command(NETFLIX, -5).endswith("--es pos_ms 0"))
        for bad in ("a.b;reboot", "a.b && id", "nodots", None):
            with self.assertRaises(tvmod.UnsafeInput):
                move.seek_command(bad, 1000)
        with self.assertRaises(ValueError):
            move.seek_command(NETFLIX, "1; reboot")

    def test_seek_ok(self):
        self.assertTrue(move.seek_ok('Broadcast completed: result=0, data="{"id":2,"result":"ok"}"\n'))
        self.assertFalse(move.seek_ok('Broadcast completed: result=0, data="{"error":"no media session"}"'))
        self.assertFalse(move.seek_ok("Broadcast completed: result=0"))
        self.assertFalse(move.seek_ok(""))
        self.assertFalse(move.seek_ok('Broadcast completed: result=0, data="[1]"'))

    def test_can_seek(self):
        self.assertTrue(move.can_seek('Broadcast completed: result=0, data="{"state":3,"can_seek":true}"'))
        self.assertFalse(move.can_seek('Broadcast completed: result=0, data="{"state":3,"can_seek":false}"'))
        self.assertFalse(move.can_seek('Broadcast completed: result=0, data="{"error":"no media session"}"'))
        self.assertFalse(move.can_seek(""))
        self.assertTrue(move.can_seek_command(NETFLIX).endswith(f"--es op state --es pkg {NETFLIX}"))
        with self.assertRaises(tvmod.UnsafeInput):
            move.can_seek_command("a.b;reboot")

    def test_youtube_link(self):
        self.assertEqual(move.youtube_link("abcdefghijk"), "https://www.youtube.com/watch?v=abcdefghijk")
        self.assertEqual(move.youtube_link("abcdefghijk", 61.9), "https://www.youtube.com/watch?v=abcdefghijk&t=61")
        for bad in ("short", "abcdefghijk&x=1", "abcdefghij'", None):
            with self.assertRaises(ValueError):
                move.youtube_link(bad)

    def test_youtube_results_and_pick(self):
        page = ('<script>var ytInitialData = {"contents": [{"videoRenderer": {"videoId": "aaaaaaaaaaa", '
                '"title": {"runs": [{"text": "A Video"}]}, "ownerText": {"runs": [{"text": "Other Channel"}]}, '
                '"lengthText": {"simpleText": "15:00"}}}, {"videoRenderer": {"videoId": "bbbbbbbbbbb", '
                '"title": {"simpleText": "A Video"}, "ownerText": {"runs": [{"text": "A Channel"}]}, '
                '"lengthText": {"simpleText": "15:01"}}}]};</script>')
        found = move.youtube_results(page)
        self.assertEqual([r["id"] for r in found], ["aaaaaaaaaaa", "bbbbbbbbbbb"])
        self.assertEqual(found[1], {"id": "bbbbbbbbbbb", "title": "A Video", "channel": "A Channel", "length_s": 901})
        self.assertEqual(move.youtube_pick(found, "a video!", "A Channel", 900_000), "bbbbbbbbbbb")
        self.assertEqual(move.youtube_pick(found, "A Video", "A Channel"), "bbbbbbbbbbb")
        self.assertIsNone(move.youtube_pick(found, "A Video", "A Channel", 300_000))   # the length disagrees
        self.assertIsNone(move.youtube_pick(found, "Another Video", "A Channel", 900_000))
        self.assertIsNone(move.youtube_pick(found, "A Video", "Nobody"))
        self.assertEqual(move.youtube_results("<html>consent</html>"), [])
        self.assertEqual(move.youtube_results("<script>var ytInitialData = {broken;</script>"), [])


if __name__ == "__main__":
    unittest.main()
