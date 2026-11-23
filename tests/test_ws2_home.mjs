// Widget settings, round 2, the family, guest and photo widgets (agenda, people, note, list, guide,
// welcome, memory, screentime, wifi, card, photo, slideshow, mosaic, artframe), in a real browser:
//  A. every setting changes the drawn widget, and clearing it goes back to the default (widgets.js and
//     the detail layers in widget-detail.js, fed the shapes app.js homeView hands over);
//  B. on the real home (index.html, mock TV) with a design holding all 14: each shows in Home settings,
//     Designs, "Widgets on this home", in Hold OK as "Edit on the TV", and on the phone's "Widgets on
//     this TV" (setup.html against a stand in on-TV app); a design without them, and they are gone;
//  C. each setting set the way the phone and the TV's own rows set it (ST.widgets), and the widget on
//     the real home changes; cleared, it is back.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_home.mjs
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

let n = 0;
const counts = {};
let group = "";
const ok = (c, m) => { assert.ok(c, m); n++; counts[group] = (counts[group] || 0) + 1; };

// ---- a stand in on-TV app: the home's files, /setup, and an API whose At home is the real TV page ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
let TVP = null;
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const RENDER = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "qr.js", "athome.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks), body = () => { try { return JSON.parse(raw.toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/tv-home/web/ws2-home.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(RENDER); return; }
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false });
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/athome") {
        const r = TVP ? await TVP.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null;
        return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false });
      }
      if (route === "POST /api/athome") {
        const r = TVP ? await TVP.evaluate((x) => tv.atHomeEdit(x), body().edit) : null;
        if (!r) return send(res, 200, { ok: true, live: false, queued: true });
        return r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error });
      }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: true, held: true });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, current: "0.13.9", checked: true });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;

const browser = await chromium.launch();
const errors = [];
console.log("Running widget settings round 2 (family, guest and photo widgets) browser tests...");

// ================= A. each setting, drawn =================
group = "A. each setting drawn";
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => errors.push("render: " + e));
await page.goto(ORIGIN + "/tv-home/web/ws2-home.html");
await page.waitForFunction(() => window.CouchWidgets && window.CouchDetail && window.CouchWidgetCaps && window.CouchAtHome && window.TVQR);

