// Home settings, Look, in a real browser (the TV home in its ?mock preview at 1920x1080), for the reports on the
// owner's socials (the 0.13.9 social build list, rows g01, g17, g23, g30):
//  g17 Show the clock: off hides the time (and the big scene clock in Night), the date moves up into its place,
//      and it stays off after Home settings close and after a reload. On (the default) changes nothing.
//  g30 Sharp pictures on a 4K TV: on a 1080 page, Always loads the @2x picture, Auto and Off the 1080 one; OK goes
//      Auto, Off, Always.
//  g23 Moving tiles and Mac-style dock under Lighter home: the row says "Off while Lighter home is on", OK asks
//      "Turn off Lighter home?", a second OK turns Lighter home off and the switch on. With Lighter home off
//      the dock turns Mac at once.
//  g01 A 4 GB TV whose frames are slow against its screen's refresh gets Lighter home by itself, with a one time
//      note; a smooth 30 Hz screen does not; a busy start up and a one off stutter while moving do not (two
//      strikes); a second start that stutters does; an 8 GB TV is never measured.
//  #203 Picking Classic in Look applies straight away, and Lighter home turning itself on never changes the look.
//  The new words in all 16 languages.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_look_switches_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) {
  try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright-core").chromium; }
  catch (e2) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
}

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
console.log("Running Look switches browser tests...");

const browser = await chromium.launch(process.env.COUCHTV_CHANNEL ? { channel: process.env.COUCHTV_CHANNEL } : {});
const errors = [];
// a fresh home: memory is what navigator.deviceMemory says (8 unless given), slowMs makes every frame that long
async function home(q, opt = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((o) => {
    Object.defineProperty(navigator, "deviceMemory", { get: () => o.memory || 8 });
    // the frames the page sees: refreshMs apart (the screen's own rate, 16.7 unless given), or slower:
    //   slowMs: every frame; slowVeil: while an animation runs (the still check's veil); slowNav: from the first
    //   arrow press; slowUntil: for the first slowUntil ms after the page opens (a busy start up)
    const raf = window.requestAnimationFrame.bind(window); let t = 0, nav = false, anim = 0;
    window.addEventListener("keydown", (e) => { if (/^Arrow/.test(e.key)) nav = true; }, true);
    const an = Element.prototype.animate;
    Element.prototype.animate = function () { const a = an.apply(this, arguments); anim++; const c = a.cancel.bind(a); let done = false; const end = () => { if (!done) { done = true; anim--; } }; a.cancel = () => { end(); c(); }; a.addEventListener("finish", end); return a; };
    let native = -1;   // the time moves on once per real frame, however many callbacks that frame has
    window.requestAnimationFrame = (cb) => raf((ts) => {
      if (ts !== native) {
        native = ts;
        const slow = o.slowMs || (o.slowVeil && anim > 0 && o.slowVeil) || (o.slowNav && nav && o.slowNav) || (o.slowUntil && performance.now() < o.slowUntil && 40);
        t += slow || o.refreshMs || 16.7;
      }
      cb(t);
    });
  }, opt);
  if (!opt.keep) { await page.goto(BASE + "?mock=1&reset=1"); await page.evaluate((s) => { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }, opt.storage || {}); }
  await page.goto(BASE + "?mock=1" + q);
  await page.waitForFunction(() => window.tv && document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(700);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 140); };
const cls = (page, c) => page.evaluate((x) => document.documentElement.classList.contains(x), c);
async function openLook(page) {
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(250); await press(page, "Enter", 400);
  const names = await page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
  const i = names.indexOf("Look and scenes");
  assert.ok(i >= 0, "Look and scenes in " + names.join(", "));
  for (let k = 0; k < 4 && await page.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press(page, "ArrowLeft");
  const at = await page.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(page, i > at ? "ArrowDown" : "ArrowUp", 80);
  await press(page, "ArrowRight", 200);
}
const focusRow = (page) => page.evaluate(() => { const r = document.querySelector("#set-rows .srow.focus"); return r ? { label: r.querySelector("b").textContent, sub: (r.querySelector("small") || {}).textContent || "", value: (r.querySelector(".sv") || {}).textContent || "" } : null; });
async function goRow(page, label) {
  for (let k = 0; k < 90; k++) {
    const r = await focusRow(page);
    if (r && r.label === label) return r;
    await press(page, "ArrowDown", 60);
  }
  throw new Error("no row " + label);
}
async function closeSettings(page) {
  for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(page, "Escape", 250);
  // a change in Home settings reloads the home when they close (restart())
  await page.waitForTimeout(900);
  await page.waitForFunction(() => window.tv && document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(600);
}
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, h: r.height, shown: getComputedStyle(e).display !== "none" }; }, sel);

