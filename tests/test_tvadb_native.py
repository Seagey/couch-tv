"""Exercise the optional Google adb transport without connecting to a TV."""
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("tvadb", Path(__file__).resolve().parents[1] / "tv-home/tools/tvadb.py")
tvadb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tvadb)


class NativeAdbTest(unittest.TestCase):
    def test_connect_selects_exact_transport_without_python_adb(self):
        env = {"TV_ADB_BINARY": "/tools with spaces/adb", "TV_IP": "192.0.2.1", "ADB_PORT": "37123"}
        with patch.dict(os.environ, env, clear=True), patch.object(tvadb.subprocess, "run") as run:
            run.return_value.stdout = "device\n"
            dev = tvadb.connect()
            self.assertEqual(dev.serial, "192.0.2.1:37123")
            self.assertEqual(run.call_args.args[0], [env["TV_ADB_BINARY"], "-s", dev.serial, "get-state"])
            dev.close()
            self.assertEqual(run.call_count, 1)

    def test_offline_transport_is_rejected(self):
        with patch.dict(os.environ, {"TV_ADB_BINARY": "adb", "TV_IP": "192.0.2.1", "ADB_PORT": "37123"}, clear=True), patch.object(tvadb.NativeAdb, "run", return_value="offline"):
            with self.assertRaises(ConnectionError):
                tvadb.connect()

    def test_ipv6(self):
        for host in ("2001:db8::1", "[2001:db8::1]"):
            with self.subTest(host=host), patch.dict(os.environ, {"TV_ADB_BINARY": "adb", "TV_IP": host, "ADB_PORT": "37123"}, clear=True), patch.object(tvadb.NativeAdb, "run", return_value="device"):
                self.assertEqual(tvadb.connect().serial, "[2001:db8::1]:37123")

    def test_requires_explicit_valid_port(self):
        for port in ("", "abc", "0", "65536"):
            with self.subTest(port=port), patch.dict(os.environ, {"TV_ADB_BINARY": "adb", "TV_IP": "192.0.2.1", "ADB_PORT": port}, clear=True), patch.object(tvadb.subprocess, "run") as run, patch("sys.stderr", new_callable=io.StringIO):
                with self.assertRaises(SystemExit):
                    tvadb.connect()
                run.assert_not_called()

    def test_shell_is_one_argument_and_bounded(self):
        dev = tvadb.NativeAdb("adb", "192.0.2.1:37123")
        command = "printf '%s' '$HOME; `id`'"
        with patch.object(tvadb.subprocess, "run") as run:
            run.return_value.stdout = "result"
            self.assertEqual(dev.shell(command, timeout_s=7), "result")
            self.assertEqual(run.call_args.args[0][-4:], ["shell", "-T", "-x", command])
            self.assertEqual(run.call_args.kwargs["timeout"], 7)
            self.assertNotIn("shell", run.call_args.kwargs)

    def test_push_preserves_bytes_and_cleans_up_on_failure(self):
        dev = tvadb.NativeAdb("adb", "192.0.2.1:37123")
        for failure in (False, True):
            captured = []
            def push(args, timeout):
                captured.append(Path(args[1]))
                self.assertEqual(captured[-1].read_bytes(), b"\x00\xffAPK")
                self.assertEqual(args[2], "/data/local/tmp/part")
                if failure:
                    raise ConnectionError("offline")
            with self.subTest(failure=failure), patch.object(dev, "run", side_effect=push):
                if failure:
                    with self.assertRaises(ConnectionError):
                        dev.push(io.BytesIO(b"\x00\xffAPK"), "/data/local/tmp/part")
                else:
                    dev.push(io.BytesIO(b"\x00\xffAPK"), "/data/local/tmp/part")
                self.assertFalse(captured[0].exists())

    def test_transport_errors_are_retryable(self):
        dev = tvadb.NativeAdb("adb", "192.0.2.1:37123")
        for error in (FileNotFoundError(), subprocess.TimeoutExpired("adb", 5), subprocess.CalledProcessError(1, "adb")):
            with self.subTest(error=type(error).__name__), patch.object(tvadb.subprocess, "run", side_effect=error):
                with self.assertRaises(ConnectionError):
                    dev.run(["get-state"])

    def test_pull_uses_exact_paths(self):
        dev = tvadb.NativeAdb("adb", "192.0.2.1:37123")
        with patch.object(dev, "run") as run:
            dev.pull("/sdcard/shot.png", Path("a screenshot.png"))
            run.assert_called_once_with(["pull", "/sdcard/shot.png", "a screenshot.png"], tvadb.SHELL_TIMEOUT)


if __name__ == "__main__":
    unittest.main()
