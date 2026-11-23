// "Widgets on your screen" on the phone page (on-tv/web/setup.html, owner 23 Nov 2026), in a real browser,
// against the real TV home (tv-home/web, ?mock=1&ontv=1 with a design) standing in for the TV:
//  1. The gallery: one card per widget drawn by the TV's own widgets.js, the ones waiting for setup first,
//     a map of the screen, Back and Next, More settings holding the old page.
//  2. Edit: plain controls; a clock offers 12 hour and 24 hour only, and a tap reaches the TV at once
//     (widget_set, kept in the TV's Home settings).
//  3. The apps card: the TV's own apps with their icons; tap adds, x takes off, drag moves; saved on the TV.
//  4. Connect your calendar: one question, the short steps, the paste box, Check it, and the TV's answer.
//  5. #widgets walks through the widgets still waiting; #widget=<id>&connect=<need> opens that step.
//  6. #town=<name>|<lat>|<lon> from Couch TV Studio: "Use Ballarat for the weather?", saved only on Yes,
//     taken out of the address, and never in the design.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_setup_browser.mjs
// SHOTS=<folder> saves pictures.
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
const SHOTS = process.env.SHOTS || "";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
const got = { athome: [], settings: [], all: [] };
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false, inputs: [] };
let TV = null;   // the TV home's page: At home is read and changed there, as the on-TV app hands it over
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString(), body = () => { try { return JSON.parse(raw || "{}"); } catch (e) { return {}; } };
    got.all.push(req.method + " " + u.pathname + " " + raw.slice(0, 400));
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN;
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", path.basename(u.pathname)))); return; }
    if (u.pathname.startsWith("/tv/")) {
      const f = path.join(ROOT, "tv-home/web", path.normalize(u.pathname.slice(4)).replace(/^(\.\.[/\\])+/, ""));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); return;
    }
    if (u.pathname === "/api/pair") { const b = body(); return b.pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false, error: "That code is not right." }); }
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") { const b = body(); got.settings.push(b); if (b.settings_patch && b.settings_patch.place) HS.settings.place = b.settings_patch.place; return send(res, 200, Object.assign({ ok: true }, HS)); }
      if (route === "GET /api/athome") return send(res, 200, { ok: true, live: true, athome: await TV.evaluate(() => window.tv.atHomeRead()) });
      if (route === "POST /api/athome") {
        const e = body().edit; got.athome.push(e);
        const r = await TV.evaluate((x) => window.tv.atHomeEdit(x), e);
        return r && r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: (r && r.error) || "no" });
      }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: false, held: false, fire_tv: false, watch: false });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (u.pathname.startsWith("/api/appicon/")) { res.writeHead(200, { "content-type": "image/png" }); res.end(fs.readFileSync(path.join(ROOT, "remote/public/icons/icon-192.png"))); return; }
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""), f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html";

console.log("Running phone setup browser tests...");
const browser = await chromium.launch();
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });
const WIDGETS = [["clock", 0, 0, 8, 4, { format: "12h" }], ["agenda", 8, 0, 8, 4], ["dock", 0, 8, 12, 2, { apps: ["netflix", "youtube"] }], ["note", 12, 8, 4, 2], ["month", 8, 4, 4, 4]];
const design = { v: 1, background: { colour: "#26303f" }, objects: WIDGETS.map((x, i) => { const R = rect(x[1], x[2], x[3], x[4]); return Object.assign({ id: "w" + i, type: "widget", kind: x[0], x: R.x, y: R.y, w: R.w, h: R.h }, x[5] ? { opts: x[5] } : {}); }) };
// a calendar with events in the next days (the TV's mock reads window.MOCK_ICS)
const day = (d, h) => { const t = new Date(Date.now() + d * 86400000); t.setHours(h, 0, 0, 0); return t.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); };
const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0"].concat([0, 1, 2].flatMap((d) => ["BEGIN:VEVENT", "UID:e" + d + "@x", "DTSTART:" + day(d, 18), "DTEND:" + day(d, 19), "SUMMARY:Footy training " + d, "END:VEVENT"]), ["END:VCALENDAR"]).join("\r\n");

