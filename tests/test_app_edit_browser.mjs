// Apps by catalogue id on a real TV page, and changing them with the remote, in a real browser at
// 1920x1080 (mock.js stands in for the TV and its installed apps):
//  1. a dock naming ["netflix", "hotstar", "stan"]: Netflix and Stan open by this TV's packages; JioHotstar
//     is not installed, so it is dimmed "Not on this TV" and OK on it says how to get it;
//  2. Hold OK on an app: Change app (a picker of the TV's own apps), Move, Remove, Add apps, and All apps
//     (every installed app stays reachable); each change is kept on the TV and survives a reload;
//  3. a folder: Add apps, Remove from folder; the Add app place at the end of a dock (Add apps itself:
//     tests/test_app_sheet_browser.mjs);
//  4. a new design by code with app changes kept: the question offers to keep them or take its own.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_app_edit_browser.mjs
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const design = { v: 1, background: { colour: "#26303f" }, objects: [
  { id: "d", type: "widget", kind: "dock", x: 80, y: 60, w: 1160, h: 160, opts: { apps: ["netflix", "hotstar", "stan"], more: false } },
  { id: "f", type: "widget", kind: "folder", x: 80, y: 300, w: 760, h: 560, opts: { label: "Kids", apps: ["iview", "youtube"] } }
] };
async function load(reset) {
  if (reset) {
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  }
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="d"] .cw') && window.CouchDesign && window.CouchDesign.nav);
  await page.waitForTimeout(600);
}
const slots = (id) => page.evaluate((i) => [...document.querySelectorAll('.cw-o[data-obj="' + i + '"] [data-slot]')].map((e) => [e.getAttribute("data-act"), e.getAttribute("data-arg") || "", e.getAttribute("data-slot"), e.textContent]), id);
const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 220); };
const focus = (id, i) => page.evaluate(([a, b]) => window.CouchDesign.nav.focus(a, b), [id, i]);
async function hold() { await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300); }
const menu = () => page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
async function choose(label) {
  const items = await menu(), i = items.indexOf(label);
  assert.ok(i >= 0, "menu has " + label + " (" + items.join(", ") + ")");
  for (let k = 0; k < i; k++) await press("ArrowDown", 80);
  await press("Enter", 400);
}
async function pick(pkg) {
  const at = await page.evaluate((p) => { const ns = [...document.querySelectorAll(".cw-sheet [data-act=pick]")]; const row = document.querySelector(".cw-sheet .cw-sheet-apps"); return { i: ns.findIndex((x) => x.getAttribute("data-arg") === p), cols: Math.max(1, Math.round(row.offsetWidth / 244)), n: ns.length }; }, pkg);
  assert.ok(at.i >= 0, "the picker lists " + pkg);
  for (let k = 0; k < Math.floor(at.i / at.cols); k++) await press("ArrowDown", 60);
  for (let k = 0; k < at.i % at.cols; k++) await press("ArrowRight", 60);
  await press("Enter", 500);
}
// Add apps (0.13.11): the sheet with every app; OK on one app adds it, Back saves
async function sheetAdd(pkg) {
  const at = await page.evaluate((p) => { const ns = [...document.querySelectorAll(".cw-appsheet .cw-as-tile")]; return { i: ns.findIndex((x) => x.getAttribute("data-pkg") === p), cols: ns.filter((x) => x.offsetTop === ns[0].offsetTop).length }; }, pkg);
  assert.ok(at.i >= 0, "the sheet lists " + pkg);
  for (let k = 0; k < Math.floor(at.i / at.cols); k++) await press("ArrowDown", 60);
  for (let k = 0; k < at.i % at.cols; k++) await press("ArrowRight", 60);
  await press("Enter", 400); await press("Escape", 500);
}
const edits = () => page.evaluate(() => window.CouchDesign.appEdits());

console.log("Running app editing browser tests...");
await load(true);

