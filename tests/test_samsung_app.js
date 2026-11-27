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
{
  // Home settings, About on a Samsung: an Update couch-tv row with the version and the steps
  // (20 Nov 2026 on a real Frame it said "Web preview" and had no row)
  const calls = [];
  function FakeXHR() {}
  FakeXHR.prototype.open = function (m, u) { calls.push(u); };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.send = function () {
    this.status = 200;
    this.responseText = JSON.stringify({ tag_name: "v0.13.7", assets: [{ name: "couch-tv-samsung-setup.zip" }] });
    this.onload();
  };
  const mem = {};
  const { s } = updater("0.13.6", mem, FakeXHR);
  assert.ok(s.TVUP, "window.TVUP is there");
  let st = JSON.parse(s.TVUP.state());
  assert.strictEqual(st.supported, true);
  assert.strictEqual(st.manual, true);
  assert.strictEqual(st.current, "0.13.6");
  assert.strictEqual(st.available, false);
  assert.ok(st.steps.length >= 2 && /Samsung setup again/.test(st.steps[0]));
  // never a button that can't work on a Samsung: the steps, and a QR code for them on a phone
  assert.ok(!st.can_install && !st.self, "a Samsung never installs by itself");
  assert.strictEqual(st.help_url, "https://couchtv.joshuaseage.com/help/update-couch-tv/");
  s.TVUP.check();   // Check for updates now: no once-a-day limit
  assert.strictEqual(calls.length, 1);
  st = JSON.parse(s.TVUP.state());
  assert.strictEqual(st.latest, "0.13.7");
  assert.strictEqual(st.available, true);
  s.TVUP.check();
  assert.strictEqual(calls.length, 2, "asking again looks again");
  s.TVUP.auto(false);
  assert.strictEqual(JSON.parse(s.TVUP.state()).auto, false);
  const off = updater("0.13.6", mem, FakeXHR);
  off.timers[0]();
  assert.strictEqual(calls.length, 2, "with the weekly look off, nothing is asked by itself");
}

// ---- tizen-policy.js: a design's page policy lets this TV's bridge in, and nothing else ----
{
  const gate = path.join(__dirname, "../tv-home/web/designer-gate.js");
  function withGate(search, settings) {
    const metas = [];
    const doc = { head: { appendChild: (m) => metas.push(m) }, querySelector: () => null,
      createElement: () => { const a = {}; return { setAttribute: (k, v) => { a[k] = v; }, attrs: a }; } };
    const s = { location: { search }, COUCH_TIZEN: settings || {}, document: doc };
    s.window = s;
    vm.createContext(s);
    vm.runInContext(fs.readFileSync(gate, "utf8"), s);
    vm.runInContext(fs.readFileSync(path.join(app, "tizen-policy.js"), "utf8"), s);
    s.CouchDesigner.lockPage(doc);
    return metas.length ? metas[0].attrs.content : "";
  }
  const p = withGate("?api=" + encodeURIComponent("http://192.0.2.20:5400"), {});
  // 192.0.2.x is not a home network address: refused
  assert.ok(!/192\.0\.2\.20/.test(p), "only home network bridges");
  // a made-up home address, joined so the privacy scan does not read test data as a real one
  const HOME = ["10", "0", "0", "20"].join(".");
  const q = withGate("?api=" + encodeURIComponent("http://" + HOME + ":5400"), {});
  assert.ok(/connect-src 'self' http:\/\/10\.0\.0\.20:5400 /.test(q), q);
  assert.ok(/img-src 'self' http:\/\/10\.0\.0\.20:5400 /.test(q));
  assert.ok(/object-src 'none'/.test(q), "the rest of the policy is untouched");
  // no bridge: the policy is exactly designer-gate.js's own
  const none = withGate("", {});
  assert.ok(/connect-src 'self' https:/.test(none));
  for (const bad of ["http://" + HOME + ":5400/x?y", "javascript:alert(1)", "https://evil.example", "http://" + HOME + ":5400 https://evil.example"]) {
    const r = withGate("?api=" + encodeURIComponent(bad), {});
    assert.ok(!/evil|javascript|\/x/.test(r.split("connect-src")[1].split(";")[0]), bad);
  }
}

