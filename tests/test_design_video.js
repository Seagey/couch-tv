// background.video (tv-home/web/bg-video.js, design.js, design-code.js, share-home.js,
// designer-gate.js): a design's background may be a short looping video over its still picture.
// These are the checks without a browser: what a design may name (never a link), what a design got by
// code may carry, what Share this home leaves behind, the byte check of a video from the store (MP4
// with H.264 or WebM with VP8/VP9, at most 15 s, 1920x1080, 8 MB; 1280x720 and 4 MB for the 720p
// copy), which TVs keep the still picture, the speed meter, the page policy, and the built in loops.
// The browser checks (loops, pauses, falls back, CPU): tests/test_design_video_browser.mjs.
// Run: node tests/test_design_video.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
function sandbox(search) {
  const sb = {
    location: { search: search || "", origin: "http://tv" },
    document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, removeAttribute: noop }, addEventListener: noop },
    innerWidth: 1920, innerHeight: 1080, setTimeout, clearTimeout, atob: (s) => Buffer.from(s, "base64").toString("latin1"),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, COUCH_CONFIG: {}
  };
  sb.window = sb;
  sb.parent = search ? {} : sb;   // the designer's preview sits in a frame
  sb.addEventListener = noop;
  vm.createContext(sb);
  for (const f of ["designer-gate.js", "bg-video.js", "design.js", "qr.js", "share-home.js", "design-code.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), sb);
  return sb;
}
const sb = sandbox(""), CD = sb.CouchDesign, V = sb.CouchVideo, C = sb.CouchDesignCode, S = sb.CouchShare, G = sb.CouchDesigner;
const plain = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running video background tests...");

const b64 = (buf) => Buffer.from(buf).toString("base64");
const JPEG = "data:image/jpeg;base64," + b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const ID = "Vk3s9QpL2mXc7RtY8uWz";
const bg = (b, cd) => plain((cd || CD).sanitize({ background: b })).background || {};
const notes = (b) => CD.check({ background: b }).notes;

// 1. the gate: what a design may name
let o = bg({ image: "backgrounds/loop-rain.jpg", video: "backgrounds/loop-rain.mp4" });
ok(o.video === "backgrounds/loop-rain.mp4" && o.image === "backgrounds/loop-rain.jpg", "a built in loop with its still picture: kept");
ok(bg({ image: JPEG, video: "store:" + ID }).video === "store:" + ID, "a video the store keeps (store:<id>): kept");
ok(bg({ image: JPEG, video: "backgrounds/mine/our-beach.webm" }).video === "backgrounds/mine/our-beach.webm", "the household's own clip on this TV: kept");
for (const bad of ["https://example.com/a.mp4", "http://127.0.0.1/a.mp4", "//example.com/a.mp4", "backgrounds/../secret.mp4", "backgrounds/a.mov",
  "data:video/mp4;base64,AAAAIGZ0eXBpc29t", "javascript:alert(1)", "store:short", "store:" + ID + "/../x", "file:///sdcard/a.mp4", "blob:http://tv/0b5c1c4e-3d9a-4f1e-9a55-1f2e3d4c5b6a", 42, { src: "x.mp4" }]) {
  ok(bg({ image: JPEG, video: bad }).video === undefined, "refused: " + JSON.stringify(bad));
}
ok(/not allowed/.test(notes({ image: JPEG, video: "https://example.com/a.mp4" }).join(" ")), "a refused video says so in the notes");
o = bg({ video: "backgrounds/loop-rain.mp4" });
ok(o.video === undefined && /needs its still picture/.test(notes({ video: "backgrounds/loop-rain.mp4" }).join(" ")), "no still picture: the video is left out, and the notes say why");
o = bg({ image: JPEG, video: "backgrounds/loop-fire.mp4", blur: 10 });
ok(o.video && o.blur === undefined, "with a video the blur is taken off (it would blur every frame)");
ok(bg({ image: JPEG, blur: 10 }).blur === 10, "a photo without a video keeps its blur");
o = bg({ image: "backgrounds/loop-clouds.jpg", video: "backgrounds/loop-clouds.mp4", depth: true });
ok(o.depth === true, "the clouds loop's still picture has hills: depth may be on");
ok(bg({ image: "backgrounds/loop-rain.jpg", video: "backgrounds/loop-rain.mp4", depth: true }).depth === undefined, "rain has no hills: no depth");
ok(bg({ colour: "#000000", video: "backgrounds/loop-rain.mp4" }).colour === "#000000", "a plain colour with a video: the colour stays, the video goes");
// the designer's own preview may show a clip picked on that computer, by its blob: address on the same origin
const dsb = sandbox("?designer=1");
const BLOB = "blob:http://tv/0b5c1c4e-3d9a-4f1e-9a55-1f2e3d4c5b6a";
ok(bg({ image: JPEG, video: BLOB }, dsb.CouchDesign).video === BLOB, "the designer's preview: its own blob: clip is kept");
ok(bg({ image: JPEG, video: "blob:http://other/0b5c1c4e-3d9a-4f1e-9a55-1f2e3d4c5b6a" }, dsb.CouchDesign).video === undefined, "the designer's preview: a blob: from another origin is refused");
ok(bg({ image: JPEG, video: BLOB }).video === undefined, "on a TV a blob: video is refused");

// 2. a design got by code: only store:<id> or a built in loop, never inside the answer, only with a picture
const got = (b) => (C.accept(JSON.stringify({ design: { v: 1, background: b } })) || {}).background || {};
ok(got({ image: JPEG, video: "store:" + ID }).video === "store:" + ID, "from the store: store:<id> kept");
ok(got({ image: "backgrounds/loop-ocean.jpg", video: "backgrounds/loop-ocean.mp4" }).video === "backgrounds/loop-ocean.mp4", "from the store: a built in loop kept");
ok(got({ image: JPEG, video: "https://cdn.example.com/v.mp4" }).video === undefined, "from the store: a link refused");
ok(got({ image: JPEG, video: "data:video/mp4;base64,AAAAGGZ0eXBtcDQy" }).video === undefined, "from the store: a video inside the answer refused");
ok(got({ video: "store:" + ID }).video === undefined, "from the store: no picture, no video");
ok(got({ image: JPEG, video: "backgrounds/mine/x.mp4" }).video === undefined, "from the store: a household path refused");

// 3. Share this home: only a built in loop goes, with its built in picture
const share = (b) => (S.prepare({ design: { v: 1, background: b, texts: [{ text: "Hi" }] } }, [], CD).design || {}).background || {};
ok(share({ image: "backgrounds/loop-fire.jpg", video: "backgrounds/loop-fire.mp4" }).video === "backgrounds/loop-fire.mp4", "share: a built in loop goes with its picture");
ok(share({ image: JPEG, video: "store:" + ID }).video === undefined, "share: a store video stays behind (with the household photo)");
ok(share({ image: "backgrounds/loop-fire.jpg", video: "store:" + ID }).video === undefined, "share: a store video stays behind even with a built in picture");
ok(share({ image: "backgrounds/mine/a.jpg", video: "backgrounds/mine/a.mp4" }).video === undefined, "share: the household's own clip stays behind");

// 4. the bytes
const u32 = (x) => { const b = Buffer.alloc(4); b.writeUInt32BE(x); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type), body]); };
function mp4({ seconds = 10, w = 1280, h = 720, codec = "avc1", moovFirst = true, v1 = false } = {}) {
  const ftyp = box("ftyp", Buffer.from("isom"), u32(512), Buffer.from("isomiso2avc1mp41"));
  const mvhd = v1 ? box("mvhd", Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(1000), u32(0), u32(seconds * 1000), Buffer.alloc(80))
    : box("mvhd", Buffer.from([0, 0, 0, 0]), Buffer.alloc(8), u32(1000), u32(seconds * 1000), Buffer.alloc(80));
  const tkhd = box("tkhd", Buffer.from([0, 0, 0, 3]), Buffer.alloc(72), u32(w * 65536), u32(h * 65536));
  const hdlr = box("hdlr", Buffer.alloc(8), Buffer.from("vide"), Buffer.alloc(13));
  const stsd = box("stsd", Buffer.alloc(4), u32(1), box(codec, Buffer.alloc(78)));
  const trak = box("trak", tkhd, box("mdia", hdlr, box("minf", box("stbl", stsd))));
  const moov = box("moov", mvhd, trak), mdat = box("mdat", Buffer.alloc(2000, 7));
  return new Uint8Array(moovFirst ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]));
}
let r = V.sniff(mp4());
ok(r.ok && r.type === "video/mp4" && r.codec === "h264" && r.seconds === 10 && r.w === 1280 && r.h === 720, "MP4 H.264, 10 s, 1280x720: passes " + JSON.stringify(r));
ok(V.sniff(mp4({ moovFirst: false })).ok, "MP4 with its index at the end: still read (it is played from memory)");
ok(V.sniff(mp4({ v1: true, seconds: 12 })).seconds === 12, "MP4 with a 64 bit header: its length is read");
ok(V.sniff(mp4({ w: 1920, h: 1080 })).ok, "1920x1080: passes");
r = V.sniff(mp4({ w: 1920, h: 1080 }), { h: 720 });
ok(!r.ok && /too big a picture/.test(r.why), "the 720p copy at 1920x1080: refused");
r = V.sniff(mp4({ w: 3840, h: 2160 }));
ok(!r.ok && /too big a picture/.test(r.why), "4K: refused (" + r.why + ")");
r = V.sniff(mp4({ seconds: 20 }));
ok(!r.ok && /too long/.test(r.why), "20 s: refused (" + r.why + ")");
ok(V.sniff(mp4({ seconds: 15 })).ok, "15 s: passes");
r = V.sniff(mp4({ codec: "hvc1" }));
ok(!r.ok && /H\.264/.test(r.why), "HEVC in an MP4: refused (" + r.why + ")");
ok(!V.sniff(mp4({ codec: "av01" })).ok, "AV1 in an MP4: refused");
r = V.sniff(new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)])));
ok(!r.ok && r.why === "not a video", "a JPEG called a video: refused");
r = V.sniff(new Uint8Array(Buffer.from("<html><body>hello</body></html>" + " ".repeat(40))));
ok(!r.ok, "a web page called a video: refused");
const whole = mp4();
r = V.sniff(whole.slice(0, 60));
ok(!r.ok && /whole|not a video/.test(r.why), "a cut off MP4 with no index: refused (" + r.why + ")");
const big = new Uint8Array(8 * 1024 * 1024 + 1); big.set(mp4());
r = V.sniff(big);
ok(!r.ok && /too big/.test(r.why), "over 8 MB: refused (" + r.why + ")");
const mid = new Uint8Array(5 * 1024 * 1024); mid.set(mp4());
ok(V.sniff(mid).ok && !V.sniff(mid, { h: 720 }).ok, "5 MB: fine for the 1080p copy, too big for the 720p copy");
// an official design's long loop from the store (opts.long): up to 4 minutes, 24 MB (16 MB at 720p)
ok(V.sniff(mp4({ seconds: 196 }), { long: true }).ok && !V.sniff(mp4({ seconds: 196 })).ok, "a 3:16 loop: passes from the store, refused as a 15 s copy");
r = V.sniff(mp4({ seconds: 241 }), { long: true });
ok(!r.ok && /at most 240 s/.test(r.why), "over 4 minutes: refused even from the store (" + r.why + ")");
const lbig = new Uint8Array(20 * 1024 * 1024); lbig.set(mp4({ seconds: 196, w: 1920, h: 1080 }));
ok(V.sniff(lbig, { long: true }).ok && !V.sniff(lbig, { long: true, h: 720 }).ok && !V.sniff(lbig).ok, "20 MB: fine for the long 1080p loop, too big at 720p (16 MB) or as a 15 s copy");
ok(!V.sniff(mp4({ seconds: 60, w: 3840, h: 2160 }), { long: true }).ok, "a long loop is still at most 1920x1080");
ok(V.LIMIT.long.memory === 2 && V.LIMIT.long.fetchMs >= 120000, "the long loop: only on 2 GB TVs or more, with minutes to arrive");