// ---- g17 Show the clock ----
{
  const page = await home("&look=classic");
  const before = { time: await box(page, "#time"), date: await box(page, "#date") };
  ok(before.time.shown && before.time.h > 50, "Classic: the clock shows by default (" + Math.round(before.time.h) + " px high)");
  ok(!(await cls(page, "no-clock")), "on by default: no no-clock class");
  await openLook(page);
  const r = await goRow(page, "Show the clock");
  ok(r.value === "On", "the row says On: " + JSON.stringify(r));
  await press(page, "Enter", 300);
  ok((await focusRow(page)).value === "Off", "OK turns it Off");
  ok(await cls(page, "no-clock"), "the home gets no-clock straight away");
  await closeSettings(page);
  const after = { time: await box(page, "#time"), date: await box(page, "#date") };
  ok(!after.time.shown, "Classic: the time is gone");
  ok(after.date.top < before.date.top - before.time.h * 0.8, "the date moves up into the clock's place (" + Math.round(before.date.top) + " to " + Math.round(after.date.top) + ")");
  const saved = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}"); return (r.s || r).show_clock; });
  ok(saved === false, "kept in Home settings: show_clock " + saved);
  await page.reload(); await page.waitForFunction(() => window.tv && document.getElementById("date").textContent.length > 0); await page.waitForTimeout(500);
  ok(await cls(page, "no-clock") && !(await box(page, "#time")).shown, "still off after a reload");
  await page.close();
  // Night: the big scene clock goes too; the default keeps it
  const night = await home("&look=night");
  await night.waitForFunction(() => document.querySelector(".scene .gclock"));
  ok(await night.evaluate(() => [...document.querySelectorAll(".scene .gclock")].some((e) => getComputedStyle(e).display !== "none")), "Night: the scene clock shows by default");
  await night.close();
  const nightOff = await home("&look=night&showclock=off");
  await nightOff.waitForFunction(() => document.querySelector(".scene .gclock"));
  ok(await nightOff.evaluate(() => [...document.querySelectorAll(".scene .gclock")].every((e) => getComputedStyle(e).display === "none")), "Night with home.show_clock false: no scene clock");
  await nightOff.close();
  const oled = await home("&look=oled&showclock=off");
  ok(!(await box(oled, "#time")).shown, "OLED with home.show_clock false: no time");
  await oled.close();
}

// ---- g30 Sharp pictures on a 4K TV (a 1080 page) ----
{
  const bgSrc = (page) => page.evaluate(() => { const i = document.querySelector("#bg img.on"); return i ? i.getAttribute("src") : ""; });
  const page = await home("&look=classic");
  await page.waitForFunction(() => document.querySelector("#bg img.on"));
  ok(!/@2x/.test(await bgSrc(page)), "Auto on a 1080 page: the 1080 picture (" + await bgSrc(page) + ")");
  await openLook(page);
  ok((await goRow(page, "Sharp pictures on a 4K TV")).value === "Auto", "the row starts on Auto");
  ok(/memory/.test((await focusRow(page)).sub), "with the memory note: " + (await focusRow(page)).sub);
  await press(page, "Enter", 300);
  ok((await focusRow(page)).value === "Off", "OK: Off (the costly Always comes last)");
  await closeSettings(page);
  ok(!/@2x/.test(await bgSrc(page)), "Off: the 1080 picture: " + await bgSrc(page));
  await openLook(page);
  await goRow(page, "Sharp pictures on a 4K TV");
  await press(page, "Enter", 300);
  ok((await focusRow(page)).value === "Always", "OK again: Always");
  await closeSettings(page);
  await page.waitForFunction(() => /@2x/.test((document.querySelector("#bg img.on") || {}).src || ""), null, { timeout: 8000 }).catch(() => {});
  ok(/@2x\.jpg$/.test(await bgSrc(page)), "Always loads the 4K picture: " + await bgSrc(page));
  await openLook(page);
  await goRow(page, "Sharp pictures on a 4K TV");
  await press(page, "Enter", 300);
  ok((await focusRow(page)).value === "Auto", "and back to Auto");
  await page.close();
  // Night scenes too, from home.hi_res "always"
  const night = await home("&look=night&hires=always");
  await night.waitForFunction(() => document.querySelector(".scene .sbg"));
  await night.waitForTimeout(800);
  ok(await night.evaluate(() => [...document.querySelectorAll(".scene .sbg")].some((e) => /@2x/.test(e.getAttribute("src") || ""))), "Night with home.hi_res always: the 4K scene pictures");
  await night.close();
}

