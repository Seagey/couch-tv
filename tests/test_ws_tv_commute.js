// Widget settings (Group 2): each Commute widget fetches its own drive. The loader asks h.places(w)
// for each widget, and a Where to set for that widget on this TV (CouchWidgets.withSettings puts it in
// w.__tv.to, never in the design) goes over the home's own Where to. No live calls.
// Run: node tests/test_ws_tv_commute.js
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("per widget Commute");
const NOW = new Date(2026, 10, 18, 7, 0).getTime();
const WW = K.home(NOW).WW;

console.log("Running per widget Commute tests...");
const home = { name: "Hillside", lat: -33.87, lon: 151.21 }, work = { name: "Riverton", lat: -33.82, lon: 151.0 }, school = { name: "Long Beach", lat: -33.75, lon: 151.3 };

(async () => {
  const answer = () => K.json("osrm-route.json");
  // two Commute widgets: one with the home's Where to, one with its own picked on the TV
  const t = K.fakeTv(WW, { answer, relay: false, now: NOW, places: { from: home, to: work },
    widgets: [{ id: "c1", kind: "commute", opts: {} }, { id: "c2", kind: "commute", opts: {}, __tv: { to: school } }] });
  const seen = [];
  const plain = t.h.places;
  t.h.places = (w) => { seen.push(w && w.id); return plain(w); };
  await t.L.tick();
  ok(t.asked.length === 2, "two Commute widgets, two drives asked (" + t.asked.length + ")");
  const kWork = WW.routeKey(home, work), kSchool = WW.routeKey(home, school);
  ok(t.L.data().commute[kWork] && t.L.data().commute[kWork].ok, "the home's own drive is kept");
  ok(t.L.data().commute[kSchool] && t.L.data().commute[kSchool].ok, "the second widget's own drive is kept");
  ok(seen.indexOf("c1") >= 0 && seen.indexOf("c2") >= 0, "places(w) is asked for each widget (" + seen.join(",") + ")");

  // a place in the design's opts is never used: places come from the TV only
  const d = K.fakeTv(WW, { answer, relay: false, now: NOW, places: { from: home, to: work }, widgets: [{ id: "c3", kind: "commute", opts: { to: school } }] });
  await d.L.tick();
  ok(d.asked.length === 1 && !d.L.data().commute[kSchool], "a design's own place is never asked for");

  // a bad place from the TV is ignored (the home's Where to stands)
  const b = K.fakeTv(WW, { answer, relay: false, now: NOW, places: { from: home, to: work }, widgets: [{ id: "c4", kind: "commute", opts: {}, __tv: { to: { lat: "x" } } }] });
  await b.L.tick();
  ok(b.asked.length === 1 && b.L.data().commute[kWork], "a broken Where to: the home's own drive");

  // a loader that hands places() no widget (an older app.js) still works
  const o = K.fakeTv(WW, { answer, relay: false, now: NOW, places: { from: home, to: work }, widgets: [{ kind: "commute" }] });
  await o.L.tick();
  ok(o.asked.length === 1, "an older app.js: one drive, as before");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
