// A design's background as a short looping video (background.video), for design.js.
//
// What a design may carry: background.image (its still picture, required: shown first, and kept on
// slow TVs, in power save, or when the video cannot play) and background.video, one of
//   - "backgrounds/<name>.mp4" or ".webm": a file on this TV (the built in loops below, or the
//     household's own in backgrounds/mine/);
//   - "store:<id>": a video kept by the design store this TV already uses (config.json
//     design_store, else Couch TV Studio's own). The TV asks only that store, by id, never a link;
//   - "blob:<this page>/<uuid>": only in Couch TV Studio's own preview (?designer=1), for a clip
//     picked on that computer and not uploaded yet.
// Anything else (http, https, data:, //host, ../) is dropped, like a photo's link.
//
// A video from the store is fetched whole (no cookies, no referrer, no redirects), checked by its
// own bytes (an MP4 with H.264, or a WebM with VP8 or VP9; at most 15 s, 1920x1080 and 8 MB, or
// 1280x720 and 4 MB for the 720p copy) and played from memory (a blob: address). Every video is also
// checked again once it loads (its length and size), and watched for a few seconds: a TV that drops
// a quarter of its frames goes back to the still picture and remembers that for a week.
//
// An official gallery design's video may also have a long seamless loop (up to 4 minutes, 16 MB at
// 720p and 24 MB at 1080p; the store keeps those for official listings only). A TV with 2 GB of
// memory or more asks for it (?h=l720 or ?h=l1080); a store without one answers the 15 s copy, and if
// the long one cannot be fetched in time the TV asks for the 15 s copy instead. Once a store video
// has played, the TV keeps it on its own storage (IndexedDB, one video only, the design's current
// one), so the next start, and every one after, plays it without asking the store again.
//
// While an app is in front, the screen saver or the ambient clock is up, or the screen is off, the
// video stops and lets go of the TV's decoder (the app in front may need it); it starts again from
// memory when the home comes back.
(function () {
  "use strict";

  var LIMIT = { seconds: 15, slack: 0.5, bytes: 8 * 1024 * 1024, w: 1920, h: 1080,
    bytes720: 4 * 1024 * 1024, w720: 1280, h720: 720, startMs: 12000, fetchMs: 20000, dropAt: 0.25, slowDays: 7,
    // an official design's long loop from the store: longer, bigger, more time to fetch (once)
    long: { seconds: 240, bytes: 24 * 1024 * 1024, bytes720: 16 * 1024 * 1024, fetchMs: 180000, memory: 2 } };
  // the built in loops: drawn from code for couch-tv (tv-home/tools/loops), 1280x720, 10 s, H.264
  var LOOPS = [
    { id: "rain", name: "Rain on glass", video: "backgrounds/loop-rain.mp4", image: "backgrounds/loop-rain.jpg" },
    { id: "fire", name: "Fireplace", video: "backgrounds/loop-fire.mp4", image: "backgrounds/loop-fire.jpg" },
    { id: "ocean", name: "Ocean at dusk", video: "backgrounds/loop-ocean.mp4", image: "backgrounds/loop-ocean.jpg" },
    { id: "clouds", name: "Clouds over the hills", video: "backgrounds/loop-clouds.mp4", image: "backgrounds/loop-clouds.jpg", depth_image: "backgrounds/loop-clouds-fg.png" }
  ];
  var SLOW_KEY = "couchtv.video.slow";

  // ---------------------------------------------------------------- what a design may name
  function storeId(u) { var m = /^store:([A-Za-z0-9_-]{16,64})$/.exec(typeof u === "string" ? u : ""); return m ? m[1] : ""; }
  function localOk(u) {
    return typeof u === "string" && u.length < 300 && /^backgrounds\/[A-Za-z0-9_][A-Za-z0-9_./-]*\.(mp4|webm)$/i.test(u) && u.indexOf("..") < 0 && u.indexOf("//") < 0;
  }
  // opts: { designer: the designer's own preview, origin: this page's origin }
  function refOk(u, opts) {
    opts = opts || {};
    if (typeof u !== "string") return "";
    if (localOk(u) || storeId(u)) return u;
    if (opts.designer && opts.origin && u.indexOf("blob:" + opts.origin + "/") === 0 && /^[0-9a-f-]{36}$/i.test(u.slice(opts.origin.length + 6))) return u;
    return "";
  }

  // ---------------------------------------------------------------- the bytes themselves
  function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  function fourcc(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }
  // the boxes of an MP4 between start and end: [{type, start (of the content), end}]
  function boxes(b, start, end) {
    var out = [], i = start;
    while (i + 8 <= end && out.length < 4000) {
      var size = u32(b, i), type = fourcc(b, i + 4), head = 8;
      if (size === 1) { if (i + 16 > end) break; size = u32(b, i + 8) * 4294967296 + u32(b, i + 12); head = 16; }
      else if (size === 0) size = end - i;
      if (size < head || i + size > end) { out.push({ type: type, start: i + head, end: end, cut: true }); break; }
      out.push({ type: type, start: i + head, end: i + size });
      i += size;
    }
    return out;
  }
  function child(b, box, type) { var l = boxes(b, box.start, box.end); for (var k = 0; k < l.length; k++) if (l[k].type === type) return l[k]; return null; }
  function mp4(b) {
    var top = boxes(b, 0, b.length), r = { type: "video/mp4", codec: "", seconds: 0, w: 0, h: 0 };
    if (!top.length || top[0].type !== "ftyp") return { why: "not a video" };
    var moov = null, k;
    for (k = 0; k < top.length; k++) if (top[k].type === "moov") { moov = top[k]; break; }
    if (!moov || moov.cut) return { why: "not a whole video" };
    var mvhd = child(b, moov, "mvhd");
    if (mvhd) {
      var v1 = b[mvhd.start] === 1, ts = u32(b, mvhd.start + (v1 ? 20 : 12)), du = v1 ? u32(b, mvhd.start + 24) * 4294967296 + u32(b, mvhd.start + 28) : u32(b, mvhd.start + 16);
      if (ts) r.seconds = du / ts;
    }
    boxes(b, moov.start, moov.end).forEach(function (trak) {
      if (trak.type !== "trak") return;
      var mdia = child(b, trak, "mdia"), hdlr = mdia && child(b, mdia, "hdlr");
      if (!hdlr || fourcc(b, hdlr.start + 8) !== "vide") return;
      var tkhd = child(b, trak, "tkhd");
      if (tkhd) { var o = b[tkhd.start] === 1 ? 88 : 76; r.w = Math.max(r.w, u32(b, tkhd.start + o) / 65536); r.h = Math.max(r.h, u32(b, tkhd.start + o + 4) / 65536); }
      var minf = child(b, mdia, "minf"), stbl = minf && child(b, minf, "stbl"), stsd = stbl && child(b, stbl, "stsd");
      if (stsd && !r.codec) { var e = boxes(b, stsd.start + 8, stsd.end)[0]; if (e) r.codec = e.type; }
    });
    if (!r.codec) return { why: "no picture in it" };
    if (r.codec !== "avc1" && r.codec !== "avc3") return { why: "an MP4 must be H.264 (this one is " + r.codec.trim() + ")" };
    r.codec = "h264";
    return r;
  }
  // WebM (EBML): the header's DocType, then Segment > Info (timecode scale, duration) and
  // Segment > Tracks > TrackEntry (codec id, pixel width and height); it stops at the first Cluster
  function vint(b, i, keepMarker) {
    var first = b[i], len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || i + len > b.length) return null;
    var v = keepMarker ? first : first & (mask - 1), all = (first & (mask - 1)) === mask - 1;
    for (var k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) all = false; }
    return { v: v, len: len, unknown: !keepMarker && all };
  }
  function ebml(b, start, end, visit) {
    var i = start, n = 0;
    while (i < end && n++ < 20000) {
      var id = vint(b, i, true); if (!id) return;
      var sz = vint(b, i + id.len, false); if (!sz) return;
      var s = i + id.len + sz.len, e = sz.unknown ? end : Math.min(end, s + sz.v);
      if (visit(id.v, s, e) === false) return;
      i = e;
    }
  }
  function webm(b) {
    if (!(b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)) return { why: "not a video" };
    var r = { type: "video/webm", codec: "", seconds: 0, w: 0, h: 0 }, doc = "", scale = 1000000, dur = 0;
    var str = function (s, e) { var o = ""; for (var k = s; k < e && k < s + 32; k++) if (b[k]) o += String.fromCharCode(b[k]); return o; };
    var uint = function (s, e) { var v = 0; for (var k = s; k < e; k++) v = v * 256 + b[k]; return v; };
    var flt = function (s, e) { var dv = new DataView(b.buffer, b.byteOffset + s, e - s); return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : 0; };
    var MASTER = { 0x1a45dfa3: 1, 0x18538067: 1, 0x1549a966: 1, 0x1654ae6b: 1, 0xae: 1, 0xe0: 1 };
    var walk = function (s, e, inTrack) {
      ebml(b, s, e, function (id, cs, ce) {
        if (id === 0x1f43b675) return false;   // a Cluster: the pictures start, the header is done
        if (id === 0x4282) doc = str(cs, ce);
        else if (id === 0x2ad7b1) scale = uint(cs, ce) || scale;
        else if (id === 0x4489) dur = flt(cs, ce);
        else if (id === 0x86 && inTrack && !r.codec && /^V_/.test(str(cs, ce))) r.codec = str(cs, ce);
        else if (id === 0xb0) r.w = Math.max(r.w, uint(cs, ce));
        else if (id === 0xba) r.h = Math.max(r.h, uint(cs, ce));
        else if (MASTER[id]) walk(cs, ce, inTrack || id === 0xae);
      });
    };
    walk(0, b.length, false);
    if (doc !== "webm") return { why: "not a WebM video" };
    r.seconds = dur * scale / 1e9;
    if (!r.codec) return { why: "no picture in it" };
    if (r.codec !== "V_VP8" && r.codec !== "V_VP9") return { why: "a WebM must be VP8 or VP9 (this one is " + r.codec + ")" };
    r.codec = r.codec === "V_VP8" ? "vp8" : "vp9";
    return r;
  }
  // bytes: a Uint8Array of the whole file. opts.h: 720 for the smaller copy's limits. opts.long: a
  // video from the store, which may be an official design's long loop (LIMIT.long).
  // Answers { ok, type, codec, seconds, w, h } or { ok: false, why }.
  function sniff(bytes, opts) {
    opts = opts || {};
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    var L = opts.long ? LIMIT.long : LIMIT, secs = opts.long ? LIMIT.long.seconds : LIMIT.seconds;
    var small = opts.h === 720, max = small ? L.bytes720 : L.bytes;
    if (b.length < 32) return { ok: false, why: "not a video" };
    if (b.length > max) return { ok: false, why: "too big (" + (b.length / 1048576).toFixed(1) + " MB, at most " + max / 1048576 + " MB)" };
    var r = fourcc(b, 4) === "ftyp" ? mp4(b) : webm(b);
    if (r.why) return { ok: false, why: r.why };
    if (r.seconds > secs + LIMIT.slack) return { ok: false, why: "too long (" + r.seconds.toFixed(1) + " s, at most " + secs + " s)" };
    if (r.w > (small ? LIMIT.w720 : LIMIT.w) || r.h > (small ? LIMIT.h720 : LIMIT.h)) return { ok: false, why: "too big a picture (" + r.w + "x" + r.h + ")" };
    r.ok = true;
    return r;
  }

  // ---------------------------------------------------------------- what this TV should show
  // env: { stillChosen, lighter, powerSave, saveData, reducedMotion, memory (GB, navigator.deviceMemory),
  //        screenPx (screen width in device pixels), slow (this TV dropped frames last week), designer }
  // "still": the still picture only; "720" or "1080": the copy to ask the store for.
  function tier(env) {
    env = env || {};
    if (env.designer) return "1080";
    // the person chose the still picture on this TV (Home settings, Designs): kept until they turn it off
    if (env.stillChosen) return { tier: "still", why: "the still picture was chosen on this TV" };
    // Lighter home turns itself on at 1 GB, where a video design still plays (a 939 MB TCL played the
    // Aquarium video at about 27 frames a second, 0.13.10): there it keeps its other savings only
    if (env.lighter && !(env.memory >= 1 && env.memory < 2)) return { tier: "still", why: "Lighter home is on" };
    if (env.powerSave) return { tier: "still", why: "the TV is saving power" };
    if (env.saveData) return { tier: "still", why: "the TV is saving data" };
    if (env.reducedMotion) return { tier: "still", why: "the TV asks for less motion" };
    // under 1 GB: the still picture. A 1 GB TV plays it (a 939 MB TCL played the Aquarium video at
    // about 27 frames a second, 0.13.10), always the 720p copy, never the long loop (LIMIT.long.memory)
    if (env.memory && env.memory < 1) return { tier: "still", why: "this TV has under 1 GB of memory" };
    if (env.slow) return { tier: "still", why: "this TV could not keep up with the video" };
    return env.memory >= 4 && env.screenPx >= 1920 ? "1080" : "720";
  }
  function tierOf(env) { var t = tier(env); return typeof t === "string" ? { tier: t, why: "" } : t; }
  // The app version the "slow" mark was made on (SLOW_VER_KEY). An update can play video better (the 1 GB TCL
  // played Aquarium after 0.13.10's smaller copy), so a mark from another version is dropped and the video
  // is tried again, instead of keeping it off for the rest of the week. A page with no app behind it (a
  // browser preview, the designer) has no version and keeps the week as before.
  var SLOW_VER_KEY = "couchtv.video.slow.ver";
  function appVersion() {
    try { var T = window.TVOS; return T && T.version ? String(T.version() || "") : ""; } catch (e) { return ""; }
  }
  function markSlow(now) {
    try {
      localStorage.setItem(SLOW_KEY, String(now || Date.now()));
      var v = appVersion();
      if (v) localStorage.setItem(SLOW_VER_KEY, v); else localStorage.removeItem(SLOW_VER_KEY);
    } catch (e) {}
  }
  function slowMarked(now) {
    try {
      var at = Number(localStorage.getItem(SLOW_KEY));
      if (!at) return false;
      var v = appVersion(), was = localStorage.getItem(SLOW_VER_KEY) || "";
      if (v && was !== v) { localStorage.removeItem(SLOW_KEY); localStorage.removeItem(SLOW_VER_KEY); return false; }
      return (now || Date.now()) - at < LIMIT.slowDays * 86400000;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- a decoder that shows only green (g33)
  // A TCL QM8K owner saw a green screen. A video decoder that fails without an error draws its empty
  // frames as one flat green (YUV all zero: about 0,135,0 in BT.601 and 0,80,0 in BT.709). A clip that
  // plays is looked at small (32x18) after 1.5 s and again at 5 s. Only when both frames are that flat
  // green (red and blue at most 24, green 60 to 160 and within 16 across the frame, on 95% of pixels) and
  // the two frames match, the clip goes and the still picture stays; real footage (leaves, grass, a dark
  // garden) has red and blue in it and is never this flat. The home's own clips (the video link, a scene's
  // clip) are then not tried on this TV for a week, or until Home settings, Look, Try the video again.
  // A design's video only goes for this time (SLOW_KEY's week is for dropped frames only). A page that
  // may not read the frame (another site's clip) is never judged green. The Loop look's clips are not
  // looked at (docs/TROUBLESHOOTING.md).
  function greenLevel(v) {
    try {
      if (!v || !(v.videoWidth > 0)) return -1;
      var c = document.createElement("canvas"); c.width = 32; c.height = 18;
      var x = c.getContext("2d"); x.drawImage(v, 0, 0, 32, 18);
      var d = x.getImageData(0, 0, 32, 18).data, n = 0, lo = 255, hi = 0, sum = 0, all = d.length / 4;
      for (var i = 0; i < d.length; i += 4) {
        var g = d[i + 1];
        if (d[i] <= 24 && d[i + 2] <= 24 && g >= 60 && g <= 160) { n++; sum += g; if (g < lo) lo = g; if (g > hi) hi = g; }
      }
      return n >= 0.95 * all && hi - lo <= 16 ? sum / n : -1;
    } catch (e) { return -1; }
  }
  function greenFrame(v) { return greenLevel(v) >= 0; }
  var GREEN_KEY = "couchtv.video.green";
  function markGreen() { try { localStorage.setItem(GREEN_KEY, String(Date.now())); } catch (e) {} }
  function clearGreen() { try { localStorage.removeItem(GREEN_KEY); } catch (e) {} }
  // the home's own clips (the video link, a scene's clip) stay off for a week after a green one
  function greenMarked(now) {
    try { var at = Number(localStorage.getItem(GREEN_KEY)); return !!at && (now || Date.now()) - at < LIMIT.slowDays * 86400000; } catch (e) { return false; }
  }
  // looks at a playing clip after 1.5 s and again at 5 s; onGreen() once if both are the same flat green.
  // opts.noMark: a design's video, which goes for now but leaves the week's mark alone
  function watchGreen(v, onGreen, opts) {
    var first = -1, src = v.getAttribute("src");
    var live = function () { return v.getAttribute("src") === src && !v.paused; };
    setTimeout(function () { if (live()) first = greenLevel(v); }, 1500);
    setTimeout(function () {
      if (first < 0 || !live()) return;
      var second = greenLevel(v);
      if (second < 0 || Math.abs(second - first) > 4) return;
      if (!(opts && opts.noMark)) markGreen();
      onGreen();
    }, 5000);
  }

  // ---------------------------------------------------------------- the player
  // host: the element the <video> goes in (design.js's #cd-bg, before its shade). o: {
  //   base(): the design store's address, env(): tier() input, onState(state, why) }
  // States: "off" (no video), "still" (this TV keeps the picture), "loading", "playing",
  // "paused" (the home is not on screen), "failed" (could not play: the picture stays).
  function player(host, o) {
    o = o || {};
    var v = null, ref = "", url = "", owned = "", state = "off", why = "", want = false, timer = null, watch = null, stuck = null, fetching = null, gen = 0, keep = null, hit = false;
    function set(s, w) { if (s === state && (w || "") === why) return; state = s; why = w || ""; if (o.onState) o.onState(state, why); }
    function el() {
      if (v) return v;
      v = document.createElement("video");
      v.className = "cd-video";
      v.muted = true; v.loop = true; v.autoplay = false; v.playsInline = true; v.preload = "auto";
      ["muted", "loop", "playsinline", "disablepictureinpicture", "disableremoteplayback"].forEach(function (a) { v.setAttribute(a, ""); });
      v.setAttribute("aria-hidden", "true");
      host.insertBefore(v, host.lastChild && host.lastChild.tagName === "B" ? host.lastChild : null);
      return v;
    }
    function release() {
      clearTimeout(timer); clearTimeout(watch); clearTimeout(stuck); timer = watch = stuck = null;
      if (v && v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); try { v.load(); } catch (e) {} }
      if (v) v.classList.remove("on");
    }
    function forget() { release(); if (owned) { try { URL.revokeObjectURL(owned); } catch (e) {} } owned = ""; url = ""; keep = null; hit = false; }
    // a kept video that no longer plays is let go, so the next start asks the store again
    function fail(w) { if (hit) cache.drop(); hit = false; keep = null; release(); set("failed", w); }
    function load(r) {
      if (r !== ref) { gen++; forget(); fetching = null; ref = r || ""; if (state === "failed") { state = "off"; why = ""; } }
      update();
    }
    function play(on) { want = !!on; update(); }
    function update() {
      if (!ref) { release(); set("off"); return; }
      if (state === "failed") return;   // the still picture stays until the design changes
      var t = tierOf(o.env ? o.env() : {});
      if (t.tier === "still") { forget(); fetching = null; set("still", t.why); return; }
      if (!want) { if (state === "playing" || state === "loading") set("paused"); release(); return; }
      if (url) { start(); return; }
      var id = storeId(ref);
      if (!id) { url = ref; start(); return; }   // a file on this TV, or the designer's own clip
      if (fetching) return;
      var base = o.base ? o.base() : "";
      if (!base || typeof fetch !== "function") { fail("no design store to ask"); return; }
      var g = gen, h = t.tier === "1080" ? 1080 : 720, env = o.env ? o.env() : {};
      // the long loop only where it fits: 2 GB of memory or more (a TV that does not say asks for the 15 s copy)
      var long = !env.designer && env.memory >= LIMIT.long.memory, key = id + ":" + h + (long ? ":l" : "");
      set("loading");
      var got = function (blob) { if (g !== gen) return; fetching = null; owned = url = URL.createObjectURL(blob); update(); };
      var fresh = function () {
        var ask = function (l) {
          return getStore(base, id, h, l).then(function (buf) {
            var s = sniff(new Uint8Array(buf), { h: h, long: true });
            if (!s.ok) throw new Error(s.why);
            return new Blob([buf], { type: s.type });
          });
        };
        // the long loop first; if it cannot come (too slow, too big, refused), the 15 s copy
        return long ? ask(true).then(null, function (e) { if (g !== gen) throw e; return ask(false); }) : ask(false);
      };
      fetching = cache.get(key).then(function (blob) {
        if (g !== gen) return;
        if (blob) { hit = true; got(blob); return; }
        return fresh().then(function (blob) { keep = { key: key, blob: blob }; got(blob); });
      }).then(null, function (e) { if (g === gen) { fetching = null; fail(e && e.message || "could not fetch it"); } });
    }
    function start() {
      var e = el(), g = gen;
      if (e.getAttribute("src") !== url) {
        set("loading");
        e.onloadedmetadata = function () {
          if (g !== gen) return;
          var most = storeId(ref) ? LIMIT.long.seconds : LIMIT.seconds;   // the store may send an official long loop
          if (e.duration > most + LIMIT.slack && isFinite(e.duration)) fail("too long (" + e.duration.toFixed(1) + " s)");
          else if (e.videoWidth > LIMIT.w || e.videoHeight > LIMIT.h) fail("too big a picture (" + e.videoWidth + "x" + e.videoHeight + ")");
        };
        // it counts as playing once its clock really moves (a TV may say "playing" with no picture to
        // show); then a check every 2 s that it has not got stuck
        e.ontimeupdate = function () {
          if (g !== gen || state === "failed" || state === "playing" || e.paused || !(e.currentTime > 0.05)) return;
          clearTimeout(timer); timer = null;
          e.classList.add("on");
          set("playing");
          // it plays: keep it on this TV, so the next start does not ask the store again
          if (keep) { cache.put(keep.key, keep.blob); keep = null; }
          clearTimeout(watch);
          watch = setTimeout(checkFrames, 8000);
          stuckWatch(g, e.currentTime, 0);
          watchGreen(e, function () { if (g === gen) fail("this TV showed the video as green"); }, { noMark: true });
        };
        e.onerror = function () { if (g === gen) fail("this TV could not play it"); };
        e.src = url;
        clearTimeout(timer);
        timer = setTimeout(function () { if (g === gen && state !== "playing") fail("it did not start"); }, LIMIT.startMs);
      }
      var p = e.play();
      if (p && p.catch) p.catch(function () {});
    }
    function stuckWatch(g, last, n) {
      clearTimeout(stuck);
      stuck = setTimeout(function () {
        if (g !== gen || state !== "playing" || !v || v.paused) return;
        var now = v.currentTime, k = now === last ? n + 1 : 0;
        if (k >= 2) { fail("it stopped playing"); return; }
        stuckWatch(g, now, k);
      }, 2000);
    }
    // a TV that cannot keep up drops frames: then the still picture, and no video for a week
    function checkFrames() {
      if (!v || state !== "playing" || !v.getVideoPlaybackQuality) return;
      var q = v.getVideoPlaybackQuality();
      if (q.totalVideoFrames > 60 && q.droppedVideoFrames / q.totalVideoFrames > LIMIT.dropAt) {
        markSlow();
        fail("this TV could not keep up with the video");
      }
    }
    return {
      load: load, play: play, update: update,
      state: function () { return { state: state, why: why, ref: ref } },
      el: function () { return v; },
      destroy: function () { gen++; forget(); ref = ""; if (v && v.parentNode) v.parentNode.removeChild(v); v = null; set("off"); }
    };
  }
  // long: ask for an official design's long loop (?h=l720|l1080); the store answers the 15 s copy
  // when the video has none, and an older store reads it as its 720p copy
  function getStore(base, id, h, long) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, long ? LIMIT.long.fetchMs : LIMIT.fetchMs);
    return fetch(base + "/v1/assets/video/" + encodeURIComponent(id) + "?h=" + (long ? "l" : "") + h, {
      method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "the store no longer has it" : "the store said no (" + r.status + ")");
      var L = long ? LIMIT.long : LIMIT, max = h === 720 ? L.bytes720 : L.bytes, len = Number(r.headers.get("content-length"));
      if (len > max) throw new Error("too big (" + (len / 1048576).toFixed(1) + " MB)");
      return r.arrayBuffer();
    }).then(function (buf) { clearTimeout(timer); return buf; }, function (e) { clearTimeout(timer); throw e && e.name === "AbortError" ? new Error("the store was too slow") : e; });
  }

  // ---------------------------------------------------------------- the one video kept on this TV
  // IndexedDB (it works on the plain http pages the TV home runs on, where the Cache API does not),
  // one entry: the design's current store video as a Blob, which the browser keeps on disk, not in
  // memory. Any trouble (no IndexedDB, private mode, full, slow) just means asking the store again.
  var cache = (function () {
    var DB = "couchtv-video", ST = "v", MS = 3000;
    function open() {
      return new Promise(function (ok) {
        var done = false, t = setTimeout(function () { done = true; ok(null); }, MS);
        try {
          if (!window.indexedDB) { clearTimeout(t); ok(null); return; }
          var rq = window.indexedDB.open(DB, 1);
          rq.onupgradeneeded = function () { try { rq.result.createObjectStore(ST); } catch (e) {} };
          rq.onsuccess = function () { clearTimeout(t); if (done) { try { rq.result.close(); } catch (e) {} return; } done = true; ok(rq.result); };
          rq.onerror = rq.onblocked = function () { clearTimeout(t); if (!done) { done = true; ok(null); } };
        } catch (e) { clearTimeout(t); ok(null); }
      });
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        if (!db) return null;
        return new Promise(function (ok) {
          try {
            var x = db.transaction(ST, mode), out = fn(x.objectStore(ST));
            x.oncomplete = function () { db.close(); ok(out && "result" in out ? out.result : null); };
            x.onerror = x.onabort = function () { db.close(); ok(null); };
          } catch (e) { try { db.close(); } catch (e2) {} ok(null); }
        });
      });
    }
    return {
      get: function (key) { return tx("readonly", function (st) { return st.get(key); }).then(function (b) { return typeof Blob !== "undefined" && b instanceof Blob && b.size > 0 ? b : null; }, function () { return null; }); },
      // one video only: whatever was kept before goes
      put: function (key, blob) { return tx("readwrite", function (st) { st.clear(); st.put(blob, key); }).then(null, function () {}); },
      drop: function () { return tx("readwrite", function (st) { st.clear(); }).then(null, function () {}); }
    };
  })();

  window.CouchVideo = { LIMIT: LIMIT, LOOPS: LOOPS, SLOW_KEY: SLOW_KEY, SLOW_VER_KEY: SLOW_VER_KEY, markSlow: markSlow, refOk: refOk, storeId: storeId, localOk: localOk,
    sniff: sniff, tier: function (env) { return tierOf(env).tier; }, tierWhy: tierOf, slowMarked: slowMarked, player: player,
    greenFrame: greenFrame, greenLevel: greenLevel, watchGreen: watchGreen, greenMarked: greenMarked, clearGreen: clearGreen, GREEN_KEY: GREEN_KEY };
})();
