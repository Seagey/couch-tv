// The app catalogue (tv-home/web/app-catalogue.js) and apps by id in a design: the catalogue's shape
// (the contract couch-tv Studio builds against), the Australian and Indian apps first, packages that are
// marked verified really are in couch-tv's own tables, a design's apps are sanitised to catalogue ids
// (an old design's package names become ids, anything else is dropped), and a TV turns each id into
// the app it has, or a dimmed "Not on this TV" place.
// Run: node tests/test_app_catalogue.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fakeDocument } = require("./fake-dom");

const web = path.join(__dirname, "../tv-home/web");
const { APP_CATALOGUE: C, CouchApps: A } = require(path.join(web, "app-catalogue.js"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running app catalogue tests...");

// 1. shape
ok(typeof C.version === "number" && Array.isArray(C.groups) && C.groups.length > 3 && Array.isArray(C.apps), "version, groups and apps");
ok(C.apps.length >= 80 && C.apps.length <= 120, "80 to 120 apps (" + C.apps.length + ")");
const ids = C.apps.map((x) => x.id);
ok(new Set(ids).size === ids.length, "every id is different");
C.apps.forEach((x) => {
  ok(/^[a-z0-9]{2,20}$/.test(x.id) && typeof x.name === "string" && x.name.length > 0, x.id + ": id and name");
  ok(C.groups.indexOf(x.group) >= 0, x.id + ": group is one of groups");
  ok(Array.isArray(x.regions) && x.regions.length > 0 && x.regions.every((r) => /^[A-Z]{2}$/.test(r)), x.id + ": regions are country codes");
  const p = x.packages;
  ok(p && Array.isArray(p.android) && Array.isArray(p.fire) && ["samsung", "lg", "roku"].every((k) => typeof p[k] === "string"), x.id + ": packages { android: [], fire: [], samsung, lg, roku }");
  ok(Array.isArray(x.names) && typeof x.verified === "boolean" && /^#[0-9a-f]{6}$/i.test(x.colour), x.id + ": names, verified, colour");
  ok(x.icon === "" || (/^app-icons\/[a-z0-9]+\.png$/.test(x.icon) && fs.existsSync(path.join(web, x.icon))), x.id + ": icon is a file under app-icons/ or empty");
  ok(p.android.length + p.fire.length + (p.samsung ? 1 : 0) + (p.lg ? 1 : 0) + (p.roku ? 1 : 0) + x.names.length > 0, x.id + ": some way to find it on a TV");
});
["netflix", "youtube", "prime", "disney", "stan", "binge", "kayo", "iview", "sbs", "7plus", "9now", "10play", "foxtel", "paramount", "appletv", "spotify", "youtubemusic",
  "hotstar", "jiocinema", "sonyliv", "zee5", "mxplayer", "hoichoi", "aha", "sunnxt"].forEach((id) => ok(!!A.get(id), "has " + id));
ok(C.apps.slice(0, 20).every((x) => x.regions.indexOf("AU") >= 0 || x.regions.indexOf("IN") >= 0), "Australian and Indian apps come first");
// verified means couch-tv's own tables have every package
const tables = fs.readFileSync(path.join(__dirname, "../bridge/apps.py"), "utf8") + fs.readFileSync(path.join(web, "app.js"), "utf8");
C.apps.filter((x) => x.verified).forEach((x) => [].concat(x.packages.android, x.packages.fire).forEach((p) => ok(tables.indexOf('"' + p + '"') >= 0, x.id + ": verified package " + p + " is in couch-tv's tables")));
ok(C.apps.some((x) => !x.verified), "apps not yet seen on a TV say so");

// 2. helpers
ok(A.idOf("com.netflix.ninja") === "netflix" && A.idOf("au.net.abc.iview") === "iview" && A.idOf("nope") === null && A.idOf("__proto__") === null, "idOf maps packages to ids");
ok(A.get("__proto__") === null && A.get("constructor") === null, "no prototype keys");
ok(A.resolve("netflix", [{ package: "com.netflix.ninja", name: "Netflix" }]).package === "com.netflix.ninja", "resolve by package");
ok(A.resolve("hotstar", [{ package: "some.other.build", name: "JioHotstar" }]).package === "some.other.build", "resolve by name when the package differs");
ok(A.resolve("stan", [{ package: "com.netflix.ninja", name: "Netflix" }]) === null, "not installed: null");

// 3. a design's apps: ids kept, old package names mapped, anything else dropped
const noop = () => {};
const sb = { location: { search: "", origin: "http://tv" }, document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop }, innerWidth: 1920, innerHeight: 1080 };
sb.window = sb; sb.addEventListener = noop;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(web, "app-catalogue.js"), "utf8"), sb);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), sb);
const san = (opts, kind) => (JSON.parse(JSON.stringify(sb.window.CouchDesign.sanitize({ objects: [{ id: "f", type: "widget", kind: kind || "folder", opts }] }))).objects[0].opts || {}).apps;
ok(JSON.stringify(san({ apps: ["netflix", "stan", "iview"] })) === '["netflix","stan","iview"]', "catalogue ids are kept");
ok(JSON.stringify(san({ apps: ["com.netflix.ninja", "au.net.abc.iview", "com.unknown.app", "gear", "__proto__", "http://x", "kayo"] })) === '["netflix","iview","kayo"]', "old package names become ids; unknown, Settings, links and prototype keys go");
ok(san({ apps: ids.slice(0, 30) }).length === 16, "at most 16 in a container");
["dock", "appgrid", "app", "games"].forEach((k) => ok(JSON.stringify(san({ apps: ["com.disney.disneyplus"] }, k)) === '["disney"]', k + " takes ids too"));

