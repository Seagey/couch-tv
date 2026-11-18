// The four built in ambient loops (rain on glass, fireplace, ocean at dusk, clouds over the hills),
// drawn here from code, pixel by pixel: no footage, no photos, no AI model. Everything in them is
// made by this file, so they carry couch-tv's own licence (see tv-home/web/backgrounds/CREDITS.md).
//
// Each scene is a function of the frame's place in the loop (t from 0 to 1). Everything that moves
// comes back to where it started at t = 1, so the clip loops with no seam:
//  - noise that drifts uses two layers half a loop apart, each faded out while it jumps back
//    (the "flow map" way of making endless motion loop);
//  - waves, flicker and sliding drops move by whole turns of a sine, or whole passes of the screen.
// make-loops.mjs runs these in worker threads and pipes the frames to ffmpeg.

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const frac = (x) => x - Math.floor(x);

// a seeded random, so every worker draws the same drops and lights
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// value noise on a 256 lattice with a quintic fade, and fbm from it
const PERM = new Uint8Array(512), VAL = new Float32Array(256);
{ const r = rng(1234); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; for (let i = 0; i < 256; i++) VAL[i] = r(); }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = VAL[PERM[PERM[X] + Y]], b = VAL[PERM[PERM[X + 1] + Y]], c = VAL[PERM[PERM[X] + Y + 1]], d = VAL[PERM[PERM[X + 1] + Y + 1]];
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct) {
  let s = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise2(x, y); n += amp; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= 0.5; }
  return s / n;
}
// two layers of drifting noise half a loop apart; returns noise with the contrast of one layer
function flow(x, y, t, dx, dy, oct) {
  const pa = t, pb = frac(t + 0.5);
  const wa = Math.sin(Math.PI * pa) ** 2, wb = Math.sin(Math.PI * pb) ** 2;
  const a = fbm(x + dx * pa, y + dy * pa, oct) - 0.5, b = fbm(x + dx * pb + 31.7, y + dy * pb + 11.3, oct) - 0.5;
  return 0.5 + (wa * a + wb * b) / Math.sqrt(wa * wa + wb * wb);
}
function dither(x, y) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5) * 1.4; }
function put(out, i, r, g, b, x, y) {
  const d = dither(x, y);
  out[i] = clamp(r * 255 + d, 0, 255); out[i + 1] = clamp(g * 255 + d, 0, 255); out[i + 2] = clamp(b * 255 + d, 0, 255);
}

