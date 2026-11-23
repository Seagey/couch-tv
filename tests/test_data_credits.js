// 0.13.12: Open-Meteo's weather and GeoNames' places are CC BY 4.0, so Couch TV credits them where they show:
// "Weather data by Open-Meteo.com" under the forecast, air quality and surf layers (widget-detail.js), in plain
// text in every language; "Location data based on GeoNames" under Home settings, Location (Open-Meteo's place
// search is built on GeoNames); and both in the README's credits and docs/PRIVACY.md.
// node tests/test_data_credits.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// the widget layer: one credit helper, used by the three layers Open-Meteo fills and by nothing else
const det = read("tv-home/web/widget-detail.js");
ok(det.includes('function credit() { return E("div", "cwd-credit", "", ["Weather data by Open-Meteo.com"]); }'), "widget-detail.js has the credit line");
const body = (name) => { const i = det.indexOf("  B." + name + " = function"); return det.slice(i, det.indexOf("\n  };\n", i)); };
for (const name of ["forecast", "air", "surf"]) ok(body(name).includes("S.body.appendChild(credit());"), name + " shows the credit");
ok((det.match(/appendChild\(credit\(\)\)/g) || []).length === 4, "the credit is on those layers only (forecast twice: with and without the full forecast)");
const css = read("tv-home/web/widgets.css");
ok(/\.cwd-credit \{ position: absolute;[^}]*font-size: 20px;[^}]*pointer-events: none; \}/.test(css), "the credit is small, out of the way and not a stop");

// the credit in every language the widget lines speak, with the name kept
const ctx = { window: {} };
vm.runInNewContext(read("tv-home/web/widget-lines.js"), ctx);
const lines = read("tv-home/web/widget-lines.js");
const m = /^    "Weather data by Open-Meteo\.com": (\{.*\}),$/m.exec(lines);
ok(m, "widget-lines.js has the credit");
const tr = JSON.parse(m[1]);
const langs = JSON.parse(/^    "This week": (\{.*\}),$/m.exec(lines)[1]);
ok(Object.keys(langs).every((k) => typeof tr[k] === "string"), "every language This week has, the credit has too");
ok(Object.values(tr).every((s) => s.includes("Open-Meteo.com")), "every language keeps the name Open-Meteo.com");

// Home settings, Location: the GeoNames credit in all 16 blocks, under the place note
const i18n = read("tv-home/web/i18n.js");
const notes = (i18n.match(/^    loc_note: /mg) || []).length, credits = i18n.match(/^    loc_credit: ".*GeoNames.*",$/mg) || [];
ok(notes === 16 && credits.length === 16, "loc_credit in every language (" + credits.length + " of " + notes + ")");
ok(i18n.includes('    loc_credit: "Location data based on GeoNames",'), "the English line");
ok(read("tv-home/web/app.js").includes('rows.push(info("loc-credit", t("loc_credit")));'), "Home settings, Location shows it");

// README and PRIVACY
const readme = read("README.md"), privacy = read("docs/PRIVACY.md");
ok(/Weather data by \[Open-Meteo\.com\]\(https:\/\/open-meteo\.com\/\) \(CC BY 4\.0\)/.test(readme), "README credits Open-Meteo");
ok(/location data based on \[GeoNames\]\(https:\/\/www\.geonames\.org\/\) \(CC BY 4\.0\)/.test(readme), "README credits GeoNames");
ok(privacy.includes("Weather data by Open-Meteo.com (CC BY 4.0)") && privacy.includes("location data based on GeoNames"), "PRIVACY.md credits both");

// copy rules on the new lines: no em or en dashes
const added = [m[0], ...credits, readme.split("\n").find((l) => l.startsWith("- Weather data by")), ...privacy.split("\n").filter((l) => /Open-Meteo|GeoNames/.test(l))];
ok(added.every((l) => !/[–—]/.test(l)), "no em or en dashes in the credits");

console.log("data credits: " + n + " checks passed");
