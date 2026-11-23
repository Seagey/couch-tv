// Guests from a bookings calendar (tv-home/web/athome.js staysOf, stayNow, guestName), the way guest-tv
// reads an Airbnb link: one event per stay, the house's own check in and check out times, a name typed
// on the TV winning over one in the calendar, the host's blocked days left out, and Booking.com's
// "CLOSED - Not available" read as a stay. Also the Welcome widget's design options.
// Run: node tests/test_guest_stays.js
process.env.TZ = "Australia/Sydney";
const assert = require("assert");
const path = require("path");
const A = require(path.join(__dirname, "../tv-home/web/athome.js"));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running guest stay tests...");

const at = (s) => new Date(s).getTime();
function ics(events) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb Inc//Hosting Calendar//EN"].concat(events.map((e) =>
    ["BEGIN:VEVENT", "DTSTART;VALUE=DATE:" + e[0], "DTEND;VALUE=DATE:" + e[1], "SUMMARY:" + e[2], "UID:" + e[0] + "@test", "END:VEVENT"].join("\r\n")), ["END:VCALENDAR"]).join("\r\n");
}
const FROM = at("2026-10-15T00:00:00+11:00"), TO = FROM + 100 * 86400000;
const airbnb = A.parseIcs(ics([
  ["20261120", "20261123", "Reserved"],
  ["20261125", "20261126", "Airbnb (Not available)"],
  ["20261128", "20261201", "Reserved"]
]), FROM, TO, 200);

// 1. names from event titles
eq(A.guestName("Reserved"), "", "Airbnb's Reserved has no name");
eq(A.guestName("Airbnb (Not available)"), "", "a blocked day has no name");
eq(A.guestName("CLOSED - Not available"), "", "Booking.com has no name");
eq(A.guestName("Reserved - Sarah Smith"), "Sarah", "VRBO style");
eq(A.guestName("Sarah Smith (HM2AB3CD4E)"), "Sarah", "a booking code is not a name");
eq(A.guestName("Stay: Sarah"), "Sarah");
eq(A.guestName("Guests: the Nguyens"), "Nguyens");
eq(A.guestName("José"), "José", "accents kept");
eq(A.guestName("4 guests"), "", "a number is not a name");
eq(A.guestWord("  sarah-jane  smith "), "Sarah-jane", "first name only");
eq(A.guestWord("https://x.example"), "", "never a link");

// 2. the stays: blocked days out, a typed name wins
{
  const s = A.staysOf(airbnb, { names: { "2026-11-28": "Tom" } });
  eq(s.length, 2, "two stays, the blocked day is not a guest");
  eq(s.map((x) => [x.key, x.nights, x.guest, x.typed]), [["2026-11-20", 3, "", false], ["2026-11-28", 3, "Tom", true]]);
}
// Booking.com writes every booking as CLOSED - Not available
{
  const b = A.parseIcs(ics([["20261120", "20261122", "CLOSED - Not available"]]), FROM, TO, 200);
  eq(A.staysOf(b, { host: "admin.booking.com" }).length, 1, "a Booking.com booking is a stay");
  eq(A.staysOf(b, { host: "www.airbnb.com.au" }).length, 0, "the same words from Airbnb are a blocked day");
}
// a family calendar: only events that say they are a stay
{
  const f = A.parseIcs(ics([["20261120", "20261121", "Mum's birthday"], ["20261121", "20261124", "Stay: Grandma"]]), FROM, TO, 200);
  eq(A.staysOf(f, { family: true }).map((x) => x.guest), ["Grandma"], "a birthday is not a stay");
}

