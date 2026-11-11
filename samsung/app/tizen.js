// The Samsung side of the TV home. On Android the launcher app gives the page window.TVOS (the
// apps on the TV, open an app, a place to keep things); on a Samsung this file does the same job
// with Tizen's own calls, so tv-home/web/app.js runs unchanged.
//
// Apps keep their Android names inside the page (Netflix is "com.netflix.ninja"), so the order
// arranged on the phone works on every TV. COUCH_TIZEN_APPS (tizen-apps.js, made by build.py from
// bridge/apps.py) says which Samsung app each one is.
(function () {
  "use strict";
  var S = window.COUCH_TIZEN || {};
  var MAP = window.COUCH_TIZEN_APPS || {};
  var SELF = "CouchTVApp.Home";
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
    document.addEventListener("keydown", function (e) { send("log", "key " + e.keyCode + " " + e.key); }, true);
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
  var byPkg = {}, shown = [];
  function sortOut() {
    byPkg = {}; shown = [];
    tizenApps.forEach(function (a) {
      if (a.id === SELF || a.packageId === SELF.split(".")[0]) return;
      var pkg = byTizen[a.id] || byTizen[a.packageId];
      if (pkg && !byPkg[pkg]) {
        byPkg[pkg] = a;
        shown.push({ package: pkg, label: MAP[pkg].name || a.name });
      } else if (!pkg && a.show && STORE.test(a.packageId || "") && !HIDE.test(a.name || "") && !byPkg[a.id]) {
        byPkg[a.id] = a;
        shown.push({ package: a.id, label: a.name });
      }
    });
    if (SKY_PORT) shown.unshift({ package: SKY, label: "Sky" });
  }
  var SKY = "local.sky", SKY_PORT = parseInt(S.sky_hdmi, 10) || 0, skyOn = false;
  sortOut();
  send("log", "apps on this TV: " + tizenApps.length + ", shown: " + shown.map(function (a) { return a.label; }).join(", "));

  // The list in localStorage is last time's. Read it again a few seconds after the home is up (a TV
  // with hundreds of apps takes several seconds to answer), save it, and reload the home only if the
  // apps shown have changed (#53).
  setTimeout(function () {
    try {
      tizen.application.getAppsInfo(function (list) {
        var fresh = list.map(function (a) {
          return { id: a.id, name: a.name, packageId: a.packageId, iconPath: a.iconPath, show: a.show };
        });
        var before = shown.map(function (a) { return a.package; }).join("|");
        try { localStorage.setItem("couch.tizen.apps", JSON.stringify(fresh)); } catch (e) {}
        tizenApps = fresh;
        sortOut();
        if (shown.map(function (a) { return a.package; }).join("|") !== before) {
          send("log", "app list changed, reloading");
          location.reload();
        }
      }, function () {});
    } catch (e) {}
  }, 4000);

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

  function launch(pkg) {
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
        tizen.application.launch(ids[i], function () { send("log", "launched " + ids[i]); },
          function (err) { send("log", "launch " + ids[i] + ": " + (err && err.name)); attempt(i + 1); });
      } catch (e) { send("log", "launch " + ids[i] + " threw " + e); attempt(i + 1); }
    })(0);
    return true;
  }

  function iconUrl(pkg) {
    if (pkg === SKY) return "logo-sky.png";
    var m = MAP[pkg];
    if (m && m.logo) return "logos/" + pkg + ".png";
    var a = byPkg[pkg];
    if (a && a.iconPath) return /^[a-z]+:/.test(a.iconPath) ? a.iconPath : "file://" + a.iconPath;
    return null;
  }

  window.TVOS = {
    apps: function () { return JSON.stringify(shown); },
    launch: launch,
    iconUrl: iconUrl,
    bannerUrl: function () { return null; },
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

  // coming back to the app (after Netflix, say): read the lists again
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && window.tv && window.tv.resume) window.tv.resume();
    if (!document.hidden && !polling) jobs();
  });
})();
