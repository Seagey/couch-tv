// The phone pages' word table (tv-home/web/phone-words.js) and the shared widget settings words
// (tv-home/web/caps-words.js, scripts/caps-words-todo.mjs), without a browser:
//   every English line of setup.html, shim.js's pairing box and ha-phone.html is in the table, in all 15
//   other languages, with the same {gaps} and <b> names; the pages load the files; the servers hand them out.
// Run: node tests/test_phone_words.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { capsLines, capsTable } from "../scripts/caps-words-todo.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// the table, read out of phone-words.js
const src = read("tv-home/web/phone-words.js");
const WORDS = vm.runInNewContext("(" + src.slice(src.indexOf("var WORDS = {") + "var WORDS = ".length, src.indexOf("\n  };\n", src.indexOf("var WORDS = {")) + 4) + ")");
const LANGS = ["es", "it", "de", "fr", "tr", "sr-Latn-RS", "pl", "nl", "cs", "he", "ar", "pt", "ro", "zh-CN"];
const keys = Object.keys(WORDS);
ok(keys.length >= 350, "lines in the table: " + keys.length);
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
const bold = (s) => (String(s).match(/<\/?b>/g) || []).length;
let bad = [];
for (const en of keys) for (const l of LANGS) {
  const v = WORDS[en][l];
  if (typeof v !== "string" || !v.trim()) bad.push(l + ": " + en);
  else if (holes(v) !== holes(en)) bad.push(l + " gaps: " + en);
  else if (bold(v) !== bold(en)) bad.push(l + " <b>: " + en);
  else if (/<(?!\/?b>)/.test(v)) bad.push(l + " html: " + en);
}
ok(bad.length === 0, "every line in every language, gaps and bold kept: " + bad.slice(0, 5).join(" | "));
// es-MX: only where it differs, and then Mexican words
const mx = keys.filter((en) => WORDS[en]["es-MX"]);
ok(mx.length > 30 && mx.every((en) => WORDS[en]["es-MX"] !== WORDS[en].es), "es-MX only where Mexico differs: " + mx.length);
ok(mx.some((en) => /celular/.test(WORDS[en]["es-MX"])), "es-MX says celular");
ok(!keys.some((en) => /celular/.test(WORDS[en].es)), "Spain's Spanish never says celular");

// every English line on the pages is in the table (or is a name that stays as it is)
const KEEP = /^(Claude \(Anthropic\)|Google Gemini|Groq|Mistral|OpenAI|Philips Hue|Apple Home|Amazon Alexa|Home Assistant|homeassistant\.local:8123|Tuya, Smart Life, Arlec Grid Connect, Deta)$/;
function pageLines(html) {
  const st = html.indexOf("</style>"), sc = html.indexOf("<script>", st);
  const out = new Set();
  for (const m of html.slice(st, sc).matchAll(/>([^<]+)</g)) { const t = m[1].replace(/\s+/g, " ").trim(); if (/[A-Za-z]{2}/.test(t)) out.add(t); }
  for (const m of html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) if (/[A-Za-z]{2}/.test(m[1]) && !/' \+/.test(m[1])) out.add(m[1]);   // a joined label is a {gap} line
  return [...out];
}
const inBlock = (t) => keys.some((en) => /<b>/.test(en) && en.replace(/<\/?b>/g, "").includes(t));
for (const f of ["on-tv/web/setup.html", "tv-home/web/ha-phone.html"]) {
  const miss = pageLines(read(f)).filter((t) => !WORDS[t] && !KEEP.test(t) && !inBlock(t));
  ok(miss.length === 0, f + ": every line has its words: " + miss.slice(0, 6).join(" | "));
}
for (const s of ["Pair this phone", "Type the 6 digit code shown on the TV.", "Show a code on the TV", "Code from the TV", "Pair"]) ok(!!WORDS[s], "the pairing box: " + s);

// the pages load the files, and the servers hand them out
ok(/<script src="\/tv\/caps-words\.js"><\/script>\s*<script src="\/tv\/phone-words\.js"><\/script>/.test(read("on-tv/web/setup.html")), "setup.html loads the word files from /tv/");
ok(/PhoneWords\.set\(j\.settings && j\.settings\.lang\)/.test(read("on-tv/web/setup.html")), "setup.html follows the TV's Home settings language");
ok(/<script src="caps-words\.js"><\/script>\s*<script src="phone-words\.js"><\/script>/.test(read("tv-home/web/ha-phone.html")), "ha-phone.html loads the word files");
ok(/"GET \/ha\/phone-words\.js", "GET \/ha\/caps-words\.js"/.test(read("tv-home/android/shared/java/app/couchtv/ha/HaPhone.kt")), "the TV's /ha server hands them out");
ok(/\/ha\/phone-words\.js/.test(read("bridge/haphone.py")) && /\/ha\/caps-words\.js/.test(read("bridge/haphone.py")), "the home computer's /ha hands them out");
ok(/&l=" \+ encodeURIComponent\(window\.I18N\.lang\(\)\)/.test(read("tv-home/web/app.js")), "the TV's Smart home QR carries its language");
ok(/RTL = \{ he: 1, ar: 1 \}/.test(src), "he and ar read right to left");

// the widget settings words: one table for both, widget-caps.js untouched
const CAPS = createRequire(import.meta.url)(path.join(root, "tv-home/web/widget-caps.js"));
const lines = capsLines(CAPS);
ok(lines.size > 50, "widget settings words found: " + lines.size);
ok(typeof capsTable() === "object", "caps-words.js holds a table");
ok(/window\.CouchCapsWords/.test(read("tv-home/web/tv-words.js")) && /window\.CouchCapsWords/.test(src), "the TV and the phone both read caps-words.js");
ok(/<script src="caps-words\.js"><\/script>\s*<script src="tv-words\.js"><\/script>/.test(read("tv-home/web/index.html")), "the TV home loads caps-words.js");
// Fable 0814 item 3: every widget settings word has its line, in all 14 languages (es-MX may follow es)
const table = capsTable(), CAPS_LANGS = ["es", "it", "de", "fr", "tr", "sr-Latn-RS", "pl", "nl", "cs", "he", "ar", "pt", "ro", "zh-CN"];
const missing = [...lines.keys()].filter((en) => !table[en]);
ok(missing.length === 0, "every widget settings word has a line in caps-words.js (" + lines.size + "), missing: " + missing.slice(0, 5).join(" | "));
const wrongLines = [];
for (const [en, row] of Object.entries(table)) {
  if (row.same) continue;
  for (const l of CAPS_LANGS) if (typeof row[l] !== "string" || !row[l].trim()) wrongLines.push(en + " has no " + l);
  for (const [l, v] of Object.entries(row)) {
    if (/[–—]/.test(v)) wrongLines.push(en + " " + l + " has a dash");
    if (/[<>]/.test(v)) wrongLines.push(en + " " + l + " has markup");
    if (v[0] !== v[0].toUpperCase() && /^[A-Z]/.test(en)) wrongLines.push(en + " " + l + " starts lower case");
    const gaps = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    if (gaps(v) !== gaps(en)) wrongLines.push(en + " " + l + " gaps differ");
  }
}
ok(wrongLines.length === 0, "every line in every language, no dashes, no markup, sentence case, same gaps: " + wrongLines.slice(0, 6).join(" | "));

console.log("phone words: " + n + " checks passed");
