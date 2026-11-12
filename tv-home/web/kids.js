// Kids mode (docs/CONFIG.md, "Kids mode"): a kids profile's home is one shelf of big posters, each
// opening straight into its show, and the few apps a parent allowed. Nothing else: no other apps,
// no More apps, no settings, no Keep watching. Leaving needs the parent PIN, typed with the arrows
// on a number pad (or the remote's number keys) and shown only as dots.
//
// The page never holds the PIN, only its salted hash (bridge/kids.py makes it the same way: SHA-256
// applied pin_rounds times to "salt:pin"). app.js owns everything else and calls in through the
// hooks at the bottom.
(function () {
  "use strict";

  // ---------------- SHA-256, small and plain (old TV WebViews have no crypto.subtle off https) ----------------
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var W = new Array(64);
  function sha256(bytes) {   // bytes: an array of 0..255, returns an array of 32
    var len = bytes.length, bits = len * 8;
    var n = ((len + 9 + 63) >> 6) << 6, m = new Array(n), i;
    for (i = 0; i < n; i++) m[i] = 0;
    for (i = 0; i < len; i++) m[i] = bytes[i];
    m[len] = 0x80;
    m[n - 4] = (bits >>> 24) & 255; m[n - 3] = (bits >>> 16) & 255; m[n - 2] = (bits >>> 8) & 255; m[n - 1] = bits & 255;
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (var off = 0; off < n; off += 64) {
      for (i = 0; i < 16; i++) W[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var a = W[i - 15], b = W[i - 2];
        var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var A = h0, B = h1, C = h2, D = h3, E = h4, F = h5, G = h6, H = h7;
      for (i = 0; i < 64; i++) {
        var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
        var t1 = (H + S1 + ((E & F) ^ (~E & G)) + K[i] + W[i]) | 0;
        var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      h0 = (h0 + A) | 0; h1 = (h1 + B) | 0; h2 = (h2 + C) | 0; h3 = (h3 + D) | 0;
      h4 = (h4 + E) | 0; h5 = (h5 + F) | 0; h6 = (h6 + G) | 0; h7 = (h7 + H) | 0;
    }
    var out = [], hs = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (i = 0; i < 8; i++) out.push((hs[i] >>> 24) & 255, (hs[i] >>> 16) & 255, (hs[i] >>> 8) & 255, hs[i] & 255);
    return out;
  }
  function pinHash(pin, salt, rounds) {
    var s = String(salt) + ":" + String(pin), h = [];
    for (var i = 0; i < s.length; i++) h.push(s.charCodeAt(i) & 255);   // salt is hex, the PIN digits: plain ASCII
    for (var r = 0; r < (rounds || 4000); r++) h = sha256(h);
    return h.map(function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }

  // ---------------- state ----------------
  var X = null;          // what app.js hands over (init)
  var on = false;        // kids mode is showing
  var person = null;     // the kids profile
  var unlockedFor = null;   // a kids profile a grown up unlocked, with no grown up profile to move to
  var live = null;       // the bridge's answer (/api/kids): {id: {shows, apps, pin_hash, ...}}, null until it answers
  var row = 1, col = [0, 0, 0];   // focus: 0 the lock, 1 the shows, 2 the apps
  var pin = null;        // the number pad: {digits: [], i: focused key, msg, wrong, until}
  var wrongs = [];       // when wrong PINs were typed, for the wait after five
  var root = null, noteTimer = null;
  var PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
  var LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>';
  var DEL = '<svg viewBox="0 0 24 24"><path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';
  var OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var t = function (k, v) { return X.t(k, v); };
  var esc = function (v) { return X.esc(v); };

  function modeOf(p) {
    if (!p || !p.id) return null;
    if (live) return live[p.id] && live[p.id].pin_hash ? live[p.id] : null;   // the bridge knows best (the phone may have changed it)
    var m = p.kids_mode;
    return m && m.pin_hash && m.pin_salt ? m : null;
  }
  function mode() { return modeOf(person) || {}; }
  function shows() { return Array.isArray(mode().shows) ? mode().shows : []; }
  function appsAllowed() {
    return (Array.isArray(mode().apps) ? mode().apps : []).map(function (a) {
      return typeof a === "string" ? { package: a, name: X.appName(a) } : a;
    }).filter(function (a) { return a && a.package && X.installed(a.package); });
  }
  function rows() { return [true, shows().length > 0, appsAllowed().length > 0]; }

  // ---------------- drawing ----------------
  function build() {
    root = document.createElement("div");
    root.id = "kids";
    root.className = "kids";
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "Kids");
    document.body.appendChild(root);
    root.addEventListener("click", click);
  }
  function timeText() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    if (X.clock24()) return h + ":" + (m < 10 ? "0" : "") + m;
    return ((h % 12) || 12) + ":" + (m < 10 ? "0" : "") + m;
  }
  function posterHTML(s, i) {
    var art = s.poster || s.backdrop;
    var pkg = s.package || (s.app && s.app.package);
    var sub = s.season && s.episode ? t("kids_ep", { s: s.season, e: s.episode }) : s.season ? t("kids_season", { s: s.season }) : (s.app ? s.app.name : "");
    var icon = pkg && X.iconUrl(pkg);
    return '<div class="ktile" data-row="1" data-i="' + i + '"><div class="kposter">' +
      (art ? '<img src="' + esc(art) + '" alt="" decoding="async" onerror="this.remove()">' : "") +
      '<span class="kword">' + esc(s.title) + "</span>" +
      (icon ? '<span class="kbadge"><img src="' + esc(icon) + '" alt="" onerror="this.parentNode.remove()"></span>' : "") +
      '</div><b class="ktitle">' + esc(s.title) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  }
  function appHTML(a, i) {
    var icon = X.iconUrl(a.package);
    return '<div class="kapp" data-row="2" data-i="' + i + '"><div class="kapp-face">' +
      (icon ? '<img src="' + esc(icon) + '" alt="" onerror="this.parentNode.textContent=this.getAttribute(\'data-n\')" data-n="' + esc(a.name) + '">' : esc(a.name)) +
      '</div><span>' + esc(a.name) + "</span></div>";
  }
  function render() {
    if (!on) return;
    if (!root) build();
    var list = shows(), apps = appsAllowed(), avail = rows();
    if (!avail[row]) row = avail[1] ? 1 : avail[2] ? 2 : 0;
    col[1] = Math.max(0, Math.min(col[1], list.length - 1));
    col[2] = Math.max(0, Math.min(col[2], apps.length - 1));
    var name = person.name || "";
    root.style.setProperty("--kid", X.colour(person));
    root.innerHTML =
      '<header class="ktop"><div class="kwho">' + X.avatar(person) + "<div><b>" + esc(t("kids_shows_for", { name: name })) +
      "</b><small>" + esc(t("kids_mode")) + "</small></div></div>" +
      '<div class="kright"><span class="ktime">' + esc(timeText()) + "</span>" +
      '<div class="klock" data-row="0" data-i="0"><i>' + LOCK + "</i><span>" + esc(t("kids_grown_ups")) + "</span></div></div></header>" +
      (list.length ? '<section class="kshelf"><div class="kclip"><div class="ktrack">' + list.map(posterHTML).join("") + "</div></div></section>"
        : '<p class="kempty">' + esc(t("kids_empty")) + "</p>") +
      (apps.length ? '<section class="kapps">' + apps.map(appHTML).join("") + "</section>" : "") +
      '<p class="knote" aria-live="polite"></p>' + (pin ? pinHTML() : "");
    paint();
  }
  function pinHTML() {
    var dots = "", n = Math.max(4, pin.digits.length);
    for (var i = 0; i < n; i++) dots += '<i class="' + (i < pin.digits.length ? "on" : "") + '"></i>';
    var wait = waitLeft();
    return '<div class="kpin' + (pin.shake ? " shake" : "") + '" role="dialog" aria-modal="true"><div class="kpin-card">' +
      '<i class="kpin-lock">' + LOCK + "</i><h2>" + esc(t("kids_pin_title")) + "</h2><p>" + esc(t("kids_pin_sub")) + "</p>" +
      '<div class="kdots" aria-label="' + esc(t("kids_pin_typed", { n: pin.digits.length })) + '">' + dots + "</div>" +
      '<div class="kpad">' + PAD.map(function (k, i) {
        var face = k === "del" ? DEL : k === "ok" ? OK : k;
        return '<div class="kkey' + (k === "del" || k === "ok" ? " ktool" : "") + (i === pin.i ? " focus" : "") + '" data-pin="' + i + '">' + face + "</div>";
      }).join("") + "</div>" +
      '<p class="kpin-msg">' + esc(wait ? t("kids_pin_wait", { n: wait }) : pin.msg || "") + "</p>" +
      '<p class="kpin-hint">' + esc(t("kids_pin_hint")) + "</p></div></div>";
  }
  function paint() {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".focus"), function (el) { if (!el.hasAttribute("data-pin")) el.classList.remove("focus"); });
    if (pin) return;
    var el = root.querySelector('[data-row="' + row + '"][data-i="' + col[row] + '"]');
    if (el) el.classList.add("focus");
    var track = root.querySelector(".ktrack");
    if (track) {
      var tiles = track.children, first = tiles[0];
      if (first) {
        var step = first.offsetWidth + (parseFloat(getComputedStyle(track).columnGap) || 0);
        var fit = Math.max(1, Math.floor((track.parentNode.clientWidth + (step - first.offsetWidth)) / step));
        var start = Math.max(0, Math.min(col[1] - fit + 2, tiles.length - fit));
        track.style.transform = "translateX(" + (-Math.max(0, start) * step) + "px)";
      }
    }
  }
  function note(text) {
    if (!root) return;
    var el = root.querySelector(".knote");
    if (el) el.textContent = text || "";
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(function () { note(""); }, 7000);
  }

  // ---------------- doing things ----------------
  function openShow(s) {
    var pkg = s.package || (s.app && s.app.package) || "";
    note(t("opening", { title: s.title }));
    var native = function () {
      var T = X.TV;
      if (!T) return false;
      try {
        if (s.link && pkg && T.openLink && T.openLink(s.link, pkg)) return true;
        if (pkg && T.launch && T.launch(pkg)) return true;
      } catch (e) {}
      return false;
    };
    if (X.online()) {
      // the bridge (or the on-TV app) plays it the way "put on X" does, on this child's own app profile
      var body = { title: s.title, who: person.id };
      if (s.service) body.service = s.service;
      if (s.season) body.season = s.season;
      if (s.episode) body.episode = s.episode;
      X.api("POST", "/api/play", body, 60000).then(function (r) { note((r && r.note) || ""); }, function () {
        if (!native()) note(t("kids_cant_open", { title: s.title }));
      });
      return;
    }
    if (!native()) note(t("kids_cant_open", { title: s.title }));
  }
  function openApp(a) {
    note(t("opening", { title: a.name }));
    X.launch(a.package);
  }
  function activate() {
    if (row === 0) { openPin(); return; }
    if (row === 1) { var s = shows()[col[1]]; if (s) openShow(s); return; }
    var a = appsAllowed()[col[2]];
    if (a) openApp(a);
  }
  function move(dx, dy) {
    var avail = rows();
    if (dy) {
      var r = row + dy;
      while (r >= 0 && r <= 2 && !avail[r]) r += dy;
      if (r >= 0 && r <= 2) row = r;
    } else if (row === 1) col[1] = Math.max(0, Math.min(shows().length - 1, col[1] + dx));
    else if (row === 2) col[2] = Math.max(0, Math.min(appsAllowed().length - 1, col[2] + dx));
    paint();
  }

  // ---------------- the parent PIN ----------------
  function waitLeft() {
    var now = Date.now();
    wrongs = wrongs.filter(function (w) { return now - w < 60000; });
    return wrongs.length >= 5 ? Math.ceil((60000 - (now - wrongs[0])) / 1000) : 0;
  }
  function openPin() { pin = { digits: [], i: 0, msg: "" }; render(); }
  function closePin() { pin = null; render(); }
  function matches() {
    var m = mode();
    return pin.digits.length >= 4 && pinHash(pin.digits.join(""), m.pin_salt, m.pin_rounds) === m.pin_hash;
  }
  function typed(d) {
    if (waitLeft()) { render(); return; }
    if (pin.digits.length >= 8) return;
    pin.digits.push(d); pin.msg = ""; pin.shake = false;
    if (matches()) { unlock(); return; }
    render();
  }
  function confirmPin() {
    if (waitLeft()) { render(); return; }
    if (matches()) { unlock(); return; }
    if (!pin.digits.length) return;
    wrongs.push(Date.now());
    pin.digits = []; pin.msg = t("kids_pin_wrong"); pin.shake = true;
    render();
  }
  function padKey() {
    var k = PAD[pin.i];
    if (k === "del") { pin.digits.pop(); pin.msg = ""; render(); }
    else if (k === "ok") confirmPin();
    else typed(k);
  }
  function padMove(dx, dy) {
    var r = Math.floor(pin.i / 3), c = pin.i % 3;
    r = Math.max(0, Math.min(3, r + dy)); c = Math.max(0, Math.min(2, c + dx));
    pin.i = r * 3 + c;
    Array.prototype.forEach.call(root.querySelectorAll("[data-pin]"), function (el) {
      el.classList.toggle("focus", +el.getAttribute("data-pin") === pin.i);
    });
  }
  function unlock() {
    var who = person, code = pin.digits.join("");
    pin = null; wrongs = [];
    leave();
    X.unlocked(who, code);   // app.js moves the TV to a grown up (telling the bridge, with the PIN)
  }

  // ---------------- keys and the pointer ----------------
  function digitOf(e) {
    if (/^[0-9]$/.test(e.key || "")) return e.key;
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96);
    return null;
  }
  // Every key is ours while kids mode is up. Returns true when the page should keep it from Android.
  function key(e) {
    if (e.type !== "keydown" || (e.repeat && X.isOk(e))) return true;
    var arrow = X.arrowOf(e), d = digitOf(e);
    if (pin) {
      if (arrow) padMove(arrow[0], arrow[1]);
      else if (X.isOk(e)) padKey();
      else if (d !== null) { typed(d); }
      else if (X.isBack(e) || X.isSettings(e)) closePin();
      else if (e.key === "Backspace" || e.keyCode === 67) { pin.digits.pop(); render(); }
      return true;
    }
    if (arrow) move(arrow[0], arrow[1]);
    else if (X.isOk(e)) activate();
    else if (X.isSettings(e) || X.isMenu(e)) openPin();   // settings, or the menu key: the parent PIN first
    else if (X.isBack(e)) { row = rows()[1] ? 1 : row; paint(); }
    else if (d !== null) { openPin(); typed(d); }
    else return false;   // volume, power and the rest are the TV's
    return true;
  }
  function click(e) {
    var el = e.target;
    for (; el && el !== root; el = el.parentNode) {
      if (el.hasAttribute && el.hasAttribute("data-pin")) { pin.i = +el.getAttribute("data-pin"); padKey(); break; }
      if (el.hasAttribute && el.hasAttribute("data-row")) {
        row = +el.getAttribute("data-row"); col[row] = +el.getAttribute("data-i");
        paint(); activate(); break;
      }
    }
    e.preventDefault(); e.stopPropagation();
  }

  // ---------------- in and out ----------------
  function enter(p) {
    var fresh = !on || !person || person.id !== p.id;
    person = p; on = true;
    if (fresh) { row = 1; col = [0, 0, 0]; pin = null; }
    document.documentElement.classList.add("kids-on");
    render();
  }
  function leave() {
    on = false; pin = null;
    document.documentElement.classList.remove("kids-on");
    if (root) root.innerHTML = "";
  }

  window.KidsMode = {
    pinHash: pinHash,
    init: function (x) { X = x; setInterval(function () { if (on && root) { var el = root.querySelector(".ktime"); if (el) el.textContent = timeText(); if (pin && waitLeft()) render(); } }, 5000); },
    isKid: function (p) { return !!modeOf(p); },
    active: function () { return on; },
    // app.js calls this whenever who is watching may have changed: in for a kids profile, out otherwise
    sync: function (p) {
      if (unlockedFor && (!p || p.id !== unlockedFor)) unlockedFor = null;
      if (modeOf(p) && p.id !== unlockedFor) enter(p);
      else if (on) leave();
    },
    // unlocked with no grown up profile to move to: stay on this profile, out of kids mode, until it changes
    stayUnlocked: function (pid) { unlockedFor = pid; },
    askPin: function () { if (on && !pin) openPin(); },
    key: key,
    home: function () { if (pin) closePin(); row = rows()[1] ? 1 : 0; col[1] = 0; paint(); },
    // with the bridge: the shelves as the phone left them, with posters
    refresh: function () {
      if (!X.online()) return Promise.resolve();
      return X.api("GET", "/api/kids", null, 15000).then(function (j) {
        var next = {};
        (j.kids || []).forEach(function (k) { next[k.id] = k; });
        live = next;
      }, function () {});
    },
    rerender: render
  };
})();
