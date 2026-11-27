// Shabbat times (shabbat.js, Home settings, Weather): Hebcal's answer -> one display-only card, the link
// built from the weather's own place, and app.js wiring (off unless switched on, drawn as plain text).
// node tests/test_shabbat.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "tv-home", "web");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(web, "shabbat.js"), "utf8"), sandbox);
const SH = sandbox.window.Shabbat;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

console.log("Running Shabbat times tests...");

// Hebcal's real answer for Allenhurst, NJ (trimmed): Friday 27 November 2026
const allenhurst = {
  title: "Hebcal 40°14′N 74°0′W America/New_York November 2026",
  location: { tzid: "America/New_York", latitude: 40.237, longitude: -74.0018 },
  items: [
    { title: "Candle lighting: 4:13pm", date: "2026-11-27T16:13:00-05:00", category: "candles", memo: "Parashat Vayishlach" },
    { title: "Parashat Vayishlach", date: "2026-11-28", category: "parashat", hebrew: "פרשת וישלח" },
    { title: "Havdalah: 5:16pm", date: "2026-11-28T17:16:00-05:00", category: "havdalah" }
  ]
};

// the card
eq(JSON.parse(JSON.stringify(SH.card(allenhurst, false))),
  { title: "Candle lighting", value: "4:13 pm", subtitle: "Havdalah 5:16 pm · Parashat Vayishlach", kind: "shabbat" }, "12 hour card");
eq(SH.card(allenhurst, true).value, "16:13", "24 hour clock");
eq(SH.card(allenhurst, true).subtitle, "Havdalah 17:16 · Parashat Vayishlach", "24 hour havdalah");
const he = SH.card(allenhurst, false, { candles: "הדלקת נרות", havdalah: "הבדלה {time}" });
eq(he.title, "הדלקת נרות", "words in the home's language");
ok(he.subtitle.startsWith("הבדלה 5:16 pm"), "havdalah in the home's language");

// times read from Hebcal's own string: the town's time, not the TV's zone
eq(SH.clockOf("2026-11-27T00:05:00-05:00", false), "12:05 am", "midnight hour");
eq(SH.clockOf("2026-11-27T12:30:00-05:00", false), "12:30 pm", "noon hour");
eq(SH.clockOf("nonsense", false), "", "not a time");

// a Yom Tov week with no parsha: the holiday names the week
const yomTov = { items: [
  { title: "Candle lighting: 6:40pm", date: "2026-09-11T18:40:00-04:00", category: "candles" },
  { title: "Rosh Hashana 5787", date: "2026-09-12", category: "holiday", subcat: "major" },
  { title: "Havdalah: 7:45pm", date: "2026-09-13T19:45:00-04:00", category: "havdalah" }
] };
eq(SH.card(yomTov, false).subtitle, "Havdalah 7:45 pm · Rosh Hashana 5787", "holiday instead of parsha");

// bad or empty answers: no card, so the home keeps the last good one
ok(SH.card(null, false) === null, "null");
ok(SH.card({}, false) === null, "no items");
ok(SH.card({ items: [{ category: "parashat", title: "Parashat Noach" }] }, false) === null, "no candle lighting, no card");
ok(SH.parse("not json", false) === null, "not JSON");
ok(SH.parse("x".repeat(300000), false) === null, "too big");
ok(SH.parse(JSON.stringify(allenhurst), false).value === "4:13 pm", "parse");

// display only: what comes back is plain capped text with no link and no app
const evil = { items: [
  { title: "x", date: "2026-11-27T16:13:00-05:00", category: "candles" },
  { title: "<img src=x onerror=alert(1)>" + "P".repeat(200), date: "2026-11-28", category: "parashat" }
] };
const c = SH.card(evil, false);
ok(c.subtitle.length <= 60, "subtitle capped");
ok(!("url" in c) && !("app" in c) && !("image" in c), "no link, app or picture");

// Shabbat itself: candle lighting to havdalah, as times
const sp = SH.span(allenhurst, false);
eq(sp.from, Date.parse("2026-11-27T16:13:00-05:00"), "from candle lighting");
eq(sp.to, Date.parse("2026-11-28T17:16:00-05:00"), "to havdalah");
eq(sp.havdalah, "5:16 pm", "havdalah words");
ok(SH.during(sp, Date.parse("2026-11-27T20:00:00-05:00")), "Friday night is Shabbat");
ok(SH.during(sp, Date.parse("2026-11-28T17:15:00-05:00")), "a minute before havdalah");
ok(!SH.during(sp, Date.parse("2026-11-28T17:16:00-05:00")), "havdalah ends it");
ok(!SH.during(sp, Date.parse("2026-11-27T16:12:00-05:00")), "not before candle lighting");
ok(!SH.during(null, Date.now()), "no span, no Shabbat");
ok(SH.span({ items: [allenhurst.items[0]] }, false) === null, "no havdalah, no span");
ok(SH.span({ items: [{ category: "candles", date: "2026-11-27T16:13:00-05:00" }, { category: "havdalah", date: "2026-12-05T17:16:00-05:00" }] }, false) === null, "a span too long is not believed");
ok(SH.span({ items: [{ category: "candles", date: "2026-11-27 16:13" }, { category: "havdalah", date: "2026-11-28T17:16:00-05:00" }] }, false) === null, "no offset, no span");

