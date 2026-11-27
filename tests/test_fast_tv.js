// Fast TV (Couch TV Studio's Fast TV Paper and Fast TV Ink, 28 Nov 2026): the two designs as Studio sends
// them (tests/fixtures/fast-tv-designs.json) pass the TV's gate untouched, and the speed list is honest about
// a plain colour: no "Scenes taking turns" when the design draws no scene. Shadow None also drops the words'
// own soft shadow (widgets.css). The drawing is checked in tests/test_fast_tv_browser.mjs.
// Run: node tests/test_fast_tv.js
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
const plain = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const keys = (list) => list.map((x) => x[2]);
const total = (list) => list.reduce((s, x) => s + x[1], 0);

console.log("Running Fast TV tests...");
const fast = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/fast-tv-designs.json"), "utf8"));
ok(fast.map((f) => f.id).join() === "fast-paper,fast-ink", "both Fast TV designs in the fixture");
fast.forEach((f) => {
  const c = CD.check(plain(f.design));
  ok(c.notes.length === 0 && c.flags.length === 0, f.id + ": through the gate with no notes (" + c.notes.join(" ") + ")");
  const clean = plain(c.clean);
  ok(clean.background && clean.background.colour && !clean.background.image, f.id + ": a plain colour kept");
  ok(clean.home && clean.home.lighter === true && clean.home.moving_tiles === false, f.id + ": Lighter home and still tiles kept");
  ok((clean.objects || []).every((o) => o.style && o.style.shadow === "none" && o.style.panel !== "glass"), f.id + ": every widget shadow None, no glass");
  ok((clean.objects || []).length === (f.design.objects || []).length, f.id + ": every widget kept");
  const cost = plain(CD.cost(c.clean));
  ok(keys(cost).indexOf("scenes") < 0 && keys(cost).indexOf("colour") >= 0, f.id + ": no scenes charged for a plain colour (" + keys(cost).join(", ") + ")");
  ok(total(cost) <= 20, f.id + ": the speed figure is small (" + total(cost) + ", Couch Original 32)");
  ok(Buffer.byteLength(JSON.stringify(c.clean)) < 2048, f.id + ": the design is under 2 KB (" + Buffer.byteLength(JSON.stringify(c.clean)) + " bytes)");
});

// the speed list: scenes are still charged where they draw
ok(keys(plain(CD.cost({ v: 1 }))).indexOf("scenes") >= 0, "no background: the scenes take turns and are charged");
ok(keys(plain(CD.cost({ v: 1, home: { scenes: ["night"] } }))).indexOf("scene") >= 0, "one scene: charged as one scene");
ok(keys(plain(CD.cost({ v: 1, background: { colour: "#101010" } }))).indexOf("scenes") < 0, "a plain colour: no scenes");
ok(keys(plain(CD.cost({ v: 1, background: { colour: "#101010", colour2: "#303030", angle: 90 } }))).indexOf("scenes") < 0, "a gradient: no scenes");

// Shadow None drops the words' shadow too, but glass words keep theirs (their look is the shadow)
const css = fs.readFileSync(path.join(web, "widgets.css"), "utf8");
ok(/\.cw-sh-none:not\(\.cw-ink-glass\)[^{]*\*\s*\{\s*text-shadow:\s*none !important;/.test(css), "widgets.css: Shadow None means no word shadow");
ok(/\.cw\.cw-sh-none\.cw-focus\s*\{\s*box-shadow:\s*none;/.test(css), "widgets.css: and no shadow behind the focus ring");

console.log("All " + n + " Fast TV tests passed.");
