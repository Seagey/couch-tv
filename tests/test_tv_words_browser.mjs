// The Home settings words added in English on 20 Nov 2026 (Designs, widget pages, banners, Edit on the TV
// and Edit on your phone) show in the TV's language (tv-home/web/tv-words.js, the tw_* keys in i18n.js),
// in a real browser on the TV home (?mock=1&ontv=1). English stays exactly as it was.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_tv_words_browser.mjs
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const HOME = "http://127.0.0.1:" + server.address().port + "/tv-home/web/index.html";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(HOME + "?mock=1&reset=1&ontv=1");
  await page.evaluate(() => localStorage.clear());
  await page.goto(HOME + "?mock=1&ontv=1");
  await page.waitForFunction(() => window.tv && window.CouchTvWords && document.getElementById("settings"));
  await page.waitForTimeout(1200);
  // English: nothing changes
  ok(await page.evaluate(() => window.CouchTvWords.words("Turn on designs") === null), "English stays as it is");
  // every tw_ word in every language block, with its placeholders
  const gaps = await page.evaluate(() => {
    const S = window.I18N.strings, bad = [], langs = window.I18N.langs.map((l) => l.id).filter((id) => id !== "es-MX");
    const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
    Object.keys(S.en).filter((k) => k.indexOf("tw_") === 0).forEach((k) => langs.forEach((l) => {
      if (l === "en") return;
      if (typeof S[l][k] !== "string" || !S[l][k]) bad.push(l + " " + k);
      else if (holes(S[l][k]) !== holes(S.en[k])) bad.push(l + " " + k + " placeholders");
    }));
    return { bad, n: Object.keys(S.en).filter((k) => k.indexOf("tw_") === 0).length, langs: langs.length };
  });
  ok(gaps.n >= 70 && gaps.langs === 15, "tw words: " + gaps.n + " in " + gaps.langs + " languages");
  ok(gaps.bad.length === 0, "every language has every word: " + gaps.bad.slice(0, 5).join("; "));
  // Spanish: a line drawn later is swapped as it is drawn
  await page.evaluate(() => window.I18N.set("es"));
  const swapped = await page.evaluate(async () => {
    const d = document.createElement("div"); d.className = "cw-sheet"; d.innerHTML = "<b>Turn on designs</b><small>Nothing changes until you choose a design</small><i>Edit on your phone</i>";
    document.body.appendChild(d); await new Promise((r) => setTimeout(r, 50));
    const out = d.innerText; d.remove(); return out;
  });
  ok(/Activar los diseños/.test(swapped) && /No cambia nada hasta que elijas un diseño/.test(swapped) && /Editar en el móvil/.test(swapped), "Spanish rows: " + swapped.replace(/\n/g, " | "));
  // a changed line (a redraw that sets the text) is swapped too
  const redraw = await page.evaluate(async () => {
    const d = document.createElement("div"); d.className = "cw-tip"; d.textContent = "x"; document.body.appendChild(d); await new Promise((r) => setTimeout(r, 30));
    d.firstChild.data = "Show all settings"; await new Promise((r) => setTimeout(r, 50)); const out = d.textContent; d.remove(); return out;
  });
  ok(redraw === "Mostrar todos los ajustes", "a redrawn line: " + redraw);
  // only where these words are drawn: the home itself, and a value a person typed, stay as they are
  const outside = await page.evaluate(async () => {
    const a = document.createElement("div"); a.textContent = "Show all settings"; document.body.appendChild(a);
    const b = document.createElement("div"); b.className = "cw-sheet"; b.innerHTML = '<span class="sv">Show all settings</span><span class="sv">Not set</span>'; document.body.appendChild(b);
    await new Promise((r) => setTimeout(r, 50));
    const out = [a.textContent, b.children[0].textContent, b.children[1].textContent]; a.remove(); b.remove(); return out;
  });
  ok(outside[0] === "Show all settings", "outside Home settings and the sheets: left alone");
  ok(outside[1] === "Show all settings" && outside[2] === "Sin configurar", "a typed value stays; Couch TV's own Not set is translated: " + outside.join(" | "));
  // a line with gaps keeps what is in them
  const tpl = await page.evaluate(() => window.CouchTvWords.words("Agenda: set up on your phone"));
  ok(tpl === "Agenda: configúralo en el móvil", "a line with a gap keeps the widget's name: " + tpl);
  // whole lines: the gaps, the spaces around a line, nothing more and nothing less
  const whole = await page.evaluate(() => {
    const W = window.CouchTvWords.words, t = window.I18N.t;
    return [
      [W("Weather: set up on your phone"), t("tw_setup_name_phone", { name: "Weather" })],
      [W("\n   Show all settings  "), "\n   Mostrar todos los ajustes  "],
      [W("Connected to homeassistant.local:8123. Scan to change what shows."), t("tw_ha_connected_to_host_scan_to_ch", { host: "homeassistant.local:8123" })],
      [W("Updated to 0.13.9. Your settings stay."), "Actualizado a 0.13.9. Tus ajustes se mantienen."],
      [W("Where to: Byron Bay, NSW."), "Destino: Byron Bay, NSW."],
      [W("Up to 4. Untick one first."), "Hasta 4. Desmarca uno primero."],
      [W("Update Couch TV"), "Actualizar Couch TV"],
      [W("Smart home"), window.I18N.strings.es.smart_home],
      [W("Scan with your phone's camera: it opens this widget's settings"), null]   // a part of a line is not a line
    ];
  });
  whole.forEach((p, i) => ok(p[0] === p[1], "whole line " + i + ": " + JSON.stringify(p[0]) + " is " + JSON.stringify(p[1])));
  // the banner after Back is held, and the "Use this design?" card's own words, but never the design's words in its preview
  const banner = await page.evaluate(async () => {
    const b = document.createElement("div"); b.className = "cd-escaped"; b.textContent = "Design switched off. This is the normal home. Turn it back on in Home settings, Designs.";
    const a = document.createElement("div"); a.className = "cd-ask"; a.innerHTML = '<div>Keep my home</div><div class="cd-o"><div>Keep my home</div></div><div class="sv">Kept on this TV</div>';
    document.body.appendChild(b); document.body.appendChild(a); await new Promise((r) => setTimeout(r, 60));
    const out = [b.textContent, a.children[0].textContent, a.children[1].textContent, a.children[2].textContent]; b.remove(); a.remove(); return out;
  });
  ok(banner[0] === "Diseño desactivado. Este es el inicio normal. Vuelve a activarlo en Ajustes de inicio, Diseños.", "the switched off banner: " + banner[0]);
  ok(banner[1] === "Mantener mi inicio" && banner[2] === "Keep my home", "the card's button, not the design's own words: " + banner.slice(1, 3).join(" | "));
  ok(banner[3] === "Guardada en este televisor", "Couch TV's own value Kept on this TV: " + banner[3]);
  // Arabic and Hebrew: the address and the code read left to right inside the line (U+2066 ... U+2069)
  for (const l of ["ar", "he"]) {
    await page.evaluate((x) => window.I18N.set(x), l);
    const iso = await page.evaluate(() => [window.CouchTvWords.words("Agenda: set up on your phone"),
      window.I18N.t("set_phone_pc", { addr: "192.0.2.7:5400/setup", code: "123 456" }), window.CouchTvWords.words("Connected to homeassistant.local. Scan to change what shows.")]);
    ok(iso[0] && iso[0].includes("⁦Agenda⁩"), l + ": the Hold OK line isolates the widget's name: " + JSON.stringify(iso[0]));
    ok(iso[1].includes("⁦192.0.2.7:5400/setup⁩") && iso[1].includes("⁦123 456⁩"), l + ": the computer line isolates them: " + JSON.stringify(iso[1]));
    ok(iso[2].includes("⁦homeassistant.local⁩"), l + ": the Smart home line isolates the address");
  }
  await page.evaluate(() => window.I18N.set("es"));
  // Mexico: its own words where it says it differently, Spain's elsewhere
  await page.evaluate(() => window.I18N.set("es-MX"));
  ok(await page.evaluate(() => window.CouchTvWords.words("Edit on your phone") === "Editar en el celular"), "es-MX: celular");
  ok(await page.evaluate(() => window.CouchTvWords.words("Show all settings") === "Mostrar todos los ajustes"), "es-MX: falls back to es");
  // a line that is not one of these is left alone
  ok(await page.evaluate(() => window.CouchTvWords.words("Hello there") === null), "other lines stay");
  // the real Home settings in German: the section and its rows
  await page.evaluate(() => window.I18N.set("pl"));
  await page.evaluate(() => window.tv.settingsKey()); await page.waitForTimeout(300);
  await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  const secs = await page.evaluate(() => Array.from(document.querySelectorAll(".ssec")).map((x) => x.textContent.trim()));
  ok(secs.indexOf("Projekty") >= 0 && secs.indexOf("Designs") < 0, "Polish: the Designs section is Projekty: " + secs.join(", "));
  // go to it: its rows in Polish
  const at = secs.indexOf("Projekty");
  for (let i = 0; i < at; i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => document.getElementById("set-rows").innerText);
  ok(/Włącz projekty|Pobierz projekt/.test(rows) && !/Turn on designs|Get a design/.test(rows), "Polish Designs rows: " + rows.replace(/\n/g, " | ").slice(0, 300));
  ok(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log("tv words: " + n + " checks passed");
