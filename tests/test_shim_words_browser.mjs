// The on-TV phone remote's pairing box (on-tv/web/shim.js) in the phone remote's language (Fable 0814 item 4):
// Server.kt adds tv-home/web/phone-words.js with data-manual next to shim.js, and shim.js asks it for each
// line and for the TV's English answers (j.error). The remote's own words are never swapped on screen.
//   1. The remote set to Polish (tv.lang): heading, buttons, aria-label, the TV's 429 lock answer, a wrong code.
//   2. The remote following the TV (tv.lang auto) on a German TV (tv.lang.tv): German.
//   3. Nothing chosen, an English phone: English, as written.
// A pretend TV answers /api/*. Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_shim_words_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
// the tags Server.kt puts first in the remote's <head>: this test serves exactly those
const kt = fs.readFileSync(path.join(ROOT, "on-tv/android/app/src/main/java/dev/couchtv/ontv/Server.kt"), "utf8");
const TAG = '<script src="/tv/phone-words.js" data-manual></script><script src="/ontv/shim.js"></script>';
ok(kt.includes(TAG.replace(/"/g, '\\"')), "Server.kt adds phone-words.js (data-manual) next to shim.js");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
const file = (res, f, type) => {
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": type }); fs.createReadStream(f).pipe(res);
};
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const json = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html><head>" + TAG + "<meta charset=\"utf-8\"></head><body><p id=\"app\">Pair this phone</p></body></html>"); return; }
  if (p === "/tv/phone-words.js") return file(res, path.join(ROOT, "tv-home/web/phone-words.js"), "text/javascript");
  if (p === "/ontv/shim.js") return file(res, path.join(ROOT, "on-tv/web/shim.js"), "text/javascript");
  if (p === "/api/pair/start") { res.writeHead(429, { "content-type": "application/json", "Retry-After": "600" }); res.end(JSON.stringify({ ok: false, error: "Too many wrong codes. Wait 10 min, then try again.", retry_after: 600 })); return; }
  if (p === "/api/pair") return json({ ok: false, error: "That code is not right. Check the TV." }, 401);
  if (p === "/api/health") return json({ ok: true, auth: "required" });
  return json({ ok: false, error: "pair this phone first" }, 401);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
async function box(locale, store) {
  const ctx = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((s) => { try { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) { } }, store);
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/");
  await page.waitForSelector("#ctv-pair");
  const read = () => page.evaluate(() => ({ h1: document.querySelector("#ctv-pair h1").textContent, p: document.querySelector("#ctv-pair p").textContent,
    go: document.getElementById("ctv-go").textContent, ask: document.getElementById("ctv-ask").textContent,
    aria: document.getElementById("ctv-pin").getAttribute("aria-label"), msg: document.getElementById("ctv-msg").textContent,
    app: document.getElementById("app").textContent }));
  return { ctx, page, read };
}
try {
  // 1. Polish, chosen in the remote's menu
  let b = await box("en-AU", { "tv.lang": "pl" });
  let r = await b.read();
  ok(r.h1 === "Sparuj ten telefon", "heading in Polish: " + r.h1);
  ok(r.go === "Sparuj" && /Pokaż kod/.test(r.ask), "buttons in Polish: " + r.go + " | " + r.ask);
  ok(r.aria === "Kod z telewizora", "aria-label in Polish: " + r.aria);
  ok(!/Type the 6 digit/.test(r.p), "the line under it in Polish: " + r.p);
  ok(r.app === "Pair this phone", "the remote's own words are left alone (no swapping on screen)");
  await b.page.click("#ctv-ask"); await b.page.waitForTimeout(400);
  r = await b.read();
  ok(/10 min/.test(r.msg) && !/Too many wrong codes/.test(r.msg) && /kodów/.test(r.msg), "the TV's lock answer in Polish, with its minutes: " + r.msg);
  await b.page.fill("#ctv-pin", "123"); await b.page.click("#ctv-go");
  r = await b.read();
  ok(r.msg === "Kod ma 6 cyfr.", "a short code in Polish: " + r.msg);
  await b.page.fill("#ctv-pin", "123456"); await b.page.click("#ctv-go"); await b.page.waitForTimeout(400);
  r = await b.read();
  ok(r.msg.length > 0 && r.msg !== "That code is not right. Check the TV.", "a wrong code answer in Polish: " + r.msg);
  ok(b.page.errors.length === 0, "no page errors: " + b.page.errors.join(" | "));
  await b.ctx.close();
  // 2. the remote follows the TV (auto), the TV is German
  b = await box("en-AU", { "tv.lang": "auto", "tv.lang.tv": "de" });
  r = await b.read();
  ok(r.h1 === "Dieses Handy koppeln" && r.go === "Koppeln", "following a German TV: " + r.h1 + " | " + r.go);
  await b.ctx.close();
  // 3. nothing chosen, an English phone: as written
  b = await box("en-AU", {});
  r = await b.read();
  ok(r.h1 === "Pair this phone" && r.go === "Pair" && r.aria === "Code from the TV", "English stays English");
  await b.page.click("#ctv-ask"); await b.page.waitForTimeout(400);
  ok((await b.read()).msg === "Too many wrong codes. Wait 10 min, then try again.", "the TV's answer as it came");
  ok(b.page.errors.length === 0, "no page errors in English");
  await b.ctx.close();
} finally {
  await browser.close();
  server.close();
}
console.log("shim words: " + n + " checks passed");
