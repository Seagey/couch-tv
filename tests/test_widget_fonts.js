// A widget's own fonts (tv-home/web/widgets.js FONT: inter, antonio, rounded, cormorant, jost) must
// each have a file on the TV, or the words quietly draw in Inter. "jost" had none: the App Folders
// design set Jost and every folder name and person's name came out in Inter (23 Nov 2026).
// The widget sets its font on its box, so a folder's name (.cw-lab) follows it with nothing of its own.
// Run: node tests/test_widget_fonts.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running widget font tests...");

const widgets = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
const css = fs.readFileSync(path.join(web, "app.css"), "utf8") + fs.readFileSync(path.join(web, "widgets.css"), "utf8");
const m = /var FONT = (\{[^}]*\});/.exec(widgets);
ok(m, "widgets.js has its FONT map");
const FONT = Function("return " + m[1])();
// the family each name draws with first
const first = (v) => /^\s*["']?([^"',]+)/.exec(v)[1];
// @font-face rules on the home: family -> file
const faces = {};
for (const f of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const fam = (/font-family:\s*["']?([^"';]+)/.exec(f[1]) || [])[1], src = (/url\(([^)]+)\)/.exec(f[1]) || [])[1];
  if (fam && src) faces[fam] = src.replace(/["']/g, "");
}
// a font with no file yet goes here, said so it is not forgotten (Cormorant Garamond was, to 23 Nov 2026)
const KNOWN_GAP = [];
for (const name of Object.keys(FONT)) {
  if (KNOWN_GAP.indexOf(name) >= 0) continue;
  const fam = first(FONT[name]), file = faces[fam];
  ok(file, "\"" + name + "\" draws with " + fam + ", which has an @font-face on the home");
  ok(fs.existsSync(path.join(web, file)) && fs.statSync(path.join(web, file)).size > 1000, fam + "'s file is there: " + file);
}
ok(faces.Jost === "fonts/jost-latin-wght.woff2" && /font-family: "Jost"; font-weight: 100 900/.test(css), "Jost ships with every weight (one variable file)");
const jost = fs.readFileSync(path.join(web, "fonts/jost-latin-wght.woff2"));
ok(jost.slice(0, 4).toString() === "wOF2" && jost.length < 40000, "a small woff2 (" + jost.length + " bytes)");
ok(faces["Cormorant Garamond"] === "fonts/cormorant-garamond-latin-wght.woff2" && /font-family: "Cormorant Garamond"; font-weight: 300 700/.test(css), "Cormorant Garamond ships with every weight (one variable file)");
const corm = fs.readFileSync(path.join(web, "fonts/cormorant-garamond-latin-wght.woff2"));
ok(corm.slice(0, 4).toString() === "wOF2" && corm.length < 40000, "a small woff2 (" + corm.length + " bytes)");
// the folder's name has no font of its own: it follows the widget's
ok(!/\.cw-lab\s*\{[^}]*font-family/.test(css), "a label (.cw-lab) never sets its own font");
ok(/root\.style\.fontFamily = FONT\[st\.font\]/.test(widgets), "the widget's box carries its font");

console.log("All " + n + " widget font tests passed.");
