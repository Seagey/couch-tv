// Frost: the Night look's glass drawn once per scene instead of every frame (lane L, 28 Nov 2026).
//
// The dock and the Keep watching cards are frosted glass: a backdrop-filter (blur 1.75rem, saturate 170%)
// over the scene. A backdrop filter is worked out again on every frame that anything on the screen moves,
// and on a 2 GB TV that is most of the cost of moving the focus (an Android TV 12 emulator, 2 cores, CPU 8x
// slower: 28 frames a second along the dock, 42 with no glass at all). The scene under the glass holds still
// between scene changes, so the same picture can be drawn once: the part of the scene under each panel is
// cut out, blurred and saturated the same way (its edges mirrored, as the browser does), small, and shown as
// the panel's own background under its tint. Measured against the live glass in Chromium at 1920x1080: the
// same to within 1 level of 255 inside the panels, a few pixels of rounded corner a little different.
// The live blur stays whenever the picture could differ: while a scene fades, while the cards slide, with a
// scene clip, the depth zoom, ambient weather, the Glass setting, Lighter home (no blur at all), a design's
// own glass, an old engine, or anything the drawing does not understand. Any error leaves the live blur.
(function () {
  "use strict";
  var root = document.documentElement;
  var PANELS = "#grid, #shelf .ncard";
  var gen = 0, timer = 0, drawn = [], fading = false, panels = 0;

  // Off where the live blur must stay: not the Night look, or something under the glass moves or is not drawn here
  function allowed() {
    var c = root.classList;
    if (!EDGE || !c.contains("theme-night") || c.contains("lighter") || c.contains("glass") || c.contains("old-engine") ||
        c.contains("depth-zoom") || c.contains("has-video") || c.contains("np-sync-colors") || c.contains("theme-loop") || c.contains("amb-fx")) return false;
    if (document.querySelector("#scenes .scene.on .svid.playing")) return false;
    return true;
  }

  // "blur(28px) saturate(1.7)" (or blur alone): [radius in px, saturation]; null for anything else
  function parseGlass(s) {
    var m = /^blur\(([\d.]+)px\)(?:\s+saturate\(([\d.]+)\))?$/.exec((s || "").trim());
    return m ? [parseFloat(m[1]), m[2] ? parseFloat(m[2]) : 1] : null;
  }
  // a vertical gradient of colour stops, as getComputedStyle writes it, drawn on the canvas; false if it is something else
  function vgrad(ctx, str, w, h) {
    if (!str || str === "none") return true;
    var m = /^linear-gradient\((?:(?:180deg|to bottom),\s*)?(rgba?\(.*)\)$/.exec(str);
    if (!m) return false;
    var stops = m[1].split(/,\s*(?![^(]*\))/), g = ctx.createLinearGradient(0, 0, 0, h);
    for (var i = 0; i < stops.length; i++) {
      var c = /^(rgba?\([^)]*\))\s*([\d.]+%)?$/.exec(stops[i]);
      if (!c) return false;
      g.addColorStop(c[2] ? parseFloat(c[2]) / 100 : i / (stops.length - 1), c[1]);
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    return true;
  }
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  // the scene showing and the scrim, as the page draws them under the home, at 1/s of the screen
  function backdrop(sc, s) {
    var W = innerWidth / s, H = innerHeight / s, b = canvas(W, H), y = b.getContext("2d");
    if (!("filter" in y)) return null;
    y.fillStyle = getComputedStyle(document.body).backgroundColor;
    y.fillRect(0, 0, b.width, b.height);
    var parts = sc.children;
    for (var i = 0; i < parts.length; i++) {
      var el = parts[i], cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.classList.contains("gclock")) continue;
      if (cs.transform !== "none" || +cs.opacity !== 1) return null;
      y.filter = cs.filter && cs.filter !== "none" ? cs.filter : "none";
      if (el.tagName === "IMG") {
        if (!el.getAttribute("src")) continue;
        if (!el.complete || !el.naturalWidth) return null;
        var r = Math.max(b.width / el.naturalWidth, b.height / el.naturalHeight), dw = el.naturalWidth * r, dh = el.naturalHeight * r;
        y.drawImage(el, (b.width - dw) / 2, (b.height - dh) / 2, dw, dh);
      } else if (el.tagName === "DIV") {
        if (!vgrad(y, cs.backgroundImage, b.width, b.height) || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent")) return null;
      } else return null;   // a clip, or anything new: not drawn here
      y.filter = "none";
    }
    var scrim = document.querySelector(".scrim");
    if (scrim && getComputedStyle(scrim).display !== "none" && !vgrad(y, getComputedStyle(scrim).backgroundImage, b.width, b.height)) return null;
    return b;
  }
  // a panel's box on the screen, without its own transform (a focused card is a little bigger)
  // (read, never written: a focused card's scale is about its middle, so the middle stays and the size is its own);
  // null for a turn or a 3D move
  function boxOf(el) {
    var r = el.getBoundingClientRect(), tf = getComputedStyle(el).transform;
    if (!tf || tf === "none") return { left: r.left, top: r.top, width: r.width, height: r.height };
    var m = /^matrix\(([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^)]+)\)$/.exec(tf);
    if (!m || Math.abs(+m[2]) > 1e-6 || Math.abs(+m[3]) > 1e-6) return null;
    var w = el.offsetWidth, h = el.offsetHeight, cx = r.left + r.width / 2 - +m[5], cy = r.top + r.height / 2 - +m[6];
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
  }
  function overlaps(a, b) { return a.left < b.right && b.left < a.left + a.width && a.top < b.bottom && b.top < a.top + a.height; }

  // one panel's picture: its part of the scene, edges mirrored, blurred and saturated, at 1/s
  // How the browser fills in past a panel's edges before it blurs: Chrome 129 (September 2024) and newer mirror the
  // picture (the CSS spec, blink-dev "Update CSS backdrop-filter to use mirror edgeMode"); older ones repeat the edge
  // pixels. Anything else (no Chrome version to read): null, the live blur stays.
  function edgeMode(ua) {
    var m = /\b(?:Chrome|Chromium)\/(\d+)/.exec(ua || "");
    return m ? (+m[1] >= 129 ? "mirror" : "clamp") : null;
  }
  var EDGE = edgeMode(navigator.userAgent);

  function frostOf(b, r, glass, s) {
    var x = r.left / s, y = r.top / s, w = Math.max(1, Math.round(r.width / s)), h = Math.max(1, Math.round(r.height / s));
    var cut = canvas(w, h);
    cut.getContext("2d").drawImage(b, -x, -y);
    var P = Math.ceil(glass[0] * 3 / s), m = canvas(w + 2 * P, h + 2 * P), mg = m.getContext("2d");
    if (EDGE === "clamp") {   // the edge rows and columns stretched outwards, the corners from the corner pixels
      mg.drawImage(cut, P, P);
      mg.drawImage(cut, 0, 0, 1, h, 0, P, P, h); mg.drawImage(cut, w - 1, 0, 1, h, P + w, P, P, h);
      mg.drawImage(m, 0, P, w + 2 * P, 1, 0, 0, w + 2 * P, P); mg.drawImage(m, 0, P + h - 1, w + 2 * P, 1, 0, P + h, w + 2 * P, P);
    } else {
      var nx = Math.ceil(P / w), ny = Math.ceil(P / h);
      for (var kx = -nx; kx <= nx; kx++) for (var ky = -ny; ky <= ny; ky++) {
        var fx = kx % 2 !== 0, fy = ky % 2 !== 0;
        mg.setTransform(fx ? -1 : 1, 0, 0, fy ? -1 : 1, P + kx * w + (fx ? w : 0), P + ky * h + (fy ? h : 0));
        mg.drawImage(cut, 0, 0);
      }
    }
    var o = canvas(w, h), z = o.getContext("2d");
    z.filter = "blur(" + glass[0] / s + "px)" + (glass[1] !== 1 ? " saturate(" + glass[1] + ")" : "");
    z.drawImage(m, -P, -P);
    return o;
  }

  function clear(el) {
    el.classList.remove("fz");
    if (el.__fzUrl) { var u = el.__fzUrl; el.__fzUrl = ""; setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 3000); }
  }
  function off() { gen++; root.classList.remove("frost"); }

  var draws = 0;
  function draw() {
    timer = 0; draws++;
    var my = ++gen;
    try {
      if (!allowed() || fading || document.hidden) { root.classList.remove("frost"); return; }
      var sc = document.querySelector("#scenes .scene.on");
      if (!sc) { root.classList.remove("frost"); return; }
      root.classList.remove("frost");   // read each panel's own glass and tint
      var els = [].slice.call(document.querySelectorAll(PANELS)), jobs = [];
      panels = els.length;
      // a design's own background or depth picture is under every panel: the live blur
      if ([].some.call(document.querySelectorAll("#cd-bg, #cd-depth"), function (e) { return e.offsetWidth && getComputedStyle(e).display !== "none"; })) { els.forEach(clear); return; }
      // what else may be under a panel: the scene's clock, a design's added things (those panels keep the live blur)
      var clocks = [].slice.call(sc.querySelectorAll(".gclock")).concat([].slice.call(document.querySelectorAll(".cd-layer > *")))
        .filter(function (c) { return c.offsetWidth || c.offsetHeight; }).map(function (c) { return c.getBoundingClientRect(); });
      var s = 0;
      els.forEach(function (el) {
        var cs = getComputedStyle(el), glass = parseGlass(cs.backdropFilter || cs.webkitBackdropFilter);
        if (!glass || cs.display === "none" || cs.visibility === "hidden") { clear(el); return; }
        var r = boxOf(el);
        if (!r || r.width < 8 || r.height < 8 || clocks.some(function (c) { return overlaps(r, c); })) { clear(el); return; }
        jobs.push({ el: el, glass: glass, r: r, tint: cs.backgroundColor });
        // the scale: the blur stays about 7 px at the small size, so the small picture loses nothing a blur keeps
        s = Math.max(s, Math.max(1, Math.min(4, glass[0] / 7)));
      });
      if (!jobs.length) return;
      var b = backdrop(sc, s);
      if (!b) { jobs.forEach(function (j) { clear(j.el); }); return; }
      var left = jobs.length;
      drawn = [];
      jobs.forEach(function (j) {
        var o = frostOf(b, j.r, j.glass, s);
        var done = function (url) {
          if (my !== gen) { if (url) URL.revokeObjectURL(url); return; }
          if (url) {
            var old = j.el.__fzUrl;
            j.el.__fzUrl = url;
            j.el.style.setProperty("--ft", j.tint);
            j.el.style.setProperty("--fz", 'url("' + url + '")');
            j.el.classList.add("fz");
            drawn.push({ el: j.el, r: j.r });
            if (old) setTimeout(function () { try { URL.revokeObjectURL(old); } catch (e) {} }, 3000);
          }
          if (!--left && my === gen && drawn.length && allowed() && !fading) root.classList.add("frost");
        };
        if (o.toBlob) o.toBlob(function (blob) { done(blob ? URL.createObjectURL(blob) : ""); });
        else done("");
      });
    } catch (e) { off(); }
  }
  function soon(ms) { if (timer) clearTimeout(timer); timer = setTimeout(draw, ms == null ? 300 : ms); }

  // a panel moved or changed size since its picture was drawn
  function moved() {
    for (var i = 0; i < drawn.length; i++) {
      var d = drawn[i];
      if (!d.el.isConnected) return true;
      var r = boxOf(d.el);
      if (!r || Math.abs(r.left - d.r.left) > 0.5 || Math.abs(r.top - d.r.top) > 0.5 || Math.abs(r.width - d.r.width) > 0.5 || Math.abs(r.height - d.r.height) > 0.5) return true;
    }
    return document.querySelectorAll(PANELS).length !== panels;
  }

  function start() {
    var scenes = document.getElementById("scenes");
    if (!scenes || !window.MutationObserver || !window.URL || !URL.createObjectURL) return;
    var on = null;
    // a scene starting to fade in: the live blur until the fade is over, then its picture
    new MutationObserver(function () {
      var now = scenes.querySelector(".scene.on");
      if (now === on) return;
      on = now;
      fading = true; off();
      var ms = 1700;
      try { ms = parseFloat(getComputedStyle(now || scenes).transitionDuration) * 1000 + 150 || ms; } catch (e) {}
      setTimeout(function () { fading = false; soon(0); }, ms);
    }).observe(scenes, { subtree: true, attributes: true, attributeFilter: ["class"] });
    // the look, Lighter home, the night dim (on <body>) and the rest: only these classes count (the focus
    // settling, the scene names and this file's own class come and go all the time)
    var KEYS = /^(theme-\w+|lighter|glass|old-engine|depth-zoom|has-video|np-sync-colors|amb-fx|night|cd)$/, sig = "";
    var mine = function () { return (root.className + " " + document.body.className).split(/\s+/).filter(function (k) { return KEYS.test(k); }).sort().join(" "); };
    sig = mine();
    var classes = new MutationObserver(function () { var n = mine(); if (n !== sig) { sig = n; off(); soon(); } });
    classes.observe(root, { attributes: true, attributeFilter: ["class"] });
    classes.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    // Keep watching sliding along: the live blur while it moves, a new picture once it stops
    var shelf = document.getElementById("shelf");
    if (shelf) new MutationObserver(function (list) {
      // (this file's own --fz and --ft on a card are style changes too: those do not count)
      for (var i = 0; i < list.length; i++) if (list[i].type === "childList" || !list[i].target.classList.contains("fz")) { if (root.classList.contains("frost")) off(); soon(450); return; }
    })
      .observe(shelf, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { soon(); }), seen = [];
      var watch = function () { [].forEach.call(document.querySelectorAll(PANELS), function (el) { if (seen.indexOf(el) < 0) { seen.push(el); ro.observe(el); } }); };
      watch();
      new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
    }
    // anything else that moved a panel: checked a moment after the remote stops
    window.addEventListener("keyup", function () { setTimeout(function () { if (moved()) { off(); soon(0); } }, 400); }, true);
    window.addEventListener("resize", function () { off(); soon(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) soon(); });
    soon(1000);
  }

  window.CouchFrost = { edgeMode: edgeMode, parseGlass: parseGlass, vgrad: vgrad, allowed: allowed, draw: draw, off: off, draws: function () { return draws; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
