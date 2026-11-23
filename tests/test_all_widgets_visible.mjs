// Every widget kind, the owner's rule in one run: every setting really changes what you see at every size
// the kind lists, nothing cut, no empty card, no demo data on a real TV, and each widget's settings show only
// while it is on the screen. It runs each group's visible test (the method of test_ws2_weather_visible.mjs)
// and the one for the rest, then two checks of its own over every kind in widget-caps.js:
//  A. coverage: every kind is drawn by one of the visible tests;
//  B. on the real TV page (?mock=1&ha=1, a design put on it in batches): a kind's settings show in Home
//     settings, Designs, Widgets on this home and in what the phone reads (tv.atHomeRead) only while the
//     kind is on the design;
//  C. with nothing set up and not Couch TV Studio's preview, no kind shows the preview's demo readings.
// Prints one table: kind | group | real data source | settings (keys) | cases | changed | same by design
// (reasons) | cut | empty | pass. ALLW_TABLE=<file> also writes the owner's table (plain English).
// Needs Playwright (Chromium):
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_all_widgets_visible.mjs
// ALLW_ONLY=weather,rest runs only those groups; ALLW_LOGS=<folder> keeps each test's log there.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const CAPS = require("../tv-home/web/widget-caps.js");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
const LOGS = process.env.ALLW_LOGS || fs.mkdtempSync(path.join(os.tmpdir(), "allw-"));
fs.mkdirSync(LOGS, { recursive: true });

// the visible tests, one per group ("live" draws its kinds at every size with DUMP=1)
const GROUPS = [
  ["clocks", "test_ws2_clocks_visible.mjs"], ["weather", "test_ws2_weather_visible.mjs"], ["home", "test_ws2_home_visible.mjs"],
  ["watching", "test_ws2_watching_visible.mjs"], ["live", "test_ws2_live_sizes.mjs"], ["rest", "test_widgets_visible_rest.mjs"]
].filter((g) => !process.env.ALLW_ONLY || process.env.ALLW_ONLY.split(",").indexOf(g[0]) >= 0);
const KINDS = CAPS.kinds();
const row = {};
KINDS.forEach((k) => { row[k] = { kind: k, group: "", cases: 0, changed: 0, sameDefault: 0, sameReason: 0, reasons: 0, cut: 0, empty: 0, fails: [], ran: false }; });
const groupRes = [];

// the SAME reasons a test names ("kind size label": "why"), read from its source
function sameOf(src) {
  const m = src.match(/const SAME = \{([\s\S]*?)\n\};/);
  const out = {};
  if (m) for (const l of m[1].split("\n")) { const x = l.match(/^\s*"([^"]+)":\s*"/); if (x) out[x[1].replace(/ @ [\d:]+$/, "")] = 1; }
  return out;
}
const kindOf = (s) => { const w = String(s).split(" ")[0]; return row[w] ? w : null; };

for (const [group, file] of GROUPS) {
  const f = path.join(ROOT, "tests", file);
  if (!fs.existsSync(f)) { groupRes.push({ group, file, status: "MISSING" }); continue; }
  const log = path.join(LOGS, group + ".log");
  const env = Object.assign({}, process.env, { WS2_SOFT: "1", WS2_VISIBLE_LOG: log, DUMP: group === "live" ? "1" : "" });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { env, cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60000 });
  const out = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(LOGS, group + ".out"), out);
  const SAME = sameOf(fs.readFileSync(f, "utf8"));
  // the failures the test listed (WS2_SOFT), or the one it stopped on
  let fails = [];
  const fm = out.match(/\d+ FAILED:\n([\s\S]*)$/);
  if (fm) fails = fm[1].split("\n").filter((l) => l.trim());
  else if (r.status !== 0) { const am = out.match(/AssertionError[^:]*: ([^\n]+)/); fails = [am ? am[1] : out.trim().split("\n").slice(-3).join(" / ")]; }
  groupRes.push({ group, file, status: r.status === 0 ? "pass" : "FAIL", fails: fails.length, secs: Math.round((Date.now() - t0) / 1000), summary: (out.match(/^ {2}\d+ kind[^\n]*/m) || out.match(/^drawn: [^\n]*/m) || [""])[0].trim() });
  fails.forEach((m) => {
    const k = kindOf(m) || kindOf((m.match(/SAME names a real case: (\S+)/) || [])[1] || "");
    if (k) row[k].fails.push(group + ": " + m);
  });
  // what each case showed, from the test's own log (live: its DUMP lines)
  const text = group === "live" ? out : (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "");
  for (const l of text.split("\n")) {
    if (!l.trim() || l.startsWith("====")) continue;
    const parts = l.split(" ; ");
    let kind, size, label, flags;
    if (group === "live") {
      const head = parts[0].match(/^(\S+)(?: \(([^)]*)\))? (\S+) (\d+x\d+) (.*)$/);
      if (!head || !row[head[1]]) continue;
      [kind, size, label] = [head[1], head[3], head[5]];
      flags = parts.slice(1);
    } else {
      kind = parts[0]; if (!row[kind]) continue;
      size = (parts[1] || "").split(" ")[0]; label = parts[2] || ""; flags = parts.slice(3);
      if (label === "nothing set up") continue;
    }
    const R = row[kind];
    R.ran = true; R.group = R.group || group;
    R.cases++;
    const isRef = /^default/.test(label);
    const same = flags.some((x) => /^SAME/.test(x)), cut = flags.some((x) => /^CUT\[|^SPILL/.test(x)), empty = flags.some((x) => x === "EMPTY");
    if (cut) R.cut++;
    if (empty) R.empty++;
    if (isRef) continue;
    if (same) { if (SAME[kind + " " + size + " " + label] || (group === "live" && kind === "news" && /^count/.test(label))) R.sameReason++; }
    else if (/\(same|same as home|= watcher/.test(label)) R.sameDefault++;
    else R.changed++;
  }
  Object.keys(SAME).forEach((k) => { const kk = kindOf(k); if (kk) row[kk].reasons++; });
}

