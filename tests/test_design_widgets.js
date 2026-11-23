// Widgets in a design (tv-home/web/design.js, CouchDesign.sanitize; drawn by widgets.js): a widget is a
// kind from a fixed list, a set size, a style from fixed lists and plain colours, and per kind options,
// each on an allow list with clamped values. Words go through the same checks as every other word; a
// design never carries a link, markup or a prototype key; the speed list counts widgets.
// Run: node tests/test_design_widgets.js
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
const san = (o) => plain(CD.sanitize({ objects: [o] })).objects || [];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

console.log("Running design widget tests...");

// 1. every kind sanitises, at a set size, with its own box
CD.wkinds().filter((k) => k !== "stack").forEach((kind) => {
  const out = san({ id: "w1", type: "widget", kind, size: "small", x: 80, y: 60, w: 360, h: 360 });
  ok(out.length === 1 && out[0].kind === kind && out[0].size === "small" && out[0].w === 360, "kind kept: " + kind);
});
ok(san({ id: "w1", type: "widget", kind: "garage_opener" }).length === 0, "an unknown kind is dropped");
ok(san({ id: "w1", type: "widget", kind: "clock", size: "6x3" })[0].size === "6x3", "a half cell size WxH is kept");
ok(san({ id: "w1", type: "widget", kind: "clock", size: "huge" })[0].size === undefined, "a size not on the list is dropped");
ok(san({ id: "w1", type: "widget", kind: "clock", rotate: 30, scale: 3 })[0].rotate === undefined, "a widget never turns or scales");

// 2. unknown keys, links and markup go
const hostile = san({ id: "w2", type: "widget", kind: "folder", onclick: "alert(1)", html: "<b>x</b>", __proto__: { evil: 1 },
  style: { panel: "glass", colour: "red;background:url(http://evil.example/x.png)", font: "comic", corners: "round", opacity: 5, shadow: "huge", evil: 1 },
  opts: { label: "Streaming <img src=x onerror=alert(1)>", apps: ["com.netflix.ninja", "__proto__", "gear", "http://x", "au.net.abc.iview"], cols: 99, src: "https://evil.example/x.png", evil: true } })[0];
ok(hostile && hostile.onclick === undefined && hostile.html === undefined && hostile.evil === undefined, "unknown widget keys are dropped");
ok(hostile.style.colour === undefined, "a colour with css in it is dropped");
ok(hostile.style.font === undefined && hostile.style.shadow === undefined && hostile.style.evil === undefined, "style picks only from its lists");
ok(hostile.style.opacity === 1, "opacity is clamped");
ok(hostile.opts.cols === 6, "cols is clamped");
ok(JSON.stringify(hostile.opts.apps) === JSON.stringify(["com.netflix.ninja", "au.net.abc.iview"]), "apps are package names only: no prototype keys, no Settings, no links");
ok(hostile.opts.src === undefined && hostile.opts.evil === undefined, "options not on the kind's list are dropped");
ok(!/[<>]/.test(hostile.opts.label || ""), "words never keep markup");
ok(san({ id: "w3", type: "widget", kind: "photo", opts: { image: "https://evil.example/beacon.jpg" } })[0].opts === undefined, "a photo from another site is dropped (it would tell a stranger the TV's address)");
ok(san({ id: "w3", type: "widget", kind: "photo", opts: { image: "backgrounds/scene-fog.jpg" } })[0].opts.image === "backgrounds/scene-fog.jpg", "a picture from the TV itself is kept");
ok(san({ id: "w4", type: "widget", kind: "clock", opts: { label: "x" } })[0].opts === undefined, "a clock takes no label (its own allow list)");

// 3. words go through the phone and web checks
const words = plain(CD.sanitize({ objects: [{ id: "w5", type: "widget", kind: "welcome", opts: { text: "Call us on 0512 345 678", kicker: "Visit evil dot com" } }] }));
const wo = words.objects[0].opts || {};
ok(!/\d/.test(wo.text || ""), "digits are not words (a phone number cannot be typed)");
const flagged = CD.check({ objects: [{ id: "w6", type: "widget", kind: "welcome", opts: { text: "Welcome", sub: "book at stay dot com" } }] });
ok(flagged.flags.some((f) => f.kind === "web"), "a web address in a widget is flagged");
const clean = CD.check({ objects: [{ id: "w6", type: "widget", kind: "welcome", opts: { text: "Welcome", sub: "book at stay dot com" } }] }).clean;
ok(!(clean.objects[0].opts || {}).sub, "and not drawn");
const split = CD.check({ objects: [{ id: "a", type: "widget", kind: "welcome", y: 60, opts: { text: "zero four one two" } }, { id: "b", type: "widget", kind: "quote", y: 200, opts: { text: "three four five six seven eight" } }] });
ok(split.flags.some((f) => f.kind === "phone"), "a number split over two widgets is caught");

