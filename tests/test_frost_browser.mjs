// Lane L (28 Nov 2026): Couch Original faster on slow TVs, looking the same. In a real browser at 1920x1080 (the TV
// home in its ?mock preview, Couch Original and the stock Night home):
//  - frost.js draws the dock's glass once, and the Keep watching cards' too (owner approved 28 Nov 2026) and the live blur is off, and the drawn
//    glass matches the live glass pixel by pixel (to within a few levels at the rounded corners);
//  - the glint on the focused tile slides by a transform and gives the same pixels as the old background move;
//  - the live blur comes back while a scene fades, under Lighter home, and is never used in the Classic look.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_frost_browser.mjs
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
const Q = "mock=1&people=2&quick=sleep,look,input&wx=24,2&place=Bellingen";
const COUCH_ORIGINAL = { v: 1, home: { dock: "classic" }, elements: { clock: { at: "scene", behind: true } } };
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log("ok", m); };

const browser = await chromium.launch(Object.assign({ args: ["--force-color-profile=srgb", "--disable-gpu"] }, process.env.COUCHTV_CHANNEL ? { channel: process.env.COUCHTV_CHANNEL } : {}));
const errors = [];

async function open(design, query, cards) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.setFixedTime(new Date("2026-11-28T19:42:00"));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); if (d) localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?" + Q + (design ? "&design=local" : "") + "&" + query);
  await page.waitForFunction(() => document.querySelector("#grid .app"), null, { timeout: 30000 });
  return { ctx, page };
}
// pixels of one box, and how two such shots differ
const shot = (page, box) => page.screenshot({ clip: box, animations: "allow" });
async function differ(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    const px = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const p = px(x), q = px(y);
    let sum = 0, over8 = 0, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
      sum += d; if (d > 8) over8++; if (d > max) max = d;
    }
    const n = p.length / 4;
    return { mean: sum / n, over8: over8 / n, max };
  }, [a.toString("base64"), b.toString("base64")]);
}
const pauseAll = (page, at) => page.evaluate((at) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = at; }), at);

for (const [label, design, cards] of [["Couch Original", COUCH_ORIGINAL, true], ["the stock Night home", null, true]]) {
  const { ctx, page } = await open(design, "scene=night", cards);
  await page.waitForFunction(() => document.documentElement.classList.contains("frost"), null, { timeout: 20000 });
  ok(true, label + ": the glass is drawn once (html.frost)");
  const st = await page.evaluate(() => ({ grid: document.getElementById("grid").classList.contains("fz"), bf: getComputedStyle(document.getElementById("grid")).backdropFilter,
    cards: [...document.querySelectorAll("#shelf .ncard")].map((c) => c.classList.contains("fz")),
    box: (() => { const r = document.getElementById("grid").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })(),
    kw: (() => { const r = document.getElementById("shelf").getBoundingClientRect(); return { x: r.left, y: r.top, width: Math.min(r.width, 1800), height: r.height }; })() }));
  ok(st.grid && st.bf === "none", label + ": the dock shows the drawn glass, with no live blur");
  if (cards) ok(st.cards.length > 0 && st.cards.every(Boolean), label + ": so do the Keep watching cards");
  else ok(st.cards.length > 0 && !st.cards.some(Boolean), label + ": the Keep watching cards keep the live blur");
  await pauseAll(page, 1500);
  const drawnDock = await shot(page, st.box), drawnKw = await shot(page, st.kw);
  await page.evaluate(() => window.CouchFrost.off());
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("grid")).backdropFilter !== "none"), label + ": off() brings the live blur back");
  const liveDock = await shot(page, st.box), liveKw = await shot(page, st.kw);
  for (const [what, a, b] of [["dock", drawnDock, liveDock], ["Keep watching", drawnKw, liveKw]]) {
    const d = await differ(page, a, b);
    console.log("  " + label + ", " + what + ": mean " + d.mean.toFixed(3) + ", over 8 levels " + (d.over8 * 100).toFixed(3) + "%, max " + d.max);
    ok(d.mean < 1 && d.over8 < 0.002, label + ": the " + what + " looks the same drawn as live (under 1 level of 255 on average, under 0.2% of pixels over 8 levels)");
  }
  await ctx.close();
}

// the glint: the same pixels as the old background-position move, at several moments of its 6 s sweep
{
  const { ctx, page } = await open(COUCH_ORIGINAL, "scene=night");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400); await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(600);
  const box = await page.evaluate(() => { const r = document.querySelector(".tile.focus").getBoundingClientRect(); return { x: r.left + 3, y: r.top + 3, width: r.width - 6, height: r.height - 6 }; });
  const an = await page.evaluate(() => { const f = document.querySelector(".tile.focus .face"); return f ? getComputedStyle(f, "::after").animationName + " " + f.parentElement.className + " | face " + getComputedStyle(f).animationName + " | html " + document.documentElement.className + " | mm " + matchMedia("(prefers-reduced-motion: reduce)").matches : "no focus"; });
  ok(/^glint-slide /.test(an), "the focused tile's glint slides by a transform (" + an + ")");
  for (const at of [0, 1500, 3000, 4500]) {
    await page.evaluate(() => document.getElementById("old-glint") && document.getElementById("old-glint").remove());
    await pauseAll(page, at);
    const now = await shot(page, box);
    await page.evaluate(() => { const s = document.createElement("style"); s.id = "old-glint"; s.textContent = "html:not(.zz):not(.old-engine) .face::after{right:0;width:auto;background-size:250% 100%;background-position:100% 0;transform:none} html:not(.zz):not(.old-engine) .tile.focus .face::after{animation-name:glint}"; document.head.appendChild(s); });
    await pauseAll(page, at);
    const old = await shot(page, box);
    const d = await differ(page, now, old);
    ok(d.max <= 12 && d.mean < 1, "glint at " + at + " ms: the same pixels as before (mean " + d.mean.toFixed(3) + ", max " + d.max + " levels of 255)");
  }
  // a scene starting to fade: the live blur at once
  await page.waitForFunction(() => document.documentElement.classList.contains("frost"), null, { timeout: 20000 });
  await page.evaluate(() => { const s = [...document.querySelectorAll("#scenes .scene")]; const on = s.find((e) => e.classList.contains("on")); const next = s.find((e) => e !== on); on.classList.remove("on"); next.classList.add("on"); });
  await page.waitForTimeout(50);
  ok(await page.evaluate(() => !document.documentElement.classList.contains("frost")), "a scene fading in: the live blur");
  // Lighter home: no blur at all, so nothing drawn
  await page.evaluate(() => document.documentElement.classList.add("lighter"));
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !document.documentElement.classList.contains("frost")), "Lighter home: nothing drawn");
  await ctx.close();
}
{
  const { ctx, page } = await open(null, "theme=classic");
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => !document.documentElement.classList.contains("frost") && !document.querySelector(".fz")), "the Classic look: nothing drawn");
  await ctx.close();
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
server.close();
console.log("frost browser tests passed (" + n + " checks)");
