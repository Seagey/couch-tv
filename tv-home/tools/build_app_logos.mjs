// Builds tv-home/web/app-logos/app-logos.js: the small vector logos for the Keep watching / Now playing cards.
// Sources are the SVG files in tv-home/tools/app-logos-src (where each came from: tv-home/web/app-logos/SOURCES.md).
//   SVGO_DIR=<folder with node_modules/svgo 3.3.2>  BBOX_DIR=<folder with node_modules/svg-path-bbox 2.1.0>
//   node tv-home/tools/build_app_logos.mjs
// Each logo becomes one plain path (no gradients, filters, styles or text: WebView 91 draws it as it is), cut
// tight to its own box so a card can size it by height.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "app-logos-src");
const OUT = path.join(HERE, "../web/app-logos/app-logos.js");
const { optimize } = createRequire(path.join(process.env.SVGO_DIR, "package.json"))("svgo");
const bbox = createRequire(path.join(process.env.BBOX_DIR, "package.json"))("svg-path-bbox").svgPathBbox;
// id (the catalogue's) -> source file, svgo precision, the paths to keep (all that are drawn, when missing), brand colour
// WORD: the logo spells the app's name, so a card can draw it larger and leave the name text out
const WORD = new Set(["disney", "stan", "binge", "prime", "foxtel", "dazn", "now", "raiplay", "vtmgo"]);
const L = {
  netflix: ["si-netflix", 2, null, "#e50914"], youtube: ["si-youtube", 2, null, "#ff0000"], spotify: ["si-spotify", 2, null, "#1ed760"],
  twitch: ["si-twitch", 2, null, "#9146ff"], appletv: ["si-appletv", 2, null, "#ffffff"], paramount: ["si-paramountplus", 2, null, "#0064ff"],
  foxtel: ["si-foxtel", 2, null, "#eb5205"], dazn: ["si-dazn", 2, null, "#f8f8f5"], crunchyroll: ["si-crunchyroll", 2, null, "#ff5e00"],
  stremio: ["si-stremio", 2, null, "#685cee"], now: ["si-now", 2, null, "#00e5b2"],
  disney: ["wm-disney", 1, null, "#3a7bff"], stan: ["wm-stan", 1, null, "#0072fb"], binge: ["wm-binge", 1, null, "#8a2be2"],
  prime: ["wm-prime", 2, null, "#00a8e1"], raiplay: ["wm-raiplay", 1, [0, 1], "#00b4e6"], vtmgo: ["wm-vtm", 1, null, "#ff01d5"],
};
const out = {};
for (const id of Object.keys(L).sort()) {
  const [file, prec, keep, colour] = L[id];
  const svg = optimize(fs.readFileSync(path.join(SRC, file + ".svg"), "utf8"), { floatPrecision: prec,
    plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }, "convertStyleToAttrs", "removeDimensions"] }).data;
  let paths = [];
  svg.replace(/<path\b([^>]*)>/g, function (m, a) {
    var d = (a.match(/\bd="([^"]*)"/) || [])[1], fill = (a.match(/\bfill="([^"]*)"/) || [])[1];
    if (d && fill !== "none") paths.push(d);
    return m;
  });
  if (keep) paths = keep.map((i) => paths[i]);
  // one <path> each: a path starting with a relative "m" would otherwise move from the end of the one before it
  const bs = paths.map((p) => bbox(p));
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1])), x1 = Math.max(...bs.map((b) => b[2])), y1 = Math.max(...bs.map((b) => b[3]));
  const r = (n) => String(+n.toFixed(prec + 1));
  out[id] = { vb: [r(x0), r(y0), r(x1 - x0), r(y1 - y0)].join(" "), c: colour, d: paths };
  if (WORD.has(id)) out[id].w = 1;
}
const js = "// Small vector logos for the Keep watching / Now playing cards (made by tv-home/tools/build_app_logos.mjs; sources and\n" +
  "// licences: SOURCES.md). { catalogue id: { vb: viewBox cut to the logo, c: brand colour, d: one path } }. An app not here keeps its picture.\n" +
  "(function (root) {\n  var L = " + JSON.stringify(out) + ";\n" +
  "  // markup for the app's logo (white; the page's CSS may colour it), sized to fit `maxH` x `maxW` rem; \"\" when the app has none\n" +
  "  function svg(id, maxH, maxW) {\n    var l = Object.prototype.hasOwnProperty.call(L, id) ? L[id] : null;\n    if (!l) return \"\";\n" +
  "    var v = l.vb.split(\" \"), r = v[2] / v[3], h = Math.min(maxH, maxW / r), w = Math.round(r * h * 100) / 100;\n" +
  "    return '<svg class=\"alogo\" viewBox=\"' + l.vb + '\" style=\"width:' + w + 'rem;height:' + Math.round(h * 100) / 100 + 'rem\" fill=\"currentColor\" aria-hidden=\"true\">' + l.d.map(function (d) { return '<path d=\"' + d + '\"/>'; }).join('') + '</svg>';\n  }\n" +
  "  root.APP_LOGOS = { logos: L, svg: svg, word: function (id) { return !!(Object.prototype.hasOwnProperty.call(L, id) && L[id].w); }, has: function (id) { return Object.prototype.hasOwnProperty.call(L, id); } };\n" +
  "  if (typeof module !== \"undefined\" && module.exports) module.exports = root.APP_LOGOS;\n})(typeof window !== \"undefined\" ? window : this);\n";
fs.writeFileSync(OUT, js);
console.log(Object.keys(out).length + " logos, " + js.length + " bytes");
for (const id in out) console.log(id.padEnd(12), out[id].vb.padEnd(26), out[id].d.join('').length);
