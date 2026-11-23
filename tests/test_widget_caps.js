// The widget capability records (tv-home/web/widget-caps.js): every widget kind the TV accepts has
// one, every field is filled, the platform table names every kind of TV Couch TV Studio knows, the sizes
// are real named sizes with the smallest that reads first, and every kind whose OK opens a detail
// layer (widget-detail.js) is a remote stop (design.js WACT).
// Run: node tests/test_widget_caps.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const CAPS = require(path.join(web, "widget-caps.js"));
const noop = () => {};
const sandbox = { location: { search: "", origin: "http://tv" }, innerWidth: 1920, innerHeight: 1080, setTimeout: noop, setInterval: noop, clearTimeout: noop,
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop, readyState: "complete" } };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "widget-detail.js"), "utf8"), sandbox);
const CD = sandbox.window.CouchDesign, DET = sandbox.window.CouchDetail;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const filled = (v) => typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null;

console.log("Running widget capability tests...");

// the keys of tools/tv-designer/tvs/platform-setup.js (the designer reads both files)
const PLATFORMS = ["Google TV", "Android TV", "Fire OS", "Vega OS", "Tizen", "webOS", "Roku OS", "VIDAA", "Titan OS", "Saphi", "tvOS", "TiVo OS", "SmartCast", "My Home Screen", "Other", "unknown"];
const NAMED = { line: [4, 1], wline: [8, 1], tile: [2, 2], wtile: [4, 2], small: [4, 4], tall: [4, 6], medium: [8, 4], wide: [12, 4], large: [8, 8], xl: [12, 6], hero: [18, 7], full: [18, 10] };
ok(JSON.stringify(CAPS.platforms) === JSON.stringify(PLATFORMS), "the platform list is platform-setup.js's, in its order");

// 1. one record for every kind the TV accepts, and none it does not
const kinds = CD.wkinds();
kinds.forEach((k) => ok(!!CAPS.get(k), "a record for " + k));
CAPS.kinds().forEach((k) => ok(kinds.indexOf(k) >= 0, k + " is a kind the TV accepts"));

// 2. every field filled
const WHERE = ["nothing", "tv", "phone", "computer", "designer"];
CAPS.kinds().forEach((k) => {
  const c = CAPS.get(k);
  ["name", "what", "until", "ok"].forEach((f) => ok(filled(c[f]), k + ": " + f + " is filled"));
  ok(["works", "setup", "not-built"].indexOf(c.status) >= 0, k + ": status is works, setup or not-built");
  ok(Array.isArray(c.needs) && c.needs.length > 0 && c.needs.every(filled), k + ": needs lists at least one thing");
  ok(c.setup && WHERE.indexOf(c.setup.where) >= 0 && filled(c.setup.how), k + ": setup says where and how");
  ok(c.status === "not-built" ? filled(c.build) : c.build === "", k + ": build is filled exactly when it is not built");
  PLATFORMS.forEach((p) => ok(c.platforms[p] && ["yes", "setup", "partial", "no"].indexOf(c.platforms[p].on) >= 0 && typeof c.platforms[p].note === "string", k + ": " + p + " is in the table"));
  ok(Object.keys(c.platforms).length === PLATFORMS.length, k + ": no extra platforms");
  if (c.status === "not-built") ok(PLATFORMS.every((p) => c.platforms[p].on === "no"), k + ": not built is no on every TV");
  if (c.status !== "not-built") ok(PLATFORMS.some((p) => c.platforms[p].on !== "no"), k + ": works or sets up on at least one TV");
  // never "demo" or "coming soon" wording: say what it needs instead
  ok(!/\bdemo\b|coming soon|for now/i.test(JSON.stringify(c)), k + ": no demo or coming soon wording");
  const card = CAPS.card(k), tiny = CAPS.card(k, true);
  ok(filled(card.line) && typeof card.sub === "string" && filled(tiny.line) && tiny.line.length <= 22, k + ": a setup card, and a short one for a tile (" + tiny.line + ")");
});

// 2b. plain words and numbered steps for each kind of TV (seagey, 18 Nov 2026: "Set it up on the tv
// should be more informative"): every record has steps for the Android home, the web TVs, Hisense and
// the rest; each step is one short thing to do; the words a person reads have no jargon; and every
// menu a step names is a real one on the TV (i18n.js and app.js)
const i18n = fs.readFileSync(path.join(web, "i18n.js"), "utf8"), appSrc = fs.readFileSync(path.join(web, "app.js"), "utf8");
const MENUS = ["Home settings", "Location", "Search for a town or city", "Look and scenes", "Your photos", "Add photos from a USB drive or this TV",
  "Add a photo from a web address", "People", "Add a person", "Apps", "Quick buttons", "Now playing card", "Clock", "More apps", "App Store", "Get a design",
  // Couch TV Studio, At home (things typed at home)
  "At home", "Write a note", "From", "Add a list", "Add an item", "Network name", "Password", "Add to the guide", "Add a calendar link", "Allow screen time", "Daily goal"];