// 4. on a TV: ids become installed packages; missing apps are dimmed places; changes on the TV win
const wsb = { document: fakeDocument(), setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console };
wsb.window = wsb;
vm.createContext(wsb);
vm.runInContext(fs.readFileSync(path.join(web, "app-catalogue.js"), "utf8"), wsb);
vm.runInContext(fs.readFileSync(path.join(web, "widgets.js"), "utf8"), wsb);
const W = wsb.window.CouchWidgets;
const have = [{ package: "com.netflix.ninja", name: "Netflix" }, { package: "au.com.stan.and", name: "Stan" }, { package: "com.example.radio", name: "Radio" }, { package: "gear", name: "Settings" }];
const folder = { id: "f1", type: "widget", kind: "folder", w: 560, h: 560, opts: { label: "Watch", apps: ["netflix", "iview", "stan"] } };
const tv = { data: { apps: have } };
let el = W.render(folder, tv);
const acts = el.all().filter((e) => e.getAttribute("data-slot") !== null).map((e) => e.getAttribute("data-act") + ":" + e.getAttribute("data-arg") + ":" + e.getAttribute("data-slot"));
ok(JSON.stringify(acts) === JSON.stringify(["app:com.netflix.ninja:0", "missing:iview:1", "app:au.com.stan.and:2"]), "a TV opens installed apps by their package, and marks the rest Not on this TV (" + acts.join(", ") + ")");
ok(/Not on this TV/.test(el.textContent), "the missing one says Not on this TV");
ok(JSON.stringify(W.appKeys(folder, tv)) === '["netflix","iview","stan"]', "appKeys: the container's apps as design keys");
// with edits (env.edits, kept on the TV by design.js) and room for one more: an Add app place
const edited = { data: { apps: have }, edits: (id, kind) => (id === "f1" && kind === "folder" ? ["stan", "com.example.radio"] : null) };
el = W.render(folder, edited);
const acts2 = el.all().filter((e) => e.getAttribute("data-slot") !== null).map((e) => e.getAttribute("data-act") + ":" + e.getAttribute("data-slot"));
ok(JSON.stringify(acts2) === JSON.stringify(["app:0", "app:1", "addapp:add"]), "the TV's own changes win, an app not in the catalogue works, and an Add app place follows (" + acts2.join(", ") + ")");
ok(JSON.stringify(W.appKeys(folder, edited)) === '["stan","com.example.radio"]', "appKeys follows the changes");
const emptied = { data: { apps: have }, edits: () => [] };
el = W.render(folder, emptied);
ok(el.all().filter((e) => e.getAttribute("data-act") === "app").length === 0 && el.all().some((e) => e.getAttribute("data-act") === "addapp"), "emptied on the TV: stays empty with an Add app place, not every app");
// the designer: ids as they are, with the catalogue's names; no Add app place
el = W.render(folder, { designer: true, demo: true, data: {} });
ok(/Netflix/.test(el.textContent) && /ABC iview/.test(el.textContent) && !el.all().some((e) => e.getAttribute("data-act") === "addapp" || e.getAttribute("data-act") === "missing"), "the designer draws the ids by name, nothing dimmed, no Add app");
ok(W.installedApps(tv).map((a) => a.package).indexOf("gear") < 0, "the picker never offers the Settings tile");

console.log("All " + n + " app catalogue tests passed.");
