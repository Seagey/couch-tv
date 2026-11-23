// The Couch TV Studio journeys a beginner walked on 0.13.9 (launch audit, 22 Nov 2026,
// coord/AUDIT-0139-STUDIO.md), checked in a real browser at 1920x1080 with the remote's keys (the TV
// home in its ?mock preview, against a pretend design store):
//  1. A whole typed code goes straight to the TV's "Use this design?" (no second Check page), and that
//     question's preview sketches the home's own parts (the clock, the date, Keep watching, the dock),
//     not only the background. Its words no longer say "whoever made it".
//  2. After Use this design the focus shows at once; the first arrow on a calm design only shows the
//     focus; Down on the dock does nothing (it opened More apps by surprise); Back from More apps lands on
//     the More apps tile.
//  3. Designs: one Your design switch and one Delete this design, each row right the moment it is
//     pressed (the banner too), "Brings back your last design" while off, Delete shown while off, Smart
//     home and At home under their own heading.
//  4. Open this home in Couch TV Studio also opens the phone inbox, so the phone's Send to my TV comes
//     straight back to that screen and on to "Use this design?".
//  5. The date line never starts a line with the dot.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_designs_journey_browser.mjs
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
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?mock=1&place=Your+town&designstore=" + encodeURIComponent(STORE);
// a design that only restyles the home's own parts, like Couch Original: no objects at all
const DESIGN = { v: 1, background: { colour: "#203040" }, elements: { clock: { colour: "#ffcc00" } } };
const INBOX_ID = "AbCdEfGhIjKlMnOpQrStUv";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const fetched = [], inbox = [];
  let takeAnswer = { state: "wait" };
  await page.route(STORE + "/**", (r) => {
    const u = r.request().url(), body = r.request().postData() || "";
    const json = (status, j) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(j) });
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
    if (/\/v1\/designs\/fetch$/.test(u)) { fetched.push(JSON.parse(body).code); return json(200, { design: DESIGN }); }
    if (/\/v1\/shares$/.test(u)) return json(200, { code: "K7M2Q-XR4TP", token: "CTV1-" + "a".repeat(43) });
    if (/\/api\/inbox$/.test(u)) {
      const b = JSON.parse(body); inbox.push(b.op);
      if (b.op === "open") return json(200, { id: INBOX_ID, expires_in: 600, poll_every: 3 });
      return json(200, takeAnswer);
    }
    return json(404, {});
  });
  await page.goto(BASE + "&reset=1");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE);
  const ready = async () => { await page.waitForFunction(() => window.tv && window.CouchDesigner && window.CouchDesignCode); await page.waitForTimeout(900); };
  await ready();
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
  const focused = () => page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");
  const rowsText = () => page.evaluate(() => document.getElementById("set-rows").textContent);
  const msg = () => page.evaluate(() => document.getElementById("set-msg").textContent);
  const head = () => page.evaluate(() => document.getElementById("set-head").textContent);
  const rowValue = (label) => page.evaluate((l) => { const r = [...document.querySelectorAll("#set-rows .srow")].find((x) => (x.querySelector("b") || {}).textContent === l); return r ? ((r.querySelector(".sv") || {}).textContent || "") : null; }, label);
  const toRow = async (re) => { for (let i = 0; i < 40; i++) { if (re.test(await focused())) return true; await press("ArrowDown", 120); } return false; };
  const toDesigns = async () => {
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press("Enter", 400);   // the gear menu, then Home settings
    for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown");
    await press("ArrowRight");
  };

  // 5. the date line: every dot stays with the word before it
  const dline = await page.evaluate(() => document.getElementById("date").innerHTML);
  ok(!/ ·/.test(dline) && !/\n·/.test(dline), "no dot after a plain space in the date line (" + dline.slice(0, 160) + ")");
  ok(!/Your\+town/.test(await page.evaluate(() => document.body.textContent)), "a town with a space is not shown as Your+town");

  // 1. a whole code: straight to the question, no Check page
  await toDesigns();
  ok(await toRow(/^Turn on designs/), "with no design kept: Turn on designs");
  ok(await toRow(/^Get a design$|^Get a designType/), "a Get a design row");
  await press("Enter", 300);
  await page.fill("#set-input", "rstfd5eedn");
  await press("Enter", 200);
  ok(!/Check the code/.test(await head()), "a whole code: no Check page");
  ok(fetched.length === 1 && fetched[0] === "RSTFD-5EEDN", "the code is got at once, as RSTFD-5EEDN (" + fetched.join(",") + ")");
  await page.waitForFunction(() => document.querySelector(".cd-ask"), null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const ask = await page.evaluate(() => {
    const box = document.querySelector(".cd-ask");
    return { words: box.textContent, card: (box.lastElementChild || {}).textContent || "", shapes: box.lastElementChild ? box.lastElementChild.querySelectorAll("div").length : 0,
      clock: [...box.querySelectorAll("div")].some((d) => /^\d{1,2}:\d{2}$/.test(d.textContent) && getComputedStyle(d).color === "rgb(255, 204, 0)") };
  });
  ok(/This design came from Couch TV Studio\. Keep my home leaves your TV exactly as it is\./.test(ask.words) && !/whoever made it/.test(ask.words), "the question's words");
  ok(ask.clock, "the preview draws the design's clock, in its colour");
  ok(ask.shapes >= 20, "and the dock's tiles and the Keep watching cards (" + ask.shapes + " parts)");
  ok(/[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+/.test(ask.card), "and the date (" + ask.card.slice(0, 60) + ")");

  // 2. Use this design: the home starts again with the focus showing
  await press("ArrowDown", 200);
  await press("Enter", 200);
  await page.waitForTimeout(1500);
  await ready();
  ok(await page.evaluate(() => document.documentElement.classList.contains("cd") && document.documentElement.classList.contains("cd-keys")), "after Use this design the focus shows at once");
  // a calm start (the next start, no answer just given): the first arrow only shows the focus
  await page.reload(); await ready();
  if (process.env.DEBUG_JOURNEY) console.log(await page.evaluate(() => [document.documentElement.className, [...document.querySelectorAll(".focus")].map((x) => x.className + "|" + (x.getAttribute("data-pkg") || "")).join(" ; ")]));
  const before = await page.evaluate(() => (document.querySelector(".app.focus[data-pkg]") || {}).getAttribute && document.querySelector(".app.focus[data-pkg]").getAttribute("data-pkg"));
  ok(await page.evaluate(() => !document.documentElement.classList.contains("cd-keys")), "a calm start: no focus drawn");
  await press("ArrowRight", 300);
  const after = await page.evaluate(() => document.querySelector(".app.focus[data-pkg]").getAttribute("data-pkg"));
  ok(await page.evaluate(() => document.documentElement.classList.contains("cd-keys")) && before === after, "the first arrow only shows the focus (" + before + " / " + after + ")");
  await press("ArrowDown", 300); await press("ArrowDown", 300);
  ok(await page.evaluate(() => !document.documentElement.classList.contains("expanded")), "Down on the dock does not open More apps");
  const tileNow = () => page.evaluate(() => { const f = document.querySelector(".app.focus[data-pkg]"); return f ? f.getAttribute("data-pkg") : "(" + [...document.querySelectorAll(".focus, .cw-focus")].map((x) => x.className).join(" ; ") + ")"; });
  const seen = [];
  for (let i = 0; i < 30 && (await tileNow()) !== "more"; i++) { seen.push(await tileNow()); await press("ArrowRight", 120); }
  if (process.env.DEBUG_JOURNEY) console.log(seen.join("\n"));
  ok(await page.evaluate(() => document.querySelector(".app.focus[data-pkg]").getAttribute("data-pkg")) === "more", "the More apps tile");
  await press("Enter", 400);
  ok(await page.evaluate(() => document.documentElement.classList.contains("expanded")), "OK opens More apps");
  await press("Escape", 400);
  ok(await page.evaluate(() => !document.documentElement.classList.contains("expanded") && document.querySelector(".app.focus[data-pkg]").getAttribute("data-pkg") === "more"), "Back lands on the More apps tile");

  // 3. Designs with a design kept
  await toDesigns();
  let rows = await rowsText();
  ok(await rowValue("Your design") === "On", "one Your design switch, On");
  ok(/Delete this design/.test(rows) && !/Back to the standard home/.test(rows) && !/Remove the design I got/.test(rows), "Delete this design, and none of the old ways back");
  ok(/This home uses a Couch TV Studio design/.test(rows), "the design banner is there");
  ok(await toRow(/^Your design/), "the switch");
  await press("Enter", 300);
  rows = await rowsText();
  ok(await rowValue("Your design") === "Off" && /Brings back your last design/.test(rows), "Off at once, and it says the design comes back");
  ok(!/This home uses a Couch TV Studio design/.test(rows), "the banner goes at once");
  ok(/Delete this design/.test(rows), "Delete is there while designs are off");
  ok(/^Your design/.test(await focused()), "the focus stays on the switch");
  await press("Enter", 300);
  ok(await rowValue("Your design") === "On" && /Your design comes back when you close Home settings/.test(await msg()), "On again: it says the design comes back");
  ok(await toRow(/^Delete this design/), "the Delete row");
  await press("Enter", 300); await press("Enter", 300);   // asks first (red), then deletes
  rows = await rowsText();
  ok(!/Delete this design/.test(rows) && await rowValue("Designs") === "On" && /No design on this TV yet/.test(rows), "deleted at once: no design kept");
  ok(await page.evaluate(() => !window.CouchDesignCode.kept()), "the kept design is gone");

  // 4. Open this home in Couch TV Studio: the phone's Send comes straight back
  rows = await rowsText();
  ok(!/At home/.test(rows) || rows.indexOf("Smart home and At home") > rows.indexOf("Open this home in Couch TV Studio"), "Smart home and At home sit under their own heading, after the design rows");
  ok(await toRow(/^Open this home in Couch TV Studio/), "the Open this home row");
  fetched.length = 0; inbox.length = 0;
  await press("Enter", 1200);
  ok(await page.evaluate(() => !!document.querySelector(".share-home")), "the Open this home screen");
  ok(inbox[0] === "open", "it opens the phone inbox too");
  ok(/press Send to my TV there: it comes straight back to this TV/.test(await page.evaluate(() => document.querySelector(".share-home").textContent)), "and says Send comes straight back");
  takeAnswer = { state: "ok", code: "K7M2Q-XR4TP" };
  await page.waitForFunction(() => !document.querySelector(".share-home"), null, { timeout: 9000 });
  // the screen closes first (inboxGot), then the code is fetched: wait for that request to reach the
  // pretend store before looking, or a fast close is read as no fetch at all (seen once, 0.13.11)
  for (let t = 0; t < 80 && !fetched.length; t++) await page.waitForTimeout(100);
  ok(inbox.includes("take") && fetched[0] === "K7M2Q-XR4TP","the phone's code comes back and is got (" + fetched.join(",") + ")");
  await page.waitForFunction(() => document.querySelector(".cd-ask"), null, { timeout: 8000 });
  ok(true, "and the TV asks Use this design? first");
  await press("Escape", 400);   // Keep my home
  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} Designs journey browser tests passed.`);