// draw one widget with this TV's settings for it (wset) on a real TV (no demo); the words and the markup
async function draw(o, data, wset, size, layer) {
  return page.evaluate(([o, data, wset, size, layer]) => {
    if (window.CouchDetail.isOpen()) window.CouchDetail.close(true);
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:40px;top:40px";
    document.body.appendChild(host);
    const env = { data: Object.assign({}, data, wset ? { wset: { [o.id]: wset } } : {}) };
    const root = window.CouchWidgets.render(Object.assign({ w: size ? size[0] : 900, h: size ? size[1] : 460 }, o), env);
    host.appendChild(root);
    const out = { text: root.textContent.replace(/\s+/g, " ").trim(), html: root.innerHTML, empty: root.getAttribute("data-empty") === "1",
      tiles: [...root.querySelectorAll("div")].filter((d) => /url\(/.test(d.style.backgroundImage)).length };
    if (layer) {
      const from = root.hasAttribute("data-act") ? root : root.querySelector("[data-act]") || root;
      window.CouchDetail.open(from, env, { designer: false });
      const st = document.querySelector(".cwd-stage");
      out.layer = st ? st.textContent.replace(/\s+/g, " ").trim() : "";
      window.CouchDetail.close(true);
    }
    return out;
  }, [o, data, wset || null, size || null, !!layer]);
}
// a setting that changes the widget, then cleared: back to exactly the default
async function cycle(name, o, data, set, check, size) {
  const def = await draw(o, data, null, size), on = await draw(o, data, set, size), cleared = await draw(o, data, {}, size);
  check(def, on);
  // (an avatar's drawing has its own made up ids each time: those are not the widget)
  const same = (x) => x.html.replace(/ id="[^"]*"/g, "").replace(/url\(#[^)]*\)/g, "").replace(/href="#[^"]*"/g, "");
  ok(cleared.text === def.text && same(cleared) === same(def), name + ": cleared, it is the default again");
  ok(!on.text.includes("demo") && !/Alex|Ruby|Swimming lessons/.test(def.text + on.text), name + ": never the demo on a real TV");
  return { def, on };
}
const dayMs = 86400000, t0 = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
const now = Date.now();

// ---- photos: which photo (by its id in Home settings), fill or fit, the photo in the widget ----
const PH = ["demo/beach.jpg", "demo/dog.jpg", "demo/camp.jpg", "demo/surf.jpg", "demo/hike.jpg", "demo/nan.jpg", "demo/birthday.jpg"];
const phData = { photos: PH, home: { photoIds: ["pa", "pb", "pc", "pd", "pe", "pf", "pg"] } };
for (const kind of ["photo", "artframe"]) {
  await cycle(kind + ".photo", { id: "p1", kind }, phData, { photo: "pf" }, (d, s) => ok(/nan\.jpg/.test(s.html) && (s.html.match(/url\(/g) || []).length === 1 && /url\(/.test(d.html), kind + ".photo: the photo picked on this TV by its id (nan) shows: " + s.html.slice(0, 120)));
  const pick = await draw({ id: "p1", kind }, phData, { photo: "pb" });
  ok(/dog\.jpg/.test(pick.html) && (pick.html.match(/url\(/g) || []).length === 1, kind + ".photo: only that photo (dog) shows: " + pick.html.slice(0, 160));
  const gone = await draw({ id: "p1", kind }, phData, { photo: "removed-id" });
  ok(/url\(/.test(gone.html) && !gone.empty, kind + ".photo: a photo since removed falls back to this TV's photos, never an empty box");
  const own = await draw({ id: "p1", kind, opts: { image: "https://assets.example/own.jpg" } }, phData, { photo: "pb" });
  ok(/assets\.example\/own\.jpg/.test(own.html) && !/dog\.jpg/.test(own.html), kind + ".image: the photo put in the widget in Studio shows on every TV");
}
await cycle("photo.fit", { id: "p1", kind: "photo" }, phData, { fit: "contain" }, (d, s) => ok(/background-size: contain/.test(s.html) && /background-size: cover/.test(d.html), "photo.fit: Fit the whole photo, Fill the box by default"));
await cycle("artframe.mat", { id: "p1", kind: "artframe" }, phData, { mat: "#1d1b18" }, (d, s) => ok(/rgb\(29, 27, 24\)/.test(s.html) && /rgb\(251, 248, 241\)/.test(d.html), "artframe.mat: the frame is black, cream by default"));
ok(!/url\(x\)/.test((await draw({ id: "p1", kind: "artframe" }, phData, { mat: "red;background:url(x)" })).html), "artframe.mat: a colour from the TV is only one of the four");
// slideshow: next photo every, shuffle (the photo now is the one the TV's own count says)
async function shown(wset) { const r = await draw({ id: "p1", kind: "slideshow" }, phData, wset); const m = /url\(&quot;([^&]*)&quot;\)|url\("([^"]*)"\)/.exec(r.html); return m ? PH.indexOf(m[1] || m[2]) : -1; }
{
  const at = (secs) => Math.floor(Date.now() / (secs * 1000)) % PH.length;
  const w10 = await shown({ seconds_each: 10 }), e10 = at(10), w300 = await shown({ seconds_each: 300 }), e300 = at(300), wd = await shown(null), ed = at(20);
  ok(w10 === e10 && w300 === e300 && wd === ed, "slideshow.seconds_each: the photo now follows 10 seconds, 5 minutes and the default 20 (" + [w10, e10, w300, e300, wd, ed] + ")");
  const mixedAt = await page.evaluate((ph) => { const seed = Math.floor(Date.now() / 86400000); const out = ph.slice(); let x = (seed % 2147483646) + 1; for (let k = out.length - 1; k > 0; k--) { x = (x * 48271) % 2147483647; const j = x % (k + 1), t = out[k]; out[k] = out[j]; out[j] = t; } return out; }, PH);
  const sh = await draw({ id: "p1", kind: "slideshow" }, phData, { shuffle: true, seconds_each: 300 });
  const want = mixedAt[at(300)], first = (/url\(&quot;([^&]*)&quot;\)|url\("([^"]*)"\)/.exec(sh.html) || []);
  ok((first[1] || first[2]) === want, "slideshow.shuffle: on, the photo now is from today's mixed order (" + want + ")");
  ok(JSON.stringify(mixedAt.slice().sort()) === JSON.stringify(PH.slice().sort()) && JSON.stringify(mixedAt) !== JSON.stringify(PH), "slideshow.shuffle: every photo once, in another order");
  ok((await draw({ id: "p1", kind: "slideshow" }, phData, {})).html === (await draw({ id: "p1", kind: "slideshow" }, phData, null)).html, "slideshow: cleared, the default again");
}
await cycle("mosaic.count", { id: "p1", kind: "mosaic" }, phData, { count: 3 }, (d, s) => ok(s.tiles === 3 && d.tiles === 5, "mosaic.count: 3 photos, as many as fit (5) by default (" + s.tiles + ", " + d.tiles + ")"), [1200, 600]);
ok((await draw({ id: "p1", kind: "mosaic", opts: { count: "auto" } }, phData, null, [1200, 600])).tiles === 5, "mosaic: a design's \"auto\" fills the box (no broken count)");

// ---- On this day: this day or this week, how long ago ----
{
  const memData = { home: { memory: { photos: 4, dated: 3, today: [], week: [{ src: "demo/camp.jpg", years: 3 }] } } };
  await cycle("memory.range", { id: "m1", kind: "memory" }, memData, { range: "week" }, (d, s) => {
    ok(/No photos from this day/.test(d.text) && d.empty, "memory: this day only by default, and it says none (" + d.text + ")");
    ok(/This week/.test(s.text) && /3 years ago/.test(s.text) && /camp\.jpg/.test(s.html), "memory.range: This week shows the photo from two days off: " + s.text);
  }, [600, 400]);
  const both = { home: { memory: { photos: 4, dated: 3, today: [{ src: "demo/camp.jpg", years: 3 }], week: [{ src: "demo/camp.jpg", years: 3 }] } } };
  await cycle("memory.ago", { id: "m1", kind: "memory" }, both, { ago: false }, (d, s) => ok(/3 years ago/.test(d.text) && s.text.includes(String(new Date().getFullYear() - 3)) && !/years ago/.test(s.text), "memory.ago: off shows the year it was taken: " + s.text), [600, 400]);
  const lay = await draw({ id: "m1", kind: "memory" }, memData, { range: "week", ago: false }, [600, 400], true);
  ok(/This week, in /.test(lay.layer), "memory: its detail layer follows both settings: " + lay.layer.slice(0, 80));
}

// ---- Agenda: calendars and days ----
{
  const main = [{ title: "Late swim", start: now + 300000, end: now + 2100000, allDay: false }, { title: "Bins out", start: t0 + dayMs, end: t0 + 2 * dayMs, allDay: true }, { title: "Dentist", start: t0 + 3 * dayMs + 36000000, end: t0 + 3 * dayMs + 39600000, allDay: false }];
  const books = [{ title: "Check out, Sarah", start: t0 + 2 * dayMs, end: t0 + 3 * dayMs, allDay: true }, { title: "Check in, Tom", start: t0, end: t0 + dayMs, allDay: true }];
  const agData = { home: { cal: { set: true, events: main }, books: { set: true, events: books } } };
  await cycle("agenda.calendars main", { id: "a1", kind: "agenda" }, agData, { calendars: "main" }, (d, s) => {
    ok(/Late swim/.test(d.text) && /Check in, Tom/.test(d.text), "agenda: every calendar by default, your calendar and the bookings: " + d.text);
    ok(/Late swim/.test(s.text) && !/Check in/.test(s.text), "agenda.calendars: Your calendar only: " + s.text);
  });
  await cycle("agenda.calendars bookings", { id: "a1", kind: "agenda" }, agData, { calendars: "bookings" }, (d, s) => ok(/Check in, Tom/.test(s.text) && !/Late swim/.test(s.text), "agenda.calendars: Bookings calendar only: " + s.text));
  const noBooks = await draw({ id: "a1", kind: "agenda" }, { home: { cal: { set: true, events: main }, books: { set: false } } }, { calendars: "bookings" });
  ok(noBooks.empty && /Add your bookings calendar/.test(noBooks.text), "agenda.calendars: bookings picked with none set: it says what to add: " + noBooks.text);
  await cycle("agenda.days week", { id: "a1", kind: "agenda" }, agData, { days: "week" }, (d, s) => {
    ok(!/Dentist/.test(d.text) && /Today/.test(d.text), "agenda: today and tomorrow by default, nothing three days on: " + d.text);
    ok(/Dentist/.test(s.text) && /This week/.test(s.text) && /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) 10/.test(s.text), "agenda.days: This week, with each day named: " + s.text);
  });
  const tmw = { home: { cal: { set: true, events: main.slice(1) }, books: { set: false } } };
  await cycle("agenda.days today", { id: "a1", kind: "agenda" }, tmw, { days: "today" }, (d, s) => {
    ok(/Bins out/.test(d.text) && /Tomorrow/.test(d.text), "agenda: a clear today shows tomorrow by default: " + d.text);
    ok(/Nothing on today/.test(s.text) && !/Bins out/.test(s.text), "agenda.days: Today only: " + s.text);
  });
  const lay = await draw({ id: "a1", kind: "agenda" }, agData, { calendars: "bookings" }, null, true);
  ok(/Check in, Tom/.test(lay.layer) && !/Late swim/.test(lay.layer), "agenda: its detail layer shows only the calendars picked: " + lay.layer.slice(0, 120));
}

// ---- People: who shows, names ----
{
  const pd = { people: [{ id: "a", name: "Alex" }, { id: "b", name: "Sam" }, { id: "c", name: "Jordan" }], who: "a" };
  const pdNoAlex = { people: [{ id: "b", name: "Sam" }, { id: "c", name: "Jordan" }, { id: "d", name: "Riley" }], who: "b" };
  await cycle("people.who", { id: "u1", kind: "people" }, pdNoAlex, { who: ["c"] }, (d, s) => ok(/Sam/.test(d.text) && /Riley/.test(d.text) && s.text === "Jordan", "people.who: only Jordan, everyone by default (" + s.text + " / " + d.text + ")"), [900, 120]);
  await cycle("people.names", { id: "u1", kind: "people" }, pdNoAlex, { names: false }, (d, s) => ok(/Sam/.test(d.text) && s.text === "" && (s.html.match(/<svg|<img/g) || []).length >= 3, "people.names: off shows only the pictures"), [900, 120]);
  ok((await draw({ id: "u1", kind: "people" }, pdNoAlex, { who: ["gone"] }, [900, 120])).text.includes("Sam"), "people.who: someone since removed: everyone shows, never an empty widget");
  ok(pd.people.length === 3, "people data shape");
}

// ---- Family note, List, House guide, Guest Wi-Fi ----
{
  const nd = { home: { note: { text: "Dinner at 6. Feed Max!", from: "Mum" } } };
  await cycle("note.byline", { id: "n1", kind: "note" }, nd, { byline: false }, (d, s) => ok(/From Mum/.test(d.text) && !/From Mum/.test(s.text) && /Dinner at 6/.test(s.text), "note.byline: off hides who it is from"));
  const ld = { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }, { t: "Bread", done: true }] }, { name: "Jobs", items: [{ t: "Mow the lawn", done: false }] }] } };
  await cycle("list.list", { id: "l1", kind: "list" }, ld, { list: "Jobs" }, (d, s) => ok(/Shopping/.test(d.text) && /Jobs/.test(s.text) && /Mow the lawn/.test(s.text) && !/Milk/.test(s.text), "list.list: the list picked on this TV (Jobs), the first by default"));
  await cycle("list.done", { id: "l1", kind: "list" }, ld, { done: false }, (d, s) => ok(/Bread/.test(d.text) && !/Bread/.test(s.text) && /Milk/.test(s.text), "list.done: off hides what is ticked"));
  const gd = { home: { guide: [{ title: "Check out", text: "By 10am." }, { title: "Bins", text: "Red Tuesday." }, { title: "Around here", text: "Beach 5 minutes." }] } };
  await cycle("guide.sections", { id: "g1", kind: "guide" }, gd, { sections: ["Bins"] }, (d, s) => ok(/Check out/.test(d.text) && /Bins/.test(s.text) && !/Check out|Around here/.test(s.text), "guide.sections: only Bins, all of it by default: " + s.text), [900, 700]);
  const gl = await draw({ id: "g1", kind: "guide" }, gd, { sections: ["Bins", "Around here"] }, [900, 700], true);
  ok(/Bins/.test(gl.layer) && /Around here/.test(gl.layer) && !/Check out/.test(gl.layer) && /2 things to know/.test(gl.layer), "guide: its detail layer shows the same parts: " + gl.layer.slice(0, 80));
  const wd = { home: { wifi: { ssid: "salt-and-sun", pass: "summer-swell", sec: "WPA", qr: "WIFI:T:WPA;S:salt-and-sun;P:summer-swell;;" } } };
  await cycle("wifi.hidepass", { id: "f1", kind: "wifi" }, wd, { hidepass: true }, (d, s) => {
    ok(/summer-swell/.test(d.text) && !/summer-swell/.test(s.text) && /(The password is|Password) in the code/.test(s.text) && /<svg/.test(s.html), "wifi.hidepass: the password words go, the code stays");
  });
  const wl = await draw({ id: "f1", kind: "wifi" }, wd, { hidepass: true }, null, true);
  ok(!/summer-swell/.test(wl.layer) && /salt-and-sun/.test(wl.layer), "wifi: its detail layer hides the password too");
}

