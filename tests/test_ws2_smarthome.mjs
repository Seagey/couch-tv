// Widget swarm round 2, the smart home group (aircon, controls, camera, doorbell, sensor, energy, solar,
// battery, speakers, scenes, bins), in a real browser:
//  A. every setting changes the drawn widget, and clearing it goes back to the default (widgets.js and
//     widget-detail.js, mock Home Assistant answers in the shape smarthome.js hands over);
//  B. on the real TV page (?mock=1&ha=1, the pretend Home Assistant in mock.js): each widget's settings
//     show in Home settings, Widgets on this home, in Hold OK, Edit on the TV, and on the phone's Widgets
//     on this TV, only while it is on the design, and go when it leaves;
//  C. a device setting is a real pick from the Smart home list the TV has, on the TV and on the phone,
//     and the widget on screen follows it; a real TV never shows demo readings.
// No real Home Assistant is used anywhere: mock.js stands in for it.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_smarthome.mjs
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
const has = (text, want, m) => ok(text.indexOf(want) >= 0, (m || "") + ": wanted \"" + want + "\" in \"" + text.slice(0, 300) + "\"");
const hasNot = (text, bad, m) => ok(text.indexOf(bad) < 0, (m || "") + ": \"" + bad + "\" must not show in \"" + text.slice(0, 300) + "\"");

// ---- a stand-in on-TV app: the TV home's files, /setup, and an API whose At home is the real TV page ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const TOKEN = "t0k3n";
let TV = null;
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
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
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false, error: "That code is not right." });
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
    const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
console.log("Running the smart home group's widget settings tests (ws2)...");
const browser = await chromium.launch();

// ======================= A. every setting changes the drawn widget =======================
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  // Android's paired devices and their charge (Batteries.kt through window.TVOS)
  window.TVOS = { batteries: () => JSON.stringify({ need: "", devices: [{ kind: "controller", name: "Pad 1", level: 72 }, { kind: "remote", name: "Remote", level: 12 }, { kind: "headphones", name: "Headset", level: 45 }] }) };
});
await page.goto(ORIGIN + "/tv-home/web/ws2.html");
await page.waitForFunction(() => window.CouchWidgets && window.CouchDetail && window.CouchWidgetCaps);

// draw one widget with env; answers its words, attributes and the colours it drew
async function draw(o, env, opts) {
  return page.evaluate(([o, env, opts]) => {
    if (window.CouchDetail.isOpen()) window.CouchDetail.close(true);
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
    document.body.appendChild(host);
    const root = window.CouchWidgets.render(Object.assign({ w: 760, h: 460 }, o), env);
    host.appendChild(root);
    const out = { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1", cam: root.getAttribute("data-ha-cam") || "",
      fills: [...root.querySelectorAll("rect")].map((r) => r.getAttribute("fill")), red: [...root.querySelectorAll("circle")].filter((c) => c.getAttribute("stroke") === "#ff453a").length,
      chips: [...root.querySelectorAll(".cw-chip")].map((c) => c.textContent), pic: root.innerHTML.indexOf("Door now") >= 0 };
    if (opts && opts.layer) {
      // the widget itself (a scenes widget's own buttons each run a scene; its layer is the widget's)
      const from = root.hasAttribute("data-act") || root.hasAttribute("data-detail") ? root : root.querySelector("[data-act]") || root;
      window.CouchDetail.open(from, env, { designer: false });
      const st = document.querySelector(".cwd-stage");
      out.layer = st ? st.textContent.replace(/\s+/g, " ").trim() : "";
      out.layerRed = st ? st.querySelectorAll(".cwd-tv-no").length : -1;
      window.CouchDetail.close(true);
    }
    return out;
  }, [o, env, opts || null]);
}
const HOME = { name: "Hillside", lat: -33.6, lon: 151.1 };
const ROOMS = [
  { entity: "climate.living_room", name: "Living room", ok: true, state: "cool", action: "cooling", current: 24.5, target: 22, min: 16, max: 30, step: 0.5, modes: ["off", "cool"], unit: "°C" },
  { entity: "climate.bedroom", name: "Bedroom", ok: true, state: "heat", action: "heating", current: 19, target: 21, min: 16, max: 30, step: 0.5, modes: ["off", "heat"], unit: "°C" }];
const HA = {
  info: { controls: [1], cameras: [{ entity: "camera.backyard", name: "Backyard" }, { entity: "camera.driveway", name: "Driveway" }],
    sensors: [{ entity: "sensor.pool", name: "Pool" }, { entity: "sensor.rain_today", name: "Rain gauge" }], speakers: [1], energy: true, doorbell: true, doorbell_camera: true },
  controls: [{ entity: "light.lounge", name: "Lounge", ok: true, kind: "light", on: true }, { entity: "light.lamp", name: "Lamp", ok: true, kind: "light", on: false },
    { entity: "switch.outdoor_lights", name: "Outdoor lights", ok: true, kind: "switch", on: false }, { entity: "switch.wall_clock", name: "Wall clock", ok: true, kind: "switch", on: true },
    { entity: "switch.shellyplus1_a8032ab1", name: "Shellyplus1", ok: true, kind: "switch", on: false, blocked: true },
    { entity: "cover.garage", name: "Garage", ok: true, kind: "cover", on: false, blocked: true }, { entity: "cover.big_roller", name: "Big roller", ok: true, kind: "cover", on: false, blocked: true }],
  sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, value: "26.4", num: 26.4, unit: "°C", cls: "temperature" }, { entity: "sensor.rain_today", name: "Rain gauge", ok: true, value: "12", num: 12, unit: "mm" }],
  hist: {}, energy: { ok: true, name: "Solar", total: 18.4, power: 2.4, power_unit: "kW", hours: [0, 0, 0, 0, 0, 0, 0.2, 0.9, 1.8, 2.6, 3.1, 3.2] },
  speakers: [{ entity: "media_player.kitchen", name: "Kitchen", ok: true, state: "playing", volume: 35 }, { entity: "media_player.deck", name: "Deck", ok: true, state: "idle", volume: 20 }],
  bell: { ok: true, name: "Front door", at: Date.now() - 3600000, ringing: false, camera: true, kept: false }, stills: {}
};
const SCENES = [{ entity: "scene.movie_night", name: "Movie night" }, { entity: "scene.lights_off", name: "Lights off" }, { entity: "script.good_morning", name: "Good morning" },
  { entity: "script.open_garage", name: "Open garage" }, { entity: "scene.disarm_alarm", name: "Disarm alarm" }, { entity: "script.unlock_front_door", name: "Unlock front door" }];
