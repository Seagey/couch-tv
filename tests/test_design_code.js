// Getting a design by code (tv-home/web/design-code.js): what the TV takes from the store's answer,
// which codes it sends at all, which store it will ask, and that arriving always means asking first.
// Run: node tests/test_design_code.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
function load(search, cfg) {
  const mem = {};
  const sandbox = {
    location: { search: search || "" },
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    atob: (s) => Buffer.from(s, "base64").toString("latin1"), setTimeout, clearTimeout,
    COUCH_CONFIG: cfg || {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(web, "design-code.js"), "utf8"), sandbox);
  return { C: sandbox.window.CouchDesignCode, mem, sandbox };
}

console.log("Running design code tests...");
const { C, mem } = load("", { design_store: "https://designs.example" });

// which store: https only, or this computer; never a path, never anything else
assert.strictEqual(C.base(), "https://designs.example");
for (const bad of ["http://designs.example", "https://designs.example/x", "javascript:alert(1)", "//evil", "https://a@example.com", "ftp://x", 5]) {
  assert.strictEqual(load("", { design_store: bad }).C.base(), "", String(bad));
}
assert.strictEqual(load("", { design_store: "http://127.0.0.1:5490" }).C.base(), "http://127.0.0.1:5490");
assert.strictEqual(load("?designstore=http%3A%2F%2F127.0.0.1%3A5490", {}).C.base(), "", "the address switch is for the mock preview only");
assert.strictEqual(load("?mock=1&designstore=http%3A%2F%2F127.0.0.1%3A5490", {}).C.base(), "http://127.0.0.1:5490");
assert.strictEqual(load("?mock=1&designstore=https%3A%2F%2Fevil.example%2Fx", {}).C.base(), "");

// codes: short ones forgivingly, long ones exactly, nothing else is sent
assert.strictEqual(C.readCode("  abcde fghjk "), "ABCDE-FGHJK");
assert.strictEqual(C.readCode("ABCDE-FGHJ0"), "");
assert.strictEqual(C.readCode("http://evil"), "");

// 0.13.5: the Check step (a TCL keyboard dropped a letter from "RSTFD-5EEDN"): any case, no dash needed,
// always shown as ABCDE-FGHJK, and a short or wrong code says plainly what is wrong
let ck = C.checkCode("rstfd5eedn");
assert.ok(ck.ok && ck.code === "RSTFD-5EEDN" && ck.shown === "RSTFD-5EEDN", "no dash, lower case: a whole code");
ck = C.checkCode(" Rstfd - 5eedn ");
assert.ok(ck.ok && ck.code === "RSTFD-5EEDN", "spaces and a dash anywhere are fine");
ck = C.checkCode("rstfd-5een");
assert.ok(!ck.ok && ck.shown === "RSTFD-5EEN" && ck.count === 9 && /9 of the 10 letters/.test(ck.msg) && /One is missing/.test(ck.msg), "a dropped letter: 9 of 10, one missing");
ck = C.checkCode("rstf");
assert.ok(!ck.ok && ck.shown === "RSTF" && /6 are missing/.test(ck.msg), "a short start: no dash yet, six missing");
ck = C.checkCode("RSTFD-5EEDO");
assert.ok(!ck.ok && /O is never in a code/.test(ck.msg), "a letter codes never use is named");
assert.strictEqual(ck.count, 9, "only letters a code can have are counted (O is not)");
ck = C.checkCode("RSTFD-5EED");
assert.strictEqual(ck.count, 9);
ck = C.checkCode("RSTFDO5EEDN");
assert.ok(!ck.ok && ck.count === 10 && /O is never/.test(ck.msg), "an extra wrong letter is named, and not counted");
ck = C.checkCode("RSTFD-5EEDNN");
assert.ok(!ck.ok && /11 letters/.test(ck.msg), "one too many");
assert.ok(!C.checkCode("").ok && /Nothing was typed/.test(C.checkCode("").msg));
// 0.13.6: a stray "_" or "." said "That is 10 letters. A code has 10."; now the mark is named
ck = C.checkCode("RSTFD_5EEDN");
assert.ok(!ck.ok && /The _ is not part of a code/.test(ck.msg) && /all 10 are there/.test(ck.msg) && !/A code has 10/.test(ck.msg), "a stray _ is named (" + ck.msg + ")");
ck = C.checkCode("rstfd.5een");
assert.ok(!ck.ok && /The \. is not part of a code/.test(ck.msg) && !/all 10/.test(ck.msg), "a stray . with a letter missing is named");
ck = C.checkCode("RS.TF_D5EEDN");
assert.ok(/The \. and _ are not part/.test(ck.msg), "two marks are both named");
for (const m of ["RSTFD_5EEDN", "rstfd.5een"]) assert.ok(!/[–—]/.test(C.checkCode(m).msg), "no long dashes in the words");
assert.ok(C.checkCode("CTV1-" + "A".repeat(43)).ok, "the long code from the QR still works");
for (const m of ["", "rstf", "RSTFD-5EEDO", "RSTFD-5EEDNN", "rstfd-5een"]) assert.ok(!/[–—]/.test(C.checkCode(m).msg), "no long dashes in the words");
assert.strictEqual(C.readCode("CTV1-" + "a".repeat(43)), "CTV1-" + "a".repeat(43));

