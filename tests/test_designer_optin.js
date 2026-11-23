// Couch TV Studio is opt in (tv-home/web/designer-gate.js): an existing home is untouched by an update,
// designs and widget mode stay off until the person at the TV turns Couch TV Studio on (or gets a design
// by code, or says yes to a design in config.json), and one step takes it back to the classic home.
// The pixel check (the classic home drawn by main and by this code, compared) is
// tools/couch-tv/beta/check-classic-home.mjs, outside the repo because it needs a browser.
// Run: node tests/test_designer_optin.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
function gate() {
  const sb = { document: null };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(web, "designer-gate.js"), "utf8"), sb);
  return sb.window.CouchDesigner;
}
console.log("Running Couch TV Studio opt in tests...");
const G = gate();
const cfgDesign = { v: 1, home: { keep_watching: false }, objects: [{ id: "a", type: "text", text: "Hi" }] };
const got = { v: 1, objects: [{ id: "b", type: "text", text: "Hello" }] };

// 1. an existing home: nothing chosen, no design anywhere: nothing at all
let d = G.decide({ choice: null, cfgDesign: undefined, got: null });
ok(d.on === false && d.design === null, "an existing home, after an update: Couch TV Studio off, no design handed to design.js");
d = G.decide({});
ok(d.on === false && d.design === null, "nothing known: off");

// 2. switched off: nothing gets through, whatever arrives
d = G.decide({ choice: "off", cfgDesign, got });
ok(d.on === false && d.design === null && !d.fromCode, "off: a design in config.json and one got by code are both held back");

// 3. switched on: the design got by code wins over config.json's, and is asked about first
d = G.decide({ choice: "on", cfgDesign, got });
ok(d.on && d.design === got && d.fromCode, "on: the design got by code, asked about first");
d = G.decide({ choice: "on", cfgDesign, got: null });
ok(d.on && d.design === cfgDesign && !d.fromCode, "on: config.json's design");
d = G.decide({ choice: "on" });
ok(d.on && d.design === null, "on with no design yet: the home as it is, nothing drawn");

// 4. never chosen, but a code typed at this TV: that is asking for it
d = G.decide({ choice: null, got });
ok(d.on && d.design === got && d.fromCode, "a design got by code turns Couch TV Studio on (and is still asked about)");
// 5. never chosen, a design in config.json: offered with the question only, not on
d = G.decide({ choice: null, cfgDesign });
ok(!d.on && d.design === cfgDesign && d.offered, "config.json's design is only offered (the question changes nothing until yes)");
// 6. the designer's own preview is always on
d = G.decide({ choice: "off", cfgDesign, preview: true });
ok(d.on && d.design === cfgDesign, "Couch TV Studio's own preview is not switched off by a TV's choice");
// rubbish is never a design or a choice
d = G.decide({ choice: "maybe", cfgDesign: [1, 2], got: "x" });
ok(!d.on && d.design === null, "an array or a string is not a design");
ok(G.readChoice("on") === "on" && G.readChoice("off") === "off" && G.readChoice(true) === null && G.readChoice("yes") === null, "only on and off are choices");

// 7. the page policy: added once, only when called (app.js calls it only with a design to start)
const added = [];
const fakeDoc = { head: { appendChild: (m) => added.push(m) }, querySelector: () => (added.length ? added[0] : null),
  createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) };
ok(G.lockPage(fakeDoc) === true && added.length === 1, "the policy goes in when Couch TV Studio starts a design");
ok(added[0].attrs["http-equiv"] === "Content-Security-Policy" && /script-src 'self'/.test(added[0].attrs.content) && /object-src 'none'/.test(added[0].attrs.content), "it is the design's policy");
ok(G.lockPage(fakeDoc) === false && added.length === 1, "and only once");

