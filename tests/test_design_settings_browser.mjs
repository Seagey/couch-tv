// Design aware Home settings, on the TV and on the phone, in a real browser (owner's TCL test, 20 Nov 2026):
//  1. The TV's Home settings with no design: every section, as before.
//  2. With a Couch TV Studio design (its own background, the dock, people, quick buttons, Keep watching
//     and the clock hidden; a Welcome, a surf report "North Point", Guest Wi-Fi, a house guide and an app
//     grid): Apps, People and Quick buttons are gone, Look has no look choices, scenes, video, photos or
//     Inputs tile; one line at the top says so, and Show all settings brings everything back.
//  3. Each widget's own settings: Couch TV Studio lists the widgets on the design; the surf report gets its
//     own place (kept on the TV), the reading is asked of Open-Meteo for that place and the widget names
//     it; with no place of its own the label never claims a place the reading is not for. Hold OK on the
//     surf widget offers Change place, which opens that widget's page.
//  4. Input tiles are honest: a design that hides the dock keeps them in its dock only when the dock shows.
//  5. The phone's Home settings page against a stand-in on-TV app whose /api/athome is the real TV page:
//     collapsed sections (one open, titles are buttons with aria-expanded, chips open theirs, #section=),
//     the design's hidden sections, Show all, input tiles honest, the surf place from a town search, and
//     the design's apps added, moved and removed, written to the TV's own edits.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_design_settings_browser.mjs
// SHOTS=<folder> saves pictures.
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
const SHOTS = process.env.SHOTS || "";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const design = { v: 1, background: { colour: "#1d3a4f" },
  elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: [
    { id: "w", type: "widget", kind: "welcome", x: 80, y: 60, w: 760, h: 200, opts: { text: "Welcome, Sam" } },
    { id: "s", type: "widget", kind: "surf", x: 80, y: 300, w: 460, h: 300, opts: { label: "North Point" } },
    { id: "f", type: "widget", kind: "wifi", x: 600, y: 300, w: 460, h: 300 },
    { id: "g", type: "widget", kind: "guide", x: 1120, y: 300, w: 460, h: 300 },
    { id: "n", type: "widget", kind: "news", x: 1300, y: 40, w: 560, h: 220, opts: { feed: "abc" } },
    { id: "a", type: "widget", kind: "appgrid", x: 80, y: 650, w: 1160, h: 320, opts: { apps: ["netflix", "stan"] } }
  ] };
// the same, but the design shows the home's own dock (input tiles belong there)
const dockDesign = { v: 1, background: { colour: "#1d3a4f" }, objects: [{ id: "s", type: "widget", kind: "surf", x: 80, y: 300, w: 460, h: 300 }] };

// ---- a stand-in on-TV app: the TV home's files, /setup, and an API whose At home is the real TV page ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
let TV = null;   // the Playwright page that is "the TV"
const got = { settings: [] };
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks), body = () => { try { return JSON.parse(raw.toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false, error: "That code is not right." });
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") { got.settings.push(body()); return send(res, 200, Object.assign({ ok: true }, HS)); }
      // HomeActivity.atHomeRead / atHomeEdit: the page's own tv.atHomeRead and tv.atHomeEdit
      if (route === "GET /api/athome") {
        const r = TV ? await TV.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null;
        return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false });
      }
      if (route === "POST /api/athome") {
        const e = body().edit;
        const r = TV ? await TV.evaluate((x) => tv.atHomeEdit(x), e) : null;
        if (!r) return send(res, 200, { ok: true, live: false, queued: true });
        return r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error || "That did not save." });
      }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: true, held: true });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [{ id: "hdmi1", label: "HDMI 1", devices: ["Foxtel"] }, { id: "hdmi2", label: "HDMI 2", devices: [] }], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, current: "0.13.9", checked: true });
      if (route === "GET /api/ha/info") return send(res, 404, { ok: false });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html";

console.log("Running design aware settings browser tests...");
const browser = await chromium.launch();
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 160); };

