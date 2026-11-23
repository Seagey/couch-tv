// Matter devices in a real browser at 1920x1080 (the TV home's ?mock preview, mock.js ?matter=1, a
// pretend Matter controller) and the phone's Home settings page at 390x844 against a pretend TV:
//  1. a design's Control Centre, Aircon and Sensor widgets take Matter devices by id (design.js keeps
//     them), show them, and OK switches one: only its Matter id reaches /api/matter/command;
//  2. Home settings, Designs, Smart home lists every Matter device (never the lock or the garage),
//     adds one by code (a typo caught on the TV), renames it and removes it;
//  3. the phone page: the Matter section shows, says where each app keeps the code, catches a typo,
//     says plainly when a code ran out, adds, renames and removes.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_matter_ui_browser.mjs
// SHOTS=<folder> also saves pictures for a person to look at.
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
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// the pretend TV for the phone page: its /api/matter/* as the contract says, everything else empty
const MD = [
  { id: "matter:1:1", name: "Lounge lamp", domain: "light", state: "on", attributes: { brightness: 204 } },
  { id: "matter:5:1", name: "Hallway", domain: "climate", state: "heat", attributes: { temperature: 21 } },
  { id: "matter:7:1", name: "Front door lock", domain: "lock", state: "locked", attributes: {} },
  { id: "matter:8:1", name: "Garage", domain: "cover", state: "closed", attributes: { device_class: "garage" } }
];
const phoneAsked = [];
let notReady = "";   // a reason key (bridge/matter.py): the phone page says it in its own words
let nextReply = null;   // one answer the test sets for the next call to that path (a controller's reason key)
let unsupported = false;   // the on-TV app on a TV that cannot add Matter devices (nl-matter-android ae3e6c1)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.indexOf("/api/") === 0) {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      const body = b ? JSON.parse(b) : null;
      if (url.indexOf("/api/matter/") === 0) phoneAsked.push(url + " " + (b || ""));
      if (nextReply && url === nextReply.url) { const r = nextReply; nextReply = null; return json(r.code, r.body); }
      if (url === "/api/matter/devices") return json(200, notReady ? { devices: [], ready: false, reason: notReady, note: "Node.js 18 or newer is needed (found 16)." } : { devices: MD, ready: true });
      if (url === "/api/matter/commission") {
        if (unsupported) return json(400, { ok: false, error: "unsupported", note: "This TV cannot run the Matter controller." });
        if (body.code === "34970112332") { MD.push({ id: "matter:9:1", name: "Matter light", domain: "light", state: "off", attributes: {} }); return json(200, { ok: true, device_ids: ["matter:9:1"] }); }
        // the on-TV app (Matter.kt, ea574c2): a lock joins, the TV sees what it is and leaves it again
        if (body.code === "12345678902") return json(200, { ok: true, device_ids: [], note: "That device is not something the TV shows (locks, alarms and garage doors never show), so the TV did not keep it." });
        return json(400, { ok: false, error: "expired" });
      }
      const d = MD.find((x) => body && x.id === body.id);
      if (url === "/api/matter/rename" && d) { d.name = body.name; return json(200, { ok: true }); }
      if (url === "/api/matter/remove" && d) { MD.splice(MD.indexOf(d), 1); return json(200, d.id === "matter:1:1" ? { ok: true, removed: [d.id], note: "The device did not answer, so the TV forgot it." } : { ok: true, removed: [d.id] }); }
      if (url.indexOf("/api/matter/") === 0) return json(400, { ok: false, error: "refused" });
      return json(404, { ok: false, error: "no such endpoint" });
    });
    return;
  }
  const map = url === "/setup" ? "/on-tv/web/setup.html" : url.indexOf("/ontv/") === 0 ? "/on-tv/web/" + url.slice(6) : url.indexOf("/tv/") === 0 ? "/tv-home/web/" + url.slice(4) : url;
  const p = path.normalize(decodeURIComponent(map)).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const BASE = ORIGIN + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
