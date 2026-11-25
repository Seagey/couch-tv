// The account's TV inbox, end to end in a real browser at 1920x1080 (SETUP-LINK-TV.md, "TV inbox"): the TV home as
// the Android home app runs it (its saved copy, ?offline=1&alone=1, not the ?mock preview, which never asks the
// inbox), with a pretend TVOS bridge that holds a link, and a pretend design store.
//  1. A linked TV asks the inbox as the home starts; an item's code is fetched like a typed code, with the TV's
//     version, memory and profile (the five keys only).
//  2. The design goes on with no "Use this design?" question: app.js records the yes with CouchDesign.hashOf, and
//     design.js, starting again, makes the same hash (the hashOf no-question path).
//  3. "New design from your account: <title>" once; Home settings, Designs has Undo and Unlink.
//  4. Undo puts back the home this TV had. Unlink asks once, then forgets the link and stops the inbox.
//  5. The link itself never reaches the page, its storage or any request.
//  6. When the TV looks by itself: the first open, waking or coming back after 30 minutes away, once a week.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_account_inbox_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4" };
const STORE = "https://designs.example";
const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url.split("?")[0] === "/tv-home/web/config.js") {   // config.json as the app saves it: the store to ask
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end("window.COUCH_CONFIG = " + JSON.stringify({ design_store: STORE }) + ";");
    return;
  }
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?offline=1&alone=1";

let n = 0;
const fails = [];
const ok = (c, m) => { if (c) n++; else { fails.push(m); console.log("FAIL " + m); } };

// what Setup wrote into the app (never handed to the page) and what the account sent
const LINK = "Lk_" + "q7".repeat(20);
const CODE = "CTV1-" + "Ab3_-".repeat(8) + "Zz9";
const TITLE = "Beach night";
// a design that only restyles the home's own parts: a clear colour to look for
const DESIGN = { v: 1, background: { colour: "#123456" }, elements: { clock: { colour: "#ffcc00" } } };
const PROFILE = { platform: "Google TV", sdk: 34, memMb: 1843, res: "1920x1080", model: "Smart TV Pro" };

