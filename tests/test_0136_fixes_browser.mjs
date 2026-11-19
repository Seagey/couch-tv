// couch-tv 0.13.6: what the real TCL beginner test of 19 Nov 2026 found on the TV, checked in a real browser
// at 1920x1080 (the TV home in its ?mock preview, the same page the TV runs):
//  1. The Settings gear covered the clock on Guest Welcome and the Holidays card on Packed Bento. Now it
//     goes where it covers no widget, or, on a design with no clear spot, hides until the remote reaches it.
//  2. Hold OK opened Netflix: Android's long press comes as a repeated key down (an ADB long press sends it
//     at once). A repeat is a hold: the Home menu opens, Settings first, and the app is not opened.
//  3. Nobody was told to update. Home settings, About has Update couch-tv with a version line; on the
//     on-TV app (it cannot install itself) the update page gives the Downloader steps and code.
//  4. About said "Running: With the computer" on the on-TV app put on with just a phone.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_0136_fixes_browser.mjs
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
const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/design-presets.json"), "utf8"));
const preset = (id) => PRESETS.filter((p) => p.id === id)[0].design;

const browser = await chromium.launch();
async function home(design, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); if (d) localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design || null);
  await page.goto(BASE + "?mock=1" + (design ? "&design=local" : "") + (q || ""));
  if (design) await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDesign);
  else await page.waitForFunction(() => window.tv && document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(800);
  return page;
}
// the gear's box and every widget's, and whether it can be seen
const gearCheck = (page) => page.evaluate(() => {
  const g = document.querySelector(".cw-gearchip"), r = g.getBoundingClientRect(), cs = getComputedStyle(g);
  const boxes = [...document.querySelectorAll("#cd-front .cd-o, #cd-back .cd-o")].filter((n) => getComputedStyle(n).visibility !== "hidden" && getComputedStyle(n).display !== "none")
    .map((n) => { const b = (n.querySelector(".cw") || n).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; })
    .filter((b) => b.r - b.l > 4 && (b.r - b.l) * (b.b - b.t) < innerWidth * innerHeight * 0.85);
  const hits = boxes.filter((b) => r.left < b.r && r.right > b.l && r.top < b.b && r.bottom > b.t).length;
  return { shown: cs.display !== "none" && +cs.opacity > 0.5, tucked: g.classList.contains("cw-gear-tuck"), hits, x: r.left, y: r.top, w: r.width };
});

console.log("Running 0.13.6 fixes browser tests...");

