// Rooms per TV on the TV page (tv-home/web/smarthome.js setRoom, lane B 28 Nov 2026), in plain node with a pretend launcher:
// the shared rule (tests/fixtures/room_caps.json), lists cut down to this TV's room, asks for another room refused before the
// launcher is called, the room handed to the launcher and to the home computer, and a TV with no room unchanged.
//   node tests/test_rooms_page.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "../tv-home/web/smarthome.js"), "utf8");
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/room_caps.json"), "utf8"));

function page() {
  const asked = [], rooms = [], posts = [];
  const TVHA = {
    info: () => JSON.stringify({ climate: [{ entity: "climate.lounge", name: "Lounge" }, { entity: "climate.guest", name: "Guest" }],
      controls: [{ entity: "light.lounge", name: "Lamp" }, { entity: "light.guest", name: "Guest lamp" }, { entity: "switch.kettle", name: "Kettle" }],
      speakers: [{ entity: "media_player.lounge", name: "Lounge" }], scenes: [{ entity: "scene.movie", name: "Movie" }] }),
    request: (id, action, entity) => {
      asked.push([action, entity]);
      const r = action === "climate" ? { ok: true, rooms: [{ entity: "climate.lounge" }, { entity: "climate.guest" }] }
        : action === "controls" ? { ok: true, controls: [{ entity: "light.lounge" }, { entity: "light.guest" }, { entity: "switch.kettle" }] }
        : { ok: true };
      setTimeout(() => ctx.smartHome.reply(id, r), 0);
    },
    setupStatus: () => "{}", setupCheck() {},
    setupRoomFromAccount: (id, room) => { rooms.push(JSON.parse(room)); setTimeout(() => ctx.smartHome.setupReply(id, { ok: true }), 0); },
  };
  const ctx = { TVHA, document: { getElementById: () => null, hidden: false, addEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console, JSON, Date, Math, Promise };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, sh: ctx.smartHome, asked, rooms, posts };
}

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. the rule, the same cases as every copy
{
  const { sh } = page();
  for (const c of FIX.cases) { assert.equal(sh.roomAllows(c.room, c.entity), c.ok, JSON.stringify(c)); n++; }
}
// 2. no room: everything, unchanged
{
  const { sh } = page();
  ok(sh.devices("climate").length === 2, "no room: both air cons");
  const r = await sh.request("on", "climate.lounge");
  ok(r.ok === true, "no room: the lounge answers");
}
// 3. the guest room TV
{
  const { sh, asked, rooms } = page();
  const api = async (m, p, b) => { posts.push([m, p, b]); return { result: { ok: true } }; };
  const posts = [];
  sh.useBridge(api);
  sh.setRoom({ label: "Guest room", only: true, climate: ["climate.guest"], lights: ["light.guest"] });
  ok(JSON.stringify(sh.devices("climate").map((d) => d[0])) === '["climate.guest"]', "only the guest air con is listed");
  ok(JSON.stringify(sh.devices("light").map((d) => d[0])) === '["light.guest"]', "only the guest lamp");
  ok(sh.devices("switch").length === 1, "switches are not capped");
  ok(sh.devices("media_player").length === 0, "no speakers: only, and no list");
  ok(sh.devices(["scene"]).length === 1, "scenes are not capped");
  const before = asked.length;
  const no = await sh.request("on", "climate.lounge");
  ok(no.ok === false && no.error === "refused", "the lounge is refused by name");
  const no2 = await sh.request("set", "light.lounge", "on");
  ok(no2.error === "refused", "the lounge lamp is refused by name");
  ok(asked.length === before, "and the launcher was never asked");
  const yes = await sh.request("on", "climate.guest");
  ok(yes.ok === true, "the guest air con answers");
  const list = await sh.climate();
  ok(JSON.stringify(list.rooms.map((x) => x.entity)) === '["climate.guest"]', "the rooms answer is cut down too");
  const ctl = await sh.request("controls");
  ok(JSON.stringify(ctl.controls.map((x) => x.entity)) === '["light.guest","switch.kettle"]', "and the controls answer");
  await new Promise((r) => setTimeout(r, 5));
  ok(rooms.length === 1 && rooms[0].only === true && rooms[0].climate[0] === "climate.guest", "the launcher was given the room");
  ok(posts.some((p) => p[1] === "/api/ha/room" && p[2].room.lights[0] === "light.guest"), "the home computer was given the room");
  // the same room again: nothing sent again
  sh.setRoom({ label: "Guest room", only: true, climate: ["climate.guest"], lights: ["light.guest"] });
  await new Promise((r) => setTimeout(r, 5));
  ok(rooms.length === 1, "an unchanged room is not sent again");
  // the account takes the room away
  sh.setRoom(null);
  await new Promise((r) => setTimeout(r, 5));
  ok(sh.devices("climate").length === 2 && rooms.length === 2 && rooms[1] === null, "room gone: everything again, and the launcher told");
  // a name only caps nothing
  sh.setRoom({ label: "Lounge" });
  ok(sh.room() === null, "a name alone is no room");
}
// 4. G11: names in other languages (tests/fixtures/opens_house_names.json), as the page runs it, and a named opener left out of the lists
{
  const NAMES = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/opens_house_names.json"), "utf8"));
  const { sh } = page();
  for (const c of NAMES.refuse) { assert.equal(sh.nameOpensHouse(c.entity, c.name), true, "misses " + c.name); n++; }
  for (const c of NAMES.pass) { assert.equal(sh.nameOpensHouse(c.entity, c.name), false, "hides " + c.name); n++; }
  const p2 = page();
  p2.ctx.TVHA.info = () => JSON.stringify({ climate: [], controls: [{ entity: "switch.relay_1", name: "Garagentor" }, { entity: "switch.kettle", name: "Wasserkocher" }], scenes: [{ entity: "scene.s1", name: "Alarme maison" }, { entity: "scene.movie", name: "Soirée cinéma" }] });
  ok(JSON.stringify(p2.sh.devices("switch").map((d) => d[0])) === '["switch.kettle"]', "a switch named Garagentor is never listed");
  ok(JSON.stringify(p2.sh.scenes().map((d) => d.entity)) === '["scene.movie"]', "a scene named Alarme maison is never listed");
}
console.log("test_rooms_page: " + n + " checks passed");