// WebM, built element by element
const vintSize = (n) => { const b = Buffer.alloc(8); b[0] = 0x01; b.writeUIntBE(n, 2, 6); return b; };
const el = (id, body) => Buffer.concat([Buffer.from(id), vintSize(body.length), body]);
const f64 = (x) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b; };
function webm({ doc = "webm", codec = "V_VP9", ms = 9000, w = 1280, h = 720 } = {}) {
  const head = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([el([0x42, 0x82], Buffer.from(doc))]));
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), el([0x44, 0x89], f64(ms))]));
  const video = el([0xe0], Buffer.concat([el([0xb0], Buffer.from([w >> 8, w & 255])), el([0xba], Buffer.from([h >> 8, h & 255]))]));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], Buffer.concat([el([0x86], Buffer.from(codec)), video])));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], Buffer.alloc(500, 3));
  return new Uint8Array(Buffer.concat([head, el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks, cluster]))]));
}
r = V.sniff(webm());
ok(r.ok && r.type === "video/webm" && r.codec === "vp9" && Math.abs(r.seconds - 9) < 0.01 && r.w === 1280 && r.h === 720, "WebM VP9, 9 s, 1280x720: passes " + JSON.stringify(r));
ok(V.sniff(webm({ codec: "V_VP8" })).codec === "vp8", "WebM VP8: passes");
r = V.sniff(webm({ codec: "V_AV1" }));
ok(!r.ok && /VP8 or VP9/.test(r.why), "WebM AV1: refused (" + r.why + ")");
ok(!V.sniff(webm({ ms: 20000 })).ok, "WebM 20 s: refused");
ok(!V.sniff(webm({ doc: "matroska" })).ok, "Matroska that is not WebM: refused");
ok(!V.sniff(webm({ w: 2560, h: 1440 })).ok, "WebM 2560x1440: refused");

