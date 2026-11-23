// The remote's mic/search button belongs to the TV's own voice assistant (Google Assistant or Gemini,
// Alexa on Fire TV), never to the home page. On Android the apps keep KEYCODE_SEARCH away from the
// WebView (VoiceKeys.kt in tv-home and on-tv); this checks the second layer, the page itself, in a real
// browser at the TV's 1280x720: the search key ("BrowserSearch", Chromium's keyCode 170 for
// KEYCODE_SEARCH) and the assistant keys are not cancelled by the home, move no focus and open nothing,
// while OK, the arrows and Back still belong to the home.
// Needs Playwright. Without it, it says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_voice_keys_browser.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

console.log("Running voice key browser tests...");
await page.goto(BASE + "?mock=1&reset=1");
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "?mock=1");
await page.waitForFunction(() => window.tv && document.querySelector(".focus"));
await page.waitForTimeout(600);

// one key down and up, as the WebView would send it; true when the page cancelled either
const press = (key, keyCode) => page.evaluate(([key, keyCode]) => {
  const ev = (type) => new KeyboardEvent(type, { key, keyCode, which: keyCode, bubbles: true, cancelable: true });
  const down = ev("keydown"), up = ev("keyup");
  document.activeElement.dispatchEvent(down); document.activeElement.dispatchEvent(up);
  return down.defaultPrevented || up.defaultPrevented;
}, [key, keyCode]);
const focusNow = () => page.evaluate(() => {
  const f = document.querySelector(".focus");
  return (f && (f.id || f.className) + "|" + (f.textContent || "").trim().slice(0, 40)) + "|" + location.href;
});

const VOICE = [["BrowserSearch", 170], ["Search", 84], ["Unidentified", 219], ["Unidentified", 231]];
for (const [key, code] of VOICE) {
  const before = await focusNow();
  const cancelled = await press(key, code);
  await page.waitForTimeout(250);
  ok(!cancelled, key + " " + code + ": the home leaves the voice key to the TV");
  ok((await focusNow()) === before, key + " " + code + ": no focus moved and nothing opened");
}

// the home's own keys are still the home's
ok(await press("ArrowRight", 39), "ArrowRight is still the home's");
ok(await press("Escape", 27), "Back is still the home's");

ok(errors.length === 0, "no page errors: " + errors.join("; "));
await browser.close();
server.close();
console.log("OK: " + n + " voice key checks passed");
