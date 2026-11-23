// The bedside StandBy weather on a real TV (tv-home/web/widgets.js), drawn in node on a small fake DOM:
// at night the icon is a night sky (worked out when it is drawn, not when the weather was fetched),
// and from 6pm the line under the number is tomorrow's, found by its date.
// Run: node tests/test_standby_weather.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fakeDocument, fixedDate } = require("./fake-dom");

const web = path.join(__dirname, "../tv-home/web");
const D = fixedDate(Date);
const sandbox = { document: fakeDocument(), Date: D, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "widgets.js"), "utf8"), sandbox);
const W = sandbox.window.CouchWidgets;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const text = (el) => el.textContent;
const draw = (o, env) => W.render(o, env);

console.log("Running StandBy weather tests...");
// ---------------- 2. StandBy weather ----------------
const bigtemp = { id: "temp", type: "widget", kind: "bigtemp", size: "4x5", w: 360, h: 460 };
const card = { id: "wx", type: "widget", kind: "weather", size: "medium", w: 460, h: 460 };
const hourly = { id: "hr", type: "widget", kind: "hourly", size: "wide", w: 900, h: 460 };
const pad = (x) => ("0" + x).slice(-2);
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const iso = (d, h, m) => ymd(d) + "T" + pad(h) + ":" + pad(m || 0);
function forecast(at, isDay) {
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const day = (k) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
  return {
    temp: 19, code: 0, is_day: isDay, hi: 27, lo: 17,
    hourly: [0, 1, 2, 3].map((k) => { const t = new Date(at.getTime() + k * 3600000); return { time: iso(t, t.getHours()), temp: 19 - k, code: 0 }; }),
    daily: [0, 1, 2].map((k) => ({ date: ymd(day(k)), code: [0, 95, 61][k], hi: [27, 25, 22][k], lo: [17, 18, 17][k], sunrise: iso(day(k), 5, 41), sunset: iso(day(k), 19, 22) }))
  };
}
const icons = (el) => el.all().filter((e) => e.tagName === "SPAN").length;   // (no icon set in node: icons are blank spans)
// the icon name the widget asked for: read through wxIcon with the same inputs
const kit = W.kit;

// 9pm, with a reading fetched at 5:50pm that still says day
const nine = new Date(2026, 10, 18, 21, 0);
D.set(nine);
let wx = kit.weather({ demo: false, data: { weather: forecast(nine, true) } });
ok(wx.is_day === false, "9pm: night, though the reading fetched at 5:50pm said day");
ok(kit.wxIcon(wx.code, wx.is_day) === "clear-night", "9pm, clear: the night icon, not the sun");
ok(kit.wxIcon(2, false) === "partly-cloudy-night" && kit.wxIcon(2, true) === "partly-cloudy", "partly cloudy at night: the moon behind the cloud, never the sun");
// the night icon ships with the home (icon-sets.js, a copy of tools/tv-designer/icons/icon-sets.js) in every style
const TVIcons = require(path.join(web, "icon-sets.js"));
["line", "solid", "duotone", "tile", "glass", "playful"].forEach((s) => {
  const night = TVIcons.svg(s, "partly-cloudy-night", 40, "#fff"), day = TVIcons.svg(s, "partly-cloudy", 40, "#fff");
  ok(/^<svg/.test(night) && night !== day, "partly cloudy night draws in the " + s + " style, unlike the day one");
});
ok(wx.ahead && wx.ahead.label === "Tomorrow" && wx.ahead.code === 95 && wx.ahead.hi === 25, "9pm: the day ahead is tomorrow (storms, top of 25)");
ok(wx.hourly.every((h) => h[3] === true), "9pm to midnight: every hour is a night hour");
el = draw(bigtemp, { demo: false, data: { weather: forecast(nine, true) } });
ok(/Tomorrow, top of 25°/.test(text(el)) && /Storms/.test(text(el)) && !/top of 27/.test(text(el)), "StandBy at 9pm: tomorrow's sky and top, not today's");
el = draw(card, { demo: false, data: { weather: forecast(nine, true) } });
ok(/Tomorrow H:25° L:18°/.test(text(el)), "the weather card at 9pm: tomorrow's high and low");

// a forecast fetched yesterday evening, read at 1am: "today" is found by date, not by position
const one = new Date(2026, 10, 19, 1, 0);
D.set(one);
const stale = forecast(new Date(2026, 10, 18, 20, 0), false);
wx = kit.weather({ demo: false, data: { weather: stale } });
ok(wx.is_day === false && !wx.ahead, "1am: night, and the day ahead is today (no Tomorrow line)");
ok(wx.daily[0][0] !== "Today" && wx.daily[1][0] === "Today", "1am on a forecast from last night: Today is the 19th, not the 18th");

// 10am: day, today's own words, the sun
const ten = new Date(2026, 10, 18, 10, 0);
D.set(ten);
wx = kit.weather({ demo: false, data: { weather: forecast(ten, false) } });
ok(wx.is_day === true && !wx.ahead && kit.wxIcon(wx.code, wx.is_day) === "sun", "10am: day and the sun, though the reading said night");
el = draw(bigtemp, { demo: false, data: { weather: forecast(ten, true) } });
ok(/Clear, top of 27°|Clear/.test(text(el)) && !/Tomorrow/.test(text(el)), "StandBy at 10am: today");

// with the town's place, its own sunrise and sunset decide (no forecast needed)
D.set(new Date(2026, 10, 18, 22, 0));
wx = kit.weather({ demo: false, data: { place: { name: "Town", lat: -28.8, lon: 153.4 }, weather: { temp: 18, code: 1, is_day: true } } });
ok(wx.is_day === false, "10pm with the town's place: night, from its own sunset");
// the designer's demo looks ahead too
D.set(new Date(2026, 10, 18, 20, 0));
wx = kit.weather({ demo: true, data: {} });
ok(wx.is_day === false && wx.ahead && wx.ahead.label === "Tomorrow", "designer demo at 8pm: night, and tomorrow");
void icons; void hourly;

console.log("All " + n + " StandBy weather tests passed.");
