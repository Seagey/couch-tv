// Add apps (0.13.11, owner approved in round 4): one sheet with every app on this TV, in a real browser at
// 1920x1080 on the TV home (mock.js stands in for the TV and its installed apps):
//  1. Hold OK on an app in a folder or dock: Add apps (no more one at a time Add app to folder); a one app
//     tile keeps Change app and has no Add apps;
//  2. the sheet: the folder's name, "N of 12 picked", every installed app once, the picked ones first and
//     numbered, a clear focus ring, remote only (arrows, OK, Back);
//  3. OK adds or takes out and the numbers follow; Back saves (kept on this TV, survives a reload); Back
//     with nothing changed saves nothing;
//  4. Hold OK moves a picked app (Left and Right, OK puts it down), a hold sent as quick down and up pairs
//     (a TCL) moves too and never adds or takes out;
//  5. a picked app that is not on this TV is listed dimmed, and OK takes it out; the Add app place opens
//     the sheet; a full container says so;
//  6. Home settings, the widget's page: Add apps opens the sheet over the settings, Back goes back to them;
//  7. the Android apps' Back, window.tv.back() (never a key): saves from Home settings and from the home,
//     and during a move puts the app down first.
// Screenshots go to $SHOTS when it is set.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_app_sheet_browser.mjs
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
const SHOTS = process.env.SHOTS || "";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const design = { v: 1, background: { colour: "#26303f" }, objects: [
  { id: "d", type: "widget", kind: "dock", x: 80, y: 60, w: 1160, h: 160, opts: { apps: ["netflix", "hotstar", "stan"], more: false } },
  { id: "f", type: "widget", kind: "folder", x: 80, y: 300, w: 760, h: 560, opts: { label: "Kids", apps: ["iview", "youtube"] } },
  { id: "a", type: "widget", kind: "app", x: 1000, y: 300, w: 240, h: 240, opts: { apps: ["netflix"] } }
] };
async function load(reset) {
  if (reset) {
    await page.goto(BASE + "?mock=1&reset=1");
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  }
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="f"] .cw') && window.CouchDesign && window.CouchDesign.nav);
  await page.waitForTimeout(600);
}
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
// the sheet as drawn: its title, count, hint, each tile (key, package, badge, dimmed, focused) and the ring
const sheet = () => page.evaluate(() => {
  const el = document.querySelector(".cw-appsheet");
  if (!el) return null;
  const tiles = [...el.querySelectorAll(".cw-as-tile")].map((t) => ({ key: t.getAttribute("data-key"), pkg: t.getAttribute("data-pkg") || "", badge: (t.querySelector(".cw-as-badge") || {}).textContent || "",
    missing: !!t.querySelector(".cw-missing"), focus: t.classList.contains("cw-ifocus"), top: t.offsetTop, left: t.offsetLeft }));
  const f = el.querySelector(".cw-as-tile.cw-ifocus");
  return { title: el.querySelector("h2").textContent, count: el.querySelector(".cw-as-count").textContent, hint: el.querySelector(".cw-as-hint").textContent,
    tiles, at: tiles.findIndex((t) => t.focus), ring: f ? getComputedStyle(f).boxShadow : "", settings: document.getElementById("settings").classList.contains("on") };
});
// to a tile by the remote alone: Down by rows, then Right or Left
async function goTo(key) {
  const s = await sheet(), i = s.tiles.findIndex((t) => t.key === key);
  assert.ok(i >= 0, "the sheet lists " + key);
  const cols = s.tiles.filter((t) => t.top === s.tiles[0].top).length;
  let at = s.at;
  while (Math.floor(at / cols) < Math.floor(i / cols)) { await press("ArrowDown", 60); at = Math.min(at + cols, s.tiles.length - 1); }
  while (Math.floor(at / cols) > Math.floor(i / cols)) { await press("ArrowUp", 60); at -= cols; }
  while (at < i) { await press("ArrowRight", 60); at++; }
  while (at > i) { await press("ArrowLeft", 60); at--; }
  const now = await sheet();
  assert.ok(now.tiles[now.at] && now.tiles[now.at].key === key, "the remote reached " + key + " (on " + (now.tiles[now.at] || {}).key + ")");
}
const edits = () => page.evaluate(() => window.CouchDesign.appEdits());
const installed = () => page.evaluate(() => window.CouchWidgets.installedApps({ data: { apps: (window.MOCK_APPS || []).map((a) => ({ package: a.package, name: a.name })) } }).length);