// ---- Screen time: apps shown ----
{
  const sd = { home: { screen: { ok: true, minutes: 125, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }, { name: "Netflix", minutes: 20 }, { name: "Stan", minutes: 12 }, { name: "Kayo", minutes: 10 }] }, goal: 120 } };
  await cycle("screentime.appcount 0", { id: "s1", kind: "screentime" }, sd, { appcount: 0 }, (d, s) => ok(/YouTube/.test(d.text) && /Kayo/.test(d.text) && !/YouTube/.test(s.text) && /2h 5m/.test(s.text), "screentime.appcount: None shows only the total: " + s.text), [1000, 400]);
  await cycle("screentime.appcount 3", { id: "s1", kind: "screentime" }, sd, { appcount: 3 }, (d, s) => ok(/Netflix/.test(s.text) && !/Stan|Kayo/.test(s.text), "screentime.appcount: 3 apps: " + s.text), [1000, 400]);
}

// ---- the small sizes (tools/tv-designer/app/grid.js: tile 160x160, wide tile 360x160): each setting
// still shows, and the words it adds fit their box (scrollWidth no more than clientWidth) ----
async function fit(o, data, wset, size, word) {
  return page.evaluate(([o, data, wset, size, word]) => {
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:40px;top:40px";
    document.body.appendChild(host);
    const env = { data: Object.assign({}, data, wset ? { wset: { [o.id]: wset } } : {}) };
    const root = window.CouchWidgets.render(Object.assign({ w: size[0], h: size[1] }, o), env);
    root.style.width = size[0] + "px"; root.style.height = size[1] + "px";
    host.appendChild(root);
    // the smallest element holding the word, and is it cut (wider than its box, or past the widget's edge)
    const els = [...root.querySelectorAll("*")].filter((e) => e.textContent.includes(word) && ![...e.children].some((c) => c.textContent.includes(word)));
    const r0 = root.getBoundingClientRect();
    return { text: root.textContent.replace(/\s+/g, " ").trim(), found: els.length,
      size: els.map((e) => e.scrollWidth + "/" + e.clientWidth + " r" + Math.round(e.getBoundingClientRect().right - r0.right) + " b" + Math.round(e.getBoundingClientRect().bottom - r0.bottom)).join(" "),
      cut: els.some((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > r0.right + 1 || e.getBoundingClientRect().bottom > r0.bottom + 1) };
  }, [o, data, wset || null, size, word]);
}
{
  const memD = { home: { memory: { photos: 4, dated: 3, today: [{ src: "demo/camp.jpg", years: 3, year: 2023 }], week: [] } } };
  for (const size of [[160, 160], [360, 160]]) {
    const a = await fit({ id: "m1", kind: "memory" }, memD, null, size, "ago"), y = await fit({ id: "m1", kind: "memory" }, memD, { ago: false }, size, "2023");
    ok(a.found && !a.cut && y.found && !y.cut && !/ago/.test(y.text), "memory.ago at " + size.join("x") + ": how long ago fits (" + a.text + "), off the year (" + y.text + ")");
  }
  const nd = { home: { note: { text: "Dinner at 6. Feed Max!", from: "Mum" } } };
  for (const size of [[160, 160], [360, 160]]) {
    const a = await fit({ id: "n1", kind: "note" }, nd, null, size, "Mum"), b = await fit({ id: "n1", kind: "note" }, nd, { byline: false }, size, "Dinner");
    ok(a.found && !a.cut && !/Mum/.test(b.text) && (size[0] < 300 || /From Mum/.test(a.text)), "note.byline at " + size.join("x") + ": who it is from fits (" + a.size + "), and off it goes (" + a.text + " / " + b.text + ")");
  }
  const ld = { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }, { t: "Avocados", done: false }, { t: "Bread", done: true }, { t: "Eggs", done: true }] }] } };
  const lon = await fit({ id: "l1", kind: "list" }, ld, null, [360, 160], "ticked"), loff = await fit({ id: "l1", kind: "list" }, ld, { done: false }, [360, 160], "left");
  ok(lon.found && !lon.cut && /2 left, 2 ticked/.test(lon.text) && !/ticked/.test(loff.text), "list.done at 360x160: ticked counted and it fits, off not (" + lon.text + " / " + loff.text + ")");
  const sd = { home: { screen: { ok: true, minutes: 125, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }, { name: "Netflix", minutes: 20 }] }, goal: 120 } };
  const sm = await fit({ id: "s1", kind: "screentime" }, sd, null, [760, 360], "YouTube"), s0 = await fit({ id: "s1", kind: "screentime" }, sd, { appcount: 0 }, [760, 360], "2h 5m");
  ok(sm.found && !sm.cut && !/YouTube/.test(s0.text), "screentime.appcount on Medium (760x360), the smallest size its help names: the apps fit, None hides them");
}

