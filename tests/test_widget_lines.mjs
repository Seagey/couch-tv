// The widgets' own words in the TV's language (tv-home/web/widget-lines.js):
//   every English line added to the widgets (widgets.js) and the layer OK opens on one (widget-detail.js)
//   since 0.13.8 is a line of that table, a line with a gap asked for through tl(), or named below with the
//   reason it stays as it is; every line of the table has all 15 other languages, the same {gaps}, no
//   dashes, no markup and a capital where the English has one; the TV loads it before widgets.js, and a
//   line drawn by a widget comes out in the TV's language.
// Needs git and the v0.13.8 tag for the first part; without them that part says so and the rest runs.
// Run: node tests/test_widget_lines.mjs   (--list prints the lines that have no row yet, as JSON)
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const LANGS = ["es", "it", "de", "fr", "tr", "sr-Latn-RS", "pl", "nl", "cs", "he", "ar", "pt", "ro", "zh-CN"];

const load = (lang) => {
  const ctx = { window: { I18N: { lang: () => lang } } };
  vm.runInNewContext(read("tv-home/web/widget-lines.js"), ctx);
  return ctx.window.CouchWidgetLines;
};
const L = load("de"), W = L.words, keys = Object.keys(W);

// lines that stay as they are, and why
const KEEP = {
  "Europe/London": "a time zone's name, never drawn", "America/New_York": "a time zone's name, never drawn", "Asia/Tokyo": "a time zone's name, never drawn", "Australia/Sydney": "a time zone's name, never drawn",
  "Slow mornings are the good ones.": "the Quote widget's fallback line; the quotes are English writing (widget-words.js)",
  "Petrichor": "the Word of the day's fallback word: an English word to learn",
  "The smell of rain on dry ground.": "the Word of the day's fallback meaning, with its English word",
  "Alex": "a name in Couch TV Studio's demo", "Backyard": "a camera's name in Couch TV Studio's demo", "Driveway": "a camera's name in Couch TV Studio's demo",
  "Room ": "an aria label with the room's own name",
  "Inter, sans-serif": "a font name in an svg, never words",
  "Twenty seven minutes past\neleven": "the Word clock in Couch TV Studio's demo: the Word clock writes the time in English words",
  "Pizza": "a timer's name in Couch TV Studio's demo",
  "Ask AI": "the feature's own name, kept in every language as i18n.js keeps it (the Play build's Ask AI layer, widget-detail.js)",
  "H:": "the day's high and low as H: and L:, written the way weather apps write them"
};
// a literal that only starts a line made with tl() or the table (a fragment of one of its lines)
const pieceOf = (s) => keys.some((k) => k.startsWith(s) || k.includes(" " + s.trim()) && s.trim().length > 3);

