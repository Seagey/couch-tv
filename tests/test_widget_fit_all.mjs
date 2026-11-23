// The fit and centring audit for every widget (seagey, 18 Nov 2026): "Make sure each widget fits in
// each container correctly things aren't cut off and all icons etc are default centre align unless
// it's changed in the designer."
//
// 1. Every widget kind in widget-caps.js, at every size it lists (its named sizes, its extra sizes and
//    its smallest), drawn on a 1920x1080 TV in each of these states:
//      designer  Couch TV Studio's demo
//      tv        a TV with real data for every widget
//      long      the same with very long names, titles and numbers
//      hindi     the same in Hindi
//      unset     a TV with nothing set up and nothing connected
//      left, right  real data with opts.align, for the kinds whose options keep align
//    and each one checked for:
//      - nothing past the widget's box;
//      - no words cut off: every line's ink (the glyphs' real top and bottom, not only the line box)
//        inside every box that clips it, unless that box ends its words in "..." (one line) or
//        clamps them to whole lines; and big digits filled with a picture (background-clip: text)
//        inside their own box, where the picture is painted;
//      - words at 23 px or more;
//      - the words, icons and marks, taken together, in the middle of the box across and up and
//        down, unless the design sets opts.align (then against that side);
//      - drawn the same in a design layer scaled to half (Couch TV Studio's preview, a smaller TV).
// 2. The clocks outside the widget grid: a design's free clock (type "clock") at every size the
//    designer gives it, with and without its date, 12 and 24 hour; and the classic home's glass clock
//    in every scene: its digits never cut at the bottom (or anywhere).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_widget_fit_all.mjs
// FIT_LIST=1 prints every failure, not only the first 60.
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
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const FIX = path.join(ROOT, "tests/fixtures/widgets-data");
const fixtures = {};
for (const f of ["rss-abc-top.xml", "yahoo-spark.json", "espn-nba.json", "osrm-route.json"]) fixtures[f] = fs.existsSync(path.join(FIX, f)) ? fs.readFileSync(path.join(FIX, f), "utf8") : null;

const browser = await chromium.launch();
async function home(objects, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, objects };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => document.querySelector(".cd-layer") && window.CouchWidgets && window.CouchWidgetCaps);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return page;
}

console.log("Running the widget fit and centring audit...");