// ---------------------------------------------------------------- clouds over the hills
// Late afternoon: soft clouds drift left across a blue sky, two ridges of hills stand still in front.
// The hills are also written alone with a see through sky (loop-clouds-fg.png), so a clock can stand
// behind them over the moving clouds (the TV's depth layer).
function ridges(u) {
  const far = 0.655 + 0.055 * (fbm(u * 1.4 + 3, 0.5, 4) - 0.5) * 2 + 0.018 * Math.sin(u * 3.1 + 1.2);
  const near = 0.775 + 0.07 * (fbm(u * 2.2 + 41, 7.5, 5) - 0.5) * 2 + 0.03 * Math.sin(u * 1.7 + 4);
  return { far, near };
}
function hillColour(u, v, rd, H) {
  // the near ridge dark green-blue, the far one lighter in the haze; antialiased edges
  const aNear = clamp((v - rd.near) * H + 0.5), aFar = clamp((v - rd.far) * H + 0.5);
  if (aFar <= 0) return null;
  const k = clamp((v - rd.far) / 0.25);
  let r = mix(0.40, 0.30, k), g = mix(0.43, 0.35, k), b = mix(0.52, 0.44, k);
  if (aNear > 0) {
    const kn = clamp((v - rd.near) / 0.22);
    const nr = mix(0.13, 0.07, kn), ng = mix(0.17, 0.10, kn), nb = mix(0.19, 0.12, kn);
    r = mix(r, nr, aNear); g = mix(g, ng, aNear); b = mix(b, nb, aNear);
  }
  return [r, g, b, aFar];
}
const clouds = {
  id: "clouds",
  frame(t, W, H, out) {
    const A = W / H;
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / H, i = (y * W + x) * 3;
        // the sky: deep blue up high, warm and pale at the hills, a glow where the sun is (right)
        const k = smooth(0.0, 0.78, v) ** 1.3;
        let r = mix(0.20, 0.93, k), g = mix(0.38, 0.76, k), b = mix(0.66, 0.62, k);
        const sg = Math.exp(-(((u - A * 0.86) ** 2) * 3.5 + ((v - 0.58) ** 2) * 9));
        r += 0.22 * sg; g += 0.13 * sg; b += 0.02 * sg;
        const rd = ridges(u), hill = hillColour(u, v, rd, H);
        if (!hill || hill[3] < 1) {
          // clouds: flatter and smaller towards the hills (a little perspective)
          const depth = 0.35 + (0.8 - Math.min(v, 0.78)) * 1.6;
          const qx = u * 1.25 / depth * 1.4, qy = v * 3.4 / depth;
          const n = flow(qx, qy, t, -0.55, 0.0, 6);
          const cover = smooth(0.45, 0.70, n) * smooth(0.80, 0.30, v);
          if (cover > 0) {
            const n2 = flow(qx + 0.05, qy - 0.07, t, -0.55, 0.0, 3);
            const lit = clamp(0.55 + (n - n2) * 5.5);
            const cr = mix(0.62, 1.0, lit), cg = mix(0.62, 0.95, lit), cb = mix(0.72, 0.9, lit);
            const warm = smooth(0.3, 0.75, v) * 0.18;
            r = mix(r, cr + warm, cover * 0.95); g = mix(g, cg + warm * 0.5, cover * 0.95); b = mix(b, cb - warm * 0.3, cover * 0.95);
          }
        }
        if (hill) { r = mix(r, hill[0], hill[3]); g = mix(g, hill[1], hill[3]); b = mix(b, hill[2], hill[3]); }
        put(out, i, r, g, b, x, y);
      }
    }
  },
  // the hills alone, sky see through (RGBA): the depth layer's cut out
  fg(W, H) {
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / H, v = y / H, i = (y * W + x) * 4;
      const hill = hillColour(u, v, ridges(u), H);
      if (!hill) continue;
      out[i] = clamp(hill[0] * 255, 0, 255); out[i + 1] = clamp(hill[1] * 255, 0, 255); out[i + 2] = clamp(hill[2] * 255, 0, 255); out[i + 3] = clamp(hill[3] * 255, 0, 255);
    }
    return out;
  }
};

