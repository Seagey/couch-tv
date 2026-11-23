// Widget swarm round 2, the clocks group, by what a person can SEE (the method of test_ws2_weather_visible.mjs):
// every clocks kind (clock, tallclock, glassclock, analog, flipclock, wordclock, worldclock, date, month, week,
// countdown, timer), at every size it lists, every setting value against the default (or the case named), at
// 10:07:07 and at 19:42:07 on Friday 20 November 2026 (Sydney). Each element's words are measured character by
// character: inside its own box and the widget's, before any "…". Checks:
//  - no words cut anywhere (the time, a city, the date, a countdown's name, a timer's name);
//  - every setting changes what shows, except the cases in SAME, each with its reason;
//  - a value that is the default here draws the same;
//  - no empty card, no page error.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_clocks_visible.mjs
// WS2_SOFT=1 lists every failure at the end; WS2_VISIBLE_LOG=<file> writes what each case shows.
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
const SAME = {
  "clock tile date off": "a tile has no room for the date, so it shows none either way",
  "clock tile ampm off (12 hour)": "a tile shows no am or pm either way",
  "clock wtile date off": "a wide tile has no room for the date, so it shows none either way",
  "date line dfmt short": "a narrow date already uses the short style (Fri 20 Nov)",
  "date tile dfmt short": "a narrow date already uses the short style (Fri 20 Nov)",
  "date small dfmt short": "a narrow date already uses the short style (Fri 20 Nov)",
  "date line place off (weather)": "the town's name is not on the two smallest sizes (the help says so)",
  "date tile place off (weather)": "the town's name is not on the two smallest sizes (the help says so)",
  "month tile wstart sun": "a tile shows the day and the date, no week grid",
  "week wtile place off": "the wide tile names only a place picked for it, never the home's town (the help says so)",
  "countdown tile unit days": "a tile has room for the number alone: days and sleeps are the same number",
  "countdown wtile unit days": "a wide tile has room for the number alone: days and sleeps are the same number",
  "worldclock tile format 24h @ 10:07:07": "a tile shows the home's time with no am or pm, and 10:07 reads the same in 12 and 24 hour",
  "worldclock tile label Family": "a tile has no room for a heading",
  "worldclock tile label long": "a tile has no room for a heading",
  "worldclock wtile label Family": "a wide tile has no room for a heading",
  "worldclock wtile label long": "a wide tile has no room for a heading"
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
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
const cases = { all: 0, same: 0, kinds: {} }, usedSame = {};
try {
  for (const at of ["2026-11-20T10:07:07+11:00", "2026-11-20T19:42:07+11:00"]) {
    const hhmm = at.slice(11, 19);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: "Australia/Sydney", locale: "en-AU" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.clock.setFixedTime(new Date(at));
    // the real TV home (its fonts and the design layer's styles), as tests/test_widget_fit_all.mjs draws widgets
    const design = { v: 1, background: { colour: "#26303f" }, objects: [{ id: "w0", type: "widget", kind: "clock", x: 80, y: 60, w: 360, h: 160 }] };
    await page.goto(ORIGIN + "/tv-home/web/index.html?mock=1&reset=1");
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
    await page.goto(ORIGIN + "/tv-home/web/index.html?mock=1&design=local");
    await page.waitForFunction(() => document.querySelector(".cd-layer") && window.CouchWidgets && window.CouchWidgetCaps);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    if (process.env.WS2_SHOT) {
      const [kind, w, h] = process.env.WS2_SHOT.split(",");
      await page.evaluate(([kind, w, h]) => { const host = document.createElement("div"); host.className = "cw-o"; host.id = "shot"; host.style.cssText = "position:absolute;left:60px;top:40px"; document.body.appendChild(host);
        host.appendChild(window.CouchWidgets.render({ id: "x", kind, opts: {}, w: +w, h: +h }, { data: { wset: {} } })); }, [kind, w, h]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: process.env.WS2_SHOT_FILE || "shot.png", clip: { x: 0, y: 0, width: +w + 120, height: +h + 80 } });
      process.exit(0);
    }
    const out = await page.evaluate(() => {
      const pad = (v) => String(v).padStart(2, "0");
      const isoH = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":00";
      const day = (i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
      const hourAt = (i) => { const d = new Date(); d.setMinutes(0, 0, 0); return isoH(new Date(d.getTime() + i * 3600000)); };
      const wx = (temp) => ({ temp, code: 1, hi: temp + 4, lo: temp - 6, uv: 7,
        hourly: Array.from({ length: 24 }, (_, i) => ({ time: hourAt(i), code: 1, temp: temp + (i % 3), pop: 5, uv: 3 })),
        daily: Array.from({ length: 7 }, (_, i) => ({ date: day(i), code: i % 3 ? 1 : 3, lo: temp - 6 + (i % 2), hi: temp + 4 - (i % 3), sunrise: day(i) + "T05:40", sunset: day(i) + "T19:20", uv: 8, pop: 10 })),
        rain15: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
      const HOME = { name: "Hillside", lat: -28.9, lon: 153.3 };
      const BYRON = { name: "Byron Bay", lat: -28.64, lon: 153.61, timezone: "Australia/Sydney" };
      const KEY = (p) => (+p.lat).toFixed(2) + "," + (+p.lon).toFixed(2);
      const base = { weather: wx(22), place: HOME, country: "AU", unit: "c", wxAt: { [KEY(BYRON)]: wx(31) } };
      // __noWx: a TV with no town set yet (no weather at all)
      const env = (set) => ({ data: Object.assign({}, base, { wset: { x: set || {} } }, set && set.__noWx ? { weather: null, place: null } : {}) });
      // the sizes on the 1920 x 1080 grid (60 px cells, 40 px gaps), as tests/test_widget_fit_all.mjs names them
      const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
      const PX = Object.fromEntries(Object.entries(NAMED).map(([k, [c, r]]) => [k, [c * 100 - 40, r * 100 - 40]]));
      const C = window.CouchWidgetCaps;
      const canvas = document.createElement("canvas").getContext("2d");
      function draw(kind, w, h, e) {
        document.querySelectorAll(".ws-host").forEach((x) => x.remove());
        const host = document.createElement("div");
        host.className = "ws-host cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
        document.body.appendChild(host);
        const root = window.CouchWidgets.render({ id: "x", kind, opts: {}, w, h }, e);
        root.style.position = "absolute"; root.style.left = "80px"; root.style.top = "60px";
        host.appendChild(root);
        const R = root.getBoundingClientRect(), leaves = [];
        [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
          if (el.closest("svg")) return;
          const nodes = [...el.childNodes].filter((nd) => nd.nodeType === 3 && nd.textContent.trim());
          if (!nodes.length) return;
          const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return;
          const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const ell = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
          const cut = ell ? 18 : 0;
          const clipY = cs.overflowY !== "visible" || /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || "");
          canvas.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
          let t = "", vis = 0, gone = false;
          for (const nd of nodes) {
            const m = canvas.measureText(nd.textContent.trim());
            for (let i = 0; i < nd.textContent.length; i++) {
              const ch = nd.textContent[i]; t += ch;
              const rg = document.createRange(); rg.setStart(nd, i); rg.setEnd(nd, i + 1);
              const r = rg.getBoundingClientRect();
              let top = r.top, bot = r.bottom;
              if (m.fontBoundingBoxAscent && Math.abs(r.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) < 3) { const base = r.top + m.fontBoundingBoxAscent; top = base - m.actualBoundingBoxAscent; bot = base + m.actualBoundingBoxDescent; }
              else { top = r.top + r.height * 0.12; bot = r.bottom - r.height * 0.12; }
              const inside = r.width === 0 || (r.left >= Math.max(E.left, R.left) - 1.5 && r.right <= Math.min(E.right - cut, R.right) + 1.5 &&
                top >= Math.max(clipY ? E.top : -1e9, R.top) - 1.5 && bot <= Math.min(clamp || clipY ? E.bottom : 1e9, R.bottom) + 1.5);
              if (!inside) gone = true;
              if (!gone) vis++;
            }
          }
          const tt = t.replace(/\s+/g, " ").trim();
          leaves.push({ t: tt, seen: t.slice(0, vis).replace(/\s+/g, " ").trim(), fit: !gone && !ell && !(clamp && el.scrollHeight > el.clientHeight + 1) });
        });
        // what is not words: the dial (svg), the glass picture and where the words sit
        const svgs = [...root.querySelectorAll("svg")].map((s) => (s.getAttribute("style") || "") + s.innerHTML.length + ":" + s.querySelectorAll("[data-hand],[data-num]").length);
        const looks = [root].concat([...root.querySelectorAll("*")]).map((el) => (el.style.backgroundImage || "") + (el.style.textAlign || "") + (el.style.justifyContent || "") + (el.style.alignItems || "")).filter(Boolean);
        return { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1",
          seen: leaves.map((l) => l.seen).join(" | "), cut: leaves.filter((l) => !l.fit).map((l) => '"' + l.t + '" shows "' + l.seen + '"'),
          sig: leaves.map((l) => l.seen).join(" | ") + " || " + svgs.join(";") + " || " + looks.join(";") };
      }
      // [label, settings, expect same (the value IS the default here), vs (another case, else the default)]
      // this home is 12 hour (English, no clock set): 12 hour draws the default; 10:07 reads the same in 12 and 24 hour,
      // so 24 hour is only compared at 19:42 ("pm": the change shows in the evening)
      const FMT = [["format 24h", { format: "24h" }, "pm"], ["format 12h (the home is 12 hour)", { format: "12h" }, true], ["format 12h vs 24h", { format: "12h" }, "pm", "format 24h"]];
      const V = {
        clock: [["default", {}], ...FMT, ["seconds on", { seconds: true }], ["date off", { date: false }], ["ampm off (12 hour)", { format: "12h", ampm: false }, false, "format 12h (the home is 12 hour)"],
          ["date on (same)", { date: true }, true], ["seconds off (same)", { seconds: false }, true]],
        tallclock: [["default", {}], ...FMT, ["align left", { align: "left" }], ["align right", { align: "right" }], ["align center (same)", { align: "center" }, true]],
        glassclock: [["default", {}], ...FMT, ["scene night (the home's scene here is night)", { scene: "night" }, true], ["scene fog", { scene: "fog" }], ["scene golden", { scene: "golden" }], ["scene dawn", { scene: "dawn" }], ["scene water", { scene: "water" }]],
        analog: [["default", {}], ["seconds off", { seconds: false }], ["numbers on", { numbers: true }], ["seconds on (same)", { seconds: true }, true]],
        flipclock: [["default", {}], ...FMT],
        wordclock: [["default", {}], ["precise on", { precise: true }], ["dayline off", { dayline: false }], ["precise + dayline off", { precise: true, dayline: false }, false, "dayline off"]],
        worldclock: [["default", {}], ["cities Tokyo London", { cities: ["Asia/Tokyo", "Europe/London"] }], ["cities Paris", { cities: ["Europe/Paris"] }], ["cities four", { cities: ["Asia/Tokyo", "Europe/London", "America/Los_Angeles", "Pacific/Auckland"] }],
          ["format 24h", { format: "24h" }], ["label Family", { label: "Family" }], ["label long", { label: "Our family far away" }]],
        date: [["default", {}], ["show weather", { show: "weather" }], ["show both", { show: "both" }], ["show both, no town yet", { show: "both", __noWx: true }, false, "show both"], ["dfmt short", { dfmt: "short" }], ["dfmt numeric", { dfmt: "numeric" }], ["dfmt weekday", { dfmt: "weekday" }],
          ["dfmt day_month", { dfmt: "day_month" }], ["dfmt full", { dfmt: "full" }], ["place off (weather)", { show: "weather", place: false }, false, "show weather"], ["show date (same)", { show: "date" }, true]],
        month: [["default", {}], ["wstart sun", { wstart: "sun" }], ["wstart mon (same)", { wstart: "mon" }, true]],
        week: [["default", {}], ["town Byron Bay", { town: BYRON }], ["place off", { place: false }], ["town Byron Bay + place off", { town: BYRON, place: false }, false, "town Byron Bay"]],
        countdown: [["default", {}], ["label Ella's party", { label: "Ella's party" }], ["label long", { label: "Grandma and Grandpa's visit" }], ["label birthday", { label: "Ella's 7th birthday party" }], ["day 1", { day: 1 }], ["month 1", { month: 1 }],
          ["year 2027", { year: 2027 }], ["unit days", { unit: "days" }], ["unit weeks", { unit: "weeks" }], ["unit sleeps (same)", { unit: "sleeps" }, true]],
        timer: [["default", {}], ["minutes 10", { minutes: 10 }], ["minutes 60", { minutes: 60 }], ["label Pizza", { label: "Pizza" }], ["label long", { label: "Roast in the oven now" }], ["minutes 0 (same)", { minutes: 0 }, true]]
      };
      const res = [];
      for (const kind of Object.keys(V)) {
        const sizes = C.get(kind).sizes.s.filter((s) => PX[s]);
        for (const s of sizes) {
          const [w, h] = PX[s], got = {};
          for (const [label, set, expSame, vs] of V[kind]) {
            const d = draw(kind, w, h, env(set));
            got[label] = d;
            const ref = got[vs || "default"];
            const same = label !== "default" && d.sig === ref.sig;
            const pmOnly = expSame === "pm";
            res.push({ kind, s, w, h, label, vs: vs || "default", same, expSame: expSame === true, pmOnly, morning: new Date().getHours() < 12, empty: d.empty, cut: d.cut, seen: d.seen });
          }
        }
      }
      return res;
    });
    lines.push("==== " + hhmm + (errs.length ? " PAGEERRORS " + errs.join(" / ") : ""));
    ok(!errs.length, "no page errors at " + hhmm + ": " + errs.join(" / "));
    for (const r of out) {
      const where = r.kind + " " + r.s + " (" + r.w + " x " + r.h + ") " + r.label + " at " + hhmm;
      cases.all++; cases.kinds[r.kind] = (cases.kinds[r.kind] || 0) + 1;
      ok(!r.empty, where + ": draws, not an empty card");
      ok(!r.cut.length, where + ": no words cut: " + r.cut.join("; "));
      const flag = r.label === "default" ? "" : r.same && !r.expSame ? "SAME(vs " + r.vs + ")" : !r.same && r.expSame ? "CHANGED(expected same)" : "";
      lines.push([r.kind, r.s + " " + r.w + "x" + r.h, r.label, flag, r.empty ? "EMPTY" : "", r.cut.length ? "CUT[" + r.cut.join("; ") + "]" : "", "=> " + r.seen.slice(0, 200)].filter(Boolean).join(" ; "));
      if (r.label === "default") continue;
      if (r.pmOnly && r.morning) { cases.morning = (cases.morning || 0) + 1; continue; }   // 10:07 reads the same in 12 and 24 hour
      const sk = SAME[r.kind + " " + r.s + " " + r.label + " @ " + hhmm] ? r.kind + " " + r.s + " " + r.label + " @ " + hhmm : r.kind + " " + r.s + " " + r.label;
      const why = SAME[sk];
      if (r.expSame || why) { cases[why ? "noRoom" : "isDefault"] = (cases[why ? "noRoom" : "isDefault"] || 0) + 1; ok(r.same, where + ": draws the same as " + r.vs + (why ? " (" + why + ")" : " (that value is the default here)") + ": " + r.seen); cases.same++; if (why) usedSame[sk] = 1; }
      else ok(!r.same, where + ": changes what shows against " + r.vs + ": " + r.seen);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  if (process.env.WS2_VISIBLE_LOG) fs.writeFileSync(process.env.WS2_VISIBLE_LOG, lines.join("\n"));
}
Object.keys(SAME).forEach((k) => ok(usedSame[k], "SAME names a real case: " + k));
ok(Object.keys(cases.kinds).length === 12, "all twelve kinds measured: " + Object.keys(cases.kinds).join(", "));
console.log("  " + cases.all + " kind x size x setting x time cases (" + Object.entries(cases.kinds).map(([k, v]) => k + " " + v).join(", ") + "), " + cases.same + " of them the same: " + (cases.isDefault || 0) + " where the value IS the default here, " + (cases.noRoom || 0) + " where the setting does not show at that size (" + Object.keys(SAME).length + " reasons in SAME, each said in its help), " + (cases.morning || 0) + " 24 hour cases at 10:07 not compared");
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
