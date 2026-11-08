// Clear app icons, after Apple's "clear" icon look (#25): an app's own icon with its background
// taken away, so only the glyph is left, drawn white on the glass tile. Used by the TV home
// (app.js) and the phone remote (remote/src/Watch.jsx imports this same file).
//
// How: the icon is drawn small on a canvas; the colours along its edges are the background (one
// colour, or the steps of a gradient); every pixel is scored by how far it is from the nearest of
// them, and that score is the glyph's alpha. An icon that will not split cleanly (a photo, or a
// glyph that fills nearly all of it) is refused, and the page keeps its grey version instead.
// Results are kept in memory and in localStorage, so each icon is worked out once per TV or phone.
(function () {
  var N = 192;               // working size, px
  var T0 = 16, T1 = 42;      // Lab distance: under T0 is background, over T1 is fully glyph
  var VER = "clearicon.v2:";
  var mem = {}, waiting = {};

  function lab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116; };
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // The glyph as a PNG data URL, or "" when the icon does not split cleanly.
  function cut(img) {
    var c = document.createElement("canvas");
    c.width = c.height = N;
    var x = c.getContext("2d");
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return "";
    // landscape banners (the Classic look) keep their shape: fit, centred
    var s = Math.min(N / w, N / h), dw = w * s, dh = h * s, ox = (N - dw) / 2, oy = (N - dh) / 2;
    x.drawImage(img, ox, oy, dw, dh);
    var d = x.getImageData(0, 0, N, N).data;   // throws on a tainted canvas: the caller falls back
    var shape = shapeCut(x, d, ox, oy, dw, dh);
    if (shape !== null) return shape;

    // the background: colours in a band just inside the edges, quantised, the common ones kept
    // (the outer 4%: wide wordmarks such as NETFLIX reach to about 8% from the edge)
    var bins = {}, total = 0, band = Math.max(3, Math.round(Math.min(dw, dh) * 0.04)), inner = Math.round(Math.min(dw, dh) * 0.12);
    var x0 = Math.round(ox), y0 = Math.round(oy), x1 = Math.round(ox + dw) - 1, y1 = Math.round(oy + dh) - 1;
    for (var py = y0; py <= y1; py++) {
      for (var px = x0; px <= x1; px++) {
        var e = Math.min(px - x0, x1 - px, py - y0, y1 - py);
        if (e < 1 || e > band) continue;
        var i = (py * N + px) * 4;
        if (d[i + 3] < 200) continue;
        var k = (d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3);
        bins[k] = (bins[k] || 0) + 1;
        total++;
      }
    }
    if (total < 50) return "";
    var pal = [];
    for (var k2 in bins) {
      if (bins[k2] / total < 0.004) continue;
      var p = k2.split(",");
      pal.push(lab(p[0] * 8 + 4, p[1] * 8 + 4, p[2] * 8 + 4));
    }
    if (!pal.length || pal.length > 600) return "";

    // each pixel's distance to the nearest background colour
    var dbg = new Float32Array(N * N), memo = {}, j, q, key;
    var nearest = function (L, set) {
      var best = 1e9;
      for (var m = 0; m < set.length; m++) {
        var dl = L[0] - set[m][0], da = L[1] - set[m][1], db = L[2] - set[m][2], dd = dl * dl + da * da + db * db;
        if (dd < best) best = dd;
      }
      return Math.sqrt(best);
    };
    for (j = 0; j < N * N; j++) {
      q = j * 4;
      if (d[q + 3] < 128) { dbg[j] = -1; continue; }
      key = (d[q] >> 2) + "," + (d[q + 1] >> 2) + "," + (d[q + 2] >> 2);
      var v = memo[key];
      if (v === undefined) v = memo[key] = nearest(lab(d[q], d[q + 1], d[q + 2]), pal);
      dbg[j] = v;
    }
    // the glyph's own colours (one for most, a few for a multi colour logo), most used first. A
    // background with a pale glow near a white glyph (Disney+) needs a looser "clearly not
    // background" before any glyph pixels count.
    var gpal = [], gcount = [];
    [T1, 28, 22].some(function (lim) {
      var gbins = {}, gtotal = 0;
      for (var k = 0; k < N * N; k++) {
        if (dbg[k] <= lim) continue;
        var i4 = k * 4, gk = (d[i4] >> 4) + "," + (d[i4 + 1] >> 4) + "," + (d[i4 + 2] >> 4);
        gbins[gk] = (gbins[gk] || 0) + 1;
        gtotal++;
      }
      if (gtotal < N * N * 0.004) return false;
      Object.keys(gbins).sort(function (u, w) { return gbins[w] - gbins[u]; }).forEach(function (g) {
        if (gbins[g] / gtotal < 0.03) return;
        var gp = g.split(",");
        gpal.push(lab(gp[0] * 16 + 8, gp[1] * 16 + 8, gp[2] * 16 + 8));
        gcount.push(gbins[g]);
      });
      return true;
    });
    if (!gpal.length || gpal.length > 12) return "";
    // colours close to the main one count as it (shading, a gradient in the letters)
    var mainSet = gpal.map(function (c) { var dl = c[0] - gpal[0][0], da = c[1] - gpal[0][1], db = c[2] - gpal[0][2]; return Math.sqrt(dl * dl + da * da + db * db) < 30; });

    // alpha: which side a pixel is nearer, the background or the glyph (soft at the edges), so a
    // hole cut in the glyph in a colour close to the background (Twitch's eyes) stays a hole
    var out = x.createImageData(N, N), o = out.data, sum = 0, cnt = 0, edgeHits = 0, edgeN = 0, memo2 = {};
    for (j = 0; j < N * N; j++) {
      q = j * 4;
      var a = 0, db0 = dbg[j];
      if (db0 > T0 * 0.5) {
        key = (d[q] >> 2) + "," + (d[q + 1] >> 2) + "," + (d[q + 2] >> 2);
        var dg = memo2[key];
        if (dg === undefined) {
          var L2 = lab(d[q], d[q + 1], d[q + 2]), bi = 0, bd = 1e9;
          for (var m2 = 0; m2 < gpal.length; m2++) {
            var e1 = L2[0] - gpal[m2][0], e2 = L2[1] - gpal[m2][1], e3 = L2[2] - gpal[m2][2], ed = e1 * e1 + e2 * e2 + e3 * e3;
            if (ed < bd) { bd = ed; bi = m2; }
          }
          dg = memo2[key] = [Math.sqrt(bd), bi];
        }
        var r = db0 / (db0 + dg[0] + 1e-6);
        a = Math.max(0, Math.min(1, (r - 0.36) / 0.28));
        a = a * a * (3 - 2 * a);
        // a second glyph colour (Twitch's eyes, the Apple TV apple) shows at part strength, so the
        // detail inside a glyph is not lost, as in Apple's clear icons
        if (!mainSet[dg[1]]) a *= 0.42;
      }
      o[q] = o[q + 1] = o[q + 2] = 255;
      o[q + 3] = Math.round(a * 255);
      var jx = j % N, jy = (j / N) | 0, ee = Math.min(jx - x0, x1 - jx, jy - y0, y1 - jy);
      if (ee >= inner) { sum += a; cnt++; }
      else if (ee >= 0 && ee < band) { edgeN++; if (a > 0.5) edgeHits++; }
    }
    var cover = cnt ? sum / cnt : 0;
    // a glyph is neither a speck nor the whole icon, and the outer edge is background
    if (cover < 0.006 || cover > 0.62 || (edgeN && edgeHits / edgeN > 0.25)) return "";
    x.putImageData(out, 0, 0);
    return c.toDataURL("image/png");
  }

  // A logo that is itself a shape on a see-through square (YouTube's red rounded box): Apple's clear
  // version keeps the shape as glass and cuts the play mark out of it as a hole (#32, #33, thanks
  // alonmustafa). So when the edges are mostly see-through, the most used opaque colour is the glyph
  // and every other colour inside it is a hole. null: not that kind of icon, go on with the usual cut.
  function shapeCut(x, d, ox, oy, dw, dh) {
    var band = Math.max(3, Math.round(Math.min(dw, dh) * 0.04)), clear = 0, n = 0, j, q;
    var x0 = Math.round(ox), y0 = Math.round(oy), x1 = Math.round(ox + dw) - 1, y1 = Math.round(oy + dh) - 1;
    for (var py = y0; py <= y1; py++) for (var px = x0; px <= x1; px++) {
      if (Math.min(px - x0, x1 - px, py - y0, y1 - py) >= band) continue;
      n++; if (d[(py * N + px) * 4 + 3] < 128) clear++;
    }
    if (!n || clear / n < 0.6) return null;
    var bins = {}, best = null, bestN = 0;
    for (j = 0; j < N * N; j++) {
      q = j * 4;
      if (d[q + 3] < 200) continue;
      var k = (d[q] >> 4) + "," + (d[q + 1] >> 4) + "," + (d[q + 2] >> 4);
      bins[k] = (bins[k] || 0) + 1;
      if (bins[k] > bestN) { bestN = bins[k]; best = k; }
    }
    if (!best) return "";
    var bp = best.split(","), D = lab(bp[0] * 16 + 8, bp[1] * 16 + 8, bp[2] * 16 + 8);
    var out = x.createImageData(N, N), o = out.data, memo = {}, sum = 0;
    for (j = 0; j < N * N; j++) {
      q = j * 4;
      var key = (d[q] >> 2) + "," + (d[q + 1] >> 2) + "," + (d[q + 2] >> 2), dd = memo[key];
      if (dd === undefined) { var L = lab(d[q], d[q + 1], d[q + 2]); dd = memo[key] = Math.sqrt(Math.pow(L[0] - D[0], 2) + Math.pow(L[1] - D[1], 2) + Math.pow(L[2] - D[2], 2)); }
      var a = Math.max(0, Math.min(1, (45 - dd) / 25)) * (d[q + 3] / 255);
      o[q] = o[q + 1] = o[q + 2] = 255;
      o[q + 3] = Math.round(a * 255);
      sum += a;
    }
    var cover = sum / (N * N);
    if (cover < 0.05 || cover > 0.95) return "";
    x.putImageData(out, 0, 0);
    return x.canvas.toDataURL("image/png");
  }

  function save(src, v) {
    mem[src] = v;
    try { localStorage.setItem(VER + src, v || "-"); } catch (e) {}
  }
  function cached(src) {
    if (src in mem) return mem[src];
    try {
      var v = localStorage.getItem(VER + src);
      if (v != null) return (mem[src] = v === "-" ? "" : v);
    } catch (e) {}
    return undefined;
  }

  // get(src, cb): cb(dataUrl or "") once worked out. Returns the answer straight away when cached.
  function get(src, cb) {
    var c = cached(src);
    if (c !== undefined) { if (cb) cb(c); return c; }
    if (waiting[src]) { if (cb) waiting[src].push(cb); return undefined; }
    waiting[src] = cb ? [cb] : [];
    var im = new Image();
    im.crossOrigin = "anonymous";   // a separate copy: the icon on screen never needs CORS
    var done = function (v) {
      save(src, v);
      var l = waiting[src]; delete waiting[src];
      l.forEach(function (f) { try { f(v); } catch (e) {} });
    };
    im.onload = function () { var v = ""; try { v = cut(im); } catch (e) { v = ""; } done(v); };
    im.onerror = function () { done(""); };
    im.src = src;
    return undefined;
  }

  window.ClearIcon = { get: get, cached: cached };
})();
