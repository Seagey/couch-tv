"""scripts/make-loop.sh, the Loop look's footage pipeline, checked through its dry run.

ffmpeg is not needed here: --dry-run prints every command and writes nothing, so the tests parse the
printed commands with shlex (the script prints them as a shell would take them) and check the
encode, the seam arithmetic, the grades and the file names (docs/LOOP.md).
"""
import os
import re
import shlex
import signal
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "make-loop.sh")
CLIP = "/nowhere/at all/lake.mp4"
T = ",scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,trim="
# a photo, and its matte, scaled to cover and cut to the centre 16:9 band (the whole picture when it is
# 16:9 already): the photo at four times the output size, the matte at the output size
PHOTO_169 = "scale=5120:2880:force_original_aspect_ratio=increase,format=yuv444p,crop=5120:2880,"
MATTE_169 = "scale=1280:720:force_original_aspect_ratio=increase:flags=area,format=yuva444p,crop=1280:720,"


def run(*args, out=None):
    out = out or os.path.join(tempfile.gettempdir(), "make-loop-never-written")
    p = subprocess.run(["bash", SCRIPT, *args, "--out", out], capture_output=True, text=True)
    cmds = [shlex.split(l) for l in p.stdout.splitlines() if l.startswith("ffmpeg ")]
    return p, cmds, out


def arg_after(cmd, flag):
    return cmd[cmd.index(flag) + 1]


STAGED = re.compile(r"^(.*)/\.staging-[0-9]+/\.([^/]+)$")


def final(path):
    """Where a file made in the run's staging folder (<out>/.staging-<pid>/.<name>) ends up: <out>/<name>.
    Every ffmpeg output is made there and moved into place only when all of them have worked."""
    m = STAGED.match(path)
    assert m, "not in the staging folder: " + path
    return m.group(1) + "/" + m.group(2)