const OPENERS = /Garage|Big roller|Open garage|Disarm alarm|Unlock front door/;
const env = (wset, extra) => Object.assign({ rooms: ROOMS, data: { ha: HA, scenes: SCENES, place: HOME, wset: wset ? { x: wset } : {} } }, extra || {});
const W = (kind, opts, size) => Object.assign({ id: "x", kind, opts: opts || {} }, size || {});

group = "aircon";
{
  let r = await draw(W("aircon", {}, { w: 1000, h: 460 }), env());
  has(r.text, "Living room", "aircon, nothing set: the first room"); ok(r.chips.some((c) => /Bedroom/.test(c)), "aircon: the other rooms beside it by default: " + r.chips.join(","));
  r = await draw(W("aircon", {}, { w: 1000, h: 460 }), env({ entity: "climate.bedroom" }));
  ok(/^Bedroom/.test(r.text) && r.chips.some((c) => /Living room/.test(c)), "aircon Room set on this TV: the bedroom, with the living room as the other: " + r.text);
  r = await draw(W("aircon", {}, { w: 1000, h: 460 }), env({ others: false }));
  ok(!r.chips.some((c) => /Bedroom/.test(c)), "aircon Show the other rooms off: no other rooms: " + r.chips.join(","));
  r = await draw(W("aircon", { others: false }, { w: 1000, h: 460 }), env());
  ok(!r.chips.some((c) => /Bedroom/.test(c)), "aircon: the design's own Show the other rooms off works too");
  r = await draw(W("aircon", {}, { w: 1000, h: 460 }), env({}));
  ok(/^Living room/.test(r.text) && r.chips.some((c) => /Bedroom/.test(c)), "aircon cleared: back to the first room and the others");
  // Home Assistant's own unit: a °C room in a °F home is drawn in °F
  r = await draw(W("aircon", {}, { w: 1000, h: 460 }), Object.assign(env(), { data: Object.assign({}, env().data, { unit: "f" }) }));
  has(r.text, "72°", "aircon: a room Home Assistant says is °C is drawn in °F in a °F home (22°C is 72°F)");
  r = await draw(W("aircon", {}, { w: 1000, h: 460 }), env(null, { rooms: [] }));
  ok(r.empty, "aircon with no rooms from Home Assistant: its setup card, never a demo room");
}
group = "controls";
{
  let r = await draw(W("controls"), env());
  ok(/Lounge/.test(r.text) && /Lamp/.test(r.text), "controls, none picked: every switch Smart home has: " + r.text);
  r = await draw(W("controls"), env({ switches: ["light.lamp"] }));
  ok(/Lamp/.test(r.text) && !/Lounge/.test(r.text), "controls Lights and switches picked: only the lamp: " + r.text);
  r = await draw(W("controls"), env({}));
  ok(/Lounge/.test(r.text) && /Lamp/.test(r.text), "controls cleared: every one again");
  r = await draw(W("controls"), env(), { layer: true });
  ok(/Outdoor lights/.test(r.layer) && /Wall clock/.test(r.layer) && !/Shellyplus1/.test(r.layer), "controls: outdoor lights and a wall clock show, a switch Home Assistant names a garage door does not: " + r.layer);
  ok(!OPENERS.test(r.text) && !OPENERS.test(r.layer) && /Lounge/.test(r.layer), "controls: a garage door never shows, by its name or by what Home Assistant calls it, on the widget or OK's layer (owner's rule): " + r.text + " / " + r.layer);
  r = await draw(W("controls"), env({ switches: ["cover.big_roller", "cover.garage"] }), { layer: true });
  ok(!OPENERS.test(r.text) && !OPENERS.test(r.layer) && /Lounge/.test(r.text), "controls: even picked, a garage door never shows (every safe one instead): " + r.text);
  r = await draw(W("controls"), env({ switches: ["light.gone_from_smart_home"] }), { layer: true });
  ok(/Lounge/.test(r.text) && /Lamp/.test(r.text) && /Lounge/.test(r.layer) && /Lamp/.test(r.layer), "controls: a pick no longer in Smart home gives every one, on the widget and its layer: " + r.text);
  r = await draw(W("controls"), { data: { ha: {} } });
  ok(r.empty && !/Lounge/.test(r.text), "controls with no Home Assistant: its setup card, no demo switches");
}
group = "camera";
{
  let r = await draw(W("camera", { label: "Front" }), env());
  ok(r.cam === "camera.backyard" && /Backyard/.test(r.text) && !/Front/.test(r.text), "camera, none picked: the first camera by its own name, never the design's words: " + r.text);
  r = await draw(W("camera", { label: "Front" }), env({ cam: "camera.driveway" }));
  ok(r.cam === "camera.driveway" && /Front/.test(r.text), "camera picked on this TV: the driveway, with the design's heading: " + r.text);
  r = await draw(W("camera"), env({ cam: "camera.driveway", label: "Carport" }));
  ok(/Carport/.test(r.text), "camera Heading typed on this TV shows: " + r.text);
  r = await draw(W("camera"), env({}));
  ok(r.cam === "camera.backyard" && /Backyard/.test(r.text), "camera cleared: the first camera again");
}
group = "doorbell";
{
  let r = await draw(W("doorbell"), env());
  ok(/Front door/.test(r.text) && r.pic, "doorbell: its own name and the door camera: " + r.text);
  r = await draw(W("doorbell"), env({ label: "Side gate" }));
  has(r.text, "Side gate", "doorbell Heading typed on this TV");
  r = await draw(W("doorbell"), env({ picture: false }));
  ok(!r.pic, "doorbell Show the door camera off: no picture");
  r = await draw(W("doorbell"), env({}));
  ok(/Front door/.test(r.text) && r.pic, "doorbell cleared: its own name and the picture again");
}
group = "sensor";
{
  let r = await draw(W("sensor", { label: "Spa" }), env());
  ok(/Pool/.test(r.text) && /26\.4/.test(r.text) && !/Spa/.test(r.text), "sensor, none picked: the first sensor by its own name: " + r.text);
  r = await draw(W("sensor", { label: "Gauge" }), env({ reading: "sensor.rain_today" }));
  ok(/Gauge/.test(r.text) && /12/.test(r.text) && /mm/.test(r.text) && !/26\.4/.test(r.text), "sensor picked on this TV: the rain gauge's reading, with the design's heading: " + r.text);
  r = await draw(W("sensor"), env({ reading: "sensor.rain_today", label: "Tank" }));
  has(r.text, "Tank", "sensor Heading typed on this TV");
  hasNot(r.text, "Rain gauge", "sensor Heading typed on this TV replaces the sensor's own name");
  r = await draw(W("sensor"), env({}));
  ok(/Pool/.test(r.text) && /26\.4/.test(r.text), "sensor cleared: the first sensor again");
}
group = "energy";
{
  let r = await draw(W("energy"), env());
  ok(/Solar/.test(r.text) && /kW now/.test(r.text), "energy: its own name, today and power now: " + r.text);
  r = await draw(W("energy"), env({ label: "Panels" }));
  has(r.text, "Panels", "energy Heading typed on this TV");
  r = await draw(W("energy"), env({ now: false }));
  ok(!/kW now/.test(r.text) && /kWh today/.test(r.text), "energy Show power now off: today only: " + r.text);
  r = await draw(W("energy"), env({}));
  ok(/kW now/.test(r.text), "energy cleared: power now again");
}
group = "solar";
{
  let r = await draw(W("solar"), env());
  const home = r.text;
  ok(/Sunrise/.test(home) && !/Tokyo/.test(home), "sun clock: the home's town by default: " + home);
  r = await draw(W("solar"), env({ town: { name: "Tokyo", lat: 35.68, lon: 139.69, timezone: "Asia/Tokyo" } }));
  ok(/Tokyo/.test(r.text) && r.text !== home, "sun clock Place set on this TV: Tokyo's own sunrise and sunset, said in Tokyo's time: " + r.text);
  const tk = await page.evaluate(() => { const K = window.CouchWidgets; return null; });
  r = await draw(W("solar", {}, { w: 460, h: 160 }), env({ town: { name: "Tokyo", lat: 35.68, lon: 139.69, timezone: "Asia/Tokyo" } }));
  const small = await draw(W("solar", {}, { w: 460, h: 160 }), env());
  ok(r.text !== small.text, "sun clock, a short box: the picked place's times too: " + r.text + " vs " + small.text);
  r = await draw(W("solar"), env({}));
  ok(r.text === home, "sun clock cleared: the home's town again");
  r = await draw(W("solar"), { data: { ha: HA, wset: {} } });
  // (23 Nov: its name, what it shows, and the one way: on the phone, or OK on a home with no phone page)
  ok(/^Sun clock/.test(r.text) && /Sunrise and sunset/.test(r.text) && /Set up on your phone|Press OK to set it up/.test(r.text), "sun clock with no town: says what it is and where to set it: " + r.text);
}
group = "battery";
{
  let r = await draw(W("battery"), env());
  ok(r.red === 1 && /Remote/.test(r.text), "batteries: only the remote at 12% is red under the default 20%: red " + r.red);
  r = await draw(W("battery"), env({ low: 50 }));
  ok(r.red === 2, "batteries Red below 50: the headset at 45% is red too: red " + r.red);
  r = await draw(W("battery", { low: 5 }), env());
  ok(r.red === 0, "batteries: the design's Red below 5: none red: " + r.red);
  r = await draw(W("battery", {}, { w: 460, h: 160 }), env());
  ok(/Remote/.test(r.text) && /Charge it soon/.test(r.text), "batteries, a short box: the lowest one, the remote: " + r.text);
  r = await draw(W("battery"), env({}));
  ok(r.red === 1, "batteries cleared: back to red below 20%");
  r = await draw(W("battery"), env(), { layer: true });
  ok(r.layerRed === 1 && /Remote/.test(r.layer), "batteries, OK's layer: only the remote red under the default 20%: red " + r.layerRed);
  r = await draw(W("battery"), env({ low: 50 }), { layer: true });
  ok(r.layerRed === 2, "batteries Red below 50: OK's layer shows the headset red too: red " + r.layerRed);
  r = await draw(W("battery", { low: 5 }), env(), { layer: true });
  ok(r.layerRed === 0, "batteries: the design's Red below 5 in OK's layer: none red: " + r.layerRed);
  r = await draw(W("battery"), env({ low: 99 }), { layer: true });
  ok(r.layerRed === 1, "batteries: an out of range Red below in OK's layer falls back to 20: red " + r.layerRed);
}
group = "speakers";
{
  let r = await draw(W("speakers"), env());
  ok(/Kitchen/.test(r.text) && /Deck/.test(r.text), "speakers, none picked: every speaker: " + r.text);
  r = await draw(W("speakers"), env({ players: ["media_player.deck"] }));
  ok(/Deck/.test(r.text) && !/Kitchen/.test(r.text), "speakers picked on this TV: only the deck: " + r.text);
  r = await draw(W("speakers"), env({}));
  ok(/Kitchen/.test(r.text) && /Deck/.test(r.text), "speakers cleared: every one again");
  r = await draw(W("speakers"), env({ players: ["media_player.gone_from_smart_home"] }), { layer: true });
  ok(/Kitchen/.test(r.text) && /Deck/.test(r.text) && /Kitchen/.test(r.layer) && /Deck/.test(r.layer), "speakers: a pick no longer in Smart home gives every one, on the widget and its layer: " + r.text);
}
group = "scenes";
{
  let r = await draw(W("scenes"), env(), { layer: true });
  ok(/Movie night/.test(r.text) && /Lights off/.test(r.text) && /3 scenes/.test(r.layer), "scenes, none picked: every scene, on the widget and its layer: " + r.text);
  r = await draw(W("scenes"), env({ scenes: ["scene.lights_off", "script.good_morning"] }), { layer: true });
  ok(/Lights off/.test(r.text) && /Good morning/.test(r.text) && !/Movie night/.test(r.text), "scenes picked on this TV: only those two: " + r.text);
  ok(/2 scenes/.test(r.layer) && !/Movie night/.test(r.layer), "and OK's layer shows only those two: " + r.layer);
  r = await draw(W("scenes", {}, { w: 240, h: 240 }), env({ scenes: ["scene.lights_off"] }));
  has(r.text, "1 scene", "scenes as a tile counts the picked ones");
  r = await draw(W("scenes"), env({}));
  ok(/Movie night/.test(r.text), "scenes cleared: every scene again");
  r = await draw(W("scenes"), env(), { layer: true });
  ok(!OPENERS.test(r.text) && !OPENERS.test(r.layer) && /3 scenes/.test(r.layer), "scenes: a scene or script for a garage, alarm or lock never shows (owner's rule): " + r.text);
  r = await draw(W("scenes"), env({ scenes: ["script.open_garage"] }), { layer: true });
  ok(!OPENERS.test(r.text) && !OPENERS.test(r.layer) && /Movie night/.test(r.text), "scenes: even picked, one that opens the house never shows: " + r.text);
  r = await draw(W("scenes"), env({ scenes: ["scene.gone_from_smart_home"] }), { layer: true });
  ok(/Movie night/.test(r.text) && /3 scenes/.test(r.layer), "scenes: a pick no longer in Smart home gives every one: " + r.text);
  r = await draw(W("scenes"), { data: {} });
  ok(r.empty && !/Movie night/.test(r.text), "scenes with none from Home Assistant: its setup card, no demo scenes");
}
group = "bins";
{
  const base = { weekday: 2, bin_a: "Recycling", bin_b: "Garden" };
  let r = await draw(W("bins", base), env());
  const day0 = r.text;
  ok(r.fills.indexOf("#ffd60a") >= 0 && r.fills.indexOf("#30d158") >= 0 && /Recycling/.test(r.text), "bins: the default lids, yellow and green: " + r.fills.join(","));
  r = await draw(W("bins", base), env({ weekday: 5 }));
  ok(r.text !== day0, "bins Bin night set on this TV changes the night: " + r.text);
  r = await draw(W("bins", base), env({ bin_a: "Paper", bin_b: "Food" }));
  ok(/Paper/.test(r.text) && /Food/.test(r.text), "bins First bin and Second bin set on this TV: " + r.text);
  r = await draw(W("bins", base), env({ lid_a: "#0a84ff", lid_b: "#a2845e" }));
  ok(r.fills.indexOf("#0a84ff") >= 0 && r.fills.indexOf("#a2845e") >= 0 && r.fills.indexOf("#ffd60a") < 0, "bins lid colours set on this TV: " + r.fills.join(","));
  r = await draw(W("bins", Object.assign({ lid_a: "#ff453a" }, base)), env());
  ok(r.fills.indexOf("#ff453a") >= 0, "bins: the design's lid colour");
  r = await draw(W("bins", base), env({ lid_a: "red;background:url(x)" }));
  ok(r.fills.indexOf("#ffd60a") >= 0 && !r.fills.some((f) => /url/.test(f)), "bins: anything but a colour is never drawn");
  r = await draw(W("bins", base, { w: 460, h: 160 }), env({ lid_a: "#0a84ff" }));
  ok(r.fills.indexOf("#0a84ff") >= 0, "bins, a short box: the lid colour too");
  r = await draw(W("bins", base), env({ alt: true, anchor: 1 }));
  ok(/Rubbish/.test(r.text), "bins Taking turns on: rubbish and one of the two: " + r.text);
  r = await draw(W("bins", base), env({}));
  ok(r.text === day0 && r.fills.indexOf("#ffd60a") >= 0, "bins cleared: the design's night and the default lids");
  r = await draw(W("bins", {}), env());
  ok(r.empty, "bins with no night set: says to set it, never a made up night");
}
ok(!errors.length, "no page errors: " + errors.join("; "));
await page.close();

