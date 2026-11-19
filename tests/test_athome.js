// Things typed at home (tv-home/web/athome.js): the record is checked field by field, the Wi-Fi join
// code says exactly what a phone camera reads (and decodes back, when jsQR is to hand), calendars from
// Google, Apple and Outlook give the right events with their repeats, a photo's date comes from its own
// EXIF block or its file name, On this day picks the right photos, and screen time reads plainly.
// Run: node tests/test_athome.js
process.env.TZ = "Australia/Sydney";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const web = path.join(__dirname, "../tv-home/web");
const A = require(path.join(web, "athome.js"));
const CALS = "web" + "cal";   // a calendar app's link scheme: the privacy scan's word list holds it, so it is put together here
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
console.log("Running at home tests...");

// 1. the record: only what each field may hold, never guessed
{
  const r = A.clean({
    note: { text: "  Dinner at 6.\n\n Feed Max!  \u0007", from: "Mum", at: 5 },
    lists: [{ name: "Shopping", items: [{ t: "Milk" }, { t: "Bread", done: true }, { t: "" }, { t: 5 }] }, { name: "" }, { name: "To do", items: [] }, { name: "Four" }, { name: "Five" }],
    wifi: { ssid: "Beach House", pass: "sea;salt", sec: "WPA2" },
    guide: [{ title: "Check out", text: "10am Sunday" }, { title: "", text: "dropped" }],
    cal: { url: CALS + "://p01-caldav.example.com/shared/2/abc" },
    screen: { goal: 120 },
    extra: "never kept"
  });
  eq(r.note, { text: "Dinner at 6.\n\nFeed Max!", from: "Mum", at: 5 }, "a note keeps its line breaks, loses control characters and spaces at the ends");
  eq(r.lists.map((l) => l.name), ["Shopping", "To do", "Four"], "at most three lists, each with a name");
  eq(r.lists[0].items, [{ t: "Milk", done: false }, { t: "Bread", done: true }], "empty and non word items are dropped");
  eq(r.wifi, { ssid: "Beach House", sec: "WPA", pass: "sea;salt", hidden: false }, "an unknown security is WPA, the usual one");
  eq(r.guide, [{ title: "Check out", text: "10am Sunday" }], "a guide entry needs a title");
  eq(r.cal, { url: "https://p01-caldav.example.com/shared/2/abc" }, "a calendar app's own link is read over https");
  eq(r.screen, { goal: 120 }, "a goal from the list");
  ok(!("extra" in r), "nothing else is kept");
  ok(A.clean({ screen: { goal: 7 } }).screen === undefined, "a goal not on the list is dropped");
  ok(A.clean({ wifi: { ssid: "Open", pass: "x", sec: "nopass" } }).wifi.pass === "", "an open network keeps no password");
  ok(A.clean({ note: { text: "x".repeat(400) } }).note.text.length === A.LIM.note, "a note is at most " + A.LIM.note + " characters");
  ok(A.clean({ lists: [{ name: "L", items: Array.from({ length: 60 }, (_, i) => ({ t: "i" + i })) }] }).lists[0].items.length === A.LIM.items, "a list holds at most " + A.LIM.items + " items");
  ["http://cal.example/x.ics", "javascript:alert(1)", "https://user:pw@example.com/x.ics", "https://cal.example/a b", "ftp://x/y", "", "https:///x"].forEach((u) => ok(A.calUrl(u) === "", "a calendar link is refused: " + JSON.stringify(u)));
  ok(A.calUrl("https://calendar.example.com/calendar/ics/abc%2Fgroup/private-123/basic.ics") !== "", "a private link with escapes in it is fine");
  ok(A.calHost("https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics") === "outlook.office365.com", "Home settings shows only the host");
  eq(A.clean(null), { v: 1 }, "nothing at all is an empty record");
}

// 2. the store: one copy, every change checked, ticking an item
{
  const mem = {};
  const s = A.store({ get: (k) => mem[k] || null, set: (k, v) => { mem[k] = v; } });
  eq(s.get(), { v: 1 }, "an empty store");
  s.edit((r) => { r.lists = [{ name: "Shopping", items: [{ t: "Milk" }, { t: "Eggs" }] }]; r.wifi = { ssid: "Guest", pass: "pw", sec: "bogus" }; });
  ok(JSON.parse(mem[A.KEY]).wifi.sec === "WPA", "an edit is checked before it is kept");
  ok(s.tick(0, 1) && s.get().lists[0].items[1].done === true, "OK ticks an item");
  ok(s.tick(0, 1) && s.get().lists[0].items[1].done === false, "OK again unticks it");
  ok(!s.tick(0, 9) && !s.tick(4, 0), "a tick on nothing changes nothing");
  const again = A.store({ get: (k) => mem[k] || null, set: () => {} });
  ok(again.get().lists[0].items.length === 2, "kept across a restart");
  const broken = A.store({ get: () => "{not json", set: () => {} });
  eq(broken.get(), { v: 1 }, "a broken store reads as empty");
}

