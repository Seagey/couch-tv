// Is a newer couch-tv for Samsung out? A Samsung app cannot update itself (only a computer can put
// an app on the TV), so this only says so, plainly, on the home: once a day at most, for 25
// seconds, and any key hides it. It never installs anything.
//
// It asks GitHub for couch-tv's latest release (the same question the Android home asks), at most
// once a day, with nothing about this TV in it: no cookies, no settings, no address of its own. A
// release counts only if it carries a Samsung app (a .wgt file), so an Android-only release never
// shows the note. The answer is untrusted: only a version number like 0.13.4 is read from it.
(function () {
  "use strict";
  var S = window.COUCH_TIZEN || {};
  var MINE = String(S.version || "");
  var REPO = "Seagey/couch-tv";
  var DAY = 24 * 3600 * 1000, KEY = "couch.update", HELP = "couchtv.joshuaseage.com/help/tv-samsung";

  function parse(v) {
    var m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v || "").trim());
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function newer(a, b) {   // is version a newer than b?
    var x = parse(a), y = parse(b);
    if (!x || !y) return false;
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  }
  // the latest release's version, if it has a Samsung app in it; "" otherwise
  function fromRelease(text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return ""; }
    if (!j || typeof j !== "object" || j.draft || j.prerelease) return "";
    var tag = parse(j.tag_name) ? String(j.tag_name).replace(/^v/, "") : "";
    var samsung = (Array.isArray(j.assets) ? j.assets : []).some(function (a) {
      return a && /^couch-tv-samsung[A-Za-z0-9._-]*\.(wgt|zip)$/.test(String(a.name || ""));
    });
    return tag && samsung ? tag : "";
  }
  function words(latest) {
    return "couch-tv " + latest + " is out (this TV has " + MINE + "). couch-tv on a Samsung does not update itself: " +
      "on your computer, open the couch-tv Samsung setup again and it puts the new one on. Your settings stay. " +
      "Help: " + HELP;
  }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  function show(latest) {
    if (!document.body || document.getElementById("update-note")) return;
    var n = document.createElement("div");
    n.id = "update-note";
    n.setAttribute("role", "status");
    n.style.cssText = "position:fixed;left:64px;right:64px;bottom:56px;z-index:99998;padding:22px 30px;" +
      "border-radius:14px;background:rgba(12,12,16,0.94);color:#fff;font:26px/1.4 sans-serif";
    n.textContent = words(latest);
    document.body.appendChild(n);
    function hide() {
      if (n.parentNode) n.parentNode.removeChild(n);
      document.removeEventListener("keydown", hide, true);
    }
    document.addEventListener("keydown", hide, true);
    setTimeout(hide, 25000);
  }

  var busy = "", error = "";
  // Home settings, About and Updates read this (window.TVUP, the same shape as the Android apps').
  // A Samsung app cannot install anything, so it is "manual": the page shows the steps below.
  var STEPS = [
    "On your computer, open the couch-tv Samsung setup again: couch-tv-samsung-setup.zip from couch-tv's Releases page on GitHub, then Install on Mac or Install on Windows.",
    "Keep this TV switched on. The setup puts the new couch-tv on it, and your settings stay.",
    "Help: " + HELP
  ];
  function state() {
    var st = read(), latest = String(st.latest || "");
    return JSON.stringify({
      supported: true, manual: true, current: MINE, channel: "stable", latest: latest, title: "",
      available: !!(latest && newer(latest, MINE)), refused: false, checked: st.checked || 0,
      auto: st.auto !== false, answered: true, busy: busy, progress: 0, error: error,
      code: "", how: "couch-tv on a Samsung does not update itself: a computer puts the new one on.", steps: STEPS
    });
  }
  function tell() { try { if (window.tv && window.tv.update) window.tv.update(JSON.parse(state())); } catch (e) {} }

  // now: the time; asked: someone pressed Check for updates now (no once-a-day limit, no note)
  function check(now, asked) {
    var st = read();
    if (!asked && st.auto === false) return;   // Tell me off: no note and no look by itself
    if (!asked && st.latest && newer(st.latest, MINE) && now - (st.shown || 0) > DAY) {
      st.shown = now; save(st); show(st.latest);
    }
    // "tried" keeps the look to once a day even when it fails; "checked" is only a look that answered,
    // so a failed one never reads "This is the latest version"
    if (!asked && now - (st.tried || st.checked || 0) < DAY) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { error = "net"; tell(); return; }
    st.tried = now; save(st);
    busy = "checking"; error = ""; tell();
    var x = new XMLHttpRequest();
    x.onload = function () {
      busy = "";
      if (x.status !== 200 || x.responseText.length > 400000) { error = "net"; tell(); return; }
      var latest = fromRelease(x.responseText), s = read();
      s.latest = latest;
      s.checked = Date.now();
      save(s);
      tell();
      if (!asked && latest && newer(latest, MINE) && Date.now() - (s.shown || 0) > DAY) { s.shown = Date.now(); save(s); show(latest); }
    };
    x.onerror = x.ontimeout = function () { busy = ""; error = "net"; tell(); };
    try {
      x.open("GET", "https://api.github.com/repos/" + REPO + "/releases/latest");
      x.setRequestHeader("Accept", "application/vnd.github+json");
      x.withCredentials = false;
      x.timeout = 15000;
      x.send();
    } catch (e) { busy = ""; error = "net"; tell(); }
  }

  window.CouchSamsungUpdate = { newer: newer, fromRelease: fromRelease, words: words, state: state };
  if (!MINE || /[?&](mock|designer=1)\b/.test(location.search)) return;
  window.TVUP = {
    state: state,
    check: function () { if (!busy) check(Date.now(), true); },
    install: function () {},   // nothing to install on the TV: the page shows the steps
    auto: function (on) { var st = read(); st.auto = !!on; save(st); tell(); }
  };
  setTimeout(function () { if (!document.hidden) check(Date.now()); }, 20000);   // after the home has settled
})();
