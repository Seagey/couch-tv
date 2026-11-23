// Builds tv-home/web/google-fonts.js, the Google Fonts families a design may name, as a compact copy of
// the design store's own list (tools/tv-designer/server/lib/google-fonts.mjs, made by
// tools/tv-designer/scripts/server-fonts-list.mjs from Google's public family list), so the TV, the
// designer and the store agree on every name, weight and subset.
//   node scripts/build-google-fonts.mjs [path to server/lib/google-fonts.mjs]
// The TV never asks Google for anything: fonts load from the design store,
// /v1/fonts/<name>/<weight>[.latin-ext|.devanagari].woff2.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || path.resolve(HERE, "../../../tv-designer/server/lib/google-fonts.mjs");
const list = (await import(pathToFileURL(src).href)).default;
const head = fs.readFileSync(src, "utf8").split("\n")[0].replace(/^\/\/\s*/, "");
const SUB = { "latin": "l", "latin-ext": "e", "devanagari": "d" };
const rows = [];
for (const name of Object.keys(list).sort()) {
  const [family, weights, subsets] = list[name];
  if (!/^[a-z0-9-]{1,64}$/.test(name) || !/^[A-Za-z0-9 ]{1,60}$/.test(family)) continue;
  rows.push(name + ";" + family + ";" + weights.map((w) => w / 100).join("") + ";" + subsets.map((s) => SUB[s] || "").join(""));
}
const out = `// Google Fonts families a design may name: a compact copy of the design store's own list
// (tools/tv-designer/server/lib/google-fonts.mjs: "${head}"), made by
// scripts/build-google-fonts.mjs, ${rows.length} families. Each line: name;family;weights;subsets, where the
// name is the one in the store's address, weights are the upright weights in hundreds ("47" is 400
// and 700) and subsets are l latin, e latin-ext, d devanagari. Data only: the TV loads a font's files
// from the design store (/v1/fonts/<name>/<weight>[.latin-ext|.devanagari].woff2), never from Google.
// ES5, and a CommonJS module for tests.
(function (root) {
  "use strict";
  var LIST = ${JSON.stringify(rows.join("\n"))};
  var BY = {}, SUB = { l: "latin", e: "latin-ext", d: "devanagari" };
  LIST.split("\\n").forEach(function (l) {
    var p = l.split(";"), f = { name: p[0], family: p[1], weights: p[2].split("").map(function (d) { return +d * 100; }), subsets: p[3].split("").map(function (s) { return SUB[s]; }) };
    BY[p[1].toLowerCase()] = f; BY["@" + p[0]] = f;
  });
  function own(k) { return Object.prototype.hasOwnProperty.call(BY, k); }
  var API = {
    version: 2,
    count: ${rows.length},
    // the family by its name as Google writes it (any case), or by the store's name for it: { name,
    // family, weights, subsets }, or null
    find: function (name) {
      if (typeof name !== "string" || name.length > 64 || !/^[A-Za-z0-9 -]+$/.test(name)) return null;
      var k = name.replace(/\\s+/g, " ").trim().toLowerCase();
      return own(k) ? BY[k] : own("@" + k) ? BY["@" + k] : null;
    },
    // the CSS font-family for a family, with the home's own font behind it while it loads
    css: function (name) { var f = API.find(name); return f ? '"' + f.family + '", "Inter", sans-serif' : ""; },
    // the nearest weight the family has
    weight: function (name, want) {
      var f = API.find(name); if (!f) return 400;
      want = +want || 400;
      return f.weights.reduce(function (best, w) { return Math.abs(w - want) < Math.abs(best - want) ? w : best; }, f.weights[0]);
    }
  };
  root.CouchFonts = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
`;
const dest = path.join(HERE, "../tv-home/web/google-fonts.js");
fs.writeFileSync(dest, out);
console.log("wrote " + rows.length + " families to " + dest + " (" + out.length + " bytes)");
