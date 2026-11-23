// The design block is untrusted input (tv-home/web/design.js, CouchDesign.sanitize): only known keys,
// numbers clamped, choices from fixed lists, plain colours, text as text, and no outside links.
// Run: node tests/test_design_gate.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
// just enough of a page for design.js to load: it only touches the page once a design is applied
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
const S = sandbox.window.CouchDesign.sanitize;
const plain = (v) => JSON.parse(JSON.stringify(v));

console.log("Running design gate tests...");

const evil = {
  v: 1,
  sneaky: { a: 1 },                                          // unknown top level key
  home: { video_url: "http://198.51.100.7/beacon.mp4", glass: "on", scenes: ["night", "<img src=x>"], evil: true },
  background: { image: "http://198.51.100.7/beacon.jpg", darken: 99 },
  elements: {
    clock: { x: 1e12, y: -1e12, scale: 1e9, colour: "red;}body{display:none", font: "Comic Sans", onload: "alert(1)" },
    date: { format: "<script>", colour: "#fff" },
    dock: { icon_size: -5, columns: 1e6, layout: "spiral" },
    hacker: { x: 5 }                                         // unknown part
  },
  apps: { order: ["com.netflix.ninja", "x\"]{}body{display:none}", 5], tiles: { "com.netflix.ninja": { free: true, x: 9e15, scale: 50 }, "bad\"pkg": { x: 1 } } },
  objects: [
    { id: "t1", type: "text", text: '<img src=x onerror="alert(1)"><script>alert(2)</script>', size: 1e9, colour: "url(http://198.51.100.7/x)" },
    { id: "t2\"><script>", type: "text", text: "bad id" },
    { id: "s1", type: "script", text: "not a type" },
    { id: "w1", type: "smart", kind: "camera", style: "card", name: "Door", entity: "camera.front; DROP", zones: ["<b>x</b>", 7, "Kitchen"] }
  ],
  texts: [{ text: "old‮word", x: "12", y: null, size: "huge" }]
};
const out = plain(S(evil));