console.log("Running Add apps sheet browser tests...");
await load(true);

// 1. the Hold OK menu
await focus("f", 0); await hold();
let m = await menu();
ok(m.indexOf("Add apps") >= 0 && m.indexOf("Add app to folder") < 0 && m.indexOf("Remove from folder") >= 0, "Hold OK in a folder: Add apps, Remove from folder, no one at a time Add app to folder (" + m.join(", ") + ")");
await press("Escape", 300);
await focus("a", 0); await hold();
m = await menu();
ok(m.indexOf("Change app") >= 0 && m.indexOf("Add apps") < 0, "a one app tile: Change app, no Add apps (" + m.join(", ") + ")");
await press("Escape", 300);

// 2. the sheet
await focus("f", 0); await hold(); await choose("Add apps");
let s = await sheet();
ok(s, "Add apps opens the sheet");
ok(s.title === "Kids" && s.count === "2 of 12 picked", "the folder's name and how many are picked: " + s.title + ", " + s.count);
ok(/OK adds or takes it out/.test(s.hint) && /Hold OK moves it/.test(s.hint) && /Back saves/.test(s.hint), "the three keys said under it: " + s.hint);
ok(s.tiles[0].key === "iview" && s.tiles[0].badge === "1" && s.tiles[1].key === "youtube" && s.tiles[1].badge === "2", "the picked ones first, numbered 1 and 2");
ok(s.tiles.slice(2).every((t) => !t.badge), "the rest have no number");
const all = await installed();
ok(s.tiles.length === all && new Set(s.tiles.map((t) => t.pkg)).size === all, "every installed app once: " + s.tiles.length + " of " + all);
ok(!s.tiles.some((t) => t.pkg === "com.android.tv.settings"), "never the TV's Settings");
ok(s.at === 0, "the focus starts on the first app");
ok(/rgb\(255, 255, 255\)/.test(s.ring), "a white focus ring: " + s.ring);
const cols = s.tiles.filter((t) => t.top === s.tiles[0].top).length;
ok(cols === 7, "seven apps across: " + cols);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "1-folder-open.png") });
// Up from the top row and Left from the first app go nowhere
await press("ArrowUp", 100); await press("ArrowLeft", 100);
ok((await sheet()).at === 0, "Up and Left at the first app stay on it");
// Right at the end of a row goes on to the next row
for (let k = 0; k < cols; k++) await press("ArrowRight", 60);
ok((await sheet()).at === cols, "Right past the end of a row goes on to the next row");
await press("ArrowUp", 100);
ok((await sheet()).at === 0, "Up goes back a row");

// 3. OK adds and takes out; Back saves
await goTo("kayo");
await press("Enter", 400);
s = await sheet();
ok(s.count === "3 of 12 picked" && s.tiles.find((t) => t.key === "kayo").badge === "3", "OK adds Kayo as 3: " + s.count);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "2-kayo-added.png") });
await goTo("youtube");
await press("Enter", 400);
s = await sheet();
ok(s.count === "2 of 12 picked" && !s.tiles.find((t) => t.key === "youtube").badge && s.tiles.find((t) => t.key === "kayo").badge === "2", "OK on YouTube takes it out, Kayo becomes 2");
ok(s.tiles[1].key === "youtube", "the apps stay where they are while picking, so the remote never jumps");
ok(JSON.stringify((await edits())["f|folder"] || null) === "null", "nothing is saved before Back");
await press("Escape", 500);
ok(!(await sheet()), "Back closes the sheet");
ok(JSON.stringify((await edits())["f|folder"]) === '["iview","kayo"]', "Back saves: ABC iview, Kayo");
ok(/Saved\./.test(await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || "")), "and says Saved.");
const inFolder = () => page.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="f"] [data-act=app]')].map((e) => e.getAttribute("data-arg")).join(","));
ok(await inFolder() === "au.net.abc.iview,au.com.kayosports.tv", "the folder on the home shows them: " + await inFolder());