MENUS.forEach((m) => ok(i18n.indexOf('"' + m + '"') >= 0 || appSrc.indexOf('"' + m + '"') >= 0, "the TV has a menu called " + m));
const SECTIONS = ["Language", "Location", "Weather", "Look and scenes", "Apps", "People", "Quick buttons", "Designs", "About"];
const JARGON = /Open-Meteo|bridge|endpoint|config\.json|apply\.sh|entit(y|ies)|EXIF|RSS|iCal|\.kt\b|\bAPI\b|WebView|launcher|\boption [ABC]\b|couch-tv(?! Studio)/;
const NEEDS = ["works", "setup", "computer", "no"];
CAPS.kinds().forEach((k) => {
  const c = CAPS.get(k), st = c.setup.steps;
  ["android", "web", "vidaa", "none"].forEach((g) => ok(Array.isArray(st[g]) && st[g].length >= 1 && st[g].length <= 5 && st[g].every((s) => filled(s) && s.length <= 170 && /[.!?)]$/.test(s)), k + ": " + g + " has one to five short steps"));
  const seen = [c.what, c.until, c.ok, c.setup.how].concat(c.needs, st.android, st.web, st.vidaa, PLATFORMS.map((p) => c.platforms[p].note)).join(" | ");
  ok(!JARGON.test(seen), k + ": no jargon in the words a person reads (" + (seen.match(JARGON) || [""])[0] + ")");
  PLATFORMS.forEach((p) => ok(NEEDS.indexOf(c.platforms[p].need) >= 0 && CAPS.need(k, p) === c.platforms[p].need, k + ": " + p + " says works, setup, computer or no"));
  [st.android, st.web, st.vidaa].forEach((list) => list.forEach((s) => {
    const m = /Go down to ([A-Z][a-z]+(?: [a-z]+)*(?: [a-z]+)?)/.exec(s);
    if (m) ok(SECTIONS.some((x) => m[1].indexOf(x) === 0), k + ": \"" + m[1] + "\" is a Home settings section");
  }));
  if (c.status === "not-built") ok(PLATFORMS.every((p) => c.platforms[p].need === "no"), k + ": not built is not possible anywhere");
});
ok(CAPS.steps("surf", "Google TV").join(" ").indexOf("beach town") > 0, "surf: the steps say to pick the nearest beach town");
ok(CAPS.steps("photo", "Tizen").join(" ").indexOf("web address") > 0 && CAPS.steps("photo", "Google TV").join(" ").indexOf("USB") > 0, "photos: by web address on a Samsung, from USB on a Google TV");
ok(CAPS.need("aircon", "Tizen") === "computer" && CAPS.need("aircon", "Google TV") === "setup" && CAPS.steps("aircon", "Google TV").join(" ").indexOf("Smart home") > 0, "aircon: set up on a Google TV (Home settings, Smart home), through the home computer on a Samsung");
// Roku and Apple TV draw designs themselves (DesignLib.brs, DesignView.swift), but only some kinds
ok(CAPS.need("clock", "Roku OS") === "works" && CAPS.need("clock", "tvOS") === "works", "a Roku and an Apple TV draw the clock");
ok(CAPS.need("surf", "Roku OS") === "no" && /^Shows on Google TV/.test(CAPS.steps("surf", "Roku OS")[0]), "a Roku: no surf, and says so");
ok(CAPS.need("worldclock", "tvOS") === "works" && CAPS.need("worldclock", "Roku OS") === "no", "world clocks on an Apple TV, not on a Roku");
// launch audit 0.13.9 (coord/AUDIT-0139-WIDGETS.md): only what works is offered as working
ok(CAPS.need("note", "Roku OS") === "no" && CAPS.native("Roku OS").indexOf("note") < 0, "Family note: not on a Roku (it drew the word Note)");
ok(CAPS.need("quote", "Roku OS") === "setup" && CAPS.need("quote", "tvOS") === "setup" && /own words/.test(CAPS.get("quote").platforms["Roku OS"].note), "Quote on a Roku or Apple TV: your own words, said so");
["weather", "bigtemp", "keep", "keeprow", "people"].forEach((k) => ok(CAPS.need(k, "Roku OS") === "computer" && CAPS.need(k, "tvOS") === "works", k + ": needs the home computer on a Roku, works on an Apple TV"));
ok(/once a minute/.test(CAPS.get("stack").platforms["Roku OS"].note), "a stack on a Roku says how it moves on");
["clock", "weather", "note", "list", "quote", "welcome", "stack", "people", "card", "app", "dock", "appgrid"].forEach((k) => ["Tizen", "webOS"].forEach((p) => ok(CAPS.need(k, p) !== "computer" && !/home computer is on|has to be on/.test(CAPS.get(k).platforms[p].note), k + " on " + p + ": works in the app without a home computer")));
["news", "stocks", "aircon", "agenda", "keep", "queue", "agent"].forEach((k) => ["Tizen", "webOS"].forEach((p) => ok(CAPS.need(k, p) === "computer", k + " on " + p + ": still needs the home computer")));
["Saphi", "TiVo OS", "My Home Screen"].forEach((p) => ok(CAPS.need("clock", p) === "computer", "the clock on " + p + ": the computer opens the home there"));
ok(CAPS.need("agent", "Google TV") === "setup" && CAPS.need("agent", "Fire OS") === "setup" && CAPS.get("agent").setup.where === "tv", "From your AI on an Android TV: set up, no computer needed");
// Keep watching and the rest on an Android TV: Couch TV's home reads Android's own Continue watching list,
// the on-TV app or a computer adds each person's: set up on the TV, never "Needs a computer at home" there
["keep", "keeprow", "upnext", "picks", "nowplaying"].forEach((k) => ok(CAPS.get(k).setup.where === "tv" && CAPS.need(k, "Google TV") === "setup" && CAPS.need(k, "Fire OS") === "setup" && !/^Needs /.test(CAPS.steps(k, "Google TV")[0]), k + ": set up on an Android TV, no computer badge"));
ok(/Continue watching/.test(CAPS.steps("keep", "Android TV")[0]) && CAPS.need("keep", "Tizen") === "computer", "Keep watching: Android's own list on the home, the computer on a Samsung");
ok(CAPS.need("battery", "Tizen") === "no" && CAPS.need("nowplaying", "webOS") === "no" && CAPS.need("screentime", "Tizen") === "no", "Batteries, Now playing and Screen time stay off a Samsung and LG");
["Roku OS", "tvOS"].forEach((p) => ["clock", "weather", "welcome"].forEach((k) => { const s = CAPS.steps(k, p); ok(/Couch TV Studio and send the design again/.test(s[s.length - 1]), k + " on " + p + ": says where to change it"); }));
ok(CAPS.need("clock", "Vega OS") === "no" && /not possible/i.test(CAPS.steps("clock", "Vega OS")[0]), "a Fire TV on Vega OS: not possible, and says so");

