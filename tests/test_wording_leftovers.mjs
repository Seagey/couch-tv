// The rest of WORDING-PROPOSAL-0139 (20 Nov 2026), and the new words in every language:
//   the home computer's messages (err_*, note_*) in plain words, in en, zh-CN and pl, on the TV home
//   (tv-home/web/i18n.js) and the phone remote (remote/src/i18n.js); Reply; Finding it; Ask AI is
//   switched off; the phone page's Home button section; the Home button version's update steps; Couch TV
//   on screen; the TV words of today (tw_*) in all 16 TV blocks; Send a design (ds_*) in all 11 phone blocks.
// Run: node tests/test_wording_leftovers.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- the TV home's words ----
const ctx = { window: {} };
vm.runInNewContext(read("tv-home/web/i18n.js"), ctx);
const TV = ctx.window.I18N.strings;
// ---- the phone remote's words (an ES module with React: only its S blocks are read) ----
const rsrc = read("remote/src/i18n.js");
const R = {};
for (const [name, id] of [["S.en", "en"], ["S['zh-CN']", "zh-CN"], ["S.es", "es"], ["S['es-MX']", "es-MX"], ["S.it", "it"], ["S.de", "de"], ["S.tr", "tr"], ["S['sr-Latn-RS']", "sr-Latn-RS"], ["S.cs", "cs"], ["S.pl", "pl"], ["S.pt", "pt"]]) {
  const at = rsrc.indexOf("\n" + name + " = {"), end = rsrc.indexOf("\n};", at);
  ok(at >= 0, "remote block " + name);
  R[id] = vm.runInNewContext("(" + rsrc.slice(rsrc.indexOf("{", at), end + 2) + ")");
}

// 1. the home computer's messages: no jargon on screen, in the three languages that have them
const JARGON = /config\.json|docs\/|\.env\b|ADB tools|OPACK|base64|\bpip\b|scripts\/|\.py\b|bundle id|socket|JSON|Content-Type|endpoint|turn on trace|HASHVAL|PAIRING_REQ_TOKEN|apple_home|tvos\/|couch-tv(?! Studio)|\bbridge\b/;
for (const [where, S] of [["TV", TV], ["phone", R]]) {
  for (const l of ["en", "zh-CN", "pl"]) {
    const bad = Object.keys(S[l]).filter((k) => /^(err|note)_/.test(k) && JARGON.test(S[l][k]));
    ok(bad.length === 0, where + " " + l + ": no jargon in the home computer's messages: " + bad.slice(0, 6).map((k) => k + "=" + S[l][k]).join(" | "));
  }
  ok(S.en.err_ask_disabled === "Ask AI is switched off.", where + ": Ask AI is switched off.");
  ok(S.en.err_lg_adb_android_only === "That only works on an Android TV. This is an LG TV.", where + ": That only works on an Android TV");
  ok(/^Too many wrong codes\. Wait \{minutes\} min,/.test(S.en.err_pairing_locked) && S["zh-CN"].err_pairing_locked.includes("{minutes}") && S.pl.err_pairing_locked.includes("{minutes}"), where + ": the pairing lock's words in en, zh-CN and pl");
  // the same placeholders in every language
  const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
  const diff = Object.keys(S.en).filter((k) => /^(err|note)_/.test(k)).filter((k) => ["zh-CN", "pl"].some((l) => S[l][k] != null && holes(S[l][k]) !== holes(S.en[k])));
  ok(diff.length === 0, where + ": placeholders match: " + diff.join(", "));
}
// the bridge sends err_pairing_locked; the TV home and the phone both know it
ok(/key="err_pairing_locked"/.test(read("bridge/server.py")), "the bridge sends err_pairing_locked");

