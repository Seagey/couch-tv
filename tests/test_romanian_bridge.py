import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config


class RomanianBridgeTests(unittest.TestCase):
    def test_romanian_is_a_language(self):
        self.assertIn("ro", config.LANGUAGES)

    def test_romanian_country_defaults_to_romania(self):
        self.assertEqual(config._LANGUAGE_COUNTRY["ro"], "RO")
        self.assertEqual(config._COUNTRY_NAMES["RO"], "Romania")

    def test_home_config_keeps_romanian(self):
        self.assertEqual(config._home({"language": "ro"})["language"], "ro")


if __name__ == "__main__":
    unittest.main()
