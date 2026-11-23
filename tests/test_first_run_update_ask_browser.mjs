// The update question and the first-run welcome (owner's TCL test, 23 Nov 2026): "Tell you when a new Couch TV
// version is out?" popped up over the home about 5 s after the first open. Now:
//  1. While the welcome is up the question never shows, however long the TV waits.
//  2. Answering the welcome (Use Couch Original, or a design code) does not bring it up straight after.
//  3. It comes at a calm later moment: the next time the home comes back to the front, or the next start.
//  4. A TV that never had the welcome (an update, a set up TV) is asked as before, once the home is up.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_first_run_update_ask_browser.mjs
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STORE = "https://designs.example";
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html?mock=1&place=Your+town&update=ask&designstore=" + encodeURIComponent(STORE);
const FRESH = HOME + "&ontv=1&firstrun=1";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(STORE + "/**", (r) => r.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  const ready = async () => { await page.waitForFunction(() => window.tv && window.CouchDesignCode && window.I18N); await page.waitForTimeout(900); };
  const freshTv = async (url, before) => {
    await page.goto(ORIGIN + "/tv-home/web/qr.js");
    await page.evaluate((b) => { localStorage.clear(); sessionStorage.clear(); for (const k in (b || {})) localStorage.setItem(k, b[k]); }, before || null);
    await page.goto(url || FRESH); await ready();
  };
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 200); };
  const welcome = () => page.evaluate(() => { const w = document.getElementById("welcome"); return !!w && w.classList.contains("on"); });
  const updAsk = () => page.evaluate(() => { const p = document.getElementById("gear-pop"); return !!p && p.classList.contains("on") && p.classList.contains("ask") && /new Couch TV version/.test(p.textContent); });
  // the home going behind an app and coming back (what the launcher and the on-TV app do on Home)
  const awayAndBack = async () => {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  // 1. the welcome is up: no update question over it, even after the time it took on the TCL and more
  await freshTv();
  ok(await welcome(), "a fresh TV opens on the welcome");
  await page.waitForTimeout(6500);
  ok(await welcome() && !(await updAsk()), "6.5 s later the welcome is still alone (no update question over it)");

  // 2. Use Couch Original: not straight after either
  await press("ArrowRight"); await press("Enter", 500);
  ok(!(await welcome()), "Use Couch Original closes the welcome");
  await page.waitForTimeout(6000);
  ok(!(await updAsk()), "and the update question does not pop up straight after it");
  ok(await page.evaluate(() => !!document.querySelector("#grid .app")), "the home is there, calm");

  // 3. the next time the home comes back: asked then, once, after a short calm moment
  await awayAndBack();
  await page.waitForTimeout(500);
  ok(!(await updAsk()), "not the instant the home is back");
  await page.waitForFunction(() => { const p = document.getElementById("gear-pop"); return p.classList.contains("ask") && p.classList.contains("on"); }, null, { timeout: 6000 });
  ok(await updAsk(), "asked on the next home open");
  await press("Enter", 500);
  ok(!(await updAsk()), "answered: it goes");
  await awayAndBack(); await page.waitForTimeout(3500);
  ok(!(await updAsk()), "and never comes back on later home opens");

  // the next start also counts as later: a reload after the welcome was answered asks once the home is up
  await freshTv();
  await press("Escape", 500);   // Back on the welcome: Couch Original
  ok(!(await welcome()), "Back answers the welcome");
  await page.waitForTimeout(3500);
  ok(!(await updAsk()), "no question straight after Back either");
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById("gear-pop").classList.contains("ask"), null, { timeout: 8000 });
  ok(await updAsk() && !(await welcome()), "the next start asks it, with no welcome");

  // a design code instead: Home settings opens, still no question over it or after it
  await freshTv();
  await press("Enter", 500);
  await page.waitForTimeout(4000);
  ok(!(await updAsk()) && await page.evaluate(() => document.getElementById("settings").classList.contains("on")), "I have a design code: Home settings, no update question");
  await press("Escape", 300); await press("Escape", 300); await press("Escape", 300);
  await awayAndBack();
  await page.waitForFunction(() => document.getElementById("gear-pop").classList.contains("ask"), null, { timeout: 8000 });
  ok(await updAsk(), "back on the home later: asked then");

  // a reload while the welcome is still unanswered: still never over it
  await freshTv();
  await page.reload(); await ready();
  await page.waitForTimeout(4000);
  ok(await welcome() && !(await updAsk()), "a reload with the welcome due: still no question over it");
  await awayAndBack(); await page.waitForTimeout(3500);
  ok(await welcome() && !(await updAsk()), "nor when the home comes back with the welcome still up");

  // 4. no welcome on this TV (set up before): asked as before, once the home is up
  await freshTv(FRESH, { "mock:tvhome.apps.seen": JSON.stringify(["com.netflix.ninja"]) });
  ok(!(await welcome()), "a TV set up before: no welcome");
  await page.waitForFunction(() => document.getElementById("gear-pop").classList.contains("ask"), null, { timeout: 8000 });
  ok(await updAsk(), "and the update question comes as it always did");

  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} first-run update question browser tests passed.`);
