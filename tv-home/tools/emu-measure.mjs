#!/usr/bin/env node
// Measure how hard a home screen works on an Android TV emulator, the same way every time, so two homes (or
// two looks of one screen) can be compared. Phase 4 items 23 and 23b (coord/SPEED-HOME-MEASURE.md):
//   23   the TV's own home (Google TV's launcherx, Android TV's tvlauncher) against Couch TV's home, for the
//        speed bar's second bar
//   23b  Couch TV's Settings screen with its frosted glass and with solid panels
// The owner, 28 Nov 2026: emulators only, never a real TV. Run the emulator with -gpu swiftshader_indirect so every
// frame is drawn by the CPU, the way a small TV chip struggles, instead of by the computer's graphics card.
//
//   node emu-measure.mjs <adb> <serial> <package> [--runs 3] [--keys RIGHT*8,LEFT*8,DOWN*2,UP*2] [--rounds 3]
//        [--procs <name part>,...] [--settle 2500]
// It resets the frame counters, presses the keys (input keyevent, 300 ms apart) round after round, then reads
// dumpsys gfxinfo <package> (frames, janky %, 50th, 90th and 99th percentile frame time) and the memory
// (total PSS of the package's processes, plus any process whose name holds one of --procs, such as the
// WebView's sandboxed renderer). It prints one JSON line per run and a last line with the medians.
// It changes nothing on the emulator but the screen the keys move through.
import { execFileSync } from "node:child_process";

const [adb, serial, pkg, ...rest] = process.argv.slice(2);
if (!adb || !serial || !pkg) { console.error("usage: emu-measure.mjs <adb> <serial> <package> [--runs n] [--keys K*n,...] [--rounds n] [--procs a,b] [--settle ms]"); process.exit(2); }
const opt = (k, d) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : d; };
const RUNS = +opt("runs", 3), ROUNDS = +opt("rounds", 3), SETTLE = +opt("settle", 2500);
const KEYS = opt("keys", "RIGHT*8,LEFT*8,DOWN*2,UP*2").split(",").flatMap((s) => { const [k, n] = s.split("*"); return Array(+(n || 1)).fill(k); });
const PROCS = opt("procs", "").split(",").filter(Boolean);
const CODE = { UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22, CENTER: 23, BACK: 4, SETTINGS: 176 };

const sh = (cmd) => execFileSync(adb, ["-s", serial, "shell", cmd], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);
const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function gfx() {
  const t = sh("dumpsys gfxinfo " + pkg);
  const num = (re) => { const m = re.exec(t); return m ? +m[1] : null; };
  return {
    frames: num(/Total frames rendered:\s*(\d+)/),
    janky: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p50: num(/50th percentile:\s*(\d+)ms/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p99: num(/99th percentile:\s*(\d+)ms/),
  };
}
// total PSS in MB of the package's own processes and of any process whose name holds one of PROCS
function pssMb() {
  const ps = sh("ps -A -o PID,NAME").split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((x) => x.length >= 2);
  const pids = ps.filter(([, name]) => name === pkg || name.startsWith(pkg + ":") || PROCS.some((p) => name.includes(p))).map(([pid]) => pid);
  let kb = 0;
  for (const pid of pids) { const m = /TOTAL PSS:\s*(\d+)/.exec(sh("dumpsys meminfo " + pid)) || /TOTAL\s+(\d+)/.exec(sh("dumpsys meminfo " + pid)); if (m) kb += +m[1]; }
  return { pss: Math.round(kb / 102.4) / 10, procs: pids.length };
}

const out = [];
for (let r = 0; r < RUNS; r++) {
  sh("dumpsys gfxinfo " + pkg + " reset");
  for (let round = 0; round < ROUNDS; round++) for (const k of KEYS) { sh("input keyevent " + CODE[k]); sleep(300); }
  sleep(SETTLE);
  const g = gfx(), m = pssMb();
  const one = Object.assign({ run: r + 1 }, g, m);
  out.push(one);
  console.log(JSON.stringify(one));
}
const med = { median: true };
for (const k of ["frames", "janky", "p50", "p90", "p99", "pss"]) med[k] = median(out.map((x) => x[k]));
console.log(JSON.stringify(med));
