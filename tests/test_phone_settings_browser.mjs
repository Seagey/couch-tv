// Home settings on the phone (on-TV app, /setup), in a real browser:
//  1. The TV home's Home settings shows "Change this on your phone" with a QR only when the on-TV app
//     serves it (?ontv=1); the QR reads back as the TV's /setup address with the pairing code (#pin=).
//     It takes no presses: Down from the top still walks the sections, and every section still fits.
//     A TV the computer bridge drives, or the couch-tv home app, shows no QR.
//  2. At home from the phone: tv.atHomeEdit (what the on-TV app hands in) keeps the note, lists, Wi-Fi,
//     guide and calendar links in the TV's own store; tv.atHomeRead gives a calendar link's host only.
//  3. The phone page itself, against a stand-in TV: #pin= pairs by itself and leaves the address, the
//     town search saves the same place shape as the TV's Home settings (settings_patch.place), a photo
//     goes to the TV as the picture itself (POST /api/photos), At home goes to /api/athome, and nothing
//     goes anywhere but the TV and Open-Meteo's place search.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_phone_settings_browser.mjs
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
let jsQR = null;
for (const dir of [process.env.COUCHTV_JSQR, path.join(ROOT, "../../tv-designer/server"), path.join(ROOT, "../tv-designer/server")].filter(Boolean)) {
  try { jsQR = createRequire(path.join(dir, "package.json"))("jsqr"); break; } catch (e) {}
}
const SHOTS = process.env.SHOTS || "";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- a stand-in on-TV app: the TV home's files, and /setup with the API it calls ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
const got = { pair: [], settings: [], athome: [], photos: [], guest: [], home: [] };
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }, { id: "alex", name: "Alex" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400,
  adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false, inputs: [] };
let AH_LIVE = true;
let AH = { note: null, lists: [], wifi: null, guide: [], cal: null, stay: { host: "", checkin: "15:00", checkout: "10:00" }, guest: "" };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks), body = () => { try { return JSON.parse(raw.toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") { const b = body(); got.pair.push(b); return b.pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false, error: "That code is not right." }); }
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") {
        const b = body(); got.settings.push(b);
        if (b.settings_patch && b.settings_patch.place) { HS.settings.place = b.settings_patch.place; HS.weather = { place: b.settings_patch.place.name }; }
        return send(res, 200, Object.assign({ ok: true }, HS));
      }
      if (route === "POST /api/photos") {
        got.photos.push({ type: req.headers["content-type"], bytes: raw.length });
        const p = { id: "p" + got.photos.length, file: "phone" + got.photos.length + "aaaaaa.jpg" };
        HS.settings.photos.push(p);
        return send(res, 200, { ok: true, photo: p, count: HS.settings.photos.length });
      }
      if (u.pathname.startsWith("/api/photo/")) { res.writeHead(200, { "content-type": "image/png" }); res.end(fs.readFileSync(path.join(ROOT, "remote/public/icons/icon-192.png"))); return; }
      if (route === "GET /api/athome") return send(res, 200, AH_LIVE ? { ok: true, live: true, athome: AH } : { ok: true, live: false });
      if (route === "POST /api/athome") {
        const e = body().edit; got.athome.push(e);
        if ("note" in e) AH.note = e.note;
        if (!AH_LIVE) return ("lists" in e || "guide" in e) ? send(res, 409, { ok: false, error: "Open the Couch TV home on the TV first, then save again." }) : send(res, 200, { ok: true, live: false, queued: true });
        if ("lists" in e) AH.lists = e.lists;
        if ("guide" in e) AH.guide = e.guide;
        if ("cal_url" in e) AH.cal = e.cal_url ? { host: new URL(e.cal_url).hostname } : null;
        return send(res, 200, { ok: true, live: true, athome: AH });
      }
      if (route === "POST /api/guest") { const b = body(); got.guest.push(b); return send(res, 200, { ok: true, guest: { name: b.name } }); }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: false, held: false, fire_tv: false, watch: false });
      if (route === "POST /api/home") { const b = body(); got.home.push({ b, type: req.headers["content-type"] }); return send(res, 200, { ok: true, on: b.on, held: false, fire_tv: false, watch: false }); }
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    // the TV home's own files (part 1 and 2)
    const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html";

