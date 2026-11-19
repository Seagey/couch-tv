// A QR code, made right here in the page (no library, no image service: the code never leaves the
// browser to be drawn). Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes, far
// more than a design code needs). Follows ISO/IEC 18004 the way Project Nayuki's reference does.
// TVQR.matrix(text) gives rows of true (dark) and false; TVQR.svg(text, px) gives an <svg> element.
// Checked by decoding with jsQR: tools/tv-designer/server/tests/qr.test.mjs. Made from couch-tv
// Studio's app/qr.js (this copy also sets stroke="none"); here it draws the QR of
// Home settings, couch-tv Studio, Share this home, and of the Guest Wi-Fi widget.
(function (root) {
  "use strict";
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var ECC_M_BITS = 0;   // the format bits for level M

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]; }
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg; i++) r.push(0); r[deg - 1] = 1;
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  function utf8(s) { var u = unescape(encodeURIComponent(s)), out = []; for (var i = 0; i < u.length; i++) out.push(u.charCodeAt(i)); return out; }

  function matrix(text) {
    var bytes = utf8(String(text)), ver;
    for (ver = 1; ver <= 10; ver++) {
      var need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error("Too long for a QR code here");
    var size = ver * 4 + 17, cap = dataCodewords(ver) * 8;
    // data bits: byte mode, the count, the bytes, a terminator, then pad to whole bytes and the pad pattern
    var bits = [];
    var put = function (v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    // error correction blocks, interleaved
    var nb = BLOCKS[ver], el = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [], at = 0;
    for (i = 0; i < nb; i++) {
      var d = data.slice(at, at + shortLen - el + (i < nShort ? 0 : 1)); at += d.length;
      var ecc = rsRemainder(d, div);
      if (i < nShort) d.push(0);
      blocks.push(d.concat(ecc));
    }
    var words = [];
    for (i = 0; i < blocks[0].length; i++) for (var j = 0; j < blocks.length; j++) if (i !== shortLen - el || j >= nShort) words.push(blocks[j][i]);

    var M = [], F = [];
    for (i = 0; i < size; i++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
    var set = function (x, y, dark) { M[y][x] = dark; F[y][x] = true; };
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    var al = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      al = [6];
      for (var pos = size - 7; al.length < na; pos -= step) al.splice(1, 0, pos);
    }
    al.forEach(function (ay, ii) {
      al.forEach(function (ax, jj) {
        var last = al.length - 1;
        if ((ii === 0 && jj === 0) || (ii === 0 && jj === last) || (ii === last && jj === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    var format = function (mask) {
      var dd = (ECC_M_BITS << 3) | mask, rem = dd;
      for (var t = 0; t < 10; t++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((dd << 10) | rem) ^ 0x5412, bit = function (n) { return ((fb >>> n) & 1) === 1; };
      for (var q = 0; q <= 5; q++) set(8, q, bit(q));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (q = 9; q < 15; q++) set(14 - q, 8, bit(q));
      for (q = 0; q < 8; q++) set(size - 1 - q, 8, bit(q));
      for (q = 8; q < 15; q++) set(8, size - 15 + q, bit(q));
      set(8, size - 8, true);
    };
    format(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) { var bt = ((vb >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bt); set(c, a, bt); }
    }
    // the data, in the zig zag from the bottom right
    var n = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!F[y][x] && n < words.length * 8) { M[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
      }
    }
    var flip = function (mask) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        if (F[y][x]) continue;
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        if (inv) M[y][x] = !M[y][x];
      }
    };
    // pick the mask that leaves the fewest long runs, solid blocks and lopsided dark counts
    var score = function () {
      var s = 0, dark = 0, y, x, run;
      for (y = 0; y < size; y++) for (run = 1, x = 1; x <= size; x++) {
        if (x < size && M[y][x] === M[y][x - 1]) run++; else { if (run >= 5) s += run - 2; run = 1; }
      }
      for (x = 0; x < size; x++) for (run = 1, y = 1; y <= size; y++) {
        if (y < size && M[y][x] === M[y - 1][x]) run++; else { if (run >= 5) s += run - 2; run = 1; }
      }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var cc = M[y][x]; if (cc === M[y][x + 1] && cc === M[y + 1][x] && cc === M[y + 1][x + 1]) s += 3; }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (M[y][x]) dark++;
      return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) { flip(m); format(m); var sc = score(); if (sc < bestScore) { bestScore = sc; best = m; } flip(m); }
    flip(best); format(best);
    return M;
  }

  // dark modules as one path, with the 4 module quiet zone round it
  function svg(text, px) {
    var M = matrix(text), size = M.length, q = 4, all = size + q * 2, d = "";
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (M[y][x]) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + all + " " + all);
    s.setAttribute("width", px); s.setAttribute("height", px);
    s.setAttribute("shape-rendering", "crispEdges");
    s.setAttribute("role", "img");
    // stroke="none" on both: a page's own svg styles (a design's icon rule strokes every svg in
    // currentColor) must never draw over the squares, or the code reads blank
    var bg = document.createElementNS(NS, "rect"); bg.setAttribute("width", all); bg.setAttribute("height", all); bg.setAttribute("fill", "#fff"); bg.setAttribute("stroke", "none");
    var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "#000"); p.setAttribute("stroke", "none");
    s.appendChild(bg); s.appendChild(p);
    return s;
  }

  root.TVQR = { matrix: matrix, svg: svg };
})(typeof window !== "undefined" ? window : globalThis);