// the bridge's side, kept in node so it lives across the home's restarts
const app = { linked: true, inboxAsks: 0, answer: { state: "item", code: CODE, title: TITLE, poll: 30 }, unlinks: 0 };
const fetched = [];
let storeFail = 0;   // answer the next fetches 503 (Studio busy)

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.exposeFunction("__inbox", () => {
    app.inboxAsks++;
    if (!app.linked) return JSON.stringify({ state: "unlinked" });
    const a = app.answer; app.answer = { state: "none", poll: 30 };   // the store hands an item out once
    return JSON.stringify(a);
  });
  await page.exposeFunction("__unlink", () => { app.linked = false; app.unlinks++; return true; });
  await page.exposeFunction("__linked", () => app.linked);
  await page.addInitScript((profile) => {
    // the Android home's TVOS, only what this flow touches; kept() and keep() are the app's own store
    const S = (k) => "tvos:" + k;
    let linked = true;
    window.TVOS = {
      version: () => "0.13.13", memoryMb: () => 1843, tvProfile: () => JSON.stringify(Object.assign({ serial: "SERIAL-X1", ip: "tv-address" }, profile)),
      apps: () => "[]", watchNext: () => "[]", homeState: () => "held", launch: () => true,
      kept: (k) => localStorage.getItem(S(k)), keep: (k, v) => { if (v == null) localStorage.removeItem(S(k)); else localStorage.setItem(S(k), v); return true; },
      keptPrivate: (k) => localStorage.getItem(S("p:" + k)), keepPrivate: (k, v) => { if (v == null) localStorage.removeItem(S("p:" + k)); else localStorage.setItem(S("p:" + k), v); return true; },
      accountLinked: () => linked,
      setupDesignCode: () => "", setupDesignDone: () => true,
      unlinkAccount: () => { linked = false; window.__unlink(); return true; },
      // Kotlin asks the inbox on its own thread and answers through tv.accountInbox
      accountInbox: () => { window.__inbox().then((raw) => setTimeout(() => window.tv && window.tv.accountInbox(raw), 30)); return true; }
    };
    window.__linkedAtStart = window.__linked().then((v) => { linked = v; });
  }, PROFILE);
  await page.route(STORE + "/**", (r) => {
    const u = r.request().url(), body = r.request().postData() || "";
    const json = (status, j) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(j) });
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
    if (/\/v1\/designs\/fetch$/.test(u)) {
      fetched.push({ body: JSON.parse(body), headers: r.request().headers() });
      if (storeFail > 0) { storeFail--; return json(503, {}); }
      return json(200, { design: DESIGN });
    }
    return json(404, {});
  });
  // a clean TV with the classic home and no design
  await page.goto(BASE + "&reset=1");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  // that load asked the inbox too: start counting, and put the send in, from here
  app.inboxAsks = 0; app.answer = { state: "item", code: CODE, title: TITLE, poll: 60 }; fetched.length = 0;
  console.log("Running account inbox browser tests...");
  const ready = async () => {
    await page.waitForFunction(() => window.tv && window.CouchDesignCode && window.CouchDesign, null, { timeout: 20000 });
    await page.waitForTimeout(1200);
  };
  const toasts = [];
  await page.exposeFunction("__toast", (t) => toasts.push(t));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const tt = document.getElementById("toast") || document.querySelector(".toast");
      if (tt && tt.textContent && tt.textContent !== window.__lastToast) { window.__lastToast = tt.textContent; window.__toast(tt.textContent); }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  // 1. the home starts, asks the inbox, gets the item, fetches it and starts again with it
  await page.goto(BASE);
  await ready();
  await page.waitForFunction(() => !!localStorage.getItem("couchtv.design.undo"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("load"); await page.waitForTimeout(2500);
  await ready();
  ok(app.inboxAsks >= 1, "the linked TV asked its inbox as the home started (" + app.inboxAsks + ")");
  ok(fetched.length === 1, "the item's code was fetched once (" + fetched.length + ")");
  if (fetched.length) {
    const b = fetched[0].body;
    ok(b.code === CODE, "the code from the inbox, as sent");
    ok(b.tv && b.tv.v === "0.13.13" && b.tv.mem === 1843, "with the version and memory");
    ok(b.tv && JSON.stringify(b.tv.profile) === JSON.stringify(PROFILE), "and the TV profile, the five keys only (" + JSON.stringify(b.tv && b.tv.profile) + ")");
    ok(!/SERIAL-X1|tv-address/.test(JSON.stringify(b)), "never a serial or an address");
    ok(!fetched[0].headers.authorization && !fetched[0].headers.cookie, "no Authorization and no cookie on the fetch");
  }

  // 2. the hashOf no-question path: on, with no "Use this design?"
  const st = await page.evaluate(() => ({
    asked: /Use this design\?/.test(document.body.textContent),
    on: window.CouchDesign && window.CouchDesign.active ? !!window.CouchDesign.active() : null,
    okHash: localStorage.getItem("couchtv.design.ok"),
    hash: (() => { try { const raw = JSON.parse(localStorage.getItem("couchtv.design.fetched")); return window.CouchDesign.hashOf(window.CouchDesign.sanitize ? window.CouchDesign.sanitize(raw.design) || raw.design : raw.design); } catch (e) { return "err " + e; } })(),
    bg: getComputedStyle(document.body).backgroundColor + " " + [...document.querySelectorAll("*")].slice(0, 400).map((e) => getComputedStyle(e).backgroundColor).filter((c) => c === "rgb(18, 52, 86)").length
  }));
  ok(!st.asked, "no \"Use this design?\" question: the yes app.js recorded matches design.js's hash");
  ok(st.okHash && /^sha256:/.test(st.okHash), "the yes is recorded as a hash (" + st.okHash + ")");
  ok(st.okHash === st.hash, "CouchDesign.hashOf of the kept design is that hash (" + st.hash + ")");
  ok(/ 1|[1-9]\d*$/.test(st.bg) && !/ 0$/.test(st.bg), "the design is on screen: its background colour shows (" + st.bg + ")");

  // 3. said once
  const said = toasts.filter((t) => /New design from your account/.test(t));
  ok(said.length === 1 && said[0].indexOf(TITLE) > 0 && /Home settings, Designs/.test(said[0]), "\"New design from your account: " + TITLE + "\" once, with where Undo is (" + JSON.stringify(said) + ")");
  ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem("couchtv.design.undo") || "{}").fresh)), "the notice is not said again");

  // Designs: Undo and Unlink rows
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
  const focused = () => page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "");
  const rowsText = () => page.evaluate(() => (document.getElementById("set-rows") || {}).textContent || "");
  const toDesigns = async () => {
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press("Enter", 500);
    for (let i = 0; i < 16 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press("ArrowDown", 150);
    await press("ArrowRight", 500);
  };
  const toRow = async (re) => { for (let i = 0; i < 40; i++) { if (re.test(await focused())) return true; await press("ArrowDown", 120); } return false; };
  await toDesigns();
  let rows = await rowsText();
  ok(/Undo the new design/.test(rows) && rows.indexOf(TITLE) > 0, "Designs has Undo the new design, naming it");
  ok(/Unlink this TV from your account/.test(rows), "and Unlink this TV from your account");

  // 4a. Undo: the home this TV had (no design)
  ok(await toRow(/Undo the new design/), "Undo can be reached with the remote");
  await press("Enter", 400);
  await page.waitForTimeout(2500); await ready();
  const back = await page.evaluate(() => ({ fetched: localStorage.getItem("couchtv.design.fetched"), ok: localStorage.getItem("couchtv.design.ok"), undo: localStorage.getItem("couchtv.design.undo"),
    asked: /Use this design\?/.test(document.body.textContent) }));
  ok(!back.fetched && !back.ok && !back.undo, "Undo put back the TV as it was: no design kept, no yes, no Undo left");
  ok(!back.asked, "and no question after Undo");

  // 4a2. Get my new design (the TV looks by itself only after 30 minutes away, or once a week)
  await toDesigns();
  rows = await rowsText();
  ok(/Get my new design/.test(rows) && /when the TV wakes, or once a week/.test(rows), "Designs has Get my new design");
  const msgText = () => page.evaluate(() => (document.getElementById("set-msg") || {}).textContent || "");
  ok(await toRow(/Get my new design/), "Check can be reached with the remote");
  // the last look (the first open) was a moment ago: the press would say so; move it back a minute
  await press("Enter", 600);
  ok(/Looked a moment ago/.test(await msgText()), "a press within 30 s of the last look asks nothing");
  await page.evaluate(() => localStorage.setItem("couchtv.inbox.last", String(Date.now() - 60000)));
  const asks0 = app.inboxAsks;
  await press("Enter", 900);
  ok(app.inboxAsks === asks0 + 1, "the press asks the inbox once (" + (app.inboxAsks - asks0) + ")");
  ok(/Nothing new yet/.test(await msgText()), "and says there is nothing new (" + (await msgText()) + ")");
  await press("Enter", 600);
  ok(app.inboxAsks === asks0 + 1 && /Looked a moment ago/.test(await msgText()), "a second press within 30 s asks nothing (" + (await msgText()) + ")");
  // the home coming back after a moment away asks nothing
  await page.evaluate(() => { window.tv.pause(); window.tv.resume(); });
  await page.waitForTimeout(600);
  ok(app.inboxAsks === asks0 + 1, "back to the front after a moment away: nothing asked");
  await press("Escape", 200); await press("Escape", 400);

  // 4a3. A send whose fetch fails is kept (Studio hands each send out once) and fetched at the next look
  const CODE2 = "CTV1-" + "Zz9-_".repeat(8) + "Ab3";
  app.answer = { state: "item", code: CODE2, title: "Sunday morning", poll: 60 };
  storeFail = 1;
  await toDesigns();
  ok(await toRow(/Get my new design/), "Check again");
  await page.evaluate(() => localStorage.setItem("couchtv.inbox.last", String(Date.now() - 60000)));
  let a1 = app.inboxAsks, f1 = fetched.length;
  await press("Enter", 1500);
  ok(app.inboxAsks === a1 + 1 && fetched.length === f1 + 1, "the press got the send and tried its design once");
  ok(/No internet/.test(await msgText()), "the failed fetch says so (" + (await msgText()) + ")");
  const held = await page.evaluate(() => JSON.parse(localStorage.getItem("couchtv.inbox.pending") || "null"));
  ok(held && held.code === CODE2 && held.title === "Sunday morning", "and the send is kept, not lost");
  await page.evaluate(() => localStorage.setItem("couchtv.inbox.last", String(Date.now() - 60000)));
  a1 = app.inboxAsks; f1 = fetched.length;
  await press("Enter", 600);
  await page.waitForTimeout(2500); await ready();
  ok(app.inboxAsks === a1, "the next look fetches the kept send without asking Studio again");
  ok(fetched.length === f1 + 1 && fetched[fetched.length - 1].body.code === CODE2, "its design is fetched");
  ok(!(await page.evaluate(() => localStorage.getItem("couchtv.inbox.pending"))), "and then forgotten");
  ok(await page.evaluate(() => !!localStorage.getItem("couchtv.design.fetched") && !/Use this design\?/.test(document.body.textContent)), "the design is on, with no question");

  // 4b. Unlink: asks once, then forgets the link; the inbox stops
  await toDesigns();
  ok(await toRow(/Unlink this TV from your account/), "Unlink can be reached");
  await press("Enter", 400);
  rows = await rowsText();
  ok(/Press OK again to unlink/.test(rows) && app.unlinks === 0, "the first press only asks");
  await press("Enter", 600);
  ok(app.unlinks === 1 && !app.linked, "the second press unlinks (the app forgets the link)");
  rows = await rowsText();
  ok(!/Unlink this TV/.test(rows), "the Unlink row is gone");
  const asksBefore = app.inboxAsks;
  await page.evaluate(() => { window.tv.pause && window.tv.pause(); window.tv.resume && window.tv.resume(); });
  await page.waitForTimeout(800);
  ok(app.inboxAsks === asksBefore, "an unlinked TV asks nothing when the home comes back (" + (app.inboxAsks - asksBefore) + ")");

  // 5. the link never reaches the page
  const pageSide = await page.evaluate(() => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o.push(k + "=" + localStorage.getItem(k)); } return o.join("\n") + location.href + document.documentElement.outerHTML; });
  ok(pageSide.indexOf(LINK) < 0 && !/Bearer/.test(pageSide), "no link and no Bearer in the page, its storage or its address");
  ok(seen.every((u) => u.indexOf(LINK) < 0 && !/v1\/setup\/inbox/.test(u)), "the page itself never asks the inbox address");
  ok(!errors.length, "no page errors: " + errors.join(" | "));

  // when a linked TV looks by itself (owner, 24 Nov 2026), on fake time: the home opening for the first time,
  // the TV waking or the home coming back after 30 minutes or more away, and once a week. Studio says 30 s here.
  const p2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  let asked2 = 0;
  await p2.exposeFunction("__inbox", () => { asked2++; return JSON.stringify({ state: "none", poll: 30 }); });
  await p2.addInitScript(() => {
    window.TVOS = { version: () => "0.13.13", apps: () => "[]", watchNext: () => "[]", homeState: () => "held", accountLinked: () => true, setupDesignCode: () => "",
      accountInbox: () => { window.__inbox().then((raw) => setTimeout(() => window.tv && window.tv.accountInbox(raw), 30)); return true; } };
  });
  await p2.goto(BASE + "&reset=1"); await p2.evaluate(() => { localStorage.clear(); localStorage.setItem("tvhome.makeit", JSON.stringify("done")); });   // a first-run card on screen would look every 20 s: this is a TV that has had it
  await p2.clock.install();
  await p2.goto(BASE);
  await p2.waitForFunction(() => window.tv && window.CouchDesignCode, null, { timeout: 20000 });
  await p2.clock.runFor(2000); await p2.waitForTimeout(300);
  asked2 = Math.min(asked2, 1);   // the reset load before was not counted
  const run = async (ms) => { await p2.clock.runFor(ms); await p2.waitForTimeout(300); };
  let base2 = asked2;
  ok(base2 === 1, "a newly linked TV looks as the home first opens (" + base2 + ")");
  // a restart of the home soon after (a new design, a setting) is not time away
  await p2.reload(); await p2.waitForFunction(() => window.tv && window.CouchDesignCode, null, { timeout: 20000 }); await run(2000);
  ok(asked2 === base2, "the home starting again a moment later looks again: no (" + (asked2 - base2) + ")");
  // 10 minutes in an app: nothing; Studio's 30 s poll is never followed
  await p2.evaluate(() => window.tv.pause()); await run(10 * 60 * 1000);
  await p2.evaluate(() => window.tv.resume()); await run(2000);
  ok(asked2 === base2, "back after 10 minutes away: nothing (" + (asked2 - base2) + ")");
  // standby for 31 minutes: one look as it wakes
  await p2.evaluate(() => window.tv.pause()); await run(31 * 60 * 1000);
  ok(asked2 === base2, "nothing while away");
  await p2.evaluate(() => window.tv.resume()); await run(2000);
  ok(asked2 === base2 + 1, "the TV wakes after 31 minutes: one look (" + (asked2 - base2) + ")");
  base2 = asked2;
  // left on the home: nothing for 6 days 23 hours, then one look at a week
  await run((6 * 24 + 23) * 3600 * 1000);
  ok(asked2 === base2, "on the home for 6 days 23 hours: nothing (" + (asked2 - base2) + ")");
  await run(2 * 3600 * 1000);
  ok(asked2 === base2 + 1, "then one look at a week (" + (asked2 - base2) + ")");
  // a paused home asks nothing, even when the week comes due
  base2 = asked2;
  await p2.evaluate(() => window.tv.pause()); await run(8 * 24 * 3600 * 1000);
  ok(asked2 === base2, "away for 8 days: nothing while away");
  await p2.evaluate(() => window.tv.resume()); await run(2000);
  ok(asked2 === base2 + 1, "and one look as it comes back (" + (asked2 - base2) + ")");
  await p2.close();
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? "account inbox browser tests: " + fails.length + " failed, " + n + " passed" : "account inbox browser tests passed (" + n + " checks)");
process.exit(fails.length ? 1 : 0);
