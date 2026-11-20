// Widget swarm round 2, the home group, by what a person can SEE (from the checker's 21 Nov size probe,
// probe4): the 14 home kinds, every size each lists, every setting value against the default (or the case
// named), set on this TV, at 10:00. Each element's words are measured character by character: inside its
// own box and the widget's, before any "...". Checks:
//  - no words cut anywhere;
//  - every setting changes what shows (its words, its pictures or its colours), except the cases in SAME,
//    each with its reason;
//  - no empty card except the ones named in EMPTY_OK, no page error.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_home_visible.mjs
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
  "agenda tile calendars bookings": "a tile shows only the next event, and the next is Tom's check in, a booking",
  "agenda wtile calendars bookings": "a wide tile shows only the next event, and the next is Tom's check in, a booking",
  "card tile live Solar": "each in turn (the default) shows Solar today at this time",
  "card wtile live Solar": "each in turn (the default) shows Solar today at this time",
  "card small live Solar": "each in turn (the default) shows Solar today at this time",
  "agenda tile days week": "a tile shows only the next event, and with events today the week's next is today's",
  "agenda wtile days week": "a wide tile shows only the next event, and with events today the week's next is today's",
  "agenda tile days week (clear day)": "a tile shows only the next event with its own day: tomorrow's, both ways",
  "screentime tile appcount 0": "apps show only on a Medium widget or bigger (its help says so)",
  "screentime tile appcount 3": "apps show only on a Medium widget or bigger",
  "screentime tile appcount 5": "apps show only on a Medium widget or bigger",
  "screentime tile appcount 5 vs 3": "apps show only on a Medium widget or bigger",
  "screentime wtile appcount 0": "apps show only on a Medium widget or bigger",
  "screentime wtile appcount 3": "apps show only on a Medium widget or bigger",
  "screentime wtile appcount 5": "apps show only on a Medium widget or bigger",
  "screentime wtile appcount 5 vs 3": "apps show only on a Medium widget or bigger",
  "screentime small appcount 0": "apps show only on a Medium widget or bigger",
  "screentime small appcount 3": "apps show only on a Medium widget or bigger",
  "screentime small appcount 5": "apps show only on a Medium widget or bigger",
  "screentime small appcount 5 vs 3": "apps show only on a Medium widget or bigger",
  "mosaic small count 3": "under 1000 px wide, as many as fit is 3",
  "mosaic medium count 3": "under 1000 px wide, as many as fit is 3",
  "mosaic large count 3": "under 1000 px wide, as many as fit is 3",
  "mosaic xl count 5": "1000 px wide or more, as many as fit is 5"
};
// a reference drawing that is an empty card on purpose ("kind label")
const EMPTY_OK = { "memory default": "no photo was taken on this day, the case This week is set against" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "qr.js", "athome.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  // a time near 10:00 where the slideshow's 20 seconds (the default), 10 seconds, 1 minute, 5 minutes and
  // Shuffle each show another photo (widgets.js dayIndex and mixed, the same rules), found, not guessed
  const mixed = (list, seed) => { const o = list.slice(); let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1; for (let k = o.length - 1; k > 0; k--) { x = (x * 48271) % 2147483647; const j = x % (k + 1), t = o[k]; o[k] = o[j]; o[j] = t; } return o; };
  const base = new Date(); base.setHours(10, 0, 0, 0);
  let at = null;
  for (let sec = 0; sec < 3600 && !at; sec += 10) {
    const t = base.getTime() + sec * 1000, ix = [20, 10, 60, 300].map((k) => Math.floor(t / (k * 1000)) % 7);
    const sh = mixed([0, 1, 2, 3, 4, 5, 6], Math.floor(t / 86400000))[ix[0]];
    // and the Custom card's "each in turn" shows its first live number (Solar today) then
    if (new Set(ix).size === 4 && sh !== ix[0] && Math.floor(t / 20000) % 2 === 0) at = new Date(t);
  }
  ok(!!at, "a time near 10:00 where each slideshow setting shows another photo: " + at);
  await page.clock.setFixedTime(at);
  await page.goto(ORIGIN + "/tv-home/web/probe.html");
  await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps && window.CouchAtHome && window.TVQR);
  const out = await page.evaluate(() => {
    const dayMs = 86400000, t0 = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime(), now = Date.now(), Y = new Date().getFullYear();
    const PH = ["demo/beach.jpg", "demo/dog.jpg", "demo/camp.jpg", "demo/surf.jpg", "demo/hike.jpg", "demo/nan.jpg", "demo/birthday.jpg"], IDS = ["pa", "pb", "pc", "pd", "pe", "pf", "pg"];
    const dDay = Math.floor(Date.now() / 86400000) % 7, dHour = Math.floor(Date.now() / 3600000) % 7, pick1 = IDS[(dDay + 1) % 7], pick3 = IDS[(dDay + 3) % 7], pickA = IDS[(dHour + 2) % 7];
    const phData = { photos: PH, home: { photoIds: ["pa", "pb", "pc", "pd", "pe", "pf", "pg"] } };
    const main = [{ title: "Late swim", start: now + 300000, end: now + 2100000, allDay: false }, { title: "Bins out", start: t0 + dayMs, end: t0 + 2 * dayMs, allDay: true }, { title: "Dentist", start: t0 + 3 * dayMs + 36000000, end: t0 + 3 * dayMs + 39600000, allDay: false }];
    const books = [{ title: "Check out, Sarah", start: t0 + 2 * dayMs, end: t0 + 3 * dayMs, allDay: true }, { title: "Check in, Tom", start: now + 60000, end: now + 3600000, allDay: false }];
    const D = {
      agenda: { home: { cal: { set: true, events: main }, books: { set: true, events: books } } },
      agendaClear: { home: { cal: { set: true, events: main.slice(1) }, books: { set: false } } },
      // nothing today or tomorrow, only the dentist three days out
      agendaFar: { home: { cal: { set: true, events: main.slice(2) }, books: { set: false } } },
      people: { people: [{ id: "b", name: "Sam" }, { id: "c", name: "Jordan" }, { id: "d", name: "Riley" }], who: "b" },
      note: { home: { note: { text: "Dinner at 6. Feed Max!", from: "Mum" } } },
      list: { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }, { t: "Avocados", done: false }, { t: "Bread", done: true }, { t: "Eggs", done: true }] }, { name: "Jobs", items: [{ t: "Mow the lawn", done: false }] }] } },
      guide: { home: { guide: [{ title: "Check out", text: "By 10am." }, { title: "Bins", text: "Red Tuesday." }, { title: "Around here", text: "Beach 5 minutes." }] } },
      welcome: { home: { guest: "", stay: { set: true, view: { phase: "during", guest: "Sarah", checkout: t0 + 2 * dayMs + 36000000 } } } },
      memWeek: { home: { memory: { photos: 4, dated: 3, today: [], week: [{ src: "demo/camp.jpg", years: 3, year: Y - 3 }] } } },
      memBoth: { home: { memory: { photos: 4, dated: 3, today: [{ src: "demo/camp.jpg", years: 3, year: Y - 3 }], week: [{ src: "demo/camp.jpg", years: 3, year: Y - 3 }] } } },
      screen: { home: { screen: { ok: true, minutes: 125, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }, { name: "Netflix", minutes: 20 }, { name: "Stan", minutes: 12 }, { name: "Kayo", minutes: 10 }, { name: "SBS", minutes: 6 }, { name: "Disney", minutes: 4 }] }, goal: 120 } },
      wifi: { home: { wifi: { ssid: "salt-and-sun", pass: "summer-swell", sec: "WPA", qr: "WIFI:T:WPA;S:salt-and-sun;P:summer-swell;;" } } },
      card: { cards: [{ title: "Solar today", value: "18.4 kWh" }, { title: "Pool", value: "26" }] },
      photo: phData
    };
    // the named sizes in half cells (tools/tv-designer/app/grid.js), as boxes in TV pixels
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps;
    function draw(kind, w, h, data, wset, opts) {
      document.querySelectorAll(".ws-host").forEach((x) => x.remove());
      const host = document.createElement("div");
      host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
      document.body.appendChild(host);
      const env = { data: Object.assign({}, data, wset ? { wset: { x: wset } } : {}) };
      const root = window.CouchWidgets.render({ id: "x", kind, opts: opts || {}, w, h }, env);
      host.appendChild(root);
      const R = root.getBoundingClientRect(), leaves = [];
      [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
        if (el.closest("svg")) return;
        const nodes = [...el.childNodes].filter((nd) => nd.nodeType === 3 && nd.textContent.trim());
        if (!nodes.length) return;
        const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || +cs.opacity === 0) return;
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
        leaves.push({ t: t.replace(/\s+/g, " ").trim(), seen: t.slice(0, vis).replace(/\s+/g, " ").trim(), fit: !gone && !ell && !(clamp && el.scrollHeight > el.clientHeight + 1) });
      });
      const svgs = [...root.querySelectorAll("svg")].filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && r.right > R.left && r.left < R.right && r.bottom > R.top && r.top < R.bottom; })
        .map((s) => s.innerHTML.replace(/ id="[^"]*"/g, "").replace(/url\(#[^)]*\)/g, "").replace(/href="#[^"]*"/g, "").length);
      const look = [root].concat([...root.querySelectorAll("*")]).filter((el) => !el.closest("svg")).map((el) => {
        const st = el.style, cs = getComputedStyle(el);
        if (+cs.opacity === 0) return "";
        return [st.backgroundImage, st.backgroundSize, st.background && /#|rgb/.test(st.background) ? cs.backgroundColor : "", st.backgroundColor].filter(Boolean).join(",");
      }).filter(Boolean);
      return { empty: root.getAttribute("data-empty") === "1", seen: leaves.map((l) => l.seen).join(" | "),
        cut: leaves.filter((l) => !l.fit).map((l) => '"' + l.t + '" shows "' + l.seen + '"'),
        sig: leaves.map((l) => l.seen).join(" | ") + " || " + svgs.join(";") + " || " + look.join(" ; ") };
    }
    // [label, wset, data, vs label, design opts]
    const V = {
      agenda: [["default", {}, "agenda"], ["calendars main", { calendars: "main" }, "agenda"], ["calendars bookings", { calendars: "bookings" }, "agenda"],
        ["calendars bookings vs main", { calendars: "bookings" }, "agenda", "calendars main"], ["days week", { days: "week" }, "agenda"],
        ["default clear", {}, "agendaClear"], ["days today (clear day)", { days: "today" }, "agendaClear", "default clear"], ["days week (clear day)", { days: "week" }, "agendaClear", "default clear"],
        ["default far", {}, "agendaFar"], ["days week (far)", { days: "week" }, "agendaFar", "default far"]],
      people: [["default", {}, "people"], ["who Jordan", { who: ["c"] }, "people"], ["names off", { names: false }, "people"]],
      note: [["default", {}, "note"], ["byline off", { byline: false }, "note"]],
      list: [["default", {}, "list"], ["list Jobs", { list: "Jobs" }, "list"], ["done off", { done: false }, "list"]],
      guide: [["default", {}, "guide"], ["sections Bins", { sections: ["Bins"] }, "guide"], ["sections Bins+Around", { sections: ["Bins", "Around here"] }, "guide"]],
      welcome: [["default", {}, "welcome"], ["text Hi there", { text: "Hi there" }, "welcome"], ["sub line", { sub: "Make yourself at home" }, "welcome"], ["source calendar", { source: "calendar" }, "welcome"],
        ["times off (source calendar)", { source: "calendar", times: false }, "welcome", "source calendar"]],
      memory: [["default", {}, "memWeek"], ["range week", { range: "week" }, "memWeek"], ["default both", {}, "memBoth"], ["ago off", { ago: false }, "memBoth", "default both"]],
      screentime: [["default", {}, "screen"], ["appcount 0", { appcount: 0 }, "screen"], ["appcount 3", { appcount: 3 }, "screen"], ["appcount 5", { appcount: 5 }, "screen"], ["appcount 5 vs 3", { appcount: 5 }, "screen", "appcount 3"]],
      wifi: [["default", {}, "wifi"], ["hidepass on", { hidepass: true }, "wifi"]],
      card: [["default", {}, "card"], ["label Bins", { label: "Bins" }, "card"], ["text Back at 5", { text: "Back at 5" }, "card"], ["live Pool", { live: "Pool" }, "card"], ["live Solar", { live: "Solar today" }, "card"], ["live Solar vs Pool", { live: "Solar today" }, "card", "live Pool"]],
      photo: [["default", {}, "photo"], ["photo next", { photo: pick1 }, "photo"], ["photo third", { photo: pick3 }, "photo"], ["photo third vs next", { photo: pick3 }, "photo", "photo next"], ["fit contain", { fit: "contain" }, "photo"], ["image in widget", {}, "photo", "default", { image: "demo/art.jpg" }]],
      slideshow: [["default", {}, "photo"], ["seconds 10", { seconds_each: 10 }, "photo"], ["seconds 60", { seconds_each: 60 }, "photo"], ["seconds 300", { seconds_each: 300 }, "photo"], ["shuffle on", { shuffle: true }, "photo"]],
      mosaic: [["default", {}, "photo"], ["count 3", { count: 3 }, "photo"], ["count 4", { count: 4 }, "photo"], ["count 5", { count: 5 }, "photo"], ["count 4 vs 3", { count: 4 }, "photo", "count 3"], ["count 5 vs 4", { count: 5 }, "photo", "count 4"]],
      artframe: [["default", {}, "photo"], ["photo picked", { photo: pickA }, "photo"], ["mat black", { mat: "#1d1b18" }, "photo"], ["mat white", { mat: "#ffffff" }, "photo"], ["mat grey", { mat: "#8e8e93" }, "photo"], ["image in widget", {}, "photo", "default", { image: "demo/art.jpg" }]]
    };
    const res = [];
    for (const kind of Object.keys(V)) {
      for (const s of C.get(kind).sizes.s) {
        const w = NAMED[s][0] * 100 - 40, h = NAMED[s][1] * 100 - 40, got = {};
        for (const [label, set, dk, vs, opts] of V[kind]) {
          const d = draw(kind, w, h, D[dk], set, opts);
          got[label] = d;
          const ref = got[vs || "default"], isRef = label.startsWith("default");
          res.push({ kind, s, w, h, label, vs: vs || "default", isRef, same: !isRef && d.sig === ref.sig, empty: d.empty, cut: d.cut, seen: d.seen });
        }
      }
    }
    return res;
  });
  ok(!errs.length, "no page errors: " + errs.join(" / "));
  for (const r of out) {
    const at = r.kind + " " + r.s + " (" + r.w + " x " + r.h + ") " + r.label;
    cases.all++;
    ok(!r.empty || EMPTY_OK[r.kind + " " + r.label], at + ": draws the widget, not an empty card");
    ok(!r.cut.length, at + ": no words cut: " + r.cut.join("; "));
    if (!r.isRef) {
      const key = r.kind + " " + r.s + " " + r.label, why = SAME[key];
      if (why) { ok(r.same, at + ": draws the same as " + r.vs + " (" + why + "): " + r.seen); cases.same++; usedSame[key] = 1; }
      else ok(!r.same, at + ": changes what shows against " + r.vs + ": " + r.seen);
    }
    lines.push([r.kind, r.s + " " + r.w + "x" + r.h, r.label, r.same ? "SAME(vs " + r.vs + ")" : "", r.empty ? "EMPTY" : "", r.cut.length ? "CUT[" + r.cut.join("; ") + "]" : "", "=> " + r.seen.slice(0, 200)].filter(Boolean).join(" ; "));
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
  if (process.env.WS2_VISIBLE_LOG) fs.writeFileSync(process.env.WS2_VISIBLE_LOG, lines.join("\n"));
}
// every reason in SAME is a real case (none left over from an older layout)
Object.keys(SAME).forEach((k) => ok(usedSame[k], "SAME names a real case: " + k));
ok(Object.keys(SAME).length === 24, "24 setting x size cases draw the same, each with its reason");
console.log("  " + cases.all + " kind x size x setting cases, " + cases.same + " of them the same by design (" + Object.keys(SAME).length + " named)");
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
