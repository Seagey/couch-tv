// COUCHTV_PLAYWRIGHT=<folder with Playwright> node tests/test_bing_daily_browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"));
let chromium;
try { ({ chromium } = require("playwright")); }
catch { console.log("SKIP: Playwright is not installed"); process.exit(0); }

const root = fileURLToPath(new URL("../tv-home/web/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ timezoneId: "UTC" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-11-20T14:05:08Z") });
  await page.addInitScript(() => {
    window.bingVersion = "20261120";
    window.TVOS = {
      dailyBingPhoto: () => window.bingVersion,
      spotifyMusic: () => JSON.stringify(window.spotifyTrack || {}),
      spotifyKey: key => { window.lastSpotifyKey = key; return true; },
      fotmobScores: () => JSON.stringify({ state: "ok", leagues: [{ id: 47, matches: [
        { home: { name: "Home", score: 2 }, away: { name: "Away", score: 1 }, status: { started: true, finished: false } },
        ...Array.from({length: 6}, (_, i) => ({ home: { name: "Team " + (i + 1) }, away: { name: "Away " + (i + 1) }, status: {} }))
      ] }] }),
      apps: () => "[]"
    };
  });
  await page.route("**/config.js", route => route.fulfill({
    contentType: "text/javascript",
    body: "window.COUCH_CONFIG={home:{look:'night',bing_daily_background:true,clock:'24h',clock_seconds:true,spotify_player:true,football_scores:true},people:[{id:'owner',name:'Owner'}]};"
  }));
  let offline = false;
  await page.route("http://tvos.invalid/bing-daily-photo/*", route => offline ? route.abort() : route.fulfill({
    path: path.join(root, route.request().url().endsWith("20") ? "backgrounds/scene-night.jpg" : "backgrounds/scene-golden.jpg"),
    contentType: "image/jpeg"
  }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?offline=1&alone=1&pointer=1`);
  await page.waitForFunction(() => document.querySelector("#scenes .sbg")?.naturalWidth > 0);
  assert.match(await page.locator("#football-scores").textContent(), /Premier League.*Home.*2–1.*Away.*LIVE/);
  const dock = page.locator("#apps-section");
  const dockBox = await dock.boundingBox();
  assert.ok(dockBox.x > 0 && Math.abs(dockBox.x - (1280 - dockBox.x - dockBox.width)) < 2);
  await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 4 && !(await page.locator("#football-scores.focus").count()); i++) await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#football-scores.focus").count(), 1);
  await page.keyboard.press("Enter");
  assert.match(await page.locator("#settings").textContent(), /Choose the competitions to show/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("#np [aria-label='Open Spotify']").waitFor();
  await page.evaluate(() => {
    window.spotifyTrack = { title: "Test song", artist: "Test artist", state: "playing", source: "spotify-tv" };
  });
  await page.clock.runFor(5001);
  assert.match(await page.locator("#np").textContent(), /Test song.*Test artist/);
  assert.equal(await page.locator("#np [aria-label='Pause']").count(), 1);
  await page.locator("#np [aria-label='Pause']").click();
  assert.equal(await page.evaluate(() => window.lastSpotifyKey), "play_pause");
  assert.equal(await page.locator(".football-match").count(), 3);
  assert.match(await page.locator("#football-scores").textContent(), /Matches 1 \/ 3/);
  await page.clock.runFor(5000);
  assert.match(await page.locator("#football-scores").textContent(), /Team 3.*Team 5.*Matches 2 \/ 3/);
  assert.ok(await page.locator("#football-scores").evaluate(el => el.scrollHeight <= el.clientHeight));
  assert.equal(await page.locator("#scenes .scene").count(), 1);
  const activeImage = page.locator("#scenes .scene.on .sbg");
  const first = await activeImage.getAttribute("src");
  assert.match(first, /20261120$/);
  const clockFill = page.locator("#scenes .scene.on .gclock .fill");
  const seconds = clockFill.locator(".clock-seconds");
  await clockFill.evaluate(el => { window.originalClockFill = el; });
  const firstSeconds = await seconds.textContent();
  assert.match(await clockFill.textContent(), /^14:05:\d{2}$/);
  await page.clock.runFor(1000);
  assert.notEqual(await seconds.textContent(), firstSeconds);
  assert.ok(await clockFill.evaluate(el => window.originalClockFill === el));
  await page.clock.setSystemTime(new Date("2026-11-20T14:06:00Z"));
  await page.clock.runFor(1000);
  assert.match(await clockFill.textContent(), /^14:06:\d{2}$/);

  offline = true;
  await page.evaluate(() => { window.bingVersion = "20261121"; });
  const failure = page.waitForEvent("requestfailed", request => request.url().endsWith("20261121"));
  await page.clock.runFor(15_001);
  await failure;
  assert.equal(await activeImage.getAttribute("src"), first);

  offline = false;
  await page.clock.runFor(15_001);
  await page.waitForFunction(() => document.querySelector("#scenes .scene.on .sbg")?.src.endsWith("20261121"));
  assert.equal(await page.locator("#scenes .scene").count(), 1);
  assert.deepEqual(errors, []);
  console.log("Daily Bing photo replaces the single active scene after a successful refresh.");
} finally {
  await browser?.close();
  server.close();
}