// 8. the page itself: no policy of its own any more (an existing home keeps the rules it always had),
// the gate before design.js, and design.js started only with a design (or the designer's preview)
const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
ok(!/http-equiv="Content-Security-Policy"/.test(html), "index.html carries no page policy: an existing home's photos, videos and icons load as before");
const order = ["designer-gate.js", "design.js", "design-code.js", "qr.js", "share-home.js", "app.js"].map((f) => html.indexOf('src="' + f + '"'));
ok(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), "designer-gate.js loads before design.js, share-home.js before app.js");
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
ok(/var designOn = typeof CouchDesign !== "undefined" && !!\(GATE\.design \|\| GATE\.preview\);/.test(app), "app.js works out designOn from the gate");
ok(/if \(designOn\) CouchDesign\.start\(CFG\.design,/.test(app), "design.js is started only when the gate hands it a design");
ok(/if \(typeof CouchDesign !== "undefined" && CFG\.design\) HOME = CouchDesign\.home\(/.test(app), "a design's look settings are read only with a design");
ok(!/CouchDesign\.start\(CFG\.design, \{/.test(app.replace(/if \(designOn\) CouchDesign\.start\(CFG\.design, \{/, "")), "no other way in to CouchDesign.start");
ok(/keep\(CouchDesigner\.KEY, on \? "on" : "off"\)/.test(app), "Turn on and turning Your design off keep the choice on this TV");
ok(/setDesigner\(true\);\s+\/\/ typing a code is asking for Couch TV Studio/.test(app), "getting a design by code turns Couch TV Studio on");
ok(/\["designer", "designer"\], \["about", "info"\]/.test(app), "Home settings has a Couch TV Studio section");

// 9. the design store: Couch TV Studio's own when config.json names none; "" turns it off; a preview never reaches it
function code(search, cfg, withGate) {
  const mem = {};
  const sb = { location: { search: search || "" }, COUCH_CONFIG: cfg, localStorage: { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }, setTimeout, clearTimeout, atob };
  sb.window = sb;
  if (withGate) sb.CouchDesigner = G;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sb);
  return sb.window.CouchDesignCode;
}
ok(code("", {}, true).base() === G.DEFAULT_STORE, "no design_store: Couch TV Studio's own store");
ok(code("", { design_store: "" }, true).base() === "", "design_store \"\": no store, so no Get a design and no sharing");
ok(code("", { design_store: "https://designs.example" }, true).base() === "https://designs.example", "a design_store of its own wins");
ok(code("?mock=1", {}, true).base() === "", "a browser preview never reaches the real store");
ok(code("", {}, false).base() === "", "without the gate loaded, nothing changes");
ok(/^https:\/\/[a-z0-9.-]+$/.test(G.DEFAULT_STORE), "the default store is https with no path");
// option C (the on-TV app, no computer, no config.json): its config.js (Store.publicConfig) names no
// store, so Get a design and Share this home use Couch TV Studio's own; Home settings, Designs,
// the Your design switch is the off switch there
const onTv = { people: [], weather: { place: "Town" }, tvs: [{ id: "this-tv", name: "This TV" }], default_tv: "this-tv", mode: "on-tv" };
ok(code("", onTv, true).base() === G.DEFAULT_STORE, "option C: the on-TV app's config gets Couch TV Studio's own store");
const ontvStore = fs.readFileSync(path.join(__dirname, "../on-tv/android/app/src/main/java/dev/couchtv/ontv/Store.kt"), "utf8");
ok(/fun publicConfig\(\)/.test(ontvStore) && !/design_store/.test(ontvStore), "option C: the on-TV app never sets design_store, so the default applies");
ok(/from\(tvHomeWeb\) \{ into\("tv"\); exclude\("mock\.js"\) \}/.test(fs.readFileSync(path.join(__dirname, "../on-tv/android/app/build.gradle.kts"), "utf8")), "option C: the on-TV app carries this branch's whole TV home (design.js, the catalogue, the gate)");

// 0.13.5, a TCL beginner test: Turn on Couch TV Studio said "Couch TV Studio is on" while the row above
// still said "Off" and the button "Turn on", because the row read the gate worked out at start. The
// choice just made wins; with none made, the gate and a design on screen decide.
ok(G.shownOn("on", false, false) === true, "just turned on: the row says on at once");
ok(G.shownOn("off", true, true) === false, "Your design off: the row says off at once");
ok(G.shownOn(null, true, false) === true && G.shownOn(null, false, true) === true, "nothing chosen: the gate or a design on screen");
ok(G.shownOn(null, false, false) === false && G.shownOn("maybe", false, false) === false, "nothing chosen and nothing on: off");
const appJs = fs.readFileSync(path.join(web, "app.js"), "utf8");
ok(/CouchDesigner\.shownOn\(kept\(CouchDesigner\.KEY\)/.test(appJs), "Home settings reads the kept choice, not only the gate from start");

console.log(`${n} Couch TV Studio opt in tests passed.`);
