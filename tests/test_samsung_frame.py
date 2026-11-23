"""Samsung switching on and off (bridge/samsung_frame.py), against a stand-in TV.

The 19 Nov 2026 beginner test on a 2021 Frame: switched on from the phone while in Art Mode, the TV
said "standby" for a moment on its way to the picture, the old hook took that for the Art Mode
sleep timer, said "left alone" and never opened couch-tv. And "on" from the phone hung for about
30 seconds on a TV that could not be woken. These pin both down, plus the sleep timer case the
old check was written for, and the samsung/build.py release package.

Run: python3 -m unittest tests/test_samsung_frame.py
"""
import asyncio
import os
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from unittest.mock import patch

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import samsung_frame  # noqa: E402
from tv import TVUnavailable  # noqa: E402

# Made-up addresses, joined here so the privacy scan's MAC rule does not read test data as a real one.
MAC_TV = ":".join(["02", "00", "5e", "10", "00", "01"])
MAC_CFG = ":".join(["02", "00", "5e", "10", "00", "02"])
MAC_ZERO = ":".join(["00"] * 6)


class StandIn:
    """What the TV answers on /api/v2/, one answer per read (the last one repeats)."""

    def __init__(self, answers, mac=MAC_TV):
        self.answers = list(answers)
        self.mac = mac
        self.launched = []

    async def get_json(self, path, timeout=3):
        if path != "/api/v2/":
            return None
        a = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if a is None:
            raise OSError("no answer")
        return {"device": {"PowerState": a, "FrameTVSupport": "true", "deviceMac": self.mac}}


def make(stand, data, **cfg):
    with patch.object(config, "DATA", data):
        tv = samsung_frame.SamsungTV({"id": "frame", "name": "Frame", "ip": "192.0.2.5", **cfg})
    tv._get_json = stand.get_json
    tv.frame = True
    tv.art_mode = False

    async def front():
        return stand.launched[-1] if stand.launched else None

    async def launch(app_id, meta=""):
        stand.launched.append(app_id)
        return "rest"
    tv._front = front
    tv._launch_tizen = launch
    return tv


class HookTests(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.fast = [patch.object(samsung_frame, "HOOK_STEP", 0.01), patch.object(samsung_frame, "HOOK_SETTLE", 0.3)]
        for p in self.fast:
            p.start()
        self.sleep = asyncio.sleep

        async def quick(s):   # the hook's own waits (3 s after a launch) run at once here
            await self.sleep(min(s, 0.01))
        self.p = patch.object(samsung_frame.asyncio, "sleep", quick)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        for p in self.fast:
            p.stop()

    def test_standby_blip_on_the_way_out_of_art_mode_still_opens_couch_tv(self):
        stand = StandIn(["standby", "standby", "on", "on"])
        tv = make(stand, self.data)
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, ["CouchTVApp.Home"])
        self.assertIn("opened couch-tv", tv.hook_log[-1][1])

    def test_a_refused_launch_just_after_art_mode_is_tried_again(self):
        # 20 Nov 2026, a real 2021 Frame: the first launch after leaving Art Mode failed with "not
        # answering on the network" and the hook gave up. The second try works.
        stand = StandIn(["on"])
        tv = make(stand, self.data)
        tries = []

        async def launch(app_id, meta=""):
            tries.append(app_id)
            if len(tries) == 1:
                raise TVUnavailable("the frame TV is not answering on the network")
            stand.launched.append(app_id)
            return "rest"
        tv._launch_tizen = launch
        asyncio.run(tv._hook())
        self.assertEqual(len(tries), 2)
        self.assertEqual(stand.launched, ["CouchTVApp.Home"])
        self.assertIn("opened couch-tv (rest, try 2)", tv.hook_log[-1][1])

    def test_a_launch_that_never_works_stops_after_three_tries(self):
        stand = StandIn(["on"])
        tv = make(stand, self.data)
        tries = []

        async def launch(app_id, meta=""):
            tries.append(app_id)
            raise TVUnavailable("the frame TV is not answering on the network")
        tv._launch_tizen = launch
        asyncio.run(tv._hook())
        self.assertEqual(len(tries), 3)
        self.assertIn("could not open couch-tv", tv.hook_log[-1][1])

    def test_art_mode_sleep_timer_is_left_alone_and_does_not_use_up_the_hook(self):
        stand = StandIn(["on", "standby"])
        tv = make(stand, self.data)
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, [])
        self.assertIn("went to sleep, left alone", tv.hook_log[-1][1])
        # the real switch-on a moment later is still seen
        stand.answers = ["on"]
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, ["CouchTVApp.Home"])

    def test_still_in_art_mode_is_not_switched_on(self):
        stand = StandIn(["on"])
        tv = make(stand, self.data)
        tv.art_mode = True
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, [])

    def test_a_command_running_wins(self):
        stand = StandIn(["on"])
        tv = make(stand, self.data)
        tv.quiet_until = time.monotonic() + 20
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, [])
        self.assertIn("a command is running", tv.hook_log[-1][1])

    def test_open_on_power_on_false_does_nothing(self):
        stand = StandIn(["on"])
        tv = make(stand, self.data, open_on_power_on=False)
        asyncio.run(tv._hook())
        self.assertEqual(stand.launched, [])


