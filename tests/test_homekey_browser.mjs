// Make Home open Couch TV (the on-TV app's HomeKey.kt): on Google TV the Home button watch used to need a
// computer (adb install, then Settings, Accessibility, then Use as home screen). Now one press does it once
// the app's own link to the TV is connected. Checked in a real browser:
//  1. Home settings, About on the TV home (?mock, 1920x1080): one row; OK downloads with a percentage,
//     installs, switches the watch on, and the row says Home opens Couch TV.
//  2. Without the link: one line and a QR code for the help page's computer steps; no button that cannot work.
//  3. The watch never connects: a plain line says where to switch it on; the watch APK alone: its own line.
//  4. Every language the home speaks has its own words for the new rows.
//  5. The phone's Home settings page (/setup) against a stand-in TV: the button, the press, the wait while
//     the app restarts, the result; the steps and the help page link without the link; nothing on a TV
//     where Home already works.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_homekey_browser.mjs
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
const ok = (c, m) => { assert.ok(c, m); n++; };
const HELP = "https://couchtv.joshuaseage.com/help/home-button/";

// ---- a stand-in on-TV app: the TV home's files, and /setup with /api/homekey ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const TOKEN = "t0k3n";
const HS = { settings: { lang: "en", photos: [] }, people: [], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400,
  adb: { connected: true, sdk: 34, state: "connected" }, xiaomi: false, inputs: [] };
const DONE_K = "The Home button watch is on, so Home should bring Couch TV back. Press Home on the remote to check.";
const STEPS_PHONE = "This needs Couch TV to press keys on this TV first: use Let the phone press keys on this page, then come back here. Or do it once from a computer: the steps below.";
const READY = "One press: Couch TV gets the Home button version from GitHub, checks it and puts it on over this one, then switches its Home button watch on. Your settings stay.";
let HK = null, hkGets = 0, hkDown = 0, starts = 0;
const hkState = (view, extra) => Object.assign({ view, phase: "", progress: 0, error: "", error_words: "", button: "Make Home open Couch TV",
  words: view === "ready" ? READY : view === "done" ? DONE_K : view === "steps"
    ? "This needs Couch TV to press keys on this TV first: open Settings, Phone remote, then Set it up. Or do it once from a computer: scan the code on the right for the steps." : "",
  words_phone: view === "ready" ? READY : view === "done" ? DONE_K : view === "steps" ? STEPS_PHONE : "",
  help_url: HELP, steps: ["On a computer, download couch-tv-ontv-watch.apk from github.com/Seagey/couch-tv/releases/latest.", "Install it over this app with Google's adb tool: adb connect, then adb install -r couch-tv-ontv-watch.apk. Your settings stay.",
    "On the TV: Settings, Accessibility (on some TVs inside System or Device Preferences), Couch TV home watch, On.", "Open Couch TV and press Use as home screen."] }, extra || {});
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") { let b = {}; try { b = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) {} return b.pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false, error: "That code is not right." }); }
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: HK && HK.view === "done", held: false, fire_tv: false, watch: HK && HK.view === "done" });
      if (route === "GET /api/athome") return send(res, 200, { ok: true, live: false });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, supported: true, current: "0.13.9", available: false, checked: Date.now() });
      if (route === "GET /api/homekey") {
        hkGets++;
        // the app is being replaced: nothing answers for a few polls (Android stopped it)
        if (hkDown > 0) { hkDown--; res.destroy(); return; }
        return send(res, 200, Object.assign({ ok: true }, HK));
      }
      if (route === "POST /api/homekey/start") {
        starts++;
        HK = hkState("busy", { phase: "installing", progress: 100, words: "Installing. Couch TV closes and opens again by itself." });
        hkDown = 2;
        setTimeout(() => { HK = hkState("done"); }, 300);
        return send(res, 200, Object.assign({ ok: true }, HK));
      }
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
const browser = await chromium.launch();

