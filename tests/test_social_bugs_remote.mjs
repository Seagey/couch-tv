// The phone remote's side of two social reports (coord/SOCIAL-BUILDLIST-0139.md), in a real browser at a
// phone's size, against the built remote and a pretend bridge:
//   g32  a Samsung smart monitor: a More keys part in the TV sheet (Return, Exit, which is the monitor's Esc,
//        Tools, Info, the colour keys and the rest), each sent as /api/key; other TVs do not show it.
//   g34  "the clicker vanishes the second you want one of those five scenes": Previous scene and Next scene
//        in the same sheet send /api/say/scene, and the remote stays open: same page, sheet still up.
// Needs Playwright and a built remote. REMOTE_DIST=<a built remote/dist>; without it the remote is built
// here with vite when remote/node_modules has it, else the test says so and passes.
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_social_bugs_remote.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.COUCHTV_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
let DIST = process.env.REMOTE_DIST;
if (!DIST) {
  const vite = path.join(ROOT, "remote", "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) { console.log("SKIP: no built remote (set REMOTE_DIST) and no vite in remote/node_modules"); process.exit(0); }
  DIST = fs.mkdtempSync(path.join(os.tmpdir(), "couchtv-remote-"));
  execFileSync(process.execPath, [vite, "build", path.join(ROOT, "remote"), "--outDir", DIST, "--emptyOutDir", "--logLevel", "error"], { stdio: "inherit" });
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/" || !path.extname(p)) p = "/index.html";
  const f = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/";

const counts = {}, fails = [];
let current = "";
const ok = (c, m) => { if (c) { counts[current] = (counts[current] || 0) + 1; return; } fails.push(current + ": " + m); console.log("FAIL " + current + ": " + m); };

const browser = await chromium.launch();
async function remote(kind) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.errors = errors;
  const sent = [];
  const tv = { id: "living-room", name: "Living room", kind, paired: true, picture: false };
  await page.route("**/api/**", async (r) => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
    const json = (o, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(o) });
    if (m === "POST") { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} sent.push([p, b]); }
    if (p === "/api/events") return r.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    if (p === "/api/tvs") return json({ ok: true, tvs: [tv] });
    if (p === "/api/config") return json({ ok: true, people: [], tvs: [tv], default_tv: tv.id, home: {} });
    if (p === "/api/now") return json({ ok: true, tv_connected: true, power: "on", app: { id: "home", name: "Couch TV" } });
    if (p === "/api/apps") return json({ ok: true, apps: [] });
    if (p === "/api/screens") return json({ ok: true, screens: [] });
    if (p === "/api/settings") return json({ ok: true, settings: {} });
    if (p === "/api/sleep") return json({ ok: true, ends: null });
    if (p === "/api/say/scene") return json({ ok: true, scene: { pick: "next", at: Date.now() }, listening: true });
    return json({ ok: true, items: [], picks: [], continue: [] });
  });
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.setItem("tv.who", "both"); });
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  page.sent = sent;
  return page;
}
async function openSheet(page) {
  await page.click("button[aria-label='More controls'], .topbar button.round.glass >> nth=0");
  await page.waitForTimeout(500);
}

try {
  // ------------------------------------------------------------------ g34
  current = "g34";
  {
    const page = await remote("android");
    // a page that reloads loses this mark; one that stays keeps it
    await page.evaluate(() => { window.__stayed = "yes"; });
    let loads = 0; page.on("load", () => loads++);
    await openSheet(page);
    const next = page.getByRole("button", { name: "Next scene" });
    ok(await next.count() === 1, "the TV sheet has a Next scene button");
    ok(await page.getByRole("button", { name: "Previous scene" }).count() === 1, "and a Previous scene button");
    await next.click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Previous scene" }).click(); await page.waitForTimeout(300);
    await next.click(); await page.waitForTimeout(300);
    const picks = page.sent.filter((s) => s[0] === "/api/say/scene").map((s) => s[1].pick);
    ok(JSON.stringify(picks) === JSON.stringify(["next", "prev", "next"]), "each press sends the pick to the TV (" + JSON.stringify(picks) + ")");
    ok(loads === 0 && await page.evaluate(() => window.__stayed) === "yes", "the remote page did not reload (" + loads + " loads)");
    ok(await next.isVisible(), "the sheet is still open after three presses: the remote stays");
    ok(await page.evaluate(() => !!document.querySelector(".topbar")), "the remote is still there under it");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
    // a Roku or Apple TV draws its own home (no couch-tv scenes to pick): no Scene buttons there
    for (const kind of ["roku", "appletv"]) {
      const p2 = await remote(kind);
      await openSheet(p2);
      ok(await p2.getByRole("button", { name: "Next scene" }).count() === 0, kind + ": no Scene buttons");
      await p2.close();
    }
  }
  // ------------------------------------------------------------------ g32
  current = "g32";
  {
    const page = await remote("samsung");
    await openSheet(page);
    ok(await page.getByText("More keys", { exact: true }).count() === 1, "a Samsung TV's sheet has More keys");
    const want = [["Return", "return"], ["Exit", "exit"], ["Smart Hub", "smart_hub"], ["Tools", "tools"], ["Info", "info"], ["Guide", "guide"],
      ["Source", "source"], ["Channel list", "channel_list"], ["Red", "red"], ["Green", "green"], ["Yellow", "yellow"], ["Blue", "blue"]];
    for (const [label, key] of want) {
      const b = page.locator(".more-keys button", { hasText: new RegExp("^" + label + "$") });
      ok(await b.count() === 1, "a " + label + " key");
      await b.click(); await page.waitForTimeout(120);
      const last = page.sent.filter((s) => s[0] === "/api/key").pop();
      ok(last && last[1].key === key, label + " sends " + key + " (" + JSON.stringify(last) + ")");
    }
    ok(await page.locator(".more-keys").isVisible(), "the sheet stays open between presses");
    ok(/Esc key on a smart monitor/.test(await page.locator(".more-keys .note").textContent()), "it says Exit is the monitor's Esc");
    ok(page.errors.length === 0, "no page errors (" + page.errors.join(" | ") + ")");
    await page.close();
    const other = await remote("android");
    await openSheet(other);
    ok(await other.locator(".more-keys").count() === 0, "an Android TV's sheet has no Samsung keys");
    await other.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(Object.keys(counts).map((k) => k + ": " + counts[k] + " checks passed").join("\n"));
if (fails.length) { console.log(fails.length + " checks FAILED"); process.exit(1); }
console.log("ok: social bugs remote tests passed (" + Object.values(counts).reduce((a, b) => a + b, 0) + " checks)");
