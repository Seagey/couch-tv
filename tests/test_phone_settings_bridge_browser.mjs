// Home settings on the phone for a TV whose home a computer runs (Samsung, LG, VIDAA, Roku, an Android TV
// with a computer...), in a real browser, against the bridge's own handlers (tests/phone_page_standin.py):
//  1. The TV home's Home settings shows "Change this on your phone" with a QR where the home computer
//     serves the page (mock ?phonepage=bridge, and ?tv= for its second TV), and the Couch TV home app with
//     no computer shows it from its own page (TV.phoneLink). An older computer with no page shows none.
//  2. The real TV home, opened from the stand-in computer, hands its At home view to the computer and
//     takes the phone's changes (phone-page.js): the note typed on the phone is in the TV's own store.
//  3. The phone page (setup.html) from the computer: #pin= pairs by itself, the parts only the on-TV app
//     has are left out, the town is saved and reaches the TV home, a photo is made screen size on the
//     computer and shown on the TV, and "Show a code on the TV" puts a code on the TV home to type.
// Needs Playwright (Chromium) and the repo's .venv with bridge/requirements.txt. Without either it says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_settings_bridge_browser.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
const PY = [path.join(ROOT, ".venv/bin/python"), path.join(ROOT, "../repo/.venv/bin/python")].find((p) => fs.existsSync(p));
if (!PY) { console.log("SKIP: no .venv with the bridge's packages"); process.exit(0); }
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const KEY = "phone-page-test-key-0123";

