"""scripts/make-loop.sh, the Loop look's footage pipeline, checked through its dry run.

ffmpeg is not needed here: --dry-run prints every command and writes nothing, so the tests parse the
printed commands with shlex (the script prints them as a shell would take them) and check the
encode, the seam arithmetic, the grades and the file names (docs/LOOP.md).
"""
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "make-loop.sh")
CLIP = "/nowhere/at all/lake.mp4"


def run(*args, out=None):
    out = out or os.path.join(tempfile.gettempdir(), "make-loop-never-written")
    p = subprocess.run(["bash", SCRIPT, *args, "--out", out], capture_output=True, text=True)
    cmds = [shlex.split(l) for l in p.stdout.splitlines() if l.startswith("ffmpeg ")]
    return p, cmds, out


def arg_after(cmd, flag):
    return cmd[cmd.index(flag) + 1]


class DryRun(unittest.TestCase):
    def test_prints_four_commands_per_variant_in_order_and_writes_nothing(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = os.path.join(tmp, "loop")
        p, cmds, _ = run(CLIP, "--dry-run", out=out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(out), "a dry run must not even make the folder")
        self.assertEqual(len(cmds), 16)
        outputs = [c[-1] for c in cmds]
        self.assertEqual([os.path.basename(o) for o in outputs],
                         [n for v in ("dawn", "day", "dusk", "night")
                          for n in (v + ".mp4", v + "-blur.mp4", v + ".jpg", v + "-blur.jpg")])
        self.assertTrue(all(o.startswith(out + os.sep) for o in outputs))
        self.assertIn("nothing is written", p.stdout)

    def test_sharp_encode_is_the_spec(self):
        _, cmds, out = run(CLIP, "--dry-run")
        sharp = cmds[0]
        self.assertEqual(arg_after(sharp, "-i"), CLIP)   # a path with spaces survives the quoting
        for flag, want in (("-c:v", "libx264"), ("-profile:v", "main"), ("-level", "4.0"),
                           ("-pix_fmt", "yuv420p"), ("-preset", "slow"), ("-crf", "20"),
                           ("-maxrate", "4M"), ("-bufsize", "8M"), ("-r", "30"), ("-g", "30"),
                           ("-keyint_min", "30"), ("-sc_threshold", "0"), ("-movflags", "+faststart"),
                           ("-map", "[out]")):
            self.assertEqual(arg_after(sharp, flag), want, flag)
        self.assertIn("-an", sharp)
        graph = arg_after(sharp, "-filter_complex")
        self.assertIn("fps=30,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p", graph)
        self.assertEqual(sharp[-1], os.path.join(out, "dawn.mp4"))

    def test_seam_arithmetic_for_the_default_length(self):
        # L = 30: base 31 s, body from 1 s for 30 s, head 1 s, dissolve at offset 29 for 1 s
        _, cmds, _ = run(CLIP, "--dry-run")
        graph = arg_after(cmds[0], "-filter_complex")
        self.assertIn("trim=duration=31,setpts=PTS-STARTPTS,split=2[c0][c1]", graph)
        self.assertIn("[c0]trim=start=1:duration=30,setpts=PTS-STARTPTS,fps=30[body]", graph)
        self.assertIn("[c1]trim=duration=1,setpts=PTS-STARTPTS,fps=30[head]", graph)
        self.assertIn("[body][head]xfade=transition=fade:duration=1:offset=29[out]", graph)

    def test_seam_arithmetic_follows_seconds(self):
        for secs, base, offset in ((15, 16, 14), (45, 46, 44), (60, 61, 59)):
            _, cmds, _ = run(CLIP, "--dry-run", "--seconds", str(secs), "--only", "day")
            graph = arg_after(cmds[0], "-filter_complex")
            self.assertIn("trim=duration=%d," % base, graph)
            self.assertIn("[c0]trim=start=1:duration=%d," % secs, graph)
            self.assertIn("xfade=transition=fade:duration=1:offset=%d[out]" % offset, graph)

    def test_slow_factor_goes_into_setpts(self):
        _, cmds, _ = run(CLIP, "--dry-run", "--only", "day")
        self.assertIn("[0:v]setpts=1*PTS,fps=30,", arg_after(cmds[0], "-filter_complex"))
        _, cmds, _ = run(CLIP, "--dry-run", "--only", "day", "--slow", "2")
        self.assertIn("[0:v]setpts=2*PTS,fps=30,", arg_after(cmds[0], "-filter_complex"))
        _, cmds, _ = run(CLIP, "--dry-run", "--only", "day", "--slow", "2.5")
        self.assertIn("[0:v]setpts=2.5*PTS,fps=30,", arg_after(cmds[0], "-filter_complex"))

    def test_the_four_grades(self):
        _, cmds, _ = run(CLIP, "--dry-run")
        graphs = {c[-1].rsplit("/", 1)[1][:-4]: arg_after(c, "-filter_complex") for c in cmds if c[-1].endswith(".mp4") and "-filter_complex" in c}
        self.assertEqual(set(graphs), {"dawn", "day", "dusk", "night"})
        self.assertIn("format=yuv420p,null,trim=", graphs["day"])   # the source, no grade
        self.assertIn("format=yuv420p,colorbalance=rh=0.12:bh=-0.08:bs=0.06,trim=", graphs["dawn"])
        self.assertIn("format=yuv420p,colorbalance=rm=0.14:bm=-0.10,eq=brightness=-0.05,trim=", graphs["dusk"])
        # the curves points keep their quotes through the printed shell line
        self.assertIn("format=yuv420p,curves=master='0/0 0.5/0.36 1/0.82',eq=saturation=0.55,colorbalance=bs=0.16,trim=", graphs["night"])
        for g in graphs.values():
            self.assertNotIn("colorbalance", g.split("[c0]")[1])   # the grade is applied once, before the split

    def test_blur_copy_is_cut_from_the_finished_sharp_file(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "dusk")
        sharp, blur, poster, blur_poster = cmds
        self.assertEqual(arg_after(blur, "-i"), os.path.join(out, "dusk.mp4"))
        self.assertEqual(arg_after(blur, "-vf"), "scale=160:90,gblur=sigma=2,fps=10")
        for flag, want in (("-crf", "26"), ("-maxrate", "300k"), ("-bufsize", "600k"), ("-r", "10"),
                           ("-g", "10"), ("-pix_fmt", "yuv420p"), ("-profile:v", "main"), ("-level", "4.0"),
                           ("-movflags", "+faststart")):
            self.assertEqual(arg_after(blur, flag), want, flag)
        self.assertIn("-an", blur)
        self.assertEqual(blur[-1], os.path.join(out, "dusk-blur.mp4"))

    def test_posters_are_the_first_frame_at_960x540(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "night")
        sharp, blur, poster, blur_poster = cmds
        self.assertEqual(arg_after(poster, "-i"), os.path.join(out, "night.mp4"))
        self.assertEqual(arg_after(poster, "-frames:v"), "1")
        self.assertTrue(arg_after(poster, "-vf").startswith("scale=960:540"))
        self.assertEqual(poster[-1], os.path.join(out, "night.jpg"))
        self.assertEqual(arg_after(blur_poster, "-i"), os.path.join(out, "night-blur.mp4"))
        self.assertEqual(arg_after(blur_poster, "-frames:v"), "1")
        self.assertTrue(arg_after(blur_poster, "-vf").startswith("scale=960:540"))
        self.assertEqual(blur_poster[-1], os.path.join(out, "night-blur.jpg"))

    def test_only_makes_one_variant(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "night")
        self.assertEqual([os.path.basename(c[-1]) for c in cmds],
                         ["night.mp4", "night-blur.mp4", "night.jpg", "night-blur.jpg"])

    def test_bad_arguments_stop_before_anything_prints(self):
        for args in ((CLIP, "--dry-run", "--seconds", "14"), (CLIP, "--dry-run", "--seconds", "61"),
                     (CLIP, "--dry-run", "--seconds", "abc"), (CLIP, "--dry-run", "--only", "noon"),
                     (CLIP, "--dry-run", "--slow", "fast"), (CLIP, "--dry-run", "--slow", "0"),
                     (CLIP, "--dry-run", "--slow", "0.0"), ("--dry-run",), (CLIP, "--dry-run", "--bogus")):
            p, cmds, _ = run(*args)
            self.assertNotEqual(p.returncode, 0, args)
            self.assertEqual(cmds, [], args)

    def test_a_real_run_refuses_a_missing_clip_or_no_ffmpeg(self):
        # without --dry-run, nothing may be made from a clip that is not there (and the folder is not
        # made before that check)
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = os.path.join(tmp, "loop")
        p, cmds, _ = run(CLIP, out=out)
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(cmds, [])
        self.assertFalse(os.path.exists(out))

    def test_header_says_where_footage_may_come_from(self):
        with open(SCRIPT, encoding="utf-8") as f:
            head = f.read().split("set -eu")[0]
        self.assertIn("Pexels", head)
        self.assertIn("Pixabay", head)
        self.assertIn("Apple", head)
        self.assertIn("xfade", head)


if __name__ == "__main__":
    unittest.main()