// the checks, run in the page on one drawn box (shared by parts 1 and 2)
const CHECKS = String(function (root, tag, mode) {
  const out = [];
  const b = root.getBoundingClientRect();
  const rcs = getComputedStyle(root);
  const canvas = window.__fitCanvas || (window.__fitCanvas = document.createElement("canvas").getContext("2d"));
  const nm = (el) => (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : el.tagName.toLowerCase());
  const said = new Set();
  const say = (m) => { if (!said.has(m)) { said.add(m); out.push(tag + ": " + m); } };
  const shown = (el) => { for (let p = el; p && p !== root.parentElement; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false; } return true; };
  // (no scrollWidth check: a line's box can run past while its glyphs do not; the ink check below decides)
  // the clip boxes between a node and the widget (the widget's own box always counts)
  const clipsOf = (el) => {
    const list = [];
    for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
      const s = getComputedStyle(p), r = p.getBoundingClientRect();
      const cx = s.overflowX !== "visible", cy = s.overflowY !== "visible";
      // a box clamped to whole lines (and not also cut to a set height) shows each line whole or not at all
      const clamp = s.webkitLineClamp && s.webkitLineClamp !== "none" && !p.style.height && !p.style.maxHeight;
      if (cx || cy) list.push({ el: p, r, cx, cy, ell: s.textOverflow === "ellipsis", clamp });
      if (p === root && !(cx || cy)) list.push({ el: p, r, cx: true, cy: true, ell: false, clamp: false, box: true });
    }
    return list;
  };
  const u = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  const addU = (q) => { if (!(q.right - q.left >= 1 && q.bottom - q.top >= 1)) return; u.l = Math.min(u.l, q.left); u.t = Math.min(u.t, q.top); u.r = Math.max(u.r, q.right); u.b = Math.max(u.b, q.bottom); };
  const skipCentre = (el) => el.closest(".cw-dots, .cw-hdots, .cw-fill, .cw-layer, .cw-bg") && !el.closest(".cw-fill > .cw-col, .cw-fill .cw-ahcol");
  root.querySelectorAll("*").forEach((node) => {
    if (node.classList.contains("cw-bg") || (node.closest("svg") && node.tagName.toLowerCase() !== "svg")) return;
    if (!shown(node)) return;
    const cs = getComputedStyle(node), r = node.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const name = nm(node);
    // 1. nothing past the box
    if (r.right > b.right + 2 || r.bottom > b.bottom + 2 || r.left < b.left - 2 || r.top < b.top - 2) {
      if (!node.classList.contains("cw-fill") && !node.classList.contains("cw-layer")) say(name + " past the box (" + Math.round(r.left - b.left) + "," + Math.round(r.top - b.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " in " + Math.round(b.width) + "x" + Math.round(b.height) + ")");
    }
    const texts = [].filter.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim());
    // words drawn in no colour (an app's name under its own icon) are not seen, unless a picture fills them
    const unseen = /^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(cs.color) && !(/text/.test(cs.webkitBackgroundClip || cs.backgroundClip || "") && cs.backgroundImage !== "none");
    if (texts.length && !unseen) {
      // 2. words at 23 px or more
      const fs = parseFloat(cs.fontSize);
      if (fs > 0 && fs < 22.5) say("words at " + fs + " px (" + name + ": " + node.textContent.trim().slice(0, 24) + ")");
      // 3. every line's ink inside every box that clips it
      const clips = clipsOf(node.parentElement === null ? node : node);
      const bgText = /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || "") && cs.backgroundImage !== "none";
      canvas.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      try { canvas.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing; } catch (e) {}
      texts.forEach((t) => {
        const m = canvas.measureText(t.textContent.trim());
        const rg = document.createRange(); rg.selectNodeContents(t);
        [].forEach.call(rg.getClientRects(), (q) => {
          if (q.width < 1) return;
          let top = q.top, bot = q.bottom;
          // the glyphs' real top and bottom, from the line's box and the font's ascent (Latin digits and
          // letters: a Hindi line falls back to another font, so its line box stands for it)
          if (m.fontBoundingBoxAscent && Math.abs(q.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) < 3) {
            const base = q.top + m.fontBoundingBoxAscent;
            top = base - m.actualBoundingBoxAscent; bot = base + m.actualBoundingBoxDescent;
          } else { top = q.top + q.height * 0.12; bot = q.bottom - q.height * 0.12; }
          const ink = { left: q.left, right: q.right, top, bottom: bot };
          // a line clamped away entirely (below the clamp) is not shown: skip it
          for (const c of clips) {
            const outX = ink.left < c.r.left - 1.5 || ink.right > c.r.right + 1.5, outY = ink.top < c.r.top - 1.5 || ink.bottom > c.r.bottom + 1.5;
            if (c.clamp && ink.top >= c.r.bottom - 1) return;   // a hidden line past the clamp
            if (c.cy && outY && !c.clamp) {
              const by = Math.max(c.r.top - ink.top, ink.bottom - c.r.bottom);
              say((c.box ? "words past the box" : "words cut off " + (ink.bottom > c.r.bottom ? "at the bottom" : "at the top")) + " by " + Math.round(by) + " px (" + name + " in " + (c.el === root ? "the widget" : nm(c.el)) + ": " + t.textContent.trim().slice(0, 24) + ")");
            }
            if (c.cx && outX && !c.ell) {
              const by = Math.max(c.r.left - ink.left, ink.right - c.r.right);
              say((c.box ? "words past the box" : "words cut off at the side") + " by " + Math.round(by) + " px (" + name + " in " + (c.el === root ? "the widget" : nm(c.el)) + ": " + t.textContent.trim().slice(0, 24) + ")");
            }
            // what this box lets through is all the boxes further out can see (an ellipsis box shows its
            // words up to its own edge, then "...")
            if (c.cx) { ink.left = Math.max(ink.left, c.r.left); ink.right = Math.min(ink.right, c.r.right); }
            if (c.cy) { ink.top = Math.max(ink.top, c.r.top); ink.bottom = Math.min(ink.bottom, c.r.bottom); }
          }
          if (bgText) {
            const nr = node.getBoundingClientRect();
            if (ink.bottom > nr.bottom + 1.5 || ink.top < nr.top - 1.5) say("picture-filled digits cut off by " + Math.round(Math.max(ink.bottom - nr.bottom, nr.top - ink.top)) + " px (" + name + ": " + t.textContent.trim() + ")");
          }
          if (!skipCentre(node)) addU({ left: Math.max(ink.left, b.left), right: Math.min(ink.right, b.right), top: Math.max(ink.top, b.top), bottom: Math.min(ink.bottom, b.bottom) });
        });
      });
    }
    // icons and marks: an svg, a picture, a tick box, an event's colour bar, a bar, a chip, an app tile
    const tg = node.tagName.toLowerCase();
    // a picture that fills most of the box (a photo, a camera's still) is the content itself
    // a mark or a panel drawn in colour (a chart's bar, a dot, a row's panel) counts like an icon
    const bgc = cs.backgroundColor.match(/rgba?\(([^)]+)\)/), alpha = bgc ? (bgc[1].split(",")[3] === undefined ? 1 : parseFloat(bgc[1].split(",")[3])) : 0;
    if ((alpha >= 0.1 || /gradient\(/.test(cs.backgroundImage)) && r.width * r.height < b.width * b.height * 0.4 && !skipCentre(node)) addU(r);
    // (and a smaller one, a cover or a still beside its words, is part of what is centred)
    if (/url\(/.test(cs.backgroundImage) && (r.width * r.height >= b.width * b.height * 0.6 || !skipCentre(node))) addU(r);
    if (!skipCentre(node) && (tg === "svg" || tg === "img" || tg === "canvas" || node.matches(".bx, .cw-ev > i, .cw-bar, .cw-chip, .cw-app, .cw-ic, .cw-poster, .cw-mod"))) addU(r);
  });
  // 4. centred, or to the side the design picked
  const pad = { l: b.left + parseFloat(rcs.paddingLeft), r: b.right - parseFloat(rcs.paddingRight), t: b.top + parseFloat(rcs.paddingTop), b: b.bottom - parseFloat(rcs.paddingBottom) };
  let centred = 0;
  // a widget that is a picture (cw-photo: a cover, a photo, a camera) is centred by being the picture
  if (root.classList.contains("cw-photo")) addU(b);
  if (mode.centre !== false && isFinite(u.l) && pad.r - pad.l > 40) {
    const gl = u.l - pad.l, gr = pad.r - u.r, gt = u.t - pad.t, gb = pad.b - u.b;
    const tolX = Math.max(16, (pad.r - pad.l) * 0.06), tolY = Math.max(24, (pad.b - pad.t) * 0.1);
    if (mode.align === "left") { if (gl > tolX) say("opts.align left, yet " + Math.round(gl) + " px in from the left"); }
    else if (mode.align === "right") { if (gr > tolX) say("opts.align right, yet " + Math.round(gr) + " px in from the right"); }
    else {
      if (Math.abs(gl - gr) > tolX) say("not centred across (left " + Math.round(gl) + ", right " + Math.round(gr) + ")");
      if (Math.abs(gt - gb) > tolY) say("not centred up and down (top " + Math.round(gt) + ", bottom " + Math.round(gb) + ")");
    }
    centred = 1;
  }
  return { out, centred };
});

