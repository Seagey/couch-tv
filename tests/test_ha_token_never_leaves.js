// A Home Assistant token never leaves the TV through a design (tv-home/web/design.js sanitize), a Share
// this home snapshot (share-home.js build and prepare) or what the TV sends to the store (share-home.js
// send: the body of POST /v1/shares). Not even when someone types it into a widget's options, a text
// object, a name, the home's settings, or puts config.json's home_assistant block (its url and token)
// into a design. The token here is made up for the test: shaped like a real long-lived access token
// (a JWT), a key of letters and digits, a hex secret, and a bearer header.
// Run: node tests/test_ha_token_never_leaves.js
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
for (const f of ["app-catalogue.js", "design.js", "qr.js", "share-home.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
const CD = sb.window.CouchDesign, S = sb.window.CouchShare;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const plain = (v) => JSON.parse(JSON.stringify(v));
console.log("Running Home Assistant token tests...");

// made-up secrets in the shapes a Home Assistant token and its config take
// (built here at run time, so no token-shaped string sits in the repo for a secret scanner to trip on)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ iss: "made up for a test", iat: 1700000000, exp: 2015360000 }) + "." + Buffer.from("not a real signature at all, 42").toString("base64url");
const LETTERS = Array.from({ length: 48 }, (_, i) => "aB3cD7eF1gH9iJ5kLmN2oP8qR4sT6uV0wXyZ"[(i * 7) % 36]).join("");   // a key in letters and digits, no eyJ
const HEX = Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(i * 11 + 3) % 16]).join("");
const BEARER = "Bearer " + JWT;
const URL = ["http:/", "", ["homeassistant", "local"].join(".") + ":" + (8000 + 123)].join("/");
const SECRETS = [JWT, LETTERS, HEX, BEARER, URL];
const ALL = [JWT, LETTERS, HEX, BEARER, URL];
// a design leaks a secret if any 16 characters in a row of it turn up (a token cut to fit is still a leak)
function leaks(value) {
  const text = JSON.stringify(value || {});
  const out = [];
  SECRETS.forEach((s) => { for (let i = 0; i + 16 <= s.length; i++) if (text.indexOf(s.slice(i, i + 16)) >= 0) { out.push(s.slice(0, 12) + "... at " + i); break; } });
  if (/HOME_ASSISTANT_TOKEN|home_assistant|long.?lived/i.test(text)) out.push("the token's name");
  return out;
}

// every option of every widget kind, each one given each secret, and in the widget's style and name
const WOPT = CD.wopts(), kinds = CD.wkinds();
const objects = [];
kinds.forEach((kind, k) => {
  const keys = String(WOPT[kind] || "").split(" ").filter(Boolean).concat(["token", "home_assistant", "url", "secret", "auth"]);
  ALL.forEach((s, j) => {
    const opts = {};
    keys.forEach((key) => { opts[key] = key === "controls" || key === "cities" || key === "apps" || key === "quick" || key === "switches" || key === "players" || key === "tickers" || key === "shows" ? [s, { name: s, entity: s, icon: s }] : s; });
    objects.push({ id: "w" + k + "_" + j, type: "widget", kind, x: 80, y: 60, w: 360, h: 160, name: s, opts, style: { font: s, colour: s, accent: s, label: s }, token: s, home_assistant: { url: URL, token: s } });
  });
});
// the other objects: words, a clock, weather, a smart control, a group, a stack of widgets
ALL.forEach((s, j) => {
  objects.push({ id: "t" + j, type: "text", text: s, name: s, font: s, x: 100, y: 100, size: 40 });
  objects.push({ id: "tt" + j, type: "text", text: "Hello\n" + s + "\nthere", x: 100, y: 100 });
  objects.push({ id: "c" + j, type: "clock", size: 120, name: s, date_format: s, font: s });
  objects.push({ id: "wx" + j, type: "weather", style: "card", place: s, name: s });
  objects.push({ id: "s" + j, type: "smart", kind: "aircon", entity: "climate." + s, zones: [s], items: [s], name: s, token: s });
  objects.push({ id: "g" + j, type: "group", name: s, controls: [{ kind: s, label: s, entity: s }] });
  objects.push({ id: "st" + j, type: "widget", kind: "stack", w: 360, h: 360, x: 80, y: 60, items: [{ kind: "card", opts: { label: s, text: s } }, { kind: "note", opts: { text: s } }] });
});
const design = {
  v: 1, name: JWT, author: JWT, token: JWT, home_assistant: { url: URL, token: JWT, climate: [{ entity: "climate.lounge", name: "Lounge" }] }, HOME_ASSISTANT_TOKEN: JWT,
  background: { colour: "#26303f", image: URL + "/local/" + JWT + ".jpg", video: "store:" + JWT.slice(0, 40), token: JWT },
  home: { scenes: [JWT, "night"], clock_style: JWT, glass: LETTERS, token: JWT, home_assistant: { token: JWT } },
  elements: { clock: { format: "12h", text: JWT, token: JWT }, weather: { place: JWT, name: LETTERS } },
  apps: { order: [JWT, "netflix"], names: { netflix: JWT } },
  look: { font: JWT, accent: JWT, paper: JWT },
  objects
};