// 5. which TVs keep the still picture, and which copy the others ask for
const T = (e) => V.tier(e);
ok(T({ lighter: true, memory: 8, screenPx: 3840 }) === "still", "Lighter home: the still picture");
ok(T({ powerSave: true }) === "still" && /saving power/.test(V.tierWhy({ powerSave: true }).why), "power save: the still picture, and it says why");
ok(T({ saveData: true }) === "still" && T({ reducedMotion: true }) === "still", "data saver or less motion: the still picture");
ok(T({ memory: 1 }) === "still", "1 GB of memory (a Slow TV): the still picture");
ok(T({ slow: true }) === "still", "a TV that dropped frames last week: the still picture");
ok(T({}) === "720" && T({ memory: 2, screenPx: 1920 }) === "720", "unknown, or an Everyday TV: the 720p copy");
ok(T({ memory: 4, screenPx: 1920 }) === "1080" && T({ memory: 8, screenPx: 3840 }) === "1080", "4 GB and a 1080p screen or more: the 1080p copy");
ok(T({ memory: 8, screenPx: 1280 }) === "720", "a 720p screen: the 720p copy");
ok(T({ designer: true, lighter: true }) === "1080", "the designer's preview always plays");

// 6. the speed meter and the TV's own budget
const costOf = (d) => CD.cost(d).filter((i) => i[2] === "bgvideo");
ok(costOf({ background: { image: JPEG, video: "backgrounds/loop-rain.mp4" } })[0][1] === 24, "the speed list names the video background (24)");
ok(!costOf({ background: { image: JPEG } }).length, "a photo alone: no video cost");
const heavy = { v: 1, background: { image: JPEG, video: "backgrounds/loop-rain.mp4" }, home: { ambient_weather: true, clock_style: "liquid", glass_amount: 5 },
  objects: Array.from({ length: 8 }, (_, i) => ({ id: "w" + i, type: "widget", kind: "slideshow", x: 80 + (i % 4) * 420, y: 60 + Math.floor(i / 4) * 420, w: 400, h: 400 })) };
