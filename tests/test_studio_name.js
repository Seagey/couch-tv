// The product is called Couch TV Studio (renamed from TV Designer, 18 Nov 2026): no word a person sees on
// the TV still says TV Designer, while the ids, storage keys and links stay as they were (designs kept
// on a TV and codes already handed out keep working).
// Run: node tests/test_studio_name.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running Couch TV Studio name tests...");

// every string in the home's code (comments may still tell the history); icon-sets.js is a copy of
// tools/tv-designer/icons and its strings are icon names
const LIT = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const files = fs.readdirSync(web).filter((f) => f.endsWith(".js") && f !== "icon-sets.js");
for (const f of files) {
  const src = fs.readFileSync(path.join(web, f), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
  const left = (code.match(LIT) || []).filter((s) => /TV Designer/.test(s));
  ok(left.length === 0, f + ": no words say TV Designer (" + left.join(", ").slice(0, 120) + ")");
  // 0.13.10 (the TCL test): the TV says Couch TV Studio, as the welcome does, never couch-tv Studio
  const lower = (code.match(LIT) || []).filter((s) => /couch-tv Studio/.test(s));
  ok(lower.length === 0, f + ": no words say couch-tv Studio (" + lower.join(", ").slice(0, 120) + ")");
}
const setup = fs.readFileSync(path.join(__dirname, "../on-tv/web/setup.html"), "utf8");
ok(!/couch-tv Studio/.test(setup) && /Couch TV Studio/.test(setup), "the phone page the TV serves says Couch TV Studio too");
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
ok(/id === "designer" \? "Designs"/.test(app), "Home settings names the section Designs (0.13.9; the website keeps the name Couch TV Studio)");
ok(/label: "Turn on designs"/.test(app) && !/label: "Turn on Couch TV Studio"/.test(app), "Turn on designs");
ok(/key: "dz-switch", label: "Your design", value: "On"/.test(app) && !/classic home/.test(app) && !/label: "Back to the standard home"/.test(app), "one Your design switch, never the classic home");
ok(/label: "Delete this design"/.test(app) && !/label: "Remove the design I got"/.test(app), "Delete this design");
ok(/sub: "Type the code from Couch TV Studio on your phone"/.test(app), "Get a design still names the Couch TV Studio website");
ok(/Open this home in Couch TV Studio/.test(fs.readFileSync(path.join(web, "share-home.js"), "utf8")), "Share this home says Couch TV Studio");
// the ids, keys and links do not change
ok(/\["designer", "designer"\]/.test(app), "the section id is still designer");
ok(/"couchtv\.design\.fetched"/.test(fs.readFileSync(path.join(web, "design-code.js"), "utf8")), "the kept design's storage key is unchanged");
ok(/tvdesigner/.test(fs.readFileSync(path.join(web, "designer-gate.js"), "utf8")), "designer-gate.js keeps its tvdesigner keys and links");

console.log("All " + n + " Couch TV Studio name tests passed.");
