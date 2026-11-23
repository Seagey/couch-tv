// Google Fonts in a design (tv-home/web/design.js, google-fonts.js, designer-gate.js): a text or a
// widget may name any Google Fonts family by name; a name not on the bundled list is dropped (the
// home's own font draws it); at most three families in a design; their files come only from the design
// store, never from Google, and the page policy lets fonts load from that one origin.
// Run: node tests/test_design_fonts.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const GF = require(path.join(web, "google-fonts.js"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running design font tests...");

// the bundled list
ok(GF.count > 1500 && GF.find("playfair-display").family === "Playfair Display" && GF.find("Akshar").subsets.indexOf("devanagari") >= 0 && GF.find("Roboto") && GF.find("playfair  DISPLAY").family === "Playfair Display", "the list has Google's families, matched by name in any case");
ok(GF.find("Comic Sans MS") === null && GF.find("Roboto;}body{x") === null && GF.find("") === null && GF.find("__proto__") === null, "anything else is not a family");
ok(GF.weight("Abel", 700) === 400 && GF.weight("Playfair Display", 650) >= 600, "the nearest weight a family has");
ok(!/googleapis|gstatic/.test(fs.readFileSync(path.join(web, "google-fonts.js"), "utf8")), "the list holds names only, no Google links");

const noop = () => {};
const sb = { location: { search: "", origin: "http://tv" }, document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop }, innerWidth: 1920, innerHeight: 1080 };
sb.window = sb; sb.addEventListener = noop;
vm.createContext(sb);
for (const f of ["google-fonts.js", "design.js", "designer-gate.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
const CD = sb.window.CouchDesign, G = sb.window.CouchDesigner;
const plain = (v) => JSON.parse(JSON.stringify(v));
const san = (d) => plain(CD.sanitize(d));

// sanitising
let d = san({ objects: [{ id: "t1", type: "text", text: "Hello", font: "playfair display" }, { id: "t2", type: "text", text: "Hi", font: "Comic Sans MS" },
  { id: "w1", type: "widget", kind: "clock", style: { font: "Lobster" } }, { id: "w2", type: "widget", kind: "clock", style: { font: "inter" } }] });
ok(d.objects[0].font === "Playfair Display", "a text keeps a Google Fonts family, as Google names it");
ok(d.objects[1].font === undefined, "a font not on the list is dropped: the home's own font draws it");
ok(d.objects[2].style.font === "Lobster" && d.objects[3].style.font === "inter", "a widget takes a Google family, and its own fonts as before");
ok(san({ elements: { clock: { font: "Bebas Neue" } } }).elements.clock.font === "Bebas Neue", "the home's clock takes one too");
// old designs: unchanged
const old = { objects: [{ id: "t", type: "text", text: "Old", font: "antonio" }], elements: { clock: { font: "serif" } } };
ok(JSON.stringify(san(old).objects[0].font) === '"antonio"' && san(old).elements.clock.font === "serif", "an old design's fonts are kept as they were");
// the cap of three
d = san({ objects: ["Roboto", "Lobster", "Pacifico", "Oswald", "Roboto"].map((f, i) => ({ id: "t" + i, type: "text", text: "Words", font: f })) });
ok(JSON.stringify(d.objects.map((o) => o.font || null)) === JSON.stringify(["Roboto", "Lobster", "Pacifico", null, "Roboto"]), "at most three families: the fourth falls back, a family already in use stays");
ok(/three fonts/.test(JSON.stringify(CD.check({ objects: ["Roboto", "Lobster", "Pacifico", "Oswald"].map((f, i) => ({ id: "t" + i, type: "text", text: "Words", font: f })) }))), "the designer is told why");
// fallback drawing
ok(CD.fontOf("Lobster") === '"Lobster", "Inter", sans-serif' && CD.fontOf("Dancing Script").indexOf('"Inter"') > 0 && CD.fontOf("Comic Sans MS") === "" && CD.fontOf("antonio").indexOf("Antonio") >= 0, "each font draws with the home's font behind it; unknown draws nothing new");
// what would load: the family and the weights in use (400 and 700 always)
const want = CD.fontsOf({ objects: [{ id: "t", type: "text", text: "A", font: "Roboto", weight: 300 }, { id: "w", type: "widget", kind: "clock", style: { font: "Lobster" } }] });
ok(JSON.stringify(Object.keys(want).sort()) === '["Lobster","Roboto"]' && want.Roboto.indexOf(300) >= 0 && want.Roboto.indexOf(700) >= 0, "the files a design asks for: its families and weights");
const src = fs.readFileSync(path.join(web, "design.js"), "utf8");
ok(src.indexOf('base + "/v1/fonts/" + fam.name + "/" + w + (sub === "latin" ? "" : "." + sub) + ".woff2"') >= 0, "files come from the design store: /v1/fonts/<name>/<weight>[.latin-ext|.devanagari].woff2");
ok(/unicodeRange: FONT_RANGE\[sub\]/.test(src) && /devanagari: "U\+0900-097F/.test(src), "each subset with its own characters (Devanagari for Hindi words)");
ok(/display: "swap"/.test(src) && /font-display:swap/.test(src) && /FONT_WAIT = \d+/.test(src), "font-display swap, and a time limit");
ok(!/fonts\.googleapis|fonts\.gstatic/.test(src), "design.js never names Google");

// the page policy: fonts from this page, data: and the store only
ok(/font-src 'self' data: https:\/\/designs\.example;/.test(G.policy("https://designs.example")), "font-src names the store's origin");
ok(/font-src 'self' data:;/.test(G.policy("")) && /font-src 'self' data:;/.test(G.policy("javascript:alert(1)")) && /font-src 'self' data:;/.test(G.policy("https://x.example/path")), "no store, or not a plain origin: nothing added");
ok(!/googleapis|gstatic|font-src[^;]*https:[;\s]/.test(G.policy("https://designs.example")), "never Google, never any https site");

console.log("All " + n + " design font tests passed.");
