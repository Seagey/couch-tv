// Widget swarm round 2, the weather group, by what a person can SEE (from the 21 Nov gate probe):
// every weather kind, every size it lists, every setting value against the default (or the case named),
// at 10:00 and at 19:30. Each element's words are measured character by character: inside its own box
// and the widget's, before any "…". Checks:
//  - no words cut anywhere (a place's name, the sky, the high, the band, the clock words);
//  - every setting changes what shows, except the cases in SAME, each with its reason;
//  - a value that is the default here draws the same;
//  - no empty card, no page error.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_weather_visible.mjs
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
// the cases where a setting draws the same at a size, and why ("kind size label")
const SAME = {
  "weather tile place off": "a tile names no home town, so there is nothing to hide",
  "weather tile hilo off": "a tile shows no high and low",
  "weather tile place+hilo off": "a tile shows neither",
  "weather tile town LB + hilo off": "a tile shows no high and low",
  "bigtemp tile place off": "a tile names no home town, so there is nothing to hide",
  "hourly wtile hours 6": "a wide tile fits 5 hours, which is what it shows already",
  "hourly wtile hours 8": "a wide tile fits 5 hours, which is what it shows already",
  "hourly wtile hours 8 vs 6": "both are more than the 5 that fit",
  "hourly wtile LB hours 4": "with a place's name a wide tile fits 2 hours",
  "hourly wtile LB hours 8": "with a place's name a wide tile fits 2 hours",
  "hourly small hours 6 vs 4": "a small widget fits 4 hours",
  "hourly small hours 8 vs 6": "a small widget fits 4 hours",
  "hourly medium hours 6": "a medium widget fits 6 hours, which is what it shows already",
  "hourly wide hours 8": "a wide widget shows all 8 already",
  "hourly wide LB hours 8": "a wide widget shows all 8 already"
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
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
const cases = { all: 0, same: 0 }, usedSame = {};
try {
  for (const [hh, mm] of [[10, 0], [19, 30]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    const at = new Date(); at.setHours(hh, mm, 0, 0);
    await page.clock.setFixedTime(at);
    await page.goto(ORIGIN + "/tv-home/web/probe.html");
    await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps);
    const out = await page.evaluate(() => {
      const pad = (v) => String(v).padStart(2, "0");
      const isoH = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":00";
      const day = (i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
      const hourAt = (i) => { const d = new Date(); d.setMinutes(0, 0, 0); return isoH(new Date(d.getTime() + i * 3600000)); };
      const wx = (temp, extra, rain) => Object.assign({ temp, code: 1, hi: temp + 4, lo: temp - 6, uv: 7,
        hourly: Array.from({ length: 24 }, (_, i) => ({ time: hourAt(i), code: i % 4 === 2 ? 3 : 1, temp: temp + (i % 3), pop: 5, uv: Math.max(0, 8 - Math.abs(i - 3)) })),
        daily: Array.from({ length: 7 }, (_, i) => ({ date: day(i), code: 1, lo: temp - 6, hi: temp + 4, sunrise: day(i) + "T05:40", sunset: day(i) + "T19:20", uv: 8, pop: 10 })),
        rain15: rain || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, extra || {});
      const HOME = { name: "Hillside", lat: -33.6, lon: 151.1 };
      const BEACH = { name: "Long Beach", lat: -33.5, lon: 151.4, timezone: "Australia/Sydney" };
      const PMQ = { name: "Port Macquarie", lat: -31.43, lon: 152.91, timezone: "Australia/Sydney" };
      const PERTH = { name: "Perth", lat: -31.95, lon: 115.86, timezone: "Australia/Perth" };
      const PERTHNZ = Object.assign({}, PERTH, { timezone: "auto" });
      const PMQNZ = Object.assign({}, PMQ, { timezone: "auto" });
      const KEY = (p) => (+p.lat).toFixed(2) + "," + (+p.lon).toFixed(2);
      const air = (eu, us) => ({ aqi: eu, hourly: [eu, eu], us, usHourly: [us, us] });
      const marine = (wave) => ({ wave, period: 9, dir: 120, wind: 37.04, windDir: 200, hourly: [wave, wave * 0.8, wave * 1.1] });
      const own = wx(31, { air: air(55, 120), marine: marine(2.4) }, [0, 0, 0.5, 3, 4, 2, 0, 0, 0, 0, 0, 0]);
      const base = { weather: wx(24, { air: air(12, 40), marine: marine(1.2) }), place: HOME, country: "AU", unit: "c",
        wxAt: { [KEY(BEACH)]: own, [KEY(PERTH)]: own, [KEY(PMQ)]: own } };
      const env = (set, more) => ({ data: Object.assign({}, base, { wset: { x: set || {} } }, more || {}) });
      const PX = { tile: [160, 160], wtile: [360, 160], small: [360, 360], tall: [360, 560], medium: [760, 360], wide: [1160, 360], large: [760, 760] };
      const C = window.CouchWidgetCaps;
      function draw(kind, w, h, e) {
        document.querySelectorAll(".ws-host").forEach((x) => x.remove());
        const host = document.createElement("div");
        host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
        document.body.appendChild(host);
        const root = window.CouchWidgets.render({ id: "x", kind, opts: {}, w, h }, e);
        host.appendChild(root);
        const R = root.getBoundingClientRect(), leaves = [];
        [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
          if (el.closest("svg")) return;
          const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
          if (!nodes.length) return;
          const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
          const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const ell = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
          const cut = ell ? 18 : 0;
          let t = "", vis = 0, gone = false;
          for (const nd of nodes) for (let i = 0; i < nd.textContent.length; i++) {
            const ch = nd.textContent[i]; t += ch;
            const rg = document.createRange(); rg.setStart(nd, i); rg.setEnd(nd, i + 1);
            const r = rg.getBoundingClientRect();
            const inside = r.width === 0 || (r.left >= Math.max(E.left, R.left) - 1 && r.right <= Math.min(E.right - cut, R.right) + 1 && r.top >= R.top - 1 && r.bottom <= (clamp ? Math.min(E.bottom, R.bottom) : R.bottom) + 1);
            if (!inside) gone = true;
            if (!gone) vis++;
          }
          const tt = t.replace(/\s+/g, " ").trim();
          leaves.push({ t: tt, seen: t.slice(0, vis).replace(/\s+/g, " ").trim(), fit: !gone && !ell && !(clamp && el.scrollHeight > el.clientHeight + 1) });
        });
        const svgs = [...root.querySelectorAll("svg")].map((s) => (s.getAttribute("style") || "") + s.innerHTML.length);
        return { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1",
          seen: leaves.map((l) => l.seen).join(" | "), cut: leaves.filter((l) => !l.fit).map((l) => '"' + l.t + '" shows "' + l.seen + '"'), sig: leaves.map((l) => l.seen).join(" | ") + " || " + svgs.join(";") };
      }
      // [label, settings, extra data]; vs the default (first). "expect same" where the value IS the default here
      const V = {
        weather: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }], ["place off", { place: false }], ["hilo off", { hilo: false }], ["place+hilo off", { place: false, hilo: false }],
          ["degrees f", { degrees: "f" }], ["degrees c (same on a C home)", { degrees: "c" }, null, true],
          ["town LB + place off", { town: BEACH, place: false }, null, false, "town Long Beach"], ["town LB + hilo off", { town: BEACH, hilo: false }, null, false, "town Long Beach"]],
        bigtemp: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }], ["place off", { place: false }], ["degrees f", { degrees: "f" }], ["degrees c (same)", { degrees: "c" }, null, true],
          ["town LB + place off", { town: BEACH, place: false }, null, false, "town Long Beach"]],
        hourly: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }], ["hours 4", { hours: 4 }], ["hours 6", { hours: 6 }], ["hours 8", { hours: 8 }],
          ["hours 6 vs 4", { hours: 6 }, null, false, "hours 4"], ["hours 8 vs 6", { hours: 8 }, null, false, "hours 6"], ["degrees f", { degrees: "f" }],
          ["LB hours 4", { town: BEACH, hours: 4 }, null, false, "town Long Beach"], ["LB hours 8", { town: BEACH, hours: 8 }, null, false, "town Long Beach"]],
        rain: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }]],
        uv: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }]],
        sun: [["default", {}], ["town Perth", { town: PERTH }], ["town Perth no zone", { town: PERTHNZ }], ["town Port Macquarie", { town: PMQ }], ["town PMQ no zone", { town: PMQNZ }]],
        moon: [["default", {}], ["hemi north", { hemi: "north" }], ["hemi south (same: Hillside is south)", { hemi: "south" }, null, true]],
        air: [["default", {}], ["town Long Beach", { town: BEACH }], ["town Port Macquarie", { town: PMQ }], ["scale us", { scale: "us" }], ["scale eu (same in AU)", { scale: "eu" }, null, true]],
        surf: [["default", {}], ["place Long Beach", { place: BEACH }], ["place Port Macquarie", { place: PMQ }], ["units ft", { units: "ft" }], ["units m (same in AU)", { units: "m" }, null, true],
          ["wind kn", { wind: "kn" }], ["wind mph", { wind: "mph" }], ["wind kmh (same in AU)", { wind: "kmh" }, null, true]]
      };
      const res = [];
      for (const kind of Object.keys(V)) {
        const sizes = C.get(kind).sizes.s.filter((s) => PX[s]);
        for (const s of sizes) {
          const [w, h] = PX[s], got = {};
          for (const [label, set, more, expSame, vs] of V[kind]) {
            const d = draw(kind, w, h, env(set, more));
            got[label] = d;
            const ref = got[vs || "default"];
            const same = label !== "default" && d.sig === ref.sig;
            res.push({ kind, s, w, h, label, vs: vs || "default", same, expSame: !!expSame, empty: d.empty, cut: d.cut, seen: d.seen });
          }
        }
      }
      return res;
    });
    lines.push("==== clock " + hh + ":" + pad(mm) + (errs.length ? " PAGEERRORS " + errs.join(" / ") : ""));
    ok(!errs.length, "no page errors at " + hh + ":" + pad(mm) + ": " + errs.join(" / "));
    for (const r of out) {
      const at = r.kind + " " + r.s + " (" + r.w + " x " + r.h + ") " + r.label + " at " + hh + ":" + pad(mm);
      cases.all++;
      ok(!r.empty, at + ": draws a reading, not an empty card");
      ok(!r.cut.length, at + ": no words cut: " + r.cut.join("; "));
      if (r.label === "default") continue;
      const why = SAME[r.kind + " " + r.s + " " + r.label];
      if (r.expSame || why) { ok(r.same, at + ": draws the same as " + r.vs + (why ? " (" + why + ")" : " (that value is the default here)") + ": " + r.seen); cases.same++; if (why) usedSame[r.kind + " " + r.s + " " + r.label] = 1; }
      else ok(!r.same, at + ": changes what shows against " + r.vs + ": " + r.seen);
      const flag = r.label === "default" ? "" : r.same && !r.expSame ? "SAME(vs " + r.vs + ")" : !r.same && r.expSame ? "CHANGED(expected same)" : "";
      lines.push([r.kind, r.s + " " + r.w + "x" + r.h, r.label, flag, r.empty ? "EMPTY" : "", r.cut.length ? "CUT[" + r.cut.join("; ") + "]" : "", "=> " + r.seen.slice(0, 200)].filter(Boolean).join(" ; "));
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
ok(Object.keys(SAME).length === 15, "15 setting x size cases draw the same, each with its reason");
console.log("  " + cases.all + " kind x size x setting x time cases, " + cases.same + " of them the same by design");
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
function pad(v) { return String(v).padStart(2, "0"); }
