// The Matter screens' words in every language (tv-home/web/matter-words.js):
//  1. every key has every language Couch TV has (es-MX may fall back to es), with the same {gaps},
//     plain words (no dashes, no "Beta", "Experimental" or "coming soon");
//  2. every key the screens ask for exists: app.js (Home settings, Smart home), setup.html (the phone's
//     Matter card), matter.js (a device's description), including the error, reason and kind keys;
//  3. every English line in the phone card's own HTML is a line of the table, so the phone page's word
//     swapper (phone-words.js, branch nl-remote) shows it in the TV's language;
//  4. a device is described in the TV's language (German, Chinese), a door sensor says open or closed
//     and a motion sensor someone or no one there;
//  5. app.js's Matter section has no English line left in it (all come from the table), so the TV words
//     check on nl-remote (test_tv_words_cover.mjs) has nothing of it to flag;
//  6. with nl-remote's phone-words.js (read from git when the branch is there): the card's lines in French.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

function load(extra, files) {
  const win = Object.assign({}, extra || {});
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, Promise, console, JSON, Date, Math });
  (files || ["matter-words.js"]).forEach((f) => vm.runInContext(typeof f === "string" ? fs.readFileSync(path.join(WEB, f), "utf8") : f.src, ctx));
  return win;
}

// 1. every language
const W = load().CouchMatterWords;
const LANGS = W.langs;
ok(LANGS.length === 15 && LANGS.indexOf("zh-CN") >= 0 && LANGS.indexOf("sr-Latn-RS") >= 0, "15 languages besides English");
const keys = W.keys();
ok(keys.length >= 80, "lines in the table: " + keys.length);
const missing = [], gaps = [], dashes = [];
keys.forEach((k) => {
  const en = W.en(k), row = W.row(k), want = (en.match(/\{\w+\}/g) || []).sort().join();
  if (/[–—]|\bBeta\b|Experimental|coming soon/i.test(en)) dashes.push(k + " en");
  LANGS.forEach((l) => {
    const v = row[l] != null ? row[l] : l === "es-MX" ? row.es : null;
    if (v == null || !String(v).trim()) { missing.push(k + " " + l); return; }
    if ((v.match(/\{\w+\}/g) || []).sort().join() !== want) gaps.push(k + " " + l);
    if (/[–—]/.test(v)) dashes.push(k + " " + l);
  });
  Object.keys(row).forEach((l) => { if (LANGS.indexOf(l) < 0) missing.push(k + " unknown language " + l); });
});
ok(missing.length === 0, "every line in every language: " + missing.join(", "));
ok(gaps.length === 0, "the same gaps in every language: " + gaps.join(", "));
ok(dashes.length === 0, "no dashes or hedges: " + dashes.join(", "));
ok(W.t("added_names", { names: "Lamp" }, "de") === "Hinzugefügt: Lamp. Es erscheint jetzt in deinen Smart-Home-Widgets.", "a gap is filled");
ok(W.t("add", null, "es-MX") === "Agregar un dispositivo Matter" && W.t("rename", null, "es-MX") === "Cambiar nombre", "Mexico's own words, else Spain's");
ok(W.t("add", null, "en") === "Add a Matter device" && W.t("nope") === "nope", "English, and an unknown key as itself");

