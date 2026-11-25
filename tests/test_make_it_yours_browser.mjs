// The first-run "Make it yours" card (owner approved 25 Nov 2026): a new TV that stayed on Couch Original is shown
// one card, once, on a calm moment: a QR code and an address to design its own screen on a phone.
//  1. Fresh install linked by Setup: no welcome, the card after the calm wait; words, address and a QR that decodes to the one
//     constant. Fresh and not linked: the welcome with its own QR and no card, even after Use Couch Original.
//     The link arriving before, during or after the welcome, and across a restart, a design code of Setup's, an update.
//  2. Back closes it for good: out of the page, the home is back with focus, kept across a restart (reload).
//  3. Never: on an update (welcome "set", or answered Couch Original by an older version), once a design or home
//     pack is here, in a guest's profile, while the TV is away at an app or the screen is off, if dismissed.
//  4. The remote is never held: Back, OK, Home and the Settings key all close it; the arrows do nothing.
//  5. Home settings, Designs, Make it yours brings the same card back.
//  6. Light on a weak TV: not in the page until shown, out of the page when closed, no blur, no animation.
//  7. 1280x720, 1920x1080 and 3840x2160 lay it out the same (rem follows the screen width); a 1920x1080 screenshot
//     goes to $MAKEIT_SHOTS when it is set.
// Needs Playwright (Chromium) and jsQR (tools/tv-designer/server/node_modules). Without either the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<folder whose node_modules has playwright> COUCHTV_JSQR=<jsqr folder> node tests/test_make_it_yours_browser.mjs
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
let jsQR;
try { jsQR = createRequire(import.meta.url)(process.env.COUCHTV_JSQR || path.join(ROOT, "..", "tv-designer", "server", "node_modules", "jsqr")); }
catch (e) { console.log("SKIP: jsQR is not installed (set COUCHTV_JSQR to its folder)"); process.exit(0); }