// ---------------------------------------------------------------- fireplace
// A low fire on two logs in a dark brick hearth: flames rise and lick, embers glow in the logs'
// cracks, and the firelight on the back wall breathes with the flames.
const fire = {
  id: "fire",
  frame(t, W, H, out) {
    const A = W / H, cx = A / 2;
    const flick = 1 + 0.07 * Math.sin(TAU * (3 * t)) + 0.05 * Math.sin(TAU * (7 * t + 0.3)) + 0.03 * Math.sin(TAU * (13 * t + 0.6));
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / H, i = (y * W + x) * 3;
        // the hearth: dark brick courses, lit warm from the fire
        const row = Math.floor(v * 18), bx = u * 9 + (row % 2) * 0.5;
        const mortar = Math.min(smooth(0.0, 0.06, frac(v * 18)), smooth(0.0, 0.03, frac(bx)) * smooth(1.0, 0.97, frac(bx)));
        const brick = 0.55 + 0.45 * mortar + (noise2(u * 40, v * 40) - 0.5) * 0.25 + (noise2(Math.floor(bx) * 3.1, row * 1.7) - 0.5) * 0.3;
        const glow = Math.exp(-(((u - cx) ** 2) * 2.2 + ((v - 0.78) ** 2) * 3.2)) * flick;
        let r = 0.035 + brick * (0.05 + 0.42 * glow), g = 0.022 + brick * (0.03 + 0.17 * glow), b = 0.02 + brick * (0.02 + 0.05 * glow);
        // the floor of the hearth
        if (v > 0.93) { const f = 0.5 + 0.5 * glow; r = 0.05 * f + 0.06 * glow; g = 0.035 * f + 0.025 * glow; b = 0.03 * f; }
        // flames: a few tongues over the logs, rising noise cut off with height
        const hb = 0.85 - v;   // height above the top of the logs
        const du = u - cx;
        if (hb > -0.06 && hb < 0.6 && Math.abs(du) < 0.62) {
          // where the flames stand: one tall in the middle, smaller ones either side
          const tongues = Math.exp(-(du ** 2) / 0.018) * 0.85 + Math.exp(-((du + 0.19) ** 2) / 0.006) * 0.5 +
            Math.exp(-((du - 0.17) ** 2) / 0.007) * 0.55 + Math.exp(-((du - 0.36) ** 2) / 0.004) * 0.3 + Math.exp(-((du + 0.37) ** 2) / 0.004) * 0.28;
          const n = flow(u * 4.6, v * 3.2, t, 0, 9.0, 5);
          const n2 = flow(u * 10.0 + 5, v * 7.0, t, 0, 16.0, 3);
          let f = tongues * 1.05 - hb * (2.9 - 1.2 * tongues) + (n - 0.5) * 1.25 + (n2 - 0.5) * 0.45;
          f *= smooth(-0.06, 0.0, hb) * smooth(0.6, 0.45, Math.abs(du)) * flick;
          const I = clamp(f * 1.6);
          if (I > 0) {
            r += 1.0 * I ** 0.7; g += 0.62 * I ** 1.6; b += 0.22 * I ** 3.5;
          }
        }
        // two logs, crossed low, with rounded ends and embers in their cracks
        const log = (cy, slope, half, len) => {
          const d = Math.abs((v - cy) - du * slope), e = Math.abs(du) - len;
          const dist = e > 0 ? Math.hypot(e, d) : d;   // a capsule
          return clamp((half - dist) * H * 0.8);
        };
        const a1 = log(0.885, 0.06, 0.042, 0.56), a2 = log(0.905, -0.05, 0.038, 0.52), la = Math.max(a1, a2);
        if (la > 0) {
          const bark = 0.5 + (fbm(u * 30, v * 8, 3) - 0.5) * 0.9;
          let lr = 0.06 * bark, lg = 0.035 * bark, lb = 0.025 * bark;
          const crack = smooth(0.6, 0.7, fbm(u * 14 + 3, v * 26, 3));
          const ember = crack * (0.6 + 0.4 * Math.sin(TAU * (2 * t + fbm(u * 6, v * 6, 2) * 3)));
          lr += 0.85 * ember; lg += 0.26 * ember; lb += 0.04 * ember;
          // the top of each log catches the light of the flames
          const rim = smooth(0.02, 0.0, Math.min(Math.abs(v - 0.885 + du * -0.06 + 0.042), Math.abs(v - 0.905 - du * 0.05 + 0.038))) * 0.25;
          lr += (0.08 + rim) * flick; lg += (0.03 + rim * 0.45) * flick;
          r = mix(r, lr, la); g = mix(g, lg, la); b = mix(b, lb, la);
        }
        put(out, i, r, g, b, x, y);
      }
    }
  }
};

