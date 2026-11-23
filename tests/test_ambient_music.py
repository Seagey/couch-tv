import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config
import server


class TestAmbientMusic(unittest.TestCase):
    def test_config_ambient_music(self):
        """Verify _home properly handles ambient_music configuration."""
        self.assertIs(config._home({"ambient_music": True}).get("ambient_music"), True)
        self.assertIs(config._home({"ambient_music": False}).get("ambient_music"), False)
        # Non-boolean values are ignored
        self.assertNotIn("ambient_music", config._home({"ambient_music": "yes"}))
        self.assertNotIn("ambient_music", config._home({}))

    def test_sessions_parses_duration_and_extrapolates_position(self):
        """Verify _sessions extracts position and duration and interpolates playing position."""
        raw_playing = (
            "100.0 50.0\n"  # 100 seconds uptime
            "package=com.spotify.tv.android\n"
            "active=true\n"
            "state=PlaybackState {state=PLAYING(3), position=20000, buffered position=0, speed=1.0, updated=95000, actions=0}\n"
            "metadata: size=4, description=Song Name, Artist Name, Album Name, duration=180000\n"
        )
        sessions = server._sessions(raw_playing)
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["package"], "com.spotify.tv.android")
        self.assertEqual(s["title"], "Song Name")
        self.assertEqual(s["subtitle"], "Artist Name")
        self.assertEqual(s["album"], "Album Name")
        self.assertEqual(s["duration"], 180000)
        self.assertEqual(s["dur_s"], 180.0)
        # 100000 ms uptime - 95000 ms updated = 5000 ms delta * 1.0 speed + 20000 ms = 25000 ms = 25.0s
        self.assertEqual(s["pos_s"], 25.0)

    def test_sessions_paused_does_not_advance_position(self):
        """Verify paused state does not extrapolate position into the future."""
        raw_paused = (
            "100.0 50.0\n"
            "package=com.spotify.tv.android\n"
            "active=true\n"
            "state=PlaybackState {state=PAUSED(2), position=20000, buffered position=0, speed=0.0, updated=80000, actions=0}\n"
            "metadata: size=3, description=Song Name, Artist Name, Album Name\n"
            "android.media.metadata.DURATION=240000\n"
        )
        sessions = server._sessions(raw_paused)
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["pos_s"], 20.0)  # Remains at 20.0s, does not add 20s delta
        self.assertEqual(s["dur_s"], 240.0)

    def test_sessions_missing_duration_and_negative_position(self):
        """Verify graceful handling when duration is omitted and position is negative or unset."""
        raw_unknown = (
            "package=com.unknown.player\n"
            "active=true\n"
            "state=PlaybackState {state=PLAYING(3), position=-1, buffered position=0, speed=1.0, updated=0, actions=0}\n"
            "metadata: size=1, description=Radio Live Stream, null, null\n"
        )
        sessions = server._sessions(raw_unknown)
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertNotIn("pos_s", s)
        self.assertNotIn("dur_s", s)
        self.assertEqual(s["title"], "Radio Live Stream")


    def test_ambient_music_web_templates_and_i18n(self):
        """Verify web HTML templates and i18n dictionaries include equalizer wave and open app button."""
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tv-home", "web")
        with open(os.path.join(base, "index.html"), "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn('class="ambient-wave"', html)
        self.assertIn('id="amb-open"', html)

        with open(os.path.join(base, "i18n.js"), "r", encoding="utf-8") as f:
            i18n = f.read()
        self.assertIn("ambient_open_app", i18n)
        self.assertIn("np_expand", i18n)


if __name__ == "__main__":
    unittest.main()
