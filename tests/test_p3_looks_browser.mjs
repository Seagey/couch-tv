// Phase 3 looks (lane P3c, 28 Nov 2026), in a real browser: the TV home in its ?mock preview at 1920x1080 draws
//  1. an OLDER design's boxes (Colour, Paper, Solid with a stray colour) exactly as the Phase 2 home did: each widget is
//     screenshotted here and on the Phase 2 home (OLD_ROOT, a copy of tv-home/web from git phase2-base) and the
//     pictures must be the same, pixel for pixel. Without OLD_ROOT that part says so and is left out.
//  2. textures on a solid box: Paper over a colour, Linen, Grain; html.lighter leaves them off.
//  3. app icons: circle, square, words only, black and white, the app's own; names under a folder's icons.
//  4. TV settings: the tile (gear, words, OK opens the TV's settings), the app in a folder (never "Not on this TV").
//  5. Show in the day or at night: own times, and the town's sunrise and sunset; it changes while the home is up.
// Needs Playwright:  COUCHTV_PLAYWRIGHT=<folder with playwright> [OLD_ROOT=<folder holding tv-home/web>] node tests/test_p3_looks_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD = process.env.OLD_ROOT && fs.existsSync(path.join(process.env.OLD_ROOT, "tv-home/web/widgets.js")) ? process.env.OLD_ROOT : "";
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
function serve(root) {
  const server = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html" })));
}
const NEW = await serve(ROOT), OLDS = OLD ? await serve(OLD) : null;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const w = (id, kind, x, y, style, opts, ww, hh) => ({ id, type: "widget", kind, x, y, w: ww || 360, h: hh || 360, style, opts });
const browser = await chromium.launch();
const errors = [];
async function open(base, design, time) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  if (time) await page.clock.install({ time });
  await page.goto(base + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(base + "?mock=1&design=local");
  await page.waitForFunction((k) => document.querySelectorAll(".cw-o .cw").length >= k, design.objects.length);
  await page.evaluate(() => document.documentElement.classList.remove("lighter", "glass-lite"));
  await page.waitForTimeout(1200);
  return page;
}
const read = (page) => page.evaluate(() => {
  const out = {};
  document.querySelectorAll(".cw-o[data-obj]").forEach((o) => {
    const cw = o.querySelector(".cw"); if (!cw) return;
    const bg = cw.querySelector(".cw-bg"), af = bg ? getComputedStyle(bg, "::after") : null, app = cw.querySelector(".cw-app"), img = app && app.querySelector("img");
    out[o.getAttribute("data-obj")] = { cls: cw.className, tile: cw.style.getPropertyValue("--tile"), bgc: bg ? getComputedStyle(bg).backgroundColor : "", after: af ? af.backgroundImage : "", afterShown: af ? af.display !== "none" && af.content !== "none" : false,
      text: cw.innerText.trim(), act: cw.getAttribute("data-act"), arg: cw.getAttribute("data-arg"), vis: getComputedStyle(cw).visibility, hidden: cw.getAttribute("data-hidden"),
      appR: app ? getComputedStyle(app).borderRadius : "", appW: app ? app.getBoundingClientRect().width : 0, filter: img ? getComputedStyle(img).filter : "", imgShown: img ? getComputedStyle(img).display !== "none" : null,
      tvset: cw.querySelectorAll(".cw-tvset").length, missing: cw.querySelectorAll(".cw-missing").length, named: cw.querySelectorAll(".cw-named").length };
  });
  return out;
});

