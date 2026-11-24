// Couch TV Studio's design block: config.json "design" (docs/CONFIG.md, "Design"), made in
// Couch TV Studio (a poster style editor for this home). It is laid over the normal Night home:
//  - the home's own parts (clock, date, weather, people, quick buttons, Keep watching, the dock):
//    where each sits, its size and turn, font, colour, weight, shadow, a shade behind it to read it
//    on a busy photo, the panel behind it, and for the dock its shape (row, column, grid), icon
//    size, spacing, labels and icon style, which apps it holds and in what order;
//  - single apps pulled out of the dock to anywhere on the screen (they stay in the dock's list, so
//    the remote still reaches them and OK still opens them);
//  - free objects of its own: words, shapes and cards to sit behind things, extra clocks, weather
//    cards and smart home widgets;
//  - your own background, and the clock and date formats.
//
// No "design" key: nothing here runs and the home is exactly as it was. The designer's own preview
// (?designer=1, same origin only) also takes designs sent in with postMessage, so edits show live.
//
// Positions and sizes are in pixels of a 1920x1080 screen. Parts move by x and y from where they
// normally sit; free objects and pulled out apps sit at x and y (their top left corner).
(function () {
  "use strict";

  var Q = location.search;
  var DESIGNER = /[?&]designer=1\b/.test(Q) && window.parent && window.parent !== window;
  // development previews only (mock.js, ?mock=1&demo=1): smart widgets may show their demo readings
  var DEMO_PREVIEW = /[?&]mock\b/.test(Q) && /[?&]demo=1\b/.test(Q);
  var ROOT = document.documentElement;
  var SEQ = 0, D = null, ON = false, hooks = {}, styleEl = null, dockStyle = null, wxEl = null, bgEl = null, textBox = null;
  var layers = { back: null, front: null }, clockTimer = null, depthEl = null;
  // the built in scenes with a cut out of their hills (backgrounds/scene-<name>-fg.webp); water has none.
  // The clouds loop's still picture has one too (backgrounds/loop-clouds-fg.png, bg-video.js).
  var DEPTH_SCENE = /^backgrounds\/(scene-(night|golden|fog|dawn)|loop-clouds)\.jpg$/;
  var appsKey = "", clockKey = "", observer = null, gridObserver = null;

  // the look settings a design may carry (design.home); Home settings on the TV still win
  var HOME_KEYS = ["scenes", "scene_seconds", "glass", "glass_icons", "glass_amount", "clock_style", "ambient_weather",
    "ambient_sun_grade", "video_url", "dock", "moving_tiles", "lighter", "keep_watching", "now_playing", "dock_size", "clock"];
  var FONTS = {
    inter: '"Inter", sans-serif',
    antonio: '"Antonio", "Arial Narrow", sans-serif',
    serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
    mono: '"Roboto Mono", "Droid Sans Mono", Menlo, monospace',
    condensed: '"Roboto Condensed", "Arial Narrow", sans-serif'
  };
  // Any Google Fonts family by its name (google-fonts.js, a list made from Google Fonts' public
  // metadata): a design may name up to three. The TV never asks Google: each font's file comes from the
  // design store, /v1/fonts/<family>/<weight>.woff2, shown with font-display swap (the home's own font
  // until it arrives, and for good if it takes too long). A name not on the list is dropped.
  var FONT_CAP = 3, FONT_WAIT = 6000;
  var OWN_FONTS = ["inter", "antonio", "serif", "mono", "condensed", "rounded", "cormorant", "jost"];
  function gfont(v) { var F = typeof window !== "undefined" && window.CouchFonts, f = F && OWN_FONTS.indexOf(v) < 0 ? F.find(v) : null; return f ? f.family : undefined; }
  function customFont(v) { return typeof v === "string" && OWN_FONTS.indexOf(v) < 0 && !!gfont(v); }
  // the font-family for a font a design names: the home's own, or a Google Fonts family
  function fontOf(name) { if (FONTS[name]) return FONTS[name]; var F = window.CouchFonts; return customFont(name) ? F.css(name) : ""; }
  // at most three Google Fonts families in a design: the first three named keep theirs, the rest
  // fall back to the home's own font (their font is dropped)
  function capFonts(out) {
    var seen = [];
    (function walk(x) {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      Object.keys(x).forEach(function (k) {
        if (k === "font" && customFont(x[k])) {
          if (seen.indexOf(x[k]) < 0 && seen.length < FONT_CAP) seen.push(x[k]);
          if (seen.indexOf(x[k]) < 0) { delete x[k]; note("Only three fonts of your own fit in a design: the rest use the home's font."); }
        } else walk(x[k]);
      });
    })(out);
    return seen;
  }
  // the families a design uses and the weights it asks for each (400 and 700 always, for widgets)
  function fontsOf(d) {
    var want = {};
    (function walk(x) {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (customFont(x.font)) { var w = want[x.font] = want[x.font] || [400, 700]; if (x.weight && w.indexOf(+x.weight) < 0) w.push(+x.weight); }
      Object.keys(x).forEach(function (k) { if (k !== "font") walk(x[k]); });
    })(d);
    return want;
  }
  // load them from the store (never from Google), each with a time limit; a font that fails or is late
  // is simply not used, and the home's own font stays
  var FONT_DONE = {}, FONT_LATER = false;
  // the characters in each subset the store serves (Google Fonts' own ranges)
  var FONT_RANGE = {
    latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    devanagari: "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09"
  };
  function loadFonts(d) {
    var C = window.CouchDesignCode, base = C && C.base ? C.base() : "", F = window.CouchFonts, want = fontsOf(d);
    if (!base || !F) return 0;
    var n = 0;
    Object.keys(want).slice(0, FONT_CAP).forEach(function (name) {
      var fam = F.find(name);
      if (!fam) return;
      want[name].map(function (w) { return F.weight(fam.family, w); }).filter(function (w, i, a) { return a.indexOf(w) === i; }).forEach(function (w) {
        // one file per subset the family has (the store's names): latin, latin-ext, devanagari; each
        // with its characters, so the TV fetches a subset only when the words on screen need it
        fam.subsets.forEach(function (sub) {
          if (!FONT_RANGE[sub]) return;
          var url = base + "/v1/fonts/" + fam.name + "/" + w + (sub === "latin" ? "" : "." + sub) + ".woff2", key = url;
          if (FONT_DONE[key]) return;
          FONT_DONE[key] = 1; n++;
          if (typeof FontFace === "function" && document.fonts && document.fonts.add) {
            try {
              var face = new FontFace(fam.family, 'url("' + url.replace(/["\\\n]/g, encodeURIComponent) + '") format("woff2")', { weight: String(w), display: "swap", unicodeRange: FONT_RANGE[sub] });
              var late = false, timer = setTimeout(function () { late = true; }, FONT_WAIT);
              // only a latin file is fetched straight away (the others when their characters show)
              if (sub !== "latin") { document.fonts.add(face); return; }
              face.load().then(function () { clearTimeout(timer); if (!late) document.fonts.add(face); }, function () { clearTimeout(timer); });
            } catch (e) { /* no font: the home's own stays */ }
          } else if (document.head) {
            // an older WebView with no FontFace: the same file by a rule, swapped in when it arrives
            var st = document.createElement("style");
            st.setAttribute("data-cd-font", fam.family);
            st.textContent = '@font-face{font-family:"' + fam.family + '";src:url("' + url.replace(/["\\\n]/g, encodeURIComponent) + '") format("woff2");font-weight:' + w + ";font-display:swap;unicode-range:" + FONT_RANGE[sub] + "}";
            document.head.appendChild(st);
          }
        });
      });
    });
    return n;
  }
  var TEXT_SHADOW = {
    none: "none",
    soft: "0 0.125rem 1.25rem rgba(0, 0, 0, 0.38)",
    strong: "0 0.1875rem 0.5rem rgba(0, 0, 0, 0.6), 0 0 0.125rem rgba(0, 0, 0, 0.45)"
  };
  // a shade to read words over a busy photo: a wide dark glow, or a dark panel behind them
  var GLOW = "0 0 1.5rem rgba(0, 0, 0, 0.6), 0 0 0.5rem rgba(0, 0, 0, 0.45), 0 0.125rem 0.25rem rgba(0, 0, 0, 0.5)";
  var PANEL = "background:rgba(8, 9, 12, 0.5);-webkit-backdrop-filter:blur(0.75rem);backdrop-filter:blur(0.75rem);border-radius:0.875rem;padding:0.25rem 1rem";
  var CLOCK_SHADOW = {
    none: "none",
    soft: "drop-shadow(0 0.5rem 1.75rem rgba(0, 0, 0, 0.3))",
    strong: "drop-shadow(0 0.375rem 0.75rem rgba(0, 0, 0, 0.6))"
  };
  var DATE_FORMATS = {
    short: { weekday: "short", day: "numeric", month: "short" },
    numeric: { day: "numeric", month: "numeric", year: "numeric" },
    weekday: { weekday: "long" },
    day_month: { day: "numeric", month: "long" },
    full: { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  };
  // the parts that move: the element that carries the transform, and the point it grows from
  var PARTS = {
    date: { sel: "#date", origin: "50% 0" },
    weather: { sel: "#cd-weather", origin: "50% 0" },
    people: { sel: ".people-wrap", origin: "0 0" },
    quick: { sel: "#quick", origin: "100% 0" },
    keep_watching: { sel: "#shelf-section", origin: "0 0" }
  };
  var SHAPES = { rounded: "22.5%", square: "8%", circle: "50%", squircle: "34%", none: "0" };
  var STYLES = ["colour", "mono", "glass", "outline", "dark"];
  // Sections (like iPhone Control Centre): a section has its own grid of modules, and each control in
  // it takes a set size of modules: [columns, rows]. The controls pack themselves in order, left to
  // right and top to bottom, each at the first free place, so a section always stays even.
  var CTL = { s: [1, 1], w: [2, 1], t: [1, 2], b: [2, 2] };
  var GROUP_PAD = 16, GROUP_GAP = 16;
  function packGroup(controls, cols, rows) {
    cols = Math.max(1, Math.min(8, Math.round(cols) || 1)); rows = Math.max(1, Math.min(4, Math.round(rows) || 1));
    var used = [], out = [], r, c;
    for (r = 0; r < rows; r++) { used.push([]); for (c = 0; c < cols; c++) used[r].push(false); }
    list(controls).forEach(function (ct, i) {
      var sz = CTL[obj(ct).size] || CTL.s, w = sz[0], hh = sz[1], at = null;
      for (r = 0; r + hh <= rows && !at; r++) for (c = 0; c + w <= cols && !at; c++) {
        var free = true;
        for (var y = r; y < r + hh && free; y++) for (var x = c; x < c + w; x++) if (used[y][x]) { free = false; break; }
        if (free) at = { c: c, r: r };
      }
      if (!at) { out.push({ i: i, fits: false }); return; }
      for (var y2 = at.r; y2 < at.r + hh; y2++) for (var x2 = at.c; x2 < at.c + w; x2++) used[y2][x2] = true;
      out.push({ i: i, fits: true, c: at.c, r: at.r, w: w, h: hh });
    });
    return out;
  }
  // where each module sits inside a section of w x h pixels
  function groupGeo(o) {
    var w = num(o.w, 830, 40, 1920), hh = num(o.h, 210, 40, 1080), cols = Math.round(num(o.cols, 4, 1, 8)), rows = Math.round(num(o.rows, 1, 1, 4));
    var mw = (w - 2 * GROUP_PAD - (cols - 1) * GROUP_GAP) / cols, mh = (hh - 2 * GROUP_PAD - (rows - 1) * GROUP_GAP) / rows;
    return { w: w, h: hh, cols: cols, rows: rows, mw: mw, mh: mh,
      cell: function (c, r, cw, ch) { return { x: GROUP_PAD + c * (mw + GROUP_GAP), y: GROUP_PAD + r * (mh + GROUP_GAP), w: cw * mw + (cw - 1) * GROUP_GAP, h: ch * mh + (ch - 1) * GROUP_GAP }; } };
  }

  function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  function list(x) { return Array.isArray(x) ? x : []; }
  function num(x, d, lo, hi) { x = Number(x); return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; }
  function vw(px) { return +(px / 19.2).toFixed(4) + "vw"; }
  function vh(px) { return +(px / 10.8).toFixed(4) + "vh"; }
  function rem(px) { return +(px / 16).toFixed(4) + "rem"; }
  function colour(c) {
    c = String(c || "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\(\s*[\d.\s,%]+\)$/i.test(c) ? c : "";
  }
  var KEEP = ["gear", "more", "smart", "com.android.tv.settings"];
  // a package name is used as an object key (apps.tiles): never one that reaches an object's prototype
  var POISON = ["__proto__", "constructor", "prototype"];
  // a key or a token (a Home Assistant long-lived token is a JWT, eyJ...): never kept as an app or an
  // id, so a design cannot carry one off the TV. A part between dots that is very long, or long with
  // capitals, small letters and digits mixed, is not a package name or a catalogue id
  function secretish(p) {
    return String(p).split(/[.:]/).some(function (s) { return s.length >= 32 || (s.length >= 16 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)) || (/^eyJ/.test(s) && s.length >= 12); });
  }
  function pkgOk(p) { return typeof p === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(p) && POISON.indexOf(p) < 0 && !secretish(p); }
  function idOk(p) { return typeof p === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(p) && POISON.indexOf(p) < 0 && !secretish(p); }
  function imgOk(u) {
    u = typeof u === "string" ? u : "";
    if (u.length > 4000000) return "";
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u)) return u;
    if (/^backgrounds\/[A-Za-z0-9_][A-Za-z0-9_./-]*\.(jpe?g|png|webp)$/i.test(u) && u.indexOf("..") < 0 && u.indexOf("//") < 0) return u;
    return "";   // anything else (http, https, javascript:, file:, //host, ../) is dropped
  }
  // a cut out has see through parts, so only PNG or WebP (a JPEG has no transparency), by imgOk's rules
  function depthImgOk(u) { var s = imgOk(u); return s && (/^data:image\/(png|webp);/.test(s) || /\.(png|webp)$/i.test(s)) ? s : ""; }
  // where the hills in front come from: the design's own cut out, else a built in scene's
  function depthSrc(bg, src) {
    if (!src || bg.depth !== true) return "";
    var own = depthImgOk(bg.depth_image);
    return own || (DEPTH_SCENE.test(src) ? (/^backgrounds\/loop-/.test(src) ? src.replace(/\.jpg$/, "-fg.png") : src.replace(/\.jpg$/, "-fg.webp")) : "");
  }
  // a looping video behind the home (background.video, bg-video.js): only with its still picture
  function vidOk(u) { return window.CouchVideo ? window.CouchVideo.refOk(u, { designer: DESIGNER, origin: location.origin }) : ""; }
  function cssUrl(u) { return 'url("' + String(u).replace(/["\\\n]/g, encodeURIComponent) + '")'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // one part's position, size and turn: x and y in 1920x1080 pixels, scale 0.2 to 6, rotate in degrees
  function place(p) {
    p = obj(p);
    return { x: num(p.x, 0, -3840, 3840), y: num(p.y, 0, -2160, 2160), s: num(p.scale, 1, 0.1, 8), r: num(p.rotate, 0, -180, 180) };
  }
  function moved(m) { return m.x !== 0 || m.y !== 0 || m.s !== 1 || m.r !== 0; }
  // how many apps across the dock is: one for a column, the design's count for a grid, and for a
  // row as many as fit inside the TV's safe area (a longer row wraps instead of running off the screen)
  function dockCols(de, inflow) {
    inflow = Math.max(1, inflow);
    if (de.layout === "column") return 1;
    if (de.layout === "grid") return Math.min(num(de.columns, 3, 1, 12), inflow);
    var size = num(de.icon_size, 112, 40, 240), gap = num(de.icon_gap, 26, 0, 120), s = num(de.scale, 1, 0.1, 8);
    var fit = Math.max(1, Math.floor(((1728 / s) - 56 + gap) / (size + gap)));
    return Math.min(inflow, fit);
  }
  function freeCount() {
    var T = obj(obj(D && D.apps).tiles), n = 0;
    Object.keys(T).forEach(function (p) { if (obj(T[p]).free === true) n++; });
    return n;
  }
  // in the designer, until "Try it with the remote", the home shows no focus: nothing is chosen yet
  var EDIT_CSS = [
    "html.cd-edit .tile.focus, html.cd-edit .ncard.focus, html.cd-edit .qbtn.focus, html.cd-edit .person.focus, html.cd-edit .people.focus{transform:none !important;box-shadow:none !important}",
    "html.cd-edit .app.focus .face{box-shadow:0 0.5rem 1rem rgba(0, 0, 0, 0.35) !important}",
    "html.cd-edit .tile.focus .face, html.cd-edit .tile.focus .face::after{animation:none !important;opacity:1}",
    "html.cd-edit .tile.focus .face::after{opacity:0 !important}",
    "html.cd-edit .qbtn.focus{background:rgba(30, 20, 28, 0.32) !important;color:#fff !important}",
    "html.cd-edit .person.focus:not(.on){background:none !important;color:rgba(255, 255, 255, 0.78) !important}",
    "@keyframes cd-flash{0%{filter:brightness(1.9)}100%{filter:none}}",
    "html.cd .app.cd-flash .face{animation:cd-flash 600ms ease-out}"
  ].join("\n");
  function tf(m) { return "translate(" + vw(m.x) + "," + vh(m.y) + ")" + (m.r ? " rotate(" + m.r + "deg)" : "") + " scale(" + m.s + ")"; }

  // ---------------- the gate: a design is untrusted input ----------------
  // Whatever a design file says, only what is listed here reaches the TV: known keys, numbers clamped
  // to sensible ranges, choices from fixed lists, colours in plain colour formats, text as text with a
  // length limit, images only from the TV or inside the design. Unknown keys are dropped.
  // the characters a TV draws in words: Latin letters with accents, spaces and a little punctuation
  var WORD_OK = /^[A-Za-zÀ-ÖØ-öø-ſ .,'’!?&():;"-]*$/;
  // each line, whether a TV draws it, and if not why (for the designer to say)
  function wordLines(v) {
    var t = String(v);
    try { t = t.normalize("NFKC"); } catch (e) {}
    return t.replace(/\t/g, " ").split(/\r?\n/).map(function (line) {
      var text = line.replace(/[ ]{2,}/g, " ").replace(/^ +| +$/g, "");
      if (WORD_OK.test(text)) return { text: text, ok: true };
      return { text: text, ok: false, why: /[0-9٠-٩۰-۹०-९²³¹⁰-⁹₀-₉]/.test(text) ? "a number" : /@/.test(text) ? "an @" : "a character a TV does not show" };
    });
  }
  var SAN = {
    n: function (v, lo, hi, int) { v = Number(v); if (typeof v !== "number" || !isFinite(v)) return undefined; v = Math.max(lo, Math.min(hi, v)); return int ? Math.round(v) : Math.round(v * 1000) / 1000; },
    pick: function (v, choices) { return choices.indexOf(v) >= 0 ? v : undefined; },
    b: function (v) { return typeof v === "boolean" ? v : undefined; },
    // text: a string, its control characters taken out (new lines kept), cut to length
    t: function (v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, max) : undefined; },
    // words drawn on the screen: an ALLOW list, not a deny list (review round 6). Latin letters (with
    // accents), spaces, new lines and a little punctuation; nothing else. No digits (the time, the
    // date and the weather come from their own widgets), no @, no slashes, no other scripts, no
    // symbols, no zero width or joining characters. Full width letters become plain ones first.
    // v9: line by line. A line with any digit or any character outside the list is dropped whole
    // (never shown with holes in it: "Happy th birthday"); the designer marks that line and says why.
    w: function (v, max) {
      if (typeof v !== "string") return undefined;
      return wordLines(v).filter(function (l) { return l.ok; }).map(function (l) { return l.text; }).join("\n").replace(/\n{3,}/g, "\n\n").replace(/^[ \n]+|[ \n]+$/g, "").slice(0, max);
    },
    c: function (v) { return colour(v) || undefined; },
    list: function (v, max, each) { return Array.isArray(v) ? v.slice(0, max).map(each).filter(function (x) { return x !== undefined && x !== ""; }) : undefined; }
  };
  function put(out, k, v) { if (v !== undefined) out[k] = v; }
  function sanPlace(src, out) {
    put(out, "x", SAN.n(src.x, -3840, 3840)); put(out, "y", SAN.n(src.y, -2160, 2160));
    put(out, "scale", SAN.n(src.scale, 0.1, 8)); put(out, "rotate", SAN.n(src.rotate, -180, 180));
    put(out, "opacity", SAN.n(src.opacity, 0.05, 1)); put(out, "hidden", SAN.b(src.hidden));
    put(out, "locked", SAN.b(src.locked)); put(out, "name", SAN.w(src.name, 40));
  }
  function sanType(src, out) {
    put(out, "font", SAN.pick(src.font, Object.keys(FONTS)) || gfont(src.font)); put(out, "weight", SAN.n(src.weight, 100, 900, true));
    put(out, "colour", SAN.c(src.colour)); put(out, "shadow", SAN.pick(src.shadow, ["none", "soft", "strong"]));
    put(out, "shade", SAN.pick(src.shade, ["glow", "panel"])); put(out, "case", SAN.pick(src.case, ["upper"]));
    put(out, "align", SAN.pick(src.align, ["left", "center", "right"]));
  }
  var DATE_KEYS = ["short", "numeric", "weekday", "day_month", "full"];
  var PANELS = ["glass", "solid", "none"];
  function sanPart(key, src) {
    src = obj(src);
    var out = {};
    sanPlace(src, out);
    if (key === "keep_watching") put(out, "auto_y", SAN.n(src.auto_y, -1080, 0));   // the designer's lift out of a wrapped dock
    // a small Keep watching: one show at a time, taking turns ("one": the usual card; "square": the
    // picture over the words, for a square of the grid)
    if (key === "keep_watching") put(out, "compact", SAN.pick(src.compact, ["one", "square"]));
    if (key === "clock" || key === "date" || key === "weather" || key === "keep_watching") sanType(src, out);
    if (key === "clock") { put(out, "format", SAN.pick(src.format, ["12h", "24h"])); put(out, "style", SAN.pick(src.style, ["glass", "solid"])); put(out, "behind", SAN.b(src.behind)); put(out, "at", SAN.pick(src.at, ["scene"])); }
    if (key === "date") put(out, "format", SAN.pick(src.format, DATE_KEYS));
    if (key === "weather") { put(out, "place", SAN.b(src.place)); put(out, "words", SAN.b(src.words)); }
    if (key === "people" || key === "quick" || key === "keep_watching" || key === "dock") put(out, "panel", SAN.pick(src.panel, PANELS));
    if (key === "dock") {
      put(out, "layout", SAN.pick(src.layout, ["row", "column", "grid"])); put(out, "columns", SAN.n(src.columns, 1, 12, true));
      put(out, "icon_size", SAN.n(src.icon_size, 40, 240)); put(out, "icon_gap", SAN.n(src.icon_gap, 0, 120));
      put(out, "labels", SAN.pick(src.labels, ["focus", "always", "off"])); put(out, "label_pos", SAN.pick(src.label_pos, ["below", "right"]));
      put(out, "icon_shape", SAN.pick(src.icon_shape, Object.keys(SHAPES))); put(out, "icon_style", SAN.pick(src.icon_style, STYLES));
      put(out, "icon_tone", SAN.pick(src.icon_tone, ["mono", "dim"]));
      // a small dock holds only the first few apps; the rest wait in More apps, as on every couch-tv home
      put(out, "max_apps", SAN.n(src.max_apps, 1, 10, true));
    }
    return out;
  }
  var KINDS = ["aircon", "light", "speaker", "camera", "doorbell", "network", "devices", "vacuum", "appliance", "scene"];
  // an icon set's name: a set is code that ships with the home (registerIcons), never markup from a design
  function iconSetOk(v) { return typeof v === "string" && /^[a-z0-9-]{1,24}$/.test(v) ? v : undefined; }
  // one control in a section: a smart home control, or a place for an app (the app itself is drawn by
  // the dock, out on the screen, so the remote reaches it). Sizes are set sizes on the section's own grid.
  function sanControl(src) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return undefined;
    var out = {};
    var app = pkgOk(src.app) && KEEP.indexOf(src.app) < 0 ? src.app : undefined;
    if (src.app !== undefined && !app) return undefined;   // an app this TV cannot place: left out, never a light
    if (app) out.app = app; else put(out, "kind", SAN.pick(src.kind, KINDS) || "light");
    put(out, "size", SAN.pick(src.size, Object.keys(CTL)));
    if (!app) { put(out, "name", SAN.w(src.name, 24)); put(out, "on", SAN.b(src.on)); }
    return out;
  }
  // ---------------- widgets (Couch TV Studio v10, widgets/CATALOGUE.md) ----------------
  // A widget is one box on the designer's grid: a kind (one renderer each, widgets.js), a set size,
  // a style from fixed lists and plain colours, and a few options per kind, each on an allow list.
  // A design never carries a widget's data: the TV reads its own (the clock, its weather, its photos,
  // its apps, Home Assistant) or says plainly what is missing. No link, no number typed as words.
  var WKINDS = ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "solar", "worldclock", "countdown", "date", "month", "timer",
    "weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "moon", "air", "surf",
    "photo", "slideshow", "mosaic", "artframe", "memory",
    "keep", "keeprow", "upnext", "picks",
    "app", "folder", "dock", "appgrid", "games",
    "nowplaying", "soundscape", "queue", "speakers",
    "aircon", "scenes", "controls", "camera", "doorbell", "energy", "sensor", "battery",
    "bins", "people", "agenda", "note", "list",
    "card", "quote", "word", "news", "sports", "stocks", "commute",
    "welcome", "quick", "wifi", "guide", "screentime", "ask", "agent", "stack"];
  // which panel each kind has when its style does not say (glass, solid, colour, paper, none)
  var WPANEL = { clock: "none", tallclock: "none", glassclock: "none", flipclock: "none", date: "none", welcome: "none", quote: "none", quick: "none",
    photo: "none", slideshow: "none", mosaic: "none", artframe: "none", memory: "none", keep: "none", keeprow: "none", upnext: "none", picks: "none",
    app: "none", appgrid: "none", camera: "none", stack: "none", analog: "colour", wordclock: "colour", countdown: "colour", weather: "colour",
    bigtemp: "colour", hourly: "colour", week: "colour", uv: "colour", surf: "colour", screentime: "colour", note: "colour", word: "paper",
    worldclock: "solid", moon: "solid", timer: "solid", stocks: "solid", battery: "solid", ask: "glass", agent: "glass" };
  // the kinds the remote stops on (they do something with OK); the rest are to look at (GRID.md Focus 6)
  // (and, from 18 Nov 2026, every kind whose OK opens its detail layer, widget-detail.js: a clock opens
  // Timers, the weather the forecast, a photo the slideshow; a widget with nothing real to show opens
  // its setup record, so it is a stop too, decided when it is drawn)
  var WACT = ["keep", "keeprow", "upnext", "picks", "app", "folder", "dock", "appgrid", "games", "nowplaying", "soundscape", "aircon", "scenes", "controls", "people", "quick", "stack",
    "clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "timer", "solar", "worldclock", "date", "month", "agenda",
    "weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "moon", "air", "surf", "photo", "slideshow", "mosaic", "artframe",
    "camera", "doorbell", "card", "news", "sports", "memory", "queue", "speakers", "energy", "sensor", "battery", "note", "list", "stocks", "commute", "wifi", "guide", "screentime", "ask", "agent"];
  var WSIZES = ["line", "wline", "tile", "wtile", "small", "tall", "medium", "wide", "large", "xl", "hero", "full", "row8", "row12", "row18"];
  var WSTYLE = { panel: ["glass", "solid", "colour", "paper", "none"], gradient: ["off", "soft"], ink: ["auto", "white", "ink", "accent", "glass", "liquid"],
    font: ["inter", "antonio", "rounded", "cormorant", "jost"], icons: ["line", "solid", "duotone", "tile", "glass", "playful", "classic"],
    corners: ["square", "soft", "round", "pill"], shadow: ["none", "soft", "lifted"], show: ["always", "live", "night", "day"] };
  var QUICK_IDS = ["sleep", "picture", "look", "soundscape", "screen_off", "headphones", "input", "bluetooth", "network", "tvsettings", "screensaver"];
  var SCENE_IDS = ["night", "fog", "golden", "dawn", "water"];
  var CTL_ICONS = ["light", "lamp", "pendant", "blinds", "lock", "outlet", "speaker", "shield", "fan", "aircon", "tv", "camera", "garage", "light-off"];
  function tzOk(v) { return typeof v === "string" && /^[A-Z][A-Za-z_]{1,30}(\/[A-Z][A-Za-z_-]{1,30}){1,2}$/.test(v) ? v : undefined; }
  function iconName(v) { return typeof v === "string" && /^[a-z][a-z-]{1,23}$/.test(v) ? v : undefined; }
  // every option a widget may carry, with its check; WOPT says which a kind takes
  var OPT = {
    label: function (v) { return SAN.w(v, 40); }, text: function (v) { return SAN.w(v, 120); }, sub: function (v) { return SAN.w(v, 80); },
    kicker: function (v) { return SAN.w(v, 60); }, caption: function (v) { return SAN.w(v, 60); },
    format: function (v) { return SAN.pick(v, ["auto", "12h", "24h"]); }, ampm: SAN.b, seconds: SAN.b, date: SAN.b,
    // the clocks' own settings (widget-caps.js): the analogue clock's numbers, the word clock's minute and
    // day line, the month's first day of the week
    numbers: SAN.b, precise: SAN.b, dayline: SAN.b, wstart: function (v) { return SAN.pick(v, ["mon", "sun"]); },
    align: function (v) { return SAN.pick(v, ["left", "center", "right"]); },
    show: function (v) { return SAN.pick(v, ["date", "weather", "both"]); }, dfmt: function (v) { return SAN.pick(v, DATE_KEYS); },
    cities: function (v) { return SAN.list(v, 4, tzOk); },
    // a clock's own time zone (an IANA id, checked like the world clock's cities); left out, the TV's own
    zone: tzOk,
    month: function (v) { return SAN.n(v, 1, 12, true); }, day: function (v) { return SAN.n(v, 1, 31, true); },
    unit: function (v) { return SAN.pick(v, ["sleeps", "days", "weeks"]); }, icon: iconName,
    // apps in a dock, row, folder or app tile: catalogue ids (app-catalogue.js). An old design's package
    // name becomes its id when the catalogue knows it; anything else is dropped. A page without the
    // catalogue (an older copy of this file's helpers) keeps package names as it always did.
    apps: function (v) {
      var A = typeof window !== "undefined" && window.CouchApps;
      return SAN.list(v, 16, function (p) {
        if (!A) return pkgOk(p) && KEEP.indexOf(p) < 0 ? p : undefined;
        if (A.get(p)) return p;
        return pkgOk(p) && KEEP.indexOf(p) < 0 ? A.idOf(p) || undefined : undefined;
      });
    },
    cols: function (v) { return SAN.n(v, 1, 6, true); }, names: SAN.b, more: SAN.b,
    image: function (v) { return imgOk(v) || undefined; }, fit: function (v) { return SAN.pick(v, ["cover", "contain"]); },
    seconds_each: function (v) { return SAN.n(v, 5, 600, true); }, count: function (v) { return v === "auto" ? "auto" : SAN.n(v, 1, 8, true); },
    mat: SAN.c, weekday: function (v) { return SAN.n(v, 0, 6, true); }, alt: SAN.b, anchor: function (v) { return SAN.n(v, 0, 100000, true); },
    lid_a: SAN.c, lid_b: SAN.c, bin_a: function (v) { return SAN.w(v, 20); }, bin_b: function (v) { return SAN.w(v, 20); },
    quick: function (v) { return SAN.list(v, 6, function (q) { return SAN.pick(q, QUICK_IDS); }); },
    scene: function (v) { return SAN.pick(v, SCENE_IDS); }, sound: function (v) { return SAN.pick(v, ["rain", "fire", "waves", "brown"]); },
    night: SAN.b, place: SAN.b, hilo: SAN.b, sport: SAN.b,
    entity: function (v) { return typeof v === "string" && /^climate\.[a-z0-9_]{1,64}$/.test(v) && !secretish(v) ? v : undefined; },
    controls: function (v) { return SAN.list(v, 8, function (c) { c = obj(c); var o = {}; put(o, "icon", SAN.pick(c.icon, CTL_ICONS)); put(o, "name", SAN.w(c.name, 24)); return o.icon ? o : undefined; }); },
    shows: function (v) { return SAN.n(v, 1, 5, true); },
    // the web widgets (widget-web.js): a source picked from a fixed list, never a link
    feed: function (v) { return SAN.pick(v, ["auto"].concat(WEB_FEEDS)); },
    // the widget settings Studio can set (widget-caps.js settings, store "design"): a year or "every" (a
    // countdown that comes round each year), a timer's quick start, how many hours, shuffle, the price, the
    // agenda's days and which games
    year: function (v) { return v === "every" ? "every" : SAN.n(v, 2026, 2040, true); }, minutes: function (v) { return SAN.n(v, 0, 240, true); },
    hours: function (v) { return v === "auto" ? "auto" : SAN.n(v, 1, 24, true); }, shuffle: SAN.b, price: SAN.b,
    days: function (v) { return SAN.pick(v, ["today", "two", "week"]); }, games: function (v) { return SAN.pick(v, ["all", "live", "mine"]); },
    league: function (v) { return SAN.pick(v, WEB_LEAGUES); },
    // a team's name as ESPN writes it ("Philadelphia 76ers", "Brighton & Hove Albion"): letters, digits, spaces and & . ' -
    team: function (v) { v = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : ""; // never a secret: no word over 16 letters, and digits only in a short word ("76ers"), never a token
      return /^[A-Za-z0-9\u00c0-\u024f][A-Za-z0-9\u00c0-\u024f &.'-]*$/.test(v) && !v.split(" ").some(secretish) && v.split(/[ &.'-]+/).every(function (w) { return w.length <= 16 && (!/[0-9]/.test(w) || w.length <= 5); }) ? v : undefined; },
    // the quote's kind of line, the word's language and whether its meaning shows; how long Ask AI's last
    // answer and From your AI's last message show, and whether the message names its sender
    mood: function (v) { return SAN.pick(v, ["all", "calm", "go", "home"]); }, lang: function (v) { return SAN.pick(v, ["en", "es", "fr", "it", "de", "ja"]); }, meaning: SAN.b,
    keep: function (v) { return SAN.pick(v, ["always", "hour", "day", "never"]); }, who: SAN.b,
    // share symbols as Yahoo writes them (BHP.AX, ^AXJO, AUDUSD=X, BTC-AUD): never a link or a word
    tickers: function (v) { return SAN.list(v, 6, function (s) { s = typeof s === "string" ? s.trim().toUpperCase() : ""; return /^\^?[A-Z0-9]{1,8}([.=-][A-Z0-9]{1,4})?$/.test(s) ? s : undefined; }); },
    // the commute: when to arrive and the minutes to spare; the places stay on the TV, never here
    arrive_h: function (v) { return SAN.n(v, 0, 23, true); }, arrive_m: function (v) { return SAN.n(v, 0, 59, true); },
    buffer: function (v) { return SAN.n(v, 0, 60, true); }, weekdays: SAN.b
  };
  var WEB_LEAGUES = ["afl", "nrl", "aleague", "epl", "nba", "bbl", "cricket"];
  var WEB_FEEDS = ["abc", "abc-justin", "abc-sport", "abc-business", "sbs", "guardian", "bbc", "rnz"];
  var WOPT = {
    clock: "format ampm seconds date align zone", tallclock: "format align zone", glassclock: "format scene zone", analog: "seconds numbers zone", flipclock: "format zone",
    wordclock: "precise dayline zone", solar: "", worldclock: "label cities format", countdown: "label month day year unit icon rule", date: "show dfmt align place", month: "wstart", timer: "label minutes",
    weather: "place hilo night degrees", bigtemp: "place degrees", hourly: "place hours degrees", week: "place", rain: "label", uv: "label", sun: "label", moon: "hemi", air: "label scale", surf: "label units wind",
    photo: "image fit caption sub", slideshow: "seconds_each caption sub shuffle", mosaic: "count", artframe: "image mat caption sub", memory: "align range ago",
    keep: "", keeprow: "label shows", upnext: "apps sport", picks: "label align",
    app: "apps", folder: "label apps cols", dock: "apps more", appgrid: "apps cols names", games: "label apps",
    nowplaying: "", soundscape: "sound volume", queue: "", speakers: "",
    aircon: "entity others", scenes: "label", controls: "label controls cols", camera: "label", doorbell: "", energy: "", sensor: "label", battery: "low",
    bins: "label weekday alt anchor lid_a lid_b bin_a bin_b", people: "names", agenda: "label align days", note: "align byline", list: "label icon align done",
    card: "label text icon", quote: "text sub mood", word: "lang meaning", news: "feed label align count", sports: "label league team align games", stocks: "label tickers align price", commute: "label arrive_h arrive_m buffer weekdays align",
    welcome: "kicker text sub align source times", quick: "quick align", wifi: "align hidepass", guide: "align", screentime: "align appcount", ask: "label align keep", agent: "label align keep who", stack: ""
  };
  // The smart home and music widgets: which of the TV's own Home Assistant things a widget shows,
  // named by entity id only (never a reading, a state or an address). A TV shows one only when it is
  // also named in that TV's config.json; anything else in a design is dropped here.
  function haId(re) { return function (v) { return typeof v === "string" && v.length <= 80 && re.test(v) && !secretish(v) ? v : undefined; }; }
  OPT.switches = function (v) { return SAN.list(v, 16, haId(/^(light|switch|fan|cover)\.[a-z0-9_]{1,64}$/)); };
  OPT.cam = haId(/^camera\.[a-z0-9_]{1,64}$/);
  OPT.reading = haId(/^sensor\.[a-z0-9_]{1,64}$/);
  OPT.players = function (v) { return SAN.list(v, 6, haId(/^media_player\.[a-z0-9_]{1,64}$/)); };
  // the Welcome widget: where the guest's name comes from. "calendar" means this TV's own bookings
  // calendar (Home settings, Designs, At home, Guests); the design never carries a name, a
  // link or a time. times: false hides the check in and check out line.
  OPT.source = function (v) { return SAN.pick(v, ["typed", "calendar"]); };
  // the smart home widgets' own settings Studio can set (widget-caps.js, store "design"): the aircon's
  // other rooms, the doorbell's picture, the energy's power now (on or off), and the batteries' red line
  OPT.others = SAN.b; OPT.picture = SAN.b; OPT.now = SAN.b;
  OPT.low = function (v) { return SAN.n(v, 5, 50, true); };
  OPT.times = SAN.b;
  // the family and photo widgets' own choices (widget-caps.js settings, store "design"): who the note is
  // from, ticked items on a list, On this day's days and how long ago, the apps beside screen time
  OPT.byline = SAN.b; OPT.done = SAN.b; OPT.ago = SAN.b;
  OPT.range = function (v) { return SAN.pick(v, ["day", "week"]); };
  OPT.appcount = function (v) { return v === "auto" ? "auto" : SAN.n(v, 0, 8, true); };
  // align: centred unless the design says left or right (seagey, 18 Nov 2026)
  WOPT.controls = "label controls cols switches align"; WOPT.camera = "label cam align"; WOPT.doorbell = "label align picture"; WOPT.energy = "label align now";
  WOPT.sensor = "label reading align"; WOPT.speakers = "label players align"; WOPT.queue = "label align";
  // the watching, apps and music widgets' own settings (widget-caps.js settings, store "design")
  OPT.mix = function (v) { return SAN.pick(v, ["all", "others", "mine"]); }; OPT.buttons = SAN.b; OPT.cover = SAN.b;
  OPT.turn = function (v) { return SAN.pick(v, [0, 10, 20, 30, 60]); };
  WOPT.picks = "label align mix"; WOPT.nowplaying = "buttons cover"; WOPT.queue = "label align count"; WOPT.stack = "turn";
  // settings that were kept on the TV only, with nothing private in them, now in the design too (0.13.10,
  // widget-caps.js store "design"), so Couch TV Studio can set them; a TV's own choice still wins:
  // temperature in, the moon's half of the world, the air quality scale, the surf's units, the
  // soundscape's volume, the doorbell's and energy's heading (label, already kept) and the guest Wi-Fi's
  // password hidden (each named in WOPT above)
  OPT.degrees = function (v) { return SAN.pick(v, ["auto", "c", "f"]); };
  OPT.hemi = function (v) { return SAN.pick(v, ["auto", "south", "north"]); };
  OPT.scale = function (v) { return SAN.pick(v, ["auto", "eu", "us"]); };
  OPT.units = function (v) { return SAN.pick(v, ["auto", "m", "ft"]); };
  OPT.wind = function (v) { return SAN.pick(v, ["auto", "kmh", "kn", "mph"]); };
  OPT.volume = function (v) { return SAN.n(v, 10, 100, true); };
  OPT.hidepass = SAN.b;
  // a countdown to a day that moves each year: the TV works the date out (widgets.js RULES); "date" is the day and month
  OPT.rule = function (v) { return SAN.pick(v, ["date", "easter", "mothers_day", "fathers_day", "fathers_day_june"]); };
  function sanWStyle(src) {
    src = obj(src);
    var out = {};
    Object.keys(WSTYLE).forEach(function (k) { put(out, k, SAN.pick(src[k], WSTYLE[k])); });
    if (out.font === undefined) put(out, "font", gfont(src.font));   // or any Google Fonts family by name
    put(out, "colour", SAN.c(src.colour)); put(out, "accent", SAN.c(src.accent)); put(out, "opacity", SAN.n(src.opacity, 0.2, 1));
    return Object.keys(out).length ? out : undefined;
  }
  function sanWOpts(kind, src) {
    src = obj(src);
    var out = {};
    String(WOPT[kind] || "").split(" ").forEach(function (k) { if (k && OPT[k] && Object.prototype.hasOwnProperty.call(src, k)) put(out, k, OPT[k](src[k])); });
    return Object.keys(out).length ? out : undefined;
  }
  function sanWidget(src, out, inStack) {
    var kind = SAN.pick(src.kind, WKINDS);
    if (!kind || (inStack && kind === "stack")) return false;
    out.kind = kind;
    put(out, "size", typeof src.size === "string" && (WSIZES.indexOf(src.size) >= 0 || /^\d{1,2}x\d{1,2}$/.test(src.size)) ? src.size : undefined);
    put(out, "style", sanWStyle(src.style));
    put(out, "opts", sanWOpts(kind, src.opts));
    if (inStack) return true;
    put(out, "start", SAN.b(src.start)); put(out, "pinned", SAN.b(src.pinned));
    if (kind === "stack") {
      // a smart stack: up to 10 widgets taking turns in one place (never a stack in a stack)
      out.items = SAN.list(src.items, 10, function (it) { var o = {}; return sanWidget(obj(it), o, true) ? o : undefined; }) || [];
      put(out, "turn", SAN.pick(src.turn, [0, 10, 20, 30, 60]));
      if (!out.items.length) return false;
    }
    return true;
  }
  function wpanel(o) { return obj(o.style).panel || WPANEL[o.kind] || "glass"; }

  function sanObject(src) {
    src = obj(src);
    if (!idOk(src.id)) return undefined;
    var type = SAN.pick(src.type, ["text", "shape", "clock", "weather", "smart", "group", "widget"]);
    if (!type) return undefined;
    var out = { id: src.id, type: type };
    put(out, "layer", SAN.pick(src.layer, ["front", "back"]));
    sanPlace(src, out);
    // a widget's box on the designer's grid: its card fills exactly that many cells
    if (type !== "shape" && type !== "text") { put(out, "w", SAN.n(src.w, 40, 1920)); put(out, "h", SAN.n(src.h, 40, 1080)); }
    if (type === "text") { put(out, "text", SAN.w(src.text, 120)); if (!out.text) return undefined; put(out, "size", SAN.n(src.size, 8, 400)); sanType(src, out); }
    if (type === "shape") {
      put(out, "variant", SAN.pick(src.variant, ["glass", "solid", "outline", "line"])); put(out, "w", SAN.n(src.w, 4, 3840));
      put(out, "h", SAN.n(src.h, 1, 2160)); put(out, "radius", SAN.n(src.radius, 0, 1000)); put(out, "colour", SAN.c(src.colour));
    }
    if (type === "clock") {
      put(out, "size", SAN.n(src.size, 16, 600)); put(out, "format", SAN.pick(src.format, ["12h", "24h"]));
      put(out, "date", SAN.b(src.date)); put(out, "date_format", SAN.pick(src.date_format, DATE_KEYS)); sanType(src, out);
    }
    if (type === "weather") { put(out, "style", SAN.pick(src.style, ["line", "card", "big"])); put(out, "place", SAN.b(src.place)); put(out, "panel", SAN.pick(src.panel, PANELS)); sanType(src, out); }
    if (type === "smart") {
      put(out, "kind", SAN.pick(src.kind, KINDS) || "light"); put(out, "style", SAN.pick(src.style, ["tile", "pill", "icon", "card"]));
      // no status or reading from a design: a TV shows its own (Home Assistant) or Not connected
      put(out, "on", SAN.b(src.on)); put(out, "only_live", SAN.b(src.only_live)); put(out, "instead", SAN.pick(src.instead, ["bigtemp"]));
      put(out, "label", SAN.b(src.label)); put(out, "panel", SAN.pick(src.panel, PANELS));
      put(out, "entity", typeof src.entity === "string" && /^climate\.[a-z0-9_]{1,64}$/.test(src.entity) && !secretish(src.entity) ? src.entity : undefined);
      put(out, "zones", SAN.list(src.zones, 8, function (z) { return SAN.w(z, 24); }));
      put(out, "items", SAN.list(src.items, 8, function (z) { return SAN.w(z, 24); }));
      put(out, "icon_style", iconSetOk(src.icon_style));
    }
    if (type === "group") {
      // a section: its own grid of cols x rows modules, and its controls in order (the TV packs them)
      put(out, "cols", SAN.n(src.cols, 1, 8, true)); put(out, "rows", SAN.n(src.rows, 1, 4, true));
      put(out, "panel", SAN.pick(src.panel, PANELS)); put(out, "icon_style", iconSetOk(src.icon_style));
      out.layer = "back";   // behind the home, so the apps placed in it (drawn by the dock) stay on top
      var ctl = SAN.list(src.controls, 32, sanControl) || [];
      out.controls = ctl.filter(function (c) { return c.app || c.kind; });
    }
    if (type === "widget") {
      delete out.rotate; delete out.scale;   // nothing turns, a widget is its box (GRID.md)
      if (!sanWidget(src, out, false)) return undefined;
      if (!out.w || !out.h) { out.w = out.w || 360; out.h = out.h || 360; }
    }
    return out;
  }
  var HOME_PICK = { glass: ["on", "lite", "off"], clock_style: ["frosted", "liquid"], dock: ["classic", "mac"], clock: ["12h", "24h"] };
  var HOME_BOOL = ["glass_icons", "ambient_weather", "ambient_sun_grade", "moving_tiles", "lighter", "keep_watching", "now_playing"];
  function sanitize(raw) {
    NOTES = [];
    raw = obj(raw);
    var out = { v: 1 };
    var hm = obj(raw.home), h = {};
    // design.home never carries a link: video_url and anything else that is not listed is dropped
    put(h, "scenes", SAN.list(hm.scenes, 20, function (x) { return typeof x === "string" && /^[a-z0-9_-]{1,40}$/.test(x) ? x : undefined; }));
    put(h, "scene_seconds", SAN.n(hm.scene_seconds, 5, 3600, true)); put(h, "glass_amount", SAN.n(hm.glass_amount, 1, 5, true));
    put(h, "dock_size", SAN.n(hm.dock_size, 1, 10, true));
    Object.keys(HOME_PICK).forEach(function (k) { put(h, k, SAN.pick(hm[k], HOME_PICK[k])); });
    HOME_BOOL.forEach(function (k) { put(h, k, SAN.b(hm[k])); });
    if (Object.keys(h).length) out.home = h;
    var el = obj(raw.elements), e = {};
    ["clock", "date", "weather", "people", "quick", "keep_watching", "dock"].forEach(function (k) {
      if (raw.elements && el[k] !== undefined) { var c = sanPart(k, el[k]); if (Object.keys(c).length) e[k] = c; }
    });
    if (Object.keys(e).length) out.elements = e;
    var bg = obj(raw.background), image = imgOk(bg.image);
    if (image) {
      out.background = { image: image };
      put(out.background, "darken", SAN.n(bg.darken, 0, 0.9)); put(out.background, "zoom", SAN.n(bg.zoom, 1, 4));
      put(out.background, "x", SAN.n(bg.x, 0, 100)); put(out.background, "y", SAN.n(bg.y, 0, 100)); put(out.background, "blur", SAN.n(bg.blur, 0, 16));
      put(out.background, "scrim", SAN.pick(bg.scrim, ["top", "bottom", "left", "right", "even"]));
      // depth: a built in scene photo has a cut out of its hills (scene-<name>-fg.webp); drawn between
      // the widgets behind (layer "back") and the ones in front, so a clock can stand behind the hills
      // depth_image: the design's own cut out of its photo (a PNG or WebP with see through sky, made in
      // Couch TV Studio), drawn in the same place over the clock; checked like the photo itself (only from
      // this TV or inside the design, never a link; the same size limit). With one, depth is on unless
      // the design says false. A design without it is drawn exactly as before.
      var cut = depthImgOk(bg.depth_image);
      if (cut) { out.background.depth_image = cut; put(out.background, "depth", bg.depth === false ? false : true); }
      else if (DEPTH_SCENE.test(image)) put(out.background, "depth", SAN.b(bg.depth));
      // video: a short loop played over the photo, which is its still picture (bg-video.js says what
      // may be named: a file on this TV, or a video the design store keeps; never a link). A blur
      // is drawn on the still only: blurring every frame of a video is too slow for a TV.
      var vid = vidOk(bg.video);
      if (vid) { out.background.video = vid; if (out.background.blur) { delete out.background.blur; note("A video background is not blurred, so the blur was taken off."); } }
      else if (bg.video !== undefined) note("That video background is not allowed: only a built in loop or a video from Couch TV Studio's store.");
    } else if (bg.video !== undefined) {
      note("A video background needs its still picture, so it was left out.");
    }
    if (!out.background && SAN.c(bg.colour)) {
      out.background = { colour: SAN.c(bg.colour) };   // one plain colour, in a plain colour format
      // or two, as a gradient (the widget presets): two colours and an angle, nothing else
      if (SAN.c(bg.colour2)) { out.background.colour2 = SAN.c(bg.colour2); put(out.background, "angle", SAN.n(bg.angle, 0, 360, true)); put(out.background, "radial", SAN.b(bg.radial)); }
    }   // one plain colour, in a plain colour format
    var ap = obj(raw.apps), a = {};
    put(a, "order", SAN.list(ap.order, 40, function (p) { return pkgOk(p) ? p : undefined; }));
    put(a, "hidden", SAN.list(ap.hidden, 200, function (p) { return pkgOk(p) && KEEP.indexOf(p) < 0 ? p : undefined; }));
    var tl = obj(ap.tiles), tiles = {};
    Object.keys(tl).slice(0, 60).forEach(function (p) {
      if (!pkgOk(p) || KEEP.indexOf(p) >= 0) return;   // Settings and More apps stay put in the dock
      var src = obj(tl[p]), t = {};
      // only an app out on the screen has a place of its own (an app in the dock goes where the dock puts it)
      put(t, "free", SAN.b(src.free)); if (src.free === true) { put(t, "x", SAN.n(src.x, -3840, 3840)); put(t, "y", SAN.n(src.y, -2160, 2160)); }
      put(t, "scale", SAN.n(src.scale, 0.2, 4)); put(t, "icon_shape", SAN.pick(src.icon_shape, Object.keys(SHAPES))); put(t, "icon_style", SAN.pick(src.icon_style, STYLES));
      if (Object.keys(t).length) tiles[p] = t;
    });
    if (Object.keys(tiles).length) a.tiles = tiles;
    if (Object.keys(a).length) out.apps = a;
    put(out, "texts", SAN.list(raw.texts, 8, function (t) {
      t = obj(t);
      var c = { text: SAN.w(t.text, 120) || "" };
      put(c, "id", idOk(t.id) ? t.id : undefined); sanPlace(t, c); put(c, "size", SAN.n(t.size, 8, 400)); sanType(t, c);
      return c;
    }));
    put(out, "objects", SAN.list(raw.objects, 40, sanObject));
    // the widgets' shared look (EDITING.md 9): plain colours and an icon style, nothing else
    var lk = obj(raw.look), look = {};
    ["ink", "sub", "panel", "rim", "solid", "paper", "accent", "focus"].forEach(function (k) { put(look, k, SAN.c(lk[k])); });
    put(look, "icons", SAN.pick(lk.icons, WSTYLE.icons)); put(look, "night_red", SAN.b(lk.night_red));
    if (Object.keys(look).length) out.look = look;
    // the dock can be made small or faint, never gone
    if (out.elements && out.elements.dock) {
      var dk = out.elements.dock;
      if (dk.scale !== undefined && dk.scale < 0.5) { dk.scale = 0.5; note("The dock was made at least half size."); }
      if (dk.opacity !== undefined && dk.opacity < 0.4) { dk.opacity = 0.4; note("The dock was made easier to see."); }
    }
    // the home's own parts can grow, but not until they cover the screen
    if (out.elements) Object.keys(LIMIT.part).forEach(function (k) {
      var p = out.elements[k];
      if (p && p.scale !== undefined && p.scale > LIMIT.part[k]) { p.scale = LIMIT.part[k]; note("Parts of the home made very big were brought back to a size that leaves the screen usable."); }
    });
    scam(out);
    budget(out);
    capFonts(out);
    return out;
  }

  // words with a phone number or a web address are not drawn on a TV: a shared design must not be
  // able to tell someone to ring or visit anywhere (the designer warns about them before download).
  // Every word the design puts on the screen is read twice: piece by piece, and all together in
  // reading order (top to bottom, left to right), so a number split over two cards is caught too.
  // Before reading, the words are normalised: full width and other look-alike characters to plain
  // ones (Unicode NFKC), number words to digits ("one nine hundred" is 1900), "dot" and a dot in
  // brackets to a dot, and the spaces round a dot taken out.
  function scam(d) {
    var pieces = words(d), bad = scan(pieces), dropped = false;
    if (!bad.length) return;
    bad.forEach(function (p) { p.drop(); dropped = true; });
    if (d.objects) d.objects = d.objects.filter(function (o) { return !o.__gone; });
    if (d.texts) d.texts = d.texts.filter(function (t) { return !t.__gone; });
    if (dropped) note("Words with a phone number or a web address in them are not shown on a TV.");
  }
  // every piece of words a design draws, in reading order, each with how to take it out
  function words(d) {
    var out = [];
    var objs = (d.objects || []).slice().sort(function (a, b) { return ((a.y || 0) - (b.y || 0)) || ((a.x || 0) - (b.x || 0)); });
    objs.forEach(function (o) {
      var gone = function () { o.__gone = true; };
      if (o.type === "text") out.push({ id: o.id, t: o.text, drop: gone });
      if (typeof o.name === "string" && (o.type === "smart")) out.push({ id: o.id, t: o.name, drop: gone });
      if (o.type === "widget") [o].concat(o.items || []).forEach(function (wd) {
        var op = wd.opts || {};
        ["kicker", "label", "text", "sub", "caption", "bin_a", "bin_b"].forEach(function (k) { if (typeof op[k] === "string") out.push({ id: o.id, t: op[k], drop: function () { delete op[k]; } }); });
        (op.controls || []).forEach(function (c) { if (typeof c.name === "string") out.push({ id: o.id, t: c.name, drop: function () { delete c.name; } }); });
      });
      if (o.type === "group") (o.controls || []).forEach(function (c) {
        if (typeof c.name === "string") out.push({ id: o.id, t: c.name, drop: function () { o.controls = (o.controls || []).filter(function (x) { return x !== c; }); } });
      });
      if (o.type === "smart") {
        ["status", "value"].forEach(function (k) { if (typeof o[k] === "string") out.push({ id: o.id, t: o[k], drop: function () { delete o[k]; } }); });
        ["zones", "items"].forEach(function (k) {
          (o[k] || []).forEach(function (z, i) { out.push({ id: o.id, t: z, drop: function () { o[k] = (o[k] || []).filter(function (x) { return x !== z; }); } }); });
        });
      }
    });
    (d.texts || []).forEach(function (t, i) { out.push({ id: "text" + i, t: t.text, drop: function () { t.__gone = true; } }); });
    return out.filter(function (p) { return typeof p.t === "string" && p.t.length; });
  }
  var NUM = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
    twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "00", thousand: "000",
    // the same in the languages the home speaks most (Spanish, Italian, French, German, Portuguese)
    cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
    due: "2", tre: "3", quattro: "4", cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9",
    "z\u00e9ro": "0", deux: "2", trois: "3", quatre: "4", sept: "7", huit: "8", neuf: "9",
    null: "0", eins: "1", zwei: "2", drei: "3", vier: "4", "f\u00fcnf": "5", sechs: "6", sieben: "7", acht: "8", neun: "9",
    um: "1", "tr\u00eas": "3", quatro: "4", oito: "8" };
  var NUM_RE = new RegExp("\\b(" + Object.keys(NUM).join("|") + ")\\b", "g");
  var TLDS = "com|net|org|edu|gov|au|io|co|info|biz|xyz|app|me|tv|ly|link|shop|online|site|help|ai|uk|us|nz|ca|de|fr|club|top|store|tech|page|live|pro|vip|win|cc|gg|to|ws|in|click|support|fun|website|space|world|email|digital|network|services|agency|asia|eu|jp|cn|ru|br|sg|hk|ie|za|cloud|dev|xxx|bet|casino|loan|money|cash|pay|ly|sh|gl|lol|icu|cyou|rest|bar|ink|one|today|news|blog";
  // a known web ending, or any two words joined by a dot with no space (words in a design never need one)
  var WEB_RE = new RegExp("(?:https?:|www\\.|@[a-z0-9-]+|[a-z0-9][a-z0-9-]*\\.(?:" + TLDS + ")(?![a-z0-9])|[a-z]{2,}\\.[a-z]{2,})", "g");
  // eight or more digits with only spaces, dots, dashes, slashes, brackets, commas or plus signs between
  var PHONE_RE = /\+?\d(?:[\s\-.\/(),+_·•|]*\d){7,}/g;
  function norm(t) {
    t = String(t);
    try { t = t.normalize("NFKC"); } catch (e) {}
    t = t.toLowerCase().replace(/[‐-―−]/g, "-").replace(/[。．․‧·]/g, ".");
    // invisible characters and keycap marks between digits; Cyrillic and Greek letters that look Latin
    t = t.replace(/[​-‏⁠﻿️⃣­]/g, "");
    t = t.replace(/[аеорсухіѕԁӏονιατјтмнкв]/g, function (c) {
      return { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ѕ": "s", "ԁ": "d", "ӏ": "l",
        "ο": "o", "ν": "v", "ι": "i", "α": "a", "τ": "t", "ј": "j", "т": "t", "м": "m", "н": "h", "к": "k", "в": "b" }[c];
    });
    // l, i or | written for 1 next to digits
    for (var j = 0; j < 3; j++) t = t.replace(/(\d)[li|]/g, "$11").replace(/[li|](\d)/g, "1$1");
    t = t.replace(/\bdouble\s+(\d)/g, "$1$1").replace(/\btriple\s+(\d)/g, "$1$1$1");
    t = t.replace(NUM_RE, function (m) { return NUM[m]; });
    t = t.replace(/\bdouble\s+(\d)/g, "$1$1").replace(/\btriple\s+(\d)/g, "$1$1$1");
    // the letter o next to digits reads as a nought ("19OO"); "oh" between digits too
    for (var i = 0; i < 3; i++) t = t.replace(/(\d)\s*oh?\b/g, "$1 0").replace(/(\d)o/g, "$10").replace(/o(\d)/g, "0$1");
    // spelt out dots: "dot", "(dot)", "[.]", " . "
    t = t.replace(/\s*[\(\[\{<]\s*(?:dot|\.)\s*[\)\]\}>]\s*/g, ".").replace(new RegExp("(?:\\s+dot\\s+|\\s*\\.\\s+|\\s+\\.\\s*)(?=(?:" + TLDS + ")\\b)", "g"), ".");
    // letters spaced apart ("f i x m y t v . c o m"): three or more single letters in a row are one word
    t = t.replace(/(?:\b[a-z0-9]\s+){2,}[a-z0-9]\b/g, function (m) { return m.replace(/\s+/g, ""); });
    t = t.replace(new RegExp("\\s*\\bdot\\s*(?=(?:" + TLDS + ")\\b)", "g"), ".");
    t = t.replace(new RegExp("(?:\\s*\\.\\s+|\\s+\\.\\s*)(?=(?:" + TLDS + ")\\b)", "g"), ".");
    return t;
  }
  // the pieces that hold a phone number or a web address, read alone and all together
  function scan(pieces) {
    var joined = "", spans = [];
    pieces.forEach(function (p) { var n = norm(p.t); spans.push([joined.length, joined.length + n.length]); joined += n + " "; });
    var hit = {};
    [[PHONE_RE, "phone"], [WEB_RE, "web"]].forEach(function (rx) {
      rx[0].lastIndex = 0;
      var m;
      while ((m = rx[0].exec(joined))) {
        var a = m.index, b = m.index + m[0].length;
        spans.forEach(function (s, i) { if (s[0] < b && s[1] > a) { hit[i] = hit[i] || {}; hit[i][rx[1]] = true; } });
      }
    });
    return Object.keys(hit).map(function (i) { var p = pieces[+i]; p.kinds = Object.keys(hit[i]); return p; });
  }

  // ---------------- the budget: what a slow TV can draw, and what a design may cover ----------------
  // The same weights as the designer's speed meter. A design over them is brought within them here,
  // and each change is noted, so the designer can show it before download.
  var LIMIT = { frosted: 6, frostedArea: 1.2, rotated: 8, cover: 0.3, coverAll: 0.6, objArea: 0.25, textPx: 300, objScale: 3, glow: 10, cost: 100,
    part: { clock: 3, date: 4, weather: 4, people: 3, quick: 3, keep_watching: 1.5 } };
  var NOTES = [];
  function note(t) { if (NOTES.indexOf(t) < 0) NOTES.push(t); }
  var SCREEN = 1920 * 1080;
  // about where an object sits and how big it is, before it is drawn (w and h, when set, are its widget box)
  function boxOf(o) {
    var sc = o.scale || 1, w, h;
    if (o.type === "shape") { w = (o.w || 600) * sc; h = (o.variant === "line" ? (o.h || 4) : (o.h || 320)) * sc; }
    else if (o.w && o.h) { w = o.w * sc; h = o.h * sc; }
    else if (o.type === "smart") { w = (o.style === "tile" ? 200 : o.style === "pill" ? 380 : o.style === "icon" ? 130 : o.kind === "camera" || o.kind === "doorbell" ? 540 : 460) * sc; h = (o.style === "tile" ? 200 : o.style === "pill" ? 80 : o.style === "icon" ? 140 : o.kind === "camera" || o.kind === "doorbell" ? 400 : 190) * sc; }
    else if (o.type === "weather") { w = (o.style === "card" ? 330 : o.style === "big" ? 320 : 440) * sc; h = (o.style === "card" ? 180 : o.style === "big" ? 200 : 44) * sc; }
    else if (o.type === "clock") { var cs = o.size || 120; w = cs * 2.4 * sc; h = cs * (o.date ? 1.45 : 1.1) * sc; }
    else {
      // words: the longest line across, every line down (a wide letter is about 0.62 of the size)
      var lines = String(o.text || "").split("\n"), longest = 0, size = o.size || 56;
      lines.forEach(function (l) { longest = Math.max(longest, l.length); });
      // a line wider than the safe area wraps there (cd-text2 has a max width): more lines, never wider
      var wraps = 0; lines.forEach(function (l) { wraps += Math.max(1, Math.ceil(Math.max(1, l.length) * size * 0.62 * sc / 1760)); });
      w = Math.min(1760, Math.max(1, longest) * size * 0.62 * sc); h = wraps * size * 1.15 * sc;
    }
    return { x: o.x || 0, y: o.y || 0, w: w, h: h };
  }
  // how much of the screen it covers (clipped to the screen)
  function areaOf(o) {
    var b = boxOf(o);
    var cw = Math.max(0, Math.min(1920, b.x + b.w) - Math.max(0, b.x)), ch = Math.max(0, Math.min(1080, b.y + b.h) - Math.max(0, b.y));
    return cw * ch;
  }
  function frosted(o) {
    if (o.hidden) return false;
    if (o.type === "shape") return (o.variant || "glass") === "glass";
    if (o.type === "smart") return o.style !== "icon" && (o.panel || "glass") === "glass";
    if (o.type === "group") return (o.panel || "glass") === "glass";
    if (o.type === "weather" && o.style === "card") return (o.panel || "glass") === "glass";
    if (o.type === "widget") return wpanel(o) === "glass" || (o.kind === "stack" && list(o.items).some(function (it) { return wpanel(it) === "glass"; }));
    return o.shade === "panel";
  }
  function makeSolid(o) {
    if (o.type === "widget") { o.style = obj(o.style); o.style.panel = "solid"; list(o.items).forEach(function (it) { if (wpanel(it) === "glass") { it.style = obj(it.style); it.style.panel = "solid"; } }); return; }
    if (o.type === "shape") o.variant = "solid";
    else if (o.shade === "panel") o.shade = "glow";
    else o.panel = "solid";
  }
  // what a design asks of the TV, part by part: the speed meter's weights (the designer shows the
  // same list, scaled to the TV picked). [what, weight, key]
  function cost(d) {
    d = obj(d);
    var home = obj(d.home), E = obj(d.elements), bg = obj(d.background), objs = list(d.objects), out = [];
    out.push(["The home itself", 10, "home"]);
    if (bg.image) out.push(["Your photo", 3, "photo"]);
    else if (bg.colour) out.push(["Plain colour", 1, "colour"]);
    // a looping video: decoded by the TV's video chip, but every frame makes the TV draw again what
    // sits over it (frosted panels most of all). A slow TV keeps the still picture (bg-video.js).
    if (bg.image && bg.video) out.push(["Video background", 24, "bgvideo"]);
    else if (home.scenes && home.scenes.length === 1) out.push(["One scene", 2, "scene"]);
    else out.push(["Scenes taking turns", 6, "scenes"]);
    if (bg.blur) out.push(["Blurred background", bg.blur > 8 ? 14 : 8, "blur"]);
    ["people", "quick", "keep_watching", "dock"].forEach(function (k) {
      var e = obj(E[k]);
      if (e.hidden || (k === "keep_watching" && home.keep_watching === false)) return;
      if ((e.panel || "glass") === "glass") out.push(["Frosted panel behind " + ({ people: "people", quick: "the quick buttons", keep_watching: "Keep watching", dock: "the dock" })[k], 3, "panel:" + k]);
    });
    if (!obj(E.clock).hidden && obj(E.clock).style !== "solid") out.push(["Glass clock", 4, "glassclock"]);
    if (home.clock_style === "liquid") out.push(["Liquid glass clock", 6, "liquid"]);
    if ((home.glass_amount || 0) > 2) out.push(["Glass level " + home.glass_amount, (home.glass_amount - 2) * 3, "glassamount"]);
    if (home.ambient_weather) out.push(["Rain and snow effects", 34, "weatherfx"]);
    if (home.ambient_sun_grade) out.push(["Sunlight colour", 4, "sungrade"]);
    if (home.moving_tiles) out.push(["Moving tiles", 4, "moving"]);
    if (home.video_url) out.push(["Video background", 40, "video"]);
    if (obj(E.dock).icon_style === "glass" || home.glass_icons) out.push(["Glass app icons", 6, "glassicons"]);
    var shown = objs.filter(function (o) { return !obj(o).hidden; });
    var fr = shown.filter(frosted).length;
    if (fr) out.push(["Frosted cards (" + fr + ")", fr * 3, "frosted"]);
    var plain = shown.length - fr;
    if (plain > 0) out.push(["Other things added (" + plain + ")", Math.ceil(plain / 2), "objects"]);
    // widgets: pictures cost a decode, turning ones a cross fade, a glass clock its fill
    var WCOST = { photo: 2, slideshow: 4, mosaic: 4, artframe: 2, memory: 2, upnext: 3, keeprow: 2, picks: 2, camera: 4, glassclock: 4, nowplaying: 2, stack: 2, games: 1, hourly: 1, week: 1 };
    var wsum = 0, wn = 0;
    shown.forEach(function (o) { if (o.type !== "widget") return; wn++; [o].concat(list(o.items)).forEach(function (it) { wsum += WCOST[it.kind] || 0; }); });
    if (wn) out.push(["Widgets (" + wn + ")", Math.ceil(wn / 2) + wsum, "widgets"]);
    var ctls = shown.reduce(function (n, o) { return n + (o.type === "group" ? list(o.controls).filter(function (c) { return !obj(c).app; }).length : 0); }, 0);
    if (ctls) out.push(["Controls in sections (" + ctls + ")", Math.ceil(ctls / 4), "controls"]);
    var glows = Object.keys(E).filter(function (k) { return obj(E[k]).shade && !obj(E[k]).hidden; }).length + shown.filter(function (o) { return o.shade; }).length;
    if (glows) out.push(["Glow behind words (" + glows + ")", glows * 2, "glow"]);
    // glass words: a soft shadow under every letter, redrawn when the words change (no blur behind them)
    var inked = function (v) { return shown.filter(function (o) { return o.type === "widget" && [o].concat(list(o.items)).some(function (it) { return obj(obj(it).style).ink === v; }); }).length; };
    var gtext = inked("glass");
    if (gtext) out.push(["Glass words (" + gtext + ")", gtext, "glasstext"]);
    // liquid glass words: the photo behind seen through every letter, drawn again with a shadow filter each
    // time the words change; weighed like a frosted card (3 each)
    var ltext = inked("liquid");
    if (ltext) out.push(["Liquid glass words (" + ltext + ")", ltext * 3, "liquidtext"]);
    var strong = Object.keys(E).filter(function (k) { return obj(E[k]).shadow === "strong"; }).length + shown.filter(function (o) { return o.shadow === "strong"; }).length;
    if (strong) out.push(["Strong shadows (" + strong + ")", strong, "strong"]);
    var turned = shown.filter(function (o) { return o.rotate; }).length;
    if (turned) out.push(["Turned things (" + turned + ")", turned, "turned"]);
    return out;
  }
  // where an added thing may sit: its box inside the safe area (null for a backdrop behind the home)
  function safePlace(o) {
    if (o.type === "shape" && o.layer === "back") return null;
    var b = boxOf(o), x = o.x || 0, y = o.y || 0;
    return { x: Math.round(b.w >= 1760 ? 80 : Math.max(80, Math.min(1840 - b.w, x))), y: Math.round(b.h >= 960 ? 60 : Math.max(60, Math.min(1020 - b.h, y))) };
  }
  function total(items) { return items.reduce(function (n, i) { return n + i[1]; }, 0); }

  function budget(d) {
    var objs = d.objects || [];
    objs.forEach(function (o) {
      // words stay a readable size, cards a sensible one
      if (o.type === "text" && (o.size || 56) * (o.scale || 1) > LIMIT.textPx) { o.scale = Math.round(LIMIT.textPx / (o.size || 56) * 1000) / 1000; note("Very large words were made smaller."); }
      if (o.type !== "shape" && (o.scale || 1) > LIMIT.objScale) { o.scale = LIMIT.objScale; note("Very large cards were made smaller."); }
      // and none of them, alone, covers more than a quarter of the screen
      // a widget is a box on the grid, up to the whole safe area (a photo frame): it is never scaled
      if (o.type === "widget") { o.w = Math.min(1760, o.w); o.h = Math.min(960, o.h); return; }
      if (o.type !== "shape") {
        var b = boxOf(o), a = b.w * b.h;
        if (a > LIMIT.objArea * SCREEN) { o.scale = Math.round((o.scale || 1) * Math.sqrt(LIMIT.objArea * SCREEN / a) * 1000) / 1000; note("Very large cards and words were made smaller, so none covers more than a quarter of the screen."); }
      }
    });
    // everything added sits inside the safe area (80 at the sides, 60 at the top and bottom): nothing
    // can be thrown off the screen. A card behind the home may fill it (a backdrop).
    objs.forEach(function (o) {
      var p = safePlace(o);
      if (p && (Math.abs(p.x - (o.x || 0)) > 1 || Math.abs(p.y - (o.y || 0)) > 1)) { o.x = p.x; o.y = p.y; note("Things placed off the screen were brought inside its safe area."); }
    });
    // turned objects: a few at most
    var turned = 0;
    objs.forEach(function (o) { if (o.rotate) { turned++; if (turned > LIMIT.rotated) { delete o.rotate; note("Only " + LIMIT.rotated + " things can be turned; the rest were straightened."); } } });
    // frosted glass: a few at most, and not too much of the screen
    var count = 0, area = 0;
    objs.forEach(function (o) {
      if (!frosted(o)) return;
      count++; area += areaOf(o);
      if (count > LIMIT.frosted || area > LIMIT.frostedArea * SCREEN) { makeSolid(o); note("Frosted glass is slow on a TV: at most " + LIMIT.frosted + " frosted cards, the rest were made solid."); }
    });
    // everything in front of the home (cards, words, widgets, clocks) may cover at most 30% of the
    // screen: past that it goes behind the home, so the apps stay on top
    var cover = 0;
    objs.forEach(function (o) {
      if (o.type === "widget" || o.layer === "back" || o.hidden || (o.type === "shape" && (o.variant === "line" || o.variant === "outline"))) return;   // widgets are the home itself (widget mode)
      cover += areaOf(o);
      if (cover > LIMIT.cover * SCREEN) { o.layer = "back"; note("Big things were moved behind the home so the apps stay on top."); }
    });
    // and cards, words and widgets together, in front or behind, at most 60%: past that they are left out
    var all = 0;
    d.objects = objs.filter(function (o) {
      if (o.hidden || o.type === "shape" || o.type === "widget") return true;
      all += areaOf(o);
      if (all > LIMIT.coverAll * SCREEN) { note("Cards and words covering most of the screen were left out, so the home can be seen."); return false; }
      return true;
    });
    if (!d.objects.length) delete d.objects;
    objs = d.objects || [];
    // glows behind words: a few at most (each is a big soft shadow the TV draws again every frame)
    var glows = 0;
    objs.forEach(function (o) { if (o.shade && !o.hidden) { glows++; if (glows > LIMIT.glow) { delete o.shade; note("Only " + LIMIT.glow + " glows behind words; the rest were taken off."); } } });
    // the whole design: past what a TV can draw smoothly, the heaviest extras go first
    var h = d.home || {};
    var steps = [
      [function () { return h.ambient_weather; }, function () { delete h.ambient_weather; }, "Rain and snow effects were switched off: too slow with everything else."],
      [function () { return d.background && d.background.video; }, function () { delete d.background.video; }, "The video background was switched off: too slow with everything else. Its still picture stays."],
      [function () { return h.clock_style === "liquid"; }, function () { delete h.clock_style; }, "The liquid clock went back to frosted glass: too slow with everything else."],
      [function () { return (h.glass_amount || 0) > 2; }, function () { h.glass_amount = 2; }, "The glass level was brought down to 2."],
      [function () { return d.background && d.background.blur > 8; }, function () { d.background.blur = 8; }, "The background blur was made lighter."],
      [function () { return h.moving_tiles || h.ambient_sun_grade || h.glass_icons; }, function () { delete h.moving_tiles; delete h.ambient_sun_grade; delete h.glass_icons; }, "Moving tiles, sunlight colour and glass icons were switched off."],
      [function () { return objs.some(function (o) { return o.shade || o.shadow === "strong"; }); }, function () { objs.forEach(function (o) { delete o.shade; if (o.shadow === "strong") o.shadow = "soft"; }); }, "Glows and strong shadows on added words were made plain."]
    ];
    for (var i = 0; i < steps.length && total(cost(d)) > LIMIT.cost; i++) {
      if (steps[i][0]()) { steps[i][1](); note(steps[i][2]); }
    }
    if (d.home && !Object.keys(d.home).length) delete d.home;
  }

  // ---------------- words that should not travel in a shared design ----------------
  // the same reading as scam(), for the designer: which words, and whether a number or an address
  function flags(d) {
    var c = JSON.parse(JSON.stringify(obj(d)));
    return scan(words(c)).map(function (p) { return p.kinds.map(function (k) { return { where: p.id, kind: k, text: String(p.t).slice(0, 60) }; }); }).reduce(function (a, b) { return a.concat(b); }, []);
  }

  // ---------------- the look settings (read by app.js before anything is drawn) ----------------
  function home(h, design, opts) {
    // a design got by code: told here too (home() runs before start()), so no preview switch such as
    // ?design=local lets its look settings in before "Use this design?" is answered
    if (opts && opts.fromCode) FROM_CODE = true;
    // switched off on this TV, or not accepted on this TV yet (or declined): none of its look settings,
    // so a declined design leaves every setting exactly as before, through restarts
    if ((!DESIGNER || FROM_CODE) && (offNow() || (design && needsConfirm(design)))) return h;
    var dh = obj(sanitize(design).home), out = {}, k;
    if (!Object.keys(dh).length) return h;
    for (k in h) if (Object.prototype.hasOwnProperty.call(h, k)) out[k] = h[k];
    HOME_KEYS.forEach(function (key) { if (dh[key] !== undefined) out[key] = dh[key]; });
    return out;
  }

  // ---------------- the stylesheet ----------------
  function textRules(sel, e, opts) {
    var r = [];
    var f = fontOf(e.font);
    if (f) r.push("font-family:" + f + (opts && opts.important ? " !important" : ""));
    var w = parseInt(e.weight, 10);
    if (w >= 100 && w <= 900) r.push("font-weight:" + w);
    var c = colour(e.colour);
    if (c) r.push("color:" + c);
    if (e.shade === "glow") r.push("text-shadow:" + GLOW);
    else if (TEXT_SHADOW[e.shadow]) r.push("text-shadow:" + TEXT_SHADOW[e.shadow]);
    if (e.case === "upper") r.push("text-transform:uppercase;letter-spacing:0.06em");
    return r.length ? sel + "{" + r.join(";") + "}" : "";
  }
  function common(sel, e) {
    var r = [];
    if (e.hidden === true) r.push("visibility:hidden !important");
    if (e.opacity !== undefined) r.push("opacity:" + num(e.opacity, 1, 0.1, 1));
    // a hidden part the remote moves into shows again while it is there (the dock of an art TV),
    // only once a key has been pressed: the home puts focus somewhere by itself when it opens
    return r.length ? sel + "{" + r.join(";") + "}" + (e.hidden === true ? "\n" + sel.replace("html.cd", "html.cd.cd-keys") + ":has(.focus){visibility:visible !important}" : "") : "";
  }
  function panel(sel, kind) {
    if (kind === "none") return sel + "{background:none !important;box-shadow:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important}";
    if (kind === "solid") return sel + "{background:rgba(18, 18, 22, 0.8) !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important}";
    return "";
  }

  function css(d) {
    var E = obj(d.elements), out = [], H = "html.cd";
    // clock.at "scene" (Couch TV Studio's Couch Original): the clock and the date stay where each built in
    // scene puts them, as on the home with no design: behind the hills, and on the Waterline scene on the
    // water with its reflection under it. Only over the scenes: a design's own background keeps one place.
    var atScene = obj(E.clock).at === "scene" && !d.background;
    // the base: in a design every part keeps one place, whichever scene is showing
    if (!atScene) {
      out.push(H + ".theme-night #scenes .gclock{left:0;right:0;top:11.5rem;font-size:25rem;text-align:center}");
      out.push(H + ".theme-night #date{left:0 !important;right:0 !important;top:6rem;text-align:center}");
      out.push(H + " #date .wx{display:none}");
    } else {
      // the weather stays in the date line, as on the home with no design (hidden with the weather part)
      out.push(H + " #cd-weather{display:none !important}");
      if (obj(E.weather).hidden === true) out.push(H + " #date .wx{display:none}");
      if (obj(E.weather).place === false) out.push(H + " #date .wx .wx-place{display:none}");
      if (obj(E.weather).words === false) out.push(H + " #date .wx .ww{display:none}");
    }
    out.push(H + " #cd-weather{position:fixed;left:0;right:0;top:9rem;z-index:2;text-align:center;white-space:nowrap;pointer-events:none;" +
      "font-size:1.75rem;line-height:2.25rem;font-weight:450;color:rgba(255, 255, 255, 0.84);text-shadow:0 0.125rem 1.125rem rgba(0, 0, 0, 0.25)}");
    out.push(H + ":not(.theme-night) #cd-weather{display:none}");
    out.push(H + " #cd-weather svg{width:1.75rem;height:1.75rem;vertical-align:-0.32rem;margin-right:0.4rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}");
    out.push(H + ".scene-fog #cd-weather{color:rgba(22, 32, 29, 0.76);text-shadow:none}");
    out.push(H + " #cd-texts{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2;pointer-events:none}");
    out.push(H + " .cd-text{position:absolute;white-space:pre;transform-origin:0 0;line-height:1.15;font-family:" + FONTS.inter +
      ";font-weight:600;color:#fff;text-shadow:" + TEXT_SHADOW.soft + "}");

    // the clock: moved with a translate and sized with its font, so the glass can be lined up again
    var ce = obj(E.clock), cm = place(ce);
    // (a photo that would not load takes the clock's own styling with it: the scene's clock comes back)
    var clockSel = H + ":not(.cd-bg-missing).theme-night #scenes .gclock";
    var cr = [];
    // a clock in each scene's own place is not moved or sized: the reflection and the hills are lined up with it there
    if (atScene) cm = { x: 0, y: 0, s: 1, r: 0 };
    if (cm.x || cm.y) cr.push("transform:translate(" + vw(cm.x) + "," + vh(cm.y) + ")");
    if (cm.s !== 1) cr.push("font-size:" + +(25 * cm.s).toFixed(3) + "rem");
    if (fontOf(ce.font)) cr.push("font-family:" + fontOf(ce.font) + (ce.font === "antonio" ? "" : ";letter-spacing:-0.045em;line-height:0.86"));
    var cw = parseInt(ce.weight, 10);
    if (cw >= 100 && cw <= 900) cr.push("font-weight:" + cw);
    if (ce.shade === "glow") cr.push("filter:drop-shadow(0 0 1.25rem rgba(0, 0, 0, 0.55)) drop-shadow(0 0.25rem 0.5rem rgba(0, 0, 0, 0.45))");
    else if (CLOCK_SHADOW[ce.shadow]) cr.push("filter:" + CLOCK_SHADOW[ce.shadow]);
    if (cr.length) out.push(clockSel + "{" + cr.join(";") + "}");
    out.push(common(clockSel, ce));
    // a scene's hills stand in front of its clock where it normally sits; a clock moved anywhere
    // else would vanish behind them, so in a design it is in front unless clock.behind is true
    if (ce.behind !== true && !atScene) out.push(H + ":not(.cd-bg-missing).theme-night #scenes .scene .fg{z-index:0}" + clockSel + "{z-index:1}");
    if (ce.style === "solid") {
      var cc = colour(ce.colour) || "#ffffff";
      out.push(clockSel + " .fill{background-image:none !important;color:" + cc + " !important;opacity:1 !important;filter:none !important}");
      out.push(clockSel + " .sheen, " + clockSel + " .rim, " + clockSel + " .edge{display:none !important}");
      out.push(clockSel + ".under{display:none}");
      // solid digits have no reflection: the Waterline scene's cut at the waterline comes off too
      if (atScene) out.push(clockSel + "{clip-path:none !important;-webkit-clip-path:none !important}");
    }
    // the Classic and OLED clock, top right
    if (moved(cm)) out.push(H + ":not(.theme-night) #time{transform:translate(" + vw(cm.x) + "," + vh(cm.y) + ") scale(" + cm.s + ");transform-origin:100% 0}");
    out.push(textRules(H + ":not(.theme-night) #time", { font: ce.font, weight: ce.weight, colour: ce.colour, shadow: ce.shadow, shade: ce.shade }));

    // date, weather, people, quick buttons, Keep watching
    Object.keys(PARTS).forEach(function (key) {
      var e = obj(E[key]), m = place(e), sel = H + " " + PARTS[key].sel;
      if (key === "keep_watching" && e.auto_y) m.y += e.auto_y;
      if (moved(m)) out.push(sel + "{transform:" + tf(m) + ";transform-origin:" + PARTS[key].origin + "}");
      out.push(common(sel, e));
    });
    out.push(textRules(H + " #date", obj(E.date)));
    if (obj(E.date).shade === "panel") out.push(H + " #date .dline{" + PANEL + "}");
    out.push(textRules(H + " #cd-weather", obj(E.weather)));
    if (obj(E.weather).shade === "panel") out.push(H + " #cd-weather{left:50%;right:auto;margin-left:-50vw;width:100vw}" + H + " #cd-weather > span{display:inline-block;" + PANEL + "}");
    if (obj(E.weather).place === false) out.push(H + " #cd-weather .wx-place{display:none}");
    if (obj(E.weather).words === false) out.push(H + " #cd-weather .ww{display:none}");
    out.push(textRules(H + " #shelf-section .shelf-head h2", obj(E.keep_watching)));
    if (fontOf(obj(E.keep_watching).font)) out.push(H + " #shelf-section .ncard{font-family:" + fontOf(obj(E.keep_watching).font) + "}");
    out.push(shelfCompact(obj(E.keep_watching).compact));
    out.push(panel(H + " #people", obj(E.people).panel));
    out.push(panel(H + " .qbtn:not(.focus)", obj(E.quick).panel));
    out.push(panel(H + " .ncard:not(.focus)", obj(E.keep_watching).panel));

    // the clock's shade: a dark pool under the digits, in each scene's own shade layer
    // (not for a clock in each scene's own place: the pool is drawn for the one place, and each scene has its own shade)
    if (ce.shade === "panel" && !atScene) {
      out.push(H + ".theme-night #scenes .scene .shade{background:radial-gradient(ellipse " + vw(900 * cm.s) + " " + vh(420 * cm.s) + " at " +
        vw(960 + cm.x) + " " + vh(184 + cm.y + 170 * cm.s) + ", rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0) 72%)}");
    }

    // the dock: centred at the bottom, so it grows up from its bottom middle
    var de = obj(E.dock), dm = place(de), dsel = H + " #apps-section";
    dm.r = 0;   // the dock never turns: apps pulled out of it are placed from its box
    if (moved(dm)) {
      out.push(H + ".theme-night:not(.expanded) #apps-section{transform:translate(calc(-50% + " + vw(dm.x) + ")," + vh(dm.y) + ") scale(" + dm.s + ");transform-origin:50% 100%}");
      out.push(H + ":not(.theme-night):not(.expanded) #apps-section{transform:translate(" + vw(dm.x) + "," + vh(dm.y) + ") scale(" + dm.s + ");transform-origin:0 0}");
    }
    if (de.hidden === true) {
      out.push(H + " #grid{background:none !important;box-shadow:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important}");
      out.push(H + " #grid .app:not(.focus){opacity:0.55}");
      out.push(common(dsel, { opacity: de.opacity }));
    } else out.push(common(dsel, de));
    out.push(panel(H + " #grid", de.panel));
    var size = num(de.icon_size, 112, 40, 240), gap = num(de.icon_gap, 26, 0, 120);
    var labels = de.labels === "always" || de.labels === "off" ? de.labels : "focus";
    var right = de.label_pos === "right" && labels !== "off";
    if (de.icon_size !== undefined || de.icon_gap !== undefined || labels !== "focus" || right || (de.layout && de.layout !== "row")) {
      out.push(H + ".theme-night:not(.expanded) #grid{position:relative;grid-auto-rows:" + rem(size) + " !important;column-gap:" + rem(gap) + " !important;grid-column-gap:" + rem(gap) +
        " !important;row-gap:" + rem(gap + (labels === "always" && !right ? 34 : 0)) + " !important;grid-row-gap:" + rem(gap + (labels === "always" && !right ? 34 : 0)) + " !important" +
        (labels === "always" && !right ? ";padding-bottom:3.5rem" : "") + (right ? ";padding-right:15rem" : "") + "}");
      out.push(H + ".theme-night:not(.expanded) #grid .app{width:" + rem(size) + ";height:" + rem(size) + "}");
    }
    // names under every icon: each gets the width of its icon and half the space either side, no more
    if (labels === "always") out.push(H + " #grid .app .label{opacity:1" + (right ? "" : ";left:" + rem(-gap / 2) + ";right:" + rem(-gap / 2)) + "}");
    if (labels === "off") out.push(H + " #grid .app .label{display:none}");
    if (right) out.push(H + " #grid .app .label{left:calc(100% + 1.25rem);right:auto;top:50%;transform:translateY(-50%);text-align:left;width:13rem}");
    // icon shapes and styles: classes on each tile (cd-sh-*, cd-st-*), set by tiles()
    Object.keys(SHAPES).forEach(function (s) {
      out.push(H + " #grid .app.cd-sh-" + s + " .face{border-radius:" + SHAPES[s] + " !important;corner-shape:" + (s === "squircle" ? "superellipse(2)" : "round") + " !important}");
    });
    out.push(H + " #grid .app.cd-sh-none:not(.focus) .face:not(.tool){background:none !important;box-shadow:none !important}");
    out.push(H + " #grid .app.cd-sh-none .face.clear > img:not(.glyph){display:none}");
    out.push(H + " #grid .app .face .glyph{display:none}");
    out.push(H + " #grid .app.cd-sh-none .face.clear .glyph{display:block;object-fit:contain;filter:drop-shadow(0 0.125rem 0.375rem rgba(0, 0, 0, 0.45))}");
    out.push(H + " #grid .app.cd-st-mono:not(.focus) .face img{filter:grayscale(1) brightness(0.92) !important}");
    out.push(H + " #grid .app.cd-st-glass:not(.focus) .face:not(.tool){background:rgba(255, 255, 255, 0.13) !important;-webkit-backdrop-filter:blur(1rem) saturate(150%);backdrop-filter:blur(1rem) saturate(150%);" +
      "box-shadow:inset 0 0 0 0.0625rem rgba(255, 255, 255, 0.32), inset 0 0.125rem 0.0625rem -0.0625rem rgba(255, 255, 255, 0.7), 0 0.75rem 1.75rem rgba(0, 0, 0, 0.3) !important}");
    out.push(H + " #grid .app.cd-st-glass:not(.focus) .face.clear > img:not(.glyph){display:none}");
    out.push(H + " #grid .app.cd-st-glass:not(.focus) .face.clear .glyph{display:block;object-fit:contain;opacity:0.92;filter:drop-shadow(0 0.0625rem 0.125rem rgba(0, 0, 0, 0.28))}");
    out.push(H + " #grid .app.cd-st-glass:not(.focus) .face:not(.tool):not(.clear) img{filter:grayscale(1) contrast(1.25) brightness(1.1) !important;opacity:0.55;mix-blend-mode:luminosity}");
    out.push(H + " #grid .app.cd-st-outline .face:not(.tool), " + H + " #grid .app.cd-st-dark .face:not(.tool){display:flex;align-items:center;justify-content:center}");
    out.push(H + " #grid .app.cd-st-outline:not(.focus) .face:not(.tool){background:rgba(0, 0, 0, 0.12) !important;box-shadow:inset 0 0 0 0.1875rem rgba(255, 255, 255, 0.85) !important}");
    out.push(H + " #grid .app.cd-st-outline .face:not(.tool) > img:not(.glyph), " + H + " #grid .app.cd-st-dark .face:not(.tool) > img:not(.glyph){width:62%;height:62%;border-radius:24%}");
    out.push(H + " #grid .app.cd-st-dark:not(.focus) .face:not(.tool){background:#141518 !important;box-shadow:inset 0 0 0 0.0625rem rgba(255, 255, 255, 0.08), 0 0.75rem 1.5rem rgba(0, 0, 0, 0.4) !important}");
    if (de.icon_tone === "dim") out.push(H + " #grid .app:not(.focus) .face{opacity:0.6}");
    out.push(H + ".theme-night #grid{position:relative}");
    out.push(H + " #grid .app.cd-free{visibility:visible;margin:0 !important;z-index:1}");
    out.push(H + ".cd-keys #grid .app.cd-free.focus{z-index:3}");

    // single app tiles in the dock: moved inside it and sized with zoom (it keeps the focus lift working)
    var tiles = obj(obj(d.apps).tiles);
    Object.keys(tiles).forEach(function (p) {
      if (!pkgOk(p)) return;
      var t = obj(tiles[p]);
      if (t.free) return;   // placed by tiles(), from the dock's box
      var m = place(t);
      if (!moved(m)) return;
      out.push(H + ' #grid .app[data-pkg="' + p + '"]:not(.cd-free){position:relative;left:' + vw(m.x / m.s) + ";top:" + vh(m.y / m.s) + ";zoom:" + m.s + ";z-index:1}");
    });
    // your own background: a photo, or one plain colour (a black screen for a bedroom or an OLED)
    var bg = obj(d.background), src = imgOk(bg.image), col = !src && colour(bg.colour);
    if (src || col) {
      var z = num(bg.zoom, 1, 1, 4);
      out.push(H + " #cd-bg{position:fixed;top:0;left:0;right:0;bottom:0;overflow:hidden;pointer-events:none}");
      var col2 = col && colour(bg.colour2), fillc = col2 ? (bg.radial ? "radial-gradient(120% 100% at 25% 15%," + col + "," + col2 + ")" : "linear-gradient(" + num(bg.angle, 160, 0, 360) + "deg," + col + "," + col2 + ")") : col;
      if (col) out.push(H + " #cd-bg i{display:none}" + H + " #cd-bg b{position:absolute;top:0;left:0;right:0;bottom:0;background:" + fillc + ";opacity:1}");
      else {
        out.push(H + " #cd-bg i{position:absolute;top:0;left:0;right:0;bottom:0;background-image:" + cssUrl(src) + ";background-repeat:no-repeat;background-size:" +
          (z * 100) + "vw " + (z * 100) + "vh;background-position:" + num(bg.x, 50, 0, 100) + "% " + num(bg.y, 50, 0, 100) + "%" +
          (num(bg.blur, 0, 0, 40) ? ";filter:blur(" + num(bg.blur, 0, 0, 40) / 16 + "rem);transform:scale(1.06)" : "") + "}");
      }
      // the video (bg-video.js puts it between the photo and the shade): placed like the photo,
      // hidden until it really plays, so the still picture shows first and stays if it cannot
      if (src && bg.video) {
        var vx = num(bg.x, 50, 0, 100), vy = num(bg.y, 50, 0, 100);
        out.push(H + " #cd-bg video{position:absolute;left:" + +((1 - z) * vx).toFixed(3) + "vw;top:" + +((1 - z) * vy).toFixed(3) + "vh;width:" + z * 100 + "vw;height:" + z * 100 +
          "vh;object-fit:cover;opacity:0;transition:opacity 0.6s ease-in-out;pointer-events:none}" + H + " #cd-bg video.on{opacity:1}");
        // the glass clock's fill is the still picture: over a moving video it is frosted white instead
        out.push(H + ".cd-vid-on #scenes .gclock .fill{background-image:none !important;color:rgba(255, 255, 255, 0.8) !important;filter:none !important;opacity:1 !important}");
      }
      var SCRIM = { top: "linear-gradient(180deg,#000,rgba(0,0,0,.25) 45%,rgba(0,0,0,.5))", bottom: "linear-gradient(0deg,#000,rgba(0,0,0,.2) 50%,rgba(0,0,0,.35))", left: "linear-gradient(90deg,#000,rgba(0,0,0,.3) 60%)", right: "linear-gradient(270deg,#000,rgba(0,0,0,.3) 60%)" };
      if (!col) out.push(H + " #cd-bg b{position:absolute;top:0;left:0;right:0;bottom:0;background:" + (SCRIM[bg.scrim] || "#000") + ";opacity:" + num(bg.darken, 0.15, 0, 0.9) + "}");
      // the hills of a built in scene, in front of the widgets behind: placed and darkened like the photo
      // (or the design's own cut out of its photo, background.depth_image)
      var fgSrc = depthSrc(bg, src);
      if (fgSrc) {
        var dk = num(bg.darken, 0.15, 0, 0.9);
        out.push(H + " #cd-depth{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background-image:" + cssUrl(fgSrc) +
          ";background-repeat:no-repeat;background-size:" + (z * 100) + "vw " + (z * 100) + "vh;background-position:" + num(bg.x, 50, 0, 100) + "% " + num(bg.y, 50, 0, 100) + "%" +
          ";filter:brightness(" + +(1 - dk * 0.85).toFixed(3) + ")" + (num(bg.blur, 0, 0, 40) ? " blur(" + num(bg.blur, 0, 0, 40) / 16 + "rem);transform:scale(1.06)" : "") + "}");
        out.push(H + ":not(.theme-night) #cd-depth, " + H + ".expanded #cd-depth{display:none}");
      }
      out.push(H + ".cd-bg .scene .sbg, " + H + ".cd-bg .scene .fg, " + H + ".cd-bg .scene .svid, " + H + ".cd-bg .bg, " + H + ".cd-bg #bgvid{visibility:hidden !important}");
      if (ce.shade !== "panel") out.push(H + ".cd-bg .scene .shade{visibility:hidden !important}");
      out.push(H + ".cd-bg #scenes .gclock.under{display:none}");
      out.push(H + ".cd-bg #scenes .gclock{clip-path:none !important}");
      out.push(H + ".cd-bg #scenes .gclock .fill{filter:brightness(1.32) saturate(1.08)}");
    }

    // the words of v1 designs (design.texts); newer designs use objects of type "text"
    list(d.texts).slice(0, 8).forEach(function (t, i) {
      t = obj(t);
      var sel = H + ' .cd-text[data-i="' + i + '"]', m = place(t), size = num(t.size, 48, 8, 400);
      out.push(sel + "{left:" + vw(m.x) + ";top:" + vh(m.y) + ";font-size:" + vw(size * m.s) + "}");
      out.push(textRules(sel, t));
      out.push(common(sel, t));
    });

    out.push(OBJ_CSS);
    out.push(EDIT_CSS);
    // in a design no word on the home is under 23 px (Apple's smallest tvOS text, research/apple-tv-ui.md):
    // app names, the app line and the episode line on Keep watching, word tiles
    out.push(H + " #grid .app .label{font-size:1.4375rem;line-height:1.75rem}" + H + " .ncard .nap{font-size:1.4375rem;line-height:1.75rem}" +
      H + " .ncard i{font-size:1.4375rem;line-height:1.875rem}" + H + ".theme-night .app .face.word{font-size:1.4375rem}");
    if (labels === "focus") out.push("html.cd-edit #grid .app.focus .label{opacity:0}");
    // on a TV, no focus shows until someone presses a key: a calm screen does not open on a lit tile
    out.push(EDIT_CSS.split("\n").filter(function (l) { return l.indexOf("html.cd-edit") === 0; }).map(function (l) { return l.split("html.cd-edit").join("html.cd:not(.cd-keys)"); }).join("\n"));
    out.push("html.cd:not(.cd-keys) #grid .app.focus .label{opacity:0}" + (de.hidden === true ? "html.cd:not(.cd-keys) #grid .app.focus{opacity:0.55}" : ""));
    return out.filter(Boolean).join("\n");
  }


  // ---------------- a small Keep watching: one show at a time ----------------
  // The section is one card wide; the row behind it slides along to the next show every 8 seconds
  // while nobody is on it. With the remote on it, the home's own scrolling shows the chosen show
  // (one card in view), so every show is still reached with Left and Right.
  var KW_W = { one: 34.5, square: 25 };   // rem: one card and its focus ring
  function shelfCompact(mode) {
    if (!KW_W[mode]) return "";
    var H = "html.cd.theme-night", w = KW_W[mode];
    var r = [H + " #shelf-section{width:" + w + "rem !important;max-width:" + w + "rem;overflow:hidden;padding:0.5rem 1rem 1rem;margin:-0.5rem -1rem -1rem}",
      H + " #shelf{transition:transform 700ms cubic-bezier(0.22, 1, 0.36, 1)}",
      H + " #shelf-section .shelf-head{display:flex;align-items:center;justify-content:space-between}" + H + " #shelf-section .shelf-head h2{white-space:nowrap}",
      "#cd-kw-dots{display:inline-flex;gap:0.5rem;margin-left:1rem}#cd-kw-dots i{width:0.625rem;height:0.625rem;border-radius:50%;background:rgba(255, 255, 255, 0.32)}#cd-kw-dots i.on{background:#fff}"];
    if (mode === "square") {
      r.push(H + " #shelf .ncard{flex-direction:column;align-items:stretch;gap:0.875rem;width:23rem;padding:0.875rem}",
        H + " #shelf .ncard .thumb{width:100%;height:12.25rem;border-radius:1.125rem}",
        H + " #shelf .ncard b{font-size:1.875rem;line-height:2.375rem}");
    }
    return r.join("\n");
  }
  var kwTimer = null, kwAt = 0;
  function shelfTurns() {
    var mode = D && ON && D.elements && D.elements.keep_watching && D.elements.keep_watching.compact;
    if (!KW_W[mode]) { if (kwTimer) { clearInterval(kwTimer); kwTimer = null; } kwDots(0, 0); return; }
    if (kwTimer) return;
    kwTimer = setInterval(function () {
      var track = document.getElementById("shelf"), cards = track ? track.querySelectorAll(".ncard") : [];
      if (!track || cards.length < 2 || !KW_W[D && D.elements && D.elements.keep_watching && D.elements.keep_watching.compact]) return;
      // someone is on the shelf with the remote: the home's own scrolling shows their show
      if (ROOT.classList.contains("cd-keys") && track.querySelector(".ncard.focus")) return;
      kwAt = (kwAt + 1) % cards.length;
      var step = cards[0].offsetWidth + parseFloat(getComputedStyle(track).columnGap || 0);
      track.style.transform = "translateX(" + (document.documentElement.dir === "rtl" ? 1 : -1) * kwAt * step + "px)";
      kwDots(cards.length, kwAt);
    }, 8000);
    setTimeout(function () { var t = document.getElementById("shelf"); kwDots(t ? t.querySelectorAll(".ncard").length : 0, kwAt); }, 400);
  }
  // a small row of dots beside the heading says the shows take turns, and which one is showing
  function kwDots(n, at) {
    var head = document.querySelector("#shelf-section .shelf-head"), box = document.getElementById("cd-kw-dots");
    if (!head || n < 2) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("span"); box.id = "cd-kw-dots"; box.setAttribute("aria-hidden", "true"); head.appendChild(box); }
    if (box.children.length !== Math.min(n, 8)) { while (box.firstChild) box.removeChild(box.firstChild); for (var i = 0; i < Math.min(n, 8); i++) box.appendChild(document.createElement("i")); }
    [].forEach.call(box.children, function (d, i) { d.className = i === at % Math.min(n, 8) ? "on" : ""; });
  }

  // ---------------- free objects ----------------
  // Drawn at 1920x1080 in two layers scaled to the screen: behind the home's parts, or in front.
  var OBJ_CSS = [
    "html.cd .cd-layer{position:fixed;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;pointer-events:none;font-family:" + FONTS.inter + ";color:#fff}",
    "html.cd #cd-back{z-index:0}html.cd #cd-front{z-index:3}",
    "html.cd:not(.theme-night) .cd-layer{display:none}",
    ".cd-o{position:absolute;transform-origin:0 0;white-space:nowrap}",
    ".cd-o svg:not([focusable]){fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
    ".cd-text2{white-space:pre-wrap;line-height:1.15;font-weight:600}",
    ".cd-shade-panel{background:rgba(8, 9, 12, 0.5);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-radius:14px;padding:6px 18px}",
    ".cd-shape-glass{background:rgba(255, 255, 255, 0.12);-webkit-backdrop-filter:blur(28px) saturate(160%);backdrop-filter:blur(28px) saturate(160%);box-shadow:inset 0 0 0 1px rgba(255, 255, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 24px 60px rgba(0, 0, 0, 0.28)}",
    ".cd-shape-solid{background:rgba(16, 17, 20, 0.8);box-shadow:0 24px 60px rgba(0, 0, 0, 0.3)}",
    ".cd-shape-outline{box-shadow:inset 0 0 0 3px rgba(255, 255, 255, 0.85)}",
    // cards: weather and smart home
    ".cd-card{padding:24px 28px;border-radius:30px;background:rgba(20, 20, 26, 0.42);-webkit-backdrop-filter:blur(28px) saturate(160%);backdrop-filter:blur(28px) saturate(160%);" +
      "box-shadow:inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 24px 60px rgba(0, 0, 0, 0.28)}",
    ".cd-card.cd-flat{background:rgba(16, 17, 20, 0.82);-webkit-backdrop-filter:none;backdrop-filter:none}",
    ".cd-card.cd-bare{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none;padding:0}",
    ".cd-k{font-size:23px;font-weight:600;letter-spacing:0.01em;color:rgba(255, 255, 255, 0.66)}",
    ".cd-v{font-size:56px;font-weight:600;letter-spacing:-0.02em;line-height:1.05}",
    ".cd-s{font-size:23px;color:rgba(255, 255, 255, 0.78);margin-top:4px}",
    ".cd-row{display:flex;align-items:center;gap:16px}",
    ".cd-ic{display:flex;align-items:center;justify-content:center;flex:none;width:64px;height:64px;border-radius:50%;background:rgba(255, 255, 255, 0.14)}",
    ".cd-ic svg{width:34px;height:34px}",
    ".cd-ic.on{background:#ffd479;color:#1d1608}",
    ".cd-ic.cool{background:#8fd0ff;color:#06202f}",
    ".cd-tile{width:200px;height:200px;padding:22px;border-radius:36px;display:flex;flex-direction:column;justify-content:space-between}",
    ".cd-pill{display:inline-flex;align-items:center;gap:14px;padding:12px 26px 12px 12px;border-radius:999px}",
    ".cd-pill .cd-ic{width:52px;height:52px}",
    ".cd-only{padding:0;background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}",
    ".cd-only .cd-ic{width:96px;height:96px}.cd-only .cd-ic svg{width:48px;height:48px}",
    ".cd-cam{width:480px;height:270px;border-radius:22px;overflow:hidden;position:relative;background:linear-gradient(160deg, #2a2d33, #121317);display:flex;align-items:center;justify-content:center;color:rgba(255, 255, 255, 0.55)}",
    ".cd-cam svg{width:64px;height:64px}",
    ".cd-cam i{position:absolute;left:16px;top:14px;font-style:normal;font-size:23px;font-weight:650;padding:4px 10px;border-radius:8px;background:rgba(0, 0, 0, 0.5);color:#fff}",
    // the chips share the card's width, so a wide scenes card is filled, not three chips and empty glass
    ".cd-chips{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px;max-width:640px}", ".cd-chips-fill{max-width:none}", ".cd-chips-fill .cd-chip{flex:1 1 auto;justify-content:center}",
    ".cd-chip{display:inline-flex;align-items:center;gap:10px;padding:12px 20px;border-radius:999px;background:rgba(255, 255, 255, 0.14);font-size:23px;font-weight:600}",
    ".cd-chip svg{width:24px;height:24px}",
    ".cd-wx-big .cd-v{font-size:140px;font-weight:300;letter-spacing:-0.04em}",
    ".cd-wx svg{width:56px;height:56px}",
    ".cd-n{font-size:26px;font-weight:650}",
    ".cd-demo{position:absolute;top:-12px;right:-12px;padding:4px 10px;border-radius:9px;background:#ffd479;color:#231a05;font-size:23px;font-weight:750;letter-spacing:0.02em;box-shadow:0 4px 12px rgba(0, 0, 0, 0.3)}",
    ".cd-off .cd-n{color:rgba(255, 255, 255, 0.86)}",
    ".cd-ic-off{background:rgba(255, 255, 255, 0.07);color:rgba(255, 255, 255, 0.5);box-shadow:inset 0 0 0 2px rgba(255, 255, 255, 0.14)}",
    ".cd-nc{display:inline-flex;align-items:center;gap:8px;color:rgba(255, 255, 255, 0.6)}",
    ".cd-nc::before{content:\"\";width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(255, 255, 255, 0.5)}",
    // the camera sample: a plain grey frame, not a photo of anywhere
    ".cd-cam-demo{background:linear-gradient(180deg, #4a515c 0%, #353b44 55%, #2a2e35 100%)}",
    ".cd-cam-demo i{background:rgba(255, 212, 121, 0.92);color:#231a05}",
    ".cd-cam-off{background:repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0 14px, rgba(255, 255, 255, 0.07) 14px 28px), #1b1d22;color:rgba(255, 255, 255, 0.4)}",
    ".cd-off .cd-chip{background:rgba(255, 255, 255, 0.07);color:rgba(255, 255, 255, 0.6)}",
    ".cd-off .cd-v{color:rgba(255, 255, 255, 0.4)}",
    // widgets on the grid: the card is exactly its cells, its inside centred
    ".cd-fit{box-sizing:border-box;overflow:hidden;max-width:none}",
    ".cd-fit.cd-card:not(.cd-pill):not(.cd-tile){display:flex;flex-direction:column;justify-content:center}",
    ".cd-fit.cd-pill{display:flex}",
    ".cd-fit.cd-tile{padding:24px}",
    ".cd-fit.cd-tile .cd-s{white-space:normal;line-height:1.25}",
    // scene buttons in a card on the grid: bigger buttons that fill the card, not a strip at its top
    ".cd-fit .cd-chips-fill{margin-top:22px;gap:16px}.cd-fit .cd-chips-fill .cd-chip{padding:20px 26px;font-size:26px}",
    ".cd-fit.cd-only, .cd-fit.cd-wx-big, .cd-fit.cd-clockw{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}",
    ".cd-fit .cd-cam{width:100%;height:auto;flex:1;min-height:0}",
    // a weather card much wider than tall: the place and the words on the left, the temperature big on the right
    ".cd-fit.cd-wide.cd-wx{display:grid !important;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:28px;align-content:center}",
    ".cd-fit.cd-wide.cd-wx > .cd-k{grid-column:1;grid-row:1;align-self:end}.cd-fit.cd-wide.cd-wx > .cd-s{grid-column:1;grid-row:2;align-self:start}",
    ".cd-fit.cd-wide.cd-wx > .cd-row{grid-column:2;grid-row:1 / span 2;margin:0 !important}.cd-fit.cd-wide.cd-wx .cd-v{font-size:76px}.cd-fit.cd-wide.cd-wx svg{width:72px;height:72px}",
    // sections: one panel, its controls on its own even grid (the panel's corner is the control's plus its padding)
    ".cd-group{position:relative;box-sizing:border-box;border-radius:44px}",
    ".cd-gpanel{background:rgba(20, 20, 26, 0.38);-webkit-backdrop-filter:blur(28px) saturate(160%);backdrop-filter:blur(28px) saturate(160%);box-shadow:inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 24px 60px rgba(0, 0, 0, 0.28)}",
    ".cd-gpanel.cd-flat{background:rgba(16, 17, 20, 0.82);-webkit-backdrop-filter:none;backdrop-filter:none}",
    ".cd-gpanel.cd-bare{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}",
    ".cd-ctl{position:absolute;box-sizing:border-box;display:flex;overflow:hidden;border-radius:28px;background:rgba(255, 255, 255, 0.12);color:#fff;white-space:nowrap}",
    ".cd-bare .cd-ctl{background:rgba(14, 15, 19, 0.66);box-shadow:inset 0 0 0 1px rgba(255, 255, 255, 0.1)}",
    ".cd-ctl.on{background:rgba(244, 244, 247, 0.9);color:#15171c}",
    ".cd-ctl-ic{flex:none;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;background:rgba(255, 255, 255, 0.16)}",
    ".cd-ctl-ic svg{width:38px;height:38px}",
    ".cd-ctl-ic.on{background:#ffd479;color:#1d1608}.cd-ctl-ic.on.cd-tone-cool{background:#8fd0ff;color:#06202f}.cd-ctl-ic.on.cd-tone-scene{background:#15171c;color:#fff}",
    ".cd-off .cd-ctl-ic{background:rgba(255, 255, 255, 0.07);color:rgba(255, 255, 255, 0.55);box-shadow:inset 0 0 0 2px rgba(255, 255, 255, 0.14)}",
    ".cd-ctl-tx{display:flex;flex-direction:column;gap:2px;min-width:0}",
    ".cd-ctl-n{font-size:26px;font-weight:650;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:100%}",
    ".cd-ctl-st{font-size:23px;line-height:1.3;color:rgba(255, 255, 255, 0.72);overflow:hidden;text-overflow:ellipsis}",
    ".cd-ctl.on .cd-ctl-st{color:rgba(21, 23, 28, 0.64)}",
    ".cd-ctl-s{flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px 14px;text-align:center}",
    ".cd-ctl-s .cd-ctl-n{font-size:24px;font-weight:620}",
    ".cd-ctl-w{align-items:center;gap:18px;padding:0 24px}",
    ".cd-ctl-t, .cd-ctl-b{flex-direction:column;justify-content:space-between;padding:24px}",
    ".cd-ctl-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
    ".cd-ctl-v{font-size:56px;font-weight:600;letter-spacing:-0.02em;line-height:1}",
    ".cd-ctl-b .cd-ctl-ic{width:96px;height:96px}.cd-ctl-b .cd-ctl-ic svg{width:50px;height:50px}.cd-ctl-b .cd-ctl-n{font-size:32px}.cd-ctl-b .cd-ctl-v{font-size:76px;font-weight:500}",
    ".cd-ctl-b{padding:28px}.cd-ctl-b .cd-ctl-st{font-size:24px}",
    ".cd-slot{position:absolute;display:flex;align-items:center;justify-content:center}",
    // an icon style drawn as a whole tile (Colour tile, Glass, Playful) is its own backing
    ".cd-ic-full, .cd-ic-full.on, .cd-off .cd-ic-full{background:none !important;box-shadow:none !important;color:inherit}",
    ".cd-ic-full svg, .cd-ctl-b .cd-ic-full svg{width:100% !important;height:100% !important}",
    ".cd-off .cd-ic-full svg{opacity:0.6;filter:saturate(0.4)}",
    ".cd-slot i{display:block;width:62%;max-width:62%;aspect-ratio:1;max-height:62%;border-radius:22.5%;background:rgba(255, 255, 255, 0.22)}"
  ].join("\n");

  var ICON = {
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.8"/><path d="M12 2.5v2.7M12 18.8v2.7M2.5 12h2.7M18.8 12h2.7M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M5.3 18.7l1.9-1.9M16.8 7.2l1.9-1.9"/></svg>',
    aircon: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>',
    light: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    speaker: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2.5"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7.5" r="0.9"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/></svg>',
    doorbell: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="5"/><circle cx="12" cy="9" r="2"/><circle cx="12" cy="16" r="1.4"/></svg>',
    network: '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.1"/></svg>',
    devices: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="13" height="9" rx="1.5"/><path d="M1.5 17h16"/><rect x="18" y="9" width="4.5" height="9" rx="1"/></svg>',
    vacuum: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3"/></svg>',
    appliance: '<svg viewBox="0 0 24 24"><rect x="4.5" y="2.5" width="15" height="19" rx="2"/><circle cx="12" cy="13.5" r="4.2"/><path d="M7.5 6h3"/></svg>',
    scene: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
    power: '<svg viewBox="0 0 24 24"><path d="M12 3.5v8"/><path d="M7 6.6a7.5 7.5 0 1 0 10 0"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'
  };

  // a small builder: strings become text nodes, never markup
  function h(tag, cls, style, kids) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.keys(style).forEach(function (k) { if (style[k] !== undefined && style[k] !== "") e.style.setProperty(k, String(style[k])); });
    (kids || []).forEach(function (c) { if (c === null || c === undefined || c === "") return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  // our own icons (fixed markup in this file, never from a design), parsed once and copied
  var ICON_NODES = {};
  // Icon styles: more sets of the same icons, registered by code that ships with the home
  // (CouchDesign.registerIcons). A design only names a set; a name this TV does not have draws the
  // built in line icons. Never markup from a design.
  var ICON_SETS = {}, ICON_SET_LABELS = [["line", "Classic"]];
  function icon(name, size, set) {
    var src = (set && ICON_SETS[set] && ICON_SETS[set][name]) ? ICON_SETS[set][name] : ICON[name] || ICON.light, key = (src === ICON[name] ? "" : set + ":") + name;
    if (!ICON_NODES[key]) { var tpl = document.createElement("template"); tpl.innerHTML = src; ICON_NODES[key] = tpl.content.firstChild; }
    var n = ICON_NODES[key].cloneNode(true);
    if (key !== name) uniq(n);
    if (size) { n.style.width = size + "px"; n.style.height = size + "px"; }
    return n;
  }
  // a registered icon may carry its own gradients and masks: each copy gets its own ids, so two
  // copies on one screen never point at each other's
  var UID = 0;
  function uniq(n) {
    var ids = n.querySelectorAll ? n.querySelectorAll("[id]") : [];
    if (!ids.length) return n;
    var sfx = "-c" + (++UID), map = {};
    [].forEach.call(ids, function (e) { map[e.id] = e.id + sfx; e.id = map[e.id]; });
    [].forEach.call(n.querySelectorAll("*"), function (e) {
      [].forEach.call(e.attributes, function (a) { if (a.value.indexOf("#") >= 0) a.value = a.value.replace(/#([A-Za-z0-9_-]+)/g, function (m, i) { return map[i] ? "#" + map[i] : m; }); });
    });
    return n;
  }
  // sets drawn as a whole tile (a squircle or a sticker): no round backing of ours behind them
  var ICON_FULL = {};
  function icFull(set) { return set && ICON_SETS[set] && ICON_FULL[set] ? " cd-ic-full" : ""; }
  function textStyle(o, base) {
    var st = {};
    if (fontOf(o.font)) st["font-family"] = fontOf(o.font);
    var w = parseInt(o.weight, 10);
    if (w >= 100 && w <= 900) st["font-weight"] = w;
    if (colour(o.colour)) st.color = colour(o.colour);
    if (o.shade === "glow") st["text-shadow"] = GLOW;
    else if (TEXT_SHADOW[o.shadow]) st["text-shadow"] = TEXT_SHADOW[o.shadow];
    else if (base) st["text-shadow"] = TEXT_SHADOW.soft;
    if (o.case === "upper") { st["text-transform"] = "uppercase"; st["letter-spacing"] = "0.06em"; }
    if (o.align === "center" || o.align === "right") st["text-align"] = o.align;
    return st;
  }
  function withStyle(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function cardClass(o) { return "cd-card" + (o.panel === "solid" ? " cd-flat" : o.panel === "none" ? " cd-bare" : ""); }

  function weatherBits() {
    var w = document.querySelector("#date .wx");
    // no date line at all means a page that is not a TV (the designer's Add panel): sample weather
    if (!w) return FORCE_DEMO || !document.getElementById("date") ? { place: "Riverside", temp: "24°", words: "Partly cloudy", icon: icon("sun") } : null;
    var c = w.cloneNode(true), place = c.querySelector(".wx-place"), words = c.querySelector(".ww"), svg = c.querySelector("svg");
    var bits = {
      place: place ? (place.querySelector(".wx-town") || place).textContent.replace(/\s*·\s*$/, "").replace(/^\s*·\s*/, "") : "",
      words: words ? words.textContent.replace(/^\s*·\s*/, "") : "",
      icon: svg ? svg.cloneNode(true) : null   // the home's own icon, copied as a node
    };
    if (place) place.remove(); if (words) words.remove(); if (svg) svg.remove();
    bits.temp = c.textContent.trim();
    return bits;
  }
  function timeText(o) {
    var d = new Date(), hh = d.getHours(), m = d.getMinutes(), mm = (m < 10 ? "0" : "") + m;
    var c24 = o.format === "24h" ? true : o.format === "12h" ? false : (hooks.clock24 ? hooks.clock24() : false);
    return c24 ? (hh < 10 ? "0" : "") + hh + ":" + mm : (hh % 12 || 12) + ":" + mm;
  }
  function dateText(o) {
    var loc = window.I18N ? window.I18N.locale() : "en-AU";
    var s = new Date().toLocaleDateString(loc, DATE_FORMATS[o.date_format] || { weekday: "long", day: "numeric", month: "long" }).replace(/,/g, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // a widget with a box (w and h, from the designer's grid) is drawn exactly that size
  function fitBox(node, o) {
    if (o.type === "shape" || o.type === "text" || !(o.w && o.h)) return node;
    // a pill (a camera with no picture, a pill widget) keeps its own shape, centred in its box:
    // stretched, it became a huge oval (review round 5)
    if (node.classList.contains("cd-pill")) {
      return h("div", "cd-cell", { width: num(o.w, 200, 40, 1920) + "px", height: num(o.h, 80, 40, 1080) + "px", display: "flex", "align-items": "center", "justify-content": "center" }, [node]);
    }
    node.classList.add("cd-fit");
    var bw = num(o.w, 400, 40, 1920), bh = num(o.h, 200, 40, 1080);
    // a card in a bigger size grows its inside with it (up to 1.6 times), so every size reads from the
    // couch and none is a small card floating in a big empty one: the card keeps exactly its cells
    if (o.type === "weather" && o.style === "card" && bw / bh > 2.6) node.classList.add("cd-wide");
    var nat = natural(o), z = nat ? Math.max(1, Math.min(1.6, bw / nat[0], bh / nat[1])) : 1;
    if (z < 1.05) z = 1;
    node.style.width = bw / z + "px";
    node.style.height = bh / z + "px";
    if (z > 1) node.style.zoom = String(Math.round(z * 1000) / 1000);
    node.style.minWidth = "0";
    return node;
  }
  // how big a card's inside is at its own size (what fitBox grows from)
  function natural(o) {
    if (o.type === "weather") return o.style === "card" ? [330, 170] : o.style === "big" ? [340, 210] : null;
    if (o.type === "smart") {
      if (o.kind === "camera" || o.kind === "doorbell") return null;
      if (o.kind === "scene") return null;   // its buttons share the card's width: grown, they would wrap
      if (o.kind === "aircon" && o.style === "card") return [620, 200];
      if (o.style === "card") return [440, 120];
      if (o.style === "tile") return [200, 200];
    }
    return null;
  }
  // one object's inside, built as elements
  function inner(o) {
    var t = o.type;
    if (t === "text") return h("div", "cd-text2" + (o.shade === "panel" ? " cd-shade-panel" : ""), withStyle({ "font-size": num(o.size, 56, 8, 400) + "px", "max-width": Math.round(1760 / num(o.scale, 1, 0.1, 8)) + "px" }, textStyle(o, true)), [String(o.text || "")]);
    if (t === "shape") {
      var v = ["glass", "solid", "outline", "line"].indexOf(o.variant) >= 0 ? o.variant : "glass";
      var w = num(o.w, 600, 4, 3840), hh = v === "line" ? num(o.h, 4, 1, 40) : num(o.h, 320, 4, 2160), bgc = colour(o.colour);
      var st = { width: w + "px", height: hh + "px", "border-radius": num(o.radius, v === "line" ? 2 : 36, 0, 1000) + "px" };
      if (v === "line") st.background = bgc || "rgba(255, 255, 255, 0.8)";
      if (v === "solid" && bgc) st.background = bgc;
      if (v === "outline" && bgc) st["box-shadow"] = "inset 0 0 0 3px " + bgc;
      return h("div", "cd-shape-" + v, st);
    }
    if (t === "clock") {
      var size = num(o.size, 120, 16, 600);
      return h("div", "cd-clockw" + (o.shade === "panel" ? " cd-shade-panel" : ""), textStyle(o, true), [
        // the digits at the size set, or smaller when "22:02" would be wider than the clock's box
        h("div", "", { "font-size": Math.max(1, Math.round(Math.min(size, ((o.w || size * 2.4) - 8) / (timeText(o).length * ((parseInt(o.weight, 10) || 300) >= 600 ? 0.62 : 0.56))))) + "px", "line-height": "1", "letter-spacing": "-0.03em", "font-weight": parseInt(o.weight, 10) || 300, "white-space": "nowrap" }, [timeText(o)]),
        // the date as wide as the clock's box allows ("Wednesday 18 November" is wider than the digits),
        // never cut at the sides; and its gap grows with the clock, so a small one fits its box too
        o.date ? h("div", "", { "font-size": Math.max(1, Math.round(Math.min(size * 0.24, ((o.w || size * 2.4) - 8) / (dateText(o).length * 0.56)))) + "px",
          "margin-top": Math.round(Math.min(8, size * 0.05)) + "px", "font-weight": "500", "white-space": "nowrap", "max-width": "100%", overflow: "hidden", "text-overflow": "ellipsis" }, [dateText(o)]) : null
      ]);
    }
    if (t === "weather") {
      var b = weatherBits() || { place: "", words: "", icon: null, temp: "" }, showPlace = o.place !== false;
      if (o.style === "big") return h("div", "cd-wx cd-wx-big", textStyle(o, true), [h("div", "cd-v", null, [b.temp]), h("div", "cd-s", null, [b.words + (showPlace && b.place ? " · " : ""), showPlace && b.place ? h("span", "wx-town", null, [b.place]) : null])]);
      if (o.style === "card") {
        return h("div", "cd-wx " + cardClass(o), withStyle({ "min-width": "300px" }, textStyle(o)), [
          showPlace ? h("div", "cd-k", null, [h("span", "wx-town", null, [b.place])]) : null,
          h("div", "cd-row", { "margin-top": "8px" }, [b.icon, h("span", "cd-v", null, [b.temp])]),
          h("div", "cd-s", null, [b.words])
        ]);
      }
      if (b.icon) { b.icon.style.width = "32px"; b.icon.style.height = "32px"; }
      return h("div", "cd-wx" + (o.shade === "panel" ? " cd-shade-panel" : ""), withStyle({ "font-size": "30px" }, textStyle(o, true)), [
        // the town is the place's own name (app.js weatherPlace), and a long one ends in "..." (.wx-town)
        h("span", "cd-row", { gap: "10px" }, [b.icon, h("span", null, { "white-space": "nowrap" }, [showPlace && b.place ? h("span", "wx-town", null, [b.place]) : null, (showPlace && b.place ? " · " : "") + b.temp + (b.words ? " · " + b.words : "")])])
      ]);
    }
    if (t === "smart") return smart(o);
    if (t === "group") return group(o);
    if (t === "widget") {
      if (!window.CouchWidgets) return h("div", "", { width: o.w + "px", height: o.h + "px" });
      return window.CouchWidgets.render(o, wenv());
    }
    return h("div");
  }
  // The apps a person changed with the remote (Hold OK: Change app, Move, Remove, Add app), kept on this
  // TV only: { "<object id>|<kind>": [catalogue ids or package names] }. They win over the design's own
  // apps for that container, survive a restart, and stay when a new design arrives unless the person
  // picks "Use its own apps" (askFirst). Never in a design: they name this TV's own apps.
  var EDITS_KEY = "couchtv.design.appedits", EDITS = readEdits();
  function readEdits() {
    var out = {}, raw = null;
    try { raw = JSON.parse(localStorage.getItem(EDITS_KEY) || "null"); } catch (e) { raw = null; }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) Object.keys(raw).slice(0, 60).forEach(function (k) {
      if (!/^[A-Za-z0-9_-]{1,60}\|[a-z]{1,20}$/.test(k) || !Array.isArray(raw[k])) return;
      out[k] = raw[k].filter(function (p) { return pkgOk(p) && KEEP.indexOf(p) < 0; }).slice(0, 16);
    });
    return out;
  }
  function saveEdits() { try { if (Object.keys(EDITS).length) localStorage.setItem(EDITS_KEY, JSON.stringify(EDITS)); else localStorage.removeItem(EDITS_KEY); } catch (e) {} }
  function editsOf(id, kind) { var e = EDITS[id + "|" + kind]; return Array.isArray(e) ? e.slice() : null; }
  // Each widget's own settings (docs/WIDGET-SETTINGS-CONTRACT.md) are kept by app.js in Home settings
  // (ST.widgets["<id>|<kind>"]), never here and never in a design; widgets read them as env.wset, by the
  // widget's id. A widget in a smart stack has the id "<stack id>/<its place in the stack>".
  // Every widget on the home now, a stack's widgets too: [{ key, id, kind, label, x, y, w, h }].
  function widgetList() {
    var out = [], seen = {};
    if (D && ON) list(D.objects).forEach(function (o) {
      o = obj(o);
      if (o.type !== "widget") return;
      // a smart stack has settings of its own (when it moves on), then each of its widgets has its own
      var each = o.kind === "stack" ? [{ id: o.id, it: o }].concat(list(o.items).map(function (it, i) { return { id: o.id + "/" + i, it: obj(it) }; })) : [{ id: o.id, it: o }];
      each.forEach(function (e) {
        var key = e.id + "|" + e.it.kind;
        if (!e.it.kind || seen[key]) return;
        seen[key] = 1;
        var x = JSON.parse(JSON.stringify(obj(e.it.opts)));
        // Studio's own Turns control keeps the stack's turn at the top (o.turn), the way the TV reads it
        if (e.it.kind === "stack" && x.turn === undefined && e.it.turn !== undefined) x.turn = e.it.turn;
        out.push({ key: key, id: e.id, kind: e.it.kind, label: obj(e.it.opts).label || "", opts: x, x: +o.x || 0, y: +o.y || 0, w: +o.w || 0, h: +o.h || 0 });
      });
    });
    return out;
  }
  // every container of apps on the home a person may change (the same ones Hold OK changes)
  function appWidgets() {
    var W = window.CouchWidgets, A = window.CouchApps, out = [];
    if (!(D && ON) || !W || !W.appKinds) return out;
    var env = wenv(), have = W.installedApps(env);
    list(D.objects).forEach(function (o) {
      o = obj(o);
      if (o.type !== "widget" || W.appKinds().indexOf(o.kind) < 0) return;
      var keys = W.appKeys(o, env);
      out.push({ key: o.id + "|" + o.kind, kind: o.kind, label: obj(o.opts).label || "", max: W.appMax(o.kind), edited: !!EDITS[o.id + "|" + o.kind],
        apps: keys.map(function (k) {
          var c = A && A.get(k), hit = c ? A.resolve(k, have) : have.filter(function (a) { return a.package === k; })[0];
          return { key: k, name: c ? c.name : hit ? String(hit.name || k) : String(k).split(".").pop(), missing: !hit };
        }) });
    });
    return out;
  }
  // what a widget may know: demo data in the designer, else what this TV really has (app.js hooks)
  var DATA_V = 0, DATA_KEYS = {};
  function wenv() {
    var data = null;
    try { data = hooks.data ? hooks.data() : null; } catch (e) { data = null; }
    // sport: the design has a Scores widget (the Game Day preset), so its Up next is the game hero
    var sport = !!(D && list(D.objects).some(function (o) { o = obj(o); return o.type === "widget" && [o].concat(list(o.items)).some(function (it) { return obj(it).kind === "sports"; }); }));
    return { demo: !!(FORCE_DEMO || DEMO_ON), preview: PREVIEW, card: IN_CARD, designer: DESIGNER, data: data, look: obj(D && D.look), sport: sport,
      edits: DESIGNER || PREVIEW ? null : editsOf,
      // each widget's own settings on this TV, by its id (app.js data().wset); none in the designer or a preview
      wset: DESIGNER || PREVIEW || FORCE_DEMO || DEMO_ON ? null : (data && data.wset) || null,
      clock24: hooks.clock24 ? hooks.clock24() : false, ha: !!(window.smartHome && window.smartHome.enabled && window.smartHome.enabled()), rooms: LIVE.rooms,
      icon: function (name, size, set) { return icon(name, size, set); }, colour: colour, imgOk: imgOk,
      // a widget waiting for its town, photos or calendar shows the phone page's code (widgets.js
      // setupFace): whether this home has that page, its address with the pairing code, and a way to ask
      phone: !DESIGNER && !PREVIEW && typeof hooks.phoneLink === "function" && !!window.TVQR, phoneUrl: PLINK.url, wantPhone: askPhone };
  }
  // The phone page's address with its pairing code, kept while a widget on screen shows it as a code
  // (asked again every 60 s while one is there; the code changes every few minutes): a new one draws
  // the widgets again. Never in the designer or a preview.
  var PLINK = { url: "", at: 0, busy: false };
  var PLINK_RE = /^http:\/\/([^\/#?]+)(\/setup(?:\?tv=[A-Za-z0-9_-]+)?)#pin=(\d{6})$/;
  function askPhone() {
    if (PLINK.busy || DESIGNER || PREVIEW || typeof hooks.phoneLink !== "function" || Date.now() - PLINK.at < 5000) return;
    PLINK.busy = true; PLINK.at = Date.now();
    var done = function (u) {
      PLINK.busy = false;
      u = PLINK_RE.test(u || "") ? u : "";
      if (u !== PLINK.url) { PLINK.url = u; if (D && ON) objects(D); }
    };
    try { hooks.phoneLink().then(done, function () { done(""); }); } catch (e) { done(""); }
  }
  if (typeof setInterval === "function") setInterval(function () { if (D && ON && document.querySelector('.cw[data-face="1"]') && Date.now() - PLINK.at >= 60000) askPhone(); }, 10000);
  // the phone page at one widget, and at its step when it needs one (setup.html #widget=, &connect=)
  function phoneAt(id, need) {
    return hooks.phoneLink().then(function (u) {
      if (!PLINK_RE.test(u || "")) throw new Error("no phone page");
      if (u !== PLINK.url) { PLINK.url = u; PLINK.at = Date.now(); }
      return u + (id ? "&widget=" + encodeURIComponent(id) : "") + (need ? "&connect=" + need : "");
    });
  }

  // ---------------- smart home widgets ----------------
  // What a widget shows comes from three places, in this order:
  //  1. live, from Home Assistant through couch-tv's own smart home (smarthome.js): the aircon
  //     rooms and the scenes named in config.json;
  //  2. in the designer only, the demo readings saved in the design, marked "Demo";
  //  3. otherwise "Not connected": a TV never shows a reading it does not really have.
  var LIVE = { rooms: null, asked: 0 }, FORCE_DEMO = false;
  var DEMO_READ = {
    aircon: { status: "Cooling to 22°", value: "24°" }, light: { status: "On, 80%" }, speaker: { status: "Playing" },
    camera: { status: "Camera" }, doorbell: { status: "Last ring 2:14 pm" }, network: { status: "Online, 23 devices" },
    devices: { status: "Phones, TVs, speakers", value: "23" }, vacuum: { status: "Docked, charged" }, appliance: { status: "42 min left" }
  };
  function deg(v) { return v == null || !isFinite(v) ? "" : Math.round(v * 10) / 10 + "°"; }
  function roomStatus(r) {
    if (!r.ok && r.ok !== undefined) return "Not answering";
    if (r.state === "off") return "Off";
    var to = r.target != null ? " to " + deg(r.target) : "";
    if (r.action === "cooling") return "Cooling" + to;
    if (r.action === "heating") return "Heating" + to;
    if (r.state === "fan_only") return "Fan";
    return String(r.state || "On").charAt(0).toUpperCase() + String(r.state || "on").slice(1).replace("_", " ") + to;
  }
  function haScenes() {
    try { var i = JSON.parse(window.TVHA.info() || "{}"); return Array.isArray(i.scenes) ? i.scenes.map(function (s) { return s.name; }) : []; } catch (e) { return []; }
  }
  // demo readings: only in the designer with "Show demo readings" on (or a ?mock=1&demo=1 preview)
  var DEMO_ON = DEMO_PREVIEW;
  function smartData(o) {
    if (o.kind === "aircon" && LIVE.rooms && LIVE.rooms.length) {
      var r = LIVE.rooms.filter(function (x) { return x.entity === o.entity; })[0] || LIVE.rooms[0];
      return { live: true, name: r.name || o.name, status: roomStatus(r), value: deg(r.current), on: r.state !== "off",
        zones: LIVE.rooms.filter(function (x) { return x !== r; }).map(function (x) { return x.name + (x.current != null ? "  " + deg(x.current) : ""); }) };
    }
    if (o.kind === "scene" && window.TVHA && window.smartHome && window.smartHome.available()) {
      var names = haScenes();
      if (names.length) return { live: true, name: o.name, items: names };
    }
    // demo readings are this file's own, never the design's (a design carries no numbers or statuses)
    if (DEMO_ON || FORCE_DEMO) { var dr = DEMO_READ[o.kind] || {}; return { demo: true, name: o.name, status: dr.status, value: dr.value, on: o.on !== false, zones: o.zones, items: o.items }; }
    // not wired on this TV: the same widget, same size, with no readings in it
    return { off: true, name: o.name, status: "Not connected", value: o.kind === "aircon" || o.kind === "devices" ? "--" : "", on: false, zones: o.zones, items: o.items };
  }
  function pollRooms(objs) {
    var want = objs.some(function (o) { o = obj(o); return (o.type === "smart" && o.kind === "aircon") || (o.type === "group" && list(o.controls).some(function (c) { return obj(c).kind === "aircon"; })) ||
      (o.type === "widget" && [o].concat(list(o.items)).some(function (it) { return obj(it).kind === "aircon"; })); });
    if (!want || !window.smartHome || !window.smartHome.climate || !window.smartHome.available()) return;
    if (Date.now() - LIVE.asked < 60000) return;
    LIVE.asked = Date.now();
    window.smartHome.climate().then(function (r) {
      if (r && r.ok && Array.isArray(r.rooms)) { LIVE.rooms = r.rooms; if (D) objects(D); }
    });
  }

  function smart(o) {
    var k = ICON[o.kind] ? o.kind : "light", data = smartData(o);
    var style = ["tile", "pill", "icon", "card"].indexOf(o.style) >= 0 ? o.style : "tile";
    var name = String(data.name || o.name || "").slice(0, 60);
    var off = !!data.off, offCls = off ? " cd-off" : "";
    var status = function () { return off ? h("span", "cd-nc", null, ["Not connected"]) : String(data.status || "").slice(0, 80); };
    var on = data.on !== false, value = off && style !== "card" ? "" : String(data.value || "").slice(0, 20);   // the -- stand in is for cards only
    var icCls = "cd-ic" + (off ? " cd-ic-off" : on && (k === "light" || k === "speaker" || k === "appliance" || k === "vacuum") ? " on" : on && k === "aircon" ? " cool" : "");
    var ic = function () { return h("span", icCls + icFull(o.icon_style), null, [icon(k, null, o.icon_style)]); };
    var chipList = function (list, withIcon) { return h("div", "cd-chips" + (withIcon ? " cd-chips-fill" : ""), null, (list || []).slice(0, 8).map(function (s) { return h("span", "cd-chip", null, [withIcon ? icon("scene") : null, String(s).slice(0, 30)]); })); };
    var nameBlock = function () { return h("div", "", null, [h("div", "cd-n", null, [name]), h("div", "cd-s", { margin: "0" }, [status()])]); };
    var node;
    if (k === "scene") {
      node = h("div", cardClass(o) + offCls, null, [name ? h("div", "cd-k", null, [name + (off ? " · Not connected" : "")]) : null, chipList(data.items, true)]);
    } else if ((k === "camera" || k === "doorbell") && off) {
      // no picture on this TV: one small pill saying so, never a big dead panel
      node = h("div", cardClass(o) + " cd-pill" + offCls, null, [ic(), h("div", "", null, [h("div", "", { "font-size": "24px", "font-weight": "650" }, [name]), h("div", "cd-s", { margin: "0", "font-size": "23px" }, [status()])])]);
    } else if ((k === "camera" || k === "doorbell") && style === "card") {
      // a plain sample in the designer; on a TV with no camera wired, the same frame says so
      node = h("div", cardClass(o) + offCls, null, [
        h("div", "cd-row", { "margin-bottom": "16px" }, [ic(), nameBlock()]),
        h("div", "cd-cam " + (off ? "cd-cam-off" : "cd-cam-demo"), null, [icon("camera"), h("i", "", null, [off ? "No picture" : "Sample picture"])])
      ]);
    } else if (k === "aircon" && style === "card") {
      node = h("div", cardClass(o) + offCls, { "min-width": "420px" }, [
        h("div", "cd-row", null, [ic(), nameBlock(), h("div", "cd-v", { "margin-left": "auto", "padding-left": "24px" }, [value])]),
        (data.zones || []).length ? chipList(data.zones) : null
      ]);
    } else if (style === "icon") {
      node = h("div", "cd-only" + offCls, { "text-align": "center" }, [ic(),
        o.label !== false ? h("div", "", { "font-size": "23px", "font-weight": "600", "margin-top": "10px", "text-shadow": TEXT_SHADOW.soft }, [name]) : null,
        off ? h("div", "cd-s", { "font-size": "23px" }, [status()]) : null]);
    } else if (style === "pill") {
      node = h("div", cardClass(o) + " cd-pill" + offCls, null, [ic(), h("div", "", null, [h("div", "", { "font-size": "24px", "font-weight": "650" }, [name]), h("div", "cd-s", { margin: "0", "font-size": "23px" }, [value ? value + " · " : "", status()])])]);
    } else if (style === "card") {
      node = h("div", cardClass(o) + offCls, { "min-width": "360px" }, [h("div", "cd-row", null, [ic(), nameBlock(), value ? h("div", "cd-v", { "margin-left": "auto", "padding-left": "24px", "font-size": "44px" }, [value]) : null])]);
    } else {
      node = h("div", cardClass(o) + " cd-tile" + offCls, null, [ic(), h("div", "", null, [h("div", "cd-n", { "font-size": "24px", "white-space": "normal", "line-height": "1.15" }, [name]), h("div", "cd-s", { "font-size": "23px" }, [value ? value + " · " : "", status()])])]);
    }
    return node;
  }

  // ---------------- sections ----------------
  // A section is one panel with its controls packed on its own grid (packGroup). Controls are plain
  // tiles inside one frosted panel (one blur for the whole section, cheap on a TV). An app in a
  // section is drawn by the dock, out on the screen, so here its place stays empty (a faint slot only
  // in the designer's previews).
  var PREVIEW = false;
  var CTL_NAME = { aircon: "Aircon", light: "Lights", speaker: "Speaker", camera: "Camera", doorbell: "Doorbell", network: "Wi-Fi",
    devices: "Devices", vacuum: "Vacuum", appliance: "Dishwasher", scene: "Scene" };
  function control(ct, set) {
    var k = ICON[ct.kind] ? ct.kind : "light", size = CTL[ct.size] ? ct.size : "s";
    var data = smartData({ type: "smart", kind: k, name: ct.name, on: ct.on });
    var off = !!data.off, on = !off && data.on !== false;
    var name = String(data.name || ct.name || CTL_NAME[k] || "").slice(0, 30);
    var status = off ? h("span", "cd-nc", null, ["Not connected"]) : String(data.status || (k === "scene" ? "Scene" : on ? "On" : "Off")).slice(0, 40);
    var value = !off && data.value ? String(data.value).slice(0, 8) : "";
    var tone = k === "aircon" ? " cd-tone-cool" : k === "scene" ? " cd-tone-scene" : "";
    var ic = h("span", "cd-ctl-ic" + (on ? " on" + tone : "") + icFull(set), null, [icon(k, null, set)]);
    var cls = "cd-ctl cd-ctl-" + size + (on ? " on" : "") + (off ? " cd-off" : "");
    if (size === "s") return h("div", cls, null, [ic, h("div", "cd-ctl-n", null, [name])]);
    if (size === "w") return h("div", cls, null, [ic, h("div", "cd-ctl-tx", null, [h("div", "cd-ctl-n", null, [name]), h("div", "cd-ctl-st", null, [status])])]);
    return h("div", cls, null, [
      h("div", "cd-ctl-top", null, [ic, value ? h("div", "cd-ctl-v", null, [value]) : null]),
      h("div", "cd-ctl-tx", null, [h("div", "cd-ctl-n", null, [name]), h("div", "cd-ctl-st", null, [status])])
    ]);
  }
  function group(o) {
    var g = groupGeo(o), placed = packGroup(o.controls, g.cols, g.rows);
    var node = h("div", "cd-group " + cardClass(o).replace("cd-card", "cd-gpanel"), { width: g.w + "px", height: g.h + "px" });
    placed.forEach(function (p) {
      if (!p.fits) return;
      var ct = list(o.controls)[p.i], R = g.cell(p.c, p.r, p.w, p.h);
      var st = { left: Math.round(R.x) + "px", top: Math.round(R.y) + "px", width: Math.round(R.w) + "px", height: Math.round(R.h) + "px" };
      if (ct.app) { if (PREVIEW) node.appendChild(h("div", "cd-slot", st, [h("i")])); return; }
      var c = control(ct, o.icon_style);
      Object.keys(st).forEach(function (k) { c.style.setProperty(k, st[k]); });
      node.appendChild(c);
    });
    return node;
  }

  function weatherKey() { var w = document.querySelector("#date .wx"); return w ? w.textContent : ""; }
  function objects(d) {
    var objs = list(d.objects).slice(0, 80);
    ["back", "front"].forEach(function (side) {
      if (!layers[side]) {
        layers[side] = document.createElement("div");
        layers[side].id = "cd-" + side;
        layers[side].className = "cd-layer";
        layers[side].setAttribute("aria-hidden", "true");
        document.body.appendChild(layers[side]);
      }
      layers[side].style.transform = "scale(" + innerWidth / 1920 + ")";
      var mine = objs.filter(function (o) { return (o.layer === "back" ? "back" : "front") === side && idOk(o.id); });
      // drawn again only when something it shows has changed (the clock's minute, the weather, live rooms)
      var sig = JSON.stringify([mine, DEMO_ON, LIVE.rooms, weatherKey(), timeText({}), DATA_V, D && D.look, EDITS]);
      if (layers[side].getAttribute("data-sig") === sig) return;
      layers[side].setAttribute("data-sig", sig);
      // the design's look for its widgets: plain colours as variables on the layer
      var lk = obj(D && D.look), vars = { ink: "--ink", sub: "--sub", panel: "--panel", rim: "--rim", solid: "--solid", paper: "--paperbg", accent: "--on", focus: "--focus" };
      Object.keys(vars).forEach(function (k) { if (colour(lk[k])) layers[side].style.setProperty(vars[k], colour(lk[k])); else layers[side].style.removeProperty(vars[k]); });
      if (window.CouchWidgets) window.CouchWidgets.reset(layers[side]);
      var nodes = mine.map(function (o) {
        var m = place(o), st = { left: m.x + "px", top: m.y + "px", transform: "rotate(" + m.r + "deg) scale(" + m.s + ")" };
        if (o.type === "widget") {
          var wn = h("div", "cd-o cw-o", { left: m.x + "px", top: m.y + "px", width: num(o.w, 360, 40, 1920) + "px", height: num(o.h, 360, 40, 1080) + "px" }, [inner(o)]);
          if (o.hidden === true) wn.style.visibility = "hidden";
          wn.setAttribute("data-obj", o.id); wn.setAttribute("data-top", m.y);
          return wn;
        }
        if (o.hidden === true) st.visibility = "hidden";
        if (o.opacity !== undefined) st.opacity = num(o.opacity, 1, 0.05, 1);
        // a card that only shows when connected: not drawn on a TV with no reading for it (presets use
        // this, so a TV without Home Assistant shows no "Not connected" cards); faint in the designer
        // not connected on this TV: its stand in (the big temperature) in the same cells, else nothing
        var standIn = o.type === "smart" && o.only_live && smartData(o).off && o.instead === "bigtemp" ? { type: "weather", style: "big", w: o.w, h: o.h } : null;
        if (o.type === "smart" && o.only_live && smartData(o).off && !standIn) { if (DESIGNER) st.opacity = 0.35; else st.display = "none"; }
        var n = h("div", "cd-o cd-o-" + o.type, st, [standIn ? fitBox(inner(standIn), standIn) : fitBox(inner(o), o)]);
        n.setAttribute("data-obj", o.id); n.setAttribute("data-top", m.y);
        return n;
      });
      while (layers[side].firstChild) layers[side].removeChild(layers[side].firstChild);
      nodes.forEach(function (n) { layers[side].appendChild(n); });
    });
    // widget mode: a design with widgets is the home; the home's own parts step aside (widgets.css)
    var wm = objs.some(function (o) { o = obj(o); return o.type === "widget" && o.hidden !== true; });
    if (wm !== ROOT.classList.contains("cd-wmode")) { ROOT.classList.toggle("cd-wmode", wm); if (hooks.apps) hooks.apps(); }
    NAV.refresh();
    pollRooms(objs);
    guardDock();
    var clocks = objs.some(function (o) { return obj(o).type === "clock"; });
    if (clocks && !clockTimer) clockTimer = setInterval(function () { if (D) objects(D); }, 15000);
    if (!clocks && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  // ---------------- the dock is a no-go zone ----------------
  // Settings, More apps and the rest of the dock (the remote's path to them) are never covered: a
  // word, card or app out on the screen that lands on the dock is moved up to just above it, or, with
  // no room there, not drawn. Worked out from where the dock is really drawn, every time it changes.
  var guarding = false, ZONE = null;
  // [part, the element that moves, what it draws]
  var PART_BOX = [["people", ".people-wrap", "#people"], ["quick", "#quick", "#qbtns .qbtn"], ["date", "#date", "#date .dline"],
    ["weather", "#cd-weather", "#cd-weather > span"], ["keep_watching", "#shelf-section", "#shelf-section .shelf-head h2, #shelf-section .ncard"],
    ["clock", "#scenes .gclock", "@text"]];   // the clock: every scene's, measured on the one showing
  function guardDock() {
    if (!ON || guarding) return;
    var grid = document.getElementById("grid");
    if (!grid) return;
    guarding = true;
    var unit = innerWidth / 1920, inflow = ROOT.classList.contains("cd-wmode") ? [] : [].slice.call(grid.querySelectorAll(".app:not(.cd-free)")).map(function (n) { return n.getBoundingClientRect(); }).filter(function (b) { return b.width > 4; });
    var front = layers.front ? [].slice.call(layers.front.children) : [];
    // put everything back where the design says first
    PART_BOX.forEach(function (pb) { [].slice.call(document.querySelectorAll(pb[1])).forEach(function (node) { if (node.getAttribute("data-nogo")) { node.removeAttribute("data-nogo"); node.style.removeProperty("visibility"); } }); });
    front.forEach(function (n) { if (n.hasAttribute("data-top")) n.style.top = n.getAttribute("data-top") + "px"; if (n.getAttribute("data-nogo")) { n.style.visibility = n.getAttribute("data-was") || ""; n.removeAttribute("data-nogo"); } });
    if (inflow.length) {
      // the tiles, the air round them and their names under them (shown when chosen)
      var pad = 20 * unit, z = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
      inflow.forEach(function (b) { z.l = Math.min(z.l, b.left); z.t = Math.min(z.t, b.top); z.r = Math.max(z.r, b.right); z.b = Math.max(z.b, b.bottom); });
      z.l -= pad; z.t -= pad; z.r += pad; z.b += pad + 34 * unit;
      ZONE = { l: z.l / unit, t: z.t / unit, r: z.r / unit, b: z.b / unit };   // for the designer, in 1920 x 1080
      var hits = function (b) { return b.width > 0 && b.right > z.l && b.left < z.r && b.bottom > z.t && b.top < z.b; };
      front.forEach(function (n) {
        var b = n.getBoundingClientRect();
        if (!hits(b)) return;
        var top = (z.t - b.height) / unit;   // in 1920 x 1080 pixels, the layer's own
        if (top >= 60) {
          n.style.top = Math.round(top) + "px";
          // then from the box really drawn there (a font may have changed its height since)
          var b2 = n.getBoundingClientRect();
          if (b2.bottom > z.t) { top -= (b2.bottom - z.t) / unit; n.style.top = Math.round(top) + "px"; }
        }
        if (top < 60 || hits(n.getBoundingClientRect())) { n.setAttribute("data-was", n.style.visibility || ""); n.setAttribute("data-nogo", "1"); n.style.visibility = "hidden"; }
      });
      // the home's own parts too (people, quick buttons, the date and weather, Keep watching): one a
      // design moved or grew onto the dock is not drawn, and the remote skips it (hides())
      PART_BOX.forEach(function (pb) {
        var node = document.querySelector(pb[2] === "@text" ? "#scenes .scene.on .gclock" : pb[1]);
        // a part the design hides already is not drawn anyway: nothing to keep off
        if (!node || getComputedStyle(node).display === "none" || (D && D.elements && D.elements[pb[0]] && D.elements[pb[0]].hidden === true)) return;
        // the clock: its drawn digits (its element is as wide as the screen)
        var boxes = pb[2] === "@text" ? (function () { var r = document.createRange(); r.selectNodeContents(node); return [].slice.call(r.getClientRects()); })()
          : [].slice.call(document.querySelectorAll(pb[2])).map(function (x) { return x.getBoundingClientRect(); });
        boxes = boxes.filter(function (b) { return b.width > 2 && b.height > 2; });
        if (boxes.some(hits)) [].slice.call(document.querySelectorAll(pb[1])).forEach(function (n) { n.setAttribute("data-nogo", "1"); n.style.setProperty("visibility", "hidden", "important"); });
      });
      var gr = grid.getBoundingClientRect(), sx = grid.offsetWidth ? gr.width / grid.offsetWidth : 1;
      [].slice.call(grid.querySelectorAll(".app.cd-free")).forEach(function (el) {
        var b = el.getBoundingClientRect();
        if (!hits(b)) return;
        if (z.t - b.height < 60 * unit) { el.style.visibility = "hidden"; return; }
        el.style.top = (parseFloat(el.style.top) + ((z.t - b.height) - b.top) / sx) + "px";
      });
    }
    guarding = false;
  }

  // ---------------- the dock's tiles: style classes, and apps pulled out to anywhere ----------------
  var placing = false;
  function tiles() {
    var grid = document.getElementById("grid");
    if (!grid || !ON || placing) return;
    placing = true;
    var de = obj(obj(D.elements).dock), T = obj(obj(D.apps).tiles), expanded = ROOT.classList.contains("expanded");
    var dShape = SHAPES[de.icon_shape] !== undefined ? de.icon_shape : "rounded";
    var dStyle = STYLES.indexOf(de.icon_style) >= 0 ? de.icon_style : de.icon_tone === "mono" ? "mono" : "colour";
    var kids = [].slice.call(grid.querySelectorAll(".app[data-pkg]")), free = [], inflow = 0, glass = false;
    kids.forEach(function (el) {
      var p = el.getAttribute("data-pkg"), t = obj(T[p]);
      var shape = SHAPES[t.icon_shape] !== undefined ? t.icon_shape : dShape;
      var style = STYLES.indexOf(t.icon_style) >= 0 ? t.icon_style : dStyle;
      var want = "cd-sh-" + shape + " cd-st-" + style;
      if (el.getAttribute("data-cd") !== want) {
        el.className = el.className.replace(/\s*cd-(sh|st)-\w+/g, "") + " " + want;
        el.setAttribute("data-cd", want);
      }
      if (style === "glass" || shape === "none") glass = true;
      // names always showing: a long one goes by its first word, so it fits under its icon
      var lab = el.querySelector(".label span") || el.querySelector(".label");
      if (lab) {
        if (!lab.hasAttribute("data-full")) lab.setAttribute("data-full", lab.textContent);
        var full = lab.getAttribute("data-full"), short = de.labels === "always" && full.length > 11 ? full.split(" ")[0] : full;
        if (lab.textContent !== short) lab.textContent = short;
      }
      if (t.free === true && !expanded) { free.push([el, t]); el.classList.add("cd-free"); }
      else {
        inflow++;
        if (el.classList.contains("cd-free")) { el.classList.remove("cd-free"); el.style.position = el.style.left = el.style.top = el.style.width = el.style.height = el.style.visibility = ""; }
      }
    });
    // the dock's columns: what stays in it, as a row, a column or a grid
    if (!dockStyle) { dockStyle = document.createElement("style"); dockStyle.id = "cd-dock-style"; document.head.appendChild(dockStyle); }
    var size = num(de.icon_size, 112, 40, 240);
    var cols = dockCols(de, kids.length - free.length);
    var rule = expanded ? "" : "html.cd.theme-night #grid{grid-template-columns:repeat(" + cols + "," + rem(size) + ") !important}";
    // a row that wraps keeps its last line centred under the others (the remote still goes by place in the list)
    var gap = num(de.icon_gap, 26, 0, 120);
    if (!expanded && (!de.layout || de.layout === "row") && cols < inflow) {
      rule += "html.cd.theme-night #grid{display:flex !important;flex-wrap:wrap;justify-content:center;width:" + rem(cols * size + (cols - 1) * gap + 56) + "}" +
        "html.cd.theme-night #grid > .app:not(.cd-free){flex:none}";
    }
    ROOT.classList.toggle("cd-wrapped", !expanded && cols < inflow);
    if (dockStyle.textContent !== rule) dockStyle.textContent = rule;
    // pulled out apps: placed from the dock's box, so they land where the design says
    if (free.length) {
      var gr = grid.getBoundingClientRect(), sx = grid.offsetWidth ? gr.width / grid.offsetWidth : 1, unit = innerWidth / 1920;
      free.forEach(function (f) {
        f[0].style.visibility = "";
        var el = f[0], t = f[1], s = num(t.scale, 1, 0.2, 4);
        el.style.position = "absolute";
        var edge = 112 * s;   // its own size, not the dock's
        // inside the safe area, whatever the design says (80 at the sides, 60 at the top and bottom)
        var wx = Math.max(80, Math.min(1840 - edge, num(t.x, 80, -3840, 3840))), wy = Math.max(60, Math.min(1020 - edge, num(t.y, 60, -2160, 2160)));
        el.style.left = ((wx * unit - gr.left) / sx) + "px";
        el.style.top = ((wy * unit - gr.top) / sx) + "px";
        el.style.width = el.style.height = (edge * unit / sx) + "px";
        // then check where it really landed (the dock may have moved since it was measured) and correct
        var want = { x: wx * unit, y: wy * unit };
        var got = el.getBoundingClientRect();
        if (Math.abs(got.left - want.x) > 0.5) el.style.left = (parseFloat(el.style.left) + (want.x - got.left) / sx) + "px";
        if (Math.abs(got.top - want.y) > 0.5) el.style.top = (parseFloat(el.style.top) + (want.y - got.top) / sx) + "px";
      });
    }
    // glass and logo only icons need each app's symbol cut from its background (clearicon.js)
    if (glass && window.ClearIcon) {
      kids.forEach(function (el) {
        var cls = el.getAttribute("data-cd") || "";
        if (cls.indexOf("cd-st-glass") < 0 && cls.indexOf("cd-sh-none") < 0) return;
        var im = el.querySelector(".face:not(.tool):not(.word) > img"), face = im && im.parentNode, src = im && im.getAttribute("src");
        if (!src || face.querySelector(".glyph")) return;
        window.ClearIcon.get(src, function (g) {
          if (!g || !face.parentNode || face.querySelector(".glyph")) return;
          var gi = document.createElement("img");
          gi.className = "glyph"; gi.alt = ""; gi.src = g;
          face.appendChild(gi);
          face.classList.add("clear");
        });
      });
    }
    placing = false;
    guardDock();
  }

  // ---------------- the weather, as a part of its own ----------------
  function copyWeather() {
    if (!wxEl) return;
    var w = document.querySelector("#date .wx");
    var key = w ? w.textContent : "";
    if (wxEl.getAttribute("data-k") !== key) {
      wxEl.setAttribute("data-k", key);
      while (wxEl.firstChild) wxEl.removeChild(wxEl.firstChild);
      if (w) { var span = document.createElement("span"); [].slice.call(w.childNodes).forEach(function (c) { span.appendChild(c.cloneNode(true)); }); var lead = span.querySelector(".wx-place");
        if (lead && lead.firstChild && lead.firstChild.nodeType === 3) lead.firstChild.nodeValue = lead.firstChild.nodeValue.replace(/^\s*\u00b7\s*/, "");
        wxEl.appendChild(span); }
    }
    if (D && list(D.objects).some(function (o) { o = obj(o); return o.type === "weather" || (o.type === "smart" && o.instead === "bigtemp"); })) objects(D);
  }

  function texts(d) {
    if (!list(d.texts).length && !textBox) return;
    if (!textBox) {
      textBox = document.createElement("div");
      textBox.id = "cd-texts";
      textBox.setAttribute("aria-hidden", "true");
      document.body.appendChild(textBox);
    }
    var tl = list(d.texts).slice(0, 8);
    while (textBox.children.length > tl.length) textBox.removeChild(textBox.lastChild);
    tl.forEach(function (t, i) {
      var el = textBox.children[i];
      if (!el) { el = document.createElement("div"); el.className = "cd-text"; textBox.appendChild(el); }
      el.setAttribute("data-i", i);
      el.setAttribute("data-id", String(obj(t).id || i));
      var words = String(obj(t).text || "").slice(0, 200);
      if (el.textContent !== words) el.textContent = words;
    });
  }

  // your own photo shows only once it has loaded: a missing file leaves the normal scenes, never black
  var BG = { src: "", ok: false };
  function background(d) {
    var src = imgOk(obj(d.background).image);
    if (src !== BG.src) {
      BG = { src: src, ok: false };
      ROOT.classList.remove("cd-bg-missing");
      if (src) {
        var probe = new Image();
        probe.onload = function () { if (BG.src === src) { BG.ok = true; ROOT.classList.remove("cd-bg-missing"); ROOT.classList.add("cd-bg"); if (D) { depthLayer(D); video(D); } if (hooks.clock) hooks.clock(); tell("couchtv:applied"); } };
        probe.onerror = function () { if (BG.src === src) { BG.ok = false; ROOT.classList.remove("cd-bg"); ROOT.classList.add("cd-bg-missing"); if (hooks.clock) hooks.clock(); tell("couchtv:bg-missing"); } };
        probe.src = src;
      }
    }
    var col = !src && colour(obj(d.background).colour);
    ROOT.classList.toggle("cd-bg", (!!src && BG.ok) || !!col);
    if ((src || col) && !bgEl) {
      bgEl = document.createElement("div");
      bgEl.id = "cd-bg";
      bgEl.setAttribute("aria-hidden", "true");
      bgEl.appendChild(document.createElement("i"));
      bgEl.appendChild(document.createElement("b"));
      document.body.insertBefore(bgEl, document.body.firstChild);
    }
    // the hills in front: one picture between the widgets behind (z 0) and in front (z 3)
    depthLayer(d);
    video(d);
  }

  // ---------------- the video background (bg-video.js) ----------------
  // It plays only once its still picture has loaded, while the design is on and the home is on
  // screen: app.js holds it ("away" while an app is in front or the screen saver is up, "idle" under
  // the ambient clock, "off" with the screen off), and a hidden page holds it too.
  var VP = null, HOLD = {}, STILL_KEY = "couchtv.video.still";
  function vidRef(d) { var bg = obj(d && d.background); return imgOk(bg.image) && bg.video ? bg.video : ""; }
  function vidEnv() {
    var e = hooks.videoEnv ? obj(hooks.videoEnv()) : {}, nav = window.navigator || {}, calm = false;
    try { calm = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (x) {}
    return { designer: DESIGNER, lighter: !!e.lighter, powerSave: !!e.powerSave, saveData: !!(nav.connection && nav.connection.saveData), reducedMotion: calm,
      memory: Number(nav.deviceMemory) || 0, screenPx: ((window.screen && window.screen.width) || innerWidth) * (window.devicePixelRatio || 1),
      slow: !DESIGNER && window.CouchVideo.slowMarked(), stillChosen: !DESIGNER && store(STILL_KEY) === "1" };
  }
  // Home settings, Designs: why the video shows only its still picture, or, on a 1 GB TV, that it plays
  // the smaller copy and how to get the still picture instead ("" otherwise)
  function videoNote() {
    var vs = VP ? VP.state() : null;
    if (!vs || store(STILL_KEY) === "1") return "";   // the still picture chosen: the Designs row says so itself
    if (vs.why && (vs.state === "still" || vs.state === "failed")) return ". Video background: its still picture shows, " + vs.why;
    var mem = Number((window.navigator || {}).deviceMemory) || 0;
    if (vs.ref && mem >= 1 && mem < 2 && !DESIGNER && vs.state !== "off") return ". Video background: plays a smaller copy, as this TV has 1 GB of memory";
    return "";
  }
  function vidWanted() { return ON && BG.ok && !document.hidden && !Object.keys(HOLD).some(function (k) { return HOLD[k]; }); }
  function video(d) {
    var ref = vidRef(d);
    if (!window.CouchVideo || (!ref && !VP)) return;
    if (!VP) {
      if (!bgEl) return;
      VP = window.CouchVideo.player(bgEl, { base: function () { return window.CouchDesignCode ? window.CouchDesignCode.base() : ""; }, env: vidEnv,
        onState: function (s, why) {
          ROOT.classList.toggle("cd-vid-on", s === "playing");
          ROOT.setAttribute("data-cd-video", s);
          if (why) ROOT.setAttribute("data-cd-video-why", why); else ROOT.removeAttribute("data-cd-video-why");
          if (DESIGNER) { try { window.parent.postMessage({ type: "couchtv:video", seq: SEQ, state: s, why: why }, location.origin); } catch (e) {} }
        } });
    }
    VP.load(ref);
    VP.play(vidWanted());
  }
  if (document.addEventListener) document.addEventListener("visibilitychange", function () { if (VP) VP.play(vidWanted()); });
  // (also once the photo has loaded: before that the hills wait, so they never show over the old scene)
  function depthLayer(d) {
    var src = imgOk(obj(d.background).image), depth = !!(src && BG.ok && depthSrc(obj(d.background), src));
    if (depth && !depthEl) {
      depthEl = document.createElement("div");
      depthEl.id = "cd-depth";
      depthEl.className = "cd-depth";
      depthEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(depthEl);
    }
    if (depthEl) depthEl.hidden = !depth;
  }

  // ---------------- apply, and take back off ----------------
  function apply(design) {
    if (!design || typeof design !== "object" || Array.isArray(design)) { clear(); return; }
    D = sanitize(design);
    ON = true;
    ROOT.classList.add("cd");
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "cd-style"; document.head.appendChild(styleEl); }
    var text = css(D);
    if (styleEl.textContent !== text) styleEl.textContent = text;
    shelfTurns();
    if (!wxEl) {
      wxEl = document.createElement("div");
      wxEl.id = "cd-weather";
      wxEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(wxEl);
      var date = document.getElementById("date");
      if (date && window.MutationObserver) {
        observer = new MutationObserver(copyWeather);
        observer.observe(date, { childList: true, subtree: true, characterData: true });
      }
    }
    var grid = document.getElementById("grid");
    if (grid && !gridObserver && window.MutationObserver) {
      gridObserver = new MutationObserver(function () { tiles(); });
      gridObserver.observe(grid, { childList: true });
      // the dock changing size moves where it sits: the apps out on the screen are placed again
      if (window.ResizeObserver) new ResizeObserver(function () { if (ON) requestAnimationFrame(tiles); }).observe(grid);
    }
    copyWeather();
    background(D);
    // fonts only once the page has loaded: a slow store never holds up the home (or the TV app's "page finished")
    if (document.readyState === "complete") loadFonts(D); else if (!FONT_LATER) { FONT_LATER = true; window.addEventListener("load", function () { if (D && ON) loadFonts(D); }); }
    texts(D);
    objects(D);
    // the glass clock is lined up from where its digits are, so it is drawn again when it moves
    var ck = JSON.stringify([obj(D.elements).clock, D.background, obj(D.elements).date]);
    if (ck !== clockKey && hooks.clock) { clockKey = ck; hooks.clock(); }
    // the dock is drawn again when its apps or its shape change, so the remote follows the new shape
    var dk = obj(obj(D.elements).dock);
    var ak = JSON.stringify([obj(D.apps).order || null, obj(D.apps).hidden || null, dk.layout, dk.columns, dk.icon_size, dk.icon_gap, dk.scale, dk.max_apps, freeCount()]);
    if (ak !== appsKey && hooks.apps) { appsKey = ak; hooks.apps(); }
    tiles();
    tell("couchtv:applied");
    setupSoon();
  }
  // A design that just arrived with widgets waiting for something private (a town, photos, a calendar):
  // one card for 2 minutes, "Set up your widgets" and the code that opens the phone page at the first of
  // them (setup.html #widgets). Once per design on this TV; Back closes it. Only where the phone page exists.
  var SETUP_SEEN = "couchtv.design.setupcard", setupT = null;
  function setupSoon() {
    clearTimeout(setupT);
    if (DESIGNER || PREVIEW || typeof hooks.phoneLink !== "function" || !window.TVQR) return;
    var hk = hashOf(D);
    if (store(SETUP_SEEN) === hk) return;
    // the widgets' data (the town, photos) comes in a moment after the design: look once it has
    setupT = setTimeout(function () {
      if (!(D && ON) || hashOf(D) !== hk || !document.querySelector('.cw[data-face="1"]')) return;
      if (NAV.sheetOpen() || (window.CouchDetail && window.CouchDetail.isOpen()) || ASK) return;
      store(SETUP_SEEN, hk);
      NAV.setupCard();
    }, 4000);
  }

  function clear() {
    var was = ON;
    D = null; ON = false;
    NAV.reset(); ROOT.classList.remove("cd-wmode");
    shelfTurns();
    ROOT.classList.remove("cd", "cd-bg");
    if (depthEl) depthEl.hidden = true;
    if (VP) VP.load("");
    if (styleEl) styleEl.textContent = "";
    if (dockStyle) dockStyle.textContent = "";
    if (wxEl) wxEl.textContent = "";
    if (textBox) textBox.textContent = "";
    if (layers.back) layers.back.textContent = "";
    if (layers.front) layers.front.textContent = "";
    if (was) { clockKey = ""; appsKey = ""; if (hooks.clock) hooks.clock(); if (hooks.apps) hooks.apps(); }
    tell("couchtv:applied");
  }

  function tell(type) {
    if (!DESIGNER) return;
    // the designer's preview: which of its designs this is (it measures against the one drawn)
    try { window.parent.postMessage({ type: type, seq: SEQ }, location.origin); } catch (e) {}
  }

  window.addEventListener("resize", function () { if (ON) { objects(D); tiles(); } });
  // fonts change how tall words are: once they have loaded, keep the dock clear again
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { guardDock(); setTimeout(guardDock, 600); }); } catch (e) {}

  // ---------------- the way out: Back held for about 5 seconds ----------------
  // Whatever a design does, the person at the TV can always get the normal home back.
  // Switched off, designs stay off on this TV, whatever design arrives next (a changed one included),
  // until the person at the TV turns them back on in Home settings, Look. The designer's own preview
  // never writes this: it would switch the canvas off.
  var escaped = false, OFF_KEY = "couchtv.design.off";
  function offNow() { try { return !!localStorage.getItem(OFF_KEY); } catch (e) { return false; } }
  function setOff(on) { try { if (on) localStorage.setItem(OFF_KEY, "1"); else localStorage.removeItem(OFF_KEY); } catch (e) {} }
  // Back presses, from the keyboard (a browser, a TV whose remote sends Escape) or from the Android
  // app, which hands Back to the page as tv.back() and never as a key event (CouchDesign.back and
  // backHeld below): five presses within 4 s, or about 5 s held, switch the design off.
  var held = 0, presses = [];
  function backPress(isRepeat) {
    if (!ON) return false;
    var now = Date.now();
    if (!held) held = now;
    presses = presses.filter(function (t) { return now - t < 4000; });
    if (!isRepeat) presses.push(now);
    if (now - held >= 4800 || presses.length >= 5) { held = 0; presses = []; escapeDesign(); return true; }
    return false;
  }
  function escapeKeys() {
    var BACK = ["Escape", "Esc", "Backspace", "GoBack", "BrowserBack"];
    var isBack = function (e) { return BACK.indexOf(e.key) >= 0 || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461; };
    document.addEventListener("keydown", function (e) { if (isBack(e)) backPress(!!e.repeat); }, true);
    document.addEventListener("keyup", function (e) { if (isBack(e)) held = 0; }, true);
  }
  function escapeDesign() {
    if (!DESIGNER) setOff(true);
    escaped = true;
    clear();
    var t = document.createElement("div");
    t.className = "cd-escaped";
    t.textContent = "Design switched off. This is the normal home. Turn it back on in Home settings, Designs.";
    t.setAttribute("style", "position:fixed;left:50%;top:2rem;transform:translateX(-50%);z-index:60;padding:0.875rem 1.5rem;border-radius:2rem;background:rgba(16,16,20,0.9);color:#fff;font-size:1.4375rem;font-weight:600");
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  // ---------------- "Use this design?" ----------------
  // A design that did not come from this browser's own designer (any design in config.json, from a
  // file, a code or another person) is shown first as a preview with a question, and Keep my home has
  // the focus. Only Use this design keeps it; Keep my home and Back leave the home as it was and the
  // TV does not ask again about that design (Home settings, Look, Your design turns it on). This is
  // the backstop for what no word filter can see, such as words inside an uploaded photo.
  var PENDING = null, ASK = null;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  // The design's fingerprint: SHA-256 of the design written out with its keys in a fixed order (any
  // change at all, a different fingerprint; a forged design cannot match an accepted one). Written
  // out here because a TV page served over plain http has no crypto.subtle.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  var SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(str) {
    var bytes = unescape(encodeURIComponent(str)), n = bytes.length, words = [], i;
    for (i = 0; i < n; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
    var total = (((n + 8) >> 6) + 1) * 16;
    for (i = (n >> 2) + 1; i < total; i++) words[i] = words[i] | 0;
    words[total - 1] = n * 8;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = [];
    var rot = function (x, r) { return (x >>> r) | (x << (32 - r)); };
    for (var b = 0; b < total; b += 16) {
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h8 = H[7];
      for (var t = 0; t < 64; t++) {
        if (t < 16) w[t] = words[b + t] | 0;
        else w[t] = (rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10)) + w[t - 7] + (rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3)) + w[t - 16] | 0;
        var t1 = h8 + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[t] + w[t] | 0;
        var t2 = (rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c)) | 0;
        h8 = g; g = f; f = e; e = d + t1 | 0; d = c; c = bb; bb = a; a = t1 + t2 | 0;
      }
      H[0] = H[0] + a | 0; H[1] = H[1] + bb | 0; H[2] = H[2] + c | 0; H[3] = H[3] + d | 0;
      H[4] = H[4] + e | 0; H[5] = H[5] + f | 0; H[6] = H[6] + g | 0; H[7] = H[7] + h8 | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  var HASHED = { c: null, h: "" };
  function hashOf(d) { var c = canon(d || {}); if (c !== HASHED.c) HASHED = { c: c, h: "sha256:" + sha256(c) }; return HASHED.h; }
  // the designer's own preview, and the dev preview of this browser's own design (?design=local),
  // are not asked; ?confirm=1 asks anyway (to see and test the question)
  // A design got by code (design-code.js) is always asked about until accepted here: no preview mode
  // or address switch skips it.
  var FROM_CODE = false;
  var IN_CARD = false;
  function needsConfirm(d) {
    if (FROM_CODE) return store("couchtv.design.ok") !== hashOf(d);
    if (DESIGNER) return false;
    if (/[?&]design=local\b/.test(Q) && !/[?&]confirm=1\b/.test(Q)) return false;
    return store("couchtv.design.ok") !== hashOf(d);
  }
  // The question covers the whole screen (the home is untouched behind it). The design is shown small,
  // in a framed card: its background and what it adds, drawn by the same code a TV would use, so its
  // words and pictures can be judged before anything of it is used.
  function previewCard(d) {
    var clean = sanitize(d), W = Math.round(innerWidth * 0.4), k = W / 1920, card = document.createElement("div");
    card.setAttribute("style", "position:relative;width:" + W + "px;height:" + Math.round(1080 * k) + "px;flex:none;overflow:hidden;border-radius:18px;background:#0d0e12;box-shadow:0 0 0 3px rgba(255,255,255,0.85),0 1.5rem 3rem rgba(0,0,0,0.5)");
    var bg = obj(clean.background), src = imgOk(bg.image), col = colour(bg.colour);
    var scenes = list(obj(clean.home).scenes), back = document.createElement("div");
    back.setAttribute("style", "position:absolute;inset:0;background-size:cover;background-position:center");
    if (src) back.style.backgroundImage = cssUrl(src);
    else if (col) back.style.background = col;
    else back.style.backgroundImage = cssUrl("backgrounds/scene-" + (scenes[0] || "night") + ".jpg");
    card.appendChild(back);
    var layer = document.createElement("div");
    layer.setAttribute("style", "position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;transform:scale(" + k + ");font-family:Inter, sans-serif;color:#fff");
    // the home's own parts the design keeps (the clock, the date, Keep watching, the dock), sketched where
    // it puts them: a design that only restyles them (Couch Original) showed just its photo here, so the
    // card did not show what "Check it looks right" asks about (launch audit 0.13.9, 22 Nov 2026)
    try { homeParts(clean).forEach(function (n) { layer.appendChild(n); }); } catch (e) { /* the objects still draw */ }
    IN_CARD = true;   // the "Use this design?" card: drawn before this TV's app list is read (widgets.js appsFor)
    try {
      list(clean.objects).forEach(function (o) {
        if (o.hidden) return;
        var m = place(o), n = h("div", "cd-o cd-o-" + o.type, { left: m.x + "px", top: m.y + "px", transform: "rotate(" + m.r + "deg) scale(" + m.s + ")" }, [fitBox(inner(o), o)]);
        layer.appendChild(n);
      });
    } finally { IN_CARD = false; }
    card.appendChild(layer);
    var tag = document.createElement("div");
    tag.textContent = bg.video ? "Preview, a looping video" : "Preview";
    tag.setAttribute("style", "position:absolute;right:14px;bottom:12px;padding:4px 12px;border-radius:999px;background:rgba(0,0,0,0.6);font-size:20px;font-weight:650;color:#fff");
    card.appendChild(tag);
    return card;
  }
  // The sketch of the home's parts for the preview card, in 1920 x 1080 pixels, from the clean design:
  // each part where the design moves it, at its size, in its font and colour, left out when it hides it.
  // Shapes stand in for the apps and shows (this TV's own app list is not read before the answer).
  function homeParts(clean) {
    var E = obj(clean.elements), out = [], now = new Date();
    var hid = function (k) { return obj(E[k]).hidden === true; };
    var box = function (css, text) { var n = document.createElement("div"); n.setAttribute("style", "position:absolute;" + css); if (text) n.textContent = text; out.push(n); return n; };
    var at = function (m, origin) { return moved(m) ? "transform:translate(" + m.x + "px," + m.y + "px) scale(" + m.s + ");transform-origin:" + origin + ";" : ""; };
    var font = function (e) { var f = fontOf(obj(e).font); return f ? "font-family:" + f + ";" : ""; };
    var ink = function (e, def) { return "color:" + (colour(obj(e).colour) || def) + ";"; };
    if (!hid("clock")) {
      var ce = obj(E.clock), cm = ce.at === "scene" ? { x: 0, y: 0, s: 1, r: 0 } : place(ce), hh = now.getHours();
      var time = (ce.format === "24h" ? ("0" + hh).slice(-2) : String(hh % 12 || 12)) + ":" + ("0" + now.getMinutes()).slice(-2);
      var cw = parseInt(ce.weight, 10);
      box("left:0;right:0;top:" + (184 + cm.y) + "px;text-align:center;white-space:nowrap;font-size:" + Math.round(400 * cm.s) + "px;line-height:0.86;letter-spacing:-0.045em;" +
        "font-weight:" + (cw >= 100 && cw <= 900 ? cw : 200) + ";" + font(ce) + ink(ce, "rgba(255,255,255,0.9)") + "text-shadow:0 0.5rem 2.5rem rgba(0,0,0,0.3);transform:translateX(" + cm.x + "px)", time);
    }
    if (!hid("date")) {
      // in the TV's language and the design's date format, as the home writes it (app.js clock)
      var de = obj(E.date), loc = window.I18N && window.I18N.locale ? window.I18N.locale() : "en-AU";
      var day = now.toLocaleDateString(loc, DATE_FORMATS[de.format] || { weekday: "long", day: "numeric", month: "long" }).replace(/,/g, "");
      day = day.charAt(0).toUpperCase() + day.slice(1);
      box("left:0;right:0;top:96px;text-align:center;white-space:nowrap;font-size:36px;font-weight:600;" + font(de) + ink(de, "#fff") + at(place(de), "50% 0") + "text-shadow:0 0.125rem 1rem rgba(0,0,0,0.35)", day);
    }
    if (!hid("keep_watching")) {
      var kw = place(E.keep_watching), shelf = box("left:80px;top:650px;width:1760px;height:200px;" + at(kw, "0 0"));
      for (var i = 0; i < 3; i++) {
        var c = document.createElement("div");
        c.setAttribute("style", "position:absolute;top:44px;left:" + (i * 544) + "px;width:520px;height:146px;border-radius:24px;background:rgba(18,19,24,0.62);box-shadow:inset 0 0 0 2px rgba(255,255,255,0.1)");
        shelf.appendChild(c);
      }
    }
    if (!hid("dock")) {
      var dk = obj(E.dock), dm = place(dk), size = num(dk.icon_size, 112, 40, 240), gap = num(dk.icon_gap, 26, 0, 120);
      var n = Math.min(12, Math.max(4, Math.floor((1728 - 40 + gap) / (size + gap)))), w = n * size + (n - 1) * gap + 40;
      var radius = SHAPES[dk.icon_shape] !== undefined ? SHAPES[dk.icon_shape] : "22.5%";
      var bar = box("left:" + Math.round((1920 - w) / 2) + "px;top:" + (1080 - 48 - size - 40) + "px;width:" + w + "px;height:" + (size + 40) + "px;border-radius:" + Math.round((size + 40) * 0.32) + "px;" +
        "background:rgba(255,255,255,0.1);box-shadow:inset 0 0 0 2px rgba(255,255,255,0.14);" + at({ x: dm.x, y: dm.y, s: dm.s, r: 0 }, "50% 100%"));
      for (var j = 0; j < n; j++) {
        var t = document.createElement("div");
        t.setAttribute("style", "position:absolute;top:20px;left:" + (20 + j * (size + gap)) + "px;width:" + size + "px;height:" + size + "px;border-radius:" + (radius === "0" ? "8%" : radius) + ";background:rgba(255,255,255," + (j >= n - 2 ? "0.22" : "0.78") + ")");
        bar.appendChild(t);
      }
    }
    return out;
  }
  function askFirst(d) {
    // the objects' own styles, for the preview card
    if (!document.getElementById("cd-ask-style")) { var s = document.createElement("style"); s.id = "cd-ask-style"; s.textContent = OBJ_CSS; document.head.appendChild(s); }
    var box = document.createElement("div"), pick = 0;
    box.className = "cd-ask";
    box.setAttribute("role", "dialog");
    box.setAttribute("style", "position:fixed;inset:0;z-index:80;display:flex;align-items:center;gap:4.5rem;padding:5rem 7rem;background:rgba(8,9,12,0.96);color:#fff;font-family:Inter, sans-serif");
    var col = document.createElement("div"); col.setAttribute("style", "flex:1;min-width:0");
    var h1 = document.createElement("div"); h1.textContent = "A new home design arrived. Use this design?";
    h1.setAttribute("style", "font-size:3.25rem;line-height:4rem;font-weight:700;letter-spacing:-0.01em");
    var p = document.createElement("div"); p.textContent = "This design came from Couch TV Studio. Keep my home leaves your TV exactly as it is.";
    p.setAttribute("style", "margin-top:1.25rem;font-size:1.75rem;line-height:2.375rem;color:rgba(255,255,255,0.82);max-width:44rem");
    var row = document.createElement("div"); row.setAttribute("style", "margin-top:2.5rem;display:flex;flex-direction:column;align-items:flex-start;gap:1.25rem");
    var mk = function (label, big) { var b = document.createElement("div"); b.textContent = label; b.setAttribute("style", "padding:" + (big ? "1.375rem 3rem" : "1rem 2.25rem") + ";border-radius:3rem;font-size:" + (big ? "2rem" : "1.625rem") + ";font-weight:700;background:rgba(255,255,255,0.12)"); row.appendChild(b); return b; };
    // apps changed on this TV (Hold OK): keep them with the new design, or take the design's own
    var hasEdits = Object.keys(EDITS).length > 0;
    var keepB = mk("Keep my home", true), useB = mk(hasEdits ? "Use this design, keep my app changes" : "Use this design", false), ownB = hasEdits ? mk("Use this design with its own apps", false) : null;
    var btns = [keepB, useB].concat(ownB ? [ownB] : []);
    var paint = function () { btns.forEach(function (b, i) { b.style.background = i === pick ? "#fff" : "rgba(255,255,255,0.12)"; b.style.color = i === pick ? "#111" : "rgba(255,255,255,0.85)"; b.style.boxShadow = i === pick ? "0 0 0 4px rgba(255,255,255,0.35)" : "none"; }); };
    var hint = document.createElement("div"); hint.textContent = "Back keeps your home too.";
    hint.setAttribute("style", "margin-top:1.5rem;font-size:1.4375rem;color:rgba(255,255,255,0.6)");
    col.appendChild(h1); col.appendChild(p); col.appendChild(row); col.appendChild(hint);
    box.appendChild(col);
    try { box.appendChild(previewCard(d)); } catch (e) { /* no preview: the question still stands */ }
    document.body.appendChild(box);
    paint();
    var done = function (use) {
      window.removeEventListener("keydown", onKey, true);
      box.remove(); ASK = null;
      if (use) {
        store("couchtv.design.ok", hashOf(d)); store("couchtv.design.no", null);
        // the person is at the remote: the home that starts next shows where the focus is at once, so the
        // next press moves from a tile they can see (focusAfterAnswer)
        try { sessionStorage.setItem(KEYS_SHOWN, "1"); } catch (e) {}
        // its look settings are read when the home starts: start again with it
        setTimeout(function () { try { location.reload(); } catch (e) { apply(d); } }, 50);
      } else { store("couchtv.design.no", hashOf(d)); escaped = true; }
    };
    var onKey = function (e) {
      var key = e.key;
      e.preventDefault(); e.stopImmediatePropagation();
      if (key === "ArrowUp" || key === "ArrowLeft") { pick = Math.max(0, pick - 1); paint(); }
      else if (key === "ArrowDown" || key === "ArrowRight") { pick = Math.min(btns.length - 1, pick + 1); paint(); }
      else if (key === "Enter" || key === " " || e.keyCode === 23) { if (pick === 2) { EDITS = {}; saveEdits(); } done(pick >= 1); }
      else if (key === "Escape" || key === "Backspace" || key === "GoBack" || key === "BrowserBack" || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461) done(false);
    };
    window.addEventListener("keydown", onKey, true);
    ASK = { box: box, done: done };
  }

  // ---------------- the focus on a design ----------------
  // A design opens calm, with no focus drawn until a key is pressed (css(): html.cd:not(.cd-keys)). The
  // first arrow press only shows where the focus is: it used to move it too, from a tile nobody could
  // see, and Down from the dock opened More apps by surprise (launch audit 0.13.9, 22 Nov 2026). OK, Back
  // and the rest act at once, as before. After Use this design the home that starts again shows the
  // focus straight away: the person is holding the remote.
  var KEYS_SHOWN = "couchtv.design.keys";
  var ARROW = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Up: 1, Down: 1, Left: 1, Right: 1 };
  function isArrow(e) { return !!ARROW[e.key] || (e.keyCode >= 37 && e.keyCode <= 40) || (e.keyCode >= 19 && e.keyCode <= 22); }
  function focusAfterAnswer() {
    var said = null;
    try { said = sessionStorage.getItem(KEYS_SHOWN); sessionStorage.removeItem(KEYS_SHOWN); } catch (e) {}
    if (said && ON && !DESIGNER) ROOT.classList.add("cd-keys");
  }
  function firstKey(e) {
    if (!ON || ROOT.classList.contains("cd-keys")) return;
    ROOT.classList.add("cd-keys");
    // only on the home itself: Home settings, a question or a sheet draw their own focus
    // (nor a home asleep behind its idle photo, the ambient clock or Screen off: that press wakes it)
    if (DESIGNER || ASK || !isArrow(e) || /\b(setting|idle-photo)\b/.test(document.documentElement.className) ||
      document.querySelector(".share-home, .cw-sheet, #screen-off-overlay.active, #idle-ambient-overlay.active")) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }

  // ---------------- what app.js asks ----------------
  // ---------------- the remote in widget mode (widgets/GRID.md, "Focus and the remote") ----------------
  // Focus lives on widgets. A widget with inner items (a folder's apps, a dock, scene buttons) is
  // stepped through first and left when it runs out in that direction. Moving picks the next widget
  // by geometry, the same way every time: boxes wholly beyond the edge; those sharing some of the
  // focused box across the movement first, nearest edge, then most overlap, then top or left; else
  // the nearest by edge distance plus twice the sideways gap. Going back the opposite way returns to
  // where you came from. Nothing wraps round the screen.
  // the Settings button on a design (html.cd-wmode only, widgets.css .cw-gearchip): top right, small,
  // never in Couch TV Studio or a preview. OK on it opens Home settings, like the gear tile on the classic home.
  var GEAR = null, GEAR_ID = "__gear", TIP_USED = "couchtv.wtip.used";
  function gearChip() {
    if (DESIGNER || PREVIEW || !document.body) return null;
    if (!GEAR) {
      GEAR = h("div", "cw-gearchip", null, [icon("gear", 40), h("span", "cw-gearchip-t", null, ["Settings"])]);
      GEAR.setAttribute("data-act", "gear"); GEAR.setAttribute("data-name", "Settings"); GEAR.setAttribute("role", "button");
    }
    if (GEAR.parentNode !== document.body) document.body.appendChild(GEAR);
    placeGear(GEAR);
    return GEAR;
  }
  // Where the Settings button goes: a spot clear of every widget, wide enough for it with the word
  // Settings (it grows when focused), so it never covers a clock or a card (a TCL beginner test, 19 Nov
  // 2026: it hid the clock on Guest Welcome and the Holidays card on Packed Bento). The corners first,
  // then along the edges of the screen. A design with no clear spot anywhere: the button hides until
  // the remote reaches it (Up or Right at the edge of the screen), so it covers nothing while you watch.
  var GEAR_SIG = "", GEAR_W = 220, GEAR_H = 64;
  function gearBoxes() {
    var out = [];
    [layers.front, layers.back].forEach(function (L) {
      if (!L) return;
      [].forEach.call(L.children, function (n) {
        if (!n.classList || !n.classList.contains("cd-o")) return;
        var cs = getComputedStyle(n);
        if (cs.visibility === "hidden" || cs.display === "none") return;
        var b = (n.querySelector(".cw") || n).getBoundingClientRect();
        // a picture across the whole screen is a background, not something the button could cover
        if (b.width < 4 || b.height < 4 || (b.width * b.height > innerWidth * innerHeight * 0.85)) return;
        out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom });
      });
    });
    return out;
  }
  // pure: the first clear spot for a w x h button among the candidates, or null. boxes and the answer in
  // screen px; a spot is { x, y, right } (right: anchored on its right side, so it grows to the left)
  function gearSpot(boxes, W, H, w, h) {
    var pad = 10, cands = [], m, x, y;
    [28, 8].forEach(function (mg) {
      cands.push({ x: W - mg - w, y: mg, right: true }, { x: mg, y: mg, right: false }, { x: W - mg - w, y: H - mg - h, right: true }, { x: mg, y: H - mg - h, right: false });
    });
    for (x = W - 8 - w; x >= 8; x -= 32) { cands.push({ x: x, y: 8, right: x + w / 2 > W / 2 }); cands.push({ x: x, y: H - 8 - h, right: x + w / 2 > W / 2 }); }
    for (y = 8; y <= H - 8 - h; y += 32) { cands.push({ x: W - 8 - w, y: y, right: true }); cands.push({ x: 8, y: y, right: false }); }
    for (m = 0; m < cands.length; m++) {
      var c = cands[m], hit = boxes.some(function (b) { return c.x < b.r + pad && c.x + w > b.l - pad && c.y < b.b + pad && c.y + h > b.t - pad; });
      if (!hit) return c;
    }
    return null;
  }
  function placeGear(g) {
    if (g.classList.contains("cw-focus")) return;   // never moves under the remote
    var sig = innerWidth + "x" + innerHeight + "|" + (layers.front ? layers.front.getAttribute("data-sig") : "") + "|" + (layers.back ? layers.back.getAttribute("data-sig") : "");
    if (sig === GEAR_SIG || !ROOT.classList.contains("cd-wmode")) return;
    GEAR_SIG = sig;
    var spot = gearSpot(gearBoxes(), innerWidth, innerHeight, GEAR_W, GEAR_H);
    g.classList.toggle("cw-gear-tuck", !spot);
    g.classList.toggle("cw-gear-left", !!spot && !spot.right);
    if (!spot) { g.style.top = "28px"; g.style.right = "28px"; g.style.left = "auto"; return; }
    g.style.top = spot.y + "px";
    if (spot.right) { g.style.right = (innerWidth - spot.x - GEAR_W) + "px"; g.style.left = "auto"; }
    else { g.style.left = spot.x + "px"; g.style.right = "auto"; }
  }
  var NAV = (function () {
    var cur = null, last = null, sheet = null, okDown = false, okHeld = false, okT = null, okSoon = null, okStart = 0, okLast = 0, okSwallow = false, tipShown = false, tracing = false;
    function rectOf(el) { var r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
    // a setting the TV or the phone offers now (pre: true), as Home settings lists them
    function tvSetting(s) { return s && s.pre === true && (!Array.isArray(s.where) || s.where.indexOf("tv") >= 0 || s.where.indexOf("phone") >= 0); }
    function hasTvSettings(kind) { var Caps = window.CouchWidgetCaps; return !!(kind && Caps && Caps.settings && Caps.settings(kind).some(tvSetting)); }
    function stops() {
      var out = [], look = [];
      [layers.front, layers.back].forEach(function (L) {
        if (!L) return;
        [].forEach.call(L.querySelectorAll(".cw-o"), function (wrap) {
          if (wrap.style.visibility === "hidden" || wrap.style.display === "none") return;
          var root = wrap.querySelector(".cw");
          if (!root) return;
          var inner = root.hasAttribute("data-stack") ? [] : [].slice.call(root.querySelectorAll("[data-act]")).filter(function (n) { return n !== root && n.offsetWidth > 0 && getComputedStyle(n).visibility !== "hidden"; });
          var s = { id: wrap.getAttribute("data-obj"), wrap: wrap, el: root, box: rectOf(root), inner: inner, grid: !!root.querySelector("[data-cols]") };
          if (!inner.length && !root.hasAttribute("data-act")) {
            // a widget only to look at, with settings of its own (a Countdown, the Welcome words): a stop on
            // the TV too, and OK on it opens the Hold OK menu with Edit on the TV (0.13.9, the owner:
            // "Holding OK on any widget allows you to edit it")
            if (!DESIGNER && hasTvSettings(root.getAttribute("data-kind"))) { root.setAttribute("data-act", "menu"); root.setAttribute("data-name", "Home menu"); out.push(s); return; }
            look.push(s); return;
          }
          out.push(s);
        });
      });
      // a home of things only to look at (a bedside clock): every widget is a stop, and OK on one
      // opens the Hold OK menu, so the remote always shows where it is and always reaches the apps
      if (!out.length) look.forEach(function (s) { if (!s.el.hasAttribute("data-act")) { s.el.setAttribute("data-act", "menu"); s.el.setAttribute("data-name", "Home menu"); } out.push(s); });
      // the Settings button in the top corner: on every design, always there and always reachable
      var g = gearChip();
      if (g && g.offsetWidth > 0) out.push({ id: GEAR_ID, wrap: g, el: g, box: rectOf(g), inner: [] });
      return out;
    }
    function beyond(from, b, dx, dy) {
      if (dx > 0) return b.l >= from.r - 2; if (dx < 0) return b.r <= from.l + 2;
      if (dy > 0) return b.t >= from.b - 2; return b.b <= from.t + 2;
    }
    function overlap(from, b, dx) { return dx ? Math.min(from.b, b.b) - Math.max(from.t, b.t) : Math.min(from.r, b.r) - Math.max(from.l, b.l); }
    function edge(from, b, dx, dy) { return dx > 0 ? b.l - from.r : dx < 0 ? from.l - b.r : dy > 0 ? b.t - from.b : from.t - b.b; }
    function side(from, b, dx) { var o = overlap(from, b, dx); return o > 0 ? 0 : -o; }
    // the geometric pick, shared by widgets and the items inside one
    function pick(from, cands, dx, dy) {
      var c = cands.filter(function (x) { return beyond(from, x.box, dx, dy); });
      if (!c.length) return null;
      var lined = c.filter(function (x) { return overlap(from, x.box, dx) > 1; });
      if (lined.length) {
        lined.sort(function (a, b) {
          var d = edge(from, a.box, dx, dy) - edge(from, b.box, dx, dy);
          if (Math.abs(d) > 2) return d;
          var o = overlap(from, b.box, dx) - overlap(from, a.box, dx);
          if (Math.abs(o) > 2) return o;
          return dx ? a.box.t - b.box.t : a.box.l - b.box.l;
        });
        return lined[0];
      }
      c.sort(function (a, b) { return (edge(from, a.box, dx, dy) + 2 * side(from, a.box, dx)) - (edge(from, b.box, dx, dy) + 2 * side(from, b.box, dx)); });
      return c[0];
    }
    function find(S, id) { return S.filter(function (s) { return s.id === id; })[0] || null; }
    function startStop(S) {
      if (!S.length) return null;
      var marked = list(D && D.objects).filter(function (o) { return obj(o).start === true; })[0];
      var m = (marked && find(S, marked.id)) || S.filter(function (x) { return x.start; })[0];
      if (m) return { id: m.id, i: m.inner.length ? 0 : -1 };
      for (var k = 0; k < S.length; k++) {
        if (S[k].act === "app" || (S[k].el && S[k].el.getAttribute && S[k].el.getAttribute("data-act") === "app")) return { id: S[k].id, i: -1 };
        for (var j = 0; j < S[k].inner.length; j++) if ((S[k].innerAct || [])[j] === "app" || (S[k].inner[j].getAttribute && S[k].inner[j].getAttribute("data-act") === "app")) return { id: S[k].id, i: j };
      }
      var notGear = S.filter(function (x) { return x.id !== GEAR_ID; });
      var tl = (notGear.length ? notGear : S).slice().sort(function (a, b) { return (a.box.t - b.box.t) || (a.box.l - b.box.l); })[0];
      return { id: tl.id, i: tl.inner.length ? 0 : -1 };
    }
    function shown() { return ON && ROOT.classList.contains("cd-wmode") && !(DESIGNER && ROOT.classList.contains("cd-edit")); }
    function paint() {
      [].forEach.call(document.querySelectorAll(".cw-focus, .cw-ifocus, .cw-hasfocus"), function (n) { n.classList.remove("cw-focus", "cw-ifocus", "cw-hasfocus"); if (n.classList.contains("cw")) n.style.removeProperty("transform"); });
      // a sheet open: its own focus stays (a redraw behind it, new data or a save, cleared it)
      if (sheet) { paintSheet(); return; }
      if (!cur || !shown()) return;
      var S = stops(), s = find(S, cur.id);
      if (!s) { cur = null; return; }
      s.wrap.classList.add("cw-hasfocus");
      if (cur.i >= 0 && s.inner[cur.i]) s.inner[cur.i].classList.add("cw-ifocus");
      else { s.el.classList.add("cw-focus"); s.el.style.transform = "scale(" + Math.min(1.06, 1 + 40 / Math.max(160, s.box.w)) + ")"; }
    }
    // one press, worked out from boxes only: S = [{ id, box, inner: [box] }], cur = { id, i }, last = the
    // press before ({ dir, from, to }). Returns { cur, last, moved }. Pure, so it is tested without a page.
    function step(S, cur, last, dx, dy) {
      var s = cur && find(S, cur.id);
      if (!s) return { cur: startStop(S), last: null, moved: true };
      var dir = dx + "," + dy, from = { id: cur.id, i: cur.i };
      // back the way you came: to where you were
      if (last && last.dir === (-dx) + "," + (-dy) && last.to.id === cur.id && last.to.i === cur.i && find(S, last.from.id)) return { cur: { id: last.from.id, i: last.from.i }, last: null, moved: true };
      // inside the widget first
      if (s.inner.length && cur.i >= 0 && s.inner[cur.i]) {
        var ib = s.inner[cur.i];
        var ic = s.inner.map(function (bx, k) { return { k: k, box: bx }; }).filter(function (x) { return x.k !== cur.i; });
        // in rows of apps, Left and Right stay in the row (never a slant to the row above)
        var p = pick(ib, s.grid && dx ? ic.filter(function (x) { return overlap(ib, x.box, dx) > 1; }) : ic, dx, dy);
        // apps in rows (a folder, an app grid): Right at the end of a row goes on to the first app of the
        // next row, and Left at the start of one back to the last app of the row above, so every app is
        // a stop on the way across (0.13.10: Right from the third app skipped the fourth, one row down)
        if (!p && dx && s.grid && s.inner[cur.i + dx]) p = { k: cur.i + dx };
        if (p) { var c1 = { id: s.id, i: p.k }; return { cur: c1, last: { dir: dir, from: from, to: c1 }, moved: true }; }
      }
      var t = pick(s.box, S.filter(function (x) { return x !== s; }), dx, dy);
      if (!t) return { cur: cur, last: last, moved: false };   // the edge of the screen: nothing happens, nothing wraps
      var i = -1;
      if (t.inner.length) {
        var at = cur.i >= 0 && s.inner[cur.i] ? s.inner[cur.i] : s.box, cands = t.inner.map(function (bx, k) { return { k: k, box: bx }; });
        var q = pick(at, cands, dx, dy);
        if (!q) { var cx = (at.l + at.r) / 2, cy = (at.t + at.b) / 2; cands.sort(function (a, b) { return Math.abs((a.box.l + a.box.r) / 2 - cx) + Math.abs((a.box.t + a.box.b) / 2 - cy) - Math.abs((b.box.l + b.box.r) / 2 - cx) - Math.abs((b.box.t + b.box.b) / 2 - cy); }); q = cands[0]; }
        i = q.k;
      }
      var c2 = { id: t.id, i: i };
      return { cur: c2, last: { dir: dir, from: from, to: c2 }, moved: true };
    }
    function boxesOf(S) { return S.map(function (x) { return { id: x.id, box: x.box, inner: x.inner.map(rectOf), el: x.el, grid: x.grid }; }); }
    function move(dx, dy) {
      var S = stops();
      if (!S.length) return false;
      var s = cur && find(S, cur.id);
      // a stack: left and right flick through it
      if (s && dx && !tracing && s.el.hasAttribute("data-stack") && window.CouchWidgets && window.CouchWidgets.flick(s.el, dx)) { last = null; return true; }
      // the Settings button sits over the top right corner, so plain geometry may never reach it: Up or
      // Right at the edge of the screen goes to it, and any arrow from it goes back to the nearest widget
      var gs = find(S, GEAR_ID), rest = S.filter(function (x) { return x.id !== GEAR_ID; });
      // Since 0.13.6 the gear goes wherever it covers nothing (a corner or an edge, left or right), so
      // "towards the edge" is towards the side it is on, not always up and right. On Guest Welcome it
      // sat on the left and only Up from the clock on the right reached it (a TCL, 20 Nov 2026).
      var vw = window.innerWidth || 1920, vh = window.innerHeight || 1080;
      var gx = gs ? (gs.box.l + gs.box.r) / 2 : 0, gy = gs ? (gs.box.t + gs.box.b) / 2 : 0;
      // tucked (hidden until reached, opacity 0, still a 64x64 box): never a stop for arrow geometry
      var shown = gs && !gs.el.classList.contains("cw-gear-tuck");
      function towardGear() { return (dy < 0 && gy < vh / 2) || (dy > 0 && gy >= vh / 2) || (dx > 0 && gx >= vw / 2) || (dx < 0 && gx < vw / 2); }
      if (gs && cur && cur.id === GEAR_ID) {
        // toward the gear's own edge does nothing, unless it is the way back to where the remote came from
        if (!rest.length || (towardGear() && !(last && last.to.id === GEAR_ID && last.dir === (-dx) + "," + (-dy)))) return false;
        var fromGear = shown ? step(boxesOf(S), cur, last, dx, dy) : { moved: false };
        if (fromGear.moved && fromGear.cur.id !== GEAR_ID) { cur = fromGear.cur; last = fromGear.last; paint(); return true; }
        var near = rest.slice().sort(function (a, b) { return Math.hypot((a.box.l + a.box.r) / 2 - gx, (a.box.t + a.box.b) / 2 - gy) - Math.hypot((b.box.l + b.box.r) / 2 - gx, (b.box.t + b.box.b) / 2 - gy); })[0];
        cur = { id: near.id, i: near.inner.length ? 0 : -1 }; last = null; paint(); return true;
      }
      // a gear on screen is a stop like any other, so the arrow pointing at it reaches it
      var r = step(boxesOf(shown && rest.length ? S : rest.length ? rest : S), cur, last, dx, dy);
      if (gs && !r.moved && cur && towardGear() && !tracing) { last = null; cur = { id: GEAR_ID, i: -1 }; paint(); return true; }
      cur = r.cur; last = r.last;
      paint();
      return true;
    }
    function target() {
      var s = cur && find(stops(), cur.id);
      if (!s) return null;
      return cur.i >= 0 && s.inner[cur.i] ? s.inner[cur.i] : s.el;
    }
    function act(el) {
      if (!el) return;
      var what = el.getAttribute("data-act"), arg = el.getAttribute("data-arg") || "";
      if (what === "stack") {
        // a stack: OK opens what the widget showing would open
        var showing = el.querySelector(".cw-slot.on > .cw"), inner = showing && (showing.hasAttribute("data-act") ? showing : showing.querySelector("[data-act]"));
        if (inner) act(inner);
        return;
      }
      el.classList.remove("cd-flash"); void el.offsetWidth; el.classList.add("cd-flash");
      if (what === "detail" || what === "folder") { openDetail(el); return; }
      if (what === "menu") { holdMenu(); return; }
      if (what === "wphone" && !DESIGNER) { phoneSheet(arg); return; }
      if (what === "wtv" && !DESIGNER) { tvEdit(arg); return; }
      if (what === "gear") tipUsed();
      if (what === "edit" || what === "pick") { edit(what === "pick" ? "pick" : arg, arg); return; }
      if (what === "addapp" && !DESIGNER) { EDIT = appCtx(); if (EDIT) { if (EDIT.max > 1) appSheet(EDIT); else picker("add"); } return; }
      if (what === "missing" && !DESIGNER) { say("Not on this TV. Install it from the App Store in More apps, or hold OK to change it."); return; }
      if (DESIGNER) { try { window.parent.postMessage({ type: "couchtv:open", name: el.getAttribute("data-name") || "" }, location.origin); } catch (x) {} return; }
      if (hooks.act) hooks.act(what, arg);
    }
    // the detail layer (widget-detail.js): the widget grows into a sheet; the remote stays in it until Back.
    // What it does goes through the same hooks as the widgets' own buttons; in Couch TV Studio nothing is switched.
    function detailApi() {
      return { designer: DESIGNER,
        act: function (what, arg) { if (DESIGNER) { try { window.parent.postMessage({ type: "couchtv:open", name: String(arg || what) }, location.origin); } catch (x) {} return; } if (hooks.act) hooks.act(what, arg); },
        ha: hooks.ha && !DESIGNER ? function (a, e, v) { return hooks.ha(a, e, v); } : null,
        // Hold OK on an app inside a folder's full screen layer: the same menu as on the widget, for that app
        hold: DESIGNER ? null : function (slot) { FORCE_SLOT = slot; holdMenu(); FORCE_SLOT = null; },
        // a widget's setup layer: the phone page's code at its step, and "No phone? Set it up here"
        phone: !DESIGNER && typeof hooks.phoneLink === "function" && window.TVQR ? phoneAt : null,
        tvEdit: DESIGNER ? null : function (id) { if (window.CouchDetail) window.CouchDetail.close(true); tvEdit(id); } };
    }
    // the TV's own page for a widget (Home settings, the widget's page), else Home settings itself
    function tvEdit(id) {
      var Caps = window.CouchWidgetCaps, mine = widgetList().filter(function (x) { return x.id === id; })[0];
      var has = mine && Caps && Caps.settings && Caps.settings(mine.kind).some(function (s) { return s && s.pre === true && (!Array.isArray(s.where) || s.where.indexOf("tv") >= 0); });
      if (hooks.act) hooks.act(has ? "wset" : "gear", has ? mine.key : "");
    }
    function openDetail(el) {
      var root = el;
      while (root && !(root.classList && root.classList.contains("cw"))) root = root.parentNode;
      if (!root || !window.CouchDetail) return;
      paint();
      // a place inside the widget that names its own layer (the Dock's "+3": the folder layer with every
      // app): the layer is read from the widget's data-arg, so it carries that name while it opens
      var arg = el !== root && el.getAttribute("data-arg"), had = root.getAttribute("data-arg");
      if (arg) root.setAttribute("data-arg", arg);
      try { window.CouchDetail.open(root, wenv(), detailApi()); }
      finally { if (arg) { if (had === null) root.removeAttribute("data-arg"); else root.setAttribute("data-arg", had); } }
    }
    // a sheet over the home: a folder opened full screen, or the hold OK menu. The remote stays in it.
    function openSheet(title, items, hint) {
      closeSheet();
      // a menu (cw-msheet): a solid backdrop and rows that fit 1080 with the title and the hint (launch audit, 24 Nov
      // 2026: on a Studio design the big clock showed through the rows, and the title and hint were cut off)
      var el = h("div", "cw-sheet" + (items.menu ? " cw-msheet" : ""), { transform: "scale(" + innerWidth / 1920 + ")" }, [h("h2", "", null, [title])]);
      // a line to read, never a stop for the remote (a widget with nothing to set on the TV)
      if (items.note) el.appendChild(h("div", "cw-hint cw-note", { margin: "-24px 0 40px" }, [items.note]));
      var row = h("div", items.menu ? "cw-menu" : "cw-sheet-apps", null, items.nodes);
      el.appendChild(row);
      if (hint) el.appendChild(h("div", "cw-hint", null, [hint]));
      document.body.appendChild(el);
      sheet = { el: el, nodes: items.nodes, i: 0 };
      paintSheet();
    }
    function paintSheet() {
      if (!sheet) return;
      sheet.nodes.forEach(function (n, k) { n.classList.toggle("cw-ifocus", k === sheet.i); });
      // a long app list (Add app, Change app): the list scrolls so the app the remote is on stays in view
      // (a TCL, 20 Nov 2026: the list ran off the screen and the remote seemed to do nothing)
      var box = sheet.el.querySelector(".cw-sheet-apps"), n = sheet.nodes[sheet.i];
      if (box && n && box.scrollHeight > box.clientHeight) {
        var top = n.offsetTop, bot = top + n.offsetHeight + 40;   // the list is positioned, so offsetTop is inside it
        if (top - 24 < box.scrollTop) box.scrollTop = Math.max(0, top - 24);
        else if (bot > box.scrollTop + box.clientHeight) box.scrollTop = bot - box.clientHeight;
      }
    }
    function closeSheet() { if (sheet && sheet.el.parentNode) sheet.el.parentNode.removeChild(sheet.el); sheet = null; paint(); }
    function holdMenu() {
      tipUsed();
      var mk = function (label, what, arg) { var n = h("div", "cw-mi", null, [label]); n.setAttribute("data-act", what); n.setAttribute("data-name", label); if (arg) n.setAttribute("data-arg", arg); return n; };
      var t = target(), w = t;
      while (w && !(w.classList && w.classList.contains("cw"))) w = w.parentNode;
      // Settings first: the tip says "Hold OK for apps and settings", so OK straight after holding (or a TV
      // that sends one more OK) lands on settings, never on a widget's own page (a clock's Timers)
      var nodes = [mk("Settings", "gear"), mk("All apps", "more"), mk("Smart home", "smart")];
      var layer = w && w.getAttribute("data-detail");
      // an app folder's own layer is every app again: "All apps" is already here, so no "Open Apps" beside it
      if (layer && layer !== "folder" && window.CouchDetail) { var op = mk("Open " + (window.CouchDetail.title(layer) || "this widget"), "detail"); op.__root = w; nodes.splice(2, 0, op); }
      // an app in a dock, row, folder or app tile: change, move or remove it, or add one (kept on this TV)
      var ctx = EDIT = appCtx();
      if (ctx) {
        var folder = ctx.kind === "folder", room = ctx.keys.length < ctx.max, eds = [];
        if (typeof ctx.slot === "number") {
          eds.push(mk("Change app", "edit", "change"));
          if (ctx.max > 1 && ctx.keys.length > 1) eds.push(mk("Move", "edit", "move"));
          eds.push(mk(folder ? "Remove from folder" : "Remove", "edit", "remove"));
        }
        // a folder, dock, app grid or games: Add apps, the sheet with every app on this TV (0.13.11), full or
        // not, since OK there also takes one out; a one app tile with nothing in it: Add app, as before
        if (ctx.max > 1) eds.push(mk("Add apps", "edit", "apps"));
        else if (room && ctx.slot !== 0) eds.push(mk(folder ? "Add app to folder" : "Add app", "edit", "add"));
        // Settings stays first on an app too: one more OK from the hold lands on Settings, never on Change app
        nodes = [nodes[0]].concat(eds, nodes.slice(1));
      }
      // the widget's own settings (widget-caps.js settings, docs/WIDGET-SETTINGS-CONTRACT.md). Where the
      // phone page exists (hooks.phoneLink: the on-TV app, the home computer for a TV it runs, the Couch TV
      // home app's own page) it comes first (owner, 23 Nov 2026: set widgets up on the phone, not the TV):
      // "<Widget>: set up on your phone" for a widget waiting for something private, else "Edit on your
      // phone", each a QR code with "No phone? Set it up here" under it. Anywhere else "Edit on the TV",
      // right after Settings. A smart stack: the widget showing in it now. A widget with nothing to set
      // says so in a line, never with an item that does nothing.
      var pw = w, Caps = window.CouchWidgetCaps, note = "", after = 0, phoneFirst = 0;
      while (pw && !(pw.getAttribute && pw.getAttribute("data-obj"))) pw = pw.parentNode;
      var pid = pw && pw.getAttribute("data-obj");
      if (pid && !DESIGNER && Caps && Caps.settings) {
        var wid = w && typeof w.__at === "function" && w.getAttribute("data-kind") === "stack" ? pid + "/" + w.__at() : pid;
        // only a widget with a setting the TV or the phone offers now (pre: true), as Home settings lists them
        var mine = widgetList().filter(function (x) { return x.id === wid && Caps.settings(x.kind).some(function (s) { return s && s.pre === true && (!Array.isArray(s.where) || s.where.indexOf("tv") >= 0 || s.where.indexOf("phone") >= 0); }); })[0];
        var known = widgetList().filter(function (x) { return x.id === wid; })[0];
        var faceEl = w && w.getAttribute("data-face") ? w : w && w.querySelector ? w.querySelector('.cw-slot.on [data-face="1"]') : null, need = faceEl ? faceEl.getAttribute("data-need") || "" : "";
        if (typeof hooks.phoneLink === "function" && window.TVQR && known && (mine || need)) {
          var nm = ((Caps.face && Caps.face(known.kind)) || Caps.get(known.kind) || {}).name || known.kind;
          nodes.unshift(mk(need ? nm + ": set up on your phone" : "Edit on your phone", "wphone", known.id + "|" + need)); phoneFirst = 1;
        } else if (mine) {
          nodes.splice(1, 0, mk("Edit on the TV", "wset", mine.key)); after = 1;
        } else if (known) note = "Nothing to set for this widget on the TV. Change how it looks in Couch TV Studio.";
      }
      // a smart stack: its own settings (when it moves on) after the widget showing in it. Where the phone
      // page exists, on the phone like every other widget ("Edit the stack on your phone", right after the
      // widget's own phone item); its sheet's "No phone? Set it up here" opens the stack's page in Home
      // settings (tvEdit). Anywhere else "Edit the stack on the TV", after Settings.
      if (pid && !DESIGNER && Caps && Caps.settings && wid !== pid && widgetList().some(function (x) { return x.id === pid && x.kind === "stack"; }) &&
        Caps.settings("stack").some(function (s) { return s && s.pre === true; })) {
        if (typeof hooks.phoneLink === "function" && window.TVQR) nodes.splice(phoneFirst, 0, mk("Edit the stack on your phone", "wphone", pid + "|"));
        else nodes.splice(nodes.indexOf(nodes.filter(function (n) { return n.getAttribute("data-act") === "gear"; })[0]) + 1 + after, 0, mk("Edit the stack on the TV", "wset", pid + "|stack"));
        // the stack itself has something to set: only the widget showing now has nothing
        if (!mine) note = "Nothing to set for the widget showing now.";
      }
      openSheet(ctx && typeof ctx.slot === "number" ? (ctx.name || "App") : "Home", { menu: true, nodes: nodes, note: note }, "Back to close. Settings here is Couch TV's own: the remote's Settings button opens the TV's menu.");
    }
    // Set up on your phone: a QR code with the phone's Home settings page, the pairing code, this widget
    // and its step (http://<tv>:5400/setup#pin=NNNNNN&widget=<id>&connect=<need>), then "No phone? Set it
    // up here" for a home with no phone to hand (the widget's page in Home settings). The phone takes only
    // the pin out of the address (shim.js).
    function phoneSheet(arg) {
      closeSheet();
      var parts = String(arg || "").split("|"), id = parts[0], need = parts[1] || "";
      var fail = function () { say("The phone page is not ready on this TV. Use Edit on the TV instead."); };
      if (typeof hooks.phoneLink !== "function" || !window.TVQR) { fail(); return; }
      phoneAt(id, need).then(function (link) {
        var box = h("div", "cw-qr", { background: "#fff", padding: "24px", "border-radius": "24px", display: "inline-block" }, []);
        try { box.appendChild(window.TVQR.svg(link, 420)); } catch (e) { fail(); return; }
        box.setAttribute("data-link", link);
        var here = h("div", "cw-mi", null, ["No phone? Set it up here"]);
        here.setAttribute("data-act", "wtv"); here.setAttribute("data-arg", id); here.setAttribute("data-name", "No phone? Set it up here");
        openSheet("Set up on your phone", { menu: true, nodes: [box, here] });
        // the code, the one line under it, then the small way for a home with no phone (a stop like the code)
        if (sheet) { sheet.el.classList.add("cw-phone"); box.parentNode.insertBefore(h("div", "cw-hint", { margin: "28px 0 36px" }, ["Scan with your phone camera."]), here); }
        if (!sheet) return;
        sheet.phone = arg;   // drawn again when the code changes (phoneAgain)
        // and asked again every 20 s while it is open: a code that changed or ran out is never left on show
        var mine = sheet, url = link;
        (function again() {
          setTimeout(function () {
            if (sheet !== mine) return;
            phoneAt(id, need).then(function (u2) {
              if (sheet !== mine) return;
              if (u2 !== url) phoneSheet(arg); else again();
            }, function () { if (sheet === mine) phoneSheet(arg); });
          }, 20000);
        })();
      }, fail);
    }
    // the card a new design brings when its widgets need setting up (setupSoon): 2 minutes, Back closes it
    function setupCard() {
      phoneAt("", "").then(function (u) {
        var link = u + "&widgets", box = h("div", "cw-qr", { background: "#fff", padding: "24px", "border-radius": "24px", display: "inline-block" }, []);
        try { box.appendChild(window.TVQR.svg(link, 420)); } catch (e) { return; }
        box.setAttribute("data-link", link);
        if (sheet && !sheet.arrive) return;   // something else opened meanwhile: leave it be
        openSheet("Set up your widgets", { nodes: [box] }, "Scan with your phone camera.");
        if (!sheet) return;
        sheet.el.classList.add("cw-arrive");
        sheet.arrive = true; sheet.phone = "arrive";
        var mine = sheet;
        setTimeout(function () { if (sheet === mine) closeSheet(); }, 120000);
      }, function () {});
    }
    // ---- changing a container's apps with the remote ----
    var EDIT = null, MOVING = null, FORCE_SLOT = null;
    function appCtx() {
      var W = window.CouchWidgets, t = target();
      if (!t || DESIGNER || !W || !W.appKinds) return null;
      var w = t;
      while (w && !(w.classList && w.classList.contains("cw"))) w = w.parentNode;
      if (!w || !w.getAttribute("data-apps")) return null;
      var wrap = w;
      while (wrap && !(wrap.getAttribute && wrap.getAttribute("data-obj"))) wrap = wrap.parentNode;
      var id = wrap && wrap.getAttribute("data-obj"), o = list(D && D.objects).filter(function (x) { return obj(x).id === id; })[0];
      if (!o || o.type !== "widget" || W.appKinds().indexOf(o.kind) < 0) return null;
      var s = FORCE_SLOT !== null ? String(FORCE_SLOT) : t.getAttribute("data-slot");
      FORCE_SLOT = null;
      return { o: o, id: id, kind: o.kind, slot: s === null ? null : s === "add" ? "add" : +s, keys: W.appKeys(o, wenv()), max: W.appMax(o.kind), name: t.getAttribute("data-name") || "" };
    }
    function saveKeys(ctx, keys) {
      EDITS[ctx.id + "|" + ctx.kind] = keys.slice(0, ctx.max);
      saveEdits();
      objects(D);
    }
    function say(text) {
      var old = document.querySelector(".cw-tip.cw-say"); if (old && old.parentNode) old.parentNode.removeChild(old);
      var t = h("div", "cw-tip cw-say", null, [text]);
      document.body.appendChild(t);
      setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 700); }, 4000);
    }
    // the TV's own apps, to pick one for a place (Change app, Add app)
    function picker(op) {
      var W = window.CouchWidgets, env = wenv(), have = W.installedApps(env);
      if (!EDIT || !have.length) { say("No apps found on this TV yet."); return; }
      EDIT.op = op;
      var nodes = have.slice(0, 120).map(function (a) {
        var n = W.appNode(a.package, 180, env); n.setAttribute("data-act", "pick"); n.setAttribute("data-arg", a.package); n.style.margin = "16px";
        return n;
      });
      openSheet(op === "add" ? (EDIT.kind === "folder" ? "Add app to folder" : "Add app") : "Change app", { nodes: nodes }, "Pick an app. Back to close");
    }
    // ---- Add apps (0.13.11, owner approved in round 4): one sheet with every app on this TV. OK adds an
    // app to the folder, dock, app grid or games, or takes it out; Hold OK on a picked app moves it along
    // the picked ones; Back saves (kept on this TV, like every Hold OK change). The picked ones come first,
    // numbered in their order. A picked app that is not on this TV stays in the list, dimmed, so OK can
    // take it out. Reached from Hold OK, Add apps, from the Add app place, and from Home settings (the
    // widget's page, Add apps), where it opens over the settings and Back goes back to them.
    function appSheetCtx(key) {
      var W = window.CouchWidgets, m = /^([A-Za-z0-9_-]{1,60})\|([a-z]{1,20})$/.exec(String(key || ""));
      if (!m || DESIGNER || !W || !W.appKinds || W.appKinds().indexOf(m[2]) < 0 || !(D && ON)) return null;
      var o = list(D.objects).map(obj).filter(function (x) { return x.id === m[1] && x.type === "widget" && x.kind === m[2]; })[0];
      return o ? { o: o, id: o.id, kind: o.kind, slot: null, keys: W.appKeys(o, wenv()), max: W.appMax(o.kind), name: "" } : null;
    }
    function appSheet(c, done) {
      var W = window.CouchWidgets, A = window.CouchApps, env = wenv(), have = W ? W.installedApps(env) : [];
      if (!c || c.max < 2) return false;
      if (!have.length) { say("No apps found on this TV yet."); return false; }
      var keyOf = function (pkg) { return (A && A.idOf(pkg)) || pkg; };
      var pkgOf = function (k) { var hit = A && A.get(k) ? A.resolve(k, have) : have.filter(function (a) { return a.package === k; })[0]; return hit ? hit.package : ""; };
      var S = { c: c, done: done, order: c.keys.slice(0, c.max), was: JSON.stringify(c.keys.slice(0, c.max)), tiles: [], moving: null, down: false, held: false, t: null, soon: null, start: 0 };
      S.order.forEach(function (k) { S.tiles.push({ key: k, pkg: pkgOf(k) }); });
      have.forEach(function (a) { var k = keyOf(a.package); if (!S.tiles.some(function (x) { return x.key === k || x.pkg === a.package; })) S.tiles.push({ key: k, pkg: a.package }); });
      S.tiles = S.tiles.slice(0, 160);
      S.tiles.forEach(function (x) {
        var app = W.appNode(x.pkg || "missing:" + x.key, 184, env);
        app.removeAttribute("data-act");
        x.el = h("div", "cw-as-tile", null, [app]);
        x.el.setAttribute("data-key", x.key); if (x.pkg) x.el.setAttribute("data-pkg", x.pkg);
      });
      var Caps = window.CouchWidgetCaps, title = String(obj(c.o.opts).label || ((Caps && Caps.get && Caps.get(c.kind)) || {}).name || "Apps");
      closeSheet();
      S.count = h("span", "cw-as-count", null, [""]);
      S.grid = h("div", "cw-sheet-apps cw-as-grid", null, []);
      S.hint = h("div", "cw-hint cw-as-hint", null, []);
      var el = h("div", "cw-sheet cw-appsheet", { transform: "scale(" + innerWidth / 1920 + ")" }, [h("div", "cw-as-head", null, [h("h2", "", null, [title]), S.count]), S.grid, S.hint]);
      document.body.appendChild(el);
      sheet = { el: el, nodes: [], i: 0, apps: S };
      asDraw(S, 0);
      return true;
    }
    function asPicked(S, x) { return S.order.indexOf(x.key) >= 0; }
    // the tiles in their places: while moving, the picked ones first in their order (the rest as they were)
    function asDraw(S, focusKey) {
      if (S.moving) S.tiles = S.order.map(function (k) { return S.tiles.filter(function (x) { return x.key === k; })[0]; }).filter(Boolean).concat(S.tiles.filter(function (x) { return !asPicked(S, x); }));
      while (S.grid.firstChild) S.grid.removeChild(S.grid.firstChild);
      S.tiles.forEach(function (x) {
        var n = S.order.indexOf(x.key), b = x.el.querySelector(".cw-as-badge");
        if (b) x.el.removeChild(b);
        if (n >= 0) x.el.appendChild(h("div", "cw-as-badge", null, [String(n + 1)]));
        x.el.classList.toggle("cw-as-on", n >= 0);
        x.el.classList.toggle("cw-as-moving", S.moving === x.key);
        S.grid.appendChild(x.el);
      });
      sheet.nodes = S.tiles.map(function (x) { return x.el; });
      if (typeof focusKey === "string") { var at = S.tiles.map(function (x) { return x.key; }).indexOf(focusKey); if (at >= 0) sheet.i = at; }
      else if (typeof focusKey === "number") sheet.i = Math.max(0, Math.min(focusKey, S.tiles.length - 1));
      S.count.textContent = S.order.length + " of " + S.c.max + " picked";
      while (S.hint.firstChild) S.hint.removeChild(S.hint.firstChild);
      if (S.moving) S.hint.appendChild(document.createTextNode("Left and Right move it. OK when it is in place."));
      else [["OK", "adds or takes it out"], ["Hold OK", "moves it"], ["Back", "saves"]].forEach(function (p) { S.hint.appendChild(h("span", "", null, [h("b", "", null, [p[0]]), " ", p[1]])); });
      paintSheet();
    }
    function asSay(text) { say(text); var t = document.querySelector(".cw-tip.cw-say"); if (t) t.style.zIndex = "61"; }
    function asToggle(S) {
      var x = S.tiles[sheet.i];
      if (!x) return;
      if (S.moving) { S.moving = null; asDraw(S, x.key); return; }
      var n = S.order.indexOf(x.key);
      if (n >= 0) S.order.splice(n, 1);
      else if (S.order.length >= S.c.max) { asSay("That holds " + S.c.max + " apps. Take one out first."); return; }
      else S.order.push(x.key);
      asDraw(S, x.key);
    }
    function asHold(S) {
      var x = S.tiles[sheet.i];
      if (!x || S.moving) return;
      if (!asPicked(S, x)) {
        if (S.order.length >= S.c.max) { asSay("That holds " + S.c.max + " apps. Take one out first."); return; }
        S.order.push(x.key);
      }
      S.moving = x.key;
      asDraw(S, x.key);
    }
    function asMove(S, d) {
      var at = S.order.indexOf(S.moving), to = at + d;
      if (at < 0 || to < 0 || to >= S.order.length) return;
      S.order[at] = S.order[to]; S.order[to] = S.moving;
      asDraw(S, S.moving);
    }
    function asCols() {
      var ns = sheet.nodes, top = ns.length ? ns[0].offsetTop : 0, n = 0;
      for (var i = 0; i < ns.length && ns[i].offsetTop === top; i++) n++;
      return Math.max(1, n);
    }
    // Back: saved when anything changed (EDITS, like Hold OK's other changes), then back where it came from
    function asDone(S) {
      clearTimeout(S.t); clearTimeout(S.soon);
      var changed = JSON.stringify(S.order) !== S.was, c = S.c;
      closeSheet();
      if (changed) { saveKeys(c, S.order); if (!S.done) { cur = { id: c.id, i: 0 }; paint(); } say("Saved."); }
      if (S.done) try { S.done(changed); } catch (e) {}
    }
    function asKeydown(e) {
      var S = sheet.apps, a = arrowOf(e);
      // Hebrew and Arabic: the tiles run from the right (the grid is a flex row in an rtl page), so Left and Right
      // swap, as for the home's own arrows in keydown; moving an app follows the tiles the same way
      if (a && a[0] && document.documentElement.dir === "rtl") a = [-a[0], a[1]];
      if (backKey(e)) { if (e.repeat) return; if (S.moving) { var mk = S.moving; S.moving = null; asDraw(S, mk); } else asDone(S); return; }
      if (a) {
        if (S.moving) { asMove(S, a[0] || a[1]); return; }
        var cols = asCols(), ni = sheet.i + (a[0] || a[1] * cols);
        if (a[1] && ni >= sheet.nodes.length && Math.floor(sheet.i / cols) < Math.floor((sheet.nodes.length - 1) / cols)) ni = sheet.nodes.length - 1;
        if (ni >= 0 && ni < sheet.nodes.length) { sheet.i = ni; paintSheet(); }
        return;
      }
      if (!okKey(e)) return;
      // the same hold rules as the home: a repeat, or a second down with no up between, is a hold; a TV
      // that sends a held OK as quick down and up pairs still counts as held
      // the same held OK still coming in after the hold (repeats, or quick down and up pairs): not a choice
      var now = Date.now();
      if (S.swallow) { if (now - S.last < 260) { S.last = now; return; } S.swallow = false; }
      if (e.repeat || S.down) { if (S.down && !S.held) { clearTimeout(S.t); S.held = true; asHeld(S); } return; }
      if (S.soon) { clearTimeout(S.soon); S.soon = null; S.down = true; if (now - S.start >= 650) { clearTimeout(S.t); S.held = true; asHeld(S); } return; }
      S.down = true; S.held = false; S.start = now;
      S.t = setTimeout(function () { if (!sheet || sheet.apps !== S) return; S.held = true; if (S.soon) { clearTimeout(S.soon); S.soon = null; } asHeld(S); }, 650);
    }
    function asHeld(S) { S.swallow = true; S.last = Date.now(); asHold(S); }
    function asKeyup() {
      var S = sheet.apps;
      if (S.swallow) { S.last = Date.now(); S.down = false; clearTimeout(S.t); return; }
      if (!S.down) return;   // the OK that opened the sheet, let go here: not a choice
      S.down = false;
      if (S.held) { clearTimeout(S.t); S.held = false; return; }
      var heldFor = Date.now() - S.start;
      S.soon = setTimeout(function () { S.soon = null; clearTimeout(S.t); if (sheet && sheet.apps === S && !S.held) asToggle(S); S.held = false; }, heldFor < 400 ? 140 : 90);
    }
    function edit(op, arg) {
      var c = EDIT;
      if (!c) return;
      var keys = c.keys.slice(), A = window.CouchApps;
      if (op === "apps") { appSheet(c); return; }
      if (op === "change" || op === "add") { picker(op); return; }
      if (op === "remove" && typeof c.slot === "number") { keys.splice(c.slot, 1); saveKeys(c, keys); cur = { id: c.id, i: Math.max(0, Math.min(c.slot, keys.length - 1)) }; paint(); say(c.kind === "folder" ? "Removed from the folder." : "Removed. Hold OK, Add app, to put one back."); return; }
      if (op === "move" && typeof c.slot === "number") { MOVING = c; say("Left and Right move it. OK when it is in place."); return; }
      if (op === "pick" && arg) {
        var key = (A && A.idOf(arg)) || arg;
        if (keys.indexOf(key) >= 0 && !(c.op === "change" && keys[c.slot] === key)) { say("That app is already here."); return; }
        if (c.op === "change" && typeof c.slot === "number") keys[c.slot] = key;
        else if (keys.length < c.max) keys.push(key);
        saveKeys(c, keys);
        cur = { id: c.id, i: c.op === "change" && typeof c.slot === "number" ? c.slot : keys.length - 1 };
        paint();
      }
    }
    // moving an app along its container: each press swaps it with its neighbour
    function moveKey(dx) {
      var c = MOVING, keys = c.keys, to = c.slot + dx;
      if (to < 0 || to >= keys.length) return;
      var k = keys[c.slot]; keys[c.slot] = keys[to]; keys[to] = k; c.slot = to;
      saveKeys(c, keys);
      cur = { id: c.id, i: to }; last = null;
      paint();
    }
    function sheetKey(e, a) {
      if (a) {
        var n = sheet.nodes.length, cols = sheet.el.querySelector(".cw-menu") ? 1 : Math.max(1, Math.round(sheet.el.querySelector(".cw-sheet-apps").offsetWidth / 244));
        // Hebrew and Arabic: a one app picker's tiles (Change app, Add app) run from the right, so Left and
        // Right swap, as in Add apps and for the home's own arrows
        if (a[0] && cols > 1 && document.documentElement.dir === "rtl") a = [-a[0], a[1]];
        var ni = sheet.i + a[0] + a[1] * cols;
        if (ni >= 0 && ni < n && !(a[0] && Math.floor(ni / cols) !== Math.floor(sheet.i / cols))) sheet.i = ni;
        paintSheet();
        return;
      }
      var el = sheet.nodes[sheet.i];
      closeSheet();
      if (el.__root) { openDetail(el.__root); return; }
      act(el);
    }
    // the way to settings, said on screen every time the home opens until someone has used it once
    // (the Settings button or the Hold OK menu): many remotes' own Settings button opens the TV's menu,
    // not couch-tv's, so a beginner has no other way to find it
    function tip() {
      if (tipShown || DESIGNER || PREVIEW) return;
      tipShown = true;
      try { if (localStorage.getItem(TIP_USED)) return; } catch (e) {}
      // a gear hidden until reached (no clear spot on the design) only shows with Up or Right at the edge
      var tucked = GEAR && GEAR.classList.contains("cw-gear-tuck");
      var t = h("div", "cw-tip cw-tip-settings", null, [tucked ?
        "Hold OK for apps and settings, or go Up or Right to the edge of the screen for the Settings gear. The remote's own Settings button opens the TV's menu." :
        "Hold OK for apps and settings, or go to the Settings gear at the edge of the screen. The remote's own Settings button opens the TV's menu."]);
      document.body.appendChild(t);
      setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 700); }, 9000);
    }
    function tipUsed() { try { localStorage.setItem(TIP_USED, "1"); } catch (e) {} }
    var ARW = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
    var ARC = { 38: [0, -1], 40: [0, 1], 37: [-1, 0], 39: [1, 0], 19: [0, -1], 20: [0, 1], 21: [-1, 0], 22: [1, 0] };
    function arrowOf(e) { return ARW[e.key] || ((!e.key || e.key === "Unidentified") ? ARC[e.keyCode] : null) || null; }
    function okKey(e) { return e.key === "Enter" || e.key === " " || e.key === "Select" || e.key === "NumpadEnter" || e.keyCode === 13 || e.keyCode === 23; }
    function backKey(e) { return ["Escape", "Esc", "Backspace", "GoBack", "BrowserBack"].indexOf(e.key) >= 0 || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461; }
    function ours() { return shown() && !ASK && (DESIGNER || !hooks.free || hooks.free()); }
    function keydown(e) {
      if (window.CouchDetail && window.CouchDetail.isOpen() && !(sheet && sheet.apps)) { e.preventDefault(); e.stopPropagation(); window.CouchDetail.keydown(e); return; }
      // trying it in the designer: Back with nothing open goes back to editing
      if (!sheet && DESIGNER && backKey(e) && shown()) { e.preventDefault(); e.stopPropagation(); try { window.parent.postMessage({ type: "couchtv:exit-remote" }, location.origin); } catch (x) {} return; }
      if (sheet) {
        e.preventDefault(); e.stopPropagation();
        if (sheet.apps) { asKeydown(e); return; }
        if (backKey(e)) { closeSheet(); return; }
        var a = arrowOf(e);
        if (a) sheetKey(e, a);
        else if (okKey(e) && !e.repeat) {
          // the same held OK still coming in as quick down and up pairs after the menu opened: not a choice
          var now0 = Date.now();
          if (okSwallow && now0 - okLast < 260) { okLast = now0; return; }
          okSwallow = false; okLast = now0;
          sheetKey(e, null);
        }
        return;
      }
      if (!ours()) return;
      if (MOVING) {
        // moving an app: Left and Right (Up and Down too) carry it along; OK or Back puts it down
        e.preventDefault(); e.stopPropagation();
        var mv = arrowOf(e);
        if (mv) moveKey(mv[0] || mv[1]);
        else if ((okKey(e) || backKey(e)) && !e.repeat) { MOVING = null; say("Moved."); }
        return;
      }
      var ar = arrowOf(e);
      if (ar) { e.preventDefault(); e.stopPropagation(); if (document.documentElement.dir === "rtl") ar = [-ar[0], ar[1]]; move(ar[0], ar[1]); tip(); return; }
      if (okKey(e)) {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || okDown) {
          // Android's own long press: the held key comes again as a repeat (an ADB long press sends it at
          // once, then lets go). A repeat is a hold, so it opens the Home menu now and the key up after it
          // never opens the focused app (an ADB long press on a TCL opened Netflix, 19 Nov 2026).
          // A second down with no up between can only be the key still held, so it counts as a hold
          // whether or not the browser marks it as a repeat: the TCL's WebView did not (20 Nov 2026,
          // Netflix opened again with 0.13.6, which waited for e.repeat).
          if (okDown && !okHeld) { clearTimeout(okT); if (okSoon) { clearTimeout(okSoon); okSoon = null; } okHeld = true; okSwallow = true; okLast = Date.now(); holdMenu(); }
          return;
        }
        // a TV that sends a held OK as quick down and up pairs (a TCL did): a down soon after an up is
        // the same press going on, so it still counts as held, not as an OK on the widget (a clock's Timers)
        if (okSoon) { clearTimeout(okSoon); okSoon = null; okDown = true; if (Date.now() - okStart >= 650) { clearTimeout(okT); okHeld = true; okSwallow = true; okLast = Date.now(); holdMenu(); } return; }
        if (!cur) { move(0, 0); }
        okDown = true; okHeld = false; okStart = Date.now();
        okT = setTimeout(function () { okHeld = true; if (okSoon) { clearTimeout(okSoon); okSoon = null; } okSwallow = true; okLast = Date.now(); holdMenu(); }, 650);
      }
    }
    function keyup(e) {
      if (sheet && sheet.apps) { if (okKey(e)) { e.preventDefault(); e.stopPropagation(); asKeyup(); } return; }
      if (okSwallow && okKey(e)) okLast = Date.now();
      if (window.CouchDetail && window.CouchDetail.isOpen() && !okDown) { e.preventDefault(); e.stopPropagation(); window.CouchDetail.keyup(e); return; }
      if (!okDown || !okKey(e)) return;
      e.preventDefault(); e.stopPropagation();
      okDown = false;
      if (okHeld) { clearTimeout(okT); okHeld = false; return; }
      // wait a moment before acting: another down straight after means the OK is still held
      var heldFor = Date.now() - okStart;
      var tg = target();
      okSoon = setTimeout(function () { okSoon = null; clearTimeout(okT); if (!okHeld) { var now = target(); act(now && now.isConnected ? now : tg); } okHeld = false; }, heldFor < 400 ? 140 : 90);
    }
    var bound = false;
    return {
      bind: function () { if (bound) return; bound = true; document.addEventListener("keydown", keydown, true); document.addEventListener("keyup", keyup, true); },
      refresh: function () {
        if (!shown()) { if (sheet) closeSheet(); if (window.CouchDetail && window.CouchDetail.isOpen()) window.CouchDetail.close(true); paint(); return; }
        if (!cur) { var S = stops(); cur = startStop(S); }
        paint();
        tip();
      },
      reset: function () { cur = null; last = null; tipShown = false; closeSheet(); if (window.CouchDetail && window.CouchDetail.isOpen()) window.CouchDetail.close(true); },
      move: move, activate: function () { act(target()); }, current: function () { return cur ? { id: cur.id, i: cur.i } : null },
      // put the focus on a widget (and an item in it): the designer and the tests
      focus: function (id, i) { cur = { id: String(id), i: typeof i === "number" ? i : -1 }; last = null; paint(); },
      moving: function () { return !!MOVING; },
      sheetOpen: function () { return !!sheet; },
      // Add apps for one container by "<object id>|<kind>" (Home settings); done(changed) after Back
      appSheet: function (key, done) { return appSheet(appSheetCtx(key), done); },
      // the phone code changed (the on-TV app, Auth.onPin): an open Edit on your phone draws its new QR
      phoneAgain: function () { if (document.querySelector('.cw[data-face="1"]')) { PLINK.at = 0; askPhone(); } if (sheet && sheet.phone) { if (sheet.arrive) setupCard(); else phoneSheet(sheet.phone); } },
      // a design that needs setting up has just arrived: "Set up your widgets" and the phone page's code
      setupCard: function () { setupCard(); },
      // the Android apps' Back (tv.back(), never a key): the same as the Back key in keydown. Add apps saves
      // on Back (a move in progress is put down first), and a Hold OK Move ends with "Moved."
      back: function () {
        if (sheet && sheet.apps) { var S = sheet.apps; if (S.moving) { var mk = S.moving; S.moving = null; asDraw(S, mk); } else asDone(S); return true; }
        if (window.CouchDetail && window.CouchDetail.isOpen()) { window.CouchDetail.close(); return true; }
        if (sheet) { closeSheet(); return true; }
        if (MOVING && ours()) { MOVING = null; say("Moved."); return true; }
        return false;
      },
      detail: function () { var t = target(); if (t) openDetail(t); },
      // the designer's Remote path: from every stop, where each press goes
      paths: function () {
        var S = stops(), out = [], keep = cur, keepLast = last;
        tracing = true;
        S.forEach(function (s) {
          (s.inner.length ? s.inner.map(function (n, k) { return k; }) : [-1]).forEach(function (i) {
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
              cur = { id: s.id, i: i }; last = null;
              move(d[0], d[1]);
              if (cur && (cur.id !== s.id || cur.i !== i)) out.push({ from: { id: s.id, i: i }, to: { id: cur.id, i: cur.i }, d: d });
            });
          });
        });
        tracing = false; cur = keep; last = keepLast; paint();
        return out;
      },
      step: function (S, c, l, dx, dy) { return step(S, c, l, dx, dy); },
      stops: function () { return stops().map(function (s) { return { id: s.id, inner: s.inner.length, act: s.el.getAttribute("data-act") || "", box: s.box }; }); }
    };
  })();

  window.CouchDesign = {
    home: home,
    // the key "Use this design?" keeps a yes under (app.js: a design the account sent to its own linked TV, with Undo)
    hashOf: hashOf,
    on: function () { return ON; },
    // the video background: app.js holds it while the home is not on screen (name: "away", "idle",
    // "off"); state() says what it is doing and why ({ state, why, ref }); loops() the built in ones
    hold: function (name, on) { HOLD[String(name)] = !!on; if (VP) VP.play(vidWanted()); },
    videoState: function () { return VP ? VP.state() : { state: "off", why: "", ref: "" }; },
    loops: function () { return window.CouchVideo ? JSON.parse(JSON.stringify(window.CouchVideo.LOOPS)) : []; },
    asking: function () { return !!ASK; },
    // the words a TV will draw from these (the allow list), for the designer to show and warn
    words: function (t) { return SAN.w(t, 120) || ""; },
    // each line of words: shown on a TV or not, and why not
    lines: function (t) { return wordLines(t); },
    // the Android app's Back (tv.back on release): the question's Keep my home, else one press toward
    // switching the design off; true when it was used here. backHeld: each repeat while Back is held.
    back: function () { if (ASK) { ASK.done(false); return true; } if (NAV.back()) return true; var used = backPress(false); held = 0; return used; },
    backHeld: function () { if (!ASK) backPress(true); },
    // the dock's no-go zone (1920 x 1080), and whether one of the home's own parts is kept off it
    zone: function () { return ZONE; },
    // widgets (widgets.js and the designer): the remote in widget mode, data the TV has changed
    nav: NAV,
    widgetMode: function () { return ROOT.classList.contains("cd-wmode"); },
    wkinds: function () { return WKINDS.slice(); },
    // fonts: the CSS a design font name draws with, and which store files a design would load
    fontOf: function (name) { return fontOf(name); }, fontsOf: function (d) { return fontsOf(sanitize(d)); },
    // the apps changed on this TV with the remote (Hold OK), by "<object id>|<kind>"
    appEdits: function () { return JSON.parse(JSON.stringify(EDITS)); },
    // What the design on screen uses, for Home settings (app.js) and the phone's Home settings page: the
    // home's own parts it shows, whether it has its own background, and its widget kinds. { on: false }
    // with no design on screen. Names and kinds only, nothing private.
    uses: function () {
      if (!(D && ON)) return { on: false };
      var el = obj(D.elements), kinds = {}, glass = false, bg = obj(D.background);
      var shown = function (k) { if (obj(el[k]).hidden === true) return false; try { return !this.hides(k); } catch (e) { return true; } }.bind(this);
      list(D.objects).forEach(function (o) {
        o = obj(o);
        if (o.type !== "widget") { kinds["obj:" + o.type] = 1; return; }
        [o].concat(list(o.items)).forEach(function (it) { kinds[obj(it).kind] = 1; if (wpanel(obj(it)) === "glass") glass = true; });
      });
      return { on: true, parts: { clock: obj(el.clock).hidden !== true, date: shown("date"), weather: shown("weather"), people: shown("people"),
        quick: shown("quick"), keep_watching: shown("keep_watching"), dock: obj(el.dock).hidden !== true },
        background: !!(bg.image || bg.colour || bg.video), kinds: Object.keys(kinds).filter(function (k) { return k.indexOf("obj:") < 0; }),
        objects: Object.keys(kinds).filter(function (k) { return k.indexOf("obj:") === 0; }).map(function (k) { return k.slice(4); }), glass: glass };
    },
    // every widget on the home now, a stack's widgets too: [{ key: "<id>|<kind>", id, kind, label, x, y, w, h }]
    widgetList: function () { return widgetList(); },
    // the phone's "Widgets on your screen": the design's look and each widget as the design has it (its box,
    // opts and style, a stack's items), so the phone can draw the same widget. Only what the design holds.
    screen: function () {
      if (!(D && ON)) return null;
      var cp = function (x) { return JSON.parse(JSON.stringify(x === undefined ? null : x)); };
      return { look: cp(obj(D.look)), widgets: list(D.objects).map(obj).filter(function (o) { return o.type === "widget" && o.kind; }).map(function (o) {
        return { id: o.id, kind: o.kind, x: +o.x || 0, y: +o.y || 0, w: +o.w || 0, h: +o.h || 0, opts: cp(obj(o.opts)), style: cp(obj(o.style)),
          items: o.kind === "stack" ? list(o.items).map(function (it) { it = obj(it); return { kind: it.kind, opts: cp(obj(it.opts)), style: cp(obj(it.style)) }; }) : undefined };
      }) };
    },
    // the design's containers of apps, and changing one's apps the way Hold OK does (null: its own apps again)
    appWidgets: function () { return appWidgets(); },
    // Add apps, the sheet with every app on this TV, for one of them (Home settings opens it over itself)
    appSheet: function (key, done) { return NAV.appSheet(key, done); },
    setApps: function (key, keys) {
      var w = appWidgets().filter(function (a) { return a.key === key; })[0];
      if (!w) return { ok: false, error: "That app row is not on this design any more." };
      if (keys === null) delete EDITS[key];
      else {
        if (!Array.isArray(keys)) return { ok: false, error: "No apps were sent." };
        var A = window.CouchApps, seen = {}, clean = [];
        keys.forEach(function (k) { if (pkgOk(k) && KEEP.indexOf(k) < 0) { var id = (A && !A.get(k) && A.idOf(k)) || k; if (!seen[id]) { seen[id] = 1; clean.push(id); } } });
        if (clean.length > w.max) return { ok: false, error: "That holds " + w.max + (w.max === 1 ? " app." : " apps.") };
        EDITS[key] = clean;
      }
      saveEdits();
      if (D && ON) objects(D);
      return { ok: true };
    },
    wact: function () { return WACT.slice(); },
    wopts: function () { return JSON.parse(JSON.stringify(WOPT)); },
    wstyle: function () { return JSON.parse(JSON.stringify(WSTYLE)); },
    wpanel: function (o) { return wpanel(obj(o)); },
    colour: function (c) { return colour(c); },
    imgOk: function (u) { return imgOk(u); },
    dataChanged: function (what, key) { key = JSON.stringify(key === undefined ? DATA_V + 1 : key); if (DATA_KEYS[what] === key) return; DATA_KEYS[what] = key; DATA_V++; if (D && ON) objects(D); },
    // a weather widget that needs the forecast is on the home: the TV asks Open-Meteo for it
    // which of these widget kinds are on the home (air and surf ask their own free services only then)
    wantsKinds: function (kinds) { var on = {}; if (D && ON) list(D.objects).forEach(function (o) { o = obj(o); if (o.type === "widget") [o].concat(list(o.items)).forEach(function (it) { if (kinds.indexOf(obj(it).kind) >= 0) on[obj(it).kind] = 1; }); }); return Object.keys(on); },
    // the web widgets on the home, each with its options (widget-web.js asks only for these)
    // (each with its id, "<stack id>/<its place>" for a widget in a stack, so its own settings can be read)
    widgetsOf: function (kinds) { var out = []; if (D && ON) list(D.objects).forEach(function (o) { o = obj(o); if (o.type === "widget") [o].concat(list(o.items)).forEach(function (it, i) { it = obj(it); if (kinds.indexOf(it.kind) >= 0) out.push({ id: i ? o.id + "/" + (i - 1) : o.id, kind: it.kind, opts: obj(it.opts) }); }); }); return out; },
    wantsForecast: function () { return !!(D && ON && list(D.objects).some(function (o) { o = obj(o); return o.type === "widget" && [o].concat(list(o.items)).some(function (it) { return ["weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "air", "surf", "date"].indexOf(it.kind) >= 0; }); })); },
    nogo: function (part) { var pb = PART_BOX.filter(function (x) { return x[0] === part; })[0], n = pb && document.querySelector(pb[1]); return !!(n && n.getAttribute("data-nogo")); },
    // where the remote starts on the dock: the first app, as couch-tv does; with no app showing (a
    // hidden dock), More apps, the way to every app (never Settings)
    startIndex: function (items) {
      var i, p;
      for (i = 0; i < items.length; i++) { p = items[i] && (items[i].package || items[i].kind); if (p && KEEP.indexOf(p) < 0 && !/^(screen|input):/.test(p) && (!items[i].kind || items[i].kind === "app")) return i; }
      for (i = 0; i < items.length; i++) if (items[i] && (items[i].package === "more" || items[i].kind === "more")) return i;
      return 0;
    },
    start: function (design, h) {
      hooks = h || {};
      FROM_CODE = !!hooks.fromCode;
      // designs switched off with the remote stay off on this TV until turned back on in Home settings
      if (design && !DESIGNER && offNow()) { escaped = true; design = null; }
      escapeKeys();
      NAV.bind();
      if (design && typeof design === "object" && !Array.isArray(design)) {
        PENDING = design;
        // a design this TV has not been asked about: a preview and "Use this design?" first
        var hk = hashOf(design);
        if (needsConfirm(design) && store("couchtv.design.no") === hk) { escaped = true; }
        else if (needsConfirm(design)) askFirst(design);   // nothing of it is applied until Use this design
        else apply(design);
      }
      focusAfterAnswer();
      document.addEventListener("keydown", firstKey, true);
      if (DESIGNER) {
        ROOT.classList.add("cd-edit");   // editing: no focus shown until "Try it with the remote"
        // trying it with the remote: OK on an app flashes it and tells the designer what would open
        document.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" || ROOT.classList.contains("cd-edit")) return;
          var f = document.querySelector("#grid .app.focus");
          if (!f) return;
          f.classList.remove("cd-flash"); void f.offsetWidth; f.classList.add("cd-flash");
          var lab = f.querySelector(".label span") || f.querySelector(".label");
          try { window.parent.postMessage({ type: "couchtv:open", name: lab ? (lab.getAttribute("data-full") || lab.textContent) : "" }, location.origin); } catch (x) {}
        }, true);
        window.addEventListener("message", function (e) {
          if (e.origin !== location.origin || e.source !== window.parent) return;
          var m = e.data || {};
          if (m.type === "couchtv:design") { SEQ = typeof m.seq === "number" ? m.seq : SEQ; apply(m.design); }
          if (m.type === "couchtv:demo") { DEMO_ON = !!m.on; if (D) objects(D); tell("couchtv:applied"); }
          if (m.type === "couchtv:mode") { ROOT.classList.toggle("cd-edit", !m.remote); if (m.remote) ROOT.classList.add("cd-keys"); else ROOT.classList.remove("cd-keys"); NAV.reset(); NAV.refresh(); }
        });
        tell("couchtv:ready");
      }
    },
    // the designer keeps its own record where the TV will draw it
    safePlace: function (o) { var c = sanObject(o); return c ? safePlace(c) : null; },
    // the dock's order for the remote: what sits in the dock (Settings and More apps included) first,
    // the apps out on the screen after
    order: function (list) {
      var T = obj(obj(D && D.apps).tiles), free = function (it) { return it && it.package && obj(T[it.package]).free === true; };
      return list.filter(function (it) { return !free(it); }).concat(list.filter(free));
    },
    // the dock's columns, for the remote (app.js moves up and down a column, along a row)
    cols: function (def, n) { return D ? dockCols(obj(obj(D.elements).dock), n - freeCount()) : def; },
    // the designer draws its Add panel previews with the same code as the TV
    renderObject: function (o, demo) {
      FORCE_DEMO = !!demo; PREVIEW = true;
      try { var c = sanObject(Object.assign({ id: "preview" }, o)) || { type: "text", text: "" }; return h("div", "cd-o cd-o-" + c.type, { position: "relative" }, [inner(c)]); }
      finally { FORCE_DEMO = false; PREVIEW = false; }
    },
    // sections: the set sizes of a control, how a section packs them, and where each module sits
    // (the designer places a section's apps from the same numbers the TV uses)
    controlSizes: function () { return JSON.parse(JSON.stringify(CTL)); },
    packGroup: function (controls, cols, rows) { return packGroup(controls, cols, rows); },
    groupCells: function (o) {
      var g = groupGeo(obj(o)), placed = packGroup(obj(o).controls, g.cols, g.rows);
      return { mw: g.mw, mh: g.mh, cells: placed.map(function (p) { return p.fits ? Object.assign({ i: p.i, fits: true, c: p.c, r: p.r, w: p.w, h: p.h }, g.cell(p.c, p.r, p.w, p.h)) : { i: p.i, fits: false }; }) };
    },
    // icon styles: a set of the same icons in another style, registered by code shipped with the home
    // (for example a file in tv-home/web that calls this). A design names the set in icon_style.
    registerIcons: function (id, label, map, opts) {
      if (!iconSetOk(id) || id === "line" || !map || typeof map !== "object") return false;
      var set = {};
      Object.keys(map).forEach(function (k) { if (ICON[k] && typeof map[k] === "string" && /^<svg[\s>]/.test(map[k])) set[k] = map[k]; });
      ICON_SETS[id] = set; ICON_FULL[id] = !!(opts && opts.full);
      Object.keys(ICON_NODES).forEach(function (k) { if (k.indexOf(id + ":") === 0) delete ICON_NODES[k]; });
      ICON_SET_LABELS = ICON_SET_LABELS.filter(function (l) { return l[0] !== id; }).concat([[id, String(label || id).slice(0, 30)]]);
      return true;
    },
    iconSets: function () { return ICON_SET_LABELS.map(function (l) { return { id: l[0], label: l[1], full: !!ICON_FULL[l[0]] }; }); },
    // the gate itself, for tests and for the designer to show what a TV will accept
    sanitize: sanitize,
    // the style rules a clean design gives the home (for tests: nothing is drawn)
    css: function (clean) { return css(obj(clean)); },
    // flags are found in the design as written (the gate takes those words out of the clean copy)
    check: function (design) { var clean = sanitize(design); return { clean: clean, notes: NOTES.slice(), flags: flags(obj(design)) }; },
    // what each part of a design asks of the TV: [what, weight, key], the speed meter's list
    // (raw: the design as made, before the TV's own limits; the designer's speed bar shows that)
    cost: function (design, raw) { return cost(raw ? obj(design) : sanitize(design)); },
    // Home settings, Look: the row that turns designs back on after Back switched them off
    off: function () { return offNow(); },
    // Home settings, Designs (app.js designerRows): the design is held back on this TV, switched off with
    // Back held or answered Keep my home; resume() brings it back (the same as Your design On did)
    held: function () { return offNow() || !!(PENDING && store("couchtv.design.no") === hashOf(PENDING)); },
    resume: function () { setOff(false); if (PENDING && store("couchtv.design.no") === hashOf(PENDING)) { store("couchtv.design.ok", hashOf(PENDING)); store("couchtv.design.no", null); } },
    // an honest line when the design's video shows only its still picture, and why ("" when it plays)
    videoNote: videoNote,
    // Home settings, Designs, Show the still picture instead: kept on this TV (on: true or false), and
    // whether the design has a video background at all
    videoStill: function (on) { if (on === undefined) return store(STILL_KEY) === "1"; store(STILL_KEY, on ? "1" : null); if (VP) VP.update(); return !!on; },
    hasVideo: function () { return !!(VP && VP.state().ref); },
    settingsRow: function (restart) {
      var off = offNow() || (PENDING && store("couchtv.design.no") === hashOf(PENDING));
      // an honest line when the design's video shows only its still picture, and why
      var vnote = videoNote();
      return { kind: "toggle", key: "design-on", label: "Your design", value: off ? "Off" : "On",
        sub: off ? "Switched off, or not chosen yet. Turn it on to see it." : "Hold Back for 5 seconds to switch it off" + vnote,
        act: function () { if (off) { setOff(false); if (PENDING) { store("couchtv.design.ok", hashOf(PENDING)); store("couchtv.design.no", null); } } else setOff(true); if (restart) restart(); } };
    },
    flags: flags,
    limits: LIMIT,
    objectCss: OBJ_CSS,
    clock24: function (def) {
      var f = obj(obj(D && D.elements).clock).format;
      return f === "24h" ? true : f === "12h" ? false : def;
    },
    day: function (d, def, loc) {
      var opt = DATE_FORMATS[obj(obj(D && D.elements).date).format];
      if (!opt) return def;
      var s = d.toLocaleDateString(loc, opt).replace(/,/g, "");
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    // the glass digits show the photo exactly behind them: worked out from where they really are
    fill: function (c, f, s, liquid) {
      var r = f.getBoundingClientRect(), ex = r.left, ey = r.top;
      var bg = obj(D && D.background), src = BG.ok ? imgOk(bg.image) : "";
      if (src) {
        var z = num(bg.zoom, 1, 1, 4), ox = (z - 1) * innerWidth * num(bg.x, 50, 0, 100) / 100, oy = (z - 1) * innerHeight * num(bg.y, 50, 0, 100) / 100;
        f.style.backgroundImage = cssUrl(src);
        f.style.backgroundSize = z * 100 + "vw " + z * 100 + "vh";
        f.style.backgroundPosition = (-ex - ox) + "px " + (-ey - oy) + "px";
      } else if (liquid) {
        var cr = c.getBoundingClientRect(), LENS = 1.07;
        f.style.backgroundPosition = (-ex - (LENS - 1) * (cr.left + cr.width / 2)) + "px " + (-ey - (LENS - 1) * (cr.top + cr.height / 2)) + "px";
      } else {
        f.style.backgroundPosition = -ex + "px " + -ey + "px";
      }
    },
    // the dock's apps: the design's order (only those), less the ones it hides
    // the dock a design hides keeps only Settings and More apps (app.js adds those): every app is
    // one press away, and the remote never lands on an app nobody can see
    // a part a design hides, or moved mostly off the screen, is out of the remote's path
    hides: function (part) {
      if (!(D && D.elements && D.elements[part])) return false;
      if (D.elements[part].hidden === true) return true;
      var pb = PART_BOX.filter(function (x) { return x[0] === part; })[0], pnode = pb && document.querySelector(pb[1]);
      if (pnode && pnode.getAttribute("data-nogo")) return true;   // moved onto the dock: not drawn, not in the path
      var p = PARTS[part], n = p && document.querySelector(p.sel);
      if (!n) return false;
      var b = n.getBoundingClientRect(), W = innerWidth, Hh = innerHeight;
      if (!b.width || !b.height) return false;
      var seen = Math.max(0, Math.min(W, b.right) - Math.max(0, b.left)) * Math.max(0, Math.min(Hh, b.bottom) - Math.max(0, b.top));
      return seen < 0.3 * b.width * b.height;
    },
    dock: function (items, shown, max) {
      var A = obj(D && D.apps), order = list(A.order).filter(pkgOk), hidden = list(A.hidden);
      // a hidden dock keeps only the apps a design put out on the screen (in a section, say): they
      // are where the design placed them, in its order, and the remote still reaches them
      if (D && D.elements && D.elements.dock && D.elements.dock.hidden === true) {
        var TT = obj(A.tiles);
        return items.filter(function (it) { return it.package && obj(TT[it.package]).free === true && hidden.indexOf(it.package) < 0; })
          .sort(function (a, b) { return (order.indexOf(a.package) + 1 || 99) - (order.indexOf(b.package) + 1 || 99); });
      }
      var out = shown;
      if (order.length) {
        var by = {};
        items.forEach(function (it) { if (it.package) by[it.package] = it; });
        // an order may name catalogue ids (a shared home, app-catalogue.js): each becomes the app this TV has
        var AC = window.CouchApps;
        out = order.map(function (p) { if (by[p]) return by[p]; var r = AC && AC.get(p) ? AC.resolve(p, items) : null; return r && by[r.package] ? by[r.package] : null; }).filter(function (it, i, a) { return it && a.indexOf(it) === i; });
      }
      // the dock's own places are counted without the apps pulled out onto the screen: a Smart home
      // tile (or anything else app.js adds) may shorten the dock, but never drops a pulled out app
      var T = obj(A.tiles), free = function (it) { return obj(T[it.package]).free === true; };
      out = out.concat(items.filter(function (it) { return free(it) && out.indexOf(it) < 0; }))
        .filter(function (it) { return hidden.indexOf(it.package) < 0; });
      var lim = D && D.elements && D.elements.dock && D.elements.dock.max_apps;
      if (lim) max = Math.min(max || 10, lim);
      // the input tiles pinned on this TV (an HDMI port as its own tile, set on the TV or the phone) stay
      // in a design's dock as they do in the standard one: after its apps, taking dock places, never
      // pushed out by the design's own order (they are this TV's, so no design names them)
      var pin = function (it) { return /^input:/.test(it.package || ""); }, pins = shown.filter(pin);
      var apps = out.filter(function (it) { return !free(it) && !pin(it); });
      return apps.slice(0, Math.max(1, (max || 10) - pins.length)).concat(pins, out.filter(free));
    }
  };
})();