async function tvPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); localStorage.setItem("couchtv.design.setupcard", "seen"); }, design);
  await page.goto(HOME + "?mock=1&ontv=1&design=local");
  await page.waitForFunction(() => window.tv && window.CouchDesign && window.CouchDesign.on() && document.querySelector('.cw-o[data-obj="w1"] .cw'));
  await page.evaluate((ics) => { window.MOCK_ICS = ics; }, ICS);
  await page.waitForTimeout(1500);
  return page;
}
async function phone(hash) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(ORIGIN + "/setup#pin=482913" + (hash || ""));
  await page.waitForFunction(() => document.body.classList.contains("gal") && document.querySelector(".g-card .cw"), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return page;
}
TV = await tvPage();

// ---- 1. the gallery ----
let ph = await phone("");
{
  const v = await ph.evaluate(() => ({ title: document.querySelector("#screen h1").textContent, count: document.getElementById("g-count").textContent,
    cards: [...document.querySelectorAll(".g-card")].map((c) => ({ name: c.querySelector(".g-name").textContent, kind: (c.querySelector(".cw") || {}).getAttribute && c.querySelector(".cw").getAttribute("data-kind"), btn: (c.querySelector("button") || {}).textContent || "" })),
    map: document.querySelectorAll("#g-map i").length, lit: document.querySelectorAll("#g-map i.on").length, oldHidden: getComputedStyle(document.getElementById("tvname")).display === "none",
    more: !!document.getElementById("g-more") }));
  ok(v.title === "Widgets on your screen", "the phone page opens on Widgets on your screen");
  ok(v.cards.length === WIDGETS.length && v.count === "1 of " + WIDGETS.length, "one card per widget (" + v.cards.length + ", " + v.count + ")");
  ok(v.cards.every((c) => c.kind), "each card is the real widget, drawn by the TV's widgets.js: " + v.cards.map((c) => c.kind).join(", "));
  ok(["agenda", "note"].includes(v.cards[0].kind) && ["agenda", "note"].includes(v.cards[1].kind), "the widgets waiting for setup come first: " + v.cards.map((c) => c.kind).join(", "));
  ok(v.cards.filter((c) => c.kind === "agenda")[0].btn === "Connect your calendar", "the calendar's one button: Connect your calendar");
  ok(v.cards.filter((c) => c.kind === "clock")[0].btn === "Edit", "a widget with settings: Edit");
  ok(v.cards.filter((c) => c.kind === "month")[0].btn === "Edit" || v.cards.filter((c) => c.kind === "month")[0].btn === "", "the month: Edit for its week start, or nothing");
  ok(/, (top|middle|bottom)/.test(v.cards[0].name), "named by where it sits: " + v.cards[0].name);
  ok(v.map === WIDGETS.length && v.lit === 1, "a small map of the screen with this widget lit");
  ok(v.oldHidden && v.more, "the old page waits under More settings");
  ok(!(await ph.evaluate(() => [...document.querySelectorAll(".g-card")].some((c) => /Footy training/.test(c.textContent)))), "never a private thing on a card (the calendar shows its demo)");
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, "phone-gallery.png") });
  await ph.click("#g-next"); await ph.waitForTimeout(700);
  ok((await ph.textContent("#g-count")) === "2 of " + WIDGETS.length, "Next moves to the second widget");
  await ph.click("#g-prev"); await ph.waitForTimeout(700);
  ok((await ph.textContent("#g-count")) === "1 of " + WIDGETS.length, "Back moves back");
  await ph.click("#g-more"); await ph.waitForTimeout(200);
  ok(await ph.evaluate(() => getComputedStyle(document.getElementById("tvname")).display !== "none"), "More settings shows the old page again: " + await ph.evaluate(() => document.body.className + " " + getComputedStyle(document.getElementById("tvname")).display + " " + document.getElementById("tvname").outerHTML.slice(0, 120)));
  await ph.click("#g-more");
}