// ---- Welcome words: greeting, line under, name from, times ----
{
  const stay = { set: true, view: { phase: "during", guest: "Sarah", checkout: t0 + 2 * dayMs + 36000000 } };
  const wd = { home: { guest: "", stay } };
  await cycle("welcome.text", { id: "w1", kind: "welcome", opts: { text: "Welcome" } }, wd, { text: "Hi there" }, (d, s) => ok(/^Welcome/.test(d.text) && /Hi there/.test(s.text), "welcome.text: the greeting typed on this TV: " + s.text));
  await cycle("welcome.sub", { id: "w1", kind: "welcome" }, wd, { sub: "Make yourself at home" }, (d, s) => ok(!/Make yourself/.test(d.text) && /Make yourself at home/.test(s.text), "welcome.sub: the line under"));
  await cycle("welcome.source", { id: "w1", kind: "welcome" }, wd, { source: "calendar" }, (d, s) => ok(!/Sarah/.test(d.text) && /Welcome, Sarah/.test(s.text) && /Check out/.test(s.text), "welcome.source: the guest from the bookings calendar, with check out: " + s.text));
  await cycle("welcome.times", { id: "w1", kind: "welcome", opts: { source: "calendar" } }, wd, { times: false }, (d, s) => ok(/Check out/.test(d.text) && !/Check out/.test(s.text) && /Sarah/.test(s.text), "welcome.times: off hides the check out line"));
  const off = await draw({ id: "w1", kind: "welcome", opts: { source: "calendar" } }, wd, { source: "typed" });
  ok(!/Sarah/.test(off.text), "welcome.source: the design's calendar, set back to typed on this TV, shows no booking name");
}

