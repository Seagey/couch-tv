"""tv-home/tools/bench-tv.py: the parts that read what the TV prints, checked with real output
(an XGIMI Elfin Flip Plus, Android 11) and a few made-up cases."""
import importlib.util
from pathlib import Path
import unittest

TOOL = Path(__file__).parents[1] / "tv-home" / "tools" / "bench-tv.py"
spec = importlib.util.spec_from_file_location("bench_tv", TOOL)
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

MEMINFO = """
 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:     5560                          15656
         Native Heap:     7732                           8816
                Code:    11252                          75904
               Stack:      624                            644
            Graphics:    83996                          83996
       Private Other:     7900
              System:    41379
           TOTAL PSS:   158443            TOTAL RSS:   194272       TOTAL SWAP PSS:    26286

 Objects
               Views:       12         ViewRootImpl:        2
         AppContexts:       13           Activities:        2
            WebViews:        2
"""

PROC = """MemTotal:        1733576 kB
MemFree:           59496 kB
MemAvailable:     596164 kB
SwapTotal:        511996 kB
SwapFree:         199880 kB
"""


class Parsing(unittest.TestCase):
    def test_process_meminfo(self):
        m = bench.process_meminfo(MEMINFO)
        self.assertEqual(m["pss_mb"], round(158443 / 1024, 1))
        self.assertEqual(m["graphics_mb"], round(83996 / 1024, 1))
        self.assertEqual(m["java_heap_mb"], round(5560 / 1024, 1))
        self.assertEqual((m["activities"], m["webviews"]), (2, 2))

    def test_process_meminfo_of_nothing(self):
        self.assertEqual(bench.process_meminfo("No process found for: x")["pss_mb"], None)

    def test_proc_meminfo(self):
        self.assertEqual(bench.proc_meminfo(PROC), {"ram_mb": 1693, "available_mb": 582, "swap_used_mb": 305})
        self.assertEqual(bench.proc_meminfo("")["ram_mb"], None)

    def test_webview_and_gpu(self):
        self.assertEqual(bench.webview_version("Current WebView package (name, version): (com.google.android.webview, 157.0.7)"), "157.0.7")
        self.assertIsNone(bench.webview_version("nothing"))
        self.assertEqual(bench.gles("GLES: ARM, Mali-G52 MC2, OpenGL ES 3.2 v1.r32p1"), "ARM, Mali-G52 MC2")

    def test_home_layer_picks_the_activity_window(self):
        listing = "Display 0\nSurface(name=x)/@0x1 - animation-leash\napp.couchtv.launcher/app.couchtv.launcher.MainActivity#0\nStatusBar#0\n"
        self.assertEqual(bench.home_layer(listing), "app.couchtv.launcher/app.couchtv.launcher.MainActivity#0")
        self.assertIsNone(bench.home_layer("StatusBar#0\n"))

    def test_sandboxed_pids(self):
        ps = "  1313 webview_zygote\n28541 com.google.android.webview:sandboxed_process0:org.chromium.content.app.Sand\n28467 app.couchtv.launcher\n"
        self.assertEqual(bench.sandboxed_pids(ps), [28541])

    def test_cold_start(self):
        self.assertEqual(bench.am_start_total_ms("Status: ok\nTotalTime: 2281\nWaitTime: 2311\n"), 2281)
        self.assertIsNone(bench.am_start_total_ms("Error"))

    def test_watch_bound(self):
        self.assertTrue(bench.watch_bound("     Bound services:{Service[label=Home gear button, feedbackType[FEEDBACK_GENERIC]"))
        self.assertFalse(bench.watch_bound("     Bound services:{}"))
        self.assertFalse(bench.watch_bound(""))


class Frames(unittest.TestCase):
    def latency(self, gaps_ms):
        rows, t = [], 1_000_000_000
        for g in [0] + gaps_ms:
            t += int(g * 1e6)
            rows.append("0 %d %d" % (t, t))
        rows.append("9223372036854775807 9223372036854775807 9223372036854775807")   # unused row
        return "16666666\n" + "\n".join(rows)

    def test_sixty_frames_a_second(self):
        s = bench.frame_stats(bench.frame_gaps_ms(self.latency([16.7] * 60)))
        self.assertEqual((s["fps"], s["median_ms"], s["slow_frames"]), (60, 16.7, 0))

    def test_thirty_frames_a_second_and_a_pause_is_ignored(self):
        s = bench.frame_stats(bench.frame_gaps_ms(self.latency([33.3] * 40 + [900] + [33.3] * 10)))
        self.assertEqual((s["fps"], s["slow_frames"]), (30, 0))
        self.assertEqual(s["frames"], 51)   # 50 gaps under 0.4 s: the pause is not one of them

    def test_slow_frames_are_counted(self):
        s = bench.frame_stats(bench.frame_gaps_ms(self.latency([16.7] * 20 + [50] * 3)))
        self.assertEqual(s["slow_frames"], 3)

    def test_too_few_frames(self):
        self.assertIsNone(bench.frame_stats(bench.frame_gaps_ms(self.latency([16.7, 16.7]))))
        self.assertIsNone(bench.frame_stats([]))


class Report(unittest.TestCase):
    def test_table_has_no_address_and_says_what_it_measured(self):
        r = {"tv": {"maker": "XGIMI", "model": "WK03C", "android": "11", "sdk": "30", "chip": "mt", "gpu": "ARM, Mali-G52 MC2",
                    "ram_mb": 1693, "available_mb": 582, "swap_used_mb": 305, "screen": "1920x1080", "density": 240,
                    "webview": "157.0.7", "couchtv": "0.13.8"},
             "memory": {"home": bench.process_meminfo(MEMINFO), "renderer_pss_mb": 64.3, "renderer_count": 1},
             "frames": {"frames": 100, "median_ms": 16.7, "p90_ms": 17.0, "fps": 60, "slow_frames": 0}, "cold_start_ms": 2281}
        out = bench.table(r, {"look": "night", "lighter": "yes", "render_height": "720"})
        for want in ("XGIMI WK03C", "Mali-G52", "157.0.7 / 0.13.8", "render_height 720", "about 60 fps", "2281 ms"):
            self.assertIn(want, out)
        self.assertNotIn("192.168", out)


if __name__ == "__main__":
    unittest.main()
