// Home Assistant and Ask AI keys from the account on the real home page (the TV home in its ?mock preview with a pretend launcher), Phase 2:
//  - nothing set up here: the account's Home Assistant is kept "from the account" with the ticks it names; an identical pack does not apply it again;
//    "Remove my keys" (a pack with no keys, or the inbox's drop_keys) forgets it.
//  - a Home Assistant set up on this TV by hand is never replaced and never forgotten, and its ticks never change.
//  - an unlinked answer from the inbox drops the account's keys.  - the key never sits in page storage.
// Needs Playwright (Chromium); without it the test says so and passes:  COUCHTV_PLAYWRIGHT=<folder> node tests/test_home_ha_keys_browser.mjs
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
const server = http.createServer((req, res) => {
  seen.push(req.url);
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

// a real 8 by 8 JPEG (grey), so the photo actually draws
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const PACK = { v: 1, rev: 7, at: "2026-11-24T05:10:00.000Z", wipe: false,
  people: [
    { id: "p_3k9x2m", name: "Ruby", kids: true, colour: "#e07a5f", photo: JPEG },
    { id: "p_8d1q0z", name: "Alex", kids: false, colour: "#3d5a80", photo: null },
    { id: "p_77aa11", name: "Nan", kids: false, colour: null, photo: JPEG }
  ],
  town: { name: "Bellingen", lat: -30.45, lon: 152.9 },
  wifi: { name: "Beach house guest", password: "correct horse battery" } };

const browser = await chromium.launch();
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
async function start(page, pack) {
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem("mock:api.people", JSON.stringify([{ id: "mum", name: "Mum" }]));
    if (p) localStorage.setItem("couchtv.home.pack", JSON.stringify(p));
  }, pack);
  await page.goto(BASE + "?mock=1");
  await page.waitForFunction(() => document.getElementById("people") && window.CouchDesignCode);
  await page.waitForTimeout(1200);
}
const local = (page, k) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), k);



const HA = { token: "test-token-for-the-preview-only", url: "http://homeassistant.local:8123" };
const pack = (rev, keys, details) => ({ v: 1, rev, at: "2026-11-27T01:00:00.000Z", people: [], keys, details: details || { smart: { picks: { w_air: ["climate.lounge"], w_scenes: ["scene.movie_night"] } } } });
const stats = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem("mock:ha.state") || "{}").stats) || {});
const haState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mock:ha.state") || "null"));
async function fresh(extra) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  // a launcher with a private store, kept in page storage under "priv:" for the test
  await page.addInitScript(() => { window.TVOS = { keepPrivate: (k, v) => { try { localStorage.setItem("priv:" + k, v); } catch (e) {} }, keptPrivate: (k) => { try { return localStorage.getItem("priv:" + k); } catch (e) { return null; } } }; });
  await page.goto(BASE + "?mock=1&offline=1&hasetup=1&reset=1" + (extra || ""));
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto(BASE + "?mock=1&offline=1&hasetup=1" + (extra || ""));
  await page.waitForTimeout(800);
  return page;
}
// the pack arrives: held (keys to the private store), then the page starts again and applies it
async function arrive(page, p, extra) {
  await page.evaluate((x) => { CouchDesignCode.holdHome(CouchDesignCode.readHome(x)); }, p);
  await page.goto(BASE + "?mock=1&offline=1&hasetup=1" + (extra || ""));
  await page.waitForTimeout(2200);
}

console.log("Running Home Assistant key tests...");
// 1. nothing set up: the account's Home Assistant is kept from the account
let page = await fresh();
await arrive(page, pack(1, { ha: HA }));
let st = await haState(page);
ok(st && st.fromAcct === true && st.kept, "kept from the account: " + JSON.stringify(st));
ok(st.kept.climate && st.kept.climate[0].entity === "climate.lounge" && st.kept.scenes[0].entity === "scene.movie_night", "with the ticks the account names");
ok(st.stats.saves === 1, "applied once");
await arrive(page, pack(2, { ha: HA }));
ok((await stats(page)).saves === 1, "the same key again does not apply it again");
ok(!(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).replace(/priv:[^,]*/g, "").includes("test-token-for-the-preview-only"), "the token is only in the private store, never in other page storage");
// the account takes the key back: a pack with no keys, then it is forgotten
await arrive(page, pack(3, {}));
st = await haState(page);
ok(st.kept === null && st.stats.forgotten === 1, "Remove my keys forgets what came from the account");
ok(!page.errors.length, "no page errors: " + page.errors.join(" | "));
await page.close();

// 2. a set up made on this TV by hand: never replaced, never forgotten, its ticks stay
page = await fresh("&haown=1");
const own = (await haState(page)).kept;
await arrive(page, pack(1, { ha: HA }), "&haown=1");
st = await haState(page);
ok(st.fromAcct === false && st.stats.saves === 0, "a set up made here is not replaced");
ok(JSON.stringify(st.kept) === JSON.stringify(own), "and its ticks are untouched");
await arrive(page, pack(2, {}), "&haown=1");
st = await haState(page);
ok(st.kept && st.stats.forgotten === 0, "and Remove my keys does not forget it");
await page.close();

// 3. the account gives no picks: nothing goes blank (the kept ticks stay)
page = await fresh();
await arrive(page, pack(1, { ha: HA }, {}));
st = await haState(page);
ok(st.fromAcct === true, "connected with no picks");
await arrive(page, pack(2, { ha: Object.assign({}, HA, { url: "http://ha-two:8123" }) }, { smart: { picks: { w: ["light.lounge"] } } }));
st = await haState(page);
ok(st.kept.controls && st.kept.controls[0].entity === "light.lounge", "a new key with picks adds them");
await page.close();

// 4. the inbox says unlinked: the account's keys go; a drop_keys answer does the same
page = await fresh();
await arrive(page, pack(1, { ha: HA }));
ok((await haState(page)).fromAcct === true, "set up from the account");
await page.evaluate(() => window.tv && window.tv.accountInbox(JSON.stringify({ state: "unlinked" })));
await page.waitForTimeout(500);
st = await haState(page);
ok(st.kept === null && st.stats.forgotten === 1, "an unlinked TV drops the account's Home Assistant");
await page.close();
page = await fresh();
await arrive(page, pack(1, { ha: HA }));
await page.evaluate(() => window.tv && window.tv.accountInbox(JSON.stringify({ items: [], poll: 60, drop_keys: true, state: "none" })));
await page.waitForTimeout(500);
ok((await haState(page)).kept === null, "drop_keys from the inbox drops it too");
await page.close();
await browser.close();
server.close();
console.log("Home Assistant key tests passed (" + n + " checks).");
