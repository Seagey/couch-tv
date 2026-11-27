// Live TV: Samsung TV Plus's free channels, played inside couch-tv ("live_tv" in this TV's entry in
// config.json, docs/SAMSUNG.md). Samsung's own TV Plus app froze couch-tv behind it, so Samsung's Home
// button could not bring couch-tv back (a QN90F in India, Nov 2026). Here couch-tv stays the app in
// front, and tizen.js's Home watch keeps working.
//
// tizen.js shows the tile and calls CouchLiveTV.open(). The bridge hands the channel list
// (/api/livetv/channels, bridge/livetv.py); https://jmp2.uk/stvp-<id> sends the player on to the
// channel's own stream (HLS). The bridge also hands that stream with only its sharpest picture
// (/api/livetv/play/<id>.m3u8), so it is sharp from the start. Samsung's own player (AVPlay) plays
// that first, then the stream itself; a <video> is the last try.
// Up and Down change channel within the category, OK shows the channel list, Left and Right change
// the category (News, Sports, ...), Back returns to the home. Home settings, Samsung behaviour, Live
// TV arrows swaps them ("couch.home.livekeys" 2, tizen.js): Left and Right change channel, Up and Down
// bring up the list. A short tour of the buttons shows the first time, and again after a swap.
(function () {
  "use strict";
  var S = window.COUCH_TIZEN || {};
  var CFG = S.live_tv;
  if (!CFG || typeof CFG !== "object") return;
  var GROUPS = CFG.groups || [];
  var STREAM = "https://jmp2.uk/stvp-";
  var KEEP_LAST = "couch.livetv.last", KEEP_LIST = "couch.livetv.channels", KEEP_CAT = "couch.livetv.category";
  var KEEP_TOUR = "couch.livetv.tour", KEEP_KEYS = "couch.home.livekeys", KEEP_START = "couch.home.livestart";
  var BACK = 10009, LEFT = 37, UP = 38, RIGHT = 39, DOWN = 40, OK = 13;
  var ROWS = 8;   // channel list rows on screen, under the category

  var opts = {}, on = false, list = [], cur = null, av = false, steps = [], token = 0, started = false;
  var box = null, video = null, avObj = null, banner = null, note = null, menu = null, cats = null, tour = null, menuAt = -1;
  var bannerT = null, menuT = null, waitT = null, infoT = null, tourT = null, chanKeys = {};
  var cat = kept(KEEP_CAT) || "";   // the category Up and Down go through; "" is every channel

  function log(text) { try { if (opts.log) opts.log(text); } catch (e) {} }
  function kept(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function keep(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function swapped() { return kept(KEEP_KEYS) === "2"; }
  function another() { return (swapped() ? "Left or Right" : "Up or Down") + " for another channel."; }
  // "groups" picks this country's channels; other countries' (Home settings, Samsung behaviour, Live
  // TV countries; the bridge marks them with "region") all come, by group ("USA · Sports")
  function allowed(c) { return !GROUPS.length || GROUPS.indexOf(c.group) >= 0 || !!c.region; }
  function find(id, within) {
    var l = within || list;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return i;
    return -1;
  }
  // the categories, in the bridge's order: this country's groups by channel number, then each other
  // country's groups
  function categories() {
    var out = [""], seen = {};
    list.forEach(function (c) { if (c.group && !seen[c.group]) { seen[c.group] = true; out.push(c.group); } });
    return out;
  }
  function view() {
    if (!cat) return list;
    var v = list.filter(function (c) { return c.group === cat; });
    return v.length ? v : list;
  }
  function setCat(c) { cat = c; keep(KEEP_CAT, c); }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function show(n, yes) { if (n) n.style.display = yes ? "" : "none"; }
  function logo(c, parent) {
    if (!c.logo || !/^https:\/\//.test(c.logo)) return el("span", "lt-logo", parent);
    var img = el("img", "lt-logo", parent);
    img.setAttribute("alt", "");
    img.setAttribute("src", c.logo);
    return img;
  }

  function setList(chans) {
    var fresh = (chans || []).filter(function (c) { return c && typeof c.id === "string" && allowed(c); });
    if (!fresh.length) return;
    list = fresh;
    keep(KEEP_LIST, JSON.stringify(list));
    if (cur) {
      var i = find(cur.id);
      if (i >= 0) cur = list[i];
    }
  }
  try { setList(JSON.parse(kept(KEEP_LIST) || "[]")); } catch (e) {}

  function loadList(then) {
    if (!opts.bridge) { then(); return; }
    var x = new XMLHttpRequest(), q = [];
    if (opts.tv) q.push("tv=" + encodeURIComponent(opts.tv));
    x.open("GET", opts.bridge + "/api/livetv/channels" + (q.length ? "?" + q.join("&") : ""));
    if (opts.key) x.setRequestHeader("Authorization", "Bearer " + opts.key);
    x.timeout = 40000;   // the bridge may have to read the whole list first (2 MB)
    x.onload = function () {
      try { setList(JSON.parse(x.responseText).channels); } catch (e) { log("channel list unreadable"); }
      if (cat && categories().indexOf(cat) < 0) setCat("");   // a category that is gone
      then();
    };
    x.onerror = x.ontimeout = function () { log("channel list: bridge not reachable"); then(); };
    x.send();
  }

  // ---------- what is on screen ----------
  function say(text) {
    if (!note) return;
    note.textContent = text || "";
    show(note, !!text);
  }
  function showBanner() {
    if (!banner || !cur) return;
    banner.textContent = "";
    logo(cur, banner);
    if (cur.chno) el("div", "lt-no", banner, String(cur.chno));
    var words = el("div", "lt-words", banner);
    el("div", "lt-name", words, cur.name || "");
    if (cur.now) el("div", "lt-now", words, cur.now);
    show(banner, true);
    clearTimeout(bannerT);
    bannerT = setTimeout(function () { show(banner, false); }, 3000);
  }
  function drawMenu() {
    var v = view();
    menu.textContent = "";
    cats.textContent = "";
    var all = categories();
    if (all.length > 1) el("div", "lt-arrow", cats, "\u25C0");
    el("div", "lt-cat", cats, (cat || "All channels") + "  (" + v.length + ")");
    if (all.length > 1) el("div", "lt-arrow", cats, "\u25B6");
    var first = Math.max(0, Math.min(menuAt - (ROWS >> 1), v.length - ROWS));
    for (var i = first; i < Math.min(v.length, first + ROWS); i++) {
      var c = v[i], row = el("div", "lt-row" + (i === menuAt ? " on" : ""), menu);
      logo(c, row);
      el("div", "lt-no", row, c.chno ? String(c.chno) : "");
      var words = el("div", "lt-words", row);
      el("div", "lt-name", words, c.name || c.id);
      if (c.now) el("div", "lt-now", words, c.now);
    }
  }
  function menuOpen() { return menuAt >= 0; }
  function openMenu() {
    if (!list.length) { say("No channel list yet. " + (swapped() ? "Left or Right" : "Up or Down") + " changes channel once it has come."); return; }
    menuAt = cur ? Math.max(0, find(cur.id, view())) : 0;
    show(banner, false);
    drawMenu();
    show(menu, true);
    show(cats, true);
    menuIdle();
  }
  function closeMenu() { menuAt = -1; clearTimeout(menuT); show(menu, false); show(cats, false); }
  function menuIdle() { clearTimeout(menuT); menuT = setTimeout(closeMenu, 20000); }
  function moveMenu(d) { var n = view().length; menuAt = (menuAt + d + n) % n; drawMenu(); menuIdle(); }
  // Left and Right: the next category, on the channel playing if it is in it
  function moveCat(d) {
    var all = categories();
    if (all.length < 2) return;
    setCat(all[(Math.max(0, all.indexOf(cat)) + d + all.length) % all.length]);
    menuAt = cur ? Math.max(0, find(cur.id, view())) : 0;
    drawMenu();
    menuIdle();
  }

  // ---------- playing ----------
  // AVPlay first, told to start on the best picture and never drop to the worst. A <video> started TV
  // Plus's streams on their first (lowest, 320x180) picture and climbed slowly, so a QN90F looked like
  // 480p or 720p on every channel (27 Nov 2026), although they go up to 1920x1080.
  var AV_START = "STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST";
  function avplay() { return (window.webapis && window.webapis.avplay) || null; }
  // AVPlay draws under the page, so the page has to be see-through over the picture: the home behind
  // is hidden while it plays (tizen.css, html.lt-av)
  function avMode(yes) {
    try { document.documentElement.classList[yes ? "add" : "remove"]("lt-av"); } catch (e) {}
    if (box) box.className = yes ? "av" : "";
  }
  function stopPlayers() {
    token++;   // whatever a player says while it is let go of, or later, is about nothing playing now
    clearTimeout(infoT);
    if (video) {
      try { video.pause(); } catch (e) {}
      video.removeAttribute("src");
      try { video.load(); } catch (e) {}   // lets go of the stream and the decoder
    }
    if (av) {
      av = false;
      // AVPlay is one player for the whole app: its last listener would hear the stop as the next one's
      try { webapis.avplay.setListener({}); } catch (e) {}
      try { webapis.avplay.stop(); } catch (e) {}
      try { webapis.avplay.close(); } catch (e) {}
    }
    show(avObj, false);
    avMode(false);
  }
  function stop() {
    clearTimeout(waitT);
    stopPlayers();
  }
  // the picture size, for the debug log (build.py --log-url): how a test sees the quality
  function picture() {
    try {
      if (av) {
        var info = webapis.avplay.getCurrentStreamInfo() || [];
        for (var i = 0; i < info.length; i++) {
          if (info[i].type === "VIDEO") {
            var x = JSON.parse(info[i].extra_info || "{}");
            return (x.Width || x.width) + "x" + (x.Height || x.height);
          }
        }
        return "?";
      }
      return video ? video.videoWidth + "x" + video.videoHeight : "?";
    } catch (e) { return "?"; }
  }
  function playing(t, ch, how) {
    if (t !== token || !on) return;
    started = true;
    clearTimeout(waitT);
    say("");
    log("playing " + ch.id + " (" + how + ") " + picture());
    clearTimeout(infoT);
    infoT = setTimeout(function () { if (t === token && on) log("picture " + ch.id + " " + picture()); }, 10000);
  }
  function notPlaying(ch) {
    log("did not play " + ch.id);
    say("This channel did not play. " + another());
  }
  // the ways to play a channel, sharpest first: the bridge's playlist with only the best picture,
  // then the stream itself, in AVPlay; a <video> last
  function ways(ch) {
    var w = [], direct = STREAM + ch.id;
    if (avplay()) {
      if (opts.bridge) w.push({ av: true, url: opts.bridge + "/api/livetv/play/" + encodeURIComponent(ch.id) + ".m3u8" +
                                (opts.key ? "?key=" + encodeURIComponent(opts.key) : "") });
      w.push({ av: true, url: direct });
    }
    w.push({ av: false, url: direct });
    return w;
  }
  function next(ch) {
    var way = steps.shift(), t = ++token;   // a late word from the way before is not this one's
    if (!way) { notPlaying(ch); return; }
    if (way.av) playAv(t, ch, way.url); else playVideo(t, ch, way.url);
  }
  // one way failed: the next one tries, then the channel says it did not play
  function failed(t, ch, how) {
    if (t !== token || !on) return;
    log(how + " refused " + ch.id);
    stopPlayers();
    next(ch);
  }
  function playAv(t, ch, url) {
    var A = avplay();
    av = true;
    if (!avObj) {
      avObj = el("object", "lt-av", null);
      avObj.setAttribute("type", "application/avplayer");
      box.insertBefore(avObj, box.firstChild);
    }
    show(video, false);   // an opaque <video> later in the page would cover the picture
    show(avObj, true);
    avMode(true);
    try {
      A.open(url);
      A.setDisplayRect(0, 0, 1920, 1080);   // the page is 1920 wide (boot.html's viewport)
      try { A.setStreamingProperty("ADAPTIVE_INFO", AV_START); } catch (e) { log("AVPlay ADAPTIVE_INFO: " + e); }
      // start after 4 seconds of picture (the least Samsung allows) rather than AVPlay's own ~10
      try { A.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 4); } catch (e) {}
      // the listener goes on once this stream is prepared: an error the last stream still had queued
      // would otherwise reach it and fail this channel (prepareAsync reports this one's own failure)
      A.prepareAsync(function () {
        if (t !== token || !on || !av) return;
        A.setListener({
          onerror: function (e) { log("AVPlay error " + e); failed(t, ch, "AVPlay"); },
          onstreamcompleted: function () { failed(t, ch, "AVPlay"); }   // a live stream does not end
        });
        try { A.play(); } catch (e) { failed(t, ch, "AVPlay"); return; }
        playing(t, ch, "AVPlay");
        setTimeout(function () { liveEdge(t, ch); }, 2000);
      }, function (e) { log("AVPlay prepare: " + e); failed(t, ch, "AVPlay"); });
    } catch (e) {
      log("AVPlay: " + e);
      failed(t, ch, "AVPlay");
    }
  }
  // A TV Plus channel here is the same stream, second for second, as Samsung's own app plays; a player
  // that starts far back in its minute-long window is what makes it feel behind. Further back than
  // LIVE_BEHIND: jump to LIVE_AT before the newest picture (three 6 second pieces, as HLS asks).
  var LIVE_BEHIND = 25000, LIVE_AT = 18000;
  function liveEdge(t, ch) {
    if (t !== token || !on || !av) return;
    try {
      var A = webapis.avplay;
      if (A.getState() !== "PLAYING") return;   // still buffering, or let go of: seekTo would refuse
      var range = String(A.getStreamingProperty("GET_LIVE_DURATION") || "").split("|");
      var end = Number(range[1]), start = Number(range[0]), at = A.getCurrentTime();
      if (!(end > 0) || !(at >= 0)) return;
      log("live " + ch.id + ": " + Math.round((end - at) / 1000) + " s behind the newest picture");
      if (end - at > LIVE_BEHIND) {
        A.seekTo(Math.max(start || 0, end - LIVE_AT), function () { log("live " + ch.id + ": caught up"); },
                 function (e) { log("live " + ch.id + ": could not catch up " + e); });
      }
    } catch (e) { log("live " + ch.id + ": " + e); }
  }
  function playVideo(t, ch, url) {
    show(video, true);
    video.setAttribute("src", url);
    try {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});   // a refused stream also fires "error"
    } catch (e) {}
  }
  function play(ch) {
    stop();
    cur = ch;
    steps = ways(ch);
    started = false;
    keep(KEEP_LAST, ch.id);
    say("");
    showBanner();
    next(ch);
    // nothing after 25 seconds: say so, and let it keep trying
    waitT = setTimeout(function () {
      if (cur === ch && on && !started) say("This channel has not started. " + another());
    }, 25000);
    log("channel " + ch.id + " " + (ch.name || ""));
  }
  function step(d) {
    var v = view();
    if (!v.length) return;
    var i = cur ? find(cur.id, v) : -1;
    play(v[i < 0 ? (d > 0 ? 0 : v.length - 1) : (i + d + v.length) % v.length]);
  }
  // Home settings, Samsung behaviour, Live TV opens on: "" the last channel watched, "home" this
  // country's channels, or another country's code. A country picked: the last channel watched if it is
  // one of that country's, else its first channel, with the category switched to it if need be.
  function inStart(c, where) { return where === "home" ? !c.region : c.region === where; }
  function firstChannel() {
    var last = kept(KEEP_LAST), where = kept(KEEP_START) || "";
    var at = last && list.length ? find(last) : -1;
    if (where && list.length) {
      if (at >= 0 && inStart(list[at], where)) return list[at];
      for (var i = 0; i < list.length; i++) {
        if (inStart(list[i], where)) {
          if (cat && view().indexOf(list[i]) < 0) setCat(list[i].group || "");
          return list[i];
        }
      }
    }
    if (last && (!list.length || at >= 0)) return list[at] || { id: last, name: "" };
    return list[0] || null;
  }

  function build() {
    box = el("div", null, document.body);
    box.id = "livetv";
    video = el("video", null, box);
    video.setAttribute("autoplay", "");
    video.addEventListener("error", function () { if (cur && !av && video.getAttribute && video.getAttribute("src")) failed(token, cur, "video"); });
    video.addEventListener("playing", function () { if (cur && !av) playing(token, cur, "video"); });
    banner = el("div", "lt-banner", box);
    note = el("div", "lt-note", box);
    cats = el("div", "lt-cats", box);
    menu = el("div", "lt-menu", box);
    show(banner, false); show(note, false); show(menu, false); show(cats, false);
  }

  // the buttons, once per arrow layout; any button puts it away (and still does its job)
  function showTour() {
    var want = swapped() ? "2" : "1";
    if (kept(KEEP_TOUR) === want) return;
    keep(KEEP_TOUR, want);
    var lines = swapped()
      ? [["\u25C0 \u25B6", "Change channel"], ["\u25B2 \u25BC", "Channel list and categories"],
         ["OK", "Play the channel picked in the list"], ["Back", "Close the list, then back to the home"]]
      : [["\u25B2 \u25BC", "Change channel"], ["\u25C0 \u25B6", "Change category"],
         ["OK", "Channel list, then play the one picked"], ["Back", "Close the list, then back to the home"]];
    tour = el("div", "lt-tour", box);
    el("div", "lt-tour-head", tour, "Live TV buttons");
    lines.forEach(function (l) {
      var row = el("div", "lt-tour-row", tour);
      el("span", "lt-tour-key", row, l[0]);
      el("span", "lt-tour-do", row, l[1]);
    });
    el("div", "lt-tour-foot", tour, "CH + and CH \u2212 change channel too. Home settings, Samsung behaviour swaps the arrows.");
    tourT = setTimeout(hideTour, 12000);
  }
  function hideTour() {
    clearTimeout(tourT);
    if (tour && tour.parentNode) tour.parentNode.removeChild(tour);
    tour = null;
  }

  function channelKeys(yes) {
    try {
      ["ChannelUp", "ChannelDown"].forEach(function (k) {
        if (yes) { tizen.tvinputdevice.registerKey(k); chanKeys[k] = tizen.tvinputdevice.getKey(k).code; }
        else tizen.tvinputdevice.unregisterKey(k);
      });
    } catch (e) {}
    if (!yes) chanKeys = {};
  }

  function open(o) {
    if (on) return true;
    opts = o || {};
    on = true;
    menuAt = -1;
    build();
    channelKeys(true);
    // the home is behind the picture: its clips, idle clock and timers rest as with an app in front
    try { if (window.tv && window.tv.pause) window.tv.pause(); } catch (e) {}
    showTour();
    var first = firstChannel();
    if (first) play(first);
    else say("Getting the channels...");
    loadList(function () {
      if (!on) return;
      // nothing playing yet, or the channel it started on is no longer in the list: the first one
      if (list.length && (!cur || find(cur.id) < 0)) play(firstChannel());
      else if (!cur) say("No channels. Check the home computer is on.");
      else if (banner && banner.style.display !== "none") showBanner();   // now with its name
    });
    return true;
  }

  function close(away) {
    if (!on) return;
    on = false;
    stop();
    clearTimeout(bannerT); clearTimeout(menuT);
    hideTour();
    channelKeys(false);
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = video = avObj = banner = note = menu = cats = tour = null;
    menuAt = -1;
    log("closed");
    // back on the home now; hidden, tizen.js wakes the home when it is shown again
    if (!away) try { if (window.tv && window.tv.resume) window.tv.resume(); } catch (e) {}
  }

  // Loaded after tizen.js, before app.js: with the picture up, the home must not move behind it.
  document.addEventListener("keydown", function (e) {
    if (!on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var k = e.keyCode;
    if (tour) hideTour();
    if (k === BACK || e.key === "Escape" || e.key === "GoBack" || e.key === "XF86Back") {
      if (menuOpen()) closeMenu(); else close(false);
    } else if (k === UP || k === DOWN || k === LEFT || k === RIGHT) {
      var vert = k === UP || k === DOWN, back = k === UP || k === LEFT;
      if (menuOpen()) { if (vert) moveMenu(back ? -1 : 1); else moveCat(back ? -1 : 1); }
      else if (vert !== swapped()) step(back ? -1 : 1);   // the channel arrows: Up/Down, or Left/Right swapped
      else if (swapped()) openMenu();                      // swapped: Up and Down bring up the list
      else { openMenu(); if (menuOpen()) moveCat(back ? -1 : 1); }   // Left/Right: the list, on the next category
    } else if (k === chanKeys.ChannelUp || k === chanKeys.ChannelDown) {
      closeMenu();
      step(k === chanKeys.ChannelUp ? 1 : -1);
    } else if (k === OK || e.key === "Enter") {
      if (!menuOpen()) openMenu();
      else { var c = view()[menuAt]; closeMenu(); if (c && (!cur || c.id !== cur.id)) play(c); else showBanner(); }
    }
  }, true);
  // Samsung's Home, or another app: the stream stops, as Sky's window closes
  document.addEventListener("visibilitychange", function () { if (document.hidden && on) close(true); });

  window.CouchLiveTV = { open: open, close: function () { close(false); }, isOpen: function () { return on; } };
})();
