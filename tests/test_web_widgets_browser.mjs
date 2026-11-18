// The web widgets (Headlines, Scores, Markets, Commute, Picks) in a real browser at 1920x1080:
//  1. end to end: a design with the widget, the TV asks its source (answered here from the saved
//     samples in tests/fixtures/widgets-data, never the real service), the widget shows the real
//     answer, OK opens its layer with more of it, Back closes it;
//  2. every size widget-caps.js lists, with real data, while asking, failed, and on a TV with no
//     relay: nothing past its box, no words under 23 px, never the designer's demo on a TV.
// Shots go to $SHOTS (default: the system temp folder).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_web_widgets_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "tests/fixtures/widgets-data");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "web-widgets-"));
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
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const fix = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const rect = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });

// what each widget's sources answer in this test (the relay's JSON, or the service's own JSON)
const ANSWERS = {
  relay: (src, id) => {
    if (src === "news") return { ok: true, src, id, text: fix(id === "bbc" ? "rss-bbc.xml" : "rss-abc-top.xml") };
    if (src === "stocks") return { ok: true, src, id, text: fix("yahoo-spark.json") };
    return null;
  }
};
// per widget: the design's widget, what proves the real answer is drawn, its layer
const CASES = [
  { kind: "news", opts: { feed: "bbc" }, box: [0, 0, 8, 4], says: () => WW.parseRss(fix("rss-bbc.xml"), 12)[0].title, layer: "news" },
  { kind: "sports", opts: { league: "nba", team: "Knicks" }, box: [0, 0, 8, 4], routes: [["https://site.api.espn.com/**", "espn-nba.json"]], says: () => "Knicks", layer: "sports" },
  { kind: "stocks", opts: { tickers: ["BHP.AX", "^AXJO"] }, box: [0, 0, 4, 6], says: () => "$54.34", layer: "stocks" }
];
const KINDS = CASES.map((c) => c.kind);
const WW = createRequire(import.meta.url)("../tv-home/web/widget-web.js");

