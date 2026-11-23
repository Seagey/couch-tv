// Widget swarm 2, the clocks group: clock, tallclock, glassclock, analog, flipclock, wordclock,
// worldclock, date, month, week, countdown, timer. In a real browser, on the real TV home (index.html,
// mock TV, a Couch TV Studio design with all twelve), at a fixed time (Fri 20 Nov 2026 7:42:07pm, Sydney):
//  1. every one of them lists its own settings in Home settings, Widgets on this home, in Hold OK, Edit
//     on the TV (its own page, with each setting's row), and on the phone's Widgets on this TV;
//  2. EVERY setting, changed on the TV the way the phone and the TV's own page save it (atHomeEdit
//     widget_set), changes the drawn widget, and clearing it brings the default back;
//  3. the layers OK opens follow the same settings (Timers' Quick start and name, World clocks' cities
//     and 24 hour, the Calendar's first day of the week);
//  4. the week's forecast reads Open-Meteo (a stand in here) for its own place, never the home's under
//     its name; a real TV never shows the Timer demo;
//  5. a widget taken off the design: its settings vanish from Home settings, the TV's widget list and the
//     phone; one put back: they come back.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_clocks.mjs
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
let n = 0;
const counts = {};
const ok = (c, m, kind) => { assert.ok(c, m); n++; if (kind) counts[kind] = (counts[kind] || 0) + 1; };

// ---- the design: all twelve ----
const W12 = [
  ["c", "clock", 40, 40, 440, 300], ["t", "tallclock", 500, 40, 440, 300], ["g", "glassclock", 960, 40, 440, 300], ["a", "analog", 1420, 40, 300, 300],
  ["f", "flipclock", 40, 370, 440, 300], ["wc", "wordclock", 500, 370, 520, 300], ["wo", "worldclock", 1040, 370, 400, 300], ["cd", "countdown", 1460, 370, 300, 300],
  ["d", "date", 40, 700, 660, 200], ["m", "month", 720, 700, 360, 340], ["wk", "week", 1100, 700, 460, 340], ["ti", "timer", 1580, 700, 300, 300]];
const NAMES = { clock: "Digital clock", tallclock: "Tall clock", glassclock: "Glass clock", analog: "Analogue clock", flipclock: "Flip clock", wordclock: "Time in words",
  worldclock: "World clocks", date: "Date", month: "Month", week: "This week", countdown: "Countdown", timer: "Timer" };
const designOf = (skip) => ({ v: 1, background: { colour: "#1d3a4f" },
  elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: W12.filter((w) => !(skip || []).includes(w[0])).map(([id, kind, x, y, w, h]) => ({ id, type: "widget", kind, x, y, w, h })) });

// ---- a stand-in on-TV app (the same shape as test_design_settings_browser.mjs): /api/athome is the real TV page ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
let TV = null;
const HS = { settings: { lang: "en", photos: [] }, people: [], weather: null, country: "AU", tv_name: "Lounge",
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
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false });
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/athome") {
        const r = TV ? await TV.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null;
        return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false });
      }
      if (route === "POST /api/athome") {
        const r = TV ? await TV.evaluate((x) => tv.atHomeEdit(x), body().edit) : null;
        if (!r) return send(res, 200, { ok: true, live: false, queued: true });
        return r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error || "That did not save." });
      }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: true, held: true });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, current: "0.13.9", checked: true });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html";

console.log("Running the clocks group's widget settings tests...");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: "Australia/Sydney", locale: "en-AU" });
const FIXED = new Date("2026-11-20T19:42:07+11:00");
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 160); };
// The page's clock is fixed, so Date.now() never moves by itself. design.js times two things with it: an OK
// within 260 ms of a held OK is the same press, and five Back presses within 4 s switch the design off.
// A real TV's clock moves, so step this one 5 s forward (never back) before each such key.
const tick = async (page) => { page.at = (page.at || FIXED.getTime()) + 5000; await page.clock.setFixedTime(new Date(page.at)); };
const back = async (page, wait) => { await tick(page); await press(page, "Escape", wait); };