// the answer: only its design; the only picture a real JPEG inside it
const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]).toString("base64");
const svgAsJpeg = "data:image/jpeg;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64");
let d = C.accept(JSON.stringify({ design: { v: 1, background: { image: jpeg } }, accepted: true, ok: "sha256:x" }));
assert.strictEqual(d.background.image, jpeg);
assert.strictEqual(d.accepted, undefined);
for (const img of [svgAsJpeg, "https://198.51.100.7/b.jpg", "data:image/png;base64,iVBORw0KGgo=", "backgrounds/../x.jpg", "//evil/x.jpg", 7]) {
  d = C.accept(JSON.stringify({ design: { background: { image: img, darken: 0.2 } } }));
  assert.strictEqual(d.background.image, undefined, String(img));
  assert.strictEqual(d.background.darken, 0.2);
}
for (const bad of ["", "nope", "[]", '{"design":[]}', '{"design":"x"}', "null", "x".repeat(4000001)]) assert.strictEqual(C.accept(bad), null, bad.slice(0, 20));

// arriving: kept, and every earlier yes (and the switched off flag) forgotten, so the question shows
mem["couchtv.design.ok"] = "sha256:abc";
mem["couchtv.design.no"] = "sha256:def";
mem["couchtv.design.off"] = "1";
const json = JSON.stringify({ design: { v: 1, objects: [{ id: "a", type: "text", text: "Hi" }] } });
const sb = load("", { design_store: "http://127.0.0.1:1" });
Object.assign(sb.mem, mem);
sb.sandbox.fetch = () => Promise.resolve({ status: 200, ok: true, headers: { get: () => null }, text: () => Promise.resolve(json) });
sb.C.get("abcde-fghjk").then((got) => {
  assert.strictEqual(got.objects[0].text, "Hi");
  assert.strictEqual(sb.mem["couchtv.design.ok"], undefined);
  assert.strictEqual(sb.mem["couchtv.design.no"], undefined);
  assert.strictEqual(sb.mem["couchtv.design.off"], undefined);
  assert.ok(sb.C.kept());
  // the designer's own preview never takes it
  const des = load("?designer=1", {}); des.mem["couchtv.design.fetched"] = sb.mem["couchtv.design.fetched"];
  assert.strictEqual(des.C.kept(), null);
  // a bad code never reaches fetch
  let called = false;
  sb.sandbox.fetch = () => { called = true; return Promise.reject(new Error("x")); };
  return sb.C.get("http://evil").then(() => assert.fail("should refuse"), (e) => { assert.strictEqual(called, false); assert.strictEqual(e.kind, "nocode"); });
}).then(() => {
  sb.sandbox.fetch = () => Promise.resolve({ status: 404, ok: false, headers: { get: () => null }, text: () => Promise.resolve("{}") });
  return sb.C.get("ABCDE-FGHJK").then(() => assert.fail("404"), (e) => assert.strictEqual(e.kind, "notfound"));
}).then(() => { console.log("design code tests passed"); }).catch((e) => { console.error(e); process.exit(1); });
