// The Commute widget (tv-home/web/widget-web.js asks OSRM's free route server, widgets.js draws it):
// a saved OSRM answer read into minutes and kilometres; when to leave to arrive on time; the two
// places come from the TV only (never from the design, never sent more precisely than a suburb);
// every size draws the real drive or an honest state; a design can never carry a place, and Share
// this home never sends one. No live calls.
// Run: node tests/test_widget_commute.js
const fs = require("fs");
const path = require("path");
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("Commute");
const NOW = new Date(2026, 10, 18, 7, 0).getTime();   // a Wednesday, 7am on the TV's clock
const T = K.home(NOW);
const WW = T.WW;

console.log("Running Commute tests...");

// ---------------- 1. the route and when to leave ----------------
const r = WW.parseRoute(K.json("osrm-route.json"));
ok(r && r.minutes === 27 && r.km === 25.5, "OSRM's answer: 27 minutes, 25.5 km (" + JSON.stringify(r) + ")");
ok(WW.parseRoute({ code: "NoRoute", routes: [] }) === null && WW.parseRoute(null) === null && WW.parseRoute({ code: "Ok", routes: [{}] }) === null, "no route: nothing");
const home = { lat: -33.86789, lon: 151.20732 }, work = { lat: -33.81512, lon: 151.00178 };
const key = WW.routeKey(home, work);
ok(key === "-33.87,151.21;-33.82,151", "the places are rounded to about a kilometre (" + key + ")");
ok(WW.routeKey(home, null) === null && WW.routeKey(null, work) === null && WW.routeKey({ lat: "x", lon: 1 }, work) === null, "no drive without both places");
ok(WW.routeUrl(key) === "https://router.project-osrm.org/route/v1/driving/151.21,-33.87;151,-33.82?overview=false&alternatives=false&steps=false", "one OSRM request, longitude first, only the rounded places");
ok(WW.routeUrl("evil") === null && WW.routeUrl("1,2;3") === null, "a bad id makes no request");
const lb = WW.leaveBy(27, 8, 30, 10, NOW);
ok(lb && lb.day === "" && lb.at.getHours() === 7 && lb.at.getMinutes() === 53, "to arrive by 8:30 with 10 minutes to spare: leave by 7:53 today");
const late = WW.leaveBy(27, 8, 30, 10, new Date(2026, 10, 18, 9, 0).getTime());
ok(late.day === "Tomorrow", "after the time today: tomorrow");
const fri = WW.leaveBy(27, 8, 30, 10, new Date(2026, 10, 20, 9, 0).getTime());
ok(fri.day === "Monday" && WW.leaveBy(27, 8, 30, 10, new Date(2026, 10, 20, 9, 0).getTime(), false).day === "Tomorrow", "on a Friday after the time: Monday, unless weekends count");