// Open-Meteo stand in: a full forecast, 22° for the home (Sydney), 31° anywhere else
const asked = [];
async function meteo(page) {
  await page.route(/open-meteo\.com/, (route) => {
    const u = new URL(route.request().url()), lat = +u.searchParams.get("latitude");
    asked.push(u.host + " " + lat + "," + u.searchParams.get("longitude"));
    const t = lat < -33 ? 22 : 31, days = Array.from({ length: 7 }, (_, i) => "2026-11-" + (20 + i));
    const hours = Array.from({ length: 48 }, (_, i) => { const d = new Date(Date.UTC(2026, 10, 20, 8 + i)); return d.toISOString().slice(0, 13) + ":00"; });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: t, weather_code: 1, is_day: 0, time: "2026-11-20T19:30" },
      hourly: { time: hours, temperature_2m: hours.map(() => t), weather_code: hours.map(() => 1), uv_index: hours.map(() => 0), precipitation_probability: hours.map(() => 5) },
      daily: { time: days, weather_code: days.map(() => 1), temperature_2m_max: days.map(() => t + 4), temperature_2m_min: days.map(() => t - 6), sunrise: days.map((d) => d + "T05:40"), sunset: days.map((d) => d + "T19:30"),
        uv_index_max: days.map(() => 9), precipitation_probability_max: days.map(() => 10) }, minutely_15: { precipitation: [0, 0, 0] } }) });
  });
}
async function tvPage(d, keep) {
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.clock.setFixedTime(FIXED);
  await meteo(page);
  if (!keep) {
    await page.goto(HOME + "?mock=1&reset=1");
    await page.evaluate(() => localStorage.clear());
  } else await page.goto(HOME + "?mock=1&wxlive=1");
  await page.evaluate((dz) => localStorage.setItem("tvdesigner.design", JSON.stringify(dz)), d);
  await page.goto(HOME + "?mock=1&wxlive=1&design=local");
  await page.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on());
  await page.waitForFunction((id) => document.querySelector('.cw-o[data-obj="' + id + '"] .cw'), d.objects[0].id);
  // the home's town (the weather the date and the week read)
  await page.waitForFunction(() => /22°/.test((document.querySelector('.cw-o[data-obj="wk"] .cw') || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
}
// what a widget on the TV draws now
const probe = (page, id) => page.evaluate((id) => {
  const r = document.querySelector('.cw-o[data-obj="' + id + '"] .cw');
  if (!r) return null;
  const divs = [...r.querySelectorAll("div")];
  return { text: r.textContent.replace(/\s+/g, " ").trim(), bg: (divs.find((e) => /glass\.jpg/.test(e.style.backgroundImage)) || { style: {} }).style.backgroundImage || "",
    align: divs.map((e) => e.style.textAlign).filter(Boolean)[0] || "", hand: !!r.querySelector('[data-hand="seconds"]'), nums: r.querySelectorAll("[data-num]").length,
    head0: (r.querySelector(".cw-month span.h") || {}).textContent || "", hh: (r.querySelector('line[stroke-width="4.4"]') || { getAttribute: () => "" }).getAttribute("transform") || "" };
}, id);
const edit = (page, key, values) => page.evaluate(([key, values]) => tv.atHomeEdit({ widget_set: { key, values } }), [key, values]);
async function settle(page, id, before) {
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); const p = await probe(page, id); if (p && JSON.stringify(p) !== JSON.stringify(before)) return p; }
  return probe(page, id);
}
const rowsText = (page) => page.evaluate(() => [...document.querySelectorAll("#set-rows .srow, #set-rows .shead")].map((e) => e.textContent.trim()));
const secs = (page) => page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
async function closeSettings(page) { for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await back(page, 250); await page.waitForTimeout(700); }
async function goSec(page, name) {
  const list = await secs(page), i = list.indexOf(name);
  assert.ok(i >= 0, "section " + name + " in " + list.join(", "));
  for (let k = 0; k < 4 && await page.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press(page, "ArrowLeft", 120);
  const at = await page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(page, i > at ? "ArrowDown" : "ArrowUp", 80);
  await page.waitForTimeout(150);
}
async function holdOn(page, id, again) {
  await page.waitForFunction((x) => window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="' + x + '"] .cw') && !document.getElementById("settings").classList.contains("on"), id, { timeout: 10000 })
    .catch(async () => { assert.fail("the home is not ready for a hold on " + id + ": " + JSON.stringify(await page.evaluate((x) => ({ on: !!(window.CouchDesign && window.CouchDesign.on()), w: !!document.querySelector('.cw-o[data-obj="' + x + '"] .cw'),
      settings: document.getElementById("settings").className, head: document.getElementById("set-head").textContent, rows: [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()).slice(0, 6), url: location.href }), id))); });
  await page.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await page.waitForTimeout(200);
  await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
  const items = await page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  if (!items.length && !again) {
    console.log("note: no menu on the first hold on " + id + ", state: " + JSON.stringify(await page.evaluate(() => ({ sheet: !!document.querySelector(".cw-sheet"), detail: !!(window.CouchDetail && window.CouchDetail.isOpen()), focus: (document.querySelector(".cw-o.cd-focus, .cd-focus") || {}).className || "" }))));
    await page.waitForTimeout(1000);
    return holdOn(page, id, true);
  }
  return items;
}

// the settings each kind must have, all wired (pre: true) and offered on the TV and the phone
const WANT = { clock: ["format", "seconds", "date", "ampm", "zone"], tallclock: ["format", "align", "zone"], glassclock: ["format", "scene", "zone"], analog: ["seconds", "numbers", "zone"], flipclock: ["format", "zone"],
  wordclock: ["precise", "dayline", "zone"], worldclock: ["cities", "format", "label"], date: ["show", "dfmt", "place"], month: ["wstart"], week: ["town", "place"],
  countdown: ["label", "day", "month", "year", "unit"], timer: ["minutes", "label"] };

let tvp = await tvPage(designOf());
TV = tvp;

// ================= 1. listed only while on the design: the TV's own list =================
{
  const v = await tvp.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => ({ key: w.key, keys: w.settings.map((s) => s.key) })));
  for (const [id, kind] of W12) {
    const w = v.find((x) => x.key === id + "|" + kind);
    ok(w, kind + ": on the TV's widget list (the phone reads it)", kind);
    ok(WANT[kind].every((k) => w.keys.includes(k)), kind + ": every setting is offered on the TV and phone: " + w.keys.join(","), kind);
  }
  ok(v.length === 12, "only the twelve on the design are listed: " + v.length);
}
// ---- Home settings, Designs, Widgets on this home ----
{
  await tvp.evaluate(() => window.tv.settingsKey()); await tvp.waitForTimeout(250); await press(tvp, "Enter", 500);
  await goSec(tvp, "Designs");
  const rows = (await rowsText(tvp)).join(" | ");
  for (const [, kind] of W12) ok(rows.includes(NAMES[kind] + ","), kind + ": in Home settings, Widgets on this home: " + rows.slice(0, 120), kind);
  await closeSettings(tvp);
}
// ---- Hold OK on each, Edit on the TV: its own page with its own rows ----
const LABELS = { clock: ["12 or 24 hour", "Show seconds", "Show the date", "Show am and pm"], tallclock: ["12 or 24 hour", "Line up"], glassclock: ["12 or 24 hour", "Glass from"],
  analog: ["Second hand", "Show the numbers"], flipclock: ["12 or 24 hour"], wordclock: ["To the minute", "Show the day"], worldclock: ["Cities", "12 or 24 hour", "Heading"],
  date: ["Shows", "Date style"], month: ["Week starts on"], week: ["Place", "Show the town name"], countdown: ["Name", "Day", "Month", "Year", "Count in"], timer: ["Quick start", "Timer name"] };
