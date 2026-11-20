// The Home settings words added in plain English on 20 Nov 2026 (Designs, the widget pages, the design
// banners, Edit on the TV and Edit on your phone) in the TV's language. app.js and design.js draw them in
// English; their translations are in i18n.js as tw_* keys, one per language block, with the English in
// S.en. This swaps a line on screen that is exactly one of those English lines for the TV's language as
// it is drawn, so the code that draws it stays as it is. A line with a gap ({addr}, {code}) matches its
// pattern and keeps what was in the gap. English, or a line that is not one of these, is left alone.
(function () {
  "use strict";
  var I = window.I18N;
  if (!I || !I.strings || !I.strings.en || typeof MutationObserver === "undefined") return;
  var EXACT = {}, PATTERNS = [];
  Object.keys(I.strings.en).forEach(function (k) {
    if (k.indexOf("tw_") !== 0) return;
    var en = I.strings.en[k];
    if (/\{\w+\}/.test(en)) {
      var names = [];
      var re = new RegExp("^" + en.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\w+)\\?\}/g, function (m, n) { names.push(n); return "(.+?)"; }) + "$");
      PATTERNS.push({ key: k, re: re, names: names });
    } else EXACT[en] = k;
  });
  // the widget settings words (caps-words.js, shared with the phone pages): English line -> { lang: words }
  var CAPS = {}, CAPS_PAT = [], capsSeen = null, capsSize = -1;
  function caps() {
    var c = window.CouchCapsWords;
    var size = c && c.words ? Object.keys(c.words).length : 0;
    if (!c || !c.words || (c === capsSeen && size === capsSize)) return;   // read again when a line is added
    capsSeen = c; capsSize = size; CAPS = {}; CAPS_PAT = [];
    Object.keys(c.words).forEach(function (en) {
      if (!/\{\w+\}/.test(en)) { CAPS[en] = c.words[en]; return; }
      var names = [];
      CAPS_PAT.push({ row: c.words[en], names: names, re: new RegExp("^" + en.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, function (m, n) { names.push(n); return "(.+?)"; }) + "$") });
    });
  }
  function capsWords(core) {
    caps();
    var l = I.lang(), cell = function (row) { var v = row && row[l]; if (v == null && l === "es-MX" && row) v = row.es; return v == null ? null : v; };
    var out = cell(CAPS[core]);
    for (var i = 0; i < CAPS_PAT.length && out == null; i++) {
      var m = CAPS_PAT[i].re.exec(core), t = m && cell(CAPS_PAT[i].row);
      if (t == null) continue;
      var vals = {}; CAPS_PAT[i].names.forEach(function (n, j) { vals[n] = m[j + 1]; });
      out = t.replace(/\{(\w+)\}/g, function (x, n) { return vals[n] != null ? vals[n] : x; });
    }
    return out;
  }
  // the line in the TV's language, or null when it stays as it is
  function words(text) {
    if (!text || I.lang() === "en") return null;
    var s = String(text), lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], core = s.trim();
    if (!core) return null;
    var k = EXACT[core], out = null;
    if (k) out = I.t(k);
    else {
      for (var i = 0; i < PATTERNS.length && !out; i++) {
        var m = PATTERNS[i].re.exec(core);
        if (!m) continue;
        var vars = {};
        PATTERNS[i].names.forEach(function (n, j) { vars[n] = m[j + 1]; });
        out = I.t(PATTERNS[i].key, vars);
      }
    }
    if (!out) out = capsWords(core);
    return out && out !== core ? lead + out + tail : null;
  }
  function fix(node) {
    if (!node) return;
    if (node.nodeType === 3) { var w = words(node.data); if (w !== null) node.data = w; return; }
    if (node.nodeType !== 1 || node.nodeName === "SCRIPT" || node.nodeName === "STYLE") return;
    var walk = document.createTreeWalker(node, 4, null, false), n, list = [];
    while ((n = walk.nextNode())) list.push(n);
    list.forEach(function (t) { var w = words(t.data); if (w !== null) t.data = w; });
  }
  function start() {
    if (!document.body) return;
    fix(document.body);
    new MutationObserver(function (recs) {
      if (I.lang() === "en") return;
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === "characterData") fix(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) fix(r.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.CouchTvWords = { words: words };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