let missing = [];
try {
  execFileSync("git", ["-C", ROOT, "rev-parse", "v0.13.8"], { stdio: "ignore" });
  const seen = new Set(), OLD = new Set();
  for (const f of ["tv-home/web/widgets.js", "tv-home/web/widget-detail.js"]) {
    const diff = execFileSync("git", ["-C", ROOT, "diff", "v0.13.8", "-U0", "--", f], { encoding: "utf8", maxBuffer: 1 << 28 });
    // a line that was in 0.13.8 already, only with the product's old name (couch-tv Studio, Couch TV Studio
    // from 0.13.10), or on a line changed only for that name, is not a new line
    const was = execFileSync("git", ["-C", ROOT, "show", "v0.13.8:" + f], { encoding: "utf8", maxBuffer: 1 << 28 });
    const old = (s) => was.includes(JSON.stringify(s.replace(/Couch TV Studio/g, "couch-tv Studio")));
    for (const line of diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++") || /^\+\s*\/\//.test(line)) continue;
      // tl("a line with {gaps}"): the pattern itself is the table's line
      for (const m of line.matchAll(/\btl\(\s*"((?:[^"\\]|\\.)*)"/g)) seen.add(JSON.parse('"' + m[1] + '"'));
      for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const s = JSON.parse('"' + m[1] + '"');
        if (!/^([A-Z][a-z']*|OK|UV|TV|AI)([ ,.:!?]|$)/.test(s) || /[<>=;#\/]|\.js|https?:|^[A-Z][a-z]+[A-Z]/.test(s) || /^[A-Z]$/.test(s)) continue;
        if (/\{\w+\}/.test(s) && !line.includes('tl("' + m[1])) continue;
        if (old(s)) OLD.add(s);
        seen.add(s);
      }
    }
  }
  ok(seen.size >= 150, "widget lines looked at: " + seen.size);
  missing = [...seen].filter((s) => !W[s] && !KEEP[s] && !OLD.has(s) && !(s.endsWith(" ") && pieceOf(s)));
} catch (e) { if (!/v0\.13\.8|git/.test(String(e))) throw e; console.log("SKIP part 1: no git or no v0.13.8 tag"); }
if (process.argv.includes("--list")) { console.log(JSON.stringify(missing, null, 1)); process.exit(0); }
ok(missing.length === 0, missing.length + " new widget lines with no row in widget-lines.js:\n  " + missing.join("\n  "));
for (const s of Object.keys(KEEP)) ok((read("tv-home/web/widgets.js") + read("tv-home/web/widget-detail.js")).includes(JSON.stringify(s)), "still in the code: " + s);

// every row: every language, the same gaps, no dashes or markup, the capital kept
const gaps = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const bad = [];
for (const en of keys) {
  const row = W[en];
  // a line may hold its forms by the language's plural rule: { one, few, many, other }, "other" always there
  const forms = (v) => v && typeof v === "object" ? Object.values(v) : [v];
  for (const l of LANGS) if (!forms(row[l]).every((v) => typeof v === "string" && v.trim()) || (typeof row[l] === "object" && typeof row[l].other !== "string")) bad.push(en + " has no " + l);
  if (row["es-MX"] != null && row["es-MX"] === row.es) bad.push(en + " es-MX is the same as es");
  for (const [l, v] of Object.entries(row).flatMap(([l, v]) => forms(v).map((x) => [l, x]))) {
    if (/[–—]/.test(v)) bad.push(en + " " + l + " has a dash");
    if (/[<>]/.test(v)) bad.push(en + " " + l + " has markup");
    if (/^[A-Z]/.test(en) && v[0] !== v[0].toUpperCase()) bad.push(en + " " + l + " starts lower case");
    if (gaps(v) !== gaps(en)) bad.push(en + " " + l + " gaps differ");
  }
}
ok(keys.length >= 150, "lines in the table: " + keys.length);
ok(bad.length === 0, "every line in every language, no dashes, no markup, sentence case, same gaps: " + bad.slice(0, 8).join(" | "));

// the TV home loads it before the widgets, and the widgets draw through it
ok(/<script src="widget-words\.js"><\/script>\s*<script src="widget-lines\.js"><\/script>\s*<script src="widgets\.js"><\/script>/.test(read("tv-home/web/index.html")), "index.html loads widget-lines.js before widgets.js");
const wsrc = read("tv-home/web/widgets.js");
ok(/document\.createTextNode\(wl\(k\)\)/.test(wsrc), "widgets.js add() draws a string through wl()");
ok(/kit: \{ tl: tl, wl: wl, dayName: dayName,/.test(wsrc), "widget-detail.js gets tl and wl from the kit");
ok(/CouchWidgetLines/.test(read("tv-home/web/app.js")), "a guest's Check in and Check out go through the table");

// in the TV's language, gaps filled; English on an English TV; a line not in the table stays
ok(L.t("No rain coming") === W["No rain coming"].de && L.t("No rain coming") !== "No rain coming", "de: No rain coming");
ok(L.t("Rain from {time}", { time: "3pm" }).includes("3pm") && !L.t("Rain from {time}", { time: "3pm" }).includes("{"), "de: a gap is filled");
ok(L.word("Sarah's birthday") === null, "a line not in the table is left alone");
const en = load("en");
ok(en.t("No rain coming") === "No rain coming" && en.t("Rain from {time}", { time: "3pm" }) === "Rain from 3pm", "en: the English");
const mx = load("es-MX"), es = load("es");
ok(mx.t("No rain coming") === (W["No rain coming"]["es-MX"] || es.t("No rain coming")), "es-MX falls back to es");
// a number picks its words: Czech, Polish and Arabic count weeks their own way
const pl = load("pl"), cs = load("cs"), ar = load("ar");
ok(pl.t("weeks to go", { n: 2 }) !== pl.t("weeks to go", { n: 5 }) && /tygodni/.test(pl.t("weeks to go", { n: 5 })), "pl: 2 tygodnie, 5 tygodni");
ok(cs.t("{n} years ago", { n: 3 }) === "Před 3 lety" && /dalších/.test(cs.t("and {n} more", { n: 7 })), "cs: before 3 years, 7 more");
ok(ar.t("days to go", { n: 2 }) !== ar.t("days to go", { n: 11 }), "ar: two days and eleven days read differently");
ok(typeof L.word("weeks to go") === "string", "a plural line drawn without its number still gives words");
ok(/tl\(num === 1 \? "week to go" : "weeks to go", \{ n: num \}\)/.test(wsrc), "the countdown hands its number over");
// he and ar: a name or a code in a gap sits in a left to right isolate where the line has one
for (const l of ["he", "ar"]) ok(keys.filter((k) => /\{codes\}/.test(k)).every((k) => W[k][l].includes("⁦{codes}⁩")), l + ": share codes isolated");

console.log("widget lines: " + n + " checks passed");
