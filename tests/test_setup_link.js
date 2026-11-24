// Couch TV Setup's account link and design code on the TV (tv-home/web/design-code.js fromSetup, the TV
// inbox answer, Undo; app.js setupDesign, accountInbox, accountRows). The link itself stays in the app
// (AccountLink.kt): the page only learns whether there is one. DREAM-SETUP-BUILD.md "TV side", "TV inbox".
// Run: node tests/test_setup_link.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const CODE = "CTV1-" + "Ab3_-".repeat(8) + "xyz";
const DESIGN = JSON.stringify({ design: { v: 1, background: { colour: "#112233" } } });

function load(answers, tvos) {
  const mem = {}, sent = [];
  const sandbox = {
    location: { search: "" },
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    atob: (s) => Buffer.from(s, "base64").toString("latin1"), setTimeout, clearTimeout,
    COUCH_CONFIG: { design_store: "https://designs.example" },
    fetch: (url, opt) => {
      sent.push({ url, body: JSON.parse(opt.body), opt });
      const a = answers.shift();
      if (a === "offline") return Promise.reject(new Error("down"));
      return Promise.resolve({ ok: a.status === 200, status: a.status, headers: { get: () => null }, text: () => Promise.resolve(a.body) });
    }
  };
  if (tvos) sandbox.TVOS = tvos;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sandbox);
  return { C: sandbox.window.CouchDesignCode, mem, sent, sandbox };
}
// a pretend app: holds a code until told it is done, and a link it never hands over
function app(code, linked) {
  const t = { code, done: 0, linked: !!linked, unlinked: 0 };
  t.setupDesignCode = () => t.code || "";
  t.setupDesignDone = () => { t.done++; t.code = ""; };
  t.accountLinked = () => t.linked;
  t.unlinkAccount = () => { t.unlinked++; t.linked = false; return true; };
  t.version = () => "0.13.12";
  t.memoryMb = () => 2048;
  return t;
}

