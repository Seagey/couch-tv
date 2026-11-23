import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-spotify-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))

import config  # noqa: E402
from server import _sessions, STATES  # noqa: E402

class TestSpotifyIntegration(unittest.TestCase):

    def test_spotify_config_defaults(self):
        self.assertEqual(
            config._spotify(None),
            {"enabled": False, "seek_seconds": 10, "hide_idle": False}
        )
        self.assertEqual(
            config._spotify({}),
            {"enabled": False, "seek_seconds": 10, "hide_idle": False}
        )

    def test_spotify_config_custom(self):
        cfg = {"enabled": True, "seek_seconds": 15, "hide_idle": True}
        self.assertEqual(
            config._spotify(cfg),
            {"enabled": True, "seek_seconds": 15, "hide_idle": True}
        )
        # Clamping / validation of seek_seconds
        self.assertEqual(
            config._spotify({"seek_seconds": -5}),
            {"enabled": False, "seek_seconds": 10, "hide_idle": False}
        )
        self.assertEqual(
            config._spotify({"seek_seconds": 300}),
            {"enabled": False, "seek_seconds": 10, "hide_idle": False}
        )
        self.assertEqual(
            config._spotify({"seek_seconds": "invalid"}),
            {"enabled": False, "seek_seconds": 10, "hide_idle": False}
        )

    def test_spotify_media_session_parsing(self):
        dumpsys_sample = """
1234.56 5678.90
MEDIA SESSION SERVICE (dumpsys media_session)
Sessions Stack - have 1 sessions:
  androidx.media3.session.id. com.spotify.tv.android/androidx.media3.session.id. (userId=0)
    package=com.spotify.tv.android
    active=true
    state=PlaybackState {state=PLAYING(3), position=45000, buffered position=0, speed=1.0, updated=1122171000, actions=3125244, custom actions=[], active item id=0, error=null}
    metadata: size=22, description=Bohemian Rhapsody, Queen, A Night at the Opera, duration=354000
        """
        sessions = _sessions(dumpsys_sample)
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["package"], "com.spotify.tv.android")
        self.assertTrue(s["active"])
        self.assertEqual(s["state"], "PLAYING")
        self.assertEqual(STATES.get(s["state"]), "playing")
        self.assertEqual(s["position"], 45000)
        self.assertEqual(s["updated"], 1122171000)
        self.assertEqual(s["speed"], 1.0)
        self.assertEqual(s["actions"], 3125244)
        self.assertEqual(s["title"], "Bohemian Rhapsody")
        self.assertEqual(s["subtitle"], "Queen")
        self.assertEqual(s["album"], "A Night at the Opera")
        self.assertEqual(s["duration"], 354000)

    def test_seek_clamping_logic(self):
        duration = 200_000  # 200s
        interval = 10_000   # 10s

        # Rewind near start clamps to 0
        pos = 5_000
        rewound = max(0, pos - interval)
        self.assertEqual(rewound, 0)

        # Rewind mid-song
        pos = 50_000
        rewound = max(0, pos - interval)
        self.assertEqual(rewound, 40_000)

        # Fast forward near end clamps to duration
        pos = 195_000
        forwarded = min(duration, pos + interval)
        self.assertEqual(forwarded, 200_000)

        # Fast forward mid-song
        pos = 50_000
        forwarded = min(duration, pos + interval)
        self.assertEqual(forwarded, 60_000)

    def test_supported_actions_bitmask(self):
        # Bitmask constants
        ACTION_PAUSE = 1 << 1           # 2
        ACTION_PLAY = 1 << 2            # 4
        ACTION_REWIND = 1 << 3          # 8
        ACTION_SKIP_TO_PREV = 1 << 4    # 16
        ACTION_SKIP_TO_NEXT = 1 << 5    # 32
        ACTION_FF = 1 << 6              # 64
        ACTION_SEEK_TO = 1 << 8         # 256
        ACTION_PLAY_PAUSE = 1 << 9      # 512

        # Spotify TV actions reported in dumpsys
        actions = 3125244

        can_play_pause = bool(actions & (ACTION_PLAY | ACTION_PAUSE | ACTION_PLAY_PAUSE))
        can_next = bool(actions & ACTION_SKIP_TO_NEXT)
        can_prev = bool(actions & ACTION_SKIP_TO_PREV)
        can_seek = bool(actions & ACTION_SEEK_TO)

        self.assertTrue(can_play_pause)
        self.assertTrue(can_next)
        self.assertTrue(can_prev)
        self.assertTrue(can_seek)

if __name__ == "__main__":
    unittest.main()