// Open-Meteo stand in: the weather, and the swell, different for each place asked
const asked = [];
async function meteo(page) {
  await page.route(/open-meteo\.com/, (route) => {
    const u = new URL(route.request().url());
    asked.push(u.host + " " + u.searchParams.get("latitude") + "," + u.searchParams.get("longitude"));
    if (u.host.startsWith("marine")) {
      const wave = u.searchParams.get("latitude") === "-38.37" ? 2.3 : 0.9;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { wave_height: wave, wave_period: 12, wave_direction: 150 }, hourly: { time: [], wave_height: [] } }) });
    }
    if (u.host.startsWith("geocoding")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [
      { id: 7, name: "Bells Beach", latitude: -38.3683, longitude: 144.2817, timezone: "Australia/Sydney", admin1: "Victoria", country: "Australia" }] }) });
    if (u.host.startsWith("air")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { european_aqi: 12 }, hourly: { time: [], european_aqi: [] } }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 22, weather_code: 1, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 200, time: "" }, hourly: {}, daily: {} }) });
  });
}
async function tvPage(d, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await meteo(page);
  await page.goto(HOME + "?mock=1&reset=1");
  await page.evaluate((dz) => { localStorage.clear(); if (dz) localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, d);
  await page.goto(HOME + "?mock=1&wxlive=1" + (d ? "&design=local" : "") + (q || ""));
  await page.waitForFunction(() => window.tv && document.getElementById("settings"));
  if (d) await page.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="s"] .cw'));
  await page.waitForTimeout(700);
  return page;
}
async function closeSettings(page) { for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(page, "Escape", 250); await page.waitForTimeout(900); await page.waitForFunction(() => window.tv && document.getElementById("settings")); }
async function openSettings(page) { await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(250); await press(page, "Enter", 500); }
const secs = (page) => page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
const rowsText = (page) => page.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
async function goSec(page, name) {
  const list = await secs(page), i = list.indexOf(name);
  assert.ok(i >= 0, "section " + name + " in " + list.join(", "));
  // back to the sections column, then step from where the focus is
  for (let k = 0; k < 4 && await page.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press(page, "ArrowLeft", 120);
  const at = await page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(page, i > at ? "ArrowDown" : "ArrowUp", 80);
  await page.waitForTimeout(150);
  assert.ok((await page.textContent("#set-secs .ssec.focus")).trim() === name, "on " + name);
}

// ---- 1. no design: every section ----
let allSecs;
{
  const page = await tvPage(null);
  await openSettings(page);
  allSecs = await secs(page);
  ok(allSecs.includes("Apps") && allSecs.includes("People") && allSecs.includes("Quick buttons"), "no design: every section shows (" + allSecs.join(", ") + ")");
  await goSec(page, "Look and scenes");
  const look = (await rowsText(page)).join(" | ");
  ok(/Night scenes/.test(look) && /Inputs tile/.test(look) && /Video link/.test(look), "no design: Look has the looks, Inputs tile and the video link: " + look);
  ok(!(await rowsText(page)).some((t) => /Couch TV Studio design/.test(t)), "no design: no design line");
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await page.close();
}

// ---- 2. a design: only what it uses ----
const tv = await tvPage(design);
TV = tv;
{
  await openSettings(tv);
  const s = await secs(tv);
  ok(!s.includes("Apps") && !s.includes("People") && !s.includes("Quick buttons"), "with the design: no Apps, People or Quick buttons (" + s.join(", ") + ")");
  ok(s.includes("Location") && s.includes("Weather") && s.includes("Designs") && s.includes("Language") && s.includes("About"), "the town and weather stay: the surf report reads them");
  const top = (await rowsText(tv)).slice(0, 2).join(" | ");
  ok(/This home uses a Couch TV Studio design/.test(top) && /Settings for parts it doesn't show are hidden/.test(top) && /Show all settings/.test(top), "one line at the top says so, with Show all settings: " + top);
  await goSec(tv, "Look and scenes");
  const look = (await rowsText(tv)).join(" | ");
  ok(!/Night scenes/.test(look), "Look: no look choices (the design is the look)");
  ok(!/Inputs tile/.test(look), "Look: no Inputs tile (it never shows with a design)");
  ok(!/Video link/.test(look) && !/Add a photo from a web address/.test(look), "Look: no video or photos (the design has its own background and no photo widget)");
  ok(!(await rowsText(tv)).some((r) => /^(Moving tiles|Mac-style dock|Show Keep watching|Glass app icons|Hide rows when idle)/.test(r)), "Look: nothing for the hidden dock or Keep watching: " + look);
  ok(/Lighter home|Navigation sound|sound/i.test(look), "Look: what still applies stays (" + look.slice(0, 160) + ")");
  if (SHOTS) await tv.screenshot({ path: path.join(SHOTS, "tv-home-settings-design-look.png") });
  // Show all settings, from the first section
  await goSec(tv, "Language");
  if (SHOTS) await tv.screenshot({ path: path.join(SHOTS, "tv-home-settings-design.png") });
  await press(tv, "ArrowRight", 200);
  ok(/Show all settings/.test(await tv.evaluate(() => (document.querySelector("#set-rows .srow.focus") || {}).textContent || "")), "Right lands on Show all settings");
  await press(tv, "Enter", 300);
  const all = await secs(tv);
  ok(all.length === allSecs.length && all.includes("Apps") && all.includes("Quick buttons"), "Show all settings brings every section back (" + all.join(", ") + ")");
  ok(/Show only what this design uses/.test((await rowsText(tv)).join(" ")), "and offers to go back to only what it uses");
  await closeSettings(tv);
  await openSettings(tv);
  ok(!(await secs(tv)).includes("Apps"), "closing Home settings goes back to only what the design uses");

  // ---- 3. each widget's own settings, drawn from widget-caps.js settings (pre: true only) ----
  await goSec(tv, "Designs");
  const studio = (await rowsText(tv)).join(" | ");
  ok(/Surf, middle left/.test(studio) && /Beach: Sydney \(your home's town\)/.test(studio), "Couch TV Studio, Widgets on this home: the surf widget by kind and place, with its beach now: " + studio);
  ok(/Headlines, top right/.test(studio) && /News source: ABC News/.test(studio), "and the headlines with the design's source");
  // round 2: the Welcome words, Guest Wi-Fi and House guide have settings of their own now (tests/test_ws2_home.mjs)
  ok(/Welcome words, /.test(studio) && /Guest Wi-Fi, /.test(studio) && /House guide, /.test(studio), "the Welcome words, Guest Wi-Fi and House guide are listed with their own settings");
  if (!(await tv.evaluate(() => window.CouchWidgetCaps.settings("appgrid").some((x) => x.pre && x.where.indexOf("tv") >= 0)))) ok(!/App grid,/.test(studio), "a widget with no settings of its own is not listed");
  ok(/App grid, bottom middle/.test(studio) && /Apps: Netflix, Stan/.test(studio), "the app grid is listed with its apps (ws2-watching: its apps are its settings)");
  await closeSettings(tv);
}
// Hold OK on the surf widget: Edit on the TV, right after Settings, opens its page (a TV the computer runs: no phone item)
{
  await tv.evaluate(() => window.CouchDesign.nav.focus("s", 0)); await tv.waitForTimeout(200);
  await tv.keyboard.down("Enter"); await tv.waitForTimeout(900); await tv.keyboard.up("Enter"); await tv.waitForTimeout(300);
  const menu = await tv.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  ok(menu[0] === "Settings" && menu[1] === "Edit on the TV" && menu.indexOf("Edit on your phone") < 0, "Hold OK on the surf widget: Settings, then Edit on the TV, and no Edit on your phone where the TV serves no phone page (" + menu.join(", ") + ")");
  await press(tv, "ArrowDown", 120);
  await press(tv, "Enter", 600);
  ok(await tv.evaluate(() => document.getElementById("settings").classList.contains("on")), "it opens Home settings");
  ok(/Surf, middle left/.test(await tv.textContent("#set-head")), "at the surf widget's own page: " + await tv.textContent("#set-head"));
  const pg = (await rowsText(tv)).join(" | ");
  ok(/Beach/.test(pg) && /Sydney \(your home's town\)/.test(pg) && /Search for a place/.test(pg) && /beach, or the town by it/.test(pg), "its beach now is the home's town, with a beach search: " + pg.slice(0, 240));
  if (SHOTS) await tv.screenshot({ path: path.join(SHOTS, "tv-surf-settings.png") });
  await closeSettings(tv);
  // the headlines widget: the news source, a choice, changed on the TV over the design's own
  await tv.evaluate(() => window.CouchDesign.nav.focus("n", 0)); await tv.waitForTimeout(200);
  await tv.keyboard.down("Enter"); await tv.waitForTimeout(900); await tv.keyboard.up("Enter"); await tv.waitForTimeout(300);
  await press(tv, "ArrowDown", 120); await press(tv, "Enter", 600);
  await press(tv, "Enter", 300);   // the News source row: the next choice
  const wsv = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "n|news")[0].settings.filter((s) => s.key === "feed")[0]);
  ok(wsv.own && wsv.value === "abc-justin", "OK on News source steps to the next choice, kept on this TV: " + JSON.stringify(wsv.value));
  const st = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets; });
  ok(st && st["n|news"] && st["n|news"].feed === "abc-justin", "in Home settings (widgets), which rides /api/settings: " + JSON.stringify(st));
  const rows2 = (await rowsText(tv)).join(" | ");
  ok(/Use the design's news source/.test(rows2), "with one row back to the design's own");
  await closeSettings(tv);
}
ok(asked.some((a) => /^marine.* -33\.86/.test(a)), "the swell is asked for the home's town while no beach is set: " + asked.filter((a) => /^marine/.test(a)).join("; "));

// ---- 3b. Hold OK, Edit on the TV or Edit on your phone (0.13.9): every widget kind ----
async function holdOn(page, id) {
  await page.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await page.waitForTimeout(200);
  await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
  return page.evaluate(() => ({ items: [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent),
    note: (document.querySelector(".cw-sheet .cw-note") || {}).textContent || "" }));
}
{
  // Guest Wi-Fi has its own setting now (Hide the password): Edit on the TV, every item does something
  const m = await holdOn(tv, "f");
  ok(m.items[0] === "Settings" && m.items[1] === "Edit on the TV" && !m.note, "Guest Wi-Fi: Edit on the TV (" + m.items.join(", ") + ")");
  ok(await tv.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].every((e) => e.getAttribute("data-act"))), "every item in the menu does something");
  await press(tv, "Escape", 300);
  ok(!(await tv.evaluate(() => window.CouchDesign.nav.sheetOpen())), "Back closes it");
  // the headlines (settings) on a TV the computer runs: Edit on the TV alone, no line
  const m2 = await holdOn(tv, "n");
  ok(m2.items[1] === "Edit on the TV" && m2.items.indexOf("Edit on your phone") < 0 && !m2.note, "Headlines on a TV the computer runs: Edit on the TV, no QR item (" + m2.items.join(", ") + ")");
  await press(tv, "Escape", 300);
}
{
  // the on-TV app (it serves the phone page): the phone first (owner, 23 Nov 2026), its sheet a QR code
  // with "No phone? Set it up here" for the TV's own page; no Edit on the TV in the menu
  const ontv = await tvPage(design, "&ontv=1");
  const m = await holdOn(ontv, "s");
  ok(m.items[0] === "Edit on your phone" && m.items[1] === "Settings" && m.items.indexOf("Edit on the TV") < 0, "on the on-TV app, surf: Edit on your phone first, then Settings (" + m.items.join(", ") + ")");
  await press(ontv, "Enter", 800);
  const q = await ontv.evaluate(() => { const s = document.querySelector(".cw-sheet"); return s && { title: s.querySelector("h2").textContent, link: (s.querySelector(".cw-qr") || {}).getAttribute && s.querySelector(".cw-qr").getAttribute("data-link"),
    svg: !!s.querySelector(".cw-qr svg"), hint: (s.querySelector(".cw-hint") || {}).textContent || "", items: [...s.querySelectorAll(".cw-mi")].map((x) => x.textContent) }; });
  ok(q && q.title === "Set up on your phone" && q.svg, "Edit on your phone shows a QR code: " + JSON.stringify(q));
  ok(q && q.link === "http://tv.example:5400/setup#pin=482913&widget=s", "the QR opens the phone page at this widget, already paired: " + (q && q.link));
  ok(q && q.hint === "Scan with your phone camera." && q.items.join() === "No phone? Set it up here", "one line under it, and No phone? Set it up here: " + JSON.stringify(q));
  ok(q && !/[–—]/.test(q.hint + q.title), "no dashes");
  // M3 (21 Nov): while it is open the sheet asks the TV again every 20 s and draws the new code
  const qrNow = () => ontv.evaluate(() => { const s = document.querySelector(".cw-sheet .cw-qr"); return s ? s.getAttribute("data-link") : null; });
  await ontv.evaluate(() => localStorage.setItem("mock:phonePin", "555666"));
  await ontv.waitForTimeout(21000);
  ok((await qrNow()) === "http://tv.example:5400/setup#pin=555666&widget=s", "20 s later the open QR shows the TV's new code: " + await qrNow());
  await press(ontv, "Escape", 300);
  ok(!(await ontv.evaluate(() => window.CouchDesign.nav.sheetOpen())), "Back closes the QR");
  // pairing locked (the TV answers 429): the open QR goes away, never a dead code on show
  await holdOn(ontv, "s"); await press(ontv, "Enter", 800);
  ok(/pin=555666/.test((await qrNow()) || ""), "the QR is open again");
  await ontv.evaluate(() => localStorage.setItem("mock:phoneLinkFail", "1"));
  await ontv.waitForTimeout(21000);
  ok((await qrNow()) === null, "when the TV stops giving a code (locked), the QR goes within 20 s");
  await ontv.evaluate(() => { localStorage.removeItem("mock:phoneLinkFail"); localStorage.removeItem("mock:phonePin"); });
  if (await ontv.evaluate(() => window.CouchDesign.nav.sheetOpen())) await press(ontv, "Escape", 300);
  // the House guide (Parts of the guide, kept on this TV, and nothing written yet): set up on the phone, first
  const m3 = await holdOn(ontv, "g");
  ok(/^(House guide: set up on your phone|Edit on your phone)$/.test(m3.items[0]) && m3.items.indexOf("Edit on the TV") < 0, "House guide on the on-TV app: the phone first (" + m3.items.join(", ") + ")");
  await press(ontv, "Escape", 300);
  // No phone? Set it up here opens the widget's own page on the TV
  await holdOn(ontv, "n"); await press(ontv, "Enter", 800); await press(ontv, "ArrowDown", 150); await press(ontv, "Enter", 600);
  ok(/Headlines, top right/.test(await ontv.textContent("#set-head")), "No phone? Set it up here opens the headlines' own page: " + await ontv.textContent("#set-head"));
  await closeSettings(ontv);
  ok(!ontv.errors.length, "no page errors on the on-TV app: " + ontv.errors.join("; "));
  await ontv.close();
}

// ---- 4. input tiles ----
{
  const page = await tvPage(dockDesign, "&inputs=2");
  const r = await page.evaluate(() => {
    const items = [{ package: "com.netflix.ninja" }, { package: "au.com.stan.and" }, { package: "input:HW1", kind: "input" }];
    return window.CouchDesign.dock(items, items, 10).map((x) => x.package);
  });
  ok(r.includes("input:HW1"), "a design that shows the home's dock keeps the input tiles in it: " + r.join(", "));
  const r2 = await page.evaluate(() => {
    const items = [{ package: "a1" }, { package: "a2" }, { package: "a3" }, { package: "input:HW1", kind: "input" }];
    return window.CouchDesign.dock(items, items, 3).map((x) => x.package);
  });
  ok(r2.length === 3 && r2[2] === "input:HW1", "and they take a dock place, never pushed out by the apps: " + r2.join(", "));
  const v = await page.evaluate(() => window.tv.atHomeRead().design);
  ok(v.on && v.inputs === true && v.hide.indexOf("inputs") < 0, "the phone hears the input tiles show on this design");
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await page.close();
}
{
  const v = await tv.evaluate(() => window.tv.atHomeRead().design);
  ok(v.on && v.inputs === false && v.hide.includes("inputs") && v.hide.includes("people") && v.hide.includes("photos") && !v.hide.includes("athome") && !v.hide.includes("town"),
    "the hidden dock design: the phone hides input tiles, people and photos, keeps the town and At home: " + JSON.stringify(v.hide));
  ok(!JSON.stringify(v).includes("salt") && v.widgets.some((w) => w.key === "s|surf" && w.settings.some((s) => s.key === "place" && s.type === "place")), "the widgets go with their settings, nothing private");
}

// ---- 5. the phone page ----
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await ctx.newPage();
phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
await meteo(phone);
await phone.goto(ORIGIN + "/setup#pin=482913");
await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
await phone.waitForFunction(() => document.getElementById("design-line").style.display === "", null, { timeout: 8000 });
// (23 Nov) the phone opens on Widgets on your screen; the page these checks use is under More settings
await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 });
await phone.click("#g-more");
{
  const st = await phone.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return e.style.display !== "none" && !e.classList.contains("hidden-by-design"); };
    return { people: vis("people"), photos: vis("photos"), town: vis("town"), athome: vis("athome"), inputs: vis("inputs"), widgets: vis("widgets"), dapps: vis("dapps"),
      open: [...document.querySelectorAll("main > section.fold")].filter((s) => !s.classList.contains("shut")).map((s) => s.id),
      btn: [...document.querySelectorAll(".fold-btn")].every((b) => b.tagName === "BUTTON" && b.hasAttribute("aria-expanded") && b.getAttribute("aria-controls")),
      line: document.getElementById("design-line-text").textContent };
  });
  ok(/This home uses a Couch TV Studio design\. Settings for parts it doesn't show are hidden\./.test(st.line), "the phone says the home uses a design: " + st.line);
  ok(!st.people && !st.photos && !st.inputs, "the phone hides People, Your photos and Input tiles for this design");
  ok(st.town && st.athome && st.widgets && st.dapps, "and shows the town, At home, the design's widgets and its apps");
  ok(st.open.length === 1 && st.open[0] === "widgets", "every section is shut but the first one shown: " + st.open.join(", "));
  ok(st.btn, "every section's title is a button with aria-expanded and aria-controls");
  if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, "phone-design.png"), fullPage: true });
  // a title opens its section, by keyboard too
  await phone.focus("#ask .fold-btn"); await phone.keyboard.press("Enter"); await phone.waitForTimeout(100);
  ok(await phone.evaluate(() => !document.getElementById("ask").classList.contains("shut") && document.querySelector("#ask .fold-btn").getAttribute("aria-expanded") === "true"), "Enter on a title opens it");
  await phone.keyboard.press("Enter"); await phone.waitForTimeout(100);
  ok(await phone.evaluate(() => document.getElementById("ask").classList.contains("shut")), "and again shuts it");
  await phone.click('.jump a[href="#home"]'); await phone.waitForTimeout(200);
  ok(await phone.evaluate(() => !document.getElementById("home").classList.contains("shut")), "a chip at the top opens its section");
  // Show all
  await phone.click("#design-all"); await phone.waitForTimeout(150);
  ok(await phone.evaluate(() => !document.getElementById("people").classList.contains("hidden-by-design") && document.getElementById("inputs").style.display === ""), "Show all settings brings People and Input tiles back");
  ok(/hides the dock/.test(await phone.textContent("#in-design")), "Input tiles say this design has no app row for them");
  await phone.click("#inputs .fold-btn");
  await phone.check('#in-list input[type=checkbox]');
  await phone.click("#in-save"); await phone.waitForTimeout(300);
  const im = await phone.textContent("#in-msg");
  ok(/only on the standard home/.test(im) && !/The home shows them now/.test(im), "saving input tiles never says the home shows them: " + im);
  await phone.click("#design-all"); await phone.waitForTimeout(150);
  ok(await phone.evaluate(() => document.getElementById("people").classList.contains("hidden-by-design")), "Show only what this design uses hides them again");
}
// Widgets on this TV: the surf widget's beach and the headlines' source, from the phone
{
  ok(/Widgets on this TV/.test(await phone.textContent("#widgets .fold-btn")), "the phone's section is Widgets on this TV");
  const titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent));
  // round 2: the Welcome words, Guest Wi-Fi and House guide have settings of their own too (tests/test_ws2_home.mjs)
  ok(titles.join(" / ") === "Welcome words, top left / Surf, middle left / Guest Wi-Fi, in the middle / House guide, middle right / Headlines, top right / App grid, bottom middle",
    "one box per widget with settings, named like the TV names it: " + titles.join(" / "));
  await phone.click('#w-list details[data-key="s|surf"] summary');
  const words = await phone.textContent('#w-list details[data-key="s|surf"]');
  ok(/Beach: Sydney \(your home's town\)/.test(words), "the surf widget's beach on the phone: " + words.slice(0, 80));
  await phone.fill('#w-list input[data-wq][data-wk="s|surf"]', "Bells");
  await phone.waitForSelector('#w-list button[data-wp="0"]');
  await phone.click('#w-list button[data-wp="0"]');
  await phone.waitForFunction(() => /Saved\. The TV shows Bells Beach now\./.test(document.getElementById("w-msg").textContent));
  const st = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets; });
  const pl = st && st["s|surf"] && st["s|surf"].place;
  ok(pl && pl.name === "Bells Beach" && pl.lat === -38.37 && pl.lon === 144.28, "the TV keeps the beach in Home settings, rounded to the town: " + JSON.stringify(pl));
  await tv.waitForTimeout(1500);
  ok(asked.some((a) => /^marine.* -38\.37,144\.28/.test(a)), "the swell is asked for Bells Beach: " + asked.filter((a) => /^marine/.test(a)).join("; "));
  ok(asked.some((a) => /^api\.open-meteo.* -38\.37,144\.28/.test(a)), "with Bells Beach's own forecast");
  // the widget reads it (data().wset, data().wxAt): Bells Beach's own swell, named by its real place
  await tv.waitForFunction(() => { const t = (document.querySelector('.cw-o[data-obj="s"]') || {}).textContent || ""; return /Bells Beach/.test(t) && /2\.3/.test(t); }, null, { timeout: 10000 });
  ok(true, "the surf widget shows Bells Beach and its 2.3 m swell (the design's label beside it is the renderer's choice, tests/test_ws_tv.mjs)");
  ok(/Beach: Bells Beach/.test(await phone.textContent('#w-list details[data-key="s|surf"]')), "the phone shows the new beach, its box still open");
  if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, "phone-surf-place.png"), fullPage: true });
  await phone.click('#w-list details[data-key="s|surf"] button[data-wclear]');
  await phone.waitForFunction(() => /Changed back/.test(document.getElementById("w-msg").textContent));
  const st2 = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets || {}; });
  ok(!st2["s|surf"], "Use your home's town instead takes the beach off");
  // a choice: the headlines' source
  await phone.click('#w-list details[data-key="n|news"] summary');
  await phone.selectOption('#w-list select[data-wk="n|news"][data-ws="feed"]', "bbc");
  await phone.waitForFunction(() => /Saved/.test(document.getElementById("w-msg").textContent));
  const st3 = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets || {}; });
  ok(st3["n|news"] && st3["n|news"].feed === "bbc", "the phone picks BBC World for the headlines: " + JSON.stringify(st3["n|news"]));
  const bad = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "n|news", values: { feed: "made-up" } } }));
  ok(bad.ok === false, "a choice that is not one of the choices is refused: " + bad.error);
  const notHere = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "zz|news", values: { feed: "bbc" } } }));
  ok(notHere.ok === false, "a widget that is not on the home is refused");
  const data = await tv.evaluate(() => { const w = window.tv.atHomeRead().design.widgets.filter((x) => x.key === "n|news")[0], caps = window.CouchWidgetCaps.settings("news"); return { keys: w.settings.map((s) => s.key), pre: w.settings.every((s) => caps.filter((c) => c.key === s.key)[0].pre === true) }; });
  ok(data.pre && data.keys.join() === "feed,count", "only the settings a widget reads now (pre) are offered: " + data.keys.join());
}
// the design's apps, from the phone
{
  await phone.click('.jump a[href="#dapps"]'); await phone.waitForTimeout(150);
  const names = () => phone.evaluate(() => [...document.querySelectorAll('#da-list [data-ai="0"] .alist li > span')].map((e) => e.textContent.replace(/\s*\(not on this TV\)/, "")));
  let l = await names();
  ok(l.join(",") === "Netflix,Stan", "Apps on this design lists the app grid's apps: " + l.join(","));
  await phone.click('#da-list [data-ai="0"] button[data-op="down"][data-i="0"]');
  await phone.waitForFunction(() => /Moved down/.test(document.getElementById("da-msg").textContent));
  ok((await tv.evaluate(() => window.CouchDesign.appEdits()["a|appgrid"])).join(",") === "stan,netflix", "Down moves Netflix after Stan, in the TV's own edits");
  await phone.selectOption('#da-add-0', { index: 0 });
  const adding = await phone.evaluate(() => { const s = document.getElementById("da-add-0"); return s.options[s.selectedIndex].value; });
  await phone.click('#da-list [data-ai="0"] button[data-op="add"]');
  await phone.waitForFunction(() => /is on it now/.test(document.getElementById("da-msg").textContent));
  const after = await tv.evaluate(() => window.CouchDesign.appEdits()["a|appgrid"]);
  ok(after.length === 3 && after[2] === adding, "Add puts the TV's app at the end: " + after.join(","));
  await phone.click('#da-list [data-ai="0"] button[data-op="remove"][data-i="0"]');
  await phone.waitForFunction(() => /is off it/.test(document.getElementById("da-msg").textContent));
  ok((await tv.evaluate(() => window.CouchDesign.appEdits()["a|appgrid"])).join(",") === ["netflix", adding].join(","), "Remove takes Stan off");
  const slots = await tv.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="a"] [data-slot]')].map((e) => e.getAttribute("data-arg")));
  ok(slots[0] === "com.netflix.ninja", "the TV draws the app grid the phone made: " + slots.join(","));
  await phone.click('#da-list [data-ai="0"] button[data-op="reset"]');
  await phone.waitForFunction(() => /design's own apps again/.test(document.getElementById("da-msg").textContent));
  ok(!(await tv.evaluate(() => window.CouchDesign.appEdits()["a|appgrid"])), "Use the design's own apps clears the change");
  ok(!phone.errors.length && !tv.errors.length, "no page errors: " + phone.errors.concat(tv.errors).join("; "));
}
await ctx.close();

