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

// 8b. Glass words (style.ink "glass", 24 Nov 2026): the gate keeps it, on a widget and on a stack item, and still
// drops a text colour not on the list; the speed list charges 1 for each widget with glass words, nothing without
const ink = (v) => (san({ id: "i", type: "widget", kind: "clock", style: { ink: v } })[0].style || {}).ink;
ok(ink("glass") === "glass", "text colour Glass is kept");
["auto", "white", "ink", "accent"].forEach((v) => ok(ink(v) === v, "text colour " + v + " is still kept"));
ok(ink("frosted") === undefined && ink("glass;color:red") === undefined && ink("GLASS") === undefined, "a text colour not on the list is still dropped");
const gst = san({ id: "s", type: "widget", kind: "stack", items: [{ kind: "clock", style: { ink: "glass" } }, { kind: "moon", style: { ink: "smoke" } }] })[0];
ok(gst.items[0].style.ink === "glass" && (gst.items[1].style || {}).ink === undefined, "a stack item keeps Glass and drops a made up colour");
const gline = (objs) => plain(CD.cost({ objects: objs })).filter((c) => c[2] === "glasstext")[0];
ok(gline(san({ id: "a", type: "widget", kind: "clock", w: 360, h: 160 })) === undefined, "no glass words, nothing on the speed list for them");
const g3 = gline([{ id: "a", type: "widget", kind: "clock", w: 360, h: 160, style: { ink: "glass" } },
  { id: "b", type: "widget", kind: "rain", w: 360, h: 360, style: { ink: "glass" } },
  { id: "c", type: "widget", kind: "moon", w: 360, h: 360, style: { ink: "white" } },
  { id: "d", type: "widget", kind: "stack", w: 360, h: 360, items: [{ kind: "moon" }, { kind: "clock", style: { ink: "glass" } }] }]);
ok(g3 && g3[0] === "Glass words (3)" && g3[1] === 3, "Glass words cost 1 a widget, a stack with a glass item counting once");
ok(gline([{ id: "a", type: "widget", kind: "clock", hidden: true, style: { ink: "glass" } }]) === undefined, "a hidden widget's glass words cost nothing");
// Liquid glass words (style.ink "liquid"): kept by the gate, weighed like a frosted card (3 each), on their own line
ok(ink("liquid") === "liquid", "text colour Liquid glass is kept");
ok(ink("liquid glass") === undefined && ink("Liquid") === undefined, "a misspelt Liquid is dropped");
const lline = (objs) => plain(CD.cost({ objects: objs })).filter((c) => c[2] === "liquidtext")[0];
ok(lline([{ id: "a", type: "widget", kind: "clock", style: { ink: "glass" } }]) === undefined, "Glass words are not charged as Liquid glass");
const l2 = lline([{ id: "a", type: "widget", kind: "tallclock", w: 1160, h: 460, style: { ink: "liquid" } },
  { id: "b", type: "widget", kind: "date", w: 760, h: 60, style: { ink: "liquid" } },
  { id: "c", type: "widget", kind: "moon", hidden: true, w: 360, h: 360, style: { ink: "liquid" } },
  { id: "d", type: "widget", kind: "clock", w: 360, h: 160, style: { ink: "glass" } }]);
ok(l2 && l2[0] === "Liquid glass words (2)" && l2[1] === 6, "Liquid glass words cost 3 a widget, hidden ones nothing");
const fr1 = plain(CD.cost({ objects: [{ id: "f", type: "widget", kind: "clock", w: 360, h: 160, style: { panel: "glass" } }] })).filter((c) => c[2] === "frosted")[0];
ok(fr1 && l2[1] / 2 >= fr1[1], "a Liquid glass widget weighs at least as much as a frosted card");
const both = plain(CD.cost({ objects: [{ id: "a", type: "widget", kind: "clock", style: { ink: "glass" } }, { id: "b", type: "widget", kind: "clock", style: { ink: "liquid" } }] }));
ok(both.some((c) => c[2] === "glasstext" && c[1] === 1) && both.some((c) => c[2] === "liquidtext" && c[1] === 3), "Glass and Liquid glass each on their own line");

