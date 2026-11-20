// The phone remote's way into the phone's Home settings page (20 Nov 2026):
//   remote/src/phonePage.js  whether the page is there, the widgets with settings, the link to each
//   remote/src/Sheets.jsx    More: Home settings on this phone, and Widgets on this TV
//   on-tv/web/setup.html     #widget=<id> opens that widget's box (the same records, the same save)
// A bridge TV gets both once its /api/health says phone_page (bridge/server.py serves_phone_page).
// Run: node tests/test_remote_phone_page.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { hasPhonePage, widgetsOf, phonePageLink, setupLink } from "../remote/src/phonePage.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ---- whether the page is there ----
ok(hasPhonePage(true, null), "the on-TV app: always");
ok(hasPhonePage(false, { ok: true, phone_page: true }), "a home computer that serves /setup");
ok(!hasPhonePage(false, { ok: true }), "a home computer without the page: nothing shows");
ok(!hasPhonePage(false, { ok: true, phone_page: "yes" }), "only a real true counts");
ok(!hasPhonePage(false, null), "no answer: nothing shows");

// ---- the widgets: the At home view's design.widgets, those with a setting that shows ----
const view = { ok: true, live: true, athome: { design: { on: true, widgets: [
  { key: "w1|weather", kind: "weather", name: "Weather", title: "Weather, top right", settings: [{ key: "place", type: "place", shown: true }] },
  { key: "w2|clock", kind: "clock", name: "Clock", title: "Clock, top left", settings: [{ key: "secs", type: "toggle", shown: false }] },
  { key: "w3|note", kind: "note", name: "Note", title: "Note, middle", settings: [] },
  { key: "stack 1/2|commute", kind: "commute", name: "Commute", title: "Commute, bottom", settings: [{ key: "to", type: "place" }] },
] } } };
eq(widgetsOf(view).map((w) => w.key), ["w1|weather", "stack 1/2|commute"], "only widgets with a setting that shows");
eq(widgetsOf({ ok: true, live: false }), [], "the TV home not open: none");
eq(widgetsOf({ ok: true, live: true, athome: { design: { on: false } } }), [], "no design: none");
eq(widgetsOf(null), [], "no answer: none");
eq(widgetsOf({ live: true, athome: { design: { on: true, widgets: [null, { settings: [{}] }] } } }), [], "broken rows are skipped");

// ---- the link, and that the page opens the same widget from it ----
eq(phonePageLink(view.athome.design.widgets[0]), "/setup#widget=w1");
eq(phonePageLink(view.athome.design.widgets[3]), "/setup#widget=stack%201%2F2", "a smart stack's widget id, escaped");
// ---- the TV this remote drives (Fable 4): a second TV on the same computer gets its own page ----
eq(setupLink(null), "/setup", "no TV chosen: the default TV's page");
eq(setupLink("bedroom"), "/setup?tv=bedroom");
eq(setupLink("bad id/../x"), "/setup", "an id the page would not read is never added");
eq(phonePageLink(view.athome.design.widgets[0], "bedroom"), "/setup?tv=bedroom#widget=w1");
const pageSrc = fs.readFileSync(path.join(root, "on-tv/web/setup.html"), "utf8");
const tvq = /var TVQ = (.*);\n/.exec(pageSrc)[1];
for (const tv of ["bedroom", "tv_2", "Lounge-TV"]) {
  const c = { location: { search: new URL("http://x" + phonePageLink(view.athome.design.widgets[0], tv)).search } };
  vm.runInNewContext("var got = " + tvq + ";", c);
  eq(c.got, tv, "setup.html reads the TV from the remote's link: " + tv);
}
const shimSrc = fs.readFileSync(path.join(root, "on-tv/web/shim.js"), "utf8");
ok(/realFetch\('\/api\/pair\/start' \+ \(TVQ \? '\?tv=' \+ TVQ : ''\)/.test(shimSrc), "Show a code on the TV asks for the page's own TV (shim.js)");
ok(/href=\{setupLink\(getTvId\(\)\)\}/.test(fs.readFileSync(path.join(root, "remote/src/Sheets.jsx"), "utf8")), "Home settings on this phone links to the driven TV's page");
const page = fs.readFileSync(path.join(root, "on-tv/web/setup.html"), "utf8");
const hw = page.slice(page.indexOf("function hashWidget()"), page.indexOf("\n", page.indexOf("function hashWidget()")));
for (const w of widgetsOf(view)) {
  const ctx = { location: { hash: phonePageLink(w).slice("/setup".length) } };
  vm.runInNewContext(hw + "\nvar got = hashWidget();", ctx);
  // the page's own match (openWanted): the box whose key, up to its last |, is the id
  ok(w.key.slice(0, w.key.lastIndexOf("|")) === ctx.got, "setup.html opens " + w.key + " from the link (got " + ctx.got + ")");
}

// ---- the More sheet uses it, for the on-TV app and a bridge that says so ----
const sheets = fs.readFileSync(path.join(root, "remote/src/Sheets.jsx"), "utf8");
ok(/<PhonePage open=\{open\} \/>/.test(sheets), "More draws PhonePage");
ok(!/window\.couchTv && \(\s*<a/.test(sheets), "Home settings on this phone is no longer for the on-TV app alone");
ok(/api\.health\(\)\.then\(\(h\) => hasPhonePage\(false, h\)/.test(sheets), "a bridge TV: gated on /api/health phone_page");
ok(/href=\{phonePageLink\(w, getTvId\(\)\)\}/.test(sheets) && /t\('widgets_on_tv'\)/.test(sheets), "one link per widget, under Widgets on this TV");
const api = fs.readFileSync(path.join(root, "remote/src/api.js"), "utf8");
ok(/athome: \(\) => call\('GET', '\/api\/athome'/.test(api), "the widgets come from GET /api/athome, the endpoint the page reads");

// ---- the words, in all 11 phone languages ----
const i18n = fs.readFileSync(path.join(root, "remote/src/i18n.js"), "utf8");
const blocks = ["S.en", "S['zh-CN']", "S.es", "S['es-MX']", "S.it", "S.de", "S.tr", "S['sr-Latn-RS']", "S.cs", "S.pl", "S.pt"];
for (const b of blocks) {
  const at = i18n.indexOf(b + " = {"), end = i18n.indexOf("\n};", at);
  const body = i18n.slice(at, end);
  ok(at >= 0 && /\n  widgets_on_tv: "[^"]+",/.test(body) && /\n  widgets_on_tv_note: "[^"]+",/.test(body), b + " has both words");
}
const en = (k) => new RegExp("\\n  " + k + ': "([^"]+)"').exec(i18n.slice(i18n.indexOf("S.en = {")))[1];
eq(en("widgets_on_tv"), "Widgets on this TV");
// a real translation in each, not the English copied
for (const b of blocks.slice(1)) {
  const body = i18n.slice(i18n.indexOf(b + " = {"));
  ok(!body.slice(0, body.indexOf("\n};")).includes('"Tap a widget to change its settings in Home settings on this phone."'), b + " is translated");
}

// ---- the on-TV app says it too ----
const kt = fs.readFileSync(path.join(root, "on-tv/android/app/src/main/java/dev/couchtv/ontv/Server.kt"), "utf8");
ok(/\.put\("phone_page", true\)/.test(kt), "the on-TV app's /api/health says phone_page");

console.log("remote phone page: " + n + " checks passed");
