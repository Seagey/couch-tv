"""The sums behind `sync.py calibrate` and the saved delays file. No TV needed."""
import importlib.util
import json
import os
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location("tvsync", os.path.join(os.path.dirname(__file__), "..", "sync", "sync.py"))
tvsync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tvsync)


class GapMaths(unittest.TestCase):
    def test_median_of_good_readings(self):
        kept, med = tvsync.summarise_gaps([60, 72, 65, 80, 55, 68])
        self.assertEqual(len(kept), 6)
        self.assertEqual(med, 66.5)

    def test_a_stall_and_a_missing_reading_are_thrown_away(self):
        kept, med = tvsync.summarise_gaps([60, 2169, None, 70, 64])
        self.assertEqual(kept, [60, 70, 64])
        self.assertEqual(med, 64)

    def test_nothing_usable(self):
        self.assertEqual(tvsync.summarise_gaps([None, 5000]), ([], None))

    def test_first_tv_ahead_delays_the_first(self):
        self.assertEqual(tvsync.delays_from_gap("living-room", "bedroom", 68.0), {"living-room": 68.0, "bedroom": 0.0})

    def test_first_tv_behind_delays_the_second(self):
        self.assertEqual(tvsync.delays_from_gap("living-room", "bedroom", -40.0), {"living-room": 0.0, "bedroom": 40.0})


class DelaysFile(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "sync-delays.json")

    def tearDown(self):
        self.dir.cleanup()

    def test_lives_next_to_config(self):
        self.assertEqual(tvsync.delays_path(os.path.join(self.dir.name, "config.json")), self.path)

    def test_missing_file_is_empty(self):
        self.assertEqual(tvsync.load_delays(self.path, "com.example.app"), {})

    def test_round_trip_keyed_by_package_and_tv(self):
        tvsync.save_delays(self.path, "com.example.app", {"a": 67.6, "b": 0.0})
        self.assertEqual(tvsync.load_delays(self.path, "com.example.app"), {"a": 68.0, "b": 0.0})
        self.assertEqual(tvsync.load_delays(self.path, "com.other.app"), {})
        with open(self.path) as f:
            self.assertEqual(json.load(f), {"com.example.app": {"a": 68, "b": 0}})

    def test_saving_one_app_keeps_the_others(self):
        tvsync.save_delays(self.path, "com.one", {"a": 10.0, "b": 0.0})
        tvsync.save_delays(self.path, "com.two", {"a": 0.0, "b": 30.0})
        tvsync.save_delays(self.path, "com.one", {"a": 20.0, "b": 0.0})
        self.assertEqual(tvsync.load_delays(self.path, "com.one"), {"a": 20.0, "b": 0.0})
        self.assertEqual(tvsync.load_delays(self.path, "com.two"), {"a": 0.0, "b": 30.0})

    def test_a_broken_file_reads_as_empty_and_is_replaced_on_save(self):
        with open(self.path, "w") as f:
            f.write("{not json")
        self.assertEqual(tvsync.load_delays(self.path, "com.one"), {})
        tvsync.save_delays(self.path, "com.one", {"a": 5.0})
        self.assertEqual(tvsync.load_delays(self.path, "com.one"), {"a": 5.0})


class ChoosingDelays(unittest.TestCase):
    def test_saved_delays_are_used(self):
        self.assertEqual(tvsync.choose_delays({"a": 60.0, "b": 0.0, "c": 9.0}, {}, ["a", "b"]), {"a": 60.0, "b": 0.0})

    def test_explicit_delay_wins_even_when_zero(self):
        self.assertEqual(tvsync.choose_delays({"a": 60.0}, {"a": 0.0}, ["a", "b"]), {"a": 0.0})

    def test_nothing_saved(self):
        self.assertEqual(tvsync.choose_delays({}, {}, ["a", "b"]), {})


if __name__ == "__main__":
    unittest.main()