// ======================= B and C. the real TV page and the phone =======================
const KINDS = ["aircon", "controls", "camera", "doorbell", "sensor", "energy", "solar", "battery", "speakers", "scenes", "bins"];
const NAMES = { aircon: "Aircon", controls: "Control Centre", camera: "Camera", doorbell: "Doorbell", sensor: "Sensor", energy: "Solar and energy", solar: "Sun clock",
  battery: "Batteries", speakers: "Speakers", scenes: "Scenes", bins: "Bin night" };
const POS = [[40, 40], [520, 40], [1000, 40], [1460, 40], [40, 340], [520, 340], [1000, 340], [1460, 340], [40, 640], [520, 640], [1000, 640]];
const design = (kinds) => ({ v: 1, background: { colour: "#1d3a4f" },
  elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: kinds.map((k) => { const i = KINDS.indexOf(k); return { id: k.slice(0, 3) + i, type: "widget", kind: k, x: POS[i][0], y: POS[i][1], w: 440, h: 280, opts: k === "bins" ? { weekday: 2 } : {} }; }) });
const idOf = (k) => k.slice(0, 3) + KINDS.indexOf(k);
const press = async (p, k, wait) => { await p.keyboard.press(k); await p.waitForTimeout(wait || 160); };
async function meteo(p) {
  await p.route(/open-meteo\.com/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 22, weather_code: 1, is_day: 1, time: "" }, hourly: {}, daily: {} }) }));
}
async function tvPage(d) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.errors = []; p.on("pageerror", (e) => p.errors.push(String(e)));
  p.logs = []; p.on("console", (m) => p.logs.push(m.text().slice(0, 200)));
  await meteo(p);
  await p.addInitScript(() => { window.TVOS = Object.assign(window.TVOS || {}, { batteries: () => JSON.stringify({ need: "", devices: [{ kind: "remote", name: "Remote", level: 12 }] }) }); });
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&reset=1");
  await p.evaluate((dz) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, d);
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&ha=1&design=local");
  await p.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on());
  await p.waitForTimeout(1500);
  return p;
}
async function openSettings(p) { await p.evaluate(() => window.tv.settingsKey()); await p.waitForTimeout(250); await press(p, "Enter", 500); }
async function closeSettings(p) { for (let k = 0; k < 6 && await p.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(p, "Escape", 1000); await p.waitForTimeout(3000); }
const secs = (p) => p.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
const rowsText = (p) => p.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
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
async function closeSheet(p) { for (let k = 0; k < 3 && await p.evaluate(() => !!document.querySelector(".cw-sheet")); k++) await press(p, "Escape", 1000); await p.waitForTimeout(3000); }
// Hold OK on a widget, Edit on the TV: its own page (answers the page's rows)
async function editOnTv(p, id) {
  // (Back is pressed slowly everywhere here: five presses within 4 seconds switch the design off, design.js)
  const items = await holdOn(p, id);
  const i = items.indexOf("Edit on the TV");
  if (i < 0) { await closeSheet(p); console.log("  hold menu on " + id + ": " + items.join(", ")); return null; }
  for (let k = 0; k < i; k++) await press(p, "ArrowDown", 100);
  await press(p, "Enter", 700);
  return { head: await p.textContent("#set-head"), rows: await rowsText(p) };
}
const onScreen = (p, id) => p.evaluate((x) => { const e = document.querySelector('.cw-o[data-obj="' + x + '"] .cw'); return e ? { text: e.textContent.replace(/\s+/g, " "), cam: (e.querySelector("[data-ha-cam]") || e).getAttribute("data-ha-cam") || "" } : null; }, id);

group = "on the TV";
const tv = await tvPage(design(KINDS));
TV = tv;
group = "nothing that opens the house";
{
  // the one house test, as the TV page runs it (smarthome.js and widgets.js), with the ids every copy is
  // tested with (tests/fixtures/opens_house_ids.json: bridge, Android, home-config.py run the same)
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/opens_house_ids.json"), "utf8"));
  const r = await tv.evaluate((t) => {
    const a = window.smartHome.opensHouse, b = window.CouchWidgets.kit.ha.opensHouse, wrong = [];
    t.refuse.forEach((e) => { if (!a(e)) wrong.push("smarthome.js shows " + e); if (!b(e)) wrong.push("widgets.js shows " + e); });
    t.pass.forEach((e) => { if (a(e)) wrong.push("smarthome.js hides " + e); if (b(e)) wrong.push("widgets.js hides " + e); });
    return { wrong, n: t.refuse.length + t.pass.length };
  }, T);
  ok(r.n >= 80 && !r.wrong.length, "the TV page's house test agrees on all " + r.n + " ids: " + r.wrong.join(", "));
}
group = "on the TV";
{
  // real data only: a real TV page never draws the designer's demo readings
  const all = await tv.evaluate(() => document.querySelector(".cd-layer") ? document.querySelector(".cd-layer").textContent : document.body.textContent);
  ok(!/Fairy lights|Ceiling fan.*Porch|Saltwater Radio.*Deck.*Living/.test(all), "the TV draws no demo smart home readings");
  ok(/Living room/.test((await onScreen(tv, idOf("aircon"))).text), "the aircon on screen is the pretend Home Assistant's first room: " + (await onScreen(tv, idOf("aircon"))).text);

  // B1. Home settings, Designs, Widgets on this home: one row for each of the eleven
  await openSettings(tv);
  await goSec(tv, "Designs");
  const rows = (await rowsText(tv)).join(" | ");
  ok(/Widgets on this home/.test(await tv.textContent("#set-rows")), "Home settings, Designs, has Widgets on this home: " + rows.slice(0, 300));
  KINDS.forEach((k) => ok(rows.indexOf(NAMES[k] + ",") >= 0, "Widgets on this home lists " + NAMES[k] + " while it is on the design"));
  ok(/Aircon, [^|]*Room: The first one in Smart home/.test(rows), "the aircon's row says its room is the first one in Smart home: " + rows.slice(0, 400));
  await closeSettings(tv);

  // B2. Hold OK, Edit on the TV: every one of the eleven has it and its page lists its settings
  const want = { aircon: ["Room", "Show the other rooms"], controls: ["Lounge", "Lamp", "Which ones show here"], camera: ["Camera", "Heading"], doorbell: ["Heading", "Show the door camera"],
    sensor: ["Sensor", "Heading"], energy: ["Heading", "Show power now"], solar: ["Place"], battery: ["Red below"], speakers: ["Kitchen", "Deck", "Which speakers show here"], scenes: ["Movie night", "Lights off", "Good morning", "Which scenes show here"],
    bins: ["Bin night", "Taking turns", "First bin", "Second bin", "First bin's lid", "Second bin's lid"] };
  for (const k of KINDS) {
    const pg = await editOnTv(tv, idOf(k));
    ok(!!pg, NAMES[k] + ": Hold OK has Edit on the TV");
    if (!pg) continue;
    ok(pg.head.indexOf(NAMES[k]) >= 0, NAMES[k] + ": Edit on the TV opens its own page: " + pg.head);
    const t = pg.rows.join(" | ");
    want[k].forEach((l) => ok(t.indexOf(l) >= 0, NAMES[k] + ": its page has " + l + ": " + t.slice(0, 300)));
    if (k === "controls" || k === "scenes") ok(!OPENERS.test(t), NAMES[k] + ": its pick list never has a garage door, a lock or an alarm (owner's rule): " + t.slice(0, 400));
    await closeSettings(tv);
  }
}
group = "device pick on the TV";
{
  // C1. the aircon's Room is a list of the rooms this TV has: OK steps to the next, the widget follows
  let pg = await editOnTv(tv, idOf("aircon"));
  ok(pg.rows.some((r) => /Room/.test(r) && /The first one in Smart home/.test(r)), "aircon page: Room says the first one: " + pg.rows.join(" | "));
  ok(!pg.rows.some((r) => /Pick the devices this TV shows/.test(r)), "no more 'Pick the devices this TV shows' line in place of a list");
  await press(tv, "Enter", 400);   // Room: The first one -> Living room
  await press(tv, "Enter", 400);   // -> Bedroom
  let rows = await rowsText(tv);
  ok(rows.some((r) => /Room/.test(r) && /Bedroom/.test(r)), "OK on Room steps through the rooms Smart home has, to Bedroom: " + rows.join(" | "));
  ok(rows.some((r) => /Clear room/.test(r)), "with a row back to the first one");
  await closeSettings(tv); await tv.waitForTimeout(600);
  ok(/^\s*Bedroom/.test((await onScreen(tv, idOf("aircon"))).text), "the aircon on screen now shows the bedroom: " + (await onScreen(tv, idOf("aircon"))).text);
  // the switches: a tick list of what Smart home has; ticking one shows only it
  pg = await editOnTv(tv, idOf("controls"));
  const ticks = pg.rows.filter((r) => /^(Lounge|Lamp|Ceiling fan|Blinds|Heater|Garage|Big roller)/.test(r));
  ok(ticks.length === 5 && !OPENERS.test(pg.rows.join(" | ")), "Control Centre page: a tick for each switch this TV has, never a garage door: " + pg.rows.join(" | "));
  await tv.evaluate(() => { const r = [...document.querySelectorAll("#set-rows .srow")]; const i = r.findIndex((e) => /^Lamp/.test(e.textContent.trim())); window.__lamp = i; });
  const li = await tv.evaluate(() => window.__lamp), at = await tv.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < li - at; k++) await press(tv, "ArrowDown", 80);
  await press(tv, "Enter", 400);
  await closeSettings(tv); await tv.waitForTimeout(3500);
  const cc = (await onScreen(tv, idOf("controls"))).text;
  ok(/Lamp/.test(cc) && !/Lounge/.test(cc), "Control Centre on screen shows only the lamp ticked on the TV: " + cc);
  // the words in Widgets on this home name the picks
  await openSettings(tv); await goSec(tv, "Designs");
  rows = (await rowsText(tv)).join(" | ");
  ok(/Room: Bedroom/.test(rows) && /Lights and switches: Lamp/.test(rows), "Widgets on this home names the picks: " + rows.slice(0, 500));
  await closeSettings(tv);
  // what the phone gets: the same list, with entity ids to pick
  const view = await tv.evaluate(() => window.tv.atHomeRead().design.widgets);
  const cam = view.find((w) => w.kind === "camera").settings.find((s) => s.key === "cam");
  ok(cam.type === "device" && cam.options.some((o) => o[0] === "camera.driveway" && o[1] === "Driveway") && cam.options[0][0] === "", "the phone is handed the cameras this TV has, after The first one: " + JSON.stringify(cam.options));
  const sc = view.find((w) => w.kind === "scenes").settings.find((s) => s.key === "scenes");
  ok(sc.many && sc.options.length === 3 && sc.options.every((o) => /^(scene|script)\./.test(o[0])), "the scenes list is the scenes and scripts only: " + JSON.stringify(sc.options));
  const sw = view.find((w) => w.kind === "controls").settings.find((s) => s.key === "switches");
  ok(sw.options.length === 5 && !sw.options.some((o) => /garage|big_roller/.test(o[0])), "the phone is handed the switches without a garage door: " + JSON.stringify(sw.options));
  ok(!sc.options.some((o) => /open_garage|disarm_alarm|unlock/.test(o[0])), "the phone is handed no scene or script that opens the house: " + JSON.stringify(sc.options));
  const sp = view.find((w) => w.kind === "speakers").settings.find((s) => s.key === "players");
  ok(sp.options.every((o) => /^media_player\./.test(o[0])) && sp.options.length === 2, "the speakers list is the speakers only");
  // a device from the phone that this TV does not have is refused
  const bad = await tv.evaluate((id) => window.tv.atHomeEdit({ widget_set: { key: id + "|camera", values: { cam: "camera.someone_elses" } } }), idOf("camera"));
  ok(!bad.ok, "a camera this TV does not have is refused: " + JSON.stringify(bad));
  const garage = await tv.evaluate((id) => window.tv.atHomeEdit({ widget_set: { key: id + "|controls", values: { switches: ["cover.garage", "cover.big_roller"] } } }), idOf("controls"));
  const kept = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.find((w) => w.kind === "controls").settings.find((s) => s.key === "switches").value);
  ok(!(kept || []).some((e) => /garage|big_roller/.test(e)), "a garage door sent from a phone is never kept: " + JSON.stringify(garage) + " " + JSON.stringify(kept));
  // a ticked switch that later leaves Smart home: it drops out of the saved list when the ticks change,
  // so it never counts toward the most and unticking every one gives every one again
  const lamp = await tv.evaluate((id) => window.tv.atHomeEdit({ widget_set: { key: id + "|controls", values: { switches: ["light.lamp"] } } }), idOf("controls"));
  ok(lamp.ok, "the lamp ticked again: " + JSON.stringify(lamp));
  await tv.evaluate(() => { const was = window.TVHA.info; window.TVHA.info = () => { const o = JSON.parse(was()); o.controls = o.controls.filter((c) => c.entity !== "light.lamp"); return JSON.stringify(o); }; window.smartHome.reload(); });
  await tv.waitForTimeout(500);
  pg = await editOnTv(tv, idOf("controls"));
  ok(!pg.rows.some((r) => /^Lamp/.test(r)), "the lamp left Smart home: no tick for it: " + pg.rows.join(" | "));
  await tv.evaluate(() => { const r = [...document.querySelectorAll("#set-rows .srow")]; window.__lounge = r.findIndex((e) => /^Lounge/.test(e.textContent.trim())); });
  const lo = await tv.evaluate(() => window.__lounge), at2 = await tv.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < lo - at2; k++) await press(tv, "ArrowDown", 80);
  await press(tv, "Enter", 400);   // tick the lounge
  let saved = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.find((w) => w.kind === "controls").settings.find((s) => s.key === "switches").value);
  ok(JSON.stringify(saved) === JSON.stringify(["light.lounge"]), "ticking the lounge keeps only the lounge, not the lamp that left: " + JSON.stringify(saved));
  await press(tv, "Enter", 400);   // untick it
  saved = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.find((w) => w.kind === "controls").settings.find((s) => s.key === "switches").value);
  ok(saved === null || saved === undefined || (Array.isArray(saved) && !saved.length), "unticking it gives every one again: " + JSON.stringify(saved));
  await closeSettings(tv);
  await openSettings(tv); await goSec(tv, "Designs");
  ok(/Lights and switches: Every one in Smart home/.test((await rowsText(tv)).join(" | ")), "Widgets on this home says every one again");
  await closeSettings(tv);
}

