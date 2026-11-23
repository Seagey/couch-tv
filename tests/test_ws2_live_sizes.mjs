// Widget swarm round 2, group "live", at the REAL sizes (tools/tv-designer/app/grid.js: a cell is 100 px
// with a 40 px gap, so tile 160x160, wtile 360x160, small 360x360, tall 360x560, medium 760x360,
// wide 1160x360). Every live kind at every size it comes in, with the real answers saved on 20 Nov 2026:
//  - every setting value against the default must change what is drawn (its words, or their size), except
//    How many headlines where the default "As many as fit" already shows that many (then the count is
//    checked instead; one row tall, 360x160, has room for one whole headline, and its help says so);
//  - nothing is cut ("..." by CSS, a line clamp, words hidden past the edge) and nothing spills;
//  - the checks the checker asked for (NO-GO 21 Nov): headlines counted at 360x360 and 360x560, the price
//    at tile and wtile, when to leave at 160x160, the cricket and failed ladder words, the meaning at wtile,
//    the Japanese heading whole, the Ask question whole, From your AI's who and keep.
// Plus node: a ladder that never answers never holds up the scores, and a saved ladder is not asked again.
//   COUCHTV_PLAYWRIGHT=<folder with playwright> node tests/test_ws2_live_sizes.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXD = path.join(ROOT, "tests/fixtures/widgets-data");
const FIX = path.join(FIXD, "live-20261120");
const require = createRequire(import.meta.url);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// ---------------- node: the ladder ----------------
{
  const WW = require("../tv-home/web/widget-web.js");
  const sb = JSON.parse(fs.readFileSync(path.join(FIX, "sb-epl.json"), "utf8")), st = JSON.parse(fs.readFileSync(path.join(FIX, "st-epl.json"), "utf8"));
  const asked = [];
  // a ladder that never answers: the scores still come, after h.ladderWait, with no team list
  const hang = { now: () => Date.UTC(2026, 10, 20, 7), ladderWait: 300, json: (u) => { asked.push(u); return /standings/.test(u) ? new Promise(() => {}) : Promise.resolve(sb); } };
  const t0 = Date.now();
  const v = await Promise.race([WW.SOURCES.sports.get(hang, "epl"), new Promise((r) => setTimeout(() => r("HUNG"), 5000))]);
  ok(v !== "HUNG" && v.games.length === 7 && !v.teams && Date.now() - t0 < 2000, "a ladder that hangs: the 7 Premier League games still come, without a team list, in " + (Date.now() - t0) + " ms");
  ok(asked.some((u) => /standings/.test(u)), "the ladder was asked");
  // the default wait is 8 seconds
  ok(/isFinite\(h\.ladderWait\) \? h\.ladderWait : 8000/.test(fs.readFileSync(path.join(ROOT, "tv-home/web/widget-web.js"), "utf8")), "the ladder waits 8 seconds at most on a TV");
  // the TV's own fetch gives up after 15 seconds, so the loader's busy mark always clears
  const app = fs.readFileSync(path.join(ROOT, "tv-home/web/app.js"), "utf8");
  ok(/new AbortController\(\)[^\n]*setTimeout\(function \(\) \{ ac\.abort\(\); \}, 15000\)/.test(app) && /no\(new Error\("timeout"\)\); \}, 15000\)/.test(app), "app.js json(): an answer not in after 15 seconds is given up (AbortController, or a race on older TVs)");
  // a ladder answer: kept with the round (teamsAt), and a reload seeds it, so the ladder is not asked again
  const ok2 = { now: () => Date.UTC(2026, 10, 20, 7), json: (u) => Promise.resolve(/standings/.test(u) ? st : sb) };
  const v2 = await WW.SOURCES.sports.get(ok2, "nba");   // nba never asked in this process: asks its ladder
  ok(v2.teams && v2.teams.length === 20 && v2.teamsAt === Date.UTC(2026, 10, 20, 7), "the ladder answer is kept with the round, with when it was read");
  const saved = { sports: { aleague: { ok: true, at: Date.UTC(2026, 10, 20, 6), v: { games: [], teams: [{ name: "Sydney FC", short: "Sydney FC", abbr: "SYD" }], teamsAt: Date.UTC(2026, 10, 19, 6) } } } };
  const asked3 = [];
  const L = WW.loader({ widgets: () => [{ kind: "sports", opts: { league: "aleague" } }], json: (u) => { asked3.push(u); return Promise.resolve(/standings/.test(u) ? st : sb); }, load: () => saved, save() {}, changed() {}, now: () => Date.UTC(2026, 10, 20, 7) });
  await L.tick();
  ok(asked3.length === 1 && !/standings/.test(asked3[0]) && L.data().sports.aleague.v.teams[0].name === "Sydney FC", "after a reload the saved ladder (a day old) is used, only the scores are asked: " + asked3.map((u) => u.replace(/^.*sports\//, "")).join(", "));
  // (the AFL: never asked in this process, so only the saved record can seed it)
  const old = { sports: { afl: { ok: true, at: 0, v: { games: [], teams: [{ name: "Collingwood" }], teamsAt: Date.UTC(2026, 10, 1) } } } };
  const asked4 = [];
  await WW.loader({ widgets: () => [{ kind: "sports", opts: { league: "afl" } }], json: (u) => { asked4.push(u); return Promise.resolve(/standings/.test(u) ? st : sb); }, load: () => old, save() {}, changed() {}, now: () => Date.UTC(2026, 10, 20, 7) }).tick();
  ok(asked4.some((u) => /standings/.test(u)), "a saved ladder older than a week is asked again");
}
console.log("node part: " + n + " checks");

// ---------------- the browser ----------------
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP browser part: Playwright is not installed. " + n + " checks passed."); process.exit(0); }

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
const rd = (d, f) => fs.readFileSync(path.join(d, f), "utf8");
const FX = { abc: rd(FIXD, "rss-abc-top.xml"), bbc: rd(FIXD, "rss-bbc.xml"), yahoo: rd(FIX, "yahoo.json"), osrm: rd(FIX, "osrm.json") };
for (const id of ["afl", "nrl", "epl", "nba", "bbl", "cricket"]) { FX["sb-" + id] = rd(FIX, "sb-" + id + ".json"); if (fs.existsSync(path.join(FIX, "st-" + id + ".json"))) FX["st-" + id] = rd(FIX, "st-" + id + ".json"); }

const browser = await chromium.launch();
// Friday 20 Nov 2026, 9pm in Sydney: an 8:30 arrive by is Monday with Weekdays only, tomorrow without it
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: "Australia/Sydney" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.clock.setFixedTime(new Date("2026-11-20T21:00:00+11:00"));
await page.route(/espn\.com|project-osrm|open-meteo|finance\.yahoo/, (r) => r.abort());
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("couchtv.ask", JSON.stringify({ provider: "local", base: "https://models.example.com/v1", model: "llama3" }));
  localStorage.setItem("couchtv.ask.last", JSON.stringify({ q: "How far away is the moon?", a: "About 384,000 kilometres.", by: "llama3", at: Date.now() - 90 * 60000 }));
});
await page.goto(BASE + "?mock=1");
await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetWeb && window.CouchWidgetCaps && window.CouchAsk);
await page.waitForTimeout(800);