console.log("Running phone Home settings browser tests...");
const browser = await chromium.launch();
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 200); };

// ---- 1. the QR in Home settings ----
async function settingsOpen(q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1" + q);
  await page.evaluate(() => localStorage.clear());
  await page.goto(HOME + "?mock=1" + q);
  await page.waitForFunction(() => window.tv && document.getElementById("settings"));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 700);
  return page;
}
{
  const page = await settingsOpen("&ontv=1&update=1");
  ok(await page.evaluate(() => document.getElementById("settings").classList.contains("on")), "Home settings is open");
  ok(await page.evaluate(() => document.getElementById("set-phone").classList.contains("on")), "on the on-TV app, Home settings shows Change this on your phone");
  ok(/Change this on your phone/.test(await page.evaluate(() => document.getElementById("set-phone").textContent)), "in plain words");
  ok(await page.evaluate(() => !!document.querySelector("#set-phone-qr svg")), "with a QR");
  ok(await page.evaluate(() => document.getElementById("set-phone-pc").textContent) === "Or on a computer: tv.example:5400/setup, code 482 913",
    "and, for a computer, the plain address and the code to type: " + await page.evaluate(() => document.getElementById("set-phone-pc").textContent));
  if (jsQR) {
    // decode from the QR's own modules: draw the svg on a canvas in the page and read its pixels
    const pix = await page.evaluate(async () => {
      const svg = document.querySelector("#set-phone-qr svg"), xml = new XMLSerializer().serializeToString(svg);
      const img = new Image(); img.src = "data:image/svg+xml;base64," + btoa(xml); await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = 400; const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 400, 400);
      return Array.from(g.getImageData(0, 0, 400, 400).data);
    });
    const code = jsQR(Uint8ClampedArray.from(pix), 400, 400);
    ok(code && code.data === "http://tv.example:5400/setup#pin=482913", "the QR reads back as the TV's /setup with the pairing code: " + (code && code.data));
  } else console.log("  (jsQR not found: the QR's words were not read back)");
  ok(/Language/.test(await page.evaluate(() => (document.querySelector(".ssec.focus") || {}).textContent || "")), "the focus starts on the first section, as before (the QR takes no press)");
  await press(page, "ArrowDown");
  ok(/Location/.test(await page.evaluate(() => (document.querySelector(".ssec.focus") || {}).textContent || "")), "one Down is the next section");
  const fit = await page.evaluate(() => { const a = Array.from(document.querySelectorAll(".ssec")); const last = a[a.length - 1].getBoundingClientRect(); return { n: a.length, bottom: last.bottom, h: innerHeight }; });
  ok(fit.bottom <= fit.h, "every section, Updates too, still fits on screen with the QR (" + fit.n + " sections, last ends at " + Math.round(fit.bottom) + " of " + fit.h + ")");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "home-settings-qr.png") });
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await page.close();
}
// the QR, the computer line and all ten sections fit at 1080p in every home language
for (const lang of ["en", "es", "es-MX", "it", "de", "tr", "fr", "nl", "sr-Latn-RS", "pl", "he", "cs", "pt", "ar", "ro", "zh-CN"]) {
  const page = await settingsOpen("&ontv=1&update=1&lang=" + lang);
  const f = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll(".ssec")), last = a[a.length - 1].getBoundingClientRect(), pc = document.getElementById("set-phone-pc");
    return { n: a.length, bottom: last.bottom, h: innerHeight, pc: pc.textContent, raw: /\{(addr|code)\}|set_phone/.test(document.getElementById("set-phone").textContent) };
  });
  ok(f.n === 10 && f.bottom <= f.h, lang + ": all ten sections fit under the QR (last ends at " + Math.round(f.bottom) + " of " + f.h + ")");
  ok(/tv\.example:5400\/setup/.test(f.pc) && /482 913/.test(f.pc) && !f.raw, lang + ": the computer line has the address and the code, no untranslated words");
  if (SHOTS && (lang === "de" || lang === "ar")) await page.screenshot({ path: path.join(SHOTS, "home-settings-qr-" + lang + ".png") });
  await page.close();
}
for (const [q, what] of [["", "a TV the computer bridge drives"], ["&offline=1", "the couch-tv home app with no computer"]]) {
  const page = await settingsOpen(q);
  ok(!(await page.evaluate(() => document.getElementById("set-phone").classList.contains("on"))), "no QR on " + what + " (no page there to open)");
  await page.close();
}

