// Pack v2 on the TV (Phase 2 shared base): tv-home/web/design-code.js readHome, mergeHome, planV2, placeOf.
// What the TV keeps from the store's answer (details, keys, photo links), where each part goes, what a change made on this TV does to
// an account change, which keys are dropped, how the account's photos share the 50 slots, and that a v1 pack still reads and leaves it all alone.
// Run: node tests/test_home_v2.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
function load() {
  const mem = {};
  const sandbox = { location: { search: "" }, localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    atob: (s) => Buffer.from(s, "base64").toString("latin1"), setTimeout, clearTimeout, COUCH_CONFIG: { design_store: "https://designs.example" }, fetch: () => Promise.reject(new Error("no")) };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sandbox);
  return sandbox.window.CouchDesignCode;
}
const C = load();
const plain = (v) => JSON.parse(JSON.stringify(v));
const PID = "a".repeat(24), TVID = "22222222-2222-4222-8222-222222222222";
const url = (id) => "https://x.supabase.co/storage/v1/object/sign/tvd-photos/11111111-1111-4111-8111-111111111111/" + id + ".jpg?token=abc.def";
const pack = (o) => Object.assign({ v: 2, rev: 5, at: "2026-11-27T01:00:00.000Z",
  people: [{ id: "p_3k9x2m", name: "Ruby", kids: true }], town: { name: "Bellingen", lat: -28.8, lon: 153.4 },
  details: { note: { text: "Back at five", from: "Mum" }, lists: [{ name: "Shopping", items: [{ t: "Milk", done: false }] }], guide: [{ title: "Bins", text: "Tuesday" }],
    guest: { name: "Sarah" }, stay: { checkin: "15:00", checkout: "10:00", names: { "2026-12-24": "Sarah" }, url: "https://bookings.example/x.ics" }, cal: { url: "https://calendar.google.com/x/basic.ics" },
    screen: { goal: 120 }, places: { w_abc: { name: "Ballina", lat: -28.87, lon: 153.56 } }, commute: { to: { name: "Lismore", lat: -28.81, lon: 153.27 } },
    watch: { whose: { w_k: "p_3k9x2m" } }, smart: { picks: { w_air: ["climate.guest"] } }, bins: { weekday: "2", bin_a: "Recycling", lid_a: "#FFD60A" }, card: { url: "http://hub/n.json" } },
  keys: { ha: { token: "SECRET-HA-TOKEN", url: "http://homeassistant.local:8123" }, ai: { key: "sk-test-abcdefgh", provider: "openai" } },
  photos: { albums: [{ id: "alb1", name: "Beach", photos: [{ id: PID, taken: "2020-05-05", url: url(PID) }] }] } }, o || {});

console.log("Running pack v2 tests...");

// ---- 1. readHome: checked copy only ----
let h = plain(C.readHome(pack()));
assert.strictEqual(h.v, 2);
assert.strictEqual(h.details.note.text, "Back at five");
assert.strictEqual(h.details.guest.name, "Sarah");
assert.strictEqual(h.details.stay.checkin, "15:00");
assert.strictEqual(h.details.cal.url, "https://calendar.google.com/x/basic.ics");
assert.strictEqual(h.details.places.w_abc.name, "Ballina");
assert.deepStrictEqual(h.details.smart.picks.w_air, ["climate.guest"]);
assert.strictEqual(h.details.bins.lid_a, "#ffd60a");
assert.deepStrictEqual(Object.keys(h.keys), ["ha", "ai"]);
assert.strictEqual(h.keys.ha.token, "SECRET-HA-TOKEN");
assert.strictEqual(h.photos.length, 1);
assert.strictEqual(h.photos[0].taken, "2020-05-05");
assert.strictEqual(h.town.name, "Bellingen");

