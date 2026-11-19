// What real beginners hit on a Toshiba and a TCL Google TV (19 Nov 2026), checked in a real browser at
// 1920x1080 (the TV home in its ?mock preview, the same page the TV runs):
//  1. The Guest Welcome starter never shows its sample words on a TV ("Ella and friends", "Headland
//     House", "Night two of five"): with no name it says just Welcome; a guest's name typed on the TV
//     (At home, Guests) shows after the greeting.
//  2. Every design has a Settings button (a gear, top right) the remote can reach, and OK on it opens
//     Home settings. The way in is said on screen every time until it has been used once.
//  3. Hold OK on a clock opens the Home menu with Settings first, even on a TV that sends a held OK as
//     quick down and up pairs (a TCL did), never the clock's Timers.
//  4. No town set: no made up place (never Sydney), and the classic home says where to pick a town.
//  5. A photo box with no photo yet has a dark panel under its words (it was white on beige).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_beginner_fixes_browser.mjs
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

// the Guest Welcome starter's greeting, exactly as couch-tv Studio's template has it
const SAMPLE = { kicker: "Headland House, North Point", text: "Welcome, Ella and friends", sub: "Tuesday to Sunday. Night two of five" };
const browser = await chromium.launch();
async function home(objects, opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  const design = objects ? { v: 1, background: { colour: "#e9dcc6" }, objects } : null;
  await page.evaluate(([d, athome]) => {
    localStorage.clear();
    if (d) localStorage.setItem("tvdesigner.design", JSON.stringify(d));
    if (athome) localStorage.setItem("mock:tvhome.athome", JSON.stringify(athome));
  }, [design, opts.athome || null]);
  await page.goto(BASE + "?mock=1" + (design ? "&design=local" : "") + (opts.q || ""));
  if (design) await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDesign);
  else await page.waitForFunction(() => document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(600);
  return page;
}
const text = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id);
const welcome = [{ id: "w0", type: "widget", kind: "welcome", x: 80, y: 60, w: 1160, h: 260, opts: SAMPLE },
  { id: "w1", type: "widget", kind: "clock", x: 1380, y: 360, w: 460, h: 160 }];

console.log("Running beginner fixes browser tests...");

// 1. the Welcome widget on a TV
{
  const page = await home(welcome);
  const t = await text(page, "w0");
  ok(!/Ella|Headland|Night two/.test(t), "no sample guest or sample house on a TV (" + t + ")");
  ok(/^\s*Welcome\s*$/.test(t), "with no name it says just Welcome (" + t + ")");
  await page.close();
}
{
  const page = await home(welcome, { athome: { guest: { name: "the Nguyen family", at: 1 } } });
  const t = await text(page, "w0");
  ok(/Welcome, the Nguyen family/.test(t), "a guest's name typed on the TV follows the greeting (" + t + ")");
  ok(!/Ella/.test(t), "never the sample name beside it");
  await page.close();
}
{ // the name box in At home: typed with the remote, on the widget at once, and kept on this TV only
  const page = await home(welcome);
  const stored = await page.evaluate(() => {
    const s = window.CouchAtHome.clean({ guest: { name: "  Sarah <b>https://x.example</b> ", at: 5 } });
    return [window.CouchAtHome.guestFull("Sarah & Tom!"), window.CouchAtHome.guestFull("http://evil.example"), window.CouchAtHome.guestFull("x".repeat(80)).length, JSON.stringify(s)];
  });
  ok(stored[0] === "Sarah & Tom!", "a plain name is kept as typed (" + stored[0] + ")");
  ok(stored[1] === "", "a link is never a name");
  ok(stored[2] === 38, "at most 38 characters");
  ok(!/https|<b>/.test(stored[3]), "the store never keeps a link or markup in the name (" + stored[3] + ")");
  await page.close();
}

