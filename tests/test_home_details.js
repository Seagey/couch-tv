// Your home: the household's people and town sent with a design to the account's own TV
// (tv-home/web/design-code.js readHome, mergeHome, photoOf; HOME-DETAILS-PAYLOAD.md). What the TV keeps
// from the store's answer, what it drops, which pack wins, how the account's people sit beside the ones
// added on the TV, and that nothing of it rides inside the design or a shared home.
// Run: node tests/test_home_details.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
function load(answers) {
  const mem = {};
  const sandbox = {
    location: { search: "" },
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    atob: (s) => Buffer.from(s, "base64").toString("latin1"), setTimeout, clearTimeout,
    COUCH_CONFIG: { design_store: "https://designs.example" },
    fetch: () => {
      const a = answers.shift();
      return Promise.resolve({ ok: a.status === 200, status: a.status, headers: { get: () => null }, text: () => Promise.resolve(a.body) });
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sandbox);
  return { C: sandbox.window.CouchDesignCode, mem };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pack = (o) => Object.assign({ v: 1, rev: 7, at: "2026-11-24T05:10:00.000Z", wipe: false,
  people: [
    { id: "p_3k9x2m", name: "Ruby", kids: true, colour: "#E07A5F", photo: JPEG },
    { id: "p_8d1q0z", name: "Alex", kids: false, colour: "#3d5a80", photo: null }
  ],
  town: { name: "Bellingen", lat: -30.4512, lon: 152.8987 } }, o || {});

console.log("Running Your home tests...");
const { C } = load([]);

// ---- 1. readHome: only a checked copy, or nothing ----
let h = plain(C.readHome(pack()));
assert.deepStrictEqual(h.people.map((p) => p.id), ["p_3k9x2m", "p_8d1q0z"], "people in the account's order");
assert.strictEqual(h.people[0].kids, true);
assert.strictEqual(h.people[0].colour, "#e07a5f");
assert.strictEqual(h.people[0].photo, JPEG, "a JPEG data URL is kept");
assert.strictEqual(h.people[1].photo, null);
assert.deepStrictEqual(h.town, { name: "Bellingen", lat: -30.45, lon: 152.9 }, "the town, two decimals: never the house");
assert.strictEqual(h.rev, 7);
for (const bad of [null, "x", [], {}, { v: 1 }, { rev: 1 }, { v: 0, rev: 1 }, { v: 1, rev: -1 }, { v: 1, rev: 1.5 }, { v: "1", rev: 1 }]) {
  assert.strictEqual(C.readHome(bad), null, JSON.stringify(bad));
}
h = plain(C.readHome(pack({ people: [
  { id: "p_ffffff", name: "Huge", photo: "data:image/jpeg;base64,/9j/" + "A".repeat(60000) },
  { id: "ruby", name: "Ruby" },                             // not an account id
  { id: "p_aaaaaa", name: "" },                             // no name
  { id: "p_bbbbbb", name: "x".repeat(25) },                 // too long
  { id: "p_cccccc", name: " <b>Sam</b>\u0007 ", photo: "https://evil.example/a.jpg", colour: "red" },
  { id: "p_cccccc", name: "Twice" },                        // the same id again
  { id: "p_dddddd", name: "Png", photo: PNG },
  { id: "p_eeeeee", name: "Fake", photo: "data:image/jpeg;base64,iVBORw0KGgo=" }
] })));
assert.deepStrictEqual(h.people.map((p) => p.name), ["Huge", "bSam/b", "Png", "Fake"], "bad ids, names and repeats are dropped; marks cleaned");
assert.strictEqual(C.readHome(pack({ people: [{ id: "p_abc", name: "Short id" }] })).people.length, 0, "an id too short");
assert.ok(h.people.every((p) => p.photo === null && p.colour === null), "only a small real JPEG is a photo; only #rrggbb is a colour");
h = plain(C.readHome(pack({ people: Array.from({ length: 12 }, (_, i) => ({ id: "p_person" + i, name: "N" + i })) })));
assert.strictEqual(h.people.length, 8, "eight people at most");
for (const town of [{ name: "", lat: 1, lon: 1 }, { name: "X", lat: 91, lon: 1 }, { name: "X", lat: "1", lon: 1 }, { name: "X", lat: 1, lon: NaN }, { name: "x".repeat(41), lat: 1, lon: 1 }, "Bellingen"]) {
  assert.ok(!("town" in plain(C.readHome(pack({ town }))) ), "a bad town is left out: " + JSON.stringify(town));
}
h = plain(C.readHome(pack({ people: undefined, town: undefined })));
assert.ok(!("people" in h) && !("town" in h), "absent stays absent (leave the TV's alone)");
assert.deepStrictEqual(plain(C.readHome(pack({ people: [] }))).people, [], "an empty list is kept: the account has no people now");
h = plain(C.readHome({ v: 1, rev: 9, wipe: true, people: [{ id: "p_aaaaaa", name: "A" }], town: { name: "X", lat: 1, lon: 1 } }));
assert.deepStrictEqual(h, { v: 1, rev: 9, at: "", wipe: true }, "a wipe applies nothing else");
h = plain(C.readHome(Object.assign(pack(), { v: 2, wipe: true, extra: { a: 1 } })));
assert.ok(!h.wipe && h.people.length === 2 && h.town && !("extra" in h), "a newer format: people and town only");

// ---- 2. mergeHome: the account wins, the TV's own people stay after, a wipe takes only the account's ----
const tvList = [{ id: "mum", name: "Mum" }, { id: "ruby", name: "ruby" }, { id: "nan", name: "Nan", kid: true }];
let r = plain(C.mergeHome({ people: tvList, place: { name: "Hobart", area: "", lat: -42.88, lon: 147.33 }, account: null }, C.readHome(pack())));
assert.deepStrictEqual(r.people.map((p) => p.id), ["p_3k9x2m", "p_8d1q0z", "mum", "nan"], "account first, then the TV's own; the TV's Ruby is the account's Ruby");
assert.deepStrictEqual(r.people[0], { id: "p_3k9x2m", name: "Ruby", src: "account", kid: true, colour: "#e07a5f" }, "marked, kids flag, colour; never the photo");
assert.ok(!("kid" in r.people[1]));
assert.ok(!JSON.stringify(r.people).includes("base64"), "photos never go in the people list (it is handed to the bridge)");
assert.deepStrictEqual(r.place, { name: "Bellingen", area: "", lat: -30.45, lon: 152.9, timezone: "auto", src: "account" }, "the town replaces the TV's, marked");
assert.strictEqual(r.account.rev, 7);
assert.strictEqual(C.photoOf(r.account, "p_3k9x2m"), JPEG, "the photo stays in the account record");
assert.strictEqual(C.photoOf(r.account, "p_8d1q0z"), "");
assert.strictEqual(C.photoOf(r.account, "mum"), "");
assert.strictEqual(C.photoOf({ people: [{ id: "x", photo: "https://evil.example/a.jpg" }] }, "x"), "", "a stored photo is checked again");

// renamed on the TV: the next pack wins; someone dropped from the account goes, with the photo
const afterRename = r.people.map((p) => (p.id === "p_3k9x2m" ? Object.assign({}, p, { name: "Roo" }) : p));
r = plain(C.mergeHome({ people: afterRename, place: r.place, account: r.account }, C.readHome(pack({ rev: 8, people: [{ id: "p_3k9x2m", name: "Ruby", kids: true }] }))));
assert.deepStrictEqual(r.people.map((p) => p.name), ["Ruby", "Mum", "Nan"], "the account wins over a rename here; Alex left the account");
assert.strictEqual(C.photoOf(r.account, "p_3k9x2m"), "", "no photo now: the initial again");

// an older pack (a code typed late) changes nothing
assert.strictEqual(C.mergeHome({ people: r.people, account: r.account }, C.readHome(pack({ rev: 6 }))), null);
assert.ok(C.mergeHome({ people: r.people, account: r.account }, C.readHome(pack({ rev: 8 }))), "the same rev again is fine (Update my TVs now)");

// people absent: the TV's people alone; town absent: the TV's town alone
const kept = { people: [{ id: "mum", name: "Mum" }, { id: "p_3k9x2m", name: "Ruby", src: "account" }], place: { name: "Hobart", lat: -42.88, lon: 147.33 }, account: { rev: 3, people: [{ id: "p_3k9x2m", name: "Ruby", photo: JPEG }], town: null } };
r = plain(C.mergeHome(kept, C.readHome(pack({ rev: 4, people: undefined, town: undefined }))));
assert.deepStrictEqual(r.people, kept.people);
assert.strictEqual(r.place.name, "Hobart");
assert.strictEqual(C.photoOf(r.account, "p_3k9x2m"), JPEG, "people absent keeps the photos it had");
// an empty list: the account's people go, the TV's stay
r = plain(C.mergeHome(kept, C.readHome(pack({ rev: 4, people: [], town: undefined }))));
assert.deepStrictEqual(r.people.map((p) => p.id), ["mum"]);
// a person who lost the mark on the way through a bridge is still the account's (p_ ids are only theirs)
r = plain(C.mergeHome({ people: [{ id: "p_zzzzzz", name: "Old" }, { id: "mum", name: "Mum" }], account: null }, C.readHome(pack({ people: [] }))));
assert.deepStrictEqual(r.people.map((p) => p.id), ["mum"]);

// wipe: only what came from the account, the town only if it is still the account's
r = plain(C.mergeHome({ people: [{ id: "mum", name: "Mum" }, { id: "p_3k9x2m", name: "Ruby", src: "account" }], place: { name: "Bellingen", lat: -30.45, lon: 152.9, src: "account" }, account: { rev: 7, people: [{ id: "p_3k9x2m", photo: JPEG }] } },
  C.readHome({ v: 1, rev: 8, wipe: true })));
assert.deepStrictEqual(r.people, [{ id: "mum", name: "Mum" }]);
assert.strictEqual(r.place, null, "the account's town goes");
assert.deepStrictEqual(r.account.people, [], "and the photos");
r = plain(C.mergeHome({ people: [], place: { name: "Hobart", lat: -42.88, lon: 147.33 }, account: null }, C.readHome({ v: 1, rev: 8, wipe: true })));
assert.strictEqual(r.place.name, "Hobart", "a town picked on the TV stays");
// at most 12 on the TV, the account's first
r = plain(C.mergeHome({ people: Array.from({ length: 12 }, (_, i) => ({ id: "t" + i, name: "T" + i })) }, C.readHome(pack())));
assert.strictEqual(r.people.length, 12);
assert.strictEqual(r.people[0].id, "p_3k9x2m");

// ---- guest Wi-Fi (added 24 Nov 2026): kept where At home keeps it, the account's while unchanged ----
assert.deepStrictEqual(plain(C.readHome(pack({ wifi: { name: "Beach house guest", password: "correct horse battery" } }))).wifi, { name: "Beach house guest", password: "correct horse battery" });
assert.deepStrictEqual(plain(C.readHome(pack({ wifi: { name: "Open", password: "" } }))).wifi, { name: "Open", password: "" }, "an open network");
assert.strictEqual(plain(C.readHome(pack({ wifi: null }))).wifi, null, "null: the account cleared it");
for (const wifi of [{ name: "", password: "x" }, { name: "x".repeat(33), password: "" }, { name: "A", password: "p".repeat(64) }, { name: "A" }, { name: "A", password: "a\nb" }, "A", []]) {
  assert.ok(!("wifi" in plain(C.readHome(pack({ wifi })))), "a bad Wi-Fi is left out: " + JSON.stringify(wifi));
}
assert.ok(!("wifi" in plain(C.readHome(Object.assign(pack(), { v: 2, wifi: { name: "A", password: "" } })))), "a newer format: no Wi-Fi");
r = plain(C.mergeHome({ people: [], wifi: null, account: null }, C.readHome(pack({ wifi: { name: "Beach house guest", password: "correct horse battery" } }))));
assert.deepStrictEqual(r.wifi, { ssid: "Beach house guest", sec: "WPA", pass: "correct horse battery", hidden: false });
assert.ok(C.wifiFromAccount(r.account, r.wifi), "marked by being what the account sent");
const acc1 = r.account;
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Beach house guest", sec: "WEP", pass: "old", hidden: true }, account: null }, C.readHome(pack({ wifi: { name: "Beach house guest", password: "new pass" } }))));
assert.deepStrictEqual(r.wifi, { ssid: "Beach house guest", sec: "WEP", pass: "new pass", hidden: true }, "the same network keeps its security and hidden switch");
r = plain(C.mergeHome({ people: [], wifi: null, account: null }, C.readHome(pack({ wifi: { name: "Open", password: "" } }))));
assert.strictEqual(r.wifi.sec, "nopass");
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Beach house guest", sec: "WPA", pass: "correct horse battery" }, account: acc1 }, C.readHome(pack({ rev: 8 }))));
assert.ok(!("wifi" in r) && r.account.wifi.name === "Beach house guest", "absent: the TV's Wi-Fi alone, the mark kept");
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Beach house guest", sec: "WPA", pass: "correct horse battery" }, account: acc1 }, C.readHome(pack({ rev: 8, wifi: null }))));
assert.ok("wifi" in r && r.wifi === null && r.account.wifi === null, "null: the account's Wi-Fi goes");
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Beach house guest", sec: "WPA", pass: "changed on the TV" }, account: acc1 }, C.readHome(pack({ rev: 8, wifi: null }))));
assert.ok(!("wifi" in r), "changed on the TV: it is the TV's own and stays");
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Beach house guest", sec: "WPA", pass: "correct horse battery" }, account: acc1 }, C.readHome({ v: 1, rev: 9, wipe: true })));
assert.ok("wifi" in r && r.wifi === null, "a wipe takes the account's Wi-Fi");
r = plain(C.mergeHome({ people: [], wifi: { ssid: "Home", sec: "WPA", pass: "x" }, account: acc1 }, C.readHome({ v: 1, rev: 9, wipe: true })));
assert.ok(!("wifi" in r), "and leaves the TV's own");

assert.ok(C.fromAccount({ id: "x", src: "account" }) && C.fromAccount({ id: "p_aaaaaa" }) && !C.fromAccount({ id: "p-bob" }) && !C.fromAccount({ id: "mum" }));

// ---- 3. get(): kept once the design is good; the design never holds it; a bad design keeps nothing ----
(async () => {
  const design = { v: 1, home: { scenes: ["sky"] } };
  let t = load([{ status: 200, body: JSON.stringify({ design, expires: "x", home: pack() }) }]);
  const d = await t.C.get("ABCDE-FGHJK");
  assert.deepStrictEqual(plain(d), design, "the design is only the design (its own look settings, never the pack)");
  assert.ok(!t.mem["couchtv.design.fetched"].includes("Ruby"), "the kept design has no names");
  assert.ok(!t.C.accept(JSON.stringify({ design, home: pack() })).people, "accept never reads home");
  const held = plain(t.C.takeHome(true));
  assert.strictEqual(held.people[0].photo, JPEG, "held until the home takes it");
  assert.strictEqual(plain(t.C.takeHome()).rev, 7);
  assert.strictEqual(t.C.takeHome(), null, "taken once");

  // the second fetch of the same token has no home: what was kept stays as it was
  t = load([{ status: 200, body: JSON.stringify({ design, home: pack() }) }, { status: 200, body: JSON.stringify({ design }) }]);
  await t.C.get("ABCDE-FGHJK");
  await t.C.get("ABCDE-FGHJK");
  assert.strictEqual(t.C.takeHome(true).rev, 7);
  // an older pack never replaces a newer one still waiting
  t = load([{ status: 200, body: JSON.stringify({ design, home: pack({ rev: 9 }) }) }, { status: 200, body: JSON.stringify({ design, home: pack({ rev: 3 }) }) }]);
  await t.C.get("ABCDE-FGHJK");
  await t.C.get("ABCDE-FGHJK");
  assert.strictEqual(t.C.takeHome(true).rev, 9);
  // a bad design: nothing of the home is kept
  t = load([{ status: 200, body: JSON.stringify({ design: "nope", home: pack() }) }]);
  await assert.rejects(t.C.get("ABCDE-FGHJK"));
  assert.strictEqual(t.C.takeHome(true), null);
  // a broken pack beside a good design: the design still comes
  t = load([{ status: 200, body: JSON.stringify({ design, home: { v: 1, rev: "x" } }) }]);
  assert.ok(await t.C.get("ABCDE-FGHJK"));
  assert.strictEqual(t.C.takeHome(true), null);
  // a kept pack that is not one any more (storage changed under it) is dropped
  t.mem["couchtv.home.pack"] = "{\"v\":1}";
  assert.strictEqual(t.C.takeHome(true), null);
  assert.ok(!("couchtv.home.pack" in t.mem));

  // ---- 4. Share this home never carries the account's people or photos ----
  const sb = { window: {} };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(web, "share-home.js"), "utf8"), sb);
  const S = sb.CouchShare;
  let out = S.prepare({ design: d }, ["Ruby", "Alex", "Bellingen"], null);
  assert.ok(out.design && !JSON.stringify(out.design).includes("Ruby"), "the fetched design shares without names");
  out = S.prepare({ design: Object.assign({}, d, { note: "Ruby and Alex" }) }, ["Ruby", "Alex"], null);
  assert.ok(out.error, "an account name in a design is caught");
  out = S.prepare({ design: Object.assign({}, d, { pic: JPEG }) }, [], null);
  assert.ok(out.error, "a photo in a design is caught");

  // ---- 5. the People widget draws the photo, never a link ----
  const wsrc = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
  assert.ok(/function personPhoto\(u\)/.test(wsrc) && /personFace\(x, av\)/.test(wsrc), "the People widget draws the photo");
  const pp = new Function("atob", wsrc.match(/function personPhoto\(u\) \{[\s\S]*?\n  \}/)[0] + "; return personPhoto;")((s) => Buffer.from(s, "base64").toString("latin1"));
  assert.strictEqual(pp(JPEG), JPEG);
  for (const bad of [PNG, "https://evil.example/a.jpg", "data:image/jpeg;base64,iVBORw0KGgo=", null, 5]) assert.strictEqual(pp(bad), "", String(bad));

  // ---- 6. app.js: the photo goes in the avatar, the record stays out of backups, the mark survives ----
  const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
  assert.ok(/class="avatar-photo" src="' \+ esc\(ph\)/.test(app), "avatarHTML draws the photo, escaped");
  assert.ok(/TV\.keepPrivate\(PFX \+ ACCOUNT_KEY/.test(app), "the record with the photos goes in the private store");
  assert.ok(/\["colour", "kid", "guest", "src"\]/.test(app), "the account mark is kept when the list is saved");
  assert.ok(/takeAccountHome\(\);/.test(app.slice(app.indexOf("function readConfig"), app.indexOf("function lookSetting"))), "readConfig applies a waiting pack");
  console.log("Your home tests passed.");
})().catch((e) => { console.error(e); process.exit(1); });
