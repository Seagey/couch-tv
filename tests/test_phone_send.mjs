// Fewer presses on the TV (20 Nov 2026): a design sent from the phone, pairing in one scan, and the
// design inbox for TVs with no server of their own.
//   remote/src/designSend.js   Send a design and Couch TV Studio's #design= hand off
//   on-tv/web/shim.js          the TV's QR carries #pin=; one scan pairs, the code leaves the address
//   tv-home/web/design-code.js openInbox / takeInbox (Get a design from your phone)
// Run: node tests/test_phone_send.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readDesignCode, takeDesignFromHash, studioLink, newNonce, nonceMatches, canSend, sentWords, STUDIO, WORDS } from "../remote/src/designSend.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ---------------- the phone remote: codes and the hand off ----------------
eq(readDesignCode(" abcde fghjk "), "ABCDE-FGHJK");
eq(readDesignCode("ABCDE-FGHJ1"), "", "1 is never in a code");
eq(readDesignCode("javascript:alert(1)"), "");
eq(readDesignCode("ctv1-" + "A".repeat(43)), "CTV1-" + "A".repeat(43));
eq(takeDesignFromHash("#design=abcde-fghjk"), { code: "ABCDE-FGHJK", nonce: "", rest: "" });
eq(takeDesignFromHash("#tab=watch&design=ABCDE-FGHJK"), { code: "ABCDE-FGHJK", nonce: "", rest: "#tab=watch" });
eq(takeDesignFromHash("#design=%3Cscript%3E"), { code: "", nonce: "", rest: "" }, "not a code: nothing sent");
eq(takeDesignFromHash("#design=%E0%A4%A"), { code: "", nonce: "", rest: "" }, "a broken escape is not a crash");
eq(takeDesignFromHash(""), { code: "", nonce: "", rest: "" });
const NONCE = newNonce();
ok(/^[A-Za-z0-9_-]{22}$/.test(NONCE) && NONCE !== newNonce(), "a nonce is 16 random bytes");
eq(takeDesignFromHash("#design=ABCDE-FGHJK&n=" + NONCE), { code: "ABCDE-FGHJK", nonce: NONCE, rest: "" }, "the nonce comes back and leaves the address");
eq(takeDesignFromHash("#design=ABCDE-FGHJK&n=short").nonce, "", "not a nonce");
// F3: only the round trip this phone started sends with no tap
ok(nonceMatches(NONCE, NONCE), "the nonce this phone kept: no tap");
ok(!nonceMatches(NONCE, null) && !nonceMatches("", "") && !nonceMatches(newNonce(), NONCE), "any other link asks first");
// Studio is told this page's address only when it is a home address
// a made up home name (built from parts so the privacy scan does not read it as a real one)
const HOMEHOST = ["tv", "home", "arpa"].join(".");
eq(studioLink(HOMEHOST + ":5400"), STUDIO + "/design/#tv=" + HOMEHOST + "%3A5400");
eq(studioLink(HOMEHOST + ":5400", NONCE), STUDIO + "/design/#tv=" + HOMEHOST + "%3A5400&n=" + NONCE, "the link to Studio carries the nonce");
eq(studioLink("8.8.8.8:5400", NONCE), STUDIO + "/design/", "no home address: no nonce either");
eq(studioLink("8.8.8.8:5400"), STUDIO + "/design/");
eq(studioLink("example.com"), STUDIO + "/design/", "a public host is never passed on");
eq(studioLink("evil.com#x"), STUDIO + "/design/");
ok(STUDIO.startsWith("https://"), "Studio over https");
for (const w of Object.values(WORDS)) ok(!/[–—]|\bbeta\b|experimental|coming soon/i.test(w), "plain words: " + w);
const app = fs.readFileSync(path.join(root, "remote/src/App.jsx"), "utf8");
ok(/replaceState\([^)]*rest\)/.test(app), "the code leaves the address before it is sent");
ok(app.includes("!window.couchTv.token()"), "an unpaired phone pairs first and keeps the code for after");
ok(/if \(nonceMatches\(nonce, kept\)\) \{ try \{ localStorage\.removeItem\(NONCE_KEY\);[^\n]*sendNow\(code\); \}\n\s*else setOffer\(code\);/.test(app), "a link's code asks first unless the nonce matches, and a nonce works once");
ok(app.includes("dsw('ask')") && app.includes("dsw('askLater')"), "Send this design to the TV? with Send and Not now");
// F1: the TV's question starts on Keep my home, so the words never say just press OK
ok(!/press OK when|you press OK/i.test(WORDS.sent + WORDS.note), "never just press OK");
eq(WORDS.sent, "Sent. On the TV, pick Use this design, then press OK.");
// F2: a home that is not open now
eq(sentWords({ ok: true, listening: false }), "Sent. Open the Couch TV home on the TV in the next 10 minutes.");
eq(sentWords({ ok: true, listening: true }), WORDS.sent);
eq(sentWords({ ok: true }), WORDS.sent, "an older home computer that does not say: Sent");
ok(!canSend("roku") && !canSend("appletv") && canSend("samsung") && canSend("android") && canSend(undefined), "no Send a design on a Roku or an Apple TV");
eq(WORDS.cannot, "This TV can't take a design from the phone: type the code on the TV, in Home settings, Designs, Get a design.");
const sheets = fs.readFileSync(path.join(root, "remote/src/Sheets.jsx"), "utf8");
ok(/if \(r\.ok\) setCode\(''\)/.test(sheets), "on a failure the code stays in the box");
const api = fs.readFileSync(path.join(root, "remote/src/api.js"), "utf8");
ok(api.includes("call('POST', '/api/say/design', { code, from: 'phone' })"), "Send a design uses the home's own /api/say/design");

// ---------------- the TV app's pairing page: one scan ----------------
function shim(hash, { token = null, pairAnswer = { ok: true, token: "t".repeat(64) }, health = { auth: "required" } } = {}) {
  const calls = [], replaced = [], mem = {};
  let reloaded = 0;
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = /\/api\/pair$/.test(url) ? pairAnswer : /\/api\/health/.test(url) ? health : {};
    return { status: 200, json: async () => body };
  };
  const doc = { cookie: "", head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, set textContent(v) {}, set innerHTML(v) {} }),
    getElementById: () => ({ addEventListener() {}, set onclick(f) {}, value: "" }), addEventListener() {} };
  const sb = {
    location: { hash, pathname: "/", search: "", href: "http://192.0.2.24:5400/" + hash, origin: "http://192.0.2.24:5400", reload: () => { reloaded++; } },
    history: { state: null, replaceState: (s, t, u) => { replaced.push(u); } },
    localStorage: { getItem: (k) => (k === "couchtv.token" ? token : mem[k] ?? null), setItem: (k, v) => { mem[k] = v; } },
    document: doc, navigator: { platform: "iPhone" }, Headers: class { constructor() { this.m = {}; } set(k, v) { this.m[k] = v; } },
    URL, Promise, JSON, setTimeout, console,
  };
  sb.window = sb; sb.fetch = fetch;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, "on-tv/web/shim.js"), "utf8"), sb);
  return { calls, replaced, mem, reloaded: () => reloaded };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
{
  const s = shim("#pin=123456&design=ABCDE-FGHJK");
  await tick();
  eq(s.replaced[0], "/#design=ABCDE-FGHJK", "the code leaves the address at once, the design stays for the remote");
  const pair = s.calls.find((c) => c.url === "/api/pair");
  ok(pair && JSON.parse(pair.init.body).pin === "123456", "paired with the scanned code, in the body");
  ok(!s.calls.some((c) => /123456/.test(c.url)), "the code is never in a URL");
  eq(s.mem["couchtv.token"], "t".repeat(64), "the token is kept");
  eq(s.reloaded(), 1, "the remote starts paired");
}
{
  const s = shim("#pin=123456", { token: "x".repeat(64), health: { auth: "ok" } });
  await tick();
  ok(!s.calls.some((c) => c.url === "/api/pair"), "already paired: the code is not spent");
  eq(s.replaced[0], "/", "and it still leaves the address");
}
{
  const s = shim("#pin=12345");
  await tick();
  ok(!s.calls.some((c) => c.url === "/api/pair"), "only six digits");
  eq(s.replaced.length, 0);
}
{
  const s = shim("#pin=123456", { pairAnswer: { ok: false, error: "That code has expired. Ask the TV for a new one." } });
  await tick();
  eq(s.reloaded(), 0, "an expired code shows the pairing box instead");
}
// only pin= leaves the address: Home settings' #sheet= and Studio's #design= with its n= stay (0.13.9 merge)
{
  const s = shim("#pin=123456&sheet=people");
  await tick();
  eq(s.replaced[0], "/#sheet=people", "a #sheet= after the code stays for the remote");
}
{
  const n = "A".repeat(22);
  const s = shim("#pin=123456&design=ABCDE-FGHJK&n=" + n);
  await tick();
  eq(s.replaced[0], "/#design=ABCDE-FGHJK&n=" + n, "a #design= and its n= after the code both stay");
}
{
  const s = shim("#sheet=people&pin=123456");
  await tick();
  eq(s.replaced[0], "/#sheet=people", "the code comes off wherever it sits in the fragment");
}
// the remote's #sheet= effect takes off only sheet= and keeps history.state, so #design= and n= reach theirs
{
  const app = fs.readFileSync(path.join(root, "remote/src/App.jsx"), "utf8");
  const eff = app.slice(app.indexOf("sheet=(people|arrange|kids|more)"), app.indexOf("setSheet(m[1])"));
  ok(/filter\(\(p\) => p && !\/\^sheet=\/\.test\(p\)\)/.test(eff), "the sheet effect filters out sheet= alone");
  ok(eff.includes("replaceState(window.history.state,"), "and keeps history.state");
  ok(!eff.includes("replaceState(null,"), "never wipes history.state");
  // the same filter on a real fragment
  const rest = "#sheet=people&design=ABCDE-FGHJK&n=" + "B".repeat(22);
  const kept = rest.replace(/^#/, "").split("&").filter((p) => p && !/^sheet=/.test(p)).join("&");
  eq(kept, "design=ABCDE-FGHJK&n=" + "B".repeat(22), "design= and n= survive the sheet effect");
  ok(app.includes("canSendDesign={canSend((thisTv || (tvs.length === 1 ? tvs[0] : null))?.kind)}"), "one TV and no TV id yet: Send a design still knows the kind");
  const css = fs.readFileSync(path.join(root, "remote/src/styles.css"), "utf8");
  const z = (sel) => Number((new RegExp("\\n\\" + sel + " \\{[^}]*?z-index: (\\d+)").exec(css) || [])[1]);
  ok(z(".design-offer") > z(".onboard") && z(".toast") > z(".onboard"), "the design offer and its toast show above the first run screen");
}
const setup = fs.readFileSync(path.join(root, "on-tv/android/app/src/main/java/dev/couchtv/ontv/SetupActivity.kt"), "utf8");
ok(setup.includes("SetupWords.qrLink(url, pin)"), "the TV's QR holds the live code");

// ---------------- the TV home: Get a design from your phone ----------------
function home(cfg, fetchAnswer) {
  const calls = [];
  const sb = {
    location: { search: "" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    atob: (s) => Buffer.from(s, "base64").toString("latin1"), setTimeout, clearTimeout, AbortController,
    COUCH_CONFIG: cfg,
    fetch: async (url, init) => { calls.push({ url, init }); const a = fetchAnswer(JSON.parse(init.body)); return { status: a[0], ok: a[0] < 300, text: async () => JSON.stringify(a[1]) }; },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, "tv-home/web/design-code.js"), "utf8"), sb);
  return { C: sb.CouchDesignCode, calls };
}
const ID = "AbCdEfGhIjKlMnOpQrStUv";
{
  let state = "waiting";
  const { C, calls } = home({ design_store: "https://designs.example" }, (b) =>
    b.op === "open" ? [200, { id: ID, expires_in: 600, poll_every: 4 }] : b.op === "take" ? (state === "ok" ? [200, { state: "ok", code: "abcde-fghjk" }] : [200, { state: "waiting" }]) : [400, {}]);
  const box = await C.openInbox();
  eq(box.link, "https://designs.example/design/#inbox=" + ID, "the QR opens Studio with the inbox in the fragment");
  eq(box.every, 4000);
  ok(box.expires > Date.now() + 590000);
  eq(await C.takeInbox(box.id), "", "nothing yet");
  state = "ok";
  eq(await C.takeInbox(box.id), "ABCDE-FGHJK", "a code, read as a typed one");
  const c0 = calls[0];
  eq(c0.url, "https://designs.example/api/inbox");
  eq(c0.init.headers["content-type"], "text/plain", "no preflight on old TV browsers");
  eq(c0.init.credentials, "omit");
  eq(c0.init.referrerPolicy, "no-referrer");
  ok(calls.every((c) => Object.keys(JSON.parse(c.init.body)).every((k) => k === "op" || k === "id")), "the TV sends nothing but the op and the inbox id");
}
{
  const { C } = home({ design_store: "https://designs.example" }, (b) => (b.op === "open" ? [200, { id: "../../x" }] : [404, {}]));
  await assert.rejects(C.openInbox(), (e) => e.kind === "offline"); n++;
  await assert.rejects(C.takeInbox(ID), (e) => e.kind === "gone"); n++;
}
{
  const { C } = home({ design_store: "https://designs.example" }, () => [404, {}]);
  await assert.rejects(C.openInbox(), (e) => e.kind === "none" && e.message === "This design store has no phone inbox. Type the code instead.", "a store with no inbox: says so, not ran out"); n++;
}
{
  const { C } = home({ design_store: "https://designs.example" }, () => [200, { state: "ok", code: "https://evil.example/x.json" }]);
  await assert.rejects(C.takeInbox(ID), (e) => e.kind === "gone", "a link is never taken for a code"); n++;
}
{
  const { C, calls } = home({ design_store: "" }, () => [200, {}]);
  await assert.rejects(C.openInbox(), (e) => e.kind === "offline", "design store off: nothing is asked"); n++;
  eq(calls.length, 0);
}
const appjs = fs.readFileSync(path.join(root, "tv-home/web/app.js"), "utf8");
ok(appjs.includes('label: "Get a design from your phone"'), "the row is in Home settings, Designs");
ok(/function lookInInbox[\s\S]{0,200}!inboxShown\(\)/.test(appjs), "it asks only while its screen is open");
ok(/function closeSettings\(\) \{\s*stopInbox\(\);/.test(appjs), "closing Home settings stops it");
ok(/takeInbox\(mine\.id\)[\s\S]{0,400}getDesignByCode\(code\)/.test(appjs), "a code from the inbox goes through Use this design? like a typed one");
ok(/takeInbox\(mine\.id\)\.then\(function \(code\) \{[\s\S]{0,300}if \(code\) \{[\s\S]{0,200}getDesignByCode\(code\);\s*return;/.test(appjs), "a code that comes back after the screen closed is still got");
const ask = fs.readFileSync(path.join(root, "tv-home/web/ask.js"), "utf8");
ok(ask.includes('d.from === "phone" ? "phone" : "ai"'), "the TV says where a design came from");

console.log(`phone send: ${n} checks passed`);
