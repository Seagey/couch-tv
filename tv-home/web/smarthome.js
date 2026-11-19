// Smart home (optional): the air conditioning in each room and Home Assistant scenes, on one screen
// opened from the Smart home tile in the dock. Only when config.json has a "home_assistant" section
// (docs/CONFIG.md, Smart home); otherwise there is no tile and this file does nothing at all.
//
// The page never sees Home Assistant's address or token. It asks the launcher (window.TVHA,
// HomeAssistant.kt), which only talks to the entities named in config.json, and answers later
// through smartHome.reply(). In a plain browser there is no TVHA, so no tile (mock.js fakes one
// for previews: ?mock=1&ha=1).
//
// On the screen: left and right move along a row, up and down between the rows. Each room has
// four buttons: cooler, warmer, on or off, and the mode. A scene runs on OK. Back closes it.
// While it is open the rooms are read again every 20 seconds; closed, nothing is asked.
(function () {
  "use strict";

  var t = function (k, v) { return window.I18N ? window.I18N.t(k, v) : k; };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var SCENES_PER_LINE = 5, ROOMS_IN_VIEW = 4;
  var REFRESH_MS = 20000, ANSWER_MS = 15000, JOIN_MS = 700;
  var MODES = ["heat", "cool", "heat_cool", "auto", "dry", "fan_only"];

  var ICONS = {
    home: '<svg viewBox="0 0 24 24"><path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.8 9.5V20h12.4V9.5"/><path d="M10 20v-5.2h4V20"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>',
    power: '<svg viewBox="0 0 24 24"><path d="M12 3.5v8"/><path d="M7 6.6a7.5 7.5 0 1 0 10 0"/></svg>',
    mode: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>',
    scene: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
    script: '<svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>'
  };

  var INFO = null;
  var S = { open: false, rooms: null, down: false, row: 0, col: 0, msg: "", busy: {}, timer: null };

  // the launcher (Google TV, Android TV, Fire TV), or on a TV whose home a computer runs (Samsung, LG,
  // Hisense, Philips, TiVo OS, Panasonic) that computer's bridge (useBridge below): the same asks
  function native() { return window.TVHA || BRIDGE || null; }
  var DIRECT = null;   // { api, climate, controls }: see useDirect
  function info() {
    if (INFO) return INFO;
    try { INFO = JSON.parse(native().info() || "{}") || {}; } catch (e) { INFO = {}; }
    INFO.climate = Array.isArray(INFO.climate) ? INFO.climate : [];
    INFO.controls = Array.isArray(INFO.controls) ? INFO.controls : [];
    if (DIRECT && window.TVHA) {   // the home computer's Hue lights and AirTouch zones (askBridge)
      INFO.climate = INFO.climate.concat(DIRECT.climate);
      INFO.controls = INFO.controls.concat(DIRECT.controls);
    }
    INFO.scenes = Array.isArray(INFO.scenes) ? INFO.scenes : [];
    // the smart home widgets (HomeAssistant.kt info()): names and entities only
    ["controls", "cameras", "sensors", "speakers"].forEach(function (k) { INFO[k] = Array.isArray(INFO[k]) ? INFO[k] : []; });
    INFO.energy = INFO.energy === true; INFO.doorbell = INFO.doorbell === true; INFO.doorbell_camera = INFO.doorbell_camera === true;
    return INFO;
  }
  // anything at all set up for this TV (the widgets need no climate or scenes)
  function enabled() {
    if (!native()) return false;
    var i = info();
    return i.climate.length > 0 || i.scenes.length > 0 || i.controls.length > 0 || i.cameras.length > 0 || i.sensors.length > 0 ||
      i.speakers.length > 0 || i.energy || i.doorbell;
  }
  // The tile shows only when there is something for this screen (a doorbell alone has no screen).
  function available() {
    if (!native()) return false;
    var i = info();
    return i.climate.length > 0 || i.scenes.length > 0;
  }

  // ---------------- asking the launcher ----------------
  var seq = 0, waiting = {};
  // Philips Hue lights and AirTouch 5 zones set up on the home computer with no Home Assistant
  // (bridge/direct.py): on a Google TV or Android TV that also has a computer at home, the launcher
  // answers Home Assistant and the computer answers these, merged into one list
  var DIRECT_RE = /^(light\.hue_|climate\.airtouch_)\d+$/;
  function askBridge(action, entity, value) {
    return DIRECT.api("POST", "/api/ha", { action: action, entity: entity || "", value: value == null ? "" : String(value) }, 20000)
      .then(function (r) { return r && r.result && typeof r.result === "object" ? r.result : { ok: false }; }, function () { return { ok: false, error: "bridge" }; });
  }
  function ask(action, entity, value) {
    if (DIRECT && window.TVHA) {
      if (DIRECT_RE.test(entity || "")) return askBridge(action, entity, value);
      if (action === "climate" || action === "controls") {
        var key = action === "climate" ? "rooms" : "controls";
        return Promise.all([askNative(action, entity, value), askBridge(action, "", "")]).then(function (a) {
          var own = a[0] && a[0].ok ? a[0][key] || [] : [], far = a[1] && a[1].ok ? (a[1][key] || []).filter(function (x) { return x && DIRECT_RE.test(x.entity); }) : [];
          if (!(a[0] && a[0].ok) && !far.length) return a[0] || { ok: false };
          var o = { ok: true }; o[key] = own.concat(far); return o;
        });
      }
    }
    return askNative(action, entity, value);
  }
  function askNative(action, entity, value) {
    return new Promise(function (resolve) {
      var id = "r" + (++seq).toString(36);
      var timer = setTimeout(function () { delete waiting[id]; resolve({ ok: false, error: "timeout" }); }, ANSWER_MS);
      waiting[id] = function (r) { clearTimeout(timer); resolve(r && typeof r === "object" ? r : { ok: false }); };
      try { native().request(id, action, entity || "", value == null ? "" : String(value)); }
      catch (e) { clearTimeout(timer); delete waiting[id]; resolve({ ok: false, error: "native" }); }
    });
  }
  function reply(id, r) {
    var f = waiting[id];
    if (f) { delete waiting[id]; f(r); }
  }

  // ---------------- the rooms ----------------
  function load() {
    if (!S.open || !info().climate.length) return;
    if (document.hidden) return;
    ask("climate").then(function (r) {
      if (!S.open) return;
      var rooms = r.ok && Array.isArray(r.rooms) ? r.rooms : info().climate.map(function (c) { return { entity: c.entity, name: c.name, ok: false }; });
      // a change still waiting to be sent wins over what was read
      rooms.forEach(function (room) {
        var b = S.busy[room.entity];
        if (b && b.target != null && room.ok) room.target = b.target;
      });
      S.rooms = rooms;
      S.down = !rooms.some(function (x) { return x.ok; });
      render();
    });
  }
  function later(ms) {
    clearTimeout(S.timer);
    S.timer = setTimeout(function () { load(); later(REFRESH_MS); }, ms);
  }
  function num(v) { return Math.round(v * 10) / 10; }
  // with the language's decimal mark: 21.5° in English, 21,5° in Italian
  function deg(v) { return v == null || !isFinite(v) ? "" : num(v).toLocaleString(window.I18N ? window.I18N.locale() : "en-AU") + "°"; }
  function isOff(room) { return room.state === "off"; }
  function modeWord(m) { return MODES.indexOf(m) >= 0 ? t("sh_mode_" + m) : m || ""; }
  function actionWord(room) {
    if (isOff(room)) return t("sh_off");
    var a = room.action;
    if (a === "heating" || a === "cooling" || a === "drying" || a === "fan" || a === "idle") return t("sh_act_" + a);
    return modeWord(room.state);
  }
  function canSet(room) { return room.ok && room.target != null; }

  // the four buttons of every room, then the scenes: [[row 0 items], [row 1 items]]
  function rows() {
    var out = [];
    var rooms = S.rooms || [];
    var ctl = [];
    rooms.forEach(function (room, i) {
      ["down", "up", "power", "mode"].forEach(function (k) { ctl.push({ room: i, k: k }); });
    });
    if (ctl.length) out.push(ctl);
    // the scenes, five to a line
    var sc = info().scenes.map(function (s, i) { return { scene: i }; });
    for (var k = 0; k < sc.length; k += SCENES_PER_LINE) out.push(sc.slice(k, k + SCENES_PER_LINE));
    return out;
  }

  function sent(room, r) {
    if (!r.ok) flash(t(r.error === "timeout" || r.error === "failed" ? "sh_failed" : "sh_refused"));
    later(1500);   // read it back once Home Assistant has passed it on
  }
  var joinTimer = null;
  function nudge(room, d) {
    if (!canSet(room)) { flash(t(room.ok ? "sh_no_setpoint" : room.loading ? "sh_checking" : "sh_room_quiet")); return; }
    var step = room.step || 0.5;
    room.target = Math.max(room.min, Math.min(room.max, num(room.target + d * step)));
    S.busy[room.entity] = { target: room.target };
    render();
    // presses are joined for a moment, so five presses send one change
    clearTimeout(joinTimer);
    joinTimer = setTimeout(function () {
      var want = room.target;
      ask("temp", room.entity, want).then(function (r) { delete S.busy[room.entity]; sent(room, r); });
    }, JOIN_MS);
  }
  function power(room) {
    if (!room.ok) { flash(t(room.loading ? "sh_checking" : "sh_room_quiet")); return; }
    var on = isOff(room);
    room.state = on ? (room.modes || []).filter(function (m) { return m !== "off"; })[0] || "auto" : "off";
    room.action = "";
    render();
    flash(t(on ? "sh_turned_on" : "sh_turned_off", { name: room.name }));
    ask(on ? "on" : "off", room.entity).then(function (r) { sent(room, r); });
  }
  function cycleMode(room) {
    if (!room.ok) { flash(t(room.loading ? "sh_checking" : "sh_room_quiet")); return; }
    var list = (room.modes || []).filter(function (m) { return m !== "off"; });
    if (!list.length) { flash(t("sh_no_modes")); return; }
    var next = list[(list.indexOf(room.state) + 1) % list.length];
    room.state = next;
    room.action = "";
    render();
    flash(t("sh_mode_now", { name: room.name, mode: modeWord(next) }));
    ask("mode", room.entity, next).then(function (r) { sent(room, r); });
  }
  function runScene(i) {
    var sc = info().scenes[i];
    if (!sc) return;
    flash(t("sh_starting", { name: sc.name }));
    ask("scene", sc.entity).then(function (r) {
      flash(r.ok ? t("sh_started", { name: sc.name }) : t("sh_failed"));
    });
  }

  var flashTimer = null;
  function flash(text) {
    S.msg = text;
    var el = $("sh-msg");
    if (el) el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { S.msg = ""; if ($("sh-msg")) $("sh-msg").textContent = ""; }, 4000);
  }

  // ---------------- drawing it ----------------
  var ARC = 2 * Math.PI * 42 * 0.75;
  function focusAt(row, col) {
    var r = rows();
    return S.row === row && S.col === col && r[row] && r[row][col];
  }
  function roomHTML(room, i) {
    var ok = room.ok, off = isOff(room);
    var heat = room.state === "heat" || room.action === "heating";
    var frac = canSet(room) ? (room.target - room.min) / Math.max(1, room.max - room.min) : 0;
    var big = !ok ? "" : room.target != null ? deg(room.target) : room.low != null && room.high != null ? deg(room.low) + " " + deg(room.high) : "";
    var sub = room.loading ? t("sh_checking") : !ok ? t("sh_room_quiet") : room.target != null ? t("sh_set_to") : room.low != null ? t("sh_range") : "";
    var col0 = i * 4;
    var btn = function (k, icon, label) {
      var c = col0 + ["down", "up", "power", "mode"].indexOf(k);
      return '<div class="sh-b sh-' + k + (focusAt(0, c) ? " focus" : "") + '" role="button" aria-label="' + esc(label) + '"><i>' + icon + "</i>" +
        (k === "mode" ? "<span>" + esc(ok && !off ? modeWord(room.state) : t("sh_mode")) + "</span>" : "") + "</div>";
    };
    return '<div class="sh-room' + (ok ? "" : " quiet") + (off ? " off" : "") + (heat ? " heat" : "") +
      (S.row === 0 && Math.floor(S.col / 4) === i ? " here" : "") + '">' +
      '<div class="sh-name">' + esc(room.name) + "</div>" +
      '<div class="sh-dial"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42" stroke-dasharray="' + ARC + ' 999"/>' +
      (canSet(room) ? '<circle class="arc" cx="50" cy="50" r="42" stroke-dasharray="' + (ARC * Math.max(0.02, Math.min(1, frac))) + ' 999"/>' : "") + "</svg>" +
      '<div class="sh-val"><b>' + esc(big) + "</b><span>" + esc(sub) + "</span></div></div>" +
      '<div class="sh-now">' + (ok && room.current != null ? esc(t("sh_now", { t: deg(room.current) })) + " · " : "") + esc(ok ? actionWord(room) : "") + "</div>" +
      '<div class="sh-ctl">' + btn("down", ICONS.minus, t("sh_cooler")) + btn("up", ICONS.plus, t("sh_warmer")) +
      btn("power", ICONS.power, off ? t("sh_turn_on") : t("sh_turn_off")) + btn("mode", ICONS.mode, t("sh_mode")) + "</div></div>";
  }
  function sceneHTML(sc, i) {
    var row = (S.rooms && S.rooms.length ? 1 : 0) + Math.floor(i / SCENES_PER_LINE);
    i = i % SCENES_PER_LINE;
    var kind = sc.entity.indexOf("script.") === 0 ? "script" : "scene";
    return '<div class="sh-scene' + (focusAt(row, i) ? " focus" : "") + '" role="button"><i>' + ICONS[kind] + "</i><b>" + esc(sc.name) + "</b></div>";
  }
  function render() {
    var el = $("smart");
    if (!el || !S.open) return;
    var i = info(), html = '<h1 class="sh-title">' + esc(t("smart_home")) + "</h1>";
    if (i.climate.length) {
      html += '<h2 class="sh-head">' + esc(t("sh_climate")) + "</h2>";
      if (S.down) html += '<p class="sh-note warn">' + esc(t("sh_down")) + "</p>";
      // more than four rooms: the row slides along to keep the one in use in view
      var here = S.row === 0 ? Math.floor(S.col / 4) : 0;
      var first = Math.max(0, Math.min(here - (ROOMS_IN_VIEW - 1), S.rooms.length - ROOMS_IN_VIEW));
      html += '<div class="sh-view"><div class="sh-rooms" style="transform:translateX(' + (-first * 27.5) + 'rem)">' +
        S.rooms.map(roomHTML).join("") + "</div></div>";
    }
    if (i.scenes.length) html += '<h2 class="sh-head">' + esc(t("sh_scenes")) + '</h2><div class="sh-scenes">' + i.scenes.map(sceneHTML).join("") + "</div>";
    html += '<p class="sh-msg" id="sh-msg" aria-live="polite">' + esc(S.msg) + '</p><p class="sh-hint">' + esc(t("sh_hint")) + "</p>";
    el.innerHTML = html;
  }

  // ---------------- keys (app.js hands them over while this screen is open) ----------------
  function centreOf(row, col) {
    var rooms = S.rooms && S.rooms.length ? 1 : 0;
    var els = document.querySelectorAll("#smart " + (row < rooms ? ".sh-b" : ".sh-scene"));
    var e = els[row < rooms ? col : (row - rooms) * SCENES_PER_LINE + col];
    if (!e) return 0;
    var b = e.getBoundingClientRect();
    return b.left + b.width / 2;
  }
  function nearest(row, x) {
    var r = rows()[row] || [], best = 0, bestD = Infinity;
    for (var c = 0; c < r.length; c++) {
      var d = Math.abs(centreOf(row, c) - x);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  function move(dx, dy) {
    var r = rows();
    if (!r.length) return;
    if (dx) S.col = Math.max(0, Math.min(r[S.row].length - 1, S.col + dx));
    else if (dy && r[S.row + dy]) {
      var x = centreOf(S.row, S.col);
      S.row += dy;
      S.col = nearest(S.row, x);
    }
    render();
  }
  function ok() {
    var it = (rows()[S.row] || [])[S.col];
    if (!it) return;
    if (it.scene != null) { runScene(it.scene); return; }
    var room = S.rooms[it.room];
    if (!room) return;
    if (it.k === "down") nudge(room, -1);
    else if (it.k === "up") nudge(room, 1);
    else if (it.k === "power") power(room);
    else cycleMode(room);
  }

  function open() {
    S.open = true; S.row = 0; S.col = 0; S.msg = "";
    // the rooms as last read (or "checking" until the first answer), so the rows never jump
    if (!S.rooms) S.rooms = info().climate.map(function (c) { return { entity: c.entity, name: c.name, ok: false, loading: true }; });
    // land on the first room's warmer button, or the first scene
    if (S.rooms.length) S.col = 1;
    $("smart").classList.add("on");
    document.documentElement.classList.add("smarting");
    render();
    load();
    later(REFRESH_MS);
  }
  function close() {
    S.open = false;
    clearTimeout(S.timer);
    $("smart").classList.remove("on");
    document.documentElement.classList.remove("smarting");
  }
  // keeps the focus on something that is there, then draws
  function paint() {
    var r = rows();
    if (S.row >= r.length) S.row = Math.max(0, r.length - 1);
    if (r[S.row] && S.col >= r[S.row].length) S.col = r[S.row].length - 1;
    render();
  }

  // ---------------- the smart home widgets (widgets.js, widget-detail.js) ----------------
  // What a design's Control Centre, camera, doorbell, energy, sensor and speakers widgets show on a
  // TV, read through the launcher like everything above. Asked only while such a widget is on the
  // home and the home is in front: nothing at all while an app plays or with no widget for it. Each
  // answer that changes something draws the design again (CouchDesign.dataChanged). Pictures are
  // kept here in memory only; nothing read here is ever sent anywhere.
  var WIDGET_ACTIONS = ["controls", "set", "sensors", "history", "energy", "speakers", "volume", "playpause", "bell", "still", "ringstill"];
  var LIVE = { controls: null, sensors: null, hist: {}, energy: null, speakers: null, bell: null, ring: null, stills: {}, at: {}, busy: {} };
  var EVERY = { controls: 10000, sensors: 60000, hist: 900000, energy: 300000, speakers: 10000, bell: 8000 };
  var liveTimer = null;
  function shown(kind) { return !!document.querySelector(".cd-layer .cw-k-" + kind); }
  function changed(key, value) {
    if (window.CouchDesign && window.CouchDesign.dataChanged) window.CouchDesign.dataChanged("ha_" + key, value);
  }
  function due(key, every) { return !LIVE.busy[key] && Date.now() - (LIVE.at[key] || 0) >= every; }
  function read(key, action, entity, put) {
    LIVE.busy[key] = true;
    return ask(action, entity).then(function (r) {
      LIVE.busy[key] = false; LIVE.at[key] = Date.now();
      put(r || { ok: false });
    });
  }
  function poll() {
    if (!enabled() || document.hidden) return;
    var i = info();
    if (i.controls.length && shown("controls") && due("controls", EVERY.controls))
      read("controls", "controls", "", function (r) { LIVE.controls = r.ok ? r.controls || [] : (LIVE.controls || []).map(function (c) { return { entity: c.entity, name: c.name, ok: false }; }); changed("controls", LIVE.controls); });
    if (i.sensors.length && shown("sensor") && due("sensors", EVERY.sensors))
      read("sensors", "sensors", "", function (r) { if (r.ok) { LIVE.sensors = r.sensors || []; changed("sensors", LIVE.sensors); } else if (!LIVE.sensors) { LIVE.sensors = []; LIVE.down = true; changed("sensors", "down"); } });
    // each sensor a widget shows (data-ha-hist, set by widgets.js): its last 24 hours
    var want = {};
    [].forEach.call(document.querySelectorAll(".cd-layer [data-ha-hist]"), function (el) { want[el.getAttribute("data-ha-hist")] = true; });
    Object.keys(want).forEach(function (e) {
      if (!i.sensors.some(function (s) { return s.entity === e; }) || !due("hist:" + e, EVERY.hist)) return;
      read("hist:" + e, "history", e, function (r) { if (r.ok) { LIVE.hist[e] = { start: r.start, points: r.points || [] }; changed("hist_" + e, r.points); } });
    });
    if (i.energy && shown("energy") && due("energy", EVERY.energy))
      read("energy", "energy", "", function (r) { LIVE.energy = r; changed("energy", [r.ok, r.total, r.error, r.hours && r.hours.join(",")]); });
    if (i.speakers.length && shown("speakers") && due("speakers", EVERY.speakers))
      read("speakers", "speakers", "", function (r) { LIVE.speakers = r.ok ? r.speakers || [] : (LIVE.speakers || []).map(function (c) { return { entity: c.entity, name: c.name, ok: false }; }); changed("speakers", LIVE.speakers); });
    if (i.doorbell && shown("doorbell") && due("bell", EVERY.bell))
      read("bell", "bell", "", function (r) {
        var before = LIVE.bell;
        LIVE.bell = r;
        // the picture this TV kept from the ring, once per ring
        if (r.ok && r.kept && (!LIVE.ring || !before || before.at !== r.at)) ask("ringstill").then(function (p) { LIVE.ring = p && p.ok && stillOk(p.src) ? p : null; changed("ring", LIVE.ring && LIVE.ring.at); });
        changed("bell", [r.ok, r.at, r.ringing]);
      });
  }
  function startLive() {
    if (liveTimer || !enabled()) return;
    liveTimer = setInterval(poll, 2500);
    setTimeout(poll, 300);
  }
  // only a JPEG, PNG or WebP picture made by the launcher itself, never an address
  function stillOk(src) { return typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(src) && src.length < 4000000; }
  // a camera's still (a camera.* named in config.json, or "doorbell" for the door camera), at most
  // one question at a time per camera; the last picture stays in memory for the next drawing
  function still(entity, width) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "off" });
    var key = "still:" + entity;
    if (LIVE.busy[key]) return Promise.resolve({ ok: false, error: "busy" });
    LIVE.busy[key] = true;
    return ask("still", entity, width || 640).then(function (r) {
      LIVE.busy[key] = false;
      if (r && r.ok && stillOk(r.src)) { LIVE.stills[entity] = r.src; return { ok: true, src: r.src }; }
      return { ok: false, error: (r && r.error) || "failed" };
    });
  }
  // what the widgets draw from: the names set up, and the last readings (null: not read yet)
  function live() {
    if (!enabled()) return null;
    startLive();
    var i = info();
    return { info: { controls: i.controls, cameras: i.cameras, sensors: i.sensors, speakers: i.speakers, energy: i.energy, doorbell: i.doorbell, doorbell_camera: i.doorbell_camera },
      controls: LIVE.controls, sensors: LIVE.sensors, hist: LIVE.hist, energy: LIVE.energy, speakers: LIVE.speakers, bell: LIVE.bell, ring: LIVE.ring, stills: LIVE.stills };
  }

  // ---------------- a TV whose home a computer runs ----------------
  // No launcher there, so the bridge on the home computer talks to Home Assistant for the TV
  // (bridge/smarthome.py, /api/ha): the same asks, the same allow lists, and the token stays on that
  // computer (bridge/data/), never in the page. app.js calls useBridge(api) when it runs from a bridge.
  var BRIDGE = null, BINFO = "{}", BSTATUS = '{"set":false}';
  // a Google TV or Android TV with a computer at home: only the computer's own Hue and AirTouch
  function useDirect(api) {
    if (!window.TVHA || DIRECT || typeof api !== "function") return;
    api("GET", "/api/ha/info", null, 15000).then(function (r) {
      var i = r && r.info && typeof r.info === "object" ? r.info : {};
      var pick = function (l) { return (Array.isArray(l) ? l : []).filter(function (x) { return x && DIRECT_RE.test(x.entity); }); };
      var d = { api: api, climate: pick(i.climate), controls: pick(i.controls) };
      if (!d.climate.length && !d.controls.length) return;
      DIRECT = d; reload();
    }, function () {});
  }
  function useBridge(api) {
    if (window.TVHA) { useDirect(api); return; }
    if (BRIDGE || typeof api !== "function") return;
    var post = function (path, body, id, cb) {
      api("POST", path, body, 20000).then(function (r) { cb(id, r && r.result && typeof r.result === "object" ? r.result : { ok: false }); }, function () { cb(id, { ok: false, error: "bridge" }); });
    };
    BRIDGE = {
      info: function () { return BINFO; },
      request: function (id, action, entity, value) { post("/api/ha", { action: action, entity: entity, value: value }, id, reply); },
      setupStatus: function () { return BSTATUS; },
      setupCheck: function (id, url, token) { post("/api/ha/check", { url: url, token: token }, id, setupReply); },
      setupSave: function (id, picks) { var p = null; try { p = JSON.parse(picks); } catch (e) {} post("/api/ha/save", { picks: p }, id, function (i, r) { bridgeInfo(); setupReply(i, r); }); },
      setupForget: function (id) { post("/api/ha/forget", {}, id, function (i, r) { bridgeInfo(); setupReply(i, r); }); }
    };
    BRIDGE.api = api;
    bridgeInfo();
  }
  function bridgeInfo() {
    if (!BRIDGE) return;
    BRIDGE.api("GET", "/api/ha/info", null, 15000).then(function (r) {
      if (!r || typeof r !== "object") return;
      BINFO = JSON.stringify(r.info || {}); BSTATUS = JSON.stringify(r.status || { set: false });
      reload();
    }, function () {});
  }
  // what is set up changed (a set up saved on this TV): read it again and draw the home again
  function reload() {
    INFO = null;
    LIVE.controls = LIVE.sensors = LIVE.speakers = LIVE.energy = LIVE.bell = null; LIVE.at = {};
    changed("info", native() ? native().info() : "");
  }

  // ---------------- set up on the TV (Home settings, Smart home) ----------------
  var setupWaiting = {}, setupSeq = 0;
  function setupAsk(fn) {
    return new Promise(function (resolve) {
      var id = "s" + (++setupSeq).toString(36);
      var timer = setTimeout(function () { delete setupWaiting[id]; resolve({ ok: false, error: "timeout" }); }, 30000);
      setupWaiting[id] = function (r) { clearTimeout(timer); resolve(r && typeof r === "object" ? r : { ok: false }); };
      try { fn(id); } catch (e) { clearTimeout(timer); delete setupWaiting[id]; resolve({ ok: false, error: "native" }); }
    });
  }
  function setupReply(id, r) { var f = setupWaiting[id]; if (f) { delete setupWaiting[id]; f(r); } }
  var setup = {
    // can this TV set up smart home itself (the launcher, or the home computer's bridge)?
    can: function () { var n = native(); return !!(n && n.setupCheck); },
    status: function () { try { return JSON.parse(native().setupStatus() || "{}") || {}; } catch (e) { return { set: false }; } },
    // checks an address and token; an empty token checks again with the one kept on the TV
    check: function (url, token) { return setupAsk(function (id) { native().setupCheck(id, String(url || ""), String(token || "")); }); },
    save: function (picks) { return setupAsk(function (id) { native().setupSave(id, JSON.stringify(picks || {})); }).then(function (r) { if (r.ok) reload(); return r; }); },
    forget: function () { return setupAsk(function (id) { native().setupForget(id); }).then(function (r) { reload(); return r; }); }
  };

  window.smartHome = {
    // Hue or AirTouch was set up on the home computer from this TV: read its list again
    rebridge: function (api) { if (window.TVHA) { DIRECT = null; reload(); useDirect(api); } else bridgeInfo(); },
    useBridge: useBridge, setup: setup, setupReply: setupReply, reload: reload,
    enabled: enabled, live: live, still: still, stillOk: stillOk,
    available: available, open: open, close: close, move: move, ok: ok, paint: paint, reply: reply,
    isOpen: function () { return S.open; }, icon: ICONS.home,
    // the rooms as they are now, for a design's aircon card (design.js): the same question the
    // screen asks, only the climate entities named in config.json
    climate: function () { return available() ? ask("climate") : Promise.resolve({ ok: false }); },
    // the detail layers (widget-detail.js through design.js): the same allowed asks as this screen
    // (climate, temp, mode, fan, on, off, scene), each answered by the launcher, only for the entities
    // named in config.json
    request: function (action, entity, value) {
      if (available() && ["climate", "temp", "mode", "fan", "on", "off", "scene"].indexOf(action) >= 0) return ask(action, entity, value);
      // the smart home widgets' asks (the launcher checks each against config.json again)
      if (enabled() && WIDGET_ACTIONS.indexOf(action) >= 0) {
        if (action === "still") return still(entity, value);
        return ask(action, entity, value).then(function (r) {
          // a fresh reading from a detail layer is the widget's too
          if (r && r.ok && action === "controls") { LIVE.controls = r.controls || []; LIVE.at.controls = Date.now(); changed("controls", LIVE.controls); }
          if (r && r.ok && action === "speakers") { LIVE.speakers = r.speakers || []; LIVE.at.speakers = Date.now(); changed("speakers", LIVE.speakers); }
          return r;
        });
      }
      return Promise.resolve({ ok: false, error: "refused" });
    },
    scenes: function () { return available() ? info().scenes.map(function (s) { return { entity: s.entity, name: s.name }; }) : []; }
  };
})();