// 1. resolve
let s = await slots("d");
ok(s[0][0] === "app" && s[0][1] === "com.netflix.ninja", "Netflix opens by this TV's package");
ok(s[1][0] === "missing" && s[1][1] === "hotstar" && /Not on this TV/.test(s[1][3]), "JioHotstar is not installed: dimmed, Not on this TV");
ok(s[2][0] === "app" && s[2][1] === "au.com.stan.and", "Stan opens by this TV's package");
ok(s[3] && s[3][0] === "addapp", "an Add app place at the end of the dock");
await focus("d", 1); await press("Enter", 500);
ok(/Not on this TV\. Install it from the App Store/.test(await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || "")), "OK on a missing app says how to get it");

// 2. Hold OK: change, remove, move, all apps
await focus("d", 0); await hold();
const m = await menu();
ok(["Change app", "Move", "Remove", "Add apps", "All apps", "Settings"].every((x) => m.indexOf(x) >= 0), "Hold OK on an app: Change app, Move, Remove, Add apps, All apps, Settings (" + m.join(", ") + ")");
await choose("Change app");
ok(await page.evaluate(() => !!document.querySelector(".cw-sheet .cw-sheet-apps") && !document.querySelector('.cw-sheet [data-arg="com.android.tv.settings"]')), "Change app opens a picker of the TV's own apps, without Settings");
await pick("com.disney.disneyplus");
ok(JSON.stringify((await edits())["d|dock"]) === '["disney","hotstar","stan"]', "Change app: Netflix became Disney+, kept on the TV");
ok((await slots("d"))[0][1] === "com.disney.disneyplus", "the dock now opens Disney+");
await focus("d", 1); await hold(); await choose("Remove");
ok(JSON.stringify((await edits())["d|dock"]) === '["disney","stan"]', "Remove: JioHotstar is gone");
await focus("d", 1); await hold(); await choose("Move");
ok(await page.evaluate(() => window.CouchDesign.nav.moving()), "Move: the app is picked up");
await press("ArrowLeft", 400); await press("Enter", 300);
ok(JSON.stringify((await edits())["d|dock"]) === '["stan","disney"]', "Move: Left puts Stan first, OK puts it down");
ok(!(await page.evaluate(() => window.CouchDesign.nav.moving())), "Move: done");
// the Add app place: OK opens Add apps
s = await slots("d");
await focus("d", s.findIndex((x) => x[0] === "addapp")); await press("Enter", 500);
await sheetAdd("com.sbs.ondemand.tv");
ok(JSON.stringify((await edits())["d|dock"]) === '["stan","disney","sbs"]', "Add app: SBS On Demand added at the end");
// All apps stays reachable
await focus("d", 0); await hold(); await choose("All apps");
ok(await page.evaluate(() => document.documentElement.classList.contains("expanded") || !!document.querySelector(".cw-sheet") || !!document.querySelector("#grid .app")), "All apps opens the TV's whole list");
await press("Escape", 400);

// 3. a folder
await load(false);
await focus("f", 0); await hold();
const fm = await menu();
ok(fm.indexOf("Remove from folder") >= 0 && fm.indexOf("Add apps") >= 0, "Hold OK in a folder: Remove from folder, Add apps (" + fm.join(", ") + ")");
await choose("Add apps");
await sheetAdd("au.com.kayosports.tv");
ok(JSON.stringify((await edits())["f|folder"]) === '["iview","youtube","kayo"]', "Add apps in a folder: Kayo added");
await focus("f", 1); await hold(); await choose("Remove from folder");
ok(JSON.stringify((await edits())["f|folder"]) === '["iview","kayo"]', "Remove from folder: YouTube gone");

// 4. kept after a restart
await load(false);
s = await slots("d");
ok(s[0][1] === "au.com.stan.and" && s[1][1] === "com.disney.disneyplus" && s[2][1] === "com.sbs.ondemand.tv", "after a reload the dock is as the person left it");
ok((await slots("f")).filter((x) => x[0] === "app").map((x) => x[1]).join(",") === "au.net.abc.iview,au.com.kayosports.tv", "and the folder too");

