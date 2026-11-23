// The TV's side of setting widgets up on the phone (owner, 23 Nov 2026: "I'd rather people not be editing
// their widgets on the TV screen at all"), in a real browser at 1920x1080:
//  1. Nothing the TV draws for a widget that is not set up names a kind of TV: every widget kind at three
//     sizes, with and without a phone page, its OK layer and its Hold OK menu. This fails on any of
//     Hisense, Samsung, Roku, Apple TV, Fire TV, Google TV or "website home" (the old Which TVs rows).
//  2. A widget waiting for something private says what it is (its name, one short line) and "Set up on
//     your phone" with the code for this widget's step (#pin=...&widget=<id>&connect=<need>).
//  3. OK on it opens the same code in a few words; Hold OK has "<Widget>: set up on your phone" first, its
//     sheet "No phone? Set it up here", which opens the widget's own page in Home settings. With no phone
//     page: "Press OK to set it up", and the TV's own page.
//  4. A design that arrives needing setup shows "Set up your widgets" with the code (#widgets) once, for up to
//     2 minutes; Back closes it.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_widget_setup_tv_browser.mjs
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
const TV_NAMES = /Hisense|Samsung|Roku|Apple TV|Fire TV|Google TV|website home/;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""), f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
const browser = await chromium.launch();
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });
async function home(widgets, q, seen) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => { const R = rect(x[1], x[2], x[3], x[4]); return Object.assign({ id: "w" + i, type: "widget", kind: x[0], x: R.x, y: R.y, w: R.w, h: R.h }, x[5] ? { opts: x[5] } : {}); }) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(([d, s]) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); if (s) localStorage.setItem("couchtv.design.setupcard", "seen"); }, [design, seen !== false]);
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o .cw") && window.CouchDetail);
  await page.waitForTimeout(900);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 250); };
async function holdOn(page, id) {
  await page.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await page.waitForTimeout(200);
  await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
  return page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
}
console.log("Running widget setup TV browser tests...");

// ---- 1. no kind of TV named anywhere the TV draws a widget waiting for setup ----
for (const q of ["", "&ontv=1"]) {
  const page = await home([["clock", 0, 0, 4, 2]], q);
  const r = await page.evaluate(async () => {
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, out = { bad: [], faces: 0, layers: 0, words: [] };
    const sizes = [[160, 160], [760, 360], [1160, 560]];
    const env = { data: {}, phone: true, phoneUrl: "http://tv.example:5400/setup#pin=482913", look: {} };
    for (const kind of C.kinds()) for (const [w, h] of sizes) {
      const root = W.render({ id: "t", kind: kind, w: w, h: h }, Object.assign({}, env, { phone: /ontv/.test(location.search) }));
      const holder = document.createElement("div"); holder.className = "cd-layer cw-o"; holder.setAttribute("data-obj", "t"); holder.style.cssText = "position:fixed;left:0;top:0;width:" + w + "px;height:" + h + "px"; holder.appendChild(root); document.body.appendChild(holder);
      if (/Hisense|Samsung|Roku|Apple TV|Fire TV|Google TV|website home/.test(root.textContent)) out.bad.push(kind + " " + w + "x" + h + ": " + root.textContent.slice(0, 100));
      if (root.getAttribute("data-face")) out.faces++;
      if (root.getAttribute("data-empty") && w === 760) {
        window.CouchDetail.open(root, { data: {} }, { phone: function () { return Promise.resolve("http://tv.example:5400/setup#pin=482913&widget=t"); }, tvEdit: function () {} });
        const panel = document.querySelector(".cwd-panel"), txt = panel ? panel.textContent : "";
        if (/Hisense|Samsung|Roku|Apple TV|Fire TV|Google TV|website home/.test(txt)) out.bad.push(kind + " layer: " + txt.slice(0, 100));
        if (root.getAttribute("data-need") && /ontv/.test(location.search)) out.words.push([kind, txt.replace("Back to close", "").trim().split(/\s+/).length]);
        out.layers++;
        window.CouchDetail.close(true);
      }
      holder.remove();
    }
    return out;
  });
  ok(r.bad.length === 0, (q || "no phone page") + ": no kind of TV named in a widget or its layer: " + r.bad.slice(0, 4).join(" | "));
  ok(r.faces >= 20, (q || "no phone page") + ": the widgets waiting for setup show their face (" + r.faces + ")");
  ok(r.layers >= 30, "every waiting widget's layer looked at (" + r.layers + ")");
  if (q) ok(r.words.length > 20 && r.words.every((x) => x[1] <= 20), "the setup layer is a few words, not 131 to 229 (most: " + Math.max(...r.words.map((x) => x[1])) + ", " + r.words.filter((x) => x[1] > 20).map((x) => x.join(" ")).join(", ") + ")");
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await page.close();
}

