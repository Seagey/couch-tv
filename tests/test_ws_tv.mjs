// Widget settings, the TV's widgets (Group 2): in a real browser, mock designs drawn by widgets.js and
// opened in widget-detail.js, checking that
//  1. every widget reads its own settings set on this TV (env.wset, or app.js data().wset) before its
//     design's opts, then the widget-caps.js default; a stack item has its own;
//  2. headings are honest: the surf names where the swell is read, never a starter's "North Point";
//     a camera, sensor, energy or doorbell is called by its own name unless it was picked on this TV;
//     the agenda never says a day it is not; Headlines and Scores never name another source;
//  3. °F: every temperature drawn (weather, big number, hourly, week, date, aircon, sensor, the
//     forecast layer) follows the home's unit;
//  4. a real TV never shows the demo, and empty states are plain words that send nobody to a
//     control that does not exist.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws_tv.mjs
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/tv-home/web/ws-tv.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const f = path.join(ROOT, path.normalize(u).replace(/^(\.\.[/\\])+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL0 = "http://127.0.0.1:" + server.address().port + "/tv-home/web/ws-tv.html";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const has = (text, want, m) => ok(text.indexOf(want) >= 0, (m || "") + ": wanted \"" + want + "\" in \"" + text.slice(0, 300) + "\"");
const hasNot = (text, bad, m) => ok(text.indexOf(bad) < 0, (m || "") + ": \"" + bad + "\" must not show in \"" + text.slice(0, 300) + "\"");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL0);
await page.waitForFunction(() => window.CouchWidgets && window.CouchDetail && window.CouchWidgetCaps && window.CouchWidgetWeb);

// draw one widget (a mock design object) with env (functions in env.data cannot cross: none needed);
// opts.layer opens its detail layer too. Answers the words drawn.
async function draw(o, env, opts) {
  return page.evaluate(([o, env, opts]) => {
    if (window.CouchDetail.isOpen()) window.CouchDetail.close(true);
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
    document.body.appendChild(host);
    const root = window.CouchWidgets.render(Object.assign({ w: 760, h: 460 }, o), env);
    host.appendChild(root);
    const out = { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1" };
    if (opts && opts.layer) {
      const from = root.hasAttribute("data-act") ? root : root.querySelector("[data-act]") || root;
      window.CouchDetail.open(from, env, { designer: false });
      const st = document.querySelector(".cwd-stage");
      out.layer = st ? st.textContent.replace(/\s+/g, " ").trim() : "";
      window.CouchDetail.close(true);
    }
    return out;
  }, [o, env, opts || null]);
}

// ---- the forecast this TV has (Celsius, the shape app.js weatherDirect hands over) ----
const day = (i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hour = (i) => new Date(Date.now() + i * 3600000).toISOString();
function wx(temp, extra) {
  return Object.assign({ temp, code: 1, hi: temp + 4, lo: temp - 6, uv: 7,
    hourly: Array.from({ length: 24 }, (_, i) => ({ time: hour(i), code: 1, temp: temp + (i % 3), pop: 5, uv: 3 })),
    daily: Array.from({ length: 7 }, (_, i) => ({ date: day(i), code: 1, lo: temp - 6, hi: temp + 4, sunrise: day(i) + "T05:40", sunset: day(i) + "T19:20", uv: 8, pop: 10 })) }, extra || {});
}
const HOME = { name: "Hillside", lat: -33.6, lon: 151.1 };
const BEACH = { name: "Long Beach", lat: -33.5, lon: 151.4, timezone: "Australia/Sydney" };
const marine = (wave) => ({ wave, period: 9, dir: 120, wind: 12, windDir: 200, hourly: [wave, wave, wave] });

// ================= 1. settings: env.wset or data().wset, then opts, then the caps default =================
{
  const r = await page.evaluate(() => {
    const W = window.CouchWidgets, o = { id: "w1", kind: "news", opts: { feed: "bbc" } };
    return {
      wsetData: W.setting(o, { data: { wset: { w1: { feed: "rnz" } } } }, "feed"),
      wsetEnv: W.setting(o, { wset: { w1: { feed: "sbs" } }, data: { wset: { w1: { feed: "rnz" } } } }, "feed"),
      opts: W.setting(o, { data: {} }, "feed"),
      capsDefault: W.setting({ id: "w2", kind: "news", opts: {} }, { data: {} }, "feed"),
      dflt: W.setting({ id: "w3", kind: "quote", opts: {} }, { data: {} }, "nothing", "x"),
      otherWidget: W.setting(o, { data: { wset: { w9: { feed: "rnz" } } } }, "feed"),
      merged: W.withSettings({ id: "w1", kind: "aircon", opts: { entity: "climate.a", align: "left" } }, { data: { wset: { w1: { entity: "climate.b", lid_a: "red;background:url(x)", cities: "not a list" } } } })
    };
  });
  ok(r.wsetData === "rnz", "data().wset is read first: " + r.wsetData);
  ok(r.wsetEnv === "sbs", "env.wset wins over data().wset: " + r.wsetEnv);
  ok(r.opts === "bbc", "then the design's opts: " + r.opts);
  ok(r.capsDefault === "auto", "then widget-caps.js's default: " + r.capsDefault);
  ok(r.dflt === "x", "then the caller's default");
  ok(r.otherWidget === "bbc", "another widget's setting is not this one's");
  ok(r.merged.opts.entity === "climate.b" && r.merged.opts.align === "left", "a TV setting goes over the design's opts, the rest stay");
  ok(!("lid_a" in r.merged.opts) && r.merged.opts.cities === undefined, "a css value or a wrong shape from the TV is never taken");
}

// ================= 2. surf: the heading names where the swell is read =================
{
  const o = { id: "surf1", kind: "surf", opts: { label: "North Point" } };
  const base = { weather: wx(24, { marine: marine(1.2) }), place: HOME };
  let r = await draw(o, { data: base }, { layer: true });
  has(r.text, "Hillside", "surf, no beach picked: the home's own town");
  hasNot(r.text, "North Point", "surf: never the starter's beach name over the home's swell");
  has(r.layer, "Hillside", "surf layer: the same honest heading"); hasNot(r.layer, "North Point", "surf layer");
  // a beach picked on this TV, with its own forecast: the design's words beside the real place
  r = await draw(o, { data: Object.assign({ wset: { surf1: { place: BEACH } }, wxAt: { "-33.50,151.40": wx(23, { marine: marine(2.1) }) } }, base) }, { layer: true });
  has(r.text, "Long Beach", "surf: the beach picked on this TV"); has(r.text, "2.1", "surf: that beach's own swell"); hasNot(r.text, "1.2m", "surf: not the home's swell");
  has(r.layer, "Long Beach", "surf layer: the picked beach");
  // picked, not fetched yet: waits, never the home's swell under the beach's name
  r = await draw(o, { data: Object.assign({ wset: { surf1: { place: BEACH } } }, base) });
  ok(r.empty, "surf: a picked beach with no reading yet waits"); has(r.text, "Waiting for the swell", "surf waiting"); hasNot(r.text, "1.2", "surf waiting");
  // per widget data handed by object id works too, and two surf widgets read two beaches
  r = await draw({ id: "surf2", kind: "surf", opts: {} }, { data: Object.assign({ wset: { surf2: { place: BEACH } }, wxBy: { surf2: wx(23, { marine: marine(0.8) }) } }, base) });
  has(r.text, "0.8", "surf: per widget data by object id");
  r = await draw({ id: "surf3", kind: "surf", opts: {} }, { data: base });
  has(r.text, "1.2", "surf: a second surf widget with no beach reads the home's");
}

// ================= 3. smart home headings and picks =================
const HA = {
  info: { cameras: [{ entity: "camera.front", name: "Front door cam" }, { entity: "camera.yard", name: "Yard" }], sensors: [{ entity: "sensor.pool", name: "Pool" }, { entity: "sensor.spa", name: "Spa" }],
    energy: true, doorbell: true, controls: [1], speakers: [1] },
  sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, num: 26, value: "26", unit: "°C", cls: "temperature" }, { entity: "sensor.spa", name: "Spa", ok: true, num: 38, value: "38", unit: "°C", cls: "temperature" }],
  hist: {}, energy: { ok: true, name: "Solar roof", total: 12.3, hours: [] }, bell: { ok: true, name: "Side gate", at: Date.now() - 3600000, kept: false }, stills: {},
  controls: [{ entity: "light.a", name: "Lounge", ok: true, kind: "light", on: true }, { entity: "light.b", name: "Porch", ok: true, kind: "light", on: false }, { entity: "light.c", name: "Hall", ok: true, kind: "light", on: false }],
  speakers: [{ entity: "media_player.a", name: "Kitchen", ok: true, state: "idle", volume: 20 }, { entity: "media_player.b", name: "Deck", ok: true, state: "idle", volume: 30 }]
};
{
  let r = await draw({ id: "c1", kind: "camera", opts: { label: "Backyard" } }, { data: { ha: HA } }, { layer: true });
  has(r.text, "Front door cam", "camera: its own name"); hasNot(r.text, "Backyard", "camera: never the design's word over the first camera");
  has(r.layer, "Front door cam", "camera layer"); hasNot(r.layer, "Backyard", "camera layer");
  r = await draw({ id: "c1", kind: "camera", opts: { label: "Backyard" } }, { data: { ha: HA, wset: { c1: { cam: "camera.yard" } } } }, { layer: true });
  has(r.text, "Backyard", "camera picked on this TV: the design's heading may show"); has(r.layer, "Backyard", "camera layer, picked");
  r = await draw({ id: "c1", kind: "camera", opts: { label: "Backyard" } }, { data: { ha: HA, wset: { c1: { label: "Driveway" } } } });
  has(r.text, "Driveway", "camera: a heading typed on this TV wins");

  r = await draw({ id: "s1", kind: "sensor", opts: { label: "The pool" } }, { data: { ha: HA } }, { layer: true });
  has(r.text, "Pool", "sensor: its own name"); hasNot(r.text, "The pool", "sensor: not the design's"); hasNot(r.layer, "The pool", "sensor layer");
  r = await draw({ id: "s1", kind: "sensor", opts: { label: "The pool" } }, { data: { ha: HA, wset: { s1: { reading: "sensor.spa" } } } });
  has(r.text, "The pool", "sensor picked on this TV: its heading"); has(r.text, "38", "sensor: the picked reading");

  r = await draw({ id: "e1", kind: "energy", opts: { label: "Battery" } }, { data: { ha: HA } }, { layer: true });
  has(r.text, "Solar roof", "energy: Home Assistant's own name"); hasNot(r.text, "Battery", "energy"); has(r.layer, "Solar roof", "energy layer");
  r = await draw({ id: "d1", kind: "doorbell", opts: { label: "Front door" } }, { data: { ha: HA } }, { layer: true });
  has(r.text, "Side gate", "doorbell: its own name"); hasNot(r.text, "Front door", "doorbell: not a door it is not"); hasNot(r.layer, "Front door", "doorbell layer");

  r = await draw({ id: "d1", kind: "doorbell", opts: {} }, { data: { ha: HA, wset: { d1: { label: "Back door" } } } });
  has(r.text, "Back door", "doorbell: a heading typed on this TV");
  r = await draw({ id: "e1", kind: "energy", opts: {} }, { data: { ha: HA, wset: { e1: { label: "Panels" } } } });
  has(r.text, "Panels", "energy: a heading typed on this TV");
  // bins: "none" is not set yet, in plain words; a night set on this TV
  r = await draw({ id: "b1", kind: "bins", opts: { weekday: "none" } }, { data: {} });
  ok(r.empty, "bins none: not set"); has(r.text, "Set your bin night", "bins none"); hasNot(r.text, "Couch TV Studio", "bins: no Studio only promise");
  r = await draw({ id: "b1", kind: "bins", opts: { weekday: "none" } }, { data: { wset: { b1: { weekday: new Date().getDay() } } } });
  has(r.text, "Tonight", "bins: the night set on this TV");
  r = await draw({ id: "k1", kind: "controls", opts: { label: "Lights" } }, { data: { ha: HA, wset: { k1: { switches: ["light.c", "light.a"] } } } });
  has(r.text, "Hall", "controls: the switches picked for this widget"); hasNot(r.text, "Porch", "controls: not the others");
  r = await draw({ id: "p1", kind: "speakers", opts: {} }, { data: { ha: HA, wset: { p1: { players: ["media_player.b"] } } } });
  has(r.text, "Deck", "speakers: the one picked"); hasNot(r.text, "Kitchen", "speakers: not the others");
}

// ================= 4. aircon: each widget its own room, temperatures in the home's unit =================
const ROOMS = [{ entity: "climate.living", name: "Living", unit: "°C", ok: true, state: "cool", target: 22, current: 24, min: 16, max: 30, step: 0.5, modes: ["off", "cool"] },
  { entity: "climate.bed", name: "Bedroom", unit: "°C", ok: true, state: "heat", target: 20, current: 18, min: 16, max: 30, step: 0.5, modes: ["off", "heat"] }];
{
  let r = await draw({ id: "a1", kind: "aircon", opts: {} }, { rooms: ROOMS, data: { wset: { a2: { entity: "climate.bed" } } } });
  has(r.text, "Living", "aircon with nothing picked: the first room");
  r = await draw({ id: "a2", kind: "aircon", opts: {} }, { rooms: ROOMS, data: { wset: { a2: { entity: "climate.bed" } } } }, { layer: true });
  has(r.text, "Bedroom", "a second aircon widget: its own room"); has(r.text, "20°", "aircon in °C");
  r = await draw({ id: "a2", kind: "aircon", opts: {} }, { rooms: ROOMS, data: { unit: "f", wset: { a2: { entity: "climate.bed" } } } }, { layer: true });
  has(r.text, "68°", "aircon in °F: 20 °C set is 68"); hasNot(r.text, "20°", "aircon °F: no Celsius left");
  has(r.layer, "68°", "aircon layer in °F"); has(r.layer, "64°", "aircon layer: the room now in whole °F");
  // a Home Assistant already in °F is left alone on a °F home
  const FROOM = [{ entity: "climate.us", name: "Den", ok: true, state: "cool", target: 72, current: 75, min: 60, max: 86, step: 1, modes: ["off", "cool"] }];
  r = await draw({ id: "a3", kind: "aircon", opts: {}, w: 360, h: 360 }, { rooms: FROOM, data: { unit: "f" } });
  has(r.text, "72°", "aircon: a °F Home Assistant on a °F home stays as it is"); hasNot(r.text, "161", "aircon: never converted twice");
}

// ================= 5. °F everywhere a temperature is drawn =================
{
  const data = { weather: wx(24), place: HOME, unit: "f" };
  const F24 = "75°", F28 = "82°", F18 = "64°";
  let r = await draw({ id: "x1", kind: "weather", opts: {} }, { data }, { layer: true });
  has(r.text, F24, "weather °F"); has(r.text, "H:" + F28, "weather high °F"); has(r.text, "L:" + F18, "weather low °F"); hasNot(r.text, "24°", "weather: no Celsius");
  has(r.layer, F24 + " now", "forecast layer °F"); hasNot(r.layer, " 24°", "forecast layer: no Celsius");
  r = await draw({ id: "x2", kind: "bigtemp", opts: {} }, { data }); has(r.text, F24, "big number °F");
  r = await draw({ id: "x3", kind: "hourly", opts: {}, w: 1160 }, { data }); has(r.text, F24, "hourly °F"); has(r.text, "77°", "hourly hours °F");
  r = await draw({ id: "x4", kind: "week", opts: {}, h: 760 }, { data }); has(r.text, F28, "week high °F"); has(r.text, F18, "week low °F");
  r = await draw({ id: "x5", kind: "date", opts: { show: "both" }, w: 960, h: 200 }, { data }); has(r.text, F24, "date line °F");
  r = await draw({ id: "x6", kind: "weather", opts: {}, w: 260, h: 160 }, { data }); has(r.text, F24, "weather tile °F");
  r = await draw({ id: "x7", kind: "sensor", opts: {} }, { data: { unit: "f", ha: HA } }); has(r.text, "78.8", "sensor °C reading on a °F home");
  r = await draw({ id: "x8", kind: "weather", opts: {} }, { data: { weather: wx(24), place: HOME } }); has(r.text, "24°", "a °C home is unchanged");
  r = await draw({ id: "x9", kind: "bigtemp", opts: {} }, { data: { weather: wx(24), place: HOME, unit: "c" } }); has(r.text, "24°", "unit c is unchanged");
}

// ================= 6. agenda: never a day it is not =================
{
  const t0 = new Date(); t0.setHours(23, 0, 0, 0);
  const tom = new Date(t0.getTime() + 86400000); tom.setHours(10, 0, 0, 0);
  const ev = (title, s, e) => ({ title, start: s, end: e, allDay: false });
  const today = { home: { cal: { set: true, events: [ev("Netball", t0.getTime(), t0.getTime() + 1800000)] } } };
  const tomorrow = { home: { cal: { set: true, events: [ev("Dentist", tom.getTime(), tom.getTime() + 3600000)] } } };
  let r = await draw({ id: "g1", kind: "agenda", opts: { label: "Tomorrow" }, w: 960, h: 560 }, { data: today });
  has(r.text, "Today", "agenda: today's events under Today"); hasNot(r.text, "Tomorrow", "agenda: a starter's Tomorrow never over today");
  r = await draw({ id: "g1", kind: "agenda", opts: { label: "Family" }, w: 960, h: 560 }, { data: today });
  has(r.text, "Family, today", "agenda: a typed heading goes before the day");
  r = await draw({ id: "g1", kind: "agenda", opts: { label: "Today" }, w: 960, h: 560 }, { data: tomorrow });
  has(r.text, "Tomorrow", "agenda: tomorrow's events say Tomorrow"); hasNot(r.text, "Today ·", "agenda: never Today over tomorrow");
}

// ================= 7. lists, stacks and the other per widget picks =================
{
  const home = { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }] }, { name: "Jobs", items: [{ t: "Mow the lawn", done: false }] }] } };
  let r = await draw({ id: "l1", kind: "list", opts: { label: "Jobs" } }, { data: home });
  has(r.text, "Mow the lawn", "list with nothing picked: the list its design heading names (a starter's To do)");
  r = await draw({ id: "l1", kind: "list", opts: {} }, { data: Object.assign({ wset: { l1: { list: "Jobs" } } }, home) });
  has(r.text, "Mow the lawn", "list picked on this TV by name");
  r = await draw({ id: "l1", kind: "list", opts: {} }, { data: Object.assign({ wset: { l1: { list: 1 } } }, home) });
  has(r.text, "Jobs", "list picked on this TV by place");
  // a stack item reads its own settings ("<stack id>/<index>")
  r = await draw({ id: "st", kind: "stack", turn: 0, items: [{ kind: "list", opts: {} }] }, { data: Object.assign({ wset: { "st/0": { list: "Jobs" } } }, home) });
  has(r.text, "Mow the lawn", "a stack item's own setting");
  // countdown: a starter "Christmas" never counts to another day; a one off year counts to that day
  r = await draw({ id: "cd", kind: "countdown", opts: { label: "Christmas" } }, { data: { wset: { cd: { day: 3, month: 3 } } } });
  has(r.text, "3 March", "countdown: the date, not Christmas"); hasNot(r.text, "Christmas", "countdown");
  r = await draw({ id: "cd", kind: "countdown", opts: { label: "Our wedding", day: 1, month: 1, year: 2000 + 1 } }, { data: {} });
  has(r.text, "been and gone", "countdown: a one off day that has passed");
  // clocks follow this TV unless the widget says 12 or 24 hour
  r = await draw({ id: "ck", kind: "clock", opts: { format: "auto" }, h: 300 }, { data: {}, clock24: true });
  ok(!/[ap]m/.test(r.text) && /^\d\d:\d\d/.test(r.text), "clock auto follows the TV's 24 hour: " + r.text);
  r = await draw({ id: "ck", kind: "clock", opts: { format: "auto" }, h: 300 }, { data: { wset: { ck: { format: "12h" } } }, clock24: true });
  ok(/[ap]m/.test(r.text), "clock 12 hour set on this TV: " + r.text);
  // world clock with no cities: this TV's own town first
  r = await draw({ id: "wc", kind: "worldclock", opts: {}, w: 460, h: 460 }, { data: { place: HOME } });
  has(r.text, "Hillside", "world clock: this TV's town first, by its name"); hasNot(r.text, "Brisbane", "world clock: no stranger's default");
  // a stack's page dots never sit on an item's words (the TCL: a 4 by 2 stack's dots covered the temperature)
  for (const [w, h] of [[360, 160], [460, 260], [760, 360]]) {
    const hit = await page.evaluate(([w, h, data]) => {
      document.querySelectorAll(".ws-host").forEach((x) => x.remove());
      const host = document.createElement("div"); host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
      document.body.appendChild(host);
      const root = window.CouchWidgets.render({ id: "sk", kind: "stack", turn: 0, w, h, items: [{ kind: "weather", opts: {} }, { kind: "bigtemp", opts: {} }, { kind: "clock", opts: {} }] }, { data });
      host.appendChild(root);
      const dots = root.querySelector(".cw-dots").getBoundingClientRect(), box = root.getBoundingClientRect(), bad = [];
      for (const slot of root.querySelectorAll(".cw-slot")) {
        slot.style.visibility = "visible";
        const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT); let nd;
        while ((nd = walker.nextNode())) {
          if (!nd.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(nd);
          for (const q of rg.getClientRects()) if (q.width && q.right > dots.left && q.left < dots.right && q.bottom > dots.top && q.top < dots.bottom) bad.push(nd.textContent.trim());
        }
      }
      return { bad, inside: dots.right <= box.right + 0.5 && dots.left >= box.left };
    }, [w, h, { weather: wx(24), place: HOME }]);
    ok(hit.bad.length === 0 && hit.inside, "stack " + w + "x" + h + ": the dots sit clear of every item's words, inside the stack (" + hit.bad.join(", ") + ")");
  }
}