// 2. the phone remote: Reply, Finding it
const sheets = read("remote/src/Sheets.jsx");
ok(!/Reply to Claude/.test(sheets) && /aria-label=\{thread\.length \? t\('reply'\)/.test(sheets), "Reply, not Reply to Claude");
for (const l of Object.keys(R)) if (R[l].finding) ok(!/Claude/.test(R[l].finding), l + ": finding has no Claude: " + R[l].finding);
ok(R.en.finding === "Finding it", "Finding it");

// 3. the phone page: the Home button section
const page = read("on-tv/web/setup.html");
ok(/<a href="#home">Home button<\/a>/.test(page) && /<h2>Home button<\/h2>/.test(page), "Home settings on the phone: Home button");
ok(page.includes("Make the Home button open Couch TV") && page.includes("Make the Home button open the TV's own home again"), "says what the person will notice");
ok(!/as the home screen|Use as home screen|is the home screen/.test(page), "no home screen jargon left on the phone page");

// 4. the Home button version's update steps
const ur = read("on-tv/android/app/src/main/java/dev/couchtv/ontv/UpdateRules.kt");
ok(ur.includes("This is the Home button version of Couch TV.") && !ur.includes("has the Home button watch"), "UpdateRules: the Home button version");
ok(!/"[^"]*adb (connect|install)[^"]*"/.test(ur), "UpdateRules: no adb commands on screen");

// 5. Couch TV on screen (couch-tv stays in links, file names, Couch TV Studio, and the name the Hue app shows: bridge/direct.py devicetype couch-tv#home)
for (const [where, S] of [["TV", TV], ["phone", R]]) {
  const left = [];
  for (const l of Object.keys(S)) for (const k of Object.keys(S[l] || {})) if (typeof S[l][k] === "string" && /couch-tv(?! Studio|-ontv|-home)/.test(S[l][k]) && k !== "about_code" && k !== "tw_hue_unpair_sub") left.push(l + "." + k);
  ok(left.length === 0, where + ": couch-tv only as a name of a link, file or Couch TV Studio: " + left.slice(0, 6).join(", "));
}

// 6. today's TV words: every tw_ word in all 16 TV blocks (es-MX through es)
const tvLangs = ctx.window.I18N.langs.map((x) => x.id);
ok(tvLangs.length === 16, "16 TV languages");
const tw = Object.keys(TV.en).filter((k) => k.indexOf("tw_") === 0);
ok(tw.length >= 85, "TV words: " + tw.length);
for (const l of tvLangs) {
  if (l === "en") continue;
  const blk = l === "es-MX" ? Object.assign({}, TV.es, TV["es-MX"]) : TV[l];
  const missing = tw.filter((k) => typeof blk[k] !== "string" || !blk[k]);
  ok(missing.length === 0, l + ": every TV word: missing " + missing.slice(0, 4).join(", "));
  const copied = tw.filter((k) => blk[k] === TV.en[k] && !/^(Designs|Widgets on this home)$/.test(TV.en[k]) && !(l === "pt" && /^Designs/.test(blk[k])));
  ok(copied.length <= 2, l + ": translated, not English copied: " + copied.slice(0, 4).join(", "));
}
// each English tw_ word is a line app.js, design.js or design-code.js (the phone inbox's messages) draws
const src = read("tv-home/web/app.js") + read("tv-home/web/design.js") + read("tv-home/web/design-code.js");
const notDrawn = tw.filter((k) => !src.includes(JSON.stringify(TV.en[k])) && !src.includes('"' + TV.en[k].split("{")[0]));
ok(notDrawn.length === 0, "every TV word is drawn by app.js, design.js or design-code.js: " + notDrawn.join(", "));
ok(/<script src="i18n\.js"><\/script>\s*<script src="caps-words\.js"><\/script>\s*<script src="tv-words\.js"><\/script>/.test(read("tv-home/web/index.html")), "caps-words.js and tv-words.js load right after i18n.js");

// 7. Send a design on the phone: every ds_ word in all 11 phone blocks
const ds = Object.keys(R.en).filter((k) => k.indexOf("ds_") === 0);
ok(ds.length === 12, "Send a design words: " + ds.length);
for (const l of Object.keys(R)) {
  const missing = ds.filter((k) => typeof R[l][k] !== "string" || !R[l][k]);
  ok(missing.length === 0, l + ": every Send a design word");
}
const dsrc = read("remote/src/designSend.js");
const W = vm.runInNewContext("(" + dsrc.slice(dsrc.indexOf("export const WORDS = {") + "export const WORDS = ".length, dsrc.indexOf("\n};", dsrc.indexOf("export const WORDS")) + 2) + ")");
for (const k of ds) ok(R.en[k] === W[k.slice(3)], "ds en matches WORDS." + k.slice(3));
// the TV's own button names, in the same language
for (const [l, tl] of [["de", "de"], ["pl", "pl"], ["pt", "pt"], ["cs", "cs"], ["it", "it"], ["tr", "tr"], ["sr-Latn-RS", "sr-Latn-RS"], ["zh-CN", "zh-CN"], ["es", "es"]]) {
  const btn = TV[tl].tw_use_btn;
  ok(R[l].ds_sent.includes(btn) || R[l].ds_sent.includes("“" + btn + "”"), l + ": Send a design names the TV's button as the TV shows it: " + btn);
}
ok(!/DW\.|DESIGN_WORDS\./.test(sheets + read("remote/src/App.jsx")), "the phone draws Send a design through dsw()");

// Fable's NO-GO of 20 Nov: the words it named
ok(TV.de.tw_keep_home === "Meinen Startbildschirm behalten" && TV.de.tw_check_first.includes("Meinen Startbildschirm behalten lässt"), "de: Meinen Startbildschirm behalten, button and note");
// Get a design's line means typing on the TV the code the phone shows (not typing on the phone)
const typeHere = { de: /Gib hier den Code ein, den Couch TV Studio auf deinem Handy zeigt/, pl: /Wpisz tutaj kod, który Couch TV Studio pokazuje/, ar: /اكتب هنا الرمز الذي يعرضه/, he: /הקלידו כאן את הקוד ש-Couch TV Studio מציג/, nl: /Typ hier de code die/, cs: /Napište sem kód, který/, pt: /Digite aqui o código que/, "sr-Latn-RS": /Ukucajte ovde kod koji/, tr: /gösterdiği kodu buraya yaz/, ro: /Tastează aici codul pe care/ };
for (const [l, re] of Object.entries(typeHere)) ok(re.test(TV[l].tw_type_code_phone), l + ": Get a design is typed on the TV: " + TV[l].tw_type_code_phone);
// Arabic and Hebrew: addresses and codes in left to right isolates
for (const l of ["ar", "he"]) {
  for (const k of ["set_phone_pc", "tw_ha_connected_to_host_scan_to_ch"]) {   // (tw_scan_widget went with the old Edit on your phone hint, 23 Nov)
    const holes = TV.en[k].match(/\{\w+\}(\/setup)?/g);
    ok(holes.every((h) => TV[l][k].includes("⁦" + h + "⁩")), l + " " + k + ": every address and code isolated");
  }
}
// the error keys say nothing about "this phone" on the TV (the TV shows them too)
for (const l of ["en", "zh-CN", "pl"]) for (const k of ["err_invalid_pairing_key", "err_pairing_key_required"]) ok(!/this phone|这部手机|ten telefon|tego telefonu/.test(TV[l][k]), "TV " + l + " " + k + ": no this phone");
// the phone can't press keys: the real fix, in the words of Android's menu
for (const [where, S] of [["TV", TV], ["phone", R]]) ok(S.en.err_adb_not_on === "On the TV, switch on USB debugging in Developer options, then press Allow.", where + ": err_adb_not_on");
// the lock's message says "min", the same on the TV, the bridge, the on-TV app and the phone page
ok(/Wait \{mins\} min, then try again\./.test(read("bridge/server.py")) && /Wait \$\{\(secs \+ 59\) \/ 60\} min, then try again\./.test(read("on-tv/android/app/src/main/java/dev/couchtv/ontv/Server.kt")) && read("tv-home/web/phone-words.js").includes('"Too many wrong codes. Wait {minutes} min, then try again."'), "Wait N min, then try again: bridge, on-TV app and phone page");

console.log("wording leftovers: " + n + " checks passed");
