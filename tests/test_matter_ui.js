// Matter devices in the TV page (tv-home/web/matter.js, merged by smarthome.js): devices shared from
// Google Home, Apple Home, SmartThings or Alexa show in the same lists Home Assistant's do, are asked
// the same way, and only the contract's own id ever goes to /api/matter/*. Locks, alarms and garage
// doors never show and are never moved. The pairing code check (Verhoeff) catches typos.
// Run: node tests/test_matter_ui.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "../tv-home/web");
const noop = () => {};
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const flush = () => new Promise((r) => setTimeout(r, 20));

function page(opts) {
  const el = { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } };
  const sb = {
    location: { search: "", origin: "http://tv" }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop, Promise, JSON,
    document: { documentElement: el, hidden: false, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop }
  };
  sb.window = sb;
  sb.addEventListener = noop;
  const asked = [];
  if (opts.tvha) {
    sb.TVHA = {
      info: () => JSON.stringify({ climate: [{ entity: "climate.lounge", name: "Lounge" }], scenes: [], controls: [{ entity: "light.lamp", name: "Lamp" }], sensors: [{ entity: "sensor.pool", name: "Pool" }] }),
      request: (id, action, entity, value) => {
        asked.push(["ha", action, entity, value]);
        const down = opts.haDown;
        const r = down ? { ok: false, error: "failed" } : action === "climate" ? { ok: true, rooms: [{ entity: "climate.lounge", name: "Lounge", ok: true }] }
          : action === "controls" ? { ok: true, controls: [{ entity: "light.lamp", name: "Lamp", ok: true, kind: "light", on: true }] }
          : action === "sensors" ? { ok: true, sensors: [{ entity: "sensor.pool", name: "Pool", ok: true, value: "26" }] } : { ok: true };
        setTimeout(() => sb.smartHome.reply(id, r), 0);
      }
    };
  }
  const devices = opts.devices || [];
  const api = (method, p, body) => {
    asked.push(["api", method, p, body]);
    if (opts.noMatter && p.indexOf("/api/matter") === 0) return Promise.reject(new Error("no such endpoint"));
    if (p.indexOf("/api/ha/info") === 0) return Promise.resolve({ info: {} });
    if (p === "/api/matter/devices") return Promise.resolve(opts.wrap ? { result: { devices, ready: true } } : { devices: JSON.parse(JSON.stringify(devices)), ready: opts.ready !== false, note: opts.note });
    if (p === "/api/matter/command") { const d = devices.find((x) => x.id === body.id); if (body.action === "on" || body.action === "off") d.state = body.action; return Promise.resolve({ ok: true, state: d.state }); }
    if (p === "/api/matter/commission") return body.code === "34970112332" ? (devices.push({ id: "matter:9:1", name: "New light", domain: "light", state: "off", attributes: {} }), Promise.resolve({ ok: true, device_ids: ["matter:9:1"] })) : Promise.reject(new Error("expired"));
    if (p === "/api/matter/remove") { devices.splice(devices.findIndex((x) => x.id === body.id), 1); return Promise.resolve({ ok: true }); }
    if (p === "/api/matter/rename") { devices.find((x) => x.id === body.id).name = body.name; return Promise.resolve({ ok: true }); }
    return Promise.resolve({ result: { ok: false, error: "off" } });
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(WEB, "smarthome.js"), "utf8"), sb);
  vm.runInContext(fs.readFileSync(path.join(WEB, "matter.js"), "utf8"), sb);
  return { sb, asked, api, H: sb.smartHome, M: sb.CouchMatter, devices };
}

const SHARED = () => [
  { id: "matter:1:1", name: "Lounge lamp", domain: "light", state: "on", attributes: { brightness: 204 } },
  { id: "matter:2:1", name: "Heater plug", domain: "switch", state: "off", attributes: {} },
  { id: "matter:4:1", name: "Study blind", domain: "cover", state: "closed", attributes: { current_position: 0 } },
  { id: "matter:5:1", name: "Hallway", domain: "climate", state: "heat", attributes: { current_temperature: 18.5, temperature: 21, min_temp: 7, max_temp: 30, target_temp_step: 0.5, hvac_modes: ["off", "heat", "cool"], hvac_action: "heating" } },
  { id: "matter:6:1", name: "Nursery", domain: "sensor", state: "22.4", attributes: { unit_of_measurement: "°C", device_class: "temperature" } },
  { id: "matter:7:1", name: "Front door lock", domain: "lock", state: "locked", attributes: {} },
  { id: "matter:8:1", name: "Garage", domain: "cover", state: "closed", attributes: { device_class: "garage" } },
  { id: "matter:a1B2:3", name: "Hex node <b>", domain: "switch", state: "unavailable", attributes: {} }
];