const browser = await chromium.launch();
async function home(c) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.asked = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.route("**/api/webdata?*", (route) => {
    const u = new URL(route.request().url()); page.asked.push("relay " + u.searchParams.get("src") + ":" + u.searchParams.get("id"));
    const a = ANSWERS.relay(u.searchParams.get("src"), u.searchParams.get("id"));
    route.fulfill({ status: a ? 200 : 400, contentType: "application/json", body: JSON.stringify(a || { ok: false, error: "unknown source" }) });
  });
  for (const [pat, file] of c.routes || []) await page.route(pat, (route) => { page.asked.push(route.request().url()); route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: fix(file) }); });
  const R = rect(...c.box);
  const design = { v: 1, background: { colour: "#26303f" }, objects: [Object.assign({ id: "w0", type: "widget", kind: c.kind, x: R.x, y: R.y, w: R.w, h: R.h }, c.opts ? { opts: c.opts } : {}),
    { id: "w1", type: "widget", kind: "app", x: rect(16, 0, 2, 2).x, y: rect(16, 0, 2, 2).y, w: 160, h: 160, opts: { apps: ["com.netflix.ninja"] } }] };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate(([d, pre]) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); Object.keys(pre || {}).forEach((k) => localStorage.setItem(k, JSON.stringify(pre[k]))); }, [design, c.kept]);
  await page.goto(BASE + "?mock=1&design=local&weblive=1" + (c.q || ""));
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDetail);
  return page;
}
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 300); };
const widgetText = (page) => page.evaluate(() => (document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || "");

console.log("Running web widgets browser tests (shots in " + SHOTS + ")...");

// 1. end to end
for (const c of CASES) {
  const page = await home(c), want = c.says();
  const got = await page.waitForFunction((w) => ((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || "").indexOf(w) >= 0, want, { timeout: 8000 }).then(() => true, () => false);
  ok(got, c.kind + ": the widget shows the real answer (" + want + "); asked " + page.asked.join(", ") + "; it says " + (await widgetText(page)).slice(0, 120));
  ok(page.asked.length >= 1 && page.asked.length <= (c.maxAsks || 1), c.kind + ": one request for the widget (" + page.asked.length + ")");
  await page.screenshot({ path: path.join(SHOTS, c.kind + "-home.png") });
  await page.evaluate(() => window.CouchDesign.nav.move(-1, 0));
  ok((await page.evaluate(() => window.CouchDesign.nav.current().id)) === "w0", c.kind + ": the remote reaches the widget");
  await press(page, "Enter", 800);
  const cur = await page.evaluate(() => window.CouchDetail.current());
  ok(cur && cur.name === c.layer, c.kind + ": OK opens " + c.layer + " (got " + (cur && cur.name) + ")");
  const layerText = await page.evaluate(() => (document.querySelector(".cwd-panel") || {}).textContent || "");
  ok(layerText.indexOf(want) >= 0, c.kind + ": the layer shows the real answer too");
  ok(await page.evaluate(() => { const p = document.querySelector(".cwd-panel"), b = p.getBoundingClientRect(); return [].every.call(p.querySelectorAll("*"), (e) => { const r = e.getBoundingClientRect(); return !r.width || (r.right <= b.right + 2 && r.bottom <= b.bottom + 2); }); }), c.kind + ": nothing in the layer is past the screen");
  await page.screenshot({ path: path.join(SHOTS, c.kind + "-layer.png") });
  await press(page, "Escape", 600);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), c.kind + ": Back closes the layer");
  ok(page.errors.length === 0, c.kind + ": no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}

// 2. every size, every state
{
  const page = await home({ kind: "clock", box: [0, 0, 4, 2] });
  const fixtures = {}; ["rss-abc-top.xml", "rss-bbc.xml", "yahoo-spark.json", "espn-nrl.json", "espn-afl.json", "espn-nba.json", "espn-cricket.json", "osrm-route.json"].forEach((f) => { fixtures[f] = fix(f); });
  const bad = await page.evaluate(([F, KINDS]) => {
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, WW = window.CouchWidgetWeb, at = Date.now();
    const good = { news: { abc: { ok: true, at, v: WW.parseRss(F["rss-abc-top.xml"], 12) } }, sports: { nrl: { ok: true, at, v: WW.parseScores(JSON.parse(F["espn-nba.json"]), "nba") } },
      stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: WW.parseSpark(F["yahoo-spark.json"]) } } };
    // the states a web widget can be in on a TV, by the data it is handed
    const states = { real: good, asking: {}, failed: null, relay: null, stale: null };
    const failWith = (err) => { const o = {}; Object.keys(good).forEach((s) => { o[s] = {}; Object.keys(good[s]).forEach((id) => { o[s][id] = { ok: false, at, err }; }); }); return o; };
    states.failed = failWith("failed"); states.relay = failWith("relay");
    states.stale = JSON.parse(JSON.stringify(good)); Object.keys(states.stale).forEach((s) => Object.keys(states.stale[s]).forEach((id) => { states.stale[s][id].stale = true; }));
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99";
    document.body.appendChild(host);
    const out = []; let count = 0;
    KINDS.forEach((kind) => {
      const s = C.get(kind).sizes, list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat([["min", s.min[0], s.min[1]]]);
      list.forEach(([id, w, h]) => ["designer"].concat(Object.keys(states)).forEach((st) => {
        while (host.firstChild) host.removeChild(host.firstChild);
        const env = st === "designer" ? { demo: true, designer: true } : { data: { bridge: true, web: states[st] } };
        const el = W.render({ id: "t", kind, w: w * 100 - 40, h: h * 100 - 40 }, env);
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        const b = el.getBoundingClientRect();
        if (st === "real" && el.getAttribute("data-empty")) out.push(kind + " " + id + " real: drew an empty state");
        if (st !== "designer" && /Coastal highway|Titans|Bay of Fires/.test(el.textContent)) out.push(kind + " " + id + " " + st + ": demo words on a TV");
        el.querySelectorAll("*").forEach((node) => {
          if (node.classList.contains("cw-bg")) return;
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.right > b.right + 2 || r.bottom > b.bottom + 2 || r.left < b.left - 2 || r.top < b.top - 2)) {
            let p = node.parentElement, seen = true;
            while (p && p !== host) { if (p !== node && getComputedStyle(p).overflow === "hidden") { const q = p.getBoundingClientRect(); if (q.right <= b.right + 2 && q.bottom <= b.bottom + 2 && q.left >= b.left - 2 && q.top >= b.top - 2) { seen = false; break; } } p = p.parentElement; }
            if (seen) out.push(kind + " " + id + " " + st + ": " + (typeof node.className === "string" ? node.className : node.tagName) + " past the box");
          }
          if ([].some.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim())) { const fs = parseFloat(getComputedStyle(node).fontSize); if (fs > 0 && fs < 23) out.push(kind + " " + id + " " + st + ": words at " + fs + " px"); }
        });
      }));
    });
    host.remove();
    return { out, count };
  }, [fixtures, KINDS]);
  ok(bad.count >= 25, "drew " + bad.count + " web widget boxes");
  ok(bad.out.length === 0, "every size and state reads and fits:\n  " + bad.out.slice(0, 30).join("\n  "));
  // a sheet of every size with real data, one per widget, for a person to look at
  for (const one of KINDS) {
  await page.evaluate(([F, KINDS]) => {
    document.querySelectorAll(".sheet-host").forEach((e) => e.remove());
    const NAMED = { tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, WW = window.CouchWidgetWeb, at = Date.now();
    const web = { news: { abc: { ok: true, at, v: WW.parseRss(F["rss-abc-top.xml"], 12) } }, sports: { nrl: { ok: true, at, v: WW.parseScores(JSON.parse(F["espn-nba.json"]), "nba") } },
      stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: WW.parseSpark(F["yahoo-spark.json"]) } } };
    const host = document.createElement("div");
    host.className = "sheet-host"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
    document.body.appendChild(host);
    let x = 40, y = 40, rowH = 0;
    KINDS.forEach((kind) => C.get(kind).sizes.s.forEach((id) => {
      const w = NAMED[id][0] * 100 - 40, h = NAMED[id][1] * 100 - 40;
      if (x + w > 1880) { x = 40; y += rowH + 30; rowH = 0; }
      const el = W.render({ id: "t", kind, w, h }, { data: { bridge: true, web } });
      el.style.position = "absolute"; el.style.left = x + "px"; el.style.top = y + "px";
      host.appendChild(el); x += w + 30; rowH = Math.max(rowH, h);
    }));
  }, [fixtures, [one]]);
  await page.screenshot({ path: path.join(SHOTS, "sizes-" + one + ".png") });
  }
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
