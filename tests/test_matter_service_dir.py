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


class LeftForHelper(unittest.TestCase):
    """N13b: a code typed before Matter is installed is left for the Helper (mode 600, one file), only when the bridge has a Helper."""

    def ask(self, reason, env):
        import asyncio
        m = matter.Matter(tempfile.mkdtemp(), {"service_dir": "/nonexistent/svc"})
        m.reason = reason
        m.ready = False
        old = os.environ.get("COUCH_MATTER_REQUEST")
        os.environ.pop("COUCH_MATTER_REQUEST", None)
        os.environ.update(env)
        try:
            return asyncio.run(m.commission("0640-913-7006"))
        finally:
            os.environ.pop("COUCH_MATTER_REQUEST", None)
            if old is not None:
                os.environ["COUCH_MATTER_REQUEST"] = old

    def test_the_code_is_left_in_a_private_file_and_the_words_say_so(self):
        path = os.path.join(tempfile.mkdtemp(), "helper-data", "matter-install-request.json")
        r = self.ask("not_installed", {"COUCH_MATTER_REQUEST": path})
        self.assertEqual((r["ok"], r["reason"]), (False, "starting"))
        self.assertIn("Getting Matter ready, about 2 minutes, one time only", r["note"])
        self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o600")
        import json
        got = json.load(open(path))
        self.assertEqual((got["code"], got["address"]), ("06409137006", None))
        self.assertEqual(os.listdir(os.path.dirname(path)), ["matter-install-request.json"], "no part file left")

    def test_without_a_helper_nothing_is_written_and_the_old_words_stay(self):
        r = self.ask("not_installed", {})
        self.assertEqual(r["reason"], "not_installed")
        self.assertNotIn("Getting Matter ready", r.get("note") or "")

    def test_other_reasons_never_leave_a_code(self):
        path = os.path.join(tempfile.mkdtemp(), "req.json")
        for reason in ("node_missing", "node_old", "off", "starting"):
            r = self.ask(reason, {"COUCH_MATTER_REQUEST": path})
            self.assertEqual(r["reason"], reason)
        self.assertFalse(os.path.exists(path))

    def test_a_relative_request_path_is_ignored(self):
        r = self.ask("not_installed", {"COUCH_MATTER_REQUEST": "rel/req.json"})
        self.assertEqual(r["reason"], "not_installed")
        self.assertFalse(os.path.exists("rel/req.json"))


if __name__ == "__main__":
    unittest.main()
