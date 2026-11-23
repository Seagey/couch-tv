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
  { kind: "sports", opts: { league: "nba", team: "Knicks" }, box: [0, 0, 8, 4], routes: [["https://site.api.espn.com/**", "espn-nba.json"]], says: () => "Knicks", layer: "sports", maxAsks: 2 },
  { kind: "stocks", opts: { tickers: ["BHP.AX", "^AXJO"] }, box: [0, 0, 4, 6], says: () => "$54.34", layer: "stocks" },
  // the commute's places are the TV's own (Home settings), never the design's
  { kind: "commute", opts: { arrive_h: 8, arrive_m: 30 }, box: [0, 0, 8, 4], routes: [["https://router.project-osrm.org/**", "osrm-route.json"]], says: () => "27", layer: "commute",
    kept: { "mock:tvhome.commute": { name: "Parramatta", lat: -33.82, lon: 151.0 }, "mock:tvhome.settings": { s: { place: { name: "Riverside", area: "", lat: -33.87, lon: 151.21, timezone: "Australia/Sydney" } }, updated: Date.now(), pending: false } } },
  // picks come from the preview's own Keep watching (two people, each with their own shows): nothing is asked
  { kind: "picks", box: [0, 0, 12, 4], says: () => "Person 2 is watching", layer: "picks", noAsk: true }
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
  ok(c.noAsk ? page.asked.length === 0 : page.asked.length >= 1 && page.asked.length <= (c.maxAsks || 1), c.kind + ": " + (c.noAsk ? "no request at all" : "one request for the widget") + " (" + page.asked.length + ")");
  await page.screenshot({ path: path.join(SHOTS, c.kind + "-home.png") });
  // the home settles first (Keep watching and the widgets drawn again with what came back)
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.CouchDesign.nav.move(-1, 0));
  ok((await page.evaluate(() => window.CouchDesign.nav.current().id)) === "w0", c.kind + ": the remote reaches the widget");
  await press(page, "Enter", 800);
  const cur =await page.evaluate(() => window.CouchDetail.current());
  ok(cur && cur.name === c.layer, c.kind + ": OK opens " + c.layer + " (got " + (cur && cur.name) + ")");
  const layerText = await page.evaluate(() => (document.querySelector(".cwd-panel") || {}).textContent || "");
  ok(layerText.indexOf(want) >= 0, c.kind + ": the layer shows the real answer too");
  ok(await page.evaluate(() => { const p = document.querySelector(".cwd-panel"), b = p.getBoundingClientRect(); return [].every.call(p.querySelectorAll("*"), (e) => { const r = e.getBoundingClientRect(); return !r.width || (r.right <= b.right + 2 && r.bottom <= b.bottom + 2); }); }), c.kind + ": nothing in the layer is past the screen");
  await page.screenshot({ path: path.join(SHOTS, c.kind + "-layer.png") });
  await press(page, "Escape", 600);
  ok(!(await page.evaluate(() => window.CouchDetail.isOpen())), c.kind + ": Back closes the layer");
  if (c.kind === "picks") {
    // Play on a pick opens that show the way Keep watching does, as its owner's (Person 2)
    await page.evaluate(() => { window.__calls = []; const f = window.MOCK_API; window.MOCK_API = (m, p, b) => { window.__calls.push(m + " " + p + " " + JSON.stringify(b || {})); return f(m, p, b); }; });
    await press(page, "Enter", 800);
    await press(page, "Enter", 800);
    const calls = await page.evaluate(() => window.__calls.join("\n"));
    ok(/POST \/api\/continue\/open .*"who":"person2"/.test(calls), "picks: Play opens the show as Person 2's (" + calls.replace(/\n/g, "; ").slice(0, 200) + ")");
  }
  if (c.kind === "commute") {
    // Home settings, Designs: the Commute rows, with the TV's own places, said to stay on the TV
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300);
    await press(page, "Enter", 400);
    let found = false;
    for (let i = 0; i < 16 && !found; i++) { found = (await page.evaluate(() => document.getElementById("set-head").textContent)) === "Designs"; if (!found) await press(page, "ArrowDown", 120); }
    // the Commute is one row in Widgets on this home (its own settings page), with the place set on this TV
    const listed = await page.evaluate(() => document.getElementById("settings").innerText);
    ok(found && /Widgets on this home/i.test(listed) && /Commute, /.test(listed) && /Where to: Parramatta/.test(listed), "commute: Couch TV Studio lists the Commute in Widgets on this home, Where to Parramatta (" + listed.replace(/\s+/g, " ").slice(0, 600) + ")");
    await press(page, "ArrowRight", 200);
    for (let i = 0; i < 20 && !/^Commute, /.test(await page.evaluate(() => (document.querySelector("#set-rows .srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 100);
    await press(page, "Enter", 400);
    const txt = await page.evaluate(() => document.getElementById("settings").innerText);
    ok(/Where to/.test(txt) && /Parramatta/.test(txt) && /Never in a design, never sent to Couch TV/.test(txt) && /Forget where you drive to/.test(txt), "commute: its page has Where to, the place, kept on the TV, and Forget (" + txt.replace(/\s+/g, " ").slice(0, 400) + ")");
    await page.screenshot({ path: path.join(SHOTS, "commute-settings.png") });
    ok(!/Parramatta/.test(await page.evaluate(() => localStorage.getItem("tvdesigner.design") + localStorage.getItem("mock:tvhome.settings"))), "commute: the place is in neither the design nor the settings the bridge keeps");
  }
  ok(page.errors.length === 0, c.kind + ": no page errors (" + page.errors.join("; ") + ")");
  await page.close();
}

// 1b. the store's off switch: with Scores paused in <store>/v1/config/sources, the TV asks the store
// once, never asks ESPN, and the widget says the feed is paused; the answer is kept for the day
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const asked = [];
  await page.route("**/v1/config/sources", (r) => { asked.push("store"); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ v: 1, paused: ["sports"] }) }); });
  await page.route("https://site.api.espn.com/**", (r) => { asked.push("espn"); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: fix("espn-nba.json") }); });
  const R = rect(0, 0, 8, 4), design = { v: 1, background: { colour: "#26303f" }, objects: [{ id: "w0", type: "widget", kind: "sports", x: R.x, y: R.y, w: R.w, h: R.h, opts: { league: "nba" } }] };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  const url = BASE + "?mock=1&design=local&weblive=1&designstore=" + encodeURIComponent("http://127.0.0.1:" + server.address().port);
  await page.goto(url);
  const said = await page.waitForFunction(() => /This feed is paused/.test((document.querySelector('.cw-o[data-obj="w0"] .cw') || {}).textContent || ""), null, { timeout: 8000 }).then(() => true, () => false);
  await page.waitForTimeout(800);
  ok(said && asked.join() === "store", "paused: the widget says so, the store was asked once and ESPN never (" + asked.join() + ")");
  await page.goto(url); await page.waitForTimeout(2500);
  ok(asked.join() === "store", "a reload the same day asks the store nothing more (" + asked.join() + ")");
  await page.screenshot({ path: path.join(SHOTS, "sports-paused.png") });
  await page.close();
}

