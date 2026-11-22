#!/usr/bin/env python3
"""Make the moving wave scenes: layered colour waves as a seamless looping clip, with a little
sailboat crossing the screen (a waving stick figure in a frock at the stern), someone overboard
waving both arms for help, and dolphins leaping out of the waves at random. Everything is drawn
here, nothing is downloaded. docs/MAKE-A-SCENE.md, "Moving wave scenes", walks through it.

    python3 tv-home/tools/make-waves.py                         all three: dusk, ocean and dawn
    python3 tv-home/tools/make-waves.py --palettes dusk --preview      one frame to look at first
    python3 tv-home/tools/make-waves.py --captain-face me.jpg --swimmer-face friend.jpg

The figures have stub cartoon faces unless you give photos. A photo is cut to a square around
the face (--captain-crop / --swimmer-crop X,Y,SIZE in the photo's pixels; by default the middle
square) and drawn as a round bobble head. Photos only ever go into the clip, which stays in
tv-home/web/backgrounds/mine/ (git ignores that folder): never commit it.

For each palette it writes, into tv-home/web/backgrounds/mine/:
  scene-wavesPALETTE.mp4         the clip (H.264, 1920x1080, about 20 MB a minute)
  scene-wavesPALETTE.jpg         its first frame, the photo under the clip (via make-scene.py)
  scene-wavesPALETTE-glass.jpg   the frosted copy the glass clock is filled with
and prints the home.my_scenes entries to paste into config.json ("video": true plays the clip,
"when" lets Follow the sun show it at that time of day).

Rendering is slow: about 1.5 s a frame, so a one-minute clip at 24 fps takes about 35 minutes
(run the palettes in parallel with one --palettes each). --seconds 20 makes shorter clips; the
boat then crosses in 20 s.

Needs numpy, Pillow, and ffmpeg (on the PATH, or from `pip install imageio-ffmpeg`):
    .venv/bin/pip install numpy Pillow imageio-ffmpeg
"""
import argparse
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "tv-home", "web", "backgrounds", "mine")
W, H = 1920, 1080
TAU = np.float32(2 * np.pi)
SS = 4                                   # sprites are drawn at 4x, then scaled down: smooth edges

PALETTES = {
    "dusk": dict(sky=[(18, 16, 48), (92, 52, 120)],
                 bands=[(240, 128, 120), (214, 84, 140), (150, 64, 170), (86, 58, 170), (40, 44, 130), (20, 22, 70)],
                 boat=((44, 26, 64), (255, 226, 205), (240, 128, 120)), frock=(255, 170, 205),
                 dolphin=((70, 48, 120), (150, 110, 190)), when="dusk", text="light", seed=21),
    "ocean": dict(sky=[(8, 24, 48), (30, 90, 130)],
                  bands=[(110, 220, 210), (60, 180, 200), (40, 130, 190), (36, 90, 170), (28, 56, 130), (14, 28, 70)],
                  boat=((14, 32, 60), (240, 248, 250), (255, 120, 90)), frock=(255, 205, 80),
                  dolphin=((30, 70, 120), (120, 180, 210)), when="day", text="light", seed=22),
    "dawn": dict(sky=[(250, 214, 190), (255, 236, 214)],
                 bands=[(255, 190, 140), (250, 150, 130), (232, 120, 150), (180, 110, 190), (120, 110, 200), (70, 80, 170)],
                 boat=((96, 62, 110), (255, 248, 238), (232, 96, 120)), frock=(170, 140, 235),
                 dolphin=((110, 90, 170), (190, 160, 220)), when="dawn", text="dark", seed=23),
}
NAMES = {"dusk": "Dusk waves", "ocean": "Ocean waves", "dawn": "Dawn waves"}


def round_mask(img):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    img.putalpha(m)
    return img