group = "on the phone";
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
  const keys = await phone.evaluate(() => [...document.querySelectorAll("#w-list details")].map((d) => d.getAttribute("data-key")));
  KINDS.forEach((k) => ok(keys.indexOf(idOf(k) + "|" + k) >= 0, "the phone's Widgets on this TV has " + NAMES[k]));
  // the camera: a real pick from the TV's cameras
  const ck = idOf("camera") + "|camera";
  await phone.click('#w-list details[data-key="' + ck + '"] summary');
  const opts = await phone.evaluate((k) => [...document.querySelectorAll('#w-list select[data-wk="' + k + '"][data-ws="cam"] option')].map((o) => o.textContent), ck);
  ok(opts.join(",") === "The first one in Smart home,Backyard,Driveway", "the phone picks a camera from the TV's own list: " + opts.join(","));
  ok(!/Pick the devices this TV shows in Home settings/.test(await phone.textContent("#w-list")), "the phone no longer sends people to Home settings to pick");
  await phone.selectOption('#w-list select[data-wk="' + ck + '"][data-ws="cam"]', "camera.driveway");
  await phone.waitForTimeout(1500);
  ok((await onScreen(tv, idOf("camera"))).cam === "camera.driveway", "the TV's camera widget now shows the driveway: " + JSON.stringify(await onScreen(tv, idOf("camera"))));
  // back to the first one from the phone
  await phone.selectOption('#w-list select[data-wk="' + ck + '"][data-ws="cam"]', "");
  await phone.waitForTimeout(1500);
  ok((await onScreen(tv, idOf("camera"))).cam === "camera.backyard", "The first one from the phone clears it: the backyard again");
  // the scenes: ticks on the phone
  const sk = idOf("scenes") + "|scenes";
  await phone.click('#w-list details[data-key="' + sk + '"] summary');
  const boxes = await phone.$$('#w-list input[data-wmany][data-wk="' + sk + '"]');
  ok(boxes.length === 3, "three scene ticks on the phone");
  await boxes[1].check(); await phone.waitForTimeout(1500);
  const sct = (await onScreen(tv, idOf("scenes"))).text;
  ok(/Lights off/.test(sct) && !/Movie night/.test(sct), "the TV's scenes widget shows only the scene ticked on the phone: " + sct);
  // bins: which bin goes out this week, from the phone, sets the count the widget keeps
  const bk = idOf("bins") + "|bins";
  const send = (k, v) => tv.evaluate(([key, k, v]) => { const x = {}; x[k] = v; return window.tv.atHomeEdit({ widget_set: { key, values: x } }); }, [bk, k, v]);
  await send("alt", true); await send("thisweek", "b"); await tv.waitForTimeout(800);
  ok(/Garden/.test((await onScreen(tv, idOf("bins"))).text) && /Rubbish/.test((await onScreen(tv, idOf("bins"))).text), "bins Which bin goes out this week: the second bin, Garden, with the rubbish: " + (await onScreen(tv, idOf("bins"))).text);
  await send("thisweek", "a"); await tv.waitForTimeout(800);
  ok(/Recycling/.test((await onScreen(tv, idOf("bins"))).text), "and the first bin, Recycling, when picked: " + (await onScreen(tv, idOf("bins"))).text);
  // battery, energy, doorbell, aircon toggles and numbers from the phone change the TV's widgets
  const tk = (k) => idOf(k) + "|" + k;
  const before = (await onScreen(tv, idOf("energy"))).text;
  let e = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { label: "Roof panels" } } }), tk("energy"));
  await tv.waitForTimeout(800);
  ok(e.ok && /Roof panels/.test((await onScreen(tv, idOf("energy"))).text), "energy Heading from the phone shows on the TV: " + (await onScreen(tv, idOf("energy"))).text);
  e = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { label: null } } }), tk("energy"));
  await tv.waitForTimeout(800);
  ok(e.ok && (await onScreen(tv, idOf("energy"))).text === before, "energy Heading cleared from the phone: as before");
  e = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { label: "Front gate bell" } } }), tk("doorbell"));
  await tv.waitForTimeout(800);
  ok(e.ok && /Front gate bell/.test((await onScreen(tv, idOf("doorbell"))).text), "doorbell Heading from the phone shows on the TV: " + (await onScreen(tv, idOf("doorbell"))).text);
  e = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { entity: "climate.living_room" } } }), tk("aircon"));
  await tv.waitForTimeout(800);
  ok(e.ok && /^\s*Living room/.test((await onScreen(tv, idOf("aircon"))).text), "aircon Room from the phone (the TV had the bedroom): the living room on the TV: " + (await onScreen(tv, idOf("aircon"))).text);
  let r = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { low: 45 } } }), tk("battery"));
  ok(r.ok, "Red below from the phone saves");
  r = await tv.evaluate((k) => window.tv.atHomeEdit({ widget_set: { key: k, values: { low: 90 } } }), tk("battery"));
  ok(!r.ok, "Red below out of range is refused");
}