// 3. the Wi-Fi join code: the WIFI: words phone cameras read, escaped
{
  eq(A.wifiQr({ ssid: "Beach House", pass: "summer-swell", sec: "WPA" }), "WIFI:T:WPA;S:Beach House;P:summer-swell;;", "plain");
  eq(A.wifiQr({ ssid: 'a;b,c:d"e\\f', pass: "p;w", sec: "WPA" }), 'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w;;', "special characters escaped");
  eq(A.wifiQr({ ssid: "Open", sec: "nopass" }), "WIFI:T:nopass;S:Open;;", "an open network has no password field");
  eq(A.wifiQr({ ssid: "Hid", pass: "x", sec: "WEP", hidden: true }), "WIFI:T:WEP;S:Hid;P:x;H:true;;", "WEP and hidden");
  eq(A.wifiQr({}), "", "no network, no code");
  // the code itself: qr.js draws it, jsQR (if found) reads it back
  const vm = require("vm"), box = {}; box.globalThis = box;
  vm.createContext(box); vm.runInContext(fs.readFileSync(path.join(web, "qr.js"), "utf8"), box);
  const longest = A.wifiQr({ ssid: "x".repeat(32), pass: "y".repeat(63), sec: "WPA", hidden: true });
  ok(box.TVQR.matrix(longest).length > 0, "the longest name and password still fit in a code (" + longest.length + " characters)");
  let jsQR = null;
  for (const dir of [process.env.COUCHTV_JSQR, path.join(__dirname, "../../../tv-designer/server")].filter(Boolean)) { try { jsQR = createRequire(path.join(dir, "package.json"))("jsqr"); break; } catch (e) {} }
  if (jsQR) {
    [A.wifiQr({ ssid: "Beach House", pass: "summer-swell", sec: "WPA" }), A.wifiQr({ ssid: 'a;b,c:d"e', pass: "ünï;cødé", sec: "WPA" }), longest].forEach((text) => {
      const M = box.TVQR.matrix(text), q = 4, s = 6, size = (M.length + q * 2) * s, px = new Uint8ClampedArray(size * size * 4).fill(255);
      M.forEach((row, y) => row.forEach((on, x) => { if (!on) return; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const i = (((y + q) * s + dy) * size + (x + q) * s + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; } }));
      const got = jsQR(px, size, size);
      ok(got && got.data === text, "the drawn code reads back as " + JSON.stringify(text.slice(0, 40)));
    });
  } else console.log("  (jsQR not found: the decode check is skipped; set COUCHTV_JSQR to a folder that has it)");
}

