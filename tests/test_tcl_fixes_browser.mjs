// What a real beginner hit on a TCL Android TV with couch-tv 0.13.3 (19 Nov 2026), checked in a real
// browser at 1920x1080 (the TV home in its ?mock preview, the same page the TV runs), with the remote's keys:
//  1. Turn on Couch TV Studio said "Couch TV Studio is on" while the row above still said "Off" and the
//     button "Turn on". The rows now follow the choice at once, both ways.
//  2. The TV's keyboard dropped a letter from a design code typed fast ("rstfd-5een"). The box shows
//     the code as ABCDE-FGHJK and how many letters are in while typing, and OK shows a big Check page
//     first: a short code says one letter is missing and goes back to the box with it in; a whole code,
//     typed in any case with no dash, is sent as RSTFD-5EEDN at once: the TV's own "Use this design?"
//     is the one question (a second Check page made two confirmations for one choice, launch audit 0.13.9).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_tcl_fixes_browser.mjs
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
const STORE = "https://designs.example";
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?mock=1&designstore=" + encodeURIComponent(STORE);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const asked = [];
  await page.route(STORE + "/**", (r) => { asked.push(r.request().postData() || ""); r.fulfill({ status: 404, contentType: "application/json", body: "{}" }); });
  await page.goto(BASE + "&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.waitForFunction(() => window.tv && window.CouchDesigner && window.CouchDesignCode);
  await page.waitForTimeout(800);
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
  const focused = () => page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");
  const rowsText = () => page.evaluate(() => document.getElementById("set-rows").textContent);
  const msg = () => page.evaluate(() => document.getElementById("set-msg").textContent);
  const head = () => page.evaluate(() => document.getElementById("set-head").textContent);
  const studioValue = () => page.evaluate(() => { const r = [...document.querySelectorAll("#set-rows .srow")].find((x) => (x.querySelector("b") || {}).textContent === "Designs"); return r ? ((r.querySelector(".sv") || {}).textContent || "") : null; });
  const toRow = async (re) => { for (let i = 0; i < 40; i++) { if (re.test(await focused())) return true; await press("ArrowDown", 120); } return false; };

  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press("Enter", 400);   // the gear menu, then Home settings
  for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown");
  await press("ArrowRight");

  // 1. the Studio row follows the switch at once
  ok(await studioValue() === "Off", "before: the row says Off");
  ok(await toRow(/^Turn on designs/), "a Turn on row");
  await press("Enter", 300);
  ok(/Designs are on/.test(await msg()), "it says designs are on");
  let rows = await rowsText();
  ok(await studioValue() !== "Off" && !/Turn on designs/.test(rows), "and the row no longer says Off or Turn on (" + rows.slice(0, 120) + ")");
  ok(/No design on this TV yet/.test(rows), "the switch says there is no design yet, at once");
  ok(await toRow(/^Designs/), "the Designs switch");
  await press("Enter", 300);
  rows = await rowsText();
  ok(await studioValue() === "Off" && /Turn on designs/.test(rows), "switched off: the row says Off again at once");
  ok(await toRow(/^Turn on designs/), "Turn on again"); await press("Enter", 300);

  // 2. a design code, typed with a letter dropped, then right
  ok(await toRow(/^Get a design/), "a Get a design row");
  await press("Enter", 300);
  ok(/dash is not needed/.test(await page.evaluate(() => document.getElementById("set-type-label").textContent)), "the box says the dash is not needed");
  await page.fill("#set-input", "rstfd-5een");
  ok(/^RSTFD-5EEN\s+9 of 10 letters$/.test(await page.evaluate(() => document.getElementById("set-type-check").textContent)), "while typing: the code as ABCDE-FGHJK and 9 of 10 letters");
  await press("Enter", 400);
  ok(/Check the code/.test(await head()), "OK shows the Check page");
  ok(asked.length === 0, "nothing was sent for a short code");
  const big = await page.evaluate(() => [...document.querySelectorAll(".scode-big i:not(.dash)")].map((x) => x.textContent).join(""));
  ok(big === "RSTFD5EEN", "the code is shown big, a box per letter (" + big + ")");
  const boxH = await page.evaluate(() => document.querySelector(".scode-big i").getBoundingClientRect().height);
  ok(boxH >= 70, "big enough to read from the couch (" + boxH + " px high)");
  ok(/9 of the 10 letters/.test(await rowsText()) && /One is missing/.test(await rowsText()), "it says a letter is missing");
  ok(/^Type it again/.test(await focused()), "focus is on Type it again");
  ok(!/Yes, get this design/.test(await rowsText()), "no way to send a short code");
  await press("Enter", 400);
  ok(await page.evaluate(() => document.getElementById("set-type").classList.contains("on") && document.getElementById("set-input").value === "rstfd-5een"), "back in the box, with what was typed in it");
  await page.fill("#set-input", "rstfd5eedn");
  ok(/^RSTFD-5EEDN\s+all 10 letters$/.test(await page.evaluate(() => document.getElementById("set-type-check").textContent)), "no dash, lower case: shown as RSTFD-5EEDN, all 10 letters");
  await press("Enter", 800);
  ok(!/Check the code/.test(await head()), "a whole code: no second Check page");
  ok(asked.length === 1 && JSON.parse(asked[0]).code === "RSTFD-5EEDN", "OK sends the code as RSTFD-5EEDN (" + asked[0] + ")");
  ok(/That code did not work/.test(await msg()), "and the store's answer is said in plain words");
  ok(!/Check the code/.test(await head()), "and the Check page is gone");
  await press("Escape", 250);
  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} TCL beginner fixes browser tests passed.`);
