// The detail layer: what opens when OK is pressed on a widget (TV Designer v10). The widget grows
// into a sheet over the home, the way the wall tablet's cards do (home-hub wall/app.js openSheet:
// the card's own box grows to the sheet with one transform, the words fade in after it, Back shrinks
// it back into the card). On a TV it is drawn for 3 m away: words 25 px and up, one focus ring, the
// remote moves by geometry the way the home does (GRID.md, Focus), and Back always closes it.
//
// What a layer shows comes from the same places the widget does (widgets.js kit): demo data in TV
// Designer, the TV's own data on a TV, or the widget's setup record (widget-caps.js) when the TV has
// nothing real yet. Never pretend data on a TV. What a layer does goes through design.js (api.act:
// the app.js hooks, the same ones a widget's own buttons use) or Home Assistant through the
// launcher (api.ha). In TV Designer nothing is switched: the layer says so.
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
    photo: "photos", slideshow: "photos", mosaic: "photos", artframe: "photos",
    keep: "keep", keeprow: "keep", upnext: "keep", folder: "folder", nowplaying: "player",
    aircon: "aircon", scenes: "scenes", controls: "controls", camera: "camera", doorbell: "camera",
    card: "cards", news: "news", sports: "sports",
    memory: "setup", picks: "setup", queue: "setup", speakers: "setup", energy: "setup", sensor: "setup", battery: "setup",
    note: "setup", list: "setup", stocks: "setup", commute: "setup", wifi: "setup", guide: "setup", screentime: "setup"
  };
  var TITLE = { timers: "Timers", forecast: "Forecast", world: "World clocks", calendar: "Calendar", moon: "Moon", air: "Air quality", surf: "Surf",
    photos: "Photos", keep: "Keep watching", folder: "Apps", player: "Now playing", aircon: "Aircon", scenes: "Scenes", controls: "Control Centre",
    camera: "Camera", cards: "Custom cards", news: "Headlines", sports: "Scores", setup: "Set up" };

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
  // In TV Designer nothing in the house is switched, and the layer says so (once)
  function designerSays() { if (S.api.designer && !S.said) { S.said = true; msg("In TV Designer this only shows what OK does. Nothing is switched."); return true; } return S.api.designer; }
  function btn(iconName, text, cls) { return E("div", "cwd-btn" + (cls ? " " + cls : ""), "", [iconName ? ic(iconName, 34, "currentColor", "solid") : null, text ? E("span", "", "", [text]) : null]); }
  function chip(text, on) { return E("div", "cwd-chip" + (on ? " on" : ""), "", [text]); }

  // ---------------- the layers: B[name](o, env) adds to S.body ----------------
  var B = {};

  // the setup record (widget-caps.js), for a widget with nothing real to show yet
  var WHERE = { tv: "On this TV", phone: "From the phone remote", computer: "On the computer at home", designer: "In TV Designer", nothing: "Nothing to set up" };
  var STATUS = { works: ["Works on this TV", "#30d158"], setup: ["Needs setting up", "#ffd60a"], "not-built": ["Not on couch-tv yet", "#ff9f0a"] };
  B.setup = function (o) {
    var kind = (S.from && S.from.getAttribute("data-setup")) || o.kind, C = window.CouchWidgetCaps, c = C && C.get(kind);
    S.panel.classList.add("cwd-setup");
    if (!c) { S.body.appendChild(head("info", "This widget", "It needs a newer couch-tv")); return; }
    var st = STATUS[c.status] || STATUS.setup;
    S.body.appendChild(head("info", c.name, "", st[1]));
    S.subEl.appendChild(E("span", "cwd-pill", "background:" + st[1], [st[0]]));
    var group = function (keys) { var ons = keys.map(function (k) { return c.platforms[k] ? c.platforms[k].on : "no"; }); return ons.indexOf("yes") >= 0 ? "yes" : ons.indexOf("setup") >= 0 ? "setup" : ons.indexOf("partial") >= 0 ? "partial" : "no"; };
    var WORD = { yes: "Works", setup: "Once set up", partial: "Partly", no: "No" };
    var tvs = [["Google TV, Android TV, Fire TV", ["Google TV", "Android TV", "Fire OS"]], ["Samsung, LG, Hisense and the browser TVs", ["Tizen", "webOS", "VIDAA", "Saphi", "TiVo OS", "My Home Screen"]],
      ["Roku, Apple TV, Vega and others", ["Roku OS", "tvOS", "Vega OS", "Titan OS", "SmartCast", "Other"]]];
    var left = E("div", "cwd-col", "width:820px", [label("What it shows"), E("div", "cwd-text", "", [c.what]), label("What it needs"),
      E("div", "cwd-list", "", c.needs.map(function (n) { return E("div", "cwd-li", "", [E("i", "cwd-bullet"), E("span", "", "", [n])]); })),
      label("Which TVs"), E("div", "cwd-col", "", tvs.map(function (g) { var v = group(g[1]); return E("div", "cwd-tvrow", "", [E("span", "", "", [g[0]]), E("b", "cwd-tv-" + v, "", [WORD[v]])]); }))]);
    var right = E("div", "cwd-col", "flex:1;margin-left:64px;min-width:0", [label(c.status === "not-built" ? "What has to be built first" : "Where to set it up"),
      c.status === "not-built" ? E("div", "cwd-text", "", [c.build]) : E("div", "cwd-text", "", [E("b", "", "", [WHERE[c.setup.where] || ""]), ". " + c.setup.how]),
      c.status === "not-built" ? label("Until then") : label("Until it is set up"), E("div", "cwd-text", "", [c.until]),
      label("OK on the widget"), E("div", "cwd-text", "", [c.ok])]);
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:30px", [left, right]));
  };

  // timers: one at a time, kept on the TV (widgets.js Timer)
  var LABELS = ["Timer", "Oven", "Pizza", "Bath", "Homework", "Bedtime", "Tea"];
  B.timers = function () {
    var T = kit().Timer, now = kit().now();
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
    if (o.kind === "agenda" && env.demo) {
      todayCol.appendChild(label("Today"));
      [["#ff9f0a", "School drop off", "8:30am"], ["#30d158", "Swimming lessons", "4:00pm"], ["#64d2ff", "Bins out", "7:00pm"], ["#bf5af2", "Movie night", "7:30pm"]].forEach(function (e) {
        todayCol.appendChild(E("div", "cwd-ev", "", [E("i", "", "background:" + e[0]), E("span", "", "", [e[1]]), E("b", "", "", [e[2]])]));
      });
    }
    S.body.appendChild(E("div", "cwd-row cwd-grow", "align-items:flex-start;margin-top:36px", [todayCol, E("div", "cwd-row", "margin-left:60px;align-items:flex-start", [monthGrid(y, m, d.getDate()), E("div", "", "width:56px"), monthGrid(m === 11 ? y + 1 : y, (m + 1) % 12, -1)])]));
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
    var q = op(o), list = q.image ? [q.image] : (o.kind === "artframe" && env.demo ? [kit().demoImg("art")] : kit().photos(env, o));
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
      count.textContent = (at + 1) + " of " + list.length;
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
    apps.forEach(function (p) {
      var n = kit().appNode(p, 200, env);
      n.removeAttribute("data-act");
      grid.appendChild(F(E("div", "cwd-app", "", [n, E("div", "cwd-small cwd-ell", "", [kit().appName(p, env)])]), function () { if (designerSays()) return; S.api.act("app", p); close(true); }, kit().appName(p, env)));
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

  // Control Centre, camera, headlines and scores: TV Designer shows what they will look like; a TV
  // shows their setup record (widgets.js draws them empty there, which opens B.setup)
  B.controls = function (o, env) {
    if (!env.demo) return B.setup(o, env);
    var items = op(o).controls && op(o).controls.length ? op(o).controls : [{ icon: "light", name: "Lounge" }, { icon: "lamp", name: "Lamp" }, { icon: "pendant", name: "Kitchen" }, { icon: "blinds", name: "Blinds" }, { icon: "fan", name: "Ceiling fan" }, { icon: "outlet", name: "Heater" }, { icon: "speaker", name: "Speakers" }, { icon: "light-off", name: "Porch" }];
    var on = items.map(function (x, i) { return i % 2 === 0; });
    S.body.appendChild(head("home", op(o).label || "Control Centre", "", "#30d158"));
    var grid = E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px");
    var draw = function () {
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      S.stops = [];
      items.forEach(function (x, i) {
        grid.appendChild(F(E("div", "cwd-toggle" + (on[i] ? " on" : ""), "", [E("div", "cwd-sic", "", [ic(x.icon, 44, on[i] ? "#1a1406" : "#fff", "solid")]), E("div", "cwd-mid cwd-ell", "", [x.name]), E("div", "cwd-small", "", [on[i] ? "On" : "Off"])]),
          function () { on[i] = !on[i]; designerSays(); draw(); }, x.name));
      });
      S.subEl.textContent = on.filter(Boolean).length + " of " + items.length + " on";
      paint();
    };
    S.body.appendChild(grid);
    draw();
  };
  B.camera = function (o, env) {
    if (!env.demo) return B.setup(o, env);
    S.full = true;
    S.panel.classList.add("cwd-photos");
    S.body.appendChild(E("div", "cwd-pstage", "", [E("div", "cwd-photo", "", [E("div", "cwd-pimg", "background-size:cover;filter:saturate(.75) contrast(1.05);background-image:" + kit().cssImg(o.kind === "doorbell" ? kit().bgImg("grose-valley") : kit().demoImg("dog")))]),
      E("div", "cwd-live", "", [E("i"), op(o).label || (o.kind === "doorbell" ? "Front door" : "Backyard"), E("span", "", "", [o.kind === "doorbell" ? "Last ring 2:14pm" : "Live, a new picture every 2 seconds"])]),
      E("div", "cwd-phint", "", ["Back closes."])]));
  };
  B.cards = function (o, env) {
    var cards = env.demo ? [{ title: "Solar today", value: "18.4 kWh" }, { title: "Pool", value: "26°" }, { title: "Rain gauge", value: "12 mm" }] : (kit().dataOf(env).cards || []);
    if (!cards.length) return B.setup(o, env);
    S.body.appendChild(head("info", "Custom cards", "Read by the computer bridge", "#5e5ce6"));
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:36px", cards.slice(0, 8).map(function (c) {
      return E("div", "cwd-card", "", [E("div", "cwd-mid cwd-ell", "opacity:.8", [String(c.title || "")]), E("div", "cwd-big cwd-ell", "font-size:72px;margin-top:20px", [String(c.value || "")])]);
    })));
  };
  B.news = function (o, env) {
    if (!env.demo) return B.setup(o, env);
    S.body.appendChild(head("info", "Headlines", "Top stories", "#ff453a"));
    S.body.appendChild(E("div", "cwd-col cwd-grow", "margin-top:30px", [["Local", "Highway roadworks finish a month early", "1h"], ["Weather", "Storm season outlook: a wetter summer than usual", "2h"], ["Sport", "Matildas name squad for December friendlies", "3h"], ["Business", "Petrol prices ease ahead of the holidays", "4h"]].map(function (x) {
      return F(E("div", "cwd-news", "", [E("div", "cwd-small", "color:#ff453a;font-weight:700", [x[0] + " · " + x[2]]), E("div", "cwd-big", "font-size:44px;margin-top:6px", [x[1]])]), null, x[1]);
    })));
  };
  B.sports = function (o, env) {
    if (!env.demo) return B.setup(o, env);
    S.body.appendChild(head("tv", op(o).label || "NRL", "This round", "#0a6e8a"));
    var games = [["Titans", "#00a6e2", 24, "Broncos", "#7c1d3f", 18, "Full time"], ["Rabbitohs", "#00843d", 12, "Roosters", "#002b5c", 12, "Live, 62 min"], ["Storm", "#592c82", 6, "Raiders", "#6bbe45", 0, "Live, 21 min"], ["Sharks", "#00a9d8", 0, "Eels", "#ffcc00", 0, "7:50pm"]];
    var team = function (n, c, s, win) { return E("div", "cwd-row", "justify-content:space-between", [E("div", "cwd-row", "", [E("i", "cwd-dot", "background:" + c), E("span", "cwd-mid", "font-weight:" + (win ? 760 : 520), [n])]), E("span", "cwd-big", "font-size:56px;opacity:" + (win ? 1 : 0.6), [String(s)])]); };
    S.body.appendChild(E("div", "cwd-grid cwd-grow", "align-content:flex-start;margin-top:30px", games.map(function (g) {
      return F(E("div", "cwd-game", "", [team(g[0], g[1], g[2], g[2] >= g[5]), team(g[3], g[4], g[5], g[5] >= g[2]), E("div", "cwd-small", "margin-top:10px;color:" + (/Live/.test(g[6]) ? "#ff453a" : "rgba(255,255,255,.7)"), [g[6]])]), null, g[0] + " v " + g[3]);
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
    if (isOk(e)) { if (!e.repeat) S.okDown = true; return true; }
    return true;   // every other key stays in the layer while it is open
  }
  function keyup(e) {
    if (!S) return false;
    if (isOk(e)) {
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
