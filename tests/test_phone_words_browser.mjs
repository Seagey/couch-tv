// The phone pages in the TV's language (tv-home/web/phone-words.js), in a real browser:
//   1. Home settings on the phone (on-tv/web/setup.html) before pairing, on a Polish phone: the pairing box
//      (on-tv/web/shim.js) in Polish.
//   2. Paired, the TV's Home settings language Polish: headings, a paragraph with Android's names in bold,
//      a line with gaps, the page's lang.
//   3. The TV's language Arabic: right to left, lang ar, Arabic words.
//   4. The Home Assistant set up page (ha-phone.html) opened from the TV's QR with ?l=pl: Polish.
//   5. The widget settings words (caps-words.js): a line added there reads in the language on the phone
//      page and on the TV home (tv-words.js), with widget-caps.js untouched.
// A pretend TV answers /api/*. Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_words_browser.mjs
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };
let tvLang = "pl";
const file = (res, f) => {
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const p = decodeURIComponent(u.pathname);
  if (p === "/setup") return file(res, path.join(ROOT, "on-tv/web/setup.html"));
  if (p.startsWith("/ontv/")) return file(res, path.join(ROOT, "on-tv/web", path.normalize(p.slice(6))));
  if (p === "/ha/" || p === "/ha") return file(res, path.join(ROOT, "tv-home/web/ha-phone.html"));
  if (p.startsWith("/ha/api/")) return json({ ok: false, error: "expired" }, 403);
  if (p.startsWith("/ha/")) return file(res, path.join(ROOT, "tv-home/web", path.normalize(p.slice(4))));
  if (p.startsWith("/tv/")) return file(res, path.join(ROOT, "tv-home/web", path.normalize(p.slice(4))));
  const auth = /Bearer good/.test(req.headers.authorization || "");
  if (p === "/api/health") return json({ ok: true, mode: "on-tv", auth: auth ? "ok" : "required", phone_page: true });
  if (p.startsWith("/api/") && !auth) return json({ ok: false, error: "pair this phone first" }, 401);
  if (p === "/api/settings") return json({ ok: true, settings: { lang: tvLang, photos: [] }, tv_name: "Lounge", country: "AU", ask: { enabled: false }, photos_max: 12 });
  if (p === "/api/athome") return json({ ok: true, live: false });
  if (p === "/api/home") return json({ ok: true, on: false });
  if (p === "/api/adb") return json({ ok: true, connected: false, state: "off" });
  if (p === "/api/update") return json({ ok: true, current: "0.13.9", latest: "0.13.9", checked: true });
  if (p.startsWith("/api/")) return json({ ok: true });
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
try {
  // 1. not paired yet, a Polish phone: the pairing box in Polish
  let ctx = await browser.newContext({ locale: "pl-PL", viewport: { width: 390, height: 844 } });
  let page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/setup");
  await page.waitForSelector("#ctv-pair"); await page.waitForTimeout(400);
  const box = await page.evaluate(() => document.getElementById("ctv-pair").innerText);
  ok(/Sparuj ten telefon/.test(box) && !/Pair this phone/.test(box), "the pairing box in Polish: " + box.replace(/\n/g, " | ").slice(0, 160));
  ok(await page.evaluate(() => document.documentElement.lang === "pl" && document.documentElement.dir === "ltr"), "lang pl, left to right");
  ok(await page.evaluate(() => document.getElementById("ctv-pin").getAttribute("aria-label")) !== "Code from the TV", "an aria-label is translated too");
  await ctx.close();

  // 2. paired, the TV in Polish (an English phone follows the TV)
  ctx = await browser.newContext({ locale: "en-AU", viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("couchtv.token", "good"); } catch (e) {} });
  page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/setup");
  await page.waitForTimeout(1500);
  const pl = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, h1: document.querySelector("h1") && document.querySelector("h1").textContent, body: document.body.innerText,
    careful: Array.from(document.querySelectorAll("li")).map((l) => l.innerHTML).filter((h) => /Revoke USB debugging authorizations/.test(h))[0] || "" }));
  ok(pl.lang === "pl", "the page follows the TV's language: " + pl.lang);
  ok(pl.title === "Ustawienia ekranu głównego", "the title in Polish: " + pl.title);
  ok(/Miejscowość dla pogody/.test(pl.body) && !/Town for the weather/.test(pl.body), "a heading in Polish");
  ok(/^Uwaga: <b>Revoke USB debugging authorizations<\/b>/.test(pl.careful), "Android's own name stays in bold in a Polish paragraph: " + pl.careful.slice(0, 120));
  const gap = await page.evaluate(() => window.PhoneWords.words("3 of 12 photos on the TV."));
  ok(gap === "Zdjęcia na telewizorze: 3 z 12.", "a line with gaps keeps the numbers: " + gap);
  // anything drawn later is swapped as it is drawn
  const later = await page.evaluate(async () => { const d = document.createElement("p"); d.textContent = "Saving…"; document.body.appendChild(d); await new Promise((r) => setTimeout(r, 50)); const t = d.textContent; d.remove(); return t; });
  ok(later !== "Saving…" && later.length > 0, "a message drawn later is in Polish: " + later);
  const left = await page.evaluate(() => {
    const en = ["Home settings", "Town for the weather", "Your photos", "Let the phone press keys", "Kids mode", "Couch TV version", "Forget every phone", "Smart home", "Show all settings"];
    return en.filter((s) => Array.from(document.querySelectorAll("h1,h2,h3,button,label,a,summary")).some((e) => e.offsetParent && e.textContent.trim() === s));
  });
  ok(left.length === 0, "no English heading or button left on show: " + left.join(", "));
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));

  // 3. the TV in Arabic: right to left
  tvLang = "ar";
  await page.reload(); await page.waitForTimeout(1500);
  if (await page.evaluate(() => document.documentElement.lang) !== "ar") { await page.reload(); await page.waitForTimeout(1500); }
  const ar = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, body: document.body.innerText, align: getComputedStyle(document.querySelector("h2")).direction }));
  ok(ar.lang === "ar" && ar.dir === "rtl", "Arabic: lang ar, dir rtl (" + ar.lang + ", " + ar.dir + ")");
  ok(ar.align === "rtl", "headings read right to left");
  ok(ar.title === "إعدادات الرئيسية", "the title in Arabic: " + ar.title);
  ok(/مدينة الطقس/.test(ar.body) && !/Town for the weather/.test(ar.body), "a heading in Arabic");
  ok(page.errors.length === 0, "no page errors in Arabic: " + page.errors.join(" | "));

  // 5a. a widget settings word added to caps-words.js reads in the language on the phone page
  const capsPhone = await page.evaluate(async () => {
    window.CouchCapsWords.words["Units"] = { ar: "الوحدات", pl: "Jednostki" };
    const d = document.createElement("label"); d.textContent = "Units"; document.body.appendChild(d);
    await new Promise((r) => setTimeout(r, 50)); const t = d.textContent; d.remove(); return t;
  });
  ok(capsPhone === "الوحدات", "a caps-words line on the phone page: " + capsPhone);
  await ctx.close();

  // 4. the Home Assistant page from the TV's QR, ?l=pl
  ctx = await browser.newContext({ locale: "en-AU", viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/ha/?k=abc&l=pl");
  await page.waitForTimeout(1200);
  const ha = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, body: document.body.innerText }));
  ok(ha.lang === "pl" && ha.title === "Inteligentny dom na twoim telewizorze", "the Home Assistant page in Polish: " + ha.title);
  ok(/Ten link wygasł/.test(ha.body), "its run out line in Polish");
  ok(page.errors.length === 0, "no page errors on the Home Assistant page: " + page.errors.join(" | "));
  await ctx.close();

  // 5b. the same caps-words line on the TV home (tv-words.js)
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/tv/index.html?mock=1&reset=1");
  await page.waitForFunction(() => window.tv && window.CouchCapsWords && window.CouchTvWords);
  const capsTv = await page.evaluate(async () => {
    window.I18N.set("pl");
    window.CouchCapsWords.words["Units"] = { pl: "Jednostki" };
    const d = document.createElement("b"); d.className = "cw-tip"; d.textContent = "Units"; document.body.appendChild(d);
    await new Promise((r) => setTimeout(r, 50)); const t = d.textContent; d.remove(); return t;
  });
  ok(capsTv === "Jednostki", "the same caps-words line on the TV home: " + capsTv);
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
console.log("phone words: " + n + " checks passed");
