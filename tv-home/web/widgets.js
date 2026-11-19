// Widgets for a design (couch-tv Studio v10, tools/tv-designer/widgets/CATALOGUE.md). design.js checks a
// widget (sanitize) and places it; this file draws its inside: one renderer per kind, built element by
// element (text is always a text node, never markup from a design). Icons come from icon-sets.js
// (code that ships with the home), parsed with DOMParser.
//
// What a widget shows: in the designer, demo data (env.demo); on a TV, what the TV really has (the
// clock, its weather, its photos, its apps, Home Assistant), or, when it has nothing, a plain line in
// the widget's own box saying what is missing ("Connect your calendar on the TV"). Never fake data.
//
// ES5 on purpose: old Android TV WebViews.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var CW = { base: "", logoBase: "../../remote/src/app-logos/" };
  var REG = [], TICK = null;
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---------------- building blocks ----------------
  function add(e, kids) {
    if (kids === null || kids === undefined || kids === false || kids === "") return e;
    if (Object.prototype.toString.call(kids) !== "[object Array]") kids = [kids];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === null || k === undefined || k === false || k === "") continue;
      e.appendChild(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
    }
    return e;
  }
  // css is always built here from numbers, fixed words and checked colours, never from a design's words
  function E(tag, cls, css, kids) { var e = document.createElement(tag); if (cls) e.className = cls; if (css) e.style.cssText = css; return add(e, kids); }
  function S(tag, at, kids) {
    var e = document.createElementNS(NS, tag);
    for (var k in at) if (Object.prototype.hasOwnProperty.call(at, k)) e.setAttribute(k, String(at[k]));
    return add(e, kids);
  }
  function svg(vb, w, h, kids, css) {
    var s = S("svg", { viewBox: vb, width: w, height: h, "class": "cw-svg", focusable: "false" }, kids);
    // its size inline too: a page around it (the designer) may size every svg by a rule of its own
    s.style.cssText = "width:" + (typeof w === "number" ? px(w) : w) + ";height:" + (typeof h === "number" ? px(h) : h) + ";" + (css || "");
    return s;
  }
  function px(n) { return Math.round(n) + "px"; }
  function stop(el, act, arg, name) { el.setAttribute("data-act", act); if (arg !== undefined) el.setAttribute("data-arg", String(arg)); if (name) el.setAttribute("data-name", String(name)); return el; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // colours: only ones design.js let through, or our own
  function rgbOf(c) {
    c = String(c || "").trim();
    var m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) {
      var x = m[1];
      if (x.length === 3 || x.length === 4) x = x.charAt(0) + x.charAt(0) + x.charAt(1) + x.charAt(1) + x.charAt(2) + x.charAt(2);
      return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function lum(rgb) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function rgba(rgb, a) { return "rgba(" + Math.round(rgb[0]) + ", " + Math.round(rgb[1]) + ", " + Math.round(rgb[2]) + ", " + a + ")"; }
  function shade(rgb, f) { return "rgb(" + Math.round(rgb[0] * f) + ", " + Math.round(rgb[1] * f) + ", " + Math.round(rgb[2] * f) + ")"; }
  var INK_DARK = [29, 27, 24], WHITE = [255, 255, 255];
  // the text colour for a tile: white or dark ink, whichever reads better (at least 4.5 : 1 where it can)
  function autoInk(tile) { return !tile ? WHITE : contrast(tile, WHITE) >= 4.5 || contrast(tile, WHITE) >= contrast(tile, INK_DARK) ? WHITE : INK_DARK; }

  // icons: couch-tv Studio's icon sets, drawn by icon-sets.js
  var ICACHE = {};
  function ic(name, size, colour, style) {
    var T = window.TVIcons;
    style = style || CTX.icons || "line";
    if (style === "classic") style = "line";
    var key = style + "|" + name + "|" + size + "|" + (colour || "");
    if (!ICACHE[key]) {
      var src = T ? T.svg(style, name, size, colour || "currentColor") : "";
      if (!src) src = T ? T.svg("line", name, size, colour || "currentColor") : "";
      var node = null;
      if (src && window.DOMParser) {
        try { var d = new DOMParser().parseFromString(src, "image/svg+xml").documentElement; if (d && d.nodeName.toLowerCase() === "svg") node = document.importNode(d, true); } catch (e) { node = null; }
      }
      ICACHE[key] = node || E("span", "", "display:inline-block;width:" + px(size) + ";height:" + px(size));
    }
    var n = ICACHE[key].cloneNode(true);
    if (n.setAttribute) { n.setAttribute("width", size); n.setAttribute("height", size); n.setAttribute("focusable", "false"); n.style.flex = "none"; n.style.width = px(size); n.style.height = px(size); }
    return n;
  }
  function avatar(name, size) {
    var T = window.TVIcons, src = T && T.avatar ? T.avatar(name, size) : "";
    if (src && window.DOMParser) { try { var d = new DOMParser().parseFromString(src, "image/svg+xml").documentElement; if (d && d.nodeName.toLowerCase() === "svg") return document.importNode(d, true); } catch (e) {} }
    return E("span", "", "display:block;width:" + px(size) + ";height:" + px(size) + ";border-radius:50%;background:#5e5ce6");
  }
  var CTX = { icons: "line" };

  // ---------------- what the TV has, or the demo ----------------
  var APPS = {
    "com.google.android.youtube.tv": "YouTube", "com.netflix.ninja": "Netflix", "au.net.abc.iview": "ABC iview", "com.disney.disneyplus": "Disney+",
    "au.com.stan.and": "Stan", "com.amazon.amazonvideo.livingroom": "Prime Video", "com.sbs.ondemand.tv": "SBS On Demand", "com.spotify.tv.android": "Spotify",
    "au.com.kayosports.tv": "Kayo", "com.apple.atve.androidtv.appletv": "Apple TV", "au.com.streamotion.ares.tv": "Binge", "au.com.ninenow.ctv": "9Now",
    "au.com.tenplay": "10", "com.swm.live": "7plus", "au.com.foxtel.atv": "Foxtel", "com.crunchyroll.webapp": "Crunchyroll", "tv.twitch.android.app": "Twitch",
    "com.wbd.stream": "Max", "dazn": "DAZN", "com.cbs.ca": "Paramount+", "io.strem.tv": "Stremio"
  };
  var DEMO_APPS = ["com.google.android.youtube.tv", "com.netflix.ninja", "au.net.abc.iview", "com.disney.disneyplus", "au.com.stan.and", "com.amazon.amazonvideo.livingroom", "com.sbs.ondemand.tv", "au.com.streamotion.ares.tv", "com.apple.atve.androidtv.appletv", "com.spotify.tv.android"];
  var GAME_APPS = ["com.microsoft.xcloud", "com.nvidia.geforcenow", "com.valvesoftware.steamlink", "com.retroarch"];
  // the containers of apps a person can change on the TV (Hold OK): their most apps
  var APP_KINDS = ["app", "folder", "dock", "appgrid", "games"], APP_MAX = { app: 1, folder: 12, dock: 12, appgrid: 16, games: 4 };
  function dataOf(env) { return (env && env.data) || {}; }
  function demoImg(k) { return CW.base + "demo/" + k + ".jpg"; }
  function bgImg(k) { return CW.base + "backgrounds/" + k + ".jpg"; }
  // the app catalogue (app-catalogue.js): a design names apps by catalogue id ("netflix")
  function cat() { return window.CouchApps || null; }
  function catApp(k) { var A = cat(); return A ? A.get(k) : null; }
  function iconUrl(pkg, env) {
    var d = dataOf(env), c = catApp(pkg);
    if (c) return c.icon ? CW.base + c.icon : null;   // a catalogue id: its own picture (the designer, a missing app)
    if (!env.demo && d.iconUrl) { try { return d.iconUrl(pkg); } catch (e) { return null; } }
    if (d.iconUrl) { try { var u = d.iconUrl(pkg); if (u) return u; } catch (e2) {} }
    return APPS[pkg] ? CW.logoBase + pkg + ".png" : null;
  }
  function appName(pkg, env) {
    var c = catApp(pkg);
    if (c) return c.name;
    var list = dataOf(env).apps || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].package === pkg) return String(list[i].name || pkg);
    return APPS[pkg] || String(pkg).split(".").pop();
  }
  // the apps on this TV a person can put in a design's dock, row or folder (no Settings or More tiles)
  function installed(env) { return (dataOf(env).apps || []).filter(function (a) { return a && a.package && a.package !== "gear" && a.package !== "more" && a.package !== "smart" && a.package !== "com.android.tv.settings" && !/^(screen|input):/.test(a.package); }); }
  // what a container holds: the person's own changes on this TV (env.edits, design.js), else the design's
  // apps (catalogue ids, or an old design's package names)
  function wantOf(o, env) {
    var e = !env.designer && !env.demo && env.edits ? env.edits(o.id, o.kind) : null, w = (e || (o.opts || {}).apps || []).slice();
    w.edited = !!e;   // emptied on this TV: it stays empty (an Add app place), not every app
    return w;
  }
  // the apps a widget shows, as keys: on a TV each catalogue id becomes the package this TV has, or
  // "missing:<id>" when it is not installed (drawn dimmed, "Not on this TV"); with nothing named, every
  // app the TV has. In the designer, the ids themselves. out.keys holds what each one was in the design.
  function appsFor(o, env, max) {
    var want = wantOf(o, env), have = installed(env), out = [], keys = [];
    if (env.demo || env.designer) { out = want.length ? want : (o.kind === "games" ? GAME_APPS : DEMO_APPS).slice(); keys = out.slice(); }
    else if (want.length || want.edited) {
      want.forEach(function (k) {
        var A = cat(), hit = null, i;
        // the TV's app list not read yet (the "Use this design?" preview draws before it is): never
        // "Not on this TV" for an app that may well be there; the catalogue's own picture instead
        if (A && A.get(k) && !have.length && env.card) { out.push(k); keys.push(k); return; }
        if (A && A.get(k)) { hit = A.resolve(k, have); out.push(hit ? hit.package : "missing:" + k); keys.push(k); return; }
        for (i = 0; i < have.length; i++) if (have[i].package === k) hit = have[i];
        if (hit) { out.push(k); keys.push(k); }   // an app picked on this TV, or an old design's package name
      });
    }
    else { out = have.map(function (a) { return a.package; }); keys = out.slice(); }
    out = out.slice(0, max || 16); out.keys = keys.slice(0, max || 16);
    return out;
  }
  // a dock, row or folder on a TV may take one more app: an "Add app" place at its end
  function canAdd(env) { return !env.demo && !env.designer && !env.preview && !!env.edits; }
  function appNode(pkg, a, env, big) {
    pkg = String(pkg);
    if (pkg === "add:") {
      var plus = E("div", "cw-app cw-add", "width:" + px(a) + ";height:" + px(a) + ";border-radius:" + px(a * 0.24) + ";font-size:" + px(clamp(a * 0.15, 23, 34)) + ";border:3px dashed rgba(255,255,255,.45);background:rgba(255,255,255,.06);display:flex;flex-direction:column;align-items:center;justify-content:center", [ic("plus", a * 0.32, "#fff"), a >= 140 ? E("span", "", "margin-top:6px", ["Add app"]) : null]);
      if (big) plus.style.margin = "22px";
      return stop(plus, "addapp", "", "Add app");
    }
    var missing = pkg.indexOf("missing:") === 0, key = missing ? pkg.slice(8) : pkg;
    if (missing) {
      var m = appNode(key, a, env, big);
      m.style.opacity = "0.42"; m.classList.add("cw-missing");
      m.appendChild(E("div", "", "position:absolute;left:0;right:0;bottom:0;padding:4px;background:rgba(0,0,0,.72);color:#fff;font-size:" + px(clamp(a * 0.11, 23, 28)) + ";text-align:center;line-height:1.15", ["Not on this TV"]));
      return stop(m, "missing", key, appName(key, env));
    }
    var name = appName(pkg, env), url = iconUrl(pkg, env), c = catApp(pkg);
    var n = E("div", "cw-app", "width:" + px(a) + ";height:" + px(a) + ";padding:" + px(a * 0.08) + ";border-radius:" + px(a * 0.24) + ";font-size:" + px(clamp(a * 0.17, 23, 40)) + (c && !c.icon && /^#[0-9a-f]{6}$/i.test(c.colour) ? ";background:" + c.colour : ""), [name]);
    if (url && (env.imgOk ? (env.imgOk(url) || /^(https?:|\.\.\/|\/|demo\/|backgrounds\/|app-icons\/)/.test(url)) : true)) {
      var img = document.createElement("img");
      img.alt = ""; img.src = url; img.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover";
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); n.classList.remove("cw-has-icon"); };
      n.appendChild(img); n.classList.add("cw-has-icon");
    }
    stop(n, "app", pkg, name);
    if (big) n.style.margin = "22px";
    return n;
  }

  // weather: the demo is a coastal town on a November morning
  var DEMO_WX = { place: "Riverside", temp: 24, code: 2, is_day: true, hi: 27, lo: 17, uv: 11, aqi: 18,
    hourly: [["Now", 2, 24], ["9am", 0, 25], ["10am", 0, 26], ["11am", 2, 27], ["12pm", 3, 27], ["1pm", 61, 25], ["2pm", 95, 23], ["3pm", 80, 22]],
    daily: [["Today", 2, 17, 27], ["Thu", 95, 18, 25], ["Fri", 61, 17, 22], ["Sat", 2, 16, 24], ["Sun", 0, 15, 26], ["Mon", 0, 17, 28], ["Tue", 3, 18, 26]],
    rain: [10, 15, 22, 40, 70, 85, 60, 35, 20, 12, 8, 5], rainFrom: "1:20", sunrise: "5:41", sunset: "7:22", uvFrom: "8:50", uvTo: "4:10" };
  var WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 56: "Drizzle", 57: "Drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Rain", 67: "Rain", 71: "Snow", 73: "Snow", 75: "Snow", 77: "Snow", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow", 86: "Snow", 95: "Storms", 96: "Storms", 99: "Storms" };
  function wxIcon(code, day) {
    code = +code;
    if (code <= 1) return day === false ? "clear-night" : "sun";
    // partly cloudy at night: the moon behind the cloud, never the sun
    if (code === 2) return day === false ? "partly-cloudy-night" : "partly-cloudy";
    if (code === 3) return "cloud";
    if (code === 45 || code === 48) return "fog";
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "rain";
  }
  function wxWords(code) { return WMO[+code] || ""; }
  function hourLabel(d, i) { if (i === 0) return "Now"; var h = d.getHours(); return (h % 12 || 12) + (h < 12 ? "am" : "pm"); }
  function hm(s) { var d = new Date(s); if (isNaN(d.getTime())) return ""; var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m; }
  // the weather this TV has, in one shape (app.js weatherDirect: current, hourly, daily, minutely_15)
  // the demo's next 24 hours and 7 days in full (the forecast layer): made from the demo's own numbers
  function demoFull() {
    if (DEMO_WX.hours) return;
    var t = now(), codes = [2, 0, 0, 2, 3, 61, 95, 80, 61, 3, 2, 2, 1, 0, 0, 0, 0, 1, 2, 2, 3, 2, 1, 0], temps = [24, 25, 26, 27, 27, 25, 23, 22, 22, 21, 21, 20, 19, 18, 18, 17, 17, 18, 19, 21, 22, 23, 24, 25];
    DEMO_WX.hours = codes.map(function (c, i) { var d = new Date(t.getTime() + i * 3600000); return { t: hourLabel(d, i), code: c, temp: temps[i], pop: c >= 61 ? 60 + (i % 3) * 10 : c === 3 ? 20 : 5, uv: d.getHours() > 6 && d.getHours() < 18 ? Math.max(0, Math.round(11 - Math.abs(12.5 - d.getHours()) * 1.8)) : 0, night: d.getHours() < 6 || d.getHours() >= 19 }; });
    DEMO_WX.days = DEMO_WX.daily.map(function (x, i) { return { d: i === 0 ? "Today" : x[0], code: x[1], lo: x[2], hi: x[3], rise: "5:4" + (1 - Math.min(1, i)) + "am", set: "7:2" + Math.min(9, 2 + i) + "pm", uv: [11, 9, 6, 11, 12, 12, 10][i], pop: [40, 80, 70, 10, 5, 5, 20][i] }; });
  }
  // the date as the forecast writes it (Open-Meteo's daily "time": 2026-11-18), in the TV's own time
  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  // is it day now? Worked out at the moment the widget is drawn, not when the weather was fetched (a
  // reading from 5:50pm still said day at 9pm): the town's own sunrise and sunset, else the forecast's
  // for today, else the reading's own is_day, else 6am to 7pm
  function dayNow(w, d) {
    var t = now(), p = d.place, s = p && isFinite(p.lat) && isFinite(p.lon) ? sunTimes(t, +p.lat, +p.lon) : null;
    if (!s && w.daily) {
      var today = ymd(t);
      for (var i = 0; i < w.daily.length; i++) if (w.daily[i] && w.daily[i].date === today) {
        var r = new Date(w.daily[i].sunrise), z = new Date(w.daily[i].sunset);
        if (!isNaN(r.getTime()) && !isNaN(z.getTime())) s = { rise: r, set: z };
        break;
      }
    }
    if (s) return t >= s.rise && t < s.set;
    if (typeof w.is_day === "boolean") return w.is_day;
    var h = t.getHours(); return h >= 6 && h < 19;
  }
  // the day a bedside or evening screen should talk about: from 6pm, tomorrow; otherwise today (after
  // midnight, today is the day ahead). Found by its date, so a forecast fetched yesterday still picks
  // the right one; null when the forecast does not reach it.
  function dayAhead(w, days) {
    var t = now(), tomorrow = t.getHours() >= 18;
    if (!tomorrow) return null;
    var want = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
    for (var i = 0; i < days.length; i++) if (days[i].date ? days[i].date === want : i === 1) return { label: "Tomorrow", code: days[i].code, hi: days[i].hi, lo: days[i].lo };
    return null;
  }
  function weather(env) {
    if (env.demo) {
      var hr = now().getHours(); DEMO_WX.is_day = hr >= 6 && hr < 19; demoFull();
      DEMO_WX.ahead = dayAhead(DEMO_WX, DEMO_WX.days);
      return DEMO_WX;
    }
    var d = dataOf(env), w = d.weather;
    if (!w || w.temp === undefined || w.temp === null) return null;
    var out = { place: (d.place && d.place.name) || "", temp: Math.round(w.temp), code: w.code, is_day: dayNow(w, d), hi: w.hi, lo: w.lo, uv: w.uv, aqi: w.aqi };
    // each hour is night or day by that day's own sunrise and sunset when the forecast has them
    var sunOf = {};
    (w.daily || []).forEach(function (x) { if (x && x.date) sunOf[x.date] = [new Date(x.sunrise), new Date(x.sunset)]; });
    var nightAt = function (hd) { var s = sunOf[ymd(hd)]; return s && !isNaN(s[0].getTime()) && !isNaN(s[1].getTime()) ? hd < s[0] || hd >= s[1] : hd.getHours() < 6 || hd.getHours() >= 19; };
    if (w.hourly && w.hourly.length) {
      out.hourly = w.hourly.slice(0, 8).map(function (x, i) { var hd = new Date(x.time); return [hourLabel(hd, i), x.code, Math.round(x.temp), i === 0 ? !out.is_day : nightAt(hd)]; });
      out.hours = w.hourly.slice(0, 24).map(function (x, i) { var hd = new Date(x.time); return { t: hourLabel(hd, i), code: x.code, temp: Math.round(x.temp), pop: x.pop, uv: x.uv, night: i === 0 ? !out.is_day : nightAt(hd) }; });
    }
    if (w.daily && w.daily.length) {
      // "Today" is today's date, not simply the first day the forecast holds
      var today = ymd(now()), dname = function (x, i) { return x.date === today || (!x.date && i === 0) ? "Today" : DAYS[new Date(x.date + "T12:00:00").getDay()].slice(0, 3); };
      out.days = w.daily.slice(0, 7).map(function (x, i) { return { d: dname(x, i), date: x.date, code: x.code, lo: Math.round(x.lo), hi: Math.round(x.hi), rise: hm(x.sunrise), set: hm(x.sunset), uv: x.uv, pop: x.pop }; });
      out.daily = w.daily.slice(0, 7).map(function (x, i) { return [dname(x, i), x.code, Math.round(x.lo), Math.round(x.hi)]; });
      out.sunrise = hm(w.daily[0].sunrise); out.sunset = hm(w.daily[0].sunset);
      if (out.hi === undefined) { out.hi = Math.round(w.daily[0].hi); out.lo = Math.round(w.daily[0].lo); }
      if (out.uv === undefined && w.daily[0].uv !== undefined) out.uv = Math.round(w.daily[0].uv);
      out.ahead = dayAhead(out, out.days);
    }
    if (w.rain15 && w.rain15.length) {
      var mx = Math.max.apply(null, w.rain15.concat([0.5]));
      out.rain = w.rain15.slice(0, 12).map(function (v) { return Math.round(clamp(v / mx, 0.03, 1) * 100); });
      var first = -1; for (var i = 0; i < w.rain15.length; i++) if (w.rain15[i] >= 0.2) { first = i; break; }
      out.rainFrom = first < 0 ? "" : hm(Date.now() + first * 900000);
      out.rainMax = Math.max.apply(null, w.rain15);
    }
    return out;
  }

  var SHOWS = [["Bluey", "S3 E4, Hammerbarn", "au.net.abc.iview", "scene-golden", 0.6], ["Fisk", "S2 E1", "au.net.abc.iview", "albury-storm", 0.3],
    ["The Bear", "S3 E2", "com.disney.disneyplus", "scene-night", 0.8], ["Slow Horses", "S4 E5", "com.apple.atve.androidtv.appletv", "grose-valley", 0.4],
    ["Bay of Fires", "S1 E3", "au.com.stan.and", "tessellated-pavement", 0.2]];
  function shows(env) {
    if (env.demo) return SHOWS.map(function (s) { return { title: s[0], sub: s[1], app: s[2], art: bgImg(s[3]), progress: s[4] }; });
    return (dataOf(env).shows || []).map(function (it) {
      return { title: String(it.title || ""), sub: it.season && it.episode ? "S" + it.season + " E" + it.episode : String(it.episode_title || (it.app && it.app.name) || ""),
        app: it.app && it.app.package, art: it.backdrop || it.poster || "", progress: +it.progress || 0 };
    });
  }
  function music(env) {
    if (env.demo) return { title: "Riptide", artist: "Vance Joy", art: demoImg("album"), state: "playing", app: "com.spotify.tv.android", source: "Spotify", pos: 82, dur: 215 };
    var m = dataOf(env).music;
    return m && m.title ? { title: String(m.title), artist: String(m.artist || ""), art: m.art || "", state: m.state, app: m.package || "", source: String(m.source || m.app_name || ""), pos: +m.position || 0, dur: +m.duration || 0 } : null;
  }
  function photos(env, o) {
    var own = (o && o.opts && o.opts.image) ? [o.opts.image] : [];
    if (own.length) return own;
    if (env.demo) return ["beach", "birthday", "camp", "dog", "nan", "surf", "hike"].map(demoImg);
    return (dataOf(env).photos || []).slice(0, 50);
  }
  function people(env) {
    if (env.demo) return [["character-curly", "Alex", 1, "a"], ["character-bun", "Sam", 0, "b"], ["character-pigtails", "Ruby", 0, "c"]];
    var d = dataOf(env), avs = ["character-curly", "character-bun", "character-pigtails", "character-short-hair", "character-cap", "character-long-hair", "character-beard", "character-grandparent"];
    return (d.people || []).map(function (p, i) { return [p.avatar || avs[i % avs.length], String(p.name || ""), p.id === d.who ? 1 : 0, p.id]; });
  }

  // ---------------- time ----------------
  function now() { return new Date(); }
  function clockParts(d, o, env) {
    var f = (o.opts || {}).format, h24 = f === "24h" ? true : f === "12h" ? false : !!env.clock24;
    var hh = d.getHours(), mm = d.getMinutes(), m2 = (mm < 10 ? "0" : "") + mm;
    return h24 ? { t: (hh < 10 ? "0" : "") + hh + ":" + m2, ap: "" } : { t: (hh % 12 || 12) + ":" + m2, ap: hh < 12 ? "am" : "pm" };
  }
  function longDate(d) { return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()]; }
  function shortDate(d) { return DAYS[d.getDay()].slice(0, 3) + " " + d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3); }
  function partOfDay(d) { var h = d.getHours(); return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"; }
  var NUMW = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  function timeWords(d) {
    var h = d.getHours(), m = Math.round(d.getMinutes() / 5) * 5;
    if (m === 60) { m = 0; h++; }
    var hr = function (x) { return NUMW[x % 12 === 0 ? 12 : x % 12]; };
    var t;
    if (m === 0) t = hr(h) + " o'clock";
    else if (m === 15) t = "quarter past\n" + hr(h);
    else if (m === 30) t = "half past\n" + hr(h);
    else if (m === 45) t = "quarter to\n" + hr(h + 1);
    else if (m < 30) t = ({ 5: "five", 10: "ten", 20: "twenty", 25: "twenty five" })[m] + " past\n" + hr(h);
    else t = ({ 35: "twenty five", 40: "twenty", 50: "ten", 55: "five" })[m] + " to\n" + hr(h + 1);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // the moon's age in days from a known new moon (6 Jan 2000 18:14 UTC), and its name
  function moon(d) {
    var age = ((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588;
    if (age < 0) age += 29.530588;
    var f = age / 29.530588;
    var name = f < 0.03 || f > 0.97 ? "New moon" : f < 0.22 ? "Waxing crescent" : f < 0.28 ? "First quarter" : f < 0.47 ? "Waxing gibbous" : f < 0.53 ? "Full moon" : f < 0.72 ? "Waning gibbous" : f < 0.78 ? "Last quarter" : "Waning crescent";
    var toFull = (14.765 - age + 29.530588) % 29.530588, full = new Date(d.getTime() + toFull * 86400000);
    return { f: f, name: name, full: toFull < 1 ? "Full moon tonight" : "Full moon " + (toFull < 6 ? DAYS[full.getDay()].slice(0, 3) : full.getDate() + " " + MONTHS[full.getMonth()].slice(0, 3)) };
  }
  // sunrise and sunset from the town's latitude and longitude (NOAA's short method), as local times
  function sunTimes(d, lat, lon) {
    var rad = Math.PI / 180, day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
    var g = 2 * Math.PI / 365 * (day - 1);
    var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec));
    if (cosH > 1 || cosH < -1) return null;
    var ha = Math.acos(cosH) / rad, base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    var rise = new Date(base + (720 - 4 * (lon + ha) - eq) * 60000), set = new Date(base + (720 - 4 * (lon - ha) - eq) * 60000);
    return { rise: rise, set: set };
  }
  function fmt12(d) { var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? "am" : "pm"); }
  function sunToday(env) {
    var d = dataOf(env), w = weather(env);
    if (env.demo) return { rise: "5:41am", set: "7:22pm", frac: 0.42 };
    var p = d.place, t = now();
    if (p && isFinite(p.lat) && isFinite(p.lon)) {
      var s = sunTimes(t, +p.lat, +p.lon);
      if (s) return { rise: fmt12(s.rise), set: fmt12(s.set), frac: clamp((t - s.rise) / (s.set - s.rise), -0.1, 1.1) };
    }
    if (w && w.sunrise) return { rise: w.sunrise, set: w.sunset, frac: 0.5 };
    return null;
  }

  // ---------------- the panel and its look ----------------
  var PHOTO_KINDS = ["photo", "slideshow", "memory", "keep", "upnext", "camera", "app"];
  var PANEL_CLS = { glass: "cw-glass", solid: "cw-solid", colour: "cw-tint", paper: "cw-paper", none: "cw-bare" };
  // the tile colour each kind has when its style does not pick one (the mockups' colours)
  var TILE = { analog: "#f4f1ea", wordclock: "#0a6fd8", countdown: "#18793f", weather: "#1b64b5", bigtemp: "#ffb340", hourly: "#1b64b5", week: "#1b64b5",
    uv: "#ff9f0a", surf: "#0a6e8a", screentime: "#5e5ce6", note: "#ffd60a", timer: "#1d1b18" };
  var GRAD = { weather: "linear-gradient(180deg,#1b64b5,#2f7fd2)", hourly: "linear-gradient(180deg,#1b64b5,#2f7fd2)", week: "linear-gradient(180deg,#1b64b5,#2f7fd2)",
    bigtemp: "linear-gradient(160deg,#ffb340,#ff7a45)", countdown: "linear-gradient(160deg,#1f9150,#146b37)", uv: "linear-gradient(160deg,#ff9f0a,#ff6a3d)",
    surf: "linear-gradient(170deg,#0a6e8a,#0f9fb5)", screentime: "linear-gradient(160deg,#5e5ce6,#8e44ef)" };
  var FONT = { inter: '"Inter", sans-serif', antonio: '"Antonio", "Arial Narrow", sans-serif', rounded: '"Nunito", "Inter", sans-serif', cormorant: '"Cormorant Garamond", Georgia, serif', jost: '"Jost", "Inter", sans-serif' };
  var CORNER = { square: 12, soft: 28, round: 36, pill: 999 };
  function nightNow() { var h = now().getHours(); return h >= 18 || h < 6; }

  function shell(o, b, env, kindOverride) {
    var kind = kindOverride || o.kind, st = o.style || {};
    var panel = st.panel || (window.CouchDesign && window.CouchDesign.wpanel ? window.CouchDesign.wpanel({ kind: kind, style: st }) : "glass");
    // pictures with no panel keep their rounded corners (the photo look); words and clocks are bare
    var pcls = panel === "none" && PHOTO_KINDS.indexOf(kind) >= 0 ? "cw-photo" : (PANEL_CLS[panel] || "cw-glass");
    var root = E("div", "cw cw-k-" + kind + " " + pcls, "width:" + px(b.w) + ";height:" + px(b.h));
    root.setAttribute("data-kind", kind);
    var look = env.look || {}, ink = null, tile = null;
    if (panel !== "none") root.appendChild(E("div", "cw-bg", st.opacity ? "opacity:" + st.opacity : ""));
    if (panel === "colour") {
      var col = st.colour || TILE[kind] || "#0a84ff", rgb = rgbOf(col) || [10, 132, 255];
      var bgv = st.gradient === "soft" ? "linear-gradient(160deg," + col + "," + shade(rgb, 0.84) + ")" : st.colour || st.gradient === "off" ? col : GRAD[kind] || col;
      root.style.setProperty("--tile", bgv);
      tile = rgb;
      ink = autoInk(rgb);
    } else if (panel === "paper") { tile = rgbOf(look.paper) || [246, 242, 234]; ink = INK_DARK; }
    else if (panel === "solid") { tile = rgbOf(look.solid) || [22, 22, 27]; }
    if (st.ink === "white") ink = WHITE; else if (st.ink === "ink") ink = INK_DARK; else if (st.ink === "accent") ink = rgbOf(st.accent || look.accent) || [255, 214, 10];
    if (ink) {
      root.style.setProperty("--ink", rgba(ink, 1)); root.style.setProperty("--sub", rgba(ink, 0.76)); root.style.setProperty("--faint", rgba(ink, 0.5));
      root.style.color = rgba(ink, 1);
    }
    if (st.accent) root.style.setProperty("--on", st.accent);
    if (FONT[st.font]) root.style.fontFamily = FONT[st.font];
    else if (st.font && window.CouchFonts && window.CouchFonts.css(st.font)) root.style.fontFamily = window.CouchFonts.css(st.font);   // a Google Fonts family (design.js loads it from the store)
    var rr = CORNER[st.corners] !== undefined ? CORNER[st.corners] : 36;
    if (rr === 999) rr = Math.min(b.w, b.h) / 2;
    root.style.setProperty("--r", px(rr));
    if (st.shadow) root.classList.add("cw-sh-" + st.shadow);
    return { root: root, panel: panel, ink: ink || WHITE, tile: tile };
  }
  // the honest empty state: what this widget needs on this TV, said in its own box
  function empty(root, b, iconName, line, sub) {
    while (root.childNodes.length > (root.firstChild && root.firstChild.className === "cw-bg" ? 1 : 0)) root.removeChild(root.lastChild);
    if (root.classList.contains("cw-bare")) { root.classList.remove("cw-bare"); root.classList.add("cw-glass"); root.insertBefore(E("div", "cw-bg"), root.firstChild); }
    var tiny = b.h < 220 || b.w < 300, strip = b.h < 200 && b.w >= 300;
    root.classList.add("cw-empty"); if (tiny) root.classList.add("cw-tiny");
    root.setAttribute("data-empty", "1");
    if (strip) {
      // a wide tile: the icon beside the words, so two lines fit
      root.classList.add("cw-strip");
      // the icon and the words as one group in the middle: once on screen the words' box narrows to its
      // longest line (data-hug, fitNow), so the two lines do not leave a gap on one side
      var hug = E("div", "cw-col", "margin-left:18px;min-width:0;flex:0 1 auto", [E("div", "cw-e1", "margin-top:0", [line])]);
      hug.setAttribute("data-hug", "1");
      add(root, E("div", "cw-row", "height:100%;justify-content:center", [ic(iconName || "info", 40, "currentColor"), hug]));
      fitLater(root);
      return root;
    }
    add(root, [ic(iconName || "info", tiny ? 34 : 46, "currentColor"), E("div", "cw-e1", "", [line]), sub && b.h >= 200 ? E("div", "cw-e2", "", [sub]) : null]);
    return root;
  }
  // the setup card: what this widget needs and where that is set up, from widget-caps.js (never from a
  // design). OK on it opens the same record in full (widget-detail.js, the setup layer).
  function soon(root, b, iconName, kind) {
    var C = window.CouchWidgetCaps, c = C ? C.card(kind, b.w < 300 && b.h < 300) : { line: "Not on couch-tv yet", sub: "" };
    root.setAttribute("data-setup", kind);
    return empty(root, b, iconName, c.line, c.sub);
  }
  function live(root, every, fn) { REG.push({ el: root, every: every, at: 0, fn: fn }); startTick(); }
  function startTick() {
    if (TICK) return;
    TICK = setInterval(function () {
      var t = Date.now();
      REG = REG.filter(function (r) { return r.el && r.el.parentNode && document.documentElement.contains(r.el); });
      REG.forEach(function (r) { if (t - r.at >= r.every - 120) { r.at = t; try { r.fn(t); } catch (e) {} } });
      if (!REG.length) { clearInterval(TICK); TICK = null; }
    }, 1000);
  }
  function lab(iconName, text, colour) { return E("div", "cw-lab", colour ? "color:" + colour : "", [iconName ? ic(iconName, 30, colour || "currentColor") : null, text]); }

  // ---------------- the renderers: R[kind](root, o, b, env, sh) ----------------
  var R = {};
  var op = function (o) { return o.opts || {}; };

  // clocks
  R.clock = function (root, o, b, env) {
    var p = clockParts(now(), o, env), sub = op(o).date !== false && b.h >= 200, shortD = b.w < 420;
    var align = op(o).align || "center", showAp = op(o).ampm !== false && p.ap && b.w >= 300;
    var fs = Math.min((b.h - (sub ? 60 : 0)) * 0.75, b.w / (p.t.length * 0.62 + (showAp ? 0.6 : 0)), 240);
    var tEl = E("span", "", "", [p.t]), aEl = showAp ? E("span", "", "font-size:" + px(Math.max(24, fs * 0.3)) + ";letter-spacing:0;margin-left:.12em;font-weight:600;opacity:.8", [p.ap]) : null;
    var big = E("div", "cw-big", "font-size:" + px(fs) + ";font-weight:640;text-align:" + align + (root.classList.contains("cw-bare") ? ";text-shadow:0 4px 30px rgba(0,0,0,.25)" : ""), [tEl, aEl]);
    var dEl = sub ? E("div", "cw-t29 cw-dim", "margin-top:" + px(Math.max(14, fs * 0.12)) + ";text-align:" + align + (root.classList.contains("cw-bare") ? ";text-shadow:0 2px 14px rgba(0,0,0,.3)" : ""), [shortD ? shortDate(now()) : longDate(now())]) : null;
    add(root, E("div", "cw-col cw-center", "height:100%;align-items:" + (align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center"), [big, dEl]));
    live(root, 1000, function () { var q = clockParts(now(), o, env); tEl.textContent = q.t; if (aEl) aEl.textContent = q.ap; if (dEl) dEl.textContent = shortD ? shortDate(now()) : longDate(now()); });
  };
  // the tall digits (Antonio, line height .82): their ink runs from .05em to .93em of the line, so the
  // box grows .12em at the bottom (and a little at the top) to hold them whole, and the size comes from
  // the room inside the widget's own padding (seagey, 18 Nov 2026: the bottom of the digits was cut off)
  function tallFs(root, b, len) {
    var ins = root.classList.contains("cw-bare") || root.classList.contains("cw-photo") ? 0 : 48;
    return Math.max(24, Math.min((b.h - ins) / 0.98, (b.w - ins) / (len * 0.42)));
  }
  var TALL = "font-family:Antonio,'Arial Narrow',sans-serif;font-weight:300;line-height:.82;padding:.03em 0 .13em;letter-spacing:-.02em;white-space:nowrap;flex:none;";
  R.tallclock = function (root, o, b, env) {
    var p = clockParts(now(), o, env), fs = tallFs(root, b, p.t.length), al = op(o).align || "center";
    var tEl = E("div", "", TALL + "font-size:" + px(fs) + ";text-align:" + al + ";text-shadow:0 6px 40px rgba(0,0,0,.25)", [p.t]);
    add(root, E("div", "cw-col", "height:100%;justify-content:center;align-items:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center"), [tEl]));
    live(root, 1000, function () { tEl.textContent = clockParts(now(), o, env).t; });
  };
  R.glassclock = function (root, o, b, env) {
    var p = clockParts(now(), o, env), fs = tallFs(root, b, p.t.length), sc = op(o).scene || (dataOf(env).scene) || "night";
    var tEl = E("div", "", TALL + "font-size:" + px(fs) + ";text-align:center;" +
      "color:rgba(255,255,255,.88);background-image:url(" + CW.base + "backgrounds/scene-" + sc + "-glass.jpg);background-size:1920px 1080px;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;" +
      "filter:drop-shadow(0 8px 30px rgba(0,0,0,.25))", [p.t]);
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [tEl]));
    live(root, 1000, function () { tEl.textContent = clockParts(now(), o, env).t; });
  };
  R.analog = function (root, o, b, env, sh) {
    var s = Math.min(b.w, b.h) - 48, d = now(), hand = "#ff6a3d", ink = rgba(sh.ink, 1);
    var ticks = [];
    for (var i = 0; i < 12; i++) ticks.push(S("line", { x1: 50, y1: 5, x2: 50, y2: i % 3 ? 9 : 13, stroke: ink, "stroke-width": i % 3 ? 1.2 : 2.6, "stroke-linecap": "round", transform: "rotate(" + i * 30 + " 50 50)", opacity: i % 3 ? 0.5 : 0.95 }));
    var hH = S("line", { x1: 50, y1: 50, x2: 50, y2: 25, stroke: ink, "stroke-width": 4.4, "stroke-linecap": "round" });
    var mH = S("line", { x1: 50, y1: 50, x2: 50, y2: 12, stroke: ink, "stroke-width": 3, "stroke-linecap": "round" });
    var sH = S("line", { x1: 50, y1: 58, x2: 50, y2: 10, stroke: hand, "stroke-width": 1.2, "stroke-linecap": "round" });
    var set = function () { var t = now(), h = t.getHours() % 12, m = t.getMinutes(), sec = t.getSeconds(); hH.setAttribute("transform", "rotate(" + (h * 30 + m / 2) + " 50 50)"); mH.setAttribute("transform", "rotate(" + m * 6 + " 50 50)"); sH.setAttribute("transform", "rotate(" + sec * 6 + " 50 50)"); };
    set();
    add(root, E("div", "cw-grow cw-row cw-center", "", [svg("0 0 100 100", s, s, ticks.concat([hH, mH, sH, S("circle", { cx: 50, cy: 50, r: 2.6, fill: hand })]))]));
    live(root, 1000, set);
    void d;
  };
  R.flipclock = function (root, o, b, env) {
    var pad = root.classList.contains("cw-bare") ? 0 : 48, cw = Math.min((b.w - pad - 20 - 56) / 4, (b.h - pad) * 0.72), hgt = Math.min(b.h - pad, cw / 0.72), cards = [];
    var card = function () { var t = E("span", "", "", ["0"]); var c = E("div", "", "position:relative;width:" + px(cw) + ";height:" + px(hgt) + ";border-radius:22px;background:#1f1f23;display:flex;align-items:center;justify-content:center;font-size:" + px(Math.min(hgt * 0.78, cw * 1.25)) + ";font-weight:700;letter-spacing:-.04em;color:#f2f2f2;box-shadow:inset 0 -3px 0 rgba(0,0,0,.4);margin:0 7px", [t, E("i", "", "position:absolute;left:0;right:0;top:50%;height:3px;background:#0b0b0d")]); cards.push(t); return c; };
    add(root, E("div", "cw-row cw-center", "height:100%", [card(), card(), E("div", "", "width:20px"), card(), card()]));
    var set = function () { var t = clockParts(now(), o, env).t.replace(":", ""); if (t.length === 3) t = "0" + t; for (var i = 0; i < 4; i++) cards[i].textContent = t.charAt(i); };
    set(); live(root, 1000, set);
  };
  R.wordclock = function (root, o, b) {
    var tw = timeWords(now()), tl = tw.split("\n"), longest = Math.max.apply(null, tl.map(function (l) { return l.length; }));
    var fs = clamp(Math.min((b.w - 48) / (longest * 0.56), (b.h - 120) / (tl.length * 1.06)), 36, 130);
    var w = E("div", "", "font-size:" + px(fs) + ";font-weight:780;line-height:1.02;letter-spacing:-.03em;white-space:pre-line", [timeWords(now())]);
    var s = E("div", "cw-t29 cw-dim", "margin-top:18px", [DAYS[now().getDay()] + " " + partOfDay(now())]);
    add(root, E("div", "cw-grow cw-col", "justify-content:center", [w, s]));
    live(root, 15000, function () { w.textContent = timeWords(now()); s.textContent = DAYS[now().getDay()] + " " + partOfDay(now()); });
  };
  function arc(f) {
    f = clamp(f, 0, 1);
    var x = 10 + 280 * f, y = 110 - 4 * 75 * f * (1 - f) * 1.33;
    return { x: x, y: y };
  }
  R.solar = function (root, o, b, env) {
    var s = sunToday(env);
    if (!s) return empty(root, b, "sun", "Set your town for the sun", "Settings (hold OK), Home settings, Location");
    var at = arc(s.frac);
    add(root, [lab("sun", op(o).label || "Sun"),
      svg("0 0 300 120", "100%", "100%", [S("path", { d: "M10 110 Q150 -40 290 110", fill: "none", stroke: "rgba(255,255,255,.28)", "stroke-width": 3, "stroke-dasharray": "2 9", "stroke-linecap": "round" }),
        S("line", { x1: 0, y1: 110, x2: 300, y2: 110, stroke: "rgba(255,255,255,.3)", "stroke-width": 2 }),
        s.frac > 0 && s.frac < 1 ? S("circle", { cx: at.x, cy: at.y, r: 13, fill: "#ffd60a" }) : null], "flex:1;min-height:0;margin-top:6px"),
      E("div", "cw-row cw-sp", "", [E("div", "", "", [E("div", "cw-t23", "", ["Sunrise"]), E("div", "cw-t29", "", [s.rise])]), E("div", "", "text-align:right", [E("div", "cw-t23", "", ["Sunset"]), E("div", "cw-t29", "", [s.set])])])]);
  };
  var CITY = { "Australia/Sydney": "Sydney", "Australia/Brisbane": "Brisbane", "Australia/Melbourne": "Melbourne", "Australia/Perth": "Perth", "Australia/Adelaide": "Adelaide",
    "Europe/London": "London", "America/New_York": "New York", "America/Los_Angeles": "Los Angeles", "Asia/Tokyo": "Tokyo", "Pacific/Auckland": "Auckland", "Asia/Singapore": "Singapore", "Europe/Paris": "Paris" };
  function tzTime(tz) {
    try {
      var s = new Date().toLocaleTimeString("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
      var m = /(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(s);
      return m ? { h: +m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0), m: +m[2], t: m[1] + ":" + m[2] + m[3].toLowerCase() } : null;
    } catch (e) { return null; }
  }
  R.worldclock = function (root, o, b) {
    var cities = (op(o).cities && op(o).cities.length ? op(o).cities : ["Australia/Brisbane", "Europe/London", "America/New_York", "Asia/Tokyo"]).slice(0, b.w > b.h * 1.6 ? 4 : Math.max(2, Math.floor((b.h - 90) / 90)));
    // the TV's own time zone is called by its own town (the place set for the weather), not the zone's city
    var here = ""; try { here = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    var town = (dataOf(arguments[3] || {}).place || {}).name || "";
    var name = function (tz) { return tz === here && town ? town : CITY[tz] || tz.split("/").pop().replace(/_/g, " "); };
    if (b.w > b.h * 1.6) {
      var faces = cities.map(function (tz) {
        var t = tzTime(tz) || { h: 0, m: 0 }, s = Math.min(b.h - 110, 170), night = t.h >= 18 || t.h < 6, fg = night ? "#fff" : "#111";
        return E("div", "cw-col", "align-items:center", [svg("0 0 100 100", s, s, [S("circle", { cx: 50, cy: 50, r: 48, fill: night ? "#1c1c1f" : "#f4f4f2" }),
          S("line", { x1: 50, y1: 50, x2: 50, y2: 27, stroke: fg, "stroke-width": 5, "stroke-linecap": "round", transform: "rotate(" + ((t.h % 12) * 30 + t.m / 2) + " 50 50)" }),
          S("line", { x1: 50, y1: 50, x2: 50, y2: 13, stroke: fg, "stroke-width": 3.4, "stroke-linecap": "round", transform: "rotate(" + t.m * 6 + " 50 50)" }),
          S("circle", { cx: 50, cy: 50, r: 3.5, fill: "#ff9f0a" })]), E("div", "cw-t25", "color:var(--ink);font-weight:650;margin-top:10px", [name(tz)])]);
      });
      add(root, E("div", "cw-row", "justify-content:space-around;height:100%", faces));
      live(root, 30000, function () { while (root.lastChild && root.lastChild.className !== "cw-bg") root.removeChild(root.lastChild); R.worldclock(root, o, b); });
      return;
    }
    // the cities spread from under the label to the bottom, so the whole sits in the middle
    add(root, [lab("clock", op(o).label || "World clock"), E("div", "cw-col cw-grow", "justify-content:space-between;margin-top:18px", cities.map(function (tz) {
      var t = tzTime(tz);
      return E("div", "cw-row cw-sp", "", [E("div", "cw-t29 cw-ell", "min-width:0", [name(tz)]), E("div", "cw-t38", "flex:none;margin-left:12px", [t ? t.t : ""])]);
    }))]);
  };
  function daysTo(month, day) {
    var t = now(), y = t.getFullYear(), today = new Date(y, t.getMonth(), t.getDate()), target = new Date(y, month - 1, day);
    if (target < today) target = new Date(y + 1, month - 1, day);
    return Math.round((target - today) / 86400000);
  }
  R.countdown = function (root, o, b) {
    var q = op(o), month = q.month || 12, day = q.day || 25, n = daysTo(month, day), unit = q.unit || "sleeps";
    var label = q.label || (month === 12 && day === 25 ? "Christmas" : "The big day");
    var num = unit === "weeks" ? Math.round(n / 7) : n;
    var u = n === 0 ? "It's today!" : unit === "weeks" ? (num === 1 ? "week to go" : "weeks to go") : unit === "days" ? (n === 1 ? "day to go" : "days to go") : (n === 1 ? "sleep to go" : "sleeps to go");
    var tiny = b.h < 200, fs = clamp(Math.min((b.h - (tiny ? 84 : 110)) * 0.95, (b.w - 48) / (String(num).length * 0.62)), 44, 200);
    add(root, [b.w < 300 ? E("div", "cw-t23 cw-ell", "font-weight:700;color:var(--sub)", [label]) : lab(q.icon || "calendar", label, "rgba(255,255,255,.9)"), E("div", "cw-grow"), n === 0 ? null : E("div", "cw-big", "font-size:" + px(fs), [String(num)]), tiny && n ? null : E("div", "cw-t29 cw-ell", "font-weight:650", [u])]);
    var lb = root.querySelector(".cw-lab"); if (lb && root.classList.contains("cw-tint")) lb.style.color = "var(--sub)";
  };
  R.date = function (root, o, b, env) {
    var q = op(o), show = q.show || "date", d = now(), w = weather(env), short = b.w < 560 || q.dfmt === "short";
    var dText = short ? shortDate(d) : longDate(d);
    var wText = w ? w.temp + "°" + (show === "both" && b.h >= 120 ? (w.code !== undefined ? " and " + wxWords(w.code).toLowerCase() : "") : (b.w >= 600 && q.place !== false && w.place ? " " + w.place : "") + (b.w >= 760 && w.code !== undefined ? ", " + wxWords(w.code).toLowerCase() : "")) : "";
    var big = b.h >= 160, fs = big ? clamp(b.h / 3.4, 34, 72) : clamp(b.h * 0.6, 26, 40), align = q.align || "center";
    var lines = [];
    if (show === "both" && w && b.h < 120) lines.push(dText + ". " + wText);
    else {
      if (show !== "weather") lines.push(dText);
      if (show !== "date" && w) lines.push(wText);
      if (show === "weather" && !w) lines.push("Set your town for the weather");
    }
    var bare = root.classList.contains("cw-bare");
    add(root, E("div", "cw-col", "height:100%;justify-content:center;text-align:" + align + (bare ? ";text-shadow:0 2px 18px rgba(0,0,0,.35)" : ""), lines.map(function (l, i) {
      // as big as the line fits across (Inter is about .56em a letter), else on two lines at 24 px
      var want = i ? Math.max(24, fs * 0.66) : fs, fit = (b.w - 48) / (l.length * 0.56), f = Math.max(24, Math.min(want, fit)), wrap = fit < 24 && b.h >= 120;
      return E("div", i ? "cw-dim" : "", "font-size:" + px(f) + ";font-weight:" + (i ? 560 : 620) + ";letter-spacing:-.01em;line-height:1.15;" + (wrap ? "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" : "white-space:nowrap;overflow:hidden;text-overflow:ellipsis") + (i ? ";margin-top:6px" : ""), [l]);
    })));
  };
  R.month = function (root, o, b) {
    var d = now(), y = d.getFullYear(), m = d.getMonth(), first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    var cells = ["M", "T", "W", "T", "F", "S", "S"].map(function (x) { return E("span", "h", "", [x]); });
    for (var i = 0; i < first; i++) cells.push(E("span", "", "", [""]));
    for (var k = 1; k <= days; k++) cells.push(E("span", k === d.getDate() ? "today" : "", "", [k === d.getDate() ? E("b", "", "", [String(k)]) : String(k)]));
    var rows = Math.ceil((first + days) / 7) + 1, ch = Math.min(56, (b.h - 110) / rows);
    cells.forEach(function (c) { c.style.height = px(ch); c.style.lineHeight = px(ch); });
    add(root, [E("div", "cw-row cw-sp", "", [E("div", "cw-t29", "font-weight:700;color:#ff453a;letter-spacing:.04em", [MONTHS[m].toUpperCase()]), E("div", "cw-t23", "", [String(y)])]),
      E("div", "cw-month cw-grow", "margin-top:14px", cells)]);
  };
  // Timers are kept on this TV (localStorage), started from the remote in the Timers layer
  // (widget-detail.js): one at a time, a label from a fixed list, nothing from a design.
  var TIMER_KEY = "couchtv.timer", TIMER_FNS = [];
  var Timer = {
    get: function () { try { var t = JSON.parse(localStorage.getItem(TIMER_KEY) || "null"); return t && isFinite(t.end) && isFinite(t.total) ? t : null; } catch (e) { return null; } },
    put: function (t) { try { if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t)); else localStorage.removeItem(TIMER_KEY); } catch (e) {} TIMER_FNS.forEach(function (f) { try { f(t); } catch (x) {} }); },
    start: function (min, label) { var ms = clamp(+min || 1, 1, 180) * 60000; Timer.put({ end: Date.now() + ms, total: ms, label: String(label || "Timer").slice(0, 24) }); },
    add: function (min) { var t = Timer.get(); if (!t) return Timer.start(min); var left = Math.max(0, t.end - Date.now()); t.end = Date.now() + left + min * 60000; t.total = Math.max(t.total, left + min * 60000); delete t.seen; Timer.put(t); },
    cancel: function () { Timer.put(null); },
    left: function (t) { t = t || Timer.get(); return t ? Math.max(0, t.end - Date.now()) : 0; },
    // a timer that finished more than ten minutes ago is forgotten
    live: function () { var t = Timer.get(); if (t && Date.now() - t.end > 600000) { Timer.put(null); return null; } return t; },
    on: function (fn) { TIMER_FNS.push(fn); }
  };
  function mmss(ms) { var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function ring(s, frac, colour, done) {
    return svg("0 0 100 100", s, s, [S("circle", { cx: 50, cy: 50, r: 44, fill: "none", stroke: done ? "rgba(255,69,58,.3)" : "rgba(255,159,10,.22)", "stroke-width": 7 }),
      frac > 0.004 ? S("circle", { cx: 50, cy: 50, r: 44, fill: "none", stroke: done ? "#ff453a" : colour || "#ff9f0a", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": 276, "stroke-dashoffset": 276 * (1 - clamp(frac, 0, 1)), transform: "rotate(-90 50 50)" }) : null]);
  }
  R.timer = function (root, o, b, env) {
    var draw = function () {
      while (root.lastChild && root.lastChild.className !== "cw-bg") root.removeChild(root.lastChild);
      var t = Timer.live();
      if (!t && env.demo) t = { end: Date.now() + 668000, total: 1080000, label: op(o).label || "Pizza", demo: 1 };
      var wide = b.w > b.h * 1.6, s = Math.min(wide ? b.h : b.w, b.h) - 48;
      if (!t) {
        add(root, wide ? E("div", "cw-row", "height:100%", [ic("timer", 56, "currentColor"), E("div", "cw-col", "margin-left:20px;min-width:0", [E("div", "cw-t29 cw-ell", "font-weight:700", ["No timer"]), E("div", "cw-t23 cw-ell", "", ["OK to start one"])])])
          : [ic("timer", b.h < 200 ? 44 : 64, "currentColor"), E("div", "cw-grow"), E("div", b.w < 300 ? "cw-t25" : "cw-t29", "font-weight:700;color:var(--ink)", ["No timer"]), E("div", "cw-t23 cw-ell", "", ["OK to start one"])]);
        return;
      }
      var left = t.demo ? t.end - Date.now() : Timer.left(t), done = !t.demo && left <= 0, frac = done ? 1 : left / t.total;
      var words = done ? "Time's up" : mmss(left);
      var fs = clamp(s * (words.length > 5 ? 0.17 : 0.21), 26, 110);
      var label = E("div", "cw-t23 cw-ell", "max-width:" + px(s * 0.78) + (done ? ";color:#ff453a;font-weight:700" : ""), [t.label]);
      if (wide) {
        add(root, E("div", "cw-row", "height:100%", [ring(s, frac, null, done), E("div", "cw-col", "margin-left:24px;min-width:0", [E("div", "cw-big", "font-size:" + px(clamp(b.h * 0.42, 40, 96)), [words]), label])]));
      } else {
        add(root, E("div", "cw-grow cw-row cw-center", "position:relative", [ring(s, frac, null, done),
          E("div", "", "position:absolute;text-align:center", [E("div", "", "font-size:" + px(fs) + ";font-weight:650;letter-spacing:-.02em" + (done ? ";color:#ff453a" : ""), [words]), s >= 140 ? label : null])]));
      }
      root.classList.toggle("cw-done", done);
    };
    draw();
    live(root, 1000, draw);
  };

  // weather
  function noWx(root, b, env) { return empty(root, b, "partly-cloudy", dataOf(env).wxOff ? "Weather is off on this TV" : "Set your town for the weather", dataOf(env).wxOff ? "Turn it on in Home settings, Weather" : "Settings (hold OK), Home settings, Location"); }
  R.weather = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    var q = op(o), large = b.w > 300, tiny = b.h < 300;
    if (b.h < 200) {
      // a Tile: the temperature and the sky, nothing else
      add(root, [ic(wxIcon(w.code, w.is_day), 44, rgba(sh.ink, 1), "solid"), E("div", "cw-grow"), E("div", "cw-big", "white-space:nowrap;font-size:" + px(fitPx(w.temp + "°", b.w - 48, 64)), [w.temp + "°"])]);
      return;
    }
    add(root, [q.place === false ? null : E("div", "cw-t29 cw-ell", "font-weight:640", [w.place || "Here"]),
      E("div", "cw-big", "font-size:" + px(tiny ? 72 : large ? Math.min(124, b.h * 0.3) : 92) + ";margin-top:6px", [w.temp + "°"]), E("div", "cw-grow"),
      tiny ? null : ic(wxIcon(w.code, w.is_day), 40, rgba(sh.ink, 1), "solid"),
      E("div", "cw-t25 cw-ell", "color:var(--ink);font-weight:600;margin-top:6px", [wxWords(w.code)]),
      q.hilo === false || w.hi === undefined ? null : E("div", "cw-t23", "", [w.ahead ? w.ahead.label + " H:" + w.ahead.hi + "° L:" + w.ahead.lo + "°" : "H:" + w.hi + "° L:" + w.lo + "°"])]);
  };
  R.bigtemp = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    var st = o.style || {};
    // the colour of the day: warm when hot, blue when cool (unless the style picked one)
    if (!st.colour && sh.panel === "colour") {
      var hot = w.temp >= 26, cold = w.temp < 15, c = hot ? "linear-gradient(160deg,#ffb340,#ff7a45)" : cold ? "linear-gradient(160deg,#64d2ff,#0a84ff)" : "linear-gradient(160deg,#ffd60a,#ff9f0a)";
      if (!w.is_day) c = "linear-gradient(160deg,#1c2a52,#0b1430)";
      root.style.setProperty("--tile", c);
      var ink = !w.is_day ? WHITE : cold ? WHITE : [42, 20, 5];
      root.style.setProperty("--ink", rgba(ink, 1)); root.style.setProperty("--sub", rgba(ink, 0.78)); root.style.color = rgba(ink, 1); sh.ink = ink;
    }
    if (b.h < 200) {
      // a tile: the sky and the number
      add(root, [ic(wxIcon(w.code, w.is_day), 40, rgba(sh.ink, 1), "solid"), E("div", "cw-grow"), E("div", "cw-big", "white-space:nowrap;font-size:" + px(Math.min(clamp(b.w * 0.4, 56, 80), fitPx(w.temp + "°", b.w - 48, 80))) + ";letter-spacing:-.05em", [w.temp + "°"])]);
      return;
    }
    var fs = Math.min(b.h * 0.52, b.w * 0.44), ah = w.ahead;
    fs = Math.min(fs, fitPx(w.temp + "°", b.w - 48, fs));   // a minus sign (-23°) still fits across the box
    // in the evening the line under the number looks ahead: tomorrow's sky and top, not today's past one
    var words = ah ? E("div", "cw-col", "margin-top:6px", [E("div", "cw-t29 cw-ell", "font-weight:680", [ah.label + (ah.hi !== undefined ? ", top of " + ah.hi + "°" : "")]),
      b.h >= 300 ? E("div", "cw-t23 cw-ell cw-ahead", "", [wxWords(ah.code)]) : null])
      : E("div", "cw-t29 cw-ell", "font-weight:680;margin-top:6px", [wxWords(w.code) + (w.hi !== undefined && b.w >= 400 ? ", top of " + w.hi + "°" : "")]);
    if (ah) fs = Math.min(fs, b.h * 0.42);
    add(root, [E("div", "cw-row cw-sp", "", [o.opts && o.opts.place === false ? E("span") : E("div", "cw-t29 cw-ell", "font-weight:700", [w.place || "Here"]), ic(wxIcon(w.code, w.is_day), clamp(b.w / 6, 44, 80), rgba(sh.ink, 1), "solid")]),
      E("div", "cw-grow"), E("div", "cw-big", "font-size:" + px(fs) + ";letter-spacing:-.06em", [w.temp + "°"]), words]);
  };
  R.hourly = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.hourly) return empty(root, b, "clock", "The hourly forecast is on its way", "");
    var n = clamp(Math.floor((b.w - 48) / 110), 3, w.hourly.length), ink = rgba(sh.ink, 1);
    var next = w.hourly.slice(1).filter(function (h) { return h[1] >= 51; })[0];
    add(root, [E("div", "cw-row cw-sp", "", [E("div", "", "min-width:0;flex:0 1 auto", [E("div", "cw-t29 cw-ell", "font-weight:640", [w.place || "Here"]), E("div", "cw-big", "font-size:72px;margin-top:4px", [w.temp + "°"])]),
      E("div", "cw-col", "text-align:right;align-items:flex-end;min-width:0;max-width:55%;margin-left:16px;flex:0 1 auto", [ic(wxIcon(w.code, w.is_day), 44, ink, "solid"), E("div", "cw-t25 cw-ell", "color:var(--ink);font-weight:600", [next ? wxWords(next[1]) + " from " + next[0] : wxWords(w.code)]), w.hi !== undefined ? E("div", "cw-t23 cw-ell", "", ["H:" + w.hi + "° L:" + w.lo + "°"]) : null])]),
      E("div", "cw-grow"),
      E("div", "cw-row cw-sp", "border-top:1.5px solid rgba(255,255,255,.25);padding-top:16px", w.hourly.slice(0, n).map(function (h) {
        return E("div", "cw-col", "align-items:center", [E("div", "cw-t23", "color:var(--ink)", [h[0]]), E("div", "", "margin:8px 0", [ic(wxIcon(h[1], !h[3]), 36, ink, "solid")]), E("div", "", "font-size:27px;font-weight:650", [h[2] + "°"])]);
      }))]);
  };
  R.week = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.daily) return empty(root, b, "calendar", "The week's forecast is on its way", "");
    var rows = clamp(Math.floor((b.h - 170) / 62), 3, w.daily.length), ink = rgba(sh.ink, 1), lo = 99, hi = -99;
    w.daily.forEach(function (d) { lo = Math.min(lo, d[2]); hi = Math.max(hi, d[3]); });
    var span = Math.max(6, hi - lo);
    add(root, [E("div", "cw-row cw-sp", "", [E("div", "", "min-width:0;flex:0 1 auto", [E("div", "cw-t29 cw-ell", "font-weight:640", [w.place || "Here"]), E("div", "cw-big", "font-size:76px;margin-top:4px", [w.temp + "°"])]), ic(wxIcon(w.code, w.is_day), 56, ink, "solid")]),
      E("div", "cw-col cw-grow", "margin-top:18px;justify-content:space-around", w.daily.slice(0, rows).map(function (d) {
        var a = (d[2] - lo) / span * 100, z = (d[3] - lo) / span * 100;
        return E("div", "cw-row", "font-size:27px;font-weight:620", [E("span", "", "width:96px;flex:none", [d[0]]), E("span", "", "margin:0 14px;flex:none;display:flex", [ic(wxIcon(d[1], true), 34, ink, "solid")]),
          E("span", "", "width:52px;text-align:right;opacity:.7;flex:none", [d[2] + "°"]),
          E("span", "cw-bar", "flex:1;margin:0 14px;background:rgba(0,0,0,.18)", [E("b", "", "position:absolute;top:0;left:" + a + "%;width:" + Math.max(4, z - a) + "%;background:linear-gradient(90deg,#9fe6a0,#ffd60a,#ff9f0a)")]),
          E("span", "", "width:52px;flex:none", [d[3] + "°"])]);
      }))]);
  };
  R.rain = function (root, o, b, env) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.rain) return empty(root, b, "rain", "Rain soon is on its way", "");
    var heavy = (w.rainMax || 3) >= 2.5;
    add(root, [lab("rain", op(o).label || "Rain soon"), E("div", "cw-t38", "margin-top:10px", [w.rainFrom ? (heavy ? "Heavy rain from " : "Rain from ") + w.rainFrom : "No rain coming"]),
      E("div", "cw-grow cw-row", "align-items:flex-end;margin-top:14px", w.rain.map(function (v) { return E("i", "", "display:block;flex:1;margin:0 4px;height:" + v + "%;border-radius:6px;background:#64d2ff"); })),
      E("div", "cw-row cw-sp cw-t23", "margin-top:8px", [E("span", "", "", ["Now"]), E("span", "", "", ["+1h"]), E("span", "", "", ["+2h"]), E("span", "", "", ["+3h"])])]);
  };
  R.uv = function (root, o, b, env) {
    var w = weather(env);
    if (!w || w.uv === undefined) return w ? empty(root, b, "sun", "UV is on its way", "") : noWx(root, b, env);
    var band = w.uv < 3 ? "Low" : w.uv < 6 ? "Moderate" : w.uv < 8 ? "High" : w.uv < 11 ? "Very high" : "Extreme";
    add(root, [lab("sun", op(o).label || "UV index"), E("div", "cw-big", "font-size:" + px(b.h < 300 ? 64 : 96) + ";margin-top:8px", [String(w.uv)]), E("div", "cw-t29", "font-weight:680", [band]), E("div", "cw-grow"),
      E("div", "cw-bar", "background:linear-gradient(90deg,#34c759,#ffd60a,#ff9f0a,#ff3b30,#af52de);overflow:visible", [E("i", "", "position:absolute;left:" + clamp(w.uv / 12 * 100, 2, 96) + "%;top:-6px;width:20px;height:20px;border-radius:10px;background:#fff;border:3px solid #ff6a3d;display:block")]),
      b.h >= 300 && w.uvFrom ? E("div", "cw-t23", "color:var(--ink);margin-top:12px", ["Sun protection " + w.uvFrom + " to " + w.uvTo]) : null]);
  };
  R.sun = function (root, o, b, env) {
    var s = sunToday(env);
    if (!s) return empty(root, b, "sun", "Set your town for the sun", "Settings (hold OK), Home settings, Location");
    var at = arc(s.frac);
    add(root, [lab("sun", op(o).label || "Sun"), svg("0 0 300 120", "100%", "100%", [S("path", { d: "M10 110 Q150 -40 290 110", fill: "none", stroke: "rgba(255,255,255,.3)", "stroke-width": 4, "stroke-dasharray": "2 10", "stroke-linecap": "round" }),
      s.frac > 0 && s.frac < 1 ? S("circle", { cx: at.x, cy: at.y, r: 14, fill: "#ffd60a" }) : null], "flex:1;min-height:0;margin:6px 0"),
      E("div", "cw-row cw-sp", "", [E("div", "cw-t29", "", ["↑ " + s.rise]), b.w >= 300 ? E("div", "cw-t29", "", ["↓ " + s.set]) : null])]);
  };
  R.moon = function (root, o, b) {
    var m = moon(now()), r = 44, f = m.f, s = Math.max(60, Math.min(b.w - 48, b.h - 150) * 0.85);
    // the lit part: a half disc and an ellipse whose width follows the phase
    var waxing = f < 0.5, k = Math.cos(f * 2 * Math.PI), ex = Math.abs(k) * r;
    var lit = S("path", { d: "M50 6 A44 44 0 0 " + (waxing ? 1 : 0) + " 50 94 A" + ex + " 44 0 0 " + ((waxing ? k > 0 : k < 0) ? 0 : 1) + " 50 6Z", fill: "#f2efe6" });
    add(root, [E("div", "cw-lab", "", ["Moon"]), E("div", "cw-grow cw-row cw-center", "", [svg("0 0 100 100", s, s, [S("circle", { cx: 50, cy: 50, r: r, fill: "#2a2a30" }), lit])]),
      E("div", "cw-t29", "", [m.name]), b.h >= 280 ? E("div", "cw-t23", "", [m.full]) : null]);
  };
  // air quality: the European AQI from Open-Meteo's free air quality service (app.js asks for it only
  // while an air widget is on the home); its bands are the EEA's
  function aqiBand(v) { return v < 20 ? ["Good", "#30d158"] : v < 40 ? ["Fair", "#a4e05a"] : v < 60 ? ["Moderate", "#ffd60a"] : v < 80 ? ["Poor", "#ff9f0a"] : v < 100 ? ["Very poor", "#ff453a"] : ["Extremely poor", "#bf5af2"]; }
  function airOf(env) {
    if (env.demo) return { aqi: 18, hourly: [18, 17, 16, 18, 21, 24, 26, 25, 22, 20, 19, 18] };
    var w = dataOf(env).weather;
    return w && w.air && isFinite(w.air.aqi) ? w.air : null;
  }
  R.air = function (root, o, b, env) {
    var a = airOf(env);
    if (!a) return weather(env) ? empty(root, b, "wind", "Waiting for the air quality", "From Open-Meteo, every refresh") : noWx(root, b, env);
    var v = Math.round(a.aqi), band = aqiBand(v);
    if (b.h < 200) {
      add(root, b.w < 300 ? [lab("wind", op(o).label || "Air"), E("div", "cw-grow"), E("div", "cw-big", "font-size:56px;color:" + band[1], [String(v)]), E("div", "cw-t23 cw-ell", "font-weight:700;color:var(--ink)", [band[0]])]
        : E("div", "cw-row cw-sp", "height:100%", [E("div", "cw-col", "min-width:0", [lab("wind", op(o).label || "Air quality"), E("div", "cw-t29 cw-ell", "font-weight:700;margin-top:8px", [band[0]])]), E("div", "cw-big", "font-size:84px;color:" + band[1], [String(v)])]));
      return;
    }
    add(root, [lab("wind", op(o).label || "Air quality"), E("div", "cw-big", "font-size:96px;margin-top:8px;color:" + band[1], [String(v)]), E("div", "cw-t29", "font-weight:680", [band[0]]), E("div", "cw-grow"),
      E("div", "cw-bar", "background:linear-gradient(90deg,#30d158,#a4e05a,#ffd60a,#ff9f0a,#ff453a,#bf5af2);overflow:visible", [E("i", "", "position:absolute;left:" + clamp(v, 2, 96) + "%;top:-6px;width:20px;height:20px;border-radius:10px;background:#fff;border:3px solid #111;display:block")])]);
  };
  // surf: swell from Open-Meteo's free marine service for the sea nearest the town, and the wind from
  // the forecast (app.js asks only while a surf widget is on the home)
  var COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function compass(deg) { return isFinite(deg) ? COMPASS[Math.round(((+deg % 360) + 360) % 360 / 45) % 8] : ""; }
  function surfOf(env) {
    if (env.demo) return { wave: 1.4, period: 11, dir: 135, wind: 9, windDir: 250, hourly: [1.2, 1.3, 1.4, 1.4, 1.5, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.1] };
    var w = dataOf(env).weather;
    return w && w.marine ? w.marine : null;
  }
  R.surf = function (root, o, b, env) {
    var m = surfOf(env);
    if (!m) return weather(env) ? empty(root, b, "wind", "Waiting for the swell", "From Open-Meteo's marine service") : noWx(root, b, env);
    if (!isFinite(m.wave)) return empty(root, b, "wind", "No surf reading here", "The sea is too far from your town");
    var place = op(o).label || (env.demo ? "The point" : (dataOf(env).place || {}).name || "Surf");
    var swell = compass(m.dir) + " swell" + (isFinite(m.period) ? ", " + Math.round(m.period) + "s" : "");
    var wind = isFinite(m.wind) ? compass(m.windDir) + " " + Math.round(m.wind) + " km/h" : "";
    var big = E("div", "cw-big", "font-size:" + px(b.h < 200 ? 64 : 92), [String(Math.round(m.wave * 10) / 10), E("span", "", "font-size:.4em", ["m"])]);
    if (b.h < 200) {
      add(root, E("div", "cw-row cw-sp", "height:100%", [E("div", "cw-col", "min-width:0", [lab("wind", place, "rgba(255,255,255,.88)"), E("div", "cw-t25 cw-ell", "color:#fff;margin-top:6px", [swell])]), big]));
      return;
    }
    var hs = (m.hourly || []).slice(0, 12), top = Math.max.apply(null, hs.concat([0.5]));
    add(root, [lab("wind", place, "rgba(255,255,255,.88)"),
      E("div", "cw-row", "margin-top:10px;align-items:flex-end", [E("div", "", "margin-right:28px", [big, E("div", "cw-t25", "color:#fff", [swell])]),
        b.w >= 460 && wind ? E("div", "", "", [E("div", "cw-t38", "", ["Wind"]), E("div", "cw-t25", "color:#fff", [wind])]) : null]),
      E("div", "cw-grow"),
      hs.length ? E("div", "cw-row", "align-items:flex-end;height:70px;flex:none", hs.map(function (v) { return E("i", "", "display:block;flex:1;margin:0 3px;border-radius:5px;background:rgba(255,255,255,.7);height:" + Math.round(clamp(v / top, 0.08, 1) * 100) + "%"); })) : null,
      hs.length ? E("div", "cw-row cw-sp cw-t23", "color:#fff;margin-top:6px", [E("span", "", "", ["Now"]), E("span", "", "", ["+12h"])]) : null]);
  };

  // photos
  // a photo box has no panel of its own (the photo is the panel), so with no photo yet its words sat
  // white on whatever was behind (white on a light look's beige): a dark panel under them, always readable
  function noPhotos(root, b) {
    empty(root, b, "picture", "Add your photos on the TV", "Settings (hold OK), Home settings, Your photos");
    var bg = null;
    for (var i = 0; i < root.childNodes.length; i++) if (root.childNodes[i].className === "cw-bg") bg = root.childNodes[i];
    if (!bg) { bg = E("div", "cw-bg"); root.insertBefore(bg, root.firstChild); }
    bg.style.background = "rgba(18, 18, 22, 0.78)"; bg.style.borderRadius = "inherit";
    root.style.color = "#fff"; root.style.setProperty("--ink", "#fff"); root.style.setProperty("--sub", "rgba(255, 255, 255, 0.78)");
    root.classList.add("cw-photo-empty");
    return root;
  }
  function cssImg(u) { return 'url("' + String(u).replace(/["\\\n()]/g, encodeURIComponent) + '")'; }
  function photoLayer(u, fit) { return E("div", "cw-fill", "background-image:" + cssImg(u) + ";background-size:" + (fit === "contain" ? "contain;background-repeat:no-repeat" : "cover")); }
  function caption(root, q) {
    if (!q.caption) return;
    // a scrim strong enough for white words on any photo, even a white sky or snow
    add(root, E("div", "", "position:absolute;left:0;right:0;bottom:0;padding:80px 28px 24px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.55) 45%,rgba(0,0,0,.78));z-index:2", [E("div", "cw-t29", "font-weight:650;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.5)", [q.caption]), q.sub ? E("div", "cw-t23", "color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.5)", [q.sub]) : null]));
  }
  function dayIndex(n, secs) { return n ? Math.floor(Date.now() / (secs * 1000)) % n : 0; }
  R.photo = function (root, o, b, env) {
    var ps = photos(env, o);
    if (!ps.length) return noPhotos(root, b);
    var q = op(o);
    add(root, photoLayer(ps[q.image ? 0 : dayIndex(ps.length, 86400)], q.fit));
    caption(root, q);
  };
  R.slideshow = function (root, o, b, env) {
    var ps = photos(env, o);
    if (!ps.length) return noPhotos(root, b);
    var q = op(o), secs = q.seconds_each || 20, i = dayIndex(ps.length, secs);
    var a = photoLayer(ps[i]), c = photoLayer(ps[(i + 1) % ps.length]);
    a.classList.add("cw-layer"); c.classList.add("cw-layer"); c.style.opacity = "0";
    var n = Math.min(ps.length, 8), dots = E("div", "cw-hdots", q.caption ? "top:24px" : "bottom:22px", []);
    for (var k = 0; k < n; k++) dots.appendChild(E("i", k === i % n ? "on" : ""));
    add(root, [a, c]); caption(root, q); root.appendChild(dots);
    var shownI = i, front = a, backL = c;
    live(root, 1000, function () {
      var j = dayIndex(ps.length, secs);
      if (j === shownI) return;
      shownI = j; backL.style.backgroundImage = cssImg(ps[j]); backL.style.opacity = "1"; front.style.opacity = "0";
      var t = front; front = backL; backL = t;
      for (var d = 0; d < dots.children.length; d++) dots.children[d].className = d === j % n ? "on" : "";
    });
  };
  R.mosaic = function (root, o, b, env) {
    var ps = photos(env, o);
    if (!ps.length) return noPhotos(root, b);
    var n = clamp(op(o).count || (b.w > 1000 ? 5 : 3), 1, Math.min(5, ps.length)), start = dayIndex(ps.length, 30), gap = 16;
    var pick = []; for (var i = 0; i < n; i++) pick.push(ps[(start + i) % ps.length]);
    var cols = n > 3 ? 3 : n > 1 ? 2 : 1, rows = n > 1 ? 2 : 1, wBig = cols === 1 ? b.w : (b.w - gap * (cols - 1)) * (cols === 3 ? 0.42 : 0.58);
    var smallW = cols === 1 ? 0 : (b.w - wBig - gap * (cols - 1)) / (cols - 1), smallH = (b.h - gap) / 2;
    var tiles = [E("div", "", "position:absolute;left:0;top:0;width:" + px(wBig) + ";height:" + px(b.h) + ";border-radius:24px;background:#333 center/cover;background-image:" + cssImg(pick[0]))];
    for (var k = 1; k < n; k++) {
      var col = Math.floor((k - 1) / 2), row = (k - 1) % 2;
      tiles.push(E("div", "", "position:absolute;left:" + px(wBig + gap + col * (smallW + gap)) + ";top:" + px(row * (smallH + gap)) + ";width:" + px(smallW) + ";height:" + px(rows === 2 && n === 2 ? b.h : smallH) + ";border-radius:24px;background:#333 center/cover;background-image:" + cssImg(pick[k])));
    }
    add(root, tiles);
  };
  R.artframe = function (root, o, b, env) {
    var q = op(o), ps = q.image ? [q.image] : env.demo ? [demoImg("art")] : photos(env, o);
    if (!ps.length) return noPhotos(root, b);
    var mat = q.mat || "#fbf8f1", lh = q.caption ? 92 : 0, pad = Math.max(10, Math.min(b.w, b.h) * 0.014);
    add(root, [E("div", "", "position:absolute;left:0;top:0;right:0;bottom:" + px(lh) + ";background:" + mat + ";border-radius:4px;box-shadow:0 0 0 1px #d8d0c2,0 24px 40px rgba(60,40,20,.14);padding:" + px(pad), [
      E("div", "", "width:100%;height:100%;background:#222 center/cover;background-image:" + cssImg(ps[dayIndex(ps.length, 3600)]) + ";box-shadow:inset 0 2px 8px rgba(0,0,0,.25)")]),
      q.caption ? E("div", "", "position:absolute;left:0;right:0;bottom:0;height:" + px(lh - 16) + ";display:flex;flex-direction:column;justify-content:center", [E("div", "cw-t29", "font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:600", [q.caption]), q.sub ? E("div", "cw-t23", "", [q.sub]) : null]) : null]);
  };

  // watching
  function noShows(root, b, env) { return env && dataOf(env).bridge === false ? soon(root, b, "tv", "keep") : empty(root, b, "tv", "Nothing to keep watching yet", "Shows you start on this TV show up here"); }
  function showCard(s, b, env, i, n) {
    var logoA = clamp(b.h / 9, 34, 48);
    var card = E("div", "cw-layer", "", [E("div", "cw-fill", "background:#2a2a30 center/cover;" + (s.art ? "background-image:" + cssImg(s.art) : "")),
      E("div", "cw-fill", "background:linear-gradient(180deg,rgba(0,0,0,.05) 35%,rgba(0,0,0,.8))"),
      E("div", "", "position:absolute;left:24px;right:24px;bottom:22px;color:#fff", [
        b.h >= 300 ? E("div", "cw-row", "", [s.app ? appIcon(s.app, logoA, env) : null, E("span", "cw-t23", "color:rgba(255,255,255,.88);margin-left:10px", ["Keep watching"])]) : null,
        E("div", b.h >= 300 ? "cw-t38 cw-ell" : "cw-t29 cw-ell", "margin-top:10px;font-weight:720", [s.title]), b.h >= 220 && s.sub ? E("div", "cw-t23 cw-ell", "color:rgba(255,255,255,.82)", [s.sub]) : null,
        s.progress ? E("div", "cw-bar", "margin-top:14px", [E("b", "", "width:" + Math.round(s.progress * 100) + "%;background:#fff")]) : null])]);
    stop(card, "show", i, s.title);
    void n;
    return card;
  }
  function appIcon(pkg, a, env) {
    var u = iconUrl(pkg, env);
    return u ? E("span", "", "display:block;width:" + px(a) + ";height:" + px(a) + ";border-radius:" + px(a * 0.24) + ";background:#222 center/cover;flex:none;background-image:" + cssImg(u)) : null;
  }
  R.keep = function (root, o, b, env) {
    var list = shows(env);
    if (!list.length) return noShows(root, b, env);
    list = list.slice(0, 5);
    root.classList.add("cw-photo");
    var at = dayIndex(list.length, 8), cards = list.map(function (s, i) { var c = showCard(s, b, env, i, list.length); c.removeAttribute("data-act"); c.style.opacity = i === at ? "1" : "0"; return c; });
    add(root, cards);
    var dots = E("div", "cw-hdots", "top:22px;left:auto;right:22px", []);
    list.forEach(function (s, i) { dots.appendChild(E("i", i === at ? "on" : "")); });
    if (list.length > 1) root.appendChild(dots);
    // OK opens Keep watching (widget-detail.js) on the show that is showing
    stop(root, "detail", "keep", list[at].title); root.setAttribute("data-at", String(at));
    root.setAttribute("data-turns", "1");
    live(root, 1000, function () {
      if (root.classList.contains("cw-focus")) return;   // stops turning while focused
      var j = dayIndex(list.length, 8);
      if (j === at) return;
      at = j; cards.forEach(function (c, i) { c.style.opacity = i === at ? "1" : "0"; });
      for (var d = 0; d < dots.children.length; d++) dots.children[d].className = d === at ? "on" : "";
      root.setAttribute("data-at", String(at));
    });
  };
  R.keeprow = function (root, o, b, env) {
    var list = shows(env);
    if (!list.length) return noShows(root, b, env);
    var q = op(o), labelH = q.label === "" || b.h < 220 ? 0 : 50, gap = 28, n = clamp(q.shows || Math.floor((b.w + gap) / 380), 1, Math.min(5, list.length)), cw = (b.w - (n - 1) * gap) / n;
    add(root, [labelH ? E("div", "cw-lab", "color:var(--ink);margin-bottom:16px;text-shadow:0 2px 12px rgba(0,0,0,.3)", [q.label || "Keep watching"]) : null,
      E("div", "cw-row", "flex:1;align-items:stretch;min-height:0", list.slice(0, n).map(function (s, i) {
        var p = E("div", "cw-poster", "width:" + px(cw) + ";flex:none;" + (i ? "margin-left:" + gap + "px;" : "") + (s.art ? "background-image:" + cssImg(s.art) : ""), [E("div", "cap", "", [
          E("div", "cw-row", "", [s.app ? appIcon(s.app, 34, env) : null, E("span", "cw-t29 cw-ell", "color:#fff;font-weight:700;margin-left:10px", [s.title])]),
          s.progress ? E("div", "cw-bar", "margin-top:12px", [E("b", "", "width:" + Math.round(s.progress * 100) + "%;background:#fff")]) : null])]);
        return stop(p, "show", i, s.title);
      }))]);
  };
  // the sport apps a game comes from (the Game Day hero): Kayo, Foxtel, 9Now, 7plus, 10, DAZN
  var SPORT_APPS = ["au.com.kayosports.tv", "au.com.foxtel.atv", "au.com.ninenow.ctv", "com.swm.live", "au.com.tenplay", "dazn"];
  // an Up next is a game hero when it says so (opts.sport), or, when it does not say, when the design
  // also has a Scores widget (the Game Day preset); opts.apps narrows it to those apps
  function upnextSport(o, env) { var q = op(o); return q.sport === true || (q.sport !== false && !!env.sport); }
  R.upnext = function (root, o, b, env) {
    var q = op(o), sport = upnextSport(o, env), want = q.apps && q.apps.length ? q.apps : sport ? SPORT_APPS : null;
    // each show keeps its place in Keep watching: Resume opens that one (app.js "show" is its index)
    var list = shows(env).map(function (x, i) { x.i = i; return x; });
    if (want && !env.demo) list = list.filter(function (x) { return want.indexOf(x.app) >= 0; });
    if (!list.length) {
      // on a TV, never a demo and never an unrelated show: say plainly there is no game to pick up
      if (sport && !(env && dataOf(env).bridge === false)) return empty(root, b, "tv", "No game to pick up", "Start a game in Kayo, Foxtel or 9Now and it shows here");
      return noShows(root, b, env);
    }
    var s = env.demo ? (sport ? { title: "Titans v Broncos", sub: "NRL, round 3. Kick off 7:50pm", app: "au.com.kayosports.tv", art: bgImg("scene-golden"), i: 0 }
      : { title: "Bay of Fires", sub: "Season 1, episode 4. 52 min left", app: "au.com.stan.and", art: bgImg("vang-vieng-sunset"), i: 0 }) : list[0];
    var fs = clamp(Math.min(b.h / 6.5, b.w / 12), 48, 110);
    var resume = stop(E("div", "cw-chip", "background:#fff;color:#111;height:64px;font-size:27px;padding:0 30px", [ic("play", 30, "#111", "solid"), "Resume"]), "show", s.i, s.title);
    add(root, [E("div", "cw-fill", "background:#111 center/cover;" + (s.art ? "background-image:" + cssImg(s.art) : "")),
      E("div", "cw-fill", "background:linear-gradient(90deg,rgba(0,0,0,.85),rgba(0,0,0,.35) 55%,transparent 80%),linear-gradient(0deg,rgba(0,0,0,.6),transparent 50%)"),
      E("div", "", "position:absolute;left:44px;bottom:40px;max-width:60%;color:#fff", [
        E("div", "cw-row", "", [s.app ? appIcon(s.app, 44, env) : null, E("span", "cw-t25", "color:rgba(255,255,255,.88);font-weight:650;margin-left:12px", ["Up next"])]),
        // a long title takes two lines at most and ends in "...", so it never climbs out of the box
        E("div", "", "font-size:" + px(fs) + ";font-weight:780;letter-spacing:-.03em;line-height:1.08;margin-top:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere", [s.title]),
        s.sub ? E("div", "cw-t29 cw-ell", "color:rgba(255,255,255,.86);margin-top:14px", [s.sub]) : null,
        b.h >= 420 ? E("div", "cw-row", "margin-top:26px", [resume, stop(E("div", "cw-chip", "height:64px;font-size:27px;padding:0 30px;margin-left:16px;background:rgba(255,255,255,.2)", ["Start over"]), "show", s.i, s.title)]) : null])]);
    if (b.h < 420) stop(root, "show", s.i, s.title);
  };
  // Picks for you: from this TV's own Keep watching, no outside service (widget-web.js picks): what the
  // other grown ups at home are watching, then your own shows left part way further back. OK plays it.
  var DEMO_PICKS = [["Mystery Road", "scene-dawn", "Sam is watching"], ["Utopia", "aresquiers-beach", "Sam is watching"], ["The Newsreader", "scene-fog", "Pick up again"], ["Total Control", "scene-water", "Ruby is watching"],
    ["Colin from Accounts", "vang-vieng-sunset", "Pick up again"], ["Rake", "albury-storm", "Pick up again"], ["Wakefield", "scene-golden", "Sam is watching"]];
  function picksOf(env) {
    if (env.demo) return DEMO_PICKS.map(function (x, i) { return { title: x[0], art: bgImg(x[1]), why: x[2], i: i }; });
    var d = dataOf(env), WW = window.CouchWidgetWeb;
    return WW ? WW.picks(d.household || [], d.who, (d.apps || []).map(function (a) { return a && a.package; }), 8) : [];
  }
  R.picks = function (root, o, b, env) {
    var a = alignOf(o), list = picksOf(env);
    if (!list.length) {
      // no Keep watching at all (no bridge, no on-TV app): its setup steps; otherwise nothing yet
      if (!env.demo && dataOf(env).bridge === false && !(dataOf(env).household || []).some(function (p) { return p.shows && p.shows.length; })) { soon(root, b, "favourite", "picks"); return; }
      return webEmpty(root, b, "favourite", "No picks yet", "Shows anyone at home starts on this TV make picks here", "No picks yet");
    }
    var gap = 20, n = clamp(Math.floor((b.w - 48 + gap) / 220), 1, list.length), pw = Math.floor((b.w - 48 - (n - 1) * gap) / n);
    webBody(root, a, [webHead("favourite", op(o).label || "Picks for you", a), E("div", "cw-row", "flex:1;min-height:0;margin-top:14px;align-items:stretch;justify-content:" + jc(a), list.slice(0, n).map(function (p, i) {
      var cap = E("div", "", "position:absolute;left:0;right:0;bottom:0;padding:14px 16px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.82));text-align:" + a, [
        fitT(E("div", "", WRAP + "font-size:25px;line-height:1.2;color:#fff;font-weight:700", [p.title])), dropT(fitT(E("div", "", WRAP + "font-size:23px;line-height:1.2;color:rgba(255,255,255,.86);margin-top:2px", [p.why])), 3)]);
      var card = E("div", "", "position:relative;overflow:hidden;flex:none;border-radius:24px;background:#2a2a30 center/cover;width:" + px(pw) + ";" + (i ? "margin-left:" + gap + "px;" : "") + (p.art ? "background-image:" + cssImg(p.art) : ""), [cap]);
      return stop(dropT(card, i ? 2 : 1), "pick", i, p.title);
    }))]);
    // OK on the widget as a whole (the remote arrived before the posters were there) opens every pick
    stop(root, "detail", "picks", "Picks for you");
  };

  // apps
  function noApps(root, b, named) { return empty(root, b, "apps", named ? "These apps are not on this TV" : "No apps yet", named ? "Install them, or pick others in couch-tv Studio" : ""); }
  function appGrid(list, b, cols, env, top) {
    var rows = Math.ceil(list.length / cols), gap = clamp(Math.min(b.w, b.h) / 18, 14, 28);
    var a = Math.floor(Math.min((b.w - (cols - 1) * gap) / cols, (b.h - top - (rows - 1) * gap) / rows));
    var g = E("div", "cw-grow", "display:flex;flex-wrap:wrap;align-content:center;justify-content:center;margin:" + px(-gap / 2), list.map(function (p) { var n = appNode(p, a, env); n.style.margin = px(gap / 2); return n; }));
    return g;
  }
  R.app = function (root, o, b, env) {
    var list = appsFor(o, env, 1);
    if (!list.length && canAdd(env)) list = ["add:"];
    if (!list.length) return noApps(root, b, (op(o).apps || []).length);
    var n = appNode(list[0], Math.min(b.w, b.h), env), act = n.getAttribute("data-act"), arg = n.getAttribute("data-arg");
    n.style.borderRadius = px(Math.min(b.w, b.h) * 0.22);
    n.removeAttribute("data-act");
    add(root, n);
    stop(root, act, arg === null ? undefined : arg, n.getAttribute("data-name"));
    root.setAttribute("data-slot", "0");
  };
  R.folder = function (root, o, b, env) {
    var q = op(o), list = appsFor(o, env, 12);
    if (canAdd(env) && list.length < 12 && !(b.w < 300 && b.h < 300)) list.push("add:");
    if (!list.length) return noApps(root, b, (q.apps || []).length);
    var label = q.label ? E("div", "cw-lab", "margin-bottom:12px", [q.label]) : null;
    if (b.w < 300 && b.h < 300) {
      // a Tile: four tiny icons, OK opens the folder full screen (like iOS)
      var mini = list.slice(0, 4), s = Math.floor((Math.min(b.w, b.h) - 48 - 12) / 2);
      add(root, E("div", "cw-grow", "display:flex;flex-wrap:wrap;align-content:center;justify-content:center", mini.map(function (p) { var n = appNode(p, s, env); n.removeAttribute("data-act"); n.style.margin = "3px"; n.classList.add("cw-mini"); return n; })));
      stop(root, "detail", "folder", q.label || "Apps");
      return;
    }
    var cols = q.cols || clamp(Math.round(Math.sqrt(list.length * b.w / b.h)), 1, 6);
    add(root, [label, appGrid(list, b.w > 0 ? { w: b.w - 48, h: b.h - 48 } : b, cols, env, label ? 50 : 0)]);
    root.setAttribute("data-detail", "folder");
  };
  R.dock = function (root, o, b, env) {
    var q = op(o), list = appsFor(o, env, 12);
    if (!list.length && !canAdd(env)) return noApps(root, b, (q.apps || []).length);
    var a = Math.min(112, b.h - 40), gap = 30, cap = Math.max(1, Math.floor((b.w - 40 + gap) / (a + gap))), more = q.more !== false;
    var shown = list.slice(0, Math.max(1, cap - (more ? 1 : 0)));
    if (canAdd(env) && list.length < 12 && shown.length < cap - (more ? 1 : 0)) shown.push("add:");
    root.style.padding = "20px";
    var row = E("div", "cw-row cw-center", "height:100%", shown.map(function (p, i) { var n = appNode(p, a, env); if (i) n.style.marginLeft = px(gap); return n; }));
    if (more) row.appendChild(stop(E("div", "cw-app cw-more", "width:" + px(a) + ";height:" + px(a) + ";border-radius:" + px(a * 0.24) + ";margin-left:" + px(gap), [ic("more", a * 0.4, "#fff")]), "more", "", "All apps"));
    add(root, row);
  };
  R.appgrid = function (root, o, b, env) {
    // a small grid holds four apps without names (Hold OK, then All apps, has the rest)
    var small = b.w < 500 && b.h < 500, q = op(o), list = appsFor(o, env, small ? 4 : 16);
    if (canAdd(env) && list.length < (small ? 4 : 16)) list.push("add:");
    if (!list.length) return noApps(root, b, (q.apps || []).length);
    var cols = small ? 2 : q.cols || clamp(Math.round(Math.sqrt(list.length * b.w / b.h)), 1, 8), rows = Math.ceil(list.length / cols), names = !small && q.names !== false;
    var gx = 40, gy = 40, nameH = names ? 52 : 0, a = Math.floor(Math.min((b.w - cols * gx) / cols, (b.h - rows * gy - rows * nameH) / rows));
    add(root, E("div", "", "display:flex;flex-wrap:wrap;justify-content:center;align-content:center;height:100%", list.map(function (p, i) {
      var n = appNode(p, a, env);
      return E("div", "cw-col", "align-items:center;width:" + px(a) + ";margin:" + px(gy / 2) + " " + px(gx / 2), [n, names ? E("span", "cw-t25 cw-ell", "color:var(--ink);margin-top:12px;max-width:" + px(a + 30) + ";text-align:center;font-weight:650" + (root.classList.contains("cw-bare") ? ";text-shadow:0 2px 10px rgba(0,0,0,.3)" : ""), [p === "add:" ? "Add app" : appName(String(p).replace(/^missing:/, ""), env)]) : null]);
    })));
  };
  var GAMES = { "com.microsoft.xcloud": ["#107c10", "#0b4f0b", "Xbox Cloud", "cloud", "Last played: Forza"], "com.nvidia.geforcenow": ["#76b900", "#3f6400", "GeForce NOW", "bolt", "Fortnite, 2h ago"],
    "com.valvesoftware.steamlink": ["#2a475e", "#13202c", "Steam Link", "tv", "From the study PC"], "com.retroarch": ["#e60012", "#7a0009", "RetroArch", "games", "Mario Kart 64"] };
  R.games = function (root, o, b, env) {
    var list = appsFor(o, env, 4);
    if (!list.length) return noApps(root, b, (op(o).apps || []).length);
    var n = clamp(Math.floor(b.w / 240), 2, list.length);
    add(root, [lab("games", op(o).label || "Play"), E("div", "cw-row cw-grow", "margin-top:16px;align-items:stretch", list.slice(0, n).map(function (p, i) {
      var miss = String(p).indexOf("missing:") === 0, key = miss ? p.slice(8) : p, gp = GAMES[key] || (cat() && cat().get(key) ? GAMES[cat().get(key).packages.android[0]] : null), g = gp || ["#3a3a46", "#1d1d24", appName(key, env), "games"];
      var t = E("div", "cw-col", "flex:1;position:relative;overflow:hidden;border-radius:28px;background:linear-gradient(165deg," + g[0] + "," + g[1] + ");padding:24px;justify-content:space-between;" + (i ? "margin-left:20px" : ""), [
        ic(g[3], clamp(b.h / 5, 56, 96), "#fff", "solid"), E("div", "", "min-width:0", [E("div", "cw-t29 cw-ell", "color:#fff;font-weight:740", [g[2]]), env.demo && g[4] && b.h >= 400 ? E("div", "cw-t23 cw-ell", "color:rgba(255,255,255,.86)", [g[4]]) : null])]);
      if (miss) { t.style.opacity = "0.42"; t.appendChild(E("div", "cw-t23", "color:#fff", ["Not on this TV"])); } return stop(t, miss ? "missing" : "app", key, g[2]);
    }))]);
  };

  // music
  R.nowplaying = function (root, o, b, env) {
    var m = music(env);
    if (!m) return dataOf(env).bridge === false ? soon(root, b, "music", "nowplaying") : empty(root, b, "music", "Nothing playing", "Songs playing on this TV show up here");
    if (b.w < 300 && b.h < 300) {
      // a tile: the cover, with play or pause on it; OK opens the player
      root.classList.add("cw-photo");
      add(root, [E("div", "cw-fill", "background:#333 center/cover;" + (m.art ? "background-image:" + cssImg(m.art) : "")), E("div", "cw-fill", "background:linear-gradient(180deg,transparent 40%,rgba(0,0,0,.7))"),
        E("div", "cw-row", "position:absolute;left:16px;right:16px;bottom:14px;color:#fff", [ic(m.state === "playing" ? "pause" : "play", 30, "#fff", "solid"), E("span", "cw-t23 cw-ell", "color:#fff;font-weight:700;margin-left:8px", [m.title])])]);
      stop(root, "detail", "player", m.title);
      return;
    }
    var wide = b.w > b.h * 1.4, s = wide ? b.h - 48 : Math.min(b.w - 48, b.h * 0.55), big = b.w > 900;
    var art = E("div", "", "width:" + px(s) + ";height:" + px(s) + ";border-radius:24px;background:#333 center/cover;flex:none;box-shadow:0 14px 40px rgba(0,0,0,.35);" + (m.art ? "background-image:" + cssImg(m.art) : ""));
    var btn = function (name, sz) { return E("div", "", "padding:10px;border-radius:50%;display:flex", [ic(name, sz, "currentColor", "solid")]); };
    var pct = m.dur ? clamp(m.pos / m.dur, 0, 1) : 0.38;
    var info = E("div", "cw-col", "min-width:0;" + (wide ? "flex:0 1 auto;margin-left:30px;width:" + px(Math.min(b.w - 48 - s - 30, Math.max(260, (b.w - 48 - s - 30) * 0.6))) : "flex:1"), [
      E("div", "cw-lab", "", [m.app ? appIcon(m.app, 34, env) : ic("music", 30), m.source || "Now playing"]),
      E("div", "cw-ell", "margin-top:10px;font-size:" + px(big ? 64 : 38) + ";font-weight:760;letter-spacing:-.02em;line-height:1.1", [m.title]),
      E("div", "cw-ell cw-dim", "font-size:" + px(big ? 38 : 29) + ";font-weight:560", [m.artist]), E("div", "cw-grow"),
      b.h >= 420 && env.demo ? E("div", "cw-row", "margin-top:18px", ["Living", "Kitchen"].map(function (r2, i) { return E("div", "cw-chip", "height:48px;font-size:23px;" + (i ? "margin-left:12px" : ""), [ic("speaker", 26), r2]); })) : null,
      b.h >= 240 ? E("div", "cw-bar", "margin-top:14px", [E("b", "", "width:" + Math.round(pct * 100) + "%")]) : null,
      b.h >= 300 && m.dur ? E("div", "cw-row cw-sp cw-t23", "margin-top:8px", [E("span", "", "", [Math.floor(m.pos / 60) + ":" + ("0" + Math.floor(m.pos % 60)).slice(-2)]), E("span", "", "", ["-" + Math.floor((m.dur - m.pos) / 60) + ":" + ("0" + Math.floor((m.dur - m.pos) % 60)).slice(-2)])]) : null,
      b.h >= 300 ? E("div", "cw-row", "justify-content:center;margin-top:10px", [btn("previous", 40, "prev"), E("div", "", "width:40px"), btn(m.state === "playing" ? "pause" : "play", 52, "play"), E("div", "", "width:40px"), btn("next", 40, "next")]) : null]);
    // the cover and its words as one group in the middle (the design's align does not apply here)
    if (wide) add(root, E("div", "cw-row", "height:100%;align-items:stretch;justify-content:center", [art, info]));
    else { art.style.alignSelf = "center"; add(root, [art, E("div", "cw-t29 cw-ell", "margin-top:16px;font-weight:680", [m.title]), E("div", "cw-t25 cw-ell", "", [m.artist]), E("div", "cw-grow"), E("div", "cw-bar", "", [E("b", "", "width:" + Math.round(pct * 100) + "%")])]); }
    // OK opens the player (widget-detail.js), which has every control
    stop(root, "detail", "player", m.title);
  };
  R.soundscape = function (root, o, b) {
    var snd = op(o).sound || "rain", names = { rain: "Rain", fire: "Fire", waves: "Waves", brown: "Brown noise" }, icons = { rain: "rain", fire: "bolt", waves: "wind", brown: "speaker" };
    add(root, [ic(icons[snd], b.h < 200 ? 44 : 56, "currentColor"), E("div", "cw-grow"), E("div", b.w < 300 ? "cw-t25" : "cw-t29", "font-weight:680;color:var(--ink)", [names[snd]]), b.w >= 300 ? E("div", "cw-t23", "", ["Soundscape"]) : null]);
    stop(root, "quick", "soundscape", "Soundscape");
  };
  // ---------------- fitting words (group C widgets) ----------------
  // seagey, 18 Nov 2026: "Make sure each widget fits in each container correctly things aren't cut off
  // and all icons etc are default centre align unless it's changed in the designer." So these widgets
  // never cut words with an ellipsis: each line is measured and drawn at the largest size from its own
  // size down to 23 px that fits on the lines it has; what still cannot fit is left out whole. Content
  // is centred unless the design sets opts.align (left or right).
  var MEASURE = null, MCACHE = {}, MCOUNT = 0;
  function measureBox() {
    if (!MEASURE) {
      MEASURE = document.createElement("div");
      MEASURE.setAttribute("aria-hidden", "true");
      MEASURE.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;white-space:normal;overflow-wrap:normal;word-break:normal;padding:0;margin:0;border:0;font-feature-settings:'tnum' 1";
    }
    if (!MEASURE.parentNode && document.body) document.body.appendChild(MEASURE);
    return MEASURE;
  }
  // the largest size, max down to 23 px, at which `text` fits `width` on at most `lines` lines; 0 if none
  function fitPxText(text, width, max, lines, weight, family, spacing) {
    text = String(text == null ? "" : text);
    if (!text) return max;
    var key = [text, Math.floor(width), max, lines, weight, family, spacing].join("|");
    if (MCACHE[key] !== undefined) return MCACHE[key];
    if (++MCOUNT > 3000) { MCACHE = {}; MCOUNT = 0; }
    var m = measureBox(), got = 0, lh = 1.2;
    m.style.width = Math.max(1, Math.floor(width)) + "px"; m.style.fontWeight = weight || 600; m.style.fontFamily = family || '"Inter", sans-serif';
    m.style.letterSpacing = spacing || "normal"; m.style.lineHeight = String(lh); m.textContent = text;
    for (var px = Math.round(max); px >= 23; px -= px > 40 ? 3 : 1) {
      m.style.fontSize = px + "px";
      if (m.scrollWidth <= Math.floor(width) && m.scrollHeight <= Math.ceil(px * lh * lines) + 1) { got = px; break; }
    }
    MCACHE[key] = got;
    return got;
  }
  function famOf(root) { return root.style.fontFamily || '"Inter", sans-serif'; }
  function alignOf(o) { var a = op(o).align; return a === "left" || a === "right" ? a : "center"; }
  function alignRoot(root, al) { root.style.alignItems = al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center"; root.style.textAlign = al; }
  function justify(al) { return "justify-content:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center"); }
  // words that fit, whole, or null (the caller leaves them out)
  function fitWords(root, text, width, max, lines, weight, css) {
    if (text == null || text === "") return null;
    var px = fitPxText(text, width, max, lines || 1, weight || 600, famOf(root));
    if (!px) return null;
    return E("div", "cw-fit", "font-size:" + px + "px;font-weight:" + (weight || 600) + ";line-height:1.2;max-width:" + Math.floor(width) + "px;overflow-wrap:normal;flex:none;" + (css || ""), [String(text)]);
  }
  // a big number on one line, as big as fits
  function fitNum(root, text, width, max, css) {
    var px = fitPxText(text, width, max, 1, 640, famOf(root), "-0.035em") || 23;
    return E("div", "cw-big", "white-space:nowrap;flex:none;font-size:" + px + "px;" + (css || ""), [String(text)]);
  }
  // a label: icon and name; the name on one line, else two, else the icon alone
  function fitLab(root, iconName, text, width, max) {
    var t = fitWords(root, text, width - 40, max || 25, 1, 650, "color:var(--sub)") || fitWords(root, text, width - 40, 24, 2, 650, "color:var(--sub)");
    return E("div", "cw-row", "flex:none;max-width:100%;color:var(--sub)", [iconName ? ic(iconName, 30, "currentColor") : null, t ? E("div", "", "margin-left:10px;min-width:0", [t]) : null]);
  }
  // the setup card from widget-caps.js; in a box too small for its line, the short "Set up first" (OK opens all of it)
  function soonFit(root, b, iconName, kind) {
    // a picture widget (camera) with no picture: the card gets the glass box, so it never floats
    if (root.classList.contains("cw-photo")) { root.classList.remove("cw-photo"); root.classList.add("cw-glass"); if (!(root.firstChild && root.firstChild.className === "cw-bg")) root.insertBefore(E("div", "cw-bg"), root.firstChild); }
    soon(root, b, iconName, kind);
    var e1 = root.querySelector(".cw-e1"), tiny = b.w < 300 && b.h < 300, strip = b.h < 200 && b.w >= 300;
    var room = strip ? b.w - 48 - 58 : b.w - 48, lines = strip ? 2 : tiny ? 2 : 3;
    if (e1 && !fitPxText(e1.textContent, room, tiny ? 24 : 29, lines, 680, famOf(root))) e1.textContent = "Set up first";
    var e2 = root.querySelector(".cw-e2");
    if (e2 && !fitPxText(e2.textContent, room, 24, 3, 560, famOf(root))) e2.parentNode.removeChild(e2);
    return root;
  }
  function haWait(root, b, o, iconName, title, line) {
    alignRoot(root, alignOf(o));
    add(root, [fitLab(root, iconName, title, b.w - 48), E("div", "cw-grow"), fitWords(root, line, b.w - 48, 25, 3, 560, "color:var(--sub)") || fitWords(root, "Checking", b.w - 48, 25, 1, 560)]);
  }

  // Up next queue: the next songs on the Spotify account, read by the home computer (the bridge's
  // /api/music/queue) or the standalone home's own site (api/now?queue=1), from the person's own
  // Spotify sign in. Other music apps do not share their queue with anything, so it is Spotify only.
  //   queue undefined: not asked yet; { ok: false }: Spotify is not connected; { ok: true, items }
  var DEMO_QUEUE = [["Sunday Best", "Surfaces", "surf"], ["Riptide", "Vance Joy", "hike"], ["Electric Feel", "MGMT", "camp"], ["Dreams", "Fleetwood Mac", "beach"],
    ["Bloom", "The Paper Kites", "dog"], ["Holocene", "Bon Iver", "nan"], ["Sunsets", "Thelma Plum", "art"], ["Old Pine", "Ben Howard", "birthday"]];
  function queueOf(env) {
    if (env.demo) return { ok: true, items: DEMO_QUEUE.map(function (s) { return { title: s[0], artist: s[1], art: demoImg(s[2]) }; }) };
    var q = dataOf(env).queue;
    if (q === undefined && window.CouchQueueNow) q = window.CouchQueueNow();
    return q && typeof q === "object" ? q : undefined;
  }
  // a cover: only a picture from Spotify's own picture host (or the designer's demo pictures)
  function coverOk(u, env) { return typeof u === "string" && (/^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(u) || (env.demo && /^[a-z0-9\/._-]+\.jpg$/.test(u))); }
  R.queue = function (root, o, b, env) {
    var q = queueOf(env), d = dataOf(env), al = alignOf(o), W = b.w - 48;
    if (!env.demo && ((d.bridge === false && !window.COUCH_STANDALONE) || (q && q.ok === false))) return soonFit(root, b, "music", "queue");
    var title = op(o).label || "Up next";
    if (!q) return haWait(root, b, o, "music", title, "Checking Spotify");
    var items = (q.items || []).filter(function (s) { return s && s.title; });
    if (!items.length) return haWait(root, b, o, "music", title, "Nothing up next in Spotify");
    alignRoot(root, al);
    var big = b.w >= 700, cs = big ? 96 : 76, gap = big ? 24 : 18, textW = W - cs - 20, left = b.h - 48 - 46, rows = [];
    for (var i = 0; i < Math.min(10, items.length); i++) {
      var s = items[i], name = String(s.title).slice(0, 120), tl = 1, tpx = fitPxText(name, textW, big ? 38 : 29, 1, 650, famOf(root));
      if (!tpx) { tl = 2; tpx = fitPxText(name, textW, 25, 2, 650, famOf(root)); }
      if (!tpx) continue;   // a title too long for this box is left out, never cut
      var t = E("div", "cw-fit", "font-size:" + tpx + "px;font-weight:650;line-height:1.2;overflow-wrap:normal;max-width:" + Math.floor(textW) + "px", [name]);
      var a = s.artist ? fitWords(root, String(s.artist).slice(0, 120), textW, 25, 1, 560, "color:var(--sub)") : null;
      var h = Math.max(cs, Math.ceil(tpx * 1.2 * tl) + (a ? Math.ceil(parseFloat(a.style.fontSize) * 1.2) : 0));
      if (h + (rows.length ? gap : 0) > left) break;
      left -= h + (rows.length ? gap : 0);
      var ok = coverOk(s.art, env), cover = E("div", "", "width:" + px(cs) + ";height:" + px(cs) + ";border-radius:14px;flex:none;margin-right:20px;display:flex;align-items:center;justify-content:center;background:#333 center/cover;" + (ok ? "background-image:" + cssImg(s.art) : ""), ok ? null : [ic("music", cs * 0.42, "rgba(255,255,255,.6)")]);
      rows.push(E("div", "cw-row", "flex:none;max-width:100%;text-align:left;" + (rows.length ? "margin-top:" + gap + "px" : ""), [cover, E("div", "", "min-width:0", [t, a])]));
    }
    // the label and the songs as one group in the middle of the box
    root.style.justifyContent = "center";
    add(root, [fitLab(root, "music", title, W), E("div", "cw-col", "flex:0 1 auto;width:100%;margin-top:16px;justify-content:center;min-height:0;align-items:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center"),
      // the songs as one block, each row from its left edge, the block centred (or where the design says)
      [E("div", "cw-col", "flex:none;max-width:100%;align-items:flex-start", rows)])]);
    stop(root, "detail", "queue", title);
  };

  // Speakers: each Home Assistant speaker (media_player.* named in config.json) and its volume
  function speakersOf(env, o) {
    var ha = haOf(env), want = op(o).players;
    if (!ha.speakers) return ha.speakers;
    var l = ha.speakers.filter(function (s) { return s && s.entity; });
    if (want && want.length) l = want.map(function (e) { return l.filter(function (s) { return s.entity === e; })[0]; }).filter(Boolean);
    return l;
  }
  function spkWord(s) { return s.ok === false ? "Not answering" : s.state === "off" || s.state === "standby" ? "Off" : s.muted ? "Muted" : s.volume != null ? s.volume + "%" : s.state === "playing" ? "Playing" : "On"; }
  function spkSong(s) { return s.ok === false ? "" : s.title ? s.title + (s.artist ? ", " + s.artist : "") : s.state === "playing" ? "Playing" : s.state === "paused" ? "Paused" : s.state === "off" ? "" : "Not playing"; }
  R.speakers = function (root, o, b, env) {
    var ha = haOf(env), info = ha.info || {}, al = alignOf(o), W = b.w - 48;
    if (!env.demo && !(info.speakers && info.speakers.length)) return soonFit(root, b, "speakers", "speakers");
    var list = speakersOf(env, o), title = op(o).label || "Speakers";
    if (!list) return haWait(root, b, o, "speakers", title, "Checking Home Assistant");
    if (!list.length) return haWait(root, b, o, "speakers", title, "No speaker is answering");
    alignRoot(root, al);
    var bar = function (s) { return E("div", "cw-bar", "width:100%;margin-top:10px;height:12px;border-radius:6px", [E("b", "", "width:" + (s.ok === false || s.state === "off" ? 0 : clamp(s.volume || 0, 0, 100)) + "%")]); };
    var head = function (s, big) {
      var word = spkWord(s), wpx = fitPxText(word, W, big ? 29 : 25, 1, 650, famOf(root)) || 23, ww = word.length * wpx * 0.62 + 12;
      var name = fitWords(root, s.name || "", W - ww, big ? 29 : 25, 1, 650) || fitWords(root, s.name || "", W - ww, 23, 2, 650);
      var pct = fitWords(root, word, ww, wpx, 1, 650, "margin-left:10px");
      if (name || !s.name) return E("div", "cw-row", "flex:none;width:100%;justify-content:space-between;align-items:flex-start", [name || E("div"), pct]);
      // a long name: on its own lines above, the volume under it
      return E("div", "cw-col", "flex:none;width:100%;align-items:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center"), [fitWords(root, s.name, W, 25, 2, 650), pct]);
    };
    if (b.h < 200) {
      // a wide tile: the one playing (else the first), its volume and what it plays
      var p = list.filter(function (s) { return s.state === "playing"; })[0] || list[0], song = spkSong(p);
      add(root, [head(p, false), E("div", "cw-grow"), song ? fitWords(root, song, W, 24, 1, 560, "color:var(--sub)") : null, bar(p)]);
    } else {
      var rowH = b.h >= 520 ? 120 : 100, n = Math.max(1, Math.min(list.length, Math.floor((b.h - 90) / rowH)));
      add(root, [fitLab(root, "speakers", title, W), E("div", "cw-col cw-grow", "width:100%;justify-content:space-between;margin-top:18px;min-height:0", list.slice(0, n).map(function (s) {
        var song = rowH >= 120 ? spkSong(s) : "";
        return E("div", "", "flex:none;width:100%", [head(s, true), song ? fitWords(root, song, W, 24, 1, 560, "color:var(--sub)") : null, bar(s)]);
      }))]);
    }
    stop(root, "detail", "speakers", title);
  };

  // smart home
  function noHa(root, b, iconName, kind) { return soon(root, b, iconName || "home", kind || "aircon"); }
  function dial(s, set, cur) {
    var frac = clamp((set - 16) / 14, 0, 1);
    return E("div", "", "position:relative;width:" + px(s) + ";height:" + px(s) + ";flex:none", [svg("0 0 100 100", s, s, [
      S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "rgba(255,255,255,.16)", "stroke-width": 8, "stroke-dasharray": "198 66", "stroke-linecap": "round", transform: "rotate(135 50 50)" }),
      S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "#64d2ff", "stroke-width": 8, "stroke-dasharray": Math.round(198 * frac) + " 300", "stroke-linecap": "round", transform: "rotate(135 50 50)" })]),
      E("div", "", "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center", [E("div", "", "", [E("div", "cw-big", "font-size:" + px(s * 0.3), [Math.round(set) + "°"]), cur !== null && cur !== undefined ? E("div", "cw-t23", "", ["Now " + cur + "°"]) : null])])]);
  }
  // the rooms in Home Assistant's shape (HomeAssistant.kt room()): the demo uses the same shape
  var DEMO_ROOMS = [
    { entity: "climate.living", name: "Living", ok: true, state: "cool", action: "cooling", target: 22, current: 24.5, min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan: "auto" },
    { entity: "climate.media", name: "Media", ok: true, state: "cool", action: "idle", target: 23, current: 23.5, min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan: "low" },
    { entity: "climate.main_bed", name: "Main bed", ok: true, state: "cool", action: "cooling", target: 21, current: 22, min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan: "medium" },
    { entity: "climate.bed_2", name: "Bed 2", ok: true, state: "off", action: "off", target: 22, current: 25, min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan: "auto" }];
  var MODE_WORD = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Heat and cool", auto: "Auto", dry: "Dry", fan_only: "Fan" };
  var MODE_COL = { heat: "#ff9f0a", cool: "#64d2ff", heat_cool: "#bf5af2", auto: "#30d158", dry: "#ffd60a", fan_only: "#e5e5ea" };
  function roomsOf(env) { return env.demo ? DEMO_ROOMS : (env.rooms || []); }
  function roomOn(r) { return r.ok !== false && r.state !== "off"; }
  function roomMode(r) { return r.ok === false ? "Not answering" : MODE_WORD[r.state] || (r.state ? String(r.state) : "On"); }
  function tdeg(v) { return v == null || !isFinite(v) ? "--" : (Math.round(v * 10) / 10) + "°"; }
  R.aircon = function (root, o, b, env) {
    var rooms = roomsOf(env);
    if (!rooms.length) return noHa(root, b, "aircon", "aircon");
    var ent = op(o).entity, r = rooms.filter(function (x) { return ent && x.entity === ent; })[0] || rooms[0];
    var on = roomOn(r), col = on ? MODE_COL[r.state] || "#64d2ff" : "rgba(255,255,255,.35)";
    var dot = E("i", "", "display:block;width:18px;height:18px;border-radius:9px;flex:none;background:" + col + ";box-shadow:0 0 0 4px rgba(255,255,255,.12)");
    if (b.w < 300 && b.h < 300) {
      // a tile: the room, its temperature now, and whether it is on
      add(root, [E("div", "cw-row cw-sp", "", [E("div", "cw-t23 cw-ell", "font-weight:700;color:var(--ink);min-width:0", [r.name || "Aircon"]), dot]), E("div", "cw-grow"),
        E("div", "cw-big", "font-size:" + px(clamp(b.w * 0.36, 44, 64)), [r.current != null ? Math.round(r.current) + "°" : tdeg(r.target)]), E("div", "cw-t23 cw-ell", "", [on ? roomMode(r) + " " + tdeg(r.target) : "Off"])]);
    } else if (b.h < 200) {
      // a wide tile: the room and its mode beside the set temperature
      add(root, E("div", "cw-row", "height:100%", [E("div", "cw-col", "flex:1;min-width:0", [lab("aircon", r.name || "Aircon"), E("div", "cw-row", "margin-top:8px", [dot, E("span", "cw-t25 cw-ell", "margin-left:12px;color:var(--ink);font-weight:650", [on ? roomMode(r) : "Off"])]),
        E("div", "cw-t23 cw-ell", "margin-top:2px", ["Now " + tdeg(r.current)])]),
        E("div", "cw-big", "font-size:84px;margin-left:16px;opacity:" + (on ? 1 : 0.55), [tdeg(r.target)])]));
    } else {
      // the room, its mode and the dial as one group in the middle (a tall box: not the dial alone)
      var wideA = b.w > b.h * 1.3, s = Math.min(b.h - 130, wideA ? b.w * 0.5 : b.w - 48), others = rooms.filter(function (x) { return x !== r; }).slice(0, 4);
      if (!wideA) root.style.justifyContent = "center";
      add(root, [E("div", "cw-row cw-sp", "", [lab("aircon", r.name || "Aircon"), E("div", "cw-chip on", "height:44px;font-size:23px;background:" + col + ";color:#1a1406", [on ? roomMode(r) : "Off"])]),
        E("div", (wideA ? "cw-grow " : "") + "cw-row cw-center", wideA ? "" : "margin-top:20px", [dial(s, r.target != null ? r.target : 22, r.current != null ? Math.round(r.current * 10) / 10 : null), wideA && b.w >= 700 ? E("div", "cw-col", "margin-left:30px", others.map(function (z) {
          var zo = roomOn(z);
          return E("div", "cw-chip" + (zo ? " on" : ""), "margin:7px 0;" + (zo ? "background:" + (MODE_COL[z.state] || "#64d2ff") : ""), [z.name + (zo ? " " + tdeg(z.target) : " off")]);
        })) : null])]);
    }
    stop(root, "detail", "aircon", r.name || "Aircon");
  };
  var SCENE_DEMO = [["movie", "Movie night", "scene.movie_night"], ["bedtime", "Goodnight", "scene.goodnight"], ["morning", "Morning", "script.morning"], ["away", "Away", "scene.away"], ["party", "Party", "scene.party"], ["dinner", "Dinner", "scene.dinner"]];
  function scenesOf(env) {
    if (env.demo) return SCENE_DEMO;
    return (dataOf(env).scenes || []).map(function (s) { return [/^script\./.test(s.entity || "") ? "play" : "favourite", String(s.name || s.entity || ""), String(s.entity || "")]; }).filter(function (s) { return s[2]; });
  }
  R.scenes = function (root, o, b, env) {
    var list = scenesOf(env);
    if (!list.length) return noHa(root, b, "favourite", "scenes");
    if (b.w < 300 && b.h < 300) {
      // a tile: OK opens every scene
      add(root, [ic("favourite", 44, "currentColor", "solid"), E("div", "cw-grow"), E("div", "cw-t25", "font-weight:700;color:var(--ink)", [op(o).label || "Scenes"]), E("div", "cw-t23", "", [list.length + (list.length === 1 ? " scene" : " scenes")])]);
      stop(root, "detail", "scenes", op(o).label || "Scenes");
      return;
    }
    var strip = b.h < 200, cols = strip ? Math.max(1, Math.min(list.length, Math.floor((b.w - 28) / 160))) : b.w > 500 ? 3 : 2, rows = strip ? 1 : Math.max(1, Math.floor((b.h - 70) / 150)), n = Math.min(list.length, cols * rows);
    var mw = (b.w - 48 - 20 * (cols - 1)) / cols, mh = strip ? b.h - 48 : (b.h - 48 - 60 - 20 * (rows - 1)) / rows;
    add(root, [strip ? null : lab("favourite", op(o).label || "Scenes"), E("div", "cw-mods", strip ? "" : "margin-top:8px", list.slice(0, n).map(function (x) {
      var m = E("div", "cw-mod", "width:" + px(mw) + ";height:" + px(mh) + ";padding:" + (strip ? "12px 16px" : "16px 20px"), [E("div", "cw-ic", strip ? "width:46px;height:46px" : "", [ic(x[0], strip ? 26 : 32, "#fff", "solid")]), E("div", "cw-t25 cw-ell", "font-weight:700;color:inherit", [x[1]])]);
      return stop(m, "scene", x[2], x[1]);
    }))]);
    root.setAttribute("data-detail", "scenes");
  };
  // ---------------- Control Centre, camera, doorbell, energy, sensor (and Speakers above) ----------------
  // What Home Assistant said, through the launcher (smarthome.js live(), HomeAssistant.kt): only the
  // entities named in config.json. In the designer, the demo below in the same shape. On a TV with none
  // of it set up, the widget's setup card; set up but not read yet, or not answering, it says so in its
  // own box. A design only ever names entities (opts.switches, cam, reading, players), never a reading.
  var TODAY = new Date();
  var DEMO_HA = {
    info: { controls: [1], cameras: [{ entity: "camera.backyard", name: "Backyard" }], sensors: [{ entity: "sensor.pool", name: "Pool" }], speakers: [1], energy: true, doorbell: true, doorbell_camera: true },
    controls: [{ entity: "light.lounge", name: "Lounge", ok: true, kind: "light", on: true, level: 80 }, { entity: "light.lamp", name: "Lamp", ok: true, kind: "light", on: false },
      { entity: "light.kitchen", name: "Kitchen", ok: true, kind: "light", on: true }, { entity: "cover.blinds", name: "Blinds", ok: true, kind: "cover", on: false, state: "closed" },
      { entity: "fan.ceiling", name: "Ceiling fan", ok: true, kind: "fan", on: true, level: 33 }, { entity: "switch.heater", name: "Heater", ok: true, kind: "switch", on: false },
      { entity: "switch.fairy_lights", name: "Fairy lights", ok: true, kind: "switch", on: true }, { entity: "light.porch", name: "Porch", ok: true, kind: "light", on: false }],
    sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, value: "26.4", num: 26.4, unit: "°C", cls: "temperature" }],
    hist: { "sensor.pool": { points: [24.1, 24, 23.9, 23.8, 23.7, 23.6, 23.6, 23.7, 24, 24.4, 24.9, 25.4, 25.9, 26.3, 26.6, 26.8, 26.8, 26.7, 26.6, 26.5, 26.5, 26.4, 26.4, 26.4] } },
    energy: { ok: true, name: "Solar", total: 18.4, battery: 86, power: 2.4, power_unit: "kW", hours: [0, 0, 0, 0, 0, 0, 0.2, 0.7, 1.4, 2.1, 2.6, 2.9, 3, 2.6, 1.9, 0.8, 0.2, null, null, null, null, null, null, null] },
    speakers: [{ entity: "media_player.living", name: "Living", ok: true, state: "playing", volume: 42, title: "Low Tide", artist: "Saltwater Radio", can_volume: true, can_pause: true },
      { entity: "media_player.kitchen", name: "Kitchen", ok: true, state: "idle", volume: 30, can_volume: true, can_pause: true }, { entity: "media_player.deck", name: "Deck", ok: true, state: "off" }],
    bell: { ok: true, name: "Front door", at: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 14, 14).getTime(), ringing: false, camera: true, kept: true },
    stills: {}
  };
  function haOf(env) {
    if (env.demo) return DEMO_HA;
    var d = dataOf(env).ha;
    if (d && typeof d === "object") return d;
    var sh = window.smartHome;
    return (sh && sh.live && sh.live()) || {};
  }
  var NOT_ANSWERING = "Home Assistant is not answering";

  // Control Centre: lights, switches, fans and blinds
  function ctlIcon(c) { return c.kind === "cover" ? (c.blocked ? "garage" : "blinds") : c.kind === "fan" ? "fan" : c.kind === "switch" ? "outlet" : c.on ? "light" : "light-off"; }
  function ctlWord(c) {
    if (c.ok === false) return "Not answering";
    if (c.kind === "cover") return c.on ? "Open" + (c.level != null && c.level < 100 ? " " + c.level + "%" : "") : "Closed";
    return c.on ? "On" + (c.level != null && c.level < 100 ? " " + c.level + "%" : "") : "Off";
  }
  function controlsOf(env, o) {
    var ha = haOf(env), q = op(o);
    if (env.demo && q.controls && q.controls.length) {
      // the designer: the design's own icons and names over the demo readings
      return q.controls.map(function (c, i) { var d = DEMO_HA.controls[i % DEMO_HA.controls.length]; return { entity: "demo." + i, name: c.name || d.name, ok: true, kind: d.kind, on: i % 2 === 0, icon: c.icon }; });
    }
    if (!ha.controls) return ha.controls;
    var l = ha.controls.filter(function (c) { return c && c.entity; });
    if (q.switches && q.switches.length) l = q.switches.map(function (e) { return l.filter(function (c) { return c.entity === e; })[0]; }).filter(Boolean);
    return l;
  }
  // one switch in its own box: icon over name over state in a tall box, icon beside them in a short one;
  // each line fitted, the name left out whole (never cut) if it cannot fit
  function ctlMod(root, c, mw, mh, al) {
    var on = c.ok !== false && c.on, tall = mh >= 170, pad = tall ? 18 : 14, iconS = tall ? 58 : 46, inner = tall ? mw - 2 * pad : mw - 2 * pad - iconS - 14;
    var room = tall ? mh - 2 * pad - iconS - 8 : mh - 2 * pad;
    var st = fitWords(root, ctlWord(c), inner, 24, 1, 560, "color:var(--sub)");
    if (st && room - 30 >= 29) room -= 30; else st = null;
    var name = room >= 29 ? fitWords(root, c.name || "", inner, tall ? 27 : 25, Math.max(1, Math.min(2, Math.floor(room / 30))), 680, "color:inherit") : null;
    if (!name && st && !tall) { st = null; name = fitWords(root, c.name || "", inner, 25, Math.min(2, Math.floor((mh - 2 * pad) / 30)), 680, "color:inherit"); if (!name) st = fitWords(root, ctlWord(c), inner, 24, 1, 560, "color:var(--sub)"); }
    var icon = E("div", "cw-ic", "flex:none;width:" + iconS + "px;height:" + iconS + "px;" + (tall ? "margin-bottom:8px" : "margin-right:14px"), [ic(c.icon || ctlIcon(c), tall ? 32 : 26, on ? "#1a1406" : "#fff", "solid")]);
    var items = al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center";
    return E("div", "cw-mod" + (on ? " on" : ""), "flex:none;margin:10px;width:" + px(mw) + ";height:" + px(mh) + ";padding:" + pad + "px;" +
      (tall ? "flex-direction:column;justify-content:center;align-items:" + items : "flex-direction:row;align-items:center;justify-content:" + items) + ";text-align:" + al,
      tall ? [icon, name, st] : [icon, E("div", "cw-col", "min-width:0;align-items:" + (al === "right" ? "flex-end" : "flex-start") + ";text-align:" + (al === "right" ? "right" : "left"), [name, st])]);
  }
  R.controls = function (root, o, b, env) {
    var ha = haOf(env), info = ha.info || {}, q = op(o), title = q.label || "Control Centre", al = alignOf(o), W = b.w - 48, H = b.h - 48;
    if (!env.demo && !(info.controls && info.controls.length)) return soonFit(root, b, "light", "controls");
    var items = controlsOf(env, o);
    if (!items) return haWait(root, b, o, "home", title, "Checking Home Assistant");
    if (!items.length) return haWait(root, b, o, "home", title, "None of these switches is set up on this TV");
    alignRoot(root, al);
    var nOn = items.filter(function (c) { return c.ok !== false && c.on; }).length, allDown = !items.some(function (c) { return c.ok !== false; });
    if (b.w < 300 && b.h < 300) {
      // a tile: how many are on; OK opens every switch big
      add(root, [ic("home", 40, "currentColor", "solid"), E("div", "cw-grow"), fitWords(root, allDown ? "Not answering" : nOn ? nOn + " on" : "All off", W, 34, 1, 700, "color:var(--ink)"),
        fitWords(root, q.label || "Switches", W, 25, 1, 600, "color:var(--sub)")]);
    } else {
      // as many switches as fit with their names whole: fewer, wider boxes when names are long
      var head = q.label || b.h >= 560 ? 46 : 0, small = b.h < 200, best = null;
      for (var cols = small ? Math.max(1, Math.min(items.length, Math.floor((W + 20) / 150))) : (q.cols || clamp(Math.round(b.w / 230), 1, 6)); cols >= 1 && !best; cols--) {
        var rows = small ? 1 : Math.max(1, Math.floor((H - head + 20) / 150)), n = Math.min(items.length, cols * rows), c2 = Math.min(cols, n);
        rows = Math.ceil(n / c2);
        var mw = (W - 20 * (c2 - 1)) / c2, mh = small ? H : Math.min(220, (H - head - 20 * (rows - 1)) / rows);
        var mods = items.slice(0, n).map(function (c) { return ctlMod(root, c, mw, mh, al); });
        var named = mods.every(function (m, i) { return !items[i].name || m.textContent.indexOf(items[i].name) >= 0; });
        if (named || cols === 1) best = { mods: mods, n: n };
      }
      // the label and the switches as one group in the middle of the box
      root.style.justifyContent = "center";
      add(root, [head ? fitLab(root, "home", title, W) : null, E("div", "cw-mods", "flex:0 1 auto;align-self:stretch;align-content:center;" + justify(al) + (head ? ";margin-top:-4px" : ""), best.mods)]);
    }
    stop(root, "detail", "controls", title);
  };

  // Camera: a still picture, a new one every two seconds while the home is in front (never video)
  function stillWidth(b) { return b.w > 900 ? 1280 : b.w > 500 ? 960 : 640; }
  function liveStill(root, pic, entity, b, env, onFail) {
    if (env.demo || env.designer || !window.smartHome || !window.smartHome.still) return;
    var fails = 0;
    live(root, 2000, function () {
      if (document.hidden) return;
      window.smartHome.still(entity, stillWidth(b)).then(function (r) {
        if (r && r.ok && window.smartHome.stillOk(r.src)) { fails = 0; pic.style.backgroundImage = cssImg(r.src); if (onFail) onFail(false); }
        else if (r && r.error !== "busy" && ++fails >= 3 && onFail) onFail(true);
      });
    });
  }
  R.camera = function (root, o, b, env) {
    var ha = haOf(env), info = ha.info || {}, q = op(o), cams = info.cameras || [], al = alignOf(o), W = b.w - 48;
    if (!env.demo && !cams.length) return soonFit(root, b, "camera", "camera");
    var cam = cams.filter(function (c) { return c.entity === q.cam; })[0] || cams[0], name = q.label || cam.name || "Camera";
    var src = env.demo ? demoImg("dog") : (ha.stills || {})[cam.entity];
    var pic = E("div", "cw-fill", "background:#1c1f24 center/cover;" + (src ? "background-image:" + cssImg(src) : ""));
    var EVERY2 = "A still every 2 seconds", say = function (t) { return fitWords(root, t, W, 24, 1, 560, "color:rgba(255,255,255,.86)"); };
    var note = E("div", "", "flex:none", [say(src ? (b.h >= 300 ? EVERY2 : "") : "Getting a picture")]);
    var nm = fitWords(root, name, W - 40, 25, 1, 680, "color:#fff") || fitWords(root, name, W - 40, 23, 2, 680, "color:#fff");
    add(root, [pic, E("div", "cw-fill", "background:linear-gradient(180deg,rgba(0,0,0,.55),transparent 45%)"),
      E("div", "cw-col", "position:absolute;left:24px;right:24px;top:18px;color:#fff;align-items:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center") + ";text-align:" + al, [E("div", "cw-row", "max-width:100%", [ic("camera", 28, "#fff"), nm ? E("div", "", "margin-left:10px;min-width:0", [nm]) : null]), note])]);
    root.setAttribute("data-ha-cam", cam.entity);
    var setNote = function (t) { while (note.firstChild) note.removeChild(note.firstChild); var n = t ? say(t) : null; if (n) note.appendChild(n); };
    liveStill(root, pic, cam.entity, b, env, function (bad) { setNote(bad ? "Camera not answering" : b.h >= 300 ? EVERY2 : ""); });
    stop(root, "detail", "camera", name);
  };

  // Doorbell: when it last rang, with the door camera's picture
  function ringWords(at) {
    var d = new Date(at), t = now(), day0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var days = Math.round((day0 - dd) / 86400000);
    var day = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? DAYS[d.getDay()] : d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3);
    return [fmt12(d), "Last ring " + day, day.charAt(0).toUpperCase() + day.slice(1)];
  }
  R.doorbell = function (root, o, b, env) {
    var ha = haOf(env), info = ha.info || {}, al = alignOf(o), W = b.w - 48, H = b.h - 48;
    if (!env.demo && !info.doorbell) return soonFit(root, b, "doorbell", "doorbell");
    var bell = ha.bell, name = op(o).label || (bell && bell.name) || "Front door";
    var words = !bell ? ["Checking", "Home Assistant", "Checking"] : !bell.ok ? ["Not answering", "Home Assistant", "Home Assistant"] : bell.ringing ? ["Ringing now", name, "At the door"] : bell.at ? ringWords(bell.at) : ["No ring", "Not this week", "This week"];
    var ring = !env.demo && ha.ring && bell && bell.kept && ha.ring.at ? ha.ring : null;
    var src = env.demo ? bgImg("grose-valley") : ring ? ring.src : (ha.stills || {}).doorbell, cam = env.demo || info.doorbell_camera;
    var hot = bell && bell.ringing ? "color:#ff453a;" : "";
    alignRoot(root, al);
    if (b.w < 300 && b.h < 300) {
      add(root, [ic("doorbell", 32, "currentColor"), E("div", "cw-grow"), fitNum(root, words[0], W, 48, hot), fitWords(root, words[2], W, 24, 1, 560, "margin-top:6px;color:var(--sub)")]);
    } else {
      var strip = b.h < 200, side = strip || b.w > b.h * 1.4, picW = side ? (strip ? H * 1.3 : W * 0.46) : W, colW = side && cam ? W - picW - 20 : W;
      var picH = side ? H : Math.min(H * 0.5, W * 0.5625), colH = side || !cam ? H : H - picH - 16;
      var pic = cam ? E("div", "", "position:relative;flex:none;border-radius:22px;overflow:hidden;background:#2b3035 center/cover;" + (src ? "background-image:" + cssImg(src) + ";" : "") +
        "width:" + px(picW) + ";height:" + px(picH), [!strip ? E("div", "cw-t23", "position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.7)", [env.demo || ring ? "At the ring" : "Door now"]) : null]) : null;
      var big = strip ? 40 : b.w >= 700 ? 72 : 52;
      var timeEl = fitNum(root, words[0], colW, big, hot + "font-weight:700"), lineEl = fitWords(root, strip ? words[2] : words[1], colW, 25, 1, 560, "margin-top:6px;color:var(--sub)");
      var labEl = colH >= (strip ? 96 : 150) ? fitLab(root, "doorbell", name, colW) : null;
      var text = E("div", "cw-col", "flex:1;min-width:0;justify-content:center;align-items:" + (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center") + ";" + (side && cam ? "margin-left:20px" : cam ? "margin-top:16px" : ""), [labEl, labEl ? E("div", "", "height:8px;flex:none") : null, timeEl, lineEl]);
      if (side && cam) { text.style.flex = "0 1 auto"; text.style.maxWidth = px(W - picW - 20); }
      add(root, E("div", side ? "cw-row" : "cw-col", "width:100%;height:100%;align-items:" + (side ? "stretch" : "center") + ";min-height:0" + (side ? ";" + justify(al) : ""), [pic, text]));
      // no picture kept from the ring: the door camera now, a new still every two seconds
      if (pic && !ring) liveStill(root, pic, "doorbell", b, env);
    }
    stop(root, "detail", "camera", name);
  };

  // Solar and energy: today by the hour, in kWh
  function kwh(v) { return v == null || !isFinite(v) ? "--" : v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }
  function hourBars(hours, h, gap) {
    var max = Math.max.apply(null, hours.map(function (v) { return v || 0; }).concat([0.1])), last = -1;
    hours.forEach(function (v, i) { if (v != null) last = i; });
    return E("div", "cw-row", "width:100%;align-items:flex-end;height:" + px(h) + ";flex:none", hours.map(function (v, i) {
      return E("i", "", "display:block;flex:1;margin:0 " + gap + "px;border-radius:5px;height:" + (v == null ? "3px;opacity:.25;background:currentColor" : Math.max(3, Math.round(v / max * 100)) + "%;background:" + (i === last ? "#ffd60a" : "rgba(255,214,10,.62)")));
    }));
  }
  R.energy = function (root, o, b, env) {
    var ha = haOf(env), info = ha.info || {}, e = ha.energy, al = alignOf(o), W = b.w - 48, H = b.h - 48;
    if (!env.demo && !info.energy) return soonFit(root, b, "bolt", "energy");
    var name = op(o).label || (e && e.name) || "Energy";
    if (!e) return haWait(root, b, o, "bolt", name, "Checking Home Assistant");
    if (!e.ok) return haWait(root, b, o, "bolt", name, e.error === "unit" ? "This sensor is not energy or power" : NOT_ANSWERING);
    alignRoot(root, al);
    var hours = Array.isArray(e.hours) ? e.hours.slice(0, 24) : [];
    if (b.w < 300 && b.h < 300) {
      add(root, [ic("bolt", 32, "currentColor"), E("div", "cw-grow"), fitNum(root, kwh(e.total), W, 60), fitWords(root, "kWh today", W, 25, 1, 560, "color:var(--sub)") || fitWords(root, "kWh", W, 25, 1, 560, "color:var(--sub)")]);
    } else if (b.h < 200) {
      var leftW = Math.min(W * 0.5, 200);
      add(root, E("div", "cw-row", "width:100%;height:100%;align-items:stretch", [E("div", "cw-col", "flex:none;width:" + px(leftW) + ";justify-content:center;align-items:" + (al === "right" ? "flex-end" : al === "left" ? "flex-start" : "center"), [fitLab(root, "bolt", name, leftW),
        fitNum(root, kwh(e.total), leftW, 60, "margin-top:6px"), fitWords(root, "kWh today", leftW, 24, 1, 560, "color:var(--sub)")]),
        E("div", "cw-col", "flex:1;min-width:0;margin-left:16px;justify-content:center", [hourBars(hours, H - 20, 1)])]));
    } else {
      var wide = b.w >= 560, axis = b.h >= 300 && wide, half = wide && e.power != null ? (W - 36) / 2 : W;
      var stat = function (v, unit, col) { return E("div", "cw-col", "flex:none;align-items:center", [fitNum(root, v, Math.min(half, 360), 84, col ? "color:" + col : ""), fitWords(root, unit, Math.min(half, 360), 25, 1, 560, "color:var(--sub)")]); };
      var bat = e.battery != null && wide ? fitWords(root, "Battery " + e.battery + "%", W * 0.4, 25, 1, 560, "color:var(--sub)") : null;
      add(root, [E("div", "cw-row", "width:100%;flex:none;" + (bat ? "justify-content:space-between" : justify(al)), [fitLab(root, "bolt", name + " today", bat ? W * 0.58 : W), bat]),
        E("div", "cw-row", "width:100%;flex:none;margin-top:10px;align-items:flex-end;" + justify(al), [stat(kwh(e.total), "kWh today"), wide && e.power != null ? E("div", "", "width:36px;flex:none") : null,
          wide && e.power != null ? stat(kwh(e.power), String(e.power_unit || "kW") + " now", "#30d158") : null]),
        E("div", "cw-col cw-grow", "width:100%;justify-content:flex-end;margin-top:14px;min-height:0", [hourBars(hours, Math.max(40, b.h - (axis ? 260 : 220)), wide ? 3 : 1),
          axis ? E("div", "cw-row cw-sp cw-t23", "width:100%;margin-top:6px", ["12am", "6am", "12pm", "6pm", "12am"].map(function (x) { return E("span", "", "", [x]); })) : null])]);
    }
    stop(root, "detail", "energy", name);
  };

  // Sensor: one reading, with its last 24 hours
  var SENSOR_ICON = { temperature: "temperature", humidity: "humidity", precipitation: "rain", precipitation_intensity: "rain", wind_speed: "wind", power: "bolt", energy: "bolt", battery: "bolt", illuminance: "sun" };
  function sensorText(s) {
    if (!s || s.ok === false) return ["--", ""];
    var v = s.num != null && isFinite(s.num) ? String(Math.round(s.num * 10) / 10) : String(s.value || "--").slice(0, 12), u = String(s.unit || "");
    return u === "°C" || u === "°F" ? [v + "°", ""] : [v, u];
  }
  function spark(points, w, h, colour) {
    var vals = (points || []).map(function (v) { return v == null || !isFinite(v) ? null : +v; }), got = vals.filter(function (v) { return v != null; });
    if (got.length < 2) return E("div", "cw-t23", "flex:none;height:" + px(Math.min(h, 30)), ["No readings yet"]);
    var lo = Math.min.apply(null, got), hi = Math.max.apply(null, got), span = hi - lo || 1, d = "";
    vals.forEach(function (v, i) { if (v == null) return; var x = i / (vals.length - 1) * 236 + 2, y = 96 - (v - lo) / span * 92; d += (d ? "L" : "M") + Math.round(x * 10) / 10 + " " + Math.round(y * 10) / 10; });
    var g = svg("0 0 240 100", w, h, [S("path", { d: d, fill: "none", stroke: colour || "currentColor", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" })], "flex:none;display:block");
    g.setAttribute("preserveAspectRatio", "none");   // the day fills the width it is given
    return g;
  }
  function sensorPick(env, o) {
    var ha = haOf(env), names = (ha.info && ha.info.sensors) || [], want = op(o).reading;
    var n = names.filter(function (s) { return s.entity === want; })[0] || names[0];
    if (!n) return null;
    var s = (ha.sensors || []).filter(function (x) { return x.entity === n.entity; })[0];
    return { entity: n.entity, name: op(o).label || (s && s.name) || n.name || "Sensor", s: s, read: !!ha.sensors, hist: (ha.hist || {})[n.entity] };
  }
  // the reading and its unit on one line, as big as fits
  function sensorValue(root, t, width, max) {
    var unitW = t[1] ? (fitPxText(t[1], width * 0.4, 25, 1, 560, famOf(root)) ? t[1].length * 15 + 12 : -1) : 0;
    if (unitW < 0) unitW = 0, t = [t[0], ""];
    return E("div", "cw-row", "flex:none;align-items:baseline;max-width:100%", [fitNum(root, t[0], width - unitW, max), t[1] ? E("span", "cw-t25", "margin-left:8px;white-space:nowrap;flex:none", [t[1]]) : null]);
  }
  R.sensor = function (root, o, b, env) {
    var p = sensorPick(env, o), al = alignOf(o), W = b.w - 48, H = b.h - 48;
    if (!p) return soonFit(root, b, "temperature", "sensor");
    var iconName = SENSOR_ICON[p.s && p.s.cls] || "temperature";
    if (!p.read) return haWait(root, b, o, iconName, p.name, "Checking Home Assistant");
    if (!p.s || p.s.ok === false) return haWait(root, b, o, iconName, p.name, NOT_ANSWERING);
    alignRoot(root, al);
    var t = sensorText(p.s), pts = p.hist && p.hist.points, got = (pts || []).filter(function (v) { return v != null; });
    if (b.w < 300 && b.h < 300) {
      add(root, [fitLab(root, iconName, p.name, W), E("div", "cw-grow"), sensorValue(root, t, W, 64)]);
    } else {
      root.setAttribute("data-ha-hist", p.entity);   // smarthome.js reads its last 24 hours
      if (b.h < 200) {
        var leftW = W * 0.5;
        add(root, E("div", "cw-row", "width:100%;height:100%;align-items:center;" + justify(al), [E("div", "cw-col", "flex:none;max-width:" + px(leftW) + ";justify-content:center;align-items:" + (al === "right" ? "flex-end" : al === "left" ? "flex-start" : "center"), [fitLab(root, iconName, p.name, leftW), sensorValue(root, t, leftW, 64)]),
          E("div", "", "flex:none;margin-left:16px", [spark(pts, W - leftW - 16, H - 20)])]));
      } else {
        var foot = got.length >= 2 ? "Low " + Math.round(Math.min.apply(null, got) * 10) / 10 + ", high " + Math.round(Math.max.apply(null, got) * 10) / 10 : "";
        var footEl = foot ? fitWords(root, foot, W, 24, 1, 560, "color:var(--sub)") : null, value = sensorValue(root, t, W, b.h < 300 ? 64 : 96);
        add(root, [fitLab(root, iconName, p.name, W), E("div", "", "height:10px;flex:none"), value, E("div", "cw-grow cw-col", "width:100%;justify-content:center;min-height:0", [spark(pts, W, Math.max(40, H - 46 - (b.h < 300 ? 70 : 100) - (footEl ? 34 : 0) - 24))]),
          footEl, fitWords(root, "Last 24 hours", W, 24, 1, 560, "color:var(--sub)")]);
      }
    }
    stop(root, "detail", "sensor", p.name);
  };
  // the remotes, controllers and headphones paired with this TV by Bluetooth, and their charge: read from
  // Android by the launcher (Batteries.kt, TVOS.batteries), at most every 5 minutes. Only the device's
  // name and level; none of it leaves the TV.
  var BAT_ICON = { remote: "remote", controller: "games", headphones: "headphones", keyboard: "edit", other: "bluetooth" }, BAT = { at: 0, v: null };
  function batteriesOf(env) {
    if (env.demo) return { need: "", devices: [{ kind: "controller", name: "Pad 1", level: 72 }, { kind: "controller", name: "Pad 2", level: 12 }, { kind: "headphones", name: "Headset", level: 55 }] };
    var T = window.TVOS;
    if (!T || typeof T.batteries !== "function") return null;
    if (!BAT.v || Date.now() - BAT.at > 300000) { try { BAT.v = JSON.parse(T.batteries()); } catch (e) { BAT.v = { need: "bluetooth", devices: [] }; } BAT.at = Date.now(); }
    return BAT.v;
  }
  R.battery = function (root, o, b, env) {
    var bt = batteriesOf(env);
    if (!bt) return empty(root, b, "bolt", "Batteries show on a Google TV, Android TV or Fire TV", "Only Android shares the charge of paired remotes");
    if (bt.need === "permission") return soon(root, b, "bolt", "battery");
    if (!bt.devices || !bt.devices.length) return empty(root, b, "bolt", "No charge to show", "Paired remotes and controllers that report their charge show here");
    var d = bt.devices.slice(0, b.w < 700 ? 3 : 4).map(function (x) { return [BAT_ICON[x.kind] || "bluetooth", x.name, x.level]; }), R2 = Math.max(96, Math.min((b.w - 48) / d.length - 40, b.h - 190));
    // the label and the rings as one group in the middle of the box
    root.style.justifyContent = "center";
    add(root, [lab("bolt", op(o).label || "Batteries"), E("div", "cw-row", "justify-content:space-around;margin-top:16px", d.map(function (x) {
      var c = x[2] < 20 ? "#ff453a" : "#30d158";
      return E("div", "cw-col", "align-items:center", [E("div", "", "position:relative;width:" + px(R2) + ";height:" + px(R2), [svg("0 0 100 100", R2, R2, [S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "rgba(255,255,255,.14)", "stroke-width": 9 }),
        S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: c, "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": 264, "stroke-dashoffset": 264 * (1 - x[2] / 100), transform: "rotate(-90 50 50)" })]),
        E("div", "", "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center", [ic(x[0], R2 * 0.36, "#fff")])]),
        E("div", "cw-t29", "color:var(--ink);font-weight:680;margin-top:12px", [x[2] + "%"]), E("div", "cw-t23 cw-ell", "max-width:" + px(R2 + 40), [x[1]])]);
    }))]);
  };

  // lists and the family
  R.bins = function (root, o, b, env) {
    var q = op(o), d = now();
    var wd = q.weekday === undefined ? 3 : q.weekday, ahead = (wd - d.getDay() + 7) % 7;
    var when = ahead === 0 ? "Tonight" : ahead === 1 ? "Tomorrow night" : DAYS[wd] + " night";
    var night = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ahead), week = Math.floor((night.getTime() / 86400000 - (q.anchor || 0)) / 7);
    var a = [q.lid_a || "#ffd60a", q.bin_a || "Recycling"], c = [q.lid_b || "#30d158", q.bin_b || "Garden"];
    var bins = q.alt ? [["#ff453a", "Rubbish"], week % 2 === 0 ? a : c] : [a, c];
    if (!env.demo && q.weekday === undefined) return empty(root, b, "calendar", "Set your bin night in couch-tv Studio", "Pick the night and the bins");
    var bs = b.h < 300 ? 48 : 62;
    add(root, [lab("calendar", op(o).label || "Bin night"), E("div", b.h < 300 ? "cw-t29" : "cw-t38", "margin-top:12px;font-weight:700", [when]), E("div", "cw-grow"),
      E("div", "cw-row", "", bins.map(function (x, i) {
        return E("div", "cw-col", "align-items:center;" + (i ? "margin-left:16px" : ""), [svg("0 0 62 72", bs, bs * 72 / 62, [S("rect", { x: 6, y: 14, width: 50, height: 56, rx: 8, fill: "#3a3a40" }), S("rect", { x: 2, y: 6, width: 58, height: 12, rx: 5, fill: x[0] })]), b.w >= 300 ? E("span", "cw-t23", "margin-top:8px", [x[1]]) : null]);
      }))]);
  };
  R.people = function (root, o, b, env) {
    var ps = people(env);
    if (!ps.length) return empty(root, b, "people", "Add people in Home settings", "");
    var av = clamp(b.h - 20, 40, 62);
    root.style.padding = b.h < 100 ? "0 20px" : "14px 20px";
    add(root, E("div", "cw-row", "height:100%;max-width:100%", ps.slice(0, Math.max(1, Math.floor(b.w / 150))).map(function (x, i) {
      var p = E("div", "cw-row", "min-width:0;flex:0 1 auto;opacity:" + (x[2] ? 1 : 0.68) + ";" + (i ? "margin-left:20px" : "") + ";border-radius:40px;padding:4px", [E("div", "", "width:" + px(av) + ";height:" + px(av) + ";border-radius:50%;overflow:hidden;flex:none;" + (x[2] ? "box-shadow:0 0 0 4px #fff" : ""), [avatar(x[0], av)]),
        E("span", "cw-t25 cw-ell", "color:var(--ink);margin-left:12px;font-weight:" + (x[2] ? 700 : 560), [x[1]])]);
      return stop(p, "person", x[3], x[1]);
    })));
  };

  // info
  R.card = function (root, o, b, env) {
    // a card written in couch-tv Studio: a title, a line of words and an icon (words only, like every design)
    var q = op(o);
    if (q.label || q.text) {
      // the words fill what is left under the title, wrapping, as big as they fit (the quote's rule)
      var room = Math.max(40, b.h - 48 - (q.label ? 52 : 0)), len = Math.max(6, (q.text || "").length);
      var fs = clamp(Math.min(Math.sqrt((b.w - 48) * room / len / 1.7), room / 1.15), 23, 84);
      add(root, [q.label ? lab(q.icon || "info", q.label) : null, E("div", "cw-grow"),
        q.text ? E("div", "cw-big", "font-size:" + px(fs) + ";line-height:1.1;letter-spacing:-.01em;white-space:pre-line;overflow-wrap:break-word;min-width:0;max-height:" + px(room) + ";overflow:hidden", [q.text]) : null]);
      return;
    }
    var cards = env.demo ? [{ title: "Solar today", value: "18.4 kWh" }] : (dataOf(env).cards || []);
    if (!cards.length) return soon(root, b, "info", "card");
    var c = cards[dayIndex(cards.length, 20)];
    add(root, [E("div", "cw-lab", "", [String(c.title || "")]), E("div", "cw-grow"), E("div", "cw-big", "overflow-wrap:anywhere;font-size:" + px(Math.min(clamp(b.h / 3.2, 44, 96), fitPx(String(c.value || "").split(/\s+/).sort(function (x, y) { return y.length - x.length; })[0], b.w - 48, 96))), [String(c.value || "")])]);
  };
  R.quote = function (root, o, b) {
    var q = op(o), words = window.CouchWords || { quotes: ["Slow mornings are the good ones."] };
    var text = q.text || words.quotes[dayOfYear() % words.quotes.length];
    var fs = clamp(Math.sqrt((b.w - 48) * (b.h - 48) / Math.max(20, text.length) / 1.6), 28, 64);
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [E("div", "", "font-size:" + px(fs) + ";font-weight:600;line-height:1.24;letter-spacing:-.01em;color:var(--ink)" + (root.classList.contains("cw-bare") ? ";text-shadow:0 2px 16px rgba(0,0,0,.3)" : ""), [text]),
      q.sub ? E("div", "cw-t25", "margin-top:14px;color:var(--ink);opacity:.75;font-weight:600", [q.sub]) : null]));
  };
  function dayOfYear() { var d = now(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); }
  R.word = function (root, o, b) {
    var words = (window.CouchWords || {}).words || [["Petrichor", "noun", "The smell of rain on dry ground."]], w = words[dayOfYear() % words.length];
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [E("div", "cw-lab", "", ["Word of the day"]), E("div", "cw-t48", "margin-top:10px;font-size:" + px(clamp(b.w / 7, 40, 64)), [w[0]]),
      E("div", "cw-t25", "font-style:italic;margin-top:4px", [w[1]]), b.h >= 300 ? E("div", "cw-t25", "color:var(--ink);margin-top:14px", [w[2]]) : null]));
  };
  // ---------------- the web widgets: news, scores, markets, the commute (widget-web.js) ----------------
  // app.js hands in what widget-web.js got (data.web[source][id]); before that, or when it failed, the
  // widget says so in its own box. In couch-tv Studio, demo data. Never a made up reading on a TV.
  //
  // The owner's rule for every one of them: nothing is ever cut off, and everything is centred unless
  // the design sets opts.align. Words wrap (a long word breaks rather than spills), never end in "...";
  // once the widget is on screen, fitLater() shrinks the words marked data-fit (never under 23 px) and
  // then leaves out whole items marked data-drop (the least needed first) until nothing spills.
  function webOf(env, src, id) { var w = dataOf(env).web; return w && w[src] && Object.prototype.hasOwnProperty.call(w[src], id) ? w[src][id] : null; }
  // alignOf(o): the smart home widgets' own, above (the same rule)
  function jc(a) { return a === "left" ? "flex-start" : a === "right" ? "flex-end" : "center"; }
  // words wrap between words; a word too long for its line makes the words smaller first, and only
  // breaks (fitNow, last of all) when even the smallest size cannot hold it
  var WRAP = "overflow-wrap:normal;word-break:normal;min-width:0;max-width:100%;";
  function fitT(el, min) { el.setAttribute("data-fit", String(min || 23)); return el; }
  // n: how readily it is left out when the box is too small (higher goes first)
  function dropT(el, n) { el.setAttribute("data-drop", String(n || 1)); return el; }
  function clips(el) {
    var cs = window.getComputedStyle(el);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") return false;
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  }
  // inside the box's own padding, so words never crowd its edge
  // tall: only whether it runs out of room up and down (too many items, not too wide a word)
  function spills(root, tall) {
    // on screen the design layer may be scaled (couch-tv Studio's preview, a smaller TV): every length
    // here is in the widget's own pixels times that scale, so a design fits the same at any size
    var bb = root.getBoundingClientRect(), sc = root.offsetWidth ? bb.width / root.offsetWidth : 1, cs = window.getComputedStyle(root), all = root.querySelectorAll("*"), p = function (k) { return Math.max(0, (parseFloat(cs[k]) || 0) - 6) * sc; };
    var b = { left: bb.left + p("paddingLeft") - sc + 1, right: bb.right - p("paddingRight") + sc - 1, top: bb.top + p("paddingTop") - sc + 1, bottom: bb.bottom - p("paddingBottom") + sc - 1 };
    if (root.scrollHeight > root.clientHeight + 1 || (!tall && root.scrollWidth > root.clientWidth + 1)) return true;
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.classList.contains("cw-bg") || n.classList.contains("cw-fill")) continue;
      var r = n.getBoundingClientRect();
      if (tall) { if (r.height && (r.bottom > b.bottom + 1 || r.top < b.top - 1)) return true; continue; }
      if (clips(n)) return true;
      if (n.hasAttribute("data-fit") && n.scrollWidth > n.clientWidth + 1) return true;
      if (r.width && r.height && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1)) return true;
    }
    return false;
  }
  function fitNow(root) {
    if (!root.parentNode || !document.documentElement.contains(root) || !root.clientWidth || !window.getComputedStyle) return false;
    var fit = [].slice.call(root.querySelectorAll("[data-fit]"));
    // too many items for the box: the least needed go first, so the rest keep their size
    var extra = [].slice.call(root.querySelectorAll("[data-drop]")).filter(function (e) { return +e.getAttribute("data-drop") >= 2; });
    while (extra.length && spills(root, true)) { var x = extra.pop(); if (x.parentNode) x.parentNode.removeChild(x); }
    for (var k = 0; k < 14 && spills(root); k++) {
      var shrunk = false;
      fit.forEach(function (e) {
        var fs = parseFloat(window.getComputedStyle(e).fontSize), min = +e.getAttribute("data-fit") || 23;
        if (fs > min + 0.5) { e.style.fontSize = Math.max(min, Math.floor(fs * 0.9)) + "px"; shrunk = true; }
      });
      if (!shrunk) break;
    }
    // a word still wider than its line at the smallest size (a long place name, a long word) breaks
    fit.forEach(function (e) { if (e.parentNode && e.scrollWidth > e.clientWidth + 1) { e.style.overflowWrap = "anywhere"; e.style.wordBreak = "break-word"; } });
    // still too much: leave out whole items, the least needed first, never the last one
    var drop = [].slice.call(root.querySelectorAll("[data-drop]")).map(function (e, i) { return { e: e, n: +e.getAttribute("data-drop") || 1, i: i }; });
    drop.sort(function (a, c) { return a.n - c.n || a.i - c.i; });
    while (drop.length > 1 && spills(root)) { var d = drop.pop().e; if (d.parentNode) d.parentNode.removeChild(d); }
    // and last: a block of words still too tall ends in "..." on the last line that fits (3, 2, then 1)
    for (var L = 3; L >= 1 && spills(root); L--) fit.forEach(function (e) {
      if (!e.parentNode) return;
      var cs = window.getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      if (e.offsetHeight > lh * L + 1) { e.style.display = "-webkit-box"; e.style.webkitLineClamp = String(L); e.style.webkitBoxOrient = "vertical"; e.style.overflow = "hidden"; }
    });
    // a box of words as wide as its longest line (so a group with an icon sits in the middle)
    [].forEach.call(root.querySelectorAll("[data-hug]"), function (e) {
      var w = 0, walk = document.createTreeWalker(e, 4);
      for (var t = walk.nextNode(); t; t = walk.nextNode()) { var rg = document.createRange(); rg.selectNodeContents(t); [].forEach.call(rg.getClientRects(), function (q) { w = Math.max(w, q.width); }); }
      // (the design layer is scaled to the screen: a line's width on screen over the scale)
      var sc = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
      if (w && sc > 0) { e.style.flex = "none"; e.style.width = Math.ceil(w / sc + 2) + "px"; }
    });
    root.setAttribute("data-fitted", "1");
    return true;
  }
  function fitLater(root) {
    root.setAttribute("data-fits", "1");
    var tries = 0, go = function () { if (fitNow(root) || ++tries > 30) return; setTimeout(go, 100); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(go); else setTimeout(go, 16);
  }
  // the content of a web widget: one column, centred in its box (or to the side the design says)
  function webBody(root, a, kids) {
    // every line spans the box; each says where its words sit (text-align, or its row's justify)
    add(root, E("div", "cw-col", "height:100%;min-height:0;justify-content:center;align-items:stretch;text-align:" + a, kids));
    fitLater(root);
  }
  // a heading: the icon and its words, centred unless the design says, wrapping (never cut short)
  function webHead(iconName, text, a, right, colour) {
    return E("div", "cw-row", "justify-content:" + (right ? "space-between" : jc(a)) + ";align-items:center;min-width:0;flex:none", [
      E("div", "cw-row", "justify-content:" + jc(a) + ";align-items:center;min-width:0;" + (right ? "flex:1;" : ""), [iconName ? ic(iconName, 30, colour || "currentColor") : null,
        fitT(E("span", "", WRAP + "font-size:25px;line-height:1.2;font-weight:650;color:" + (colour || "var(--sub)") + ";text-align:" + a + (iconName ? ";margin-left:10px" : ""), [text]))]),
      right ? fitT(E("span", "", "font-size:24px;line-height:1.2;font-weight:700;margin-left:12px;text-align:right;flex:none;max-width:45%;" + WRAP + (right.colour ? "color:" + right.colour : "color:var(--sub)"), [right.text])) : null]);
  }
  // the plain words for each web widget: [still asking, could not read it, nothing there, no relay on
  // this TV], and the same for a box too small for a sentence
  var WEB_WORDS = {
    news: ["Getting the headlines", "The headlines could not be read just now", "No headlines in this feed right now", "Headlines need a home computer or a newer couch-tv"],
    sports: ["Getting the scores", "The scores could not be read just now", "No games right now", "Scores need a newer couch-tv"],
    stocks: ["Getting the prices", "The prices could not be read just now", "No prices for these right now", "Prices need a home computer or a newer couch-tv"],
    commute: ["Working out the drive", "The drive could not be worked out just now", "No road route between these places", "Commute needs a newer couch-tv"]
  };
  var WEB_SHORT = { news: ["Getting news", "News failed", "No news", "Needs set up"], sports: ["Getting scores", "Scores failed", "No games", "Needs set up"],
    stocks: ["Getting prices", "Prices failed", "No prices", "Needs set up"], commute: ["Working it out", "Drive failed", "No route", "Needs set up"] };
  // an honest state in the widget's own box, its words fitted like the rest
  function webEmpty(root, b, iconName, line, sub, shortLine) {
    empty(root, b, iconName, (b.w < 300 || b.h < 200) && shortLine ? shortLine : line, sub);
    // centred both ways, like the rest of these widgets (empty() itself is shared and starts on the left)
    root.style.alignItems = "center"; root.style.textAlign = "center";
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll(".cw-e1, .cw-e2") : [], function (e) { e.style.cssText += ";-webkit-line-clamp:unset;display:block;overflow:visible;" + WRAP; fitT(e); });
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll(".cw-row") : [], function (e) { e.style.justifyContent = "center"; e.style.width = "100%"; });
    fitLater(root);
  }
  // true when rec has something to draw; otherwise draws the honest state and says false
  function webReady(root, b, iconName, kind, rec) {
    var w = WEB_WORDS[kind], s = WEB_SHORT[kind];
    if (rec && rec.ok) return true;
    if (!rec) webEmpty(root, b, iconName, w[0], "It shows here in a moment", s[0]);
    // switched off for every TV by the design store (an unofficial source that changed): calm, no steps
    else if (rec.err === "paused") webEmpty(root, b, iconName, "This feed is paused", "It comes back on its own", "Paused");
    else if (rec.err === "relay") { webEmpty(root, b, iconName, w[3], "OK here shows how", s[3]); root.setAttribute("data-setup", kind); }
    else if (rec.err === "empty") webEmpty(root, b, iconName, w[2], "couch-tv looks again soon", s[2]);
    else webEmpty(root, b, iconName, w[1], "couch-tv tries again in a few minutes", s[1]);
    return false;
  }
  var DEMO_NEWS = [["Coastal highway upgrade finishes a month early", 1], ["Storm season outlook: a wetter summer than usual", 2], ["Matildas name squad for December friendlies", 3], ["Petrol prices ease ahead of the holidays", 4],
    ["Library extends weekend hours over summer", 5], ["New ferry timetable starts on Monday", 6]];
  function newsOf(root, o, b, env) {
    var WW = window.CouchWidgetWeb, q = op(o), feed = WW ? WW.feedOf(q.feed) : "abc", name = q.label || (WW ? WW.FEEDS[feed].name : "Headlines");
    if (env.demo) return { name: name, items: DEMO_NEWS.map(function (x) { return { title: x[0], at: Date.now() - x[1] * 3600000 }; }) };
    var rec = webOf(env, "news", feed);
    return webReady(root, b, "info", "news", rec) ? { name: name, items: rec.v || [], stale: !!rec.stale, at: rec.at } : null;
  }
  function agoOf(at) { var WW = window.CouchWidgetWeb; return WW && at ? WW.ago(at, now().getTime()) : ""; }
  function headline(x, a, first, size) {
    return dropT(E("div", "", "min-width:0;flex:none;" + (first ? "" : "margin-top:16px"), [x.at ? E("div", "cw-t23", "color:#ff453a;font-weight:700;text-align:" + a, [agoOf(x.at)]) : null,
      fitT(E("div", "", WRAP + "font-size:" + (size || 29) + "px;line-height:1.22;font-weight:640;margin-top:4px;text-align:" + a, [x.title]))]), first ? 1 : 2);
  }
  R.news = function (root, o, b, env) {
    var N = newsOf(root, o, b, env), a = alignOf(o);
    if (!N) return;
    if (!N.items.length) return webEmpty(root, b, "info", WEB_WORDS.news[2], "", WEB_SHORT.news[2]);
    var n = clamp(Math.floor((b.h - 70) / 110), 1, 5);
    webBody(root, a, [webHead("info", N.name, a), N.stale ? line("Not updated lately", 24, "color:var(--sub)", a, 3) : null, E("div", "", "height:14px;flex:none")].concat(N.items.slice(0, n).map(function (x, i) { return headline(x, a, i === 0); })));
  };

  // Scores: one league's round from ESPN's public scoreboard (widget-web.js), live games first, then
  // the household's team (opts.team), then results, then what is next
  var DEMO_GAMES = [["Titans", "GLD", "#00a6e2", "24", "Broncos", "BRI", "#7c1d3f", "18", "post", "Full time"], ["Rabbitohs", "SOU", "#00843d", "12", "Roosters", "SYD", "#002b5c", "12", "in", "62 min"],
    ["Storm", "MEL", "#592c82", "6", "Raiders", "CAN", "#6bbe45", "0", "in", "21 min"], ["Sharks", "CRO", "#00a9d8", "", "Eels", "PAR", "#ffcc00", "", "pre", ""], ["Dolphins", "DOL", "#e0262c", "", "Cowboys", "NQL", "#002b5c", "", "pre", ""]];
  function demoScores() {
    var t = now().getTime();
    return { league: "NRL", round: "Round 3", games: DEMO_GAMES.map(function (x, i) {
      return { id: "d" + i, at: t + (i - 2) * 3600000, state: x[8], detail: x[9], teams: [{ name: x[0], abbr: x[1], colour: x[2], score: x[3], win: x[8] === "post" && +x[3] > +x[7], home: true }, { name: x[4], abbr: x[5], colour: x[6], score: x[7], win: x[8] === "post" && +x[7] > +x[3] }] };
    }) };
  }
  function scoresOf(root, o, b, env) {
    var WW = window.CouchWidgetWeb, q = op(o), id = WW ? WW.leagueOf(q.league) : "nrl", v;
    if (env.demo) v = demoScores();
    else { var rec = webOf(env, "sports", id); if (!webReady(root, b, "tv", "sports", rec)) return null; v = rec.v || { games: [] }; v.stale = !!rec.stale; }
    var name = q.label || v.league || "Scores";
    if (!v.games || !v.games.length) { webEmpty(root, b, "tv", "No " + (v.league || "") + " games this week", "Scores show here when the next round starts", "No games"); return null; }
    return { name: name, round: v.round || "", stale: v.stale, games: WW ? WW.scoreOrder(v.games, q.team, now().getTime()) : v.games };
  }
  // a result in plain words: "Full time", "Full time, extra time", "Full time, penalties"
  var FULL = { ot: "extra time", aet: "extra time", pens: "penalties", so: "a shoot out" };
  function resultWords(d) {
    var m = /^(final|ft|full time)(\/(\w+))?$/i.exec(String(d || "").trim());
    if (!d || m && !m[3]) return "Full time";
    if (m) return "Full time, " + (FULL[m[3].toLowerCase()] || (/^\d+ot$/i.test(m[3]) ? "extra time" : m[3]));
    return d;
  }
  // what a game's status line says: live and how far in, the result, or when it starts (the TV's time)
  function gameStatus(g, env) {
    if (g.state === "in") return { text: g.detail && !/^(in progress|live)$/i.test(g.detail) ? "Live, " + g.detail : "Live", live: true };
    if (g.state === "post") return { text: resultWords(g.detail) };
    var WW = window.CouchWidgetWeb;
    return { text: WW ? WW.kickoff(g.at, now().getTime(), env && env.clock24) : "" };
  }
  // a cricket score keeps its runs and wickets on a widget ("460/7"); the overs are in the layer
  function shortScore(s) { s = String(s || ""); var i = s.indexOf(" ("); return i > 0 ? s.slice(0, i) : s; }
  function teamRow(t, g, size) {
    var dim = g.state === "post" && !t.win, fw = g.state === "post" && t.win ? 740 : 560;
    return E("div", "cw-row", "justify-content:space-between;align-items:center;min-width:0", [E("div", "cw-row", "min-width:0;flex:1;align-items:center;justify-content:flex-start", [E("i", "", "display:block;flex:none;width:22px;height:22px;border-radius:11px;margin-right:12px;box-shadow:0 0 0 3px rgba(255,255,255,.18);background:" + (t.colour || "rgba(255,255,255,.35)")),
      fitT(E("span", "", WRAP + "font-size:" + size + "px;line-height:1.2;text-align:left;font-weight:" + fw + ";opacity:" + (dim ? 0.7 : 1), [t.name || t.abbr]))]),
      fitT(E("span", "", "font-size:" + size + "px;line-height:1.2;margin-left:12px;font-weight:720;flex:none;text-align:right;max-width:45%;" + WRAP + "opacity:" + (dim ? 0.7 : 1), [shortScore(t.score)]))]);
  }
  function statusLine(st, a) { return fitT(E("div", "", WRAP + "font-size:24px;line-height:1.25;margin-top:6px;font-weight:700;text-align:" + a + ";color:" + (st.live ? "#ff453a" : "var(--sub)"), [st.text])); }
  function gameBlock(g, env, a) {
    return E("div", "cw-col", "padding:12px 18px;border-radius:22px;min-width:0;flex:none;background:rgba(255,255,255," + (g.mine ? ".16" : ".08") + ")", [teamRow(g.teams[0], g, 29), E("div", "", "height:6px"), teamRow(g.teams[1], g, 29), statusLine(gameStatus(g, env), a)]);
  }
  R.sports = function (root, o, b, env) {
    var V = scoresOf(root, o, b, env), a = alignOf(o);
    if (!V) return;
    var cols = b.w >= 700 ? 2 : 1, rows = clamp(Math.floor((b.h - 56) / 150), 1, 6), n = Math.min(V.games.length, cols * rows), cw = (b.w - 48 - (cols - 1) * 16) / cols;
    var live = V.games.some(function (g) { return g.state === "in"; }), right = V.stale ? { text: "Not updated lately" } : live ? { text: "Live now", colour: "#ff453a" } : V.round ? { text: V.round } : null;
    var blocks = [];
    for (var r = 0; r * cols < n; r++) {
      var row = V.games.slice(r * cols, Math.min(n, r * cols + cols)).map(function (g, i) { var el = gameBlock(g, env, a); el.style.width = px(cw); if (i) el.style.marginLeft = "16px"; return el; });
      blocks.push(dropT(E("div", "cw-row", "align-items:stretch;justify-content:" + jc(a) + ";flex:none;margin-top:" + (r ? 12 : 14) + "px", row), r === 0 ? 1 : 2));
    }
    webBody(root, a, [webHead("tv", V.name, a, right)].concat(blocks));
  };

  // Markets: the design's watchlist (opts.tickers) from Yahoo Finance's chart data, through couch-tv's
  // relay (widget-web.js); prices about 20 minutes late on the ASX
  var DEMO_QUOTES = { "^AXJO": ["ASX 200", "index", "AUD", 8412, 8362], "AUDUSD=X": ["AUD/USD", "fx", "USD", 0.672, 0.6713], "BTC-AUD": ["Bitcoin", "crypto", "AUD", 142310, 144038], "BHP.AX": ["BHP", "share", "AUD", 54.34, 53.9] };
  function demoQuote(sym, i) {
    var d = DEMO_QUOTES[sym] || [sym.replace(/\.AX$/, ""), "share", "AUD", 12.5 + i * 7.25, 12.5 + i * 7.25 + (i % 2 ? 0.3 : -0.2)];
    var pts = []; for (var k = 0; k < 24; k++) pts.push(d[4] + (d[3] - d[4]) * (k / 23) + Math.sin(k * 1.3 + i) * Math.abs(d[3] - d[4]) * 0.4);
    return { symbol: sym, name: d[0], kind: d[1], currency: d[2], price: d[3], prev: d[4], change: Math.round((d[3] - d[4]) / d[4] * 10000) / 100, points: pts };
  }
  function stocksOf(root, o, b, env) {
    var WW = window.CouchWidgetWeb, q = op(o), list = WW ? WW.tickersOf(q.tickers) : ["^AXJO"], quotes, stale = false;
    if (env.demo) quotes = list.map(demoQuote);
    else {
      var rec = webOf(env, "stocks", list.join(","));
      if (!webReady(root, b, "info", "stocks", rec)) return null;
      quotes = list.map(function (s) { return ((rec.v || {}).quotes || {})[s]; }).filter(Boolean); stale = !!rec.stale;
    }
    if (!quotes.length) { webEmpty(root, b, "info", "None of these has a price right now", "Check the symbols in couch-tv Studio", "No prices"); return null; }
    return { name: q.label || "Markets", quotes: quotes, stale: stale };
  }
  function upDown(c) { return c > 0 ? "#30d158" : c < 0 ? "#ff453a" : "rgba(255,255,255,.3)"; }
  function moveChip(x) {
    var WW = window.CouchWidgetWeb;
    return E("div", "cw-chip", "height:44px;font-size:23px;margin-left:12px;padding:0 16px;color:#fff;flex:none;white-space:nowrap;background:" + upDown(x.change), [WW ? WW.change(x) || "0%" : ""]);
  }
  function quoteRow(x, a, withPrice, first) {
    var WW = window.CouchWidgetWeb;
    return dropT(E("div", "cw-row", "justify-content:space-between;align-items:center;min-width:0;flex:none;" + (first ? "" : "margin-top:14px"), [E("div", "cw-col", "min-width:0;flex:1;text-align:left", [
      fitT(E("div", "", WRAP + "font-size:29px;line-height:1.2;font-weight:680", [x.name])), withPrice ? fitT(E("div", "", WRAP + "font-size:24px;line-height:1.25;color:var(--sub)", [WW ? WW.price(x) : String(x.price)])) : null]),
      moveChip(x)]), first ? 1 : 2);
  }
  R.stocks = function (root, o, b, env) {
    var V = stocksOf(root, o, b, env), a = alignOf(o);
    if (!V) return;
    var n = clamp(Math.floor((b.h - 70) / 92), 1, 6);
    webBody(root, a, [webHead(null, V.name, a), V.stale ? line("Not updated lately", 24, "color:var(--sub)", a, 3) : null, E("div", "", "height:12px;flex:none")].concat(V.quotes.slice(0, n).map(function (x, i) { return quoteRow(x, a, true, i === 0); })));
  };

  // Commute: the usual drive between the two places kept on this TV (Home settings: Location, and
  // couch-tv Studio, Commute), by road from OpenStreetMap through OSRM (widget-web.js); no live
  // traffic. The design only says when to arrive (opts.arrive_h, arrive_m), the minutes to spare and
  // its label: never a place.
  function commuteOf(root, o, b, env) {
    var q = op(o), c = dataOf(env).commute || {}, v;
    if (env.demo) { v = { minutes: 16, km: 12.4 }; c = { to: { name: "work" } }; }
    else {
      if (!c.from) { webEmpty(root, b, "location", "Set your town for the commute", "Settings (hold OK), Home settings, Location", "Set your town"); root.setAttribute("data-setup", "commute"); return null; }
      if (!c.to) { webEmpty(root, b, "location", "Set where you drive to", "Settings (hold OK), Home settings, couch-tv Studio, Commute", "Set where to"); root.setAttribute("data-setup", "commute"); return null; }
      var rec = webOf(env, "commute", c.key);
      if (rec && !rec.ok && rec.err === "empty") { webEmpty(root, b, "location", "No road route between these places", "Check Commute in Home settings", "No route"); return null; }
      if (!webReady(root, b, "location", "commute", rec)) return null;
      v = rec.v;
    }
    // in couch-tv Studio a design with no arrive by time shows 8:30 as its example
    var WW = window.CouchWidgetWeb, spare = q.buffer === undefined ? 10 : q.buffer, ah = q.arrive_h !== undefined ? q.arrive_h : env.demo ? 8 : undefined, am = q.arrive_h !== undefined ? q.arrive_m || 0 : 30;
    var lb = WW && ah !== undefined ? WW.leaveBy(v.minutes, ah, am, spare, now().getTime(), q.weekdays) : null;
    var arrive = ah !== undefined ? fmt12(new Date(2000, 0, 1, ah, am)) : "";
    return { minutes: v.minutes, km: v.km, label: q.label || "To " + (c.to.name || "work"), leave: lb ? (lb.day ? lb.day + ", leave by " : "Leave by ") + fmt12(lb.at) : "", arrive: arrive, stale: !env.demo && !!(webOf(env, "commute", c.key) || {}).stale };
  }
  function line(text, size, extra, a, drop) { var e = fitT(E("div", "", WRAP + "font-size:" + size + "px;line-height:1.22;flex:none;text-align:" + a + ";" + (extra || ""), [text])); return drop ? dropT(e, drop) : e; }
  R.commute = function (root, o, b, env) {
    var V = commuteOf(root, o, b, env), a = alignOf(o);
    if (!V) return;
    var wide = b.w >= 700, big = clamp(b.h / 4, 64, 96);
    webBody(root, a, [webHead("location", V.label, a),
      E("div", "cw-row", "justify-content:" + jc(a) + ";align-items:baseline;flex-wrap:wrap;margin-top:8px;flex:none", [fitT(E("span", "cw-big", "font-size:" + px(big) + ";line-height:1", [String(V.minutes)]), 40), E("span", "cw-t29", "margin-left:12px", ["min"]),
        wide ? E("span", "cw-t25", "margin-left:24px;color:var(--sub)", [V.km + " km by road"]) : null]),
      line(V.stale ? "Not updated lately" : "The usual drive, no live traffic", 24, "color:var(--sub);margin-top:6px", a, 3),
      line(V.leave ? V.leave + (V.arrive ? " for " + V.arrive : "") : "Set an arrive by time in couch-tv Studio", 25, "font-weight:680;margin-top:12px", a)]);
  };

  // guests and the room
  // the guest from the bookings calendar this TV reads (At home, Guests), for a Welcome widget whose
  // design says the name comes from the calendar. The name and the times never come from the design.
  function stayOf(env) {
    if (env.demo) { var t0 = now(), d0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 2, 10).getTime(); return { set: true, view: { phase: "during", guest: "Sarah", checkout: d0 } }; }
    return (athome(env) || {}).stay || null;
  }
  // "Check out Sunday at 10am", "Check in from 3pm", "Check out today at 10am"
  function stayLine(v, env) {
    var t = now(), today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var dayWord = function (ms) { var d = new Date(ms).setHours(0, 0, 0, 0); return d === today ? "today" : d === today + 86400000 ? "tomorrow" : DAYS[new Date(ms).getDay()]; };
    if (v.phase === "arrival" || v.phase === "before") return "Check in " + (v.phase === "before" ? "tomorrow " : "") + "from " + hhmm(v.checkin, env);
    if (v.phase === "during" || v.phase === "lastday") return "Check out " + dayWord(v.checkout) + " at " + hhmm(v.checkout, env);
    return "";
  }
  function withName(text, name) {
    if (!name) return text;
    var lines = text.split("\n"), m = /^(.*?)([.!]*)$/.exec(lines[0]);
    lines[0] = m[1] + ", " + name + m[2];
    return lines.join("\n");
  }
  // couch-tv Studio's sample words in its starter designs (app/templates.js): on a real TV they are a
  // stranger's name and a made up house, so they never show there. The greeting stays.
  var WELCOME_SAMPLE = { "Welcome, Ella and friends": "Welcome", "Hi Ruby!": "Hi!" };
  var WELCOME_SAMPLE_LINES = ["Headland House, North Point", "Tuesday to Sunday. Night two of five", "Three sleeps till the beach"];
  function realTv(env) { return !!env && !env.demo && !env.designer && !env.preview; }
  // the greeting with the name taken off: "Welcome, Smith family" -> "Welcome", "Hi Ruby!" stays
  function greetingOf(text) { var lines = text.split("\n"), i = lines[0].indexOf(", "); if (i > 0) lines[0] = lines[0].slice(0, i) + (/[.!]+$/.exec(lines[0]) || [""])[0]; return lines.join("\n"); }
  R.welcome = function (root, o, b, env) {
    var q = op(o), align = q.align || "center", text = q.text || "Welcome";
    // on a TV: never the starter design's sample words; the guest's name typed on the TV or the phone
    // remote (At home, Guests) goes after the greeting
    var real = realTv(env), typed = real ? String((athome(env) || {}).guest || "") : "";
    if (real) {
      var q1 = {}, k1;
      for (k1 in q) if (Object.prototype.hasOwnProperty.call(q, k1)) q1[k1] = q[k1];
      if (Object.prototype.hasOwnProperty.call(WELCOME_SAMPLE, text)) text = WELCOME_SAMPLE[text];
      if (WELCOME_SAMPLE_LINES.indexOf(q1.kicker) >= 0) delete q1.kicker;
      if (WELCOME_SAMPLE_LINES.indexOf(q1.sub) >= 0) delete q1.sub;
      q = q1;
      if (typed && q.source !== "calendar") text = withName(greetingOf(text), typed);
    }
    if (q.source === "calendar") {
      var st = stayOf(env || {});
      if ((!st || !st.set) && typed) text = withName(greetingOf(text), typed);
      else if (!st || !st.set) return empty(root, b, "calendar", b.w < 300 ? "Add bookings" : "Add your bookings calendar", "Settings (hold OK), Home settings, couch-tv Studio, At home");
      var v = st && st.view;
      if (v && v.phase !== "between") {
        text = withName(text, v.guest || typed);
        if (q.times !== false) { var sl = stayLine(v, env || {}); if (sl) { var q2 = {}; for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) q2[k] = q[k]; q2.sub = sl; q = q2; } }
      }
    }
    var lines = text.split("\n").length, fs = clamp(Math.min((b.h - (q.kicker ? 50 : 0) - (q.sub ? 50 : 0)) / (1.08 * lines), b.w / (Math.max(8, Math.max.apply(null, text.split("\n").map(function (l) { return l.length; }))) * 0.6)), 30, 120);
    var bare = root.classList.contains("cw-bare"), sh = bare ? ";text-shadow:0 3px 24px rgba(0,0,0,.28)" : "";
    add(root, E("div", "cw-col", "height:100%;justify-content:center;text-align:" + align + ";align-items:" + (align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"), [
      q.kicker ? E("div", "", "font-size:23px;font-weight:720;letter-spacing:.14em;text-transform:uppercase;opacity:.86;margin-bottom:12px" + sh, [q.kicker]) : null,
      E("div", "", "font-size:" + px(fs) + ";font-weight:740;line-height:1.04;letter-spacing:-.025em;white-space:pre-line;color:var(--ink)" + sh, [text]),
      q.sub ? ((o.style || {}).accent ? E("div", "", "margin-top:16px;display:inline-block;padding:10px 24px;border-radius:30px;background:#fff;font-size:32px;font-weight:760;color:" + o.style.accent, [q.sub]) : E("div", "cw-t29", "margin-top:14px;font-weight:650;color:var(--sub)" + sh, [q.sub])) : null]));
  };
  var QNAMES = { sleep: ["sleep-timer", "Sleep timer"], picture: ["picture", "Picture"], look: ["picture", "Look"], soundscape: ["rain", "Soundscape"], screen_off: ["power", "Screen off"],
    headphones: ["headphones", "Headphones"], input: ["input", "Input"], bluetooth: ["bluetooth", "Bluetooth"], network: ["wifi", "Network"], tvsettings: ["settings", "TV settings"], screensaver: ["picture", "Screensaver"] };
  R.quick = function (root, o, b, env) {
    var q = op(o), ids = q.quick && q.quick.length ? q.quick : (!env.demo && dataOf(env).quick && dataOf(env).quick.length ? dataOf(env).quick : ["sleep", "picture", "input"]);
    var s = clamp(b.h, 60, 96), gap = 24, n = Math.max(1, Math.min(ids.length, Math.floor((b.w + gap) / (s + gap))));
    add(root, E("div", "cw-row", "height:100%;justify-content:" + (q.align === "left" ? "flex-start" : q.align === "right" ? "flex-end" : "center"), ids.slice(0, n).map(function (id, i) {
      var nm = QNAMES[id] || ["settings", id];
      var bt = E("div", "", "width:" + px(s) + ";height:" + px(s) + ";border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:var(--panel);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);box-shadow:inset 0 0 0 1.5px var(--rim);" + (i ? "margin-left:" + gap + "px" : ""), [ic(nm[0], s * 0.44, "#fff")]);
      return stop(bt, "quick", id, nm[1]);
    })));
  };

  // ---------------- the small sizes (widget-caps.js sizes): a tile 2 x 2 and a wide tile 4 x 2 ----------------
  // CR[kind] draws a box under 200 px tall; kinds without one draw their own small layout in R.
  // `mini` is the shared shape: on a tile an icon over one big value and its name; on a wide tile
  // the name and a line beside the value. Never under 23 px words.
  var CR = {};
  function fitPx(text, w, max) { return clamp(Math.min(max, w / (Math.max(2, String(text).length) * 0.6)), 30, max); }
  function mini(root, b, iconName, value, label, sub, vcol) {
    if (b.w < 300) {
      // a tile: the icon, the value and its label as one group in the middle (never pushed to the bottom)
      root.style.padding = "18px"; root.style.justifyContent = "center";
      add(root, [iconName ? ic(iconName, 32, "currentColor") : null,
        E("div", "cw-big", "margin-top:" + (iconName ? 6 : 0) + "px;white-space:nowrap;font-size:" + px(fitPx(value, b.w - 36, 54)) + (vcol ? ";color:" + vcol : ""), [value]),
        label ? E("div", "cw-t23 cw-ell", "font-weight:650;color:var(--ink);margin-top:2px", [label]) : null]);
      return;
    }
    add(root, E("div", "cw-row", "height:100%", [E("div", "cw-col", "flex:0 1 auto;min-width:0", [label ? lab(iconName, label) : null, sub ? E("div", "cw-t25 cw-ell", "color:var(--ink);font-weight:620;margin-top:8px", [sub]) : null]),
      E("div", "cw-big", "white-space:nowrap;margin-left:16px;font-size:" + px(fitPx(value, (b.w - 48) * 0.4, 72)) + (vcol ? ";color:" + vcol : ""), [value])]));
  }
  // a kind couch-tv cannot fill yet: the setup card on a TV, the sample in couch-tv Studio
  function sample(kind, iconName, fn) { return function (root, o, b, env, sh) { if (!env.demo) return soon(root, b, iconName, kind); return fn(root, o, b, env, sh); }; }
  CR.wordclock = function (root, o, b) {
    var tl = timeWords(now()).split("\n"), longest = Math.max.apply(null, tl.map(function (l) { return l.length; }));
    var fs = clamp(Math.min((b.w - 48) / (longest * 0.56), (b.h - 48) / (tl.length * 1.08)), 26, 70);
    var w = E("div", "", "font-size:" + px(fs) + ";font-weight:780;line-height:1.04;letter-spacing:-.02em;white-space:pre-line", [timeWords(now())]);
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [w]));
    live(root, 15000, function () { w.textContent = timeWords(now()); });
  };
  CR.solar = CR.sun = function (root, o, b, env) {
    var s = sunToday(env);
    if (!s) return empty(root, b, "sun", "Set your town for the sun", "");
    if (b.w < 300) return mini(root, b, "sun", (s.frac > 0.5 ? s.set : s.rise).replace(/[ap]m$/, ""), s.frac > 0.5 ? "Sunset" : "Sunrise");
    var col = function (word, t) { return E("div", "cw-col", "", [E("div", "cw-t23", "", [word]), E("div", "cw-t29", "font-weight:700", [t])]); };
    add(root, E("div", "cw-row", "height:100%;justify-content:space-around", [ic("sun", 48, "#ffd60a", "solid"), col("Sunrise", s.rise), col("Sunset", s.set)]));
  };
  CR.worldclock = function (root, o, b, env) {
    var cities = (op(o).cities && op(o).cities.length ? op(o).cities : ["Europe/London", "America/New_York"]);
    var name = function (tz) { return CITY[tz] || tz.split("/").pop().replace(/_/g, " "); };
    if (b.w < 300) { var t = tzTime(cities[0]); return mini(root, b, null, t ? t.t.replace(/[ap]m$/, "") : "", name(cities[0])); }
    add(root, E("div", "cw-col", "height:100%;justify-content:space-around", cities.slice(0, 2).map(function (tz) {
      var t = tzTime(tz);
      return E("div", "cw-row cw-sp", "", [E("div", "cw-t29 cw-ell", "font-weight:650;min-width:0", [name(tz)]), E("div", "cw-t38", "margin-left:12px", [t ? t.t : ""])]);
    })));
    void env;
  };
  CR.month = function (root, o, b) {
    var d = now();
    root.style.padding = "18px";
    add(root, E("div", "cw-col cw-center", "height:100%", [E("div", "cw-t23", "font-weight:750;color:#ff453a;text-transform:uppercase;letter-spacing:.06em", [DAYS[d.getDay()].slice(0, 3)]),
      E("div", "cw-big", "font-size:" + px(b.w < 300 ? 76 : 96), [String(d.getDate())])]));
  };
  CR.weather = function (root, o, b, env, sh) {
    if (b.w < 300) return R.weather(root, o, b, env, sh);
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    add(root, E("div", "cw-row", "height:100%", [ic(wxIcon(w.code, w.is_day), 48, rgba(sh.ink, 1), "solid"), E("div", "cw-col", "flex:1;min-width:0;margin-left:14px", [E("div", "cw-t29 cw-ell", "font-weight:680", [w.place || "Here"]),
      E("div", "cw-t23 cw-ell", "color:var(--ink)", [w.ahead ? w.ahead.label + ", " + w.ahead.hi + "°" : wxWords(w.code) + (w.hi !== undefined ? ", " + w.hi + "°" : "")])]), E("div", "cw-big", "font-size:72px;margin-left:10px", [w.temp + "°"])]));
  };
  CR.hourly = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.hourly) return empty(root, b, "clock", "The hourly forecast is on its way", "");
    var n = clamp(Math.floor((b.w - 48) / 76), 2, 5), ink = rgba(sh.ink, 1);
    add(root, E("div", "cw-row cw-sp", "height:100%", w.hourly.slice(0, n).map(function (h) {
      return E("div", "cw-col", "align-items:center", [E("div", "cw-t23", "color:var(--ink)", [h[0]]), E("div", "", "margin:4px 0", [ic(wxIcon(h[1], !h[3]), 34, ink, "solid")]), E("div", "", "font-size:27px;font-weight:650", [h[2] + "°"])]);
    })));
  };
  CR.week = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.daily) return empty(root, b, "calendar", "The week's forecast is on its way", "");
    var n = clamp(Math.floor((b.w - 48) / 96), 2, 4), ink = rgba(sh.ink, 1);
    add(root, E("div", "cw-row cw-sp", "height:100%", w.daily.slice(0, n).map(function (d) {
      return E("div", "cw-col", "align-items:center", [E("div", "cw-t23", "color:var(--ink);font-weight:650", [d[0]]), E("div", "", "margin:4px 0", [ic(wxIcon(d[1], true), 32, ink, "solid")]), E("div", "", "font-size:25px;font-weight:650", [d[3] + "°", E("span", "", "opacity:.6", [" " + d[2] + "°"])])]);
    })));
  };
  CR.rain = function (root, o, b, env) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.rain) return empty(root, b, "rain", "Rain soon is on its way", "");
    var heavy = (w.rainMax || 3) >= 2.5;
    add(root, [E("div", "cw-t29 cw-ell", "font-weight:700", [w.rainFrom ? (heavy ? "Heavy rain from " : "Rain from ") + w.rainFrom : "No rain coming"]),
      E("div", "cw-grow cw-row", "align-items:flex-end;margin-top:10px", w.rain.map(function (v) { return E("i", "", "display:block;flex:1;margin:0 3px;height:" + v + "%;border-radius:5px;background:#64d2ff"); }))]);
  };
  CR.uv = function (root, o, b, env) {
    var w = weather(env);
    if (!w || w.uv === undefined) return w ? empty(root, b, "sun", "UV is on its way", "") : noWx(root, b, env);
    var band = w.uv < 3 ? "Low" : w.uv < 6 ? "Moderate" : w.uv < 8 ? "High" : w.uv < 11 ? "Very high" : "Extreme";
    if (b.w < 300) return mini(root, b, "sun", String(w.uv), band);
    mini(root, b, "sun", String(w.uv), "UV index", band + (w.uvFrom ? ", " + w.uvFrom + " to " + w.uvTo : ""));
  };
  CR.moon = function (root, o, b) {
    var m = moon(now()), r = 44, f = m.f, waxing = f < 0.5, k = Math.cos(f * 2 * Math.PI), ex = Math.abs(k) * r;
    var lit = S("path", { d: "M50 6 A44 44 0 0 " + (waxing ? 1 : 0) + " 50 94 A" + ex + " 44 0 0 " + ((waxing ? k > 0 : k < 0) ? 0 : 1) + " 50 6Z", fill: "#f2efe6" });
    if (b.w < 300) {
      // a tile: the moon, and its name under it
      root.style.padding = "16px";
      add(root, E("div", "cw-col", "height:100%;align-items:center;justify-content:space-between", [svg("0 0 100 100", 78, 78, [S("circle", { cx: 50, cy: 50, r: r, fill: "#2a2a30" }), lit]),
        E("div", "cw-t23 cw-ell", "font-weight:680;color:var(--ink);max-width:100%", [m.name.replace(/^Waxing |^Waning /, "")])]));
      return;
    }
    add(root, E("div", "cw-row", "height:100%", [svg("0 0 100 100", b.h - 48, b.h - 48, [S("circle", { cx: 50, cy: 50, r: r, fill: "#2a2a30" }), lit]),
      E("div", "cw-col", "margin-left:20px;min-width:0", [E("div", "cw-t29 cw-ell", "font-weight:680", [m.name]), E("div", "cw-t23 cw-ell", "", [m.full])])]));
  };
  CR.bins = function (root, o, b, env) {
    var q = op(o), d = now(), wd = q.weekday === undefined ? 3 : q.weekday, ahead = (wd - d.getDay() + 7) % 7;
    if (!env.demo && q.weekday === undefined) return empty(root, b, "calendar", "Set your bin night in couch-tv Studio", "");
    var when = ahead === 0 ? "Tonight" : ahead === 1 ? "Tomorrow" : DAYS[wd].slice(0, 3) + " night";
    var night = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ahead), week = Math.floor((night.getTime() / 86400000 - (q.anchor || 0)) / 7);
    var A = q.lid_a || "#ffd60a", B = q.lid_b || "#30d158", lids = q.alt ? ["#ff453a", week % 2 === 0 ? A : B] : [A, B];
    var bin = function (c) { return svg("0 0 62 72", 40, 46, [S("rect", { x: 6, y: 14, width: 50, height: 56, rx: 8, fill: "#3a3a40" }), S("rect", { x: 2, y: 6, width: 58, height: 12, rx: 5, fill: c })], "margin-left:8px"); };
    if (b.w < 300) { root.style.padding = "18px"; add(root, [E("div", "cw-t23", "font-weight:700;color:var(--sub)", [op(o).label || "Bins"]), E("div", "cw-grow"), E("div", "cw-row", "margin-left:-8px", lids.map(bin)), E("div", "cw-t25 cw-ell", "font-weight:720;color:var(--ink);margin-top:6px", [when])]); return; }
    add(root, E("div", "cw-row cw-sp", "height:100%", [E("div", "cw-col", "min-width:0", [lab("calendar", op(o).label || "Bin night"), E("div", "cw-t29", "font-weight:720;margin-top:6px", [when])]), E("div", "cw-row", "", lids.map(bin))]));
  };
  CR.word = function (root, o, b) {
    var words = (window.CouchWords || {}).words || [["Petrichor", "noun", "The smell of rain on dry ground."]], w = words[dayOfYear() % words.length];
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [E("div", "cw-t48 cw-ell", "font-size:" + px(clamp((b.w - 48) / (w[0].length * 0.6), 30, 56)), [w[0]]), E("div", "cw-t25 cw-ell", "font-style:italic;margin-top:4px", [w[1] + (b.w >= 600 ? ". " + w[2] : "")])]));
  };
  CR.battery = function (root, o, b, env) {
    var bt = batteriesOf(env), x = bt && bt.devices && bt.devices[0];
    if (!bt) return empty(root, b, "bolt", "Needs an Android TV", "");
    if (bt.need === "permission") return soon(root, b, "bolt", "battery");
    if (!x) return empty(root, b, "bolt", "No charge to show", "");
    mini(root, b, BAT_ICON[x.kind] || "bluetooth", x.level + "%", x.name, x.level < 20 ? "Charge it soon" : "Lowest charge", x.level < 20 ? "#ff453a" : "#30d158");
  };
  // the web widgets at a tile and a wide tile: centred unless the design says, nothing cut off
  // (a headline that would not fit whole gives way to a shorter one of the newest three)
  CR.news = function (root, o, b, env) {
    var N = newsOf(root, o, b, env), a = alignOf(o);
    if (!N) return;
    if (!N.items.length) return webEmpty(root, b, "info", WEB_WORDS.news[2], "", WEB_SHORT.news[2]);
    // two lines of words at about 12 px a letter: the newest headline of the first five that fits whole
    var room = Math.floor((b.w - 48) / 12) * 2, x = N.items.slice(0, 5).filter(function (h) { return h.title.length <= room; })[0] || N.items.slice(0, 5).sort(function (p, q) { return p.title.length - q.title.length; })[0];
    webBody(root, a, [line([N.name, agoOf(x.at)].filter(Boolean).join(" · "), 24, "color:#ff453a;font-weight:700", a, 2), line(x.title, 29, "font-weight:640;margin-top:4px", a)]);
  };
  CR.sports = function (root, o, b, env) {
    var V = scoresOf(root, o, b, env), a = alignOf(o);
    if (!V) return;
    var g = V.games[0];
    webBody(root, a, [teamRow(g.teams[0], g, 25), E("div", "", "height:4px;flex:none"), teamRow(g.teams[1], g, 25), dropT(statusLine(gameStatus(g, env), a), 2)]);
  };
  CR.stocks = function (root, o, b, env) {
    var V = stocksOf(root, o, b, env), a = alignOf(o), WW = window.CouchWidgetWeb;
    if (!V) return;
    var x = V.quotes[0];
    if (b.w < 300) {
      return webBody(root, a, [line(WW ? WW.change(x) || "0%" : "", 44, "font-weight:740;color:" + upDown(x.change), a), line(x.name, 25, "font-weight:650;margin-top:4px", a)]);
    }
    webBody(root, a, V.quotes.slice(0, 2).map(function (q, i) { return quoteRow(q, a, false, i === 0); }));
  };
  CR.commute = function (root, o, b, env) {
    var V = commuteOf(root, o, b, env), a = alignOf(o);
    if (!V) return;
    if (b.w < 300) return webBody(root, a, [E("div", "cw-row", "justify-content:" + jc(a) + ";flex:none", [ic("location", 30, "currentColor")]), line(V.minutes + " min", 44, "font-weight:740;margin-top:4px", a), V.label.length <= 10 ? line(V.label, 24, "font-weight:650;margin-top:2px", a, 2) : null]);
    webBody(root, a, [line(V.minutes + " min", 44, "font-weight:740", a), line(V.label, 25, "font-weight:650;margin-top:2px", a, 3), line(V.leave || "The usual drive, no live traffic", 24, "color:var(--sub);margin-top:2px", a, 2)]);
  };

  // ---------------- things typed at home (athome.js, through app.js): kept on this TV only ----------------
  // Note, List, Guest Wi-Fi, House guide, Agenda, On this day and Screen time. seagey, 18 Nov 2026:
  // each fits its box at every size (nothing cut off: long words wrap, a line that cannot fit ends in
  // "...", a block too tall ends in "..." on its last line) and its content is centred unless the design
  // picks left or right (opts.align).
  var FLEX = { left: "flex-start", center: "center", right: "flex-end" };
  function athome(env) { return dataOf(env).home || null; }
  function ahAlign(root, o) { var a = op(o).align === "left" || op(o).align === "right" ? op(o).align : "center"; root.classList.add("cw-ah"); root.setAttribute("data-align", a); return a; }
  // the content as one group, in the middle of the box (or to the side the design picks)
  function ahCol(a, kids, css) { return E("div", "cw-col cw-ahcol", "width:100%;height:100%;min-height:0;justify-content:center;align-items:" + FLEX[a] + ";text-align:" + a + ";" + (css || ""), kids); }
  function lines(n) { return "display:-webkit-box;-webkit-line-clamp:" + n + ";-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;"; }
  // one line of words that ends in "..." when it is too long, never cut
  function one1(cls, css, text) { return E("div", cls + " cw-ell", "max-width:100%;flex:none;" + (css || ""), [text]); }
  // the label: an icon and its words, as wide as they are (so it can sit in the middle)
  function ahLab(iconName, text, colour) {
    return E("div", "cw-lab", "max-width:100%;flex:none;" + (colour ? "color:" + colour : ""), [iconName ? ic(iconName, 30, colour || "currentColor") : null, E("span", "cw-ell", "flex:0 1 auto;min-width:0;margin-right:0", [text])]);
  }
  // ---- Agenda: today's events from the calendar link kept on the TV ----
  var EV_COL = ["#ff9f0a", "#30d158", "#64d2ff", "#bf5af2", "#ff453a", "#ffd60a"];
  function hhmm(ms, env) { var p = clockParts(new Date(ms), {}, env); return p.t + p.ap; }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  // the calendar's events for a day (0 today, 1 tomorrow), still to come when it is today
  function evDay(evs, k, env) {
    var t = now(), s = dayStart(t) + k * 86400000, e = s + 86400000;
    return (evs || []).filter(function (x) { return x.start < e && x.end > s && (k || x.allDay || x.end > t.getTime()); })
      .map(function (x, i) { return { title: x.title, when: x.allDay ? "All day" : hhmm(x.start, env), col: EV_COL[i % EV_COL.length], start: x.start, end: x.end, allDay: x.allDay }; });
  }
  function demoEvents() {
    var s = dayStart(now()), h = 3600000;
    return [["School drop off", 8.5, 9], ["Swimming lessons, Ruby", 16, 17], ["Bins out, recycling", 19, 19.25], ["Movie night", 19.5, 22]].map(function (x) { return { title: x[0], start: s + x[1] * h, end: s + x[2] * h, allDay: false }; });
  }
  function agendaOf(root, b, env) {
    if (env.demo) { var de = demoEvents(); return { today: de.map(function (x, i) { return { title: x.title, when: hhmm(x.start, env), col: EV_COL[i], start: x.start, end: x.end }; }), tomorrow: [] }; }
    var c = (athome(env) || {}).cal;
    if (!c || !c.set) { soon(root, b, "calendar", "agenda"); return null; }
    if (!c.events) { empty(root, b, "calendar", c.err ? (b.w < 300 ? "Calendar not read" : c.err) : (b.w < 300 ? "Reading..." : "Reading your calendar"), c.err ? "Settings (hold OK), Home settings, couch-tv Studio, At home" : ""); return null; }
    return { today: evDay(c.events, 0, env), tomorrow: evDay(c.events, 1, env) };
  }
  R.agenda = function (root, o, b, env) {
    var a = ahAlign(root, o), ag = agendaOf(root, b, env);
    if (!ag) return;
    var d = now(), list = ag.today.length ? ag.today : ag.tomorrow, nx = list[0], heading = ag.today.length ? op(o).label || "Today" : "Tomorrow", day = DAYS[d.getDay()].slice(0, 3).toUpperCase() + " " + d.getDate();
    if (b.h < 200) {
      // a tile or a wide tile: the day, what is next and when
      add(root, ahCol(a, [one1("cw-t23", "font-weight:750;color:#ff453a", b.w < 300 ? (ag.today.length || !nx ? day : "TOMORROW") : day + (ag.today.length || !nx ? "" : ", tomorrow")),
        one1("cw-t29", "font-weight:700;color:var(--ink);margin-top:4px", nx ? nx.title : "Nothing on"), one1("cw-t23", "", nx ? nx.when : "today or tomorrow")]));
      return;
    }
    if (b.w < 600 && b.h < 500) {
      // a square: the day and the date, then what is next
      add(root, ahCol(a, [one1("cw-t23", "font-weight:700;text-transform:uppercase;letter-spacing:.06em", DAYS[d.getDay()]), E("div", "cw-big", "flex:none;font-size:" + px(clamp(b.w / 3.4, 64, 110)), [String(d.getDate())]),
        one1("cw-t29", "font-weight:680;margin-top:16px", nx ? nx.title : "Nothing on"),
        one1("cw-t23", "", nx ? (ag.today.length ? "" : "Tomorrow, ") + nx.when + (ag.today.length > 1 ? ", then " + (ag.today.length - 1) + " more" : "") : "today or tomorrow")]));
      return;
    }
    var n = clamp(Math.floor((b.h - 48 - 50) / 72), 1, 8), more = list.length > n ? list.length - (n - 1) : 0, shown = more ? list.slice(0, n - 1) : list;
    add(root, ahCol(a, [ahLab("calendar", heading + (list.length ? " · " + list.length + (list.length === 1 ? " event" : " events") : "")),
      list.length ? E("div", "cw-col", "max-width:100%;margin-top:14px;flex:none;align-items:" + (a === "right" ? "flex-end" : "flex-start"), shown.map(function (e) {
        return E("div", "cw-ev", "max-width:100%;margin-top:14px", [E("i", "", "background:" + e.col), E("div", "cw-t29 cw-ell", "flex:0 1 auto;min-width:0", [e.title]), E("div", "cw-t25", "flex:none;margin-left:16px", [e.when])]);
      }).concat(more ? [one1("cw-t23", "margin-top:14px", "and " + more + " more")] : [])) : one1("cw-t29", "font-weight:680;margin-top:16px", "Nothing on today or tomorrow")]));
  };
  CR.agenda = R.agenda;

  // ---- Family note ----
  function noteOf(env) { var n = env.demo ? { text: "Dinner at 6. Feed Max!", from: "Mum" } : (athome(env) || {}).note; return n && n.text ? n : null; }
  R.note = function (root, o, b, env) {
    var a = ahAlign(root, o), n = noteOf(env);
    if (!n) return soon(root, b, "edit", "note");
    // the words as big as they fit (the quote's rule), wrapping, and "..." on the last line that fits
    var fromH = n.from && b.h >= 200 ? 40 : 0, room = Math.max(30, b.h - 48 - fromH), len = Math.max(8, n.text.length);
    var fs = clamp(Math.min(Math.sqrt((b.w - 48) * room / len / 1.7), room / 1.2, 64), 25, 64), max = Math.max(1, Math.floor(room / (fs * 1.18)));
    add(root, ahCol(a, [fromH ? one1("cw-t23", "font-weight:700;color:var(--sub)", "From " + n.from) : null,
      E("div", "", "flex:none;max-width:100%;font-size:" + px(fs) + ";font-weight:680;line-height:1.18;margin-top:" + (fromH ? 8 : 0) + "px;letter-spacing:-.01em;white-space:pre-line;" + lines(max), [n.text])]));
  };
  CR.note = R.note;

  // ---- List: the one whose name its label gives, else the first ----
  function listOf(o, env) {
    if (env.demo) {
      var todo = /to ?do|task|work/i.test(op(o).label || "");
      var items = todo ? [["Send the quote", 0], ["Call the plumber", 1], ["Book flights", 0], ["Renew the rego", 0], ["Back up the laptop", 0], ["Order printer ink", 1], ["Reply to Sam", 0], ["Pay the power bill", 0]]
        : [["Milk", 0], ["Bread", 1], ["Avocados", 0], ["Sunscreen", 0], ["Dog food", 0], ["Lemons", 1], ["Coffee", 0], ["Bin bags", 0]];
      return { at: 0, name: op(o).label || "Shopping", todo: todo, items: items.map(function (x) { return { t: x[0], done: !!x[1] }; }) };
    }
    var ls = (athome(env) || {}).lists || [], want = String(op(o).label || "").toLowerCase(), at = 0;
    if (!ls.length) return null;
    for (var i = 0; i < ls.length; i++) if (want && ls[i].name.toLowerCase() === want) { at = i; break; }
    return { at: at, name: ls[at].name, todo: /to ?do|task|work/i.test(ls[at].name), items: ls[at].items };
  }
  R.list = function (root, o, b, env) {
    var a = ahAlign(root, o), l = listOf(o, env);
    if (!l) return soon(root, b, "check", "list");
    // what is still to do first, then what is ticked
    var items = l.items.filter(function (x) { return !x.done; }).concat(l.items.filter(function (x) { return x.done; }));
    var left = items.filter(function (x) { return !x.done; }), lc = l.todo ? "#0a84ff" : root.classList.contains("cw-paper") ? "#1f9d55" : "#30d158", icon = op(o).icon || "check";
    var count = left.length ? left.length + (l.todo ? " to do" : " left") : l.items.length ? "All done" : "Nothing on it yet";
    if (b.h < 200) {
      add(root, ahCol(a, [ahLab(icon, l.name, lc), one1("cw-t29", "font-weight:700;color:var(--ink);margin-top:4px", count),
        left.length ? one1("cw-t23", "", left.slice(0, 4).map(function (x) { return x.t; }).join(", ")) : null]));
      return;
    }
    var n = clamp(Math.floor((b.h - 48 - 40) / 50), 1, 40), more = items.length > n ? items.length - (n - 1) : 0, shown = more ? items.slice(0, n - 1) : items;
    add(root, ahCol(a, [ahLab(icon, l.name + (items.length ? " · " + count : ""), lc),
      items.length ? E("div", "cw-col", "max-width:100%;flex:none;align-items:" + (a === "right" ? "flex-end" : "flex-start"), shown.map(function (x) {
        return E("div", "cw-li" + (x.done ? " done" : ""), "max-width:100%;margin-top:14px", [E("span", "bx"), E("span", "cw-ell", "flex:0 1 auto;min-width:0", [x.t])]);
      }).concat(more ? [one1("cw-t23", "margin-top:14px", "and " + more + " more")] : []))
        : E("div", "cw-col", "flex:none;max-width:100%;margin-top:14px;align-items:" + FLEX[a], [one1("cw-t29", "font-weight:680", "Nothing on this list"), one1("cw-t23", "margin-top:4px", "Add to it in Home settings")])]));
  };
  CR.list = R.list;

  // ---- Guest Wi-Fi: a real join code (qr.js, drawn here, the words never leave the TV), and the
  // name and password in words for anyone without a camera ----
  function wifiOf(env) { return env.demo ? { ssid: "salt-and-sun", pass: "summer-swell", sec: "WPA", qr: "WIFI:T:WPA;S:salt-and-sun;P:summer-swell;;" } : (athome(env) || {}).wifi; }
  function qrNode(text, size) {
    if (!text || !window.TVQR) return null;
    try { var s = window.TVQR.svg(text, size); s.style.cssText = "display:block;width:" + px(size) + ";height:" + px(size); return s; } catch (e) { return null; }
  }
  R.wifi = function (root, o, b, env) {
    var a = ahAlign(root, o), w = wifiOf(env);
    if (!w || !w.ssid) return soon(root, b, "wifi", "wifi");
    if (b.h < 200 || b.w < 200) { add(root, ahCol(a, [ahLab("wifi", "Guest Wi-Fi"), one1("cw-t29", "font-weight:700;color:var(--ink);margin-top:4px", w.ssid), one1("cw-t23", "", "OK shows the code")])); return; }
    var narrow = b.w < 600, qs = Math.max(80, narrow ? Math.min(b.h - 48 - 46, b.w - 48) : b.h - 48), code = qrNode(w.qr, qs - 24);
    var box = E("div", "", "width:" + px(qs) + ";height:" + px(qs) + ";border-radius:22px;background:#fff;padding:12px;flex:none;overflow:hidden", [code || E("div", "cw-t23", "color:#1d1b18;padding:8px;" + lines(4), ["The name and password are too long for a code"])]);
    if (narrow) { add(root, ahCol(a, [box, one1("cw-t25", "margin-top:10px;font-weight:650;color:var(--ink)", w.ssid)])); return; }
    var nopass = w.sec === "nopass" || !w.pass;
    add(root, E("div", "cw-row", "width:100%;height:100%;justify-content:" + FLEX[a], [box,
      E("div", "cw-col", "margin-left:30px;min-width:0;flex:0 1 auto;max-width:" + px(b.w - 48 - qs - 30), [ahLab("wifi", "Guest Wi-Fi"), one1("cw-t48", "margin-top:10px", w.ssid),
        one1("cw-t29 cw-dim", "margin-top:6px", nopass ? "No password" : "Password"), nopass ? null : one1("cw-t38", "", w.pass),
        one1("cw-t23", "margin-top:10px", "Point your phone camera at the code")])]));
  };
  CR.wifi = R.wifi;

  // ---- House guide: headings and their words, typed in Home settings ----
  var GUIDE_IC = [[/check ?out|leav/i, "clock"], [/wi-?fi|internet/i, "wifi"], [/around|near|beach|shop|cafe|eat|walk/i, "location"], [/bin|rubbish|recycl/i, "calendar"], [/tv|remote|netflix/i, "tv"]];
  function guideIcon(t) { for (var i = 0; i < GUIDE_IC.length; i++) if (GUIDE_IC[i][0].test(t)) return GUIDE_IC[i][1]; return "info"; }
  function guideOf(env) { return env.demo ? [{ title: "Check out", text: "Sunday by 10am. Leave the keys on the bench." }, { title: "Bins", text: "Red Tuesday night, yellow every second week." }, { title: "Around here", text: "The beach is a 5 minute walk down the lane." }] : (athome(env) || {}).guide || []; }
  R.guide = function (root, o, b, env) {
    var a = ahAlign(root, o), g = guideOf(env);
    if (!g.length) return soon(root, b, "info", "guide");
    if (b.h < 200) { add(root, ahCol(a, [ahLab("info", "House guide"), one1("cw-t29", "font-weight:700;color:var(--ink);margin-top:4px", g[0].title), g.length > 1 ? one1("cw-t23", "", g.slice(1).map(function (x) { return x.title; }).join(", ")) : null])); return; }
    var withText = b.h >= 500, rowH = withText ? 128 : 74, n = clamp(Math.floor((b.h - 48 + 16) / (rowH + 16)), 1, g.length);
    if (g.length > n && n * (rowH + 16) + 34 > b.h - 48 + 16) n = Math.max(1, n - 1);
    add(root, ahCol(a, g.slice(0, n).map(function (x, i) {
      return E("div", "cw-col", "width:100%;flex:none;padding:14px 20px;border-radius:24px;background:rgba(255,255,255,.12);overflow:hidden;align-items:" + FLEX[a] + ";" + (i ? "margin-top:16px" : ""), [
        ahLab(guideIcon(x.title), x.title), withText && x.text ? E("div", "cw-t23", "flex:none;max-width:100%;margin-top:4px;" + lines(2), [x.text]) : null]);
    }).concat(g.length > n ? [one1("cw-t23", "margin-top:12px", "and " + (g.length - n) + " more. OK opens the guide")] : [])));
  };
  CR.guide = R.guide;

  // ---- On this day: the household's own photos taken on this date in other years (athome.js reads
  // each photo's date). Nothing from today: it says so, never another day's photo ----
  function yearsAgo(n) { return n === 1 ? "A year ago" : n + " years ago"; }
  function memoryOf(root, b, env) {
    if (env.demo) return [{ src: demoImg("camp"), years: 2 }];
    var m = (athome(env) || {}).memory;
    // no photo to show: the words get the glass panel a picture would have covered
    if ((!m || !m.today || !m.today.length) && root.classList.contains("cw-photo")) { root.classList.remove("cw-photo"); root.classList.add("cw-glass"); if (!root.querySelector(".cw-bg")) root.insertBefore(E("div", "cw-bg"), root.firstChild); }
    if (!m || !m.photos) { soon(root, b, "picture", "memory"); return null; }
    if (!m.dated) { empty(root, b, "picture", b.w < 300 ? "No dates yet" : "Your photos have no dates yet", "Add them again in Home settings, Your photos"); return null; }
    if (!m.today || !m.today.length) { empty(root, b, "picture", b.w < 300 ? "None today" : "No photos from this day", m.dated === 1 ? "One of your photos has a date" : m.dated + " of your photos have dates"); return null; }
    return m.today;
  }
  R.memory = function (root, o, b, env) {
    var a = ahAlign(root, o), list = memoryOf(root, b, env);
    if (!list) return;
    var p = list[dayIndex(list.length, 20)], tiny = b.w < 300 || b.h < 200, img = photoLayer(p.src);
    var big = one1("cw-t48", "color:#fff;font-size:" + px(tiny ? 34 : b.h < 300 ? 38 : 48) + ";text-shadow:0 2px 18px rgba(0,0,0,.5)", tiny ? String(now().getFullYear() - p.years) : yearsAgo(p.years));
    add(root, [img, E("div", "cw-fill", "background:radial-gradient(ellipse at center,rgba(0,0,0,.5),rgba(0,0,0,.18) 70%)"),
      E("div", "cw-fill", "z-index:2;padding:18px;display:flex", [ahCol(a, [b.h >= 200 && b.w >= 300 ? one1("cw-t23", "color:rgba(255,255,255,.92);text-transform:uppercase;letter-spacing:.08em;font-weight:700;text-shadow:0 2px 12px rgba(0,0,0,.5)", "On this day") : null, big])])]);
    if (list.length > 1) live(root, 20000, function () { var q = list[dayIndex(list.length, 20)]; img.style.backgroundImage = cssImg(q.src); big.textContent = tiny ? String(now().getFullYear() - q.years) : yearsAgo(q.years); });
  };
  CR.memory = R.memory;

  // ---- Screen time today: the launcher's own count of time in apps, and the goal set on the TV ----
  function screenOf(root, b, env) {
    if (env.demo) return { ok: true, minutes: 95, goal: 120, apps: [{ name: "YouTube", minutes: 52 }, { name: "ABC iview", minutes: 31 }, { name: "Netflix", minutes: 12 }] };
    var h = athome(env), s = h && h.screen;
    if (!s || s.why === "off") { soon(root, b, "timer", "screentime"); return null; }
    if (s.why === "tv") { empty(root, b, "timer", b.w < 300 ? "Not on this TV" : "Screen time is not on this TV", "It needs a Google TV, Android TV or Fire TV"); return null; }
    if (s.why === "ontv") { empty(root, b, "timer", b.w < 300 ? "Needs a computer once" : "Screen time needs the couch-tv home app", "Put it on once from a computer with the free Setup app"); return null; }
    if (!s.ok) { empty(root, b, "timer", s.why === "access" ? (b.w < 300 ? "Allow it first" : "Allow screen time on this TV") : (b.w < 300 ? "Needs an update" : "Needs a newer couch-tv TV home"), s.why === "access" ? "Settings (hold OK), Home settings, couch-tv Studio, At home" : ""); return null; }
    return { ok: true, minutes: s.minutes || 0, goal: h.goal || 0, apps: s.apps || [] };
  }
  R.screentime = function (root, o, b, env) {
    var a = ahAlign(root, o), s = screenOf(root, b, env);
    if (!s) return;
    var CA = window.CouchAtHome, hm = CA ? CA.hm : function (m) { return m + "m"; }, gl = CA && s.goal ? CA.goalLine(s.minutes, s.goal) : "", total = hm(s.minutes);
    var apps = b.w >= 700 && b.h >= 200 ? s.apps.slice(0, Math.max(0, Math.floor((b.h - 48) / 52))) : [];
    // the total as big as fits the room it has (beside the apps, half the box)
    var appsW = Math.min(340, (b.w - 48) * 0.45), room = apps.length ? b.w - 48 - appsW - 40 : b.w - 48, fs = clamp(Math.min((b.h - 48 - (b.h < 200 ? 64 : 110)) / 0.92, room / (total.length * 0.6)), 24, 140);
    var main = ahCol(apps.length ? "center" : a, [b.h >= 200 || b.w >= 300 ? ahLab("timer", "Screen time") : ic("timer", 30, "currentColor"), E("div", "cw-big", "flex:none;max-width:100%;white-space:nowrap;font-size:" + px(fs) + ";margin-top:" + (b.h < 200 ? 2 : 12) + "px", [total]),
      one1(gl ? "cw-t25" : "cw-t23", "color:var(--ink);font-weight:650;margin-top:" + (b.h < 200 ? 0 : 8) + "px", gl || "In apps today"),
      s.goal && b.h >= 200 ? E("div", "cw-bar", "flex:none;width:100%;max-width:320px;margin-top:16px;height:14px;border-radius:7px;background:rgba(255,255,255,.25)", [E("b", "", "width:" + Math.round(clamp(s.minutes / s.goal, 0, 1) * 100) + "%;background:" + (s.minutes > s.goal ? "#ffd60a" : "#fff"))]) : null], apps.length ? "width:auto;max-width:" + px(room) + ";flex:0 1 auto" : "");
    if (!apps.length) { add(root, main); return; }
    // beside the apps: the two side by side, as one group in the middle (or to the side picked)
    add(root, E("div", "cw-row", "width:100%;height:100%;align-items:center;justify-content:" + FLEX[a], [main, E("div", "cw-col", "width:" + px(appsW) + ";flex:none;margin-left:40px;justify-content:center;min-width:0", apps.map(function (x, i) {
      return E("div", "cw-row cw-sp", i ? "margin-top:16px" : "", [E("span", "cw-t25 cw-ell", "color:var(--ink);font-weight:620;min-width:0", [x.name || x.package || ""]), E("span", "cw-t25", "flex:none;margin-left:14px;color:var(--ink)", [hm(x.minutes)])]);
    }))]));
  };
  CR.screentime = R.screentime;

  // ---------------- one widget, a stack, the API ----------------
  function one(o, b, env) {
    var sh = shell(o, b, env), root = sh.root, st = o.style || {};
    CTX = { icons: st.icons || (env.look && env.look.icons) || "line" };
    var draw = (b.h < 200 && CR[o.kind]) || R[o.kind];
    // seagey, 18 Nov 2026: "all icons etc are default centre align unless it's changed in the designer".
    // Words and icons sit in the middle unless the design sets opts.align (widgets.css .cw-mid); a
    // renderer that places something itself still does
    if (!op(o).align) root.classList.add("cw-mid");
    try { (draw || function (r) { empty(r, b, "info", "This widget needs a newer couch-tv", ""); })(root, o, b, env, sh); }
    catch (e) { empty(root, b, "info", "This widget could not be drawn", ""); }
    // a label's words in their own box, so a long one ends in "..." (centred or not) instead of being cut
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll(".cw-lab") : [], function (l) {
      [].slice.call(l.childNodes).forEach(function (t) { if (t.nodeType === 3 && t.textContent.trim()) { l.insertBefore(E("span", "cw-ell", "flex:0 1 auto;min-width:0;margin-right:0", [t.textContent]), t); l.removeChild(t); } });
    });
    root.__o = o;
    // a dock, row, folder or app tile: each app is numbered by its place, so Hold OK can change, move
    // or remove it (design.js); the Add app place is "add"
    if (APP_KINDS.indexOf(o.kind) >= 0) {
      root.setAttribute("data-apps", o.kind);
      var sl = 0;
      [].forEach.call(root.querySelectorAll("[data-act]"), function (n) { if (["app", "missing", "addapp"].indexOf(n.getAttribute("data-act")) >= 0) n.setAttribute("data-slot", n.getAttribute("data-act") === "addapp" ? "add" : String(sl++)); });
    }
    // OK on a widget (widget-detail.js): a widget with nothing real to show opens its setup record;
    // one with a detail layer opens that; one whose own buttons do things keeps them, and its
    // layer is in the Hold OK menu (data-detail)
    var D = window.CouchDetail, layer = D ? D.layerOf(o.kind) : null;
    if (root.getAttribute("data-empty")) {
      if (!root.getAttribute("data-setup")) root.setAttribute("data-setup", o.kind);
      [].forEach.call(root.querySelectorAll("[data-act]"), function (n) { n.removeAttribute("data-act"); });
      stop(root, "detail", "setup", (window.CouchWidgetCaps && window.CouchWidgetCaps.get(o.kind) || {}).name || o.kind);
    } else if (layer) {
      if (!root.getAttribute("data-detail")) root.setAttribute("data-detail", layer);
      if (!root.hasAttribute("data-act") && !root.querySelector("[data-act]")) stop(root, "detail", layer, (window.CouchWidgetCaps && window.CouchWidgetCaps.get(o.kind) || {}).name || o.kind);
    }
    // show when (EDITING.md 8): at night, in the day, only when there is something to show
    var hide = (st.show === "night" && !nightNow()) || (st.show === "day" && nightNow()) || (st.show === "live" && root.getAttribute("data-empty"));
    if (hide) { if (env.designer || env.preview) root.style.opacity = "0.35"; else root.style.visibility = "hidden"; root.setAttribute("data-hidden", "1"); }
    return root;
  }
  // Smart stack: one place, up to 10 widgets taking turns; focused it stops, Left and Right flick it
  var SMART = { morning: ["weather", "bigtemp", "hourly", "week", "date", "agenda", "rain", "uv"], evening: ["keep", "upnext", "keeprow", "nowplaying"], night: ["clock", "tallclock", "analog", "wordclock", "moon"] };
  function stackIndex(o, n) {
    var t = o.turn === undefined ? 20 : o.turn;
    if (t) return dayIndex(n, t);
    var h = now().getHours(), want = h >= 5 && h < 11 ? SMART.morning : h >= 18 && h < 22 ? SMART.evening : h >= 22 || h < 5 ? SMART.night : null;
    if (want) for (var i = 0; i < o.items.length; i++) if (want.indexOf(o.items[i].kind) >= 0) return i;
    return dayIndex(n, 20);
  }
  function stack(o, b, env) {
    var items = o.items || [], root = E("div", "cw cw-bare cw-stack", "width:" + px(b.w) + ";height:" + px(b.h) + ";position:relative");
    root.setAttribute("data-kind", "stack"); root.setAttribute("data-stack", String(items.length));
    var slots = items.map(function (it) { var s = E("div", "cw-slot", "", [one({ kind: it.kind, opts: it.opts, style: it.style, w: b.w, h: b.h }, b, env)]); return s; });
    // the designer can hold a stack on the item being edited (CW.stackAt[id]); on the TV it turns by time
    var held = env.designer && CW.stackAt && CW.stackAt[o.id] != null ? CW.stackAt[o.id] : null;
    var at = held != null ? held % Math.max(1, items.length) : stackIndex(o, items.length), manual = held != null ? 1e15 : 0;
    var dots = E("div", "cw-dots", "color:#fff", items.map(function () { return E("i"); }));
    var show = function (i) {
      at = (i + items.length) % items.length;
      slots.forEach(function (s, k) { s.style.opacity = k === at ? "1" : "0"; s.style.visibility = k === at ? "visible" : "hidden"; s.className = "cw-slot" + (k === at ? " on" : ""); });
      for (var d = 0; d < dots.children.length; d++) dots.children[d].className = d === at ? "on" : "";
    };
    add(root, slots); if (items.length > 1) root.appendChild(dots);
    show(at);
    stop(root, "stack", "", "Stack");
    root.__flick = function (dx) { var ni = at + dx; if (ni < 0 || ni >= items.length) return false; manual = Date.now(); show(ni); return true; };
    root.__show = function (i) { if (env.designer) manual = 1e15; show(i); }; root.__at = function () { return at; };
    live(root, 1000, function () {
      if (root.classList.contains("cw-focus") || Date.now() - manual < 60000) return;
      var j = stackIndex(o, items.length);
      if (j !== at) show(j);
    });
    return root;
  }

  window.CouchWidgets = {
    config: CW,
    kinds: function () { return Object.keys(R); },
    // a widget drawn by its own file (ask.js: Ask AI and From your AI): draw(root, o, b, env), and
    // optionally its own drawing for a box under 200 px tall
    define: function (kind, draw, small) { if (typeof draw === "function" && /^[a-z]{2,16}$/.test(kind)) { R[kind] = draw; if (typeof small === "function") CR[kind] = small; } },
    render: function (o, env) {
      env = env || {};
      var b = { w: Math.max(40, +o.w || 360), h: Math.max(40, +o.h || 360) };
      return o.kind === "stack" ? stack(o, b, env) : one(o, b, env);
    },
    reset: function (layer) { REG = REG.filter(function (r) { return layer ? !layer.contains(r.el) : false; }); },
    flick: function (el, dx) { return el && el.__flick ? el.__flick(dx) : false; },
    // the designer: show stack item i on the canvas
    showStackItem: function (el, i) { if (el && el.__show) el.__show(i); },
    folderApps: function (o, env) { return appsFor(o, env, 12); },
    // editing apps on the TV (design.js, Hold OK): what a container holds now, as design keys (catalogue
    // ids, or packages of apps that are not in the catalogue), how many it takes, and what the TV has
    appKinds: function () { return APP_KINDS.slice(); },
    appMax: function (kind) { return APP_MAX[kind] || 0; },
    appKeys: function (o, env) {
      env = env || {};
      var A = cat(), l = appsFor(o, env, APP_MAX[o.kind] || 16);
      return l.keys.map(function (k) { return A && !A.get(k) ? A.idOf(k) || k : k; });
    },
    installedApps: function (env) { return installed(env || {}); },
    appNode: function (pkg, a, env, big) { return appNode(pkg, a, env || {}, big); },
    autoInk: function (hex) { var c = autoInk(rgbOf(hex)); return c === WHITE ? "#ffffff" : "#1d1b18"; },
    contrast: function (a, b) { return contrast(rgbOf(a) || WHITE, rgbOf(b) || WHITE); },
    tileColour: function (kind) { return TILE[kind] || null; },
    timeWords: timeWords, moon: moon, sunTimes: sunTimes, daysTo: daysTo,
    timer: Timer,
    // the building blocks and data readers the detail layers share (widget-detail.js)
    kit: { E: E, S: S, svg: svg, ic: ic, add: add, empty: empty, px: px, clamp: clamp, rgba: rgba, avatar: avatar, cssImg: cssImg, now: now, dataOf: dataOf,
      weather: weather, wxIcon: wxIcon, wxWords: wxWords, shows: shows, music: music, photos: photos, people: people,
      appNode: appNode, appsFor: appsFor, appName: appName, appIcon: appIcon, demoImg: demoImg, bgImg: bgImg,
      sunToday: sunToday, sunTimes: sunTimes, moon: moon, tzTime: tzTime, CITY: CITY, DAYS: DAYS, MONTHS: MONTHS, longDate: longDate, clockParts: clockParts,
      roomsOf: roomsOf, roomOn: roomOn, roomMode: roomMode, MODE_WORD: MODE_WORD, MODE_COL: MODE_COL, tdeg: tdeg, scenesOf: scenesOf,
      airOf: airOf, aqiBand: aqiBand, surfOf: surfOf, compass: compass, Timer: Timer, mmss: mmss, ring: ring, dial: dial, dayIndex: dayIndex, fmt12: fmt12,
      // things typed at home (athome.js through app.js)
      athome: athome, listOf: listOf, wifiOf: wifiOf, guideOf: guideOf, guideIcon: guideIcon, qrNode: qrNode, demoEvents: demoEvents, evDay: evDay, hhmm: hhmm, EV_COL: EV_COL, yearsAgo: yearsAgo }
  };
  // the smart home and music widgets' readers, for their detail layers (widget-detail.js)
  window.CouchWidgets.kit.ha = { haOf: haOf, controlsOf: controlsOf, ctlIcon: ctlIcon, ctlWord: ctlWord, speakersOf: speakersOf, spkWord: spkWord, spkSong: spkSong, sensorPick: sensorPick, sensorText: sensorText, spark: spark, hourBars: hourBars, kwh: kwh, ringWords: ringWords, queueOf: queueOf, coverOk: coverOk, stillWidth: stillWidth, SENSOR_ICON: SENSOR_ICON };
  // what the web widgets' detail layers share with them (widget-detail.js)
  window.CouchWidgets.webKit = { webOf: webOf, agoOf: agoOf, DEMO_NEWS: DEMO_NEWS, demoScores: demoScores, gameStatus: gameStatus, shortScore: shortScore, demoQuote: demoQuote, upDown: upDown, commuteOf: commuteOf, picksOf: picksOf };
})();
