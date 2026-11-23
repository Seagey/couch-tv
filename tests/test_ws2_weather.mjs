// Widget swarm round 2, the weather group (weather, bigtemp, hourly, rain, uv, air, surf, sun, moon), in a
// real browser:
//  1. every setting changes the drawn widget, and clearing it goes back to the default (widgets.js, read
//     the way the TV hands them over: data().wset, data().wxAt);
//  2. the detail layers (OK on the widget) follow the same settings (air scale, surf units, the moon);
//  3. the whole TV home with a design of all nine: each widget's settings show in Home settings (Designs,
//     Widgets on this home), Hold OK, Edit on the TV, and the phone's Widgets on this TV, and vanish when
//     the widget is off the design;
//  4. end to end: a Place picked for each widget on this TV makes the TV ask Open-Meteo for that place
//     (forecast, air, marine), and the widget draws that place's own reading; °F; clearing goes back;
//  5. no town for the home, a widget with its own place still gets its reading;
//  6. a real TV never draws demo numbers.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_weather.mjs
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
// WS2_SOFT=1: list every failure at the end instead of stopping at the first
const soft = [];
const ok = (c, m) => { if (process.env.WS2_SOFT && !c) { soft.push(m); return; } assert.ok(c, m); n++; };
const has = (text, want, m) => ok(text.indexOf(want) >= 0, (m || "") + ": wanted \"" + want + "\" in \"" + text.slice(0, 300) + "\"");
const hasNot = (text, bad, m) => ok(text.indexOf(bad) < 0, (m || "") + ": \"" + bad + "\" must not show in \"" + text.slice(0, 300) + "\"");

// ---------------- a stand-in on-TV app: the TV home's files, /setup and its API ----------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const TOKEN = "t0k3n";
let TV = null;
const HS = { settings: { lang: "en", photos: [] }, people: [], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks), body = () => { try { return JSON.parse(raw.toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/tv-home/web/ws2.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false });
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/athome") {
        const r = TV ? await TV.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null;
        return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false });
      }
      if (route === "POST /api/athome") {
        const r = TV ? await TV.evaluate((x) => tv.atHomeEdit(x), body().edit) : null;
        if (!r) return send(res, 200, { ok: true, live: false, queued: true });
        return r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error || "That did not save." });
      }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: true, held: true });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, current: "0.13.9", checked: true });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();

// ================= 1 and 2. each setting, drawn =================
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(ORIGIN + "/tv-home/web/ws2.html");
await page.waitForFunction(() => window.CouchWidgets && window.CouchDetail && window.CouchWidgetCaps);