// ---------------- A, B and C in a browser of our own ----------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "qr.js", "athome.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/tv-home/web/allw.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const extra = [];
const NAME = {};
KINDS.forEach((k) => { NAME[k] = CAPS.get(k).name; row[k].onScreen = { home: null, phone: null, gone: null }; });
try {
  // C. nothing set up, not the preview: never the demo readings
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(ORIGIN + "/tv-home/web/allw.html");
    await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps);
    const out = await page.evaluate((KINDS) => {
      const PX = { line: [360, 60], wline: [760, 60], tile: [160, 160], wtile: [360, 160], small: [360, 360], tall: [360, 560], medium: [760, 360], wide: [1160, 360], large: [760, 760], xl: [1160, 760], hero: [1760, 660], full: [1760, 960] };
      const C = window.CouchWidgetCaps, res = {};
      const words = (t) => new Set((t.match(/[A-Za-z][A-Za-z']{3,}|\d+(?:[.,:]\d+)+/g) || []).map((x) => x.toLowerCase()));
      for (const kind of KINDS) {
        const sz = C.get(kind).sizes, s = (sz.s || []).filter((x) => PX[x]).slice(-1)[0], [w, h] = s ? PX[s] : [760, 160];
        const draw = (env) => {
          document.querySelectorAll(".allw-host").forEach((x) => x.remove());
          const host = document.createElement("div"); host.className = "allw-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
          document.body.appendChild(host);
          const o = { id: "x", kind, opts: {}, w, h };
          if (kind === "stack") o.items = [{ kind: "weather" }, { kind: "keep" }];
          const root = window.CouchWidgets.render(o, env);
          host.appendChild(root);
          return { empty: root.getAttribute("data-empty") === "1", text: root.textContent.replace(/\s+/g, " ").trim() };
        };
        const real = draw({ data: {} }), demo = draw({ demo: true, data: {} });
        // the words only the preview shows: the demo's, less the widget's own words (its name, what it is)
        const own = words([C.get(kind).name, C.get(kind).what, C.get(kind).until || "", (C.get(kind).needs || []).join(" ")].join(" "));
        const rw = words(real.text), only = [...words(demo.text)].filter((x) => rw.has(x) && !own.has(x));
        res[kind] = { s: s || "?", empty: real.empty, real: real.text.slice(0, 140), demo: demo.text.slice(0, 140), shared: only };
      }
      return res;
    }, KINDS);
    for (const k of KINDS) {
      const d = out[k];
      // a demo word on the real TV: only a fault when the real drawing is not its own setup card and the demo
      // drew something else (a clock reads the TV's clock in both)
      const bad = !d.empty && d.real !== d.demo ? d.shared.filter((x) => !/^\d{1,2}[:.]\d{2}$/.test(x)) : [];
      row[k].demo = d.empty ? "setup card" : d.real === d.demo ? "same as preview (own data)" : bad.length ? "SHOWS " + bad.join(", ") : "own words";
      row[k].demoBad = bad;
      if (bad.length) row[k].fails.push("C: with nothing set up it shows the preview's " + bad.join(", ") + " (" + d.s + "): " + d.real);
    }
    if (errs.length) extra.push("C: page errors: " + errs.join(" / "));
    await page.close();
  }
  // B. settings show only while the kind is on the design
  {
    const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    tv.on("pageerror", (e) => errs.push(String(e)));
    await tv.route(/open-meteo|espn\.com|project-osrm|finance\.yahoo|abc\.net\.au|bbci\.co\.uk|rnz\.co\.nz/, (r) => r.abort());
    await tv.addInitScript(() => { window.TVOS = Object.assign(window.TVOS || {}, { batteries: () => JSON.stringify({ need: "", devices: [{ kind: "remote", name: "Remote", level: 12 }] }) }); });
    const press = async (k, ms) => { await tv.keyboard.press(k); await tv.waitForTimeout(ms || 160); };
    // the kinds in batches that fit on one screen at their smallest size, packed in rows
    const batches = [];
    let cur = [], x = 40, y = 40, rowH = 0;
    for (const k of KINDS) {
      const m = CAPS.get(k).sizes.min || [2, 2], w = m[0] * 100 - 40, h = m[1] * 100 - 40;
      if (x + w > 1880) { x = 40; y += rowH + 40; rowH = 0; }
      if (y + h > 1040) { batches.push(cur); cur = []; x = 40; y = 40; rowH = 0; }
      const opts = k === "bins" ? { weekday: 2 } : k === "app" ? { apps: ["netflix"] } : {};
      cur.push({ id: "aw" + KINDS.indexOf(k), type: "widget", kind: k, x, y, w, h, opts }); x += w + 40; rowH = Math.max(rowH, h);
    }
    if (cur.length) batches.push(cur);
    // a smart stack holds widgets of its batch (they are on screen inside it)
    batches.forEach((b) => b.forEach((ob) => { if (ob.kind === "stack") ob.items = b.filter((x) => x.kind !== "stack" && String(CAPS.get(x.kind).sizes.min) === "2,2").slice(0, 2).map((x) => ({ kind: x.kind, opts: x.opts })); }));
    const design = (objs) => ({ v: 1, background: { colour: "#1d3a4f" },
      elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } }, objects: objs });
    await tv.goto(ORIGIN + "/tv-home/web/index.html?mock=1&reset=1");
    for (let bi = 0; bi < batches.length; bi++) {
      await tv.evaluate((dz) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, design(batches[bi]));
      await tv.goto(ORIGIN + "/tv-home/web/index.html?mock=1&ha=1&design=local");
      await tv.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on(), null, { timeout: 20000 });
      await tv.waitForTimeout(1500);
      const phone = await tv.evaluate(() => { const v = window.tv.atHomeRead(); return ((v && v.design && v.design.widgets) || []).map((w) => w.kind); });
      // Home settings, Designs: the widgets on this home
      await tv.evaluate(() => window.tv.settingsKey()); await tv.waitForTimeout(250); await press("Enter", 500);
      const secs = await tv.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
      const i = secs.indexOf("Designs");
      for (let k = 0; k < 4 && await tv.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press("ArrowLeft", 120);
      const at = await tv.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
      for (let k = 0; k < Math.abs(i - at); k++) await press(i > at ? "ArrowDown" : "ArrowUp", 80);
      await tv.waitForTimeout(300);
      const rows = (await tv.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()))).join(" | ");
      for (let k = 0; k < 6 && await tv.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press("Escape", 1000);
      const on = batches[bi].map((o) => o.kind).concat(...batches[bi].map((o) => (o.items || []).map((x) => x.kind)));
      for (const k of KINDS) {
        const inHome = rows.indexOf(NAME[k] + ", ") >= 0 || rows.indexOf(NAME[k] + ",") >= 0, inPhone = phone.indexOf(k) >= 0, S = row[k].onScreen;
        if (on.indexOf(k) >= 0) { S.home = inHome; S.phone = inPhone; }
        else if (inHome || inPhone) S.gone = (S.gone || []).concat([(inHome ? "Home settings" : "") + (inPhone ? " phone" : "") + " in batch " + (bi + 1)]);
      }
      extra.push("B: batch " + (bi + 1) + " (" + on.length + " kinds): Home settings lists " + KINDS.filter((k) => rows.indexOf(NAME[k] + ",") >= 0).length + ", the phone reads " + phone.length);
    }
    for (const k of KINDS) {
      const S = row[k].onScreen, none = !(CAPS.settings(k) || []).some((s) => s.pre !== false);
      row[k].onScreenOk = S.home === true && S.phone === true && !S.gone;
      if (!row[k].onScreenOk) row[k].fails.push("B: settings on screen only while on the design: " + (none ? "it has no setting switched on (every one is marked for later), so there is nothing to show; " : "") +
        "Home settings " + S.home + ", phone " + S.phone + (S.gone ? ", still listed off the design: " + S.gone.join("; ") : ""));
    }
    if (errs.length) extra.push("B: TV page errors: " + errs.join(" / "));
    await tv.close();
  }
} finally {
  await browser.close();
  server.close();
}

