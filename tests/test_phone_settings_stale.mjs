// A change from the phone's Home settings page (the town, a photo) is never undone by the TV's own
// Home settings, in a real browser (the TV home's ?mock=1&ontv=1, whose /api/settings works like the
// on-TV app's: a save that carries an older "seen" keeps the server's town and photos).
//  1. Home settings open on the TV, the phone saves, the app tells the home (tv.resume): the home takes
//     the phone's town, and the next change made on the TV keeps it. (Review repro, 20 Nov 2026.)
//  2. The same, but the home never heard (no resume): the TV's next save is older than the server's
//     copy, so the server keeps the phone's town and photo and the TV takes them back.
//  3. Closing Home settings with nothing changed on the TV picks the phone's change up straight away.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_settings_stale.mjs
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
const HOBART = { name: "Hobart", area: "Tasmania, Australia", lat: -42.88, lon: 147.33, timezone: "Australia/Hobart" };
const browser = await chromium.launch();

async function openSettings() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1&ontv=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(HOME + "?mock=1&ontv=1");
  await page.waitForFunction(() => window.tv && document.getElementById("settings"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300);
  await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  return page;
}
// the phone's save, as the on-TV app writes it (Server.kt settings_patch, Photos.kt): a newer "updated"
const phoneSaves = (page, photo) => page.evaluate(([pl, ph]) => {
  const cur = JSON.parse(localStorage.getItem("mock:api.settings") || "null") || { settings: {} };
  cur.settings.place = pl;
  if (ph) cur.settings.photos = (cur.settings.photos || []).concat([{ id: "abc1", file: "phoneabc123.jpg" }]);
  cur.updated = new Date(Date.now() + 5).toISOString();
  localStorage.setItem("mock:api.settings", JSON.stringify(cur));
}, [HOBART, photo]);
const serverCopy = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mock:api.settings") || "null"));
const tvCopy = (page) => page.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || "null"); return r && r.s; });
async function changeWeatherOnTv(page) {
  const secs = await page.evaluate(() => Array.from(document.querySelectorAll(".ssec")).map((x) => x.textContent.trim()));
  const wi = secs.findIndex((s) => /^Weather/.test(s));
  for (let i = 0; i < wi; i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150); }
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
}

console.log("Running phone settings, stale copy tests...");
{
  const page = await openSettings();
  ok(await page.evaluate(() => document.getElementById("set-phone").classList.contains("on")), "1: Home settings is open with the QR");
  await phoneSaves(page, true);
  await page.evaluate(() => window.tv.resume()); await page.waitForTimeout(1500);
  const tv = await tvCopy(page);
  ok(tv && tv.place && tv.place.name === "Hobart", "1: with Home settings open, the home takes the phone's town as soon as the app says so");
  await changeWeatherOnTv(page);
  const after = await serverCopy(page);
  ok(after.settings.place && after.settings.place.name === "Hobart", "1: a change on the TV afterwards keeps the phone's town");
  ok((after.settings.photos || []).length === 1, "1: and its photo");
  ok(after.settings.wx_show === false, "1: and the TV's own change is saved too");
  ok(!page.errors.length, "1: no page errors: " + page.errors.join("; "));
  await page.close();
}
{
  const page = await openSettings();
  await phoneSaves(page, true);   // the home is not told (the app's refresh was missed)
  await changeWeatherOnTv(page);
  const after = await serverCopy(page);
  ok(after.settings.place && after.settings.place.name === "Hobart" && (after.settings.photos || []).length === 1,
    "2: the TV's older copy does not undo the phone's town and photo (seen)");
  ok(after.settings.wx_show === false, "2: the TV's own change still lands");
  const tv = await tvCopy(page);
  ok(tv && tv.place && tv.place.name === "Hobart", "2: and the TV takes the server's copy back");
  ok(!page.errors.length, "2: no page errors: " + page.errors.join("; "));
  await page.close();
}
{
  const page = await openSettings();
  await phoneSaves(page, false);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await page.keyboard.press("Escape"); await page.waitForTimeout(2500);
  ok(!(await page.evaluate(() => document.getElementById("settings").classList.contains("on"))), "3: Home settings is closed");
  const tv = await tvCopy(page);
  ok(tv && tv.place && tv.place.name === "Hobart", "3: closing it picks up the phone's change at once");
  await page.close();
}
await browser.close();
server.close();
console.log("phone settings, stale copy tests: " + n + " passed");
