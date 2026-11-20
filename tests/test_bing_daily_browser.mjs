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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.bingVersion = "20261120";
    window.TVOS = { dailyBingPhoto: () => window.bingVersion, apps: () => "[]" };
  });
  await page.route("**/config.js", route => route.fulfill({
    contentType: "text/javascript",
    body: "window.COUCH_CONFIG={home:{look:'night',bing_daily_background:true},people:[{id:'owner',name:'Owner'}]};"
  }));
  let offline = false;
  await page.route("http://tvos.invalid/bing-daily-photo/*", route => offline ? route.abort() : route.fulfill({
    path: path.join(root, route.request().url().endsWith("20") ? "backgrounds/scene-night.jpg" : "backgrounds/scene-golden.jpg"),
    contentType: "image/jpeg"
  }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?offline=1&alone=1`);
  await page.waitForFunction(() => document.querySelector("#scenes .sbg")?.naturalWidth > 0);
  assert.equal(await page.locator("#scenes .scene").count(), 1);
  const activeImage = page.locator("#scenes .scene.on .sbg");
  const first = await activeImage.getAttribute("src");
  assert.match(first, /20261120$/);

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
