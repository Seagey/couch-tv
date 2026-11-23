// The smart home and music widgets (group C: Control Centre, camera, doorbell, energy, sensor, speakers,
// Up next queue), in a real browser at 1920x1080, against a pretend Home Assistant (mock.js ?ha=1,
// the launcher's window.TVHA stand in) and a pretend bridge. Nothing real is ever asked.
//  1. every size of each, as Couch TV Studio draws it (demo), as a TV with readings, long names and big numbers, or align left draws it, and as a
//     TV with nothing set up draws it: words 23 px and up, nothing past its box, the set up card when
//     nothing is set up, and never a reading on a TV that has none;
//  2. on a TV: the widgets fill from Home Assistant; OK opens each layer; a switch, a volume and play
//     or pause reach Home Assistant; a garage door is never switched; a camera still changes every 2 s;
//  3. a design only ever carries entity ids for them (design.js drops anything else), and couch-tv
//     Studio's demo never asks Home Assistant.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_smart_widgets_browser.mjs
// SHOTS=<folder> also saves a picture of every size for a person to look at.
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
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });
const KINDS = ["controls", "camera", "doorbell", "energy", "sensor", "speakers", "queue"];

const browser = await chromium.launch();
async function home(widgets, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => { const R = rect(x[1], x[2], x[3], x[4]); return Object.assign({ id: "w" + i, type: "widget", kind: x[0], x: R.x, y: R.y, w: R.w, h: R.h }, x[5] ? { opts: x[5] } : {}); }) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDetail);
  await page.waitForTimeout(500);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 300); };
const cur = (page) => page.evaluate(() => window.CouchDetail.current());
const text = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id || "w0");
async function openOn(page, id) {
  await page.evaluate((i) => { const s = window.CouchDesign.nav; for (let k = 0; k < 6 && s.current().id !== i; k++) s.move(-1, 0); }, id || "w0");
  await press(page, "Enter", 800);
}

console.log("Running smart home and music widget browser tests...");

// 1. every size, five ways: Couch TV Studio's demo, a TV with readings, a TV with very long names and
// big numbers, a TV with the design set to align left, and a TV with nothing set up.
// seagey, 18 Nov 2026: "Make sure each widget fits in each container correctly things aren't cut off and
// all icons etc are default centre align unless it's changed in the designer." So, for each widget at
// each size: every word and icon inside its box; no words cut (scrollWidth and scrollHeight within the
// element, no ellipsis); words 23 px and up; the content centred, or at the left when the design says left.
const SAMPLE = (long) => {
  const t0 = Date.now(), L = (s, l) => (long ? l : s);
  return { info: { controls: [{ entity: "light.a", name: "x" }], cameras: [{ entity: "camera.yard", name: L("Backyard", "The camera over the back fence by the shed") }],
      sensors: [{ entity: "sensor.pool", name: L("Pool", "Pool water temperature at the skimmer box") }], speakers: [{ entity: "media_player.k", name: "Kitchen" }], energy: true, doorbell: true, doorbell_camera: true },
    controls: [{ entity: "light.a", name: L("Lounge", "The big lounge room lamp by the window ok"), ok: true, kind: "light", on: true, level: 60 },
      { entity: "cover.g", name: L("Garage", "Garage door on the side of the house too"), ok: true, kind: "cover", on: false, blocked: true },
      { entity: "switch.h", name: L("Heater", "Bathroom heater and the towel rail switch"), ok: false, kind: "switch" }, { entity: "fan.f", name: L("Fan", "Ceiling fan in the main bedroom upstairs"), ok: true, kind: "fan", on: false }],
    sensors: [{ entity: "sensor.pool", name: L("Pool", "Pool water temperature at the skimmer box"), ok: true, value: L("26.4", "123456.7"), num: long ? 123456.7 : 26.4, unit: L("°C", "kWh"), cls: "temperature" }],
    hist: { "sensor.pool": { points: Array.from({ length: 24 }, (_, i) => (long ? 120000 : 24) + Math.sin(i / 3) * (long ? 3000 : 1)) } },
    energy: { ok: true, name: L("Solar", "Solar on the shed roof and the garage too"), total: long ? 12345.67 : 12.34, battery: long ? 100 : 77, power: long ? 1234.5 : 1.2, power_unit: "kW",
      hours: Array.from({ length: 24 }, (_, i) => i < 15 ? Math.max(0, 3 - Math.abs(12 - i) / 2) : null) },
    speakers: [{ entity: "media_player.k", name: L("Kitchen", "Kitchen speaker on the shelf above the fridge"), ok: true, state: "playing", volume: 100,
      title: L("A song", "A very long song title that goes on and on (Remastered 2011)"), artist: L("A band", "An artist with a long name and friends") }, { entity: "media_player.d", name: L("Deck", "Deck speakers out the back by the barbecue"), ok: false }],
    bell: { ok: true, name: L("Front door", "Front door doorbell at the end of the drive"), at: t0 - 3 * 3600000, ringing: false, camera: true, kept: false },
    stills: { "camera.yard": "PIC", doorbell: "PIC" } };
};
const QUEUE = (long) => ({ ok: true, items: [{ title: long ? "A very long song title that goes on and on and on (Remastered 2011 Deluxe Edition)" : "Low Tide", artist: long ? "An artist with a long name, and another one" : "Saltwater Radio", art: null },
  { title: "Fog Lights", artist: "Northern Rivers Club", art: null }, { title: "Golden Hour Drive", artist: "The Weekend Shifts", art: null }] });
