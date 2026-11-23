// The Spotify Now playing card (#321) after the 0.13.12 tidy-ups, in a real browser:
//   - Home settings, Look shows the Spotify rows only where the card works (the TV home app's own
//     player, or a computer at home), never in a plain browser
//   - the adb line under "Notification access required" only when no computer is at home
//   - tv.spotifyUpdate (the app's listener pushing a change) moves the card at once, with no 5 second wait
//   - a cover given only as a link is never loaded (it would reach Spotify); a picture inside the message is
// COUCHTV_PLAYWRIGHT=<folder with Playwright> node tests/test_spotify_card_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.COUCHTV_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?mock=1";
// a real 1x1 PNG, for the picture inside the message
const DATA_ART = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let passed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { fails.push(m); console.log("FAIL " + m); } };

const browser = await chromium.launch();
// tvos: null for a plain browser, else the TV home app's bridge with the Spotify calls; settings: Home settings
async function open(query, tvos, settings) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  page.linkAsked = [];
  await page.route("https://i.scdn.co/**", (r) => { page.linkAsked.push(r.request().url()); r.abort(); });
  if (tvos) await page.addInitScript((perm) => {
    window.spotifyNow = { available: false, state: "stopped" };
    window.TVOS = {
      spotifyState: () => JSON.stringify(window.spotifyNow),
      spotifyHasPermission: () => perm,
      spotifyControl: (a) => { window.lastControl = a; return true; },
      apps: () => "[]"
    };
  }, tvos.perm);
  await page.goto(BASE + "&reset=1");
  await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem("mock:tvhome.settings", JSON.stringify({ s, updated: 1 })); }, settings || null);
  await page.goto(BASE + (query || ""));
  await page.waitForFunction(() => window.tv && document.querySelector("#shelf"));
  await page.waitForTimeout(700);
  return page;
}
async function lookRows(page) {
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300);
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  for (let i = 0; i < 16 && !(await page.evaluate(() => /^Look/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) {
    await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120);
  }
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  return page.evaluate(() => document.getElementById("set-rows").textContent);
}

