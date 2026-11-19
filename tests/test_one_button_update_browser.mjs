// One button update on the on-TV app (20 Nov 2026, the owner at a real TCL: "There is so much information
// I will forget what I have to do"). Checked in a real browser at 1920x1080 on the TV home's ?mock preview:
//  1. With its own ADB link the app installs the update itself: Home settings, Updates has one
//     "Update to ..." button, no Downloader steps; OK downloads, installs, and the version moves on.
//  2. Without the link: the steps stay, with a QR code that opens the same steps on a phone.
//  3. A try that fails (short of space): a plain line, then the steps and the QR code.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_one_button_update_browser.mjs
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
const HELP = "https://couchtv.joshuaseage.com/help/update-couch-tv/";

const browser = await chromium.launch();
async function updates(kind) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "?mock=1&ontv=1&update=" + kind);
  await page.waitForFunction(() => window.tv && document.getElementById("date") && document.getElementById("date").textContent.length > 0);
  await page.waitForTimeout(800);
  await page.evaluate(() => { const p = document.getElementById("gear-pop"); if (p && p.classList.contains("ask")) window.MOCK_UPDATER.auto(true); });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  for (let i = 0; i < 20 && !(await page.evaluate(() => /Updates/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  return page;
}
const rows = (page) => page.evaluate(() => document.getElementById("set-rows").textContent);
const focused = (page) => page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");

{ // 1. it installs by itself
  const page = await updates("ontv-self");
  const r = await rows(page);
  ok(/Update to 0\.4/.test(r), "one Update to button (" + r.slice(0, 200) + ")");
  ok(/Downloads it, checks it and installs it\. Your settings stay\./.test(r), "with one short line under it");
  ok(!/Downloader/.test(r) && !/8180170/.test(r), "and no Downloader steps to remember");
  ok(!(await page.evaluate(() => !!document.querySelector(".sqr"))), "and no QR code");
  ok(/Nothing is installed until you choose Update/.test(r), "the note says nothing installs by itself");
  ok(/^Update to 0\.4/.test(await focused(page)), "the focus starts on it");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Downloading… \d+%/.test(document.getElementById("set-rows").textContent), null, { timeout: 4000 });
  ok(true, "OK: Downloading… with a percentage");
  await page.waitForFunction(() => /Installing\. Couch TV closes and opens again by itself\./.test(document.getElementById("set-rows").textContent), null, { timeout: 6000 });
  ok(true, "then Installing, and that it opens again by itself");
  await page.waitForFunction(() => /This is the latest version\./.test(document.getElementById("set-rows").textContent), null, { timeout: 6000 });
  const done = await rows(page);
  ok(/Version0\.4/.test(done.replace(/\s/g, "")) && !/Update to/.test(done), "then done: version 0.4, no button (" + done.slice(0, 160) + ")");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}

{ // 2. no ADB link: the steps, and a QR code for them
  const page = await updates("ontv");
  const r = await rows(page);
  ok(/Downloader/.test(r) && /8180170/.test(r), "the steps stay");
  ok(!/Update to 0\.4/.test(r), "no Update to button that could not work");
  const qr = await page.evaluate(() => { const q = document.querySelector(".sqr"); return q && { url: q.querySelector("[data-qr]").getAttribute("data-qr"), svg: !!q.querySelector("svg"), words: q.textContent, h: q.getBoundingClientRect().height }; });
  ok(qr && qr.url === HELP && qr.svg, "a QR code for the help page (" + JSON.stringify(qr) + ")");
  ok(qr && qr.words === "Scan to keep these steps on your phone.", "with one short line");
  ok(qr && qr.h > 150, "big enough to scan from the couch");
  ok(/^Check for updates now/.test(await focused(page)), "the QR code takes no focus: the first button is Check for updates now");
  // the drawn code is the help page's own QR (qr.js, checked by decoding in tools/tv-designer/server/tests/qr.test.mjs)
  ok(await page.evaluate((u) => { const s = document.querySelector(".sqr svg"); return window.TVQR.matrix(u).length >= 21 && s.outerHTML === window.TVQR.svg(u, 240).outerHTML; }, HELP), "the drawn code is that address's QR matrix");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}

{ // 3. short of space: a plain line, then the steps and the QR code
  const page = await updates("ontv-space");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /short of space/.test(document.getElementById("set-rows").textContent), null, { timeout: 9000 });
  const r = await rows(page);
  ok(/Not installed: the TV is short of space\. Nothing changed\./.test(r), "a plain line says why (" + r.slice(-300) + ")");
  ok(/Downloader/.test(r) && (await page.evaluate(() => !!document.querySelector(".sqr svg"))), "then the steps and the QR code");
  ok(!/Update to 0\.4/.test(r), "and no button that just failed");
  ok(!page.errors.length, "no page errors (" + page.errors.join(" | ") + ")");
  await page.close();
}

// the words: plain, no dashes, no Beta
{
  const src = fs.readFileSync(path.join(ROOT, "tv-home/web/app.js"), "utf8");
  for (const k of ["upd_err_space", "upd_err_adb", "upd_self_sub", "upd_installing_self", "upd_done", "upd_note_self", "upd_qr"]) {
    const m = src.match(new RegExp("\\b" + k + ': "([^"]*)"'));
    ok(m && !/[–—]/.test(m[1]) && !/beta|experimental|coming soon/i.test(m[1]), k + " is plain words (" + (m && m[1]) + ")");
  }
}

await browser.close();
server.close();
console.log("one button update browser tests passed (" + n + " checks)");
