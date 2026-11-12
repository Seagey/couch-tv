"""Privacy clean (PRIVACY=1, docs/PRIVACY.md): the list in tv-home/tools/privacy-list.txt, and apply.sh
and undo.sh run against a pretend TV (tests/privacy_standin.py). NOT a real TV: no adb is used."""
import fnmatch
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
TOOLS = ROOT / "tv-home" / "tools"
LIST = TOOLS / "privacy-list.txt"
STANDIN = Path(__file__).parent / "privacy_standin.py"
PKG = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")
DREAM = "com.google.android.apps.tv.dreamx"
LAUNCHER = "com.google.android.apps.tv.launcherx"


def entries():
    out = []
    for line in LIST.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        out.append([f.strip() for f in line.split("|")])
    return out


def packages():
    return [e[0] for e in entries()]


def apply_text():
    return (TOOLS / "apply.sh").read_text()


def never_off():
    m = re.search(r'^NEVER_OFF="([^"]*)"', apply_text(), re.M)
    return set(m.group(1).replace("$WIZARD", "com.google.android.tungsten.setupwraith").split())


def guard_patterns():
    """The case patterns in apply.sh's needed() that refuse a package by its name."""
    body = apply_text().split("needed() {", 1)[1].split("\n}", 1)[0]
    pats = []
    for line in body.splitlines():
        line = line.strip()
        if line.endswith(") return 0 ;;") and not line.startswith("case"):
            pats += line[: -len(") return 0 ;;")].split("|")
    return pats


def never_disable():
    src = (ROOT / "bridge" / "server.py").read_text()
    m = re.search(r"NEVER_DISABLE = \{(.*?)\}", src, re.S)
    return set(re.findall(r'"([^"]+)"', m.group(1)))


class TheList(unittest.TestCase):
    def test_parses(self):
        rows = entries()
        self.assertGreater(len(rows), 10)
        for row in rows:
            self.assertEqual(len(row), 5, row)
            self.assertTrue(PKG.match(row[0]), row[0])
            self.assertTrue(all(row), row)
        names = packages()
        self.assertEqual(len(names), len(set(names)), "a package is listed twice")

    def test_nothing_the_tv_needs(self):
        protected = never_off() | never_disable() | {DREAM}
        pats = guard_patterns()
        self.assertIn("com.android.*", pats)
        self.assertIn("*bluetooth*", pats)
        for p in packages():
            self.assertNotIn(p, protected)
            for pat in pats:
                self.assertFalse(fnmatch.fnmatchcase(p, pat), "%s matches the guard's %s" % (p, pat))

    def test_keep_watching_and_the_remote_are_never_listed(self):
        bad = re.compile(
            r"launcher|tvhome|setup|wraith|provision|oobe|gms|gsf|vending|venezia|systemui|"
            r"providers\.tv|tvprovider|tv\.provider|listings|watchnext|watch_next|recommend|channel|"
            r"tvinput|tifobserver|tuner|livetv|"
            r"bluetooth|pair|\.ble|remote|rcu|fireinputdevices|keypolicy|voice|assistant|katniss|vizzini|"
            r"cec|devicecontrol|inputmethod|\.ime$|keyboard|"
            r"ota|update|upgrade|mediashell|cast|webview",
            re.I)
        for p in packages():
            self.assertIsNone(bad.search(p), p)
        self.assertNotIn("com.android.providers.tv", packages())


