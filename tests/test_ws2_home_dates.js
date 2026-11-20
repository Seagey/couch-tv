// Home group (ws2-home): the date and edge cases a checker found (21 Nov 2026), each on the real code:
//  1. the bookings calendar's Check in and Check out days end at the next midnight, also on the daylight
//     saving day (Sydney, Sunday 4 October 2026, 23 hours long), never spilling into Monday;
//  2. Shuffle mixes every photo once with no number past 2^53, a new order on different days, spread out;
//  3. a photo picked on this TV past the 50th still shows;
//  4. Guest Wi-Fi hides the password only when there is a code to scan;
//  5. Agenda with every calendar: what was read shows when the other calendar failed;
//  6. Studio's sample Agenda on This week is not "Nothing on this week";
//  7. settings that work at the small sizes too: On this day's how long ago on a tile, the note's From
//     on a tile, the list's ticked items on a wide tile.
// Run: node tests/test_ws2_home_dates.js   (it sets TZ=Australia/Sydney itself)
process.env.TZ = "Australia/Sydney";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const K = require("./web-widgets-kit");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running home group date and edge tests...");
const all = (el) => [el].concat(...(el.childNodes || []).map(all));
const text = (el) => all(el).filter((e) => e.nodeType === 3 || typeof e.data === "string").map((e) => e.data || "").join(" ") || el.textContent || "";
const txt = (el) => (el.textContent !== undefined ? el.textContent : text(el)).replace(/\s+/g, " ").trim();

// ---- 1. booksEvents from app.js, on the daylight saving day ----
{
  ok(new Date(2026, 9, 5).getTime() - new Date(2026, 9, 4).getTime() === 23 * 3600000, "Sydney: Sunday 4 October 2026 is 23 hours long (TZ is set)");
  const src = fs.readFileSync(path.join(__dirname, "../tv-home/web/app.js"), "utf8");
  const m = /\n  function booksEvents\(r\) \{[\s\S]*?\n  \}\n/.exec(src);
  ok(!!m, "app.js has booksEvents");
  const sb = { STAY: { events: [{}], mail: "" }, CouchAtHome: { calHost: () => "", staysOf: () => sb.stays }, stays: [] };
  vm.createContext(sb);
  vm.runInContext(m[0] + "\nthis.booksEvents = booksEvents;", sb);
  const day = (y, mo, d) => new Date(y, mo, d).getTime();
  sb.stays = [{ from: day(2026, 9, 4), to: day(2026, 9, 10), guest: "Tom" }, { from: day(2026, 9, 2), to: day(2026, 9, 4), guest: "Ann" }, { from: day(2027, 3, 4), to: day(2027, 3, 6), guest: "Kim" }];
  const evs = sb.booksEvents({ stay: { url: "https://example.com/b.ics" } });
  const find = (t) => evs.find((e) => e.title === t);
  ok(find("Check in, Tom").end === day(2026, 9, 5), "Check in on the daylight saving day ends at Monday's midnight, not 1 am Monday");
  ok(find("Check out, Ann").end === day(2026, 9, 5), "Check out on the daylight saving day too");
  ok(find("Check out, Tom").end === day(2026, 9, 11), "an ordinary day ends at the next midnight");
  ok(find("Check in, Kim").end === day(2027, 3, 5), "the day summer time ends (25 hours, 4 April 2027) ends at the next midnight");
  ok(evs.every((e) => new Date(e.end).getHours() === 0 && new Date(e.end).getMinutes() === 0), "every day ends at a midnight");
}

// ---- 2. Shuffle ----
const T = K.home(new Date(2026, 10, 21, 10, 0).getTime());
const kit = T.W.kit;
{
  const mixed = kit.mixed;
  ok(typeof mixed === "function", "widgets.js hands its shuffle to the kit");
  const list = Array.from({ length: 40 }, (_, i) => "p" + i);
  const seeds = [0, 1, 20413, 20414, 99999, 2147483646, 2147483647, 1e15, 9007199254740991];
  for (const s of seeds) {
    const o = mixed(list, s);
    ok(o.length === 40 && new Set(o).size === 40 && o.every((x) => list.includes(x)), "seed " + s + ": every photo once, none lost or doubled");
  }
  const today = mixed(list, 20413), tomorrow = mixed(list, 20414);
  ok(JSON.stringify(today) !== JSON.stringify(list) && JSON.stringify(today) !== JSON.stringify(tomorrow), "a mixed order, and another one the next day");
  ok(JSON.stringify(mixed(list, 20413)) === JSON.stringify(today), "the same order all day");
  // spread: over 2000 days, each photo comes first about as often as any other (50 each on average)
  const firsts = {};
  for (let d = 20000; d < 22000; d++) { const f = mixed(list, d)[0]; firsts[f] = (firsts[f] || 0) + 1; }
  const counts = list.map((x) => firsts[x] || 0);
  ok(Math.min(...counts) >= 20 && Math.max(...counts) <= 90, "spread out: each photo first between 20 and 90 times in 2000 days (" + Math.min(...counts) + " to " + Math.max(...counts) + ")");
  // where photo 0 lands, over 2000 days: every place is reached
  const at = new Set(); for (let d = 20000; d < 22000; d++) at.add(mixed(list, d).indexOf("p0"));
  ok(at.size === 40, "photo 1 lands in every one of the 40 places over the days (" + at.size + ")");
}