const c = CD.check(heavy);
ok(c.clean.background.image && !c.clean.background.video && c.notes.some((t) => /video background was switched off/.test(t)), "over the TV's budget: the video goes after rain and snow, its still picture stays");
const light = CD.check({ v: 1, background: { image: JPEG, video: "backgrounds/loop-rain.mp4" } });
ok(light.clean.background.video === "backgrounds/loop-rain.mp4", "a light design keeps its video");

// 7. the page policy: videos only from this page, memory, the store and this TV's own video link
const pol = G.policy({ media: C.mediaSources("https://videos.example.org/clip.mp4") });
ok(pol.indexOf("media-src 'self' blob: " + G.DEFAULT_STORE + " https://videos.example.org;") >= 0, "the policy's media-src: this page, blob:, the store and the TV's own link (" + pol.match(/media-src [^;]*/)[0] + ")");
ok(!/media-src[^;]*https:;/.test(pol) && !/media-src[^;]* https: /.test(pol), "no longer any https host for videos");
ok(G.policy({ media: ["javascript:", "*"] }) === G.policy() && G.policy("") === G.POLICY && G.policy().indexOf("media-src 'self' blob: https:;") >= 0, "no list, or only bad entries: the policy as it was (fonts aside)");
ok(/media-src 'self' blob:;/.test(G.policy({ media: ["'self'", "blob:", "data:", "https://a.b/c"] })), "data: and a path are not origins: left out");

