// Matter devices (optional): the lights, plugs, fans, blinds, thermostats and sensors a person already
// has in Google Home, Apple Home, SmartThings or Alexa, shared to Couch TV with a pairing code. The TV
// (the on-TV app's Server.kt) or the home computer (bridge/server.py) is then one more Matter
// controller, and answers /api/matter/* (the Matter contract):
//   GET  /api/matter/devices   -> { devices: [{ id: "matter:<node>:<endpoint>", name, domain, state, attributes }], ready, note?, version }
//   GET  /api/matter/events    -> server-sent "event: matter", the same JSON as /api/matter/devices
//   POST /api/matter/commission { code }            -> { ok, device_ids, error?, note? }  (error: expired, wrong_code,
//                                                       unreachable, thread; the on-TV app also "already", the bridge "not_allowed")
//   POST /api/matter/command    { id, action, value } -> { ok, state, device }  (error: refused, unavailable, failed)
//   POST /api/matter/remove     { id }              -> { ok, removed, note? }
//   POST /api/matter/rename     { id, name }        -> { ok, name }
// Checked against nl-matter-android 99c0f86 (Server.kt, Matter.kt, MatterModel.kt, MatterPage.kt) and
// nl-matter-bridge 8254a5a plus its fixer's work in progress (bridge/matter.py: reason keys, rename
// refused with reason opens_house, commission unreachable with a reason).
// Nothing here talks to a device itself, and nothing is kept in the page.
//
// Every screen reads Matter devices exactly as it reads Home Assistant ones (smarthome.js merges them):
// in the page a device is "<domain>.matter_<node>_<endpoint>", so a design's device settings, the
// widgets' pick-lists and their checks (design.js: ^light\.[a-z0-9_]+) take it with no special case.
// The contract's own id ("matter:<node>:<endpoint>") is kept beside it and only that goes to the API.
// Locks, alarms and garage doors never show here (the controller leaves them out; they are dropped
// here too), and a blind marked as a garage door, gate or door is never moved from the TV.
(function (root) {
  "use strict";

  var DOMAINS = ["light", "switch", "fan", "cover", "climate", "sensor"];
  var OPENERS = ["garage", "gate", "door"];
  // a name that would open the house: the same token test as ws2-smarthome's opensHouse (and the
  // controllers' house rule), on the name lowercased with spaces as "_": garage, gate (not gateway), door
  // (not doorbell, indoor, outdoor), lock (not clock, block), alarm, disarm, also joined (Backdoor, Smartlock)
  function hides(name) {
    var e = "." + String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    var re = /garage|gate|door|lock|alarm|disarm/g, m, w, i, after;
    while ((m = re.exec(e))) {
      w = m[0]; i = m.index; after = e.slice(i + w.length); re.lastIndex = i + 1;
      if (w === "gate" && after.slice(0, 3) === "way") continue;
      if (w === "door" && (after.slice(0, 4) === "bell" || /[._](in|out)$/.test(e.slice(0, i)))) continue;
      if (w === "lock" && /[._][cb]$/.test(e.slice(0, i))) continue;
      return true;
    }
    return false;
  }
  var MODES = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"];
  var DOWN = ["unavailable", "unknown", ""];
  var FRESH_MS = 2000, ANSWER_MS = 20000, COMMISSION_MS = 150000;   // a lock shared by mistake: joined, read and left again, about 130 s at worst

  var MT = { api: null, devices: [], by: {}, ready: false, note: "", reason: "", reached: false, at: 0, pending: null, sig: "", watchers: [] };

  // ---------------- the ids ----------------
  function entityOf(id, domain) {
    var rest = String(id).replace(/^matter:/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
    return rest ? domain + ".matter_" + rest : "";
  }
  function owns(entity) { return typeof entity === "string" && /^[a-z_]+\.matter_[a-z0-9_]+$/.test(entity); }

  // ---------------- the device list ----------------
  function clean(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (d) {
      if (!d || typeof d.id !== "string" || !/^matter:/.test(d.id) || d.id.length > 80) return;
      var domain = String(d.domain || "");
      if (DOMAINS.indexOf(domain) < 0) return;   // locks, alarms and anything new never show
      var a = d.attributes && typeof d.attributes === "object" ? d.attributes : {};
      if (domain === "cover" && OPENERS.indexOf(String(a.device_class || "")) >= 0) return;
      // a blind or a plug named as a garage door, gate, door or lock is hidden too (the controllers do the
      // same; this page never relies on them): nothing that opens the house is ever listed or moved here
      if ((domain === "cover" || domain === "switch") && hides(d.name)) return;
      var entity = entityOf(d.id, domain);
      if (!entity || seen[entity]) return;
      seen[entity] = true;
      var name = String(d.name == null ? "" : d.name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
      out.push({ entity: entity, id: d.id, domain: domain, name: name || ("Matter " + domain), state: d.state == null ? "" : String(d.state).slice(0, 24), attributes: a });
    });
    return out;
  }
  function unwrap(r) {
    if (r && typeof r === "object" && !Array.isArray(r.devices) && r.result && typeof r.result === "object") return r.result;
    return r && typeof r === "object" ? r : {};
  }
  // a controller's reason key (bridge: off, not_installed, node_missing, node_old, starting, stopped,
  // opens_house, address, port, link_local, blocked, unsupported, offline, not_answering), or ""
  function why(r) { return typeof r === "string" && /^[a-z_]{2,24}$/.test(r) ? r : ""; }
  function signature() { return MT.devices.map(function (d) { return d.entity + "=" + d.name; }).join("|") + "#" + MT.ready + "#" + MT.reason + "#" + MT.note; }
  function put(r) {
    r = unwrap(r);
    MT.reached = true;
    MT.ready = r.ready !== false;
    MT.note = typeof r.note === "string" ? r.note.slice(0, 200) : "";
    // why it is not ready, as a key the screens put in their own words (the bridge: off, not_installed,
    // node_missing, node_old, starting, stopped); the English note only where there is no key
    MT.reason = why(r.reason);
    MT.devices = clean(r.devices);
    MT.by = {};
    MT.devices.forEach(function (d) { MT.by[d.entity] = d; });
    MT.at = Date.now();
    var sig = signature();
    if (sig !== MT.sig) {
      MT.sig = sig;
      // what is there changed (a device added, removed or renamed): the screens and widgets read again
      if (root.smartHome && root.smartHome.reload) root.smartHome.reload();
      MT.watchers.forEach(function (f) { try { f(); } catch (e) {} });
    }
  }

  // ---------------- asking the controller ----------------
  // the home computer's bridge or the on-TV app's server once app.js hands its api over (the same
  // controller the phone page asks); else the launcher's own Matter (window.TVMATTER, the Couch TV
  // home app on its own); else a preview's pretend one (mock.js)
  var seq = 0, waiting = {};
  function call(method, path, body, ms) {
    var nat = MT.api ? null : root.TVMATTER;   // with a home computer (app.js handed its api over) the bridge is the controller, as on the phone page
    if (nat && typeof nat.request === "function") {
      return new Promise(function (resolve, reject) {
        var id = "m" + (++seq).toString(36);
        var timer = setTimeout(function () { delete waiting[id]; reject(new Error("timeout")); }, ms || ANSWER_MS);
        // an answer with ok false fails here too, as app.js's api does (MatterPage.kt answers
        // { ok: false, error: key or plain sentence, note? })
        waiting[id] = function (r) {
          clearTimeout(timer);
          if (r && r.ok === false) { var e = new Error(String(r.error || "failed")); e.note = typeof r.note === "string" ? r.note : ""; e.reply = r; reject(e); }
          else resolve(r);
        };
        try { nat.request(id, method, path, body ? JSON.stringify(body) : ""); }
        catch (e) { clearTimeout(timer); delete waiting[id]; reject(e); }
      });
    }
    var api = MT.api || (typeof root.MOCK_MATTER === "function" ? root.MOCK_MATTER : null);
    if (!api) return Promise.reject(new Error("off"));
    return api(method, path, body, ms || ANSWER_MS);
  }
  function reply(id, r) {
    var f = waiting[id];
    if (!f) return;
    delete waiting[id];
    if (typeof r === "string") { try { r = JSON.parse(r); } catch (e) { r = { ok: false, error: "failed" }; } }
    f(r || { ok: false });
  }
  // an answer with ok false comes back from app.js's api as a thrown error whose message is the key
  function failed(e) {
    var m = e && e.message ? String(e.message) : "failed";
    var key = /^[a-z_]{2,24}$/.test(m);
    var rep = e && e.reply && typeof e.reply === "object" ? e.reply : {};
    var note = key ? (e && typeof e.note === "string" ? e.note : typeof rep.note === "string" ? rep.note : "") : m;
    return { ok: false, error: key ? m : "failed", note: note.slice(0, 200), reason: why(rep.reason) };
  }

  function refresh(maxAge) {
    if (MT.pending) return MT.pending;
    if (maxAge && MT.reached && Date.now() - MT.at < maxAge) return Promise.resolve(true);
    MT.pending = call("GET", "/api/matter/devices", null, 15000).then(function (r) { MT.pending = null; put(r); listen(); return true; },
      function () {
        MT.pending = null;
        // never there (an older bridge, or no Matter on this TV): nothing shows. There before (the
        // computer is off for a moment): the devices stay, each "not answering", like Home Assistant's
        MT.devices.forEach(function (d) { d.state = "unavailable"; });
        MT.at = Date.now();
        // asked again in a minute while it has never answered (the computer was off when the page opened)
        if (!MT.reached && !MT.retry) { MT.retry = setTimeout(function () { MT.retry = null; refresh(); }, 60000); if (MT.retry && MT.retry.unref) MT.retry.unref(); }
        return false;
      });
    return MT.pending;
  }

  // Live state: the server pushes the whole list ("event: matter") the moment a device reports a
  // change, on the page's own server (the on-TV app's, or the bridge that serves this page). Where
  // that stream is not there or not allowed, the screens keep asking as they do for Home Assistant.
  var ES = null;
  function listen() {
    if (ES !== null || MT.api == null || typeof root.EventSource !== "function" || !/^https?:$/.test((root.location || {}).protocol || "")) return;
    var opened = false;
    // the bridge's own address with the pairing key in the address (an EventSource sends no header):
    // app.js gives the api an events(path) that builds it; else this page's own server
    var url = typeof MT.api.events === "function" ? MT.api.events("/api/matter/events") : "/api/matter/events";
    try { ES = new root.EventSource(url); } catch (e) { ES = false; return; }
    ES.onopen = function () { opened = true; MT.live = true; };
    ES.addEventListener("matter", function (e) { try { put(JSON.parse(e.data)); } catch (x) {} });
    // never opened (an older server, or one that wants the key in a header): stop, never retried
    ES.onerror = function () { MT.live = false; if (!opened && ES) { ES.close(); ES = false; } };
  }

  // ---------------- as the screens read Home Assistant ----------------
  function down(d) { return DOWN.indexOf(d.state) >= 0; }
  function num(v) { var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function room(d) {
    var o = { entity: d.entity, name: d.name };
    if (down(d)) { o.ok = false; return o; }
    var a = d.attributes;
    var max = num(a.max_temp), min = num(a.min_temp), step = num(a.target_temp_step);
    o.ok = true; o.state = MODES.indexOf(d.state) >= 0 ? d.state : "auto";
    o.min = min == null ? 7 : min; o.max = max == null ? 35 : max; o.step = step && step > 0 ? step : (o.max > 50 ? 1 : 0.5);
    o.modes = (Array.isArray(a.hvac_modes) ? a.hvac_modes : []).filter(function (m) { return MODES.indexOf(m) >= 0; });
    o.action = typeof a.hvac_action === "string" ? a.hvac_action : "";
    if (num(a.current_temperature) != null) o.current = num(a.current_temperature);
    if (num(a.temperature) != null) o.target = num(a.temperature);
    if (num(a.target_temp_low) != null) o.low = num(a.target_temp_low);
    if (num(a.target_temp_high) != null) o.high = num(a.target_temp_high);
    return o;
  }
  function control(d) {
    var o = { entity: d.entity, name: d.name, kind: d.domain };
    if (down(d)) { o.ok = false; return o; }
    var a = d.attributes, s = d.state;
    o.ok = true; o.state = s;
    if (d.domain === "cover") {
      o.on = s === "open" || s === "opening";
      if (num(a.current_position) != null) o.level = Math.max(0, Math.min(100, Math.round(num(a.current_position))));
    } else {
      o.on = s === "on";
      if (s === "on" && d.domain === "light") {
        var lv = num(a.brightness) != null ? num(a.brightness) / 255 * 100 : num(a.level);
        if (lv != null) o.level = Math.max(1, Math.min(100, Math.round(lv)));
      }
      if (s === "on" && d.domain === "fan" && num(a.percentage) != null) o.level = Math.max(0, Math.min(100, Math.round(num(a.percentage))));
    }
    return o;
  }
  function sensor(d) {
    var o = { entity: d.entity, name: d.name };
    if (down(d)) { o.ok = false; return o; }
    var a = d.attributes;
    o.ok = true; o.value = d.state.slice(0, 24);
    if (num(d.state) != null && /^-?[\d.]+$/.test(d.state)) o.num = num(d.state);
    var u = String(a.unit_of_measurement || "");
    if (u && u.length <= 12 && !/[\u0000-\u001f<>]/.test(u)) o.unit = u;
    if (/^[a-z_]{1,32}$/.test(String(a.device_class || ""))) o.cls = a.device_class;
    return o;
  }
  var LISTS = { climate: ["rooms", ["climate"], room], controls: ["controls", ["light", "switch", "fan", "cover"], control], sensors: ["sensors", ["sensor"], sensor] };
  function of(domains) { return MT.devices.filter(function (d) { return domains.indexOf(d.domain) >= 0; }); }
  // the names, for info(): { climate, controls, sensors }
  function names() {
    var nm = function (d) { var o = { entity: d.entity, name: d.name }; if (d.domain === "sensor" && d.attributes.unit_of_measurement) o.unit = String(d.attributes.unit_of_measurement).slice(0, 12); return o; };
    return { climate: of(LISTS.climate[1]).map(nm), controls: of(LISTS.controls[1]).map(nm), sensors: of(LISTS.sensors[1]).map(nm) };
  }
  // what smarthome.js's info() gives every screen, with Matter's added (one entity once)
  function merge(info) {
    if (!MT.devices.length || !info) return info;
    var n = names();
    ["climate", "controls", "sensors"].forEach(function (k) {
      var list = Array.isArray(info[k]) ? info[k] : [], have = {};
      list.forEach(function (x) { if (x && x.entity) have[x.entity] = true; });
      info[k] = list.concat(n[k].filter(function (x) { return !have[x.entity]; }));
    });
    return info;
  }
  // "climate", "controls" or "sensors": the readings, as the launcher answers them
  function read(action) {
    var L = LISTS[action];
    if (!L) return Promise.resolve({ ok: false, error: "refused" });
    return refresh(MT.live ? 30000 : FRESH_MS).then(function () {
      if (!MT.reached) return { ok: false, error: "off" };
      var o = { ok: true };
      o[L[0]] = of(L[1]).map(L[2]);
      return o;
    });
  }
  function command(d, action, value) {
    var body = { id: d.id, action: action };
    if (value !== undefined) body.value = value;
    return call("POST", "/api/matter/command", body, ANSWER_MS).then(function (r) {
      r = unwrap(r);
      if (r.ok === false) return { ok: false, error: r.error === "refused" ? "refused" : "failed" };
      if (typeof r.state === "string") d.state = r.state.slice(0, 24);
      // both controllers answer the whole device after the change: its new readings at once
      var now = r.device && r.device.id === d.id ? clean([r.device])[0] : null;
      if (now && now.domain === d.domain) { d.state = now.state; d.attributes = now.attributes; }
      MT.at = 0;   // read it back next time
      return { ok: true };
    }, function (e) { var f = failed(e); return { ok: false, error: f.error === "refused" ? "refused" : "failed" }; });
  }
  // one device asked the way smarthome.js asks the launcher
  function ask(action, entity, value) {
    var d = MT.by[entity];
    var refused = { ok: false, error: "refused" };
    if (!d) return Promise.resolve(refused);
    if (d.domain === "climate") {
      var r = room(d);
      if (action === "temp") {
        var t = num(value);
        if (t == null || !r.ok) return Promise.resolve(refused);
        t = Math.round(Math.max(r.min, Math.min(r.max, t)) / r.step) * r.step;
        return command(d, "target", Math.round(t * 100) / 100);
      }
      if (action === "mode") return MODES.indexOf(value) >= 0 && (!r.modes || !r.modes.length || r.modes.indexOf(value) >= 0) ? command(d, "mode", value) : Promise.resolve(refused);
      if (action === "on" || action === "off") return command(d, action);
      return Promise.resolve(refused);
    }
    if (action === "set" && LISTS.controls[1].indexOf(d.domain) >= 0) {
      if (d.domain === "cover") {
        if (OPENERS.indexOf(String(d.attributes.device_class || "")) >= 0) return Promise.resolve(refused);
        if (value === "open" || value === "close") return command(d, "position", value === "open" ? 100 : 0);
        return Promise.resolve(refused);
      }
      if (value === "on" || value === "off") return command(d, value);
      return Promise.resolve(refused);
    }
    return Promise.resolve(refused);
  }

  // ---------------- adding, renaming and removing (Home settings, Smart home; the phone page) ----------------
  // An 11 or 21 digit Matter pairing code (spaces and dashes left out, the last digit checks the rest:
  // Verhoeff), or the text of a Matter QR code (MT:...). { ok, code } or { ok: false, error: "short" | "typo" | "code" }
  var VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
  var VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
  function verhoeff(s) {
    var c = 0, n = s.length;
    for (var i = 0; i < n; i++) c = VD[c][VP[i % 8][+s.charAt(n - 1 - i)]];
    return c === 0;
  }
  function checkCode(text) {
    text = String(text == null ? "" : text).trim();
    var qr = /MT:[0-9A-Z.\-]{19,512}/.exec(text.toUpperCase());
    if (qr) return { ok: true, code: qr[0] };
    var digits = text.replace(/[\s\-.]/g, "");
    if (!/^\d+$/.test(digits)) return { ok: false, error: "code" };
    if (digits.length !== 11 && digits.length !== 21) return { ok: false, error: digits.length < 11 ? "short" : "code" };
    if (+digits.charAt(0) > 7 || !verhoeff(digits)) return { ok: false, error: "typo" };
    return { ok: true, code: digits };
  }
  function commission(text) {
    var c = checkCode(text);
    if (!c.ok) return Promise.resolve(c);
    return call("POST", "/api/matter/commission", { code: c.code }, COMMISSION_MS).then(function (r) {
      r = unwrap(r);
      if (r.ok === false) return { ok: false, error: r.error || "failed", note: typeof r.note === "string" ? r.note : "", reason: why(r.reason) };
      MT.at = 0;
      var ids = Array.isArray(r.device_ids) ? r.device_ids : [];
      // the on-TV app joins a lock, an alarm or a garage door, sees what it is and leaves it again:
      // ok, no ids and a note (the bridge says error "not_allowed"). Either way, nothing was added.
      if (!ids.length && typeof r.note === "string" && r.note) return refresh().then(function () { return { ok: false, error: "not_allowed", note: r.note }; });
      return refresh().then(function () {
        return { ok: true, added: MT.devices.filter(function (d) { return ids.indexOf(d.id) >= 0; }).map(function (d) { return d.name; }) };
      });
    }, failed);
  }
  function remove(entity) {
    var d = MT.by[entity];
    if (!d) return Promise.resolve({ ok: false, error: "refused" });
    return call("POST", "/api/matter/remove", { id: d.id }, ANSWER_MS).then(function (r) {
      r = unwrap(r);
      if (r.ok === false) return { ok: false, error: r.error || "failed", reason: why(r.reason) };
      MT.at = 0;
      // a device that did not answer is forgotten anyway; its home app may still list the TV
      var quiet = typeof r.note === "string" && r.note !== "";
      return refresh().then(function () { return { ok: true, unanswered: quiet, reason: why(r.reason) }; });
    }, failed);
  }
  function rename(entity, name) {
    var d = MT.by[entity];
    name = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
    if (!d) return Promise.resolve({ ok: false, error: "refused", reason: "not_found" });
    if (!name) return Promise.resolve({ ok: false, error: "refused", reason: "bad_name" });
    // the controllers hide a light, plug or blind named as a garage door, gate, door or lock (so it is
    // never opened from the TV), and the bridge refuses such a name: caught here first, in plain words
    if (d.domain !== "climate" && d.domain !== "sensor" && hides(name)) return Promise.resolve({ ok: false, error: "name_hides" });
    return call("POST", "/api/matter/rename", { id: d.id, name: name }, ANSWER_MS).then(function (r) {
      r = unwrap(r);
      if (r.ok === false) return { ok: false, error: r.error || "failed", reason: why(r.reason) };
      MT.at = 0;
      return refresh().then(function () { return { ok: true }; });
    }, failed);
  }
  // the device as Home settings lists it: what it is and how it is now ("Light, on"), in the TV's
  // language (matter-words.js; English when that is not loaded)
  var EN = { kind_light: "Light", kind_switch: "Plug or switch", kind_fan: "Fan", kind_cover: "Blind", kind_climate: "Thermostat", kind_sensor: "Sensor",
    st_down: "not answering", st_on: "on", st_off: "off", st_open: "open", st_closed: "closed", st_someone: "someone there", st_nobody: "no one there" };
  function w(key) { var W = root.CouchMatterWords; return W && typeof W.t === "function" ? W.t(key) : EN[key]; }
  function describe(d) {
    var kind = w("kind_" + d.domain), sep = root.CouchMatterWords && root.CouchMatterWords.lang() === "zh-CN" ? "，" : ", ";
    if (down(d)) return kind + sep + w("st_down");
    if (d.domain === "climate") { var r = room(d); return kind + (r.current != null ? sep + r.current + "°" : "") + (d.state === "off" ? sep + w("st_off") : ""); }
    if (d.domain === "sensor") {
      var s = sensor(d), a = d.attributes;
      // a door or window sensor and a motion sensor say it in words, not "on" and "off"
      if (s.cls === "contact" && (a.reading === "open" || a.reading === "closed" || s.value === "on" || s.value === "off"))
        return kind + sep + w(a.reading === "closed" || (a.reading !== "open" && s.value === "off") ? "st_closed" : "st_open");
      if (s.cls === "occupancy" && (s.value === "on" || s.value === "off")) return kind + sep + w(s.value === "on" ? "st_someone" : "st_nobody");
      return kind + sep + s.value + (s.unit ? " " + s.unit : "");
    }
    var c = control(d);
    return kind + sep + w(d.domain === "cover" ? (c.on ? "st_open" : "st_closed") : c.on ? "st_on" : "st_off");
  }

  root.CouchMatter = {
    // app.js hands over the same api it uses for the bridge (or the on-TV app's server)
    use: function (api) { if (typeof api !== "function" || MT.api === api) return; MT.api = api; MT.pending = null; refresh(); },   // a question the launcher was still answering is not the bridge's answer
    reply: reply,
    // is there a Matter controller answering for this TV?
    on: function () { return MT.reached; },
    ready: function () { return MT.reached && MT.ready; },
    note: function () { return MT.note; },
    reason: function () { return MT.reason; },
    count: function () { return MT.devices.length; },
    refresh: refresh,
    owns: function (entity) { return owns(entity) && !!MT.by[entity]; },
    reads: function (action) { return LISTS[action] ? LISTS[action][0] : ""; },
    merge: merge, read: read, ask: ask,
    list: function () { return MT.devices.map(function (d) { return { entity: d.entity, id: d.id, name: d.name, domain: d.domain, ok: !down(d), words: describe(d) }; }); },
    checkCode: checkCode, commission: commission, remove: remove, rename: rename,
    onChange: function (f) { if (typeof f === "function" && MT.watchers.indexOf(f) < 0) MT.watchers.push(f); },
    signature: function () { return MT.sig; },
    entityOf: entityOf
  };
  // a preview (mock.js ?matter=1) has a pretend controller and no bridge; the launcher's own Matter
  // (window.TVMATTER, MatterPage.kt) answers with no bridge at all, so it is asked at once
  if (typeof root.MOCK_MATTER === "function" || (root.TVMATTER && typeof root.TVMATTER.request === "function")) refresh();
})(typeof window !== "undefined" ? window : this);
