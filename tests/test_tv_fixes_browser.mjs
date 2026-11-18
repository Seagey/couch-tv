// Three TV side fixes of 18 Nov 2026, in a real browser at 1920x1080 (the home as a TV draws it, with
// mock.js standing in for the bridge):
//  1. the Game Day preset: on a TV whose Keep watching has no game, the hero says "No game to pick up"
//     (never the demo Bay of Fires, never The Bear); in the designer's demo it is a game;
//  2. the Bedside StandBy preset at 9pm: the big temperature's icon is the night sky, and the line under
//     it is tomorrow's, though the bridge's reading says is_day: true;
//  3. background.depth_image: your own photo with your own cut out (a PNG with a see through sky) is
//     drawn over a clock in the back layer: where the cut out is solid the clock is hidden, where it is
//     see through the clock shows, and a widget in front stays on top.
// Shots go to tests/shots/tv-fixes/ (git ignores nothing there by itself: they are not committed).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_tv_fixes_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "couchtv-tv-fixes");
fs.mkdirSync(SHOTS, { recursive: true });
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
const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/design-presets.json"), "utf8"));
const preset = (id) => JSON.parse(JSON.stringify(PRESETS.find((p) => p.id === id).design));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();

async function home(design, q, at) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  if (at) await page.clock.setFixedTime(at);
  await page.goto(BASE + "?mock=1&reset=1");
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local" + (q || ""));
  await page.waitForFunction(() => document.querySelector(".cw-o .cw"));
  await page.waitForTimeout(1500);
  return page;
}
const textOf = (page, id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id);

console.log("Running TV fixes browser tests...");

