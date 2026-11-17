// Widgets for a design (TV Designer v10, tools/tv-designer/widgets/CATALOGUE.md). design.js checks a
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

  // icons: the TV Designer's icon sets, drawn by icon-sets.js
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
  function dataOf(env) { return (env && env.data) || {}; }
  function demoImg(k) { return CW.base + "demo/" + k + ".jpg"; }
  function bgImg(k) { return CW.base + "backgrounds/" + k + ".jpg"; }
  function iconUrl(pkg, env) {
    var d = dataOf(env);
    if (!env.demo && d.iconUrl) { try { return d.iconUrl(pkg); } catch (e) { return null; } }
    if (d.iconUrl) { try { var u = d.iconUrl(pkg); if (u) return u; } catch (e2) {} }
    return APPS[pkg] ? CW.logoBase + pkg + ".png" : null;
  }
  function appName(pkg, env) {
    var list = dataOf(env).apps || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].package === pkg) return String(list[i].name || pkg);
    return APPS[pkg] || String(pkg).split(".").pop();
  }
  // the apps a widget shows: the ones it names that this TV has (in the designer, the ones it names)
  function appsFor(o, env, max) {
    var want = ((o.opts || {}).apps || []).slice(), d = dataOf(env), have = (d.apps || []).map(function (a) { return a.package; });
    var out;
    if (env.demo || env.designer) out = want.length ? want : (o.kind === "games" ? GAME_APPS : DEMO_APPS).slice();
    else if (want.length) out = want.filter(function (p) { return have.indexOf(p) >= 0; });
    else out = have.filter(function (p) { return p && p !== "gear" && p !== "more" && p !== "smart" && !/^(screen|input):/.test(p); });
    return out.slice(0, max || 16);
  }
  function appNode(pkg, a, env, big) {
    var name = appName(pkg, env), url = iconUrl(pkg, env);
    var n = E("div", "cw-app", "width:" + px(a) + ";height:" + px(a) + ";padding:" + px(a * 0.08) + ";border-radius:" + px(a * 0.24) + ";font-size:" + px(clamp(a * 0.17, 23, 40)), [name]);
    if (url && (env.imgOk ? (env.imgOk(url) || /^(https?:|\.\.\/|\/|demo\/|backgrounds\/)/.test(url)) : true)) {
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
    if (code === 2) return "partly-cloudy";
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
  function weather(env) {
    if (env.demo) { var hr = now().getHours(); DEMO_WX.is_day = hr >= 6 && hr < 19; return DEMO_WX; }
    var d = dataOf(env), w = d.weather;
    if (!w || w.temp === undefined || w.temp === null) return null;
    var out = { place: (d.place && d.place.name) || "", temp: Math.round(w.temp), code: w.code, is_day: w.is_day !== false, hi: w.hi, lo: w.lo, uv: w.uv, aqi: w.aqi };
    if (w.hourly && w.hourly.length) out.hourly = w.hourly.slice(0, 8).map(function (x, i) { return [hourLabel(new Date(x.time), i), x.code, Math.round(x.temp)]; });
    if (w.daily && w.daily.length) {
      out.daily = w.daily.slice(0, 7).map(function (x, i) { var dd = new Date(x.date + "T12:00:00"); return [i === 0 ? "Today" : DAYS[dd.getDay()].slice(0, 3), x.code, Math.round(x.lo), Math.round(x.hi)]; });
      out.sunrise = hm(w.daily[0].sunrise); out.sunset = hm(w.daily[0].sunset);
      if (out.hi === undefined) { out.hi = Math.round(w.daily[0].hi); out.lo = Math.round(w.daily[0].lo); }
      if (out.uv === undefined && w.daily[0].uv !== undefined) out.uv = Math.round(w.daily[0].uv);
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
    var tiny = b.h < 220 || b.w < 300;
    root.classList.add("cw-empty"); if (tiny) root.classList.add("cw-tiny");
    root.setAttribute("data-empty", "1");
    add(root, [ic(iconName || "info", tiny ? 34 : 46, "currentColor"), E("div", "cw-e1", "", [line]), sub && b.h >= 200 ? E("div", "cw-e2", "", [sub]) : null]);
    return root;
  }
  function soon(root, b, iconName, line) { return empty(root, b, iconName, line, "Coming to couch-tv's Home settings"); }
  function live(root, every, fn) { REG.push({ el: root, every: every, at: 0, fn: fn }); startTick(); }
  function startTick() {
    if (TICK) return;
    TICK = setInterval(function () {
      var t = Date.now();
      REG = REG.filter(function (r) { return r.el && r.el.parentNode && document.documentElement.contains(r.el); });
      REG.forEach(function (r) { if (t - r.at >= r.every) { r.at = t; try { r.fn(t); } catch (e) {} } });
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
    var align = op(o).align || "left", showAp = op(o).ampm !== false && p.ap && b.w >= 300;
    var fs = Math.min((b.h - (sub ? 60 : 0)) * 0.75, b.w / (p.t.length * 0.62 + (showAp ? 0.6 : 0)), 240);
    var tEl = E("span", "", "", [p.t]), aEl = showAp ? E("span", "", "font-size:" + px(Math.max(24, fs * 0.3)) + ";letter-spacing:0;margin-left:.12em;font-weight:600;opacity:.8", [p.ap]) : null;
    var big = E("div", "cw-big", "font-size:" + px(fs) + ";font-weight:640;text-align:" + align + (root.classList.contains("cw-bare") ? ";text-shadow:0 4px 30px rgba(0,0,0,.25)" : ""), [tEl, aEl]);
    var dEl = sub ? E("div", "cw-t29 cw-dim", "margin-top:" + px(Math.max(14, fs * 0.12)) + ";text-align:" + align + (root.classList.contains("cw-bare") ? ";text-shadow:0 2px 14px rgba(0,0,0,.3)" : ""), [shortD ? shortDate(now()) : longDate(now())]) : null;
    add(root, E("div", "cw-col cw-center", "height:100%;align-items:" + (align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center"), [big, dEl]));
    live(root, 1000, function () { var q = clockParts(now(), o, env); tEl.textContent = q.t; if (aEl) aEl.textContent = q.ap; if (dEl) dEl.textContent = shortD ? shortDate(now()) : longDate(now()); });
  };
  R.tallclock = function (root, o, b, env) {
    var p = clockParts(now(), o, env), fs = Math.min(b.h * 1.12, b.w / (p.t.length * 0.42));
    var tEl = E("div", "", "font-family:Antonio,'Arial Narrow',sans-serif;font-weight:300;font-size:" + px(fs) + ";line-height:.82;letter-spacing:-.02em;text-align:" + (op(o).align || "center") + ";text-shadow:0 6px 40px rgba(0,0,0,.25);white-space:nowrap", [p.t]);
    add(root, E("div", "cw-col", "height:100%;justify-content:center", [tEl]));
    live(root, 1000, function () { tEl.textContent = clockParts(now(), o, env).t; });
  };
  R.glassclock = function (root, o, b, env) {
    var p = clockParts(now(), o, env), fs = Math.min(b.h * 1.12, b.w / (p.t.length * 0.42)), sc = op(o).scene || (dataOf(env).scene) || "night";
    var tEl = E("div", "", "font-family:Antonio,'Arial Narrow',sans-serif;font-weight:300;font-size:" + px(fs) + ";line-height:.82;letter-spacing:-.02em;text-align:center;white-space:nowrap;" +
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
    var hgt = b.h - 48, cw = Math.min((b.w - 48 - 60) / 4, hgt * 0.72), cards = [];
    var card = function () { var t = E("span", "", "", ["0"]); var c = E("div", "", "position:relative;width:" + px(cw) + ";height:" + px(hgt) + ";border-radius:22px;background:#1f1f23;display:flex;align-items:center;justify-content:center;font-size:" + px(hgt * 0.78) + ";font-weight:700;letter-spacing:-.04em;color:#f2f2f2;box-shadow:inset 0 -3px 0 rgba(0,0,0,.4);margin:0 7px", [t, E("i", "", "position:absolute;left:0;right:0;top:50%;height:3px;background:#0b0b0d")]); cards.push(t); return c; };
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
    if (!s) return empty(root, b, "sun", "Set your town for the sun", "Home settings, Weather place");
    var at = arc(s.frac);
    add(root, [lab("sun", "Sun"),
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
    add(root, [lab("clock", "World clock"), E("div", "cw-col cw-grow", "justify-content:space-around;margin-top:10px", cities.map(function (tz) {
      var t = tzTime(tz);
      return E("div", "cw-row cw-sp", "", [E("div", "cw-t29", "", [name(tz)]), E("div", "cw-t38", "", [t ? t.t : ""])]);
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
    var big = b.h >= 160, fs = big ? clamp(b.h / 3.4, 34, 72) : clamp(b.h * 0.6, 26, 40), align = q.align || "left";
    var lines = [];
    if (show === "both" && w && b.h < 120) lines.push(dText + ". " + wText);
    else {
      if (show !== "weather") lines.push(dText);
      if (show !== "date" && w) lines.push(wText);
      if (show === "weather" && !w) lines.push("Weather coming");
    }
    var bare = root.classList.contains("cw-bare");
    add(root, E("div", "cw-col", "height:100%;justify-content:center;text-align:" + align + (bare ? ";text-shadow:0 2px 18px rgba(0,0,0,.35)" : ""), lines.map(function (l, i) {
      return E("div", i ? "cw-dim" : "", "font-size:" + px(i ? Math.max(24, fs * 0.66) : fs) + ";font-weight:" + (i ? 560 : 620) + ";letter-spacing:-.01em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" + (i ? ";margin-top:6px" : ""), [l]);
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
  R.timer = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "timer", "Start a timer from the phone remote");
    var s = Math.min(b.w, b.h) - 48;
    add(root, E("div", "cw-grow cw-row cw-center", "position:relative", [svg("0 0 100 100", s, s, [S("circle", { cx: 50, cy: 50, r: 44, fill: "none", stroke: "rgba(255,159,10,.22)", "stroke-width": 7 }),
      S("circle", { cx: 50, cy: 50, r: 44, fill: "none", stroke: "#ff9f0a", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": 276, "stroke-dashoffset": 276 * 0.38, transform: "rotate(-90 50 50)" })]),
      E("div", "", "position:absolute;text-align:center", [E("div", "", "font-size:" + px(clamp(s * 0.2, 30, 110)) + ";font-weight:650;letter-spacing:-.02em", ["11:08"]), E("div", "cw-t23", "", [op(o).label || "Pizza"])])]));
  };

  // weather
  function noWx(root, b, env) { return empty(root, b, "partly-cloudy", dataOf(env).wxOff ? "Weather is off on this TV" : "Waiting for the weather", dataOf(env).wxOff ? "Turn it on in Home settings" : "Set your town in Home settings"); }
  R.weather = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    var q = op(o), large = b.w > 300, tiny = b.h < 300;
    if (b.h < 200) {
      // a Tile: the temperature and the sky, nothing else
      add(root, [ic(wxIcon(w.code, w.is_day), 44, rgba(sh.ink, 1), "solid"), E("div", "cw-grow"), E("div", "cw-big", "font-size:64px", [w.temp + "°"])]);
      return;
    }
    add(root, [q.place === false ? null : E("div", "cw-t29 cw-ell", "font-weight:640", [w.place || "Here"]),
      E("div", "cw-big", "font-size:" + px(tiny ? 72 : large ? Math.min(124, b.h * 0.3) : 92) + ";margin-top:6px", [w.temp + "°"]), E("div", "cw-grow"),
      tiny ? null : ic(wxIcon(w.code, w.is_day), 40, rgba(sh.ink, 1), "solid"),
      E("div", "cw-t25 cw-ell", "color:var(--ink);font-weight:600;margin-top:6px", [wxWords(w.code)]),
      q.hilo === false || w.hi === undefined ? null : E("div", "cw-t23", "", ["H:" + w.hi + "° L:" + w.lo + "°"])]);
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
    var fs = Math.min(b.h * 0.52, b.w * 0.44);
    add(root, [E("div", "cw-row cw-sp", "", [o.opts && o.opts.place === false ? E("span") : E("div", "cw-t29 cw-ell", "font-weight:700", [w.place || "Here"]), ic(wxIcon(w.code, w.is_day), clamp(b.w / 6, 44, 80), rgba(sh.ink, 1), "solid")]),
      E("div", "cw-grow"), E("div", "cw-big", "font-size:" + px(fs) + ";letter-spacing:-.06em", [w.temp + "°"]),
      E("div", "cw-t29 cw-ell", "font-weight:680;margin-top:6px", [wxWords(w.code) + (w.hi !== undefined && b.w >= 400 ? ", top of " + w.hi + "°" : "")])]);
  };
  R.hourly = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.hourly) return empty(root, b, "clock", "The hourly forecast is on its way", "");
    var n = clamp(Math.floor((b.w - 48) / 110), 3, w.hourly.length), ink = rgba(sh.ink, 1);
    var next = w.hourly.slice(1).filter(function (h) { return h[1] >= 51; })[0];
    add(root, [E("div", "cw-row cw-sp", "", [E("div", "", "", [E("div", "cw-t29", "font-weight:640", [w.place || "Here"]), E("div", "cw-big", "font-size:72px;margin-top:4px", [w.temp + "°"])]),
      E("div", "", "text-align:right", [ic(wxIcon(w.code, w.is_day), 44, ink, "solid"), E("div", "cw-t25", "color:var(--ink);font-weight:600", [next ? wxWords(next[1]) + " from " + next[0] : wxWords(w.code)]), w.hi !== undefined ? E("div", "cw-t23", "", ["H:" + w.hi + "° L:" + w.lo + "°"]) : null])]),
      E("div", "cw-grow"),
      E("div", "cw-row cw-sp", "border-top:1.5px solid rgba(255,255,255,.25);padding-top:16px", w.hourly.slice(0, n).map(function (h) {
        return E("div", "cw-col", "align-items:center", [E("div", "cw-t23", "color:var(--ink)", [h[0]]), E("div", "", "margin:8px 0", [ic(wxIcon(h[1], true), 36, ink, "solid")]), E("div", "", "font-size:27px;font-weight:650", [h[2] + "°"])]);
      }))]);
  };
  R.week = function (root, o, b, env, sh) {
    var w = weather(env);
    if (!w) return noWx(root, b, env);
    if (!w.daily) return empty(root, b, "calendar", "The week's forecast is on its way", "");
    var rows = clamp(Math.floor((b.h - 170) / 62), 3, w.daily.length), ink = rgba(sh.ink, 1), lo = 99, hi = -99;
    w.daily.forEach(function (d) { lo = Math.min(lo, d[2]); hi = Math.max(hi, d[3]); });
    var span = Math.max(6, hi - lo);
    add(root, [E("div", "cw-row cw-sp", "", [E("div", "", "", [E("div", "cw-t29", "font-weight:640", [w.place || "Here"]), E("div", "cw-big", "font-size:76px;margin-top:4px", [w.temp + "°"])]), ic(wxIcon(w.code, w.is_day), 56, ink, "solid")]),
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
    add(root, [lab("rain", "Rain soon"), E("div", "cw-t38", "margin-top:10px", [w.rainFrom ? (heavy ? "Heavy rain from " : "Rain from ") + w.rainFrom : "No rain coming"]),
      E("div", "cw-grow cw-row", "align-items:flex-end;margin-top:14px", w.rain.map(function (v) { return E("i", "", "display:block;flex:1;margin:0 4px;height:" + v + "%;border-radius:6px;background:#64d2ff"); })),
      E("div", "cw-row cw-sp cw-t23", "margin-top:8px", [E("span", "", "", ["Now"]), E("span", "", "", ["+1h"]), E("span", "", "", ["+2h"]), E("span", "", "", ["+3h"])])]);
  };
  R.uv = function (root, o, b, env) {
    var w = weather(env);
    if (!w || w.uv === undefined) return w ? empty(root, b, "sun", "UV is on its way", "") : noWx(root, b, env);
    var band = w.uv < 3 ? "Low" : w.uv < 6 ? "Moderate" : w.uv < 8 ? "High" : w.uv < 11 ? "Very high" : "Extreme";
    add(root, [lab("sun", "UV index"), E("div", "cw-big", "font-size:" + px(b.h < 300 ? 64 : 96) + ";margin-top:8px", [String(w.uv)]), E("div", "cw-t29", "font-weight:680", [band]), E("div", "cw-grow"),
      E("div", "cw-bar", "background:linear-gradient(90deg,#34c759,#ffd60a,#ff9f0a,#ff3b30,#af52de);overflow:visible", [E("i", "", "position:absolute;left:" + clamp(w.uv / 12 * 100, 2, 96) + "%;top:-6px;width:20px;height:20px;border-radius:10px;background:#fff;border:3px solid #ff6a3d;display:block")]),
      b.h >= 300 && w.uvFrom ? E("div", "cw-t23", "color:var(--ink);margin-top:12px", ["Sun protection " + w.uvFrom + " to " + w.uvTo]) : null]);
  };
  R.sun = function (root, o, b, env) {
    var s = sunToday(env);
    if (!s) return empty(root, b, "sun", "Set your town for the sun", "Home settings, Weather place");
    var at = arc(s.frac);
    add(root, [lab("sun", "Sun"), svg("0 0 300 120", "100%", "100%", [S("path", { d: "M10 110 Q150 -40 290 110", fill: "none", stroke: "rgba(255,255,255,.3)", "stroke-width": 4, "stroke-dasharray": "2 10", "stroke-linecap": "round" }),
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
  R.air = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "wind", "Air quality is coming");
    add(root, [lab("wind", "Air quality"), E("div", "cw-big", "font-size:96px;margin-top:8px;color:#30d158", ["18"]), E("div", "cw-t29", "", ["Good"]), E("div", "cw-grow")]);
  };
  R.surf = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "wind", "Surf is coming to couch-tv");
    add(root, [E("div", "cw-row cw-sp", "", [lab("wind", op(o).label || "North Point", "rgba(255,255,255,.88)"), E("div", "cw-t23", "color:#fff", ["Wed 6am"])]),
      E("div", "cw-row", "margin-top:10px;align-items:flex-end", [E("div", "", "margin-right:28px", [E("div", "cw-big", "font-size:92px", ["1.4", E("span", "", "font-size:.4em", ["m"])]), E("div", "cw-t25", "color:#fff", ["SE swell, 11s"])]),
        b.w >= 460 ? E("div", "", "", [E("div", "cw-t38", "", ["Offshore"]), E("div", "cw-t25", "color:#fff", ["WSW 9 km/h"])]) : null]),
      E("div", "cw-grow"), svg("0 0 400 70", "100%", 70, [S("path", { d: "M0 50 C40 50 50 20 100 20 S160 55 200 55 S260 15 300 15 S360 45 400 45 V70 H0Z", fill: "rgba(255,255,255,.16)" }),
        S("path", { d: "M0 50 C40 50 50 20 100 20 S160 55 200 55 S260 15 300 15 S360 45 400 45", fill: "none", stroke: "#fff", "stroke-width": 4, opacity: 0.9 })], "flex:none"),
      E("div", "cw-row cw-sp cw-t23", "color:#fff", [E("span", "", "", ["High 9:12am"]), E("span", "", "", ["Low 3:31pm"])])]);
  };

  // photos
  function noPhotos(root, b) { return empty(root, b, "picture", "Add your photos on the TV", "Home settings, Your photos"); }
  function cssImg(u) { return 'url("' + String(u).replace(/["\\\n()]/g, encodeURIComponent) + '")'; }
  function photoLayer(u, fit) { return E("div", "cw-fill", "background-image:" + cssImg(u) + ";background-size:" + (fit === "contain" ? "contain;background-repeat:no-repeat" : "cover")); }
  function caption(root, q) {
    if (!q.caption) return;
    add(root, E("div", "", "position:absolute;left:0;right:0;bottom:0;padding:70px 28px 24px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.6));z-index:2", [E("div", "cw-t29", "font-weight:650;color:#fff", [q.caption]), q.sub ? E("div", "cw-t23", "color:rgba(255,255,255,.82)", [q.sub]) : null]));
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
  R.memory = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "picture", "On this day is coming");
    add(root, [photoLayer(demoImg("camp")), E("div", "cw-fill", "background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,.2) 55%,transparent 75%)"),
      E("div", "", "position:absolute;left:30px;top:26px;color:#fff;z-index:2", [E("div", "cw-t23", "color:rgba(255,255,255,.88);text-transform:uppercase;letter-spacing:.08em;font-weight:700", ["On this day"]), E("div", "cw-t48", "margin-top:4px;font-size:" + px(b.h < 300 ? 36 : 48), ["Two years ago"])])]);
  };

  // watching
  function noShows(root, b) { return empty(root, b, "tv", "Nothing to keep watching yet", "Shows you start on this TV show up here"); }
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
    if (!list.length) return noShows(root, b);
    list = list.slice(0, 5);
    root.classList.add("cw-photo");
    var at = dayIndex(list.length, 8), cards = list.map(function (s, i) { var c = showCard(s, b, env, i, list.length); c.removeAttribute("data-act"); c.style.opacity = i === at ? "1" : "0"; return c; });
    add(root, cards);
    var dots = E("div", "cw-hdots", "top:22px;left:auto;right:22px", []);
    list.forEach(function (s, i) { dots.appendChild(E("i", i === at ? "on" : "")); });
    if (list.length > 1) root.appendChild(dots);
    // the remote reaches every show: OK opens the one showing (the widget's own stop)
    stop(root, "show", at, list[at].title);
    root.setAttribute("data-turns", "1");
    live(root, 1000, function () {
      if (root.classList.contains("cw-focus")) return;   // stops turning while focused
      var j = dayIndex(list.length, 8);
      if (j === at) return;
      at = j; cards.forEach(function (c, i) { c.style.opacity = i === at ? "1" : "0"; });
      for (var d = 0; d < dots.children.length; d++) dots.children[d].className = d === at ? "on" : "";
      stop(root, "show", at, list[at].title);
    });
  };
  R.keeprow = function (root, o, b, env) {
    var list = shows(env);
    if (!list.length) return noShows(root, b);
    var q = op(o), labelH = q.label === "" || b.h < 220 ? 0 : 50, gap = 28, n = clamp(q.shows || Math.floor((b.w + gap) / 380), 1, Math.min(5, list.length)), cw = (b.w - (n - 1) * gap) / n;
    add(root, [labelH ? E("div", "cw-lab", "color:var(--ink);margin-bottom:16px;text-shadow:0 2px 12px rgba(0,0,0,.3)", [q.label || "Keep watching"]) : null,
      E("div", "cw-row", "flex:1;align-items:stretch;min-height:0", list.slice(0, n).map(function (s, i) {
        var p = E("div", "cw-poster", "width:" + px(cw) + ";flex:none;" + (i ? "margin-left:" + gap + "px;" : "") + (s.art ? "background-image:" + cssImg(s.art) : ""), [E("div", "cap", "", [
          E("div", "cw-row", "", [s.app ? appIcon(s.app, 34, env) : null, E("span", "cw-t29 cw-ell", "color:#fff;font-weight:700;margin-left:10px", [s.title])]),
          s.progress ? E("div", "cw-bar", "margin-top:12px", [E("b", "", "width:" + Math.round(s.progress * 100) + "%;background:#fff")]) : null])]);
        return stop(p, "show", i, s.title);
      }))]);
  };
  R.upnext = function (root, o, b, env) {
    var list = shows(env);
    if (!list.length) return noShows(root, b);
    var s = env.demo ? { title: "Bay of Fires", sub: "Season 1, episode 4. 52 min left", app: "au.com.stan.and", art: bgImg("vang-vieng-sunset") } : list[0];
    var fs = clamp(Math.min(b.h / 6.5, b.w / 12), 48, 110);
    var resume = stop(E("div", "cw-chip", "background:#fff;color:#111;height:64px;font-size:27px;padding:0 30px", [ic("play", 30, "#111", "solid"), "Resume"]), "show", 0, s.title);
    add(root, [E("div", "cw-fill", "background:#111 center/cover;" + (s.art ? "background-image:" + cssImg(s.art) : "")),
      E("div", "cw-fill", "background:linear-gradient(90deg,rgba(0,0,0,.85),rgba(0,0,0,.35) 55%,transparent 80%),linear-gradient(0deg,rgba(0,0,0,.6),transparent 50%)"),
      E("div", "", "position:absolute;left:44px;bottom:40px;max-width:60%;color:#fff", [
        E("div", "cw-row", "", [s.app ? appIcon(s.app, 44, env) : null, E("span", "cw-t25", "color:rgba(255,255,255,.88);font-weight:650;margin-left:12px", ["Up next"])]),
        E("div", "", "font-size:" + px(fs) + ";font-weight:780;letter-spacing:-.03em;line-height:.98;margin-top:16px", [s.title]),
        s.sub ? E("div", "cw-t29", "color:rgba(255,255,255,.86);margin-top:14px", [s.sub]) : null,
        b.h >= 420 ? E("div", "cw-row", "margin-top:26px", [resume, stop(E("div", "cw-chip", "height:64px;font-size:27px;padding:0 30px;margin-left:16px;background:rgba(255,255,255,.2)", ["Start over"]), "show", 0, s.title)]) : null])]);
    if (b.h < 420) stop(root, "show", 0, s.title);
  };
  R.picks = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "favourite", "Picks for you are coming");
    var arts = ["scene-dawn", "aresquiers-beach", "scene-fog", "scene-water", "vang-vieng-sunset", "albury-storm", "scene-golden"], names = ["Mystery Road", "Utopia", "The Newsreader", "Total Control", "Colin from Accounts", "Rake", "Wakefield"];
    var n = Math.max(1, Math.floor((b.w + 24) / 230));
    add(root, [E("div", "cw-lab", "color:var(--ink);margin-bottom:16px", ["Because you watched Fisk"]), E("div", "cw-row", "flex:1;align-items:stretch;min-height:0", arts.slice(0, n).map(function (a, i) {
      return E("div", "cw-poster", "flex:1;" + (i ? "margin-left:24px;" : "") + "background-image:" + cssImg(bgImg(a)), [E("div", "cap", "", [E("div", "cw-t25", "color:#fff;font-weight:700", [names[i]])])]);
    }))]);
  };

  // apps
  function noApps(root, b, named) { return empty(root, b, "apps", named ? "These apps are not on this TV" : "No apps yet", named ? "Install them, or pick others in TV Designer" : ""); }
  function appGrid(list, b, cols, env, top) {
    var rows = Math.ceil(list.length / cols), gap = clamp(Math.min(b.w, b.h) / 18, 14, 28);
    var a = Math.floor(Math.min((b.w - (cols - 1) * gap) / cols, (b.h - top - (rows - 1) * gap) / rows));
    var g = E("div", "cw-grow", "display:flex;flex-wrap:wrap;align-content:center;justify-content:center;margin:" + px(-gap / 2), list.map(function (p) { var n = appNode(p, a, env); n.style.margin = px(gap / 2); return n; }));
    return g;
  }
  R.app = function (root, o, b, env) {
    var list = appsFor(o, env, 1);
    if (!list.length) return noApps(root, b, (op(o).apps || []).length);
    var n = appNode(list[0], Math.min(b.w, b.h), env);
    n.style.borderRadius = px(Math.min(b.w, b.h) * 0.22);
    n.removeAttribute("data-act");
    add(root, n);
    stop(root, "app", list[0], appName(list[0], env));
  };
  R.folder = function (root, o, b, env) {
    var q = op(o), list = appsFor(o, env, 12);
    if (!list.length) return noApps(root, b, (q.apps || []).length);
    var label = q.label ? E("div", "cw-lab", "margin-bottom:12px", [q.label]) : null;
    if (b.w < 300 && b.h < 300) {
      // a Tile: four tiny icons, OK opens the folder full screen (like iOS)
      var mini = list.slice(0, 4), s = Math.floor((Math.min(b.w, b.h) - 48 - 12) / 2);
      add(root, E("div", "cw-grow", "display:flex;flex-wrap:wrap;align-content:center;justify-content:center", mini.map(function (p) { var n = appNode(p, s, env); n.removeAttribute("data-act"); n.style.margin = "3px"; n.style.fontSize = "0"; return n; })));
      stop(root, "folder", "", q.label || "Apps");
      return;
    }
    var cols = q.cols || clamp(Math.round(Math.sqrt(list.length * b.w / b.h)), 1, 6);
    add(root, [label, appGrid(list, b.w > 0 ? { w: b.w - 48, h: b.h - 48 } : b, cols, env, label ? 50 : 0)]);
  };
  R.dock = function (root, o, b, env) {
    var q = op(o), list = appsFor(o, env, 12);
    if (!list.length) return noApps(root, b, (q.apps || []).length);
    var a = Math.min(112, b.h - 40), gap = 30, cap = Math.max(1, Math.floor((b.w - 40 + gap) / (a + gap))), more = q.more !== false;
    var shown = list.slice(0, Math.max(1, cap - (more ? 1 : 0)));
    root.style.padding = "20px";
    var row = E("div", "cw-row cw-center", "height:100%", shown.map(function (p, i) { var n = appNode(p, a, env); if (i) n.style.marginLeft = px(gap); return n; }));
    if (more) row.appendChild(stop(E("div", "cw-app cw-more", "width:" + px(a) + ";height:" + px(a) + ";border-radius:" + px(a * 0.24) + ";margin-left:" + px(gap), [ic("more", a * 0.4, "#fff")]), "more", "", "All apps"));
    add(root, row);
  };
  R.appgrid = function (root, o, b, env) {
    var q = op(o), list = appsFor(o, env, 16);
    if (!list.length) return noApps(root, b, (q.apps || []).length);
    var cols = q.cols || clamp(Math.round(Math.sqrt(list.length * b.w / b.h)), 1, 8), rows = Math.ceil(list.length / cols), names = q.names !== false;
    var gx = 40, gy = 40, nameH = names ? 52 : 0, a = Math.floor(Math.min((b.w - cols * gx) / cols, (b.h - rows * gy - rows * nameH) / rows));
    add(root, E("div", "", "display:flex;flex-wrap:wrap;justify-content:center;align-content:center;height:100%", list.map(function (p, i) {
      var n = appNode(p, a, env);
      return E("div", "cw-col", "align-items:center;width:" + px(a) + ";margin:" + px(gy / 2) + " " + px(gx / 2), [n, names ? E("span", "cw-t25 cw-ell", "color:var(--ink);margin-top:12px;max-width:" + px(a + 30) + ";text-align:center;font-weight:650" + (root.classList.contains("cw-bare") ? ";text-shadow:0 2px 10px rgba(0,0,0,.3)" : ""), [appName(p, env)]) : null]);
    })));
  };
  var GAMES = { "com.microsoft.xcloud": ["#107c10", "#0b4f0b", "Xbox Cloud", "cloud", "Last played: Forza"], "com.nvidia.geforcenow": ["#76b900", "#3f6400", "GeForce NOW", "bolt", "Fortnite, 2h ago"],
    "com.valvesoftware.steamlink": ["#2a475e", "#13202c", "Steam Link", "tv", "From the study PC"], "com.retroarch": ["#e60012", "#7a0009", "RetroArch", "games", "Mario Kart 64"] };
  R.games = function (root, o, b, env) {
    var list = appsFor(o, env, 4);
    if (!list.length) return noApps(root, b, (op(o).apps || []).length);
    var n = clamp(Math.floor(b.w / 240), 2, list.length);
    add(root, [lab("games", "Play"), E("div", "cw-row cw-grow", "margin-top:16px;align-items:stretch", list.slice(0, n).map(function (p, i) {
      var g = GAMES[p] || ["#3a3a46", "#1d1d24", appName(p, env), "games"];
      var t = E("div", "cw-col", "flex:1;position:relative;overflow:hidden;border-radius:28px;background:linear-gradient(165deg," + g[0] + "," + g[1] + ");padding:24px;justify-content:space-between;" + (i ? "margin-left:20px" : ""), [
        ic(g[3], clamp(b.h / 5, 56, 96), "#fff", "solid"), E("div", "", "min-width:0", [E("div", "cw-t29 cw-ell", "color:#fff;font-weight:740", [g[2]]), env.demo && g[4] && b.h >= 400 ? E("div", "cw-t23 cw-ell", "color:rgba(255,255,255,.86)", [g[4]]) : null])]);
      return stop(t, "app", p, g[2]);
    }))]);
  };

  // music
  R.nowplaying = function (root, o, b, env) {
    var m = music(env);
    if (!m) return empty(root, b, "music", "Nothing playing", "Songs playing on this TV show up here");
    var wide = b.w > b.h * 1.4, s = wide ? b.h - 48 : Math.min(b.w - 48, b.h * 0.55), big = b.w > 900;
    var art = E("div", "", "width:" + px(s) + ";height:" + px(s) + ";border-radius:24px;background:#333 center/cover;flex:none;box-shadow:0 14px 40px rgba(0,0,0,.35);" + (m.art ? "background-image:" + cssImg(m.art) : ""));
    var btn = function (name, sz, key) { return stop(E("div", "", "padding:10px;border-radius:50%;display:flex", [ic(name, sz, "currentColor", "solid")]), "media", key, name); };
    var pct = m.dur ? clamp(m.pos / m.dur, 0, 1) : 0.38;
    var info = E("div", "cw-col", "min-width:0;flex:1;" + (wide ? "margin-left:30px" : ""), [
      E("div", "cw-lab", "", [m.app ? appIcon(m.app, 34, env) : ic("music", 30), m.source || "Now playing"]),
      E("div", "cw-ell", "margin-top:10px;font-size:" + px(big ? 64 : 38) + ";font-weight:760;letter-spacing:-.02em;line-height:1.1", [m.title]),
      E("div", "cw-ell cw-dim", "font-size:" + px(big ? 38 : 29) + ";font-weight:560", [m.artist]), E("div", "cw-grow"),
      b.h >= 420 && env.demo ? E("div", "cw-row", "margin-top:18px", ["Living", "Kitchen"].map(function (r2, i) { return E("div", "cw-chip", "height:48px;font-size:23px;" + (i ? "margin-left:12px" : ""), [ic("speaker", 26), r2]); })) : null,
      b.h >= 240 ? E("div", "cw-bar", "margin-top:14px", [E("b", "", "width:" + Math.round(pct * 100) + "%")]) : null,
      b.h >= 300 && m.dur ? E("div", "cw-row cw-sp cw-t23", "margin-top:8px", [E("span", "", "", [Math.floor(m.pos / 60) + ":" + ("0" + Math.floor(m.pos % 60)).slice(-2)]), E("span", "", "", ["-" + Math.floor((m.dur - m.pos) / 60) + ":" + ("0" + Math.floor((m.dur - m.pos) % 60)).slice(-2)])]) : null,
      b.h >= 300 ? E("div", "cw-row", "justify-content:center;margin-top:10px", [btn("previous", 40, "prev"), E("div", "", "width:40px"), btn(m.state === "playing" ? "pause" : "play", 52, "play"), E("div", "", "width:40px"), btn("next", 40, "next")]) : null]);
    if (wide) add(root, E("div", "cw-row", "height:100%;align-items:stretch", [art, info]));
    else add(root, [art, E("div", "cw-t29 cw-ell", "margin-top:16px;font-weight:680", [m.title]), E("div", "cw-t25 cw-ell", "", [m.artist]), E("div", "cw-grow"), E("div", "cw-bar", "", [E("b", "", "width:" + Math.round(pct * 100) + "%")])]);
    if (b.h < 300) stop(root, "media", "play", m.title);
  };
  R.soundscape = function (root, o, b) {
    var snd = op(o).sound || "rain", names = { rain: "Rain", fire: "Fire", waves: "Waves", brown: "Brown noise" }, icons = { rain: "rain", fire: "bolt", waves: "wind", brown: "speaker" };
    add(root, [ic(icons[snd], b.h < 200 ? 44 : 56, "currentColor"), E("div", "cw-grow"), E("div", b.w < 300 ? "cw-t25" : "cw-t29", "font-weight:680;color:var(--ink)", [names[snd]]), b.w >= 300 ? E("div", "cw-t23", "", ["Soundscape"]) : null]);
    stop(root, "quick", "soundscape", "Soundscape");
  };
  R.queue = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "music", "The song queue is coming");
    var q = [["Sunday Best", "Surfaces"], ["Riptide", "Vance Joy"], ["Electric Feel", "MGMT"], ["Dreams", "Fleetwood Mac"], ["Bloom", "The Paper Kites"], ["Holocene", "Bon Iver"], ["Sunsets", "Thelma Plum"], ["Old Pine", "Ben Howard"]];
    var covers = ["surf", "hike", "camp", "beach", "dog", "nan", "art", "birthday"];
    add(root, [lab("music", "Up next"), E("div", "cw-col cw-grow", "margin-top:18px;justify-content:space-between", q.slice(0, Math.min(8, Math.floor((b.h - 90) / 104))).map(function (s, i) {
      return E("div", "cw-row", "", [E("div", "", "width:76px;height:76px;border-radius:14px;flex:none;margin-right:20px;background:#333 center/cover;background-image:" + cssImg(demoImg(covers[i]))), E("div", "", "min-width:0", [E("div", "cw-t29 cw-ell", "font-weight:650", [s[0]]), E("div", "cw-t25 cw-ell", "", [s[1]])])]);
    }))]);
  };
  R.speakers = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "speakers", "Speakers are coming");
    add(root, [lab("speakers", "Speakers"), E("div", "cw-col cw-grow", "justify-content:space-around;margin-top:12px", [["Living", 42], ["Kitchen", 30], ["Deck", 0]].map(function (s) {
      return E("div", "", "", [E("div", "cw-row cw-sp", "", [E("span", "cw-t29", "", [s[0]]), E("span", "cw-t23", "", [s[1] ? s[1] + "%" : "Off"])]), E("div", "cw-bar", "margin-top:10px;height:12px;border-radius:6px", [E("b", "", "width:" + s[1] + "%")])]);
    }))]);
  };

  // smart home
  function noHa(root, b, iconName) { return empty(root, b, iconName || "home", "Connect Home Assistant on the TV", "couch-tv setup, Smart home"); }
  function dial(s, set, cur) {
    var frac = clamp((set - 16) / 14, 0, 1);
    return E("div", "", "position:relative;width:" + px(s) + ";height:" + px(s) + ";flex:none", [svg("0 0 100 100", s, s, [
      S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "rgba(255,255,255,.16)", "stroke-width": 8, "stroke-dasharray": "198 66", "stroke-linecap": "round", transform: "rotate(135 50 50)" }),
      S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "#64d2ff", "stroke-width": 8, "stroke-dasharray": Math.round(198 * frac) + " 300", "stroke-linecap": "round", transform: "rotate(135 50 50)" })]),
      E("div", "", "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center", [E("div", "", "", [E("div", "cw-big", "font-size:" + px(s * 0.3), [Math.round(set) + "°"]), cur !== null && cur !== undefined ? E("div", "cw-t23", "", ["Now " + cur + "°"]) : null])])]);
  }
  R.aircon = function (root, o, b, env) {
    var rooms = env.demo ? [{ name: "Living", target: 22, current: 24.5, mode: "Cool", on: true }, { name: "Media", target: 23, on: true }, { name: "Master", target: 21, on: true }, { name: "Bed 2", on: false }] : (env.rooms || []);
    if (!rooms.length) return noHa(root, b, "aircon");
    var ent = op(o).entity, r = rooms.filter(function (x) { return ent && x.entity === ent; })[0] || rooms[0];
    var wideA = b.w > b.h * 1.3, s = Math.min(b.h - 130, wideA ? b.w * 0.5 : b.w - 48), others = rooms.filter(function (x) { return x !== r; }).slice(0, 4);
    var mode = r.mode || (r.on === false ? "Off" : "On");
    add(root, [E("div", "cw-row cw-sp", "", [lab("aircon", r.name || "Aircon"), E("div", "cw-chip on", "height:44px;font-size:23px;background:#64d2ff", [String(mode)])]),
      E("div", "cw-grow cw-row cw-center", "", [dial(s, r.target || r.setpoint || 22, r.current), wideA && b.w >= 700 ? E("div", "cw-col", "margin-left:30px", others.map(function (z) {
        return E("div", "cw-chip" + (z.on !== false ? " on" : ""), "margin:7px 0;" + (z.on !== false ? "background:#64d2ff" : ""), [z.name + (z.on === false ? " off" : z.target ? " " + z.target + "°" : "")]);
      })) : null])]);
    stop(root, "smart", "", r.name || "Aircon");
  };
  var SCENE_DEMO = [["movie", "Movie"], ["bedtime", "Goodnight"], ["morning", "Morning"], ["away", "Away"], ["party", "Party"], ["dinner", "Dinner"]];
  R.scenes = function (root, o, b, env) {
    var list = env.demo ? SCENE_DEMO : (dataOf(env).scenes || []).map(function (s) { return ["favourite", String(s.name || s)]; });
    if (!list.length) return noHa(root, b, "favourite");
    var cols = b.w > 500 ? 3 : 2, rows = Math.max(1, Math.floor((b.h - 70) / 150)), n = Math.min(list.length, cols * rows);
    var mw = (b.w - 48 - 20 * (cols - 1)) / cols, mh = (b.h - 48 - 60 - 20 * (rows - 1)) / rows;
    add(root, [lab("favourite", op(o).label || "Scenes"), E("div", "cw-mods", "margin-top:8px", list.slice(0, n).map(function (x, i) {
      var m = E("div", "cw-mod" + (env.demo && i === 0 ? " on" : ""), "width:" + px(mw) + ";height:" + px(mh) + ";padding:16px 20px", [E("div", "cw-ic", "", [ic(x[0], 32, env.demo && i === 0 ? "#1a1406" : "#fff", "solid")]), E("div", "cw-t25 cw-ell", "font-weight:700;color:inherit", [x[1]])]);
      return stop(m, "smart", "", x[1]);
    }))]);
  };
  R.controls = function (root, o, b, env) {
    var q = op(o), items = (q.controls && q.controls.length ? q.controls : [{ icon: "light", name: "Lounge" }, { icon: "lamp", name: "Lamp" }, { icon: "pendant", name: "Kitchen" }, { icon: "blinds", name: "Blinds" }, { icon: "lock", name: "Front door" }, { icon: "outlet", name: "Heater" }, { icon: "speaker", name: "Speakers" }, { icon: "shield", name: "Alarm" }]);
    if (!env.demo) return env.ha ? soon(root, b, "light", "Lights and switches are coming") : noHa(root, b, "light");
    var states = ["80%", "Off", "On", "Closed", "Locked", "Off", "Playing", "Off"], on = [1, 0, 1, 0, 1, 0, 1, 0];
    var cols = q.cols || clamp(Math.round(b.w / 200), 1, 6), rows = Math.ceil(items.length / cols);
    var mw = (b.w - 48 - 20 * (cols - 1)) / cols, mh = (b.h - 48 - (q.label ? 50 : 0) - 20 * (rows - 1)) / rows;
    add(root, [q.label ? lab("home", q.label) : null, E("div", "cw-mods", q.label ? "margin-top:6px" : "", items.map(function (x, i) {
      var m = E("div", "cw-mod" + (on[i % 8] ? " on" : ""), "width:" + px(mw) + ";height:" + px(mh), [E("div", "cw-ic", "", [ic(x.icon, 32, on[i % 8] ? "#1a1406" : "#fff", "solid")]), E("div", "", "min-width:0", [E("div", "cw-t25", "font-weight:680;color:inherit", [x.name || ""]), E("div", "cw-t23", "", [states[i % 8]])])]);
      return stop(m, "smart", "", x.name);
    }))]);
  };
  R.camera = function (root, o, b, env) {
    if (!env.demo) return env.ha ? soon(root, b, "camera", "Camera pictures are coming") : noHa(root, b, "camera");
    add(root, [E("div", "cw-fill", "background:#333 center/cover;filter:saturate(.7) contrast(1.05);background-image:" + cssImg(demoImg("dog"))), E("div", "cw-fill", "background:linear-gradient(180deg,rgba(0,0,0,.45),transparent 35%)"),
      E("div", "cw-row", "position:absolute;left:24px;top:20px;color:#fff", [E("i", "", "display:block;width:14px;height:14px;border-radius:7px;background:#ff453a;margin-right:12px"), E("span", "cw-t25", "color:#fff;font-weight:680;margin-right:10px", [op(o).label || "Backyard"]), E("span", "cw-t23", "color:rgba(255,255,255,.82)", ["Live"])])]);
  };
  R.doorbell = function (root, o, b, env) {
    if (!env.demo) return env.ha ? soon(root, b, "doorbell", "The doorbell card is coming") : noHa(root, b, "doorbell");
    add(root, E("div", "cw-row", "height:100%;align-items:stretch", [E("div", "", "width:44%;border-radius:22px;background:#2b3035 center/cover;flex:none;background-image:" + cssImg(bgImg("grose-valley"))),
      E("div", "cw-col", "flex:1;margin-left:20px", [lab("doorbell", "Front door"), E("div", "cw-t38", "margin-top:10px", ["Parcel left"]), E("div", "cw-t25", "", ["2:14pm"])])]));
  };
  R.energy = function (root, o, b, env) {
    if (!env.demo) return env.ha ? soon(root, b, "bolt", "Solar readings are coming") : noHa(root, b, "bolt");
    var bars = [0, 0, 5, 18, 40, 66, 82, 90, 84, 70, 44, 20, 4, 0];
    add(root, [E("div", "cw-row cw-sp", "", [lab("bolt", "Solar today"), E("div", "cw-t23", "", ["Battery 86%"])]),
      E("div", "cw-row", "margin-top:10px", [E("div", "", "margin-right:36px", [E("div", "cw-big", "font-size:76px", ["18.4"]), E("div", "cw-t25", "", ["kWh made"])]), b.w >= 560 ? E("div", "", "", [E("div", "cw-big", "font-size:76px;color:#30d158", ["-$6.20"]), E("div", "cw-t25", "", ["paid to grid"])]) : null]),
      E("div", "cw-grow cw-row", "align-items:flex-end;margin-top:16px", bars.map(function (v, i) { return E("i", "", "display:block;flex:1;margin:0 3px;height:" + Math.max(3, v) + "%;border-radius:5px;background:" + (i === 9 ? "#ffd60a" : "rgba(255,214,10,.72)")); }))]);
  };
  R.sensor = function (root, o, b, env) {
    if (!env.demo) return env.ha ? soon(root, b, "temperature", "Sensors are coming") : noHa(root, b, "temperature");
    add(root, [lab("temperature", op(o).label || "Pool"), E("div", "cw-grow"), E("div", "cw-big", "font-size:" + px(b.h < 300 ? 64 : 96), ["26°"])]);
  };
  R.battery = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "bolt", "Batteries are not available on a TV yet", "Android TV does not share them");
    var d = [["games", "Pad 1", 72], ["games", "Pad 2", 12], ["headphones", "Headset", 55]], R2 = Math.max(96, Math.min((b.w - 48) / d.length - 40, b.h - 190));
    add(root, [lab("bolt", "Batteries"), E("div", "cw-row cw-grow", "justify-content:space-around", d.map(function (x) {
      var c = x[2] < 20 ? "#ff453a" : "#30d158";
      return E("div", "cw-col", "align-items:center", [E("div", "", "position:relative;width:" + px(R2) + ";height:" + px(R2), [svg("0 0 100 100", R2, R2, [S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: "rgba(255,255,255,.14)", "stroke-width": 9 }),
        S("circle", { cx: 50, cy: 50, r: 42, fill: "none", stroke: c, "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": 264, "stroke-dashoffset": 264 * (1 - x[2] / 100), transform: "rotate(-90 50 50)" })]),
        E("div", "", "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center", [ic(x[0], R2 * 0.36, "#fff")])]),
        E("div", "cw-t29", "color:var(--ink);font-weight:680;margin-top:12px", [x[2] + "%"]), E("div", "cw-t23", "", [x[1]])]);
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
    if (!env.demo && q.weekday === undefined) return empty(root, b, "calendar", "Set your bin night in TV Designer", "Pick the night and the bins");
    var bs = b.h < 300 ? 48 : 62;
    add(root, [lab("calendar", "Bin night"), E("div", b.h < 300 ? "cw-t29" : "cw-t38", "margin-top:12px;font-weight:700", [when]), E("div", "cw-grow"),
      E("div", "cw-row", "", bins.map(function (x, i) {
        return E("div", "cw-col", "align-items:center;" + (i ? "margin-left:16px" : ""), [svg("0 0 62 72", bs, bs * 72 / 62, [S("rect", { x: 6, y: 14, width: 50, height: 56, rx: 8, fill: "#3a3a40" }), S("rect", { x: 2, y: 6, width: 58, height: 12, rx: 5, fill: x[0] })]), b.w >= 300 ? E("span", "cw-t23", "margin-top:8px", [x[1]]) : null]);
      }))]);
  };
  R.people = function (root, o, b, env) {
    var ps = people(env);
    if (!ps.length) return empty(root, b, "people", "Add people in Home settings", "");
    var av = clamp(b.h - 20, 40, 62);
    root.style.padding = b.h < 100 ? "0 20px" : "14px 20px";
    add(root, E("div", "cw-row", "height:100%", ps.slice(0, Math.max(1, Math.floor(b.w / 150))).map(function (x, i) {
      var p = E("div", "cw-row", "opacity:" + (x[2] ? 1 : 0.68) + ";" + (i ? "margin-left:20px" : "") + ";border-radius:40px;padding:4px", [E("div", "", "width:" + px(av) + ";height:" + px(av) + ";border-radius:50%;overflow:hidden;flex:none;" + (x[2] ? "box-shadow:0 0 0 4px #fff" : ""), [avatar(x[0], av)]),
        E("span", "cw-t25", "color:var(--ink);margin-left:12px;font-weight:" + (x[2] ? 700 : 560), [x[1]])]);
      return stop(p, "person", x[3], x[1]);
    })));
  };
  R.agenda = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "calendar", "Connect your calendar on the TV", "Coming to couch-tv's Home settings");
    var ev = [["#ff9f0a", "School drop off", "8:30"], ["#30d158", "Swimming lessons, Ruby", "4:00"], ["#64d2ff", "Bins out, recycling", "7:00pm"], ["#bf5af2", "Movie night", "7:30pm"]];
    if (b.w < 360) {
      // narrow: the next event on a calendar page (the day, the date, what is next)
      var d = now();
      add(root, [E("div", "cw-t23", "font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--sub)", [DAYS[d.getDay()]]), E("div", "cw-big", "font-size:" + px(clamp(b.w / 2.6, 64, 110)), [String(d.getDate())]),
        E("div", "cw-grow"), E("div", "cw-t29 cw-ell", "font-weight:680", ["Swimming"]), E("div", "cw-t23", "", ["4:00pm"])]);
      return;
    }
    var n = clamp(Math.floor((b.h - 100) / 90), 1, ev.length);
    add(root, [E("div", "cw-row cw-sp", "", [lab("calendar", op(o).label || "Today"), E("div", "cw-t23", "", [ev.length + " events"])]),
      E("div", "cw-col cw-grow", "margin-top:20px;justify-content:space-around", ev.slice(0, n).map(function (e) { return E("div", "cw-ev", "", [E("i", "", "background:" + e[0]), E("div", "cw-t29 cw-ell", "", [e[1]]), E("div", "cw-t25", "", [e[2]])]); }))]);
  };
  R.note = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "edit", "Write a note from the phone remote", "Coming to couch-tv");
    add(root, [E("div", "cw-t23", "font-weight:700;color:var(--sub)", ["From Mum"]), E("div", "", "font-size:" + px(clamp(b.w / 9, 30, 44)) + ";font-weight:680;line-height:1.18;margin-top:10px;letter-spacing:-.01em", ["Dinner at 6. Feed Max!"])]);
  };
  R.list = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "check", "Tick lists from the phone remote", "Coming to couch-tv");
    var todo = /to ?do|task|work/i.test(op(o).label || "");
    var items = todo ? [["Send the quote", 0], ["Call the plumber", 1], ["Book flights", 0], ["Renew the rego", 0], ["Back up the laptop", 0], ["Order printer ink", 1], ["Reply to Sam", 0], ["Pay the power bill", 0]]
      : [["Milk", 0], ["Bread", 1], ["Avocados", 0], ["Sunscreen", 0], ["Dog food", 0], ["Lemons", 1], ["Coffee", 0], ["Bin bags", 0]];
    var n = clamp(Math.floor((b.h - 100) / 72), 2, items.length), lc = todo ? "#0a84ff" : root.classList.contains("cw-paper") ? "#1f9d55" : "#30d158";
    add(root, [E("div", "cw-row cw-sp", "", [lab(op(o).icon || "check", op(o).label || "Shopping", lc), E("div", "cw-t23", "", [String(items.filter(function (x) { return !x[1]; }).length)])]),
      E("div", "cw-col cw-grow", "margin-top:16px;justify-content:space-around", items.slice(0, n).map(function (x) { return E("div", "cw-li" + (x[1] ? " done" : ""), "", [E("span", "bx"), E("span", "cw-ell", "", [x[0]])]); }))]);
  };

  // info
  R.card = function (root, o, b, env) {
    var cards = env.demo ? [{ title: "Solar today", value: "18.4 kWh" }] : (dataOf(env).cards || []);
    if (!cards.length) return empty(root, b, "info", "Add custom cards on the bridge", "couch-tv bridge, custom cards");
    var c = cards[dayIndex(cards.length, 20)];
    add(root, [E("div", "cw-lab", "", [String(c.title || "")]), E("div", "cw-grow"), E("div", "cw-big", "font-size:" + px(clamp(b.h / 3.2, 44, 96)), [String(c.value || "")])]);
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
  R.news = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "info", "Headlines are coming");
    var h = [["Northern Rivers", "Bruxner Highway roadworks finish a month early", "1h"], ["Weather", "Storm season outlook: a wetter summer than usual for NSW", "2h"], ["Sport", "Matildas name squad for December friendlies", "3h"], ["Business", "Petrol prices ease ahead of the holidays", "4h"]];
    var n = clamp(Math.floor((b.h - 90) / 128), 1, 4);
    add(root, [lab("info", "Headlines"), E("div", "cw-col cw-grow", "margin-top:18px;justify-content:space-around", h.slice(0, n).map(function (x) {
      return E("div", "", "", [E("div", "cw-t23", "color:#ff453a;font-weight:700", [x[0] + " · " + x[2]]), E("div", "cw-t29", "font-weight:640;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden", [x[1]])]);
    }))]);
  };
  R.sports = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "tv", "Scores are not on couch-tv yet", "No free score feed covers the NRL and AFL");
    var m = [["Titans", "GLD", "#00a6e2", 24, "Broncos", "BRI", "#7c1d3f", 18, "FT"], ["Rabbitohs", "SOU", "#00843d", 12, "Roosters", "SYD", "#002b5c", 12, "62'"], ["Storm", "MEL", "#592c82", 6, "Raiders", "CAN", "#6bbe45", 0, "21'"], ["Sharks", "CRO", "#00a9d8", 0, "Eels", "PAR", "#ffcc00", 0, "7:50"]];
    var n = Math.max(1, Math.floor((b.h - 60) / 200));
    var team = function (nm, c, col, s, win) { void c; return E("div", "cw-row cw-sp", "", [E("div", "cw-row", "", [E("i", "", "display:block;width:28px;height:28px;border-radius:14px;background:" + col + ";margin-right:14px;box-shadow:0 0 0 3px rgba(255,255,255,.18)"), E("span", "cw-t29", "font-weight:" + (win ? 720 : 520), [nm])]), E("span", "cw-t38", "opacity:" + (win ? 1 : 0.6), [String(s)])]); };
    add(root, [E("div", "cw-row cw-sp", "", [lab("tv", op(o).label || "NRL"), E("div", "cw-t23", "", ["Demo"])]), E("div", "cw-col cw-grow", "margin-top:16px;justify-content:space-between", m.slice(0, n).map(function (x) {
      return E("div", "cw-col", "padding:16px 20px;border-radius:24px;background:rgba(255,255,255,.08)", [team(x[0], x[1], x[2], x[3], x[3] >= x[7]), E("div", "", "height:10px"), team(x[4], x[5], x[6], x[7], x[7] >= x[3]),
        E("div", "cw-t23", "margin-top:10px;font-weight:700;color:" + (x[8] === "FT" ? "var(--sub)" : "#ff453a"), [x[8] === "FT" ? "Full time" : "Live " + x[8]])]);
    }))]);
  };
  R.stocks = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "info", "Markets are not on couch-tv yet", "");
    var s = [["ASX 200", "8,412", "+0.6%", 1], ["BTC", "$142,310", "-1.2%", 0], ["AUD/USD", "0.672", "+0.1%", 1]];
    add(root, [E("div", "cw-lab", "", ["Markets"]), E("div", "cw-col cw-grow", "justify-content:space-around;margin-top:12px", s.map(function (x) {
      return E("div", "cw-row cw-sp", "", [E("div", "", "", [E("div", "cw-t29", "", [x[0]]), E("div", "cw-t23", "", [x[1]])]), b.w >= 460 ? svg("0 0 110 40", 110, 40, [S("path", { d: x[3] ? "M0 34 L20 30 L38 32 L56 20 L74 24 L92 10 L110 6" : "M0 8 L20 12 L38 9 L56 22 L74 18 L92 30 L110 33", fill: "none", stroke: x[3] ? "#30d158" : "#ff453a", "stroke-width": 3.4, "stroke-linejoin": "round" })]) : null,
        E("div", "cw-chip", "height:44px;font-size:23px;color:#fff;background:" + (x[3] ? "#30d158" : "#ff453a"), [x[2]])]);
    }))]);
  };
  R.commute = function (root, o, b, env) {
    if (!env.demo) return empty(root, b, "location", "Drive times are not on couch-tv yet", "");
    add(root, [lab("location", "To work"), E("div", "cw-row", "margin-top:10px;align-items:baseline", [E("span", "cw-big", "font-size:88px;margin-right:16px", ["16"]), E("span", "cw-t29", "", ["min"])]),
      E("div", "cw-t25", "color:#30d158;font-weight:650", ["Light traffic"]), svg("0 0 300 90", "100%", "100%", [S("path", { d: "M14 70 C70 70 80 24 140 30 S220 70 286 22", fill: "none", stroke: "rgba(255,255,255,.25)", "stroke-width": 12, "stroke-linecap": "round" }),
        S("path", { d: "M14 70 C70 70 80 24 140 30 S220 70 286 22", fill: "none", stroke: "#30d158", "stroke-width": 7, "stroke-linecap": "round" }), S("circle", { cx: 14, cy: 70, r: 9, fill: "#fff" }), S("circle", { cx: 286, cy: 22, r: 9, fill: "#fff", stroke: "#30d158", "stroke-width": 5 })], "flex:1;min-height:0;margin:12px 0"),
      E("div", "cw-t23", "", ["Leave by 8:10 for an 8:30 start"])]);
  };

  // guests and the room
  R.welcome = function (root, o, b) {
    var q = op(o), align = q.align || "left", text = q.text || "Welcome";
    var lines = text.split("\n").length, fs = clamp(Math.min((b.h - (q.kicker ? 50 : 0) - (q.sub ? 50 : 0)) / (1.08 * lines), b.w / (Math.max(8, text.length / lines) * 0.52)), 30, 120);
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
    add(root, E("div", "cw-row", "height:100%;justify-content:" + (q.align === "left" ? "flex-start" : q.align === "center" ? "center" : "flex-end"), ids.slice(0, n).map(function (id, i) {
      var nm = QNAMES[id] || ["settings", id];
      var bt = E("div", "", "width:" + px(s) + ";height:" + px(s) + ";border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:var(--panel);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);box-shadow:inset 0 0 0 1.5px var(--rim);" + (i ? "margin-left:" + gap + "px" : ""), [ic(nm[0], s * 0.44, "#fff")]);
      return stop(bt, "quick", id, nm[1]);
    })));
  };
  R.wifi = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "wifi", "Guest Wi-Fi details are kept on the TV");
    var qs = Math.min(b.h - 48, b.w * 0.42), cells = [], seed = 7;
    for (var i = 0; i < 21 * 21; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var x = i % 21, y = Math.floor(i / 21), fin = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      var on = fin ? ((x % 7 === 0 || x % 7 === 6 || y % 7 === 0 || y % 7 === 6) || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5)) : seed / 233280 > 0.52;
      if (on) cells.push(S("rect", { x: x, y: y, width: 1, height: 1 }));
    }
    add(root, E("div", "cw-row", "height:100%", [E("div", "", "width:" + px(qs) + ";height:" + px(qs) + ";border-radius:22px;background:#fff;padding:16px;flex:none", [svg("0 0 21 21", "100%", "100%", cells, "fill:#111")]),
      E("div", "cw-col", "margin-left:30px;min-width:0", [lab("wifi", "Guest Wi-Fi"), E("div", "cw-t48 cw-ell", "margin-top:10px", ["salt-and-sun"]), E("div", "cw-t29 cw-dim", "margin-top:6px", ["Password"]), E("div", "cw-t38 cw-ell", "", ["summer-swell"]), E("div", "cw-t23", "margin-top:10px", ["Point your phone camera here"])])]));
  };
  R.guide = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "info", "The house guide is coming");
    var it = [["info", "House guide"], ["clock", "Check out Sun 10am"], ["location", "Around here"]];
    add(root, E("div", "cw-col cw-grow", "", it.map(function (x, i) { return E("div", "cw-row", "flex:1;padding:14px 20px;border-radius:24px;background:rgba(255,255,255,.12);" + (i ? "margin-top:16px" : ""), [ic(x[0], 34), E("span", "cw-t29", "margin-left:16px", [x[1]])]); })));
  };
  R.screentime = function (root, o, b, env) {
    if (!env.demo) return soon(root, b, "timer", "Screen time is coming with Kids mode");
    add(root, [lab("timer", "Screen time", "rgba(255,255,255,.88)"), E("div", "cw-big", "font-size:" + px(clamp(b.h / 2.6, 80, 150)) + ";margin-top:14px", ["25", E("span", "", "font-size:.38em", [" min"])]), E("div", "cw-t29", "font-weight:650", ["left today"]), E("div", "cw-grow"),
      E("div", "cw-bar", "height:14px;border-radius:7px;background:rgba(255,255,255,.25)", [E("b", "", "width:58%;background:#fff")]), E("div", "cw-t23", "color:#fff;margin-top:10px", ["Bedtime 7:30pm, the TV goes quiet"])]);
  };

  // ---------------- one widget, a stack, the API ----------------
  function one(o, b, env) {
    var sh = shell(o, b, env), root = sh.root, st = o.style || {};
    CTX = { icons: st.icons || (env.look && env.look.icons) || "line" };
    try { (R[o.kind] || function (r) { empty(r, b, "info", "This widget needs a newer couch-tv", ""); })(root, o, b, env, sh); }
    catch (e) { empty(root, b, "info", "This widget could not be drawn", ""); }
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
    root.__show = show; root.__at = function () { return at; };
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
    appNode: function (pkg, a, env, big) { return appNode(pkg, a, env || {}, big); },
    autoInk: function (hex) { var c = autoInk(rgbOf(hex)); return c === WHITE ? "#ffffff" : "#1d1b18"; },
    contrast: function (a, b) { return contrast(rgbOf(a) || WHITE, rgbOf(b) || WHITE); },
    tileColour: function (kind) { return TILE[kind] || null; },
    timeWords: timeWords, moon: moon, sunTimes: sunTimes, daysTo: daysTo
  };
})();
