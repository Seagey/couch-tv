// Countdown to a day that moves each year (0.13.10, widget audit item 15): the design carries a rule
// (easter, mothers_day, fathers_day, fathers_day_june) and the TV works out the next date itself, every
// year, so a design sent once keeps counting to the right Sunday. Checked on the real widgets.js in node
// (the fake DOM), design.js's gate and widget-caps.js's setting.
// School holidays are not here: no school holiday dates are in couch-tv's code to read them from.
// Run: node tests/test_countdown_rules.js   (it sets TZ=Australia/Sydney itself)
process.env.TZ = "Australia/Sydney";
const assert = require("assert");
const K = require("./web-widgets-kit");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running countdown rule tests...");
const txt = (el) => String(el.textContent || "").replace(/\s+/g, " ").trim();

// 1. Easter: known dates (Western church), 2024 to 2035 and two far years
const T = K.home(new Date(2026, 10, 23, 10, 0).getTime());
const W = T.W;
const EASTER = { 2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2029: [4, 1], 2030: [4, 21], 2031: [4, 13], 2032: [3, 28], 2033: [4, 17], 2034: [4, 9], 2035: [3, 25], 2000: [4, 23], 2038: [4, 25] };
for (const y of Object.keys(EASTER)) ok(JSON.stringify(W.easter(+y)) === JSON.stringify(EASTER[y]), "Easter " + y + " is " + EASTER[y].join("/") + " (" + W.easter(+y).join("/") + ")");

// 2. the next one from today: 23 November 2026, so every rule is in 2027
const next = (rule) => { const d = W.ruleDay(rule); return d && d.year + "-" + d.month + "-" + d.day; };
ok(next("easter") === "2027-3-28", "next Easter from November 2026: 28 March 2027 (" + next("easter") + ")");
ok(next("mothers_day") === "2027-5-9", "Mother's Day 2027: Sunday 9 May (" + next("mothers_day") + ")");
ok(next("fathers_day") === "2027-9-5", "Father's Day 2027 in Australia: Sunday 5 September (" + next("fathers_day") + ")");
ok(next("fathers_day_june") === "2027-6-20", "Father's Day 2027, third Sunday in June: 20 June (" + next("fathers_day_june") + ")");
ok(W.ruleDay("date") === null && W.ruleDay(undefined) === null && W.ruleDay("toString") === null, "no rule, or a made up one: the day and month as before");
for (const y of [2026, 2027, 2028, 2029, 2030]) {
  const T2 = K.home(new Date(y, 0, 1, 9, 0).getTime());
  [["mothers_day", 5], ["fathers_day", 9], ["fathers_day_june", 6]].forEach(([r, m]) => {
    const d = T2.W.ruleDay(r), at = new Date(d.year, d.month - 1, d.day);
    ok(d.year === y && d.month === m && at.getDay() === 0, r + " " + y + ": a Sunday in month " + m + " (" + d.day + ")");
  });
}

// 3. on the day itself it is today; the day after, next year's
const onDay = K.home(new Date(2027, 2, 28, 8, 0).getTime());
ok(onDay.W.ruleDay("easter").year === 2027, "on Easter Sunday itself: today");
const dayAfter = K.home(new Date(2027, 2, 29, 8, 0).getTime());
ok(JSON.stringify(dayAfter.W.ruleDay("easter")) === JSON.stringify({ month: 4, day: 16, year: 2028 }), "the day after: next year's Easter, 16 April 2028");

// 4. the widget draws it: the right number, and day and month are not used (the fake DOM cannot measure
// words, so the name and the line under the number are checked in a real browser, not here)
const draw = (TT, opts) => txt(TT.W.render({ kind: "countdown", id: "c", w: 760, h: 360, opts }, {}));
const before = K.home(new Date(2027, 2, 21, 9, 0).getTime());
let t = draw(before, { rule: "easter", day: 25, month: 12, unit: "days" });
ok(/^7\b/.test(t), "a week before Easter, with 25 December still in the design: 7 days (" + t + ")");
t = draw(before, { rule: "mothers_day", unit: "weeks" });
ok(/^7\b/.test(t), "Mother's Day, 9 May, in weeks: 7 (" + t + ")");
t = draw(onDay, { rule: "easter" });
ok(!/\d/.test(t), "on the day: no number (It's today!) (" + t + ")");
t = draw(before, { rule: "date", day: 25, month: 12, unit: "days" });
ok(/^279\b/.test(t), "the day and month as before: 279 days to Christmas (" + t + ")");

// 5. the design keeps the rule, and only a known one; the setting is there for Couch TV Studio and the TV
const CD = K.design();
ok(K.kept(CD, "countdown", { rule: "easter" }).rule === "easter", "design.js keeps rule: easter");
ok(K.kept(CD, "countdown", { rule: "school_holidays" }).rule === undefined && K.kept(CD, "countdown", { rule: "https://x" }).rule === undefined, "an unknown rule is dropped");
const s = T.C.settings("countdown").find((x) => x.key === "rule");
ok(s && s.store === "design" && s.where.indexOf("studio") >= 0 && s.where.indexOf("tv") >= 0, "Counts to: a design setting, in Studio and on the TV");
ok(JSON.stringify(s.options.map((o) => o[0])) === JSON.stringify(["date", "easter", "mothers_day", "fathers_day", "fathers_day_june"]), "its choices match the TV's rules");

console.log("OK: " + n + " countdown rule checks");
