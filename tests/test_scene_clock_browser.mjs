// Couch TV Studio's Couch Original in a real browser at 1920x1080 (mock.js standing in for the bridge):
// a design with no background and elements.clock.at "scene" draws the Night home as it is with no design.
//  1. each built in scene keeps its own clock place: Night's clock behind the peak (the cut out in front of
//     it), Waterline's clock on the water with its blurred reflection under the waterline;
//  2. a design without at: "scene" still puts the clock in one place (11.5rem from the top);
//  3. one scene picked (home.scenes) shows only that one; none picked, the five take turns;
//  4. Keep watching hidden by the design is not drawn; the dock is one row along the bottom.
// Shots go to $SHOTS (default: the system temp folder, couchtv-scene-clock).
// Needs Playwright. Without it, it says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_scene_clock_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "couchtv-scene-clock");
fs.mkdirSync(SHOTS, { recursive: true });
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
const ok = (c, m) => { assert.ok(c, m); n++; console.log("  ok", m); };
const browser = await chromium.launch();

// Couch Original, as Couch TV Studio's template writes it
const original = (extra = {}, kwHidden = false) => Object.assign({
  v: 1, home: { dock: "classic" },
  elements: { clock: { at: "scene", behind: true }, ...(kwHidden ? { keep_watching: { hidden: true } } : {}) }
}, extra);
async function home(design) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.documentElement.classList.contains("cd") && !!document.querySelector("#scenes .scene.on .gclock .fill"));
  await page.waitForTimeout(1500);
  return page;
}
const look = (page) => page.evaluate(() => {
  const on = document.querySelector("#scenes .scene.on"), c = on.querySelector(".gclock:not(.under)"), u = on.querySelector(".gclock.under"), fg = on.querySelector(".fg");
  const box = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), width: Math.round(r.width) }; };
  const apps = [].slice.call(document.querySelectorAll("#grid > .app")).filter((a) => a.offsetParent);
  const shelf = document.getElementById("shelf-section");
  return {
    scene: (/\bs-([a-z]+)\b/.exec(on.className) || [])[1], scenes: document.querySelectorAll("#scenes .scene").length,
    clock: box(c), clockZ: getComputedStyle(c).zIndex, fgZ: fg ? getComputedStyle(fg).zIndex : null, fgShown: !!(fg && fg.src && getComputedStyle(fg).display !== "none"),
    // the cut out comes after the clock in the scene, so it paints over it unless a z-index lifts the clock
    fgAfter: !!(fg && (c.compareDocumentPosition(fg) & Node.DOCUMENT_POSITION_FOLLOWING)),
    under: u ? { clip: u.style.clipPath, shown: getComputedStyle(u).display !== "none", op: getComputedStyle(u).opacity, filter: getComputedStyle(u).filter } : null, overClip: c.style.clipPath,
    date: box(document.getElementById("date")),
    rows: apps.map((a) => Math.round(a.getBoundingClientRect().top)).filter((t, i, a) => a.indexOf(t) === i).length, apps: apps.length,
    dockBottom: apps.length ? Math.round(apps[0].getBoundingClientRect().bottom) : 0,
    shelf: !!(shelf && shelf.offsetParent && getComputedStyle(shelf).visibility !== "hidden")
  };
});

console.log("Running Couch Original (clock in each scene's own place) browser tests...");

{ // 1. Night: the clock where the Night scene puts it, behind the peak
  const page = await home(original({ home: { dock: "classic", scenes: ["night"] } }));
  const s = await look(page);
  ok(s.scene === "night" && s.scenes === 1, "one scene picked: only Night (" + s.scene + ", " + s.scenes + ")");
  ok(Math.abs(s.clock.top - 150) <= 2, "Night's own clock place, 150 px from the top (the home with no design), got " + s.clock.top);
  ok(s.fgShown && s.fgAfter && s.clockZ === "auto" && s.fgZ === "auto", "the peak's cut out is drawn over the clock (" + JSON.stringify([s.fgShown, s.fgAfter, s.clockZ, s.fgZ]) + ")");
  ok(s.rows === 1 && s.apps >= 10 && s.dockBottom > 980, "the dock is one long row along the bottom (" + s.apps + " apps, " + s.rows + " row, bottom " + s.dockBottom + ")");
  ok(s.shelf, "Keep watching shows when the design leaves it on");
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "couch-original-night.png") });
  await page.close();
}
{ // 2. Waterline: on the water, with the reflection under the waterline
  const page = await home(original({ home: { dock: "classic", scenes: ["water"] } }, true));
  const s = await look(page);
  ok(s.scene === "water", "Waterline picked");
  ok(Math.abs(s.clock.top - 268) <= 2, "Waterline's own clock place, 268 px from the top, got " + s.clock.top);
  const line = Math.round(1080 * 0.55);
  ok(s.clock.top < line && s.clock.bottom > line, "the digits cross the waterline at " + line + " px (" + s.clock.top + " to " + s.clock.bottom + ")");
  ok(s.under && s.under.shown && /inset\(\d/.test(s.under.clip) && /blur/.test(s.under.filter), "the blurred reflection shows under the waterline " + JSON.stringify(s.under));
  ok(/inset/.test(s.overClip), "the sharp clock is cut at the waterline");
  ok(!s.shelf, "Keep watching hidden by the design is not drawn");
  ok(!page.errors.length, "no page errors " + page.errors.join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "couch-original-water.png") });
  await page.close();
}
{ // 3. none picked: the five take turns
  const page = await home(original());
  const s = await look(page);
  ok(s.scenes === 5, "no scene picked: the five scenes take turns (" + s.scenes + ")");
  await page.screenshot({ path: path.join(SHOTS, "couch-original-turns.png") });
  await page.close();
}
{ // 4. without at: "scene" a design keeps one place (what older templates and TVs do)
  const page = await home({ v: 1, home: { scenes: ["water"] }, elements: { clock: { behind: true } } });
  const s = await look(page);
  ok(Math.abs(s.clock.top - 184) <= 2, "a design without it keeps the clock in one place, 184 px, got " + s.clock.top);
  await page.close();
}
await browser.close();
server.close();
console.log("Couch Original browser tests passed (" + n + " checks)");
