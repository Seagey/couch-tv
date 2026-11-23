// Things typed at home, in a real browser at 1920x1080 (the TV home in its ?mock preview):
//  1. Home settings, Designs, At home: a note, a list and its items, the guest Wi-Fi, a guide
//     entry and a calendar link typed with the remote land on the widgets straight away.
//  2. The widgets show them at every size they come in, fitting and centred (2c): the note, the list (still to do first), a real
//     Wi-Fi join code that reads back as the WIFI: words, the guide, today's events from the calendar,
//     and On this day.
//  3. OK on the List opens it and OK ticks an item, kept on the TV. OK on the others opens their layer.
//  4. Nothing typed reaches the settings the computer keeps (/api/settings), the design, or the page's
//     URL; Share this home's private words include them.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_athome_browser.mjs
// SHOTS=<folder> also saves a picture of each size.
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
let jsqrPath = null;
for (const dir of [process.env.COUCHTV_JSQR, path.join(ROOT, "../../tv-designer/server")].filter(Boolean)) { try { jsqrPath = createRequire(path.join(dir, "package.json")).resolve("jsqr/dist/jsQR.js"); break; } catch (e) {} }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.url);
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
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });

// a calendar the mock TV reads (window.MOCK_ICS): today at 4pm, tomorrow all day, a repeat that left
// out today
const pad = (v) => String(v).padStart(2, "0"), today = new Date(), ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:a", "DTSTART:" + utc(new Date(Date.now() + 5 * 60000)), "DTEND:" + utc(new Date(Date.now() + 35 * 60000)), "SUMMARY:Late swim", "END:VEVENT",
  "BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:" + ymd(tomorrow), "SUMMARY:Bins out", "END:VEVENT",
  "BEGIN:VEVENT", "UID:c", "DTSTART:20250101T231500", "RRULE:FREQ=DAILY", "EXDATE:" + ymd(today) + "T231500", "SUMMARY:Left out today", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");
const twoYearsAgo = (today.getFullYear() - 2) + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

const browser = await chromium.launch();
async function home(widgets, before) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.addInitScript((ics) => { window.MOCK_ICS = ics; }, ICS);
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => { const R = rect(x[1], x[2], x[3], x[4]); return Object.assign({ id: "w" + i, type: "widget", kind: x[0], x: R.x, y: R.y, w: R.w, h: R.h }, x[5] ? { opts: x[5] } : {}); }) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(([d, b]) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); if (b) Object.keys(b).forEach((k) => localStorage.setItem(k, JSON.stringify(b[k]))); }, [design, before || null]);
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDetail && window.CouchAtHome);
  await page.waitForTimeout(500);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
const text = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.athome") || "{}"));

console.log("Running at home browser tests...");

