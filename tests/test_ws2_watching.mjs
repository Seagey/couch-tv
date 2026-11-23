// Widget settings, round 2, the watching, apps and music widgets (keep, keeprow, upnext, picks, nowplaying,
// queue, soundscape, games, app, appgrid, dock, folder, quick, stack), in a real browser:
//  A. every setting changes the drawn widget, and clearing it goes back to the default (widgets.js, the
//     settings set on this TV in env.wset, the design's own in opts);
//  B. on the real TV home (?mock=1 with a design): each widget's settings show in Home settings, Widgets on
//     this home, in Hold OK (Edit on the TV, Edit on your phone, Edit the stack on the TV) and on the phone's
//     Widgets on this TV, only while the widget is on the design; a setting saved the phone's way changes the
//     live home; OK on a Soundscape plays its own sound; a real TV never shows the demo.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_watching.mjs
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
const ok = (c, m) => { assert.ok(c, m); n++; };
const counts = {};
const tested = (kind, key) => { counts[kind + "." + key] = (counts[kind + "." + key] || 0) + 1; };

// ---- a stand-in on-TV app (the same shape as test_design_settings_browser.mjs) ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const TOKEN = "t0k3n";
let TV = null;
const HS = { settings: { lang: "en", photos: [] }, people: [{ id: "sam", name: "Sam" }], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400, adb: { connected: false, sdk: 34, state: "idle" }, xiaomi: false };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks), body = () => { try { return JSON.parse(raw.toString() || "{}"); } catch (e) { return {}; } };
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN || (req.headers.cookie || "").includes("couchtv_token=" + TOKEN);
    if (u.pathname === "/tv-home/web/ws2.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", u.pathname.slice(6)))); return; }
    if (u.pathname === "/api/pair") return body().pin === "482913" ? send(res, 200, { ok: true, token: TOKEN }) : send(res, 401, { ok: false });
    if (u.pathname.startsWith("/api/")) {
      if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
      const route = req.method + " " + u.pathname;
      if (route === "GET /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "POST /api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
      if (route === "GET /api/athome") {
        const r = TV ? await TV.evaluate(() => window.tv && tv.atHomeRead ? tv.atHomeRead() : null) : null;
        return send(res, 200, r ? { ok: true, live: true, athome: r } : { ok: true, live: false });
      }
      if (route === "POST /api/athome") {
        const r = TV ? await TV.evaluate((x) => tv.atHomeEdit(x), body().edit) : null;
        if (!r) return send(res, 200, { ok: true, live: false, queued: true });
        return r.ok ? send(res, 200, { ok: true, live: true, athome: r.athome }) : send(res, 400, { ok: false, error: r.error || "That did not save." });
      }
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
const ORIGIN = "http://127.0.0.1:" + server.address().port;

console.log("Running the watching, apps and music widgets' settings tests...");
const browser = await chromium.launch();

// ================= A. each setting changes the drawn widget =================
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(ORIGIN + "/tv-home/web/ws2.html");
await page.waitForFunction(() => window.CouchWidgets && window.CouchDetail && window.CouchWidgetCaps && window.CouchWidgetWeb);

// draw a widget; wset is this TV's settings for it (null: none). Answers what the checks need.
async function draw(o, data, wset, extra) {
  return page.evaluate(([o, data, wset, extra]) => {
    document.querySelectorAll(".ws-host").forEach((h) => h.remove());
    const host = document.createElement("div");
    host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:0;top:0";
    document.body.appendChild(host);
    const env = Object.assign({ data: Object.assign({}, data, wset ? { wset: { [o.id]: wset } } : {}) }, extra && extra.env || {});
    if (extra && extra.edits) env.edits = (id, kind) => extra.edits[id + "|" + kind] || null;
    const root = window.CouchWidgets.render(Object.assign({ w: 1200, h: 520 }, o), env);
    host.appendChild(root);
    const acts = [...root.querySelectorAll("[data-act]")].concat(root.hasAttribute("data-act") ? [root] : []);
    const tops = new Set([...root.querySelectorAll(".cw-app")].map((e) => Math.round(e.getBoundingClientRect().top)));
    return { text: root.textContent.replace(/\s+/g, " ").trim(), empty: root.getAttribute("data-empty") === "1",
      acts: acts.map((e) => e.getAttribute("data-act") + ":" + (e.getAttribute("data-arg") || "")), sound: root.getAttribute("data-sound"), turn: root.getAttribute("data-turn"),
      more: root.querySelectorAll(".cw-more").length, buttons: root.querySelectorAll(".cw-np-buttons").length, posters: root.querySelectorAll(".cw-poster").length,
      covers: [...root.querySelectorAll("div")].filter((e) => /scene-/.test(e.style.backgroundImage || "")).length, appRows: tops.size,
      apps: [...root.querySelectorAll('[data-act="app"],[data-act="missing"]')].map((e) => e.getAttribute("data-arg")) };
  }, [o, data, wset, extra || null]);
}
const show = (title, pkg, extra) => Object.assign({ title, season: 1, episode: 2, app: { package: pkg, name: pkg }, backdrop: "../web/backgrounds/scene-night.jpg", progress: 0.4 }, extra || {});
const INSTALLED = ["com.netflix.ninja", "au.com.stan.and", "au.com.kayosports.tv", "com.google.android.youtube.tv", "au.net.abc.iview", "com.disney.disneyplus", "com.spotify.tv.android"].map((p) => ({ package: p, name: p.split(".")[2] }));
const MINE = [show("Ozark", "com.netflix.ninja"), show("Bluey", "au.net.abc.iview"), show("Titans v Broncos", "au.com.kayosports.tv"), show("Rake", "au.com.stan.and"), show("Wakefield", "au.com.stan.and", { progress: 0.3 })];
const BENS = [show("The Bear", "com.disney.disneyplus"), show("Utopia", "au.com.stan.and")];
const WATCH = { who: "sam", shows: MINE, apps: INSTALLED, bridge: true,
  people: [{ id: "sam", name: "Sam" }, { id: "ben", name: "Ben" }],
  household: [{ id: "sam", name: "Sam", shows: MINE }, { id: "ben", name: "Ben", shows: BENS }] };

// keep: Whose shows
{
  const o = { id: "k", kind: "keep", w: 700, h: 400 };
  let a = await draw(o, WATCH), b = await draw(o, WATCH, { person: "ben" }), c = await draw(o, WATCH, { person: "auto" });
  ok(/Ozark/.test(a.text) && !/The Bear/.test(a.text), "keep: whoever is watching by default: " + a.text);
  ok(/The Bear/.test(b.text) && /Ben is watching/.test(b.text) && !/Ozark/.test(b.text), "keep, Whose shows Ben: Ben's shows, named: " + b.text);
  ok(/Ozark/.test(c.text), "keep: Whoever is watching again");
  const lay = await page.evaluate((d) => { const o = { id: "k", kind: "keep", w: 700, h: 400 }, env = { data: Object.assign({}, d, { wset: { k: { person: "ben" } } }) };
    const root = window.CouchWidgets.render(o, env); document.body.appendChild(root); window.CouchDetail.open(root, env, { designer: false });
    const st = document.querySelector(".cwd-stage"), t = st ? st.textContent : ""; window.CouchDetail.close(true); root.remove(); return t; }, WATCH);
  ok(/What Ben has on the go/.test(lay) && /The Bear/.test(lay), "keep's layer opens Ben's shows too: " + lay.slice(0, 120));
  // Ben's show plays as Ben's (app.js pshow "ben|0"), never as the shelf's first show
  const kr = await draw({ id: "kr", kind: "keeprow" }, WATCH, { person: "ben" });
  ok(kr.acts.indexOf("pshow:ben|0") >= 0 && kr.acts.indexOf("show:0") < 0, "a poster of Ben's plays Ben's own show: " + kr.acts.join(","));
  // a person no longer on this TV: whoever is watching, never empty
  const gone = await draw(o, WATCH, { person: "zoe" });
  ok(/Ozark/.test(gone.text), "keep: a person who left this TV falls back to whoever is watching");
  tested("keep", "person");
}
// keeprow: heading, how many, whose shows
{
  const o = { id: "kr", kind: "keeprow", w: 1900, h: 460 };
  let a = await draw(o, WATCH), b = await draw(o, WATCH, { shows: 2 }), c = await draw(o, WATCH, { label: "Our shows" }), d = await draw(o, WATCH, { person: "ben" });
  ok(a.posters >= 4 && b.posters === 2, "keeprow, How many shows 2: " + a.posters + " then " + b.posters); tested("keeprow", "shows");
  ok(/Keep watching/.test(a.text) && /Our shows/.test(c.text) && !/Keep watching/.test(c.text), "keeprow, Heading: " + c.text.slice(0, 60)); tested("keeprow", "label");
  ok(/The Bear/.test(d.text) && /Ben is watching/.test(d.text) && !/Ozark/.test(d.text), "keeprow, Whose shows Ben: " + d.text.slice(0, 80)); tested("keeprow", "person");
  ok((await draw(o, WATCH, {})).posters === a.posters, "keeprow: cleared, as many as fit again");
  const des = await draw(Object.assign({ opts: { shows: 3 } }, o), WATCH);
  ok(des.posters === 3 && (await draw(Object.assign({ opts: { shows: 3 } }, o), WATCH, { shows: "auto" })).posters === a.posters, "keeprow: the design's 3, and As many as fit set on the TV over it");
}
// upnext: game mode, only from these apps
{
  const o = { id: "u", kind: "upnext", w: 1200, h: 600 };
  let a = await draw(o, WATCH), b = await draw(o, WATCH, { sport: true }), c = await draw(o, WATCH, { sport: false }, { env: { sport: true } }), d = await draw(o, WATCH, {}, { env: { sport: true } });
  ok(/Ozark/.test(a.text), "upnext: the first show by default: " + a.text.slice(0, 40));
  ok(/Titans v Broncos/.test(b.text), "upnext, Game mode On: the last game: " + b.text.slice(0, 40));
  ok(/Ozark/.test(c.text) && /Titans/.test(d.text), "upnext: Game mode Off beside Scores stays a show; Automatic beside Scores is the game"); tested("upnext", "sport");
  const e = await draw(o, WATCH, { apps: ["stan"] }), f = await draw(o, WATCH, { apps: ["prime"] }), g = await draw(Object.assign({ opts: { apps: ["iview"] } }, o), WATCH);
  ok(/Rake/.test(e.text) && !/Ozark/.test(e.text), "upnext, Only from Stan: Stan's show: " + e.text.slice(0, 40));
  ok(f.empty && /Nothing to keep watching from Prime Video/.test(f.text), "upnext, only Prime Video with none on the go says so: " + f.text);
  ok(/Bluey/.test(g.text), "upnext: the design's ABC iview, by catalogue id"); tested("upnext", "apps");
  ok(/Ozark/.test((await draw(o, WATCH, {})).text), "upnext: cleared, any app again");
  // at most 6 apps, however it was saved: Netflix 7th is left out, so Ozark never shows
  const six = ["prime", "binge", "sbs", "7plus", "9now", "10play"];
  const h = await draw(o, WATCH, { apps: six.concat(["netflix"]) }), i = await draw(o, WATCH, { apps: six.slice(0, 5).concat(["netflix"]) });
  ok(h.empty && !/Ozark/.test(h.text), "upnext: a 7th app is left out (6 at most): " + h.text.slice(0, 60));
  ok(/Ozark/.test(i.text), "upnext: Netflix as the 6th app counts");
}
// picks: heading, picks from
{
  const o = { id: "p", kind: "picks", w: 1900, h: 460 };
  const HH = Object.assign({}, WATCH, { household: [{ id: "sam", name: "Sam", shows: MINE }, { id: "ben", name: "Ben", shows: BENS }] });
  let a = await draw(o, HH), b = await draw(o, HH, { mix: "others" }), c = await draw(o, HH, { mix: "mine" }), d = await draw(o, HH, { label: "For Sam" });
  ok(/Ben is watching/.test(a.text) && /Pick up again/.test(a.text), "picks: both kinds by default: " + a.text.slice(0, 120));
  ok(/Ben is watching/.test(b.text) && !/Pick up again/.test(b.text), "picks, Only what others are watching");
  ok(!/Ben is watching/.test(c.text) && /Pick up again/.test(c.text), "picks, Only your own shows");
  ok(c.acts.filter((x) => /^pick:/.test(x)).every((x) => +x.split(":")[1] >= 2), "picks: your own picks keep their place in the whole list, so OK plays the right one: " + c.acts.join(","));
  tested("picks", "mix");
  ok(/For Sam/.test(d.text) && /Picks for you/.test(a.text), "picks, Heading"); tested("picks", "label");
  // the full screen Picks (OK on it) says which picks it holds
  const sub = (wset) => page.evaluate(([o, d, wset]) => {
    const env = { data: Object.assign({}, d, wset ? { wset: { [o.id]: wset } } : {}) };
    const host = document.createElement("div"); host.className = "cw-o"; host.setAttribute("data-obj", o.id); document.body.appendChild(host);
    const r = window.CouchWidgets.render(o, env); host.appendChild(r);
    window.CouchDetail.open(r, env, {});
    const t = (document.querySelector(".cwd-panel") || {}).textContent || "";
    window.CouchDetail.close(true); host.remove(); return t;
  }, [o, HH, wset || null]);
  const sa = await sub(), sb = await sub({ mix: "others" }), sc = await sub({ mix: "mine" }), sd = await sub({});
  ok(/From what everyone at home is watching on this TV/.test(sa), "picks full screen: everyone by default: " + sa.slice(0, 120));
  ok(/What others at home are watching/.test(sb) && !/From what everyone/.test(sb), "picks full screen, Only what others are watching: " + sb.slice(0, 120));
  ok(/Shows you left part way/.test(sc) && !/From what everyone/.test(sc), "picks full screen, Only your own shows: " + sc.slice(0, 120));
  ok(/From what everyone at home is watching on this TV/.test(sd), "picks full screen: cleared, everyone again");
}
// nowplaying: buttons, cover
{
  const o = { id: "np", kind: "nowplaying", w: 1200, h: 520 };
  const M = Object.assign({}, WATCH, { music: { title: "Riptide", artist: "Vance Joy", art: "../web/backgrounds/scene-golden.jpg", state: "playing", package: "com.spotify.tv.android", source: "Spotify", position: 30, duration: 200 } });
  let a = await draw(o, M), b = await draw(o, M, { buttons: false }), c = await draw(o, M, { cover: false });
  ok(a.buttons === 1 && b.buttons === 0, "nowplaying, Show the buttons off: " + a.buttons + " then " + b.buttons); tested("nowplaying", "buttons");
  ok(a.covers >= 1 && c.covers === 0 && /Riptide/.test(c.text), "nowplaying, Show the cover off: the song only: " + a.covers + " then " + c.covers); tested("nowplaying", "cover");
  ok((await draw(o, M, {})).buttons === 1, "nowplaying: cleared, buttons again");
  const none = await draw(o, Object.assign({}, WATCH, { music: null }));
  ok(none.empty && /Nothing playing/.test(none.text) && !/Riptide|Vance/.test(none.text), "nowplaying on a TV with nothing playing: no demo song");
}
// soundscape: sound, volume
{
  const o = { id: "sc", kind: "soundscape", w: 400, h: 360 };
  let a = await draw(o, WATCH), b = await draw(o, WATCH, { sound: "waves" }), c = await draw(o, WATCH, { volume: 80 }), d = await draw(Object.assign({ opts: { sound: "fire" } }, o), WATCH);
  ok(a.sound === "rain|50" && a.acts.indexOf("sound:rain|50") >= 0, "soundscape: rain at 50 by default: " + a.sound);
  ok(b.sound === "waves|50" && /Waves/.test(b.text), "soundscape, Sound waves: " + b.sound); tested("soundscape", "sound");
  ok(c.sound === "rain|80" && /80%/.test(c.text), "soundscape, Volume 80: " + c.sound); tested("soundscape", "volume");
  ok(d.sound === "fire|50", "soundscape: the design's fire");
  ok((await draw(o, WATCH, {})).sound === "rain|50", "soundscape: cleared, rain at 50 again");
}
// queue: heading, how many songs
{
  const o = { id: "q", kind: "queue", w: 900, h: 1060 };
  const Q = Object.assign({}, WATCH, { queue: { ok: true, items: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"].map((t) => ({ title: t + " song", artist: "Band" })) } });
  let a = await draw(o, Q), b = await draw(o, Q, { count: 3 }), c = await draw(o, Q, { label: "Next songs" });
  const songs = (r) => (r.text.match(/ song/g) || []).length;
  ok(songs(a) >= 5 && songs(b) === 3, "queue, How many songs 3: " + songs(a) + " then " + songs(b)); tested("queue", "count");
  ok(/Up next/.test(a.text) && /Next songs/.test(c.text), "queue, Heading"); tested("queue", "label");
  ok(songs(await draw(o, Q, {})) === songs(a), "queue: cleared");
  const off = await draw(o, Object.assign({}, WATCH, { queue: { ok: false } }));
  ok(off.empty && !/song/.test(off.text), "queue with Spotify not connected: the setup card, no songs: " + off.text);
}
// the app widgets: their apps (the design's, then Hold OK's edits on this TV) and their own settings
{
  const g = { id: "g", kind: "games", w: 1200, h: 460, opts: { apps: ["netflix"] } };
  let a = await draw(g, WATCH), b = await draw(g, WATCH, null, { edits: { "g|games": ["stan", "youtube"] } }), c = await draw(g, WATCH, { label: "Arcade" });
  ok(/Play/.test(a.text) && /Arcade/.test(c.text) && !/Play/.test(c.text.replace(/Display/g, "")), "games, Heading: " + c.text); tested("games", "label");
  ok(a.apps.join() === "com.netflix.ninja" && b.apps.join() === "au.com.stan.and,com.google.android.youtube.tv", "games, apps: the design's, then the TV's own changes: " + a.apps + " / " + b.apps); tested("games", "apps");
  const ap = { id: "ap", kind: "app", w: 360, h: 360, opts: { apps: ["netflix"] } };
  a = await draw(ap, WATCH); b = await draw(ap, WATCH, null, { edits: { "ap|app": ["stan"] } });
  ok(a.acts.join().indexOf("com.netflix.ninja") >= 0 && b.acts.join().indexOf("au.com.stan.and") >= 0, "app, App: Netflix, then Change app to Stan on the TV"); tested("app", "apps");
  const fo = { id: "fo", kind: "folder", w: 1200, h: 700, opts: { label: "Kids", apps: ["netflix", "stan", "youtube", "iview"] } };
  a = await draw(fo, WATCH); b = await draw(fo, WATCH, { cols: 1 }); c = await draw(fo, WATCH, { label: "Shows" });
  ok(/Kids/.test(a.text) && /Shows/.test(c.text) && !/Kids/.test(c.text), "folder, Folder name"); tested("folder", "label");
  ok(b.appRows >= 4 && a.appRows < b.appRows, "folder, Apps across 1: one app in each row: " + a.appRows + " then " + b.appRows); tested("folder", "cols");
  const fe = await draw(fo, WATCH, null, { edits: { "fo|folder": ["iview"] } });
  ok(fe.apps.join() === "au.net.abc.iview", "folder, apps: Hold OK's changes"); tested("folder", "apps");
  // a folder tile shows four small apps; its name, set on this TV, shows when it is opened (OK)
  const opened = await page.evaluate(([d]) => {
    const o = { id: "ft", kind: "folder", w: 160, h: 160, opts: { label: "Kids", apps: ["netflix", "stan", "youtube", "iview"] } };
    const env = { data: Object.assign({}, d, { wset: { ft: { label: "Shows" } } }) };
    const host = document.createElement("div"); host.className = "cw-o"; host.setAttribute("data-obj", "ft"); document.body.appendChild(host);
    const r = window.CouchWidgets.render(o, env); host.appendChild(r);
    const tile = r.textContent;
    window.CouchDetail.open(r, env, {});
    const t = (document.querySelector(".cwd-panel") || {}).textContent || "";
    window.CouchDetail.close(true); host.remove(); return { tile, t };
  }, [WATCH]);
  ok(!/Shows/.test(opened.tile) && /Shows/.test(opened.t) && !/Kids/.test(opened.t), "folder tile: the name set on this TV shows when it is opened: " + opened.t.slice(0, 60));
  const dk = { id: "dk", kind: "dock", w: 1600, h: 160, opts: { apps: ["netflix", "stan"] } };
  a = await draw(dk, WATCH); b = await draw(dk, WATCH, { more: false }); c = await draw(Object.assign({}, dk, { opts: { apps: ["netflix"], more: false } }), WATCH, { more: true });
  ok(a.more === 1 && b.more === 0 && c.more === 1, "dock, All apps at the end: on, off, and on over the design's off"); tested("dock", "more");
  ok(a.apps.join() === "com.netflix.ninja,au.com.stan.and" && (await draw(dk, WATCH, null, { edits: { "dk|dock": ["youtube"] } })).apps.join() === "com.google.android.youtube.tv", "dock, apps"); tested("dock", "apps");
  const ag = { id: "ag", kind: "appgrid", w: 1200, h: 800, opts: { apps: ["netflix", "stan", "youtube", "iview"] } };
  a = await draw(ag, WATCH); b = await draw(ag, WATCH, { cols: 1 }); c = await draw(ag, WATCH, { names: false });
  ok(a.appRows < b.appRows, "appgrid, Apps across 1: " + a.appRows + " then " + b.appRows); tested("appgrid", "cols");
  ok(/ninja|netflix|Netflix/i.test(a.text) && !/Netflix/.test(c.text) && c.text.length < a.text.length, "appgrid, Show app names off: " + a.text.slice(0, 60) + " / " + c.text.slice(0, 60)); tested("appgrid", "names");
  ok((await draw(ag, WATCH, null, { edits: { "ag|appgrid": ["stan"] } })).apps.join() === "au.com.stan.and", "appgrid, apps"); tested("appgrid", "apps");
  ok((await draw(ag, WATCH, {})).appRows === a.appRows, "appgrid: cleared, as many as fit");
}
// quick: buttons, only ones this TV can do
{
  const o = { id: "qk", kind: "quick", w: 900, h: 96 };
  const Q = Object.assign({}, WATCH, { quick: ["sleep", "picture", "input"], quickCan: ["sleep", "picture", "input", "soundscape", "screen_off"] });
  const args = (r) => r.acts.filter((x) => /^quick:/.test(x)).map((x) => x.slice(6)).join(",");
  let a = await draw(o, Q), b = await draw(o, Q, { quick: ["soundscape", "screen_off"] }), c = await draw(o, Q, { quick: ["look", "soundscape"] });
  ok(args(a) === "sleep,picture,input", "quick: the home's own buttons by default: " + args(a));
  ok(args(b) === "soundscape,screen_off", "quick, Buttons: the two picked: " + args(b));
  ok(args(c) === "soundscape", "quick: a button this TV cannot do (look here) is left out: " + args(c)); tested("quick", "quick");
  ok(args(await draw(o, Q, {})) === "sleep,picture,input", "quick: cleared");
}
// stack: when it moves on
{
  const o = { id: "st", kind: "stack", w: 700, h: 400, items: [{ kind: "clock" }, { kind: "keep" }] };
  let a = await draw(o, WATCH), b = await draw(o, WATCH, { turn: 0 }), c = await draw(Object.assign({ opts: { turn: 60 } }, o), WATCH), d = await draw(Object.assign({ turn: 30 }, o), WATCH);
  ok(a.turn === "20" && b.turn === "0" && c.turn === "60" && d.turn === "30", "stack, Next widget: 20 by default, By the time of day on this TV, the design's 60, an older design's 30: " + [a.turn, b.turn, c.turn, d.turn]); tested("stack", "turn");
  ok((await draw(o, WATCH, {})).turn === "20", "stack: cleared");
  // a widget in the stack keeps its own settings: the keep at place 1
  const it = await page.evaluate((d) => { const env = { data: Object.assign({}, d, { wset: { "st/1": { person: "ben" } } }) };
    const r = window.CouchWidgets.render({ id: "st", kind: "stack", w: 700, h: 400, items: [{ kind: "clock" }, { kind: "keep" }] }, env); return r.textContent; }, WATCH);
  ok(/The Bear/.test(it), "a Keep watching in a stack has its own Whose shows");
}
// a real TV never shows the demo: no shows, no song, no queue
{
  const E0 = { who: "sam", shows: [], apps: INSTALLED, bridge: true, people: [], household: [] };
  for (const k of ["keep", "keeprow", "upnext", "picks"]) {
    const r = await draw({ id: "x", kind: k, w: 1200, h: 500 }, E0);
    ok(r.empty && !/Bluey|Fisk|The Bear|Slow Horses|Bay of Fires|Mystery Road|Utopia/.test(r.text), k + ": nothing on the go shows plain words, never the demo: " + r.text);
  }
}
ok(!errors.length, "no page errors: " + errors.join("; "));
await page.close();

// ================= B. the real home: shown only while on the design =================
const KINDS = ["keep", "keeprow", "upnext", "picks", "nowplaying", "queue", "soundscape", "games", "app", "appgrid", "dock", "folder", "quick", "stack"];
const KEYS = { keep: ["person"], keeprow: ["label", "shows", "person"], upnext: ["sport", "apps"], picks: ["label", "mix"], nowplaying: ["buttons", "cover"], queue: ["label", "count"],
  soundscape: ["sound", "volume"], games: ["apps", "label"], app: ["apps"], appgrid: ["apps", "cols", "names"], dock: ["apps", "more"], folder: ["label", "apps", "cols"], quick: ["quick"], stack: ["turn"] };
const NAMES = { keep: "Keep watching", keeprow: "Keep watching row", upnext: "Up next", picks: "Picks for you", nowplaying: "Now playing", queue: "Up next queue", soundscape: "Soundscape",
  games: "Games", app: "One app", appgrid: "App grid", dock: "Dock", folder: "App folder", quick: "Quick buttons", stack: "Smart stack" };
const POS = { keep: [40, 40, 360, 360], keeprow: [420, 40, 760, 300], upnext: [1220, 40, 660, 360], picks: [40, 440, 760, 300], nowplaying: [840, 440, 520, 300], queue: [1400, 440, 480, 300],
  soundscape: [40, 780, 200, 200], games: [260, 780, 460, 200], app: [740, 780, 200, 200], appgrid: [960, 780, 300, 260], dock: [1280, 780, 600, 120], folder: [1280, 920, 300, 140], quick: [1600, 920, 300, 100], stack: [420, 360, 360, 60] };
const objects = KINDS.map((k) => { const p = POS[k]; const o = { id: "o" + k, type: "widget", kind: k, x: p[0], y: p[1], w: p[2], h: p[3] };
  if (k === "stack") { o.items = [{ kind: "clock" }, { kind: "date" }]; o.y = 1000; o.x = 40; o.w = 360; o.h = 70; }
  if (["games", "app", "appgrid", "dock", "folder"].indexOf(k) >= 0) o.opts = { apps: k === "app" ? ["netflix"] : ["netflix", "youtube"] };
  return o; });
const design = { v: 1, background: { colour: "#1d3a4f" }, elements: { dock: { hidden: true }, quick: { hidden: true }, people: { hidden: true }, keep_watching: { hidden: true } }, objects };
const without = { v: 1, background: { colour: "#1d3a4f" }, elements: design.elements, objects: objects.filter((o) => ["dock", "stack", "soundscape", "keep"].indexOf(o.kind) < 0) };
const GONE = ["dock", "stack", "soundscape", "keep"];

const press = async (p, k, wait) => { await p.keyboard.press(k); await p.waitForTimeout(wait || 160); };
async function tvPage(d, q) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.errors = []; p.on("pageerror", (e) => p.errors.push(String(e)));
  await p.route(/open-meteo\.com/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 22, weather_code: 1, is_day: 1 }, hourly: {}, daily: {} }) }));
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&reset=1");
  await p.evaluate((dz) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(dz)); }, d);
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&design=local" + (q || ""));
  await p.waitForFunction(() => window.tv && document.getElementById("settings") && window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o[data-obj] .cw"));
  await p.waitForTimeout(900);
  return p;
}
async function newDesign(p, d, q) {
  await p.evaluate((dz) => localStorage.setItem("tvdesigner.design", JSON.stringify(dz)), d);
  await p.goto(ORIGIN + "/tv-home/web/index.html?mock=1&design=local" + (q || ""));
  await p.waitForFunction(() => window.tv && window.CouchDesign && window.CouchDesign.on() && document.querySelector(".cw-o[data-obj] .cw"));
  await p.waitForTimeout(900);
}
const phoneView = (p) => p.evaluate(() => window.tv.atHomeRead().design);
async function homeRows(p) {
  await p.evaluate(() => window.tv.settingsKey()); await p.waitForTimeout(250); await press(p, "Enter", 500);
  const list = await p.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].map((e) => e.textContent.trim()));
  const i = list.indexOf("Designs");
  for (let k = 0; k < 4 && await p.evaluate(() => !document.querySelector("#set-secs .ssec.focus")); k++) await press(p, "ArrowLeft", 120);
  const at = await p.evaluate(() => [...document.querySelectorAll("#set-secs .ssec")].findIndex((e) => e.classList.contains("focus")));
  for (let k = 0; k < Math.abs(i - at); k++) await press(p, i > at ? "ArrowDown" : "ArrowUp", 80);
  await p.waitForTimeout(250);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
  for (let k = 0; k < 6 && await p.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(p, "Escape", 250);
  await p.waitForTimeout(700);
  return rows.join(" | ");
}
async function holdOn(p, id) {
  await p.evaluate((x) => window.CouchDesign.nav.focus(x, 0), id); await p.waitForTimeout(200);
  await p.keyboard.down("Enter"); await p.waitForTimeout(900); await p.keyboard.up("Enter"); await p.waitForTimeout(300);
  const m = await p.evaluate(() => ({ items: [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent), args: [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.getAttribute("data-arg")),
    note: (document.querySelector(".cw-sheet .cw-note") || {}).textContent || "" }));
  await press(p, "Escape", 300);
  return m;
}