// unknown keys go, at every level
assert.strictEqual(out.sneaky, undefined);
assert.strictEqual(out.home.evil, undefined);
assert.strictEqual(out.elements.hacker, undefined);
assert.strictEqual(out.elements.clock.onload, undefined);
// no outside links: the image and the video are dropped
assert.strictEqual(out.background, undefined, "an http background image is dropped, and the background with it");
assert.strictEqual(out.home.video_url, undefined, "design.home never carries a video link");
for (const img of ["https://example.com/a.jpg", "javascript:alert(1)", "//example.com/a.jpg", "file:///etc/passwd", "backgrounds/../../x.jpg",
  "backgrounds//evil.com/a.jpg", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4=", "blob:http://x/1"]) {
  assert.strictEqual(plain(S({ background: { image: img } })).background, undefined, "refused: " + img);
}
assert.strictEqual(plain(S({ background: { image: "backgrounds/mine/sea.jpg" } })).background.image, "backgrounds/mine/sea.jpg");
assert.ok(plain(S({ background: { image: "data:image/jpeg;base64,/9j/4AAQ" } })).background.image.startsWith("data:image/jpeg"));
// huge numbers are clamped
assert.strictEqual(out.elements.clock.x, 3840);
assert.strictEqual(out.elements.clock.y, -2160);
assert.strictEqual(out.elements.clock.scale, 3, "the clock can be very big, not bigger than the screen can use (LIMIT.part)");
assert.strictEqual(out.elements.dock.icon_size, 40);
assert.strictEqual(out.elements.dock.columns, 12);
assert.strictEqual(out.apps.tiles["com.netflix.ninja"].x, 3840);
assert.strictEqual(out.apps.tiles["com.netflix.ninja"].scale, 4);
assert.strictEqual(plain(S({ objects: [{ id: "big", type: "text", text: "Hello", size: 1e9 }] })).objects[0].size, 400, "a huge word size is clamped");
// choices only from their lists; colours and fonts only in allowed forms
assert.strictEqual(out.elements.clock.colour, undefined, "a colour carrying CSS is dropped");
assert.strictEqual(out.elements.clock.font, undefined);
assert.strictEqual(out.elements.date.format, undefined);
assert.strictEqual(out.elements.date.colour, "#fff");
assert.strictEqual(out.elements.dock.layout, undefined);
assert.deepStrictEqual(out.home.scenes, ["night"]);
assert.strictEqual(out.objects[0].colour, undefined, "url() in a colour is dropped");
// ids, package names and object types from their patterns only
assert.deepStrictEqual(out.apps.order, ["com.netflix.ninja"]);
assert.strictEqual(out.apps.tiles['bad"pkg'], undefined);
assert.deepStrictEqual(out.objects.map((o) => o.id), ["w1"], "a bad id and an unknown type are dropped (and t1, all markup, has no line a TV shows)");
assert.strictEqual(out.objects.find((o) => o.id === "w1").entity, undefined);
// text stays text: kept as the characters typed (it is drawn with textContent), with no bidi tricks
// v8: words are an allow list: the markup characters, digits and the rest are simply gone
assert.ok(!out.objects.some((o) => o.id === "t1"), "words with markup in them are not shown at all (v9: a line with a blocked character is dropped whole)");
assert.deepStrictEqual(plain(out.objects.find((o) => o.id === "w1").zones), ["Kitchen"]);
assert.strictEqual(out.texts[0].text, "", "a line with a direction override in it is not shown at all (v9)");
assert.strictEqual(out.texts[0].x, 12);
assert.strictEqual(out.texts[0].size, undefined);
// nothing at all, or rubbish, gives an empty design
[null, "x", 3, [], { objects: "x" }, { elements: [] }].forEach((d) => assert.deepStrictEqual(plain(S(d)), { v: 1 }));

// and the drawing code builds elements: the only markup it parses is its own fixed icons
const src = fs.readFileSync(path.join(web, "design.js"), "utf8");
const html = src.split("\n").filter((l) => /innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write/.test(l));
assert.strictEqual(html.length, 1, "design.js has exactly one innerHTML");
// (sections, 17 Nov 2026: or an icon set registered by code shipped with the home, CouchDesign.registerIcons,
// which keeps only <svg> markup for known icon names; a design only ever names a set)
assert.ok(/ICON_NODES\[key\].*tpl\.innerHTML = src/.test(html[0]) && /var src = \(set && ICON_SETS\[set\] && ICON_SETS\[set\]\[name\]\) \? ICON_SETS\[set\]\[name\] : ICON\[name\] \|\| ICON\.light/.test(src),
  "and it parses design.js's own icon markup (or a set registered by code), never a design value");

// ---- lockout: Settings and More apps can never be hidden or pulled out, a front cover goes behind,
// the dock stays visible, and a design that hides a part takes it out of the remote's path too
const C = sandbox.window.CouchDesign.check;
const lock = C({ v: 1,
  elements: { dock: { hidden: true, scale: 0.05, opacity: 0 }, people: { hidden: true } },
  apps: { hidden: ["gear", "more", "com.android.tv.settings", "com.netflix.ninja"], tiles: { gear: { free: true, x: 4000 }, more: { hidden: true } } },
  objects: [{ id: "cover", type: "shape", variant: "solid", colour: "#000000", x: 0, y: 0, w: 3840, h: 2160, layer: "front" },
            { id: "msg", type: "text", text: "Your TV is mine now. Call 1300 123 456 or visit pay-me.com", x: 600, y: 480, size: 80 }] });
assert.deepStrictEqual(plain(lock.clean.apps.hidden), ["com.netflix.ninja"], "Settings and More apps cannot be hidden");
assert.strictEqual(lock.clean.apps.tiles, undefined, "nor pulled out of the dock");
assert.strictEqual(lock.clean.objects[0].layer, "back", "a card covering the screen goes behind the home");
assert.strictEqual(lock.clean.elements.dock.scale, 0.5);
assert.strictEqual(lock.clean.elements.dock.opacity, 0.4);
assert.deepStrictEqual(plain(lock.flags.map((f) => f.kind).sort()), ["phone", "web"], "a phone number and a web address are flagged");
assert.ok(lock.notes.length >= 2, "and every change is noted for the designer");
// ordinary words and times are not flagged
assert.strictEqual(C({ objects: [{ id: "a", type: "text", text: "Dinner at 6.30, back by 9" }] }).flags.length, 0);
// a small front card is fine
assert.strictEqual(C({ objects: [{ id: "c", type: "shape", variant: "solid", x: 100, y: 100, w: 400, h: 300 }] }).clean.objects[0].layer, undefined);

// ---- the cost budget: 80 rotated full screen frosted cards with 40px blur
const slow = C({ v: 1, background: { image: "backgrounds/grose-valley.jpg", blur: 40 },
  objects: Array.from({ length: 80 }, (_, i) => ({ id: "g" + i, type: "shape", variant: "glass", x: 0, y: 0, w: 3840, h: 2160, rotate: i + 1 })) }).clean;
const L = sandbox.window.CouchDesign.limits;
assert.ok(slow.objects.length <= 40, "at most 40 objects");
assert.ok(slow.background.blur <= 16, "background blur is capped");
const frostedN = slow.objects.filter((o) => (o.variant || "glass") === "glass").length;
assert.ok(frostedN <= L.frosted, "at most " + L.frosted + " frosted cards, got " + frostedN);
assert.ok(frostedN <= 1, "and their total area is capped (a full screen card each)");
assert.ok(slow.objects.filter((o) => o.rotate).length <= L.rotated, "turned things are capped");
assert.ok(slow.objects.filter((o) => o.layer !== "back").length <= 1, "front cover is capped");
// a normal design is untouched by the budget
const fine = C({ objects: [{ id: "w", type: "weather", style: "card", x: 100, y: 100 }, { id: "s", type: "smart", kind: "aircon", x: 1000, y: 200 }] });
assert.strictEqual(fine.notes.length, 0);

// ---- v6: words with a phone number or web address never reach the screen
const scam = C({ objects: [{ id: "m", type: "text", text: "TV LOCKED. Call 1900 123 456 to unlock" }, { id: "ok", type: "text", text: "Movie night 8 pm" },
  { id: "s", type: "smart", kind: "light", name: "Lamp", status: "visit fix-my-tv.com", zones: ["Kitchen", "ring 0500 000 000"] }],
  texts: [{ text: "www.example.org" }, { text: "Welcome" }] });
// v8: no digit, @ or web address ever reaches the screen: digits are not in the allow list at all,
// and words that still spell an address are dropped
const shownWords = JSON.stringify(scam.clean.objects.map((o) => [o.text, o.name, o.zones, o.items]).concat(scam.clean.texts.map((t) => t.text)));
assert.ok(!/[0-9@]/.test(shownWords) && !/fix-my-tv|example\.org/.test(shownWords), "nothing callable or visitable is left: " + shownWords);
assert.strictEqual(scam.clean.objects.find((o) => o.id === "s").status, undefined, "a design carries no status");
assert.deepStrictEqual(plain(scam.clean.objects.find((o) => o.id === "s").zones), ["Kitchen"]);
assert.deepStrictEqual(plain(scam.clean.texts.map((t) => t.text)), ["Welcome"]);
assert.ok(scam.flags.length >= 2, "and the designer still sees the words flagged");

// ---- v6: everything in front counts towards the cover limit, not only shapes
const cams = C({ elements: { people: { hidden: true } }, objects: Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, type: "smart", kind: "camera", style: "card", panel: "solid", x: (i % 4) * 480, y: Math.floor(i / 4) * 360, scale: 3 })) }).clean;
const area = (o) => { const w = 540 * (o.scale || 1), h = 400 * (o.scale || 1); return w * h; };
assert.ok(cams.objects.every((o) => area(o) <= 0.25 * 1920 * 1080 + 1), "no card alone covers more than a quarter");
assert.ok(cams.objects.length <= 3, "cards covering most of the screen are left out, got " + cams.objects.length);
assert.ok(cams.objects.filter((o) => o.layer !== "back").length <= 1, "and at most 30% stays in front");
const words = C({ objects: Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, type: "text", text: "█".repeat(40), size: 300, colour: "#000000", x: -100, y: i * 140 })) }).clean;
assert.ok(!(words.objects || []).length, "block characters are not words: nothing of them is drawn");
const parts = C({ elements: { people: { scale: 8 }, quick: { scale: 8 }, keep_watching: { scale: 8 }, clock: { scale: 8 } } }).clean;
assert.strictEqual(parts.elements.people.scale, 3); assert.strictEqual(parts.elements.keep_watching.scale, 1.5); assert.strictEqual(parts.elements.clock.scale, 3);

