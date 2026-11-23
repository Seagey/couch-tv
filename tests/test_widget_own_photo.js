// A photo put in a Photo or Art frame widget in Couch TV Studio: the design store sends it to the TV
// inside the design as a JPEG data: URL (tools/tv-designer server/lib/validate.mjs inlineWidgetPhotos).
// design.js's gate keeps it (OPT.image), design-code.js accepts the answer, and widgets.js draws that
// photo, not the TV's own photos and not an empty card, in every size, in a smart stack too, with Fill
// the box or Fit the whole photo. Every web TV kind (Google TV, Android TV, Fire TV, Samsung, LG, the
// browser homes) runs these same files.
// Run: node tests/test_widget_own_photo.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const K = require("./web-widgets-kit");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running own photo in a widget tests...");

// a real JPEG's first bytes, as the store's re-encoded photo starts
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHR8eHRoc";
const all = (el) => [el].concat(...(el.childNodes || []).map(all));
const css = (el) => all(el).map((e) => (e.style && e.style.cssText) || "").join("\n");
const fills = (el) => all(el).filter((e) => e.style && /background-image:url\("data:image\/jpeg/.test(e.style.cssText || ""));

// 1. the store's answer, as the TV reads it: accept() and the gate keep the photo
const sb = { location: { search: "", origin: "http://tv" }, document: { documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, addEventListener() {} }, innerWidth: 1920, innerHeight: 1080, setTimeout, clearTimeout, atob: (x) => Buffer.from(x, "base64").toString("latin1"), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, COUCH_CONFIG: {} };
sb.window = sb; sb.addEventListener = () => {};
vm.createContext(sb);
for (const f of ["design.js", "design-code.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../tv-home/web", f), "utf8"), sb, { filename: f });
const answer = JSON.stringify({ design: { v: 1, objects: [
  { id: "p1", type: "widget", kind: "photo", size: "4x3", opts: { image: JPEG, fit: "contain", caption: "Byron Bay" } },
  { id: "a1", type: "widget", kind: "artframe", size: "4x3", opts: { image: JPEG, mat: "#ffffff" } },
  { id: "s1", type: "widget", kind: "stack", size: "4x3", items: [{ kind: "photo", opts: { image: JPEG } }, { kind: "clock" }] }] } });
const got = JSON.parse(JSON.stringify(sb.window.CouchDesign.sanitize(sb.window.CouchDesignCode.accept(answer))));
const by = Object.fromEntries(got.objects.map((o) => [o.id, o]));
ok(by.p1.opts.image === JPEG && by.p1.opts.fit === "contain", "the TV's gate keeps the Photo widget's photo and its fit");
ok(by.a1.opts.image === JPEG && by.a1.opts.mat === "#ffffff", "and the Art frame's, with its mat");
ok(by.s1.items[0].opts.image === JPEG, "and a smart stack Photo's");

// 2. widgets.js draws that photo, on a TV with no photos of its own and with some
const T = K.home();
const C = T.C;
for (const kind of ["photo", "artframe"]) {
  for (const [id, w, h] of K.sizes(C, kind)) {
    for (const env of [{}, { data: { photos: ["http://photos.example/a.jpg", "http://photos.example/b.jpg"] } }]) {
      const el = T.W.render({ kind, w, h, opts: { image: JPEG, fit: "contain", caption: "Byron Bay" } }, env);
      const f = fills(el);
      ok(f.length === 1, kind + " " + id + (env.data ? " (TV has photos)" : "") + ": draws the photo from the design, once");
      ok(!/photos\.example/.test(css(el)), kind + " " + id + ": not the TV's own photos");
      ok(!/cw-photo-empty/.test(String(el.className || "")) && !all(el).some((e) => e._cls && e._cls.includes("cw-photo-empty")), kind + " " + id + ": not the empty card");
    }
  }
}
// Fit the whole photo shows all of it, centred; Fill the box fills it
const fit = fills(T.W.render({ kind: "photo", w: 760, h: 360, opts: { image: JPEG, fit: "contain" } }, {}))[0];
ok(/background-size:contain/.test(fit.style.cssText) && /no-repeat/.test(fit.style.cssText), "Fit the whole photo: contain, no repeat");
ok(fit._cls.includes("cw-fill"), "on the cw-fill layer, which widgets.css centres (background-position: center)");
ok(/\.cw-fill\s*\{[^}]*background-position:\s*center/.test(fs.readFileSync(path.join(__dirname, "../tv-home/web/widgets.css"), "utf8")), "widgets.css centres it");
const fill = fills(T.W.render({ kind: "photo", w: 760, h: 360, opts: { image: JPEG } }, {}))[0];
ok(/background-size:cover/.test(fill.style.cssText), "Fill the box: cover");
// a smart stack's item is drawn by the same renderer with the stack's box (design.js draws each item)
const item = by.s1.items[0];
ok(fills(T.W.render({ kind: item.kind, w: 760, h: 760, opts: item.opts }, {})).length === 1, "a smart stack's Photo item draws its own photo");
console.log(`${n} own photo in a widget tests passed.`);