class DryRun(unittest.TestCase):
    def test_prints_four_commands_per_variant_in_order_and_writes_nothing(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = os.path.join(tmp, "loop")
        p, cmds, _ = run(CLIP, "--dry-run", out=out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(out), "a dry run must not even make the folder")
        self.assertEqual(len(cmds), 16)
        outputs = [final(c[-1]) for c in cmds]
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
        self.assertIn("fps=30,scale=1280:720:force_original_aspect_ratio=increase:out_color_matrix=bt709:out_range=tv,crop=1280:720,format=yuv420p", graph)
        self.assertEqual(final(sharp[-1]), os.path.join(out, "dawn.mp4"))

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
        graphs = {final(c[-1]).rsplit("/", 1)[1][:-4]: arg_after(c, "-filter_complex") for c in cmds if c[-1].endswith(".mp4") and "-filter_complex" in c}
        self.assertEqual(set(graphs), {"dawn", "day", "dusk", "night"})
        # each grade is followed by the conversion back to BT.709 limited range (docs/LOOP.md, colour)
        self.assertIn("format=yuv420p,null%s" % T, graphs["day"])   # the source, no grade
        self.assertIn("format=yuv420p,colorbalance=rh=0.12:bh=-0.08:bs=0.06%s" % T, graphs["dawn"])
        self.assertIn("format=yuv420p,colorbalance=rm=0.14:bm=-0.10,eq=brightness=-0.05%s" % T, graphs["dusk"])
        # the curves points keep their quotes through the printed shell line
        self.assertIn("format=yuv420p,curves=master='0/0 0.5/0.36 1/0.82',eq=saturation=0.55,colorbalance=bs=0.16%s" % T, graphs["night"])
        for g in graphs.values():
            self.assertNotIn("colorbalance", g.split("[c0]")[1])   # the grade is applied once, before the split

    def test_blur_copy_is_cut_from_the_finished_sharp_file(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "dusk")
        sharp, blur, poster, blur_poster = cmds
        self.assertEqual(arg_after(blur, "-i"), sharp[-1])
        self.assertEqual(final(arg_after(blur, "-i")), os.path.join(out, "dusk.mp4"))
        self.assertEqual(arg_after(blur, "-vf"), "scale=160:90,gblur=sigma=2,fps=10")
        for flag, want in (("-crf", "26"), ("-maxrate", "300k"), ("-bufsize", "600k"), ("-r", "10"),
                           ("-g", "10"), ("-pix_fmt", "yuv420p"), ("-profile:v", "main"), ("-level", "4.0"),
                           ("-movflags", "+faststart")):
            self.assertEqual(arg_after(blur, flag), want, flag)
        self.assertIn("-an", blur)
        self.assertEqual(final(blur[-1]), os.path.join(out, "dusk-blur.mp4"))

    def test_posters_are_the_first_frame_at_960x540(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "night")
        sharp, blur, poster, blur_poster = cmds
        self.assertEqual(final(arg_after(poster, "-i")), os.path.join(out, "night.mp4"))
        self.assertEqual(arg_after(poster, "-frames:v"), "1")
        self.assertTrue(arg_after(poster, "-vf").startswith("scale=960:540"))
        self.assertEqual(final(poster[-1]), os.path.join(out, "night.jpg"))
        self.assertEqual(final(arg_after(blur_poster, "-i")), os.path.join(out, "night-blur.mp4"))
        self.assertEqual(arg_after(blur_poster, "-frames:v"), "1")
        self.assertTrue(arg_after(blur_poster, "-vf").startswith("scale=960:540"))
        self.assertEqual(final(blur_poster[-1]), os.path.join(out, "night-blur.jpg"))

    def test_only_makes_one_variant(self):
        _, cmds, out = run(CLIP, "--dry-run", "--only", "night")
        self.assertEqual([os.path.basename(final(c[-1])) for c in cmds],
                         ["night.mp4", "night-blur.mp4", "night.jpg", "night-blur.jpg"])

    def test_bad_arguments_stop_before_anything_prints(self):
        for args in ((CLIP, "--dry-run", "--seconds", "14"), (CLIP, "--dry-run", "--seconds", "61"),
                     (CLIP, "--dry-run", "--seconds", "abc"), (CLIP, "--dry-run", "--only", "noon"),
                     (CLIP, "--dry-run", "--slow", "fast"), (CLIP, "--dry-run", "--slow", "0"),
                     (CLIP, "--dry-run", "--slow", "0.0"), ("--dry-run",), (CLIP, "--dry-run", "--bogus"),
                     (CLIP, "--dry-run", "--seconds", "0"), (CLIP, "--dry-run", "--seconds", "00"),
                     (CLIP, "--dry-run", "--seconds", "014"), (CLIP, "--dry-run", "--seconds", "061"),
                     (CLIP, "--dry-run", "--seconds", "100"),
                     (CLIP, "--dry-run", "--seconds", "99999999999999999999")):
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


class StillPhoto(unittest.TestCase):
    """A photo makes a loop too: a slow push in and back out, no seam, the same four grades."""

    def dry(self, *args):
        out = subprocess.run(["bash", SCRIPT, *args, "--dry-run"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return [l for l in out.stdout.splitlines() if l.startswith("ffmpeg ")]

    def test_a_photo_is_pushed_into_with_no_seam(self):
        cmds = self.dry("/nowhere/scene-night@2x.jpg", "--seconds", "34")
        sharp = [c for c in cmds if "-filter_complex" in c]
        self.assertEqual(len(sharp), 4)
        for c in sharp:
            args = shlex.split(c)
            graph = args[args.index("-filter_complex") + 1]
            self.assertIn("-loop", args); self.assertEqual(args[args.index("-loop") + 1], "1")
            self.assertEqual(args[args.index("-t") + 1], "34", "the photo is looped for the loop's length")
            self.assertIn("zoompan=z='1+0.06*(1-cos(2*PI*on/1020))/2'", graph, "N = 30 x 34 frames, eased in and out")
            self.assertIn("[0:v]" + PHOTO_169 + "zoompan=", graph,
                          "scaled up first so the push does not judder, and cut to 16:9")
            self.assertIn("trim=duration=34", graph)
            self.assertNotIn("xfade", graph, "a raised cosine needs no seam")
            self.assertNotIn("setpts=1*PTS", graph, "--slow is not applied to a photo")
        self.assertIn("colorbalance=rh=0.12", shlex.split(sharp[0])[shlex.split(sharp[0]).index("-filter_complex") + 1], "dawn keeps its grade")
        # the blur copy and the posters are made the same way as for a clip
        self.assertEqual(len([c for c in cmds if "gblur" in c]), 4)
        self.assertEqual(len([c for c in cmds if "-frames:v" in c]), 8)

    def test_still_flag_takes_a_clip_as_a_photo(self):
        cmds = self.dry("/nowhere/frame.mp4", "--still", "--seconds", "20")
        graph = shlex.split(cmds[0])[shlex.split(cmds[0]).index("-filter_complex") + 1]
        self.assertIn("zoompan=", graph); self.assertNotIn("xfade", graph)


TAGS = ("-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv")
PHOTO = "/nowhere/scene-night@2x.jpg"
MATTE = "/nowhere/scene-night-fg@2x.webp"
CSS = os.path.join(ROOT, "tv-home", "web", "app.css")


def dry_lines(*args):
    # a folder that is not there unless the test names one, so a loop.json of this computer's own never
    # meets --only
    if "--out" not in args:
        args = args + ("--out", os.path.join(tempfile.gettempdir(), "make-loop-never-written"))
    p = subprocess.run(["bash", SCRIPT, *args, "--dry-run"], capture_output=True, text=True)
    return p, p.stdout.splitlines()


def loop_json(lines):
    import json
    js = [l for l in lines if l.startswith("# would write ") and "loop.json: " in l]
    assert len(js) == 1, lines
    return json.loads(js[0].split("loop.json: ", 1)[1])


def has_run(cmd, seq):
    return any(cmd[i:i + len(seq)] == list(seq) for i in range(len(cmd)))


class Colour(unittest.TestCase):
    """Every encode is BT.709 limited range and says so, so the TV decodes the colours ffmpeg did."""

    def test_sharp_and_blur_carry_the_tags_and_the_posters_are_jpeg_range(self):
        for args in ((CLIP, "--only", "day"), (PHOTO, "--only", "day")):
            _, lines = dry_lines(*args)
            cmds = [shlex.split(l) for l in lines if l.startswith("ffmpeg ")]
            sharp, blur, poster, blur_poster = cmds
            self.assertTrue(has_run(sharp, TAGS), args)
            self.assertTrue(has_run(blur, TAGS), args)
            for c in (poster, blur_poster):
                vf = arg_after(c, "-vf")
                self.assertIn("in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc,format=yuvj420p", vf)

    def test_a_photo_is_converted_after_zoompan_and_after_the_grade(self):
        _, lines = dry_lines(PHOTO, "--only", "dusk")
        graph = arg_after(shlex.split(lines[1]), "-filter_complex")
        self.assertIn(":s=1280x720:fps=30,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,colorbalance=rm=0.14", graph)
        self.assertIn("eq=brightness=-0.05" + T, graph)


class Depth(unittest.TestCase):
    """--matte: the cut-out over the clock, and loop.json for the home (docs/LOOP.md, the depth effect)."""

    def fg_cmd(self, *extra):
        p, lines = dry_lines(PHOTO, "--matte", MATTE, "--seconds", "34", "--only", "night", *extra)
        self.assertEqual(p.returncode, 0, p.stderr)
        cmds = [shlex.split(l) for l in lines if l.startswith("ffmpeg ")]
        return cmds, lines

    def test_one_more_command_per_variant_the_png_last(self):
        cmds, _ = self.fg_cmd()
        self.assertEqual([os.path.basename(final(c[-1])) for c in cmds],
                         ["night.mp4", "night-blur.mp4", "night.jpg", "night-blur.jpg", "night-fg.png"])
        p, lines = dry_lines(PHOTO, "--matte", MATTE)
        self.assertEqual(len([l for l in lines if l.startswith("ffmpeg ")]), 20)

    def test_the_cut_out_is_the_first_frame_of_the_sharp_file_and_the_matte(self):
        cmds, _ = self.fg_cmd()
        fg = cmds[-1]
        ins = [fg[i + 1] for i, a in enumerate(fg) if a == "-i"]
        self.assertEqual(ins[0], cmds[0][-1], "the finished sharp file: its colours are the video's")
        self.assertTrue(final(ins[0]).endswith("/night.mp4"))
        self.assertEqual(ins[1], MATTE)
        self.assertEqual(arg_after(fg, "-map"), "[fg]")
        self.assertEqual(arg_after(fg, "-frames:v"), "1")
        g = arg_after(fg, "-filter_complex")
        # frame 0, decoded as it was encoded
        self.assertIn("[0:v]trim=end_frame=1,scale=in_color_matrix=bt709:in_range=tv:", g)
        # the rectangle FG (480, 162, 960, 318) on the 1280x720 frame, for both the colour and the matte
        self.assertEqual(g.count("crop=640:212:320:108"), 2)
        # the matte is cut to its centre 16:9 band exactly as the photo is, so the two stay in register
        self.assertIn("[1:v]" + MATTE_169 + "crop=640:212:320:108,alphaextract,", g)
        # the feather: min(1, distance to the nearest crop edge / 24), from the pixel centre
        self.assertIn("geq=lum='p(X,Y)*min(1,min(min(X+0.5,W-X-0.5),min(Y+0.5,H-Y-0.5))/24)+0.5'", g)
        self.assertIn("[c][m]alphamerge,format=rgba[fg]", g)

    def test_the_rectangle_is_whole_on_both_frames(self):
        for v in (480, 162, 960, 318):
            self.assertEqual(v % 3, 0)
        self.assertEqual([v * 2 // 3 for v in (480, 162, 960, 318)], [320, 108, 640, 212])

    def test_zoom_and_sway_are_the_same_numbers_in_zoompan_and_loop_json(self):
        cmds, lines = self.fg_cmd()
        meta = loop_json(lines)
        self.assertEqual(meta, {"still": True, "seconds": 34, "fps": 30, "zoom": 0.06, "sway": 0.3,
                                "fg": {"x": 480, "y": 162, "w": 960, "h": 318}})
        g = arg_after(cmds[0], "-filter_complex")
        self.assertIn("zoompan=z='1+%g*(1-cos(2*PI*on/1020))/2'" % meta["zoom"], g)
        self.assertIn("x='(iw-iw/zoom)/2*(1+%g*sin(2*PI*on/1020))+(iw/zoom-trunc(iw/zoom))/2+0.5'" % meta["sway"], g)
        self.assertIn("y='(ih-ih/zoom)/2+(ih/zoom-trunc(ih/zoom))/2+0.5'", g)
        self.assertIn("format=yuv444p,crop=5120:2880,zoompan=", g, "4:4:4, so zoompan places the window to the whole pixel")
        with open(SCRIPT, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("ZOOM=0.06\nSWAY=0.3\n", text)
        self.assertNotIn("1+0.06*", text.split("set -eu", 1)[1], "zoompan reads the variables, not its own copy")

    def zoompan(self, on, n=1020, iw=5120, ih=2880, zoom=0.06, sway=0.3):
        """What ffmpeg 7.1's zoompan does with the script's expressions (libavfilter/vf_zoompan.c): the
        window w = int(iw/zoom), x evaluated, clamped into 0 .. iw - w and made a whole pixel, the same
        for y (4:4:4, so no even rounding)."""
        import math
        z = min(max(1 + zoom * (1 - math.cos(2 * math.pi * on / n)) / 2, 1), 10)
        w, h = int(iw * (1.0 / z)), int(ih * (1.0 / z))
        dx = (iw - iw / z) / 2 * (1 + sway * math.sin(2 * math.pi * on / n)) + (iw / z - math.trunc(iw / z)) / 2 + 0.5
        dy = (ih - ih / z) / 2 + (ih / z - math.trunc(ih / z)) / 2 + 0.5
        x, y = int(min(max(dx, 0), max(iw - w, 0))), int(min(max(dy, 0), max(ih - h, 0)))
        return z, x, y, w, h

    def test_frame_zero_is_the_neutral_position(self):
        self.assertEqual(self.zoompan(0), (1.0, 0, 0, 5120, 2880))

    def test_the_video_follows_the_formula_the_home_moves_the_cut_out_by(self):
        # every frame of a 34 s loop, at the cut-out's corners and on the peak: where zoompan puts the point
        # against where the page's translateX(-sway*(z-1)/2*100vw*s) scale(z) about the centre puts it
        import math
        worst = 0
        for on in range(1020):
            z, x, y, w, h = self.zoompan(on)
            s = math.sin(2 * math.pi * on / 1020)
            for p, q in ((480, 162), (1440, 162), (480, 480), (1440, 480), (950, 350)):
                vx, vy = (p * 5120 / 1920 - x) * 1920 / w, (q * 2880 / 1080 - y) * 1080 / h
                px, py = 960 + z * (p - 960) - 0.3 * (z - 1) / 2 * 1920 * s, 540 + z * (q - 540)
                worst = max(worst, math.hypot(vx - px, vy - py))
        self.assertLess(worst, 0.5, "under half a screen pixel on every frame (2.7 px with the old drift)")

    def test_the_sway_never_asks_for_more_room_than_the_zoom_leaves(self):
        import math
        for on in range(1020):
            z = 1 + 0.06 * (1 - math.cos(2 * math.pi * on / 1020)) / 2
            room = 5120 - 5120 / z
            x = room / 2 * (1 + 0.3 * math.sin(2 * math.pi * on / 1020))
            self.assertTrue(0 <= x <= room, on)

    def test_loop_json_without_a_matte_and_for_a_clip(self):
        _, lines = dry_lines(PHOTO, "--seconds", "20", "--only", "day")
        self.assertEqual(loop_json(lines), {"still": True, "seconds": 20, "fps": 30, "zoom": 0.06, "sway": 0.3, "fg": None})
        _, lines = dry_lines(CLIP, "--seconds", "45", "--only", "day")
        self.assertEqual(loop_json(lines), {"still": False, "seconds": 45, "fps": 30, "zoom": 0, "sway": 0, "fg": None})

    def test_only_may_not_change_the_loop_json_the_other_variants_were_made_with(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        _, lines = dry_lines(PHOTO, "--matte", MATTE, "--seconds", "34")
        made = [l for l in lines if l.startswith("# would write ")][0].split("loop.json: ", 1)[1]
        with open(os.path.join(tmp, "loop.json"), "w", encoding="utf-8") as f:
            f.write(made + "\n")
        before = os.listdir(tmp)
        for args in (("--seconds", "20", "--matte", MATTE), ("--matte", MATTE), ("--seconds", "34"), ()):
            p, lines = dry_lines(PHOTO, *args, "--only", "night", "--out", tmp)
            self.assertEqual(p.returncode, 2, args)
            self.assertIn("would change loop.json", p.stderr)
            self.assertEqual([l for l in lines if l.startswith("ffmpeg ")], [], args)
        p, lines = dry_lines(CLIP, "--seconds", "34", "--only", "night", "--out", tmp)
        self.assertEqual(p.returncode, 2, "a clip over a photo's loop")
        # the same loop as before: allowed, and all four without --only may change it
        p, lines = dry_lines(PHOTO, "--matte", MATTE, "--seconds", "34", "--only", "night", "--out", tmp)
        self.assertEqual(p.returncode, 0, p.stderr)
        p, lines = dry_lines(PHOTO, "--seconds", "20", "--out", tmp)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(loop_json(lines)["seconds"], 20)
        self.assertEqual(os.listdir(tmp), before, "dry runs wrote nothing")
        # an older loop.json (the drift of the first version): --only is refused, so all four are remade
        with open(os.path.join(tmp, "loop.json"), "w", encoding="utf-8") as f:
            f.write(made.replace('"sway": 0.3', '"drift": 0.006') + "\n")
        p, _ = dry_lines(PHOTO, "--matte", MATTE, "--seconds", "34", "--only", "night", "--out", tmp)
        self.assertEqual(p.returncode, 2)

    def test_a_dry_run_with_a_matte_writes_nothing(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = os.path.join(tmp, "loop")
        p, _ = dry_lines(PHOTO, "--matte", MATTE, "--out", out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(out))

    def test_a_matte_with_a_clip_is_refused(self):
        p, lines = dry_lines(CLIP, "--matte", MATTE)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("photo only", p.stderr)
        self.assertEqual([l for l in lines if l.startswith("ffmpeg ")], [])

    def test_the_scrim_is_baked_in_as_app_css_draws_it(self):
        # the gradients in the script are the ones in app.css
        import re
        with open(CSS, encoding="utf-8") as f:
            css = f.read()
        block = css[css.index("html.theme-loop .scrim {"):]
        grads = re.findall(r"linear-gradient\(180deg, ([^)]*\)[^l]*?)\)(?:,|;)", block[:block.index("}")])
        stops = [[(float(p), float(a)) for a, p in re.findall(r"rgba\(11, 10, 16, ([0-9.]+)\) ([0-9.]+)%", g)] for g in grads]
        self.assertEqual(len(stops), 2, grads)
        with open(SCRIPT, encoding="utf-8") as f:
            text = f.read()
        def script_stops(name):
            line = re.search(r'^%s="([^"]*)"' % name, text, re.M).group(1)
            return [tuple(float(x) for x in s.split(":")) for s in line.split()]
        self.assertEqual(script_stops("SCRIM_TOP"), stops[0])
        self.assertEqual(script_stops("SCRIM_BOTTOM"), stops[1])
        self.assertIn("INK_R=11; INK_G=10; INK_B=16", text)

        # and the geq expression computes c*(1-a) + ink*a at each row's centre on the screen
        cmds, _ = self.fg_cmd()
        g = arg_after(cmds[-1], "-filter_complex")
        exprs = dict(re.findall(r"\b([rgb])='([^']*)'", g))
        self.assertEqual(set(exprs), {"r", "g", "b"})

        def css_ramp(st, y):
            if y <= st[0][0] * 10.8:
                return st[0][1]
            for (p0, a0), (p1, a1) in zip(st, st[1:]):
                if y < p1 * 10.8:
                    return a0 + (a1 - a0) * (y - p0 * 10.8) / ((p1 - p0) * 10.8)
            return st[-1][1]

        def geq(expr, Y, c):
            mem = {}
            env = {"st": lambda i, v: mem.__setitem__(int(i), v) or v, "ld": lambda i: mem[int(i)],
                   "lt": lambda a, b: 1 if a < b else 0, "iff": lambda q, a, b: a if q else b,
                   "min": min, "r": lambda x, y: c, "g": lambda x, y: c, "b": lambda x, y: c, "X": 0, "Y": Y}
            val = None
            for part in re.sub(r"\bif\(", "iff(", expr).split(";"):
                val = eval(part, {"__builtins__": {}}, env)
            return val

        for Y in (0, 1, 50, 120, 150, 190, 200, 211):
            ys = (Y + 108) * 1.5 + 0.75
            a = 1 - (1 - css_ramp(stops[0], ys)) * (1 - css_ramp(stops[1], ys))
            for ch, ink in (("r", 11), ("g", 10), ("b", 16)):
                want = 200 * (1 - a) + ink * a + 0.5
                self.assertAlmostEqual(geq(exprs[ch], Y, 200), want, places=6, msg=(Y, ch))
        # the first row: its centre is 162.75 on the screen, on the top gradient between 0 and 28 percent
        self.assertAlmostEqual(css_ramp(stops[0], 162.75), 0.66 - 0.10 * 162.75 / 302.4, places=9)


class Seconds(unittest.TestCase):
    """--seconds is read as a decimal number everywhere: bash arithmetic would read 020 as octal (16)."""

    def test_a_leading_zero_is_the_same_loop_as_without(self):
        for secs in ("020", "0020", "019"):
            want = str(int(secs))
            _, lines = dry_lines(PHOTO, "--seconds", secs, "--only", "day")
            self.assertEqual(loop_json(lines)["seconds"], int(want), secs)   # valid JSON, and decimal
            sharp = shlex.split([l for l in lines if l.startswith("ffmpeg ")][0])
            self.assertEqual(arg_after(sharp, "-t"), want)
            g = arg_after(sharp, "-filter_complex")
            self.assertIn("on/%d)" % (30 * int(want)), g, "the push's period is the loop's length")
            self.assertIn("trim=duration=%s," % want, g)
            p, lines = dry_lines(CLIP, "--seconds", secs, "--only", "day")
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertNotIn("value too great", p.stderr)
            g = arg_after(shlex.split([l for l in lines if l.startswith("ffmpeg ")][0]), "-filter_complex")
            n = int(want)
            self.assertIn("trim=duration=%d," % (n + 1), g)
            self.assertIn("[c0]trim=start=1:duration=%d," % n, g)
            self.assertIn("offset=%d[out]" % (n - 1), g)


class SixteenByNine(unittest.TestCase):
    """A photo of another shape is cut to its centre 16:9 band, and the matte the same way, so the loop is
    not squashed and the cut-out stays on the peak."""

    def cover(self, iw, ih, ow, oh):
        """scale=ow:oh:force_original_aspect_ratio=increase then crop=ow:oh, as ffmpeg 7.1 does them
        (libavfilter/scale_eval.c rounds the other side to the nearest pixel; crop centres, whole pixels):
        the scaled size and the crop's corner."""
        def rescale(a, b, c):   # av_rescale, to the nearest
            return (a * b + c // 2) // c
        sw, sh = max(ow, rescale(oh, iw, ih)), max(oh, rescale(ow, ih, iw))
        return sw, sh, (sw - ow) // 2, (sh - oh) // 2

    def test_photo_and_matte_are_scaled_to_cover_and_cut_to_the_frame(self):
        p, lines = dry_lines(PHOTO, "--matte", MATTE, "--only", "dawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        cmds = [shlex.split(l) for l in lines if l.startswith("ffmpeg ")]
        self.assertTrue(arg_after(cmds[0], "-filter_complex").startswith("[0:v]" + PHOTO_169 + "zoompan="))
        self.assertIn("[1:v]" + MATTE_169, arg_after(cmds[-1], "-filter_complex"))

    def test_a_16_9_picture_is_left_whole(self):
        for iw, ih in ((1920, 1080), (3840, 2160), (5120, 2880), (1280, 720)):
            self.assertEqual(self.cover(iw, ih, 5120, 2880), (5120, 2880, 0, 0))
            self.assertEqual(self.cover(iw, ih, 1280, 720), (1280, 720, 0, 0))

    def test_another_shape_is_cut_not_squashed(self):
        self.assertEqual(self.cover(4032, 3024, 5120, 2880), (5120, 3840, 0, 480), "a phone's 4:3")
        self.assertEqual(self.cover(1080, 1920, 5120, 2880), (5120, 9102, 0, 3111), "a portrait")
        self.assertEqual(self.cover(3440, 1440, 5120, 2880), (6880, 2880, 880, 0), "wider than 16:9")

    def test_a_smaller_matte_of_the_same_shape_stays_in_register(self):
        # a point of the photo and the same point of a matte at full, half or a quarter the size land
        # within half a 720p pixel of each other on the 1280x720 frame (the matte's crop is whole 720p
        # pixels, the photo's whole quarter pixels), which the 24 pixel feather and the matte's soft
        # edge take up; a 16:9 photo is not cut at all
        for iw, ih in ((4032, 3024), (1080, 1920), (3440, 1440), (6000, 4000), (3000, 2000)):
            sw, sh, px, py = self.cover(iw, ih, 5120, 2880)
            for k in (1, 2, 4):
                mw, mh, mx, my = self.cover(iw // k, ih // k, 1280, 720)
                for fu, fv in ((0.3, 0.4), (0.5, 0.5), (0.7, 0.6), (0.45, 0.35)):
                    a = ((fu * sw - px) / 4, (fv * sh - py) / 4)
                    b = (fu * mw - mx, fv * mh - my)
                    self.assertLessEqual(max(abs(a[0] - b[0]), abs(a[1] - b[1])), 0.5 + 1e-9, (iw, ih, k, fu, fv))


STUB_FFMPEG = """#!/bin/sh
# make-loop.sh's tests: an ffmpeg that writes "new" to its output (its last argument), logs it, fails on
# the output named by STUB_FAIL and hangs on the one named by STUB_HANG
for last in "$@"; do :; done
echo "$last" >> "$STUB_LOG"
if [ -n "$STUB_FAIL" ]; then case "$last" in *"$STUB_FAIL") exit 1 ;; esac; fi
if [ -n "$STUB_HANG" ]; then case "$last" in *"$STUB_HANG") : > "$STUB_LOG.hang"; sleep 30 ;; esac; fi
printf 'new\\n' > "$last"
"""
STUB_FFPROBE = """#!/bin/sh
case "$*" in *pix_fmt*) echo rgba ;; *) echo 100 ;; esac
"""
NAMES = [v + s for v in ("dawn", "day", "dusk", "night") for s in (".mp4", "-blur.mp4", ".jpg", "-blur.jpg", "-fg.png")]
OLD_JSON = '{"still": true, "seconds": 34, "fps": 30, "zoom": 0.06, "sway": 0.3, "fg": {"x": 480, "y": 162, "w": 960, "h": 318}}\n'


class Staging(unittest.TestCase):
    """A real run, with a stand-in ffmpeg: nothing reaches the served folder until every encode has
    worked, loop.json goes in last, and a run that fails or is stopped leaves the folder as it was."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        for name, text in (("ffmpeg", STUB_FFMPEG), ("ffprobe", STUB_FFPROBE)):
            path = os.path.join(self.bin, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            os.chmod(path, 0o755)
        self.out = os.path.join(self.tmp, "loop")
        os.makedirs(self.out)
        for n in NAMES:
            with open(os.path.join(self.out, n), "w", encoding="utf-8") as f:
                f.write("old\n")
        with open(os.path.join(self.out, "loop.json"), "w", encoding="utf-8") as f:
            f.write(OLD_JSON)
        self.before = self.folder()
        self.photo = os.path.join(self.tmp, "my photo.jpg")
        self.matte = os.path.join(self.tmp, "matte.webp")
        for path in (self.photo, self.matte):
            with open(path, "wb") as f:
                f.write(b"\x00")
        self.log = os.path.join(self.tmp, "ffmpeg.log")

    def folder(self):
        out = {}
        for n in sorted(os.listdir(self.out)):
            with open(os.path.join(self.out, n), encoding="utf-8") as f:
                out[n] = f.read()
        return out

    def env(self, **extra):
        e = dict(os.environ, PATH=self.bin + os.pathsep + "/usr/bin:/bin", STUB_LOG=self.log)
        e.update(extra)
        return e

    def outputs(self):
        with open(self.log, encoding="utf-8") as f:
            return f.read().splitlines()

    def test_a_run_that_works_moves_everything_in_and_leaves_no_staging_folder(self):
        p = subprocess.run(["bash", SCRIPT, self.photo, "--matte", self.matte, "--seconds", "20", "--out", self.out],
                           capture_output=True, text=True, env=self.env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.outputs()), 20)
        for o in self.outputs():
            final(o)   # every encode wrote into the staging folder, none into the served one
        now = self.folder()
        self.assertEqual(sorted(now), sorted(NAMES + ["loop.json"]), "no staging folder or dotfile left")
        self.assertTrue(all(now[n] == "new\n" for n in NAMES))
        self.assertIn('"seconds": 20', now["loop.json"])
        # loop.json goes last, after the old one was taken away first; each variant's .mp4 after its companions
        moves = [l for l in p.stdout.splitlines() if l.startswith(("mv ", "rm "))]
        self.assertEqual(moves[0], "rm -f " + os.path.join(self.out, "loop.json"))
        self.assertTrue(moves[-1].endswith(" " + os.path.join(self.out, "loop.json")), moves[-1])
        dsts = [shlex.split(m)[-1] for m in moves[1:-1]]
        for v in ("dawn", "day", "dusk", "night"):
            mine = [os.path.basename(d) for d in dsts if os.path.basename(d).startswith(v)]
            self.assertEqual(mine[-1], v + ".mp4")
            self.assertEqual(sorted(mine), sorted([v + s for s in (".mp4", "-blur.mp4", ".jpg", "-blur.jpg", "-fg.png")]))

    def test_without_a_matte_the_old_cut_outs_go(self):
        p = subprocess.run(["bash", SCRIPT, self.photo, "--out", self.out],
                           capture_output=True, text=True, env=self.env())
        self.assertEqual(p.returncode, 0, p.stderr)
        now = self.folder()
        self.assertEqual(sorted(now), sorted([n for n in NAMES if not n.endswith("-fg.png")] + ["loop.json"]))
        self.assertIn('"fg": null', now["loop.json"])

    def test_a_failed_encode_leaves_the_folder_as_it_was(self):
        p = subprocess.run(["bash", SCRIPT, self.photo, "--matte", self.matte, "--seconds", "20", "--out", self.out],
                           capture_output=True, text=True, env=self.env(STUB_FAIL="/.dusk-fg.png"))
        self.assertNotEqual(p.returncode, 0)
        self.assertTrue(any(o.endswith("/.dawn.mp4") for o in self.outputs()), "it got some way first")
        self.assertEqual(self.folder(), self.before, "old files, old loop.json, no staging folder")

    def test_a_stopped_run_leaves_the_folder_as_it_was(self):
        p = subprocess.Popen(["bash", SCRIPT, self.photo, "--matte", self.matte, "--out", self.out],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             env=self.env(STUB_HANG="/.day.mp4"), start_new_session=True)
        try:
            for _ in range(200):
                if os.path.exists(self.log + ".hang"):
                    break
                p.poll()
                self.assertIsNone(p.returncode, "the run ended before the hang")
                import time
                time.sleep(0.05)
            self.assertTrue(os.path.exists(self.log + ".hang"))
            os.killpg(p.pid, signal.SIGTERM)   # as Ctrl-C or a kill would: the script and its ffmpeg
            p.wait(timeout=20)
        finally:
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(self.folder(), self.before, "old files, old loop.json, no staging folder")

    def test_only_keeps_loop_json_in_place_while_it_moves_its_variant_in(self):
        with open(os.path.join(self.out, "loop.json"), "w", encoding="utf-8") as f:
            f.write('{"still": true, "seconds": 30, "fps": 30, "zoom": 0.06, "sway": 0.3, "fg": null}\n')
        p = subprocess.run(["bash", SCRIPT, self.photo, "--only", "dusk", "--out", self.out],
                           capture_output=True, text=True, env=self.env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("rm -f " + os.path.join(self.out, "loop.json"), p.stdout)
        now = self.folder()
        for n in NAMES:
            if n.startswith("dusk"):
                self.assertEqual(now.get(n), None if n.endswith("-fg.png") else "new\n", n)
            else:
                self.assertEqual(now[n], "old\n", n)
        self.assertNotIn(".staging", " ".join(os.listdir(self.out)))


if __name__ == "__main__":
    unittest.main()