// ================= 8. Headlines and Scores headings; plain empty words =================
{
  const now = Date.now();
  const web = { news: { abc: { ok: true, at: now, v: [{ title: "Rain on the coast", at: now }] } }, sports: { afl: { ok: true, at: now, v: { league: "AFL", games: [{ id: "1", at: now, state: "post", detail: "Final", teams: [{ name: "Lions", score: "90", win: true }, { name: "Swans", score: "80" }] }] } } } };
  let r = await draw({ id: "n1", kind: "news", opts: { label: "The Guardian", feed: "abc" } }, { data: { web } });
  has(r.text, "ABC News", "news: the real outlet"); hasNot(r.text, "Guardian", "news: never another outlet's name");
  r = await draw({ id: "n1", kind: "news", opts: { label: "Morning news", feed: "abc" } }, { data: { web } });
  has(r.text, "Morning news", "news: a plain heading stays"); has(r.text, "From ABC News", "news: and says where it is from");
  r = await draw({ id: "n2", kind: "news", opts: { feed: "auto" } }, { data: { web, country: "GB" } });
  has(r.text, "Getting the headlines", "news auto in the UK asks for BBC World, not ABC");
  r = await draw({ id: "sp", kind: "sports", opts: { label: "NRL" } }, { data: { web, wset: { sp: { league: "afl" } } } });
  has(r.text, "AFL", "scores: the competition picked on this TV"); hasNot(r.text, "NRL", "scores: a starter's NRL never over the AFL");
  // words that sent people to a Studio control that did not exist
  r = await draw({ id: "mk", kind: "stocks", opts: { tickers: ["BHP.AX"] } }, { data: { web: { stocks: { "BHP.AX": { ok: true, at: now, v: { quotes: {} } } } } } });
  hasNot(r.text, "Couch TV Studio", "markets: no promise of a Studio box"); has(r.text, "this widget's settings", "markets: where the codes are set");
  r = await draw({ id: "cm", kind: "commute", opts: {} }, { data: { commute: { from: { name: "Hillside" }, to: { name: "Riverton" }, key: "k" }, web: { commute: { k: { ok: true, at: now, v: { minutes: 21, km: 18 } } } } } });
  has(r.text, "Set an arrive by time in this widget's settings", "commute: plain words"); hasNot(r.text, "Couch TV Studio", "commute");
  r = await draw({ id: "cm", kind: "commute", opts: { arrive_h: "off" } }, { data: { commute: { from: { name: "Hillside" }, to: { name: "Riverton" }, key: "k" }, web: { commute: { k: { ok: true, at: now, v: { minutes: 21, km: 18 } } } } } });
  hasNot(r.text, "NaN", "commute: arrive by off is no time");
  // Up next: game mode off is off; the sport apps named are this TV's
  r = await draw({ id: "u1", kind: "upnext", opts: {} }, { sport: true, data: { wset: { u1: { sport: false } }, shows: [] } });
  hasNot(r.text, "game", "up next, game mode off: no game words");
  r = await draw({ id: "u1", kind: "upnext", opts: {} }, { sport: true, data: { shows: [], apps: [{ package: "au.com.ninenow.ctv", name: "9Now" }] } });
  has(r.text, "Start a game in 9Now", "up next: the sport app this TV has"); hasNot(r.text, "Kayo", "up next: not an app this TV lacks");
}