(async () => {
  // ---- the code check ----
  {
    const { M } = page({});
    ok(M.checkCode("34970112332").ok, "Matter's example code passes");
    ok(M.checkCode("3497-011-2332").code === "34970112332", "dashes and spaces are left out");
    ok(M.checkCode(" 3497 011 2332 ").ok, "spaces are left out");
    ok(M.checkCode("34970112333").error === "typo", "one wrong number is caught");
    ok(M.checkCode("34970112323").error === "typo", "two swapped numbers are caught");
    ok(M.checkCode("3497011").error === "short", "too short");
    ok(M.checkCode("hello").error === "code", "words are not a code");
    ok(M.checkCode("94970112332").error === "typo", "a first number over 7 is never a Matter code");
    ok(M.checkCode("MT:Y.K9042C00KA0648G00").code === "MT:Y.K9042C00KA0648G00", "a QR code's text passes");
    ok(M.checkCode("look: mt:y.k9042c00ka0648g00 ").code === "MT:Y.K9042C00KA0648G00", "a QR text inside other words is found");
    // the same check in the phone page (setup.html has its own copy): every case answers alike
    const html = fs.readFileSync(path.join(__dirname, "../on-tv/web/setup.html"), "utf8");
    const src = /var VD = [\s\S]*?\n  function matterCode[\s\S]*?\n  }\n/.exec(html)[0];
    const phone = vm.runInNewContext(src + "; matterCode", {});
    ["34970112332", "3497-011-2332", "34970112333", "34970112323", "3497011", "hello", "94970112332", "MT:Y.K9042C00KA0648G00", "x mt:y.k9042c00ka0648g00", "749701123365521327694"].forEach((c) => {
      ok(JSON.stringify(phone(c)) === JSON.stringify(M.checkCode(c)), "the phone page checks " + c + " the same way");
    });
  }

  // ---- a Google TV with Home Assistant (TVHA) and Matter through the on-TV server or bridge ----
  {
    const T = page({ tvha: true, devices: SHARED() });
    ok(!T.M.on(), "no Matter before the server answers");
    T.H.useBridge(T.api);
    await flush();
    ok(T.M.on(), "Matter is on once /api/matter/devices answers");
    const ents = T.M.list().map((d) => d.entity);
    ok(ents.join() === "light.matter_1_1,switch.matter_2_1,cover.matter_4_1,climate.matter_5_1,sensor.matter_6_1,switch.matter_a1b2_3", "the page's ids: " + ents);
    ok(!ents.some((e) => /lock|matter_7|matter_8/.test(e)), "the lock and the garage door never show");
    ok(T.M.list().every((d) => /^[a-z]+\.[a-z0-9_]{1,64}$/.test(d.entity)), "every id passes design.js's entity check");
    ok(T.M.list()[5].name === "Hex node b", "markup is taken out of a name");
    // the same info lists the widgets and pick-lists read
    T.H.reload();
    const live = T.H.live();
    ok(live.info.controls.map((c) => c.entity).join() === "light.lamp,light.matter_1_1,switch.matter_2_1,cover.matter_4_1,switch.matter_a1b2_3", "controls: Home Assistant's then Matter's");
    ok(live.info.sensors.map((c) => c.entity).join() === "sensor.pool,sensor.matter_6_1", "sensors merged");
    ok(T.H.available(), "a Matter thermostat counts for the Smart home tile");
    // readings, merged like the Hue and AirTouch ones
    const rooms = await T.H.climate();
    ok(rooms.ok && rooms.rooms.map((r) => r.entity).join() === "climate.lounge,climate.matter_5_1", "rooms merged: " + JSON.stringify(rooms));
    const hall = rooms.rooms[1];
    ok(hall.ok && hall.target === 21 && hall.current === 18.5 && hall.state === "heat" && hall.step === 0.5 && hall.modes.join() === "off,heat,cool" && hall.action === "heating", "a Matter thermostat reads as a room");
    const ctl = await T.H.request("controls");
    const lamp = ctl.controls.find((c) => c.entity === "light.matter_1_1"), blind = ctl.controls.find((c) => c.entity === "cover.matter_4_1"), hex = ctl.controls.find((c) => c.entity === "switch.matter_a1b2_3");
    ok(ctl.ok && ctl.controls.length === 5, "five switches in all");
    ok(lamp.ok && lamp.on && lamp.level === 80 && lamp.kind === "light", "the lamp is on at 80%");
    ok(blind.ok && !blind.on && blind.level === 0 && blind.kind === "cover", "the blind is closed");
    ok(hex.ok === false, "a device that does not answer reads as not answering");
    const sen = await T.H.request("sensors");
    ok(sen.ok && sen.sensors[1].entity === "sensor.matter_6_1" && sen.sensors[1].num === 22.4 && sen.sensors[1].unit === "°C" && sen.sensors[1].cls === "temperature", "the sensor reads with its unit");
    // asking: only the contract id goes to the Matter server, Home Assistant's stay with the launcher
    T.asked.length = 0;
    await T.H.request("set", "switch.matter_2_1", "on");
    await T.H.request("set", "light.lamp", "off");
    await T.H.request("set", "cover.matter_4_1", "open");
    await T.H.request("temp", "climate.matter_5_1", 22.26);
    await T.H.request("mode", "climate.matter_5_1", "cool");
    await T.H.request("off", "climate.matter_5_1");
    const cmds = T.asked.filter((a) => a[0] === "api" && a[2] === "/api/matter/command").map((a) => JSON.stringify(a[3]));
    ok(cmds[0] === '{"id":"matter:2:1","action":"on"}', "a plug switches on by its Matter id: " + cmds[0]);
    ok(cmds[1] === '{"id":"matter:4:1","action":"position","value":100}', "a blind opens all the way: " + cmds[1]);
    ok(cmds[2] === '{"id":"matter:5:1","action":"target","value":22.5}', "a new temperature is rounded to the thermostat's step: " + cmds[2]);
    ok(cmds[3] === '{"id":"matter:5:1","action":"mode","value":"cool"}', "a mode: " + cmds[3]);
    ok(cmds[4] === '{"id":"matter:5:1","action":"off"}', "off: " + cmds[4]);
    ok(T.asked.some((a) => a[0] === "ha" && a[1] === "set" && a[2] === "light.lamp"), "a Home Assistant light still goes to the launcher");
    ok(!T.asked.some((a) => a[0] === "ha" && /matter/.test(a[2] || "")), "a Matter device never goes to Home Assistant");
    // never moved: the garage (not even listed), a mode the thermostat does not have, a lock
    T.asked.length = 0;
    const g = await T.H.request("set", "cover.matter_8_1", "open");
    const m = await T.H.request("mode", "climate.matter_5_1", "dry");
    const l = await T.H.request("set", "lock.matter_7_1", "off");
    // the garage and the lock are not Matter devices of this page at all: they could only go to Home
    // Assistant, which refuses anything not ticked (HomeAssistant.kt), so nothing reaches Matter
    ok(!m.ok && !T.asked.some((a) => a[2] === "/api/matter/command"), "a garage door, a lock and an unknown mode never reach the Matter server");
    ok(!T.M.owns("cover.matter_8_1") && !T.M.owns("lock.matter_7_1") && g && l, "neither is a Matter device of this page");
    // add, rename and remove: the lists change and the screens are told
    let told = 0;
    T.M.onChange(() => told++);
    const bad = await T.M.commission("34970112333");
    ok(!bad.ok && bad.error === "typo" && !T.asked.some((a) => a[2] === "/api/matter/commission"), "a typo never reaches the server");
    const exp = await T.M.commission("749701123365521327694");
    ok(!exp.ok && exp.error === "expired", "the server's answer comes back as its key: " + JSON.stringify(exp));
    const add = await T.M.commission("3497 011 2332");
    ok(add.ok && add.added.join() === "New light" && T.M.owns("light.matter_9_1"), "a new light is added and named: " + JSON.stringify(add));
    T.H.reload();
    ok(T.H.live().info.controls.some((c) => c.entity === "light.matter_9_1"), "and the widgets' list has it");
    ok((await T.M.rename("light.matter_9_1", "Porch")).ok && T.M.list().find((d) => d.entity === "light.matter_9_1").name === "Porch", "renamed");
    ok((await T.M.remove("light.matter_9_1")).ok && !T.M.owns("light.matter_9_1"), "removed");
    ok(told === 3, "the screens were told three times: " + told);
  }

  // ---- Home Assistant down: its rooms stay as not answering, Matter's still answer ----
  {
    const T = page({ tvha: true, haDown: true, devices: SHARED() });
    T.H.useBridge(T.api); await flush();
    const r = await T.H.climate();
    ok(r.ok && r.rooms[0].entity === "climate.lounge" && r.rooms[0].ok === false && r.rooms[1].ok === true, "Home Assistant down: " + JSON.stringify(r.rooms.map((x) => [x.entity, x.ok])));
  }

  // ---- a bridge with no Matter (an older one): nothing changes ----
  {
    const T = page({ tvha: true, noMatter: true });
    T.H.useBridge(T.api); await flush();
    ok(!T.M.on(), "no Matter");
    T.asked.length = 0;
    const c = await T.H.request("controls");
    ok(c.ok && c.controls.map((x) => x.entity).join() === "light.lamp" && !T.asked.some((a) => a[0] === "api"), "only Home Assistant is asked, as before");
  }

  // ---- a Samsung or LG through the bridge (no TVHA), with only Matter: answers wrapped in { result } ----
  {
    const T = page({ devices: SHARED(), wrap: true });
    T.H.useBridge(T.api); await flush();
    ok(T.M.on() && T.M.count() === 6, "the bridge's wrapped answer is read");
    T.H.reload();
    ok(T.H.enabled() && T.H.available(), "Matter alone switches smart home on");
    const r = await T.H.climate();
    ok(r.ok && r.rooms.map((x) => x.entity).join() === "climate.matter_5_1", "the Matter room alone, with no Home Assistant: " + JSON.stringify(r));
  }

  // ---- not ready yet: the note is kept for Home settings ----
  {
    const T = page({ tvha: true, devices: [], ready: false, note: "Matter is starting." });
    T.H.useBridge(T.api); await flush();
    ok(T.M.on() && !T.M.ready() && T.M.note() === "Matter is starting.", "not ready, with its note");
  }

  console.log("ok " + n + " Matter UI checks");
})().catch((e) => { console.error(e); process.exit(1); });
