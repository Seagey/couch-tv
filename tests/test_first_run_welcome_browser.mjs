// The first-run welcome (owner's from-scratch test of 0.13.9 on a TCL, 23 Nov 2026): a TV that was
// never set up opens on one full screen question instead of the classic home, answered with the remote.
//  1. A fresh TV (the on-TV app, nothing kept) shows it, with the focus on "I have a design code";
//     Left, Right, Up and Down move between the two choices.
//  2. "I have a design code" opens the same Get a design typing box as Home settings, Designs, and a
//     code typed there is got as always. The welcome never comes back.
//  3. "Use Couch Original" (and Back) shows the classic home, and the welcome never comes back after a
//     reload. Lighter home and 1280x720 lay it out the same.
//  4. A TV that was already set up (an update from an older version) never sees it: apps it has seen,
//     people named at setup, Designs switched on or off, a home computer (bridge).
// The ?mock preview only shows it with ?firstrun=1, so the other browser tests are not changed.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_first_run_welcome_browser.mjs
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
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STORE = "https://designs.example";
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html?mock=1&place=Your+town&designstore=" + encodeURIComponent(STORE);
const FRESH = HOME + "&ontv=1&firstrun=1";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const fetched = [];
  await page.route(STORE + "/**", (r) => {
    const u = r.request().url(), body = r.request().postData() || "";
    const json = (status, j) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(j) });
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
    if (/\/v1\/designs\/fetch$/.test(u)) { fetched.push(JSON.parse(body).code); return json(200, { design: { v: 1, background: { colour: "#203040" }, elements: { clock: { colour: "#ffcc00" } } } }); }
    if (/\/api\/inbox$/.test(u)) return json(200, { id: "AbCdEfGhIjKlMnOpQrStUv", expires_in: 600, poll_every: 3 });
    return json(404, {});
  });
  const ready = async () => { await page.waitForFunction(() => window.tv && window.CouchDesignCode && window.I18N); await page.waitForTimeout(900); };
  // a TV straight out of the box: nothing kept by this page at all
  const freshTv = async (url, before) => {
    await page.goto(ORIGIN + "/tv-home/web/qr.js");
    await page.evaluate((b) => { localStorage.clear(); sessionStorage.clear(); for (const k in (b || {})) localStorage.setItem(k, b[k]); }, before || null);
    await page.goto(url || FRESH); await ready();
  };
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 200); };
  const shown = () => page.evaluate(() => { const w = document.getElementById("welcome"); return !!w && w.classList.contains("on") && getComputedStyle(w).display !== "none"; });
  const focusIs = () => page.evaluate(() => { const f = document.querySelector(".wpick.focus"); return f ? +f.getAttribute("data-wpick") : -1; });
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.welcome") || "null"));

  // 1. a fresh TV
  await freshTv();
  ok(await shown(), "a fresh TV opens on the welcome");
  const words = await page.evaluate(() => document.getElementById("welcome").textContent);
  ok(/Welcome to Couch TV/.test(words) && /I have a design code/.test(words) && /Use Couch Original/.test(words), "its words (" + words.slice(0, 120) + ")");
  ok(words.includes("couchtv.joshuaseage.com") && await page.evaluate(() => !!document.querySelector("#welcome-qr svg")), "the Studio address and its QR code");
  ok(!/[–—]|Beta|Experimental|coming soon/i.test(words), "no dashes, Beta, Experimental or coming soon");
  ok(await focusIs() === 0, "the focus starts on I have a design code");
  ok(await page.evaluate(() => /rgb\(255, 200, 30\)/.test(getComputedStyle(document.querySelector(".wpick.focus")).boxShadow) &&
    !/rgb\(255, 200, 30\)/.test(getComputedStyle(document.querySelector(".wpick:not(.focus)")).boxShadow)), "and it shows (the sun yellow ring, on that card only)");
  // the light look of the Studio site and the setup screens: wall blue, Nunito headings, the logo
  const look = await page.evaluate(() => ({ wall: getComputedStyle(document.getElementById("welcome")).backgroundColor,
    head: getComputedStyle(document.getElementById("welcome-title")).fontFamily, logo: (document.querySelector(".wel-brand img") || {}).naturalWidth || 0,
    nunito: document.fonts.check('900 40px "Nunito"') }));
  ok(look.wall === "rgb(189, 207, 225)" && /Nunito/.test(look.head) && look.logo > 0 && look.nunito, "the light look: wall blue, Nunito, the logo (" + JSON.stringify(look) + ")");
  ok(await kept() === "ask", "kept as due, so it is asked again until answered");
  await press("ArrowRight"); ok(await focusIs() === 1, "Right: Use Couch Original");
  await press("ArrowLeft"); ok(await focusIs() === 0, "Left: back to the code");
  await press("ArrowDown"); ok(await focusIs() === 1, "Down: Use Couch Original");
  await press("ArrowUp"); ok(await focusIs() === 0, "Up: back to the code");
  // the launcher's Home key while it is up: it stays
  await page.evaluate(() => window.tv.home()); await page.waitForTimeout(200);
  ok(await shown(), "the Home key leaves it up until it is answered");
  // a reload before an answer: still there
  await page.reload(); await ready();
  ok(await shown(), "still there after a reload with no answer");

  // 2. I have a design code: the existing Get a design box
  await press("Enter", 500);
  ok(!(await shown()), "OK on the code: the welcome goes");
  const typing = await page.evaluate(() => ({ settings: document.getElementById("settings").classList.contains("on"), box: document.getElementById("set-type").classList.contains("on"),
    label: document.getElementById("set-type-label").textContent, focus: document.activeElement && document.activeElement.id, head: document.getElementById("set-head").textContent }));
  ok(typing.settings && typing.box && typing.focus === "set-input", "Home settings opens with the typing box ready (" + JSON.stringify(typing) + ")");
  ok(/Type the code from Couch TV Studio/.test(typing.label) && /Designs/.test(typing.head), "the same Get a design box, in Designs");
  await page.fill("#set-input", "k7m2qxr4tp");
  await press("Enter", 400);
  ok(fetched[0] === "K7M2Q-XR4TP", "the code is got as always (" + fetched.join(",") + ")");
  await page.waitForFunction(() => document.querySelector(".cd-ask"), null, { timeout: 8000 });
  ok(true, "and the TV asks Use this design? first");
  ok(await kept() === "code", "kept as answered");
  await page.reload(); await ready();
  ok(!(await shown()), "the welcome never comes back");
  // Back on the code box: Designs, with Get a design from your phone right there
  await freshTv();
  await press("Enter", 500);
  await press("Escape", 400);
  const rows = await page.evaluate(() => document.getElementById("set-rows").textContent);
  ok(/Get a design/.test(rows) && /Get a design from your phone/.test(rows), "Back from the box: Designs with both ways to get a design");

  // 3. Use Couch Original, and Back
  await freshTv();
  await press("ArrowRight"); await press("Enter", 500);
  ok(!(await shown()), "Use Couch Original: the welcome goes");
  ok(await page.evaluate(() => !document.getElementById("settings").classList.contains("on") && !!document.querySelector("#grid .app")), "the classic home is there");
  await press("ArrowRight", 300);
  ok(await page.evaluate(() => !!document.querySelector(".focus")), "and the remote moves on the home");
  ok(await kept() === "original", "kept as Couch Original");
  await page.reload(); await ready();
  ok(!(await shown()), "the welcome never returns after a reload");
  await freshTv();
  await press("Escape", 500);
  ok(!(await shown()) && await kept() === "original", "Back counts as Couch Original");
  // the gear key on the welcome: Home settings stays reachable
  await freshTv();
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(400);
  ok(!(await shown()) && await page.evaluate(() => document.getElementById("gear-pop").classList.contains("on")), "the Settings key closes it and opens the gear menu");
  // Lighter home (a low RAM TV) at 1280x720: the same screen, no blur
  await page.setViewportSize({ width: 1280, height: 720 });
  await freshTv(FRESH + "&lighter=1");
  ok(await shown() && await page.evaluate(() => document.documentElement.classList.contains("lighter")), "Lighter home shows it too");
  const fit = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect(), a = r('[data-wpick="0"]'), b = r('[data-wpick="1"]'), q = r(".wel-studio");
    return { inside: [a, b, q].every((x) => x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight), apart: a.right <= b.left, under: q.top >= a.bottom,
      blur: getComputedStyle(document.getElementById("welcome")).backdropFilter };
  });
  ok(fit.inside && fit.apart && fit.under, "at 1280x720 both choices and the Studio line fit, side by side (" + JSON.stringify(fit) + ")");
  ok(!fit.blur || fit.blur === "none", "no blur");
  await press("ArrowRight"); ok(await focusIs() === 1, "the remote works there too");
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 4. a TV that was set up before never sees it
  await freshTv(FRESH, { "mock:tvhome.apps.seen": JSON.stringify(["com.netflix.ninja"]) });
  ok(!(await shown()) && await kept() === "set", "an update from an older version (apps already seen): no welcome, and never later");
  await freshTv(FRESH + "&people=3");
  ok(!(await shown()), "people named at setup: no welcome");
  await freshTv(FRESH, { "mock:tvhome.designer": JSON.stringify("off") });
  ok(!(await shown()), "Designs switched on or off before: no welcome");
  await freshTv(FRESH, { "mock:tvhome.home.asked": "1" });
  ok(!(await shown()), "the first-run home question already answered: no welcome");
  await freshTv(HOME + "&firstrun=1");
  ok(!(await shown()), "a TV a home computer (bridge) set up: no welcome");
  await freshTv(HOME + "&ontv=1");
  ok(!(await shown()), "the preview without ?firstrun=1: no welcome");
  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} first-run welcome browser tests passed.`);
