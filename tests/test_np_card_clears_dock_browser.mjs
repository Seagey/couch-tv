// The Night look's Now playing card never runs into the dock, in a real browser.
//   - Spotify's card with its extra row (shuffle, repeat, sleep, output, open app) was taller than the
//     show cards and grew down behind the dock, because the row sits at a fixed top. The row now lifts
//     by what the card overflows, keeping the gap a plain card leaves (2.375rem) above the dock.
//   - a card with no extra row, and no card at all, leave the row where it always was
// COUCHTV_PLAYWRIGHT=<folder with Playwright> node tests/test_np_card_clears_dock_browser.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.COUCHTV_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
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
const BASE = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html?mock=1";

let passed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { fails.push(m); console.log("FAIL " + m); } };

const SONG = { available: true, title: "A long enough song", artist: "Someone", state: "playing", position: 17000, duration: 191000,
  speed: 1, actions: 3125244, can_shuffle: true, can_repeat: true, package: "com.spotify.tv.android" };
const PLAIN = { enabled: true, show_shuffle_repeat: false, show_sleep_timer: false, show_audio_output: false, show_jump_app: false };

const browser = await chromium.launch();
async function open(spotify) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  await page.addInitScript(() => {
    window.spotifyNow = { available: false, state: "stopped" };
    window.TVOS = {
      spotifyState: () => JSON.stringify(window.spotifyNow), spotifyHasPermission: () => true,
      spotifyControl: () => true, apps: () => "[]",
      audioOutputInfo: () => JSON.stringify({ type: "hdmi", name: "Soundbar" })
    };
  });
  await page.goto(BASE + "&reset=1");
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("mock:tvhome.settings", JSON.stringify({ s, updated: 1 })); }, { spotify });
  await page.goto(BASE);
  await page.waitForFunction(() => window.tv && document.querySelector("#shelf"));
  await page.waitForTimeout(700);
  return page;
}
const play = (page, s) => page.evaluate((s) => { window.spotifyNow = s; window.tv.spotifyUpdate(s); }, s);
const measure = (page) => page.evaluate(() => {
  const r = (id) => { const el = document.getElementById(id); return el ? el.getBoundingClientRect() : null; };
  const np = r("np"), grid = r("grid"), head = r("shelf-title");
  return { npBottom: np.bottom, npH: np.height, gridTop: grid.top, headTop: head.top,
    extra: !!document.querySelector("#np .np-extra"), on: document.getElementById("np").classList.contains("on") };
});

try {
  // 1. the full card: its extra row shows, and the card ends above the dock with a plain card's gap
  let page = await open({ enabled: true });
  const before = await measure(page);
  await play(page, SONG);
  await page.waitForTimeout(400);
  let m = await measure(page);
  ok(m.on && m.extra, "the card is on with its extra row");
  ok(m.gridTop - m.npBottom >= 37, "the full card clears the dock (gap " + (m.gridTop - m.npBottom).toFixed(1) + "px)");
  ok(m.headTop < before.headTop, "the row lifted (heading " + before.headTop.toFixed(0) + " to " + m.headTop.toFixed(0) + ")");
  ok(m.headTop > 500, "the row stays below the clock (heading at " + m.headTop.toFixed(0) + ")");
  // an Up next line sits in the same extra row: still clear
  await play(page, { ...SONG, title: "Second song", up_next_title: "Third song", up_next_artist: "Someone" });
  await page.waitForTimeout(400);
  m = await measure(page);
  ok(m.gridTop - m.npBottom >= 37, "with Up next the card still clears the dock");
  // the card goes: the row goes back to where it always was
  await play(page, { available: false, state: "stopped" });
  await page.waitForTimeout(400);
  m = await measure(page);
  ok(Math.abs(m.headTop - before.headTop) < 1, "with no card the row is back in its place");
  ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ").slice(0, 200) + ")");
  await page.close();

  // 2. a card with no extra row fits already: the row does not move
  page = await open(PLAIN);
  const plainBefore = await measure(page);
  await play(page, SONG);
  await page.waitForTimeout(400);
  m = await measure(page);
  ok(m.on && !m.extra, "the plain card has no extra row");
  ok(Math.abs(m.headTop - plainBefore.headTop) < 1, "a card that fits leaves the row where it was");
  ok(m.gridTop - m.npBottom >= 37, "the plain card clears the dock");
  await page.close();
} finally {
  await browser.close();
  server.close();
}

console.log(passed + " passed, " + fails.length + " failed");
process.exit(fails.length ? 1 : 0);