group = "a scene that opens the house";
{
  // picked earlier, then the TV refuses to run it (Home Assistant names it for a lock, or it sets one):
  // its button goes from the widget and from the pick lists at once
  await tv.evaluate(() => {
    const was = window.TVHA.request;
    window.TVHA.request = function (id, action, entity, value) {
      if (action === "scene" && entity === "scene.lights_off") return setTimeout(() => window.smartHome.reply(id, { ok: false, error: "refused" }), 50);
      return was.apply(this, arguments);
    };
  });
  ok(/Lights off/.test((await onScreen(tv, idOf("scenes"))).text), "the scenes widget shows Lights off before it is run: " + (await onScreen(tv, idOf("scenes"))).text);
  const r = await tv.evaluate(() => window.smartHome.request("scene", "scene.lights_off"));
  ok(r && r.error === "refused", "running it is refused: " + JSON.stringify(r));
  await tv.waitForTimeout(1500);
  const after = (await onScreen(tv, idOf("scenes"))).text;
  ok(!/Lights off/.test(after) && /Movie night/.test(after), "its button is gone, the rest show: " + after);
  const opts = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.find((w) => w.kind === "scenes").settings.find((x) => x.key === "scenes").options.map((o) => o[0]));
  ok(opts.indexOf("scene.lights_off") < 0 && opts.indexOf("scene.movie_night") >= 0, "and from the scenes pick list: " + opts.join(","));
  ok(!tv.errors.length, "no TV page errors: " + tv.errors.join("; "));
}

