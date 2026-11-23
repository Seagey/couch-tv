// A couch-tv Studio design runs under a page policy (designer-gate.js lockPage). It lets the page
// talk to "self", https and this computer, which on Android covers the bridge (it serves the page).
// On a Samsung the page is a file on the TV and the bridge is another computer at home on plain
// http, so with a design on, every call to the bridge was refused: live data, the jobs the bridge
// hands this app (opening a title in Prime or Stan) and the bridge's settings (seen on a 2021 Frame,
// 19 Nov 2026). This adds this TV's own bridge, and nothing else, to that policy.
// Loaded right after designer-gate.js (build.py). With no bridge it changes nothing.
(function () {
  "use strict";
  var D = window.CouchDesigner;
  if (!D || typeof D.policy !== "function") return;
  var S = window.COUCH_TIZEN || {};
  var HOME = /^(http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|([a-z0-9-]{1,63}\.)+(local|lan|home\.arpa))(:\d{1,5})?)\/?$/i;
  function origin(u) { var m = HOME.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
  var api = /[?&]api=([^&]+)/.exec(location.search);
  var extra = [];
  [api ? decodeURIComponent(api[1]) : "", S.log].forEach(function (u) {
    var o = origin(u);
    if (o && extra.indexOf(o) < 0) extra.push(o);
  });
  if (!extra.length) return;
  var add = " " + extra.join(" ");

  function withBridge(p) {
    return p.replace("connect-src 'self'", "connect-src 'self'" + add)
      .replace("img-src 'self'", "img-src 'self'" + add)
      .replace("media-src 'self'", "media-src 'self'" + add);
  }
  D.policyOnTizen = function (opts) { return withBridge(D.policy(opts)); };
  D.lockPage = function (doc, opts) {
    doc = doc || document;
    if (!doc || !doc.head || doc.querySelector && doc.querySelector('meta[data-tvdesigner="policy"]')) return false;
    var m = doc.createElement("meta");
    m.setAttribute("http-equiv", "Content-Security-Policy");
    m.setAttribute("content", withBridge(D.policy(opts)));
    m.setAttribute("data-tvdesigner", "policy");
    doc.head.appendChild(m);
    return true;
  };
})();