// ---- g23 Moving tiles and the Mac-style dock under Lighter home ----
{
  const page = await home("&look=night&lighter=1");
  ok(await cls(page, "lighter") && !(await cls(page, "dock-mac")), "Lighter home on, plain dock");
  await openLook(page);
  let r = await goRow(page, "Mac-style dock");
  ok(r.value === "Off" && r.sub === "Off while Lighter home is on", "the dock row says why it is off: " + JSON.stringify(r));
  await press(page, "Enter", 300);
  r = await focusRow(page);
  ok(r.label === "Turn off Lighter home?", "OK asks first: " + r.label);
  ok(await cls(page, "lighter"), "nothing changed yet");
  await press(page, "Enter", 400);
  ok(!(await cls(page, "lighter")) && (await cls(page, "dock-mac")), "a second OK turns Lighter home off and the Mac-style dock on");
  r = await focusRow(page);
  ok(r.label === "Mac-style dock" && r.value === "On" && !r.sub, "the row now says On: " + JSON.stringify(r));
  // Lighter off: the dock switch works at once, both ways
  await press(page, "Enter", 300);
  ok(!(await cls(page, "dock-mac")), "Lighter home off: OK turns the Mac-style dock off at once");
  await press(page, "Enter", 300);
  ok(await cls(page, "dock-mac"), "and on again");
  // the Lighter home row turns it back on; Moving tiles is then held too, and Back clears the question
  await goRow(page, "Lighter home");
  await press(page, "Enter", 300);
  ok(await cls(page, "lighter") && !(await cls(page, "dock-mac")) && (await cls(page, "still")), "Lighter home on again holds both off");
  for (let k = 0; k < 40 && (await focusRow(page)).label !== "Moving tiles"; k++) await press(page, "ArrowUp", 60);
  r = await focusRow(page);
  ok(r.label === "Moving tiles" && r.sub === "Off while Lighter home is on", "Moving tiles says why: " + JSON.stringify(r));
  await press(page, "Enter", 300);
  ok((await focusRow(page)).label === "Turn off Lighter home?", "OK asks");
  await press(page, "ArrowDown", 200); await press(page, "ArrowUp", 200);
  ok((await focusRow(page)).label === "Moving tiles" && (await cls(page, "lighter")), "moving away drops the question, nothing changes");
  await press(page, "Enter", 300); await press(page, "Enter", 400);
  ok(!(await cls(page, "lighter")) && !(await cls(page, "still")), "two OKs: Lighter home off and the tiles move");
  const saved = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}"); return r.s || r; });
  ok(saved.lighter === false && saved.moving_tiles === true, "kept: lighter false, moving_tiles true");
  await page.close();
}