// the constant, read from the page's own source: the card, the QR and this test share the one address
const APP = fs.readFileSync(path.join(ROOT, "tv-home", "web", "app.js"), "utf8");
const consts = APP.match(/var MAKEIT_URL = "([^"]+)"/g) || [];
assert.strictEqual(consts.length, 1, "the address is defined once");
const URL_CONST = /"([^"]+)"/.exec(consts[0])[1];
assert.strictEqual(URL_CONST, "https://couchtv.joshuaseage.com/go");
assert.strictEqual(APP.split(URL_CONST.replace("https://", "")).length - 1, 1, "no second copy of the address in app.js");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STORE = "https://designs.example";
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const HOME = ORIGIN + "/tv-home/web/index.html?mock=1&place=Your+town&designstore=" + encodeURIComponent(STORE);
const CALM = 600;    // the calm wait, shortened for the test (the real one is about 3 s)
const SLOW = 3000;   // the real one, for the tests that act before the card comes
const FRESH = HOME + "&ontv=1&firstrun=1&makeitcalm=" + CALM;               // a fresh TV Setup never linked: the welcome
const LINKED = HOME + "&ontv=1&firstrun=1&linked=1&makeitcalm=" + SLOW;      // a fresh TV Setup linked: the card, no welcome
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(STORE + "/**", (r) => r.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  const ready = async () => { await page.waitForFunction(() => window.tv && window.CouchDesignCode && window.I18N); await page.waitForTimeout(700); };
  const freshTv = async (url, before) => {
    await page.goto(ORIGIN + "/tv-home/web/qr.js");
    await page.evaluate((b) => { localStorage.clear(); sessionStorage.clear(); for (const k in (b || {})) localStorage.setItem(k, b[k]); }, before || null);
    await page.goto(url || FRESH); await ready();
  };
  const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 200); };
  const welcomeUp = () => page.evaluate(() => { const w = document.getElementById("welcome"); return !!w && w.classList.contains("on"); });
  const cardUp = () => page.evaluate(() => !!document.getElementById("makeit"));
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.makeit") || "null"));
  const wait = (ms) => page.waitForTimeout(ms);
  const decode = async () => {
    const png = await (await page.$("#makeit-qr")).screenshot();
    const px = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
    }, png.toString("base64"));
    const r = jsQR(Uint8ClampedArray.from(px.d), px.w, px.h);
    return r ? r.data : null;
  };
  const original = async () => {};   // a linked fresh TV has no welcome to answer
  const linkNow = (extra) => page.evaluate(() => { localStorage.setItem("mock:linked", "1"); window.tv.setupDesign(); });
  const welcomeKey = () => page.evaluate(() => JSON.parse(localStorage.getItem("mock:tvhome.welcome") || "null"));

  // 1a. a fresh TV Setup never linked: the welcome as today, no card
  await freshTv();
  ok(await welcomeUp() && !(await cardUp()), "fresh and not linked: the welcome, no card");
  ok(await page.evaluate(() => !!document.querySelector("#welcome-qr svg")), "with its own QR");
  await wait(SLOW + 1500);
  ok(await welcomeUp() && !(await cardUp()) && await kept() === null, "the card never comes over the welcome");
  await press("ArrowRight"); await press("Enter", 300);
  await wait(SLOW + 1500);
  ok(!(await welcomeUp()) && !(await cardUp()) && await kept() === null && await welcomeKey() === "original", "Use Couch Original while not linked: no card, ever");
  // linked later by Setup, still on Couch Original with no design: the card, once
  await linkNow();
  ok(await kept() === "due", "linked later while on Couch Original: the card is due");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(await kept() === "done", "and it comes, once");
  await press("Escape", 300);
  await linkNow(); await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === "done", "linked again: not shown twice");
  // the link arrives with the welcome on screen: the card replaces it
  await freshTv();
  ok(await welcomeUp(), "the welcome is up");
  await linkNow(); await wait(300);
  ok(!(await welcomeUp()) && await welcomeKey() === "linked" && await kept() === "due", "the link arrives during the welcome: the welcome goes, the card is due");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(!(await welcomeUp()), "and the card replaces it");
  await press("Escape", 300);
  // the link arrives with the welcome on screen and a design code of Setup's on its way: no card at all
  await freshTv(FRESH + "&setupcode=1");
  await linkNow(); await wait(SLOW + 1500);
  ok(!(await welcomeUp()) && !(await cardUp()) && await kept() === null, "link and a design code together, welcome up: neither card");
  // the link before the welcome (already linked at the first start): no welcome at all
  await freshTv(LINKED);
  ok(!(await welcomeUp()) && await welcomeKey() === "linked", "linked before the first start: the welcome is skipped");
  // a restart in between: unlinked, welcome up, restart, then linked
  await freshTv();
  await page.reload(); await ready();
  ok(await welcomeUp() && await welcomeKey() === "ask", "restart with the welcome unanswered: still the welcome");
  await page.evaluate(() => localStorage.setItem("mock:linked", "1"));
  await page.reload(); await ready();
  ok(!(await welcomeUp()) && await welcomeKey() === "linked" && ["due", "done"].includes(await kept()), "linked while it was away: the restart skips the welcome and the card is due");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  await press("Escape", 300);
  // a design code of Setup's in the same start: no card
  await freshTv(LINKED + "&setupcode=1");
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === null && !(await welcomeUp()) && await welcomeKey() === "linked", "linked with a design code: no welcome and no card");
  // an update: the welcome never was, and a link later changes nothing
  await freshTv(LINKED, { "mock:tvhome.apps.seen": JSON.stringify(["com.netflix.ninja"]) });
  await linkNow(); await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === null && await welcomeKey() === "set", "an update, linked: no card");

  // 1b. a fresh TV Setup linked: the card
  await freshTv(LINKED);
  ok(!(await welcomeUp()) && !(await cardUp()) && await kept() === "due", "fresh and linked: no welcome, the card is due but not at once");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(await cardUp() && await kept() === "done", "the card comes on a calm moment, and counts as shown");
  const words = await page.evaluate(() => document.getElementById("makeit").textContent);
  ok(/Couch TV/.test(words) && /Make it yours/.test(words) && /Design your own screen on your phone\./.test(words) && /Scan with your phone/.test(words) &&
    /Or press Back to close this\./.test(words), "its words (" + words + ")");
  ok(words.includes(URL_CONST.replace("https://", "")), "the address shown is the constant");
  ok(!/[–—]|Beta|Experimental|coming soon|couch-tv/i.test(words), "no dashes, Beta, Experimental, coming soon or couch-tv in it");
  ok(await decode() === URL_CONST, "the QR decodes to the one constant, a plain https address, nothing more");
  ok(!/[?#=]/.test(URL_CONST) && /^https:\/\/[a-z.]+\/go$/.test(URL_CONST), "the address has no query, code, token or device id");
  ok(await page.evaluate(() => document.activeElement === document.body || !document.querySelector("#makeit [tabindex]")), "nothing on the card takes the focus");
  if (process.env.MAKEIT_SHOTS) await page.screenshot({ path: path.join(process.env.MAKEIT_SHOTS, "make-it-yours-1920x1080.png") });

  // 2. Back closes it for good
  await press("Escape", 400);
  ok(!(await cardUp()), "Back closes the card");
  ok(await page.evaluate(() => !!document.querySelector("#grid .app.focus, .focus")), "the home has its focus back");
  await press("ArrowRight", 300);
  ok(await page.evaluate(() => !!document.querySelector(".focus")), "and the remote moves on the home");
  await page.reload(); await ready(); await wait(SLOW + 1500);
  ok(!(await cardUp()) && !(await welcomeUp()) && await kept() === "done", "a restart: dismissed stays dismissed");
  await page.reload(); await ready(); await wait(SLOW + 1500);
  ok(!(await cardUp()), "and again");
  // a restart before it was shown: still due, still shown once
  await freshTv(LINKED);
  await page.reload(); await ready();
  ok(await kept() === "due", "restarted before it showed: still due");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(true, "and it comes after the restart");

  // 3. never
  await freshTv(FRESH, { "mock:tvhome.apps.seen": JSON.stringify(["com.netflix.ninja"]) });
  await wait(SLOW + 1500);
  ok(!(await welcomeUp()) && !(await cardUp()) && await kept() === null, "an update (apps already seen): no welcome, no card, never later");
  await freshTv(FRESH, { "mock:tvhome.welcome": JSON.stringify("original") });
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === null, "an update from a version that already had the welcome (answered Couch Original): no card");
  // a design or home pack arrives while it waits
  await freshTv(LINKED);
  await page.evaluate(() => localStorage.setItem("couchtv.design.fetched", JSON.stringify({ design: { v: 1, background: { colour: "#203040" }, elements: { clock: { colour: "#ffcc00" } } }, at: Date.now() })));
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === "done", "a design was sent before it came: no card, and never later");
  await freshTv(LINKED);
  await page.evaluate(() => localStorage.setItem("couchtv.design.ok", "1"));
  await wait(SLOW + 1500);
  ok(!(await cardUp()), "a design already accepted: no card");
  await freshTv(LINKED);
  await page.evaluate(() => localStorage.setItem("mock:tvhome.home.account", JSON.stringify({ rev: 1, people: [{ id: "p_1", name: "Alex" }] })));
  await wait(SLOW + 1500);
  ok(!(await cardUp()), "a home pack already applied: no card");
  // the welcome answered with a code is no longer Couch Original
  await freshTv(); await press("Enter", 500);
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === null, "I have a design code: no card");
  // a guest's profile
  const people = JSON.stringify([{ id: "visitor", name: "Visitor", guest: true }, { id: "alex", name: "Alex" }]);
  const people2 = JSON.stringify([{ id: "alex", name: "Alex" }, { id: "visitor", name: "Visitor", guest: true }]);   // Alex is first, so Alex is watching
  await freshTv(HOME + "&ontv=1&makeitcalm=" + SLOW, { "mock:tvhome.makeit": JSON.stringify("due"), "mock:tvhome.welcome": JSON.stringify("original"), "mock:api.people": people });
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === "due", "a guest's profile: no card (still due for someone else)");
  await freshTv(HOME + "&ontv=1&makeitcalm=" + SLOW, { "mock:tvhome.makeit": JSON.stringify("due"), "mock:tvhome.welcome": JSON.stringify("original"), "mock:api.people": people2 });
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(true, "the same TV with a non guest watching: the card comes (so the guest test above is the guest, not the setup)");
  // away at an app, or the screen off
  await freshTv(LINKED);
  await page.evaluate(() => window.tv.pause());
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await kept() === "due", "the TV is at an app: no card over it");
  await page.evaluate(() => window.tv.resume());
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  ok(true, "back from the app: the card comes on the next calm moment");
  await press("Escape", 300);
  await freshTv(LINKED);
  await page.evaluate(() => window.tv.screenOff());
  await wait(SLOW + 1500);
  ok(!(await cardUp()), "screen off (the screensaver): no card");
  await page.evaluate(() => window.tv.wakeScreen());
  // a question or Home settings on top: it waits, never stacks
  await freshTv(LINKED);
  await page.evaluate(() => window.tv.settingsKey()); await wait(300);
  await wait(SLOW + 1500);
  ok(!(await cardUp()) && await page.evaluate(() => document.getElementById("gear-pop").classList.contains("on")), "the gear menu is open: no card over it");
  await press("Escape", 300);
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 15000 });
  ok(true, "the menu closed: the card comes after");
  await press("Escape", 300);
  // a kids profile
  await freshTv(HOME + "&ontv=1&makeitcalm=" + SLOW, { "mock:tvhome.makeit": JSON.stringify("due"), "mock:tvhome.welcome": JSON.stringify("original") });
  await page.evaluate(() => { window.KidsMode = Object.assign({}, window.KidsMode, { active: () => true }); });
  await wait(SLOW + 1500);
  ok(!(await cardUp()), "a kids profile: no card");

  // 4. the remote is never held
  const show = async () => { await freshTv(LINKED); await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 }); };
  await show(); await press("ArrowRight"); await press("ArrowDown"); await press("ArrowLeft");
  ok(await cardUp(), "the arrows do nothing to it");
  await press("Enter", 400);
  ok(!(await cardUp()) && await page.evaluate(() => !!document.querySelector(".focus")), "OK closes it, the home has its focus");
  await show(); await page.evaluate(() => window.tv.home()); await wait(300);
  ok(!(await cardUp()), "the Home key closes it");
  await show(); await page.evaluate(() => window.tv.back()); await wait(300);
  ok(!(await cardUp()), "the launcher's Back closes it");
  await show(); await page.evaluate(() => window.tv.settingsKey()); await wait(400);
  ok(!(await cardUp()) && await page.evaluate(() => document.getElementById("gear-pop").classList.contains("on")), "the Settings key closes it and opens the gear menu");
  await press("Escape", 300);
  await show(); await page.evaluate(() => window.tv.pause()); await wait(200);
  ok(!(await cardUp()), "an app opening takes it away");
  await show(); await page.mouse.click(960, 540); await wait(300);
  ok(!(await cardUp()), "a pointer click closes it too");

  // 5. Home settings, Designs, Make it yours
  await freshTv(); await press("Enter", 500); await press("Escape", 400);   // Back out of the code box: Designs rows
  const rows = await page.evaluate(() => document.getElementById("set-rows").textContent);
  ok(/Make it yours/.test(rows), "Home settings, Designs has a Make it yours row (" + rows.slice(0, 160) + ")");
  const at = await page.evaluate(() => Array.from(document.querySelectorAll("#set-rows .srow")).findIndex((r) => /Make it yours/.test(r.textContent)));
  const cur = await page.evaluate(() => Array.from(document.querySelectorAll("#set-rows .srow")).findIndex((r) => r.classList.contains("focus")));
  ok(at > cur && cur >= 0, "right under Get a design from your phone, below the rows the pictured steps use");
  for (let i = cur; i < at; i++) await press("ArrowDown", 150);
  await press("Enter", 500);
  ok(await cardUp() && !(await page.evaluate(() => document.getElementById("settings").classList.contains("on"))), "OK on it shows the same card");
  ok(await decode() === URL_CONST, "with the same QR");
  await press("Escape", 400);
  ok(!(await cardUp()), "Back closes it again");

  // 6. light on a weak TV
  await freshTv(LINKED);
  ok(!(await cardUp()) && await page.evaluate(() => document.querySelectorAll(".makeit, .mk-card, #makeit-qr").length === 0), "a TV that never shows it has none of it in the page");
  await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
  const cost = await page.evaluate(() => { const c = getComputedStyle(document.getElementById("makeit")), k = getComputedStyle(document.querySelector(".mk-card"));
    return { blur: c.backdropFilter, blur2: k.backdropFilter, anim: c.animationName, anim2: k.animationName, tr: c.transitionProperty, nodes: document.getElementById("makeit").querySelectorAll("*").length }; });
  ok((!cost.blur || cost.blur === "none") && (!cost.blur2 || cost.blur2 === "none") && cost.anim === "none" && cost.anim2 === "none" && cost.nodes < 400, "no blur, no animation, few nodes (" + JSON.stringify(cost) + ")");
  await press("Escape", 300);
  ok(await page.evaluate(() => document.querySelectorAll("#makeit, .mk-card, #makeit-qr").length === 0), "closed: all of it is out of the page");

  // 7. screens
  const fit = () => page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), c = r(".mk-card"), q = r(".mk-qr"), t = r(".mk-title"), u = r(".mk-url");
    const fs = parseFloat(getComputedStyle(document.querySelector(".mk-hint")).fontSize);
    return { w: innerWidth, inside: [c, q, t, u].every((x) => x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight), apart: u.right <= q.left && t.right <= q.left,
      card: c.width / innerWidth, qr: q.width / innerWidth, hint: fs / innerHeight, cy: Math.abs((c.top + c.bottom) / 2 - innerHeight / 2) }; });
  const sizes = [[1280, 720], [1920, 1080], [3840, 2160]];
  const shapes = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await freshTv(LINKED); await page.waitForFunction(() => !!document.getElementById("makeit"), null, { timeout: 8000 });
    const f = await fit(); shapes.push(f);
    ok(f.inside && f.apart && f.cy < 2 && f.hint >= 0.0325, w + "x" + h + ": the card, QR, title and address fit, side by side, centred, small text 36px at 1080p or bigger (" + JSON.stringify(f) + ")");
    ok(await decode() === URL_CONST, w + "x" + h + ": the QR still decodes");
    if (w === 1920 && process.env.MAKEIT_SHOTS) await page.screenshot({ path: path.join(process.env.MAKEIT_SHOTS, "make-it-yours-1920x1080-final.png") });
    await press("Escape", 300);
  }
  ok(Math.abs(shapes[0].card - shapes[1].card) < 0.002 && Math.abs(shapes[2].card - shapes[1].card) < 0.002, "all three screens lay it out the same");
  await page.setViewportSize({ width: 1920, height: 1080 });
  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} make it yours browser tests passed.`);