for (const [id, kind] of W12) {
  const items = await holdOn(tvp, id);
  ok(items[0] === "Settings" && items[1] === "Edit on the TV", kind + ": Hold OK offers Edit on the TV (" + items.join(", ") + ")", kind);
  await press(tvp, "ArrowDown", 120);
  // the fixed clock: design.js takes an OK within 260 ms of the held OK (by Date.now) as the same held
  // press, so with time frozen every OK on the menu would be swallowed; a real TV's clock moves. Step it.
  await tick(tvp);
  await press(tvp, "Enter", 600);
  ok(await tvp.evaluate(() => document.getElementById("settings").classList.contains("on")), kind + ": Edit on the TV opens Home settings", kind);
  const head = await tvp.textContent("#set-head"), rows = (await rowsText(tvp)).join(" | ");
  ok(head.includes(NAMES[kind]), kind + ": Edit on the TV opens its own page: " + head, kind);
  ok(LABELS[kind].every((l) => rows.includes(l)), kind + ": its page has a row for each setting: " + rows.slice(0, 300), kind);
  if (kind === "date") ok(!rows.includes("Show the town name"), "date: Show the town name waits until the weather shows (when)", kind);
  await closeSettings(tvp);
}

// the clock was stepped on above: the same home again, at 7:42:07pm
ok(!tvp.errors.length, "no page errors in the Hold OK run: " + tvp.errors.join("; "));
await tvp.close();
tvp = await tvPage(designOf(), true);
TV = tvp;
ok(await tvp.evaluate(() => window.CouchDesign.on()), "the design is still on after the Hold OK run (Back was never held)");