// what a person can see, not just what is in the page: each element with words of its own ("leaf"),
// its words, and how many of them show (inside its own box and the widget's, before any "…")
async function draw(o, env, opts, pg) {
  return (pg || page).evaluate(([o, env, opts]) => {
    if (window.CouchDetail.isOpen()) window.CouchDetail.close(true);
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
    document.body.appendChild(host);
    const root = window.CouchWidgets.render(Object.assign({ w: 760, h: 460 }, o), env);
    host.appendChild(root);
    const svgs = [...root.querySelectorAll("svg")].map((s) => s.getAttribute("style") || "");
    const out = { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1", svgs, deg: (root.textContent.match(/°/g) || []).length };
    const R = root.getBoundingClientRect(), leaves = [];
    [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
      if (el.closest("svg")) return;
      const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!nodes.length) return;
      const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
      // up and down: inside the widget (a big number's glyphs go past its own tight line), and inside its
      // own box only when it is cut to a number of lines
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
      const cut = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 ? 18 : 0;
      let t = "", vis = 0, gone = false;
      for (const nd of nodes) for (let i = 0; i < nd.textContent.length; i++) {
        const ch = nd.textContent[i]; t += ch;
        const rg = document.createRange(); rg.setStart(nd, i); rg.setEnd(nd, i + 1);
        const r = rg.getBoundingClientRect();
        const inside = r.width === 0 || (r.left >= Math.max(E.left, R.left) - 1 && r.right <= Math.min(E.right - cut, R.right) + 1 && r.top >= R.top - 1 && r.bottom <= (clamp ? Math.min(E.bottom, R.bottom) : R.bottom) + 1);
        if (!inside) gone = true;
        if (!gone) vis++;
      }
      leaves.push({ t: t.replace(/\s+/g, " ").trim(), raw: t, vis, fit: !gone });
    });
    out.leaves = leaves;
    out.seen = leaves.map((l) => l.raw.slice(0, l.vis).replace(/\s+/g, " ").trim()).join(" | ");
    if (opts && opts.layer) {
      const from = root.hasAttribute("data-act") ? root : root.querySelector("[data-act]") || root;
      window.CouchDetail.open(from, env, { designer: false });
      const st = document.querySelector(".cwd-stage");
      out.layer = st ? st.textContent.replace(/\s+/g, " ").trim() : "";
      out.layerSvgs = st ? [...st.querySelectorAll("svg")].map((s) => s.getAttribute("style") || "") : [];
      window.CouchDetail.close(true);
    }
    return out;
  }, [o, env, opts || null]);
}
// what a person sees: the words that show (not the ones cut off) and the pictures
const drawnSig = (r) => r.seen + " || " + r.svgs.join(";");
// how much of a name shows (at least 4 letters, or all of a short one, counts as named)
const shown = (r, name) => Math.max(0, ...r.leaves.filter((l) => l.raw.indexOf(name) >= 0).map((l) => Math.min(name.length, l.vis - l.raw.indexOf(name))));
const named = (r, name, m) => ok(shown(r, name) >= Math.min(4, name.length), m + ": wanted at least " + Math.min(4, name.length) + " letters of \"" + name + "\" to show, " + shown(r, name) + " do: " + r.seen);
const fits = (r, want, m) => { const l = r.leaves.filter((x) => x.t.indexOf(want) >= 0); ok(l.length && l.every((x) => x.fit), m + ": \"" + want + "\" shows in full: " + JSON.stringify(l.map((x) => [x.t, x.vis]))); };
const pad = (v) => String(v).padStart(2, "0");
const isoH = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":00";
const day = (i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const hourAt = (i) => { const d = new Date(); d.setMinutes(0, 0, 0); return isoH(new Date(d.getTime() + i * 3600000)); };
// the forecast as app.js weatherDirect hands it over (Celsius); uv: the UV each hour
function wx(temp, extra, uvs, rain) {
  return Object.assign({ temp, code: 1, hi: temp + 4, lo: temp - 6, uv: 7,
    hourly: Array.from({ length: 24 }, (_, i) => ({ time: hourAt(i), code: 1, temp: temp + (i % 3), pop: 5, uv: uvs ? uvs[i] || 0 : 3 })),
    daily: Array.from({ length: 7 }, (_, i) => ({ date: day(i), code: 1, lo: temp - 6, hi: temp + 4, sunrise: day(i) + "T05:40", sunset: day(i) + "T19:20", uv: 8, pop: 10 })),
    rain15: rain || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, extra || {});
}
const HOME = { name: "Hillside", lat: -33.6, lon: 151.1 };
const BEACH = { name: "Long Beach", lat: -33.5, lon: 151.4, timezone: "Australia/Sydney" };
const PERTH = { name: "Perth", lat: -31.95, lon: 115.86, timezone: "Australia/Perth" };
const PMQ = { name: "Port Macquarie", lat: -31.43, lon: 152.91, timezone: "Australia/Sydney" };
const LONDON = { name: "London", lat: 51.51, lon: -0.13, timezone: "Europe/London" };
const KEY = (p) => (+p.lat).toFixed(2) + "," + (+p.lon).toFixed(2);
const marine = (wave) => ({ wave, period: 9, dir: 120, wind: 37.04, windDir: 200, hourly: [wave, wave, wave] });
const air = (eu, us) => ({ aqi: eu, hourly: [eu, eu], us, usHourly: [us, us] });
const base = { weather: wx(24, { air: air(12, 40), marine: marine(1.2) }), place: HOME, country: "AU", unit: "c",
  wxAt: { [KEY(BEACH)]: wx(31, { air: air(55, 120), marine: marine(2.4) }, null, [0, 0, 0.5, 3, 4, 2, 0, 0, 0, 0, 0, 0]) } };
const env = (wset, more) => ({ data: Object.assign({}, base, { wset: wset || {} }, more || {}) });
const tested = {};   // kind.setting -> test name
const mark = (k, name) => { tested[k] = name; };

// weather
{
  const o = { id: "a", kind: "weather", opts: {} };
  const d0 = await draw(o, env());
  has(d0.text, "Hillside", "weather: the home's town by default"); has(d0.text, "24°", "weather: the home's temperature"); has(d0.text, "H:28° L:18°", "weather: the high and low by default");
  let r = await draw(o, env({ a: { place: false } }));
  hasNot(r.text, "Hillside", "weather, Show the town name off on this TV"); has(r.text, "24°", "weather: the temperature stays");
  r = await draw(Object.assign({}, o, { opts: { place: false } }), env());
  hasNot(r.text, "Hillside", "weather, Show the town name off in the design");
  r = await draw(o, env({ a: { hilo: false } }));
  hasNot(r.text, "H:", "weather, Show the high and low off"); has(r.text, "Hillside", "weather: the town stays");
  r = await draw(o, env({ a: { town: BEACH } }));
  has(r.text, "Long Beach", "weather, Place: the place picked"); has(r.text, "31°", "weather, Place: that place's own temperature"); hasNot(r.text, "Hillside", "weather, Place");
  r = await draw(o, env({ a: { town: BEACH } }, { wxAt: {} }));
  ok(r.empty && /Getting the weather for Long Beach/.test(r.text) && !/24°/.test(r.text), "weather, Place not read yet: waits, never the home's: " + r.text);
  r = await draw(o, env({ a: { degrees: "f" } }));
  has(r.text, "75°", "weather, Temperature in Fahrenheit: 24°C is 75°F"); has(r.text, "H:82° L:64°", "weather: the high and low in °F too");
  r = await draw(o, env({ a: { degrees: "c" } }, { unit: "f" }));
  has(r.text, "24°", "weather, Temperature in Celsius on a °F home");
  const fHome = await draw(o, env({}, { unit: "f" }));
  has(fHome.text, "75°", "weather, Temperature in Follow this TV: the home's °F");
  r = await draw(o, env({ a: { place: null, hilo: null, town: null, degrees: null } }));
  ok(r.text === d0.text, "weather: every setting cleared draws the default again");
  const L = await draw(o, env({ a: { town: BEACH, degrees: "f" } }), { layer: true });
  has(L.layer, "Long Beach", "weather layer: the widget's own place"); has(L.layer, "88° now", "weather layer: its own unit (31°C)");
  ["place", "hilo", "town", "degrees"].forEach((k) => mark("weather." + k, "1. weather"));
}
// bigtemp
{
  const o = { id: "b", kind: "bigtemp", opts: {} };
  const d0 = await draw(o, env());
  has(d0.text, "Hillside", "big number: the town"); has(d0.text, "24°", "big number: the temperature");
  let r = await draw(o, env({ b: { place: false } }));
  hasNot(r.text, "Hillside", "big number, Show the town name off");
  r = await draw(o, env({ b: { town: BEACH } }));
  has(r.text, "Long Beach", "big number, Place"); has(r.text, "31°", "big number, Place: its own temperature");
  r = await draw(o, env({ b: { degrees: "f" } }));
  has(r.text, "75°", "big number, Temperature in °F");
  r = await draw(o, env({ b: {} }));
  ok(r.text === d0.text, "big number: cleared, the default again");
  ["place", "town", "degrees"].forEach((k) => mark("bigtemp." + k, "1. bigtemp"));
}
// hourly
{
  const o = { id: "h", kind: "hourly", opts: {}, w: 1160, h: 460 };
  const d0 = await draw(o, env());
  const cols0 = d0.deg - 3;   // the hours, less the big temperature and the high and low
  ok(cols0 === 8, "hourly: as many as fit by default (8 in a wide box): " + cols0);
  let r = await draw(o, env({ h: { hours: 4 } }));
  ok(r.deg - 3 === 4, "hourly, How many hours 4: " + (r.deg - 3));
  r = await draw(o, env({ h: { hours: 6 } }));
  ok(r.deg - 3 === 6, "hourly, How many hours 6: " + (r.deg - 3));
  r = await draw(Object.assign({}, o, { opts: { hours: 4 } }), env());
  ok(r.deg - 3 === 4, "hourly, How many hours set in the design");
  r = await draw(Object.assign({}, o, { w: 460 }), env({ h: { hours: 8 } }));
  ok(r.deg - 3 === 5, "hourly, 8 hours in a small box: only as many as fit (5): " + (r.deg - 3));
  r = await draw(o, env({ h: { town: BEACH } }));
  has(r.text, "Long Beach", "hourly, Place"); has(r.text, "31°", "hourly, Place: its own hours");
  r = await draw(o, env({ h: { degrees: "f" } }));
  has(r.text, "75°", "hourly, Temperature in °F");
  r = await draw(o, env({ h: { hours: "auto", town: null, degrees: "auto" } }));
  ok(r.text === d0.text, "hourly: cleared, the default again");
  ["town", "hours", "degrees"].forEach((k) => mark("hourly." + k, "1. hourly"));
}
// rain
{
  const o = { id: "r", kind: "rain", opts: {} };
  const d0 = await draw(o, env());
  has(d0.text, "No rain coming", "rain: the home's dry hours");
  const r = await draw(o, env({ r: { town: BEACH } }));
  has(r.text, "Rain soon, Long Beach", "rain, Place: the heading says where"); ok(/Heavy rain from|Rain from/.test(r.text), "rain, Place: that place's rain: " + r.text);
  const c = await draw(Object.assign({}, o, { w: 460, h: 180 }), env({ r: { town: BEACH } }));
  has(c.text, "Long Beach", "rain, small: the place too"); fits(c, "Long Beach", "rain wide tile, the place in full"); fits(c, "Heavy rain from", "rain wide tile, the rain line in full");
  ok((await draw(o, env({ r: {} }))).text === d0.text, "rain: cleared, the default again");
  mark("rain.town", "1. rain");
}
// uv: the real sun protection times from the hourly UV
{
  const o = { id: "u", kind: "uv", opts: {} };
  const ramp = [0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const env2 = (ws) => ({ data: Object.assign({}, base, { weather: wx(24, { uv: 5 }, ramp), wset: ws || {}, wxAt: { [KEY(BEACH)]: wx(31, { uv: 11 }, ramp.map((v) => v + 4)) } }) });
  const d0 = await draw(o, env2());
  has(d0.text, "UV index", "uv: the heading"); has(d0.text, "5", "uv: the home's UV");
  const sameDay = hourAt(3).slice(0, 10) === hourAt(0).slice(0, 10) && hourAt(9).slice(0, 10) === hourAt(0).slice(0, 10);
  // (the same count at any time of day: late in the evening, a day that starts high, "until")
  if (sameDay) ok(/Sun protection \d{1,2}:\d{2}[ap]m to \d{1,2}:\d{2}[ap]m/.test(d0.text), "uv: sun protection times worked out from the real hourly UV: " + d0.text);
  else {
    const late = await draw(o, { data: Object.assign({}, base, { weather: wx(24, { uv: 5 }, [8, 2]) }) });
    ok(/Sun protection until \d{1,2}:\d{2}[ap]m/.test(late.text), "uv: sun protection until, worked out from the real hourly UV: " + late.text);
  }
  const r = await draw(o, env2({ u: { town: BEACH } }));
  has(r.text, "UV index, Long Beach", "uv, Place: the heading says where"); has(r.text, "11", "uv, Place: its own UV"); has(r.text, "Extreme", "uv, Place: its own band");
  ok((await draw(o, env2({ u: {} }))).text === d0.text, "uv: cleared, the default again");
  mark("uv.town", "1. uv");
}
// sun: a place in another time zone, by its own clock
{
  const o = { id: "s", kind: "sun", opts: {} };
  const d0 = await draw(o, env());
  const r = await draw(o, env({ s: { town: PERTH } }));
  has(r.text, "Sun, Perth", "sun, Place: the heading says where");
  ok(r.text !== d0.text, "sun, Place: Perth's sunrise is not the home's: " + d0.text + " / " + r.text);
  const exp = await page.evaluate(() => { const s = window.CouchWidgets.sunTimes(new Date(), -31.95, 115.86); return s.rise.toLocaleTimeString("en-AU", { timeZone: "Australia/Perth", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").toLowerCase(); });
  has(r.text, exp, "sun, Place: Perth's sunrise by Perth's own clock");
  ok((await draw(o, env({ s: {} }))).text === d0.text, "sun: cleared, the default again");
  mark("sun.town", "1. sun");
}
// moon: which way round
{
  const o = { id: "m", kind: "moon", opts: {} };
  const flipped = (r) => r.svgs.some((s) => /scaleX\(-1\)/.test(s));
  let r = await draw(o, env({}, { place: HOME }), { layer: true });
  ok(flipped(r) && r.layerSvgs.some((s) => /scaleX\(-1\)/.test(s)), "moon, This home's town south of the equator: drawn the southern way, and in the layer");
  r = await draw(o, env({}, { place: LONDON, country: "GB" }));
  ok(!flipped(r), "moon, This home's town in the north: the northern way");
  r = await draw(o, env({ m: { hemi: "south" } }, { place: LONDON, country: "GB" }), { layer: true });
  ok(flipped(r) && r.layerSvgs.some((s) => /scaleX\(-1\)/.test(s)), "moon, Moon seen from the south");
  r = await draw(o, env({ m: { hemi: "north" } }), { layer: true });
  ok(!flipped(r) && !r.layerSvgs.some((s) => /scaleX\(-1\)/.test(s)), "moon, Moon seen from the north");
  r = await draw(Object.assign({}, o, { w: 260, h: 260 }), env({ m: { hemi: "north" } }));
  ok(!flipped(r), "moon tile, the north");
  r = await draw(Object.assign({}, o, { w: 460, h: 180 }), env({ m: { hemi: "south" } }, { place: LONDON }));
  ok(flipped(r), "moon small, the south");
  r = await draw(o, env({}, { place: {}, country: "NZ" }));
  ok(flipped(r), "moon, no town: the home's country (New Zealand) decides");
  r = await draw(o, env({ m: {} }, { place: HOME }));
  ok(flipped(r), "moon: cleared, the default (This home's town) again");
  mark("moon.hemi", "1. moon");
}
// air: its own place and its scale
{
  const o = { id: "q", kind: "air", opts: {} };
  const d0 = await draw(o, env(), { layer: true });
  has(d0.text, "12", "air: the home's European reading in Australia"); has(d0.text, "Good", "air: its band"); has(d0.layer, "European air quality index", "air layer: names its scale");
  let r = await draw(o, env({ q: { scale: "us" } }), { layer: true });
  has(r.text, "40", "air, Scale American: the American number"); hasNot(r.text, "12", "air, Scale American"); has(r.layer, "American air quality index", "air layer: the American scale");
  r = await draw(o, env({}, { country: "US" }));
  has(r.text, "40", "air, Best for your country in the United States: American");
  r = await draw(o, env({ q: { scale: "eu" } }, { country: "US" }));
  has(r.text, "12", "air, Scale European in the United States");
  r = await draw(o, env({ q: { town: BEACH } }));
  has(r.text, "Air quality, Long Beach", "air, Place: the heading says where"); has(r.text, "55", "air, Place: its own reading"); has(r.text, "Moderate", "air, Place: its band");
  r = await draw(o, env({ q: { town: BEACH, scale: "us" } }));
  has(r.text, "120", "air, Place and American"); has(r.text, "Unhealthy for some", "air, American bands");
  r = await draw(o, env({ q: {} }), { layer: true });
  ok(r.text === d0.text, "air: cleared, the default again");
  mark("air.town", "1. air"); mark("air.scale", "1. air");
}
// surf: its beach, wave height and wind units
{
  const o = { id: "f", kind: "surf", opts: {} };
  const d0 = await draw(o, env(), { layer: true });
  has(d0.text, "1.2m", "surf: the home's swell in metres"); has(d0.text, "37 km/h", "surf: the wind in km/h");
  let r = await draw(o, env({ f: { place: BEACH } }));
  has(r.text, "Long Beach", "surf, Beach"); has(r.text, "2.4m", "surf, Beach: its own swell");
  r = await draw(o, env({ f: { units: "ft" } }), { layer: true });
  has(r.text, "4ft", "surf, Wave height in feet (1.2 m is 4 ft)"); has(r.layer, "4 ft", "surf layer, feet");
  r = await draw(o, env({ f: { wind: "kn" } }), { layer: true });
  has(r.text, "20 knots", "surf, Wind in knots (37 km/h is 20 knots)"); has(r.layer, "20 knots", "surf layer, knots");
  r = await draw(o, env({ f: { wind: "mph" } }));
  has(r.text, "23 mph", "surf, Wind in miles an hour");
  r = await draw(o, env({}, { country: "US" }));
  has(r.text, "4ft", "surf, Best for your country in the United States: feet"); has(r.text, "23 mph", "and miles an hour");
  r = await draw(o, env({ f: {} }), { layer: true });
  ok(r.text === d0.text && r.layer === d0.layer, "surf: cleared, the default again");
  mark("surf.place", "1. surf"); mark("surf.units", "1. surf"); mark("surf.wind", "1. surf");
}
// ---------------- every setting at every size the widget comes in ----------------
// (Fable 21 Nov: "Show the town name" and "Show the high and low" did nothing on the wide tile; a widget
// with a place of its own drew that place's reading with no name on the small sizes)
const CAPS0 = createRequire(import.meta.url)(path.join(ROOT, "tv-home/web/widget-caps.js"));
const PX = { tile: [160, 160], wtile: [360, 160], small: [360, 360], tall: [360, 560], medium: [760, 360], wide: [1160, 360], large: [760, 760] };
const sizesOf = (k) => CAPS0.get(k).sizes.s.filter((id) => PX[id]);
// each setting changed one way (on the home in Australia, south of the equator)
const VARY = {
  weather: { place: false, hilo: false, town: BEACH, degrees: "f" }, bigtemp: { place: false, town: BEACH, degrees: "f" },
  hourly: { hours: 4, town: BEACH, degrees: "f" }, rain: { town: BEACH }, uv: { town: BEACH }, sun: { town: PERTH },
  moon: { hemi: "north" }, air: { town: BEACH, scale: "us" }, surf: { place: BEACH, units: "ft", wind: "kn" }
};
// the only setting x size cases where nothing changes, each with why (checked: no others)
const SAME = {
  "weather.place tile": "a tile shows no town name to hide (only a widget's own place, checked below)",
  "bigtemp.place tile": "a tile shows no town name to hide (only a widget's own place, checked below)",
  "weather.hilo tile": "a tile shows only the sky and the temperature, no high and low"
};
let matrix = 0;
const wrong = [];
for (const kind of Object.keys(VARY)) {
  for (const sz of sizesOf(kind)) {
    const [w, h] = PX[sz], o = { id: "x", kind, opts: {}, w, h };
    const d0 = await draw(o, env());
    ok(!d0.empty, kind + " " + sz + ": draws a reading by default: " + d0.text);
    for (const key of Object.keys(VARY[kind])) {
      const r = await draw(o, env({ x: { [key]: VARY[kind][key] } }));
      const why = SAME[kind + "." + key + " " + sz];
      if (why ? drawnSig(r) !== drawnSig(d0) : drawnSig(r) === drawnSig(d0)) wrong.push(kind + "." + key + " at " + sz + " (" + w + " x " + h + ") " + (why ? "changed, but should not: " : "did not change: ") + d0.text + " / " + r.text);
      else n++;
      const back = await draw(o, env({ x: { [key]: null } }));
      ok(drawnSig(back) === drawnSig(d0), kind + "." + key + " at " + sz + ": cleared, the default again");
      matrix++;
    }
  }
}
ok(!wrong.length, "every setting changes the drawing at every size, but:\n  " + wrong.join("\n  "));
// every setting of every kind is in the matrix, at every size the kind comes in
Object.keys(VARY).forEach((k) => ok(CAPS0.settings(k).map((x) => x.key).sort().join() === Object.keys(VARY[k]).sort().join(), k + ": the matrix varies every one of its settings"));
const want = Object.keys(VARY).reduce((t, k) => t + sizesOf(k).length * Object.keys(VARY[k]).length, 0);
ok(Object.keys(SAME).length === 3, "3 setting x size cases draw the same, each with its reason: " + Object.keys(SAME).join(", "));
ok(matrix === want && want === 67, "the size matrix: " + matrix + " setting x size cases of " + want);
// the wide tile of the weather (Fable finding 1), exactly
{
  const o = { id: "x", kind: "weather", opts: {}, w: 360, h: 160 };
  const d0 = await draw(o, env());
  has(d0.text, "Hillside", "weather wide tile: the town by default"); has(d0.text, "28°", "weather wide tile: the high by default");
  let r = await draw(o, env({ x: { place: false } }));
  hasNot(r.text, "Hillside", "weather wide tile, Show the town name off"); has(r.text, "24°", "weather wide tile: the temperature stays"); has(r.text, "28°", "weather wide tile: the high stays");
  r = await draw(o, env({ x: { hilo: false } }));
  hasNot(r.text, "28°", "weather wide tile, Show the high and low off"); has(r.text, "Hillside", "weather wide tile: the town stays");
  r = await draw(o, env({ x: { place: false, hilo: false } }));
  ok(!/Hillside|28°/.test(r.text) && /24°/.test(r.text), "weather wide tile, both off: the sky and the temperature only: " + r.text);
  // the high shows in full on the wide tile (360 x 160), whatever the sky, and in the evening (tomorrow's)
  for (const code of [1, 2, 82]) {
    const c = await draw(o, { data: Object.assign({}, base, { weather: wx(24, { code }) }) });
    fits(c, "28°", "weather wide tile, sky " + code + ", the high");
    const c2 = await draw(o, { data: Object.assign({}, base, { weather: wx(24, { code }), wset: { x: { place: false } } }) });
    fits(c2, "28°", "weather wide tile, sky " + code + ", no town name, the high");
  }
  const eve = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const at7 = new Date(); at7.setHours(19, 30, 0, 0);
  await eve.clock.setFixedTime(at7);
  await eve.goto(ORIGIN + "/tv-home/web/ws2.html");
  await eve.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps);
  const e1 = await draw(o, env(), null, eve);
  has(e1.text, "Tomorrow", "weather wide tile at 7:30pm: looks ahead to tomorrow"); fits(e1, "28°", "weather wide tile at 7:30pm, tomorrow's high");
  fits(e1, "Tomorrow", "weather wide tile at 7:30pm, the word tomorrow");
  // tomorrow's sky in words, in full, with the town name on and off, for a clear and a rainy tomorrow
  for (const [code, words] of [[1, "Mostly clear"], [61, "Light rain"], [82, "Heavy showers"]]) {
    const tw = wx(24); tw.daily = tw.daily.map((d, i) => Object.assign({}, d, { code: i === 1 ? code : 1 }));
    for (const set of [{}, { place: false }]) {
      const r = await draw(o, { data: Object.assign({}, base, { weather: tw, wset: { x: set } }) }, null, eve);
      fits(r, words, "weather wide tile at 7:30pm, tomorrow's sky in words (" + code + (set.place === false ? ", no town name" : "") + ")");
      fits(r, "Tomorrow", "and the word tomorrow"); fits(r, "28°", "and tomorrow's high");
      if (set.place !== false) fits(r, "Hillside", "and the town");
    }
  }
  const e3 = await draw(o, env({ x: { place: false } }), null, eve);
  fits(e3, "28°", "weather wide tile at 7:30pm, no town name, tomorrow's high"); fits(e3, "Tomorrow", "and the word tomorrow");
  const e2 = await draw(o, env({ x: { hilo: false } }), null, eve);
  hasNot(e2.text, "28°", "weather wide tile at 7:30pm, Show the high and low off");
  await eve.close();
}
// the surf's wide tile has room for the wind, in its own unit
{
  const r = await draw({ id: "x", kind: "surf", opts: {}, w: 360, h: 160 }, env({ x: { wind: "kn" } }));
  fits(r, "knots", "surf wide tile, Wind in knots"); fits(r, "swell", "surf wide tile, the swell");
}
// a widget with a place of its own names it at every size (Fable finding 2)
{
  const OWN = { weather: ["town", BEACH], bigtemp: ["town", BEACH], hourly: ["town", BEACH], rain: ["town", BEACH], uv: ["town", BEACH], sun: ["town", PERTH], air: ["town", BEACH], surf: ["place", BEACH] };
  const uvRamp = [0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const kind of Object.keys(OWN)) for (const sz of sizesOf(kind)) {
    const [w, h] = PX[sz], [key, pl] = OWN[kind];
    const r = await draw({ id: "x", kind, opts: {}, w, h }, env({ x: { [key]: pl } }));
    fits(r, pl.name, kind + " " + sz + " (" + w + " x " + h + ") with a place of its own names it, in full");
    if (sz !== "tile") fits(await draw({ id: "x", kind, opts: {}, w, h }, env({ x: { [key]: PMQ } }, { wxAt: Object.assign({}, base.wxAt, { [KEY(PMQ)]: base.wxAt[KEY(BEACH)] }) })), "Port Macquarie", kind + " " + sz + ", Port Macquarie in full");
  }
  // "Show the town name" off hides a widget's own place on the tiles too
  for (const kind of ["weather", "bigtemp"]) {
    const r = await draw({ id: "x", kind, opts: {}, w: 160, h: 160 }, env({ x: { town: BEACH, place: false } }));
    hasNot(r.text, "Long Beach", kind + " tile: its own place, with Show the town name off");
    has(r.text, "31°", kind + " tile: still that place's own temperature");
  }
  // long place names stay inside the widget at every size
  const LONGP = { name: "Port Macquarie Hastings Lighthouse Beach North", lat: -33.5, lon: 151.4, timezone: "Australia/Sydney" };
  const LP = { [KEY(LONGP)]: base.wxAt[KEY(BEACH)] };
  for (const kind of Object.keys(OWN)) for (const sz of sizesOf(kind)) {
    const [w, h] = PX[sz], key = OWN[kind][0];
    const out = await page.evaluate(([o, e]) => {
      document.querySelectorAll(".ws-host").forEach((x) => x.remove());
      const host = document.createElement("div"); host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
      document.body.appendChild(host);
      const root = window.CouchWidgets.render(o, e); host.appendChild(root);
      const R = root.getBoundingClientRect(), bad = [];
      root.querySelectorAll("*").forEach((n) => {
        if (n.closest("svg") && n.tagName.toLowerCase() !== "svg") return;
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (r.left < R.left - 1 || r.top < R.top - 1 || r.right > R.right + 1 || r.bottom > R.bottom + 1) bad.push(n.tagName + "." + n.className + " " + JSON.stringify((n.textContent || "").slice(0, 30)) + " " + Math.round(r.left - R.left) + "," + Math.round(r.top - R.top) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      });
      return bad;
    }, [{ id: "x", kind, opts: {}, w, h }, env({ x: { [key]: LONGP } }, { wxAt: LP })]);
    ok(!out.length, kind + " " + sz + " (" + w + " x " + h + ") with a long place name: everything inside the widget: " + out.join("; "));
    named(await draw({ id: "x", kind, opts: {}, w, h }, env({ x: { [key]: LONGP } }, { wxAt: LP })), LONGP.name, kind + " " + sz + " with a long place name: the start of it shows");
  }
  void uvRamp;
}
// a place whose time zone is not known: its sun times are by this TV's clock, and it says so (finding 5)
{
  const PERTH_NO_ZONE = Object.assign({}, PERTH, { timezone: "auto" });
  for (const sz of sizesOf("sun")) {
    const [w, h] = PX[sz];
    const r = await draw({ id: "x", kind: "sun", opts: {}, w, h }, env({ x: { town: PERTH_NO_ZONE } }));
    fits(r, "TV", "sun " + sz + ", a place with no time zone: says the times are by this TV's clock");
    ok(/TV('s)? clock/.test(r.text), "sun " + sz + ": the words say clock: " + r.text);
    named(r, "Perth", "sun " + sz + ": still names the place");
    const own = await draw({ id: "x", kind: "sun", opts: {}, w, h }, env({ x: { town: PERTH } }));
    hasNot(own.text, "TV clock", "sun " + sz + ", a place with its own time zone: its own clock, nothing to say"); hasNot(own.text, "TV's clock", "sun " + sz);
  }
}

// a real TV never draws demo numbers: no reading, no numbers
{
  for (const kind of ["weather", "bigtemp", "hourly", "rain", "uv", "air", "surf", "sun"]) {
    const r = await draw({ id: "z", kind, opts: {} }, { data: { place: {} } });
    ok(r.empty && !/Riverside|\b24°|1\.4m|\b18\b/.test(r.text), kind + ": with no town, no demo reading: " + r.text);
  }
}
ok(!errors.length, "no page errors: " + errors.join("; "));
await page.close();

// every setting of these kinds is before launch (pre) and was tested above
const CAPS = createRequire(import.meta.url)(path.join(ROOT, "tv-home/web/widget-caps.js"));
const KINDS = ["weather", "bigtemp", "hourly", "rain", "uv", "air", "surf", "sun", "moon"];
KINDS.forEach((k) => {
  const list = CAPS.settings(k);
  ok(list.length >= 1, k + " has something to set");
  list.forEach((s) => { ok(s.pre === true, k + "." + s.key + " is on (pre)"); ok(!!tested[k + "." + s.key], k + "." + s.key + " was tested"); });
});

// ================= 3, 4 and 5. the whole TV home =================
const asked = [];
const BELLS = { id: 9, name: "Bells Beach", latitude: -38.36831, longitude: 144.28170, timezone: "Australia/Sydney", admin1: "Victoria", country: "Australia" };
async function meteo(p) {
  await p.route(/open-meteo\.com/, (route) => {
    const u = new URL(route.request().url()), lat = u.searchParams.get("latitude"), far = lat === "-38.37";
    asked.push(u.host + " " + lat + "," + u.searchParams.get("longitude") + " " + (u.searchParams.get("current") || ""));
    if (u.host.startsWith("geocoding")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [BELLS] }) });
    if (u.host.startsWith("marine")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { wave_height: far ? 2.6 : 0.9, wave_period: 12, wave_direction: 150 }, hourly: { time: [], wave_height: [] } }) });
    if (u.host.startsWith("air")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { european_aqi: far ? 66 : 12, us_aqi: far ? 140 : 40 }, hourly: { time: [], european_aqi: [], us_aqi: [] } }) });
    const cur = u.searchParams.get("current") || "";
    if (/wind_speed/.test(cur)) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { wind_speed_10m: 12, wind_direction_10m: 200 } }) });
    const t = far ? 30 : 22, times = Array.from({ length: 24 }, (_, i) => hourAt(i));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      current: { temperature_2m: t, weather_code: 1, is_day: 1, time: hourAt(0) },
      hourly: { time: times, temperature_2m: times.map(() => t), weather_code: times.map(() => 1), uv_index: times.map(() => (far ? 12 : 6)), precipitation_probability: times.map(() => 5) },
      daily: { time: [day(0), day(1)], weather_code: [1, 1], temperature_2m_max: [t + 3, t + 3], temperature_2m_min: [t - 5, t - 5], sunrise: [day(0) + "T05:40", day(1) + "T05:40"], sunset: [day(0) + "T19:20", day(1) + "T19:20"], uv_index_max: [far ? 12 : 6, 6], precipitation_probability_max: [5, 5] },
      minutely_15: { precipitation: far ? [0, 0, 1, 3, 4, 2, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }) });
  });
}
const OBJ = [["wx", "weather", 40, 40, 460, 300], ["bt", "bigtemp", 520, 40, 460, 300], ["hr", "hourly", 1000, 40, 880, 300], ["rn", "rain", 40, 380, 460, 300],
  ["uv", "uv", 520, 380, 460, 300], ["aq", "air", 1000, 380, 460, 300], ["sf", "surf", 1460, 380, 460, 300], ["sn", "sun", 40, 720, 460, 300], ["mn", "moon", 520, 720, 460, 300]];