class Run(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        tools = self.dir / "tv-home" / "tools"
        tools.mkdir(parents=True)
        for f in ("apply.sh", "undo.sh", "privacy-list.txt"):
            shutil.copy(TOOLS / f, tools / f)
        self.tools = tools
        self.state = self.dir / "tv.json"
        bin_ = self.dir / "bin"
        bin_.mkdir()
        py = bin_ / "py"
        py.write_text('#!/bin/sh\nexec "%s" "%s" "$@"\n' % (sys.executable, STANDIN))
        (bin_ / "sleep").write_text("#!/bin/sh\nexit 0\n")
        for f in (py, bin_ / "sleep"):
            f.chmod(f.stat().st_mode | stat.S_IEXEC)
        self.apk = self.dir / "app.apk"
        self.apk.write_text("stand in")
        self.env = {"PATH": "%s:%s" % (bin_, os.environ["PATH"]), "PY": str(py), "TV_IP": "192.0.2.1",
                    "APK": str(self.apk), "PRIVACY_STANDIN": str(self.state), "HOME": str(self.dir)}
        self.tv(present=[LAUNCHER, DREAM, "com.android.providers.tv"] + packages())

    def tv(self, **kw):
        s = {"present": [], "disabled": [], "homes": [LAUNCHER], "persistent": [], "log": []}
        s.update(kw)
        self.state.write_text(json.dumps(s))

    def read(self):
        return json.loads(self.state.read_text())

    def run_sh(self, script, **env):
        e = dict(self.env, **env)
        r = subprocess.run(["sh", str(self.tools / script)], env=e, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def switched_off(self):
        return [c.split()[-1] for c in self.read()["log"] if c.startswith("pm disable-user")]

    def undo_list(self):
        return (self.dir / "tv-home" / "tvs" / "living-room.disabled").read_text().split()

    def test_privacy_unset_changes_nothing(self):
        self.run_sh("apply.sh")
        self.assertEqual(self.switched_off(), [DREAM])
        self.assertEqual(self.undo_list(), [DREAM])

    def test_privacy_switches_off_the_list_and_undo_turns_it_all_back_on(self):
        out = self.run_sh("apply.sh", PRIVACY="1")
        off = self.switched_off()
        self.assertEqual(set(off), set(packages()) | {DREAM})
        self.assertEqual(sorted(off), sorted(self.undo_list()))
        self.assertIn("privacy: switched off tv.samba.ssm (Sony Bravia:", out)
        for p in never_off():
            self.assertNotIn(p, off)
        self.assertNotIn("com.android.providers.tv", off)
        s = self.read()
        s["log"] = []
        self.state.write_text(json.dumps(s))
        self.run_sh("undo.sh")
        enabled = {c.split()[-1] for c in self.read()["log"] if c.startswith("pm enable")}
        self.assertTrue(set(off) <= enabled, set(off) - enabled)
        self.assertEqual(self.read()["disabled"], [])

    def test_guard_refuses_a_home_or_persistent_package_even_on_the_list(self):
        home, persistent = packages()[0], packages()[1]
        self.tv(present=[LAUNCHER, DREAM] + packages(), homes=[LAUNCHER, home], persistent=[persistent])
        with (self.tools / "privacy-list.txt").open("a") as f:
            f.write("%s | test | a home | - | test\n" % LAUNCHER)
        out = self.run_sh("apply.sh", PRIVACY="1")
        off = self.switched_off()
        for p in (home, persistent, LAUNCHER):
            self.assertNotIn(p, off)
            self.assertNotIn(p, self.undo_list())
            self.assertIn("leaving %s on: the TV may need it to start" % p, out)

    def test_dry_run_changes_nothing(self):
        out = self.run_sh("apply.sh", PRIVACY="1", DRY_RUN="1")
        log = self.read()["log"]
        self.assertFalse([c for c in log if c.startswith(("pm disable", "pm enable", "cmd package set", "settings put", "am "))], log)
        self.assertNotIn("install", log)
        self.assertFalse((self.dir / "tv-home" / "tvs" / "living-room.disabled").exists())
        self.assertIn("privacy: would switch off com.amazon.tv.acr (Fire TV:", out)
        self.assertIn("would switch off %s" % DREAM, out)

    def test_dry_run_without_a_tv_prints_the_list(self):
        e = dict(self.env)
        e.pop("TV_IP")
        r = subprocess.run(["sh", str(self.tools / "apply.sh")], env=dict(e, DRY_RUN="1"), capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        for p in packages():
            self.assertIn(p, r.stdout)
        self.assertEqual(self.read()["log"], [])

    def test_a_later_run_without_privacy_keeps_them_on_the_undo_list(self):
        self.run_sh("apply.sh", PRIVACY="1")
        first = set(self.undo_list())
        out = self.run_sh("apply.sh")
        self.assertEqual(set(self.undo_list()), first)
        self.assertIn("stays off from an earlier PRIVACY=1 run", out)

    def test_already_off_before_couch_tv_is_left_alone(self):
        p = packages()[2]
        self.tv(present=[LAUNCHER, DREAM] + packages(), disabled=[p])
        out = self.run_sh("apply.sh", PRIVACY="1")
        self.assertNotIn(p, self.switched_off())
        self.assertNotIn(p, self.undo_list())
        self.assertIn("%s was already off before couch-tv" % p, out)

    def test_a_bad_name_on_the_list_never_reaches_the_tv(self):
        with (self.tools / "privacy-list.txt").open("a") as f:
            f.write("a.b;reboot | test | bad | - | test\n")
        self.run_sh("apply.sh", PRIVACY="1")
        self.assertFalse([c for c in self.read()["log"] if "reboot" in c])


if __name__ == "__main__":
    unittest.main()