// ---- 2 and 3. the face, OK and Hold OK, with the phone page (the on-TV app) ----
{
  const page = await home([["agenda", 0, 0, 8, 4], ["note", 8, 0, 4, 2], ["clock", 12, 0, 4, 2], ["photo", 8, 2, 2, 2]], "&ontv=1");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="w0"] .cw[data-face="1"] .cw-fqr'), null, { timeout: 8000 });
  const f = await page.evaluate(() => { const c = document.querySelector('.cw-o[data-obj="w0"] .cw'); return { text: c.textContent, link: c.querySelector(".cw-fqr").getAttribute("data-link"), svg: !!c.querySelector(".cw-fqr svg") }; });
  ok(/^Calendar/.test(f.text) && /Your next events/.test(f.text) && /Set up on your phone/.test(f.text), "the agenda names itself (Calendar, the plain word), says what it shows, then Set up on your phone: " + f.text);
  ok(f.svg && f.link === "http://tv.example:5400/setup#pin=482913&widget=w0&connect=calendar", "with the code for its step: " + f.link);
  const small = await page.evaluate(() => document.querySelector('.cw-o[data-obj="w3"] .cw').textContent);
  ok(/Photo/.test(small) && /Set up on your phone/.test(small), "a tile says its name and Set up on your phone: " + small);
  ok(await page.evaluate(() => !document.querySelector('.cw-o[data-obj="w2"] .cw[data-face]')), "a clock needs nothing and shows the time");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "tv-needs-setup.png") });
  // OK: the layer with the code
  await page.evaluate(() => window.CouchDesign.nav.focus("w0", -1)); await press(page, "Enter", 900);
  const L = await page.evaluate(() => ({ cur: window.CouchDetail.current(), text: document.querySelector(".cwd-panel").textContent, link: (document.querySelector(".cwd-qr") || {}).getAttribute && document.querySelector(".cwd-qr").getAttribute("data-link") }));
  ok(L.cur.name === "setup" && /Set up on your phone/.test(L.text) && /Scan with your phone camera\./.test(L.text) && /No phone\? Set it up here/.test(L.text), "OK opens the code in a few words: " + L.text);
  ok(L.link === "http://tv.example:5400/setup#pin=482913&widget=w0&connect=calendar", "the layer's code opens the same step: " + L.link);
  ok(!/What it needs|Which TVs|How to set it up|Until then/.test(L.text), "none of the old setup card");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "tv-setup-layer.png") });
  await press(page, "Escape", 600);
  // Hold OK: phone first
  const items = await holdOn(page, "w0");
  ok(items[0] === "Calendar: set up on your phone" && items.indexOf("Edit on the TV") < 0, "Hold OK: Calendar: set up on your phone, first (" + items.join(", ") + ")");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "tv-hold-ok.png") });
  await press(page, "Enter", 900);
  const sh = await page.evaluate(() => { const s = document.querySelector(".cw-sheet"); return { title: s.querySelector("h2").textContent, link: s.querySelector(".cw-qr").getAttribute("data-link"), text: s.textContent }; });
  ok(sh.title === "Set up on your phone" && /Scan with your phone camera\./.test(sh.text) && /No phone\? Set it up here/.test(sh.text), "its sheet: Set up on your phone, the code, No phone? Set it up here");
  ok(sh.link === "http://tv.example:5400/setup#pin=482913&widget=w0&connect=calendar", "the sheet's code: " + sh.link);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "tv-hold-ok-sheet.png") });
  await press(page, "ArrowDown", 200); await press(page, "Enter", 900);
  ok(await page.evaluate(() => document.getElementById("settings").classList.contains("on") && /Agenda/.test(document.getElementById("set-head").textContent)), "No phone? Set it up here opens the widget's own page in Home settings");
  for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(page, "Escape", 300);
  await page.waitForTimeout(700);
  // a widget with settings and nothing waiting: Edit on your phone, first
  const ci = await holdOn(page, "w2");
  ok(ci[0] === "Edit on your phone" && ci.indexOf("Edit on the TV") < 0, "a clock: Edit on your phone first (" + ci.join(", ") + ")");
  await press(page, "Escape", 300);
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await page.close();
}
// ---- 3b. no phone page: the TV's own page, said plainly ----
{
  const page = await home([["agenda", 0, 0, 8, 4]], "");
  ok(/Press OK to set it up/.test(await page.evaluate(() => document.querySelector('.cw-o[data-obj="w0"] .cw').textContent)), "with no phone page the widget says Press OK to set it up");
  const items = await holdOn(page, "w0");
  ok(items[0] === "Settings" && items[1] === "Edit on the TV", "and Hold OK keeps Edit on the TV (" + items.join(", ") + ")");
  await press(page, "Escape", 300);
  await page.evaluate(() => window.CouchDesign.nav.focus("w0", -1)); await press(page, "Enter", 900);
  ok(/No phone\? Set it up here/.test(await page.evaluate(() => document.querySelector(".cwd-panel").textContent)) && !(await page.$(".cwd-qr")), "OK opens the TV's own way, no code");
  await page.close();
}