// A. coverage
const uncovered = KINDS.filter((k) => !row[k].ran);
uncovered.forEach((k) => row[k].fails.push("A: no visible test draws it"));

// ---------------- the table ----------------
// a key marked for later (pre false: not switched on yet) has a star
const setKeys = (k) => (CAPS.settings(k) || []).map((s) => s.key + (s.pre === false ? "*" : ""));
const src = (k) => (CAPS.get(k).needs || []).join("; ");
const pass = (k) => !row[k].fails.length;
const head = ["kind", "group", "real data source", "settings (keys)", "cases", "changed", "same by design (reasons)", "cut", "empty", "demo on a real TV", "only on screen", "pass"];
const lines = [head.join(" | ")];
for (const k of KINDS) {
  const r = row[k];
  lines.push([k, r.group || "-", src(k), setKeys(k).join(", "), r.cases, r.changed, (r.sameReason + r.sameDefault) + " (" + r.reasons + " reasons, " + r.sameDefault + " where the value is the default)", r.cut, r.empty, r.demo, r.onScreenOk ? "yes" : "NO", pass(k) ? "pass" : "FAIL"].join(" | "));
}
console.log(lines.join("\n"));
console.log("\nGroups:");
groupRes.forEach((g) => console.log("  " + g.group + " (" + g.file + "): " + g.status + (g.fails ? ", " + g.fails + " failures" : "") + (g.secs != null ? ", " + g.secs + " s" : "") + (g.summary ? "; " + g.summary : "")));
extra.forEach((e) => console.log("  " + e));
const failing = KINDS.filter((k) => !pass(k));
const T = { kinds: KINDS.length, covered: KINDS.length - uncovered.length, pass: KINDS.length - failing.length, cases: KINDS.reduce((a, k) => a + row[k].cases, 0) };
console.log("\n" + T.kinds + " kinds, " + T.covered + " drawn by a visible test, " + T.cases + " cases, " + T.pass + " pass, " + failing.length + " fail" + (failing.length ? ": " + failing.join(", ") : ""));
if (failing.length) console.log("\nFailures:\n" + failing.map((k) => k + "\n" + row[k].fails.map((f) => "  - " + f.slice(0, 400)).join("\n")).join("\n"));
if (process.env.ALLW_JSON) fs.writeFileSync(process.env.ALLW_JSON, JSON.stringify({ rows: row, groups: groupRes, extra, totals: T }, null, 1));
if (process.env.ALLW_TABLE) fs.writeFileSync(process.env.ALLW_TABLE, ownerTable());
process.exit(failing.length || groupRes.some((g) => g.status === "MISSING") ? 1 : 0);