const out = await page.evaluate(async (FX) => {
  const W = window.CouchWidgets, WW = window.CouchWidgetWeb, C = window.CouchWidgetCaps, A = window.CouchAsk;
  const NAMED = { tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8] };
  const t0 = Date.now(), web = { news: {}, sports: {}, stocks: {}, commute: {} };
  web.news.abc = { ok: true, at: t0, v: WW.parseRss(FX.abc, 12) };
  web.news.bbc = { ok: true, at: t0, v: WW.parseRss(FX.bbc, 12) };
  const ladder = {};
  for (const id of ["afl", "nrl", "epl", "nba", "bbl", "cricket"]) { const v = WW.parseScores(JSON.parse(FX["sb-" + id]), id); if (FX["st-" + id]) { v.teams = WW.parseTeams(JSON.parse(FX["st-" + id])); ladder[id] = v.teams; } web.sports[id] = { ok: true, at: t0, v }; }
  const spark = WW.parseSpark(FX.yahoo);
  const stock = (list) => { web.stocks[list.join(",")] = { ok: true, at: t0, v: spark }; };
  stock(["^AXJO", "AUDUSD=X", "BTC-AUD"]); stock(["BHP.AX", "CBA.AX"]); stock(["^GSPC", "BHP.AX", "CBA.AX", "^AXJO", "AUDUSD=X", "BTC-AUD"]);
  web.commute.K = { ok: true, at: t0, v: WW.parseRoute(JSON.parse(FX.osrm)) };
  const data = { bridge: true, country: "AU", place: { name: "Parramatta", lat: -33.82, lon: 151.0, timezone: "Australia/Sydney" }, web, commute: { from: { name: "Parramatta", lat: -33.82, lon: 151 }, to: { name: "Chatswood", lat: -33.8, lon: 151.18 }, key: "K" } };
  const host = document.createElement("div");
  host.className = "cd-layer"; host.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:99;background:#26303f";
  document.body.appendChild(host);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function draw(kind, w, h, set) {
    while (host.firstChild) host.removeChild(host.firstChild);
    const el = W.render({ id: "t", kind, w, h }, { data, wset: { t: set || {} }, clock24: false });
    el.style.position = "absolute"; el.style.left = "80px"; el.style.top = "60px";
    host.appendChild(el);
    for (let k = 0; k < 60 && el.getAttribute("data-fits") && !el.getAttribute("data-fitted"); k++) { await frame(); await wait(20); }
    await frame();
    const cut = [], sizes = [];
    el.querySelectorAll("*").forEach((nd) => {
      if (nd.closest("svg")) return;
      const cs = getComputedStyle(nd), txt = (nd.textContent || "").trim();
      if (!txt) return;
      if (cs.display === "none") return;
      if ([].some.call(nd.childNodes, (c) => c.nodeType === 3 && c.textContent.trim())) sizes.push(cs.fontSize);
      const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== "none" && nd.scrollHeight > nd.clientHeight + 1;
      const ell = cs.textOverflow === "ellipsis" && nd.scrollWidth > nd.clientWidth + 1;
      const hid = (cs.overflowX === "hidden" || cs.overflowX === "clip") && cs.textOverflow !== "ellipsis" && nd.scrollWidth > nd.clientWidth + 1 && !nd.children.length;
      if (clamped || ell || hid) cut.push((clamped ? "clamp" : ell ? "ellipsis" : "hidden") + ": " + txt.slice(0, 70));
    });
    const text = el.innerText.replace(/\s+/g, " ").trim();
    return { text, sig: text + " | " + sizes.join(","), cut, spill: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
      hl: el.querySelectorAll(".cw-hl").length, dots: /\.\.\.|…/.test(text) };
  }
  // groups: each a setup and [label, settings] cases, the first the default
  const noLadder = () => { web.sports.epl.v = Object.assign({}, web.sports.epl.v); delete web.sports.epl.v.teams; };
  const withLadder = () => { web.sports.epl.v = Object.assign({}, web.sports.epl.v, { teams: ladder.epl }); };
  const msg = (h) => () => A._test.took({ message: { text: "Dinner is ready, come and eat", from: "Claude", at: Date.now() - h * 3600000 } }, Date.now());
  const GROUPS = [
    { kind: "sports", cases: [["default (NRL)", {}], ["league afl", { league: "afl" }], ["league epl", { league: "epl" }], ["league nba", { league: "nba" }], ["league bbl", { league: "bbl" }], ["league cricket", { league: "cricket" }],
      ["epl team Man City", { league: "epl", team: "Manchester City" }], ["epl Man City games mine", { league: "epl", team: "Manchester City", games: "mine" }],
      ["epl Man City games live", { league: "epl", team: "Manchester City", games: "live" }], ["epl Collingwood (wrong)", { league: "epl", team: "Collingwood" }],
      ["epl Collingwood games mine", { league: "epl", team: "Collingwood", games: "mine" }], ["cricket Australia games mine", { league: "cricket", team: "Australia", games: "mine" }],
      ["cricket Australia", { league: "cricket", team: "Australia" }], ["games mine no team", { games: "mine" }]] },
    { kind: "sports", setup: noLadder, tag: "ladder failed", cases: [["default (NRL)", {}], ["epl Collingwood games mine", { league: "epl", team: "Collingwood", games: "mine" }], ["epl Collingwood", { league: "epl", team: "Collingwood" }]] },
    { kind: "news", setup: withLadder, cases: [["default", {}], ["feed bbc", { feed: "bbc" }], ["count 1", { count: 1 }], ["count 2", { count: 2 }], ["count 4 (an older design)", { count: 4 }]] },
    { kind: "stocks", cases: [["default", {}], ["tickers BHP CBA", { tickers: ["BHP.AX", "CBA.AX"] }], ["price off", { price: false }], ["tickers 6", { tickers: ["^GSPC", "BHP.AX", "CBA.AX", "^AXJO", "AUDUSD=X", "BTC-AUD"] }], ["tickers hello!", { tickers: ["hello!"] }]] },
    { kind: "commute", cases: [["default (no arrive)", {}], ["arrive 8:30", { arrive_h: 8, arrive_m: 30 }], ["arrive 8:00", { arrive_h: 8 }], ["arrive 8:30 buffer 30", { arrive_h: 8, arrive_m: 30, buffer: 30 }], ["arrive 8:30 weekdays off", { arrive_h: 8, arrive_m: 30, weekdays: false }], ["arrive 17:00", { arrive_h: 17, arrive_m: 0 }]] },
    { kind: "quote", cases: [["default", {}], ["mood calm", { mood: "calm" }], ["mood go", { mood: "go" }], ["mood home", { mood: "home" }], ["own words", { text: "Dinner is at six, so wash your hands before then please" }], ["own words + who", { text: "Dinner is at six", sub: "Mum" }]] },
    { kind: "word", cases: [["default", {}], ["lang es", { lang: "es" }], ["lang ja", { lang: "ja" }], ["lang de", { lang: "de" }], ["lang fr", { lang: "fr" }], ["lang it", { lang: "it" }], ["meaning off", { meaning: false }], ["lang fr meaning off", { lang: "fr", meaning: false }]] },
    { kind: "ask", cases: [["default", {}], ["keep hour", { keep: "hour" }], ["keep never", { keep: "never" }]] },
    // From your AI: a message 30 hours old (only For a day hides it), then one 2 hours old
    { kind: "agent", setup: msg(30), tag: "30 h old", cases: [["default", {}], ["keep day", { keep: "day" }]] },
    { kind: "agent", setup: msg(2), tag: "2 h old", cases: [["default", {}], ["who off", { who: false }], ["keep hour", { keep: "hour" }]] }
  ];
  const res = [];
  for (const g of GROUPS) {
    if (g.setup) g.setup();
    const sizes = C.get(g.kind).sizes.s.filter((s) => NAMED[s]);
    for (const s of sizes) {
      const w = NAMED[s][0] * 100 - 40, h = NAMED[s][1] * 100 - 40;
      let base = null;
      for (const [label, set] of g.cases) {
        const d = await draw(g.kind, w, h, set);
        if (!base) base = d;
        res.push(Object.assign({ kind: g.kind, tag: g.tag || "", size: s, w, h, label, isDefault: base === d, same: base !== d && d.sig === base.sig, baseHl: base.hl }, d));
      }
    }
  }
  // the words the word widget draws today, to check the meaning
  const words = { en: (window.CouchWords.words || [])[0] };
  return { res, wordsLen: { en: (window.CouchWords.words || []).length } };
}, FX);

