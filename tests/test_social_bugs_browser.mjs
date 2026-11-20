// Bugs real people reported on the owner's socials (coord/SOCIAL-BUILDLIST-0139.md), each checked in a
// real browser on the TV home's ?mock preview at 1920x1080, the page the TV runs:
//   g03  Keep watching pictures that never come (a Sony after a restart, #274) show the app's banner or the
//        title, never an empty tile, and are asked for again when the home comes back into view.
//   g05  a photo added by its web address says why it did not open: error 404, a web page, a site that will not
//        say, too big, too slow; the reason stays under the row; a photo that later fails on the home says so.
//   g18  a Fire TV back from a video link: the background clip lets go while away, and the photo shows until
//        the clip really plays again (it came back black).
//   g29  an air mouse: pointing moves the focus and a click opens a dock app, a Keep watching tile, a Home
//        settings section and row, on a TV that never said it had a pointer.
//   g31  quick buttons picked in Home settings are the same after a restart.
//   g33  a clip that shows only green (a TCL QM8K) or will not play goes, and the still picture stays.
//   g24  home.icon_set or Look, Icon style draws Settings and More apps from one of couch-tv's icon sets.
//   g34  Next scene and Previous scene from the phone remote change the scene (Night) or photo (Classic).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_social_bugs_browser.mjs
// COUCHTV_ROOT=<another checkout> runs the same checks against that copy (to see them fail before a fix).
// ONLY=g03,g05 runs some sections.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = process.env.COUCHTV_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
// a section that throws is counted as failed and the next one still runs (so a run on an older copy shows every section)
const guard = async (id, fn) => { if (!want(id)) return; try { await fn(); } catch (e) { fails.push(id + ": threw " + String(e).split("\n")[0]); console.log("FAIL " + id + ": threw " + String(e).split("\n")[0]); } };
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const BASE = ORIGIN + "/tv-home/web/index.html?mock=1";
// a real 4x3 PNG, for a picture that does load
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAPAAHTLtIdAAAAAElFTkSuQmCC", "base64");

const counts = {};
let current = "";
const fails = [];
const ok = (c, m) => { if (c) { counts[current] = (counts[current] || 0) + 1; return; } fails.push(current + ": " + m); console.log("FAIL " + current + ": " + m); };

