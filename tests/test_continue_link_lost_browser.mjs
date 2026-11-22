// Keep watching when the home computer has lost its link to the TV (22 Nov 2026, a real Google TV:
// adb's port 5555 closed after a restart). The bridge now answers POST /api/continue/open at once with
// err_tv_link_lost; the TV home then opens the card's app, as it always did when the bridge could not
// help, and this time also says how to fix the link (tBridge, in the TV's language). Any other failure
// still opens the app and clears the "Opening ..." line, as before.
// In a real browser at 1920x1080, the home in its ?mock preview with a stand in for the TV's own
// bridge (window.TVOS) that only records which app it was asked to open.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_continue_link_lost_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?mock=1";

let n = 0;
const fails = [];
const ok = (c, m) => { if (c) { n++; return; } fails.push(m); console.log("FAIL " + m); };
const EN = "Couch TV lost its link to this TV. On the TV, switch Network debugging off and on in Developer options.";

const browser = await chromium.launch();
// how the bridge answers continue/open: "lost" (err_tv_link_lost), "other" (another error), "ok"
async function run(answer, lang) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__launched = [];
    window.TVOS = { launch: function (pkg) { window.__launched.push(pkg); return true; } };
  });
  await page.goto(BASE + "&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "&look=classic" + (lang ? "&lang=" + lang : ""));
  await page.waitForFunction(() => window.tv && document.querySelector("#shelf > *"));
  await page.waitForTimeout(700);
  if (lang) await page.evaluate((l) => window.I18N && window.I18N.set && window.I18N.set(l), lang);
  await page.evaluate((answer) => {
    const real = window.MOCK_API;
    window.__asked = [];
    window.MOCK_API = function (m, p, b) {
      if (p.indexOf("/api/continue/open") === 0) {
        window.__asked.push(b);
        if (answer === "lost") {
          const e = new Error("Couch TV lost its link to this TV. On the TV, switch Network debugging off and on in Developer options.");
          e.key = "err_tv_link_lost";
          return Promise.reject(e);
        }
        if (answer === "other") { const e = new Error("could not find Ozark"); e.key = "err_title_not_found"; return Promise.reject(e); }
      }
      return real.apply(this, arguments);
    };
  }, answer);
  const card = await page.evaluate(() => {
    const el = document.querySelector("#shelf > *");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(card.x, card.y, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.click(card.x, card.y);
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => ({ asked: window.__asked.length, launched: window.__launched.slice(), status: document.getElementById("status").textContent }));
  got.errors = errors;
  await page.close();
  return got;
}

try {
  const lost = await run("lost");
  ok(lost.asked === 1, "lost: the card asks the bridge once (" + lost.asked + ")");
  ok(lost.launched.length === 1 && !!lost.launched[0], "lost: the card's app opens (" + JSON.stringify(lost.launched) + ")");
  ok(lost.status === EN, "lost: the home says how to fix the link (" + lost.status + ")");
  ok(!/[–—]/.test(lost.status) && !/Beta|Experimental|coming soon/i.test(lost.status), "lost: plain words");
  ok(lost.errors.length === 0, "lost: no page errors (" + lost.errors.join(" | ") + ")");

  const other = await run("other");
  ok(other.launched.length === 1, "another error: the app still opens (" + JSON.stringify(other.launched) + ")");
  ok(other.status === "", "another error: the Opening line is cleared, as before (" + other.status + ")");
  ok(other.errors.length === 0, "another error: no page errors (" + other.errors.join(" | ") + ")");

  const fine = await run("ok");
  ok(fine.asked === 1 && fine.launched.length === 0, "a good answer: the bridge opens the show, the home opens no app (" + JSON.stringify(fine.launched) + ")");
  ok(fine.errors.length === 0, "a good answer: no page errors (" + fine.errors.join(" | ") + ")");

  const de = await run("lost", "de");
  ok(/^Couch TV hat die Verbindung zu diesem Fernseher verloren\./.test(de.status), "German: the words come in the TV's language (" + de.status + ")");
  ok(de.launched.length === 1, "German: the app opens");
} finally {
  await browser.close();
  server.close();
}
if (fails.length) { console.log(fails.length + " failed"); process.exit(1); }
console.log("continue link lost browser: " + n + " checks passed");