// ---------------------------------------------------------------- ocean at dusk
// A calm sea under a low sun: long swells and small chop roll in, the sun's path glitters on the
// water. Each wave turns a whole number of times per loop.
function oceanWaves() {
  const r = rng(77), out = [];
  for (let k = 0; k < 14; k++) {
    const len = 0.6 * Math.pow(0.72, k) * 9;     // wavelength, in the camera's units
    const ang = (r() - 0.5) * 1.1 + (k % 3 === 0 ? 0.25 : -0.15);
    const kk = TAU / len;
    out.push({ kx: Math.sin(ang) * kk, kz: Math.cos(ang) * kk, a: len * 0.022, len, turns: Math.max(1, Math.round(Math.sqrt(kk) * 2.2)), ph: r() * TAU });
  }
  return out;
}
const WAVES = oceanWaves();
const ocean = {
  id: "ocean",
  frame(t, W, H, out) {
    const A = W / H, cu = A / 2, hv = 0.47, su = A * 0.6, sv = 0.405;
    const sky = (v) => {
      const e = clamp((hv - v) / hv);
      const k = 1 - Math.exp(-e * 3.2);
      return [mix(1.0, 0.10, k), mix(0.58, 0.15, k), mix(0.36, 0.33, k)];
    };
    const sd = (() => { const x = su - cu, y = hv - sv, n = Math.hypot(x, y, 1); return [x / n, y / n, 1 / n]; })();
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / H, i = (y * W + x) * 3;
        let r, g, b;
        if (v < hv) {
          [r, g, b] = sky(v);
          // a few thin bands of cloud, still, lit from below
          const band = smooth(0.55, 0.8, fbm(u * 1.6, v * 18, 5)) * smooth(0.12, 0.3, v) * smooth(hv, hv - 0.06, v);
          r = mix(r, 0.98, band * 0.5); g = mix(g, 0.62, band * 0.5); b = mix(b, 0.5, band * 0.5);
          // the sun and its glow
          const d = Math.hypot(u - su, (v - sv) * 1.0);
          const disc = smooth(0.034, 0.03, d), gl = Math.exp(-d * 9) * 0.55 + Math.exp(-d * 30) * 0.4;
          r += gl + disc; g += gl * 0.7 + disc * 0.9; b += gl * 0.35 + disc * 0.7;
        } else {
          const dv = v - hv + 0.5 / H, camH = 1.0;
          const z = camH / dv, wx = (u - cu) * z, foot = z * z / camH / H;
          let hx = 0, hz = 0;
          for (const w of WAVES) {
            const fade = smooth(2.5, 1.0, foot / w.len * 6);   // waves smaller than a pixel fade out
            if (fade <= 0) continue;
            const ph = w.kx * wx + w.kz * z - TAU * w.turns * t + w.ph;
            const c = Math.cos(ph) * w.a * fade;
            hx += c * w.kx; hz += c * w.kz;
          }
          // normal, view ray, reflection
          let nx = -hx, ny = 1, nz = -hz; const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
          let dx = u - cu, dy = -dv, dz = 1; const dn = Math.hypot(dx, dy, dz); dx /= dn; dy /= dn; dz /= dn;
          const dd = dx * nx + dy * ny + dz * nz;
          let rx = dx - 2 * dd * nx, ry = dy - 2 * dd * ny, rz = dz - 2 * dd * nz;
          ry = Math.abs(ry);
          const sk = sky(hv - ry / Math.hypot(rx, rz) * 1.0);
          const fres = 0.03 + 0.97 * Math.pow(1 - Math.max(-dd, 0), 5);
          r = mix(0.02, sk[0], fres); g = mix(0.05, sk[1], fres); b = mix(0.09, sk[2], fres);
          // glitter on the sun's path
          const sp = Math.max(0, (rx * sd[0] + ry * sd[1] + rz * sd[2]) / Math.hypot(rx, ry, rz));
          const spec = Math.pow(sp, 900) * 7 + Math.pow(sp, 90) * 0.35;
          r += spec; g += spec * 0.78; b += spec * 0.5;
          // haze into the horizon
          const hz2 = Math.exp(-dv * 26);
          const hzc = sky(hv - 0.002);
          r = mix(r, hzc[0] * 0.95, hz2 * 0.8); g = mix(g, hzc[1] * 0.95, hz2 * 0.8); b = mix(b, hzc[2] * 0.95, hz2 * 0.8);
        }
        put(out, i, r, g, b, x, y);
      }
    }
  }
};

