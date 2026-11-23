// Widget swarm round 2, group "live": Scores, Headlines, Markets, Commute, Quote, Word of the day, Ask AI
// and From your AI. Every one has settings of its own, each wired and before launch (pre: true), and:
//  1. node: the real answers saved from ESPN (scoreboards and ladders, which name every team), Yahoo and OSRM on 20 Nov 2026
//     (tests/fixtures/widgets-data/live-20261120) read the way the TV reads them; the team picker, the
//     team check, which games, the season words; every record of these kinds is pre: true and kept by
//     the design sanitiser;
//  2. a real browser, the real TV home (index.html) with a design holding all eight: each widget is in
//     Home settings "Widgets on this home", Hold OK has "Edit on the TV", the phone's "Widgets on this
//     TV" (setup.html against a stand in on-TV app whose /api/athome is the TV page) lists it; a design
//     without them lists none of them;
//  3. every setting changed (through the phone's own path, tv.atHomeEdit, and some with the TV remote)
//     changes the drawn widget, and clearing it goes back to the default.
// LIVE=1: no stand ins. The TV asks ESPN (all 7 competitions), OSRM, and the relay reads the real feeds
// and Yahoo, and the widget must show what the service answered right now.
// Needs Playwright (Chromium). Without it the browser part says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_live.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "tests/fixtures/widgets-data/live-20261120");
const LIVE = process.env.LIVE === "1";
const require = createRequire(import.meta.url);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const fix = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const fixJ = (f) => JSON.parse(fix(f));

// ---------------- 1. node ----------------
const WW = require("../tv-home/web/widget-web.js");
const CAPS = require("../tv-home/web/widget-caps.js");
const KINDS = ["sports", "news", "stocks", "commute", "quote", "word", "ask", "agent"];
const KEYS = { sports: ["league", "team", "games"], news: ["feed", "count"], stocks: ["tickers", "price"], commute: ["to", "arrive_h", "arrive_m", "buffer", "weekdays", "from"],
  quote: ["mood", "text", "sub"], word: ["lang", "meaning"], ask: ["keep"], agent: ["keep", "who"] };
