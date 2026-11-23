// background.video in a real browser at 1920x1080 (the home as a TV draws it, mock.js standing in for
// the bridge, this test's own server standing in for the design store):
//  1. a built in loop: the still picture shows first, then the video plays, and it loops (its clock
//     goes back to the start without stopping);
//  2. the clock behind the hills still works over the video (the clouds loop and its cut out);
//  3. an app opening (tv.pause, also what the screen saver does), the ambient clock and a hidden page
//     stop it and let go of the decoder; the home coming back starts it again;
//  4. from the store: played from memory once its bytes pass; bytes that are not a video, or a video
//     the TV cannot play, leave the still picture and say why; Lighter home keeps the still picture;
//     an official design's long loop (over 15 s) is asked for, played, and kept on the TV, so a
//     restart plays it without asking the store again;
//  5. the cost: frames a second and main thread time at 4x slower CPU, with the still picture, the
//     video, and the video under frosted panels.
// Shots go to $SHOTS (default: the system temp folder, couchtv-video-bg).
// Needs Playwright and Google Chrome (Playwright's own Chromium has no H.264). Without them it says so
// and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_design_video_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "tv-home/web");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "couchtv-video-bg");
fs.mkdirSync(SHOTS, { recursive: true });

// the store's videos, by id
const RAIN = fs.readFileSync(path.join(WEB, "backgrounds/loop-rain.mp4"));
const mdatAt = RAIN.indexOf(Buffer.from("mdat")) - 4;
const STORE = {
  GoodVideoFromStore01: { type: "video/mp4", body: RAIN },
  NotAVideoAtAllJpeg01: { type: "video/mp4", body: fs.readFileSync(path.join(WEB, "backgrounds/loop-rain.jpg")) },
  // a whole index, but the pictures cut off after a few bytes: passes the byte check, cannot play
  BrokenPicturesMp4x01: { type: "video/mp4", body: RAIN.subarray(0, mdatAt + 2000) }
};
// an official design's long loop: the rain loop four times over (a stream copy, no encode), about 40 s
let LONG = null;
try {
  const out = path.join(SHOTS, "long-loop.mp4");
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-stream_loop", "3", "-i", path.join(WEB, "backgrounds/loop-rain.mp4"), "-c", "copy", "-an", "-movflags", "+faststart", out]);
  LONG = fs.readFileSync(out);
} catch (e) { console.log("  (no ffmpeg: the long loop checks are left out)"); }
if (LONG) STORE.LongLoopOfficial01 = { type: "video/mp4", body: RAIN, long: LONG };
const asked = [];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4" };
const server = http.createServer((req, res) => {
  const m = /^\/v1\/assets\/video\/([A-Za-z0-9_-]+)\?h=(l?(?:720|1080))$/.exec(req.url);
  if (m) {
    asked.push({ id: m[1], h: m[2], cookie: req.headers.cookie || "", referer: req.headers.referer || "" });
    const v = STORE[m[1]];
    if (!v) { res.writeHead(404); res.end(); return; }
    // as the store: the long loop when asked and there is one, else the 15 s copy
    const body = m[2][0] === "l" && v.long ? v.long : v.body;
    res.writeHead(200, { "content-type": v.type, "content-length": body.length, "access-control-allow-origin": "*" });
    res.end(body);
    return;
  }
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  // videos with ranges, as the bridge and the launcher serve them
  const size = fs.statSync(f).size, range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (range && path.extname(f) === ".mp4") {
    const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${a}-${b}/${size}`, "accept-ranges": "bytes", "content-length": b - a + 1 });
    fs.createReadStream(f, { start: a, end: b }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "accept-ranges": "bytes", "content-length": size });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const BASE = ORIGIN + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log("  ok", m); };
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (e) { console.log("SKIP: Google Chrome is not installed (Playwright's Chromium cannot play H.264): " + String(e.message).split("\n")[0]); server.close(); process.exit(0); }

const CLOCK = { id: "clk", type: "widget", kind: "clock", layer: "back", x: 460, y: 380, w: 1000, h: 520, style: { panel: "colour", colour: "#ff0000", gradient: "off" } };
const loop = (id, extra) => Object.assign({ v: 1, background: { image: "backgrounds/loop-" + id + ".jpg", video: "backgrounds/loop-" + id + ".mp4", darken: 0 } }, extra || {});
async function home(design, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  // every state the video goes through, from the very start
  await page.addInitScript(() => {
    window.__vs = [];
    new MutationObserver(() => { const s = document.documentElement && document.documentElement.getAttribute("data-cd-video"); if (s && window.__vs[window.__vs.length - 1] !== s) window.__vs.push(s); })
      .observe(document, { attributes: true, subtree: true, attributeFilter: ["data-cd-video"] });
  });
  if (opts.cdp) await opts.cdp(page);
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local&designstore=" + encodeURIComponent(ORIGIN));
  await page.waitForFunction(() => document.documentElement.classList.contains("cd"));
  return page;
}
const vstate = (page) => page.evaluate(() => {
  const v = document.querySelector("#cd-bg video"), de = document.documentElement;
  return { state: de.getAttribute("data-cd-video"), why: de.getAttribute("data-cd-video-why") || "", on: de.classList.contains("cd-vid-on"),
    shown: !!(v && v.classList.contains("on")), opacity: v ? getComputedStyle(v).opacity : null, src: v ? v.getAttribute("src") || "" : "", paused: v ? v.paused : null,
    loop: v ? v.loop : null, muted: v ? v.muted : null, t: v ? v.currentTime : 0, poster: getComputedStyle(document.querySelector("#cd-bg i")).backgroundImage, seen: window.__vs.slice() };
});
const until = (page, want, ms = 15000) => page.waitForFunction((w) => document.documentElement.getAttribute("data-cd-video") === w, want, { timeout: ms })
  .catch(async (e) => { throw new Error("waited for " + want + ": " + JSON.stringify(await vstate(page).catch(() => null)) + " " + e.message.split("\n")[0]); });

console.log("Running video background browser tests...");

{ // 1. a built in loop: still first, then plays, then loops
  const page = await home(loop("ocean"));
  await until(page, "playing");
  let s = await vstate(page);
  ok(s.seen.indexOf("loading") >= 0 && s.seen.indexOf("loading") < s.seen.indexOf("playing"), "the still picture first, then the video (" + s.seen.join(" > ") + ")");
  ok(/loop-ocean\.jpg/.test(s.poster), "the still picture is under the video");
  ok(s.on && s.shown && s.loop && s.muted && !s.paused, "playing: shown, muted, looping");
  await page.waitForTimeout(1000);
  const fill = await page.evaluate(() => { const f = document.querySelector("#scenes .scene.on .gclock .fill"); if (!f) return null; const c = getComputedStyle(f), g = getComputedStyle(f.closest(".gclock")); return { color: c.color, bg: c.backgroundImage, op: c.opacity, gop: g.opacity, gf: g.filter, sf: getComputedStyle(f.closest(".scene")).opacity }; });
  ok(fill && fill.bg === "none" && /255, 255, 255/.test(fill.color), "the glass clock is frosted white over the video, not the still picture " + JSON.stringify(fill));
  await page.screenshot({ path: path.join(SHOTS, "ocean-playing.png") });
  // watch its clock for longer than the loop: it must go back to the start and keep playing
  const trace = await page.evaluate(async () => {
    const v = document.querySelector("#cd-bg video"), out = [];
    for (let i = 0; i < 48; i++) { out.push([v.currentTime, v.paused]); await new Promise((r) => setTimeout(r, 250)); }
    return out;
  });
  const wrapped = trace.some((x, i) => i && x[0] + 1 < trace[i - 1][0]);
  ok(wrapped && trace.every((x) => !x[1]), "it loops: the clock went back to the start and it never stopped (" + trace.map((x) => x[0].toFixed(1)).filter((_, i) => i % 6 === 0).join(", ") + " s)");
  const q = await page.evaluate(() => { const v = document.querySelector("#cd-bg video"); const p = v.getVideoPlaybackQuality(); return { total: p.totalVideoFrames, dropped: p.droppedVideoFrames }; });
  ok(q.total > 200 && q.dropped / q.total < 0.05, "frames shown: " + q.total + ", dropped: " + q.dropped);
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.close();
}

{ // 2. clock behind the hills over the moving clouds
  const page = await home(loop("clouds", { background: { image: "backgrounds/loop-clouds.jpg", video: "backgrounds/loop-clouds.mp4", darken: 0, depth: true }, objects: [CLOCK] }));
  await until(page, "playing");
  await page.waitForTimeout(1200);
  const d = await page.evaluate(() => { const e = document.getElementById("cd-depth"); return e && !e.hidden && getComputedStyle(e).display !== "none" ? getComputedStyle(e).backgroundImage : ""; });
  ok(/loop-clouds-fg\.png/.test(d), "the depth layer is the clouds loop's own hills (" + d.slice(0, 80) + ")");
  const shot = path.join(SHOTS, "clouds-depth.png");
  await page.screenshot({ path: shot });
  // read the pixels from the screenshot itself (a canvas cannot read a video's frame plus the page)
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  const pix = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = 1920; c.height = 1080; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { sky: at(960, 440), hill: at(960, 960), outside: at(200, 300) };
  }, png.toString("base64"));
  const red = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60;
  ok(red(pix.sky), "the clock shows through the sky over the video " + JSON.stringify(pix.sky));
  ok(!red(pix.hill) && pix.hill[0] < 80, "the hills stand in front of the clock " + JSON.stringify(pix.hill));
  ok(!red(pix.outside), "outside the clock: the clouds " + JSON.stringify(pix.outside));
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.close();
}

{ // 3. paused when an app opens, under the ambient clock, on a hidden page; back when the home is
  const page = await home(loop("fire"));
  await until(page, "playing");
  await page.evaluate(() => window.tv.pause());
  await until(page, "paused", 3000);
  let s = await vstate(page);
  ok(s.paused !== false && !s.src && !s.shown && !s.on, "an app opened (tv.pause): stopped, the decoder let go, the still picture shows");
  await page.screenshot({ path: path.join(SHOTS, "fire-paused.png") });
  await page.evaluate(() => window.tv.resume());
  await until(page, "playing", 8000);
  s = await vstate(page);
  ok(s.shown && !s.paused, "the home came back (tv.resume): playing again");
  await page.evaluate(() => CouchDesign.hold("idle", true));
  await until(page, "paused", 3000);
  ok(!(await vstate(page)).src, "under the ambient clock: stopped");
  await page.evaluate(() => CouchDesign.hold("idle", false));
  await until(page, "playing", 8000);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await until(page, "paused", 3000);
  ok(!(await vstate(page)).src, "a hidden page: stopped");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await until(page, "playing", 8000);
  ok(true, "and back when the page shows");
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.close();
}

{ // 4a. from the store: fetched without cookies or a referrer, checked, played from memory
  const page = await home({ v: 1, background: { image: "backgrounds/loop-rain.jpg", video: "store:GoodVideoFromStore01", darken: 0 } });
  await until(page, "playing");
  const s = await vstate(page);
  ok(/^blob:/.test(s.src) && s.shown, "a store video plays from memory (" + s.src.slice(0, 40) + "...)");
  const a = asked.filter((x) => x.id === "GoodVideoFromStore01");
  ok(a.length === 1 && !a[0].cookie && !a[0].referer && /^l(720|1080)$/.test(a[0].h), "asked the store once, no cookie, no referrer, for the long loop if there is one (" + (a[0] && a[0].h) + "; this one has none, so its 15 s copy came)");
  const pol = await page.evaluate(() => (document.querySelector('meta[data-tvdesigner="policy"]') || {}).content || "");
  ok(/media-src 'self' blob: http:\/\/127\.0\.0\.1:\d+;/.test(pol), "the page policy lets videos come only from here, memory and the store (" + (pol.match(/media-src [^;]*/) || [""])[0] + ")");
  await page.screenshot({ path: path.join(SHOTS, "rain-from-store.png") });
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.close();
}
for (const [id, want, label] of [["NotAVideoAtAllJpeg01", /not a video/, "bytes that are not a video"], ["BrokenPicturesMp4x01", /could not play|did not start/, "a video this TV cannot play"], ["MissingFromTheStore1", /no longer has it/, "a video the store no longer has"]]) {
  const page = await home({ v: 1, background: { image: "backgrounds/loop-rain.jpg", video: "store:" + id, darken: 0 } });
  await until(page, "failed", 16000);
  const s = await vstate(page);
  ok(want.test(s.why) && !s.shown && !s.src && /loop-rain\.jpg/.test(s.poster), label + ": the still picture stays, and it says why (" + s.why + ")");
  const row = await page.evaluate(() => CouchDesign.settingsRow().sub);
  ok(/still picture shows/.test(row), "Home settings says so too: " + row);
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  if (id === "BrokenPicturesMp4x01") await page.screenshot({ path: path.join(SHOTS, "broken-fallback.png") });
  await page.close();
}
if (LONG) { // 4c. an official design's long loop: played whole, looping; kept, so a restart asks nothing
  const page = await home({ v: 1, background: { image: "backgrounds/loop-rain.jpg", video: "store:LongLoopOfficial01", darken: 0 } });
  await until(page, "playing", 20000);
  const s = await vstate(page);
  const d = await page.evaluate(() => document.querySelector("#cd-bg video").duration);
  const a = asked.filter((x) => x.id === "LongLoopOfficial01");
  ok(d > 30 && s.loop && /^blob:/.test(s.src), "the long loop plays from memory, " + d.toFixed(1) + " s, looping");
  ok(a.length === 1 && /^l(720|1080)$/.test(a[0].h), "asked once, for the long loop (" + a.map((x) => x.h).join(", ") + ")");
  // the TV restarts: the home loads again in the same browser
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("cd"));
  await until(page, "playing", 20000);
  const d2 = await page.evaluate(() => document.querySelector("#cd-bg video").duration);
  ok(asked.filter((x) => x.id === "LongLoopOfficial01").length === 1 && d2 > 30, "after a restart it plays from the TV's own copy: the store was not asked again (" + d2.toFixed(1) + " s)");
  // only the current design's video is kept
  const kept = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("couchtv-video"); q.onsuccess = () => { const t = q.result.transaction("v").objectStore("v").getAllKeys(); t.onsuccess = () => r(t.result); }; }));
  ok(kept.length === 1 && /^LongLoopOfficial01:(720|1080):l$/.test(kept[0]), "one video kept on the TV: " + JSON.stringify(kept));
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.close();
}
{ // 4b. Lighter home: the still picture only, and the store is not asked at all
  const before = asked.length;
  const page = await home({ v: 1, home: { lighter: true }, background: { image: "backgrounds/loop-rain.jpg", video: "store:GoodVideoFromStore01", darken: 0 } });
  await until(page, "still", 8000);
  await page.waitForTimeout(1500);
  const s = await vstate(page);
  ok(/Lighter home/.test(s.why) && !s.src && asked.length === before, "Lighter home: the still picture, nothing fetched (" + s.why + ")");
  await page.close();
}

{ // 4c. a 1 GB TV (Lighter home is on by itself there): the video still plays, the Designs line says it is a
  // smaller copy, and Show the still picture instead is a choice this TV keeps (0.13.10)
  const oneGb = async (page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 1, configurable: true }));
  const page = await home(loop("rain", { home: { lighter: true } }), { cdp: oneGb });
  ok(await page.evaluate(() => navigator.deviceMemory) === 1, "the page reads 1 GB of memory");
  await until(page, "playing");
  ok(/smaller copy, as this TV has 1 GB of memory/.test(await page.evaluate(() => window.CouchDesign.videoNote())), "1 GB with Lighter home: the video plays, and Designs says it is a smaller copy");
  ok(await page.evaluate(() => window.CouchDesign.hasVideo() && window.CouchDesign.videoStill() === false), "the design has a video, and the still picture is not chosen");
  await page.evaluate(() => window.CouchDesign.videoStill(true));
  await until(page, "still", 8000);
  ok(/chosen on this TV/.test((await vstate(page)).why) && !(await vstate(page)).src, "Show the still picture instead: the video stops and lets go (" + (await vstate(page)).why + ")");
  await page.goto(BASE + "?mock=1&design=local&designstore=" + encodeURIComponent(ORIGIN));
  await page.waitForFunction(() => document.documentElement.classList.contains("cd"));
  await until(page, "still", 8000);
  ok(await page.evaluate(() => window.CouchDesign.videoStill() === true && window.CouchDesign.videoNote() === ""), "the choice is kept when the home opens again, and the note leaves it to the Designs row");
  await page.evaluate(() => window.CouchDesign.videoStill(false));
  await until(page, "playing");
  ok(true, "turned off again: the video plays");
  ok(page.errors.length === 0, "no errors: " + page.errors.slice(0, 2).join(" | "));
  await page.close();
}

{ // 5. the cost at 4x slower CPU (the throttle Chrome's own tools use for a slow phone)
  const bcdp = await browser.newBrowserCDPSession();
  const throttle = async (page) => { const c = await page.context().newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); page.cdp = c; };
  const measure = async (design) => {
    const page = await home(design, { cdp: throttle });
    await page.waitForTimeout(4000);
    await page.evaluate(() => { const v = document.querySelector("#cd-bg video"); window.__q0 = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; });
    await page.cdp.send("Performance.enable");
    const m0 = Object.fromEntries((await page.cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    // every process of the browser (the page, the GPU and video decoder, the rest): CPU seconds used
    const cpuNow = async () => (await bcdp.send("SystemInfo.getProcessInfo")).processInfo.reduce((s, p) => s + p.cpuTime, 0);
    const c0 = await cpuNow(), w0 = Date.now();
    const fps = await page.evaluate(() => new Promise((r) => { let f = 0; const t0 = performance.now(); const tick = () => { f++; if (performance.now() - t0 < 8000) requestAnimationFrame(tick); else r(f / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(tick); }));
    const m1 = Object.fromEntries((await page.cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const cores = (await cpuNow() - c0) / ((Date.now() - w0) / 1000);
    const busy = (m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp);
    const st = await vstate(page);
    const q = await page.evaluate(() => { const v = document.querySelector("#cd-bg video"); if (!v || !window.__q0) return null; const p = v.getVideoPlaybackQuality(); return { total: p.totalVideoFrames - window.__q0.totalVideoFrames, dropped: p.droppedVideoFrames - window.__q0.droppedVideoFrames }; });
    await page.close();
    return { fps: Math.round(fps * 10) / 10, busy: Math.round(busy * 1000) / 10, cores: Math.round(cores * 100) / 100, state: st.state, q };
  };
  const still = await measure({ v: 1, background: { image: "backgrounds/loop-ocean.jpg", darken: 0 } });
  const vid = await measure(loop("ocean"));
  const glass = await measure(loop("ocean", { home: { glass: "on" } }));
  console.log("  cost at 4x slower CPU (frames a second, main thread busy %):", JSON.stringify({ still, video: vid, videoUnderGlass: glass }));
  ok(vid.state === "playing" && glass.state === "playing", "the video kept playing at 4x slower CPU");
  ok(vid.fps >= 50, "with the video the page still draws " + vid.fps + " frames a second (still picture: " + still.fps + ")");
  ok(vid.busy - still.busy < 15, "the video adds " + (vid.busy - still.busy).toFixed(1) + " points of main thread time (" + still.busy + "% to " + vid.busy + "%)");
  ok(vid.cores - still.cores < 0.5, "the whole browser uses " + (vid.cores - still.cores).toFixed(2) + " of a CPU core more with the video (" + still.cores + " to " + vid.cores + ")");
  ok(!vid.q || vid.q.dropped / Math.max(1, vid.q.total) < 0.1, "video frames dropped at 4x slower CPU: " + (vid.q ? vid.q.dropped + " of " + vid.q.total : "n/a"));
  fs.writeFileSync(path.join(SHOTS, "cost.json"), JSON.stringify({ still, video: vid, videoUnderGlass: glass }, null, 2));
}

await browser.close();
server.close();
console.log(`OK ${n} video background browser checks (shots in ${SHOTS})`);
