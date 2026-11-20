// The widget settings words (labels, help and choice names in tv-home/web/widget-caps.js) that have no
// line yet in tv-home/web/caps-words.js, the table the TV home (tv-words.js) and the phone pages
// (phone-words.js) translate them with. Prints each missing English line once, with the widget kinds
// that use it; --json prints them as a list. Exit code 0 always: it is a to do list, not a test.
//   node scripts/caps-words-todo.mjs [--json]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tv-home", "web");
export function capsLines(CAPS) {
  const out = new Map();
  const add = (s, kind) => { if (typeof s === "string" && s.trim()) { const k = s.trim(); if (!out.has(k)) out.set(k, new Set()); out.get(k).add(kind); } };
  for (const kind of CAPS.kinds()) for (const s of CAPS.settings(kind)) {
    if (!s || s.pre !== true || (Array.isArray(s.where) && !s.where.includes("tv") && !s.where.includes("phone"))) continue;
    add(s.label, kind); add(s.help, kind);
    for (const o of Array.isArray(s.options) ? s.options : []) if (Array.isArray(o)) add(o[1], kind);
  }
  return out;
}
export function capsTable() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(web, "caps-words.js"), "utf8"), ctx);
  const c = ctx.window.CouchCapsWords, out = Object.assign({}, c.words);
  for (const en of c.same || []) out[en] = out[en] || { same: true };   // reads the same in every language
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const CAPS = createRequire(import.meta.url)(path.join(web, "widget-caps.js"));
  const have = capsTable(), lines = capsLines(CAPS);
  const missing = [...lines].filter(([en]) => !have[en]);
  if (process.argv.includes("--json")) console.log(JSON.stringify(missing.map(([en]) => en), null, 1));
  else {
    for (const [en, kinds] of missing) console.log(JSON.stringify(en) + "   (" + [...kinds].join(", ") + ")");
    console.log(missing.length + " of " + lines.size + " widget settings words have no line in caps-words.js yet.");
  }
}