// the phone page folds each section: open the Matter card so its box and buttons can be used
const unfold = (page) => page.evaluate(() => { const b = document.querySelector("#matter .fold-btn"); if (b && document.getElementById("matter").classList.contains("shut")) b.click(); });
const press = async (page, k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };

const browser = await chromium.launch();
async function home(qs, widgets) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, objects: widgets.map((x, i) => ({ id: "w" + i, type: "widget", kind: x[0], x: 80 + (i % 3) * 600, y: 60 + Math.floor(i / 3) * 420, w: 560, h: 380, opts: x[1] })) };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local" + qs);
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDetail && window.CouchMatter && window.CouchMatter.on(), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  return page;
}
const text = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id || "w0");
const cur = (page) => page.evaluate(() => window.CouchDetail.current());

console.log("Running Matter UI browser tests...");

// 1. the widgets
{
  const page = await home("&matter=1", [["controls", { switches: ["light.matter_1_1", "switch.matter_2_1", "cover.matter_4_1"] }], ["aircon", { entity: "climate.matter_5_1" }], ["sensor", { reading: "sensor.matter_6_1" }]]);
  const kept = await page.evaluate(() => {
    const W = (kind, opts) => ({ v: 1, objects: [{ id: "a", type: "widget", kind, x: 80, y: 60, w: 360, h: 360, opts }] });
    const opts = (kind, o) => ((window.CouchDesign.check(W(kind, o)).clean.objects || [])[0] || {}).opts || {};
    return [opts("controls", { switches: ["light.matter_1_1", "matter:1:1", "switch.matter_a1b2_3"] }), opts("aircon", { entity: "climate.matter_5_1" }), opts("sensor", { reading: "sensor.matter_6_1" })];
  });
  ok(JSON.stringify(kept[0]) === '{"switches":["light.matter_1_1","switch.matter_a1b2_3"]}', "design.js keeps a Matter device's page id and drops the raw contract id: " + JSON.stringify(kept[0]));
  ok(kept[1].entity === "climate.matter_5_1" && kept[2].reading === "sensor.matter_6_1", "an aircon and a sensor keep their Matter ids");
  const picks = await page.evaluate(() => [window.smartHome.live().info.controls.map((c) => c.entity), window.smartHome.live().info.sensors.map((c) => c.entity)]);
  ok(picks[0].join() === "light.matter_1_1,switch.matter_2_1,fan.matter_3_1,cover.matter_4_1" && picks[1].join() === "sensor.matter_6_1,sensor.matter_6_2", "the lists the pick-lists read: " + JSON.stringify(picks));
  ok(!JSON.stringify(picks).match(/matter_7|matter_8/), "the lock and the garage door are not in them");
  await page.waitForFunction(() => /Lounge lamp/.test(document.querySelector('.cw-o[data-obj="w0"] .cw').textContent), null, { timeout: 8000 });
  ok(/Lounge lamp/.test(await text(page, "w0")) && /Heater plug/.test(await text(page, "w0")), "Control Centre shows the Matter switches: " + (await text(page, "w0")).slice(0, 120));
  await page.waitForFunction(() => /Hallway/.test(document.querySelector('.cw-o[data-obj="w1"] .cw').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Hallway/.test(await text(page, "w1")) && /21/.test(await text(page, "w1")), "the aircon widget shows the Matter thermostat at 21: " + (await text(page, "w1")).slice(0, 120));
  await page.waitForFunction(() => /22/.test(document.querySelector('.cw-o[data-obj="w2"] .cw').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/22/.test(await text(page, "w2")), "the sensor widget reads 22.4: " + (await text(page, "w2")).slice(0, 120));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-widgets.png") });
  await page.evaluate(() => { const s = window.CouchDesign.nav; for (let k = 0; k < 6 && s.current().id !== "w0"; k++) s.move(-1, 0); });
  await press(page, "Enter", 800);
  ok((await cur(page)).name === "controls", "OK opens Control Centre");
  await page.waitForFunction(() => document.querySelectorAll(".cwd-toggle").length >= 3, null, { timeout: 5000 });
  ok((await cur(page)).focusName === "Lounge lamp", "lands on the Matter lamp");
  await page.evaluate(() => { window.MOCK_MATTER_LOG.length = 0; });
  await press(page, "Enter", 900);
  const log = await page.evaluate(() => window.MOCK_MATTER_LOG.filter((l) => /command/.test(l)));
  ok(log.length === 1 && log[0] === 'POST /api/matter/command {"id":"matter:1:1","action":"off"}', "OK switched the lamp off by its Matter id: " + JSON.stringify(log));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-controls-detail.png") });
  await press(page, "Escape", 500);
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2. Home settings, Designs, Smart home
{
  const page = await home("&matter=1&hasetup=1", [["controls", {}]]);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  const toRow = async (re) => { for (let i = 0; i < 80; i++) { const t = await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || ""); if (re.test(t)) return true; await press(page, "ArrowDown", 90); } return false; };
  const rows = () => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll("#settings .srow, #settings .shead"), (e) => e.textContent.trim()));
  const type = async (words) => { await press(page, "Enter", 300); await page.fill("#set-input", words); await press(page, "Enter", 900); };
  const said = () => page.evaluate(() => { const e = document.querySelector("#settings .smsg, #set-msg, .set-msg"); return e ? e.textContent : document.querySelector("#settings").textContent; });
  ok(await toRow(/^Smart home/), "Home settings, Designs has Smart home");
  await press(page, "Enter", 400);
  let all = (await rows()).join(" | ");
  ok(/Matter devices/.test(all), "a Matter devices heading");
  ok(["Lounge lamp", "Heater plug", "Ceiling fan", "Study blind", "Hallway", "Nursery temperature", "Nursery humidity"].every((x) => all.indexOf(x) >= 0), "every Matter device is listed: " + all);
  ok(!/Front door lock|Garage/.test(all), "never the lock or the garage door");
  ok(/Lounge lampLight, on/.test(all.replace(/\s+/g, " ").replace(/ (?=Light)/, "")) || /Light, on/.test(all), "each says what it is and how it is now");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-settings.png") });
  ok(await toRow(/^Add a Matter device/), "Add a Matter device");
  await press(page, "Enter", 400);
  all = (await rows()).join(" | ") + (await page.evaluate(() => document.querySelector("#settings").textContent));
  ok(["Google Home", "Apple Home", "SmartThings", "Alexa", "Linked Matter apps and services", "Turn On Pairing Mode", "Share with other services", "Other Assistants and Apps"].every((x) => all.indexOf(x) >= 0), "where each app keeps the code");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-add-tv.png") });
  ok(await toRow(/^Type the code/), "Type the code");
  await page.evaluate(() => { window.MOCK_MATTER_LOG.length = 0; });
  await type("3497 011 2333");
  ok(/One of those numbers is wrong/.test(await said()), "a typo is caught on the TV");
  ok(!(await page.evaluate(() => window.MOCK_MATTER_LOG.some((l) => /commission/.test(l)))), "and nothing was sent");
  await type("749701123365521327694");
  await page.waitForTimeout(400);
  ok(/That code ran out/.test(await said()), "a code that ran out says so plainly");
  await type("2000 000 0000");
  await page.waitForTimeout(400);
  ok(/never locks, alarms or garage doors/.test(await said()), "a lock shared by mistake says so plainly (the bridge's not_allowed)");
  await type("3497 011 2332");
  await page.waitForFunction(() => /Added: Matter light/.test(document.querySelector("#settings").textContent), null, { timeout: 6000 }).catch(() => {});
  ok(/Added: Matter light/.test(await said()), "added, by name");
  await press(page, "Escape", 400);
  all = (await rows()).join(" | ");
  ok(/Matter light/.test(all), "the new light is listed: " + all);
  ok(await page.evaluate(() => window.smartHome.live().info.controls.some((c) => c.entity === "light.matter_27_1" || /matter_\d+_1/.test(c.entity) && c.name === "Matter light")), "and the widgets' list has it");
  ok(await toRow(/^Matter light/), "the new light's row"); await press(page, "Enter", 400);
  ok(await toRow(/^Rename/), "Rename");
  await page.evaluate(() => { window.MOCK_MATTER_LOG.length = 0; });
  await type("Garage door light");
  ok(/Pick another name/.test(await said()) && !(await page.evaluate(() => window.MOCK_MATTER_LOG.some((l) => /rename/.test(l)))), "a name that would hide the light is turned down on the TV, nothing sent");
  await type("Porch light");
  ok(/Renamed/.test(await said()), "renamed");
  ok(await toRow(/^Remove from this TV/), "Remove"); await press(page, "Enter", 300);
  ok(/Press OK again to remove it/.test(await page.evaluate(() => document.querySelector(".srow.focus").textContent)), "asks once more first");
  await press(page, "Enter", 900);
  ok(/Removed from this TV/.test(await said()), "removed");
  all = (await rows()).join(" | ");
  ok(!/Porch light|Matter light/.test(all), "and it is gone from the list");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2a. the home computer says why Matter is not ready (a reason key): the TV says it in its own words
{
  const page = await home("&matter=nodeold&hasetup=1", [["controls", {}]]);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  for (let i = 0; i < 80 && !/^Smart home/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 90);
  await press(page, "Enter", 500);
  const t = await page.evaluate(() => document.querySelector("#settings").textContent);
  ok(/Matter devices/.test(t) && /Node\.js is too old for Matter/.test(t) && !/found 16/.test(t), "not ready: the reason in plain words, never the English note");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2e. an Android 6 TV (the on-TV app's reason android_old): the TV says it in plain words
{
  const page = await home("&matter=androidold&hasetup=1", [["controls", {}]]);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  for (let i = 0; i < 80 && !/^Smart home/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 90);
  await press(page, "Enter", 500);
  const t = await page.evaluate(() => document.querySelector("#settings").textContent);
  ok(/Matter needs Android 7 or newer on this TV/.test(t) && !/found 16/.test(t), "Android 6 TV: the reason in plain words");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2c. the TV in German: the Matter rows, the device's words and the add screen in German
{
  const page = await home("&matter=1&hasetup=1", [["controls", {}]]);
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300); await press(page, "Enter", 400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => /Designs/.test((document.querySelector(".ssec.focus") || {}).textContent || ""))); i++) await press(page, "ArrowDown");
  await press(page, "ArrowRight");
  for (let i = 0; i < 80 && !/^Smart home/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 90);
  await press(page, "Enter", 500);
  // the TV's language changes (Home settings, Language) and the screen draws again. Up and Down only
  // move the focus since #301 (moveFocusInPlace, no rebuild), so go back to Designs and into Smart home
  // again, as someone who just changed the language would; the Language row itself redraws at once.
  await page.evaluate(() => window.I18N.set("de"));
  await press(page, "ArrowLeft", 300);
  for (let i = 0; i < 80 && !/^Smart Home|^Smart home/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 90);
  await press(page, "Enter", 500);
  const t = await page.evaluate(() => document.querySelector("#settings").textContent);
  ok(/Matter-Geräte/.test(t) && /Ein Matter-Gerät hinzufügen/.test(t) && /Lampe, an/.test(t) && !/Add a Matter device/.test(t), "German: heading, device words and Add: " + (t.match(/Matter-Ger[^|]{0,80}/) || [""])[0]);
  for (let i = 0; i < 80 && !/^Ein Matter-Gerät hinzufügen/.test(await page.evaluate(() => (document.querySelector(".srow.focus") || {}).textContent || "")); i++) await press(page, "ArrowDown", 90);
  await press(page, "Enter", 400);
  const add = await page.evaluate(() => document.querySelector("#settings").textContent);
  ok(/Wo du den Code findest/.test(add) && /Verknüpfte Matter-Apps und -Dienste/.test(add) && /Code eingeben/.test(add), "German: where each app keeps the code");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-add-tv-de.png") });
  await page.evaluate(() => window.I18N.set("en"));
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2d. the phone page in French (the TV's language, as phone-words.js on nl-remote hands it over): the
// card's list and messages from the same table
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  // on this branch a stand in; with nl-remote merged its phone-words.js replaces it and reads the kept language
  await page.addInitScript(() => { try { localStorage.setItem("couchtv.token", "test-token"); localStorage.setItem("couchtv.phone.lang", "fr"); } catch (e) {} window.PhoneWords = { lang: () => "fr" }; });
  await page.goto(ORIGIN + "/setup#matter");
  await page.waitForFunction(() => document.getElementById("matter").style.display !== "none" && /Lounge|Hallway/.test(document.getElementById("matter-list").textContent), null, { timeout: 8000 })
    .catch((e) => { throw new Error("phone page in French never showed its Matter list; page errors: " + page.errors.join(" | ")); });
  await unfold(page);
  const list = await page.evaluate(() => document.getElementById("matter-list").textContent);
  ok(/Lampe/.test(list) && /Thermostat/.test(list) && /Renommer/.test(list) && /Retirer/.test(list) && !/Rename/.test(list), "French: kinds and buttons: " + list.slice(0, 120));
  await page.fill("#matter-code", "3497-011-2333"); await page.click("#matter-add"); await page.waitForTimeout(300);
  ok(/Un des chiffres est faux/.test(await page.evaluate(() => document.getElementById("matter-msg").textContent)), "French: a typo");
  const head = await page.evaluate(() => [(document.querySelector("#matter h2 .fold-btn") || {}).textContent, document.getElementById("matter-add").textContent, document.getElementById("matter-code").placeholder, document.getElementById("jump-matter").textContent]);
  ok(head[0] === "Appareils Matter" && head[1] === "Ajouter à la télé" && /chiffres/.test(head[2]) && head[3] === "Matter", "French: the card's own heading, button and hint: " + JSON.stringify(head));
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 2b. no Matter controller (an older bridge): nothing about Matter shows
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&hasetup=1&matter=down");
  await page.waitForFunction(() => window.CouchMatter, null, { timeout: 8000 });
  await page.waitForTimeout(800);
  ok(!(await page.evaluate(() => window.CouchMatter.on())), "a controller that does not answer: Matter is off");
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

// 3. the phone page
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem("couchtv.token", "test-token"); } catch (e) {} });
  let answer = "Desk lamp";
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? answer : undefined));
  await page.goto(ORIGIN + "/setup#matter");
  await page.waitForFunction(() => document.getElementById("matter").style.display !== "none", null, { timeout: 8000 });
  ok(await page.evaluate(() => document.getElementById("jump-matter").style.display !== "none"), "the Matter chip shows");
  await page.evaluate(() => { const b = document.querySelector("#matter .fold-btn"); if (b && document.getElementById("matter").classList.contains("shut")) b.click(); });
  const listed = await page.evaluate(() => document.getElementById("matter-list").textContent);
  ok(/Lounge lamp/.test(listed) && /Hallway/.test(listed) && !/lock|Garage/.test(listed), "the devices, never the lock or the garage: " + listed);
  const words = await page.evaluate(() => document.getElementById("matter").textContent);
  ok(["Linked Matter apps and services", "Use pairing code", "Turn On Pairing Mode", "Copy Code", "Share with other services", "Other Assistants and Apps", "Add another"].every((x) => words.indexOf(x) >= 0), "where each app keeps the code");
  ok(!/[–—]/.test(words), "no dashes in the words");
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(noScroll, "nothing wider than the phone");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-phone.png"), fullPage: false });
  const msg = () => page.evaluate(() => document.getElementById("matter-msg").textContent);
  phoneAsked.length = 0;
  await page.fill("#matter-code", "3497-011-2333"); await page.click("#matter-add"); await page.waitForTimeout(300);
  ok(/One of those numbers is wrong/.test(await msg()) && !phoneAsked.some((x) => /commission/.test(x)), "a typo is caught on the phone, nothing sent");
  await page.fill("#matter-code", "749701123365521327694"); await page.click("#matter-add"); await page.waitForTimeout(600);
  ok(/That code ran out/.test(await msg()), "a code that ran out: " + await msg());
  await page.fill("#matter-code", "1234 567 8902"); await page.click("#matter-add"); await page.waitForTimeout(600);
  ok(/never locks, alarms or garage doors/.test(await msg()) && !/Added/.test(await msg()), "a lock the TV left again is not called added: " + await msg());
  await page.fill("#matter-code", "3497-011-2332"); await page.click("#matter-add"); await page.waitForTimeout(800);
  ok(/Added/.test(await msg()) && /Matter light/.test(await page.evaluate(() => document.getElementById("matter-list").textContent)), "added and listed: " + await msg());
  ok(phoneAsked.some((x) => x === '/api/matter/commission {"code":"34970112332"}'), "the code is sent as plain numbers");
  answer = "Garage door light"; phoneAsked.length = 0;
  await page.click('#matter-list li[data-id="matter:9:1"] button[data-mt="rename"]'); await page.waitForTimeout(500);
  ok(/Pick another name/.test(await msg()) && !phoneAsked.some((x) => /rename/.test(x)), "a name that would hide the light is turned down on the phone, nothing sent: " + await msg());
  answer = "Desk lamp";
  await page.click('#matter-list li[data-id="matter:9:1"] button[data-mt="rename"]'); await page.waitForTimeout(700);
  ok(/Desk lamp/.test(await page.evaluate(() => document.getElementById("matter-list").textContent)), "renamed");
  await page.click('#matter-list li[data-id="matter:9:1"] button[data-mt="remove"]'); await page.waitForTimeout(700);
  ok(!/Desk lamp/.test(await page.evaluate(() => document.getElementById("matter-list").textContent)) && /off the TV/.test(await msg()) && !/did not answer/.test(await msg()), "removed");
  await page.click('#matter-list li[data-id="matter:1:1"] button[data-mt="remove"]'); await page.waitForTimeout(700);
  ok(/Lounge lamp is off the TV\. The device did not answer/.test(await msg()), "a device that did not answer: removed, and it says the other app may still list the TV: " + await msg());
  const small = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll("#matter button, #matter input"), (e) => e.offsetParent && e.getBoundingClientRect().height < 40).length);
  ok(small === 0, "every button and box at least 40 px tall");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "matter-phone-after.png") });
  notReady = "node_old";
  await page.reload(); await page.waitForFunction(() => document.getElementById("matter").style.display !== "none", null, { timeout: 8000 }); await unfold(page);
  const why = await page.evaluate(() => document.getElementById("matter-note").textContent);
  ok(/Node.js is too old for Matter/.test(why) && !/found 16/.test(why), "not ready: the reason key in plain words, not the English note: " + why);
  // the on-TV app on an Android 6 TV and on an Intel TV (reason keys), and a commission it cannot do
  for (const [key, re] of [["android_old", /needs Android 7 or newer/], ["processor", /processor can't run Matter/]]) {
    notReady = key;
    await page.reload(); await page.waitForFunction(() => document.getElementById("matter").style.display !== "none", null, { timeout: 8000 }); await unfold(page);
    const w = await page.evaluate(() => document.getElementById("matter-note").textContent);
    ok(re.test(w) && !/found 16/.test(w), "not ready, " + key + ": in plain words: " + w);
  }
  notReady = ""; unsupported = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById("matter").style.display !== "none", null, { timeout: 8000 }); await unfold(page);
  await page.fill("#matter-code", "3497-011-2332"); await page.click("#matter-add"); await page.waitForTimeout(600);
  ok(/This TV can't add Matter devices/.test(await msg()), "a commission the TV cannot do: " + await msg());
  unsupported = false;
  // contract change 14: every reason key, as the controllers send it, worded on the phone (never the raw note)
  const en = (k) => page.evaluate((key) => window.CouchMatterWords.en(key), k);
  for (const k of ["off", "not_installed", "node_missing", "node_old", "starting", "stopped", "android_old", "processor", "not_started", "busy"]) {
    notReady = k;
    await page.reload(); await page.waitForFunction(() => document.getElementById("matter").style.display !== "none", null, { timeout: 8000 }); await unfold(page);
    ok(await page.evaluate(() => document.getElementById("matter-note").textContent) === await en("why_" + k), "phone, not ready, reason " + k);
  }
  notReady = "";
  await page.reload(); await page.waitForFunction(() => document.getElementById("matter").style.display !== "none" && /Hallway/.test(document.getElementById("matter-list").textContent), null, { timeout: 8000 }); await unfold(page);
  const cases = [["blocked", "commission", "not_allowed"], ["unsupported", "commission", "not_allowed"], ["address", "commission", "unreachable"], ["port", "commission", "unreachable"],
    ["link_local", "commission", "unreachable"], ["busy", "commission", "failed"], ["processor", "commission", "unsupported"], ["android_old", "commission", "unsupported"],
    ["starting", "commission", "unreachable"], ["opens_house", "rename", "refused"], ["offline", "remove", ""], ["not_answering", "remove", ""],
    ["not_found", "rename", "refused"], ["not_allowed", "rename", "refused"], ["bad_request", "remove", "failed"], ["bad_name", "rename", "bad_request"],
    ["not_ready", "remove", "failed"], ["device_refused", "rename", "failed"], ["failed", "remove", "failed"], ["not_answering", "rename", "failed"], ["not_certified", "commission", "not_allowed"], ["local_network", "commission", "unreachable"]];
  for (const [k, what, err] of cases) {
    nextReply = { url: "/api/matter/" + what, code: err ? 400 : 200, body: err ? { ok: false, error: err, reason: k, note: "Raw English note." } : { ok: true, removed: ["matter:5:1"], reason: k, note: "Raw English note." } };
    if (what === "commission") { await page.fill("#matter-code", "3497-011-2332"); await page.click("#matter-add"); }
    else { answer = "Garden lamp"; await page.click('#matter-list li[data-id="matter:5:1"] button[data-mt="' + what + '"]'); }
    await page.waitForTimeout(600);
    const m = await msg(), w = await en("why_" + k);
    ok(m.indexOf(w) >= 0 && !/Raw English note/.test(m), "phone, " + what + " " + (err || "ok") + ", reason " + k + ": " + m);
  }
  // a refused rename with no reason is not called a hiding name (only opens_house or the page's own check is)
  nextReply = { url: "/api/matter/rename", code: 400, body: { ok: false, error: "refused" } };
  answer = "Garden lamp"; await page.click('#matter-list li[data-id="matter:5:1"] button[data-mt="rename"]'); await page.waitForTimeout(600);
  ok(await msg() === await en("err_refused"), "phone, rename refused with no reason: " + await msg());
  // the on-TV app: a second commission while one runs (error busy)
  nextReply = { url: "/api/matter/commission", code: 409, body: { ok: false, error: "busy", note: "Raw English note." } };
  await page.fill("#matter-code", "3497-011-2332"); await page.click("#matter-add"); await page.waitForTimeout(600);
  ok(await msg() === await en("err_busy"), "phone, commission error busy: " + await msg());
  nextReply = null;
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("ok " + n + " Matter UI browser checks");