// ---------------------------------------------------------------- rain on glass
// A window at night: city lights out of focus behind fogged glass, small beads of rain, new drops
// landing, and bigger drops running down in fits and starts, clearing a trail behind them.
function rainSetup(W, H) {
  const r = rng(2026);
  const sharp = new Float32Array(W * H * 3);
  const PAL = [[1.0, 0.62, 0.25], [1.0, 0.82, 0.55], [0.35, 0.75, 0.95], [1.0, 0.3, 0.22], [0.85, 0.9, 1.0], [1.0, 0.7, 0.35]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H, i = (y * W + x) * 3;
    sharp[i] = mix(0.02, 0.10, v ** 1.5); sharp[i + 1] = mix(0.03, 0.06, v ** 1.5); sharp[i + 2] = mix(0.08, 0.10, v ** 1.5);
  }
  for (let k = 0; k < 90; k++) {
    const cx = r() * W, cy = H * (0.25 + 0.75 * Math.pow(r(), 0.7)), rad = H * (0.015 + 0.05 * r() ** 1.5);
    const c = PAL[Math.floor(r() * PAL.length)], I = 0.12 + 0.4 * r() ** 2;
    const x0 = Math.max(0, Math.floor(cx - rad - 2)), x1 = Math.min(W - 1, Math.ceil(cx + rad + 2));
    const y0 = Math.max(0, Math.floor(cy - rad - 2)), y1 = Math.min(H - 1, Math.ceil(cy + rad + 2));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d > 1.02) continue;
      const a = smooth(1.02, 0.9, d) * (0.8 + 0.25 * smooth(0.6, 0.95, d)) * I, i = (y * W + x) * 3;
      sharp[i] += c[0] * a; sharp[i + 1] += c[1] * a; sharp[i + 2] += c[2] * a;
    }
  }
  // the fogged glass: the same lights blurred (three box blurs) and greyed
  const blur = (src, rad) => {
    const tmp = new Float32Array(src.length), dst = new Float32Array(src.length);
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) { let s = 0; for (let x = -rad; x <= rad; x++) s += src[(y * W + clamp(x, 0, W - 1)) * 3 + c]; for (let x = 0; x < W; x++) { tmp[(y * W + x) * 3 + c] = s / (2 * rad + 1); s += src[(y * W + Math.min(W - 1, x + rad + 1)) * 3 + c] - src[(y * W + Math.max(0, x - rad)) * 3 + c]; } }
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let y = -rad; y <= rad; y++) s += tmp[(clamp(y, 0, H - 1) * W + x) * 3 + c]; for (let y = 0; y < H; y++) { dst[(y * W + x) * 3 + c] = s / (2 * rad + 1); s += tmp[(Math.min(H - 1, y + rad + 1) * W + x) * 3 + c] - tmp[(Math.max(0, y - rad) * W + x) * 3 + c]; } }
    return dst;
  };
  let fog = blur(blur(blur(sharp, 9), 9), 9);
  for (let i = 0; i < fog.length; i += 3) { fog[i] = mix(fog[i], 0.09, 0.22) + 0.01; fog[i + 1] = mix(fog[i + 1], 0.1, 0.22) + 0.012; fog[i + 2] = mix(fog[i + 2], 0.13, 0.22) + 0.016; }
  const soft = blur(sharp, 2);
  const beads = [];
  for (let k = 0; k < 2600; k++) beads.push({ x: r() * W, y: r() * H, r: 1.2 + 4.2 * r() ** 3, ph: r(), lives: r() < 0.22 });
  const runs = [];
  for (let k = 0; k < 20; k++) runs.push({ x: (k + r() * 0.8) / 20 * W, y0: r(), r: 6 + 9 * r(), passes: r() < 0.3 ? 2 : 1, m: 2 + Math.floor(r() * 3), a: 0.75 + 0.2 * r(), ph: r(), wob: r() * 4, wf: 1 + Math.floor(r() * 3) });
  return { sharp: soft, fog, beads, runs };
}
let RAIN = null;
function lens(out, W, H, S, cx, cy, rad, alpha, stretch) {
  const x0 = Math.max(0, Math.floor(cx - rad - 1)), x1 = Math.min(W - 1, Math.ceil(cx + rad + 1));
  const ry = rad * stretch, y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ndx = (x - cx) / rad, ndy = (y - cy) / ry, d = Math.hypot(ndx, ndy);
    if (d >= 1) continue;
    const aa = clamp((1 - d) * rad) * alpha;
    // the drop is a small lens: it shows the lights behind it, upside down and sharper
    // (a wide view, so a drop gathers light from the lights below it)
    const sx = clamp(Math.round(cx - ndx * Math.max(rad * 4, 26)), 0, W - 1), sy = clamp(Math.round(cy + H * 0.06 - ndy * Math.max(ry * 4, 26)), 0, H - 1), si = (sy * W + sx) * 3;
    const shade = 1.15 + 0.2 * (1 - d) - 0.4 * smooth(0.75, 1.0, d);
    const hl = 0.5 * Math.exp(-((ndx + 0.32) ** 2 + (ndy + 0.38) ** 2) * 38) + 0.12 * smooth(0.55, 0.9, d) * smooth(0.1, 0.7, ndy);
    const i = (y * W + x) * 3;
    out[i] = mix(out[i], S[si] * shade + 0.02 + hl, aa); out[i + 1] = mix(out[i + 1], S[si + 1] * shade + 0.025 + hl, aa); out[i + 2] = mix(out[i + 2], S[si + 2] * shade + 0.035 + hl * 1.05, aa);
  }
}
const rain = {
  id: "rain",
  frame(t, W, H, out8) {
    if (!RAIN || RAIN.W !== W) RAIN = Object.assign(rainSetup(W, H), { W });
    const { sharp, fog, beads, runs } = RAIN;
    const f = Float32Array.from(fog);
    const span = H * 1.3, margin = H * 0.15;
    // the trails: glass wiped clear behind each running drop, fogging over again further up
    const trail = [];
    for (const d of runs) {
      const p = frac(d.y0 + d.passes * (t + d.a * Math.sin(TAU * (d.m * t + d.ph)) / (TAU * d.m)));
      const cy = p * span - margin, cx = d.x + d.wob * Math.sin(TAU * (d.wf * t + d.ph));
      trail.push({ d, cx, cy });
      for (const off of [0, span]) {
        const top = cy - off - H * 0.22, bot = cy - off;
        for (let y = Math.max(0, Math.floor(top)); y <= Math.min(H - 1, Math.floor(bot)); y++) {
          const k = (bot - y) / (bot - top), w = d.r * 0.45 * (1 - k * 0.5);
          const xs = cx + d.wob * 0.6 * Math.sin(y / 23 + d.ph * 6);
          for (let x = Math.max(0, Math.floor(xs - w - 1)); x <= Math.min(W - 1, Math.ceil(xs + w + 1)); x++) {
            const a = clamp(w + 0.5 - Math.abs(x - xs)) * (1 - k) * 0.5, i = (y * W + x) * 3;
            // wiped glass: the lights sharper, and a faint wet sheen
            f[i] = mix(f[i], sharp[i] * 1.2 + 0.02, a); f[i + 1] = mix(f[i + 1], sharp[i + 1] * 1.2 + 0.025, a); f[i + 2] = mix(f[i + 2], sharp[i + 2] * 1.2 + 0.035, a);
          }
        }
      }
    }
    // beads, some of them landing and drying again through the loop
    for (const b of beads) {
      let a = 1;
      if (b.lives) { const life = frac(t - b.ph); a = smooth(0, 0.012, life) * (1 - smooth(0.62, 0.8, life)); }
      if (a > 0) lens(f, W, H, sharp, b.x, b.y, b.r, a * 0.95, 1.0);
    }
    // the running drops themselves, a little longer than wide, with a small one riding behind
    for (const { d, cx, cy } of trail) for (const off of [0, span]) {
      lens(f, W, H, sharp, cx, cy - off, d.r, 1, 1.18);
      lens(f, W, H, sharp, cx + d.wob * 0.3, cy - off - d.r * 1.9, d.r * 0.38, 0.9, 1.1);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; put(out8, i, f[i], f[i + 1], f[i + 2], x, y); }
  }
};

export const SCENES = { rain, fire, ocean, clouds };