const R = out.res;
const find = (kind, size, label, tag) => R.find((r) => r.kind === kind && r.size === size && r.label === label && (tag === undefined || r.tag === tag));
const show = (r) => r.kind + (r.tag ? " (" + r.tag + ")" : "") + " " + r.size + " " + r.w + "x" + r.h + " " + r.label;
if (process.env.DUMP) R.forEach((r) => console.log([show(r), r.same ? "SAME" : "", r.spill ? "SPILL" : "", r.cut.length ? "CUT[" + r.cut.join(" | ") + "]" : "", "hl " + r.hl, "=> " + r.sig.slice(0, 300)].filter(Boolean).join(" ; ")));

// 1. every value changes the drawing, nothing cut, nothing spills
let changed = 0, counted = 0;
for (const r of R) {
  ok(!r.cut.length, show(r) + ": nothing cut: " + r.cut.join(" | "));
  ok(!r.spill, show(r) + ": nothing spills out of its box");
  if (r.isDefault) continue;
  // How many headlines that "As many as fit" already shows at this size: the same drawing is right
  if (r.kind === "news" && /^count/.test(r.label) && r.baseHl === Math.min(r.size === "wtile" ? 1 : 2, +r.label.split(" ")[1])) { ok(r.hl === r.baseHl, show(r) + ": shows " + r.baseHl + " headlines, as many as As many as fit shows here (" + r.hl + ")"); counted++; continue; }
  ok(!r.same, show(r) + ": the drawing changes from the default: " + r.sig.slice(0, 200));
  changed++;
}
console.log("drawn: " + R.length + " (kind, size, value), " + changed + " changed from the default, " + counted + " headline counts equal to As many as fit");

