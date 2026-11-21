// The widget settings a phone, a computer or an AI may change on the TV, from tv-home/web/widget-caps.js,
// as bridge/widget_settings.json: the TV's own MCP tools (bridge/mcp_server.py set_widget_setting) check a
// setting against it before sending anything, without needing Node on the home computer.
//
//   node scripts/widget-settings-json.mjs           writes the file
//   node scripts/widget-settings-json.mjs --check   exits 1 when the file is out of date (tests run this)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPS = createRequire(import.meta.url)(path.join(ROOT, "tv-home/web/widget-caps.js"));
const OUT = path.join(ROOT, "bridge/widget_settings.json");

const kinds = {};
CAPS.kinds().forEach((k) => {
  // the same filter the TV home uses for the phone (app.js designView, designEdit): "phone" in where, no image
  const l = CAPS.settings(k).filter((s) => s.where.indexOf("phone") >= 0 && s.type !== "image")
    .map((s) => ({ key: s.key, label: s.label, type: s.type }));
  if (l.length) kinds[k] = { name: CAPS.get(k).name, settings: l };
});
const text = JSON.stringify({ about: "Made by scripts/widget-settings-json.mjs from tv-home/web/widget-caps.js. Do not edit.", kinds }, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (now !== text) { console.error("bridge/widget_settings.json is out of date: run node scripts/widget-settings-json.mjs"); process.exit(1); }
  console.log("bridge/widget_settings.json matches widget-caps.js (" + Object.keys(kinds).length + " kinds)");
} else {
  fs.writeFileSync(OUT, text);
  console.log("wrote bridge/widget_settings.json (" + Object.keys(kinds).length + " kinds)");
}