KINDS.forEach((k) => {
  const l = CAPS.settings(k);
  ok(l.length >= 1 && l.every((s) => s.pre === true), k + ": every setting is before launch (" + l.map((s) => s.key + ":" + s.pre).join(", ") + ")");
  ok(JSON.stringify(l.map((s) => s.key)) === JSON.stringify(KEYS[k]), k + ": settings are " + KEYS[k].join(", ") + " (" + l.map((s) => s.key).join(", ") + ")");
  l.forEach((s) => ok(!/[–—]/.test(s.label + s.help) && /^[A-Z0-9]/.test(s.label), k + "." + s.key + ": plain words, sentence case: " + s.label));
  // honest words: the steps say where the settings are now, and no step sends anyone to a control that does not exist
  ["android", "web", "vidaa"].forEach((g) => {
    const st = CAPS.steps(k, g).join(" ");
    ok(!/Tap the widget, then pick|type up to six share codes, like BHP\.AX or CBA\.AX for ASX shares\.$/.test(st), k + " " + g + ": no old Studio only steps");
    if (!/^(ask|agent)$/.test(k)) ok(/hold OK on the widget, then Edit on the TV/.test(st), k + " " + g + ": the steps say Hold OK, Edit on the TV: " + st.slice(0, 160));
  });
});
// the design keeps each store "design" key (design.js WOPT and OPT), in range
{
  global.window = global.window || {};
  const DJ0 = fs.readFileSync(path.join(ROOT, "tv-home/web/design.js"), "utf8"), DJ = DJ0.slice(DJ0.indexOf("var WOPT = {"), DJ0.indexOf("var WOPT = {") + 4000);
  KINDS.forEach((k) => CAPS.settings(k).filter((s) => s.store === "design").forEach((s) => {
    const m = new RegExp("\\b" + k + ": \"([a-z_ ]*)\"").exec(DJ);
    ok(m && m[1].split(" ").indexOf(s.key) >= 0, k + "." + s.key + " is a key the design keeps (WOPT " + (m && m[1]) + ")");
  }));
}
// ESPN on 20 Nov 2026: the AFL between seasons (Round 1 in March), the NRL over (the grand final), the
// Premier League on, the Big Bash about to start (ESPN gives only letters as its short names), the NBA
const read = (id) => { const v = WW.parseScores(fixJ("sb-" + id + ".json"), id); if (fs.existsSync(path.join(FIX, "st-" + id + ".json"))) v.teams = WW.parseTeams(fixJ("st-" + id + ".json")); return v; };
const NOW = Date.UTC(2026, 10, 20, 7, 0);
const afl = read("afl"), nrl = read("nrl"), epl = read("epl"), bbl = read("bbl"), nba = read("nba"), cricket = read("cricket");
ok(afl.teams.length === 18 && afl.teams.some((t) => t.name === "Collingwood") && new Set(afl.teams.map((t) => t.name)).size === 18, "AFL: every team from its ladder, each once: " + afl.teams.length);
ok(nrl.teams.length === 17 && epl.teams.length === 20 && bbl.teams.length === 8, "NRL 17 teams, Premier League 20, Big Bash 8 (" + [nrl.teams.length, epl.teams.length, bbl.teams.length] + ")");
ok(!WW.LEAGUES.cricket.teams && Object.keys(WW.LEAGUES).filter((k) => k !== "cricket").every((k) => /^https:\/\/site\.api\.espn\.com\/apis\/v2\/sports\/.*\/standings$/.test(WW.LEAGUES[k].teams)), "the team lists come from ESPN's ladders, which a TV page may read (the /teams list sends no CORS header)");
ok(WW.seasonOf(afl.games, NOW).off === "soon" && WW.kickoff(WW.seasonOf(afl.games, NOW).at, NOW) === "17 Mar", "AFL: the season starts 17 Mar");
ok(WW.seasonOf(nrl.games, NOW).off === "over", "NRL: the season is over (the grand final was 4 Oct)");
ok(WW.seasonOf(epl.games, NOW).off === "", "Premier League: in season");
ok(bbl.games[0].teams.map((t) => t.name).join(" v ") === "Melbourne Renegades v Perth Scorchers", "Big Bash: whole names, never ESPN's letters MR v PS: " + bbl.games[0].teams.map((t) => t.name).join(" v "));
ok(WW.teamOf("Man City", epl).name === "Manchester City" && WW.teamOf("MNC", epl).name === "Manchester City" && WW.teamOf("manchester city", epl).name === "Manchester City", "a team by its short name, letters or whole name");
ok(WW.teamOf("North Melbourne", afl).name === "North Melbourne" && WW.teamOf("Melbourne", afl).name === "Melbourne", "North Melbourne is never Melbourne, and the other way");
ok(WW.teamOf("Collingwood", epl) === null && WW.teamOf("Collingwood", nrl) === null, "Collingwood is not in the Premier League or the NRL");
ok(WW.teamOf("Sydney Sixers", bbl).name === "Sydney Sixers" && WW.teamList(bbl).length === 8, "Big Bash: all 8 from its ladder, Sydney Sixers too, though only one game is on the scoreboard");
ok(WW.teamOf("pakistan women", cricket).name === "Pakistan Women" && WW.teamOf("india", cricket).name === "India" && WW.teamOf("Collingwood", cricket) === null, "cricket: no ladder, the teams seen in its games");
const mine = WW.scoreFilter(epl.games, "Manchester City", "mine", NOW);
ok(mine.length === 1 && mine[0].teams[0].name === "Man City", "Only my team: Man City's one game");
ok(WW.scoreFilter(epl.games, "Manchester City", "live", NOW).length === 1 && WW.scoreFilter(epl.games, "", "live", NOW).length === 0, "Live games and my team: my team's game, nothing else live");
ok(WW.scoreFilter(epl.games, "Manchester City", "all", NOW).length === 7, "Every game: all 7");
ok(WW.scoreFilter(afl.games, "North Melbourne", "mine", NOW).every((g) => g.teams.some((t) => t.full === "North Melbourne")), "Only my team never takes a Melbourne game for North Melbourne's");
{ const q = WW.parseSpark(fix("yahoo.json")).quotes; ok(Object.keys(q).length === 6 && q["BHP.AX"].name === "BHP" && WW.price(q["BHP.AX"]) === "$51.40", "Yahoo: 6 prices, BHP $51.40"); }
ok(JSON.stringify(WW.parseRoute(fixJ("osrm.json"))) === JSON.stringify({ minutes: 27, km: 22.1 }), "OSRM: Parramatta to Chatswood, 27 min, 22.1 km");
console.log("node part: " + n + " checks");

// ---------------- LIVE: the real services now ----------------
const LIVE_ANS = {};
if (LIVE) {
  for (const id of Object.keys(WW.LEAGUES)) {
    const j = await (await fetch(WW.LEAGUES[id].url)).json();
    const v = WW.parseScores(j, id);
    LIVE_ANS[id] = v;
    const ord = WW.scoreOrder(v.games, "", Date.now());
    console.log("LIVE ESPN " + id + ": " + v.games.length + " games" + (ord[0] ? ", first shown " + ord[0].teams.map((t) => t.name + " " + t.score).join(" v ") + " (" + ord[0].state + ")" : "") + ", season " + JSON.stringify(WW.seasonOf(v.games, Date.now())));
  }
}

// ---------------- 2 and 3. the browser ----------------
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP browser part: Playwright is not installed. " + n + " checks passed."); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const TOKEN = "t0k3n";
let TV = null;
const HS = { settings: { lang: "en", photos: [] }, people: [], weather: null, country: "AU", tv_name: "Lounge", ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = () => { try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false });
    if (u.pathname.startsWith("/api/") && u.pathname !== "/api/webdata") {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/athome") { const r = TV ? await TV.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null; return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false }); }
      if (route === "POST /api/athome") { const r = TV ? await TV.evaluate((x) => tv.atHomeEdit(x), body().edit) : null; return !r ? send(res, 200, { ok: true, live: false }) : r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error }); }
      if (route === "GET /api/home") return send(res, 200, { ok: true, on: true, held: true });
      if (route === "GET /api/inputs") return send(res, 200, { ok: true, inputs: [], pinned: [] });
      if (route === "GET /api/update") return send(res, 200, { ok: true, current: "0.13.9", checked: true });
      return send(res, 404, { ok: false, error: "no such endpoint: " + route });
    }
    const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port, HOME = ORIGIN + "/tv-home/web/index.html";