// 2. the checker's own items
// news: the number asked for is the number shown, at every size (small and tall named)
for (const s of ["wtile", "small", "tall", "medium"]) {
  ok(find("news", s, "count 1").hl === 1, "news " + s + ": How many headlines 1 shows 1 (" + find("news", s, "count 1").hl + ")");
  // one row tall (wtile, 360x160): room for one whole headline, and the help says so
  const two = s === "wtile" ? 1 : 2;
  ok(find("news", s, "count 2").hl === two, "news " + s + ": How many headlines 2 shows " + two + " (" + find("news", s, "count 2").hl + ")");
  ok(find("news", s, "count 4 (an older design)").hl === two, "news " + s + ": an older design's 4 shows " + two + ", the most offered");
}
ok(find("news", "tall", "default").hl >= 2, "news tall: As many as fit shows 2 or more (" + find("news", "tall", "default").hl + ")");
{
  const CAPS = require("../tv-home/web/widget-caps.js"), c = CAPS.settings("news").find((s) => s.key === "count");
  ok(JSON.stringify(c.options.map((o) => o[0])) === JSON.stringify(["auto", 1, 2]) && /one row tall, which has room for one/.test(c.help), "news: How many headlines offers only what can show: As many as fit, 1, 2, and says a widget one row tall has room for one");
  const m = CAPS.settings("word").find((s) => s.key === "meaning");
  ok(/^Off shows only the word and how to say it/.test(m.help), "word: Show what it means says what off does: " + m.help);
  const t = CAPS.settings("sports").find((s) => s.key === "team");
  ok(/Cricket has no list: type the team's name and Couch TV checks it against the games it can see\./.test(t.help) && !/Big Bash and cricket/.test(t.help), "sports: Your team help is true (Big Bash has a ladder): " + t.help);
}
// stocks: Show the price at tile and wtile
ok(/\$\d/.test(find("stocks", "tile", "tickers BHP CBA").text) && !/\$\d/.test(find("stocks", "tile", "tickers BHP CBA").text.replace(/^.*/, "")), "stocks tile: the price shows under the name: " + find("stocks", "tile", "tickers BHP CBA").text);
ok(find("stocks", "tile", "default").text !== find("stocks", "tile", "price off").text && /\d/.test(find("stocks", "tile", "default").text.split(" ").slice(-1)[0]), "stocks tile: price on shows it, off leaves it out: " + find("stocks", "tile", "default").text + " / " + find("stocks", "tile", "price off").text);
{
  const on = find("stocks", "wtile", "tickers BHP CBA"), off = find("stocks", "wtile", "default");
  ok(/BHP/.test(on.text) && /\$51\.40/.test(on.text) && !/CBA/.test(on.text), "stocks wtile, price on: one row with its price: " + on.text);
  const pOff = find("stocks", "wtile", "price off");
  ok(!/\$/.test(pOff.text) && pOff.text.split("%").length - 1 === 2, "stocks wtile, price off: two rows, only their move: " + pOff.text);
}
// commute at 160x160: when to leave
{
  const d = find("commute", "tile", "default (no arrive)"), a = find("commute", "tile", "arrive 8:30"), b8 = find("commute", "tile", "arrive 8:00"), bf = find("commute", "tile", "arrive 8:30 buffer 30"), wk = find("commute", "tile", "arrive 8:30 weekdays off");
  ok(d.text === "27 min", "commute tile, no arrive by: 27 min (" + d.text + ")");
  ok(/^Mon, leave 7:53am/.test(a.text), "commute tile, arrive 8:30 on a Friday night: Mon, leave 7:53am (" + a.text + ")");
  ok(/leave 7:23am/.test(b8.text), "commute tile, arrive 8:00: leave 7:23am (" + b8.text + ")");
  ok(/leave 7:33am/.test(bf.text), "commute tile, 30 minutes to spare: leave 7:33am (" + bf.text + ")");
  ok(/^Tomorrow, leave 7:53am/.test(wk.text), "commute tile, Weekdays only off: tomorrow, Saturday (" + wk.text + ")");
}
// sports: the cricket and failed ladder words
{
  const cr = find("sports", "small", "cricket Australia games mine", "");
  ok(/No Australia game right now/.test(cr.text) && !/not in/i.test(cr.text), "cricket, Australia, only my team: no game right now, never 'not in' (" + cr.text + ")");
  const cr2 = find("sports", "small", "cricket Australia", "");
  ok(!/not in/i.test(cr2.text) && !/Cricket/.test(cr2.text.replace(/^Cricket/, "")), "cricket, Australia, every game: the games, no 'not in' (" + cr2.text.slice(0, 120) + ")");
  const wr = find("sports", "small", "epl Collingwood games mine", "");
  ok(/Collingwood is not in the Premier League/.test(wr.text), "Premier League ladder read: Collingwood is not in the Premier League (" + wr.text + ")");
  const nl = find("sports", "small", "epl Collingwood games mine", "ladder failed");
  ok(/No Collingwood game right now/.test(nl.text) && !/not in/i.test(nl.text), "Premier League ladder not read: no Collingwood game right now (" + nl.text + ")");
  const wt = find("sports", "wtile", "epl Collingwood (wrong)", "");
  ok(/Not in the Premier League/.test(wt.text), "Scores wtile, a team from another competition: Not in the Premier League as the status line (" + wt.text + ")");
}
// word: the meaning at wtile, the heading whole at small
{
  const on = find("word", "wtile", "default"), off = find("word", "wtile", "meaning off");
  ok(on.text !== off.text && on.text.length > off.text.length + 8 && !/noun|verb|adjective/.test(on.text.split(" ").slice(1).join(" ").slice(0, 12)), "word wtile: meaning on shows what it means (" + on.text + "), off what kind of word (" + off.text + ")");
  const fr = find("word", "wtile", "lang fr"), frOff = find("word", "wtile", "lang fr meaning off");
  ok(fr.text.indexOf(frOff.text.split(" ").slice(1).join(" ")) >= 0 && fr.text.length > frOff.text.length, "word wtile French: how to say it, then the meaning (" + fr.text + " / " + frOff.text + ")");
  const ja = find("word", "small", "lang ja");
  ok(/^Word of the day, in Japanese/.test(ja.text) && !ja.cut.length, "word small: Word of the day, in Japanese, whole (" + ja.text + ")");
}
// ask: the question whole at wtile and small
for (const s of ["wtile", "small"]) { const r = find("ask", s, "default"); if (r) ok(/How far away is the moon\?/.test(r.text) && !r.cut.length, "ask " + s + ": the question whole (" + r.text + ")"); }
// agent: who and keep
{
  ok(/From your AI/.test(find("agent", "small", "who off", "2 h old").text) && /From Claude/.test(find("agent", "small", "default", "2 h old").text), "agent: Show who sent it off says From your AI");
  ok(!/Dinner/.test(find("agent", "small", "keep hour", "2 h old").text), "agent: For an hour hides a message 2 hours old");
  ok(/Dinner/.test(find("agent", "small", "default", "30 h old").text) && !/Dinner/.test(find("agent", "small", "keep day", "30 h old").text), "agent: For a day hides a message 30 hours old, Until the next one keeps it");
}
// From your AI's detail page (OK on the widget) honours who and keep too
{
  const dt = await page.evaluate(async () => {
    const D = window.CouchDetail, outs = [];
    if (!D || !D.open) return null;
    for (const set of [{}, { who: false }, { keep: "hour" }]) {
      const from = document.createElement("div"); from.setAttribute("data-kind", "agent"); from.__o = { id: "t", kind: "agent", w: 760, h: 360 };
      document.body.appendChild(from);
      D.open(from, { data: {}, wset: { t: set } });
      await new Promise((r) => setTimeout(r, 200));
      const el = document.querySelector(".cwd-panel");
      outs.push(el ? el.innerText.replace(/\s+/g, " ").slice(0, 200) : "");
      D.close(true); from.remove();
      await new Promise((r) => setTimeout(r, 100));
    }
    return outs;
  });
  if (dt) {
    ok(/From Claude/.test(dt[0]) && /Dinner/.test(dt[0]), "agent detail: the message and who sent it (" + dt[0].slice(0, 80) + ")");
    ok(/From your AI/.test(dt[1]) && !/From Claude/.test(dt[1]), "agent detail, Show who sent it off: From your AI (" + dt[1].slice(0, 80) + ")");
    ok(!/Dinner/.test(dt[2]), "agent detail, For an hour: a message 2 hours old waits quietly (" + dt[2].slice(0, 80) + ")");
  } else console.log("note: no CouchWidgetDetail.open on this page");
}
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
server.close();
console.log("All " + n + " size checks passed.");
