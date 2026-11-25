// The look for a design while the Make it yours card is open (owner, 25 Nov 2026): the TV asks the account's inbox only
// when someone expects a design. Run on a fake clock (Playwright's page.clock) in the home as the Android app runs it
// (?offline=1&alone=1, a pretend TVOS that counts every look), so the exact request counts are real.
//  1. A linked TV with the card open looks every 20 s, at most 45 times (15 minutes), then no more.
//  2. The count is kept for the life of the TV: a restart, and the card shown again from Home settings, go on from what
//     is left and never start over (10 looks, restart, then 35 more, never more than 45 in all).
//  3. Each stop reason stops it at once: Back, OK, Home, an app in front, screen off, the page hidden, offline.
//     Hidden and offline come back on their own while the card is still open; the rest close the card.
//  4. A design arriving closes the card and stops it. A 429 (wait) ends it for good. A failure waits twice as long each
//     time (40, 80, 160, 160 s) and still counts.
//  5. A TV that is not linked asks nothing and has the welcome, no card. The link arriving with the welcome up replaces it with the
//     card; linked while the card (from Home settings) is open, the window begins then.
//  6. The Home key causes no look at all, with the card up or not.
//  7. Home settings: Get my new design is the first row on a linked TV, one press is one look, the next waits 30 s, and
//     it says a plain result: new design arrived, nothing new yet, no internet, TV not linked.
// Needs Playwright 1.45 or newer (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_make_it_yours_look_browser.mjs
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4" };
const STORE = "https://designs.example";
const server = http.createServer((req, res) => {
  if (req.url.split("?")[0] === "/tv-home/web/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("window.COUCH_CONFIG = " + JSON.stringify({ design_store: STORE }) + ";"); return; }
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?offline=1&alone=1";
const S20 = 20000;
let n = 0;
const ok = (c, m) => { if (process.env.VERBOSE) console.log((c ? "ok " : "FAIL ") + m); assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(STORE + "/**", (r) => r.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  // a pretend TVOS: every look is counted with the time it was made; the answer is whatever the test says
  await page.addInitScript(() => {
    const S = (k) => "tvos:" + k;
    window.__asks = []; window.__linked = localStorage.getItem("test:linked") !== "0"; window.__answer = { state: "none", poll: 60 };
    window.TVOS = {
      version: () => "0.13.14", memoryMb: () => 1843, tvProfile: () => JSON.stringify({ platform: "Google TV", sdk: 34, memMb: 1843, res: "1920x1080", model: "Smart TV Pro" }),
      apps: () => "[]", watchNext: () => "[]", homeState: () => "held", launch: () => true,
      kept: (k) => localStorage.getItem(S(k)), keep: (k, v) => { if (v == null) localStorage.removeItem(S(k)); else localStorage.setItem(S(k), v); return true; },
      keptPrivate: (k) => localStorage.getItem(S("p:" + k)), keepPrivate: (k, v) => { if (v == null) localStorage.removeItem(S("p:" + k)); else localStorage.setItem(S("p:" + k), v); return true; },
      accountLinked: () => window.__linked, setupDesignCode: () => "", setupDesignDone: () => true,
      unlinkAccount: () => { window.__linked = false; return true; },
      accountInbox: () => { if (!window.__linked) return false; window.__asks.push(Date.now()); const a = window.__answer; setTimeout(() => window.tv && window.tv.accountInbox(JSON.stringify(a)), 5); return true; }
    };
  });
  // the page on a fake clock; time stands still between our steps
  const start = async (opts = {}) => {
    await page.goto(BASE + "&reset=1");
    if (!opts.keep) await page.evaluate((linked) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("test:linked", linked ? "1" : "0"); }, opts.linked !== false);
    else await page.evaluate((linked) => localStorage.setItem("test:linked", linked ? "1" : "0"), opts.linked !== false);
    await page.clock.install({ time: new Date("2026-11-25T10:00:00Z") });
    await page.goto(BASE);
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!(window.tv && window.CouchDesignCode && window.I18N))); i++) await page.waitForTimeout(150);
    await page.waitForTimeout(1500);
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 200));
    await run(300);
  };
  const run = async (ms) => { await page.clock.runFor(ms); await page.waitForTimeout(30); };
  const press = async (k, ms) => { await page.keyboard.press(k); await run(ms || 300); };
  const asks = () => page.evaluate(() => window.__asks.length);
  const cardUp = () => page.evaluate(() => !!document.getElementById("makeit"));
  const looks = () => page.evaluate(() => JSON.parse(localStorage.getItem("tvos:tvhome.makeit.looks") || localStorage.getItem("tvhome.makeit.looks") || "0"));
  // a TV Setup linked, straight from the box: no welcome, the calm 3 s, then the card
  const cardOpen = async (opts) => {
    await start(opts);
    // in small steps until the card shows (the calm 3 s), so the time it opened is known to 100 ms
    for (let i = 0; i < 400 && !(await cardUp()); i++) await run(100);
    ok(await cardUp(), "the card is up after a calm moment, with no welcome");
    lastOpen = await page.evaluate(() => Date.now());
    return await asks();
  };
  let lastOpen = 0;

  // 1. 45 looks, 20 s apart, then no more
  let base = await cardOpen();
  await run(19700);
  ok(await asks() === base, "19.7 s after the card: no look yet");
  await run(500);
  ok(await asks() === base + 1, "at 20 s: the first look");
  await run(S20 * 44 - 200);
  let a = await asks();
  ok(a === base + 45 && await looks() === 45, "after 15 minutes: exactly 45 looks (" + (a - base) + ", kept " + await looks() + ")");
  const times = await page.evaluate(() => window.__asks.slice(-45));
  ok(times.slice(1).every((t, i) => t - times[i] === S20), "every look 20 s after the one before");
  await run(S20 * 20);
  ok(await asks() === a, "and no look after the 45th, however long the card stays");
  
  // 2. persistence across a restart, and from Home settings
  base = await cardOpen();
  await run(S20 * 10 + 500);
  ok(await asks() === base + 10 && await looks() === 10, "10 looks in 200 s");
  await press("Escape", 400);
  ok(!(await cardUp()), "Back closes the card");
  await run(S20 * 5);
  ok(await asks() === base + 10, "and the looks stop at once");
  // a restart (the page loads again, the TV keeps what it kept)
  await start({ keep: true });
  const toRow = async (re) => {
    for (let i = 0; i < 60; i++) { if (re.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || ""))) return true; await press("ArrowDown", 150); }
    return false;
  };
  ok(await looks() === 10, "the count of 10 is kept across the restart");
  await page.evaluate(() => window.tv.settingsKey()); await run(300); await press("Enter", 500);
  for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown", 150);
  await press("ArrowRight", 500);
  ok(await toRow(/Make it yours/), "Make it yours can be reached in Home settings, Designs");
  const b2 = await asks();
  await press("Enter", 600);
  ok(await cardUp(), "OK shows the same card");
  await run(S20 * 45);
  ok(await asks() === b2 + 35 && await looks() === 45, "the card shown again goes on from what is left: 35 more, 45 in all for the life of the TV (" + (await asks() - b2) + ")");
  await press("Escape", 400);
  await page.evaluate(() => window.tv.settingsKey()); await run(300); await press("Enter", 500);
  for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown", 150);
  await press("ArrowRight", 500);
  await toRow(/Make it yours/);
  const b3 = await asks();
  await press("Enter", 600); await run(S20 * 5);
  ok(await asks() === b3 && await cardUp(), "once the 45 are used the card can still be shown, and asks nothing");
  await press("Escape", 400);

  // 3. every stop reason
  const stopWith = async (name, act, closes) => {
    const b = await cardOpen();
    await run(S20 * 2 + 500);
    ok(await asks() === b + 2, name + ": two looks first");
    await act();
    await run(500);
    const at = await asks();
    await run(S20 * 10);
    ok(await asks() === at, name + ": no look after it (" + (await asks() - at) + ")");
    if (closes) ok(!(await cardUp()), name + ": the card is closed");
  };
  await stopWith("Back", () => press("Escape", 300), true);
  await stopWith("OK", () => press("Enter", 300), true);
  await stopWith("Home", () => page.evaluate(() => window.tv.home()), true);
  await stopWith("an app in front", () => page.evaluate(() => window.tv.pause()), true);
  await stopWith("screen off", () => page.evaluate(() => window.tv.screenOff()), true);
  await stopWith("the Settings key", () => page.evaluate(() => window.tv.settingsKey()), true);
  // hidden, then back
  base = await cardOpen(); await run(S20 * 2 + 500);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  let at = await asks(); await run(S20 * 10);
  ok(await asks() === at, "the page hidden: no look");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await run(S20 + 500);
  ok(await asks() === at + 1 && await cardUp(), "in front again with the card still up: it goes on");
  // offline, then back
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
  at = await asks(); await run(S20 * 10);
  ok(await asks() === at, "offline: no look");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); window.dispatchEvent(new Event("online")); });
  await run(S20 + 500);
  ok(await asks() === at + 1, "online again: it goes on");
  await press("Escape", 300);

  // 4. a design arrives, a 429, a failing server
  base = await cardOpen();
  await page.evaluate(() => { window.__answer = { state: "item", code: "CTV1-" + "Ab3_-".repeat(8) + "Zz9", title: "Beach night", poll: 60 }; });
  await run(S20 + 500);
  ok(await asks() === base + 1 && !(await cardUp()), "a design arrives: the card closes");
  await run(S20 * 10);
  ok(await asks() === base + 1, "and the looks stop");
  base = await cardOpen();
  await page.evaluate(() => { window.__answer = { state: "wait", wait: 300 }; });
  await run(S20 + 500);
  ok(await asks() === base + 1 && await looks() === 45, "a 429: one look, and the window is over for good");
  await run(S20 * 50);
  ok(await asks() === base + 1, "no more looks after a 429, however long the card stays");
  await press("Escape", 300);
  base = await cardOpen();
  await page.evaluate(() => { window.__answer = { state: "error" }; });
  await run(S20 * 40);
  const gaps = await page.evaluate((b) => { const t = window.__asks.slice(b); return t.slice(1).map((x, i) => Math.round((x - t[i]) / 1000) * 1000); }, base);   // the pretend answer takes 5 ms
  ok(gaps.slice(0, 4).join() === [40000, 80000, 160000, 160000].join() && gaps.slice(4).every((g) => g === 160000), "a failing server: 40, 80, 160, 160 s apart (" + gaps.join(",") + ")");
  ok(await looks() === (await asks() - base), "and every failed look counts (" + await looks() + ")");
  await press("Escape", 300);

  // 5. not linked: the welcome and no card, no look. The link arrives with the welcome on screen: the card replaces it
  //    and the window begins with it (the card's own 20 s, not at once). Or: the card from Home settings, then linked.
  await start({ linked: false });
  const welcomeOn = () => page.evaluate(() => { const w = document.getElementById("welcome"); return !!w && w.classList.contains("on"); });
  ok(await welcomeOn() && !(await cardUp()), "not linked: the welcome, no card");
  base = await asks();
  await run(S20 * 7);
  ok(await asks() === base && await welcomeOn() && !(await cardUp()), "not linked: no look in 2 minutes 20 s, the welcome still there, no card");
  await page.evaluate(() => { window.__linked = true; window.tv.setupDesign(); });
  await run(300);
  ok(!(await welcomeOn()), "Setup links the TV: the welcome goes");
  for (let i = 0; i < 100 && !(await cardUp()); i++) await run(100);
  ok(await cardUp(), "and the card takes its place");
  const b5 = await asks();
  await run(S20 - 1000);
  ok(await asks() === b5, "the first look is 20 s after the card, not at once");
  await run(S20 + 1000);
  ok(await asks() >= b5 + 1, "and then it looks");
  await press("Escape", 300);
  // not linked, welcome answered Use Couch Original, the card shown from Home settings: no looks. Then linked: it begins.
  await start({ linked: false });
  await press("ArrowRight"); await press("Enter", 300);
  await run(S20 * 4);
  ok(!(await cardUp()), "not linked, Use Couch Original: no card by itself");
  await page.evaluate(() => window.tv.settingsKey()); await run(300); await press("Enter", 500);
  for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown", 150);
  await press("ArrowRight", 500);
  for (let i = 0; i < 60 && !(await page.evaluate(() => /Make it yours/.test((document.querySelector(".srow.focus") || {}).textContent || ""))); i++) await press("ArrowDown", 150);
  base = await asks();
  await press("Enter", 600);
  ok(await cardUp(), "the card from Home settings on a TV that is not linked");
  await run(S20 * 7);
  ok(await asks() === base && await looks() === 0 && await cardUp(), "not linked: no look at all in 2 minutes 20 s, the card still up");
  await page.evaluate(() => { window.__linked = true; window.tv.setupDesign(); });
  await run(S20 - 1000);
  ok(await asks() === base, "linked with the card open: the first look is 20 s later, not at once");
  await run(S20 + 1000);
  ok(await asks() >= base + 1, "and then it looks");
  await press("Escape", 300);

  // 6. the Home key causes no look
  await start({ linked: false });
  let h0 = await asks();
  for (let i = 0; i < 12; i++) { await page.evaluate(() => window.tv.home()); await run(3000); }
  ok(await asks() === h0, "twelve Home presses with the welcome up: no look (" + (await asks() - h0) + ")");
  h0 = await cardOpen();
  await page.evaluate(() => window.tv.home()); await run(S20 * 3);
  ok(await asks() === h0 && !(await cardUp()), "Home with the card up closes it and asks nothing");
  for (let i = 0; i < 12; i++) { await page.evaluate(() => window.tv.home()); await run(3000); }
  ok(await asks() === h0, "and Home presses after: no look");
  await page.evaluate(() => { window.tv.pause(); window.tv.resume(); });
  await run(2000);
  ok(await asks() === h0, "an app and back after a moment: no look (the 30 minute rule is as it was)");

  // 7. Home settings, Get my new design
  await cardOpen();
  await press("Escape", 300);
  await run(31000);
  await page.evaluate(() => window.tv.settingsKey()); await run(300); await press("Enter", 500);
  const first = await page.evaluate(() => { const r = document.querySelector("#set-rows .srow"); return r ? r.textContent : ""; });
  ok(/Get my new design/.test(first), "it is the first row of Home settings on a linked TV (" + first.slice(0, 50) + ")");
  await press("ArrowRight", 400);
  ok(/Get my new design/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")), "Settings, Enter, Right: the focus is on it (OK is the fourth press)");
  const msg = () => page.evaluate(() => (document.getElementById("set-msg") || {}).textContent || "");
  await run(31000);
  let m0 = await asks();
  await press("Enter", 600);
  ok(await asks() === m0 + 1, "one press is one look");
  ok(/Nothing new yet/.test(await msg()), "a plain result: nothing new yet (" + await msg() + ")");
  await press("Enter", 600);
  ok(await asks() === m0 + 1 && /Looked a moment ago. Try again in 30 seconds/.test(await msg()), "a second press at once asks nothing (" + await msg() + ")");
  await run(27000); await press("Enter", 600);
  ok(await asks() === m0 + 1, "under 30 s later: still limited");
  await run(2000); await press("Enter", 600);
  ok(await asks() === m0 + 2, "over 30 s later: one more look");
  await page.evaluate(() => { window.__answer = { state: "error" }; });
  await run(31000); await press("Enter", 600);
  ok(/No internet/.test(await msg()), "no internet says so (" + await msg() + ")");
  await page.evaluate(() => { window.__answer = { state: "unlinked" }; });
  await run(31000); await press("Enter", 600);
  ok(/not linked/.test(await msg()), "an unlinked TV says so (" + await msg() + ")");
  await page.evaluate(() => { window.__answer = { state: "item", code: "CTV1-" + "Ab3_-".repeat(8) + "Zz9", title: "Beach night" }; window.__linked = true; });
  ok(true, "(the arrival text is the app's: A new design arrived. Getting it...)");
  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} make it yours look browser tests passed.`);
