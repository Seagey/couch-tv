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

  function native() { return window.TVHA || null; }
  function info() {
    if (INFO) return INFO;
    try { INFO = JSON.parse(native().info() || "{}") || {}; } catch (e) { INFO = {}; }
    INFO.climate = Array.isArray(INFO.climate) ? INFO.climate : [];
    INFO.scenes = Array.isArray(INFO.scenes) ? INFO.scenes : [];
    return INFO;
  }
  // The tile shows only when there is something for this screen (a doorbell alone has no screen).
  function available() {
    if (!native()) return false;
    var i = info();
    return i.climate.length > 0 || i.scenes.length > 0;
  }

  // ---------------- asking the launcher ----------------
  var seq = 0, waiting = {};
  function ask(action, entity, value) {
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

  window.smartHome = {
    available: available, open: open, close: close, move: move, ok: ok, paint: paint, reply: reply,
    isOpen: function () { return S.open; }, icon: ICONS.home
  };
})();
