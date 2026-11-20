"""The Matter fixtures kit (tests/matter/fixtures/fx.py) and the contract harness (tests/matter_contract.py)
agree on what fx answers, and the one-run-at-a-time lock works. No MacBook or device needed."""
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fx = load("matter_fx", os.path.join(HERE, "matter", "fixtures", "fx.py"))
mc = load("matter_contract", os.path.join(HERE, "matter_contract.py"))


def fx_answer(argv):
    """What `fx <argv>` prints, as the harness reads it (the last JSON line), with no devices behind it."""
    buf = io.StringIO()
    with mock.patch.object(fx, "ensure_dirs", lambda: None), \
            mock.patch.object(fx, "fabrics", lambda n: {"name": n, "fabrics": 2 if n == "light" else 1}), \
            contextlib.redirect_stdout(buf):
        fx.main(argv)
    lines = [l for l in buf.getvalue().splitlines() if l.startswith("{")]
    return json.loads(lines[-1])


class FabricsShape(unittest.TestCase):
    def test_one_name_answers_name_and_fabrics(self):
        a = fx_answer(["fabrics", "light"])
        self.assertEqual(a, {"name": "light", "fabrics": 2})

    def test_no_name_answers_every_device(self):
        a = fx_answer(["fabrics"])
        self.assertEqual([d["name"] for d in a["devices"]], fx.ORDER)
        self.assertEqual(len(a["devices"]), 8)

    def test_harness_reads_both_shapes(self):
        self.assertEqual(mc.fabrics_of(fx_answer(["fabrics", "light"]), "light"), 2)
        self.assertEqual(mc.fabrics_of(fx_answer(["fabrics"]), "fan"), 1)
        with self.assertRaises(KeyError):
            mc.fabrics_of({"devices": []}, "fan")

    def test_harness_fx_fabrics_through_fx_main(self):
        f = mc.Fx("fx")
        with mock.patch.object(mc.Fx, "run", lambda self, *a, **k: fx_answer([str(x) for x in a])):
            self.assertEqual(f.fabrics("light"), 2)
            self.assertEqual(f.fabrics("plug"), 1)


class LockBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.lockdir = os.path.join(self.tmp.name, "matter-fixtures.lock")
        p = mock.patch.object(fx, "LOCKDIR", self.lockdir)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

class RunLock(LockBase):
    def test_lock_path_sits_next_to_the_kit(self):
        self.assertEqual(load("fx2", os.path.join(HERE, "matter", "fixtures", "fx.py")).LOCKDIR,
                         os.path.join(os.path.expanduser("~"), "matter-fixtures.lock"))

    def test_second_run_is_refused_and_told_who_holds_it(self):
        self.assertTrue(fx.take_lock("a", "run A")["ok"])
        r = fx.take_lock("b", "run B")
        self.assertFalse(r["ok"])
        self.assertEqual(r["held_by"]["about"], "run A")
        self.assertNotIn("token", r["held_by"])
        self.assertTrue(fx.take_lock("a")["ok"])  # the holder may ask again

    def test_only_the_holder_or_force_unlocks(self):
        fx.take_lock("a", "run A")
        self.assertFalse(fx.drop_lock("b")["ok"])
        self.assertTrue(os.path.isdir(self.lockdir))
        self.assertTrue(fx.drop_lock("a")["ok"])
        self.assertFalse(os.path.exists(self.lockdir))
        fx.take_lock("c")
        self.assertTrue(fx.drop_lock("--force")["ok"])
        self.assertFalse(os.path.exists(self.lockdir))
        self.assertTrue(fx.take_lock("d")["ok"])