// ---- 2. Edit a clock: 12 hour or 24 hour, saved on the TV at once ----
{
  const ci = await ph.evaluate(() => [...document.querySelectorAll(".g-card")].findIndex((c) => c.querySelector('.cw[data-kind="clock"]')));
  await ph.evaluate((i) => document.querySelectorAll(".g-card")[i].querySelector("button").click(), ci);
  await ph.waitForSelector("#sheet:not([hidden])");
  const opts = await ph.evaluate(() => [...document.querySelectorAll("#sheet-body .seg button, #sheet-body .picks button")].map((b) => b.textContent));
  ok(opts.includes("12 hour") && opts.includes("24 hour") && !opts.includes("Follow this TV"), "the clock's sheet: 12 hour and 24 hour, no Follow this TV (" + opts.join(", ") + ")");
  ok(await ph.evaluate(() => /Time zone/.test(document.getElementById("sheet-body").textContent) && !!document.querySelector("#sheet-body select[data-zone]")), "and the time zone choice");
  ok(await ph.evaluate(() => !!document.querySelector("#sheet-body .sw input")), "a yes or no is a switch");
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, "phone-edit-clock.png") });
  await ph.evaluate(() => [...document.querySelectorAll("#sheet-body button")].filter((b) => b.textContent === "24 hour")[0].click());
  await ph.waitForFunction(() => /Saved/.test(document.getElementById("sheet-msg").textContent));
  const set = got.athome.filter((e) => e.widget_set).pop();
  ok(set && set.widget_set.key === "w0|clock" && set.widget_set.values.format === "24h", "24 hour goes to the TV as widget_set: " + JSON.stringify(set));
  const tvv = await TV.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "w0|clock")[0].settings.filter((s) => s.key === "format")[0].value);
  ok(tvv === "24h", "the TV keeps it in its own Home settings: " + tvv);
  await ph.click("#sheet-close");
}

// ---- 3. the apps in the dock ----
{
  const di = await ph.evaluate(() => [...document.querySelectorAll(".g-card")].findIndex((c) => c.querySelector('.cw[data-kind="dock"]')));
  await ph.evaluate((i) => document.querySelectorAll(".g-card")[i].querySelector("button").click(), di);
  await ph.waitForSelector("#g-apps .gapp");
  const a = await ph.evaluate(() => ({ have: [...document.querySelectorAll("#g-have .gapp span:not(.ic)")].map((s) => s.textContent), add: document.querySelectorAll("#g-apps [data-add]").length,
    icons: document.querySelectorAll("#g-apps .ic img").length }));
  ok(a.have.join(",") === "Netflix,YouTube", "the dock's apps, in order: " + a.have.join(", "));
  ok(a.add > 0 && a.icons > 0, "the TV's own apps to add, with real icons (" + a.add + " apps, " + a.icons + " pictures)");
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, "phone-apps-card.png") });
  await ph.evaluate(() => document.querySelector("#g-apps [data-add]").click());
  await ph.waitForFunction(() => document.querySelectorAll("#g-have .gapp").length === 3);
  let last = got.athome.filter((e) => e.design_apps).pop();
  ok(last && last.design_apps.key === "w2|dock" && last.design_apps.apps.length === 3, "tap adds it, saved on the TV only: " + JSON.stringify(last));
  // drag the third app to the front
  const box = async (i) => ph.evaluate((j) => { const r = document.querySelectorAll("#g-have .gapp")[j].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; }, i);
  const from = await box(2), to = await box(0);
  await ph.evaluate(() => { window.__ev = []; ["pointerdown", "pointermove", "pointerup", "mousedown"].forEach((t) => document.addEventListener(t, (e) => window.__ev.push(t + ":" + (e.target.className || e.target.tagName)), true)); });
  await ph.mouse.move(from.x, from.y); await ph.mouse.down(); await ph.mouse.move(from.x - 20, from.y, { steps: 3 }); await ph.mouse.move(to.x, to.y, { steps: 6 }); await ph.mouse.up();
  await ph.waitForTimeout(600);
  last = got.athome.filter((e) => e.design_apps).pop();
  ok(last.design_apps.apps[0] !== "netflix", "drag moves it to the front: " + last.design_apps.apps.join(", ") + JSON.stringify([from, to]) + (await ph.evaluate(() => window.__ev.slice(0, 12).join(" "))));
  await ph.evaluate(() => document.querySelector("#g-have [data-rm]").click());
  await ph.waitForFunction(() => document.querySelectorAll("#g-have .gapp").length === 2);
  ok(got.athome.filter((e) => e.design_apps).pop().design_apps.apps.length === 2, "x takes one off");
  ok(!(await TV.evaluate(() => JSON.stringify(localStorage.getItem("tvdesigner.design")))).includes("disney"), "the design itself is never changed by it");
  await ph.click("#sheet-close");
}