// 3. where the house is in a stay
const opts = { checkin: "14:00", checkout: "10:00", names: { "2026-11-20": "Sarah" } };
{
  const v = A.stayNow(airbnb, at("2026-11-19T12:00:00+11:00"), opts);
  eq([v.phase, v.guest], ["before", "Sarah"], "the day before: before");
  eq(v.checkin, at("2026-11-20T14:00:00+11:00"), "check in at the house's time");
}
eq(A.stayNow(airbnb, at("2026-11-20T09:00:00+11:00"), opts).phase, "arrival", "check in day, before check in");
{
  const v = A.stayNow(airbnb, at("2026-11-21T20:00:00+11:00"), opts);
  eq([v.phase, v.night, v.nights], ["during", 2, 3], "night two of three");
  eq(v.checkout, at("2026-11-23T10:00:00+11:00"), "check out at the house's time");
  eq(v.next && v.next.key, "2026-11-28", "the next stay is known");
}
eq(A.stayNow(airbnb, at("2026-11-23T08:00:00+11:00"), opts).phase, "lastday", "check out day, before check out");
{
  const v = A.stayNow(airbnb, at("2026-11-23T11:00:00+11:00"), opts);
  eq(v.phase, "between", "after check out: between stays");
  eq(v.guest, "", "no name between stays");
  eq(v.next.key, "2026-11-28", "the next stay, for typing its name");
}
eq(A.stayNow(airbnb, at("2026-11-23T09:30:00+11:00"), { checkout: "99:00" }).phase, "lastday", "a time not on the list is the 10am default");

// 4. the record keeps only what it may
{
  const r = A.clean({ stay: { url: "https://www.airbnb.com.au/calendar/ical/123.ics?s=abc", checkin: "15:00", checkout: "07:00",
    names: { "2026-11-20": "Sarah Smith", "bad": "x", "2026-11-28": "12345" }, extra: 1 } });
  eq(r.stay, { url: "https://www.airbnb.com.au/calendar/ical/123.ics?s=abc", checkin: "15:00", names: { "2026-11-20": "Sarah" } });
  eq(A.clean({ stay: { url: "http://x.example/a.ics" } }).stay, undefined, "http is refused, so nothing is kept");
}

// 4b. names from booking emails (the home computer's /api/stay-names, as guest-tv reads them): matched
// by arrival day; a typed name still wins
{
  const mail = [{ arrives: "11-20", guest: "Priya", guests: 2 }, { arrives: "11-28", guest: "Liam", guests: 4 }];
  const s = A.staysOf(airbnb, { mail, names: { "2026-11-28": "Tom" } });
  eq(s.map((x) => [x.guest, x.guests]), [["Priya", 2], ["Tom", 4]], "email name by arrival day, typed name wins");
  eq(A.stayNow(airbnb, at("2026-11-21T20:00:00+11:00"), { mail }).guest, "Priya", "Welcome, Priya with no typing");
  eq(A.staysOf(airbnb, { mail: [{ arrives: "11-20", guest: "https://x.example" }] })[0].guest, "", "never a link from an email");
}

// 5. the design: Welcome takes source and times, never a name, link or time
{
  const fs = require("fs"), vm = require("vm"), noop = () => {};
  const sb = { location: { search: "", origin: "http://tv" }, innerWidth: 1920, innerHeight: 1080,
    document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop } };
  sb.window = sb; sb.addEventListener = noop;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../tv-home/web/design.js"), "utf8"), sb);
  const san = (o) => JSON.parse(JSON.stringify(sb.CouchDesign.sanitize({ objects: [o] }))).objects || [];
  const o = san({ id: "w1", type: "widget", kind: "welcome", x: 10, y: 10, w: 400, h: 200,
    opts: { text: "Welcome", source: "calendar", times: false, guest: "Sarah", url: "https://x.example/a.ics", checkout: "10:00" } })[0];
  eq(o.opts, { text: "Welcome", source: "calendar", times: false }, "only the allowed options, never a name, link or time");
  ok(!san({ id: "w1", type: "widget", kind: "welcome", opts: { source: "email" } })[0].opts, "an unknown source is dropped");
}

console.log("Guest stay tests passed: " + n + " checks.");
