// The live card link kept in the account (Your details, Card; details.card.url, lane F 28 Nov) on the real home page:
//  1. A held pack with details.card.url makes the TV read that link itself and draw its live numbers (as custom cards).
//  2. With no link in the account (and none in the home's own settings) nothing is fetched.
// Needs Playwright (Chromium); without it the test says so and passes:  COUCHTV_PLAYWRIGHT=<folder> node tests/test_account_card_browser.mjs
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
const seen = [];
const CARDS = JSON.stringify({ cards: [{ title: "Solar today", value: "18.4 kWh" }, { title: "Pool", value: "26 °C" }] });
const server = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url.startsWith("/live/cards.json")) { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(CARDS); return; }
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port, BASE = ORIGIN + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const pack = (details) => ({ v: 1, rev: 3, at: "2026-11-28T05:10:00.000Z", wipe: false, people: [{ id: "p_8d1q0z", name: "Alex", kids: false, colour: null, photo: null }],
  town: { name: "Bellingen", lat: -30.45, lon: 152.9 }, ...(details ? { details } : {}) });

const browser = await chromium.launch();
async function start(p) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&offline=1&reset=1");
  await page.evaluate((pk) => { localStorage.clear(); if (pk) localStorage.setItem("couchtv.home.pack", JSON.stringify(pk)); }, p);
  await page.goto(BASE + "?mock=1&offline=1");
  await page.waitForFunction(() => document.getElementById("people") && window.CouchDesignCode);
  await page.waitForTimeout(3500);
  return page;
}
console.log("Running account live card browser tests...");
try {
  seen.length = 0;
  const a = await start(pack({ card: { url: ORIGIN + "/live/cards.json" } }));
  ok(seen.some((u) => u.startsWith("/live/cards.json")), "the TV reads the account's live card link itself");
  const txt = await a.evaluate(() => Array.from(document.querySelectorAll(".ccard")).map((e) => e.textContent).join(" | "));
  ok(/Solar today/.test(txt) && /18\.4 kWh/.test(txt), "its live numbers are drawn: " + txt);
  ok(!a.errors.length, "no page errors: " + a.errors.join(", "));
  await a.close();

  seen.length = 0;
  const b = await start(pack({ note: { text: "Back at five", from: "Mum" } }));
  ok(!seen.some((u) => u.startsWith("/live/")), "no link in the account: nothing is read");
  ok(!(await b.evaluate(() => document.querySelectorAll(".ccard").length)), "and no card is drawn");
  ok(!b.errors.length, "no page errors: " + b.errors.join(", "));
  await b.close();
  console.log("account live card browser tests: " + n + " checks pass");
} finally {
  await browser.close();
  server.close();
}
