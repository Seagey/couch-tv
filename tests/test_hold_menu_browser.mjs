// Launch audit, 24 Nov 2026 (coord/LAUNCH-AUDIT-TV.md, SHOULD 2 and 5), in a real browser at 1920x1080:
//  1. Hold OK on an app in a folder on a Studio design with a big clock behind it: the title and the hint are on
//     screen, every row is on screen, the menu is solid (nothing of the clock shows through), and it lists "All apps"
//     once, with no "Open Apps" beside it;
//  2. the gear's Settings menu on the on-TV app has Phone remote (its QR and code), which opens the app's own
//     Phone remote screen; a TV home without that screen does not list it.
// COUCHTV_PLAYWRIGHT=<folder with Playwright> node tests/test_hold_menu_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm" };
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
const fails = [];
const ok = (c, m) => { if (c) n++; else { fails.push(m); console.log("FAIL " + m); } };
const browser = await chromium.launch();

// a design like Couch Night: a big clock across the middle, and an app folder over it
const design = { v: 1, background: { colour: "#26303f" }, objects: [
  { id: "c", type: "widget", kind: "clock", x: 560, y: 160, w: 800, h: 480, opts: {} },
  { id: "f", type: "widget", kind: "folder", x: 1300, y: 660, w: 560, h: 360, opts: { label: "Apps", apps: ["youtube", "netflix", "stan", "iview"] } }
] };

try {
  // ---- 1. the hold OK menu
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
    await page.goto(BASE + "?mock=1&design=local");
    await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="f"] .cw') && window.CouchDesign && window.CouchDesign.nav);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.CouchDesign.nav.focus("f", 0));
    await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const s = document.querySelector(".cw-sheet"); if (!s) return null;
      const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const rows = [...s.querySelectorAll(".cw-mi")];
      const alpha = (c) => { const x = /rgba?\(([^)]+)\)/.exec(c); if (!x) return 0; const p = x[1].split(",").map(Number); return p.length > 3 ? p[3] : 1; };
      // what is on top in the middle of each row: the row itself (or something inside it), never the clock
      const onTop = rows.map((r) => { const b = r.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width * 0.6, b.top + b.height / 2); return !!e && r.contains(e); });
      return { items: rows.map((r) => r.textContent), title: box(s.querySelector("h2")), hint: s.querySelector(".cw-hint:not(.cw-note)") ? box(s.querySelector(".cw-hint:not(.cw-note)")) : null,
        rows: rows.map(box), sheetAlpha: alpha(getComputedStyle(s).backgroundColor), rowAlpha: rows.map((r) => alpha(getComputedStyle(r).backgroundColor)), onTop, menu: s.classList.contains("cw-msheet") };
    });
    ok(m, "Hold OK opens the menu");
    if (m) {
      ok(m.menu, "the menu sheet is marked as a menu (cw-msheet)");
      ok(m.items.filter((x) => x === "All apps").length === 1, "All apps once (" + m.items.join(", ") + ")");
      ok(!m.items.some((x) => /^Open Apps$/.test(x)), "no Open Apps beside All apps (" + m.items.join(", ") + ")");
      ok(m.items.length >= 6, "the app's own items are there (" + m.items.length + ")");
      ok(m.title.top >= 0 && m.title.bottom <= 1080, "the title is on screen (" + JSON.stringify(m.title) + ")");
      ok(m.hint && m.hint.top >= 0 && m.hint.bottom <= 1080 && m.hint.left >= 0 && m.hint.right <= 1920, "the hint is on screen (" + JSON.stringify(m.hint) + ")");
      ok(m.rows.every((r) => r.top >= 0 && r.bottom <= 1080), "every row is on screen");
      ok(m.sheetAlpha === 1, "the menu's backdrop is solid (alpha " + m.sheetAlpha + ")");
      ok(m.rowAlpha.every((a) => a === 1), "every row is solid (" + m.rowAlpha.join(",") + ")");
      ok(m.onTop.every(Boolean), "each row is on top, the clock never over it (" + m.onTop.join(",") + ")");
    }
    // a 9 row menu still fits: Edit on your phone and Open ... on a widget with its own page as well
    ok(errors.length === 0, "no page errors (" + errors.join(" | ") + ")");
    await page.close();
  }

  // ---- 2. Phone remote in the gear menu
  for (const withScreen of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    if (withScreen) await page.addInitScript(() => { window.TVOS = { apps: () => "[]", openPhoneRemote: () => { window.phoneOpened = (window.phoneOpened || 0) + 1; return true; } }; });
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "?mock=1");
    await page.waitForFunction(() => window.tv && document.querySelector("#shelf"));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(400);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#gear-pop .grow")].map((r) => r.querySelector("b").textContent));
    const label = withScreen ? "on-TV app" : "no phone remote screen";
    ok(rows.length >= 2 && rows[0] === "Home settings", label + ": the gear menu opens (" + rows.join(", ") + ")");
    if (withScreen) {
      const i = rows.indexOf("Phone remote");
      ok(i > 0, label + ": Phone remote is in the gear menu");
      ok(/Scan a code/.test(await page.evaluate(() => document.querySelector("#gear-pop").textContent)), label + ": with what it is for");
      for (let k = 0; k < i; k++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
      await page.keyboard.press("Enter"); await page.waitForTimeout(400);
      ok((await page.evaluate(() => window.phoneOpened)) === 1, label + ": OK on it opens the app's Phone remote screen");
      ok(!(await page.evaluate(() => document.querySelector("#gear-pop").classList.contains("on"))), label + ": the menu closes");
    } else ok(rows.indexOf("Phone remote") < 0, label + ": no Phone remote where there is no screen for it");
    ok(errors.length === 0, label + ": no page errors (" + errors.join(" | ") + ")");
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? "FAILED " + fails.length + ", passed " + n : "hold menu and gear: " + n + " checks passed");
process.exit(fails.length ? 1 : 0);
