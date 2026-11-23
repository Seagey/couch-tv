// The words a TV draws for a widget waiting for setup (owner, 23 Nov 2026), without a browser:
//   every kind widget-caps.js says needs something private (setupNeed) has its name and one short line
//   (face), the line is in widget-lines.js in every language, and nothing the TV draws from widget-caps.js
//   for a widget that is not set up (face, card) names a kind of TV.
//   design.js offers the phone first in Hold OK and keeps "No phone? Set it up here"; widget-detail.js's
//   setup layer no longer draws Which TVs, steps or Until then.
// Run: node tests/test_widget_setup_words.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const web = path.join(__dirname, "../tv-home/web");
const read = (f) => fs.readFileSync(path.join(web, f), "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const C = require(path.join(web, "widget-caps.js"));
const ctx = { window: { I18N: { lang: () => "de" } } };
vm.runInNewContext(read("widget-lines.js"), ctx);
const W = ctx.window.CouchWidgetLines.words;
const LANGS = ["es", "it", "de", "fr", "tr", "sr-Latn-RS", "pl", "nl", "cs", "he", "ar", "pt", "ro", "zh-CN"];
const TV_NAMES = /Hisense|Samsung|Roku|Apple TV|Fire TV|Google TV|Android TV|website home/;
const NEEDS = ["town", "photos", "calendar", "spotify", "wifi", "text", "team", "ha"];

const withNeed = C.kinds().filter((k) => C.setupNeed(k));
ok(withNeed.length >= 30, "kinds that need something private: " + withNeed.length);
for (const k of withNeed) {
  const f = C.face(k);
  ok(f && f.name === (k === "agenda" ? "Calendar" : C.get(k).name) && NEEDS.includes(f.need), k + ": a face with its name and need (" + JSON.stringify(f) + ")");
  ok(f.line && f.line.split(" ").length <= 6 && !/[–—]/.test(f.line), k + ": one short line: " + f.line);
  ok(W[f.line] && LANGS.every((l) => W[f.line][l]), k + ": its line in every language");
}
ok(C.setupNeed("agenda") === "calendar" && C.setupNeed("weather") === "town" && C.setupNeed("photo") === "photos" && C.setupNeed("clock") === null, "agenda needs a calendar, weather a town, a photo photos, a clock nothing");
ok(C.face("agenda").name === "Calendar" && C.get("agenda").name === "Agenda", "a waiting agenda is called Calendar on the TV, the plain word; its kind keeps its own name");
{ const cw = { window: {} }; vm.runInNewContext(read("caps-words.js"), cw); const row = cw.window.CouchCapsWords.words.Calendar; ok(row && LANGS.every((l) => row[l]), "Calendar: in every language of caps-words.js, so the TV says it in its language"); }
ok(C.setupNeed("commute") === null, "the commute keeps its own words (its place is a widget setting)");
for (const k of C.kinds()) for (const tiny of [false, true]) {
  const c = C.card(k, tiny);
  ok(!TV_NAMES.test(c.line + " " + c.sub), k + (tiny ? " tile" : "") + ": the setup card names no kind of TV: " + c.line);
}
for (const s of ["Set up on your phone", "Press OK to set it up", "Scan with your phone camera.", "No phone? Set it up here"]) ok(W[s] && LANGS.every((l) => W[s][l]), s + ": in every language");

const detail = read("widget-detail.js"), design = read("design.js"), widgets = read("widgets.js");
ok(!/label\("Which TVs"\)|How to set it up on this TV|label\("Until then"\)|label\("What it needs"\)/.test(detail), "the setup layer has no Which TVs, steps, Until then or What it needs");
ok(!/Google TV, Android TV, Fire TV|"Hisense"|Roku, Apple TV and others/.test(detail), "the setup layer draws no TV groups");
ok(/nodes\.unshift\(mk\(need \? nm \+ ": set up on your phone" : "Edit on your phone"/.test(design), "Hold OK: the phone first");
ok(/mk\("Edit the stack on your phone", "wphone", pid \+ "\|"\)/.test(design) && /else nodes\.splice\([^\n]*"Edit the stack on the TV"/.test(design), "Hold OK on a smart stack: the phone first, Edit the stack on the TV only with no phone page");
ok(/"No phone\? Set it up here"/.test(design) && /"No phone\? Set it up here"/.test(detail), "No phone? Set it up here in the sheet and the layer");
ok(/u \+ "&widgets"/.test(design) && /"Set up your widgets"/.test(design) && /120000/.test(design), "a new design's card: Set up your widgets, #widgets, 2 minutes");
ok(/"&connect=" \+ need/.test(widgets), "the widget's code opens its step (&connect=)");
ok(!/Batteries show on a Google TV|Needs an Android TV|It needs a Google TV, Android TV or Fire TV/.test(widgets), "the batteries and screen time widgets name no TV");
// the Ask sheet and the Ask AI widget (ask.js): no line the TV draws names a kind of TV (comments may)
const askLines = (read("ask.js").replace(/^\s*\/\/.*$/gm, "").match(/"(?:[^"\\]|\\.)*"/g) || []).filter((s) => TV_NAMES.test(s));
ok(askLines.length === 0, "ask.js draws no TV type: " + askLines.join(" | "));
const I = {}; { const c2 = { window: {}, localStorage: { getItem() { return null; } }, navigator: { language: "en" }, document: { documentElement: { setAttribute() {} }, addEventListener() {} } }; Object.assign(c2.window, c2); vm.runInNewContext(read("i18n.js"), c2); Object.assign(I, c2.window.I18N.strings); }
for (const k of ["tw_setup_phone", "tw_setup_name_phone", "tw_no_phone_here", "tw_scan_camera", "tw_setup_widgets", "tw_stack_edit_phone"]) ok(LANGS.every((l) => typeof I[l][k] === "string" && I[l][k]), k + ": in every language of i18n.js");
console.log("widget setup words: " + n + " checks passed");
