// The detail layer: what opens when OK is pressed on a widget (couch-tv Studio v10). The widget grows
// into a sheet over the home, the way the wall tablet's cards do (home-hub wall/app.js openSheet:
// the card's own box grows to the sheet with one transform, the words fade in after it, Back shrinks
// it back into the card). On a TV it is drawn for 3 m away: words 25 px and up, one focus ring, the
// remote moves by geometry the way the home does (GRID.md, Focus), and Back always closes it.
//
// What a layer shows comes from the same places the widget does (widgets.js kit): demo data in couch-tv
// Studio, the TV's own data on a TV, or the widget's setup record (widget-caps.js) when the TV has
// nothing real yet. Never pretend data on a TV. What a layer does goes through design.js (api.act:
// the app.js hooks, the same ones a widget's own buttons use) or Home Assistant through the
// launcher (api.ha). In couch-tv Studio nothing is switched: the layer says so.
//
// Built element by element, never from markup. ES5 on purpose: old Android TV WebViews.
(function () {
  "use strict";

  // which layer each widget kind opens ("setup" is its setup record)
  var LAYER = {
    clock: "timers", tallclock: "timers", glassclock: "timers", analog: "timers", flipclock: "timers", wordclock: "timers", timer: "timers",
    solar: "forecast", worldclock: "world", date: "calendar", month: "calendar", agenda: "calendar",
    weather: "forecast", bigtemp: "forecast", hourly: "forecast", week: "forecast", rain: "forecast", uv: "forecast", sun: "forecast",
    moon: "moon", air: "air", surf: "surf",
    photo: "photos", slideshow: "photos", mosaic: "photos", artframe: "photos", memory: "photos",
    keep: "keep", keeprow: "keep", upnext: "keep", folder: "folder", nowplaying: "player",
    aircon: "aircon", scenes: "scenes", controls: "controls", camera: "camera", doorbell: "camera",
    card: "cards", news: "news", sports: "sports",
    picks: "setup", queue: "setup", speakers: "setup", energy: "setup", sensor: "setup", battery: "setup",
    note: "note", list: "list", stocks: "setup", commute: "setup", wifi: "wifi", guide: "guide", screentime: "screentime"
  };
  var TITLE = { timers: "Timers", forecast: "Forecast", world: "World clocks", calendar: "Calendar", moon: "Moon", air: "Air quality", surf: "Surf",
    photos: "Photos", keep: "Keep watching", folder: "Apps", player: "Now playing", aircon: "Aircon", scenes: "Scenes", controls: "Control Centre",
    camera: "Camera", cards: "Custom cards", news: "Headlines", sports: "Scores", setup: "Set up",
    note: "Family note", list: "List", wifi: "Guest Wi-Fi", guide: "House guide", screentime: "Screen time" };
  // the smart home and music widgets' own layers (group C): set here, beside the table above
  LAYER.energy = "energy"; LAYER.sensor = "sensor"; LAYER.speakers = "speakers"; LAYER.queue = "queue";
  TITLE.energy = "Energy"; TITLE.sensor = "Sensor"; TITLE.speakers = "Speakers"; TITLE.queue = "Up next";
  // the web widgets' own layers (widget-web.js)
  LAYER.stocks = "stocks"; TITLE.stocks = "Markets";
  LAYER.commute = "commute"; TITLE.commute = "Commute";
  LAYER.picks = "picks"; TITLE.picks = "Picks for you";
  // Ask AI and From your AI (ask.js): Ask AI has its own layer; From your AI shows how to connect an agent
  LAYER.battery = "batteries"; TITLE.batteries = "Batteries";
  LAYER.ask = "ask"; TITLE.ask = "Ask AI"; LAYER.agent = "agent"; TITLE.agent = "From your AI";

  var K = null, S = null;   // the widgets.js kit; the open layer
  var STAGE = { w: 1920, h: 1080 }, PANEL = { left: 80, top: 60, width: 1760, height: 960 };
  function kit() { return K || (K = window.CouchWidgets && window.CouchWidgets.kit); }
  function E() { return kit().E.apply(null, arguments); }
  function ic(n, s, c, st) { return kit().ic(n, s, c || "currentColor", st); }
  function px(n) { return Math.round(n) + "px"; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function op(o) { return (o && o.opts) || {}; }
  function reduced() {
    var de = document.documentElement;
    if (de.classList.contains("lighter")) return true;
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }

  // ---------------- the parts every layer uses ----------------
  // a focus stop: el, what OK does, and an optional name read by tests and the designer
  function F(el, fn, name) { el.classList.add("cwd-stop"); if (name) el.setAttribute("data-name", name); S.stops.push({ el: el, fn: fn || null }); return el; }
  function head(iconName, title, sub, tint) {
    var icon = E("div", "cwd-hic", tint ? "background:" + tint : "", [ic(iconName, 40, "#fff", "solid")]);
    S.subEl = E("div", "cwd-sub", "", [sub || ""]);
    return E("div", "cwd-head", "", [icon, E("div", "cwd-htext", "", [E("div", "cwd-title", "", [title]), S.subEl]), E("div", "cwd-back", "", [ic("back", 28, "currentColor"), "Back to close"])]);
  }
  function label(t) { return E("div", "cwd-label", "", [t]); }
  function msg(t, keep) {
    if (!S || !S.msgEl) return;
    S.msgEl.textContent = t || "";
    S.msgEl.classList.toggle("on", !!t);
    clearTimeout(S.msgT);
    if (t && !keep) S.msgT = setTimeout(function () { if (S && S.msgEl) S.msgEl.classList.remove("on"); }, 3600);
  }
  // In couch-tv Studio nothing in the house is switched, and the layer says so (once)
  function designerSays() { if (S.api.designer && !S.said) { S.said = true; msg("In couch-tv Studio this only shows what OK does. Nothing is switched."); return true; } return S.api.designer; }
  function btn(iconName, text, cls) { return E("div", "cwd-btn" + (cls ? " " + cls : ""), "", [iconName ? ic(iconName, 34, "currentColor", "solid") : null, text ? E("span", "", "", [text]) : null]); }
  function chip(text, on) { return E("div", "cwd-chip" + (on ? " on" : ""), "", [text]); }

  // ---------------- the layers: B[name](o, env) adds to S.body ----------------
  var B = {};

  // the setup record (widget-caps.js), for a widget with nothing real to show yet
  var STATUS = { works: ["Works on this TV", "#30d158"], setup: ["Set it up first", "#ffd60a"], computer: ["Needs a home computer", "#ff9f0a"], no: ["Not possible on this TV", "#8e8e93"], "not-built": ["Not on couch-tv yet", "#ff9f0a"] };
  B.setup = function (o, env) {
    // Ask AI and From your AI with nothing to show yet open their own layer, which sets them up
    if ((o.kind === "ask" || o.kind === "agent") && B[o.kind]) return B[o.kind](o, env || {});
    var kind = (S.from && S.from.getAttribute("data-setup")) || o.kind, C = window.CouchWidgetCaps, c = C && C.get(kind);
    S.panel.classList.add("cwd-setup");
    if (!c) { S.body.appendChild(head("info", "This widget", "It needs a newer couch-tv")); return; }
    // what each kind of TV needs for it (widget-caps.js platforms[p].need), the best of its group
    var RANK = ["works", "setup", "computer", "no"];
    var group = function (keys) { var best = 3; keys.forEach(function (k) { var p = c.platforms[k], i = RANK.indexOf(p ? p.need || (p.on === "yes" ? "works" : p.on === "no" ? "no" : "setup") : "no"); if (i >= 0 && i < best) best = i; }); return RANK[best]; };
    var WORD = { works: ["Works", "yes"], setup: ["Set up first", "setup"], computer: ["Needs a home computer", "partial"], no: ["Not possible", "no"] };
    var tvs = [["Google TV, Android TV, Fire TV", ["Google TV", "Android TV", "Fire OS"]], ["Samsung, LG, Philips, Panasonic", ["Tizen", "webOS", "Saphi", "TiVo OS", "My Home Screen"]],
      ["Hisense", ["VIDAA"]], ["Roku, Apple TV and others", ["Roku OS", "tvOS", "Vega OS", "Titan OS", "SmartCast", "Other"]]];
    var left = E("div", "cwd-col", "width:820px", [label("What it shows"), E("div", "cwd-text", "", [c.what]), label("What it needs"),
      E("div", "cwd-list", "", c.needs.map(function (n) { return E("div", "cwd-li", "", [E("i", "cwd-bullet"), E("span", "", "", [n])]); })),
      label("Which TVs"), E("div", "cwd-col", "", tvs.map(function (g) { var v = c.status === "not-built" ? ["Not possible", "no"] : WORD[group(g[1])]; return E("div", "cwd-tvrow", "", [E("span", "", "", [g[0]]), E("b", "cwd-tv-" + v[1], "", [v[0]])]); }))]);
    // the steps for this TV: the Android home has window.TVOS; a Hisense says so in its browser's name
    // (the designer and a browser preview, ?mock, stand in for the Android home)
    var sys = window.TVOS || S.api.designer || /[?&]mock\b/.test(location.search) ? "android" : /VIDAA|Hisense/i.test(navigator.userAgent || "") ? "vidaa" : "web";
    var steps = C.steps ? C.steps(kind, sys) : [c.setup.how], none = steps.length === 1 && /^Nothing to set up\.$/.test(steps[0]);
    // the pill says what this TV needs for it (works, set up first, a home computer, not possible)
    var mine = c.status === "not-built" ? "not-built" : group(C.groups && C.groups[sys] ? C.groups[sys] : ["Google TV"]), st = STATUS[mine] || STATUS.setup;
    S.body.appendChild(head("info", c.name, "", st[1]));
    S.subEl.appendChild(E("span", "cwd-pill", "background:" + st[1], [st[0]]));
    var right = E("div", "cwd-col", "flex:1;margin-left:64px;min-width:0", [label(c.status === "not-built" ? "What you can do" : none ? "Nothing to set up" : "How to set it up on this TV"),
      E("div", "cwd-list", "", steps.map(function (s, i) { return E("div", "cwd-li", "", [E("b", "", "flex:none;width:44px", [String(i + 1) + "."]), E("span", "", "", [s])]); })),
      none ? null : label("Until then"), none ? null : E("div", "cwd-text", "", [c.until]),
      label("OK on the widget"), E("div", "cwd-text", "", [c.ok])]);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:30px", [left, right]));
  };

  // timers: one at a time, kept on the TV (widgets.js Timer)
  var LABELS_ALL = ["Timer", "Oven", "Pizza", "Bath", "Homework", "Bedtime", "Tea"];
  B.timers = function (o) {
    var T = kit().Timer, now = kit().now();
    // a Timer widget with a name in its design (opts.label): a timer started from it has that name
    var own = o && o.kind === "timer" && op(o).label ? String(op(o).label).slice(0, 24) : "";
    var LABELS = own ? [own].concat(LABELS_ALL.filter(function (x) { return x !== own; })) : LABELS_ALL;
    S.body.appendChild(head("timer", "Timers", "It's " + kit().fmt12(now), "#ff9f0a"));
    var ringBox = E("div", "cwd-ringbox"), nameAt = 0;
    var drawRing = function () {
      while (ringBox.firstChild) ringBox.removeChild(ringBox.firstChild);
      var t = T.live(), left = t ? T.left(t) : 0, done = t && left <= 0;
      ringBox.appendChild(kit().ring(420, t ? (done ? 1 : left / t.total) : 0, null, done));
      ringBox.appendChild(E("div", "cwd-ringtext", "", [E("div", "cwd-huge", "font-size:" + (t && !done && left >= 3600000 ? 96 : 120) + "px" + (done ? ";color:#ff453a" : ""), [!t ? "0:00" : done ? "Done" : kit().mmss(left)]),
        E("div", "cwd-sub", "", [!t ? "No timer running" : done ? t.label + ": time's up" : t.label])]));
      S.subEl.textContent = "It's " + kit().fmt12(kit().now());
    };
    drawRing();
    S.tick = drawRing;
    var grid = E("div", "cwd-grid", "width:936px");
    [1, 3, 5, 10, 15, 20, 30, 60].forEach(function (m) {
      grid.appendChild(F(E("div", "cwd-tile", "width:204px;height:150px", [E("div", "cwd-big", "", [String(m)]), E("div", "cwd-small", "", [m === 1 ? "minute" : "minutes"])]), function () {
        T.start(m, LABELS[nameAt]); drawRing(); msg(LABELS[nameAt] + ": " + m + (m === 1 ? " minute" : " minutes") + ", counting down");
      }, m + " minutes"));
    });
    var nameBtn = btn("edit", "Name: Timer");
    var row = E("div", "cwd-row", "margin-top:24px", [F(btn("plus", "Add a minute"), function () { T.add(1); drawRing(); }, "Add a minute"),
      F(nameBtn, function () { nameAt = (nameAt + 1) % LABELS.length; nameBtn.lastChild.textContent = "Name: " + LABELS[nameAt]; var t = T.live(); if (t) { t.label = LABELS[nameAt]; T.put(t); drawRing(); } }, "Name"),
      F(btn("close", "Stop"), function () { T.cancel(); drawRing(); msg("Timer stopped"); }, "Stop")]);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:center;margin-top:20px", [ringBox, E("div", "cwd-col", "margin-left:90px", [label("Start a timer"), grid, row])]));
    S.start = T.live() ? 8 : 2;
  };

  // the forecast: 24 hours and 7 days (Open-Meteo, the same answer the widgets read)
  B.forecast = function (o, env) {
    var w = kit().weather(env);
    if (!w) return B.setup(o, env);
    S.body.appendChild(head(kit().wxIcon(w.code, w.is_day), w.place || "Forecast", w.temp + "° now, " + kit().wxWords(w.code).toLowerCase() + (w.hi !== undefined ? ". High " + w.hi + "°, low " + w.lo + "°" : ""), "#1b64b5"));
    var hours = w.hours || [], days = w.days || [];
    if (!hours.length && !days.length) { S.body.appendChild(E("div", "cwd-text", "margin-top:40px", ["The full forecast comes with the next weather update."])); return; }
    if (hours.length) {
      var track = E("div", "cwd-track");
      hours.forEach(function (h, i) {
        track.appendChild(F(E("div", "cwd-hour", "", [E("div", "cwd-small", "", [h.t]), ic(kit().wxIcon(h.code, !h.night), 54, "#fff", "solid"), E("div", "cwd-mid", "", [h.temp + "°"]),
          E("div", "cwd-rain", "", [h.pop >= 10 ? Math.round(h.pop) + "%" : ""])]), null, "hour " + i));
      });
      S.body.appendChild(label("Next 24 hours"));
      S.body.appendChild(E("div", "cwd-scroll", "height:236px", [track]));
    }
    if (days.length) {
      var lo = 99, hi = -99;
      days.forEach(function (d) { lo = Math.min(lo, d.lo); hi = Math.max(hi, d.hi); });
      var span = Math.max(6, hi - lo);
      S.body.appendChild(label("This week"));
      S.body.appendChild(E("div", "cwd-row", "", days.map(function (d, i) {
        var a = (d.lo - lo) / span * 100, z = (d.hi - lo) / span * 100;
        return F(E("div", "cwd-day", i ? "margin-left:16px" : "", [E("div", "cwd-mid", "font-size:32px", [d.d]), ic(kit().wxIcon(d.code, true), 64, "#fff", "solid"),
          E("div", "cwd-row", "justify-content:space-between;width:100%", [E("span", "cwd-mid", "opacity:.62", [d.lo + "°"]), E("span", "cwd-mid", "", [d.hi + "°"])]),
          E("div", "cwd-range", "", [E("b", "", "left:" + a + "%;width:" + Math.max(6, z - a) + "%")]),
          E("div", "cwd-small", "", [d.pop != null && d.pop >= 10 ? "Rain " + Math.round(d.pop) + "%" : "Dry"]),
          d.uv != null ? E("div", "cwd-small", "", ["UV " + Math.round(d.uv)]) : null,
          d.rise ? E("div", "cwd-small", "", ["Sunrise " + d.rise]) : null, d.set ? E("div", "cwd-small", "", ["Sunset " + d.set]) : null]), null, d.d);
      })));
    }
  };

  // world clocks: every city big
  B.world = function (o, env) {
    var cities = op(o).cities && op(o).cities.length ? op(o).cities.slice(0, 4) : ["Australia/Brisbane", "Europe/London", "America/New_York", "Asia/Tokyo"];
    var here = new Date();
    S.body.appendChild(head("clock", "World clocks", "Here it is " + kit().fmt12(here), "#5e5ce6"));
    var draw = function () {
      var row = E("div", "cwd-row cwd-grow", "justify-content:space-around;align-items:center");
      cities.forEach(function (tz) {
        var t = kit().tzTime(tz) || { h: 0, m: 0, t: "" }, night = t.h >= 18 || t.h < 6, fg = night ? "#fff" : "#111", S2 = kit().S;
        var off = Math.round(((t.h * 60 + t.m) - (here.getHours() * 60 + here.getMinutes())) / 60);
        if (off > 12) off -= 24; if (off < -12) off += 24;
        row.appendChild(E("div", "cwd-col", "align-items:center", [kit().svg("0 0 100 100", 300, 300, [S2("circle", { cx: 50, cy: 50, r: 47, fill: night ? "#0e0e12" : "#f4f4f2", stroke: night ? "rgba(255,255,255,.28)" : "none", "stroke-width": 2 }),
          S2("line", { x1: 50, y1: 50, x2: 50, y2: 27, stroke: fg, "stroke-width": 5, "stroke-linecap": "round", transform: "rotate(" + ((t.h % 12) * 30 + t.m / 2) + " 50 50)" }),
          S2("line", { x1: 50, y1: 50, x2: 50, y2: 13, stroke: fg, "stroke-width": 3.4, "stroke-linecap": "round", transform: "rotate(" + t.m * 6 + " 50 50)" }),
          S2("circle", { cx: 50, cy: 50, r: 3.5, fill: "#ff9f0a" })]),
          E("div", "cwd-mid", "margin-top:24px", [kit().CITY[tz] || tz.split("/").pop().replace(/_/g, " ")]), E("div", "cwd-big", "", [t.t]),
          E("div", "cwd-small", "", [off === 0 ? "Same time as here" : Math.abs(off) + (Math.abs(off) === 1 ? " hour " : " hours ") + (off > 0 ? "ahead" : "behind")])]));
      });
      return row;
    };
    var cur = draw();
    S.body.appendChild(cur);
    S.tick = function () { var n = draw(); S.body.replaceChild(n, cur); cur = n; };
    S.every = 30000;
    void env;
  };

  // calendar: today, this month and next
  function monthGrid(y, m, today) {
    var first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), cells = [];
    ["M", "T", "W", "T", "F", "S", "S"].forEach(function (x) { cells.push(E("span", "h", "", [x])); });
    for (var i = 0; i < first; i++) cells.push(E("span", "", "", [""]));
    for (var k = 1; k <= days; k++) cells.push(E("span", k === today ? "today" : "", "", [k === today ? E("b", "", "", [String(k)]) : String(k)]));
    return E("div", "cwd-month", "", [E("div", "cwd-mid", "margin-bottom:14px", [kit().MONTHS[m] + " " + y]), E("div", "cwd-mgrid", "", cells)]);
  }
  B.calendar = function (o, env) {
    var d = kit().now(), y = d.getFullYear(), m = d.getMonth(), doy = Math.floor((d - new Date(y, 0, 0)) / 86400000);
    var jan = new Date(y, 0, 1), week = Math.ceil(((d - jan) / 86400000 + ((jan.getDay() + 6) % 7) + 1) / 7);
    S.body.appendChild(head("calendar", "Calendar", kit().longDate(d), "#ff453a"));
    var todayCol = E("div", "cwd-col", "width:430px", [E("div", "cwd-label", "color:#ff453a", [kit().DAYS[d.getDay()]]), E("div", "cwd-huge", "font-size:220px;line-height:.9", [String(d.getDate())]),
      E("div", "cwd-mid", "", [kit().MONTHS[m] + " " + y]), E("div", "cwd-small", "margin-top:10px", ["Day " + doy + " of the year, week " + week])]);
    var evs = o.kind === "agenda" ? (env.demo ? kit().demoEvents() : ((kit().athome(env) || {}).cal || {}).events) : null;
    if (o.kind === "agenda" && !evs) return B.setup(o, env);
    if (evs) return agendaDay(evs, env, todayCol);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:36px", [todayCol, E("div", "cwd-row", "margin-left:60px;align-items:flex-start", [monthGrid(y, m, d.getDate()), E("div", "", "width:56px"), monthGrid(m === 11 ? y + 1 : y, (m + 1) % 12, -1)])]));
  };

  // the Agenda: today's events on a timeline (6am to midnight, overlapping ones side by side), then
  // the rest of the week. Titles and times only, from the calendar link kept on this TV.
  function agendaDay(evs, env, todayCol) {
    var K = kit(), d = K.now(), s0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var all = evs.filter(function (x) { return x.start < s0 + 86400000 && x.end > s0; });
    todayCol.appendChild(label("Today"));
    var allDay = all.filter(function (x) { return x.allDay; }), timed = all.filter(function (x) { return !x.allDay; });
    if (!all.length) todayCol.appendChild(E("div", "cwd-text", "", ["Nothing on today."]));
    all.slice(0, 7).forEach(function (e, i) { todayCol.appendChild(F(E("div", "cwd-ev", "", [E("i", "", "background:" + K.EV_COL[i % K.EV_COL.length]), E("span", "cwd-ell", "", [e.title]), E("b", "", "flex:none;margin-left:14px", [e.allDay ? "All day" : K.hhmm(e.start, env)])]), null, e.title)); });
    // the timeline: hours across, each event a block in its lane
    // the hours that matter today: from just before the first event to just after the last, at least 8
    var hrs = timed.map(function (e) { return [(e.start - s0) / 3600000, (e.end - s0) / 3600000]; });
    var H0 = hrs.length ? clamp(Math.floor(Math.min.apply(null, hrs.map(function (x) { return x[0]; }))) - 1, 0, 16) : 6;
    var H1 = hrs.length ? clamp(Math.ceil(Math.max.apply(null, hrs.map(function (x) { return x[1]; }))) + 1, H0 + 8, 24) : 24;
    H0 = Math.min(H0, H1 - 8);
    var W = 1180, HW = W / (H1 - H0), lanes = [], blocks = [];
    timed.forEach(function (e, i) {
      var a = Math.max(H0, (e.start - s0) / 3600000), z = Math.min(H1, Math.max(a + 0.5, (e.end - s0) / 3600000));
      if (z <= H0 || a >= H1) return;
      var lane = 0; while (lanes[lane] !== undefined && lanes[lane] > a) lane++;
      if (lane > 3) return;
      lanes[lane] = z;
      blocks.push(E("div", "cwd-tblock", "left:" + px((a - H0) * HW) + ";top:" + px(56 + lane * 96) + ";width:" + px(Math.max(60, (z - a) * HW - 6)) + ";background:" + K.EV_COL[all.indexOf(e) % K.EV_COL.length], [E("span", "cwd-ell", "", [e.title])]));
    });
    var hours = [];
    for (var h = H0; h <= H1; h += H1 - H0 > 12 ? 3 : 2) hours.push(E("div", "cwd-thour", "left:" + px((h - H0) * HW), [h === 24 ? "" : K.fmt12(new Date(2000, 0, 1, h, 0)).replace(":00", "")]));
    var nowAt = (d.getTime() - s0) / 3600000, nowLine = nowAt > H0 && nowAt < H1 ? E("div", "cwd-tnow", "left:" + px((nowAt - H0) * HW)) : null;
    var line = E("div", "cwd-timeline", "width:" + px(W) + ";height:" + px(56 + Math.max(1, lanes.length) * 96), hours.concat(blocks, nowLine ? [nowLine] : []));
    // the next six days
    var week = E("div", "cwd-col", "", []);
    for (var k = 1; k <= 6; k++) {
      var ds = s0 + k * 86400000, de = ds + 86400000, these = evs.filter(function (x) { return x.start < de && x.end > ds; });
      if (!these.length) continue;
      var dd = new Date(ds);
      week.appendChild(F(E("div", "cwd-wkrow", "", [E("b", "", "", [K.DAYS[dd.getDay()].slice(0, 3) + " " + dd.getDate()]), E("span", "cwd-ell", "", [these.slice(0, 4).map(function (x) { return x.title + (x.allDay ? "" : " " + K.hhmm(x.start, env)); }).join(", ") + (these.length > 4 ? " and " + (these.length - 4) + " more" : "")])]), null, "day " + k));
    }
    if (!week.childNodes.length) week.appendChild(E("div", "cwd-text", "", ["Nothing else this week."]));
    var right = E("div", "cwd-col", "margin-left:60px;min-width:0;flex:1", [label(allDay.length && !timed.length ? "Today, all day" : "Today, hour by hour"), line, label("This week"), week]);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:36px", [todayCol, right]));
  }

  // things typed at home (Home settings, couch-tv Studio, At home), kept on this TV
  // Batteries (Batteries.kt through TVOS.batteries): every paired device that reports its charge, and on
  // Android 12 and newer the one question Android asks first ("Nearby devices")
  B.batteries = function (o, env) {
    var T = window.TVOS, bt = null;
    if (env.demo) bt = { need: "", devices: [{ kind: "controller", name: "Pad 1", level: 72 }, { kind: "controller", name: "Pad 2", level: 12 }, { kind: "headphones", name: "Headset", level: 55 }] };
    else if (T && typeof T.batteries === "function") { try { bt = JSON.parse(T.batteries()); } catch (e) { bt = null; } }
    if (!bt) return B.setup(o, env);
    S.body.appendChild(head("bolt", "Batteries", bt.need === "permission" ? "Android asks first" : "Paired with this TV by Bluetooth", "#30d158"));
    if (bt.need === "permission") {
      S.body.appendChild(E("div", "cwd-col cwd-grow", "margin-top:30px", [E("div", "cwd-text", "", ["To read the charge of your remotes and controllers, Android asks once to let couch-tv see nearby devices. OK below shows Android's question: pick Allow."]),
        E("div", "cwd-row", "margin-top:30px", [F(btn("check", "Ask Android now"), function () { if (designerSays()) return; var ok = false; try { ok = T.askBatteries(); } catch (e) {} msg(ok ? "Already allowed. Close and open the widget again." : "Pick Allow on Android's question, then press Back."); }, "Allow")])]));
      return;
    }
    var icon = { remote: "remote", controller: "games", headphones: "headphones", keyboard: "edit", other: "bluetooth" };
    S.body.appendChild(E("div", "cwd-col cwd-grow", "margin-top:30px", (bt.devices || []).length ? bt.devices.map(function (x) {
      return E("div", "cwd-tvrow", "", [E("span", "", "display:flex;align-items:center;gap:18px", [ic(icon[x.kind] || "bluetooth", 40), x.name]), E("b", x.level < 20 ? "cwd-tv-no" : "cwd-tv-yes", "", [x.level + "%"])]);
    }) : [E("div", "cwd-text", "", ["No paired device reports its charge right now. Remotes and controllers that do show here by themselves."])]));
  };
  // Ask AI (ask.js): the last question and answer in full, then Ask and Set up, which open the Ask sheet
  B.ask = function (o, env) {
    var A = window.CouchAsk, st = A ? A.status() : { ready: false, by: "" };
    var v = env.demo ? { q: "How far away is the moon?", a: "About 384,000 kilometres. Light from it takes just over a second to reach us." } : A && A.last();
    S.body.appendChild(head("mic", "Ask AI", env.demo ? "Answered by your own AI" : st.ready ? "Answered by " + st.by : "Pick who answers first: OK on Set up", "#5e5ce6"));
    var go = function (view) { return function () { if (designerSays()) return; close(true); if (A) A.open(view); }; };
    var row = E("div", "cwd-row", "margin-top:30px", [F(btn("mic", st.ready || env.demo ? "Ask a question" : "Set it up now"), go(st.ready ? "ask" : "setup"), "Ask"), F(btn("settings", "Set up"), go("setup"), "Set up")]);
    var words = v && v.q ? [label("You asked"), E("div", "cwd-text", "", [v.q]), label(v.pending ? "Thinking" : "The answer"), E("div", "cwd-note", "font-size:" + px(clamp(Math.sqrt(1500 * 420 / Math.max(10, String(v.err || v.a || "").length) / 1.6), 36, 84)), [v.pending ? "..." : v.err || v.a])]
      : [E("div", "cwd-text", "margin-top:30px", [st.ready ? "Ask anything. Type it, or press OK on the box and then the microphone on the TV's keyboard. Ask on the phone remote shows its answer here too."
        : "Ask AI answers with the AI you pick: your own Claude, OpenAI, Gemini or another service with your own key kept on this TV, a model on a computer at home, or couch-tv at home. couch-tv never pays for it and never sees your key."])];
    S.body.appendChild(E("div", "cwd-col cwd-grow", "", words.concat([row])));
  };
  // From your AI (ask.js): the last message in full, and how to connect an agent (docs/AI-AGENT.md)
  B.agent = function (o, env) {
    var A = window.CouchAsk, m = env.demo ? { from: "Claude", text: "Your new autumn design is on its way. Press OK on the TV when it asks." } : A && A.message();
    S.body.appendChild(head("phone", "From your AI", m ? "From " + m.from : "Your own AI agent can write to this TV", "#5e5ce6"));
    if (m) S.body.appendChild(E("div", "cwd-note", "margin-top:24px;font-size:" + px(clamp(Math.sqrt(1500 * 300 / Math.max(10, m.text.length) / 1.6), 36, 84)), [m.text]));
    var C = window.CouchWidgetCaps, steps = C ? C.steps("agent", "android") : [];
    S.body.appendChild(E("div", "cwd-col cwd-grow", "margin-top:24px", [label("Connect your AI agent"),
      E("div", "cwd-list", "", steps.map(function (t, i) { return E("div", "cwd-li", "", [E("b", "", "flex:none;width:44px", [String(i + 1) + "."]), E("span", "", "", [t])]); }))]));
  };
  B.note = function (o, env) {
    var n = env.demo ? { text: "Dinner at 6. Feed Max!", from: "Mum" } : (kit().athome(env) || {}).note;
    if (!n || !n.text) return B.setup(o, env);
    S.body.appendChild(head("edit", "Family note", n.from ? "From " + n.from : "Change it in Home settings, couch-tv Studio, At home", "#c79a00"));
    var fs = clamp(Math.sqrt(1500 * 640 / Math.max(10, n.text.length) / 1.6), 44, 120);
    S.body.appendChild(E("div", "cwd-col cwd-grow cwd-center", "", [E("div", "cwd-note", "font-size:" + px(fs), [n.text])]));
  };
  B.list = function (o, env) {
    var l = kit().listOf(o, env);
    if (!l) return B.setup(o, env);
    var left = function () { return l.items.filter(function (x) { return !x.done; }).length; };
    S.body.appendChild(head("check", l.name, "", l.todo ? "#0a84ff" : "#30d158"));
    var sub = function () { S.subEl.textContent = (left() ? left() + " to do" : l.items.length ? "All done" : "Nothing on it yet") + (l.items.length ? ". OK ticks an item." : ""); };
    sub();
    if (!l.items.length) { S.body.appendChild(E("div", "cwd-text", "margin-top:40px", ["Add to this list in Home settings, couch-tv Studio, At home, or with Type on the TV in the phone remote."])); return; }
    var grid = E("div", "cwd-grid", "align-content:flex-start;margin-top:30px");
    l.items.forEach(function (it, i) {
      var row = E("div", "cwd-item" + (it.done ? " done" : ""), "", [E("i", "cwd-box"), E("span", "cwd-ell", "", [it.t])]);
      grid.appendChild(F(row, function () {
        if (designerSays()) return;
        it.done = !it.done;
        row.classList.toggle("done", it.done);
        S.api.act("tick", l.at + ":" + i);
        sub();
      }, it.t));
    });
    S.body.appendChild(E("div", "cwd-grow", "overflow:hidden", [grid]));
  };
  B.wifi = function (o, env) {
    var w = kit().wifiOf(env);
    if (!w || !w.ssid) return B.setup(o, env);
    S.body.appendChild(head("wifi", "Guest Wi-Fi", "Join from a phone", "#0a84ff"));
    var code = kit().qrNode(w.qr, 600), nopass = w.sec === "nopass" || !w.pass;
    S.body.appendChild(E("div", "cwd-row cwd-grow", "margin-top:30px", [
      E("div", "cwd-qr", "", [code || E("div", "cwd-text", "color:#111", ["The name and password are too long for a code. Type them in instead."])]),
      E("div", "cwd-col", "margin-left:80px;min-width:0;flex:1", [label("Network"), E("div", "cwd-big cwd-ell", "", [w.ssid]), label(nopass ? "No password" : "Password"), nopass ? null : E("div", "cwd-big cwd-ell", "", [w.pass]),
        label("How to join"), E("div", "cwd-list", "", ["Open the camera on your phone.", "Point it at the code.", "Tap the Wi-Fi note that comes up, then Join."].map(function (t, i) { return E("div", "cwd-li", "", [E("b", "", "flex:none;width:44px", [String(i + 1) + "."]), E("span", "", "", [t])]); }))])]));
  };
  B.guide = function (o, env) {
    var g = kit().guideOf(env);
    if (!g.length) return B.setup(o, env);
    S.body.appendChild(head("info", "House guide", g.length === 1 ? "One thing to know" : g.length + " things to know", "#5e5ce6"));
    var w = g.length > 4 ? 520 : 800;
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:30px;overflow:hidden", g.map(function (x) {
      return F(E("div", "cwd-card cwd-gcard", "width:" + px(w), [E("div", "cwd-row", "", [ic(kit().guideIcon(x.title), 40), E("div", "cwd-mid cwd-ell", "margin-left:16px", [x.title])]), x.text ? E("div", "cwd-text", "margin-top:14px;white-space:pre-line", [x.text]) : null]), null, x.title);
    })));
  };
  B.screentime = function (o, env) {
    var h = kit().athome(env), s = env.demo ? { ok: true, minutes: 95, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }, { name: "Netflix", minutes: 12 }] } : h && h.screen, goal = env.demo ? 120 : (h && h.goal) || 0;
    if (!s || !s.ok) return B.setup(o, env);
    var CA = window.CouchAtHome, hm = CA ? CA.hm : function (m) { return m + "m"; };
    S.body.appendChild(head("timer", "Screen time today", goal && CA ? CA.goalLine(s.minutes, goal) : "Time in apps on this TV today", "#5e5ce6"));
    var max = Math.max(1, (s.apps[0] || {}).minutes || 1);
    var left = E("div", "cwd-col", "width:560px", [E("div", "cwd-huge", "font-size:180px", [hm(s.minutes)]), goal ? E("div", "cwd-bar", "margin-top:30px", [E("b", "", "width:" + Math.round(clamp(s.minutes / goal, 0, 1) * 100) + "%;background:" + (s.minutes > goal ? "#ffd60a" : "#fff"))]) : null,
      E("div", "cwd-small", "margin-top:20px", [goal ? "Daily goal " + hm(goal) + ", set in Home settings" : "Set a daily goal in Home settings, couch-tv Studio, At home"])]);
    var right = E("div", "cwd-col", "margin-left:80px;flex:1;min-width:0", [label("By app")].concat(s.apps.length ? s.apps.slice(0, 7).map(function (a) {
      return F(E("div", "cwd-app-time", "", [E("span", "cwd-ell", "", [a.name || a.package || ""]), E("div", "cwd-bar", "", [E("b", "", "width:" + Math.round(a.minutes / max * 100) + "%")]), E("b", "", "", [hm(a.minutes)])]), null, a.name || a.package);
    }) : [E("div", "cwd-text", "", ["No apps yet today."])]));
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:40px", [left, right]));
  };

  // moon: tonight and the next four weeks
  function moonSvg(f, s) {
    var S2 = kit().S, r = 44, waxing = f < 0.5, k = Math.cos(f * 2 * Math.PI), ex = Math.abs(k) * r;
    return kit().svg("0 0 100 100", s, s, [S2("circle", { cx: 50, cy: 50, r: r, fill: "#2a2a30" }),
      S2("path", { d: "M50 6 A44 44 0 0 " + (waxing ? 1 : 0) + " 50 94 A" + ex + " 44 0 0 " + ((waxing ? k > 0 : k < 0) ? 0 : 1) + " 50 6Z", fill: "#f2efe6" })]);
  }
  B.moon = function () {
    var d = kit().now(), m = kit().moon(d);
    S.body.appendChild(head("clear-night", "Moon", m.name + ". " + m.full, "#3a3a6a"));
    var grid = E("div", "cwd-mgrid cwd-moons", "");
    for (var i = 0; i < 28; i++) {
      var dd = new Date(d.getTime() + i * 86400000), mm = kit().moon(dd);
      grid.appendChild(E("div", "cwd-col", "align-items:center", [moonSvg(mm.f, 74), E("div", "cwd-small", "", [i === 0 ? "Tonight" : kit().DAYS[dd.getDay()].slice(0, 3) + " " + dd.getDate()])]));
    }
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:center", [E("div", "cwd-col", "align-items:center;width:520px", [moonSvg(m.f, 380), E("div", "cwd-big", "margin-top:24px", [m.name])]), grid]));
  };

  // air quality and surf
  B.air = function (o, env) {
    var a = kit().airOf(env);
    if (!a) return B.setup(o, env);
    var v = Math.round(a.aqi), band = kit().aqiBand(v);
    var SAY = { Good: "A good day to open the windows.", Fair: "Fine for nearly everyone.", Moderate: "Sensitive people may want to take it easy outside.", Poor: "Keep windows shut if anyone has asthma.", "Very poor": "Best to stay inside and keep windows shut.", "Extremely poor": "Stay inside. Smoke or dust is likely." };
    S.body.appendChild(head("wind", "Air quality", band[0] + ". " + (SAY[band[0]] || ""), band[1]));
    var hs = a.hourly || [], top = Math.max.apply(null, hs.concat([40]));
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:center", [E("div", "cwd-col", "width:560px", [E("div", "cwd-huge", "color:" + band[1], [String(v)]), E("div", "cwd-big", "", [band[0]]), E("div", "cwd-small", "margin-top:12px", ["European air quality index, from Open-Meteo"])]),
      hs.length ? E("div", "cwd-col cwd-grow", "", [label("Next 12 hours"), E("div", "cwd-bars", "", hs.slice(0, 12).map(function (x) { return E("i", "", "height:" + Math.round(clamp(x / top, 0.06, 1) * 100) + "%;background:" + kit().aqiBand(x)[1]); })),
        E("div", "cwd-row cwd-small", "justify-content:space-between;margin-top:10px", [E("span", "", "", ["Now"]), E("span", "", "", ["+6h"]), E("span", "", "", ["+12h"])])]) : null]));
  };
  B.surf = function (o, env) {
    var m = kit().surfOf(env);
    if (!m || !isFinite(m.wave)) return B.setup(o, env);
    var place = op(o).label || (env.demo ? "The point" : (kit().dataOf(env).place || {}).name || "Surf");
    S.body.appendChild(head("wind", place, kit().compass(m.dir) + " swell, " + Math.round(m.period || 0) + " seconds" + (isFinite(m.wind) ? ". Wind " + kit().compass(m.windDir) + " " + Math.round(m.wind) + " km/h" : ""), "#0a6e8a"));
    var hs = m.hourly || [], top = Math.max.apply(null, hs.concat([0.5]));
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:center", [E("div", "cwd-col", "width:560px", [E("div", "cwd-huge", "", [String(Math.round(m.wave * 10) / 10), E("span", "", "font-size:.36em", [" m"])]), E("div", "cwd-big", "", ["Swell now"])]),
      hs.length ? E("div", "cwd-col cwd-grow", "", [label("Swell, the next 12 hours"), E("div", "cwd-bars", "", hs.slice(0, 12).map(function (x) { return E("i", "", "height:" + Math.round(clamp(x / top, 0.06, 1) * 100) + "%;background:#64d2ff"); })),
        E("div", "cwd-row cwd-small", "justify-content:space-between;margin-top:10px", [E("span", "", "", ["Now"]), E("span", "", "", ["+6h"]), E("span", "", "", ["+12h"])])]) : null]));
  };

  // photos: full screen, Left and Right flick, OK pauses
  B.photos = function (o, env) {
    var q = op(o), mem = o.kind === "memory" ? (env.demo ? [{ src: kit().demoImg("camp"), years: 2 }] : (((kit().athome(env) || {}).memory || {}).today || [])) : null;
    var list = mem ? mem.map(function (m) { return m.src; }) : q.image ? [q.image] : (o.kind === "artframe" && env.demo ? [kit().demoImg("art")] : kit().photos(env, o));
    if (!list.length) return B.setup(o, env);
    S.full = true;
    S.panel.classList.add("cwd-photos");
    var at = kit().dayIndex(list.length, q.seconds_each || 20), paused = false, every = (q.seconds_each || 8) * 1000, last = Date.now();
    var mk = function () { return E("div", "cwd-photo", "", [E("div", "cwd-pblur"), E("div", "cwd-pimg")]); };
    var a = mk(), b = mk(), front = a;
    var set = function (layer, u) { var c = kit().cssImg(u); layer.firstChild.style.backgroundImage = c; layer.lastChild.style.backgroundImage = c; };
    set(a, list[at]); b.style.opacity = "0";
    var dots = E("div", "cwd-pdots"), count = E("div", "cwd-pcount"), pause = E("div", "cwd-pchip", "", [ic("pause", 30, "#fff", "solid"), "Paused"]);
    var paint = function () {
      count.textContent = (mem ? "On this day, " + kit().yearsAgo(mem[at].years).toLowerCase() + (list.length > 1 ? ". " : "") : "") + (list.length > 1 || !mem ? (at + 1) + " of " + list.length : "");
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      for (var i = 0; i < Math.min(list.length, 12); i++) dots.appendChild(E("i", i === at % 12 ? "on" : ""));
      pause.style.opacity = paused ? "1" : "0";
    };
    var go = function (dx) {
      if (list.length < 2) return;
      at = (at + dx + list.length) % list.length;
      var back = front === a ? b : a;
      set(back, list[at]); back.style.opacity = "1"; front.style.opacity = "0"; front = back; last = Date.now();
      paint();
    };
    S.body.appendChild(E("div", "cwd-pstage", "", [a, b, E("div", "cwd-pbar", "", [count, dots]), pause,
      E("div", "cwd-phint", "", [list.length > 1 ? "Left and Right for the next photo. OK pauses. Back closes." : "Back closes."])]));
    paint();
    S.key = function (dir, ok) { if (ok) { paused = !paused; last = Date.now(); paint(); return true; } if (dir && dir[0]) { go(dir[0]); return true; } return false; };
    S.tick = function () { if (!paused && list.length > 1 && Date.now() - last >= every) go(1); };
  };

  // keep watching: every show on the go, Resume on each
  B.keep = function (o, env) {
    var list = kit().shows(env).slice(0, 10);
    if (!list.length) return B.setup(o, env);
    var d = kit().dataOf(env), who = (d.people || []).filter(function (p) { return p.id === d.who; })[0];
    S.body.appendChild(head("tv", "Keep watching", (env.demo ? "Alex" : who ? who.name : "") ? "What " + (env.demo ? "Alex" : who.name) + " has on the go" : "What you have on the go", "#e50914"));
    var track = E("div", "cwd-track");
    list.forEach(function (s, i) {
      track.appendChild(F(E("div", "cwd-show", "", [E("div", "cwd-art", s.art ? "background-image:" + kit().cssImg(s.art) : "", [s.progress ? E("div", "cwd-prog", "", [E("b", "", "width:" + Math.round(s.progress * 100) + "%")]) : null,
        E("div", "cwd-resume", "", [ic("play", 30, "#111", "solid"), "Resume"])]),
        E("div", "cwd-row", "margin-top:18px", [s.app ? kit().appIcon(s.app, 44, env) : null, E("div", "cwd-col", "margin-left:14px;min-width:0", [E("div", "cwd-mid cwd-ell", "", [s.title]), E("div", "cwd-small cwd-ell", "", [s.sub || ""])])])]),
        function () { if (designerSays()) return; S.api.act("show", String(i)); close(true); }, s.title));
    });
    S.body.appendChild(E("div", "cwd-scroll cwd-grow", "margin-top:40px", [track]));
    var at = S.from ? parseInt(S.from.getAttribute("data-at") || "0", 10) : 0;
    S.start = clamp(at || 0, 0, list.length - 1);
  };

  // an app folder: every app, big
  B.folder = function (o, env) {
    var apps = kit().appsFor(o, env, 16);
    if (!apps.length) return B.setup(o, env);
    S.body.appendChild(head("apps", op(o).label || "Apps", apps.length + (apps.length === 1 ? " app" : " apps"), "#0a84ff"));
    var grid = E("div", "cwd-grid cwd-grow", "justify-content:center;align-content:center;margin-top:20px");
    apps.forEach(function (p, i) {
      var n = kit().appNode(p, 200, env);
      n.removeAttribute("data-act");
      grid.appendChild(F(E("div", "cwd-app", "", [n, E("div", "cwd-small cwd-ell", "", [kit().appName(String(p).replace(/^missing:/, ""), env)])]), function () { if (designerSays()) return; if (String(p).indexOf("missing:") === 0) { msg("Not on this TV. Install it from the App Store in More apps, or hold OK on it in the folder to change it."); return; } S.api.act("app", p); close(true); }, kit().appName(String(p).replace(/^missing:/, ""), env)));
      // Hold OK on an app: the folder closes and its Hold OK menu opens for that app (design.js)
      var api = S.api;
      if (!api.designer && api.hold) S.stops[S.stops.length - 1].hold = function () { close(true); api.hold(i); };
    });
    S.body.appendChild(grid);
  };

  // now playing: the full player
  B.player = function (o, env) {
    var m = kit().music(env);
    if (!m) {
      if (kit().dataOf(env).bridge === false) return B.setup(o, env);
      S.body.appendChild(head("music", "Now playing", "Nothing is playing on this TV", "#1db954"));
      S.body.appendChild(E("div", "cwd-col cwd-grow cwd-center", "", [ic("music", 160, "rgba(255,255,255,.5)"), E("div", "cwd-big", "margin-top:30px", ["Nothing playing"]),
        E("div", "cwd-text", "text-align:center;max-width:900px", ["Play a song in Spotify, YouTube Music or any music app and it shows here, with its controls."])]));
      return;
    }
    S.panel.classList.add("cwd-player");
    if (m.art) S.panel.insertBefore(E("div", "cwd-artbg", "background-image:" + kit().cssImg(m.art)), S.panel.firstChild);
    var playing = m.state === "playing", pos = m.pos || 0, dur = m.dur || 0, t0 = Date.now();
    var bar = E("b", "", ""), tA = E("span"), tB = E("span");
    var drawPos = function () {
      var p = dur ? clamp(pos + (playing ? (Date.now() - t0) / 1000 : 0), 0, dur) : 0;
      bar.style.width = (dur ? p / dur * 100 : 0) + "%";
      var f = function (s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); };
      tA.textContent = dur ? f(p) : ""; tB.textContent = dur ? "-" + f(dur - p) : "";
    };
    drawPos();
    S.tick = drawPos;
    var playBtn = btn(playing ? "pause" : "play", "", "cwd-round cwd-hero");
    var send = function (key, after) { return function () { if (designerSays()) { if (after) after(); return; } S.api.act("media", key); if (after) after(); }; };
    var toggle = function () { playing = !playing; pos = dur ? clamp(pos + (Date.now() - t0) / 1000, 0, dur) : 0; t0 = Date.now(); while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild); playBtn.appendChild(ic(playing ? "pause" : "play", 60, "currentColor", "solid")); };
    while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild); playBtn.appendChild(ic(playing ? "pause" : "play", 60, "currentColor", "solid"));
    var prev = btn("previous", "", "cwd-round"), next = btn("next", "", "cwd-round");
    [prev, next].forEach(function (x) { x.firstChild.setAttribute("width", 48); x.firstChild.setAttribute("height", 48); x.firstChild.style.width = "48px"; x.firstChild.style.height = "48px"; });
    var info = E("div", "cwd-col cwd-grow", "margin-left:80px;min-width:0;justify-content:center", [
      E("div", "cwd-row", "", [m.app ? kit().appIcon(m.app, 48, env) : ic("music", 40), E("span", "cwd-mid", "margin-left:16px;opacity:.86", [m.source || "Now playing"])]),
      E("div", "cwd-ptitle", "", [m.title]), E("div", "cwd-partist cwd-ell", "", [m.artist]),
      dur ? E("div", "cwd-pbar2", "", [bar]) : null, dur ? E("div", "cwd-row cwd-small", "justify-content:space-between;margin-top:10px", [tA, tB]) : null,
      E("div", "cwd-row", "margin-top:40px;align-items:center", [F(prev, send("prev"), "Previous"), F(playBtn, send("play", toggle), playing ? "Pause" : "Play"), F(next, send("next"), "Next"),
        E("div", "", "width:70px"), F(btn("volume-down", "", "cwd-round cwd-sm"), send("vol_down"), "Volume down"), F(btn("volume-up", "", "cwd-round cwd-sm"), send("vol_up"), "Volume up"), F(btn("mute", "", "cwd-round cwd-sm"), send("mute"), "Mute")])]);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:center", [E("div", "cwd-cover", m.art ? "background-image:" + kit().cssImg(m.art) : ""), info]));
    S.start = 1;
  };

  // aircon: every room, its temperature, power, mode and fan
  B.aircon = function (o, env) {
    var demo = !!env.demo, rooms = JSON.parse(JSON.stringify(kit().roomsOf(env)));
    if (!rooms.length) return B.setup(o, env);
    var ent = op(o).entity, sel = Math.max(0, rooms.map(function (r) { return r.entity; }).indexOf(ent)), joinT = null;
    S.body.appendChild(head("aircon", "Aircon", "", "#0a84ff"));
    var main = E("div", "cwd-col", "width:780px"), side = E("div", "cwd-col cwd-grow", "margin-left:40px;min-width:0");
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:stretch;margin-top:26px", [main, side]));
    var sendHa = function (action, r, value, say) {
      if (demo || S.api.designer) { designerSays(); return; }
      if (!S.api.ha) { msg("Home Assistant is not set up on this TV"); return; }
      if (say) msg(say);
      S.api.ha(action, r.entity, value).then(function (res) {
        if (!S) return;
        if (!res || !res.ok) msg(res && res.error === "refused" ? "Home Assistant would not do that for " + r.name : "Home Assistant did not answer. Try again.");
        setTimeout(reread, 1500);
      });
    };
    var reread = function () {
      if (!S || demo || !S.api.ha) return;
      S.api.ha("climate").then(function (res) { if (S && res && res.ok && res.rooms && res.rooms.length && !joinT) { rooms = res.rooms; draw(); } });
    };
    var draw = function () {
      var keepName = S.stops[S.cur] && S.stops[S.cur].el.getAttribute("data-name");
      S.stops = [];
      while (main.firstChild) main.removeChild(main.firstChild);
      while (side.firstChild) side.removeChild(side.firstChild);
      var r = rooms[sel], on = kit().roomOn(r), col = on ? kit().MODE_COL[r.state] || "#64d2ff" : "rgba(255,255,255,.3)";
      var nOn = rooms.filter(kit().roomOn).length;
      S.subEl.textContent = nOn + " of " + rooms.length + (rooms.length === 1 ? " room on" : " rooms on");
      var canSet = r.ok !== false && r.target != null;
      var dialBox = kit().dial(400, canSet ? r.target : 22, r.current != null ? Math.round(r.current * 10) / 10 : null);
      if (!on) dialBox.style.opacity = "0.5";
      main.appendChild(E("div", "cwd-row", "", [E("div", "cwd-col cwd-grow", "min-width:0", [E("div", "cwd-big cwd-ell", "", [r.name]), E("div", "cwd-mid", "color:" + (on ? col : "rgba(255,255,255,.6)"), [r.ok === false ? "Not answering" : on ? kit().roomMode(r) + (r.action === "cooling" ? ", cooling" : r.action === "heating" ? ", heating" : "") : "Off"])]),
        F(btn("power", on ? "On" : "Off", on ? "cwd-on" : ""), function () {
          if (r.ok === false) return msg(r.name + " is not answering");
          var turnOn = !on; r.state = turnOn ? (r.modes || []).filter(function (x) { return x !== "off"; })[0] || "auto" : "off"; r.action = turnOn ? "" : "off"; draw();
          sendHa(turnOn ? "on" : "off", r, "", r.name + (turnOn ? " on" : " off"));
        }, "Power")]));
      var nudge = function (d) {
        return function () {
          if (!canSet) return msg(r.ok === false ? r.name + " is not answering" : "This room has no set temperature");
          r.target = clamp(Math.round((r.target + d * (r.step || 0.5)) * 10) / 10, r.min || 16, r.max || 30); draw();
          clearTimeout(joinT);
          joinT = setTimeout(function () { joinT = null; sendHa("temp", r, r.target, r.name + " to " + r.target + "°"); }, 700);
        };
      };
      main.appendChild(E("div", "cwd-row cwd-grow", "align-items:center;justify-content:center", [F(btn("minus", "", "cwd-round"), nudge(-1), "Cooler"), E("div", "cwd-dial", "margin:0 40px", [dialBox]), F(btn("plus", "", "cwd-round"), nudge(1), "Warmer")]));
      // the rooms first, then this room's mode and fan, on the right
      var big = rooms.length > 4, rw = big ? 254 : 394;
      side.appendChild(label("Rooms"));
      side.appendChild(E("div", "cwd-grid", "", rooms.slice(0, 9).map(function (z, i) {
        var zo = kit().roomOn(z);
        return F(E("div", "cwd-room" + (i === sel ? " sel" : "") + (zo ? " on" : ""), "width:" + rw + "px;height:" + (big ? 116 : 136) + "px", [E("div", "cwd-row", "justify-content:space-between", [E("span", "cwd-mid cwd-ell", "min-width:0", [z.name]), E("span", "cwd-big", "font-size:" + (big ? 40 : 48) + "px;margin-left:10px", [kit().tdeg(z.current)])]),
          E("div", "cwd-small cwd-ell", "color:" + (zo ? kit().MODE_COL[z.state] || "#64d2ff" : "rgba(255,255,255,.6)"), [z.ok === false ? "Not answering" : zo ? kit().roomMode(z) + " to " + kit().tdeg(z.target) : "Off"])]), function () { sel = i; draw(); }, "Room " + z.name);
      })));
      var modes = (r.modes || []).filter(function (x) { return x !== "off"; });
      if (modes.length) {
        side.appendChild(label("Mode, " + r.name));
        side.appendChild(E("div", "cwd-row cwd-wrap", "", modes.map(function (md) {
          return F(chip(kit().MODE_WORD[md] || md, on && r.state === md), function () { r.state = md; r.action = ""; draw(); sendHa("mode", r, md, r.name + ": " + (kit().MODE_WORD[md] || md)); }, "Mode " + md);
        })));
      }
      if (r.fan_modes && r.fan_modes.length) {
        side.appendChild(label("Fan, " + r.name));
        side.appendChild(E("div", "cwd-row cwd-wrap", "", r.fan_modes.slice(0, 6).map(function (fm) {
          return F(chip(fm.charAt(0).toUpperCase() + fm.slice(1).replace(/_/g, " "), r.fan === fm), function () { r.fan = fm; draw(); sendHa("fan", r, fm, r.name + ": fan " + fm); }, "Fan " + fm);
        })));
      }
      var again = keepName ? S.stops.map(function (s) { return s.el.getAttribute("data-name"); }).indexOf(keepName) : -1;
      S.cur = again >= 0 ? again : Math.min(S.cur || 0, S.stops.length - 1);
      paint();
    };
    S.cur = 2;
    draw();
    S.start = S.cur;   // the first room's Warmer, as the smart home screen lands
    S.redraw = draw;
    S.tick = function () { if (Date.now() - (S.readAt || 0) > 15000) { S.readAt = Date.now(); reread(); } };
    S.readAt = Date.now();
    if (!demo && S.api.ha && !(env.rooms && env.rooms.length)) reread();
  };

  // scenes: every scene as a big button
  B.scenes = function (o, env) {
    var list = kit().scenesOf(env);
    if (!list.length) return B.setup(o, env);
    S.body.appendChild(head("favourite", op(o).label || "Scenes", list.length + (list.length === 1 ? " scene" : " scenes") + ". OK runs one", "#bf5af2"));
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px", list.slice(0, 16).map(function (x) {
      return F(E("div", "cwd-scene", "", [E("div", "cwd-sic", "", [ic(x[0], 48, "#fff", "solid")]), E("div", "cwd-mid cwd-ell", "", [x[1]])]), function () {
        if (designerSays()) return;
        if (!S.api.ha) return msg("Home Assistant is not set up on this TV");
        msg("Starting " + x[1], true);
        S.api.ha("scene", x[2]).then(function (r) { if (S) msg(r && r.ok ? x[1] + " is on" : "Home Assistant did not answer. Try again."); });
      }, x[1]);
    })));
  };

  // Control Centre, camera, headlines and scores: couch-tv Studio shows what they will look like; a TV
  // shows their setup record (widgets.js draws them empty there, which opens B.setup)
  // Control Centre: every switch big. OK switches one through the launcher (HomeAssistant.kt "set"),
  // which only switches what config.json names and never opens a garage door, gate or door.
  B.controls = function (o, env) {
    var H = kit().ha, demo = !!env.demo, info = H.haOf(env).info || {};
    if (!demo && !(info.controls && info.controls.length)) return B.setup(o, env);
    var copy = function (l) { return l ? l.map(function (c) { var x = {}; for (var k in c) x[k] = c[k]; return x; }) : null; };
    var items = copy(H.controlsOf(env, o)), title = op(o).label || "Control Centre";
    S.body.appendChild(head("home", title, "", "#30d158"));
    var grid = E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px");
    S.body.appendChild(grid);
    var reread = function () {
      if (!S || demo || !S.api.ha) return;
      S.readAt = Date.now();
      S.api.ha("controls").then(function (r) {
        if (!S || !r || !r.ok) { if (S && !items) { items = []; draw(); msg("Home Assistant is not answering"); } return; }
        var want = op(o).switches, l = r.controls || [];
        if (want && want.length) l = want.map(function (e) { return l.filter(function (c) { return c.entity === e; })[0]; }).filter(Boolean);
        items = l; draw();
      });
    };
    var draw = function () {
      var keep = S.stops[S.cur] && S.stops[S.cur].el.getAttribute("data-name");
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      S.stops = [];
      if (!items) { S.subEl.textContent = "Checking Home Assistant"; return; }
      (items || []).slice(0, 16).forEach(function (c) {
        var on = c.ok !== false && c.on;
        grid.appendChild(F(E("div", "cwd-toggle" + (on ? " on" : ""), c.ok === false ? "opacity:.6" : "", [E("div", "cwd-sic", "", [ic(c.icon || H.ctlIcon(c), 44, on ? "#1a1406" : "#fff", "solid")]),
          E("div", "cwd-mid cwd-ell", "", [c.name || ""]), E("div", "cwd-small", "", [c.blocked ? H.ctlWord(c) + ", not from the TV" : H.ctlWord(c)])]), function () {
          if (demo || S.api.designer) { c.on = !c.on; designerSays(); draw(); return; }
          if (c.ok === false) return msg(c.name + " is not answering");
          if (c.blocked) return msg("Garage doors, gates and doors are never opened from the TV");
          if (!S.api.ha) return msg("Home Assistant is not set up on this TV");
          var want = c.kind === "cover" ? (c.on ? "close" : "open") : (c.on ? "off" : "on");
          c.on = !c.on; draw();
          msg(c.name + (c.kind === "cover" ? (c.on ? " opening" : " closing") : c.on ? " on" : " off"));
          S.api.ha("set", c.entity, want).then(function (r) {
            if (!S) return;
            if (!r || !r.ok) { c.on = !c.on; draw(); msg(r && r.error === "refused" ? "Home Assistant would not switch " + c.name : "Home Assistant did not answer. Try again."); }
            setTimeout(reread, 1500);
          });
        }, c.name));
      });
      S.subEl.textContent = !items.length ? "None of these switches is set up on this TV" : items.filter(function (c) { return c.ok !== false && c.on; }).length + " of " + items.length + " on";
      var again = keep ? S.stops.map(function (s) { return s.el.getAttribute("data-name"); }).indexOf(keep) : -1;
      S.cur = again >= 0 ? again : Math.min(S.cur || 0, Math.max(0, S.stops.length - 1));
      paint();
    };
    draw();
    S.redraw = draw;
    S.tick = function () { if (Date.now() - (S.readAt || 0) > 10000) reread(); };
    if (!demo) reread();
  };

  // Camera and doorbell: a still, a new one every two seconds while this is open (never video).
  // The doorbell shows the picture this TV kept from the last ring first, then the door now.
  B.camera = function (o, env) {
    var H = kit().ha, ha = H.haOf(env), info = ha.info || {}, demo = !!env.demo, door = o.kind === "doorbell";
    if (!demo && (door ? !info.doorbell : !(info.cameras && info.cameras.length))) return B.setup(o, env);
    S.full = true;
    S.panel.classList.add("cwd-photos");
    var bell = ha.bell, ring = !demo && door && ha.ring && bell && bell.kept ? ha.ring : null;
    var cams = door ? [{ entity: "doorbell", name: op(o).label || (bell && bell.name) || "Front door" }] : (demo ? [{ entity: "camera.backyard", name: op(o).label || "Backyard" }, { entity: "camera.driveway", name: "Driveway" }] : info.cameras);
    var sel = Math.max(0, cams.map(function (c) { return c.entity; }).indexOf(op(o).cam)), showRing = !!(ring || (demo && door));
    var img = E("div", "cwd-pimg", "background-size:contain;background-color:#000"), nameEl = E("b", "", "font-weight:680"), subEl = E("span");
    var stage = E("div", "cwd-pstage", "", [E("div", "cwd-photo", "", [img]), E("div", "cwd-live", "", [E("i"), nameEl, subEl])]);
    S.body.appendChild(stage);
    var row = E("div", "cwd-row", "position:absolute;left:80px;bottom:56px");
    stage.appendChild(row);
    var bellWords = function () { var r = bell && bell.at ? H.ringWords(bell.at) : null; return !bell ? "" : bell.ringing ? "Ringing now" : r ? r[1] + ", " + r[0] : "No ring this week"; };
    var picture = function () {
      var c = cams[sel];
      nameEl.textContent = c.name || "Camera";
      if (demo) { img.style.backgroundImage = kit().cssImg(door ? kit().bgImg("grose-valley") : kit().demoImg(sel ? "camp" : "dog")); subEl.textContent = door ? "Last ring today, 2:14pm. The picture from the ring" : "A new still every 2 seconds"; return; }
      if (showRing && ring) { img.style.backgroundImage = kit().cssImg(ring.src); subEl.textContent = bellWords() + ". The picture from the ring"; return; }
      var last = (ha.stills || {})[c.entity];
      if (last) img.style.backgroundImage = kit().cssImg(last);
      subEl.textContent = (door ? bellWords() + ". " : "") + (last ? "A new still every 2 seconds" : "Getting a picture");
    };
    var chips = function () {
      while (row.firstChild) row.removeChild(row.firstChild);
      S.stops = [];
      if (door && (ring || demo)) [["At the ring", true], ["Door now", false]].forEach(function (x) { row.appendChild(F(chip(x[0], showRing === x[1]), function () { showRing = x[1]; chips(); picture(); }, x[0])); });
      if (!door && cams.length > 1) cams.forEach(function (c, i) { row.appendChild(F(chip(c.name || c.entity, i === sel), function () { sel = i; chips(); picture(); S.tickAt = 0; }, c.name)); });
      [].forEach.call(row.childNodes, function (n, i) { if (i) n.style.marginLeft = "16px"; });
      paint();
    };
    chips(); picture();
    S.start = Math.max(0, sel);
    var fails = 0;
    S.every = 2000;
    S.tick = function () {
      if (demo || showRing || S.api.designer || !S.api.ha) return;
      var c = cams[sel];
      S.api.ha("still", c.entity, 1280).then(function (r) {
        if (!S || cams[sel] !== c || showRing) return;
        if (r && r.ok && r.src) { fails = 0; img.style.backgroundImage = kit().cssImg(r.src); subEl.textContent = (door ? bellWords() + ". " : "") + "A new still every 2 seconds"; }
        else if (r && r.error !== "busy" && ++fails >= 3) subEl.textContent = "The camera is not answering";
      });
    };
  };

  // Solar and energy: today by the hour
  B.energy = function (o, env) {
    var H = kit().ha, ha = H.haOf(env), demo = !!env.demo, e = ha.energy;
    if (!demo && !(ha.info || {}).energy) return B.setup(o, env);
    var name = op(o).label || (e && e.name) || "Energy";
    S.body.appendChild(head("bolt", name + " today", "", "#ff9f0a"));
    var body = E("div", "cwd-col cwd-grow", "margin-top:30px");
    S.body.appendChild(body);
    var draw = function () {
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!e) { S.subEl.textContent = "Checking Home Assistant"; return; }
      if (!e.ok) { S.subEl.textContent = e.error === "unit" ? "This sensor is not energy or power" : "Home Assistant is not answering"; return; }
      var hours = (e.hours || []).slice(0, 24), max = Math.max.apply(null, hours.map(function (v) { return v || 0; }).concat([0.1])), last = -1, best = -1;
      hours.forEach(function (v, i) { if (v != null) last = i; if (v != null && (best < 0 || v > hours[best])) best = i; });
      S.subEl.textContent = best >= 0 && hours[best] > 0 ? "Most in the hour from " + kit().fmt12(new Date(2000, 0, 1, best)) : "Nothing yet today";
      var stat = function (big, small, col) { return E("div", "", "margin-right:80px", [E("div", "cwd-huge", "font-size:150px;" + (col ? "color:" + col : ""), [big]), E("div", "cwd-mid", "opacity:.75", [small])]); };
      body.appendChild(E("div", "cwd-row", "align-items:flex-end", [stat(H.kwh(e.total), "kWh today"), e.power != null ? stat(H.kwh(e.power), String(e.power_unit || "kW") + " now", "#30d158") : null, e.battery != null ? stat(e.battery + "%", "Battery") : null]));
      body.appendChild(E("div", "cwd-bars", "margin-top:40px;height:300px", hours.map(function (v, i) {
        return E("i", "", v == null ? "height:4px;background:rgba(255,255,255,.18)" : "height:" + Math.max(4, Math.round(v / max * 300)) + "px;background:" + (i === last ? "#ffd60a" : "rgba(255,214,10,.6)"));
      })));
      body.appendChild(E("div", "cwd-row", "justify-content:space-between;margin-top:12px", ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm", "12am"].map(function (x) { return E("span", "cwd-small", "", [x]); })));
    };
    var reread = function () {
      if (!S || demo || !S.api.ha) return;
      S.readAt = Date.now();
      S.api.ha("energy").then(function (r) { if (S && r) { e = r; draw(); } });
    };
    draw();
    S.every = 5000;
    S.tick = function () { if (Date.now() - (S.readAt || 0) > 300000) reread(); };
    if (!demo && !e) reread();
  };

  // Sensor: the reading big, with its last 24 hours; Left and Right reach the other sensors
  B.sensor = function (o, env) {
    var H = kit().ha, ha = H.haOf(env), demo = !!env.demo, names = (ha.info || {}).sensors || [];
    var first = H.sensorPick(env, o);
    if (!first) return B.setup(o, env);
    var sel = first.entity, hist = {}, sensors = ha.sensors;
    if (first.hist) hist[sel] = first.hist;
    S.body.appendChild(head(H.SENSOR_ICON[first.s && first.s.cls] || "temperature", first.name, "", "#5e5ce6"));
    var body = E("div", "cwd-col cwd-grow", "margin-top:30px"), row = E("div", "cwd-row", "margin-top:24px");
    S.body.appendChild(body);
    S.body.appendChild(row);
    var draw = function () {
      while (body.firstChild) body.removeChild(body.firstChild);
      var s = (sensors || []).filter(function (x) { return x.entity === sel; })[0], n = names.filter(function (x) { return x.entity === sel; })[0] || {};
      var label = (sel === first.entity && op(o).label) || (s && s.name) || n.name || "Sensor";
      S.panel.querySelector(".cwd-title").textContent = label;
      if (!sensors) { S.subEl.textContent = "Checking Home Assistant"; return; }
      if (!s || s.ok === false) { S.subEl.textContent = "Home Assistant is not answering"; return; }
      var t = H.sensorText(s), h = hist[sel], pts = h && h.points, got = (pts || []).filter(function (v) { return v != null; });
      S.subEl.textContent = got.length >= 2 ? "Last 24 hours: low " + Math.round(Math.min.apply(null, got) * 10) / 10 + ", high " + Math.round(Math.max.apply(null, got) * 10) / 10 : "Last 24 hours";
      body.appendChild(E("div", "cwd-row", "align-items:baseline", [E("div", "cwd-huge", "", [t[0]]), t[1] ? E("div", "cwd-big", "margin-left:16px;opacity:.75", [t[1]]) : null]));
      body.appendChild(E("div", "cwd-grow", "margin-top:24px;display:flex;align-items:flex-end", [h ? H.spark(pts, 1630, 300, "#64d2ff") : E("div", "cwd-mid", "opacity:.7", ["Reading the last 24 hours"])]));
    };
    var chips = function () {
      while (row.firstChild) row.removeChild(row.firstChild);
      S.stops = [];
      if (names.length > 1) names.forEach(function (n, i) { var c = F(chip(n.name || n.entity, n.entity === sel), function () { sel = n.entity; chips(); draw(); history(); }, n.name); if (i) c.style.marginLeft = "16px"; row.appendChild(c); });
      S.cur = Math.max(0, names.map(function (n) { return n.entity; }).indexOf(sel));
      paint();
    };
    var history = function () {
      if (!S || demo || !S.api.ha || hist[sel]) return;
      var want = sel;
      S.api.ha("history", want).then(function (r) { if (S && r && r.ok) { hist[want] = { points: r.points || [] }; if (sel === want) draw(); } });
    };
    var reread = function () {
      if (!S || demo || !S.api.ha) return;
      S.readAt = Date.now();
      S.api.ha("sensors").then(function (r) { if (S && r && r.ok) { sensors = r.sensors || []; draw(); } else if (S && !sensors) { sensors = []; draw(); } });
    };
    chips(); draw();
    S.every = 5000;
    S.tick = function () { if (Date.now() - (S.readAt || 0) > 60000) reread(); };
    if (!demo) { if (!sensors) reread(); history(); }
  };

  // Speakers: each with its volume. Quieter and louder move it 5 at a time (presses are joined),
  // play or pause where the speaker can
  B.speakers = function (o, env) {
    var H = kit().ha, demo = !!env.demo, info = H.haOf(env).info || {};
    if (!demo && !(info.speakers && info.speakers.length)) return B.setup(o, env);
    var copy = function (l) { return l ? l.map(function (c) { var x = {}; for (var k in c) x[k] = c[k]; return x; }) : null; };
    var list = copy(H.speakersOf(env, o)), joinT = null;
    S.body.appendChild(head("speakers", op(o).label || "Speakers", "", "#ff375f"));
    var body = E("div", "cwd-col cwd-grow", "margin-top:30px");
    S.body.appendChild(body);
    var send = function (action, s, value, say) {
      if (demo || S.api.designer) { designerSays(); return; }
      if (!S.api.ha) return msg("Home Assistant is not set up on this TV");
      if (say) msg(say);
      S.api.ha(action, s.entity, value).then(function (r) {
        if (!S) return;
        if (!r || !r.ok) msg(r && r.error === "refused" ? s.name + " cannot do that from the TV" : "Home Assistant did not answer. Try again.");
        setTimeout(reread, 1500);
      });
    };
    var reread = function () {
      if (!S || demo || !S.api.ha || joinT) return;
      S.readAt = Date.now();
      S.api.ha("speakers").then(function (r) {
        if (!S || joinT) return;
        if (!r || !r.ok) { if (!list) { list = []; draw(); msg("Home Assistant is not answering"); } return; }
        var want = op(o).players, l = r.speakers || [];
        if (want && want.length) l = want.map(function (e) { return l.filter(function (c) { return c.entity === e; })[0]; }).filter(Boolean);
        list = l; draw();
      });
    };
    var draw = function () {
      var keep = S.stops[S.cur] && S.stops[S.cur].el.getAttribute("data-name");
      while (body.firstChild) body.removeChild(body.firstChild);
      S.stops = [];
      if (!list) { S.subEl.textContent = "Checking Home Assistant"; return; }
      S.subEl.textContent = list.filter(function (s) { return s.state === "playing"; }).length + " of " + list.length + " playing";
      list.slice(0, 6).forEach(function (s) {
        var ok = s.ok !== false, vol = ok && s.state !== "off" ? kit().clamp(s.volume || 0, 0, 100) : 0;
        var nudge = function (d) {
          return function () {
            if (!ok) return msg(s.name + " is not answering");
            if (s.can_volume === false) return msg(s.name + " has no volume Home Assistant can set");
            s.volume = kit().clamp((s.volume || 0) + d, 0, 100); draw();
            clearTimeout(joinT);
            joinT = setTimeout(function () { joinT = null; send("volume", s, s.volume, s.name + " to " + s.volume + "%"); }, 700);
          };
        };
        body.appendChild(E("div", "cwd-row", "margin-bottom:22px;padding:18px 26px;border-radius:30px;background:rgba(255,255,255,.08)" + (ok ? "" : ";opacity:.6"), [
          E("div", "cwd-col", "width:560px;flex:none;min-width:0", [E("div", "cwd-mid cwd-ell", "", [s.name || ""]), E("div", "cwd-small cwd-ell", "", [H.spkSong(s) || H.spkWord(s)])]),
          E("div", "cwd-col cwd-grow", "margin:0 30px;min-width:0", [E("div", "cwd-row", "justify-content:space-between", [E("span", "cwd-small", "", ["Volume"]), E("span", "cwd-mid", "", [H.spkWord(s)])]),
            E("div", "", "height:16px;border-radius:8px;background:rgba(255,255,255,.18);margin-top:10px;overflow:hidden", [E("div", "", "height:100%;border-radius:8px;background:#fff;width:" + vol + "%")])]),
          F(btn("minus", "", "cwd-round cwd-sm"), nudge(-5), s.name + " quieter"),
          E("div", "", "width:16px;flex:none"), F(btn("plus", "", "cwd-round cwd-sm"), nudge(5), s.name + " louder"),
          E("div", "", "width:16px;flex:none"), F(btn(s.state === "playing" ? "pause" : "play", "", "cwd-round cwd-sm"), function () {
            if (!ok) return msg(s.name + " is not answering");
            if (s.can_pause === false) return msg(s.name + " cannot play or pause from the TV");
            s.state = s.state === "playing" ? "paused" : "playing"; draw();
            send("playpause", s, "", s.name + (s.state === "playing" ? " playing" : " paused"));
          }, s.name + " play or pause")]));
      });
      var again = keep ? S.stops.map(function (x) { return x.el.getAttribute("data-name"); }).indexOf(keep) : -1;
      S.cur = again >= 0 ? again : Math.min(S.cur || 0, Math.max(0, S.stops.length - 1));
      paint();
    };
    draw();
    S.start = 1;   // the first speaker's louder
    S.redraw = draw;
    S.every = 2000;
    S.tick = function () { if (Date.now() - (S.readAt || 0) > 10000) reread(); };
    if (!demo) reread();
  };

  // Up next: the next songs on the Spotify account (to look at: Spotify itself changes the queue)
  B.queue = function (o, env) {
    var H = kit().ha, q = H.queueOf(env), items = q && q.ok ? (q.items || []).filter(function (s) { return s && s.title; }) : [];
    if (q && !q.ok) return B.setup(o, env);
    if (!q) { S.body.appendChild(head("music", op(o).label || "Up next", "Checking Spotify", "#1db954")); return; }
    S.body.appendChild(head("music", op(o).label || "Up next", items.length ? items.length + (items.length === 1 ? " song" : " songs") + " in the Spotify queue" : "Nothing up next in Spotify", "#1db954"));
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px", items.slice(0, 10).map(function (s, i) {
      var art = H.coverOk(s.art, env);
      return E("div", "cwd-row", "width:820px;height:120px", [E("div", "", "width:120px;height:120px;border-radius:18px;flex:none;background:#333 center/cover;" + (art ? "background-image:" + kit().cssImg(s.art) : "")),
        E("div", "cwd-col", "margin-left:26px;min-width:0;flex:1", [E("div", "cwd-mid cwd-ell", "", [(i + 1) + ". " + String(s.title).slice(0, 80)]), E("div", "cwd-small cwd-ell", "", [String(s.artist || "").slice(0, 80)])])]);
    })));
  };
  B.cards = function (o, env) {
    var cards = env.demo ? [{ title: "Solar today", value: "18.4 kWh" }, { title: "Pool", value: "26°" }, { title: "Rain gauge", value: "12 mm" }] : (kit().dataOf(env).cards || []);
    if (!cards.length) return B.setup(o, env);
    S.body.appendChild(head("info", "Custom cards", "Read by the computer bridge", "#5e5ce6"));
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px", cards.slice(0, 8).map(function (c) {
      return E("div", "cwd-card", "", [E("div", "cwd-mid cwd-ell", "opacity:.8", [String(c.title || "")]), E("div", "cwd-big cwd-ell", "font-size:72px;margin-top:20px", [String(c.value || "")])]);
    })));
  };
  // the web widgets (widget-web.js): what the widget has, bigger; reading only, nothing opens a link
  function wk() { return (window.CouchWidgets && window.CouchWidgets.webKit) || {}; }
  function webRec(env, src, id) { var f = wk().webOf; return f ? f(env, src, id) : null; }
  function updated(rec) { if (!rec || !rec.at) return ""; var d = new Date(rec.at), h = d.getHours(), m = d.getMinutes(); return "Updated " + ((h % 12) || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? "am" : "pm") + (rec.stale ? ", not lately" : ""); }
  B.news = function (o, env) {
    var WW = window.CouchWidgetWeb, q = op(o), feed = WW ? WW.feedOf(q.feed) : "abc", name = q.label || (WW ? WW.FEEDS[feed].name : "Headlines"), rec = null, items;
    if (env.demo) items = (wk().DEMO_NEWS || []).map(function (x) { return { title: x[0], at: Date.now() - x[1] * 3600000 }; });
    else { rec = webRec(env, "news", feed); if (!rec || !rec.ok || !rec.v || !rec.v.length) return B.setup(o, env); items = rec.v; }
    S.body.appendChild(head("info", name, rec ? updated(rec) : "The latest headlines", "#ff453a"));
    // two columns of three: six headlines, each on three lines at most
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:30px", items.slice(0, 6).map(function (x) {
      return F(E("div", "cwd-news", "width:780px", [x.at ? E("div", "cwd-small", "color:#ff453a;font-weight:700", [wk().agoOf ? wk().agoOf(x.at) : ""]) : null,
        E("div", "cwd-big", "font-size:40px;margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden", [x.title])]), null, x.title);
    })));
  };
  // the round: every game with its score, in the order it is played (up to 12; a line says how many more)
  B.sports = function (o, env) {
    var WW = window.CouchWidgetWeb, q = op(o), id = WW ? WW.leagueOf(q.league) : "nrl", rec = null, v;
    if (env.demo) v = wk().demoScores ? wk().demoScores() : { games: [] };
    else { rec = webRec(env, "sports", id); if (!rec || !rec.ok || !rec.v || !rec.v.games || !rec.v.games.length) return B.setup(o, env); v = rec.v; }
    var games = v.games.slice().sort(function (a, b) { return a.at - b.at; }), shown = games.slice(0, 12), n = shown.length;
    var cols = n <= 6 ? 2 : n <= 9 ? 3 : 4, w = Math.floor((1600 - (cols - 1) * 24) / cols), big = cols <= 2 ? 56 : cols === 3 ? 48 : 40, mid = cols <= 3 ? 34 : 29;
    S.body.appendChild(head("tv", q.label || v.league || "Scores", [v.round, rec ? updated(rec) : ""].filter(Boolean).join(". ") || "This round", "#0a6e8a"));
    var team = function (t, g) {
      var dim = g.state === "post" && !t.win;
      return E("div", "cwd-row", "justify-content:space-between;min-width:0", [E("div", "cwd-row", "min-width:0", [E("i", "cwd-dot", "flex:none;background:" + (t.colour || "rgba(255,255,255,.35)")), E("span", "cwd-mid cwd-ell", "font-size:" + mid + "px;font-weight:" + (g.state === "post" && t.win ? 760 : 560) + ";opacity:" + (dim ? 0.7 : 1), [t.name || t.abbr])]),
        E("span", "cwd-big", "font-size:" + (String(t.score).length > 5 ? Math.round(big * 0.6) : big) + "px;white-space:nowrap;margin-left:14px;opacity:" + (dim ? 0.7 : 1), [String(t.score || "")])]);
    };
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:26px", shown.map(function (g) {
      var st = wk().gameStatus ? wk().gameStatus(g, env) : { text: "" };
      return F(E("div", "cwd-game", "width:" + w + "px;padding:" + (cols <= 2 ? "24px 32px" : "18px 24px"), [team(g.teams[0], g), team(g.teams[1], g), E("div", "cwd-small cwd-ell", "margin-top:8px;color:" + (st.live ? "#ff453a" : "rgba(255,255,255,.7)"), [[g.title, st.text].filter(Boolean).join(". ")])]),
        null, (g.teams[0].name || "") + " v " + (g.teams[1].name || ""));
    })));
    if (games.length > n) S.body.appendChild(E("div", "cwd-small", "margin-top:14px", ["And " + (games.length - n) + " more games"]));
  };
  // every pick, from what everyone at home has on the go on this TV; Resume plays it
  B.picks = function (o, env) {
    var list = wk().picksOf ? wk().picksOf(env) : [];
    if (!list.length) return B.setup(o, env);
    S.body.appendChild(head("favourite", op(o).label || "Picks for you", "From what everyone at home is watching on this TV", "#bf5af2"));
    var track = E("div", "cwd-track");
    list.forEach(function (s, i) {
      track.appendChild(F(E("div", "cwd-show", "", [E("div", "cwd-art", s.art ? "background-image:" + kit().cssImg(s.art) : "", [s.progress ? E("div", "cwd-prog", "", [E("b", "", "width:" + Math.round(s.progress * 100) + "%")]) : null,
        E("div", "cwd-resume", "", [ic("play", 30, "#111", "solid"), "Play"])]),
        E("div", "cwd-row", "margin-top:18px", [s.app ? kit().appIcon(s.app, 44, env) : null, E("div", "cwd-col", "margin-left:14px;min-width:0", [E("div", "cwd-mid", "overflow-wrap:anywhere", [s.title]), E("div", "cwd-small", "", [s.why || ""])])])]),
        function () { if (designerSays()) return; S.api.act("pick", String(i)); close(true); }, s.title));
    });
    S.body.appendChild(E("div", "cwd-scroll cwd-grow", "margin-top:40px", [track]));
  };
  // the drive: how long, how far, when to leave, and where the route comes from (OpenStreetMap's credit)
  B.commute = function (o, env) {
    var host = document.createElement("div"), V = wk().commuteOf ? wk().commuteOf(host, o, { w: 1760, h: 960 }, env) : null;
    if (!V) return B.setup(o, env);
    var c = kit().dataOf(env).commute || {}, from = env.demo ? "Home" : (c.from && c.from.name) || "", to = env.demo ? "Work" : (c.to && c.to.name) || "";
    S.body.appendChild(head("location", V.label, (from && to ? "From " + from + " to " + to + ". " : "") + "The usual drive by road, no live traffic", "#0a84ff"));
    var tile = function (name, big, sub) { return F(E("div", "cwd-game", "width:520px", [E("div", "cwd-small", "", [name]), E("div", "cwd-big", "font-size:72px;margin-top:8px", [big]), sub ? E("div", "cwd-small", "margin-top:6px", [sub]) : null]), null, name); };
    var lb = V.leave ? V.leave.replace(/^(.*?)(leave by|Leave by) /, "") : "";
    S.body.appendChild(E("div", "cwd-grid", "align-content:flex-start;margin-top:30px", [tile("Drive", V.minutes + " min", "Without traffic"), tile("Distance", V.km + " km", "By road"),
      tile(V.leave ? (/^Leave/.test(V.leave) ? "Leave by" : V.leave.replace(/, leave by .*/, "") + ", leave by") : "Leave by", lb || "Not set", V.leave ? (V.arrive ? "To arrive by " + V.arrive : "") : "Set an arrive by time in couch-tv Studio")]));
    S.body.appendChild(E("div", "cwd-grow"));
    S.body.appendChild(E("div", "cwd-small", "", ["Route by OSRM from OpenStreetMap. Map data © OpenStreetMap contributors."]));
  };
  // the watchlist with today's line for each (the day's prices, from the first trade to now)
  B.stocks = function (o, env) {
    var WW = window.CouchWidgetWeb, q = op(o), list = WW ? WW.tickersOf(q.tickers) : [], rec = null, quotes;
    if (env.demo) quotes = list.map(function (s, i) { return wk().demoQuote(s, i); });
    else {
      rec = webRec(env, "stocks", list.join(","));
      if (!rec || !rec.ok || !rec.v) return B.setup(o, env);
      quotes = list.map(function (s) { return (rec.v.quotes || {})[s]; }).filter(Boolean);
      if (!quotes.length) return B.setup(o, env);
    }
    S.body.appendChild(head("info", q.label || "Markets", ["From Yahoo Finance, about 20 minutes late", rec ? updated(rec) : ""].filter(Boolean).join(". "), "#30a46c"));
    var w = quotes.length <= 4 ? 790 : 520;
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:26px", quotes.map(function (x) {
      var pts = x.points || [], lo = Math.min.apply(null, pts.concat([x.prev || x.price])), hi = Math.max.apply(null, pts.concat([x.prev || x.price])), span = hi - lo || 1, cw = w - 64, ch = 90;
      var path = pts.map(function (v, i) { return (i ? "L" : "M") + Math.round(i / Math.max(1, pts.length - 1) * cw) + " " + Math.round(ch - (v - lo) / span * ch); }).join(" ");
      var base = x.prev ? Math.round(ch - (x.prev - lo) / span * ch) : null, col = wk().upDown ? wk().upDown(x.change) : "#fff";
      var line = pts.length > 1 ? kit().svg("0 0 " + cw + " " + ch, cw, ch, [base !== null ? kit().S("line", { x1: 0, y1: base, x2: cw, y2: base, stroke: "rgba(255,255,255,.3)", "stroke-width": 2, "stroke-dasharray": "4 8" }) : null,
        kit().S("path", { d: path, fill: "none", stroke: col, "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" })], "margin-top:14px;display:block") : null;
      return F(E("div", "cwd-game", "width:" + w + "px", [E("div", "cwd-row", "justify-content:space-between", [E("span", "cwd-mid cwd-ell", "min-width:0", [x.name]), E("span", "cwd-chip on", "flex:none;margin-left:14px;background:" + col + ";color:#fff", [WW ? WW.change(x) || "0%" : ""])]),
        E("div", "cwd-big", "font-size:52px;margin-top:8px", [WW ? WW.price(x) : String(x.price)]), line]), null, x.name);
    })));
  };

  // ---------------- focus inside a layer: the same geometry as the home (design.js NAV) ----------------
  function box(el) { var r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }
  function pick(from, cands, dx, dy) {
    var beyond = function (b) { return dx > 0 ? b.l >= from.r - 2 : dx < 0 ? b.r <= from.l + 2 : dy > 0 ? b.t >= from.b - 2 : b.b <= from.t + 2; };
    var overlap = function (b) { return dx ? Math.min(from.b, b.b) - Math.max(from.t, b.t) : Math.min(from.r, b.r) - Math.max(from.l, b.l); };
    var edge = function (b) { return dx > 0 ? b.l - from.r : dx < 0 ? from.l - b.r : dy > 0 ? b.t - from.b : from.t - b.b; };
    var c = cands.filter(function (x) { return beyond(x.b); });
    if (!c.length) return null;
    var lined = c.filter(function (x) { return overlap(x.b) > 1; });
    if (lined.length) { lined.sort(function (a, b) { var d = edge(a.b) - edge(b.b); if (Math.abs(d) > 2) return d; return overlap(b.b) - overlap(a.b); }); return lined[0]; }
    c.sort(function (a, b) { return (edge(a.b) + 2 * Math.max(0, -overlap(a.b))) - (edge(b.b) + 2 * Math.max(0, -overlap(b.b))); });
    return c[0];
  }
  function moveFocus(dx, dy) {
    if (!S.stops.length) return false;
    var cur = S.stops[S.cur];
    if (!cur) { S.cur = 0; paint(); return true; }
    // back the way you came: to where you were
    if (S.lastMove && S.lastMove.dx === -dx && S.lastMove.dy === -dy && S.lastMove.to === S.cur && S.stops[S.lastMove.from]) { var f0 = S.lastMove.from; S.lastMove = null; S.cur = f0; paint(); return true; }
    var from = box(cur.el), cands = S.stops.map(function (s, i) { return { i: i, b: box(s.el) }; }).filter(function (x) { return x.i !== S.cur; });
    var p = pick(from, cands, dx, dy);
    if (!p) return false;
    S.lastMove = { dx: dx, dy: dy, from: S.cur, to: p.i };
    S.cur = p.i;
    paint();
    return true;
  }
  // keeps the focused item in view inside a sliding row
  function reveal(el) {
    var track = el.parentNode;
    while (track && !(track.classList && track.classList.contains("cwd-track"))) track = track.parentNode;
    if (!track) return;
    var view = track.parentNode.offsetWidth, x = el.offsetLeft, w = el.offsetWidth, shift = S.shift || 0;
    // room for the ring and the lift on both sides
    if (x - shift < 60) shift = Math.max(0, x - 60);
    else if (x + w - shift > view - 60) shift = x + w - view + 60;
    shift = clamp(shift, 0, Math.max(0, track.scrollWidth - view + 60));
    S.shift = shift;
    track.style.transform = "translateX(" + (-shift) + "px)";
  }
  function paint() {
    if (!S) return;
    S.stops.forEach(function (s, i) { s.el.classList.toggle("cwd-f", i === S.cur); });
    if (S.stops[S.cur]) reveal(S.stops[S.cur].el);
  }

  // ---------------- open and close ----------------
  function stageScale() { return (window.innerWidth || 1920) / STAGE.w; }
  function rectIn(el) {
    var k = stageScale(), r = el.getBoundingClientRect();
    return { left: r.left / k, top: r.top / k, width: Math.max(40, r.width / k), height: Math.max(40, r.height / k) };
  }
  function xf(r, t) { return "translate(" + px(r.left - t.left) + "," + px(r.top - t.top) + ") scale(" + (r.width / t.width).toFixed(4) + "," + (r.height / t.height).toFixed(4) + ")"; }
  function open(from, env, api) {
    if (!kit() || !from) return false;
    if (S) close(true);
    var o = from.__o || { kind: from.getAttribute("data-kind") || "" }, name = from.getAttribute("data-arg") || LAYER[o.kind] || "setup";
    if (!B[name]) name = "setup";
    var wrap = from; while (wrap && !(wrap.classList && wrap.classList.contains("cw-o"))) wrap = wrap.parentNode;
    S = { name: name, o: o, env: env || {}, api: api || {}, from: from, id: wrap ? wrap.getAttribute("data-obj") : "", stops: [], cur: 0, start: 0, said: false };
    var scrim = E("div", "cwd-scrim"), stage = E("div", "cwd-stage", "transform:scale(" + stageScale() + ")"), panel = E("div", "cwd-panel"), body = E("div", "cwd-in");
    S.scrim = scrim; S.stage = stage; S.panel = panel; S.body = body;
    S.msgEl = E("div", "cwd-msg");
    panel.appendChild(body); panel.appendChild(S.msgEl); stage.appendChild(panel);
    try { B[name](o, S.env); } catch (e) { while (body.firstChild) body.removeChild(body.firstChild); S.stops = []; B.setup(o, S.env); }
    var target = S.full ? { left: 0, top: 0, width: STAGE.w, height: STAGE.h } : PANEL;
    panel.style.left = px(target.left); panel.style.top = px(target.top); panel.style.width = px(target.width); panel.style.height = px(target.height);
    S.target = target;
    document.body.appendChild(scrim); document.body.appendChild(stage);
    document.documentElement.classList.add("cwd-open");
    S.cur = clamp(S.start || 0, 0, Math.max(0, S.stops.length - 1));
    paint();
    // the widget's own box grows into the sheet (one transform: the compositor does it), then the words
    var src = rectIn(from);
    if (reduced()) { panel.classList.add("cwd-fade"); body.style.opacity = "1"; }
    else {
      panel.style.transition = "none"; panel.style.transform = xf(src, target); panel.style.opacity = "0.6";
      void panel.offsetWidth;
      panel.style.transition = "";
      panel.style.transform = "none"; panel.style.opacity = "1";
    }
    scrim.classList.add("on"); panel.classList.add("on");
    S.timer = setInterval(function () { if (!S) return; if (S.tick && Date.now() - (S.tickAt || 0) >= (S.every || 1000)) { S.tickAt = Date.now(); try { S.tick(); } catch (e) {} } }, 250);
    from.style.visibility = "hidden";
    S.hidden = from;
    return true;
  }
  function close(now) {
    if (!S) return false;
    var s = S;
    S = null;
    clearInterval(s.timer); clearTimeout(s.msgT);
    var done = function () {
      if (s.scrim.parentNode) s.scrim.parentNode.removeChild(s.scrim);
      if (s.stage.parentNode) s.stage.parentNode.removeChild(s.stage);
      if (s.hidden) s.hidden.style.visibility = "";
      if (!S) document.documentElement.classList.remove("cwd-open");
    };
    var back = (function () { var w = document.querySelector('.cw-o[data-obj="' + String(s.id).replace(/[^A-Za-z0-9_-]/g, "") + '"] .cw'); return w || s.from; })();
    if (s.hidden && s.hidden !== back) s.hidden.style.visibility = "";
    if (now || reduced() || !back || !back.getBoundingClientRect) { done(); return true; }
    back.style.visibility = "hidden"; s.hidden = back;
    s.panel.classList.add("closing");
    s.scrim.classList.remove("on");
    s.panel.style.transform = xf(rectIn(back), s.target); s.panel.style.opacity = "0.4";
    setTimeout(done, 340);
    return true;
  }

  // ---------------- keys (design.js hands them over while a layer is open) ----------------
  var ARW = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
  var ARC = { 38: [0, -1], 40: [0, 1], 37: [-1, 0], 39: [1, 0], 19: [0, -1], 20: [0, 1], 21: [-1, 0], 22: [1, 0] };
  function arrow(e) { return ARW[e.key] || ((!e.key || e.key === "Unidentified") ? ARC[e.keyCode] : null) || null; }
  function isOk(e) { return e.key === "Enter" || e.key === " " || e.key === "Select" || e.key === "NumpadEnter" || e.keyCode === 13 || e.keyCode === 23; }
  function isBack(e) { return ["Escape", "Esc", "Backspace", "GoBack", "BrowserBack"].indexOf(e.key) >= 0 || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461; }
  function keydown(e) {
    if (!S) return false;
    if (isBack(e)) { if (!e.repeat) close(); return true; }
    var a = arrow(e);
    if (a) {
      if (document.documentElement.dir === "rtl") a = [-a[0], a[1]];
      if (S.key && S.key(a, false)) return true;
      moveFocus(a[0], a[1]);
      return true;
    }
    if (isOk(e)) {
      if (!e.repeat) {
        S.okDown = true; S.held = false; clearTimeout(S.holdT);
        // Hold OK on a stop that has more to offer (an app in a folder: change, move, remove)
        var hs = S.stops[S.cur];
        if (hs && hs.hold) S.holdT = setTimeout(function () { if (S && S.okDown) { S.held = true; S.okDown = false; hs.hold(); } }, 650);
      }
      return true;
    }
    return true;   // every other key stays in the layer while it is open
  }
  function keyup(e) {
    if (!S) return false;
    if (isOk(e)) {
      clearTimeout(S.holdT);
      if (!S.okDown) return true;
      S.okDown = false;
      if (S.key && S.key(null, true)) return true;
      var s = S.stops[S.cur];
      if (s && s.fn) { s.el.classList.remove("cwd-press"); void s.el.offsetWidth; s.el.classList.add("cwd-press"); s.fn(); }
      return true;
    }
    return true;
  }

  // a timer that runs out says so wherever the home is (a soft three note chime and a line at the
  // bottom), once, then waits for Stop in Timers or ten minutes
  var watching = null;
  function chime() {
    try {
      var A = window.AudioContext || window.webkitAudioContext, ctx = new A();
      [0, 0.35, 0.7].forEach(function (t, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = [880, 1108, 1318][i]; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.65);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 2000);
    } catch (e) {}
  }
  function watchTimer() {
    if (watching || !kit()) return;
    watching = setInterval(function () {
      var T = kit().Timer, t = T.live();
      if (!t) { clearInterval(watching); watching = null; return; }
      if (t.seen || Date.now() < t.end) return;
      t.seen = 1; T.put(t);
      chime();
      var tip = E("div", "cw-tip cwd-tip", "", [ic("timer", 30, "#ff9f0a"), " " + t.label + ": time's up"]);
      document.body.appendChild(tip);
      setTimeout(function () { tip.style.opacity = "0"; setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 700); }, 9000);
    }, 1000);
  }
  var tries = 0;
  function hookTimer() { if (!kit()) { if (++tries < 20) setTimeout(hookTimer, 500); return; } kit().Timer.on(function (t) { if (t) watchTimer(); }); if (kit().Timer.live()) watchTimer(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookTimer); else hookTimer();

  window.CouchDetail = {
    layers: function () { return Object.keys(B); },
    layerOf: function (kind) { return LAYER[kind] || null; },
    map: function () { return JSON.parse(JSON.stringify(LAYER)); },
    title: function (name) { return TITLE[name] || ""; },
    open: open, close: function (now) { return close(now); }, isOpen: function () { return !!S; },
    current: function () { return S ? { name: S.name, kind: S.o.kind, stops: S.stops.length, focus: S.cur, focusName: S.stops[S.cur] ? S.stops[S.cur].el.getAttribute("data-name") : "" } : null; },
    keydown: keydown, keyup: keyup,
    // tests: press a direction or OK without a keyboard
    move: function (dx, dy) { return S ? (S.key && S.key([dx, dy], false)) || moveFocus(dx, dy) : false; },
    ok: function () { if (!S) return false; if (S.key && S.key(null, true)) return true; var s = S.stops[S.cur]; if (s && s.fn) s.fn(); return true; }
  };
})();
