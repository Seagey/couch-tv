// What the web widget tests share (news, scores, markets, commute, picks): widgets.js, widget-web.js
// and widget-caps.js drawn in node on the small fake DOM, design.js for its option checks, and the
// saved sample answers in tests/fixtures/widgets-data (no live calls in any test).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fakeDocument, fixedDate } = require("./fake-dom");

const web = path.join(__dirname, "../tv-home/web");
const FIX = path.join(__dirname, "fixtures/widgets-data");

function home(at) {
  const D = fixedDate(Date);
  if (at) D.set(at);
  const sb = { document: fakeDocument(), Date: D, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console, Promise, JSON, Math };
  sb.window = sb;
  vm.createContext(sb);
  ["widget-web.js", "widget-caps.js", "widgets.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb, { filename: f }));
  return { W: sb.window.CouchWidgets, WW: sb.window.CouchWidgetWeb, C: sb.window.CouchWidgetCaps, D, sb };
}
function design() {
  const dsb = { location: { search: "", origin: "http://tv" }, document: { documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, addEventListener() {} }, innerWidth: 1920, innerHeight: 1080 };
  dsb.window = dsb; dsb.window.addEventListener = () => {};
  vm.createContext(dsb);
  vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), dsb);
  return dsb.window.CouchDesign;
}
// the options a design keeps for one widget, after design.js has checked it
function kept(CD, kind, opts) {
  const d = JSON.parse(JSON.stringify(CD.sanitize({ objects: [{ id: "w", type: "widget", kind, opts }] })));
  return (d.objects[0] || {}).opts || {};
}
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const json = (name) => JSON.parse(fixture(name));
// the named sizes in half cells (tools/tv-designer/app/grid.js), as boxes in TV pixels
const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
function sizes(C, kind) {
  const s = C.get(kind).sizes;
  return s.s.map((id) => [id, NAMED[id][0] * 100 - 40, NAMED[id][1] * 100 - 40]).concat([["min", s.min[0] * 100 - 40, s.min[1] * 100 - 40]]);
}
// a loader with a fake TV: what it asked for, and answers it is told to give
function fakeTv(WW, opts) {
  opts = opts || {};
  const t = { now: opts.now || Date.UTC(2026, 10, 18, 9, 0), asked: [], fail: false, store: opts.store || null, changed: 0, widgets: opts.widgets || [], relayOk: opts.relay !== false, places: opts.places || null };
  t.h = {
    widgets: () => t.widgets, canRelay: () => t.relayOk,
    relay: (src, id) => { t.asked.push(src + ":" + id); return t.fail ? Promise.reject(new Error("down")) : Promise.resolve(opts.answer(src, id)); },
    json: (url) => { t.asked.push(url); return t.fail ? Promise.reject(new Error("down")) : Promise.resolve(opts.answer("json", url)); },
    load: () => t.store, save: (o) => { t.store = JSON.parse(JSON.stringify(o)); }, changed: () => { t.changed++; },
    now: () => t.now, hidden: () => false,
    places: () => t.places || null
  };
  t.L = WW.loader(t.h);
  return t;
}
function counter(name) {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  return { ok, done: () => console.log("All " + n + " " + name + " tests passed.") };
}
module.exports = { home, design, kept, fixture, json, sizes, fakeTv, counter, NAMED };
