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

  // ---------------- scores: ESPN's public scoreboards (free, no key, open to web pages) ----------------
  // Unofficial and undocumented: ESPN publishes no terms for them and may change them. Each TV asks for
  // its own household's viewing, one league per request, and shows only teams and scores.
  var ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  var LEAGUES = {
    afl: { name: "AFL", url: ESPN + "australian-football/afl/scoreboard" },
    nrl: { name: "NRL", url: ESPN + "rugby-league/3/scoreboard" },
    aleague: { name: "A-League", url: ESPN + "soccer/aus.1/scoreboard" },
    epl: { name: "Premier League", url: ESPN + "soccer/eng.1/scoreboard" },
    nba: { name: "NBA", url: ESPN + "basketball/nba/scoreboard" },
    bbl: { name: "Big Bash", url: ESPN + "cricket/8044/scoreboard" },
    cricket: { name: "Cricket", url: "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&lang=en&region=au", header: true }
  };
  var LEAGUE_DEFAULT = "nrl";
  function leagueOf(id) { return LEAGUES[id] ? id : LEAGUE_DEFAULT; }
  function hex(c) { return /^#?[0-9a-f]{6}$/i.test(String(c || "")) ? "#" + String(c).replace("#", "").toLowerCase() : ""; }
  function cut(s, n) { s = plain(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") : s; }
  function stateOf(s) { return s === "in" || s === "post" ? s : "pre"; }
  function side(name, abbr, colour, score, win, home) {
    return { name: cut(name, 22), abbr: cut(abbr, 5).toUpperCase(), colour: hex(colour), score: plain(score === undefined || score === null ? "" : String(score)).slice(0, 40), win: win === true, home: !!home };
  }
  // one league's games: { league, round, games: [{ id, at, state, detail, teams: [home, away] }] }
  // detail: ESPN's own short line ("Final", "Q3 4:12", "62'", "Australia need 224 runs")
  function parseScores(j, id) {
    id = leagueOf(id);
    j = j && typeof j === "object" ? j : {};
    var L = LEAGUES[id], games = [];
    if (L.header) {
      // cricket: the matches on now or lately that an Australian household follows: Australia's first,
      // then other internationals, then the Australian competitions (Big Bash, Sheffield Shield, the
      // one day cup); other countries' domestic matches are left out
      (((j.sports || [])[0] || {}).leagues || []).forEach(function (lg) {
        var local = /big bash|bbl|sheffield|marsh|wbbl|australia/i.test(String(lg.name || "") + " " + String(lg.shortName || ""));
        (lg.events || []).forEach(function (e) {
          var fs = e.fullStatus || {}, ty = fs.type || {}, cs = e.competitors || [];
          if (cs.length < 2) return;
          var teams = cs.slice(0, 2).map(function (c) { return side(c.displayName, c.abbreviation, c.color, c.score, c.winner, c.homeAway === "home"); });
          var intl = e["class"] && e["class"].internationalClassId && e["class"].internationalClassId !== "0";
          var aus = teams.some(function (t) { return /^australia/i.test(t.name); });
          if (!intl && !local) return;
          games.push({ id: String(e.id || ""), at: Date.parse(e.date) || 0, state: stateOf(ty.state || e.status), detail: cut(fs.summary || e.summary || ty.shortDetail || "", 60),
            title: cut(e.title || "", 30), teams: teams, rank: aus ? 0 : intl ? 1 : 2 });
        });
      });
      games.sort(function (a, b) { return a.rank - b.rank || b.at - a.at; });
    } else {
      (j.events || []).forEach(function (e) {
        var c = (e.competitions || [])[0] || {}, cs = c.competitors || [], st = (e.status || {}).type || {};
        if (cs.length < 2) return;
        // home first, the way Australian codes say a game ("Roosters v Knights")
        cs = cs.slice(0, 2).sort(function (a, b) { return (a.homeAway === "home" ? 0 : 1) - (b.homeAway === "home" ? 0 : 1); });
        games.push({ id: String(e.id || ""), at: Date.parse(e.date) || 0, state: stateOf(st.state), detail: cut(st.shortDetail || st.detail || "", 40),
          teams: cs.map(function (x) { var t = x.team || {}; return side(t.shortDisplayName || t.displayName, t.abbreviation, t.color, x.score, x.winner, x.homeAway === "home"); }) });
      });
      games.sort(function (a, b) { return a.at - b.at; });
    }
    games.forEach(function (g) { delete g.rank; if (g.state === "pre") g.teams.forEach(function (t) { t.score = ""; }); });
    var wk = j.week && isFinite(j.week.number) ? +j.week.number : 0;
    return { league: L.name, round: wk && (id === "afl" || id === "nrl") ? "Round " + wk : "", games: games.slice(0, 16) };
  }
  // the games in the order a widget shows them: live first, then the household's team, then the
  // latest results, then what is next
  function scoreOrder(games, team, now) {
    team = String(team || "").toLowerCase();
    var mine = function (g) { return !!team && g.teams.some(function (t) { return t.name.toLowerCase().indexOf(team) >= 0 || t.abbr.toLowerCase() === team; }); };
    var rank = function (g) { return g.state === "in" ? 0 : mine(g) ? 1 : g.state === "post" ? 2 : 3; };
    return games.slice().sort(function (a, b) {
      var d = rank(a) - rank(b);
      if (d) return d;
      return a.state === "post" ? b.at - a.at : a.at - b.at;
    }).map(function (g) { g = JSON.parse(JSON.stringify(g)); g.mine = mine(g); return g; });
  }
  var WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // when a game starts, in the TV's own time: "7:40pm", "Tomorrow 7:40pm", "Sat 7:40pm", "17 Mar"
  function kickoff(at, now, h24) {
    if (!at) return "";
    var d = new Date(at), n = new Date(now || Date.now());
    var hm = h24 ? d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2) : ((d.getHours() % 12) || 12) + ":" + ("0" + d.getMinutes()).slice(-2) + (d.getHours() < 12 ? "am" : "pm");
    var day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
    if (day === 0) return hm;
    if (day === 1) return "Tomorrow " + hm;
    if (day > 1 && day < 7) return WEEKDAY[d.getDay()] + " " + hm;
    return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
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
    },
    sports: {
      key: function (w) { return leagueOf((w.opts || {}).league); },
      // every 2 minutes while a game is on or about to start, else every 15
      every: function (v, t) {
        var soon = (v && v.games || []).some(function (g) { return g.state === "in" || (g.state === "pre" && g.at - t < 20 * MIN && g.at - t > -3 * 60 * MIN); });
        return (soon ? 2 : 15) * MIN;
      },
      get: function (h, id) { return h.json(LEAGUES[id].url).then(function (j) { return parseScores(j, id); }); }
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
    LEAGUES: LEAGUES, LEAGUE_DEFAULT: LEAGUE_DEFAULT, leagueOf: leagueOf, parseScores: parseScores, scoreOrder: scoreOrder, kickoff: kickoff,
    loader: function (h) { return Loader(h); }
  };
  root.CouchWidgetWeb = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