// 1. typed in Home settings with the remote
{
  const page = await home([["note", 0, 0, 4, 4], ["list", 4, 0, 4, 4], ["wifi", 8, 0, 8, 4], ["guide", 0, 4, 4, 4], ["agenda", 4, 4, 8, 4]]);
  for (const k of ["note", "list", "wifi", "guide", "agenda"]) // (0.13.10) a widget waiting for its words shows its name, its line and Press OK to set it up (no phone page here)
  ok(/Write a note|Add a list|Add your guest Wi-Fi|Write your house guide|Add your calendar|Press OK to set it up|Set up on your phone/.test(await text(page, "w" + ["note", "list", "wifi", "guide", "agenda"].indexOf(k))), k + ": with nothing typed, the widget says what to do, never pretend words");
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 300);   // the gear menu, then Home settings
  await page.waitForTimeout(400);
  // down the sections to Couch TV Studio, into its rows, down to At home
  for (let i = 0; i < 14 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  const toRow = async (re) => { for (let i = 0; i < 40; i++) { const t = await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || ""); if (re.test(t)) return true; await press(page, "ArrowDown", 120); } return false; };
  const type = async (words) => { await press(page, "Enter", 250); await page.fill("#set-input", words); await press(page, "Enter", 300); };
  const atHomeRow = await toRow(/^At home/);
  if (!atHomeRow) console.log("DEBUG", await page.evaluate(() => document.getElementById("set-head").textContent + " | " + ((document.querySelector(".srow.focus") || {}).textContent || "none") + " | " + document.getElementById("set-rows").textContent.slice(0, 300)));
  ok(atHomeRow, "Home settings, Designs has At home");
  await press(page, "Enter", 300);
  ok(/At home/.test(await page.evaluate(() => document.getElementById("set-head").textContent)), "At home opens");
  ok(await toRow(/Write a note/), "a row to write the note"); await type("Dinner at 6. Feed Max!");
  ok(await toRow(/^From/), "then who it is from"); await type("Mum");
  ok(await toRow(/Add a list/), "a row to add a list"); await type("Shopping");
  ok(/Shopping/.test(await page.evaluate(() => document.getElementById("set-head").textContent)), "a new list opens its own page");
  ok(await toRow(/Add an item/), "add an item"); await type("Milk");
  // typing carries on for the next item until Back
  ok(await page.evaluate(() => document.getElementById("set-type").classList.contains("on")), "the box stays open for the next item");
  await page.fill("#set-input", "Bread"); await press(page, "Enter", 300);
  await page.fill("#set-input", "Sunscreen"); await press(page, "Enter", 300);
  await press(page, "Escape", 250);
  ok(await toRow(/Bread/), "the items are rows"); await press(page, "Enter", 250);
  ok((await stored(page)).lists[0].items[1].done === true, "OK on an item in Home settings ticks it");
  await press(page, "ArrowLeft", 250);
  ok(/At home/.test(await page.evaluate(() => document.getElementById("set-head").textContent)), "Left goes back to At home, not out of it");
  ok(await toRow(/Network name/), "the Wi-Fi's name"); await type('Salt;and "Sun"');
  ok(await toRow(/Password/), "its password"); await type("summer-swell 42");
  ok(await toRow(/Add to the guide/), "add to the guide"); await type("Check out");
  ok(/Type the words/.test(await page.evaluate(() => document.getElementById("set-type-label").textContent)), "a new guide heading asks for its words next");
  await page.fill("#set-input", "Sunday by 10am. Keys on the bench."); await press(page, "Enter", 300);
  await press(page, "ArrowLeft", 250);
  ok(await toRow(/Add a calendar link/), "add a calendar"); await type("not a link");
  ok(/not a calendar link/.test(await page.evaluate(() => document.getElementById("set-msg").textContent)), "a wrong link is refused, and says so");
  await type("web" + "cal://calendar.example.com/private-abc123/basic.ics");   // a calendar app's own link (the scan's word list holds the scheme)
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => document.getElementById("set-rows").textContent);
  ok(/calendar\.example\.com/.test(shown) && !/private-abc123/.test(shown), "Home settings shows the calendar's host, never the rest of the link");
  const r = await stored(page);
  ok(r.note && r.note.text === "Dinner at 6. Feed Max!" && r.note.from === "Mum", "the note is kept on the TV");
  ok(r.lists[0].items.map((x) => x.t).join() === "Milk,Bread,Sunscreen", "the list and its three items");
  ok(r.wifi.ssid === 'Salt;and "Sun"' && r.wifi.pass === "summer-swell 42" && r.wifi.sec === "WPA", "the Wi-Fi, WPA unless changed");
  ok(r.guide[0].title === "Check out" && /10am/.test(r.guide[0].text), "the guide entry");
  ok(r.cal.url === "https://calendar.example.com/private-abc123/basic.ics", "the calendar link, read over https");
  // 4. never anywhere else
  const everywhere = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== "mock:tvhome.athome" && k.indexOf("mock:tvhome.athome.") !== 0) o[k] = localStorage.getItem(k); } return JSON.stringify(o) + location.href; });
  ["Feed Max", "Sunscreen", "summer-swell", "Salt;and", "private-abc123", "Keys on the bench"].forEach((w) => ok(everywhere.indexOf(w) < 0, "\"" + w + "\" is in no other storage (Home settings' copy for the computer, the design) and not in the address"));
  ok(seen.every((u) => !/Feed|summer|private-abc|Sunscreen/.test(u)), "nothing typed went to a server");
  await press(page, "Escape", 200); await press(page, "Escape", 200); await press(page, "Escape", 600);
  // 2. on the home
  await page.waitForTimeout(800);
  ok(/From Mum/.test(await text(page, "w0")) && /Feed Max/.test(await text(page, "w0")), "the note shows, with who it is from");
  const lt = await text(page, "w1");
  ok(/Shopping/.test(lt) && lt.indexOf("Milk") < lt.indexOf("Bread"), "the list: what is left first, the ticked one after (" + lt + ")");
  ok(/Salt;and "Sun"/.test(await text(page, "w2")) && /summer-swell 42/.test(await text(page, "w2")), "the Wi-Fi name and password in words");
  if (jsqrPath) {
    // the drawn code, as pixels from the page, read back here by jsQR
    const px = await page.evaluate(async () => {
      const s = document.querySelector('.cw-o[data-obj="w2"] svg[role="img"]'), xml = new XMLSerializer().serializeToString(s), img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
      await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = 600; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 600, 600);
      return Array.from(g.getImageData(0, 0, 600, 600).data);
    });
    const jsQR = createRequire(import.meta.url)(jsqrPath), got = (jsQR(new Uint8ClampedArray(px), 600, 600) || {}).data;
    ok(got === 'WIFI:T:WPA;S:Salt\\;and \\"Sun\\";P:summer-swell 42;;',"the code on the widget reads back as the join words (" + got + ")");
    // and as the TV draws it, with the design's own styles on it: a screenshot of the code on screen.
    // A design rule once gave every square of it a white stroke, so the code drew blank while the
    // copy above still read back.
    const shot = await page.locator('.cw-o[data-obj="w2"] svg[role="img"]').screenshot({ animations: "disabled" });
    const drawn = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, px: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
    }, shot.toString("base64"));
    const dark = drawn.px.filter((v, i) => i % 4 === 0 && v < 80).length / (drawn.w * drawn.h);
    const read = (jsQR(new Uint8ClampedArray(drawn.px), drawn.w, drawn.h) || {}).data;
    ok(dark > 0.2 && dark < 0.8, "the code on screen has dark squares (" + Math.round(dark * 100) + "% dark)");
    ok(read === 'WIFI:T:WPA;S:Salt\\;and \\"Sun\\";P:summer-swell 42;;', "the code on screen reads back as the join words (" + read + ")");
  } else console.log("  (jsQR not found: the code is not read back; set COUCHTV_JSQR)");
  ok(/Check out/.test(await text(page, "w3")), "the guide: its headings on a square");
  await page.waitForFunction(() => /Late swim|Bins out|Nothing on/.test((document.querySelector('.cw-o[data-obj="w4"] .cw') || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const ag = await text(page, "w4");
  ok(/Late swim/.test(ag) && !/Left out today/.test(ag), "the agenda reads the calendar: today's event, not the one left out (" + ag + ")");
  // 3. OK on the List ticks with OK
  await page.evaluate(() => window.CouchDesign.nav.move(1, 0));
  for (let i = 0; i < 4 && (await page.evaluate(() => window.CouchDesign.nav.current().id)) !== "w1"; i++) await page.evaluate(() => window.CouchDesign.nav.move(-1, 0));
  ok((await page.evaluate(() => window.CouchDesign.nav.current().id)) === "w1", "the remote reaches the List");
  await press(page, "Enter", 800);
  ok((await page.evaluate(() => window.CouchDetail.current().name)) === "list", "OK opens the list");
  ok((await page.evaluate(() => window.CouchDetail.current().focusName)) === "Milk", "the first item has the ring");
  await press(page, "Enter", 400);
  ok((await stored(page)).lists[0].items[0].done === true, "OK ticks Milk, kept on the TV");
  ok(/All done|1 to do/.test(await page.evaluate(() => document.querySelector(".cwd-sub").textContent)), "the layer counts what is left");
  await press(page, "Escape", 700);
  ok(/Sunscreen/.test(await text(page, "w1")), "the widget catches up");
  ok(page.errors.length === 0, "no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}

// 2b. On this day, from a photo whose name has a date two years ago today
{
  const page = await home([["memory", 0, 0, 4, 4], ["memory", 4, 0, 2, 2], ["memory", 6, 0, 2, 2, { ago: false }]], { "mock:tvhome.settings": { s: { photos: [{ id: "a", url: "demo/IMG_" + twoYearsAgo.replace(/-/g, "") + "_101500.jpg" }, { id: "b", url: "demo/beach.jpg" }] } } });
  ok(/On this day/.test(await text(page, "w0")) && /2 years ago/.test(await text(page, "w0")), "On this day: the photo from two years ago today");
  // ws2-home (0.13.9): Show how long ago is on by default, also on a tile; off shows the year it was taken
  ok(/(^|\D)2\s*years ago/.test(await text(page, "w1")), "and on a tile, how long ago: " + await text(page, "w1"));
  ok((await text(page, "w2")).indexOf(String(today.getFullYear() - 2)) >= 0, "and on a tile with Show how long ago off, the year it was taken: " + await text(page, "w2"));
  await page.close();
  const none = await home([["memory", 0, 0, 4, 4]], { "mock:tvhome.settings": { s: { photos: [{ id: "a", url: "demo/IMG_20200101_101500.jpg" }] } } });
  const t = await text(none, "w0");
  ok(/No photos from this day/.test(t) && !/years ago/.test(t), "no photo from today: it says so, never another day's (" + t + ")");
  await none.close();
}

// 2c. every size, five ways (the TV's data; very long words; Hindi; nothing set up; the designer's
// demo), with the owner's rule checked on each (seagey, 18 Nov 2026: "each widget fits in each container
// correctly, things aren't cut off and all icons etc are default centre align unless it's changed in the
// designer"):
//   - nothing past the box: the widget's own scroll size is its box, every part sits inside it;
//   - nothing cut off: a part narrower than its words ends them in "..." (text-overflow), a part
//     shorter than its words ends its last line in "..." (line clamp); never a hard cut;
//   - words at 23 px or more;
//   - centred: the words, icons and marks, taken together, sit in the middle of the box (left and right
//     gaps, and top and bottom gaps, within 5%), and with opts.align left they sit on the left.
{
  const page = await home([["clock", 0, 0, 4, 2]]);
  const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
  const kinds = ["note", "list", "wifi", "guide", "agenda", "memory", "screentime"];
  const out = await page.evaluate(([NAMED, kinds, ics]) => {
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, A = window.CouchAtHome, t0 = new Date(), s0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime();
    const soon = (h, title) => ({ title, start: Math.max(t0.getTime() + 60000, s0 + h * 3600000), end: Math.max(t0.getTime() + 120000, s0 + h * 3600000 + 1800000), allDay: false });
    const wifi = (ssid, pass) => ({ ssid, pass, sec: "WPA", qr: A.wifiQr({ ssid, pass, sec: "WPA" }) });
    const base = (o) => Object.assign({ memory: { photos: 3, dated: 2, today: [{ src: "demo/beach.jpg", years: 3 }] }, goal: 120, cal: { set: true, at: Date.now(), can: "tv" } }, o);
    const LONG = "Supercalifragilisticexpialidocious".repeat(3);
    const sets = {
      tv: base({ note: { text: "Dinner at 6. Feed Max!", from: "Mum" }, lists: [{ name: "Shopping", items: [{ t: "Milk" }, { t: "Avocados" }, { t: "Bread", done: true }] }],
        wifi: wifi("salt-and-sun", "summer-swell"), guide: [{ title: "Check out", text: "Sunday by 10am." }, { title: "Around here", text: "The beach is a five minute walk." }],
        cal: { set: true, events: A.parseIcs(ics, s0, s0 + 8 * 86400000, 60).concat([soon(23.5, "Movie night")]) }, screen: { ok: true, minutes: 95, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }] } }),
      long: base({ note: { text: "Dinner at 6 tonight, then bath and bed by 7:30 with no arguments please, and remember the library books are due back on Thursday morning before school. " + LONG, from: "Granny and Grandad Montgomery-Fitzwilliam" },
        lists: [{ name: "A very long list name that goes on and on and on", items: Array.from({ length: 40 }, (_, i) => ({ t: (i % 3 ? "Item " : LONG) + i, done: i % 5 === 0 })) }],
        wifi: wifi("x".repeat(32), "y".repeat(63)), guide: Array.from({ length: 8 }, (_, i) => ({ title: "Heading number " + i + " " + LONG, text: ("Words that go on for a long while. ").repeat(8) + LONG })),
        cal: { set: true, events: Array.from({ length: 12 }, (_, i) => soon(20 + i * 0.3, "A very long event name that will never fit on one line, number " + i + " " + LONG)) },
        screen: { ok: true, minutes: 1439, apps: Array.from({ length: 8 }, (_, i) => ({ name: "An app with a very long name indeed " + i, minutes: 300 - i })) }, goal: 30 }),
      hindi: base({ note: { text: "आज रात का खाना छह बजे है। मैक्स को खाना खिलाना मत भूलना!", from: "माँ" }, lists: [{ name: "खरीदारी", items: [{ t: "दूध" }, { t: "ब्रेड और मक्खन" }, { t: "सनस्क्रीन", done: true }] }],
        wifi: wifi("मेहमान-नेटवर्क", "गर्मी-लहर-42"), guide: [{ title: "चेक आउट", text: "रविवार सुबह दस बजे तक। चाबियाँ रसोई की बेंच पर छोड़ दें।" }, { title: "आस-पास", text: "समुद्र तट पाँच मिनट की पैदल दूरी पर है।" }],
        cal: { set: true, events: [soon(22, "दादी के साथ रात का खाना"), soon(23, "फ़िल्म की रात")] }, screen: { ok: true, minutes: 75, apps: [{ name: "यूट्यूब", minutes: 50 }] } }),
      unset: { note: null, lists: [], wifi: null, guide: [], cal: { set: false }, memory: { photos: 0, dated: 0, today: [] }, screen: { ok: false, why: "off" }, goal: 0 }
    };
    const envs = Object.assign({}, ...Object.keys(sets).map((k) => ({ [k]: { data: { bridge: true, home: sets[k] }, clock24: false } })), { designer: { demo: true, designer: true } });
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99";
    document.body.appendChild(host);
    const bad = [], drawn = []; let count = 0, centred = 0;
    // the words, icons and marks (a list's tick box, an event's colour bar, a progress bar) as one box
    const contentBox = (el) => {
      let l = Infinity, t = Infinity, r = -Infinity, bo = -Infinity;
      const addRect = (q) => { if (q.width < 1 || q.height < 1) return; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); bo = Math.max(bo, q.bottom); };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const q = rg.getBoundingClientRect(), pr = n.parentElement.getBoundingClientRect();
        addRect({ left: Math.max(q.left, pr.left), right: Math.min(q.right, pr.right), top: Math.max(q.top, pr.top), bottom: Math.min(q.bottom, pr.bottom), get width() { return this.right - this.left; }, get height() { return this.bottom - this.top; } });
      }
      el.querySelectorAll("svg, .bx, .cw-ev > i, .cw-bar").forEach((x) => { if (!x.closest("svg") || x.tagName.toLowerCase() === "svg") addRect(x.getBoundingClientRect()); });
      return { l, t, r, b: bo };
    };
    kinds.forEach((kind) => {
      const s = C.get(kind).sizes, list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat([["min", s.min[0], s.min[1]]]);
      list.forEach(([id, w, h]) => Object.keys(envs).concat(["left"]).forEach((en) => {
        while (host.firstChild) host.removeChild(host.firstChild);
        const env = en === "left" ? envs.tv : envs[en];
        const el = W.render({ id: "t", kind, w: w * 100 - 40, h: h * 100 - 40, opts: en === "left" ? { align: "left" } : undefined }, env);
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        const tag = kind + " " + id + " " + en + ": ", b = el.getBoundingClientRect(), words = el.textContent;
        if ((en === "tv" || en === "long" || en === "hindi") && el.getAttribute("data-empty")) bad.push(tag + "a setup card with data (" + words + ")");
        if (en === "unset" && !el.getAttribute("data-empty")) bad.push(tag + "shows something with nothing set (" + words + ")");
        // (0.13.10) the list's setup face says what it is for, "Shopping or to do": a description, not a pretend item
        if (en === "unset" && /Feed Max|Shopping(?! or to do)|salt-and-sun|Swimming|years ago|Milk/.test(words)) bad.push(tag + "pretend words (" + words + ")");
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(tag + "the widget scrolls (" + el.scrollWidth + "x" + el.scrollHeight + " in " + el.clientWidth + "x" + el.clientHeight + ")");
        el.querySelectorAll("*").forEach((node) => {
          if (node.classList.contains("cw-bg") || node.closest("svg")) return;
          const r = node.getBoundingClientRect(), cs = getComputedStyle(node), name = typeof node.className === "string" && node.className ? node.className : node.tagName;
          if (r.width > 0 && r.height > 0 && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1)) bad.push(tag + name + " past the box");
          // a line clamped block: its own lines, each inside it (centred lines leave the space where they
          // wrapped hanging past the edge, which shows nothing)
          const linesIn = () => { const rg = document.createRange(); rg.selectNodeContents(node); const nr = node.getBoundingClientRect(); return [].every.call(rg.getClientRects(), (q) => q.width < 1 || q.top >= nr.bottom - 1 || (q.left >= nr.left - 1 && q.right <= nr.right + 1)); };
          if (node.scrollWidth > node.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && !(cs.webkitLineClamp && cs.webkitLineClamp !== "none" && linesIn())) bad.push(tag + name + " is cut off on the side (" + node.scrollWidth + " in " + node.clientWidth + ": " + node.textContent.slice(0, 30) + ")");
          if (node.scrollHeight > node.clientHeight + 1 && cs.overflowY !== "visible" && (cs.webkitLineClamp === "none" || !cs.webkitLineClamp) && cs.textOverflow !== "ellipsis") bad.push(tag + name + " is cut off at the bottom (" + node.textContent.slice(0, 30) + ")");
          if (node.scrollWidth > node.clientWidth + 1 && cs.overflowX === "visible" && node.children.length === 0 && node.textContent.trim()) bad.push(tag + name + " spills its words (" + node.textContent.slice(0, 30) + ")");
          if ([].some.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim())) { const fs = parseFloat(cs.fontSize); if (fs > 0 && fs < 23) bad.push(tag + "words at " + fs + " px"); }
        });
        // centred: the content box against the widget's padding box (left: against its left edge)
        const cs = getComputedStyle(el), pad = { l: b.left + parseFloat(cs.paddingLeft), r: b.right - parseFloat(cs.paddingRight), t: b.top + parseFloat(cs.paddingTop), b: b.bottom - parseFloat(cs.paddingBottom) };
        const k = contentBox(el), tolX = Math.max(12, (pad.r - pad.l) * 0.05), tolY = Math.max(12, (pad.b - pad.t) * 0.05);
        if (isFinite(k.l)) {
          const gl = k.l - pad.l, gr = pad.r - k.r, gt = k.t - pad.t, gb = pad.b - k.b;
          if (en === "left") { if (!el.getAttribute("data-empty") && gl > tolX + 18) bad.push(tag + "opts.align left, yet " + Math.round(gl) + " px from the left"); }
          else {
            if (Math.abs(gl - gr) > tolX) bad.push(tag + "not centred across (left " + Math.round(gl) + ", right " + Math.round(gr) + ")");
            if (Math.abs(gt - gb) > tolY) bad.push(tag + "not centred up and down (top " + Math.round(gt) + ", bottom " + Math.round(gb) + ")");
            centred++;
          }
        }
        if (en === "tv") drawn.push([kind, id, w, h]);
      }));
    });
    host.remove();
    return { bad, count, centred, drawn };
  }, [NAMED, kinds, ICS]);
  ok(out.count >= 150, "drew " + out.count + " widget sizes (7 widgets, every size, six ways)");
  ok(out.centred >= 120, "checked " + out.centred + " for centring");
  ok(out.bad.length === 0, "every size fits, nothing is cut off, words are 23 px or more, and it is centred unless set to the left:\n  " + out.bad.slice(0, 30).join("\n  ") + (out.bad.length > 30 ? "\n  ... and " + (out.bad.length - 30) + " more" : ""));
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    for (const [kind, id, w, h] of out.drawn) {
      for (const set of ["tv", "long", "hindi"]) {
        await page.evaluate(([kind, w, h, set]) => {
          let host = document.getElementById("shot-host"); if (host) host.remove();
          host = document.createElement("div"); host.id = "shot-host"; host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
          document.body.appendChild(host);
          const A = window.CouchAtHome, s0 = new Date(new Date().setHours(0, 0, 0, 0)).getTime(), later = (m) => Date.now() + m * 60000;
          const L = set === "long", H = set === "hindi";
          const home = { note: { text: H ? "आज रात का खाना छह बजे है। मैक्स को खाना खिलाना मत भूलना!" : L ? "Dinner at 6 tonight, then bath and bed by 7:30 with no arguments please, and remember the library books are due back on Thursday." : "Dinner at 6. Feed Max!", from: H ? "माँ" : "Mum" },
            lists: [{ name: H ? "खरीदारी" : "Shopping", items: (H ? ["दूध", "ब्रेड और मक्खन", "सनस्क्रीन"] : L ? Array.from({ length: 30 }, (_, i) => "A long shopping item number " + i) : ["Milk", "Avocados", "Bread", "Sunscreen"]).map((t, i) => ({ t, done: i === 2 })) }],
            wifi: { ssid: H ? "मेहमान-नेटवर्क" : "salt-and-sun", pass: "summer-swell", sec: "WPA", qr: A.wifiQr({ ssid: H ? "मेहमान-नेटवर्क" : "salt-and-sun", pass: "summer-swell" }) },
            guide: H ? [{ title: "चेक आउट", text: "रविवार सुबह दस बजे तक।" }] : [{ title: "Check out", text: "Sunday by 10am." }, { title: "Around here", text: "The beach is a five minute walk." }],
            cal: { set: true, events: [{ title: H ? "दादी के साथ रात का खाना" : L ? "A very long event name that will never fit on one line at all" : "Swimming", start: later(5), end: later(35) }, { title: "Movie night", start: later(40), end: later(90) }] },
            memory: { photos: 2, dated: 2, today: [{ src: "demo/beach.jpg", years: 3 }] }, screen: { ok: true, minutes: 95, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }] }, goal: 120 };
          const el = window.CouchWidgets.render({ id: "s", kind, w: w * 100 - 40, h: h * 100 - 40 }, { data: { home } });
          el.style.position = "absolute"; el.style.left = "40px"; el.style.top = "40px"; host.appendChild(el);
        }, [kind, w, h, set]);
        await page.screenshot({ path: path.join(process.env.SHOTS, kind + "-" + id + "-" + set + ".png"), clip: { x: 0, y: 0, width: Math.min(1920, w * 100 + 40), height: Math.min(1080, h * 100 + 40) } });
      }
    }
  }
  await page.close();
}