// ================= 9. a real TV never shows the demo =================
{
  const DEMO_WORDS = ["Riverside", "The point", "Backyard", "Bluey", "Titans", "Riptide", "Milk", "Dinner at 6", "salt-and-sun", "Pizza", "Living", "Solar today", "Sarah", "School drop off", "Coastal highway"];
  const kinds = await page.evaluate(() => window.CouchWidgets.kinds());
  for (const kind of kinds) {
    if (kind === "stack") continue;
    const r = await draw({ id: "z-" + kind, kind, opts: {} }, { data: { bridge: true } });
    for (const w of DEMO_WORDS) hasNot(r.text, w, "a real TV, " + kind + ": demo word");
  }
  // the welcome widget's starter sample lines, even copied with small changes
  const r = await draw({ id: "wl", kind: "welcome", opts: { kicker: "headland house, north point.", text: "Welcome, Ella and friends", sub: "Three sleeps till the beach!" } }, { data: { home: {} } });
  hasNot(r.text, "Headland", "welcome: no sample house"); hasNot(r.text, "Three sleeps", "welcome: no sample line"); hasNot(r.text, "Ella", "welcome: no sample name");
  // the designer still shows the demo
  const d = await draw({ id: "dm", kind: "surf", opts: { label: "North Point" } }, { demo: true, data: {} });
  has(d.text, "North Point", "Couch TV Studio's demo keeps the design's words");
}