// 3. sizes: the shape of tools/tv-designer/app/grid.js W[kind]; named sizes smallest first, none under min
CAPS.kinds().forEach((k) => {
  const s = CAPS.get(k).sizes;
  ok(s && Array.isArray(s.s) && Array.isArray(s.min) && s.min.length === 2 && s.min.every((v) => v >= 1), k + ": sizes has s and min");
  s.s.forEach((id) => ok(!!NAMED[id], k + ": " + id + " is a named size"));
  s.s.forEach((id) => ok(NAMED[id][0] >= s.min[0] && NAMED[id][1] >= s.min[1], k + ": " + id + " is not under min"));
  const areas = s.s.map((id) => NAMED[id][0] * NAMED[id][1]);
  ok(!areas.length || areas[0] === Math.min.apply(null, areas), k + ": the smallest size comes first (grid.js sorts the rest by area)");
  (s.x || []).forEach((x) => ok(x.length === 4 && x[2] >= s.min[0] && x[3] >= s.min[1], k + ": extra size " + x[0] + " is a box at or above min"));
  if (k !== "stack" && k !== "dock") ok(s.s.length > 0, k + ": has named sizes");
});
// seagey, 18 Nov 2026: "the aircon widget as a square might be too big": it comes as a tile and a wide tile
ok(CAPS.get("aircon").sizes.s[0] === "tile" && CAPS.get("aircon").sizes.s.indexOf("wtile") >= 0 && CAPS.get("aircon").sizes.s.indexOf("medium") >= 0, "aircon: tile, wide tile and medium");

// 4. OK: every layer named exists, every kind with a layer is a stop on the remote
const layers = DET.layers(), map = DET.map(), wact = CD.wact();
Object.keys(map).forEach((k) => {
  ok(kinds.indexOf(k) >= 0, "layer for a real kind: " + k);
  ok(layers.indexOf(map[k]) >= 0, k + " opens a layer that exists (" + map[k] + ")");
  ok(wact.indexOf(k) >= 0, k + " is a stop on the remote");
});
["nowplaying", "aircon", "scenes", "controls", "camera", "agenda", "weather", "hourly", "week", "photo", "slideshow", "keep", "folder", "sports", "news", "timer", "clock"].forEach((k) => ok(!!map[k], k + " has a detail layer"));

// 5. widgets.js says what a widget needs from this file, never in its own words
const wsrc = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
ok(!/Coming to couch-tv|is coming|are coming|"Demo"/.test(wsrc), "widgets.js has no coming soon or Demo tags");
ok(/C\.card\(kind, b\.w < 300/.test(wsrc), "the setup card comes from widget-caps.js");
const dsrc = fs.readFileSync(path.join(web, "widget-detail.js"), "utf8");
ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(dsrc), "widget-detail.js never parses markup or code");
const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
ok(html.indexOf('src="widget-caps.js"') > 0 && html.indexOf('src="widget-detail.js"') > html.indexOf('src="widgets.js"'), "index.html loads the caps and the layers after widgets.js");

console.log("OK: " + n + " checks");