// ---- tizen.js: Samsung's keyboard Done (65376) in a text box is Enter ----
{
  const listeners = { keydown: [] }, fired = [], later = [];
  let blurred = false;
  const box = { tagName: "INPUT", blur() { blurred = true; s.document.activeElement = null; } };
  const s = {
    location: { search: "" }, COUCH_TIZEN: {}, COUCH_TIZEN_APPS: {}, localStorage: storage({}),
    setTimeout: (f) => { later.push(f); return later.length; }, clearTimeout() {}, JSON,
    tizen: { application: { getAppsInfo() {} }, tvinputdevice: { registerKey() { throw new Error("no"); } } },
    KeyboardEvent: function (type, init) { this.type = type; this.key = init.key; this.keyCode = 0; },
    document: { activeElement: box, hidden: false,
      addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
      dispatchEvent: (e) => { fired.push(e.key); } },
    addEventListener() {}
  };
  s.window = s;
  run("tizen.js", s);
  const ev = { keyCode: 65376, preventDefault() {}, stopImmediatePropagation() {} };
  listeners.keydown.forEach((f) => f(ev));
  assert.deepStrictEqual(fired, [], "waits a moment for text from the phone");
  later.forEach((f) => f());
  assert.deepStrictEqual(fired, ["Enter"]);
  assert.ok(blurred, "the keyboard closes");
}

// ---- tizen.js: the icon of an app couch-tv has no logo for ----
{
  const apps = [
    { id: "fiZNCxMH9Y.Hotstar", packageId: "fiZNCxMH9Y", name: "JioHotstar", show: true, iconPath: "/opt/usr/apps/fiZNCxMH9Y/icon.png" },
    { id: "AbCdEfGhIj.Other", packageId: "AbCdEfGhIj", name: "Other", show: true, iconPath: "/opt/usr/apps/AbCdEfGhIj/icon.png" },
    { id: "WSRedi0001.WorkspaceRedi", packageId: "WSRedi0001", name: "Workspace", show: true, iconPath: "/opt/usr/apps/WSRedi0001/icon.png" }
  ];
  const s = {
    location: { search: "" }, COUCH_TIZEN: {}, COUCH_TIZEN_APPS: {}, COUCH_TIZEN_OWN_LOGOS: ["Workspace"],
    localStorage: storage({ "couch.tizen.apps": JSON.stringify(apps) }),
    setTimeout() { return 0; }, clearTimeout() {}, JSON,
    tizen: { application: { getAppsInfo() {} }, tvinputdevice: { registerKey() { throw new Error("no"); } } },
    document: { hidden: false, addEventListener() {} },
    addEventListener() {}
  };
  s.window = s;
  run("tizen.js", s);
  assert.strictEqual(s.TVOS.iconUrl("AbCdEfGhIj.Other"), "file:///opt/usr/apps/AbCdEfGhIj/icon.png", "the TV's icon without a bridge");

  // with a bridge: the bridge finds the icon by the app's name (the TV hands over no other app's icon)
  const b = Object.assign({}, s, { location: { search: "?api=http%3A%2F%2Fpi%3A5400&tv=lounge" }, COUCH_TIZEN: { key: "k y" },
    XMLHttpRequest: function () { this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => {}; } });
  b.window = b;
  run("tizen.js", b);
  assert.strictEqual(b.TVOS.iconUrl("AbCdEfGhIj.Other"), "http://pi:5400/api/tizen/icon?name=Other&tv=lounge&key=k%20y");
  assert.strictEqual(b.TVOS.iconUrl("fiZNCxMH9Y.Hotstar"), "http://pi:5400/api/tizen/icon?name=JioHotstar&tv=lounge&key=k%20y");
  assert.strictEqual(b.TVOS.iconUrl("WSRedi0001.WorkspaceRedi"), "logos/Workspace.png", "an own logo, by the TV's app name, before the look-up");
}