try {
  // 1. a plain browser with a computer at home (mock): no Spotify rows, the card cannot work there
  let page = await open("", null);
  let rows = await lookRows(page);
  ok(/Now playing/.test(rows), "browser: Look has its Now playing rows");
  ok(!/Spotify integration/.test(rows), "browser: no Spotify rows where the card cannot work");
  ok(!/only supported on Android/.test(rows), "browser: no row saying it is not supported either");
  // App name, Long titles and Card alignment shape every app's Now playing card: under Now playing everywhere
  ok(/App name/.test(rows) && /Long titles/.test(rows) && /Card alignment/.test(rows), "browser: App name, Long titles and Card alignment under Now playing");
  const lookList = await page.evaluate(() => [...document.querySelectorAll("#set-rows > *")].map((r) => r.textContent));
  const at = (re) => lookList.findIndex((x) => re.test(x));
  ok(at(/^Long titles/) > at(/^Now playing$/) && at(/^Now playing$/) >= 0 && at(/^Long titles/) < at(/^Your photos$/), "browser: Long titles sits in the Now playing part of Look");
  ok(page.errors.length === 0, "browser: no page errors (" + page.errors.join(" | ") + ")");
  await page.close();

  // 2. the TV home app with a computer at home, no access yet: the rows, and no adb line
  page = await open("", { perm: false });
  rows = await lookRows(page);
  ok(/Spotify integration/.test(rows), "app + computer: the Spotify rows show");
  ok(/Notification access required/.test(rows), "app + computer: says access is needed");
  ok(!/adb shell/.test(rows), "app + computer: no adb line, the computer gives the access");
  ok(/Long titles/.test(rows), "app + computer, Spotify off: Long titles still there");
  // Long titles changes and is kept in Home settings (ST.spotify, as 0.13.11 saved it)
  for (let i = 0; i < 80 && !/^Long titles/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) {
    await page.keyboard.press("ArrowDown"); await page.waitForTimeout(60);
  }
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => ((JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).spotify || {}).title_mode);
  ok(saved === "continuous", "Long titles moves on from Ping pong and is kept (" + saved + ")");
  await page.close();

  // 3. the TV home app with no computer at home: the adb line is the way to give it
  page = await open("&offline=1", { perm: false });
  rows = await lookRows(page);
  ok(/Spotify integration/.test(rows), "app alone: the Spotify rows show");
  ok(/adb shell cmd notification allow_listener/.test(rows), "app alone: the adb line shows");
  await page.close();

  // 4. access given: no hint at all
  page = await open("", { perm: true });
  rows = await lookRows(page);
  ok(/Notification access granted/.test(rows) && !/adb shell/.test(rows), "access given: says so, no adb line");
  await page.close();

  // 5. tv.spotifyUpdate moves the card at once; a cover given only as a link is never asked for
  page = await open("", { perm: true }, { spotify: { enabled: true } });
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => typeof window.tv.spotifyUpdate)) === "function", "tv.spotifyUpdate is defined");
  await page.evaluate(() => window.tv.spotifyUpdate({ available: true, title: "Pushed song", artist: "Pushed artist", state: "playing",
    position: 1000, duration: 200000, speed: 1, actions: 3125244, art: "https://i.scdn.co/image/abc123", package: "com.spotify.tv.android" }));
  await page.waitForTimeout(150);   // well under the 5 second look: only the push can have done it
  let np = await page.evaluate(() => (document.getElementById("np") || {}).textContent || "");
  ok(/Pushed song/.test(np) && /Pushed artist/.test(np), "the pushed song is on the card at once (" + np.slice(0, 80) + ")");
  let srcs = await page.evaluate(() => [...document.querySelectorAll("#np img")].map((i) => i.getAttribute("src") || ""));
  ok(!srcs.some((s) => /scdn|^https?:/.test(s)), "a cover given only as a link is not used (" + srcs.join(",").slice(0, 120) + ")");
  await page.waitForTimeout(300);
  ok(page.linkAsked.length === 0, "nothing was asked of Spotify's picture host (" + page.linkAsked.join(",") + ")");
  await page.evaluate((art) => window.tv.spotifyUpdate({ available: true, title: "Second song", artist: "Pushed artist", state: "paused",
    position: 0, duration: 200000, speed: 0, actions: 3125244, art, package: "com.spotify.tv.android" }), DATA_ART);
  await page.waitForTimeout(150);
  np = await page.evaluate(() => (document.getElementById("np") || {}).textContent || "");
  ok(/Second song/.test(np), "a second push replaces the song");
  srcs = await page.evaluate(() => [...document.querySelectorAll("#np img")].map((i) => i.getAttribute("src") || ""));
  ok(srcs.some((s) => s.indexOf("data:image/png") === 0), "a picture inside the message is the cover");
  // the poll reads the same state through spotifyState, also without the link
  await page.evaluate(() => { window.spotifyNow = { available: true, title: "Polled song", artist: "A", state: "playing", position: 0, duration: 100000,
    speed: 1, actions: 3125244, art: "https://i.scdn.co/image/zzz", package: "com.spotify.tv.android" }; });
  await page.waitForFunction(() => /Polled song/.test((document.getElementById("np") || {}).textContent || ""), null, { timeout: 8000 });
  srcs = await page.evaluate(() => [...document.querySelectorAll("#np img")].map((i) => i.getAttribute("src") || ""));
  ok(!srcs.some((s) => /scdn|^https?:/.test(s)), "the 5 second look drops a link cover too");
  // the card stops at once when the player goes away
  await page.evaluate(() => { window.spotifyNow = { available: false, state: "stopped" }; window.tv.spotifyUpdate({ available: false, state: "stopped" }); });
  await page.waitForTimeout(150);
  np = await page.evaluate(() => (document.getElementById("np") || {}).textContent || "");
  ok(!/Polled song/.test(np), "the card lets go of the song when the player goes away");
  // Spotify switched off: a push changes nothing
  await page.evaluate(() => window.tv.spotifyUpdate(null));
  ok(page.errors.length === 0, "the app: no page errors (" + page.errors.join(" | ") + ")");
  await page.close();

  // 6. Spotify off: a push is ignored
  page = await open("", { perm: true });
  await page.evaluate(() => window.tv.spotifyUpdate({ available: true, title: "Ignored song", artist: "X", state: "playing", package: "com.spotify.tv.android" }));
  await page.waitForTimeout(150);
  np = await page.evaluate(() => (document.getElementById("np") || {}).textContent || "");
  ok(!/Ignored song/.test(np), "with Spotify off, a push changes nothing");
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? "FAILED " + fails.length + ", passed " + passed : "ok: " + passed + " checks");
process.exit(fails.length ? 1 : 0);
