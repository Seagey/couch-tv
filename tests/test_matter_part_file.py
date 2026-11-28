"""S9 (Opus final check, 28 Nov 2026): bridge/matter.py _leave_for_helper leaves no half written .part file when the write fails
(it held the Matter code)."""
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import matter  # noqa: E402


class PartFile(unittest.TestCase):
    def test_a_failed_write_leaves_nothing_behind(self):
        folder = os.path.join(tempfile.mkdtemp(), "helper-data")
        path = os.path.join(folder, "matter-install-request.json")
        m = matter.Matter(tempfile.mkdtemp(), {"service_dir": "/nonexistent/svc"})
        old = os.environ.get("COUCH_MATTER_REQUEST")
        os.environ["COUCH_MATTER_REQUEST"] = path
        try:
            with mock.patch.object(matter.json, "dump", side_effect=OSError("disk full")):
                self.assertFalse(m._leave_for_helper("06409137006", None))
        finally:
            if old is None:
                os.environ.pop("COUCH_MATTER_REQUEST", None)
            else:
                os.environ["COUCH_MATTER_REQUEST"] = old
        self.assertEqual(os.listdir(folder), [], "no .part file and no request file")


if __name__ == "__main__":
    unittest.main()