{ // 1. Game Day on a TV with no game in Keep watching (mock.js: The Bear, Colin from Accounts, Fisk, Slow Horses)
  const page = await home(preset("sports"), "");
  const t = await textOf(page, "upnext");
  ok(/No game to pick up/.test(t), "Game Day on a TV: the hero says there is no game (" + t.slice(0, 60) + ")");
  ok(!/Bay of Fires|The Bear|Slow Horses/.test(t), "Game Day on a TV: no demo show and no drama in the hero");
  await page.screenshot({ path: path.join(SHOTS, "game-day-tv.png") });
  ok(!page.errors.length, "Game Day on a TV: no page errors " + page.errors.join(" | "));
  await page.close();
}
{ // 1b. the same preset in the designer's demo: a game
  const page = await home(preset("sports"), "&demo=1");
  const t = await textOf(page, "upnext");
  ok(/Titans v Broncos/.test(t) && !/Bay of Fires/.test(t), "Game Day demo: the hero is a game, not Bay of Fires");
  await page.screenshot({ path: path.join(SHOTS, "game-day-demo.png") });
  await page.close();
}
{ // 2. Bedside StandBy at 9pm, with a reading that says is_day: true and code 0 (clear)
  const page = await home(preset("standby"), "&wx=19,0", new Date(2026, 10, 18, 21, 0));
  const t = await textOf(page, "temp");
  ok(/Tomorrow, top of/.test(t) && /Storms/.test(t), "StandBy at 9pm: the line under the number is tomorrow's (" + t + ")");
  const same = await page.evaluate(() => {
    const el = document.querySelector('.cw-o[data-obj="temp"] .cw svg');
    const ds = (svg) => [...svg.querySelectorAll("path,circle")].map((p) => p.getAttribute("d") || p.getAttribute("r")).join("|");
    const want = (name) => { const d = new DOMParser().parseFromString(window.TVIcons.svg("solid", name, 40, "#fff"), "image/svg+xml").documentElement; return ds(d); };
    return { night: ds(el) === want("clear-night"), sun: ds(el) === want("sun") };
  });
  ok(same.night && !same.sun, "StandBy at 9pm: the icon is the clear night sky, not the sun");
  await page.screenshot({ path: path.join(SHOTS, "standby-9pm.png") });
  ok(!page.errors.length, "StandBy: no page errors " + page.errors.join(" | "));
  await page.close();
}
{ // 2b. StandBy at 9pm, partly cloudy (code 2): the moon behind the cloud, not the sun behind it
  const page = await home(preset("standby"), "&wx=19,2", new Date(2026, 10, 18, 21, 0));
  const same = await page.evaluate(() => {
    const el = document.querySelector('.cw-o[data-obj="temp"] .cw svg');
    const ds = (svg) => [...svg.querySelectorAll("path,circle")].map((p) => p.getAttribute("d") || p.getAttribute("r")).join("|");
    const want = (name) => ds(new DOMParser().parseFromString(window.TVIcons.svg("solid", name, 40, "#fff"), "image/svg+xml").documentElement);
    return { night: ds(el) === want("partly-cloudy-night"), day: ds(el) === want("partly-cloudy") };
  });
  ok(same.night && !same.day, "StandBy at 9pm, partly cloudy: the moon behind the cloud");
  await page.screenshot({ path: path.join(SHOTS, "standby-9pm-partly.png") });
  ok(!page.errors.length, "StandBy partly cloudy: no page errors " + page.errors.join(" | "));
  await page.close();
}
{ // 3. depth_image: your own photo (a grey JPEG) and your own cut out (solid green below y 540, see through above)
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "?mock=1&reset=1");
  const pics = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
    const g = c.getContext("2d"); g.fillStyle = "#606060"; g.fillRect(0, 0, 1920, 1080);
    const photo = c.toDataURL("image/jpeg", 0.8);
    g.clearRect(0, 0, 1920, 1080); g.fillStyle = "#00ff00"; g.fillRect(0, 540, 1920, 540);
    return { photo, cut: c.toDataURL("image/png") };
  });
  const design = { v: 1, background: { image: pics.photo, depth_image: pics.cut, darken: 0 },
    objects: [
      { id: "clk", type: "widget", kind: "clock", layer: "back", x: 460, y: 340, w: 1000, h: 400, style: { panel: "colour", colour: "#ff0000", gradient: "off" } },
      { id: "front", type: "widget", kind: "date", x: 80, y: 800, w: 500, h: 200, style: { panel: "colour", colour: "#0000ff", gradient: "off" } }
    ] };
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
  await page.goto(BASE + "?mock=1&design=local");
  await page.waitForFunction(() => document.querySelector(".cw-o .cw"));
  await page.waitForTimeout(1800);
  const layer = await page.evaluate(() => { const e = document.getElementById("cd-depth"); if (!e) return null; const s = getComputedStyle(e); return { hidden: e.hidden, display: s.display, z: s.zIndex, img: s.backgroundImage.slice(0, 30) }; });
  ok(layer && !layer.hidden && layer.display !== "none" && layer.z === "1" && /data:image\/png/.test(layer.img), "depth_image: the cut out layer is on, at z 1, from the design's own PNG (" + JSON.stringify(layer) + ")");
  const shot = path.join(SHOTS, "depth-image.png");
  await page.screenshot({ path: shot });
  // read the screenshot's pixels in the page (decode the PNG it just saved)
  const b64 = fs.readFileSync(shot).toString("base64");
  const at = await page.evaluate(async ([src, pts]) => {
    const img = new Image(); img.src = "data:image/png;base64," + src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, [b64, [[480, 360], [480, 720], [100, 980], [1800, 100]]]);
  const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 40);
  ok(near(at[0], [255, 0, 0]), "depth_image: above the hills the clock shows through the see through sky (" + at[0] + ")");
  ok(near(at[1], [0, 255, 0]), "depth_image: below the ridge the cut out covers the clock (" + at[1] + ")");
  ok(near(at[2], [0, 0, 255]), "depth_image: a widget in front stays over the hills (" + at[2] + ")");
  ok(near(at[3], [96, 96, 96]), "depth_image: the photo itself shows behind everything (" + at[3] + ")");
  ok(!page.errors.length, "depth_image: no page errors " + page.errors.join(" | "));
  await page.close();
}
{ // 3b. an old design (a built in scene with depth) still draws the scene's own cut out
  const page = await home({ v: 1, background: { image: "backgrounds/scene-night.jpg", depth: true }, objects: [{ id: "c", type: "widget", kind: "clock", layer: "back", x: 460, y: 340, w: 1000, h: 400 }] }, "");
  const img = await page.evaluate(() => { const e = document.getElementById("cd-depth"); return e && !e.hidden ? getComputedStyle(e).backgroundImage : ""; });
  ok(/scene-night-fg\.webp/.test(img), "an old scene design: the scene's own cut out, as before");
  await page.close();
}

await browser.close();
server.close();
console.log("OK: " + n + " checks (shots in " + SHOTS + ")");