// Back with nothing changed: nothing written
await page.evaluate(() => document.querySelectorAll(".cw-say").forEach((e) => e.remove()));   // the last Saved. still on show
await focus("f", 0); await hold(); await choose("Add apps");
const before = JSON.stringify(await edits());
await press("ArrowRight", 80); await press("Escape", 500);
ok(JSON.stringify(await edits()) === before && !(await page.evaluate(() => /Saved/.test((document.querySelector(".cw-say") || {}).textContent || ""))), "Back with nothing changed saves nothing and says nothing");

// 4. Hold OK moves a picked app
await focus("f", 0); await hold(); await choose("Add apps");
await goTo("kayo");
await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(300);
s = await sheet();
ok(/Left and Right move it/.test(s.hint) && s.count === "2 of 12 picked", "Hold OK on a picked app picks it up to move: " + s.hint);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "3-moving.png") });
await press("ArrowLeft", 300);
s = await sheet();
ok(s.tiles[0].key === "kayo" && s.tiles[0].badge === "1" && s.tiles[1].key === "iview" && s.tiles[1].badge === "2" && s.tiles[s.at].key === "kayo", "Left moves Kayo to 1, the focus goes with it");
await press("ArrowLeft", 300);
ok((await sheet()).tiles[0].key === "kayo", "Left at the start stays there");
await press("Enter", 400);
s = await sheet();
ok(!/Left and Right/.test(s.hint) && s.count === "2 of 12 picked" && s.tiles.find((t) => t.key === "kayo").badge === "1", "OK puts it down, nothing added or taken out");
await press("Escape", 500);
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview"]', "Back saves the new order: Kayo, ABC iview");
// a TV that sends a held OK as quick down and up pairs (a TCL): still a hold, never a run of OKs
await focus("f", 0); await hold(); await choose("Add apps");
await goTo("iview");
for (let k = 0; k < 9; k++) { await page.keyboard.down("Enter"); await page.waitForTimeout(40); await page.keyboard.up("Enter"); await page.waitForTimeout(60); }
await page.waitForTimeout(400);
s = await sheet();
ok(/Left and Right move it/.test(s.hint) && s.count === "2 of 12 picked", "a hold as quick pairs moves it, and adds or takes out nothing: " + s.count);
await press("Enter", 300);
await press("Escape", 500);
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview"]', "and changes nothing");

// 5. the dock: an app not on this TV, the Add app place, and full
await focus("d", 0); await hold(); await choose("Add apps");
s = await sheet();
const hot = s.tiles.find((t) => t.key === "hotstar");
ok(s.title === "Dock" && hot && hot.missing && hot.badge === "2" && !hot.pkg, "the dock: JioHotstar is not on this TV, listed dimmed as picked 2");
await goTo("hotstar"); await press("Enter", 400);
s = await sheet();
ok(!s.tiles.find((t) => t.key === "hotstar").badge && s.count === "2 of 12 picked", "OK takes it out");
await press("Escape", 500);
ok(JSON.stringify((await edits())["d|dock"]) === '["netflix","stan"]', "saved without it");
const place = await page.evaluate(() => [...document.querySelectorAll('.cw-o[data-obj="d"] [data-slot]')].findIndex((e) => e.getAttribute("data-act") === "addapp"));
ok(place >= 0, "the dock still ends in an Add app place");
await focus("d", place); await press("Enter", 600);
s = await sheet();
ok(s && s.title === "Dock" && s.count === "2 of 12 picked", "OK on the Add app place opens the sheet");
// pick until full, then one more
const free = s.tiles.filter((t) => !t.badge && t.pkg).map((t) => t.key);
for (const k of free.slice(0, 10)) { await goTo(k); await press("Enter", 200); }
s = await sheet();
ok(s.count === "12 of 12 picked", "picked up to 12: " + s.count);
if (free.length > 10) {
  await goTo(free[10]); await press("Enter", 400);
  s = await sheet();
  ok(s.count === "12 of 12 picked" && /That holds 12 apps\. Take one out first\./.test(await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || "")), "a 13th: That holds 12 apps, nothing added");
  ok(await page.evaluate(() => +getComputedStyle(document.querySelector(".cw-say")).zIndex > +getComputedStyle(document.querySelector(".cw-appsheet")).zIndex), "and the words show over the sheet");
}
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "4-dock-full.png") });
await press("Escape", 500);
ok(((await edits())["d|dock"] || []).length === 12, "saved all 12");