const tv = TV = await tvPage(design, "&ontv=1");
{
  // the phone's list (designView, what the phone page draws): every kind, with its own settings
  const v = await phoneView(tv);
  KINDS.forEach((k) => {
    const w = v.widgets.filter((x) => x.key === "o" + k + "|" + k)[0];
    ok(!!w, k + " is in the phone's Widgets on this TV");
    ok(w && JSON.stringify(w.settings.map((s) => s.key)) === JSON.stringify(KEYS[k]), k + ": the phone offers " + KEYS[k].join(", ") + " (" + (w && w.settings.map((s) => s.key)) + ")");
  });
  ok(v.widgets.some((x) => x.key === "ostack/0|clock") , "a widget in the stack keeps its own settings too");
  const dock = v.widgets.filter((x) => x.key === "odock|dock")[0].settings.filter((s) => s.key === "apps")[0];
  ok(dock.words === "Netflix, YouTube", "the dock's apps setting names its apps: " + dock.words);
  const kp = v.widgets.filter((x) => x.key === "okeep|keep")[0].settings[0];
  ok(kp.words === "Whoever is watching" && kp.options[0][0] === "auto" && kp.options.length >= 2, "Whose shows: Whoever is watching, then the people on this TV: " + JSON.stringify(kp.options));
  // the TV's Home settings, Widgets on this home
  const rows = await homeRows(tv);
  KINDS.forEach((k) => ok(rows.indexOf(NAMES[k] + ", ") >= 0, k + " is in Home settings, Widgets on this home"));
  // Hold OK on each: Edit on the TV and Edit on your phone (the stack: its own, after the widget showing)
  for (const k of KINDS) {
    const m = await holdOn(tv, "o" + k);
    // the stack too: on the phone first, right after the widget showing in it, never "Edit the stack on the TV"
    if (k === "stack") ok(m.items[1] === "Edit the stack on your phone" && m.args[1] === "ostack|" && /^(Edit on your phone|.+: set up on your phone)$/.test(m.items[0]) && m.items.indexOf("Edit the stack on the TV") < 0, "Hold OK on the stack: the widget showing, then Edit the stack on your phone (" + m.items.join(", ") + ")");
    // (23 Nov) the phone first, "<Widget>: set up on your phone" while it waits; the TV's own page is behind "No phone? Set it up here"
    else ok(/^(Edit on your phone|.+: set up on your phone)$/.test(m.items[0]) && m.items.indexOf("Edit on the TV") < 0 && m.args[0].indexOf("o" + k + "|") === 0, "Hold OK on " + k + ": the phone first (" + m.items.join(", ") + ")");
  }
  // Edit on the TV opens the dock's own page, its apps named
  await tv.evaluate(() => window.CouchDesign.nav.focus("odock", 0)); await tv.waitForTimeout(200);
  await tv.keyboard.down("Enter"); await tv.waitForTimeout(900); await tv.keyboard.up("Enter"); await tv.waitForTimeout(300);
  const items = await tv.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
  await press(tv, "Enter", 800); await press(tv, "ArrowDown", 150); await press(tv, "Enter", 700);   // the phone's sheet, then No phone? Set it up here
  const head = await tv.textContent("#set-head"), pg = await tv.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()).join(" | "));
  ok(/Dock, bottom right/.test(head) && /Netflix, YouTube/.test(pg) && /All apps at the end/.test(pg) && /hold OK on an app/.test(pg), "No phone? Set it up here: the dock's page, its apps and the All apps tile: " + pg.slice(0, 200));
  for (let k = 0; k < 6 && await tv.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(tv, "Escape", 250);
  await tv.waitForTimeout(700);
}
{
  // a setting saved the phone's way changes the live home, and clearing brings the default back
  const more = () => tv.evaluate(() => document.querySelectorAll('.cw-o[data-obj="odock"] .cw-more').length);
  ok(await more() === 1, "the dock shows its All apps tile");
  let r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "odock|dock", values: { more: false } } })); await tv.waitForTimeout(600);
  ok(r.ok && await more() === 0, "All apps at the end off, from the phone: the tile goes");
  r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "odock|dock", values: { more: null } } })); await tv.waitForTimeout(600);
  ok(r.ok && await more() === 1, "cleared: the tile is back");
  r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "osoundscape|soundscape", values: { sound: "waves", volume: 70 } } })); await tv.waitForTimeout(600);
  ok(r.ok && await tv.evaluate(() => document.querySelector('.cw-o[data-obj="osoundscape"] .cw').getAttribute("data-sound")) === "waves|70", "Sound waves at 70 from the phone, on the live widget");
  // OK on it plays its own sound, OK again stops it
  await tv.evaluate(() => window.CouchDesign.nav.focus("osoundscape", -1)); await tv.waitForTimeout(200);
  await press(tv, "Enter", 500);
  const played = await tv.evaluate(() => [window.Soundscape.current(), Math.round(window.Soundscape.volume() * 100)]);
  ok(played[0] === "waves" && played[1] === 70, "OK on the Soundscape plays waves at 70: " + played);
  await press(tv, "Enter", 500);
  ok(await tv.evaluate(() => window.Soundscape.current()) === "off", "OK again stops it");
  r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "okeep|keep", values: { person: "nobody-here" } } }));
  ok(!r.ok, "Whose shows takes only a person on this TV: " + r.error);
  r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "oquick|quick", values: { quick: ["screen_off", "nope"] } } })); await tv.waitForTimeout(600);
  ok(r.ok && JSON.stringify(await tv.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="oquick"] [data-act="quick"]')].map((e) => e.getAttribute("data-arg")))) === '["screen_off"]', "Quick buttons from the phone: only real buttons");
  r = await tv.evaluate(() => window.tv.atHomeEdit({ widget_set: { key: "ostack|stack", values: { turn: 0 } } })); await tv.waitForTimeout(600);
  ok(r.ok && await tv.evaluate(() => document.querySelector('.cw-o[data-obj="ostack"] .cw-stack').getAttribute("data-turn")) === "0", "the stack's Next widget from the phone");
  // the home draws the TV's own data (the mock bridge's people), never the designer's demo person Alex
  ok(await tv.evaluate(() => !/Alex|Riverside/.test([...document.querySelectorAll(".cw-o")].map((e) => e.textContent).join(" "))), "the TV's widgets never draw the designer's demo");
}
{
  // the phone page itself: one box per widget with settings
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  phone.errors = []; phone.on("pageerror", (e) => phone.errors.push(String(e)));
  await phone.goto(ORIGIN + "/setup#pin=482913");
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  // (23 Nov) the phone opens on Widgets on your screen; the list these checks use is under More settings
  await phone.waitForFunction(() => document.body.classList.contains("gal"), null, { timeout: 8000 }).then(() => phone.click("#g-more"), () => {});
  await phone.waitForFunction(() => document.querySelectorAll("#w-list summary").length > 0, null, { timeout: 10000 });
  let titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent).join(" | "));
  KINDS.forEach((k) => ok(titles.indexOf(NAMES[k] + ", ") >= 0, k + " has a box on the phone page"));
  await phone.click('#w-list details[data-key="opicks|picks"] summary');
  await phone.selectOption('#w-list select[data-wk="opicks|picks"][data-ws="mix"]', "others");
  await phone.waitForTimeout(800);
  const mix = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "opicks|picks")[0].settings.filter((s) => s.key === "mix")[0]);
  ok(mix.own && mix.value === "others", "Picks from, picked on the phone page, is kept on the TV: " + JSON.stringify(mix.value));
  // Only from these apps takes 6 ticks at most on the phone page
  await phone.click('#w-list details[data-key="oupnext|upnext"] summary');
  const BOX = 'input[data-wmany][data-wk="oupnext|upnext"][data-ws="apps"]';
  ok(/Pick up to 6\./.test(await phone.evaluate(() => (document.querySelector('#w-list details[data-key="oupnext|upnext"]') || {}).textContent || "")), "the phone page says: Pick up to 6.");
  for (let k = 0; k < 7; k++) {
    const boxes = await phone.$$(BOX);
    if (await boxes[k].isEnabled()) { await boxes[k].click(); await phone.waitForTimeout(500); }
  }
  const st6 = await phone.evaluate((b) => [...document.querySelectorAll(b)].map((c) => (c.checked ? "x" : "") + (c.disabled ? "d" : "")), BOX);
  ok(st6.filter((x) => x === "x").length === 6 && st6.slice(6).every((x) => x === "d"), "6 ticked, the rest can't be ticked: " + st6.join(","));
  const up = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "oupnext|upnext")[0].settings.filter((s) => s.key === "apps")[0]);
  ok(Array.isArray(up.value) && up.value.length === 6, "the TV keeps 6 apps: " + JSON.stringify(up.value));
  await (await phone.$$(BOX))[0].click(); await phone.waitForTimeout(500);
  const st5 = await phone.evaluate((b) => [...document.querySelectorAll(b)].map((c) => (c.checked ? "x" : "") + (c.disabled ? "d" : "")), BOX);
  ok(st5.filter((x) => x === "x").length === 5 && st5.every((x) => x !== "d"), "one taken off: every box can be ticked again: " + st5.join(","));
  for (let k = 0; k < 8 && await phone.$(BOX + ":checked"); k++) { await phone.click(BOX + ":checked"); await phone.waitForTimeout(500); }
  const up0 = await tv.evaluate(() => window.tv.atHomeRead().design.widgets.filter((w) => w.key === "oupnext|upnext")[0].settings.filter((s) => s.key === "apps")[0]);
  ok(!up0.own || !up0.value || !up0.value.length, "all taken off: back to any app: " + JSON.stringify(up0));
  // the widgets taken off the design leave every screen
  await newDesign(tv, without, "&ontv=1");
  const v = await phoneView(tv);
  GONE.forEach((k) => ok(!v.widgets.some((x) => x.kind === k || /^ostack/.test(x.key)), k + " left the design: gone from the phone's list"));
  KINDS.filter((k) => GONE.indexOf(k) < 0).forEach((k) => ok(v.widgets.some((x) => x.key === "o" + k + "|" + k), k + " still on the design: still listed"));
  const rows = await homeRows(tv);
  GONE.forEach((k) => ok(rows.indexOf(NAMES[k] + ", ") < 0, k + " gone from Home settings, Widgets on this home"));
  ok(rows.indexOf("Keep watching row, ") >= 0, "Keep watching row is still there");
  await phone.reload();
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  await phone.waitForFunction(() => document.querySelectorAll("#w-list summary").length > 0, null, { timeout: 10000 });
  titles = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent).join(" | "));
  GONE.forEach((k) => ok(titles.indexOf(NAMES[k] + ", ") < 0, k + " gone from the phone page"));
  ok(!(await tv.evaluate(() => !!document.querySelector('.cw-o[data-obj="odock"]'))), "and from the home");
  // Hold OK on a widget that stayed: it is its own, never one that left
  const m = await holdOn(tv, "okeeprow");
  ok(m.args.some((a) => /^okeeprow\|/.test(a || "")) && !m.args.some((a) => /odock|ostack|okeep\|/.test(a || "")), "Hold OK offers only the widget there: " + m.args.join(","));
  // a stack whose turn Studio set at the top (o.turn, Studio's Turns), showing a widget with nothing to set
  const bares = await tv.evaluate(() => ["date", "analog", "moon", "sun", "month"].filter((k) => !window.CouchWidgetCaps.settings(k).some((s) => s && s.pre === true && (!Array.isArray(s.where) || s.where.indexOf("tv") >= 0 || s.where.indexOf("phone") >= 0))));
  const bare = bares.length >= 2 ? bares[0] : "";
  await newDesign(tv, { v: 1, background: { colour: "#1d3a4f" }, elements: design.elements, objects: [{ id: "ostack", type: "widget", kind: "stack", x: 40, y: 40, w: 600, h: 300, turn: 60, items: bare ? [{ kind: bares[0] }, { kind: bares[1] }] : [{ kind: "clock" }, { kind: "date" }] }] }, "&ontv=1");
  const sv = (await phoneView(tv)).widgets.filter((x) => x.key === "ostack|stack")[0];
  const tset = sv && sv.settings.filter((s) => s.key === "turn")[0];
  ok(tset && String(tset.value) === "60" && tset.words === "Every minute", "a stack turned by Studio's Turns (top level 60) shows Every minute: " + JSON.stringify(tset));
  if (bare) {
    const ms = await holdOn(tv, "ostack");
    ok(ms.items[0] === "Edit the stack on your phone" && ms.items.indexOf("Edit the stack on the TV") < 0 && ms.items.indexOf("Edit on the TV") < 0, "Hold OK on a stack of " + bares.slice(0, 2).join(" and ") + ": Edit the stack on your phone only, first (" + ms.items.join(", ") + ")");
    ok(ms.note === "Nothing to set for the widget showing now.", "and the note says the widget showing has nothing to set: " + ms.note);
  } else console.log("  (every widget has a setting now: the stack note check has no widget to show)");
  {
    // Edit the stack on your phone: its sheet is a code for the stack, and keeps the no-phone way, "No phone?
    // Set it up here", which opens the stack's own page in Home settings
    const ms = await holdOn(tv, "ostack"), at = ms.items.indexOf("Edit the stack on your phone");
    ok(at >= 0 && ms.args[at] === "ostack|", "Hold OK on the stack: Edit the stack on your phone (" + ms.items.join(", ") + ")");
    await tv.evaluate(() => window.CouchDesign.nav.focus("ostack", 0)); await tv.waitForTimeout(200);
    await tv.keyboard.down("Enter"); await tv.waitForTimeout(900); await tv.keyboard.up("Enter"); await tv.waitForTimeout(300);
    for (let k = 0; k < at; k++) await press(tv, "ArrowDown", 150);
    await press(tv, "Enter", 800);
    const sq = await tv.evaluate(() => ({ link: (document.querySelector(".cw-sheet .cw-qr") || { getAttribute() { return ""; } }).getAttribute("data-link") || "", here: [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent) }));
    ok(/&widget=ostack(&|$)/.test(sq.link) && sq.here.indexOf("No phone? Set it up here") >= 0, "the stack's phone sheet: a code for the stack, and No phone? Set it up here: " + sq.link.replace(/pin=\d+/, "pin=…") + " " + sq.here.join(", "));
    await press(tv, "ArrowDown", 150); await press(tv, "Enter", 700);
    const shead = await tv.evaluate(() => (document.getElementById("settings").classList.contains("on") ? (document.getElementById("set-head") || {}).textContent : "") || "");
    ok(/stack/i.test(shead), "No phone? Set it up here: the stack's page in Home settings: " + shead);
    for (let k = 0; k < 6 && await tv.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press(tv, "Escape", 250);
  }
  // then every one of the 14 taken off (only a clock left): each leaves every screen
  await newDesign(tv, { v: 1, background: { colour: "#1d3a4f" }, elements: design.elements, objects: [{ id: "oclock", type: "widget", kind: "clock", x: 40, y: 40, w: 400, h: 200 }] }, "&ontv=1");
  const v2 = await phoneView(tv);
  KINDS.forEach((k) => ok(!v2.widgets.some((x) => x.kind === k || x.key.indexOf("o" + k) === 0), k + " off the design: gone from the phone's list"));
  const rows2 = await homeRows(tv);
  KINDS.forEach((k) => ok(rows2.indexOf(NAMES[k] + ", ") < 0, k + " off the design: gone from Home settings, Widgets on this home"));
  await phone.reload();
  await phone.waitForFunction(() => window.couchTv && window.couchTv.token());
  await phone.waitForTimeout(1500);
  const titles2 = await phone.evaluate(() => [...document.querySelectorAll("#w-list summary")].map((e) => e.textContent).join(" | "));
  KINDS.forEach((k) => ok(titles2.indexOf(NAMES[k] + ", ") < 0, k + " off the design: gone from the phone page"));
  const m2 = await holdOn(tv, "oclock");
  ok(!m2.args.some((a) => KINDS.some((k) => (a || "").endsWith("|" + k))), "Hold OK on the clock offers none of the 14: " + m2.args.join(","));
  ok(!(await tv.evaluate((ks) => ks.some((k) => !!document.querySelector('.cw-o[data-obj="o' + k + '"]')), KINDS)), "none of the 14 is drawn on the home");
  ok(!phone.errors.length, "no phone page errors: " + phone.errors.join("; "));
  await ctx.close();
}
ok(!tv.errors.length, "no TV page errors: " + tv.errors.join("; "));
await browser.close();
server.close();
const keysTested = Object.keys(counts).sort();
console.log("  settings each changed and cleared: " + keysTested.length + " (" + keysTested.join(", ") + ")");
console.log("All " + n + " checks passed.");
