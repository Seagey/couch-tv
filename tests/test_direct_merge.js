// A Google TV or Android TV with a computer at home: the launcher answers Home Assistant (TVHA) and the
// home computer answers its own Philips Hue lights and AirTouch 5 zones (bridge/direct.py), merged into
// one list in smarthome.js. Only light.hue_N and climate.airtouch_N go to the computer; everything else
// stays with the launcher.
// Run: node tests/test_direct_merge.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const noop = () => {};
const el = { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } };
const sb = {
  location: { search: "", origin: "http://tv" }, setTimeout, clearTimeout, Promise, JSON,
  document: { documentElement: el, hidden: false, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop }
};
sb.window = sb;
sb.addEventListener = noop;
const asked = [];
// the launcher: one Home Assistant room and one lamp
sb.TVHA = {
  info: () => JSON.stringify({ climate: [{ entity: "climate.lounge", name: "Lounge" }], scenes: [], controls: [{ entity: "light.lamp", name: "Lamp" }] }),
  request: (id, action, entity) => {
    asked.push(["tv", action, entity]);
    const r = action === "climate" ? { ok: true, rooms: [{ entity: "climate.lounge", ok: true }] } : action === "controls" ? { ok: true, controls: [{ entity: "light.lamp", ok: true }] } : { ok: true };
    setTimeout(() => sb.smartHome.reply(id, r), 0);
  }
};
// the home computer: its own Home Assistant copy (left out) plus Hue and AirTouch
const api = (method, p, body) => {
  asked.push(["computer", p, body && body.action, body && body.entity]);
  if (p === "/api/ha/info") return Promise.resolve({ info: { climate: [{ entity: "climate.lounge" }, { entity: "climate.airtouch_0", name: "Living" }], controls: [{ entity: "light.hue_1", name: "Lounge lamp" }] } });
  if (body.action === "climate") return Promise.resolve({ result: { ok: true, rooms: [{ entity: "climate.lounge", ok: true }, { entity: "climate.airtouch_0", ok: true }] } });
  if (body.action === "controls") return Promise.resolve({ result: { ok: true, controls: [{ entity: "light.hue_1", ok: true }] } });
  return Promise.resolve({ result: { ok: true } });
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../tv-home/web/smarthome.js"), "utf8"), sb);
const H = sb.smartHome;
const flush = () => new Promise((r) => setTimeout(r, 20));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

(async () => {
  H.useBridge(api);
  await flush();
  const rooms = await H.climate();
  ok(rooms.ok && rooms.rooms.map((r) => r.entity).join() === "climate.lounge,climate.airtouch_0", "rooms merged, the computer's own Home Assistant copy left out: " + JSON.stringify(rooms));
  const ctl = await H.request("controls");
  ok(ctl.ok && ctl.controls.map((r) => r.entity).join() === "light.lamp,light.hue_1", "controls merged: " + JSON.stringify(ctl));
  asked.length = 0;
  await H.request("on", "climate.airtouch_0");
  await H.request("on", "climate.lounge");
  await H.request("set", "light.hue_1", "off");
  ok(asked[0][0] === "computer" && asked[0][3] === "climate.airtouch_0", "an AirTouch zone goes to the computer");
  ok(asked[1][0] === "tv" && asked[1][2] === "climate.lounge", "a Home Assistant room stays with the launcher");
  ok(asked[2][0] === "computer" && asked[2][3] === "light.hue_1", "a Hue light goes to the computer");
  console.log("ok " + n + " direct merge checks");
})().catch((e) => { console.error(e); process.exit(1); });
