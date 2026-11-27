// The account's details onto each widget on arrival, on the real home page (mock TV with a design on it), Phase 2 shared base:
//  own places (week, surf, weather, a stack's widget), the commute's two ends, bins, whose shows, stay names, and smart home picks
//  reaching the launcher's Home Assistant ticks. Each widget SHOWS the account's value; a change made on this TV wins until the account's
//  value changes; a wipe takes only what the account gave.
// Needs Playwright (Chromium):  COUCHTV_PLAYWRIGHT=<folder> node tests/test_home_widgets_browser.mjs
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

const DESIGN = { v: 1, background: { colour: "#26303f" }, elements: { dock: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: [
    { id: "wk1", type: "widget", kind: "week", x: 20, y: 20, w: 900, h: 300 },
    { id: "sf1", type: "widget", kind: "surf", x: 940, y: 20, w: 460, h: 300 },
    { id: "we1", type: "widget", kind: "weather", x: 1420, y: 20, w: 480, h: 300, opts: { place: true } },
    { id: "cm1", type: "widget", kind: "commute", x: 20, y: 340, w: 600, h: 300 },
    { id: "bn1", type: "widget", kind: "bins", x: 640, y: 340, w: 600, h: 300 },
    { id: "kp1", type: "widget", kind: "keeprow", x: 1260, y: 340, w: 640, h: 300 },
    { id: "st1", type: "widget", kind: "stack", x: 20, y: 660, w: 600, h: 300, items: [{ kind: "week" }, { kind: "hourly" }] },
    { id: "wf1", type: "widget", kind: "welcome", x: 640, y: 660, w: 600, h: 300 },
    { id: "ac1", type: "widget", kind: "aircon", x: 1260, y: 660, w: 300, h: 300 },
    { id: "pe1", type: "widget", kind: "people", x: 1580, y: 660, w: 320, h: 300 },
    { id: "so1", type: "widget", kind: "solar", x: 20, y: 980, w: 300, h: 90 }
  ] };
const PACK = (rev, details) => ({ v: 1, rev, at: "2026-11-28T05:10:00.000Z", wipe: false,
  people: [{ id: "p_3k9x2m", name: "Ruby", kids: true, colour: "#e07a5f", photo: null }, { id: "p_8d1q0z", name: "Alex", kids: false, colour: "#3d5a80", photo: null }],
  town: { name: "Dubbo", lat: -28.82, lon: 153.43 }, details });
const D1 = {
  places: { so1: { name: "Bega", lat: -28.87, lon: 153.56 }, wk1: { name: "Bega", lat: -28.87, lon: 153.56 }, sf1: { name: "Narooma", lat: -28.79, lon: 153.59 }, we1: { name: "Eden", lat: -28.64, lon: 153.61 }, st1_0: { name: "Merimbula", lat: -29.11, lon: 153.43 }, st1_1: { name: "Cooma", lat: -28.87, lon: 153.05 } },
  commute: { from: { name: "Dubbo", lat: -28.82, lon: 153.43 }, to: { name: "Orange", lat: -28.81, lon: 153.28 } },
  bins: { weekday: "2", alt: true, thisweek: "b", bin_a: "Paper", bin_b: "Glass", lid_a: "#ff453a", lid_b: "#0a84ff" },
  watch: { whose: { kp1: "p_3k9x2m" } }, show: { pe1: { who: ["p_8d1q0z"] } },
  stay: { names: { [new Date().toISOString().slice(0, 10)]: "Sarah" } },
  smart: { picks: { ac1: ["climate.lounge"], lt1: ["light.hall", "light.deck"] } },
  rooms: { "11111111-1111-4111-8111-111111111111": { label: "Lounge", climate: ["climate.lounge"], speakers: ["media_player.lounge"], lights: ["light.hall"] } }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const local = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), k);
