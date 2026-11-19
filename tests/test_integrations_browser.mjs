// Calendar guests and smart home set up on the TV, in a real browser at 1920x1080 (the TV home's ?mock preview):
//  1. A Welcome widget whose design says the name comes from the calendar greets the guest booked now
//     ("Welcome, Sarah") with their check out, from the bookings link kept on this TV; before any link
//     it says where to add one. A name typed in At home wins.
//  2. Home settings, couch-tv Studio, Smart home: the address and a pasted token are checked, what
//     Home Assistant has is listed, ticks are saved the way the launcher keeps them, the guide for a
//     device we don't list is there, and the token is never kept in the page's storage or address.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_integrations_browser.mjs
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

const pad = (v) => String(v).padStart(2, "0"), today = new Date(), ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const day = (k) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:s1", "DTSTART;VALUE=DATE:" + ymd(day(-1)), "DTEND;VALUE=DATE:" + ymd(day(2)), "SUMMARY:Reserved - Sarah Smith", "END:VEVENT",
  "BEGIN:VEVENT", "UID:s2", "DTSTART;VALUE=DATE:" + ymd(day(5)), "DTEND;VALUE=DATE:" + ymd(day(7)), "SUMMARY:Airbnb (Not available)", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const browser = await chromium.launch();
async function home(qs, widgets, kept) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.addInitScript((ics) => { window.MOCK_ICS = ics; }, ICS);
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => ({ id: "w" + i, type: "widget", kind: x[0], x: 80, y: 60 + i * 300, w: 760, h: 260, opts: x[1] })) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(([d, k]) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); if (k) localStorage.setItem("mock:tvhome.athome", JSON.stringify(k)); }, [design, kept || null]);
  await page.goto(BASE + "?mock=1&design=local" + (qs || ""));
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchAtHome);
  await page.waitForTimeout(900);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
const text = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id);

console.log("Running integrations browser tests...");

// 1. the Welcome widget's guest from the bookings calendar
{
  const page = await home("", [["welcome", { text: "Welcome", source: "calendar" }], ["welcome", { text: "Hello there", sub: "Enjoy" }]]);
  ok(/Add your bookings calendar/.test(await text(page, "w0")), "no bookings link yet: it says what to add (" + await text(page, "w0") + ")");
  ok(/Hello there/.test(await text(page, "w1")) && /Enjoy/.test(await text(page, "w1")), "a typed Welcome is unchanged");
  await page.close();
}
{
  const page = await home("", [["welcome", { text: "Welcome!", source: "calendar" }], ["welcome", { text: "Welcome", source: "calendar", times: false }]],
    { v: 1, stay: { url: "https://www.airbnb.com.au/calendar/ical/1.ics?s=x", checkout: "11:00" } });
  await page.waitForFunction(() => /Sarah/.test((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const t0 = await text(page, "w0");
  ok(/Welcome, Sarah!/.test(t0), "the guest booked now, by first name, from the calendar (" + t0 + ")");
  ok(new RegExp("Check out " + DAYS[day(2).getDay()] + " at 11").test(t0), "and their check out, at the house's time (" + t0 + ")");
  ok(!/Check out/.test(await text(page, "w1")), "times: false hides the check out line");
  ok(!/Smith/.test(t0), "never the surname");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}
{
  const key = new Date(day(-1)).getFullYear() + "-" + pad(day(-1).getMonth() + 1) + "-" + pad(day(-1).getDate());
  const names = {}; names[key] = "Grace";
  const page = await home("", [["welcome", { text: "Welcome", source: "calendar" }]], { v: 1, stay: { url: "https://www.airbnb.com.au/calendar/ical/1.ics?s=x", names } });
  await page.waitForFunction(() => /Grace/.test((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  ok(/Welcome, Grace/.test(await text(page, "w0")), "a name typed on the TV for this stay wins");
  await page.close();
}

// 2. smart home set up on the TV
{
  const page = await home("&hasetup=1", [["controls", { label: "Lights" }]]);
  ok(await page.evaluate(() => window.smartHome.setup.can() && !window.smartHome.enabled()), "nothing set up yet, and the TV can set it up");
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => /couch-tv Studio/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  const toRow = async (re) => { for (let i = 0; i < 60; i++) { const t = await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || ""); if (re.test(t)) return true; await press(page, "ArrowDown", 100); } return false; };
  const type = async (words) => { await press(page, "Enter", 250); await page.fill("#set-input", words); await press(page, "Enter", 500); };
  ok(await toRow(/^Smart home/), "Home settings, couch-tv Studio has Smart home");
  await press(page, "Enter", 300);
  const rowsText = () => page.evaluate(() => document.getElementById("set-rows").textContent);
  ok(/Long-lived access tokens/.test(await rowsText()), "the steps to make a token are on the screen");
  ok(await toRow(/Paste a token/), "a row to paste the token");
  await type("not-the-right-token-at-all");
  await page.waitForTimeout(400);
  ok(/did not accept that token/.test(await page.evaluate(() => document.getElementById("set-msg").textContent)), "a wrong token says so in plain words");
  ok(await toRow(/Paste a token/), "back to the token row");
  await type("test-token-for-the-preview-only");
  await page.waitForTimeout(500);
  ok(/3\. Pick what shows/.test(await rowsText()), "connected: what Home Assistant has is listed");
  ok(await toRow(/^Lights, switches/), "a group for lights and switches"); await press(page, "Enter", 300);
  ok(await toRow(/Lounge lamp/), "the lamp is in it"); await press(page, "Enter", 250);
  await press(page, "ArrowLeft", 300);
  ok(await toRow(/^Air conditioning/), "a group for aircon"); await press(page, "Enter", 300);
  ok(await toRow(/Lounge aircon/), "the aircon is in it"); await press(page, "Enter", 250);
  await press(page, "ArrowLeft", 300);
  ok(await toRow(/Save and show/), "save"); await press(page, "Enter", 600);
  const saved = await page.evaluate(() => window.MOCK_HA_SAVED);
  ok(saved && saved.controls[0].entity === "light.lounge" && saved.climate[0].entity === "climate.lounge", "the ticks are kept the way the launcher reads them");
  ok(saved && !("token" in saved) && !("url" in saved), "the page never sends the token twice: the launcher holds it");
  ok(await page.evaluate(() => window.smartHome.enabled() && window.smartHome.available()), "smart home is on, the Smart home screen too");
  ok(await toRow(/Add a device we don't list/), "the guide for other devices"); await press(page, "Enter", 300);
  const more = await rowsText();
  ["Tuya", "Google Home", "Apple Home", "Matter", "Alexa", "AirTouch 5", "MQTT"].forEach((w) => ok(more.indexOf(w) >= 0, "the guide covers " + w));
  const kept = await page.evaluate(() => { const o = []; for (let i = 0; i < localStorage.length; i++) o.push(localStorage.getItem(localStorage.key(i))); return o.join(" ") + location.href; });
  ok(kept.indexOf("test-token-for-the-preview-only") < 0, "the token is in no storage of the page and not in the address");
  ok(seen.every((u) => u.indexOf("test-token") < 0), "and never went to a server");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