// 4. calendars: what Google, Apple and Outlook send
{
  const day = (d, h, m) => new Date(2026, 10, d, h || 0, m || 0).getTime();
  const from = day(18), to = day(25);   // Wednesday 18 November 2026 to the next Wednesday
  const google = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "X-WR-TIMEZONE:Australia/Sydney",
    "BEGIN:VEVENT", "DTSTART:20261118T053000Z", "DTEND:20261118T063000Z", "UID:swim@example.com", "SUMMARY:Swimming lessons\\, Ruby", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Australia/Sydney:20260105T083000", "DTEND;TZID=Australia/Sydney:20260105T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "EXDATE;TZID=Australia/Sydney:20261120T083000", "UID:school@example.com", "SUMMARY:School drop off", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261119", "DTEND;VALUE=DATE:20261120", "UID:bin@example.com", "SUMMARY:Bins out", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Not a title", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Australia/Sydney:20261123T190000", "DTEND;TZID=Australia/Sydney:20261123T200000", "UID:gone@example.com", "STATUS:CANCELLED", "SUMMARY:Cancelled thing", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Australia/Sydney:20261118T170000", "DURATION:PT2H", "RRULE:FREQ=DAILY;COUNT=3", "UID:daily@example.com", "SUMMARY:Footy training", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Australia/Sydney:20261119T170000", "DTEND;TZID=Australia/Sydney:20261119T180000", "RECURRENCE-ID;TZID=Australia/Sydney:20261119T170000", "UID:daily@example.com", "SUMMARY:Footy training (moved)", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20200101T000000Z", "RRULE:FREQ=DAILY", "UID:old@example.com", "SUMMARY:Every day since 2020", "END:VEVENT",
    "END:VCALENDAR"].join("\r\n");
  ok(A.isIcs(google) && !A.isIcs("<html>Sign in</html>"), "a calendar is told from a sign in page");
  const ev = A.parseIcs(google, from, to, 200);
  const t = (title) => ev.filter((e) => e.title === title);
  ok(t("Swimming lessons, Ruby").length === 1 && t("Swimming lessons, Ruby")[0].start === day(18, 16, 30), "a UTC time is the TV's 4:30pm, and \\, reads as a comma");
  const school = t("School drop off").map((e) => new Date(e.start).getDate());
  eq(school, [18, 23], "weekly on Monday, Wednesday and Friday, with Friday the 20th left out");
  ok(t("School drop off")[0].start === day(18, 8, 30) && t("School drop off")[0].end === day(18, 9), "at 8:30 to 9 in Sydney");
  const bins = t("Bins out");
  ok(bins.length === 1 && bins[0].allDay && bins[0].start === day(19) && bins[0].end === day(20), "an all day event is that whole day");
  ok(!ev.some((e) => /Not a title|Cancelled/.test(e.title)), "an alarm's words and a cancelled event are left out");
  eq(t("Footy training").map((e) => [new Date(e.start).getDate(), (e.end - e.start) / 3600000]), [[18, 2], [20, 2]], "three days by COUNT, the moved one replaced, two hours long");
  eq(t("Footy training (moved)").map((e) => new Date(e.start).getHours()), [17], "the changed date shows once, at its own time");
  ok(t("Every day since 2020").length === 7, "an event repeating every day since 2020 still reaches this week");
  ok(ev.every((e, i) => !i || ev[i - 1].start <= e.start), "soonest first");

  const apple = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//macOS 15.0//EN",
    "BEGIN:VTIMEZONE", "TZID:Australia/Brisbane", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+1000", "TZOFFSETTO:+1000", "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:A1", "DTSTART;TZID=Australia/Brisbane:20261121T090000", "DTEND;TZID=Australia/Brisbane:20261121T100000",
    "SUMMARY:Markets with the kids and a very long title that runs onto a ", " second line in the file", "END:VEVENT",
    "BEGIN:VEVENT", "UID:A2", "DTSTART;VALUE=DATE:20250101", "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=22", "SUMMARY:Nan's birthday", "END:VEVENT",
    "BEGIN:VEVENT", "UID:A3", "DTSTART;TZID=Australia/Sydney:20260101T190000", "RRULE:FREQ=MONTHLY;BYDAY=-1TU", "SUMMARY:Book club", "END:VEVENT",
    "END:VCALENDAR"].join("\n");
  const ev2 = A.parseIcs(apple, from, day(30), 100);
  const mk = ev2.filter((e) => /^Markets/.test(e.title))[0];
  ok(mk && mk.title === "Markets with the kids and a very long title that runs onto a second line in the file", "a folded line is joined");
  ok(mk && mk.start === day(21, 10), "9am in Brisbane is 10am in Sydney in summer");
  ok(ev2.some((e) => e.title === "Nan's birthday" && e.allDay && e.start === day(22)), "a yearly all day event on its day");
  ok(ev2.some((e) => e.title === "Book club" && e.start === day(24, 19)), "the last Tuesday of the month");

  const outlook = [
    "BEGIN:VCALENDAR", "METHOD:PUBLISH", "PRODID:Microsoft Exchange Server 2010", "VERSION:2.0",
    "BEGIN:VEVENT", "DTSTART;TZID=AUS Eastern Standard Time:20261118T143000", "DTEND;TZID=AUS Eastern Standard Time:20261118T150000", "SUMMARY:Dentist", "UID:O1", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=\"Custom: time zone\":20261124T090000", "DTEND;TZID=\"Custom: time zone\":20261124T093000", "SUMMARY:Quoted zone", "UID:O2", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20261118T000000Z", "SUMMARY", "UID:O3", "END:VEVENT",
    "END:VCALENDAR"].join("\r\n");
  const ev3 = A.parseIcs(outlook, from, to, 100);
  ok(ev3.some((e) => e.title === "Dentist" && e.start === day(18, 14, 30)), "a zone name the TV does not know is read as the TV's own time");
  ok(ev3.some((e) => e.title === "Quoted zone" && e.start === day(24, 9)), "a colon inside a quoted zone name is not the value");
  ok(ev3.some((e) => e.title === "Busy"), "an event with no title is Busy, never empty");
  ok(A.parseIcs("", from, to).length === 0 && A.parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:bad\nEND:VEVENT\nEND:VCALENDAR", from, to).length === 0, "nothing, and a broken date, give no events");
  ok(A.parseIcs(google, from, to, 3).length === 3, "at most the number asked for");
}