// ---- 5a. the TV's QR: /setup#pin=...&widget=<id> opens that widget on Widgets on your screen, paired ----
{
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p3 = await c3.newPage();
  p3.errors = []; p3.on("pageerror", (e) => p3.errors.push(String(e)));
  await meteo(p3);
  await p3.goto(ORIGIN + "/setup#pin=482913&widget=n");
  await p3.waitForFunction(() => window.couchTv && window.couchTv.token());
  await p3.waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 10000 });
  await p3.waitForTimeout(400);
  const st = await p3.evaluate(() => ({ hash: location.hash, title: document.getElementById("sheet-title").textContent, body: document.getElementById("sheet-body").textContent,
    card: (document.querySelectorAll(".g-card")[+document.getElementById("g-count").textContent.split(" ")[0] - 1] || {}).textContent || "" }));
  ok(st.hash === "#widget=n", "only the pairing code leaves the address: " + st.hash);
  ok(st.title === "Headlines" && /News source/.test(st.body), "the headlines' own sheet opens: " + st.title);
  ok(/Headlines, top right/.test(st.card), "on the headlines' card: " + st.card.slice(0, 60));
  // Guest Wi-Fi with nothing typed yet: #widget=f opens its one step (the network name and password)
  await p3.evaluate(() => { location.hash = "widget=f"; });
  await p3.reload();
  await p3.waitForFunction(() => window.couchTv && window.couchTv.token());
  await p3.waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 10000 });
  ok(await p3.evaluate(() => document.getElementById("sheet-title").textContent === "Guest Wi-Fi" && !!document.getElementById("g-ssid")), "#widget=f (Guest Wi-Fi): its step opens, the network name first");
  // the App grid: its apps, with the TV's apps to add
  await p3.evaluate(() => { location.hash = "widget=a"; });
  await p3.reload();
  await p3.waitForFunction(() => window.couchTv && window.couchTv.token());
  await p3.waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 10000 });
  ok(await p3.evaluate(() => /App grid/.test(document.getElementById("sheet-title").textContent) && !!document.querySelector("#g-apps")), "#widget=a (App grid): its apps");
  ok(!p3.errors.length, "no page errors: " + p3.errors.join("; "));
  await c3.close();
}
// ---- 5b. no design on the TV: the phone shows everything; #section= opens its section ----
{
  const plain = await tvPage(null);
  TV = plain;
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await c2.newPage();
  p2.errors = []; p2.on("pageerror", (e) => p2.errors.push(String(e)));
  await p2.goto(ORIGIN + "/setup#pin=482913");
  await p2.waitForFunction(() => window.couchTv && window.couchTv.token());
  await p2.waitForFunction(() => document.getElementById("inputs").style.display === "");
  await p2.waitForTimeout(400);
  const st = await p2.evaluate(() => ({ line: document.getElementById("design-line").style.display, people: !document.getElementById("people").classList.contains("hidden-by-design"),
    widgets: document.getElementById("widgets").style.display, open: [...document.querySelectorAll("main > section.fold")].filter((s) => !s.classList.contains("shut")).map((s) => s.id) }));
  ok(st.line === "none" && st.people && st.widgets === "none", "no design: no design line, every section as before");
  ok(st.open.length === 1 && st.open[0] === "town", "on a computer too, only the first section is open: " + st.open.join(","));
  if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, "phone-computer-width.png") });
  await p2.evaluate(() => { location.hash = "section=photos"; });
  await p2.reload();
  await p2.waitForFunction(() => window.couchTv && window.couchTv.token());
  await p2.waitForTimeout(400);
  ok(await p2.evaluate(() => !document.getElementById("photos").classList.contains("shut") && document.getElementById("town").classList.contains("shut")), "#section=photos opens Your photos instead");
  ok(!p2.errors.length, "no page errors: " + p2.errors.join("; "));
  await c2.close();
  await plain.close();
}

