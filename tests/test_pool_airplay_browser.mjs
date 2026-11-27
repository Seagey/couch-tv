// The pool widget and the Speakers widget's AirPlay group on the real TV page (lane C, 28 Nov 2026), in the mock home:
//   - pool through Home Assistant (?ha=1): the water, the parts named in the design, at every size it lists; OK opens its layer
//     and a switch goes to Home Assistant through the launcher; nothing set up gives the setup card
//   - pool through Connect 10: no launcher gives "Not on this TV yet"; the account's answer (tv.accountPool) draws the readings;
//     (what the launcher sends Studio is tested in AccountLinkTest: poolBody)
//   - Speakers with ?airplay=1 (mock.js, the same pretend Mac as the bridge's FAKE_AIRPLAY): the speakers and the group, Play
//     together, a speaker's volume; no speaker is ever real
//   - Couch TV Studio's demo draws the pool, and the Speakers demo stays the Home Assistant one
// Needs Playwright: COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_pool_airplay_browser.mjs
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
const browser = await chromium.launch();
const SHOTS = process.env.SHOTS || "";

async function home(objects, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, { v: 1, background: { colour: "#26303f" }, objects });
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => document.querySelector(".cd-layer") && window.CouchWidgets && window.CouchWidgetCaps);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  return page;
}
const press = async (page, key, wait) => { await page.keyboard.press(key); await page.waitForTimeout(wait || 300); };
async function openOn(page, id) {
  await page.evaluate((i) => { const s = window.CouchDesign.nav; for (let k = 0; k < 6 && s.current().id !== i; k++) s.move(-1, 0); }, id);
  await press(page, "Enter", 800);
}
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
// a widget in the design's own pixels (x, y, w, h), the way Couch TV Studio places one
const W = (id, kind, at, opts) => ({ type: "widget", id, kind, x: 80 + at[0], y: 60 + at[1], w: at[2], h: at[3], opts: opts || {} });
const ROLES = { water: "sensor.pool", pump: "fan.bedroom", heater: "climate.bedroom", light: "light.lounge", chlor: "sensor.rain_today" };

console.log("Running the pool and AirPlay browser tests...");

// ---- 1. pool through Home Assistant, every size it lists
{
  const sizes = { tile: [260, 260], wtile: [560, 200], small: [560, 560], medium: [760, 400], wide: [1160, 400], large: [760, 760] };
  const objs = Object.entries(sizes).map(([s, wh], i) => W("p" + i, "pool", [0, 0, wh[0], wh[1]], ROLES));
  for (const [i, o] of objs.entries()) {
    const page = await home([o], "&ha=1");
    await page.waitForFunction(() => /26°/.test((document.querySelector(".cw-k-pool") || {}).innerText || ""), null, { timeout: 8000 }).catch(() => {});
    let t = await text(page, ".cw-k-pool");
    ok(/26°/.test(t), Object.keys(sizes)[i] + ": the water from sensor.pool (" + JSON.stringify(t) + ")");
    ok(page.errors.length === 0, Object.keys(sizes)[i] + ": no page errors " + page.errors.join(" | "));
    if (Object.keys(sizes)[i] === "large") {
      // the switches come with the next Home Assistant read (controls), a moment after the sensors
      await page.waitForFunction(() => /Pump/.test(document.querySelector(".cw-k-pool").innerText), null, { timeout: 15000 }).catch(() => {});
      t = await text(page, ".cw-k-pool");
      ok(/Pump/.test(t) && /Heater/.test(t) && /Lights/.test(t), "large: a box for each part: " + JSON.stringify(t));
      ok(/Chlorinator/.test(t) && /12 mm/.test(t), "large: the chlorinator line");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "pool-ha-large.png") });
      // OK opens the layer; a switch asks Home Assistant through the launcher
      await openOn(page, o.id);
      ok((await page.evaluate(() => window.CouchDetail.current().name)) === "pool", "OK opens the pool layer");
      await page.waitForSelector(".cwd-toggle", { timeout: 5000 });
      const names = await page.$$eval(".cwd-stop", (l) => l.map((e) => e.getAttribute("data-name")));
      ok(names.includes("Pump") && names.includes("Heater") && names.includes("Lights"), "the layer has the three switches: " + names);
      await page.evaluate(() => { window.MOCK_HA_LAST = ""; });
      for (let k = 0; k < 4 && (await page.evaluate(() => window.CouchDetail.current().focusName)) !== "Lights"; k++) await press(page, "ArrowRight", 200);
      await press(page, "Enter", 700);
      const last = await page.evaluate(() => window.MOCK_HA_LAST);
      ok(/light\.lounge/.test(last || ""), "the lights go to Home Assistant: " + last);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "pool-ha-layer.png") });
    }
    await page.close();
  }
  // nothing set up: the setup card
  const none = await home([W("p9", "pool", [0, 0, 560, 560])], "");
  { const st = await text(none, ".cw-k-pool"); ok(/Your pool|Set up|Home Assistant/i.test(st) && !/°/.test(st), "no Home Assistant: the setup card: " + JSON.stringify(st)); }
  await none.close();
}