const NAMES = { weather: "Weather", bigtemp: "Big number", hourly: "Hourly", rain: "Rain soon", uv: "UV index", air: "Air quality", surf: "Surf", sun: "Sunrise and sunset", moon: "Moon" };
const design = { v: 1, background: { colour: "#1d3a4f" }, elements: { clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true }, dock: { hidden: true } },
  objects: OBJ.map(([id, kind, x, y, w, h]) => ({ id, type: "widget", kind, x, y, w, h, opts: {} })).concat([{ id: "n", type: "widget", kind: "news", x: 1000, y: 720, w: 560, h: 220, opts: { feed: "abc" } }]) };
const without = { v: 1, background: { colour: "#1d3a4f" }, elements: design.elements, objects: [{ id: "n", type: "widget", kind: "news", x: 1000, y: 720, w: 560, h: 220, opts: { feed: "abc" } }] };
const press = async (p, k, wait) => { await p.keyboard.press(k); await p.waitForTimeout(wait || 160); };
async function tvPage(d, q, keep) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.errors = []; p.on("pageerror", (e) => p.errors.push(String(e)));
  await meteo(p);
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1" + (keep ? "" : "&reset=1"));
  await p.evaluate(([dz, keep]) => { if (!keep) localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, [d, !!keep]);
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&wxlive=1&design=local" + (q || ""));
  await p.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on());
  await p.waitForTimeout(1200);
  return p;
}
const secs = (p) => p.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
const rowsText = (p) => p.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
async function openSettings(p) { await p.evaluate(() => window.tv.settingsKey()); await p.waitForTimeout(250); await press(p, "Enter", 500); }
// Back closes Home settings; five Backs within 4 s switch a design off (design.js), so wait that out
async function closeSettings(p) { for (let k = 0; k < 6 && await p.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(p, "Escape", 250); await p.waitForTimeout(4200); }
async function goSec(p, name) {
  const list = await secs(p), i = list.indexOf(name);
  assert.ok(i >= 0, "section " + name + " in " + list.join(", "));
  for (let k = 0; k < 4 && await p.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press(p, "ArrowLeft", 120);
  const at = await p.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(p, i > at ? "ArrowDown" : "ArrowUp", 80);
  await p.waitForTimeout(150);
}
async function holdOn(p, id) {
  await p.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await p.waitForTimeout(200);
  await p.keyboard.down("Enter"); await p.waitForTimeout(900); await p.keyboard.up("Enter"); await p.waitForTimeout(300);
  const items = await p.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  return items;
}
const objText = (p, id) => p.evaluate((x) => ((document.querySelector('.cw-o[data-obj="' + x + '"]') || {}).textContent || "").replace(/\s+/g, " ").trim(), id);
const labelsOf = (kind) => CAPS.settings(kind).filter((s) => s.pre && s.where.some((w) => w === "tv" || w === "phone")).map((s) => s.label);

const tv = await tvPage(design);
TV = tv;
{
  // Home settings, Designs: Widgets on this home lists each of the nine with its own settings
  await openSettings(tv);
  await goSec(tv, "Designs");
  const rows = (await rowsText(tv)).join(" | ");
  for (const [, kind] of OBJ) {
    has(rows, NAMES[kind] + ",", "Home settings, Widgets on this home: " + kind);
    has(rows, labelsOf(kind)[0] + ":", "Home settings: " + kind + " shows its first setting, " + labelsOf(kind)[0]);
  }
  await closeSettings(tv);
  // Hold OK on each: Edit on the TV opens that widget's own page with each of its settings
  for (const [id, kind] of OBJ) {
    const menu = await holdOn(tv, id);
    ok(menu[0] === "Settings" && menu[1] === "Edit on the TV", kind + ": Hold OK offers Edit on the TV (" + menu.join(", ") + ")");
    await press(tv, "ArrowDown", 120); await press(tv, "Enter", 600);
    const head = await tv.textContent("#set-head"), pg = (await rowsText(tv)).join(" | ");
    has(head, NAMES[kind] + ",", kind + ": Edit on the TV opens its own page");
    labelsOf(kind).forEach((l) => has(pg, l, kind + ": its page has " + l));
    await closeSettings(tv);
  }
  // what the phone reads (atHomeRead, the on-TV app's /api/athome): each widget with its settings
  const v = await tv.evaluate(() => window.tv.atHomeRead().design.widgets);
  for (const [id, kind] of OBJ) {
    const w = v.find((x) => x.key === id + "|" + kind);
    ok(!!w, kind + ": the phone hears of it");
    ok(w && CAPS.settings(kind).every((s) => w.settings.some((x) => x.key === s.key)), kind + ": with every setting: " + (w && w.settings.map((s) => s.key).join(",")));
  }
}
// the phone page: Widgets on this TV, one box per widget, with its settings
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await ctx.newPage();
phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
await meteo(phone);
await phone.goto(ORIGIN + "/setup#pin=482913");
await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
// (23 Nov) the phone opens on Widgets on your screen; the list these checks use is under More settings
await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {});
await phone.waitForFunction(() => document.querySelectorAll("#w-list details").length > 0, null, { timeout: 10000 });
{
  const titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent));
  for (const [id, kind] of OBJ) {
    ok(titles.some((t) => t.indexOf(NAMES[kind] + ",") === 0), "phone, Widgets on this TV: " + kind + " (" + titles.join(" / ") + ")");
    const box = await phone.textContent('#w-list details[data-key="' + id + "|" + kind + '"]');
    labelsOf(kind).forEach((l) => has(box, l, "phone: " + kind + " has " + l));
  }
  // a Place from the phone: a town search, for the weather widget
  await phone.click('#w-list details[data-key="wx|weather"] summary');
  await phone.fill('#w-list input[data-wq][data-wk="wx|weather"]', "Bells");
  await phone.waitForSelector('#w-list details[data-key="wx|weather"] button[data-wp="0"]');
  await phone.click('#w-list details[data-key="wx|weather"] button[data-wp="0"]');
  await phone.waitForFunction(() => /Bells Beach/.test(document.getElementById("w-msg").textContent), null, { timeout: 8000 });
  await tv.waitForFunction(() => /Bells Beach/.test((document.querySelector('.cw-o[data-obj="wx"]') || {}).textContent || ""), null, { timeout: 10000 });
  const t = await objText(tv, "wx");
  has(t, "30°", "phone picks Bells Beach for the weather widget: the TV draws Bells Beach's own 30°");
  ok(asked.some((a) => /^api\.open-meteo\.com -38\.37,144\.28 temperature/.test(a)), "the TV asked Open-Meteo for Bells Beach's forecast");
  // the phone's choice: Temperature in Fahrenheit
  await phone.selectOption('#w-list select[data-wk="wx|weather"][data-ws="degrees"]', "f");
  await phone.waitForFunction(() => /Saved/.test(document.getElementById("w-msg").textContent));
  await tv.waitForFunction(() => /86°/.test((document.querySelector('.cw-o[data-obj="wx"]') || {}).textContent || ""), null, { timeout: 8000 });
  ok(true, "phone, Temperature in Fahrenheit: the TV draws 86°");
}
// end to end on the TV: a place for every other widget, read for that place
{
  const P = { name: "Bells Beach", lat: -38.37, lon: 144.28, timezone: "Australia/Sydney" };
  for (const [id, kind] of OBJ) {
    if (kind === "moon" || kind === "weather") continue;
    const k = kind === "surf" ? "place" : "town";
    const r = await tv.evaluate((e) => window.tv.atHomeEdit(e), { widget_set: { key: id + "|" + kind, values: { [k]: P } } });
    ok(r.ok, kind + ": a place set on the TV saves");
  }
  await tv.waitForFunction(() => /2\.6/.test((document.querySelector('.cw-o[data-obj="sf"]') || {}).textContent || "") && /66/.test((document.querySelector('.cw-o[data-obj="aq"]') || {}).textContent || ""), null, { timeout: 10000 });
  ok(asked.some((a) => /^marine.* -38\.37,144\.28/.test(a)), "the swell is asked for Bells Beach");
  ok(asked.some((a) => /^air-quality.* -38\.37,144\.28 european_aqi,us_aqi/.test(a)), "the air is asked for Bells Beach, both scales");
  const want = { bt: ["Bells Beach", "30°"], hr: ["Bells Beach", "30°"], rn: ["Bells Beach", "ain from"], uv: ["Bells Beach", "12"],
    aq: ["Bells Beach", "66"], sf: ["Bells Beach", "2.6"], sn: ["Bells Beach"] };   // 460 wide: the place's name is the heading
  for (const id of Object.keys(want)) { const t = await objText(tv, id); want[id].forEach((w) => has(t, w, id + " on the TV, its own place")); }
  // the TV's own choices for air, surf and the moon, drawn
  await tv.evaluate(() => { window.tv.atHomeEdit({ widget_set: { key: "aq|air", values: { scale: "us" } } }); window.tv.atHomeEdit({ widget_set: { key: "sf|surf", values: { units: "ft", wind: "kn" } } });
    window.tv.atHomeEdit({ widget_set: { key: "mn|moon", values: { hemi: "north" } } }); window.tv.atHomeEdit({ widget_set: { key: "hr|hourly", values: { hours: 4 } } }); });
  await tv.waitForTimeout(800);
  has(await objText(tv, "aq"), "140", "air, Scale American on the TV");
  const sf = await objText(tv, "sf"); has(sf, "8.5ft", "surf, feet on the TV (2.6 m)"); has(sf, "6 knots", "surf, knots on the TV (12 km/h)");
  ok(!(await tv.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="mn"] svg')].some((s) => /scaleX\(-1\)/.test(s.getAttribute("style") || "")))), "moon, the north on the TV");
  ok((await objText(tv, "hr")).match(/°/g).length === 7, "hourly, 4 hours on the TV (and the big temperature, high and low)");
  // a choice that is not one is refused
  ok((await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "sf|surf", values: { units: "furlongs" } } }))).ok === false, "surf: a unit that is not a choice is refused");
  // clearing: back to the home's town and the defaults
  for (const [id, kind] of OBJ) {
    const vals = {}; CAPS.settings(kind).forEach((s) => { vals[s.key] = null; });
    await tv.evaluate((e) => window.tv.atHomeEdit(e), { widget_set: { key: id + "|" + kind, values: vals } });
  }
  await tv.waitForFunction(() => /22°/.test((document.querySelector('.cw-o[data-obj="wx"]') || {}).textContent || "") && /0\.9/.test((document.querySelector('.cw-o[data-obj="sf"]') || {}).textContent || ""), null, { timeout: 10000 });
  hasNot(await objText(tv, "wx"), "Bells", "cleared: the weather widget is the home's town again");
  hasNot(await objText(tv, "aq"), "Bells", "cleared: the air is the home's again");
  ok(await tv.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="mn"] svg')].some((s) => /scaleX\(-1\)/.test(s.getAttribute("style") || ""))), "cleared: the moon follows the home's town (Sydney, the south) again");
  const st = await tv.evaluate(() => { const r = JSON.parse(localStorage.getItem("mock:tvhome.settings") || localStorage.getItem("tvhome.settings") || "{}"); return (r.s || r).widgets || {}; });
  ok(!Object.keys(st).some((k) => /\|(weather|bigtemp|hourly|rain|uv|air|surf|sun|moon)$/.test(k)), "cleared: nothing kept on the TV: " + JSON.stringify(st));
  ok(!tv.errors.length && !phone.errors.length, "no page errors: " + tv.errors.concat(phone.errors).join("; "));
}
// off the design: the settings vanish from all three
{
  const tv2 = await tvPage(without, "", true);
  TV = tv2;
  await openSettings(tv2); await goSec(tv2, "Designs");
  const rows = (await rowsText(tv2)).join(" | ");
  for (const [, kind] of OBJ) ok(rows.indexOf(NAMES[kind] + ",") < 0, "off the design, Home settings no longer lists " + kind);
  has(rows, "Headlines,", "the widget still on the design is still listed");
  await closeSettings(tv2);
  const v = await tv2.evaluate(() => window.tv.atHomeRead().design.widgets.map((w) => w.key));
  ok(v.length === 1 && v[0] === "n|news", "off the design, the phone hears only of the headlines: " + v.join(","));
  const menu = await holdOn(tv2, "n");
  ok(menu.indexOf("Edit on the TV") >= 0, "Hold OK still works on what is left");
  await press(tv2, "Escape", 300);
  ok(!(await tv2.evaluate(() => document.querySelector('.cw-o[data-obj="wx"]'))), "no weather widget on the screen to hold");
  ok((await tv2.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "wx|weather", values: { degrees: "f" } } }))).ok === false, "a setting for a widget that is off the design is refused");
  await phone.reload();
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  await phone.waitForFunction(() => document.querySelectorAll("#w-list details").length > 0, null, { timeout: 10000 });
  const titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent));
  ok(titles.length === 1 && /^Headlines,/.test(titles[0]), "off the design, the phone's Widgets on this TV shows only the headlines: " + titles.join(" / "));
  ok(!tv2.errors.length, "no page errors: " + tv2.errors.join("; "));
  await tv2.close();
}
await ctx.close();
await tv.close();
// no town for the home: a widget with a place of its own still gets that place's reading
{
  // the mock home with no town at all (?nowx=1: no weather in its config, nothing in Home settings)
  const tv3 = await tvPage({ v: 1, background: { colour: "#1d3a4f" }, objects: [{ id: "wx", type: "widget", kind: "weather", x: 40, y: 40, w: 460, h: 300 }, { id: "bt", type: "widget", kind: "bigtemp", x: 600, y: 40, w: 460, h: 300 }] }, "&nowx=1");
  ok(/Set your town|Your town's weather/.test(await objText(tv3, "wx")), "no home town: the weather says it needs the town");
  const r = await tv3.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "wx|weather", values: { town: { name: "Bells Beach", lat: -38.37, lon: 144.28, timezone: "Australia/Sydney" } } } }));
  ok(r.ok, "a place for the weather widget saves with no home town");
  await tv3.waitForFunction(() => /30°/.test((document.querySelector('.cw-o[data-obj="wx"]') || {}).textContent || ""), null, { timeout: 10000 });
  const a = await objText(tv3, "wx"), b = await objText(tv3, "bt");
  has(a, "Bells Beach", "no home town: the widget with its own place shows it"); has(a, "30°", "with that place's reading");
  ok(/Set your town|Your town's weather/.test(b), "the widget without one still asks for the town, never Bells Beach's: " + b);
  hasNot(b, "30°", "never another widget's place");
  ok(!tv3.errors.length, "no page errors: " + tv3.errors.join("; "));
  await tv3.close();
}

await browser.close();
server.close();
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