// 1. every widget, every size, every state
{
  const page = await home([{ id: "w0", type: "widget", kind: "clock", x: 80, y: 60, w: 360, h: 160 }]);
  const res = await page.evaluate(async ([CHECKS, F]) => {
    const check = eval("(" + CHECKS + ")");
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, WW = window.CouchWidgetWeb, A = window.CouchAtHome, CD = window.CouchDesign;
    const t0 = Date.now(), at = t0, iso = (h) => new Date(t0 + h * 3600000).toISOString().slice(0, 13) + ":00";
    const day0 = new Date(); const s0 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate()).getTime();
    const soon = (h, title) => ({ title, start: Math.max(t0 + 60000, s0 + h * 3600000), end: Math.max(t0 + 120000, s0 + h * 3600000 + 1800000), allDay: false });
    const LONG = "Supercalifragilisticexpialidocious";
    const LONGS = "A very long name that goes on and on and on for ever " + LONG;
    const pic = (() => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const g = c.getContext("2d"); g.fillStyle = "#3a6"; g.fillRect(0, 0, 64, 36); g.fillStyle = "#cde"; g.fillRect(0, 0, 64, 12); return c.toDataURL("image/jpeg"); })();
    const wifi = (ssid, pass) => ({ ssid, pass, sec: "WPA", qr: A && A.wifiQr ? A.wifiQr({ ssid, pass, sec: "WPA" }) : "WIFI:T:WPA;S:" + ssid + ";P:" + pass + ";;" });
    // the words each state uses
    const L = {
      tv: (s) => s,
      long: (s) => s + ", " + LONGS,
      hindi: (s) => ({ Living: "बैठक", Lounge: "बैठक का कमरा", Kitchen: "रसोई", Pool: "स्विमिंग पूल", Solar: "सौर ऊर्जा", "Front door": "मुख्य दरवाज़ा", Backyard: "पीछे का आँगन",
        Alex: "अमित", Sam: "सीमा", "Movie night": "फ़िल्म की रात", Deck: "बरामदा", Garage: "गैराज", Heater: "हीटर", Fan: "पंखा", "Solar today": "आज की सौर ऊर्जा" })[s] || "हिंदी में " + s
    };
    function data(k) {
      const T = L[k], long = k === "long", hindi = k === "hindi";
      const web = (() => {
        if (!WW || !F["rss-abc-top.xml"]) return {};
        const news = WW.parseRss(F["rss-abc-top.xml"], 12), games = WW.parseScores(JSON.parse(F["espn-nba.json"]), "nba"), quotes = WW.parseSpark(F["yahoo-spark.json"]), route = WW.parseRoute(JSON.parse(F["osrm-route.json"]));
        if (long || hindi) {
          news.forEach((x, i) => { x.title = hindi ? "भारत में आज भारी बारिश की चेतावनी, कई राज्यों में स्कूल बंद रहेंगे और यातायात प्रभावित " + i : x.title + " " + LONG + " " + LONG; });
          games.games.forEach((g) => g.teams.forEach((tm) => { tm.name = hindi ? "मुंबई इंडियंस" : "Wolverhampton Wanderers " + LONG; if (long) tm.score = "460/7 (105.5 ov, target 529)"; }));
          Object.keys(quotes.quotes).forEach((q) => { quotes.quotes[q].name = hindi ? "रिलायंस इंडस्ट्रीज" : LONG; if (long) quotes.quotes[q].price = 98765432.1; });
          if (long) { route.minutes = 1234; route.km = 12345.6; }
        }
        return { news: { abc: { ok: true, at, v: news } }, sports: { nrl: { ok: true, at, v: games } }, stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: quotes } }, commute: { K: { ok: true, at, v: route } } };
      })();
      const shows = [{ title: T("A show with a long name"), season: 3, episode: 2, progress: 0.5, app: { package: "com.netflix.ninja", name: "Netflix" } }, { title: T("Mystery Road"), season: 1, episode: 4, progress: 0.2, app: { package: "au.net.abc.iview", name: "ABC iview" } }];
      const ha = {
        info: { controls: [{ entity: "light.a", name: "x" }], cameras: [{ entity: "camera.yard", name: T("Backyard") }], sensors: [{ entity: "sensor.pool", name: T("Pool") }], speakers: [{ entity: "media_player.k", name: T("Kitchen") }], energy: true, doorbell: true, doorbell_camera: true },
        controls: [{ entity: "light.a", name: T("Lounge"), ok: true, kind: "light", on: true, level: 60 }, { entity: "cover.g", name: T("Garage"), ok: true, kind: "cover", on: false, blocked: true },
          { entity: "switch.h", name: T("Heater"), ok: false, kind: "switch" }, { entity: "fan.f", name: T("Fan"), ok: true, kind: "fan", on: false }],
        sensors: [{ entity: "sensor.pool", name: T("Pool"), ok: true, value: long ? "123456.7" : "26.4", num: long ? 123456.7 : 26.4, unit: long ? "kWh" : "°C", cls: "temperature" }],
        hist: { "sensor.pool": { points: Array.from({ length: 24 }, (_, i) => (long ? 120000 : 24) + Math.sin(i / 3) * (long ? 3000 : 1)) } },
        energy: { ok: true, name: T("Solar"), total: long ? 12345.67 : 12.34, battery: long ? 100 : 77, power: long ? 1234.5 : 1.2, power_unit: "kW", hours: Array.from({ length: 24 }, (_, i) => i < 15 ? Math.max(0, 3 - Math.abs(12 - i) / 2) : null) },
        speakers: [{ entity: "media_player.k", name: T("Kitchen"), ok: true, state: "playing", volume: 100, title: T("A song"), artist: T("A band") }, { entity: "media_player.d", name: T("Deck"), ok: false }],
        bell: { ok: true, name: T("Front door"), at: t0 - 3 * 3600000, ringing: false, camera: true, kept: false },
        stills: { "camera.yard": pic, doorbell: pic } };
      const queue = { ok: true, items: [{ title: T("Low Tide"), artist: T("Saltwater Radio"), art: null }, { title: "Fog Lights", artist: "Northern Rivers Club", art: null }, { title: "Golden Hour Drive", artist: "The Weekend Shifts", art: null }] };
      const homeData = {
        memory: { photos: 3, dated: 2, today: [{ src: "demo/beach.jpg", years: 3 }] }, goal: long ? 30 : 120,
        note: { text: hindi ? "आज रात का खाना छह बजे है। मैक्स को खाना खिलाना मत भूलना!" : long ? "Dinner at 6 tonight, then bath and bed by 7:30 with no arguments please, and remember the library books are due back on Thursday morning before school. " + LONG : "Dinner at 6. Feed Max!", from: T("Mum") },
        lists: [{ name: T("Shopping"), items: Array.from({ length: long ? 40 : 3 }, (_, i) => ({ t: hindi ? "दूध और ब्रेड " + i : long ? (i % 3 ? "Item " : LONG) + i : ["Milk", "Avocados", "Bread"][i], done: i === 2 })) }],
        wifi: wifi(long ? "x".repeat(32) : hindi ? "मेहमान-नेटवर्क" : "salt-and-sun", long ? "y".repeat(63) : "summer-swell"),
        guide: Array.from({ length: long ? 8 : 2 }, (_, i) => ({ title: hindi ? "चेक आउट " + i : long ? "Heading number " + i + " " + LONG : ["Check out", "Around here"][i], text: hindi ? "रविवार सुबह दस बजे तक। चाबियाँ रसोई की बेंच पर छोड़ दें।" : long ? "Words that go on for a long while. ".repeat(8) + LONG : "Sunday by 10am." })),
        cal: { set: true, events: (long ? Array.from({ length: 12 }, (_, i) => soon(20 + i * 0.3, "A very long event name that will never fit on one line, number " + i + " " + LONG)) : [soon(22, T("Dinner with Gran")), soon(23, T("Movie night"))]) },
        screen: { ok: true, minutes: long ? 1439 : 95, apps: Array.from({ length: long ? 8 : 2 }, (_, i) => ({ name: long ? "An app with a very long name indeed " + i : hindi ? "यूट्यूब" : ["YouTube", "ABC iview"][i], minutes: 300 - i })) }
      };
      return {
        bridge: true, place: { name: hindi ? "मुंबई" : long ? "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch" : "Riverside", lat: -28.8, lon: 153.4 }, who: "a", quick: ["sleep", "look", "input"],
        weather: { temp: long ? -23 : 23, code: 61, is_day: true, hi: 26, lo: 16, uv: 9, rain15: [0, 0.3, 1.2, 2.4, 3, 1, 0.4, 0, 0, 0, 0, 0],
          hourly: Array.from({ length: 24 }, (_, i) => ({ time: iso(i), temp: 20 + (i % 6), code: [0, 2, 3, 61, 95][i % 5], uv: i % 9, pop: (i * 7) % 100 })),
          daily: Array.from({ length: 7 }, (_, i) => ({ date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), code: [0, 61, 3][i % 3], hi: 25, lo: 15, sunrise: iso(-4), sunset: iso(8), uv: 10 })),
          air: { aqi: 33, hourly: [33, 35, 40] }, marine: { wave: 1.6, period: 10, dir: 120, wind: 12, windDir: 270, hourly: [1.6, 1.7, 1.8] } },
        shows, music: { title: T("A song with quite a long title"), artist: T("Some Artist"), state: "playing", position: 40, duration: 200, package: "com.spotify.tv.android", source: "Spotify" },
        apps: [["com.netflix.ninja", "Netflix"], ["com.google.android.youtube.tv", "YouTube"], ["au.net.abc.iview", "ABC iview"], ["au.com.stan.and", "Stan"], ["com.spotify.tv.android", "Spotify"]].map((a) => ({ package: a[0], name: long ? a[1] + " " + LONG : a[1] })),
        photos: ["demo/beach.jpg"], people: [{ id: "a", name: T("Alex") }, { id: "b", name: T("Sam") }], cards: [{ title: T("Solar today"), value: long ? "123,456.7 kWh" : "18.4 kWh" }],
        scenes: [{ entity: "scene.a", name: T("Movie night") }, { entity: "scene.b", name: T("Good night") }],
        ha, queue, home: homeData, web, commute: { from: { name: "Riverside" }, to: { name: long ? "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch" : hindi ? "पुणे" : "Parramatta" }, key: "K" },
        household: [{ id: "a", name: T("Alex"), shows: [] }, { id: "b", name: T("Sam"), shows: shows.concat([{ title: T("Utopia"), progress: 0.3 }, { title: T("The Newsreader"), progress: 0.3 }]).map((s, i) => ({ id: "s" + i, title: s.title, progress: 0.3 })) }]
      };
    }
    const rooms = (k) => [{ entity: "climate.a", name: L[k]("Living room"), ok: true, state: "cool", target: 22, current: 24.5, modes: ["off", "cool"] }];
    const tvEnv = (k) => ({ data: data(k), rooms: rooms(k), ha: true, imgOk: () => true, clock24: false });
    const STATES = { designer: () => ({ demo: true, designer: true }), tv: () => tvEnv("tv"), long: () => tvEnv("long"), hindi: () => tvEnv("hindi"),
      unset: () => ({ data: { bridge: false, place: {}, ha: {}, home: { note: null, lists: [], wifi: null, guide: [], cal: { set: false }, memory: { photos: 0, dated: 0, today: [] }, screen: { ok: false, why: "off" }, goal: 0 }, web: {}, household: [] }, rooms: [] }) };
    // the kinds whose options keep align (as design.js keeps them)
    const keepsAlign = (kind) => { try { const d = CD.sanitize({ objects: [{ id: "w", type: "widget", kind, w: 400, h: 200, opts: { align: "left" } }] }); return ((d.objects[0] || {}).opts || {}).align === "left"; } catch (e) { return false; } };
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
    document.body.appendChild(host);
    const half = document.createElement("div");
    half.className = "cd-layer"; half.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:98;transform:scale(.5);transform-origin:0 0";
    document.body.appendChild(half);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const out = [], byKind = {}, kinds = C.kinds().filter((k) => k !== "stack");
    let count = 0, centred = 0;
    for (const kind of kinds) {
      const s = C.get(kind).sizes, seen = {};
      const list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat((s.x || []).map((x) => [x[0], x[2], x[3]])).concat([["min", s.min[0], s.min[1]]]).filter((x) => { const k = x[1] + "x" + x[2]; if (seen[k]) return false; seen[k] = 1; return true; });
      const aligns = keepsAlign(kind) ? ["left", "right"] : [];
      for (const [id, w, h] of list) for (const st of Object.keys(STATES).concat(aligns)) {
        while (host.firstChild) host.removeChild(host.firstChild);
        const env = STATES[st] ? STATES[st]() : STATES.tv();
        const o = { id: "t", kind, w: w * 100 - 40, h: h * 100 - 40 };
        if (!STATES[st]) o.opts = { align: st };
        let el;
        try { el = W.render(o, env); } catch (e) { out.push(kind + " " + id + " " + st + ": throws " + e.message); continue; }
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        // widgets that fit their words after they are on screen (data-fits) get the frames they need
        for (let k = 0; k < 40 && el.getAttribute("data-fits") && !el.getAttribute("data-fitted"); k++) await frame();
        const r = check(el, kind + " " + id + " (" + w + "x" + h + ") " + st, { widget: true, align: STATES[st] ? null : st });
        centred += r.centred;
        r.out.forEach((m) => { out.push(m); byKind[kind] = (byKind[kind] || 0) + 1; });
        // the same widget in a design layer scaled to half (as Couch TV Studio's preview and a 1280 wide
        // TV draw it) is laid out exactly the same: nothing measured on screen without the scale
        if (st === "tv" || st === "long" || st === "unset") {
          while (half.firstChild) half.removeChild(half.firstChild);
          const el2 = W.render(o, STATES[st]());
          el2.style.position = "absolute"; el2.style.left = "80px"; el2.style.top = "60px";
          half.appendChild(el2);
          for (let k = 0; k < 40 && el2.getAttribute("data-fits") && !el2.getAttribute("data-fitted"); k++) await frame();
          const sizes = (x) => [].map.call(x.querySelectorAll("*"), (n) => n.closest("svg") && n.tagName.toLowerCase() !== "svg" ? "" : (n.offsetWidth || 0) + "x" + (n.offsetHeight || 0)).join(" ");
          if (sizes(el) !== sizes(el2)) { out.push(kind + " " + id + " (" + w + "x" + h + ") " + st + ": drawn differently when the design is scaled to half"); byKind[kind] = (byKind[kind] || 0) + 1; }
        }
      }
    }
    host.remove(); half.remove();
    return { out, count, centred, kinds: kinds.length, byKind };
  }, [CHECKS, fixtures]);
  console.log("  drew " + res.count + " boxes (" + res.kinds + " kinds), " + res.centred + " measured for centring, " + res.out.length + " problems");
  if (res.out.length) console.log("  by kind: " + Object.keys(res.byKind).map((k) => k + " " + res.byKind[k]).join(", "));
  const show = process.env.FIT_LIST ? res.out : res.out.slice(0, 60);
  ok(res.kinds >= 65, "every kind but the stack (which holds the others): " + res.kinds);
  ok(res.count >= 1500, "drew " + res.count + " boxes");
  ok(page.errors.length === 0, "no page errors: " + page.errors.slice(0, 3).join(" | "));
  ok(res.out.length === 0, "every widget fits, nothing is cut off, words are 23 px or more, centred unless set:\n  " + show.join("\n  ") + (res.out.length > show.length ? "\n  ... and " + (res.out.length - show.length) + " more (FIT_LIST=1 for all)" : ""));
  await page.close();
}