// ---- 6. review fixes: the bridge keeps the values, a new design starts clean, bins, the commute ----
{
  // a computer at home keeps only the keys it knows (mock.js copies bridge/server.py): the widgets' own
  // settings are one of them, so the copy handed back never wipes them
  await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "n|news", values: { feed: "rnz" } } }));
  await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "s|surf", values: { place: { name: "Bells Beach", lat: -38.37, lon: 144.28, timezone: "Australia/Melbourne" } } } }));
  await tv.waitForTimeout(900);
  const copy = await tv.evaluate(() => (JSON.parse(localStorage.getItem("mock:api.settings") || "{}").settings || {}).widgets);
  ok(copy && copy["n|news"] && copy["n|news"].feed === "rnz" && copy["s|surf"] && copy["s|surf"].place.name === "Bells Beach", "the bridge's copy keeps each widget's settings: " + JSON.stringify(copy));
  // the same design sent again with a widget moved: the same widgets, so every change stays
  const moved = JSON.parse(JSON.stringify(design));
  moved.objects.filter((o) => o.id === "n")[0].x -= 10;
  await tv.evaluate((d) => localStorage.setItem("tvdesigner.design", JSON.stringify(d)), moved);
  await tv.goto(HOME + "?mock=1&wxlive=1&design=local");
  await tv.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="n"] .cw'));
  await tv.waitForTimeout(1500);
  const kept2 = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets || {}; });
  ok(kept2["n|news"] && kept2["n|news"].feed === "rnz", "a widget moved 10 px is the same design: the news source stays (" + JSON.stringify(kept2["n|news"]) + ")");
  // a new design: the news source (a design choice) is dropped, the beach (kept on the TV) stays
  const next = JSON.parse(JSON.stringify(design));
  next.objects = next.objects.concat([
    { id: "b", type: "widget", kind: "bins", x: 1300, y: 700, w: 460, h: 300, opts: { weekday: 2, alt: true } },
    { id: "c", type: "widget", kind: "commute", x: 1300, y: 340, w: 560, h: 300 },
    { id: "cd", type: "widget", kind: "countdown", x: 600, y: 700, w: 460, h: 300, opts: { label: "Holidays", month: 12, day: 20 } }]);
  await tv.evaluate((d) => localStorage.setItem("tvdesigner.design", JSON.stringify(d)), next);
  await tv.goto(HOME + "?mock=1&wxlive=1&design=local");
  await tv.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="b"] .cw'));
  await tv.waitForTimeout(700);
  const after = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets || {}; });
  ok(!(after["n|news"] && after["n|news"].feed) && after["s|surf"] && after["s|surf"].place.name === "Bells Beach", "a new design drops the old design choices and keeps what is kept on the TV: " + JSON.stringify(after));
  // bins: Which bin goes out this week sets the count; a new bin night keeps the same bin this week
  const binsOf = () => tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "b|bins")[0].settings);
  let b = await binsOf();
  ok(b.some((s) => s.key === "thisweek" && s.shown), "with Taking turns on, Which bin goes out this week shows");
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "b|bins", values: { thisweek: "b" } } }))).ok, "the phone picks the second bin for this week");
  b = await binsOf();
  ok(b.filter((s) => s.key === "thisweek")[0].value === "b", "and it reads back as the second bin");
  const anchor = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return ((r.s || r).widgets || {})["b|bins"].anchor; });
  ok(Number.isInteger(anchor), "the count is kept as whole days: " + anchor);
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "b|bins", values: { weekday: 4 } } }))).ok, "a new bin night");
  b = await binsOf();
  ok(b.filter((s) => s.key === "thisweek")[0].value === "b", "keeps the second bin going out this week");
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "b|bins", values: { alt: "yes" } } }))).ok === false, "an on or off setting takes only on or off");
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "b|bins", values: { thisweek: null } } }))).ok, "clearing it");
  const cleared = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return ((r.s || r).widgets || {})["b|bins"] || {}; });
  ok(cleared.anchor === undefined, "takes its count off too");
  // a number from the phone is rounded to the setting's step, as on the TV
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "cd|countdown", values: { day: 5.5 } } }))).ok, "a countdown day of 5.5 from the phone");
  const day = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return ((r.s || r).widgets || {})["cd|countdown"].day; });
  ok(day === 6, "is kept as 6, the setting's whole step: " + day);
  // the commute: Where to says Not set (never the home's town), and its clear row says what it does
  const cm = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "c|commute")[0]);
  const to = cm.settings.filter((s) => s.key === "to")[0];
  ok(to && to.words === "Not set", "Commute, Where to: Not set until it is picked (" + (to && to.words) + ")");
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "c|commute", values: { to: { name: "Geelong", lat: -38.15, lon: 144.36, timezone: "Australia/Melbourne" } } } }))).ok, "Where to from the phone");
  await openSettings(tv); await goSec(tv, "Designs");
  const studio = (await rowsText(tv)).join(" | ");
  ok(/Commute, middle right/.test(studio) && !/Where to\b.*Type the town or suburb you drive to/.test(studio), "the Commute is one row in Widgets on this home, the old Commute rows are gone: " + studio.slice(0, 500));
  await closeSettings(tv);
  ok(!tv.errors.length, "no page errors: " + tv.errors.join("; "));
}

