// The bridge this TV was set up with, kept on the TV. A build made for a bridge (build.py --bridge)
// saves its address, pairing key and TV id here; the plain release package (no bridge in it) then
// uses the saved ones. So putting a newer release on a TV that has a bridge (the Samsung setup on
// the computer, run again) keeps the bridge, and a TV without one is unchanged.
// Loaded right after settings.js, on boot.html and on the home (build.py).
(function () {
  "use strict";
  var S = window.COUCH_TIZEN || (window.COUCH_TIZEN = {});
  var KEY = "couch.tizen.kept";
  // a bridge is a plain home network address, http and a port, nothing more
  var OK = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
  try {
    if (S.bridge && OK.test(S.bridge)) {
      localStorage.setItem(KEY, JSON.stringify({ bridge: S.bridge, key: S.key || "", tv: S.tv || "" }));
    } else if (!S.bridge) {
      var k = JSON.parse(localStorage.getItem(KEY) || "null");
      if (k && typeof k.bridge === "string" && OK.test(k.bridge)) {
        S.bridge = k.bridge;
        if (!S.key && typeof k.key === "string" && /^[A-Za-z0-9_-]{0,128}$/.test(k.key)) S.key = k.key;
        if (!S.tv && typeof k.tv === "string" && /^[a-z0-9-]{0,40}$/.test(k.tv)) S.tv = k.tv;
      }
    }
  } catch (e) {}
})();