// ---- v6: a plain colour background, only in plain colour formats
assert.strictEqual(plain(S({ background: { colour: "#000000" } })).background.colour, "#000000");
for (const bad of ["url(http://x.com/a.png)", "red;background:url(//x)", "expression(alert(1))", "var(--x)"])
  assert.strictEqual(plain(S({ background: { colour: bad } })).background, undefined, "refused colour: " + bad);
// a widget box from the grid is clamped
const wbox = plain(S({ objects: [{ id: "b", type: "weather", style: "card", w: 1e9, h: -5 }] })).objects[0];
assert.strictEqual(wbox.w, 1920); assert.strictEqual(wbox.h, 40);

// ---- v6: the speed budget counts rain and snow, the liquid clock, the glass level and glows
const heavy = C({ home: { ambient_weather: true, ambient_sun_grade: true, moving_tiles: true, clock_style: "liquid", glass_amount: 5, glass_icons: true },
  background: { image: "backgrounds/grose-valley.jpg", blur: 40 },
  objects: Array.from({ length: 40 }, (_, i) => ({ id: "k" + i, type: "text", text: "Hi", size: 60, shade: "glow", shadow: "strong", x: i * 40, y: 900 })) });
const costOf = (d) => sandbox.window.CouchDesign.cost(d).reduce((n, i) => n + i[1], 0);
assert.ok(costOf(heavy.clean) <= L.cost, "a design is brought within the TV's budget, got " + costOf(heavy.clean));
assert.strictEqual((heavy.clean.home || {}).ambient_weather, undefined, "rain and snow go first");
assert.ok(heavy.clean.objects.filter((o) => o.shade).length <= L.glow, "glows are capped");
const keys = sandbox.window.CouchDesign.cost({ home: { ambient_weather: true, clock_style: "liquid", glass_amount: 4 }, objects: [{ id: "a", type: "text", text: "x", shade: "glow" }] }).map((i) => i[2]);
for (const k of ["weatherfx", "liquid", "glassamount", "glow"]) assert.ok(keys.includes(k), "cost counts " + k);