const browser = await chromium.launch();
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 160); };

// the design: all eight, each its own size (the home's town is Parramatta)
const box = (id, kind, x, y, w, h, opts) => Object.assign({ id, type: "widget", kind, x, y, w, h }, opts ? { opts } : {});
const ALL8 = { v: 1, background: { colour: "#1d3a4f" }, elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true }, clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true } },
  objects: [box("sp", "sports", 40, 40, 760, 460), box("nw", "news", 840, 40, 560, 420), box("st", "stocks", 1440, 40, 440, 460), box("cm", "commute", 40, 540, 760, 300),
    box("qt", "quote", 840, 500, 520, 300), box("wd", "word", 1400, 520, 480, 320), box("ak", "ask", 40, 860, 760, 200), box("ag", "agent", 840, 840, 1040, 220)] };
const NONE = { v: 1, background: { colour: "#1d3a4f" }, elements: ALL8.elements, objects: [box("cl", "clock", 40, 40, 600, 300), box("nw2", "news", 840, 40, 560, 420)] };
const TITLES = { sports: "Scores", news: "Headlines", stocks: "Markets", commute: "Commute", quote: "Quote", word: "Word of the day", ask: "Ask AI", agent: "From your AI" };
const PLACE = { name: "Parramatta", area: "New South Wales", lat: -33.82, lon: 151.0, timezone: "Australia/Sydney" };
const asked = [];

async function routes(page) {
  // the relay (the launcher, on-TV app or bridge): a stand in that answers the real saved feeds and Yahoo, or LIVE the real ones
  await page.route("**/api/webdata?*", async (route) => {
    const u = new URL(route.request().url()), src = u.searchParams.get("src"), id = u.searchParams.get("id");
    asked.push("relay " + src + ":" + id);
    let text = null;
    if (LIVE) {
      const url = src === "news" ? WW.FEEDS[id] && WW.FEEDS[id].url : "https://query2.finance.yahoo.com/v7/finance/spark?symbols=" + encodeURIComponent(id).replace(/%2C/g, ",") + "&range=1d&interval=15m";
      text = await (await fetch(url, { headers: { "User-Agent": "couch-tv (+https://github.com/Seagey/couch-tv)" } })).text();
    } else text = src === "news" ? fs.readFileSync(path.join(FIX, "..", id === "bbc" ? "rss-bbc.xml" : "rss-abc-top.xml"), "utf8") : fix("yahoo.json");
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, src, id, text }) });
  });
  await page.route(/open-meteo\.com/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 22, weather_code: 1, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 200, time: "" }, hourly: {}, daily: {} }) }));
  // LIVE: ESPN turns away a headless browser (403 for the name HeadlessChrome), so each request the TV page
  // makes is asked from here, right now, and its real answer handed to the page
  if (LIVE) {
    await page.route(/site\.api\.espn\.com|site\.web\.api\.espn\.com|router\.project-osrm\.org/, async (route) => {
      const u = route.request().url(); asked.push(u);
      const r = await fetch(u);
      route.fulfill({ status: r.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: await r.text() });
    });
    return;
  }
  await page.route(/site\.api\.espn\.com|site\.web\.api\.espn\.com/, (route) => {
    const u = route.request().url(); asked.push(u);
    const id = Object.keys(WW.LEAGUES).find((k) => u === WW.LEAGUES[k].url || u === WW.LEAGUES[k].teams);
    const f = id && (u === WW.LEAGUES[id].teams ? "st-" : "sb-") + id + ".json";
    route.fulfill({ status: f && fs.existsSync(path.join(FIX, f)) ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: f && fs.existsSync(path.join(FIX, f)) ? fix(f) : "{}" });
  });
  await page.route(/router\.project-osrm\.org/, (route) => { asked.push(route.request().url()); route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: fix("osrm.json") }); });
}
async function tvPage(d, q) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await routes(page);
  await page.goto(HOME + "?mock=1&reset=1");
  await page.evaluate(([dz, pl]) => {
    localStorage.clear();
    localStorage.setItem("tvdesigner.design", JSON.stringify(dz));
    localStorage.setItem("mock:tvhome.settings", JSON.stringify({ s: { place: pl }, updated: Date.now(), pending: false }));
    // Ask AI set up with a model at home (no key), and its last answer an hour and a half ago
    localStorage.setItem("couchtv.ask", JSON.stringify({ provider: "local", base: "https://models.example.com/v1", model: "llama3" }));
    localStorage.setItem("couchtv.ask.last", JSON.stringify({ q: "How far away is the moon?", a: "About 384,000 kilometres.", by: "llama3", at: Date.now() - 90 * 60000 }));
  }, [d, PLACE]);
  await page.goto(HOME + "?mock=1&design=local&weblive=1" + (q || ""));
  await page.waitForFunction(() => window.tv && window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o .cw"));
  await page.waitForTimeout(800);
  return page;
}
const wtext = (page, id) => page.evaluate((x) => ((document.querySelector('.cw-o[data-obj="' + x + '"] .cw') || {}).textContent || "").replace(/\s+/g, " ").trim(), id);
async function waitW(page, id, test, what) {
  const src = typeof test === "string" ? "t.indexOf(" + JSON.stringify(test) + ") >= 0" : test.toString().replace(/^\/(.*)\/([a-z]*)$/, "new RegExp($1)");
  const fn = typeof test === "string" ? (t) => t.indexOf(test) >= 0 : (t) => test.test(t);
  for (let i = 0; i < 50; i++) { const t = await wtext(page, id); if (fn(t)) return t; await page.waitForTimeout(200); }
  const t = await wtext(page, id);
  ok(false, what + ": wanted " + src + " in " + id + ", it says: " + t.slice(0, 300));
}
const edit = (page, key, values) => page.evaluate(([k, v]) => tv.atHomeEdit({ widget_set: { key: k, values: v } }), [key, values]);
const design = (page) => page.evaluate(() => tv.atHomeRead().design);
const setOf = async (page, key, k) => (await design(page)).widgets.filter((w) => w.key === key)[0].settings.filter((s) => s.key === k)[0];
async function holdOn(page, id) {
  await page.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await page.waitForTimeout(200);
  await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
  const items = await page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  await press(page, "Escape", 300);
  return items;
}
async function homeSettingsRows(page) {
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(250); await press(page, "Enter", 500);
  let found = false;
  for (let i = 0; i < 18 && !found; i++) { found = (await page.evaluate(() => document.getElementById("set-head").textContent)) === "Designs"; if (!found) await press(page, "ArrowDown", 110); }
  const rows = await page.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
  for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(page, "Escape", 250);
  await page.waitForTimeout(600);
  return rows;
}

