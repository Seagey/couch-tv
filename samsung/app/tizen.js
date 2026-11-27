// The Samsung side of the TV home. On Android the launcher app gives the page window.TVOS (the
// apps on the TV, open an app, a place to keep things); on a Samsung this file does the same job
// with Tizen's own calls, so tv-home/web/app.js runs unchanged.
//
// Apps keep their Android names inside the page (Netflix is "com.netflix.ninja"), so the order
// arranged on the phone works on every TV. COUCH_TIZEN_APPS (tizen-apps.js, made by build.py from
// bridge/apps.py) says which Samsung app each one is.
// Old Tizen (2.4, 2016 TVs) has an older WebKit without some ES2015+ library calls the home uses.
// Fill in only what is missing; newer TVs are untouched.
(function () {
  function def(o, k, v) { if (o && !o[k]) try { Object.defineProperty(o, k, { value: v, configurable: true, writable: true }); } catch (e) { o[k] = v; } }
  def(Object, "assign", function (t) {
    if (t == null) throw new TypeError("Cannot convert undefined or null to object");
    var to = Object(t);
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s != null) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) to[k] = s[k];
    }
    return to;
  });
  def(Object, "values", function (o) { return Object.keys(o).map(function (k) { return o[k]; }); });
  def(Object, "entries", function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); });
  def(Object, "fromEntries", function (it) { var o = {}; Array.prototype.forEach.call(Array.from(it), function (p) { o[p[0]] = p[1]; }); return o; });
  def(Number, "isFinite", function (v) { return typeof v === "number" && isFinite(v); });
  def(Number, "isNaN", function (v) { return typeof v === "number" && v !== v; });
  def(Number, "isInteger", function (v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; });
  def(Number, "parseFloat", parseFloat);
  def(Number, "parseInt", parseInt);
  def(Math, "trunc", function (v) { return v < 0 ? Math.ceil(v) : Math.floor(v); });
  def(Math, "sign", function (v) { v = +v; return v > 0 ? 1 : v < 0 ? -1 : v; });
  def(Math, "hypot", function () { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i] * arguments[i]; return Math.sqrt(s); });
  def(Math, "log10", function (v) { return Math.log(v) / Math.LN10; });
  def(Array, "from", function (a, fn, self) {
    var out = [];
    if (a == null) return out;
    if (typeof Symbol !== "undefined" && Symbol.iterator && typeof a[Symbol.iterator] === "function" && typeof a.length !== "number") {
      var it = a[Symbol.iterator](), r;
      while (!(r = it.next()).done) out.push(r.value);
    } else if (typeof a.forEach === "function" && typeof a.length !== "number") {
      a.forEach(function (v) { out.push(v); });
    } else {
      for (var i = 0; i < (a.length >>> 0); i++) out.push(a[i]);
    }
    return fn ? out.map(fn, self) : out;
  });
  def(Array, "of", function () { return Array.prototype.slice.call(arguments); });
  var AP = Array.prototype;
  def(AP, "find", function (f, t) { for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) return this[i]; });
  def(AP, "findIndex", function (f, t) { for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(AP, "findLast", function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(AP, "findLastIndex", function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(AP, "includes", function (v, from) { for (var i = from || 0; i < this.length; i++) if (this[i] === v || (v !== v && this[i] !== this[i])) return true; return false; });
  def(AP, "fill", function (v, s, e) { var n = this.length; s = s || 0; e = e === undefined ? n : e; if (s < 0) s += n; if (e < 0) e += n; for (var i = s; i < e; i++) this[i] = v; return this; });
  def(AP, "flat", function (d) { d = d === undefined ? 1 : d; var out = []; (function f(a, k) { for (var i = 0; i < a.length; i++) if (Array.isArray(a[i]) && k > 0) f(a[i], k - 1); else out.push(a[i]); })(this, d); return out; });
  def(AP, "flatMap", function (fn, t) { return AP.map.call(this, fn, t).flat(); });
  def(AP, "at", function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; });
  var SP = String.prototype;
  def(SP, "includes", function (s, p) { return this.indexOf(s, p || 0) !== -1; });
  def(SP, "startsWith", function (s, p) { p = p || 0; return this.substr(p, s.length) === s; });
  def(SP, "endsWith", function (s, n) { var t = String(this); n = n === undefined ? t.length : n; return t.slice(n - s.length, n) === s; });
  def(SP, "repeat", function (n) { var s = "", t = String(this); for (var i = 0; i < n; i++) s += t; return s; });
  def(SP, "padStart", function (n, f) { var t = String(this); f = f === undefined ? " " : String(f); while (t.length < n) t = f + t; return t.slice(t.length - Math.max(n, String(this).length)); });
  def(SP, "padEnd", function (n, f) { var t = String(this); f = f === undefined ? " " : String(f); while (t.length < n) t += f; return t.slice(0, Math.max(n, String(this).length)); });
  def(SP, "trimStart", function () { return String(this).replace(/^\s+/, ""); });
  def(SP, "trimEnd", function () { return String(this).replace(/\s+$/, ""); });
  def(SP, "replaceAll", function (a, b) { if (a instanceof RegExp) return this.replace(a, b); return String(this).split(a).join(b); });
  def(SP, "at", function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this.charAt(i) || undefined; });
  // Promise (Promises/A+ core, plus all/race/allSettled/resolve/reject/finally)
  if (typeof window.Promise !== "function") {
    var asap = function (fn) { setTimeout(fn, 0); };
    var P = function (exec) {
      var self = this; self._s = 0; self._v = undefined; self._q = [];
      function settle(s, v) {
        if (self._s) return;
        self._s = s; self._v = v;
        var q = self._q; self._q = [];
        for (var i = 0; i < q.length; i++) run(q[i]);
      }
      function resolve(v) {
        if (v === self) return settle(2, new TypeError("cycle"));
        if (v && (typeof v === "object" || typeof v === "function")) {
          var then, called = false;
          try { then = v.then; } catch (e) { return settle(2, e); }
          if (typeof then === "function") {
            try {
              then.call(v, function (x) { if (!called) { called = true; resolve(x); } },
                           function (r) { if (!called) { called = true; settle(2, r); } });
            } catch (e) { if (!called) { called = true; settle(2, e); } }
            return;
          }
        }
        settle(1, v);
      }
      function run(h) {
        asap(function () {
          var cb = self._s === 1 ? h.ok : h.no;
          if (typeof cb !== "function") { (self._s === 1 ? h.res : h.rej)(self._v); return; }
          var out;
          try { out = cb(self._v); } catch (e) { h.rej(e); return; }
          h.res(out);
        });
      }
      self._add = function (h) { if (self._s) run(h); else self._q.push(h); };
      try { exec(resolve, function (r) { settle(2, r); }); } catch (e) { settle(2, e); }
    };
    P.prototype.then = function (ok, no) {
      var me = this;
      return new P(function (res, rej) { me._add({ ok: ok, no: no, res: res, rej: rej }); });
    };
    P.prototype["catch"] = function (no) { return this.then(null, no); };
    P.prototype["finally"] = function (f) {
      return this.then(function (v) { return P.resolve(f()).then(function () { return v; }); },
                       function (r) { return P.resolve(f()).then(function () { throw r; }); });
    };
    P.resolve = function (v) { return v instanceof P ? v : new P(function (res) { res(v); }); };
    P.reject = function (r) { return new P(function (res, rej) { rej(r); }); };
    P.all = function (list) {
      list = Array.from(list);
      return new P(function (res, rej) {
        var out = new Array(list.length), left = list.length;
        if (!left) return res(out);
        list.forEach(function (x, i) { P.resolve(x).then(function (v) { out[i] = v; if (--left === 0) res(out); }, rej); });
      });
    };
    P.race = function (list) {
      return new P(function (res, rej) { Array.from(list).forEach(function (x) { P.resolve(x).then(res, rej); }); });
    };
    P.allSettled = function (list) {
      return P.all(Array.from(list).map(function (x) {
        return P.resolve(x).then(function (v) { return { status: "fulfilled", value: v }; },
                                 function (r) { return { status: "rejected", reason: r }; });
      }));
    };
    window.Promise = P;
  }
  // fetch, on top of XMLHttpRequest (enough for GET/POST of JSON and text)
  if (typeof window.fetch !== "function") {
    window.fetch = function (input, init) {
      init = init || {};
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        var url = typeof input === "string" ? input : (input && input.url) || String(input);
        x.open(init.method || "GET", url, true);
        if (init.credentials === "include") x.withCredentials = true;
        var h = init.headers || {};
        if (typeof h.forEach === "function" && !(h instanceof Array)) h.forEach(function (v, k) { x.setRequestHeader(k, v); });
        else for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) x.setRequestHeader(k, h[k]);
        if (init.signal) {
          if (init.signal.aborted) { reject(new Error("AbortError")); return; }
          if (init.signal.addEventListener) init.signal.addEventListener("abort", function () { x.abort(); reject(new Error("AbortError")); });
        }
        x.onload = function () {
          var status = x.status === 0 ? 200 : x.status;   // file:// answers 0 when it worked
          var text = x.responseText;
          resolve({
            ok: status >= 200 && status < 300, status: status, statusText: x.statusText, url: url,
            headers: { get: function (n) { return x.getResponseHeader(n); } },
            text: function () { return Promise.resolve(text); },
            json: function () { return new Promise(function (ok, no) { try { ok(JSON.parse(text)); } catch (e) { no(e); } }); },
            clone: function () { return this; }
          });
        };
        x.onerror = function () {
          try { console.warn("fetch failed: " + url.split("?")[0]); } catch (e) {}
          reject(new TypeError("Network request failed"));
        };
        x.ontimeout = x.onerror;
        x.send(init.body === undefined ? null : init.body);
      });
    };
  }
  if (window.NodeList) def(NodeList.prototype, "forEach", AP.forEach);
  if (window.Element) {
    var EP = Element.prototype;
    def(EP, "matches", EP.webkitMatchesSelector || EP.msMatchesSelector);
    def(EP, "closest", function (sel) { var el = this; while (el && el.nodeType === 1) { if (el.matches(sel)) return el; el = el.parentElement; } return null; });
    def(EP, "remove", function () { if (this.parentNode) this.parentNode.removeChild(this); });
    def(EP, "append", function () { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; this.appendChild(typeof a === "string" ? document.createTextNode(a) : a); } });
    def(EP, "prepend", function () { for (var i = arguments.length - 1; i >= 0; i--) { var a = arguments[i]; this.insertBefore(typeof a === "string" ? document.createTextNode(a) : a, this.firstChild); } });
    def(EP, "replaceChildren", function () { while (this.firstChild) this.removeChild(this.firstChild); EP.append.apply(this, arguments); });
    def(EP, "toggleAttribute", function (n, f) { var on = f === undefined ? !this.hasAttribute(n) : !!f; if (on) this.setAttribute(n, ""); else this.removeAttribute(n); return on; });
  }
})();

