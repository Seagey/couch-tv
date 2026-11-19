// The detail layers (tv-home/web/widget-detail.js) and the widget sizes, in a real browser at 1920x1080:
//  1. OK on each widget opens its layer; the remote moves inside it (Right then Left comes back);
//     Back closes it, the widget shows again and the home keeps its focus.
//  2. What the layers do reaches the TV: aircon warmer and fan, a scene, a timer, Hold OK's Open.
//  3. Every widget kind at every size in widget-caps.js, as couch-tv Studio draws it, as a TV with its
//     data draws it, and as a TV with nothing set up draws it: nothing past its box, no words under 23 px.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_widget_detail_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

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
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });

const browser = await chromium.launch();
async function home(widgets, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => { const R = rect(x[1], x[2], x[3], x[4]); return Object.assign({ id: "w" + i, type: "widget", kind: x[0], x: R.x, y: R.y, w: R.w, h: R.h }, x[5] ? { opts: x[5] } : {}); }) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDetail);
  await page.waitForTimeout(400);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 260); };
const cur = (page) => page.evaluate(() => window.CouchDetail.current());

console.log("Running widget detail browser tests...");

// 1. open, focus, close: every layer
const CASES = [
  ["timers", ["clock", 0, 0, 8, 4], "&demo=1"], ["timers", ["timer", 0, 0, 2, 2], "&demo=1"], ["forecast", ["weather", 0, 0, 4, 4], "&demo=1"],
  ["forecast", ["hourly", 0, 0, 8, 4], "&demo=1"], ["world", ["worldclock", 0, 0, 8, 4], "&demo=1"], ["calendar", ["month", 0, 0, 4, 4], "&demo=1"],
  ["calendar", ["agenda", 0, 0, 4, 4], "&demo=1"], ["moon", ["moon", 0, 0, 4, 4], "&demo=1"], ["air", ["air", 0, 0, 2, 2], "&demo=1"],
  ["surf", ["surf", 0, 0, 8, 4], "&demo=1"], ["photos", ["slideshow", 0, 0, 8, 4], "&demo=1"], ["keep", ["keep", 0, 0, 4, 2], "&demo=1"],
  ["folder", ["folder", 0, 0, 2, 2], "&demo=1"], ["player", ["nowplaying", 0, 0, 8, 4], "&demo=1"], ["player", ["nowplaying", 0, 0, 2, 2], "&music=1"],
  ["aircon", ["aircon", 0, 0, 2, 2], "&demo=1"], ["aircon", ["aircon", 0, 0, 4, 2], "&ha=1"], ["scenes", ["scenes", 0, 0, 2, 2], "&ha=1"],
  ["controls", ["controls", 0, 0, 8, 4], "&demo=1"], ["camera", ["camera", 0, 0, 8, 4], "&demo=1"], ["cards", ["card", 0, 0, 4, 2], "&cards=1&demo=1"],
  ["news", ["news", 0, 0, 4, 4], "&demo=1"], ["sports", ["sports", 0, 0, 4, 4], "&demo=1"],
  ["setup", ["aircon", 0, 0, 4, 4], ""], ["setup", ["agenda", 0, 0, 4, 4], ""], ["setup", ["sports", 0, 0, 4, 4], ""], ["setup", ["photo", 0, 0, 2, 2], ""]
];
for (const [layer, w, q] of CASES) {
  const page = await home([w, ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], q);
  const label = layer + " from " + w[0] + " " + w[3] + "x" + w[4] + (q ? " " + q : "");
  await page.evaluate(() => { const r = document.querySelector('.cw-o[data-obj="w0"] .cw'); window.CouchDesign.nav.move(-1, 0); });
  // the remote starts on the app; Left reaches the widget
  const at = await page.evaluate(() => window.CouchDesign.nav.current());
  ok(at && at.id === "w0", label + ": the remote reaches the widget");
  await press(page, "Enter", 700);
  const c = await cur(page);
  ok(c && c.name === layer, label + ": OK opens " + layer + " (got " + (c && c.name) + ")");
  ok(await page.evaluate(() => { const p = document.querySelector(".cwd-panel"); const r = p.getBoundingClientRect(); return r.width >= 1700 && r.height >= 900; }), label + ": the layer fills the screen");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.cw-o[data-obj="w0"] .cw')).visibility === "hidden"), label + ": the widget has grown into the layer");
  if (c.stops > 1 && layer !== "photos") {
    const before = c.focusName;
    await press(page, "ArrowRight"); const r1 = await cur(page);
    if (r1.focusName !== before) { await press(page, "ArrowLeft"); ok((await cur(page)).focusName === before, label + ": Right then Left comes back"); }
    else { await press(page, "ArrowDown"); const d1 = await cur(page); if (d1.focusName !== before) { await press(page, "ArrowUp"); ok((await cur(page)).focusName === before, label + ": Down then Up comes back"); } }
    ok(await page.evaluate(() => document.querySelectorAll(".cwd-f").length === 1), label + ": one focus ring");
  }
  // the home never moves under an open layer
  ok((await page.evaluate(() => window.CouchDesign.nav.current().id)) === "w0", label + ": the home keeps its focus underneath");
  await press(page, "Escape", 600);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), label + ": Back closes it");
  ok(await page.evaluate(() => !document.querySelector(".cwd-panel") && getComputedStyle(document.querySelector('.cw-o[data-obj="w0"] .cw')).visibility === "visible"), label + ": the widget is back");
  ok((await page.evaluate(() => window.CouchDesign.nav.current().id)) === "w0", label + ": focus is on the widget again");
  ok(page.errors.length === 0, label + ": no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}

// 2. what the layers do
{ // aircon: Warmer, then a fan speed, reach Home Assistant through the launcher (mock TVHA)
  const page = await home([["aircon", 0, 0, 4, 4]], "&ha=1");
  await press(page, "Enter", 900);
  ok((await cur(page)).focusName === "Warmer", "aircon: lands on Warmer");
  await press(page, "Enter", 1600);
  const t = await page.evaluate(() => window.smartHome.request("climate").then((r) => r.rooms[0].target));
  ok(t === 22.5, "aircon: Warmer set the living room to 22.5 (got " + t + ")");
  await press(page, "Escape", 700);
  await press(page, "Enter", 900);
  // Right from Warmer crosses to the right side; Down walks the rows there to the fan speeds
  await press(page, "ArrowRight");
  for (let i = 0; i < 4 && (await cur(page)).focusName.indexOf("Fan") !== 0; i++) await press(page, "ArrowDown");
  for (let i = 0; i < 6 && (await cur(page)).focusName !== "Fan low"; i++) await press(page, "ArrowLeft");
  ok((await cur(page)).focusName === "Fan low", "aircon: the remote reaches the fan speeds");
  await press(page, "Enter", 1600);
  const fan = await page.evaluate(() => window.smartHome.request("climate").then((r) => r.rooms[0].fan));
  ok(fan === "low", "aircon: the fan speed reached Home Assistant (got " + fan + ")");
  await page.close();
}
{ // a scene runs from the Scenes layer and says so
  const page = await home([["scenes", 0, 0, 2, 2]], "&ha=1");
  await press(page, "Enter", 800);
  await press(page, "Enter", 800);
  ok(/Movie night is on/.test(await page.evaluate(() => document.querySelector(".cwd-msg").textContent)), "scenes: OK ran Movie night and said so");
  await page.close();
}
{ // a timer starts from the remote and the widget counts it down
  const page = await home([["timer", 0, 0, 4, 4]], "");
  ok(/No timer/.test(await page.evaluate(() => document.querySelector('.cw-o[data-obj="w0"] .cw').textContent)), "timer: a real TV with no timer says so, never a pretend one");
  await press(page, "Enter", 800);
  await press(page, "Enter", 600);   // 5 minutes
  const tm = await page.evaluate(() => JSON.parse(localStorage.getItem("couchtv.timer")));
  ok(tm && Math.abs(tm.total - 300000) < 1000, "timer: 5 minutes started, kept on the TV");
  await press(page, "Escape", 400);
  // the widget ticks every second: wait for it to leave 5:00 (up to 4 s) instead of guessing when
  const counted = await page.waitForFunction(() => /4:5\d/.test((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || ""), null, { timeout: 4000 }).then(() => true, () => false);
  ok(counted, "timer: the widget counts it down");
  // and every second, not every other one: three readings a second apart are three different times
  const reads = [];
  for (let i = 0; i < 3; i++) { reads.push(await page.evaluate(() => (/\d+:\d\d/.exec(document.querySelector('.cw-o[data-obj="w0"] .cw').textContent) || [""])[0])); await page.waitForTimeout(1300); }
  ok(new Set(reads).size === 3, "timer: it changes each second (" + reads.join(", ") + ")");
  await page.close();
}
{ // Hold OK on a widget whose own buttons do things: Settings first (a beginner's way in, TCL and Toshiba
  // tests, 19 Nov 2026), then All apps, then Open for the widget's own page
  const page = await home([["scenes", 0, 0, 8, 4]], "&ha=1");
  await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
  const items = await page.evaluate(() => [...document.querySelectorAll(".cw-menu .cw-mi")].map((n) => n.textContent));
  ok(items[0] === "Settings" && items[1] === "All apps" && items[2] === "Open Scenes", "hold OK: Settings, All apps, then Open Scenes (" + items.join(", ") + ")");
  await press(page, "ArrowDown", 200); await press(page, "ArrowDown", 200);
  await press(page, "Enter", 800);
  ok((await cur(page) || {}).name === "scenes", "hold OK: Open opens the layer");
  await page.close();
}

// 3. every kind at every size, three ways
{
  const page = await home([["clock", 0, 0, 4, 2]], "");
  const bad = await page.evaluate(() => {
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, t0 = Date.now(), iso = (h) => new Date(t0 + h * 3600000).toISOString().slice(0, 13) + ":00";
    const data = { bridge: true, place: { name: "Riverside", lat: -28.8, lon: 153.4 }, who: "a", quick: ["sleep", "look", "input"],
      weather: { temp: 23, code: 61, is_day: true, hi: 26, lo: 16, uv: 9, rain15: [0, 0.3, 1.2, 2.4, 3, 1, 0.4, 0, 0, 0, 0, 0],
        hourly: Array.from({ length: 24 }, (_, i) => ({ time: iso(i), temp: 20 + (i % 6), code: [0, 2, 3, 61, 95][i % 5], uv: i % 9, pop: (i * 7) % 100 })),
        daily: Array.from({ length: 7 }, (_, i) => ({ date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), code: [0, 61, 3][i % 3], hi: 25, lo: 15, sunrise: iso(-4), sunset: iso(8), uv: 10 })),
        air: { aqi: 33, hourly: [33, 35, 40] }, marine: { wave: 1.6, period: 10, dir: 120, wind: 12, windDir: 270, hourly: [1.6, 1.7, 1.8] } },
      shows: [{ title: "A show with a long name", season: 3, episode: 2, progress: 0.5, app: { package: "com.netflix.ninja", name: "Netflix" } }],
      music: { title: "A song with quite a long title", artist: "Some Artist", state: "playing", position: 40, duration: 200, package: "com.spotify.tv.android", source: "Spotify" },
      apps: [["com.netflix.ninja", "Netflix"], ["com.google.android.youtube.tv", "YouTube"], ["au.net.abc.iview", "ABC iview"], ["au.com.stan.and", "Stan"], ["com.spotify.tv.android", "Spotify"]].map((a) => ({ package: a[0], name: a[1] })),
      photos: ["demo/beach.jpg"], people: [{ id: "a", name: "Alex" }, { id: "b", name: "Sam" }], cards: [{ title: "Solar today", value: "18.4 kWh" }], scenes: [{ entity: "scene.a", name: "Movie night" }] };
    const rooms = [{ entity: "climate.a", name: "Living room", ok: true, state: "cool", target: 22, current: 24.5, modes: ["off", "cool"] }];
    const envs = { designer: { demo: true, designer: true }, tv: { data, rooms, ha: true, imgOk: () => true }, unset: { data: { bridge: false, place: {} }, rooms: [] } };
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99";
    document.body.appendChild(host);
    const out = []; let count = 0;
    C.kinds().filter((k) => k !== "stack").forEach((kind) => {
      const s = C.get(kind).sizes, list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat((s.x || []).map((x) => [x[0], x[2], x[3]])).concat([["min", s.min[0], s.min[1]]]);
      list.forEach(([id, w, h]) => Object.keys(envs).forEach((en) => {
        while (host.firstChild) host.removeChild(host.firstChild);
        const el = W.render({ id: "t", kind, w: w * 100 - 40, h: h * 100 - 40 }, envs[en]);
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        const b = el.getBoundingClientRect();
        el.querySelectorAll("*").forEach((node) => {
          if (node.classList.contains("cw-bg")) return;
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.right > b.right + 2 || r.bottom > b.bottom + 2 || r.left < b.left - 2 || r.top < b.top - 2)) {
            let p = node.parentElement, seen = true;
            while (p && p !== host) { if (p !== node && getComputedStyle(p).overflow === "hidden") { const q = p.getBoundingClientRect(); if (q.right <= b.right + 2 && q.bottom <= b.bottom + 2 && q.left >= b.left - 2 && q.top >= b.top - 2) { seen = false; break; } } p = p.parentElement; }
            if (seen) out.push(kind + " " + id + " " + en + ": " + (typeof node.className === "string" ? node.className : node.tagName) + " past the box");
          }
          if ([].some.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim())) { const fs = parseFloat(getComputedStyle(node).fontSize); if (fs > 0 && fs < 23) out.push(kind + " " + id + " " + en + ": words at " + fs + " px"); }
        });
      }));
    });
    host.remove();
    return { out, count };
  });
  ok(bad.count > 500, "drew " + bad.count + " widget sizes");
  ok(bad.out.length === 0, "every size reads and fits:\n  " + bad.out.slice(0, 20).join("\n  "));
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