// the link: the weather's own place, rounded, havdalah on, 18 minutes, the time zone checked
eq(SH.url({ lat: 40.237, lon: -74.0018, timezone: "America/New_York" }),
  "https://www.hebcal.com/shabbat?cfg=json&latitude=40.237&longitude=-74.0018&M=on&tzid=America%2FNew_York&b=18", "link");
eq(SH.url({ lat: 40.237, lon: -74.0018, timezone: "auto" }),
  "https://www.hebcal.com/shabbat?cfg=json&latitude=40.237&longitude=-74.0018&M=on&b=18", "auto zone: Hebcal works it out");
ok(!SH.url({ lat: 1, lon: 2, timezone: "x&y=1" }).includes("tzid"), "an odd zone is left out");
eq(SH.url(null), "", "no place");
eq(SH.url({ lat: "a", lon: 2 }), "", "no numbers");
eq(SH.url({ lat: 95, lon: 2 }), "", "off the map");
ok(SH.url({ lat: 31.78, lon: 35.22, timezone: "Asia/Jerusalem" }, { candleMinutes: 40, israel: true }).includes("&b=40&i=on"), "Jerusalem's 40 minutes");

// app.js: off unless chosen, fetched only while on, the card drawn like custom cards (textContent)
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
ok(app.includes('SHAB_ON = typeof ST.shabbat === "boolean" ? ST.shabbat : HOME.shabbat === true;'), "off unless chosen");
ok(/var src = SHAB_ON && WXCFG \? SH\.url\(WXCFG\) : "";/.test(app), "asks only while on, for the weather's place");
ok(app.includes('if (SHAB_ON) setTimeout(startShabbat, 1800);'), "starts with the home only when on");
ok(app.includes('key: "wx-shabbat", label: t("shabbat_show")'), "the switch in Home settings, Weather");
ok(app.includes('var list = (SHAB_ON && SHAB_CARD ? [SHAB_CARD] : []).concat(CUSTOM)'), "first in the row, before the household's cards");
ok(app.includes('SHAB_LOOK = typeof ST.shabbat_look === "boolean" ? ST.shabbat_look : HOME.shabbat_look !== false;'), "the look comes with the times unless switched off");
ok(app.includes('var on = !!(SHAB_ON && SHAB_LOOK && window.Shabbat && window.Shabbat.during(SHAB_SPAN, Date.now()));'), "the look only on Shabbat");
ok(app.includes('document.documentElement.classList.toggle("shabbat-mode", on);'), "html.shabbat-mode");
ok(app.includes('if (w && w.textContent !== words) w.textContent = words;'), "the greeting is plain text");
ok(app.includes('key: "wx-shabbat-look", label: t("shabbat_look")'), "the look's own switch");
const css = fs.readFileSync(path.join(web, "app.css"), "utf8");
ok(/\.shabbat-glow \{ display: none;/.test(css) && /\.shabbat-greet \{ display: none; \}/.test(css), "nothing shows outside Shabbat");
ok(css.includes("html.lighter .sg-c::before { animation: none; }"), "still flames under Lighter home");
const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
ok(html.includes('id="shabbat-greet"') && html.includes('id="shabbat-glow"'), "the greeting and the glow are on the page");
ok(html.indexOf('<script src="shabbat.js"></script>') > 0 && html.indexOf('<script src="shabbat.js"></script>') < html.indexOf('<script src="app.js"'), "loaded before app.js");

// the words, in all 17 languages
const i18n = fs.readFileSync(path.join(web, "i18n.js"), "utf8");
for (const k of ["shabbat_show", "shabbat_show_sub", "shabbat_candles", "shabbat_havdalah", "shabbat_shalom", "shabbat_look", "shabbat_look_sub"]) {
  ok((i18n.match(new RegExp("^    " + k + ": ", "mg")) || []).length === 17, k + " in every language");
}
ok(i18n.includes("Hebcal.com"), "Hebcal credited (CC BY 4.0)");

console.log("Shabbat times tests passed (" + n + " checks).");
