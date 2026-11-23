// Every English line added to Home settings, the Hold OK sheets and the design banners since 0.13.8
// (tv-home/web/app.js, design.js, design-code.js) has a tw_* line in i18n.js, so tv-words.js shows it in
// the TV's language. A line that is not drawn on the TV, or is drawn by the phone (phone-words.js), is
// named below with the reason. Also: the phone page's words (phone-words.js) cover every error the TV
// sends the phone from those files. Needs git and the v0.13.8 tag; without them the test says so and passes.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
try { execFileSync("git", ["-C", ROOT, "rev-parse", "v0.13.8"], { stdio: "ignore" }); }
catch (e) { console.log("SKIP: no git or no v0.13.8 tag"); process.exit(0); }

const load = (file) => {
  const ctx = { window: {}, localStorage: { getItem() { return null; }, setItem() {} }, navigator: { language: "en" }, document: { documentElement: { setAttribute() {} }, addEventListener() {} } };
  Object.assign(ctx.window, { localStorage: ctx.localStorage, navigator: ctx.navigator, document: ctx.document, addEventListener() {} });
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx);
  return ctx.window;
};
const S = load("tv-home/web/i18n.js").I18N.strings.en;
const TW = Object.keys(S).filter((k) => k.startsWith("tw_")).map((k) => S[k]);
const re = (en) => new RegExp("^" + en.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\w+)\\?\}/g, "(.+?)") + "$");
const PAT = TW.filter((v) => /\{\w+\}/.test(v)).map(re);
// a literal that only starts a line built in code: covered when a pattern starts with it
const covered = (s) => TW.includes(s) || PAT.some((r) => r.test(s)) || TW.some((v) => /\{\w+\}/.test(v) && s.length >= 6 && v.startsWith(s));

// The phone page's lines (the errors the TV sends back to the phone)
const pwSrc = fs.readFileSync(path.join(ROOT, "tv-home/web/phone-words.js"), "utf8");
const PW = [...pwSrc.matchAll(/^    ("(?:[^"\\]|\\.)*"): \{/gm)].map((m) => JSON.parse(m[1]));
const PWPAT = PW.filter((v) => /\{\w+\}/.test(v));
const onPhone = (s) => PW.includes(s) || PWPAT.some((v) => s.length >= 6 && v.startsWith(s));

const NOT_DRAWN = {
  "Home Assistant": "the product's name, inside Connected to {host} when Home Assistant gives no address",
  "Home menu": "a data-name attribute (what the remote's OK opens), not drawn",
  "Photo ": "Photo 1, Photo 2: a choice's name built from the number",
  "Use the design's ": "with a widget setting's own label (widget-caps.js, its words come through caps-words.js)",
  "Clear ": "with a widget setting's own label (widget-caps.js, its words come through caps-words.js)",
  "Check in": "a guest's stay as an Agenda event's title, drawn on the home: its words come through widget-lines.js",
  "Check out": "a guest's stay as an Agenda event's title, drawn on the home: its words come through widget-lines.js",
  "Premier League": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Serie A": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Champions League": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Europa League": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "World Cup": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "UEFA Nations League": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "La Liga": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Ligue 1": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Persian Gulf Pro League": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Coppa Italia": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "Copa del Rey": "a football competition's own name on the scores card (origin/main #299), kept like an app's name",
  "FA Cup": "a football competition's own name on the scores card (origin/main #299), kept like an app's name"
};
const files = ["tv-home/web/app.js", "tv-home/web/design.js", "tv-home/web/design-code.js"];
// The greeting and short line under the clock (origin/main, home.greeting): shown only while the home
// speaks English (greetingOn), so its greetings and lines need no tw_ line. Taken from the GREET block
// up to styleOf, so a new English line anywhere else is still caught.
const appSrc = fs.readFileSync(path.join(ROOT, "tv-home/web/app.js"), "utf8");
const gFrom = appSrc.indexOf("  var GREET = {"), gTo = appSrc.indexOf("  function styleOf(");
ok(gFrom > 0 && gTo > gFrom, "the greeting words are where the test looks for them");
ok(/HOME\.greeting === true && \/\^en\/i\.test\(/.test(appSrc), "the greeting still shows only in English");
const ENGLISH_ONLY = new Set([...appSrc.slice(gFrom, gTo).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
// an SVG path (a quick button's icon), not words
const svgPath = (s) => /^M[\d.]/.test(s);
const left = [];
let seen = 0;
for (const f of files) {
  const diff = execFileSync("git", ["-C", ROOT, "diff", "v0.13.8", "-U0", "--", f], { encoding: "utf8", maxBuffer: 1 << 28 });
  // a line that was in 0.13.8 already, only with the product's old name (couch-tv Studio, Couch TV Studio from
  // 0.13.10), or on a line changed only for that name, is not a new line
  const was = execFileSync("git", ["-C", ROOT, "show", "v0.13.8:" + f], { encoding: "utf8", maxBuffer: 1 << 28 });
  const old = (s) => was.includes('"' + s.replace(/Couch TV Studio/g, "couch-tv Studio") + '"');
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++") || /^\+\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const s = m[1];
      if (!/^(Couch TV Studio|[A-Z])[\w']*[ ,.:]/.test(s) || s.split(" ").length < 2 && !NOT_DRAWN[s] || /[<>{}=]|\.js|\.png|https?:/.test(s)) continue;
      seen++;
      if (covered(s) || onPhone(s) || NOT_DRAWN[s] || ENGLISH_ONLY.has(s) || svgPath(s) || old(s)) continue;
      left.push(f + ": " + s);
    }
  }
}
ok(seen >= 100, "new English lines looked at: " + seen);
ok(left.length === 0, left.length + " new English lines with no tw_ line:\n  " + [...new Set(left)].join("\n  "));
// each reason above is still needed (a line that went away comes off the list)
const all = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
for (const s of Object.keys(NOT_DRAWN)) ok(all.includes('"' + s + '"'), "still in the code: " + s);
// the errors the TV sends to the phone page are in phone-words.js
const errs = [...all.matchAll(/(?:error: |bad = |bad \|\| )"([^"]+)"/g)].map((m) => m[1]).filter((s) => /^[A-Z]/.test(s) && s.split(" ").length > 1);
const noPw = [...new Set(errs)].filter((s) => !onPhone(s));
ok(errs.length >= 12, "errors for the phone looked at: " + errs.length);
ok(noPw.length === 0, "errors the phone page can't show in its language: " + noPw.join(" | "));
console.log("tv words cover: " + n + " checks passed");