// ================= 10. review fixes, bins and each Commute widget's own drive =================
{
  const r = await page.evaluate(() => {
    const W = window.CouchWidgets, ws = (o, w) => W.withSettings(o, { data: { wset: { [o.id]: w } } });
    const a = ws({ id: "a", kind: "countdown", opts: { year: 2030, label: "Wedding" } }, { label: "", year: "every", day: null, image: "x.jpg" });
    const p = ws({ id: "p", kind: "surf", opts: {} }, { place: { name: { x: 1 }, lat: 1, lon: 2 } });
    const q = ws({ id: "q", kind: "surf", opts: {} }, { place: { name: "Hillside", lat: "-33.6", lon: "151.1" } });
    const e = ws({ id: "e", kind: "surf", opts: {} }, { place: { name: "X", lat: "", lon: 2 } });
    const m = ws({ id: "m", kind: "countdown", opts: {} }, { month: 13, day: 40 });
    const again = W.withSettings(a, { data: {} });
    return { label: a.opts.label, year: a.opts.year, yearTv: a.__tv.year, image: a.opts.image, badName: p.__tv.place, strLat: q.__tv.place && q.__tv.place.lat, emptyLat: e.__tv.place,
      month: m.opts.month, day: m.opts.day, againTv: "__tv" in again, againYear: again.opts.year };
  });
  ok(r.label === "Wedding", "an empty TV value leaves the design's"); ok(r.year === undefined && r.yearTv === "every", "a number set back to Every year drops the design's year");
  ok(r.image === undefined, "a picture is never taken from the TV settings"); ok(r.badName === undefined && r.emptyLat === undefined, "a place with a wrong name or an empty latitude is not a place");
  ok(r.strLat === -33.6, "a place with numbers as words is read"); ok(r.month === undefined && r.day === undefined, "a month or day out of range is not taken");
  ok(r.againTv === false && r.againYear === 2030, "drawn again with nothing set: the design as it is, no old TV values");

  let d = await draw({ id: "y1", kind: "countdown", opts: { label: "Our wedding", day: 1, month: 1, year: 2001 } }, { data: { wset: { y1: { year: "every" } } } });
  hasNot(d.text, "been and gone", "countdown set back to every year on this TV counts to next year");
  d = await draw({ id: "y2", kind: "countdown", opts: { label: "Christmas", day: 3, month: 3 } }, { data: {} });
  has(d.text, "Christmas", "countdown: a name and date both from the design stay as they are");
  // the device's heading only when the device picked on this TV is the one shown
  d = await draw({ id: "c9", kind: "camera", opts: { label: "Backyard" } }, { data: { ha: HA, wset: { c9: { cam: "camera.gone" } } } });
  has(d.text, "Front door cam", "camera: a pick that is not there shows the camera's own name"); hasNot(d.text, "Backyard", "camera: missing pick");
  d = await draw({ id: "s9", kind: "sensor", opts: { label: "The pool" } }, { data: { ha: HA, wset: { s9: { reading: "sensor.gone" } } } });
  hasNot(d.text, "The pool", "sensor: missing pick, its own name");
  // agenda: a heading with a day in it never shows over another day
  const t0 = new Date(); t0.setHours(23, 0, 0, 0);
  d = await draw({ id: "g9", kind: "agenda", opts: { label: "Tomorrow's plans" }, w: 960, h: 560 }, { data: { home: { cal: { set: true, events: [{ title: "Netball", start: t0.getTime(), end: t0.getTime() + 1800000 }] } } } });
  has(d.text, "Today", "agenda: a heading with a day word gives way"); hasNot(d.text, "Tomorrow's", "agenda");
  // °F: each number rounded once (24.4 °C is 75.9 °F, so 76, not 75)
  d = await draw({ id: "f9", kind: "bigtemp", opts: {} }, { data: { weather: wx(24.4), place: HOME, unit: "f" } });
  has(d.text, "76°", "°F rounded once");
  // an aircon room that does not say its unit is drawn as Home Assistant gives it
  d = await draw({ id: "a9", kind: "aircon", opts: {}, w: 360, h: 360 }, { rooms: [{ entity: "climate.x", name: "Study", ok: true, state: "cool", target: 22, current: 23, min: 16, max: 30, modes: ["off", "cool"] }], data: { unit: "f" } });
  has(d.text, "22°", "aircon with no unit: never guessed");
  // lists: a numeric pick as words; speakers and switches only as lists
  const home = { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }] }, { name: "Jobs", items: [{ t: "Mow the lawn", done: false }] }] } };
  d = await draw({ id: "l9", kind: "list", opts: {} }, { data: Object.assign({ wset: { l9: { list: "1" } } }, home) });
  has(d.text, "Mow the lawn", "list picked as \"1\"");
  d = await draw({ id: "p9", kind: "speakers", opts: { players: "media_player.a" } }, { data: { ha: HA } });
  has(d.text, "Kitchen", "speakers: a broken players value shows them all"); has(d.text, "Deck", "speakers: all");
  // world clock: a city this TV cannot tell the time of is left out
  d = await draw({ id: "w9", kind: "worldclock", opts: {}, w: 460, h: 460 }, { data: { place: HOME, wset: { w9: { cities: ["Not/AZone", "Europe/London"] } } } });
  has(d.text, "London", "world clock: the real city"); hasNot(d.text, "AZone", "world clock: a broken zone left out");
  // bins set on this TV: taking turns, which week, the names
  const wd = new Date().getDay();
  d = await draw({ id: "b9", kind: "bins", opts: { weekday: "none" } }, { data: { wset: { b9: { weekday: wd, alt: true, anchor: 0, bin_a: "Paper", bin_b: "Green waste" } } } });
  ok(/Paper|Green waste/.test(d.text) && /Rubbish/.test(d.text), "bins: taking turns and the names set on this TV: " + d.text);
  const both = [];
  for (const anchor of [0, 7]) both.push((await draw({ id: "b9", kind: "bins", opts: {} }, { data: { wset: { b9: { weekday: wd, alt: true, anchor, bin_a: "Paper", bin_b: "Green waste" } } } })).text);
  ok(both[0] !== both[1], "bins: the week set on this TV (anchor) picks which bin goes out");
  // no Where to yet: the widget's own settings, never the old Home settings Commute rows
  d = await draw({ id: "cm0", kind: "commute", opts: {}, h: 460 }, { data: { commute: { from: { name: "Hillside", lat: -33.87, lon: 151.21 } } } });
  has(d.text, "this widget's settings: hold OK on the widget", "commute with no Where to: where to set it"); hasNot(d.text, "Studio, Commute", "commute: no old Commute rows");
  // two Commute widgets, each its own Where to and its own drive
  const now = Date.now(), from = { name: "Hillside", lat: -33.87, lon: 151.21 }, to2 = { name: "Long Beach", lat: -33.75, lon: 151.3 };
  const k2 = await page.evaluate(([f, t]) => window.CouchWidgetWeb.routeKey(f, t), [from, to2]);
  const data = { commute: { from, to: { name: "Riverton" }, key: "k1" }, web: { commute: { k1: { ok: true, at: now, v: { minutes: 21, km: 18 } }, [k2]: { ok: true, at: now, v: { minutes: 34, km: 30 } } } } };
  d = await draw({ id: "cm1", kind: "commute", opts: {} }, { data });
  has(d.text, "21", "commute one: the home's Where to"); has(d.text, "Riverton", "commute one");
  d = await draw({ id: "cm2", kind: "commute", opts: {} }, { data: Object.assign({ wset: { cm2: { to: to2 } } }, data) });
  has(d.text, "34", "commute two: its own drive"); has(d.text, "Long Beach", "commute two: its own Where to"); hasNot(d.text, "Riverton", "commute two");
}

ok(errors.length === 0, "no page errors: " + errors.join(" | "));
await browser.close();
server.close();
console.log("OK: " + n + " checks");