// ---- 4. Connect your calendar ----
{
  const ai = await ph.evaluate(() => [...document.querySelectorAll(".g-card")].findIndex((c) => c.querySelector('.cw[data-kind="agenda"]')));
  await ph.evaluate((i) => document.querySelectorAll(".g-card")[i].querySelector("button").click(), ai);
  await ph.waitForSelector("#sheet [data-prov]");
  const q = await ph.evaluate(() => ({ q: document.querySelector("#sheet-body .q").textContent, provs: [...document.querySelectorAll("#sheet [data-prov]")].map((b) => b.textContent) }));
  ok(q.q === "Which calendar do you use?" && q.provs.join(",") === "Google,Apple,Outlook,Airbnb or bookings,Something else", "one question: " + q.provs.join(", "));
  await ph.evaluate(() => document.querySelector('#sheet [data-prov="google"]').click());
  const g = await ph.evaluate(() => ({ steps: [...document.querySelectorAll("#sheet .steps li")].map((l) => l.textContent), link: (document.querySelector('#sheet a.btn') || {}).href, words: document.getElementById("sheet-body").textContent }));
  ok(g.steps.length === 4 && /Secret address in iCal format/.test(g.steps[2]), "Google: four short steps");
  ok(g.link === "https://calendar.google.com/calendar/r/settings", "with a button to Google Calendar's settings");
  ok(g.words.split(/\s+/).length < 80, "no wall of text (" + g.words.split(/\s+/).length + " words)");
  ok(!/[–—]/.test(g.words), "no dashes");
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, "phone-calendar-connect.png") });
  await ph.fill("#g-cal", "not a link");
  await ph.evaluate(() => document.querySelector("#sheet [data-check]").click());
  ok(/not a calendar link/.test(await ph.textContent("#sheet-msg")), "a wrong paste says so in one line");
  await ph.fill("#g-cal", "https://cal.example.org/feeds/private-0123456789abcdef/basic.ics");
  await ph.evaluate(() => document.querySelector("#sheet [data-check]").click());
  await ph.waitForFunction(() => /Found \d+ event/.test(document.getElementById("g-calres").textContent), null, { timeout: 20000 });
  const res = await ph.textContent("#g-calres");
  ok(/Found 3 events this week\./.test(res), "Check it: the TV read it and says how many events: " + res);
  const view = await TV.evaluate(() => window.tv.atHomeRead().cal);
  ok(view && view.host === "cal.example.org" && view.count === 3 && !JSON.stringify(view).includes("private-0123"), "the TV hands back the host and the count only: " + JSON.stringify(view));
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, "phone-calendar-found.png") });
  await ph.click("#sheet-close");
  await ph.waitForTimeout(2200);
  const agendaReady = await ph.evaluate(() => { const c = [...document.querySelectorAll(".g-card")].filter((x) => x.querySelector('.cw[data-kind="agenda"]'))[0]; return c && c.querySelector("button").textContent; });
  ok(agendaReady === "Edit", "the calendar card is set up now: " + agendaReady);
}
ok(!ph.errors.length, "no page errors on the phone: " + ph.errors.join("; "));
await ph.close();