// ---- 2. pool through Connect 10
{
  const page = await home([W("c1", "pool", [0, 0, 1160, 200], { via: "connect10" })], "");
  await page.waitForFunction(() => /Not on this TV yet/.test(document.querySelector(".cw-k-pool").innerText), null, { timeout: 10000 }).catch(() => {});
  ok(/Not on this TV yet/.test(await text(page, ".cw-k-pool")), "no launcher: says so plainly: " + JSON.stringify(await text(page, ".cw-k-pool")));
  ok(await page.evaluate(() => !!document.querySelector('.cd-layer [data-pool="c10"]')), "the widget is marked for the account's readings");
  // the launcher's answer, as AccountLink.pool hands it on
  await page.evaluate(() => window.tv.accountPool(JSON.stringify({ ok: true, pool: { ok: true, unit: "c", temp: 28, pump: { n: 1, name: "Filter Pump", mode: 1 }, heater: { n: 1, mode: 0, set: 29 }, light: { n: 1, name: "Pool lights", mode: 2, colour: "Blue" } } })));
  await page.waitForFunction(() => /28°/.test(document.querySelector(".cw-k-pool").innerText), null, { timeout: 5000 });
  const t = await text(page, ".cw-k-pool");
  ok(/28°/.test(t) && /Filter Pump/.test(t) && /Auto/.test(t), "the Connect 10 readings (a chip that does not fit is left out whole): " + JSON.stringify(t));
  ok(!/ABCD|pool_api_code/.test(await page.content()), "no approval code anywhere in the page");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "pool-c10-wide.png") });
  for (const err of ["not_allowed", "no_key", "offline"]) {
    await page.evaluate((e) => window.tv.accountPool(JSON.stringify({ ok: false, error: e })), err);
    await page.waitForTimeout(150);
    ok((await text(page, ".cw-k-pool")).length > 0, "error " + err + " says something");
  }
  ok(page.errors.length === 0, "Connect 10: no page errors " + page.errors.join(" | "));
  await page.close();
}

// ---- 3. Speakers with AirPlay (pretend Mac)
{
  const page = await home([W("s1", "speakers", [0, 0, 760, 760])], "&airplay=1");
  await page.waitForFunction(() => /Lounge/.test((document.querySelector(".cw-k-speakers") || {}).innerText || ""), null, { timeout: 10000 });
  let t = await text(page, ".cw-k-speakers");
  ok(/Whole House/.test(t) && /Ready/.test(t), "the AirPlay group, not playing yet: " + JSON.stringify(t));
  ok(/Kitchen/.test(t) && /40%/.test(t), "each AirPlay speaker and its volume");
  // the layer: Play together, then a speaker louder
  await openOn(page, "s1");
  await page.waitForSelector('.cwd-stop[data-name="AirPlay group"]', { timeout: 5000 });
  for (let k = 0; k < 8 && (await page.evaluate(() => window.CouchDetail.current().focusName)) !== "AirPlay group"; k++) await press(page, "ArrowUp", 200);
  await press(page, "Enter", 800);
  await page.waitForFunction(() => window.__mockAirplay && window.__mockAirplay.active, null, { timeout: 5000 });
  const ap = await page.evaluate(() => window.__mockAirplay);
  ok(ap.active && ap.selected.join() === "Lounge,Kitchen", "Play together takes the speakers that answer: " + ap.selected);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "speakers-airplay-layer.png") });
  ok(page.errors.length === 0, "AirPlay: no page errors " + page.errors.join(" | "));
  await page.close();
  // no AirPlay and no Home Assistant: the setup card, as before
  const none = await home([W("s2", "speakers", [0, 0, 760, 760])], "");
  await none.waitForTimeout(500);
  ok(!/Whole House/.test(await text(none, ".cw-k-speakers")), "no AirPlay here: no group");
  await none.close();
}

// ---- 4. Couch TV Studio's demo
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgets.kit);
  const demo = await page.evaluate(() => {
    const K = window.CouchWidgets.kit;
    return { pool: K.ha.poolOf({ demo: true }, { kind: "pool", opts: {} }), ap: K.ha.airplayOf({ demo: true }) };
  });
  ok(demo.pool && demo.pool.temp === 27 && demo.pool.parts.length === 3, "the designer's pool picture");
  ok(demo.ap === null, "the designer's Speakers picture stays the Home Assistant one");
  await page.close();
}

await browser.close();
server.close();
console.log("pool and AirPlay: " + n + " checks passed");
