// Glass words (style.ink "glass", owner approved 24 Nov 2026), in a real browser: the TV home in its ?mock preview at
// 1920x1080 draws a design with Text colour Glass.
//  1. on a dark or colour box: .cw-ink-glass, see through white words (--ink alpha under 1) with a light top edge;
//  2. on paper (where Auto picks dark words): .cw-ink-smoke, see through dark words;
//  3. Auto and White are untouched: no glass class, solid words;
//  4. a slower TV (html.lighter, html.glass-lite) draws them solid: white for glass with one cheap shadow, dark for
//     smoke with none; taking the class off brings the glass back.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_glass_text_browser.mjs
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

const w = (id, kind, x, y, style) => ({ id, type: "widget", kind, x, y, w: 360, h: 360, style });
const design = { v: 1, background: { colour: "#26303f" }, objects: [
  w("g", "clock", 80, 60, { panel: "glass", ink: "glass" }),
  w("c", "clock", 480, 60, { panel: "colour", colour: "#5b2a86", ink: "glass" }),
  w("p", "clock", 880, 60, { panel: "paper", ink: "glass" }),
  w("a", "clock", 1280, 60, { panel: "glass" }),
  w("wh", "clock", 80, 460, { panel: "glass", ink: "white" })
] };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelectorAll(".cw-o .cw").length >= 5);
  await page.waitForTimeout(500);
  const read = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".cw-o[data-obj]").forEach((o) => {
      const cw = o.querySelector(".cw"); if (!cw) return;
      const cs = getComputedStyle(cw);
      const inner = cw.querySelector(".cw-bg ~ *") || cw.lastElementChild || cw;
      out[o.getAttribute("data-obj")] = { cls: cw.className, ink: cs.getPropertyValue("--ink").trim(), color: cs.color, shadow: cs.textShadow, innerShadow: getComputedStyle(inner).textShadow };
    });
    return out;
  });
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return /^#fff$|^#1d1b18$/i.test(c) ? 1 : NaN; const p = m[1].split(","); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const html = (cls, on) => page.evaluate(([c, v]) => document.documentElement.classList.toggle(c, v), [cls, on]);
  await html("lighter", false); await html("glass-lite", false);
  let s = await read();

  // 1 and 2: glass on dark and colour boxes, smoke on paper
  ok(/\bcw-ink-glass\b/.test(s.g.cls) && !/cw-ink-smoke/.test(s.g.cls), "a glass box gets glass words");
  ok(/\bcw-ink-glass\b/.test(s.c.cls), "a dark colour box gets glass words (" + s.c.cls + ")");
  ok(/\bcw-ink-smoke\b/.test(s.p.cls) && !/cw-ink-glass/.test(s.p.cls), "paper gets smoked glass words");
  ok(alpha(s.g.ink) < 1 && /255, 255, 255/.test(s.g.ink), "glass words are see through white (" + s.g.ink + ")");
  ok(alpha(s.p.ink) < 1 && /18, 18, 24/.test(s.p.ink), "smoked words are see through dark (" + s.p.ink + ")");
  ok(alpha(s.g.color) < 1, "the words themselves are drawn see through (" + s.g.color + ")");
  ok(/rgba\(255, 255, 255, 0\.5\) 0px -1px 0px/.test(s.g.shadow) && s.g.innerShadow === s.g.shadow, "glass words have a light top edge, inside too");
  ok(/rgba\(255, 255, 255, 0\.75\) 0px 1px 0px/.test(s.p.shadow), "smoked words have a light edge under");

  // 3: Auto and White unchanged
  ok(!/cw-ink-(glass|smoke)/.test(s.a.cls) && !/cw-ink-(glass|smoke)/.test(s.wh.cls), "Auto and White never get the glass classes");
  ok(alpha(s.wh.color) === 1, "White words stay solid");

  // 4: a slower TV draws them solid, and the glass comes back after
  for (const cls of ["lighter", "glass-lite"]) {
    await html(cls, true);
    s = await read();
    ok(s.g.color === "rgb(255, 255, 255)" && s.c.color === "rgb(255, 255, 255)", "html." + cls + ": glass words are solid white (" + s.g.color + ")");
    ok(/0px 2px 6px/.test(s.g.shadow) && !/0px -1px 0px/.test(s.g.shadow), "html." + cls + ": glass words keep one cheap shadow (" + s.g.shadow + ")");
    ok(s.p.color === "rgb(29, 27, 24)", "html." + cls + ": smoked words are solid dark (" + s.p.color + ")");
    ok(s.p.shadow === "none" && s.p.innerShadow === "none", "html." + cls + ": smoked words lose their shadow");
    await html(cls, false);
  }
  s = await read();
  ok(alpha(s.g.color) < 1 && /0px -1px 0px/.test(s.g.shadow), "off the slower TV classes, the glass is back");
  ok(errors.length === 0, "no page errors (" + errors.join(" | ") + ")");
} finally {
  await browser.close();
  server.close();
}
console.log("OK: " + n + " checks");
