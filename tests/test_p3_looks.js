// Phase 3 looks (lane P3c, 28 Nov 2026): what design.js keeps and how it reads an older design.
//  15  Box behind it: Studio shows Glass, Solid and None. "colour" and "paper" stay valid (every TV out there reads
//      them); style.texture is none, paper, linen or grain. Opening an older design drops a colour that only a
//      Colour box ever showed (so it looks exactly the same), and a texture on a see through box.
//  E1  one font list: widgets take the eight fonts words and clocks take, and words and clocks take the widgets' three.
//  16  style.app_shape (circle, square, rounded, words) and style.app_colour (colour, mono, own).
//  17  the tvsettings widget (opts.words), "tvsettings" as an app in a folder or dock, and the quick button.
//  18b style.day_from and day_to ("HH:MM", both or neither) for Show at night or in the day.
// Run: node tests/test_p3_looks.js
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
vm.runInContext(fs.readFileSync(path.join(web, "app-catalogue.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), sandbox);
const CD = sandbox.window.CouchDesign;
const plain = (v) => JSON.parse(JSON.stringify(v));
const W = (kind, style, opts) => ({ id: "w1", type: "widget", kind, size: "small", x: 80, y: 60, w: 360, h: 360, style, opts });
const san1 = (o) => (plain(CD.sanitize({ objects: [o] })).objects || [])[0];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running Phase 3 looks tests...");

// 15: the box
ok(san1(W("note", { panel: "colour", colour: "#30b0c7", texture: "paper" })).style.texture === "paper", "Paper on a colour box is a texture, kept");
ok(san1(W("note", { panel: "colour", colour: "#30b0c7", texture: "linen" })).style.texture === "linen", "Linen kept");
ok(san1(W("note", { panel: "solid", texture: "grain" })).style.texture === "grain", "Grain on a plain solid box kept");
ok(san1(W("note", { panel: "solid", texture: "silk" })).style.texture === undefined, "a texture not on the list goes");
ok(san1(W("note", { panel: "colour", colour: "#30b0c7", texture: "none" })).style.texture === undefined, "texture none is not stored");
let s = san1(W("clock", { panel: "solid", texture: "paper" })).style;
ok(s.panel === "paper" && s.texture === undefined, "Paper on a plain solid box is the Paper box itself");
ok(san1(W("clock", { panel: "glass", texture: "paper" })).style.texture === undefined, "no texture on a glass box");
ok(JSON.stringify(san1(W("clock", { panel: "none", texture: "linen" })).style) === '{"panel":"none"}', "no texture on no box");
// older designs: the look stays exactly as it was
s = san1(W("weather", { panel: "colour" })).style;
ok(s.panel === "colour" && !s.colour, "an old Colour box with the kind's own colour stays");
s = san1(W("countdown", { panel: "colour", colour: "#ff9500", gradient: "soft" })).style;
ok(s.panel === "colour" && s.colour === "#ff9500" && s.gradient === "soft", "an old Colour box with its colour stays");
ok(san1(W("note", { panel: "paper" })).style.panel === "paper", "an old Paper box stays");
ok(san1(W("note", { panel: "paper", colour: "#ff0000" })).style.colour === undefined, "a colour on Paper never showed: dropped");
ok(san1(W("date", { panel: "solid", colour: "#00ff00" })).style.colour === undefined, "a colour on Solid never showed: dropped");
ok(san1(W("date", { panel: "glass", colour: "#00ff00" })).style.colour === undefined, "a colour on Glass never showed: dropped");
ok(san1(W("weather", { colour: "#123456" })).style.colour === "#123456", "a colour on a kind whose own box is Colour stays");
ok(san1(W("word", { colour: "#123456" })).style === undefined, "a colour on a kind whose own box is Paper goes");
ok(san1({ id: "s", type: "widget", kind: "stack", size: "small", x: 80, y: 60, w: 360, h: 360, items: [{ kind: "note", style: { panel: "paper", colour: "#ff0000" } }] }).items[0].style.colour === undefined, "the same inside a stack");
ok(JSON.stringify(CD.tidyBox("note", { panel: "solid", texture: "paper" })) === '{"panel":"paper"}', "CouchDesign.tidyBox (Studio's migration) is the same rule");
const src = { panel: "paper", colour: "#ff0000" }; CD.tidyBox("note", src);
ok(src.colour === "#ff0000", "tidyBox never changes the style it is given");
// the speed list counts textures
const cost = (objs) => CD.cost({ objects: objs }).map((x) => x[0]);
ok(cost([W("note", { panel: "colour", colour: "#30b0c7", texture: "paper" })]).some((t) => /^Textures \(1\)$/.test(t)), "a texture is on the speed list");
ok(!cost([W("note", { panel: "paper" })]).some((t) => /^Textures/.test(t)), "the Paper box alone costs no texture");

// E1: one font list
["inter", "antonio", "rounded", "condensed", "jost", "serif", "cormorant", "mono"].forEach((f) => {
  ok(san1(W("clock", { font: f })).style.font === f, "a widget takes " + f);
  const t = (plain(CD.sanitize({ objects: [{ id: "t1", type: "text", text: "Hi", x: 100, y: 100, font: f }] })).objects || [])[0];
  ok(t && t.font === f, "words take " + f);
});

// 16: app icons
["circle", "square", "rounded", "words"].forEach((v) => ok(san1(W("folder", { app_shape: v })).style.app_shape === v, "app_shape " + v));
["colour", "mono", "own"].forEach((v) => ok(san1(W("folder", { app_colour: v })).style.app_colour === v, "app_colour " + v));
ok(san1(W("folder", { app_shape: "star", app_colour: "neon" })).style === undefined, "app icon looks not on the list go");
ok(san1(W("folder", {}, { names: true })).opts.names === true, "a folder takes Names under icons");

// 17: TV settings
ok(CD.wkinds().indexOf("tvsettings") >= 0, "tvsettings is a widget kind");
let t = san1(W("tvsettings", undefined, { words: "short" }));
ok(t && t.kind === "tvsettings" && t.opts.words === "short", "the TV settings tile keeps its words");
ok(san1(W("tvsettings", undefined, { words: "loud" })).opts === undefined, "words not on the list go");
ok(CD.wpanel({ kind: "tvsettings" }) === "glass", "the TV settings tile is glass to start");
ok(JSON.stringify(san1(W("folder", undefined, { apps: ["netflix", "tvsettings", "com.android.tv.settings"] })).opts.apps) === '["netflix","tvsettings","tvsettings"]' ||
   JSON.stringify(san1(W("folder", undefined, { apps: ["netflix", "tvsettings"] })).opts.apps) === '["netflix","tvsettings"]', "tvsettings is an app a folder may hold");
ok(JSON.stringify(san1(W("folder", undefined, { apps: ["netflix", "tvsettings"] })).opts.apps) === '["netflix","tvsettings"]', "a folder keeps netflix and tvsettings");
ok(sandbox.window.CouchApps.get("tvsettings").name === "TV settings", "the app catalogue knows TV settings");
ok(JSON.stringify(san1(W("quick", undefined, { quick: ["sleep", "tvsettings"] })).opts.quick) === '["sleep","tvsettings"]', "TV settings is a quick button");

// 18b: own times
s = san1(W("note", { show: "day", day_from: "07:00", day_to: "21:00" })).style;
ok(s.show === "day" && s.day_from === "07:00" && s.day_to === "21:00", "own day times kept");
s = san1(W("note", { show: "night", day_from: "07:00" })).style;
ok(s.day_from === undefined && s.day_to === undefined, "one time alone is dropped (both or neither)");
s = san1(W("note", { show: "night", day_from: "7am", day_to: "25:00" })).style;
ok(s.day_from === undefined && s.day_to === undefined, "times not HH:MM are dropped");
s = san1(W("note", { show: "night", day_from: "07:00", day_to: "07:00" })).style;
ok(s.day_from === undefined, "the same start and end is no day at all: dropped");

console.log("All " + n + " Phase 3 looks tests passed.");