// ---- 2. At home handed in from the phone ----
{
  const page = await settingsOpen("&ontv=1");
  const r = await page.evaluate(() => window.tv.atHomeEdit({ note: { text: "Dinner at 6", from: "Mum" }, lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }, { t: "Bread", done: true }] }],
    wifi: { ssid: "Beach house", sec: "WPA", pass: "salt and sun", hidden: false }, guide: [{ title: "Bins", text: "Tuesday night" }],
    cal_url: "https://calendar.example.com/private-abc123/basic.ics", stay_url: "https://www.airbnb.com/calendar/ical/1.ics?s=secret", checkin: "14:00", checkout: "10:00" }));
  ok(r && r.ok, "tv.atHomeEdit takes the phone's At home");
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.athome") || "{}"));
  ok(kept.note && kept.note.text === "Dinner at 6" && kept.note.from === "Mum", "the note is in the TV's own store");
  ok(kept.lists && kept.lists[0].items[1].done === true, "the lists, ticks and all");
  ok(kept.wifi && kept.wifi.pass === "salt and sun", "the Wi-Fi");
  ok(kept.guide && kept.guide[0].title === "Bins", "the guide");
  ok(kept.cal && kept.cal.url === "https://calendar.example.com/private-abc123/basic.ics", "the calendar link");
  ok(kept.stay && kept.stay.url && kept.stay.checkin === "14:00", "the bookings link and times");
  const view = await page.evaluate(() => window.tv.atHomeRead());
  ok(view.cal && view.cal.host === "calendar.example.com" && !JSON.stringify(view).includes("private-abc123") && !JSON.stringify(view).includes("secret"), "read back, a calendar link is its host only");
  const bad = await page.evaluate(() => window.tv.atHomeEdit({ cal_url: "http://user:pw@example.com/x.ics" }));
  ok(bad && bad.ok === false && /not a calendar link/.test(bad.error), "a link that is not a calendar's is refused, nothing changed");
  const none = await page.evaluate(() => window.tv.atHomeEdit({ note: null }));
  ok(none.ok && !none.athome.note, "an empty note clears it");
  const st = await page.evaluate(() => localStorage.getItem("mock:tvhome.settings") || "");
  ok(!st.includes("Beach house") && !st.includes("salt and sun"), "none of it lands in the Home settings the server keeps");
  await page.close();
}

