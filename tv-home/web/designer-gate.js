// couch-tv Studio is opt in. Until the person at the TV turns it on, the home is exactly the home it was
// before couch-tv Studio existed: no design is drawn, design.js is never started, no widget mode, no
// extra page policy, no "Use this design?" question for a design nobody asked for, and nothing is
// asked of any server. Updating couch-tv (the app or the bridge) never switches it on.
//
// It comes on in one of three ways, each a choice made at the TV:
//   1. Home settings, couch-tv Studio, Turn on couch-tv Studio;
//   2. getting a design by code there (typing the code is asking for it);
//   3. "Use this design" on the question a design in config.json brings (Keep my home, or Back,
//      leaves everything as it was, and the TV does not ask about that design again).
// Home settings, couch-tv Studio, Back to my classic home switches it off in one step, and it stays
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
  //   preview: couch-tv Studio's own preview of this page (?designer=1, or ?mock with ?design=local) }
  // Answers { on, design, fromCode }: on is whether couch-tv Studio counts as on; design is what to hand
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

  // Whether Home settings shows couch-tv Studio as on. The choice just made at the TV wins: decide()
  // is only worked out when the home starts, so straight after Turn on couch-tv Studio the row still
  // read "Off" under "couch-tv Studio is on" (a TCL, 19 Nov 2026).
  function shownOn(choice, gateOn, designOn) {
    choice = readChoice(choice);
    if (choice) return choice === "on";
    return !!(gateOn || designOn);
  }

  // The page policy a design runs under (it used to sit in index.html for everyone). Only once
  // couch-tv Studio hands design.js a design: a home without one keeps exactly the rules it always had.
  // No inline script, no eval, no plugins, no outside scripts but Spotify's player. Pictures and
  // videos may come from https (posters, photos and video links set in Home settings; a design
  // carries none: design.js refuses outside links), the launcher's own tvos.invalid host, and this
  // page's own server (the bridge, or the launcher's copy).
  var POLICY = "default-src 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https: http://tvos.invalid; media-src 'self' blob: https:; " +
    "connect-src 'self' https: http://127.0.0.1:* http://localhost:*; frame-src https://sdk.scdn.co; font-src 'self' data:; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'";
  // The policy a design runs under, from this page's rules plus two lists:
  // fonts named by a design (design.js) come only from the design store: font-src names that one
  // origin and nothing else (never Google), on top of this page and data:.
  // opts.media: where videos may come from while a design is on (design-code.js mediaSources: this
  // page, blob:, the design store and the host of this TV's own Home settings video link). Without
  // it media-src stays as above.
  // policy("<store>") names the store for fonts; policy({ media: [...], store: "<store>" }) does both;
  // with no store given it is the one design-code.js uses.
  function policy(arg) {
    var opts = arg && typeof arg === "object" ? arg : null, store = typeof arg === "string" ? arg : opts && typeof opts.store === "string" ? opts.store : undefined;
    var C = typeof window !== "undefined" && window.CouchDesignCode, b = store !== undefined ? store : C && C.base ? C.base() : "";
    b = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(b || "") ? b : "";
    var out = POLICY.replace("font-src 'self' data:", "font-src 'self' data:" + (b ? " " + b : ""));
    // Ask AI with a model on a computer at home (ask.js): that one home network address, plain http, may be asked.
    // The same home addresses ask.js isLocalHost takes (private IPv4, link-local 169.254, and .local, .lan and
    // .home.arpa names), so a model the setup sheet accepts is never then blocked by this page's policy.
    // This computer (127.x, localhost) is not added here: connectOrigin never names it.
    var A = typeof window !== "undefined" && window.CouchAsk, ao = A && A.connectOrigin ? A.connectOrigin() : "";
    if (/^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|([a-z0-9-]{1,63}\.)+(local|lan|home\.arpa))(:\d{1,5})?$/i.test(ao)) out = out.replace("connect-src 'self' https:", "connect-src 'self' https: " + ao.toLowerCase());
    var media = opts && Array.isArray(opts.media) ? opts.media.filter(function (s) { return /^('self'|blob:|https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?)$/i.test(String(s)); }) : null;
    return media && media.length ? out.replace(/media-src [^;]*;/, "media-src " + media.join(" ") + ";") : out;
  }
  function lockPage(doc, opts) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.head || doc.querySelector && doc.querySelector('meta[data-tvdesigner="policy"]')) return false;
    var m = doc.createElement("meta");
    m.setAttribute("http-equiv", "Content-Security-Policy");
    m.setAttribute("content", policy(opts));
    m.setAttribute("data-tvdesigner", "policy");
    doc.head.appendChild(m);
    return true;
  }

  window.CouchDesigner = { KEY: KEY, DEFAULT_STORE: DEFAULT_STORE, DESIGNER_PAGE: DESIGNER_PAGE, POLICY: POLICY,
    decide: decide, readChoice: readChoice, shownOn: shownOn, lockPage: lockPage, policy: policy };
})();