// ---- the stand-in home computer ----
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "couchtv-ppb-"));
const bridge = spawn(PY, [path.join(ROOT, "tests/phone_page_standin.py"), DATA, KEY], { stdio: ["ignore", "pipe", "pipe"] });
let errText = "";
bridge.stderr.on("data", (d) => { errText += d; });
const PORT = await new Promise((resolve, reject) => {
  let out = "";
  bridge.stdout.on("data", (d) => { out += d; const m = /PORT (\d+)/.exec(out); if (m) resolve(+m[1]); });
  bridge.on("exit", () => reject(new Error("the stand-in stopped: " + errText)));
  setTimeout(() => reject(new Error("the stand-in did not start: " + errText)), 20000);
});
const ORIGIN = "http://127.0.0.1:" + PORT;
const H = { Authorization: "Bearer " + KEY };
const get = (p) => fetch(ORIGIN + p, { headers: H }).then((r) => r.json());
const until = async (fn, what, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timed out: " + what); await new Promise((r) => setTimeout(r, 150)); } };

console.log("Running phone Home settings (home computer) browser tests...");
const browser = await chromium.launch();
try {
  const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 200); };

  // ---- 1. the QR's gates (a mock home) ----
  const MOCKHOME = ORIGIN + "/tv/index.html";
  async function settingsOpen(q, init) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
    if (init) await page.addInitScript(init);
    await page.goto(MOCKHOME + "?mock=1&reset=1" + q);
    await page.evaluate(() => localStorage.clear());
    await page.goto(MOCKHOME + "?mock=1" + q);
    await page.waitForFunction(() => window.tv && document.getElementById("settings"));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 700);
    return page;
  }
  for (const [q, addr, what, init] of [
    ["&phonepage=bridge", "my-computer.local:5400/setup", "a TV the home computer runs"],
    ["&phonepage=bridge2", "my-computer.local:5400/setup?tv=bedroom", "the home computer's second TV"],
    ["&offline=1&alone=1", "192.0.2.7:5400/setup", "the Couch TV home app with no computer (its own page)",
      () => { window.TVOS = { phoneLink: function () { return JSON.stringify({ url: "http://192.0.2.7:5400/setup#pin=482913", pin_expires_in: 170 }); } }; }]]) {
    const page = await settingsOpen(q, init);
    ok(await page.evaluate(() => document.getElementById("set-phone").classList.contains("on")), what + ": Home settings shows Change this on your phone");
    ok(await page.evaluate(() => !!document.querySelector("#set-phone-qr svg")), what + ": with a QR");
    const pc = await page.evaluate(() => document.getElementById("set-phone-pc").textContent);
    ok(pc === "Or on a computer: " + addr + ", code 482 913", what + ": the computer line: " + pc);
    ok(!page.errors.length, what + ": no page errors: " + page.errors.join("; "));
    await page.close();
  }
  for (const [q, what] of [["", "an older home computer with no phone page"], ["&offline=1", "the Couch TV home app whose page is not running"]]) {
    const page = await settingsOpen(q);
    ok(!(await page.evaluate(() => document.getElementById("set-phone").classList.contains("on"))), "no QR on " + what);
    await page.close();
  }

  // the Couch TV home app's own page (no computer): what PhoneServer.kt asks the home page for (tv.phonePage)
  {
    const page = await settingsOpen("&offline=1");
    const r = await page.evaluate(() => window.tv.phonePage("read"));
    ok(r && r.ok && r.settings && Array.isArray(r.people), "tv.phonePage read: Home settings and the people");
    const p = await page.evaluate(() => window.tv.phonePage("patch", { place: { name: "Hobart", area: "Tasmania, Australia", lat: -42.87936, lon: 147.32941, timezone: "Australia/Hobart" } }));
    ok(p.ok && p.settings.place.name === "Hobart" && p.settings.place.lat === -42.88 && p.settings.place.lon === 147.33, "patch: the town, rounded to the town as the TV does");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings")).s.place.name) === "Hobart", "kept in the home's own Home settings");
    ok((await page.evaluate(() => window.tv.phonePage("patch", { place: { name: "", lat: 1, lon: 1 } }))).ok === false, "a town with no name is refused");
    const ph = await page.evaluate(() => window.tv.phonePage("photo", "p1abc-1234.jpg"));
    ok(ph.ok && ph.photo.file === "p1abc-1234.jpg" && ph.count === 1, "photo: listed in Home settings");
    const un = await page.evaluate((id) => window.tv.phonePage("unphoto", id), ph.photo.id);
    ok(un.ok && un.file === "p1abc-1234.jpg" && un.count === 0, "unphoto: off the list, its file named for the app to delete");
    ok((await page.evaluate(() => window.tv.phonePage("unphoto", "nope"))).ok === false, "a photo not on the list: refused");
    const g = await page.evaluate(() => window.tv.phonePage("guest", "the Nguyen family"));
    ok(g.ok && g.guest.name === "the Nguyen family", "guest: the Welcome widget's name");
    await page.evaluate(() => window.tv.phonePage("code", "482913"));
    ok(await page.evaluate(() => (document.querySelector(".phone-code") || {}).textContent) === "Code for your phone: 482 913", "code: a line on the home");
    await page.evaluate(() => window.tv.phonePage("code", ""));
    ok(await page.evaluate(() => !document.querySelector(".phone-code")), "and taken off");
    ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
    await page.close();
  }
  // the phone page as the Couch TV home app serves it (mode "launcher"): no phone remote, Android's own home choice
  {
    const ctxL = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const pg = await ctxL.newPage();
    pg.errors = []; pg.on("pageerror", (e) => pg.errors.push(String(e)));
    await pg.addInitScript((k) => { localStorage.setItem("couchtv.token", k); }, KEY);
    const J = (o) => ({ contentType: "application/json", body: JSON.stringify(o) });
    await pg.route(ORIGIN + "/api/settings*", (rt) => rt.fulfill(J({ ok: true, mode: "launcher", settings: {}, people: [{ id: "sam", name: "Sam" }], weather: null })));
    await pg.route(ORIGIN + "/api/athome*", (rt) => rt.fulfill(J({ ok: true, live: true, athome: { note: null, lists: [], guide: [], stay: {} } })));
    await pg.route(ORIGIN + "/api/home*", (rt) => rt.fulfill(J({ ok: true, on: true, held: false, fire_tv: false, watch: false })));
    let forgot = 0;
    await pg.route(ORIGIN + "/api/phones**", (rt) => { if (rt.request().method() === "POST") { forgot++; rt.fulfill(J({ ok: true, phones: 0 })); } else rt.fulfill(J({ ok: true, phones: 2 })); });
    await pg.goto(ORIGIN + "/setup");
    await pg.waitForFunction(() => document.getElementById("people-now").textContent === "Sam");
    await pg.evaluate(() => document.querySelectorAll("main > section.fold.shut").forEach((s) => s.classList.remove("shut")));
    await pg.waitForFunction(() => /One step left/.test(document.getElementById("home-state").textContent));
    ok(await pg.isHidden("#to-remote") && await pg.isHidden("#people-links"), "launcher: no links to a phone remote that is not there");
    ok(/on the TV: Home settings, People/.test(await pg.textContent("#people-how")), "launcher: people are changed on the TV, it says where");
    ok(await pg.isHidden("#home-off") && await pg.isVisible("#home"), "launcher: Use as home screen shows Android's own step, never a switch off");
    for (const id of ["tv", "kids-first", "ask", "upd", "tvname", "keys"]) ok(await pg.isHidden("#" + id), "launcher: left out #" + id);
    // its own paired phones (Fable 9): listed, and Forget every phone asks the app
    await pg.waitForFunction(() => /2 phones are paired/.test(document.getElementById("phones").textContent), null, { timeout: 8000 });
    ok(await pg.isVisible("#phones-card") && await pg.isVisible("#forget"), "launcher: the Phones card shows its paired phones and Forget every phone");
    pg.once("dialog", (d) => d.accept());
    await Promise.all([pg.waitForResponse((r) => r.url().endsWith("/api/phones/forget") && r.request().method() === "POST"), pg.click("#forget")]);
    ok(forgot === 1, "launcher: Forget every phone asks the TV to forget them");
    ok(!pg.errors.length, "launcher: no page errors: " + pg.errors.join("; "));
    await ctxL.close();
  }

  // a Roku or an Apple TV: their Couch TV takes the town and people; At home, photos and widgets are left out
  {
    const ctxR = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const pg = await ctxR.newPage();
    pg.errors = []; pg.on("pageerror", (e) => pg.errors.push(String(e)));
    // a phone that paired the computer's phone remote (couchtv.key on the same address) needs no code here
    await pg.addInitScript((k) => { if (!sessionStorage.getItem("seen")) { localStorage.setItem("couchtv.key", k); sessionStorage.setItem("seen", "1"); } }, KEY);
    await pg.route(ORIGIN + "/api/settings*", async (rt) => { const r = await rt.fetch(); const j = await r.json(); j.home = "roku"; rt.fulfill({ contentType: "application/json", body: JSON.stringify(j) }); });
    let athomeAsked = false;
    pg.on("request", (r) => { if (/\/api\/athome/.test(r.url())) athomeAsked = true; });
    await pg.goto(ORIGIN + "/setup");
    await pg.waitForFunction(() => document.getElementById("people-now").textContent !== "Checking…");
    ok(!(await pg.$("#ctv-pair")), "a phone with the computer's phone remote paired opens it with no code");
    for (const id of ["photos", "athome", "dapps"]) ok(await pg.isHidden("#" + id), "Roku: left out #" + id);
    // widgets: the design lives on the Roku, so the page says where a widget is changed (Couch TV Studio)
    ok(await pg.isVisible("#widgets") && /changed in Couch TV Studio/.test(await pg.textContent("#widgets")) && /on the Roku/.test(await pg.textContent("#widgets")), "Roku: Widgets says to change them in Couch TV Studio");
    ok(!(await pg.$$("#w-list details")).length, "Roku: no widget boxes it could not save");
    ok(await pg.isVisible("#town") && await pg.isVisible("#people"), "Roku: the town and people are there");
    ok(/takes the town and the people from here/.test(await pg.textContent("#intro-from")), "Roku: it says what reaches the TV");
    ok(!athomeAsked, "Roku: At home is not asked for");
    ok(!pg.errors.length, "Roku: no page errors: " + pg.errors.join("; "));
    await ctxR.close();
  }
  // a VIZIO (Fable 10): it shows its own home and nothing asks for the weather there, so only the people
  {
    const ctxV = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const pg = await ctxV.newPage();
    pg.errors = []; pg.on("pageerror", (e) => pg.errors.push(String(e)));
    await pg.addInitScript((k) => { localStorage.setItem("couchtv.key", k); }, KEY);
    await pg.route(ORIGIN + "/api/settings*", async (rt) => { const r = await rt.fetch(); const j = await r.json(); j.home = "none"; rt.fulfill({ contentType: "application/json", body: JSON.stringify(j) }); });
    await pg.goto(ORIGIN + "/setup");
    await pg.waitForFunction(() => document.getElementById("people-now").textContent !== "Checking…");
    for (const id of ["town", "photos", "athome", "widgets", "dapps"]) ok(await pg.isHidden("#" + id), "VIZIO: left out #" + id);
    ok(await pg.isHidden('.jump a[href="#town"]'), "VIZIO: no Town chip either");
    ok(await pg.isVisible("#people"), "VIZIO: the people are there");
    ok(/only the people are here/.test(await pg.textContent("#intro-from")), "VIZIO: it says only the people are here");
    ok(!pg.errors.length, "VIZIO: no page errors: " + pg.errors.join("; "));
    await ctxV.close();
  }
  // a home computer with no pairing key (the default): nothing to pair, the page opens straight away
  {
    const ctxO = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const pg = await ctxO.newPage();
    await pg.route(ORIGIN + "/api/health*", (rt) => rt.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, auth: "ok", paired: true }) }));
    await pg.goto(ORIGIN + "/setup");
    await pg.waitForFunction(() => localStorage.getItem("couchtv.token") === "open", null, { timeout: 8000 });
    ok(true, "no pairing key on the computer: the page needs no code");
    await ctxO.close();
  }

  // ---- 2. the real TV home, opened from the computer ----
  const tvPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tvPage.errors = []; tvPage.on("pageerror", (e) => tvPage.errors.push(String(e)));
  const TVHOME = ORIGIN + "/tv/index.html?api=" + encodeURIComponent(ORIGIN) + "&key=" + KEY;
  await tvPage.goto(TVHOME);
  await until(() => tvPage.evaluate(() => !!(window.tv && window.CouchPhonePage) && document.readyState === "complete").catch(() => false), "the TV home is back");
  await tvPage.waitForTimeout(1500);
  await until(() => get("/api/athome").then((j) => j.live), "the TV home hands its view to the computer");
  ok(true, "the TV home hands its At home view to the computer (live)");
  // Home settings on the real home: the QR from the computer
  await tvPage.evaluate(() => window.tv.settingsKey()); await tvPage.waitForTimeout(300); await press(tvPage, "Enter", 1200);
  await tvPage.waitForFunction(() => document.getElementById("set-phone").classList.contains("on"), null, { timeout: 8000 });
  const pc = await tvPage.evaluate(() => document.getElementById("set-phone-pc").textContent);
  ok(/^Or on a computer: [^ ]+:\d+\/setup, code \d{3} \d{3}$/.test(pc), "the real TV home shows the computer's QR and line: " + pc);
  const code = pc.replace(/\D/g, "").slice(-6);
  await press(tvPage, "Escape", 300); await press(tvPage, "Backspace", 300);

  // ---- 3. the phone page from the computer ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
  const hosts = new Set();
  phone.on("request", (r) => hosts.add(new URL(r.url()).host));
  await phone.route("https://geocoding-api.open-meteo.com/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [
    { id: 1, name: "Hobart", latitude: -42.87936, longitude: 147.32941, timezone: "Australia/Hobart", admin1: "Tasmania", country: "Australia", country_code: "AU" }] }) }));
  await phone.goto(ORIGIN + "/setup#pin=" + code);
  // the page pairs, then loads again: wait for the second load's settings
  await until(() => phone.evaluate(() => !!(window.couchTv && window.couchTv.token()) && document.getElementById("people-now").textContent !== "Checking…").catch(() => false), "the phone pairs and loads");
  ok(await phone.evaluate((k) => window.couchTv.token() === k, KEY), "the code from the TV's QR pairs the phone (it gets the computer's pairing key)");
  ok(!/pin=/.test(phone.url()), "and is taken off the address");
  await phone.evaluate(() => document.querySelectorAll("main > section.fold.shut").forEach((s) => s.classList.remove("shut")));
  ok(/home computer/.test(await phone.textContent("#intro-from")), "the page says it comes from the home computer");
  for (const id of ["ask", "tvname", "keys", "upd", "phones-card", "home"]) ok(await phone.isHidden("#" + id), "left out (set up on the computer or only on the on-TV app): #" + id);
  ok(await phone.isVisible("#town") && await phone.isVisible("#photos") && await phone.isVisible("#athome"), "Town, Your photos and At home are there");
  // the town, to the TV home
  await phone.fill("#town-q", "Hobar");
  await phone.waitForSelector("#town-list button");
  await phone.click("#town-list button");
  await phone.waitForFunction(() => /Saved/.test(document.getElementById("town-msg").textContent));
  ok((await get("/api/settings")).settings.place.name === "Hobart", "the computer keeps the town");
  await until(() => tvPage.evaluate(() => { try { return (JSON.parse(localStorage.getItem("tvhome.settings")).s.place || {}).name === "Hobart"; } catch (e) { return false; } }).catch(() => false), "the TV home takes the town");
  ok(true, "the TV home takes the phone's town (it starts again with it)");
  await until(() => tvPage.evaluate(() => !!(window.tv && window.CouchPhonePage) && document.readyState === "complete").catch(() => false), "the TV home is back");
  await tvPage.waitForTimeout(1500);
  // At home: the note goes into the TV home's own store
  await until(() => get("/api/athome").then((j) => j.live), "the TV home is back");
  await phone.fill("#ah-note", "Dinner at 6"); await phone.fill("#ah-from", "Mum");
  await phone.click("#ah-note-save");
  await phone.waitForFunction(() => /note is on the TV/.test(document.getElementById("ah-note-msg").textContent), null, { timeout: 20000 });
  const view = await tvPage.evaluate(() => window.tv.atHomeRead());
  ok(view && view.note && view.note.text === "Dinner at 6" && view.note.from === "Mum", "the note is in the TV home's own store");
  // a calendar link: the TV keeps it, the computer and the phone only ever see its host
  await phone.fill("#ah-cal", "https://calendar.example.com/private-abc123/basic.ics");
  await phone.click("#ah-cal-save");
  await phone.waitForFunction(() => document.getElementById("ah-cal-now").textContent === "calendar.example.com", null, { timeout: 20000 });
  ok(!JSON.stringify(await get("/api/athome")).includes("private-abc123"), "the computer holds the calendar's host only");
  // a photo: made screen size on the computer, listed, shown on the TV home with the key
  const big = await phone.evaluate(() => new Promise((res) => { const c = document.createElement("canvas"); c.width = 3000; c.height = 2000; const g = c.getContext("2d"); g.fillStyle = "#3a7"; g.fillRect(0, 0, 3000, 2000); c.toBlob((b) => b.arrayBuffer().then((a) => res(Array.from(new Uint8Array(a)))), "image/jpeg", 0.8); }));
  await phone.setInputFiles("#photo-file", { name: "beach.jpg", mimeType: "image/jpeg", buffer: Buffer.from(big) });
  await phone.waitForFunction(() => /on the TV now/.test(document.getElementById("photo-msg").textContent), null, { timeout: 20000 });
  const photos = (await get("/api/settings")).settings.photos;
  ok(photos.length === 1 && /^bridge[a-z0-9]+\.jpg$/.test(photos[0].file), "the photo is listed in the TV's Home settings: " + JSON.stringify(photos));
  const pic = await fetch(ORIGIN + "/api/photo/" + photos[0].file, { headers: H });
  const bytes = Buffer.from(await pic.arrayBuffer());
  ok(pic.status === 200 && bytes.readUInt16BE(0) === 0xffd8, "made a JPEG on the computer");
  ok(bytes.length < big.length, "smaller than what the phone sent (" + bytes.length + " < " + big.length + ")");
  await phone.waitForFunction(() => document.querySelectorAll("#photo-list .photo img").length === 1);
  ok(await phone.evaluate(() => { const i = document.querySelector("#photo-list .photo img"); return new Promise((r) => { if (i.complete) r(i.naturalWidth); else { i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); } }); }) === 1620,
    "the phone page shows it (fetched with the key in the header), 1620 wide");
  ok(await phone.evaluate(() => /^blob:/.test(document.querySelector("#photo-list .photo img").src)), "shown from the phone's memory (a blob), not by a link");
  ok(!(await ctx.cookies()).some((c) => c.name === "couchtv_token") && await phone.evaluate(() => !/couchtv_token/.test(document.cookie)),
    "the pairing key is never in a cookie (Fable 11)");
  await until(() => tvPage.evaluate(() => { try { return (JSON.parse(localStorage.getItem("tvhome.settings")).s.photos || []).length === 1; } catch (e) { return false; } }).catch(() => false), "the TV home takes the photo");
  await until(() => tvPage.evaluate(() => !!(window.tv && window.CouchPhonePage) && document.readyState === "complete").catch(() => false), "the TV home is back");
  await tvPage.waitForTimeout(1500);
  const want = await tvPage.evaluate((f) => { const s = location.search; const m = /[?&]api=([^&]+)/.exec(s); return decodeURIComponent(m[1]) + "/api/photo/" + f; }, photos[0].file);
  const direct = await tvPage.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = u; }), want + "?key=" + KEY);
  ok(direct === 1620, "the TV home's address for it (photoSrc, with the key) loads it: " + direct );
  ok(await tvPage.evaluate(() => (JSON.parse(localStorage.getItem("tvhome.settings")).s.photos || [])[0].file.indexOf("bridge") === 0), "listed on the TV home as the computer's photo");
  // removed on the phone: off the TV's list, and the file is gone
  phone.once("dialog", (d) => d.accept());
  await phone.click("#photo-list .photo button");
  await phone.waitForFunction(() => /Removed/.test(document.getElementById("photo-msg").textContent));
  ok((await get("/api/settings")).settings.photos.length === 0 && (await fetch(ORIGIN + "/api/photo/" + photos[0].file, { headers: H })).status === 404, "removed: off the list, the file deleted");
  const others = [...hosts].filter((h) => h !== new URL(ORIGIN).host && h !== "geocoding-api.open-meteo.com");
  ok(!others.length, "the phone talks only to the home computer and the place search: " + others.join(", "));
  const words = await phone.evaluate(() => document.body.innerText);
  ok(!/[–—]/.test(words) && !/\b(Beta|Experimental|coming soon)\b/i.test(words), "plain words: no long dashes, no Beta, Experimental or coming soon");
  ok(!phone.errors.length, "no page errors on the phone: " + phone.errors.join("; "));
  await ctx.close();

  // a phone with no code: "Show a code on the TV" puts one on the TV home, and typing it pairs
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone2 = await ctx2.newPage();
  await phone2.goto(ORIGIN + "/setup");
  await phone2.waitForSelector("#ctv-ask");
  await phone2.click("#ctv-ask");
  await phone2.waitForFunction(() => /on the TV now/.test(document.getElementById("ctv-msg").textContent));
  const line = await tvPage.waitForFunction(() => { const e = document.querySelector(".phone-code"); return e && e.textContent; }, null, { timeout: 15000 }).then((h) => h.jsonValue());
  ok(/^Code for your phone: \d{3} \d{3}$/.test(line), "the TV home shows the code as a line: " + line);
  await phone2.fill("#ctv-pin", line.replace(/\D/g, ""));
  await phone2.click("#ctv-go");
  await until(() => phone2.evaluate(() => !!(window.couchTv && window.couchTv.token())).catch(() => false), "typing the code pairs");
  ok(true, "typing the code from the TV pairs the phone");
  await tvPage.waitForFunction(() => !document.querySelector(".phone-code"), null, { timeout: 15000 });
  ok(true, "the line goes once the code is used");
  await ctx2.close();
  // the QR never keeps a used code (Fable 7), and Show a code on the TV never swaps the QR's code (Fable 3)
  await tvPage.evaluate(() => window.tv.settingsKey()); await tvPage.waitForTimeout(300); await press(tvPage, "Enter", 1200);
  await tvPage.waitForFunction(() => document.getElementById("set-phone").classList.contains("on"), null, { timeout: 8000 });
  const qrCode = () => tvPage.evaluate(() => document.getElementById("set-phone-pc").textContent.replace(/\D/g, "").slice(-6));
  const a1 = await qrCode();
  await new Promise((r) => setTimeout(r, 5500));   // one ask every 5 s at most: the phone above asked a moment ago
  const st = await fetch(ORIGIN + "/api/pair/start", { method: "POST" });
  ok(st.status === 200, "Show a code on the TV answers: " + st.status);
  const shown = await tvPage.waitForFunction(() => { const e = document.querySelector(".phone-code"); return e && e.textContent; }, null, { timeout: 15000 }).then((h) => h.jsonValue());
  ok(shown.replace(/\D/g, "") === a1 && await qrCode() === a1, "Show a code on the TV shows the QR's own code, and the QR keeps it: " + a1);
  const used = await fetch(ORIGIN + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: a1 }) });
  ok(used.status === 200, "a phone uses the QR's code");
  const t0 = Date.now();
  await until(async () => { const c = await qrCode(); return c && c !== a1; }, "the QR draws a new code", 15000);
  ok(true, "the QR shows a new code " + (Date.now() - t0) + " ms after its code was used (no dead code left on screen)");
  const fresh = await qrCode();
  const re = await fetch(ORIGIN + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: fresh }) });
  ok(re.status === 200, "and that new code pairs");
  await press(tvPage, "Escape", 300); await press(tvPage, "Backspace", 300);
  ok(!tvPage.errors.length, "no page errors on the TV home: " + tvPage.errors.join("; "));
  await tvPage.close();
} finally {
  await browser.close();
  bridge.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log("phone Home settings (home computer) browser tests: " + n + " passed");
