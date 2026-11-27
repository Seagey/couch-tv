// Sharp app icons (tv-home/web/widgets.js, app-catalogue.js): an app tile on a 4K TV is handed the 512 pixel
// picture, a small tile or a small screen the 160 one. Drawn in node on a small fake DOM.
// Run: node tests/test_sharp_icons.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fakeDocument, fixedDate } = require("./fake-dom");

const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

function tv(innerWidth, devicePixelRatio) {
  const sb = { document: fakeDocument(), Date: fixedDate(Date), innerWidth, devicePixelRatio, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(web, "app-catalogue.js"), "utf8"), sb);
  vm.runInContext(fs.readFileSync(path.join(web, "widgets.js"), "utf8"), sb);
  return sb.window.CouchWidgets;
}
function pictures(W, size) {
  const el = W.render({ id: "a", type: "widget", kind: "app", size: "s", w: size, h: size, opts: { apps: ["netflix"] } }, { demo: true, designer: true, data: {} });
  return el.all().filter((e) => /^img$/i.test(e.tagName) && (e.src || e.getAttribute("src"))).map((e) => e.src || e.getAttribute("src"));
}
console.log("Running sharp icon tests...");
// a 1080p TV, a 4K TV drawn at twice the size (a 1920 page at pixel ratio 2), a 4K TV that is a 3840 page
const sizes = { "1080p": [1920, 1], "4K at ratio 2": [1920, 2], "4K full page": [3840, 1] };
Object.keys(sizes).forEach((k) => {
  const W = tv(sizes[k][0], sizes[k][1]);
  // the icon sits inside the panel's 24 px padding a side (lane G, the ABC iview fix), so a 110 tile draws a 62 icon
  const big = pictures(W, 200), small = pictures(W, 110);
  ok(big.length === 1, k + ": a 200 wide tile has a picture (" + big + ")");
  ok(small.length === 1, k + ": a 110 wide tile has a picture (" + small + ")");
  if (k === "1080p") ok(/netflix-512\.png$/.test(big[0]) && /netflix\.png$/.test(small[0]), "1080p: the 200 tile gets the 512, the 110 tile the 160");
  else ok(/netflix-512\.png$/.test(big[0]) && /netflix-512\.png$/.test(small[0]), k + ": both tiles get the 512 (a 62 icon becomes 124 real pixels)");
});
// the small screen of a phone preview never pays for the big file on a small tile
const W = tv(960, 1);
ok(/netflix\.png$/.test(pictures(W, 200)[0]), "a half size screen: a 200 tile is 100 real pixels, the 160 picture");
console.log("OK: " + n + " checks");