// ---- 3. a photo picked past the 50th ----
{
  const photos = Array.from({ length: 60 }, (_, i) => "http://photos.example/" + i + ".jpg"), ids = photos.map((_, i) => "id" + i);
  const env = { data: { photos, home: { photoIds: ids } }, wset: { w1: { photo: "id55" } } };
  for (const kind of ["photo", "artframe"]) {
    const css = all(T.W.render({ kind, id: "w1", w: 760, h: 360, opts: {} }, env)).map((e) => (e.style && e.style.cssText) || "").join(" ");
    ok(/photos\.example\/55\.jpg/.test(css) && !/photos\.example\/0\.jpg/.test(css), kind + ": the 56th photo, picked on this TV, shows");
  }
}

// ---- 4. Guest Wi-Fi with no code to scan ----
{
  // no code (here no TVQR, as with a name and password too long for one): the password words always show
  const env = { data: { home: { wifi: { ssid: "salt-and-sun", pass: "summer-swell", sec: "WPA", qr: "WIFI:T:WPA;S:salt-and-sun;P:summer-swell;;" } } }, wset: { f1: { hidepass: true } } };
  const t = txt(T.W.render({ kind: "wifi", id: "f1", w: 760, h: 360 }, env));
  ok(/summer-swell/.test(t) && !/in the code/.test(t), "Hide the password with no code to scan: the password still shows (" + t + ")");
}

// ---- 5. Agenda with every calendar, one failed ----
{
  const t0 = new Date(2026, 10, 21).getTime();
  const env = { data: { home: { cal: { set: true, events: null, err: "The calendar did not answer. Couch TV tries again soon." }, books: { set: true, events: [{ title: "Check in, Tom", start: t0, end: t0 + 86400000, allDay: true }] } } } };
  const t = txt(T.W.render({ kind: "agenda", id: "a", w: 760, h: 360 }, env));
  ok(/Check in, Tom/.test(t) && !/did not answer/.test(t), "the bookings that were read show though the other calendar failed (" + t + ")");
  const both = { data: { home: { cal: { set: true, events: null, err: "The calendar did not answer. Couch TV tries again soon." }, books: { set: true, events: null, err: "" } } } };
  ok(/did not answer/.test(txt(T.W.render({ kind: "agenda", id: "a", w: 760, h: 360 }, both))), "neither read: the error card");
}

// ---- 6. Studio's sample Agenda, This week ----
{
  const t = txt(T.W.render({ kind: "agenda", id: "a", w: 760, h: 760, opts: { days: "week" } }, { demo: true }));
  ok(!/Nothing on/.test(t) && t.length > 20, "Studio's sample on This week shows its events (" + t.slice(0, 80) + ")");
}

// ---- 7. small sizes ----
{
  const mem = { data: { home: { memory: { photos: 4, dated: 3, today: [{ src: "a.jpg", years: 3, year: 2023 }], week: [] } } } };
  const on = txt(T.W.render({ kind: "memory", id: "m", w: 160, h: 160 }, mem)), off = txt(T.W.render({ kind: "memory", id: "m", w: 160, h: 160 }, Object.assign({}, mem, { wset: { m: { ago: false } } })));
  ok(/3/.test(on) && /years ago/.test(on) && off === "2023", "On this day on a tile: how long ago (" + on + "), or off, the year (" + off + ")");
  const one = txt(T.W.render({ kind: "memory", id: "m", w: 160, h: 160 }, { data: { home: { memory: { photos: 1, dated: 1, today: [{ src: "a.jpg", years: 1, year: 2025 }], week: [] } } } }));
  ok(/year ago/.test(one) && !/years/.test(one), "one year: year ago (" + one + ")");
  const wide = txt(T.W.render({ kind: "memory", id: "m", w: 360, h: 160 }, mem));
  ok(/3 years ago/.test(wide), "a wide tile has room for 3 years ago on one line (" + wide + ")");
  const note = { data: { home: { note: { text: "Dinner at 6", from: "Mum" } } } };
  for (const [w, h] of [[160, 160], [360, 160]]) {
    const by = w < 300 ? /Mum/ : /From Mum/;
    ok(by.test(txt(T.W.render({ kind: "note", id: "n", w, h }, note))) && !/Mum/.test(txt(T.W.render({ kind: "note", id: "n", w, h }, Object.assign({}, note, { wset: { n: { byline: false } } })))), "note " + w + "x" + h + ": Show who it is from works (the name alone on a narrow tile)");
  }
  const ld = { data: { home: { lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }, { t: "Bread", done: true }, { t: "Eggs", done: true }] }] } } };
  const lon = txt(T.W.render({ kind: "list", id: "l", w: 360, h: 160 }, ld)), loff = txt(T.W.render({ kind: "list", id: "l", w: 360, h: 160 }, Object.assign({}, ld, { wset: { l: { done: false } } })));
  ok(/2 ticked/.test(lon) && !/ticked/.test(loff) && /1 left/.test(loff), "list on a wide tile: ticked items counted, or off, not (" + lon + " / " + loff + ")");
}
console.log(`${n} home group date and edge tests passed.`);
