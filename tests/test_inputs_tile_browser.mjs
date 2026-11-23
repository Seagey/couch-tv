// #154: an optional Inputs tile first in the dock (home.input_tile), for a simple home. Checked in a real
// browser at 1920x1080 (the TV home in its ?mock preview, with four HDMI ports standing in): off, nothing
// changes; on, it is the first tile in the Night dock and the Classic grid, takes one place (the dock is as
// wide as before), opens the Input menu above the tile, and Back returns to the tile.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_inputs_tile_browser.mjs
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
const errors = [];
async function home(q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&inputs=4" + q);
  await page.waitForFunction(() => document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(900);
  return page;
}
const tiles = (page) => page.evaluate(() => [...document.querySelectorAll("#grid .tile")].map((t) => (t.querySelector(".label") || t).textContent.trim()));
const focusText = (page) => page.evaluate(() => { const f = document.querySelector(".tile.focus"); return f ? (f.querySelector(".label") || f).textContent.trim() : null; });

for (const look of ["night", "classic"]) {
  // off by default: no Inputs tile, whatever the look
  let page = await home("&theme=" + look);
  const base = await tiles(page);
  ok(!base.some((t) => /^Input/.test(t)), look + ": no Inputs tile unless it is switched on");
  await page.close();

  // on: first, and taking one place in the dock
  page = await home("&theme=" + look + "&inputtile=1");
  const on = await tiles(page);
  ok(/^Input/.test(on[0]), look + ": the Inputs tile is first (" + on.slice(0, 3).join(" | ") + ")");
  if (look === "night") ok(on.length === base.length, "night: the dock is as wide as before (" + on.length + " tiles, was " + base.length + ")");
  ok(on.slice(1).every((t) => !/^Input/.test(t)), look + ": only one Inputs tile");

  // the remote reaches it and opens the Input menu above it
  // down from the people into the dock, then left along it to the first tile
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.querySelector(".tile.app.focus"))); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(200); }
  for (let i = 0; i < 14 && !/^Input/.test((await focusText(page)) || ""); i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(200); }
  ok(/^Input/.test((await focusText(page)) || ""), look + ": the remote lands on the Inputs tile");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => { const p = document.getElementById("inputs-pop"), r = p.getBoundingClientRect(), f = document.querySelector(".tile.focus").getBoundingClientRect();
    return { on: p.classList.contains("on"), items: [...p.querySelectorAll(".grow b")].map((b) => b.textContent), clear: r.bottom <= f.top + 1 || r.left >= f.right - 1, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
  ok(menu.on, look + ": OK on the tile opens the Input menu");
  ok(menu.items.length >= 4, look + ": it lists the ports (" + menu.items.join(", ") + ")");
  ok(menu.clear && menu.inside, look + ": the menu is clear of the tile (above it, or beside it) and inside the screen");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok(!(await page.evaluate(() => document.getElementById("inputs-pop").classList.contains("on"))), look + ": Back closes the menu");
  ok(/^Input/.test((await focusText(page)) || ""), look + ": and the focus is back on the tile");
  await page.close();
}
ok(errors.length === 0, "no page errors: " + errors.join("; "));
await browser.close();
server.close();
console.log("Inputs tile browser tests passed (" + n + " checks).");
