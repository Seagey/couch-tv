// S2 (20 Nov 2026): Home settings' Change this on your phone QR and its computer line never show a dead
// code. The on-TV app tells the page when the code changes (HomeActivity, Auth.onPin, tv.phoneLink): the
// line shows the new code. A failed /api/phone-link hides the box and asks again 10 seconds later.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_link_fresh_browser.mjs
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const HOME = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1&ontv=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(HOME + "?mock=1&ontv=1");
  await page.waitForFunction(() => window.tv && document.getElementById("settings"));
  await page.waitForTimeout(1500);
  ok((await page.evaluate(() => typeof window.tv.phoneLink)) === "function", "tv.phoneLink exists for the app to call");
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300);
  await page.keyboard.press("Enter"); await page.waitForTimeout(900);
  const line = () => page.evaluate(() => ({ on: document.getElementById("set-phone").classList.contains("on"), pc: document.getElementById("set-phone-pc").textContent }));
  let l = await line();
  ok(l.on, "the QR box shows in Home settings");
  ok(/482 913/.test(l.pc), "the computer line shows the first code: " + l.pc);
  // the code changes on the TV (used, 5 wrong tries, or near its end): the app calls tv.phoneLink
  await page.evaluate(() => { localStorage.setItem("mock:phonePin", "111222"); window.tv.phoneLink(); });
  await page.waitForTimeout(800);
  l = await line();
  ok(l.on && /111 222/.test(l.pc), "the computer line shows the new code at once: " + l.pc);
  ok(!/482 913/.test(l.pc), "the old code is gone");
  // the QR itself was drawn again (its link holds the code)
  const svg1 = await page.evaluate(() => document.getElementById("set-phone-qr").innerHTML.length);
  ok(svg1 > 100, "the QR is drawn");
  // /api/phone-link fails (pairing locked): the box goes, never a dead code
  await page.evaluate(() => { localStorage.setItem("mock:phoneLinkFail", "1"); window.tv.phoneLink(); });
  await page.waitForTimeout(800);
  l = await line();
  ok(!l.on, "a failed phone link hides the box");
  // it asks again by itself
  await page.evaluate(() => { localStorage.removeItem("mock:phoneLinkFail"); localStorage.setItem("mock:phonePin", "333444"); });
  await page.waitForTimeout(11500);
  l = await line();
  ok(l.on && /333 444/.test(l.pc), "10 seconds later it asks again and shows the live code: " + l.pc);
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log("phone link fresh: " + n + " checks passed");