(async () => {
  console.log("Running Setup link tests...");

  // ---- 1. Setup's code is fetched at once, like a typed one, and then forgotten ----
  {
    const tv = app(CODE);
    const t = load([{ status: 200, body: DESIGN }], tv);
    const d = await t.C.fromSetup();
    assert.ok(d && d.background, "the design arrived");
    assert.strictEqual(t.sent.length, 1);
    assert.strictEqual(t.sent[0].url, "https://designs.example/v1/designs/fetch", "the usual design-code fetch");
    assert.deepStrictEqual(t.sent[0].body, { code: CODE, tv: { v: "0.13.12", mem: 2048 } }, "code and tv {v, mem} only");
    assert.strictEqual(t.sent[0].opt.credentials, "omit");
    assert.strictEqual(tv.done, 1, "the app forgets it once it arrived");
    assert.ok(t.mem["couchtv.design.fetched"], "kept like a typed code");
    assert.strictEqual(t.mem["couchtv.design.ok"], undefined, "Use this design? still comes first");
    assert.strictEqual(await t.C.fromSetup(), null, "nothing the second time");
    assert.strictEqual(t.sent.length, 1);
  }
  // offline or busy: kept for the next start; used, gone or not a design: forgotten
  for (const [ans, keeps] of [["offline", true], [{ status: 429, body: "" }, true], [{ status: 503, body: "" }, true],
    [{ status: 404, body: "" }, false], [{ status: 200, body: "{\"nope\":1}" }, false], [{ status: 500, body: "" }, true]]) {
    const tv = app(CODE);
    const t = load([ans], tv);
    await assert.rejects(t.C.fromSetup());
    assert.strictEqual(tv.done, keeps ? 0 : 1, JSON.stringify(ans));
  }
  // only a whole CTV1 code is taken from the app; never a short code, never junk
  for (const bad of ["ABCDE-FGHJK", "CTV1-" + "a".repeat(42), CODE + "a", CODE.replace("Ab3", "A b"), "CTV1-" + "a".repeat(42) + "+", "<script>", 42]) {
    const t = load([], app(bad));
    assert.strictEqual(await t.C.fromSetup(), null, String(bad));
    assert.strictEqual(t.sent.length, 0, "nothing sent for " + bad);
  }
  {
    const t = load([], null);   // a browser, no app
    assert.strictEqual(await t.C.fromSetup(), null);
    assert.strictEqual(t.C.linked(), false);
    const thrower = app(CODE); thrower.setupDesignCode = () => { throw new Error("x"); };
    assert.strictEqual(await load([], thrower).C.fromSetup(), null, "an app that throws gives nothing");
  }

  // ---- 2. linked and unlink: a yes or no, never the link ----
  {
    const tv = app("", true);
    const t = load([], tv);
    assert.strictEqual(t.C.linked(), true);
    assert.strictEqual(t.C.unlink(), true);
    assert.strictEqual(tv.unlinked, 1);
    assert.strictEqual(t.C.linked(), false);
  }

  // ---- 3. The inbox answer the app hands over, read again as untrusted ----
  {
    const { C } = load([]);
    const r = (x) => JSON.parse(JSON.stringify(C.readInboxAnswer(x)));
    assert.deepStrictEqual(r(JSON.stringify({ state: "item", code: CODE, title: " Sunday <b>morning</b>\u0007 ", poll: 60 })),
      { state: "item", code: CODE, title: "Sunday bmorning/b", poll: 604800 }, "Studio says 60: the TV still looks once a week by itself");
    const WEEK = 604800;
    assert.strictEqual(C.INBOX_WEEK, WEEK); assert.strictEqual(C.INBOX_AWAY, 1800, "30 minutes away");
    assert.deepStrictEqual(r({ state: "none", poll: 5 }), { state: "none", poll: WEEK }, "never more often than a week");
    assert.deepStrictEqual(r({ state: "none", poll: 2 * WEEK }), { state: "none", poll: 2 * WEEK }, "a longer poll is honoured");
    assert.deepStrictEqual(r({ state: "none", poll: 1e12 }), { state: "none", poll: 1728000 }, "at most 20 days, so a timer can hold it");
    assert.deepStrictEqual(r({ state: "none" }), { state: "none", poll: WEEK });
    assert.deepStrictEqual(r({ state: "unlinked" }), { state: "unlinked" });
    assert.deepStrictEqual(r({ state: "wait", wait: 120 }), { state: "wait", wait: 120 }, "a 429 wait is kept as it is");
    assert.deepStrictEqual(r({ state: "wait", wait: 1 }), { state: "wait", wait: 30 });
    assert.deepStrictEqual(r({ state: "wait", wait: 1e9 }), { state: "wait", wait: 86400 });
    assert.deepStrictEqual(r({ state: "wait" }), { state: "wait", wait: 900 });
    for (const bad of [null, "", "x", "[]", { state: "item", code: "ABCDE-FGHJK" }, { state: "item", code: CODE + "x" }, { state: "boom" }])
      assert.deepStrictEqual(r(bad), { state: "error" }, JSON.stringify(bad));
    assert.strictEqual(C.inboxDelay({ state: "none", poll: 60 }), WEEK, "never sooner than a week, even unread");
    assert.strictEqual(C.inboxDelay({ state: "item", code: CODE, poll: 2 * WEEK }), 2 * WEEK);
    assert.strictEqual(C.inboxDelay({ state: "wait", wait: 600 }), WEEK, "after a wait: the next look by itself is a week away");
    assert.strictEqual(C.inboxDelay({ state: "error" }), WEEK, "after an error too: no retry loop");
    assert.strictEqual(C.inboxDelay({ state: "unlinked" }), 0, "unlinked: stop asking");
  }

  // ---- 4. Undo for a design from the account ----
  {
    const t = load([{ status: 200, body: DESIGN }]);
    const before = JSON.stringify({ design: { v: 1, background: { colour: "#000000" } }, at: 1 });
    t.mem["couchtv.design.fetched"] = before;
    t.mem["couchtv.design.ok"] = "sha256:old";
    const snap = t.C.snapshot("on");
    await t.C.get(CODE);
    assert.ok(t.C.holdUndo(snap, "Sunday morning", 1000));
    assert.strictEqual(t.C.undoHeld(2000).title, "Sunday morning");
    assert.strictEqual(t.C.undoFresh(2000).title, "Sunday morning", "the notice once");
    assert.strictEqual(t.C.undoFresh(3000), null, "and not again");
    assert.ok(t.C.undoHeld(3000), "Undo still there");
    assert.strictEqual(t.C.undoNew(4000), "on", "gives back the Designs choice");
    assert.strictEqual(t.mem["couchtv.design.fetched"], before, "the earlier design is back");
    assert.strictEqual(t.mem["couchtv.design.ok"], "sha256:old", "with its yes");
    assert.strictEqual(t.C.undoHeld(5000), null, "used once");
    assert.strictEqual(t.C.undoNew(5000), undefined);
  }
  {
    // nothing there before: Undo takes the design away again
    const t = load([{ status: 200, body: DESIGN }]);
    const snap = t.C.snapshot(null);
    await t.C.get(CODE);
    t.C.holdUndo(snap, "", 0);
    assert.strictEqual(t.C.undoNew(10), null);
    assert.strictEqual(t.mem["couchtv.design.fetched"], undefined);
    // a day later Undo is gone; a clock that went back does not trust it either
    t.C.holdUndo(snap, "", 1000);
    assert.strictEqual(t.C.undoHeld(1000 + 24 * 3600 * 1000 + 1), null);
    t.C.holdUndo(snap, "", 1000);
    assert.strictEqual(t.C.undoHeld(500), null);
  }
  {
    // a newer design (a typed code) drops the Undo for the older one from the account
    const t = load([{ status: 200, body: DESIGN }, { status: 200, body: DESIGN }]);
    await t.C.get(CODE);
    t.C.holdUndo(t.C.snapshot(null), "x");
    await t.C.get("ABCDE-FGHJK");
    assert.strictEqual(t.C.undoHeld(), null);
  }
  {
    // no room for the copy: no Undo rather than half of one
    const t = load([]);
    const set = t.sandbox.localStorage.setItem;
    t.sandbox.localStorage.setItem = (k, v) => { if (k === "couchtv.design.undo") throw new Error("QuotaExceededError"); set(k, v); };
    assert.strictEqual(t.C.holdUndo({ fetched: "x".repeat(100) }, "a"), false);
    assert.strictEqual(t.C.undoHeld(), null);
  }

  // ---- 5. app.js wiring and privacy ----
  const appJs = fs.readFileSync(path.join(web, "app.js"), "utf8");
  const dc = fs.readFileSync(path.join(web, "design-code.js"), "utf8");
  for (const s of ["setupDesign();", "inboxAsk(\"open\");", "inboxAsk(\"front\");", "inboxAway(); },", "accountNewNotice();", "accountInbox: function (raw)", "key: \"dz-unlink\"", "key: \"dz-undo\"", "inboxRow(\"dz-inbox-now\")", "Get my new design"])
    assert.ok(appJs.includes(s), "app.js has " + s);
  // the link never reaches the page: nothing here asks for it, names the extra, or the Studio inbox address
  // (app.js has its own "Bearer" for the home computer's key, so only the Studio words are looked for there)
  for (const s of ["account_link", "accountLink(", "/v1/setup/inbox"]) {
    assert.ok(!appJs.includes(s), "app.js never has " + s);
    assert.ok(!dc.includes(s), "design-code.js never has " + s);
  }
  assert.ok(!dc.includes("Bearer"), "design-code.js sends no token");
  // nothing of it goes in a design, a share or an export
  for (const f of ["share-home.js", "design.js"]) {
    const src = fs.readFileSync(path.join(web, f), "utf8");
    assert.ok(!/accountLinked|setupDesignCode|accountInbox|couchtv\.design\.undo/.test(src), f + " knows nothing of the link");
  }
  console.log("Setup link tests: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
