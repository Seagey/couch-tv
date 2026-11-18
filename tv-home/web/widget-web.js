// The widgets that read the web: where each one's data comes from, the readers that turn a source's
// answer into what the widget draws, and the loader that asks each source only while its widget is on
// the home, at most once per refresh, and keeps the last answer on the TV so a reload asks nothing.
//
// Every source is free, needs no key and no account, and no server of couch-tv's is in the way: the TV
// asks the source itself, or, for a source a web page may not read (a news feed sends no CORS header),
// it asks through a relay that is part of couch-tv at home: the launcher on a Google TV, Android TV or
// Fire TV (http://tvos.invalid/webdata), the on-TV app or the home computer's bridge (/api/webdata).
// A relay only knows the sources named here (an id, never a link), so it can never be pointed elsewhere.
//
// What a widget gets (env.data.web, read by widgets.js and widget-detail.js), per source and id:
//   { ok: true, at: <ms>, v: <what the reader made>, stale: true when the last ask failed }
//   { ok: false, at: <ms>, err: "relay" | "failed" | "empty" }      nothing to show, and why
//   nothing at all                                                    still being asked
//
// ES5 on purpose: old Android TV WebViews. Also a CommonJS module for tests.
(function (root) {
  "use strict";

  var MIN = 60000;

  // ---------------- news: public RSS feeds (each outlet's RSS terms: personal, non commercial reading) ----------------
  // Only the headline, its time and the outlet's name are shown; nothing is kept but the last answer.
  var FEEDS = {
    abc: { name: "ABC News", url: "https://www.abc.net.au/news/feed/45910/rss.xml" },
    "abc-justin": { name: "ABC News, just in", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
    "abc-sport": { name: "ABC Sport", url: "https://www.abc.net.au/news/feed/2942460/rss.xml" },
    "abc-business": { name: "ABC Business", url: "https://www.abc.net.au/news/feed/51892/rss.xml" },
    sbs: { name: "SBS News", url: "https://www.sbs.com.au/news/topic/latest/feed" },
    guardian: { name: "The Guardian Australia", url: "https://www.theguardian.com/au/rss" },
    bbc: { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    rnz: { name: "RNZ", url: "https://www.rnz.co.nz/rss/national.xml" }
  };
  var FEED_DEFAULT = "abc";
  function feedOf(id) { return FEEDS[id] ? id : FEED_DEFAULT; }

  // the words a feed's markup may hold, as plain text (a headline is text, never markup)
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "-", mdash: "-", lsquo: "'", rsquo: "'", ldquo: "\"", rdquo: "\"", hellip: "...", eacute: "é" };
  function plain(s) {
    s = String(s || "");
    s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    s = s.replace(/<[^>]*>/g, " ");
    s = s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 31 && n < 0x110000 && n !== 0x7f ? (n > 0xffff ? String.fromCharCode(0xd800 + ((n - 0x10000) >> 10), 0xdc00 + ((n - 0x10000) & 0x3ff)) : String.fromCharCode(n)) : " ";
      }
      return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
    });
    // an em or en dash in a headline reads as a plain dash on the TV
    return s.replace(/[–—]/g, "-").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  }
  function tagText(block, tag) {
    var m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i").exec(block);
    return m ? plain(m[1]) : "";
  }
  // RSS 2.0 <item> and Atom <entry>: the headline and when it was published (ms, or 0 when unknown),
  // newest first (headlines with no time keep their place after those with one)
  function parseRss(text, max) {
    text = String(text || "");
    max = max || 12;
    var out = [], seen = {}, re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi, m;
    while ((m = re.exec(text)) && out.length < 40) {
      var block = m[0], title = tagText(block, "title");
      if (!title || title.length < 4 || seen[title.toLowerCase()]) continue;
      seen[title.toLowerCase()] = 1;
      var when = tagText(block, "pubDate") || tagText(block, "dc:date") || tagText(block, "updated") || tagText(block, "published");
      var at = when ? Date.parse(when) : NaN;
      out.push({ title: title.length > 160 ? title.slice(0, 157).replace(/\s+\S*$/, "") + "..." : title, at: isFinite(at) ? at : 0, i: out.length });
    }
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0) || a.i - b.i; });
    return out.slice(0, max).map(function (x) { return { title: x.title, at: x.at }; });
  }
  // "12 min", "3 h", "Yesterday": how long ago, plain
  function ago(at, now) {
    if (!at) return "";
    var m = Math.round(((now || Date.now()) - at) / MIN);
    if (m < 1) return "Just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    return h < 48 ? "Yesterday" : Math.round(h / 24) + " days ago";
  }

  // ---------------- the sources the loader knows ----------------
  // key(w): which answer a widget on the home needs (widgets with the same key share one request);
  // every: how long an answer is good for; get(h, id): one request, through the relay or straight
  // from the TV, answering the reader's value (or throwing).
  var SOURCES = {
    news: {
      key: function (w) { return feedOf((w.opts || {}).feed); },
      every: function () { return 15 * MIN; },
      relay: true,
      get: function (h, id) {
        return h.relay("news", id).then(function (text) {
          var items = parseRss(text, 12);
          if (!items.length) throw new Error("empty");
          return items;
        });
      }
    }
  };

  // ---------------- the loader ----------------
  // h: { widgets(): [{kind, opts}] on the home now, canRelay(): whether this TV has a relay,
  //      relay(src, id): a Promise of the source's text through it, json(url): a Promise of JSON from a
  //      source that allows pages,
  //      load(): the last answers kept on this TV, save(o), changed(): the widgets draw again,
  //      now(): ms, hidden(): true while the home is not on screen }
  function Loader(h) {
    var web = {}, busy = {}, timer = null;
    try { var kept = h.load && h.load(); if (kept && typeof kept === "object") Object.keys(SOURCES).forEach(function (s) { if (kept[s] && typeof kept[s] === "object") web[s] = kept[s]; }); } catch (e) {}
    function now() { return h.now ? h.now() : Date.now(); }
    function wanted() {
      var out = {};
      (h.widgets() || []).forEach(function (w) {
        var src = SOURCES[w && w.kind];
        if (!src) return;
        var id = src.key(w, h);
        if (id === null || id === undefined) return;
        out[w.kind + "\n" + id] = { src: w.kind, id: String(id) };
      });
      return out;
    }
    function put(src, id, rec) {
      web[src] = web[src] || {};
      web[src][id] = rec;
      try { if (h.save) h.save(web); } catch (e) {}
      try { if (h.changed) h.changed(src, id); } catch (e2) {}
    }
    function ask(src, id) {
      var S = SOURCES[src], k = src + "\n" + id;
      if (busy[k]) return busy[k];
      if (S.relay && !(h.canRelay && h.canRelay())) { put(src, id, { ok: false, at: now(), err: "relay" }); return null; }
      busy[k] = S.get(h, id).then(function (v) {
        delete busy[k];
        put(src, id, { ok: true, at: now(), v: v });
      }, function (e) {
        delete busy[k];
        var last = web[src] && web[src][id];
        // a failed ask keeps the last good answer (marked stale) and tries again after a short wait
        if (last && last.ok) { last.stale = true; last.retry = now(); put(src, id, last); }
        else put(src, id, { ok: false, at: now(), err: e && e.message === "empty" ? "empty" : "failed" });
      });
      return busy[k];
    }
    function due(src, id) {
      var rec = web[src] && web[src][id], t = now();
      if (!rec) return true;
      if (!rec.ok || rec.stale) return t - (rec.retry || rec.at) >= 3 * MIN;
      return t - rec.at >= SOURCES[src].every(rec.v, t);
    }
    function tick() {
      if (h.hidden && h.hidden()) return [];
      var w = wanted(), jobs = [];
      Object.keys(w).forEach(function (k) { if (due(w[k].src, w[k].id)) { var p = ask(w[k].src, w[k].id); if (p) jobs.push(p); } });
      return jobs;
    }
    return {
      // one look now, then every 30 seconds (each source keeps to its own refresh)
      start: function () { if (!timer) { tick(); timer = setInterval(tick, 30000); } return this; },
      stop: function () { if (timer) clearInterval(timer); timer = null; },
      tick: function () { return Promise.all(tick()); },
      data: function () { return web; },
      wanted: function () { return Object.keys(wanted()); }
    };
  }

  var API = {
    FEEDS: FEEDS, FEED_DEFAULT: FEED_DEFAULT, SOURCES: SOURCES,
    feedOf: feedOf, plain: plain, parseRss: parseRss, ago: ago,
    loader: function (h) { return Loader(h); }
  };
  root.CouchWidgetWeb = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
