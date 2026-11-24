// Your home, in a real browser at 1920x1080 (the TV home in its ?mock preview, with its pretend bridge):
//  1. A pack that came with a design (design-code.js holds it as couchtv.home.pack) is applied when the
//     home starts: the account's people first with their photos in the head icon and its list, the TV's
//     own person after them, "From your account" in Home settings, People, the town in Location, the
//     guest Wi-Fi in At home. It is taken once.
//  2. The photos stay in the account record: never in the list handed to the bridge, never in Home
//     settings' copy, never in the page's address.
//  3. A wipe takes out only what came from the account.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_home_details_browser.mjs
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

console.log("Running Your home browser tests...");
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.errors = [];
page.on("pageerror", (e) => page.errors.push(String(e)));
// the mock keeps its pretend bridge in page storage too: start it with one person added on the TV
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate(() => localStorage.setItem("mock:api.people", JSON.stringify([{ id: "mum", name: "Mum" }])));
await start(page, PACK);

// 1. applied once, account first
ok(await local(page, "couchtv.home.pack") === null, "the held pack is taken");
const list = (await local(page, "mock:tvhome.people.list")).people;
ok(list.map((p) => p.id).join() === "p_3k9x2m,p_8d1q0z,p_77aa11,mum", "account people first, then the TV's own: " + list.map((p) => p.id).join());
ok(list[0].src === "account" && list[0].kid === true && !list[3].src, "marked from the account, with the kids flag");
const head = await page.evaluate(() => document.getElementById("people").innerHTML);
ok(/class="avatar-photo" src="data:image\/jpeg;base64,/.test(head), "the head icon shows Ruby's photo");
ok(await page.evaluate(() => { const i = document.querySelector("#people .avatar-photo"); return !!i && i.complete && i.naturalWidth > 0; }), "and it draws");
const st = (await local(page, "mock:tvhome.settings")).s;
ok(st.place && st.place.name === "Bellingen" && st.place.src === "account" && st.place.lat === -30.45, "the town is in Location, marked");
const ah = await local(page, "mock:tvhome.athome");
ok(ah && ah.wifi && ah.wifi.ssid === "Beach house guest" && ah.wifi.pass === "correct horse battery", "the guest Wi-Fi is in At home");
const acc = await local(page, "mock:tvhome.home.account");
ok(acc && acc.rev === 7 && acc.people[0].photo === JPEG, "the account record keeps the photos");

// 2. photos nowhere else
const elsewhere = await page.evaluate(() => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== "mock:tvhome.home.account") o.push(localStorage.getItem(k)); } return o.join("\n") + location.href; });
ok(elsewhere.indexOf("/9j/4AAQ") < 0, "no photo in the people list, the pretend bridge, Home settings' copy or the address");
ok(seen.every((u) => !/9j|Ruby|Bellingen|horse/.test(u)), "nothing of it went to a server");

// Home settings, People: the photos in the rows and the mark
await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
for (let i = 0; i < 14 && !(await page.evaluate(() => /People/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
await press(page, "ArrowRight", 400);
const rows = await page.evaluate(() => document.getElementById("set-rows").textContent);
ok(/Ruby/.test(rows) && /From your account/.test(rows) && /Change these names in your Couch TV Studio account/.test(rows), "People says From your account and where to change them");
ok(await page.evaluate(() => document.querySelectorAll("#set-rows .avatar-photo").length) === 2, "Ruby's and Nan's photos in the rows");
ok(/Take your account's names, town and guest Wi-Fi off this TV/.test(rows), "and a way to take them off this TV");
await press(page, "Escape", 200); await press(page, "Escape", 600);

// a reload keeps it all (the account record, not the pack)
await page.reload(); await page.waitForTimeout(1200);
ok(/avatar-photo/.test(await page.evaluate(() => document.getElementById("people").innerHTML)), "after a restart the photo is still there");

// an older pack typed late changes nothing
await page.evaluate((p) => localStorage.setItem("couchtv.home.pack", JSON.stringify(Object.assign({}, p, { rev: 3, people: [] }))), PACK);
await page.reload(); await page.waitForTimeout(1200);
ok((await local(page, "mock:tvhome.people.list")).people.length === 4, "an older pack is ignored");

// 3. a wipe: only the account's
await page.evaluate(() => localStorage.setItem("couchtv.home.pack", JSON.stringify({ v: 1, rev: 8, wipe: true })));
await page.reload(); await page.waitForTimeout(1500);
const after = (await local(page, "mock:tvhome.people.list")).people;
ok(after.map((p) => p.id).join() === "mum", "only the TV's own person is left: " + after.map((p) => p.id).join());
ok(!(await local(page, "mock:tvhome.settings")).s.place, "the account's town is gone");
ok(!(await local(page, "mock:tvhome.athome")).wifi, "the account's guest Wi-Fi is gone");
ok(!(await local(page, "mock:tvhome.home.account")).people.length, "and the photos");
ok(!/avatar-photo/.test(await page.evaluate(() => document.body.innerHTML)), "no photo drawn anywhere");

ok(!page.errors.length, "no page errors: " + page.errors.join(" | "));

// 4. no bridge at all (option A, the saved copy): applied straight away, into the list this TV keeps
const off = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
off.errors = [];
off.on("pageerror", (e) => off.errors.push(String(e)));
await off.goto(BASE + "?mock=1&offline=1&reset=1");
await off.evaluate((p) => {
  localStorage.clear();
  localStorage.setItem("mock:tvhome.people.list", JSON.stringify({ people: [{ id: "mum", name: "Mum" }, { id: "dad", name: "Dad" }], pending: true }));
  localStorage.setItem("couchtv.home.pack", JSON.stringify(p));
}, PACK);
await off.goto(BASE + "?mock=1&offline=1");
await off.waitForTimeout(1500);
ok((await local(off, "mock:tvhome.people.list")).people.map((p) => p.id).join() === "p_3k9x2m,p_8d1q0z,p_77aa11,mum,dad", "with no bridge: the account's first, the TV's after");
ok(/avatar-photo/.test(await off.evaluate(() => document.getElementById("people").innerHTML)), "the photo shows with no bridge too");
ok(!off.errors.length, "no page errors offline: " + off.errors.join(" | "));
await browser.close();
server.close();
console.log("Your home browser tests passed (" + n + " checks).");