// bad parts are dropped one by one, never guessed
h = plain(C.readHome(pack({ details: { note: { text: 5 }, cal: { url: "http://x.com/a.ics" }, stay: { checkin: "03:00", url: "https://u:p" + "@x.com/a" }, screen: { goal: 7 }, places: { "bad id": { name: "x", lat: 1, lon: 1 }, w1: { name: "x", lat: 200, lon: 1 } }, lists: [{ name: "" }], evil: 1 },
  keys: { root: { key: "abcdefghijk" }, ha: { token: "short" }, ai: { key: "has space inside it" } },
  photos: { albums: [{ photos: [{ id: PID, url: "https://evil.example/x.jpg" }, { id: "zz", url: url("zz") }, { id: PID, url: "http://x.supabase.co/storage/v1/object/sign/tvd-photos/a/b.jpg?token=1" }] }] } })));
assert.deepStrictEqual(h.details, {});
assert.deepStrictEqual(h.keys, {});
assert.deepStrictEqual(h.photos, []);
h = plain(C.readHome(pack({ photos: { albums: [{ photos: Array.from({ length: 60 }, (_, i) => { const id = ("%024x").replace("%024x", i.toString(16).padStart(24, "0")); return { id, url: url(id) }; }) }] } })));
assert.strictEqual(h.photos.length, 50, "at most 50 photos");

// a v1 pack still reads, and its Wi-Fi still reads; a v2 pack's Wi-Fi reads too
h = plain(C.readHome({ v: 1, rev: 1, at: "t", wifi: { name: "Guest", password: "pw" }, people: [] }));
assert.deepStrictEqual(h.wifi, { name: "Guest", password: "pw" });
assert.strictEqual(h.details, undefined);
h = plain(C.readHome(pack({ wifi: { name: "Guest2", password: "pw2" } })));
assert.deepStrictEqual(h.wifi, { name: "Guest2", password: "pw2" });

// ---- 2. mergeHome: where each part goes ----
const empty = () => ({ people: [], place: null, wifi: null, ah: {}, photos: [], account: null });
let r = plain(C.mergeHome(empty(), C.readHome(pack())));
assert.strictEqual(r.account.rev, 5);
assert.strictEqual(r.ah.note.text, "Back at five");
assert.strictEqual(r.ah.guest.name, "Sarah");
assert.strictEqual(r.ah.screen.goal, 120);
assert.strictEqual(r.ah.stay.url, "https://bookings.example/x.ics");
assert.strictEqual(r.keys.ha.token, "SECRET-HA-TOKEN");
assert.deepStrictEqual(r.photos.add.map((a) => a.id), ["acc_" + PID]);
assert.strictEqual(r.dates[url(PID)], "2020-05-05");
assert.strictEqual(C.placeOf(r.account, "w_abc").name, "Ballina");
assert.strictEqual(C.placeOf(r.account, "nope"), null);
assert.strictEqual(C.detail(r.account, "commute").to.name, "Lismore");
assert.deepStrictEqual(r.account.keysGiven, ["ha", "ai"]);
assert.ok(!JSON.stringify(r.account).includes("SECRET-HA-TOKEN"), "keys are not kept in the account record");
assert.ok(!JSON.stringify(r.account).includes("sk-test"), "no secret in the record, only which kinds");

// ---- 3. a change made on this TV beats the account; an unchanged value follows the account ----
const applied = plain(r.account);
const tvNow = (ah) => ({ people: [], place: null, wifi: null, ah, photos: [{ id: "acc_" + PID, url: url(PID) }], account: applied });
// the TV still holds exactly what the account put: the account's next value replaces it
let next = plain(C.mergeHome(tvNow({ note: { text: "Back at five", from: "Mum", at: 0 }, screen: { goal: 120 } }), C.readHome(pack({ rev: 6, details: { note: { text: "Back at six", from: "Mum" }, screen: { goal: 60 } } }))));
assert.strictEqual(next.ah.note.text, "Back at six");
assert.strictEqual(next.ah.screen.goal, 60);
// typed on the TV since: the TV's own stays
next = plain(C.mergeHome(tvNow({ note: { text: "Typed on the TV", from: "", at: 1 } }), C.readHome(pack({ rev: 6, details: { note: { text: "Back at six" } } }))));
assert.strictEqual(next.ah.note, undefined, "the TV's own note is left alone");
// the account clears a field it put there: it goes; a TV's own is kept
next = plain(C.mergeHome(tvNow({ note: { text: "Back at five", from: "Mum", at: 0 }, screen: { goal: 30 } }), C.readHome(pack({ rev: 6, details: { screen: { goal: 30 } } }))));
assert.strictEqual(next.ah.note, null, "cleared in the account, still the account's: removed");
assert.strictEqual(next.ah.screen, undefined, "screen was the TV's own (30): untouched");

