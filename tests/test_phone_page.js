// The TV home's side of the phone's Home settings page through a home computer (tv-home/web/phone-page.js):
// each change from the phone is applied as the on-TV app's hand over does and answered, the At home view
// is handed over only when it changed (or the computer has none), a town or photo from the phone makes
// the home take the computer's copy of Home settings, and a code asked for on the phone shows as a line.
//   node tests/test_phone_page.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

function load() {
  const body = { kids: [], appendChild(e) { this.kids.push(e); e.parentNode = this; }, removeChild(e) { this.kids = this.kids.filter((x) => x !== e); e.parentNode = null; } };
  const doc = { hidden: false, body, createElement: () => ({ style: {}, setAttribute() {}, textContent: "" }) };
  const timers = [];
  const W = { document: doc };
  const ctx = { window: W, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, Promise, JSON, Math, String, Array, Object };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../tv-home/web/phone-page.js"), "utf8"), ctx);
  return { P: W.CouchPhonePage, body, timers };
}

(async () => {
  // ---- changes in, answers out
  {
    const { P, timers } = load();
    const calls = [], edits = [];
    let view = { note: null }, synced = 0;
    const api = (m, p, b) => { calls.push([m, p, b]); return Promise.resolve(m === "GET" ? { ok: true, edits: [], fast: false, settings_at: "t0" } : { ok: true }); };
    P.start({ api, read: () => view, edit: (e) => { edits.push(e); view = { note: e.note }; return { ok: true, athome: view }; }, sync: () => { synced++; }, words: (c) => "Code for your phone: " + c });
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    ok(calls[0][0] === "GET" && calls[0][1] === "/api/phone/inbox?home=1", "the home asks its inbox at once");
    ok(calls.some((c) => c[1] === "/api/phone/view" && c[2].athome.note === null), "and hands over its view the first time");
    ok(timers.length && timers[timers.length - 1].ms === 10000, "then asks every 10 seconds");
    calls.length = 0;
    await P.took({ edits: [{ id: 7, edit: { note: { text: "Dinner at 6" } } }], fast: true, settings_at: "t0" });
    ok(edits.length === 1 && edits[0].note.text === "Dinner at 6", "a change from the phone is applied (atHomeEdit)");
    const done = calls.find((c) => c[1] === "/api/phone/done");
    ok(done && done[2].id === 7 && done[2].result.ok && done[2].result.athome.note.text === "Dinner at 6", "and its answer goes back with its id");
    ok(calls.some((c) => c[1] === "/api/phone/view" && c[2].athome.note.text === "Dinner at 6"), "the changed view is handed over");
    calls.length = 0;
    await P.took({ edits: [], fast: true, settings_at: "t0" });
    ok(!calls.some((c) => c[1] === "/api/phone/view"), "an unchanged view is not sent again");
    await P.took({ edits: [], fast: true, settings_at: "t0", want_view: true });
    ok(calls.some((c) => c[1] === "/api/phone/view"), "unless the computer has none (it started again)");
    ok(synced === 0, "no settings taken while the stamp is the same");
    await P.took({ edits: [], settings_at: "t1" });
    ok(synced === 1, "a new Home settings stamp (a town or photo from the phone): the home takes the computer's copy");
    // a change the home cannot read, or that throws: answered, never left waiting
    calls.length = 0;
    const P2 = load().P;
    P2.start({ api: (m, p, b) => { calls.push([m, p, b]); return Promise.resolve({ ok: true, edits: [] }); }, read: () => null, edit: () => { throw new Error("x"); }, sync() {} });
    await P2.took({ edits: [{ id: 3, edit: { lists: [] } }] });
    const d2 = calls.find((c) => c[1] === "/api/phone/done");
    ok(d2 && d2[2].id === 3 && d2[2].result.ok === false && d2[2].result.error, "a change that fails is answered with an error");
    P.stop(); P2.stop();
  }
  // ---- the code line
  {
    const { P, body } = load();
    P.start({ api: () => Promise.resolve({ ok: true }), read: () => null, edit: () => ({ ok: true }), sync() {}, words: (c) => "Code for your phone: " + c });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));   // its first ask, done
    await P.took({ edits: [], pin: { code: "482913", seconds: 170 } });
    ok(body.kids.length === 1 && body.kids[0].textContent === "Code for your phone: 482 913", "a code asked for on the phone shows as a line: " + (body.kids[0] || {}).textContent);
    ok(P.code() === "482913", "the line holds that code");
    await P.took({ edits: [] });
    ok(body.kids.length === 0, "and goes once the code is used or runs out");
    // the Couch TV home app's own page shows it the same way, with the page's words
    P.stop();
    P.words = (c) => "Kod dla telefonu: " + c;
    P.showCode("123456", 60);
    ok(body.kids.length === 1 && body.kids[0].textContent === "Kod dla telefonu: 123 456", "in the home's language without a computer too");
    P.showCode("");
    ok(body.kids.length === 0, "taken off");
  }
  // ---- a used or thrown away code: the QR asks again at once (Fable 7)
  {
    const { P } = load();
    let qr = 0;
    P.start({ api: () => Promise.resolve({ ok: true }), read: () => null, edit: () => ({ ok: true }), sync() {}, qr: () => { qr++; } });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    await P.took({ edits: [], pin_gen: 4 });
    ok(qr === 0, "the first answer only notes the code's number");
    await P.took({ edits: [], pin_gen: 4 });
    ok(qr === 0, "the same code: the QR is left alone");
    await P.took({ edits: [], pin_gen: 5 });
    ok(qr === 1, "a phone used the code (or 5 wrong tries threw it away): the QR is drawn again");
    await P.took({ edits: [] });
    ok(qr === 1, "an older computer that sends no number: nothing");
    P.stop();
  }
  // ---- every language has the line's words
  {
    const src = fs.readFileSync(path.join(__dirname, "../tv-home/web/i18n.js"), "utf8");
    const blocks = (src.match(/set_phone_pc:/g) || []).length, words = src.match(/phone_code: "[^"]*\{code\}[^"]*"/g) || [];
    ok(blocks === 16 && words.length === blocks, "phone_code is in all " + blocks + " language blocks, each with {code}: " + words.length);
    ok(!words.some((w) => /[–—]/.test(w)), "no long dashes in it");
  }
  console.log("phone page (TV home side) tests: " + n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