// ---- 5. #widgets walks through what is left; #widget=&connect= opens a step ----
{
  const p2 = await phone("&widgets");
  await p2.waitForSelector("#sheet:not([hidden])");
  ok(/Family note/.test(await p2.textContent("#sheet-title")) && !!(await p2.$("#g-note")), "#widgets opens the first widget still waiting (the note) at its step");
  await p2.fill("#g-note", "Back at 6");
  await p2.evaluate(() => document.querySelector("#sheet [data-note]").click());
  await p2.waitForFunction(() => /Saved/.test(document.getElementById("sheet-msg").textContent));
  await p2.click("#sheet-close");
  await p2.waitForFunction(() => getComputedStyle(document.getElementById("g-done")).display !== "none", null, { timeout: 8000 });
  ok(/All set\. Look at your TV\./.test(await p2.textContent("#g-done")), "then: All set. Look at your TV.");
  ok(await TV.evaluate(() => !document.querySelector('.cw[data-face="1"]')), "and the TV shows no widget waiting");
  if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, "phone-all-set.png") });
  ok(!p2.errors.length, "no page errors: " + p2.errors.join("; "));
  await p2.close();
  const p3 = await phone("&widget=w1&connect=calendar");
  await p3.waitForSelector("#sheet [data-prov]");
  ok(true, "#widget=w1&connect=calendar opens the calendar question");
  await p3.close();
}

// ---- 6. the town from Couch TV Studio, in the fragment only ----
{
  got.settings.length = 0; got.all.length = 0;
  const p4 = await phone("&town=Ballarat%7C-37.5622%7C143.8503%7CAustralia%2FMelbourne");
  ok(!/town=/.test(await p4.evaluate(() => location.hash)), "the town is taken out of the address at once");
  ok(await p4.evaluate(() => getComputedStyle(document.getElementById("town-ask")).display !== "none"), "the question shows");
  ok((await p4.textContent("#town-ask-q")) === "Use Ballarat for the weather?", "Use Ballarat for the weather?");
  ok(!got.settings.length, "nothing is saved before Yes");
  if (SHOTS) await p4.screenshot({ path: path.join(SHOTS, "phone-town-ask.png") });
  await p4.click("#town-ask-yes");
  await p4.waitForFunction(() => /Saved/.test(document.getElementById("town-ask-msg").textContent));
  const pl = got.settings.map((b) => b.settings_patch && b.settings_patch.place).filter(Boolean)[0];
  ok(pl && pl.name === "Ballarat" && pl.lat === -37.56 && pl.lon === 143.85 && pl.timezone === "Australia/Melbourne", "Yes saves it the way the Town search does, to about a kilometre: " + JSON.stringify(pl));
  ok(got.all.filter((l) => /Ballarat/.test(l)).every((l) => /^POST \/api\/settings /.test(l)), "the town goes only to this TV's settings");
  ok(!(await TV.evaluate(() => localStorage.getItem("tvdesigner.design") || "")).includes("Ballarat"), "never into the design");
  ok(!p4.errors.length, "no page errors: " + p4.errors.join("; "));
  await p4.close();
  const p5 = await phone("&town=%3Cb%3E%7Cabc%7C1");
  ok(await p5.evaluate(() => getComputedStyle(document.getElementById("town-ask")).display === "none"), "a broken town in the link asks nothing");
  await p5.close();
}
ok(!TV.errors.length, "no page errors on the TV: " + TV.errors.join("; "));
await browser.close(); server.close();
console.log("phone setup: " + n + " checks passed");
