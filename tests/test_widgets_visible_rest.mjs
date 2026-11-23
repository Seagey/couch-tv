// Every widget, by what a person can SEE: the kinds no group's visible test draws (the smart home kinds,
// the sun clock, Bin night, and the Smart stack, whose sizes list is empty so no group test draws it; 12
// kinds). The same method as test_ws2_weather_visible.mjs and the others:
// every size the kind lists (tools/tv-designer/app/grid.js: a half cell is 100 px with a 40 px gap, so
// tile 160x160, wtile 360x160, small 360x360, tall 360x560, medium 760x360, wide 1160x360, large 760x760),
// every setting value against the default (or the case named), at 10:00 and at 19:30. Each element's words
// are measured character by character, inside its own box and the widget's, before any "...". Checks:
//  - no words cut anywhere (a room, a switch, a sensor's name, a bin);
//  - every setting changes what shows (its words, pictures, colours or the camera it shows), except the
//    cases in SAME, each with its reason;
//  - a value that is the default here draws the same;
//  - no empty card with Home Assistant answering, no page error;
//  - with nothing set up (no Home Assistant, no paired remotes, no town, no bin night) a real TV never shows
//    the demo readings Couch TV Studio's preview uses: it shows its setup card.
// Home Assistant is the stand in shape smarthome.js hands the widgets (as test_ws2_smarthome.mjs uses).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_widgets_visible_rest.mjs
// WS2_SOFT=1 lists every failure at the end; WS2_VISIBLE_LOG=<file> writes every case drawn;
// WS2_VISIBLE_JSON=<file> writes the per kind counts the all widgets runner reads.
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
const soft = [];
const ok = (c, m) => { if (process.env.WS2_SOFT && !c) { soft.push(m); return; } assert.ok(c, m); n++; };
// the cases where a setting draws the same at a size, and why ("kind size label")
// Only where the setting's help says so, or where the value shows what the default already shows. Every
// other same drawing is a fault (listed in coord/WIDGETS-69-TABLE.md with its fix), and fails here.
const SAME = {
  "aircon tile others off": "the other rooms show in a big widget (its help says so); a tile is one room",
  "aircon wtile others off": "the other rooms show in a big widget (its help says so); a wide tile is one room",
  "aircon small others off": "the other rooms show in a big widget (its help says so); a small widget is one room and its dial",
  "aircon tall others off": "the other rooms show in a big widget (its help says so); a tall widget is one room and its dial",
  "doorbell tile picture off": "a tile has no picture: it shows only when the doorbell last rang, which is what off shows",
  "energy tile now off": "power now shows in a big widget (its help says so); a tile shows today's total",
  "energy wtile now off": "power now shows in a big widget (its help says so); a wide tile shows today's total and the hours",
  "energy small now off": "power now shows in a big widget (its help says so); a small widget is too narrow for two numbers",
  "battery tile low 50": "the remote at 12% is under 20 and under 50, so it is red either way",
  "battery wtile low 50": "the remote at 12% is under 20 and under 50, so it says Charge it soon either way",
  "speakers wtile players kitchen": "a wide tile shows the speaker that is playing, and the kitchen is the one playing",
  "scenes tile scenes lights off": "a tile shows how many scenes are picked, one either way",
  "bins tile bin_a Paper": "a tile shows only the lid colours (its help says so)",
  "bins tile bin_b Food": "a tile shows only the lid colours (its help says so)"
};
const NSAME = 14;   // how many cases SAME names (pinned, so a new one is a decision)
const KINDS = ["aircon", "controls", "camera", "doorbell", "sensor", "energy", "solar", "battery", "speakers", "scenes", "bins", "stack"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widget-words.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/tv-home/web/probe.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const lines = [];
const cases = { all: 0, same: 0 }, usedSame = {}, perKind = {};
const K = (k) => perKind[k] || (perKind[k] = { cases: 0, changed: 0, same: 0, sameReasons: 0, cut: 0, empty: 0, fail: 0, demo: "", sizes: [] });
try {
  // the Smart stack on its own pass: four widgets that need nothing set up (Quote, Word of the day, Moon,
  // Time in words), at a time near 22:30 where Next widget every 10, 30 and 60 seconds each show another
  // widget than every 20 (widgets.js dayIndex), and By the time of day shows the Moon (a night widget)
  // where every 20 seconds shows another, found, not guessed
  const STACK_N = 4, idx = (T, s) => Math.floor(T / (s * 1000)) % STACK_N;
  const night = new Date(); night.setHours(22, 30, 0, 0);
  let stackAt = null;
  for (let sec = 0; sec < 3600 && !stackAt; sec += 10) {
    const T = night.getTime() + sec * 1000, i20 = idx(T, 20);
    if ([10, 30, 60].every((s) => idx(T, s) !== i20) && i20 !== 2) stackAt = new Date(T);
  }
  ok(!!stackAt, "a time near 22:30 where each Next widget value shows another widget: " + stackAt);
  for (const [hh, mm, onlyStack] of [[10, 0, false], [19, 30, false], [stackAt.getHours(), stackAt.getMinutes(), true]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    // Android's paired remotes and their charge (Batteries.kt through window.TVOS)
    await page.addInitScript(() => {
      window.TVOS = { batteries: () => JSON.stringify({ need: "", devices: [{ kind: "controller", name: "Pad 1", level: 72 }, { kind: "remote", name: "Remote", level: 12 }, { kind: "headphones", name: "Headset", level: 45 }] }) };
    });
    const at = onlyStack ? stackAt : new Date(new Date().setHours(hh, mm, 0, 0));
    await page.clock.setFixedTime(at);
    await page.goto(ORIGIN + "/tv-home/web/probe.html");
    await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps);
    const out = await page.evaluate(async (onlyStack) => {
      const HOME = { name: "Hillside", lat: -33.6, lon: 151.1 };
      const TOKYO = { name: "Tokyo", lat: 35.68, lon: 139.69, timezone: "Asia/Tokyo" };
      const PERTH = { name: "Perth", lat: -31.95, lon: 115.86, timezone: "Australia/Perth" };
      const ROOMS = [
        { entity: "climate.living_room", name: "Living room", ok: true, state: "cool", action: "cooling", current: 24.5, target: 22, min: 16, max: 30, step: 0.5, modes: ["off", "cool"], unit: "°C" },
        { entity: "climate.bedroom", name: "Bedroom", ok: true, state: "heat", action: "heating", current: 19, target: 21, min: 16, max: 30, step: 0.5, modes: ["off", "heat"], unit: "°C" },
        { entity: "climate.study", name: "Study", ok: true, state: "off", action: "off", current: 23, target: 23, min: 16, max: 30, step: 0.5, modes: ["off", "cool"], unit: "°C" }];
      const hist = (a, b) => ({ points: Array.from({ length: 24 }, (_, i) => Math.round((a + (b - a) * Math.sin(i / 23 * Math.PI)) * 10) / 10) });
      const HA = {
        info: { controls: [1], cameras: [{ entity: "camera.backyard", name: "Backyard" }, { entity: "camera.driveway", name: "Driveway" }],
          sensors: [{ entity: "sensor.pool", name: "Pool" }, { entity: "sensor.rain_today", name: "Rain gauge" }], speakers: [1], energy: true, doorbell: true, doorbell_camera: true },
        controls: [{ entity: "light.lounge", name: "Lounge", ok: true, kind: "light", on: true }, { entity: "light.lamp", name: "Lamp", ok: true, kind: "light", on: false },
          { entity: "switch.outdoor_lights", name: "Outdoor lights", ok: true, kind: "switch", on: false }, { entity: "switch.wall_clock", name: "Wall clock", ok: true, kind: "switch", on: true }],
        sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, value: "26.4", num: 26.4, unit: "°C", cls: "temperature" }, { entity: "sensor.rain_today", name: "Rain gauge", ok: true, value: "12", num: 12, unit: "mm", cls: "precipitation" }],
        hist: { "sensor.pool": hist(24, 27), "sensor.rain_today": hist(0, 12) },
        energy: { ok: true, name: "Solar", total: 18.4, power: 2.4, power_unit: "kW", hours: [0, 0, 0, 0, 0, 0, 0.2, 0.9, 1.8, 2.6, 3.1, 3.2] },
        speakers: [{ entity: "media_player.kitchen", name: "Kitchen", ok: true, state: "playing", volume: 35, title: "Riptide", artist: "Vance Joy" }, { entity: "media_player.deck", name: "Deck", ok: true, state: "idle", volume: 20 }],
        bell: { ok: true, name: "Front door", at: Date.now() - 3600000, ringing: false, camera: true, kept: false },
        stills: { "camera.backyard": "backgrounds/scene-golden.jpg", "camera.driveway": "backgrounds/scene-night.jpg", doorbell: "backgrounds/scene-golden.jpg" }
      };
      const SCENES = [{ entity: "scene.movie_night", name: "Movie night" }, { entity: "scene.lights_off", name: "Lights off" }, { entity: "script.good_morning", name: "Good morning" }];
      const PX = { tile: [160, 160], wtile: [360, 160], small: [360, 360], tall: [360, 560], medium: [760, 360], wide: [1160, 360], large: [760, 760], xl: [1160, 760], line: [360, 60], wline: [760, 60], hero: [1760, 660], full: [1760, 960] };
      const C = window.CouchWidgetCaps;
      const STACK_ITEMS = [{ kind: "quote" }, { kind: "word" }, { kind: "moon" }, { kind: "wordclock" }];
      const envOf = (set, none) => none ? { data: { wset: { x: set || {} } } } : { rooms: ROOMS, data: { ha: HA, scenes: SCENES, place: HOME, country: "AU", unit: "c", wset: { x: set || {} } } };
      async function draw(kind, w, h, set, opts, none) {
        document.querySelectorAll(".ws-host").forEach((x) => x.remove());
        const host = document.createElement("div");
        host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
        document.body.appendChild(host);
        const root = window.CouchWidgets.render(Object.assign({ id: "x", kind, opts: opts || {}, w, h }, kind === "stack" ? { items: STACK_ITEMS } : {}), envOf(set, none));
        host.appendChild(root);
        // the words are fitted once the widget is on screen (widgets.js fitLater): measure after that
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, root.hasAttribute("data-fits") ? 40 : 0)));
        const R = root.getBoundingClientRect(), leaves = [];
        [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
          if (el.closest("svg")) return;
          const nodes = [...el.childNodes].filter((nd) => nd.nodeType === 3 && nd.textContent.trim());
          if (!nodes.length) return;
          const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0 || E.width === 0) return;
          const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const ell = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
          const cut = ell ? 18 : 0;
          let t = "", vis = 0, gone = false;
          for (const nd of nodes) for (let i = 0; i < nd.textContent.length; i++) {
            t += nd.textContent[i];
            const rg = document.createRange(); rg.setStart(nd, i); rg.setEnd(nd, i + 1);
            const r = rg.getBoundingClientRect();
            const inside = r.width === 0 || (r.left >= Math.max(E.left, R.left) - 1 && r.right <= Math.min(E.right - cut, R.right) + 1 && r.top >= R.top - 1 && r.bottom <= (clamp ? Math.min(E.bottom, R.bottom) : R.bottom) + 1);
            if (!inside) gone = true;
            if (!gone) vis++;
          }
          leaves.push({ t: t.replace(/\s+/g, " ").trim(), seen: t.slice(0, vis).replace(/\s+/g, " ").trim(), col: cs.color, fit: !gone && !ell && !(clamp && el.scrollHeight > el.clientHeight + 1) });
        });
        const inBox = (el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).visibility !== "hidden" && r.width > 0 && r.height > 0 && r.right > R.left && r.left < R.right && r.bottom > R.top && r.top < R.bottom; };
        // the pictures drawn: every svg's own drawing (colours included), every photo, every coloured box
        const svgs = [...root.querySelectorAll("svg")].filter(inBox).map((s) => s.innerHTML.replace(/ id="[^"]*"/g, "").replace(/url\(#[^)]*\)/g, "").replace(/href="#[^"]*"/g, ""));
        const bgs = [...root.querySelectorAll("*")].filter((e) => e.style && /url\(/.test(e.style.backgroundImage || "") && inBox(e)).map((e) => (e.style.backgroundImage.match(/[^/"]+\.(jpg|png|webp|svg)/) || [""])[0]);
        const look = [...root.querySelectorAll("*")].filter((e) => !e.closest("svg") && inBox(e) && e.style && (e.style.backgroundColor || e.style.background)).map((e) => getComputedStyle(e).backgroundColor);
        const svgsOut = [...root.querySelectorAll("svg")].filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && (r.right > R.right + 1 || r.bottom > R.bottom + 1 || r.left < R.left - 1 || r.top < R.top - 1); }).length;
        return { empty: root.getAttribute("data-empty") === "1", text: root.textContent.replace(/\s+/g, " ").trim(),
          seen: leaves.map((l) => l.seen).join(" | "), cut: leaves.filter((l) => !l.fit).map((l) => '"' + l.t + '" shows "' + l.seen + '"').concat(svgsOut ? [svgsOut + " picture(s) past the widget's edge"] : []),
          sig: leaves.map((l) => l.seen + "@" + l.col).join(" | ") + " || " + svgs.join(";") + " || " + bgs.join(";") + " || " + look.join(";") + " || " + (root.getAttribute("data-ha-cam") || "") };
      }
      // kind: [design opts, variants]; variant: [label, TV settings, expect same (the value is the default here), vs label, design opts]
      const V = {
        aircon: [{}, [["default", {}], ["entity bedroom", { entity: "climate.bedroom" }], ["entity study (off)", { entity: "climate.study" }], ["entity living room (same: the first room)", { entity: "climate.living_room" }, true],
          ["others off", { others: false }], ["others on (same)", { others: true }, true]]],
        controls: [{}, [["default", {}], ["switches lamp", { switches: ["light.lamp"] }], ["switches outdoor lights, wall clock", { switches: ["switch.outdoor_lights", "switch.wall_clock"] }],
          ["switches lamp vs outdoor lights", { switches: ["light.lamp"] }, false, "switches outdoor lights, wall clock"]]],
        camera: [{}, [["default", {}], ["cam driveway", { cam: "camera.driveway" }], ["cam backyard (same: the first camera)", { cam: "camera.backyard" }, true],
          ["label Carport (cam driveway)", { cam: "camera.driveway", label: "Carport" }, false, "cam driveway"], ["label Carport, no camera picked", { label: "Carport" }]]],
        doorbell: [{}, [["default", {}], ["label Side gate", { label: "Side gate" }], ["picture off", { picture: false }], ["picture on (same)", { picture: true }, true]]],
        sensor: [{}, [["default", {}], ["reading rain gauge", { reading: "sensor.rain_today" }], ["reading pool (same: the first sensor)", { reading: "sensor.pool" }, true],
          ["label Tank (reading rain gauge)", { reading: "sensor.rain_today", label: "Tank" }, false, "reading rain gauge"], ["label Tank, no sensor picked", { label: "Tank" }]]],
        energy: [{}, [["default", {}], ["label Panels", { label: "Panels" }], ["now off", { now: false }], ["now on (same)", { now: true }, true]]],
        solar: [{}, [["default", {}], ["town Tokyo", { town: TOKYO }], ["town Perth", { town: PERTH }], ["town Perth vs Tokyo", { town: PERTH }, false, "town Tokyo"]]],
        battery: [{}, [["default", {}], ["low 50", { low: 50 }], ["low 5", { low: 5 }], ["low 20 (same)", { low: 20 }, true]]],
        speakers: [{}, [["default", {}], ["players deck", { players: ["media_player.deck"] }], ["players kitchen", { players: ["media_player.kitchen"] }], ["players deck vs kitchen", { players: ["media_player.deck"] }, false, "players kitchen"]]],
        scenes: [{}, [["default", {}], ["scenes lights off, good morning", { scenes: ["scene.lights_off", "script.good_morning"] }], ["scenes movie night", { scenes: ["scene.movie_night"] }],
          ["scenes lights off", { scenes: ["scene.lights_off"] }, false, "scenes movie night"]]],
        // a Bin night widget whose design says Tuesday (a design with no night is its setup card, checked below)
        bins: [{ weekday: 2 }, [["default", {}], ["weekday Friday", { weekday: 5 }], ["weekday Tuesday (same as the design)", { weekday: 2 }, true], ["alt on", { alt: true }],
          ["thisweek b (alt on)", { alt: true, thisweek: "b" }, false, "alt on"], ["bin_a Paper", { bin_a: "Paper" }], ["bin_b Food", { bin_b: "Food" }],
          ["lid_a blue", { lid_a: "#0a84ff" }], ["lid_b brown", { lid_b: "#a2845e" }], ["lid_a yellow (same)", { lid_a: "#ffd60a" }, true]]]
      };
      // Which bin goes out this week also sets the count the widget keeps (app.js wsSets): the day before
      // the coming bin night, in whole days, one week less for the second bin
      const anchorFor = (wd, v) => { const d = new Date(), night = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (wd - d.getDay() + 7) % 7); return Math.round(Date.UTC(night.getFullYear(), night.getMonth(), night.getDate()) / 86400000) - 1 - (v === "b" ? 7 : 0); };
      V.bins[1].splice(4, 1, ["thisweek a (alt on)", { alt: true, thisweek: "a", anchor: anchorFor(2, "a") }], ["thisweek b (alt on)", { alt: true, thisweek: "b", anchor: anchorFor(2, "b") }, false, "thisweek a (alt on)"]);
      // a stack is the size of the widgets in it (its sizes list is empty): the two sizes these four share
      V.stack = [{}, [["default", {}], ["turn 10", { turn: 10 }], ["turn 30", { turn: 30 }], ["turn 60", { turn: 60 }], ["turn 0 (by time of day)", { turn: 0 }], ["turn 20 (same)", { turn: 20 }, true]]];
      const res = [];
      for (const kind of Object.keys(V).filter((k) => (k === "stack") === onlyStack)) {
        const cap = kind === "stack" ? { s: ["wtile", "small"] } : C.get(kind).sizes, listed = (cap.s || []).concat((cap.x || []).map((x) => x[0]));
        const missing = listed.filter((s) => !PX[s]);
        if (missing.length) res.push({ kind, s: "?", label: "sizes not drawn: " + missing.join(","), missing: true });
        const [o, vars] = V[kind];
        for (const s of listed.filter((x) => PX[x])) {
          const [w, h] = PX[s], got = {};
          for (const [label, set, expSame, vs] of vars) {
            const d = await draw(kind, w, h, set, o);
            got[label] = d;
            const ref = got[vs || "default"];
            res.push({ kind, s, w, h, label, vs: vs || "default", same: label !== "default" && d.sig === ref.sig, expSame: !!expSame, empty: d.empty, cut: d.cut, seen: d.seen });
          }
        }
      }
      // nothing set up on this TV: the setup card, never Studio's demo readings
      const demo = {};
      if (onlyStack) return { res, demo };
      const DEMO_WORDS = ["Lounge", "Kitchen", "Blinds", "Ceiling fan", "Heater", "Fairy lights", "Porch", "Backyard", "Pool", "26.4", "18.4", "Low Tide", "Saltwater", "Front door", "Main bed", "Bed 2",
        "Movie night", "Goodnight", "Party", "Dinner", "Pad 1", "Pad 2", "Headset"];
      const T = window.TVOS;
      delete window.TVOS;
      for (const kind of Object.keys(V)) {
        const s = C.get(kind).sizes.s.filter((x) => PX[x])[1] || C.get(kind).sizes.s[0] || "wtile", [w, h] = PX[s];
        const d = await draw(kind, w, h, {}, {}, true);
        const hits = DEMO_WORDS.filter((x) => d.text.indexOf(x) >= 0);
        demo[kind] = { s, empty: d.empty, text: d.text.slice(0, 160), hits };
      }
      window.TVOS = T;
      return { res, demo };
    }, onlyStack);
    lines.push("==== clock " + hh + ":" + pad(mm) + (errs.length ? " PAGEERRORS " + errs.join(" / ") : ""));
    ok(!errs.length, "no page errors at " + hh + ":" + pad(mm) + ": " + errs.join(" / "));
    for (const r of out.res) {
      if (r.missing) { ok(false, r.kind + ": " + r.label); K(r.kind).fail++; continue; }
      const at = r.kind + " " + r.s + " (" + r.w + " x " + r.h + ") " + r.label + " at " + hh + ":" + pad(mm);
      const k = K(r.kind);
      if (k.sizes.indexOf(r.s) < 0) k.sizes.push(r.s);
      cases.all++; k.cases++;
      const c1 = !r.empty, c2 = !r.cut.length;
      ok(c1, at + ": draws, not an empty card");
      ok(c2, at + ": no words cut: " + r.cut.join("; "));
      if (!c1) k.empty++;
      if (!c2) k.cut++;
      let c3 = true;
      const flag = r.label === "default" ? "" : r.same && !r.expSame ? "SAME(vs " + r.vs + ")" : !r.same && r.expSame ? "CHANGED(expected same)" : "";
      lines.push([r.kind, r.s + " " + r.w + "x" + r.h, r.label, flag, r.empty ? "EMPTY" : "", r.cut.length ? "CUT[" + r.cut.join("; ") + "]" : "", "=> " + r.seen.slice(0, 200)].filter(Boolean).join(" ; "));
      if (r.label !== "default") {
        const key = r.kind + " " + r.s + " " + r.label, why = SAME[key];
        if (r.expSame || why) { c3 = r.same; ok(r.same, at + ": draws the same as " + r.vs + (why ? " (" + why + ")" : " (that value is the default here)") + ": " + r.seen); cases.same++; k.same++; if (why) { usedSame[key] = 1; k.sameReasons++; } }
        else { c3 = !r.same; ok(!r.same, at + ": changes what shows against " + r.vs + ": " + r.seen); if (!r.same) k.changed++; }
      }
      if (!c1 || !c2 || !c3) k.fail++;
    }
    for (const kind of Object.keys(out.demo)) {
      const d = out.demo[kind], good = !d.hits.length;
      ok(good, kind + " " + d.s + " with nothing set up at " + hh + ":" + pad(mm) + ": no demo readings (" + d.hits.join(", ") + "): " + d.text);
      K(kind).demo = good ? (K(kind).demo || "none") : "SHOWS " + d.hits.join(", ");
      if (!good) K(kind).fail++;
      lines.push([kind, d.s, "nothing set up", d.empty ? "setup card" : "", d.hits.length ? "DEMO[" + d.hits.join(",") + "]" : "", "=> " + d.text].filter(Boolean).join(" ; "));
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  if (process.env.WS2_VISIBLE_LOG) fs.writeFileSync(process.env.WS2_VISIBLE_LOG, lines.join("\n"));
}
// every reason in SAME is a real case (none left over from an older layout)
Object.keys(SAME).forEach((k) => ok(usedSame[k], "SAME names a real case: " + k));
ok(Object.keys(SAME).length === NSAME, NSAME + " setting x size cases draw the same, each with its reason");
ok(KINDS.every((k) => perKind[k] && perKind[k].cases), "all " + KINDS.length + " kinds drawn: " + Object.keys(perKind).join(", "));
if (process.env.WS2_VISIBLE_JSON) fs.writeFileSync(process.env.WS2_VISIBLE_JSON, JSON.stringify({ kinds: perKind, same: SAME, soft }, null, 1));
console.log("  " + cases.all + " kind x size x setting x time cases (" + Object.entries(perKind).map(([k, v]) => k + " " + v.cases).join(", ") + "), " + cases.same + " of them the same by design (" + Object.keys(SAME).length + " named in SAME)");
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
function pad(v) { return String(v).padStart(2, "0"); }