// 8c. widgets.css draws them: see through words with a light top edge, smoked glass on a light box, and solid
// words on a slower TV (html.lighter, html.glass-lite) with no see through colour and no glow under smoke
const css = fs.readFileSync(path.join(web, "widgets.css"), "utf8");
const rule = (sel) => { const m = css.split("\n").filter((l) => l.split("{")[0].split(",").map((s) => s.trim()).indexOf(sel) >= 0); return m.join("\n"); };
ok(/text-shadow: 0 -1px 0 rgba\(255, 255, 255, 0\.5\)/.test(rule(".cw-ink-glass")) && rule(".cw-ink-glass *") === rule(".cw-ink-glass"), ".cw-ink-glass: a light top edge and a soft shadow on every word inside");
ok(/text-shadow: 0 1px 0 rgba\(255, 255, 255, 0\.75\)/.test(rule(".cw-ink-smoke")) && rule(".cw-ink-smoke *") === rule(".cw-ink-smoke"), ".cw-ink-smoke: smoked glass with a light edge under");
["lighter", "glass-lite"].forEach((h) => {
  ok(/--ink: #fff !important/.test(rule("html." + h + " .cw-ink-glass")), "html." + h + ": glass words go solid white");
  ok(/--ink: #1d1b18 !important/.test(rule("html." + h + " .cw-ink-smoke")), "html." + h + ": smoked words go solid dark");
  ok(/text-shadow: 0 2px 6px/.test(rule("html." + h + " .cw-ink-glass *")), "html." + h + ": glass words keep one cheap shadow");
  ok(/text-shadow: none !important/.test(rule("html." + h + " .cw-ink-smoke *")), "html." + h + ": smoked words lose their shadow");
});
ok(!/backdrop-filter|filter:/.test(css.split("\n").filter((l) => /cw-ink-(glass|smoke)/.test(l)).join("\n")), "glass words never blur what is behind them");
// Liquid glass: the photo clipped to the letters, only with .cw-lq-on and never on a slower TV
const lq = css.slice(css.indexOf("/* Liquid glass words"), css.indexOf(".cw-bare {"));
const lqSel = lq.replace(/\/\*[^]*?\*\//g, "").split("{").slice(0, -1).map((s) => s.split("}").pop().trim()).filter((s) => /cw-ink-liquid/.test(s));
ok(lqSel.length >= 2 && lqSel.every((s) => s.split(",").every((p) => /^html:not\(\.lighter\):not\(\.glass-lite\) \.cw-ink-liquid\.cw-lq-on /.test(p.trim()))), "every Liquid glass rule waits for .cw-lq-on and skips html.lighter and html.glass-lite");
ok(/background-image:[^;]*var\(--lq-img\)/.test(lq) && /-webkit-background-clip: text/.test(lq) && /background-attachment: scroll, fixed/.test(lq), "the photo is clipped to the letters, lined up with the screen");
ok(/-webkit-text-fill-color: transparent/.test(lq) && /-webkit-text-stroke: 1px rgba\(255, 255, 255/.test(lq), "letters are clear with a bright rim");
ok(!/backdrop-filter/.test(lq), "no live backdrop blur: the frosted copy of the photo does the blur");
const wjs = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
const lb = wjs.slice(wjs.indexOf("var LQ_FROST"), wjs.indexOf("function shell("));
ok(/contains\("lighter"\)/.test(lb) && /contains\("glass-lite"\)/.test(lb) && /mem > 0 && mem < 2/.test(lb), "liquidBack gives nothing on a lighter, glass lite or 1 GB TV");
ok(/scene-\(dawn\|fog\|golden\|night\|water\)/.test(lb) && ["dawn", "fog", "golden", "night", "water"].every((s) => fs.existsSync(path.join(web, "backgrounds/scene-" + s + "-glass.jpg"))), "the five scenes it swaps for a frosted copy each ship one");

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