// ---- clock.at "scene" (Couch TV Studio's Couch Original): each scene's own clock place, behind its hills
assert.strictEqual(plain(S({ elements: { clock: { at: "scene", behind: true } } })).elements.clock.at, "scene");
assert.strictEqual(plain(S({ elements: { clock: { at: "anywhere" } } })).elements, undefined, "only at: scene is kept");
const cssOf = (d) => sandbox.window.CouchDesign.css(S(d));
assert.strictEqual(typeof sandbox.window.CouchDesign.css, "function");
{
  const one = cssOf({ elements: { clock: { behind: true } } }), own = cssOf({ elements: { clock: { at: "scene", x: 300, y: 200, scale: 2 } } });
  assert.ok(/#scenes \.gclock\{left:0;right:0;top:11\.5rem/.test(one), "a design keeps the clock in one place");
  assert.ok(!/top:11\.5rem/.test(own) && !/#date\{left:0/.test(own), "at scene: no one place for the clock or the date");
  assert.ok(!/gclock\{[^}]*translate/.test(own) && !/gclock\{[^}]*font-size/.test(own), "at scene: the clock is not moved or sized");
  assert.ok(!/\.fg\{z-index:0\}/.test(own), "at scene: the hills stay in front of the clock");
  assert.ok(/#cd-weather\{display:none !important\}/.test(own) && !/#date \.wx\{display:none\}/.test(own), "at scene: the weather stays in the date line");
  assert.ok(/#date \.wx\{display:none\}/.test(cssOf({ elements: { clock: { at: "scene" }, weather: { hidden: true } } })), "at scene: a hidden weather part hides the date line's weather");
  const wxOpts = cssOf({ elements: { clock: { at: "scene" }, weather: { place: false, words: false } } });
  assert.ok(/#date \.wx \.wx-place\{display:none\}/.test(wxOpts), "at scene: weather place: false hides the town in the date line");
  assert.ok(/#date \.wx \.ww\{display:none\}/.test(wxOpts), "at scene: weather words: false hides the words in the date line");
  const solid = cssOf({ elements: { clock: { at: "scene", style: "solid" } } });
  assert.ok(/#scenes \.gclock\{clip-path:none !important/.test(solid), "at scene: solid digits are not cut at the waterline");
  assert.ok(!/\.scene \.shade\{background:radial/.test(cssOf({ elements: { clock: { at: "scene", shade: "panel" } } })), "at scene: no one place pool of shade");
  assert.ok(/top:11\.5rem/.test(cssOf({ background: { colour: "#112233" }, elements: { clock: { at: "scene" } } })), "a design's own background keeps the one place");
}

console.log("design gate tests passed");