// ---- 4. keys: given now, dropped when the account no longer gives them, untouched by a pack with no keys ----
next = plain(C.mergeHome(tvNow({}), C.readHome(pack({ rev: 6, keys: { ha: { token: "NEW-HA-TOKEN-1", url: "http://homeassistant.local:8123" } } }))));
assert.strictEqual(next.keys.ha.token, "NEW-HA-TOKEN-1");
assert.strictEqual(next.keys.ai, null, "the Ask AI key was given before and is not now: dropped");
assert.deepStrictEqual(next.account.keysGiven, ["ha"]);
next = plain(C.mergeHome(tvNow({}), C.readHome(pack({ rev: 6, keys: {} }))));
assert.deepStrictEqual(Object.keys(next.keys).sort(), ["ai", "ha"], "an empty keys object drops everything given");
assert.deepStrictEqual(next.keys, { ha: null, ai: null });
next = plain(C.mergeHome(tvNow({}), C.readHome(pack({ rev: 6, keys: undefined }))));
assert.deepStrictEqual(next.keys, {}, "no keys in the pack: nothing changes");
assert.deepStrictEqual(next.account.keysGiven, ["ha", "ai"]);

// ---- 5. photos: the account's share the 50 slots with the TV's own; links refresh; removed ones go ----
const own = Array.from({ length: 45 }, (_, i) => ({ id: "own" + i, url: "https://x/" + i + ".jpg" }));
const many = Array.from({ length: 10 }, (_, i) => { const id = i.toString(16).padStart(24, "0"); return { id, taken: "", url: url(id) }; });
next = plain(C.mergeHome({ people: [], place: null, wifi: null, ah: {}, photos: own, account: null }, C.readHome(pack({ photos: { albums: [{ photos: many }] } }))));
assert.strictEqual(next.photos.add.length, 5, "45 of the TV's own leave 5 slots");
const held = { id: "acc_" + PID, url: "https://old" };
next = plain(C.mergeHome({ people: [], place: null, wifi: null, ah: {}, photos: [held, { id: "acc_" + "b".repeat(24), url: "u" }], account: applied }, C.readHome(pack({ rev: 6 }))));
assert.deepStrictEqual(next.photos.update, [{ id: "acc_" + PID, url: url(PID) }], "a fresh link replaces the old one");
assert.deepStrictEqual(next.photos.remove, ["acc_" + "b".repeat(24)], "a photo the account no longer shows goes");
assert.deepStrictEqual(next.photos.add, []);

// ---- 6. a v1 pack leaves everything v2 alone; a wipe takes only what the account gave ----
next = plain(C.mergeHome(tvNow({ note: { text: "Back at five", from: "Mum", at: 0 } }), C.readHome({ v: 1, rev: 6, at: "t", people: [{ id: "p_3k9x2m", name: "Ruby" }] })));
assert.strictEqual(next.ah, undefined);
assert.deepStrictEqual(next.account.keysGiven, ["ha", "ai"]);
assert.strictEqual(C.placeOf(next.account, "w_abc").name, "Ballina");
next = plain(C.mergeHome(tvNow({ note: { text: "Back at five", from: "Mum", at: 0 }, lists: [{ name: "Mine", items: [] }] }), { v: 1, rev: 9, wipe: true }));
assert.strictEqual(next.ah.note, null, "the account's note goes");
assert.strictEqual(next.ah.lists, undefined, "the TV's own list stays");
assert.deepStrictEqual(next.keys, { ha: null, ai: null });
assert.deepStrictEqual(next.photos.remove, ["acc_" + PID]);
assert.strictEqual(next.account.details, null);
assert.strictEqual(C.placeOf(next.account, "w_abc"), null);
// an older pack than the one held is dropped
assert.strictEqual(C.mergeHome({ people: [], place: null, ah: {}, photos: [], account: { rev: 9 } }, C.readHome(pack({ rev: 5 }))), null);

console.log("Pack v2: all checks passed");
