// App folders, the Dock, App grid and Games in rows (0.13.10), in a real browser at 1920x1080 (the TV home
// in its ?mock preview with demo apps, the same drawing the TV and Couch TV Studio use):
//  1. "As many as fit" picks the column count that makes the apps biggest: a wide folder makes one row,
//     rows stack when that makes them bigger, and on a short (2 high) folder the name gives way to the
//     apps when it would leave them tiny;
//  2. "N across" is always exactly N: 8 apps in a 6 by 4 folder go 4 and 4, never 3, 1, 3, 1, and no app
//     is ever outside its box;
//  3. the Dock stays one row but never drops apps without a word: a "+N" place opens them all; Games too;
//  4. the remote: every app in a folder is a stop going Right, row after row, and Right past the last
//     app at the screen's edge reaches Settings (tv-designer widgets-tv-checks, "apps inside a folder are
//     each a stop").
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_folder_rows_browser.mjs
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
const R = (c, r, w, h) => ({ x: 80 + c * 100, y: 60 + r * 100, w: w * 100 - 40, h: h * 100 - 40 });
const W = (id, kind, at, opts, more) => Object.assign({ id, type: "widget", kind }, R(...at), opts ? { opts } : {}, more || {});
const HIDE = { clock: { hidden: true }, date: { hidden: true }, weather: { hidden: true }, people: { hidden: true }, quick: { hidden: true }, keep_watching: { hidden: true }, dock: { hidden: true } };
const PKGS = ["com.netflix.ninja", "com.google.android.youtube.tv", "au.net.abc.iview", "com.disney.disneyplus", "au.com.stan.and", "com.sbs.ondemand.tv",
  "au.com.ninenow.ctv", "com.swm.live", "com.amazon.amazonvideo.livingroom", "com.spotify.tv.android", "com.plexapp.android", "tv.twitch.android.app"];
const apps = (k) => PKGS.slice(0, k);

const browser = await chromium.launch();
async function home(objects) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const design = { v: 1, background: { colour: "#26303f" }, elements: HIDE, objects };
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&demo=1&design=local");
  await page.waitForFunction(() => document.querySelector(".cw-o .cw") && window.CouchDesign && window.CouchDesign.nav);
  await page.waitForTimeout(600);
  return page;
}
// each app's box in a widget, the widget's box, and the label
const layout = (page, id) => page.evaluate((i) => {
  const w = document.querySelector('.cw-o[data-obj="' + i + '"] .cw'), b = w.getBoundingClientRect();
  const a = [...w.querySelectorAll(".cw-app")].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, plus: e.classList.contains("cw-plus"), text: e.textContent, name: e.getAttribute("data-name") }; });
  return { box: { l: b.left, t: b.top, r: b.right, b: b.bottom }, apps: a, label: !!w.querySelector(".cw-lab"), plus: [...w.querySelectorAll(".cw-plus")].map((e) => ({ text: e.textContent, name: e.getAttribute("data-name") })) };
}, id);
// apps per row, by each app's centre (the focused app is drawn a little bigger, about its centre)
const rows = (L) => { const m = new Map(); L.apps.forEach((a) => { const c = Math.round((a.t + a.b) / 20); m.set(c, (m.get(c) || 0) + 1); }); return [...m.keys()].sort((x, y) => x - y).map((k) => m.get(k)); };
const inside = (L) => L.apps.every((a) => a.l >= L.box.l - 1 && a.r <= L.box.r + 1 && a.t >= L.box.t - 1 && a.b <= L.box.b + 1);
const press = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(150); };
const focused = (page) => page.evaluate(() => { const c = window.CouchDesign.nav.current(); return c ? c.id + ":" + c.i : null; });