group = "only while on screen";
{
  // the design changes: the camera, scenes and battery leave it
  const left = KINDS.filter((k) => ["camera", "scenes", "battery"].indexOf(k) < 0);
  await tv.evaluate((dz) => localStorage.setItem("tvdesigner.design", JSON.stringify(dz)), design(left));
  await tv.goto(ORIGIN + "/tv-home/web/index.html?mock=1&ha=1&design=local");
  await tv.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on());
  await tv.waitForTimeout(1500);
  await openSettings(tv); await goSec(tv, "Designs");
  const rows = (await rowsText(tv)).join(" | ");
  ["camera", "scenes", "battery"].forEach((k) => ok(rows.indexOf(NAMES[k] + ",") < 0, NAMES[k] + " is gone from Widgets on this home once it leaves the design"));
  left.forEach((k) => ok(rows.indexOf(NAMES[k] + ",") >= 0, NAMES[k] + " stays while it is on the design"));
  await closeSettings(tv);
  ok(await tv.evaluate(() => !document.querySelector('.cw-o[data-obj^="cam"]')), "no camera on screen");
  const pg = await editOnTv(tv, idOf("aircon"));
  ok(!!pg && /Aircon/.test(pg.head), "a widget still on screen keeps Edit on the TV");
  await closeSettings(tv);
  await phone.reload();
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  await phone.waitForFunction(() => document.querySelectorAll("#w-list details").length > 0, null, { timeout: 10000 });
  const keys = await phone.evaluate(() => [...document.querySelectorAll("#w-list details")].map((d) => d.getAttribute("data-key")));
  ["camera", "scenes", "battery"].forEach((k) => ok(keys.indexOf(idOf(k) + "|" + k) < 0, NAMES[k] + " is gone from the phone's Widgets on this TV"));
  left.forEach((k) => ok(keys.indexOf(idOf(k) + "|" + k) >= 0, NAMES[k] + " stays on the phone"));
}
{
  // the rest leave too, in two steps (bins last), so every one of the eleven is seen to go
  for (const [keep, gone] of [[["bins"], KINDS.filter((k) => k !== "bins")], [["aircon"], ["bins"]]]) {
    await tv.evaluate((dz) => localStorage.setItem("tvdesigner.design", JSON.stringify(dz)), design(keep));
    await tv.goto(ORIGIN + "/tv-home/web/index.html?mock=1&ha=1&design=local");
    await tv.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on());
    await tv.waitForTimeout(1500);
    await openSettings(tv); await goSec(tv, "Designs");
    const rows = (await rowsText(tv)).join(" | ");
    gone.forEach((k) => ok(rows.indexOf(NAMES[k] + ",") < 0, NAMES[k] + " is gone from Widgets on this home once it leaves the design"));
    ok(rows.indexOf(NAMES[keep[0]] + ",") >= 0, NAMES[keep[0]] + " stays while it is on the design");
    await closeSettings(tv);
    const pg = await editOnTv(tv, idOf(keep[0]));
    ok(!!pg && pg.head.indexOf(NAMES[keep[0]]) >= 0, NAMES[keep[0]] + " keeps Edit on the TV, the only one on screen");
    await closeSettings(tv);
    await phone.reload();
    await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
    await phone.waitForFunction(() => document.querySelectorAll("#w-list details").length > 0, null, { timeout: 10000 });
    const keys = await phone.evaluate(() => [...document.querySelectorAll("#w-list details")].map((d) => d.getAttribute("data-key")));
    gone.forEach((k) => ok(keys.indexOf(idOf(k) + "|" + k) < 0, NAMES[k] + " is gone from the phone's Widgets on this TV"));
    ok(keys.indexOf(idOf(keep[0]) + "|" + keep[0]) >= 0, NAMES[keep[0]] + " stays on the phone");
  }
  ok(!tv.errors.length, "no TV page errors: " + tv.errors.join("; "));
  ok(!phone.errors.length, "no phone page errors: " + phone.errors.join("; "));
}

await browser.close();
server.close();
console.log(Object.keys(counts).map((g) => "  " + g + ": " + counts[g]).join("\n"));
console.log("All " + n + " checks passed.");
