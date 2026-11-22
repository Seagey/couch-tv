// The Night home's date line stays with the scene's clock (living room TV, 23 Nov 2026): with four quick
// buttons at the top right and the weather place on the line, the date on the Night and Golden scenes
// slid left to make room for the buttons, off the clock's centre and onto the people switch. Now it never
// slides sideways: when the top bar has no room for it, the date and the scene's clock move down together
// under the top bar. Checked in a real browser at the TV's 1280x720 page size, every built in scene, with
// a two person switch and with the head icon (three people), in the plain, glass and Lighter homes:
//  1. a centred clock: the date's centre is the clock's centre (and the screen's), within 2 px;
//     a clock at the side (Fog): the date starts at the clock's own left edge (the scene's 0.5rem inset);
//  2. the date line touches neither the people switch nor the quick buttons;
//  3. the date sits above the clock's digits, and the glass digits still show the photo from where they sit.
// Shots go to $SHOTS (default: the system temp folder, couchtv-date-centre).
// Needs Playwright. Without it, it says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_date_centre_browser.mjs
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

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "couchtv-date-centre");
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
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const SCENES = ["night", "golden", "water", "fog", "dawn"];
const LOOKS = [["plain", "", [2, 3]], ["glass", "&glass=on", [2]], ["lighter", "&lighter=1", [2]]];
console.log("Running date line centre browser tests...");
for (const [look, extra, peopleCounts] of LOOKS) for (const people of peopleCounts) for (const s of SCENES) {
  const id = look + ", " + people + " people, " + s;
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&people=" + people + "&quick=sleep,picture,soundscape,input&picture=1&wx=18,2&place=Riverside&scenes=" + s + extra);
  await page.waitForFunction(() => window.tv && /Riverside/.test(document.getElementById("date").textContent) && document.querySelector("#scenes .scene.on .gclock .fill"));
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const box = (r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width });
    const d = document.getElementById("date"), line = box(d.firstChild.getBoundingClientRect());
    const c = document.querySelector("#scenes .scene.on .gclock:not(.under)"), f = c.querySelector(".fill");
    // the digits themselves: the fill span's box, less the 0.2em padding it carries above and below
    const fr = f.getBoundingClientRect(), pad = parseFloat(getComputedStyle(f).paddingTop) || 0;
    const people = box(document.getElementById("people").getBoundingClientRect());
    const q = box(document.getElementById("qbtns").getBoundingClientRect());
    const hit = (a) => a.w > 0 && line.l < a.r && line.r > a.l && line.t < a.b && line.b > a.t;
    const bp = f.style.backgroundPosition.split(" ").map(parseFloat);
    // the words themselves (in the glass look the line is a pill, its padding may reach the digits, as before)
    const textBottom = line.b - (parseFloat(getComputedStyle(d.firstChild).paddingBottom) || 0);
    return { line, textBottom, clock: box(c.getBoundingClientRect()), align: getComputedStyle(c).textAlign, digitsTop: fr.top + pad,
      hitP: hit(people), hitQ: hit(q), sideways: !!(d.style.left || d.style.right), w: innerWidth,
      fillY: bp[1], wantY: -(c.offsetTop + f.offsetTop), liquid: document.documentElement.classList.contains("clock-liquid") };
  });
  const dc = (m.line.l + m.line.r) / 2, cc = (m.clock.l + m.clock.r) / 2;
  if (m.align === "left") ok(Math.abs(m.line.l - (m.clock.l + m.w / 120 * 0.5)) <= 3, id + ": the date starts at the side clock's left edge (" + m.line.l + " vs " + m.clock.l + ")");
  else {
    ok(Math.abs(dc - cc) <= 2, id + ": the date is centred over the clock (" + dc + " vs " + cc + ")");
    ok(Math.abs(dc - m.w / 2) <= 2, id + ": and on the screen's centre (" + dc + ")");
  }
  ok(!m.sideways, id + ": the date was not moved sideways");
  ok(!m.hitP, id + ": the date does not touch the people switch " + JSON.stringify(m.line));
  ok(!m.hitQ, id + ": the date does not touch the quick buttons " + JSON.stringify(m.line));
  ok(m.textBottom <= m.digitsTop + 2, id + ": the date sits above the clock's digits (" + m.textBottom + " vs " + m.digitsTop + ")");
  if (!m.liquid) ok(Math.abs(m.fillY - m.wantY) <= 1, id + ": the glass digits show the photo from where they sit (" + m.fillY + " vs " + m.wantY + ")");
  await page.screenshot({ path: path.join(SHOTS, look + "-" + people + "-" + s + ".png") });
}
{ // the scenes taking turns: from Night (date and clock moved down) to Waterline (room in the top bar) and back
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&people=2&quick=sleep,picture,soundscape,input&picture=1&wx=18,2&place=Riverside&scenes=night,water&secs=3");
  await page.waitForFunction(() => window.tv && /Riverside/.test(document.getElementById("date").textContent) && document.querySelector("#scenes .scene.on .gclock .fill"));
  const seen = {};
  for (let i = 0; i < 24 && Object.keys(seen).length < 2; i++) {
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const d = document.getElementById("date"), r = d.firstChild.getBoundingClientRect();
      const sc = (/\bscene-(\w+)/.exec(document.documentElement.className) || [])[1];
      return { sc, swap: d.classList.contains("swap"), c: (r.left + r.right) / 2, drop: getComputedStyle(document.documentElement).getPropertyValue("--date-drop").trim() };
    });
    if (!m.swap && m.sc) seen[m.sc] = m;
  }
  ok(seen.night && seen.water, "both scenes came round " + JSON.stringify(seen));
  ok(Math.abs(seen.night.c - 640) <= 2 && Math.abs(seen.water.c - 640) <= 2, "the date stays centred as the scenes take turns " + JSON.stringify(seen));
  ok(parseFloat(seen.night.drop) > 0 && parseFloat(seen.water.drop) === 0, "only Night moves down; Waterline has room and stays where it was " + JSON.stringify(seen));
}
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
server.close();
console.log("Date line centre browser tests passed (" + n + " checks)");
