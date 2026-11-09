import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import server


def solar_altitude(lat, lon, dt):
    """Reference Python implementation of the JavaScript formula in app.js."""
    import datetime
    day_of_year = dt.timetuple().tm_yday
    b = math.radians((360 / 365.25) * (day_of_year - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    decl = math.radians(23.45 * math.sin(b))

    utc = dt.astimezone(datetime.timezone.utc)
    utc_hours = utc.hour + utc.minute / 60.0 + utc.second / 3600.0
    solar_time = (utc_hours + lon / 15.0 + eot / 60.0 + 24) % 24
    hour_angle = (solar_time - 12) * 15.0
    h_rad = math.radians(hour_angle)
    lat_rad = math.radians(lat)

    sin_alt = math.sin(lat_rad) * math.sin(decl) + math.cos(lat_rad) * math.cos(decl) * math.cos(h_rad)
    alt = math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))
    return alt, hour_angle


class SunSyncConfigTests(unittest.TestCase):
    def test_home_parses_sun_sync_true(self):
        h = config._home({"sun_sync": True})
        self.assertIs(h.get("sun_sync"), True)

    def test_home_parses_sun_sync_false(self):
        h = config._home({"sun_sync": False})
        self.assertIs(h.get("sun_sync"), False)

    def test_home_ignores_non_bool_sun_sync(self):
        h = config._home({"sun_sync": "yes"})
        self.assertNotIn("sun_sync", h)

    def test_clean_settings_accepts_sun_sync(self):
        cleaned = server.clean_settings({"sun_sync": True})
        self.assertIs(cleaned.get("sun_sync"), True)

        cleaned_false = server.clean_settings({"sun_sync": False})
        self.assertIs(cleaned_false.get("sun_sync"), False)

        cleaned_bad = server.clean_settings({"sun_sync": 123})
        self.assertNotIn("sun_sync", cleaned_bad)


class SunSyncSolarCalculationTests(unittest.TestCase):
    def test_solar_altitude_noon_vs_midnight(self):
        import datetime
        tz = datetime.timezone.utc
        noon = datetime.datetime(2026, 6, 21, 12, 0, tzinfo=tz)
        midnight = datetime.datetime(2026, 6, 21, 0, 0, tzinfo=tz)

        # Greenwich (lat 51.5, lon 0.0) at UTC noon on summer solstice
        alt_noon, _ = solar_altitude(51.5, 0.0, noon)
        self.assertGreater(alt_noon, 50.0)

        # Greenwich at UTC midnight
        alt_midnight, _ = solar_altitude(51.5, 0.0, midnight)
        self.assertLess(alt_midnight, -10.0)


if __name__ == "__main__":
    unittest.main()