// ================= 2. every setting changes the drawn widget; clearing brings the default back =================
// [id, kind, setting(s) tested, values set first (kept for the case), values tested, check(after, before)]
const sydney = { name: "Byron Bay", lat: -28.64, lon: 153.61, timezone: "Australia/Sydney" };
// a number on its own (the widget draws its parts with no space between them)
const num = (t, n) => new RegExp("(^|\\D)" + n + "(\\D|$)").test(t);
const CASES = [
  ["c", "format=24h", null, { format: "24h" }, (a) => /19:42/.test(a.text)],
  ["c", "format=12h", null, { format: "12h" }, (a) => /7:42\s*pm/.test(a.text) && !/19:42/.test(a.text)],
  ["c", "seconds", null, { seconds: true }, (a, b) => /:42:07/.test(a.text) && !/:42:07/.test(b.text)],
  ["c", "date", null, { date: false }, (a, b) => /Fri/.test(b.text) && !/Fri/.test(a.text)],
  ["c", "ampm", { format: "12h" }, { ampm: false }, (a, b) => /pm/.test(b.text) && !/pm/.test(a.text)],
  ["t", "format", null, { format: "24h" }, (a) => /19:42/.test(a.text)],
  ["t", "align", null, { align: "left" }, (a, b) => a.align === "left" && b.align === "center"],
  ["g", "format", null, { format: "24h" }, (a) => /19:42/.test(a.text)],
  ["g", "scene", null, { scene: "fog" }, (a, b) => /scene-fog-glass/.test(a.bg) && !/scene-fog-glass/.test(b.bg)],
  ["a", "seconds", null, { seconds: false }, (a, b) => b.hand && !a.hand],
  ["a", "numbers", null, { numbers: true }, (a, b) => b.nums === 0 && a.nums === 4 && /12/.test(a.text)],
  ["f", "format=24h", null, { format: "24h" }, (a) => /1942/.test(a.text.replace(/\s/g, ""))],
  ["f", "format=12h", null, { format: "12h" }, (a) => /0742/.test(a.text.replace(/\s/g, ""))],
  ["wc", "precise", null, { precise: true }, (a, b) => /Eighteen minutes to eight/.test(a.text) && /Twenty to eight/.test(b.text)],
  ["wc", "dayline", null, { dayline: false }, (a, b) => /Friday evening/.test(b.text) && !/Friday/.test(a.text)],
  // a clock's own time zone (from the phone or Studio): 7:42pm in Sydney is 10:42pm Thursday in Honolulu, 5:42pm in Tokyo
  ["c", "zone", null, { zone: "Pacific/Honolulu" }, (a, b) => /10:42/.test(a.text) && /Thu/.test(a.text) && /7:42/.test(b.text) && /Fri/.test(b.text)],
  ["t", "zone", null, { zone: "Asia/Tokyo" }, (a, b) => /5:42/.test(a.text) && !/7:42/.test(a.text) && /7:42/.test(b.text)],
  ["g", "zone", null, { zone: "Asia/Tokyo" }, (a, b) => /5:42/.test(a.text) && /7:42/.test(b.text)],
  ["a", "zone", null, { zone: "Asia/Tokyo" }, (a, b) => /^rotate\(171 /.test(a.hh) && /^rotate\(231 /.test(b.hh)],
  ["f", "zone", null, { zone: "Asia/Tokyo" }, (a, b) => /0542/.test(a.text.replace(/\s/g, "")) && /0742/.test(b.text.replace(/\s/g, ""))],
  ["wc", "zone", null, { zone: "Asia/Tokyo" }, (a, b) => /Twenty to six/.test(a.text) && /Twenty to eight/.test(b.text)],
  ["wo", "cities", null, { cities: ["Asia/Tokyo", "Europe/London"] }, (a, b) => /Tokyo/.test(a.text) && /London/.test(a.text) && !/Sydney/.test(a.text) && /Sydney/.test(b.text) && !/Tokyo/.test(b.text)],
  ["wo", "format=24h", { cities: ["Asia/Tokyo"] }, { format: "24h" }, (a, b) => /17:42/.test(a.text) && /5:42\s*pm/.test(b.text)],
  ["wo", "label", null, { label: "Family" }, (a, b) => /Family/.test(a.text) && /World clock/.test(b.text) && !/World clock/.test(a.text)],
  ["cd", "label", null, { label: "Ella's party" }, (a, b) => /Ella's party/.test(a.text) && /Christmas/.test(b.text)],
  ["cd", "day", null, { day: 1 }, (a, b) => num(b.text, 35) && num(a.text, 11) && /1 December/.test(a.text) && !/Christmas/.test(a.text)],
  ["cd", "month", null, { month: 1 }, (a) => num(a.text, 66) && /25 January/.test(a.text)],
  ["cd", "year", null, { year: 2027 }, (a) => num(a.text, 400)],
  ["cd", "unit", null, { unit: "weeks" }, (a) => num(a.text, 5) && /weeks to go/.test(a.text)],
  ["d", "show=weather", null, { show: "weather" }, (a, b) => /22°/.test(a.text) && !/22°/.test(b.text)],
  ["d", "show=both", null, { show: "both" }, (a) => /22° and/.test(a.text) && /20/.test(a.text)],
  ["d", "dfmt=numeric", null, { dfmt: "numeric" }, (a) => /20\/11\/2026/.test(a.text)],
  ["d", "dfmt=weekday", null, { dfmt: "weekday" }, (a) => a.text === "Friday"],
  ["d", "dfmt=day_month", null, { dfmt: "day_month" }, (a) => a.text === "20 November"],
  ["d", "dfmt=full", null, { dfmt: "full" }, (a) => /Friday 20 November 2026/.test(a.text)],
  ["d", "dfmt=short", null, { dfmt: "short" }, (a) => a.text === "Fri 20 Nov"],
  ["d", "place", { show: "weather" }, { place: false }, (a, b) => /Sydney/.test(b.text) && !/Sydney/.test(a.text) && /22°/.test(a.text)],
  ["m", "wstart", null, { wstart: "sun" }, (a, b) => a.head0 === "S" && b.head0 === "M"],
  ["wk", "place", null, { place: false }, (a, b) => /Sydney/.test(b.text) && !/Sydney/.test(a.text) && /22°/.test(a.text)],
  ["ti", "minutes", null, { minutes: 10 }, (a, b) => /OK starts 10 minutes/.test(a.text) && /OK to start one/.test(b.text)],
  ["ti", "label", null, { label: "Pizza" }, (a, b) => /Pizza/.test(a.text) && /No timer/.test(b.text)]
];
const KIND = Object.fromEntries(W12.map((w) => [w[0], w[1]]));
const tested = {};
for (const [id, what, pre, vals, check] of CASES) {
  const key = id + "|" + KIND[id];
  if (pre) { const r = await edit(tvp, key, pre); assert.ok(r.ok, JSON.stringify(r)); }
  const before = await settle(tvp, id, null);
  const r = await edit(tvp, key, vals);
  ok(r.ok, KIND[id] + " " + what + ": saved on the TV: " + JSON.stringify(r.error || ""));
  const after = await settle(tvp, id, before);
  ok(check(after, before), KIND[id] + " " + what + ": the widget changed. before: " + JSON.stringify(before) + " after: " + JSON.stringify(after), KIND[id]);
  // cleared: back to the default
  await edit(tvp, key, Object.fromEntries(Object.keys(vals).map((k) => [k, null])));
  const back = await settle(tvp, id, after);
  ok(JSON.stringify(back) === JSON.stringify(before), KIND[id] + " " + what + ": cleared, the default is back: " + JSON.stringify(back), KIND[id]);
  if (pre) await edit(tvp, key, Object.fromEntries(Object.keys(pre).map((k) => [k, null])));
  Object.keys(vals).forEach((k) => { tested[KIND[id] + "." + k] = true; });
}
// the starter name: a countdown called Christmas, moved to 1 March on the TV, says the date instead
{
  const before = await probe(tvp, "cd");
  await edit(tvp, "cd|countdown", { day: 1, month: 3 });
  const a = await settle(tvp, "cd", before);
  ok(/1 March/.test(a.text) && !/Christmas/.test(a.text), "countdown: never Christmas over 1 March: " + a.text, "countdown");
  await edit(tvp, "cd|countdown", { day: null, month: null }); await settle(tvp, "cd", a);
}
// ---- the week's own place: Open-Meteo is asked for it, and its own forecast shows under its name ----
{
  const before = await probe(tvp, "wk");
  const r = await edit(tvp, "wk|week", { town: sydney });
  ok(r.ok, "week: a place picked on the TV");
  let a = before;
  for (let i = 0; i < 60 && !/Byron Bay/.test(a.text); i++) { await tvp.waitForTimeout(200); a = await probe(tvp, "wk"); }
  ok(/Byron Bay/.test(a.text) && /31°/.test(a.text) && !/22°/.test(a.text), "week: its own place's forecast, under its own name: " + a.text, "week");
  ok(asked.some((x) => /^api\.open-meteo\.com -28\.64,153\.61/.test(x)), "week: Open-Meteo asked for that place: " + asked.slice(-4).join("; "), "week");
  tested["week.town"] = true;
  await edit(tvp, "wk|week", { town: null });
  let back = a;
  for (let i = 0; i < 40 && !/Sydney/.test(back.text); i++) { await tvp.waitForTimeout(200); back = await probe(tvp, "wk"); }
  ok(/Sydney/.test(back.text) && /22°/.test(back.text), "week: cleared, the home's town again: " + back.text, "week");
}
for (const kind of Object.keys(WANT)) for (const k of WANT[kind]) ok(tested[kind + "." + k], kind + "." + k + " has a test that changes it and clears it");
// ---- a time zone this TV does not know: refused from the phone, and ignored in a design ----
{
  for (const z of ["Mars/Olympus", "Europe/Nowhere", "not a zone"]) {
    const r = await edit(tvp, "c|clock", { zone: z });
    ok(r.ok === false, "clock zone " + z + ": refused from the phone (" + (r.error || "") + ")", "clock");
  }
  ok(/7:42/.test((await probe(tvp, "c")).text), "and the clock keeps the TV's time");
  // in a design: Studio's zone draws, an unknown one keeps the TV's own time, none is today's clock
  const zd = designOf();
  zd.objects.filter((o) => o.id === "c")[0].opts = { zone: "Europe/Nowhere" };
  zd.objects.filter((o) => o.id === "t")[0].opts = { zone: "Asia/Tokyo" };
  zd.objects.filter((o) => o.id === "a")[0].opts = { zone: "Mars/Olympus" };
  const zp = await tvPage(zd);
  ok(/7:42/.test((await probe(zp, "c")).text), "a design's unknown zone: the clock shows the TV's own time: " + (await probe(zp, "c")).text, "clock");
  ok(/5:42/.test((await probe(zp, "t")).text) && !/7:42/.test((await probe(zp, "t")).text), "a design's Tokyo zone: the tall clock shows Tokyo's time: " + (await probe(zp, "t")).text, "tallclock");
  ok(/^rotate\(231 /.test((await probe(zp, "a")).hh), "a zone design.js drops (not a zone id): the analogue clock keeps the TV's time", "analog");
  ok(/7:42/.test((await probe(zp, "f")).text.replace(/\s/g, "").replace("0742", "7:42")), "no zone (an old design): the TV's own time", "flipclock");
  ok(!zp.errors.length, "no page errors with zones in the design: " + zp.errors.join("; "));
  await zp.close();
  TV = tvp;
}

// ================= 3. the layers OK opens =================
{
  // Timer: Quick start and its name, OK starts it straight away
  await edit(tvp, "ti|timer", { minutes: 10, label: "Pizza" });
  await tvp.waitForTimeout(300);
  await tvp.evaluate(() => window.CouchDesign.nav.focus("ti", 0)); await tvp.waitForTimeout(200);
  await press(tvp, "Enter", 800);
  const t = await tvp.evaluate(() => JSON.parse(localStorage.getItem("couchtv.timer") || "null"));
  ok(t && t.total === 600000 && t.label === "Pizza", "timer: OK with Quick start 10 minutes starts a 10 minute Pizza timer: " + JSON.stringify(t), "timer");
  const layer = await tvp.evaluate(() => (document.querySelector(".cwd-stage") || {}).textContent || "");
  ok(/Pizza/.test(layer) && /10:00|9:5\d/.test(layer), "timer: the Timers layer shows it counting down: " + layer.slice(0, 120), "timer");
  await back(tvp, 500);
  // the widgets redraw once a second when the time has moved (the fixed clock moved with Back): wait for it
  let w = await probe(tvp, "ti");
  for (let i = 0; i < 15 && !/9:5\d/.test(w.text); i++) { await tvp.waitForTimeout(200); w = await probe(tvp, "ti"); }
  ok(/Pizza/.test(w.text) && /10:00|9:5\d/.test(w.text), "timer: the widget counts it down: " + w.text, "timer");
  await tvp.evaluate(() => window.CouchWidgets.timer.cancel());
  await edit(tvp, "ti|timer", { minutes: null, label: null });
  // a second OK with no Quick start: nothing starts by itself
  await tvp.evaluate(() => window.CouchDesign.nav.focus("ti", 0)); await press(tvp, "Enter", 800);
  ok(await tvp.evaluate(() => localStorage.getItem("couchtv.timer") === null), "timer: without Quick start, OK only opens Timers", "timer");
  await back(tvp, 500);
}
{
  // World clocks: the widget's own cities and 24 hour
  await edit(tvp, "wo|worldclock", { cities: ["Asia/Tokyo"], format: "24h" });
  await tvp.waitForTimeout(300);
  await tvp.evaluate(() => window.CouchDesign.nav.focus("wo", 0)); await press(tvp, "Enter", 800);
  const layer = await tvp.evaluate(() => (document.querySelector(".cwd-stage") || {}).textContent || "");
  ok(/Tokyo/.test(layer) && /17:42/.test(layer) && !/London/.test(layer) && !/Brisbane/.test(layer), "worldclock: World clocks shows the widget's own city, 24 hour: " + layer.slice(0, 160), "worldclock");
  await back(tvp, 500);
  await edit(tvp, "wo|worldclock", { cities: null, format: null });
  await tvp.evaluate(() => window.CouchDesign.nav.focus("wo", 0)); await press(tvp, "Enter", 800);
  const l2 = await tvp.evaluate(() => (document.querySelector(".cwd-stage") || {}).textContent || "");
  ok(/London/.test(l2) && /New York/.test(l2) && /Tokyo/.test(l2) && !/Brisbane/.test(l2), "worldclock: none picked, the layer shows the same cities as the widget: " + l2.slice(0, 160), "worldclock");
  await back(tvp, 500);
}
{
  // Calendar from the Month widget: its Week starts on
  await edit(tvp, "m|month", { wstart: "sun" });
  await tvp.waitForTimeout(300);
  await tvp.evaluate(() => window.CouchDesign.nav.focus("m", 0)); await press(tvp, "Enter", 800);
  const h = await tvp.evaluate(() => [...document.querySelectorAll(".cwd-mgrid span.h")].slice(0, 7).map((e) => e.textContent).join(""));
  ok(h === "SMTWTFS", "month: the Calendar layer starts on Sunday too: " + h, "month");
  await back(tvp, 500);
  await edit(tvp, "m|month", { wstart: null });
}
// a real TV never shows the timer's demo
ok(!/Pizza/.test((await probe(tvp, "ti")).text), "timer: no demo Pizza timer on a real TV", "timer");

// ================= 4. the phone: Widgets on this TV =================
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await pctx.newPage();
phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
async function phoneTitles() {
  await phone.goto("about:blank");   // the same address with only the # changed would not load the page again
  await phone.goto(ORIGIN + "/setup#pin=482913");
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  await phone.waitForFunction(() => document.querySelectorAll("#w-list summary").length > 0, null, { timeout: 10000 });
  return phone.evaluate(() => [...document.querySelectorAll("#w-list details")].map((e) => ({ key: e.getAttribute("data-key"), title: e.querySelector("summary").textContent, body: e.textContent })));
}
{
  const list = await phoneTitles();
  for (const [id, kind] of W12) {
    const b = list.find((x) => x.key === id + "|" + kind);
    ok(b && b.title.startsWith(NAMES[kind]), kind + ": on the phone's Widgets on this TV: " + (b && b.title), kind);
    ok(b && LABELS[kind].every((l) => b.body.includes(l)), kind + ": the phone shows each of its settings", kind);
  }
  // a change from the phone reaches the TV's widget
  const before = await probe(tvp, "c");
  const r = await phone.evaluate(() => window.fetch("/api/athome", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t0k3n" }, body: JSON.stringify({ edit: { widget_set: { key: "c|clock", values: { format: "24h", seconds: true } } } }) }).then((x) => x.json()));
  ok(r.ok, "phone: the clock's settings saved through the phone's own endpoint");
  const a = await settle(tvp, "c", before);
  ok(/19:42:\d\d/.test(a.text), "phone: the TV's clock shows 24 hour with seconds: " + a.text, "clock");
  await edit(tvp, "c|clock", { format: null, seconds: null });
}

// ================= 5. off the design: gone everywhere; back on: back =================
{
  const off = ["c", "wo", "ti"];
  const tv2 = await tvPage(designOf(off), true);
  TV = tv2;
  const v = await tv2.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => w.key));
  ok(v.length === 9 && !v.some((k) => /^(c|wo|ti)\|/.test(k)), "taken off the design: not in the TV's list: " + v.join(","));
  await tv2.evaluate(() => window.tv.settingsKey()); await tv2.waitForTimeout(250); await press(tv2, "Enter", 500);
  await goSec(tv2, "Designs");
  const rows = (await rowsText(tv2)).join(" | ");
  ok(!rows.includes("Digital clock,") && !rows.includes("World clocks,") && !/Timer, /.test(rows) && rows.includes("Glass clock,"), "taken off: gone from Home settings, Widgets on this home: " + rows.slice(0, 200), "clock");
  await closeSettings(tv2);
  const list = await phoneTitles();
  ok(!list.some((x) => /^(c|wo|ti)\|/.test(x.key)) && list.length === 9, "taken off: gone from the phone: " + list.map((x) => x.key).join(","), "worldclock");
  ok(!(await probe(tv2, "c")) && !(await probe(tv2, "ti")), "and not drawn");
  ok(!tv2.errors.length, "no page errors on the second design: " + tv2.errors.join("; "));
  await tv2.close();
  // back on
  const tv3 = await tvPage(designOf(), true);
  TV = tv3;
  const v3 = await tv3.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => w.key));
  ok(v3.length === 12 && v3.includes("c|clock") && v3.includes("wo|worldclock") && v3.includes("ti|timer"), "put back: listed again: " + v3.length, "timer");
  const list3 = await phoneTitles();
  ok(list3.length === 12, "put back: on the phone again: " + list3.length);
  ok(!tv3.errors.length, "no page errors: " + tv3.errors.join("; "));
  await tv3.close();
}
ok(!tvp.errors.length, "no page errors on the TV: " + tvp.errors.join("; "));
ok(!phone.errors.length, "no page errors on the phone: " + phone.errors.join("; "));
await browser.close();
server.close();
console.log("checks by kind: " + Object.entries(counts).map(([k, v]) => k + " " + v).join(", "));
console.log("settings tested (changed and cleared): " + Object.keys(tested).length);
console.log("OK: " + n + " checks");