// 1. older designs look the same
const old = { v: 1, background: { colour: "#26303f" }, objects: [
  w("wx", "bigtemp", 80, 60, { panel: "colour" }), w("cc", "countdown", 480, 60, { panel: "colour", colour: "#ff9500", gradient: "soft" }),
  w("pp", "note", 880, 60, { panel: "paper" }), w("pc", "note", 1280, 60, { panel: "paper", colour: "#ff0000" }),
  w("sc", "date", 80, 460, { panel: "solid", colour: "#00ff00" }), w("gc", "date", 480, 460, { panel: "glass", colour: "#00ff00" }),
  w("hr", "hourly", 880, 460, {}, undefined, 760, 360)
] };
const fixedTime = new Date("2026-11-28T10:00:00+11:00");
let page = await open(NEW.base, old, fixedTime);
let s = await read(page);
ok(/cw-tint/.test(s.wx.cls) && /gradient/.test(s.wx.tile), "an old Colour box keeps its kind's own gradient");
ok(/cw-tint/.test(s.cc.cls) && /#ff9500/.test(s.cc.tile) && /gradient/.test(s.cc.tile), "an old orange soft gradient stays");
ok(/cw-paper/.test(s.pp.cls) && !/cw-tx/.test(s.pp.cls) && s.pp.bgc === "rgb(246, 242, 234)", "an old Paper box is plain paper, no texture added");
ok(/cw-paper/.test(s.pc.cls) && s.pc.bgc === "rgb(246, 242, 234)", "old Paper with a stray colour is still plain paper");
ok(/cw-solid/.test(s.sc.cls), "old Solid with a stray colour is still dark solid");
if (OLDS) {
  const oldPage = await open(OLDS.base, old, fixedTime);
  for (const id of ["wx", "cc", "pp", "pc", "sc", "gc", "hr"]) {
    const a = await page.locator('.cw-o[data-obj="' + id + '"]').screenshot({ animations: "disabled" });
    const b = await oldPage.locator('.cw-o[data-obj="' + id + '"]').screenshot({ animations: "disabled" });
    ok(a.equals(b), "older design, widget " + id + ": the same picture as the Phase 2 home, pixel for pixel");
  }
  await oldPage.close();
} else console.log("  (no OLD_ROOT: the pixel comparison with the Phase 2 home is left out)");
await page.close();

// 2. textures
const tex = { v: 1, background: { colour: "#26303f" }, objects: [
  w("tp", "note", 80, 60, { panel: "colour", colour: "#30b0c7", texture: "paper" }), w("tl", "note", 480, 60, { panel: "colour", colour: "#30b0c7", texture: "linen" }),
  w("tg", "note", 880, 60, { panel: "solid", texture: "grain" }), w("tn", "note", 1280, 60, { panel: "colour", colour: "#30b0c7" })
] };
page = await open(NEW.base, tex);
s = await read(page);
ok(/cw-tint/.test(s.tp.cls) && /cw-tx-paper/.test(s.tp.cls) && /svg/.test(s.tp.after) && /#30b0c7/i.test(s.tp.tile), "Paper over teal: the colour with the paper texture on it");
ok(/cw-tx-linen/.test(s.tl.cls) && /repeating-linear-gradient/.test(s.tl.after), "Linen draws a fine weave");
ok(/cw-solid/.test(s.tg.cls) && /cw-tx-grain/.test(s.tg.cls) && /svg/.test(s.tg.after), "Grain on a dark solid box");
ok(!/cw-tx/.test(s.tn.cls) && !s.tn.afterShown, "no texture, no layer");
await page.evaluate(() => document.documentElement.classList.add("lighter"));
s = await read(page);
ok(!s.tp.afterShown && !s.tl.afterShown, "a slower TV (lighter) leaves textures off");
await page.close();

// 3. app icons, 4. TV settings
const apps = ["netflix", "youtube", "iview", "stan"];
const ai = { v: 1, background: { colour: "#26303f" }, objects: [
  w("ac", "folder", 80, 60, { app_shape: "circle" }, { apps }, 560, 360), w("as", "folder", 680, 60, { app_shape: "square", app_colour: "mono" }, { apps }, 560, 360),
  w("aw", "folder", 1280, 60, { app_shape: "words" }, { apps }, 560, 360), w("ao", "appgrid", 80, 460, { app_colour: "own" }, { apps, names: false }, 560, 360),
  w("an", "folder", 680, 460, {}, { apps: apps.concat(["tvsettings"]), names: true }, 760, 560),
  w("ts", "tvsettings", 1480, 460, {}, undefined, 160, 160), w("tw", "tvsettings", 1680, 460, {}, { words: "none" }, 160, 160)
] };
page = await open(NEW.base, ai);
s = await read(page);
ok(/cw-ish-circle/.test(s.ac.cls) && s.ac.appR === "50%", "Circle apps");
ok(/cw-ish-square/.test(s.as.cls) && s.as.appR === "8%" && /grayscale\(1\)/.test(s.as.filter), "Square, black and white");
ok(/cw-ish-words/.test(s.aw.cls) && s.aw.imgShown === false && /Netflix/.test(s.aw.text), "Words only: names, no pictures");
ok(/cw-ico-own/.test(s.ao.cls) && s.ao.appR === "0px", "The app's own: no shape added");
ok(s.an.named >= 5 && /Netflix/.test(s.an.text), "Names under icons on a folder");
ok(s.an.tvset === 1 && s.an.missing === 0, "TV settings in a folder: the settings app, never Not on this TV");
const setNode = await page.evaluate(() => { const t = document.querySelector('.cw-o[data-obj="an"] .cw-tvset'); return t ? [t.getAttribute("data-act"), t.getAttribute("data-arg")] : null; });
ok(setNode && setNode[0] === "quick" && setNode[1] === "tvsettings", "OK on it opens the TV's settings (the quick button's action)");
ok(/TV settings/.test(s.ts.text) && s.ts.act === "quick" && s.ts.arg === "tvsettings", "the TV settings tile: gear, words, and OK opens the TV's settings");
ok(s.tw.text === "" && s.tw.act === "quick", "Words: None leaves the gear alone");
await page.close();

// 5. night and day
const day = (style) => ({ v: 1, background: { colour: "#26303f" }, objects: [w("d", "note", 80, 60, style)] });
const at = (hhmm) => new Date("2026-11-28T" + hhmm + ":00+11:00");
page = await open(NEW.base, day({ show: "day", day_from: "07:00", day_to: "21:00" }), at("20:58"));
s = await read(page);
ok(s.d.vis === "visible" && !s.d.hidden, "own times: shown at 8:58 pm when day ends at 9 pm");
await page.clock.fastForward("03:00");
await page.waitForTimeout(1500);
s = await read(page);
ok(s.d.vis === "hidden" && s.d.hidden === "1", "and gone a minute after 9 pm, while the home is up (no fixed 6 pm)");
await page.close();
page = await open(NEW.base, day({ show: "night", day_from: "22:00", day_to: "06:00" }), at("23:30"));
ok((await read(page)).d.vis === "hidden", "own times across midnight: day 10 pm to 6 am, a night widget is hidden at 11:30 pm");
await page.close();
// the sunrise and sunset: in the preview the demo forecast's day is 5:41 am to 7:22 pm (a TV uses its own town's)
page = await open(NEW.base, day({ show: "night" }), at("18:30"));
const sun = await page.evaluate(() => { const c = document.querySelector('.cw-o[data-obj="d"] .cw'); return c.getAttribute("data-hidden"); });
ok(sun === "1", "sunrise and sunset: a night widget is still hidden at 6:30 pm, before sunset (the old rule showed it from 6 pm)");
await page.close();

await browser.close();
NEW.server.close(); if (OLDS) OLDS.server.close();
ok(errors.length === 0, "no page errors (" + errors.join(" | ") + ")");
console.log("All " + n + " Phase 3 looks browser checks passed.");