// 2. every size, every state, centred: the owner's rule ("each widget fits in each container, things
// are not cut off, icons and the rest centred unless changed in the designer"). For each kind, each
// size widget-caps.js allows, and each state (the designer's demo, real data, hard data with long
// words, big numbers and Hindi, still asking, failed, no relay, stale, no place), drawn on screen and
// given time to fit: no element clips its words (scrollWidth or scrollHeight past its own box), nothing
// is past the widget's box, no words under 23 px, the content is centred both ways (or to the left
// with opts.align "left"), and a TV never shows the designer's demo.
{
  const page = await home({ kind: "clock", box: [0, 0, 4, 2] });
  const fixtures = {}; ["rss-abc-top.xml", "rss-bbc.xml", "yahoo-spark.json", "espn-nba.json", "osrm-route.json"].forEach((f) => { fixtures[f] = fix(f); });
  const res = await page.evaluate(async ([F, KINDS]) => {
    const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
    const C = window.CouchWidgetCaps, W = window.CouchWidgets, WW = window.CouchWidgetWeb, at = Date.now();
    const HINDI = "भारत में आज भारी बारिश की चेतावनी, कई राज्यों में स्कूल बंद रहेंगे और यातायात प्रभावित";
    const LONG = "Supercalifragilisticexpialidociousnessesandmore";
    const real = { news: { abc: { ok: true, at, v: WW.parseRss(F["rss-abc-top.xml"], 12) } }, sports: { nrl: { ok: true, at, v: WW.parseScores(JSON.parse(F["espn-nba.json"]), "nba") } },
      stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: WW.parseSpark(F["yahoo-spark.json"]) } }, commute: { K: { ok: true, at, v: WW.parseRoute(JSON.parse(F["osrm-route.json"])) } } };
    const hardGames = JSON.parse(JSON.stringify(real.sports.nrl.v));
    hardGames.games[0].teams[0].name = "Wolverhampton Wanderers"; hardGames.games[0].teams[1].name = "मुंबई इंडियंस"; hardGames.games[0].teams[0].score = "460/7 (105.5 ov, target 529)"; hardGames.games[0].teams[1].score = "1000";
    hardGames.games[1].teams[0].name = LONG; hardGames.games[1].state = "in"; hardGames.games[1].detail = "Australia require another 224 runs with 7 wickets and 27.5 overs remaining";
    const hardQuotes = JSON.parse(JSON.stringify(real.stocks["^AXJO,AUDUSD=X,BTC-AUD"].v));
    hardQuotes.quotes["^AXJO"].name = "रिलायंस इंडस्ट्रीज"; hardQuotes.quotes["^AXJO"].change = -123.45; hardQuotes.quotes["^AXJO"].price = 1234567.89;
    hardQuotes.quotes["BTC-AUD"].name = LONG; hardQuotes.quotes["BTC-AUD"].price = 98765432.1;
    const hard = { news: { abc: { ok: true, at, v: [{ title: HINDI, at: at - 60000 }, { title: LONG + " " + LONG + " is a very long word", at: at - 3600000 }, { title: "A headline of one hundred and sixty letters that goes on and on about the council meeting where the budget for the new pool was argued over for hours", at: at - 7200000 }].concat(real.news.abc.v) } },
      sports: { nrl: { ok: true, at, v: hardGames } }, stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: hardQuotes } }, commute: { K: { ok: true, at, v: { minutes: 1234, km: 12345.6 } } } };
    const commute = { from: { name: "Riverside" }, to: { name: "Parramatta" }, key: "K" };
    const hardCommute = { from: { name: "Riverside" }, to: { name: "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch" }, key: "K" };
    const failWith = (err) => { const o = {}; Object.keys(real).forEach((s) => { o[s] = {}; Object.keys(real[s]).forEach((id) => { o[s][id] = { ok: false, at, err }; }); }); return o; };
    const stale = JSON.parse(JSON.stringify(real)); Object.keys(stale).forEach((s) => Object.keys(stale[s]).forEach((id) => { stale[s][id].stale = true; }));
    const STATES = {
      designer: () => ({ demo: true, designer: true }),
      real: () => ({ data: { bridge: true, web: real, commute } }),
      hard: () => ({ data: { bridge: true, web: hard, commute: hardCommute } }),
      asking: () => ({ data: { bridge: true, web: {}, commute } }),
      failed: () => ({ data: { bridge: true, web: failWith("failed"), commute } }),
      relay: () => ({ data: { bridge: true, web: failWith("relay"), commute } }),
      empty: () => ({ data: { bridge: true, web: failWith("empty"), commute } }),
      stale: () => ({ data: { bridge: true, web: stale, commute } }),
      noplace: () => ({ data: { bridge: true, web: real, commute: { from: commute.from, to: null, key: null } } }),
      paused: () => ({ data: { bridge: true, web: failWith("paused"), commute } })
    };
    const OPTS = { commute: { arrive_h: 8, arrive_m: 30, label: "To the school on the other side of town" }, news: { label: "Headlines from the national broadcaster" }, sports: { team: "Knicks" }, stocks: {} };
    const host = document.createElement("div");
    host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99";
    document.body.appendChild(host);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const out = []; let count = 0, centred = 0;
    for (const kind of KINDS) {
      const s = C.get(kind).sizes, list = s.s.map((id) => [id, NAMED[id][0], NAMED[id][1]]).concat([["min", s.min[0], s.min[1]]]);
      for (const [id, w, h] of list) for (const st of Object.keys(STATES)) for (const align of ["", "left"]) {
        if (align && st !== "real" && st !== "hard") continue;
        while (host.firstChild) host.removeChild(host.firstChild);
        const opts = Object.assign({}, OPTS[kind], align ? { align } : {});
        const env = STATES[st]();
        // Picks read this TV's own Keep watching: everyone's shows, long titles and Hindi in the hard case
        if (env.data) { env.data.who = "a"; env.data.household = [{ id: "a", name: "Alex", shows: [] }, { id: "b", name: st === "hard" ? "मुंबई की प्रिया" : "Sam", shows: (st === "hard" ? [HINDI, LONG, "Wolverhampton Wanderers v Brighton and Hove Albion, the full match replay"] : ["Mystery Road", "Utopia", "The Newsreader", "Total Control"]).map((t, i) => ({ id: "s" + i, title: t, progress: 0.3 })) }]; }
        const el = W.render({ id: "t", kind, w: w * 100 - 40, h: h * 100 - 40, opts }, env);
        el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
        host.appendChild(el); count++;
        for (let k = 0; k < 40 && el.getAttribute("data-fits") && !el.getAttribute("data-fitted"); k++) await frame();
        await frame();
        const tag = kind + " " + id + " " + st + (align ? " " + align : "");
        if (!el.getAttribute("data-fits")) out.push(tag + ": not fitted (no fitLater)");
        if ((st === "real" || st === "hard" || st === "designer" || st === "stale") && el.getAttribute("data-empty")) out.push(tag + ": drew an empty state");
        if (st !== "designer" && /Coastal highway|Titans|Rabbitohs|8,412|142,310/.test(el.textContent)) out.push(tag + ": demo words on a TV");
        const b = el.getBoundingClientRect(), ecs = getComputedStyle(el), pin = (k) => Math.max(0, parseFloat(ecs[k]) - 6);
        // words stay inside the box's own padding (6 px of grace), never against its edge
        const cb = { left: b.left + pin("paddingLeft"), right: b.right - pin("paddingRight"), top: b.top + pin("paddingTop"), bottom: b.bottom - pin("paddingBottom") };
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) out.push(tag + ": the box itself overflows");
        const u = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 };
        el.querySelectorAll("*").forEach((node) => {
          if (node.classList.contains("cw-bg") || node.classList.contains("cw-fill")) return;
          const cs = getComputedStyle(node), r = node.getBoundingClientRect();
          if (!r.width || !r.height || cs.visibility === "hidden") return;
          if ((cs.overflowX !== "visible" || cs.overflowY !== "visible") && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)) out.push(tag + ": " + (node.className || node.tagName) + " cuts its words off (" + (node.textContent || "").slice(0, 40) + ")");
          if (cs.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth + 1) out.push(tag + ": ends in ...");
          if (r.right > cb.right + 1 || r.bottom > cb.bottom + 1 || r.left < cb.left - 1 || r.top < cb.top - 1) out.push(tag + ": " + (typeof node.className === "string" ? node.className : node.tagName) + " past the box's padding");
          const hasText = [].some.call(node.childNodes, (t) => t.nodeType === 3 && t.textContent.trim());
          if (hasText) { const fs = parseFloat(cs.fontSize); if (fs > 0 && fs < 23) out.push(tag + ": words at " + fs + " px"); }
          // what is drawn: words, icons, dots and charts (a text box's own width, not its line's)
          let rr = r;
          if (hasText) { const rg = document.createRange(); rg.selectNodeContents(node); const rs = [].slice.call(rg.getClientRects()); if (rs.length) rr = rs.reduce((a, q) => ({ left: Math.min(a.left, q.left), top: Math.min(a.top, q.top), right: Math.max(a.right, q.right), bottom: Math.max(a.bottom, q.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 }); }
          if (hasText || node.tagName.toLowerCase() === "svg" || node.tagName === "I" || node.classList.contains("cw-chip")) { u.l = Math.min(u.l, rr.left); u.t = Math.min(u.t, rr.top); u.r = Math.max(u.r, rr.right); u.b = Math.max(u.b, rr.bottom); }
        });
        if (u.r > u.l) {
          const gl = u.l - b.left, gr = b.right - u.r, gt = u.t - b.top, gb = b.bottom - u.b, tolX = Math.max(26, b.width * 0.08), tolY = Math.max(26, b.height * 0.1);
          if (align === "left") { if (gl > 40) out.push(tag + ": asked for the left, starts " + Math.round(gl) + " px in"); }
          else if (Math.abs(gl - gr) > tolX) out.push(tag + ": not centred across (" + Math.round(gl) + " left, " + Math.round(gr) + " right)");
          if (Math.abs(gt - gb) > tolY) out.push(tag + ": not centred up and down (" + Math.round(gt) + " top, " + Math.round(gb) + " bottom)");
          centred++;
        }
      }
    }
    host.remove();
    return { out, count, centred };
  }, [fixtures, KINDS]);
  ok(res.count >= 150, "drew " + res.count + " web widget boxes, " + res.centred + " measured for centring");
  ok(res.out.length === 0, "every size and state fits, nothing cut off, centred:\n  " + res.out.slice(0, 40).join("\n  ") + (res.out.length > 40 ? "\n  and " + (res.out.length - 40) + " more" : ""));
  // a sheet of every size with real data, one per widget, for a person to look at
  for (const one of KINDS) {
    await page.evaluate(([F, kind]) => {
      document.querySelectorAll(".sheet-host").forEach((e) => e.remove());
      const NAMED = { tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4] };
      const C = window.CouchWidgetCaps, W = window.CouchWidgets, WW = window.CouchWidgetWeb, at = Date.now();
      const web = { news: { abc: { ok: true, at, v: WW.parseRss(F["rss-abc-top.xml"], 12) } }, sports: { nrl: { ok: true, at, v: WW.parseScores(JSON.parse(F["espn-nba.json"]), "nba") } },
        stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: true, at, v: WW.parseSpark(F["yahoo-spark.json"]) } }, commute: { K: { ok: true, at, v: WW.parseRoute(JSON.parse(F["osrm-route.json"])) } } };
      const commute = { from: { name: "Riverside" }, to: { name: "Parramatta" }, key: "K" };
      const host = document.createElement("div");
      host.className = "sheet-host"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
      document.body.appendChild(host);
      let x = 40, y = 40, rowH = 0;
      C.get(kind).sizes.s.forEach((id) => {
        const w = NAMED[id][0] * 100 - 40, h = NAMED[id][1] * 100 - 40;
        if (x + w > 1880) { x = 40; y += rowH + 30; rowH = 0; }
        const el = W.render({ id: "t", kind, w, h, opts: kind === "commute" ? { arrive_h: 8, arrive_m: 30 } : undefined }, { data: { bridge: true, web, commute, shows: window.__shows, people: window.__people, apps: window.__apps, who: "a", household: window.__household } });
        el.style.position = "absolute"; el.style.left = x + "px"; el.style.top = y + "px";
        host.appendChild(el); x += w + 30; rowH = Math.max(rowH, h);
      });
    }, [fixtures, one]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "sizes-" + one + ".png") });
  }
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks");