def photo_face(path, crop, size):
    """A round head from a photo: the square crop X,Y,SIZE (default the middle square)."""
    im = Image.open(path).convert("RGB")
    if crop:
        x, y, s = (int(v) for v in crop.split(","))
    else:
        s = min(im.size)
        x, y = (im.size[0] - s) // 2, (im.size[1] - s) // 2
    return round_mask(im.crop((x, y, x + s, y + s)).resize((size, size), Image.LANCZOS).convert("RGBA"))


def stub_face(size, mood):
    """A cartoon face drawn here, so nobody's photo is needed: "happy" or "panic"."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = size / 100.0
    skin, hair, ink = (236, 196, 160), (60, 42, 36), (40, 28, 30)
    d.ellipse((0, 0, size - 1, size - 1), fill=skin + (255,))
    d.pieslice((-4 * u, -10 * u, 104 * u, 62 * u), 180, 360, fill=hair + (255,))          # hair
    if mood == "happy":
        for ex in (34, 66):
            d.ellipse(((ex - 5) * u, 44 * u, (ex + 5) * u, 56 * u), fill=ink + (255,))
            d.ellipse(((ex - 13) * u, 60 * u, (ex - 1) * u, 70 * u) if ex < 50 else ((ex + 1) * u, 60 * u, (ex + 13) * u, 70 * u),
                      fill=(240, 140, 150, 150))                                            # cheeks
        d.arc((30 * u, 52 * u, 70 * u, 82 * u), 20, 160, fill=ink + (255,), width=max(1, int(4 * u)))
    else:
        for ex, tilt in ((34, -1), (66, 1)):          # worried brows: inner ends up
            d.ellipse(((ex - 8) * u, 40 * u, (ex + 8) * u, 58 * u), fill=(255, 255, 255, 255))
            d.ellipse(((ex - 4) * u, 40 * u, (ex + 4) * u, 50 * u), fill=ink + (255,))       # eyes rolled up
            d.line(((ex - 10) * u, (34 - 5 * tilt) * u, (ex + 10) * u, (34 + 5 * tilt) * u), fill=ink + (255,), width=max(1, int(4 * u)))
        d.ellipse((38 * u, 64 * u, 62 * u, 90 * u), fill=(90, 30, 40, 255))                 # "help!"
    return round_mask(im) if mood == "panic" else im


class Waves:
    def __init__(self, pal, args):
        self.P = P = PALETTES[pal]
        self.T, self.FPS = float(args.seconds), int(args.fps)
        T = self.T
        self.y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
        self.x = np.linspace(0, 1, W, dtype=np.float32)[None, :]
        top, bot = np.array(P["sky"][0], np.float32), np.array(P["sky"][1], np.float32)
        t = (self.y ** 1.4)[..., None]
        self.sky = np.broadcast_to(top * (1 - t) + bot * t, (H, W, 3)).astype(np.float32)
        self.cycles = max(1, round(T / 20))               # the waves keep a 20 s rhythm
        rng = np.random.default_rng(7)
        self.phases = [rng.uniform(0, 2 * np.pi, 2) for _ in P["bands"]]
        self.grain = np.random.default_rng(11).normal(0, 2.0, (H, W, 3)).astype(np.float32)
        self.y0 = int(H * 0.36)                           # above this it is all sky
        self.line = 3.0
        # the boat, and its captain waving from the stern
        self.boat_on = not args.no_boat
        self.captain = None
        if self.boat_on and not args.no_captain:
            self.head_r = 34
            sz = int(2 * self.head_r * SS)
            self.captain = photo_face(args.captain_face, args.captain_crop, sz) if args.captain_face else stub_face(sz, "happy")
        self.k = 1.45 if self.captain is not None else 1.0
        self.bw, self.bh, self.bwl = 300, 260, 240
        self.wave_n = max(1, round(1.1 * T))
        self.first_band = 2
        self.base = self._boat_base()
        spr = self._boat(0.0, 0.0)
        self.sw, self.sh, self.wl = spr.width, spr.height, self.bwl * self.k
        self.edge_in = (self.sw / 2 + 12) / W
        # someone overboard
        self.swimmer = None
        if not args.no_swimmer:
            self.swim_r = 30
            sz = int(2 * self.swim_r * SS)
            self.swimmer = photo_face(args.swimmer_face, args.swimmer_crop, sz) if args.swimmer_face else stub_face(sz, "panic")
            self.swim_x, self.swim_band = 0.42, 3
            self.sbw, self.sbh, self.sbwl = 170, 200, 140
            self.bob_n, self.bob_n2 = max(1, round(0.5 * T)), max(1, round(1.3 * T))
            self.flail_n, self.dip_n = max(1, round(2.2 * T)), max(1, round(T / 7))
        # dolphins
        self.leaps = []
        if not args.no_dolphins:
            self.dolphin = self._dolphin()
            self.dolphin_l = self.dolphin.transpose(Image.FLIP_LEFT_RIGHT)
            self.leap_len, self.leap_dx, self.leap_high = 2.0 / T, 0.19, 0.09
            lr = np.random.default_rng(P["seed"])
            n = max(2, round(T / 9))                      # about one school every 9 s
            for st in (np.arange(n) + lr.uniform(0.1, 0.6, n)) / n:
                dr = 1 if lr.random() < 0.5 else -1
                k = int(lr.integers(1, 4))
                span = self.leap_dx + 0.1 * (k - 1)
                x0 = lr.uniform(0.06, 0.94 - span) + (span if dr < 0 else 0)
                for j in range(k):
                    self.leaps.append(((st + 0.0073 * j) % 1.0, x0 + dr * 0.1 * j, dr))

    # ---------------------------------------------------------------- drawing helpers
    def _stick(self, d, ink, *pts):
        S = lambda ps: [(px * SS, py * SS) for px, py in ps]
        d.line(S(pts), fill=ink, width=int(self.line * SS), joint="curve")
        r = self.line / 2
        for px, py in (pts[0], pts[-1]):
            d.ellipse(S([(px - r, py - r), (px + r, py + r)]), fill=ink)

    def _boat_base(self):
        cx, WL = self.bw / 2, self.bwl
        im = Image.new("RGBA", (self.bw * SS, self.bh * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        S = lambda ps: [(px * SS, py * SS) for px, py in ps]
        hull, sail, flag = self.P["boat"]
        stern = 74 if self.captain is not None else 52    # a longer stern deck to stand on
        d.polygon(S([(cx - stern, WL - 14), (cx + 56, WL - 14), (cx + 40, WL + 8), (cx - stern + 16, WL + 8)]), fill=hull + (255,))
        d.rectangle(S([(cx - 30, WL - 19), (cx + 18, WL - 14)]), fill=hull + (255,))
        d.rectangle(S([(cx - 2, WL - 100), (cx + 2, WL - 16)]), fill=hull + (255,))          # mast
        d.polygon(S([(cx + 5, WL - 96), (cx + 5, WL - 22), (cx + 50, WL - 22)]), fill=sail + (255,))
        d.polygon(S([(cx - 5, WL - 84), (cx - 5, WL - 22), (cx - 40, WL - 22)]), fill=sail + (235,))
        d.polygon(S([(cx + 2, WL - 100), (cx + 22, WL - 95), (cx + 2, WL - 90)]), fill=flag + (255,))
        return im

    def _boat(self, s, a):
        im = self.base.copy()
        if self.captain is not None:
            d = ImageDraw.Draw(im)
            S = lambda ps: [(px * SS, py * SS) for px, py in ps]
            ink = self.P["boat"][0] + (255,)
            cx, WL, T = self.bw / 2, self.bwl, self.T
            fx = cx - 62
            foot, hip, sh, neck = WL - 14, WL - 34, WL - 50, WL - 56
            self._stick(d, ink, (fx - 8, foot), (fx, hip), (fx + 8, foot))            # legs
            self._stick(d, ink, (fx, hip), (fx, neck))                                  # body
            # a little frock, its hem swinging with the boat's roll
            sway = 3.2 * np.sin(2 * a + 1.4) + 0.8 * np.sin(TAU * self.wave_n * s * 0.5)
            pts = [(fx - 4, sh - 1), (fx + 4, sh - 1), (fx + 5.5, WL - 40)]
            for k in range(8):
                u = k / 7
                pts.append((fx + 13 - 26 * u + sway * (0.7 + 0.3 * np.cos(np.pi * u)),
                            WL - 24 + 1.3 * np.sin(np.pi * 3 * u + 2 * a + TAU * self.wave_n * s * 0.5)))
            pts.append((fx - 5.5, WL - 40))
            d.polygon(S(pts), fill=self.P["frock"] + (255,), outline=ink, width=max(1, int(0.9 * SS)))
            self._stick(d, ink, (fx - 5.5, WL - 40), (fx + 5.5, WL - 40))
            self._stick(d, ink, (fx, sh), (fx - 12, sh + 6), (fx - 18, sh + 14))      # the other arm
            # the bobble head, tipping as the boat rocks
            r = self.head_r
            hy = neck - r + 6
            ring = r + 1.6
            d.ellipse(S([(fx - ring, hy - ring), (fx + ring, hy + ring)]), fill=ink)
            im.alpha_composite(self.captain.rotate(float(6.0 * np.sin(2 * a + 0.7)), resample=Image.BICUBIC),
                               (int((fx - r) * SS), int((hy - r) * SS)))
            # the waving arm
            ex, ey = fx + 26, sh + 2
            dev = np.radians(8 + 28 * np.sin(TAU * self.wave_n * s))
            hx, hy2 = ex + 15 * np.sin(dev), ey - 15 * np.cos(dev)
            self._stick(d, ink, (fx, sh), (ex, ey), (hx, hy2))
            d.ellipse(S([(hx - 3.2, hy2 - 3.2), (hx + 3.2, hy2 + 3.2)]), fill=ink)
        return im.resize((int(self.bw * self.k), int(self.bh * self.k)), Image.LANCZOS)

    def _dolphin(self):
        DW, DH = 120, 60
        im = Image.new("RGBA", (DW * SS, DH * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        S = lambda ps: [(px * SS, py * SS) for px, py in ps]
        back, belly = self.P["dolphin"]
        cx, cy = DW / 2, DH / 2
        top, bot = [], []
        for k in range(41):
            u = k / 40
            xx = cx - 42 + 80 * u
            r = 11 * (np.sin(np.pi * min(1, u * 1.15)) ** 0.8) + 1.5
            bow = -3 * np.sin(np.pi * u)
            top.append((xx, cy + bow - r))
            bot.append((xx, cy + bow + r * 0.85))
        d.polygon(S(top + bot[::-1]), fill=back + (255,))
        d.polygon(S([(cx + 30, cy - 1), (cx + 46, cy + 1), (cx + 30, cy + 5)]), fill=back + (255,))
        d.polygon(S([(cx - 6, cy - 12), (cx + 2, cy - 27), (cx + 8, cy - 12)]), fill=back + (255,))
        d.polygon(S([(cx - 40, cy), (cx - 52, cy - 11), (cx - 47, cy), (cx - 52, cy + 10)]), fill=back + (255,))
        d.polygon(S([(cx + 4, cy + 6), (cx - 6, cy + 16), (cx + 12, cy + 8)]), fill=back + (255,))
        d.ellipse(S([(cx - 20, cy + 1), (cx + 28, cy + 9)]), fill=belly + (200,))
        return im.resize((DW * 2, DH * 2), Image.LANCZOS)

    def _swimmer(self, s):
        im = Image.new("RGBA", (self.sbw * SS, self.sbh * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        S = lambda ps: [(px * SS, py * SS) for px, py in ps]
        ink = self.P["boat"][0] + (255,)
        cx, wl, r = self.sbw / 2, self.sbwl, self.swim_r
        sink = 3.5 * np.sin(TAU * self.bob_n * s) + 1.5 * np.sin(TAU * self.bob_n2 * s + 1.0)
        sink += 7.0 * max(0.0, np.sin(TAU * self.dip_n * s)) ** 6                     # a gulp now and then
        sh = wl + 2 + sink                                   # shoulders under water
        self._stick(d, ink, (cx, sh), (cx, wl + 40))
        hy = sh - r - 3
        ring = r + 1.6
        d.ellipse(S([(cx - ring, hy - ring), (cx + ring, hy + ring)]), fill=ink)
        im.alpha_composite(self.swimmer.rotate(float(9.0 * np.sin(TAU * self.bob_n * s + 1.2)), resample=Image.BICUBIC),
                           (int((cx - r) * SS), int((hy - r) * SS)))
        for side in (-1, 1):                                 # both arms up, flailing out of step
            ph = TAU * self.flail_n * s + (0 if side < 0 else np.pi)
            ex, ey = cx + side * (r + 6), sh - 24 + 3 * np.sin(ph)
            ang = np.radians(side * (14 + 26 * np.sin(ph)))
            hx, hy2 = ex + 28 * np.sin(ang), ey - 28 * np.cos(ang)
            self._stick(d, ink, (cx + side * 3, sh), (ex, ey), (hx, hy2))
            d.ellipse(S([(hx - 3.4, hy2 - 3.4), (hx + 3.4, hy2 + 3.4)]), fill=ink)
        foam = (255, 255, 255)
        d.ellipse(S([(cx - 24, wl - 2.5), (cx + 24, wl + 2.5)]), outline=foam + (150,), width=int(1.2 * SS))
        for j in range(6):                                   # splashes
            t = (self.flail_n * s * 0.5 + j / 6) % 1.0
            side = -1 if j % 2 else 1
            px = cx + side * (12 + 26 * t) + (j - 2.5) * 2
            py = wl - 3 - 26 * np.sin(np.pi * t)
            rr = 2.2 * (1 - 0.5 * t)
            d.ellipse(S([(px - rr, py - rr), (px + rr, py + rr)]), fill=foam + (int(230 * (1 - t)),))
        return im.resize((int(self.sbw * 1.45), int(self.sbh * 1.45)), Image.LANCZOS)

    # ---------------------------------------------------------------- placing things
    def edge(self, i, a, xs):
        p1, p2 = self.phases[i]
        p1 = p1 + 0.55 * np.sin(a + i * 0.9)
        p2 = p2 + a * (1 if i % 2 else -1)
        base = 0.50 + i * 0.085 + 0.006 * np.sin(a + i * 1.3)
        a1 = (0.05 + 0.012 * i) * (1 + 0.12 * np.sin(a + i * 2.1))
        f1, f2 = 1.1 + 0.25 * i, 2.3 + 0.4 * i
        return base + a1 * np.sin(TAU * f1 * xs + p1) + 0.025 * np.sin(TAU * f2 * xs + p2)

    @staticmethod
    def blend(img, spr, px, py):
        arr = np.asarray(spr).astype(np.float32)
        h, w = arr.shape[:2]
        x0, y0 = max(px, 0), max(py, 0)
        x1, y1 = min(px + w, img.shape[1]), min(py + h, img.shape[0])
        if x1 <= x0 or y1 <= y0:
            return
        a = arr[y0 - py:y1 - py, x0 - px:x1 - px]
        al = a[..., 3:4] / 255.0
        reg = img[y0:y1, x0:x1]
        reg[:] = reg * (1 - al) + a[..., :3] * al

    def boat_x(self, s):
        # crosses left to right once a loop, from just off one edge to just off the other
        return -self.edge_in + (1 + 2 * self.edge_in) * s

    def boat_band(self, a, s):
        # rides the frontmost wave where it is, so a taller wave in front never buries it
        sx = np.float32(self.boat_x(s))
        return min(range(self.first_band, len(self.P["bands"])), key=lambda j: float(self.edge(j, a, sx)))

    def paste_boat(self, img, a, s, band):
        sx = self.boat_x(s)
        e0, e1 = self.edge(band, a, np.float32(sx - 0.01)), self.edge(band, a, np.float32(sx + 0.01))
        lean = -np.degrees(np.arctan2((e1 - e0) * H, 0.02 * W))
        tilt = float(np.clip(0.6 * lean, -12, 12)) + 1.5 * np.sin(2 * a)
        spr = self._boat(s, a).rotate(tilt, resample=Image.BICUBIC, center=(self.sw / 2, self.wl))
        self.blend(img, spr, int(round(sx * W - self.sw / 2)), int(round((e0 + e1) / 2 * H + 6 - self.wl)))

    def paste_swimmer(self, img, a, s):
        ey = self.edge(self.swim_band, a, np.float32(self.swim_x))
        spr = self._swimmer(s)
        self.blend(img, spr, int(round(self.swim_x * W - spr.width / 2)), int(round(ey * H - self.sbwl * 1.45)))

    def paste_dolphins(self, img, a, s):
        for st, x0, dr in self.leaps:
            u = ((s - st + 0.5) % 1.0 - 0.5) / self.leap_len
            if u < -0.15 or u > 1.15:
                continue
            def at(uu):
                xx = x0 + dr * self.leap_dx * uu
                return xx, self.edge(2, a, np.float32(xx)) - self.leap_high * 4 * uu * (1 - uu)
            (x1, y1), (x2, y2) = at(u - 0.01), at(u + 0.01)
            ang = -np.degrees(np.arctan2((y2 - y1) * H, abs(x2 - x1) * W)) * dr
            spr = (self.dolphin if dr > 0 else self.dolphin_l).rotate(float(ang), resample=Image.BICUBIC, expand=True)
            cx, cy = at(u)
            self.blend(img, spr, int(round(cx * W - spr.width / 2)), int(round(cy * H - spr.height / 2)))

    def frame(self, k):
        s = k / (self.T * self.FPS)
        a = TAU * self.cycles * s
        x, y = self.x, self.y
        img = self.sky.copy()
        jb = self.boat_band(a, s) if self.boat_on else -9
        gx = 0.62 + 0.02 * np.sin(a)                         # the warm glow drifts a touch
        glow = (np.exp(-((y - 0.58) / 0.18) ** 2) * np.exp(-((x - gx) / 0.35) ** 2))[..., None]
        img += glow * (np.array(self.P["bands"][0], np.float32) - img) * 0.35
        sub, ys = img[self.y0:], y[self.y0:]
        for i, col in enumerate(self.P["bands"]):
            col = np.array(col, np.float32)
            d = (ys - self.edge(i, a, x)) * H
            m = np.clip(d / 1.3 + 0.5, 0, 1)[..., None]
            shade = (1.0 - 0.35 * np.clip(d / (H * 0.18), 0, 1))[..., None]
            crest = np.exp(-np.clip(d, 0, None) / (H * 0.012))[..., None] * 0.35
            body = col * shade + (255 - col * shade) * crest
            shadow = np.clip(1 - np.clip(-d, 0, None) / (H * 0.03), 0, 1)[..., None] * (1 - m) * 0.25
            sub *= (1 - shadow)
            sub[:] = sub * (1 - m) + body * m
            # each is drawn just before the wave in front of it, which hides what is under water
            if i == jb - 1:
                self.paste_boat(img, a, s, jb)
            if self.swimmer is not None and i == self.swim_band - 1:
                self.paste_swimmer(img, a, s)
            if self.leaps and i == 1:
                self.paste_dolphins(img, a, s)
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=0.7))
        return np.clip(np.asarray(im).astype(np.float32) + self.grain, 0, 255).astype(np.uint8)


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return shutil.which("ffmpeg")


def main():
    ap = argparse.ArgumentParser(description="Make the moving wave scenes (docs/MAKE-A-SCENE.md).")
    ap.add_argument("--palettes", default="dusk,ocean,dawn", help="which to make, of dusk, ocean and dawn")
    ap.add_argument("--seconds", type=float, default=60, help="the loop's length; the boat crosses once a loop (default 60)")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--out", default=OUT, help="where the files go (default tv-home/web/backgrounds/mine)")
    ap.add_argument("--preview", nargs="?", const=os.path.join(ROOT, "build", "scenes"),
                    help="only write one frame per palette to DIR/waves-PALETTE-preview.jpg (default build/scenes)")
    ap.add_argument("--captain-face", help="a photo for the waving figure on the boat (default: a cartoon face)")
    ap.add_argument("--captain-crop", help="X,Y,SIZE: the square of that photo to use (default: the middle)")
    ap.add_argument("--swimmer-face", help="a photo for the one overboard (default: a cartoon face)")
    ap.add_argument("--swimmer-crop", help="X,Y,SIZE: the square of that photo to use (default: the middle)")
    ap.add_argument("--no-boat", action="store_true")
    ap.add_argument("--no-captain", action="store_true", help="the boat without anyone on it")
    ap.add_argument("--no-swimmer", action="store_true")
    ap.add_argument("--no-dolphins", action="store_true")
    args = ap.parse_args()
    pals = [p.strip() for p in args.palettes.split(",") if p.strip()]
    for p in pals:
        if p not in PALETTES:
            sys.exit(f"unknown palette {p!r}: use dusk, ocean or dawn")
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        for p in pals:
            w = Waves(p, args)
            k = int(w.T * w.FPS * 0.33)                      # the boat a third of the way across
            out = os.path.join(args.preview, f"waves-{p}-preview.jpg")
            Image.fromarray(w.frame(k)).save(out, quality=90)
            print(out)
        return
    ff = ffmpeg_exe()
    if not ff:
        sys.exit("needs ffmpeg: install it, or `pip install imageio-ffmpeg` into the .venv")
    os.makedirs(args.out, exist_ok=True)
    entries = []
    for p in pals:
        w = Waves(p, args)
        sid = "waves" + p
        mp4 = os.path.join(args.out, f"scene-{sid}.mp4")
        still = os.path.join(args.out, f"scene-{sid}-frame0.png")
        Image.fromarray(w.frame(0)).save(still)
        n = int(round(w.T * w.FPS))
        cmd = [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
               "-r", str(w.FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high",
               "-level", "4.1", "-pix_fmt", "yuv420p", "-crf", "18", "-tune", "film", "-maxrate", "12M",
               "-bufsize", "24M", "-g", str(w.FPS * 4), "-movflags", "+faststart", mp4]
        enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for k in range(n):
            enc.stdin.write(w.frame(k).tobytes())
            if k % (w.FPS * 2) == 0:
                print(f"{p}: frame {k} of {n}", flush=True)
        enc.stdin.close()
        if enc.wait() != 0:
            sys.exit(f"ffmpeg failed on {p}")
        # the photo under the clip and its glass copy, from the first frame
        subprocess.run([sys.executable, os.path.join(HERE, "make-scene.py"), still, sid, "--out", args.out],
                       check=True, stdout=subprocess.DEVNULL)
        os.remove(still)
        entries.append('{ "id": "%s", "name": "%s", "clock": { "x": "centre", "y": 0.14, "size": 0.37 }, '
                       '"date": "above", "text": "%s", "video": true, "when": "%s" }'
                       % (sid, NAMES[p], PALETTES[p]["text"], PALETTES[p]["when"]))
        print(f"{p}: {mp4}")
    print("\nAdd to home.my_scenes in config.json (and the ids to home.scenes), then rebuild the app:")
    for e in entries:
        print("  " + e + ",")


if __name__ == "__main__":
    main()