// ---- g01 Lighter home by itself, with a one time note; #203 the look never changes with it ----
// The still check runs 20 s after the home opens; arrow presses count from 30 s.
{
  const NOTE = "This TV is a bit slow, so Lighter home is on. Home settings, Look and scenes to change it.";
  const store = (page) => page.evaluate(() => ({ "tvhome.lowend": localStorage.getItem("tvhome.lowend"), "tvhome.lowend_nav": localStorage.getItem("tvhome.lowend_nav") }));
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
  const until = (page, ms) => page.waitForFunction((x) => performance.now() > x, ms, { timeout: ms + 5000 });
  const walk = async (page) => { for (let k = 0; k < 8 && !(await cls(page, "lighter")); k++) await press(page, k % 2 ? "ArrowLeft" : "ArrowRight", 650); };
  // 4 GB, a 60 Hz screen, 30 ms frames in the still check: Lighter home on, the note once
  let page = await home("&look=night", { memory: 4, slowVeil: 30 });
  await until(page, 15000);
  ok(!(await cls(page, "lighter")) && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend"))), "4 GB: not decided by memory, and nothing measured in the first 15 s");
  await page.waitForFunction(() => document.documentElement.classList.contains("lighter"), null, { timeout: 15000 });
  ok(true, "4 GB with 30 ms frames on a 60 Hz screen: Lighter home turned itself on");
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("on"), null, { timeout: 4000 });
  const toast = await page.evaluate(() => document.getElementById("toast").textContent);
  ok(toast === NOTE, "the one time note: " + toast);
  ok(await cls(page, "theme-night") && !(await cls(page, "theme-oled")), "#203: the look stays Night");
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("tvhome.lowend")));
  ok(kept && kept.low === true && kept.ms >= 29 && kept.idle < 20, "kept for a week, with the screen's refresh: " + JSON.stringify(kept));
  await page.reload(); await page.waitForFunction(() => window.tv); await page.waitForTimeout(3500);
  ok(await cls(page, "lighter"), "after a reload: on straight away from the kept answer");
  ok(!(await page.evaluate(() => document.getElementById("toast").classList.contains("on"))), "the note is not shown a second time");
  await page.close();
  // a smooth 30 Hz screen (33.3 ms frames everywhere): not a slow TV
  page = await home("&look=night", { memory: 4, refreshMs: 33.3 });
  await page.waitForFunction(() => localStorage.getItem("tvhome.lowend"), null, { timeout: 30000 });
  let k1 = await page.evaluate(() => JSON.parse(localStorage.getItem("tvhome.lowend")));
  ok(!(await cls(page, "lighter")) && k1.low === false && k1.idle > 30, "a smooth 30 Hz screen stays off: " + JSON.stringify(k1));
  await until(page, 31000); await walk(page);
  ok(!(await cls(page, "lighter")) && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend_nav"))), "and moving along the row at 30 Hz is no strike");
  await page.close();
  // a 30 Hz screen that is really slow (50 ms frames in the still check): on
  page = await home("&look=night", { memory: 4, refreshMs: 33.3, slowVeil: 50 });
  await page.waitForFunction(() => document.documentElement.classList.contains("lighter"), null, { timeout: 30000 });
  ok(true, "a 30 Hz screen with 50 ms frames: on");
  await page.close();
  // a busy start up: 40 ms frames for the first 15 s, presses then; smooth after: nothing changes
  page = await home("&look=night", { memory: 4, slowUntil: 15000 });
  await walk(page);
  ok(!(await page.evaluate(() => localStorage.getItem("tvhome.lowend_nav"))), "presses in the first 30 s do not count");
  await until(page, 31000); await walk(page);
  k1 = await page.evaluate(() => JSON.parse(localStorage.getItem("tvhome.lowend")));
  ok(!(await cls(page, "lighter")) && k1.low === false && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend_nav"))), "busy start up, smooth after: off, no strike " + JSON.stringify(k1));
  await page.close();
  // a one off spike: the first start stutters while moving (a strike only), the next is smooth (forgotten)
  page = await home("&look=night", { memory: 4, slowNav: 33 });
  await until(page, 31000); await walk(page);
  const s1 = await store(page);
  ok(!(await cls(page, "lighter")) && JSON.parse(s1["tvhome.lowend_nav"] || "{}").strike === 1, "first stutter: a strike, Lighter home stays off " + s1["tvhome.lowend_nav"]);
  await page.close();
  page = await home("&look=night", { memory: 4, storage: clean(s1) });
  await until(page, 31000); await walk(page);
  ok(!(await cls(page, "lighter")) && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend_nav"))), "next start smooth: still off, the strike forgotten");
  await page.close();
  // two strikes: the next start stutters too, so Lighter home goes on, with the note, kept 30 days
  page = await home("&look=night", { memory: 4, storage: clean(s1), slowNav: 33 });
  await until(page, 31000); await walk(page);
  ok(await cls(page, "lighter"), "a second start that stutters: Lighter home on");
  const k2 = await page.evaluate(() => JSON.parse(localStorage.getItem("tvhome.lowend")));
  ok(k2.low === true && k2.moving === true, "kept, marked as measured while moving: " + JSON.stringify(k2));
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("on"), null, { timeout: 4000 });
  ok(true, "with the note");
  await page.close();
  // a reading from a screen that was not drawing (a 2021 Samsung Frame, 21 Nov 2026: {"low":true,"ms":2849.7} kept
  // from Art Mode, Lighter home on for days; 19.2 ms with the screen on): not trusted, measured again
  const ART = JSON.stringify({ low: true, t: Date.now() - 2 * 86400000, ms: 2849.7 });
  page = await home("&look=night", { memory: 2, storage: { "tvhome.lowend": ART } });
  ok(!(await cls(page, "lighter")), "the Frame's kept Art Mode reading does not turn Lighter home on");
  await page.waitForFunction(() => { const k = JSON.parse(localStorage.getItem("tvhome.lowend") || "{}"); return k.ms < 100; }, null, { timeout: 30000 });
  const kf = await page.evaluate(() => JSON.parse(localStorage.getItem("tvhome.lowend")));
  ok(!(await cls(page, "lighter")) && kf.low === false, "measured again with the screen drawing: off, and that is kept " + JSON.stringify(kf));
  await page.close();
  // a new reading while the screen is not drawing (3 s frames): nothing decided, nothing kept
  page = await home("&look=night", { memory: 2, slowVeil: 3000 });
  await until(page, 26000);
  ok(!(await cls(page, "lighter")) && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend"))), "a stalled reading decides nothing and is not kept");
  await page.close();
  // the note's words leave the page once it has faded (the Frame's page still said it long after)
  page = await home("&look=night", { memory: 4, slowVeil: 30 });
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("on"), null, { timeout: 30000 });
  ok(/bit slow/.test(await page.evaluate(() => document.getElementById("toast").textContent)), "the note shows");
  await page.waitForFunction(() => !document.getElementById("toast").classList.contains("on") && document.getElementById("toast").textContent === "", null, { timeout: 15000 });
  ok(true, "and once it has faded its words are gone from the page");
  await page.close();
  // 8 GB, slow frames: never measured, never on
  page = await home("&look=night", { memory: 8, slowMs: 30 });
  await until(page, 23000);
  ok(!(await cls(page, "lighter")) && !(await page.evaluate(() => localStorage.getItem("tvhome.lowend"))), "8 GB: not measured, stays off");
  await page.close();
  // a choice wins: Lighter home chosen off is never overridden
  page = await home("&look=night&lighter=off", { memory: 4, slowMs: 30 });
  await until(page, 23000);
  ok(!(await cls(page, "lighter")), "home.lighter false: never turned on");
  await page.close();
}

// ---- #203: picking Classic applies straight away ----
{
  const page = await home("");
  ok(await cls(page, "theme-night"), "starts in Night");
  await openLook(page);
  await goRow(page, "Classic");
  await press(page, "Enter", 300);
  await closeSettings(page);
  ok(!(await cls(page, "theme-night")), "Classic applies when Home settings close, no reload (#203)");
  await page.close();
}

// ---- the new words in all 16 languages ----
{
  const page = await home("&look=classic");
  const res = await page.evaluate(() => {
    const keys = ["lighter_auto", "lighter_holds", "lighter_off_ask", "show_clock", "hi_res", "hi_res_sub", "hi_res_auto", "hi_res_always", "hi_res_off"];
    const S = window.I18N.strings;
    return window.I18N.langs.map((l) => ({ id: l.id, miss: keys.filter((k) => !S[l.id][k]), same: l.id === "en" ? [] : keys.filter((k) => S[l.id][k] === S.en[k] && !/^(Auto)$/.test(S.en[k])),
      holes: /\{home\}/.test(S[l.id].lighter_auto || "") && /\{look\}/.test(S[l.id].lighter_auto || ""), dashes: keys.filter((k) => /[–—]/.test(S[l.id][k] || "")) }));
  });
  ok(res.length === 16, "16 languages");
  for (const r of res) ok(!r.miss.length && !r.same.length && r.holes && !r.dashes.length, r.id + ": every new string, translated, with {home} and {look}, no dashes " + JSON.stringify(r));
  await page.close();
  // and drawn: the held row in German and Hebrew
  for (const [lang, word] of [["de", "Aus, solange die leichte Startseite an ist"], ["he", "כבוי כל עוד הממשק הקל והמהיר מופעל"]]) {
    const p = await home("&look=night&lighter=1&lang=" + lang);
    await p.evaluate(() => window.tv.settingsKey()); await p.waitForTimeout(250); await press(p, "Enter", 400);
    const txt = await p.evaluate(() => { const secs = [...document.querySelectorAll("#set-secs .ssec")]; return secs.length; });
    // open the Look section (the second section) and look for the line
    const found = await p.evaluate(async (w) => {
      for (let i = 0; i < 12; i++) { if (document.getElementById("set-rows").textContent.indexOf(w) >= 0) return true; document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await new Promise((r) => setTimeout(r, 150)); }
      return false;
    }, word);
    ok(txt > 0 && found, lang + ": the Look page says " + word);
    await p.close();
  }
}

ok(errors.length === 0, "no page errors: " + errors.join(" | "));
await browser.close();
server.close();
console.log("Look switches browser tests passed: " + n + " checks.");