async function drawAll(page, shots) {
  return page.evaluate(({ KINDS, SAMPLE, QUEUE, shots }) => {
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets;
    const pic = (() => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const g = c.getContext("2d"); g.fillStyle = "#3a6"; g.fillRect(0, 0, 64, 36); g.fillStyle = "#cde"; g.fillRect(0, 0, 64, 12); return c.toDataURL("image/jpeg"); })();
    const S = (long) => { const s = eval("(" + SAMPLE + ")")(long); s.stills = { "camera.yard": pic, doorbell: pic }; return s; };
    const Q = eval("(" + QUEUE + ")");
    const envs = { designer: { demo: true, designer: true }, tv: { data: { bridge: true, place: {}, ha: S(false), queue: Q(false) } }, long: { data: { bridge: true, place: {}, ha: S(true), queue: Q(true) } },
      left: { data: { bridge: true, place: {}, ha: S(false), queue: Q(false) }, opts: { align: "left" } }, unset: { data: { bridge: false, place: {}, ha: {} } } };
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
    document.body.appendChild(host);
    const out = [], placed = []; let count = 0, x = 20, y = 20, rowH = 0;
    KINDS.forEach((kind) => {
      if (shots && shots !== kind) return;
      const s = C.get(kind).sizes, list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat([["min", s.min[0], s.min[1]]]);
      list.forEach(([id, w, h]) => Object.keys(envs).forEach((en) => {
        if (!shots) while (host.firstChild) host.removeChild(host.firstChild);
        const env = envs[en], o = { id: "t", kind, w: w * 100 - 40, h: h * 100 - 40 };
        if (env.opts) o.opts = env.opts;
        const el = W.render(o, env);
        if (shots) { if (x + o.w > 1900) { x = 20; y += rowH + 20; rowH = 0; } el.style.position = "absolute"; el.style.left = x + "px"; el.style.top = y + "px"; x += o.w + 20; rowH = Math.max(rowH, o.h); host.appendChild(el); placed.push(el); return; }
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        const tag = kind + " " + id + " " + en + ": ", b = el.getBoundingClientRect(), txt = el.textContent, leaves = [];
        el.querySelectorAll("*").forEach((node) => {
          if (node.closest(".cw-bg")) return;
          const r = node.getBoundingClientRect(), cs = getComputedStyle(node);
          if (r.width > 0 && r.height > 0 && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1)) out.push(tag + (typeof node.className === "string" ? node.className : node.tagName) + " past the box");
          const words = [].some.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim());
          if (words) {
            const fs = parseFloat(cs.fontSize);
            if (fs > 0 && fs < 23) out.push(tag + "words at " + fs + " px");
            if (cs.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth + 1) out.push(tag + "words cut with ... (" + node.textContent.slice(0, 30) + ")");
            if (node.scrollWidth > node.clientWidth + 1 || (cs.overflow !== "visible" || cs.webkitLineClamp !== "none") && node.scrollHeight > node.clientHeight + 1) out.push(tag + "words cut (" + node.textContent.slice(0, 30) + ")");
          }
          if (r.width > 0 && r.height > 0 && !node.classList.contains("cw-fill") && (node.tagName.toLowerCase() === "svg" || !node.closest("svg")) && (words || node.tagName.toLowerCase() === "svg" || !node.children.length)) leaves.push(r);
        });
        if (en === "unset" && !el.getAttribute("data-setup")) out.push(tag + "no setup card");
        if (en === "unset" && /26\.4|12\.3|Lounge|Kitchen|Low Tide/.test(txt)) out.push(tag + "shows a reading");
        if (en !== "unset" && en !== "designer" && el.getAttribute("data-empty")) out.push(tag + "empty although it has readings");
        if (en !== "unset" && leaves.length) {
          const l = Math.min(...leaves.map((r) => r.left)), rr = Math.max(...leaves.map((r) => r.right)), mid = (l + rr) / 2, want = (b.left + b.right) / 2;
          if (en === "left") { if (l - b.left > 50) out.push(tag + "not at the left (" + Math.round(l - b.left) + " px in)"); }
          else if (Math.abs(mid - want) > Math.max(8, b.width * 0.04)) out.push(tag + "not centred (" + Math.round(mid - want) + " px off)");
        }
      }));
    });
    if (shots) { host.style.height = (y + rowH + 20) + "px"; return { height: y + rowH + 40 }; }
    host.remove();
    return { out, count };
  }, { KINDS, SAMPLE: SAMPLE.toString(), QUEUE: QUEUE.toString(), shots });
}
{
  const page = await home([["clock", 0, 0, 2, 2]], "");
  const bad = await drawAll(page, null);
  ok(bad.count >= 150, "drew " + bad.count + " widget sizes");
  ok(bad.out.length === 0, "every size fits, nothing cut, centred, honest (" + bad.out.length + "):\n  " + bad.out.slice(0, 40).join("\n  "));
  ok(page.errors.length === 0, "no page errors (" + page.errors.join("; ") + ")");
  if (SHOTS) for (const kind of KINDS) {
    await page.evaluate(() => document.querySelectorAll(".cd-layer").forEach((x) => { if (x.style.zIndex === "99") x.remove(); }));
    const r = await drawAll(page, kind);
    await page.setViewportSize({ width: 1920, height: Math.max(400, r.height) });
    await page.screenshot({ path: path.join(SHOTS, kind + ".png") });
  }
  await page.close();
}

