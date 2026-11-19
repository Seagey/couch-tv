// Share this home (tv-home/web/share-home.js): the home on the TV becomes a couch-tv Studio design that
// carries the look and the dock's apps and nothing private, it passes design.js's own gate, anything
// private stops it before it is sent, and only {design} goes to the store.
// Run: node tests/test_share_home.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
const sb = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080, setTimeout, clearTimeout
};
sb.window = sb;
sb.addEventListener = noop;
vm.createContext(sb);
for (const f of ["app-catalogue.js", "design.js", "qr.js", "share-home.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
const CD = sb.window.CouchDesign, S = sb.window.CouchShare, QR = sb.window.TVQR;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const plain = (v) => JSON.parse(JSON.stringify(v));
console.log("Running Share this home tests...");

const BUILT = ["night", "dawn", "fog", "beach", "forest"];
const snap = {
  scenes: ["night", "my-own-photo", "fog"], builtIn: BUILT, scene_seconds: 30, clock24: true, clock_style: "liquid",
  glass: "lite", glass_icons: true, glass_amount: 4, ambient_weather: false, ambient_sun_grade: false, lighter: false,
  keep_watching: false, now_playing: true, dock_size: 8,
  dock: ["com.netflix.ninja", "com.google.android.youtube.tv", "local.sky", "screen:den", "com.netflix.ninja", "not a package", "com.example.familybank", "com.spotify.tv.android"],
  design: null
};

// 1. a home made on the TV: the look and the apps, nothing else
let d = plain(S.build(snap));
ok(d.v === 1, "a design");
ok(JSON.stringify(d.home.scenes) === JSON.stringify(["night", "fog"]), "only the app's own scenes: an own photo scene stays on the TV");
ok(d.home.scene_seconds === 30 && d.home.clock === "24h" && d.home.glass === "lite" && d.home.keep_watching === false && d.home.now_playing === true, "the look settings come along");
ok(JSON.stringify(d.apps.order) === JSON.stringify(["netflix", "youtube", "spotify"]), "the dock's apps as catalogue ids, once each, no local or screen tile, and no app outside the catalogue (an unusual installed app never leaves the TV)s, no junk");
ok(d.elements.clock.format === "24h" && d.elements.keep_watching.hidden === true, "the clock format, and Keep watching hidden as it is on the TV");
ok(Object.keys(d).sort().join() === "apps,elements,home,v", "nothing but apps, elements, home and v");

// 2. through the TV's own gate: what a TV would draw
let r = S.prepare(snap, ["Robin Example", "Riverside"], CD);
ok(r.design && !r.error, "prepare gives a design");
ok(JSON.stringify(CD.sanitize(r.design)) === JSON.stringify(r.design), "it is already what design.js's gate makes of it");
ok(r.design.apps && r.design.apps.order.length === 3, "the apps survive the gate");

// 3. a design that is on: shared as it is, but never a household photo or a smart home entity
const on = { v: 1, background: { image: "data:image/jpeg;base64,/9j/4AAQ", darken: 0.2 },
  objects: [{ id: "t1", type: "text", text: "Movie night", x: 100, y: 100 }, { id: "s1", type: "smart", kind: "aircon", entity: "climate.room_one", name: "Lounge" }] };
d = plain(S.build(Object.assign({}, snap, { design: on })));
ok(d.background && d.background.image === undefined && d.background.darken === 0.2, "a photo inside a design stays on the TV");
ok(d.objects[1].entity === undefined, "a smart home entity stays on the TV");
d = plain(S.build(Object.assign({}, snap, { design: { v: 1, background: { image: "backgrounds/mine/our-place.jpg" } } })));
ok(d.background === undefined, "a photo from backgrounds/mine stays on the TV");
d = plain(S.build(Object.assign({}, snap, { design: { v: 1, background: { image: "backgrounds/beach.jpg" } } })));
ok(d.background.image === "backgrounds/beach.jpg", "one of the app's own backgrounds may go");
r = S.prepare(Object.assign({}, snap, { design: on }), ["Robin Example"], CD);
ok(r.design && !(r.design.background && r.design.background.image), "after the gate too, no photo");
ok(!JSON.stringify(r.design).includes("climate."), "after the gate too, no entity");

// 4. anything private the TV knows stops the share
const named = { v: 1, objects: [{ id: "t1", type: "text", text: "Robin Example lives here", x: 100, y: 100 }] };
r = S.prepare(Object.assign({}, snap, { design: named }), ["Robin Example"], CD);
ok(r.error && !r.design, "a person's name in the words: not shared");
r = S.prepare(Object.assign({}, snap, { design: { v: 1, objects: [{ id: "t1", type: "text", text: "Welcome to Riverside", x: 1, y: 1 }] } }), ["Riverside"], CD);
ok(r.error, "the place: not shared");
ok(S.privateHits({ a: "192.0.2.10" }, []).includes("address"), "an address is found");
ok(S.privateHits({ a: "see https://example.com" }, []).includes("link"), "a link is found");
ok(S.privateHits({ a: "robin@example.com" }, []).includes("email"), "an e-mail is found");
ok(S.privateHits({ a: ["aa", "bb", "cc", "dd", "ee", "ff"].join(":") }, []).includes("hardware address"), "a hardware address is found");
ok(S.privateHits(plain(S.build(snap)), ["Robin Example", "Riverside", "tv-den.example"]).length === 0, "a plain home has none");
ok(S.privateHits({ a: "Al" }, ["Al"]).length === 0, "names under three letters are not matched (they would match everything)");
r = S.prepare({ builtIn: [], dock: [] }, [], CD);
ok(r.design || r.error, "an empty home still answers");

// 4b. Open this home in couch-tv Studio (0.13.3): the dock's style and Moving tiles come along, and the
// keys, tokens and calendar links a TV holds never do
d = plain(S.build(Object.assign({}, snap, { dock_style: "mac", moving_tiles: false })));
ok(d.home.dock === "mac" && d.home.moving_tiles === false, "the Mac-style dock and Moving tiles come along");
r = S.prepare(Object.assign({}, snap, { dock_style: "mac", moving_tiles: false }), [], CD);
ok(r.design.home.dock === "mac" && r.design.home.moving_tiles === false, "and pass design.js's gate");
d = plain(S.build(Object.assign({}, snap, { dock_style: "rainbow" })));
ok(d.home.dock === undefined, "a dock style that is not one of the two stays behind");
// a made-up token, built here at run time from its three parts so secret scanners do not read the
// test file as holding a real one
const b64url = (s) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const HA = [b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), b64url(JSON.stringify({ iss: "abc" })), b64url("signature")].join(".");
const AIKEY = "sk-" + "ant-api03-" + "Zx9".repeat(16);
const CAL = "web" + "cal:/" + "/calendar.example/private/basic" + ".ics";   // split so the privacy scan does not take it for a real link
for (const [what, word] of [["a Home Assistant token", HA], ["an AI key", AIKEY], ["a calendar link", CAL], ["a calendar file name", "family.ics"]]) {
  r = S.prepare(Object.assign({}, snap, { design: { v: 1, objects: [{ id: "t1", type: "text", text: "x " + word, x: 1, y: 1 }] } }), [], CD);
  ok(!r.design || !JSON.stringify(r.design).includes(word), what + " in a design's words never leaves the TV");
  ok(S.privateHits({ a: word }, []).length > 0, what + " is found by the last check");
}
// a widget holding its own settings (an At home calendar, a smart home light): nothing of the house goes
r = S.prepare(Object.assign({}, snap, { design: { v: 1, objects: [{ id: "w1", type: "widget", kind: "calendar", x: 100, y: 100, opts: { ics: CAL, token: HA, key: AIKEY } }, { id: "s1", type: "smart", kind: "light", entity: "light.kitchen", entities: ["light.a"] }] } }), [], CD);
const out = JSON.stringify(r.design || {});
ok(!out.includes("cal.example") && !out.includes("eyJ") && !out.includes("sk-ant") && !out.includes("light.kitchen"), "a widget's link, token, key and entity stay on the TV");
// the snapshot's own fields that are not a look never travel, whatever the TV hands share-home.js
d = plain(S.build(Object.assign({}, snap, { people: ["Robin Example"], ha_token: HA, ai_key: AIKEY, calendar: CAL, place: "Riverside" })));
ok(!/Robin|eyJ|sk-ant|cal\.example|Riverside/.test(JSON.stringify(d)), "people, tokens, keys, calendars and the place in the snapshot are not copied");

// 5. what is sent, and what comes back
async function sends() {
  let seen = null;
  const good = { code: "ABCDE-FGHJK", token: "CTV1-" + "a".repeat(43) };
  const fake = (status, body) => (url, opt) => { seen = { url, opt }; return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) }); };
  const design = S.prepare(snap, [], CD).design;
  const res = await S.send("https://designs.example", design, fake(201, good));
  ok(seen.url === "https://designs.example/v1/shares" && seen.opt.method === "POST", "POST /v1/shares");
  ok(seen.opt.credentials === "omit" && seen.opt.referrerPolicy === "no-referrer" && seen.opt.redirect === "error", "no cookies, no referrer, no redirects");
  ok(JSON.stringify(Object.keys(JSON.parse(seen.opt.body))) === '["design"]', "only the design goes");
  ok(res.code === "ABCDE-FGHJK" && res.link === "https://designs.example/design/?from=" + good.token && res.page === "designs.example/design", "the code, and the link the QR holds");
  for (const [status, kind] of [[404, "off"], [405, "off"], [429, "slow"], [503, "slow"], [400, "refused"], [500, "refused"]]) {
    try { await S.send("https://designs.example", design, fake(status, {})); ok(false, "no throw"); } catch (e) { ok(e.kind === kind, status + " is " + kind); }
  }
  for (const bad of [{ code: "x", token: good.token }, { code: good.code, token: "CTV1-short" }, { code: good.code, token: "javascript:alert(1)" }, {}]) {
    try { await S.send("https://designs.example", design, fake(201, bad)); ok(false, "no throw"); } catch (e) { ok(e.kind === "refused", "an answer that is not a code is refused"); }
  }
  try { await S.send("", design, fake(201, good)); ok(false, "no throw"); } catch (e) { ok(e.kind === "offline", "no store: nothing sent"); }
  try { await S.send("https://designs.example", design, () => Promise.reject(new Error("down"))); ok(false, "no throw"); } catch (e) { ok(e.kind === "offline", "the store not answering"); }
  // the QR holds the whole link (byte mode, up to version 10)
  const m = QR.matrix(res.link);
  ok(m.length >= 21 && m.length <= 57, "the link fits a QR code the TV can draw (" + m.length + " modules)");
}
sends().then(() => console.log(`${n} Share this home tests passed.`), (e) => { console.error(e); process.exit(1); });
