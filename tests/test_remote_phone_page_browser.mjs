// The phone remote's More sheet in a real browser (the built remote/dist, a pretend home computer):
// a bridge whose /api/health says phone_page shows Home settings on this phone and Widgets on this TV,
// one link per widget with settings, each to /setup#widget=<id>; one that does not say it shows neither.
// Needs remote/dist (npm run build in remote/) and Playwright (Chromium). Without Playwright it passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_remote_phone_page_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "remote", "dist");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.log("SKIP: no remote/dist (npm run build in remote/)"); process.exit(0); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const VIEW = { ok: true, live: true, athome: { design: { on: true, widgets: [
  { key: "w1|weather", kind: "weather", name: "Weather", title: "Weather, top right", settings: [{ key: "place", type: "place", shown: true }] },
  { key: "w2|clock", kind: "clock", name: "Clock", title: "Clock, top left", settings: [{ key: "secs", type: "toggle", shown: false }] },
  { key: "w4|commute", kind: "commute", name: "Commute", title: "Commute, bottom", settings: [{ key: "to", type: "place" }] },
] } } };
let phonePage = true, athomeAsked = 0, twoTvs = false, athomeTv = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.pathname === "/api/health") return json({ ok: true, auth: "ok", paired: true, tv_connected: true, phone_page: phonePage });
  if (u.pathname === "/api/athome") { athomeAsked++; athomeTv.push(u.searchParams.get("tv")); return json(VIEW); }
  if (u.pathname === "/api/config") return json({ ok: true, people: [{ id: "sam", name: "Sam" }] });
  if (u.pathname === "/api/tvs") return json({ ok: true, tvs: twoTvs ? [{ id: "lounge", name: "Lounge", default: true, tv_connected: true }, { id: "bedroom", name: "Bedroom", tv_connected: true }] : [] });
  if (u.pathname.startsWith("/api/")) return json({ ok: true });
  const f = path.join(DIST, u.pathname === "/" ? "index.html" : path.normalize(decodeURIComponent(u.pathname)));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
try {
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
    await page.goto(BASE);
    await page.evaluate(() => { localStorage.setItem("tv.who", "sam"); localStorage.setItem("tv.lang", "en"); });
    await page.goto(BASE + "#sheet=more");
    await page.reload();   // a hash-only goto keeps the page: load it again so the app reads #sheet=more
    await page.waitForTimeout(1800);
    return page;
  };
  // a home computer that serves the page
  let page = await open();
  const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href^='/setup']")).map((a) => [a.getAttribute("href"), a.textContent.trim()]));
  ok(links.some(([h, txt]) => h === "/setup" && /Home settings on this phone/.test(txt)), "Home settings on this phone shows for a bridge with the page: " + JSON.stringify(links));
  ok(await page.evaluate(() => /Widgets on this TV/.test(document.body.innerText)), "Widgets on this TV heading");
  ok(links.some(([h, txt]) => h === "/setup#widget=w1" && txt === "Weather, top right"), "the weather widget links to its box");
  ok(links.some(([h, txt]) => h === "/setup#widget=w4" && txt === "Commute, bottom"), "the commute widget links to its box");
  ok(!links.some(([h]) => h === "/setup#widget=w2"), "a widget with nothing that shows has no link");
  ok(athomeAsked >= 1, "the widgets came from /api/athome");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  // in another language: the heading is translated
  await page.evaluate(() => localStorage.setItem("tv.lang", "de"));
  await page.goto(BASE + "#sheet=more"); await page.reload(); await page.waitForTimeout(1800);
  ok(await page.evaluate(() => /Widgets auf diesem Fernseher/.test(document.body.innerText)), "German: Widgets auf diesem Fernseher");
  await page.close();
  // two TVs on one computer (Fable 4): the phone drives the bedroom TV, so its links open the bedroom TV's page
  twoTvs = true; athomeTv = [];
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.setItem("tv.who", "sam"); localStorage.setItem("tv.lang", "en"); localStorage.setItem("tv.tv", "bedroom"); });
  await page.goto(BASE + "#sheet=more"); await page.reload(); await page.waitForTimeout(1800);
  const two = await page.evaluate(() => Array.from(document.querySelectorAll("a[href^='/setup']")).map((a) => a.getAttribute("href")));
  ok(two.includes("/setup?tv=bedroom"), "second TV: Home settings on this phone opens /setup?tv=bedroom: " + JSON.stringify(two));
  ok(two.includes("/setup?tv=bedroom#widget=w1") && two.includes("/setup?tv=bedroom#widget=w4"), "second TV: each widget link names the bedroom TV");
  ok(!two.some((h) => h === "/setup" || h.startsWith("/setup#")), "second TV: no link to the default TV's page");
  ok(athomeTv.includes("bedroom"), "second TV: its widgets came from the bedroom TV's At home");
  ok(page.errors.length === 0, "second TV: no page errors: " + page.errors.join(" | "));
  await page.close();
  twoTvs = false;
  // a home computer without the page: neither shows, and /api/athome is never asked
  phonePage = false; athomeAsked = 0;
  page = await open();
  const none = await page.evaluate(() => document.querySelectorAll("a[href^='/setup']").length);
  ok(none === 0, "no phone page: no links (" + none + ")");
  ok(athomeAsked === 0, "no phone page: the widgets are not asked for");
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log("remote phone page browser: " + n + " checks passed");
