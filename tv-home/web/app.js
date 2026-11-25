// TV home page, tvOS style: Keep watching on top, a grid of apps below, one screen, no scrolling.
// Runs inside the launcher's WebView (window.TVOS is the native side) or in any browser for
// development: ?mock=1 uses mock.js for everything, ?preview=1 uses mock apps with the real bridge.
(function () {
  "use strict";

  var TV = window.TVOS || null;
  var Q = location.search;
  var MOCK = /[?&]mock\b/.test(Q);
  var PREVIEW = /[?&]preview\b/.test(Q);
  var API = decodeURIComponent((Q.match(/[?&]api=([^&]+)/) || [])[1] || "");
  // the LG and Samsung apps build the key in rather than put it in the page's address, and theirs
  // wins over a key an older build left in localStorage
  var KEY = decodeURIComponent((Q.match(/[?&]key=([^&]+)/) || [])[1] || "") ||
    (window.COUCH_WEBOS || window.COUCH_TIZEN || window.COUCH_SETTINGS || {}).key || "";
  // A VIDAA or Panasonic TV is opened by the bridge with a one time code (?vidaa= or ?once=), never the
  // key: the page swaps it for the key once (bridge/vidaa.py, bridge/panasonic.py), then the code is
  // taken out of the address.
  var ONCE = (Q.match(/[?&](?:vidaa|once)=([A-Za-z0-9_-]{8,64})/) || [])[1];
  // A standalone copy hosted on a website (scripts/build-standalone.sh writes window.COUCH_STANDALONE
  // into its config.js): no bridge at all. It runs as the no-computer copy below; its Now playing
  // card comes from the site's own Spotify functions (standalone/api, spotify-player.js).
  var STANDALONE = !!window.COUCH_STANDALONE;
  if (ONCE && !KEY) {
    try {
      var cx = new XMLHttpRequest();
      cx.open("POST", API + "/api/vidaa/claim", false);
      cx.setRequestHeader("Content-Type", "application/json");
      cx.send(JSON.stringify({ code: ONCE }));
      var cj = JSON.parse(cx.responseText || "{}");
      if (cj.ok && cj.key) KEY = cj.key;
    } catch (e) {}
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])(?:vidaa|once)=[^&]*&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
  }
  if (KEY) { try { localStorage.setItem("couchtv.key", KEY); } catch (e) {} }
  else { try { KEY = localStorage.getItem("couchtv.key") || ""; } catch (e) {} }
  // which TV this page is on (the launcher adds ?tv=<id> on any TV that is not the default); none = living room
  var TV_ID = (Q.match(/[?&]tv=([a-z-]+)/) || [])[1] || "";
  // The launcher's saved copy of this page, opened when the computer is off (or when there is no
  // computer at all): scenes, clock, weather straight from Open-Meteo and the apps in the saved
  // order; nothing that needs the bridge.
  var OFFLINE = STANDALONE || /[?&]offline=1/.test(Q);
  // No computer at all (option A): the launcher's built-in copy is the home, so there is no
  // "computer is off" note to show.
  var ALONE = STANDALONE || (OFFLINE && /[?&]alone=1/.test(Q));
  if (OFFLINE) document.documentElement.classList.add("offline");
  var CACHE_KEY = "tvhome.cache.v2";
  // Every word on screen comes from i18n.js, in the language picked in Home settings.
  var t = window.I18N ? window.I18N.t : function (k) { return k; };
  var tBridge = window.I18N && window.I18N.tBridge ? window.I18N.tBridge : function (key, vars, fallback) {
    var said = key ? t(key, vars) : fallback;
    return !key || said === key ? fallback : said;
  };

  // Settings from the bridge's config.json (served as config.js, and saved with the offline copy),
  // read in readConfig() once the page starts (mock.js fills them in for previews). See docs/CONFIG.md.
  var CFG = {}, HOME = {}, TVCFG = {}, QUICK = [], DESIGN_FROM_CODE = false, GATE = { on: false, design: null };
  // A picture that fails to load falls back to what its data-err names (kids.js uses it too). One
  // listener instead of inline onerror handlers, so the page still works under the strict Content
  // Security Policy a Couch TV Studio design adds (designer-gate.js lockPage), which allows no inline
  // script at all. Keep watching pictures use "kwretry" (kwArtRetry, below).
  document.addEventListener("error", function (e) {
    var n = e.target, k = n && n.getAttribute && n.getAttribute("data-err"), p = n && n.parentNode;
    if (!k) return;
    if (k === "remove") { if (p) p.removeChild(n); }
    else if (k === "parent") { if (p && p.parentNode) p.parentNode.removeChild(p); }
    else if (k === "np") n.className = "np-art gone";
    else if (k === "svg" && p) { p.className = "face tool input-ic"; p.innerHTML = n.getAttribute("data-svg"); }
    else if (k === "word" && p) { p.className = "face word"; p.textContent = n.getAttribute("data-name"); }
    else if (k === "name" && p) p.textContent = n.getAttribute("data-n");
    else if (k === "sletter" && p) { var s = document.createElement("span"); s.className = "sicon none"; s.textContent = n.getAttribute("data-n") || ""; p.replaceChild(s, n); }
    else if (k === "kwretry" && window.kwArtRetry) window.kwArtRetry(n);   // a Keep watching picture is asked for again (#274)
    else if (k === "kwgone" && window.kwArtGone) window.kwArtGone(n);   // its app's banner did not come either: the title (g03)
  }, true);
  // No place set yet (no config.json weather, nothing picked in Home settings, Location): no weather and
  // no made up town. The weather tiles ask for a town instead (widgets.js noWx), never a sample place.
  var WX_NONE = { lat: null, lon: null, place: "", timezone: "auto" };
  var WXCFG = WX_NONE;
  var QUICK_ALL = ["sleep", "picture", "look", "soundscape", "screen_off", "headphones", "input", "bluetooth", "network", "tvsettings", "screensaver", "extend", "reminder"];
  // The most personal photos this TV keeps (also MAX_PHOTOS in bridge/server.py and MainActivity.kt).
  var MAX_PHOTOS = 50;
  var ON_TV = false;   // served by the on-TV app (config "mode"), which can open the TV's own settings screens
  // The look: ?theme= for a preview, then Home settings (or the Look button) on this TV, then home.look.
  // LOOP: the Loop look, laid out like Night (NIGHT stays true in it), see setLook()
  var THEME = "night", NIGHT = true, OLED = false, LOOP = false, CLOCK24 = false;
  var CLOCK_SECONDS = false, clockSecondsTimer = null;
  // OLED burn-in protection: micro-shift (±2px) every 60 seconds in the OLED look. The Smart Idle
  // ambient clock uses wider steps (±4px) while it is on screen.
  var OLED_SHIFT_STEPS = [[0,0], [1,1], [-1,1], [2,-1], [-1,-1], [1,-2], [-2,0], [0,1]];
  var IDLE_SHIFT_STEPS = [[0,0], [2,2], [-2,2], [4,-2], [-2,-2], [2,-4], [-4,0], [0,2]];
  var oledShiftIdx = 0;
  var idleAmbientActive = false;
  function updateOledShift() {
    if (!OLED && !idleAmbientActive) return;
    var steps = idleAmbientActive ? IDLE_SHIFT_STEPS : OLED_SHIFT_STEPS;
    oledShiftIdx = (oledShiftIdx + 1) % steps.length;
    var pt = steps[oledShiftIdx];
    document.documentElement.style.setProperty("--oled-shift-x", pt[0] + "px");
    document.documentElement.style.setProperty("--oled-shift-y", pt[1] + "px");
  }
  // Glass panels ("off", "on", or "lite": no blur, for slower TVs) and the video background, from
  // Home settings, then home.glass and home.video_url. Both are off unless someone switches them on.
  var GLASS = "off", GLASS_ICONS = false, VIDEO_ON = false, VIDEO_URL = "";
  // How clear the glass is, 1 (frosted) to 5 (very clear), and the Night clock's style ("frosted",
  // the photo's frosted copy, or "liquid", clear glass digits): Home settings, Look, else
  // home.glass_amount and home.clock_style (#25, #29).
  var GLASS_AMT = 3, CLOCK_LIQUID = false;
  var SMART_IDLE = { enabled: false, home_idle_minutes: 15, home_action: "ambient_clock", paused_idle_minutes: 30, quiet_hours: { enabled: false, start: "23:00", end: "06:00", idle_minutes: 15 } };
  var SMART_IDLE_HOME_STEPS = [0, 5, 10, 15, 30, 60];
  var SMART_IDLE_PAUSED_STEPS = [0, 10, 15, 20, 30, 45, 60];
  var SMART_IDLE_ACTIONS = ["ambient_clock", "screen_off", "tv_off"];
  function normSmartIdle(raw) {
    var d = raw && typeof raw === "object" ? raw : {};
    var qh = d.quiet_hours && typeof d.quiet_hours === "object" ? d.quiet_hours : {};
    return {
      enabled: !!d.enabled,
      home_idle_minutes: SMART_IDLE_HOME_STEPS.indexOf(d.home_idle_minutes) >= 0 ? d.home_idle_minutes : 15,
      home_action: SMART_IDLE_ACTIONS.indexOf(d.home_action) >= 0 ? d.home_action : "ambient_clock",
      paused_idle_minutes: SMART_IDLE_PAUSED_STEPS.indexOf(d.paused_idle_minutes) >= 0 ? d.paused_idle_minutes : 30,
      quiet_hours: {
        enabled: !!qh.enabled,
        start: typeof qh.start === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(qh.start) ? qh.start : "23:00",
        end: typeof qh.end === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(qh.end) ? qh.end : "06:00",
        idle_minutes: [5, 10, 15, 20, 30].indexOf(qh.idle_minutes) >= 0 ? qh.idle_minutes : 15
      }
    };
  }
  // Home settings made on this TV with the gear tile (see "home settings" below). They win over
  // config.js. ST is the saved object; the rest are read from it in readConfig().
  var ST = {}, WX_SHOW = true, WX_F = false, WX_EVERY = 30, HIDDEN_TV = [];
  var IDLE_PHOTO_STEPS = [0, 5, 10, 15, 30, 60];
  var IDLE_PHOTO_SECONDS = 0, idlePhotoTimer = null, idlePhotoActive = false;
  var WX_AMBIENT = true, WX_SUN_GRADE = true;
  // Now playing (#31), on unless switched off; the navigation sound: system, soft or off (#32)
  var NP_ON = true, KW_ON = true, SOUND_STYLE = "system", START_FOCUS = "people",
    SPOTIFY = {
      enabled: false, show_card: true, controls: true, seek_seconds: 10, hide_idle: false,
      title_mode: "pingpong", show_app: true, align: "classic", mini_align: "classic", mini_art: "wide",
      scrub_bar: true, show_shuffle_repeat: true, adaptive_tint: true, waveform: true,
      card_style: "compact", show_up_next: true, show_jump_app: true,
      show_sleep_timer: true, show_audio_output: true, separate_row: true, sync_theme_colors: false
    };
  var KW_POSTER = false;   // Night: Keep watching as Classic poster tiles, not wide cards (home.keep_watching_style, #192)
  // Keep watching follows the app the remote is on (home.shelf_follows_app), off unless switched on
  var SHELF_FOLLOW = false;
  // Ambient sleep soundscapes (rain, fire, waves, brown noise)
  var SOUND_TYPE = "off", SOUND_VOL = 0.5, SOUND_FADE_SLEEP = true;
  function initSoundscape() {
    var sc = ST.soundscape || HOME.soundscape || {};
    if (typeof sc === "string") sc = { type: sc };
    SOUND_TYPE = sc.type || "off";
    SOUND_VOL = typeof sc.volume === "number" ? Math.max(0, Math.min(1, sc.volume)) : 0.5;
    SOUND_FADE_SLEEP = sc.fade_with_sleep !== false;
  }
  function stopSoundscape() {
    if (!window.Soundscape || window.Soundscape.current() === "off") return;
    window.Soundscape.stop();
    try { renderQuick(); } catch (e) {}
  }
  var soundFading = false, sleepEndsSeen = 0;
  function soundscapeFollowSleep(m) {
    var S = window.Soundscape;
    if (!S || S.current() === "off" || !SOUND_FADE_SLEEP) { soundFading = false; return; }
    if (m > 0) sleepEndsSeen = sleepEnds || 0;
    if (m > 0 && m <= 15) {
      soundFading = true;
      S.setVolume(SOUND_VOL * m / 15);
    } else if (soundFading) {
      soundFading = false;
      if (m === 0 && sleepEndsSeen && Date.now() >= sleepEndsSeen - 30000) S.stop();
      else S.setVolume(SOUND_VOL);
      renderQuick();
    }
  }
  function cycleSoundscape() {
    if (!window.Soundscape) return;
    var types = window.Soundscape.TYPES;
    var cur = window.Soundscape.current();
    var next = cur === "off" ? (SOUND_TYPE !== "off" ? SOUND_TYPE : types[1]) : types[(types.indexOf(cur) + 1) % types.length];
    window.Soundscape.play(next, SOUND_VOL);
    SOUND_TYPE = next;
    ST.soundscape = { type: next, volume: SOUND_VOL, fade_with_sleep: SOUND_FADE_SLEEP };
    saveSettings();
    renderQuick();
    note(t("soundscape") + ": " + (next === "off" ? t("timer_off") : t("sound_" + next)));
  }
  function widgetSound(arg) {
    var S = window.Soundscape, parts = String(arg || "").split("|"), type = parts[0], vol = Math.max(10, Math.min(100, +parts[1] || 50)) / 100;
    if (!S || !S.TYPES || S.TYPES.indexOf(type) < 0) return;
    if (S.current() === type) { S.stop(); note(t("soundscape") + ": " + t("timer_off")); }
    else { S.play(type, vol); note(t("soundscape") + ": " + (t("sound_" + type) || type)); }
    try { renderQuick(); } catch (e) {}
    if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("sound", S.current());
  }
  // glass app icons: the focused app in its own colours, or staying glass (#32)
  var GLASS_FOCUS = "colour";
  // The focused tile's slow sway and glint: Home settings, Look, Moving tiles, else home.moving_tiles,
  // else on, except with glass "lite" (a slower TV), where it is off (#52)
  var MOVING = true;
  // Lighter home (#58): no blur, no soft shadows, a photo that holds still, smaller pictures. For a slow box.
  var LIGHTER = false;
  // Lighter home by itself on a low end TV. On a 2 GB TV (Android 11, four A55 cores) anything
  // that moves makes every frosted panel be drawn again each frame: 60 frames a second at rest, 22 with a
  // focused tile's sway, 47 with the blur off. When nobody has chosen (Home settings, Look, Lighter home,
  // or home.lighter), the TV decides: navigator.deviceMemory where it is clear (1 GB or less: low end, 8 or
  // more: not), otherwise a 1.5 s measurement of frame times with something moving, 20 s after the home opens,
  // kept for a week, and the frames while the focus really moves along a row (arrow presses from 30 s on).
  // 4 GB is measured too (#197, #213, g01): a 4 GB Google TV Streamer, Homatics or TCL stuttered and never got it.
  // A frame is slow against the screen's own refresh, measured at rest first: a smooth 30, 25 or 24 Hz screen
  // (33, 40, 42 ms frames) is not a slow TV. A stutter while moving counts only on a second start within a week
  // (two strikes), so one busy stretch never locks Lighter home on; that answer is then kept for 30 days.
  var LOW_END = false, LOW_END_WHY = "", LOW_END_KEY = "tvhome.lowend", LOW_END_DAYS = 7, LOW_END_TOLD = "tvhome.lighter_told";
  var LOW_END_NAV = "tvhome.lowend_nav", LOW_END_MOVING_DAYS = 30, LOW_END_WAIT = 20000, LOW_END_NAV_FROM = 30000;
  // A median frame over 250 ms is not a slow TV but a screen that was not being drawn: a Samsung Frame (2021,
  // Tizen 6) kept a 2849.7 ms measurement from Art Mode, where the page stays loaded and visible to itself
  // (document.hidden false) but gets almost no frames, and ran Lighter home for a week on that. Measured
  // with its screen on it gives 19 ms. Such a reading, kept or new, is thrown away and measured again later.
  var LOW_END_STALL = 250;
  function lowEndDecision(o) {
    if (o.setting === true || o.setting === false) return { low: o.setting, why: "setting" };
    if (typeof o.memory === "number" && o.memory > 0 && o.memory <= 1) return { low: true, why: "memory" };
    if (typeof o.memory === "number" && o.memory >= 8) return { low: false, why: "memory" };
    // slow: over 22 ms, or 1.3 frames of a slower screen (its refresh at rest, at most 42 ms: 24 Hz)
    var lim = Math.max(22, Math.min(o.idleMs || 16.7, 42) * 1.3);
    // the focus moving along a row stuttered: low end on the second start that says so, a first strike otherwise
    if (typeof o.navMs === "number" && o.navMs > lim && o.navMs <= LOW_END_STALL) return o.navStrike ? { low: true, why: "moving" } : { low: false, why: "strike" };
    var days = o.cached && o.cached.moving ? (o.movingDays || 30) : o.days;
    var stalled = o.cached && typeof o.cached.ms === "number" && o.cached.ms > LOW_END_STALL;
    if (o.cached && !stalled && typeof o.cached.low === "boolean" && o.now >= o.cached.t && o.now - o.cached.t < days * 86400000) return { low: o.cached.low, why: "measured" };
    if (typeof o.medianMs === "number" && o.medianMs <= LOW_END_STALL) return { low: o.medianMs > lim, why: "measured" };
    return null;   // measure first
  }
  // the screen's own frame time at rest: the 20th percentile of 20 frames with nothing added (a slow frame or
  // two does not count), read 2 s later if an arrow was pressed in the last second (the focus is still moving)
  var LOW_END_KEY_AT = -1e9;
  window.addEventListener("keydown", function () { LOW_END_KEY_AT = performance.now(); }, true);
  function idleFrames(done) {
    if (performance.now() - LOW_END_KEY_AT < 1000) { setTimeout(function () { idleFrames(done); }, 2000); return; }
    var d = [], last = 0;
    var step = function (t) {
      if (last) d.push(t - last);
      last = t;
      if (d.length < 20) { requestAnimationFrame(step); return; }
      d.sort(function (x, y) { return x - y; });
      done(d[Math.floor(d.length * 0.2)]);
    };
    requestAnimationFrame(step);
  }
  // frame times for 1.5 s while a screen sized, nearly clear layer fades a little (it makes every frosted
  // panel be drawn again each frame, as a focused tile's sway does); the median frame, in ms, and the
  // screen's own frame time at rest, measured just before
  function measureFrames(done) {
    idleFrames(function (idle) {
      var veil = document.createElement("div"), d = [], last = 0, end = 0;
      veil.setAttribute("aria-hidden", "true");
      veil.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:1;pointer-events:none;background:rgba(0,0,0,0.01);will-change:opacity";
      document.body.appendChild(veil);
      var a = veil.animate ? veil.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 1500, iterations: 1 }) : null;
      var step = function (t) {
        if (!end) end = t + 1500;
        if (last) d.push(t - last);
        last = t;
        if (t < end) { requestAnimationFrame(step); return; }
        if (a) a.cancel();
        veil.remove();
        d.sort(function (x, y) { return x - y; });
        done(d.length ? d[d.length >> 1] : 16.7, idle);
      };
      requestAnimationFrame(step);
    });
  }
  // a strike from this week counts; one from the future (a clock set back) does not
  function strikeOk(k, now, days) { return !!(k && k.strike >= 1 && typeof k.t === "number" && now >= k.t && now - k.t < days * 86400000); }
  // later, and only while the home is showing (a TV playing a show in front measures nothing)
  function whenShown(ms, fn) {
    setTimeout(function go() { if (document.hidden) setTimeout(go, 5000); else fn(); }, ms);
  }
  // decides once nobody has chosen Lighter home; turns it on, as the Home settings row does, if low end
  function lowEnd() {
    var chosen = typeof ST.lighter === "boolean" || typeof HOME.lighter === "boolean";
    if (chosen || OLD_ENGINE) return;   // a choice, or an old WebView that is already Lighter
    var cached = null, strike = null;
    try { cached = JSON.parse(localStorage.getItem(LOW_END_KEY) || "null"); } catch (e) {}
    try { strike = JSON.parse(localStorage.getItem(LOW_END_NAV) || "null"); } catch (e) {}
    var o = { setting: "auto", memory: navigator.deviceMemory, cached: cached, now: Date.now(), days: LOW_END_DAYS, movingDays: LOW_END_MOVING_DAYS,
      navStrike: strikeOk(strike, Date.now(), LOW_END_DAYS) };
    // late: after a measurement, when the home is already drawn (redraw it as the settings row does)
    var apply = function (r, late) {
      LOW_END = r.low; LOW_END_WHY = r.why;
      if (LIGHTER === LOW_END || typeof ST.lighter === "boolean" || typeof HOME.lighter === "boolean") return;   // already so, or chosen meanwhile
      LIGHTER = LOW_END;
      document.documentElement.classList.toggle("lighter", LIGHTER);
      if (LOOP) loopLighter();
      if (late) { ambientSync(); movingTiles(); renderShelf(); paintFocus(); }   // else the settings code goes on to do these
      if (LIGHTER) lighterTold();
    };
    var r = lowEndDecision(o);
    if (r) { apply(r); if (!r.low && r.why !== "setting" && r.why !== "memory") lowEndNav(o, apply); return; }
    // measure once the home has drawn and start up is over (once, however often settings apply)
    if (lowEnd.pending) return;
    lowEnd.pending = true;
    var tries = 0;
    whenShown(LOW_END_WAIT, function measure() {
      measureFrames(function (ms, idle) {
        o.medianMs = ms; o.idleMs = idle;
        var m = lowEndDecision(o);
        // the screen was not being drawn (Art Mode, a screen off with the app still up): nothing is decided or
        // kept; again in a minute, up to five times this start
        if (!m) { if (++tries < 5) whenShown(60000, measure); else lowEnd.pending = false; return; }
        lowEnd.pending = false;
        try { localStorage.setItem(LOW_END_KEY, JSON.stringify({ low: m.low, t: Date.now(), ms: Math.round(ms * 10) / 10, idle: Math.round(idle * 10) / 10 })); } catch (e) {}
        apply(m, true);
        if (!m.low) lowEndNav(o, apply);
      });
    });
  }
  // The frames while the focus really moves (g01): for 600 ms after each arrow press on the home, until 90
  // frames are in. A TV that passes the still measurement but stutters along a row gets Lighter home too,
  // on the second start that stutters (two strikes). Presses in the first 30 s, while the TV is still starting
  // its own apps, do not count; nothing runs between presses, and it stops for good once it has its frames.
  function lowEndNav(o, apply) {
    if (lowEndNav.on) return;
    lowEndNav.on = true;
    var d = [], until = 0, last = 0, running = false;
    // the screen's own refresh, if the still measurement did not run this start (a kept answer)
    if (!o.idleMs) whenShown(LOW_END_WAIT, function () { idleFrames(function (idle) { o.idleMs = idle; }); });
    var step = function (t) {
      if (last) d.push(t - last);
      last = t;
      if (d.length >= 90) { finish(); return; }
      if (t < until && !document.hidden) requestAnimationFrame(step); else { running = false; last = 0; }
    };
    var onKey = function (e) {
      if (!/^Arrow/.test(e.key || "") || zone === "settings" || LIGHTER || typeof ST.lighter === "boolean" || typeof HOME.lighter === "boolean") return;
      if (performance.now() < LOW_END_NAV_FROM || document.hidden || !o.idleMs) return;   // start up, an app in front, no refresh yet
      until = performance.now() + 600;
      if (!running) { running = true; requestAnimationFrame(step); }
    };
    var finish = function () {
      window.removeEventListener("keydown", onKey, true);
      d.sort(function (x, y) { return x - y; });
      o.navMs = d[d.length >> 1];
      if (o.navMs > LOW_END_STALL) return;   // the screen stopped drawing (Art Mode): no answer, the strike as it was
      var m = lowEndDecision(o);
      try {
        if (m && m.why === "strike") localStorage.setItem(LOW_END_NAV, JSON.stringify({ strike: 1, t: Date.now(), ms: Math.round(o.navMs * 10) / 10 }));
        else localStorage.removeItem(LOW_END_NAV);   // smooth this time: a one off spike is forgotten
      } catch (e) {}
      if (!m || !m.low) return;
      try { localStorage.setItem(LOW_END_KEY, JSON.stringify({ low: true, t: Date.now(), ms: Math.round(o.navMs * 10) / 10, moving: true })); } catch (e) {}
      apply(m, true);
    };
    window.addEventListener("keydown", onKey, true);
  }
  // Once, the first time Lighter home turns itself on: say so, and where to change it (g01, g23)
  function lighterTold() {
    if (kept(LOW_END_TOLD)) return;
    keep(LOW_END_TOLD, 1);
    setTimeout(function () { toast(t("lighter_auto", { home: t("gear_home"), look: t("sec_look") })); }, 1500);
  }

  // The focused tile's sway and glint play for a few seconds after the focus moves, then hold still: a
  // running animation makes the TV draw the whole screen every frame (60 to 22 frames a second on a 2 GB
  // TV with frosted panels), and a still home costs nothing. Any key or pointer move starts them again.
  var SETTLE_MS = 6000, settleTimer = 0;
  function unsettle() {
    document.documentElement.classList.remove("settled");
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { document.documentElement.classList.add("settled"); }, SETTLE_MS);
  }
  // pointer events came in Chrome 55: webOS 4 (Chrome 53) reports the Magic Remote as a mouse only
  var PTR = window.PointerEvent ? "pointer" : "mouse";
  ["keydown", PTR + "move", PTR + "down", "wheel"].forEach(function (ev) { window.addEventListener(ev, unsettle, true); });
  unsettle();
  // WebViews before Chrome 84 (still on many Android 9 TVs) skip gap in a flex box, so icons touch
  // their words and rows touch each other. html.no-flex-gap lets app.css put margins in instead (#26).
  (function () {
    var d = document.createElement("div");
    d.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
    d.appendChild(document.createElement("div"));
    d.appendChild(document.createElement("div"));
    document.documentElement.appendChild(d);
    var ok = d.scrollHeight === 1;
    d.parentNode.removeChild(d);
    document.documentElement.classList.toggle("no-flex-gap", !ok);
  })();
  // WebViews before Chrome 57 (a Mi TV 4A on Android 6 ships Chrome 56) have no CSS grid at all, and
  // the app row and Home settings collapsed into one column (#59). html.old-engine lets app.css
  // lay those out with flexbox and margins instead. ?old-engine=1 forces it, to look at it in a browser.
  var OLD_ENGINE = (function () {
    var grid = false;
    try { grid = !!(window.CSS && window.CSS.supports && window.CSS.supports("display", "grid")); } catch (e) {}
    return !grid || /[?&]old-engine\b/.test(Q);
  })();
  document.documentElement.classList.toggle("old-engine", OLD_ENGINE);

  // What this TV keeps for itself (app order, people order, new apps, the look). Written to the
  // page's storage and to the launcher (TVOS.keep), so the live page and the saved copy share it.
  var PFX = MOCK || PREVIEW ? "mock:" : "";
  function kept(key) {
    var v = null;
    try { if (TV && TV.kept) v = TV.kept(PFX + key); } catch (e) {}
    if (v == null) try { v = localStorage.getItem(PFX + key); } catch (e) {}
    try { return v == null ? null : JSON.parse(v); } catch (e) { return null; }
  }
  function keep(key, value) {
    var j = JSON.stringify(value);
    try { localStorage.setItem(PFX + key, j); } catch (e) {}
    try { if (TV && TV.keep) TV.keep(PFX + key, j); } catch (e) {}
  }

  // Default order: YouTube, then Netflix, then the rest the way a household reaches for them.
  var APP_ORDER = [
    "local.sky", "com.google.android.youtube.tv", "com.amazon.firetv.youtube", "com.netflix.ninja", "au.net.abc.iview", "com.disney.disneyplus",
    "au.com.stan.and", "au.com.streamotion.ares.tv", "com.amazon.amazonvideo.livingroom",
    "com.sbs.ondemand.tv", "com.apple.atve.androidtv.appletv", "com.cbs.ca", "au.com.ninenow.ctv",
    "com.swm.live", "au.com.tenplay", "au.com.kayosports.tv", "au.com.foxtel.atv", "com.wbd.stream",
    "com.spotify.tv.android", "com.google.android.youtube.tvmusic"
  ];
  // The TV's own tools go last, in this order, just before the screens.
  var APP_LAST = ["com.mediatek.wwtv.tvcenter", "com.android.vending", "com.amazon.venezia", "com.android.tv.settings"];
  // Kept behind the "More apps" tile on every TV (apps most people rarely open).
  var TUCKED = ["com.mediatek.wwtv.tvcenter", "com.google.android.youtube.tvmusic", "com.spotify.tv.android", "com.android.vending", "com.amazon.venezia"];
  // The same tools on other makers' TVs, by name.
  var TUCKED_NAMES = /^(screen ?shar|live ?tv|usb|media ?cent|browser|device assistant)/i;
  // Both Android stores, under the same translated name.
  var RENAME = { "com.android.vending": "app_store", "com.amazon.venezia": "app_store" };
  // Never shown: home screens and system clutter, and Moonlight (a screen tile opens it).
  // A maker's own clutter (help apps, file browsers) is listed per house in config.json,
  // home.hide_packages, and added to this list in readConfig().
  var HIDDEN = [
    "com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "app.couchtv.launcher",
    "com.limelight", "com.google.android.play.games", "com.google.android.videos"
  ];
  var GRID_COLS = 12, GRID_MAX = 24;
  var INPUT_TILE = false;
  var DOCK_APPS = 10;   // Night: apps in the dock before Settings and More apps (home.dock_size)
  var DOCK_BANNERS = false;   // Night: the dock shows each app's wide TV banner instead of its square icon (home.dock_banners)
  var BANNER_COLS = 6;        // wide tiles: six to a row; the rows below show one at a time, moving down
  var BANNER_ROW_REM = 10;    // one row of banners and the gap under it (7rem tile + 3rem), for the slide
  var SETTINGS_PKG = "com.android.tv.settings";
  var HOLD_MS = 600;    // how long OK is held to pick something up

  var ICONS = {
    screen: '<svg viewBox="0 0 24 24"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M9 20.5h6M12 16.5v4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    picture: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" class="fill"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    designer: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17.5V21M9 13l5.5-5.5 2 2L11 15H9z"/></svg>',
    look: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M2.5 16l5.5-5.5 4.5 4.5 3-3 6 6"/><circle cx="16.5" cy="8.8" r="1.6"/></svg>',
    soundscape: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    screen_off: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4M3 3l18 18"/></svg>',
    input: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5"/></svg>',
    ps5: '<svg viewBox="0 0 24 24"><path d="M7 6v12M17 6v12M7 10h10M7 14h10"/><circle cx="12" cy="12" r="8.5"/></svg>',
    xbox: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M7.5 7.5c2.5 2.5 6.5 2.5 9 0M7.5 16.5c2.5-2.5 6.5-2.5 9 0M7 8c2 3.5 2 4.5 0 8M17 8c-2 3.5-2 4.5 0 8"/></svg>',
    switch: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="6" height="16" rx="3"/><rect x="13" y="4" width="6" height="16" rx="3"/><circle cx="8" cy="8" r="1" class="fill"/><circle cx="16" cy="14" r="1" class="fill"/></svg>',
    hdmi: '<svg viewBox="0 0 24 24"><path d="M4 8h16v5l-3 4H7l-3-4z"/><path d="M8 8v3M11 8v3M13 8v3M16 8v3"/></svg>',
    screensaver: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="14" rx="2.5"/><path d="M15.2 7.3a3.4 3.4 0 1 0 2.1 5 3.9 3.9 0 0 1-2.1-5z"/></svg>',
    reminder: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    headphones: '<svg viewBox="0 0 24 24"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
    bluetooth: '<svg viewBox="0 0 24 24"><path d="M6.5 7.5l11 9-5.5 4.5v-18l5.5 4.5-11 9"/></svg>',
    network: '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M5.7 12.5a9.5 9.5 0 0 1 12.6 0M8.9 16a4.8 4.8 0 0 1 6.2 0"/><circle cx="12" cy="19.3" r="1"/></svg>',
    store: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    devmode: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3.5V8h-4.5"/></svg>',
    // Now playing's buttons (filled shapes)
    prev: '<svg viewBox="0 0 24 24" class="solid"><path d="M7 6h2v12H7zM20 6v12l-9-6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" class="solid"><path d="M15 6h2v12h-2zM4 6v12l9-6z"/></svg>',
    play: '<svg viewBox="0 0 24 24" class="solid"><path d="M7 5v14l12-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" class="solid"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>',
    rewind: '<svg viewBox="0 0 24 24" class="solid"><path d="M11 6v12l-9-6zM21 6v12l-9-6z"/></svg>',
    ff: '<svg viewBox="0 0 24 24" class="solid"><path d="M3 6v12l9-6zM13 6v12l9-6z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M12 9v6M10.5 10.5L12 9"/></svg>',
    spotify: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7 9.5c3.5-1 7.5-.7 10.5 1M7.5 12.5c3-.8 6.5-.5 9 1M8 15.5c2.3-.6 5-.4 7 .8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    updown: '<svg viewBox="0 0 24 24"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    launch: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
    // the settings screen's sections
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.5 3.8 5.3 3.8 8.5s-1.2 6-3.8 8.5c-2.6-2.5-3.8-5.3-3.8-8.5s1.2-6 3.8-8.5z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M17.5 19H8a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 19.4 12a3.5 3.5 0 0 1-1.9 7z"/></svg>',
    apps: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.8-3.9 3.7-6 7.5-6s6.7 2.1 7.5 6"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2.8 5.5 13.2h5.8L10.5 21l8-10.6h-5.9z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16"/></svg>'
  };
  // weather glyphs for the date line, by Open-Meteo's WMO code
  var WX = {
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M17.5 19H8a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 19.4 12a3.5 3.5 0 0 1-1.9 7z"/></svg>',
    rain: '<svg viewBox="0 0 24 24"><path d="M17.5 15H8a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 19.4 8a3.5 3.5 0 0 1-1.9 7z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/></svg>',
    storm: '<svg viewBox="0 0 24 24"><path d="M17.5 15H8a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 19.4 8a3.5 3.5 0 0 1-1.9 7z"/><path d="M12.5 15.5 10.5 19h3l-2 3.5"/></svg>'
  };
  function wxIcon(w) {
    var c = w.code;
    if (c >= 95) return WX.storm;
    if (c >= 51) return WX.rain;
    if (c >= 3 || c === 45 || c === 48) return WX.cloud;
    return w.is_day ? WX.sun : WX.moon;
  }

  var $ = function (id) { return document.getElementById(id); };
  // shows is the row on screen (the whole row, or one app's cards while the remote follows an app);
  // showsBy and videosBy are the full lists per person, as the bridge (or Android's Watch Next) gave them
  var data = { shows: [], showsBy: {}, videosBy: {}, apps: [], screens: [], bridge: null };
  // Whose Keep watching is showing. Remembered on this TV. Any number of people: none or one shows
  // no switcher, two the pill switch, three or more a round head icon that opens a list.
  // With nobody set up, everything is shown ("both" to the bridge).
  var PEOPLE = [], NOBODY = false, who = null, pi = 0;
  try { who = localStorage.getItem("tvhome.who"); } catch (e) {}
  var zone = "grid", s = 0, g = 0;   // focus: zone, shelf index, grid index
  var shelfEls = [], gridEls = [], gridItems = [];
  var touched = false, expanded = false;
  var retryTimer = null, retryMs = 2500, statusTimer = null;
  var pmi = 0, plift = false;        // the people list: focused row, and whether that row is picked up
  var lift = null;                   // the dock app picked up to move: {pkg}
  var newApps = [];                  // apps installed since this TV first saw its apps, until opened once

  // Optional clean photo display: after the chosen delay without input, fade out the home rows while
  // leaving the clock, date/weather and rotating scene visible. The first remote input wakes the
  // rows without activating the focused app.
  function idlePhotoAllowed() {
    return IDLE_PHOTO_SECONDS > 0 && !kidsOn() && !document.hidden && !screenOffActive && !expanded && !lift &&
      ["grid", "shelf", "people", "quick", "np"].indexOf(zone) >= 0;
  }
  function resetIdlePhoto() {
    clearTimeout(idlePhotoTimer);
    idlePhotoTimer = null;
    idlePhotoActive = false;
    document.documentElement.classList.remove("idle-photo");
    if (!idlePhotoAllowed()) return;
    idlePhotoTimer = setTimeout(function () {
      idlePhotoTimer = null;
      if (!idlePhotoAllowed()) return;
      idlePhotoActive = true;
      document.documentElement.classList.add("idle-photo");
    }, IDLE_PHOTO_SECONDS * 1000);
  }
  function idlePhotoInput(e) {
    // a dialog or screen that came forward while the rows were hidden gets its key straight away
    var wakeOnly = idlePhotoActive && idlePhotoAllowed();
    resetIdlePhoto();
    if (wakeOnly && e) {
      e.preventDefault();
      e.stopPropagation();
    }
    return wakeOnly;
  }
  document.addEventListener(PTR + "down", function (e) { idlePhotoInput(e); }, true);
  document.addEventListener(PTR + "move", function (e) {
    if (e.movementX || e.movementY) idlePhotoInput(e);
  }, true);
  document.addEventListener("touchstart", function (e) { idlePhotoInput(e); }, { capture: true, passive: false });

  // ---- Your home: people and the town from a Couch TV Studio account (design-code.js readHome,
  // HOME-DETAILS-PAYLOAD.md). What the last pack left is kept on this TV (tvhome.home.account, page
  // storage and the launcher's own store); the people go into the same list Home settings, People keeps
  // (tvhome.people.list, handed to the bridge or the on-TV app like any change made here) and the town
  // into Home settings, Location (ST.place). Photos stay only in tvhome.home.account: never sent to a
  // bridge, never in a design, never in Share this home.
  // The record (with the photos) goes in the launcher's private store when there is one (TVOS.keepPrivate,
  // left out of Android's backups, as the things typed at home are), else this page's own storage.
  var ACCOUNT_KEY = "tvhome.home.account", ACCOUNT = null;
  function keptAccount() {
    var v = null;
    try { if (TV && TV.keptPrivate) v = TV.keptPrivate(PFX + ACCOUNT_KEY); } catch (e) {}
    if (v == null || v === "") try { v = localStorage.getItem(PFX + ACCOUNT_KEY); } catch (e) {}
    try { v = v ? JSON.parse(v) : null; } catch (e) { v = null; }
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  }
  function keepAccount(rec) {
    var j = JSON.stringify(rec);
    if (TV && TV.keepPrivate) {
      try { TV.keepPrivate(PFX + ACCOUNT_KEY, j); try { localStorage.removeItem(PFX + ACCOUNT_KEY); } catch (e) {} return; } catch (e) {}
    }
    try { localStorage.setItem(PFX + ACCOUNT_KEY, j); } catch (e) {}
  }
  function accountPerson(id) {
    var l = ACCOUNT && Array.isArray(ACCOUNT.people) ? ACCOUNT.people : [];
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
    return null;
  }
  // the list as it is now: the one on screen, else what this TV kept, else config.json's
  function peopleNow() {
    if (PEOPLE.length && !NOBODY) return PEOPLE.map(function (p) { return Object.assign({}, p); });
    var lst = kept("tvhome.people.list");
    if (lst && Array.isArray(lst.people)) return lst.people;
    return Array.isArray(CFG.people) ? CFG.people : [];
  }
  // the guest Wi-Fi as the At home store keeps it (athome.js), or null
  function ahWifiNow() { try { return AH ? AH.store.get().wifi || null : null; } catch (e) { return null; } }
  function homeNow() { return { people: peopleNow(), place: ST.place || null, wifi: ahWifiNow(), account: ACCOUNT }; }
  // what mergeHome worked out, kept: the record (with the photos), the town in Location, the guest Wi-Fi
  // in At home. The people are the caller's (the list on screen changes differently at start and later).
  function keepHome(r) {
    ACCOUNT = r.account;
    keepAccount(ACCOUNT);
    if (r.place) ST.place = r.place; else if (ST.place) { delete ST.place; WXCFG = CFG.weather || WX_DEFAULT; }
    saveSettings();
    if ("wifi" in r && AH) {
      AH.store.edit(function (x) { if (r.wifi) x.wifi = r.wifi; else delete x.wifi; });
      ahChanged();
    }
  }
  // A pack that arrived with a design (held by design-code.js until now). The account wins: its people
  // first, then the ones added on this TV; the town and the guest Wi-Fi too. A wipe takes out only what
  // came from it.
  // base: the people list to merge into. With a bridge (or the on-TV app) that list lives there, so the
  // pack waits for its answer (bridgePeople); with none it is the one this TV keeps (readConfig).
  function takeAccountHome(base) {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.takeHome || PREVIEW || /[?&]designer=1\b/.test(Q)) return false;
    var pack = CouchDesignCode.takeHome();
    if (!pack) return false;
    var now = homeNow();
    if (base) now.people = base;
    var r = CouchDesignCode.mergeHome(now, pack);
    if (!r) return false;
    // pending: the bridge (or the on-TV app) is handed it on the next look, as with a change made here
    keep("tvhome.people.list", { people: r.people, pending: true });
    keep("tvhome.people.order", { ids: r.people.map(function (p) { return p.id; }), pending: false });
    keepHome(r);
    return true;
  }
  // Home settings, People: take everything the account sent off this TV now (as a wipe from the account
  // does): its people, their photos, its town and its guest Wi-Fi. What was added here stays. The next
  // send to this TV brings them back.
  function clearAccountHome() {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.mergeHome) return;
    var r = CouchDesignCode.mergeHome(homeNow(), { v: 1, rev: ACCOUNT && ACCOUNT.rev || 0, wipe: true });
    if (!r) return;
    keepHome(r);
    setPeople(r.people);
    savePeopleList();
    SET.keyFocus = "people-add";
  }

  function setPeople(list) {
    PEOPLE = (list || []).filter(function (p) { return p && p.id && p.name; }).map(function (p) {
      // a person from the account keeps its mark and kids flag even when a bridge's copy dropped them
      var a = accountPerson(p.id);
      if (!a) return p;
      var o = Object.assign({}, p, { src: "account" });
      if (a.kids) o.kid = true; else delete o.kid;
      return o;
    });
    NOBODY = !PEOPLE.length;
    if (NOBODY) PEOPLE = [{ id: "both", name: t("everyone") }];
    PEOPLE.forEach(function (p) { if (!data.showsBy[p.id]) data.showsBy[p.id] = []; if (!data.videosBy[p.id]) data.videosBy[p.id] = []; });
    if (!PEOPLE.some(function (p) { return p.id === who; })) who = PEOPLE[0].id;
  }
  // An order made on this TV with no bridge to keep it (or before the bridge heard about it).
  function localPeopleOrder(list, always) {
    var lo = kept("tvhome.people.order");
    if (!lo || !lo.ids || !(always || lo.pending)) return list;
    var by = {};
    list.forEach(function (p) { by[p.id] = p; });
    var out = lo.ids.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
    return out.concat(list.filter(function (p) { return lo.ids.indexOf(p.id) < 0; }));
  }

  // Which wins, lowest first: the defaults here, config.js (config.json), then Home settings made on
  // this TV (kept by the bridge too when there is one), then ?theme= for a preview. docs/CONFIG.md.
  function readConfig() {
    CFG = window.COUCH_CONFIG || {};
    // Couch TV Studio is opt in (designer-gate.js): until the person at this TV turns it on, no design
    // reaches design.js at all and the home is exactly as it was. A design got by code at this TV
    // (design-code.js, Home settings, Designs, Get a design) wins over one in config.json; it is
    // always asked about first (CouchDesign.start with fromCode).
    var GOT = typeof CouchDesignCode !== "undefined" ? CouchDesignCode.kept() : null;
    GATE = typeof CouchDesigner !== "undefined" ? CouchDesigner.decide({ choice: CouchDesigner.readChoice(kept(CouchDesigner.KEY)),
      cfgDesign: CFG.design, got: GOT, preview: /[?&]designer=1\b/.test(Q) || (MOCK && /[?&]design=local\b/.test(Q)) }) :
      { on: false, design: null, fromCode: false };
    DESIGN_FROM_CODE = !!GATE.fromCode;
    CFG = Object.assign({}, CFG, { design: GATE.design || undefined });
    if (!GATE.design) delete CFG.design;
    HOME = CFG.home || {};
    // a design from Couch TV Studio (design.js, docs/CONFIG.md "Design") may carry look settings of
    // its own (design.home): they win over home in config.json, Home settings still win over both
    if (typeof CouchDesign !== "undefined" && CFG.design) HOME = CouchDesign.home(HOME, CFG.design, { fromCode: DESIGN_FROM_CODE });
    ON_TV = CFG.mode === "on-tv";
    ST = loadSettings();
    ACCOUNT = keptAccount();
    if (OFFLINE || ALONE) takeAccountHome();
    KEEP_PHOTO = typeof ST.keep_photo === "boolean" ? ST.keep_photo : HOME.keep_photo === true;
    var savedIdle = ST.idle_photo_seconds;
    var configuredIdle = HOME.idle_photo_seconds;
    IDLE_PHOTO_SECONDS = IDLE_PHOTO_STEPS.indexOf(savedIdle) >= 0 ? savedIdle :
      (IDLE_PHOTO_STEPS.indexOf(configuredIdle) >= 0 ? configuredIdle : 0);
    SMART_IDLE = normSmartIdle(ST.smart_idle || HOME.smart_idle);
    // the language: Home settings, then config.json, then the TV's own language if the home speaks it
    if (window.I18N) window.I18N.set(ST.lang || HOME.language || window.I18N.device());
    if (CFG.weather) WXCFG = CFG.weather;
    var pl = ST.place;
    if (pl && isFinite(pl.lat) && isFinite(pl.lon)) WXCFG = { lat: pl.lat, lon: pl.lon, place: [pl.name, pl.area].filter(Boolean).join(", "), timezone: pl.timezone || "auto" };
    WX_SHOW = ST.wx_show !== false;
    WX_F = (ST.wx_unit || HOME.wx_unit) === "f";   // Home settings, else home.wx_unit in config.json
    WX_EVERY = [15, 30, 60].indexOf(ST.wx_every) >= 0 ? ST.wx_every : 30;
    WX_AMBIENT = typeof ST.ambient_weather === "boolean" ? ST.ambient_weather : HOME.ambient_weather === true;   // off unless chosen
    WX_SUN_GRADE = typeof ST.ambient_sun_grade === "boolean" ? ST.ambient_sun_grade : HOME.ambient_sun_grade === true;
    var mine = TV_ID || CFG.default_tv;
    TVCFG = (CFG.tvs || []).filter(function (t) { return t.id === mine; })[0] || (CFG.tvs || [])[0] || {};
    // no "quick" from an older bridge: the sleep timer, and the picture switch where the TV has one
    QUICK = (Array.isArray(ST.quick) ? ST.quick : TVCFG.quick || ["sleep", "picture"])
      .filter(function (q, i, a) { return QUICK_ALL.indexOf(q) >= 0 && a.indexOf(q) === i; });
    THEME = (Q.match(/[?&]theme=([a-z]+)/) || [])[1] || lookSetting();
    if (THEME !== "classic" && THEME !== "oled" && THEME !== "loop") THEME = "night";
    // Couch TV Studio's own preview (?designer=1) is there to show a design, and no design runs in
    // the Loop look (start()), so the preview takes the Night look the designs are laid out for
    if (THEME === "loop" && GATE.preview) THEME = "night";
    setLook(THEME);
    GLASS = glassSetting();
    // not in the Loop look: its material is its own (app.css, the Loop section), and the Night glass rules
    // on html.glass outrank it (a slab behind the dock, a pill behind the date line, the glass tint on the
    // quick buttons); the Glass setting is kept for the next Night look
    document.documentElement.classList.toggle("glass", GLASS !== "off" && !LOOP);
    document.documentElement.classList.toggle("glass-lite", GLASS === "lite" && !LOOP);
    // Lighter home: what was chosen in Home settings, else home.lighter, else on for a WebView with no
    // CSS grid (Android 6 and older, a 1 GB box), where blur, soft shadows and drift make it crawl (#59);
    // with none of those, lowEnd() turns it on by itself on a TV it finds low end.
    LIGHTER = typeof ST.lighter === "boolean" ? ST.lighter : typeof HOME.lighter === "boolean" ? HOME.lighter : OLD_ENGINE;
    document.documentElement.classList.toggle("lighter", LIGHTER);
    lowEnd();
    ambientSync();
    movingTiles();
    SHOW_CLOCK = typeof ST.show_clock === "boolean" ? ST.show_clock : HOME.show_clock !== false;   // g17
    clockShown();
    // glass app icons (#25): set in Home settings, else home.glass_icons; off unless switched on
    GLASS_ICONS = typeof ST.glass_icons === "boolean" ? ST.glass_icons : HOME.glass_icons === true;
    NP_ON = typeof ST.now_playing === "boolean" ? ST.now_playing : HOME.now_playing !== false;
    LOCAL_SPOTIFY = !!(OFFLINE && !STANDALONE && HOME.spotify_player === true && TV && TV.spotifyMusic);
    document.documentElement.classList.toggle("spotify-row", LOCAL_SPOTIFY);
    // config.json's spotify block, with each key Home settings saved on top: one saved row (Card alignment, say)
    // never hides the rest of config.json's block, such as enabled
    var spRaw = {}, spSrc = [(CFG && CFG.spotify) || {}, ST.spotify || {}];
    spSrc.forEach(function (o) { if (o && typeof o === "object") Object.keys(o).forEach(function (k) { spRaw[k] = o[k]; }); });
    SPOTIFY = {
      enabled: typeof spRaw.enabled === "boolean" ? spRaw.enabled : false,
      show_card: typeof spRaw.show_card === "boolean" ? spRaw.show_card : true,
      controls: typeof spRaw.controls === "boolean" ? spRaw.controls : true,
      seek_seconds: [5, 10, 15, 30].indexOf(spRaw.seek_seconds) >= 0 ? spRaw.seek_seconds : 10,
      hide_idle: typeof spRaw.hide_idle === "boolean" ? spRaw.hide_idle : false,
      title_mode: ["dots", "pingpong", "continuous"].indexOf(spRaw.title_mode) >= 0 ? spRaw.title_mode : "pingpong",
      show_app: typeof spRaw.show_app === "boolean" ? spRaw.show_app : true,
      align: ["classic", "center", "dock_center"].indexOf(spRaw.align) >= 0 ? spRaw.align : "classic",
      mini_align: ["classic", "right"].indexOf(spRaw.mini_align) >= 0 ? spRaw.mini_align : "classic",
      mini_art: ["square", "wide"].indexOf(spRaw.mini_art) >= 0 ? spRaw.mini_art : "wide",
      scrub_bar: typeof spRaw.scrub_bar === "boolean" ? spRaw.scrub_bar : true,
      show_shuffle_repeat: typeof spRaw.show_shuffle_repeat === "boolean" ? spRaw.show_shuffle_repeat : true,
      adaptive_tint: typeof spRaw.adaptive_tint === "boolean" ? spRaw.adaptive_tint : true,
      waveform: typeof spRaw.waveform === "boolean" ? spRaw.waveform : true,
      card_style: ["compact", "mini"].indexOf(spRaw.card_style) >= 0 ? spRaw.card_style : "compact",
      show_up_next: typeof spRaw.show_up_next === "boolean" ? spRaw.show_up_next : true,
      show_jump_app: typeof spRaw.show_jump_app === "boolean" ? spRaw.show_jump_app : true,
      show_sleep_timer: typeof spRaw.show_sleep_timer === "boolean" ? spRaw.show_sleep_timer : true,
      show_audio_output: typeof spRaw.show_audio_output === "boolean" ? spRaw.show_audio_output : true,
      separate_row: (spRaw.separate_row === false || spRaw.separate_row === "kw") ? "kw" : (spRaw.separate_row === "none" ? "none" : "np"),
      sync_theme_colors: typeof spRaw.sync_theme_colors === "boolean" ? spRaw.sync_theme_colors : false
    };
    applySpotifyAlign();
    // the Keep watching row: Home settings win over home.keep_watching; off hides it and stops fetching it
    KW_ON = typeof ST.keep_watching === "boolean" ? ST.keep_watching : HOME.keep_watching !== false;
    // an Inputs tile first in the dock (#154): Home settings win over home.input_tile; off unless switched on
    INPUT_TILE = typeof ST.input_tile === "boolean" ? ST.input_tile : HOME.input_tile === true;
    document.documentElement.classList.toggle("kw-off", !KW_ON && !CARDS.length);
    // the row follows the app the remote is on: Home settings win over home.shelf_follows_app; off unless switched on
    SHELF_FOLLOW = typeof ST.shelf_follows_app === "boolean" ? ST.shelf_follows_app : HOME.shelf_follows_app === true;
    if (!SHELF_FOLLOW) followPkg = null;
    // the full screen music view is off until it is switched on in Home settings or home.ambient_music
    AMBIENT_MUSIC = typeof ST.ambient_music === "boolean" ? ST.ambient_music : HOME.ambient_music === true;
    // Home settings win over home.keep_watching_style; "card" (the wide glass cards) unless "poster"
    KW_POSTER = (ST.keep_watching_style || HOME.keep_watching_style) === "poster";
    GLASS_FOCUS = (ST.glass_focus || HOME.glass_focus) === "glass" ? "glass" : "colour";
    document.documentElement.classList.toggle("gi-stay", GLASS_FOCUS === "glass");
    SOUND_STYLE = ["system", "soft", "off"].indexOf(ST.nav_sound || HOME.nav_sound) >= 0 ? (ST.nav_sound || HOME.nav_sound) : "system";
    document.documentElement.classList.toggle("glass-icons", GLASS_ICONS);
    GLASS_AMT = glassAmount();
    CLOCK_LIQUID = (ST.clock_style || HOME.clock_style) === "liquid";
    START_FOCUS = ["people", "apps", "keep_watching"].indexOf(ST.start_focus || HOME.start_focus) >= 0 ? (ST.start_focus || HOME.start_focus) : "people";
    glassClasses();
    // a link set in Home settings wins over home.video_url; one from config.json alone means on
    VIDEO_URL = typeof ST.video_url === "string" ? ST.video_url : typeof HOME.video_url === "string" ? HOME.video_url : "";
    VIDEO_ON = !!VIDEO_URL && (typeof ST.video === "boolean" ? ST.video : true) && !LOOP;   // the Loop look has its own clip
    ICON_SET = ICON_SETS.indexOf(ST.icon_set) >= 0 ? ST.icon_set : ICON_SETS.indexOf(HOME.icon_set) >= 0 ? HOME.icon_set : "builtin";
    GRID_COLS = NIGHT ? 12 : 8;
    DOCK_APPS = Math.max(1, Math.min(10, parseInt(HOME.dock_size, 10) || 10));
    DOCK_BANNERS = NIGHT && !LOOP && (typeof ST.dock_banners === "boolean" ? ST.dock_banners : HOME.dock_banners === true);
    document.documentElement.classList.toggle("dock-banners", DOCK_BANNERS);
    initSoundscape();
    if (smartOn()) DOCK_APPS = Math.min(DOCK_APPS, 9);   // the Smart home tile takes one place in the dock
    CLOCK24 = clock24();
    CLOCK_SECONDS = typeof ST.clock_seconds === "boolean" ? ST.clock_seconds : HOME.clock_seconds === true;
    (Array.isArray(HOME.hide_packages) ? HOME.hide_packages : []).forEach(function (p) {
      if (typeof p === "string" && HIDDEN.indexOf(p) < 0) HIDDEN.push(p);
    });
    // home.show_packages: bring an app back that the built-in list hides (the Google TV app, say). Never this app itself.
    (Array.isArray(HOME.show_packages) ? HOME.show_packages : []).forEach(function (p) {
      var i = typeof p === "string" && p !== "app.couchtv.launcher" ? HIDDEN.indexOf(p) : -1;
      if (i >= 0) HIDDEN.splice(i, 1);
    });
    HIDDEN_TV = (Array.isArray(ST.hidden_apps) ? ST.hidden_apps : []).filter(function (p) { return typeof p === "string"; });
    SCENE_LIB = BUILT_IN.concat(myScenes(HOME.my_scenes));
    if (HOME.bing_daily_background === true && TV && TV.dailyBingPhoto) SCENE_LIB.push(BING_SCENE);
    var st = sceneState();
    SCENES = st.order.filter(function (id) { return st.off.indexOf(id) < 0; }).map(sceneById).filter(Boolean);
    if (!SCENES.length) SCENES = [SCENE_LIB[0]];
    SCENE_MS = Math.max(5, parseInt(ST.scene_seconds || HOME.scene_seconds, 10) || 20) * 1000;
    SUN_SYNC = typeof ST.sun_sync === "boolean" ? ST.sun_sync : !!HOME.sun_sync;
    var people = CFG.people || [{ id: "person1", name: "Person 1" }, { id: "person2", name: "Person 2" }];
    // people added, renamed or removed in Home settings with no bridge to keep them
    var lst = kept("tvhome.people.list");
    if (lst && Array.isArray(lst.people) && (lst.pending || ALONE)) people = lst.people;
    setPeople(localPeopleOrder(people, OFFLINE));
    newApps = kept("tvhome.apps.new") || [];
  }
  function lookSetting() {
    var l = ST.look || kept("tvhome.look") || HOME.look || "night";
    return (l === "classic" || l === "oled" || l === "loop") ? l : "night";
  }
  // The Loop look (docs/TV-HOME.md, "The Loop look") is laid out like Night (the dock, the row of
  // cards, the More apps panel), so NIGHT stays true in it; LOOP switches off what Night draws over
  // its photos (the scenes, the glass clock, the drift, the ambient lighting, home.video_url) and
  // puts the loop's clip, scrim and glass in their place. html.theme-loop and body.theme-loop carry
  // its rules in app.css; the Night, Classic and OLED looks keep theirs.
  function setLook(theme) {
    THEME = theme;
    LOOP = THEME === "loop";
    NIGHT = THEME === "night" || LOOP;
    OLED = THEME === "oled";
    var root = document.documentElement;
    root.classList.toggle("theme-night", NIGHT);
    root.classList.toggle("theme-oled", OLED);
    root.classList.toggle("theme-loop", LOOP);
    if (document.body) document.body.classList.toggle("theme-loop", LOOP);
  }
  function glassAmount() {
    var n = parseInt(ST.glass_amount != null ? ST.glass_amount : HOME.glass_amount, 10);
    return n >= 1 && n <= 5 ? n : 3;
  }
  function glassClasses() {
    var r = document.documentElement;
    for (var i = 1; i <= 5; i++) r.classList.toggle("ga-" + i, GLASS_AMT === i);
    if (r.classList.contains("clock-liquid") !== CLOCK_LIQUID) { r.classList.toggle("clock-liquid", CLOCK_LIQUID); glassShown = ""; }
  }
  function movingTiles() {
    MOVING = LIGHTER ? false : typeof ST.moving_tiles === "boolean" ? ST.moving_tiles : typeof HOME.moving_tiles === "boolean" ? HOME.moving_tiles : GLASS !== "lite";
    document.documentElement.classList.toggle("still", !MOVING);
    // Mac-style dock (Home settings, Look; home.dock "mac"): off unless chosen, held off by Lighter home
    DOCK_MAC = !LIGHTER && (ST.dock || HOME.dock) === "mac";
    if (LOOP) DOCK_MAC = false;   // the Loop dock has no wave
    DATE_BARS = HOME.date_bars === true;
    document.documentElement.classList.toggle("dock-mac", DOCK_MAC);
    if (typeof magnify === "function") magnify();
  }
  var DOCK_MAC = false;
  // Home settings, Look, Show the clock (g17; home.show_clock): off hides the time in every look, the big
  // scene clock in Night too, and the date moves up into its place. A design shows its own clock, so not there.
  var SHOW_CLOCK = true;
  function clockShown() {
    var off = !SHOW_CLOCK && !(typeof CouchDesign !== "undefined" && CouchDesign.on());
    if (document.documentElement.classList.contains("no-clock") !== off) document.documentElement.classList.toggle("no-clock", off);
  }
  function applySpotifyAlign() {
    var isMini = (SPOTIFY.card_style || "compact") === "mini";
    var al = SPOTIFY.align || "classic";
    var isCenter = !isMini && al === "center";
    var isDockCenter = !isMini && al === "dock_center";
    var isMiniRight = isMini && (SPOTIFY.mini_align || "classic") === "right";
    document.documentElement.classList.toggle("spotify-align-center", isCenter);
    document.documentElement.classList.toggle("spotify-align-dock-center", isDockCenter);
    document.documentElement.classList.toggle("np-mini-right", isMiniRight);
    if (NIGHT) {
      var sEl = $("shelf-section");
      if (sEl) {
        if (isCenter) {
          var gEl = $("grid");
          if (gEl && gEl.offsetWidth > 0) sEl.style.width = gEl.offsetWidth + "px";
        } else {
          sEl.style.width = "";
        }
      }
    }
  }
  var DATE_BARS = false;   // home.date_bars: thin vertical bars between the day, the place and the weather
  // Lighter home: ask for the 640 px size of a Keep watching picture, not the 1440 px one (a card is about 500 px wide)
  function slim(u) { return LIGHTER && typeof u === "string" ? u.replace("/s1440/", "/s640/") : u; }
  // A Keep watching picture that does not load is asked for again a little later, up to six times
  // (about a minute and a quarter), instead of staying broken until the row is drawn again (#274):
  // just after a TV restart the home is up before the Wi-Fi and the apps' picture providers are.
  // Nothing waits meanwhile. The app's art route (tvos.invalid/art/<token>) reads only the last
  // path segment, so a query makes it a fresh request; any other address is set again as it was.
  var ART_RETRY_MS = [1500, 3000, 6000, 12000, 20000, 30000];
  window.kwArtRetry = function (img) {
    var n = +(img.getAttribute("data-retry") || 0);
    if (n >= ART_RETRY_MS.length) {
      img.onerror = null;
      // given up on a Loop look card's picture: the plate with the app's icon, like a card that had none
      var box = img.parentNode, badge = box && box.querySelector ? box.querySelector(".lbadge") : null;
      if (box && box.classList && box.classList.contains("lthumb")) {
        if (badge) badge.className = "picon";
        box.removeChild(img);
        box.classList.add("plate");
      } else kwArtGone(img);
      KW_GAVE_UP = true;   // asked for again when the home comes back into view or the network returns (g03)
      return;
    }
    var src = img.getAttribute("data-src") || img.getAttribute("src") || "";
    if (!src) return;
    img.setAttribute("data-src", src);
    img.setAttribute("data-retry", String(n + 1));
    setTimeout(function () {
      // the row was drawn again meanwhile, with a new picture (not isConnected: Chrome 53, webOS 4, lacks it)
      if (!document.documentElement.contains(img)) return;
      if (src.indexOf("//tvos.invalid/art/") >= 0) img.src = src + "?r=" + (n + 1);
      else { img.removeAttribute("src"); img.src = src; }
    }, ART_RETRY_MS[n]);
  };
  // g03 (a Sony KD43X75WL, #274): a Night or Classic card whose picture never came was left as an
  // empty tile. It shows the app's own banner instead, and if that is missing too, the show's title.
  var KW_GAVE_UP = false;
  function kwArtGone(img) {
    var pkg = img.getAttribute("data-pkg"), ban = pkg && !img.getAttribute("data-banner") ? iconUrl(pkg) : null;
    if (ban) {
      img.setAttribute("data-banner", "1");
      img.setAttribute("data-err", "kwgone");
      img.classList.add("kw-banner");
      img.src = ban;
      return;
    }
    var p = img.parentNode, s = document.createElement("span");
    if (!p) return;
    if (img.classList.contains("thumb")) s.className = "thumb none";
    else { s.className = "no-art"; s.textContent = img.getAttribute("data-title") || ""; }
    p.replaceChild(s, img);
  }
  // the home is back in view, or the network is: a row with given up pictures is drawn again, so each
  // picture gets its tries again (the first ones ran out while the TV was still starting)
  function kwArtAgain() {
    if (!KW_GAVE_UP || zone === "shelfmenu") return;
    KW_GAVE_UP = false;
    renderShelf();
    if (zone === "shelf") paintFocus();
  }
  window.kwArtGone = kwArtGone;
  if (window.addEventListener) window.addEventListener("online", kwArtAgain);
  if (document.addEventListener) document.addEventListener("visibilitychange", function () { if (!document.hidden) kwArtAgain(); });
  function glassSetting() { var g = ST.glass || HOME.glass; return g === "on" || g === "lite" ? g : "off"; }
  // no clock in Home settings or config.json: the TV's own setting, else the one usual for the language (24 hour in Italian, German, Turkish, French, Serbian, Polish and Brazilian Portuguese)
  // On the Android home the TV's own 12 or 24 hour setting (System, Date and time) comes before the language's usual clock (#221)
  function systemClock() { try { if (TV && typeof TV.is24Hour === "function") return TV.is24Hour() ? "24h" : "12h"; } catch (e) {} return ""; }
  function clock24() { return (ST.clock || HOME.clock || systemClock() || (window.I18N ? window.I18N.clock() : "12h")) === "24h"; }

  // ---------------- helpers ----------------
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // The saved copy has its own storage, so the app order is also kept by the launcher (TVOS.keep).
  function load() {
    if (MOCK || PREVIEW) return null;
    try {
      if (OFFLINE) return TV && TV.kept ? { order: (JSON.parse(TV.kept(CACHE_KEY) || "null") || {}).order || null } : null;
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch (e) { return null; }
  }
  function save() {
    if (MOCK || PREVIEW || OFFLINE) return;
    var j = JSON.stringify({ showsBy: data.showsBy, videosBy: data.videosBy, screens: data.screens, order: data.order });
    try { localStorage.setItem(CACHE_KEY, j); } catch (e) {}
    try { if (TV && TV.keep) TV.keep(CACHE_KEY, j); } catch (e) {}
  }
  function mark(name) { try { performance.mark(name); } catch (e) {} }

  function api(method, path, body, timeoutMs) {
    if (TV_ID) {
      if (method === "GET") path += (path.indexOf("?") < 0 ? "?" : "&") + "tv=" + TV_ID;
      else body = Object.assign({ tv: TV_ID }, body || {});
    }
    if (MOCK && window.MOCK_API) return window.MOCK_API(method, path, body);
    // previews on a computer read the real bridge but never change it
    if (PREVIEW && method !== "GET") return Promise.resolve({ ok: true, note: "" });
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, API + path);
      x.timeout = timeoutMs || 6000;
      x.setRequestHeader("Content-Type", "application/json");
      if (KEY) x.setRequestHeader("Authorization", "Bearer " + KEY);
      x.onload = function () {
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300 && j && j.ok !== false) resolve(j);
        else {
          var err = new Error((j && j.error) || t("bridge_no", { status: x.status }));
          if (j && j.error_key) { err.key = j.error_key; err.vars = j.error_vars; }
          if (j && typeof j === "object") err.reply = j;   // the whole answer (matter.js reads its reason and note)
          reject(err);
        }
      };
      x.onerror = function () {
        var err = new Error(t("bridge_down"));
        err.key = "bridge_down";
        reject(err);
      };
      x.ontimeout = function () {
        var err = new Error(t("bridge_slow"));
        err.key = "bridge_slow";
        reject(err);
      };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  function devWarn(d) {
    var el = $("devwarn");
    if (!d || !d.warning) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "devwarn"; document.body.appendChild(el); }
    el.className = "devwarn " + (d.level || "warn");
    // the bridge sends a key and numbers (warning_key / warning_vars) so this is in the home's language;
    // the English sentence is kept for a key this home does not know yet
    var said = d.warning_key ? t(d.warning_key, d.warning_vars) : d.warning;
    el.textContent = said === d.warning_key ? d.warning : said;
  }
  function status(text, sticky) {
    clearTimeout(statusTimer);
    $("status").textContent = text || "";
    if (text && !sticky) statusTimer = setTimeout(function () { status(data.bridge === false && !ALONE ? t("computer_quiet") : "", true); }, 6000);
  }

  function iconUrl(pkg) {
    if (!pkg) return null;
    if (TV) return TV.iconUrl ? TV.iconUrl(pkg) : "http://tvos.invalid/icon/" + pkg;   // Samsung: samsung/app/tizen.js
    return window.MOCK_ICON ? window.MOCK_ICON(pkg) : null;
  }

  // ---------------- the photo, the clock and the big title ----------------
  // Free Creative Commons photos (backgrounds/CREDITS.md), in the order they rotate.
  var PHOTOS = [
    { file: "tessellated-pavement", place: "Tessellated Pavement, Tasmania", by: "JJ Harrison" },
    { file: "grose-valley", place: "Grose Valley, Blue Mountains", by: "Diliff" },
    { file: "albury-storm", place: "Storm at sunset, Albury", key: "photo_albury", by: "Thennicke" },
    { file: "aresquiers-beach", place: "Aresquiers beach, France", key: "photo_aresquiers", by: "Christian Ferrer" },
    { file: "vang-vieng-sunset", place: "Vang Vieng, Laos", by: "Basile Morin" }
  ];
  var PHOTO_MS = 90000;

  // A 4K screen gets the 4K copies of the built-in pictures (the same names with @2x added before
  // the extension). The
  // page is laid out at 1920x1080 but drawn at devicePixelRatio 2 there, so the 1080 files were
  // stretched and looked soft (couch-tv#8, a UHD LG). Your own scenes in mine/ have no 4K copy.
  var HI_RES = (window.devicePixelRatio || 1) * window.innerWidth >= 3000;
  // home.hi_res "always" uses the 4K copies even when the page is drawn at 1080 (a 4K panel with a 1080 interface, #191)
  // home.hi_res false keeps the 1080 copies on a 4K screen whose chip struggles with 3840x2160 photos
  // (an LG 43SQ700S monitor): they are four times the pixels to decode and keep in memory.
  // Home settings, Look, Sharp pictures on a 4K TV (g30) wins: "auto", "always" or "off"; else home.hi_res
  function hiResSetting() {
    var v = ST.hi_res === "auto" || ST.hi_res === "always" || ST.hi_res === "off" ? ST.hi_res : HOME.hi_res;
    return v === "always" ? "always" : v === false || v === "off" ? "off" : "auto";
  }
  function bgPath(name, ext, builtIn) { var h = hiResSetting(); return "backgrounds/" + name + ((h === "always" || (HI_RES && h !== "off")) && builtIn !== false ? "@2x" : "") + ext; }
  var KEEP_PHOTO = false;   // Home settings, Look, Keep one photo (Classic): no rotation, same picture after a reload
  var photo = 0, photoTimer = null, bgShown = null, bgLayer = 0, bgTicket = 0;

  function photoForHour(h) {   // sunrise in the morning, green by day, sunsets in the evening
    if (h >= 5 && h < 9) return 0;
    if (h >= 9 && h < 13) return 1;
    if (h >= 13 && h < 17) return 2;
    if (h >= 17 && h < 19) return 3;
    if (h >= 19 && h < 22) return 5;
    return 4;
  }

  function setBg(url, isShow) {
    if (!url || url === bgShown) return;
    var ticket = ++bgTicket;   // only the latest request may land
    var pre = new Image();
    pre.onload = function () {
      if (ticket !== bgTicket) return;
      var box = $("bg");
      while (box.children.length < 2) { var im = document.createElement("img"); im.alt = ""; box.appendChild(im); }
      var next = box.children[bgLayer = 1 - bgLayer], prev = box.children[1 - bgLayer];
      next.src = url;
      next.classList.toggle("show", !!isShow);
      next.classList.add("on");
      prev.classList.remove("on");
      bgShown = url;
    };
    pre.src = url;
  }

  // Classic: the household's own photos (Home settings) when there are any, else the five above.
  function classicPhotos() {
    var own = ownScenes().filter(function (s) { return sceneState().off.indexOf(s.id) < 0; });
    if (!own.length) return PHOTOS;
    return own.map(function (s) { return { src: s.src, place: t("scene_photo", { n: s.n }), by: "" }; });
  }

  function photoKey(p) { return String(p.src || p.file || ""); }
  function pickedPhoto() {   // the index of the photo kept, or -1 when it is gone (the household removed it)
    var list = classicPhotos(), k = ST.keep_photo_pick;
    if (!k) return -1;
    for (var i = 0; i < list.length; i++) if (photoKey(list[i]) === k) return i;
    return -1;
  }

  function showPhoto() {
    if (NIGHT) { $("place").textContent = ""; return; }   // the scenes carry their own photos
    if (KEEP_PHOTO) { var at = pickedPhoto(); if (at >= 0) photo = at; }
    var list = classicPhotos(), p = list[photo % list.length];
    setBg(p.src || bgPath(p.file, ".jpg"), false);
    $("place").textContent = (p.key ? t(p.key) : p.place) + (p.by ? "  ·  " + t("photo_by", { by: p.by }) : "");
  }

  function nextPhoto() {
    if (KEEP_PHOTO) return;
    photo = (photo + 1) % classicPhotos().length;
    if (zone !== "shelf") showPhoto();
  }

  // Open-Meteo gives Celsius; Fahrenheit is worked out here when Home settings asks for it.
  function tempText(c) { return WX_F ? Math.round(c * 9 / 5 + 32) + "°F" : c + "°"; }
  function wxText(w) { var k = WMO_KEY[w.code]; return k ? t(k) : (w.text || ""); }

  // The town as the home draws it: only the place's own name, the part before the first comma
  // ("Ballarat", never "Ballarat, City of Ballarat, Victoria, Australia": a searched name that long ran to the right edge on
  // a TCL, 23 Nov 2026). Home settings, Location keeps the full name, so two towns of one name can be told apart.
  function weatherPlace() {
    return String((WXCFG && WXCFG.place) || "").split(",")[0].trim();
  }

  // Every 15 s: redraw only on a new minute, and only while the home can be seen. The redraw sets
  // two innerHTMLs and forces a few layouts (fitDate, the glass clock), which a 2 GB box felt four
  // times a minute for a display that changes once. tv.resume() redraws straight away.
  var clockMinute = "";
  function secondsText(d) {
    var s = d.getSeconds();
    return ":" + (s < 10 ? "0" : "") + s;
  }
  function secondsMarkup(d) {
    return CLOCK_SECONDS ? '<span class="clock-seconds">' + secondsText(d) + "</span>" : "";
  }
  function updateClockSeconds() {
    if (!active()) return;
    var d = new Date();
    if (d.getHours() + ":" + d.getMinutes() !== clockMinute) { clock(); return; }
    var text = secondsText(d);
    Array.prototype.forEach.call(document.querySelectorAll(".clock-seconds"), function (el) {
      if (el.textContent !== text) el.textContent = text;
    });
  }
  function syncClockSeconds() {
    clearInterval(clockSecondsTimer);
    clockSecondsTimer = CLOCK_SECONDS ? setInterval(updateClockSeconds, 1000) : null;
  }
  function clockTick() {
    if (!active()) return;
    refreshBingScene();
    var d = new Date(), minute = d.getHours() + ":" + d.getMinutes();
    if (minute === clockMinute && !(NIGHT && !glassShown)) return;   // glassShown blank: a glass setting changed
    clock();
  }
  function clock() {
    // the date line's separator: a no-break space before the dot keeps it with the word before it, so a
    // line that wraps never starts with "·" (Couch Night, launch audit 0.13.9: a town and the temperature)
    var DOT = "\u00a0· ";
    if (typeof clockShown === "function") clockShown();   // a design that has just come on or gone shows its own clock
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    clockMinute = h + ":" + m;
    var mm = (m < 10 ? "0" : "") + m;
    var CD = typeof CouchDesign !== "undefined" && CouchDesign.on() ? CouchDesign : null;
    var c24 = CD ? CD.clock24(CLOCK24) : CLOCK24;   // a design's clock format wins (design.js)
    var hm = c24 ? (h < 10 ? "0" : "") + h + ":" + mm : (h % 12 || 12) + ":" + mm;
    var clockText = hm + secondsMarkup(d) + (c24 ? "" : "<small>" + esc(h < 12 ? t("am") : t("pm")) + "</small>");
    $("time").innerHTML = clockText;
    var loc = window.I18N ? window.I18N.locale() : "en-AU";
    var lang = window.I18N ? window.I18N.lang() : "en";
    var day = d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
    if (lang !== "ro") day = day.replace(",", "");
    day = day.charAt(0).toUpperCase() + day.slice(1);   // "lunes 27 de octubre" starts a line on screen
    if (CD) day = CD.day(d, day, loc);   // a design's date format (design.js)
    var w = NIGHT && WX_SHOW && data.weather && data.weather.temp != null ? data.weather : null;
    var place = w ? weatherPlace() : "";
    // a long town name ends in "..." (.wx-town, app.css), never pushing the line past the screen
    var town = function (p) { return '<span class="wx-town">' + esc(p) + "</span>"; };
    var date = $("date");
    if (lang === "ro" && (place || w)) {
      var weatherParts = [place, w && tempText(w.temp), w && wxText(w)].filter(Boolean);
      date.classList.add("weather-lines");
      date.innerHTML = '<span class="dline"><span class="date-label">' + esc(day) +
        '</span><span class="wx">' + weatherParts.map(esc).join(DOT) + "</span></span>";
    } else {
      date.classList.remove("weather-lines");
      var bar = DATE_BARS ? '<i class="vbar"></i>' : "";
      date.innerHTML = '<span class="dline">' + esc(day) + (w ? '<span class="wx">' + bar +
        (place ? '<span class="wx-place">' + (DATE_BARS ? town(place) + bar : DOT + town(place) + DOT) + "</span>" : "") + wxIcon(w) + esc(tempText(w.temp)) +
        '<span class="ww">' + (DATE_BARS ? " " : DOT) + esc(wxText(w)) + "</span></span>" : "") +
        // no town yet (never a made up one): say once, in the weather's place, where to pick it
        (!w && NIGHT && WX_SHOW && !CD && !wxPlaceSet() ? '<span class="wx wx-ask">' + bar + (DATE_BARS ? "" : DOT) + esc(t("wx_ask", { home: t("gear_home"), loc: t("sec_location") })) + "</span>" : "") + "</span>";
    }
    var ic = $("idle-clock"), idate = $("idle-date"), iwx = $("idle-wx");
    if (ic) ic.innerHTML = clockText;
    if (idate) idate.textContent = day;
    if (iwx) {
      var wIdle = WX_SHOW && data.weather && data.weather.temp != null ? data.weather : null;
      var placeIdle = wIdle ? weatherPlace() : "";
      iwx.textContent = wIdle ? ([placeIdle, tempText(wIdle.temp), wxText(wIdle)].filter(Boolean).join(DOT)) : "";
    }
    var iov = $("idle-ambient-overlay");
    if (iov) iov.classList.toggle("quiet-hours", isQuietHours(SMART_IDLE.quiet_hours));
    fitDate();
    mood(false);

    if (window.Reminders) window.Reminders.tick();
    document.body.classList.toggle("night", h >= 21 || h < 6);
    if (NIGHT) { glassClock(hm); if (SUN_SYNC) applySunSync(); updateAmbientWeather(); }
    if (quickReady) renderQuick();
  }

  // Night: five lock screen scenes take turns every 20 s (home.scenes picks which and in what
  // order, home.scene_seconds how long each stays). Each has its own photo,
  // a big glass clock and (most) a cut-out of the photo that stands in front of the clock. The clock's
  // fill is the frosted copy of the photo exactly behind each digit, so it is re-aligned whenever the
  // time changes or a scene is about to show. Only the scene showing and the next one are drawn.
  // Files: backgrounds/<photo>.jpg, and optionally <photo>-glass.jpg and <photo>-fg.webp.
  var SCENE_LIB = [
    // Photos are the generated scene-*.jpg set in backgrounds/. Drop your own 1920x1080 JPEGs in there
    // and name them here. Each one can have:
    //   fg: true     backgrounds/<photo>-fg.webp, a transparent copy of everything in front of the sky
    //                (peaks, trees, hills), drawn over the clock so the scenery overlaps its digits
    //   glass: true  backgrounds/<photo>-glass.jpg, a blurred and brightened copy of the photo used
    //                as the clock's frosted fill (without it the fill is the photo itself)
    //   water: 0.55  the waterline, as a share of the screen height: above it the clock is sharp,
    //                below it a blurred copy shows like a reflection
    // Your own scenes are not listed here: tools/make-scene.py makes them and home.my_scenes in
    // config.json names them (myScenes() below, docs/MAKE-A-SCENE.md).
    // Each scene's clock and date positions are in app.css (.s-<id>, .scene-<id> .date).
    { id: "night", photo: "scene-night", fg: true, glass: true },
    { id: "golden", photo: "scene-golden", fg: true, glass: true },
    { id: "water", photo: "scene-water", fg: false, glass: true, water: 0.55 },   // the underside of the surface
    { id: "fog", photo: "scene-fog", fg: true, glass: true },
    { id: "dawn", photo: "scene-dawn", fg: true, glass: true }
  ];
  var BUILT_IN = SCENE_LIB.slice();   // readConfig() adds your own scenes to SCENE_LIB
  var BING_SCENE = { id: "bing-daily", photo: "scene-night", own: true, dailyBing: true };
  var SCENES = SCENE_LIB.slice(), SCENE_MS = 20000, SUN_SYNC = false;
  var scene = 0, sceneEls = [], glassShown = "", lastKeyAt = 0;

  // Your own scenes (home.my_scenes in config.json), made with tools/make-scene.py: the photo, glass
  // copy and cut-out in backgrounds/mine/, and how its clock looks. Anything odd falls back to the
  // built-in look, and the clock is kept above Keep watching and the dock whatever the numbers say.
  // A scene whose photo is not on this TV leaves the turns by itself (lostScene below).
  function myScenes(list) {
    var taken = BUILT_IN.map(function (s) { return s.id; }).concat(["own", "mine"]), out = [];
    var share = function (v, lo, hi, d) { return typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    (Array.isArray(list) ? list : []).forEach(function (m) {
      if (!m || typeof m.id !== "string" || !/^[a-z0-9]{1,24}$/.test(m.id) || taken.indexOf(m.id) >= 0) return;
      taken.push(m.id);
      var c = m.clock && typeof m.clock === "object" ? m.clock : {};
      var size = share(c.size, 0.2, 0.45, 0.37);   // the digits' font size, as a share of the screen height
      var below = m.date === "below", inter = c.font === "inter";
      // the top of the clock, as a share of the screen height. The digits' ink ends 0.92 of the
      // font size below it (Antonio; Inter 0.77), and must end above Keep watching, as on the
      // waterline scene; with the date below, the date must fit too.
      var y = share(c.y, 0.12, 0.6, 0.14);
      y = Math.max(0.12, Math.min(y, 0.62 - (inter ? 0.77 : 0.92) * size - (below ? 0.06 : 0)));
      // cutout: true only when make-scene.py made the cut-out (scene-<id>-fg.webp); without it the
      // clock is simply drawn over the photo
      out.push({ id: m.id, photo: "mine/scene-" + m.id, fg: m.cutout === true, glass: true, mine: true, n: out.length + 1,
        name: typeof m.name === "string" ? m.name.slice(0, 40) : "",
        x: ["left", "right"].indexOf(c.x) >= 0 ? c.x : "centre", y: y, size: size,
        inter: inter, weight: Math.round(share(c.weight, 100, 900, 600) / 100) * 100,
        below: below, dark: m.text === "dark",
        // video: true plays backgrounds/mine/scene-<id>.mp4 (muted, looping) over the photo, under
        // the cut-out and the clock, while this scene is the one on screen
        video: m.video === true,
        // when: dawn, day, dusk or night. With Follow the sun, an own scene tagged like this joins the built-in
        // scene for that time of day, and the home steps through the group (home.sun_rotate_minutes)
        when: ["dawn", "day", "dusk", "night"].indexOf(m.when) >= 0 ? m.when : "" });
    });
    return out;
  }
  function sceneClass(s) { return s.own ? "own" : s.mine ? "mine" : s.id; }

  // The household's own photos (Home settings, "Your photos") are scenes too, with no cut-out and
  // no glass copy: the clock's fill is the photo itself, frosted in app.css (.s-own).
  function photoSrc(p) {
    // a photo the phone's Home settings page sent to the home computer (bridge/phonepage.py): from there
    if (p.file && /^bridge[a-z0-9]+\.jpg$/.test(p.file) && !OFFLINE) return API + "/api/photo/" + encodeURIComponent(p.file) + (KEY ? "?key=" + encodeURIComponent(KEY) : "");
    return p.file ? "http://tvos.invalid/photo/" + encodeURIComponent(p.file) : p.url;
  }
  function ownScenes() {
    return (Array.isArray(ST.photos) ? ST.photos : []).filter(function (p) { return p && p.id && (p.file || p.url); })
      .map(function (p, i) { return { id: "p-" + p.id, src: photoSrc(p), own: true, n: i + 1, fg: false, glass: false }; });
  }
  function sceneById(id) { return SCENE_LIB.concat(ownScenes()).filter(function (s) { return s.id === id; })[0] || null; }
  // Which scenes take turns and in what order: Home settings (scene_order, scenes_off) when set,
  // else home.scenes from config.json, with anything not listed there switched off.
  function sceneState() {
    var all = SCENE_LIB.concat(ownScenes()), ids = all.map(function (x) { return x.id; });
    var uniq = function (id, i, a) { return ids.indexOf(id) >= 0 && a.indexOf(id) === i; };
    var order, off;
    if (Array.isArray(ST.scene_order)) {
      order = ST.scene_order.filter(uniq);
      order = order.concat(ids.filter(function (id) { return order.indexOf(id) < 0; }));
      off = (Array.isArray(ST.scenes_off) ? ST.scenes_off : []).filter(function (id) { return ids.indexOf(id) >= 0; });
    } else if (ids.indexOf(BING_SCENE.id) >= 0) {
      order = ids;
      off = ids.filter(function (id) { return id !== BING_SCENE.id; });
    } else {
      // your own scenes (home.my_scenes) are always on: listed in home.scenes they go where they
      // are listed, otherwise after the built-in ones
      var lib = SCENE_LIB.map(function (x) { return x.id; }), builtIn = BUILT_IN.map(function (x) { return x.id; });
      var pick = (HOME.scenes || []).filter(function (id, i, a) { return lib.indexOf(id) >= 0 && a.indexOf(id) === i; });
      if (!pick.length) pick = builtIn;
      order = pick.concat(ids.filter(function (id) { return pick.indexOf(id) < 0; }));
      off = builtIn.filter(function (id) { return pick.indexOf(id) < 0; });
    }
    return { order: order, off: off, all: all };
  }
  function cssUrl(u) { return 'url("' + String(u).replace(/["\\\n]/g, encodeURIComponent) + '")'; }

  function buildScenes() {
    var box = $("scenes");
    sceneEls = SCENES.map(function (s) {
      var el = document.createElement("div");
      el.className = "scene s-" + sceneClass(s);
      el.innerHTML = '<img class="sbg" alt="">' + (s.video ? '<video class="svid" muted loop playsinline preload="none"></video>' : "") +
        '<div class="shade"></div><div class="gclock"></div>' +
        (s.water ? '<div class="gclock under"></div>' : "") + (s.fg ? '<img class="fg" alt="">' : "");
      if (s.mine) {   // your own scene: its clock from config.json (app.css, "your own scenes")
        el.className += " x-" + s.x + (s.inter ? " f-inter" : "") + (s.dark ? " t-dark" : "");
        el.style.setProperty("--my-top", s.y * 100 + "vh");
        el.style.setProperty("--my-size", s.size * 100 + "vh");
        el.style.setProperty("--my-weight", s.weight);
      }
      watchImage(el.querySelector(".sbg"), s, true);
      var fg = el.querySelector(".fg");
      if (fg) watchImage(fg, s, false);
      box.appendChild(el);
      return el;
    });
  }

  // A scene picture that did not arrive. Your own scene: the file is not on this TV, so the scene
  // leaves the turns (lostScene) or the clock stays in front without its cut-out. A built-in one
  // was lost on the way (seen on a Fire TV Cube over weak Wi-Fi, where it left a black scene for
  // the whole turn): ask again after 2, 6 and 15 s, and if the scene on screen still has no photo,
  // move on to the next one. A picture whose src was taken away (unreadyScene) is not an error.
  var RETRY_MS = [2000, 6000, 15000];
  function watchImage(img, s, isPhoto) {
    img.onerror = function () {
      var src = img.getAttribute("src");
      if (!src) return;
      if (s.mine) { if (isPhoto) lostScene(s); else img.style.display = "none"; return; }
      var tries = parseInt(img.dataset.tries || "0", 10);
      if (tries < RETRY_MS.length) {
        setTimeout(function () {
          if (!img.getAttribute("src")) return;   // released meanwhile: nothing to retry
          var base = src.replace(/([?&])retry=\d+$/, "$1").replace(/[?&]$/, "");
          img.dataset.tries = tries + 1;
          img.src = base + (base.indexOf("?") < 0 ? "?" : "&") + "retry=" + (tries + 1);
        }, RETRY_MS[tries]);
      } else {
        if (isPhoto && s.own) PHOTO_FAIL[s.id] = true;   // its row in Home settings, Look says so (g05)
        if (isPhoto && SCENES[scene] === s && SCENES.length > 1) showScene(nextFrom(scene));
      }
    };
    img.onload = function () { delete img.dataset.tries; };
  }

  /** The scene's photo is in and drawable. */
  function photoIn(el) {
    var img = el.querySelector(".sbg");
    return !!img && img.complete && img.naturalWidth > 0;
  }

  // Resolves once the scene's photo is in (or failed, or 8 s passed): a fade only starts when there
  // is something to fade to, instead of a black scene while the photo is still on its way.
  function sceneLoaded(el, ms) {
    var img = el.querySelector(".sbg");
    if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();
    return new Promise(function (done) {
      var t = setTimeout(done, ms);
      var fin = function () { clearTimeout(t); img.removeEventListener("load", fin); img.removeEventListener("error", fin); done(); };
      img.addEventListener("load", fin); img.addEventListener("error", fin);
    });
  }

  // A scene that has faded out gives its pictures back: the decoded 1920x1080 photo, the cut-out
  // with its alpha and the clock's frosted fill are what a scene costs in GPU memory, and a scene
  // keeping them while it waits is why a 2 GB Fire TV Cube swung 115 to 260 MB at every change.
  // readyScene puts them back (from the browser's cache) when its turn comes near.
  function unreadyScene(k) {
    var el = sceneEls[k];
    if (!el || !el.classList.contains("ready")) return;
    el.classList.remove("ready");
    Array.prototype.forEach.call(el.querySelectorAll("img"), function (img) { img.removeAttribute("src"); delete img.dataset.tries; });
    Array.prototype.forEach.call(el.querySelectorAll(".gclock .fill"), function (f) { f.style.backgroundImage = ""; });
    delete el.dataset.hm;
  }

  // An own scene whose photo is not on this TV (option A with an app built before the scene was
  // made, or a scene named in config.json but not made yet) leaves the turns instead of showing black.
  function lostScene(s) {
    s.lost = true;
    if (SCENES.every(function (x) { return x.lost; })) {
      SCENES = [BUILT_IN[0]];
      $("scenes").innerHTML = "";
      buildScenes();
      scene = 0;
      switching = false; pendingScene = -1;   // a fade still waiting for a lost photo is over (its scene element is gone)
      showScene(0);
    } else if (SCENES[scene] === s && pendingScene < 0) showScene(nextFrom(scene));
    // a lost scene a fade is waiting for: that fade moves on by itself (showScene)
  }
  function nextFrom(i) {
    for (var k = 1; k <= SCENES.length; k++) if (!SCENES[(i + k) % SCENES.length].lost) return (i + k) % SCENES.length;
    return i;
  }

  // draw a scene (load its pictures, place its clock) so it can fade in
  function readyScene(i) {
    var s = SCENES[i], el = sceneEls[i];
    if (!el.classList.contains("ready")) {
      var sbg = el.querySelector(".sbg");
      if (s.dailyBing) s.src = bingPhotoUrl() || s.src;
      if (s.src) sbg.src = s.src;
      else if (s.mine) {
        // an own scene may carry a 4K copy, scene-<id>@2x.jpg (make-scene.py --4k). On a 4K screen it is
        // tried first, and the 1080 file is used if it is not there, so scenes made before this keep working.
        var lo = bgPath(s.photo, ".jpg", false), hi = bgPath(s.photo, ".jpg", true);
        if (hi !== lo) sbg.onerror = function () { sbg.onerror = null; sbg.src = lo; };
        sbg.src = hi;
      } else sbg.src = bgPath(s.photo, ".jpg", true);
      if (s.fg) el.querySelector(".fg").src = bgPath(s.photo + "-fg", ".webp", !s.mine);
      el.classList.add("ready");
      // decoded now, while the scene waits at opacity 0, rather than when its fade starts
      Array.prototype.forEach.call(el.querySelectorAll("img"), function (img) { if (img.decode && img.src) img.decode().catch(function () {}); });
      drawClocks(el, s, glassShown);
    } else if (el.dataset.hm !== glassShown) drawClocks(el, s, glassShown);   // already drawn with this time: nothing to do
  }

  function bingPhotoUrl() {
    var version = TV.dailyBingPhoto();
    return /^[0-9]{8}$/.test(version) ? "http://tvos.invalid/bing-daily-photo/" + version : "";
  }

  // The native cache keeps the last photo until Bing sends a valid replacement. Preload that
  // replacement before changing the visible photo or the fill of the glass clock.
  var pendingBingPhoto = "";
  function refreshBingScene() {
    var s = SCENES[scene], el = sceneEls[scene];
    if (!s || !s.dailyBing || !el || pendingBingPhoto) return;
    var url = bingPhotoUrl();
    if (!url || url === s.src) return;
    pendingBingPhoto = url;
    var image = new Image();
    image.onload = function () {
      pendingBingPhoto = "";
      s.src = url;
      if (!el.classList.contains("ready")) return;
      el.querySelector(".sbg").src = url;
      drawClocks(el, s, glassShown);
    };
    image.onerror = function () { pendingBingPhoto = ""; };
    image.src = url;
  }

  function drawClocks(el, s, hm) {
    if (!hm) return;
    el.dataset.hm = hm;
    var cs = el.querySelectorAll(".gclock");
    var digits = hm + secondsMarkup(new Date());
    for (var k = 0; k < cs.length; k++) {
      var c = cs[k];
      c.innerHTML = '<span class="edge">' + digits + '</span><span class="fill">' + digits + '</span><span class="sheen">' + digits + '</span><span class="rim">' + digits + "</span>";
      var f = c.querySelector(".fill"), ex = c.offsetLeft + f.offsetLeft, ey = c.offsetTop + f.offsetTop;
      if (CLOCK_LIQUID) {
        // Liquid glass (#25): the sharp photo seen through the digits, magnified LENS times about
        // the clock's middle, the way a thick clear glass bends what is behind it. Clear amounts
        // 1 and 2 use the frosted copy instead, so the glass reads as frosted.
        var cx = c.offsetLeft + c.offsetWidth / 2, cy = c.offsetTop + c.offsetHeight / 2, LENS = 1.07;
        var frost = GLASS_AMT <= 2 && s.glass && !s.src;
        f.style.backgroundImage = s.src ? cssUrl(s.src) : "url(backgrounds/" + s.photo + (frost ? "-glass" : "") + ".jpg)";
        f.style.backgroundSize = LENS * 100 + "vw " + LENS * 100 + "vh";
        f.style.backgroundPosition = (-ex - (LENS - 1) * cx) + "px " + (-ey - (LENS - 1) * cy) + "px";
      } else {
        f.style.backgroundImage = s.src ? cssUrl(s.src) : "url(backgrounds/" + s.photo + (s.glass ? "-glass" : "") + ".jpg)";
        f.style.backgroundPosition = -ex + "px " + -ey + "px";
      }
      // a design moves and sizes the clock and may set its own background: design.js lines the
      // glass up again from where the digits really are
      if (typeof CouchDesign !== "undefined" && CouchDesign.on()) CouchDesign.fill(c, f, s, CLOCK_LIQUID);
    }
    if (s.water) {   // above the waterline sharp, below it the blurred reflection
      // The digits hang below the clock's box (its line height is tight), so the clips reach past
      // the box on the open sides; a plain inset cut the bottom of the numbers off .
      var line = innerHeight * s.water - cs[0].offsetTop, out = "-50%";
      cs[0].style.clipPath = "inset(" + out + " " + out + " " + (cs[0].offsetHeight - line) + "px " + out + ")";
      cs[1].style.clipPath = "inset(" + line + "px " + out + " " + out + " " + out + ")";
    }
  }

  function glassClock(hm) {
    if (hm === glassShown) return;
    glassShown = hm;
    sceneEls.forEach(function (el, i) { if (el.classList.contains("ready")) drawClocks(el, SCENES[i], hm); });
  }

  // ---------------- the Loop look (home.look "loop"; docs/TV-HOME.md, "The Loop look") ----------------
  // One clip of a place, graded for dawn, day, dusk and night by make-loop.sh on the bridge computer
  // (docs/LOOP.md), plays full screen under one fixed scrim. The bridge says which variants it has in
  // config.js as home.loop = { variants: [...], blur: true|false }; the files are loop/<v>.mp4 (LOOP_DIR),
  // <v>-blur.mp4 (a 160x90 blurred copy), <v>.jpg and <v>-blur.jpg (the posters). The variant follows
  // sunPhase() while Follow the sun (sun_sync) is on, else it is day. A change is a cut at the loop
  // boundary, held while keys are moving (sceneMayChange), with the new posters decoded beforehand.
  // Glass: the blurred copy plays in a second <video> inside a container the size of the quick
  // buttons, shown through an SVG mask of their shapes, so nothing is blurred per frame. Measured on
  // a Fire TV Cube (2 GB) in the launcher's WebView: the sharp 720p clip alone cost the launcher
  // about 80 MB of GL textures and 21 percent CPU (PSS 156 MB, no dropped frames); the blur copy
  // masked to the two buttons 2 MB and 10 percent more; the same mask at toast size 18 MB more with
  // the compositor running every frame. So only the buttons are glass; the toast and the rest take
  // the no blur recipe (app.css). No prefetch and no crossfade: a fetch would hold 20 MB on the heap
  // and a crossfade is four decoders at once.
  // Depth: a photo's loop made with --matte has <v>-fg.png, the part of its first frame in front of the
  // sky around the clock (scrim baked in), and the bridge passes loop.json as home.loop.meta with
  // home.loop.fg true. The cut-out is drawn over the clock and moved by the loop's own formula on the
  // compositor, locked to the video's clock, so the clock sits behind the peak (loopFgInit, below).
  // The files' folder: a page with a bridge address (?api=, the LG and Samsung builds) asks that bridge
  // for /tv/loop/; any other page asks next to itself, which is /tv/loop/ on the bridge and in the
  // launcher's offline copy (both serve the page under /tv/) and /loop/ on the standalone site
  var LOOP_DIR = API ? API + "/tv/loop/" : "loop/", LOOP_PHASES = ["dawn", "day", "dusk", "night"], loopVersion = "";
  var loopVariants = [], loopBlurOn = false, loopCur = "", loopPending = "", loopArmed = false, loopPoster = "", loopOff = false;
  var loopMeta = null, loopFgOn = false, loopFg = null, loopFgStandIn = "";
  var loopSharp = null, loopBlur = null, loopBox = null, loopMaskKey = null, loopLastT = 0, loopSeekLat = 0, loopSeekAt = 0, loopFirstRow = 0;
  var loopGlassIdle = false;   // no quick button shows: the glass box is hidden and the blur copy paused (loopMask)
  var loopLoadTimer = 0, loopLoadOne = null;   // the load under way: its 4 s timer and its canplaythrough listener
  function loopFiles(v) {
    // the bridge's mark of the files (home.loop.version) goes on each address, so new files made by
    // make-loop.sh are fetched although the old ones are still good for an hour in the TV's cache
    var q = loopVersion ? "?v=" + encodeURIComponent(loopVersion) : "";
    return { video: LOOP_DIR + v + ".mp4" + q, blur: LOOP_DIR + v + "-blur.mp4" + q, poster: LOOP_DIR + v + ".jpg" + q, bposter: LOOP_DIR + v + "-blur.jpg" + q,
      fg: loopFgStandIn || LOOP_DIR + v + "-fg.png" + q };
  }
  // home.loop from config.js; a missing key is no variants, and Lighter home never plays the blur copy
  function loopReadConfig() {
    var lp = HOME.loop && typeof HOME.loop === "object" ? HOME.loop : {};
    loopVariants = (Array.isArray(lp.variants) ? lp.variants : []).filter(function (v) { return LOOP_PHASES.indexOf(v) >= 0; });
    loopBlurOn = lp.blur === true && !LIGHTER;
    loopVersion = typeof lp.version === "string" ? lp.version.slice(0, 40) : "";
    loopMeta = loopMetaOf(lp.meta);
    loopFgOn = lp.fg === true && !!(loopMeta && loopMeta.fg);
  }
  // home.loop.meta (the bridge checked loop.json already): the numbers the cut-out needs, or null
  function loopMetaOf(m) {
    var num = function (v) { return typeof v === "number" && isFinite(v); };
    if (!m || typeof m !== "object" || !num(m.seconds) || m.seconds <= 0 || !num(m.zoom) || !num(m.sway)) return null;
    var r = m.fg, fg = r && typeof r === "object" && num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
    return { seconds: m.seconds, zoom: m.zoom, sway: m.sway, fg: fg };
  }
  // which variant to show now: the sun's phase while Follow the sun is on, else day; a missing file
  // falls back to day, then to the first the bridge has
  function loopVariant() {
    if (!loopVariants.length) return "";
    var want = SUN_SYNC ? sunPhase() : "day";
    if (loopVariants.indexOf(want) >= 0) return want;
    if (loopVariants.indexOf("day") >= 0) return "day";
    return loopVariants[0];
  }
  // the accent (the progress fill, the Now playing dot, the sleep timer count): the weather code, and
  // for a clear sky the same sunPhase() that picks the variant, so the two never disagree at twilight
  function loopAccent() {
    var code = data.weather && data.weather.code;
    if (code == null || !isFinite(code)) return "#F2A33C";
    code = Number(code);
    if (code >= 95) return "#C9A3FF";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "#DCE8F5";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "#7FB2E5";
    if (code === 45 || code === 48) return "#A9B4C2";
    if (code <= 3) return { dawn: "#F2B463", day: "#7CC4F5", dusk: "#F08A6B", night: "#8E9CFF" }[sunPhase()] || "#F2A33C";
    return "#F2A33C";
  }
  function loopVideoEl(id) {
    var el = document.createElement("video");
    el.id = id; el.className = id;
    el.muted = true; el.loop = true;
    el.setAttribute("muted", ""); el.setAttribute("loop", ""); el.setAttribute("playsinline", "");
    el.setAttribute("preload", "auto"); el.setAttribute("aria-hidden", "true");
    return el;
  }
  // start(): the sharp clip at the back of the page, and with blur the glass container just over the scrim
  function loopInit() {
    loopReadConfig();
    var root = document.documentElement;
    root.style.setProperty("--accent", loopAccent());
    loopFg = null; loopFgStandIn = ""; loopOff = false; loopGlassIdle = false;
    root.classList.remove("loop-depth");
    if (MOCK && !loopVariants.length) {
      // a preview with no files: a still stands in, and with depth on (mock.js) the Night look's whole
      // frame cut-out of it stands in for the cut-out
      loopPoster = "backgrounds/scene-night.jpg";
      if (loopFgOn) loopFgStandIn = "backgrounds/scene-night-fg.webp";
    }
    var v = loopVariant();
    if (!v) console.log("loop: the bridge has no loop files (docs/LOOP.md): the scrim" + (loopPoster ? " over a still" : " alone"));
    loopSharp = loopVideoEl("loop-video");
    loopSharp.onerror = function () { console.log("loop: " + loopCur + ".mp4 did not play, the poster stays"); };
    loopSharp.addEventListener("timeupdate", loopTimeUpdate);
    // the cut-out follows the video's clock: running from its time once it plays, held where it is
    // when it stops or waits for data (a wrap is caught in loopTimeUpdate). waiting comes with paused
    // still false, so loopFgRun holds on readyState, not on paused
    loopSharp.addEventListener("playing", loopFgRun);
    loopSharp.addEventListener("pause", loopFgRun);
    loopSharp.addEventListener("waiting", loopFgRun);
    document.body.insertBefore(loopSharp, document.body.firstChild);
    if (loopFgOn && (v || loopFgStandIn)) loopFgInit();
    if (loopBlurOn && v) {
      loopBox = document.createElement("div");
      loopBox.id = "loop-glass"; loopBox.className = "loop-glass"; loopBox.setAttribute("aria-hidden", "true");
      loopBlur = loopVideoEl("loop-blur");
      loopBlur.onerror = loopNoGlass;
      loopBox.appendChild(loopBlur);
      var scrim = document.querySelector(".scrim");
      scrim.parentNode.insertBefore(loopBox, scrim.nextSibling);
      root.classList.add("loop-glass");
    }
    if (v) loopLoad(v);
    else if (loopPoster) loopSharp.setAttribute("poster", loopPoster);
    if (loopFgStandIn) loopFg.src = loopFgStandIn;
    // a kids profile on the couch at start (kidSync ran before this): the posters only, until it leaves
    if (loopHidden()) loopPause();
  }
  // The cut-out: one <img> right after the clock in the header (so it paints over the clock and under
  // the date line and the buttons), at its rectangle from loop.json in rem (the page's rem is 1/120 of
  // the width, 16 design pixels), scaled about the screen's centre.
  // Its motion. zoompan shows, at loop time t (T the loop's length, s = sin(2*PI*t/T)), the window of
  // the picture (width iw) of width iw/z from X = (iw - iw/z)/2 * (1 + sway*s), with
  // z = 1 + zoom*(1 - cos(2*PI*t/T))/2 (sway is a share of the room the zoom leaves on each side, so
  // ffmpeg never clamps the window; make-loop.sh). A point at screen x p at the neutral position (z 1,
  // X 0; the first frame, which the cut-out and the poster are) is at picture x p*iw/W (W the screen
  // width), so on screen it is at (p*iw/W - X) * z*W/iw = z*p - (z - 1)*W/2*(1 + sway*s)
  // = W/2 + z*(p - W/2) - sway*(z - 1)/2*W*s: scaled by z about the centre, then moved by
  // -sway*(z - 1)/2*W*s. CSS reads translateX(a) scale(z) right to left, the scale about the transform
  // origin first and then the move, which is that mapping with a = -(sway*(z - 1)/2*100vw)*s. The sign:
  // as the window moves right (s > 0) the picture moves left.
  function loopFgInit() {
    var m = loopMeta.fg, img = document.createElement("img"), st = img.style, time = $("time");
    img.id = "loop-fg"; img.className = "loop-fg"; img.alt = "";
    img.setAttribute("aria-hidden", "true");
    st.left = m.x / 16 + "rem"; st.top = m.y / 16 + "rem"; st.width = m.w / 16 + "rem"; st.height = m.h / 16 + "rem";
    st.transformOrigin = (960 - m.x) / 16 + "rem " + (540 - m.y) / 16 + "rem";
    // the stand-in is the whole frame, so it is cut to the rectangle make-loop.sh writes (x 480, y 162,
    // w 960, h 318): the header is above the row and the dock, and the whole lake would hide them
    if (loopFgStandIn) st.clipPath = st.webkitClipPath = "inset(" + [162 - m.y, m.x + m.w - 1440, m.y + m.h - 480, 480 - m.x].map(function (n) { return Math.max(0, n) / 16 + "rem"; }).join(" ") + ")";
    img.onerror = function () { console.log("loop: the cut-out " + img.src + " did not load, the clock goes back up"); img.classList.add("failed"); document.documentElement.classList.remove("loop-depth"); };
    img.onload = function () { img.classList.remove("failed"); document.documentElement.classList.add("loop-depth"); };
    time.parentNode.insertBefore(img, time.nextSibling);
    if (!document.getElementById("loop-depth-kf")) {
      var kf = document.createElement("style");
      kf.id = "loop-depth-kf";
      kf.textContent = loopKeyframes(loopMeta);
      document.head.appendChild(kf);
    }
    loopFg = img;
    document.documentElement.classList.add("loop-depth");
    loopFgHold();
  }
  // the motion as @keyframes, a stop every 2.5 percent (41 with both ends, played linear): the curves
  // between two stops are off by 0.11 px at most at the cut-out's corners
  function loopKeyframes(m) {
    var out = "@keyframes loop-depth {";
    for (var i = 0; i <= 40; i++) {
      var a = 2 * Math.PI * i / 40, z = 1 + m.zoom * (1 - Math.cos(a)) / 2, x = -(m.sway * (z - 1) / 2 * 100) * Math.sin(a);
      out += " " + i * 2.5 + "% { transform: translateX(" + (+x.toFixed(5)) + "vw) scale(" + (+z.toFixed(6)) + "); }";
    }
    return out + " }";
  }
  // the animation for loop time t: started t seconds in (a negative delay), running or held there
  function loopFgAnim(t, run) {
    var T = loopMeta.seconds;
    t = isFinite(t) && t > 0 ? t % T : 0;
    return "loop-depth " + T + "s linear " + (-t).toFixed(3) + "s infinite " + (run ? "running" : "paused");
  }
  // set again from scratch (none, a reflow, then the animation), since a changed delay alone does not
  // move a running animation
  function loopFgSet(anim) {
    var st = loopFg.style;
    st.animation = "none";
    void loopFg.offsetWidth;
    st.animation = anim;
  }
  // the video's poster is frame 0, the neutral position: held there while a file loads
  function loopFgHold() { if (loopFg) loopFgSet(loopFgAnim(0, false)); }
  // on the video's playing, pause and waiting, and at each wrap: its time now, running only while it
  // plays. A stall (waiting, or play() from loopLoad's 4 s timer before the file can play) leaves paused
  // false but readyState under HAVE_FUTURE_DATA (3), with the frame standing still: held there too
  function loopFgRun() {
    if (!loopFg || !loopSharp || loopOff) return;
    var s = loopSharp;
    loopFgSet(loopFgAnim(s.currentTime, !s.paused && !s.ended && s.readyState >= 3));
  }
  // puts a variant on both elements: per element pause, let go of the file (load() frees the codec), the
  // poster, then the file; one play() for both once each can play through, or after 4 s. A load that
  // comes while another is under way (the screen off and on again inside 4 s, a cut right after a
  // resume) first drops the earlier one's timer and listeners, so its play() cannot start this one early
  function loopLoad(v) {
    if (loopOff) return;   // let go (loopPause): loopResume loads again on the way back
    loopCur = v; loopPending = ""; loopArmed = false; loopLastT = 0;
    var f = loopFiles(v), els = [loopSharp, loopBlur].filter(Boolean), ready = 0, started = false;
    clearTimeout(loopLoadTimer);
    if (loopLoadOne) els.forEach(function (el) { el.removeEventListener("canplaythrough", loopLoadOne); });
    if (loopFg) { loopFg.src = f.fg; loopFgHold(); }   // swapped with the posters (decoded with them in loopTick)
    var go = function () {
      if (started || loopLoadOne !== one) return;   // done, or a later load took over
      started = true; clearTimeout(loopLoadTimer); loopLoadTimer = 0; loopLoadOne = null;
      els.forEach(function (el) {
        el.removeEventListener("canplaythrough", one);
        if (el === loopBlur && loopGlassIdle) return;   // no button to show it: it waits (loopMask)
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      });
      if (loopBlur && !loopGlassIdle) loopAlign();
    };
    var one = function () { if (++ready >= els.length) go(); };
    loopLoadOne = one;
    els.forEach(function (el, i) {
      el.pause();
      el.removeAttribute("src");
      try { el.load(); } catch (e) {}
      el.setAttribute("poster", i ? f.bposter : f.poster);
      el.addEventListener("canplaythrough", one);
      el.src = i ? f.blur : f.video;
    });
    loopLoadTimer = setTimeout(go, 4000);
  }
  // once a minute (clock()): the accent, and the variant for this phase. A new one has its posters
  // decoded now (new Image, decode) and goes on at the next loop boundary (loopTimeUpdate); the
  // playing one wanted again (Follow the sun switched off before the cut) drops what was pending
  function loopTick() {
    document.documentElement.style.setProperty("--accent", loopAccent());
    var v = loopVariant();
    if (!loopSharp || !v) return;
    if (v === loopCur) { loopPending = ""; loopArmed = false; return; }
    if (v === loopPending) return;
    loopPending = v; loopArmed = false;
    var f = loopFiles(v), imgs = (loopBlur ? [f.poster, f.bposter] : [f.poster]).concat(loopFg ? [f.fg] : []), done = 0;
    var fin = function () { if (++done >= imgs.length && loopPending === v) loopArmed = true; };
    imgs.forEach(function (src) {
      var im = new Image();
      im.onload = function () { if (im.decode) im.decode().then(fin, fin); else fin(); };
      im.onerror = fin;
      im.src = src;
    });
  }
  // the loop boundary: ended, a timeupdate within 0.3 s of the end, or the time went back (a wrap)
  function loopAtBoundary(el) {
    var now = el.currentTime, d = el.duration, wrapped = now < loopLastT - 1;
    loopLastT = now;
    return { at: !!el.ended || wrapped || (isFinite(d) && d > 0 && d - now < 0.3), wrapped: wrapped };
  }
  // Nothing while let go: loopPause's load() moves the time back to 0 and queues a timeupdate, which
  // would read as a wrap and could load an armed variant behind the cover
  function loopTimeUpdate() {
    if (loopOff) return;
    var b = loopAtBoundary(loopSharp);
    if (b.at && loopPending && loopArmed && sceneMayChange()) { loopLoad(loopPending); return; }
    if (b.wrapped) loopFgRun();
    if (loopBlur && !loopGlassIdle) loopSync(b.wrapped);
  }
  // keeps the blur copy on the sharp clip, read at each timeupdate (4 Hz): under 0.2 s nothing, up to
  // 0.5 s a 3 percent rate pull, above that a seek; after a wrap one seek, since the two stall apart
  function loopSync(wrapped) {
    var b = loopBlur, s = loopSharp;
    if (wrapped) { loopAlign(); return; }
    if (loopSeekAt && Date.now() - loopSeekAt > 2000) loopSeekAt = 0;   // a seek that never reported back
    if (b.seeking || loopSeekAt) return;
    var d = b.currentTime - s.currentTime;
    if (Math.abs(d) < 0.2) { if (b.playbackRate !== 1) b.playbackRate = 1; }
    else if (Math.abs(d) <= 0.5) b.playbackRate = d > 0 ? 0.97 : 1.03;
    else loopAlign();
  }
  // a seek lands late by what the decoder takes (up to 29 frames of a 1 s GOP): measured on the first
  // seek, added to the next ones
  function loopAlign() {
    var b = loopBlur, s = loopSharp;
    if (!b || !s) return;
    b.playbackRate = 1;
    var want = s.currentTime + loopSeekLat;
    if (isFinite(b.duration) && b.duration > 0) want = want % b.duration;
    loopSeekAt = Date.now();
    var onSeeked = function () {
      b.removeEventListener("seeked", onSeeked);
      if (!loopSeekLat) loopSeekLat = Math.min(0.5, (Date.now() - loopSeekAt) / 1000);
      loopSeekAt = 0;
    };
    b.addEventListener("seeked", onSeeked);
    try { b.currentTime = want; } catch (e) { loopSeekAt = 0; }
  }
  // the glass container and its mask: the bounding box of the quick buttons, and one SVG of their
  // shapes. Made again only when a button appears or leaves (key: which buttons show), never on focus:
  // the focus platter is opaque and covers the glass
  function loopMask(key) {
    if (!loopBox || key === loopMaskKey) return;
    loopMaskKey = key;
    var rects = loopGlassRects();
    // no button shows (home.quick empty, or none available): the box hides and the blur copy stops,
    // keeping its file; when buttons come back it plays again, seeked to the sharp clip
    if (!rects.length) { loopBox.style.display = "none"; loopGlassIdle = true; loopBlur.pause(); return; }
    if (loopGlassIdle) {
      loopGlassIdle = false;
      if (!loopOff && loopSharp && !loopSharp.paused && loopBlur.getAttribute("src")) {
        var p = loopBlur.play();
        if (p && p.catch) p.catch(function () {});
        loopAlign();
      }
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    var w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      rects.map(function (r) {
        return '<rect x="' + (r.x - x0) + '" y="' + (r.y - y0) + '" width="' + r.w + '" height="' + r.h + '" rx="' + r.rx + '" fill="#000"/>';
      }).join("") + "</svg>";
    var url = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    var st = loopBox.style;
    st.display = ""; st.left = x0 + "px"; st.top = y0 + "px"; st.width = w + "px"; st.height = h + "px";
    st.webkitMaskImage = url; st.maskImage = url;
    // the blurred copy keeps the sharp clip's cover geometry: full screen, moved up and left by the box
    var vs = loopBlur.style;
    vs.left = -x0 + "px"; vs.top = -y0 + "px"; vs.width = innerWidth + "px"; vs.height = innerHeight + "px";
  }
  // the glass shapes: each quick button's box as laid out (offsets, so a focused button's scale does
  // not reach the mask), with half its height as the radius (a circle, or a pill while a timer runs)
  function loopGlassRects() {
    var box = $("qbtns"), out = [];
    if (!box || $("quick").classList.contains("none")) return out;
    var b = box.getBoundingClientRect();
    Array.prototype.forEach.call(box.children, function (el) {
      var w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      out.push({ x: b.left + el.offsetLeft - box.offsetLeft, y: b.top + el.offsetTop - box.offsetTop, w: w, h: h, rx: h / 2 });
    });
    return out;
  }
  // Lighter home switched on while the look is up (Home settings, or lowEnd() deciding after the home
  // drew): the blur copy goes the same way. Switched off again, the glass comes back at the next start
  // (loopInit reads the setting once), so the page is never asked to make a second decoder on the fly
  function loopLighter() {
    if (LIGHTER) loopNoGlass();
    loopBlurOn = loopBlurOn && !LIGHTER;
  }
  // no blur after all (the file failed, or did not play): no container, no mask, and the buttons take
  // the darker tint (app.css, html without loop-glass)
  function loopNoGlass() {
    if (loopBlur) { loopBlur.pause(); loopBlur.removeAttribute("src"); try { loopBlur.load(); } catch (e) {} }
    if (loopBox && loopBox.parentNode) loopBox.parentNode.removeChild(loopBox);
    loopBox = null; loopBlur = null; loopMaskKey = null; loopGlassIdle = false;
    document.documentElement.classList.remove("loop-glass");
  }
  // an app or the screensaver in front, the screen off, the ambient clock or kids mode over the home: both
  // clips let go of their files and decoders (the Cube's launcher measured about 100 MB lighter with them
  // gone); the posters stay for the way back. A load still under way is dropped first, so its 4 s timer
  // cannot play() the emptied clips, and the last time goes back to 0 with them
  function loopPause() {
    if (!loopSharp || loopOff) return;
    loopOff = true; loopLastT = 0;
    clearTimeout(loopLoadTimer); loopLoadTimer = 0;
    if (loopLoadOne) [loopSharp, loopBlur].forEach(function (el) { if (el) el.removeEventListener("canplaythrough", loopLoadOne); });
    loopLoadOne = null;
    [loopSharp, loopBlur].forEach(function (el) {
      if (!el) return;
      el.pause(); el.removeAttribute("src"); try { el.load(); } catch (e) {}
      el.classList.add("off");
    });
    if (loopFg) { loopFg.style.animation = "none"; loopFg.classList.add("off"); }   // hidden with the videos (app.css)
  }
  function loopResume() {
    if (!loopSharp || !loopOff || !active() || loopHidden()) return;
    loopOff = false;
    [loopSharp, loopBlur].forEach(function (el) { if (el) el.classList.remove("off"); });
    if (loopFg) { loopFg.classList.remove("off"); loopFgHold(); }   // at the poster's position until the video plays
    if (loopCur) loopLoad(loopVariant() || loopCur);   // the phase may have moved on while the home was covered
  }
  // the page shows but something opaque of its own covers the home: Smart Idle's ambient clock, or kids
  // mode's shelf (which also hides the header, and with it the cut-out, so its animation starts again
  // from loopResume's hold and the video's playing, in step)
  function loopHidden() { return idleAmbientActive || kidsOn(); }
  // the ambient clock or kids mode came or went (setIdleAmbient, kidSync, kidsUnlocked)
  function loopCover() {
    if (!LOOP) return;
    if (loopHidden()) loopPause(); else loopResume();
  }
  // More apps as a panel: three rows of twelve show, and the grid moves by whole rows on a transform
  // inside the panel's plain rectangular clip (app.css), so the focused row is always in view. The clip
  // leaves room round the tiles for the focused one's ring and label, so it does not hide the rows
  // above and below the three: they carry .off-window (hidden, app.css)
  function loopPanel() {
    var grid = $("grid"), i;
    if (!expanded) {
      loopFirstRow = 0; grid.style.transform = "";
      for (i = 0; i < gridEls.length; i++) gridEls[i].classList.remove("off-window");
      return;
    }
    var inGrid = zone === "grid" || zone === "gear" || zone === "appmenu";
    var row = inGrid ? Math.floor(g / GRID_COLS) : loopFirstRow, rows = Math.ceil(gridEls.length / GRID_COLS);
    if (row < loopFirstRow) loopFirstRow = row;
    if (row > loopFirstRow + 2) loopFirstRow = row - 2;
    loopFirstRow = Math.max(0, Math.min(loopFirstRow, Math.max(0, rows - 3)));
    grid.style.transform = loopFirstRow ? "translateY(" + (-loopFirstRow * 8.5) + "rem)" : "";
    var from = loopFirstRow * GRID_COLS, to = from + 3 * GRID_COLS;
    for (i = 0; i < gridEls.length; i++) gridEls[i].classList.toggle("off-window", i < from || i >= to);
  }
  // a card's second line: the app, then the season and episode, the episode's name, or Video or Live
  // for a YouTube video ("HBO Max · S1 E3", "YouTube · Live")
  function loopSub(it) {
    var live = it.live === true || it.kind === "live";
    var what = live ? t("live_card") : it.kind === "video" ? t("video_card") :
      it.season && it.episode ? "S" + it.season + " E" + it.episode : (it.episode_title || "");
    return [it.app && it.app.name, what].filter(Boolean).join(" · ");
  }

  // ---------------- the video background (Home settings, Look; home.video_url) ----------------
  // A muted clip that loops in place of the photo, in both looks. The photo stays until the clip
  // really plays, and comes back if it fails or has not started within 20 s. It pauses while the
  // home is not on screen (the launcher calls tv.pause, and the page's own visibility).
  var vidTimer = null;
  function greenTv() { return !!(window.CouchVideo && CouchVideo.greenMarked && CouchVideo.greenMarked()); }
  function startVideo() {
    var v = $("bgvid"), root = document.documentElement;
    if (LOOP) loopResume();
    if (!VIDEO_ON) return;
    if (greenTv()) { stopVideo(); return; }   // this TV showed a clip as green this week: the photo (g33)
    if (v.getAttribute("src") !== VIDEO_URL) {
      root.classList.remove("has-video");
      v.onplaying = function () {
        clearTimeout(vidTimer); root.classList.add("has-video");
        if (window.CouchVideo && CouchVideo.watchGreen) CouchVideo.watchGreen(v, stopVideo);
      };
      v.onerror = stopVideo;
      v.src = VIDEO_URL;
      clearTimeout(vidTimer);
      vidTimer = setTimeout(function () { if (!root.classList.contains("has-video")) stopVideo(); }, 20000);
    }
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }
  function stopVideo() {
    var v = $("bgvid");
    clearTimeout(vidTimer);
    VIDEO_ON = false;
    document.documentElement.classList.remove("has-video");
    v.pause();
    v.removeAttribute("src");
    try { v.load(); } catch (e) {}
  }
  // g18 (a Fire TV Stick 4K Max): the app opened from a video link took the TV's video decoder, and the
  // paused clip came back as a black frame with the photo still hidden under it. Now the clip lets go
  // of the decoder while the home is away, and the photo shows again until the clip really plays.
  function releaseBgVideo() {
    var v = $("bgvid");
    clearTimeout(vidTimer);
    document.documentElement.classList.remove("has-video");
    if (!v.getAttribute("src")) return;
    v.pause();
    v.removeAttribute("src");
    try { v.load(); } catch (e) {}
  }
  function pauseVideo() { stopSoundscape(); if (window.AmbientWeather) window.AmbientWeather.pause(); releaseBgVideo(); sceneVideos(false); if (LOOP) loopPause(); }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { saveFocusNow(); pauseVideo(); }
    else { setIdleAmbient(false); resetSmartIdle(); startVideo(); clipWake(); sceneVideos(true); mood(true); if (window.AmbientWeather) window.AmbientWeather.resume(); resetIdlePhoto(); }
  });

  // A scene's own clip (home.my_scenes[].video): only the scene on screen plays, and only while the
  // home is showing. The photo under it stays until the clip really plays; a clip that fails just
  // leaves the photo. The whole-home video (home.video_url), the OLED and Classic looks, the ambient
  // clock, screen off and the system's reduced motion setting leave clips off. Lighter home does
  // too, unless home.scene_clips_lighter is true (a small clip the TV decodes in hardware).
  // A playing <video> makes the WebView hold KEEP_SCREEN_ON, which stops Android's own screensaver
  // from ever starting. So clips pause on their current frame after the Home settings "Home screen
  // idle after" time (Smart Idle, the quiet hours one during quiet hours) without a key press, and
  // play on with the next key. Set to Off, they pause after 15 minutes so the screensaver still can.
  var clipsIdle = false, clipIdleTimer = null;
  function clipWake() {
    clearTimeout(clipIdleTimer);
    var was = clipsIdle;
    clipsIdle = false;
    var qh = SMART_IDLE.quiet_hours;
    var mins = qh && qh.enabled && isQuietHours(qh) ? qh.idle_minutes : SMART_IDLE.home_idle_minutes;
    if (!mins) mins = 15;
    // home.scene_clips_idle false: the clips never pause and nothing starts the TV's screensaver
    if (HOME.scene_clips_idle === false) mins = 0;
    // Letting go of KEEP_SCREEN_ON counts as user activity, so Android's own countdown would only
    // start now. Where the screensaver button can work, start the TV's screensaver right away.
    if (mins > 0) clipIdleTimer = setTimeout(function () {
      clipsIdle = true;
      sceneVideos(false);
      // Smart Idle on: its own action (ambient clock, screen off, TV off) runs, not the TV's screensaver
      if (SMART_IDLE.enabled || document.hidden || screenOffActive || idleAmbientActive || soundscapePlaying()) return;
      try { if (TV && TV.canStartScreensaver && TV.canStartScreensaver()) TV.startScreensaver(); } catch (e) {}
    }, mins * 60000);
    if (was) sceneVideos(true);
  }
  function sceneVideos(on) {
    var calm = false;
    try { calm = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
    on = on && NIGHT && !calm && !idleAmbientActive && !screenOffActive && !clipsIdle && !greenTv();
    var lighterOff = LIGHTER && HOME.scene_clips_lighter !== true;
    var curEl = sceneEls[scene];
    var curClip = !!(on && curEl && curEl.querySelector(".svid") && !lighterOff && !VIDEO_ON && !document.hidden && !(SCENES[scene] && SCENES[scene].clipBad));
    sceneEls.forEach(function (el, k) {
      var v = el.querySelector(".svid");
      if (!v) return;
      var s = SCENES[k];
      // g33: a clip that fails or shows only green lets go, and that scene keeps its photo from then on
      var drop = function () { s.clipBad = true; v.classList.remove("playing"); v.pause(); v.removeAttribute("src"); try { v.load(); } catch (e) {} };
      if (on && k === scene && !lighterOff && !VIDEO_ON && !document.hidden && !s.clipBad) {
        if (!v.getAttribute("src")) {
          v.onplaying = function () {
            v.classList.add("playing");
            if (window.CouchVideo && CouchVideo.watchGreen) CouchVideo.watchGreen(v, function () { drop(); sceneVideos(false); });
          };
          v.onerror = function () { if (v.getAttribute("src")) drop(); };
          v.src = "backgrounds/" + s.photo + ".mp4";
        }
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      } else if (v.getAttribute("src")) {
        v.pause();
        // Off screen, a clip keeps its place (a boat sailing across a minute-long loop carries on
        // where it was when its scene comes back), unless the scene now showing has a clip of its own
        // and needs the decoder, or clips are off altogether: then it lets go of the decoder and memory.
        if (!NIGHT || calm || !on || (k !== scene && curClip)) {
          v.classList.remove("playing");
          v.removeAttribute("src");
          try { v.load(); } catch (e) {}
        }
      }
    });
  }

  // The next scene is readied this long before its turn (today's 2 s after the fade kept two full
  // scenes decoded for the whole turn); short turns keep the old timing.
  var PRE_READY_MS = 3000, preReadyTimer = null, switching = false, pendingScene = -1;
  function showScene(i, hops) {
    if (switching) return;   // a fade is waiting for its photo: the next tick comes round
    var prev = scene, s = SCENES[i], el = sceneEls[i];
    readyScene(i);
    if (prev === i) { swapScene(i, prev); return; }
    switching = true; pendingScene = i;
    sceneLoaded(el, 8000).then(function () {
      switching = false; pendingScene = -1;
      if (sceneEls[i] !== el) return;   // the scenes were rebuilt meanwhile (lostScene): that showed what is left
      if (s.lost || !photoIn(el)) {
        // nothing to fade to: keep what is on screen and try the scene after this one (bounded, so a
        // TV with no network does not go round and round); the retries and the next turn try again
        hops = (hops || 0) + 1;
        if (hops < SCENES.length) showScene(nextFrom(i), hops);
        return;
      }
      swapScene(i, prev);
    });
  }
  function swapScene(i, prev) {
    scene = i;
    var date = $("date");
    date.classList.add("swap");
    setTimeout(function () {
      var s = SCENES[i], root = document.documentElement, cls = " scene-" + sceneClass(s);
      if (s.mine) {   // the date follows your own scene's clock
        cls += " mine-" + s.x + (s.below ? " mine-below" : "") + (s.inter ? " mine-inter" : "") + (s.dark ? " mine-dark" : "");
        root.style.setProperty("--my-top", s.y * 100 + "vh");
        root.style.setProperty("--my-size", s.size * 100 + "vh");
      }
      root.className = root.className.replace(/\b(scene|mine)-\w+/g, "").replace(/\s+/g, " ").trim() + cls;
      date.classList.remove("swap");
      fitDate();
      placeMood();
    }, 600);
    sceneEls[i].classList.remove("out");
    sceneEls[i].classList.add("on");
    // .out keeps the old scene's depth zoom going while it fades, instead of snapping back
    if (prev !== i) { sceneEls[prev].classList.add("out"); sceneEls[prev].classList.remove("on"); }
    // home.scene_zoom: the built-in scenes push in slowly (app.css, .depth-zoom); off unless true
    document.documentElement.classList.toggle("depth-zoom", HOME.scene_zoom === true);
    document.documentElement.style.setProperty("--zoom-ms", (SCENE_MS + 4000) + "ms");
    // after the fade, give the other scenes' pictures back; the next one is readied just before its turn
    var lead = SCENE_MS > 10000 ? SCENE_MS - PRE_READY_MS : 2000;
    setTimeout(function () {
      sceneEls.forEach(function (el, k) { if (k !== scene) el.classList.remove("out"); if (k !== scene && k !== pendingScene && (lead > 2000 || k !== nextFrom(scene))) unreadyScene(k); });
      sceneVideos(true);   // the old scene's clip stops now it has faded out; this one's starts
    }, 2000);
    clearTimeout(preReadyTimer);
    preReadyTimer = setTimeout(function () {
      var next = nextFrom(scene);
      if (SUN_SYNC) { var idx = SCENES.map(function (x) { return x.id; }).indexOf(sunTargetScene()); if (idx >= 0) next = idx; }
      if (next !== scene) readyScene(next);
    }, lead);
  }

  // Night: the date line sits just above the scene's clock and lines up with it (centred over a
  // centred clock, on the clock's own edge for a clock at the side). Longer words (the weather place,
  // Spanish, a running sleep timer, four quick buttons) can reach the people switch or the buttons in
  // the top bar. It never slides sideways for them, which took it off the clock: the date and the
  // scene's clock move down together, under the top bar. Only a line wider than the screen then drops
  // the weather's words, then the weather. The Loop look (no scene clock) still makes room sideways.
  function fitDate() {
    var d = $("date"), line = d.firstChild;
    if (!NIGHT || !line || !line.getBoundingClientRect) return;
    d.style.left = ""; d.style.right = ""; d.style.top = "";
    d.classList.remove("tight", "tighter");
    var b = line.getBoundingClientRect(), rem = innerWidth / 120;
    var near = function (r) { return r && r.width > 0 && r.bottom > b.top && r.top < b.bottom; };
    var q = $("quick").classList.contains("none") ? null : $("qbtns").getBoundingClientRect();
    var p = $("people").getBoundingClientRect();
    if (!LOOP) {
      var hits = function (r) { return near(r) && b.left < r.right + rem && b.right > r.left - rem; };
      var drop = 0;
      if (hits(p) || hits(q)) {
        var under = Math.max(p.width > 0 ? p.bottom : 0, q && q.width > 0 ? q.bottom : 0) + rem;
        drop = Math.max(0, Math.round(under - b.top));
        d.style.top = (d.offsetTop + drop) + "px";
      }
      if (drop !== dateDrop) {
        dateDrop = drop;
        document.documentElement.style.setProperty("--date-drop", drop + "px");
        // the glass digits show the photo behind them, lined up from where they sit: line them up again
        sceneEls.forEach(function (el, i) { if (el.classList.contains("ready") && el.dataset.hm) drawClocks(el, SCENES[i], el.dataset.hm); });
        placeMood();
      }
      if (d.scrollWidth > d.clientWidth + 1) d.classList.add("tight");
      if (d.scrollWidth > d.clientWidth + 1) d.classList.add("tighter");
      return;
    }
    var rtl = document.documentElement.dir === "rtl";
    // the Loop look puts Now playing in the people's column, at the date line's height with one person
    // or under a tall head icon: of the two, the one that reaches further in is the one to clear
    var np = LOOP && $("np").classList.contains("on") ? $("np").getBoundingClientRect() : null;
    if (near(np) && (!near(p) || (rtl ? np.left < p.left : np.right > p.right))) p = np;
    var leftBox = rtl ? q : p;
    var rightBox = rtl ? p : q;
    var hitRight = near(rightBox) && b.right > rightBox.left - rem;
    var hitLeft = near(leftBox) && b.left < leftBox.right + rem;
    if (!hitRight && !hitLeft) return;
    // Loop: once it moves it stays clear of both sides, since a long Now playing line can push it
    // over to the quick buttons
    if (hitRight || (LOOP && near(rightBox))) d.style.right = (innerWidth - rightBox.left + 1.5 * rem) + "px";
    if (hitLeft || (LOOP && near(leftBox))) d.style.left = (leftBox.right + 1.5 * rem) + "px";
    if (d.scrollWidth > d.clientWidth + 1) d.classList.add("tight");
    if (d.scrollWidth > d.clientWidth + 1) d.classList.add("tighter");
  }
  var dateDrop = 0;   // how far fitDate() moved the date and the scene clock down (px)

  // ---------------- Night: a greeting and a short line under the clock ----------------
  // A warm greeting for whoever is watching, picked at random for the time of day, and a short
  // encouraging line. A new pair when the home comes back on screen, when someone else is picked,
  // and every 10 minutes. It sits under the scene's clock and steps aside (the line first, then
  // the greeting) when there is no room above Keep watching.
  var GREET = {
    morning: ["Good morning, {n}", "Rise and shine, {n}", "Morning, {n}. Coffee first?", "Hello, sunshine", "A fresh start, {n}"],
    afternoon: ["Good afternoon, {n}", "Hey {n}, taking a break?", "Afternoon, {n}", "Nice to see you, {n}", "Time for a breather, {n}"],
    evening: ["Good evening, {n}", "Evening, {n}. Time to unwind", "Cozy night in, {n}?", "Welcome home, {n}", "Kick back, {n}"],
    night: ["Hello, night owl", "Still up, {n}?", "One more episode, {n}?", "Late show, {n}?", "Quiet hours, {n}"],
    any: ["Welcome back, {n}", "Hey there, {n}", "Settle in, {n}", "Make yourself comfy, {n}"]
  };
  var QUOTES = [
    "Small steps still move you forward.",
    "Rest is part of the work.",
    "You don't have to do it all today.",
    "Be gentle with yourself. You're doing fine.",
    "The best things take a little time.",
    "Today counts, even the quiet parts.",
    "Breathe in. Let it go. Begin again.",
    "Little joys add up to a good life.",
    "Good enough is often just right.",
    "You've handled hard days before.",
    "Make room for what makes you smile.",
    "Slow mornings, kind words, good company.",
    "Every day is a new page.",
    "Progress, not pressure.",
    "Good things grow in calm places.",
    "Share a laugh. It helps more than you think.",
    "Tomorrow is a fresh try.",
    "Curiosity keeps the heart young.",
    "Home is where you can just be.",
    "Choose the kind thought.",
    "Your pace is the right pace.",
    "Celebrate the small wins.",
    "A cozy night is time well spent.",
    "Good company makes any night better.",
    "Some days are for doing, some for resting."
  ];
  // Each person's own style (home.person_styles in config.json, { "<person id>": "gentle" | "electric" }):
  // their own greetings and lines, and the look in app.css (html.who-gentle, html.who-electric).
  var STYLE_WORDS = {
    gentle: {
      greet: {
        morning: ["Good morning, sweet {n}", "Rise and shine, {n}", "Hello, sunshine {n}", "Morning, {n}. Tea and cuddles?", "A soft new day, {n}"],
        afternoon: ["Hi there, lovely {n}", "Afternoon, {n}. Snack time?", "Hey {n}, you're doing great", "A cozy afternoon, {n}", "Hello, sweet pea"],
        evening: ["Good evening, lovely {n}", "Blankets and snacks, {n}?", "Welcome home, sweet {n}", "Cozy time, {n}", "Hi {n}, time to unwind"],
        night: ["Sweet dreams soon, {n}", "Still up, little owl?", "One more episode, {n}?", "Snuggle in, {n}", "Hello, sleepy {n}"],
        any: ["Hi {n}, so happy you're here", "Hello, lovely {n}", "Make yourself comfy, {n}"]
      },
      quotes: [
        "You're a little ray of sunshine.", "Be soft. Be kind. Be you.", "Little joys are big joys.",
        "You are loved more than you know.", "Rest, cuddle, repeat.", "Bloom at your own pace.",
        "Kindness looks good on you.", "Every day has a tiny bit of magic.", "You deserve the cozy blanket.",
        "A warm drink and a good show: just right.", "Smile, you're doing beautifully.", "Gentle days make strong hearts.",
        "Sprinkle a little joy today.", "You make this home brighter.", "Soft hearts are strong hearts."
      ]
    },
    electric: {
      greet: {
        morning: ["Systems online, {n}", "The day is waiting, {n}", "Morning, {n}. Charge up", "Wake the storm, {n}", "New signal, {n}"],
        afternoon: ["Still running hot, {n}", "Afternoon, {n}. Stay sharp", "The current is yours, {n}", "Keep the spark, {n}", "In the zone, {n}"],
        evening: ["The night is calling, {n}", "Evening, {n}. Lights low", "Enter the night, {n}", "Shadows rising, {n}", "Plug in, {n}"],
        night: ["The city sleeps. Not you, {n}", "Midnight mode, {n}", "Into the unknown, {n}?", "Hello, night runner", "After hours, {n}"],
        any: ["Welcome back, {n}", "Signal found, {n}", "Access granted, {n}"]
      },
      quotes: [
        "Every storm begins with a spark.", "The quiet ones carry the thunder.", "Some doors only open at night.",
        "Charge up. Then light it up.", "Be the signal, not the noise.", "Stars only shine in the dark.",
        "Stay curious. Stay electric.", "There's power in the pause.", "The unknown is where it gets good.",
        "Run on your own current.", "Sharpen the edge, keep the calm.", "Every legend starts in the shadows.",
        "Trust the static. Something is coming.", "Fortune favours the restless.", "Focus is a kind of lightning."
      ]
    }
  };
  function styleOf(id) {
    var m = HOME && HOME.person_styles, v = m && typeof m === "object" ? m[id] : null;
    return STYLE_WORDS[v] ? v : "";
  }
  function applyStyle() {
    var st = styleOf(who), root = document.documentElement;
    root.classList.toggle("who-gentle", st === "gentle");
    root.classList.toggle("who-electric", st === "electric");
    return st;
  }
  var moodAt = 0, moodWho = null, moodLast = { hi: "", q: "" };
  function anyOf(list, not) {
    var pool = list.filter(function (x) { return x !== not; });
    return (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
  }
  // home.greeting: off unless true, and only while the home speaks English (the words are English)
  function greetingOn() {
    var loc = "";
    try { loc = String(I18N.locale() || ""); } catch (e) {}
    return HOME.greeting === true && /^en/i.test(loc || "en");
  }
  function mood(force) {
    var el = $("mood");
    if (!el) return;
    applyStyle();
    if (!NIGHT || !greetingOn()) { el.classList.remove("on"); return; }
    var now = Date.now();
    if (!force && moodWho === who && now - moodAt < 600000 && moodLast.hi) { placeMood(); return; }
    moodAt = now; moodWho = who;
    var words = STYLE_WORDS[applyStyle()] || { greet: GREET, quotes: QUOTES };
    var h = new Date().getHours(), part = h >= 5 && h < 12 ? "morning" : h < 17 && h >= 12 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night";
    var p = personById(who), name = p && p.name ? p.name : "";
    var list = words.greet[part].concat(words.greet.any);
    if (!name) list = list.filter(function (g) { return g.indexOf("{n}") < 0 || /, \{n\}$/.test(g); });
    var hi = anyOf(list, moodLast.hi);
    moodLast.hi = hi;
    hi = name ? hi.replace("{n}", name) : hi.replace(/,? \{n\}\??$/, function (m) { return m.slice(-1) === "?" ? "?" : ""; }).replace("{n}", "");
    var q = anyOf(words.quotes, moodLast.q);
    moodLast.q = q;
    el.classList.remove("on");
    setTimeout(function () {
      $("mood-hi").textContent = hi;
      $("mood-q").textContent = q;
      placeMood();
    }, 450);
  }
  // Under the clock of the scene on screen, lined up with it (centre, left or right).
  function placeMood() {
    var el = $("mood"), sc = sceneEls[scene];
    if (!el || !NIGHT || !sc) return;
    if (!greetingOn()) { el.classList.remove("on"); return; }
    var c = sc.querySelector(".gclock");
    if (!c || !c.offsetHeight) { el.classList.remove("on"); return; }
    var rem = innerWidth / 120, cs = getComputedStyle(c), fs = parseFloat(cs.fontSize) || 25 * rem;
    var water = !!SCENES[scene].water;
    // under the clock's digits (its box, or about 1.05 of the font size for a tall line height),
    // then a clear gap
    var top = c.offsetTop + Math.min(c.offsetHeight || fs, fs * 1.05) + 2 * rem;
    var shelf = $("shelf-section"), limit = innerHeight - 14 * rem;
    if (shelf && shelf.offsetHeight && getComputedStyle(shelf).display !== "none" && $("shelf").children.length) limit = shelf.getBoundingClientRect().top - 0.75 * rem;
    el.classList.remove("left", "right", "noq");
    var align = cs.textAlign;
    if (align === "left" || align === "start") { el.classList.add("left"); el.style.left = c.getBoundingClientRect().left + 0.5 * rem + "px"; el.style.right = "auto"; }
    else if (align === "right" || align === "end") { el.classList.add("right"); el.style.right = (innerWidth - c.getBoundingClientRect().right + 0.5 * rem) + "px"; el.style.left = "auto"; }
    else { el.style.left = ""; el.style.right = ""; }
    el.style.top = top + "px";
    var full = el.offsetHeight || 7 * rem, hiOnly = $("mood-hi").offsetHeight || 3.5 * rem;
    if (water || top + hiOnly > limit) { el.classList.remove("on"); return; }
    if (top + full > limit) el.classList.add("noq");
    el.classList.toggle("dark", !!(SCENES[scene].mine && SCENES[scene].dark));
    el.classList.add("on");
  }

  // Sun-synchronized day/night calculation (astronomical solar altitude from lat, lon and time)
  function solarAltitude(lat, lon, d) {
    d = d || new Date();
    var start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
    var dayOfYear = Math.floor((d - start) / 86400000);
    var b = (360 / 365.25) * (dayOfYear - 81) * (Math.PI / 180);
    var eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    var decl = 23.45 * Math.sin(b) * (Math.PI / 180);
    var utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    var solarTime = (utcHours + (lon / 15) + (eot / 60) + 24) % 24;
    var hourAngle = (solarTime - 12) * 15 * (Math.PI / 180);
    var latRad = lat * (Math.PI / 180);
    var sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
    var alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * (180 / Math.PI);
    return { alt: alt, hourAngle: hourAngle * (180 / Math.PI) };
  }

  // The time of day where the TV is, from the sun's height, as the built-in picks below do: night under
  // -6 degrees, dawn or dusk under 10 degrees (the hour angle says which), day above.
  function sunPhase() {
    if (!WXCFG || WXCFG.lat == null || WXCFG.lon == null || !isFinite(WXCFG.lat) || !isFinite(WXCFG.lon)) {
      var h = new Date().getHours();
      return h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 16 ? "day" : h >= 16 && h < 19 ? "dusk" : "night";
    }
    var pos = solarAltitude(Number(WXCFG.lat), Number(WXCFG.lon), new Date());
    if (pos.alt < -6) return "night";
    if (pos.alt < 10) return pos.hourAngle < 0 ? "dawn" : "dusk";
    return "day";
  }
  // Follow the sun with own scenes: the built-in scene for this time of day plus every own scene tagged
  // with it (and not switched off) take turns, one every home.sun_rotate_minutes (25 by default). With no
  // tagged scene this is the built-in pick alone, as it always was.
  function sunTargetScene() {
    var base = sunTargetBuiltIn();
    var ph = sunPhase();
    var pool = [base].concat(SCENES.filter(function (sc) { return sc.mine && sc.when === ph; }).map(function (sc) { return sc.id; }));
    if (pool.length < 2) return base;
    var mins = Math.max(5, Math.min(240, parseInt(HOME.sun_rotate_minutes, 10) || 25));
    return pool[Math.floor(Date.now() / (mins * 60000)) % pool.length];
  }
  function sunTargetBuiltIn() {
    var st = sceneState();
    var available = st.order.filter(function (id) { return st.off.indexOf(id) < 0; });
    var pick = function (preferred, fallback) {
      if (available.indexOf(preferred) >= 0) return preferred;
      for (var i = 0; i < fallback.length; i++) if (available.indexOf(fallback[i]) >= 0) return fallback[i];
      return available[0] || "night";
    };

    if (!WXCFG || WXCFG.lat == null || WXCFG.lon == null || !isFinite(WXCFG.lat) || !isFinite(WXCFG.lon)) {
      var h = new Date().getHours();
      if (h >= 5 && h < 8) return pick("dawn", ["golden", "water", "fog", "night"]);
      if (h >= 8 && h < 16) return pick("water", ["fog", "golden", "dawn", "night"]);
      if (h >= 16 && h < 19) return pick("golden", ["dawn", "water", "fog", "night"]);
      return pick("night", ["fog", "water", "golden", "dawn"]);
    }

    var pos = solarAltitude(Number(WXCFG.lat), Number(WXCFG.lon), new Date());
    if (pos.alt < -6) {
      return pick("night", ["fog", "water", "golden", "dawn"]);
    }
    if (pos.alt < 10) {
      return pos.hourAngle < 0
        ? pick("dawn", ["golden", "water", "fog", "night"])
        : pick("golden", ["dawn", "water", "fog", "night"]);
    }
    // Daytime (sun altitude >= 10 deg): pick fog for overcast/rainy weather, otherwise water
    var code = data.weather && data.weather.code;
    var isFoggy = code != null && [3, 45, 48, 51, 53, 55, 61, 63, 65, 80, 81, 82].indexOf(code) >= 0;
    return isFoggy
      ? pick("fog", ["water", "golden", "dawn", "night"])
      : pick("water", ["fog", "golden", "dawn", "night"]);
  }

  // Whether a scene may change now. A change costs a weak TV a visible stall (430 ms on an LG
  // OLED55A2), so it should not land while someone is moving along the rows. lastKeyAt is
  // Date.now() at the last key press (0 before any). A false here is not lost: the 20 s rotation
  // and the clock tick (sun_sync) both ask again on their next turn.
  var sceneHeldSince = 0;
  function sceneMayChange() {
    var now = Date.now();
    if (now - lastKeyAt < 4000) {
      sceneHeldSince = sceneHeldSince || now;
      if (now - sceneHeldSince < 60000) return false;   // a minute of browsing still gets the next scene
    }
    sceneHeldSince = 0;
    return true;
  }

  function applySunSync() {
    // the clock ticks before buildScenes() has made the scenes: wait for them (sun_sync on in config.json)
    if (!NIGHT || !SUN_SYNC || !SCENES.length || sceneEls.length !== SCENES.length || !sceneMayChange()) return;
    var targetId = sunTargetScene();
    var idx = SCENES.map(function (s) { return s.id; }).indexOf(targetId);
    if (idx >= 0 && idx !== scene) {
      showScene(idx);
    }
  }

  // the settings screen covers the scenes, so they wait (one less thing for a small TV stick to draw).
  // So do an app or the TV's screensaver in front (the launcher calls tv.pause, and the page's own
  // visibility): a crossfade decodes and uploads a fresh set of 1080p layers, and on a Fire TV Cube
  // (2 GB) the page's GPU memory was seen swinging between 115 MB and 260 MB with every change while
  // the screensaver covered it, which is what pushes a small box into swapping.
  var PAGE_PAUSED = false;
  // An app or the TV's screensaver is in front: nothing on the home can be seen, so its clock,
  // its polls and its scene changes wait (the launcher also pauses the WebView's timers, so these
  // guards matter on TVs that do not, and for the screen-off mode, which has no pause).
  function covered() { return PAGE_PAUSED || document.hidden; }
  function active() { return !covered() && !screenOffActive; }
  function nextScene() {
    if (zone !== "settings" && active() && sceneMayChange()) {
      if (SUN_SYNC) applySunSync();
      else showScene(nextFrom(scene));
    }
  }

  // g34: the phone remote's Scene buttons (ask.js reads them from /api/say). The Night look shows the
  // next or the previous scene that is switched on, Classic the next or the previous photo; the Loop
  // look and a design keep their own background. Nothing on the phone closes or reloads.
  function phoneScene(pick) {
    var back = pick === "prev";
    if (LOOP || (typeof CouchDesign !== "undefined" && CouchDesign.on && CouchDesign.on())) return false;
    if (NIGHT) {
      if (SCENES.length < 2 || switching) return false;
      var to = scene;
      for (var k = 1; k <= SCENES.length; k++) { var i = (scene + (back ? SCENES.length - k : k)) % SCENES.length; if (!SCENES[i].lost) { to = i; break; } }
      if (to === scene) return false;
      showScene(to);
      return true;
    }
    var n = classicPhotos().length;
    if (n < 2) return false;
    photo = (photo + (back ? n - 1 : 1)) % n;
    showPhoto();
    return true;
  }

  function getSunPos() {
    if (WXCFG && WXCFG.lat != null && isFinite(WXCFG.lat) && WXCFG.lon != null && isFinite(WXCFG.lon)) {
      return solarAltitude(Number(WXCFG.lat), Number(WXCFG.lon), new Date());
    }
    var h = new Date().getHours();
    var alt = (h >= 6 && h < 18) ? 35 : -20;
    var hourAngle = (h - 12) * 15;
    return { alt: alt, hourAngle: hourAngle };
  }

  // The ambient weather effects follow the settings: off unless chosen, never under Lighter home or
  // on an old engine (the slow boxes Lighter home is for), and not while an app or Settings is up.
  function ambientSync() {
    var a = window.AmbientWeather;
    if (!a) return;
    a.setLighter(LIGHTER || OLD_ENGINE);
    a.setEnabled(WX_AMBIENT && WX_SHOW && !LOOP);
    a.setSunGradeEnabled(WX_SUN_GRADE && !LIGHTER && !OLD_ENGINE && !LOOP);
    // g01: the two full screen layers (the weather canvas and the lighting tint) only while one of them is in
    // use. Left in the page empty, they sat over the scenes and made the browser give the panels and tiles
    // above them layers of their own: 5.8 ms of main thread commit per arrow press at 6x CPU throttle, 0.8 without
    document.documentElement.classList.toggle("amb-fx", ((WX_AMBIENT && WX_SHOW) || WX_SUN_GRADE) && !LIGHTER && !OLD_ENGINE && !LOOP);
    updateAmbientWeather();
  }

  // In the Loop look the weather paints the accent and picks the clip's time of day instead (once a
  // minute from clock(), and when a new reading comes in): no weather canvas, no lighting layer.
  function updateAmbientWeather() {
    if (LOOP) { loopTick(); return; }
    if (!window.AmbientWeather) return;
    var pos = getSunPos();
    window.AmbientWeather.setWeather(WX_SHOW ? data.weather : null, pos);
  }

  // The bridge's reading for the place in config.json, or straight from Open-Meteo with no bridge
  // or when Home settings chose another place. Hidden when Home settings switched the weather off.
  function wxPlaceSet() { return !!(WXCFG && WXCFG.lat != null && WXCFG.lon != null && isFinite(WXCFG.lat) && isFinite(WXCFG.lon)); }
  function wantsForecast() { return typeof CouchDesign !== "undefined" && CouchDesign.wantsForecast && CouchDesign.wantsForecast(); }
  function refreshWeather() {
    var fc = wantsForecast();
    if ((!NIGHT && !fc) || !WX_SHOW) {
      updateAmbientWeather();
      return Promise.resolve();
    }
    // a preview (?mock=1) never asks Open-Meteo itself: the designer talks to nobody else (wxlive=1: a test that does)
    var direct = (!MOCK || /[?&]wxlive=1/.test(Q)) && (OFFLINE || fc || !!(ST.place && isFinite(ST.place.lat)));
    // no town yet: nothing to ask for the home (the weather tiles say "Set your town for the weather"),
    // but a widget with a place of its own still gets that place's reading
    if (direct && !wxPlaceSet()) {
      if (!wsPlaces().length) { data.weather = null; updateAmbientWeather(); return Promise.resolve(); }
      return airAndSurf({}).then(function (j) {
        data.weather = j;
        if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("weather", [j.at && Object.keys(j.at).join(";"), Date.now()]);
        clock();
        updateAmbientWeather();
      }, function () {});
    }
    return (direct ? weatherDirect(fc) : api("GET", "/api/weather")).then(function (j) {
      data.weather = j;
      if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("weather", [j && j.temp, j && j.code, j && j.daily && j.daily.length, j && j.marine && j.marine.wave, j && j.air && j.air.aqi, j && j.at]);
      clock();
      updateAmbientWeather();
    }, function () {});
  }

  // Open-Meteo (free, no key), the same call the bridge makes. The words come from i18n.js.
  var WMO_KEY = { 0: "wx_clear", 1: "wx_mostly_clear", 2: "wx_partly", 3: "wx_cloudy", 45: "wx_fog", 48: "wx_fog",
    51: "wx_drizzle", 53: "wx_drizzle", 55: "wx_drizzle", 56: "wx_drizzle", 57: "wx_drizzle", 61: "wx_light_rain",
    63: "wx_rain", 65: "wx_heavy_rain", 66: "wx_rain", 67: "wx_rain", 80: "wx_showers", 81: "wx_showers",
    82: "wx_heavy_showers", 95: "wx_storms", 96: "wx_storms", 99: "wx_storms" };
  // With a forecast widget on a design, the same one call grows (widgets/CATALOGUE.md "Data plumbing" 1):
  // hourly, daily and the next hours of rain, still free, keyless and one request per refresh.
  // P: the place to read (the home's town when left out). Only the home's reading goes on to the
  // widgets' own places (airAndSurf), so each place is asked once per refresh.
  function weatherDirect(forecast, P) {
    var home = !P;
    P = P || WXCFG;
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + P.lat + "&longitude=" + P.lon +
      "&current=temperature_2m,weather_code,is_day&timezone=" + encodeURIComponent(P.timezone || "auto") +
      (forecast ? "&hourly=temperature_2m,weather_code,uv_index,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max&minutely_15=precipitation&forecast_days=7&forecast_minutely_15=12" : "&forecast_days=1");
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var c = j.current, code = Math.round(c.weather_code);
      var out = { temp: Math.round(c.temperature_2m), code: code, text: "", is_day: !!c.is_day };
      if (forecast) {
        var H = j.hourly || {}, Dd = j.daily || {}, M = j.minutely_15 || {}, nowIso = (c.time || "").slice(0, 13), at = Math.max(0, (H.time || []).indexOf(nowIso + ":00"));
        out.hourly = (H.time || []).slice(at, at + 24).map(function (t, i) { return { time: t, temp: H.temperature_2m[at + i], code: H.weather_code[at + i], uv: H.uv_index && H.uv_index[at + i], pop: H.precipitation_probability && H.precipitation_probability[at + i] }; });
        out.daily = (Dd.time || []).map(function (t, i) { return { date: t, code: Dd.weather_code[i], hi: Dd.temperature_2m_max[i], lo: Dd.temperature_2m_min[i], sunrise: Dd.sunrise[i], sunset: Dd.sunset[i], uv: Dd.uv_index_max && Dd.uv_index_max[i] }; });
        out.rain15 = (M.precipitation || []).slice(0, 12);
        if (out.daily.length) { out.hi = Math.round(out.daily[0].hi); out.lo = Math.round(out.daily[0].lo); out.uv = Math.round(out.daily[0].uv || 0); }
        if (Dd.precipitation_probability_max) out.daily.forEach(function (d, i) { d.pop = Dd.precipitation_probability_max[i]; });
      }
      return home ? airAndSurf(out) : out;
    });
  }
  // Open-Meteo's free air quality and marine services for one rounded place
  function wxNowAt(times) { var h = new Date(), iso = h.getFullYear() + "-" + ("0" + (h.getMonth() + 1)).slice(-2) + "-" + ("0" + h.getDate()).slice(-2) + "T" + ("0" + h.getHours()).slice(-2) + ":00"; return Math.max(0, (times || []).indexOf(iso)); }
  function wxAt(p) { return "latitude=" + p.lat + "&longitude=" + p.lon + "&timezone=" + encodeURIComponent(p.timezone || "auto"); }
  function airFor(p) {
    return fetch("https://air-quality-api.open-meteo.com/v1/air-quality?" + wxAt(p) + "&current=european_aqi,us_aqi&hourly=european_aqi,us_aqi&forecast_days=2")
      .then(function (r) { return r.json(); }).then(function (j) {
        var H = j.hourly || {}, i = wxNowAt(H.time), keep = function (l) { return (l || []).slice(i, i + 12).filter(function (v) { return v != null; }); };
        // both scales: the widget's Scale setting picks one (widgets.js airIn)
        return j.current && isFinite(j.current.european_aqi) ? { aqi: j.current.european_aqi, hourly: keep(H.european_aqi),
          us: isFinite(j.current.us_aqi) ? j.current.us_aqi : NaN, usHourly: keep(H.us_aqi) } : null;
      });
  }
  function surfFor(p) {
    return Promise.all([
      fetch("https://marine-api.open-meteo.com/v1/marine?" + wxAt(p) + "&current=wave_height,wave_period,wave_direction&hourly=wave_height&forecast_days=2").then(function (r) { return r.json(); }),
      fetch("https://api.open-meteo.com/v1/forecast?" + wxAt(p) + "&current=wind_speed_10m,wind_direction_10m&forecast_days=1").then(function (r) { return r.json(); })
    ]).then(function (j) {
      var c = j[0].current || {}, H = j[0].hourly || {}, i = wxNowAt(H.time), wc = j[1].current || {};
      return { wave: c.wave_height == null ? NaN : c.wave_height, period: c.wave_period, dir: c.wave_direction, wind: wc.wind_speed_10m, windDir: wc.wind_direction_10m,
        hourly: (H.wave_height || []).slice(i, i + 12).filter(function (v) { return v != null; }) };
    });
  }
  // While an air or surf widget is on the home: the home town's air and swell (widget-caps.js "air",
  // "surf"). Then every widget with a place of its own (its "place" setting, Home settings or the phone)
  // gets that place's own reading: one forecast per distinct place, the swell only for a surf widget's
  // place, the air only for an air widget's. They go in out.at["lat,lon"] (data().wxFor hands each widget
  // its own). A failure leaves the rest.
  function airAndSurf(out) {
    var want = typeof CouchDesign !== "undefined" && CouchDesign.wantsKinds ? CouchDesign.wantsKinds(["air", "surf"]) : [];
    var own = wsPlaces(), jobs = [], places = {}, home = wxPlaceSet();
    var bare = function (kind) { return own.every(function (w) { return w.kind !== kind; }) || (CouchDesign.widgetList && CouchDesign.widgetList().some(function (w) { return w.kind === kind && !wsPlace(w.key); })); };
    if (home && want.indexOf("air") >= 0 && bare("air")) jobs.push(airFor(WXCFG).then(function (a) { if (a) out.air = a; }, function () {}));
    if (home && want.indexOf("surf") >= 0 && bare("surf")) jobs.push(surfFor(WXCFG).then(function (m) { out.marine = m; }, function () {}));
    own.forEach(function (w) { var k = placeKey(w.place); (places[k] = places[k] || { p: w.place, kinds: {} }).kinds[w.kind] = 1; });
    Object.keys(places).forEach(function (k) {
      var e = places[k];
      jobs.push(weatherDirect(true, e.p).then(function (wx) {
        var more = [];
        if (e.kinds.surf) more.push(surfFor(e.p).then(function (m) { wx.marine = m; }, function () {}));
        if (e.kinds.air) more.push(airFor(e.p).then(function (a) { if (a) wx.air = a; }, function () {}));
        return Promise.all(more).then(function () { wx.place = e.p.name; (out.at = out.at || {})[k] = wx; });
      }, function () {}));
    });
    return Promise.all(jobs).then(function () { return out; });
  }

  function hero(it) {
    var el = $("hero");
    if (!it) { el.classList.remove("on"); return; }
    $("hero-title").textContent = it.title;
    $("hero-sub").textContent = subtitle(it);
    el.classList.add("on");
  }

  // ---------------- Now playing (#31) + Spotify local integration ----------------
  var music = null, npI = 2, npPrimaryCount = 0, npSub = "btns", npScrubPos = 0, npSrc = "", currentNpBtns = [], npProgressTimer = null;
  var localShuffle = "off", localRepeat = "off";
  var musicSleepEnd = 0, musicSleepMin = 0, musicSleepTimer = null, musicFadeTimer = null;
  var audioOutput = { type: "speaker", name: "" }, audioOutAt = 0;
  var npTintCache = {};
  var LOCAL_SPOTIFY = false, SPOTIFY_TV = "com.spotify.tv.android";

  function extractArtworkTint(dataUrl, cb) {
    if (!dataUrl || dataUrl.indexOf("data:image/") !== 0) { cb(null); return; }
    if (npTintCache[dataUrl]) { cb(npTintCache[dataUrl]); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement("canvas");
        c.width = 16; c.height = 16;
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 16, 16);
        var d = ctx.getImageData(0, 0, 16, 16).data;
        var bestR = 0, bestG = 0, bestB = 0, bestScore = -1;
        var sumR = 0, sumG = 0, sumB = 0, cnt = 0;
        for (var i = 0; i < d.length; i += 4) {
          var r = d[i], g = d[i + 1], b = d[i + 2];
          var max = Math.max(r, g, b), min = Math.min(r, g, b);
          var lum = (max + min) / 2;
          if (lum < 25 || lum > 235) continue;
          sumR += r; sumG += g; sumB += b; cnt++;
          var sat = max === 0 ? 0 : (max - min) / max;
          var score = sat * (1 - Math.abs(lum - 128) / 140);
          if (score > bestScore) { bestScore = score; bestR = r; bestG = g; bestB = b; }
        }
        var res = bestScore > 0.15 ? [bestR, bestG, bestB]
          : (cnt > 0 ? [Math.round(sumR / cnt), Math.round(sumG / cnt), Math.round(sumB / cnt)] : null);
        npTintCache[dataUrl] = res;
        cb(res);
      } catch (e) { cb(null); }
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  }

  function refreshAudioOutput(force) {
    if (!TV || !TV.audioOutputInfo) return;
    if (!force && Date.now() - audioOutAt < 5000) return;
    audioOutAt = Date.now();
    try {
      var info = JSON.parse(TV.audioOutputInfo());
      if (info && info.type) audioOutput = info;
    } catch (e) {}
  }

  function cancelMusicSleep() {
    clearTimeout(musicSleepTimer); musicSleepTimer = null;
    clearInterval(musicFadeTimer); musicFadeTimer = null;
    musicSleepEnd = 0; musicSleepMin = 0;
    try { if (TV && TV.musicFadeRestore) TV.musicFadeRestore(); } catch (e) {}
  }

  function toggleMusicSleep() {
    var steps = [0, 15, 30, 45, 60];
    var idx = steps.indexOf(musicSleepMin);
    var nextMin = steps[(idx + 1) % steps.length];
    cancelMusicSleep();
    if (!nextMin) {
      toast(t("music_sleep_off"));
      renderNp();
      return;
    }
    musicSleepMin = nextMin;
    musicSleepEnd = Date.now() + nextMin * 60000;
    var fadeMs = 30000;
    var fadeStartAt = Math.max(0, nextMin * 60000 - fadeMs);
    toast(t("music_sleep_set", { m: nextMin }));
    renderNp();
    musicSleepTimer = setTimeout(function () {
      try { if (TV && TV.musicFadeStart) TV.musicFadeStart(); } catch (e) {}
      var t0 = Date.now();
      musicFadeTimer = setInterval(function () {
        var frac = Math.max(0, 1 - (Date.now() - t0) / fadeMs);
        try { if (TV && TV.musicFadeStep) TV.musicFadeStep(frac); } catch (e) {}
        if (frac <= 0) {
          clearInterval(musicFadeTimer); musicFadeTimer = null;
          try {
            if (TV && TV.spotifyControl) TV.spotifyControl("pause", 0);
            else if (!OFFLINE) api("POST", "/api/spotify/control", { action: "pause", interval: 0 });
          } catch (e) {}
          setTimeout(function () {
            try { if (TV && TV.musicFadeRestore) TV.musicFadeRestore(); } catch (e) {}
          }, 800);
          musicSleepMin = 0; musicSleepEnd = 0;
          renderNp();
        }
      }, 1000);
    }, fadeStartAt);
  }

  function jumpIntoMusicApp() {
    if (!music) return;
    try {
      if (TV && TV.spotifyOpenApp && TV.spotifyOpenApp()) return;
    } catch (e) {}
    var pkg = (music.app && (music.app.package || music.app.id)) || SPOTIFY_TV;
    if (pkg) launch(pkg);
  }
  var FOOTBALL_LEAGUES = [
    { id: "47", name: "Premier League" }, { id: "55", name: "Serie A" },
    { id: "42", name: "Champions League" }, { id: "73", name: "Europa League" },
    { id: "77", name: "World Cup" }, { id: "nations", name: "UEFA Nations League", ids: [9806, 9807, 9808, 9809] },
    { id: "54", name: "Bundesliga" }, { id: "87", name: "La Liga" },
    { id: "53", name: "Ligue 1" }, { id: "523", name: "Persian Gulf Pro League" },
    { id: "141", name: "Coppa Italia" }, { id: "138", name: "Copa del Rey" },
    { id: "132", name: "FA Cup" }, { id: "209", name: "DFB-Pokal" }
  ];
  var footballPage = 0, footballMatchPage = 0, footballMatchPages = 1, footballData = null, footballEnabled = false;
  function selectedFootball() {
    var chosen = Array.isArray(ST.football_leagues) ? ST.football_leagues : FOOTBALL_LEAGUES.map(function (x) { return x.id; });
    return FOOTBALL_LEAGUES.filter(function (league) { return chosen.indexOf(league.id) >= 0; });
  }
  function footballRender() {
    var box = $("football-scores"), chosen = selectedFootball();
    if (!box) return;
    if (!footballEnabled || !NIGHT || LOOP) { box.classList.remove("on"); return; }
    box.classList.add("on");
    if (!chosen.length) { box.innerHTML = '<div class="football-heading"><b>Football scores</b><span>FotMob</span></div><div class="football-empty">Choose leagues</div>'; return; }
    var league = chosen[footballPage % chosen.length], ids = league.ids || [Number(league.id)];
    var matches = [];
    ((footballData && footballData.leagues) || []).forEach(function (item) {
      if (ids.indexOf(Number(item.id)) >= 0 || ids.indexOf(Number(item.primaryId)) >= 0)
        matches = matches.concat(item.matches || []);
    });
    matches.sort(function (a, b) {
      var live = function (m) { return m.status && m.status.started && !m.status.finished ? 0 : 1; };
      return live(a) - live(b);
    });
    footballMatchPages = Math.max(1, Math.ceil(matches.length / 3));
    footballMatchPage = Math.min(footballMatchPage, footballMatchPages - 1);
    var rows = matches.slice(footballMatchPage * 3, footballMatchPage * 3 + 3).map(function (m) {
      var status = m.status || {}, home = m.home || {}, away = m.away || {};
      var score = status.started ? String(home.score == null ? "-" : home.score) + "–" + String(away.score == null ? "-" : away.score) : "vs";
      var note = status.cancelled ? "Cancelled" : status.finished ? "Full time" : status.started ? "LIVE" :
        (m.timeTS ? new Date(m.timeTS).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !CLOCK24 }) : "Upcoming");
      return '<div class="football-match"><div class="football-teams"><span>' + esc(home.name || "") + '</span><b>' + esc(score) +
        '</b><span>' + esc(away.name || "") + '</span></div><small>' + esc(note) + '</small></div>';
    });
    var empty = !footballData || footballData.state === "loading" ? "Loading scores…" :
      footballData.state === "error" ? "Scores unavailable. Trying again." : "No matches today";
    box.innerHTML = '<div class="football-heading"><b>' + esc(league.name) + '</b><span>FotMob</span></div>' +
      (rows.length ? rows.join("") : '<div class="football-empty">' + esc(empty) + '</div>') +
      '<div class="football-count">' + (footballMatchPages > 1 ? 'Matches ' + (footballMatchPage + 1) + ' / ' + footballMatchPages + ' &nbsp;·&nbsp; ' : '') + (footballPage % chosen.length + 1) + ' / ' + chosen.length + '</div>';
  }
  function footballTick(advance) {
    if (!footballEnabled || covered()) return;
    try { footballData = JSON.parse(TV.fotmobScores()); } catch (e) { footballData = { state: "error" }; }
    if (advance) {
      if (footballMatchPage + 1 < footballMatchPages) footballMatchPage++;
      else { footballMatchPage = 0; footballPage++; }
    }
    footballRender();
  }
  var AMBIENT_MUSIC = false, ambientOpen = false, ambientDismissed = false, ambI = 1;
  var lastTrackKey = "", paletteCache = {}, curProgress = 0, curDuration = 0;

  function fmtTime(ms) {
    if (!ms || isNaN(ms) || ms < 0) return "0:00";
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function npVisible() {
    if (!music) return false;
    if (music.isSpotify) {
      if (!SPOTIFY.enabled || !SPOTIFY.show_card) return false;
      if (SPOTIFY.hide_idle && music.state !== "playing") return false;
      return true;
    }
    return NP_ON && (!OFFLINE || STANDALONE || LOCAL_SPOTIFY);
  }

  // reachable with the remote: in the Night look it steps aside with the cards while More apps is open,
  // and a card with no buttons (a Spotify Web API song on the bridge) is not a stop
  function npReach() { return npVisible() && !(NIGHT && expanded) && (currentNpBtns.length || npButtons().length) > 0; }

  function npButtons() {
    if (music && music.isSpotify) return currentNpBtns;   // the local Spotify card's own buttons (renderNp)
    if (!music) return [];
    if (music.state === "idle") return [["play", t("spotify_open"), "spotify-open"]];
    var b;
    if (music.source === "spotify") b = STANDALONE && window.CouchSpotify ? [["play", t("np_play_here"), "here"]] : [];
    else {
      var playing = music.state === "playing";
      b = [["prev", t("np_prev")], [playing ? "pause" : "play", playing ? t("np_pause") : t("np_play")], ["next", t("np_next")]];
    }
    if (AMBIENT_MUSIC) b.push(["expand", t("np_expand")]);
    return b;
  }

  function sendMusicKey(key) {
    if (music && music.source === "spotify-tv") {
      try { if (TV.spotifyKey(key)) return; } catch (e) {}
      note(t("spotify_control_unavailable"));
      return;
    }
    api("POST", "/api/key", { key: key }).catch(function (e) { note(tBridge(e.key, e.vars, e.message)); });
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec == null || sec < 0) return "0:00";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function extractPalette(url, title, artist, cb) {
    var key = url || ((title || "") + "\n" + (artist || ""));
    if (paletteCache[key]) { cb(paletteCache[key]); return; }
    function fallback() {
      var str = (title || "") + (artist || "");
      var h = 0;
      for (var i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
      }
      var hue = Math.abs(h) % 360;
      var c1 = "hsl(" + hue + ", 75%, 45%)";
      var c2 = "hsl(" + ((hue + 45) % 360) + ", 65%, 25%)";
      paletteCache[key] = [c1, c2];
      cb([c1, c2]);
    }
    if (!url) { fallback(); return; }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        var ctx = canvas.getContext("2d");
        if (!ctx) { fallback(); return; }
        ctx.drawImage(img, 0, 0, 16, 16);
        var imgData = ctx.getImageData(0, 0, 16, 16).data;
        var rSum = 0, gSum = 0, bSum = 0, count = 0;
        var maxSat = -1, bestR = 60, bestG = 90, bestB = 180;
        for (var i = 0; i < imgData.length; i += 4) {
          var r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
          rSum += r; gSum += g; bSum += b; count++;
          var maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
          var sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
          if (sat > maxSat && maxC > 40 && minC < 230) {
            maxSat = sat;
            bestR = r; bestG = g; bestB = b;
          }
        }
        var avgR = count ? Math.round(rSum / count) : 40;
        var avgG = count ? Math.round(gSum / count) : 50;
        var avgB = count ? Math.round(bSum / count) : 80;
        var col1 = "rgb(" + bestR + ", " + bestG + ", " + bestB + ")";
        var col2 = "rgb(" + avgR + ", " + avgG + ", " + avgB + ")";
        paletteCache[key] = [col1, col2];
        cb([col1, col2]);
      } catch (e) {
        fallback();
      }
    };
    img.onerror = fallback;
    img.src = url;
  }

  function updateProgressUI() {
    var curEl = $("ambient-time-cur");
    var totEl = $("ambient-time-total");
    var fillEl = $("ambient-bar-fill");
    if (!curEl || !totEl || !fillEl) return;
    if (curDuration > 0) {
      curEl.textContent = formatTime(curProgress);
      totEl.textContent = formatTime(curDuration);
      var pct = Math.min(100, Math.max(0, (curProgress / curDuration) * 100));
      fillEl.style.width = pct + "%";
      totEl.style.display = "";
    } else if (curProgress > 0) {
      curEl.textContent = formatTime(curProgress);
      totEl.style.display = "none";
      fillEl.style.width = "40%";
    } else {
      curEl.textContent = "0:00";
      totEl.style.display = "none";
      fillEl.style.width = "0%";
    }
  }

  function renderAmbientControls() {
    var playing = music && music.state === "playing";
    var pBtn = $("amb-prev"), plBtn = $("amb-play"), nBtn = $("amb-next"), oBtn = $("amb-open");
    if (!pBtn || !plBtn || !nBtn) return;
    pBtn.innerHTML = ICONS.prev;
    plBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    nBtn.innerHTML = ICONS.next;
    if (oBtn) {
      var appName = (music && music.app && music.app.name) || "";
      oBtn.innerHTML = ICONS.launch + '<span class="amb-open-txt">' + esc(appName || t("ambient_open_app")) + "</span>";
      oBtn.classList.toggle("focus", zone === "ambient" && ambI === 3);
    }
    var sp = !!(music && music.source === "spotify");
    pBtn.style.display = nBtn.style.display = sp ? "none" : "";
    if (oBtn) oBtn.style.display = sp && STANDALONE ? "none" : "";
    if (sp && ambI !== 1 && !(ambI === 3 && !STANDALONE)) ambI = 1;
    pBtn.classList.toggle("focus", zone === "ambient" && ambI === 0);
    plBtn.classList.toggle("focus", zone === "ambient" && ambI === 1);
    nBtn.classList.toggle("focus", zone === "ambient" && ambI === 2);
  }

  function renderAmbientMusic() {
    var on = npVisible() && AMBIENT_MUSIC && ambientOpen;
    document.documentElement.classList.toggle("ambient-active", on);
    document.documentElement.classList.toggle("ambient-minimized", !ambientOpen);
    if (!npVisible() || !AMBIENT_MUSIC) {
      document.documentElement.classList.remove("ambient-active", "ambient-playing", "ambient-minimized");
      return;
    }
    var playing = music.state === "playing";
    document.documentElement.classList.toggle("ambient-playing", playing);

    var appName = (music.app && music.app.name) || t("np_head");
    var title = music.title || "";
    var artist = music.artist || "";
    if (music.album) artist += (artist ? " · " : "") + music.album;

    $("ambient-app").textContent = appName;
    $("ambient-title").textContent = title;
    $("ambient-artist").textContent = artist;
    $("ambient-hint").textContent = "▼ " + t("ambient_down_hint");

    var artImg = $("ambient-art");
    if (music.art) {
      artImg.className = "ambient-art";
      if (artImg.src !== music.art) { artImg.src = music.art; }
      artImg.onerror = function () { artImg.className = "ambient-art gone"; };
    } else {
      artImg.className = "ambient-art gone";
    }

    var fallbackEl = $("ambient-art-fallback");
    if (fallbackEl) fallbackEl.innerHTML = ICONS.note;

    extractPalette(music.art, music.title, music.artist, function (colors) {
      document.documentElement.style.setProperty("--ambient-glow-1", colors[0]);
      document.documentElement.style.setProperty("--ambient-glow-2", colors[1]);
    });

    curProgress = music.position != null ? Number(music.position) : 0;
    curDuration = music.duration != null ? Number(music.duration) : 0;
    updateProgressUI();
    renderAmbientControls();
  }

  function ambPress() {
    if (!music) return;
    if (music.source === "spotify") {
      if (ambI === 1 && STANDALONE && window.CouchSpotify) window.CouchSpotify.playHere(note);
      else if (ambI === 3 && !STANDALONE) {
        var spPkg = (music.app && (music.app.package || music.app.id)) || null;
        if (spPkg) api("POST", "/api/launch", { app: spPkg }).catch(function (e) { note(tBridge(e.key, e.vars, e.message)); });
      }
      return;
    }
    if (ambI === 3) {
      var pkg = (music.app && (music.app.package || music.app.id)) || null;
      if (pkg) api("POST", "/api/launch", { app: pkg }).catch(function (e) { note(tBridge(e.key, e.vars, e.message)); });
      return;
    }
    var key = ["previous", "play_pause", "next"][ambI];
    if (key === "play_pause") {
      music.state = music.state === "playing" ? "paused" : "playing";
      renderAmbientMusic();
      renderNp();
    }
    sendMusicKey(key);
    setTimeout(refreshMusic, key === "play_pause" ? 1500 : 900);
  }

  function getPlaybackPosition() {
    if (!music) return 0;
    var pos = music.position || 0;
    if (music.state === "playing" && music.lastUpdateLocal) {
      var elapsed = Math.max(0, Date.now() - music.lastUpdateLocal);
      pos += elapsed * (music.speed || 1.0);
    }
    if (music.duration && music.duration > 0) {
      pos = Math.min(music.duration, Math.max(0, pos));
    }
    return Math.floor(pos);
  }

  function updateNpProgress() {
    if (!music || !music.duration || music.duration <= 0) return;
    if (zone === "np" && npSub === "bar") return;
    var pos = getPlaybackPosition();
    var curEl = $("np-pos");
    var fillEl = $("np-fill");
    if (curEl) curEl.textContent = fmtTime(pos);
    if (fillEl) fillEl.style.width = Math.min(100, Math.max(0, (pos / music.duration) * 100)) + "%";
  }

  function startProgressTimer() {
    clearInterval(npProgressTimer);
    if (music && music.state === "playing" && music.duration > 0) {
      npProgressTimer = setInterval(updateNpProgress, 500);
    }
  }

  var npFitKey = "";
  function npFit(k) { if (LOOP && k !== npFitKey) { npFitKey = k; fitDate(); } }

  function renderNp() {
    var el = $("np"), on = npVisible();
    el.classList.toggle("on", on);
    if (LOOP) $("shelf-section").classList.toggle("empty", !rowHasCards() && !CARDS.length);
    else if (NIGHT) {
      var anyone = rowHasCards();
      $("shelf-section").classList.toggle("empty", !anyone && !on);
      $("shelf-section").classList.toggle("kw-empty", !anyone);
      $("np-slot").classList.toggle("on", on);
      if (KW_ON && !data.shows.length && !CARDS.length) {   // renderShelf's empty line, never over custom cards
        var track = $("shelf");
        if (track) {
          var name = (PEOPLE[whoIndex()] && PEOPLE[whoIndex()].name) || "";
          track.innerHTML = on ? "" : ('<p class="shelf-none">' + esc(peopleCount() < 2 ? t("nothing_yet") : t("nothing_for", { name: name })) + "</p>");
        }
      }
      var stEl = $("shelf-title");
      if (stEl) {
        var headMode = SPOTIFY.separate_row === false || SPOTIFY.separate_row === "kw" ? "kw" : (SPOTIFY.separate_row === "none" ? "none" : "np");
        if (on && headMode === "none") {
          stEl.textContent = anyone ? t("keep_watching") : "";
        } else if (on && headMode === "np") {
          stEl.textContent = anyone ? (t("np_head") + " · " + t("keep_watching")) : t("np_head");
        } else {
          stEl.textContent = t("keep_watching");
        }
      }
    }
    var playing = !!(on && music && music.state === "playing");
    var isMiniOn = !!(NIGHT && on && SPOTIFY.card_style === "mini");
    var isMiniSquare = isMiniOn && (SPOTIFY.mini_art || "wide") === "square";
    document.documentElement.classList.toggle("waveform-on", !!(on && playing && SPOTIFY.waveform !== false));
    document.documentElement.classList.toggle("np-mini-mode", isMiniOn);
    document.documentElement.classList.toggle("np-mini-square", isMiniSquare);
    if (!on) {
      clearInterval(npProgressTimer);
      el.innerHTML = "";
      el.classList.remove("adaptive-tint", "np-mini", "np-art-square");
      el.style.removeProperty("--np-tint");
      el.style.removeProperty("--np-glow");
      el.style.removeProperty("--np-border");
      document.documentElement.classList.remove("np-sync-colors");
      document.documentElement.style.removeProperty("--np-glow");
      document.documentElement.style.removeProperty("--np-sync-bg");
      document.documentElement.style.removeProperty("--np-sync-border");
      document.documentElement.style.removeProperty("--np-sync-clock");
      document.documentElement.style.removeProperty("--np-sync-shadow");
      currentNpBtns = [];
      npSub = "btns";
      npFit("");
      return;
    }

    var cover = music.art || (music.source === "spotify-tv" ? iconUrl(SPOTIFY_TV) : "");
    var art = cover ? '<img class="np-art" src="' + esc(cover) + '" alt="" decoding="async" data-err="np">' :
      '<span class="np-art">' + ICONS.note + "</span>";

    if ((SPOTIFY.adaptive_tint !== false || SPOTIFY.sync_theme_colors) && cover && cover.indexOf("data:image/") === 0) {
      extractArtworkTint(cover, function (rgb) {
        var card = $("np");
        if (!card) return;
        if (rgb && SPOTIFY.adaptive_tint !== false) {
          card.classList.add("adaptive-tint");
          card.style.setProperty("--np-tint", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.32)");
          card.style.setProperty("--np-glow", "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
          card.style.setProperty("--np-border", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.45)");
          document.documentElement.style.setProperty("--np-glow", "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
        } else {
          card.classList.remove("adaptive-tint");
          if (rgb) document.documentElement.style.setProperty("--np-glow", "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")");
        }
        if (rgb && SPOTIFY.sync_theme_colors) {
          document.documentElement.classList.add("np-sync-colors");
          document.documentElement.style.setProperty("--np-sync-bg", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.22)");
          document.documentElement.style.setProperty("--np-sync-border", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.38)");
          var lr = Math.min(255, rgb[0] + 125), lg = Math.min(255, rgb[1] + 125), lb = Math.min(255, rgb[2] + 125);
          document.documentElement.style.setProperty("--np-sync-clock", "rgba(" + lr + "," + lg + "," + lb + ",0.38)");
          document.documentElement.style.setProperty("--np-sync-shadow", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.35)");
        } else {
          document.documentElement.classList.remove("np-sync-colors");
          document.documentElement.style.removeProperty("--np-sync-bg");
          document.documentElement.style.removeProperty("--np-sync-border");
          document.documentElement.style.removeProperty("--np-sync-clock");
          document.documentElement.style.removeProperty("--np-sync-shadow");
        }
      });
    } else {
      el.classList.remove("adaptive-tint");
      el.style.removeProperty("--np-tint");
      el.style.removeProperty("--np-glow");
      el.style.removeProperty("--np-border");
      document.documentElement.classList.remove("np-sync-colors");
      document.documentElement.style.removeProperty("--np-glow");
      document.documentElement.style.removeProperty("--np-sync-bg");
      document.documentElement.style.removeProperty("--np-sync-border");
      document.documentElement.style.removeProperty("--np-sync-clock");
      document.documentElement.style.removeProperty("--np-sync-shadow");
    }

    var primaryBtns = [];
    if (music.isSpotify && SPOTIFY.controls) {
      var actions = music.actions || 0;
      var canPrev = !actions || (actions & 16) !== 0;
      var canRewind = !actions || (actions & 256) !== 0 || (actions & 8) !== 0;
      var canPlay = !actions || (actions & 512) !== 0 || (actions & 4) !== 0 || (actions & 2) !== 0;
      var canFF = !actions || (actions & 256) !== 0 || (actions & 64) !== 0;
      var canNext = !actions || (actions & 32) !== 0;

      if (canPrev) primaryBtns.push({ act: "previous", label: t("np_prev"), icon: ICONS.prev });
      if (canRewind) primaryBtns.push({ act: "rewind", label: t("np_rewind", { s: SPOTIFY.seek_seconds }), icon: ICONS.rewind });
      if (canPlay) primaryBtns.push({ act: "play_pause", label: playing ? t("np_pause") : t("np_play"), icon: playing ? ICONS.pause : ICONS.play });
      if (canFF) primaryBtns.push({ act: "fast_forward", label: t("np_ff", { s: SPOTIFY.seek_seconds }), icon: ICONS.ff });
      if (canNext) primaryBtns.push({ act: "next", label: t("np_next"), icon: ICONS.next });
    } else if (music.isSpotify) {
      primaryBtns = [
        { act: "previous", label: t("np_prev"), icon: ICONS.prev },
        { act: "play_pause", label: playing ? t("np_pause") : t("np_play"), icon: playing ? ICONS.pause : ICONS.play },
        { act: "next", label: t("np_next"), icon: ICONS.next }
      ];
    } else {
      primaryBtns = npButtons().map(function (b) { return { act: b[0], label: b[1], icon: ICONS[b[0]] }; });
    }

    var extraBtns = [];
    if (music.isSpotify) {
      if (SPOTIFY.show_shuffle_repeat !== false) {
        if (music.can_shuffle) {
          var shufMode = music.shuffle || null;
          extraBtns.push({
            act: "shuffle", label: t("np_shuffle"), icon: ICONS.shuffle,
            text: shufMode === "smart" ? t("np_shuffle_smart_short") : "",
            active: shufMode === "normal" || shufMode === "smart", smart: shufMode === "smart", sm: true
          });
        }
        if (music.can_repeat) {
          var repMode = music.repeat || "off";
          extraBtns.push({
            act: "repeat", label: t("np_repeat"),
            icon: repMode === "one" ? ICONS.repeatOne : ICONS.repeat,
            active: repMode !== "off", sm: true
          });
        }
      }
      if (SPOTIFY.show_sleep_timer !== false) {
        var sleepRem = musicSleepEnd > Date.now() ? Math.max(1, Math.ceil((musicSleepEnd - Date.now()) / 60000)) : musicSleepMin;
        extraBtns.push({
          act: "music_sleep", label: t("music_sleep"), icon: ICONS.moon,
          text: sleepRem > 0 ? (sleepRem + "m") : "", active: sleepRem > 0, sm: true
        });
      }
      if (SPOTIFY.show_audio_output !== false && TV && TV.audioOutputInfo) {
        var outIcon = audioOutput.type === "bluetooth" ? ICONS.bluetooth : (audioOutput.type === "hdmi" ? ICONS.hdmi : ICONS.soundscape);
        var rawOut = (audioOutput.name || "").replace(/^[-\s]+/, "").trim();
        var outName = (audioOutput.type === "bluetooth" && rawOut) ? rawOut : t("audio_out_" + (audioOutput.type || "speaker"));
        extraBtns.push({ act: "audio_output", label: t("audio_output"), icon: outIcon, text: outName, sm: true });
      }
      if (SPOTIFY.show_jump_app !== false) {
        extraBtns.push({ act: "open_app", label: t("np_open_app"), icon: ICONS.launch, sm: true });
      }
    }

    var btns = primaryBtns.concat(extraBtns);
    npPrimaryCount = primaryBtns.length;
    currentNpBtns = music.isSpotify ? btns : [];
    if (npI >= btns.length) npI = Math.max(0, btns.length - 1);

    var curPos = getPlaybackPosition();
    var hasDuration = music.duration && music.duration > 0;
    var dispPos = (zone === "np" && npSub === "bar") ? npScrubPos : curPos;
    var pct = hasDuration ? Math.min(100, Math.max(0, (dispPos / music.duration) * 100)) : 0;
    var progHtml = hasDuration ? (
      '<div class="np-prog-wrap' + (zone === "np" && npSub === "bar" ? " focus" : "") + '" id="np-prog-wrap">' +
        '<span class="np-time" id="np-pos">' + fmtTime(dispPos) + '</span>' +
        '<div class="np-bar" id="np-bar">' +
          '<div class="np-fill" id="np-fill" style="width:' + pct + '%"></div>' +
          '<div class="np-scrub-tip" id="np-scrub-tip" style="left:' + pct + '%">' + fmtTime(dispPos) + '</div>' +
        '</div>' +
        '<span class="np-time">' + fmtTime(music.duration) + '</span>' +
      '</div>'
    ) : '';

    var showApp = SPOTIFY.show_app !== false;
    el.classList.toggle("no-app", !showApp);
    el.classList.toggle("np-mini", NIGHT && SPOTIFY.card_style === "mini");
    el.classList.toggle("np-art-square", !!(NIGHT && SPOTIFY.card_style === "mini" && (SPOTIFY.mini_art || "wide") === "square"));
    var appLabel = (music.app && music.app.name) || (music.isSpotify ? "Spotify" : t("np_head"));
    var appHtml = showApp ? ('<span class="np-app">' + esc(appLabel) + "</span>") : '';

    var titleMode = SPOTIFY.title_mode || "pingpong";
    var titleContent = "";
    if (titleMode === "continuous") {
      titleContent = '<div class="np-title-wrap mode-continuous">' +
        '<div class="np-title-track">' +
          '<b class="np-title">' + esc(music.title) + '</b>' +
          '<span class="np-title-spacer"></span>' +
          '<b class="np-title np-title-dup" aria-hidden="true">' + esc(music.title) + '</b>' +
          '<span class="np-title-spacer"></span>' +
        '</div>' +
      '</div>';
    } else if (titleMode === "pingpong") {
      titleContent = '<div class="np-title-wrap mode-pingpong">' +
        '<div class="np-title-track">' +
          '<b class="np-title">' + esc(music.title) + '</b>' +
        '</div>' +
      '</div>';
    } else {
      titleContent = '<div class="np-title-wrap mode-dots">' +
        '<b class="np-title">' + esc(music.title) + '</b>' +
      '</div>';
    }

    var primaryHtml = primaryBtns.map(function (b, i) {
      return '<span class="nb' + (zone === "np" && npSub === "btns" && i === npI ? " focus" : "") + '" role="button" aria-label="' + esc(b.label) + '">' + b.icon + "</span>";
    }).join("");

    var upNextHtml = (SPOTIFY.show_up_next !== false && music.up_next_title) ? (
      '<div class="np-up-next">' + esc(t("np_up_next")) + ' <b>' + esc(music.up_next_title) + '</b>' +
      (music.up_next_artist ? (' · ' + esc(music.up_next_artist)) : '') + '</div>'
    ) : '';

    var extraHtml = (upNextHtml || extraBtns.length) ? (
      '<div class="np-extra">' + upNextHtml +
        (extraBtns.length ? ('<div class="np-sub-ctl">' + extraBtns.map(function (b, j) {
          var idx = primaryBtns.length + j;
          return '<span class="nb nb-sm' + (b.active ? " active" : "") + (b.smart ? " np-smart" : "") + (zone === "np" && npSub === "btns" && idx === npI ? " focus" : "") +
            '" role="button" aria-label="' + esc(b.label) + '">' + b.icon +
            (b.text ? ('<span class="nb-label">' + esc(b.text) + '</span>') : '') + "</span>";
        }).join("") + '</div>') : '') +
      '</div>'
    ) : '';

    el.innerHTML = '<div class="np-main-row">' + art + '<div class="np-t">' + appHtml +
      titleContent + "<small>" + esc(music.artist || music.album || "") + "</small>" +
      progHtml + "</div>" +
      '<div class="np-ctl">' + primaryHtml + "</div></div>" + extraHtml;

    updateTitleMarquee();
    startProgressTimer();
    npFit([music.title, music.artist || music.album || "", btns.length].join("\n"));
  }

  function updateTitleMarquee() {
    var wrap = $("np") ? $("np").querySelector(".np-title-wrap") : null;
    if (!wrap) return;
    var titleEl = wrap.querySelector(".np-title");
    if (!titleEl) return;
    if (wrap.classList.contains("mode-dots")) {
      wrap.classList.remove("overflowing");
      return;
    }
    var wrapWidth = wrap.clientWidth;
    if (wrapWidth === 0) {
      if (!wrap.dataset.mqRetry) {
        wrap.dataset.mqRetry = "1";
        requestAnimationFrame(updateTitleMarquee);
      }
      wrap.classList.remove("overflowing");
      return;
    }
    var titleWidth = titleEl.scrollWidth;
    if (titleWidth > wrapWidth + 4) {
      wrap.classList.add("overflowing");
      var overflow = titleWidth - wrapWidth;
      wrap.style.setProperty("--marquee-overflow", overflow + "px");
      if (wrap.classList.contains("mode-pingpong")) {
        var dur = Math.max(5, Math.min(22, Math.round(overflow / 30) + 3));
        wrap.style.setProperty("--marquee-dur", dur + "s");
      } else if (wrap.classList.contains("mode-continuous")) {
        var totalDist = titleWidth + 48;
        var cDur = Math.max(6, Math.min(25, Math.round(totalDist / 35)));
        wrap.style.setProperty("--marquee-dur", cDur + "s");
      }
    } else {
      wrap.classList.remove("overflowing");
    }
  }

  // Where the Spotify card can work: the TV home app reads the TV's own player (TV.spotifyState), and a
  // computer at home reads it over ADB (/api/spotify/now_playing) for the home app on an Android TV. Not in a
  // browser, the on-TV app, a standalone site or a TV a computer runs without Android.
  function spotifyWorks() { return !!(TV && (TV.spotifyState || (!OFFLINE && !ON_TV))); }
  // A cover from the TV's own player is a picture inside the message (data:), never a link: a link would load
  // from Spotify, and the card sends nothing to Spotify. The computer at home's cover comes from its own lookup.
  function localArt(a) { return typeof a === "string" && a.indexOf("data:image/") === 0 ? a : null; }

  function handleSpotifyState(s, local) {
    if (s && local) s.art = localArt(s.art);
    if (!s || !s.available || !s.title) {
      if (music && music.isSpotify) {
        music = null;
        renderNp();
        if (zone === "np") paintFocus();
      }
      return;
    }
    var had = !!music;
    music = {
      isSpotify: true,
      title: s.title,
      artist: s.artist,
      album: s.album,
      duration: s.duration || 0,
      state: s.state || "stopped",
      position: s.position || 0,
      lastUpdateLocal: Date.now(),
      speed: s.speed || 0.0,
      actions: s.actions || 0,
      art: s.art || null,
      up_next_title: s.up_next_title || null,
      up_next_artist: s.up_next_artist || null,
      shuffle: s.shuffle || null,
      repeat: s.repeat || null,
      can_shuffle: !!s.can_shuffle,
      can_repeat: !!s.can_repeat,
      app: { name: s.app_name || (s.package && s.package.indexOf("spotify") >= 0 ? "Spotify" : t("np_head")), package: s.package || "com.spotify.tv.android" }
    };
    refreshAudioOutput(false);
    renderNp();
    if (had !== !!music && zone === "np" && !music) paintFocus();
  }

  function refreshSpotify() {
    if (!SPOTIFY.enabled || !spotifyWorks()) return;
    if (TV && TV.spotifyState) {
      try {
        var raw = TV.spotifyState();
        if (raw) handleSpotifyState(JSON.parse(raw), true);
      } catch (e) {}
      return;
    }
    if (!OFFLINE && !ON_TV) {
      api("GET", "/api/spotify/now_playing", null, 4000).then(function (j) {
        if (j && j.spotify) handleSpotifyState(j.spotify);
      }).catch(function () {});
    }
  }

  var QUEUE, queueAt = 0;
  function refreshQueue() {
    if (document.hidden || (OFFLINE && !STANDALONE) || !document.querySelector(".cd-layer .cw-k-queue")) return;
    queueAt = Date.now();
    var ask = STANDALONE ? fetch(window.CouchSpotify ? window.CouchSpotify.url("api/now?queue=1") : "api/now?queue=1", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      : api("GET", "/api/music/queue", null, 8000);
    ask.then(function (j) {
      QUEUE = j && Array.isArray(j.queue) ? { ok: true, items: j.queue.slice(0, 10) } : { ok: false };
      if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("queue", QUEUE.ok ? QUEUE.items.map(function (s) { return s && s.title; }) : "off");
    }, function () {});
  }
  window.CouchQueueNow = function () { return QUEUE; };
  setInterval(function () { var age = Date.now() - queueAt; if ((QUEUE === undefined && age > 6000) || age > 20000) refreshQueue(); }, 2000);

  function refreshMusic() {
    if (SPOTIFY.enabled) {
      refreshSpotify();
      if (music && music.isSpotify) return;
    }
    if (!NP_ON || (OFFLINE && !STANDALONE && !LOCAL_SPOTIFY) || covered()) {
      if (music && !music.isSpotify) { music = null; ambientOpen = false; renderNp(); renderAmbientMusic(); }
      return;
    }
    var ask;
    if (LOCAL_SPOTIFY) {
      var local = null;
      try { local = JSON.parse(TV.spotifyMusic()); } catch (e) {}
      ask = Promise.resolve({ music: local && local.title ? local : {
        title: t("spotify_open"), state: "idle", source: "spotify-tv", app: { name: "Spotify", package: SPOTIFY_TV }
      } });
    } else if (STANDALONE) {
      ask = fetch(window.CouchSpotify ? window.CouchSpotify.url("api/now") : "api/now", { cache: "no-store" })
        .then(function (r) { return r.json(); });
    } else ask = api("GET", "/api/music", null, 5000);
    ask.then(function (j) {
      if (STANDALONE && j && j.music && window.CouchSpotify) window.CouchSpotify.warm();
      var had = !!music;
      music = j.music || null;
      var src = (music && music.source) || "";
      if (src !== npSrc) { npSrc = src; npI = Math.min(1, Math.max(0, npButtons().length - 1)); }
      if (music && music.state !== "idle" && AMBIENT_MUSIC) {
        var trackKey = (music.title || "") + " - " + (music.artist || "");
        if (trackKey !== lastTrackKey) {
          lastTrackKey = trackKey;
          ambientDismissed = false;
          // only take the screen from the home itself: never from Home settings, a menu or a pop-up
          if ((zone === "grid" || zone === "shelf" || zone === "np") && !kidsOn()) {
            ambientOpen = true;
            zone = "ambient";
            ambI = 1;
          }
        }
      } else if (!music || music.state === "idle") {
        ambientOpen = false;
        lastTrackKey = "";
        if (zone === "ambient") { zone = "grid"; paintFocus(); }
      }
      renderNp();
      renderAmbientMusic();
      if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("music", music ? [music.title, music.artist, music.state] : null);
      if (had !== !!music && (zone === "np" || zone === "ambient") && !music) paintFocus();
    }, function () {
      if (music && !music.isSpotify) {
        music = null;
        ambientOpen = false;
        lastTrackKey = "";
        renderNp();
        renderAmbientMusic();
        if (zone === "np" || zone === "ambient") paintFocus();
      }
    });
  }

  function npCommitSeek(targetMs) {
    if (!music) return;
    music.position = targetMs;
    music.lastUpdateLocal = Date.now();
    npSub = "btns";
    renderNp();
    if (TV && TV.spotifyControl) {
      TV.spotifyControl("seek", targetMs);
      setTimeout(refreshSpotify, 600);
    } else if (!OFFLINE) {
      api("POST", "/api/spotify/control", { action: "seek", position: targetMs }).catch(function (e) { note(e.message); });
      setTimeout(refreshSpotify, 600);
    }
  }

  function npPress() {
    if (!music) return;
    if (music.isSpotify && npSub === "bar") {
      npCommitSeek(npScrubPos);
      return;
    }
    if (music.isSpotify && currentNpBtns.length) {
      var btn = currentNpBtns[npI];
      if (!btn) return;
      var act = btn.act;
      if (act === "music_sleep") { toggleMusicSleep(); return; }
      if (act === "open_app") { jumpIntoMusicApp(); return; }
      if (act === "audio_output") {
        if (TV && TV.openAudioOutput) TV.openAudioOutput();
        return;
      }
      if (TV && TV.spotifyControl) {
        if (act === "play_pause") {
          music.state = music.state === "playing" ? "paused" : "playing";
          music.lastUpdateLocal = Date.now();
          renderNp();
          TV.spotifyControl("play_pause", 0);
        } else if (act === "rewind") {
          TV.spotifyControl("rewind", SPOTIFY.seek_seconds * 1000);
        } else if (act === "fast_forward") {
          TV.spotifyControl("fast_forward", SPOTIFY.seek_seconds * 1000);
        } else if (act === "shuffle") {
          var curS = music.shuffle;
          var isSpApp = !!(music.app && music.app.package && music.app.package.indexOf("com.spotify") === 0);
          var nextS = !curS ? null : (curS === "off" ? "normal" : (curS === "normal" && isSpApp ? "smart" : "off"));
          TV.spotifyControl("shuffle", nextS === "off" ? 0 : (nextS === "smart" ? 2 : 1));
          toast(nextS ? t("np_shuffle_" + nextS) : t("np_shuffle_toggled"));
          setTimeout(refreshSpotify, 350);
          return;
        } else if (act === "repeat") {
          var curR = music.repeat || "off";
          var nextR = curR === "off" ? "all" : (curR === "all" ? "one" : "off");
          TV.spotifyControl("repeat", nextR === "all" ? 2 : (nextR === "one" ? 1 : 0));
          toast(t("np_repeat_" + nextR));
          setTimeout(refreshSpotify, 350);
          return;
        } else {
          TV.spotifyControl(act, 0);
        }
        setTimeout(refreshSpotify, act === "play_pause" ? 1200 : 600);
        return;
      }
      if (!OFFLINE) {
        if (act === "play_pause") {
          music.state = music.state === "playing" ? "paused" : "playing";
          music.lastUpdateLocal = Date.now();
          renderNp();
        }
        api("POST", "/api/spotify/control", { action: act, interval: SPOTIFY.seek_seconds }).catch(function (e) { note(e.message); });
        setTimeout(refreshSpotify, act === "play_pause" ? 1200 : 600);
        return;
      }
    }
    var b = npButtons()[npI];
    if (!b) return;
    if (b[2] === "spotify-open") { tvLaunch(SPOTIFY_TV); return; }
    if (b[2] === "here") { window.CouchSpotify.playHere(note); return; }
    if (b[0] === "expand") {
      ambientOpen = true;
      ambientDismissed = false;
      zone = "ambient";
      ambI = 1;
      paintFocus();
      renderAmbientMusic();
      return;
    }
    var key = { prev: "previous", play: "play_pause", pause: "play_pause", next: "next" }[b[0]];
    if (key === "play_pause") {
      music.state = music.state === "playing" ? "paused" : "playing";
      renderNp();
      renderAmbientMusic();
    }
    sendMusicKey(key);
    setTimeout(refreshMusic, key === "play_pause" ? 1500 : 900);
  }

  setInterval(function () {
    if (music && music.state === "playing" && ambientOpen) {
      curProgress += 1;
      updateProgressUI();
    }
  }, 1000);

  // ---------------- quick buttons: from tvs[].quick in config.json, in that order ----------------
  // sleep: the sleep timer. picture: flip between the TV's two picture modes. look: Night scenes or
  // Classic. input: the TV's input list. A button that cannot work right now is left out (no bridge
  // for the sleep timer, a TV with no picture setting, an input list nobody can open).
  var SLEEP_CHOICES = [15, 30, 60, 90, 0];   // 0 = off
  // picture mode only exists where the bridge says this TV supports it
  var sleepEnds = null, picMode = null, picCanSet = false, picShown = false, picBusy = false, picModes = null;
  var btShown = false;   // the bridge can open the Bluetooth screen on this TV (GET /api/bluetooth-audio)
  var qi = 0, menuI = 0, noteTimer = null, quickReady = false, quickEls = [];

  function note(text) {
    clearTimeout(noteTimer);
    $("quick-note").textContent = text || "";
    if (text) noteTimer = setTimeout(function () { $("quick-note").textContent = ""; }, 6000);
  }
  // A short confirmation in the middle of the top of the screen, for something that happened by
  // itself (the weekly Developer Mode extend) rather than a key press.
  var toastTimer = null;
  function toast(text) {
    var el = $("toast");
    el.innerHTML = ICONS.check + "<span>" + esc(text) + "</span>";
    el.classList.add("on");
    clearTimeout(toastTimer);
    // and its words go once it has faded, so the page does not keep saying it (a Frame's page read later still
    // had "This TV is a bit slow" in it, long after it was shown once)
    toastTimer = setTimeout(function () { el.classList.remove("on"); toastTimer = setTimeout(function () { el.innerHTML = ""; }, 1000); }, 9000);
  }
  function bedtimeOn() { return HOME.bedtime_dim === true; }   // off unless config.json home.bedtime_dim is true
  function refreshBedtimeDim() {
    var m = minutesLeft();
    var dim = bedtimeOn() && m > 0 && m <= 15;
    document.documentElement.classList.toggle("bedtime-dim", dim);
    soundscapeFollowSleep(m);
  }
  function minutesLeft() {
    if (!sleepEnds && OFFLINE && TV && TV.getSleepRemainingMinutes) {
      try {
        var nativeMin = TV.getSleepRemainingMinutes();
        if (nativeMin > 0) sleepEnds = Date.now() + nativeMin * 60000;
      } catch (e) {}
    }
    if (!sleepEnds) {
      document.documentElement.classList.remove("bedtime-dim");
      return 0;
    }
    var m = Math.ceil((sleepEnds - Date.now()) / 60000);
    if (m <= 0) {
      sleepEnds = null;
      document.documentElement.classList.remove("bedtime-dim");
      return 0;
    }
    var dim = bedtimeOn() && m > 0 && m <= 15;
    document.documentElement.classList.toggle("bedtime-dim", dim);
    return m;
  }
  function nativeInputs() {
    try { return !!(TV && TV.canOpenInputs && TV.canOpenInputs()); } catch (e) { return false; }
  }
  function nativeScreensaver() {
    try { return !!(TV && TV.canStartScreensaver && TV.canStartScreensaver()); } catch (e) { return false; }
  }
  function nativeSleep() {
    try { return !!(TV && TV.canSleep && TV.canSleep()); } catch (e) { return false; }
  }
  function nativeSettingsScreen() {
    try { return !!(TV && TV.openSettingsScreen); } catch (e) { return false; }
  }
  // ---------------- Developer Mode (LG): extend the session, at most once a week ----------------
  // LG removes an app installed in Developer Mode when the session runs out. The Extend button lives
  // in LG's Developer Mode app, so the home opens that app with {"extend": true} for a moment (see
  // lg/app/webos.js), then says it is done once the home is opened again. It is left out on every
  // other TV.
  var devBusy = false;
  function devCan() { try { return !!(TV && TV.extendDevMode); } catch (e) { return false; } }
  function devDue() {
    if (!OFFLINE || !devCan() || TVCFG.extend_devmode === false) return false;   // with a bridge, it extends daily itself
    var last = parseInt(kept("tvhome.devmode.last"), 10) || 0;
    return Date.now() - last > 7 * 24 * 3600 * 1000;
  }
  // The app may be restarted while the Developer Mode app is in front: a note kept before it opened
  // tells the next start that the Extend was sent, so it can say so.
  function devResume() {
    // webOS stops the timers of a page that is behind another app, so the Extend's own answer never
    // arrives while the Developer Mode app is in front: the button is put back here, the moment the
    // home is on screen again.
    if (devBusy) { devBusy = false; renderQuick(); }
    var p = parseInt(kept("tvhome.devmode.pending"), 10) || 0;
    if (p) {
      keep("tvhome.devmode.pending", "");
      note("");
      if (Date.now() - p < 15 * 60 * 1000) {
        keep("tvhome.devmode.last", String(p));
        toast(t("dev_done"));
      }
    }
    devAsk();
  }
  // Once a week the home asks, on screen, whether to extend Developer Mode. The question stays put
  // until someone answers it with the remote: this TV drops into LG's clock (a burn-in saver) while
  // nobody touches it, and a question that timed out would be missed. Answering No keeps it quiet for
  // a day; opening the Developer Mode app by hand counts as having dealt with it for a day too.
  function devAsk() {
    if (!devDue()) return;
    var asked = parseInt(kept("tvhome.devmode.asked"), 10) || 0;
    if (Date.now() - asked < 24 * 3600 * 1000) return;
    if (zone !== "grid" && zone !== "shelf" && zone !== "people" && zone !== "quick") return;
    askKind = "dev";
    ai = 0;
    zone = "updask";
    clearFocus();
    renderAsk();
  }
  function devExtend() {
    if (devBusy || !devCan()) return;
    devBusy = true;
    keep("tvhome.devmode.pending", String(Date.now()));
    renderQuick();
    note(t("dev_start"));
    var started = true;
    try {
      started = TV.extendDevMode(function (ok) {
        devBusy = false;
        renderQuick();
        if (ok) {
          keep("tvhome.devmode.last", String(Date.now()));
          keep("tvhome.devmode.pending", "");
          toast(t("dev_done"));
        } else {
          keep("tvhome.devmode.pending", "");
          note(t("dev_failed"));
        }
      });
    } catch (e) { started = false; }
    if (started === false) {   // still finishing the last press: nothing to say, nothing to keep
      devBusy = false;
      keep("tvhome.devmode.pending", "");
      renderQuick();
    }
  }
  // LG's webOSRelaunch is the reliable "the app is back" signal on webOS 6.5.3 (a page that is
  // behind another app still says document.hidden === false there), so the note is read on both.
  document.addEventListener("visibilitychange", function () { if (!document.hidden) devResume(); });
  document.addEventListener("webOSRelaunch", devResume);
  // the home's own quick buttons this TV can do; quickCan: one button this TV can do (the Quick buttons
  // widget leaves out the rest)
  function quickVisible() { return QUICK.filter(quickCan); }
  function quickCan(q) {
    {
      if (q === "sleep") return !OFFLINE || nativeSleep();
      if (q === "picture") return !OFFLINE && picShown;
      if (q === "look") return true;
      if (q === "soundscape") return true;
      if (q === "headphones") return !!(TV && TV.openSettingsScreen) || (!OFFLINE && (ON_TV || btShown));
      if (q === "screen_off") return true;
      if (q === "input") return !OFFLINE || nativeInputs();
      if (q === "screensaver") return nativeScreensaver();
      if (q === "bluetooth" || q === "network") return nativeSettingsScreen() || (ON_TV && !OFFLINE);
      if (q === "tvsettings") return !!(TV && (TV.launch || TV.openSettings)) || !OFFLINE;
      if (q === "extend") return devOn();
      if (q === "reminder") return !!window.Reminders;
      return false;
    }
  }
  function hasQuick() { return quickVisible().length > 0 && !designHides("quick"); }
  // a part a design hides is out of the remote's way too: focus never lands on something you cannot see
  function designHides(part) { return typeof CouchDesign !== "undefined" && CouchDesign.on() && CouchDesign.hides(part); }
  function shelfReach() { return shelfEls.length > 0 && !designHides("keep_watching"); }
  function picLabel() {
    if (picBusy) return t("switching");
    var names = picModes || (TVCFG.picture_modes || []).map(function (n) { return { id: null, name: n }; });
    var hit = names.filter(function (m) { return m.id === picMode; })[0];
    if (hit) return hit.name;
    if (picMode && picMode !== "other") return picMode.charAt(0).toUpperCase() + picMode.slice(1).replace(/-/g, " ");
    return t("picture_mode");
  }
  function renderQuick() {
    quickReady = true;
    var box = $("qbtns"), vis = quickVisible(), key = vis.join(",");
    if (box.getAttribute("data-k") !== key) {
      box.innerHTML = vis.map(function (q) { return '<span class="qbtn" id="q-' + q + '"></span>'; }).join("");
      box.setAttribute("data-k", key);
    }
    $("quick").classList.toggle("none", !vis.length);
    quickEls = vis.map(function (q) { return $("q-" + q); });
    var m = minutesLeft();
    vis.forEach(function (q) {
      var el = $("q-" + q);
      if (q === "sleep") {
        // Loop: the minutes left replace the glyph, in the accent (app.css .qmin)
        el.innerHTML = (LOOP && m ? '<b class="qmin">' + m + "</b>" : ICONS.moon) + "<span>" + esc(m ? t(NIGHT ? "off_in_night" : "off_in", { m: m }) : t("sleep_timer")) + "</span>";
        el.classList.toggle("set", !!m);
      } else if (q === "picture") {
        el.innerHTML = ICONS.picture + "<span>" + esc(picLabel()) + "</span>";
        el.classList.toggle("off", !picCanSet);
      } else if (q === "look") {
        var nextLbl = THEME === "night" ? t("oled_look") : THEME === "oled" ? t("classic_look") : THEME === "classic" ? t("look_loop") : t("night_look");
        el.innerHTML = ICONS.look + "<span>" + esc(nextLbl) + "</span>";
      } else if (q === "soundscape") {
        var curSound = window.Soundscape ? window.Soundscape.current() : "off";
        var isPlaying = curSound !== "off";
        var lbl = isPlaying ? (t("sound_" + curSound) || curSound) : t("soundscape");
        el.innerHTML = ICONS.soundscape + "<span>" + esc(lbl) + "</span>";
        el.classList.toggle("set", isPlaying);
      } else if (q === "headphones") {
        el.innerHTML = ICONS.headphones + "<span>" + esc(t("headphones")) + "</span>";
      } else if (q === "screen_off") {
        el.innerHTML = ICONS.screen_off + "<span>" + esc(t("screen_off")) + "</span>";
      } else if (q === "input") {
        el.innerHTML = ICONS.input + "<span>" + esc(t("input")) + "</span>";
      } else if (q === "screensaver") {
        el.innerHTML = ICONS.screensaver + "<span>" + esc(t("quick_screensaver")) + "</span>";
      } else if (q === "extend") {
        el.innerHTML = ICONS.devmode + "<span>" + esc(t(devBusy ? "dev_extending" : "dev_extend")) + "</span>";
        el.classList.toggle("set", devBusy);
      } else if (q === "bluetooth" || q === "network") {
        el.innerHTML = ICONS[q] + "<span>" + esc(t(q)) + "</span>";
      } else if (q === "tvsettings") {
        el.innerHTML = ICONS.gear + "<span>" + esc(t("gear_tv")) + "</span>";
      } else if (q === "reminder") {
        el.innerHTML = ICONS.reminder + "<span>" + esc(t("quick_reminder")) + "</span>";
        el.setAttribute("aria-label", t("quick_reminder"));
      }
    });
    var sv = $("q-screensaver");   // an icon only look (Night) still says what it is, to the eye and to a screen reader
    if (sv) { sv.setAttribute("aria-label", t("quick_screensaver")); sv.setAttribute("title", t("quick_screensaver_sub")); }
    if (qi >= vis.length) qi = Math.max(0, vis.length - 1);
    fitDate();
    if (LOOP) loopMask(key);   // the glass follows the buttons that show, not the focus
  }
  // a short list straight under the Sleep timer button (#33, thanks alonmustafa), up and down to choose
  function renderMenu() {
    var menu = $("sleep-menu");
    menu.innerHTML = SLEEP_CHOICES.map(function (c, i) {
      return '<span class="opt' + (i === menuI ? " focus" : "") + '">' + esc(c ? t("n_min", { n: c }) : t("timer_off")) + "</span>";
    }).join("");
  }
  function openMenu() {
    var m = minutesLeft();
    menuI = m ? SLEEP_CHOICES.length - 1 : 1;   // a timer is running: start on Off; otherwise 30 min
    zone = "menu";
    var menu = $("sleep-menu"), btn = $("q-sleep");
    menu.classList.add("on");
    renderMenu();
    if (btn) {
      var rtl = (document.documentElement.dir === "rtl" || document.documentElement.getAttribute("dir") === "rtl");
      if (rtl) {
        menu.style.right = "auto";
        menu.style.left = Math.max(0, btn.getBoundingClientRect().left - $("quick").getBoundingClientRect().left) + "px";
      } else {
        menu.style.left = "auto";
        menu.style.right = Math.max(0, $("quick").getBoundingClientRect().right - btn.getBoundingClientRect().right) + "px";
      }
    }
  }
  function closeMenu() {
    var menu = $("sleep-menu");
    menu.classList.remove("on");
    menu.style.left = "";
    menu.style.right = "";
    zone = "quick";
  }
  function setSleep(minutes) {
    closeMenu();
    if (OFFLINE && TV && TV.setSleepTimer) {   // no bridge: the launcher keeps the timer itself; with one, the bridge does
      try { TV.setSleepTimer(minutes); } catch (e) {}
    }
    sleepEnds = minutes ? Date.now() + minutes * 60000 : null;   // show it straight away
    renderQuick();
    refreshBedtimeDim();
    if (!OFFLINE) {
      api("POST", "/api/sleep", { minutes: minutes })
        .then(function (j) { if (j.ends !== undefined) sleepEnds = j.ends ? Date.parse(j.ends) : null; renderQuick(); refreshBedtimeDim(); })
        .catch(function (e) { note(tBridge(e.key, e.vars, e.message)); refreshQuick(); });
    }
  }
  function togglePicture() {
    if (!picCanSet) { note(t("pic_not_ready")); return; }
    // A picture switch can take several seconds. Extra presses meanwhile would switch it straight back,
    // so they do nothing, and the label says what the TV actually ended on, not a guess.
    if (picBusy) return;
    picBusy = true;
    renderQuick();
    api("POST", "/api/picture", { mode: "toggle" }, 20000)
      .then(function (j) { if (j.mode) picMode = j.mode; })
      .catch(function (e) { note(tBridge(e.key, e.vars, e.message)); })
      .then(function () { picBusy = false; renderQuick(); });
  }
  // The look is kept on this TV; the page starts again in the other look.
  function toggleLook() {
    if (THEME === "night") ST.look = "oled";
    else if (THEME === "oled") ST.look = "classic";
    else if (THEME === "classic") ST.look = "loop";
    else ST.look = "night";
    keep("tvhome.look", ST.look);
    saveSettings();
    restart();
  }
  // Start the page again, so a new look or new settings take effect everywhere at once.
  // A location.replace to the very same address can be dropped by the launcher's WebView, so
  // reload when nothing in the address changes.
  function restart() {
    var to = location.href.replace(/([?&])theme=[a-z]+&?/, "$1").replace(/[?&]$/, "");
    if (to === location.href) location.reload();
    else location.replace(to);
  }
  // Screen off / Audio-only mode: turns off the display (pitch black canvas for OLEDs and hardware backlight floor)
  // while sleep soundscapes, Spotify, and sleep timers continue playing in the dark.
  var screenOffActive = false;
  function toggleScreenOff(on) {
    var overlay = $("screen-off-overlay");
    screenOffActive = !!on;
    if (screenOffActive && zone === "makeit") makeitClose();
    if (screenOffActive) {
      if (overlay) {
        var hint = $("screen-off-hint");
        if (hint) {
          hint.textContent = t("screen_off_wake_hint");
          hint.style.animation = "none";
          void hint.offsetHeight;
          hint.style.animation = "";
        }
        overlay.classList.add("active");
      }
      try { if (TV && TV.setScreenOff) TV.setScreenOff(true); } catch (e) {}
    } else {
      if (overlay) overlay.classList.remove("active");
      try { if (TV && TV.setScreenOff) TV.setScreenOff(false); } catch (e) {}
      paintFocus();
      clock();   // the clock rested in the dark
    }
    sceneVideos(!screenOffActive);
    if (LOOP) { if (screenOffActive) loopPause(); else loopResume(); }
    designVideo("off", screenOffActive);
    resetIdlePhoto();
  }
  // Smart Idle & OLED-safe Ambient Clock
  var lastSmartActivityAt = Date.now();
  function resetSmartIdle() {
    lastSmartActivityAt = Date.now();
    clipWake();   // a changed idle time takes effect at once
  }
  function isQuietHours(qh) {
    if (!qh || !qh.enabled) return false;
    var h, m;
    try {
      if (WXCFG && WXCFG.timezone && WXCFG.timezone !== "auto" && typeof Intl !== "undefined") {
        var parts = new Intl.DateTimeFormat("en-GB", { timeZone: WXCFG.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "hour") h = parseInt(parts[i].value, 10);
          else if (parts[i].type === "minute") m = parseInt(parts[i].value, 10);
        }
      }
    } catch (e) {}
    if (typeof h !== "number" || isNaN(h) || typeof m !== "number" || isNaN(m)) {
      var d = new Date(); h = d.getHours(); m = d.getMinutes();
    }
    var cur = (h % 24) * 60 + m;
    var sp = (qh.start || "23:00").split(":"), ep = (qh.end || "06:00").split(":");
    var start = (parseInt(sp[0], 10) || 0) * 60 + (parseInt(sp[1], 10) || 0);
    var end = (parseInt(ep[0], 10) || 0) * 60 + (parseInt(ep[1], 10) || 0);
    if (start === end) return true;
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  }
  function setIdleAmbient(on) {
    var ov = $("idle-ambient-overlay");
    idleAmbientActive = !!on;
    if (idleAmbientActive && zone === "makeit") makeitClose();
    if (idleAmbientActive) {
      clock();
      updateOledShift();
      if (ov) {
        var hint = $("idle-wake-hint");
        if (hint) {
          hint.textContent = t("screen_off_wake_hint");
          hint.style.animation = "none";
          void hint.offsetHeight;
          hint.style.animation = "";
        }
        ov.classList.toggle("quiet-hours", isQuietHours(SMART_IDLE.quiet_hours));
        ov.classList.add("active");
      }
    } else if (ov) {
      ov.classList.remove("active");
    }
    sceneVideos(!idleAmbientActive);   // no clip decoding behind the ambient clock
    designVideo("idle", idleAmbientActive);
    loopCover();   // nor the Loop look's
  }
  // a design's video background (design.js, bg-video.js) stops while the home is not on screen
  function designVideo(why, held) { if (typeof CouchDesign !== "undefined" && CouchDesign.hold) CouchDesign.hold(why, held); }
  // Opening an app lets go of the video's decoder and memory at once, before Android pauses the home
  // (a 1 GB TCL, 0.13.10): the app gets them while it starts. If no app came up after 4 s, it plays again.
  var openingT = null;
  function videoOpening(done) {
    clearTimeout(openingT);
    designVideo("opening", !!done);
    if (done) openingT = setTimeout(function () { designVideo("opening", false); }, 4000);
    return done;
  }
  function tvLaunch(pkg) { designVideo("opening", true); return videoOpening(TV.launch(pkg)); }
  function tvWatchNext(id) { designVideo("opening", true); return videoOpening(TV.openWatchNext(id)); }
  function soundscapePlaying() {
    try { return !!(window.Soundscape && window.Soundscape.current && window.Soundscape.current() !== "off"); } catch (e) { return false; }
  }
  function checkSmartIdle() {
    if (!SMART_IDLE.enabled || covered() || screenOffActive || idleAmbientActive) return;
    var mins = isQuietHours(SMART_IDLE.quiet_hours) ? SMART_IDLE.quiet_hours.idle_minutes : SMART_IDLE.home_idle_minutes;
    if (!mins && !window.MOCK_SMART_IDLE_MS) return;
    var thresh = window.MOCK_SMART_IDLE_MS || (mins * 60000);
    if (Date.now() - lastSmartActivityAt < thresh) return;
    var act = SMART_IDLE.home_action || "ambient_clock";
    if (act === "screen_off") {
      toggleScreenOff(true);
    } else if (act === "tv_off") {
      if (soundscapePlaying() && !sleepEnds) { setIdleAmbient(true); return; }
      if (sleepEnds && !OFFLINE) api("POST", "/api/sleep", { minutes: 0 }).catch(function () {});
      if (TV && TV.powerOff) { try { TV.powerOff(); return; } catch (e) {} }
      if (!OFFLINE) api("POST", "/api/key", { key: "power" }).catch(function () {});
    } else {
      setIdleAmbient(true);
    }
  }
  // The TV's own input list (HDMI, a console, a set top box): the TV_INPUT key through the bridge,
  // or straight from the launcher when there is no bridge (only where the TV has such a screen).
  function openInputs() {
    // the TV lists its inputs: couch-tv's own menu, each one opening straight away (#30)
    var list = inputList();
    if (list.length) { openInputMenu(list); return; }
    var native = function () { try { return !!(TV && TV.openInputs && TV.openInputs()); } catch (e) { return false; } };
    if (OFFLINE) { if (!native()) note(t("no_inputs")); return; }
    api("POST", "/api/key", { key: "input" })
      .catch(function (e) { if (!native()) note(tBridge(e.key, e.vars, e.message)); });
  }
  // ---------------- the Input menu (#30) ----------------
  // The TV's own inputs, read by the launcher from Android's TV input list (TVOS.tvInputs): each HDMI
  // port by the TV's own name for it (ARC or eARC only where that label says so; Android has no public
  // way to read it), the devices HDMI-CEC found behind it, then Bluetooth and Network. A TV that lists
  // no inputs keeps its own input screen. ?mock=1&inputs=4 stands in four ports for a preview.
  var inI = 0, inItems = [], inFrom = "quick";   // inFrom: "grid" when the Inputs tile opened it
  function inputList() {
    try {
      if (TV && TV.tvInputs) return JSON.parse(TV.tvInputs()) || [];
      if (window.MOCK_INPUTS) return window.MOCK_INPUTS;
    } catch (e) {}
    return [];
  }
  function openInputMenu(list) {
    inItems = list.map(function (x) {
      var kind = x.type === "hdmi" ? "HDMI" : t("input");
      var sub = (x.devices || []).join(", ");
      return { act: "input", id: x.id, icon: ICONS.input, label: x.label || kind, sub: sub };
    });
    if ((TV && TV.openSettingsScreen) || ON_TV || window.MOCK_INPUTS) {
      inItems.push({ act: "bluetooth", icon: ICONS.bluetooth, label: t("bluetooth"), sub: t("bt_sub") });
      inItems.push({ act: "network", icon: ICONS.network, label: t("network"), sub: t("net_sub") });
    }
    inFrom = zone === "grid" ? "grid" : "quick";
    inI = 0; zone = "inputs";
    renderInputMenu();
  }
  function renderInputMenu() {
    var pop = $("inputs-pop");
    pop.innerHTML = inItems.map(function (it, i) {
      return '<div class="grow' + (i === inI ? " focus" : "") + '" role="menuitem"><i>' + it.icon + "</i><span><b>" + esc(it.label) +
        "</b>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span></div>";
    }).join("");
    pop.classList.add("on");
    hintFlash = t("inputs_hint"); renderHint();
    // under the Input button, or above the Inputs tile, kept inside the screen's safe area
    var rem = innerWidth / 120;
    if (inFrom === "grid") {
      var tile = gridEls[g];
      if (tile) {
        var tb = tile.getBoundingClientRect(), tw = pop.offsetWidth, th = pop.offsetHeight;
        if (tb.top - th - 2.25 * rem >= 3.75 * rem) {   // room above the tile (the Night dock)
          pop.style.left = Math.max(5 * rem, Math.min(innerWidth - tw - 5 * rem, tb.left + tb.width / 2 - tw / 2)) + "px";
          pop.style.top = (tb.top - th - 2.25 * rem) + "px";
        } else {   // no room above (a Classic or OLED grid): beside the tile, never over it
          pop.style.left = Math.max(5 * rem, Math.min(innerWidth - tw - 5 * rem, tb.right + 1.25 * rem)) + "px";
          pop.style.top = Math.max(3.75 * rem, Math.min(innerHeight - th - 3.75 * rem, tb.top + tb.height / 2 - th / 2)) + "px";
        }
      }
      return;
    }
    var el = quickEls[qi];
    if (el) {
      var b = el.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(5 * rem, Math.min(innerWidth - w - 5 * rem, b.right - w)) + "px";
      pop.style.top = Math.max(3.75 * rem, Math.min(innerHeight - pop.offsetHeight - 3.75 * rem, b.bottom + 1.25 * rem)) + "px";
    }
  }
  function closeInputMenu() {
    $("inputs-pop").classList.remove("on");
    hintFlash = "";
    if (zone === "inputs") zone = inFrom === "grid" ? "grid" : "quick";
  }
  function doInputMenu() {
    var it = inItems[inI];
    closeInputMenu();
    if (!it) return;
    if (it.act === "input") {
      var done = false;
      try { done = !!(TV && TV.openInput && TV.openInput(it.id)); } catch (e) {}
      if (!done) note(window.MOCK_INPUTS ? t("opening", { title: it.label }) : t("no_inputs"));
      return;
    }
    openSettingsScreen(it.act);
  }
  // The TV's Bluetooth or network settings: native launcher bridge when available, else on-TV server.
  function openSettingsScreen(which) {
    if (nativeSettingsScreen()) {
      var ok = false;
      try { ok = !!TV.openSettingsScreen(which); } catch (e) {}
      if (ok) return;
    }
    if (ON_TV && !OFFLINE) api("POST", "/api/launch", { app: which }).catch(function (e) { note(tBridge(e.key, e.vars, e.message)); });
  }
  // The TV's own screensaver (Google TV's Ambient mode: the Google Photos albums are chosen there).
  function startScreensaver() {
    var ok = false;
    try { ok = !!(TV && TV.startScreensaver && TV.startScreensaver()); } catch (e) {}
    if (!ok) note(t("no_screensaver"));
  }
  // Google TV's own Ambient mode settings: where the source and the Google Photos albums are picked.
  function openAmbientSettings() {
    var ok = false;
    try { ok = !!(TV && TV.openAmbientSettings && TV.openAmbientSettings()); } catch (e) {}
    if (!ok) { SET.msg = t("no_screensaver"); renderSettings(); }
  }
  function quickAction(one) {
    var q = one || quickVisible()[qi];
    if (q === "sleep") openMenu();
    else if (q === "picture") togglePicture();
    else if (q === "look") toggleLook();
    else if (q === "soundscape") cycleSoundscape();
    else if (q === "headphones") openBluetoothScreen();
    else if (q === "screen_off") toggleScreenOff(true);
    else if (q === "input") openInputs();
    else if (q === "screensaver") startScreensaver();
    else if (q === "extend") devExtend();
    else if (q === "bluetooth" || q === "network") openSettingsScreen(q);
    else if (q === "tvsettings") openTvSettings();
    else if (q === "reminder") openReminders();
  }

  // ---------------- reminders (reminders.js): said into the remote's mic, kept on this TV ----------------
  var remPrev = "quick";
  function openReminders() {
    if (!window.Reminders) return;
    remPrev = zone; zone = "remind"; clearFocus();
    window.Reminders.open();
  }
  function remindersInit() {
    if (!window.Reminders) return;
    window.Reminders.init({
      keep: keep, kept: kept, toast: toast,
      who: function () { var p = personById(who); return p ? p.name : ""; },
      clock24: function () { return CLOCK24; },
      canListen: function () { try { return !!(TV && TV.canListen && TV.canListen()); } catch (e) { return false; } },
      listen: function (prompt) { try { return !!(TV && TV.listen && TV.listen(prompt)); } catch (e) { return false; } },
      // a due reminder pops up only over the plain home, never over Settings, a menu or kids mode
      canAlert: function () {
        return NIGHT && !document.hidden && !lift && !expanded && !kidsOn() && !idleAmbientActive && !screenOffActive &&
          ["grid", "shelf", "quick", "people"].indexOf(zone) >= 0;
      },
      takeKeys: function () { remPrev = zone; zone = "remind"; clearFocus(); },
      done: function () { zone = ["grid", "shelf", "quick", "people"].indexOf(remPrev) >= 0 ? remPrev : "grid"; paintFocus(); }
    });
  }
  // Headphones: the TV's own Bluetooth screen. The launcher opens it itself, the on-TV app through
  // its /api/launch, and the bridge with a fixed ADB command (POST /api/bluetooth-audio, no body).
  function openBluetoothScreen() {
    if (TV && TV.openSettingsScreen) {
      try { TV.openSettingsScreen("bluetooth"); return; } catch (e) {}
    }
    if (OFFLINE) { note(t("quick_needs_bridge")); return; }
    if (ON_TV) { openSettingsScreen("bluetooth"); return; }
    api("POST", "/api/bluetooth-audio").catch(function (e) {
      note(tBridge(e.key, e.vars, e.message) || t("headphones_not_found"));
    });
  }
  function refreshQuick() {
    var jobs = [];
    if (QUICK.indexOf("sleep") >= 0) {
      jobs.push(api("GET", "/api/sleep").then(function (j) { sleepEnds = j.ends ? Date.parse(j.ends) : null; }, function () {}));
    }
    if (QUICK.indexOf("picture") >= 0) {
      jobs.push(api("GET", "/api/picture").then(function (j) {
        picShown = j.supported !== false;
        picMode = j.mode || null; picCanSet = !!j.can_set;
        if (j.modes && j.modes.length) picModes = j.modes;
      }, function () { picShown = false; picCanSet = false; }));
    }
    if (QUICK.indexOf("headphones") >= 0 && !ON_TV && !OFFLINE) {
      jobs.push(api("GET", "/api/bluetooth-audio").then(function (j) {
        btShown = j.supported === true;
      }, function () { btShown = false; }));
    }
    return Promise.all(jobs).then(renderQuick);
  }

  // ---------------- Keep watching ----------------
  function subtitle(it) {
    var parts = [];
    if (it.app && it.app.name) parts.push(it.app.name);
    if (it.kind === "video") parts.push(t("video_card"));   // a YouTube video: no season, episode or picture
    if (it.season && it.episode) parts.push("S" + it.season + ", E" + it.episode);
    if (it.episode_title) parts.push(it.episode_title);
    return parts.join("  ·  ");
  }

  // ---------------- who is watching: none, a pill switch for two, a head icon and a list for more ----------------
  var PALETTE = ["#ff9f0a", "#30b350", "#0a84ff", "#bf5af2", "#ff375f", "#00a5a8", "#5e5ce6", "#ac8e68"];
  function peopleCount() { return NOBODY ? 0 : PEOPLE.length; }
  function isHead() { return peopleCount() >= 3; }
  function colourOf(p) {
    if (p.colour) return p.colour;
    for (var h = 0, i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  // a person's photo from the account (a checked JPEG data URL, design-code.js photoOf), or ""
  function photoOfPerson(p) {
    return p && typeof CouchDesignCode !== "undefined" && CouchDesignCode.photoOf ? CouchDesignCode.photoOf(ACCOUNT, p.id) : "";
  }
  // the photo in a circle when the account sent one; the initial on its colour stays underneath, so a
  // photo that does not load still shows the person (data-err="remove" takes the picture away)
  function avatarHTML(p) {
    var ph = photoOfPerson(p);
    return '<span class="avatar' + (ph ? " has-photo" : "") + '" style="background:' + esc(colourOf(p)) + '">' + esc((p.name || "?").trim().charAt(0).toUpperCase()) +
      (ph ? '<img class="avatar-photo" src="' + esc(ph) + '" alt="" decoding="async" data-err="remove">' : "") + "</span>";
  }
  function whoIndex() { return Math.max(0, PEOPLE.map(function (p) { return p.id; }).indexOf(who)); }

  function renderPeople() {
    var el = $("people"), n = peopleCount();
    el.classList.toggle("none", n < 2);
    el.classList.toggle("head", n >= 3);
    if (n >= 3) {
      var cur = PEOPLE[whoIndex()];
      el.innerHTML = avatarHTML(cur) + '<span class="sr">' + esc(cur.name) + "</span>";
    } else {
      el.innerHTML = PEOPLE.map(function (p) {
        return '<span class="person' + (p.id === who ? " on" : "") + '">' + esc(p.name) + "</span>";
      }).join("");
    }
    renderPop();
    if (LOOP && npVisible()) fitDate();   // Now playing sits under the people, so it moves with them
  }

  function renderPop() {
    var el = $("people-pop");
    if (!el.classList.contains("on")) return;
    el.innerHTML = '<div class="plist">' + PEOPLE.map(function (p, i) {
      var cls = "prow" + (i === pmi ? " focus" : "") + (plift && i === pmi ? " lifted" : "") + (p.id === who ? " on" : "");
      var tail = plift && i === pmi ? '<i class="pmark">' + ICONS.updown + "</i>" : p.id === who ? '<i class="pmark">' + ICONS.check + "</i>" : "";
      return '<div class="' + cls + '">' + avatarHTML(p) + "<b>" + esc(p.name) + "</b>" + tail + "</div>";
    }).join("") + '</div><p class="phint">' + (plift ? t("people_lift_hint") : t("people_hold_hint")) + "</p>";
  }
  function openPop() {
    zone = "pmenu"; pmi = whoIndex(); plift = false;
    $("people-pop").classList.add("on");
    renderPop();
  }
  function closePop() {
    $("people-pop").classList.remove("on");
    $("people-pop").innerHTML = "";
    plift = false;
    zone = "people";
  }
  function pickWho(id) {
    if (id === who) return;
    who = id; s = 0;
    try { localStorage.setItem("tvhome.who", who); } catch (e) {}
    if (!NOBODY) api("POST", "/api/who", { who: who }).catch(function () {});
    renderShelf();
    kidSync();
    mood(true);
  }
  // A person switch made elsewhere (the phone, another TV): when the bridge's "who" changes, show
  // that person here too.
  var bridgeWho = null;
  // Every 3 s while the home can be seen (a phone that switched the person shows here within a
  // moment); while the bridge does not answer the wait doubles up to 30 s. Returns the request.
  var whoEvery = 3000;
  function followWhoTick() {
    if (!active()) { setTimeout(followWhoTick, 3000); return; }
    followWho().then(function () { whoEvery = 3000; }, function () { whoEvery = Math.min(30000, whoEvery * 2); })
      .then(function () { setTimeout(followWhoTick, whoEvery); });
  }
  function followWho() {
    if (NOBODY) return Promise.resolve();
    return api("GET", "/api/who").then(function (j) {
      try {
        var w = j && j.who;
        if (!w || w === bridgeWho) return;
        var first = bridgeWho === null;
        bridgeWho = w;
        if (first || w === who) return;   // the first answer only sets the baseline
        if (!PEOPLE.some(function (p) { return p.id === w; })) return;
        who = w; s = 0;
        try { localStorage.setItem("tvhome.who", who); } catch (e) {}
        renderShelf();
        kidSync();
      } catch (e) { console.error(e); }   // a drawing error is not a bridge failure: no backoff
    });
  }

  // ---------------- kids mode (kids.js, docs/CONFIG.md "Kids mode") ----------------
  // A kids profile's home is kids.js's shelf, drawn over everything here. app.js keeps who is
  // watching; kids.js shows or hides itself from that, and hands back here once the parent PIN is right.
  function kidsOn() { return !!(window.KidsMode && window.KidsMode.active()); }
  // the person watching is marked a guest (docs/CONFIG.md, "guest": true)
  function guestOn() { return !NOBODY && PEOPLE.some(function (p) { return p && p.id === who && p.guest === true; }); }
  function kidSync() {
    if (!window.KidsMode) return;
    var p = NOBODY ? null : PEOPLE.filter(function (x) { return x.id === who; })[0] || null;
    var was = kidsOn();
    window.KidsMode.sync(p);
    if (kidsOn() && !was) kidsCover();
    if (kidsOn() !== was) loopCover();   // the Loop look's clips stop behind the shelf, and come back after it
  }
  // going into kids mode: whatever was open here closes first, so nothing is left behind the shelf
  function kidsCover() {
    if (zone === "settings") closeSettings();
    else if (zone === "gear") closeGear();
    else if (zone === "appmenu") closeAppMenu();
    else if (zone === "shelfmenu") closeShelfMenu();
    else if (zone === "pmenu") closePop();
    else if (zone === "menu") closeMenu();
    else if (zone === "inputs") closeInputMenu();
    else if (zone === "smart") closeSmart();
    else if (zone === "remind") { remPrev = "grid"; window.Reminders.close(); }
    else if (zone === "updask") { $("gear-pop").classList.remove("on", "ask"); document.documentElement.classList.remove("gearing"); }
    else if (zone === "ambient") { ambientOpen = false; ambientDismissed = true; renderAmbientMusic(); }
    if (lift) dropLift();
    if (expanded) { expanded = false; renderGrid(); }
    zone = "grid";
    clearFocus();
  }
  // the PIN was right: this TV moves to the first grown up (the bridge checks the PIN again)
  function kidsUnlocked(kid, code) {
    var grown = PEOPLE.filter(function (x) { return !window.KidsMode.isKid(x); })[0];
    touched = true;
    loopCover();   // kids.js has left kids mode already (before kidSync could see it): the Loop look's clips again
    if (grown) {
      who = grown.id; s = 0;
      try { localStorage.setItem("tvhome.who", who); } catch (e) {}
      if (!OFFLINE) api("POST", "/api/who", { who: who, pin: code }).catch(function () {});
    } else {
      window.KidsMode.stayUnlocked(kid.id);
    }
    renderShelf();
    startFocus();
    paintFocus();
  }
  function kidsInit() {
    if (!window.KidsMode) return;
    window.KidsMode.init({
      t: t, esc: esc, iconUrl: iconUrl, TV: TV, api: api, keep: keep, kept: kept,
      clock24: function () { return CLOCK24; },
      online: function () { return !OFFLINE && data.bridge !== false; },
      colour: colourOf, avatar: avatarHTML,
      appName: function (pkg) {
        var a = (data.apps || []).filter(function (x) { return x.package === pkg; })[0];
        return a ? a.name : pkg;
      },
      installed: function (pkg) { return !(data.apps || []).length || (data.apps || []).some(function (x) { return x.package === pkg; }); },
      launch: function (pkg) {
        opened(pkg);
        if (TV && tvLaunch(pkg)) return;
        api("POST", "/api/launch", { app: pkg }).catch(function (e) { status(tBridge(e.key, e.vars, e.message)); });
      },
      isOk: isOk, isBack: isBack, isMenu: isMenu, isSettings: isSettings, arrowOf: arrowOf,
      unlocked: kidsUnlocked
    });
  }
  // The order of the names: kept by the bridge (the phone's People sheet uses the same list), or on
  // this TV when there is no bridge. "pending" means the bridge has not heard about it yet.
  function savePeopleOrder() {
    var ids = PEOPLE.map(function (p) { return p.id; });
    keep("tvhome.people.order", { ids: ids, pending: true });
    if (OFFLINE || data.bridge === false) return;
    api("POST", "/api/people", { order: ids })
      .then(function () { keep("tvhome.people.order", { ids: ids, pending: false }); }, function () {});
  }
  function dropPeople() {
    plift = false;
    savePeopleOrder();
    renderPeople();
  }

  // Keep watching shows up to ten per person; the row slides along under the remote.
  var KEEP_MAX = 10;

  // ---------------- the row follows the app the remote is on (home.shelf_follows_app) ----------------
  // followPkg is the package of the app tile the remote is on, or null for the whole row. While it is
  // set, the row shows only that app's cards (under the YouTube tile, also that person's videos from the
  // bridge) under a "Recently on <app>" heading. An app with nothing on the go changes nothing: the
  // whole row stays, so the row never empties or flickers as the remote runs along the dock.
  var followPkg = null, shelfShown = "";
  function pkgOf(it) { return (it.app && it.app.package) || it.package || ""; }
  function fullShows() { return KW_ON ? (data.showsBy[who] || []).slice(0, KEEP_MAX) : []; }
  // one app's cards: its shows from the row, then its videos (only YouTube has any), each newest first
  function showsFor(pkg) {
    return fullShows().filter(function (it) { return pkgOf(it) === pkg; })
      .concat((data.videosBy[who] || []).filter(function (it) { return pkgOf(it) === pkg; })).slice(0, KEEP_MAX);
  }
  // the list on screen: the followed app's cards when it has some, else the whole row
  function visibleShows() {
    if (!followPkg) return fullShows();
    var mine = showsFor(followPkg);
    return mine.length ? mine : fullShows();
  }
  // the app the heading names, or null while the whole row shows
  function followName() {
    if (!followPkg) return null;
    var mine = showsFor(followPkg);
    if (!mine.length) return null;
    var a = (data.apps || []).filter(function (x) { return x.package === followPkg; })[0];
    return a ? a.name : (mine[0].app && mine[0].app.name) || followPkg;
  }
  // what the row would show now, as one string: the heading and the ids of the cards
  function shelfKey() { return (followName() || "") + "\n" + visibleShows().map(function (it) { return it.id; }).join("\n"); }
  // Which app the row follows right now: the app tile the remote is on (not More apps, Settings, an input, a
  // Screen or a tool), kept while the remote has gone up from it into the row or holds OK on a card there;
  // anywhere else (another tile, the people, the quick buttons, Now playing, a menu) the whole row comes
  // back. Called from paintFocus on every press, so the row is drawn again only when its cards would change.
  function followSync() {
    var want = null;
    if (SHELF_FOLLOW && KW_ON && !kidsOn() && !lift) {
      if (zone === "grid") { var a = gridItems[g]; want = a && (a.kind === "app" || !a.kind) && a.package ? a.package : null; }
      else if (zone === "shelf" || zone === "shelfmenu") want = followPkg;
    }
    if (want === followPkg) return false;
    followPkg = want;
    if (shelfKey() === shelfShown) return false;   // the same cards under the same heading: nothing to redraw
    renderShelf();
    s = Math.max(0, Math.min(s, shelfEls.length - 1));   // the row may have fewer cards now
    // the track still sits where the longer row was scrolled to, and only a press in the row moves it:
    // a shorter row drawn under it would start off screen, under the heading, until the remote came back up
    scrollShelf();
    return true;
  }
  // The row has something to show: the cards on screen now (one app's, or someone's videos under the
  // YouTube tile, which showsBy never holds) or someone's shows. renderShelf and renderNp hide the row on
  // this, so a person whose only history is YouTube videos still sees their "Recently on YouTube".
  function rowHasCards() {
    return KW_ON && (data.shows.length > 0 || PEOPLE.some(function (p) { return (data.showsBy[p.id] || []).length > 0; }));
  }

  // home.keep_watching_style "poster" (#192): the Night row uses the Classic tiles. Not in the Loop look
  // (its own thumbnails), the TV's own Spotify row (its own tiles) or a couch-tv Studio design (its own shapes).
  function postersFit() { return NIGHT && !LOOP && !LOCAL_SPOTIFY && !(typeof CouchDesign !== "undefined" && CouchDesign.on()); }
  function nightPosters() { return postersFit() && KW_POSTER; }

  function renderShelf() {
    var track = $("shelf");
    document.documentElement.classList.toggle("kw-poster", nightPosters());
    data.shows = KW_ON ? visibleShows() : [];   // the whole row, or one app's cards while the remote follows it
    if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("shows", [who, data.shows.map(function (x) { return x.title + (x.progress || ""); })]);
    var anyone = rowHasCards();
    // nobody has anything on the go: no empty box, the photo has the space (unless Now playing
    // is up at night). The people switcher stays: with nothing yet (Netflix tells Android nothing on
    // some TVs, issue #23) it is the only way to say who is watching before anything is played.
    $("shelf-section").classList.toggle("empty", !anyone && !(NIGHT && !LOOP && npVisible()) && !CARDS.length);
    // custom cards keep the row (and its heading) even with Keep watching switched off
    document.documentElement.classList.toggle("kw-off", !KW_ON && !CARDS.length);
    var following = followName();
    var kwText = following ? t("recently_on", { app: following }) : t(data.shows.length || !CARDS.length ? "keep_watching" : "custom_cards");
    var headMode = SPOTIFY.separate_row === false || SPOTIFY.separate_row === "kw" ? "kw" : (SPOTIFY.separate_row === "none" ? "none" : "np");
    if (NIGHT && npVisible() && headMode === "none") {
      $("shelf-title").textContent = rowHasCards() ? kwText : "";
    } else if (NIGHT && npVisible() && headMode === "np") {
      $("shelf-title").textContent = rowHasCards() ? (t("np_head") + " · " + kwText) : t("np_head");
    } else {
      $("shelf-title").textContent = kwText;
    }
    shelfShown = shelfKey();
    renderPeople();
    if (!KW_ON) { track.innerHTML = ""; shelfEls = []; addCards(track); return; }   // row switched off: only the custom cards, if any
    if (!data.shows.length) {
      var name = PEOPLE[whoIndex()].name;
      track.innerHTML = ((NIGHT && npVisible()) || CARDS.length) ? "" : '<p class="shelf-none">' + esc(peopleCount() < 2 ? t("nothing_yet") : t("nothing_for", { name: name })) + "</p>";
      shelfEls = [];
      addCards(track);
      return;
    }
    if (NIGHT && LOOP) {
      // bare 320x180 thumbnails, the title and the app under each; no thumbnail: a plate with the app's icon
      track.innerHTML = data.shows.map(function (it) {
        var art = slim(it.backdrop || it.poster), pkg = it.app && it.app.package, ic = pkg ? iconUrl(pkg) : null;
        // a picture that fails is asked for again (#274), through data-err as in the other looks, never inline onerror
        var inner = art ? '<img class="thumb" src="' + esc(art) + '" alt="" decoding="async" data-err="kwretry">' +
            (ic ? '<img class="lbadge" src="' + esc(ic) + '" alt="" data-err="remove">' : "")
          : (ic ? '<img class="picon" src="' + esc(ic) + '" alt="" data-err="remove">' : "");
        return '<div class="tile lcard"><div class="lthumb' + (art ? "" : " plate") + '">' + inner +
          (it.progress ? '<span class="lbar"><i style="width:' + Math.round(it.progress * 100) + '%"></i></span>' : "") +
          "</div><b>" + esc(it.title) + "</b><i>" + esc(loopSub(it)) + "</i></div>";
      }).join("");
      shelfEls = Array.prototype.slice.call(track.children);
      addCards(track);
      return;
    }
    if (NIGHT && !nightPosters()) {
      // lock screen notifications: glass cards, three in view, the row slides past the third
      track.innerHTML = data.shows.map(function (it) {
        var art = slim(it.backdrop || it.poster), pkg = it.app && it.app.package;
        var ep = it.kind === "video" ? t("video_card") : it.season && it.episode ? "S" + it.season + " E" + it.episode : (it.episode_title || "");
        return '<div class="tile ncard">' +
          (art ? '<img class="thumb" src="' + esc(art) + '" alt="" decoding="async" data-err="kwretry" data-pkg="' + esc(pkg || "") + '">' : '<span class="thumb none"></span>') +
          '<div class="t"><div class="nap">' + (pkg && iconUrl(pkg) ? '<img src="' + esc(iconUrl(pkg)) + '" alt="" data-err="remove">' : "") +
          esc(it.app ? it.app.name : "") + "</div><b>" + esc(it.title) + "</b>" + (ep ? "<i>" + esc(ep) + "</i>" : "") +
          (it.progress ? '<span class="nbar"><i style="width:' + Math.round(it.progress * 100) + '%"></i></span>' : "") + "</div></div>";
      }).join("");
      shelfEls = Array.prototype.slice.call(track.children);
      addCards(track);
      return;
    }
    // Classic, and the Night look's poster style: plain 16:9 tiles (on Night two dock columns wide, the
    // focused one with its title under it, as the photo there stays put under the clock)
    track.innerHTML = data.shows.map(function (it) {
      var art = slim(it.backdrop || it.poster);
      var pkg = it.app && it.app.package;
      var badge = pkg && iconUrl(pkg) ? '<span class="badge"><img src="' + esc(iconUrl(pkg)) + '" alt="" data-err="parent"></span>' : "";
      var bar = it.progress ? '<span class="bar"><i style="width:' + Math.round(it.progress * 100) + '%"></i></span>' : "";
      return '<div class="tile show"><div class="face">' +
        (art ? '<img src="' + esc(art) + '" alt="" decoding="async" data-err="kwretry" data-pkg="' + esc(pkg || "") + '" data-title="' + esc(it.title) + '">' : '<span class="no-art">' + esc(it.title) + "</span>") +
        badge + bar + '</div><div class="caption"><b>' + esc(it.title) + "</b><span>" + esc(subtitle(it)) + "</span></div></div>";
    }).join("");
    shelfEls = Array.prototype.slice.call(track.children);
    addCards(track);
  }

  // ---------------- custom cards (home.custom_cards, cards.js; idea from geissmannz on Instagram) ----------------
  // The household's own cards, at the end of the Keep watching row. Display only: every string goes in
  // with textContent, an image only from an http(s) link, and OK opens an installed app or an http(s)
  // link through the same /api/launch the app tiles use. Off (no cards, no fetching) unless set.
  var CARDS = [];
  function cardAt(i) { return i >= data.shows.length ? CARDS[i - data.shows.length] || null : null; }
  function addCards(track) {
    CARDS.forEach(function (c) {
      var el = document.createElement("div");
      var img = null;
      if (c.image) {
        img = document.createElement("img");
        img.alt = ""; img.decoding = "async";
        img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
        img.src = c.image;
      }
      var add = function (parent, tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        n.textContent = text;
        parent.appendChild(n);
        return n;
      };
      if (NIGHT && !nightPosters()) {
        el.className = "tile ncard ccard";
        if (img) { img.className = "thumb"; el.appendChild(img); }
        var tx = document.createElement("div");
        tx.className = "t";
        if (c.subtitle) add(tx, "div", "nap", c.subtitle);
        add(tx, "b", "", c.title);
        if (c.value) add(tx, "i", "", c.value);
        el.appendChild(tx);
      } else {
        el.className = "tile show ccard" + (img ? " has-img" : "");
        var face = document.createElement("div");
        face.className = "face";
        if (img) face.appendChild(img);
        var words = document.createElement("div");
        words.className = "cwords";
        if (c.value) add(words, "span", "cvalue", c.value);
        add(words, "b", "", c.title);
        face.appendChild(words);
        el.appendChild(face);
      }
      track.appendChild(el);
      shelfEls.push(el);
    });
  }
  function openCard(c) {
    if (!c || (!c.app && !c.url)) return;
    if (c.app && TV && TV.launch && tvLaunch(c.app)) return;
    if (c.url && TV && TV.openUrl) {
      if (TV.openUrl(c.url)) return;
      status(t("err_philips_no_browser") || "No browser installed");
      return;
    }
    if (OFFLINE) {
      if (c.url && window.open) {
        try { window.open(c.url, "_blank"); return; } catch (_) {}
      }
      status(t("computer_off"));
      return;
    }
    api("POST", "/api/launch", { app: c.app || c.url }).catch(function (e) { status(tBridge(e.key, e.vars, e.message)); });
  }
  function setCards(list) {
    if (!list) return;   // not JSON, or nothing came back: keep the last good cards
    var before = JSON.stringify(CARDS);
    CARDS = list;
    if (JSON.stringify(list) === before) return;
    // redraw now only where it cannot pull anything from under the remote; otherwise the next refresh does
    if (zone === "shelf" || zone === "grid" || zone === "people" || zone === "quick" || zone === "np") {
      renderShelf();
      s = Math.max(0, Math.min(s, shelfEls.length - 1));
      paintFocus();
    }
  }
  function refreshCards(force) {
    var src = HOME.custom_cards, CC = window.CustomCards;
    if (!src || !CC) return;
    // a link: the on-TV app (or a home with no computer) reads it itself, so it needs CORS
    var direct = function () {
      if (typeof src !== "string" || !window.fetch) return;
      fetch(src, { credentials: "omit", cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (s) { setCards(s == null ? null : CC.parse(s)); }, function () {});
    };
    if (OFFLINE) { direct(); return; }
    var q = force ? "?force=1" : "";
    api("GET", "/api/custom-cards" + q, null, 9000).then(function (j) { setCards(CC.clean(j.cards || [])); }, direct);
  }

  // ---------------- apps ----------------
  function tucked(a) {
    return TUCKED.indexOf(a.package) >= 0 || TUCKED_NAMES.test(a.name || "");
  }
  function isNew(pkg) { return newApps.indexOf(pkg) >= 0; }
  // The TV's apps less the ones hidden in Home settings (they come back from the Apps list there).
  function shownApps() { return data.apps.filter(function (a) { return HIDDEN_TV.indexOf(a.package) < 0; }); }
  // The gear tile: always there, whatever the TV calls its own settings app. OK opens a small menu,
  // Home settings (this page's own) or TV settings (Android's).
  function gearItem() { return { kind: "gear", name: t("settings"), package: SETTINGS_PKG }; }
  function moreItem() { return { kind: "more", name: t("more_apps") }; }
  // Smart home (optional, smarthome.js): its tile sits just before the gear tile, only when
  // config.json has a home_assistant section with rooms or scenes. Otherwise nothing changes.
  function smartOn() { return !!(window.smartHome && window.smartHome.available()); }
  function smartItem() { return { kind: "smart", name: t("smart_home"), package: "smart:home" }; }
  // LG's own Developer Mode app, in More apps: it opens the app itself, so the Extend button and
  // the remaining days are there to use by hand (the quick button does the Extend for you).
  function devOn() { return devCan() && TVCFG.extend_devmode !== false; }
  function devItem() { return { kind: "devmode", name: t("dev_app"), package: "com.palmdts.devmode" }; }
  // The Inputs tile (#154): first in the dock, opens the same Input menu as the Input quick button, so
  // HDMI is one press from where the apps are. Only where that menu has something to open.
  function inputsTileItem() {
    if (!INPUT_TILE || (typeof CouchDesign !== "undefined" && CouchDesign.on())) return null;
    if (OFFLINE && !nativeInputs() && !inputList().length) return null;
    return { kind: "inputs", name: t("input"), package: "inputs:menu" };
  }

  function toolItems() {
    var list = [];
    if (smartOn()) list.push(smartItem());
    if (devOn() && expanded) list.push(devItem());
    list.push(gearItem());
    return list;
  }

  function resolveInputs() {
    // this TV's own input tiles (tvs[].inputs in config.json) win over the shared home.inputs
    var raw = Array.isArray(TVCFG.inputs) ? TVCFG.inputs
      : HOME.inputs || (window.COUCH_CONFIG && window.COUCH_CONFIG.home && window.COUCH_CONFIG.home.inputs);
    if (!Array.isArray(raw) || !raw.length) return [];
    var detected = inputList();
    var list = [];
    raw.forEach(function (cfg) {
      if (!cfg || typeof cfg !== "object") return;
      var label = cfg.label || cfg.name || "HDMI";
      var icon = cfg.icon || "hdmi";
      var matchId = null;

      if (detected.length) {
        var found = detected.filter(function (d) {
          if (cfg.id && d.id === cfg.id) return true;
          if (cfg.port && (d.label || "").toLowerCase().indexOf("hdmi " + cfg.port) >= 0) return true;
          if (cfg.port && (d.id || "").toLowerCase().indexOf("hw" + cfg.port) >= 0) return true;
          if (cfg.match && ((d.label || "").toLowerCase().indexOf(cfg.match.toLowerCase()) >= 0 || (d.id || "").toLowerCase().indexOf(cfg.match.toLowerCase()) >= 0)) return true;
          if (cfg.device && (d.devices || []).some(function (dev) { return dev.toLowerCase().indexOf(cfg.device.toLowerCase()) >= 0; })) return true;
          return false;
        })[0];
        if (found) matchId = found.id;
      }
      if (!matchId) matchId = cfg.id || (cfg.port ? "HDMI_" + cfg.port : "input_" + label);
      list.push({
        kind: "input",
        id: matchId,
        name: label,
        icon: icon,
        image: typeof cfg.image === "string" && /^\w[\w./-]*\.(svg|png|jpe?g|webp)$/i.test(cfg.image) && cfg.image.indexOf("..") < 0 && cfg.image.indexOf("//") < 0 ? cfg.image : null,
        package: "input:" + matchId
      });
    });
    return list;
  }

  function gridList() {
    if (NIGHT) return dockList();
    var apps = shownApps().filter(function (a) { return a.package !== SETTINGS_PKG; });
    var list = apps.filter(function (a) { return !tucked(a); });
    var extra = apps.filter(tucked);
    var inputs = resolveInputs();
    list = list.concat(inputs);
    var inTile = inputsTileItem();
    if (inTile) list.unshift(inTile);
    data.screens.forEach(function (sc) { list.push({ kind: "screen", id: sc.id, name: sc.name, ready: sc.ready, note: sc.note, noteKey: sc.note_key, noteVars: sc.note_vars }); });
    var tools = toolItems();
    if (expanded) return list.concat(extra, tools);
    if (extra.length || list.length > GRID_MAX - tools.length) {
      list = list.slice(0, GRID_MAX - 1 - tools.length).concat(tools, [moreItem()]);
    } else list = list.concat(tools);
    return list;
  }

  // Night: a dock of the first ten apps (home.dock_size), then Settings, then More apps (which shows
  // everything). The order and the More apps line come from Arrange apps on the
  // phone, or from moving apps with the TV remote (hold OK), once one is saved.
  function arrangeItems() {
    var rest = shownApps().filter(function (a) { return a.package !== SETTINGS_PKG; });
    var screens = data.screens.map(function (sc) {
      return { kind: "screen", id: sc.id, name: sc.name, ready: sc.ready, note: sc.note, noteKey: sc.note_key, noteVars: sc.note_vars, package: "screen:" + sc.id };
    });
    var inputs = resolveInputs();
    var shown = rest.filter(function (a) { return !tucked(a); });
    var keep = Math.max(0, DOCK_APPS - inputs.length);   // pinned inputs take dock places, so they are never pushed behind More apps
    var items = shown.slice(0, keep).concat(inputs, shown.slice(keep), screens, rest.filter(tucked));
    var line = Math.min(DOCK_APPS, shown.length + inputs.length);
    var o = data.order;
    if (o && o.saved) {
      var at = {};
      o.packages.forEach(function (p, i) { at[p] = i; });
      var known = items.filter(function (it) { return at[it.package] !== undefined; })
        .sort(function (a, b) { return at[a.package] - at[b.package]; });
      var gained = items.filter(function (it) { return at[it.package] === undefined; });   // new apps go below the line
      items = known.concat(gained);
      // the line counts the apps above it that this TV still has
      var above = o.packages.slice(0, o.line).filter(function (p) { return known.some(function (it) { return it.package === p; }); }).length;
      line = Math.min(DOCK_APPS, above);
    }
    return { items: items, line: line };
  }

  function dockList() {
    var arr = arrangeItems();
    var list = expanded ? arr.items.slice() : arr.items.slice(0, arr.line);
    // a design's own dock: its apps in its order, without the ones it hides (design.js)
    if (!expanded && typeof CouchDesign !== "undefined" && CouchDesign.on()) list = CouchDesign.dock(arr.items, list, DOCK_APPS);
    var inTile = inputsTileItem();
    if (inTile) {
      if (!expanded && list.length >= DOCK_APPS) list = list.slice(0, DOCK_APPS - 1);   // it takes one place, like a pinned input
      list.unshift(inTile);
    }
    list = list.concat(toolItems());
    if (!expanded && !(STANDALONE && !data.apps.length)) list.push(moreItem());   // standalone: no app list behind it
    // apps a design put out on the screen come after Settings and More apps, so Right along the dock
    // reaches those two before it leaves the dock (design.js)
    if (!expanded && typeof CouchDesign !== "undefined" && CouchDesign.on() && CouchDesign.order) list = CouchDesign.order(list);
    return list;
  }

  // Tell the bridge which apps this TV has (in its default order), so the phone can arrange them.
  var reported = "";
  function reportApps() {
    if (!NIGHT || MOCK || PREVIEW || !data.apps.length) return;
    var saved = data.order;
    data.order = null;   // the default order, not the arranged one
    var arr = arrangeItems();
    data.order = saved;
    var payload = { apps: arr.items.map(function (it) { return { package: it.package, name: it.name }; }), line: arr.line };
    var key = JSON.stringify(payload);
    if (key === reported) return;
    api("POST", "/api/home-apps", payload).then(function () { reported = key; }, function () {});
  }

  // ---------------- moving apps with the TV remote ----------------
  // The arrangement as it is on screen, written down as a saved order, so it can be changed.
  function materialise() {
    var arr = arrangeItems();
    data.order = { saved: true, line: arr.line, packages: arr.items.map(function (it) { return it.package; }) };
    return arr;
  }
  // Saved through the bridge (the phone's Arrange apps reads the same order), or on this TV with no
  // bridge. A TV-only order is marked pending and handed to the bridge the next time it answers.
  function persistOrder() {
    var o = data.order;
    var local = { line: o.line, packages: o.packages, pending: true };
    keep("tvhome.order.tv", local);
    save();
    if (OFFLINE || data.bridge === false) return;
    api("POST", "/api/app-order", { order: o.packages, line: o.line })
      .then(function () { local.pending = false; keep("tvhome.order.tv", local); }, function () {});
  }
  function nameOf(pkg) {
    var it = arrangeItems().items.filter(function (x) { return x.package === pkg; })[0];
    return it ? it.name : t("that_app");
  }
  var hintTimer = null, hintFlash = "";
  function renderHint() {
    var text = hintFlash ||
      (lift ? t("app_lift_hint") : NIGHT && expanded && zone === "grid" ? t("app_add_hint") : "");
    $("hint").textContent = text;
    $("hint").classList.toggle("on", !!text);
    document.documentElement.classList.toggle("hinting", !!text);
  }
  function flash(text) {
    clearTimeout(hintTimer);
    hintFlash = text;
    renderHint();
    hintTimer = setTimeout(function () { hintFlash = ""; renderHint(); }, 4000);
  }
  // Holding OK on a dock app opens a small menu (Move, Hide, Uninstall, App info). "Move" is the
  // old pick-up-to-reorder behaviour, now in startMove(). Gear/smart/screen tiles stay put.
  function holdApp() {
    var a = gridItems[g];
    if (!a || a.kind === "more") return false;
    if (a.kind === "gear" || a.kind === "inputs" || a.kind === "smart" || a.kind === "devmode" || a.kind === "screen") { flash(t("stays_put", { name: a.name })); return true; }
    if (a.kind !== "app") return startMove();
    openAppMenu(a);
    return true;
  }

  // ---------------- hold-OK app menu ----------------
  var amI = 0, amItems = [], amApp = null;
  function openAppMenu(a) {
    amApp = a; amI = 0;
    amItems = [{ act: "move", label: t("ctx_move") }, { act: "hide", label: t("ctx_hide") }];
    // Restart and Quit sit above Uninstall. They need the computer's bridge: it force stops the app over ADB.
    // The TV's own call for it only asks Android, which ignores it for most apps (tried on an Android 11
    // projector), so with no bridge the items are left out rather than offered and doing nothing.
    if (bridgeCanStop(a)) amItems.push({ act: "restart", label: t("ctx_restart") }, { act: "quit", label: t("ctx_quit") });
    if (TV && TV.uninstall) amItems.push({ act: "uninstall", label: t("ctx_uninstall") });
    if (TV && TV.appInfo) amItems.push({ act: "info", label: t("ctx_info") });
    zone = "appmenu";
    renderAppMenu();
  }
  function renderAppMenu() {
    var pop = $("app-pop");
    pop.innerHTML = amItems.map(function (it, i) {
      return '<div class="grow' + (i === amI ? " focus" : "") + '" role="menuitem"><span><b>' + esc(it.label) + "</b></span></div>";
    }).join("");
    pop.classList.add("on");
    document.documentElement.classList.add("apping");
    hintFlash = t("ctx_hint"); renderHint();
    var el = gridEls[g], rem = innerWidth / 120;
    if (el) {
      var b = el.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(5 * rem, Math.min(innerWidth - w - 5 * rem, b.left + b.width / 2 - w / 2)) + "px";
      pop.style.top = Math.max(3.75 * rem, b.top - pop.offsetHeight - 2.25 * rem) + "px";
    }
  }
  function closeAppMenu() {
    $("app-pop").classList.remove("on");
    document.documentElement.classList.remove("apping");
    hintFlash = "";
    if (zone === "appmenu") zone = "grid";
  }
  // Quit app / Restart app: the bridge force stops the app (restart also opens it again on what was playing).
  // Restart says what it is doing at once, since it takes a few seconds; Quit says so when it is done.
  function bridgeCanStop(a) {
    // the on-TV app has no /api/quit-app or /api/restart-app, so it must not offer them (#308)
    return !OFFLINE && !PREVIEW && !ON_TV && a.package && a.package !== "app.couchtv.launcher" && data.bridge !== false;
  }
  function stopApp(a, path, body, doneKey, failKey, early) {
    if (early) flash(t(doneKey, { name: a.name }));
    api("POST", path, body, 30000).then(function () {
      if (!early) flash(t(doneKey, { name: a.name }));
    }).catch(function (e) {
      // /api/restart-app only knows the apps the bridge lists: quit any other one and open it again here
      if (early && e && e.key === "err_unknown_app" && TV && TV.launch) {
        api("POST", "/api/quit-app", { package: a.package }, 30000).then(function () {
          setTimeout(function () { try { tvLaunch(a.package); } catch (x) {} }, 600);
        }).catch(function (e2) { flash(t(failKey, { name: a.name }) + (e2 && e2.message ? ": " + e2.message : "")); });
        return;
      }
      flash(t(failKey, { name: a.name }) + (e && e.message ? ": " + e.message : ""));
    });
  }
  function doAppMenu() {
    var it = amItems[amI], a = amApp;
    closeAppMenu();
    if (!it || !a) { paintFocus(); return; }
    if (it.act === "move") { startMove(); return; }
    if (it.act === "hide") {
      materialise();
      var o = data.order, i = o.packages.indexOf(a.package);
      if (i >= 0) { if (i < o.line) o.line -= 1; o.packages.splice(i, 1); }
      setHidden(HIDDEN_TV.concat([a.package]));
      persistOrder();
      renderGrid();
      g = Math.max(0, Math.min(g, gridEls.length - 1));
      paintFocus();
      flash(t("ctx_hidden"));
      return;
    }
    if (it.act === "quit") { stopApp(a, "/api/quit-app", { package: a.package }, "ctx_quit_done", "ctx_quit_failed"); paintFocus(); return; }
    if (it.act === "restart") { stopApp(a, "/api/restart-app", { app: a.package }, "ctx_restarting", "ctx_restart_failed", true); paintFocus(); return; }
    if (it.act === "uninstall") { try { TV.uninstall(a.package); } catch (e) {} paintFocus(); return; }
    if (it.act === "info") { try { TV.appInfo(a.package); } catch (e) {} paintFocus(); return; }
    paintFocus();
  }

  // ---------------- hold-OK shelf menu (Watch Next dismissal) ----------------
  var smI = 0, smItems = [], smShow = null;
  function openShelfMenu() {
    var it = data.shows[s];
    if (!it) return false;
    smShow = it; smI = 0;
    smItems = [
      { act: "dismiss", label: t("ctx_remove_shelf") || "Remove from Keep watching" },
      { act: "cancel", label: t("cancel") || "Cancel" }
    ];
    zone = "shelfmenu";
    renderShelfMenu();
    return true;
  }
  function renderShelfMenu() {
    var pop = $("app-pop");
    pop.innerHTML = smItems.map(function (it, i) {
      return '<div class="grow' + (i === smI ? " focus" : "") + '" role="menuitem"><span><b>' + esc(it.label) + "</b></span></div>";
    }).join("");
    pop.classList.add("on");
    document.documentElement.classList.add("shelfmenu");
    var el = shelfEls[s], rem = innerWidth / 120;
    if (el) {
      var b = el.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(5 * rem, Math.min(innerWidth - w - 5 * rem, b.left + b.width / 2 - w / 2)) + "px";
      pop.style.top = Math.max(3.75 * rem, b.top - pop.offsetHeight - 2.25 * rem) + "px";
    }
  }
  function closeShelfMenu() {
    $("app-pop").classList.remove("on");
    document.documentElement.classList.remove("shelfmenu");
    if (zone === "shelfmenu") zone = "shelf";
  }
  function doShelfMenu() {
    var it = smItems[smI], show = smShow;
    closeShelfMenu();
    if (!it || !show || it.act === "cancel") { paintFocus(); return; }
    if (it.act === "dismiss") {
      dismissShow(show);
    }
  }
  function dismissShow(it) {
    var id = String(it.id || "");
    var pkg = (it.app && it.app.package) || it.package || "";
    var title = it.title || "";
    try {
      if (TV && TV.dismissWatchNext) TV.dismissWatchNext(id, pkg, title);
    } catch (e) {}
    if (!OFFLINE && data.bridge !== false && (it.source === "bridge" || it.source === "plex")) api("POST", "/api/continue/hide", { id: id, who: NOBODY ? "both" : who }).catch(function () {});   // the phone's list too

    var dismissed = kept("tvhome.dismissed_shows") || [];
    var sig = pkg + "|" + title;
    if (id && dismissed.indexOf(id) < 0) dismissed.push(id);
    if (sig && dismissed.indexOf(sig) < 0) dismissed.push(sig);
    keep("tvhome.dismissed_shows", dismissed);

    var card = shelfEls[s];
    var finishRemoval = function () {
      var keepIt = function (showItem) {
        var sId = String(showItem.id || "");
        var sSig = pkgOf(showItem) + "|" + (showItem.title || "");
        return sId !== id && sSig !== sig;
      };
      PEOPLE.forEach(function (p) {
        if (data.showsBy[p.id]) data.showsBy[p.id] = data.showsBy[p.id].filter(keepIt);
        if (data.videosBy[p.id]) data.videosBy[p.id] = data.videosBy[p.id].filter(keepIt);
      });
      renderShelf();
      if (!shelfEls.length) {
        $("shelf-section").classList.add("empty");
        zone = "grid";
        g = 0;
      } else {
        s = Math.max(0, Math.min(s, shelfEls.length - 1));
        zone = "shelf";
      }
      paintFocus();
      status(t("removed") || "Removed");
    };

    if (card) {
      card.classList.add("collapsing");
      setTimeout(finishRemoval, 200);
    } else {
      finishRemoval();
    }
  }

  // Pick an app up to move it (the old hold-OK behaviour), reached from the menu's "Move".
  function startMove() {
    var a = gridItems[g];
    if (!a) return false;
    var arr = arrangeItems();
    var idx = arr.items.map(function (it) { return it.package; }).indexOf(a.package);
    if (idx < 0) return false;
    if (!expanded) {
      materialise();
      lift = { pkg: a.package };
      hintFlash = "";
      renderGrid(); paintFocus();
      return true;
    }
    if (idx < arr.line) { flash(t("already_home", { name: a.name })); return true; }
    // More apps: add it to the end of the dock; a full dock sends its last app behind More apps
    var o = materialise() && data.order, msg = t("now_home", { name: a.name });
    o.packages.splice(idx, 1);
    if (o.line < DOCK_APPS) { o.packages.splice(o.line, 0, a.package); o.line += 1; }
    else {
      o.packages.splice(o.line - 1, 0, a.package);
      msg += " " + t("moved_more", { name: nameOf(o.packages[o.line]) });
    }
    persistOrder();
    expanded = false;
    renderGrid();
    g = o.packages.indexOf(a.package);
    paintFocus();
    flash(msg);
    return true;
  }
  function moveLift(dx, dy) {
    var o = data.order, i = o.packages.indexOf(lift.pkg);
    if (dx) {
      var j = i + dx;
      if (j >= 0 && j < o.line) { o.packages[i] = o.packages[j]; o.packages[j] = lift.pkg; g = j; }
    } else if (dy > 0) {   // behind More apps: first in line there
      var name = nameOf(lift.pkg);
      o.packages.splice(i, 1);
      o.packages.splice(o.line - 1, 0, lift.pkg);
      o.line -= 1;
      lift = null;
      persistOrder();
      renderGrid();
      g = Math.min(i, gridEls.length - 1);
      flash(t("moved_more", { name: name }));
    }
    renderGrid();
    paintFocus();
  }
  function dropLift() {
    lift = null;
    persistOrder();
    renderGrid();
    paintFocus();
    flash(t("saved"));
  }

  // Apps installed since this TV first listed its apps: the end of the dock when there is room,
  // otherwise first behind More apps, with a New dot until opened once.
  function detectNew() {
    if (!data.apps.length) return;
    // The stores were never counted here before #169: leave them out so an update adds no New dot.
    var pk = data.apps.filter(function (a) { return a.package !== SETTINGS_PKG && a.package !== "com.android.vending" && a.package !== "com.amazon.venezia"; })
      .map(function (a) { return a.package; });
    var seen = kept("tvhome.apps.seen");
    if (!seen) { keep("tvhome.apps.seen", pk); return; }
    var fresh = pk.filter(function (p) { return seen.indexOf(p) < 0; });
    if (!fresh.length) return;
    keep("tvhome.apps.seen", seen.concat(fresh));
    newApps = newApps.concat(fresh.filter(function (p) { return newApps.indexOf(p) < 0; }));
    keep("tvhome.apps.new", newApps);
    if (!NIGHT) return;
    materialise();
    var o = data.order;
    fresh.forEach(function (p) {
      var app = data.apps.filter(function (a) { return a.package === p; })[0];
      var i = o.packages.indexOf(p);
      if (i < 0 || i < o.line || (app && tucked(app))) return;
      o.packages.splice(i, 1);
      o.packages.splice(o.line, 0, p);
      if (o.line < DOCK_APPS) o.line += 1;
    });
    persistOrder();
  }
  function opened(pkg) {
    if (!isNew(pkg)) return;
    newApps = newApps.filter(function (p) { return p !== pkg; });
    keep("tvhome.apps.new", newApps);
    renderGrid();
  }

  // An input tile: its own picture (home.inputs[].image, a file in the app such as
  // backgrounds/mine/console.svg), else the drawn icon for its kind. A picture that fails falls
  // back to the drawn icon.
  function inputFace(it) {
    var drawn = ICONS[it.icon] || ICONS.hdmi || ICONS.input;
    if (it.image) {
      return '<div class="face input-img"><img src="' + esc(it.image) + '" alt="" decoding="async" data-err="svg" data-svg="' + esc(drawn) + '"></div>';
    }
    return '<div class="face tool input-ic ic-' + esc(it.icon || "hdmi") + '">' + drawn + "</div>";
  }

  // g24 (icon packs, asked for by two people): the home's own tiles (Settings, More apps, Inputs,
  // Screens) drawn in one of couch-tv's icon sets (icon-sets.js), from home.icon_set or Home settings,
  // Look, Icon style. Your own app icons are tv-home/tools/app-icons.sh (since 0.13, docs/TV-HOME.md).
  var ICON_SETS = ["builtin", "line", "solid", "duotone", "tile", "glass", "playful"], ICON_SET = "builtin";
  var SET_CONCEPT = { gear: "settings", more: "apps", input: "input", screen: "tv" };
  function toolFace(name) {
    var T = window.TVIcons, svg = ICON_SET !== "builtin" && T && T.svg ? T.svg(ICON_SET, SET_CONCEPT[name], 0) : "";
    if (!svg) return '<div class="face tool">' + ICONS[name] + "</div>";
    var full = ICON_SET === "tile" || ICON_SET === "glass" || ICON_SET === "playful";
    return '<div class="face tool iset iset-' + ICON_SET + (full ? " iset-full" : "") + '">' + svg + "</div>";
  }

  function dockHTML(it) {
    var face;
    if (it.kind === "screen") face = toolFace("screen");
    else if (it.kind === "input") face = inputFace(it);
    else if (it.kind === "inputs") face = toolFace("input");
    else if (it.kind === "more") face = toolFace("more");
    else if (it.kind === "gear") face = toolFace("gear");
    else if (it.kind === "devmode") face = '<div class="face tool">' + ICONS.devmode + "</div>";
    else if (it.kind === "smart") face = '<div class="face tool">' + window.smartHome.icon + "</div>";
    else if (DOCK_BANNERS && it.banner) face = '<div class="face banner"><img src="' + esc(it.banner) + '" alt="" decoding="async" data-err="word" data-name="' + esc(it.name) + '"></div>';
    else if (iconUrl(it.package)) face = '<div class="face"><img src="' + esc(iconUrl(it.package)) + '" alt="" decoding="async" data-err="word" data-name="' + esc(it.name) + '"></div>';
    else face = '<div class="face word">' + esc(it.name) + "</div>";
    var cls = "tile app dock-ic" + (it.kind === "input" ? " input-ic ic-" + esc(it.icon || "hdmi") : "") + (lift && it.package === lift.pkg ? " lifted" : "");
    // the name sits in a span: with the Mac-style dock it is a small bubble above the icon (app.css)
    return '<div class="' + cls + '" data-pkg="' + esc(it.package || it.kind || "") + '">' + face + dotHTML(it) + '<div class="label"><span>' + esc(it.name) + "</span></div></div>";
  }

  // home.dock_banners: the dock shows one row of six; the rows under it sit below the screen and slide
  // up a row at a time as the focus moves down into them (Keep watching fades out meanwhile).
  function slideDock() {
    var apps = $("apps-section") || $("grid").parentNode, el = document.documentElement;
    if (LOOP) { loopPanel(); return; }   // no banners in the Loop look; More apps scrolls by rows instead
    if (!NIGHT) { classicScroll(apps, el); return; }
    var rows = DOCK_BANNERS && !expanded ? Math.ceil(gridEls.length / GRID_COLS) : 1;
    var row = rows > 1 && (zone === "grid" || zone === "gear" || zone === "appmenu") ? Math.floor(g / GRID_COLS) : 0;
    el.classList.toggle("dock-down", row > 0);
    if (rows <= 1) { apps.style.bottom = ""; apps.style.transform = ""; return; }
    apps.style.bottom = (2.875 - (rows - 1) * BANNER_ROW_REM) + "rem";
    apps.style.transform = "translateX(-50%) translateY(" + (-row * BANNER_ROW_REM) + "rem)";
  }

  // Classic and OLED: eight tiles to a row, and only the first rows fit under the clock. When More apps
  // lists more than that, the grid slides up by whole rows so the tile under the remote stays on the
  // screen (#203: with 15+ apps the focus went below the screen and nothing scrolled). The Keep watching
  // row and the header (clock, people, quick buttons) fade out while the grid is up, since it slides under them.
  function classicScroll(apps, el) {
    var shift = 0, step = 0;
    if (gridEls.length > GRID_COLS && (zone === "grid" || zone === "gear" || zone === "appmenu")) {
      step = gridEls[GRID_COLS].offsetTop - gridEls[0].offsetTop;   // a tile row and the gap under it
      var rem = innerWidth / 120, tileH = gridEls[0].offsetHeight;
      // the last row that fits: its tile, the name under it and a margin must end above the screen's edge
      var fit = step > 0 ? Math.max(1, Math.floor((innerHeight - 6 * rem - tileH - apps.offsetTop) / step) + 1) : 1;
      shift = Math.max(0, Math.floor(g / GRID_COLS) - (fit - 1)) * step;
    }
    el.classList.toggle("grid-scrolled", shift > 0);
    apps.style.transform = shift > 0 ? "translateY(-" + shift + "px)" : "";
  }

  // The Night dock tile's width in rem: a square icon, or a 16:9 TV banner as tall as the icon.
  function dockTileRem() { return DOCK_BANNERS ? 12.5 : 7; }

  function appHTML(it) {
    if (NIGHT) return dockHTML(it);
    var face;
    if (it.kind === "screen") face = toolFace("screen");
    else if (it.kind === "input") face = inputFace(it);
    else if (it.kind === "inputs") face = toolFace("input");
    else if (it.kind === "more") face = toolFace("more");
    else if (it.kind === "gear") face = toolFace("gear");
    else if (it.kind === "devmode") face = '<div class="face tool">' + ICONS.devmode + "</div>";
    else if (it.kind === "smart") face = '<div class="face tool">' + window.smartHome.icon + "</div>";
    else if (it.banner) face = '<div class="face"><img src="' + esc(it.banner) + '" alt="" decoding="async"></div>';
    else if (iconUrl(it.package)) face = '<div class="face icon" style="background:' + esc(it.colour || "#2a2a30") + '"><img src="' + esc(iconUrl(it.package)) + '" alt=""></div>';
    else face = '<div class="face word" style="background:' + esc(it.colour || "#2a2a30") + '">' + esc(it.name) + "</div>";
    var cls = "tile app" + (it.kind === "input" ? " input-ic ic-" + esc(it.icon || "hdmi") : "");
    return '<div class="' + cls + '">' + face + dotHTML(it) + '<div class="label">' + esc(it.name) + "</div></div>";
  }
  // The small blue dot: an app not opened yet, or (on the gear tile) a new couch-tv release.
  function dotHTML(it) {
    if (isNew(it.package)) return '<i class="dot" aria-label="' + esc(t("new_app")) + '"></i>';
    if (it.kind === "gear" && updReady()) return '<i class="dot" aria-label="' + esc(t("upd_gear", { v: UPD.latest, c: UPD.current || "" })) + '"></i>';
    return "";
  }

  // Put the tiles for these HTML strings in the grid, in order, keeping every tile that is already
  // there with the same HTML instead of making it again. Rebuilding them all made each icon go blank
  // and draw again whenever More apps opened or closed (an LG OLED65CX decodes every new <img> anew).
  // A kept tile gets back the classes it was made with (focus, pressed, off-window, end-row and the
  // like are put on again after this) and loses the dock's magnify transform (magnify sets it again).
  // Tiles taken out of the grid (More apps folded away) wait here, out of the page, for the next time
  // they are wanted, so opening More apps again does not make and draw their icons again.
  var tileCache = {}, tileCached = 0;
  function makeTile(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var made = tmp.firstChild;
    made._html = html; made._cls = made.className;
    return made;
  }
  function cachePut(el) {
    if (tileCached >= 300) { tileCache = {}; tileCached = 0; }   // apps came and went a lot: start again
    (tileCache[el._html] = tileCache[el._html] || []).push(el);
    tileCached++;
  }
  function cacheTake(html) {
    var a = tileCache[html];
    while (a && a.length) {
      var el = a.shift(); tileCached--;
      // an icon that failed while out of the page never reached the error handler (it listens on the
      // page), so it would stay a broken picture: make that tile again instead
      var im = el.querySelector("img");
      if (!(im && im.complete && !im.naturalWidth)) return el;
    }
    return null;
  }
  function placeTiles(grid, htmls) {
    var pool = {}, kids = grid.children, i, el;
    for (i = 0; i < kids.length; i++) {
      el = kids[i];
      if (el._html !== undefined) (pool[el._html] = pool[el._html] || []).push(el);
    }
    var els = htmls.map(function (html) {
      var old = (pool[html] && pool[html].shift()) || cacheTake(html);
      if (old) { old.className = old._cls; old.style.transform = ""; return old; }
      return makeTile(html);
    });
    // move only what is out of place, so tiles that stay put are not taken out of the page
    els.forEach(function (want, at) { if (kids[at] !== want) grid.insertBefore(want, kids[at] || null); });
    while (kids.length > els.length) {
      el = grid.removeChild(kids[kids.length - 1]);
      if (el._html !== undefined) cachePut(el);
    }
    return els;
  }
  // A little after the dock is drawn, make the tiles More apps will show and decode their icons, out
  // of the page, so even the first Down into More apps finds them ready.
  var warmTimer = 0;
  function warmMoreApps() {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(function () {
      if (expanded || lift || !gridItems.some(function (x) { return x.kind === "more"; })) return;
      var htmls;
      expanded = true;
      try { htmls = gridList().map(appHTML); } catch (e) { htmls = []; } finally { expanded = false; }
      var have = {}, kids = $("grid").children, i;
      for (i = 0; i < kids.length; i++) have[kids[i]._html] = (have[kids[i]._html] || 0) + 1;
      htmls.forEach(function (html) {
        if (have[html]) { have[html]--; return; }
        if (tileCache[html] && tileCache[html].length) return;
        var el = makeTile(html), im = el.querySelector("img");
        cachePut(el);
        if (im && im.decode) im.decode().then(null, function () {});
      });
    }, 2000);
  }

  function renderGrid() {
    document.documentElement.classList.toggle("expanded", expanded);
    document.documentElement.classList.toggle("lifting", !!lift);
    gridItems = gridList();
    // before anyone has pressed a key, a design's dock starts on its first app (or More apps), not Settings
    if (!touched && !expanded && zone === "grid" && g === 0 && typeof CouchDesign !== "undefined" && CouchDesign.on() && CouchDesign.startIndex) g = CouchDesign.startIndex(gridItems);
    if (NIGHT) {
      // the dock is as wide as what is in it; More apps uses all twelve columns
      // wide banner tiles: six to a row; the dock shows its first row and the rest wait below the screen
      GRID_COLS = DOCK_BANNERS ? Math.max(1, Math.min(BANNER_COLS, gridItems.length))
        : expanded ? 12 : Math.max(1, Math.min(12, gridItems.length));
      // a design's dock can be a column, a grid or a wrapped row: the remote follows its shape (design.js)
      if (!expanded && typeof CouchDesign !== "undefined" && CouchDesign.on()) GRID_COLS = CouchDesign.cols(GRID_COLS, gridItems.length);
      $("grid").style.gridTemplateColumns = "repeat(" + GRID_COLS + ", " + dockTileRem() + "rem)";
      if (NIGHT) {
        var gEl = $("grid"), sEl = $("shelf-section");
        if (gEl && sEl) {
          if ((SPOTIFY.card_style || "compact") !== "mini" && (SPOTIFY.align || "classic") === "center") {
            var gw = gEl.offsetWidth;
            if (gw > 0) sEl.style.width = gw + "px";
          } else {
            sEl.style.width = "";
          }
        }
      }
    }
    gridEls = placeTiles($("grid"), gridItems.map(appHTML));
    if (OLD_ENGINE) {
      if (NIGHT) $("grid").style.width = (GRID_COLS * dockTileRem() + (GRID_COLS - 1) * 1.625 + (LOOP ? 0 : 3.5)) + "rem";
      var lastRow = Math.floor((gridEls.length - 1) / GRID_COLS) * GRID_COLS;
      gridEls.forEach(function (el, i) {
        if (i % GRID_COLS === GRID_COLS - 1) el.classList.add("end-col");
        if (i >= lastRow) el.classList.add("end-row");
      });
    }
    clearIcons();
    renderHint();
    if (!expanded) warmMoreApps();
  }

  // Glass app icons, Apple's clear style (#25): each icon's glyph without its background
  // (clearicon.js), drawn light on the glass tile. The focused app shows its own icon. An icon that
  // will not split cleanly keeps the grey version (app.css).
  function clearIcons() {
    if (!GLASS_ICONS || !window.ClearIcon) return;
    Array.prototype.forEach.call($("grid").querySelectorAll(".app .face:not(.tool):not(.word) > img"), function (im) {
      var face = im.parentNode, src = im.getAttribute("src");
      if (!src || face.querySelector(".glyph")) return;
      window.ClearIcon.get(src, function (g) {
        if (!g || !face.parentNode || face.querySelector(".glyph")) return;
        var gi = document.createElement("img");
        gi.className = "glyph"; gi.alt = ""; gi.src = g;
        face.appendChild(gi);
        face.classList.add("clear");
      });
    });
  }

  // ---------------- focus ----------------
  function clearFocus() {
    shelfEls.concat(gridEls, quickEls).forEach(function (el) { if (el) el.classList.remove("focus"); });
    $("people").classList.remove("focus");
    if ($("football-scores")) $("football-scores").classList.remove("focus");
    Array.prototype.forEach.call($("people").children, function (el) { el.classList.remove("focus"); });
  }

  function scrollShelf() {
    var track = $("shelf");
    var el = shelfEls[s];
    if (!el) { track.style.transform = ""; return; }
    var step = el.offsetWidth + parseFloat(getComputedStyle(track).columnGap || 0);
    // how many cards fit: three glass cards on the Night look, about five posters on Classic
    var fit = Math.max(1, Math.floor((track.parentNode.clientWidth + step - el.offsetWidth) / step));
    // Night: the row moves on once focus goes past the last card in view; Classic keeps it centred
    var first = NIGHT ? s - fit + 1 : s - 2;
    first = Math.max(0, Math.min(first, shelfEls.length - fit));
    var rtl = document.documentElement.dir === "rtl";
    track.style.transform = "translateX(" + (rtl ? (first * step) : (-first * step)) + "px)";
  }

  function shelfOn() { return !$("shelf-section").classList.contains("empty"); }
  // the switcher shows for two or more people, also while nobody has anything yet (issue #23)
  function peopleOn() { return peopleCount() >= 2 && !designHides("people"); }
  function toPeople() { zone = "people"; pi = whoIndex(); }

  // ---------------- the Mac-style dock ----------------
  // The focused app and its neighbours grow in a wave, measured off a real Mac dock (a little smaller
  // for a TV): the focused one most, then 1, 2 and 3 apps away. The row slides so the dock stays
  // centred, the tray grows the same on both sides, and a dock too wide for the screen shrinks as a
  // whole, as a Mac's does, so the wave keeps its shape.
  var MAG = [1.55, 1.45, 1.25, 1.05];
  function magnify() {
    var root = document.documentElement, grid = $("grid");
    if (!grid) return;
    gridEls.forEach(function (el) { if (el) el.style.transform = ""; });
    var tray = function (d) {
      grid.style.paddingLeft = grid.style.paddingRight = d ? "calc(1.75rem + " + d.toFixed(1) + "px)" : "";
      grid.style.marginLeft = grid.style.marginRight = d ? (-d).toFixed(1) + "px" : "";   // the icons stay where they sit
    };
    tray(0);
    if (!DOCK_MAC || !NIGHT || root.classList.contains("expanded")) return;
    var fe = grid.querySelector(".app.focus, .app.lifted");
    if (!fe) return;
    var top = fe.offsetTop, row = gridEls.filter(function (el) { return el && el.offsetTop === top; });
    var fi = row.indexOf(fe), w = fe.offsetWidth;
    var sc = function (i) { var k = Math.abs(i - fi); return k < MAG.length ? MAG[k] : 1; };
    var ex = function (i) { return w * (sc(i) - 1); };
    var rtl = root.dir === "rtl";
    var before = ex(fi) / 2, after = ex(fi) / 2;   // how far the first and last icons reach past where they sit
    row.forEach(function (el, i) { if (i < fi) before += ex(i); else if (i > fi) after += ex(i); });
    var shift = (before - after) / 2;   // the whole row slides so the dock stays centred
    // measured from the icons, not the tray: the tray's own padding may still be on its way
    var first = row[0], last = row[row.length - 1];
    var pad = 1.75 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    var W = last.offsetLeft + last.offsetWidth - first.offsetLeft + 2 * pad;
    var f = Math.min(1, window.innerWidth * 0.97 / (W + before + after));
    var mid = (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2;
    row.forEach(function (el, i) {
      var x = 0;
      if (i !== fi) {
        var dir = i > fi ? 1 : -1;
        x = ex(fi) / 2;
        for (var j = fi + dir; j !== i; j += dir) x += ex(j);
        x = (x + ex(i) / 2) * dir;
      }
      x = (x + shift) * (rtl ? -1 : 1);
      var c = el.offsetLeft + el.offsetWidth / 2 - mid;   // where it sits, from the dock's middle
      x = f * (c + x) - c;
      el.style.transform = "translateX(" + x.toFixed(1) + "px) scale(" + (f * sc(i)).toFixed(3) + ")";
    });
    tray((f * (W + before + after) - W) / 2);
  }
  // OK on a dock app: pressed in while held, one hop as it opens (app.css)
  function pressTile(on) {
    Array.prototype.forEach.call($("grid").querySelectorAll(".app.pressed"), function (el) { el.classList.remove("pressed"); });
    if (on && DOCK_MAC && NIGHT && zone === "grid" && gridEls[g]) gridEls[g].classList.add("pressed");
  }
  function hopTile() {
    var el = DOCK_MAC && NIGHT && zone === "grid" && gridEls[g];
    if (!el || !el.classList.contains("app")) return;
    el.classList.remove("hop"); void el.offsetWidth; el.classList.add("hop");
    setTimeout(function () { el.classList.remove("hop"); }, 560);
  }

  function paintFocus() {
    if (DOCK_MAC) setTimeout(magnify, 0);   // after this paint has put the focus class where it belongs
    saveFocusSoon();
    followSync();   // the row follows the app tile the remote is on (home.shelf_follows_app)
    if (zone === "welcome") { renderWelcome(); return; }
    if (zone === "makeit") return;
    if (zone === "settings") { renderSettings(); return; }
    if (zone === "smart") { window.smartHome.paint(); return; }
    if (zone === "remind") { window.Reminders.paint(); return; }
    if (zone === "ambient") { renderAmbientMusic(); return; }
    clearFocus();
    renderHint();
    slideDock();
    if (npVisible()) renderNp();   // its buttons carry the focus only while zone is "np"
    if (zone === "gear") { if (gridEls[g]) gridEls[g].classList.add("focus"); renderGear(); return; }
    if (zone === "appmenu") { if (gridEls[g]) gridEls[g].classList.add("focus"); renderAppMenu(); return; }
    if (zone === "shelfmenu") { if (shelfEls[s]) shelfEls[s].classList.add("focus"); renderShelfMenu(); return; }
    if (zone === "updask") { renderAsk(); return; }
    if (zone === "menu") { renderMenu(); return; }
    if (zone === "inputs") {
      var from = inFrom === "grid" ? gridEls[g] : quickEls[qi];
      if (from) from.classList.add("focus");
      renderInputMenu(); return;
    }
    if (zone === "pmenu") { renderPop(); $("people").classList.add("focus"); return; }
    if (zone === "np") {
      if (!npReach()) { zone = shelfReach() ? "shelf" : "grid"; paintFocus(); return; }
      renderNp();
      hero(null);
      $("place").style.visibility = "";
      showPhoto();
      return;
    }
    if (zone === "football" && $("football-scores")) { $("football-scores").classList.add("focus"); return; }
    if (zone === "quick" && quickEls[qi]) {
      quickEls[qi].classList.add("focus");
      hero(null);
      $("place").style.visibility = "";
      showPhoto();
      return;
    }
    if (zone === "people" && peopleOn()) {
      if (isHead()) $("people").classList.add("focus");
      else if ($("people").children[pi]) $("people").children[pi].classList.add("focus");   // drawn yet
      hero(null);
      $("place").style.visibility = "";
      showPhoto();
      return;
    }
    if (zone === "shelf" && shelfEls[s]) {
      shelfEls[s].classList.add("focus");
      scrollShelf();
      if (NIGHT) return;   // the cards carry the titles; the photo stays put under the clock
      var cc = cardAt(s);
      if (cc) {   // a custom card: its title and line at the top, the photo stays (its picture may be small)
        hero({ title: cc.title, app: cc.subtitle ? { name: cc.subtitle } : null });
        $("place").style.visibility = "hidden";
        showPhoto();
        renderHint();
        return;
      }
      setBg(data.shows[s].backdrop || data.shows[s].poster, true);
      hero(data.shows[s]);
      $("place").style.visibility = "hidden";
    } else {
      zone = "grid";
      g = Math.max(0, Math.min(g, gridEls.length - 1));
      if (gridEls[g]) gridEls[g].classList.add("focus");
      hero(null);
      $("place").style.visibility = "";
      showPhoto();
    }
    renderHint();
  }

  function nearestInRow(row, x) {
    var best = row * GRID_COLS, bestD = Infinity;
    for (var i = row * GRID_COLS; i < Math.min(gridEls.length, (row + 1) * GRID_COLS); i++) {
      var b = gridEls[i].getBoundingClientRect();
      var d = Math.abs(b.left + b.width / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // which app a grid tile is, to find it again after the dock turns into the full apps view (#98)
  var dockBack = null;
  function gridKey(it) { return it ? it.kind + ":" + (it.package || it.id || it.name) : ""; }
  function move(dx, dy) {
    touched = true;
    if (document.documentElement.dir === "rtl") dx = -dx;
    if (zone === "settings") { setMove(dx, dy); return; }
    if (zone === "smart") { window.smartHome.move(dx, dy); return; }
    if (zone === "remind") { window.Reminders.move(dx, dy); return; }
    if (zone === "gear") { if (dy) { gi = Math.max(0, Math.min(gearItems().length - 1, gi + dy)); renderGear(); } return; }
    if (zone === "appmenu") { if (dy) { amI = Math.max(0, Math.min(amItems.length - 1, amI + dy)); renderAppMenu(); } return; }
    if (zone === "shelfmenu") { if (dy) { smI = Math.max(0, Math.min(smItems.length - 1, smI + dy)); renderShelfMenu(); } return; }
    if (zone === "updask") { if (dy) { ai = Math.max(0, Math.min(1, ai + dy)); renderAsk(); } return; }
    if (zone === "inputs") { if (dy) { inI = Math.max(0, Math.min(inItems.length - 1, inI + dy)); renderInputMenu(); } return; }
    if (lift) { moveLift(dx, dy); return; }
    if (zone === "ambient") {
      if (dx < 0) ambI = Math.max(0, ambI - 1);
      else if (dx > 0) ambI = Math.min(3, ambI + 1);
      else if (dy > 0 || dy < 0) {
        ambientDismissed = true;
        ambientOpen = false;
        zone = "grid";
        paintFocus();
        renderAmbientMusic();
        return;
      }
      renderAmbientControls();
      return;
    }
    // Night with More apps open: the cards step aside, so up and down skip them
    var cards = (NIGHT && expanded) || designHides("keep_watching") ? [] : shelfEls;
    if (zone === "football") {
      if (dx < 0 && npReach()) { zone = "np"; npI = Math.max(0, npButtons().length - 1); }
      else if (dx > 0 && cards.length) { zone = "shelf"; s = 0; }
      else if (dy > 0 && gridEls.length) { var fb = $("football-scores").getBoundingClientRect(); g = nearestInRow(0, fb.left + fb.width / 2); zone = "grid"; }
      else if (dy < 0 && npReach()) zone = "np";
      paintFocus(); return;
    }
    if (zone === "menu") {
      if (dx || dy) menuI = Math.max(0, Math.min(SLEEP_CHOICES.length - 1, menuI + (dy || dx)));
      paintFocus();
      return;
    }
    if (zone === "pmenu") {
      if (dy) {
        var n = Math.max(0, Math.min(PEOPLE.length - 1, pmi + dy));
        if (plift && n !== pmi) { var tmp = PEOPLE[pmi]; PEOPLE[pmi] = PEOPLE[n]; PEOPLE[n] = tmp; }
        pmi = n;
        renderPop();
      }
      return;
    }
    if (zone === "np") {
      var isMini = NIGHT && SPOTIFY.card_style === "mini";
      var hasBar = !!(music && music.isSpotify && music.duration > 0 && SPOTIFY.scrub_bar !== false && $("np-prog-wrap"));
      var maxNp = Math.max(0, (currentNpBtns.length || npButtons().length) - 1);
      var pCount = music && music.isSpotify ? Math.min(npPrimaryCount || (maxNp + 1), maxNp + 1) : (maxNp + 1);
      var hasExtra = music && music.isSpotify && (maxNp + 1 > pCount);
      var inExtra = npSub === "btns" && hasExtra && npI >= pCount;

      if (music && music.isSpotify && npSub === "bar") {
        if (dx) {
          var stepMs = (SPOTIFY.seek_seconds || 10) * 1000;
          npScrubPos = Math.max(0, Math.min(music.duration || 0, npScrubPos + dx * stepMs));
          var pct = music.duration ? Math.min(100, Math.max(0, (npScrubPos / music.duration) * 100)) : 0;
          var posEl = $("np-pos"), fillEl = $("np-fill"), tipEl = $("np-scrub-tip");
          if (posEl) posEl.textContent = fmtTime(npScrubPos);
          if (fillEl) fillEl.style.width = pct + "%";
          if (tipEl) { tipEl.style.left = pct + "%"; tipEl.textContent = fmtTime(npScrubPos); }
          return;
        }
        if (dy < 0) {
          npSub = "btns";
          if (isMini) {
            if (peopleOn()) toPeople(); else if (hasQuick()) { zone = "quick"; qi = 0; }
          } else {
            npI = hasExtra ? pCount : 0;
          }
          paintFocus();
          return;
        }
        if (dy > 0) {
          npSub = "btns";
          if (isMini) {
            npI = Math.min(npI, pCount - 1);
            paintFocus();
            return;
          }
          // Compact: Down from bar exits to grid
          if (gridEls.length) {
            var npBox = $("np").getBoundingClientRect();
            g = nearestInRow(0, npBox.left + npBox.width / 2);
            zone = "grid";
          }
          paintFocus();
          return;
        }
      }

      if (LOOP) {
        if (dx > 0 && npI === maxNp) { if (hasQuick()) { zone = "quick"; qi = 0; } }
        else if (dx) npI = Math.max(0, Math.min(maxNp, npI + dx));
        else if (dy < 0) { if (peopleOn()) toPeople(); }
        else if (dy > 0) {
          if (cards.length) zone = "shelf";
          else if (gridEls.length) {
            var lb = $("np").getBoundingClientRect();
            g = nearestInRow(0, lb.left + lb.width / 2);
            zone = "grid";
          }
        }
      } else if (NIGHT) {
        if (dx) {
          var rowMin = inExtra ? pCount : 0;
          var rowMax = inExtra ? maxNp : (pCount - 1);
          if (dx > 0 && npI === rowMax) {
            if (footballEnabled && !LOOP) zone = "football";
            else if (cards.length) { zone = "shelf"; s = 0; }
          } else {
            npI = Math.max(rowMin, Math.min(rowMax, npI + dx));
          }
        } else if (dy < 0) {
          if (inExtra) {
            npI = Math.min(pCount - 1, Math.max(0, npI - pCount));
          } else if (isMini && hasBar) {
            npSub = "bar";
            npScrubPos = getPlaybackPosition();
          } else {
            if (peopleOn()) toPeople();
            else if (hasQuick()) { zone = "quick"; qi = 0; }
          }
        } else if (dy > 0) {
          if (!inExtra && hasExtra) {
            npI = Math.min(maxNp, pCount + Math.min(npI, maxNp - pCount));
          } else if (!isMini && hasBar) {
            npSub = "bar";
            npScrubPos = getPlaybackPosition();
          } else if (gridEls.length) {
            var btns = $("np") ? $("np").querySelectorAll(".nb") : [];
            var bEl = btns[npI];
            var midX = bEl ? (bEl.getBoundingClientRect().left + bEl.getBoundingClientRect().width / 2) : ($("np").getBoundingClientRect().left + $("np").getBoundingClientRect().width / 2);
            g = nearestInRow(0, midX);
            zone = "grid";
          }
        }
      } else {
        // Classic: top right, under the quick buttons
        if (dx) npI = Math.max(0, Math.min(maxNp, npI + dx));
        else if (dy < 0) { if (hasQuick()) zone = "quick"; else if (peopleOn()) toPeople(); }
        else if (dy > 0) {
          if (cards.length) zone = "shelf";
          else { zone = "grid"; g = Math.min(g, gridEls.length - 1); }
        }
      }
      paintFocus();
      return;
    }
    if (zone === "quick") {
      var nq = quickVisible().length;
      // Loop: Now playing is the stop before the first button (Left from the sleep button)
      if (dx < 0 && qi === 0) { if (LOOP && npReach()) { zone = "np"; npI = Math.max(0, npButtons().length - 1); } else if (peopleOn()) toPeople(); }
      else if (dx) qi = Math.max(0, Math.min(nq - 1, qi + dx));
      else if (dy > 0) {
        if (!NIGHT && npReach()) zone = "np";
        else if (peopleOn()) toPeople();
        else if (cards.length) zone = "shelf";
        else { zone = "grid"; g = Math.min(GRID_COLS, gridEls.length) - 1; }
      }
      paintFocus();
      return;
    }
    if (zone === "people") {
      if (dx > 0 && (isHead() || pi === PEOPLE.length - 1)) { if (hasQuick()) { zone = "quick"; qi = 0; } else if (!NIGHT && npReach()) zone = "np"; }
      else if (dx && !isHead()) {
        // moving across the names only moves the outline; OK picks (you have to click to select), so passing a name on the way to Sleep timer changes nothing
        pi = Math.max(0, Math.min(PEOPLE.length - 1, pi + dx));
      } else if (dy > 0) zone = NIGHT && npReach() ? "np" : cards.length ? "shelf" : "grid";
    } else if (zone === "shelf") {
      if (dx < 0 && s === 0 && footballEnabled && NIGHT && !LOOP) zone = "football";
      else if (dx < 0 && s === 0 && NIGHT && !LOOP && npReach() && !LOCAL_SPOTIFY) {   // the TV's Spotify row: Now playing is above, not beside
        zone = "np";
        npI = Math.max(0, (currentNpBtns.length || npButtons().length) - 1);
      }
      else if (dx < 0 && s === 0 && !expanded && GRID_COLS === 1 && gridEls.length > 1) { zone = "grid"; g = 0; }
      else if (dx) s = Math.max(0, Math.min(shelfEls.length - 1, s + dx));
      // Loop: Now playing sits straight above the row, under the people
      else if (dy < 0) { if ((LOOP || LOCAL_SPOTIFY) && npReach()) zone = "np"; else if (peopleOn()) toPeople(); else if (!NIGHT && npReach()) zone = "np"; else if (hasQuick()) { zone = "quick"; qi = 0; } }
      else if (dy > 0 && gridEls.length) {
        // land on the app under the show
        var b = shelfEls[s].getBoundingClientRect();
        g = nearestInRow(0, b.left + b.width / 2);
        zone = "grid";
      }
    } else {
      var row = Math.floor(g / GRID_COLS), lastRow = Math.floor((gridEls.length - 1) / GRID_COLS);
      if (dx && !expanded && GRID_COLS === 1 && gridEls.length > 1) {
        if (cards.length) zone = "shelf";
        else if (peopleOn()) toPeople();
        else if (hasQuick()) { zone = "quick"; qi = 0; }
      } else if (dx && gridEls.length) {
        var n = gridEls.length;
        if (expanded) g = (g + dx + n) % n;
        else {
          var first = row * GRID_COLS, last = Math.min(n, first + GRID_COLS) - 1;
          var nx = g + dx;
          g = nx > last ? first : nx < first ? last : nx;
        }
      } else if (dy < 0 && row === 0 && expanded) {
        var was = gridItems[g] ? gridKey(gridItems[g]) : null, from = dockBack;
        expanded = false; dockBack = null; renderGrid();
        var pick = function (key) { var at = -1; if (key) gridItems.forEach(function (x, i) { if (at < 0 && gridKey(x) === key) at = i; }); return at; };
        var at = pick(was);
        if (at < 0) at = pick(from);
        if (at < 0) gridItems.forEach(function (x, i) { if (at < 0 && x.kind === "more") at = i; });
        zone = "grid"; g = Math.max(0, at);
      } else if (dy < 0 && row === 0) {
        // the Night look with shows in the row: Up from a tile under the Now playing card goes to its nearest
        // button, else to the nearest card. Not in the Loop look (a line at the top left), with the football
        // scores beside it, or the TV's Spotify row; with no shows, Up opens the full screen view as before.
        if (NIGHT && !LOOP && !footballEnabled && !LOCAL_SPOTIFY && cards.length && npReach()) {
          var nb = $("np") ? $("np").getBoundingClientRect() : null;
          var curTile = gridEls[g] ? gridEls[g].getBoundingClientRect() : null;
          var midTile = curTile ? (curTile.left + curTile.width / 2) : 0;
          if (!cards.length || !nb || midTile <= nb.right + 20) {
            zone = "np";
            var btns = $("np") ? $("np").querySelectorAll(".nb") : [];
            var bestI = 0, bestD = Infinity;
            for (var bi = 0; bi < btns.length; bi++) {
              var br = btns[bi].getBoundingClientRect();
              var d = Math.abs(midTile - (br.left + br.width / 2));
              if (d < bestD) { bestD = d; bestI = bi; }
            }
            npI = bestI;
          } else {
            zone = "shelf";
            var bestS = 0, bestSD = Infinity;
            for (var si = 0; si < shelfEls.length; si++) {
              var sr = shelfEls[si].getBoundingClientRect();
              var sd = Math.abs(midTile - (sr.left + sr.width / 2));
              if (sd < bestSD) { bestSD = sd; bestS = si; }
            }
            s = bestS;
          }
        } else if (footballEnabled && NIGHT && !LOOP && npReach() && gridEls[g] && gridEls[g].getBoundingClientRect().left < $("np").getBoundingClientRect().right) zone = "np";
        else if (footballEnabled && NIGHT && !LOOP && (!cards.length || (gridEls[g] && gridEls[g].getBoundingClientRect().left < $("football-scores").getBoundingClientRect().right))) zone = "football";
        else if (cards.length) zone = "shelf";
        else if (npReach()) {
          if (AMBIENT_MUSIC && music) {
            ambientOpen = true;
            ambientDismissed = false;
            zone = "ambient";
            ambI = 1;
            renderAmbientMusic();
            paintFocus();
            return;
          }
          zone = "np";
        }
        else if (peopleOn()) toPeople();
        else if (hasQuick()) zone = "quick";
      } else if (dy < 0) {
        g -= GRID_COLS;
      } else if (row < lastRow) {
        g = Math.min(g + GRID_COLS, gridEls.length - 1);
      }
      // Down from the bottom row of the dock does nothing: it used to open More apps (#98), which a
      // beginner met by surprise, three times in one test (launch audit 0.13.9, 22 Nov 2026). More apps
      // is the tile at the end of the dock.
    }
    paintFocus();
  }

  // ---------------- going round at the ends ----------------
  // A single press of an arrow at the end of a row or a list goes round to the other end: left on the
  // first app lands on More apps, down on the last row of a Home settings list lands on its first row.
  // It happens when the key is let go, and only for a press that did one thing: holding an arrow still
  // runs to the end and stops there, even when it starts at the end. Some remotes send a held arrow
  // as more key downs that are not marked as repeats, so every key down of the same arrow before it
  // is let go counts as the same press (arrowPress), and a press longer than HOLD_MS never goes round.
  var wrapPending = null, arrowPress = null;
  // is this key down the arrow of the press still going (held), rather than a new press?
  function arrowAgain(p, dir, now, repeat) { return !!(repeat || (p && p.dir === dir && now - p.last < 1000)); }
  function navState() {
    return [zone, g, s, pi, qi, npI, menuI, pmi, gi, amI, smI, ai, inI, ambI, expanded, !!lift, plift,
      SET.col, SET.sec, SET.ri, !!SET.lift, !!SET.sub, SET.peeks || 0].join("|");   // peeks: a scroll with no row to move to is a move, not an end
  }
  // where a list of n entries goes round to: forwards to the first, backwards to the last
  function wrapIndex(n, d) { return d > 0 ? 0 : Math.max(0, n - 1); }
  function wrapRound(dx, dy) {
    if (document.documentElement.dir === "rtl") dx = -dx;
    if (lift || plift || SET.lift) return;   // carrying something: the ends stay the ends
    if (zone === "smart" || zone === "ambient") return;   // they keep their own focus
    var d = dy || dx;
    if (zone === "settings") {
      if (!dy) return;   // left and right change a value or the column
      if (SET.col === "secs") {
        var n = wrapIndex(secsNow().length, dy);
        if (n !== SET.sec) { SET.sec = n; SET.sub = null; SET.msg = ""; SET.keyFocus = null; SET.ri = 0; }
      } else {
        var rows = rowsNow(), r = stepRow(rows, dy > 0 ? -1 : rows.length, dy);
        if (r >= 0 && r < rows.length) { SET.ri = r; SET.keyFocus = rows[r].key; }
      }
      renderSettings();
      return;
    }
    if (zone === "gear") { if (dy) { gi = wrapIndex(gearItems().length, dy); renderGear(); } return; }
    if (zone === "appmenu") { if (dy) { amI = wrapIndex(amItems.length, dy); renderAppMenu(); } return; }
    if (zone === "shelfmenu") { if (dy) { smI = wrapIndex(smItems.length, dy); renderShelfMenu(); } return; }
    if (zone === "updask") { if (dy) { ai = wrapIndex(2, dy); renderAsk(); } return; }
    if (zone === "inputs") { if (dy) { inI = wrapIndex(inItems.length, dy); renderInputMenu(); } return; }
    if (zone === "pmenu") { if (dy) { pmi = wrapIndex(PEOPLE.length, dy); renderPop(); } return; }
    if (zone === "menu") { menuI = wrapIndex(SLEEP_CHOICES.length, d); paintFocus(); return; }
    if (zone === "grid") {
      if (dx) {   // along the row: the first app and the last tile (More apps) meet
        var first = Math.floor(g / GRID_COLS) * GRID_COLS;
        g = dx > 0 ? first : Math.min(first + GRID_COLS, gridEls.length) - 1;
      } else if (dy > 0 && !expanded) {
        return;   // Down on the dock does nothing (launch audit 0.13.9): it neither opens More apps nor jumps to the top
      } else if (dy > 0) {   // down from the very bottom of More apps: back to the top of the home
        if (peopleOn()) toPeople();
        else if (hasQuick()) { zone = "quick"; qi = 0; }
        else if (shelfReach() && !(NIGHT && expanded)) { zone = "shelf"; s = 0; }
        else g = g % GRID_COLS;
      }
    } else if (zone === "shelf") {
      if (dx) s = wrapIndex(shelfEls.length, dx);
      else if (dy < 0 && gridEls.length) { zone = "grid"; g = 0; }   // nothing above the cards: round to the apps
    } else if (zone === "people" || zone === "quick" || zone === "np") {
      if (dy < 0 && gridEls.length) { zone = "grid"; g = 0; }      // up from the very top: round to the apps
    }
    paintFocus();
  }

  // Start on the chosen place (home.start_focus): people (default, as before), keep_watching or apps (#211).
  function startFocus() {
    s = 0; g = 0;
    if (ambientOpen && AMBIENT_MUSIC && npVisible()) {
      zone = "ambient";   // the music screen is up: the remote stays on it
    } else if (START_FOCUS === "apps") {
      zone = "grid";
    } else if (START_FOCUS === "people") {
      if (peopleOn()) toPeople();
      else zone = shelfReach() ? "shelf" : "grid";
    } else {
      zone = shelfReach() ? "shelf" : "grid";
    }
    // a design whose dock starts with Settings (it hides the dock, say): start on the first app, or
    // More apps, never Settings (design.js)
    // a design always starts on its first app (or More apps), on every load: not People, not Settings
    if (zone !== "ambient" && typeof CouchDesign !== "undefined" && CouchDesign.on() && CouchDesign.startIndex && gridItems) { zone = "grid"; g = CouchDesign.startIndex(gridItems); }
  }

  // Remember the focused row and tile (#166, thanks IshMehta), so a home that Android dropped while
  // TV Settings or an app was in front (low memory on a 1.8 GB TV) opens on the tile you left. The
  // Home key still goes to the first tile: tv.home() forgets it.
  var FOCUS_KEY = "tvhome.focus", FOCUS_MAX_AGE = 20 * 60 * 1000, focusSaveTimer = 0, focusRestored = false;
  function pickFocus(saved, now, shelfCount, gridKeys) {
    if (!saved || typeof saved !== "object") return null;
    if (typeof saved.t !== "number" || now - saved.t < 0 || now - saved.t > FOCUS_MAX_AGE) return null;
    if (saved.zone === "shelf") {
      if (!(saved.s >= 0) || saved.s >= shelfCount) return null;
      return { zone: "shelf", s: saved.s, g: 0 };
    }
    if (saved.zone === "grid") {
      if (!gridKeys.length) return null;
      var i = saved.key ? gridKeys.indexOf(saved.key) : -1;
      if (i < 0) i = Math.max(0, Math.min(saved.g | 0, gridKeys.length - 1));
      return { zone: "grid", s: 0, g: i };
    }
    return null;
  }
  function saveFocusNow() {
    clearTimeout(focusSaveTimer); focusSaveTimer = 0;
    if (!focusRestored && !touched) return;   // a page not drawn yet must not overwrite what it is about to restore
    if (zone !== "shelf" && zone !== "grid") return;   // menus and settings are not worth coming back to
    // a card's place in the row only means something with the same row: "pkg" is the app the row was
    // following (home.shelf_follows_app), "" for the whole row
    try { localStorage.setItem(FOCUS_KEY, JSON.stringify({ t: Date.now(), zone: zone, s: s, g: g, key: zone === "grid" ? gridKey(gridItems[g]) : "", pkg: zone === "shelf" && followPkg ? followPkg : "" })); } catch (e) {}
  }
  function saveFocusSoon() { if (!focusSaveTimer) focusSaveTimer = setTimeout(saveFocusNow, 500); }
  function forgetFocus() { clearTimeout(focusSaveTimer); focusSaveTimer = 0; try { localStorage.removeItem(FOCUS_KEY); } catch (e) {} }
  // First draw of a fresh page only: true when the last focus was put back.
  function restoreFocus() {
    if (focusRestored) return false;
    focusRestored = true;
    // a design starts on its first app every time, it does not resume the last tile (Settings included)
    if (typeof CouchDesign !== "undefined" && CouchDesign.on()) return false;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); } catch (e) {}
    // the remote was left in a "Recently on <app>" row: draw that row again before the card is looked up,
    // so the outline lands on the card it left and not on the same place in the whole row
    var pkg = saved && typeof saved === "object" && saved.zone === "shelf" && typeof saved.pkg === "string" ? saved.pkg : "";
    if (pkg && !SHELF_FOLLOW) return false;   // the setting went off since: that place means nothing now
    var wholeRow = function () { followPkg = null; renderShelf(); return false; };   // as a fresh start has it
    if (pkg) {
      followPkg = pkg; renderShelf();
      if (!followName()) return wholeRow();   // that app has nothing on the go any more
    }
    var f = pickFocus(saved, Date.now(), shelfReach() ? shelfEls.length : 0, gridItems.map(gridKey));
    if (!f) return pkg ? wholeRow() : false;
    zone = f.zone; s = f.s; g = f.g;
    return true;
  }

  function goHome() {
    if (zone === "welcome") { welcomeChoose(1); return; }   // Back on the first-run welcome: Couch Original
    if (zone === "makeit") { makeitClose(); return; }       // Back on Make it yours: closed for good
    if (screenOffActive) {
      toggleScreenOff(false);
      return;
    }
    if (kidsOn()) { window.KidsMode.home(); return; }
    if (zone === "ambient") {
      ambientDismissed = true;
      ambientOpen = false;
      zone = "grid";
      paintFocus();
      renderAmbientMusic();
      return;
    }
    if (zone === "settings") { setBack(); return; }
    if (zone === "smart") { closeSmart(); paintFocus(); return; }
    if (zone === "remind") { window.Reminders.back(); return; }
    if (zone === "gear") { closeGear(); paintFocus(); return; }
    if (zone === "appmenu") { closeAppMenu(); paintFocus(); return; }
    if (zone === "shelfmenu") { closeShelfMenu(); paintFocus(); return; }
    if (zone === "updask") { answerAsk(false); return; }   // BACK counts as "I'll check myself"
    if (lift) { dropLift(); return; }   // BACK puts a picked-up app down where it is
    if (zone === "pmenu") { if (plift) dropPeople(); else closePop(); paintFocus(); return; }
    if (zone === "menu") { closeMenu(); paintFocus(); return; }   // BACK just closes the sleep choices
    if (zone === "inputs") { closeInputMenu(); paintFocus(); return; }
    if (zone === "np" && npSub === "bar") { npSub = "btns"; paintFocus(); return; }
    if (expanded) {
      expanded = false; renderGrid();
      if (dockBack) {   // opened from the More apps tile: Back lands on that tile in the dock again
        var back = -1;
        gridItems.forEach(function (x, i) { if (back < 0 && gridKey(x) === dockBack) back = i; });
        dockBack = null;
        if (back >= 0) { zone = "grid"; g = back; paintFocus(); return; }
      }
    }
    dockBack = null;
    startFocus();
    paintFocus();
  }

  // ---------------- actions ----------------
  // A long press of OK (or the Menu key): pick up an app or a name to move it. Returns false when
  // there is nothing to pick up here, and then the press counts as a normal OK.
  function hold() {
    touched = true;
    if (zone === "settings") return setHold();
    if (zone === "gear" || zone === "smart" || zone === "remind" || zone === "updask" || zone === "inputs" || zone === "shelfmenu") return false;
    if (lift) { dropLift(); return true; }
    if (zone === "pmenu") {
      if (plift) dropPeople();
      else if (PEOPLE.length > 1) { plift = true; renderPop(); }
      return true;
    }
    if (zone === "shelf") return openShelfMenu();
    if (zone === "np") { jumpIntoMusicApp(); return true; }
    if (zone === "grid" && NIGHT) return holdApp();
    return false;
  }

  function activate() {
    touched = true;
    if (zone === "settings") { setActivate(); return; }
    if (zone === "smart") { window.smartHome.ok(); return; }
    if (zone === "remind") { window.Reminders.ok(); return; }
    if (zone === "gear") { var gIt = gearItems()[gi]; if (gIt) gIt.act(); return; }
    if (zone === "appmenu") { doAppMenu(); return; }
    if (zone === "shelfmenu") { doShelfMenu(); return; }
    if (zone === "updask") { answerAsk(ai === 0); return; }
    if (lift) { dropLift(); return; }
    if (zone === "menu") { setSleep(SLEEP_CHOICES[menuI]); paintFocus(); return; }
    if (zone === "inputs") { doInputMenu(); paintFocus(); return; }
    if (zone === "ambient") { ambPress(); return; }
    if (zone === "np") { npPress(); return; }
    if (zone === "football") {
      openSettings();
      for (var fi = 0; fi < SECS.length; fi++) if (SECS[fi][0] === "football") { SET.sec = fi; break; }
      SET.col = "rows"; SET.ri = firstRow(footballRows()); renderSettings(); return;
    }
    if (zone === "pmenu") {
      if (plift) { dropPeople(); return; }
      pickWho(PEOPLE[pmi].id);
      closePop();
      renderPeople();
      paintFocus();
      return;
    }
    if (zone === "quick") { quickAction(); return; }
    if (zone === "people") {
      if (isHead()) { openPop(); paintFocus(); return; }
      pickWho(PEOPLE[pi].id);
      paintFocus();
      return;
    }
    if (zone === "shelf") {
      if (cardAt(s)) { openCard(cardAt(s)); return; }
      var it = data.shows[s];
      if (!it) return;
      status(it.app ? t("opening_in", { title: it.title, app: it.app.name }) : t("opening", { title: it.title }), true);
      if (it.wn && TV && TV.openWatchNext) {
        if (!tvWatchNext(String(it.id)) && it.app) tvLaunch(it.app.package);
        status("");
        return;
      }
      api("POST", "/api/continue/open", { id: it.id, who: NOBODY ? "both" : who }, 60000)
        .then(function (res) { status(res.note ? tBridge(res.note_key, res.note_vars, res.note) : ""); })
        .catch(function (e) {
          // the bridge can't help: at least open the app it was in (and when the bridge has lost its
          // link to this TV, say how to fix it)
          if (TV && it.app && tvLaunch(it.app.package)) { status(linkLost(e)); return; }
          status(tBridge(e.key, e.vars, e.message));
        });
      return;
    }
    var a = gridItems[g], el = gridEls[g];
    if (!a) return;
    // Back from More apps lands on the More apps tile it was opened from, with the focus showing
    if (a.kind === "more") { dockBack = gridKey(a); expanded = true; renderGrid(); paintFocus(); return; }
    if (a.kind === "gear") { openGear(); return; }
    if (a.kind === "inputs") { openInputs(); return; }
    if (a.kind === "smart") { openSmart(); return; }
    if (a.kind === "devmode") { openDevMode(); return; }
    if (a.kind === "input") {
      var done = false;
      if (TV && TV.openInput) { try { done = !!TV.openInput(a.id); } catch (e) {} }
      if (!done && !OFFLINE) {
        api("POST", "/api/key", { key: "input" }).catch(function (e) { status(tBridge(e.key, e.vars, e.message)); });
      } else if (!done) {
        note(t("no_inputs"));
      }
      return;
    }
    if (a.kind === "screen") {
      if (!a.ready) { status(tBridge(a.noteKey, a.noteVars, a.note || t("screen_not_set"))); return; }
      el.classList.add("busy");
      api("POST", "/api/screens/open", { id: a.id }, 10000)
        .then(function (res) { status(res.note ? tBridge(res.note_key, res.note_vars, res.note) : ""); })
        .catch(function (e) {
          if (TV && tvLaunch("com.limelight")) { status(""); return; }
          status(tBridge(e.key, e.vars, e.message));
        })
        .then(function () { el.classList.remove("busy"); });
      return;
    }
    opened(a.package);
    if (TV && tvLaunch(a.package)) return;
    api("POST", "/api/launch", { app: a.id || a.package }).catch(function (e) { status(tBridge(e.key, e.vars, e.message)); });
  }

  // ---------------- Smart home: the rooms and scenes screen (smarthome.js) ----------------
  function openSmart() { zone = "smart"; clearFocus(); window.smartHome.open(); }
  function closeSmart() { window.smartHome.close(); zone = "grid"; }

  // ---------------- the gear tile's menu: Home settings, the TV's own settings, and quick controls ----------------
  var gi = 0;
  // Home settings and TV settings always; then, where the TV or the on-TV app can do it (#200), Wi-Fi,
  // Bluetooth and Screen off. They open the same screens and do the same thing as their quick buttons,
  // so the Settings key reaches them even when the quick row is off. Nothing is toggled from here:
  // Android keeps Wi-Fi, Bluetooth and brightness to the system screens on Android TV 10 and newer.
  function gearItems() {
    var items = [
      { ic: ICONS.sliders, ti: t("gear_home"), sub: updReady() ? t("upd_gear", { v: UPD.latest, c: UPD.current || "" }) : t("gear_home_sub"), act: openSettings },
      { ic: ICONS.gear, ti: t("gear_tv"), sub: t("gear_tv_sub"), act: openTvSettings }
    ];
    if (nativeSettingsScreen() || (ON_TV && !OFFLINE)) {
      items.push({ ic: ICONS.network, ti: t("network"), sub: t("net_sub"), act: function () { closeGear(); paintFocus(); openSettingsScreen("network"); } });
      items.push({ ic: ICONS.bluetooth, ti: t("bluetooth"), sub: t("bt_sub"), act: function () { closeGear(); paintFocus(); openSettingsScreen("bluetooth"); } });
    }
    // the on-TV app: Phone remote, its QR and code (launch audit, 24 Nov 2026: /get says "open Settings, then Phone remote",
    // and the gear had none; it was only on the setup screen's Settings)
    if (TV && TV.openPhoneRemote) {
      items.push({ ic: ICONS.phone, ti: t("gear_phone"), sub: t("gear_phone_sub"), act: function () { closeGear(); paintFocus(); try { TV.openPhoneRemote(); } catch (e) {} } });
    }
    items.push({ ic: ICONS.screen_off, ti: t("screen_off"), sub: "", act: function () { closeGear(); paintFocus(); toggleScreenOff(true); } });
    return items;
  }
  function openGear() {
    zone = "gear"; gi = 0;
    renderGear();
  }
  // The dock's Developer Mode tile opens LG's own Developer Mode app, where the remaining days and its
  // Extend button live. It counts as "handled by hand" for a day, so the weekly question does not pop
  // up straight after someone has just extended it themselves.
  function openDevMode() {
    keep("tvhome.devmode.asked", String(Date.now()));
    if (TV && TV.launch) tvLaunch("com.palmdts.devmode");
  }
  // the gear tile if the dock shows one, else the tile the focus is on
  function gearAnchor() {
    for (var i = 0; i < gridItems.length; i++) if (gridItems[i].kind === "gear" && gridEls[i]) return i;
    return g;
  }
  function renderGear() {
    var pop = $("gear-pop");
    var items = gearItems();
    if (gi >= items.length) gi = items.length - 1;
    pop.innerHTML = items.map(function (it, i) {
      return '<div class="grow' + (i === gi ? " focus" : "") + '" role="menuitem"><i>' + it.ic + "</i><span><b>" + esc(it.ti) +
        "</b>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span></div>";
    }).join("");
    pop.classList.add("on");
    document.documentElement.classList.add("gearing");
    // above the gear tile (wherever the focus is, so the Settings key always opens it in the same place),
    // kept inside the screen's safe area
    var el = gridEls[gearAnchor()], rem = innerWidth / 120;
    if (el) {
      var b = el.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(5 * rem, Math.min(innerWidth - w - 5 * rem, b.left + b.width / 2 - w / 2)) + "px";
      pop.style.top = Math.max(3.75 * rem, b.top - pop.offsetHeight - 2.25 * rem) + "px";
    }
  }
  function closeGear() {
    $("gear-pop").classList.remove("on");
    document.documentElement.classList.remove("gearing");
    if (zone === "gear") zone = "grid";
  }
  // Android's own settings: the Settings app where the TV has one, else the system settings screen.
  function openTvSettings() {
    closeGear();
    paintFocus();
    var done = false;
    try { done = !!(TV && ((TV.launch && tvLaunch(SETTINGS_PKG)) || (TV.openSettings && TV.openSettings()))); } catch (e) {}
    if (done) return;
    if (OFFLINE) { status(t("tv_settings_none")); return; }
    api("POST", "/api/launch", { app: "settings" }).catch(function () { status(t("tv_settings_none")); });
  }

  // ---------------- Home settings: couch-tv's own settings screen ----------------
  // A tvOS style list: the sections on the left, their rows on the right. Up and down move, OK
  // changes a row, holding OK picks a row up to move it (scenes, apps, people, quick buttons), Back
  // goes back a step and then closes. What is saved, and which copy wins: docs/CONFIG.md.
  // Saved on this TV (page storage and the launcher's own store, TVOS.keep) and, with a bridge,
  // also on the computer (/api/settings), so the phone and the TV agree.
  var ST_KEY = "tvhome.settings";
  var SECS = [["language", "globe"], ["location", "pin"], ["weather", "cloud"], ["look", "look"], ["music", "note"],
    ["apps", "apps"], ["people", "person"], ["quick", "bolt"], ["designer", "designer"], ["about", "info"]];
  var SET = { col: "secs", sec: 0, ri: 0, keyFocus: null, sub: null, lift: null, confirm: null, dirty: false, typing: null,
    msg: "", geo: { q: "", list: null, busy: false, err: false } };
  var REPO_URL = "github.com/Seagey/couch-tv";
  var WX_DEFAULT = WX_NONE;
  var pushTimer = null;

  function loadSettings() {
    var r = kept(ST_KEY);
    return r && r.s && typeof r.s === "object" && !Array.isArray(r.s) ? r.s : {};
  }
  function keepSettings(pending) {
    var rec = { s: ST, updated: Date.now(), pending: pending };
    keep(ST_KEY, rec);
    return rec;
  }
  // SEEN: the server's "updated" this TV last read. Sent with every save, so a server that has had a
  // newer change since (the phone's Home settings page: the town, a photo) keeps that change instead of
  // taking this TV's older copy whole; the copy it keeps comes back here.
  var SEEN = null;
  function pushSettings(rec) {
    if (!rec) rec = keepSettings(true);   // a fresh frame has nothing kept yet
    var body = { settings: rec.s };
    if (SEEN !== null) body.seen = SEEN || "none";   // "none": it had no copy when this TV last looked
    return api("POST", "/api/settings", body)
      .then(function (j) {
        rec.pending = false; keep(ST_KEY, rec);
        if (j && j.updated) SEEN = j.updated;
        var back = j && j.settings && typeof j.settings === "object" && !Array.isArray(j.settings) ? j.settings : null;
        if (ON_TV && back && canon(back) !== canon(ST)) takeServerSettings(back);   // the on-TV app may keep the phone's town or photos; a bridge answers with what it was sent
        // a home computer keeps the phone's town or photos the same way, and names them (kept): only those
        // keys are taken, so a key this TV knows and the computer does not is never lost
        else if (!ON_TV && back && j.kept && j.kept.length) {
          var mine = Object.assign({}, ST);
          j.kept.forEach(function (k) { if (back[k] === undefined) delete mine[k]; else mine[k] = back[k]; });
          if (canon(mine) !== canon(ST)) takeServerSettings(mine);
        }
      }, function () {});
  }
  // the server's copy is newer: use it. Under Home settings the screen is drawn again and the home
  // starts again when it closes; anywhere else the home starts again now.
  function takeServerSettings(remote) {
    ST = remote;
    keepSettings(false);
    if (zone !== "settings") restart();
    else { SET.dirty = true; if (!SET.typing && !SET.lift) renderSettings(); }
  }
  // Kept on this TV straight away; handed to the bridge a moment later (pending until it has it).
  function saveSettings() {
    var rec = keepSettings(true);
    SET.dirty = true;
    if (OFFLINE || data.bridge === false) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushSettings(rec); }, 400);
  }
  // Same content, whatever order the keys came back in.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v);
  }
  // On every refresh with the bridge: a change made here while the computer was off goes to the
  // bridge; otherwise the bridge's copy comes back (this TV's storage was cleared, say).
  function syncSettings() {
    return api("GET", "/api/settings").then(function (j) {
      if (j && j.mode === "bridge") BRIDGE_PHONE = true;   // this computer serves the phone's Home settings page
      var rec = kept(ST_KEY), remote = j.settings && typeof j.settings === "object" && !Array.isArray(j.settings) ? j.settings : null;
      if (SEEN === null || !rec || !rec.pending) SEEN = j.updated || "";   // a pending copy keeps the older SEEN it was made from
      if (rec && rec.pending) return pushSettings(rec);   // SEEN is still the older one: the server keeps any newer phone change
      if (!remote || (!j.updated && !Object.keys(remote).length)) {   // the bridge has none yet: it gets ours
        if (Object.keys(ST).length) return pushSettings(keepSettings(true));
        return null;
      }
      if (canon(remote) === canon(ST)) return null;
      takeServerSettings(remote);
      return null;
    });
  }

  function staticText() {
    $("shelf-title").textContent = t("keep_watching");
    $("people-pop").setAttribute("aria-label", t("who_watching"));
    $("apps-section").setAttribute("aria-label", t("apps"));
    $("settings").setAttribute("aria-label", t("set_title"));
  }

  // Change this on your phone: wherever a phone's Home settings page exists for this TV: the on-TV app
  // (/setup on the TV), the home computer for every TV it runs (bridge/phonepage.py: Samsung, LG, VIDAA,
  // Roku, an Android TV with a computer...), and the Couch TV home app with no computer (its own small
  // server, PhoneServer.kt, asked through TV.phoneLink). The QR holds the page's address and, so a phone
  // that has never paired goes straight in, the pairing code (#pin=, the phone remote's pairing QR
  // format). A code lasts three minutes, so the QR is made again before it runs out. Not focusable: it
  // costs no presses, and every setting stays here on the TV too. Where none answers, nothing shows.
  var PHONE_QR = { timer: 0, url: "" };
  var PHONE_URL = /^http:\/\/([^\/#?]+)(\/setup(?:\?tv=[A-Za-z0-9_-]+)?)#pin=(\d{6})$/;
  var BRIDGE_PHONE = false;   // the home computer serves the page: its /api/settings says mode "bridge" (an older one does not)
  function phoneLinkFn() {
    if (PREVIEW || STANDALONE) return null;   // (a mock home asks mock.js, which answers for ?ontv=1 and ?phonepage=)
    if (!OFFLINE) return function () {
      var known = ON_TV || BRIDGE_PHONE ? Promise.resolve() : api("GET", "/api/settings").then(function (j) { if (j && j.mode === "bridge") BRIDGE_PHONE = true; });
      return known.then(function () { if (!ON_TV && !BRIDGE_PHONE) throw new Error("no phone page"); return api("GET", "/api/phone-link"); });
    };
    if (TV && TV.phoneLink) return function () {
      var j = null;
      try { j = JSON.parse(TV.phoneLink() || "null"); } catch (e) { j = null; }
      return j && j.url ? Promise.resolve(j) : Promise.reject(new Error("no phone page"));
    };
    return null;
  }
  // known now, without asking (Hold OK's menu is drawn at once): the on-TV app, a home computer that said so, the home app's own page
  function phoneLinkKnown() {
    if (!phoneLinkFn()) return false;
    if (!OFFLINE) return ON_TV || BRIDGE_PHONE;
    try { return !!JSON.parse(TV.phoneLink() || "null"); } catch (e) { return false; }   // the home app's page is running
  }
  function phoneQr() {
    var box = $("set-phone");
    clearTimeout(PHONE_QR.timer);
    if (!box) return;
    var off = function () { box.classList.remove("on"); PHONE_QR.url = ""; };
    var link = phoneLinkFn();
    if (!link || !window.TVQR || zone !== "settings") { off(); return; }
    link().then(function (j) {
      if (zone !== "settings" || !j || !PHONE_URL.test(j.url || "")) { off(); return; }
      if (j.url !== PHONE_QR.url) {
        var qr = $("set-phone-qr");
        qr.innerHTML = "";
        try { qr.appendChild(window.TVQR.svg(j.url, 120)); } catch (e) { off(); return; }
        PHONE_QR.url = j.url;
      }
      $("set-phone-head").textContent = t("set_phone");
      $("set-phone-sub").textContent = t("set_phone_sub");
      // a computer has no camera: the plain address and the code to type on its pairing screen
      var m = PHONE_URL.exec(j.url);
      $("set-phone-pc").textContent = m ? t("set_phone_pc", { addr: m[1] + m[2], code: m[3].slice(0, 3) + " " + m[3].slice(3) }) : "";
      box.classList.add("on");
      var left = +j.pin_expires_in > 0 ? +j.pin_expires_in * 1000 - 20000 : 60000;
      PHONE_QR.timer = setTimeout(phoneQr, Math.max(15000, left));
    }, function () {
      // no answer (the app busy, a code locked after wrong tries): hide it, never a dead code, and ask again
      off();
      if (zone === "settings") PHONE_QR.timer = setTimeout(phoneQr, 10000);
    });
  }

  function openSettings() {
    closeGear();
    zone = "settings";
    if (window.AmbientWeather) window.AmbientWeather.pause();
    SET.col = "secs"; SET.sec = 0; SET.ri = 0; SET.keyFocus = null; SET.sub = null; SET.lift = null; SET.confirm = null; SET.msg = ""; SET_ALL = false;
    clearFocus();
    $("settings").classList.add("on");
    document.documentElement.classList.add("setting");
    renderSettings();
    phoneQr();
  }
  // Closing starts the page again when anything changed, so the look, scenes and words all agree.
  function closeSettings() {
    stopInbox();   // Get a design from your phone asks the store only while its screen is open
    if (SET.typing) stopTyping();
    if (SET.lift) dropRow();
    $("settings").classList.remove("on");
    document.documentElement.classList.remove("setting");
    clearTimeout(PHONE_QR.timer);
    zone = "grid";
    if (window.AmbientWeather) window.AmbientWeather.resume();
    if (SET.dirty) { SET.dirty = false; restart(); return; }
    paintFocus();
    resetIdlePhoto();
    refreshCards(true);
    if (!OFFLINE) refresh();   // a change from the phone made while it was open shows now
  }

  // ---- rows ----
  // Couch TV Studio is a name, the same in every language
  function secName(id) { return id === "designer" ? "Designs" : t("sec_" + id); }
  function rowsNow() { return SET.sub ? SET.sub.rows() : sectionRows(secsNow()[SET.sec][0]); }
  function focusable(r) { return !!r && r.kind !== "head" && r.kind !== "info" && r.kind !== "code" && r.kind !== "qr"; }
  function firstRow(rows) { for (var i = 0; i < rows.length; i++) if (focusable(rows[i])) return i; return -1; }
  function stepRow(rows, i, d) { for (var j = i + d; j >= 0 && j < rows.length; j += d) if (focusable(rows[j])) return j; return i; }
  function indexOfKey(rows, k) { for (var i = 0; i < rows.length; i++) if (rows[i].key === k) return i; return -1; }
  function head(label) { return { kind: "head", key: "h:" + label, label: label }; }
  function info(key, label, value, sub) { return { kind: "info", key: key, label: label, value: value, sub: sub }; }

  // ---- design aware Home settings ----
  // With a Couch TV Studio design on screen, Home settings (and the phone's Home settings page, through
  // atHomeView) shows only the sections and rows that change something the design shows: no dock rows
  // when its dock is hidden, no scenes, video or photos when it has its own background, and so on. One
  // line at the top says so, with Show all settings (until Home settings closes). With no design, or the
  // design switched off, everything shows as before. The rules, row by row: docs/TV-HOME.md is not
  // needed; they are all here, in useRules.
  var SET_ALL = false;
  var WX_USE = ["weather", "bigtemp", "hourly", "week", "rain", "uv", "air", "surf", "date", "clock", "glassclock"];
  var PLACE_USE = WX_USE.concat(["sun", "solar", "worldclock", "commute", "moon"]);
  var CLOCK_USE = ["clock", "tallclock", "glassclock", "flipclock", "worldclock", "analog", "timer", "agenda", "welcome", "sports"];
  var PHOTO_USE = ["photo", "slideshow", "mosaic", "artframe", "memory"];
  var KW_USE = ["keep", "keeprow", "upnext", "picks"];
  var PEOPLE_USE = ["people", "keep", "keeprow", "upnext", "picks", "screentime"];
  var ATHOME_USE = ["note", "list", "wifi", "guide", "agenda", "welcome", "screentime"];
  function designUse() {
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on() || !CouchDesign.uses) return null;
    // switched off or deleted in Designs just now: the banner and the hidden rows go at once, not
    // only after Home settings is closed (launch audit 0.13.9)
    if (typeof CouchDesigner !== "undefined" && kept(CouchDesigner.KEY) === "off" && !GATE.preview) return null;
    if (DESIGN_FROM_CODE && typeof CouchDesignCode !== "undefined" && !CouchDesignCode.kept()) return null;
    try { var u = CouchDesign.uses(); return u && u.on ? u : null; } catch (e) { return null; }
  }
  // what the design on screen uses; null: no design, so every setting shows
  // (worked out once per moment: a key press draws Home settings, which asks several times, and a slow TV
  // should not measure the design's parts each time)
  var RULES = { at: 0, r: null };
  function useRules() {
    var now = Date.now();
    if (now - RULES.at < 250) return RULES.r;
    RULES = { at: now, r: workRules() };
    return RULES.r;
  }
  function workRules() {
    var u = designUse();
    if (!u) return null;
    var p = u.parts || {}, has = function (list) { return (u.kinds || []).some(function (k) { return list.indexOf(k) >= 0; }); };
    var wx = !!(p.weather || has(WX_USE));
    return {
      lookPick: !u.background,                                // a design with its own background is the look (Loop would switch it off)
      scenes: !u.background,                                  // scenes show only behind a design with no background
      video: !u.background,
      photos: !u.background || has(PHOTO_USE),
      clock: !!(p.clock || has(CLOCK_USE)),
      clockStyle: !!p.clock,
      glass: !!(p.clock || p.dock || p.keep_watching || u.glass),
      dockLook: !!p.dock,
      keepWatching: !!(p.keep_watching || has(KW_USE)),
      shelfFollow: !!(p.keep_watching && p.dock),
      startFocus: !!(p.dock || p.keep_watching || p.people),
      inputTile: false,                                       // the Inputs tile never shows with a design (inputsTileItem)
      inputs: !!p.dock,                                       // pinned input tiles: in the design's dock (design.js dock), not in its app widgets
      wxNumbers: wx,
      location: wx || has(PLACE_USE) || WX_AMBIENT || WX_SUN_GRADE,
      weather: wx || WX_AMBIENT || WX_SUN_GRADE,
      apps: !!p.dock,
      people: !!(p.people || has(PEOPLE_USE)),
      quick: !!(p.quick || has(["quick"])),
      athome: has(ATHOME_USE)
    };
  }
  function secsNow() {
    var r = SET_ALL ? null : useRules();
    if (!r) return SECS;
    return SECS.filter(function (sc) { var id = sc[0]; return r[id] === undefined || r[id] !== false; });
  }
  // the row keys each rule hides (a heading goes when nothing under it is left)
  var ROW_RULE = { "keep-photo": "scenes", "keep-photo-pick": "scenes", "photos-count-look": "scenes", "sun-sync": "scenes", "scene-secs": "scenes",
    clock: "clock", "clock-seconds": "clock", "clock-style": "clockStyle", glass: "glass", "glass-amount": "glass", "glass-note": "glass",
    "moving-tiles": "dockLook", "dock-mac": "dockLook", "glass-icons": "dockLook", "glass-focus": "dockLook",
    "keep-watching": "keepWatching", "shelf-follows-app": "shelfFollow", "start-focus": "startFocus", "idle-photo-seconds": "startFocus", "input-tile": "inputTile",
    video: "video", "video-url": "video", "video-rm": "video", "video-note": "video", "video-green": "video",
    "photos-count": "photos", "photo-pick": "photos", "photo-nopick": "photos", "photo-url": "photos", "photos-note": "photos", "photos-storage": "photos",
    "wx-unit": "wxNumbers", "wx-every": "wxNumbers" };
  function rowRule(key) {
    if (ROW_RULE[key]) return ROW_RULE[key];
    if (/^look:/.test(key)) return "lookPick";
    if (/^scene:/.test(key)) return "scenes";
    if (/^photo-rm:/.test(key)) return "photos";
    return null;
  }
  function designBanner() {
    return SET_ALL ? [info("dz-banner", "Every setting is showing", "", "Some are for parts this Couch TV Studio design doesn't show."),
      { kind: "action", key: "set-fewer", label: "Show only what this design uses", act: function () { setAll(false); } }]
      : [info("dz-banner", "This home uses a Couch TV Studio design", "", "Settings for parts it doesn't show are hidden."),
        { kind: "action", key: "set-all", label: "Show all settings", sub: "Or go back to the standard home in Designs", act: function () { setAll(true); } }];
  }
  function setAll(on) {
    var id = secsNow()[SET.sec] && secsNow()[SET.sec][0];
    SET_ALL = !!on;
    var i = secsNow().map(function (s) { return s[0]; }).indexOf(id);
    SET.sec = i >= 0 ? i : 0;
    SET.keyFocus = on ? "set-fewer" : "set-all";
    SET.msg = on ? "Showing every setting until you close Home settings." : "";
  }
  function designAware(id, rows) {
    var u = designUse(), r = SET_ALL ? null : useRules();
    if (!u) return rows;
    if (r) {
      var hideHead = {};
      if (!r.lookPick) hideHead[t("look_head")] = 1;
      if (!r.scenes) hideHead[t("scenes_head")] = 1;
      rows = rows.filter(function (row) {
        if (row.kind === "head") return !hideHead[row.label];
        var rule = rowRule(row.key);
        return !rule || r[rule] !== false;
      });
      // a heading with nothing left under it goes too
      rows = rows.filter(function (row, i) { return row.kind !== "head" || (rows[i + 1] && rows[i + 1].kind !== "head"); });
    }
    // the line that says so, at the top of the first section and of Couch TV Studio
    var first = secsNow()[0] && secsNow()[0][0];
    if (id === first || id === "designer") rows = designBanner().concat(rows);
    return rows;
  }

  function sectionRows(id) { return designAware(id, sectionRowsAll(id)); }
  function sectionRowsAll(id) {
    if (id === "football") return footballRows();
    if (id === "updates") return updateRows();
    if (id === "language") return languageRows();
    if (id === "location") return locationRows();
    if (id === "weather") return weatherRows();
    if (id === "look") return lookRows();
    if (id === "music") return musicRows();
    if (id === "spotify") return spotifyRows();
    if (id === "designer") return designerRows();
    if (id === "apps") return appsRows();
    if (id === "people") return peopleRows();
    if (id === "quick") return quickRows();
    return aboutRows();
  }
  function footballRows() {
    var rows = [info("football-help", "Choose the competitions to show", "", "The scores card cycles through your selections.")];
    FOOTBALL_LEAGUES.forEach(function (league) {
      var selected = selectedFootball().some(function (x) { return x.id === league.id; });
      rows.push({ kind: "toggle", key: "football:" + league.id, label: league.name, value: selected ? t("on") : t("off"), act: function () {
        var chosen = selectedFootball().map(function (x) { return x.id; });
        var at = chosen.indexOf(league.id);
        if (at >= 0) chosen.splice(at, 1); else chosen.push(league.id);
        ST.football_leagues = chosen; footballPage = 0; footballMatchPage = 0; footballMatchPages = 1; saveSettings(); footballRender();
      } });
    });
    return rows;
  }

  function languageRows() {
    var L = window.I18N;
    var rows = L ? L.langs.map(function (l) {
      return { kind: "choice", key: "lang:" + l.id, label: l.name, lang: l.locale, checked: L.lang() === l.id, act: function () {
        ST.lang = l.id; L.set(l.id); saveSettings(); staticText();
        if (CLOCK24 !== clock24()) { CLOCK24 = !CLOCK24; glassShown = ""; clock(); }
      } };
    }) : [];
    if (inboxCan()) rows.unshift(inboxRow("top-inbox-now"));   // a linked TV: Get my new design, at the top
    rows.push(info("lang-note", t("lang_note")));
    return rows;
  }

  // ---- location: Open-Meteo's place search (free, no key) ----
  var geoTimer = null, geoTicket = 0;
  function locationRows() {
    var geo = SET.geo;
    var rows = [info("loc-now", t("loc_now"), WXCFG.place || t("loc_unset"), WXCFG.timezone && WXCFG.timezone !== "auto" ? WXCFG.timezone : "")];
    if (ST.place && ST.place.src === "account") rows.push(info("loc-account", t("from_account"), "", t("loc_account_note")));
    rows.push({ kind: "input", key: "loc-search", label: t("loc_search"), value: geo.q, act: function () {
      startTyping({ label: t("loc_type"), value: geo.q, search: true,
        live: function (q) { findPlaces(q, false); }, submit: function (q) { findPlaces(q, true); } });
    } });
    if (geo.busy) rows.push(info("loc-busy", t("loc_searching")));
    else if (geo.err) rows.push(info("loc-err", t("loc_error")));
    else if (geo.list && !geo.list.length) rows.push(info("loc-none", t("loc_none", { q: geo.q })));
    if (geo.list && geo.list.length) {
      rows.push(head(t("loc_results")));
      geo.list.forEach(function (p, i) {
        rows.push({ kind: "choice", key: "place:" + i, label: p.name, sub: p.area,
          checked: !!(ST.place && ST.place.lat === p.lat && ST.place.lon === p.lon), act: function () { choosePlace(p); } });
      });
    }
    if (ST.place) {
      rows.push({ kind: "action", key: "loc-reset", label: t("loc_reset"), act: function () {
        delete ST.place;
        WXCFG = CFG.weather || WX_DEFAULT;
        saveSettings();
        SET.msg = t("loc_set", { place: WXCFG.place || "" });
      } });
    }
    rows.push(info("loc-note", t("loc_note")));
    rows.push(info("loc-credit", t("loc_credit")));   // Open-Meteo's place search is built on GeoNames (CC BY 4.0)
    return rows;
  }
  // In the home's language. A language with a country of its own (Italian: Italy) asks there too and
  // lists those places first, so the small towns are not lost among bigger places abroad, while
  // "Londra" still finds London. Either search may fail on its own.
  function geocode(q) {
    var L = window.I18N, lang = (L ? L.lang() : "en").slice(0, 2), home = L ? L.country() : "";
    var url = "https://geocoding-api.open-meteo.com/v1/search?count=8&format=json&language=" + lang + "&name=" + encodeURIComponent(q);
    var get = function (u) {
      return fetch(u).then(function (r) { if (!r.ok) throw new Error("place search " + r.status); return r.json(); })
        .then(null, function () { return null; });
    };
    return Promise.all(home ? [get(url + "&countryCode=" + home), get(url)] : [get(url)]).then(function (js) {
      if (!js.some(Boolean)) throw new Error("place search");
      var seen = {}, out = [];
      js.forEach(function (j) {
        ((j && j.results) || []).forEach(function (r) {
          if (!isFinite(r.latitude) || !isFinite(r.longitude) || seen[r.id]) return;
          seen[r.id] = true;
          out.push(r);
        });
      });
      return out.slice(0, 10).map(function (r) {
        // two decimals is about a kilometre: the town, never the house
        return { name: r.name, area: placeArea(r, home),
          lat: Math.round(r.latitude * 100) / 100, lon: Math.round(r.longitude * 100) / 100, timezone: r.timezone || "auto" };
      });
    });
  }
  // What tells places with the same name apart: the municipality it belongs to (Italy: the comune),
  // then the province or county, then the region or state, and the country unless it is the
  // language's own. Each one only once, and not when it is the place's own name.
  function placeArea(r, home) {
    var out = [];
    [r.admin3, r.admin2, r.admin1].forEach(function (a) {
      a = String(a || "").trim();
      if (a && a.replace(/^Comune di /, "") !== r.name && out.indexOf(a) < 0) out.push(a);
    });
    if (r.country && r.country_code !== home) out.push(r.country);
    return out.join(", ");
  }
  // While typing: a search half a second after the last key. OK: straight away, then onto the first place.
  function findPlaces(q, go) {
    clearTimeout(geoTimer);
    q = (q || "").trim();
    SET.geo.q = q;
    if (q.length < 2) {
      SET.geo = { q: q, list: null, busy: false, err: false };
      if (zone === "settings") renderSettings();
      return;
    }
    var run = function () {
      var ticket = ++geoTicket;
      SET.geo.busy = true; SET.geo.err = false;
      if (zone === "settings") renderSettings();
      geocode(q).then(function (list) {
        if (ticket !== geoTicket) return;
        SET.geo = { q: q, list: list, busy: false, err: false };
        if (go && list.length && !SET.typing) { SET.col = "rows"; SET.keyFocus = "place:0"; }
        if (zone === "settings") renderSettings();
      }, function () {
        if (ticket !== geoTicket) return;
        SET.geo = { q: q, list: null, busy: false, err: true };
        if (zone === "settings") renderSettings();
      });
    };
    if (go) run(); else geoTimer = setTimeout(run, 500);
  }
  function choosePlace(p) {
    ST.place = { name: p.name, area: p.area || "", lat: p.lat, lon: p.lon, timezone: p.timezone };
    WXCFG = { lat: p.lat, lon: p.lon, place: [p.name, p.area].filter(Boolean).join(", "), timezone: p.timezone };
    saveSettings();
    SET.msg = t("loc_set", { place: p.name });
    data.weather = null;
    refreshWeather();
  }

  // ---- weather ----
  function weatherRows() {
    return [
      { kind: "toggle", key: "wx-show", label: t("wx_show"), value: WX_SHOW ? t("on") : t("off"), act: function () {
        WX_SHOW = !WX_SHOW; ST.wx_show = WX_SHOW; saveSettings();
        if (WX_SHOW) refreshWeather();
        else updateAmbientWeather();
        clock();
      } },
      { kind: "toggle", key: "wx-ambient", label: t("wx_ambient"), sub: t("wx_ambient_sub"), value: WX_AMBIENT ? t("on") : t("off"), act: function () {
        WX_AMBIENT = !WX_AMBIENT; ST.ambient_weather = WX_AMBIENT; saveSettings();
        ambientSync();
      } },
      { kind: "toggle", key: "wx-sun-grade", label: t("wx_sun_grade"), sub: t("wx_sun_grade_sub"), value: WX_SUN_GRADE ? t("on") : t("off"), act: function () {
        WX_SUN_GRADE = !WX_SUN_GRADE; ST.ambient_sun_grade = WX_SUN_GRADE; saveSettings();
        ambientSync();
      } },
      { kind: "cycle", key: "wx-unit", label: t("wx_units"), value: WX_F ? "°F (Fahrenheit)" : "°C (Celsius)", act: function () {
        WX_F = !WX_F; ST.wx_unit = WX_F ? "f" : "c"; saveSettings(); clock();
      } },
      { kind: "cycle", key: "wx-every", label: t("wx_every"), value: t("every_min", { n: WX_EVERY }), act: function () {
        WX_EVERY = WX_EVERY === 15 ? 30 : WX_EVERY === 30 ? 60 : 15; ST.wx_every = WX_EVERY; saveSettings();
      } },
      info("wx-provider", t("wx_provider"), "Open-Meteo", t("wx_provider_note")),
      info("wx-night", t("wx_night_only"))
    ];
  }

  // ---- look, scenes and the household's own photos ----
  // Get a design (design-code.js): from config.json's design store, else Couch TV Studio's own. The TV asks
  // that one server for the code typed here; nothing connects to the TV. English only for now (needs i18n).
  function designCodeRows(rows) {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.base()) return;
    rows.push({ kind: "input", key: "design-get", label: "Get a design", sub: "Type the code from Couch TV Studio on your phone", act: function () {
      typeDesignCode("");
    } });
    // the fewest presses on the TV: scan, choose on the phone, press Send to my TV (no typing here).
    // Right under Get a design, so the rows above stay where Couch TV Studio's pictured steps show them.
    if (CouchDesignCode.openInbox && window.TVQR) rows.push({ kind: "nav", key: "design-phone", label: "Get a design from your phone",
      sub: "Scan a code with your phone and choose a design there. No typing on the TV", act: openPhoneInbox });
    // the first-run Make it yours card, again
    if (window.TVQR) rows.push({ kind: "action", key: "design-makeit", label: "Make it yours", sub: "Show the address and code to design your own screen on your phone",
      act: function () { closeSettings(); setTimeout(function () { makeitOpen(true); }, 0); } });
  }
  // A design got by code is kept on this TV until it is deleted here, whether designs are on or off
  // (it used to be hidden while they were off, so deleting it meant turning it back on first).
  function deleteRow(rows) {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.kept()) return;
    rows.push({ kind: "action", key: "design-forget", label: "Delete this design", sub: "Back to the home as it was", danger: true, act: function () {
      sameSection(function () { CouchDesignCode.forget(); }); SET.dirty = true; SET.keyFocus = "dz-switch";
      SET.msg = "Removed. The home goes back to how it was when you close Home settings.";
    } });
  }
  // Get a design from your phone (design-code.js openInbox, takeInbox): a QR of Couch TV Studio with a
  // one time inbox in it. While this screen is open, and only then, the TV asks the store every few
  // seconds whether the phone put a design code in it; nothing connects to the TV. A code that comes
  // is got exactly as a typed one (getDesignByCode), so "Use this design?" comes first, always.
  var INBOX = null;   // { state: "opening" | "waiting" | "gone" | "error", id, link, expires, every, timer, misses, msg }
  // (an inbox opened with Open this home in Couch TV Studio is asked while that screen is open instead)
  function inboxShown() {
    if (INBOX && INBOX.share) return typeof CouchShare !== "undefined" && CouchShare.isOpen();
    return zone === "settings" && !!SET.sub && SET.sub.id === "phone-inbox";
  }
  // the inbox's screen says it ran out or failed: the phone inbox page draws it; the Open this home screen
  // keeps its QR and code (they work for 30 minutes), so it just stops asking
  function inboxEnded(mine) {
    if (mine.share) { stopInbox(); return; }
    renderSettings();
  }
  // a code came: the screen that was waiting closes, and the focus goes back to the row that opened it
  function inboxGot(mine) {
    var shown = inboxShown();
    if (INBOX === mine) stopInbox();
    if (mine.share) { if (typeof CouchShare !== "undefined") CouchShare.close(); SET.keyFocus = "dz-share"; }
    else if (shown) { SET.sub = null; SET.keyFocus = "design-phone"; }
  }
  function stopInbox() { if (INBOX && INBOX.timer) clearTimeout(INBOX.timer); INBOX = null; }
  function openPhoneInbox() {
    stopInbox();
    SET.sub = { id: "phone-inbox", back: "design-phone", crumb: "Designs", title: function () { return "Get a design from your phone"; }, rows: inboxRows };
    SET.col = "rows"; SET.keyFocus = "inbox-type"; SET.ri = 0; SET.msg = "";
    var mine = INBOX = { state: "opening", misses: 0 };
    renderSettings();
    CouchDesignCode.openInbox().then(function (b) {
      if (INBOX !== mine) return;
      mine.state = "waiting"; mine.id = b.id; mine.link = b.link; mine.expires = b.expires; mine.every = b.every;
      if (inboxShown()) renderSettings();
      nextInboxLook(mine);
    }, function (e) {
      if (INBOX !== mine) return;
      mine.state = "error"; mine.msg = (e && e.message) || "";
      if (inboxShown()) renderSettings();
    });
  }
  function nextInboxLook(mine) { clearTimeout(mine.timer); mine.timer = setTimeout(function () { lookInInbox(mine); }, mine.every || 4000); }
  function lookInInbox(mine) {
    // the screen was closed, or another inbox replaced this one: stop asking
    if (INBOX !== mine || !inboxShown()) { if (INBOX === mine) stopInbox(); return; }
    if (Date.now() > mine.expires) { mine.state = "gone"; inboxEnded(mine); return; }
    CouchDesignCode.takeInbox(mine.id).then(function (code) {
      // a code is handed out once (the store deletes it as it answers): one that comes back after the
      // screen was closed is still got, so the phone's send is never lost. "Use this design?" still asks.
      if (code) {
        inboxGot(mine);
        getDesignByCode(code);
        return;
      }
      if (INBOX !== mine || !inboxShown()) return;
      mine.misses = 0; nextInboxLook(mine);
    }, function (e) {
      if (INBOX !== mine || !inboxShown()) return;
      if (e && e.kind === "gone") { mine.state = "gone"; inboxEnded(mine); return; }
      // a Wi-Fi blip: keep asking a few more times before saying so
      if (++mine.misses < 5) { nextInboxLook(mine); return; }
      mine.state = "error"; mine.msg = (e && e.message) || ""; inboxEnded(mine);
    });
  }
  function inboxRows() {
    var b = INBOX || { state: "gone" }, rows = [];
    if (b.state === "waiting" && b.link) {
      rows.push({ kind: "qr", key: "inbox-qr", link: b.link, label: "Scan this with your phone's camera",
        sub: "On your phone, choose a design in Couch TV Studio and press Send to my TV. This TV then asks you before it changes anything." });
      rows.push(info("inbox-wait", "Waiting for your phone", "", "This code works once, for 10 minutes, while this screen is open."));
    } else if (b.state === "opening") {
      rows.push(info("inbox-opening", "Making a code for your phone..."));
    } else {
      rows.push(info("inbox-gone", b.state === "error" ? (b.msg || "Could not reach Couch TV Studio.") : "That code ran out."));
      rows.push({ kind: "action", key: "inbox-new", label: "Show a new code", act: openPhoneInbox });
    }
    rows.push({ kind: "action", key: "inbox-type", label: "Type the code on the TV instead", sub: "If your phone can't scan the code", act: function () {
      stopInbox(); SET.sub = null; SET.keyFocus = "design-get"; typeDesignCode("");
    } });
    return rows;
  }
  // A design code typed with the remote: a TV's on-screen keyboard can drop a letter typed fast (a TCL,
  // 19 Nov 2026). While typing, the line under the box shows the code as ABCDE-FGHJK and how many of
  // the 10 letters are in; OK then shows it big on a Check page before anything is sent. Case, spaces
  // and the dash do not matter.
  function typeDesignCode(value) {
    startTyping({ label: "Type the code from Couch TV Studio (like ABCDE-FGHJK). The dash is not needed.", value: value || "", code: true,
      live: showCodeSoFar, submit: checkDesignCode });
    showCodeSoFar(value || "");
  }
  function showCodeSoFar(v) {
    var c = CouchDesignCode.checkCode ? CouchDesignCode.checkCode(v) : null, el = $("set-type-check");
    if (!el || !c) return;
    // a stray mark (a "_" or "." from the TV's keyboard) said "10 of 10 letters" while it was still in the box
    var mark = /[^A-Za-z0-9\s-]/.exec(String(v || ""));
    el.textContent = !c.count ? "" : c.ok ? c.shown + "   all 10 letters" : mark ? c.shown + "   take out the " + mark[0] :
      c.shown + "   " + Math.min(c.count, 99) + " of 10 letters";
  }
  // A whole code is got at once: the TV's own "Use this design?" with its preview is the one question
  // (a Check page with a second yes before it made two confirmations for one choice, launch
  // audit 0.13.9). A code that is not whole still shows the Check page, big, with what is wrong.
  function checkDesignCode(typed) {
    var c = CouchDesignCode.checkCode ? CouchDesignCode.checkCode(typed) : { ok: true, code: typed, shown: typed };
    if (c.ok) { SET.sub = null; SET.keyFocus = "design-get"; SET.col = "rows"; getDesignByCode(c.code); return; }
    SET.sub = { back: "design-get", crumb: "Designs", title: function () { return "Check the code"; },
      rows: function () { return codeCheckRows(c, typed); } };
    SET.col = "rows"; SET.keyFocus = "code-again"; SET.ri = 0;
    SET.msg = "";
  }
  function codeCheckRows(c, typed) {
    return [{ kind: "code", key: "code-shown", label: c.shown || " ", sub: c.msg },
      { kind: "action", key: "code-again", label: "Type it again", sub: "What you typed stays in the box, so you can fix it", act: function () {
        SET.sub = null; SET.keyFocus = "design-get"; typeDesignCode(String(typed || "").trim());
      } }];
  }
  function getDesignByCode(typed) {
    SET.msg = "Getting the design...";
    renderSettings();
    CouchDesignCode.get(typed).then(function () {
      setDesigner(true);   // typing a code is asking for Couch TV Studio: it is on from now
      // no design runs in the Loop look (start()): asking for one by code is asking to see it, so
      // the home goes back to Night, the look designs are laid out for
      if (LOOP) { ST.look = "night"; keep("tvhome.look", "night"); saveSettings(); }
      SET.msg = LOOP ? "Got it. Your TV switches to the Night look and asks you about it now." : "Got it. Your TV asks you about it now.";
      renderSettings();
      setTimeout(restart, 600);   // it starts again and shows "Use this design?" first
    }, function (e) {
      SET.msg = (e && e.message) || "That design could not be used.";
      if (zone === "settings") renderSettings();
    });
  }
  // Couch TV Setup brought the account's design code with it (AccountLink.kt, design-code.js fromSetup):
  // got at once, with no typing, the same way as a typed code. Setup is the person asking for their
  // account's design, so designs go on; the home starts again and "Use this design?" comes first, and
  // the home pack that came with it is applied as the home starts (takeAccountHome). Offline: tried
  // again when the home comes back to the front.
  function setupDesign() {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.fromSetup || MOCK || PREVIEW || /[?&]designer=1\b/.test(Q)) return;
    CouchDesignCode.fromSetup().then(function (d) {
      if (!d) return;
      if (typeof CouchDesigner !== "undefined") keep(CouchDesigner.KEY, "on");
      try { localStorage.removeItem("couchtv.design.off"); } catch (e) {}
      if (LOOP) { ST.look = "night"; keep("tvhome.look", "night"); saveSettings(); }
      setTimeout(restart, 300);
    }, function () {});
  }
  // The account's TV inbox (Send to Living room TV in Couch TV Studio, no code): asked by the app with the
  // link Setup wrote (AccountLink.kt). When (owner, 24 Nov 2026), and never more often:
  //  1. the TV wakes, or the home opens or comes back to the front, after 30 minutes or more away;
  //  2. the person presses Check for new designs now in Home settings, Designs;
  //  3. otherwise once a week (Studio's "poll" only when it is longer, design-code.js inboxDelay).
  // A 429's wait is a time before which the TV does not look at all. Nothing while another app or the
  // screensaver is in front. The times are kept in the page's storage, so a restart of the home is not "away".
  // A design that comes is got like a typed code (its home pack too) and goes on at once, as the account owner
  // asked for it on their own TV: "New design from your account", with Undo in Home settings, Designs for a day.
  // ACCT_INBOX, not INBOX: INBOX is the phone inbox's (Get a design from your phone) above.
  var ACCT_INBOX = { timer: 0, stopped: false, manual: false, pausedAt: 0 };
  var INBOX_PRESS_MS = 30000, IK = { last: "couchtv.inbox.last", next: "couchtv.inbox.next", wait: "couchtv.inbox.wait", seen: "couchtv.inbox.seen" };
  function inboxTime(k, v) {
    try {
      if (v === undefined) { var n = Number(localStorage.getItem(IK[k])); return isFinite(n) && n > 0 ? n : 0; }
      if (v) localStorage.setItem(IK[k], String(Math.round(v))); else localStorage.removeItem(IK[k]);
    } catch (e) {}
    return 0;
  }
  function inboxCan() {
    return !(MOCK || PREVIEW || /[?&]designer=1\b/.test(Q)) && TV && typeof TV.accountInbox === "function" &&
      typeof CouchDesignCode !== "undefined" && CouchDesignCode.readInboxAnswer && CouchDesignCode.linked();
  }
  // the timer for the weekly look; it stops while the home is away (tv.pause), and "next" keeps when it is due
  function inboxLater(secs) {
    clearTimeout(ACCT_INBOX.timer);
    ACCT_INBOX.timer = secs > 0 ? setTimeout(function () { inboxAsk("week"); }, Math.min(secs, 1728000) * 1000) : 0;
  }
  function inboxArm() {
    var next = inboxTime("next"), now = Date.now();
    if (!next) { next = now + CouchDesignCode.INBOX_WEEK * 1000; inboxTime("next", next); }
    inboxLater(Math.max(1, (next - now) / 1000));
  }
  // why: "open" (the page started), "front" (tv.resume), "now" (the person pressed Get my new design), "week" (the timer),
  // "card" (the Make it yours card is open on a linked TV: makeitCheck).
  // Answers whether the app was asked (or a kept send is being fetched).
  function inboxAsk(why) {
    var now = Date.now();
    clearTimeout(ACCT_INBOX.timer); ACCT_INBOX.timer = 0;
    if (ACCT_INBOX.stopped || PAGE_PAUSED || !inboxCan()) return false;
    var seen = why === "front" ? ACCT_INBOX.pausedAt || inboxTime("seen") : inboxTime("seen");
    var away = !seen || seen > now || now - seen >= CouchDesignCode.INBOX_AWAY * 1000;
    var due = !!inboxTime("next") && now >= inboxTime("next");
    inboxTime("seen", now);
    var go = why === "now" || why === "card" || why === "week" || due || ((why === "open" || why === "front") && away);
    if (!go || now < inboxTime("wait")) { inboxArm(); return false; }
    inboxTime("last", now);
    inboxTime("next", now + CouchDesignCode.INBOX_WEEK * 1000);   // until the answer says otherwise
    // a send kept from a fetch that failed: get that first, without asking Studio again
    var held = inboxPending();
    if (held) { ACCT_INBOX.shown = ACCT_INBOX.manual; ACCT_INBOX.manual = false; takeAccountDesign(held); inboxArm(); return true; }
    var asked = false;
    try { asked = TV.accountInbox() !== false; } catch (e) { asked = false; }
    inboxArm();
    return asked;
  }
  function inboxStop() { ACCT_INBOX.stopped = true; inboxLater(0); }
  function inboxAway() { ACCT_INBOX.pausedAt = Date.now(); inboxTime("seen", ACCT_INBOX.pausedAt); inboxLater(0); }
  // the home starting again in front (a restart for a new design or a setting) is not time away
  window.addEventListener("pagehide", function () { if (!PAGE_PAUSED && inboxTime("seen")) inboxTime("seen", Date.now()); });
  // Home settings, Designs, Check for new designs now
  function inboxCheckNow() {
    var now = Date.now();
    if (!inboxCan()) { SET.msg = INBOX_SAID.unlinked; return; }
    if (now < inboxTime("wait")) { SET.msg = "Couch TV Studio asked this TV to wait. Try again in a few minutes."; return; }
    // one press is one look, and the next one waits 30 s (INBOX_PRESS_MS) from the last look of any kind
    if (now - inboxTime("last") < INBOX_PRESS_MS) { SET.msg = "Looked a moment ago. Try again in 30 seconds."; return; }
    ACCT_INBOX.manual = true;
    if (inboxAsk("now")) SET.msg = "Looking for your new design.";
    else { ACCT_INBOX.manual = false; SET.msg = INBOX_SAID.fail; }
  }
  var INBOX_SAID = {
    none: "Nothing new yet.",
    item: "A new design arrived. Getting it...",
    wait: "Couch TV Studio asked this TV to wait. Try again in a few minutes.",
    fail: "No internet. Check the TV is online, then try again.",   // "fail", not "error": a TV word, not an error sent to the phone
    unlinked: "This TV is not linked to your account."
  };
  function accountInbox(raw) {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.readInboxAnswer) return;
    var a = CouchDesignCode.readInboxAnswer(raw), now = Date.now();
    inboxTime("wait", a.state === "wait" ? now + a.wait * 1000 : 0);
    if (a.state !== "unlinked") inboxTime("next", now + CouchDesignCode.inboxDelay(a) * 1000);
    if (ACCT_INBOX.manual) {
      ACCT_INBOX.manual = false;
      SET.msg = INBOX_SAID[a.state === "error" ? "fail" : a.state] || INBOX_SAID.fail;
      ACCT_INBOX.shown = a.state === "item";   // the fetch that follows says how it went
      if (zone === "settings") renderSettings();
    }
    makeitAnswered(a);
    if (a.state === "unlinked") { inboxStop(); return; }   // the app forgot the link; a typed code still works
    if (a.state === "item") takeAccountDesign(a);
    if (!PAGE_PAUSED && !ACCT_INBOX.stopped) inboxArm();
  }
  function takeAccountDesign(a) {
    var snap = CouchDesignCode.snapshot(typeof CouchDesigner !== "undefined" ? kept(CouchDesigner.KEY) : null);
    CouchDesignCode.get(a.code).then(function (d) {
      CouchDesignCode.holdUndo(snap, a.title);
      if (typeof CouchDesigner !== "undefined") keep(CouchDesigner.KEY, "on");
      try { localStorage.removeItem("couchtv.design.off"); } catch (e) {}
      // sent by the account to its own linked TV: on without a second question here (Undo is the way back)
      try { if (typeof CouchDesign !== "undefined" && CouchDesign.hashOf) localStorage.setItem("couchtv.design.ok", CouchDesign.hashOf(d)); } catch (e) {}
      if (LOOP) { ST.look = "night"; keep("tvhome.look", "night"); saveSettings(); }
      inboxPending(null);
      setTimeout(restart, 300);
    }, function (e) {
      // Studio hands each send out once: when only the fetch failed (no internet, busy, no room), keep its code
      // (a send's code lasts 7 days) and get it at the next look instead of losing it. A code the store says is
      // used, gone or not a design is dropped.
      var again = !!e && ["offline", "slow", "paused", "full"].indexOf(e.kind) >= 0;
      inboxPending(again ? { code: a.code, title: a.title || "", at: Date.now() } : null);
      if (ACCT_INBOX.shown) { ACCT_INBOX.shown = false; SET.msg = INBOX_SAID.fail; if (zone === "settings") renderSettings(); }
    });
  }
  // a send whose design could not be fetched yet: {code, title, at}, kept up to 7 days, checked again as read
  function inboxPending(v) {
    try {
      if (v === undefined) {
        var p = JSON.parse(localStorage.getItem("couchtv.inbox.pending") || "null"), now = Date.now();
        var a = p && typeof p.at === "number" && now - p.at < 7 * 86400000 && now >= p.at ?
          CouchDesignCode.readInboxAnswer({ state: "item", code: p.code, title: p.title }) : null;
        if (a && a.state === "item") return a;
        if (p) localStorage.removeItem("couchtv.inbox.pending");
        return null;
      }
      if (v) localStorage.setItem("couchtv.inbox.pending", JSON.stringify(v)); else localStorage.removeItem("couchtv.inbox.pending");
    } catch (e) {}
    return null;
  }
  // once, as the home starts again with it
  function accountNewNotice() {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.undoFresh || MOCK || PREVIEW) return;
    var u = CouchDesignCode.undoFresh();
    if (u) toast("New design from your account" + (u.title ? ": " + u.title : "") + ". To undo it, open Home settings, Designs.");
  }
  function undoAccountDesign() {
    var choice = CouchDesignCode.undoNew();
    if (choice === undefined) return;
    if (typeof CouchDesigner !== "undefined") { if (choice == null) keep(CouchDesigner.KEY, null); else keep(CouchDesigner.KEY, choice); }
    SET.msg = "Your earlier home is back.";
    setTimeout(restart, 600);
  }
  // Designs, Linked to your account: shown only while this TV holds a link (Couch TV Setup made it). One
  // press asks, a second press unlinks: the TV stops getting what the account sends; the design and the
  // names already here stay (Home settings, People takes the account's names off).
  var UNLINK_ASK = 0;
  // Get my new design: one press is one look at the account's inbox (30 s between looks), with a plain answer.
  // Also the first row of Home settings (languageRows) on a linked TV, so it is Settings, Right, OK.
  function inboxRow(key) {
    return { kind: "action", key: key, label: "Get my new design",
      sub: "Sent a design from your account? This looks for it now. It also comes by itself when the TV wakes, or once a week", act: inboxCheckNow };
  }
  function accountRows(rows) {
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.linked) return;
    var u = CouchDesignCode.undoHeld && CouchDesignCode.undoHeld();
    if (u) rows.push({ kind: "action", key: "dz-undo", label: "Undo the new design", sub: "Puts back what this TV had before " +
      (u.title ? "“" + u.title + "”" : "the design") + " came from your account", act: undoAccountDesign });
    if (!CouchDesignCode.linked()) return;
    if (inboxCan()) rows.push(inboxRow("dz-inbox-now"));
    var asking = UNLINK_ASK && Date.now() - UNLINK_ASK < 15000;
    rows.push({ kind: "action", key: "dz-unlink", label: asking ? "Press OK again to unlink" : "Unlink this TV from your account",
      sub: asking ? "This TV stops getting designs your Couch TV Studio account sends. What is on it now stays." :
        "Linked to your Couch TV Studio account. New designs you send come straight here.",
      act: function () {
        if (!(UNLINK_ASK && Date.now() - UNLINK_ASK < 15000)) { UNLINK_ASK = Date.now(); return; }
        UNLINK_ASK = 0;
        CouchDesignCode.unlink();
        inboxStop();
        SET.msg = "This TV is no longer linked to your account."; SET.keyFocus = "dz-share";
      } });
  }
  // ---- Designs (designer-gate.js, Couch TV Studio designs): opt in, and one step back to the standard home ----
  // English only for now, like the rows above (needs i18n). The section's name is the product's.
  function setDesigner(on) {
    sameSection(function () {
      keep(CouchDesigner.KEY, on ? "on" : "off");
      // on again: designs switched off with Back held (design.js) come back too
      if (on) try { localStorage.removeItem("couchtv.design.off"); } catch (e) {}
    });
    SET.dirty = true;
  }
  // The design aware rows and the banner follow a change in Designs at once, not after Home settings is
  // closed; sections hidden for the design come back, so the one open is found again by its name.
  function sameSection(change) {
    var id = !SET.sub && secsNow()[SET.sec] ? secsNow()[SET.sec][0] : null;
    change();
    RULES.at = 0;
    if (!id) return;
    var i = secsNow().map(function (s) { return s[0]; }).indexOf(id);
    if (i >= 0) SET.sec = i;
  }
  // Whether a design is kept on this TV: one got by code, or one in config.json (GATE.design is null
  // while designs are off, so this asks what is stored, not what the home started with)
  function designKept() {
    var got = typeof CouchDesignCode !== "undefined" ? CouchDesignCode.kept() : null;
    var cfg = (window.COUCH_CONFIG || {}).design;
    return !!(got || (cfg && typeof cfg === "object" && !Array.isArray(cfg)));
  }
  // Designs (launch audit 0.13.9, 22 Nov 2026): one switch for the design and one way to delete it,
  // then the ways to get one, then Smart home and At home under their own heading. It used to have
  // three overlapping ways back (the standard home row, the old Your design On, and a remove row) and
  // rows that only caught up after Home settings was closed. Every row here is worked out from what is
  // stored now, so it changes the moment it is pressed.
  function designsOn() {
    return !!GATE.preview || CouchDesigner.shownOn(kept(CouchDesigner.KEY), GATE.on, typeof CouchDesign !== "undefined" && CouchDesign.on());
  }
  function designerRows() {
    if (typeof CouchDesigner === "undefined") return [info("dz-none", "Designs", "", "Not in this version of the home.")];
    // the choice kept just now wins over GATE, which is only worked out when the home starts
    var rows = [], on = designsOn(), has = designKept();
    var cd = typeof CouchDesign !== "undefined" ? CouchDesign : null, held = !!(cd && cd.held && CFG.design && cd.held());
    if (!on && !has) rows.push(info("dz-off", "Designs", "Off", "Design your home on your phone, then send it to this TV. While it is off, your home stays exactly as it is."));
    if (has && on && !held) {
      var note = cd && cd.videoNote ? cd.videoNote() : "";
      rows.push({ kind: "toggle", key: "dz-switch", label: "Your design", value: "On", sub: "Turns designs off in one step. Your design is kept for later." + (note ? " " + note.replace(/^\. /, "") : ""), act: function () {
        setDesigner(false); SET.msg = "Designs are off. The standard home comes back when you close Home settings.";
      } });
      // a design with a video background: the still picture instead, by choice, kept on this TV
      if (cd && cd.hasVideo && cd.hasVideo() && cd.videoStill) {
        var still = cd.videoStill();
        rows.push({ kind: "toggle", key: "dz-still", label: "Show the still picture instead", value: still ? t("on") : t("off"),
          sub: "The design's video background stops and its still picture stays.", act: function () { cd.videoStill(!cd.videoStill()); } });
      }
    } else if (has) {
      // a design kept here comes straight back when designs are on again, so the row says so
      rows.push({ kind: "toggle", key: "dz-switch", label: "Your design", value: "Off", sub: "Brings back your last design", act: function () {
        setDesigner(true); if (cd && cd.resume) cd.resume();
        SET.msg = "Your design comes back when you close Home settings.";
      } });
    } else if (on) {
      rows.push({ kind: "toggle", key: "dz-switch", label: "Designs", value: "On", sub: "No design on this TV yet. Get one below.", act: function () {
        setDesigner(false); SET.msg = "Designs are off. The standard home comes back when you close Home settings.";
      } });
    } else {
      rows.push({ kind: "action", key: "dz-switch", label: "Turn on designs", sub: "Nothing changes until you choose a design", act: function () {
        setDesigner(true); SET.msg = "Designs are on. Get a design below, or close Home settings.";
      } });
    }
    deleteRow(rows);
    // in the Loop look no design runs (start()), so the switch would say On for a design nobody sees
    if (on && has && !held && CFG.design && LOOP) rows.push({ kind: "action", key: "dz-loop", label: "Your design", sub: "Designs show in the Night, Classic and OLED looks. Switch to Night to see it",
      act: function () { ST.look = "night"; keep("tvhome.look", "night"); saveSettings(); restart(); } });
    designCodeRows(rows);
    rows.push({ kind: "action", key: "dz-share", label: "Open this home in Couch TV Studio", sub: "Change it on your phone or computer. Names, photos, places, keys and calendar links stay on this TV.", act: shareHome });
    accountRows(rows);
    // (the Commute's Where to is its own page now, Widgets on this home; tvhome.commute stays the 0.13.8 fallback)
    if (on && CFG.design) widgetRows(rows);   // each widget on the design with settings of its own
    if ((window.smartHome && window.smartHome.setup && window.smartHome.setup.can()) || (on && AH)) rows.push(head("Smart home and At home"));
    if (window.smartHome && window.smartHome.setup && window.smartHome.setup.can()) rows.push({ kind: "nav", key: "dz-smart", label: "Smart home",
      sub: window.smartHome.setup.status().signin_again ? "Sign in again" : window.smartHome.setup.status().set ? "Connected" : window.smartHome.setup.canPhone && window.smartHome.setup.canPhone() ? "Connect Home Assistant from your phone" : "Connect Home Assistant: your aircon, lights, cameras, speakers and more", act: openSmartSetup });
    if (on && AH) rows.push({ kind: "nav", key: "dz-athome", label: "At home", sub: "A note, lists, guest Wi-Fi, a house guide, your calendar and screen time, for your widgets", act: openAtHome });
    return rows;
  }
  // The home as it is now, for Share this home (share-home.js keeps only what a design is made of)
  function homeSnapshot() {
    var arr = arrangeItems();
    return {
      scenes: SCENES.map(function (x) { return x.id; }), builtIn: BUILT_IN.map(function (x) { return x.id; }),
      scene_seconds: SCENE_MS / 1000, clock24: CLOCK24, clock_style: CLOCK_LIQUID ? "liquid" : undefined,
      glass: GLASS, glass_icons: GLASS_ICONS, glass_amount: GLASS_AMT, ambient_weather: WX_AMBIENT, ambient_sun_grade: WX_SUN_GRADE,
      lighter: LIGHTER, keep_watching: KW_ON, input_tile: INPUT_TILE, now_playing: NP_ON, dock_size: DOCK_APPS, dock_style: DOCK_MAC ? "mac" : "classic", moving_tiles: MOVING,
      dock: arr.items.slice(0, arr.line).filter(function (it) { return !it.kind || it.kind === "app"; }).map(function (it) { return it.package; }),
      design: CFG.design && typeof CouchDesign !== "undefined" && CouchDesign.on() ? CFG.design : null
    };
  }
  // everything private this TV knows, so a share holding any of it is stopped
  function privateWords() {
    var w = PEOPLE.map(function (p) { return p.name; }).concat((CFG.people || []).map(function (p) { return p && (p.name || p); }));
    var pl = ST.place || {};
    w.push(WXCFG && WXCFG.place, pl.name, pl.area, CFG.weather && CFG.weather.place);
    // where the household drives to (the Commute widget's place, kept on this TV)
    var cm = kept("tvhome.commute"); if (cm && cm.name) w.push(String(cm.name));
    try { w.push(location.hostname); } catch (e) {}
    // every place a widget was given on this TV (a beach, where you drive to): its name and area
    Object.keys(wsAll()).forEach(function (k) { var v = wsAll()[k]; Object.keys(v).forEach(function (n) { var p = v[n]; if (p && typeof p === "object" && !Array.isArray(p) && isFinite(p.lat)) w.push(p.name, p.area); }); });
    w = w.concat(ahPrivateWords());
    return w.filter(function (x) { return typeof x === "string" && x.length >= 3 && !/^(home\.tvos\.invalid|localhost|127\.0\.0\.1)$/.test(x); });
  }
  function shareHome() {
    if (typeof CouchShare === "undefined") return;
    var r = CouchShare.prepare(homeSnapshot(), privateWords(), typeof CouchDesign !== "undefined" ? CouchDesign : null);
    if (r.error) { SET.msg = r.error; renderSettings(); return; }
    var base = typeof CouchDesignCode !== "undefined" ? CouchDesignCode.base() : "";
    SET.msg = "Getting a code for Couch TV Studio...";
    renderSettings();
    // The way back (launch audit 0.13.9): the screen also opens this TV's phone inbox and its QR carries
    // it (#inbox=), so Send to my TV on the phone comes straight back here, asked about with "Use this
    // design?" as always. Without an inbox (an older store, a blip) the QR and code work as before.
    stopInbox();
    var inbox = CouchDesignCode.openInbox && window.TVQR ? CouchDesignCode.openInbox().catch(function () { return null; }) : Promise.resolve(null);
    CouchShare.send(base, r.design).then(function (res) {
      return inbox.then(function (b) {
        SET.msg = "";
        if (zone === "settings") renderSettings();
        if (b && b.id) res.link += "#inbox=" + b.id;
        CouchShare.show(res, { back: !!(b && b.id) });
        if (!b || !b.id) return;
        var mine = INBOX = { share: true, state: "waiting", misses: 0, id: b.id, link: b.link, expires: b.expires, every: b.every };
        nextInboxLook(mine);
      });
    }, function (e) {
      SET.msg = (e && e.message) || "That did not work. Try again.";
      if (zone === "settings") renderSettings();
    });
  }
  var SECS_STEPS = [10, 15, 20, 30, 45, 60, 120];
  function setLighter(on) {
    LIGHTER = on; ST.lighter = LIGHTER; saveSettings();
    document.documentElement.classList.toggle("lighter", LIGHTER); if (LOOP) loopLighter(); ambientSync(); movingTiles(); renderShelf(); paintFocus();
  }
  // a Look row Lighter home holds off (g23, a MiTV 5X: the switch did nothing and said nothing): it says
  // "Off while Lighter home is on", and OK asks "Turn off Lighter home?"; a second OK turns Lighter home off
  // and this on (turnOn sets what the row would have)
  function heldByLighter(row, turnOn) {
    if (!LIGHTER) return row;
    row.value = t("off"); row.sub = t("lighter_holds"); row.ask = true; row.confirmText = t("lighter_off_ask");
    row.act = function () { turnOn(); setLighter(false); };
    return row;
  }
  function lookRows() {
    var look = lookSetting(), st = sceneState(), rows = [head(t("look_head"))];
    ["night", "oled", "classic", "loop"].forEach(function (id) {
      // Loop is a name, the same in every language, with no second line (docs/TV-HOME.md, "The Loop look")
      rows.push({ kind: "choice", key: "look:" + id, label: t("look_" + id), sub: id === "loop" ? "" : t("look_" + id + "_sub"), checked: look === id,
        act: function () { ST.look = id; keep("tvhome.look", id); saveSettings(); } });
    });
    if (look === "classic") {
      rows.push({ kind: "toggle", key: "keep-photo", label: t("keep_photo"), sub: t("keep_photo_sub"), value: KEEP_PHOTO ? t("on") : t("off"), act: function () {
        KEEP_PHOTO = !KEEP_PHOTO; ST.keep_photo = KEEP_PHOTO;
        if (KEEP_PHOTO) { var cl = classicPhotos(); ST.keep_photo_pick = photoKey(cl[photo % cl.length]); }
        saveSettings(); showPhoto();
      } });
      if (KEEP_PHOTO) rows.push({ kind: "cycle", key: "keep-photo-pick", label: t("keep_photo_pick"), value: t("photo_n_of", { n: (photo % classicPhotos().length) + 1, total: classicPhotos().length }), act: function () {
        var cl = classicPhotos(); photo = (photo + 1) % cl.length;
        ST.keep_photo_pick = photoKey(cl[photo]); saveSettings(); showPhoto();
      } });
    }
    rows.push(head(t("scenes_head")));
    rows.push(info("photos-count-look", photoCountText()));
    st.order.forEach(function (id) {
      var sc = sceneById(id);
      if (!sc) return;
      var label = sc.dailyBing ? t("scene_bing_daily") : sc.own ? t("scene_photo", { n: sc.n }) : sc.mine ? sc.name || t("scene_mine", { n: sc.n }) : t("scene_" + id);
      rows.push({ kind: "check", key: "scene:" + id, label: label,
        thumb: sc.src || (sc.photo ? "backgrounds/" + sc.photo + ".jpg" : ""), checked: st.off.indexOf(id) < 0,
        act: function () { toggleScene(id); }, move: function (d) { moveScene(id, d); } });
    });
    rows.push({ kind: "toggle", key: "sun-sync", label: t("sun_sync"), sub: t("sun_sync_sub"), value: SUN_SYNC ? t("on") : t("off"), act: function () {
      SUN_SYNC = !SUN_SYNC; ST.sun_sync = SUN_SYNC; saveSettings(); if (SUN_SYNC) applySunSync();
    } });
    var secs = Math.round(SCENE_MS / 1000);
    rows.push({ kind: "cycle", key: "scene-secs", label: t("scene_secs"), value: t("n_secs", { n: secs }), act: function () {
      var i = SECS_STEPS.indexOf(secs), n = i < 0 ? 20 : SECS_STEPS[(i + 1) % SECS_STEPS.length];
      ST.scene_seconds = n; SCENE_MS = n * 1000; saveSettings();
    } });
    rows.push({ kind: "cycle", key: "clock", label: t("clock"), value: CLOCK24 ? t("clock_24") : t("clock_12"), act: function () {
      CLOCK24 = !CLOCK24; ST.clock = CLOCK24 ? "24h" : "12h"; saveSettings(); glassShown = ""; clock();
    } });
    // g17: the clock on or off (a design picks its own, so the row is not there with one on)
    if (!(typeof CouchDesign !== "undefined" && CouchDesign.on())) rows.push({ kind: "toggle", key: "show-clock", label: t("show_clock"),
      value: SHOW_CLOCK ? t("on") : t("off"), act: function () {
        SHOW_CLOCK = !SHOW_CLOCK; ST.show_clock = SHOW_CLOCK; saveSettings(); clockShown(); fitDate();
      } });
    rows.push({ kind: "toggle", key: "clock-seconds", label: t("clock_seconds"), value: CLOCK_SECONDS ? t("on") : t("off"), act: function () {
      CLOCK_SECONDS = !CLOCK_SECONDS; ST.clock_seconds = CLOCK_SECONDS; saveSettings();
      glassShown = ""; clock(); syncClockSeconds();
    } });
    // g30: the 4K copies of the built-in pictures. Auto: on a screen drawn at 4K. Always: also on a 4K TV that
    // draws its interface at 1080 (#191). Off: the 1080 copies, for a 4K TV that stutters (four times the memory)
    var hr = hiResSetting();
    rows.push({ kind: "cycle", key: "hi-res", label: t("hi_res"), sub: t("hi_res_sub"), value: t("hi_res_" + hr), act: function () {
      ST.hi_res = hr === "auto" ? "off" : hr === "off" ? "always" : "auto"; saveSettings();   // Auto, Off, Always: the costly one last
      if (!NIGHT) showPhoto();   // Classic and OLED: the photo again at once; the Night scenes when settings close
    } });
    rows.push({ kind: "cycle", key: "idle-photo-seconds", label: t("idle_photo"), sub: t("idle_photo_sub"),
      value: IDLE_PHOTO_SECONDS ? t("n_secs", { n: IDLE_PHOTO_SECONDS }) : t("off"), act: function () {
        var i = IDLE_PHOTO_STEPS.indexOf(IDLE_PHOTO_SECONDS);
        IDLE_PHOTO_SECONDS = IDLE_PHOTO_STEPS[(i + 1) % IDLE_PHOTO_STEPS.length];
        ST.idle_photo_seconds = IDLE_PHOTO_SECONDS; saveSettings(); resetIdlePhoto();
      } });
    // the TV's own screensaver (Google TV's Ambient mode) and the albums it shows
    rows.push(head(t("ambient_head")));
    rows.push({ kind: "action", key: "ambient", label: t("ambient_settings"), sub: t("ambient_settings_sub"),
      act: function () { openAmbientSettings(); } });
    // Smart Idle & OLED-safe Ambient Mode
    rows.push(head(t("smart_idle_head")));
    rows.push({ kind: "toggle", key: "smart-idle-on", label: t("smart_idle_on"), sub: t("smart_idle_on_sub"),
      value: SMART_IDLE.enabled ? t("on") : t("off"), act: function () {
        SMART_IDLE.enabled = !SMART_IDLE.enabled;
        ST.smart_idle = SMART_IDLE; saveSettings(); resetSmartIdle(); renderSettings();
      } });
    rows.push({ kind: "cycle", key: "smart-idle-home", label: t("smart_idle_home"),
      value: SMART_IDLE.home_idle_minutes ? t("n_min", { n: SMART_IDLE.home_idle_minutes }) : t("off"), act: function () {
        var i = SMART_IDLE_HOME_STEPS.indexOf(SMART_IDLE.home_idle_minutes);
        SMART_IDLE.home_idle_minutes = SMART_IDLE_HOME_STEPS[(i + 1) % SMART_IDLE_HOME_STEPS.length];
        ST.smart_idle = SMART_IDLE; saveSettings(); resetSmartIdle(); renderSettings();
      } });
    rows.push({ kind: "cycle", key: "smart-idle-action", label: t("smart_idle_action"),
      value: t("smart_idle_act_" + SMART_IDLE.home_action), act: function () {
        var i = SMART_IDLE_ACTIONS.indexOf(SMART_IDLE.home_action);
        SMART_IDLE.home_action = SMART_IDLE_ACTIONS[(i + 1) % SMART_IDLE_ACTIONS.length];
        ST.smart_idle = SMART_IDLE; saveSettings(); renderSettings();
      } });
    rows.push({ kind: "cycle", key: "smart-idle-paused", label: t("smart_idle_paused"), sub: t("smart_idle_paused_sub"),
      value: SMART_IDLE.paused_idle_minutes ? t("n_min", { n: SMART_IDLE.paused_idle_minutes }) : t("off"), act: function () {
        var i = SMART_IDLE_PAUSED_STEPS.indexOf(SMART_IDLE.paused_idle_minutes);
        SMART_IDLE.paused_idle_minutes = SMART_IDLE_PAUSED_STEPS[(i + 1) % SMART_IDLE_PAUSED_STEPS.length];
        ST.smart_idle = SMART_IDLE; saveSettings(); renderSettings();
      } });
    rows.push({ kind: "toggle", key: "smart-idle-quiet", label: t("smart_idle_quiet"), sub: t("smart_idle_quiet_sub"),
      value: SMART_IDLE.quiet_hours.enabled ? t("on") : t("off"), act: function () {
        SMART_IDLE.quiet_hours.enabled = !SMART_IDLE.quiet_hours.enabled;
        ST.smart_idle = SMART_IDLE; saveSettings(); renderSettings();
      } });
    rows.push(head(t("soundscape")));
    var curSound = window.Soundscape ? window.Soundscape.current() : SOUND_TYPE;
    rows.push({
      kind: "cycle",
      key: "soundscape",
      label: t("soundscape"),
      value: curSound === "off" ? t("timer_off") : (t("sound_" + curSound) || curSound),
      act: function () {
        cycleSoundscape();
        renderSettings();
      }
    });
    var volSteps = [0.2, 0.4, 0.6, 0.8, 1.0];
    var volPct = Math.round(SOUND_VOL * 100) + "%";
    rows.push({
      kind: "cycle",
      key: "soundscape-vol",
      label: t("sound_volume"),
      value: volPct,
      act: function () {
        var vi = volSteps.indexOf(Math.round(SOUND_VOL * 10) / 10);
        SOUND_VOL = vi < 0 ? 0.6 : volSteps[(vi + 1) % volSteps.length];
        if (window.Soundscape) window.Soundscape.setVolume(SOUND_VOL);
        ST.soundscape = { type: window.Soundscape ? window.Soundscape.current() : SOUND_TYPE, volume: SOUND_VOL, fade_with_sleep: SOUND_FADE_SLEEP };
        saveSettings();
        renderSettings();
      }
    });
    // glass panels: off, on, on with no blur (for slower TVs)
    rows.push(head(t("glass_head")));
    // (not in the Loop look, whose material is its own: html.glass stays off there, readConfig)
    if (!LOOP) rows.push({ kind: "cycle", key: "glass", label: t("glass"), value: GLASS === "lite" ? t("glass_lite") : GLASS === "on" ? t("on") : t("off"), act: function () {
      GLASS = GLASS === "off" ? "on" : GLASS === "on" ? "lite" : "off"; ST.glass = GLASS; saveSettings(); movingTiles();
    } });
    // the focused tile's slow sway: off by itself with glass "lite", and here for a TV that flickers (#52)
    // Lighter home holds both off: the row says so, and OK asks to turn Lighter home off and this on (g23)
    rows.push(heldByLighter({ kind: "toggle", key: "moving-tiles", label: t("moving_tiles"), value: MOVING ? t("on") : t("off"), act: function () {
      MOVING = !MOVING; ST.moving_tiles = MOVING; saveSettings(); movingTiles();
    } }, function () { ST.moving_tiles = true; }));
    // the Mac-style dock: the focused app and its neighbours grow in a wave, its name in a bubble above it
    // (not in the Loop look: its dock has no wave, movingTiles, and a press there would only save "mac" for Night)
    if (NIGHT && !LOOP) rows.push(heldByLighter({ kind: "toggle", key: "dock-mac", label: t("dock_mac"), value: DOCK_MAC ? t("on") : t("off"), act: function () {
      ST.dock = DOCK_MAC ? "classic" : "mac"; saveSettings(); movingTiles();
    } }, function () { ST.dock = "mac"; }));
    // a slow box (#58): no blur, no soft shadows, a still photo and smaller pictures, all in one switch
    // the whole Keep watching row, heading and all (home.keep_watching): off closes the gap and stops fetching it
    rows.push({ kind: "toggle", key: "keep-watching", label: t("keep_show"), value: KW_ON ? t("on") : t("off"), act: function () {
      KW_ON = !KW_ON; ST.keep_watching = KW_ON; saveSettings();
      document.documentElement.classList.toggle("kw-off", !KW_ON && !CARDS.length);
      if (!KW_ON) { data.shows = []; shelfEls = []; s = 0; }
      renderShelf(); renderNp();
    } });
    // an Inputs tile first in the dock (home.input_tile), for a simple home: HDMI one press from the apps (#154)
    rows.push({ kind: "toggle", key: "input-tile", label: t("input_tile"), sub: t("input_tile_sub"), value: INPUT_TILE ? t("on") : t("off"), act: function () {
      INPUT_TILE = !INPUT_TILE; ST.input_tile = INPUT_TILE; saveSettings();
    } });
    // the row follows the app the remote is on (home.shelf_follows_app): only that app's cards, as "Recently on <app>"
    rows.push({ kind: "toggle", key: "shelf-follows-app", label: t("shelf_follow"), sub: t("shelf_follow_sub"), value: SHELF_FOLLOW ? t("on") : t("off"), act: function () {
      SHELF_FOLLOW = !SHELF_FOLLOW; ST.shelf_follows_app = SHELF_FOLLOW; saveSettings();
      if (!SHELF_FOLLOW && followPkg) { followPkg = null; renderShelf(); }   // the whole row again, straight away
    } });
    // the Night row as Classic poster tiles, more to a row (#192); Classic already has them
    if (KW_ON && postersFit()) rows.push({ kind: "toggle", key: "kw-posters", label: t("kw_posters"), value: KW_POSTER ? t("on") : t("off"), act: function () {
      KW_POSTER = !KW_POSTER; ST.keep_watching_style = KW_POSTER ? "poster" : "card"; saveSettings();
      renderShelf(); s = Math.max(0, Math.min(s, shelfEls.length - 1));
    } });
    rows.push({ kind: "cycle", key: "start-focus", label: t("start_focus"), sub: t("start_focus_sub"),
      value: t("start_focus_" + START_FOCUS), act: function () {
        var steps = ["people", "keep_watching", "apps"];
        var i = steps.indexOf(START_FOCUS);
        START_FOCUS = steps[(i + 1) % steps.length];
        ST.start_focus = START_FOCUS;
        saveSettings();
      } });
    rows.push({ kind: "toggle", key: "lighter", label: t("lighter"), value: LIGHTER ? t("on") : t("off"), act: function () { setLighter(!LIGHTER); } });
    rows.push({ kind: "toggle", key: "icon-style", label: t("icon_style"), value: t("icon_style_" + ICON_SET), sub: t("icon_style_sub"), act: function () {
      ICON_SET = ICON_SETS[(ICON_SETS.indexOf(ICON_SET) + 1) % ICON_SETS.length]; ST.icon_set = ICON_SET; saveSettings(); renderGrid();
    } });
    rows.push({ kind: "toggle", key: "glass-icons", label: t("glass_icons"), value: GLASS_ICONS ? t("on") : t("off"), act: function () {
      GLASS_ICONS = !GLASS_ICONS; ST.glass_icons = GLASS_ICONS; saveSettings();
      document.documentElement.classList.toggle("glass-icons", GLASS_ICONS);   // seen straight away
      clearIcons();
    } });
    // with glass app icons: the focused app shows its own colours, or stays glass (#32)
    if (GLASS_ICONS) rows.push({ kind: "cycle", key: "glass-focus", label: t("glass_focus"),
      value: GLASS_FOCUS === "glass" ? t("glass_focus_glass") : t("glass_focus_colour"), act: function () {
        GLASS_FOCUS = GLASS_FOCUS === "glass" ? "colour" : "glass"; ST.glass_focus = GLASS_FOCUS; saveSettings();
        document.documentElement.classList.toggle("gi-stay", GLASS_FOCUS === "glass");   // seen straight away
      } });
    // how clear, 1 to 5 (#29): left and right on the row, or OK to step; seen straight away
    var setAmt = function (n) {
      n = Math.max(1, Math.min(5, n));
      if (n === GLASS_AMT) return;
      GLASS_AMT = n; ST.glass_amount = n; glassClasses(); glassShown = ""; saveSettings();
    };
    rows.push({ kind: "slider", key: "glass-amount", label: t("glass_amount"), value: t("glass_amt_" + GLASS_AMT), level: GLASS_AMT,
      adjust: function (dx) { setAmt(GLASS_AMT + dx); }, act: function () { setAmt(GLASS_AMT === 5 ? 1 : GLASS_AMT + 1); } });
    // the Night clock: frosted (the photo's frosted copy) or liquid glass (#25)
    rows.push({ kind: "cycle", key: "clock-style", label: t("clock_style"), value: CLOCK_LIQUID ? t("clock_liquid") : t("clock_frosted"), act: function () {
      CLOCK_LIQUID = !CLOCK_LIQUID; ST.clock_style = CLOCK_LIQUID ? "liquid" : "frosted"; glassClasses(); saveSettings();
    } });
    rows.push(info("glass-note", t("glass_note", { keep: t("keep_watching") }) + " " + t("glass_icons_note") + " " + t("glass_amount_note") + " " + t("moving_tiles_note") + " " + t("lighter_note")));
    // the sound on every arrow and OK (#32): the TV's own, a softer one, or none
    rows.push(head(t("sound_head")));
    rows.push({ kind: "cycle", key: "nav-sound", label: t("nav_sound"), value: t("nav_sound_" + SOUND_STYLE), act: function () {
      SOUND_STYLE = SOUND_STYLE === "system" ? "soft" : SOUND_STYLE === "soft" ? "off" : "system";
      ST.nav_sound = SOUND_STYLE; saveSettings(); blip(0, 0);
    } });
    // the video background: its switch only once there is a link
    rows.push(head(t("video_head")));
    if (VIDEO_URL) {
      var vidOn = typeof ST.video === "boolean" ? ST.video : true;
      rows.push({ kind: "toggle", key: "video", label: t("video"), value: vidOn ? t("on") : t("off"), act: function () {
        ST.video = !vidOn; saveSettings();
      } });
    }
    rows.push({ kind: "input", key: "video-url", label: t("video_url"), sub: VIDEO_URL || t("video_none"), act: function () {
      startTyping({ label: t("video_url_type"), value: VIDEO_URL, url: true, submit: setVideoUrl });
    } });
    if (VIDEO_URL) rows.push({ kind: "action", key: "video-rm", label: t("video_remove"), danger: true, act: function () {
      ST.video_url = ""; VIDEO_URL = ""; ST.video = false; saveSettings();
    } });
    rows.push(info("video-note", t("video_note")));
    // g33: why the photo is back, and the way to try the clips again (a TV update may have fixed the decoder)
    if (greenTv()) rows.push({ kind: "action", key: "video-green", label: t("video_try_again"), sub: t("video_green"), act: function () {
      try { localStorage.removeItem("couchtv.video.green"); localStorage.removeItem("couchtv.video.slow"); } catch (e) {}
      VIDEO_ON = !!VIDEO_URL && (typeof ST.video === "boolean" ? ST.video : true) && !LOOP;
      startVideo(); sceneVideos(true);
    } });
    rows.push(head(t("photos_head")));
    rows.push(info("photos-count", photoCountText()));
    if (canPick()) rows.push({ kind: "action", key: "photo-pick", label: t("photos_pick"), sub: t("photos_pick_sub"), act: pickPhotos });
    else rows.push(info("photo-nopick", t("photos_no_pick"), "", t("photos_no_pick_sub")));
    rows.push({ kind: "input", key: "photo-url", label: t("photos_url"), sub: PHOTO_NOTE || undefined, act: function () {
      startTyping({ label: t("photos_url_type"), value: "", url: true, submit: addPhotoUrl });
    } });
    (Array.isArray(ST.photos) ? ST.photos : []).forEach(function (p, i) {
      rows.push({ kind: "action", key: "photo-rm:" + p.id, label: t("photo_remove", { n: i + 1 }), thumb: photoSrc(p), danger: true,
        sub: PHOTO_FAIL["p-" + p.id] ? t("photo_failed_home") : undefined,
        act: function () { removePhoto(p.id); } });
    });
    rows.push(info("photos-note", t("photos_note")));
    rows.push(info("photos-storage", t("photos_storage", { n: MAX_PHOTOS })));
    return rows;
  }
  function setScenes(st) { ST.scene_order = st.order; ST.scenes_off = st.off; saveSettings(); }
  function toggleScene(id) {
    var st = sceneState(), i = st.off.indexOf(id);
    if (i >= 0) st.off.splice(i, 1);
    else if (st.order.length - st.off.length <= 1) { SET.msg = t("one_scene"); return; }
    else st.off.push(id);
    setScenes(st);
  }
  function moveScene(id, d) {
    var st = sceneState(), i = st.order.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= st.order.length) return;
    st.order[i] = st.order[j]; st.order[j] = id;
    setScenes(st);
  }
  // The launcher's file picker (Android's "open a document" screen), where the TV has one.
  function canPick() { try { return !!(TV && TV.canPickPhotos && TV.canPickPhotos()); } catch (e) { return false; } }
  function photoCountText() { return t("photos_count", { n: (Array.isArray(ST.photos) ? ST.photos : []).length, max: MAX_PHOTOS }); }
  function pickPhotos() {
    var ok = false;
    try { ok = !!TV.pickPhotos(); } catch (e) {}
    if (!ok) SET.msg = t("photos_no_pick");
  }
  function uid() { return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function photosAdded(names) {
    var list = [];
    try { list = typeof names === "string" ? JSON.parse(names) : names || []; } catch (e) { list = []; }
    var photos = Array.isArray(ST.photos) ? ST.photos.slice() : [], n = 0;
    list.forEach(function (f) { if (typeof f === "string" && photos.length < MAX_PHOTOS) { photos.push({ id: uid(), file: f }); n++; } });
    if (!n) return;
    ST.photos = photos;
    saveSettings();
    SET.msg = n === 1 ? t("photos_added") : t("photos_added_n", { n: n });
    if (zone === "settings") renderSettings();
  }
  // The video background's link: checked by loading it once (muted), like a photo's address.
  function setVideoUrl(u) {
    u = (u || "").trim();
    if (!u) return;
    // a computer at home (typed as its number, or a name ending in .local) is usually plain http
    if (!/^https?:\/\//i.test(u)) u = (/^(\d+\.){3}\d+|^[^\/]+\.local\b/i.test(u) ? "http://" : "https://") + u;
    SET.msg = t("video_checking");
    var v = document.createElement("video"), done = false;
    var finish = function (good) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      if (good) {
        ST.video_url = u; ST.video = true; VIDEO_URL = u;
        if (window.CouchVideo && CouchVideo.clearGreen) CouchVideo.clearGreen();   // a new link gets its own chance (g33)
        saveSettings();
        SET.msg = t("video_added");
      // Apple's own server (the tvOS aerials) uses a certificate from Apple's private CA, which
      // Android and Chrome do not trust, so its links never load here whatever the format (#27).
      } else SET.msg = t(/^https:\/\/sylvan\.apple\.com\//i.test(u) ? "video_apple" : "video_bad");
      if (zone === "settings") renderSettings();
    };
    var timer = setTimeout(function () { finish(false); }, 20000);
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = function () { finish(v.videoWidth > 0); };
    v.onerror = function () { finish(false); };
    v.src = u;
  }
  // g05 (an XGIMI Horizon 20 Max): a photo added by its web address never showed and nothing said why.
  // The link is now asked for first where the site allows it (the answer's error number, a web page
  // instead of a photo, a file far too big), then opened as a picture (a photo too big for a TV to
  // draw), and the reason stays under the row until the next try, so it is there when someone comes
  // back to the page. A photo that later does not open on the home says so on its own row too.
  var PHOTO_NOTE = "", PHOTO_FAIL = {}, PHOTO_MAX_PX = 6000, PHOTO_MAX_BYTES = 30 * 1024 * 1024;
  function photoAsk(u) {
    // what the site answers, where it lets a page ask (many photo sites do); null when it does not say
    if (typeof fetch !== "function") return Promise.resolve(null);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    return fetch(u, { method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        var type = (r.headers.get("content-type") || "").toLowerCase(), len = Number(r.headers.get("content-length")) || 0;
        if (ctl) try { ctl.abort(); } catch (e) {}   // the headers are enough: the picture comes next, as an image
        if (!r.ok) return { why: "photos_bad_missing", code: r.status };
        if (/^text\/html|^application\/xhtml/.test(type)) return { why: "photos_bad_page" };
        if (len > PHOTO_MAX_BYTES) return { why: "photos_bad_big_mb", mb: Math.round(len / 1048576) };
        return null;
      }, function () { clearTimeout(timer); return null; });
  }
  function addPhotoUrl(u) {
    u = (u || "").trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    if ((ST.photos || []).length >= MAX_PHOTOS) { SET.msg = t("photos_full", { n: MAX_PHOTOS }); return; }
    SET.msg = t("photos_checking"); PHOTO_NOTE = "";
    var done = false, timer = null;
    var finish = function (why, vars) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!why) {
        ST.photos = (Array.isArray(ST.photos) ? ST.photos : []).concat([{ id: uid(), url: u }]);
        saveSettings();
        SET.msg = t("photos_added");
      } else SET.msg = PHOTO_NOTE = t(why, vars || {});
      if (zone === "settings") renderSettings();
    };
    timer = setTimeout(function () { finish("photos_slow"); }, 20000);
    photoAsk(u).then(function (said) {
      if (done) return;
      if (said) { finish(said.why, said); return; }
      var im = new Image();
      im.onload = function () {
        if (!(im.naturalWidth > 0)) finish("photos_bad_blocked");
        else if (im.naturalWidth > PHOTO_MAX_PX || im.naturalHeight > PHOTO_MAX_PX) finish("photos_bad_big", { w: im.naturalWidth, h: im.naturalHeight, max: PHOTO_MAX_PX });
        else finish("");
      };
      im.onerror = function () { finish("photos_bad_blocked"); };
      im.src = u;
    });
  }
  function removePhoto(id) {
    var p = (ST.photos || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (p.file) try { if (TV && TV.removePhoto) TV.removePhoto(p.file); } catch (e) {}
    ST.photos = ST.photos.filter(function (x) { return x.id !== id; });
    saveSettings();
  }

  // ---- apps: the same order as holding OK on the dock, plus hiding ----
  
  // App name, Long titles and Card alignment shape every music app's Now playing card (and align the Night
  // look's Keep watching row), so they sit under Now playing on every home, not only where Spotify's card
  // works. They are still kept in ST.spotify, where 0.13.11 saved them.
  function musicRows() {
    var rows = [];
    rows.push(head(t("np_head")));
    rows.push({ kind: "toggle", key: "now-playing", label: t("np_show"), value: NP_ON ? t("on") : t("off"), act: function () {
      NP_ON = !NP_ON; ST.now_playing = NP_ON; saveSettings(); refreshMusic();
    } });
    rows.push({ kind: "toggle", key: "ambient-music", label: t("ambient_music"), value: AMBIENT_MUSIC ? t("on") : t("off"), act: function () {
      AMBIENT_MUSIC = !AMBIENT_MUSIC; ST.ambient_music = AMBIENT_MUSIC; saveSettings(); renderAmbientMusic();
    } });
    rows = rows.concat(npLookRows());
    rows.push(info("np-note", t(OFFLINE ? "np_note_offline" : "np_note")));
    rows = rows.concat(spotifyRows());
    return rows;
  }

  function npLookRows() {
    function keep(k, v) { ST.spotify = ST.spotify || {}; ST.spotify[k] = v; saveSettings(); }
    var isMini = (SPOTIFY.card_style || "compact") === "mini";
    var headMode = SPOTIFY.separate_row === false || SPOTIFY.separate_row === "kw" ? "kw" : (SPOTIFY.separate_row === "none" ? "none" : "np");
    var rows = [
      { kind: "cycle", key: "spotify-separate-row", label: t("spotify_separate_row"), value: t("spotify_heading_" + headMode), act: function () {
        var cur = SPOTIFY.separate_row === false || SPOTIFY.separate_row === "kw" ? "kw" : (SPOTIFY.separate_row === "none" ? "none" : "np");
        var choices = ["np", "kw", "none"];
        SPOTIFY.separate_row = choices[(choices.indexOf(cur) + 1) % choices.length];
        keep("separate_row", SPOTIFY.separate_row); renderNp(); renderShelf(); renderSettings();
      } },
      { kind: "cycle", key: "spotify-card-style", label: t("spotify_card_style"), value: t("spotify_style_" + (SPOTIFY.card_style || "compact")), act: function () {
        var choices = ["compact", "mini"];
        SPOTIFY.card_style = choices[(choices.indexOf(SPOTIFY.card_style || "compact") + 1) % choices.length];
        keep("card_style", SPOTIFY.card_style); applySpotifyAlign(); renderNp(); renderGrid(); renderShelf(); renderSettings();
      } }
    ];
    if (isMini) {
      rows.push({ kind: "cycle", key: "spotify-mini-align", label: t("spotify_mini_align"), value: t("spotify_mini_align_" + (SPOTIFY.mini_align || "classic")), act: function () {
        var choices = ["classic", "right"];
        SPOTIFY.mini_align = choices[(choices.indexOf(SPOTIFY.mini_align || "classic") + 1) % choices.length];
        keep("mini_align", SPOTIFY.mini_align); applySpotifyAlign(); renderNp(); renderShelf();
      } });
      rows.push({ kind: "cycle", key: "spotify-mini-art", label: t("spotify_mini_art"), value: t("spotify_mini_art_" + (SPOTIFY.mini_art || "wide")), act: function () {
        var choices = ["wide", "square"];
        SPOTIFY.mini_art = choices[(choices.indexOf(SPOTIFY.mini_art || "wide") + 1) % choices.length];
        keep("mini_art", SPOTIFY.mini_art); renderNp();
      } });
    } else {
      rows.push({ kind: "cycle", key: "spotify-align", label: t("spotify_align"), value: t("spotify_align_" + (SPOTIFY.align || "classic")), act: function () {
        var choices = ["classic", "center", "dock_center"];
        SPOTIFY.align = choices[(choices.indexOf(SPOTIFY.align || "classic") + 1) % choices.length];
        keep("align", SPOTIFY.align); applySpotifyAlign(); renderGrid(); renderShelf();
      } });
    }
    return rows.concat([
      { kind: "toggle", key: "spotify-show-app", label: t("spotify_show_app"), value: SPOTIFY.show_app !== false ? t("on") : t("off"), act: function () {
        SPOTIFY.show_app = SPOTIFY.show_app === false; keep("show_app", SPOTIFY.show_app); renderNp();
      } },
      { kind: "cycle", key: "spotify-title-mode", label: t("spotify_title_mode"), value: t("spotify_title_" + (SPOTIFY.title_mode || "pingpong")), act: function () {
        var choices = ["dots", "pingpong", "continuous"];
        SPOTIFY.title_mode = choices[(choices.indexOf(SPOTIFY.title_mode || "pingpong") + 1) % choices.length];
        keep("title_mode", SPOTIFY.title_mode); renderNp();
      } },
      { kind: "toggle", key: "spotify-adaptive-tint", label: t("spotify_adaptive_tint"), value: SPOTIFY.adaptive_tint !== false ? t("on") : t("off"), act: function () {
        SPOTIFY.adaptive_tint = SPOTIFY.adaptive_tint === false; keep("adaptive_tint", SPOTIFY.adaptive_tint); renderNp();
      } },
      { kind: "toggle", key: "spotify-sync-colors", label: t("spotify_sync_colors"), value: SPOTIFY.sync_theme_colors ? t("on") : t("off"), act: function () {
        SPOTIFY.sync_theme_colors = !SPOTIFY.sync_theme_colors; keep("sync_theme_colors", SPOTIFY.sync_theme_colors); renderNp();
      } },
      { kind: "toggle", key: "spotify-waveform", label: t("spotify_waveform"), value: SPOTIFY.waveform !== false ? t("on") : t("off"), act: function () {
        SPOTIFY.waveform = SPOTIFY.waveform === false; keep("waveform", SPOTIFY.waveform); renderNp();
      } }
    ]);
  }

  function spotifyRows() {
    var rows = [];
    if (!spotifyWorks()) return rows;   // only where the card can work (spotifyWorks), never a switch that does nothing
    rows.push(head(t("spotify_head")));
    rows.push({
      kind: "toggle",
      key: "spotify-enabled",
      label: t("spotify_enable"),
      value: SPOTIFY.enabled ? t("on") : t("off"),
      act: function () {
        SPOTIFY.enabled = !SPOTIFY.enabled;
        ST.spotify = ST.spotify || {};
        ST.spotify.enabled = SPOTIFY.enabled;
        saveSettings();
        refreshSpotify();
      }
    });

    var hasPerm = false;
    try {
      hasPerm = !!(TV && TV.spotifyHasPermission && TV.spotifyHasPermission());
    } catch (e) {}
    if (!TV.spotifyState) {
      // an older home app with a computer at home: the computer reads the player over ADB, no access needed
    } else if (hasPerm) {
      rows.push(info("spotify-perm", t("spotify_perm_ok")));
    } else if (!OFFLINE && !ON_TV) {
      // a computer at home gives the access when it sets up the TV (apply.sh): no adb line to type
      rows.push(info("spotify-perm", t("spotify_perm_needed")));
    } else {
      rows.push(info("spotify-perm", t("spotify_perm_needed"), "", t("spotify_perm_hint")));
    }

    if (SPOTIFY.enabled) {
      rows.push(head(t("spotify_controls")));
      rows.push({
        kind: "toggle",
        key: "spotify-show-card",
        label: t("spotify_show_card"),
        value: SPOTIFY.show_card ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_card = !SPOTIFY.show_card;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_card = SPOTIFY.show_card;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-controls",
        label: t("spotify_controls"),
        value: SPOTIFY.controls ? t("on") : t("off"),
        act: function () {
          SPOTIFY.controls = !SPOTIFY.controls;
          ST.spotify = ST.spotify || {};
          ST.spotify.controls = SPOTIFY.controls;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-scrub-bar",
        label: t("spotify_scrub_bar"),
        value: SPOTIFY.scrub_bar !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.scrub_bar = SPOTIFY.scrub_bar === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.scrub_bar = SPOTIFY.scrub_bar;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-shuffle-repeat",
        label: t("spotify_shuffle_repeat"),
        value: SPOTIFY.show_shuffle_repeat !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_shuffle_repeat = SPOTIFY.show_shuffle_repeat === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_shuffle_repeat = SPOTIFY.show_shuffle_repeat;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-up-next",
        label: t("spotify_up_next"),
        value: SPOTIFY.show_up_next !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_up_next = SPOTIFY.show_up_next === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_up_next = SPOTIFY.show_up_next;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-jump-app",
        label: t("spotify_jump_app"),
        value: SPOTIFY.show_jump_app !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_jump_app = SPOTIFY.show_jump_app === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_jump_app = SPOTIFY.show_jump_app;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-sleep-timer",
        label: t("spotify_sleep_timer"),
        value: SPOTIFY.show_sleep_timer !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_sleep_timer = SPOTIFY.show_sleep_timer === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_sleep_timer = SPOTIFY.show_sleep_timer;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-audio-output",
        label: t("spotify_audio_output"),
        value: SPOTIFY.show_audio_output !== false ? t("on") : t("off"),
        act: function () {
          SPOTIFY.show_audio_output = SPOTIFY.show_audio_output === false;
          ST.spotify = ST.spotify || {};
          ST.spotify.show_audio_output = SPOTIFY.show_audio_output;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "cycle",
        key: "spotify-seek",
        label: t("spotify_seek"),
        value: SPOTIFY.seek_seconds + "s",
        act: function () {
          var choices = [5, 10, 15, 30];
          var idx = choices.indexOf(SPOTIFY.seek_seconds);
          SPOTIFY.seek_seconds = choices[(idx + 1) % choices.length];
          ST.spotify = ST.spotify || {};
          ST.spotify.seek_seconds = SPOTIFY.seek_seconds;
          saveSettings();
          renderNp();
        }
      });
      rows.push({
        kind: "toggle",
        key: "spotify-hide-idle",
        label: t("spotify_hide_idle"),
        value: SPOTIFY.hide_idle ? t("on") : t("off"),
        act: function () {
          SPOTIFY.hide_idle = !SPOTIFY.hide_idle;
          ST.spotify = ST.spotify || {};
          ST.spotify.hide_idle = SPOTIFY.hide_idle;
          saveSettings();
          renderNp();
        }
      });
    }
    rows.push(info("spotify-note", t("spotify_note")));
    return rows;
  }

  function appsRows() {
    var arr = arrangeItems(), rows = [];
    var hidden = data.apps.filter(function (a) { return HIDDEN_TV.indexOf(a.package) >= 0; });
    if (!arr.items.length && !hidden.length) return [info("apps-none", t("apps_none"))];
    var row = function (it, where) {
      return { kind: "item", key: "app:" + it.package, label: it.name, value: t(where), icon: it.package,
        act: function () { cycleApp(it.package); },
        move: where === "app_hidden" ? null : function (d) { moveAppRow(it.package, d); } };
    };
    rows.push(head(t("apps_home", { n: arr.line, max: DOCK_APPS })));
    arr.items.slice(0, arr.line).forEach(function (it) { rows.push(row(it, "app_on_home")); });
    rows.push(head(t("apps_more")));
    arr.items.slice(arr.line).forEach(function (it) { rows.push(row(it, "app_in_more")); });
    if (hidden.length) {
      rows.push(head(t("apps_hidden")));
      hidden.forEach(function (a) { rows.push(row(a, "app_hidden")); });
    }
    rows.push(info("apps-note", t("apps_note")));
    if (!NIGHT) rows.push(info("apps-classic", t("apps_classic")));
    return rows;
  }
  function setHidden(list) { HIDDEN_TV = list; ST.hidden_apps = list.slice(); saveSettings(); }
  // OK on an app: home, then More apps, then hidden, then back on home (a screen skips hidden).
  function cycleApp(pkg) {
    var h = HIDDEN_TV.indexOf(pkg);
    if (h >= 0) {
      setHidden(HIDDEN_TV.filter(function (p) { return p !== pkg; }));
      materialise();
      appToHome(pkg);
    } else {
      var o = materialise() && data.order, i = o.packages.indexOf(pkg);
      if (i < 0) return;
      if (i < o.line) { o.packages.splice(i, 1); o.line -= 1; o.packages.splice(o.line, 0, pkg); persistOrder(); }
      else if (pkg.indexOf("screen:") === 0) appToHome(pkg);
      else { o.packages.splice(i, 1); setHidden(HIDDEN_TV.concat([pkg])); persistOrder(); }
    }
    SET.dirty = true;
    renderGrid();
  }
  // To the end of the dock; a full dock sends its last app behind More apps (as holding OK does).
  function appToHome(pkg) {
    var o = data.order, i = o.packages.indexOf(pkg);
    if (i >= 0) o.packages.splice(i, 1);
    if (o.line < DOCK_APPS) { o.packages.splice(o.line, 0, pkg); o.line += 1; }
    else {
      o.packages.splice(o.line - 1, 0, pkg);
      SET.msg = t("moved_more", { name: nameOf(o.packages[o.line]) });
    }
    persistOrder();
  }
  // Up and down while an app is picked up; across the line moves it between home and More apps.
  function moveAppRow(pkg, d) {
    var o = data.order, i = o.packages.indexOf(pkg), j = i + d;
    if (i < 0) return;
    var swap = function (a, b) { var x = o.packages[a]; o.packages[a] = o.packages[b]; o.packages[b] = x; };
    if (d > 0 && i === o.line - 1) o.line -= 1;
    else if (d < 0 && i === o.line) { if (o.line < DOCK_APPS) o.line += 1; else swap(i, i - 1); }
    else if (j >= 0 && j < o.packages.length) swap(i, j);
    renderGrid();
  }

  // ---- people: the same list the phone's People sheet edits ----
  function peopleRows() {
    var list = NOBODY ? [] : PEOPLE, rows = [];
    if (!list.length) rows.push(info("people-none", t("people_none")));
    list.forEach(function (p) {
      var subs = [];
      if (p.id === who && list.length > 1) subs.push(t("person_on"));
      if (p.src === "account") subs.push(t("from_account"));
      rows.push({ kind: "nav", key: "person:" + p.id, label: p.name, avatar: p, sub: subs.join(". "),
        act: function () { openPerson(p.id); }, move: function (d) { movePerson(p.id, d); } });
    });
    if (list.some(function (p) { return p.src === "account"; })) {
      rows.push(info("people-account", t("people_account_note")));
      rows.push({ kind: "action", key: "people-account-clear", label: t("people_account_clear"), danger: true, act: clearAccountHome });
    }
    if (list.length < 12) {
      rows.push({ kind: "input", key: "people-add", label: t("people_add"), act: function () {
        startTyping({ label: t("people_type"), value: "", submit: addPerson });
      } });
    } else rows.push(info("people-full", t("people_full")));
    rows.push(info("people-note", t("people_note")));
    return rows;
  }
  function personById(id) { return NOBODY ? null : PEOPLE.filter(function (p) { return p.id === id; })[0] || null; }
  function openPerson(id) {
    SET.sub = { back: "person:" + id, crumb: t("sec_people"),
      title: function () { var p = personById(id); return p ? p.name : ""; },
      rows: function () {
        var p = personById(id);
        if (!p) return [];
        return [
          { kind: "input", key: "p-name", label: t("person_name"), value: p.name, act: function () {
            startTyping({ label: t("person_rename_type"), value: p.name, submit: function (v) { renamePerson(id, v); } });
          } },
          { kind: "action", key: "p-remove", label: t("person_remove", { name: p.name }), danger: true, act: function () { removePerson(id); } }
        ];
      } };
    SET.keyFocus = "p-name";
  }
  function cleanName(v) { return String(v || "").replace(/\s+/g, " ").trim().slice(0, 40); }
  function newPersonId(name, list) {
    var base = name.toLowerCase();
    try { base = base.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "person";
    if (["both", "all", "everyone", "shared", "together"].indexOf(base) >= 0) base += "-1";
    var id = base, n = 2;
    while (list.some(function (p) { return p.id.toLowerCase() === id; })) id = base + "-" + n++;
    return id;
  }
  // Kept on this TV (pending) and handed to the bridge, which keeps it in bridge/data/people.json.
  function savePeopleList() {
    var list = NOBODY ? [] : PEOPLE.map(function (p) {
      var o = { id: p.id, name: p.name };
      ["colour", "kid", "guest", "src"].forEach(function (k) { if (p[k] != null) o[k] = p[k]; });
      return o;
    });
    keep("tvhome.people.list", { people: list, pending: true });
    keep("tvhome.people.order", { ids: list.map(function (p) { return p.id; }), pending: false });
    SET.dirty = true;
    renderShelf();
    if (OFFLINE || data.bridge === false) return;
    api("POST", "/api/people", { people: list })
      .then(function (r) { keep("tvhome.people.list", { people: r.people || list, pending: false }); }, function () {});
  }
  function addPerson(v) {
    var name = cleanName(v), list = NOBODY ? [] : PEOPLE.slice();
    if (!name) return;
    if (list.length >= 12) { SET.msg = t("people_full"); return; }
    var id = newPersonId(name, list);
    list.push({ id: id, name: name });
    setPeople(list);
    savePeopleList();
    SET.keyFocus = "person:" + id;
  }
  function renamePerson(id, v) {
    var name = cleanName(v), p = personById(id);
    if (!name || !p) return;
    p.name = name;
    savePeopleList();
  }
  function removePerson(id) {
    if (NOBODY) return;
    setPeople(PEOPLE.filter(function (p) { return p.id !== id; }));
    savePeopleList();
    SET.sub = null;
    SET.keyFocus = "people-add";
  }
  function movePerson(id, d) {
    if (NOBODY) return;
    var i = PEOPLE.map(function (p) { return p.id; }).indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= PEOPLE.length) return;
    var x = PEOPLE[i]; PEOPLE[i] = PEOPLE[j]; PEOPLE[j] = x;
    renderPeople();
  }

  // ---- quick buttons ----
  function quickRows() {
    var on = QUICK.slice(), order = on.concat(QUICK_ALL.filter(function (q) { return on.indexOf(q) < 0; }));
    var rows = order.map(function (q) {
      var enabled = on.indexOf(q) >= 0;
      return { kind: "check", key: "quick:" + q, label: t("quick_" + q), checked: enabled, sub: quickNeeds(q),
        act: function () { toggleQuick(q); }, move: enabled ? function (d) { moveQuick(q, d); } : null };
    });
    rows.push(info("quick-note", t("quick_note")));
    return rows;
  }
  function quickNeeds(q) {
    if (q === "sleep" && OFFLINE && !nativeSleep()) return t("quick_needs_bridge");
    if (q === "picture" && (OFFLINE || !picShown)) return t("quick_needs_picture");
    if (q === "headphones" && OFFLINE && !(TV && TV.openSettingsScreen)) return t("quick_needs_bridge");
    if (q === "input" && OFFLINE && !nativeInputs()) return t("quick_needs_inputs");
    if (q === "screensaver") return nativeScreensaver() ? t("quick_screensaver_sub") : t("quick_needs_tv_app");
    if ((q === "bluetooth" || q === "network") && !nativeSettingsScreen() && (!ON_TV || OFFLINE)) return t("quick_needs_tv_app");
    if (q === "tvsettings" && OFFLINE && !(TV && (TV.launch || TV.openSettings))) return t("quick_needs_bridge");
    if (q === "extend" && !devCan()) return t("quick_needs_devmode");
    return "";
  }
  function setQuick(list) { QUICK = list; ST.quick = list.slice(); saveSettings(); renderQuick(); }
  function toggleQuick(q) {
    var had = QUICK.indexOf(q) >= 0;
    setQuick(had ? QUICK.filter(function (x) { return x !== q; }) : QUICK.concat([q]));
    if (!had && !OFFLINE) refreshQuick().then(function () { if (zone === "settings") renderSettings(); });
  }
  function moveQuick(q, d) {
    var l = QUICK.slice(), i = l.indexOf(q), j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return;
    l[i] = l[j]; l[j] = q;
    setQuick(l);
  }

  // ---- about ----
  function aboutRows() {
    var ver = "";
    try { ver = TV && TV.version ? TV.version() : ""; } catch (e) {}
    // the on-TV app (couch-tv-ontv.apk, put on with just a phone) serves this page from the TV itself:
    // there is no computer, so it never says "With the computer" (a TCL beginner test, 19 Nov 2026)
    var run = ALONE || ON_TV ? "run_alone" : OFFLINE ? "run_off" : data.bridge === false ? "run_quiet" : "run_bridge";
    var hs = homeState(), homeRows = [];
    if (hs === "ask") homeRows.push({ kind: "action", key: "make-home", label: t("home_row"), sub: t("home_row_sub"), act: requestHome });
    else if (hs === "google_tv") homeRows.push(info("make-home", t("home_row"), "", t("home_google_tv")));
    var u = updRead();
    if (u && u.supported) homeRows.push({ kind: "action", key: "upd-about", label: UPD_ROW, sub: updLine(u), act: openUpdate });
    homeRows = homeRows.concat(hkRows());
    return homeRows.concat([
      info("ver", t("about_version"), ver || t("about_web")),
      info("code", t("about_code"), REPO_URL),
      info("run", t("about_running"), t(run)),
      info("kept", t("about_kept"), t(OFFLINE || ON_TV || data.bridge === false ? "kept_tv" : "kept_both")),
      { kind: "action", key: "restart", label: t("about_restart"), sub: t("about_restart_sub"), act: restartHome },
      { kind: "action", key: "reset", label: t("about_reset"), sub: t("about_reset_sub"), danger: true, confirmText: t("confirm_reset"),
        act: resetSettings }
    ]);
  }
  // About, Restart home: the launcher starts a new page and looks for the bridge again, as a
  // force-stop would. Anywhere else (a browser, the on-TV app, an older launcher) the page reloads.
  function restartHome() {
    try { if (TV && TV.restartHome) { TV.restartHome(); return; } } catch (e) {}
    restart();
  }
  // ---- updates: couch-tv's own GitHub releases (the launcher's Updater.kt) ----
  // The launcher looks once a day while the home is on screen (switch below); "Check now" looks
  // straight away. A newer release puts a dot on the gear tile and says so on the home once.
  // Installing always goes through Android's own "update this app?" screen, and keeps every
  // setting. No launcher behind the page (a browser, a Samsung, the on-TV app, an older launcher):
  // no Updates section at all. mock.js stands in for previews (?update=1).
  var UPD = null;
  function upd() { return window.TVUP || window.MOCK_UPDATER || null; }
  function updRead() {
    var u = upd();
    UPD = null;
    try { if (u) UPD = JSON.parse(u.state()); } catch (e) {}
    return UPD;
  }
  // A newer release is out: one this TV can install, or one a copy built on another computer can't
  // take (refused), which still gets the dot and the line so the household hears about it.
  function updReady() { return !!(UPD && (UPD.available || UPD.refused)); }
  // the launcher's news: a check finished, a download moved on, the installer answered
  function updChanged(s) {
    var was = updReady();
    UPD = s && typeof s === "object" ? s : updRead();
    if (zone === "settings") renderSettings();
    else if (updReady() !== was) renderGrid();
    updTell();
  }
  // Once per release, a line on the home; the gear tile's dot stays until it is installed.
  function updTell() {
    if (!updReady() || kept("tvhome.update.told") === UPD.latest) return;
    keep("tvhome.update.told", UPD.latest);
    status(t("upd_told", { v: UPD.latest, c: UPD.current || "" }));
  }
  // Asked once: tell the household about new versions, or leave it to "Check for updates now"? Until
  // they answer nothing is checked by itself, so frequent releases never nag anyone who did not ask.
  // The setup's answer (home.updates in config.json) counts as the answer; Back counts as No.
  var ai = 0;
  // Which question is on screen: "upd" (new versions, once), "home" (make couch-tv the home, once)
  // or "dev" (extend Developer Mode, weekly).
  var askKind = "upd";
  // The first-run welcome is a new TV's first question. The update question never comes over it, nor straight
  // after it (on a TCL it popped up over the home about 5 s after the first open): it waits for a calm later
  // moment, the next time the home comes back to the front (or the next start). welcomeSeen: the welcome was
  // up in this start; updLater: the question is waiting for that moment.
  var welcomeSeen = false, updLater = false;
  function updAsk() {
    askKind = "upd";
    if (!UPD || !UPD.supported || UPD.answered || kidsOn()) return;
    if (HOME.updates === "notify" || HOME.updates === "manual") { upd().auto(HOME.updates === "notify"); return; }
    if (welcomeSeen || zone === "welcome" || kept(WELCOME_KEY) === "ask" || welcomeJustAnswered()) { updLater = true; return; }
    if (zone !== "grid" && zone !== "shelf" && zone !== "people" && zone !== "quick") return;
    // never behind "Use this design?" or any other sheet on the home: it waits for the sheet to go
    if (updSheetUp()) { updLater = true; updFront(); return; }
    askKind = "upd";
    zone = "updask"; ai = 0;
    clearFocus();
    renderAsk();
  }
  // Something on top of the home: a design's "Use this design?", its widget sheets and details, Share this
  // home, the Ask AI sheet, Home settings, or a question already up (the gear pop up).
  function updSheetUp() {
    var CD = typeof CouchDesign !== "undefined" ? CouchDesign : null;
    try {
      if (CD && CD.asking && CD.asking()) return true;
      if (CD && CD.nav && CD.nav.sheetOpen && CD.nav.sheetOpen()) return true;
      if (window.CouchDetail && window.CouchDetail.isOpen && window.CouchDetail.isOpen()) return true;
      if (typeof CouchShare !== "undefined" && CouchShare.isOpen && CouchShare.isOpen()) return true;
      if (window.CouchAsk && window.CouchAsk.isOpen && window.CouchAsk.isOpen()) return true;
    } catch (e) { return true; }
    if (zone === "makeit") return true;
    var s = $("settings"), w = $("welcome"), g = $("gear-pop");
    return !!((s && s.classList.contains("on")) || (w && w.classList.contains("on")) || (g && g.classList.contains("on")));
  }
  // the home is back in front after the welcome's start: ask then, once the person is on the home (not in
  // Home settings, a menu or a sheet), after a short calm moment
  function updAskLater() {
    updWait = 0;
    if (!updLater || document.hidden || PAGE_PAUSED || kept(WELCOME_KEY) === "ask") return;
    if ((zone !== "grid" && zone !== "shelf" && zone !== "people" && zone !== "quick") || updSheetUp()) {
      updWait = setTimeout(updAskLater, 3000);   // still waiting: asked once the home is clear
      return;
    }
    updLater = false; welcomeSeen = false;
    keep(WELCOME_AT_KEY, 0);   // the calm moment came: the time the welcome was answered no longer holds it back
    updRead();
    updAsk();
  }
  // The home came to the front. On an Android TV that is the launcher's tv.resume() (back from an app) or
  // tv.home() (Home pressed with the home already in front, no visibility change at all: the emulator test of
  // 0.13.10 never got the question back), and the page's own visibilitychange elsewhere. Only those: a tv.resume()
  // with no tv.pause() before it is the on-TV app redrawing after a phone or setup save (HomeActivity.refresh), and
  // a phone save right after the welcome must not bring the question up.
  var updWait = 0;
  function updFront() {
    if (!updLater) return;
    if (updWait) clearTimeout(updWait);
    updWait = setTimeout(updAskLater, 2500);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) updFront(); });
  function askRows() {
    if (askKind === "dev") {
      return [[ICONS.devmode, t("dev_ask_yes"), t("dev_ask_yes_sub")], [ICONS.sliders, t("dev_ask_no"), t("dev_ask_no_sub")]];
    }
    if (askKind === "home") {
      return [[ICONS.apps, t("home_ask_yes"), t("home_ask_yes_sub")], [ICONS.sliders, t("home_ask_no"), t("home_ask_no_sub")]];
    }
    return [[ICONS.download, t("upd_ask_yes"), t("upd_ask_yes_sub")], [ICONS.sliders, t("upd_ask_no"), t("upd_ask_no_sub")]];
  }
  function askHead() {
    if (askKind === "dev") return ["dev_ask", "dev_ask_sub"];
    if (askKind === "home") return ["home_ask", "home_ask_sub"];
    return ["upd_ask", "upd_ask_sub"];
  }
  function renderAsk() {
    var pop = $("gear-pop");
    var head = askHead();
    var items = askRows();
    pop.innerHTML = '<div class="ask-h"><b>' + esc(t(head[0])) + "</b><small>" + esc(t(head[1])) + "</small></div>" +
      items.map(function (it, i) {
        return '<div class="grow' + (i === ai ? " focus" : "") + '" role="menuitem"><i>' + it[0] + "</i><span><b>" +
          esc(it[1]) + "</b><small>" + esc(it[2]) + "</small></span></div>";
      }).join("");
    pop.style.left = pop.style.top = "";
    pop.classList.add("on", "ask");
    document.documentElement.classList.add("gearing");
  }
  function answerAsk(yes) {
    $("gear-pop").classList.remove("on", "ask");
    document.documentElement.classList.remove("gearing");
    zone = "grid";
    if (askKind === "home") {
      keep("tvhome.home.asked", 1);
      startFocus();
      paintFocus();
      if (yes) requestHome();
      return;
    }
    if (askKind === "dev") {
      keep("tvhome.devmode.asked", String(Date.now()));
      startFocus();
      paintFocus();
      if (yes) devExtend();
      else status(t("dev_ask_no_done"));
      return;
    }
    upd().auto(yes);
    startFocus();
    paintFocus();
    status(t("upd_ask_done"));
  }
  // ---- making couch-tv the home with no computer (issue #98) ----
  // Plain Android TV 10+ lets an app ask Android to make it the home (the launcher's HomeRole.kt
  // opens the system's own chooser). Asked once, and again any time from Home settings, About.
  // Google TV can keep its own launcher on the Home key, so there the row explains the Home
  // button watch instead. Nothing here shows when couch-tv already is the home.
  function homeState() {
    try { return TV && TV.homeState ? String(TV.homeState()) : "held"; } catch (e) { return "held"; }
  }
  function requestHome() {
    try { if (TV && TV.requestHome) TV.requestHome(); } catch (e) {}
  }
  function homeAsk() {
    if (kept("tvhome.home.asked") || kidsOn()) return;
    if (zone !== "grid" && zone !== "shelf" && zone !== "people" && zone !== "quick") return;
    if (homeState() !== "ask") return;
    askKind = "home"; zone = "updask"; ai = 0;
    clearFocus();
    renderAsk();
  }
  function homeAnswered(held) {
    if (zone === "settings") renderSettings();
    status(t(held ? "home_now" : "home_not_yet"));
  }
  // ---- the first-run welcome (owner's TCL test of 0.13.9, 23 Nov 2026) ----
  // Most people come from Couch TV Studio's website with a design picked and a short code to type. The
  // home used to open on the standard home, and the code was three screens deep (Home settings, Designs,
  // Get a design). Now a TV that was never set up opens on one full screen question: I have a design
  // code (straight to the same Get a design typing box) or Use Couch Original (the standard home, as it
  // always was). Back counts as Couch Original. Once answered it never comes back.
  // "tvhome.welcome": "ask" while it is due, else what closed it ("code", "original", "settings"), or
  // "set" for a TV that was already set up when this version first ran (an update never shows it).
  var WELCOME_KEY = "tvhome.welcome", STUDIO_SITE = "couchtv.joshuaseage.com", wi = 0;
  // When the welcome was answered (ms). A design code applied from it starts the home again (design.js reloads
  // the page), and that new start has no welcomeSeen: without this the update question came up behind "Use this
  // design?" (the TCL, 23 Nov 2026). For WELCOME_CALM_MS after the answer a start keeps the question back until
  // the home comes to the front again (updAskLater), which then clears it.
  var WELCOME_AT_KEY = "tvhome.welcome.at", WELCOME_CALM_MS = 30 * 60 * 1000;
  function welcomeJustAnswered() {
    var at = +kept(WELCOME_AT_KEY) || 0;
    return at > 0 && Date.now() - at < WELCOME_CALM_MS;
  }
  // A TV nobody has set up: the launcher's own copy with no computer (option A) or the on-TV app
  // (option C), with nothing chosen or kept on it yet. Worked out before readConfig(), so nothing the
  // first start keeps by itself (Lighter home, the apps it has seen) is taken for a setup.
  function welcomeFresh() {
    var cfg = window.COUCH_CONFIG || {};
    // previews (?mock, ?preview) never show it unless asked with ?firstrun=1
    if ((MOCK || PREVIEW) && !/[?&]firstrun=1\b/.test(Q)) return false;
    // a home computer (bridge) set this TV up, or a design is being previewed
    if (!(ALONE || cfg.mode === "on-tv") || /[?&]designer=1\b/.test(Q)) return false;
    // nowhere to get a design ("design_store": "" in config.json): nothing to offer
    if (typeof CouchDesignCode === "undefined" || !CouchDesignCode.base()) return false;
    // a design kept, asked about or switched on or off; one in config.json
    if (CouchDesignCode.kept() || (cfg.design && typeof cfg.design === "object")) return false;
    if (typeof CouchDesigner !== "undefined" && kept(CouchDesigner.KEY)) return false;
    try { if (localStorage.getItem("couchtv.design.ok") || localStorage.getItem("couchtv.design.no")) return false; } catch (e) {}
    // people named at setup (not the two placeholders every new home has)
    var ppl = Array.isArray(cfg.people) ? cfg.people : [];
    if (ppl.some(function (p) { return !p || !/^person[12]$/.test(p.id) || !/^Person [12]$/.test(p.name); })) return false;
    // anything an earlier start of this home kept: its apps, the first-run questions, Home settings
    var r = kept(ST_KEY);
    if (r && r.s && typeof r.s === "object" && Object.keys(r.s).length) return false;
    return !["tvhome.apps.seen", "tvhome.home.asked", "tvhome.update.told", "tvhome.update.done", "tvhome.look", "tvhome.order.tv",
      "tvhome.people.list", "tvhome.people.order", "tvhome.devmode.asked"].some(function (k) { return kept(k) != null; });
  }
  // what this start does: show it (true) or not. Kept the first time, so it is decided once per TV.
  function welcomeDue(fresh) {
    var w = kept(WELCOME_KEY);
    if (w === "ask") return !kidsOn();
    if (w) return false;
    keep(WELCOME_KEY, fresh ? "ask" : "set");
    return fresh && !kidsOn();
  }
  function welcomeStart(fresh) {
    var wk = kept(WELCOME_KEY);
    if (makeitLinked() && !kidsOn() && ((wk == null && fresh) || wk === "ask")) { welcomeLinked(); return; }   // linked: the card, not the welcome
    if (!welcomeDue(fresh)) return;
    zone = "welcome"; wi = 0; welcomeSeen = true;
    clearFocus();
    var el = $("welcome");
    if (!el) return;
    if (!el.getAttribute("data-wired")) {
      el.setAttribute("data-wired", "1");
      // a pointer (LG's Magic Remote): a click is OK on that choice
      el.addEventListener("click", function (e) {
        var c = e.target && e.target.closest ? e.target.closest("[data-wpick]") : null;
        if (!c) return;
        e.preventDefault(); e.stopPropagation();
        welcomeChoose(+c.getAttribute("data-wpick"));
      });
    }
    $("welcome-title").textContent = t("welcome_title");
    $("welcome-sub").textContent = t("welcome_sub");
    $("welcome-studio-text").textContent = t("welcome_studio", { site: STUDIO_SITE });
    var qr = $("welcome-qr");
    qr.innerHTML = "";
    try { qr.appendChild(window.TVQR.svg("https://" + STUDIO_SITE, 160)); } catch (e) { qr.style.display = "none"; }
    el.classList.add("on");
    document.documentElement.classList.add("welcoming");
    renderWelcome();
  }
  function renderWelcome() {
    var items = [[ICONS.designer, t("welcome_code"), t("welcome_code_sub")], [ICONS.apps, t("welcome_original"), t("welcome_original_sub")]];
    $("welcome-picks").innerHTML = items.map(function (it, i) {
      return '<div class="wpick' + (i === wi ? " focus" : "") + '" role="button" data-wpick="' + i + '"><i>' + it[0] + "</i><b>" +
        esc(it[1]) + "</b><small>" + esc(it[2]) + "</small></div>";
    }).join("");
  }
  function welcomeKey(e) {
    e.preventDefault();
    if (e.repeat && isOk(e)) return;
    var arrow = arrowOf(e);
    if (arrow) {
      var d = arrow[0] || arrow[1];
      if (arrow[0] && document.documentElement.dir === "rtl") d = -d;
      var n = d > 0 ? 1 : 0;
      if (n !== wi) { wi = n; blip(arrow[0], arrow[1]); renderWelcome(); }
      return;
    }
    if (isOk(e)) { welcomeChoose(wi); return; }
    if (isBack(e)) { welcomeChoose(1); return; }   // Back keeps Couch Original
    if (isSettings(e) && !e.repeat) settingsKey();
  }
  function welcomeClose(how) {
    keep(WELCOME_KEY, how);
    keep(WELCOME_AT_KEY, Date.now());
    var el = $("welcome");
    if (el) el.classList.remove("on");
    document.documentElement.classList.remove("welcoming");
    zone = "grid";
  }
  function welcomeChoose(i) {
    if (zone !== "welcome") return;
    if (i === 0) {
      // the same Get a design typing box as Home settings, Designs (and Back there shows Get a
      // design from your phone right under it)
      welcomeClose("code");
      openSettings();
      var at = secsNow().map(function (sc) { return sc[0]; }).indexOf("designer");
      if (at >= 0) SET.sec = at;
      SET.col = "rows"; SET.keyFocus = "design-get"; SET.ri = 0;
      typeDesignCode("");
      return;
    }
    welcomeClose("original");
    startFocus();
    paintFocus();
    if (makeitLinked()) makeitDue();   // linked and staying on Couch Original: the Make it yours card (an unlinked TV has the welcome's QR)
    // the one other first-run question (make Couch TV the home), now the welcome is answered
    setTimeout(homeAsk, 800);
  }
  // ---- the first-run "Make it yours" card (owner approved, 25 Nov 2026) ----
  // A new TV that Couch TV Setup linked to an account, and that is still on Couch Original, is shown one
  // card, once, on a calm moment (about 3 s after the home is clear): it takes the place of the welcome, so nobody
  // sees two similar cards. A TV that is not linked keeps the welcome (with its own QR) and no card; linked later
  // while still on Couch Original with no design, it gets the card then, once. The welcome on screen when the link
  // arrives is replaced by it. The card is: a QR code and an address to design its own screen on a phone. Never on an
  // update (only the welcome's answer in this version makes it due), never once a design or home pack is here,
  // in a guest's or kids profile, in setup or while a question or sheet is up, over an app or the screensaver.
  // Back (or OK) closes it for good; Home settings, Designs, Make it yours shows the same card again.
  // The card is built only when it is shown and taken out of the page when it closes, so a TV that never
  // shows it pays for none of it. No blur, no animation. The QR is drawn here (qr.js): it carries the address
  // below and nothing else, no code, token, device id or any personal data.
  // The address is this one constant. Its /go page must send someone signed in with a linked TV to
  // the editor (/design/) and everyone else to /get/ before a release that shows this card (coord notes).
  var MAKEIT_URL = "https://couchtv.joshuaseage.com/go";
  var MAKEIT_KEY = "tvhome.makeit";   // "due" until it is shown, then "done"
  var MAKEIT_CALM = (MOCK || PREVIEW) && /[?&]makeitcalm=(\d+)/.test(Q) ? +RegExp.$1 : 3000;   // the wait for a calm home
  var MAKEIT_AWAY = 180000;   // nobody pressed anything: it goes by itself, so the remote is never held
  var makeitWait = 0, makeitAway = 0, makeitPrev = null;
  function makeitDue() {
    keep(MAKEIT_KEY, "due");
    makeitSchedule(MAKEIT_CALM);
  }
  // this TV is linked to an account by Couch TV Setup (a ?mock preview says so with ?linked=1 or mock:linked)
  function makeitLinked() {
    if (MOCK || PREVIEW) { try { return /[?&]linked=1\b/.test(Q) || localStorage.getItem("mock:linked") === "1"; } catch (e) { return false; } }
    return typeof CouchDesignCode !== "undefined" && !!CouchDesignCode.linked && CouchDesignCode.linked();
  }
  // a fresh linked TV: the welcome question is skipped and the card comes in its place. The update question waits
  // for a calm moment after it, as it does after the welcome.
  function welcomeLinked() {
    keep(WELCOME_KEY, "linked");
    keep(WELCOME_AT_KEY, Date.now());
    welcomeSeen = true;
    if (kept(MAKEIT_KEY) == null && !makeitDesigned()) makeitDue();   // never again once it has been shown
  }
  // Setup's link (or its design code) arrived while the home was open
  function makeitLinkArrived() {
    if (!makeitLinked()) return;
    var designed = makeitDesigned();
    if (zone === "welcome") {   // the welcome is on screen: the card replaces it (or, with a design code on its way, nothing does)
      welcomeClose(designed ? "code" : "linked");
      startFocus(); paintFocus();
      if (!designed) makeitDue();
      return;
    }
    if (kept(WELCOME_KEY) === "original" && kept(MAKEIT_KEY) == null && !designed && !kidsOn()) makeitDue();
  }
  function makeitSchedule(ms) {
    if (makeitWait) clearTimeout(makeitWait);
    makeitWait = kept(MAKEIT_KEY) === "due" ? setTimeout(makeitTry, ms) : 0;
  }
  // a design or home pack arrived: the TV is no longer on Couch Original
  function makeitDesigned() {
    var cfg = window.COUCH_CONFIG || {};
    if (cfg.design && typeof cfg.design === "object") return true;
    try { if (localStorage.getItem("couchtv.design.ok") || localStorage.getItem("couchtv.design.no")) return true; } catch (e) {}
    if (typeof CouchDesigner !== "undefined" && kept(CouchDesigner.KEY)) return true;
    // a design code Setup brought is waiting to be got: the design is on its way
    try { if (MOCK || PREVIEW ? /[?&]setupcode=1\b/.test(Q) : TV && TV.setupDesignCode && TV.setupDesignCode()) return true; } catch (e) {}
    if (typeof CouchDesignCode !== "undefined") {
      try { if (CouchDesignCode.kept() || (CouchDesignCode.takeHome && CouchDesignCode.takeHome(true))) return true; } catch (e) {}
    }
    return !!(ACCOUNT || keptAccount());
  }
  function makeitTry() {
    makeitWait = 0;
    if (kept(MAKEIT_KEY) !== "due") return;
    if (makeitDesigned()) { keep(MAKEIT_KEY, "done"); return; }
    if (kidsOn() || guestOn()) return;   // asked again if the profile changes and the home comes to the front
    if (document.hidden || PAGE_PAUSED || screenOffActive || idleAmbientActive) return;   // the front again: makeitSchedule
    // not on the home yet (a question, a sheet, Home settings, setup): look again soon
    if ((zone !== "grid" && zone !== "shelf" && zone !== "people" && zone !== "quick") || updSheetUp() ||
      (homeState() === "ask" && !kept("tvhome.home.asked"))) { makeitSchedule(10000); return; }
    makeitOpen(false);
  }
  function makeitUp() { return zone === "makeit"; }
  function makeitOpen(manual) {
    if (zone === "makeit" || !window.TVQR) return;
    makeitPrev = { zone: zone, s: s, g: g };
    if (!manual) keep(MAKEIT_KEY, "done");   // shown once
    zone = "makeit";
    clearFocus();
    var el = document.createElement("div");
    el.id = "makeit"; el.className = "makeit";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "makeit-title");
    var shown = MAKEIT_URL.replace(/^https:\/\//, "");
    el.innerHTML = '<div class="mk-card"><div class="mk-text"><div class="mk-brand" aria-hidden="true"><img src="couchtv-logo.svg" alt="" width="66" height="66"><span>Couch TV</span></div>' +
      '<h1 class="mk-title" id="makeit-title">' + esc(t("makeit_title")) + '</h1><p class="mk-sub">' + esc(t("makeit_sub")) + '</p>' +
      '<p class="mk-url" id="makeit-url">' + esc(shown) + '</p><p class="mk-hint">' + esc(t("makeit_back")) + '</p></div>' +
      '<div class="mk-scan"><span class="mk-qr" id="makeit-qr"></span><p>' + esc(t("makeit_scan")) + '</p></div></div>';
    try { el.querySelector("#makeit-qr").appendChild(window.TVQR.svg(MAKEIT_URL, 440)); } catch (e) { el.querySelector(".mk-scan").style.display = "none"; }
    el.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); makeitClose(); });
    document.body.appendChild(el);
    if (makeitAway) clearTimeout(makeitAway);
    makeitAway = setTimeout(makeitClose, MAKEIT_AWAY);
    makeitWindowStart();
  }
  function makeitClose() {
    if (zone !== "makeit") return;
    if (makeitAway) { clearTimeout(makeitAway); makeitAway = 0; }
    makeitWindowStop();
    var el = $("makeit");
    if (el && el.parentNode) el.parentNode.removeChild(el);   // out of the page, nothing left behind
    var p = makeitPrev; makeitPrev = null;
    if (p && (p.zone === "grid" || p.zone === "shelf" || p.zone === "people" || p.zone === "quick")) { zone = p.zone; s = p.s; g = p.g; paintFocus(); }
    else { zone = "grid"; startFocus(); paintFocus(); }
  }
  // ---- the look for a design while the Make it yours card is open (owner, 25 Nov 2026) ----
  // The TV asks the account's inbox only when someone expects a design. While the card is open and in front, on a
  // linked TV, it looks every 20 s, at most 45 looks (15 minutes) in the whole life of the TV: the count is kept, so a
  // restart, or the card shown again from Home settings, goes on from what is left and never starts over. It stops the
  // moment a design arrives, the card closes (Back, OK, Home, Settings, a pointer click, an app, the screensaver, screen
  // off, sleep), the page is hidden, or the TV goes offline; it comes on again only while the card is still open and
  // in front. A TV that is not linked asks nothing. If Setup links the TV while the card is open (the app's start
  // from Setup with the link calls tv.setupDesign), it starts then. A look that fails (no internet, a busy server) waits twice as long
  // each time, up to 160 s, and still counts. A 429 (the app answers "wait") ends the window for good.
  // Nothing else in the home starts a look: the Home key, opening the home and the weekly look are as they were.
  var MAKEIT_CHK = "tvhome.makeit.looks", MAKEIT_MAX = 45;
  var MAKEIT_EVERY = (MOCK || PREVIEW) && /[?&]makeitevery=(\d+)/.test(Q) ? +RegExp.$1 : 20000;
  var makeitTick = 0, makeitBack = 0;
  function makeitLooks() { var n = +kept(MAKEIT_CHK); return n > 0 ? Math.min(n, MAKEIT_MAX) : 0; }
  function makeitWindowOk() {
    return zone === "makeit" && !document.hidden && !PAGE_PAUSED && !screenOffActive && !idleAmbientActive &&
      navigator.onLine !== false && makeitLooks() < MAKEIT_MAX && inboxCan() && Date.now() >= inboxTime("wait");
  }
  function makeitWindowStop() { if (makeitTick) clearTimeout(makeitTick); makeitTick = 0; makeitBack = 0; }
  function makeitWindowStart() {
    if (makeitTick || !makeitWindowOk()) return;
    makeitBack = 0;
    makeitTick = setTimeout(makeitCheck, MAKEIT_EVERY);
    // a linked TV keeps the card up for the whole window (the same 3 minutes as before when it is not linked)
    if (makeitAway) { clearTimeout(makeitAway); makeitAway = setTimeout(makeitClose, (MAKEIT_MAX - makeitLooks()) * MAKEIT_EVERY + 60000); }
  }
  function makeitCheck() {
    makeitTick = 0;
    if (!makeitWindowOk()) return;
    keep(MAKEIT_CHK, makeitLooks() + 1);   // counted before the look, so a crash cannot give extra looks
    var asked = inboxAsk("card");
    if (!asked) makeitBack = Math.min(makeitBack + 1, 3);
    if (makeitLooks() < MAKEIT_MAX) makeitTick = setTimeout(makeitCheck, MAKEIT_EVERY * Math.pow(2, makeitBack));
  }
  // the app's answer to a look: a design closes the card; a failure backs off; a wait or an unlinked TV ends it
  function makeitAnswered(a) {
    if (zone !== "makeit" || !a) return;
    if (a.state === "item") { makeitWindowStop(); makeitClose(); return; }
    if (a.state === "wait") { keep(MAKEIT_CHK, MAKEIT_MAX); makeitWindowStop(); return; }
    if (a.state === "unlinked") { makeitWindowStop(); return; }
    if (a.state === "error") { makeitBack = Math.min(makeitBack + 1, 3); if (makeitTick) { clearTimeout(makeitTick); makeitTick = makeitLooks() < MAKEIT_MAX ? setTimeout(makeitCheck, MAKEIT_EVERY * Math.pow(2, makeitBack)) : 0; } }
    else makeitBack = 0;
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) makeitWindowStop(); else makeitWindowStart(); });
  window.addEventListener("offline", makeitWindowStop);
  window.addEventListener("online", makeitWindowStart);
  function makeitKey(e) {
    if (isSettings(e)) { e.preventDefault(); if (!e.repeat) settingsKey(); return; }
    if (isBack(e) || isOk(e) || arrowOf(e)) {
      e.preventDefault();
      if (!e.repeat && !arrowOf(e)) makeitClose();   // Back and OK close it; the arrows do nothing and never hold anything
    }
  }
  function updWhen(u) {
    if (!u.checked) return t("upd_never");
    var loc = window.I18N ? window.I18N.locale() : "en-AU";
    var when = new Date(u.checked).toLocaleString(loc, { day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: !CLOCK24 });
    return t("upd_last", { when: when });
  }
  // Home settings, About, Update couch-tv: the version line, and OK opens the update page (the same rows
  // as Updates). Nobody on a phone only install was ever told about a new version (a TCL beginner on
  // 0.13.3, 19 Nov 2026), so it is where people look first. English only for now (needs i18n).
  var UPD_ROW = "Update Couch TV";
  // The on-TV app's own update words (it installs by itself over its ADB link, Update.kt), English only
  // like its steps, which come from the app.
  var UPD_ONTV = {
    upd_err_space: "Not installed: the TV is short of space. Nothing changed. Use the steps above, or free some space and check again.",
    upd_err_adb: "Couch TV lost its link to the TV, so nothing was installed. Use the steps above.",
    upd_self_sub: "Downloads it, checks it and installs it. Your settings stay.",
    upd_installing_self: "Installing. Couch TV closes and opens again by itself.",
    upd_done: "Updated to {v}. Your settings stay.",
    upd_note_self: "Updates come from Couch TV's releases on GitHub. With Tell me on, the TV looks once a week. Nothing is installed until you choose Update, and your settings stay as they are.",
    upd_qr: "Scan to keep these steps on your phone."
  };
  function tUpd(k, v) {
    var s = UPD_ONTV[k];
    if (s == null) return t(k, v);
    return v ? s.replace(/\{(\w+)\}/g, function (m, x) { return v[x] != null ? v[x] : m; }) : s;
  }
  function updLine(u) {
    if (u.busy === "checking") return t("upd_checking");
    if (u.available || u.refused) return t("upd_gear", { v: u.latest, c: u.current || "" });
    if (u.checked) return t("about_version") + " " + (u.current || "") + ". " + t("upd_latest");
    return t("about_version") + " " + (u.current || "") + ". " + t("upd_never");
  }
  function openUpdate() {
    SET.sub = { back: "upd-about", crumb: t("sec_about"), title: function () { return UPD_ROW; }, rows: updateRows };
    SET.keyFocus = null; SET.ri = 0;
    var u = updRead();
    if (u && !u.checked && !u.busy) upd().check();   // never looked yet: look now
  }
  // An app that cannot install an update itself (the on-TV app from a phone: Android's installer needs a
  // permission that brings back Play Protect's block, so it is left out). The app hands the steps over
  // in u.steps; they are shown one per row, numbered, with the Downloader code big in the first.
  function manualRows(u) {
    var steps = Array.isArray(u.steps) ? u.steps : [];
    return steps.slice(0, 8).map(function (s, i) { return info("upd-step" + i, (i + 1) + ".", "", String(s).slice(0, 300)); });
  }
  function updateRows() {
    var u = updRead() || {}, busy = u.busy || "";
    var rows = [info("upd-ver", t("about_version"), u.current || "")];
    if (u.latest) rows.push(info("upd-newest", t("upd_newest"), u.latest));   // both numbers side by side
    if (u.available && u.manual) {
      rows.push(info("upd-how", UPD_ROW, "", t("upd_gear", { v: u.latest, c: u.current || "" }) + ". " + (u.how || "")));
      rows = rows.concat(manualRows(u));
      // the same steps on a phone, so nobody has to remember them (a TCL, 20 Nov 2026): under the steps,
      // so it is on screen when the page opens
      if (u.help_url && window.TVQR) rows.push({ kind: "qr", key: "upd-qr", url: u.help_url, label: tUpd("upd_qr") });
    } else if (u.available) {
      // u.self: the on-TV app installs it by itself (no Android question), then opens again
      rows.push({ kind: "action", key: "upd-install", label: t("upd_install", { v: u.latest }),
        sub: busy === "downloading" ? t("upd_downloading", { p: u.progress || 0 }) : busy === "installing" ? tUpd(u.self ? "upd_installing_self" : "upd_confirm")
          : u.self ? tUpd("upd_self_sub") : u.title || "",
        act: function () { if (!busy) upd().install(); } });
    }
    rows.push({ kind: "action", key: "upd-check", label: t("upd_check"), sub: busy === "checking" ? t("upd_checking") : updWhen(u),
      act: function () { if (!busy) upd().check(); } });
    if (u.error) rows.push(info("upd-err", tUpd("upd_err_" + u.error)));
    else if (u.refused) rows.push(info("upd-err", t("upd_err_other_key")));
    else if (u.checked && !u.available && !busy) rows.push(info("upd-latest", t("upd_latest")));
    rows.push({ kind: "toggle", key: "upd-auto", label: t("upd_auto"), value: u.auto ? t("on") : t("off"),
      act: function () { upd().auto(!u.auto); } });
    // "It always asks before it installs one" is only true where the TV installs it: not on a Samsung
    // or the on-TV app (manual), whose own steps say how (a real Frame, 20 Nov 2026)
    if (!u.manual) rows.push(info("upd-note", tUpd(u.self ? "upd_note_self" : "upd_note")));
    return rows;
  }

  // ---- Make Home open Couch TV (the on-TV app's HomeKey.kt, window.TVHK) ----
  // On Google TV, and TVs that open Google's home by name, one press gets the Home button version from
  // GitHub, checks it, puts it on over the app's own link to the TV and switches its Home button watch on.
  // Without that link: one line and a QR code for the computer steps. Nothing at all where Home already
  // opens the default home, or without the on-TV app. mock.js stands in for previews (?homekey=...).
  function hk() { return window.TVHK || window.MOCK_HOMEKEY || null; }
  function hkRead() { var h = hk(); try { return h ? JSON.parse(h.state()) : null; } catch (e) { return null; } }
  function hkChanged() { if (zone === "settings") renderSettings(); }
  // the real reason, as the setup screen and the phone page give it (HomeKeyRules.errorWords)
  function hkErr(h) {
    var e = h.error || "";
    if (!e) return "";
    if (e === "net") return t("upd_err_net");
    if (e === "bad") return t("upd_err_bad");
    if (e === "not_bound") return t(h.fire_tv ? "hk_err_not_bound_fire" : "hk_err_not_bound");
    if (e === "update_busy") return t("hk_wait_update");
    if (e === "other_key" || e === "not_newer" || e === "space" || e === "adb" || e === "slow") return t("hk_err_" + e);
    return t("hk_err");
  }
  function hkRows() {
    var h = hkRead(), v = h && h.view;
    if (!v || v === "hidden") return [];
    var err = hkErr(h);
    if (v === "done") return [info("hk", t("hk_row"), "", t("hk_done"))];
    if (v === "busy") return [{ kind: "action", key: "hk", label: t("hk_row"),
      sub: h.phase === "downloading" ? t("upd_downloading", { p: h.progress || 0 }) : t("hk_working"), act: function () {} }];
    if (v === "ready") return [{ kind: "action", key: "hk", label: t("hk_row"),
      sub: err || t(h.watch_apk ? "hk_sub_watch" : "hk_sub"), act: function () { var x = hk(); if (x) x.start(); } }];
    var rows = [info("hk", t("hk_row"), "", (err ? err + " " : "") + t(h.fire_blocked ? "hk_steps_fire" : "hk_steps"))];
    if (h.help_url && window.TVQR) rows.push({ kind: "qr", key: "hk-qr", url: h.help_url, label: t("hk_qr") });
    return rows;
  }

  // Back to config.json for everything but the people and the apps (which have their own lists).
  function resetSettings() {
    (Array.isArray(ST.photos) ? ST.photos : []).forEach(function (p) {
      if (p.file) try { if (TV && TV.removePhoto) TV.removePhoto(p.file); } catch (e) {}
    });
    ST = Array.isArray(ST.hidden_apps) ? { hidden_apps: ST.hidden_apps } : {};
    keep("tvhome.look", null);
    if (window.I18N) window.I18N.set(HOME.language || window.I18N.device());
    saveSettings();
    staticText();
    SET.msg = t("reset_done");
  }

  // ---- typing a place, a name or a photo address ----
  // One text box above the rows. OK on a typing row focuses it, so the TV's keyboard comes up; OK
  // (Enter) is done, Back cancels, up and down leave it. The phone remote's Type also lands here.
  function isTyping() { return !!SET.typing; }
  function startTyping(spec) {
    SET.typing = spec;
    var inp = $("set-input");
    $("set-type-label").textContent = spec.label;
    var chk = $("set-type-check"); if (chk) chk.textContent = "";
    inp.value = spec.value || "";
    inp.type = spec.url ? "url" : "text";
    inp.setAttribute("enterkeyhint", spec.search ? "search" : "done");
    inp.setAttribute("autocapitalize", spec.url ? "off" : spec.code ? "characters" : "words");
    if (spec.code) { inp.setAttribute("autocorrect", "off"); inp.setAttribute("spellcheck", "false"); }
    else { inp.removeAttribute("autocorrect"); inp.removeAttribute("spellcheck"); }
    $("set-type").classList.add("on");
    renderSettings();
    try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
  }
  function typeIn(s) {
    if (!SET.typing || zone !== "settings" || typeof s !== "string") return false;
    var inp = $("set-input"), at = typeof inp.selectionStart === "number" ? inp.selectionStart : inp.value.length, end = typeof inp.selectionEnd === "number" ? inp.selectionEnd : at;
    inp.value = (inp.value.slice(0, at) + s.replace(/[\r\n]+/g, " ") + inp.value.slice(end)).slice(0, 2000);
    try { inp.focus(); inp.setSelectionRange(at + s.length, at + s.length); } catch (e) {}
    return true;
  }
  function stopTyping() {
    SET.typing = null;
    $("set-type").classList.remove("on");
    try { $("set-input").blur(); } catch (e) {}
    renderSettings();
  }
  function typingKey(e) {
    if (!SET.typing || zone !== "settings") return false;
    var inp = $("set-input");
    if (document.activeElement !== inp) { stopTyping(); return false; }   // the box lost the keys
    if (e.key === "Enter" || e.keyCode === 13) {
      // Nothing typed yet: this OK is the remote asking for the TV's keyboard (a WebView raises it
      // on OK in a text box), so it is left to do that rather than closing the box.
      if (inp.value.trim() === String(SET.typing.value || "").trim()) return true;
      e.preventDefault();
      var spec = SET.typing, v = inp.value;
      stopTyping();
      spec.submit(v);
      if (zone === "settings") renderSettings();
      return true;
    }
    if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); stopTyping(); return true; }
    var up = e.key === "ArrowUp" || e.keyCode === 38, down = e.key === "ArrowDown" || e.keyCode === 40;
    if (up || down) { e.preventDefault(); stopTyping(); setMove(0, up ? -1 : 1); return true; }
    return true;   // everything else is typing (Backspace deletes here, it does not go back)
  }

  // ---- keys on the settings screen ----
  function enterRows() {
    var rows = rowsNow(), i = firstRow(rows);
    if (i < 0) return;
    SET.col = "rows"; SET.ri = i; SET.keyFocus = rows[i].key;
  }
  function leaveRows() {
    if (SET.sub) { SET.keyFocus = SET.sub.back; SET.sub = SET.sub.up || null; return; }
    SET.col = "secs"; SET.keyFocus = null;
  }
  function setMove(dx, dy) {
    var rows = rowsNow();
    if (SET.lift) {
      if (dy) {
        var r = rows[indexOfKey(rows, SET.lift)];
        if (r && r.move) r.move(dy);
        SET.keyFocus = SET.lift;
      }
      renderSettings();
      return;
    }
    var hadConfirm = SET.confirm;
    SET.confirm = null;
    if (SET.col === "secs") {
      if (dy) {
        var n = Math.max(0, Math.min(secsNow().length - 1, SET.sec + dy));
        if (n !== SET.sec) { SET.sec = n; SET.sub = null; SET.msg = ""; SET.keyFocus = null; SET.ri = 0; }
      } else if (dx > 0) enterRows();
    } else if (dy) {
      var to = stepRow(rows, SET.ri, dy);
      // No row to move to, but lines out of view that way (the update steps sit above the first
      // button, Check for updates now): scroll them into view and keep the focus where it is (a TCL,
      // 20 Nov 2026: step 1 was off the top and Up could not reach it).
      var lb = $("set-rows");
      if (to === SET.ri && lb && (dy < 0 ? lb.scrollTop > 0 : lb.scrollTop + lb.clientHeight < lb.scrollHeight - 1)) {
        SET.peek = dy;   // renderSettings scrolls, after it has rebuilt the list
        SET.peeks = (SET.peeks || 0) + 1;   // so the press does not also go round to the other end
      }
      var from = SET.ri;
      SET.ri = to;
      SET.keyFocus = rows[SET.ri] ? rows[SET.ri].key : null;
      if (to !== from && !hadConfirm && !SET.peek && moveFocusInPlace(rows, from, to)) return;
    } else if (dx && rows[SET.ri] && rows[SET.ri].adjust) {
      rows[SET.ri].adjust(document.documentElement.dir === "rtl" ? -dx : dx);
      SET.keyFocus = rows[SET.ri].key;
    } else if (dx < 0) leaveRows();
    renderSettings();
  }
  // Up or Down inside the same list only moves the focus: move the "focus" class from one row to
  // the other and scroll, instead of rebuilding every row. A full rebuild cost 80 to 190 ms a press
  // on an LG OLED65CX (webOS 5, 2020), with every app icon in the Apps list made again, so presses
  // landed late and the labels jumped; the home's own rows take 20 to 40 ms there. Anything that
  // changes a row's text (a confirm, a lifted row, another page) still goes through renderSettings.
  function moveFocusInPlace(rows, from, to) {
    var box = $("set-rows");
    if (!box || SET.col !== "rows" || SET.lift || SET.typing || box.children.length !== rows.length) return false;
    var a = box.children[from], b = box.children[to];
    if (!b || !/\bsrow\b/.test(b.className) || !focusable(rows[to])) return false;
    if (a) a.classList.remove("focus");
    b.classList.add("focus");
    SET.peeked = null;
    var cur = rows[to];
    $("set-hint").textContent = cur && cur.move ? t("hint_rows_move") : cur && cur.adjust ? t("hint_slider") : t("hint_rows");
    // the same "a quarter of the list from either edge" rule as renderSettings
    var top = b.offsetTop, bottom = top + b.offsetHeight, view = box.clientHeight, edge = view / 4;
    if (top - edge < box.scrollTop) box.scrollTop = Math.max(0, top - edge);
    else if (bottom + edge > box.scrollTop + view) box.scrollTop = bottom + edge - view;
    return true;
  }
  function setActivate() {
    if (SET.lift) { dropRow(); return; }
    if (SET.col === "secs") { enterRows(); renderSettings(); return; }
    var rows = rowsNow(), r = rows[SET.ri];
    if (!focusable(r) || !r.act) return;
    if ((r.danger || r.ask) && SET.confirm !== r.key) { SET.confirm = r.key; renderSettings(); return; }   // ask: a question first, not red
    SET.confirm = null;
    SET.keyFocus = r.key;
    r.act();
    if (zone === "settings" && !SET.typing) renderSettings();
  }
  function setHold() {
    if (SET.lift) { dropRow(); return true; }
    if (SET.col !== "rows") return false;
    var r = rowsNow()[SET.ri];
    if (!r || !r.move) return false;
    SET.confirm = null;
    if (r.key.indexOf("app:") === 0) materialise();
    SET.lift = r.key;
    renderSettings();
    return true;
  }
  function dropRow() {
    var k = SET.lift || "";
    SET.lift = null;
    if (k.indexOf("app:") === 0) { persistOrder(); SET.dirty = true; }
    if (k.indexOf("person:") === 0) savePeopleList();
    if (zone === "settings") renderSettings();
  }
  function setBack() {
    if (SET.typing) { stopTyping(); return; }
    if (SET.lift) { dropRow(); return; }
    SET.confirm = null;
    if (SET.col === "rows") { leaveRows(); renderSettings(); return; }
    closeSettings();
  }

  // ---- drawing it ----
  function rowHTML(r, i) {
    if (r.kind === "head") return '<div class="shead">' + esc(r.label) + "</div>";
    // a design code shown big, one box per letter, so a missing or wrong letter stands out
    if (r.kind === "code") return '<div class="scode" aria-label="' + esc(r.label) + '"><span class="scode-big">' +
      String(r.label).split("").map(function (ch) { return ch === "-" ? '<i class="dash">-</i>' : "<i>" + esc(ch) + "</i>"; }).join("") +
      "</span>" + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</div>";
    // a QR code drawn in the page (qr.js), with one line beside it: the update steps on a phone
    if (r.kind === "qr" && r.url) return '<div class="sqr"><span class="sqr-code" data-qr="' + esc(r.url) + '"></span><small>' + esc(r.label) + "</small></div>";
    // a QR for the phone (qr.js, drawn here: the link never leaves the TV to be drawn)
    if (r.kind === "qr") {
      var svg = "";
      try { svg = window.TVQR.svg(r.link, 300).outerHTML; } catch (e) {}
      return '<div class="sqr">' + (svg ? '<span class="sqr-code">' + svg + "</span>" : "") +
        '<span class="sl"><b>' + esc(r.label) + "</b>" + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</span></div>";
    }
    var f = SET.col === "rows" && i === SET.ri, lifted = SET.lift === r.key;
    var cls = "srow k-" + r.kind + (f ? " focus" : "") + (lifted ? " lifted" : "") + (r.danger ? " danger" : "");
    var lead = "";
    if (r.avatar) lead = avatarHTML(r.avatar);
    // a logo that fails becomes the first letter in the same box, so the label never slides over (an
    // LG OLED65CX answered no icon for Hulu or Fandango at Home, and those rows jumped on every redraw)
    else if (r.icon && iconUrl(r.icon)) lead = '<img class="sicon" src="' + esc(iconUrl(r.icon)) + '" alt="" data-err="sletter" data-n="' +
      esc((r.label || "?").charAt(0).toUpperCase()) + '">';
    else if (r.kind === "item") lead = '<span class="sicon none">' + (r.icon.indexOf("screen:") === 0 ? ICONS.screen : esc((r.label || "?").charAt(0).toUpperCase())) + "</span>";
    else if (r.thumb) lead = '<img class="sthumb" src="' + esc(r.thumb) + '" alt="" decoding="async" data-err="remove">';
    var label = SET.confirm === r.key ? r.confirmText || t("confirm_remove") : r.label;
    var tail = "";
    if (lifted) tail = '<i class="smark">' + ICONS.updown + "</i>";
    else if (r.kind === "choice") tail = r.checked ? '<i class="smark">' + ICONS.check + "</i>" : "";
    else if (r.kind === "check") tail = '<i class="sbox' + (r.checked ? " on" : "") + '">' + (r.checked ? ICONS.check : "") + "</i>";
    else if (r.kind === "nav" || r.kind === "input") tail = '<i class="smark dim">' + ICONS.chevron + "</i>";
    else if (r.kind === "slider") {
      for (var lv = 1; lv <= 5; lv++) tail += '<i class="sstep' + (lv <= r.level ? " on" : "") + '"></i>';
      tail = '<span class="sslide">' + tail + "</span>";
    }
    var value = r.value != null && r.value !== "" ? '<span class="sv">' + esc(r.value) + "</span>" : "";
    var sub = r.sub ? "<small>" + esc(r.sub) + "</small>" : "";
    return '<div class="' + cls + '"' + (r.lang ? ' lang="' + esc(r.lang) + '"' : "") + ">" + lead +
      '<span class="sl"><b>' + esc(label) + "</b>" + sub + "</span>" + value + tail + "</div>";
  }
  function renderSettings() {
    var rows = rowsNow();
    if (SET.sub && !rows.length) { SET.sub = null; rows = rowsNow(); }
    if (SET.col === "rows") {
      var k = SET.keyFocus ? indexOfKey(rows, SET.keyFocus) : -1;
      if (k >= 0 && focusable(rows[k])) SET.ri = k;
      else {
        SET.ri = Math.max(0, Math.min(SET.ri, rows.length - 1));
        if (!focusable(rows[SET.ri])) { var back = stepRow(rows, SET.ri, -1); SET.ri = back !== SET.ri ? back : stepRow(rows, SET.ri, 1); }
      }
      if (focusable(rows[SET.ri])) SET.keyFocus = rows[SET.ri].key;
      else SET.col = "secs";
    }
    $("set-title").textContent = t("set_title");
    $("set-secs").innerHTML = secsNow().map(function (sc, i) {
      var cls = "ssec" + (i === SET.sec ? (SET.col === "secs" ? " focus" : " on") : "");
      return '<div class="' + cls + '"><i>' + ICONS[sc[1]] + "</i><span>" + esc(secName(sc[0])) + "</span></div>";
    }).join("");
    var curSecEl = $("set-secs").querySelector(".ssec.focus, .ssec.on");
    if (curSecEl && curSecEl.scrollIntoView) curSecEl.scrollIntoView({ block: "nearest" });
    $("set-crumb").textContent = SET.sub ? SET.sub.crumb : "";
    $("set-head").textContent = SET.sub ? SET.sub.title() : secName(secsNow()[SET.sec][0]);
    var box = $("set-rows");
    // Rebuilding the rows drops the list back to the top on some TV engines (a 2020 Samsung,
    // Tizen 5.5), and the smooth scroll below then ran from the top down to the row: every move
    // past the first screen flashed up to the start and back. Put the list back where it was
    // without animating, so only the small step to the next row is smooth. A different list
    // (another section or page) starts at the top.
    var listId = SET.sec + "|" + $("set-head").textContent + "|" + $("set-crumb").textContent;
    var fresh = box.getAttribute("data-list") !== listId;
    var keep = fresh ? 0 : box.scrollTop;
    var pk = fresh ? 0 : SET.peek || 0;   // read and cleared here, so it never carries to another page
    SET.peek = 0;
    if (pk) SET.peeked = listId + "|" + SET.ri;
    else if (SET.peeked !== listId + "|" + SET.ri) SET.peeked = null;
    box.setAttribute("data-list", listId);
    box.innerHTML = rows.map(rowHTML).join("");
    // one QR code on screen at a time: a page with its own (Get a design from your phone, the update
    // steps) hides the side "Change this on your phone" one
    var sp = $("set-phone"); if (sp) sp.style.visibility = rows.some(function (r) { return r.kind === "qr"; }) ? "hidden" : "";
    Array.prototype.forEach.call(box.querySelectorAll("[data-qr]"), function (n) {
      try { n.appendChild(window.TVQR.svg(n.getAttribute("data-qr"), 240)); } catch (e) { n.parentNode.style.display = "none"; }
    });
    box.style.scrollBehavior = "auto";
    box.scrollTop = keep;
    void box.offsetHeight;   // apply the jump now, before smooth scrolling comes back on
    box.style.scrollBehavior = "";
    $("set-msg").textContent = SET.msg || "";
    var cur = rows[SET.ri];
    $("set-hint").textContent = SET.typing ? t("hint_typing") : SET.lift ? t("hint_lift") : SET.col === "secs" ? t("hint_secs") :
      cur && cur.move ? t("hint_rows_move") : SET.col === "rows" && cur && cur.adjust ? t("hint_slider") : t("hint_rows");
    // keep the focused row well inside the list (a quarter of it from either edge), scrolling only
    // when it gets closer, so short lists and their headings never move
    var f = box.querySelector(".srow.focus");
    if (!f) { box.scrollTop = 0; return; }
    // Up or Down just scrolled lines into view with no row to move to: leave the list there.
    // A peek goes at least as far that way as the focused row needs to be on screen: keep is where a
    // smooth scroll still under way had got to, not where it was going, so Down pressed fast on the
    // last row (the update page after Up showed step 1) peeked from a list still on its way down and
    // stopped with that row under the bottom edge for good (0.13.11 tests, 24 Nov 2026).
    if (pk) {
      var go = keep + pk * Math.round(box.clientHeight * 0.6), ft = f.offsetTop, fv = box.clientHeight, fe = fv / 4;
      go = pk > 0 ? Math.max(go, ft + f.offsetHeight + fe - fv) : Math.min(go, ft - fe);
      box.scrollTop = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, go));
      return;
    }
    // a redraw for news (an update check, the calendar) while someone reads what they scrolled to:
    // leave the list where they put it until the focus moves to another row
    if (SET.peeked) return;
    var top = f.offsetTop, bottom = top + f.offsetHeight, view = box.clientHeight, edge = view / 4;
    // a page just opened whose first button is low down: if it is on screen from the top, start at
    // the top, so the lines above it (the update steps) are read first. The list's bottom padding is
    // its fade, so a button there would show half faded: it does not count as on screen.
    var fade = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    if (fresh && bottom <= view - fade) return;
    if (top - edge < box.scrollTop) box.scrollTop = Math.max(0, top - edge);
    else if (bottom + edge > box.scrollTop + view) box.scrollTop = bottom + edge - view;
  }
  function initSettings() {
    $("set-input").addEventListener("input", function () { if (SET.typing && SET.typing.live) SET.typing.live(this.value); });
  }

  // ---------------- keys: any normal TV remote, keyboard or game controller ----------------
  // The full table is in docs/REMOTES.md. The launcher also turns BUTTON_A, BUTTON_SELECT and
  // NUMPAD_ENTER into OK and BUTTON_B and ESCAPE into Back before the page sees them. Any other key
  // (media, numbers, colour buttons, voice, app buttons) is left alone so Android still gets it.
  var OK_KEYS = ["Enter", " ", "Select", "Accept", "NumpadEnter"];
  var BACK_KEYS = ["Escape", "Esc", "Backspace", "GoBack", "BrowserBack"];
  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
  var ARROW_CODES = { 38: [0, -1], 40: [0, 1], 37: [-1, 0], 39: [1, 0], 19: [0, -1], 20: [0, 1], 21: [-1, 0], 22: [1, 0] };
  function isOk(e) { return OK_KEYS.indexOf(e.key) >= 0 || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 32; }
  function isBack(e) { return BACK_KEYS.indexOf(e.key) >= 0 || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461; }   // 10009: Samsung; 461: VK_BACK (Titan OS, unconfirmed)
  function isMenu(e) { return e.key === "ContextMenu" || e.key === "Menu" || e.keyCode === 93 || e.keyCode === 82; }
  function arrowOf(e) { return ARROWS[e.key] || (e.key === "Unidentified" || !e.key ? ARROW_CODES[e.keyCode] : null) || null; }

  // Focus is never lost: after any key, if nothing shows focus, the first dock app gets it.
  function ensureFocus() {
    if (document.querySelector(".focus")) return;
    zone = "grid"; g = 0;
    paintFocus();
  }

  // OK acts when it is let go, so holding it can pick things up instead (tvOS does the same).
  // Works for remotes that repeat the key while it is held and for ones that only send the press
  // and, later, the release. One press is one action: a pick-up never also opens the app.
  var okDown = false, okHeld = false, okTimer = null;
  function okReset() { okDown = false; okHeld = false; clearTimeout(okTimer); pressTile(false); }

  // A short navigation click on every arrow and OK, like the TV's own launcher.
  var AC = null, SOUND = true;
  // "Soft": a short, quiet, lower tap instead of the TV's click (#32, thanks alonmustafa)
  function softTick() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = AC || new Ctx();
      if (AC.state === "suspended") AC.resume();
      var now = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(392, now);
      o.frequency.exponentialRampToValueAtTime(294, now + 0.075);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.05, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      o.connect(g); g.connect(AC.destination);
      o.start(now); o.stop(now + 0.1);
    } catch (e) {}
  }
  function warmSound() {
    if (!SOUND || SOUND_STYLE !== "soft" || AC) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) AC = new Ctx();   // may start suspended until a key is pressed; softTick resumes it
    } catch (e) {}
  }
  function blip(dx, dy) {
    if (!SOUND || SOUND_STYLE === "off") return;
    if (SOUND_STYLE === "soft") { softTick(); return; }
    // On the TV: Android's own navigation sound (TVOS.tick), the one other TV launchers play.
    // It follows the TV's "system sounds" switch. 1 up, 2 down, 3 left, 4 right, 0 OK.
    if (TV && TV.tick) {
      try { TV.tick(dy < 0 ? 1 : dy > 0 ? 2 : dx < 0 ? 3 : dx > 0 ? 4 : 0); } catch (e) {}
      return;
    }
    // Anywhere else (a browser preview): a short tick synthesised with Web Audio, no sound file.
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = AC || new Ctx();
      if (AC.state === "suspended") AC.resume();
      var now = AC.currentTime;
      // A mid body (triangle, 520 -> 300 Hz) plus a faint bright transient, gone within ~60 ms.
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(300, now + 0.045);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      o.connect(g); g.connect(AC.destination);
      o.start(now); o.stop(now + 0.07);
      var c = AC.createOscillator(), cg = AC.createGain();
      c.type = "sine";
      c.frequency.setValueAtTime(1800, now);
      cg.gain.setValueAtTime(0.0001, now);
      cg.gain.exponentialRampToValueAtTime(0.04, now + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      c.connect(cg); cg.connect(AC.destination);
      c.start(now); c.stop(now + 0.02);
    } catch (e) {}
  }

  // The remote's own Settings/gear key (KEYCODE_SETTINGS = 176, or e.key "Settings"/"TvSettings").
  // couch-tv has no system home behind it, so it opens couch-tv's own gear menu, like the gear tile.
  // keyCode 176 is also Chromium's code for the media Next track key (VK_MEDIA_NEXT_TRACK, e.key
  // "MediaTrackNext"), which the bridge sends for the Next song button: that must skip the track, not
  // open the gear menu (#158). So 176 only counts when the key is not a media key.
  function isSettings(e) { return e.key === "Settings" || e.key === "TvSettings" || (e.keyCode === 176 && !/^Media/.test(e.key || "")); }
  function settingsKey() {
    // the first-run welcome: Home settings stays one press away (the welcome counts as answered)
    if (zone === "welcome") { welcomeClose("settings"); startFocus(); paintFocus(); }
    if (zone === "makeit") makeitClose();
    if (kidsOn()) { window.KidsMode.askPin(); return; }
    if (idlePhotoInput(null)) return;
    if (zone === "gear" || zone === "settings" || zone === "smart" || zone === "remind" || zone === "appmenu" || zone === "shelfmenu" || zone === "updask" || zone === "inputs") { goHome(); return; }
    openGear();
  }

  // ---------------- a pointer (LG's Magic Remote, or the phone's touchpad on an LG) ----------------
  // Pointing at a tile moves the focus there; a click opens it, as OK would. On webOS, where the TV has
  // a pointer, and on a page opened with ?pointer=1 (a VIDAA TV with "pointer": true, whose TV Browser
  // turns the arrows into a mouse cursor, #145); elsewhere the home stays arrows only. A TiVo OS TV is
  // told by its browser's name instead: its page opens from a Speed Dial tile whose address the owner
  // types once with the TV remote, and that browser has a cursor and never hands the arrows to a page
  // (docs/TIVO.md).
  var HAS_POINTER = !!window.COUCH_WEBOS || /[?&]pointer=1(?:&|$)/.test(Q) || /\bTiVoOS\//.test(navigator.userAgent);
  if (HAS_POINTER) document.documentElement.classList.add("has-pointer");
  function inList(list, el) {
    for (; el && el !== document.body; el = el.parentNode) { var i = list.indexOf(el); if (i >= 0) return i; }
    return -1;
  }
  // What the pointer is over: {zone, i}, or null.
  function kids(id, sel) { return Array.prototype.slice.call(sel ? $(id).querySelectorAll(sel) : $(id).children); }
  function pointAt(el) {
    var i;
    if (zone === "ambient") {
      var ambBtns = kids("ambient-controls", ".amb-btn");
      i = inList(ambBtns, el);
      return i >= 0 ? { zone: "ambient", i: i } : null;
    }
    if (zone === "menu") { i = inList(kids("sleep-menu"), el); return i >= 0 ? { zone: "menu", i: i } : null; }
    if (zone === "gear" || zone === "updask") { i = inList(kids("gear-pop", ".grow"), el); return i >= 0 ? { zone: zone, i: i } : null; }
    if (zone === "appmenu") { i = inList(kids("app-pop", ".grow"), el); return i >= 0 ? { zone: "appmenu", i: i } : null; }
    if (zone === "settings") {
      if (SET.typing || SET.lift) return null;
      if ((i = inList(kids("set-secs"), el)) >= 0) return { zone: "settings", sec: i };
      if ((i = inList(kids("set-rows"), el)) >= 0 && focusable(rowsNow()[i])) return { zone: "settings", i: i };
      return null;
    }
    if (zone === "inputs") { i = inList(Array.prototype.slice.call($("inputs-pop").children), el); return i >= 0 ? { zone: "inputs", i: i } : null; }
    if (zone === "pmenu") { i = inList(Array.prototype.slice.call($("people-pop").querySelectorAll(".prow")), el); return i >= 0 ? { zone: "pmenu", i: i } : null; }
    if (["grid", "shelf", "quick", "people", "np"].indexOf(zone) < 0 || lift) return null;
    if ((i = inList(gridEls, el)) >= 0) return { zone: "grid", i: i };
    if ((i = inList(shelfEls, el)) >= 0) return { zone: "shelf", i: i };
    if ((i = inList(quickEls, el)) >= 0) return { zone: "quick", i: i };
    if (peopleOn() && !isHead() && (i = inList(Array.prototype.slice.call($("people").children), el)) >= 0) return { zone: "people", i: i };
    if (peopleOn() && isHead() && inList([$("people")], el) >= 0) return { zone: "people", i: 0 };
    var npBtns = kids("np", ".nb");
    if ((i = inList(npBtns, el)) >= 0) return { zone: "np", i: i };
    if (AMBIENT_MUSIC && inList([$("np"), $("np-slot")], el) >= 0) return { zone: "ambient_open", i: 1 };
    return null;
  }
  function pointTo(p, clicked) {
    if (p.zone === "np") {
      if (npI === p.i && zone === "np") return false;
      zone = "np";
      npI = p.i;
      paintFocus();
      return true;
    }
    if (p.zone === "ambient") {
      if (ambI === p.i) return false;
      ambI = p.i;
      renderAmbientControls();
      return true;
    }
    if (p.zone === "ambient_open") {
      ambientOpen = true;
      ambientDismissed = false;
      zone = "ambient";
      ambI = 1;
      paintFocus();
      renderAmbientMusic();
      return true;
    }
    if (p.zone === "menu") { if (menuI === p.i) return false; menuI = p.i; renderMenu(); return true; }
    if (p.zone === "gear") { if (gi === p.i) return false; gi = p.i; renderGear(); return true; }
    if (p.zone === "updask") { if (ai === p.i) return false; ai = p.i; renderAsk(); return true; }
    if (p.zone === "appmenu") { if (amI === p.i) return false; amI = p.i; renderAppMenu(); return true; }
    if (p.zone === "settings") {
      if (p.sec !== undefined) {   // a section changes the page only on a click, so passing over the list is harmless
        if (!clicked) return false;
        if (SET.sec !== p.sec) { SET.sec = p.sec; SET.sub = null; SET.msg = ""; SET.keyFocus = null; SET.ri = 0; }
        SET.col = "secs"; SET.confirm = null;
        renderSettings();
        return true;
      }
      if (SET.col === "rows" && SET.ri === p.i) return false;
      var rows = rowsNow(), box = $("set-rows"), keep = box.scrollTop;
      SET.col = "rows"; SET.ri = p.i; SET.keyFocus = rows[p.i] ? rows[p.i].key : null; SET.confirm = null;
      renderSettings();
      // the row is already under the pointer: the list stays where it is
      box.style.scrollBehavior = "auto"; box.scrollTop = keep; box.style.scrollBehavior = "";
      return true;
    }
    if (p.zone === "inputs") { if (inI === p.i) return false; inI = p.i; renderInputMenu(); return true; }
    if (p.zone === "pmenu") { if (pmi === p.i) return false; pmi = p.i; renderPop(); return true; }
    var same = zone === p.zone && ((p.zone === "grid" && g === p.i) || (p.zone === "shelf" && s === p.i) ||
      (p.zone === "quick" && qi === p.i) || (p.zone === "people" && pi === p.i));
    if (same) return false;
    zone = p.zone;
    if (p.zone === "grid") g = p.i; else if (p.zone === "shelf") s = p.i; else if (p.zone === "quick") qi = p.i; else pi = p.i;
    paintFocus();
    return true;
  }
  // g29 (an Android 14 MediaTek TV with an air mouse remote): any other TV turns the pointer on the first
  // time a real pointer moves over the home (an air mouse, a USB mouse), so a click opens a tile, a dock
  // app or a Home settings row as OK does. A TV that never sends a moving pointer stays arrows only.
  // It takes 8 px of movement within half a second, so a stray nudge (or a TV that sends a lone mousemove) does not.
  var wake = { at: 0, px: 0 };
  function pointerWakes(e) {
    if (HAS_POINTER) return true;
    var now = Date.now(), d = Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    if (!(d > 0)) return false;
    if (now - wake.at > 500) { wake.at = now; wake.px = 0; }   // a new half second starts at the first move
    wake.px += d;
    if (wake.px < 8) return false;
    HAS_POINTER = true;
    document.documentElement.classList.add("has-pointer");
    return true;
  }
  {
    document.addEventListener("mousemove", function (e) {
      // Chrome sends a mousemove with no movement after the page moves under a parked pointer:
      // that must not pull focus back from the arrow keys
      if (e.movementX === 0 && e.movementY === 0) return;
      if (!pointerWakes(e)) return;
      if (kidsOn()) return;
      var p = pointAt(e.target);
      if (p) { touched = true; pointTo(p); }
    });
    // the wheel (or two fingers on the phone's touchpad) scrolls Home settings' list
    document.addEventListener("wheel", function (e) {
      if (!HAS_POINTER || zone !== "settings" || SET.typing) return;
      var box = $("set-rows");
      var d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? box.clientHeight : 1);
      if (!d) return;
      e.preventDefault();
      box.style.scrollBehavior = "auto";
      box.scrollTop += d;
      box.style.scrollBehavior = "";
    }, { passive: false });
    document.addEventListener("click", function (e) {
      if (!HAS_POINTER) return;   // a click with no pointer moved first (a remote's OK) is not a pointer's
      if (screenOffActive) {
        e.preventDefault();
        e.stopPropagation();
        toggleScreenOff(false);
        return;
      }
      if (kidsOn()) return;
      var p = pointAt(e.target);
      if (!p) {
        // a click beside an open menu closes it, as Back does
        if (["menu", "gear", "appmenu", "shelfmenu", "inputs", "pmenu"].indexOf(zone) >= 0) {
          e.preventDefault();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        return;
      }
      e.preventDefault();
      touched = true;
      pointTo(p, true);
      if (p.zone === "settings" && p.sec !== undefined) return;   // choosing a section is the whole click
      activate();
      resetIdlePhoto();
    });
  }

  document.addEventListener("keydown", function (e) {
    lastKeyAt = Date.now();
    clipWake();
    resetSmartIdle();
    if (screenOffActive) {
      e.preventDefault();
      e.stopPropagation();
      toggleScreenOff(false);
      return;
    }
    if (idleAmbientActive) {
      e.preventDefault();
      e.stopPropagation();
      setIdleAmbient(false);
      return;
    }
    if (zone === "welcome") { welcomeKey(e); return; }   // the first-run welcome has the remote
    if (zone === "makeit") { makeitKey(e); return; }     // the first-run Make it yours card
    if (kidsOn()) { okReset(); if (window.KidsMode.key(e)) e.preventDefault(); return; }
    if (idlePhotoInput(e)) return;
    if (typingKey(e)) return;   // typing a place or a name: the keys belong to the text box
    if (isOk(e)) {
      e.preventDefault();
      // a held key repeating: Android's long press. The hold happens now (an ADB long press sends the
      // repeat at once and lets go straight after), so the key up never opens the focused app.
      // A second down with no up between is the key still held, repeat mark or not (a TCL's WebView
      // leaves it off, 20 Nov 2026).
      if (e.repeat || okDown) {
        if (okDown && !okHeld) { clearTimeout(okTimer); okHeld = true; pressTile(false); if (!hold()) activate(); ensureFocus(); resetIdlePhoto(); }
        return;
      }
      okDown = true; okHeld = false;
      blip(0, 0);
      pressTile(true);
      okTimer = setTimeout(function () { okHeld = true; pressTile(false); if (!hold()) activate(); ensureFocus(); resetIdlePhoto(); }, HOLD_MS);
      return;
    }
    var arrow = arrowOf(e);
    if (arrow) {
      blip(arrow[0], arrow[1]);
      // the same arrow again before it was let go is the key being held, marked as a repeat or not
      var dir = arrow[0] + "," + arrow[1], now = Date.now();
      var again = arrowAgain(arrowPress, dir, now, e.repeat);
      if (again && arrowPress) arrowPress.last = now;
      else arrowPress = { dir: dir, at: now, last: now };
      // the first key down of a press that moved nothing is at an end: it goes round when let go
      var before = again ? null : navState();
      move(arrow[0], arrow[1]);
      wrapPending = before !== null && navState() === before ? { dx: arrow[0], dy: arrow[1] } : null;
    }
    else if (isBack(e)) goHome();
    else if (isSettings(e)) { if (!e.repeat) settingsKey(); }   // the remote's own Settings/gear key
    else if (isMenu(e)) { if (!e.repeat) hold(); }   // optional: many remotes have no Menu key
    else { ensureFocus(); return; }                   // anything else is not ours: Android gets it
    e.preventDefault();
    ensureFocus();
    resetIdlePhoto();
  });
  document.addEventListener("keyup", function (e) {
    if (screenOffActive || idleAmbientActive) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (kidsOn()) { if (isOk(e)) e.preventDefault(); okReset(); return; }
    var arrow = arrowOf(e);
    if (arrow) {   // the end of a single press at an end: go round (a held key cleared wrapPending)
      var w = wrapPending, p = arrowPress;
      wrapPending = null; arrowPress = null;
      var quick = p && Date.now() - p.at <= HOLD_MS;
      if (w && quick && w.dx === arrow[0] && w.dy === arrow[1] && !isTyping()) {
        e.preventDefault();
        wrapRound(w.dx, w.dy);
        ensureFocus();
        resetIdlePhoto();
      }
      return;
    }
    if (!isOk(e) || isTyping()) return;
    e.preventDefault();
    if (!okDown) return;
    var held = okHeld;
    okReset();
    if (!held) { hopTile(); activate(); }
    ensureFocus();
    resetIdlePhoto();
  });
  window.addEventListener("blur", okReset);
  window.addEventListener("blur", function () { wrapPending = null; arrowPress = null; });   // a key let go elsewhere

  // ---------------- data ----------------
  function nativeApps() {
    var list;
    try { list = JSON.parse(TV.apps()); } catch (e) { return null; }
    return list.map(function (a) {
      return { kind: "app", name: RENAME[a.package] ? t(RENAME[a.package]) : a.label, package: a.package,
        banner: TV.bannerUrl ? TV.bannerUrl(a.package) : "http://tvos.invalid/banner/" + a.package };   // the launcher makes one when the app has none
    });
  }
  function sortApps(list) {
    var rank = function (p) {
      var i = APP_ORDER.indexOf(p);
      if (i >= 0) return i;
      i = APP_LAST.indexOf(p);
      return i >= 0 ? 2000 + i : 1000;
    };
    return list.filter(function (a) { return HIDDEN.indexOf(a.package) < 0; })
      .sort(function (a, b) { return rank(a.package) - rank(b.package) || a.name.localeCompare(b.name); });
  }

  function render() {
    renderShelf();
    renderGrid();
    if (!touched && zone !== "updask" && zone !== "welcome" && !restoreFocus()) startFocus();
    paintFocus();
    kidSync();
    if (kidsOn()) window.KidsMode.rerender();
  }

  // The bridge's people list (the phone edits it). An order made on this TV while the bridge was
  // away is handed over first.
  function bridgePeople(j) {
    var list = j.people || [];
    var lo = kept("tvhome.people.order"), lst = kept("tvhome.people.list");
    // Your home: a pack that came with a design is merged into the list the bridge keeps (or this TV's
    // own change still waiting for it), then the home starts again with it, as after any new design
    if (typeof CouchDesignCode !== "undefined" && CouchDesignCode.takeHome && CouchDesignCode.takeHome(true) &&
      takeAccountHome(lst && lst.pending && Array.isArray(lst.people) ? lst.people : list)) { restart(); return; }
    if (lst && lst.pending && Array.isArray(lst.people)) {
      // people added, renamed or removed in Home settings while the computer was off
      list = lst.people;
      api("POST", "/api/people", { people: lst.people })
        .then(function (r) { keep("tvhome.people.list", { people: r.people || lst.people, pending: false }); }, function () {});
    } else if (lo && lo.pending && lo.ids) {
      list = localPeopleOrder(list, true);
      api("POST", "/api/people", { order: lo.ids })
        .then(function () { keep("tvhome.people.order", { ids: lo.ids, pending: false }); }, function () {});
    }
    if (zone !== "pmenu") setPeople(list);
  }
  function bridgeOrder(j) {
    data.order = { saved: !!j.saved, line: j.line, packages: (j.apps || []).map(function (a) { return a.package; }) };
    var lo = kept("tvhome.order.tv");
    if (lo && lo.pending && lo.packages) {
      data.order = { saved: true, line: lo.line, packages: lo.packages };
      api("POST", "/api/app-order", { order: lo.packages, line: lo.line })
        .then(function () { lo.pending = false; keep("tvhome.order.tv", lo); }, function () {});
    }
  }

  function sendWatchNext() {
    if (!TV || !TV.watchNext) return Promise.resolve();
    var rows = [];
    try { rows = JSON.parse(TV.watchNext()) || []; } catch (e) {}
    rows = rows.filter(function (r) { return r.package && r.title; }).map(function (r) {
      return { package: r.package, title: r.title, episode_title: r.episode_title || null,
        season: r.season || null, episode: r.episode || null, engaged: r.engaged || 0 };
    });
    return api("POST", "/api/watch-next", { rows: rows });
  }

  // On Fire OS a return to the home asks for this twice within a moment (the Home button watch's
  // tv.home, then the launcher's tv.resume); the second ask gets the first's result.
  var refreshAt = 0, refreshing = null;
  function refresh() {
    // Home settings open: nothing is reshuffled under it, but a change from the phone's Home settings
    // page still comes in (the town, a photo), so the next change made here does not undo it
    if (zone === "settings" && !lift && !OFFLINE && data.bridge !== false) return syncSettings().then(function () {}, function () {});
    // never reshuffle under something being moved, or under the settings screen
    if (lift || zone === "pmenu" || zone === "settings" || zone === "gear" || zone === "smart" || zone === "remind" || zone === "updask") return Promise.resolve();
    if (refreshing && Date.now() - refreshAt < 1500) return refreshing;
    refreshAt = Date.now();
    return refreshing = refreshNow();
  }
  function refreshNow() {
    if (OFFLINE) {
      // only the TV's own apps, in the order last saved; no shows, no Screens
      if (TV) data.apps = sortApps(nativeApps() || []);
      else if (window.MOCK_APPS) data.apps = sortApps(window.MOCK_APPS.slice());
      data.bridge = false;
      // Keep watching with no computer: Android's own Watch Next list, the same for everyone in the house
      if (TV && TV.watchNext && KW_ON) {
        var wn = [];
        try { wn = JSON.parse(TV.watchNext()) || []; } catch (e) {}
        var skipPkgs = (window.COUCH_CONFIG && window.COUCH_CONFIG.home && window.COUCH_CONFIG.home.skip_watch_next) || [];
        var dismissed = kept("tvhome.dismissed_shows") || [];
        wn = wn.filter(function (it) {
          var pkg = (it.app && it.app.package) || it.package || "";
          var id = String(it.id || "");
          var sig = pkg + "|" + (it.title || "");
          return skipPkgs.indexOf(pkg) === -1 && dismissed.indexOf(id) === -1 && dismissed.indexOf(sig) === -1;
        });
        PEOPLE.forEach(function (p) { data.showsBy[p.id] = wn; });
      }
      detectNew();
      status(ALONE ? "" : t("computer_off"), true);
      render();
      return Promise.resolve();
    }
    var people = api("GET", "/api/people").then(bridgePeople, function () {});
    // LG: a warning when Developer Mode (and so couch-tv) is at risk, from the bridge
    if (window.COUCH_WEBOS) api("GET", "/api/tvs").then(function (j) {
      var id = TV_ID || j["default"], me = null;
      (j.tvs || []).forEach(function (x) { if (x.id === id || (!me && (j.tvs || []).length === 1)) me = x; });
      devWarn(me && me.devmode);
    }, function () {});
    var jobs = [
      people.then(function () {
        if (!KW_ON) return null;   // Keep watching is off: no calls for it
        return Promise.all(PEOPLE.map(function (p) {
          return api("GET", "/api/continue?who=" + p.id, null, 9000).then(function (j) {
            var dismissed = kept("tvhome.dismissed_shows") || [];
            var items = (j.items || []).filter(function (it) {
              var pkg = (it.app && it.app.package) || it.package || "";
              var id = String(it.id || "");
              var sig = pkg + "|" + (it.title || "");
              return dismissed.indexOf(id) === -1 && dismissed.indexOf(sig) === -1;
            });
            data.showsBy[p.id] = items.slice(0, KEEP_MAX);
            // that person's YouTube videos, shown under the YouTube tile alone (home.shelf_follows_app)
            data.videosBy[p.id] = (j.videos || []).filter(function (it) {
              return dismissed.indexOf(String(it.id || "")) === -1 && dismissed.indexOf(pkgOf(it) + "|" + (it.title || "")) === -1;
            }).slice(0, KEEP_MAX);
          });
        }));
      }),
      api("GET", "/api/screens").then(function (j) { data.screens = j.screens || []; }),
      // whoever the phone remote or this TV last set as watching
      api("GET", "/api/who").then(function (j) {
        return people.then(function () { if (PEOPLE.some(function (p) { return p.id === j.who; }) && !touched) { who = j.who; } });
      }),
      (TV || PREVIEW || MOCK) ? Promise.resolve() : api("GET", "/api/apps").then(function (j) { data.bridgeApps = j.apps || []; }),
      // the order arranged on the phone (or with this TV's remote)
      NIGHT ? api("GET", "/api/app-order").then(bridgeOrder) : Promise.resolve(),
      // Home settings: the bridge keeps a copy, so the phone and this TV agree
      // (a new design's widget values are sorted only after this first look, so the phone's town or photos win)
      syncSettings().then(wsAfterSync, function (e) { wsAfterSync(); throw e; }),
      // Android's Watch Next rows: this app may read them, the bridge's ADB may not. They name a
      // play an app gave no title for (Netflix sends none, Prime only its own name, issue #23).
      KW_ON ? sendWatchNext() : Promise.resolve(),
      // kids mode: the shelves as the phone left them (kids.js)
      window.KidsMode ? window.KidsMode.refresh() : Promise.resolve(),
      // the guest's name, if the phone remote changed it
      guestSync()
    ];
    return Promise.all(jobs.map(function (p) { return p.then(function () { return true; }, function () { return false; }); }))
      .then(function (ok) {
        if (lift || zone === "pmenu" || zone === "settings" || zone === "gear" || zone === "smart" || zone === "remind" || zone === "updask") return;
        data.bridge = ok[0] || ok[2];
        var apps = TV ? nativeApps() : (window.MOCK_APPS ? window.MOCK_APPS.slice() : null);
        if (!apps) apps = (data.bridgeApps || []).filter(function (a) { return a.installed !== false && a.id !== "home"; })
          .map(function (a) { return { kind: "app", id: a.id, name: a.name, package: a.package, colour: a.colour }; });
        data.apps = sortApps(apps);
        if (!data.bridge) {   // no bridge: the order this TV keeps itself
          var lo = kept("tvhome.order.tv");
          if (lo && lo.packages) data.order = { saved: true, line: lo.line, packages: lo.packages };
        }
        reportApps();
        detectNew();
        status(data.bridge ? "" : t("computer_quiet"), true);
        if (data.bridge) save();
        render();
        clearTimeout(retryTimer);
        if (!ok[0] && !ok[1]) { retryMs = Math.min(retryMs * 2, 60000); retryTimer = setTimeout(refresh, retryMs); }
        else retryMs = 2500;
      });
  }

  // ---------------- at home: what Couch TV Studio's home widgets show (athome.js) ----------------
  // The family note, lists, guest Wi-Fi, house guide, calendar link and screen time goal, typed in Home
  // settings, Designs, At home. Kept on this TV only: the launcher's private store on the
  // Android home (TVOS.keepPrivate: left out of Android's backups), else this page's own storage. Never
  // in ST (the copy of Home settings the bridge keeps), never in a design or Share this home.
  var AH = (function () {
    if (typeof CouchAtHome === "undefined") return null;
    var io = TV && TV.keepPrivate && TV.keptPrivate
      ? { get: function (k) { return TV.keptPrivate(PFX + k); }, set: function (k, v) { TV.keepPrivate(PFX + k, v); } }
      : { get: function (k) { try { return localStorage.getItem(PFX + k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(PFX + k, v); } catch (e) {} } };
    return { io: io, store: CouchAtHome.store(io) };
  })();
  var AH_KINDS = ["note", "list", "wifi", "guide", "agenda", "memory", "screentime"];
  function ahWants(kind) { return typeof CouchDesign !== "undefined" && CouchDesign.wantsKinds && CouchDesign.wantsKinds([kind]).length > 0; }
  function ahChanged() { if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("athome", Date.now()); }
  function ahRead(key) { try { var v = AH.io.get(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ahWrite(key, v) { try { AH.io.set(key, JSON.stringify(v)); } catch (e) {} }

  // the calendar: read every 15 minutes while an Agenda is on the home. The launcher reads it (no
  // computer); a TV whose home a computer runs asks that computer (POST /api/calendar on the bridge);
  // the home as a website can only read a calendar that lets web pages read it. Today and the next
  // seven days are kept (titles and times only), so the widget has them after a restart.
  var CAL = { at: 0, events: null, err: "", busy: false, url: "" }, CAL_WAIT = {}, CAL_MS = 15 * 60000;
  function calCan() { return TV && TV.calendar ? "tv" : !OFFLINE && !STANDALONE ? "bridge" : "web"; }
  function calFetch(url) {
    return new Promise(function (resolve, reject) {
      if (MOCK && window.MOCK_ICS != null) { setTimeout(function () { resolve(String(window.MOCK_ICS)); }, 50); return; }
      if (TV && TV.calendar) {
        var id = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
        CAL_WAIT[id] = { resolve: resolve, reject: reject };
        setTimeout(function () { if (CAL_WAIT[id]) { delete CAL_WAIT[id]; reject(new Error("timeout")); } }, 40000);
        try { TV.calendar(url, id); } catch (e) { delete CAL_WAIT[id]; reject(e); }
        return;
      }
      if (!OFFLINE && !MOCK) { api("POST", "/api/calendar", { url: url }, 40000).then(function (j) { if (j && typeof j.text === "string") resolve(j.text); else reject(new Error((j && j.error) || "no calendar")); }, reject); return; }
      var x = new XMLHttpRequest();
      x.open("GET", url);
      x.timeout = 30000;
      x.onload = function () { if (x.status >= 200 && x.status < 300) resolve(x.responseText || ""); else reject(new Error("http " + x.status)); };
      x.onerror = x.ontimeout = function () { reject(new Error("blocked")); };
      x.send();
    });
  }
  // the launcher's answer (MainActivity.calendar): ok, and the calendar's words or why not
  function calendarText(id, ok, text) {
    var w = CAL_WAIT[id];
    if (!w) return;
    delete CAL_WAIT[id];
    if (ok) w.resolve(String(text || "")); else w.reject(new Error(String(text || "failed")));
  }
  function calWindow() { var d = new Date(); var from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return { from: from, to: from + 8 * 86400000 }; }
  function calRefresh(force) {
    if (!AH) return;
    var url = (AH.store.get().cal || {}).url || "";
    if (!url) { CAL = { at: 0, events: null, err: "", busy: false, url: "" }; ahWrite("tvhome.athome.cal", null); return; }
    if (CAL.url !== url) { CAL.url = url; CAL.events = null; CAL.at = 0; CAL.err = ""; var kept0 = ahRead("tvhome.athome.cal"); if (kept0 && kept0.host === CouchAtHome.calHost(url) && Array.isArray(kept0.events)) { CAL.events = kept0.events; CAL.at = kept0.at || 0; } }
    if (CAL.busy || (!force && Date.now() - CAL.at < CAL_MS && CAL.events)) return;
    CAL.busy = true;
    calFetch(url).then(function (text) {
      CAL.busy = false;
      if (!CouchAtHome.isIcs(text)) { CAL.err = "That link is not a calendar. Use the calendar's private link. In Google Calendar it is called Secret address in iCal format."; ahChanged(); return; }
      var win = calWindow();
      CAL.events = CouchAtHome.parseIcs(text, win.from, win.to, 60);
      CAL.at = Date.now(); CAL.err = "";
      ahWrite("tvhome.athome.cal", { host: CouchAtHome.calHost(url), at: CAL.at, events: CAL.events });
      ahChanged();
      if (zone === "settings") renderSettings();
    }, function (e) {
      CAL.busy = false;
      var why = String((e && e.message) || "");
      CAL.err = /blocked/.test(why) ? "This TV cannot read that calendar by itself. It needs the Couch TV app on this TV or a home computer." : /http 40[134]/.test(why) ? "The calendar said no. Check the link is the private address and still works." : "The calendar did not answer. Couch TV tries again soon.";
      CAL.at = Date.now() - CAL_MS + 2 * 60000;   // try again in two minutes
      ahChanged();
      if (zone === "settings") renderSettings();
    });
  }

  // guests: the bookings calendar (Airbnb, Booking.com, VRBO, or the Agenda's own calendar), read the
  // same way as the Agenda's and as often, for the Welcome widget's guest name and check out time.
  // Five weeks back (a long stay that started a while ago) and two months on are kept, on this TV only.
  var STAY = { at: 0, events: null, err: "", busy: false, url: "" };
  function stayLink(r) { r = r || AH.store.get(); return (r.stay && r.stay.url) || (r.cal && r.cal.url) || ""; }
  function stayRefresh(force) {
    if (!AH) return;
    var url = stayLink();
    if (!url) { STAY = { at: 0, events: null, err: "", busy: false, url: "" }; ahWrite("tvhome.athome.stay", null); return; }
    if (STAY.url !== url) { STAY.url = url; STAY.events = null; STAY.at = 0; STAY.err = ""; var kept0 = ahRead("tvhome.athome.stay"); if (kept0 && kept0.host === CouchAtHome.calHost(url) && Array.isArray(kept0.events)) { STAY.events = kept0.events; STAY.at = kept0.at || 0; } }
    if (STAY.busy || (!force && Date.now() - STAY.at < CAL_MS && STAY.events)) return;
    STAY.busy = true;
    // guest names from the booking emails a home computer reads (bridge/bookings.py, as guest-tv does):
    // only with a bridge; with none, Airbnb guests' names are typed once in At home
    if (!OFFLINE && !MOCK && !PREVIEW) api("GET", "/api/stay-names", null, 30000).then(function (j) {
      STAY.mail = j && j.on && Array.isArray(j.names) ? j.names.slice(0, 60) : null; STAY.mailOn = !!(j && j.on); ahChanged();
    }, function () {});
    calFetch(url).then(function (text) {
      STAY.busy = false;
      if (!CouchAtHome.isIcs(text)) { STAY.err = "That link is not a calendar. Use the bookings calendar link from Airbnb, Booking.com or VRBO."; ahChanged(); return; }
      var d = new Date(), from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - 35 * 86400000;
      STAY.events = CouchAtHome.parseIcs(text, from, from + 100 * 86400000, 200);
      STAY.at = Date.now(); STAY.err = "";
      ahWrite("tvhome.athome.stay", { host: CouchAtHome.calHost(url), at: STAY.at, events: STAY.events });
      ahChanged();
      if (zone === "settings") renderSettings();
    }, function (e) {
      STAY.busy = false;
      var why = String((e && e.message) || "");
      STAY.err = /blocked/.test(why) ? "This TV cannot read that calendar by itself. It needs the Couch TV app on this TV or a home computer." : /http 40[134]/.test(why) ? "The calendar said no. Check the link is the private address and still works." : "The calendar did not answer. Couch TV tries again soon.";
      STAY.at = Date.now() - CAL_MS + 2 * 60000;
      ahChanged();
      if (zone === "settings") renderSettings();
    });
  }
  // where the house is in a stay now: CouchAtHome.stayNow with the times and names kept on this TV
  function stayView(r) {
    r = r || AH.store.get();
    var url = stayLink(r), s = r.stay || {};
    if (!url || !STAY.events) return null;
    return CouchAtHome.stayNow(STAY.events, Date.now(), { checkin: s.checkin, checkout: s.checkout, names: s.names, mail: STAY.mail, host: CouchAtHome.calHost(url), family: !s.url });
  }

  // when each photo was taken: the launcher notes it in the file name when a photo is added ("-t" and
  // the date, from the photo's own EXIF block); a photo by web address has its date read from its own
  // bytes once (if its host lets the TV read them) or from a date in its name. Kept on this TV.
  var DATES = null, DATES_BUSY = false;
  function photoDates() {
    if (!DATES) DATES = ahRead("tvhome.athome.dates") || {};
    return (Array.isArray(ST.photos) ? ST.photos : []).filter(function (p) { return p && (p.file || p.url); }).map(function (p) {
      var src = photoSrc(p), d = CouchAtHome.nameDate(p.file || p.url), k = DATES[src];
      if (!d && k) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k); if (m) d = { y: +m[1], m: +m[2], d: +m[3] }; }
      return { src: src, date: d, url: !p.file && !d && k === undefined ? p.url : "" };
    });
  }
  function photoDatesRead() {
    if (DATES_BUSY || !AH) return;
    var todo = photoDates().filter(function (p) { return p.url && /^https?:\/\//i.test(p.url); });
    if (!todo.length) return;
    DATES_BUSY = true;
    var next = function (i) {
      if (i >= todo.length || i >= 50) { DATES_BUSY = false; ahWrite("tvhome.athome.dates", DATES); ahChanged(); return; }
      var x = new XMLHttpRequest(), done = function (d) { DATES[todo[i].src] = d ? d.y + "-" + ("0" + d.m).slice(-2) + "-" + ("0" + d.d).slice(-2) : ""; next(i + 1); };
      try {
        x.open("GET", todo[i].url); x.responseType = "arraybuffer"; x.timeout = 20000;
        x.onload = function () { var d = null; try { d = x.status === 200 ? CouchAtHome.exifDate(new Uint8Array(x.response)) : null; } catch (e) {} done(d); };
        x.onerror = x.ontimeout = function () { done(null); };
        x.send();
      } catch (e) { done(null); }
    };
    next(0);
  }

  // screen time today: the launcher reads Android's own usage numbers, once one permission is allowed
  var SCR = { at: 0, v: null };
  function screenNow() {
    if (!TV) return { ok: false, why: "tv" };
    if (!TV.screenTime) return { ok: false, why: ON_TV ? "ontv" : "update" };
    if (!SCR.v || Date.now() - SCR.at > 60000) { SCR.at = Date.now(); try { SCR.v = JSON.parse(TV.screenTime()); } catch (e) { SCR.v = { ok: false, why: "error" }; } }
    return SCR.v || { ok: false, why: "error" };
  }

  // a bookings calendar of its own (At home, Guests), not the Agenda's own link read again
  function booksSet(r) { r = r || (AH ? AH.store.get() : {}); return !!(r.stay && r.stay.url && r.stay.url !== (r.cal || {}).url); }
  // the stays in it as the Agenda's events: "Check in, Sarah" on the first day, "Check out" on the last
  function booksEvents(r) {
    if (!STAY.events) return null;
    var s = r.stay || {}, out = [];
    // the end of that day, by the calendar (a daylight saving day is 23 or 25 hours, never a fixed 24)
    var dayAfter = function (ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
    CouchAtHome.staysOf(STAY.events, { names: s.names, mail: STAY.mail, host: CouchAtHome.calHost(s.url) }).forEach(function (x) {
      var who = x.guest ? ", " + x.guest : "";
      // the titles in the TV language (widget-lines.js), the guest name kept as it is
      var WL = typeof window !== "undefined" ? window.CouchWidgetLines : null, ln = function (en) { return WL ? (x.guest ? WL.t(en + ", {name}", { name: x.guest }) : WL.t(en)) : en + who; };
      out.push({ title: ln("Check in"), start: x.from, end: dayAfter(x.from), allDay: true });
      out.push({ title: ln("Check out"), start: x.to, end: dayAfter(x.to), allDay: true });
    });
    return out;
  }
  // what the widgets get (design.js hooks.data): only what is set, never a pretend value
  function homeView() {
    if (!AH) return null;
    var r = AH.store.get(), out = { note: r.note || null, lists: r.lists || [], wifi: null, guide: r.guide || [], goal: (r.screen || {}).goal || 0, guest: (r.guest && r.guest.name) || "" };
    // each photo's id, at the same place as data().photos, for a Photo or Art frame picked on this TV
    out.photoIds = (Array.isArray(ST.photos) ? ST.photos : []).filter(function (p) { return p && (p.file || p.url); }).map(function (p) { return p.id || ""; });
    if (r.wifi) out.wifi = { ssid: r.wifi.ssid, pass: r.wifi.pass, sec: r.wifi.sec, hidden: r.wifi.hidden, qr: CouchAtHome.wifiQr(r.wifi) };
    // a calendar link with nothing read yet: read it now, not at the next minute
    if (r.cal && !CAL.events && !CAL.busy && !CAL.err && ahWants("agenda")) setTimeout(function () { calRefresh(false); }, 0);
    out.cal = { set: !!r.cal, events: CAL.events, err: CAL.err, at: CAL.at, can: calCan() };
    // the Welcome widget's guest (name source "calendar" in a design): the stay now, from this TV's link
    if (stayLink(r) && !STAY.events && !STAY.busy && !STAY.err && ahWants("welcome")) setTimeout(function () { stayRefresh(false); }, 0);
    out.stay = { set: !!stayLink(r), view: stayView(r), err: STAY.err, at: STAY.at, can: calCan() };
    // the bookings calendar as the Agenda shows it: each stay's check in and check out day
    if (booksSet(r) && !STAY.events && !STAY.busy && !STAY.err && ahWants("agenda")) setTimeout(function () { stayRefresh(false); }, 0);
    out.books = { set: booksSet(r), events: booksSet(r) ? booksEvents(r) : null, err: STAY.err };
    var ps = photoDates();
    out.memory = { photos: ps.length, dated: ps.filter(function (p) { return p.date; }).length, today: CouchAtHome.onThisDay(ps, new Date()), week: CouchAtHome.nearDay(ps, new Date(), 3) };
    out.screen = ahWants("screentime") ? screenNow() : { ok: false, why: "off" };
    return out;
  }
  // every minute: a new day, a new calendar read, today's screen time
  function ahTick() {
    if (!AH || typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on()) return;
    if (ahWants("agenda")) { calRefresh(false); if (booksSet()) stayRefresh(false); }
    if (ahWants("welcome")) { stayRefresh(false); var sv = stayView(); CouchDesign.dataChanged("stay", sv ? [sv.phase, sv.guest, sv.checkout] : null); }
    if (ahWants("memory")) photoDatesRead();
    if (ahWants("screentime")) { var s = screenNow(); CouchDesign.dataChanged("screentime", [s.ok, s.minutes]); }
    // a new day: today's events, On this day's photos (the page drew the first day when it started)
    var day = new Date().toDateString();
    if (day !== AH_DAY) { AH_DAY = day; CouchDesign.dataChanged("athome-day", day); }
  }
  var AH_DAY = new Date().toDateString();
  // OK on a list item (widget-detail.js, the List layer): tick it
  function ahAct(what, arg) {
    if (!AH || what !== "tick") return false;
    var m = /^(\d+):(\d+)$/.exec(String(arg || ""));
    if (m && AH.store.tick(+m[1], +m[2])) ahChanged();
    return true;
  }
  // the guest's name now: typed on this TV (At home, Guests) or on the phone remote (More, Guest's name).
  // With the on-TV app or a computer at home the newest of the two wins, so both show the same name.
  function guestSet(name) {
    var at = Date.now();
    ahEdit(function (x) { var n = CouchAtHome.guestFull(name); if (n) x.guest = { name: n, at: at }; else x.guest = { name: "", at: at }; });
    ahWrite("tvhome.athome.guestat", at);
    if (!OFFLINE && !MOCK && !PREVIEW) api("POST", "/api/guest", { name: CouchAtHome.guestFull(name) }).then(function () {}, function () {});
  }
  function guestSync() {
    if (!AH || OFFLINE || MOCK || PREVIEW) return Promise.resolve();
    return api("GET", "/api/guest").then(function (j) {
      var g = j && j.guest, mine = ahRead("tvhome.athome.guestat") || 0, local = (AH.store.get().guest || {}).name || "";
      if (!g) return;
      // a bookings link sent from the phone remote: into this TV's own store, then cleared on the phone's side
      var su = g.stay_url ? CouchAtHome.calUrl(g.stay_url) : "";
      if (su) {
        STAY.err = ""; STAY.at = 0;
        ahEdit(function (x) { x.stay = x.stay || {}; x.stay.url = su; }, "Got it. The bookings link from the phone is on this TV now.");
        api("POST", "/api/guest", { stay_url: "" }).then(function () {}, function () {});
        stayRefresh(true);
      }
      if ((+g.at || 0) > mine) {
        var n = CouchAtHome.guestFull(g.name || "");
        ahWrite("tvhome.athome.guestat", +g.at);
        if (n !== local) { AH.store.edit(function (x) { x.guest = { name: n, at: +g.at }; }); ahChanged(); }
      } else if (mine > (+g.at || 0)) api("POST", "/api/guest", { name: local }).then(function () {}, function () {});
    }, function () {});
  }
  // At home from the phone's Home settings page (/setup on the on-TV app, the TV's own LAN page): the
  // app hands the phone's words in here (HomeActivity.atHome, the same way as typeText), so they stay
  // in this TV's own store like words typed with the remote. What the phone may read back: everything
  // it can change, except a calendar link, which comes back as its host only (the rest is its password).
  function atHomeView() {
    if (!AH) return null;
    var r = AH.store.get(), st = r.stay || {};
    return { note: r.note ? { text: r.note.text, from: r.note.from || "" } : null, lists: r.lists || [], wifi: r.wifi || null, guide: r.guide || [],
      // a calendar link's host only, and what the TV made of it (the phone's Check it): how many events it
      // found, whether it is still reading, or one plain reason. Never an event or the link itself.
      cal: r.cal ? { host: CouchAtHome.calHost(r.cal.url), count: CAL.url === r.cal.url && Array.isArray(CAL.events) ? CAL.events.length : null, busy: !!CAL.busy, error: CAL.url === r.cal.url ? CAL.err || "" : "" } : null,
      stay: { host: st.url ? CouchAtHome.calHost(st.url) : "", checkin: st.checkin || "15:00", checkout: st.checkout || "10:00",
        count: st.url && STAY.url === st.url && Array.isArray(STAY.events) ? STAY.events.length : null, busy: !!STAY.busy, error: st.url && STAY.url === st.url ? STAY.err || "" : "" },
      guest: (r.guest && r.guest.name) || "", lim: CouchAtHome.LIM, times_in: CouchAtHome.TIMES_IN, times_out: CouchAtHome.TIMES_OUT,
      // the design on screen, so the phone shows only what it uses (designView): rides along with At home,
      // the one answer the on-TV app already asks this page for, so no new way into the TV is needed
      design: designView() };
  }
  // e: { note: {text, from} or null, lists: [...], wifi: {...} or null, guide: [...], cal_url: "https://..." or "" to remove,
  //      stay_url, checkin, checkout }. Only the parts named change; athome.js clean() checks the whole record.
  // The design's own widgets from the phone (widget_set, design_apps) go to designEdit, outside At home.
  function atHomeEdit(e) {
    if (e && typeof e === "object" && (e.widget_set || e.design_apps)) return designEdit(e);
    if (!AH || !e || typeof e !== "object") return { ok: false, error: "At home is not in this version of the home." };
    var has = function (k) { return Object.prototype.hasOwnProperty.call(e, k); };
    var bad = "";
    var cal = has("cal_url") ? (e.cal_url ? CouchAtHome.calUrl(e.cal_url) : "") : null;
    var stay = has("stay_url") ? (e.stay_url ? CouchAtHome.calUrl(e.stay_url) : "") : null;
    if ((has("cal_url") && e.cal_url && !cal) || (has("stay_url") && e.stay_url && !stay)) bad = "That is not a calendar link. It starts with https://, or is a calendar app's own link.";
    if (bad) return { ok: false, error: bad };
    AH.store.edit(function (x) {
      if (has("note")) { if (e.note && String(e.note.text || "").trim()) x.note = { text: e.note.text, from: e.note.from || "", at: Date.now() }; else delete x.note; }
      if (has("lists")) x.lists = Array.isArray(e.lists) ? e.lists : [];
      if (has("wifi")) { if (e.wifi && String(e.wifi.ssid || "").trim()) x.wifi = e.wifi; else delete x.wifi; }
      if (has("guide")) x.guide = Array.isArray(e.guide) ? e.guide : [];
      if (cal !== null) { if (cal) x.cal = { url: cal }; else delete x.cal; }
      if (stay !== null || has("checkin") || has("checkout")) {
        var s = x.stay = x.stay || {};
        if (stay !== null) { if (stay) s.url = stay; else delete s.url; }
        if (has("checkin")) s.checkin = e.checkin;
        if (has("checkout")) s.checkout = e.checkout;
      }
    });
    ahChanged();
    if (cal !== null) { CAL.err = ""; CAL.at = 0; calRefresh(true); }
    if (stay !== null) { STAY.err = ""; STAY.at = 0; stayRefresh(true); }
    if (zone === "settings") renderSettings();
    return { ok: true, athome: atHomeView() };
  }
  // anything private typed here stops a Share this home that somehow holds it
  function ahPrivateWords() {
    if (!AH) return [];
    var r = AH.store.get(), w = [];
    if (r.wifi) w.push(r.wifi.ssid, r.wifi.pass);
    if (r.note) w.push(r.note.text);
    if (r.guest && r.guest.name) w.push(r.guest.name);
    if (r.cal) w.push(r.cal.url);
    if (r.stay) { if (r.stay.url) w.push(r.stay.url); Object.keys(r.stay.names || {}).forEach(function (k) { w.push(r.stay.names[k]); }); }
    (r.guide || []).forEach(function (g) { w.push(g.text); });
    return w;
  }

  // Home settings, Designs, At home: one page with the note, lists, Wi-Fi, guide, calendar and
  // screen time; a list and a guide entry each open their own page. English only for now, like the
  // rest of the Couch TV Studio section (needs i18n).
  var AH_INTRO = "Words for the widgets on your home. They stay on this TV and never go into a design or Share this home. Typing is quicker with Type on the TV in the phone remote.";
  function ahEdit(fn, msg) { AH.store.edit(fn); ahChanged(); if (msg) SET.msg = msg; }
  function ahType(label, value, submit, url) { startTyping({ label: label, value: value || "", url: !!url, submit: submit }); }
  function openAtHome() {
    SET.sub = { back: "dz-athome", crumb: "Designs", title: function () { return "At home"; }, rows: atHomeRows };
    SET.keyFocus = null; SET.ri = 0;
  }
  function atHomeRows() {
    if (!AH) return [info("ah-none", "At home", "", "Not in this version of the home.")];
    var r = AH.store.get(), rows = [info("ah-intro", "", "", AH_INTRO)], L = CouchAtHome.LIM;
    // the family note
    rows.push(head("Family note"));
    rows.push({ kind: "input", key: "ah-note", label: r.note ? "Change the note" : "Write a note", sub: r.note ? r.note.text : "Shows on the Family note widget", act: function () {
      ahType("Type the note", r.note && r.note.text, function (v) { ahEdit(function (x) { x.note = { text: v, from: x.note ? x.note.from : "", at: Date.now() }; }, String(v || "").trim() ? "The note is on the home." : ""); });
    } });
    if (r.note) {
      rows.push({ kind: "input", key: "ah-note-from", label: "From", value: r.note.from || "No name", act: function () {
        ahType("Who is it from? (a name, or leave it empty)", r.note.from, function (v) { ahEdit(function (x) { if (x.note) x.note.from = v; }); });
      } });
      rows.push({ kind: "action", key: "ah-note-clear", label: "Clear the note", danger: true, act: function () { ahEdit(function (x) { delete x.note; }, "The note is cleared."); } });
    }
    // lists
    rows.push(head("Lists"));
    (r.lists || []).forEach(function (l, li) {
      var left = l.items.filter(function (it) { return !it.done; }).length;
      rows.push({ kind: "nav", key: "ah-list:" + li, label: l.name, value: left ? left + " to do" : l.items.length ? "All done" : "Empty", act: function () { openList(li); } });
    });
    if ((r.lists || []).length < L.lists) rows.push({ kind: "input", key: "ah-list-add", label: "Add a list", sub: "Like Shopping or To do. Up to " + L.lists + " lists.", act: function () {
      ahType("Name the list", "", function (v) {
        var before = (AH.store.get().lists || []).length;
        ahEdit(function (x) { x.lists = (x.lists || []).concat([{ name: v, items: [] }]); });
        if ((AH.store.get().lists || []).length > before) openList(before);
      });
    } });
    // guest Wi-Fi
    rows.push(head("Guest Wi-Fi"));
    var w = r.wifi;
    // sent from the Couch TV Studio account (Your home): said so; a change here makes it this TV's own
    if (w && typeof CouchDesignCode !== "undefined" && CouchDesignCode.wifiFromAccount && CouchDesignCode.wifiFromAccount(ACCOUNT, w))
      rows.push(info("ah-wifi-account", t("from_account"), "", t("wifi_account_note")));
    rows.push({ kind: "input", key: "ah-wifi-name", label: "Network name", value: w ? w.ssid : "Not set", act: function () {
      ahType("Type the guest network's name, exactly as it shows on a phone", w && w.ssid, function (v) { ahEdit(function (x) { if (!String(v || "").trim()) { delete x.wifi; return; } x.wifi = x.wifi || { sec: "WPA", pass: "" }; x.wifi.ssid = v; }); });
    } });
    if (w) {
      if (w.sec !== "nopass") rows.push({ kind: "input", key: "ah-wifi-pass", label: "Password", value: w.pass ? w.pass : "Not set", act: function () {
        ahType("Type the guest network's password", w.pass, function (v) { ahEdit(function (x) { if (x.wifi) x.wifi.pass = v; }); });
      } });
      var SECW = { WPA: "WPA, WPA2 or WPA3 (most)", WEP: "WEP (old)", nopass: "No password" };
      rows.push({ kind: "cycle", key: "ah-wifi-sec", label: "Security", value: SECW[w.sec], act: function () {
        ahEdit(function (x) { var s = CouchAtHome.SEC; if (x.wifi) x.wifi.sec = s[(s.indexOf(x.wifi.sec) + 1) % s.length]; });
      } });
      rows.push({ kind: "toggle", key: "ah-wifi-hidden", label: "Hidden network", value: w.hidden ? t("on") : t("off"), act: function () { ahEdit(function (x) { if (x.wifi) x.wifi.hidden = !x.wifi.hidden; }); } });
      rows.push({ kind: "action", key: "ah-wifi-clear", label: "Remove the Wi-Fi details", danger: true, act: function () { ahEdit(function (x) { delete x.wifi; }, "The Wi-Fi details are removed."); } });
    }
    // the house guide
    rows.push(head("House guide"));
    (r.guide || []).forEach(function (g, gi) { rows.push({ kind: "nav", key: "ah-guide:" + gi, label: g.title, sub: g.text, act: function () { openGuide(gi); },
      move: function (d) { ahEdit(function (x) { var a = x.guide || [], j = gi + d; if (j < 0 || j >= a.length) return; var tmp = a[gi]; a[gi] = a[j]; a[j] = tmp; }); SET.lift = "ah-guide:" + (gi + d); } }); });
    if ((r.guide || []).length < L.guide) rows.push({ kind: "input", key: "ah-guide-add", label: "Add to the guide", sub: "A heading, like Check out, Bins or Around here, then its words", act: function () {
      ahType("Type the heading", "", function (v) {
        var before = (AH.store.get().guide || []).length;
        ahEdit(function (x) { x.guide = (x.guide || []).concat([{ title: v, text: "" }]); });
        if ((AH.store.get().guide || []).length > before) { openGuide(before); typeGuideWords(before); }
      });
    } });
    // the calendar
    rows.push(head("Calendar"));
    var host = r.cal ? CouchAtHome.calHost(r.cal.url) : "";
    rows.push({ kind: "input", key: "ah-cal", label: r.cal ? "Change the calendar link" : "Add a calendar link", value: host || "",
      sub: r.cal ? (CAL.err || (CAL.events ? CAL.events.length + " events this week, read at " + timeStr(new Date(CAL.at)) : CAL.busy ? "Reading it..." : "Read when an Agenda widget is on the home")) : "The private address of a Google, Apple or Outlook calendar. Keep it private: it opens your calendar.",
      act: function () {
        ahType("Paste or type the calendar's private address (it starts with https)", "", function (v) {
          var u = CouchAtHome.calUrl(v);
          if (!u) { SET.msg = "That is not a calendar link. It starts with https://, or is a calendar app's own link."; return; }
          CAL.err = ""; CAL.at = 0;   // a new link starts clean: no old "did not answer" under "Got it"
          ahEdit(function (x) { x.cal = { url: u }; }, "Got it. Reading the calendar now.");
          calRefresh(true);
        }, true);
      } });
    if (r.cal) {
      rows.push({ kind: "action", key: "ah-cal-now", label: "Read the calendar now", act: function () { calRefresh(true); SET.msg = "Reading the calendar..."; } });
      rows.push({ kind: "action", key: "ah-cal-clear", label: "Remove the calendar link", danger: true, act: function () { ahEdit(function (x) { delete x.cal; }, "The calendar link is removed from this TV."); calRefresh(true); } });
    }
    // guests: the bookings calendar for the Welcome widget's name and times
    rows.push(head("Guests"));
    var gname = (r.guest && r.guest.name) || "";
    rows.push({ kind: "input", key: "ah-guest", label: "Guest's name", value: gname || "No name",
      sub: gname ? "The Welcome widget says: Welcome, " + gname + ". Leave it empty to show just Welcome." : "Type who is staying, like Sarah or the Nguyen family. Empty, the Welcome widget says just Welcome. The phone remote can change it too (More, Guest's name).",
      act: function () { ahType("The guest's name (leave it empty to show just Welcome)", gname, function (v) { guestSet(v); SET.msg = CouchAtHome.guestFull(v) ? "The Welcome widget now greets " + CouchAtHome.guestFull(v) + "." : "The Welcome widget now says just Welcome."; }); } });
    var sr = r.stay || {}, shost = sr.url ? CouchAtHome.calHost(sr.url) : "", sv = stayView(r);
    rows.push({ kind: "input", key: "ah-stay", label: sr.url ? "Change the bookings link" : "Add a bookings calendar link", value: shost || (r.cal ? "Using the Agenda's" : ""),
      sub: sr.url || r.cal ? (STAY.err || (STAY.events ? (sv && sv.phase !== "between" ? (sv.guest || "A guest") + " is booked now" : sv && sv.next ? "Next stay starts " + shortDay(sv.next.from) : "No stays in the next two months") + ", read at " + timeStr(new Date(STAY.at)) : STAY.busy ? "Reading it..." : "Read when a Welcome widget with guest names is on the home"))
        : "Airbnb, Booking.com or VRBO's calendar link (export or sync calendar). The Welcome widget greets each guest and shows check out. Keep it private.",
      act: function () {
        ahType("Paste or type the bookings calendar's private address. Long links are easier from the phone remote: More, Type on the TV", "", function (v) {
          var u = CouchAtHome.calUrl(v);
          if (!u) { SET.msg = "That is not a calendar link. It starts with https://, or is a calendar app's own link."; return; }
          STAY.err = ""; STAY.at = 0;
          ahEdit(function (x) { x.stay = x.stay || {}; x.stay.url = u; }, "Got it. Reading the bookings calendar now.");
          stayRefresh(true);
        }, true);
      } });
    rows.push({ kind: "cycle", key: "ah-stay-in", label: "Check in from", value: sr.checkin || "15:00", act: function () {
      ahEdit(function (x) { var l = CouchAtHome.TIMES_IN, s = x.stay = x.stay || {}; s.checkin = l[(l.indexOf(s.checkin || "15:00") + 1) % l.length]; });
    } });
    rows.push({ kind: "cycle", key: "ah-stay-out", label: "Check out by", value: sr.checkout || "10:00", act: function () {
      ahEdit(function (x) { var l = CouchAtHome.TIMES_OUT, s = x.stay = x.stay || {}; s.checkout = l[(l.indexOf(s.checkout || "10:00") + 1) % l.length]; });
    } });
    // Airbnb's link has no names: the host types one per stay (it wins over a name in the calendar)
    var target = sv && sv.phase !== "between" ? sv : sv && sv.next;
    if (target) rows.push({ kind: "input", key: "ah-stay-name", label: (sv && sv.phase !== "between" ? "This stay's guest" : "Next guest") + ", from " + shortDay(target.from),
      value: target.guest || "No name", sub: STAY.mailOn ? "Read from your booking emails by the home computer. Type a name here to use another." : "Airbnb's calendar has no names: type the first name once, or let a home computer read your booking emails (setup guide, Guests).", act: function () {
        ahType("The guest's first name for this stay", target.guest || "", function (v) {
          ahEdit(function (x) { var s = x.stay = x.stay || {}; s.names = s.names || {}; var w = CouchAtHome.guestWord(v); if (w) s.names[target.key] = w; else delete s.names[target.key]; });
        });
      } });
    if (sr.url) rows.push({ kind: "action", key: "ah-stay-clear", label: "Remove the bookings link", danger: true, act: function () { ahEdit(function (x) { if (x.stay) delete x.stay.url; }, "The bookings link is removed from this TV."); stayRefresh(true); } });
    // screen time
    rows.push(head("Screen time"));
    var s = screenNow(), goal = (r.screen || {}).goal || 0;
    rows.push(info("ah-screen", "Today", s.ok ? CouchAtHome.hm(s.minutes) : "", s.ok ? "Time in apps on this TV today." : s.why === "access" ? "This TV has not allowed Couch TV to read screen time yet." : s.why === "tv" ? "This TV does not share screen time: it needs a Google TV, Android TV or Fire TV." : s.why === "ontv" ? "Screen time needs Couch TV set up once from a computer, with the free Setup app. The app put on with just a phone cannot read it." : "Needs the Couch TV home app 0.13.2 or newer: Home settings, Updates."));
    rows.push({ kind: "cycle", key: "ah-goal", label: "Daily goal", value: goal ? CouchAtHome.hm(goal) : t("off"), act: function () {
      ahEdit(function (x) { var g = CouchAtHome.GOALS, i = g.indexOf((x.screen || {}).goal || 0); x.screen = { goal: g[(i + 1) % g.length] }; });
    } });
    if (s.why === "access" && TV && TV.openUsageAccess) rows.push({ kind: "action", key: "ah-screen-allow", label: "Allow screen time", sub: "Opens the TV's Usage access list: switch on Home", act: function () { if (!TV.openUsageAccess()) SET.msg = "This TV has no such screen. Ask whoever set up Couch TV to switch on screen time from their computer."; SCR.at = 0; } });
    return rows;
  }
  function timeStr(d) { var h = d.getHours(), m = d.getMinutes(); return CLOCK24 ? h + ":" + (m < 10 ? "0" : "") + m : (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? "am" : "pm"); }
  function shortDay(ms) { var d = new Date(ms); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]; }
  function openList(li) {
    var up = SET.sub;
    SET.sub = { up: up, back: "ah-list:" + li, crumb: "At home", title: function () { var l = (AH.store.get().lists || [])[li]; return l ? l.name : ""; }, rows: function () {
      var l = (AH.store.get().lists || [])[li];
      if (!l) return [];
      var rows = l.items.map(function (it, ii) {
        return { kind: "check", key: "ah-item:" + ii, label: it.t, checked: it.done, act: function () { AH.store.tick(li, ii); ahChanged(); },
          move: function (d) { ahEdit(function (x) { var a = x.lists[li].items, j = ii + d; if (j < 0 || j >= a.length) return; var tmp = a[ii]; a[ii] = a[j]; a[j] = tmp; }); SET.lift = "ah-item:" + (ii + d); } };
      });
      if (!rows.length) rows.push(info("ah-items-none", "", "", "Nothing on this list yet."));
      var addOne = function () {
        ahType("Add to " + l.name + " (Back when you are done)", "", function (v) {
          if (!String(v || "").trim()) return;
          ahEdit(function (x) { var it = x.lists[li].items; if (it.length < CouchAtHome.LIM.items) it.push({ t: v, done: false }); });
          setTimeout(function () { if (zone === "settings" && SET.sub && SET.sub.back === "ah-list:" + li) addOne(); }, 60);
        });
      };
      if (l.items.length < CouchAtHome.LIM.items) rows.push({ kind: "input", key: "ah-item-add", label: "Add an item", act: addOne });
      if (l.items.some(function (it) { return it.done; })) rows.push({ kind: "action", key: "ah-item-clear", label: "Clear ticked items", act: function () { ahEdit(function (x) { x.lists[li].items = x.lists[li].items.filter(function (it) { return !it.done; }); }); } });
      rows.push({ kind: "input", key: "ah-list-name", label: "Rename the list", value: l.name, act: function () { ahType("Name the list", l.name, function (v) { ahEdit(function (x) { if (String(v || "").trim()) x.lists[li].name = v; }); }); } });
      rows.push({ kind: "action", key: "ah-list-remove", label: "Remove this list", danger: true, act: function () { ahEdit(function (x) { x.lists.splice(li, 1); }, "The list is removed."); SET.sub = up; SET.keyFocus = "ah-list-add"; } });
      return rows;
    } };
    SET.keyFocus = null; SET.ri = 0;
  }
  function typeGuideWords(gi) {
    var g = (AH.store.get().guide || [])[gi];
    if (g) ahType("Type the words for " + g.title, g.text, function (v) { ahEdit(function (x) { if (x.guide && x.guide[gi]) x.guide[gi].text = v; }); });
  }
  function openGuide(gi) {
    var up = SET.sub;
    SET.sub = { up: up, back: "ah-guide:" + gi, crumb: "At home", title: function () { var g = (AH.store.get().guide || [])[gi]; return g ? g.title : ""; }, rows: function () {
      var g = (AH.store.get().guide || [])[gi];
      if (!g) return [];
      return [
        { kind: "input", key: "ah-g-title", label: "Heading", value: g.title, act: function () { ahType("Type the heading", g.title, function (v) { ahEdit(function (x) { if (String(v || "").trim()) x.guide[gi].title = v; }); }); } },
        { kind: "input", key: "ah-g-text", label: "Words", sub: g.text || "None yet", act: function () { typeGuideWords(gi); } },
        { kind: "action", key: "ah-g-remove", label: "Remove from the guide", danger: true, act: function () { ahEdit(function (x) { x.guide.splice(gi, 1); }); SET.sub = up; SET.keyFocus = "ah-guide-add"; } }
      ];
    } };
    SET.keyFocus = null; SET.ri = 0;
  }

  // ---- Home settings, Smart home, Matter devices (matter.js) ----
  // The lights, plugs, fans, blinds, thermostats and sensors already in Google Home, Apple Home,
  // SmartThings or Alexa, shared to this TV with a pairing code. They show under the Home Assistant
  // rows of the Smart home screen, each with Rename and Remove, and Add a Matter device says where each
  // app keeps the code. Only where a Matter controller answers (this TV's app or the home computer).
  // Every line is in the TV's language: mw(key) reads matter-words.js (one table for the TV and the phone).
  function mw(key, vars) { var W = window.CouchMatterWords; return W ? W.t(key, vars) : key; }
  // the error keys the screens put in words (matter.js's checks, the controllers' answers)
  var MT_ERR = { short: 1, typo: 1, code: 1, expired: 1, wrong_code: 1, unreachable: 1, thread: 1, already: 1, not_allowed: 1, unavailable: 1, name_hides: 1, refused: 1, unsupported: 1, busy: 1, timeout: 1, off: 1, failed: 1 };
  // a controller's reason key (contract change 14): why Matter is not ready, or why a device was not
  // added, moved, renamed or fully removed; worded before the error key
  var MT_WHY = { off: 1, not_installed: 1, node_missing: 1, node_old: 1, starting: 1, stopped: 1, android_old: 1, processor: 1, not_started: 1, busy: 1,
    blocked: 1, unsupported: 1, address: 1, port: 1, link_local: 1, offline: 1, not_answering: 1, opens_house: 1,
    not_found: 1, not_allowed: 1, bad_request: 1, bad_name: 1, not_ready: 1, device_refused: 1, failed: 1, not_certified: 1, local_network: 1 };
  // a key in plain words; a controller's own sentence only when there is no key for it
  function mtSay(r) {
    r = r || {};
    if (r.reason && MT_WHY[r.reason]) return mw("why_" + r.reason);   // the home computer's Matter is not running
    if (r.error && r.error !== "failed" && MT_ERR[r.error]) return mw("err_" + r.error);
    return r.note || mw("err_failed");
  }
  var MT_APPS = [["brand_google", "app_google"], ["brand_apple", "app_apple"], ["SmartThings", "app_smartthings"], ["Alexa", "app_alexa"]];
  function matterRows(rows) {
    var M = window.CouchMatter;
    if (!M || !M.on()) return rows;
    rows.push(head(mw("title")));
    if (!M.ready()) rows.push(info("mt-wait", "", "", MT_WHY[M.reason()] ? mw("why_" + M.reason()) : M.note() || mw("getting_ready")));
    M.list().forEach(function (d) {
      rows.push({ kind: "nav", key: "mt-d:" + d.entity, label: d.name, value: d.words, act: function () { openMatterDevice(d.entity); } });
    });
    rows.push({ kind: "nav", key: "mt-add", label: mw("add"), sub: mw("add_sub"), act: openMatterAdd });
    return rows;
  }
  function openMatterAdd() {
    var up = SET.sub;
    MT_ADD.link = "";
    if (ON_TV && !OFFLINE) api("GET", "/api/phone-link").then(function (j) { if (j && /^http:\/\/[^\/]+\/setup/.test(j.url || "")) { MT_ADD.link = j.url; if (zone === "settings") renderSettings(); } }, function () {});
    SET.sub = { up: up, back: "mt-add", crumb: "Smart home", title: function () { return mw("add"); }, rows: function () {
      var rows = [info("mt-how", "", "", mw("how"))];
      if (MT_ADD.link && window.TVQR) rows.push({ kind: "qr", key: "mt-qr", link: MT_ADD.link, label: mw("easier"), sub: mw("easier_sub") });
      rows.push({ kind: "input", key: "mt-code", label: mw("type"), value: MT_ADD.busy ? mw("adding_short") : "", sub: mw("type_sub"), act: function () {
        if (MT_ADD.busy) return;
        ahType(mw("type_label"), "", function (v) { matterAdd(v); });
      } });
      rows.push(head(mw("where")));
      MT_APPS.forEach(function (a, i) { rows.push(info("mt-app:" + i, /^brand_/.test(a[0]) ? mw(a[0]) : a[0], "", mw(a[1]))); });
      return rows;
    } };
    SET.keyFocus = null; SET.ri = 0;
  }
  var MT_ADD = { busy: false, link: "" };
  function matterAdd(text) {
    var M = window.CouchMatter, c = M.checkCode(text);
    if (!c.ok) { SET.msg = mtSay(c); if (zone === "settings") renderSettings(); return; }
    MT_ADD.busy = true; SET.msg = mw("adding");
    if (zone === "settings") renderSettings();
    M.commission(c.code).then(function (r) {
      MT_ADD.busy = false;
      SET.msg = r.ok ? (r.added && r.added.length ? mw("added_names", { names: r.added.join(", ") }) : mw("added_later")) : mtSay(r);
      if (zone === "settings") renderSettings();
    });
  }
  function openMatterDevice(entity) {
    var up = SET.sub, M = window.CouchMatter;
    var dev = function () { return M.list().filter(function (d) { return d.entity === entity; })[0]; };
    SET.sub = { up: up, back: "mt-d:" + entity, crumb: "Smart home", title: function () { var d = dev(); return d ? d.name : mw("device"); }, rows: function () {
      var d = dev();
      if (!d) return [info("mt-gone", "", "", mw("gone"))];
      return [info("mt-now", d.words, "", ""),
        { kind: "input", key: "mt-rename", label: mw("rename"), value: d.name, sub: mw("rename_sub"), act: function () {
          ahType(mw("name_for", { name: d.name }), d.name, function (v) {
            v = String(v || "").trim();
            if (!v) return;
            SET.msg = mw("saving");
            // a name that would hide it: matter.js's own check (name_hides) or the controller's reason opens_house
            M.rename(entity, v).then(function (r) { SET.msg = r.ok ? mw("renamed") : mtSay(r); if (zone === "settings") renderSettings(); });
          });
        } },
        { kind: "action", key: "mt-remove", label: mw("remove_tv"), danger: true, confirmText: mw("press_ok"), sub: mw("stays"), act: function () {
          SET.msg = mw("removing");
          M.remove(entity).then(function (r) { SET.msg = r.ok ? mw("removed") + (MT_WHY[r.reason] ? " " + mw("why_" + r.reason) : r.unanswered ? " " + mw("no_answer") : "") : mtSay(r); if (r.ok) SET.sub = up; if (zone === "settings") renderSettings(); });
        } }];
    } };
    SET.keyFocus = null; SET.ri = 0;
  }
  if (window.CouchMatter) window.CouchMatter.onChange(function () { if (zone === "settings") renderSettings(); });

  // ---- Home settings, Designs, Smart home: Home Assistant set up on the TV, no computer ----
  // The launcher (HomeAssistant.kt) or, on a TV whose home a computer runs, that computer's bridge
  // checks the address and token and lists what Home Assistant has; the person ticks what shows. The
  // token is handed over once and never comes back to this page. English only, like the rest of the
  // Couch TV Studio section (needs i18n).
  var SH = { addr: "http://homeassistant.local:8123", list: null, picks: null, busy: false, err: "" };
  // the groups, their limits and how ticks are kept: ha-picks.js, shared with the phone page
  function HP() { return window.HaPicks; }
  var SH_ERR = { address: "That is not an address. It looks like http://homeassistant.local:8123 or http://192.168.1.20:8123.",
    token: "Home Assistant did not accept that key. Make a new one and paste all of it.",
    unreachable: "The TV could not reach Home Assistant at that address. Check it is on and on the same Wi-Fi. If homeassistant.local does not work, use its number address from Home Assistant: Settings, System, Network.",
    not_ha: "Something answered at that address, but it is not Home Assistant. Check the address and the port (usually 8123).",
    refused: "This copy of the home cannot set up smart home.", bridge: "The home computer did not answer. Check Couch TV is running on it.",
    timeout: "That took too long. Try again.", check: "Connect first, then pick what shows.", picks: "That could not be kept. Pick again." };
  function shPicksFrom(st) { return HP().fromStatus(st); }
  function shSection(p) { return HP().section(p); }
  function shCheck(token) {
    SH.busy = true; SH.err = ""; SET.msg = "Asking Home Assistant...";
    // no token: the one kept, with only the address kept with it (an empty address); the kept token
    // is never sent to a newly typed address
    window.smartHome.setup.check(token ? SH.addr : "", token).then(function (r) {
      SH.busy = false;
      if (r.ok) { SH.list = r.entities || []; if (!SH.picks) SH.picks = shPicksFrom(window.smartHome.setup.status()); SET.msg = "Connected. " + SH.list.length + " things found: pick what shows on this TV."; }
      else { SH.err = SH_ERR[r.error] || SH_ERR.unreachable; SET.msg = SH.err; }
      if (zone === "settings") renderSettings();
    });
  }
  function openSmartSetup() {
    SH.list = null; SH.err = ""; SH.picks = null;
    SHP.url = ""; SHP.err = ""; SHP.st = null; SHP.seen = false;
    SET.sub = { back: "dz-smart", crumb: "Designs", title: function () { return "Smart home"; }, rows: function () { return matterRows(smartRows()); }, smart: true };
    if (window.CouchMatter && window.CouchMatter.on()) window.CouchMatter.refresh();
    SET.keyFocus = null; SET.ri = 0;
    var S = window.smartHome.setup;
    if (S.canPhone && S.canPhone()) shPhone();
  }

  // ---- set up from a phone (HaPhone.kt): one QR code on the TV, everything else on the phone ----
  // The phone page signs in to Home Assistant itself (the TV keeps the tokens, never the phone) and
  // ticks what shows. While this screen is open the TV asks every few seconds, so it shows the moment
  // the phone is done; the phone's save also makes the TV redraw by itself (smartHome.phoneChanged).
  var SHP = { url: "", err: "", st: null, seen: false, timer: 0 };
  function shOnScreen() { return zone === "settings" && SET.sub && SET.sub.smart; }
  function shPhone() {
    var S = window.smartHome.setup;
    if (!S.canPhone || !S.canPhone()) return;
    S.phone().then(function (r) {
      var was = JSON.stringify([SHP.url, SHP.err, SHP.seen, SHP.st && SHP.st.set, SHP.st && SHP.st.host, SHP.st && SHP.st.count, SHP.st && SHP.st.signin_again]);
      if (r && r.ok && r.url) {
        SHP.url = r.url;
        // the phone signed in or saved: the home's smart home tile and widgets read it again too
        var kept = SHP.st && [SHP.st.set, SHP.st.host, SHP.st.count].join("|");
        if (SHP.st && kept !== [r.set, r.host, r.count].join("|") && window.smartHome.phoneChanged) window.smartHome.phoneChanged();
        SHP.err = ""; SHP.seen = !!r.seen; SHP.st = r;
      } else SHP.err = r && r.error === "network" ? "Connect this TV to your Wi-Fi first." : "That did not work. Open Smart home again.";
      var now = JSON.stringify([SHP.url, SHP.err, SHP.seen, SHP.st && SHP.st.set, SHP.st && SHP.st.host, SHP.st && SHP.st.count, SHP.st && SHP.st.signin_again]);
      if (now !== was && shOnScreen()) renderSettings();
    });
    clearTimeout(SHP.timer);
    SHP.timer = setTimeout(function () { if (shOnScreen()) shPhone(); }, 3000);
  }
  function phoneRows(S) {
    var st = SHP.st || S.status(), rows = [];
    // one QR code and one short line; the rest (which Home Assistant, signing in, what shows, the
    // brands we don't list) is on the phone
    if (SHP.url && window.TVQR) rows.push({ kind: "qr", key: "sh-qr", link: SHP.url + (window.I18N && /\?/.test(SHP.url) ? "&l=" + encodeURIComponent(window.I18N.lang()) : ""),   // the phone page speaks the TV's language (phone-words.js)
      label: st.signin_again ? "Sign in again. Home Assistant signed this TV out: scan with your phone."
        : st.set ? "Connected to " + (st.host || "Home Assistant") + ". Scan to change what shows." : SHP.seen ? "Carry on with your phone." : "Scan with your phone to connect your home." });
    else rows.push(info("sh-wait", "", "", SHP.err || "Getting ready..."));
    if (st.set) rows.push({ kind: "action", key: "sh-forget", label: "Disconnect", danger: true, confirmText: "Press OK again to disconnect", act: function () {
      S.forget().then(function () { SET.msg = "Smart home is off on this TV."; SHP.st = null; if (zone === "settings") { shPhone(); renderSettings(); } });
    } });
    // a computer at home also does Philips Hue and AirTouch 5 with no Home Assistant (bridge/direct.py)
    if (window.TVHA && !OFFLINE && !MOCK && !PREVIEW) rows.push({ kind: "nav", key: "sh-direct", label: "Hue or AirTouch without Home Assistant", act: function () {
      var up = SET.sub;
      SET.sub = { up: up, back: "sh-direct", crumb: "Smart home", title: function () { return "Hue and AirTouch"; }, rows: function () { var r = []; directRows(r); return r; } };
      SET.keyFocus = null; SET.ri = 0;
    } });
    return rows;
  }
  if (window.smartHome && window.smartHome.onPhone) window.smartHome.onPhone(function () { if (shOnScreen()) shPhone(); });

  function smartRows() {
    var S = window.smartHome.setup, st = S.status(), rows = [];
    if (S.canPhone && S.canPhone()) return phoneRows(S);
    // only where no phone page is served (an older bridge, or the preview): the address and a token
    // are typed here
    rows.push(info("sh-intro", "", "", "Shows your air conditioning, lights, cameras, speakers, solar and more through Home Assistant, the free smart home app that talks to over 2,000 brands. Everything stays on this TV" + (TV ? "." : " and the home computer.")));
    if (st.set) rows.push(info("sh-on", "Connected", st.host || "", "Pick Change what shows to add or take away things."));
    rows.push(head("1. Home Assistant at home"));
    rows.push(info("sh-ha", "", "", "Already have it? Go to step 2. If not: it runs on a small box (Home Assistant Green) or a spare computer at home, and finds most smart devices by itself. Start at home-assistant.io/installation on your phone."));
    rows.push(head("2. Connect"));
    rows.push({ kind: "input", key: "sh-addr", label: "Home Assistant's address", value: SH.addr, sub: "Usually http://homeassistant.local:8123. Or its number address from Home Assistant: Settings, System, Network.", act: function () {
      ahType("Home Assistant's address", SH.addr, function (v) { v = String(v || "").trim(); if (v) SH.addr = /^https?:\/\//i.test(v) ? v : "http://" + v; }, true);
    } });
    rows.push({ kind: "input", key: "sh-token", label: st.set ? "Paste a new access key" : "Paste the access key", value: st.set ? "Kept on this TV" : "",
      sub: "This key lets the TV read Home Assistant. In Home Assistant on your phone: tap your name (bottom left), Security, Long-lived access tokens, Create token, name it TV, then copy it. Paste it here with the phone remote's Type on the TV. Best made as a separate user for the TV, not your main account.", act: function () {
        ahType("Paste the access key from Home Assistant", "", function (v) { v = String(v || "").trim(); if (v) shCheck(v); }, true);
      } });
    if (st.set && !SH.list) rows.push({ kind: "action", key: "sh-change", label: "Change what shows", sub: "Reads what Home Assistant has now, with the saved key", act: function () { shCheck(""); } });
    if (SH.list) {
      rows.push(head("3. Pick what shows"));
      HP().GROUPS.forEach(function (g) {
        var have = HP().have(SH.list, g);
        if (!have.length) return;
        var picked = (SH.picks[g[0]] || []).filter(function (id) { return have.some(function (e) { return e.entity === id; }); });
        rows.push({ kind: "nav", key: "sh-g:" + g[0], label: g[1], value: picked.length ? picked.length + " picked" : "None", act: function () { openSmartGroup(g, have); } });
      });
      rows.push({ kind: "action", key: "sh-save", label: "Save and show on the home", sub: "Then add the widgets in your design on your phone, or open the Smart home tile in your apps", act: function () {
        SET.msg = "Saving...";
        S.save(shSection(SH.picks)).then(function (r) { SET.msg = r.ok ? "Saved. Smart home is on this TV." : SH_ERR[r.error] || SH_ERR.picks; if (r.ok) SH.list = null; if (zone === "settings") renderSettings(); });
      } });
    }
    if (!OFFLINE && !MOCK && !PREVIEW) directRows(rows);
    // the guide for brands we don't list lives on the phone page (ha-phone.html), not on the TV
    rows.push(info("sh-more", "A device we don't list", "", "Add it to Home Assistant first. Search the brand at home-assistant.io/integrations on your phone."));
    if (st.set) rows.push({ kind: "action", key: "sh-forget", label: "Disconnect smart home", danger: true, sub: "Removes the address and key from this TV. Also delete the key in Home Assistant (Security, Long-lived access tokens).", act: function () {
      S.forget().then(function () { SH.list = null; SH.picks = null; SET.msg = "Smart home is off on this TV."; if (zone === "settings") renderSettings(); });
    } });
    return rows;
  }
  // ---- Philips Hue and AirTouch 5 with no Home Assistant, through the home computer (bridge/direct.py) ----
  // The Hue bridge is paired by its round link button; the AirTouch console is found on the Wi-Fi. A TV
  // cannot open the AirTouch console's own port from this page, so both live on the home computer, which
  // keeps the Hue key (bridge/data/direct.json) and never sends it here.
  var DIR = { st: null, hueAddr: "", atAddr: "", lights: null, picked: [] };
  var DIR_ERR = { address: "That is not an address on your home Wi-Fi. It looks like 192.168.1.x, with a number for the x.",
    button: "Press the round button on top of the Hue bridge, then pick Pair within 30 seconds.",
    unreachable: "Nothing answered at that address. Check it is on and on the same Wi-Fi as the home computer.",
    not_hue: "Something answered, but it is not a Hue bridge.", none: "No AirTouch console answered on the Wi-Fi. Type its address instead (on the console: Settings, Network).",
    library: "The home computer needs an update for AirTouch. Whoever set up Couch TV can run the AirTouch step in the setup guide.",
    pair: "Pair the Hue bridge first.", refused: "That could not be done.", bridge: "The home computer did not answer. Check Couch TV is running on it." };
  function dirAsk(body, then) {
    SET.msg = "Asking the home computer...";
    if (zone === "settings") renderSettings();
    api("POST", "/api/ha/direct", body, 25000).then(function (r) {
      DIR.st = r && r.status || DIR.st;
      var res = r && r.result || { ok: false };
      SET.msg = res.ok ? "" : DIR_ERR[res.error] || DIR_ERR.refused;
      if (res.ok && then) then(res);
      if (res.ok && window.smartHome && window.smartHome.rebridge) window.smartHome.rebridge(api);
      if (zone === "settings") renderSettings();
    }, function () { SET.msg = DIR_ERR.bridge; if (zone === "settings") renderSettings(); });
  }
  function directRows(rows) {
    if (!DIR.st) { DIR.st = {}; dirAsk({ action: "status" }); }
    var st = DIR.st || {};
    rows.push(head("Philips Hue, straight from the Hue bridge"));
    rows.push(info("dh-intro", "", "", "No Home Assistant needed. The home computer talks to the Hue bridge on your Wi-Fi, and the lights you tick show in a design's Control Centre widget."));
    if (st.hue) rows.push(info("dh-on", "Paired", st.hue_lights ? st.hue_lights + " lights show" : "No lights ticked yet", ""));
    rows.push({ kind: "input", key: "dh-addr", label: "Hue bridge address", value: DIR.hueAddr, sub: "In the Hue app: Settings, Bridges, the i button, IP address.", act: function () {
      ahType("Hue bridge address", DIR.hueAddr, function (v) { DIR.hueAddr = String(v || "").trim(); }, true);
    } });
    rows.push({ kind: "action", key: "dh-pair", label: "Pair", sub: "Press the round button on top of the Hue bridge first, then pick this within 30 seconds", act: function () {
      dirAsk({ action: "hue_pair", address: DIR.hueAddr }, function (r) { DIR.lights = r.lights || []; DIR.picked = []; SET.msg = "Paired. Tick the lights to show."; });
    } });
    if (st.hue) rows.push({ kind: "nav", key: "dh-lights", label: "Pick the lights", value: st.hue_lights ? st.hue_lights + " picked" : "None", act: function () {
      dirAsk({ action: "hue_lights" }, function (r) { DIR.lights = r.lights || []; DIR.picked = (r.picked || []).slice(); openDirectLights(); });
    } });
    if (st.hue) rows.push({ kind: "action", key: "dh-forget", label: "Unpair the Hue bridge", danger: true, sub: "The home computer forgets it. Also remove couch-tv (the name the Hue app shows) in the Hue app: Settings, Apps", act: function () { dirAsk({ action: "hue_forget" }); } });
    rows.push(head("AirTouch 5 aircon, straight from the console"));
    rows.push(info("dt-intro", "", "", "No Home Assistant needed. Each zone shows as a room you can switch on and off and set the temperature of. Cooling or heating stays as set on the wall."));
    if (st.airtouch) rows.push(info("dt-on", "Connected", "", ""));
    rows.push({ kind: "action", key: "dt-find", label: "Find the console", sub: "Looks for an AirTouch 5 on the Wi-Fi", act: function () {
      dirAsk({ action: "airtouch_find" }, function (r) { DIR.atAddr = (r.found || [])[0] || DIR.atAddr; SET.msg = "Found it. Pick Connect."; });
    } });
    rows.push({ kind: "input", key: "dt-addr", label: "Console address", value: DIR.atAddr, sub: "Found above, or on the console: Settings, Network.", act: function () {
      ahType("AirTouch console address", DIR.atAddr, function (v) { DIR.atAddr = String(v || "").trim(); }, true);
    } });
    rows.push({ kind: "action", key: "dt-save", label: "Connect", sub: "Reads the zones once to check", act: function () {
      dirAsk({ action: "airtouch_save", address: DIR.atAddr }, function (r) { SET.msg = "Connected: " + (r.zones || []).length + " zones. Open the Smart home tile in your apps."; });
    } });
    if (st.airtouch) rows.push({ kind: "action", key: "dt-forget", label: "Disconnect the AirTouch", danger: true, sub: "The aircon is not changed", act: function () { dirAsk({ action: "airtouch_forget" }); } });
  }
  function openDirectLights() {
    var up = SET.sub;
    SET.sub = { up: up, back: "dh-lights", crumb: "Smart home", title: function () { return "Hue lights"; }, rows: function () {
      var rows = [info("dh-most", "", "", "Pick up to 16. They show in this order.")];
      (DIR.lights || []).forEach(function (l) {
        rows.push({ kind: "check", key: "dh-l:" + l.id, label: l.name, checked: DIR.picked.indexOf(l.id) >= 0, act: function () {
          var i = DIR.picked.indexOf(l.id);
          if (i >= 0) DIR.picked.splice(i, 1); else if (DIR.picked.length < 16) DIR.picked.push(l.id); else SET.msg = "That is the most. Untick one first.";
        } });
      });
      rows.push({ kind: "action", key: "dh-save", label: "Save", act: function () { SET.sub = up; dirAsk({ action: "hue_save", lights: DIR.picked }, function () { SET.msg = "Saved. Add a Control Centre widget in Couch TV Studio to see them."; }); } });
      return rows;
    } };
    SET.keyFocus = null; SET.ri = 0;
  }
  function openSmartGroup(g, have) {
    var up = SET.sub;
    SET.sub = { up: up, back: "sh-g:" + g[0], crumb: "Smart home", title: function () { return g[1]; }, rows: function () {
      var cur = SH.picks[g[0]] = SH.picks[g[0]] || [];
      var rows = [info("sh-g-most", "", "", g[3] === 1 ? "Pick one." : "Pick up to " + g[3] + ". They show in this order.")];
      // nothing that opens the house is offered (bridge/smarthome.py and HomeAssistant.kt pickable): say so
      if (g[0] === "controls" || g[0] === "scenes") rows.push(info("sh-g-house", "", "", "Locks, alarms, garage doors and gates are left out. So is anything Home Assistant names for a garage, gate, door, lock or alarm."));
      have.forEach(function (e) {
        rows.push({ kind: "check", key: "sh-e:" + e.entity, label: e.name, sub: e.unit || "", checked: cur.indexOf(e.entity) >= 0, act: function () {
          var i = cur.indexOf(e.entity);
          if (i >= 0) cur.splice(i, 1);
          else if (g[3] === 1) { cur.length = 0; cur.push(e.entity); }
          else if (cur.length < g[3]) cur.push(e.entity);
          else SET.msg = "That is the most for this. Untick one first.";
        } });
      });
      return rows;
    } };
    SET.keyFocus = null; SET.ri = 0;
  }
  // the native side calls these
  // Home on the remote also re-reads the lists, so an order arranged on the phone shows straight away
  window.tv = { back: function () { if (window.CouchAsk && window.CouchAsk.back && window.CouchAsk.back()) return; if (typeof CouchShare !== "undefined" && CouchShare.close()) return; if (typeof CouchDesign !== "undefined" && CouchDesign.back && CouchDesign.back()) return; if (idleAmbientActive) { setIdleAmbient(false); resetSmartIdle(); return; } if (idlePhotoInput(null)) return; goHome(); resetIdlePhoto(); resetSmartIdle(); },
    home: function () { forgetFocus(); updFront(); if (zone === "welcome") return;   // the first-run welcome stays until it is answered
      if (zone === "makeit") { makeitClose(); return; }
      clipWake(); if (idleAmbientActive) { setIdleAmbient(false); resetSmartIdle(); return; } if (idlePhotoInput(null)) return; if (zone === "settings") closeSettings(); else goHome(); refresh(); resetIdlePhoto(); resetSmartIdle(); },
    screenOff: function () { toggleScreenOff(true); },
    // the TV home app's Spotify listener says the moment the song, play or pause changes (MainActivity), so
    // the card follows at once; the 5 second look in refreshMusic stays as the fallback
    spotifyUpdate: function (s) { if (SPOTIFY.enabled && spotifyWorks() && !covered() && s && typeof s === "object") handleSpotifyState(s, true); },
    wakeScreen: function () { toggleScreenOff(false); },
    isScreenOff: function () { return screenOffActive; },
    noDream: function () { note(t("no_dream")); },
    // the remote's Settings/gear key, caught by the launcher natively (MainActivity.dispatchKeyEvent)
    settingsKey: function () { blip(0, 0); settingsKey(); },
    // the phone code changed (HomeActivity, Auth.onPin): the QR and computer line draw the new one
    phoneLink: function () { PHONE_QR.url = ""; phoneQr(); if (typeof CouchDesign !== "undefined" && CouchDesign.nav && CouchDesign.nav.phoneAgain) CouchDesign.nav.phoneAgain(); },
    // also the on-TV app's HomeActivity.refresh() after a phone or setup save, with the home already in front
    // and never paused: that redraws, but only a resume after tv.pause() is the home coming to the front
    resume: function () { var front = PAGE_PAUSED; PAGE_PAUSED = false; clock(); designVideo("away", false); toggleScreenOff(false); setIdleAmbient(false); resetSmartIdle(); okReset(); refresh(); if (!OFFLINE) refreshQuick(); refreshWeather(); startVideo(); clipWake(); sceneVideos(true); refreshMusic(); refreshCards(true); if (window.AmbientWeather) window.AmbientWeather.resume(); resetIdlePhoto(); kwArtAgain(); if (front) { updFront(); makeitSchedule(MAKEIT_CALM); } setupDesign(); if (front) inboxAsk("front"); },
    // an app is in front: the video background stops until the home is back
    // (and a design's video background lets go of the TV's decoder, which the app may need)
    pause: function () { if (zone === "makeit") makeitClose(); saveFocusNow(); PAGE_PAUSED = true; pauseVideo(); designVideo("away", true); inboxAway(); },
    scene: function (pick) { return phoneScene(pick); },
    // the launcher's file picker has copied the chosen photos into its own storage (Home settings)
    photosAdded: function (names) { photosAdded(names); },
    // Android's speech screen closed (MainActivity.listen): what was said, or null
    heard: function (text) { if (window.Reminders) window.Reminders.heard(text); },
    // the launcher's updater has news (Updater.kt)
    update: function (state) { updChanged(state); },
    // Make Home open Couch TV moved on (the on-TV app's HomeKey.kt)
    homekey: function () { hkChanged(); },
    // Android's "default home app" chooser closed (HomeRole.kt, #98)
    homeAnswered: function (held) { homeAnswered(held); },
    // a calendar the launcher read for the Agenda widget (MainActivity.calendar)
    calendarText: function (id, ok, text) { calendarText(id, ok, text); },
    setupDesign: function () { setupDesign(); ACCT_INBOX.stopped = false; inboxArm(); makeitLinkArrived(); makeitWindowStart(); },   // Setup brings its own design; the inbox keeps its times
    accountInbox: function (raw) { accountInbox(raw); },
    // words typed on the phone remote (Type on the TV) when the TV app cannot press keys (the on-TV app
    // with no ADB): they go into the typing box Home settings has open, at the cursor. False: no box open.
    typeText: function (s) { return typeIn(s); },
    // At home from the phone's Home settings page (the on-TV app's /setup), handed in by the app
    atHomeRead: function () { return atHomeView(); },
    atHomeEdit: function (e) { return atHomeEdit(e); },
    // the Couch TV home app's own phone page with no computer (PhoneServer.kt): Home settings, the
    // phone's town and photos, the guest's name, and a code to show
    phonePage: function (op, arg) { return phonePageOp(op, arg); } };
  function phonePageOp(op, arg) {
    var later = function () { setTimeout(function () { if (zone !== "settings") restart(); else { SET.dirty = true; renderSettings(); } }, 300); };
    if (op === "read") return { ok: true, settings: ST, people: NOBODY ? [] : PEOPLE.map(function (p) { return { id: p.id, name: p.name }; }),
      weather: WXCFG && WXCFG.place ? { place: WXCFG.place } : null };
    if (op === "patch") {
      var pl = arg && arg.place;
      if (pl === null) delete ST.place;
      else if (pl && isFinite(pl.lat) && isFinite(pl.lon) && String(pl.name || "").trim()) {
        ST.place = { name: String(pl.name).slice(0, 80), area: String(pl.area || "").slice(0, 80), lat: Math.round(pl.lat * 100) / 100, lon: Math.round(pl.lon * 100) / 100, timezone: String(pl.timezone || "auto").slice(0, 64) };
      } else return { ok: false, error: "place needs a name, and lat and lon as numbers" };
      keepSettings(false); later();
      return { ok: true, settings: ST };
    }
    if (op === "photo") {
      var photos = Array.isArray(ST.photos) ? ST.photos.slice() : [];
      if (photos.length >= MAX_PHOTOS) return { ok: false, error: "The TV holds " + MAX_PHOTOS + " photos. Remove one first." };
      var ph = { id: uid(), file: String(arg || "") };
      photos.push(ph); ST.photos = photos; keepSettings(false); later();
      return { ok: true, photo: ph, count: photos.length };
    }
    if (op === "unphoto") {
      var all = Array.isArray(ST.photos) ? ST.photos : [], gone = all.filter(function (x) { return x && x.id === arg; })[0];
      if (!gone) return { ok: false, error: "That photo is not on the TV any more." };
      ST.photos = all.filter(function (x) { return x !== gone; }); keepSettings(false); later();
      return { ok: true, file: gone.file || "", count: ST.photos.length };
    }
    if (op === "guest") { guestSet(String(arg || "")); return { ok: true, guest: { name: CouchAtHome.guestFull(String(arg || "")) } }; }
    if (op === "code") { if (window.CouchPhonePage) window.CouchPhonePage.showCode(String(arg || ""), 180); return { ok: true }; }
    return { ok: false, error: "unknown" };
  }

  // ---------------- the web widgets (widget-web.js): headlines, scores, markets, the commute ----------------
  // Asked only while such a widget is on the home, each source at most once per refresh, the last
  // answers kept on this TV. A news feed or a share price sends no CORS header, so the TV asks through a
  // relay that is part of couch-tv at home: the bridge or the on-TV app (/api/webdata), or with neither,
  // this TV's own launcher (tvos.invalid/webdata). Scores and the drive come straight from their free
  // services. A preview (?mock=1) asks nobody (weblive=1: a test that does).
  var WEB = null, webTimer = 0;
  function webRelayOk() { return !OFFLINE || !!(TV && TV.webData && TV.webData()); }
  function webRelay(src, id) {
    var q = "src=" + encodeURIComponent(src) + "&id=" + encodeURIComponent(id);
    var get = function (url, auth) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open("GET", url); x.timeout = 15000;
        if (auth && KEY) x.setRequestHeader("Authorization", "Bearer " + KEY);
        x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} if (x.status === 200 && j && j.ok && typeof j.text === "string") resolve(j.text); else reject(new Error((j && j.error) || "relay " + x.status)); };
        x.onerror = x.ontimeout = function () { reject(new Error("relay")); };
        x.send();
      });
    };
    return !OFFLINE ? get(API + "/api/webdata?" + q + (TV_ID ? "&tv=" + TV_ID : ""), true) : get("http://tvos.invalid/webdata?" + q, false);
  }
  function webStart() {
    if (WEB || typeof CouchWidgetWeb === "undefined" || !CouchDesign.widgetsOf || (MOCK && !/[?&]weblive=1/.test(Q))) return;
    WEB = CouchWidgetWeb.loader({
      // each as it is on this TV: its own settings over the design's (a source, a competition or a
      // watchlist picked on the TV is the one fetched), and a news source "Best for your country" as the feed
      widgets: function () {
        var W = window.CouchWidgets, env = { data: { wset: wsData(), country: homeCountry() } };
        return CouchDesign.widgetsOf(Object.keys(CouchWidgetWeb.SOURCES)).map(function (w) {
          if (!W || !W.withSettings) return w;
          w = W.withSettings(w, env);
          if (w.kind === "news" && W.feedFor) w = Object.assign({}, w, { opts: Object.assign({}, w.opts, { feed: W.feedFor((w.opts || {}).feed, env) }) });
          return w;
        });
      },
      canRelay: webRelayOk, relay: webRelay,
      // never left waiting: an answer that has not come in 15 seconds is given up (so the source is asked again)
      json: function (url) {
        var ac = typeof AbortController !== "undefined" ? new AbortController() : null, tm = ac ? setTimeout(function () { ac.abort(); }, 15000) : 0;
        var done = function () { if (tm) clearTimeout(tm); };
        var ask = fetch(url, ac ? { signal: ac.signal } : undefined).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); }).then(function (j) { done(); return j; }, function (e) { done(); throw e; });
        // an older TV browser without AbortController: the same 15 seconds, by a race
        return ac ? ask : Promise.race([ask, new Promise(function (ok, no) { setTimeout(function () { no(new Error("timeout")); }, 15000); })]);
      },
      // the last answers, on this TV only (headlines and prices, never anything about the household)
      load: function () { try { return JSON.parse(localStorage.getItem(PFX + "tvhome.webdata") || "null"); } catch (e) { return null; } },
      save: function (o) { try { localStorage.setItem(PFX + "tvhome.webdata", JSON.stringify(o)); } catch (e) {} },
      changed: webChanged,
      paused: webPaused,
      places: commutePlaces,
      hidden: function () { return !!document.hidden; }
    });
    // the first look waits for the store's off switch (or 6 seconds), so a paused source is never asked
    var go = function () { if (WEB && !WEB.started) { WEB.started = true; WEB.start(); } };
    if (CouchDesign.widgetsOf(Object.keys(CouchWidgetWeb.SOURCES)).length) webPaused(); else WEB_PAUSE = WEB_PAUSE || { at: 0, paused: [] };
    if (WEB_PAUSE.wait) { WEB_PAUSE.wait.then(go, go); setTimeout(go, 6000); } else go();
  }
  // The design store's off switch for the web widgets' sources (widget-web.js pausedOf): GET
  // <store>/v1/config/sources, asked at most once a day and only while a web widget is on the home,
  // with no cookies and no referrer. No store, no answer or a bad one: everything on.
  var WEB_PAUSE = null;
  function webPaused() {
    var t = Date.now();
    if (!WEB_PAUSE) {
      var c = null;
      try { c = JSON.parse(localStorage.getItem(PFX + "tvhome.webpause") || "null"); } catch (e) {}
      WEB_PAUSE = c && isFinite(c.at) && t - c.at < 86400000 && t >= c.at ? { at: c.at, paused: CouchWidgetWeb.pausedOf(c) } : { at: 0, paused: [] };
    }
    if (t - WEB_PAUSE.at >= 86400000) webPauseAsk();
    return WEB_PAUSE.paused;
  }
  function webPauseAsk() {
    var base = typeof CouchDesignCode !== "undefined" && CouchDesignCode.base ? CouchDesignCode.base() : "", t = Date.now();
    WEB_PAUSE.at = t;   // one ask a day, whatever the answer
    var done = function (paused) {
      var was = WEB_PAUSE.paused.join();
      WEB_PAUSE = { at: t, paused: paused };
      try { localStorage.setItem(PFX + "tvhome.webpause", JSON.stringify({ at: t, paused: paused })); } catch (e) {}
      if (was !== paused.join()) { if (WEB) WEB.tick(); webChanged(); }
    };
    if (!base || !window.fetch) return done([]);
    WEB_PAUSE.wait = fetch(base + "/v1/config/sources", { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { done(CouchWidgetWeb.pausedOf(j)); }, function () { done([]); });
    return WEB_PAUSE.wait;
  }
  function webChanged() { clearTimeout(webTimer); webTimer = setTimeout(function () { if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("web"); }, 150); }
  // The commute's two places, never in a design or on couch-tv servers (a widget's own ride Home settings to the bridge or the TV app; the 0.13.8 one stays on the TV): from
  // the town set in Location (or config.json's weather place), to the place picked in Home settings,
  // Couch TV Studio, Commute. Both are towns or suburbs from the place search, about a kilometre wide.
  // w: one Commute widget (the web loader asks for each: widget-web.js places(w)); none: the first one
  function commutePlaces(w) {
    var pl = ST.place && isFinite(ST.place.lat) && isFinite(ST.place.lon) ? { name: ST.place.name, lat: ST.place.lat, lon: ST.place.lon }
      : CFG.weather && isFinite(CFG.weather.lat) && isFinite(CFG.weather.lon) ? { name: String(CFG.weather.place || "").split(",")[0], lat: CFG.weather.lat, lon: CFG.weather.lon } : null;
    var to = kept("tvhome.commute");
    // the Commute widget's own settings (Widgets on this home: Where to, and From when it is not the
    // home's town) win over the older Commute rows' place
    var cw = typeof CouchDesign !== "undefined" && CouchDesign.widgetList && CouchDesign.on() ? CouchDesign.widgetList().filter(function (x) { return x.kind === "commute" && (!w || w.id === undefined || x.id === w.id); })[0] : null;
    if (cw) { var wt = cleanPlace(wsOf(cw.key).to), wf = cleanPlace(wsOf(cw.key).from); if (wt) to = wt; if (wf) pl = { name: wf.name, lat: wf.lat, lon: wf.lon }; }
    return { from: pl, to: to && isFinite(to.lat) && isFinite(to.lon) ? { name: String(to.name || ""), lat: +to.lat, lon: +to.lon } : null };
  }
  // Picks for you: each person's Keep watching (no kids or guest profiles' shows are picked for others)
  function householdData() {
    if (NOBODY || !KW_ON) return [];
    return PEOPLE.map(function (p) {
      var kid = !!(window.KidsMode && window.KidsMode.isKid && window.KidsMode.isKid(p)) || !!p.kid;
      return { id: p.id, name: p.name, kid: kid, guest: !!p.guest, shows: (data.showsBy[p.id] || []).slice(0, KEEP_MAX) };
    });
  }
  // OK on a pick: the show, in its own app, the way Keep watching opens it (as its owner's)
  function playPick(i) {
    var d = typeof CouchWidgetWeb !== "undefined" ? CouchWidgetWeb.picks(householdData(), who, arrangeItems().items.map(function (it) { return it.package; }), 8) : [], p = d[i];
    if (p) playOwned(p.owner, p.i);
  }
  // one of a person's own Keep watching shows (Picks for you, or a Keep watching widget set to that
  // person): in its own app, the way Keep watching opens it, as its owner's
  function playOwned(owner, i) {
    var p = { owner: owner }, it = (data.showsBy[owner] || [])[i];
    if (!it) return;
    status(it.app ? t("opening_in", { title: it.title, app: it.app.name }) : t("opening", { title: it.title }), true);
    if (it.wn && TV && TV.openWatchNext) {
      if (!tvWatchNext(String(it.id)) && it.app) tvLaunch(it.app.package);
      status("");
      return;
    }
    api("POST", "/api/continue/open", { id: it.id, who: p.owner }, 60000)
      .then(function (res) { status(res.note ? tBridge(res.note_key, res.note_vars, res.note) : ""); })
      .catch(function (e) { if (TV && it.app && tvLaunch(it.app.package)) { status(linkLost(e)); return; } status(tBridge(e.key, e.vars, e.message)); });
  }
  // after a Keep watching card opened only its app: the bridge's words when it has lost its link to
  // the TV (err_tv_link_lost: adb is down and so is the remote protocol), else nothing
  function linkLost(e) {
    return e && e.key === "err_tv_link_lost" ? tBridge(e.key, e.vars, e.message) : "";
  }
  // each Commute widget with its own Where to (or From): the same shape as commuteData, by the widget's id
  function commuteByData() {
    var out = {};
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on() || !CouchDesign.widgetList) return out;
    var home = commutePlaces();
    CouchDesign.widgetList().filter(function (w) { return w.kind === "commute"; }).forEach(function (w) {
      var to = cleanPlace(wsOf(w.key).to), from = cleanPlace(wsOf(w.key).from) || home.from;
      if (!to) return;
      out[w.id] = { from: from ? { name: from.name } : null, to: { name: to.name },
        key: typeof CouchWidgetWeb !== "undefined" ? CouchWidgetWeb.routeKey(from, to) : null };
    });
    return out;
  }
  function commuteData() {
    var p = commutePlaces();
    return { from: p.from ? { name: p.from.name } : null, to: p.to ? { name: p.to.name } : null,
      key: typeof CouchWidgetWeb !== "undefined" ? CouchWidgetWeb.routeKey(p.from, p.to) : null };
  }

  // ---------------- each widget's own settings (docs/WIDGET-SETTINGS-CONTRACT.md) ----------------
  // Every widget on the design now with a `settings` list in widget-caps.js gets its own page: Hold OK
  // on it, "Edit on the TV" (design.js), or Home settings, Designs, "Widgets on this
  // home", where each is named by kind and where it sits ("Surf, top right"). The phone's Home settings
  // page shows the same list ("Widgets on this TV", designView). Nothing here is written per widget: each
  // row is drawn from the setting's type. Values live in Home settings, ST.widgets["<id>|<kind>"] =
  // { key: value }, so they ride /api/settings to the on-TV app or the computer at home like every other
  // Home setting, never in a design and never on a couch-tv server. Widgets read them as env.wset[<id>]
  // (data().wset). A widget that leaves the design keeps its values, unseen, until it comes back.
  var WS_TYPES = { pick: "choice", onoff: "toggle" };   // the spec's names for the contract's types
  function wsRecords(kind) {
    var C = window.CouchWidgetCaps, list = C && C.settings ? C.settings(kind) : [];
    return (Array.isArray(list) ? list : []).filter(function (s) { return s && /^[A-Za-z0-9_]{1,30}$/.test(s.key || "") && (!Array.isArray(s.where) || s.where.indexOf("tv") >= 0 || s.where.indexOf("phone") >= 0); })
      .map(function (s) {
        return { key: s.key, label: String(s.label || s.key), type: WS_TYPES[s.type] || s.type || "text", help: String(s.help || s.sub || ""), options: Array.isArray(s.options) ? s.options : [],
          def: s["default"] !== undefined ? s["default"] : s.def, private: !!s["private"], min: s.min, max: s.max, step: s.step, domain: s.domain || "", coast: !!s.coast,
          pre: s.pre === true, many: !!s.many, from: s.from || "", when: s.when && typeof s.when === "object" ? s.when : null, sets: s.sets || "", store: s.store || "tv",
          where: Array.isArray(s.where) ? s.where : ["tv", "phone"] };
      // only the settings a widget really reads now (pre: true); the rest wait for their renderers
      }).filter(function (s) { return s.pre && (s.where.indexOf("tv") >= 0 || s.where.indexOf("phone") >= 0); });
  }
  // a setting's value now: set on this TV, else what the design says (o.opts), else its default
  function wsCur(w, s) {
    var v = wsOf(w.key)[s.key];
    // bins, Which bin goes out this week: always worked out from the count the widget keeps (anchor), so
    // it is right next week too and a new bin night never flips the turn
    if (s.sets === "anchor") {
      var an = wsOf(w.key).anchor !== undefined ? +wsOf(w.key).anchor : +(w.opts || {}).anchor;
      if (isFinite(an) && (wsOf(w.key).anchor !== undefined || (w.opts || {}).anchor !== undefined)) {
        var wk = Math.floor((binNight(w).getTime() / 86400000 - an) / 7);
        return ((wk % 2) + 2) % 2 === 0 ? "a" : "b";
      }
    }
    // the apps in a dock, row, folder, app tile or games: what it holds now (Hold OK's changes on this
    // TV, or the design's), the same list the phone's Apps on this design changes
    if (s.type === "apps" && typeof CouchDesign !== "undefined" && CouchDesign.appWidgets) {
      var aw = CouchDesign.appWidgets().filter(function (x) { return x.key === w.key; })[0];
      if (aw) return aw.apps.map(function (x) { return x.key; });
    }
    if (v !== undefined && v !== null && v !== "") return v;
    // the Commute's Where to set with 0.13.8's Commute rows (kept on this TV, tvhome.commute) still counts
    if (w.kind === "commute" && s.key === "to") { var old = cleanPlace(kept("tvhome.commute")); if (old) return old; }
    v = (w.opts || {})[s.key];
    return v !== undefined && v !== null && v !== "" ? v : s.def;
  }
  // the coming bin night (the widget's weekday), local midnight, as the bins widget counts it
  function binNight(w) {
    var o = (w.settings || []).filter(function (x) { return x.key === "weekday"; })[0], wd = +(o ? (wsOf(w.key).weekday !== undefined ? wsOf(w.key).weekday : (w.opts || {}).weekday) : (w.opts || {}).weekday);
    if (!isFinite(wd) || wd < 0 || wd > 6) wd = 3;
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (wd - d.getDay() + 7) % 7);
  }
  // A new design never takes the last one's widget changes by accident. When the design on screen is not
  // the one these values were set on: a value that overrides a design's own choice (store "design": a
  // news source, a clock format) is dropped everywhere; a value kept on the TV (store "tv": a beach, where
  // you drive to) stays, keyed by widget id and kind, so it only ever applies to that same widget again.
  // The same design starting again changes nothing.
  // The same widgets sent again with a design choice changed (a clock made 24 hour in Studio): the new
  // choice wins over this TV's override of that one setting; overrides of settings the design left alone
  // stay (ST.widgets_base keeps what the design said for every design-kept setting, as canon() text).
  // the widgets a design has (their ids and kinds, sorted): moving or restyling a widget is the same design
  var WS_NEW_WAIT = false;
  function wsAfterSync() { if (WS_NEW_WAIT) { WS_NEW_WAIT = false; wsNewDesign(); } }
  // a value as short text that is the same whatever order its keys came in (unset is ""): a hash of its
  // sorted JSON, so the copy kept by a computer at home (bridge clean_widget_settings) stays small
  function wsCanon(v) {
    if (v === undefined || v === null || v === "") return "";
    var sort = function (x) {
      if (Array.isArray(x)) return x.map(sort);
      if (x && typeof x === "object") { var o = {}; Object.keys(x).sort().forEach(function (k) { o[k] = sort(x[k]); }); return o; }
      return x;
    };
    var s = JSON.stringify(sort(v)), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return "v" + (h >>> 0).toString(36);
  }
  // { "<id|kind>": { <key>: canon(the design's value) } } for every setting a design keeps (not "tv")
  // that the design sets; a widget whose design keeps nothing set is left out
  function wsBase(list) {
    var C = window.CouchWidgetCaps, out = {};
    list.forEach(function (w) {
      var recs = C && C.settings ? C.settings(w.kind) : [], b = {}, any = false;
      (Array.isArray(recs) ? recs : []).forEach(function (r) {
        if (!r || !r.key || r.store === "tv") return;
        var c = wsCanon((w.opts || {})[r.key]);
        if (c) { b[r.key] = c; any = true; }
      });
      if (any) out[w.key] = b;
    });
    return out;
  }
  function wsSameBase(a, b) {
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join(",") !== kb.join(",")) return false;
    return ka.every(function (k) {
      var x = a[k] || {}, y = b[k] || {}, n = Object.keys(x).sort(), m = Object.keys(y).sort();
      return n.join(",") === m.join(",") && n.every(function (s) { return x[s] === y[s]; });
    });
  }
  function wsNewDesign() {
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on() || !CFG.design || !CouchDesign.widgetList) return;
    var wl = CouchDesign.widgetList();
    var s = wl.map(function (w) { return w.key; }).sort().join(","), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    var mark = String(h), was = ST.widgets_design, base = wsBase(wl);
    var oldBase = ST.widgets_base && typeof ST.widgets_base === "object" && !Array.isArray(ST.widgets_base) ? ST.widgets_base : null;
    if (was === mark && oldBase && wsSameBase(oldBase, base)) return;
    var C = window.CouchWidgetCaps, all = wsAll(), changed = false;
    // which overrides go: a new set of widgets drops every design-kept one (today's rule); the same widgets
    // with a design choice changed drop only the overrides of that choice; an older TV with no base yet
    // only learns it and drops nothing
    var drop = was === undefined ? null : was !== mark ? "all" : oldBase ? "base" : null;
    if (drop) Object.keys(all).forEach(function (key) {
      var kind = key.split("|")[1] || "", recs = C && C.settings ? C.settings(kind) : [];
      Object.keys(all[key]).forEach(function (k) {
        var r = recs.filter(function (x) { return x && (x.key === k || x.sets === k); })[0];
        if (r && r.store === "tv") return;
        if (drop === "base") {
          var bk = r ? r.key : k, ob = oldBase[key] || {}, nb = base[key] || {};
          if ((ob[bk] || "") === (nb[bk] || "")) return;
        }
        delete all[key][k]; changed = true;
      });
      if (!Object.keys(all[key]).length) delete all[key];
    });
    ST.widgets = all;
    ST.widgets_design = mark;
    ST.widgets_base = base;
    keepSettings(true);
    if (!OFFLINE && data.bridge !== false) { clearTimeout(pushTimer); pushTimer = setTimeout(function () { pushSettings(kept(ST_KEY) || keepSettings(true)); }, 400); }
    if (changed && CouchDesign.dataChanged) CouchDesign.dataChanged("wset", JSON.stringify(all));
  }
  // one setting saved, and what follows from it: a "sets" setting writes its own count; a new bin night
  // keeps the same bin going out this week
  function wsSave(w, s, v) {
    var keep = s.key === "weekday" ? w.settings.filter(function (r) { return r.sets === "anchor" && wsOf(w.key).anchor !== undefined; }).map(function (r) { return [r, wsCur(w, r)]; }) : [];
    wsSet(w.key, s.key, v);
    if (s.sets) { if (v === null || v === undefined) wsSet(w.key, s.sets, null); else wsSets(w, s, v); }
    keep.forEach(function (p) { wsSets(w, p[0], p[1]); });
  }
  // "when": a setting that only means something once another one is set ({ alt: true }; "set": any
  // value but "off" or none)
  function wsShown(w, s) {
    if (!s.when) return true;
    return Object.keys(s.when).every(function (k) {
      var o = w.settings.filter(function (x) { return x.key === k; })[0], v = o ? wsCur(w, o) : (w.opts || {})[k], want = s.when[k];
      return want === "set" ? v !== undefined && v !== null && v !== "" && v !== "off" && v !== false : String(v) === String(want);
    });
  }
  // a list from this TV itself (type tvlist): its photos, people, lists or calendars, as [value, words]
  function tvlistOptions(from) {
    if (from === "photos") return (Array.isArray(ST.photos) ? ST.photos : []).filter(function (p) { return p && p.id; }).map(function (p, i) { return [p.id, "Photo " + (i + 1)]; });
    if (from === "people") return NOBODY ? [] : PEOPLE.map(function (p) { return [p.id, p.name]; });
    if (from === "lists") return AH ? (AH.store.get().lists || []).map(function (l) { return [l.name, l.name]; }) : [];
    // the Agenda's calendars: the calendar link in At home, and the bookings calendar (At home, Guests)
    // when it is a link of its own; "all" first, the Agenda's default
    if (from === "calendars") { var cs = (AH && AH.store.get().cal ? [["main", "Your calendar"]] : []).concat(booksSet() ? [["bookings", "Bookings calendar"]] : []); return cs.length ? [["all", "Every calendar"]].concat(cs) : []; }
    // the House guide's parts, by their headings (At home)
    if (from === "guide") return AH ? (AH.store.get().guide || []).map(function (g) { return [g.title, g.title]; }) : [];
    // the home computer's live numbers (Custom cards), by their titles; each in turn first
    if (from === "cards") return CARDS.length ? [["turns", "Each in turn"]].concat(CARDS.slice(0, 8).map(function (c) { return [String(c.title || ""), String(c.title || "")]; }).filter(function (c) { return c[0]; })) : [];
    return [];
  }
  // a TV list's own fixed choices first (Keep watching's "Whoever is watching"), then what this TV has
  function wsOptions(s, w) { return s.type === "tvlist" ? (s.options || []).concat(tvlistOptions(s.from)) : s.type === "team" ? teamOptions(w).map(function (t) { return [t.name, t.name]; }) : s.type === "device" ? deviceOptions(s) : s.options; }
  // Scores, Your team: the competition this widget shows now (its Competition setting), and ESPN's own
  // team list for it, read with the scores (widget-web.js; cricket has none: [] means typed)
  function teamLeague(w) {
    var r = w && (w.settings || []).filter(function (x) { return x.key === "league"; })[0], W0 = window.CouchWidgetWeb;
    return W0 ? W0.leagueOf(r ? wsCur(w, r) : (w && w.opts || {}).league) : "nrl";
  }
  function teamAnswer(w) {
    var d = WEB && WEB.data ? WEB.data() : null, rec = d && d.sports ? d.sports[teamLeague(w)] : null;
    return rec && rec.ok ? rec.v : null;
  }
  function teamOptions(w) {
    var v = teamAnswer(w), W0 = window.CouchWidgetWeb;
    return v && v.teams && v.teams.length && W0 ? W0.teamList({ teams: v.teams }) : [];
  }
  // a typed team checked against the teams in the competition's games: { name } when it is one of them
  function teamCheck(w, x) {
    var v = teamAnswer(w), W0 = window.CouchWidgetWeb, t = W0 && x ? W0.teamOf(x, v) : null;
    var lg = teamLeague(w);
    return { team: t, league: W0 ? (lg === "cricket" ? "cricket" : W0.LEAGUES[lg].name) : "", seen: W0 ? W0.teamList(v).length : 0 };
  }
  // a device setting (an aircon room, a camera, the switches): what this TV already shows from Home
  // Assistant (Home settings, Smart home; smarthome.js devices). One device starts with "The first one",
  // which clears it; a list picks none for every one
  function deviceOptions(s) {
    var l = window.smartHome && window.smartHome.devices ? window.smartHome.devices(s.domain) : [];
    if (!Array.isArray(l) || !l.length) return [];
    return s.many ? l : [["", "The first one in Smart home"]].concat(l);
  }
  // "sets": bins, Which bin goes out this week, also sets the count the widget keeps from (anchor):
  // the coming bin night is week 0 for the first bin, week 1 for the second
  function wsSets(w, s, v) {
    if (s.sets !== "anchor") return;
    // the day before the coming bin night, in whole days: the widget's count (local midnight / one day)
    // is then just past it in every time zone, so this week is week 0 for the first bin
    var night = binNight(w);
    wsSet(w.key, "anchor", Math.round(Date.UTC(night.getFullYear(), night.getMonth(), night.getDate()) / 86400000) - 1 - (v === "b" ? 7 : 0));
  }
  function wsAll() { var w = ST.widgets; return w && typeof w === "object" && !Array.isArray(w) ? w : {}; }
  function wsOf(key) { var v = wsAll()[key]; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function wsSet(key, k, v) {
    var all = ST.widgets = wsAll(), rec = all[key] = wsOf(key);
    if (v === null || v === undefined || v === "") delete rec[k]; else rec[k] = v;
    if (!Object.keys(rec).length) delete all[key];
    saveSettings();
    // a place changed: read the weather for it now (the Commute reads its own route)
    // the web widgets: a new source, competition, watchlist or place is asked for now, not in 30 seconds
    if (/\|(commute|news|sports|stocks)$/.test(key)) { if (WEB) WEB.tick(); webChanged(); }
    else if (wsRecords(String(key).split("|")[1] || "").some(function (s) { return s.key === k && s.type === "place"; })) refreshWeather();
    if (typeof CouchDesign !== "undefined" && CouchDesign.dataChanged) CouchDesign.dataChanged("wset", JSON.stringify(wsAll()));
  }
  // a place as the place search gives it (two decimals: the town, never a house)
  function cleanPlace(p) {
    p = p && typeof p === "object" ? p : {};
    var lat = Math.round(+p.lat * 100) / 100, lon = Math.round(+p.lon * 100) / 100, name = String(p.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
    if (!name || p.lat === null || p.lon === null || p.lat === "" || p.lon === "" || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var out = { name: name, lat: lat, lon: lon }, area = String(p.area || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
    if (area) out.area = area;
    out.timezone = typeof p.timezone === "string" && /^([A-Z][A-Za-z_]{1,30}(\/[A-Z][A-Za-z_-]{1,30}){1,2}|Etc\/GMT[+-]\d{1,2}|auto|UTC|GMT)$/.test(p.timezone) ? p.timezone : "auto";
    return out;
  }
  // the same key the widgets look a place up by (widgets.js placeKey): two decimals each
  function placeKey(p) { return (+p.lat).toFixed(2) + "," + (+p.lon).toFixed(2); }
  function homeCountry() { try { return (window.I18N && I18N.country && I18N.country()) || ""; } catch (e) { return ""; } }
  // the place a widget's reading is for: its place setting (surf "place", the weather widgets' "town"),
  // never the Commute's two ends (they are its route, read by the commute itself)
  function wsPlace(key) {
    var kind = String(key).split("|")[1] || "", vals = wsOf(key);
    if (kind === "commute") return null;
    var s = wsRecords(kind).filter(function (x) { return x.type === "place" && cleanPlace(vals[x.key]); })[0];
    return s ? cleanPlace(vals[s.key]) : null;
  }
  // the widgets on the design now with a place of their own: [{ key, id, kind, place }]
  function wsPlaces() {
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on() || !CouchDesign.widgetList) return [];
    return CouchDesign.widgetList().map(function (w) { return { key: w.key, id: w.id, kind: w.kind, place: wsPlace(w.key) }; }).filter(function (w) { return w.place; });
  }
  // what the widgets read (data()): wset by widget id, and each widget's own weather for its own place
  function wsData() {
    var out = {};
    if (typeof CouchDesign === "undefined" || !CouchDesign.widgetList || !CouchDesign.on()) return out;
    CouchDesign.widgetList().forEach(function (w) { var v = wsOf(w.key); if (Object.keys(v).length) out[w.id] = JSON.parse(JSON.stringify(v)); });
    return out;
  }
  function wxForData() {
    var out = {}, at = data.weather && data.weather.at;
    if (!at || !WX_SHOW) return out;
    wsPlaces().forEach(function (w) { var k = placeKey(w.place); if (at[k]) out[w.id] = at[k]; });
    return out;
  }
  function widgetName(kind) {
    var C = window.CouchWidgetCaps, r = C && C.get ? C.get(kind) : null;
    return (r && r.name) || kind;
  }
  // where a widget sits, in words: "top right", "middle left", "bottom", "in the middle" (a stack's
  // widget: "top right, in a stack")
  function whereWords(w) {
    var cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    var col = cx < 640 ? "left" : cx < 1280 ? "" : "right", row = cy < 360 ? "top" : cy < 720 ? "middle" : "bottom";
    var words = row === "middle" && !col ? "in the middle" : row + " " + (col || "middle");
    return /\//.test(w.id) ? words + ", in a stack" : words;
  }
  // the widgets on screen with settings of their own: [{ key, id, kind, label, settings, name, title }]
  function widgetsWithSettings() {
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on() || !CouchDesign.widgetList) return [];
    var list = CouchDesign.widgetList().map(function (w) { w.settings = wsRecords(w.kind); w.name = widgetName(w.kind); return w; }).filter(function (w) { return w.settings.length > 0; });
    list.forEach(function (w) {
      w.title = w.name + ", " + whereWords(w);
      // two of a kind in the same part of the screen: number them
      var same = list.filter(function (x) { return x.name === w.name && whereWords(x) === whereWords(w); });
      if (same.length > 1) w.title += " " + (same.indexOf(w) + 1);
    });
    return list;
  }
  function townName() { return String((WXCFG && WXCFG.place) || "").split(",")[0]; }
  // a setting's value now, in words (a private one never shows itself)
  function wsWords(s, v) {
    if (s.type === "place") { var p = cleanPlace(v); return p ? p.name : s.key === "to" ? "Not set" : townName() ? townName() + " (your home's town)" : "Not set"; }
    if (s.type === "device" && (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length))) return s.many ? "Every one in Smart home" : "The first one in Smart home";
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return s.many ? "None picked" : "Not set";
    if (s.private && s.type !== "tvlist" && s.type !== "choice" && s.type !== "device") return "Set";
    if (s.type === "toggle") return v ? t("on") : t("off");
    if (s.type === "apps" && Array.isArray(v)) return v.map(function (k) { var c = window.CouchApps && window.CouchApps.get(k), it = c ? null : arrangeItems().items.filter(function (x) { return x.package === k; })[0]; return c ? c.name : it ? String(it.name || k) : String(k); }).join(", ");
    var opts = wsOptions(s), name = function (x) { var o = opts.filter(function (y) { return String(y[0]) === String(x); })[0]; return o ? String(o[1]) : String(x); };
    if (Array.isArray(v)) return v.map(s.type === "choice" || s.type === "tvlist" || s.type === "device" ? name : String).join(", ");
    if (s.type === "choice" || s.type === "tvlist" || s.type === "device") return name(v);
    if (s.type === "app") { var it = arrangeItems().items.filter(function (x) { return x.package === v || (window.CouchApps && window.CouchApps.idOf(x.package) === v); })[0]; return it ? it.name : String(v); }
    return String(v);
  }
  function widgetRows(rows) {
    var list = widgetsWithSettings();
    if (!list.length) return;
    rows.push(head("Widgets on this home"));
    list.forEach(function (w) {
      var s = w.settings[0];
      rows.push({ kind: "nav", key: "wset:" + w.key, label: w.title, sub: s.label + ": " + wsWords(s, wsCur(w, s)), act: function () { openWidget(w.key); } });
    });
  }
  function widgetByKey(key) { return widgetsWithSettings().filter(function (x) { return x.key === key; })[0] || null; }
  function openWidget(key) {
    var up = SET.sub;
    SET.sub = { up: up, back: "wset:" + key, crumb: "Widgets on this home", title: function () { var w = widgetByKey(key); return w ? w.title : ""; },
      rows: function () { var w = widgetByKey(key); return w ? oneWidgetRows(w) : [info("w-gone", "This widget is not on the home now")]; } };
    SET.col = "rows"; SET.keyFocus = null; SET.ri = 0;
  }
  // Hold OK on a widget, Edit on the TV: Home settings straight at its page, on every TV the
  // home runs on (the launcher, Samsung, LG and the other web TVs)
  function openWidgetPage(key) {
    if (!widgetByKey(key)) return;
    openSettings();
    var i = secsNow().map(function (s) { return s[0]; }).indexOf("designer");
    if (i >= 0) SET.sec = i;
    openWidget(key);
    renderSettings();
  }
  // each setting's rows on the TV, by its type
  function oneWidgetRows(w) {
    var rows = [], vals = wsOf(w.key), shown = w.settings.filter(function (s) { return wsShown(w, s); });
    shown.forEach(function (s) {
      var id = w.key + ":" + s.key, v = vals[s.key], cur = wsCur(w, s), set = function (x) { wsSave(w, s, x); };
      var opts = wsOptions(s, w), pick = s.type === "choice" || s.type === "tvlist" || (s.type === "device" && opts.length > 0);
      if (shown.length > 1 && (s.type === "place" || s.many)) rows.push(head(s.label));
      if (s.type === "place") { placeRows(w, s, rows); return; }
      if (pick && s.many) {
        // a list: one tick per choice (up to the setting's max, 4 when it says none)
        var picked = Array.isArray(cur) ? cur.map(String) : [], most = isFinite(s.max) ? +s.max : 4;
        if (!opts.length) rows.push(info(id, s.label, "Nothing to pick on this TV yet", s.help));
        opts.forEach(function (o, i) {
          var on = picked.indexOf(String(o[0])) >= 0;
          rows.push({ kind: "check", key: id + ":" + i, label: String(o[1]), checked: on, act: function () {
            // only what can still be picked here: one gone from the TV (a device taken out of Smart
            // home) drops out, so it never counts toward the most and unticking all gives every one
            var now = (Array.isArray(wsCur(w, s)) ? wsCur(w, s) : []).filter(function (x) { return String(x) !== String(o[0]) && opts.some(function (y) { return String(y[0]) === String(x); }); });
            if (!on) { if (now.length >= most) { SET.msg = "Up to " + most + ". Untick one first."; return; } now.push(o[0]); }
            set(now.length ? now : null);
          } });
        });
        if (s.help) rows.push(info(id + ":help", "", "", s.help));
      } else if ((pick || s.type === "team") && opts.length) {
        rows.push({ kind: "cycle", key: id, label: s.label, sub: s.help, value: wsWords(s, cur), act: function () {
          var i = opts.map(function (o) { return String(o[0]); }).indexOf(String(cur)), o = opts[(i + 1) % opts.length];
          set(o[0]);
        } });
      } else if (s.type === "tvlist") {
        rows.push(info(id, s.label, "Nothing to pick on this TV yet", s.from === "photos" ? "Add photos in Look and scenes, Your photos" : s.from === "lists" ? "Add a list in Home settings, Designs, At home" : s.help));
      } else if (s.type === "toggle") {
        rows.push({ kind: "toggle", key: id, label: s.label, sub: s.help, value: cur ? t("on") : t("off"), act: function () { set(!cur); } });
      } else if (s.type === "number") {
        var lo = isFinite(s.min) ? +s.min : 0, hi = isFinite(s.max) ? +s.max : 100, st = isFinite(s.step) && +s.step > 0 ? +s.step : 1;
        rows.push({ kind: "cycle", key: id, label: s.label, sub: s.help, value: cur === undefined || cur === null || cur === "" ? "Not set" : String(cur), act: function () {
          var n = isFinite(+cur) && cur !== null && cur !== "" ? +cur + st : lo;
          n = Math.round((n - lo) / st) * st + lo; set(n > hi ? lo : Math.round(n * 1000) / 1000);
        } });
      } else if (s.type === "app") {
        var apps = arrangeItems().items.filter(function (x) { return (!x.kind || x.kind === "app") && x.package && !/^(screen|input):/.test(x.package); });
        rows.push({ kind: "cycle", key: id, label: s.label, sub: s.help, value: wsWords(s, cur), act: function () {
          var keys = apps.map(function (x) { return (window.CouchApps && window.CouchApps.idOf(x.package)) || x.package; }), i = keys.indexOf(cur);
          if (keys.length) set(keys[(i + 1) % keys.length]);
        } });
      } else if (s.type === "apps") {
        rows.push(info(id, s.label, wsWords(s, cur), "On the home, hold OK on an app in it: Change app, Move, Remove or Add apps. Or use Home settings on your phone."));
        // Add apps (0.13.11): every app on this TV in one sheet over Home settings; Back there saves and
        // comes back to this page. Not for a one app tile (Change app on the home does that).
        var awk = typeof CouchDesign !== "undefined" && CouchDesign.appWidgets ? CouchDesign.appWidgets().filter(function (x) { return x.key === w.key; })[0] : null;
        if (awk && awk.max > 1 && CouchDesign.appSheet) rows.push({ kind: "nav", key: id + ":sheet", label: "Add apps", sub: awk.apps.length + " of " + awk.max + " picked", act: function () {
          if (!CouchDesign.appSheet(w.key, function () { if (zone === "settings") renderSettings(); })) SET.msg = "No apps found on this TV yet.";
        } });
      } else if (s.type === "device") {
        // nothing from Home Assistant on this TV yet: where to set it up
        var sh = window.smartHome && window.smartHome.setup && window.smartHome.setup.can();
        rows.push(info(id, s.label, "Nothing to pick on this TV yet", sh ? "Set up Smart home first, then pick here." : "Needs Home Assistant set up for this TV in Home settings, Smart home."));
        if (sh) rows.push({ kind: "nav", key: id + ":smart", label: "Smart home", sub: "Set up what this TV shows", act: openSmartSetup });
      } else if (s.type === "image") {
        return;   // a picture is put in the widget in Couch TV Studio
      } else {
        // text, a team, a calendar link and anything newer: typed. A list of words (many) is typed with
        // commas between. A calendar link or anything private shows only "Set".
        rows.push({ kind: "input", key: id, label: s.label, sub: s.help || (s.private ? "Kept on this TV and your home Wi-Fi only" : ""), value: wsWords(s, cur), act: function () {
          var was = s.private ? "" : Array.isArray(cur) ? cur.join(", ") : typeof cur === "string" ? cur : "";
          startTyping({ label: s.label + (s.many ? ", with commas between" : ""), value: was, url: s.type === "calendar", submit: function (x) {
            x = String(x || "").trim().slice(0, s.type === "calendar" ? 600 : s.many ? 200 : 80);
            if (s.type === "calendar" && x) { x = window.CouchAtHome ? CouchAtHome.calUrl(x) : ""; if (!x) { SET.msg = "That is not a calendar link. It starts with https://."; return; } }
            if (s.many) { var parts = x.split(",").map(function (y) { return y.trim(); }).filter(Boolean).slice(0, isFinite(s.max) ? +s.max : 6); set(parts.length ? parts : null); }
            else if (s.type === "team" && x) {
              // no list for this competition (cricket has no list): checked against the teams in its games
              var tc = teamCheck(w, x);
              set(tc.team ? tc.team.name : x);
              SET.msg = tc.team ? "Saved: " + tc.team.name + "." : "Saved. No " + x + " in the " + tc.league + " games Couch TV can see now: it shows once they play.";
              return;
            }
            else set(x);
            SET.msg = x ? "Saved." : "Cleared.";
          } });
        } });
      }
      // a value set on this TV over the design's own: one press back to the design's
      if (v !== undefined && v !== "" && s.type !== "place") rows.push({ kind: "action", key: id + ":clear", label: s.store === "design" ? "Use the design's " + s.label.toLowerCase() : "Clear " + s.label.toLowerCase(), act: function () { wsSet(w.key, s.key, null); if (s.sets) wsSet(w.key, s.sets, null); } });
    });
    rows.push(info("w-kept", "Kept in this TV's Home settings (and the home computer, if this TV has one). Never in a design, never sent to Couch TV."));
    return rows;
  }
  // a place setting: the town search (the same one as Location), kept in Home settings (the TV, and the computer at home or the TV app), never in a design or on couch-tv servers
  var WPLACE = { key: "", q: "", list: null, busy: false, err: false }, wgeoTimer = null, wgeoTicket = 0;
  function placeRows(w, s, rows) {
    var own = cleanPlace(wsOf(w.key)[s.key]) || (w.kind === "commute" && s.key === "to" ? cleanPlace(kept("tvhome.commute")) : null), pk = w.key + ":" + s.key, g = WPLACE.key === pk ? WPLACE : { key: pk, q: "", list: null, busy: false, err: false };
    rows.push(info("wp-now:" + s.key, s.label, wsWords(s, own), s.help));
    rows.push({ kind: "input", key: "wp-search:" + s.key, label: "Search for a place", sub: s.coast ? "A beach, or the town by it" : "A town or suburb", value: g.q, act: function () {
      startTyping({ label: s.coast ? "Type a beach or the town by it" : "Type a town or suburb", value: g.q, search: true,
        live: function (q) { findWidgetPlace(pk, q, false); }, submit: function (q) { findWidgetPlace(pk, q, true); } });
    } });
    if (g.busy) rows.push(info("wp-busy", t("loc_searching")));
    else if (g.err) rows.push(info("wp-err", t("loc_error")));
    else if (g.list && !g.list.length) rows.push(info("wp-none", t("loc_none", { q: g.q })));
    (g.list || []).forEach(function (pl, i) {
      rows.push({ kind: "choice", key: "wplace:" + s.key + ":" + i, label: pl.name, sub: pl.area, checked: !!(own && own.lat === pl.lat && own.lon === pl.lon), act: function () {
        var p = cleanPlace(pl);
        if (!p) return;
        wsSet(w.key, s.key, p);
        SET.msg = s.key === "to" ? "Where to: " + p.name + "." : w.name + " now shows " + p.name + ".";
        WPLACE.list = null; WPLACE.q = "";
      } });
    });
    if (own) rows.push({ kind: "action", key: "wp-town:" + s.key, label: s.key === "to" ? "Forget where you drive to" : "Use your home's town instead", act: function () { wsSet(w.key, s.key, null); if (w.kind === "commute" && s.key === "to") { keep("tvhome.commute", null); webChanged(); } SET.msg = s.key === "to" ? "Forgotten." : w.name + " uses your home's town again."; } });
  }
  function findWidgetPlace(key, q, go) {
    clearTimeout(wgeoTimer);
    q = (q || "").trim();
    WPLACE = { key: key, q: q, list: null, busy: false, err: false };
    if (q.length < 2) { if (zone === "settings") renderSettings(); return; }
    var run = function () {
      var ticket = ++wgeoTicket;
      WPLACE.busy = true;
      if (zone === "settings") renderSettings();
      geocode(q).then(function (list) {
        if (ticket !== wgeoTicket) return;
        WPLACE = { key: key, q: q, list: list, busy: false, err: false };
        if (go && list.length && !SET.typing) { SET.col = "rows"; SET.keyFocus = "wplace:" + String(key).split(":").pop() + ":0"; }
        if (zone === "settings") renderSettings();
      }, function () {
        if (ticket !== wgeoTicket) return;
        WPLACE = { key: key, q: q, list: null, busy: false, err: true };
        if (zone === "settings") renderSettings();
      });
    };
    if (go) run(); else wgeoTimer = setTimeout(run, 500);
  }

  // What the phone's Home settings page needs to show only what this design uses (atHomeView): the
  // phone sections to hide, every widget on the design with settings (its records and values; a private
  // value only says it is set), the design's app rows and the TV's apps to pick from. Nothing secret.
  function designView() {
    var r = useRules();
    if (!r) return { on: false };
    var hide = [];
    if (!r.location) hide.push("town");
    if (!r.people) hide.push("people");
    if (!r.photos) hide.push("photos");
    if (!r.athome) hide.push("athome");
    if (!r.inputs) hide.push("inputs");
    var installed = [];
    // each with its picture for the phone (A2): the catalogue's own icon when it has one ("app-icons/..."
    // under /tv/), and its package so a phone page that can ask the TV for the app's own icon does
    try { installed = arrangeItems().items.filter(function (it) { return (!it.kind || it.kind === "app") && it.package && !/^(screen|input):/.test(it.package); }).map(function (it) {
      var id = (window.CouchApps && window.CouchApps.idOf(it.package)) || it.package, c = window.CouchApps && window.CouchApps.get(id);
      return { key: id, name: String(it.name || it.package), pkg: /^[A-Za-z0-9_.]{3,120}$/.test(it.package) ? it.package : "", icon: c && c.icon ? c.icon : "", colour: c && c.colour ? c.colour : "" };
    }); } catch (e) {}
    return { on: true, hide: hide, inputs: !!r.inputs, town: townName(),
      // each setting as the phone draws it: its record, the choices (a TV list resolved here), the value
      // now (a private one only says it is set), whether it was changed on this TV, and whether it shows
      widgets: widgetsWithSettings().map(function (w) {
        var vals = wsOf(w.key);
        return { key: w.key, kind: w.kind, name: w.name, title: w.title,
          settings: w.settings.filter(function (s) { return s.where.indexOf("phone") >= 0 && s.type !== "image"; }).map(function (s) {
            var cur = wsCur(w, s), opts = wsOptions(s, w), o = { key: s.key, label: s.label, type: s.type === "team" && opts.length ? "choice" : s.type, help: s.help, many: s.many, coast: s.coast, store: s.store, min: s.min, max: s.max, step: s.step,
              options: opts, shown: wsShown(w, s), own: vals[s.key] !== undefined, words: wsWords(s, cur) };
            o.value = s.private && s.type !== "tvlist" && s.type !== "choice" && s.type !== "device" ? (cur ? true : null) : cur === undefined ? null : cur;
            return o;
          }) };
      }),
      apps: CouchDesign.appWidgets ? CouchDesign.appWidgets().map(function (a) { a.name = widgetName(a.kind); return a; }) : [], installed: installed,
      screen: screenView() };
  }
  // The phone's "Widgets on your screen" (setup.html): every widget on the design where it sits, with its
  // design's own look, options and style (all public: they came in the design), so the phone draws the real
  // widget with the TV's own widgets.js and demo data; what it needs set up on the phone (widget-caps.js
  // setupNeed) and whether the TV still shows it waiting (its "Set up on your phone" face). Nothing private.
  function screenView() {
    if (typeof CouchDesign === "undefined" || !CouchDesign.screen) return null;
    var sv = CouchDesign.screen(), C = window.CouchWidgetCaps;
    if (!sv) return null;
    var waiting = function (id) { try { return !!document.querySelector('.cw-o[data-obj="' + String(id).replace(/[^A-Za-z0-9_-]/g, "") + '"] .cw[data-face="1"]'); } catch (e) { return false; } };
    return { look: sv.look, widgets: sv.widgets.map(function (w) {
      var face = waiting(w.id), need = face ? (document.querySelector('.cw-o[data-obj="' + String(w.id).replace(/[^A-Za-z0-9_-]/g, "") + '"] .cw[data-face="1"]').getAttribute("data-need") || "") : C && C.setupNeed ? C.setupNeed(w.kind) || "" : "";
      if (need === "team" && !face) need = "";
      return { id: w.id, key: w.id + "|" + w.kind, kind: w.kind, name: widgetName(w.kind), where: whereWords(w), x: w.x, y: w.y, w: w.w, h: w.h, opts: w.opts, style: w.style, items: w.items,
        need: need || null, ready: !face };
    }) };
  }
  // The design's own widgets from the phone (through the on-TV app's At home hand over, HomeActivity):
  // widget_set: { key, values: { <setting>: value or null } }, design_apps: { key, apps } (apps null: the
  // design's own). Each value is checked against the widget's settings record; values land in
  // ST.widgets, exactly where the TV's own rows put them.
  function designEdit(e) {
    if (typeof CouchDesign === "undefined" || !CouchDesign.on || !CouchDesign.on()) return { ok: false, error: "No Couch TV Studio design is on the TV now." };
    if (e.design_apps && typeof e.design_apps === "object") {
      var r = CouchDesign.setApps(String(e.design_apps.key || ""), e.design_apps.apps === null ? null : e.design_apps.apps);
      if (!r.ok) return r;
    } else if (e.widget_set && typeof e.widget_set === "object") {
      var w = widgetByKey(String(e.widget_set.key || "")), vals = e.widget_set.values;
      if (!w) return { ok: false, error: "That widget is not on the home now." };
      if (!vals || typeof vals !== "object") return { ok: false, error: "Nothing to change." };
      var bad = "";
      Object.keys(vals).forEach(function (k) {
        var s = w.settings.filter(function (x) { return x.key === k; })[0], v = vals[k];
        if (!s || s.where.indexOf("phone") < 0) { bad = bad || "That setting is not on this widget."; return; }
        if (v === null) { wsSet(w.key, k, null); if (s.sets) wsSet(w.key, s.sets, null); return; }
        var opts = wsOptions(s, w), one = function (x) { var o = opts.filter(function (y) { return String(y[0]) === String(x); })[0]; return o ? o[0] : undefined; };
        if (s.type === "place") { v = cleanPlace(v); if (!v) { bad = "That place could not be used. Search for it again."; return; } }
        else if (s.type === "team") {
          // from the competition's list when it has one; typed, then checked against its games, when not
          var tc = teamCheck(w, String(v).trim().slice(0, 40));
          if (opts.length && !tc.team) { bad = String(v).slice(0, 40) + " is not a team in the " + tc.league + ". Pick one from the list."; return; }
          v = tc.team ? tc.team.name : String(v).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
          if (!v) v = null;
        }
        else if (s.type === "device" && !opts.length) { bad = "Set up Smart home on the TV first."; return; }
        else if ((s.type === "choice" || s.type === "tvlist" || s.type === "device") && s.many) {
          if (!Array.isArray(v)) { bad = "That choice is not one of the choices."; return; }
          v = v.map(one).filter(function (x, i, a) { return x !== undefined && a.indexOf(x) === i; }).slice(0, isFinite(s.max) ? +s.max : 4);
          if (!v.length) v = null;
        }
        else if (s.type === "choice" || s.type === "tvlist" || s.type === "device") { v = one(v); if (v === undefined) { bad = "That choice is not one of the choices."; return; } }
        else if (s.many) { v = (Array.isArray(v) ? v : String(v).split(",")).map(function (x) { return String(x).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 30); }).filter(Boolean).slice(0, isFinite(s.max) ? +s.max : 6); if (!v.length) v = null; }
        else if (s.type === "toggle") { if (typeof v !== "boolean") { bad = "That needs on or off."; return; } }
        else if (s.type === "number") {
          v = +v;
          if (!isFinite(v) || (isFinite(s.min) && v < +s.min) || (isFinite(s.max) && v > +s.max)) { bad = "That number is out of range."; return; }
          // to the setting's step, as the TV's own row does (5.5 with a step of 1 is 6)
          var st0 = isFinite(s.step) && +s.step > 0 ? +s.step : 1, lo0 = isFinite(s.min) ? +s.min : 0;
          v = Math.round((Math.round((v - lo0) / st0) * st0 + lo0) * 1000) / 1000;
          if (isFinite(s.max) && v > +s.max) v -= st0;
        }
        else if (s.type === "calendar") { v = String(v).trim().slice(0, 600); v = window.CouchAtHome ? CouchAtHome.calUrl(v) : ""; if (!v) { bad = "That is not a calendar link. It starts with https://."; return; } }
        else if (s.type === "apps") { bad = "Change that on the TV."; return; }
        else if (s.type === "zone") { v = window.CouchWidgets && CouchWidgets.zoneOk ? CouchWidgets.zoneOk(String(v).trim()) : ""; if (!v) { bad = "That time zone is not one this TV knows."; return; } }
        else if (s.type !== "choice" && s.type !== "tvlist") v = String(v).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
        wsSave(w, s, v);
      });
      if (bad) return { ok: false, error: bad };
    } else return { ok: false, error: "Nothing to change." };
    if (zone === "settings") renderSettings();
    return { ok: true, athome: atHomeView() };
  }

  function start() {
    // decided before readConfig(), which may keep things by itself on a first start (Lighter home)
    var freshTv = welcomeFresh();
    readConfig();
    footballEnabled = HOME.football_scores === true && !!(TV && TV.fotmobScores);
    if (footballEnabled) {
      var scores = document.createElement("aside"); scores.id = "football-scores";
      scores.setAttribute("aria-label", "Football scores"); document.body.appendChild(scores);
      SECS.splice(SECS.length - 1, 0, ["football", "info"]);
      footballTick(false);
      setInterval(function () { footballTick(false); }, 5000);
      setInterval(function () { footballTick(true); }, 10000);
    }
    // a TV whose home a computer runs (no launcher): smart home goes through that computer's bridge
    // (on a Google TV or Android TV with a computer at home, only its Hue lights and AirTouch zones)
    // Matter's live push (matter.js): an EventSource sends no header, so the bridge's address carries the
    // pairing key (?token=; the bridge reads it there and logs no addresses, access_log=None) and the TV
    api.events = function (p) { var q = [KEY ? "token=" + encodeURIComponent(KEY) : "", TV_ID ? "tv=" + TV_ID : ""].filter(Boolean).join("&"); return API + p + (q ? "?" + q : ""); };
    if (!OFFLINE && !MOCK && !PREVIEW && window.smartHome && window.smartHome.useBridge) window.smartHome.useBridge(api);
    // a design got by code: pictures only from here, the store and the hosts this TV already uses
    if (DESIGN_FROM_CODE && CouchDesignCode.lockImages) CouchDesignCode.lockImages((ST.photos || []).map(function (p) { return p && p.url; }), VIDEO_URL);
    // Couch TV Studio's design block (design.js): nothing happens without one, unless the page is
    // the designer's own preview (?designer=1), which sends designs in as they are made
    // With Couch TV Studio off (designer-gate.js) design.js is never started: no keys of its own, no
    // question, no page policy. On, the page policy a design runs under goes in first.
    var designOn = typeof CouchDesign !== "undefined" && !!(GATE.design || GATE.preview);
    // The Loop look wins: its clip, glass and cut-out are the background, and a design's background,
    // weather line, layers and dock are laid out for Night. So no design starts in Loop (none of its
    // decoders either); in every other look a design runs as before
    if (designOn && LOOP) { designOn = false; console.log("design: not started in the Loop look; it shows in the other looks"); }
    // (videos only from this page, memory, the design store and this TV's own video link)
    if (designOn && typeof CouchDesigner !== "undefined") CouchDesigner.lockPage(document, typeof CouchDesignCode !== "undefined" && CouchDesignCode.mediaSources ? { media: CouchDesignCode.mediaSources(VIDEO_URL) } : null);
    // the phone's Home settings page through the home computer (phone-page.js, bridge/phonepage.py)
    if (window.CouchPhonePage) {
      window.CouchPhonePage.words = function (code) { return t("phone_code", { code: code }); };
      if (!OFFLINE && !MOCK && !PREVIEW && !STANDALONE && !ON_TV) window.CouchPhonePage.start({ api: api, read: atHomeView, edit: atHomeEdit,
        sync: function () { syncSettings().catch(function () {}); }, words: window.CouchPhonePage.words,
        qr: function () { window.tv.phoneLink(); } });
    }
    if (designOn) CouchDesign.start(CFG.design, {
      // a design's video background keeps its still picture with Lighter home or in power save
      videoEnv: function () { var ps = false; try { ps = !!(TV && TV.powerSave && TV.powerSave()); } catch (e) {} return { lighter: LIGHTER, powerSave: ps }; },
      clock: function () { glassShown = ""; clock(); },
      apps: function () { renderGrid(); },
      clock24: function () { return CLOCK24; },
      night: NIGHT,
      // Hold OK on a widget, Edit on your phone: the phone's Home settings page with a pairing code,
      // wherever that page exists (as Change this on your phone in Home settings: phoneLinkFn)
      get phoneLink() { return phoneLinkKnown() ? function () { return phoneLinkFn()().then(function (j) { return j && j.url; }); } : null; },
      // widget mode: whether the home itself has the remote (no menu, settings or pop up open)
      free: function () { return !screenOffActive && !idleAmbientActive && !kidsOn() && !expanded && !lift && ["grid", "shelf", "np", "people", "quick"].indexOf(zone) >= 0; },
      // what the widgets show: only what this TV already has
      data: function () {
        return { weather: WX_SHOW ? data.weather : null, wxOff: !WX_SHOW, place: { name: String((WXCFG && WXCFG.place) || "").split(",")[0], lat: WXCFG && WXCFG.lat, lon: WXCFG && WXCFG.lon },
          shows: data.shows || [], music: music, apps: (function () { try { return arrangeItems().items.map(function (it) { return { package: it.package, name: it.name }; }); } catch (e) { return []; } })(),
          photos: (Array.isArray(ST.photos) ? ST.photos : []).filter(function (p) { return p && (p.file || p.url); }).map(photoSrc),
          // with the account's photo (Your home) when there is one: drawn on this TV only
          people: NOBODY ? [] : PEOPLE.map(function (p) { var o = { id: p.id, name: p.name }, ph = photoOfPerson(p); if (ph) o.photo = ph; return o; }), who: who, quick: quickVisible(), quickCan: QUICK_ALL.filter(quickCan), cards: CARDS.slice(0, 8), iconUrl: iconUrl,
          // no bridge at all (option A, or the standalone home): widgets that need one say so
          bridge: !OFFLINE,
          // the scenes the launcher's Home Assistant allows (names and entities only, never its address)
          scenes: window.smartHome && window.smartHome.scenes ? window.smartHome.scenes() : [],
          // things typed at home (Home settings, Designs, At home): kept on this TV only
          home: homeView(),
          // the web widgets' answers (widget-web.js): headlines, scores, prices, the drive
          web: WEB ? WEB.data() : null,
          // the commute's two places by name only, and the drive's id (Home settings; never in a design)
          commute: commuteData(),
          // everyone's Keep watching on this TV, for Picks for you (widget-web.js picks; stays on the TV)
          household: householdData(),
          // each widget's own settings on this TV, by its id (WIDGET-SETTINGS-CONTRACT.md), and the
          // temperature unit Home settings chose ("c" or "f"); a widget with a place of its own gets that
          // place's weather (and swell or air) in wxFor[<its id>], else it reads weather, the home's town
          wset: wsData(), unit: WX_F ? "f" : "c", wxAt: WX_SHOW && data.weather && data.weather.at ? data.weather.at : {}, wxBy: wxForData(),
          commuteBy: commuteByData(), country: homeCountry() };
      },
      // the detail layers (widget-detail.js) ask Home Assistant through smarthome.js, never directly
      ha: function (action, entity, value) {
        if (!window.smartHome || !window.smartHome.request || !(window.smartHome.enabled || window.smartHome.available)()) return Promise.resolve({ ok: false, error: "off" });
        return window.smartHome.request(action, entity, value);
      },
      // OK on a widget: open the app, the show, the smart home, a quick button
      act: function (what, arg) {
        touched = true;
        if (ahAct(what, arg)) return;
        if (what === "app") {
          var it = arrangeItems().items.filter(function (x) { return x.package === arg; })[0];
          if (it && it.kind && it.kind !== "app") { var i = gridItems.indexOf(it); if (i >= 0) { zone = "grid"; g = i; activate(); } return; }
          opened(arg);
          if (TV && tvLaunch(arg)) return;
          api("POST", "/api/launch", { app: (it && it.id) || arg }).catch(function (e) { status(tBridge(e.key, e.vars, e.message)); });
        } else if (what === "show") { zone = "shelf"; s = Math.max(0, parseInt(arg, 10) || 0); activate(); zone = "grid"; }
        else if (what === "pick") playPick(parseInt(arg, 10) || 0);
        else if (what === "pshow") { var ps = String(arg).split("|"); if (ps[0] === who) { zone = "shelf"; s = Math.max(0, parseInt(ps[1], 10) || 0); activate(); zone = "grid"; } else playOwned(ps[0], parseInt(ps[1], 10) || 0); }
        else if (what === "sound") widgetSound(arg);
        else if (what === "more") { dockBack = null; expanded = true; zone = "grid"; g = 0; renderGrid(); paintFocus(); }
        else if (what === "gear") openGear();
        else if (what === "place" || what === "wset") openWidgetPage(arg);
        else if (what === "smart") openSmart();
        else if (what === "quick") { var qv = quickVisible(), qn = qv.indexOf(arg); if (qn >= 0) { qi = qn; quickAction(); } else if (arg === "soundscape") cycleSoundscape(); else if (QUICK_ALL.indexOf(arg) >= 0 && quickCan(arg)) quickAction(arg); }
        else if (what === "person") { pickWho(arg); renderPeople(); }
        else if (what === "scene") { if (window.smartHome && window.smartHome.request && window.smartHome.available()) { var scn = (window.smartHome.scenes() || []).filter(function (x) { return x.entity === arg; })[0], snm = scn ? scn.name : arg; window.smartHome.request("scene", arg).then(function (r) { note(r && r.ok ? t("sh_started", { name: snm }) : t("sh_failed")); }); } }
        else if (what === "media") {
          var key = { prev: "previous", play: "play_pause", next: "next", vol_up: "volume_up", vol_down: "volume_down", mute: "mute" }[arg];
          if (key) { api("POST", "/api/key", { key: key }).catch(function (e) { note(tBridge(e.key, e.vars, e.message)); }); setTimeout(refreshMusic, 1200); }
        }
      },
      fromCode: DESIGN_FROM_CODE
    });
    if (designOn) { if (OFFLINE) wsNewDesign(); else WS_NEW_WAIT = true; }
    if (designOn) webStart();
    kidsInit();
    kidSync();   // a kids profile on the couch: its shelf before anything else shows
    staticText();
    // a page that loads (or reloads) always starts awake: never leave the backlight override behind
    try { if (TV && TV.setScreenOff) TV.setScreenOff(false); } catch (e) {}
    var ov = $("screen-off-overlay");
    if (ov) {
      ov.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleScreenOff(false);
      });
    }
    var iov = $("idle-ambient-overlay");
    if (iov) {
      iov.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setIdleAmbient(false);
        resetSmartIdle();
      });
    }
    document.addEventListener(PTR + "down", resetSmartIdle, { passive: true });
    document.addEventListener("wheel", resetSmartIdle, { passive: true });
    initSettings();
    remindersInit();
    welcomeStart(freshTv);   // a TV never set up: the first-run welcome, over everything else
    makeitSchedule(MAKEIT_CALM);   // the Make it yours card, if it was due and never showed
    setupDesign();           // Couch TV Setup's design code, if it brought one: no typing
    accountNewNotice();      // a design the account just sent: say so once, with where Undo is
    inboxAsk("open");        // the account's TV inbox, when this TV is linked (after 30 minutes away, or due)
    // Home settings gets an Updates section, before About, where the launcher can update itself
    if (updRead() && UPD.supported) SECS.splice(SECS.length - 1, 0, ["updates", "download"]);
    // back from Update to ... on the on-TV app: say so once
    if (UPD && UPD.updated && kept("tvhome.update.done") !== UPD.updated) {
      keep("tvhome.update.done", UPD.updated);
      status(tUpd("upd_done", { v: UPD.updated }));
    }
    mark("app-start");
    clock();
    syncClockSeconds();
    setInterval(clockTick, 15000);
    if (LOOP) loopInit();
    if (NIGHT && !LOOP) {   // the scenes, their clocks and the weather canvas: Night only
      if (window.AmbientWeather) {
        window.AmbientWeather.init($("weather-canvas"), $("ambient-lighting"));
        ambientSync();
      }
      buildScenes();
      // ?scene=fog starts on that scene, for previews (?scene=own: the first of the household's
      // photos; ?scene=<id>: one of your own scenes)
      var first = (Q.match(/[?&]scene=([a-z0-9]+)/) || [])[1];
      if (!first && SUN_SYNC) first = sunTargetScene();
      showScene(Math.max(0, SCENES.map(function (s) { return s.own ? "own" : s.id; }).indexOf(first)));
      if (SCENES.length > 1) setInterval(nextScene, SCENE_MS);
      // the clock font must be in before the glass is measured
      if (document.fonts) document.fonts.load("300 10px Antonio").then(function () { glassShown = ""; clock(); mood(true); });
    }
    if (NIGHT) {
      // the soft tap's audio context, made while the home is idle: made on the first key press it
      // cost that press 112 ms on an LG NANO83 (webOS 26), so the first press after every return
      // from an app lagged
      setTimeout(warmSound, 2000);
      refreshWeather();
      setInterval(refreshWeather, WX_EVERY * 60000);
    }
    photo = photoForHour(new Date().getHours());
    showPhoto();
    startVideo();
    photoTimer = setInterval(nextPhoto, PHOTO_MS);
    // custom cards (home.custom_cards): every 10 minutes, and never before the home is drawn
    if (HOME.custom_cards && window.CustomCards) {
      setTimeout(refreshCards, 1500);
      setInterval(refreshCards, window.CustomCards.EVERY_MIN * 60000);
    }
    var cached = load();
    if (cached) { data.showsBy = cached.showsBy || data.showsBy; data.videosBy = cached.videosBy || data.videosBy; data.screens = cached.screens || []; data.order = cached.order || null; }
    setPeople(PEOPLE);   // the cache may predate someone new
    if (OFFLINE) {   // no bridge: an order made with this TV's remote wins
      var lo = kept("tvhome.order.tv");
      if (lo && lo.packages) data.order = { saved: true, line: lo.line, packages: lo.packages };
    }
    if (TV) data.apps = sortApps(nativeApps() || []);
    if (cached || TV) { render(); mark("home-painted-from-cache"); }
    if (LOOP) document.querySelector(".top-left").appendChild($("np"));   // Loop: one line at the top left, under the people
    else if (NIGHT) $("np-slot").appendChild($("np"));   // Now playing: the first card of the row
    renderQuick();
    if (!OFFLINE) refreshQuick();
    refreshMusic();
    setInterval(function () { if (!covered()) refreshMusic(); }, 5000);
    updateOledShift();
    setInterval(updateOledShift, 60000);
    setInterval(checkSmartIdle, 10000);
    clipWake();
    // Couch TV Studio's home widgets: the calendar, photo dates, screen time and a new day
    if (AH) { setTimeout(ahTick, 2500); setInterval(ahTick, 60000); }
    setInterval(function () { if (!covered()) { if (!screenOffActive) renderQuick(); refreshBedtimeDim(); } }, 30000);
    // LG: the weekly Developer Mode extend. It asks on screen and stays until answered (this TV's
    // clock screensaver would hide anything that timed out). devResume() records an extend that just
    // happened, so the question is never asked twice.
    setTimeout(devResume, 1500);
    // This TV says who is on its couch first, so what plays here is logged for them (each TV
    // keeps its own); then the lists. Once the home is up: the one-time "tell you about new versions?" question.
    if (!OFFLINE) setTimeout(followWhoTick, 3000);
    // The bridge's choice wins (a phone that just turned the TV on set it); this TV's own memory is
    // only handed over when the bridge has nobody yet.
    var hello = OFFLINE ? Promise.resolve() : api("GET", "/api/who").then(function (j) {
      var w = j && j.who;
      if (w && PEOPLE.some(function (p) { return p.id === w; })) {
        bridgeWho = w;
        if (w !== who) { who = w; try { localStorage.setItem("tvhome.who", who); } catch (e) {} }
        return;
      }
      return api("POST", "/api/who", { who: who });
    }).catch(function () {});
    hello.then(refresh).then(function () { mark("home-painted-live"); updTell(); updAsk(); homeAsk(); });
    resetIdlePhoto();
  }

  if (MOCK || PREVIEW) {
    var sc = document.createElement("script");
    sc.src = "mock.js";
    sc.onload = start;
    document.head.appendChild(sc);
  } else {
    start();
  }
})();
