"""N13b (28 Nov 2026): bridge/matter.py can be told where the Matter service is installed (config.json matter.service_dir or
COUCH_MATTER_DIR), and does today's thing when it is not told."""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import matter  # noqa: E402


class ServiceDir(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.svc = tempfile.mkdtemp()

    def test_defaults_are_today(self):
        d, e = matter.service_paths({}, env={})
        self.assertEqual((d, e), (matter.SERVICE_DIR, matter.ENTRY))
        self.assertTrue(matter.ENTRY.endswith(os.path.join("bridge", "matter", "node_modules", "matter-server", "dist", "esm", "bin.js")))
        m = matter.Matter(self.dir, {})
        self.assertEqual((m.service_dir, m.entry), (matter.SERVICE_DIR, matter.ENTRY))

    def test_config_beats_environment_beats_default(self):
        other = tempfile.mkdtemp()
        self.assertEqual(matter.service_paths({"service_dir": self.svc}, env={"COUCH_MATTER_DIR": other})[0], self.svc)
        self.assertEqual(matter.service_paths({}, env={"COUCH_MATTER_DIR": other})[0], other)
        d, e = matter.service_paths({"service_dir": self.svc}, env={})
        self.assertEqual(e, os.path.join(self.svc, "node_modules", "matter-server", "dist", "esm", "bin.js"))
        self.assertEqual(matter.service_paths({"service_dir": self.svc, "entry": "/x/bin.js"}, env={})[1], "/x/bin.js")

    def test_relative_empty_and_odd_values_are_ignored(self):
        for bad in ("relative/dir", "", "  ", None, 5, ["/abs"], {"a": 1}):
            self.assertEqual(matter.service_paths({"service_dir": bad, "entry": bad}, env={"COUCH_MATTER_DIR": "rel"})[0], matter.SERVICE_DIR, repr(bad))

    def test_the_override_is_what_the_service_is_started_and_checked_with(self):
        m = matter.Matter(self.dir, {"service_dir": self.svc, "node": "/usr/bin/node"})
        self.assertEqual(m.why_not()[0], "not_installed")
        entry = os.path.join(self.svc, "node_modules", "matter-server", "dist", "esm", "bin.js")
        os.makedirs(os.path.dirname(entry))
        open(entry, "w").close()
        self.assertNotEqual((m.why_not() or ("",))[0], "not_installed")
        self.assertEqual(m.service_args()[1], entry)

    def test_environment_variable_reaches_the_class(self):
        old = os.environ.get("COUCH_MATTER_DIR")
        os.environ["COUCH_MATTER_DIR"] = self.svc
        try:
            self.assertEqual(matter.Matter(self.dir, {}).service_dir, self.svc)
        finally:
            if old is None:
                del os.environ["COUCH_MATTER_DIR"]
            else:
                os.environ["COUCH_MATTER_DIR"] = old


if __name__ == "__main__":
    unittest.main()