// kept after a restart
await load(false);
ok(await inFolder() === "au.com.kayosports.tv,au.net.abc.iview", "after a reload the folder is as it was left");

// 6. Home settings: the folder's page, Add apps, over the settings and back to them
await focus("f", 0); await hold(); await choose("Edit on the TV");
ok(await page.evaluate(() => document.getElementById("settings").classList.contains("on")), "Edit on the TV opens the folder's page in Home settings");
const rows = await page.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent.trim()));
const ri = rows.findIndex((r) => /^Add apps/.test(r));
ok(ri >= 0 && /2 of 12 picked/.test(rows[ri]), "the page has Add apps with how many are picked: " + rows.join(" | "));
for (let k = 0; k < 8 && !(await page.evaluate(() => /^Add apps/.test(((document.querySelector("#set-rows .srow.focus") || {}).textContent || "").trim()))); k++) await press("ArrowDown", 150);
await press("Enter", 500);
s = await sheet();
ok(s && s.settings && s.title === "Kids" && s.tiles[0].key === "kayo", "OK opens the sheet over Home settings");
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "5-from-home-settings.png") });
await goTo("youtube"); await press("Enter", 300);
await press("Escape", 600);
ok(!(await sheet()) && await page.evaluate(() => document.getElementById("settings").classList.contains("on")), "Back saves and goes back to Home settings");
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview","youtube"]', "with YouTube added");
ok(/3 of 12 picked/.test((await page.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent).join(" | ")))), "and the page shows 3 of 12 picked");

// 7. the Android apps (tv-home MainActivity, on-TV HomeActivity) send the remote's Back as tv.back(), never
// as a key: it saves the same as the Back key, from Home settings and from the home, and puts a move down
const tvBack = async (wait) => { await page.evaluate(() => window.tv.back()); await page.waitForTimeout(wait || 600); };
const toAddApps = async () => { for (let k = 0; k < 8 && !(await page.evaluate(() => /^Add apps/.test(((document.querySelector("#set-rows .srow.focus") || {}).textContent || "").trim()))); k++) await press("ArrowDown", 150); await press("Enter", 500); };
const settingsOn = () => page.evaluate(() => document.getElementById("settings").classList.contains("on"));
await toAddApps();
ok(!!(await sheet()), "Home settings, Add apps again");
await goTo("youtube"); await press("Enter", 300);
await tvBack();
ok(!(await sheet()) && await settingsOn(), "tv.back() saves and goes back to Home settings");
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview"]', "tv.back() from Home settings saved YouTube out: " + JSON.stringify((await edits())["f|folder"]));
ok(/2 of 12 picked/.test((await page.evaluate(() => [...document.querySelectorAll("#set-rows .srow")].map((e) => e.textContent).join(" | ")))), "and the page shows 2 of 12 picked (the done callback ran)");
// a move in progress: tv.back() puts the app down, the sheet stays; the next tv.back() saves
await toAddApps();
await goTo("iview"); await hold();
ok(/Left and Right move it/.test((await sheet()).hint), "Hold OK picks ABC iview up to move");
await press("ArrowLeft", 300);
await tvBack(400);
s = await sheet();
ok(s && !/Left and Right/.test(s.hint) && s.tiles[0].key === "iview" && s.tiles[0].badge === "1" && s.count === "2 of 12 picked", "tv.back() during a move puts it down and keeps the sheet: " + (s && s.hint));
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview"]', "nothing saved while the sheet is up");
await tvBack();
ok(!(await sheet()) && await settingsOn() && JSON.stringify((await edits())["f|folder"]) === '["iview","kayo"]', "the next tv.back() saves the move: " + JSON.stringify((await edits())["f|folder"]));