// ---- 1 to 3: Home settings, About ----
async function about(kind) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(HOME + "?mock=1&ontv=1&update=latest&homekey=" + kind);
  await page.waitForFunction(() => window.tv && document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(800);
  await page.evaluate(() => { const p = document.getElementById("gear-pop"); if (p && p.classList.contains("ask")) window.MOCK_UPDATER.auto(true); });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  for (let i = 0; i < 25 && !(await page.evaluate(() => /^About/.test(((document.querySelector(".ssec.focus") || {}).textContent || "").trim()))); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  return page;
}
const rows = (page) => page.evaluate(() => document.getElementById("set-rows").textContent);
const focused = (page) => page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");
async function focusRow(page, re) {
  for (let i = 0; i < 12 && !re.test(await focused(page)); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  return re.test(await focused(page));
}

{ // 1. one press
  const page = await about("ready");
  const r = await rows(page);
  ok(/Make Home open Couch TV/.test(r), "About has Make Home open Couch TV (" + r.slice(0, 160) + ")");
  ok(/Gets the Home button version from GitHub, checks it and puts it on\. Your settings stay\./.test(r), "with one short line under it");
  ok(!(await page.evaluate(() => !!document.querySelector(".sqr"))), "and no QR code");
  ok(await focusRow(page, /^Make Home open Couch TV/), "the row takes focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Downloading… \d+%/.test(document.getElementById("set-rows").textContent), null, { timeout: 4000 });
  ok(true, "OK: Downloading… with a percentage");
  await page.waitForFunction(() => /Working on it\. Couch TV may close and open again by itself\./.test(document.getElementById("set-rows").textContent), null, { timeout: 6000 });
  ok(true, "then that it is working, and Couch TV may close and open again");
  await page.waitForFunction(() => /The Home button watch is on, so Home should bring Couch TV back\. Press Home to check\./.test(document.getElementById("set-rows").textContent), null, { timeout: 6000 });
  ok(true, "then: the watch is on, Home should bring Couch TV back, press Home to check");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}

{ // 2. no link: one line and a QR code
  const page = await about("steps");
  const r = await rows(page);
  ok(/First let Couch TV press keys on this TV: Couch TV in your apps, Settings, Phone remote, Set it up\. Or do it once from a computer\./.test(r), "says what to do first, in plain words");
  ok(!(await page.evaluate(() => Array.from(document.querySelectorAll(".srow")).some((e) => /^Make Home open Couch TV/.test(e.textContent) && e.classList.contains("action")))), "no button that cannot work");
  const qr = await page.evaluate(() => { const q = document.querySelector(".sqr"); return q && { url: q.querySelector("[data-qr]").getAttribute("data-qr"), svg: !!q.querySelector("svg"), words: q.textContent }; });
  ok(qr && qr.url === HELP && qr.svg, "a QR code for the help page (" + JSON.stringify(qr) + ")");
  ok(qr && qr.words === "Scan for the computer steps on your phone.", "with one short line");
  ok(await page.evaluate((u) => { const s = document.querySelector(".sqr svg"); return window.TVQR.matrix(u).length >= 21 && s.outerHTML === window.TVQR.svg(u, 240).outerHTML; }, HELP), "the drawn code is that address's QR matrix");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}

{ // 3. the watch never connects; and the watch APK alone
  const page = await about("fail");
  ok(await focusRow(page, /^Make Home open Couch TV/), "the row takes focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /did not switch the Home button watch on/.test(document.getElementById("set-rows").textContent), null, { timeout: 6000 });
  ok(/Open the TV's Settings, Accessibility \(on some TVs inside System or Device Preferences\), Couch TV home watch, and switch it on\./.test(await rows(page)), "a plain line says where to switch it on, menus and all");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
  const w = await about("watch");
  ok(/Switches on Couch TV home watch, so Home brings Couch TV back\./.test(await rows(w)), "the Home button version says it only switches the watch on");
  await w.close();
  const d = await about("done");
  const r = await rows(d);
  ok(/Home should bring Couch TV back/.test(r) && !(await d.evaluate(() => !!document.querySelector(".sqr"))), "done: one hedged line, nothing to press");
  await d.close();
  const fire = await about("fire");
  const fr = await rows(fire);
  ok(/This Fire TV does not let Couch TV press keys by itself\. Do it once from a computer\./.test(fr) && !/Let the phone press keys/.test(fr), "a Fire TV that blocks the link gets its own line (" + fr.slice(0, 200) + ")");
  ok(await fire.evaluate(() => !!document.querySelector(".sqr svg")), "and the QR code");
  await fire.close();
  const ok2 = await about("otherkey");
  ok(/built on another computer, so it cannot take GitHub's version/.test(await rows(ok2)), "a try that stopped gives the real reason, as the other screens do");
  await ok2.close();
  const ub = await about("updbusy");
  ok(/busy with an update right now\. Press again in a moment\./.test(await rows(ub)), "an update in the way is said on screen");
  await ub.close();
  const sl = await about("slow");
  ok(/still installing the Home button version\. Leave it on/.test(await rows(sl)), "a slow install says to leave the TV on, not that nothing changed");
  ok(!/nothing changed/.test(await rows(sl)), "a slow install never says nothing changed");
  await sl.close();
  const h = await about("hidden");
  ok(!/Make Home open Couch TV/.test(await rows(h)), "a TV where Home already works shows nothing");
  await h.close();
}

{ // 4. every language
  const page = await browser.newPage();
  await page.goto(HOME + "?mock=1&ontv=1&homekey=ready");
  await page.waitForFunction(() => window.I18N);
  const res = await page.evaluate(() => {
    const keys = ["hk_row", "hk_sub", "hk_sub_watch", "hk_done", "hk_working", "hk_steps", "hk_qr", "hk_err", "hk_err_not_bound",
      "hk_steps_fire", "hk_err_not_bound_fire", "hk_err_other_key", "hk_err_not_newer", "hk_err_space", "hk_err_adb", "hk_wait_update", "hk_err_slow"];
    const out = {};
    const L = typeof window.I18N.langs === "function" ? window.I18N.langs() : window.I18N.langs; const langs = (L || []).map((l) => l.id || l);
    for (const id of langs) { window.I18N.set(id); out[id] = keys.map((k) => window.I18N.t(k)); }
    window.I18N.set("en");
    return out;
  });
  const ids = Object.keys(res);
  ok(ids.length >= 16, "the home's languages are listed (" + ids.join(",") + ")");
  for (const id of ids) {
    if (id === "en") continue;
    res[id].forEach((w, i) => ok(w && !/^hk_/.test(w) && w !== res.en[i], id + " has its own words for " + i + ": " + w));
    ok(res[id].every((w) => !/[–—]/.test(w)), id + " has no long dashes");
  }
  ok(res.en.every((w) => !/[–—]|beta|experimental|coming soon/i.test(w)), "English is plain words");
  // every language names where Accessibility is (the menu note) in its not_bound line, and the help page in the Fire one
  for (const id of ids) {
    ok(/[(（].+[)）]/.test(res[id][8]), id + ": the Accessibility line says where it is on some TVs");
    ok(res[id][10].includes("couchtv.joshuaseage.com/help/home-button"), id + ": the Fire TV line points to the help page");
  }
  await page.close();
}

// ---- 5. the phone page ----
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(ORIGIN + "/setup#pin=482913");
  await page.waitForFunction(() => document.getElementById("hk-line") && document.getElementById("hk-line").textContent.length > 0 || document.getElementById("hk").style.display === "none" && document.getElementById("home-state").textContent !== "Checking…", null, { timeout: 8000 });
  await page.waitForTimeout(300);
  // each section is a titled box, shut until tapped
  if (await page.evaluate(() => document.getElementById("home").classList.contains("shut"))) await page.click("#home .fold-btn");
  await page.waitForTimeout(200);
  return { ctx, page };
}
{
  HK = hkState("ready"); starts = 0;
  const { ctx, page } = await phone();
  ok(await page.isVisible("#hk-go"), "the phone page shows Make Home open Couch TV");
  ok((await page.textContent("#hk-line")) === READY, "with the line that says what it does");
  ok(!(await page.isVisible("#hk-steps")), "and no computer steps");
  await page.click("#hk-go");
  await page.waitForFunction(() => /Home should bring Couch TV back/.test(document.getElementById("hk-line").textContent), null, { timeout: 12000 });
  ok(starts === 1, "one press, one start");
  ok(await page.evaluate(() => document.getElementById("hk-line").classList.contains("ok")), "the result in green");
  ok(!(await page.isVisible("#hk-go")), "and no button any more");
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  ok(scroll, "no sideways scroll at 390 px");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await ctx.close();
}
{
  HK = hkState("steps");
  const { ctx, page } = await phone();
  ok(!(await page.isVisible("#hk-go")), "no link: no button");
  const pl = await page.textContent("#hk-line");
  ok(pl === STEPS_PHONE && !/More|scan/.test(pl), "the phone's own line: its Let the phone press keys section and the steps below (" + pl + ")");
  const steps = await page.$$eval("#hk-steps li", (l) => l.map((x) => x.textContent));
  ok(steps.length === 5 && /couch-tv-ontv-watch\.apk/.test(steps[0]) && /Use as home screen/.test(steps[3]), "the four computer steps (" + steps.length + ")");
  ok((await page.getAttribute("#hk-steps a", "href")) === HELP, "and the help page link");
  await ctx.close();
}
{
  HK = hkState("hidden");
  const { ctx, page } = await phone();
  ok(!(await page.isVisible("#hk")), "a TV where Home already works: nothing about it");
  await ctx.close();
}
{
  HK = hkState("ready", { error: "other_key", error_words: "This copy of Couch TV was built on another computer, so it cannot take GitHub's version. Use the computer steps." });
  const { ctx, page } = await phone();
  ok(/built on another computer/.test(await page.textContent("#hk-msg")), "a try that stopped says why");
  await ctx.close();
}

await browser.close();
server.close();
console.log("homekey browser tests passed (" + n + " checks)");