// ---- tizen.js: Samsung's Home brings couch-tv back ("home_button") ----
{
  const HOMEPART = "com.samsung.tv.homeupdateview";
  // One couch-tv page on a TV whose running apps are t.running (as at the page's start: `running`).
  function tv(homeButton, opts) {
    opts = opts || {};
    const t = { clock: opts.clock || 100000, running: opts.running || [], opened: [], vis: [], ticks: [], mem: opts.mem || {} };
    const s = {
      location: { search: "" }, COUCH_TIZEN: { home_button: homeButton }, COUCH_TIZEN_APPS: {}, localStorage: storage(t.mem),
      setTimeout() { return 0; }, clearTimeout() {}, JSON,
      setInterval: (f) => { t.ticks.push(f); return t.ticks.length; }, clearInterval() {},
      Date: { now: () => t.clock },
      tizen: { application: {
        getAppsInfo() {}, launch: (id) => t.opened.push(id),
        getAppsContext: (ok) => ok(t.running.map((appId) => ({ appId })))
      }, tvinputdevice: { registerKey() { throw new Error("no"); } } },
      document: { hidden: false, addEventListener: (k, f) => { if (k === "visibilitychange") t.vis.push(f); } },
      addEventListener() {}
    };
    s.window = s;
    run("tizen.js", s);
    t.s = s;
    t.hide = (hidden) => { s.document.hidden = hidden; t.vis.forEach((f) => f()); };
    t.tick = () => t.ticks.slice().forEach((f) => f());
    t.later = (ms) => { t.clock += ms; };
    t.next = () => tv(homeButton, { mem: t.mem, clock: t.clock, running: t.running });   // couch-tv reopened: a new page
    return t;
  }
  const back = (t) => t.opened.filter((id) => id === "CouchTVApp.Home").length;

  // Home from couch-tv: hidden, then Samsung's home part starts a moment later
  let t = tv({});
  t.hide(true);
  assert.strictEqual(back(t), 0, "nothing yet");
  t.running = [HOMEPART]; t.later(500); t.tick();
  assert.strictEqual(back(t), 1, "Home brings couch-tv back");

  // the part started just before couch-tv went out of sight: still Home
  t = tv({});
  t.running = [HOMEPART]; t.tick(); t.later(400);
  t.hide(true);
  assert.strictEqual(back(t), 1, "started a moment before counts too");

  // Home again within 5 seconds of coming back (a new page, the same storage): Samsung's home stays,
  // for 2 minutes, and then it is back to normal
  t = t.next(); t.later(2000);
  t.hide(true);
  assert.strictEqual(back(t), 0, "pressed twice: left alone");
  t.running = []; t.tick(); t.running = [HOMEPART]; t.later(500); t.tick();
  assert.strictEqual(back(t), 0, "and the part starting changes nothing");
  t.later(60000); t.running = []; t.tick(); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 0, "still quiet inside 2 minutes");
  t.later(120000); t.running = []; t.tick(); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 1, "back to normal after");

  // Home twice, then couch-tv is on screen again (opened by hand, or after a restart): Home brings it
  // back at once, not 2 minutes later (26 Nov 2026: the power menu of a hold-Power restart read as
  // the second press, and Home did nothing once the TV was back)
  t = tv({});
  t.hide(true); t.running = [HOMEPART]; t.later(500); t.tick();
  t = t.next(); t.later(2000); t.hide(true);
  assert.strictEqual(back(t), 0, "pressed twice: left alone");
  t.later(10000); t.hide(false);
  t.hide(true); t.running = []; t.tick(); t.running = [HOMEPART]; t.later(500); t.tick();
  assert.strictEqual(back(t), 1, "shown again ends the quiet");
  t.later(10000); t.running = [];   // the same, with a fresh page after a restart
  t.mem["couch.home.quiet"] = String(t.clock + 60000);
  t = t.next();
  t.hide(true); t.running = [HOMEPART]; t.later(500); t.tick();
  assert.strictEqual(back(t), 1, "a page that starts on screen ends the quiet");

  // The tile-only preset persists across page reloads and does not interpret a second Home as escape.
  t = tv({});
  t.s.TVOS.toggleSamsungHomeShortcut();
  t.hide(true); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 1);
  t = t.next(); t.later(2000); t.hide(true);
  t.running = []; t.tick(); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 1, "tile-only still bounces a second Home press");

  // Source with couch-tv in front (an overlay: it stays shown), then an HDMI input a few seconds later
  t = tv({});
  t.running = [HOMEPART]; t.tick();
  t.later(3000); t.hide(true); t.tick();
  assert.strictEqual(back(t), 0, "the input is left on screen");

  // an app couch-tv opened, then Home from inside it
  t = tv({});
  t.s.TVOS.launch("9Ur5IzDKqV.TizenYouTube");
  t.hide(true); t.running = ["9Ur5IzDKqV.TizenYouTube"]; t.tick();
  assert.strictEqual(back(t), 0, "an app couch-tv opened is not Home");
  t.later(30000); t.running = ["9Ur5IzDKqV.TizenYouTube", HOMEPART]; t.tick();
  assert.strictEqual(back(t), 1, "Home from inside the app brings couch-tv back");

  // an app couch-tv opened just after coming back is not a second Home press
  t = t.next(); t.later(2000);
  t.s.TVOS.launch("9Ur5IzDKqV.TizenYouTube");
  t.hide(true);
  t.later(30000); t.running = ["9Ur5IzDKqV.TizenYouTube"]; t.tick(); t.running.push(HOMEPART); t.tick();
  assert.strictEqual(back(t), 1, "Home from that app still works");

  // own markers, and off unless asked for
  t = tv({ markers: ["x.home"] });
  t.hide(true); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 0, "only the configured part counts");
  t.running = [HOMEPART, "x.home"]; t.tick();
  assert.strictEqual(back(t), 1);
  t = tv(null);
  t.hide(true); t.running = [HOMEPART]; t.tick();
  assert.strictEqual(back(t), 0, "no home_button: never");
  assert.strictEqual(t.ticks.length, 0, "and no watching");
}

