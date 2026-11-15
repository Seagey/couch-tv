import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config


class ArabicBridgeTests(unittest.TestCase):
    def test_arabic_is_a_language(self):
        self.assertIn("ar", config.LANGUAGES)

    def test_arabic_country_defaults_to_saudi_arabia(self):
        self.assertEqual(config._LANGUAGE_COUNTRY["ar"], "SA")
        self.assertEqual(config._COUNTRY_NAMES["SA"], "Saudi Arabia")

    def test_home_config_keeps_arabic(self):
        self.assertEqual(config._home({"language": "ar"})["language"], "ar")


if __name__ == "__main__":
    unittest.main()
