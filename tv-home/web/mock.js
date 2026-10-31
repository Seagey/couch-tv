// Development only. ?preview=1: the real bridge for Keep watching, these stand-in apps for the grid.
// ?mock=1: everything below, no bridge needed. Serve the repo root (any static server) and open
// /tv-home/web/index.html?mock=1, so the app logos in remote/src/app-logos/ load as the icons.
// The shows in MOCK_API are SYNTHETIC history.
//
// Presets for previews, all optional (see docs/CONFIG.md for what each setting means):
//   people=0..8         that many sample people (default: Person 1 and Person 2)
//   quick=sleep,look    tvs[].quick, in order (sleep, picture, look, input)
//   picture=1           this TV has a picture mode switch (Calibrated and Dynamic)
//   look=classic        home.look       clock=24h   home.clock     dock=6   home.dock_size
//   scenes=fog,dawn     home.scenes     secs=8      home.scene_seconds
//   myscenes=[...]      home.my_scenes, as JSON (docs/MAKE-A-SCENE.md), for your own scenes
//   lang=it             home.language (en, es, es-MX, it); without it, the browser's own language
//   newapp=1            an app turns up that this TV has not seen before (the New dot)
//   down                the bridge is not answering      offline=1   the saved copy, no bridge at all
//   reset=1             forget everything this preview saved (orders, people, the look, Home settings)
//   ha=1                smart home: a pretend Home Assistant with two rooms and three scenes
//                       (ha=down: it is not answering; ha=scenes: scenes only, no rooms)
//   update=1            Home settings, Updates, with a pretend 0.4 waiting (update=latest: none
//                       newer; update=allow: the TV has not let Home install apps yet)
(function () {
  var q = location.search;
  var arg = function (name) { var m = q.match(new RegExp("[?&]" + name + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : null; };
  if (arg("reset")) {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf("mock:") === 0) localStorage.removeItem(k); }); } catch (e) {}
  }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem("mock:" + k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("mock:" + k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- the settings config.js would carry ----------
  var NAMES = ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan", "Taylor", "Jamie"];
  var cfg = { weather: { lat: -33.8688, lon: 151.2093, place: "Sydney", timezone: "Australia/Sydney" },
    default_tv: "living-room", tvs: [{ id: "living-room", name: "Living room" }], home: {} };
  var n = arg("people");
  if (n !== null) {
    cfg.people = NAMES.slice(0, Math.max(0, Math.min(8, parseInt(n, 10) || 0))).map(function (name) {
      return { id: name.toLowerCase(), name: name };
    });
  }
  if (arg("quick") !== null) cfg.tvs[0].quick = arg("quick").split(",").filter(Boolean);
  if (arg("picture")) cfg.tvs[0].picture_modes = ["Calibrated", "Dynamic"];
  if (arg("look")) cfg.home.look = arg("look");
  if (arg("clock")) cfg.home.clock = arg("clock");
  if (arg("lang")) cfg.home.language = arg("lang");
  if (arg("dock")) cfg.home.dock_size = parseInt(arg("dock"), 10);
  if (arg("scenes")) cfg.home.scenes = arg("scenes").split(",");
  if (arg("secs")) cfg.home.scene_seconds = parseInt(arg("secs"), 10);
  if (arg("myscenes")) try { cfg.home.my_scenes = JSON.parse(arg("myscenes")); } catch (e) {}
  window.COUCH_CONFIG = cfg;

  // ---------- the launcher's updater (Updater.kt), for ?update= ----------
  // Downloads in about three seconds, shows the installer's question for three more, then reports
  // it cancelled: a preview never installs anything.
  if (arg("update")) {
    var kind = arg("update");
    var up = { supported: true, current: "0.3", latest: kind === "latest" ? "0.3" : "0.4",
      title: kind === "latest" ? "" : "0.4: a pretend release for the preview", available: kind !== "latest",
      checked: Date.now() - 20 * 3600000, auto: true, busy: "", progress: 0, error: "" };
    var tell = function () { if (window.tv && window.tv.update) window.tv.update(JSON.parse(JSON.stringify(up))); };
    window.MOCK_UPDATER = {
      state: function () { return JSON.stringify(up); },
      check: function () {
        up.busy = "checking"; up.error = ""; tell();
        setTimeout(function () { up.busy = ""; up.checked = Date.now(); tell(); }, 900);
      },
      install: function () {
        if (kind === "allow") { up.error = "allow"; tell(); return; }
        up.busy = "downloading"; up.progress = 0; up.error = ""; tell();
        var timer = setInterval(function () {
          up.progress += 10;
          if (up.progress < 100) { tell(); return; }
          clearInterval(timer);
          up.busy = "installing"; tell();
          setTimeout(function () { up.busy = ""; up.progress = 0; up.error = "cancelled"; tell(); }, 3000);
        }, 300);
      },
      auto: function (on) { up.auto = !!on; tell(); }
    };
  }

  // ---------- the TV's apps ----------
  var apps = [
    ["com.google.android.youtube.tv", "YouTube", "#f2f2f2"], ["com.netflix.ninja", "Netflix", "#ffffff"],
    ["au.net.abc.iview", "ABC iview", "#2bbfb6"], ["com.disney.disneyplus", "Disney+", "#0b3f4f"],
    ["au.com.stan.and", "Stan", "#0b6cf2"], ["au.com.streamotion.ares.tv", "Binge", "#3a1d8c"],
    ["com.amazon.amazonvideo.livingroom", "Prime Video", "#0f2a3d"], ["com.sbs.ondemand.tv", "SBS On Demand", "#111111"],
    ["com.apple.atve.androidtv.appletv", "Apple TV", "#111111"], ["com.cbs.ca", "Paramount+", "#0a3b9c"],
    ["au.com.ninenow.ctv", "9Now", "#0c7fb0"], ["com.swm.live", "7plus", "#b8102a"],
    ["au.com.tenplay", "10", "#111111"], ["au.com.kayosports.tv", "Kayo", "#0c0c0c"],
    ["au.com.foxtel.atv", "Foxtel", "#1b1b1b"], ["com.wbd.stream", "HBO Max", "#1c1c6b"],
    ["com.spotify.tv.android", "Spotify", "#121212"], ["com.google.android.youtube.tvmusic", "YouTube Music", "#141414"],
    ["tv.twitch.android.app", "Twitch", "#4b2a8c"], ["com.mediatek.wwtv.tvcenter", "Live TV", "#2a2a30"],
    ["com.android.vending", "App Store", "#2a2a30"], ["com.android.tv.settings", "Settings", "#2a2a30"]
  ];
  var fresh = ["com.plexapp.android", "Plex", "#1f1f1f"];
  if (arg("newapp")) {
    // this TV last listed its apps before Plex was installed
    if (!store.get("tvhome.apps.seen")) store.set("tvhome.apps.seen", apps.map(function (a) { return a[0]; }));
    apps.splice(apps.length - 2, 0, fresh);
  }
  var LOGOS = ["au.com.foxtel.atv", "au.com.kayosports.tv", "au.com.ninenow.ctv", "au.com.stan.and",
    "au.com.streamotion.ares.tv", "au.com.tenplay", "au.net.abc.iview", "com.amazon.amazonvideo.livingroom",
    "com.apple.atve.androidtv.appletv", "com.cbs.ca", "com.disney.disneyplus", "com.google.android.youtube.tv",
    "com.netflix.ninja", "com.sbs.ondemand.tv", "com.spotify.tv.android", "com.swm.live", "com.wbd.stream",
    "tv.twitch.android.app"];
  window.MOCK_ICON = function (pkg) {
    return LOGOS.indexOf(pkg) >= 0 ? "../../remote/src/app-logos/" + pkg + ".png" : null;
  };
  window.MOCK_APPS = apps.map(function (a) { return { kind: "app", name: a[1], package: a[0], colour: a[2] }; });

  // ---------- a pretend Home Assistant (smart home, smarthome.js) ----------
  // Stands in for the launcher's window.TVHA. Made up rooms and scenes, nothing real is switched.
  var ha = arg("ha");
  if (ha) {
    var rooms = [
      { entity: "climate.living_room", name: "Living room", state: "cool", action: "cooling", current: 24.5, target: 22,
        min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"] },
      { entity: "climate.bedroom", name: "Bedroom", state: "off", action: "off", current: 19, target: 21,
        min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "auto"] }
    ];
    if (ha === "scenes") rooms = [];
    var scenes = [{ entity: "scene.movie_night", name: "Movie night" }, { entity: "scene.lights_off", name: "Lights off" },
      { entity: "script.good_morning", name: "Good morning" }];
    var reply = function (id, r) { setTimeout(function () { if (window.smartHome) window.smartHome.reply(id, r); }, 150); };
    var room = function (e) { return rooms.filter(function (r) { return r.entity === e; })[0]; };
    window.TVHA = {
      info: function () {
        return JSON.stringify({ climate: rooms.map(function (r) { return { entity: r.entity, name: r.name }; }), scenes: scenes, doorbell: true });
      },
      request: function (id, action, entity, value) {
        if (ha === "down") return reply(id, action === "climate"
          ? { ok: true, rooms: rooms.map(function (r) { return { entity: r.entity, name: r.name, ok: false }; }) }
          : { ok: false, error: "failed" });
        var r = room(entity);
        if (action === "climate") return reply(id, { ok: true, rooms: rooms.map(function (x) { return Object.assign({ ok: true }, x); }) });
        if (action === "temp" && r) { r.target = Math.max(r.min, Math.min(r.max, parseFloat(value))); return reply(id, { ok: true }); }
        if (action === "mode" && r && r.modes.indexOf(value) >= 0) { r.state = value; r.action = value === "heat" ? "heating" : value === "cool" ? "cooling" : "idle"; return reply(id, { ok: true }); }
        if ((action === "on" || action === "off") && r) { r.state = action === "off" ? "off" : "cool"; r.action = action === "off" ? "off" : "cooling"; return reply(id, { ok: true }); }
        if (action === "scene" && scenes.some(function (x) { return x.entity === entity; })) return reply(id, { ok: true });
        reply(id, { ok: false, error: "refused" });
      }
    };
  }

  // ---------- a pretend bridge ----------
  var jw = function (p) { return "https://images.justwatch.com/" + p + ".webp"; };
  var app = function (id, name, pkg) { return { id: id, name: name, package: pkg }; };
  var shows = [
    { id: "m2", title: "The Bear", season: 3, episode: 2, app: app("disney-plus", "Disney+", "com.disney.disneyplus"), backdrop: jw("backdrop/346664278/s1440/the-bear-2022"), progress: 0.7 },
    { id: "m3", title: "Colin from Accounts", season: 2, episode: 6, app: app("binge", "Binge", "au.com.streamotion.ares.tv"), backdrop: jw("backdrop/320179990/s1440/colin-from-accounts"), progress: 0.15 },
    { id: "m4", title: "Fisk", season: 3, episode: 1, app: app("abc-iview", "ABC iview", "au.net.abc.iview"), backdrop: jw("backdrop/301043232/s1440/fisk"), progress: 0.55 },
    { id: "m5", title: "Slow Horses", season: 4, episode: 3, app: app("apple-tv", "Apple TV", "com.apple.atve.androidtv.appletv"), backdrop: jw("backdrop/272750278/s1440/slow-horses"), progress: 0.3 }
  ];
  var screens = [{ id: "desktop", name: "Desktop", kind: "moonlight", ready: true, note: "" }];
  var people = function () {
    return store.get("api.people") || cfg.people || [{ id: "person1", name: "Person 1" }, { id: "person2", name: "Person 2" }];
  };

  var sleepEnds = /[?&]sleep\b/.test(q) ? new Date(Date.now() + 42 * 60000).toISOString() : null;
  var picture = "calibrated";
  window.MOCK_API = function (method, path, body) {
    var empty = /[?&]empty\b/.test(q), down = /[?&]down\b/.test(q);
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (down) return reject(new Error("The computer isn't answering."));
        if (path.indexOf("/api/continue/open") === 0) return resolve({ ok: true, note: "" });
        if (path.indexOf("/api/continue") === 0) {
          var w = (path.match(/who=([^&]+)/) || [])[1];
          var ids = people().map(function (p) { return p.id; }), at = ids.indexOf(w), count = Math.max(1, ids.length);
          var mine = empty ? [] : shows.filter(function (x, i) { return w === "both" || at < 0 || i % count === at || count > shows.length; });
          return resolve({ ok: true, items: mine });
        }
        if (path.indexOf("/api/people") === 0) {
          if (method === "POST") {
            var list = people();
            if (body.people) list = body.people;
            else if (body.order) {
              list = body.order.map(function (id) { return list.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean)
                .concat(list.filter(function (p) { return body.order.indexOf(p.id) < 0; }));
            }
            store.set("api.people", list);
          }
          return resolve({ ok: true, people: people() });
        }
        if (path.indexOf("/api/app-order") === 0) {
          if (method === "POST") store.set("api.order", { order: body.order, line: body.line });
          var o = store.get("api.order");
          if (!o) return resolve({ ok: true, saved: false, line: 10, apps: [], dock_max: 10 });
          return resolve({ ok: true, saved: true, line: o.line, dock_max: 10,
            apps: o.order.map(function (p) { return { package: p, name: p }; }) });
        }
        if (path.indexOf("/api/who") === 0) return resolve({ ok: true, who: null });
        if (path.indexOf("/api/settings") === 0) {
          if (method === "POST") store.set("api.settings", { settings: body.settings || {}, updated: new Date().toISOString() });
          var st = store.get("api.settings") || { settings: {}, updated: null };
          return resolve({ ok: true, settings: st.settings, updated: st.updated });
        }
        if (path.indexOf("/api/sleep") === 0) {
          if (method === "POST") sleepEnds = body.minutes ? new Date(Date.now() + body.minutes * 60000).toISOString() : null;
          return resolve({ ok: true, ends: sleepEnds });
        }
        if (path.indexOf("/api/picture") === 0) {
          var has = arg("picture") || path.indexOf("tv=bedroom-tv") > 0 || (body && body.tv === "bedroom-tv");
          if (!has) return resolve({ ok: true, mode: null, supported: false, can_set: false });
          if (method === "POST") picture = body.mode === "toggle" ? (picture === "calibrated" ? "dynamic" : "calibrated") : body.mode;
          return resolve({ ok: true, mode: picture, supported: true, can_set: true,
            modes: [{ id: "calibrated", name: "Calibrated" }, { id: "dynamic", name: "Dynamic" }] });
        }
        if (path.indexOf("/api/screens/open") === 0) return resolve({ ok: true, note: "" });
        if (path.indexOf("/api/screens") === 0) return resolve({ ok: true, screens: screens });
        resolve({ ok: true });
      }, 60);
    });
  };
})();