const browser = await chromium.launch();
async function fresh(query, opts) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ...(opts || {}) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  return page;
}
async function open(page, query) {
  await page.goto(BASE + "&reset=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + (query || ""));
  await page.waitForFunction(() => window.tv && document.querySelector("#shelf"));
  await page.waitForTimeout(700);
}

try {
  // ------------------------------------------------------------------ g03
  await guard("g03", async () => { for (const look of ["classic", "night"]) {
    current = "g03";
    const page = await fresh();
    let artUp = false;
    await page.route("https://images.justwatch.com/**", (r) => artUp ? r.fulfill({ status: 200, contentType: "image/png", body: PNG }) : r.abort());
    await page.clock.install();
    await open(page, "&remoteart=1&look=" + look);
    const sel = look === "classic" ? "#shelf .tile.show" : "#shelf .ncard";
    const cards = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    ok(cards >= 2, look + ": the Keep watching row has cards (" + cards + ")");
    // every try of #274's retry runs out (1.5 + 3 + 6 + 12 + 20 + 30 s), as just after a restart with no network
    for (let i = 0; i < 20; i++) { await page.clock.fastForward(5000); await page.waitForTimeout(60); }
    await page.waitForTimeout(400);
    const shown = await page.evaluate(([s, look]) => [...document.querySelectorAll(s)].map((c) => {
      const img = c.querySelector(look === "classic" ? ".face > img" : "img.thumb");
      const txt = c.querySelector(".no-art, .thumb.none");
      return { img: img ? { ok: img.complete && img.naturalWidth > 0, banner: img.classList.contains("kw-banner"), src: img.getAttribute("src") } : null,
        text: txt ? txt.textContent : null, title: (c.querySelector("b") || {}).textContent };
    }), [sel, look]);
    const look_ = look;
    const empty = shown.filter((x) => !(x.img && x.img.ok) && !(x.text !== null && (look_ === "night" || x.text)));
    ok(empty.length === 0, look + ": no card is left as an empty or broken picture (" + JSON.stringify(empty).slice(0, 300) + ")");
    ok(shown.some((x) => x.img && x.img.banner && x.img.ok), look + ": a card with a known app shows that app's banner");
    if (look === "classic") ok(shown.filter((x) => x.text).every((x) => x.text === x.title), "classic: a card with no banner shows the show's title");
    // the network is back and the home comes back into view: the real pictures are asked for again
    artUp = true;
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(600);
    const again = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((c) => {
      const img = c.querySelector("img[data-err=kwretry]");
      return img && /justwatch/.test(img.src) && img.complete && img.naturalWidth > 0;
    }).length, sel);
    ok(again === cards, look + ": back in view, every card has its real picture again (" + again + " of " + cards + ")");
    ok(page.errors.length === 0, look + ": no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
  } });
  // ------------------------------------------------------------------ helpers for Home settings
  const keys = (page) => ({
    press: async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 160); },
  });
  async function openSection(page, re) {
    const { press } = keys(page);
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press("Enter", 400);
    for (let i = 0; i < 16 && !(await page.evaluate((src) => new RegExp(src).test((document.querySelector(".ssec.focus") || {}).textContent || ""), re.source)); i++) await press("ArrowDown");
    await press("ArrowRight");
  }
  async function toRow(page, re) {
    const { press } = keys(page);
    for (let i = 0; i < 80; i++) {
      if (re.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || ""))) return true;
      await press("ArrowDown", 90);
    }
    return false;
  }
  const rowText = (page, re) => page.evaluate((src) => { const r = [...document.querySelectorAll("#set-rows .srow")].find((x) => new RegExp(src).test(x.textContent)); return r ? r.textContent : null; }, re.source);
  const setMsg = (page) => page.evaluate(() => document.getElementById("set-msg").textContent);

  // ------------------------------------------------------------------ g05
  await guard("g05", async () => {
    current = "g05";
    const page = await fresh();
    // a pretend photo site: some links answer a page that may ask (CORS), some do not
    const cors = { "access-control-allow-origin": "*" };
    // a real PNG 9000 pixels wide and 2 high, for "too big"
    const zlib = await import("node:zlib");
    const bigPng = (() => {
      const w = 9000, h = 2, raw = Buffer.alloc((w + 1) * h);
      const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
      const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    })();
    await page.route("https://photos.example/**", (r) => {
      const u = r.request().url();
      if (u.endsWith("/good.png")) return r.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG });
      if (u.endsWith("/missing.jpg")) return r.fulfill({ status: 404, contentType: "text/html", headers: cors, body: "<h1>Not found</h1>" });
      if (u.endsWith("/album")) return r.fulfill({ status: 200, contentType: "text/html", headers: cors, body: "<html><body><img src=a.jpg></body></html>" });
      // a site that sends no CORS answer: the page may not read it (the route has to refuse the fetch itself)
      if (u.endsWith("/share")) return r.request().resourceType() === "fetch" ? r.abort() : r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>shared album</body></html>" });
      if (u.endsWith("/huge.png")) return r.fulfill({ status: 200, contentType: "image/png", headers: cors, body: bigPng });
      if (u.endsWith("/slow.jpg")) return;   // never answers
      return r.abort();
    });
    await page.clock.install();
    await open(page, "&look=night");
    await openSection(page, /^Look/);
    const add = async (url, wait) => {
      ok(await toRow(page, /^Add a photo from a web address/), "the Add a photo from a web address row (" + url + ")");
      await keys(page).press("Enter", 250);
      await page.fill("#set-input", url);
      await keys(page).press("Enter", 300);
      if (wait) { await page.clock.fastForward(wait); }
      for (let i = 0; i < 30 && /Opening the photo/.test(await setMsg(page)); i++) await page.waitForTimeout(100);
      return setMsg(page);
    };
    let m = await add("https://photos.example/missing.jpg");
    ok(/error 404/.test(m), "a 404 says the site answered error 404 (" + m + ")");
    let row = await rowText(page, /^Add a photo from a web address/);
    ok(/error 404/.test(row || ""), "and the reason stays under the row (" + row + ")");
    m = await add("https://photos.example/album");
    ok(/opens a web page, not a photo/.test(m), "a web page says it is a page, not a photo (" + m + ")");
    m = await add("https://photos.example/share");
    ok(/may be a web page, or the site may not let a TV show its photos/.test(m), "a page that will not say says what it may be (" + m + ")");
    m = await add("https://photos.example/huge.png");
    ok(/too big for a TV \(9000 by 2 pixels\)/.test(m), "a huge photo says it is too big, with its size (" + m + ")");
    m = await add("photos.example/slow.jpg", 21000);
    ok(/took too long to answer/.test(m), "a link that never answers says it took too long (" + m + ")");
    let count = await page.evaluate(() => (JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).photos);
    ok(!count || count.length === 0, "none of those was added");
    m = await add("https://photos.example/good.png");
    ok(/Photo added/.test(m), "a good link is added (" + m + ")");
    count = await page.evaluate(() => (JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).photos || []);
    ok(count.length === 1 && count[0].url === "https://photos.example/good.png", "and kept in Home settings");
    row = await rowText(page, /^Add a photo from a web address/);
    ok(!/error|too/.test(row || ""), "a good add clears the old reason (" + row + ")");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();

    // a photo that was added but does not open on the home says so on its own row
    const p2 = await fresh();
    await p2.route("https://photos.example/**", (r) => r.abort());
    await p2.clock.install();
    await p2.goto(BASE + "&reset=1");
    await p2.evaluate(() => { localStorage.clear(); localStorage.setItem("mock:tvhome.settings", JSON.stringify({ s: { photos: [{ id: "gone1", url: "https://photos.example/gone.jpg" }], scene_order: ["p-gone1", "night"], scenes_off: ["night", "golden", "water", "fog", "dawn"] }, updated: 1 })); });
    await p2.goto(BASE + "&look=night");
    await p2.waitForFunction(() => window.tv && document.querySelector("#shelf"));
    for (let i = 0; i < 8; i++) { await p2.clock.fastForward(5000); await p2.waitForTimeout(80); }
    await openSection(p2, /^Look/);
    await toRow(p2, /^Remove photo 1/);
    row = await rowText(p2, /^Remove photo 1/);
    ok(/did not open on the home/.test(row || ""), "a photo that never opened on the home says so on its row (" + row + ")");
    await p2.close();
  });

  // ------------------------------------------------------------------ g18
  await guard("g18", async () => {
    current = "g18";
    const page = await fresh({ userAgent: "Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
    await page.route("https://video.example/**", () => {});   // the clip's bytes never matter here
    await open(page, "&look=night&video=" + encodeURIComponent("https://video.example/clip.mp4"));
    const st = () => page.evaluate(() => {
      const v = document.getElementById("bgvid"), on = document.querySelector(".scene.on .sbg") || document.querySelector(".scene .sbg");
      return { has: document.documentElement.classList.contains("has-video"), src: v.getAttribute("src"), photo: on ? getComputedStyle(on).display : "none" };
    });
    ok((await st()).src === "https://video.example/clip.mp4", "the video link is asked for");
    await page.evaluate(() => document.getElementById("bgvid").dispatchEvent(new Event("playing")));
    ok((await st()).has, "it plays over the photo");
    // a video link opens another app; Fire OS gives that app the decoder, and the home comes back
    await page.evaluate(() => { HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; window.tv.pause(); });
    let s = await st();
    ok(!s.has && !s.src, "while away the clip lets go of the decoder (" + JSON.stringify(s) + ")");
    await page.evaluate(() => window.tv.resume());
    await page.waitForTimeout(300);
    s = await st();
    ok(!s.has && s.photo !== "none", "back on the home the photo shows, not a black clip (" + JSON.stringify(s) + ")");
    ok(s.src === "https://video.example/clip.mp4", "and the clip is asked for again");
    await page.evaluate(() => document.getElementById("bgvid").dispatchEvent(new Event("playing")));
    ok((await st()).has, "once it really plays again it shows again");
    // the page's own hide and show (a WebView that never calls tv.pause) does the same
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    s = await st();
    ok(!s.has && s.photo !== "none" && !!s.src, "the page's own hide and show: photo first, clip asked again (" + JSON.stringify(s) + ")");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
  });

  // ------------------------------------------------------------------ g29
  await guard("g29", async () => {
    current = "g29";
    let page = await fresh({ userAgent: "Mozilla/5.0 (Linux; Android 14; MT9216 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" });
    await open(page, "&look=night&lighter=off");
    await page.evaluate(() => { window.__calls = []; const real = window.MOCK_API; window.MOCK_API = function (m, p, b) { window.__calls.push([m, p, b]); return real.apply(this, arguments); }; });
    const box = (sel, i) => page.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i || 0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: e.className, name: e.textContent.trim().slice(0, 30) }; }, [sel, i]);
    // the dock's apps: the grid's tiles (an app, then Settings, More apps)
    const apps = await page.evaluate(() => [...document.querySelectorAll("#grid > *")].map((e, i) => ({ i, cls: e.className, t: e.textContent.trim().slice(0, 20) })));
    ok(apps.length >= 3, "the dock has tiles (" + apps.length + ")");
    const second = await box("#grid > *", 1);
    await page.mouse.move(second.x - 40, second.y - 30);
    await page.mouse.move(second.x, second.y, { steps: 4 });
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelectorAll("#grid > *")[1].classList.contains("focus")), "pointing at a dock app moves the focus there (" + second.name + ")");
    await page.mouse.click(second.x, second.y);
    await page.waitForTimeout(300);
    const launched = await page.evaluate(() => window.__calls.filter((c) => c[1] === "/api/launch").map((c) => c[2] && c[2].app));
    ok(launched.length === 1, "a click opens that app, as OK does (" + JSON.stringify(launched) + ")");
    // a Keep watching tile
    const card = await box("#shelf > *", 0);
    await page.mouse.move(card.x, card.y, { steps: 4 });
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelector("#shelf > *").classList.contains("focus")), "pointing at a Keep watching tile focuses it");
    await page.mouse.click(card.x, card.y);
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__calls.some((c) => /^\/api\/(continue\/open|play|launch)/.test(c[1]) && c !== window.__calls[0])), "a click on the tile opens the show");
    ok(page.errors.length === 0, "no page errors on the home (" + page.errors.join(" | ") + ")");
    await page.close();
    // Home settings: a section and a row, on a fresh home (as when someone picks up the air mouse to change a setting)
    page = await fresh({ userAgent: "Mozilla/5.0 (Linux; Android 14; MT9216 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" });
    await open(page, "&look=night&lighter=off");
    await page.mouse.move(100, 100); await page.mouse.move(110, 110);
    await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
    const look = await page.evaluate(() => { const i = [...document.querySelectorAll("#set-secs > *")].findIndex((e) => /^Look/.test(e.textContent)); return i; });
    const lookBox = await box("#set-secs > *", look);
    await page.mouse.move(lookBox.x, lookBox.y, { steps: 3 });
    await page.mouse.click(lookBox.x, lookBox.y);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => /^Look/.test((document.querySelector(".ssec.on, .ssec.sel, .ssec.focus") || {}).textContent || "")), "a click on a section opens it");
    const rowI = await page.evaluate(() => [...document.querySelectorAll("#set-rows > .srow")].findIndex((e) => /^Glass app icons/.test(e.textContent)));
    ok(rowI >= 0, "the Glass app icons row is there");
    // the row is further down the list: the wheel (an air mouse's scroll) brings it into view first
    await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
    await page.evaluate((i) => { const r = document.querySelectorAll("#set-rows > .srow")[i]; r.scrollIntoView({ block: "center", behavior: "instant" }); }, rowI);
    await page.waitForTimeout(400);
    const before = await page.evaluate((i) => document.querySelectorAll("#set-rows > .srow")[i].textContent, rowI);
    const rb = await box("#set-rows > .srow", rowI);
    await page.mouse.move(rb.x, rb.y, { steps: 3 });
    await page.waitForTimeout(200);
    await page.mouse.click(rb.x, rb.y);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const r = [...document.querySelectorAll("#set-rows > .srow")].find((e) => /^Glass app icons/.test(e.textContent)); return r ? r.textContent : ""; });
    ok(before !== after, "a click on a settings row changes it, as OK does (" + before + " -> " + after + ")");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();

    // a TV whose remote never moves a pointer: a stray click (a remote's OK turned into a click) does nothing
    const p2 = await fresh();
    await open(p2, "&look=night");
    await p2.evaluate(() => { window.__calls = []; const real = window.MOCK_API; window.MOCK_API = function (m, p, b) { window.__calls.push([m, p, b]); return real.apply(this, arguments); }; });
    await p2.evaluate(() => { const e = document.querySelectorAll("#grid > *")[1]; e.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
    await p2.waitForTimeout(300);
    ok(await p2.evaluate(() => !window.__calls.some((c) => c[1] === "/api/launch") && !document.documentElement.classList.contains("has-pointer")), "no pointer moved: a click alone opens nothing");
    const nudge = (px) => p2.evaluate((d) => document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: d, clientX: 500, clientY: 500 })), px);
    await nudge(3); await p2.waitForTimeout(700); await nudge(3); await p2.waitForTimeout(100);
    ok(await p2.evaluate(() => !document.documentElement.classList.contains("has-pointer")), "two 3 px nudges a second apart do not turn the pointer on");
    await nudge(4); await nudge(4); await nudge(4); await p2.waitForTimeout(100);
    ok(await p2.evaluate(() => document.documentElement.classList.contains("has-pointer")), "a real move (more than 8 px in half a second) does");
    await p2.close();
  });

  // ------------------------------------------------------------------ g31
  await guard("g31", async () => {
    current = "g31";
    const page = await fresh();
    await open(page, "&look=night");
    await openSection(page, /^Quick/);
    const checked = () => page.evaluate(() => [...document.querySelectorAll("#set-rows > .srow")].filter((r) => r.classList.contains("on") || r.getAttribute("aria-checked") === "true" || /✓/.test(r.textContent)).map((r) => r.textContent.trim().slice(0, 30)));
    ok(await toRow(page, /^Look switch|^Look/), "the Look button row");
    await keys(page).press("Enter", 250);
    const saved = await page.evaluate(() => (JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).quick);
    ok(Array.isArray(saved) && saved.includes("look"), "the pick is saved on this TV at once (" + JSON.stringify(saved) + ")");
    await page.goto(BASE);
    await page.waitForFunction(() => window.tv && document.querySelector("#shelf"));
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => (JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).quick);
    ok(JSON.stringify(after) === JSON.stringify(saved), "after a restart the same buttons, in the same order (" + JSON.stringify(after) + ")");
    await page.close();
  });

  // ------------------------------------------------------------------ g33
  await guard("g33", async () => {
    current = "g33";
    const page = await fresh();
    await open(page, "&look=night&lighter=off");
    // the detector itself, on real frames: decoder green (BT.601 and BT.709), a flat dark green, foliage,
    // a blue sky and a green garden
    const judge = await page.evaluate(async () => {
      const make = async (paint) => {
        const c = document.createElement("canvas"); c.width = 320; c.height = 180;
        const x = c.getContext("2d"); paint(x);
        const v = document.createElement("video"); v.muted = true; v.srcObject = c.captureStream(10);
        document.body.appendChild(v); await v.play();
        const tick = setInterval(() => paint(x), 50);
        await new Promise((r) => setTimeout(r, 500)); clearInterval(tick);
        const g = window.CouchVideo.greenFrame(v); v.remove(); return g;
      };
      const flat = (c) => (x) => { x.fillStyle = c; x.fillRect(0, 0, 320, 180); };
      return {
        bt601: await make(flat("rgb(0,135,0)")),
        bt709: await make(flat("rgb(0,80,0)")),
        dark: await make(flat("rgb(0,100,0)")),
        foliage: await make(flat("rgb(40,120,30)")),
        sky: await make(flat("rgb(90,150,220)")),
        garden: await make((x) => { x.fillStyle = "rgb(40,120,30)"; x.fillRect(0, 0, 320, 120); x.fillStyle = "rgb(150,110,80)"; x.fillRect(0, 120, 320, 60); x.fillStyle = "rgb(200,220,240)"; x.fillRect(0, 0, 320, 40); }),
        leaves: await make((x) => { for (let i = 0; i < 320; i += 8) for (let k = 0; k < 180; k += 8) { x.fillStyle = "rgb(0," + (60 + ((i * 7 + k * 3) % 90)) + ",0)"; x.fillRect(i, k, 8, 8); } })
      };
    }).catch((e) => ({ err: String(e) }));
    ok(judge.bt601 === true && judge.bt709 === true, "a failed decoder's flat green is seen, BT.601 (0,135,0) and BT.709 (0,80,0) (" + JSON.stringify(judge) + ")");
    ok(judge.dark === true, "a flat dark green (0,100,0) frame is the same flat green");
    ok(judge.foliage === false, "foliage (40,120,30) is not green to the detector");
    ok(judge.sky === false && judge.garden === false, "a blue sky and a green garden are not");
    ok(judge.leaves === false, "green leaves of many shades (no red, no blue) are not, they are not flat");
    // watchGreen: two looks, 1.5 s and 5 s, must both be the same flat green
    const watched = await page.evaluate(async () => {
      const run = async (first, then) => {
        const c = document.createElement("canvas"); c.width = 320; c.height = 180;
        const x = c.getContext("2d"); let colour = first;
        const tick = setInterval(() => { x.fillStyle = colour; x.fillRect(0, 0, 320, 180); }, 50);
        const v = document.createElement("video"); v.muted = true; v.srcObject = c.captureStream(10);
        v.setAttribute("src", "stream:" + first);   // watchGreen follows the clip by its src
        document.body.appendChild(v); await v.play();
        let called = 0;
        window.CouchVideo.watchGreen(v, () => { called++; }, { noMark: true });
        setTimeout(() => { colour = then; }, 2500);
        await new Promise((r) => setTimeout(r, 5800)); clearInterval(tick); v.remove();
        return called;
      };
      return { steady: await run("rgb(0,135,0)", "rgb(0,135,0)"), once: await run("rgb(0,135,0)", "rgb(90,150,220)") };
    });
    ok(watched.steady === 1, "a clip that stays flat green at both looks is judged green (" + JSON.stringify(watched) + ")");
    ok(watched.once === 0, "one green frame, then real picture: not judged green");
    // a real green clip, recorded here, as the scene's own clip and as the video link
    const b64 = await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const x = c.getContext("2d"); const paint = () => { x.fillStyle = "rgb(0,135,0)"; x.fillRect(0, 0, 320, 180); }; paint();
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm;codecs=vp8" }), parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      const t = setInterval(paint, 60); rec.start();
      await new Promise((r) => setTimeout(r, 2500)); rec.stop(); clearInterval(t);
      await new Promise((r) => { rec.onstop = r; });
      const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s);
    });
    const GREEN = Buffer.from(b64, "base64");
    ok(GREEN.length > 200, "a green clip was recorded (" + GREEN.length + " bytes)");
    await page.close();

    // (1) the scene's own clip shows only green: it goes, the photo stays, and the TV remembers
    const p1 = await fresh();
    await p1.route(/\/backgrounds\/mine\/scene-g(@2x)?\.jpg/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await p1.route(/\/backgrounds\/mine\/scene-g\.mp4/, (r) => r.fulfill({ status: 200, contentType: "video/webm", body: GREEN }));
    await p1.addInitScript(() => {
      window.__clipPlayed = false;
      new MutationObserver(() => { if (document.querySelector(".svid.playing")) window.__clipPlayed = true; }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
    });
    await open(p1, "&look=night&lighter=off&scenes=g&myscenes=" + encodeURIComponent(JSON.stringify([{ id: "g", video: true }])));
    await p1.waitForTimeout(6500);
    const s1 = await p1.evaluate(() => {
      const v = document.querySelector(".scene .svid"), img = document.querySelector(".scene .sbg");
      return { played: window.__clipPlayed, playing: v ? v.classList.contains("playing") : null, src: v ? v.getAttribute("src") : null,
        photo: img ? img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== "none" : false,
        mark: localStorage.getItem("couchtv.video.green"), slow: localStorage.getItem("couchtv.video.slow") };
    });
    ok(s1.played === true, "the scene's clip really started (" + JSON.stringify(s1) + ")");
    ok(s1.playing === false && !s1.src, "a clip that shows only green goes (" + JSON.stringify(s1) + ")");
    ok(s1.photo, "and the scene's still photo shows");
    ok(!!s1.mark, "this TV remembers it for a week");
    ok(s1.slow === null, "and only for the home's own clips: a design's video is not stopped for a week");
    await p1.reload();
    await p1.waitForFunction(() => window.tv && document.querySelector("#shelf"));
    await p1.waitForTimeout(2500);
    ok(await p1.evaluate(() => { const v = document.querySelector(".scene .svid"); return !!v && !v.getAttribute("src"); }), "after a restart the clip is not tried again");
    await p1.close();

    // (2) the video link shows only green: the photo comes back and Look says why
    const p2 = await fresh();
    // a clip this page may read (on this TV or the computer at home); another site's clip cannot be looked at
    await p2.route(/\/backgrounds\/mine\/green\.webm/, (r) => r.fulfill({ status: 200, contentType: "video/webm", body: GREEN }));
    await open(p2, "&look=night&lighter=off&video=" + encodeURIComponent(ORIGIN + "/tv-home/web/backgrounds/mine/green.webm"));
    await p2.waitForTimeout(6500);
    const s2 = await p2.evaluate(() => ({ has: document.documentElement.classList.contains("has-video"), src: document.getElementById("bgvid").getAttribute("src"), mark: localStorage.getItem("couchtv.video.green") }));
    ok(!s2.has && !s2.src && !!s2.mark, "a green video link goes and the photo is back (" + JSON.stringify(s2) + ")");
    await openSection(p2, /^Look/);
    await toRow(p2, /^Video link/);
    ok(/green screen, so the photo is back/.test(await p2.evaluate(() => document.getElementById("set-rows").textContent)), "Look says why in plain words");
    await p2.evaluate(() => localStorage.setItem("couchtv.video.slow", String(Date.now())));
    ok(await toRow(p2, /^Try the video again/), "a Try the video again row");
    await keys(p2).press("Enter", 400);
    const s2b = await p2.evaluate(() => ({ green: localStorage.getItem("couchtv.video.green"), slow: localStorage.getItem("couchtv.video.slow"), src: document.getElementById("bgvid").getAttribute("src") }));
    ok(!s2b.green && !s2b.slow, "it forgets both marks (" + JSON.stringify(s2b) + ")");
    ok(/green\.webm$/.test(s2b.src || ""), "and asks for the video again at once");
    await p2.close();

    // (3) a broken clip (bytes that are no video): the photo stays
    const p3 = await fresh();
    await p3.route(/\/backgrounds\/mine\/scene-b(@2x)?\.jpg/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await p3.route(/\/backgrounds\/mine\/scene-b\.mp4/, (r) => r.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("this is not a video at all, just words") }));
    await open(p3, "&look=night&lighter=off&scenes=b&myscenes=" + encodeURIComponent(JSON.stringify([{ id: "b", video: true }])));
    await p3.waitForTimeout(2500);
    const s3 = await p3.evaluate(() => { const v = document.querySelector(".scene .svid"), img = document.querySelector(".scene .sbg"); return { playing: v.classList.contains("playing"), src: v.getAttribute("src"), photo: img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== "none" }; });
    ok(!s3.playing && !s3.src && s3.photo, "a broken clip lets go and the still photo shows (" + JSON.stringify(s3) + ")");
    ok(p3.errors.length === 0, "no page errors (" + p3.errors.join(" | ") + ")");
    await p3.close();
  });
  // ------------------------------------------------------------------ g34 (the TV side)
  await guard("g34", async () => {
    current = "g34";
    const page = await fresh();
    await open(page, "&look=night");
    await page.waitForTimeout(1500);
    const on = () => page.evaluate(() => [...document.querySelectorAll("#scenes .scene")].findIndex((e) => e.classList.contains("on")));
    const n = await page.evaluate(() => document.querySelectorAll("#scenes .scene").length);
    const start = await on();
    ok(n >= 2 && start >= 0, "the Night look shows a scene (" + start + " of " + n + ")");
    // what the home reads from /api/say after the phone's Next scene
    const say = (pick, ago) => page.evaluate(([pick, ago]) => { const now = Date.now(); window.CouchAsk._test.took({ scene: { pick, at: now - ago } }, now); }, [pick, ago || 0]);
    await say("next"); await page.waitForTimeout(2500);
    ok(await on() === (start + 1) % n, "Next scene from the phone shows the next scene (" + (await on()) + ")");
    await say("prev", 1); await page.waitForTimeout(2500);
    ok(await on() === start, "Previous scene goes back (" + (await on()) + ")");
    await say("next", 120000); await page.waitForTimeout(1500);
    ok(await on() === start, "a press from minutes ago (an old answer) changes nothing");
    await say("golden"); await page.waitForTimeout(1200);
    ok(await on() === start, "anything but next or prev changes nothing");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
    // Classic: the next photo
    const p2 = await fresh();
    await open(p2, "&look=classic");
    const place = () => p2.evaluate(() => document.getElementById("place").textContent);
    const before = await place();
    await p2.evaluate(() => { const now = Date.now(); window.CouchAsk._test.took({ scene: { pick: "next", at: now } }, now); });
    await p2.waitForTimeout(800);
    ok(await place() !== before && (await place()).length > 0, "Classic: Next scene shows the next photo (" + before + " -> " + (await place()) + ")");
    await p2.close();
  });
  // ------------------------------------------------------------------ g24
  await guard("g24", async () => {
    current = "g24";
    const page = await fresh();
    await open(page, "&look=night&iconset=solid");
    await page.waitForTimeout(800);
    const tool = (kind) => page.evaluate((k) => { const name = { gear: "Settings", more: "More apps" }[k]; const tile = [...document.querySelectorAll("#grid > *")].find((e) => (e.querySelector(".label") || {}).textContent === name); const t = tile && tile.querySelector(".face"); return t ? { cls: t.className, svg: !!t.querySelector("svg"), w: t.querySelector("svg") ? t.querySelector("svg").getBoundingClientRect().width : 0 } : null; }, kind);
    const gear = await tool("gear"), more = await tool("more");
    ok(gear && /iset-solid/.test(gear.cls) && gear.svg && gear.w > 10, "home.icon_set solid draws Settings from the icon set (" + JSON.stringify(gear) + ")");
    ok(more && /iset-solid/.test(more.cls) && more.svg, "and More apps (" + JSON.stringify(more) + ")");
    const app = await page.evaluate(() => { const i = document.querySelector('#grid [data-pkg="com.netflix.ninja"] .face img'); return i ? i.getAttribute("src") : null; });
    ok(!app || /app-logos/.test(app), "the apps keep their own icons (" + app + ")");
    // Home settings, Look, Icon style: steps through the styles and is kept
    await openSection(page, /^Look/);
    ok(await toRow(page, /^Icon style/), "a Look row Icon style");
    ok(/Solid/.test(await rowText(page, /^Icon style/)), "it says Solid, the style in use");
    await keys(page).press("Enter", 300);
    ok(/Two tone/.test(await rowText(page, /^Icon style/)), "OK moves to the next style (" + (await rowText(page, /^Icon style/)) + ")");
    const st = await page.evaluate(() => (JSON.parse(localStorage.getItem("mock:tvhome.settings") || "{}").s || {}).icon_set);
    ok(st === "duotone", "and it is saved (" + st + ")");
    ok(/iset-duotone/.test((await tool("gear")).cls), "the Settings tile is drawn again at once");
    for (let i = 0; i < 4; i++) await keys(page).press("Enter", 200);   // Colour tile, Glass, Playful, Standard
    ok(/Standard/.test(await rowText(page, /^Icon style/)), "round to Standard");
    ok(!/iset/.test((await tool("gear")).cls), "Standard is the usual drawing");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
    // without anything set, the home is exactly as before
    const p2 = await fresh();
    await open(p2, "&look=night");
    ok(await p2.evaluate(() => !document.querySelector("#grid .iset")), "nothing set: the usual drawing, exactly as before");
    await p2.close();
  });
} finally {
  await browser.close();
  server.close();
}
console.log(Object.keys(counts).map((k) => k + ": " + counts[k] + " checks passed").join("\n"));
if (fails.length) { console.log(fails.length + " checks FAILED"); process.exit(1); }
console.log("ok: social bugs browser tests passed (" + Object.values(counts).reduce((a, b) => a + b, 0) + " checks)");
