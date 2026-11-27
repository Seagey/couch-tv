// The Now playing card set from the account (lane D, 28 Nov 2026; watching.md nowplaying, route a): the pack's details.watch.now_playing
// is read as a plain true or false and nothing else, beside whose shows; and app.js applies it once per account change.
// Run: node tests/test_now_playing_account.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const sandbox = { location: { search: "" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, atob: (s) => Buffer.from(s, "base64").toString("latin1"),
  setTimeout, clearTimeout, COUCH_CONFIG: { design_store: "https://designs.example" }, fetch: () => Promise.reject(new Error("no")) };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sandbox);
const C = sandbox.window.CouchDesignCode;
const plain = (v) => JSON.parse(JSON.stringify(v));
const pack = (watch) => ({ v: 1, rev: 5, at: "2026-11-28T01:00:00.000Z", people: [], town: null, details: { watch } });
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

eq(plain(C.readHome(pack({ now_playing: false }))).details.watch, { now_playing: false }, "off from the account");
eq(plain(C.readHome(pack({ now_playing: true, whose: { w_k: "p_3k9x2m" } }))).details.watch, { whose: { w_k: "p_3k9x2m" }, now_playing: true }, "beside whose shows");
eq(plain(C.readHome(pack({ now_playing: "yes" }))).details.watch, undefined, "anything but true or false is dropped");
eq(plain(C.readHome(pack({ whose: { w_k: "p_3k9x2m" } }))).details.watch, { whose: { w_k: "p_3k9x2m" } }, "no switch: the TV decides");

// app.js: applied when the account's choice changes; a change on the TV after that stays until the account changes again
const src = fs.readFileSync(path.join(web, "app.js"), "utf8");
const fn = src.slice(src.indexOf("  function applyAccountNowPlaying(d) {"), src.indexOf("\n  }\n", src.indexOf("  function applyAccountNowPlaying(d) {")) + 4);
assert.ok(fn.length > 50, "applyAccountNowPlaying is in app.js");
assert.ok(/applyAccountNowPlaying\(pack\.details\)/.test(src), "takeAccountHome calls it");
const ctx = { ST: {}, NP_ON: true, saved: 0, refreshed: 0 };
vm.createContext(ctx);
vm.runInContext(fn + "\nfunction saveSettings() { saved++; } function refreshMusic() { refreshed++; }", ctx);
ctx.applyAccountNowPlaying({ watch: { now_playing: false } });
eq([ctx.NP_ON, ctx.ST.now_playing, ctx.saved], [false, false, 1], "the account turns it off");
ctx.ST.now_playing = true; ctx.NP_ON = true;                     // switched back on at the TV
ctx.applyAccountNowPlaying({ watch: { now_playing: false } });   // the same account choice again (every pack carries it)
eq([ctx.NP_ON, ctx.saved], [true, 1], "the TV's own change stays while the account's choice is the same");
ctx.applyAccountNowPlaying({ watch: { now_playing: true } });
eq([ctx.NP_ON, ctx.ST.now_playing_acct, ctx.saved], [true, true, 2], "a new account choice applies");
ctx.applyAccountNowPlaying({ watch: {} }); ctx.applyAccountNowPlaying(null);
eq(ctx.saved, 2, "nothing from the account: nothing changes");
console.log("OK: " + n + " checks");