// 8. the built in loops are on disk, pass the byte check, and have their still pictures
for (const L of V.LOOPS) {
  const file = path.join(web, L.video), pic = path.join(web, L.image);
  ok(fs.existsSync(file) && fs.existsSync(pic), L.id + ": video and still picture are there");
  const s = V.sniff(new Uint8Array(fs.readFileSync(file)), { h: 720 });
  ok(s.ok && s.codec === "h264" && s.w === 1280 && s.h === 720 && s.seconds >= 9.9 && s.seconds <= 15, L.id + ": H.264 1280x720 " + s.seconds + " s, " + Math.round(fs.statSync(file).size / 1024) + " KB, passes the 720p check");
  const head = fs.readFileSync(pic).subarray(0, 3);
  ok(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, L.id + ": the still picture is a JPEG");
  ok(bg({ image: L.image, video: L.video, depth_image: L.depth_image }).video === L.video, L.id + ": the gate keeps it");
  ok(/^[A-Z]/.test(L.name) && L.name.length < 30, L.id + ": named for the designer (" + L.name + ")");
  if (L.depth_image) {
    const p = fs.readFileSync(path.join(web, L.depth_image));
    ok(p.subarray(1, 4).toString() === "PNG" && p[25] === 6, L.id + ": the hills cut out is a PNG with see through parts");
  }
}
ok(V.LOOPS.length >= 3 && V.LOOPS.length <= 5, "between three and five built in loops (" + V.LOOPS.length + ")");
ok(fs.readFileSync(path.join(web, "backgrounds/CREDITS.md"), "utf8").includes("loop-rain.mp4"), "CREDITS.md says where the loops come from");

console.log(`OK ${n} video background checks`);
