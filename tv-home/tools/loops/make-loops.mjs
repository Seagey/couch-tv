#!/usr/bin/env node
// Makes the built in ambient loops for design backgrounds (tv-home/web/backgrounds/loop-*.mp4, their
// still pictures loop-*.jpg, and the hills cut out loop-clouds-fg.png). Drawn from code in
// loop-scenes.mjs, so they are couch-tv's own: no footage, no stock, no AI model.
//
//   node tv-home/tools/loops/make-loops.mjs [--out <folder>] [--only rain,fire] [--seconds 10]
//   node tv-home/tools/loops/make-loops.mjs --still <scene> <frame> <file.png>   (one frame, to look at)
//
// Encoding a loop is heavy: run it through the MacBook wrapper (see the global CLAUDE.md):
//   node ".../.claude/scripts/render-on-macbook.mjs" tv-home/tools/loops -- node make-loops.mjs
// then copy out/* into tv-home/web/backgrounds/.
//
// What they are made to be (the TV's own limits are in tv-home/web/bg-video.js): 1280x720, 24 frames
// a second, H.264 Main 3.1, yuv420p, no sound, the index at the front (faststart), a key frame every
// 2 s, at most 2.2 Mbit/s, so each 10 s loop is about 1 to 3 MB and plays on every Everyday TV.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { SCENES } from "./loop-scenes.mjs";

const W = 1280, H = 720, FPS = 24;

if (!isMainThread) {
  parentPort.on("message", ({ scene, frame, frames }) => {
    const out = new Uint8ClampedArray(W * H * 3);
    SCENES[scene].frame(frame / frames, W, H, out);
    parentPort.postMessage({ frame, buf: out.buffer }, [out.buffer]);
  });
} else {
  await main();
}

function png(rgbaOrRgb, w, h, channels) {
  const raw = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * channels + 1)] = 0; Buffer.from(rgbaOrRgb.buffer, rgbaOrRgb.byteOffset + y * w * channels, w * channels).copy(raw, y * (w * channels + 1) + 1); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function run(cmd, args, input) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err += d; });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(cmd + " failed: " + err.slice(-800)))));
    if (input) { p.stdin.on("error", () => {}); input(p.stdin); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (args[0] === "--still") {
    const [, scene, frame, file] = args;
    const out = new Uint8ClampedArray(W * H * 3);
    SCENES[scene].frame(Number(frame) / (FPS * 10), W, H, out);
    fs.writeFileSync(file, png(out, W, H, 3));
    console.log("wrote", file);
    return;
  }
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const outDir = path.resolve(opt("--out", path.join(here, "out")));
  const only = opt("--only", Object.keys(SCENES).join(",")).split(",");
  const seconds = Number(opt("--seconds", 10));
  const frames = Math.round(seconds * FPS);
  fs.mkdirSync(outDir, { recursive: true });
  const n = Math.max(1, Math.min(os.cpus().length - 1, 16));
  const workers = Array.from({ length: n }, () => new Worker(fileURLToPath(import.meta.url)));
  console.log(`${n} workers, ${frames} frames a loop, ${W}x${H} at ${FPS} fps`);

  for (const scene of only) {
    const t0 = Date.now();
    const mp4 = path.join(outDir, `loop-${scene}.mp4`);
    let first = null;
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-tune", "film", "-crf", "24", "-maxrate", "2200k", "-bufsize", "4400k",
      "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p", "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-sc_threshold", "0",
      "-map_metadata", "-1", "-movflags", "+faststart", "-an", "-tag:v", "avc1", mp4], async (stdin) => {
      // frames go out in order; the workers draw ahead of the encoder, at most 2 each
      const done = new Map(); let next = 0, asked = 0, busy = 0;
      await new Promise((resolve) => {
        const ask = (w) => { if (asked >= frames) return; busy++; w.postMessage({ scene, frame: asked++, frames }); };
        const flush = () => {
          while (done.has(next)) {
            const b = Buffer.from(done.get(next)); done.delete(next);
            if (next === 0) first = Buffer.from(b);
            stdin.write(b); next++;
          }
          if (next >= frames) { stdin.end(); resolve(); }
        };
        workers.forEach((w) => {
          w.removeAllListeners("message");
          w.on("message", ({ frame, buf }) => { busy--; done.set(frame, buf); flush(); ask(w); });
          ask(w); ask(w);
        });
      });
    });
    // the still picture: the loop's first frame, shown before the video plays and on slow TVs
    const jpg = path.join(outDir, `loop-${scene}.jpg`);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "-", "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", jpg], (stdin) => stdin.end(first));
    if (SCENES[scene].fg) fs.writeFileSync(path.join(outDir, `loop-${scene}-fg.png`), png(SCENES[scene].fg(W, H), W, H, 4));
    const kb = (f) => Math.round(fs.statSync(f).size / 1024);
    console.log(`${scene}: ${kb(mp4)} KB video, ${kb(jpg)} KB still, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  workers.forEach((w) => w.terminate());
}