// 2. the Settings button on a design
{
  const page = await home(welcome);
  const g = await page.evaluate(() => { const e = document.querySelector(".cw-gearchip"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, vis: getComputedStyle(e).display }; });
  ok(g && g.vis !== "none" && g.w > 30, "a Settings button shows on the design (" + JSON.stringify(g) + ")");
  ok(g && g.x > 1700 && g.y < 120, "it sits at the top right");
  // the remote reaches it: from the clock (right side), Up
  await page.evaluate(() => window.CouchDesign.nav.focus("w1"));
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200);
  const cur = await page.evaluate(() => (window.CouchDesign.nav.current() || {}).id);
  ok(cur === "__gear", "Up from the clock lands on the Settings button (" + cur + ")");
  const label = await page.evaluate(() => getComputedStyle(document.querySelector(".cw-gearchip .cw-gearchip-t")).display);
  ok(label !== "none", "it says Settings while it has the focus");
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const opened = await page.evaluate(() => { const p = document.getElementById("gear-pop"); return p && p.classList.contains("on") ? p.textContent : ""; });
  ok(/Home settings/.test(opened), "OK on it opens the settings menu, Home settings first (" + opened.slice(0, 60) + ")");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}
{ // the tip: every time the home opens, until the way in has been used once
  const page = await home(welcome);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  const tip = await page.evaluate(() => (document.querySelector(".cw-tip") || {}).textContent || "");
  ok(/gear/.test(tip) && /Settings button opens the TV's menu/.test(tip), "the tip says how to reach settings and what the remote's Settings button does (" + tip + ")");
  await page.close();
}

// 3. Hold OK on a clock, as quick down and up pairs
{
  const page = await home(welcome);
  await page.evaluate(() => window.CouchDesign.nav.focus("w1"));
  for (let i = 0; i < 8; i++) { await page.keyboard.down("Enter"); await page.waitForTimeout(40); await page.keyboard.up("Enter"); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
  const items = await page.evaluate(() => [...document.querySelectorAll(".cw-menu .cw-mi")].map((x) => x.textContent));
  const detail = await page.evaluate(() => window.CouchDetail && window.CouchDetail.isOpen() ? (window.CouchDetail.current() || {}).name : null);
  ok(items[0] === "Settings", "a held OK sent as quick pairs opens the Home menu, Settings first (" + items.join(", ") + ")");
  ok(!detail, "not the clock's own page (" + detail + ")");
  await page.close();
}
{ // a single short OK still opens the clock's own page
  const page = await home(welcome);
  await page.evaluate(() => window.CouchDesign.nav.focus("w1"));
  await page.keyboard.press("Enter"); await page.waitForTimeout(600);
  const detail = await page.evaluate(() => window.CouchDetail && window.CouchDetail.isOpen());
  ok(detail, "a short OK on the clock still opens its page");
  await page.close();
}

// 4. no town set
{
  const page = await home(null, { q: "&nowx=1" });
  const all = await page.evaluate(() => document.body.innerText);
  ok(!/Sydney/.test(all), "no sample town anywhere on the classic home");
  const d = await page.evaluate(() => document.getElementById("date").textContent);
  ok(/Weather: pick your town in Home settings, Location/.test(d), "it says where to pick a town (" + d + ")");
  await page.close();
}
{
  const page = await home(null, { q: "&place=Riverside&wx=21,1" });
  const d = await page.evaluate(() => document.getElementById("date").textContent);
  ok(!/pick your town/.test(d) && /Riverside/.test(d), "with a town set the date line is as before (" + d + ")");
  await page.close();
}

// 5. a photo box with no photo yet
{
  const page = await home([{ id: "w0", type: "widget", kind: "photo", x: 80, y: 60, w: 760, h: 460 }]);
  const bg = await page.evaluate(() => { const b = document.querySelector('.cw-o[data-obj="w0"] .cw .cw-bg'); return b ? getComputedStyle(b).backgroundColor : ""; });
  const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(bg) || [];
  ok(m.length && +m[1] < 60 && +m[2] < 60 && +m[3] < 60 && (m[4] === undefined || +m[4] >= 0.6), "a dark panel under the words (" + bg + ")");
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
