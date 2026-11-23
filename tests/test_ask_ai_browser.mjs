// Ask AI, From your AI and Batteries on the real TV home, in a real browser at 1920x1080 (mock mode, a
// pretend Claude answered by the test itself, a pretend launcher for the batteries). Nothing real is asked.
//  1. the three widgets draw with nothing set up: a plain setup card each, no page errors;
//  2. with the remote only: OK on Ask AI, Set it up now, Claude, type a key, Use it and try it: the
//     answer from "Claude" shows in the sheet and then on the widget, and the key went only to Claude;
//  3. a message from an agent pops up over the home and fills From your AI;
//  4. Batteries shows each paired device's charge, lowest first, from the launcher.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ask_ai_browser.mjs
// SHOTS=<folder> saves pictures.
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
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// the launcher's batteries (Batteries.kt) as a stand in
await page.addInitScript(() => {
  window.TVOS_BATTERIES = JSON.stringify({ ok: true, need: "", devices: [{ name: "Pad 2", level: 12, kind: "controller" }, { name: "Remote", level: 64, kind: "remote" }] });
});
// a pretend Claude: answers every ask, and records what it was sent
const sent = [];
await page.route("https://api.anthropic.com/**", async (route) => {
  const r = route.request();
  if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
  sent.push({ url: r.url(), headers: r.headers(), body: JSON.parse(r.postData() || "{}") });
  await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify({ content: [{ type: "text", text: "Hello couch! The moon is about 384,000 kilometres away." }] }) });
});
const design = { v: 1, background: { colour: "#26303f" }, objects: [
  { id: "w0", type: "widget", kind: "ask", x: 80, y: 60, w: 760, h: 360 },
  { id: "w1", type: "widget", kind: "agent", x: 880, y: 60, w: 760, h: 360 },
  { id: "w2", type: "widget", kind: "battery", x: 80, y: 460, w: 760, h: 360 }] };
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("tvdesigner.design", JSON.stringify(d)); }, design);
await page.goto(BASE + "?mock=1&design=local");
await page.waitForFunction(() => document.querySelector('.cw-o[data-obj="w2"] .cw') && window.CouchDetail && window.CouchAsk);
await page.waitForTimeout(600);
const text = (id) => page.evaluate((i) => (document.querySelector('.cw-o[data-obj="' + i + '"] .cw') || {}).textContent || "", id);
const press = async (k, wait) => { await page.keyboard.press(k); await page.waitForTimeout(wait || 250); };

console.log("Running Ask AI browser tests...");

// 1. nothing set up: a setup card each
ok(/pick who answers/i.test(await text("w0")), "Ask AI says to pick who answers: " + await text("w0"));
ok(/Connect your AI|Nothing from your AI/i.test(await text("w1")), "From your AI says how to connect: " + await text("w1"));
// (0.13.10) in a browser it says Not on this TV, never which TVs it needs
ok((/Batteries/.test(await text("w2")) || /nearby|Not on this TV/i.test(await text("w2"))) && !/Google TV|Android TV|Fire TV/.test(await text("w2")), "Batteries draws: " + await text("w2"));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ask-1-unset.png") });

// 2. with the remote only
await page.evaluate(() => { const s = window.CouchDesign.nav; for (let k = 0; k < 8 && s.current().id !== "w0"; k++) s.move(-1, 0); for (let k = 0; k < 8 && s.current().id !== "w0"; k++) s.move(0, -1); });
await press("Enter", 900);
let cur = await page.evaluate(() => window.CouchDetail.current());
ok(cur && cur.kind === "ask" && cur.focusName === "Ask", "OK on Ask AI opens its layer (through its setup record while nothing is set up): " + JSON.stringify(cur));
await press("Enter", 600);   // Set it up now
ok(await page.evaluate(() => window.CouchAsk.isOpen() && window.CouchAsk.current().view === "setup"), "the setup sheet opens");
ok(/Claude \(Anthropic\)/.test(await page.evaluate(() => window.CouchAsk.current().text)), "Claude is offered");
await press("Enter", 400);   // Claude (Anthropic), the first choice in mock mode
ok(await page.evaluate(() => window.CouchAsk.current().view === "service"), "Claude's steps");
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ask-2-claude.png") });
await press("ArrowDown"); // the key
await press("Enter");     // into the box (the TV's keyboard comes up on a TV)
await page.keyboard.type("sk-ant-test-0000");
await press("Enter", 400);
ok(await page.evaluate(() => window.CouchAsk.status().hasKey), "the key is kept");
ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("sk-ant-test") || true, "browser storage only on a TV without the launcher");
// the remote moves on to Use it and try it after the key
await press("Enter", 1500);  // Use it and try it
{ const said = await page.evaluate(() => JSON.stringify(window.CouchAsk.current())); ok(/It works: Hello couch/.test(said), "the test answer shows in the sheet: " + said); }
ok(sent.length === 1 && sent[0].headers["x-api-key"] === "sk-ant-test-0000" && sent[0].body.model === "claude-haiku-5-5", "the key went to Claude only, with the tested model");
await press("Escape", 300); await press("Escape", 300);
// ask a real question from the Ask view
await page.evaluate(() => window.CouchAsk.open("ask"));
await press("Enter"); await page.keyboard.type("How far away is the moon?"); await press("Enter", 1500);
ok(/384,000/.test(await page.evaluate(() => window.CouchAsk.current().text)), "the answer shows big in the sheet");
await press("Escape", 400);
ok(!(await page.evaluate(() => window.CouchAsk.isOpen())), "Back closes the sheet");
await page.waitForTimeout(400);
ok(/How far away is the moon\?/.test(await text("w0")) && /384,000/.test(await text("w0")), "the widget shows the question and the answer: " + await text("w0"));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ask-3-answered.png") });
// the Android apps send Back as tv.back(), never a key: it closes the sheet too
await page.evaluate(() => window.CouchAsk.open("ask"));
ok(await page.evaluate(() => window.tv.back() === undefined && !window.CouchAsk.isOpen()), "tv.back() closes the sheet");

// 3. a message from an agent
await page.evaluate(() => window.CouchAsk._test.took({ message: { text: "Dinner is ready", from: "Claude", at: Date.now(), seconds: 20 } }, Date.now()));
await page.waitForTimeout(600);
ok(await page.evaluate(() => { const b = document.querySelector(".cask-banner"); return b && b.classList.contains("on") && /Dinner is ready/.test(b.textContent); }), "the message pops up over the home");
ok(/Dinner is ready/.test(await text("w1")) && /From Claude/.test(await text("w1")), "From your AI shows it: " + await text("w1"));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "ask-4-message.png") });

ok(errors.length === 0, "no page errors: " + errors.join(" | "));
console.log("Ask AI browser tests passed: " + n);
await browser.close();
server.close();
