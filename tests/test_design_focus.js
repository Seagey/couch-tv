// The remote in widget mode (design.js NAV.step, widgets/GRID.md "Focus and the remote"): on all 17
// presets, every widget that does something is reached from the start, Right then Left (and Down then
// Up) always undoes itself, nothing wraps round the screen, and no press jumps over a nearer widget in
// its way. Worked from the boxes the designer lays out (tests/fixtures/design-presets.json).
// Run: node tests/test_design_focus.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
const sandbox = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), sandbox);
const CD = sandbox.window.CouchDesign;
const ACT = CD.wact();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const box = (o) => ({ l: o.x, t: o.y, r: o.x + o.w, b: o.y + o.h, w: o.w, h: o.h });
const same = (a, b) => a && b && a.id === b.id && a.i === b.i;

console.log("Running design focus tests...");

// 1. the rule itself, on a small layout: overlap first, nearest edge, then twice the sideways gap
const S0 = [
  { id: "a", box: { l: 80, t: 60, r: 440, b: 420 }, inner: [] },
  { id: "near-off", box: { l: 480, t: 460, r: 640, b: 620 }, inner: [] },    // nearer, but not in line
  { id: "far-in-line", box: { l: 1080, t: 160, r: 1240, b: 320 }, inner: [] }, // further, shares rows
  { id: "below", box: { l: 80, t: 460, r: 440, b: 820 }, inner: [] }
];
let r = CD.nav.step(S0, { id: "a", i: -1 }, null, 1, 0);
ok(r.cur.id === "far-in-line", "Right prefers a widget sharing the rows over a nearer one off to the side");
r = CD.nav.step(S0, r.cur, r.last, -1, 0);
ok(r.cur.id === "a", "Left goes back to where it came from");
r = CD.nav.step(S0, { id: "a", i: -1 }, null, -1, 0);
ok(r.cur.id === "a" && !r.moved, "at the left edge nothing happens (no wrap)");
const S1 = [{ id: "x", box: { l: 80, t: 60, r: 440, b: 420 }, inner: [] }, { id: "diag1", box: { l: 900, t: 500, r: 1060, b: 660 }, inner: [] }, { id: "diag2", box: { l: 500, t: 800, r: 660, b: 960 }, inner: [] }];
r = CD.nav.step(S1, { id: "x", i: -1 }, null, 1, 0);
ok(r.cur.id === "diag1", "with nothing in line, edge distance plus twice the sideways gap decides");
// inner items: stepped through first, left when they run out
const S2 = [{ id: "f", box: { l: 80, t: 60, r: 760, b: 420 }, inner: [{ l: 104, t: 84, r: 264, b: 244 }, { l: 284, t: 84, r: 444, b: 244 }] }, { id: "g", box: { l: 800, t: 60, r: 1160, b: 420 }, inner: [] }];
r = CD.nav.step(S2, { id: "f", i: 0 }, null, 1, 0);
ok(same(r.cur, { id: "f", i: 1 }), "Right inside a folder goes to its next app");
r = CD.nav.step(S2, r.cur, r.last, 1, 0);
ok(r.cur.id === "g", "and leaves the folder when its apps run out that way");
r = CD.nav.step(S2, r.cur, r.last, -1, 0);
ok(same(r.cur, { id: "f", i: 1 }), "coming back lands on the app it left from");
// apps in rows (a folder or app grid, grid: true): 3 across then 1, the remote goes 0, 1, 2, 3 by Right
// (0.13.10: Right from the third skipped the fourth, one row down, and went to the Settings button)
const app = (c, r) => ({ l: 104 + c * 180, t: 84 + r * 180, r: 264 + c * 180, b: 244 + r * 180 });
const S3 = [{ id: "f", grid: true, box: { l: 80, t: 60, r: 680, b: 460 }, inner: [app(0, 0), app(1, 0), app(2, 0), app(0, 1)] }, { id: "g", box: { l: 800, t: 60, r: 1160, b: 420 }, inner: [] }];
let at = { id: "f", i: 0 }, last3 = null;
const walk = [];
for (let k = 0; k < 4; k++) { r = CD.nav.step(S3, at, last3, 1, 0); at = r.cur; last3 = r.last; walk.push(at.id + ":" + at.i); }
ok(walk.join() === "f:1,f:2,f:3,g:-1", "Right goes through every app in rows, then leaves: " + walk.join());
r = CD.nav.step(S3, { id: "f", i: 3 }, null, -1, 0);
ok(same(r.cur, { id: "f", i: 2 }), "Left at the start of a row goes back to the end of the row above");
r = CD.nav.step(S3, { id: "f", i: 2 }, null, 1, 0);
const back = CD.nav.step(S3, r.cur, r.last, -1, 0);
ok(same(r.cur, { id: "f", i: 3 }) && same(back.cur, { id: "f", i: 2 }), "and the opposite press undoes it");
r = CD.nav.step(S3, { id: "f", i: 0 }, null, 0, 1);
ok(same(r.cur, { id: "f", i: 3 }), "Down still goes down a column");
const S4 = [Object.assign({}, S3[0], { grid: false }), S3[1]];
r = CD.nav.step(S4, { id: "f", i: 2 }, null, 1, 0);
ok(r.cur.id === "g", "items not in rows of apps (no grid) keep plain geometry");

