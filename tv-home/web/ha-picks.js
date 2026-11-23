// Smart home ticks: which Home Assistant things go in which group, how many each group takes, and
// how the ticks are kept (the section HomeAssistant.kt reads, docs/CONFIG.md, Smart home). One copy
// for the TV (app.js) and the phone page that sets it up (ha-phone.html), so both pick the same way.
// Locks, alarms and garage doors never get here: the TV leaves them out of the list it sends
// (HomeAssistant.kt pickable) and refuses them in a saved section.
(function (root) {
  "use strict";
  // [key, group name, which entities, most that show]
  var GROUPS = [
    ["climate", "Air conditioning and heating", /^climate\./, 8],
    ["scenes", "Scenes and scripts", /^(scene|script)\./, 10],
    ["controls", "Lights, switches, fans and blinds", /^(light|switch|fan|cover)\./, 16],
    ["cameras", "Cameras (a still picture, never video)", /^camera\./, 4],
    ["sensors", "Sensors (the pool, rain, humidity)", /^sensor\./, 8],
    ["speakers", "Speakers", /^media_player\./, 6],
    ["doorbell", "Doorbell", /^(event|binary_sensor|input_boolean)\./, 1],
    ["doorbell_camera", "The doorbell's camera", /^camera\./, 1],
    ["energy", "Solar or power meter", /^sensor\./, 1],
    ["battery", "Home battery (%)", /^sensor\./, 1]
  ];
  // what Home Assistant has that fits a group
  function have(list, g) {
    return (list || []).filter(function (e) {
      return e && g[2].test(e.entity) && (g[0] !== "energy" || /^(k|M)?Wh?$/.test(e.unit || "")) && (g[0] !== "battery" || e.unit === "%");
    });
  }
  // the ticks from what the TV keeps now (HomeAssistant.kt status)
  function fromStatus(st) {
    st = st || {};
    var p = {};
    ["climate", "scenes", "controls", "cameras", "sensors", "speakers"].forEach(function (k) { p[k] = Array.isArray(st[k]) ? st[k].slice() : []; });
    ["doorbell", "doorbell_camera", "energy", "battery"].forEach(function (k) { p[k] = st[k] ? [st[k]] : []; });
    return p;
  }
  // the ticks as HomeAssistant.kt reads a section
  function section(p) {
    p = p || {};
    var named = function (l) { return (l || []).map(function (e) { return { entity: e }; }); };
    var out = { climate: named(p.climate), scenes: named(p.scenes), controls: named(p.controls), cameras: named(p.cameras), sensors: named(p.sensors), speakers: named(p.speakers) };
    if (p.doorbell && p.doorbell[0]) out.doorbell = p.doorbell_camera && p.doorbell_camera[0] ? { entity: p.doorbell[0], camera: p.doorbell_camera[0] } : { entity: p.doorbell[0] };
    if (p.energy && p.energy[0]) out.energy = p.battery && p.battery[0] ? { entity: p.energy[0], battery: p.battery[0] } : { entity: p.energy[0] };
    return out;
  }
  // tick or untick one: one-only groups swap, the rest stop at their most. False when it is full.
  function toggle(p, g, id) {
    var cur = p[g[0]] = p[g[0]] || [];
    var i = cur.indexOf(id);
    if (i >= 0) { cur.splice(i, 1); return true; }
    if (g[3] === 1) { cur.length = 0; cur.push(id); return true; }
    if (cur.length >= g[3]) return false;
    cur.push(id);
    return true;
  }
  root.HaPicks = { GROUPS: GROUPS, have: have, fromStatus: fromStatus, section: section, toggle: toggle };
})(typeof window !== "undefined" ? window : this);