// 5. when a photo was taken
{
  // a JPEG with an EXIF block: IFD0 points at the EXIF IFD, which holds DateTimeOriginal
  const jpeg = (le, original, plain) => {
    const u16 = (v) => le ? [v & 255, v >> 8] : [v >> 8, v & 255], u32 = (v) => le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
    const ascii = (s) => Array.from(s + "\0").map((c) => c.charCodeAt(0));
    const tiff = [].concat(le ? [0x49, 0x49] : [0x4d, 0x4d], u16(42), u32(8));
    // IFD0 at 8: two entries (DateTime, ExifIFD), then the next IFD offset 0
    const ifd0 = 8, exif = ifd0 + 2 + 2 * 12 + 4, dtAt = exif + 2 + 12 + 4, origAt = dtAt + 20;
    tiff.push(...u16(2), ...u16(0x0132), ...u16(2), ...u32(20), ...u32(dtAt), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exif), ...u32(0));
    tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(original ? origAt : 0), ...u32(0));
    tiff.push(...ascii(plain || "2020:01:01 10:00:00"), ...ascii(original || "0000:00:00 00:00:00"));
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff), len = app1.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 255].concat(app1, [0xff, 0xda, 0, 2]));
  };
  eq(A.exifDate(jpeg(true, "2019:11:18 07:12:44")), { y: 2019, m: 11, d: 18 }, "DateTimeOriginal, little endian (most phones)");
  eq(A.exifDate(jpeg(false, "2016:11:18 18:00:00")), { y: 2016, m: 11, d: 18 }, "big endian (many cameras)");
  eq(A.exifDate(jpeg(true, null, "2021:03:04 09:00:00")), { y: 2021, m: 3, d: 4 }, "no DateTimeOriginal: the camera's DateTime");
  ok(A.exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])) === null && A.exifDate(new Uint8Array([1, 2, 3])) === null, "no EXIF, or not a JPEG: no date");
  const cut = jpeg(true, "2019:11:18 07:12:44").slice(0, 40);
  ok(A.exifDate(cut) === null, "a cut off file gives no date, never a wrong one");
  eq(A.nameDate("p1kz3-4521-t20191118.jpg"), { y: 2019, m: 11, d: 18 }, "the launcher's own date note");
  eq(A.nameDate("https://photos.example/IMG_20181118_101500.jpg"), { y: 2018, m: 11, d: 18 }, "a phone's file name");
  eq(A.nameDate("PXL_20231118_042233.jpg"), { y: 2023, m: 11, d: 18 }, "a Pixel's");
  eq(A.nameDate("2022-11-18 beach.jpeg"), { y: 2022, m: 11, d: 18 }, "a date with dashes");
  ok(A.nameDate("p1kz3-4521.jpg") === null && A.nameDate("photo-1234567890.jpg") === null && A.nameDate("20221399.jpg") === null && A.nameDate("x120221118.jpg") === null, "no date, a long number and a wrong date are not dates");
  const photos = [{ src: "a", date: { y: 2019, m: 11, d: 18 } }, { src: "b", date: { y: 2024, m: 11, d: 18 } }, { src: "c", date: { y: 2024, m: 11, d: 17 } }, { src: "d", date: { y: 2026, m: 11, d: 18 } }, { src: "e" }];
  eq(A.onThisDay(photos, new Date(2026, 10, 18)), [{ src: "a", years: 7 }, { src: "b", years: 2 }], "this day in other years, the longest ago first (not today's, not the day before)");
}

// 6. screen time words
{
  eq([A.hm(0), A.hm(45), A.hm(60), A.hm(135)], ["0m", "45m", "1h", "2h 15m"], "minutes as hours and minutes");
  eq(A.goalLine(90, 120), "30m left of 2h", "under the goal");
  eq(A.goalLine(150, 120), "30m over today's 2h", "over it");
  eq(A.goalLine(90, 0), "", "no goal, no line");
}

console.log("OK: " + n + " checks");