// ---- Custom card: title, words, live number ----
{
  const cd = { cards: [{ title: "Solar today", value: "18.4 kWh" }, { title: "Pool", value: "26" }] };
  await cycle("card.label", { id: "c1", kind: "card" }, cd, { label: "Bins" }, (d, s) => ok(/Bins/.test(s.text) && !/Bins/.test(d.text), "card.label: a title typed on this TV makes it a typed card: " + s.text));
  await cycle("card.text", { id: "c1", kind: "card", opts: { label: "Note" } }, cd, { text: "Back at 5" }, (d, s) => ok(/Back at 5/.test(s.text) && /Note/.test(s.text) && !/Back at 5/.test(d.text), "card.text: the words typed on this TV"));
  await cycle("card.live", { id: "c1", kind: "card" }, cd, { live: "Pool" }, (d, s) => ok(s.text === "Pool26" || /Pool.*26/.test(s.text), "card.live: only the Pool card: " + s.text + " (default " + d.text + ")"));
}
await page.close();

// ================= B and C. the real home with all 14 =================
group = "B. appears only when on screen";
const pad = (v) => String(v).padStart(2, "0"), today = new Date(), ymdS = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:a", "DTSTART:" + utc(new Date(Date.now() + 10 * 60000)), "DTEND:" + utc(new Date(Date.now() + 40 * 60000)), "SUMMARY:Late swim", "END:VEVENT",
  "BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:" + ymdS(new Date(t0 + dayMs + 3600000)), "SUMMARY:Bins out", "END:VEVENT",
  "BEGIN:VEVENT", "UID:r", "DTSTART;VALUE=DATE:" + ymdS(new Date(t0 - dayMs + 3600000)), "DTEND;VALUE=DATE:" + ymdS(new Date(t0 + 3 * dayMs + 3600000)), "SUMMARY:Reserved - Sarah Smith", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");
const twoOff = new Date(t0 - 2 * dayMs + 3600000);
const PHOTOS = [{ id: "pa", url: "demo/beach.jpg" }, { id: "pb", url: "demo/dog.jpg" }, { id: "pc", url: "demo/camp.jpg" }, { id: "pd", url: "demo/surf.jpg" }, { id: "pe", url: "demo/hike.jpg" },
  { id: "pm", url: "demo/IMG_" + (twoOff.getFullYear() - 3) + pad(twoOff.getMonth() + 1) + pad(twoOff.getDate()) + "_101500.jpg" }];
const ATHOME = { v: 1, note: { text: "Dinner at 6", from: "Mum", at: 1 }, lists: [{ name: "Shopping", items: [{ t: "Milk" }, { t: "Bread", done: true }] }, { name: "Jobs", items: [{ t: "Mow the lawn" }] }],
  wifi: { ssid: "salt-and-sun", pass: "summer-swell", sec: "WPA" }, guide: [{ title: "Check out", text: "By 10am." }, { title: "Bins", text: "Red Tuesday." }],
  cal: { url: "https://calendar.example/family.ics" }, stay: { url: "https://bookings.example/stays.ics" }, guest: { name: "", at: 0 } };
const W14 = [
  ["agenda", 20, 20, 900, 250], ["wifi", 940, 20, 960, 250], ["screentime", 20, 290, 900, 250], ["welcome", 940, 290, 960, 250],
  ["list", 20, 560, 440, 250], ["guide", 480, 560, 440, 250], ["note", 940, 560, 440, 250], ["people", 1400, 560, 500, 110],
  ["card", 20, 830, 360, 230], ["memory", 400, 830, 300, 230], ["photo", 720, 830, 280, 230], ["slideshow", 1020, 830, 280, 230], ["mosaic", 1320, 830, 300, 230], ["artframe", 1640, 830, 260, 230]];