// 2. every key the screens ask for
const app = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
const a0 = app.indexOf("// ---- Home settings, Smart home, Matter devices (matter.js) ----"), a1 = app.indexOf("window.CouchMatter.onChange(", a0);
ok(a0 > 0 && a1 > a0, "app.js has the Matter section");
const appSec = app.slice(a0, a1);
const setup = fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"), "utf8");
const s0 = setup.indexOf("// ---------------- Matter devices"), s1 = setup.indexOf("// ---------------- this TV ----------------", s0);
const setupSec = setup.slice(s0, s1);
const matterJs = fs.readFileSync(path.join(WEB, "matter.js"), "utf8");
const asked = new Set();
[appSec, setupSec].forEach((src) => { for (const m of src.matchAll(/mw\(\s*["']([a-z_]*[a-z])["']/g)) asked.add(m[1]); });   // "why_" + key: read below
for (const m of appSec.matchAll(/\["(brand_[a-z]+|app_[a-z]+)"/g)) asked.add(m[1]);
for (const m of appSec.matchAll(/, "(app_[a-z]+)"\]/g)) asked.add(m[1]);
const objKeys = (src, name) => { const m = new RegExp("var " + name + " = \\{([^}]*)\\}").exec(src); return m ? [...m[1].matchAll(/([a-z_]+): 1/g)].map((x) => x[1]) : []; };
[appSec, setupSec].forEach((src) => {
  objKeys(src, "MT_ERR").forEach((k) => asked.add("err_" + k));
  objKeys(src, "MT_WHY").forEach((k) => asked.add("why_" + k));
});
["light", "switch", "fan", "cover", "climate", "sensor"].forEach((d) => asked.add("kind_" + d));
for (const m of matterJs.matchAll(/\b(st_[a-z]+|kind_[a-z]+)\b/g)) asked.add(m[1]);
const unknown = [...asked].filter((k) => keys.indexOf(k) < 0);
ok(asked.size >= 75, "keys the screens ask for: " + asked.size);
ok(unknown.length === 0, "every key asked for is in the table: " + unknown.join(", "));
ok(objKeys(appSec, "MT_ERR").length >= 16 && objKeys(setupSec, "MT_ERR").length >= 14 && objKeys(appSec, "MT_WHY").length === 27 && objKeys(setupSec, "MT_WHY").length === 27, "the error and reason keys are read from both screens");
// coordinator's wording (21 Nov): the port is "usually" 5540; a device the home computer adds is not
// "the TV's"; the phone names the whole path to Smart home
ok(W.en("why_port") === "Matter devices usually answer on port 5540. Leave the port out, and the TV finds the device by itself.", "why_port: usually 5540");
ok(["err_unreachable", "err_thread"].every((k) => !/\bTV\b/.test(W.en(k).replace(/Couch TV|Apple TV/g, ""))), "unreachable and Thread say Couch TV, never the TV (the home computer may be the one adding)");
ok(/Home settings, Designs, Smart home\.$/.test(W.en("added_phone")) && W.t("added_phone", null, "de").indexOf("Designs, Smart Home") >= 0 && W.t("added_phone", null, "nl").indexOf("Ontwerpen, Smart home") >= 0, "added on the phone: Home settings, Designs, Smart home, in each language's own words for them");
// the on-TV app's own reasons and error (nl-matter-android ae3e6c1): an Android 6 TV, an Intel TV
const NEWER = { err_busy: ["busy", "MT_ERR", "The TV is busy adding another device. Try again in a minute."], why_android_old: ["android_old", "MT_WHY", "Matter needs Android 7 or newer on this TV."], why_processor: ["processor", "MT_WHY", "This TV's processor can't run Matter."], err_unsupported: ["unsupported", "MT_ERR", "This TV can't add Matter devices."] };
Object.keys(NEWER).forEach((k) => {
  const [key, obj, en] = NEWER[k];
  ok(objKeys(appSec, obj).indexOf(key) >= 0 && objKeys(setupSec, obj).indexOf(key) >= 0, key + " is read on the TV and the phone");
  ok(W.en(k) === en && LANGS.every((l) => { const v = W.t(k, null, l); return v && v !== en; }), key + " in plain English and in all 15 languages: " + W.t(k, null, "de"));
});
// contract change 14: every reason key, worded on the TV (app.js's own mtSay, run here) and present on the phone
const REASONS = ["blocked", "unsupported", "address", "port", "link_local", "offline", "not_answering", "opens_house", "off", "not_installed",
  "node_missing", "node_old", "starting", "stopped", "android_old", "processor", "not_started", "busy",
  "not_found", "not_allowed", "bad_request", "bad_name", "not_ready", "device_refused", "failed", "not_certified", "local_network"];   // not_found to failed: nl-matter-android 9a4b3fe; not_certified, local_network: the bridge
const tvSay = (() => {
  const pick = (re) => { const m = re.exec(appSec); if (!m) throw new Error("app.js: " + re); return m[0]; };
  const src = pick(/function mw\(key, vars\) \{[^\n]*\}/) + "\n" + pick(/var MT_ERR = \{[^}]*\};/) + "\n" + pick(/var MT_WHY = \{[^}]*\};/) + "\n" +
    pick(/function mtSay\(r\) \{[\s\S]*?\n  \}/) + "\nmtSay;";
  return (lang) => vm.runInNewContext(src, { window: { CouchMatterWords: { t: (k, v) => W.t(k, v, lang) } } });
})();
REASONS.forEach((k) => {
  ok(objKeys(appSec, "MT_WHY").indexOf(k) >= 0 && objKeys(setupSec, "MT_WHY").indexOf(k) >= 0, "reason " + k + " is read on the TV and the phone");
  const en = W.en("why_" + k);
  ok(en && LANGS.every((l) => W.t("why_" + k, null, l) && (l === "es-MX" || W.t("why_" + k, null, l) !== en)), "reason " + k + " in plain English and all 15 languages");
  // worded before the error key it comes with, in English and in Polish
  ok(tvSay("en")({ ok: false, error: "unreachable", reason: k, note: "raw note" }) === en && tvSay("pl")({ ok: false, error: "not_allowed", reason: k }) === W.t("why_" + k, null, "pl"), "the TV words reason " + k);
});
ok(tvSay("en")({ ok: false, error: "expired" }) === W.en("err_expired") && tvSay("en")({ ok: false, error: "failed", note: "A plain note." }) === "A plain note." && tvSay("en")({ ok: false, error: "x", reason: "made_up" }) === W.en("err_failed"), "no reason: the error key, else the controller's note, else did not work");
// matter.js's English stand ins are the table's English
const en = /var EN = \{([\s\S]*?)\};/.exec(matterJs)[1];
const enPairs = [...en.matchAll(/([a-z_]+): "([^"]*)"/g)];
ok(enPairs.length === 13 && enPairs.every((p) => W.en(p[1]) === p[2]), "matter.js's English stand ins match the table");

// 3. the phone card has no English of its own: every line is a data-mw key of the table (filled in the
//    language by fillMatterWords), so the phone page check on nl-remote (test_phone_words.mjs) finds no
//    line missing from phone-words.js, and the card follows the TV's language with or without phone-words.js
const h0 = setup.indexOf('<section class="card" id="matter"'), h1 = setup.indexOf("</section>", h0);
const card = setup.slice(h0, h1).replace(/<!--[\s\S]*?-->/g, "");
const leftEn = [];
for (const m of card.matchAll(/>([^<>]+)</g)) { const t = m[1].trim(); if (t && /[A-Za-z]{2}/.test(t)) leftEn.push(t); }
for (const m of card.matchAll(/\s(?:placeholder|aria-label|title)="([^"]+)"/g)) leftEn.push(m[1]);
ok(leftEn.length === 0, "no English written in the phone card: " + leftEn.join(" | "));
const jump = /<a href="#matter"[^>]*>([^<]*)<\/a>/.exec(setup);
ok(jump && jump[1] === "" && /data-mw="brand_matter"/.test(jump[0]), "the Matter jump link is filled too");
const cardKeys = [...card.matchAll(/data-mw(?:-hint|-aria)?="([a-z0-9_]+)"/g)].map((m) => m[1]).concat(["brand_matter"]);
ok(cardKeys.length === 18 && cardKeys.every((k) => keys.indexOf(k) >= 0), "the card's 18 keys are in the table: " + cardKeys.length + " " + cardKeys.filter((k) => keys.indexOf(k) < 0).join(", "));
const brands = ["Google Home", "Apple Home", "SmartThings", "Alexa", "Matter"];
const lines = cardKeys.map((k) => W.en(k));
// and they are handed to the shared table the phone page's swapper reads
const caps = load().CouchCapsWords.words;
ok(lines.filter((t) => brands.indexOf(t) < 0).every((t) => caps[t] && caps[t].fr), "every card line is in window.CouchCapsWords (with French)");
ok(!caps.on && !caps.Light && !caps["Google Home"], "never a bare word (on, Light) or an app's name");
// a table made earlier (caps-words.js) is added to, never replaced
const kept = load({ CouchCapsWords: { words: { Units: { fr: "Unités" } } } }).CouchCapsWords.words;
ok(kept.Units && kept.Units.fr === "Unités" && kept["Add to the TV"].de === "Zum Fernseher hinzufügen", "the widget settings words stay, Matter's are added");

// 4. a device described in the TV's language
function described(lang) {
  const win = load({ I18N: { lang: () => lang } }, ["matter-words.js", "matter.js"]);
  const devices = [
    { id: "matter:1:1", name: "Lounge lamp", domain: "light", state: "on", attributes: {} },
    { id: "matter:2:1", name: "Blind", domain: "cover", state: "closed", attributes: { current_position: 0 } },
    { id: "matter:3:1", name: "Door", domain: "sensor", state: "on", attributes: { device_class: "contact", reading: "open" } },
    { id: "matter:3:2", name: "Window", domain: "sensor", state: "off", attributes: { device_class: "contact" } },
    { id: "matter:4:1", name: "Hall", domain: "sensor", state: "on", attributes: { device_class: "occupancy" } },
    { id: "matter:5:1", name: "Temp", domain: "sensor", state: "22.4", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
    { id: "matter:6:1", name: "Heat", domain: "climate", state: "off", attributes: { current_temperature: 19 } },
    { id: "matter:7:1", name: "Fan", domain: "fan", state: "unavailable", attributes: {} }
  ];
  win.CouchMatter.use(() => Promise.resolve({ devices, ready: true }));
  return new Promise((r) => setTimeout(() => r(win.CouchMatter.list().map((d) => d.words)), 20));
}
(async () => {
  const de = await described("de");
  ok(JSON.stringify(de) === JSON.stringify(["Lampe, an", "Rollo, zu", "Sensor, offen", "Sensor, zu", "Sensor, jemand da", "Sensor, 22.4 °C", "Thermostat, 19°, aus", "Ventilator, antwortet nicht"]), "German: " + JSON.stringify(de));
  const enW = await described("en");
  ok(JSON.stringify(enW) === JSON.stringify(["Light, on", "Blind, closed", "Sensor, open", "Sensor, closed", "Sensor, someone there", "Sensor, 22.4 °C", "Thermostat, 19°, off", "Fan, not answering"]), "English: " + JSON.stringify(enW));
  const zh = await described("zh-CN");
  ok(zh[0] === "灯，开" && zh[7] === "风扇，无响应", "Chinese, with its own comma: " + JSON.stringify(zh.slice(0, 2)));

  // 5. no English line left in app.js's Matter section (nl-remote's test_tv_words_cover.mjs pattern)
  const flagged = [];
  for (const m of appSec.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const s = m[1];
    if (!/^(Couch TV Studio|[A-Z])[\w']*[ ,.:]/.test(s) || s.split(" ").length < 2 || /[<>{}=]|\.js|\.png|https?:/.test(s)) continue;
    if (s === "Smart home") continue;   // the crumb: the Smart home screen's own name, already a tw_ line on nl-remote
    flagged.push(s);
  }
  ok(flagged.length === 0, "no English line in app.js's Matter section: " + flagged.join(" | "));

  // 6. with nl-remote's phone-words.js: the card's lines swapped to French
  let pw = null, cw = null;
  try {
    pw = execFileSync("git", ["-C", ROOT, "show", "nl-remote:tv-home/web/phone-words.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    cw = execFileSync("git", ["-C", ROOT, "show", "nl-remote:tv-home/web/caps-words.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { /* no such branch here */ }
  if (!pw) console.log("SKIP 6: no nl-remote branch");
  else {
    const store = { "couchtv.phone.lang": "fr" };
    const doc = { documentElement: { getAttribute() { return null; }, setAttribute() {} }, addEventListener() {}, body: null, title: "" };
    const win = load({ localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, navigator: { language: "en", languages: ["en"] }, location: { search: "", hash: "" }, document: doc },
      [{ src: "var localStorage = window.localStorage, navigator = window.navigator, location = window.location, document = window.document;" + cw }, { src: "var localStorage = window.localStorage, navigator = window.navigator, location = window.location, document = window.document;" + pw }, "matter-words.js"]);
    ok(win.PhoneWords && win.PhoneWords.lang() === "fr", "phone-words.js runs, in French");
    const fr = lines.filter((t) => brands.indexOf(t) < 0).map((t) => [t, win.PhoneWords.words(t)]);
    const notSwapped = fr.filter((p) => !p[1] || p[1] === p[0]);
    ok(notSwapped.length === 0, "every card line swapped by phone-words.js: " + notSwapped.map((p) => p[0]).join(" | "));
    ok(win.PhoneWords.words("2. Paste the code here") === "2. Collez le code ici" && win.CouchMatterWords.t("rename") === "Renommer", "the page's own HTML and the card's messages both in French");
  }
  console.log("ok " + n + " Matter words checks");
})().catch((e) => { console.error(e); process.exit(1); });
