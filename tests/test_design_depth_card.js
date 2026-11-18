// Two small design additions (tv-home/web/design.js and widgets.js, 18 Nov 2026):
// background.depth draws a built in scene's hills (scene-<name>-fg.webp) between the widgets behind and
// the widgets in front, so a clock can stand behind the mountains; and a custom card can carry a title,
// a line of words and an icon typed in couch-tv Studio (words only, like every word in a design).
// Run: node tests/test_design_depth_card.js
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

console.log("Running depth and custom card tests...");

// depth: kept only on a built in scene that has a cut out of its hills, and only as true or false
const bg = (b) => plain(CD.sanitize({ background: b })).background || {};
["night", "golden", "fog", "dawn"].forEach((s) => ok(bg({ image: "backgrounds/scene-" + s + ".jpg", depth: true }).depth === true, "depth kept on scene " + s));
ok(bg({ image: "backgrounds/scene-water.jpg", depth: true }).depth === undefined, "water has no hills to cut out: no depth");
ok(bg({ image: "backgrounds/grose-valley.jpg", depth: true }).depth === undefined, "a photo without a cut out: no depth");
ok(bg({ image: "data:image/jpeg;base64,AAAA", depth: true }).depth === undefined, "your own photo: no depth");
ok(bg({ image: "backgrounds/scene-night.jpg", depth: "yes" }).depth === undefined, "depth is true or false only");
ok(bg({ colour: "#000000", depth: true }).depth === undefined, "a plain colour: no depth");
ok(bg({ image: "backgrounds/scene-night.jpg", depth: false }).depth === false, "depth off is kept as off");

// the rule that draws it (css() is not exported, so read the source): the scene's own cut out, at
// z-index 1 between the back (0) and front (3) widget layers, hidden outside the Night look
const src = fs.readFileSync(path.join(web, "design.js"), "utf8");
ok(src.indexOf('src.replace(/\\.jpg$/, "-fg.webp")') >= 0, "the depth layer uses the scene's own cut out");
ok(/#cd-depth\{position:fixed[^"]*z-index:1/.test(src), "the depth layer sits between the back (0) and front (3) widgets");
ok(src.indexOf(':not(.theme-night) #cd-depth') >= 0, "the depth layer is hidden outside the Night look");
ok(fs.existsSync(path.join(web, "backgrounds", "scene-night-fg.webp")), "the cut out pictures ship with the home");

// a custom card: title, words and icon kept as words, digits and links dropped like every design word
const card = (opts) => (plain(CD.sanitize({ objects: [{ id: "c1", type: "widget", kind: "card", opts: opts }] })).objects || [])[0].opts || {};
const c1 = card({ label: "Pool", text: "Warm enough for a swim", icon: "sun" });
ok(c1.label === "Pool" && c1.text === "Warm enough for a swim" && c1.icon === "sun", "a card keeps its title, words and icon");
ok(!card({ label: "Solar 18 kWh" }).label, "a line with digits is dropped whole");
ok(!card({ text: "see https://example.com" }).text, "a link is dropped");
ok(card({ icon: "<svg>" }).icon === undefined, "an icon is a plain name only");
ok(card({ value: "x", url: "https://example.com" }).value === undefined, "only title, words and icon are kept");

console.log("All " + n + " depth and custom card tests passed.");