console.log("Running folder rows browser tests...");
try {
  // 1 and 2: the owner's cases (FOLDER-ROWS-TV-1123), named "Apps", Apps across "as many as fit"
  const page = await home([
    W("wide", "folder", [0, 0, 12, 2], { label: "Apps", apps: apps(6) }),
    W("half", "folder", [12, 0, 6, 2], { label: "Apps", apps: apps(4) }),
    W("eight", "folder", [0, 2, 6, 4], { label: "Apps", apps: apps(8) }),
    W("twelve", "folder", [6, 2, 8, 4], { label: "Apps", apps: apps(12) }),
    W("three", "folder", [14, 2, 4, 4], { label: "Apps", apps: apps(4), cols: 3 }),
    W("grid", "appgrid", [0, 6, 6, 4], { apps: apps(9) })
  ]);
  const wide = await layout(page, "wide"), half = await layout(page, "half"), eight = await layout(page, "eight"), twelve = await layout(page, "twelve"), three = await layout(page, "three"), grid = await layout(page, "grid");
  ok(rows(wide).join() === "6" && wide.apps[0].w >= 100 && !wide.label, "12 by 2, 6 apps: one row of big apps (" + Math.round(wide.apps[0].w) + " px, was about 62), the name gives way");
  ok(rows(half).join() === "4" && half.apps[0].w >= 100, "6 by 2, 4 apps: one row, " + Math.round(half.apps[0].w) + " px (was about 60)");
  ok(rows(eight).join() === "4,4" && eight.label, "6 by 4, 8 apps: rows of " + rows(eight).join(", ") + " (was 3, 1, 3, 1), the name kept");
  ok(rows(twelve).every((k, i, a) => i === a.length - 1 || k === a[0]) && twelve.apps[0].w >= 75, "8 by 4, 12 apps: even rows " + rows(twelve).join(", ") + " at " + Math.round(twelve.apps[0].w) + " px");
  ok(rows(three).join() === "3,1", "Apps across 3 is exactly 3: " + rows(three).join(", "));
  ok(rows(grid).every((k, i, a) => i === a.length - 1 || k === a[0]) && inside(grid), "App grid, as many as fit: even rows " + rows(grid).join(", ") + ", inside its box");
  for (const [id, L] of [["wide", wide], ["half", half], ["eight", eight], ["twelve", twelve], ["three", three]]) ok(inside(L), id + ": every app inside the folder's box");
  // 4. the remote across a folder of 3 then 1: every app a stop, and Left undoes Right
  await page.evaluate(() => window.CouchDesign.nav.focus("three", 0));
  const seen = [await focused(page)];
  for (let i = 0; i < 3; i++) { await press(page, "ArrowRight"); seen.push(await focused(page)); }
  ok(seen.join() === "three:0,three:1,three:2,three:3", "Right goes through every app, onto the next row: " + seen.join(" "));
  await press(page, "ArrowLeft");
  ok((await focused(page)) === "three:2", "Left from the first app of the second row goes back to the end of the first");
  ok(page.errors.length === 0, "no errors: " + page.errors.slice(0, 2).join(" | "));
  await page.close();

  // the tv-designer check's own home: a stack, a small folder and an 8 by 4 folder of 4 apps marked Start
  // here, on the right: Right walks apps 0 to 3, then Settings
  const p2 = await home([
    W("folder", "folder", [4, 0, 2, 2], { label: "Streaming", apps: apps(5) }),
    W("apps", "folder", [8, 0, 8, 4], { label: "Free to air", apps: ["au.net.abc.iview", "com.sbs.ondemand.tv", "au.com.ninenow.ctv", "com.swm.live"] }, { start: true }),
    W("keep", "keep", [0, 5, 6, 4])
  ]);
  await p2.evaluate(() => window.CouchDesign.nav.focus("apps", 0));
  const walk = [await focused(p2)];
  for (let i = 0; i < 6; i++) { await press(p2, "ArrowRight"); walk.push(await focused(p2)); }
  const inner = walk.filter((x) => /^apps:\d/.test(x || ""));
  ok(inner.join() === "apps:0,apps:1,apps:2,apps:3", "apps inside a folder are each a stop: " + walk.join(" "));
  ok(walk[walk.length - 1] === "__gear:-1", "Right past the last app at the screen's edge goes to Settings: " + walk[walk.length - 1]);
  ok(p2.errors.length === 0, "no errors: " + p2.errors.slice(0, 2).join(" | "));
  await p2.close();

  // 3. the Dock: one row, apps past what fits behind "+N", which opens them all; Games the same
  const p3 = await home([
    W("dock", "dock", [0, 0, 8, 2], { apps: apps(10), more: false }),
    W("dockall", "dock", [0, 2, 8, 2], { apps: apps(10) }),
    W("fits", "dock", [0, 4, 16, 2], { apps: apps(5), more: false }),
    W("games", "games", [9, 0, 6, 3], { apps: ["com.microsoft.xcloud", "com.nvidia.geforcenow", "com.valvesoftware.steamlink", "com.retroarch", "com.netflix.ninja", "com.google.android.youtube.tv"] })
  ]);
  const dock = await layout(p3, "dock"), dockall = await layout(p3, "dockall"), fits = await layout(p3, "fits");
  const shownOf = (L) => L.apps.filter((a) => !a.plus && !/All apps/.test(a.name || "")).length;
  const plusN = (L) => L.plus.length ? Number(L.plus[0].text.replace("+", "")) : 0;
  ok(rows(dock).length === 1 && dock.plus.length === 1 && shownOf(dock) + plusN(dock) === 10, "Dock, 10 apps in a short row: " + shownOf(dock) + " and " + (dock.plus[0] || {}).text + ", one row");
  ok(/^\d+ more apps$/.test(dock.plus[0].name), "the +N place says what it is: " + dock.plus[0].name);
  ok(dockall.plus.length === 1 && shownOf(dockall) + plusN(dockall) === 10 && dockall.apps.some((a) => a.name === "All apps"), "with All apps at the end too: " + shownOf(dockall) + " and " + (dockall.plus[0] || {}).text + ", then All apps");
  ok(fits.plus.length === 0 && shownOf(fits) === 5, "a Dock that fits its apps has no +N");
  for (const [id, L] of [["dock", dock], ["dockall", dockall], ["fits", fits]]) ok(inside(L), id + ": inside its box");
  const games = await p3.evaluate(() => { const w = document.querySelector('.cw-o[data-obj="games"] .cw'); return { tiles: w.querySelectorAll("[data-act]").length, plus: (w.querySelector(".cw-plus") || {}).textContent || "" }; });
  ok(games.plus && games.tiles - 1 + Number(games.plus.replace("+", "")) === 6, "Games, 6 in a row that holds fewer: " + (games.tiles - 1) + " and " + games.plus);
  // OK on the Dock's +N: the folder layer with all ten
  const at = dock.apps.findIndex((a) => a.plus);
  await p3.evaluate((i) => window.CouchDesign.nav.focus("dock", i), at);
  await press(p3, "Enter"); await p3.waitForTimeout(600);
  const open = await p3.evaluate(() => ({ open: window.CouchDetail && window.CouchDetail.isOpen(), apps: document.querySelectorAll(".cwd-app").length }));
  ok(open.open && open.apps === 10, "OK on +N opens every app in the Dock (" + open.apps + ")");
  await press(p3, "Escape");
  ok(p3.errors.length === 0, "no errors: " + p3.errors.slice(0, 2).join(" | "));
  await p3.close();

  // a countdown to a day that moves each year (0.13.10): the rule's own name on the widget
  const p4 = await home([W("easter", "countdown", [0, 0, 8, 4], { rule: "easter", day: 25, month: 12 }), W("dad", "countdown", [8, 0, 8, 4], { rule: "fathers_day" })]);
  const cd = await p4.evaluate(() => ["easter", "dad"].map((i) => document.querySelector('.cw-o[data-obj="' + i + '"] .cw').textContent));
  ok(/Easter/.test(cd[0]) && !/Christmas/.test(cd[0]) && /to go/.test(cd[0]), "Counts to Easter: its name and how long to go (" + cd[0] + ")");
  ok(/Father's Day/.test(cd[1]), "Counts to Father's Day: its name (" + cd[1] + ")");
  ok(p4.errors.length === 0, "no errors: " + p4.errors.slice(0, 2).join(" | "));
  await p4.close();
} finally { await browser.close(); server.close(); }
console.log("OK: " + n + " folder rows checks");