(async () => {
  // ---------------- 2. the loader: places from the TV, straight to OSRM ----------------
  const answer = () => K.json("osrm-route.json");
  const t = K.fakeTv(WW, { answer, relay: false, now: NOW, widgets: [{ kind: "commute", opts: { arrive_h: 8 } }], places: { from: home, to: work } });
  await t.L.tick();
  ok(t.asked.length === 1 && /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/151\.21,-33\.87;151,-33\.82\?/.test(t.asked[0]), "one request to OSRM, even with no relay, with the rounded places only");
  ok(t.L.data().commute[key].ok && t.L.data().commute[key].v.minutes === 27, "the drive is kept");
  t.now += 5 * 3600000; await t.L.tick();
  ok(t.asked.length === 1, "not asked again for 6 hours (no traffic, the drive does not change)");
  t.places = { from: home, to: { lat: -33.9, lon: 151.1 } }; await t.L.tick();
  ok(t.asked.length === 2, "a new place: asked straight away");
  const none = K.fakeTv(WW, { answer, widgets: [{ kind: "commute" }], places: { from: home, to: null } });
  await none.L.tick();
  ok(none.asked.length === 0, "no place to drive to: nothing asked");
  const nr = K.fakeTv(WW, { answer: () => ({ code: "NoRoute" }), widgets: [{ kind: "commute" }], places: { from: home, to: work } });
  await nr.L.tick();
  ok(nr.L.data().commute[key].err === "empty", "no road route: empty");

  // ---------------- 3. the widget at every size ----------------
  const good = { ok: true, at: NOW, v: r };
  const env = (rec, c) => ({ data: { commute: c || { from: { name: "Riverside" }, to: { name: "Parramatta" }, key }, web: rec === undefined ? {} : { commute: { [key]: rec } } } });
  K.sizes(T.C, "commute").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "commute", w, h, opts: { arrive_h: 8, arrive_m: 30 } }, env(good));
    ok(!el.getAttribute("data-empty") && /27/.test(el.textContent) && (w < 300 || /Parramatta/.test(el.textContent)), "commute " + id + ": the real drive, to the TV's own place (a tile: the minutes)");
    ok(!/16 min|Light traffic/.test(el.textContent), "commute " + id + ": no demo, and never a traffic claim");
    ok(/16/.test(T.W.render({ kind: "commute", w, h }, { demo: true, designer: true }).textContent), "commute " + id + ": the designer shows a demo drive");
  });
  const sm = T.W.render({ kind: "commute", w: 360, h: 360, opts: { arrive_h: 8, arrive_m: 30 } }, env(good));
  ok(/Leave by 7:53am for 8:30am/.test(sm.textContent) && /no live traffic/.test(sm.textContent), "small: when to leave, and honest about traffic");
  const md = T.W.render({ kind: "commute", w: 760, h: 360, opts: { label: "To school" } }, env(good));
  ok(/To school/.test(md.textContent) && /25\.5 km/.test(md.textContent) && /Set an arrive by time/.test(md.textContent), "medium: its own label, the distance, and how to get when to leave");
  const wt = T.W.render({ kind: "commute", w: 360, h: 160, opts: { arrive_h: 8, arrive_m: 30 } }, env(good));
  ok(/27 min/.test(wt.textContent) && /7:53am/.test(wt.textContent), "a wide tile: the minutes and when to leave");
  const noTo = T.W.render({ kind: "commute", w: 360, h: 360 }, env(good, { from: { name: "Riverside" }, to: null, key: null }));
  ok(noTo.getAttribute("data-empty") === "1" && /Set where you drive to/.test(noTo.textContent) && noTo.getAttribute("data-setup") === "commute", "no place to drive to: says where to set it, OK opens the steps");
  const noFrom = T.W.render({ kind: "commute", w: 360, h: 360 }, env(good, { from: null, to: { name: "Parramatta" }, key: null }));
  ok(noFrom.getAttribute("data-empty") === "1" && /Set your town/.test(noFrom.textContent), "no town: says so");
  // a tile has room for two or three words only: its own short line
  [[undefined, "Working out the drive", "Working it out"], [{ ok: false, err: "failed", at: 1 }, "could not be worked out", "Drive failed"], [{ ok: false, err: "empty", at: 1 }, "No road route", "No route"]].forEach(([rec, says, short]) => K.sizes(T.C, "commute").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "commute", w, h }, env(rec)), want = w < 300 || h < 200 ? short : says;
    ok(el.getAttribute("data-empty") === "1" && el.textContent.indexOf(want) >= 0, "commute " + id + ": " + want);
  }));

  // ---------------- 4. privacy: a design never carries a place; Share this home never sends one ----------------
  const CD = K.design();
  const k = K.kept(CD, "commute", { label: "To work", arrive_h: 8, arrive_m: 30, buffer: 5, weekdays: true, from: "12 Smith St", to: { lat: -33.8, lon: 151 }, home: "x", work: "y", lat: -33.8, lon: 151, place: "Parramatta" });
  ok(JSON.stringify(Object.keys(k).sort()) === '["arrive_h","arrive_m","buffer","label","weekdays"]', "a design keeps only the label and the times, never a place (" + Object.keys(k) + ")");
  const cl = K.kept(CD, "commute", { arrive_h: 99, arrive_m: -1, buffer: 500 });
  ok(cl.arrive_h === 23 && cl.arrive_m === 0 && cl.buffer === 60, "times out of range are held to the day (" + JSON.stringify(cl) + ")");
  const app = fs.readFileSync(path.join(__dirname, "../tv-home/web/app.js"), "utf8");
  // (the Commute's own Where to is a widget setting now: it rides Home settings in ST.widgets, to the TV app or
  // the computer at home, never a design; 0.13.8's place under tvhome.commute is still read, and only cleared)
  ok(!/ST\.commute/.test(app) && !/keep\("tvhome\.commute", \{/.test(app) && /cleanPlace\(kept\("tvhome\.commute"\)\)/.test(app), "the place is a widget setting (Home settings), never in a design; the old tvhome.commute is only read or cleared");
  ok(/var cm = kept\("tvhome\.commute"\); if \(cm && cm\.name\) w\.push/.test(app), "Share this home treats the place as private: a share holding it is stopped");
  const sb = { window: {} }; sb.window = sb;
  require("vm").runInNewContext(fs.readFileSync(path.join(__dirname, "../tv-home/web/share-home.js"), "utf8"), sb);
  const S = sb.CouchShare;
  ok(S && S.prepare, "share-home.js loads");
  {
    const d = { v: 1, objects: [{ id: "c", type: "widget", kind: "commute", x: 80, y: 60, w: 360, h: 360, opts: { label: "To work", arrive_h: 8, to: "Parramatta", from: "Riverside" } }] };
    const res = S.prepare({ design: d, scenes: [], builtIn: [], dock: [] }, ["Parramatta", "Riverside"], CD);
    const sent = JSON.stringify(res && (res.design || res.body || res));
    ok(!/Parramatta|Riverside/.test(sent), "Share this home: the places are not in what is sent (" + sent.slice(0, 160) + ")");
  }
  ok(T.C.get("commute").status === "setup" && T.C.need("commute", "Google TV") === "setup" && T.C.need("commute", "Tizen") === "setup" && T.C.need("commute", "Saphi") === "computer" && T.C.need("commute", "Roku OS") === "no", "widget-caps: set up on the TV, honest platforms");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