// tv.back() from the home: saved, and Saved. said
for (let k = 0; k < 6 && await page.evaluate(() => document.getElementById("settings").classList.contains("on")); k++) await press("Escape", 300);
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelectorAll(".cw-say").forEach((e) => e.remove()));
await focus("f", 0); await hold(); await choose("Add apps");
await goTo("youtube"); await press("Enter", 300);
await tvBack();
ok(!(await sheet()) && JSON.stringify((await edits())["f|folder"]) === '["iview","kayo","youtube"]', "tv.back() from the home saves: " + JSON.stringify((await edits())["f|folder"]));
ok(/Saved\./.test(await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || "")), "and says Saved.");
ok(await inFolder() === "au.net.abc.iview,au.com.kayosports.tv,com.google.android.youtube.tv", "the folder on the home shows them: " + await inFolder());
ok(!(await page.evaluate(() => document.getElementById("settings").classList.contains("on"))), "and the home stays (tv.back() went no further)");

// Spanish: the sheet's words in the TV's language
await page.evaluate(() => window.I18N.set("es"));
await focus("f", 0); await hold(); await choose("Añadir apps");
s = await sheet();
ok(s && s.count === "3 de 12 elegidas" && /Mantén OK/.test(s.hint) && /guarda/.test(s.hint), "in Spanish: " + (s && s.count) + " | " + (s && s.hint));
// the move line and Saved. too (tw_apps_move_hint, tw_saved)
await goTo("kayo"); await hold();
s = await sheet();
ok(s.hint === "Izquierda y Derecha la mueven. OK cuando esté en su sitio.", "the move line in Spanish: " + s.hint);
await press("ArrowLeft", 300); await press("Enter", 400);
await page.evaluate(() => document.querySelectorAll(".cw-say").forEach((e) => e.remove()));
await press("Escape", 500);
ok(await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || "") === "Guardado.", "Saved. in Spanish: " + await page.evaluate(() => (document.querySelector(".cw-say") || {}).textContent || ""));
ok(JSON.stringify((await edits())["f|folder"]) === '["kayo","iview","youtube"]', "and the move was saved");

// Hebrew (right to left): the tiles run from the right, so Left goes on to the next app and a move follows
await page.evaluate(() => window.I18N.set("he"));
ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "Hebrew turns the page right to left");
await focus("f", 0); await hold(); await choose("הוספת אפליקציות");
s = await sheet();
ok(s && s.tiles[0].key === "kayo" && s.tiles[1].key === "iview" && s.tiles[0].left > s.tiles[1].left, "the first app is on the right: " + (s && s.tiles[0].left) + " > " + (s && s.tiles[1].left));
await press("ArrowRight", 100);
ok((await sheet()).at === 0, "Right at the first app (the right edge) stays on it");
await press("ArrowLeft", 150);
ok((await sheet()).at === 1, "Left goes on to the next app, ABC iview, to its left");
await hold();
ok((await sheet()).tiles.find((t) => t.key === "iview").focus, "Hold OK picks ABC iview up to move");
await press("ArrowRight", 300);
s = await sheet();
ok(s.tiles[0].key === "iview" && s.tiles[0].badge === "1" && s.tiles[s.at].key === "iview" && s.tiles[0].left > s.tiles[1].left, "while moving, Right carries ABC iview to the right, to 1");
await press("ArrowRight", 300);
ok((await sheet()).tiles[0].key === "iview", "Right at the start stays there");
await press("ArrowLeft", 300);
ok((await sheet()).tiles[1].key === "iview", "and Left carries it back to the left, to 2");
await press("ArrowRight", 300);
await press("Enter", 400); await press("Escape", 500);
ok(JSON.stringify((await edits())["f|folder"]) === '["iview","kayo","youtube"]', "Back saves the move: " + JSON.stringify((await edits())["f|folder"]));
await page.evaluate(() => window.I18N.set("en"));
ok(await page.evaluate(() => document.documentElement.dir) === "ltr", "English turns it back");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
server.close();
console.log("OK: " + n + " checks");
