// The Samsung app's own pages (samsung/app): kept.js keeps the bridge across a reinstall of the
// plain release package, and update.js says honestly that a Samsung does not update itself.
// Run: node tests/test_samsung_app.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const app = path.join(__dirname, "../samsung/app");
function run(file, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(app, file), "utf8"), sandbox);
  return sandbox;
}
function storage(mem) {
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
}

console.log("Running Samsung app tests...");

// ---- kept.js ----
{
  const mem = {};
  const built = { COUCH_TIZEN: { bridge: "http://192.0.2.20:5400", key: "abcdefghijkl", tv: "lounge" }, localStorage: storage(mem) };
  built.window = built;
  run("kept.js", built);
  assert.deepStrictEqual(JSON.parse(mem["couch.tizen.kept"]), { bridge: "http://192.0.2.20:5400", key: "abcdefghijkl", tv: "lounge" });

  // later the plain release package goes on: no bridge in it, the kept one is used
  const plain = { COUCH_TIZEN: { bridge: "", key: "", tv: "" }, localStorage: storage(mem) };
  plain.window = plain;
  run("kept.js", plain);
  assert.strictEqual(plain.COUCH_TIZEN.bridge, "http://192.0.2.20:5400");
  assert.strictEqual(plain.COUCH_TIZEN.key, "abcdefghijkl");
  assert.strictEqual(plain.COUCH_TIZEN.tv, "lounge");

  // nothing kept: nothing changes
  const fresh = { COUCH_TIZEN: { bridge: "" }, localStorage: storage({}) };
  fresh.window = fresh;
  run("kept.js", fresh);
  assert.strictEqual(fresh.COUCH_TIZEN.bridge, "");

  // a kept value that is not a plain bridge address is never used
  for (const bad of ["javascript:alert(1)", "http://x/evil?y", "file:///etc", "http://a b"]) {
    const m = { "couch.tizen.kept": JSON.stringify({ bridge: bad }) };
    const s = { COUCH_TIZEN: { bridge: "" }, localStorage: storage(m) };
    s.window = s;
    run("kept.js", s);
    assert.strictEqual(s.COUCH_TIZEN.bridge, "", bad);
  }
  // storage that throws (a private profile) breaks nothing
  const broken = { COUCH_TIZEN: {}, localStorage: { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } } };
  broken.window = broken;
  run("kept.js", broken);
}

// ---- update.js ----
function updater(version, mem, xhr) {
  const timers = [];
  const s = {
    COUCH_TIZEN: { version }, localStorage: storage(mem || {}), location: { search: "" },
    navigator: { onLine: true }, setTimeout: (f, ms) => { timers.push(f); return timers.length; }, Date,
    XMLHttpRequest: xhr || function () { throw new Error("no network in this test"); },
    document: { hidden: false, body: null, getElementById: () => null, addEventListener() {}, removeEventListener() {} }
  };
  s.window = s;
  run("update.js", s);
  return { U: s.CouchSamsungUpdate, timers, s };
}
{
  const { U } = updater("0.13.3");
  assert.strictEqual(U.newer("0.13.4", "0.13.3"), true);
  assert.strictEqual(U.newer("v0.14.0", "0.13.3"), true);
  assert.strictEqual(U.newer("0.13.3", "0.13.3"), false);
  assert.strictEqual(U.newer("0.13.2", "0.13.3"), false);
  assert.strictEqual(U.newer("0.13.10", "0.13.9"), true);
  assert.strictEqual(U.newer("nonsense", "0.13.3"), false);

  const rel = (tag, assets, extra) => JSON.stringify(Object.assign({ tag_name: tag, assets: assets.map((n) => ({ name: n })) }, extra || {}));
  assert.strictEqual(U.fromRelease(rel("v0.13.4", ["couch-tv-home.apk", "couch-tv-samsung-setup.zip", "couch-tv-samsung.wgt"])), "0.13.4");
  // an Android-only release never asks a Samsung to update
  assert.strictEqual(U.fromRelease(rel("v0.13.4", ["couch-tv-home.apk"])), "");
  assert.strictEqual(U.fromRelease(rel("v0.13.4", ["couch-tv-samsung.wgt"], { prerelease: true })), "");
  assert.strictEqual(U.fromRelease(rel("<script>", ["couch-tv-samsung.wgt"])), "");
  assert.strictEqual(U.fromRelease("not json"), "");

  // the words: honest about how it updates, no "coming soon" or "beta", no "Press Home"
  const w = U.words("0.13.4");
  assert.ok(/does not update itself/.test(w));
  assert.ok(/Samsung setup again/.test(w));
  assert.ok(w.indexOf("couchtv.joshuaseage.com/help/tv-samsung") >= 0);
  assert.ok(!/coming soon|beta|press home|github\.com\/.*SAMSUNG\.md/i.test(w));
}
{
  // it waits for the home to settle, then asks GitHub once a day at most, with no credentials
  const calls = [];
  function FakeXHR() { this.headers = {}; }
  FakeXHR.prototype.open = function (m, u) { calls.push(u); this.u = u; };
  FakeXHR.prototype.setRequestHeader = function (k, v) { this.headers[k] = v; };
  FakeXHR.prototype.send = function () { this.sent = true; this.creds = this.withCredentials; };
  const mem = {};
  const { timers } = updater("0.13.3", mem, FakeXHR);
  assert.strictEqual(calls.length, 0, "nothing is asked before the home settles");
  timers[0]();
  assert.deepStrictEqual(calls, ["https://api.github.com/repos/Seagey/couch-tv/releases/latest"]);
  const again = updater("0.13.3", mem, FakeXHR);
  again.timers[0]();
  assert.strictEqual(calls.length, 1, "once a day at most");
  assert.strictEqual(updater("", {}, FakeXHR).timers.length, 0, "no version: no check");
}

console.log("Samsung app tests passed.");
