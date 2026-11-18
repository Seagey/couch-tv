// TV Designer is opt in. Until the person at the TV turns it on, the home is exactly the home it was
// before TV Designer existed: no design is drawn, design.js is never started, no widget mode, no
// extra page policy, no "Use this design?" question for a design nobody asked for, and nothing is
// asked of any server. Updating couch-tv (the app or the bridge) never switches it on.
//
// It comes on in one of three ways, each a choice made at the TV:
//   1. Home settings, TV Designer, Turn on TV Designer;
//   2. getting a design by code there (typing the code is asking for it);
//   3. "Use this design" on the question a design in config.json brings (Keep my home, or Back,
//      leaves everything as it was, and the TV does not ask about that design again).
// Home settings, TV Designer, Back to my classic home switches it off in one step, and it stays
// off whatever design arrives later (a design in config.json included) until it is turned on again.
// The design it had is kept, so turning it on again brings it back.
//
// The choice is kept on this TV (app.js keep/kept: the page's storage and the launcher's own store,
// which survive an update of the app), as "on" or "off"; nothing kept means "never chosen".
(function () {
  "use strict";
  var KEY = "tvhome.designer";
  // where "Get a design" and "Share this home" go when config.json names no design_store
  var DEFAULT_STORE = "https://tvdesigner.sites.underseage.studio";
  var DESIGNER_PAGE = DEFAULT_STORE + "/design/";

  // What the home gets, from what it knows. o: {
  //   choice: "on" | "off" | null (the kept choice),
  //   cfgDesign: config.json's "design" (or null), got: a design got by code (or null),
  //   preview: the TV Designer's own preview of this page (?designer=1, or ?mock with ?design=local) }
  // Answers { on, design, fromCode }: on is whether TV Designer counts as on; design is what to hand
  // to design.js (null: design.js is not started at all).
  function decide(o) {
    o = o || {};
    var cfg = o.cfgDesign && typeof o.cfgDesign === "object" && !Array.isArray(o.cfgDesign) ? o.cfgDesign : null;
    var got = o.got && typeof o.got === "object" && !Array.isArray(o.got) ? o.got : null;
    if (o.preview) return { on: true, design: got || cfg, fromCode: !!got, preview: true };
    if (o.choice === "off") return { on: false, design: null, fromCode: false };
    if (o.choice === "on") return { on: true, design: got || cfg, fromCode: !!got };
    // never chosen: a design got by code was asked for at this TV (app.js also keeps "on" when it
    // arrives); a design in config.json only brings the question, which changes nothing until yes
    if (got) return { on: true, design: got, fromCode: true };
    if (cfg) return { on: false, design: cfg, fromCode: false, offered: true };
    return { on: false, design: null, fromCode: false };
  }

  function readChoice(v) { return v === "on" || v === "off" ? v : null; }

  // The page policy a design runs under (it used to sit in index.html for everyone). Only once
  // TV Designer hands design.js a design: a home without one keeps exactly the rules it always had.
  // No inline script, no eval, no plugins, no outside scripts but Spotify's player. Pictures and
  // videos may come from https (posters, photos and video links set in Home settings; a design
  // carries none: design.js refuses outside links), the launcher's own tvos.invalid host, and this
  // page's own server (the bridge, or the launcher's copy).
  var POLICY = "default-src 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https: http://tvos.invalid; media-src 'self' blob: https:; " +
    "connect-src 'self' https: http://127.0.0.1:* http://localhost:*; frame-src https://sdk.scdn.co; font-src 'self' data:; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'";
  function lockPage(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.head || doc.querySelector && doc.querySelector('meta[data-tvdesigner="policy"]')) return false;
    var m = doc.createElement("meta");
    m.setAttribute("http-equiv", "Content-Security-Policy");
    m.setAttribute("content", POLICY);
    m.setAttribute("data-tvdesigner", "policy");
    doc.head.appendChild(m);
    return true;
  }

  window.CouchDesigner = { KEY: KEY, DEFAULT_STORE: DEFAULT_STORE, DESIGNER_PAGE: DESIGNER_PAGE, POLICY: POLICY,
    decide: decide, readChoice: readChoice, lockPage: lockPage };
})();
