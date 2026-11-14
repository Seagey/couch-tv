// Custom cards (idea from geissmannz on Instagram): the household's own cards on the home, from a
// small JSON file named by home.custom_cards (docs/TV-HOME.md, "Custom cards"). Display only: this
// file turns whatever the JSON holds into plain data, and app.js draws it with textContent. Nothing
// in the JSON is ever run, parsed as HTML or put in an attribute other than an http(s) image link.
// The bridge cleans the same way (bridge/custom_cards.py); the home cleans again, because the
// on-TV app with no bridge reads the link itself.
(function (root) {
  var MAX_CARDS = 8, TITLE_MAX = 40, SUBTITLE_MAX = 60, VALUE_MAX = 24, URL_MAX = 1000;
  var PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;   // the bridge's package check
  var URL_RE = /^https?:\/\/[^\s'"<>\\`$]+$/i;                    // http(s) only, nothing a shell can trip on

  function text(v, most) {
    if (typeof v !== "string" && typeof v !== "number") return "";
    return String(v).replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, most).trim();
  }
  function url(v) {
    if (typeof v !== "string") return "";
    v = v.trim();
    return v.length <= URL_MAX && URL_RE.test(v) ? v : "";
  }

  // whatever the file held (an object with "cards", or a list) -> at most 8 clean cards
  function clean(data) {
    var raw = data && !Array.isArray(data) && typeof data === "object" ? data.cards : data;
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length && out.length < MAX_CARDS; i++) {
      var c = raw[i];
      if (!c || typeof c !== "object" || Array.isArray(c)) continue;
      var title = text(c.title, TITLE_MAX);
      if (!title) continue;
      var card = { title: title };
      var sub = text(c.subtitle, SUBTITLE_MAX); if (sub) card.subtitle = sub;
      var val = text(c.value, VALUE_MAX); if (val) card.value = val;
      var img = url(c.image); if (img) card.image = img;
      if (typeof c.app === "string" && c.app.length <= 200 && PACKAGE_RE.test(c.app)) card.app = c.app;
      else { var link = url(c.url); if (link) card.url = link; }
      out.push(card);
    }
    return out;
  }

  // a JSON string -> cards, or null when it is not JSON (the caller keeps the last good cards)
  function parse(s) {
    if (typeof s !== "string" || s.length > 65536) return null;
    try { return clean(JSON.parse(s)); } catch (e) { return null; }
  }

  root.CustomCards = { clean: clean, parse: parse, MAX: MAX_CARDS, EVERY_MIN: 10 };
})(typeof window !== "undefined" ? window : this);
