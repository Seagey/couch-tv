// Icon styles for designs: Couch TV Studio's icon sets (icon-sets.js, window.TVIcons, a copy of
// tools/tv-designer/icons/icon-sets.js) registered with the design code, so a design's smart home
// widgets and sections can pick a style (design object `icon_style`). A design only names a style;
// the drawings are this code's own. Without icon-sets.js nothing changes (the built in icons stay).
// Load after design.js and icon-sets.js.
(function () {
  "use strict";
  var T = window.TVIcons, CD = window.CouchDesign;
  if (!T || !CD || !CD.registerIcons) return;
  // design.js's icon names, and the icon in the sets that draws each
  var NAMES = { aircon: "aircon", light: "light", speaker: "speaker", camera: "camera", doorbell: "doorbell", network: "wifi",
    devices: "tv", vacuum: "home", appliance: "outlet", scene: "favourite", power: "power", sun: "sun" };
  // whole tile styles carry their own backing: no round disc of ours behind them
  var FULL = { tile: true, glass: true, playful: true };
  (T.styles || []).forEach(function (st) {
    var map = {};
    Object.keys(NAMES).forEach(function (k) { var s = T.svg(st.id, NAMES[k], 0); if (s) map[k] = s; });
    CD.registerIcons("set-" + st.id, st.name, map, { full: !!FULL[st.id] });
  });
})();
