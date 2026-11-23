// The standard home's top line ("<town> · moon 21° · Mostly clear") on a widget design (emulator test of 0.13.10):
// with a design that has no date or weather parts of its own, the line a design copies out of the date
// (#cd-weather) was drawn over a 460 x 260 smart stack and ran behind a Wi-Fi tile, and stayed there. In
// widget mode the design's widgets are the home and the home's own parts step aside (widgets.css): the date,
// the clock and Keep watching did, and now the weather line does too.
//  1. the emulator's design (two stacks, two Wi-Fi tiles, a dock): no top line drawn, none over a widget;
//  2. the same design with its widgets taken out (no widget mode): the line is back, as on any design.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_wmode_top_line_browser.mjs
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

// the emulator's test design (code 2C3BR-XHM7Z): no elements at all, so no date or weather part of its own
const STACKS = { v: 1, background: { colour: "#1d3a5f" }, objects: [
  { id: "st1", type: "widget", kind: "stack", x: 80, y: 80, w: 360, h: 160, items: [{ kind: "weather" }, { kind: "clock" }] },
  { id: "st2", type: "widget", kind: "stack", x: 520, y: 80, w: 460, h: 260, items: [{ kind: "weather" }, { kind: "clock" }] },
  { id: "wf", type: "widget", kind: "wifi", x: 1080, y: 80, w: 160, h: 160 },
  { id: "wf2", type: "widget", kind: "wifi", x: 1300, y: 80, w: 260, h: 160 },
  { id: "apps", type: "widget", kind: "dock", x: 480, y: 860, w: 960, h: 160, start: true, opts: { apps: ["youtube"] } }] };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const open = async (d) => {
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate((x) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(x)); }, d);
    await page.goto(BASE + "?mock=1&design=local&place=Ballarat&wx=21,1");
    await page.waitForFunction(() => window.CouchDesign && window.CouchDesign.on() && document.getElementById("cd-weather"));
    // the weather comes in, and the 10 s the emulator waited
    await page.waitForFunction(() => /\d°/.test(document.getElementById("cd-weather").textContent), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
  };
  // the top line's drawn words, and the widget boxes they land on
  const line = () => page.evaluate(() => {
    const el = document.getElementById("cd-weather"), cs = getComputedStyle(el);
    const span = el.querySelector("span") || el, r = document.createRange();
    r.selectNodeContents(span);
    const boxes = [].slice.call(r.getClientRects()).filter((b) => b.width > 2 && b.height > 2);
    const drawn = cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0 && boxes.length > 0;
    const widgets = [].slice.call(document.querySelectorAll(".cd-o.cw-o")).map((w) => w.getBoundingClientRect()).filter((b) => b.width > 4);
    const over = boxes.filter((b) => widgets.some((w) => b.right > w.left && b.left < w.right && b.bottom > w.top && b.top < w.bottom)).length;
    return { drawn, over, text: el.textContent.trim(), wmode: document.documentElement.classList.contains("cd-wmode"), widgets: widgets.length };
  });

  // 1. the emulator's design
  await open(STACKS);
  let L = await line();
  ok(L.wmode && L.widgets >= 4, "the design is in widget mode with its widgets drawn (" + JSON.stringify(L) + ")");
  ok(/Ballarat/.test(L.text), "the weather line has its words (" + L.text + "), so it would show if drawn");
  ok(!L.drawn, "but the home's top line is not drawn on a widget design (" + JSON.stringify(L) + ")");
  ok(L.over === 0 || !L.drawn, "nothing of it over a stack or a Wi-Fi tile");
  await page.waitForTimeout(8500);
  L = await line();
  ok(!L.drawn, "still not drawn 10 s later (" + JSON.stringify(L) + ")");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector("header.top")).visibility === "hidden"), "as the date and the rest of the top step aside");

  // 2. the same design with no widgets: not widget mode, the line shows as on any design
  await open({ v: 1, background: { colour: "#1d3a5f" }, objects: [] });
  L = await line();
  ok(!L.wmode && L.drawn && /Ballarat/.test(L.text), "a design with no widgets still shows the top line (" + JSON.stringify(L) + ")");

  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} widget design top line browser tests passed.`);
