// Home group (ws2-home): a photo put in a Photo or Art frame widget in Couch TV Studio (an asset the
// design store sends inside the design as a JPEG data: URL, branch nl-photo) still wins over every new
// setting of these widgets: the photo picked on this TV (Home settings, Your photos), Fill or fit and the
// frame colour. Every web TV kind (Google TV, Android TV, Fire TV, Samsung, LG, the browser homes) runs
// this same widgets.js. Without a photo of its own, the photo picked on this TV shows.
// Run: node tests/test_ws2_home_photo.js
const assert = require("assert");
const K = require("./web-widgets-kit");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running home group own photo tests...");

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHR8eHRoc";
const all = (el) => [el].concat(...(el.childNodes || []).map(all));
const css = (el) => all(el).map((e) => (e.style && e.style.cssText) || "").join("\n");
const fills = (el, re) => all(el).filter((e) => e.style && re.test(e.style.cssText || ""));
const OWN = /background-image:url\("data:image\/jpeg/;
const TVP = /photos\.example\/b\.jpg/;

const T = K.home();
const C = T.C;
const CD = K.design();
const env = { data: { photos: ["http://photos.example/a.jpg", "http://photos.example/b.jpg"], home: { photoIds: ["pa", "pb"] } }, wset: { w1: { photo: "pb" } } };

for (const kind of ["photo", "artframe"]) {
  const keys = C.get(kind).settings.map((s) => s.key);
  ok(keys.includes("photo") && keys.includes("image"), kind + ": has both the TV's photo pick and the design's own photo");
  // the design's own photo, kept by the TV's gate together with this widget's design settings
  const opts = kind === "photo" ? { image: JPEG, fit: "contain" } : { image: JPEG, mat: "#1d1b18" };
  const kept = K.kept(CD, kind, opts);
  ok(kept.image === JPEG, kind + ": the gate keeps the photo with its settings");
  for (const [id, w, h] of K.sizes(C, kind)) {
    // a photo picked on this TV too: the design's own photo still shows, once, and not the picked one
    const el = T.W.render({ kind, w, h, id: "w1", opts: kept }, env);
    ok(fills(el, OWN).length === 1, kind + " " + id + ": the design's own photo shows, with a photo picked on this TV");
    ok(!TVP.test(css(el)), kind + " " + id + ": not the photo picked on this TV");
    if (kind === "photo") ok(/background-size:contain/.test(fills(el, OWN)[0].style.cssText), "photo " + id + ": Fit the whole photo still applies");
    if (kind === "artframe") ok(/1d1b18|29,\s*27,\s*24/i.test(css(el)), "artframe " + id + ": the Black frame colour still applies");
    // no photo of its own: the photo picked on this TV shows
    const el2 = T.W.render({ kind, w, h, id: "w1", opts: {} }, env);
    ok(TVP.test(css(el2)) && !OWN.test(css(el2)), kind + " " + id + ": without its own photo, the photo picked on this TV shows");
    // and the other pick shows the other photo (not chance)
    const el3 = T.W.render({ kind, w, h, id: "w1", opts: {} }, Object.assign({}, env, { wset: { w1: { photo: "pa" } } }));
    ok(/photos\.example\/a\.jpg/.test(css(el3)) && !TVP.test(css(el3)), kind + " " + id + ": picking the other photo shows that one");
  }
}
console.log(`${n} home group own photo tests passed.`);
