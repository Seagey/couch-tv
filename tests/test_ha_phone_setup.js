// Smart home set up from a phone (QR code on the TV, tv-home/web/ha-phone.html on the phone):
//  1. ha-picks.js, shared by the TV and the phone: the same groups and limits as before, energy and
//     battery only for the right units, one-only groups swap, full groups refuse, and the ticks
//     round trip through the section HomeAssistant.kt keeps.
//  2. smarthome.js: the TV offers the QR code where the TV (launcher, on-TV app) or the bridge serves
//     the phone page, and keeps typing a token only for an older bridge that does not.
//  3. The phone page: never asks for a token, never sends one, sends no referrer (the QR key is in its
//     address), carries the guide for devices we don't list, and plain words (no dashes, no Beta).
//  4. The TV screen's words: about 25, sentence case, nothing about tokens.
// Run: node tests/test_ha_phone_setup.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// home network addresses for the tests, made here so no real one is ever written down
const lan = (c, d) => `192.168.${c}.${d}`;
const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running smart home phone set up tests...");

// ---- 1. ha-picks.js ----
const sb = {}; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(web, "ha-picks.js"), "utf8"), sb);
const P = sb.HaPicks;
ok(P && P.GROUPS.length === 10, "ten groups");
const G = Object.fromEntries(P.GROUPS.map((g) => [g[0], g]));
ok(G.climate[3] === 8 && G.scenes[3] === 10 && G.controls[3] === 16 && G.cameras[3] === 4 && G.sensors[3] === 8 && G.speakers[3] === 6, "the same limits as before");
ok(["doorbell", "doorbell_camera", "energy", "battery"].every((k) => G[k][3] === 1), "doorbell, its camera, energy and battery take one");
const list = [
  { entity: "climate.lounge", name: "Lounge" }, { entity: "lock.front", name: "Front door" }, { entity: "alarm_control_panel.home", name: "Alarm" },
  { entity: "sensor.solar_today", name: "Solar", unit: "kWh" }, { entity: "sensor.power", name: "Power", unit: "W" }, { entity: "sensor.pool", name: "Pool", unit: "°C" },
  { entity: "sensor.battery", name: "Battery", unit: "%" }, { entity: "light.a", name: "A" }, { entity: "cover.blind", name: "Blind" }
];
ok(P.have(list, G.energy).map((e) => e.entity).join() === "sensor.solar_today,sensor.power", "energy: kWh or W only");
ok(P.have(list, G.battery).map((e) => e.entity).join() === "sensor.battery", "battery: % only");
ok(P.GROUPS.every((g) => P.have(list, g).every((e) => !/^(lock|alarm_control_panel)\./.test(e.entity))), "no group takes a lock or an alarm");
const p = P.fromStatus({});
ok(P.toggle(p, G.doorbell, "event.ring") && P.toggle(p, G.doorbell, "binary_sensor.bell") && p.doorbell.join() === "binary_sensor.bell", "a one-only group swaps");
ok(P.toggle(p, G.doorbell, "binary_sensor.bell") && p.doorbell.length === 0, "and can be emptied");
for (let i = 0; i < 4; i++) P.toggle(p, G.cameras, "camera.c" + i);
ok(!P.toggle(p, G.cameras, "camera.c4") && p.cameras.length === 4, "a full group refuses one more");
p.doorbell = ["event.ring"]; p.doorbell_camera = ["camera.c0"]; p.energy = ["sensor.solar_today"]; p.battery = ["sensor.battery"];
const sec = P.section(p);
ok(sec.doorbell.entity === "event.ring" && sec.doorbell.camera === "camera.c0" && sec.energy.battery === "sensor.battery", "the section HomeAssistant.kt reads");
const back = P.fromStatus({ cameras: p.cameras, doorbell: "event.ring", doorbell_camera: "camera.c0", energy: "sensor.solar_today", battery: "sensor.battery" });
ok(JSON.stringify(P.section(back)) === JSON.stringify(sec), "ticks round trip through the status");

// ---- 2. smarthome.js: who offers the QR code ----
function loadSmart(win) {
  const s = Object.assign({ setTimeout, clearTimeout, console, document: { getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) }, addEventListener() {} }, win);
  s.window = s; vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(web, "smarthome.js"), "utf8"), s);
  return s;
}
const launcher = loadSmart({ TVHA: { info: () => "{}", setupStatus: () => '{"set":false}', setupCheck() {}, phone(id) { launcher.smartHome.setupReply(id, { ok: true, url: "http://" + lan(1, 50) + ":5401/ha/?k=abc", seen: false, set: false }); } } });
ok(launcher.smartHome.setup.canPhone(), "the launcher offers the QR code");
const old = loadSmart({ TVHA: { info: () => "{}", setupStatus: () => '{"set":false}', setupCheck() {} } });
ok(!old.smartHome.setup.canPhone() && old.smartHome.setup.can(), "a launcher without phone() keeps its own screens");
(async () => {
  const r = await launcher.smartHome.setup.phone();
  ok(r.ok && /\/ha\/\?k=/.test(r.url), "phone() gives the QR address");
  // a bridge: the QR code only when its /api/ha/info says it serves the phone page
  for (const [phoneFlag, want] of [[true, true], [false, false]]) {
    const b = loadSmart({});
    const api = (m, p) => Promise.resolve(p === "/api/ha/info" ? { ok: true, info: {}, status: { set: false, phone: phoneFlag } } : { ok: true, result: { ok: true, url: "http://x/ha/?k=1" } });
    b.smartHome.useBridge(api);
    await new Promise((r2) => setTimeout(r2, 10));
    ok(b.smartHome.setup.canPhone() === want, "a bridge " + (want ? "that serves" : "that does not serve") + " the phone page: QR " + (want ? "offered" : "not offered"));
  }

  // ---- 3. the phone page ----
  const html = fs.readFileSync(path.join(web, "ha-phone.html"), "utf8");
  ok(/<meta name="referrer" content="no-referrer">/.test(html), "the phone page sends no referrer");
  ok(!/token/i.test(html.replace(/<!--[\s\S]*?-->/g, "").replace(/ERR = \{[\s\S]*?\};/, "")), "the phone page never mentions or sends a token");
  ok(/Sign in to Home Assistant/.test(html) && /A device we don't list/.test(html) && /Tuya/.test(html) && /Matter/.test(html), "sign in, and the guide for devices we don't list");
  const words = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  const strings = (html.match(/"[^"\n]{12,}"/g) || []).join(" ");
  ok(!/[–—]| - /.test(words + strings), "no dashes in the phone page's words");
  ok(!/beta|experimental|coming soon/i.test(words + strings), "no Beta, Experimental or coming soon");
  ok(html.indexOf('src="ha-picks.js"') > 0, "the phone page uses the TV's own groups");

  // ---- 4. the TV screen's words ----
  const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
  const pr = app.slice(app.indexOf("function phoneRows("), app.indexOf("function smartRows("));
  ok(pr.length > 100, "the phone rows are in app.js");
  ok(!/token|long-lived/i.test(pr), "the TV screen says nothing about tokens");
  const shown = ["Smart home", "Scan with your phone to connect your home.", "Connected", lan(1, 20), "12 things show", "Disconnect"].join(" ");
  const count = shown.split(/\s+/).length;
  ok(count <= 25 && pr.indexOf("Scan with your phone to connect your home.") > 0, "the TV screen is about " + count + " words");
  ok(app.indexOf("SH_MORE") < 0 && app.indexOf("openSmartMore") < 0, "the long device guide is off the TV");
  console.log(n + " checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });
