// Picks for you (tv-home/web/widget-web.js picks, widgets.js draws them): made on the TV from its own
// Keep watching, no outside service. What the other grown ups at home are watching (never a kids or
// guest profile's shows), then your own shows left part way further back; once each, only from apps
// this TV has; OK plays the pick as its owner's. Every size draws real picks or an honest state.
// Run: node tests/test_widget_picks.js
const fs = require("fs");
const path = require("path");
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("Picks");
const T = K.home(Date.UTC(2026, 10, 18, 9, 0));
const WW = T.WW;

console.log("Running Picks tests...");

const show = (title, pkg, extra) => Object.assign({ id: title.replace(/\W/g, ""), title, app: { package: pkg, name: pkg.split(".").pop() }, progress: 0.4 }, extra || {});
const N = "com.netflix.ninja", S = "au.com.stan.and", I = "au.net.abc.iview", GONE = "com.example.gone";
const household = [
  { id: "a", name: "Alex", shows: [show("Slow Horses", N), show("Bluey", I), show("Utopia", S), show("Rake", S, { progress: 0.5 }), show("Fisk", I, { progress: 0.99 }), show("Wakefield", GONE)] },
  { id: "b", name: "Sam", shows: [show("Mystery Road", I), show("Slow Horses", N), show("The Newsreader", I, { season: 2, episode: 3 }), show("Old App Show", GONE)] },
  { id: "c", name: "Ruby", kid: true, shows: [show("Peppa Pig", I)] },
  { id: "d", name: "Visitor", guest: true, shows: [show("Love Island", N)] }
];
const apps = [N, S, I];

// ---------------- 1. what is picked ----------------
const p = WW.picks(household, "a", apps, 8);
const titles = p.map((x) => x.title);
ok(titles.join() === "Mystery Road,The Newsreader,Rake", "others' shows first, then my own further back (" + titles.join() + ")");
ok(p[0].why === "Sam is watching" && p[2].why === "Pick up again", "each says why it is a pick");
ok(!titles.some((t) => /Peppa|Love Island/.test(t)), "never a kids or guest profile's shows");
ok(!titles.includes("Slow Horses"), "not a show I am already watching");
ok(!titles.some((t) => /Wakefield|Old App Show/.test(t)), "only from apps this TV still has");
ok(!titles.includes("Fisk") && !titles.includes("Bluey"), "not my first three (Keep watching shows them), not one I have finished");
ok(p[0].owner === "b" && p[0].i === 0 && p[2].owner === "a" && p[2].i === 3, "each pick keeps whose it is and its place, to play it");
ok(p[1].sub === "S2 E3", "season and episode");
ok(WW.picks(household, "a", [], 8).some((x) => x.title === "Wakefield"), "apps not known: nothing is left out for its app");
ok(WW.picks([], "a", apps).length === 0 && WW.picks(null, null, null).length === 0 && WW.picks([{ id: "a", shows: [{}] }], "a").length === 0, "nothing from nothing");
ok(WW.picks(household, "a", apps, 2).length === 2, "at most the number asked for");

// ---------------- 2. the widget at every size ----------------
const env = { data: { household, who: "a", apps: apps.map((x) => ({ package: x })), bridge: true } };
K.sizes(T.C, "picks").forEach(([id, w, h]) => {
  const el = T.W.render({ kind: "picks", w, h }, env);
  ok(!el.getAttribute("data-empty") && /Mystery Road/.test(el.textContent) && /Sam is watching/.test(el.textContent), "picks " + id + ": real picks from this TV");
  const act = el.all().filter((e) => e.getAttribute("data-act") === "pick");
  ok(act.length >= 1 && act[0].getAttribute("data-arg") === "0", "picks " + id + ": OK on a poster plays it");
  ok(!/Colin from Accounts|Total Control/.test(el.textContent), "picks " + id + ": never the designer's demo on a TV");
  ok(/Mystery Road/.test(T.W.render({ kind: "picks", w, h }, { demo: true, designer: true }).textContent), "picks " + id + ": the designer shows demo picks");
});
const wide = T.W.render({ kind: "picks", w: 1160, h: 360 }, env), small = T.W.render({ kind: "picks", w: 360, h: 360 }, env);
ok(wide.all().filter((e) => e.getAttribute("data-act") === "pick").length === 3 && small.all().filter((e) => e.getAttribute("data-act") === "pick").length === 1, "a wide box shows every pick it has room for (3), a small one 1");
const none = T.W.render({ kind: "picks", w: 760, h: 360 }, { data: { household: [{ id: "a", name: "Alex", shows: [show("Slow Horses", N)] }], who: "a", apps: [], bridge: true } });
ok(none.getAttribute("data-empty") === "1" && /No picks yet/.test(none.textContent), "nothing to pick yet: says so");
const nob = T.W.render({ kind: "picks", w: 760, h: 360 }, { data: { household: [], who: "a", bridge: false } });
ok(nob.getAttribute("data-empty") === "1" && nob.getAttribute("data-setup") === "picks", "no Keep watching on this TV at all: its setup steps");

// ---------------- 3. the design, the TV and the setup record ----------------
const CD = K.design();
ok(JSON.stringify(K.kept(CD, "picks", { label: "For tonight", align: "left", shows: ["x"], who: "a" })) === '{"label":"For tonight","align":"left"}', "a design keeps a label and an alignment, never shows or people");
const app = fs.readFileSync(path.join(__dirname, "../tv-home/web/app.js"), "utf8");
ok(/else if \(what === "pick"\) playPick\(/.test(app) && /api\("POST", "\/api\/continue\/open", \{ id: it\.id, who: p\.owner \}/.test(app), "OK on a pick opens it as its owner's show, the way Keep watching does");
ok(!/api\/recs/.test(app.slice(app.indexOf("function householdData"), app.indexOf("function commuteData"))), "picks ask no service, not even the bridge's recommendations");
ok(T.C.get("picks").status === "setup" && T.C.need("picks", "Google TV") === "setup" && T.C.need("picks", "Tizen") === "computer" && T.C.need("picks", "Roku OS") === "no", "widget-caps: set up first (Keep watching), honest platforms");
done();
