// The LG side of the TV home. On Android the launcher app gives the page window.TVOS (the apps on
// the TV, open an app, a place to keep things); on an LG this file does the same job with webOS's
// own service calls, so tv-home/web/app.js runs unchanged.
//
// Apps keep their Android names inside the page (Netflix is "com.netflix.ninja"), so the order
// arranged on the phone works on every TV. COUCH_WEBOS_APPS (webos-apps.js, made by build.py from
// bridge/apps.py) says which LG app each one is; apps it does not know are matched by name.
(function () {
  "use strict";
  var S = window.COUCH_WEBOS || {};
  var MAP = window.COUCH_WEBOS_APPS || {};
  var LOGOS = window.COUCH_WEBOS_LOGOS || {};   // logos bundled in the package: name -> true
  var SELF = "app.couchtv.home";
  var BRIDGE = ((location.search.match(/[?&]api=([^&]+)/) || [])[1] || "");
  BRIDGE = decodeURIComponent(BRIDGE);
  var TV_ID = (location.search.match(/[?&]tv=([a-z0-9-]+)/) || [])[1] || "";

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
    // and how long from each key press until the next frame is on screen, with the page's classes,
    // to see what a slow TV stalls on (an LG 43SQ700S froze when Home settings opened)
    document.addEventListener("keydown", function (e) {
      var t0 = performance.now(), k = e.keyCode, key = e.key;
      setTimeout(function () {
        var js = performance.now() - t0;
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          send("log", "key " + k + " " + key + ": js " + Math.round(js) + " ms, on screen " + Math.round(performance.now() - t0)
            + " ms, " + document.documentElement.className);
        }); });
      }, 0);
    }, true);
  }

  // ---------- webOS service calls ----------
  // PalmServiceBridge is what LG's webOSTV.js uses underneath. A call is lost if nothing holds on
  // to it until it answers, so each one is kept in `held` until then.
  var held = [];
  function luna(uri, params, done) {
    var b;
    try { b = new PalmServiceBridge(); } catch (e) { if (done) done(null); return; }
    held.push(b);
    b.onservicecallback = function (msg) {
      held.splice(held.indexOf(b), 1);
      var r = null;
      try { r = JSON.parse(msg); } catch (e) {}
      if (done) done(r);
    };
    try { b.call(uri, JSON.stringify(params || {})); } catch (e) { held.splice(held.indexOf(b), 1); if (done) done(null); }
  }

  // ---------- the apps on this TV ----------
  var lgApps = [];
  try { lgApps = JSON.parse(localStorage.getItem("couch.webos.apps") || "[]"); } catch (e) {}
  function plain(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  var byLg = {}, byName = {};   // LG app id (or a plain name) -> Android-style package
  Object.keys(MAP).forEach(function (pkg) {
    var m = MAP[pkg];
    (m.ids || []).forEach(function (id) { byLg[id] = pkg; });
    [m.name].concat(m.names || []).forEach(function (n) { if (n) byName[plain(n)] = pkg; });
  });
  // LG's own parts (live TV, inputs, settings, the store, Developer Mode) are not shown on the home.
  var SYSTEM = /^(com\.webos\.|com\.palm\.|com\.lge\.|com\.palmdts\.)/;
  var byPkg = {}, shown = [];
  lgApps.forEach(function (a) {
    if (a.id === SELF) return;
    var pkg = byLg[a.id] || byName[plain(a.title)];
    if (pkg && !byPkg[pkg]) {
      byPkg[pkg] = a;
      shown.push({ package: pkg, label: MAP[pkg].name || a.title });
    } else if (!pkg && !SYSTEM.test(a.id || "") && !byPkg[a.id]) {
      byPkg[a.id] = a;
      shown.push({ package: a.id, label: a.title });
    }
  });
  send("log", "apps on this TV: " + lgApps.length + ", shown: " + shown.map(function (a) { return a.label; }).join(", "));

  function bridgeLaunch(pkg) {
    if (!BRIDGE) return;
    var x = new XMLHttpRequest();
    x.open("POST", BRIDGE + "/api/launch");
    x.setRequestHeader("Content-Type", "application/json");
    if (S.key) x.setRequestHeader("Authorization", "Bearer " + S.key);
    x.send(JSON.stringify(TV_ID ? { app: pkg, tv: TV_ID } : { app: pkg }));
  }

  function launch(pkg) {
    var a = byPkg[pkg], m = MAP[pkg];
    var ids = a ? [a.id] : [];
    if (m) (m.ids || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    if (!ids.length && /\./.test(pkg)) ids.push(pkg);
    if (!ids.length) return false;
    (function attempt(i) {
      if (i >= ids.length) { send("log", "launch failed for " + pkg + ", asking the bridge"); bridgeLaunch(pkg); return; }
      luna("luna://com.webos.applicationManager/launch", { id: ids[i] }, function (r) {
        if (r && r.returnValue) send("log", "launched " + ids[i]);
        else { send("log", "launch " + ids[i] + ": " + (r ? r.errorText || r.errorCode : "no answer")); attempt(i + 1); }
      });
    })(0);
    return true;
  }

  function iconUrl(pkg) {
    // a bundled logo first: the icon addresses the TV gives are a 404 on several TVs (#40, #45)
    var m = MAP[pkg];
    if ((m && m.logo) || LOGOS[pkg]) return "logos/" + pkg + ".png";
    var a = byPkg[pkg];
    if (a && a.icon) return /^[a-z]+:/.test(a.icon) ? a.icon : "file://" + a.icon;
    return null;
  }

  // ---------- Developer Mode: press its own Extend ----------
  // LG removes apps installed in Developer Mode when the session runs out. The Extend button is inside
  // LG's Developer Mode app; the app is opened with {"extend": true} (the same as
  // `ares-launch com.palmdts.devmode -p '{"extend":true}'`), which presses it on the way in. The
  // Developer Mode app takes the screen; the home is opened again from the TV (Home, then couch-tv).
  var DEVMODE = "com.palmdts.devmode";
  var extendAt = 0;
  // The Developer Mode app takes the screen and sends the Extend itself. webOS freezes this page's
  // timers while another app is in front, so the home cannot bring itself back; app.js says the
  // Extend is done when the home is opened again (devResume there, which reads its own note).
  function extendDevMode(done) {
    if (Date.now() - extendAt < 60000) return false;   // one press at a time
    extendAt = Date.now();
    luna("luna://com.webos.applicationManager/launch", { id: DEVMODE, params: { extend: true } }, function (r) {
      var ok = !!(r && r.returnValue);
      send("log", "devmode extend: " + (ok ? "launched" : (r ? r.errorText || r.errorCode : "no answer")));
      if (!ok) { extendAt = 0; if (done) done(false); }
    });
    return true;
  }

  window.TVOS = {
    apps: function () { return JSON.stringify(shown); },
    launch: launch,
    iconUrl: iconUrl,
    bannerUrl: function () { return null; },
    extendDevMode: extendDevMode,
    kept: function (k) { try { return localStorage.getItem("tvos." + k); } catch (e) { return null; } },
    keep: function (k, v) { try { localStorage.setItem("tvos." + k, v); } catch (e) {} },
    // the input button goes through the bridge; a web app cannot open LG's input list
    canOpenInputs: function () { return false; },
    openInputs: function () { return false; }
  };

  // ---------- the remote ----------
  // Arrows and OK reach the page by themselves. LG's Back is key 461: with disableBackHistoryAPI
  // (appinfo.json) it comes to the page, and is passed on as Escape, which the home knows.
  document.addEventListener("keydown", function (e) {
    if (e.keyCode === 461) {
      e.preventDefault();
      e.stopImmediatePropagation();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }, true);

  // ---------- coming back to the app ----------
  // appinfo.json sets handlesRelaunch, so opening the app again does not restart it (that restart
  // was the black flash: the TV threw the page away and started a new one) and webOS sends
  // webOSRelaunch instead. It does not bring the app forward by itself, though: on webOS 6.5.3 the
  // home stayed behind whatever was on screen, and after the Developer Mode Extend the TV sat on
  // the Developer Mode app. PalmSystem.activate() is LG's own call for that. On a TV without it the
  // try/catch leaves everything as it was.
  function activate() {
    try { if (window.PalmSystem && PalmSystem.activate) PalmSystem.activate(); } catch (e) {}
  }
  // coming back to the app (after Netflix, say, or the bridge opening it again): read the lists again
  function resume() { if (!document.hidden && window.tv && window.tv.resume) window.tv.resume(); }
  document.addEventListener("webOSRelaunch", function () { activate(); resume(); });
  document.addEventListener("visibilitychange", resume);
})();