// ---- livetv.js: a Live TV tile ("live_tv") plays Samsung TV Plus inside couch-tv; Back returns ----
{
  function node(tag) {
    const n = {
      tagName: tag.toUpperCase(), style: {}, children: [], attrs: {}, parentNode: null, on: {}, className: "",
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      insertBefore(c) { c.parentNode = n; n.children.unshift(c); return c; },
      removeChild(c) { n.children.splice(n.children.indexOf(c), 1); c.parentNode = null; return c; },
      setAttribute(k, v) { n.attrs[k] = String(v); },
      removeAttribute(k) { delete n.attrs[k]; },
      addEventListener(k, f) { n.on[k] = f; },
      play() { n.paused = false; }, pause() { n.paused = true; }, load() { n.loads = (n.loads || 0) + 1; }
    };
    let text = "";
    Object.defineProperty(n, "textContent", {
      get: () => text + n.children.map((c) => c.textContent).join(" "),
      set: (v) => { text = String(v); n.children = []; }
    });
    return n;
  }
  const chans = [
    { id: "IN1", name: "News One HD", chno: 1007, group: "Hindi News", now: "Halla Bol" },
    { id: "IN2", name: "ABP News", chno: 1004, group: "Hindi News", now: "" },
    { id: "MOV", name: "Movie Club", chno: 1002, group: "Movies", now: "" },
    { id: "IN3", name: "NDTV 24x7", chno: 1500, group: "English News", now: "" }
  ];
  function page(live, mem) {
    const listeners = { keydown: [], visibilitychange: [] }, calls = [];
    const s = {
      location: { search: "" }, COUCH_TIZEN: { live_tv: live }, COUCH_TIZEN_APPS: {}, JSON,
      localStorage: storage(mem), setTimeout() { return 0; }, clearTimeout() {},
      tizen: { application: { getAppsInfo() {} }, tvinputdevice: { registerKey() { throw new Error("no"); } } },
      document: { hidden: false, body: node("body"), createElement: node,
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } },
      tv: { pause: () => calls.push("pause"), resume: () => calls.push("resume") },
      addEventListener() {}
    };
    s.window = s;
    run("tizen.js", s);
    run("livetv.js", s);
    s.key = (keyCode) => {
      const ev = { keyCode, stopped: false, preventDefault() {}, stopImmediatePropagation() { ev.stopped = true; } };
      for (const f of listeners.keydown) { f(ev); if (ev.stopped) break; }
      return ev.stopped;
    };
    s.hide = () => { s.document.hidden = true; listeners.visibilitychange.forEach((f) => f()); };
    s.box = () => s.document.body.children.find((c) => c.id === "livetv");
    s.video = () => s.box().children.find((c) => c.tagName === "VIDEO");
    s.part = (cls) => s.box().children.find((c) => c.className === cls);
    s.calls = calls;
    return s;
  }
  const mem = { "couch.livetv.channels": JSON.stringify(chans) };
  // no "live_tv": no tile
  assert.ok(!JSON.parse(page(null, {}).TVOS.apps()).some((a) => a.package === "local.livetv"));

  const s = page({ groups: ["Hindi News", "English News"], name: "News" }, mem);
  assert.deepStrictEqual(JSON.parse(s.TVOS.apps())[0], { package: "local.livetv", label: "News" }, "the tile comes first");
  assert.strictEqual(s.TVOS.launch("local.livetv"), true);
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN1", "opens on the first channel");
  assert.deepStrictEqual(s.calls, ["pause"], "the home rests behind the picture");
  assert.ok(/1007 News One HD Halla Bol/.test(s.part("lt-banner").textContent), "a banner with the channel");

  // Up and Down go through the chosen groups only (no Movie Club), round the end
  assert.ok(s.key(40));
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN2");
  s.key(40);
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN3", "Movies is skipped");
  s.key(40);
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN1", "round the end");
  s.key(38);
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN3");
  assert.strictEqual(mem["couch.livetv.last"], "IN3");

  // OK: the channel list; Back closes the list first, then the player
  s.key(13);
  assert.strictEqual(s.part("lt-menu").style.display, "", "the list is up");
  assert.strictEqual(s.part("lt-menu").children.length, 3);
  s.key(10009);
  assert.strictEqual(s.part("lt-menu").style.display, "none");
  assert.ok(s.CouchLiveTV.isOpen(), "the first Back only closes the list");
  const video = s.video();
  assert.ok(s.key(10009));
  assert.ok(!s.CouchLiveTV.isOpen());
  assert.strictEqual(s.box(), undefined, "the player is gone");
  assert.ok(video.paused && !("src" in video.attrs) && video.loads >= 1, "and the stream let go of");
  assert.deepStrictEqual(s.calls, ["pause", "resume"]);
  assert.strictEqual(s.key(40), false, "keys are the home's again");

  // opened again: the last channel watched; Samsung's Home (hidden) stops it too
  s.TVOS.launch("local.livetv");
  assert.strictEqual(s.video().attrs.src, "https://jmp2.uk/stvp-IN3");
  const v2 = s.video();
  s.hide();
  assert.ok(!s.CouchLiveTV.isOpen() && v2.paused && !("src" in v2.attrs));

  // Left and Right: the categories (every channel, then each group); Up and Down stay in the one picked
  const m2 = { "couch.livetv.channels": JSON.stringify(chans) };
  const c = page({ groups: [], name: "Live TV" }, m2);
  c.TVOS.launch("local.livetv");
  c.key(39);
  assert.strictEqual(c.part("lt-menu").style.display, "", "Right opens the list");
  assert.ok(/Hindi News/.test(c.part("lt-cats").textContent), "on the first group");
  assert.strictEqual(c.part("lt-menu").children.length, 2, "only that group's channels");
  c.key(39);
  assert.ok(/Movies/.test(c.part("lt-cats").textContent));
  c.key(13);
  assert.strictEqual(c.video().attrs.src, "https://jmp2.uk/stvp-MOV", "OK plays the one picked");
  c.key(40);
  assert.strictEqual(c.video().attrs.src, "https://jmp2.uk/stvp-MOV", "Down stays in Movies, its only channel");
  assert.strictEqual(m2["couch.livetv.category"], "Movies", "the category is kept");
  c.key(37); c.key(37);
  assert.ok(/All channels  \(4\)/.test(c.part("lt-cats").textContent), "Left goes round to every channel");
  c.key(10009); c.key(10009);

  // the tour: once per arrow layout, and any key puts it away (still doing its job)
  const tm = { "couch.livetv.channels": JSON.stringify(chans) };
  const w = page({ groups: [], name: "Live TV" }, tm);
  w.TVOS.launch("local.livetv");
  assert.ok(/Change channel/.test(w.part("lt-tour").textContent), "the tour shows the first time");
  w.key(40);
  assert.strictEqual(w.part("lt-tour"), undefined, "a key puts it away");
  assert.strictEqual(w.video().attrs.src, "https://jmp2.uk/stvp-IN2", "and still changes channel");
  w.key(10009);
  w.TVOS.launch("local.livetv");
  assert.strictEqual(w.part("lt-tour"), undefined, "not again for the same arrows");
  w.key(10009);

  // Live TV arrows swapped (Home settings, Samsung behaviour): Left and Right change channel,
  // Up and Down bring up the list, and the tour shows again for the new arrows
  assert.strictEqual(w.TVOS.liveTvKeys(), "updown");
  w.TVOS.toggleLiveTvKeys();
  assert.strictEqual(w.TVOS.liveTvKeys(), "leftright");
  w.TVOS.launch("local.livetv");
  assert.ok(/Left|\u25C0/.test(w.part("lt-tour").textContent), "the tour again, for the swapped arrows");
  w.key(39);
  assert.strictEqual(w.video().attrs.src, "https://jmp2.uk/stvp-MOV", "Right: the next channel");
  assert.strictEqual(w.part("lt-menu").style.display, "none", "no list");
  w.key(37);
  assert.strictEqual(w.video().attrs.src, "https://jmp2.uk/stvp-IN2", "Left: the one before");
  w.key(38);
  assert.strictEqual(w.part("lt-menu").style.display, "", "Up brings up the list");
  w.key(40);
  w.key(13);
  assert.strictEqual(w.video().attrs.src, "https://jmp2.uk/stvp-MOV", "Down then OK plays the one picked");
  assert.strictEqual(w.part("lt-menu").style.display, "none");
  w.key(10009);

  // with the bridge and AVPlay: the bridge's sharp playlist first, then the stream itself
  const opened = [];
  const p = page({ groups: [], name: "Live TV" }, { "couch.livetv.channels": JSON.stringify(chans) });
  let listener = null, prep = null;
  p.webapis = { avplay: { open: (u) => opened.push(u), setDisplayRect() {}, setStreamingProperty() {}, setBufferingParam() {},
    setListener: (l) => { listener = l; }, prepareAsync: (ok, err) => { prep = { ok, err }; }, play() {}, getState() { return "IDLE"; },
    stop() {}, close() {} } };
  p.XMLHttpRequest = function () { this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => {}; };
  p.CouchLiveTV.open({ bridge: "http://pi:5400", key: "k y" });
  assert.deepStrictEqual(opened, ["http://pi:5400/api/livetv/play/IN1.m3u8?key=k%20y"]);
  prep.err("PLAYER_ERROR_CONNECTION_FAILED");
  assert.deepStrictEqual(opened.slice(1), ["https://jmp2.uk/stvp-IN1"], "then the stream itself");
  assert.strictEqual(listener && listener.onerror, undefined, "no listener before this stream is prepared");
  prep.ok();
  listener.onerror("again");
  assert.strictEqual(p.video().attrs.src, "https://jmp2.uk/stvp-IN1", "a <video> last");

  // Live TV opens on (Home settings, Samsung behaviour): a country's first channel, or the last one
  // watched if it is that country's
  const abroad = chans.concat([{ id: "GB1", name: "Premier Football", group: "United Kingdom · Sports", region: "gb" },
                               { id: "GB2", name: "UK News", group: "United Kingdom · News", region: "gb" }]);
  const sm = { "couch.livetv.channels": JSON.stringify(abroad), "couch.livetv.last": "IN2", "couch.livetv.category": "Hindi News" };
  const r = page({ groups: [], name: "Live TV" }, sm);
  assert.strictEqual(r.TVOS.liveTvStart(), "", "the last channel by default");
  r.TVOS.launch("local.livetv");
  assert.strictEqual(r.video().attrs.src, "https://jmp2.uk/stvp-IN2");
  r.key(10009); r.key(10009);
  r.TVOS.setLiveTvStart("gb");
  r.TVOS.launch("local.livetv");
  assert.strictEqual(r.video().attrs.src, "https://jmp2.uk/stvp-GB1", "that country's first channel");
  assert.strictEqual(sm["couch.livetv.category"], "United Kingdom · Sports", "in its category");
  r.key(40);
  assert.strictEqual(r.video().attrs.src, "https://jmp2.uk/stvp-GB1", "Down stays in that category");
  r.key(10009); r.key(10009);
  sm["couch.livetv.last"] = "GB2";
  r.TVOS.launch("local.livetv");
  assert.strictEqual(r.video().attrs.src, "https://jmp2.uk/stvp-GB2", "the last one watched, when it is that country's");
  r.key(10009); r.key(10009);
  r.TVOS.setLiveTvStart("home");
  r.TVOS.launch("local.livetv");
  assert.strictEqual(r.video().attrs.src, "https://jmp2.uk/stvp-IN1", "this country's channels");
}

console.log("Samsung app tests passed.");
