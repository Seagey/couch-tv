// Fast TV (Couch TV Studio's Fast TV Paper and Fast TV Ink, 28 Nov 2026) on the real home in a real browser:
// no scene or photo is fetched, nothing is blurred, no word in a widget has a shadow, Lighter home is on and
// the focused tile holds still; and Shadow None is what drops the shadow (a bare clock without it keeps its own).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_fast_tv_browser.mjs [shots folder]
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.argv[2] || "";
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const asked = [];
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  asked.push(p);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
const errors = [];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function open(design, noWidgets) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); localStorage.setItem("couchtv.wtip.used", "1"); }, design);
  asked.length = 0;
  await page.goto(BASE + "?mock=1&people=2&wx=24,2&place=Bellingen&design=local");
  if (!noWidgets) await page.waitForFunction(() => document.querySelector(".cw-o"), null, { timeout: 10000 });
  await page.waitForTimeout(2500);
  return page;
}
const look = (page) => page.evaluate(() => {
  let shadowed = 0, blur = 0;
  document.querySelectorAll(".cw, .cw *").forEach((x) => { const cs = getComputedStyle(x); if (cs.textShadow && cs.textShadow !== "none") shadowed++; if ((cs.backdropFilter || cs.webkitBackdropFilter || "none") !== "none") blur++; });
  return { widgets: document.querySelectorAll(".cw-o").length, shadowed, blur, lighter: document.documentElement.classList.contains("lighter"), still: document.documentElement.classList.contains("still") };
});

console.log("Running Fast TV browser tests...");

// A plain colour with no clock widget of its own keeps the home's glass clock (it drew nothing for a while after
// scenes stopped loading under a design background), and still fetches no picture
{
  const page = await open({ v: 1, background: { colour: "#000000" } }, true);
  const c = await page.evaluate(() => { const n = document.querySelector("#scenes .scene.on .gclock:not(.under) .fill"); if (!n) return null; const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return { w: r.width, h: r.height, color: cs.color, image: cs.backgroundImage }; });
  ok(c && c.w > 200 && c.h > 50, "a colour-only design still draws the home's clock (" + JSON.stringify(c) + ")");
  ok(c && /255, 255, 255/.test(c.color) && c.image === "none", "that clock is frosted white, no picture behind it");
  ok(!asked.some((u) => /backgrounds\//.test(u)), "and no scene picture is fetched for it");
  await page.close();
}
const fast = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/fast-tv-designs.json"), "utf8"));
for (const f of fast) {
  const page = await open(f.design);
  const s = await look(page);
  ok(s.widgets === f.design.objects.length, f.id + ": every widget drawn (" + s.widgets + ")");
  ok(!asked.some((u) => /backgrounds\//.test(u)), f.id + ": no scene or photo fetched (" + asked.filter((u) => /backgrounds\//.test(u)).join(", ") + ")");
  ok(s.blur === 0, f.id + ": nothing blurred");
  ok(s.shadowed === 0, f.id + ": no word shadow in any widget (" + s.shadowed + ")");
  ok(s.lighter && s.still, f.id + ": Lighter home on, the focused tile still");
  // the focus moves along the apps with no shadow behind the ring
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400);
  const ring = await page.evaluate(() => { const x = document.querySelector(".cw.cw-focus"); return x ? getComputedStyle(x).boxShadow : "none"; });
  ok(ring === "none", f.id + ": no shadow behind the focus ring (" + ring + ")");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, f.id + ".png") });
  await page.close();
}
// Shadow None is what does it: the same bare clock without it keeps its soft shadow
const bare = { v: 1, background: { colour: "#f1ede4" }, objects: [{ id: "clock", type: "widget", kind: "clock", size: "wide", x: 380, y: 60, w: 1160, h: 360, opts: { date: false }, style: { panel: "none" } }],
  grid: { on: true, v: 2, items: { "obj:clock": { c: 3, r: 0, size: "wide" } }, order: ["obj:clock"], placed: { "obj:clock": { c: 3, r: 0, w: 12, h: 4, size: "wide" } } } };
const p2 = await open(bare);
ok((await look(p2)).shadowed > 0, "a bare clock without Shadow None keeps its own soft shadow");
await p2.close();

ok(!errors.length, "no page errors (" + errors.join(" | ") + ")");
await browser.close();
server.close();
console.log("All " + n + " Fast TV browser tests passed.");