// 2. every preset: reach, undo, no wrap, no jump over a nearer widget in the way
const presets = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/design-presets.json"), "utf8"));
presets.forEach((p) => {
  const all = JSON.parse(JSON.stringify(CD.sanitize(p.design))).objects.filter((o) => o.type === "widget");
  let objs = all.filter((o) => ACT.indexOf(o.kind) >= 0);
  if (!objs.length) objs = all;   // things only to look at: every widget is a stop and OK opens the menu (design.js stops)
  const S = objs.map((o) => ({ id: o.id, box: box(o), inner: [], start: !!o.start, act: o.kind === "app" ? "app" : "" }));
  // a design of things only to look at (the bedside StandBy): the remote opens the Hold OK menu, nothing else
  ok(S.length > 0, p.id + ": the remote has somewhere to be");
  // start: the one marked Start here
  const start = CD.nav.step(S, null, null, 0, 0).cur;
  const marked = objs.filter((o) => o.start)[0];
  ok(start && (!marked || start.id === marked.id), p.id + ": the remote starts on the widget marked Start here");
  // reach everything from the start (breadth first over presses)
  const seen = new Set([start.id]), queue = [start];
  while (queue.length) {
    const c = queue.shift();
    DIRS.forEach((d) => { const q = CD.nav.step(S, c, null, d[0], d[1]); if (q.moved && !seen.has(q.cur.id)) { seen.add(q.cur.id); queue.push(q.cur); } });
  }
  ok(seen.size === S.length, p.id + ": every widget that does something is reached (" + seen.size + " of " + S.length + ")");
  S.forEach((s) => {
    DIRS.forEach((d) => {
      const a = CD.nav.step(S, { id: s.id, i: -1 }, null, d[0], d[1]);
      if (!a.moved) return;
      const back = CD.nav.step(S, a.cur, a.last, -d[0], -d[1]);
      ok(back.cur.id === s.id, p.id + ": " + s.id + " then back returns to " + s.id);
      // the target lies beyond the edge in that direction, and no widget in line sits nearer
      const t = S.find((x) => x.id === a.cur.id), f = s.box;
      const beyond = d[0] > 0 ? t.box.l >= f.r - 2 : d[0] < 0 ? t.box.r <= f.l + 2 : d[1] > 0 ? t.box.t >= f.b - 2 : t.box.b <= f.t + 2;
      ok(beyond, p.id + ": " + s.id + " moves only forwards (no wrap)");
      const lined = (x) => d[0] ? Math.min(f.b, x.box.b) - Math.max(f.t, x.box.t) > 1 : Math.min(f.r, x.box.r) - Math.max(f.l, x.box.l) > 1;
      const edge = (x) => d[0] > 0 ? x.box.l - f.r : d[0] < 0 ? f.l - x.box.r : d[1] > 0 ? x.box.t - f.b : f.t - x.box.b;
      if (lined(t)) ok(!S.some((x) => x !== s && x !== t && lined(x) && edge(x) >= -2 && edge(x) < edge(t) - 2), p.id + ": " + s.id + " does not jump over a nearer widget");
    });
  });
});

console.log("OK: " + n + " checks");