// 1. the gear never covers a widget: the two starter designs from the test, and one with room top right
for (const id of ["welcome", "bento"]) {
  const page = await home(preset(id));
  const g = await gearCheck(page);
  ok(!g.shown || g.hits === 0, id + ": the gear covers no widget while you watch (" + JSON.stringify(g) + ")");
  // focused (Up or Right at the edge, as the tip says), with the word Settings: shown, and clear if it has a spot
  await page.evaluate(() => window.CouchDesign.nav.focus("__gear"));
  await page.waitForTimeout(200);
  const f = await gearCheck(page);
  ok(f.shown, id + ": it shows when the remote reaches it");
  ok(f.tucked || f.hits === 0, id + ": with the word Settings it still covers nothing when it has a spot (" + JSON.stringify(f) + ")");
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  ok(/Home settings/.test(await page.evaluate(() => { const p = document.getElementById("gear-pop"); return p && p.classList.contains("on") ? p.textContent : ""; })), id + ": OK on it opens Home settings");
  ok(!page.errors.length, id + ": no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}
{ // a tucked gear (Packed Bento: hidden until reached) is no stop for the arrows, as in 0.13.6
  const page = await home(preset("bento"));
  const go = async (id, i, key) => {
    await page.evaluate(([a, b]) => window.CouchDesign.nav.focus(a, b), [id, i]); await page.waitForTimeout(120);
    await page.keyboard.press(key); await page.waitForTimeout(150);
    return page.evaluate(() => window.CouchDesign.nav.current());
  };
  const r1 = await go("today", -1, "ArrowRight");
  ok(r1 && r1.id !== "__gear", "bento: Right from Today does not land on the hidden gear (" + JSON.stringify(r1) + ")");
  const r2 = await go("apps", 0, "ArrowUp");
  ok(r2 && r2.id !== "__gear", "bento: Up from the first app does not land on the hidden gear (" + JSON.stringify(r2) + ")");
  const r3 = await go("today", -1, "ArrowUp");
  ok(r3 && r3.id === "__gear", "bento: Up at the top edge still reaches it (" + JSON.stringify(r3) + ")");
  await page.close();
}
{ // a gear on the right edge (Morning): Down onto it, then Up goes back the way it came
  const page = await home(preset("morning"));
  await page.evaluate(() => window.CouchDesign.nav.focus("hourly", -1)); await page.waitForTimeout(120);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150);
  const on = await page.evaluate(() => window.CouchDesign.nav.current());
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(150);
  const back = await page.evaluate(() => window.CouchDesign.nav.current());
  ok(on.id === "__gear" && back.id === "hourly", "morning: Down onto the gear, Up back to the hourly card (" + JSON.stringify([on, back]) + ")");
  await page.close();
}
{ // room at the top right: it stays there, always shown
  const open = { v: 1, background: { colour: "#26303f" }, objects: [{ id: "w0", type: "widget", kind: "welcome", x: 80, y: 60, w: 1160, h: 260 }, { id: "w1", type: "widget", kind: "clock", x: 1380, y: 360, w: 460, h: 160 }] };
  const page = await home(open);
  const g = await gearCheck(page);
  ok(g.shown && !g.tucked && g.hits === 0 && g.x > 1700 && g.y < 120, "room top right: shown there, covering nothing (" + JSON.stringify(g) + ")");
  await page.evaluate(() => window.CouchDesign.nav.focus("__gear")); await page.waitForTimeout(200);
  ok((await gearCheck(page)).hits === 0, "and focused, with the word Settings, it still covers nothing");
  await page.close();
}
{ // a clock filling the top right corner: the gear moves to a clear corner
  const d = { v: 1, background: { colour: "#26303f" }, objects: [{ id: "c", type: "widget", kind: "clock", x: 1300, y: 20, w: 600, h: 300 }, { id: "a", type: "widget", kind: "dock", x: 80, y: 860, w: 1160, h: 160, opts: { apps: ["netflix", "stan"], more: false } }] };
  const page = await home(d);
  const g = await gearCheck(page);
  ok(g.shown && g.hits === 0 && g.x < 960 && g.y < 120, "top right taken: it goes to the top left, covering nothing (" + JSON.stringify(g) + ")");
  // the arrow pointing at it reaches it: Up from the apps under it (a TCL, 20 Nov 2026: only Up from
  // the far side reached a gear on the left), and Right from it goes back
  await page.evaluate(() => window.CouchDesign.nav.focus("a", 0)); await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200);
  const up = await page.evaluate(() => window.CouchDesign.nav.current());
  ok(up && up.id === "__gear", "Up from the apps under it reaches the gear (" + JSON.stringify(up) + ")");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
  const back = await page.evaluate(() => window.CouchDesign.nav.current());
  ok(back && back.id !== "__gear", "Right from the gear goes back to a widget (" + JSON.stringify(back) + ")");
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(200);
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(200);
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200);
  ok((await page.evaluate(() => window.CouchDesign.nav.current())).id === "__gear", "and the edge still leads to it");
  await page.close();
}