console.log("Running the live group's browser tests" + (LIVE ? " against the real services" : " (real answers saved 20 Nov 2026)") + "...");
TV = await tvPage(ALL8);
const tvp = TV;
// ---- appears only when on screen: Home settings, Hold OK, the phone ----
{
  const rows = (await homeSettingsRows(tvp)).join(" | ");
  KINDS.forEach((k) => ok(rows.indexOf(TITLES[k] + ", ") >= 0, "Home settings, Widgets on this home lists " + TITLES[k] + ": " + rows.slice(0, 500)));
  for (const [id, k] of [["sp", "sports"], ["nw", "news"], ["st", "stocks"], ["cm", "commute"], ["qt", "quote"], ["wd", "word"], ["ak", "ask"], ["ag", "agent"]]) {
    const items = await holdOn(tvp, id);
    ok(items.indexOf("Edit on the TV") >= 0, "Hold OK on " + TITLES[k] + ": Edit on the TV (" + items.join(", ") + ")");
  }
  // Edit on the TV opens the Scores page, and OK on Competition steps it with the remote
  await tvp.evaluate(() => window.CouchDesign.nav.focus("sp", 0)); await tvp.waitForTimeout(200);
  await tvp.keyboard.down("Enter"); await tvp.waitForTimeout(900); await tvp.keyboard.up("Enter"); await tvp.waitForTimeout(300);
  await press(tvp, "ArrowDown", 120); await press(tvp, "Enter", 700);
  ok(/Scores, top left/.test(await tvp.textContent("#set-head")), "Edit on the TV opens the Scores widget's own page: " + await tvp.textContent("#set-head"));
  const pg = (await tvp.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()))).join(" | ");
  ok(/Competition/.test(pg) && /Your team/.test(pg) && /Which games/.test(pg), "its page has Competition, Your team and Which games: " + pg.slice(0, 300));
  await press(tvp, "Enter", 600);   // Competition: NRL steps to the next, A-League (LEAGUE_OPTS order afl, nrl, aleague)
  ok((await setOf(tvp, "sp|sports", "league")).value === "aleague", "OK on Competition steps to the next choice with the remote");
  for (let k = 0; k < 6 && await tvp.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(tvp, "Escape", 250);
  await edit(tvp, "sp|sports", { league: null });
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await ctx.newPage();
phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
await phone.goto(ORIGIN + "/setup#pin=482913");
await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
// (23 Nov) the phone opens on Widgets on your screen; the list these checks use is under More settings
await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {});
await phone.waitForFunction(() => document.getElementById("widgets").style.display === "", null, { timeout: 10000 });
{
  const titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list details.wbox summary")].map((e) => e.textContent));
  KINDS.forEach((k) => ok(titles.some((t) => t.indexOf(TITLES[k] + ", ") === 0), "the phone's Widgets on this TV lists " + TITLES[k] + " (" + titles.join("; ") + ")"));
}