// 1. the TV's own gate: nothing of the token survives a design, whatever the field
// (a design holds at most 40 objects, so the objects go through in designs of 30)
let kept = 0;
for (let i = 0; i < objects.length; i += 30) {
  const clean = plain(CD.sanitize(plain(Object.assign({}, design, { objects: objects.slice(i, i + 30) }))));
  kept += (clean.objects || []).length;
  ok(leaks(clean).length === 0, "a sanitised design carries no token, no Home Assistant address and no home_assistant block (objects " + i + " on): " + leaks(clean).join("; "));
}
ok(kept > objects.length / 2, "the objects themselves survive the gate (" + kept + " of " + objects.length + "): only the secrets are taken out");
// and words that are fine still show (the gate is not just dropping everything)
const words = plain(CD.sanitize({ v: 1, objects: [{ id: "a", type: "text", text: "Hello there", x: 0, y: 0 }] }));
ok(words.objects && words.objects[0] && words.objects[0].text === "Hello there", "plain words still pass the gate");

// 2. Share this home: a home with a design on, and one without, each with the token put in everywhere
const snapDesign = { design: plain(Object.assign({}, design, { objects: objects.slice(0, 30) })), scenes: ["night"], builtIn: ["night"], dock: [JWT, "com.netflix.ninja"] };
const built = plain(S.build(plain(snapDesign)));
const prepared = S.prepare(plain(snapDesign), ["Alex"], CD);
ok(!prepared.error || /private/.test(prepared.error), "Share this home either shares or says something private stopped it (" + (prepared.error || "shared") + ")");
if (prepared.design) ok(leaks(prepared.design).length === 0, "a shared home with a design carries no token: " + leaks(prepared.design).join("; "));
const snapHome = { design: null, scenes: [JWT, "night"], builtIn: ["night", JWT.slice(0, 20)], scene_seconds: 20, clock24: true, clock_style: JWT, glass: JWT, dock: [JWT, LETTERS, "com.netflix.ninja"], token: JWT, home_assistant: { url: URL, token: JWT } };
const preparedHome = S.prepare(plain(snapHome), ["Alex"], CD);
ok(preparedHome.design || preparedHome.error, "a home without a design: shared or stopped");
if (preparedHome.design) ok(leaks(preparedHome.design).length === 0, "a shared home without a design carries no token: " + leaks(preparedHome.design).join("; "));
// the gate is what the TV uses; without it the share check still never lets a token through
const noGate = S.prepare(plain(snapDesign), ["Alex"], null);
ok(noGate.error || leaks(noGate.design).length === 0, "without the gate, a token never goes either: " + (noGate.design ? leaks(noGate.design).join("; ") : noGate.error));
const homeNoGate = S.prepare(plain(snapHome), ["Alex"], null);
ok(homeNoGate.error || leaks(homeNoGate.design).length === 0, "a home without a design and without the gate: a token never goes either: " + (homeNoGate.design ? leaks(homeNoGate.design).join("; ") : homeNoGate.error));
ok(/private/.test(S.prepare({ design: { v: 1, home: { glass: JWT } } }, [], null).error || ""), "the share check itself stops a token (says something private is in it)");
ok(/private/.test(S.prepare({ design: { v: 1, home: { glass: HEX } } }, [], null).error || ""), "and a long run of letters and digits (a key)");
void built;

// 3. what the TV sends to the store: POST /v1/shares with {design} only, no cookies, no token
const sent = [];
const fakeFetch = (url, init) => { sent.push({ url, init }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: "ABCDE-FGHJK", token: "CTV1-" + "a".repeat(43) }) }); };
const toSend = prepared.design || preparedHome.design || { v: 1, home: { scenes: ["night"] } };
S.send("https://designs.example", toSend, fakeFetch).then(() => {
  ok(sent.length === 1 && sent[0].url === "https://designs.example/v1/shares", "one POST to the store's /v1/shares");
  const init = sent[0].init, body = JSON.parse(init.body);
  ok(Object.keys(body).join() === "design", "the body is {design} and nothing else");
  ok(leaks(init.body).length === 0, "the body carries no token: " + leaks(init.body).join("; "));
  ok(init.credentials === "omit" && init.referrerPolicy === "no-referrer", "no cookies and no referrer");
  ok(!/authorization|bearer|token/i.test(JSON.stringify(init.headers || {})), "no Authorization header and no token in the headers");
  console.log("All " + n + " Home Assistant token tests passed.");
}).catch((e) => { console.error(e); process.exit(1); });
