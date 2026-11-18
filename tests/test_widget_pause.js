// The design store's off switch for the web widgets' sources (widget-web.js pausedOf, the loader,
// widgets.js, app.js): GET <store>/v1/config/sources answers { "v": 1, "paused": ["sports"] }; a paused
// source is never asked and its widget says calmly that the feed is paused; switched back on, it is
// asked straight away; no answer means everything on. Scores and Markets are marked unofficial. No live calls.
// Run: node tests/test_widget_pause.js
const fs = require("fs");
const path = require("path");
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("source pause");
const NOW = Date.UTC(2026, 10, 18, 9, 0);
const T = K.home(NOW);
const WW = T.WW;

console.log("Running source pause tests...");

// ---------------- 1. reading the store's answer ----------------
ok(WW.pausedOf({ v: 1, paused: ["sports", "stocks"] }).join() === "sports,stocks", "the paused sources");
ok(WW.pausedOf('{"v":1,"paused":["news"]}').join() === "news", "as text too");
ok(WW.pausedOf({ v: 1, paused: ["sports", "sports", "weather", "https://x", 3, null] }).join() === "sports", "unknown names and repeats are ignored");
ok([null, undefined, "", "not json", 7, [], {}, { paused: "sports" }, { paused: {} }].every((x) => WW.pausedOf(x).length === 0), "no answer or a bad one: everything on");
ok(WW.PAUSABLE.join() === "news,sports,stocks,commute", "every web source can be paused");

(async () => {
  // ---------------- 2. the loader ----------------
  const answer = () => K.json("espn-nba.json");
  const t = K.fakeTv(WW, { answer, now: NOW, widgets: [{ kind: "sports", opts: { league: "nba" } }, { kind: "news" }] });
  let paused = ["sports"];
  t.h.paused = () => paused;
  t.h.relay = () => Promise.resolve(K.fixture("rss-abc-top.xml"));
  await t.L.tick();
  ok(t.asked.length === 0 && t.L.data().sports.nba.err === "paused", "a paused source is never asked; its widget is told");
  ok(t.L.data().news.abc.ok, "the other sources carry on");
  const changes = t.changed;
  t.now += 10 * 60000; await t.L.tick();
  ok(t.asked.length === 0 && t.changed === changes, "while paused: nothing asked, nothing drawn again");
  paused = [];
  t.now += 60000; await t.L.tick();
  ok(t.asked.length === 1 && t.L.data().sports.nba.ok, "switched back on: asked straight away");
  paused = ["sports"];
  t.now += 60000; await t.L.tick();
  ok(t.asked.length === 1 && t.L.data().sports.nba.err === "paused", "paused again: the last scores make way for the paused state");
  const t2 = K.fakeTv(WW, { answer, now: NOW, widgets: [{ kind: "sports" }] });
  t2.h.paused = () => { throw new Error("broken"); };
  await t2.L.tick();
  ok(t2.asked.length === 1, "a broken switch counts as everything on");

  // ---------------- 3. the widget, every size ----------------
  ["news", "sports", "stocks", "commute"].forEach((kind) => K.sizes(T.C, kind).forEach(([id, w, h]) => {
    const all = { news: { abc: { ok: false, at: NOW, err: "paused" } }, sports: { nrl: { ok: false, at: NOW, err: "paused" } }, stocks: { "^AXJO,AUDUSD=X,BTC-AUD": { ok: false, at: NOW, err: "paused" } }, commute: { K: { ok: false, at: NOW, err: "paused" } } };
    const el = T.W.render({ kind, w, h }, { data: { web: all, commute: { from: { name: "Riverside" }, to: { name: "Parramatta" }, key: "K" } } });
    const says = w < 300 || h < 200 ? "Paused" : "This feed is paused";
    ok(el.getAttribute("data-empty") === "1" && el.textContent.indexOf(says) >= 0 && !/failed|could not|need/i.test(el.textContent), kind + " " + id + ": " + says + ", calmly");
  }));

  // ---------------- 4. the TV asks the store once a day, and the unofficial label ----------------
  const app = fs.readFileSync(path.join(__dirname, "../tv-home/web/app.js"), "utf8");
  ok(/fetch\(base \+ "\/v1\/config\/sources", \{ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" \}\)/.test(app), "app.js asks <store>/v1/config/sources with no cookies and no referrer");
  ok(/t - WEB_PAUSE\.at >= 86400000/.test(app) && /WEB_PAUSE\.at = t;   \/\/ one ask a day, whatever the answer/.test(app), "at most once a day, whatever the answer");
  ok(/if \(!base \|\| !window\.fetch\) return done\(\[\]\);/.test(app) && /function \(\) \{ done\(\[\]\); \}/.test(app), "no store or no answer: everything on");
  ok(/WEB_PAUSE\.wait\.then\(go, go\); setTimeout\(go, 6000\)/.test(app), "the first look waits for the answer (6 seconds at most)");
  ok(/^Unofficial source: /.test(T.C.beta("sports")) && /^Unofficial source: /.test(T.C.beta("stocks")) && T.C.beta("news") === "" && T.C.beta("commute") === "", "widget-caps: Scores and Markets are marked unofficial");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