// 4. numbers and pickers clamp
const cd = san({ id: "c", type: "widget", kind: "countdown", opts: { month: 44, day: -3, unit: "fortnights", label: "Christmas" } })[0].opts;
ok(cd.month === 12 && cd.day === 1 && cd.unit === undefined && cd.label === "Christmas", "countdown dates clamp, units pick");
const bins = san({ id: "b", type: "widget", kind: "bins", opts: { weekday: 9, anchor: -5, lid_a: "javascript:alert(1)", bin_a: "Recycling" } })[0].opts;
ok(bins.weekday === 6 && bins.anchor === 0 && bins.lid_a === undefined && bins.bin_a === "Recycling", "bin rule is numbers and plain colours");
const wc = san({ id: "w", type: "widget", kind: "worldclock", opts: { cities: ["Europe/London", "javascript:x", "Asia/Tokyo", "../../etc"] } })[0].opts;
ok(JSON.stringify(wc.cities) === JSON.stringify(["Europe/London", "Asia/Tokyo"]), "cities are time zone names only");
const ctl = san({ id: "c", type: "widget", kind: "controls", opts: { controls: [{ icon: "light", name: "Lounge" }, { icon: "nuke", name: "x" }, { icon: "lock", name: "Call 0512345678" }] } })[0].opts.controls;
ok(ctl.length === 2 && ctl[0].name === "Lounge" && ctl[1].icon === "lock", "controls: known icons, names as words");

// 5. stacks: up to 10 of one size, never a stack in a stack, and their words are checked too
const st = san({ id: "s", type: "widget", kind: "stack", turn: 20, items: [{ kind: "weather" }, { kind: "stack" }, { kind: "clock", style: { panel: "glass" } }, { kind: "nope" }].concat(Array(20).fill({ kind: "moon" })) })[0];
ok(st.items.length <= 10 && st.items.every((i) => i.kind !== "stack" && i.kind !== "nope"), "stack items: known kinds, no stack in a stack, at most 10");
ok(st.turn === 20 && san({ id: "s", type: "widget", kind: "stack", turn: 7, items: [{ kind: "moon" }] })[0].turn === undefined, "turn picks from 10, 20, 30, 60 or smart");
ok(san({ id: "s", type: "widget", kind: "stack", items: [] }).length === 0, "an empty stack is dropped");

// 6. the look, the background gradient
const d = plain(CD.sanitize({ look: { ink: "#ff3b30", panel: "rgba(1, 2, 3, 0.4)", focus: "url(x)", icons: "playful", evil: 1 }, background: { colour: "#000", colour2: "#123456", angle: 999, radial: true } }));
ok(d.look.ink === "#ff3b30" && d.look.focus === undefined && d.look.icons === "playful" && d.look.evil === undefined, "the look is plain colours and an icon style");
ok(d.background.colour2 === "#123456" && d.background.angle === 360 && d.background.radial === true, "a background gradient is two colours and an angle");

// 7. widgets are the home: never pushed behind it or left out for covering the screen; still inside the safe area
const full = plain(CD.sanitize({ objects: [{ id: "f", type: "widget", kind: "slideshow", x: 0, y: 0, w: 1920, h: 1080 }, { id: "g", type: "widget", kind: "clock", x: 80, y: 60, w: 760, h: 360 }] }));
ok(full.objects.length === 2 && full.objects[0].layer !== "back", "a full screen photo frame is kept in front");
ok(full.objects[0].w === 1760 && full.objects[0].h === 960 && full.objects[0].x === 80 && full.objects[0].y === 60, "and kept inside the safe area");

// 8. glass is slow: at most six frosted panels, the rest solid; widgets count on the speed list
const many = plain(CD.sanitize({ objects: Array.from({ length: 9 }, (_, i) => ({ id: "g" + i, type: "widget", kind: "rain", x: 80 + (i % 4) * 400, y: 60 + Math.floor(i / 4) * 400, w: 360, h: 360 })) }));
ok(many.objects.filter((o) => (o.style || {}).panel === "solid").length === 3, "the seventh frosted widget on is made solid");
const cost = plain(CD.cost({ objects: [{ id: "a", type: "widget", kind: "slideshow", w: 760, h: 760 }, { id: "b", type: "widget", kind: "clock", w: 360, h: 160 }] }));
const wline = cost.filter((c) => c[2] === "widgets")[0];
ok(wline && wline[1] >= 5, "widgets are on the speed list, a slideshow weighing more than a clock");

// 9. every preset passes the gate with no notes and keeps all its widgets
const presets = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/design-presets.json"), "utf8"));
ok(presets.length === 17, "17 presets in the fixture");
presets.forEach((p) => {
  const r = CD.check(p.design);
  ok(r.notes.length === 0, p.id + ": no notes (" + r.notes.join(" ") + ")");
  ok(r.flags.length === 0, p.id + ": no flagged words");
  ok(plain(r.clean).objects.length === p.design.objects.length, p.id + ": every widget kept");
});

// 10. widgets.js draws with elements only: no markup parsed from anything
const wsrc = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(wsrc), "widgets.js never parses markup or code");
ok(/parseFromString\(src, "image\/svg\+xml"\)/.test(wsrc) && /T\.svg\(style, name/.test(wsrc), "icons are parsed from icon-sets.js only (code that ships with the home)");
const kinds = CD.wkinds().filter((k) => k !== "stack");
// Ask AI and From your AI are drawn by ask.js, which hands widgets.js its renderers (CouchWidgets.define)
const asrc = fs.readFileSync(path.join(web, "ask.js"), "utf8");
kinds.forEach((k) => ok(new RegExp("\\bR\\." + k + " = function").test(wsrc) || new RegExp("CW\\.define\\(\"" + k + "\", ").test(asrc), "a renderer for " + k));
ok(/getAttribute\("data-empty"\)/.test(wsrc) && /function empty\(/.test(wsrc), "widgets with nothing to show say so in their own box");

console.log("OK: " + n + " checks");
