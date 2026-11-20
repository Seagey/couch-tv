// g01 (31 people, "laggy, slow, stutters", #197, #213): what moving along the Night dock costs, measured in a real
// browser with the CPU slowed 6 times (Chrome's own throttle), from a trace of the work each frame takes:
//   main: the page's own thread per arrow press (script, style, layout, paint and commit),
//   commit: handing each frame's layers to the compositor, per press,
//   draw: compositing the frame (Display::DrawAndSwap; in software here, the GPU's job on a TV), per press.
// It checks the two cuts this branch made and that Lighter home is the light home it says:
//  1. the weather canvas and the lighting tint are not in the page unless one is in use (they sat empty over the
//     scenes, and with Glass panels on the panels and tiles above them got layers of their own): with Glass panels
//     on the commit falls by more than half and the main thread by more than 15%;
//  2. the people and quick button panels at the top keep their tint but drop the live blur redrawn on every frame
//     the dock moves: with Glass panels on the draw falls by a fifth or more (a few per cent with them off);
//  3. Lighter home, which a slow TV now turns on by itself at 4 GB too: under a third of the default home's draw.
// The numbers depend on the computer, so the checks compare runs on the same one; each figure is the median of
// three runs after a warm up. docs/PERFORMANCE.md has the figures from one desktop Mac.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_lag_perf_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) {
  try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright-core").chromium; }
  catch (e2) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
}
const RATE = +(process.env.COUCHTV_THROTTLE || 6), RUNS = 3, PRESSES = 16;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running lag perf browser tests (CPU throttle " + RATE + "x)...");

const browser = await chromium.launch();
const errors = [];
async function once(q, css) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1"); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1" + q);
  await page.waitForFunction(() => document.querySelector("#grid .app"));
  await page.waitForTimeout(5000);
  if (css) await page.addStyleTag({ content: css });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const m0 = await metric();
  await browser.startTracing(page, { categories: ["cc", "viz", "gpu", "benchmark", "toplevel", "blink", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame"] });
  for (let i = 0; i < PRESSES; i++) { await page.keyboard.press(i < PRESSES / 2 ? "ArrowRight" : "ArrowLeft"); await page.waitForTimeout(220); }
  const buf = await browser.stopTracing();
  const m1 = await metric();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const state = await page.evaluate(() => ({ lighter: document.documentElement.classList.contains("lighter"),
    layers: ["weather-canvas", "ambient-lighting"].map((id) => getComputedStyle(document.getElementById(id)).display) }));
  await page.close();
  const raw = JSON.parse(buf.toString()), ev = raw.traceEvents || raw, sum = {};
  for (const e of ev) if (e.ph === "X" && e.dur) sum[e.name] = (sum[e.name] || 0) + e.dur / 1000;
  return { main: (m1.TaskDuration - m0.TaskDuration) * 1000 / PRESSES, commit: (sum.Commit || 0) / PRESSES, draw: (sum["Display::DrawAndSwap"] || 0) / PRESSES, state };
}
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
async function measure(name, q, css) {
  const r = [];
  for (let i = 0; i < RUNS; i++) r.push(await once(q, css));
  const out = { main: +med(r.map((x) => x.main)).toFixed(1), commit: +med(r.map((x) => x.commit)).toFixed(1), draw: +med(r.map((x) => x.draw)).toFixed(1), state: r[0].state };
  console.log("  " + name.padEnd(44) + " main " + out.main + " ms, commit " + out.commit + " ms, draw " + out.draw + " ms per press");
  return out;
}
await once("&lighter=off", "");   // warm up (the first page of a browser is slower)

// Glass panels on (Home settings, Look, Glass panels), where both cuts show; the cuts undone, as on integrate-0.13.9
const GLASS = "&look=night&lighter=off&glass=on";
const UNDO_1 = "#weather-canvas, #ambient-lighting { display: block !important; }";   // ids: they outrank the new rule
const UNDO_2 = "html.glass.theme-night .people:not(.focus), html.glass.theme-night .qbtn:not(.focus) { background: var(--glass-tint) !important; -webkit-backdrop-filter: var(--glass-blur) !important; backdrop-filter: var(--glass-blur) !important; }";
const before = await measure("Glass on, as on integrate-0.13.9", GLASS, UNDO_1 + UNDO_2);
const cut1 = await measure("Glass on, cut 1 only", GLASS, UNDO_2);
const now = await measure("Glass on, this branch", GLASS, "");
// the default home (Glass panels off) against Lighter home, which a slow TV now gets by itself
const night = await measure("Night (default), this branch", "&look=night&lighter=off", "");
const lighter = await measure("Night, Lighter home", "&look=night&lighter=1", "");

ok(now.state.layers.every((d) => d === "none"), "weather effects off: the weather canvas and the lighting tint are not in the page (" + now.state.layers + ")");
ok(cut1.commit < before.commit * 0.5, "cut 1: commit per press more than halved (" + before.commit + " to " + cut1.commit + " ms)");
ok(cut1.main < before.main * 0.85, "cut 1: main thread per press down by more than 15% (" + before.main + " to " + cut1.main + " ms)");
ok(now.draw < cut1.draw * 0.8, "cut 2: draw per press down by a fifth or more (" + cut1.draw + " to " + now.draw + " ms)");
ok(now.main < before.main && now.draw < before.draw, "Glass on, this branch against integrate: main " + before.main + " to " + now.main + " ms, draw " + before.draw + " to " + now.draw + " ms");
ok(lighter.state.lighter && !night.state.lighter, "Lighter home on only in the Lighter run");
ok(lighter.draw < night.draw * 0.3, "Lighter home: under a third of the default home's draw (" + night.draw + " to " + lighter.draw + " ms)");

// the weather effects still get their layers when someone turns them on
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(BASE + "?mock=1&reset=1"); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&look=night&lighter=off&wxfx=1&test_wx=63");
  await page.waitForFunction(() => document.querySelector("#grid .app"));
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => ["weather-canvas", "ambient-lighting"].map((id) => getComputedStyle(document.getElementById(id)).display));
  ok(d.every((x) => x !== "none"), "weather effects on (rain): both layers are there (" + d + ")");
  await page.close();
}
ok(errors.length === 0, "no page errors: " + errors.join(" | "));
await browser.close();
server.close();
console.log("Lag perf browser tests passed: " + n + " checks.");
