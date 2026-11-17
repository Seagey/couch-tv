// Getting a design by code (Home settings, Look, Get a design). The TV PULLS a design from the TV
// Designer's store: it asks one server, the one in config.json "design_store", and nothing ever
// connects to the TV. The store never learns anything about this home (no address it keeps, no
// Wi-Fi, no devices, no names): the request carries the code and nothing else (no cookies, no
// referrer).
//
// What comes back is untrusted. Only its "design" is kept; the only picture allowed is a JPEG
// inside it (the store re-draws every upload as a clean JPEG), checked by its first bytes; then
// design.js's own gate (CouchDesign.sanitize) rebuilds it from the allow list as for any design.
// A design got this way ALWAYS shows the "Use this design?" question first: arriving clears this
// TV's record of any design it said yes to, so nothing in the answer can skip the question.
(function () {
  "use strict";
  var KEY = "couchtv.design.fetched", MAX = 4000000, TIMEOUT = 15000;
  var Q = location.search;
  var DESIGNER = /[?&]designer=1\b/.test(Q);
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  // https only; plain http only to this computer (development)
  function cleanBase(u) {
    if (typeof u !== "string" || u.length > 200) return "";
    var m = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?)\/?$/i.exec(u.trim());
    return m ? m[1].toLowerCase() : "";
  }
  function base() {
    var cfg = window.COUCH_CONFIG || {};
    var b = cleanBase(cfg.design_store);
    // a browser preview (mock.js) may point at a local store: ?designstore=http://127.0.0.1:5490
    if (!b && /[?&]mock\b/.test(Q)) { var m = /[?&]designstore=([^&]*)/.exec(Q); if (m) b = cleanBase(decodeURIComponent(m[1])); }
    return b;
  }
  // a code as typed with the remote: a short one (ABCDE-FGHJK, any case, spaces and dashes ignored) or
  // the long one from the QR (CTV1-...). Anything else is not sent anywhere.
  var SHORT = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  function readCode(s) {
    s = String(s || "").trim();
    var long = s.replace(/^CTV1-/i, "");
    if (/^[A-Za-z0-9_-]{43}$/.test(long)) return "CTV1-" + long;
    var c = s.toUpperCase().replace(/[\s-]/g, "");
    if (c.length !== 10) return "";
    for (var i = 0; i < 10; i++) if (SHORT.indexOf(c.charAt(i)) < 0) return "";
    return c.slice(0, 5) + "-" + c.slice(5);
  }
  function jpegOk(u) {
    var m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(u || "");
    if (!m) return false;
    try { var head = atob(m[1].slice(0, 8)); return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff; } catch (e) { return false; }
  }
  // keep only what a design may be: an object, with at most a JPEG background from the store
  function accept(text) {
    if (typeof text !== "string" || text.length > MAX) return null;
    var j;
    // keys that reach an object's prototype are dropped as the answer is read
    try { j = JSON.parse(text, function (k, v) { return k === "__proto__" || k === "constructor" || k === "prototype" ? undefined : v; }); } catch (e) { return null; }
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    var d = j.design;
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    d = JSON.parse(JSON.stringify(d));   // a plain copy: nothing of the answer but data
    if (d.background && typeof d.background === "object") {
      var img = d.background.image;
      if (img !== undefined && !(typeof img === "string" && (jpegOk(img) || /^backgrounds\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/.test(img)))) delete d.background.image;
    }
    return d;
  }
  var MSG = {
    nocode: "That is not a design code. It looks like ABCDE-FGHJK.",
    notfound: "That code did not work. A code works once, for 30 minutes. Make a new one in the TV Designer.",
    slow: "Too many tries. Wait a few minutes, then try again.",
    paused: "Short codes are paused for a few minutes. Try again soon.",
    offline: "Could not reach the design server. Check the TV is online.",
    bad: "That design could not be used.",
    full: "This TV has no room to keep that design."
  };
  function fail(k) { var e = new Error(MSG[k]); e.kind = k; return e; }

  function get(typed) {
    var code = readCode(typed), b = base();
    if (!code) return Promise.reject(fail("nocode"));
    if (!b || typeof fetch !== "function") return Promise.reject(fail("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(b + "/v1/designs/fetch", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code }), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 404) throw fail("notfound");
      if (r.status === 429) throw fail("slow");
      if (r.status === 503) throw fail("paused");
      if (!r.ok) throw fail("offline");
      var len = Number(r.headers.get("content-length"));
      if (len > MAX) throw fail("bad");
      return r.text();
    }, function () { clearTimeout(timer); throw fail("offline"); }).then(function (text) {
      var d = accept(text);
      if (!d) throw fail("bad");
      arrived(d);
      return d;
    });
  }
  // keep it, and forget any yes this TV gave before: the question always comes first
  function arrived(d) {
    var rec = JSON.stringify({ design: d, at: Date.now() });
    store("couchtv.design.ok", null);
    store("couchtv.design.no", null);
    store("couchtv.design.off", null);   // asked for at the TV: designs on again (the question still guards it)
    store(KEY, rec);
    if (store(KEY) !== rec) throw fail("full");
  }
  function kept() {
    if (DESIGNER) return null;   // the designer's own preview never takes a fetched design
    var raw = store(KEY);
    if (!raw) return null;
    var d = accept(raw);
    if (!d) store(KEY, null);
    return d;
  }
  function forget() { store(KEY, null); store("couchtv.design.ok", null); store("couchtv.design.no", null); }

  // While a design got by code is on this TV (asked about or in use), pictures may load only from this
  // page, data: and blob: pictures, the launcher's own tvos.invalid host, the design store, and the
  // hosts this TV's own settings already use (Keep watching posters, now playing art, photos the
  // person added by link). A second Content Security Policy narrows the page's own (index.html); two
  // policies both apply, so this can only take away. Photos added by link while it is on load after the
  // next restart, which Home settings does anyway.
  function lockImages(ownLinks) {
    if (!kept() || !document.head) return false;
    var src = ["'self'", "data:", "blob:", "http://tvos.invalid", "https://images.justwatch.com", "https://i.scdn.co"];
    var b = base(); if (b) src.push(b);
    (ownLinks || []).forEach(function (u) {
      var m = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?)\//i.exec(String(u || ""));
      if (m && src.indexOf(m[1].toLowerCase()) < 0) src.push(m[1].toLowerCase());
    });
    var meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", "img-src " + src.join(" "));
    document.head.appendChild(meta);
    return true;
  }

  window.CouchDesignCode = { base: base, readCode: readCode, get: get, kept: kept, forget: forget, accept: accept, lockImages: lockImages };
})();