const wsNow = async () => ((await local("mock:tvhome.settings")) || {}).s?.widgets || {};
async function boot(pack, fresh) {
  if (fresh) {
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate((dz) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, DESIGN);
  }
  await page.evaluate((p) => { if (p) localStorage.setItem("couchtv.home.pack", JSON.stringify(p)); }, pack);
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => window.tv && window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o .cw"));
  await page.waitForTimeout(2500);
}
// the text a widget draws, by its widget id
const textOf = (id) => page.evaluate((i) => { const e = document.querySelector('[data-wid="' + i + '"], [data-id="' + i + '"], #cw-' + i); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, id);
console.log("Running widget mapping browser tests...");
await boot(PACK(1, D1), true);
let ws = await wsNow();
const name = (v) => v && v.name;
ok(name(ws["wk1|week"] && ws["wk1|week"].town) === "Bega", "the week widget has the account's own place: " + JSON.stringify(ws["wk1|week"]));
ok(name(ws["sf1|surf"] && ws["sf1|surf"].place) === "Narooma", "surf has its beach (place)");
ok(name(ws["we1|weather"] && ws["we1|weather"].town) === "Eden", "weather has its town");
ok(name(ws["st1/0|week"] && ws["st1/0|week"].town) === "Merimbula" && name(ws["st1/1|hourly"] && ws["st1/1|hourly"].town) === "Cooma", "a stack's widgets keep their own places (stack id + place)");
ok(name(ws["cm1|commute"] && ws["cm1|commute"].to) === "Orange" && name(ws["cm1|commute"].from) === "Dubbo", "the commute has both ends");
const b = ws["bn1|bins"] || {};
ok(b.weekday === 2 && b.alt === true && b.bin_a === "Paper" && b.bin_b === "Glass" && b.lid_a === "#ff453a" && b.lid_b === "#0a84ff", "bins: night, names and lids: " + JSON.stringify(b));
ok(typeof b.anchor === "number", "bins: which bin goes out this week became the count the bins keep");
ok(ws["kp1|keeprow"] && ws["kp1|keeprow"].person === "p_3k9x2m", "keep watching row shows Ruby's shows");
// the town reaches the TV: the home's Location is the account's town, and the weather is read for it
const stp = (await local("mock:tvhome.settings")).s.place;
ok(stp && stp.name === "Dubbo" && stp.src === "account" && Math.abs(stp.lat + 28.82) < 0.01, "the account's town is the TV's weather place: " + JSON.stringify(stp));
const wxPlace = await page.evaluate(() => { const e = document.getElementById("weather"); return e ? e.textContent.replace(/\s+/g, " ") : ""; });
ok(/Dubbo/.test(wxPlace) || wxPlace === "", "the weather line names the account's town (or is not drawn in this design): " + wxPlace);
ok(ws["ac1|aircon"] && ws["ac1|aircon"].entity === "climate.lounge", "aircon has the account's pick as its own device: " + JSON.stringify(ws["ac1|aircon"]));
ok(ws["pe1|people"] && JSON.stringify(ws["pe1|people"].who) === '["p_8d1q0z"]', "the people widget shows only the people the account chose: " + JSON.stringify(ws["pe1|people"]));
ok(name(ws["so1|solar"] && ws["so1|solar"].town) === "Bega", "solar has its own place");
const peText = await page.evaluate(() => { const e = [...document.querySelectorAll(".cw-o")].map((x) => x.textContent.replace(/\s+/g, " ")); return e.join(" || "); });
ok(/Alex/.test(peText), "the people widget draws the chosen person");
const acct = await local("mock:tvhome.home.account");
ok(acct && acct.wsApplied && acct.wsApplied["wk1|week"], "the account record remembers what it put on each widget");
ok(!JSON.stringify(await local("mock:tvhome.settings")).includes("thisweek"), "thisweek is never a stored setting");
const ah = await local("mock:tvhome.athome");
ok(ah && ah.stay && ah.stay.names && Object.values(ah.stay.names).includes("Sarah"), "stay names reached At home");

// what the widgets SHOW (the real page): the account's values
const shown = await page.evaluate(() => {
  const out = {}; const L = window.CouchDesign.widgetList();
  document.querySelectorAll(".cw-o .cw").forEach((e) => { const o = e.closest("[data-id],[data-wid]"); });
  return { n: L.length, keys: L.map((w) => w.key) };
});
ok(shown.keys.indexOf("st1/0|week") >= 0, "the stack's widgets are listed with the key the TV uses: " + shown.keys.join(","));
const all = await page.evaluate(() => [...document.querySelectorAll(".cw-o")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const T = all.join(" || ");
for (const w of ["Bega", "Narooma", "Eden", "Merimbula", "Cooma", "Tuesday night", "Glass", "Ruby is watching"]) ok(T.includes(w), "a widget shows " + w + " (" + T.slice(0, 600) + ")");
// (the commute draws its route from a live road service; the mock has none, so its two ends are checked in what the widget reads, above)
ok(!errors.length, "no page errors: " + errors.join(" | "));

// a change made on this TV wins until the account's value changes
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("mock:tvhome.settings")); s.s.widgets["wk1|week"].town = { name: "Tamworth", lat: -28.18, lon: 153.54, timezone: "auto" }; s.s.widgets["bn1|bins"].bin_a = "Mine"; localStorage.setItem("mock:tvhome.settings", JSON.stringify(s)); });
await boot(PACK(2, D1), false);
ws = await wsNow();
ok(name(ws["wk1|week"].town) === "Tamworth", "the TV's own week place stays while the account has not changed it");
ok(ws["bn1|bins"].bin_a === "Mine" && ws["bn1|bins"].bin_b === "Glass", "the TV's own bin name stays, the rest follow the account");
const D2 = JSON.parse(JSON.stringify(D1)); D2.places.wk1 = { name: "Orange", lat: -28.81, lon: 153.28 };
await boot(PACK(3, D2), false);
ws = await wsNow();
ok(name(ws["wk1|week"].town) === "Orange", "the account changed the place: it wins again");
ok(ws["bn1|bins"].bin_a === "Mine", "a bin name the account did not change still stays");
// the account takes a place away: what it put goes
const D3 = JSON.parse(JSON.stringify(D2)); delete D3.places.sf1; delete D3.watch;
await boot(PACK(4, D3), false);
ws = await wsNow();
ok(!ws["sf1|surf"], "the account removed the beach: surf has none of the account's place");
ok(!ws["kp1|keeprow"], "and no one's shows");
ok(name(ws["we1|weather"].town) === "Eden", "the rest stay");
// a wipe takes only what the account gave
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("mock:tvhome.settings")); s.s.widgets["we1|weather"].town = { name: "Mine", lat: 1, lon: 1, timezone: "auto" }; localStorage.setItem("mock:tvhome.settings", JSON.stringify(s)); });
await boot({ v: 1, rev: 5, wipe: true }, false);
ws = await wsNow();
ok(name(ws["we1|weather"].town) === "Mine", "the TV's own weather town survives a wipe");
ok(!ws["cm1|commute"] && !ws["st1/0|week"], "the account's commute and stack places are gone after a wipe: " + JSON.stringify(Object.keys(ws)));
ok(!errors.length, "no page errors after: " + errors.join(" | "));
await browser.close();
server.close();
console.log("Widget mapping browser tests passed (" + n + " checks).");