// 3b. each layer opens from its widget with the TV's data, and Back closes it
for (const [kind, layer, words] of [["note", "note", /Back at 5/], ["wifi", "wifi", /pw-1234/], ["guide", "guide", /Check out/], ["agenda", "calendar", /Late swim/]]) {
  const page = await home([[kind, 0, 0, 8, 4]], {
    "mock:tvhome.athome": { v: 1, note: { text: "Back at 5", from: "" }, wifi: { ssid: "Guest", pass: "pw-1234", sec: "WPA" }, guide: [{ title: "Check out", text: "10am" }], cal: { url: "https://calendar.example.com/x.ics" } } });
  if (kind === "agenda") await page.waitForFunction(() => /Late swim|Nothing on/.test((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  await press(page, "Enter", 800);
  const c = await page.evaluate(() => window.CouchDetail.current());
  ok(c && c.name === layer, layer + ": OK opens it (got " + (c && c.name) + ")");
  ok(words.test(await page.evaluate(() => document.querySelector(".cwd-panel").textContent)), layer + ": shows what was typed");
  if (layer === "wifi") ok(await page.evaluate(() => !!document.querySelector(".cwd-qr svg")), "wifi: the join code is drawn big");
  if (layer === "calendar") ok(await page.evaluate(() => document.querySelectorAll(".cwd-tblock").length >= 1), "calendar: today's events on the timeline");
  await press(page, "Escape", 700);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), layer + ": Back closes it");
  ok(page.errors.length === 0, layer + ": no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