// 2. Hold OK as Android's long press (a key down, then a repeat at once, then up) never opens the app
{
  const d = { v: 1, background: { colour: "#26303f" }, objects: [{ id: "d", type: "widget", kind: "dock", x: 80, y: 300, w: 1160, h: 160, opts: { apps: ["netflix", "stan"], more: false } }] };
  const page = await home(d);
  await page.evaluate(() => { window.__calls = []; const o = window.MOCK_API; window.MOCK_API = function (m, p, b) { window.__calls.push(p + " " + JSON.stringify(b || {})); return o(m, p, b); }; });
  await page.evaluate(() => window.CouchDesign.nav.focus("d", 0));
  await page.evaluate(() => {
    const k = (type, repeat) => document.dispatchEvent(new KeyboardEvent(type, { key: "Enter", keyCode: 13, repeat: repeat, bubbles: true, cancelable: true }));
    k("keydown", false); k("keydown", true); k("keyup", false);
  });
  await page.waitForTimeout(700);
  const items = await page.evaluate(() => [...document.querySelectorAll(".cw-menu .cw-mi")].map((x) => x.textContent));
  const calls = await page.evaluate(() => window.__calls.filter((c) => /launch/.test(c)));
  ok(items[0] === "Settings", "a long press on Netflix opens the Home menu, Settings first (" + items.join(", ") + ")");
  ok(items.indexOf("Change app") > 0, "and the app's own choices after it");
  ok(!calls.length, "Netflix is not opened (" + calls.join(" | ") + ")");
  // the TCL's WebView: the second down does not say it is a repeat (20 Nov 2026), still a hold
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => window.CouchDesign.nav.focus("d", 0));
  await page.evaluate(() => {
    const k = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: "Enter", keyCode: 13, repeat: false, bubbles: true, cancelable: true }));
    k("keydown"); k("keydown"); k("keyup");
  });
  await page.waitForTimeout(700);
  const items2 = await page.evaluate(() => [...document.querySelectorAll(".cw-menu .cw-mi")].map((x) => x.textContent));
  ok(items2[0] === "Settings", "two downs with no repeat mark open the Home menu too (" + items2.join(", ") + ")");
  ok(!(await page.evaluate(() => window.__calls.filter((c) => /launch/.test(c)))).length, "and Netflix is not opened");
  // a short OK still opens it
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => window.CouchDesign.nav.focus("d", 0));
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  ok((await page.evaluate(() => window.__calls.filter((c) => /launch/.test(c)))).length === 1, "a short OK still opens the app");
  await page.close();
}
{ // the classic home: the same long press on an app tile is a hold, not a launch
  const page = await home(null);
  await page.evaluate(() => { window.__calls = []; const o = window.MOCK_API; window.MOCK_API = function (m, p, b) { window.__calls.push(p); return o(m, p, b); }; });
  await page.evaluate(() => {
    const k = (type, repeat) => document.dispatchEvent(new KeyboardEvent(type, { key: "Enter", keyCode: 13, repeat: repeat, bubbles: true, cancelable: true }));
    k("keydown", false); k("keydown", true); k("keyup", false);
  });
  await page.waitForTimeout(900);
  ok(!(await page.evaluate(() => window.__calls.filter((c) => /launch/.test(c)))).length, "classic home: a long press opens no app");
  await page.close();
}
{ // the classic home, the TCL's way: two downs, no repeat mark
  const page = await home(null);
  await page.evaluate(() => { window.__calls = []; const o = window.MOCK_API; window.MOCK_API = function (m, p, b) { window.__calls.push(p); return o(m, p, b); }; });
  await page.evaluate(() => {
    const k = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: "Enter", keyCode: 13, repeat: false, bubbles: true, cancelable: true }));
    k("keydown"); k("keydown"); k("keyup");
  });
  await page.waitForTimeout(900);
  ok(!(await page.evaluate(() => window.__calls.filter((c) => /launch/.test(c)))).length, "classic home: two downs with no repeat mark open no app");
  await page.close();
}

