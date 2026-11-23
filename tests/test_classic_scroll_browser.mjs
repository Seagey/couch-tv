// #203 (Sony X82L): with 15+ apps the Classic grid did not scroll, so the focus went below the screen.
// Checked in a real browser at 1920x1080 (the TV home in its ?mock preview): with 40+ apps and More apps
// opened, every tile the remote lands on is fully on the screen, the grid slides up by whole rows with the
// Keep watching row faded out, and it comes back down when the remote goes back up.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_classic_scroll_browser.mjs
// (COUCHTV_CHANNEL=chrome uses an installed Chrome instead of Playwright's own Chromium.)
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

const browser = await chromium.launch(process.env.COUCHTV_CHANNEL ? { channel: process.env.COUCHTV_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// 20 more apps than the mock has, so More apps lists well over three rows
await page.route("**/mock.js", async (r) => {
  const res = await r.fetch();
  const extra = Array.from({ length: 20 }, (_, i) => '["com.fake.app' + i + '", "Extra ' + (i + 1) + '", "#2a2a30"]').join(",");
  r.fulfill({ response: res, body: (await res.text()).replace("window.MOCK_APPS = apps.map(", "apps.splice(apps.length - 3, 0, " + extra + "); window.MOCK_APPS = apps.map(") });
});
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "?mock=1&theme=classic");
await page.waitForFunction(() => document.getElementById("date") && document.getElementById("date").textContent.length > 0);
await page.waitForTimeout(1000);

const focus = () => page.evaluate(() => {
  const f = document.querySelector(".tile.focus");
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return { text: (f.querySelector(".label") || f).textContent.trim(), bottom: r.bottom, top: r.top };
});
const press = async (k, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(k); await page.waitForTimeout(260); } };

// walk down to the last visible row and across to More apps, then open it
await press("ArrowDown", 4);
for (let i = 0; i < 10; i++) { const f = await focus(); if (f && /^More apps/.test(f.text)) break; await press("ArrowRight"); }
await press("Enter");
await page.waitForTimeout(800);
ok(await page.evaluate(() => document.documentElement.classList.contains("expanded")), "More apps opened the full list");
const tiles = await page.evaluate(() => document.querySelectorAll("#grid .tile").length);
ok(tiles > 40, "the full list has more than three rows of eight (" + tiles + " tiles)");

// walk down the first column to the very end, every step on screen
const seen = [];
for (let i = 0; i < 12; i++) {
  await press("ArrowDown");
  const f = await focus();
  if (!f) continue;                              // up on the people or the cards: not a grid tile
  ok(f.bottom <= 1080 && f.top >= 0, "the focused tile is on the screen: " + f.text + " (top " + Math.round(f.top) + ", bottom " + Math.round(f.bottom) + ")");
  seen.push(await page.evaluate(() => ({ scrolled: document.documentElement.classList.contains("grid-scrolled"), shelf: getComputedStyle(document.querySelector(".shelf")).opacity, top: getComputedStyle(document.querySelector("header.top")).opacity, tf: document.getElementById("apps-section").style.transform })));
}
ok(seen.some((s) => s.scrolled && s.tf.indexOf("translateY(-") === 0), "the grid slid up on the lower rows");
ok(seen.filter((s) => s.scrolled).every((s) => s.shelf === "0"), "the Keep watching row fades out while the grid is up");
ok(seen.filter((s) => s.scrolled).every((s) => s.top === "0"), "the clock, people and quick buttons fade out too, so the grid does not slide under them");

// back up: the grid comes back down
await press("ArrowUp", 8);
const top = await page.evaluate(() => ({ scrolled: document.documentElement.classList.contains("grid-scrolled"), tf: document.getElementById("apps-section").style.transform }));
ok(!top.scrolled && top.tf === "", "back at the top the grid is down again (" + JSON.stringify(top) + ")");
await page.waitForTimeout(400);
ok(await page.evaluate(() => getComputedStyle(document.querySelector("header.top")).opacity === "1"), "and the header is back");
ok(errors.length === 0, "no page errors: " + errors.join("; "));

await browser.close();
server.close();
console.log("Classic grid scroll browser tests passed (" + n + " checks).");
