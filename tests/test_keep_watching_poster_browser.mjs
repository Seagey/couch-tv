// #192 (thanks Hiren-Patel1): home.keep_watching_style "poster" shows the Night look's Keep watching row
// as the Classic poster tiles, each two dock columns wide. Checked in a real browser at 1920x1080 (the
// TV home in its ?mock preview): the cards stay the default, the posters line up with the dock's columns,
// the focused one is always in view with its title under it and clear of the dock, Down lands on the app
// under it, Now playing still comes first, and Home settings, Look switches between the two.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_keep_watching_poster_browser.mjs
// (COUCHTV_CHANNEL=chrome uses an installed Chrome instead of Playwright's own Chromium.)
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

const browser = await chromium.launch(process.env.COUCHTV_CHANNEL ? { channel: process.env.COUCHTV_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const press = async (k, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(k); await page.waitForTimeout(260); } };
const open = async (q) => {
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&" + q);
  await page.waitForFunction(() => document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(1000);
};
const row = () => page.evaluate(() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const clip = document.querySelector("#shelf-section .shelf-clip");
  const cards = [...document.querySelectorAll("#shelf > *")];
  const f = document.querySelector("#shelf > .focus");
  const cap = f && f.querySelector(".caption");
  const apps = [...document.querySelectorAll("#grid .app")];
  return {
    poster: document.documentElement.classList.contains("kw-poster"),
    kinds: cards.map((e) => (e.classList.contains("show") ? "show" : e.classList.contains("ncard") ? "ncard" : e.className)),
    width: cards[0] ? cards[0].offsetWidth : 0, height: cards[0] ? cards[0].offsetHeight : 0,
    step: cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : 0,
    app: apps[0] ? apps[0].offsetWidth : 0, appStep: apps[1] ? box(apps[1]).left - box(apps[0]).left : 0,
    clip: clip && box(clip), focus: f && box(f), index: f ? cards.indexOf(f) : -1, count: cards.length,
    caption: cap && { box: box(cap), text: cap.textContent, shown: getComputedStyle(cap).display !== "none" && getComputedStyle(cap).opacity === "1" },
    tray: box(document.getElementById("grid")),
    zone: document.querySelector("#grid .app.focus") ? "grid" : f ? "shelf" : document.querySelector("#np .focus, #np.focus, .np .focus") ? "np" : "other",
    gridFocus: (() => { const g = document.querySelector("#grid .app.focus"); return g ? box(g) : null; })()
  };
});

// 1. the default stays the wide cards
await open("keep=11");
let r = await row();
ok(!r.poster && r.kinds.length > 0 && r.kinds.every((k) => k === "ncard"), "with no style set, the Night row is the wide cards");

// 2. home.keep_watching_style "poster": Classic tiles, two dock columns wide and 16:9, the dock's gap between them
await open("keep=11&kwstyle=poster");
r = await row();
ok(r.poster && r.kinds.every((k) => k === "show"), "poster style: every card is a Classic poster tile (" + r.kinds.join(",") + ")");
ok(Math.abs(r.width - (2 * r.app + (r.appStep - r.app))) <= 1, "a poster is two dock columns wide (" + r.width + " px, apps " + r.app + " px every " + r.appStep + ")");
ok(Math.abs(r.step - r.appStep * 2) <= 1, "posters sit two dock columns apart (" + r.step + " px)");
ok(Math.abs(r.width / r.height - 16 / 9) < 0.01, "posters are 16:9 (" + r.width + "x" + r.height + ")");
ok(Math.floor((r.clip.width + r.step - r.width) / r.step) >= 6, "six posters fit across where three cards did");

// 3. along the row: the focused poster is always in view, with its title under it and above the dock
await press("ArrowDown");
r = await row();
ok(r.index === 0, "Down from the people lands on the first poster");
const total = r.count;
for (let i = 0; i < total; i++) {
  r = await row();
  ok(r.index === i, "Right moves one poster at a time (" + r.index + ")");
  ok(r.focus.left >= r.clip.left - 1 && r.focus.right <= r.clip.right + 1, "poster " + (r.index + 1) + " is in view (" + Math.round(r.focus.left) + "-" + Math.round(r.focus.right) + ")");
  ok(r.caption && r.caption.shown && r.caption.text.length > 0, "poster " + (r.index + 1) + " shows its title: " + (r.caption && r.caption.text));
  ok(r.caption.box.top >= r.focus.bottom - 1 && r.caption.box.bottom <= r.tray.top, "its title sits under it and above the dock (" + Math.round(r.caption.box.bottom) + " <= " + Math.round(r.tray.top) + ")");
  if (i < total - 1) await press("ArrowRight");
}
// from the last one, Right goes round to the first, as it does with the cards (#167)
await press("ArrowRight");
r = await row();
ok(r.index === 0 && r.focus.left >= r.clip.left - 1, "Right from the last poster goes round to the first, in view");
const others = await page.evaluate(() => [...document.querySelectorAll("#shelf > .show:not(.focus) .caption")].every((c) => getComputedStyle(c).display === "none"));
ok(others, "only the focused poster shows its title");

// 4. Down lands on the app under the poster, Up goes back to it
await press("ArrowLeft", r.count);
await press("ArrowRight", 2);
r = await row();
const mid = (r.focus.left + r.focus.right) / 2;
await press("ArrowDown");
r = await row();
ok(r.zone === "grid" && r.gridFocus.left <= mid + r.appStep / 2 && r.gridFocus.right >= mid - r.appStep / 2, "Down lands on the app under the poster");
await press("ArrowUp");
r = await row();
ok(r.zone === "shelf" && r.index === 2, "Up goes back to the same poster");

// 5. a song: Now playing stays the first card, the posters slide beside it
await open("keep=11&kwstyle=poster&music=1");
await press("ArrowDown");
r = await row();
ok(r.zone === "np", "with a song playing, Down lands on Now playing first");
const npRight = await page.evaluate(() => document.getElementById("np-slot").getBoundingClientRect().right);
ok(r.clip.left >= npRight - 1 || (await page.evaluate(() => document.querySelector("#shelf > *").getBoundingClientRect().left)) >= npRight, "the posters start after Now playing");
for (let i = 0; i < 5 && (await row()).zone === "np"; i++) await press("ArrowRight");   // past its buttons
r = await row();
ok(r.zone === "shelf" && r.index === 0, "Right from Now playing's last button goes on to the first poster");
await press("ArrowLeft");
r = await row();
ok(r.zone === "np", "Left from the first poster goes back to Now playing");

// 6. Home settings, Look: Keep watching as posters switches the row, and the choice is kept
await open("keep=11");
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Settings", keyCode: 0, bubbles: true })));
await page.waitForTimeout(400);
await press("Enter");
await page.waitForTimeout(400);
for (let i = 0; i < 9 && !(await page.evaluate(() => /Look/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown");
await press("ArrowRight");
let label = "";
for (let i = 0; i < 80; i++) {
  label = await page.evaluate(() => { const f = document.querySelector(".srow.focus"); return f ? f.textContent : ""; });
  if (/^Keep watching as posters/.test(label)) break;
  await press("ArrowDown");
}
ok(/^Keep watching as posters\s*Off/.test(label), "Look has Keep watching as posters, off by default (" + label + ")");
await press("Enter");
await page.waitForTimeout(300);
label = await page.evaluate(() => document.querySelector(".srow.focus").textContent);
ok(/On$/.test(label), "the switch turns on (" + label + ")");
ok(await page.evaluate(() => document.documentElement.classList.contains("kw-poster") && [...document.querySelectorAll("#shelf > *")].every((e) => e.classList.contains("show"))), "the row is posters straight away");
ok(await page.evaluate(() => Object.keys(localStorage).some((k) => /tvhome\.settings$/.test(k) && JSON.parse(localStorage.getItem(k)).s.keep_watching_style === "poster")), "the choice is saved");
await page.goto(BASE + "?mock=1&keep=11");
await page.waitForTimeout(1200);
ok(await page.evaluate(() => document.documentElement.classList.contains("kw-poster")), "and kept after the home opens again");

// 7. the Loop and Classic looks are unchanged
await open("keep=11&kwstyle=poster&look=classic");
r = await row();
ok(!r.poster && r.kinds.every((k) => k === "show") && r.width === 320, "Classic keeps its own poster size");
await open("keep=11&kwstyle=poster&look=loop");
r = await row();
ok(!r.poster && r.kinds.every((k) => k === "tile lcard"), "the Loop look keeps its thumbnails");

ok(errors.length === 0, "no page errors: " + errors.join("; "));
await browser.close();
server.close();
console.log("Keep watching poster browser tests passed (" + n + " checks).");