// ---- 3. every setting changes the drawn widget; clearing goes back ----
const ESPN_TODAY = LIVE ? null : { nrl: "Roosters", afl: "Sydney Swans", epl: "Man City", bbl: "Melbourne Renegades", nba: "Grizzlies" };
// Scores
{
  let t = await waitW(tvp, "sp", LIVE ? /^(?!Getting|The scores)\w/ : "Roosters", "Scores: the NRL by default");
  if (!LIVE) ok(/Season over/.test(t) && !/Round 4/.test(t), "NRL now: the grand final with Season over, never Round 4: " + t);
  // the team picker from ESPN's own list (the phone draws it as a choice)
  let r = await edit(tvp, "sp|sports", { league: "afl" });
  ok(r.ok, "Competition AFL saved");
  t = await waitW(tvp, "sp", LIVE ? /AFL/ : /Starts 17 Mar/, "Scores: the AFL between seasons");
  if (!LIVE) ok(/Sydney Swans/.test(t) && !/Roosters/.test(t), "the widget changed to the AFL's games: " + t.slice(0, 160));
  await tvp.waitForFunction(() => { const d = tv.atHomeRead().design; const s = d.widgets.filter((w) => w.key === "sp|sports")[0].settings.filter((x) => x.key === "team")[0]; return s.options.length > 10; }, null, { timeout: 10000 });
  const team = await setOf(tvp, "sp|sports", "team");
  ok(team.type === "choice" && team.options.length === 18 && team.options.some((o) => o[0] === "Collingwood") && !team.options.some((o) => o[0] === "Roosters"), "Your team is a pick from the AFL's 18 teams (" + team.options.length + ")");
  r = await edit(tvp, "sp|sports", { team: "Roosters" });
  ok(!r.ok && /Roosters is not a team in the AFL/.test(r.error), "a team from another competition is refused: " + r.error);
  r = await edit(tvp, "sp|sports", { team: "Geelong Cats" });
  ok(r.ok, "Geelong Cats saved");
  r = await edit(tvp, "sp|sports", { games: "mine" });
  t = await waitW(tvp, "sp", "Geelong", "Only my team");
  ok(!/Fremantle|Hawthorn/.test(t), "Only my team: Geelong's game only: " + t.slice(0, 200));
  r = await edit(tvp, "sp|sports", { team: null });
  // (23 Nov: the widget names itself and asks for its team on the phone: "Your team's games", Set up on your phone)
  t = await waitW(tvp, "sp", "Your team's games", "Only my team with no team");
  // the phone's own select for Your team, the way a person picks it
  await phone.evaluate(() => window.couchTv && null);
  r = await edit(tvp, "sp|sports", { league: "epl", team: "Manchester City", games: "live" });
  ok(r.ok, "Premier League, Manchester City, Live games and my team: " + JSON.stringify(r.error || ""));
  t = await waitW(tvp, "sp", LIVE ? /^(?!Getting|The scores)\w/ : "Man City", "Live games and my team");
  if (!LIVE) ok(!/Bournemouth|Aston Villa/.test(t), "Live games and my team: City's game, no other (nothing is live): " + t.slice(0, 200));
  r = await edit(tvp, "sp|sports", { team: null });
  t = await waitW(tvp, "sp", LIVE ? /^(?!Getting|The scores)\w/ : "No live games right now", "Live games with no team and nothing live");
  if (!LIVE) ok(/Next: /.test(t), "and says when the next one starts: " + t);
  // Big Bash: whole team names, and all 8 teams to pick from its ladder
  r = await edit(tvp, "sp|sports", { league: "bbl", games: "all" });
  await waitW(tvp, "sp", LIVE ? /^(?!Getting|The scores)\w/ : "Melbourne Renegades", "Big Bash: whole team names");
  if (!LIVE) await waitW(tvp, "sp", "Starts 12 Dec", "Big Bash between seasons");
  await tvp.waitForFunction(() => { const d = tv.atHomeRead().design; return d.widgets.filter((w) => w.key === "sp|sports")[0].settings.filter((x) => x.key === "team")[0].options.length >= 8; }, null, { timeout: 10000 });
  ok((await setOf(tvp, "sp|sports", "team")).options.some((o) => o[0] === "Sydney Sixers"), "Big Bash: Sydney Sixers to pick, though not on the scoreboard now");
  // cricket: no ladder, so the team is typed and checked against the teams in its games
  r = await edit(tvp, "sp|sports", { league: "cricket" });
  await waitW(tvp, "sp", LIVE ? /^Cricket/ : "New Zealand", "Cricket");
  const bt = await setOf(tvp, "sp|sports", "team");
  ok(bt.type === "team" && bt.options.length === 0, "cricket: Your team is typed (no list)");
  r = await edit(tvp, "sp|sports", { team: LIVE ? (LIVE_ANS.cricket.games[0] || { teams: [{ full: "Australia" }] }).teams[0].full.toLowerCase() : "pakistan women" });
  ok(r.ok && (await setOf(tvp, "sp|sports", "team")).value === (LIVE ? (LIVE_ANS.cricket.games[0] || { teams: [{ full: "Australia" }] }).teams[0].full : "Pakistan Women"), "a typed team is checked and saved as the feed names it: " + (await setOf(tvp, "sp|sports", "team")).value);
  // a team from the design that is not in the competition picked on the TV says so
  const warn = await tvp.evaluate((v) => window.CouchWidgets.render({ id: "zz", kind: "sports", w: 760, h: 460, opts: { team: "Collingwood" } }, { wset: { zz: { league: "epl" } }, data: { web: { sports: { epl: { ok: true, at: Date.now(), v } } } } }).textContent, epl);
  ok(/Collingwood is not in the Premier League/.test(warn) && /Man City/.test(warn), "a design's team not in the competition picked on the TV says so, over the games (" + warn.slice(0, 120) + ")");
  // cleared: back to the NRL, every game
  await edit(tvp, "sp|sports", { league: null, team: null, games: null });
  t = await waitW(tvp, "sp", LIVE ? /NRL/ : "Roosters", "Scores cleared");
  ok(!/Perth|Man City/.test(t), "cleared: back to the NRL's games");
  // LIVE: every one of the 7 competitions, shown as ESPN answered it right now
  if (LIVE) for (const id of Object.keys(WW.LEAGUES)) {
    await edit(tvp, "sp|sports", { league: id });
    const v = LIVE_ANS[id], first = WW.scoreOrder(v.games, "", Date.now())[0];
    const want = first ? first.teams[0].name : "No " + WW.LEAGUES[id].name + " games right now";
    t = await waitW(tvp, "sp", want, "LIVE " + id);
    console.log("LIVE widget " + id + ": " + t.slice(0, 200));
  }
  await edit(tvp, "sp|sports", { league: null });
}
// Headlines
{
  const first = (f) => WW.parseRss(fs.readFileSync(path.join(FIX, "..", f), "utf8"), 12)[0].title;
  let t = await waitW(tvp, "nw", "ABC News", "Headlines: Best for your country is ABC News in Australia");
  if (!LIVE) ok(t.indexOf(first("rss-abc-top.xml").slice(0, 30)) >= 0, "ABC's newest headline");
  await edit(tvp, "nw|news", { feed: "bbc" });
  t = await waitW(tvp, "nw", "BBC World", "News source BBC World");
  if (!LIVE) ok(t.indexOf(first("rss-bbc.xml").slice(0, 30)) >= 0, "BBC's newest headline: " + t.slice(0, 160));
  const many = await tvp.evaluate(() => document.querySelectorAll('.cw-o[data-obj="nw"] .cw [data-drop]').length);
  await edit(tvp, "nw|news", { count: 1 });
  await tvp.waitForTimeout(800);
  const one = await tvp.evaluate(() => document.querySelectorAll('.cw-o[data-obj="nw"] .cw [data-drop]').length);
  ok(many > 1 && one === 1, "How many headlines 1: one headline (was " + many + ")");
  await edit(tvp, "nw|news", { feed: null, count: null });
  t = await waitW(tvp, "nw", "ABC News", "Headlines cleared");
  ok(await tvp.evaluate(() => document.querySelectorAll('.cw-o[data-obj="nw"] .cw [data-drop]').length) === many, "cleared: as many as fit again");
}
// Markets
{
  let t = await waitW(tvp, "st", "ASX 200", "Markets: the defaults");
  await edit(tvp, "st|stocks", { tickers: ["BHP.AX", "CBA.AX"] });
  t = await waitW(tvp, "st", "BHP", "Watchlist BHP.AX, CBA.AX");
  ok(/Cwlth Bank|CBA/.test(t) && !/ASX 200/.test(t), "the watchlist shows BHP and CBA, not the defaults: " + t);
  if (!LIVE) ok(/\$51\.40/.test(t), "with BHP's price from Yahoo");
  await edit(tvp, "st|stocks", { price: false });
  await tvp.waitForTimeout(800); t = await wtext(tvp, "st");
  ok(!/\$\d/.test(t) && /%/.test(t), "Show the price off: only the move: " + t);
  await edit(tvp, "st|stocks", { tickers: ["hello!"] });
  t = await waitW(tvp, "st", "Not a share code", "a typed word that is not a share code");
  await edit(tvp, "st|stocks", { tickers: null, price: null });
  t = await waitW(tvp, "st", "ASX 200", "Markets cleared");
  ok(/\d/.test(t), "cleared: the defaults with prices again");
}
// Commute
{
  let t = await waitW(tvp, "cm", "Set where you drive to", "Commute with no Where to");
  await edit(tvp, "cm|commute", { to: { name: "Chatswood", lat: -33.8, lon: 151.18, timezone: "Australia/Sydney" } });
  t = await waitW(tvp, "cm", /\d+ ?min/, "Where to Chatswood");
  if (!LIVE) ok(/27 ?min/.test(t) && /To Chatswood/.test(t), "OSRM's drive, 27 min, to Chatswood: " + t);
  ok(/Set an arrive by time/.test(t), "with no arrive time, it says where to set one");
  await edit(tvp, "cm|commute", { arrive_h: 8, arrive_m: 30 });
  const a = await waitW(tvp, "cm", "for 8:30am", "Arrive by 8:30am");
  await edit(tvp, "cm|commute", { buffer: 30 });
  await tvp.waitForTimeout(600);
  const b = await wtext(tvp, "cm");
  const lb = (s) => (/leave by (\d+:\d+[ap]m)/i.exec(s) || [])[1];
  ok(lb(a) && lb(b) && lb(a) !== lb(b), "Minutes to spare 30 leaves 20 minutes earlier: " + lb(a) + " then " + lb(b));
  await edit(tvp, "cm|commute", { weekdays: false });
  await tvp.waitForTimeout(600);
  const c = await wtext(tvp, "cm");
  const want = await tvp.evaluate(() => { const W = window.CouchWidgetWeb, x = W.leaveBy(27, 8, 30, 30, Date.now(), false), y = W.leaveBy(27, 8, 30, 30, Date.now(), true); return [x && x.day, y && y.day]; });
  if (LIVE) ok(/leave by/i.test(c), "Weekdays only off: still a leave by line");
  else ok(want[0] === want[1] ? true : c.indexOf((want[0] ? want[0] + ", leave by" : "Leave by")) >= 0, "Weekdays only off: the next day it is needed, weekends too (" + want.join(" vs ") + "): " + c);
  const before = asked.length;
  await edit(tvp, "cm|commute", { from: { name: "Ryde", lat: -33.81, lon: 151.1, timezone: "Australia/Sydney" } });
  await tvp.waitForTimeout(1500);
  ok(asked.slice(before).some((u) => /project-osrm.*151\.1,-33\.81;151\.18,-33\.8/.test(u)), "Leave from Ryde: the drive is asked from Ryde (" + asked.slice(before).join(", ") + ")");
  await edit(tvp, "cm|commute", { to: null, from: null, arrive_h: null, arrive_m: null, buffer: null, weekdays: null });
  t = await waitW(tvp, "cm", "Set where you drive to", "Commute cleared");
}
// Quote
{
  const today = await tvp.evaluate(() => { const d = new Date(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); });
  const Wd = await tvp.evaluate(() => ({ all: window.CouchWords.quotes, calm: window.CouchWords.quotesFor("calm"), go: window.CouchWords.quotesFor("go") }));
  let t = await wtext(tvp, "qt");
  ok(t.indexOf(Wd.all[today % Wd.all.length]) >= 0, "Quote: today's line from all of them: " + t);
  await edit(tvp, "qt|quote", { mood: "go" });
  await tvp.waitForTimeout(500); t = await wtext(tvp, "qt");
  ok(t.indexOf(Wd.go[today % Wd.go.length]) >= 0 && Wd.go.length < Wd.all.length, "Kind of line Get going: today's line from those: " + t);
  await edit(tvp, "qt|quote", { text: "Dinner is at six", sub: "Mum" });
  t = await waitW(tvp, "qt", "Dinner is at six", "Your own words");
  ok(/Mum/.test(t), "Who said it: " + t);
  ok((await setOf(tvp, "qt|quote", "sub")).shown === true, "Who said it shows once there are own words");
  await edit(tvp, "qt|quote", { text: null, sub: null, mood: null });
  await tvp.waitForTimeout(500); t = await wtext(tvp, "qt");
  ok(t.indexOf(Wd.all[today % Wd.all.length]) >= 0 && !/Mum/.test(t), "cleared: today's line again");
  ok((await setOf(tvp, "qt|quote", "sub")).shown === false, "Who said it hides without own words");
}
// Word of the day
{
  let t = await wtext(tvp, "wd");
  ok(/^Word of the day/.test(t), "Word of the day in English: " + t);
  const es = await tvp.evaluate(() => { const d = new Date(), i = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); const l = window.CouchWords.wordsIn.es; return l[i % l.length]; });
  await edit(tvp, "wd|word", { lang: "es" });
  t = await waitW(tvp, "wd", "Word of the day, in Spanish", "Words in Spanish");
  ok(t.indexOf(es[0]) >= 0 && t.indexOf(es[2]) >= 0, "today's Spanish word and what it means: " + t);
  await edit(tvp, "wd|word", { meaning: false });
  await tvp.waitForTimeout(500); t = await wtext(tvp, "wd");
  ok(t.indexOf(es[0]) >= 0 && t.indexOf(es[2]) < 0, "Show what it means off: the word without its meaning: " + t);
  await edit(tvp, "wd|word", { lang: null, meaning: null });
  await tvp.waitForTimeout(500); t = await wtext(tvp, "wd");
  ok(/^Word of the day/.test(t) && t.indexOf(es[0]) < 0, "cleared: English again");
}
// Ask AI (its last answer was an hour and a half ago)
{
  let t = await waitW(tvp, "ak", "384,000", "Ask AI shows the last answer");
  await edit(tvp, "ak|ask", { keep: "never" });
  t = await waitW(tvp, "ak", "Press OK, then type", "Show the last answer: No");
  ok(!/384,000|moon/.test(t), "No: the question and answer stay private: " + t);
  await edit(tvp, "ak|ask", { keep: "hour" });
  await tvp.waitForTimeout(500); t = await wtext(tvp, "ak");
  ok(/Press OK, then type/.test(t), "For an hour: an answer from an hour and a half ago is gone: " + t);
  await edit(tvp, "ak|ask", { keep: null });
  t = await waitW(tvp, "ak", "384,000", "Ask AI cleared");
}
// From your AI
{
  await tvp.evaluate(() => window.CouchAsk._test.took({ message: { text: "Dinner is ready", from: "Claude", at: Date.now() - 2 * 3600000 } }, Date.now()));
  await tvp.evaluate(() => window.CouchDesign.dataChanged && window.CouchDesign.dataChanged("ask"));
  let t = await waitW(tvp, "ag", "Dinner is ready", "From your AI: the message");
  ok(/From Claude/.test(t), "it names the agent: " + t);
  await edit(tvp, "ag|agent", { who: false });
  t = await waitW(tvp, "ag", "From your AI", "Show who sent it off");
  ok(!/Claude/.test(t), "no agent's name: " + t);
  await edit(tvp, "ag|agent", { keep: "hour" });
  t = await waitW(tvp, "ag", /Nothing from your AI|Connect your AI/, "Show each message for an hour: a message from two hours ago");
  ok(!/Dinner/.test(t), "the old message is gone: " + t);
  await edit(tvp, "ag|agent", { keep: null, who: null });
  t = await waitW(tvp, "ag", "From Claude", "From your AI cleared");
}
// the phone sets one too, through its own page: Words in, a select
{
  await phone.reload(); await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {}); await phone.waitForFunction(() => document.getElementById("widgets").style.display === "", null, { timeout: 10000 });
  await phone.evaluate(() => { const d = [...document.querySelectorAll("#w-list details.wbox")].find((x) => /^Word of the day/.test(x.querySelector("summary").textContent)); d.open = true; });
  const sel = phone.locator('#w-list select[data-ws="lang"]');
  await sel.selectOption("fr");
  const t = await waitW(tvp, "wd", "Word of the day, in French", "the phone's Words in French");
  ok(/French/.test(t), "the phone's pick shows on the TV");
  const teamSel = await phone.evaluate(() => !!document.querySelector('#w-list [data-ws="team"]'));
  ok(teamSel, "the phone has Your team for Scores");
  await edit(tvp, "wd|word", { lang: null });
}
// a design from Couch TV Studio keeps these widgets' choices, and drops anything else in them
{
  const kept = await tvp.evaluate(() => {
    const o = (kind, opts) => ({ id: kind, type: "widget", kind, x: 0, y: 0, w: 400, h: 300, opts });
    const d = window.CouchDesign.sanitize({ v: 1, objects: [o("sports", { league: "nba", team: "Philadelphia 76ers", games: "mine" }), o("quote", { mood: "calm" }), o("word", { lang: "ja", meaning: false }),
      o("ask", { keep: "never" }), o("agent", { keep: "day", who: false }), o("news", { feed: "rnz", count: 2 }), o("stocks", { tickers: ["BHP.AX"], price: false }),
      o("commute", { arrive_h: 8, arrive_m: 30, buffer: 15, weekdays: false }), o("sports", { team: "eyJhbGciOiJIUzI1NiJ9abc" }), o("word", { lang: "klingon", meaning: "yes" }), o("sports", { team: "Brighton & Hove Albion" })] });
    return d.objects.map((x) => x.opts || {});
  });
  ok(JSON.stringify(kept.slice(0, 8)) === JSON.stringify([{ league: "nba", team: "Philadelphia 76ers", games: "mine" }, { mood: "calm" }, { lang: "ja", meaning: false }, { keep: "never" }, { keep: "day", who: false },
    { feed: "rnz", count: 2 }, { tickers: ["BHP.AX"], price: false }, { arrive_h: 8, arrive_m: 30, buffer: 15, weekdays: false }]), "a design keeps every one of these settings: " + JSON.stringify(kept.slice(0, 8)));
  ok(!kept[8].team && !kept[9].lang && kept[9].meaning === undefined && kept[10].team === "Brighton & Hove Albion", "and drops a token for a team and a language it does not have: " + JSON.stringify(kept.slice(8)));
}
ok(!tvp.errors.length, "no page errors on the TV: " + tvp.errors.join("; "));
ok(!phone.errors.length, "no page errors on the phone: " + phone.errors.join("; "));

