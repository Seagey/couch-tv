// Development only. ?preview=1: the real bridge for Keep watching, these stand-in apps for the grid.
// ?mock=1: everything below, no bridge needed. Serve the repo root (any static server) and open
// /tv-home/web/index.html?mock=1, so the app logos in remote/src/app-logos/ load as the icons.
// The shows in MOCK_API are SYNTHETIC history.
//
// Presets for previews, all optional (see docs/CONFIG.md for what each setting means):
//   people=0..8         that many sample people (default: Person 1 and Person 2)
//   quick=sleep,look    tvs[].quick, in order (sleep, picture, look, soundscape, input)
//   soundscape=rain     home.soundscape: the sound its button starts with (rain, fire, waves, brown)
//   picture=1           this TV has a picture mode switch (Calibrated and Dynamic)
//   look=oled           home.look (night, oled, classic, loop)   clock=24h   home.clock     dock=6   home.dock_size
//                       look=loop: the Loop look with no loop files (home.loop has no variants), so the page
//                       shows backgrounds/scene-night.jpg as a stand-in for the clip, to check the layout,
//                       with the clock behind the peak (depth=0: without the depth cut-out)
//   scenes=fog,dawn     home.scenes     secs=8      home.scene_seconds     sunsync=1   home.sun_sync
//   sunrotate=25        home.sun_rotate_minutes (own scenes tagged "when")     datebars=1   home.date_bars
//   myscenes=[...]      home.my_scenes, as JSON (docs/MAKE-A-SCENE.md), for your own scenes
//   lang=it             home.language (en, es, es-MX, it, de, tr, sr-Latn-RS, pl, pt); without it, the browser's own language
//   glass=on            home.glass (on, lite: no blur)      video=<link>   home.video_url, an MP4 or MOV
//   moving=off          home.moving_tiles: the focused tile's slow sway (off, or on)
//   dock=mac            home.dock: the Mac-style dock (mac, or classic)
//   ambient=1           home.ambient_music: the full screen music view (needs music=1; ambient=off: off)
//   lighter=1           home.lighter: Lighter home for a slow box (no blur, no soft shadows, a still photo)
//   icons=glass         home.glass_icons: Apple style clear app icons on glass
//   amount=1..5         home.glass_amount, how clear the glass is (1 frosted, 3 the default, 5 very clear)
//   clockstyle=liquid   home.clock_style: the Night clock as liquid glass
//   unit=f              home.wx_unit: temperatures in Fahrenheit
//   wxfx=1              home.ambient_weather: rain, snow and fog over the scenes (off unless set)
//   sungrade=1          home.ambient_sun_grade: the sun's colour over the scenes (off unless set)
//                       (also ?test_wx=<WMO code, 63 rain, 73 snow, 45 fog, 95 storm> and ?test_alt=<sun height, degrees>)
//   idle=<seconds|off>   home.idle_photo_seconds: hide the rows after 5, 10, 15, 30 or 60 seconds
//   smartidle=1          home.smart_idle.enabled: enable Smart Idle (smartidle_sec=5 sets test timeout in seconds)
//   inputs=4            the Input button lists four HDMI ports (one eARC), as the launcher reads them
//   gfocus=glass        home.glass_focus: with glass app icons, the focused app stays glass
//   banners=1           home.dock_banners: the Night dock shows each app's wide TV banner
//   music=1             Now playing: a pretend song in Spotify (music=paused: paused; music=noart: no cover)
//   newapp=1            an app turns up that this TV has not seen before (the New dot)
//   down                the bridge is not answering      offline=1   the saved copy, no bridge at all
//   reset=1             forget everything this preview saved (orders, people, the look, Home settings)
//   ha=1                smart home: a pretend Home Assistant with two rooms and three scenes
//                       (ha=down: it is not answering; ha=scenes: scenes only, no rooms)
//   kids=1              kids mode: Ruby, a kids profile on the couch, with a shelf of sample shows (all
//                       animated, so no real faces) and two allowed apps. The parent PIN is 1234.
//                       kids=empty: the same profile with nothing on the shelf yet
//   cards=1             custom cards (home.custom_cards): three sample cards at the end of the row
//   follow=1            home.shelf_follows_app: on an app tile the row shows only that app's cards, as
//                       "Recently on <app>" (YouTube: two pretend videos, the way the bridge sends them)
//   update=1            Home settings, Updates, with a pretend 0.4 waiting (update=latest: none
//                       newer; update=allow: the TV has not let Home install apps yet;
//                       update=ask: nobody has answered "tell you about new versions?" yet)
//   remoteart=1         the real show posters from JustWatch (otherwise every picture is from this server)
//   wx=24,2             pretend weather: 24 degrees, Open-Meteo code 2 (partly cloudy)
//   place=Riverside    weather.place, the name shown beside the weather
//   design=local        design: couch-tv Studio's current design (tools/tv-designer), read from
//                       this browser's localStorage ("tvdesigner.design"); designer=1 takes live edits
(function () {
  var q = location.search;
  // Every picture is made right here: a preview never asks another site for anything, so nobody's
  // address goes to an image host, and no show's real poster is copied. Each show gets a plain
  // placeholder (two colours and soft shapes, picked from its name), wide for a backdrop, tall for
  // a poster. ?remoteart=1 shows the real posters from JustWatch, for development only.
  var PALETTE = [["#2b3a55", "#c9746b"], ["#1f3d3a", "#d9b26f"], ["#3a2b4f", "#7fa7c9"], ["#4a3426", "#e0a96d"],
    ["#203040", "#9cc5a1"], ["#3d2233", "#f0b6a0"], ["#26323a", "#b9a7e0"], ["#33402a", "#e6cf8b"]];
  var localArt = function (p, tall) {
    if (/[?&]remoteart=1\b/.test(q)) return "";
    var h = 0; for (var i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
    var c = PALETTE[h % PALETTE.length], w = tall ? 400 : 640, ht = tall ? 600 : 360, r = (h >>> 8) % 40;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + ht + '" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
      '<rect width="' + w + '" height="' + ht + '" fill="url(#g)"/>' +
      '<circle cx="' + Math.round(w * (0.62 + r / 200)) + '" cy="' + Math.round(ht * 0.38) + '" r="' + Math.round(ht * 0.3) + '" fill="#fff" opacity=".14"/>' +
      '<circle cx="' + Math.round(w * 0.22) + '" cy="' + Math.round(ht * 0.86) + '" r="' + Math.round(ht * 0.42) + '" fill="#000" opacity=".16"/></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  };
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
  if (arg("banners")) cfg.home.dock_banners = true;
  if (arg("inputs")) {
    window.MOCK_INPUTS = [
      { id: "mock/hdmi1", label: "HDMI 1", type: "hdmi", devices: ["PlayStation 5"] },
      { id: "mock/hdmi2", label: "HDMI 2", type: "hdmi", devices: [] },
      { id: "mock/hdmi3", label: "HDMI 3 (eARC)", type: "hdmi", devices: ["Soundbar"] },
      { id: "mock/hdmi4", label: "HDMI 4", type: "hdmi", devices: ["Apple TV"] }
    ].slice(0, Math.max(1, Math.min(4, parseInt(arg("inputs"), 10) || 4)));
  }
  if (arg("picture")) cfg.tvs[0].picture_modes = ["Calibrated", "Dynamic"];
  if (arg("look")) cfg.home.look = arg("look");
  // the Loop look: what the bridge sends when make-loop.sh has not run, no variants and no blur copy (docs/LOOP.md),
  // and depth on (depth=0: off), with loop.json's meta: the page then stands the Night look's whole frame
  // cut-out, backgrounds/scene-night-fg.webp, over the backgrounds/scene-night.jpg stand-in, at the full
  // screen and with no motion, to check the layering and where the clock sits. That cut-out has no scrim
  // baked in, so it looks brighter than the TV's, whose make-loop.sh cut-out carries it
  if (arg("look") === "loop") {
    cfg.home.loop = { variants: [], blur: false, fg: arg("depth") !== "0",
      meta: { still: true, seconds: 34, fps: 30, zoom: 0, sway: 0, fg: { x: 0, y: 0, w: 1920, h: 1080 } } };
  }
  if (arg("idle")) cfg.home.idle_photo_seconds = arg("idle") === "off" ? 0 : Number(arg("idle"));
  if (arg("smartidle")) {
    cfg.home.smart_idle = { enabled: arg("smartidle") !== "off", home_idle_minutes: 15, home_action: "ambient_clock", paused_idle_minutes: 30, quiet_hours: { enabled: false, start: "23:00", end: "06:00", idle_minutes: 15 } };
  }
  if (arg("smartidle_sec")) window.MOCK_SMART_IDLE_MS = Math.max(1000, (parseInt(arg("smartidle_sec"), 10) || 5) * 1000);
  if (arg("soundscape")) cfg.home.soundscape = arg("soundscape");
  if (arg("clock")) cfg.home.clock = arg("clock");
  if (arg("lang")) cfg.home.language = arg("lang");
  if (arg("dock")) cfg.home.dock_size = parseInt(arg("dock"), 10);
  if (arg("scenes")) cfg.home.scenes = arg("scenes").split(",");
  if (arg("secs")) cfg.home.scene_seconds = parseInt(arg("secs"), 10);
  if (arg("sunsync")) cfg.home.sun_sync = arg("sunsync") === "1" || arg("sunsync") === "true";
  if (arg("sunrotate")) cfg.home.sun_rotate_minutes = parseInt(arg("sunrotate"), 10);   // home.sun_rotate_minutes
  if (arg("datebars")) cfg.home.date_bars = arg("datebars") !== "off";   // home.date_bars
  if (arg("myscenes")) try { cfg.home.my_scenes = JSON.parse(arg("myscenes")); } catch (e) {}
  if (arg("glass")) cfg.home.glass = arg("glass");
  if (arg("moving")) cfg.home.moving_tiles = arg("moving") !== "off";
  if (arg("dock")) cfg.home.dock = arg("dock");
  if (arg("lighter")) cfg.home.lighter = arg("lighter") !== "off";
  if (arg("ambient")) cfg.home.ambient_music = arg("ambient") !== "off";   // the full screen music view (off unless set)
  if (arg("icons") === "glass") cfg.home.glass_icons = true;
  if (arg("gfocus")) cfg.home.glass_focus = arg("gfocus");   // glass: the focused app stays glass (#32)
  if (arg("amount")) cfg.home.glass_amount = parseInt(arg("amount"), 10);
  if (arg("clockstyle")) cfg.home.clock_style = arg("clockstyle");
  if (arg("wxfx")) cfg.home.ambient_weather = arg("wxfx") !== "off";
  if (arg("sungrade")) cfg.home.ambient_sun_grade = arg("sungrade") !== "off";
  if (arg("unit")) cfg.home.wx_unit = arg("unit");   // home.wx_unit: c or f (#56)
  if (arg("video")) cfg.home.video_url = arg("video");
  // ---------- kids mode, for ?kids= (bridge/kids.py makes the same shape; the PIN here is 1234) ----------
  var KIDS = null;
  if (arg("kids")) {
    var jwp = function (path) { return localArt(path, true) || "https://images.justwatch.com/poster/" + path; };
    var iview = { id: "abc-iview", name: "ABC iview", package: "au.net.abc.iview" };
    var shelf = arg("kids") === "empty" ? [] : [
      { id: "bluey", title: "Bluey", service: "abc-iview", app: iview, poster: jwp("185497966/s592/bluey-2018.jpg") },
      { id: "hey-duggee", title: "Hey Duggee", service: "abc-iview", app: iview, poster: jwp("346323994/s592/hey-duggee.jpg") },
      { id: "peppa-pig-1-3", title: "Peppa Pig", service: "abc-iview", season: 1, episode: 3, app: iview, poster: jwp("207234640/s592/peppa-pig.jpg") },
      { id: "octonauts", title: "Octonauts", service: "abc-iview", app: iview, poster: jwp("174932116/s592/the-octonauts.jpg") },
      { id: "puffin-rock", title: "Puffin Rock", service: "netflix", app: { id: "netflix", name: "Netflix", package: "com.netflix.ninja" }, poster: jwp("177142154/s592/puffin-rock.jpg") },
      { id: "sarah-duck", title: "Sarah & Duck", poster: jwp("116976329/s592/sarah-and-duck.jpg") }
    ];
    KIDS = { id: "ruby", name: "Ruby", colour: "#ff9f0a", shows: shelf, apps: ["au.net.abc.iview", "com.google.android.youtube.tv"],
      pin_salt: "0a1b2c3d4e5f6a7b8c9d0e1f", pin_rounds: 4000,
      pin_hash: "79a9e80ea8547f9bfa6fc47647eb62c9d5cd284c1454f717e5d0f4178ad75d72" };
    cfg.people = (cfg.people || [{ id: "person1", name: "Person 1" }, { id: "person2", name: "Person 2" }]).concat([
      { id: "ruby", name: "Ruby", colour: "#ff9f0a", kid: true, kids_mode: { shows: shelf, apps: KIDS.apps,
        pin_hash: KIDS.pin_hash, pin_salt: KIDS.pin_salt, pin_rounds: KIDS.pin_rounds } }]);
  }
  // ?cards=1: home.custom_cards with three sample cards (docs/TV-HOME.md, Custom cards); the third has a
  // javascript: link and a script in its title, which must show as plain text and open nothing
  if (arg("cards")) cfg.home.custom_cards = true;
  if (arg("place")) cfg.weather.place = arg("place");
  // ?nowx=1: no place set (a TV set up with just a phone): the home asks for a town, never a sample one
  if (arg("nowx")) cfg.weather = null;
  if (arg("design") === "local") {
    try { var dz = JSON.parse(localStorage.getItem("tvdesigner.design") || "null"); if (dz && typeof dz === "object") cfg.design = dz; } catch (e) {}
  }
  if (arg("follow")) cfg.home.shelf_follows_app = arg("follow") !== "off";   // home.shelf_follows_app
  if (arg("ontv")) cfg.mode = "on-tv";   // ?ontv=1: served by the on-TV app (no computer behind it)
  window.COUCH_CONFIG = cfg;

  // ---------- the launcher's updater (Updater.kt), for ?update= ----------
  // Downloads in about three seconds, shows the installer's question for three more, then reports
  // it cancelled: a preview never installs anything.
  if (arg("update")) {
    var kind = arg("update");
    var up = { supported: true, current: "0.3", latest: kind === "latest" ? "0.3" : "0.4",
      title: kind === "latest" ? "" : "0.4: a pretend release for the preview", available: kind !== "latest",
      checked: Date.now() - 20 * 3600000, auto: kind !== "ask", answered: kind !== "ask", busy: "", progress: 0, error: "" };
    // ?update=ontv: the on-TV app from a phone, which cannot install an update itself (OnTvUpdate.kt):
    // it hands over the steps instead
    if (kind === "ontv") {
      up.manual = true; up.code = "8180170";
      up.how = "This app came from your phone, so it cannot install an update by itself. Put it on again the same way:";
      // the real app's seven steps (UpdateRules.kt), so a preview shows how long the page really is
      up.steps = [
        "Press Home, then open Downloader from your apps. Not there? Find Downloader by AFTVnews in the TV's Google Play Store and install it first.",
        "If Downloader opens on a web page, press Back until you see its Home screen with a box for a web address or code. Move to the box and press OK.",
        "Type 8180170 and press Go. If the TV asks whether Downloader may install apps, allow it.",
        "Press Install, then Done. Your settings stay.",
        "If it says App not installed, the TV is usually short of space. In Downloader, open Files, delete the old couch-tv-ontv files, then type 8180170 again.",
        "Open Couch TV again from your apps.",
        "If the code gives the version you already have, type this address in the box instead: github.com/Seagey/couch-tv/releases/latest/download/couch-tv-ontv.apk"];
    }
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
      auto: function (on) { up.auto = !!on; up.answered = true; tell(); }
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
        min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "dry", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan: "auto" },
      { entity: "climate.bedroom", name: "Bedroom", state: "off", action: "off", current: 19, target: 21,
        min: 16, max: 30, step: 0.5, modes: ["off", "cool", "heat", "auto"] }
    ];
    if (ha === "scenes") rooms = [];
    var scenes = [{ entity: "scene.movie_night", name: "Movie night" }, { entity: "scene.lights_off", name: "Lights off" },
      { entity: "script.good_morning", name: "Good morning" }];
    var reply = function (id, r) { setTimeout(function () { if (window.smartHome) window.smartHome.reply(id, r); }, 150); };
    var room = function (e) { return rooms.filter(function (r) { return r.entity === e; })[0]; };
    // the smart home widgets (HomeAssistant.kt widgets()): the same answers, made up. ?ha=1 has them all;
    // ?ha=scenes has none of them
    var W = ha === "scenes" ? null : {
      controls: [
        { entity: "light.lounge", name: "Lounge", ok: true, kind: "light", state: "on", on: true, level: 80 },
        { entity: "light.lamp", name: "Lamp", ok: true, kind: "light", state: "off", on: false },
        { entity: "fan.bedroom", name: "Ceiling fan", ok: true, kind: "fan", state: "on", on: true, level: 33 },
        { entity: "cover.blinds", name: "Blinds", ok: true, kind: "cover", state: "closed", on: false, level: 0 },
        { entity: "switch.heater", name: "Heater", ok: false, kind: "switch" },
        { entity: "cover.garage", name: "Garage", ok: true, kind: "cover", state: "closed", on: false, blocked: true }],
      cameras: [{ entity: "camera.backyard", name: "Backyard" }, { entity: "camera.driveway", name: "Driveway" }],
      sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, value: "26.4", num: 26.4, unit: "°C", cls: "temperature" },
        { entity: "sensor.rain_today", name: "Rain gauge", ok: true, value: "12", num: 12, unit: "mm" }],
      speakers: [{ entity: "media_player.kitchen", name: "Kitchen", ok: true, state: "playing", volume: 35, can_volume: true, can_pause: true, title: "Low Tide", artist: "Saltwater Radio" },
        { entity: "media_player.deck", name: "Deck", ok: true, state: "idle", volume: 20, can_volume: true, can_pause: true }],
      bellAt: Date.now() - 2 * 3600000
    };
    var names = function (l) { return l.map(function (x) { return { entity: x.entity, name: x.name }; }); };
    function mockStill(entity) {
      // a made up picture drawn here (never a real camera): sky and a moving bar, so a new still shows
      var c = document.createElement("canvas"); c.width = 320; c.height = 180;
      var g = c.getContext && c.getContext("2d");
      if (!g) return null;
      g.fillStyle = entity === "doorbell" ? "#4b5563" : "#2f5d50"; g.fillRect(0, 0, 320, 180);
      g.fillStyle = "#cfe3ff"; g.fillRect(0, 0, 320, 70);
      g.fillStyle = "#f2c14e"; g.fillRect((Date.now() / 40) % 320, 110, 40, 40);
      return c.toDataURL("image/jpeg", 0.7);
    }
    window.TVHA = {
      info: function () {
        var o = { climate: rooms.map(function (r) { return { entity: r.entity, name: r.name }; }), scenes: scenes, doorbell: true };
        if (W) { o.controls = names(W.controls); o.cameras = W.cameras; o.sensors = names(W.sensors); o.speakers = names(W.speakers); o.energy = true; o.doorbell_camera = true; }
        return JSON.stringify(o);
      },
      request: function (id, action, entity, value) {
        if (ha === "down") return reply(id, action === "climate"
          ? { ok: true, rooms: rooms.map(function (r) { return { entity: r.entity, name: r.name, ok: false }; }) }
          : { ok: false, error: "failed" });
        if (W) {
          var ctl = W.controls.filter(function (c) { return c.entity === entity; })[0], sp = W.speakers.filter(function (c) { return c.entity === entity; })[0];
          if (action === "controls") return reply(id, { ok: true, controls: JSON.parse(JSON.stringify(W.controls)) });
          if (action === "set") {
            if (!ctl || !ctl.ok || ctl.blocked) return reply(id, { ok: false, error: "refused" });
            ctl.on = value === "on" || value === "open"; ctl.state = ctl.kind === "cover" ? (ctl.on ? "open" : "closed") : ctl.on ? "on" : "off";
            window.MOCK_HA_LAST = action + " " + entity + " " + value;
            return reply(id, { ok: true });
          }
          if (action === "sensors") return reply(id, { ok: true, sensors: W.sensors });
          if (action === "history") return reply(id, { ok: true, start: Date.now() - 23 * 3600000, points: Array.apply(null, Array(24)).map(function (x, i) { return i < 3 ? null : Math.round((24 + 3 * Math.sin(i / 3.5)) * 10) / 10; }) });
          if (action === "energy") return reply(id, { ok: true, name: "Solar", start: Date.now() - 14 * 3600000, total: 18.4, battery: 86, power: 2.4, power_unit: "kW",
            hours: [0, 0, 0, 0, 0, 0, 0.2, 0.9, 1.8, 2.6, 3.1, 3.2, 2.9, 2.2, 1.5].concat([null, null, null, null, null, null, null, null, null]) });
          if (action === "speakers") return reply(id, { ok: true, speakers: JSON.parse(JSON.stringify(W.speakers)) });
          if (action === "volume" && sp) { sp.volume = Math.max(0, Math.min(100, parseInt(value, 10) || 0)); window.MOCK_HA_LAST = "volume " + entity + " " + sp.volume; return reply(id, { ok: true }); }
          if (action === "playpause" && sp) { sp.state = sp.state === "playing" ? "paused" : "playing"; window.MOCK_HA_LAST = "playpause " + entity; return reply(id, { ok: true }); }
          if (action === "bell") return reply(id, { ok: true, name: "Front door", at: W.bellAt, ringing: false, camera: true, kept: false });
          if (action === "ringstill") return reply(id, { ok: false, error: "none" });
          if (action === "still" && (entity === "doorbell" || W.cameras.some(function (c) { return c.entity === entity; }))) { var src = mockStill(entity); return reply(id, src ? { ok: true, src: src } : { ok: false, error: "failed" }); }
        }
        var r = room(entity);
        if (action === "climate") return reply(id, { ok: true, rooms: rooms.map(function (x) { return Object.assign({ ok: true }, x); }) });
        if (action === "temp" && r) { r.target = Math.max(r.min, Math.min(r.max, parseFloat(value))); return reply(id, { ok: true }); }
        if (action === "mode" && r && r.modes.indexOf(value) >= 0) { r.state = value; r.action = value === "heat" ? "heating" : value === "cool" ? "cooling" : "idle"; return reply(id, { ok: true }); }
        if (action === "fan" && r && (r.fan_modes || []).indexOf(value) >= 0) { r.fan = value; return reply(id, { ok: true }); }
        if ((action === "on" || action === "off") && r) { r.state = action === "off" ? "off" : "cool"; r.action = action === "off" ? "off" : "cooling"; return reply(id, { ok: true }); }
        if (action === "scene" && scenes.some(function (x) { return x.entity === entity; })) return reply(id, { ok: true });
        reply(id, { ok: false, error: "refused" });
      }
    };
  }
  // ?hasetup=1: a launcher with nothing set up yet, for Home settings, Smart home (HomeAssistant.kt
  // setupCheck, setupSave, setupForget). The token "test-token-for-the-preview-only" is the right one.
  if (arg("hasetup")) {
    var kept = null, sreply = function (id, r) { setTimeout(function () { if (window.smartHome) window.smartHome.setupReply(id, r); }, 120); };
    var ENTS = [{ entity: "climate.lounge", name: "Lounge aircon" }, { entity: "scene.movie_night", name: "Movie night" },
      { entity: "light.lounge", name: "Lounge lamp" }, { entity: "cover.blinds", name: "Blinds" }, { entity: "camera.front", name: "Front door" },
      { entity: "sensor.pool", name: "Pool", unit: "°C", cls: "temperature" }, { entity: "sensor.solar_today", name: "Solar today", unit: "kWh", cls: "energy" },
      { entity: "media_player.kitchen", name: "Kitchen speaker" }, { entity: "event.front_door_ding", name: "Front door ding" }];
    window.TVHA = {
      info: function () {
        if (!kept) return "{}";
        var nm = function (l) { return (l || []).map(function (x) { return { entity: x.entity, name: x.name || x.entity }; }); };
        return JSON.stringify({ climate: nm(kept.climate), scenes: nm(kept.scenes), controls: nm(kept.controls), cameras: nm(kept.cameras), sensors: nm(kept.sensors), speakers: nm(kept.speakers), energy: !!kept.energy, doorbell: !!kept.doorbell });
      },
      request: function (id) { setTimeout(function () { if (window.smartHome) window.smartHome.reply(id, { ok: false, error: "failed" }); }, 100); },
      setupStatus: function () { return JSON.stringify(kept ? { set: true, host: "homeassistant.local", made_on_tv: true } : { set: false }); },
      setupCheck: function (id, url, token) {
        if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(url)) return sreply(id, { ok: false, error: "address" });
        if (token !== "test-token-for-the-preview-only" && !(token === "" && kept)) return sreply(id, { ok: false, error: "token" });
        sreply(id, { ok: true, entities: ENTS });
      },
      setupSave: function (id, picks) { kept = JSON.parse(picks); window.MOCK_HA_SAVED = kept; sreply(id, { ok: true }); },
      setupForget: function (id) { kept = null; sreply(id, { ok: true }); }
    };
  }

  // ---------- a pretend bridge ----------
  var jw = function (p) { return localArt(p) || "https://images.justwatch.com/" + p + ".webp"; };
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
  // pretend songs for ?music= (made up, with the scenes as covers)
  var SONGS = [["Golden Hour Drive", "The Weekend Shifts", "scene-golden"], ["Low Tide", "Saltwater Radio", "scene-water"],
               ["Fog Lights", "Northern Rivers Club", "scene-fog"]];
  var songAt = 0, songPlaying = arg("music") !== "paused";
  function mockSong() {
    var x = SONGS[songAt];
    return { title: x[0], artist: x[1], album: null, state: songPlaying ? "playing" : "paused",
             app: { id: "spotify", name: "Spotify", package: "com.spotify.tv.android" },
             art: arg("music") === "noart" ? null : "backgrounds/" + x[2] + ".jpg",
             position: 45, duration: 210 };
  }
  window.MOCK_API = function (method, path, body) {
    var empty = /[?&]empty\b/.test(q), down = /[?&]down\b/.test(q);
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (down) return reject(new Error("The computer isn't answering."));
        // Now playing (#31): ?music=1, a song that previous and next step through, play and pause toggle
        if (path.indexOf("/api/weather") === 0 && arg("wx")) {
          var wp = arg("wx").split(",");
          // with a pretend forecast too, for the widgets (hourly, the week, rain soon, UV)
          var t0 = parseInt(wp[0], 10) || 22, c0 = parseInt(wp[1], 10) || 0, nw = new Date(), iso = function (d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
          var hourly = [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { var d = new Date(nw.getTime() + i * 3600000); return { time: iso(d) + "T" + ("0" + d.getHours()).slice(-2) + ":00", temp: t0 + [0, 1, 2, 3, 3, 1, -1, -2][i], code: [c0, 0, 0, 2, 3, 61, 95, 80][i], uv: 6, pop: [0, 0, 5, 10, 20, 60, 80, 70][i] }; });
          var daily = [0, 1, 2, 3, 4, 5, 6].map(function (i) { var d = new Date(nw.getTime() + i * 86400000); return { date: iso(d), code: [c0, 95, 61, 2, 0, 0, 3][i], hi: t0 + [3, 1, -2, 0, 2, 4, 2][i], lo: t0 - [7, 6, 7, 8, 9, 7, 6][i], sunrise: iso(d) + "T04:41", sunset: iso(d) + "T18:22", uv: 11 }; });
          return resolve({ ok: true, temp: t0, code: c0, text: "", is_day: true, hourly: hourly, daily: daily, hi: daily[0].hi, lo: daily[0].lo, uv: 11, rain15: [0, 0, 0.1, 0.4, 1.2, 2.8, 3, 1, 0.4, 0, 0, 0] });
        }
        // Up next (?queue=1: three made up songs; ?queue=empty: connected, nothing queued; none: Spotify not connected)
        if (path.indexOf("/api/music/queue") === 0) return resolve({ ok: true, configured: !!arg("queue"), queue: arg("queue") === "empty" ? [] : arg("queue") ? SONGS.map(function (x) { return { title: x[0], artist: x[1], art: null }; }) : null });
        if (path.indexOf("/api/music") === 0) return resolve({ ok: true, music: arg("music") ? mockSong() : null });
        if (path.indexOf("/api/custom-cards") === 0) return resolve({ ok: true, cards: arg("cards") ? [
          { title: "Solar today", subtitle: "Roof panels", value: "18.4 kWh", app: "com.google.android.youtube.tv" },
          { title: "Bin night", subtitle: "Put out by 7 pm", value: "Recycling", url: "https://example.com/bins" },
          { title: "<b>not bold</b><script>alert(1)</script>", value: "Plain text", url: "javascript:alert(1)" }] : [] });
        if (path.indexOf("/api/key") === 0) {
          var k = body && body.key;
          if (k === "play_pause") songPlaying = !songPlaying;
          if (k === "next") songAt = (songAt + 1) % SONGS.length;
          if (k === "previous") songAt = (songAt + SONGS.length - 1) % SONGS.length;
          return resolve({ ok: true, key: k });
        }
        if (path.indexOf("/api/continue/open") === 0) return resolve({ ok: true, note: "" });
        if (path.indexOf("/api/continue") === 0) {
          var w = (path.match(/who=([^&]+)/) || [])[1];
          var ids = people().map(function (p) { return p.id; }), at = ids.indexOf(w), count = Math.max(1, ids.length);
          var mine = empty ? [] : shows.filter(function (x, i) { return w === "both" || at < 0 || i % count === at || count > shows.length; });
          // ?keep=11: that many shows for everyone (made-up titles over the four pictures), to see the row slide
          var keepN = parseInt((q.match(/[?&]keep=(\d+)/) || [])[1], 10);
          if (keepN) mine = Array.apply(null, Array(keepN)).map(function (_, i) {
            var b = shows[i % shows.length];
            return { id: "k" + i, title: "Show " + (i + 1), season: 1, episode: i + 1, app: b.app, backdrop: b.backdrop };
          });
          // the videos next to the items, as GET /api/continue sends them (bridge/API.md): made-up titles, no picture
          var videos = empty ? [] : [
            { id: "v1", title: "How a Sydney ferry is built", kind: "video", app: app("youtube", "YouTube", "com.google.android.youtube.tv"), poster: null, backdrop: null, progress: null },
            { id: "v2", title: "Sourdough for beginners", kind: "video", app: app("youtube", "YouTube", "com.google.android.youtube.tv"), poster: null, backdrop: null, progress: null },
            // a live stream carries live: true (the Loop look's card says "YouTube · Live")
            { id: "v3", title: "Harbour webcam", kind: "video", live: true, app: app("youtube", "YouTube", "com.google.android.youtube.tv"), poster: null, backdrop: null, progress: null }
          ];
          return resolve({ ok: true, items: mine, videos: videos });
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
        if (path.indexOf("/api/who") === 0) {
          if (method === "POST") store.set("api.who", body.who);
          return resolve({ ok: true, who: store.get("api.who") || (KIDS ? "ruby" : null) });
        }
        if (path.indexOf("/api/kids") === 0) {
          var named = { "au.net.abc.iview": "ABC iview", "com.google.android.youtube.tv": "YouTube" };
          return resolve({ ok: true, kids: KIDS ? [{ id: KIDS.id, name: KIDS.name, shows: KIDS.shows, pin_hash: KIDS.pin_hash,
            pin_salt: KIDS.pin_salt, pin_rounds: KIDS.pin_rounds,
            apps: KIDS.apps.map(function (p) { return { package: p, name: named[p] }; }) }] : [] });
        }
        if (path.indexOf("/api/play") === 0) return resolve({ ok: true, note: body.title + " is playing." });
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
        if (path.indexOf("/api/bluetooth-audio") === 0) {
          return resolve({ ok: true, supported: true });
        }
        if (path.indexOf("/api/screens/open") === 0) return resolve({ ok: true, note: "" });
        if (path.indexOf("/api/screens") === 0) return resolve({ ok: true, screens: screens });
        resolve({ ok: true });
      }, 60);
    });
  };
})();
