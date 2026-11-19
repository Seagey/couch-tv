"""remove-all.sh's EXTRA_APPS: an older home app of your own that came before couch-tv is removed in the
same step, and nothing that belongs to the TV itself can be named there. Runs the real script against a
pretend TV (a stand-in for tvadb.py that logs every call), so no TV is touched."""
import os
import stat
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tv-home", "tools", "remove-all.sh")

FAKE = """#!/bin/sh
# stand-in for: python tvadb.py <command> ...: every package is "on the TV"
shift
echo "$*" >> "$FAKE_LOG"
case "$2" in
  "pm list packages "*) echo "package:${2##* }" ;;
esac
exit 0
"""


class RemoveAllExtraApps(unittest.TestCase):
    def run_script(self, extra):
        d = tempfile.mkdtemp()
        fake = os.path.join(d, "py")
        with open(fake, "w") as f:
            f.write(FAKE)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        log = os.path.join(d, "log")
        env = dict(os.environ, PY=fake, FAKE_LOG=log, TV_IP="192.0.2.10", TVADB_TIMEOUT="1")
        if extra is not None:
            env["EXTRA_APPS"] = extra
        p = subprocess.run(["sh", SCRIPT], env=env, capture_output=True, text=True, timeout=60)
        with open(log) as f:
            calls = f.read()
        return p, calls

    def uninstalled(self, calls):
        return [l.split()[-1] for l in calls.splitlines() if l.startswith("shell pm uninstall")]

    def test_default_removes_only_couch_tv(self):
        p, calls = self.run_script(None)
        self.assertEqual(self.uninstalled(calls), ["app.couchtv.launcher", "dev.couchtv.ontv"], p.stdout + p.stderr)

    def test_extra_app_of_your_own_is_removed(self):
        p, calls = self.run_script("org.example.oldhome")
        self.assertEqual(self.uninstalled(calls), ["app.couchtv.launcher", "dev.couchtv.ontv", "org.example.oldhome"], p.stdout + p.stderr)

    def test_the_tvs_own_apps_are_refused(self):
        p, calls = self.run_script("com.google.android.apps.tv.launcherx com.google.android.tungsten.setupwraith com.tcl.home x;rm")
        self.assertEqual(self.uninstalled(calls), ["app.couchtv.launcher", "dev.couchtv.ontv"])
        self.assertIn("looks like part of the TV itself", p.stdout)
        self.assertIn("is not a package name", p.stdout)


if __name__ == "__main__":
    unittest.main()