// ---- 7. the resend bug: the same widgets sent again with one design choice changed ----
{
  const stored = () => tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return r.s || r; });
  const valueOf = (key, k) => tv.evaluate(([key, k]) => { const w = window.tv.atHomeRead().design.widgets.filter((x) => x.key === key)[0]; const s = w && w.settings.filter((x) => x.key === k)[0]; return s ? s.value : undefined; }, [key, k]);
  const send = async (d, wait) => {
    await tv.evaluate((x) => localStorage.setItem("tvdesigner.design", JSON.stringify(x)), d);
    await tv.goto(HOME + "?mock=1&wxlive=1&design=local");
    await tv.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="k"] .cw'));
    await tv.waitForTimeout(wait || 1500);
  };
  const clockDesign = (fmt) => ({ v: 1, background: { colour: "#1d3a4f" }, objects: [
    { id: "k", type: "widget", kind: "clock", x: 80, y: 60, w: 560, h: 260, opts: { format: fmt } },
    { id: "n", type: "widget", kind: "news", x: 1300, y: 40, w: 560, h: 220, opts: { feed: "abc" } }] });
  await send(clockDesign("12h"));
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "k|clock", values: { format: "auto" } } }))).ok, "the TV changes the clock to Follow this TV");
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "n|news", values: { feed: "rnz" } } }))).ok, "and the news to RNZ");
  await tv.waitForTimeout(900);
  let st = await stored();
  ok(st.widgets_base && st.widgets_base["k|clock"] && st.widgets_base["k|clock"].format, "the design's own clock format is kept as the base: " + JSON.stringify(st.widgets_base));
  // the same design again: nothing changes
  await send(clockDesign("12h"));
  ok(await valueOf("k|clock", "format") === "auto" && await valueOf("n|news", "feed") === "rnz", "the same design again changes nothing (clock " + await valueOf("k|clock", "format") + ", news " + await valueOf("n|news", "feed") + ")");
  // Studio sends it again made 24 hour: the new format wins, the news override stays
  await send(clockDesign("24h"));
  st = await stored();
  ok(await valueOf("k|clock", "format") === "24h", "a resend made 24 hour wins over the TV's clock change: " + await valueOf("k|clock", "format") + " " + JSON.stringify(st.widgets));
  ok(await valueOf("n|news", "feed") === "rnz" && st.widgets["n|news"] && st.widgets["n|news"].feed === "rnz", "the TV's news source stays when only the clock changed: " + JSON.stringify(st.widgets));
  ok(!(st.widgets["k|clock"] && st.widgets["k|clock"].format), "the clock override is gone from Home settings");
  // an older TV with no base yet: it learns the base and drops nothing
  await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "k|clock", values: { format: "12h" } } }));
  await tv.waitForTimeout(900);
  await tv.evaluate(() => { for (const k of ["mock:tvhome.settings", "tvhome.settings", "mock:api.settings"]) { const raw = localStorage.getItem(k); if (!raw) continue; const r = JSON.parse(raw); const s = r.s || (r.settings && typeof r.settings === "object" && !Array.isArray(r.settings) && k === "mock:api.settings" ? r.settings : r); delete s.widgets_base; localStorage.setItem(k, JSON.stringify(r)); } });
  await send(clockDesign("24h"));
  st = await stored();
  ok(await valueOf("k|clock", "format") === "12h" && await valueOf("n|news", "feed") === "rnz", "with no base yet, nothing is dropped: " + JSON.stringify(st.widgets));
  ok(st.widgets_base && st.widgets_base["k|clock"], "and the base is filled in: " + JSON.stringify(st.widgets_base));
  ok(!tv.errors.length, "no page errors: " + tv.errors.join("; "));
}

await tv.close();
await browser.close();
server.close();
console.log("ok: " + n + " design aware settings checks passed");