// ---- 4. a new design that needs setting up ----
{
  const page = await home([["agenda", 0, 0, 8, 4], ["clock", 8, 0, 4, 2]], "&ontv=1", false);
  await page.waitForFunction(() => document.querySelector(".cw-sheet.cw-arrive"), null, { timeout: 9000 });
  const a = await page.evaluate(() => { const s = document.querySelector(".cw-sheet.cw-arrive"); return { title: s.querySelector("h2").textContent, link: s.querySelector(".cw-qr").getAttribute("data-link"), text: s.textContent }; });
  ok(a.title === "Set up your widgets" && a.link === "http://tv.example:5400/setup#pin=482913&widgets", "a design that needs setup: Set up your widgets, with the code (" + a.link + ")");
  ok(a.text.split(/\s+/).length <= 10, "in a few words: " + a.text);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "tv-arrival-card.png") });
  await press(page, "Escape", 400);
  ok(!(await page.$(".cw-sheet")), "Back closes it");
  await page.reload(); await page.waitForFunction(() => window.CouchDesign && window.CouchDesign.on()); await page.waitForTimeout(5500);
  ok(!(await page.$(".cw-sheet.cw-arrive")), "once per design: not again after a restart");
  await page.close();
  const p2 = await home([["clock", 0, 0, 4, 2]], "&ontv=1", false);
  await p2.waitForTimeout(5000);
  ok(!(await p2.$(".cw-sheet.cw-arrive")), "a design with nothing to set up shows no card");
  await p2.close();
}
// ---- 5. a word with a hyphen never breaks at it (the TCL: "Guest Wi-" over "Fi" on a 2 by 2 tile) ----
{
  const page = await home([["clock", 0, 0, 4, 2]], "&ontv=1");
  const r = await page.evaluate(() => {
    const out = [];
    for (const [w, h] of [[160, 160], [160, 260], [260, 160]]) {
      const root = window.CouchWidgets.render({ id: "t", kind: "wifi", w: w, h: h }, { data: {}, phone: true, phoneUrl: "http://tv.example:5400/setup#pin=482913", look: {} });
      const holder = document.createElement("div"); holder.className = "cd-layer cw-o"; holder.style.cssText = "position:fixed;left:0;top:0;width:" + w + "px;height:" + h + "px"; holder.appendChild(root); document.body.appendChild(holder);
      const text = root.textContent;
      // every "Wi-Fi" drawn: its letters all on one line
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let broken = 0, seen = 0, nd;
      while ((nd = walker.nextNode())) {
        const at = nd.textContent.indexOf("Wi-Fi"); if (at < 0) continue;
        seen++;
        const rg = document.createRange(); rg.setStart(nd, at); rg.setEnd(nd, at + 5);
        const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (tops.size > 1) broken++;
      }
      out.push({ size: w + "x" + h, has: /Guest Wi-Fi/.test(text), seen, broken });
      holder.remove();
    }
    return out;
  });
  for (const x of r) ok(x.has && x.seen > 0 && x.broken === 0, "Guest Wi-Fi at " + x.size + ": the name is there and Wi-Fi is on one line (" + JSON.stringify(x) + ")");
  await page.close();
}
await browser.close(); server.close();
console.log("widget setup TV: " + n + " checks passed");
