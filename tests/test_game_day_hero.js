// The Game Day hero on a real TV (tv-home/web/widgets.js), drawn in node on a small fake DOM: an Up
// next beside a Scores widget shows the TV's own game from a sport app, or a plain empty state; never
// the designer's demo show (Bay of Fires) and never an unrelated drama. Resume opens that show's own
// place in Keep watching.
// Run: node tests/test_game_day_hero.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fakeDocument, fixedDate } = require("./fake-dom");

const web = path.join(__dirname, "../tv-home/web");
const D = fixedDate(Date);
const sandbox = { document: fakeDocument(), Date: D, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "widgets.js"), "utf8"), sandbox);
const W = sandbox.window.CouchWidgets;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const text = (el) => el.textContent;
const draw = (o, env) => W.render(o, env);

console.log("Running Game Day hero tests...");

// ---------------- 1. the Game Day hero ----------------
const hero = { id: "upnext", type: "widget", kind: "upnext", size: "xl", w: 1160, h: 560 };
const SHOWS = [
  { title: "Slow Horses", season: 4, episode: 5, app: { package: "com.apple.atve.androidtv.appletv" }, progress: 0.4 },
  { title: "Titans v Broncos", episode_title: "NRL round 3", app: { package: "au.com.kayosports.tv" }, progress: 0.1 }
];
// the designer (demo) beside a Scores widget: a game, not the drama
let el = draw(hero, { demo: true, designer: true, sport: true, data: {} });
ok(!/Bay of Fires/.test(text(el)) && /Titans v Broncos/.test(text(el)), "designer, Game Day: the demo hero is a game, not Bay of Fires");
// the designer without Scores keeps its own demo show (demo only in the designer)
el = draw(hero, { demo: true, designer: true, data: {} });
ok(/Bay of Fires/.test(text(el)), "designer, a plain Up next: the demo show");
// a TV: the real game from a sport app, and Resume opens its own place in Keep watching (index 1)
el = draw(hero, { demo: false, sport: true, data: { shows: SHOWS } });
ok(/Titans v Broncos/.test(text(el)) && !/Slow Horses/.test(text(el)) && !/Bay of Fires/.test(text(el)), "TV, Game Day: the game the TV has");
const resume = el.all().filter((e) => e.getAttribute("data-act") === "show")[0];
ok(resume && resume.getAttribute("data-arg") === "1", "Resume opens Keep watching item 1 (the game), not item 0");
// a TV with only a drama: an honest empty state, no demo, no drama
el = draw(hero, { demo: false, sport: true, data: { shows: [SHOWS[0]] } });
ok(el.getAttribute("data-empty") === "1" && /No game to pick up/.test(text(el)) && !/Slow Horses|Bay of Fires/.test(text(el)), "TV, Game Day, no game: says so plainly");
// a TV with nothing at all
el = draw(hero, { demo: false, sport: true, data: {} });
ok(el.getAttribute("data-empty") === "1" && !/Bay of Fires|Titans/.test(text(el)), "TV, Game Day, nothing: empty, never the demo");
// opts.sport false: a plain Up next even beside Scores; opts.apps narrows to those apps
el = draw(Object.assign({}, hero, { opts: { sport: false } }), { demo: false, sport: true, data: { shows: SHOWS } });
ok(/Slow Horses/.test(text(el)), "opts.sport false: the first show in Keep watching");
el = draw(Object.assign({}, hero, { opts: { apps: ["com.apple.atve.androidtv.appletv"] } }), { demo: false, data: { shows: SHOWS } });
ok(/Slow Horses/.test(text(el)) && !/Titans/.test(text(el)), "opts.apps: only those apps");
// a plain Up next on a TV is unchanged: the first show
el = draw(hero, { demo: false, data: { shows: SHOWS } });
ok(/Slow Horses/.test(text(el)), "TV, a plain Up next: the first show, as before");

// design.js: upnext takes sport and apps, and a design with Scores tells its widgets so
const dsb = { location: { search: "", origin: "http://tv" }, document: { documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, addEventListener() {} }, innerWidth: 1920, innerHeight: 1080 };
dsb.window = dsb; dsb.window.addEventListener = () => {};
vm.createContext(dsb);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), dsb);
const opts = JSON.parse(JSON.stringify(dsb.window.CouchDesign.sanitize({ objects: [{ id: "u", type: "widget", kind: "upnext", opts: { sport: true, apps: ["au.com.kayosports.tv", "http://x"], label: "x" } }] }))).objects[0].opts;
ok(opts.sport === true && JSON.stringify(opts.apps) === '["au.com.kayosports.tv"]' && opts.label === undefined, "upnext keeps sport and package names only");
const src = fs.readFileSync(path.join(web, "design.js"), "utf8");
ok(/sport: sport,/.test(src) && /kind === "sports"/.test(src), "design.js tells widgets when the design has a Scores widget");

console.log("All " + n + " Game Day hero tests passed.");