// the owner's table: plain English, one row per widget
function ownerTable() {
  const plain = (k) => (CAPS.settings(k) || []).filter((s) => s.pre !== false).map((s) => s.label).join(", ") || "nothing";
  const out = ["# Every widget, checked", "",
    "One row for each widget in Couch TV " + "(" + KINDS.length + " widgets). Tested means a test drew it at every size it comes in, with every setting changed one at a time, and checked that the change shows, that no words are cut off and that it never shows an empty box. Shows only when on screen means its settings appear in Home settings and on the phone only while the widget is on the screen.", "",
    "| Widget | Real data it uses | What you can set | Tested | Shows only when on screen |", "|---|---|---|---|---|"];
  for (const k of KINDS) {
    const r = row[k];
    const tested = !r.ran ? "no" : pass(k) ? "yes, all " + r.cases + " checks pass" : "yes, " + r.cases + " checks, problems below";
    out.push("| " + NAME[k] + " | " + src(k).replace(/\|/g, "/") + " | " + plain(k) + " | " + tested + " | " + (r.onScreenOk ? "yes" : "no") + " |");
  }
  out.push("", T.kinds + " widgets, " + T.covered + " tested, " + T.pass + " with no problems.");
  if (failing.length) {
    out.push("", "## Problems found", "");
    failing.forEach((k) => { out.push("- **" + NAME[k] + "**: " + row[k].fails.length + " checks failed. " + row[k].fails.slice(0, 3).map((f) => f.replace(/^[a-z]+: /, "")).join("; ").slice(0, 600)); });
  }
  return out.join("\n") + "\n";
}
