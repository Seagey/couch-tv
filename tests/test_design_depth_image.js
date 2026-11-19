// background.depth_image (tv-home/web/design.js, design-code.js, share-home.js): a design may carry a
// second picture, a cut out of its own photo (PNG or WebP with see through sky), drawn over the clock so
// "clock behind the hills" works on the owner's own photos, not only the four built in scenes. It is
// checked like the photo itself (only inside the design or from this TV, never a link, the same size
// limit), a JPEG is refused (no see through parts), and a design without it is drawn exactly as before.
// The browser check that it really draws over the clock: tests/test_tv_fixes_browser.mjs.
// Run: node tests/test_design_depth_image.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
const sb = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080, setTimeout, clearTimeout, atob: (s) => Buffer.from(s, "base64").toString("latin1"),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, COUCH_CONFIG: {}
};
sb.window = sb;
sb.addEventListener = noop;
vm.createContext(sb);
for (const f of ["design.js", "qr.js", "share-home.js", "design-code.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
const CD = sb.window.CouchDesign, S = sb.window.CouchShare, C = sb.window.CouchDesignCode;
const plain = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running depth image tests...");

const b64 = (buf) => Buffer.from(buf).toString("base64");
const PNG = "data:image/png;base64," + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const WEBP = "data:image/webp;base64," + b64(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8L")]));
const JPEG = "data:image/jpeg;base64," + b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PHOTO = JPEG;
const bg = (b) => plain(CD.sanitize({ background: b })).background || {};

// 1. the gate: kept as a PNG or WebP inside the design or from the TV's own backgrounds/, only with a photo
let o = bg({ image: PHOTO, depth_image: PNG });
ok(o.depth_image === PNG && o.depth === true, "your own photo with a PNG cut out: kept, depth on");
ok(bg({ image: PHOTO, depth_image: WEBP }).depth_image === WEBP, "a WebP cut out is kept");
ok(bg({ image: PHOTO, depth_image: "backgrounds/mine/our-place-fg.png" }).depth_image === "backgrounds/mine/our-place-fg.png", "a cut out on the TV itself is kept");
ok(bg({ image: PHOTO, depth_image: PNG, depth: false }).depth === false, "depth: false keeps it off");
ok(bg({ image: PHOTO, depth_image: JPEG }).depth_image === undefined, "a JPEG cut out is refused (it has no see through parts)");
ok(bg({ image: PHOTO, depth_image: JPEG }).depth === undefined, "and with it refused, a photo of your own has no depth, as before");
["https://evil.example/cut.png", "http://198.51.100.5/cut.png", "//evil.example/cut.webp", "javascript:alert(1)", "backgrounds/../../etc/x.png", "file:///x.png",
  "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA<script>", "blob:http://tv/1"].forEach((u) => {
  ok(bg({ image: PHOTO, depth_image: u }).depth_image === undefined, "refused: " + u.slice(0, 32));
});
ok(bg({ image: PHOTO, depth_image: "data:image/png;base64," + "A".repeat(4000001) }).depth_image === undefined, "a cut out over the photo's own size limit is refused");
ok(bg({ colour: "#000000", depth_image: PNG }).depth_image === undefined, "no photo, no cut out (a plain colour)");
ok(bg({ depth_image: PNG }).depth_image === undefined, "a cut out alone is not a background");
// old designs: unchanged
ok(JSON.stringify(bg({ image: "backgrounds/scene-night.jpg", depth: true })) === JSON.stringify({ image: "backgrounds/scene-night.jpg", depth: true }), "a built in scene with depth: as before");
ok(bg({ image: PHOTO, depth: true }).depth === undefined, "your own photo with depth but no cut out: no depth, as before");
o = bg({ image: "backgrounds/scene-fog.jpg", depth: true, depth_image: PNG });
ok(o.depth_image === PNG && o.depth === true, "a scene with its own cut out: the design's own wins");

// 2. drawing: the hills layer takes the design's own cut out (css() and background() share depthSrc)
const src = fs.readFileSync(path.join(web, "design.js"), "utf8");
ok(/function depthSrc\(bg, src\)[\s\S]{0,260}depthImgOk\(bg\.depth_image\)/.test(src), "the depth layer uses the design's own cut out first");
ok(/var fgSrc = depthSrc\(bg, src\);/.test(src) && /depthSrc\(obj\(d\.background\), src\)/.test(src), "the style and the layer both ask depthSrc");
ok(/#cd-depth\{position:fixed[^"]*z-index:1/.test(src), "still between the back (0) and front (3) widgets");

// 3. by code from the store: kept only when its first bytes are a real PNG or WebP
const fetched = (b) => (C.accept(JSON.stringify({ design: { v: 1, background: b } })) || {}).background || {};
ok(fetched({ image: PHOTO, depth_image: PNG }).depth_image === PNG, "from the store: a real PNG cut out is kept");
ok(fetched({ image: PHOTO, depth_image: WEBP }).depth_image === WEBP, "from the store: a real WebP cut out is kept");
ok(fetched({ image: PHOTO, depth_image: "data:image/png;base64," + JPEG.split(",")[1] }).depth_image === undefined, "from the store: a JPEG calling itself PNG is dropped");
ok(fetched({ image: PHOTO, depth_image: "https://evil.example/c.png" }).depth_image === undefined, "from the store: a link is dropped");
ok(fetched({ image: "https://evil.example/p.jpg", depth_image: PNG }).depth_image === undefined, "from the store: no photo kept, no cut out");
ok(C.accept("x".repeat(4000001)) === null, "from the store: the whole answer (photo and cut out together) stays under 4 MB");

// 4. Share this home: a household cut out never leaves the TV, like the photo it was cut from
const snap = { scenes: ["night"], builtIn: ["night"], design: { v: 1, background: { image: PHOTO, depth_image: PNG } } };
let d = plain(S.build(snap));
ok(!d.background || (d.background.image === undefined && d.background.depth_image === undefined), "share: your photo and its cut out both stay home");
d = plain(S.build(Object.assign({}, snap, { design: { v: 1, background: { image: "backgrounds/scene-fog.jpg", depth: true, depth_image: "backgrounds/scene-fog-fg.webp" } } })));
ok(d.background.depth_image === "backgrounds/scene-fog-fg.webp", "share: a built in cut out of a built in scene may go");

console.log("All " + n + " depth image tests passed.");