// ---- 3. the phone page ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  const hosts = new Set();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [
    { id: 1, name: "Hobart", latitude: -42.87936, longitude: 147.32941, timezone: "Australia/Hobart", admin1: "Tasmania", admin2: "Hobart City", country: "Australia", country_code: "AU" }] }) }));
  await page.goto(ORIGIN + "/setup#pin=482913");
  await page.waitForFunction(() => window.couchTv && window.couchTv.token());
  await page.waitForFunction(() => document.getElementById("people-now").textContent !== "Checking…");
  // every section open (they start shut, one open: tests/test_design_settings_browser.mjs tests that)
  await page.evaluate(() => document.querySelectorAll("main > section.fold.shut").forEach((s) => s.classList.remove("shut")));
  ok(got.pair.length === 1 && got.pair[0].pin === "482913", "the code in the address pairs the phone by itself");
  ok(!/pin=/.test(page.url()), "and is taken off the address");
  ok(/Sam, Alex/.test(await page.textContent("#people-now")), "the people show");
  ok(await page.$("#lat") === null && await page.$("#lon") === null, "no latitude or longitude boxes: a town search instead");
  await page.fill("#town-q", "Hobar");
  await page.waitForSelector("#town-list button");
  await page.click("#town-list button");
  await page.waitForFunction(() => /Saved/.test(document.getElementById("town-msg").textContent));
  const pl = got.settings.map((b) => b.settings_patch && b.settings_patch.place).filter(Boolean)[0];
  ok(pl && Object.keys(pl).sort().join() === "area,lat,lon,name,timezone", "the town is saved in the TV's own place shape (app.js choosePlace)");
  ok(pl.lat === -42.88 && pl.lon === 147.33, "rounded to the town, as the TV does");
  ok(!got.settings.some((b) => b.settings), "the phone never sends a whole settings copy that could undo the TV's");
  ok(/Hobart/.test(await page.textContent("#town-now")), "the page shows the new town");
  // a photo
  const png = fs.readFileSync(path.join(ROOT, "remote/public/icons/icon-192.png"));
  await page.setInputFiles("#photo-file", { name: "beach.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => /on the TV now/.test(document.getElementById("photo-msg").textContent));
  ok(got.photos.length === 1 && got.photos[0].type === "image/png" && got.photos[0].bytes === png.length, "the photo goes to the TV as the picture itself");
  ok(await page.$$eval("#photo-list .photo", (a) => a.length) === 1, "and is listed");
  // At home
  await page.fill("#ah-note", "Back at 5"); await page.fill("#ah-from", "Dad");
  await page.click("#ah-note-save");
  await page.waitForFunction(() => /on the TV/.test(document.getElementById("ah-note-msg").textContent));
  ok(got.athome[0] && got.athome[0].note.text === "Back at 5" && got.athome[0].note.from === "Dad", "the note goes to /api/athome");
  await page.fill("#ah-cal", "https://calendar.example.com/private-zz/basic.ics");
  await page.click("#ah-cal-save");
  await page.waitForFunction(() => document.getElementById("ah-cal-now").textContent === "calendar.example.com");
  ok(await page.inputValue("#ah-cal") === "", "a calendar link is not left on the page once sent");
  // words with & < > " in them come back exactly, and a ticked item stays ticked (review B2)
  AH.lists = [{ name: "Fish & \"chips\"", items: [{ t: "Fish & chips", done: true }, { t: "<b>Milk</b> 'n' bread", done: false }] }];
  AH.guide = [{ title: "Bins & <recycling>", text: "Tuesday \"night\" & Friday" }];
  await page.evaluate(() => loadAtHome());
  await page.waitForSelector("#ah-lists .entry");
  ok(await page.inputValue("#ah-lists .l-name") === 'Fish & "chips"', "a list name with & and quotes shows exactly");
  ok(await page.inputValue("#ah-lists .l-items") === "Fish & chips\n<b>Milk</b> 'n' bread", "items with & and < > show exactly, as words");
  ok(await page.inputValue("#ah-guide .g-title") === "Bins & <recycling>" && await page.inputValue("#ah-guide .g-text") === 'Tuesday "night" & Friday', "the guide too");
  ok(await page.$("#ah-lists b") === null, "nothing typed turns into markup on the page");
  await page.click("#ah-lists-save");
  await page.waitForFunction(() => /lists are on the TV/.test(document.getElementById("ah-lists-msg").textContent));
  const sent = got.athome[got.athome.length - 1].lists[0];
  ok(sent.name === 'Fish & "chips"' && sent.items[0].t === "Fish & chips" && sent.items[0].done === true && sent.items[1].t === "<b>Milk</b> 'n' bread",
    "saved back unchanged, and the ticked item is still ticked: " + JSON.stringify(sent));
  // the TV's home is not open: lists and the guide (sent whole) cannot be saved blind (review B3)
  AH_LIVE = false;
  await page.evaluate(() => loadAtHome());
  await page.waitForFunction(() => document.getElementById("ah-lists-save").disabled);
  ok(await page.evaluate(() => ["ah-list-add", "ah-lists-save", "ah-guide-add", "ah-guide-save"].every((id) => document.getElementById(id).disabled)),
    "with the TV's home not open, Add and Save for the lists and the guide are off");
  ok(/once the Couch TV home is open/.test(await page.textContent("#ah-lists-msg")), "and the page says why");
  ok(!(await page.isDisabled("#ah-note-save")), "a note can still be sent, to wait on the TV");
  await page.fill("#ah-note", "Gone to the beach"); await page.click("#ah-note-save");
  await page.waitForFunction(() => /as soon as the Couch TV home is open/.test(document.getElementById("ah-note-msg").textContent));
  ok(true, "a waiting note says it reaches the TV once its home opens");
  AH_LIVE = true;
  // use as home screen
  await page.click("#home-on");
  await page.waitForFunction(() => /One step left/.test(document.getElementById("home-state").textContent));
  ok(got.home[0] && got.home[0].b.on === true && got.home[0].type === "application/json", "Use as home screen asks the TV, as JSON");
  ok(/pick Couch TV with the TV remote/.test(await page.textContent("#home-note")), "and says Android's own question is answered on the TV");
  ok(await page.isHidden("#smart"), "no Smart home row while the TV has no Home Assistant page");
  const others = [...hosts].filter((h) => h !== new URL(ORIGIN).host && h !== "geocoding-api.open-meteo.com");
  ok(!others.length, "nothing goes anywhere but the TV and the place search: " + others.join(", "));
  const words = await page.evaluate(() => document.body.innerText);
  ok(!/[–—]/.test(words), "no long dashes in the page's words");
  ok(!/\b(Beta|Experimental|coming soon)\b/i.test(words), "no Beta, Experimental or coming soon");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phone-home-settings.png"), fullPage: true });
  ok(!page.errors.length, "no page errors: " + page.errors.join("; "));
  await ctx.close();
}

// the code comes off the address, anything else in it stays (#sheet=, #design=)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + "/setup#sheet=people&pin=482913");
  await page.waitForFunction(() => window.couchTv && window.couchTv.token());
  await page.waitForLoadState("load");
  ok(new URL(page.url()).hash === "#sheet=people", "#pin= is taken off and #sheet= stays: " + page.url());
  await ctx.close();
}

