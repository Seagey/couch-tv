import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config


class PolishBridgeTests(unittest.TestCase):
    def test_polish_is_a_language(self):
        self.assertIn("pl", config.LANGUAGES)

    def test_polish_country_defaults_to_poland(self):
        self.assertEqual(config._LANGUAGE_COUNTRY["pl"], "PL")
        self.assertEqual(config._COUNTRY_NAMES["PL"], "Poland")

    def test_home_config_keeps_polish(self):
        self.assertEqual(config._home({"language": "pl"})["language"], "pl")


if __name__ == "__main__":
    unittest.main()
