// "Can't connect?" on Home settings on the phone (on-tv/web/setup.html + connect-check.js), in a real browser,
// against a stand-in TV whose GET /api/adb/check answers what the test says:
//  1. Every answer the TV can give (ConnectCheck.kt CODES) shows its own plain words and fix; an answer the
//     page does not know falls back to "couldn't find the cause".
//  2. A phone that can't reach the TV (the connection dropped, or no answer in time) says so itself.
//  3. Copy a report puts the TV's report plus the page language on the clipboard (localhost: the clipboard
//     API, read back), and on a plain http home address (not a secure context) falls back to a copy from a
//     box, which shows what was copied. The phone's own report has no addresses.
//  4. Every phone page language: each line is there (es-MX may use es), no dashes, the TV's language
//     (the answer's lang) is followed, he and ar read right to left.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_connect_check_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// the codes the TV's check can answer, read from the Kotlin so the two never drift apart
const kt = fs.readFileSync(path.join(ROOT, "on-tv/android/app/src/main/java/dev/couchtv/ontv/ConnectCheck.kt"), "utf8");
const KT_CODES = [...kt.match(/val CODES = listOf\(([^)]*)\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
ok(KT_CODES.length === 11 && KT_CODES.includes("ethernet") && KT_CODES.includes("allow_unanswered"), "codes read from ConnectCheck.kt: " + KT_CODES.join(","));

const TOKEN = "t0k3n";
const REPORT = "Couch TV report\nApp: on-TV 0.13.9\nTV: TCL 55C735, Android 14 (API 34)\nNetwork: Ethernet\nCheck says: ethernet\nLast error: [address]:5555 closed";
let CHECK = { code: "ok" };          // what /api/adb/check answers; mode "drop" or "hang" for no answer
let MODE = "answer";
const HS = { settings: { lang: "en", photos: [] }, people: [], weather: null, country: "AU", tv_name: "Lounge",
  ask: { enabled: false, provider: "anthropic", base: "", model: "", has_key: false }, phones: 1, port: 5400,
  adb: { connected: false, sdk: 34, state: "failed" }, xiaomi: false, inputs: [] };
const send = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
let checks = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  req.resume();
  req.on("end", () => {
    const authed = (req.headers.authorization || "") === "Bearer " + TOKEN;
    if (u.pathname === "/setup") { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web/setup.html"))); return; }
    if (u.pathname.startsWith("/ontv/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(ROOT, "on-tv/web", path.basename(u.pathname)))); return; }
    if (!u.pathname.startsWith("/api/")) { res.writeHead(404); res.end(); return; }
    if (!authed) return send(res, 401, { ok: false, error: "pair this phone first" });
    if (u.pathname === "/api/adb/check") {
      checks++;
      if (MODE === "drop") { req.socket.destroy(); return; }
      if (MODE === "hang") return;          // never answers: the page gives up by itself
      return send(res, 200, Object.assign({ ok: true, report: REPORT }, CHECK));
    }
    if (u.pathname === "/api/settings") return send(res, 200, Object.assign({ ok: true }, HS));
    return send(res, 200, { ok: true });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP tv.test 127.0.0.1"] });
const errors = [];
async function openPage(host, langs) {
  const ctx = await browser.newContext({ locale: langs || "en-AU", viewport: { width: 390, height: 844 } });
  if (host === "127.0.0.1") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:" + PORT });
  await ctx.addInitScript((t) => { try { localStorage.setItem("couchtv.token", t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (/connect-check|ConnectCheck/.test(String(e.stack))) errors.push(String(e)); });
  await page.goto("http://" + host + ":" + PORT + "/setup");
  await page.waitForFunction(() => document.querySelector("#cc .cc-head") && document.querySelector("#cc").getAttribute("data-code"));
  // the sections start shut: open Let the phone press keys by its title, as a person does
  await page.locator("section", { has: page.locator("#cc") }).locator(".fold-btn").click();
  await page.locator("#cc .cc-check").waitFor({ state: "visible" });
  return { ctx, page };
}
const state = (page) => page.evaluate(() => {
  const el = document.getElementById("cc");
  return { code: el.getAttribute("data-code"), head: el.querySelector(".cc-head").textContent, fix: el.querySelector(".cc-fix").textContent,
    title: el.querySelector(".cc-title").textContent, dir: el.getAttribute("dir"), lang: el.getAttribute("lang"),
    check: el.querySelector(".cc-check").textContent, copy: el.querySelector(".cc-copy").textContent, msg: el.querySelector(".cc-msg").textContent,
    box: el.querySelector(".cc-report").value, boxShown: el.querySelector(".cc-report").style.display !== "none", secure: window.isSecureContext };
});
async function checkNow(page) {
  const before = checks;
  await page.click("#cc .cc-check");
  await page.waitForFunction(() => !/Checking/.test(document.querySelector("#cc .cc-head").textContent));
  return before;
}

try {
  // ---- 1. every answer, in English ----
  const { ctx, page } = await openPage("127.0.0.1");
  const W = await page.evaluate(() => window.ConnectCheck.words);
  let s = await state(page);
  ok(checks >= 1 && s.code === "ok" && s.head === W.ok.en && s.fix === "", "the check runs by itself once paired: " + JSON.stringify(s));
  ok(s.title === "Can't connect?" && s.check === "Check now" && s.copy === "Copy a report", "the title and both buttons in plain words");
  // the box sits in Let the phone press keys, under its message line
  ok(await page.evaluate(() => document.getElementById("adb-msg").nextElementSibling.id === "cc"), "the check sits under Let the phone press keys");
  for (const code of KT_CODES.filter((c) => c !== "ok")) {
    CHECK = { code };
    await checkNow(page);
    s = await state(page);
    ok(s.code === code && s.head === W[code + "_h"].en && s.fix === W[code + "_f"].en && s.fix.length > 20, code + ": " + s.head + " / " + s.fix);
  }
  // the fixes say the real menu names and buttons
  CHECK = { code: "ethernet" }; await checkNow(page); s = await state(page);
  ok(/Wi-Fi/.test(s.fix) && /Network debugging/.test(s.fix), "Ethernet: Wireless debugging needs Wi-Fi, or Network debugging");
  CHECK = { code: "debugging_off" }; await checkNow(page); s = await state(page);
  ok(/Android TV OS build \(on some TVs, Build\) seven times/.test(s.fix) && /USB debugging/.test(s.fix) && /Network debugging/.test(s.fix), "debugging off: Android TV OS build (on some TVs, Build) seven times, USB or Network debugging");
  ok(/older Android TV: Settings, Device Preferences, About/.test(s.fix), "debugging off: the older Android TV path too");
  // a Fire TV (the TV says fire_tv): its own menus, ADB debugging, never Wireless debugging
  CHECK = { code: "debugging_off", fire_tv: true }; await checkNow(page); s = await state(page);
  ok(s.head === W.debugging_off_h.en && s.fix === W.debugging_off_fire_f.en && /My Fire TV, About/.test(s.fix) && /ADB debugging/.test(s.fix) && !/Wireless/.test(s.fix), "Fire TV, debugging off: " + s.fix);
  CHECK = { code: "no_wireless", fire_tv: true }; await checkNow(page); s = await state(page);
  ok(s.head === W.no_wireless_h.en && s.fix === W.no_wireless_fire_f.en && /My Fire TV, Developer options/.test(s.fix) && !/Android 10|Network debugging/.test(s.fix), "Fire TV, port shut: ADB debugging off and on: " + s.fix);
  CHECK = { code: "port_closed", fire_tv: true }; await checkNow(page); s = await state(page);
  ok(s.fix === W.port_closed_fire_f.en && /then press Let the phone press keys\.$/.test(s.fix) && !/Wireless|Network debugging/.test(s.fix), "Fire TV, port closed: its own words");
  CHECK = { code: "allow_unanswered", fire_tv: true }; await checkNow(page); s = await state(page);
  ok(s.fix === W.allow_unanswered_f.en, "Fire TV, answers with no Fire words keep their own");
  CHECK = { code: "port_closed" }; await checkNow(page); s = await state(page);
  ok(/off and on again, then press Let the phone press keys\.$/.test(s.fix), "port closed: ends with the button the page has: " + s.fix);
  ok(!("other_network_h" in W) && !KT_CODES.includes("other_network"), "no answer blames the phone's network");
  CHECK = { code: "no_wireless" }; await checkNow(page); s = await state(page);
  ok(/Android 10 or older/.test(s.fix) && /Let the phone press keys/.test(s.fix), "no Wireless debugging: Network debugging and the button");
  CHECK = { code: "allow_unanswered" }; await checkNow(page); s = await state(page);
  ok(/Allow/.test(s.fix) && /restart the TV/.test(s.fix), "Allow not answered: press Allow, restart if no question");
  CHECK = { code: "something_new" }; await checkNow(page); s = await state(page);
  ok(s.code === "unknown" && s.head === W.unknown_h.en, "an answer the page does not know: couldn't find the cause");
  CHECK = { code: "ok" }; await checkNow(page); s = await state(page);
  ok(s.code === "ok" && /status cc-head ok/.test(await page.getAttribute("#cc .cc-head", "class")), "ok shows in the ok colour");

  // ---- 3a. Copy a report on localhost: the clipboard API ----
  CHECK = { code: "ethernet" }; await checkNow(page);
  ok((await state(page)).secure, "localhost is a secure context");
  await page.click("#cc .cc-copy");
  await page.waitForFunction(() => document.querySelector("#cc .cc-msg").textContent.length > 0);
  s = await state(page);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip === REPORT + "\nPhone page language: en", "the clipboard holds the TV's report and the page language: " + JSON.stringify(clip));
  ok(s.msg === W.copied.en && s.boxShown && s.box === clip, "Copied, and the box shows exactly what was copied");

  // ---- 2. the phone can't reach the TV ----
  MODE = "drop"; await checkNow(page); s = await state(page);
  ok(s.code === "unreachable" && s.head === W.unreachable_h.en && /guest network/.test(s.fix), "connection dropped: the phone can't reach the TV: " + s.head);
  await page.click("#cc .cc-copy");
  await page.waitForFunction(() => document.querySelector("#cc .cc-msg").textContent.length > 0);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  ok(/^Couch TV report\nCheck says: unreachable\nThe phone could not reach the TV: /.test(clip2) && !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(clip2), "the phone's own report, with no addresses: " + JSON.stringify(clip2));
  MODE = "hang";
  const t0 = Date.now(); await checkNow(page); s = await state(page);
  ok(s.code === "unreachable" && Date.now() - t0 < 15000, "no answer in time: the phone can't reach the TV (" + (Date.now() - t0) + " ms)");
  MODE = "answer";
  await ctx.close();

  // ---- 3b. a plain http home address: not a secure context, so the copy goes through the box ----
  const b = await openPage("tv.test");
  CHECK = { code: "port_closed" }; await checkNow(b.page);
  ok(!(await state(b.page)).secure, "http on a home address is not a secure context");
  await b.page.click("#cc .cc-copy");
  await b.page.waitForFunction(() => document.querySelector("#cc .cc-msg").textContent.length > 0);
  s = await state(b.page);
  ok((s.msg === W.copied.en || s.msg === W.copyfail.en) && s.boxShown && s.box === REPORT + "\nPhone page language: en", "the box fallback shows the report: " + s.msg);
  ok(await b.page.evaluate(() => { const t = document.querySelector("#cc .cc-report"); return document.activeElement === t && t.selectionEnd - t.selectionStart === t.value.length; }), "the report is selected, ready to copy by hand");
  await b.ctx.close();

  // ---- 4. every phone page language ----
  const LANGS = await (async () => { const p = await openPage("127.0.0.1"); const l = await p.page.evaluate(() => window.ConnectCheck.langs); await p.ctx.close(); return l; })();
  ok(LANGS.length === 16, "16 phone page languages");
  const keys = Object.keys(W);
  for (const k of keys) for (const l of LANGS) {
    if (l === "es-MX") continue;
    ok(typeof W[k][l] === "string" && W[k][l].trim().length > 0, "words for " + k + " in " + l);
  }
  for (const code of KT_CODES.concat(["unreachable"])) if (code !== "ok") ok(W[code + "_h"] && W[code + "_f"], "words for " + code);
  const dashes = [];
  for (const k of keys) for (const l of Object.keys(W[k])) if (/[–—]| - /.test(W[k][l])) dashes.push(k + "/" + l);
  ok(dashes.length === 0, "no dashes in any language: " + dashes.join(", "));
  const notTranslated = [];
  for (const k of keys) for (const l of LANGS) if (l !== "en" && l !== "es-MX" && W[k][l] === W[k].en) notTranslated.push(k + "/" + l);
  ok(notTranslated.length === 0, "every language says it in its own words: " + notTranslated.join(", "));
  for (const l of LANGS) {
    CHECK = { code: "wireless_off", lang: l };
    const p = await openPage("127.0.0.1");
    s = await state(p.page);
    const want = (k) => W[k][l] || (l === "es-MX" && W[k].es) || W[k].en;
    ok(s.lang === l && s.title === want("title") && s.head === want("wireless_off_h") && s.fix === want("wireless_off_f") && s.check === want("check") && s.copy === want("copy"),
      l + ": follows the TV's language: " + s.title + " / " + s.head);
    ok(s.dir === (l === "he" || l === "ar" ? "rtl" : "ltr"), l + ": reads " + s.dir);
    await p.ctx.close();
  }
  // no TV language: the phone's own (de-AT -> de, zh-TW -> zh-CN, es-419 -> es-MX, fr-CA -> fr, xx -> en)
  for (const [loc, want] of [["de-AT", "de"], ["zh-TW", "zh-CN"], ["es-419", "es-MX"], ["fr-CA", "fr"], ["ja-JP", "en"]]) {
    CHECK = { code: "ok" };
    const p = await openPage("127.0.0.1", loc);
    s = await state(p.page);
    ok(s.lang === want && s.head === (W.ok[want] || W.ok.es || W.ok.en), loc + " phone with no TV language: " + want);
    await p.ctx.close();
  }
  ok(errors.length === 0, "no script errors from the check: " + errors.join(" | "));
} finally {
  await browser.close();
  server.closeAllConnections(); server.close();
}
console.log("ok: " + n + " checks passed (Can't connect? on the phone page)");