// ---- 4. on a computer (1280x800, 1920x1080) and a tablet (768x1024) ----
for (const [w, h, kind] of [[1280, 800, "computer"], [1920, 1080, "computer"], [768, 1024, "tablet"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: false, hasTouch: kind === "tablet" });
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [
    { id: 2, name: "Hobart", latitude: -42.87936, longitude: 147.32941, timezone: "Australia/Hobart", admin1: "Tasmania", country: "Australia", country_code: "AU" }] }) }));
  const at = w + "x" + h;
  // typed on a computer: the address alone, no #pin, then the code from the TV
  const pairs = got.pair.length;
  await page.goto(ORIGIN + "/setup");
  await page.waitForSelector("#ctv-pin");
  ok(true, at + ": opened without a code, the page asks for the code shown on the TV");
  await page.click("#ctv-pin"); await page.keyboard.type("482 913"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.couchTv && window.couchTv.token() && document.getElementById("people-now").textContent !== "Checking…");
  // every section open (they start shut; tests/test_design_settings_browser.mjs tests opening them)
  await page.evaluate(() => document.querySelectorAll("main > section.fold.shut").forEach((s) => s.classList.remove("shut")));
  ok(got.pair.length === pairs + 1 && got.pair[pairs].pin === "482913", at + ": the code typed with the keyboard (Enter) pairs it");
  // a readable width, never stretched across a wide screen
  const lay = await page.evaluate(() => {
    const m = document.querySelector("main").getBoundingClientRect(), ins = Array.from(document.querySelectorAll("main input:not([type=checkbox]):not([type=file]), main textarea, main select")).filter((x) => x.offsetParent);
    return { mw: m.width, ml: m.left, mr: innerWidth - m.right, widest: Math.max.apply(null, ins.map((x) => x.getBoundingClientRect().width)), scroll: document.documentElement.scrollWidth > innerWidth };
  });
  ok(lay.mw <= 560 && Math.abs(lay.ml - lay.mr) <= 2, at + ": the page is one readable column, centred (" + Math.round(lay.mw) + " px)");
  ok(lay.widest <= 560 && !lay.scroll, at + ": no form box stretches wider than the column, no sideways scroll");
  // Tab walks the page top to bottom, with a focus ring
  await page.focus("#town-q");
  const order = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => { const e = document.activeElement, r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 20), y: r.top + scrollY, ring: getComputedStyle(e).outlineStyle !== "none" || !!e.closest(".pick:focus-within") }; }));
  }
  ok(order.every((o, i) => i === 0 || o.y >= order[i - 1].y - 4), at + ": Tab goes down the page in reading order: " + order.map((o) => o.id).join(" > "));
  ok(order.every((o) => o.ring), at + ": every stop shows where the keyboard is");
  ok(order.some((o) => o.id === "photo-file"), at + ": Tab reaches Add photos");
  // Enter submits: the town search picks the first place, a one line box saves its card
  const sets = got.settings.length;
  await page.fill("#town-q", "Hobar");
  await page.waitForSelector("#town-list button");
  await page.focus("#town-q"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Saved/.test(document.getElementById("town-msg").textContent));
  ok(got.settings.length === sets + 1 && got.settings[sets].settings_patch.place.name === "Hobart", at + ": Enter in the town search saves the first place");
  const guests = got.guest.length;
  await page.fill("#ah-guest", "the Nguyen family"); await page.focus("#ah-guest"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /greets/.test(document.getElementById("ah-guest-msg").textContent));
  ok(got.guest.length === guests + 1 && got.guest[guests].name === "the Nguyen family", at + ": Enter in the guest's name saves it");
  // photos: the file picker, then a drag from a folder onto the card
  const png = fs.readFileSync(path.join(ROOT, "remote/public/icons/icon-192.png"));
  let before = got.photos.length;
  await page.setInputFiles("#photo-file", { name: "deck.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => /on the TV now/.test(document.getElementById("photo-msg").textContent));
  ok(got.photos.length === before + 1, at + ": Add photos (the file picker) sends it");
  before = got.photos.length;
  await page.evaluate(() => { document.getElementById("photo-msg").textContent = ""; });
  const dt = await page.evaluateHandle((b64) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = new DataTransfer(); d.items.add(new File([u], "beach.png", { type: "image/png" })); d.items.add(new File(["just words"], "notes.txt", { type: "text/plain" })); return d;
  }, png.toString("base64"));
  await page.dispatchEvent("#photos", "dragenter", { dataTransfer: dt });
  ok(await page.evaluate(() => document.getElementById("photos").classList.contains("over")), at + ": dragging files over Your photos lights it up");
  await page.dispatchEvent("#photos", "drop", { dataTransfer: dt });
  await page.waitForFunction(() => /on the TV now/.test(document.getElementById("photo-msg").textContent));
  ok(got.photos.length === before + 1 && got.photos[before].type === "image/png", at + ": a photo dropped on the card goes to the TV, and a file that is not a photo is left out");
  ok(!(await page.evaluate(() => document.getElementById("photos").classList.contains("over"))), at + ": the card goes back to normal after the drop");
  ok(kind === "tablet" ? true : await page.isVisible(".drop-hint"), at + ": a computer is told it can drag photos in");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "setup-" + kind + "-" + at + ".png"), fullPage: false });
  ok(!page.errors.length, at + ": no page errors: " + page.errors.join("; "));
  await ctx.close();
}

await browser.close();
server.close();
console.log("phone Home settings browser tests: " + n + " passed");