// ---- a design without them: none of their settings anywhere ----
{
  const other = await tvPage(NONE);
  TV = other;
  const rows = (await homeSettingsRows(other)).join(" | ");
  ["sports", "stocks", "commute", "quote", "word", "ask", "agent"].forEach((k) => ok(rows.indexOf(TITLES[k] + ", ") < 0, "not on the design: no " + TITLES[k] + " in Home settings"));
  ok(/Headlines, /.test(rows), "the Headlines still on it is listed");
  const keys = (await design(other)).widgets.map((w) => w.kind);
  ok(keys.indexOf("news") >= 0 && !keys.some((k) => k !== "news" && KINDS.indexOf(k) >= 0), "the phone hears the Headlines and none of this group's other widgets (" + keys.join(", ") + ")");
  await phone.reload(); await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {}); await phone.waitForFunction(() => document.getElementById("widgets").style.display === "", null, { timeout: 10000 });
  const titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list details.wbox summary")].map((e) => e.textContent));
  ok(titles.some((t) => /^Headlines, /.test(t)) && !titles.some((t) => ["sports", "stocks", "commute", "quote", "word", "ask", "agent"].some((k) => t.indexOf(TITLES[k] + ", ") === 0)), "the phone's Widgets on this TV: Headlines, none of the others (" + titles.join("; ") + ")");
  ok(!other.errors.length, "no page errors: " + other.errors.join("; "));
  await other.close();
}
await browser.close();
server.close();
console.log("All " + n + " live group checks passed" + (LIVE ? " against the real services." : "."));