class WakeTests(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()

    def test_mac_is_learnt_from_the_tv_and_kept(self):
        stand = StandIn(["on"])
        tv = make(stand, self.data)
        self.assertIsNone(tv.mac)
        self.assertTrue(asyncio.run(tv._read_device()))
        self.assertEqual(tv.mac, MAC_TV)
        again = make(StandIn([None]), self.data)   # a bridge restarted while the TV is off
        self.assertEqual(again.mac, MAC_TV)

    def test_config_mac_wins_and_a_zero_mac_is_ignored(self):
        tv = make(StandIn(["on"], mac=MAC_ZERO), self.data)
        asyncio.run(tv._read_device())
        self.assertIsNone(tv.mac)
        tv2 = make(StandIn(["on"]), self.data, mac=MAC_CFG)
        asyncio.run(tv2._read_device())
        self.assertEqual(tv2.mac, MAC_CFG)

    def test_no_mac_says_use_the_remote_at_once(self):
        tv = make(StandIn([None]), self.data)
        with self.assertRaises(TVUnavailable) as e:
            asyncio.run(tv.wake())
        self.assertEqual(e.exception.key, "err_tv_did_not_wake")

    def test_no_answer_gives_up_after_the_limit_not_after_32_seconds(self):
        tv = make(StandIn([None]), self.data, mac=MAC_CFG)
        sent = []

        async def packet():
            sent.append(1)
        with patch.object(samsung_frame.samsung.SamsungTV, "wake", lambda self: packet()), \
                patch.object(samsung_frame, "WAKE_GIVE_UP", 0.05):
            asyncio.run(tv.wake())
            time.sleep(0.03)
            asyncio.run(tv.wake())
            time.sleep(0.05)
            with self.assertRaises(TVUnavailable):
                asyncio.run(tv.wake())
            self.assertEqual(len(sent), 2)
            # a new "on" much later starts again
            tv._wake_last -= 30
            asyncio.run(tv.wake())
            self.assertEqual(len(sent), 3)

    def test_on_again_right_after_a_failed_wake_sends_a_packet(self):
        # Fable review of 0.13.4: On tapped again within 10 s of giving up failed at once, with no packet
        tv = make(StandIn([None]), self.data, mac=MAC_CFG)
        sent = []

        async def packet():
            sent.append(1)
        with patch.object(samsung_frame.samsung.SamsungTV, "wake", lambda self: packet()), \
                patch.object(samsung_frame, "WAKE_GIVE_UP", 0.05):
            asyncio.run(tv.wake())
            time.sleep(0.06)
            with self.assertRaises(TVUnavailable):
                asyncio.run(tv.wake())
            self.assertEqual(len(sent), 1)
            asyncio.run(tv.wake())   # tapped again a moment later
            self.assertEqual(len(sent), 2)


class PowerHoldTests(unittest.TestCase):
    """Fable review of 0.13.4: docs/SAMSUNG.md says the bridge never holds power, but /api/key with
    hold=true (the MCP tool) held it for 3 seconds, which switches a Frame fully off. Now power is one
    press, and other keys can still be held."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.data = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def sent(self, name, hold):
        tv = make(StandIn(["on"]), self.data)
        cmds = []

        async def key(code, cmd="Click"):
            cmds.append((code, cmd))
        tv._key = key
        asyncio.run(tv.key(name, hold=hold))
        return cmds

    def test_power_is_never_held(self):
        self.assertEqual(self.sent("power", True), [("KEY_POWER", "Click")])

    def test_other_keys_can_still_be_held(self):
        self.assertEqual(self.sent("ok", True), [("KEY_ENTER", "Press"), ("KEY_ENTER", "Release")])


class ReleaseBuildTests(unittest.TestCase):
    def test_release_package_has_no_bridge_no_key_and_the_installers(self):
        out = subprocess.run([sys.executable, os.path.join(ROOT, "samsung", "build.py"), "--release"],
                             capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(out.returncode, 0, out.stderr)
        build = os.path.join(ROOT, "build", "samsung")
        with zipfile.ZipFile(os.path.join(build, "couch-tv-samsung.wgt")) as z:
            names = set(z.namelist())
            settings = z.read("settings.js").decode()
            index = z.read("index.html").decode()
            xml = z.read("config.xml").decode()
        for f in ("boot.html", "kept.js", "update.js", "design-code.js", "designer-gate.js", "tizen.js", "tizen-policy.js"):
            self.assertIn(f, names)
        self.assertIn('"bridge": ""', settings)
        self.assertIn('"key": ""', settings)
        self.assertRegex(settings, r'"version": "\d+\.\d+\.\d+"')
        self.assertRegex(xml, r'version="\d+\.\d+\.\d+"')
        self.assertLess(index.index("settings.js"), index.index("kept.js"))
        self.assertLess(index.index("kept.js"), index.index("tizen.js"))
        self.assertLess(index.index("designer-gate.js"), index.index("tizen-policy.js"))
        with zipfile.ZipFile(os.path.join(build, "couch-tv-samsung-setup.zip")) as z:
            names = set(z.namelist())
            mode = z.getinfo("couch-tv for Samsung/Install on Mac.command").external_attr >> 16
            cmd = z.read("couch-tv for Samsung/Install on Windows.cmd")
        for f in ("CouchTV.wgt", "START HERE.txt", "Install on Mac.command", "Install on Windows.cmd", "install-windows.ps1"):
            self.assertIn("couch-tv for Samsung/" + f, names)
        self.assertTrue(mode & 0o111, "the Mac installer must stay runnable")
        self.assertIn(b"\r\n", cmd)

    def test_release_refuses_a_bridge(self):
        out = subprocess.run([sys.executable, os.path.join(ROOT, "samsung", "build.py"), "--release", "--bridge", "http://192.0.2.1:5400"],
                             capture_output=True, text=True, cwd=ROOT)
        self.assertNotEqual(out.returncode, 0)

    def test_installers_pin_and_check_the_tool(self):
        for name in ("Install on Mac.command", "install-windows.ps1"):
            with open(os.path.join(ROOT, "samsung", "setup", name)) as f:
                text = f.read()
            self.assertIn('A2S_VERSION="3.3.1"' if name.endswith("command") else '$A2SVersion = "3.3.1"', text)
            self.assertRegex(text, r"[0-9a-f]{64}")
            self.assertNotIn("password", text.lower().replace("never sees your password", ""))
        with open(os.path.join(ROOT, "samsung", "setup", "START HERE.txt")) as f:
            start = f.read().lower()
        for banned in ("coming soon", "beta", "press home to open couch-tv"):
            self.assertNotIn(banned, start)
        self.assertIn("about 30 minutes", start)
        self.assertIn("gpl-3.0", start)   # the licence note for the tool the installers download

    def test_installers_check_the_kept_download_every_run(self):
        # Fable review of 0.13.4: a tool already on the computer was used with no check. Now the
        # download is kept, hashed on every run, and the tool is unpacked again from it.
        with open(os.path.join(ROOT, "samsung", "setup", "Install on Mac.command")) as f:
            mac = f.read()
        tool = mac[mac.index("# ---- 1. the install tool ----"):mac.index("# ---- 2. the TV ----")]
        self.assertNotIn('if [ ! -x "$CLI" ]', tool)
        self.assertIn('[ "$(sha_of "$TGZ")" != "$SHA" ]', tool)
        self.assertIn('tar -xzf "$TGZ"', tool.split("fi\n")[-1])   # unpacked after the check, every run
        self.assertNotIn('rm -f "$TGZ"\n  chmod', tool)
        with open(os.path.join(ROOT, "samsung", "setup", "install-windows.ps1")) as f:
            win = f.read()
        tool = win[win.index("# ---- 1. the install tool ----"):win.index("# ---- 2. the TV ----")]
        self.assertNotIn("if (-not (Test-Path $Cli))", tool)
        self.assertIn("if ((Get-Sha $Zip) -ne $Sha[$Arch])", tool)
        self.assertGreater(tool.index("Expand-Archive"), tool.rindex("Stop-Setup"))

    def test_windows_installer_never_redirects_errors_under_stop(self):
        # PowerShell 5.1 with $ErrorActionPreference = "Stop": "2>$null" on a program that writes to
        # its error output throws, so the TV scan could fail on a TV that is there.
        with open(os.path.join(ROOT, "samsung", "setup", "install-windows.ps1")) as f:
            win = f.read()
        self.assertNotIn("2>$null", win)
        self.assertIn('$ErrorActionPreference = "Continue"', win)
        self.assertIn("Invoke-CliOutput scan --json", win)

    def test_start_here_says_where_the_certificate_is_kept(self):
        with open(os.path.join(ROOT, "samsung", "setup", "START HERE.txt")) as f:
            start = f.read()
        self.assertIn("Apps2Samsung keeps that signing certificate on this computer", start)

    def test_start_here_uses_the_0139_words_and_the_setup_shows_the_address(self):
        # launch audit 0.13.9: the section is Designs from 0.13.9, and the installer prints the computer's
        # address, so the setup starts before Developer mode and nobody hunts through the menus for it
        with open(os.path.join(ROOT, "samsung", "setup", "START HERE.txt")) as f:
            start = f.read()
        self.assertIn("Home settings), then Designs, then Get a design from your phone", start)
        self.assertNotIn("open couch-tv Studio", start)
        self.assertNotIn("Find your computer's address", start)
        self.assertLess(start.index("This computer's address is"), start.index("STEP 3. Developer mode on the TV"))
        self.assertIn("press Return (Windows: Enter)", start)
        with open(os.path.join(ROOT, "samsung", "setup", "Install on Mac.command")) as f:
            self.assertIn("This computer's address is", f.read())   # what step 2 promises


class ServerHookTests(unittest.TestCase):
    """server.py makes every "kind": "samsung" TV from samsung_frame, not plain samsung (the shared hook)."""

    def test_make_tv_returns_the_frame_class(self):
        import server
        with patch.object(config, "DATA", tempfile.mkdtemp()):
            tv = server.make_tv({"kind": "samsung", "id": "frame", "name": "Frame", "ip": "192.0.2.5"})
        self.assertIs(type(tv), samsung_frame.SamsungTV)
        self.assertEqual(tv.kind, "samsung")

    def test_other_kinds_are_untouched(self):
        import server
        with patch.object(config, "DATA", tempfile.mkdtemp()):
            tv = server.make_tv({"kind": "lg", "id": "lg", "name": "LG", "ip": "192.0.2.6"})
        self.assertNotIsInstance(tv, samsung_frame.SamsungTV)

    def test_server_imports_samsung_frame_under_samsung(self):
        with open(os.path.join(ROOT, "bridge", "server.py")) as f:
            text = f.read()
        self.assertIn("import samsung\nimport samsung_frame\n", text)
        self.assertIn("return samsung_frame.SamsungTV(cfg)", text)
        self.assertNotIn("return samsung.SamsungTV(cfg)", text)

if __name__ == "__main__":
    unittest.main()