// Hebrew (right to left): the Change app picker's tiles run from the right, so Left goes on to the next app
await page.evaluate(() => window.I18N.set("he"));
ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "Hebrew turns the page right to left");
await focus("d", 0); await hold();
const hm = await page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.getAttribute("data-name")));
ok(hm.indexOf("Change app") >= 0, "Hold OK in Hebrew still offers Change app (" + hm.join(", ") + ")");
for (let k = 0; k < hm.indexOf("Change app"); k++) await press("ArrowDown", 80);
await press("Enter", 400);
const picked = () => page.evaluate(() => { const ns = [...document.querySelectorAll(".cw-sheet [data-act=pick]")]; return { at: ns.findIndex((x) => x.classList.contains("cw-ifocus")), lefts: ns.slice(0, 2).map((x) => x.getBoundingClientRect().left) }; });
let pk = await picked();
ok(pk.at === 0 && pk.lefts[0] > pk.lefts[1], "the picker's first app is on the right: " + pk.lefts.join(" > "));
await press("ArrowRight", 100);
ok((await picked()).at === 0, "Right at the first app (the right edge) stays on it");
await press("ArrowLeft", 100);
ok((await picked()).at === 1, "Left goes on to the next app, to its left");
await press("ArrowRight", 100);
ok((await picked()).at === 0, "and Right comes back to the first");
await press("Escape", 400);
ok(!(await page.evaluate(() => !!document.querySelector(".cw-sheet"))) && (await slots("d"))[0][1] === "au.com.stan.and", "Back closes the picker and changes nothing");
await page.evaluate(() => window.I18N.set("en"));
ok(await page.evaluate(() => document.documentElement.dir) === "ltr", "English turns it back");
await page.screenshot({ path: path.join(process.env.SHOTS || "/tmp", "app-edit.png") });

// 5. a new design by code: keep the app changes, or take the design's own apps
const fetched = JSON.stringify({ design: Object.assign({}, design, { objects: design.objects.map((o) => Object.assign({}, o)) }), at: Date.now() });
await page.evaluate((f) => { localStorage.setItem("couchtv.design.fetched", f); localStorage.removeItem("couchtv.design.ok"); localStorage.setItem("mock:tvhome.designer", JSON.stringify("on")); }, fetched);
await page.goto(BASE + "?mock=1");
await page.waitForTimeout(2500);
const q = await page.evaluate(() => [...document.querySelectorAll(".cd-ask div")].map((e) => e.textContent).filter((t) => /^(Keep my home|Use this design)/.test(t)));
ok(q.indexOf("Use this design, keep my app changes") >= 0 && q.indexOf("Use this design with its own apps") >= 0, "the question offers to keep the app changes or take the design's own (" + q.join(" | ") + ")");
await press("ArrowDown", 100); await press("ArrowDown", 100); await press("Enter", 2500);
ok(Object.keys(await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("couchtv.design.appedits") || "{}"); } catch (e) { return {}; } })).length === 0, "its own apps: the changes on this TV are cleared");

// 6. a shared home's dock order by catalogue ids: each becomes the app this TV has
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify({ v: 1, apps: { order: ["stan", "netflix", "iview"] } })); });
await page.goto(BASE + "?mock=1&design=local");
await page.waitForFunction(() => document.querySelectorAll("#grid .app").length > 3);
await page.waitForTimeout(500);
const first = await page.evaluate(() => [...document.querySelectorAll("#grid .app")].slice(0, 3).map((a) => (a.querySelector(".label span") || a.querySelector(".label") || a).textContent.trim()));
ok(JSON.stringify(first) === JSON.stringify(["Stan", "Netflix", "ABC iview"]), "a dock order by ids: Stan, Netflix, ABC iview first (" + first.join(", ") + ")");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
server.close();
console.log("OK: " + n + " checks");
