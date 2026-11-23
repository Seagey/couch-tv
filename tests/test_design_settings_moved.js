// Widget settings with nothing private in them, kept on the TV only until 0.13.10, now travel in the
// design so Couch TV Studio can set them (widget audit item 13): Temperature in, Moon seen from, the air
// quality Scale, the surf's Wave height in and Wind in, the Soundscape's Volume, the Doorbell's and Energy's
// Heading, and Guest Wi-Fi's Hide the password. Each is a design setting offered in Studio and on the TV,
// design.js keeps only its own values, and a choice made on the TV still wins over the design's.
// Also the Up next words (item 14): "What it shows", in plain words.
// Run: node tests/test_design_settings_moved.js
const assert = require("assert");
const K = require("./web-widgets-kit");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running moved widget settings tests...");
const T = K.home(new Date(2026, 10, 23, 10, 0).getTime());
const C = T.C, CD = K.design(), setting = T.W.kit.setting;

// [kind, key, a value the design keeps, a value it drops, the TV's own choice]
const MOVED = [
  ["weather", "degrees", "f", "kelvin", "c"], ["bigtemp", "degrees", "f", "x", "c"], ["hourly", "degrees", "c", 3, "f"],
  ["moon", "hemi", "south", "east", "north"], ["air", "scale", "us", "uk", "eu"],
  ["surf", "units", "ft", "yards", "m"], ["surf", "wind", "kn", "beaufort", "mph"],
  ["soundscape", "volume", 80, "loud", 30], ["doorbell", "label", "Front door", 42, "Gate"], ["energy", "label", "Solar", null, "Panels"],
  ["wifi", "hidepass", true, "yes", false]
];
for (const [kind, key, good, bad, tv] of MOVED) {
  const s = C.settings(kind).find((x) => x.key === key);
  ok(s && s.store === "design" && ["studio", "tv", "phone"].every((w) => s.where.includes(w)) && !s.private, kind + "." + key + ": a design setting in Studio, on the TV and the phone");
  ok(K.kept(CD, kind, { [key]: good })[key] === good, kind + "." + key + ": the design keeps " + JSON.stringify(good));
  ok(K.kept(CD, kind, { [key]: bad })[key] === undefined, kind + "." + key + ": and drops " + JSON.stringify(bad));
  const o = { id: "w", kind, opts: { [key]: good } };
  ok(setting(o, {}, key) === good, kind + "." + key + ": the TV reads the design's value");
  ok(setting(o, { wset: { w: { [key]: tv } } }, key) === tv, kind + "." + key + ": a choice made on this TV still wins");
}
ok(K.kept(CD, "soundscape", { volume: 500 }).volume === 100 && K.kept(CD, "soundscape", { volume: 2 }).volume === 10, "volume stays between 10 and 100");
// the private ones stay on the TV, never in a design
for (const [kind, key] of [["weather", "town"], ["air", "town"], ["surf", "place"], ["wifi", "ssid"], ["doorbell", "entity"]]) {
  const s = C.settings(kind).find((x) => x.key === key);
  if (s) ok(s.store === "tv" && s.where.indexOf("studio") < 0, kind + "." + key + ": still kept on the TV only");
  ok(K.kept(CD, kind, { [key]: "Riverside" })[key] === undefined, kind + "." + key + ": never kept in a design");
}

// Up next: what it shows, in plain words, with the same design values as before (false, true, auto)
const up = C.settings("upnext").find((x) => x.key === "sport");
ok(up.label === "What it shows", "Up next: the setting is What it shows (" + up.label + ")");
ok(JSON.stringify(up.options) === JSON.stringify([[false, "Your next show"], [true, "Your last game"], ["auto", "Last game when Scores is on"]]), "its choices: Your next show, Your last game, Last game when Scores is on");
ok(/sport app/.test(up.help) && /Scores/.test(up.help) && up.help.length <= 200 && !/[–—]/.test(up.help), "its help says what each one does, in one line: " + up.help);
ok(up.default === "auto" && K.kept(CD, "upnext", { sport: true }).sport === true && K.kept(CD, "upnext", { sport: false }).sport === false, "the values a design carries are unchanged");

console.log("OK: " + n + " moved setting checks");