// 3 and 4. About on the on-TV app: the truth about the computer, and Update couch-tv
async function about(page) {
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  for (let i = 0; i < 20 && !(await page.evaluate(() => /About/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  return page.evaluate(() => document.getElementById("set-rows").textContent);
}
{
  const page = await home(null, "&ontv=1&update=ontv");
  // answer the once only question about new versions if it is up
  await page.evaluate(() => { const p = document.getElementById("gear-pop"); if (p && p.classList.contains("ask")) window.MOCK_UPDATER.auto(true); });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const rows = await about(page);
  ok(!/With the computer/.test(rows) && /On its own, no computer/.test(rows), "on-TV app: Running says no computer (" + rows.slice(0, 200) + ")");
  ok(!/On this TV and the computer/.test(rows) && /On this TV/.test(rows), "on-TV app: settings are kept on this TV");
  ok(/Update couch-tv/.test(rows) && /Version 0\.4 is out \(this TV has 0\.3\)/.test(rows), "About: Update couch-tv with the version line");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
  for (let i = 0; i < 12 && !/^Update couch-tv/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const up = await page.evaluate(() => document.getElementById("set-rows").textContent);
  ok(await page.evaluate(() => document.getElementById("set-head").textContent) === "Update couch-tv", "OK opens the Update couch-tv page");
  ok(/Downloader/.test(up) && /8180170/.test(up) && /cannot install an update by itself/.test(up), "it gives the Downloader steps and code (" + up.slice(0, 240) + ")");
  ok(!/Update to 0\.4/.test(up), "and no Update to button that could not work");
  // a TCL, 20 Nov 2026: the page opened scrolled to its first button and step 1 was off the top,
  // with no way up. Step 1 can be seen, by opening at the top or by Up scrolling to it.
  const seen = (sel) => page.evaluate((s) => {
    const box = document.getElementById("set-rows"), el = [...box.querySelectorAll(".srow")].find((r) => r.textContent.indexOf(s) >= 0);
    if (!el) return false;
    const a = box.getBoundingClientRect(), b = el.getBoundingClientRect();
    return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  }, sel);
  for (let i = 0; i < 6 && !(await seen("Press Home, then open Downloader")); i++) { await page.keyboard.press("ArrowUp"); await page.waitForTimeout(250); }
  ok(await seen("Press Home, then open Downloader"), "step 1 can be seen (open at the top, or Up scrolls to it)");
  const before = await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");
  ok(/Check for updates now/.test(before), "and the focus stays on the first button (" + before.slice(0, 60) + ")");
  for (let i = 0; i < 8; i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  // every press restarts the smooth scroll, so wait for the list to settle before looking (review, 20 Nov)
  await page.waitForFunction(() => { const f = document.querySelector(".srow.focus"), box = document.getElementById("set-rows"); if (!f) return false; const a = box.getBoundingClientRect(), b = f.getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; }, null, { timeout: 3000 }).catch(() => {});
  ok(await page.evaluate(() => { const f = document.querySelector(".srow.focus"), box = document.getElementById("set-rows"); if (!f) return false; const a = box.getBoundingClientRect(), b = f.getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; }), "Down still keeps the focused row on screen");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}
{ // the launcher (it installs itself): About has the row too, and the page offers Update to
  const page = await home(null, "&update=1");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const rows = await about(page);
  ok(/Update couch-tv/.test(rows) && /With the computer|Computer/.test(rows), "launcher: About has Update couch-tv, and the computer line is unchanged");
  await page.close();
}

// 5. a Folder tile whose icons fail to load: each app shows its name, never an empty square at 0 px
for (const fail of [true, false]) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  if (fail) await page.route(/app-logos|app-icons|tvos\.invalid/, (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify({ v: 1, background: { colour: "#26303f" }, objects: [{ id: "f", type: "widget", kind: "folder", x: 80, y: 60, w: 180, h: 180, opts: { label: "Kids", apps: ["netflix", "youtube", "stan", "iview"] } }] })); });
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="f"] .cw'));
  await page.waitForTimeout(1200);
  const minis = await page.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="f"] .cw-mini')].map((n) => ({ icon: n.classList.contains("cw-has-icon"), px: parseFloat(getComputedStyle(n).fontSize) })));
  ok(minis.length > 0, "the folder tile draws its apps (" + minis.length + ")");
  ok(minis.every((m) => m.icon ? m.px === 0 : m.px >= 20), (fail ? "icons failed" : "icons loaded") + ": a name shows wherever there is no icon, hidden behind an icon (" + JSON.stringify(minis) + ")");
  if (fail) ok(minis.some((m) => !m.icon), "with the icons failing, at least one app shows its name");
  await page.close();
}

await browser.close();
server.close();
console.log("0.13.6 fixes browser tests passed (" + n + " checks)");
