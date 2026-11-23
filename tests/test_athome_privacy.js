// Things typed at home never travel (seagey: Wi-Fi passwords, notes, calendars and house guides must
// never go into a shared design, the gallery, Share this home or the store):
//  1. design.js's gate (sanWidget) drops every option the at home widgets could carry, at the top level
//     and inside a stack: a design can only say "a note goes here", never the note.
//  2. Share this home builds from that gate and sends none of it; and if any of it turns up in a design
//     anyway (a welcome typed with the Wi-Fi name), the private check stops the share.
//  3. app.js keeps them out of Home settings' copy the bridge keeps, hands Share this home's check the
//     words, and stores them through athome.js only.
// Run: node tests/test_athome_privacy.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
const sb = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080, setTimeout, clearTimeout
};
sb.window = sb;
sb.addEventListener = noop;
vm.createContext(sb);
for (const f of ["design.js", "qr.js", "share-home.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
const CD = sb.window.CouchDesign, S = sb.window.CouchShare;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running at home privacy tests...");

const SECRET = { ssid: "SaltAndSun", password: "summer-swell-42", pass: "summer-swell-42", text: "Dinner at six then bath", note: "Feed Max tonight please",
  from: "Granny Smith", items: ["Milk", "Avocados"], url: "https://calendar.example.com/private-abc/basic.ics", ical: "web" + "cal://calendar.example.com/private-abc",
  guide: [{ title: "Door code", text: "Key under the pot" }], lists: [{ name: "Groceries", items: [{ t: "Milk" }] }], wifi: { ssid: "SaltAndSun", pass: "summer-swell-42" },
  cal: { url: "https://calendar.example.com/private-abc/basic.ics" }, events: [{ title: "Dentist" }], photos: ["data:image/jpeg;base64,AAAA"], minutes: 95, goal: 120, apps: ["com.netflix.ninja"] };
const WORDS = ["SaltAndSun", "summer-swell", "Dinner at six", "Feed Max", "Granny", "Avocados", "private-abc", "calendar.example.com", "Key under the pot", "Door code", "Groceries", "Dentist", "base64"];
const KINDS = ["note", "list", "wifi", "guide", "agenda", "memory", "screentime"];

// 1. the gate
const widgets = KINDS.map((k, i) => ({ id: "w" + i, type: "widget", kind: k, x: 80 + i * 10, y: 60, w: 360, h: 360, opts: Object.assign({ label: "Shopping" }, SECRET) }));
widgets.push({ id: "s0", type: "widget", kind: "stack", x: 80, y: 500, w: 360, h: 360, items: KINDS.map((k) => ({ kind: k, opts: SECRET })) });
const clean = CD.sanitize({ v: 1, objects: widgets });
const out = JSON.stringify(clean);
ok(clean.objects.length === KINDS.length + 1, "every widget is kept: a design may place them");
WORDS.forEach((w) => ok(out.indexOf(w) < 0, "the gate drops \"" + w + "\" from every at home widget"));
const listW = clean.objects.filter((o) => o.kind === "list")[0];
ok(listW.opts && listW.opts.label === "Shopping" && Object.keys(listW.opts).every((k) => ["label", "icon", "align"].indexOf(k) >= 0), "a List keeps only which list (a name, words only), its icon and where it sits");
ok(!/4471/.test(JSON.stringify(CD.sanitize({ v: 1, objects: [{ id: "a", type: "widget", kind: "list", x: 0, y: 0, w: 360, h: 360, opts: { label: "Code 4471" } }] }))), "a list name with digits is refused (a design never carries numbers typed as words)");
const WOPT = CD.wopts();
// (days: the Agenda's Today, Today and tomorrow or This week, a fixed choice, never its data)
// ws2-home (0.13.9) added settings a design may carry: note byline, list done, memory range and ago,
// screentime appcount. They are allowed only because the gate turns each into a yes/no or one of a few
// fixed choices, so no household words or numbers can ride in them; this is checked on the gate itself.
// hidepass: the guest Wi-Fi hides its password, a yes or no in the design since 0.13.10 (never the password)
const SAFE_OPTS = { byline: "yes/no", done: "yes/no", ago: "yes/no", hidepass: "yes/no", range: ["day", "week"], appcount: ["auto", 0, 1, 2, 3, 4, 5, 6, 7, 8] };
const PROBES = [true, false, "Dinner at six then bath", "summer-swell-42", "Granny Smith", 95, 120, 4471, -3, 2.5, "week", "day", "auto", 3, null, ["Milk"], { t: "Milk" }];
const kindOf = (o) => KINDS.filter((k) => String(WOPT[k] || "").split(" ").indexOf(o) >= 0)[0];
Object.keys(SAFE_OPTS).forEach((o) => {
  const k = kindOf(o);
  ok(!!k, o + ": an at home widget carries it (" + JSON.stringify(WOPT) + ")");
  const seen = PROBES.map((p) => {
    const c = CD.sanitize({ v: 1, objects: [{ id: "a", type: "widget", kind: k, x: 0, y: 0, w: 360, h: 360, opts: { [o]: p } }] });
    return ((c.objects[0] || {}).opts || {})[o];
  }).filter((v) => v !== undefined);
  const allowed = SAFE_OPTS[o] === "yes/no" ? [true, false] : SAFE_OPTS[o];
  ok(seen.every((v) => allowed.indexOf(v) >= 0), k + "." + o + ": the gate keeps only " + JSON.stringify(allowed) + ", got " + JSON.stringify(seen));
  ok(!seen.some((v) => typeof v === "string" && /Dinner|swell|Granny|Milk/.test(v)) && seen.indexOf(95) < 0 && seen.indexOf(120) < 0 && seen.indexOf(4471) < 0, k + "." + o + ": no household words or numbers get through");
});
KINDS.forEach((k) => ok(String(WOPT[k] || "").split(" ").filter(Boolean).every((o) => ["label", "icon", "align", "days"].concat(Object.keys(SAFE_OPTS)).indexOf(o) >= 0), k + ": the gate allows no option that could hold its data (" + (WOPT[k] || "none") + ")"));

// 2. Share this home
const snap = { scenes: ["night"], builtIn: ["night"], clock24: false, dock: ["com.netflix.ninja"], design: { v: 1, objects: widgets } };
const shared = S.prepare(snap, [], CD);
ok(shared.design && !shared.error, "a home with every at home widget can be shared");
const sharedText = JSON.stringify(shared.design);
WORDS.forEach((w) => ok(sharedText.indexOf(w) < 0, "Share this home sends no \"" + w + "\""));
ok(shared.design.objects.filter((o) => KINDS.indexOf(o.kind) >= 0).length === KINDS.length, "the widgets themselves go (they only say where each one sits)");
// a welcome typed with the Wi-Fi's name: the words the TV keeps stop it
const sneaky = { scenes: ["night"], builtIn: ["night"], dock: [], design: { v: 1, objects: [{ id: "x", type: "widget", kind: "welcome", x: 0, y: 0, w: 760, h: 160, opts: { text: "Welcome to SaltAndSun" } }] } };
const stopped = S.prepare(sneaky, ["SaltAndSun", "summer-swell-42", "Dinner at six then bath"], CD);
ok(stopped.error && /private/.test(stopped.error), "a design holding the Wi-Fi name is not shared (" + stopped.error + ")");

// 3. app.js
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
ok(/w = w\.concat\(ahPrivateWords\(\)\)/.test(app), "Share this home's private words include the note, the Wi-Fi, the guide and the calendar link");
const ah = app.slice(app.indexOf("// ---------------- at home:"), app.indexOf("// the native side calls these"));
ok(ah.length > 1000, "the at home block is found");
ok(!/\bST\.[a-z_]+\s*=|saveSettings\(|keep\(|api\("POST", "\/api\/settings"/.test(ah.replace(/ST\.photos/g, "")), "the at home block never writes Home settings (the copy the bridge keeps) or the page's shared store");
ok(/TV\.keepPrivate/.test(ah) && /AH\.store\.edit|AH\.store\.tick/.test(ah), "it keeps everything through athome.js, in the launcher's private store where there is one");
ok(/CouchAtHome\.calHost\(r\.cal\.url\)/.test(ah) && !/value: r\.cal\.url|sub: r\.cal\.url/.test(ah), "Home settings shows the calendar's host, never the link");
ok(/api\("POST", "\/api\/calendar", \{ url: url \}/.test(ah) && !/api\("GET", "\/api\/calendar/.test(ah), "the link goes to the home computer in a POST body, never in an address");
const kt = fs.readFileSync(path.join(__dirname, "../tv-home/android/app/src/main/res/xml/data_extraction_rules.xml"), "utf8"), kt2 = fs.readFileSync(path.join(__dirname, "../tv-home/android/app/src/main/res/xml/backup_rules.xml"), "utf8");
ok((kt.match(/path="athome\.xml"/g) || []).length === 2 && /path="athome\.xml"/.test(kt2), "the launcher's at home store is in no backup and no device transfer");

console.log("OK: " + n + " checks");
