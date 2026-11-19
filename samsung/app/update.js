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

  function check(now) {
    var st = read();
    if (st.latest && newer(st.latest, MINE) && now - (st.shown || 0) > DAY) {
      st.shown = now; save(st); show(st.latest);
    }
    if (now - (st.checked || 0) < DAY || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    st.checked = now; save(st);
    var x = new XMLHttpRequest();
    x.open("GET", "https://api.github.com/repos/" + REPO + "/releases/latest");
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.withCredentials = false;
    x.timeout = 15000;
    x.onload = function () {
      if (x.status !== 200 || x.responseText.length > 400000) return;
      var latest = fromRelease(x.responseText), s = read();
      s.latest = latest;
      save(s);
      if (latest && newer(latest, MINE) && Date.now() - (s.shown || 0) > DAY) { s.shown = Date.now(); save(s); show(latest); }
    };
    x.send();
  }

  window.CouchSamsungUpdate = { newer: newer, fromRelease: fromRelease, words: words };
  if (!MINE || /[?&](mock|designer=1)\b/.test(location.search)) return;
  setTimeout(function () { if (!document.hidden) check(Date.now()); }, 20000);   // after the home has settled
})();