const designOf = (list) => ({ v: 1, background: { colour: "#26303f" }, elements: { dock: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: list.map((x) => ({ id: x[0].slice(0, 3) + "1", type: "widget", kind: x[0], x: x[1], y: x[2], w: x[3], h: x[4] })) });
const idOf = (kind) => kind.slice(0, 3) + "1";
const NAMES = {}; W14.forEach((x) => { NAMES[x[0]] = null; });

const HOME = ORIGIN + "/tv-home/web/index.html";
const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
tv.on("pageerror", (e) => errors.push("tv: " + e));
await tv.addInitScript((ics) => { window.MOCK_ICS = ics; }, ICS);
async function load(d, fresh) {
  if (fresh) {
    await tv.goto(HOME + "?mock=1&reset=1");
    await tv.evaluate(([a, p]) => { localStorage.clear(); localStorage.setItem("mock:tvhome.athome", JSON.stringify(a)); localStorage.setItem("mock:tvhome.settings", JSON.stringify({ s: { photos: p } })); }, [ATHOME, PHOTOS]);
  }
  await tv.evaluate((dz) => localStorage.setItem("tvdesigner.design", JSON.stringify(dz)), d);
  await tv.goto(HOME + "?mock=1&people=3&cards=1&design=local");
  await tv.waitForFunction(() => window.tv && window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o .cw"));
  await tv.waitForTimeout(1500);
}
await load(designOf(W14), true);
TVP = tv;
W14.forEach((x) => { NAMES[x[0]] = null; });
const names = await tv.evaluate((ks) => ks.map((k) => window.CouchWidgetCaps.get(k).name), W14.map((x) => x[0]));
W14.forEach((x, i) => { NAMES[x[0]] = names[i]; });

const press = async (p, k, wait) => { await p.keyboard.press(k); await p.waitForTimeout(wait || 160); };
async function closeSettings() { for (let k = 0; k < 6 && await tv.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(tv, "Escape", 250); await tv.waitForTimeout(700); }
async function homeSettingsWidgets() {
  await tv.evaluate(() => window.tv.settingsKey()); await tv.waitForTimeout(250); await press(tv, "Enter", 500);
  const secs = await tv.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
  const i = secs.indexOf("Designs");
  const at = await tv.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(tv, i > at ? "ArrowDown" : "ArrowUp", 80);
  await tv.waitForTimeout(200);
  // the rows and their headings (a heading is .shead, a row .srow), in order: the widgets are the rows
  // under the "Widgets on this home" heading, up to the next heading
  const rows = await tv.evaluate(() => [...document.querySelectorAll("#set-rows .srow, #set-rows .shead")].map((e) => (e.classList.contains("shead") ? "#" : "") + e.textContent.trim()));
  await closeSettings();
  const hi = rows.indexOf("#Widgets on this home");
  if (hi < 0) return [];
  const next = rows.findIndex((r, i) => i > hi && r.charAt(0) === "#");
  return rows.slice(hi + 1, next < 0 ? rows.length : next);
}
async function holdOn(id) {
  await tv.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await tv.waitForTimeout(200);
  await tv.keyboard.down("Enter"); await tv.waitForTimeout(900); await tv.keyboard.up("Enter"); await tv.waitForTimeout(300);
  const items = await tv.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  return items;
}
{
  const rows = (await homeSettingsWidgets()).join(" | ");
  W14.forEach((x) => ok(rows.indexOf(NAMES[x[0]] + ", ") >= 0, x[0] + ": in Home settings, Designs, Widgets on this home (" + NAMES[x[0]] + "): " + rows.slice(0, 400)));
  for (const x of W14) {
    const items = await holdOn(idOf(x[0]));
    ok(items[0] === "Settings" && items[1] === "Edit on the TV", x[0] + ": Hold OK offers Edit on the TV (" + items.join(", ") + ")");
    await press(tv, "Escape", 300);
  }
  const v = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => ({ key: w.key, n: w.settings.length, keys: w.settings.map((s) => s.key) })));
  W14.forEach((x) => {
    const w = v.find((y) => y.key === idOf(x[0]) + "|" + x[0]);
    ok(w && w.n > 0, x[0] + ": in what the phone gets (" + (w ? w.keys.join(",") : "missing") + ")");
  });
  ok(!JSON.stringify(v).includes("summer-swell") && !JSON.stringify(await tv.evaluate(() => window.tv.atHomeRead().design)).includes("family.ics"), "nothing private in what the phone gets for the widgets");
}
// the phone's Widgets on this TV
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await ctx.newPage();
phone.on("pageerror", (e) => errors.push("phone: " + e));
async function phoneKeys() {
  // a fresh page each time (the same address with only a # would not load it again)
  await phone.goto("about:blank");
  await phone.goto(ORIGIN + "/setup#pin=482913");
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  // (23 Nov) the phone opens on Widgets on your screen; the list these checks use is under More settings
  await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {});
  await phone.waitForFunction(() => document.querySelectorAll("#w-list details").length > 0 || document.getElementById("design-line").style.display === "", null, { timeout: 8000 });
  await phone.waitForTimeout(500);
  return phone.evaluate(() => [...document.querySelectorAll("#w-list details")].map((d) => d.getAttribute("data-key")));
}
{
  const keys = await phoneKeys();
  W14.forEach((x) => ok(keys.indexOf(idOf(x[0]) + "|" + x[0]) >= 0, x[0] + ": on the phone, Widgets on this TV"));
  // the phone changes one (Who shows on People): the TV's widget changes
  await phone.click('#w-list details[data-key="peo1|people"] summary');
  const box = await phone.textContent('#w-list details[data-key="peo1|people"]');
  ok(/Who shows/.test(box) && /Sam/.test(box) && /Show names/.test(box), "the phone's People box: Who shows (the TV's people) and Show names: " + box.slice(0, 160));
}
// C (part): set from the phone page itself
group = "C. each setting on the real home";
{
  const before = await tv.evaluate(() => document.querySelector('.cw-o[data-obj="peo1"] .cw').textContent);
  const cb = await phone.$$('#w-list details[data-key="peo1|people"] input[type=checkbox][data-wmany]');   // Who shows, not the Show names toggle
  ok(cb.length === 3, "the phone offers the TV's three people to tick: " + cb.length);
  await cb[1].check();
  await phone.waitForFunction(() => /Saved/.test(document.getElementById("w-msg").textContent), null, { timeout: 5000 });
  await tv.waitForTimeout(700);
  const after = await tv.evaluate(() => document.querySelector('.cw-o[data-obj="peo1"] .cw').textContent);
  ok(/Alex/.test(before) && /Jordan/.test(before) && after.trim() === "Sam", "phone, People, Who shows Sam: the TV shows only Sam (" + before + " -> " + after + ")");
}

