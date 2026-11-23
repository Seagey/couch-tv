// Share this home (Home settings, Designs). Turns the home this TV shows now (made on the TV,
// from the phone, the scenes or config.json, or a Couch TV Studio design) into a Couch TV Studio design,
// hands it to the design store, and shows a QR code and a short code. On a phone,
// <store>/design/?from=<code> opens it in Couch TV Studio, to change it and share or sell it.
//
// What leaves the TV is only what a design is made of: the look settings (scenes from the app's own
// set, clock, glass, Keep watching and Now playing on or off), the dock's apps by their Android
// package names, and the parts of a design that is on. Never: people's names, photos from the TV
// (an own scene or a background photo), the place or its position, Wi-Fi, addresses, the bridge,
// tokens, smart home names or entities. The result then goes through design.js's own gate
// (CouchDesign.sanitize), the store's two gates, and a last check here for anything private the
// TV knows (names, the place, addresses, links): one hit and nothing is sent.
(function () {
  "use strict";
  var PKG = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;
  var BUILT_IN_BG = /^backgrounds\/[A-Za-z0-9_][A-Za-z0-9_-]{0,80}\.(jpe?g|png|webp)$/;
  var BUILT_IN_VID = /^backgrounds\/[A-Za-z0-9_][A-Za-z0-9_-]{0,80}\.(mp4|webm)$/;
  var TIMEOUT = 15000;

  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  // a photo put in a Photo or Art frame widget (or a smart stack's) is the household's own too: it stays
  // on the TV, and the shared widget shows the photos added on the other TV
  function ownWidgetPhotos(d) {
    (Array.isArray(d.objects) ? d.objects : []).forEach(function (o) {
      [o].concat(o && Array.isArray(o.items) ? o.items : []).forEach(function (w) {
        var op = w && w.opts;
        if (op && typeof op === "object" && op.image !== undefined && !(typeof op.image === "string" && BUILT_IN_BG.test(op.image))) delete op.image;
      });
    });
  }

  // snap: what app.js knows about the home now (homeSnapshot): {
  //   scenes: [ids], builtIn: [ids of the app's own scenes], scene_seconds, clock24, clock_style,
  //   glass, glass_icons, glass_amount, ambient_weather, ambient_sun_grade, lighter, keep_watching,
  //   now_playing, dock_size, dock_style ("classic" or "mac"), moving_tiles, dock: [packages, in order],
  //   design: the design on now (or null) }
  function build(snap) {
    snap = obj(snap);
    var d;
    if (snap.design && typeof snap.design === "object") {
      d = copy(snap.design);
      // a picture of the household's own (a photo inside the design, or one in backgrounds/mine)
      // stays on the TV: the scenes show behind the design instead
      var bg = obj(d.background);
      if (bg.image !== undefined && !(typeof bg.image === "string" && BUILT_IN_BG.test(bg.image))) delete bg.image;
      // its cut out (depth_image) is a picture of that photo too: it goes with it
      if (bg.depth_image !== undefined && !(bg.image && typeof bg.depth_image === "string" && BUILT_IN_BG.test(bg.depth_image))) delete bg.depth_image;
      // a video background goes only when it is a built in loop with its still picture: the
      // household's own clip, or one from the store, stays where it is
      if (bg.video !== undefined && !(bg.image && typeof bg.video === "string" && BUILT_IN_VID.test(bg.video))) delete bg.video;
      if (d.background && !Object.keys(bg).length) delete d.background;
      // smart home controls name this house's own devices
      (Array.isArray(d.objects) ? d.objects : []).forEach(function (o) { if (o && typeof o === "object") { delete o.entity; delete o.entities; } });
      ownWidgetPhotos(d);
    } else {
      var home = {};
      var built = Array.isArray(snap.builtIn) ? snap.builtIn : [];
      var scenes = (Array.isArray(snap.scenes) ? snap.scenes : []).filter(function (id) { return built.indexOf(id) >= 0; });
      if (scenes.length) home.scenes = scenes;
      if (snap.scene_seconds > 0) home.scene_seconds = Math.round(snap.scene_seconds);
      ["glass", "clock_style"].forEach(function (k) { if (typeof snap[k] === "string") home[k] = snap[k]; });
      ["glass_icons", "ambient_weather", "ambient_sun_grade", "lighter", "keep_watching", "now_playing", "moving_tiles"].forEach(function (k) { if (typeof snap[k] === "boolean") home[k] = snap[k]; });
      // the Night dock's style (classic, or the Mac-style wave)
      if (snap.dock_style === "mac" || snap.dock_style === "classic") home.dock = snap.dock_style;
      if (snap.glass_amount > 0) home.glass_amount = snap.glass_amount;
      if (snap.dock_size > 0) home.dock_size = snap.dock_size;
      if (typeof snap.clock24 === "boolean") home.clock = snap.clock24 ? "24h" : "12h";
      d = { v: 1, home: home };
      // the dock's apps as catalogue ids (app-catalogue.js): an app not in the catalogue never leaves the
      // TV, so a shared home cannot tell anyone which unusual apps this household has installed
      var AC = typeof window !== "undefined" && window.CouchApps;
      var dock = (Array.isArray(snap.dock) ? snap.dock : []).map(function (p) {
        return typeof p === "string" && PKG.test(p) && p.indexOf("local.") !== 0 && AC ? AC.idOf(p) : null;
      }).filter(function (p, i, a) { return p && a.indexOf(p) === i; }).slice(0, 10);
      if (dock.length) d.apps = { order: dock };
      d.elements = { clock: { format: snap.clock24 ? "24h" : "12h" } };
      if (snap.keep_watching === false) d.elements.keep_watching = { hidden: true };
    }
    return d;
  }

  // anything private this TV knows, found anywhere in the design's words: names, the place, its
  // position, addresses, links, e-mail. secrets: [strings] (people's names, the place, the bridge)
  function privateHits(design, secrets) {
    var text = JSON.stringify(design || {}), low = text.toLowerCase(), hits = [];
    (secrets || []).forEach(function (s) {
      s = String(s || "").trim().toLowerCase();
      if (s.length >= 3 && low.indexOf(s) >= 0) hits.push("name");
    });
    if (/\b(\d{1,3}\.){3}\d{1,3}\b/.test(text)) hits.push("address");
    if (/(https?|ftp|file|javascript|data):|\/\/|\.ics\b/i.test(text)) hits.push("link");
    if (/[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i.test(text)) hits.push("email");
    if (/\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i.test(text)) hits.push("hardware address");
    // a key or a token (a Home Assistant long-lived token is a JWT, eyJ...; a bearer header; a long run
    // of letters and digits): never shared, even if the TV's own gate were not there
    if (/eyJ[A-Za-z0-9_-]{10,}|\bbearer\s|home.?assistant.?token|long.?lived/i.test(text) ||
      (text.match(/[A-Za-z0-9_-]{40,}/g) || []).some(function (r) { return /\d/.test(r) && /[a-z]/i.test(r); })) hits.push("key");
    return hits.filter(function (h, i, a) { return a.indexOf(h) === i; });
  }

  // the whole way: build, the TV's own gate, the private check. Returns { design } or { error }.
  function prepare(snap, secrets, gate) {
    var d = build(snap);
    if (gate && typeof gate.sanitize === "function") d = gate.sanitize(d);
    d = copy(d);
    // the gate keeps a design's own background picture; a household photo never goes
    var bg = obj(d.background);
    if (bg.image !== undefined && !(typeof bg.image === "string" && BUILT_IN_BG.test(bg.image))) delete bg.image;
    if (bg.depth_image !== undefined && !(bg.image && typeof bg.depth_image === "string" && BUILT_IN_BG.test(bg.depth_image))) delete bg.depth_image;
    if (bg.video !== undefined && !(bg.image && typeof bg.video === "string" && BUILT_IN_VID.test(bg.video))) delete bg.video;
    if (d.background && !Object.keys(bg).length) delete d.background;
    ownWidgetPhotos(d);
    var keys = Object.keys(d).filter(function (k) { return k !== "v"; });
    if (!keys.length) return { error: "There is nothing on this home to share yet." };
    var hits = privateHits(d, secrets);
    if (hits.length) return { error: "This home has something private in it (" + hits.join(", ") + "), so it was not shared." };
    return { design: d };
  }

  var MSG = {
    offline: "Could not reach Couch TV Studio. Check the TV is online, then try again.",
    slow: "Too many shares from this home for now. Try again in an hour.",
    refused: "Couch TV Studio could not take this home. Try again later.",
    off: "Sharing is not switched on at Couch TV Studio yet. Try again after the next update."
  };
  function fail(k) { var e = new Error(MSG[k]); e.kind = k; return e; }

  // to the store: POST <base>/v1/shares {design}; nothing else goes with it (no cookies, no referrer)
  function send(base, design, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!base || !fetchFn) return Promise.reject(fail("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetchFn(base + "/v1/shares", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ design: design }), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 429 || r.status === 503) throw fail("slow");
      if (r.status === 404 || r.status === 405) throw fail("off");
      if (!r.ok) throw fail("refused");
      return r.json();
    }, function () { clearTimeout(timer); throw fail("offline"); }).then(function (j) {
      var code = j && typeof j.code === "string" && /^[2-9A-HJ-NP-TV-Z]{5}-[2-9A-HJ-NP-TV-Z]{5}$/.test(j.code) ? j.code : "";
      var token = j && typeof j.token === "string" && /^CTV1-[A-Za-z0-9_-]{43}$/.test(j.token) ? j.token : "";
      if (!code || !token) throw fail("refused");
      // Couch TV Studio's own store: the link goes to its website's address (the store's old address only
      // forwards there); a store named in config.json is its own website
      var G = window.CouchDesigner, site = G && G.STUDIO_SITE && base === G.DEFAULT_STORE ? G.STUDIO_SITE : base;
      return { code: code, token: token, link: site + "/design/?from=" + token, page: site.replace(/^https:\/\//, "") + "/design" };
    });
  }

  // ---- on screen: the QR, the short code, and how to open it ----
  var box = null;
  // opts.back: this screen also has the TV's phone inbox open (app.js shareHome), so the phone's Send to my
  // TV comes straight back while it stays open
  function show(res, opts) {
    close();
    box = document.createElement("div");
    box.className = "share-home";
    box.setAttribute("role", "dialog");
    box.setAttribute("style", "position:fixed;top:0;right:0;bottom:0;left:0;z-index:1000;display:flex;align-items:center;justify-content:center;gap:5rem;padding:5rem;background:#08090c;color:#fff;font-family:Inter, sans-serif");
    var qr = document.createElement("div");
    qr.setAttribute("style", "flex:none;padding:1.25rem;border-radius:1.5rem;background:#fff");
    try { qr.appendChild(window.TVQR.svg(res.link, 420)); } catch (e) { qr.style.display = "none"; }
    var col = document.createElement("div");
    col.setAttribute("style", "max-width:46rem");
    var line = function (txt, css) { var n = document.createElement("div"); n.textContent = txt; n.setAttribute("style", css); col.appendChild(n); return n; };
    line("Open this home in Couch TV Studio", "font-size:3rem;line-height:3.75rem;font-weight:700");
    line("Point your phone's camera at the code. Or go to " + res.page + " and type this code:", "margin-top:1.25rem;font-size:1.75rem;line-height:2.375rem;color:rgba(255,255,255,0.82)");
    line(res.code, "margin-top:1.5rem;font-size:4.5rem;font-weight:700;letter-spacing:0.08em;font-variant-numeric:tabular-nums");
    if (opts && opts.back) line("Change it on your phone, then press Send to my TV there: it comes straight back to this TV, which asks you before it changes anything. Keep this screen open until then.", "margin-top:1.25rem;font-size:1.75rem;line-height:2.375rem;color:#fff;font-weight:600");
    line("The code works once, for 30 minutes. Only the look and your apps left this TV. People's names, photos, places, smart home keys, AI keys and calendar links stay here.", "margin-top:1.5rem;font-size:1.5rem;line-height:2.125rem;color:rgba(255,255,255,0.66)");
    line("Press Back or OK to close.", "margin-top:1.5rem;font-size:1.4375rem;color:rgba(255,255,255,0.6)");
    box.appendChild(qr);
    box.appendChild(col);
    document.body.appendChild(box);
    window.addEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (!box) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var k = e.key;
    if (k === "Enter" || k === "Escape" || k === "Backspace" || k === "GoBack" || k === "BrowserBack" || e.keyCode === 23 || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461) close();
  }
  function close() {
    if (!box) return false;
    window.removeEventListener("keydown", onKey, true);
    box.remove();
    box = null;
    return true;
  }

  window.CouchShare = { build: build, privateHits: privateHits, prepare: prepare, send: send, show: show, close: close, isOpen: function () { return !!box; } };
})();