(function () {
  "use strict";
  var S = window.COUCH_TIZEN || {};
  var MAP = window.COUCH_TIZEN_APPS || {};
  var OWN_LOGOS = {};   // samsung/my-logos/<id or name>.png, for apps with no entry in MAP
  (window.COUCH_TIZEN_OWN_LOGOS || []).forEach(function (n) { OWN_LOGOS[n] = true; });
  var SELF = "CouchTVApp.Home";
  var BRIDGE = ((location.search.match(/[?&]api=([^&]+)/) || [])[1] || "");
  BRIDGE = decodeURIComponent(BRIDGE);
  var TV_ID = (location.search.match(/[?&]tv=([a-z0-9-]+)/) || [])[1] || "";
  var HOME = S.home_button;

  // ---------- optional debug log (build.py --log-url), for testing without a screenshot ----------
  var LOG = S.log || "";
  function send(kind, data) {
    if (!LOG) return;
    try {
      var x = new XMLHttpRequest();
      x.open("POST", LOG + "/" + kind);
      x.setRequestHeader("Content-Type", "text/plain");
      x.send(typeof data === "string" ? data : JSON.stringify(data));
    } catch (e) {}
  }
  if (LOG) {
    send("log", "page start " + location.search);
    window.addEventListener("error", function (e) { send("log", "error: " + e.message + " at " + e.filename + ":" + e.lineno); });
    ["log", "warn", "error"].forEach(function (k) {
      var orig = console[k];
      console[k] = function () {
        send("log", k + ": " + Array.prototype.slice.call(arguments).join(" "));
        if (orig) orig.apply(console, arguments);
      };
    });
    window.addEventListener("load", function () {
      setTimeout(function () {
        send("dom", "<!-- " + location.href + " -->\n" + document.documentElement.outerHTML);
      }, 9000);
    });
    // and the screen again 2.5 seconds after the last key: a Samsung gives no screenshots, so this
    // is how a test sees where a key landed
    ["input", "change", "focus", "blur"].forEach(function (k) {
      document.addEventListener(k, function (e) {
        var t = e.target || {};
        if (t.tagName === "INPUT") send("log", k + " #" + t.id + " value=" + String(t.value || "").slice(0, 60));
      }, true);
    });
    var after = null;
    window.addEventListener("keydown", function (e) {
      send("log", "key " + e.keyCode + " " + e.key);
      clearTimeout(after);
      after = setTimeout(function () { send("dom", "<!-- " + location.href + " -->\n" + document.documentElement.outerHTML); }, 2500);
    }, true);
  }

  // ---------- the apps on this TV ----------
  var tizenApps = [];
  try { tizenApps = JSON.parse(localStorage.getItem("couch.tizen.apps") || "[]"); } catch (e) {}
  var byTizen = {};   // Tizen id or package id -> Android-style package
  Object.keys(MAP).forEach(function (pkg) {
    var m = MAP[pkg];
    (m.ids || []).forEach(function (id) { byTizen[id] = pkg; });
    if (m.app) byTizen[m.app] = pkg;
  });
  // Tizen lists hundreds of system parts as apps (a 2021 TV: 437). Apps from Samsung's store have a
  // 10 character package id (Tubi is 3KA0pm7a7V); system ones are org.tizen.* or com.samsung.*.
  // A few store-installed extras are Samsung's own and stay hidden.
  var STORE = /^[A-Za-z0-9]{10}$/;
  var HIDE = /^(e-Manual|Security Center|Samsung Promotion|Smarthub Connection Test)$/i;
  // Samsung's in-store demo (ePOP): on a 2025 QN90F in India, "2025.SmartTV.Rose" (2025ePop01.SmartTV),
  // which would not even open from couch-tv
  var DEMO = /^\d{4}ePop\d*\./i;
  var byPkg = {}, shown = [];
  function sortOut() {
    byPkg = {}; shown = [];
    tizenApps.forEach(function (a) {
      if (a.id === SELF || a.packageId === SELF.split(".")[0]) return;
      if (LIVE_ON && (a.id === TVPLUS || /^Samsung TV Plus$/i.test(a.name || ""))) return;   // Live TV plays its channels; its own app froze couch-tv behind it
      var pkg = byTizen[a.id] || byTizen[a.packageId];
      if (pkg && !byPkg[pkg]) {
        byPkg[pkg] = a;
        shown.push({ package: pkg, label: MAP[pkg].name || a.name });
      } else if (!pkg && a.show && STORE.test(a.packageId || "") && !HIDE.test(a.name || "") && !DEMO.test(a.id || "") && !byPkg[a.id]) {
        byPkg[a.id] = a;
        // a store tagline is left off the tile ("ZEE5 - Movies, Shows, LiveTV, ..." is "ZEE5")
        shown.push({ package: a.id, label: String(a.name || "").split(/\s+[-–—|:]\s+|:\s+/)[0] || a.name });
      }
    });
    if (LIVE_ON) shown.unshift({ package: LIVE, label: S.live_tv.name || "Live TV" });
    if (SKY_PORT) shown.unshift({ package: SKY, label: "Sky" });
  }
  var SKY = "local.sky", SKY_PORT = parseInt(S.sky_hdmi, 10) || 0, skyOn = false;
  // Samsung TV Plus's channels played inside couch-tv ("live_tv" in this TV's entry, livetv.js)
  var LIVE = "local.livetv", LIVE_ON = !!(S.live_tv && typeof S.live_tv === "object");
  var TVPLUS = "HEPsqFNie0.tvplusstandalone";   // Samsung TV Plus's own app, left out while Live TV is on
  sortOut();
  send("log", "apps on this TV: " + tizenApps.length + ", shown: " + shown.map(function (a) { return a.label; }).join(", "));
  // --log-url: every app a person could open that couch-tv leaves out, Samsung's own included
  if (LOG) send("log", "not shown: " + tizenApps.filter(function (a) {
    return (a.show || !/^(org\.tizen|com\.samsung)/.test(a.id || "")) && !shown.some(function (s) { return byPkg[s.package] === a; });
  }).map(function (a) { return a.name + " [" + a.id + " pkg=" + a.packageId + " show=" + a.show + "]"; }).join(", "));

  // Older TVs (a 2016 one on Tizen 2.4) will not hand another app's icon file to this one, so the
  // picture fails. Show the app's name on the tile instead of a broken picture.
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG") return;
    var face = img.parentNode;
    if (!face || !/(^|\s)face(\s|$)/.test(face.className || "")) return;
    var tile = face.parentNode, lab = tile && tile.querySelector && tile.querySelector(".label");
    face.removeChild(img);
    face.className = (face.className || "").replace(/(^|\s)icon(\s|$)/, " ") + " word";
    face.textContent = lab ? lab.textContent : "";
  }, true);

  // A 2016 TV (Tizen 2.4, html.old-engine) drew nothing for the line icons app.js puts in with
  // innerHTML (Settings, More apps). Only there, each one becomes a picture of the same drawing, with
  // the size and stroke the CSS would have given it written in (a picture gets none of the page's CSS).
  // Newer TVs never get here.
  function oldEngine() { return /(^|\s)old-engine(\s|$)/.test(document.documentElement.className || ""); }
  function paintIcons() {
    if (!oldEngine()) return;
    var list = document.querySelectorAll(".face.tool svg");
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.getAttribute("width")) s.setAttribute("width", "44");
      if (!s.getAttribute("height")) s.setAttribute("height", "44");
      if (/(^|\s)iset(\s|$)/.test(s.parentNode.className || "")) {
        s.setAttribute("color", "#f5f5f7");   // icon packs fill with currentColor
      } else {
        s.setAttribute("stroke", "#f5f5f7");
        s.setAttribute("fill", "none");
        s.setAttribute("stroke-width", "1.6");
        s.setAttribute("stroke-linecap", "round");
        s.setAttribute("stroke-linejoin", "round");
      }
      var src = s.outerHTML || new XMLSerializer().serializeToString(s);
      if (!/xmlns=/.test(src)) src = src.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      var img = document.createElement("img");
      img.setAttribute("alt", "");
      img.setAttribute("width", s.getAttribute("width"));
      img.setAttribute("height", s.getAttribute("height"));
      img.style.cssText = "display:block;width:2.75rem;height:2.75rem;object-fit:contain";
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
      s.parentNode.replaceChild(img, s);
    }
  }
  if (window.MutationObserver) {
    new MutationObserver(paintIcons).observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", paintIcons);

  // The list in localStorage is last time's. Read it again a few seconds after the home is up (a TV
  // with hundreds of apps takes several seconds to answer), after a visit to Samsung's app store, and
  // when asked (the gear menu's Look for new apps). Save it, and reload the home only if the apps
  // shown have changed (#53). done(changed) hears true or false, or null when the TV did not answer.
  function readApps(done) {
    function answer(v) { if (done) try { done(v); } catch (e) {} }
    try {
      tizen.application.getAppsInfo(function (list) {
        var fresh = list.map(function (a) {
          return { id: a.id, name: a.name, packageId: a.packageId, iconPath: a.iconPath, show: a.show };
        });
        var before = shown.map(function (a) { return a.package; }).join("|");
        try { localStorage.setItem("couch.tizen.apps", JSON.stringify(fresh)); } catch (e) {}
        tizenApps = fresh;
        sortOut();
        reportHomeApps();
        var changed = shown.map(function (a) { return a.package; }).join("|") !== before;
        answer(changed);
        if (changed) {
          send("log", "app list changed, reloading");
          // asked from the gear menu: the home first says so
          if (done) setTimeout(function () { location.reload(); }, 1500); else location.reload();
        }
      }, function () { answer(null); });
    } catch (e) { answer(null); }
  }
  setTimeout(function () { readApps(null); }, 4000);

  // ---------- a Sky box on an HDMI input ("sky_hdmi" in this TV's entry in config.json) ----------
  // tvwindow shows the input full screen in front of this app. The Sky remote talks to the box, so
  // it keeps working; Back on the Samsung remote closes the window and returns to the home.
  // With no "sky_hdmi", this TV has no Sky tile.
  function skyNote(text) {
    send("log", "sky: " + text);
    var n = document.getElementById("sky-note");
    if (!n) {
      n = document.createElement("div");
      n.id = "sky-note";
      n.style.cssText = "position:fixed;left:48px;bottom:48px;z-index:99999;max-width:1400px;padding:20px 28px;" +
        "border-radius:12px;background:#111;color:#fff;font:28px sans-serif";
      document.body.appendChild(n);
    }
    n.textContent = text;
    clearTimeout(skyNote.t);
    skyNote.t = setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 15000);
  }

  function errText(e) { return (e && e.name ? e.name + ": " : "") + ((e && e.message) || String(e)); }

  function closeSky() {
    skyOn = false;
    try { tizen.tvwindow.hide(function () {}, function (e) { skyNote("Sky did not close. " + errText(e)); }); }
    catch (e) { skyNote("Sky did not close. " + errText(e)); }
  }

  function openSky() {
    function failed(step, e) { skyOn = false; skyNote("Sky did not open (" + step + "). " + errText(e)); }
    try {
      tizen.systeminfo.getPropertyValue("VIDEOSOURCE", function (info) {
        var list = (info && info.connected) || [], src = null;
        list.forEach(function (s) { if (s.type === "HDMI" && s.number === SKY_PORT) src = s; });
        if (!src) {
          failed("HDMI " + SKY_PORT + " not connected", "The TV lists: " +
            (list.map(function (s) { return s.type + " " + s.number; }).join(", ") || "nothing"));
          return;
        }
        tizen.tvwindow.setSource(src, function () {
          try {
            tizen.tvwindow.show(function () { skyOn = true; }, function (e) { failed("show", e); },
              ["0", "0", "100%", "100%"], "MAIN", "FRONT");
          } catch (e) { failed("show", e); }
        }, function (e) { failed("setSource", e); });
      }, function (e) { failed("list inputs", e); });
    } catch (e) { failed("start", e); }
    return true;
  }

  // Runs before app.js's own keys: with Sky on screen, the home must not move behind it.
  document.addEventListener("keydown", function (e) {
    if (!skyOn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.keyCode === 10009) closeSky();
  }, true);
  document.addEventListener("visibilitychange", function () { if (document.hidden && skyOn) closeSky(); });

  function bridgeLaunch(pkg) {
    if (!BRIDGE) return;
    var x = new XMLHttpRequest();
    x.open("POST", BRIDGE + "/api/launch");
    x.setRequestHeader("Content-Type", "application/json");
    if (S.key) x.setRequestHeader("Authorization", "Bearer " + S.key);
    x.send(JSON.stringify(TV_ID ? { app: pkg, tv: TV_ID } : { app: pkg }));
  }

  var selfLaunchAt = 0;   // when couch-tv last opened an app itself (the Home watch below ignores that)
  var selfOpened = null;  // the app couch-tv last opened, while it runs (closing it brings couch-tv back)
  function openLive() {
    if (!window.CouchLiveTV) return false;
    return window.CouchLiveTV.open({ bridge: BRIDGE, tv: TV_ID, key: S.key || "",
      log: function (text) { send("log", "live tv: " + text); } });
  }
  // Samsung's app store. A 2025 QN90F lists two "Apps": org.volt.apps opened on a blue screen from
  // couch-tv (28 Nov 2026), so this is the one. Back from it, the apps are read again, so one just
  // installed is on the home.
  var STORE_APP = "com.samsung.tv.store", fromStore = false;
  function openStore() {
    fromStore = true;
    send("log", "store: opening " + STORE_APP);
    return launch(STORE_APP);
  }
  function launch(pkg) {
    // Live TV plays inside couch-tv, which stays in front: not an app opened (Home still counts at once)
    if (pkg === LIVE) return openLive();
    selfLaunchAt = Date.now();
    // the bridge leaves the TV alone for a while: someone is choosing what to watch (26 Nov 2026: its
    // restart recovery put couch-tv back over a channel opened a few seconds after the TV came back)
    if (BRIDGE) homeRequest("POST", "/api/tizen/home", { opened: true }).catch(function () {});
    if (pkg === SKY) return openSky();
    var a = byPkg[pkg], m = MAP[pkg];
    var ids = a ? [a.id] : [];
    if (m) (m.ids || []).concat(m.app ? [m.app] : []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    if (!ids.length && /\./.test(pkg)) ids.push(pkg);
    if (!ids.length) return false;
    // Some TVs list a "-dummy" placeholder for an app (Prime Video). It opens nothing, so try it last.
    ids = ids.filter(function (id) { return !/-dummy$/.test(id); })
      .concat(ids.filter(function (id) { return /-dummy$/.test(id); }));
    (function attempt(i) {
      if (i >= ids.length) { send("log", "launch failed for " + pkg + ", asking the bridge"); bridgeLaunch(pkg); return; }
      try {
        tizen.application.launch(ids[i], function () {
            send("log", "launched " + ids[i]);
            selfOpened = ids[i];
            // Some store apps (SVT Play, #327) report success and open nothing. If our page is still
            // in front a few seconds later, ask the bridge to launch it over REST instead.
            setTimeout(function () { if (!document.hidden) { send("log", ids[i] + " did not open, asking the bridge"); bridgeLaunch(pkg); } }, 3500);
          },
          function (err) { send("log", "launch " + ids[i] + ": " + (err && err.name)); attempt(i + 1); });
      } catch (e) { send("log", "launch " + ids[i] + " threw " + e); attempt(i + 1); }
    })(0);
    return true;
  }

  function iconUrl(pkg) {
    if (pkg === SKY) return "logo-sky.png";
    if (pkg === LIVE) return "logo-livetv.png";
    var m = MAP[pkg];
    if (m && m.logo) return "logos/" + pkg + ".png";
    var a = byPkg[pkg];
    var own = [pkg].concat(a ? [a.id, a.packageId, a.name] : []).filter(function (n) { return n && OWN_LOGOS[n]; })[0];
    if (own) return "logos/" + own + ".png";
    // the TV hands couch-tv no other app's icon file (a QN90F, Tizen 9.0): the bridge finds the app's
    // icon by its name (bridge/appicons.py). A picture that fails shows the app's name instead.
    var name = (a && a.name) || (m && m.name);
    if (BRIDGE && name) {
      var q = ["name=" + encodeURIComponent(name)];
      if (TV_ID) q.push("tv=" + TV_ID);
      if (S.key) q.push("key=" + encodeURIComponent(S.key));
      return BRIDGE + "/api/tizen/icon?" + q.join("&");
    }
    if (a && a.iconPath) return /^[a-z]+:/.test(a.iconPath) ? a.iconPath : "file://" + a.iconPath;
    return null;
  }

  function homeRequest(method, path, data, wait) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, BRIDGE + path + (TV_ID ? (path.indexOf("?") < 0 ? "?" : "&") + "tv=" + TV_ID : ""));
      if (S.key) x.setRequestHeader("Authorization", "Bearer " + S.key);
      if (data) x.setRequestHeader("Content-Type", "application/json");
      x.timeout = wait || 2000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); return; } catch (e) {}
        }
        reject(new Error("Bridge request failed"));
      };
      x.onerror = x.ontimeout = function () { reject(new Error("Bridge not reachable")); };
      x.send(data ? JSON.stringify(data) : null);
    });
  }

  function reportHomeApps() {
    if (!HOME || !BRIDGE) return;
    var ids = Object.keys(byPkg).map(function (pkg) { return byPkg[pkg].id; });
    homeRequest("POST", "/api/tizen/home", { apps: ids }).catch(function () {});
  }
  reportHomeApps();

  function homeKept(k) { try { return +localStorage.getItem("couch.home." + k) || 0; } catch (e) { return 0; } }
  function homeKeep(k, v) { try { localStorage.setItem("couch.home." + k, String(v)); } catch (e) {} }
  function shortcut() { return homeKept("shortcut") === 2 ? "tile" : "double"; }

  function samsungKey(key) {
    return homeRequest("POST", "/api/key", { key: key }).then(function () {
      if (key === "smart_hub") homeKeep("quiet", Date.now() + 120000);
    });
  }
  window.TVOS = {
    apps: function () { return JSON.stringify(shown); },
    launch: launch,
    iconUrl: iconUrl,
    bannerUrl: function () { return null; },
    // Samsung's system screens cannot be opened as Android packages.
    samsungKey: BRIDGE ? samsungKey : null,
    samsungHomeShortcut: HOME && BRIDGE ? shortcut : null,
    toggleSamsungHomeShortcut: function () { homeKeep("shortcut", shortcut() === "double" ? 2 : 1); },
    // Home settings, Samsung behaviour, Live TV arrows: which arrows change channel (livetv.js)
    liveTvKeys: LIVE_ON ? function () { return homeKept("livekeys") === 2 ? "leftright" : "updown"; } : null,
    toggleLiveTvKeys: function () { homeKeep("livekeys", homeKept("livekeys") === 2 ? 1 : 2); },
    // Home settings, Samsung behaviour, Live TV opens on: "" the last channel, "home", or a country code
    liveTvStart: LIVE_ON ? function () { try { return localStorage.getItem("couch.home.livestart") || ""; } catch (e) { return ""; } } : null,
    setLiveTvStart: function (v) { try { localStorage.setItem("couch.home.livestart", String(v || "")); } catch (e) {} },
    // Home settings, Samsung behaviour, Live TV countries: kept by the bridge, so only with one
    liveTvCountries: LIVE_ON && BRIDGE ? true : null,
    // the gear menu: Look for new apps, and Samsung's app store
    refreshApps: readApps,
    openStore: openStore,
    // Home settings, About: couch-tv's version (it said "Web preview" on a Samsung, 20 Nov 2026)
    version: function () { return String(S.version || ""); },
    kept: function (k) { try { return localStorage.getItem("tvos." + k); } catch (e) { return null; } },
    keep: function (k, v) { try { localStorage.setItem("tvos." + k, v); } catch (e) {} },
    // the input button goes through the bridge (it presses Source); a web app cannot open that list
    canOpenInputs: function () { return false; },
    openInputs: function () { return false; }
  };

  // ---------- the remote ----------
  // Arrows, OK (Enter) and Back (10009) reach the page by themselves. Tools (the remote's menu key)
  // has to be asked for: it picks an app up, like holding OK.
  var TOOLS = null;
  try {
    tizen.tvinputdevice.registerKey("Tools");
    TOOLS = tizen.tvinputdevice.getKey("Tools").code;
  } catch (e) {}
  document.addEventListener("keydown", function (e) {
    if (TOOLS !== null && e.keyCode === TOOLS) {
      e.preventDefault();
      e.stopImmediatePropagation();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
    }
  }, true);

  // ---------- Samsung's on-screen keyboard ----------
  // Its Done key reaches the page as keyCode 65376 ("Select"), not Enter, so a code typed for Get a
  // design was never sent, and the keyboard stayed up (seen on a 2021 Frame, 19 Nov 2026). Done in a
  // text box now counts as Enter (the home's own typing then sends it) and closes the keyboard.
  // Text typed from the phone remote (the bridge's /api/text) arrives just after its Done, so the
  // Enter waits a moment for the box to hold what was typed.
  var IME_DONE = 65376;
  document.addEventListener("keydown", function (e) {
    var box = document.activeElement;
    if (e.keyCode !== IME_DONE || !box || box.tagName !== "INPUT") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setTimeout(function () {
      if (document.activeElement !== box) return;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      try { if (document.activeElement === box) box.blur(); } catch (err) {}
    }, 400);
  }, true);

  // ---------- jobs only an app on the TV may do (bridge/samsung.py open_title) ----------
  // The bridge cannot open a title in Prime, Stan and the rest itself: a Samsung app passes the
  // title on with launchAppControl (operation eden_resume, PAYLOAD {"values": <JustWatch's
  // action_data>}). This asks the bridge for jobs while couch-tv is on screen.
  var polling = false;
  function answer(id, ok, error) {
    try {
      var x = new XMLHttpRequest();
      x.open("POST", BRIDGE + "/api/tizen/answer");
      x.setRequestHeader("Content-Type", "application/json");
      if (S.key) x.setRequestHeader("Authorization", "Bearer " + S.key);
      x.send(JSON.stringify({ tv: TV_ID || undefined, id: id, ok: ok, error: error || null }));
    } catch (e) {}
  }
  function run(job) {
    send("log", "job " + JSON.stringify(job));
    if (job.do !== "appcontrol") { answer(job.id, false, "unknown job " + job.do); return; }
    try {
      var data = [new tizen.ApplicationControlData("PAYLOAD", [JSON.stringify({ values: job.data })])];
      var ctl = new tizen.ApplicationControl("http://samsung.com/appcontrol/operation/eden_resume", null, null, null, data);
      tizen.application.launchAppControl(ctl, job.app,
        function () { answer(job.id, true); },
        function (e) { answer(job.id, false, (e && e.name) + ": " + (e && e.message)); });
    } catch (e) { answer(job.id, false, String(e)); }
  }
  function jobs() {
    if (!BRIDGE || document.hidden) { polling = false; return; }
    polling = true;
    var x = new XMLHttpRequest();
    x.open("GET", BRIDGE + "/api/tizen/next" + (TV_ID ? "?tv=" + TV_ID : ""));
    if (S.key) x.setRequestHeader("Authorization", "Bearer " + S.key);
    x.timeout = 35000;
    x.onload = function () {
      var job = null;
      try { job = JSON.parse(x.responseText).job; } catch (e) {}
      if (job) run(job);
      setTimeout(jobs, 50);
    };
    x.onerror = x.ontimeout = function () { setTimeout(jobs, 3000); };
    x.send();
  }
  jobs();

  // ---------- Samsung's Home button brings couch-tv back ("home_button" in config.json) ----------
  // No app can take a Samsung's Home key, and the TV's REST API answers 404 for every system app. What
  // does show it: Samsung's home starts com.samsung.tv.homeupdateview for a few seconds each time it
  // opens (a 2025 QN90F, Tizen 9.0: every Home press, from couch-tv and from inside YouTube; not when an
  // app opens, nor for Settings). Source starts it too, as an overlay: couch-tv stays in front then.
  // Background support keeps this watch running even when hidden. Source from another app looks
  // like Home on this firmware. Home again shortly after a bounce is the default escape.
  if (HOME && window.tizen && tizen.application && tizen.application.getAppsContext) {
    var markers = HOME.markers || ["com.samsung.tv.homeupdateview"];
    var running = null, startedAt = 0;   // startedAt: when a marker last started
    var checking = false;
    // Back to the front without starting the page again: config.xml's app-control for this operation
    // has reload="disable", so Tizen sends an appcontrol event to the page instead of reloading it
    // (a reload put the empty home, "Keep watching" on black, up for a moment on every Home press).
    // A TV that refuses the app-control gets the plain launch, which reloads.
    var FRONT = "http://couch-tv.app/appcontrol/operation/front";
    var bringBack = function () {
      var reload = function () {
        tizen.application.launch(SELF, function () {}, function (e) { send("log", "home: reopen failed " + (e && e.name)); });
      };
      try {
        tizen.application.launchAppControl(new tizen.ApplicationControl(FRONT), SELF, function () {}, reload);
      } catch (e) { reload(); }
    };
    // couch-tv back on screen (opened by hand, by the bridge after a restart, or by the TV): Samsung's
    // home is no longer wanted, so Home works again at once. 26 Nov 2026: holding Power to restart
    // showed the power menu 3 seconds after a bounce, which reads as Home twice, and the 2 minute
    // quiet outlived the restart, so Home did nothing once the TV was back.
    var endQuiet = function () {
      if (document.hidden) return;
      if (homeKept("quiet") > Date.now()) {
        homeKeep("quiet", 0);
        send("log", "home: couch-tv is back, Home brings it back again");
      }
      if (BRIDGE) homeRequest("POST", "/api/tizen/home", { quiet: false }).catch(function () {});
    };
    endQuiet();
    // the bridge tells a restart from a Wi-Fi dropout by this: the page only starts again after one
    if (BRIDGE) homeRequest("POST", "/api/tizen/home", { started: true }).catch(function () {});
    var exitAt = 0;   // when couch-tv came back because the app it opened was closed
    var comeBack = function (why) {
      // Samsung's home opens right after the app closes: the same moment, not a second Home press
      if (checking || Date.now() < homeKept("quiet") || Date.now() - exitAt < 4000) return;
      function decide(state) {
        checking = false;
        var t = Date.now();
        if (!document.hidden || t < homeKept("quiet") || (state && state.quiet)) return;
        if (shortcut() === "double" && (t - homeKept("back") < 5000 || (state && state.reopened))) {
          homeKeep("quiet", t + 120000);
          if (BRIDGE) homeRequest("POST", "/api/tizen/home", { quiet: true }).catch(function () {});
          send("log", "home: pressed twice, Samsung's home stays");
          return;
        }
        homeKeep("back", t);
        send("log", "home: " + why + ", back to couch-tv");
        bringBack();
      }
      if (BRIDGE) {
        checking = true;
        homeRequest("GET", "/api/tizen/home").then(decide, function () { decide(null); });
      } else decide(null);
    };
    var reading = false;
    var look = function () {
      if (reading) return;
      reading = true;
      try {
        tizen.application.getAppsContext(function (list) {
          reading = false;
          var now = {};
          list.forEach(function (c) { now[c.appId] = true; });
          // --log-url only: every change in the running apps, to find a firmware's markers
          if (LOG) {
            var plus = Object.keys(now).filter(function (a) { return !running || !running[a]; });
            var minus = running ? Object.keys(running).filter(function (a) { return !now[a]; }) : [];
            if (plus.length || minus.length) send("log", "apps" + (document.hidden ? " (hidden)" : "") + ": +" + plus.join(" +") + " -" + minus.join(" -"));
          }
          var started = running && markers.some(function (m) { return now[m] && !running[m]; });
          // The app couch-tv opened was closed (Back, then Exit): couch-tv comes back straight away
          // rather than after Samsung's home has opened (Apple Music, 27 Nov 2026: home flashed up first)
          var closed = selfOpened && running && running[selfOpened] && !now[selfOpened];
          running = now;
          if (closed) {
            send("log", "home: " + selfOpened + " closed, back to couch-tv");
            selfOpened = null;
            if (document.hidden && Date.now() >= homeKept("quiet")) { exitAt = Date.now(); bringBack(); }
          }
          if (!started) return;
          startedAt = Date.now();
          // Home over couch-tv's own Live TV: Samsung's home opens over the playing picture and
          // couch-tv is never hidden (27 Nov 2026), so the checks below never ran. The player closes
          // and couch-tv comes back to the front, on its home.
          if (!document.hidden && window.CouchLiveTV && CouchLiveTV.isOpen() && Date.now() >= homeKept("quiet")) {
            send("log", "home: pressed over Live TV, back to couch-tv");
            CouchLiveTV.close();
            homeKeep("back", startedAt);
            bringBack();
            return;
          }
          if (document.hidden && startedAt - selfLaunchAt >= 4000) comeBack("Samsung's home opened");
        }, function () { reading = false; });
      } catch (e) { reading = false; }
    };
    look();
    setInterval(look, 250);
    // The TV starting up: it opens couch-tv itself, then may put Live TV over it a few seconds later
    // (a QN90F, 26 Nov 2026). Nothing pressed on couch-tv yet and the bridge saw the TV just come back:
    // couch-tv goes straight back in front.
    var pageAt = Date.now(), touched = false;
    document.addEventListener("keydown", function () { touched = true; }, true);
    document.addEventListener("visibilitychange", function () {
      send("log", "visibility: " + (document.hidden ? "hidden" : "shown"));
      if (!document.hidden) { endQuiet(); return; }
      if (Date.now() - selfLaunchAt < 4000) return;   // an app couch-tv opened
      if (!touched && Date.now() - pageAt < 15000 && BRIDGE) {
        // front=1: the bridge also says which app is in front. One someone opened from the phone, or by
        // casting to the TV as it came on, stays; the TV's own Live TV does not.
        homeRequest("GET", "/api/tizen/home?front=1", null, 6000).then(function (s) {
          if (s && s.booting && !s.front && document.hidden && Date.now() >= homeKept("quiet")) {
            send("log", "home: the TV covered couch-tv while starting up, back to couch-tv");
            bringBack();
          }
        }, function () {});
      }
      var t = Date.now();
      if (shortcut() === "double" && t - homeKept("back") < 5000) comeBack("hidden again");
      else if (t - startedAt < 1200) comeBack("Samsung's home opened");   // Home: the part started a moment before
    });
  }

  // coming back to the app (after Netflix, say): read the lists again, and the apps after the store
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && window.tv && window.tv.resume) window.tv.resume();
    if (!document.hidden && !polling) jobs();
    if (!document.hidden && fromStore) { fromStore = false; readApps(null); }
  });
  // --log-url only: Samsung's app store opened over couch-tv without hiding it (a QN90F, 28 Nov 2026),
  // so whether the page keeps the keys is what tells when it is in front
  if (LOG) {
    window.addEventListener("blur", function () { send("log", "focus: lost" + (fromStore ? " (store)" : "")); });
    window.addEventListener("focus", function () { send("log", "focus: back" + (fromStore ? " (store)" : "")); });
  }
})();