// every setting through the TV's own store (the phone's widget_set): the widget on the home changes, and
// cleared it is back
const shot = (id) => tv.evaluate((i) => { const e = document.querySelector('.cw-o[data-obj="' + i + '"] .cw'); return e ? { text: e.textContent.replace(/\s+/g, " ").trim(), html: e.innerHTML, tiles: [...e.querySelectorAll("div")].filter((d) => /url\(/.test(d.style.backgroundImage)).length } : null; }, id);
async function setOn(kind, values) {
  const r = await tv.evaluate(([k, v]) => window.tv.atHomeEdit({ widget_set: { key: k, values: v } }), [idOf(kind) + "|" + kind, values]);
  await tv.waitForTimeout(900);
  return r;
}
// same(d, c): the cleared widget is the default again (a widget that changes by itself over time, like a
// card showing each live number in turn, says so with its own test)
async function e2e(kind, values, check, same) {
  const clear = {}; Object.keys(values).forEach((k) => { clear[k] = null; });
  await setOn(kind, clear);
  const d = await shot(idOf(kind));
  const r = await setOn(kind, values);
  ok(r && r.ok, kind + " " + JSON.stringify(values) + ": the TV takes it (" + (r && r.error) + ")");
  const s = await shot(idOf(kind));
  check(d, s);
  await setOn(kind, clear);
  const c = await shot(idOf(kind));
  ok(same ? await same(d, c) : c.text === d.text, kind + " " + Object.keys(values).join(",") + ": cleared, the widget is as before (" + d.text.slice(0, 60) + " / " + c.text.slice(0, 60) + ")");
}
await setOn("people", { who: null });
await tv.waitForTimeout(1500);   // the calendars read
await e2e("agenda", { calendars: "main" }, (d, s) => ok(/Late swim/.test(s.text) && !/Check (in|out)/.test(s.text), "agenda.calendars Your calendar: its own events, no stays: " + s.text));
// (the mock home hands both links the same calendar, so each of its events is also a stay here; the
// widget lists the first and counts the rest, so the check is: only stays, from the bookings link)
await e2e("agenda", { calendars: "bookings", days: "week" }, (d, s) => ok(/^This week/.test(s.text) && /Check (in|out), /.test(s.text) && /\d+ events/.test(s.text) && !/Late swim/.test(s.text) && s.text !== d.text,
  "agenda.calendars Bookings calendar, days This week: only check in and check out days from the bookings link: " + d.text + " -> " + s.text));
await e2e("agenda", { days: "week" }, (d, s) => ok(s.text !== d.text && /more/.test(s.text), "agenda.days This week: more events counted: " + d.text + " -> " + s.text));
await e2e("wifi", { hidepass: true }, (d, s) => ok(/summer-swell/.test(d.text) && !/summer-swell/.test(s.text), "wifi.hidepass: " + s.text));
await e2e("welcome", { text: "Hi there", sub: "Make yourself at home" }, (d, s) => ok(/Hi there/.test(s.text) && /Make yourself at home/.test(s.text), "welcome.text and sub: " + s.text));
await e2e("welcome", { source: "calendar" }, (d, s) => ok(/Sarah/.test(s.text) && /Check out/.test(s.text), "welcome.source bookings: the guest from the bookings link: " + s.text));
await setOn("welcome", { source: "calendar" });
await e2e("welcome", { times: false }, (d, s) => ok(/Check out/.test(d.text) && !/Check out/.test(s.text), "welcome.times off: " + s.text));
await setOn("welcome", { source: null });
await e2e("list", { list: "Jobs" }, (d, s) => ok(/Shopping/.test(d.text) && /Jobs/.test(s.text), "list.list Jobs: " + s.text));
await e2e("list", { done: false }, (d, s) => ok(/Bread/.test(d.text) && !/Bread/.test(s.text), "list.done off: " + s.text));
await e2e("guide", { sections: ["Bins"] }, (d, s) => ok(/Check out/.test(d.text) && !/Check out/.test(s.text) && /Bins/.test(s.text), "guide.sections Bins: " + s.text));
await e2e("note", { byline: false }, (d, s) => ok(/From Mum/.test(d.text) && !/From Mum/.test(s.text), "note.byline off: " + s.text));
await e2e("people", { names: false }, (d, s) => ok(/Sam/.test(d.text) && s.text === "", "people.names off: " + JSON.stringify(s.text)));
// (the mock TV's people are Alex, Sam and Jordan, with ids alex, sam and jordan)
await e2e("people", { who: ["jordan"] }, (d, s) => ok(/Alex/.test(d.text) && s.text === "Jordan", "people.who Jordan only: " + d.text + " -> " + s.text));
await e2e("people", { who: ["alex", "jordan"] }, (d, s) => ok(/Sam/.test(d.text) && /Alex/.test(s.text) && /Jordan/.test(s.text) && !/Sam/.test(s.text), "people.who Alex and Jordan: " + s.text));
await e2e("card", { label: "Bins", text: "Tuesday" }, (d, s) => ok(/Bins/.test(s.text) && /Tuesday/.test(s.text), "card.label and text: " + s.text));
// cleared, the card is back to each live number in turn (it moves on every 20 seconds): no live kept on
// this TV, and it shows one of the live numbers
await e2e("card", { live: "Bin night" }, (d, s) => ok(/Bin night/.test(s.text) && /Recycling/.test(s.text), "card.live Bin night: " + s.text),
  async (d, c) => { const st = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}"); return ((r.s || r).widgets || {})["car1|card"] || {}; }); return !("live" in st) && c.text.length > 0 && /cw-lab/.test(c.html); });
await e2e("memory", { range: "week" }, (d, s) => ok(/No photos from this day/.test(d.text) && /years ago/.test(s.text) && /This week/.test(s.text), "memory.range This week: the photo from two days off: " + s.text));
await setOn("memory", { range: "week" });
await e2e("memory", { ago: false }, (d, s) => ok(/years ago/.test(d.text) && !/years ago/.test(s.text), "memory.ago off: " + s.text));
await setOn("memory", { range: null });
await e2e("photo", { photo: "pb" }, (d, s) => ok(/dog\.jpg/.test(s.html), "photo.photo: the dog photo picked on this TV: " + s.html.slice(0, 120)));
await e2e("photo", { fit: "contain" }, (d, s) => ok(/contain/.test(s.html) && !/contain/.test(d.html), "photo.fit Fit the whole photo"));
await e2e("artframe", { photo: "pd" }, (d, s) => ok(/surf\.jpg/.test(s.html), "artframe.photo: the surf photo"));
await e2e("artframe", { mat: "#1d1b18" }, (d, s) => ok(/rgb\(29, 27, 24\)/.test(s.html), "artframe.mat Black"));
await e2e("slideshow", { seconds_each: 300 }, (d, s) => { const i = Math.floor(Date.now() / 300000) % 6; const f = /url\(&quot;([^&]*)&quot;\)|url\("([^"]*)"\)/.exec(s.html) || []; ok(String(f[1] || f[2]).endsWith(PHOTOS[i].url.split("/").pop()), "slideshow.seconds_each 5 minutes: the photo the count says (" + (f[1] || f[2]) + ")"); });
await e2e("slideshow", { shuffle: true }, (d, s) => ok(/url\(/.test(s.html), "slideshow.shuffle on: still this TV's photos"));
await e2e("mosaic", { count: 3 }, (d, s) => { const c = (x) => x.tiles; ok(c(s) === 3 && c(d) >= 3, "mosaic.count 3: " + c(s) + " (default " + c(d) + ")"); });
{
  // screen time on a TV without it says so; its setting is still there, and taken
  const r = await setOn("screentime", { appcount: 3 });
  ok(r.ok && /not on this TV/.test((await shot("scr1")).text), "screentime.appcount: kept; this TV has no screen time, and the widget says so");
  await setOn("screentime", { appcount: null });
}
// two through the TV's own rows (Hold OK, Edit on the TV, OK on the row)
async function tvRow(kind, re) {
  const items = await holdOn(idOf(kind));
  ok(items[1] === "Edit on the TV", kind + ": Edit on the TV");
  await press(tv, "ArrowDown", 120); await press(tv, "Enter", 700);
  for (let i = 0; i < 20; i++) { const t = await tv.evaluate(() => (document.querySelector("#set-rows .srow.focus") || {}).textContent || ""); if (re.test(t)) break; await press(tv, "ArrowDown", 100); }
  await press(tv, "Enter", 500);
  await closeSettings();
}
{
  const d = await shot("lis1");
  await tvRow("list", /^Show ticked items/);
  const s = await shot("lis1");
  ok(/Bread/.test(d.text) && !/Bread/.test(s.text), "list: OK on Show ticked items, on the TV's own page, hides Bread: " + s.text);
  await setOn("list", { done: null });
  const d2 = await shot("age1");
  await tvRow("agenda", /^Days/);
  const st = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}"); return (r.s || r).widgets["age1|agenda"]; });
  ok(st && st.days === "week" && (await shot("age1")).text !== d2.text, "agenda: OK on Days steps to This week, kept in Home settings, and the widget changes: " + JSON.stringify(st));
  await setOn("agenda", { days: null });
}

// a design without them: gone from Home settings, Hold OK has nothing to edit there, and the phone
group = "B. appears only when on screen";
await load(designOf([["note", 940, 560, 440, 250]]), false);
{
  const rows = (await homeSettingsWidgets()).join(" | ");
  W14.filter((x) => x[0] !== "note").forEach((x) => ok(rows.indexOf(NAMES[x[0]] + ", ") < 0, x[0] + ": removed from the design, gone from Widgets on this home"));
  ok(rows.indexOf("Family note, ") >= 0, "the note left on the design is still there: " + rows);
  const v = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => w.key));
  ok(v.length === 1 && v[0] === "not1|note", "what the phone gets is only the note: " + v.join(","));
  const keys = await phoneKeys();
  ok(keys.length === 1 && keys[0] === "not1|note", "the phone's Widgets on this TV is only the note: " + keys.join(","));
  ok(await tv.evaluate(() => !document.querySelector('.cw-o[data-obj="age1"]')), "and the agenda is not on the screen");
}

ok(!errors.length, "no page errors: " + errors.join("; "));
await ctx.close();
await browser.close();
server.close();
Object.keys(counts).forEach((g) => console.log("  " + g + ": " + counts[g] + " checks"));
console.log("OK: " + n + " checks");
