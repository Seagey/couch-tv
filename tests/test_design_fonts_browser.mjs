// Google Fonts in a design, in a real browser: the TV asks only the design store for the font file
// (/v1/fonts/<family>/<weight>.woff2), never Google; a font that arrives is used; one that never
// arrives leaves the home's own font (the time limit). Also Hold OK on an app inside a folder's full
// screen layer opens that app's menu (Change app, Remove from folder).
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_design_fonts_browser.mjs
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

// a stand in store: any font asked for is one of the home's own woff2 files; "Pacifico" never answers
const WOFF = fs.readdirSync(path.join(ROOT, "tv-home/web/fonts")).filter((f) => f.endsWith(".woff2"))[0];
const asked = [];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/v1/fonts/")) {
    asked.push(decodeURIComponent(req.url));
    if (/pacifico/i.test(req.url)) return;   // never answers
    res.writeHead(200, { "content-type": "font/woff2", "access-control-allow-origin": "*" });
    fs.createReadStream(path.join(ROOT, "tv-home/web/fonts", WOFF)).pipe(res);
    return;
  }
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port, BASE = ORIGIN + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], outside = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith("data:")) outside.push(r.url()); });

console.log("Running design font browser tests...");
const design = { v: 1, background: { colour: "#26303f" }, objects: [
  { id: "t1", type: "text", text: "Hello there", font: "Playfair Display", size: 90, x: 100, y: 100 },
  { id: "t2", type: "text", text: "Never loads", font: "Pacifico", size: 90, x: 100, y: 300 },
  { id: "f", type: "widget", kind: "folder", x: 1100, y: 100, w: 160, h: 160, opts: { label: "Apps", apps: ["netflix", "stan", "iview"] } },
  // a folder in Jost: its name must draw in Jost, the home's own file (not Inter)
  { id: "fj", type: "widget", kind: "folder", x: 1100, y: 500, w: 460, h: 360, style: { panel: "paper", font: "jost" }, opts: { label: "Free to air", apps: ["iview", "sbs", "9now"] } },
  // a folder in Cormorant Garamond: the same, from its own file
  { id: "fc", type: "widget", kind: "folder", x: 100, y: 500, w: 460, h: 360, style: { panel: "paper", font: "cormorant" }, opts: { label: "Film night", apps: ["netflix", "stan"] } }
] };
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
await page.goto(BASE + "?mock=1&design=local&designstore=" + encodeURIComponent(ORIGIN));
await page.waitForFunction(() => document.querySelector(".cw-o, .cd-o"), null, { timeout: 8000 });
await page.waitForTimeout(2500);
ok(asked.some((u) => u === "/v1/fonts/playfair-display/400.woff2") && asked.some((u) => u === "/v1/fonts/playfair-display/700.woff2"), "the TV asks the store for the family's files (" + asked.join(", ") + ")");
ok(!outside.some((u) => /google|gstatic/.test(u)), "nothing goes to Google (" + outside.join(", ") + ")");
ok(await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Playfair Display" && f.status === "loaded")), "a font that arrives is added and used");
ok(await page.evaluate(() => ![...document.fonts].some((f) => f.family.replace(/"/g, "") === "Pacifico" && f.status === "loaded")), "a font that never arrives is not used: the home's own font stays");
ok(await page.evaluate(() => /Playfair Display/.test(getComputedStyle([...document.querySelectorAll("[data-obj=t1]")][0] || document.body).fontFamily + " " + ([...document.querySelectorAll("[data-obj=t1] *")].map((e) => getComputedStyle(e).fontFamily).join(" ")))), "the text draws with it, the home's font behind it");
const jost = await page.evaluate(async () => {
  const lab = [...document.querySelectorAll(".cw-k-folder .cw-lab")].find((e) => /Free to air/.test(e.textContent));
  await document.fonts.ready;
  return { family: lab ? getComputedStyle(lab).fontFamily : "", loaded: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Jost" && f.status === "loaded"),
    check: document.fonts.check('650 25px "Jost"', "Free to air") };
});
ok(/^"?Jost/.test(jost.family) && jost.loaded && jost.check, "a Jost folder's name draws in Jost, from the home's own file (" + JSON.stringify(jost) + ")");
ok(!asked.some((u) => /jost/i.test(u)), "Jost is the home's own: never asked of the store");
const corm = await page.evaluate(async () => {
  const lab = [...document.querySelectorAll(".cw-k-folder .cw-lab")].find((e) => /Film night/.test(e.textContent));
  await document.fonts.ready;
  return { family: lab ? getComputedStyle(lab).fontFamily : "", loaded: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Cormorant Garamond" && f.status === "loaded"),
    check: document.fonts.check('650 25px "Cormorant Garamond"', "Film night") };
});
ok(/^"?Cormorant Garamond/.test(corm.family) && corm.loaded && corm.check, "a Cormorant Garamond folder's name draws in it, from the home's own file (" + JSON.stringify(corm) + ")");
ok(!asked.some((u) => /cormorant/i.test(u)), "Cormorant Garamond is the home's own: never asked of the store");

// Hold OK in the folder's full screen layer
await page.evaluate(() => window.CouchDesign.nav.focus("f", -1));
await page.keyboard.press("Enter"); await page.waitForTimeout(800);
ok(await page.evaluate(() => window.CouchDetail.isOpen()), "OK on the folder tile opens it full screen");
await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); await page.waitForTimeout(400);
const items = await page.evaluate(() => [...document.querySelectorAll(".cw-sheet .cw-mi")].map((e) => e.textContent));
ok(!(await page.evaluate(() => window.CouchDetail.isOpen())) && items.indexOf("Change app") >= 0 && items.indexOf("Remove from folder") >= 0, "Hold OK on an app in the layer: its menu (" + items.join(", ") + ")");
const down = items.indexOf("Remove from folder");
for (let k = 0; k < down; k++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(80); }
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
const e = await page.evaluate(() => window.CouchDesign.appEdits());
ok(e["f|folder"] && e["f|folder"].length === 2, "Remove from folder from the layer: two apps left (" + JSON.stringify(e) + ")");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
server.closeAllConnections(); server.close();
console.log("OK: " + n + " checks");
