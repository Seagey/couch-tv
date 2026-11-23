/* Phone remote keys for the couch-tv app on a Fire TV running Vega OS.
 *
 * Vega has no way for the network to press a key on the stick, so the page asks the bridge for them
 * (a long poll on /api/vega/keys) and presses them on itself. It does nothing anywhere else: the
 * Vega app opens this page with ?vega=1, every other TV and browser leaves it asleep. The asking is
 * also how the bridge knows couch-tv is in front. */
(function () {
  "use strict";
  var Q = location.search;
  if (!/[?&]vega=1\b/.test(Q)) return;
  var API = decodeURIComponent((Q.match(/[?&]api=([^&]+)/) || [])[1] || "");
  var TV_ID = (Q.match(/[?&]tv=([a-z-]+)/) || [])[1] || "";
  var KEY = decodeURIComponent((Q.match(/[?&]key=([^&]+)/) || [])[1] || "");
  if (!KEY) { try { KEY = localStorage.getItem("couchtv.key") || ""; } catch (e) {} }
  var after = 0;
  var CODES = { Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
                MediaPlayPause: 179, MediaRewind: 227, MediaFastForward: 228, ContextMenu: 93 };

  function press(key) {
    var target = document.activeElement || document.body || document;
    var code = CODES[key] || 0;
    ["keydown", "keyup"].forEach(function (type) {
      var e = new KeyboardEvent(type, { key: key, bubbles: true, cancelable: true });
      // the page may read keyCode as well as key, and some engines ignore keyCode in the constructor
      try { Object.defineProperty(e, "keyCode", { get: function () { return code; } }); } catch (x) {}
      try { Object.defineProperty(e, "which", { get: function () { return code; } }); } catch (x) {}
      target.dispatchEvent(e);
    });
  }

  function poll() {
    var x = new XMLHttpRequest();
    x.open("GET", API + "/api/vega/keys?after=" + after + (TV_ID ? "&tv=" + TV_ID : ""));
    x.timeout = 30000;
    if (KEY) x.setRequestHeader("Authorization", "Bearer " + KEY);
    function next(ms) { setTimeout(poll, ms); }
    x.onload = function () {
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status === 200 && j && j.ok) {
        (j.keys || []).forEach(function (k) { press(k.key); });
        if (typeof j.last === "number") after = j.last;
        next(50);
      } else {
        next(3000);
      }
    };
    x.onerror = function () { next(3000); };
    x.ontimeout = function () { next(1000); };
    x.send();
  }
  poll();
})();
