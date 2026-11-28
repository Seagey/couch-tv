"""S9 (Opus final check, 28 Nov 2026): mattersrv's install.log is created with mode 600 from the start, not written wide and then changed."""
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())
from couchtv_setup import mattersrv as ms  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402


class LogMode(unittest.TestCase):
    def test_created_private_even_if_the_chmod_never_happens(self):
        log = os.path.join(tempfile.mkdtemp(), "install.log")
        old = os.umask(0)
        try:
            with mock.patch.object(ms.os, "chmod"):
                with self.assertRaises(TvError):
                    ms._fail("npm error something", log)
        finally:
            os.umask(old)
        if os.name != "nt":  # file modes are POSIX only; Windows reports 0o666
            self.assertEqual(oct(os.stat(log).st_mode & 0o777), "0o600")
        self.assertIn("npm error something", open(log, encoding="utf-8").read())


if __name__ == "__main__":
    unittest.main()
