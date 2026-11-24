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
        expected = {
            "enabled": False,
            "seek_seconds": 10,
            "hide_idle": False,
            "title_mode": "pingpong",
            "show_app": True,
            "align": "classic",
            "mini_align": "classic",
            "mini_art": "wide",
            "scrub_bar": True,
            "show_shuffle_repeat": True,
            "adaptive_tint": True,
            "waveform": True,
            "card_style": "compact",
            "show_up_next": True,
            "show_jump_app": True,
            "show_sleep_timer": True,
            "show_audio_output": True,
            "separate_row": True,
            "sync_theme_colors": False,
        }
        self.assertEqual(config._spotify(None), expected)
        self.assertEqual(config._spotify({}), expected)

    def test_spotify_config_custom(self):
        cfg = {
            "enabled": True,
            "seek_seconds": 15,
            "hide_idle": True,
            "title_mode": "continuous",
            "show_app": False,
            "align": "dock_center",
            "mini_align": "right",
            "mini_art": "square",
            "scrub_bar": False,
            "show_shuffle_repeat": False,
            "adaptive_tint": False,
            "waveform": False,
            "card_style": "mini",
            "show_up_next": False,
            "show_jump_app": False,
            "show_sleep_timer": False,
            "show_audio_output": False,
            "separate_row": False,
            "sync_theme_colors": True,
        }
        self.assertEqual(config._spotify(cfg), cfg)
        # Clamping / validation of seek_seconds, title_mode, align, mini_align, mini_art, and card_style
        self.assertEqual(
            config._spotify({"seek_seconds": -5, "title_mode": "invalid", "align": "weird", "mini_align": "center", "mini_art": "circle", "card_style": "huge"}),
            config._spotify({})
        )
        dots_expected = dict(config._spotify({}))
        dots_expected["title_mode"] = "dots"
        self.assertEqual(
            config._spotify({"seek_seconds": 300, "title_mode": "dots", "show_app": True, "align": "classic"}),
            dots_expected
        )
        self.assertEqual(
            config._spotify({"seek_seconds": "invalid"}),
            config._spotify({})
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

    def test_bridge_keeps_home_settings_spotify(self):
        # Home settings, Spotify is saved through /api/settings: the bridge keeps the known keys, so the
        # home's settings sync does not drop them and restart the home with the card off again
        import server
        s = {"enabled": True, "show_card": False, "controls": True, "show_app": False, "hide_idle": True,
             "seek_seconds": 15, "title_mode": "dots", "align": "center"}
        self.assertEqual(server.clean_settings({"spotify": dict(s)})["spotify"], s)
        out = server.clean_settings({"spotify": {"enabled": "yes", "seek_seconds": 7, "title_mode": "x",
                                                 "align": "right", "evil": "<b>", "controls": False}})
        self.assertEqual(out["spotify"], {"controls": False})
        self.assertNotIn("spotify", server.clean_settings({"spotify": "on"}))
        self.assertNotIn("spotify", server.clean_settings({"spotify": {"seek_seconds": True}}))
        mock = (Path(__file__).parents[1] / "tv-home" / "web" / "mock.js").read_text(encoding="utf-8")
        self.assertIn('"spotify"', mock.split("var BRIDGE_KEYS = [", 1)[1].split("]", 1)[0])

    def test_skip_step_one_rule(self):
        # 0.13.12: config.json, Home settings and the home all take only 5, 10, 15 or 30 (config.SPOTIFY_SEEK_STEPS)
        import server
        self.assertEqual(config.SPOTIFY_SEEK_STEPS, (5, 10, 15, 30))
        for v in (5, 10, 15, 30):
            self.assertEqual(config._spotify({"seek_seconds": v})["seek_seconds"], v)
            self.assertEqual(server.clean_settings({"spotify": {"seek_seconds": v}})["spotify"], {"seek_seconds": v})
        for v in (1, 7, 20, 60, 120, 15.0, True, None, "15"):
            self.assertEqual(config._spotify({"seek_seconds": v})["seek_seconds"], 10, v)
            self.assertNotIn("spotify", server.clean_settings({"spotify": {"seek_seconds": v}}), v)
        app = (Path(__file__).parents[1] / "tv-home" / "web" / "app.js").read_text(encoding="utf-8")
        self.assertIn("[5, 10, 15, 30].indexOf(spRaw.seek_seconds)", app)
        self.assertIn("var choices = [5, 10, 15, 30];", app)

    def test_control_action_not_text_is_400(self):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from aiohttp.test_utils import make_mocked_request
        import server

        async def run():
            mock_tv = MagicMock()
            mock_tv.connected = True
            mock_tv.is_on = True
            mock_tv.adb_ready = AsyncMock(return_value=True)
            mock_tv.adb = AsyncMock(return_value="")
            out = []

            async def status(data):
                with patch("server.body", AsyncMock(return_value=data)):
                    try:
                        return (await server.h_spotify_control(make_mocked_request("POST", "/api/spotify/control"))).status
                    except server.ApiError as e:   # the error middleware turns it into this status
                        return e.status
            with patch.object(server, "tv", mock_tv):
                for action in (5, ["play"], {"a": 1}, True):
                    out.append(await status({"action": action}))
                out.append(await status({}))
                out.append(await status({"action": "dance"}))
                out.append(await status({"action": "Play"}))
                mock_tv.adb_ready = AsyncMock(return_value=False)
                out.append(await status({"action": "next"}))
            mock_tv.adb.assert_awaited_once_with("shell", "cmd", "media_session", "dispatch", "play", timeout=5)
            return out

        self.assertEqual(asyncio.run(run()), [400, 400, 400, 400, 400, 400, 200, 503])


if __name__ == "__main__":
    unittest.main()