// 2. on a TV, against the pretend Home Assistant
{ // Control Centre: fills from Home Assistant; OK opens every switch; a switch reaches it; a garage door never shows
  const page = await home([["controls", 0, 0, 8, 4], ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], "&ha=1");
  await page.waitForFunction(() => /Lounge/.test(document.querySelector('.cw-o[data-obj="w0"] .cw').textContent), null, { timeout: 8000 });
  ok(/On 80%/.test(await text(page)), "controls: the lounge light reads On 80%");
  await openOn(page);
  ok((await cur(page)).name === "controls", "controls: OK opens Control Centre");
  await page.waitForFunction(() => document.querySelectorAll(".cwd-toggle").length >= 5, null, { timeout: 5000 });
  const names = await page.evaluate(() => [...document.querySelectorAll(".cwd-toggle")].map((e) => e.textContent));
  ok(names.length === 5 && !names.some((t) => /Garage|Big roller/.test(t)), "controls: a garage door never shows, by its name or by what Home Assistant calls it (owner's rule): " + names.join(" | "));
  ok(!/Garage|Big roller/.test(await text(page)), "controls: nor on the widget itself");
  ok((await cur(page)).focusName === "Lounge", "controls: lands on the first switch");
  await press(page, "Enter", 600);
  ok(await page.evaluate(() => window.MOCK_HA_LAST) === "set light.lounge off", "controls: OK switched the lounge light off through Home Assistant");
  await page.evaluate(() => { window.MOCK_HA_LAST = ""; });
  const names2 = [];
  for (let k = 0; k < 12; k++) { names2.push((await cur(page)).focusName); await press(page, k < 6 ? "ArrowRight" : "ArrowDown", 150); }
  ok(!names2.some((n) => /Garage|Big roller/.test(n || "")), "controls: the remote never reaches a garage door: " + names2.join(","));
  ok(await page.evaluate(() => window.MOCK_HA_LAST) === "", "controls: the garage door was never asked to open");
  const asked = await page.evaluate(() => window.smartHome.request("set", "cover.garage", "open"));
  ok(asked && asked.ok === false && await page.evaluate(() => window.MOCK_HA_LAST) === "", "controls: asked anyway, it is refused");
  await press(page, "Escape", 600);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), "controls: Back closes it");
  ok(page.errors.length === 0, "controls: no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}
{ // camera: a still from Home Assistant, a new one every 2 seconds; the layer full screen
  const page = await home([["camera", 0, 0, 8, 4], ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], "&ha=1");
  const bg = () => page.evaluate(() => { const f = document.querySelector('.cw-o[data-obj="w0"] .cw .cw-fill'); return f ? f.style.backgroundImage : ""; });
  await page.waitForFunction(() => /data:image\/jpeg/.test((document.querySelector('.cw-o[data-obj="w0"] .cw .cw-fill') || {}).style?.backgroundImage || ""), null, { timeout: 8000 });
  const a = await bg();
  await page.waitForTimeout(2600);
  const b = await bg();
  ok(/^url\("data:image\/jpeg/.test(a) && a !== b, "camera: a still from Home Assistant, and a new one 2 seconds later");
  ok(/Backyard/.test(await text(page)) && !/Live/.test(await text(page)), "camera: named, and never called live");
  await openOn(page);
  ok((await cur(page)).name === "camera", "camera: OK opens the camera layer");
  ok((await cur(page)).stops === 2, "camera: Left and Right reach the other camera");
  await page.waitForTimeout(2600);
  ok(/data:image\/jpeg/.test(await page.evaluate(() => document.querySelector(".cwd-pimg").style.backgroundImage)), "camera: the layer shows a still");
  await press(page, "ArrowRight", 300); await press(page, "Enter", 2600);
  ok(/Driveway/.test(await page.evaluate(() => document.querySelector(".cwd-live").textContent)), "camera: Right and OK show the driveway");
  await press(page, "Escape", 600);
  ok(page.errors.length === 0, "camera: no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}
{ // doorbell, energy, sensor: the readings Home Assistant gave
  const page = await home([["doorbell", 0, 0, 4, 4], ["energy", 4, 0, 8, 4], ["sensor", 0, 4, 4, 4], ["speakers", 4, 4, 4, 4], ["app", 10, 6, 2, 2, { apps: ["com.netflix.ninja"] }]], "&ha=1");
  await page.waitForFunction(() => /18\.4/.test(document.querySelector('.cw-o[data-obj="w1"] .cw').textContent) && /26\.4/.test(document.querySelector('.cw-o[data-obj="w2"] .cw').textContent), null, { timeout: 8000 });
  ok(/Last ring today|Last ring yesterday/.test(await text(page, "w0")) && /Door now/.test(await text(page, "w0")), "doorbell: when it last rang, and the door now");
  ok(/kWh today/.test(await text(page, "w1")) && /2\.4/.test(await text(page, "w1")), "energy: today's total and the power now");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="w2"] .cw path'), null, { timeout: 8000 });
  ok(/24 hours/.test(await text(page, "w2")), "sensor: the reading and its last 24 hours");
  await page.waitForFunction(() => /Kitchen/.test(document.querySelector('.cw-o[data-obj="w3"] .cw').textContent), null, { timeout: 8000 });
  ok(/35%/.test(await text(page, "w3")), "speakers: the kitchen at 35%");
  ok(page.errors.length === 0, "doorbell, energy, sensor, speakers: no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}
{ // the speakers layer: louder twice reaches Home Assistant as one change, then play or pause
  const page = await home([["speakers", 0, 0, 4, 4], ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], "&ha=1");
  await page.waitForFunction(() => /Kitchen/.test(document.querySelector('.cw-o[data-obj="w0"] .cw').textContent), null, { timeout: 8000 });
  await openOn(page);
  ok((await cur(page)).name === "speakers", "speakers: OK opens the speakers");
  await page.waitForFunction(() => document.querySelectorAll(".cwd-round").length >= 3, null, { timeout: 5000 });
  ok((await cur(page)).focusName === "Kitchen louder", "speakers: lands on the first speaker's louder");
  await press(page, "Enter", 120); await press(page, "Enter", 1300);
  ok(await page.evaluate(() => window.MOCK_HA_LAST) === "volume media_player.kitchen 45", "speakers: two presses sent one volume, 45");
  await press(page, "ArrowRight", 300); await press(page, "Enter", 700);
  ok(await page.evaluate(() => window.MOCK_HA_LAST) === "playpause media_player.kitchen", "speakers: play or pause reached Home Assistant");
  await press(page, "Escape", 600);
  ok(page.errors.length === 0, "speakers: no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}
for (const [kind, layer, size] of [["energy", "energy", [8, 4]], ["sensor", "sensor", [4, 4]], ["doorbell", "camera", [4, 4]]]) {
  const page = await home([[kind, 0, 0, size[0], size[1]], ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], "&ha=1");
  await page.waitForTimeout(1500);
  await openOn(page);
  ok((await cur(page) || {}).name === layer, kind + ": OK opens " + layer);
  ok(await page.evaluate(() => { const p = document.querySelector(".cwd-panel").getBoundingClientRect(); return p.width >= 1700 && p.height >= 900; }), kind + ": the layer fills the screen");
  await page.waitForTimeout(1500);
  const words = await page.evaluate(() => document.querySelector(".cwd-panel").textContent);
  ok(kind === "energy" ? /18\.4/.test(words) && /kWh today/.test(words) : kind === "sensor" ? /26\.4/.test(words) && /Last 24 hours/.test(words) : /Last ring/.test(words), kind + ": the layer shows the reading (" + words.slice(0, 80) + ")");
  await press(page, "Escape", 600);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), kind + ": Back closes it");
  ok(page.errors.length === 0, kind + ": no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}
{ // Up next: the Spotify queue through the pretend bridge; not connected: the setup card
  let page = await home([["queue", 0, 0, 4, 6], ["app", 10, 0, 2, 2, { apps: ["com.netflix.ninja"] }]], "&queue=1");
  await page.waitForFunction(() => /Low Tide/.test(document.querySelector('.cw-o[data-obj="w0"] .cw').textContent), null, { timeout: 9000 });
  ok(/Fog Lights/.test(await text(page)), "queue: the next songs from Spotify");
  await openOn(page);
  ok((await cur(page)).name === "queue", "queue: OK opens Up next");
  await press(page, "Escape", 600);
  await page.close();
  page = await home([["queue", 0, 0, 4, 6]], "");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="w0"] .cw').getAttribute("data-setup"), null, { timeout: 9000 });
  // (0.13.10) the setup face: its line says what it shows, then how to set it up (no phone page here)
  ok(/Your Spotify queue/.test(await text(page)) && /Press OK to set it up|Set up on your phone/.test(await text(page)), "queue: not connected says what it is and how to set it up: " + await text(page));
  await page.close();
}
{ // no Home Assistant on this TV: every smart home widget is its setup card, and nothing is asked
  const page = await home([["controls", 0, 0, 4, 4], ["camera", 4, 0, 4, 4], ["doorbell", 8, 0, 4, 4], ["energy", 12, 0, 4, 4], ["sensor", 0, 4, 4, 4], ["speakers", 4, 4, 4, 4]], "");
  await page.waitForTimeout(1500);
  const cards = await page.evaluate(() => [...document.querySelectorAll(".cw-o .cw")].map((c) => c.getAttribute("data-setup") + ":" + c.textContent));
  // (0.13.10) each is its setup face: its name, its line, and how to set it up
  ok(cards.length === 6 && cards.every((c) => /^[a-z]+:/.test(c) && !/^null:/.test(c) && /Press OK to set it up|Set up on your phone/.test(c)), "no Home Assistant: six setup cards (" + cards.join(" | ") + ")");
  await page.close();
}

// 3. a design names entities only; the designer's demo never asks Home Assistant
{
  const page = await home([["clock", 0, 0, 2, 2]], "&ha=1");
  const r = await page.evaluate(() => {
    const W = (kind, opts) => ({ v: 1, objects: [{ id: "a", type: "widget", kind, x: 80, y: 60, w: 360, h: 360, opts }] });
    const opts = (kind, o) => ((window.CouchDesign.check(W(kind, o)).clean.objects || [])[0] || {}).opts || {};
    return {
      controls: opts("controls", { switches: ["light.lounge", "lock.front_door", "alarm_control_panel.home", "cover.blinds", "light.x;alert(1)"], state: "on", level: 80 }),
      camera: opts("camera", { cam: "http://192.0.2.1/cam.jpg", label: "Yard" }),
      camera2: opts("camera", { cam: "camera.backyard" }),
      sensor: opts("sensor", { reading: "sensor.pool", value: "26.4", unit: "°C" }),
      speakers: opts("speakers", { players: ["media_player.kitchen", "media_player.<b>"], volume: 50 }),
      aircon: opts("aircon", { entity: "camera.backyard" })
    };
  });
  ok(JSON.stringify(r.controls) === '{"switches":["light.lounge","cover.blinds"]}', "design: controls keep light and blind ids only (" + JSON.stringify(r.controls) + ")");
  ok(JSON.stringify(r.camera) === '{"label":"Yard"}' && r.camera2.cam === "camera.backyard", "design: a camera is a camera.* id, never an address");
  ok(JSON.stringify(r.sensor) === '{"reading":"sensor.pool"}', "design: a sensor carries its id, never a reading");
  ok(JSON.stringify(r.speakers) === '{"players":["media_player.kitchen"]}', "design: speakers carry ids, never a volume");
  ok(!r.aircon.entity, "design: aircon still takes only a climate id");
  // the designer's demo: a spy on the launcher sees no question
  const asked = await page.evaluate(async () => {
    let calls = 0; const real = window.TVHA.request; window.TVHA.request = function () { calls++; return real.apply(this, arguments); };
    const host = document.createElement("div"); document.body.appendChild(host);   // (not a design layer: the TV's own reader only looks there)
    ["controls", "camera", "doorbell", "energy", "sensor", "speakers", "queue"].forEach((kind) => host.appendChild(window.CouchWidgets.render({ id: "d", kind, w: 760, h: 360 }, { demo: true, designer: true })));
    await new Promise((r) => setTimeout(r, 2500));
    const before = calls;
    host.remove();
    window.TVHA.request = real;
    return before;
  });
  ok(asked === 0, "designer demo: Home Assistant was never asked (" + asked + ")");
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