class ChipToolLock(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.object(fx, "LOCK", os.path.join(self.tmp.name, "chip-tool.lock"))
        p.start()
        self.addCleanup(p.stop)

    def test_a_dead_holder_is_stale_a_live_one_is_not(self):
        os.mkdir(fx.LOCK)
        with open(os.path.join(fx.LOCK, "pid"), "w") as f:
            f.write(str(os.getpid()))
        self.assertFalse(fx.Locked.stale())
        with open(os.path.join(fx.LOCK, "pid"), "w") as f:
            f.write("999999")  # no such process
        self.assertTrue(fx.Locked.stale())

    def test_no_pid_is_stale_only_after_400_s(self):
        os.mkdir(fx.LOCK)
        self.assertFalse(fx.Locked.stale())
        os.utime(fx.LOCK, (0, 0))
        self.assertTrue(fx.Locked.stale())

    def test_taken_and_given_back(self):
        with fx.Locked():
            self.assertTrue(os.path.isdir(fx.LOCK))
        self.assertFalse(os.path.exists(fx.LOCK))


class PrivateCopyName(unittest.TestCase):
    def test_bad_names_are_refused(self):
        import subprocess
        script = os.path.join(HERE, "matter", "fixtures", "private-copy.py")
        for bad in ("matter-fixtures", "../x", "-x", "a/b", "x" * 42, ""):
            r = subprocess.run([sys.executable, script, bad], capture_output=True, text=True,
                               env={**os.environ, "HOME": tempfile.gettempdir() + "/no-such-home"})
            self.assertNotEqual(r.returncode, 0, bad)
            if not bad.startswith("-"):  # "-x" is already refused by argparse as an unknown option
                self.assertIn("pick another plain folder name", r.stderr, bad)


class FakeFx:
    """Stands in for the fixtures: a lock folder in a temp dir through fx's own take_lock/drop_lock."""
    def __init__(self, cmd):
        self.cmd = ["fx"]
        self.calls = []

    def lock(self, token, about):
        self.calls.append("lock")
        return fx.take_lock(token, about)

    def unlock(self, token):
        self.calls.append("unlock")
        return fx.drop_lock(token)


class HarnessLock(LockBase):
    def run_main(self, run_all):
        made = []

        def make(cmd):
            made.append(FakeFx(cmd))
            return made[-1]
        argv = ["matter_contract.py", "--api", "http://127.0.0.1:1", "--lock-wait", "0"]
        err = io.StringIO()
        with mock.patch.object(mc, "Fx", make), mock.patch.object(mc, "run_all", run_all), \
                mock.patch.object(sys, "argv", argv), contextlib.redirect_stderr(err):
            try:
                code = mc.main()
            except Exception as e:
                code = e
        return code, made[0], err.getvalue()

    def test_lock_is_given_back_after_a_run(self):
        code, f, _ = self.run_main(lambda *a: 0)
        self.assertEqual(code, 0)
        self.assertEqual(f.calls, ["lock", "unlock"])
        self.assertFalse(os.path.exists(self.lockdir))

    def test_lock_is_given_back_when_the_run_crashes(self):
        def boom(*a):
            raise RuntimeError("device gone")
        code, f, _ = self.run_main(boom)
        self.assertIsInstance(code, RuntimeError)
        self.assertEqual(f.calls, ["lock", "unlock"])
        self.assertFalse(os.path.exists(self.lockdir))

    def test_signal_handlers_are_in_place_before_the_lock(self):
        import signal
        seen = []
        real_lock = FakeFx.lock

        def lock(self, token, about):
            seen.append(signal.getsignal(signal.SIGTERM))
            return real_lock(self, token, about)
        with mock.patch.object(FakeFx, "lock", lock):
            code, f, _ = self.run_main(lambda *a: 0)
        self.assertEqual(code, 0)
        self.assertTrue(callable(seen[0]) and seen[0] not in (signal.SIG_DFL, signal.SIG_IGN))
        self.assertFalse(os.path.exists(self.lockdir))

    def test_held_lock_stops_the_run_with_a_clear_message(self):
        fx.take_lock("other", "contract run against http://tv:5400")
        ran = []
        code, f, err = self.run_main(lambda *a: ran.append(1) or 0)
        self.assertEqual(code, 3)
        self.assertEqual(ran, [])
        self.assertIn("in use by another run (contract run against http://tv:5400", err)
        self.assertIn("unlock --force", err)
        self.assertTrue(os.path.isdir(self.lockdir))  # someone else's lock stays


if __name__ == "__main__":
    unittest.main()
