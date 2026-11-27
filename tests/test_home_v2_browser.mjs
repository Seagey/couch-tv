// Pack v2 on the real home page (the TV home in its ?mock preview, with and without a bridge), Phase 2 shared base:
//  1. A held pack that is v 1 with the extra parts (details, photo links, keys) is applied when the home starts: the details land in At home,
//     the keys never sit in page storage, the account's photos join the photo list with their day by photo id, a TV's own change wins.
//  2. A wipe takes out only what the account gave.  3. A pack older than the one applied is ignored.
// Needs Playwright (Chromium); without it the test says so and passes:  COUCHTV_PLAYWRIGHT=<folder> node tests/test_home_v2_browser.mjs
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


const PID = "a".repeat(24);
const LINK = "https://abc.supabase.co/storage/v1/object/sign/tvd-photos/11111111-1111-4111-8111-111111111111/" + PID + ".jpg?token=abc.def.ghi";
const PACK2 = Object.assign({}, PACK, { rev: 9, wifi: undefined,
  details: { note: { text: "Back at five", from: "Mum" }, guest: { name: "Sarah" }, screen: { goal: 120 }, places: { w_abc: { name: "Bega", lat: -28.87, lon: 153.56 } } },
  keys: { ha: { token: "SECRET-HA-TOKEN-123", url: "https://ha.example:8123" } },
  photos: { albums: [{ id: "alb1", name: "Beach", photos: [{ id: PID, taken: "2020-05-05", url: LINK }] }] } });
console.log("Running pack v2 browser tests...");
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.errors = [];
page.on("pageerror", (e) => page.errors.push(String(e)));
let linkHits = 0, linkUp = true;
await page.route("https://abc.supabase.co/**", (r) => { linkHits++; if (!linkUp) return r.abort(); r.fulfill({ status: 200, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" }, body: Buffer.from(JPEG.split(",")[1], "base64") }); });
await page.goto(BASE + "?mock=1&offline=1&reset=1");
await page.evaluate((p) => {
  localStorage.clear();
  localStorage.setItem("mock:tvhome.people.list", JSON.stringify({ people: [{ id: "mum", name: "Mum" }], pending: true }));
  localStorage.setItem("couchtv.home.pack", JSON.stringify(p));
}, PACK2);
await page.goto(BASE + "?mock=1&offline=1");
await page.waitForTimeout(3500);
const ah = await local(page, "mock:tvhome.athome");
ok(ah && ah.note && ah.note.text === "Back at five", "the note is in At home: " + JSON.stringify(ah));
ok(ah.guest && ah.guest.name === "Sarah", "the guest name too");
ok(ah.screen && ah.screen.goal === 120, "and the screen goal");
const acct = await local(page, "mock:tvhome.home.account");
ok(acct && acct.details && acct.details.places.w_abc.name === "Bega", "the account record holds the details (the widget's own place)");
const all = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
ok(!all.includes("SECRET-HA-TOKEN"), "no key in page storage, anywhere");
ok(!/home\.pack/.test(await page.evaluate(() => Object.keys(localStorage).join())) , "the held pack is taken");
const st = await local(page, "mock:tvhome.settings");
const photos = (st && st.s && st.s.photos) || [];
ok(photos.length === 1 && photos[0].id === "acc_" + PID, "the account's photo joined the photo list: " + JSON.stringify(photos) + " hits " + linkHits + " errs " + page.errors.join("|") + " " + JSON.stringify(await page.evaluate(() => Object.keys(localStorage))));
ok(photos[0].url === "idb:acc_" + PID, "with no launcher and no computer the picture is kept in the browser's own database, not as a link: " + JSON.stringify(photos[0]));
const idbSize = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("couchtv-photos", 1); r.onerror = () => res(-1); r.onsuccess = () => { const g = r.result.transaction("p").objectStore("p").get("acc_" + "a".repeat(24)); g.onsuccess = () => res(g.result ? g.result.size : 0); g.onerror = () => res(-1); }; }));
ok((await idbSize()) > 100, "the picture itself is in IndexedDB");
const hitsBefore = linkHits; linkUp = false;
await page.reload(); await page.waitForTimeout(2000);
ok((await idbSize()) > 100 && linkHits === hitsBefore, "after the link has stopped working the picture is still there and the link is not asked for again");
ok(acct.photoMap && acct.photoMap[PID] && acct.photoMap[PID].day === "2020-05-05", "its day is kept by photo id, not by link");
ok(!JSON.stringify(acct).includes("token=abc"), "the signed link is not kept in the account record");
ok(!page.errors.length, "no page errors: " + page.errors.join(" | "));

// a change made on this TV beats the account; an older pack is ignored
await page.evaluate(() => { const a = JSON.parse(localStorage.getItem("mock:tvhome.athome")); a.note = { text: "Typed on the TV", from: "", at: 1 }; localStorage.setItem("mock:tvhome.athome", JSON.stringify(a)); });
await page.evaluate((p) => localStorage.setItem("couchtv.home.pack", JSON.stringify(Object.assign({}, p, { rev: 10, details: { note: { text: "Back at six" }, guest: { name: "Sarah" } } }))), PACK2);
await page.reload(); await page.waitForTimeout(1800);
const ah2 = await local(page, "mock:tvhome.athome");
ok(ah2.note.text === "Typed on the TV", "the TV's own note is left alone");
await page.evaluate((p) => localStorage.setItem("couchtv.home.pack", JSON.stringify(Object.assign({}, p, { rev: 3, details: { note: { text: "Old" } } }))), PACK2);
await page.reload(); await page.waitForTimeout(1500);
ok((await local(page, "mock:tvhome.athome")).note.text === "Typed on the TV", "an older pack changes nothing");

// a wipe takes only what the account gave
await page.evaluate(() => localStorage.setItem("couchtv.home.pack", JSON.stringify({ v: 1, rev: 11, wipe: true })));
await page.reload(); await page.waitForTimeout(1800);
const ah3 = await local(page, "mock:tvhome.athome") || {};
ok(ah3.note && ah3.note.text === "Typed on the TV", "the TV's own note survives a wipe");
ok(!ah3.guest, "the account's guest name is gone");
const st3 = await local(page, "mock:tvhome.settings");
ok(!((st3.s.photos || []).length), "the account's photos are gone");
ok(!page.errors.length, "no page errors after the wipe: " + page.errors.join(" | "));
await browser.close();
server.close();
console.log("Pack v2 browser tests passed (" + n + " checks).");