// 2. the clocks outside the widget grid: a design's free clock at every size, and the classic home's
// glass clock in every scene
{
  const page = await home([{ id: "w0", type: "widget", kind: "clock", x: 80, y: 60, w: 360, h: 160 }]);
  const res = await page.evaluate(async (CHECKS) => {
    const check = eval("(" + CHECKS + ")");
    const out = [], host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99";
    document.body.appendChild(host);
    let count = 0;
    // each one alone, drawn by design.js the way the TV draws it, in the box the designer gives a free
    // clock (design.js natural(): 2.4 by 1.1 of its size, or 1.45 with the date)
    for (const size of [16, 40, 80, 120, 200, 300, 450, 600]) for (const date of [false, true]) for (const format of ["12h", "24h"]) {
      while (host.firstChild) host.removeChild(host.firstChild);
      const node = window.CouchDesign.renderObject({ type: "clock", size, date, format, w: Math.round(size * 2.4), h: Math.round(size * (date ? 1.45 : 1.1)) });
      host.appendChild(node);
      const c = node.querySelector(".cd-clockw");
      if (!c) { out.push("free clock " + size + ": not drawn"); continue; }
      // on the TV a free clock with a box is drawn exactly that size (design.js fitBox: .cd-fit, which
      // clips); the preview leaves that out, so it is put back here the same way
      c.classList.add("cd-fit"); c.style.width = Math.round(size * 2.4) + "px"; c.style.height = Math.round(size * (date ? 1.45 : 1.1)) + "px"; c.style.minWidth = "0";
      count++;
      const r = check(c, "free clock " + size + " px " + format + (date ? " with date" : ""), { widget: false, centre: false });
      // words under 23 px are the design's own choice of a small clock (16 px is allowed): not this audit's
      out.push.apply(out, r.out.filter((m) => !/words at/.test(m)));
    }
    host.remove();
    return { out, count };
  }, CHECKS);
  ok(res.count >= 32, "drew " + res.count + " free clocks");
  ok(res.out.length === 0, "a design's free clock is never cut off:\n  " + res.out.join("\n  "));
  await page.close();

  // the classic home: every scene's glass clock (12 and 24 hour), digits whole inside the fill
  const p2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await p2.goto(BASE + "?mock=1&reset=1");
  await p2.waitForFunction(() => document.querySelector(".gclock"));
  await p2.evaluate(() => document.fonts.ready);
  await p2.waitForTimeout(800);
  const res2 = await p2.evaluate(() => {
    const canvas = document.createElement("canvas").getContext("2d"), out = [];
    let count = 0;
    document.querySelectorAll(".scene").forEach((sc) => {
      const keep = sc.style.cssText;
      sc.style.display = "block"; sc.style.opacity = "1"; sc.style.visibility = "visible";
      sc.querySelectorAll(".gclock").forEach((g) => {
        ["12:58", "10:08", "23:59"].forEach((txt) => {
          const fills = g.querySelectorAll(".fill, .rim, .sheen, .edge");
          const old = [].map.call(fills, (f) => f.textContent);
          fills.forEach((f) => { f.textContent = txt; });
          const f = g.querySelector(".fill") || g, cs = getComputedStyle(f);
          canvas.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
          const m = canvas.measureText(txt), rg = document.createRange(); rg.selectNodeContents(f.firstChild || f);
          const q = rg.getBoundingClientRect(), base = q.top + m.fontBoundingBoxAscent, inkB = base + m.actualBoundingBoxDescent, inkT = base - m.actualBoundingBoxAscent, fr = f.getBoundingClientRect();
          count++;
          if (fr.height && (inkB > fr.bottom + 1.5 || inkT < fr.top - 1.5)) out.push((sc.className || "scene") + " " + txt + ": digits cut by " + Math.round(Math.max(inkB - fr.bottom, fr.top - inkT)) + " px");
          fills.forEach((x, i) => { x.textContent = old[i]; });
        });
      });
      sc.style.cssText = keep;
    });
    return { out, count };
  });
  ok(res2.count >= 5, "measured " + res2.count + " classic glass clocks");
  ok(res2.out.length === 0, "the classic glass clock's digits are whole:\n  " + res2.out.join("\n  "));
  await p2.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
