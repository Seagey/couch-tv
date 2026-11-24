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

  // 5. Liquid glass words (style.ink "liquid"): over a photo the letters are clear and show the scene's frosted
  // copy, lined up with the screen; on paper smoked glass; over a plain colour, frosted Glass words; a slower TV
  // or a 1 GB TV draws frosted (then solid) words instead.
  const night = { v: 1, background: { image: "backgrounds/scene-night.jpg", darken: 0.28 }, objects: [
    w("l", "tallclock", 80, 60, { panel: "none", ink: "liquid" }),
    w("lg", "clock", 480, 60, { panel: "glass", ink: "liquid" }),
    w("lp", "clock", 880, 60, { panel: "paper", ink: "liquid" }),
    w("ls", "clock", 1280, 60, { panel: "solid", ink: "liquid" })
  ] };
  async function liquidPage(d, mem) {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    p.errs = [];
    p.on("pageerror", (e) => p.errs.push(String(e)));
    if (mem) await p.addInitScript((m) => Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => m, configurable: true }), mem);
    await p.goto(BASE + "?mock=1&reset=1");
    await p.evaluate((x) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(x)); }, d);
    await p.goto(BASE + "?mock=1&design=local");
    await p.waitForFunction(() => document.querySelectorAll(".cw-o .cw").length >= 4);
    await p.evaluate(() => { document.documentElement.classList.remove("lighter", "glass-lite"); });
    await p.waitForTimeout(2000);   // the 1.5 s second look for the photo
    return p;
  }
  const lread = (p) => p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".cw-o[data-obj]").forEach((o) => {
      const cw = o.querySelector(".cw"); if (!cw) return;
      const kid = [].find.call(cw.children, (k) => !k.classList.contains("cw-bg")) || cw, ks = getComputedStyle(kid);
      out[o.getAttribute("data-obj")] = { cls: cw.className, img: cw.style.getPropertyValue("--lq-img"), bg: ks.backgroundImage, clip: ks.webkitBackgroundClip || ks.backgroundClip,
        fill: ks.webkitTextFillColor, stroke: ks.webkitTextStrokeWidth, attach: ks.backgroundAttachment, filter: ks.filter, color: getComputedStyle(cw).color };
    });
    return out;
  });
  let lp = await liquidPage(night);
  let L = await lread(lp);
  ok(/\bcw-ink-liquid\b/.test(L.l.cls) && /\bcw-lq-on\b/.test(L.l.cls) && /\bcw-lq-on\b/.test(L.lg.cls), "liquid glass on a bare and a glass box over a photo");
  ok(/scene-night-glass\.jpg/.test(L.l.img) && /scene-night-glass\.jpg/.test(L.l.bg), "through the letters: the night scene's frosted copy (" + L.l.img + ")");
  ok(/^text(, text)*$/.test(L.l.clip) && L.l.fill === "rgba(0, 0, 0, 0)" && L.l.stroke === "1px", "letters are clear, clipped to the photo, with a 1 px rim " + JSON.stringify(L.l));
  ok(/fixed/.test(L.l.attach), "the photo is lined up with the screen, not the widget");
  ok(/drop-shadow/.test(L.l.filter), "a shadow under the glass letters");
  ok(/\bcw-ink-smoke\b/.test(L.lp.cls) && !/cw-lq-on/.test(L.lp.cls), "on paper: smoked glass words, no photo through them");
  ok(/\bcw-ink-glass\b/.test(L.ls.cls) && !/cw-lq-on/.test(L.ls.cls) && L.ls.fill !== "rgba(0, 0, 0, 0)", "on a solid box: frosted Glass words");
  for (const cls of ["lighter", "glass-lite"]) {
    await lp.evaluate((c) => document.documentElement.classList.add(c), cls);
    L = await lread(lp);
    ok(L.l.fill !== "rgba(0, 0, 0, 0)" && !/text/.test(L.l.clip) && L.l.color === "rgb(255, 255, 255)", "html." + cls + ": liquid glass words drawn solid white, no photo clip (" + L.l.fill + ", " + L.l.color + ")");
    await lp.evaluate((c) => document.documentElement.classList.remove(c), cls);
  }
  L = await lread(lp);
  ok(L.l.fill === "rgba(0, 0, 0, 0)" && /^text/.test(L.l.clip), "off the slower TV classes, liquid glass is back");
  ok(lp.errs.length === 0, "liquid: no page errors (" + lp.errs.join(" | ") + ")");
  await lp.close();

  lp = await liquidPage(night, 1);
  L = await lread(lp);
  ok(/\bcw-ink-liquid\b/.test(L.l.cls) && !/cw-lq-on/.test(L.l.cls) && /\bcw-ink-glass\b/.test(L.l.cls), "a 1 GB TV: frosted Glass words instead");
  await lp.close();

  lp = await liquidPage(Object.assign({}, night, { background: { colour: "#26303f" } }));
  L = await lread(lp);
  ok(!/cw-lq-on/.test(L.l.cls) && /\bcw-ink-glass\b/.test(L.l.cls), "over a plain colour: frosted Glass words (no photo to see)");
  await lp.close();
} finally {
  await browser.close();
  server.close();
}
console.log("OK: " + n + " checks");
