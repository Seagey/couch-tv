"""Matter on the home computer (bridge/matter.py, docs/MATTER.md), against a pretend Matter service that
speaks the Open Home Foundation Matter Server's WebSocket API: the device model the TV reads, what each
action sends to the device, the plain error keys when adding a device fails, locks, alarms and garage
doors never shown or switched, names kept here, removing, live changes pushed, and the bridge endpoints
behind the pairing rules. tests/fixtures/matter-light-node.json is a real node: the SDK's virtual light
(chip-lighting-app) as the service read it after a Matter share, with the fabric certificates left out."""
import asyncio
import json
import os
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import matter  # noqa: E402

LIGHT = json.load(open(os.path.join(HERE, "fixtures", "matter-light-node.json")))


def node(nid, eps, available=True, basic=None):
    """A node from {endpoint: (device types, {"cluster/attr": value})}."""
    attrs = {"0/40/3": "Thing", "0/29/0": [{"0": 22, "1": 1}]}
    attrs.update(basic or {})
    for ep, (types, a) in eps.items():
        attrs["%d/29/0" % ep] = [{"0": t, "1": 1} for t in types]
        for k, v in a.items():
            attrs["%d/%s" % (ep, k)] = v
    return {"node_id": nid, "available": available, "attributes": attrs}


PLUG = node(10, {1: ([266], {"6/0": True})}, basic={"0/40/5": "Kettle"})
FAN = node(11, {1: ([43], {"514/0": 2, "514/2": 66, "514/3": 66, "514/65532": 1})})
BLIND = node(12, {1: ([514], {"258/14": 2500, "258/10": 0, "258/65532": 5})}, basic={"0/40/5": "Lounge blind"})
GARAGE = node(13, {1: ([514], {"258/14": 10000})}, basic={"0/40/5": "Garage door"})
LOCK = node(14, {1: ([10], {"257/0": 1})}, basic={"0/40/5": "Front door"})
SMOKE = node(15, {1: ([118], {"92/0": 0})})
THERMO = node(16, {1: ([769], {"513/65532": 0b100011, "513/0": 2350, "513/17": 2400, "513/18": 2000, "513/28": 3,
                                "513/41": 2, "513/3": 700, "513/4": 3000, "513/5": 1600, "513/6": 3200, "513/25": 25})},
              basic={"0/40/5": "Bedroom air"})
AIRCON = node(17, {1: ([114], {"513/65532": 0b10, "513/0": 2600, "513/17": 2300, "513/28": 0, "514/0": 5})})
WEATHER = node(18, {1: ([770], {"1026/0": 2154}), 2: ([775], {"1029/0": 4550}), 3: ([262], {"1024/0": 30001}),
                    4: ([263], {"1030/0": 1}), 5: ([21], {"69/0": False}), 6: ([44], {"91/0": 2, "1066/0": 7.5, "1037/0": 612.0})},
               basic={"0/40/5": "Eve Weather"})
BRIDGE = node(19, {1: ([14], {}), 2: ([256, 19], {"6/0": False, "57/5": "Hall light"}), 3: ([10, 19], {"257/0": 1, "57/5": "Back door"}),
                   4: ([266, 19], {"6/0": True, "57/3": "Smart plug"})})
OFFLINE = node(20, {1: ([256], {"6/0": True})}, available=False)


def one(n, **kw):
    return matter.devices_of(n, **kw)


class ModelTest(unittest.TestCase):
    def test_real_light_from_a_share(self):
        d = one(LIGHT)
        self.assertEqual(len(d), 1)
        d = d[0]
        self.assertEqual((d["id"], d["domain"], d["state"], d["name"]), ("matter:1:1", "light", "off", "TEST_PRODUCT"))
        self.assertEqual(d["attributes"]["supported_color_modes"], ["color_temp", "hs"])
        self.assertEqual((d["attributes"]["min_color_temp_kelvin"], d["attributes"]["max_color_temp_kelvin"]), (2203, 6494))
        on = json.loads(json.dumps(LIGHT))
        on["attributes"].update({"1/6/0": True, "1/8/0": 127, "1/768/7": 370, "1/768/8": 2})
        a = one(on)[0]["attributes"]
        self.assertEqual((a["brightness"], a["level"], a["color_temp_kelvin"], a["color_mode"]), (128, 50, 2703, "color_temp"))
        on["attributes"].update({"1/768/8": 0, "1/768/0": 127, "1/768/1": 254})
        self.assertEqual(one(on)[0]["attributes"]["hs_color"], [180, 100])

    def test_every_domain(self):
        self.assertEqual([(d["domain"], d["state"], d["name"]) for d in one(PLUG)], [("switch", "on", "Kettle")])
        f = one(FAN)[0]
        self.assertEqual((f["domain"], f["state"], f["attributes"]["percentage"], f["attributes"]["preset_mode"]), ("fan", "on", 66, "medium"))
        b = one(BLIND)[0]
        self.assertEqual((b["domain"], b["state"], b["attributes"]["current_position"]), ("cover", "open", 75))
        t = one(THERMO)[0]
        self.assertEqual((t["domain"], t["state"]), ("climate", "cool"))
        a = t["attributes"]
        self.assertEqual(a["hvac_modes"], ["off", "heat", "cool", "heat_cool"])
        self.assertEqual((a["current_temperature"], a["temperature"], a["min_temp"], a["max_temp"], a["target_temp_step"], a["hvac_action"]),
                         (23.5, 24.0, 7.0, 32.0, 0.5, "cooling"))
        ac = one(AIRCON)[0]
        self.assertEqual((ac["state"], ac["attributes"]["hvac_modes"], ac["attributes"]["hvac_action"], ac["attributes"]["fan_mode"]),
                         ("off", ["off", "cool", "dry", "fan_only"], "off", "auto"))
        s = {d["attributes"]["device_class"]: d for d in one(WEATHER)}
        self.assertEqual(sorted(s), ["aqi", "contact", "humidity", "illuminance", "occupancy", "temperature"])
        self.assertEqual((s["temperature"]["state"], s["temperature"]["attributes"]["unit_of_measurement"]), ("21.54", "°C"))
        self.assertEqual((s["humidity"]["state"], s["humidity"]["attributes"]["unit_of_measurement"]), ("45.5", "%"))
        self.assertEqual(s["illuminance"]["state"], "1000")
        self.assertEqual(s["occupancy"]["state"], "on")
        self.assertEqual((s["contact"]["state"], s["contact"]["attributes"]["reading"]), ("on", "open"))
        self.assertEqual((s["aqi"]["state"], s["aqi"]["attributes"]["pm25"], s["aqi"]["attributes"]["co2"]), ("fair", 7.5, 612.0))
        self.assertEqual(s["temperature"]["name"], "Eve Weather temperature")
        self.assertTrue(all(d["domain"] == "sensor" for d in s.values()))
        self.assertEqual(one(OFFLINE)[0]["state"], "unavailable")

    def test_never_locks_alarms_or_garage_doors(self):
        self.assertEqual(one(LOCK), [])
        self.assertEqual(one(SMOKE), [])
        self.assertEqual(one(GARAGE), [])
        self.assertTrue(matter.blocked_only(LOCK))
        self.assertTrue(matter.blocked_only(SMOKE))
        self.assertFalse(matter.blocked_only(PLUG))
        b = one(BRIDGE)
        self.assertEqual([(d["id"], d["name"], d["domain"]) for d in b], [("matter:19:2", "Hall light", "light"), ("matter:19:4", "Smart plug", "switch")])
        self.assertFalse(matter.blocked_only(BRIDGE))
        # a blind renamed "Garage" here is hidden too
        self.assertEqual(matter.devices_of(BLIND, {"matter:12:1": "Garage roller"}), [])

    def test_codes(self):
        self.assertEqual(matter.clean_code("3005-491-2331"), "30054912331")
        self.assertEqual(matter.clean_code(" 0640 913 7006 "), "06409137006")
        self.assertIsNone(matter.clean_code("30054912332"))    # one digit wrong: the check digit fails
        self.assertIsNone(matter.clean_code("1234"))
        self.assertIsNone(matter.clean_code("90054912331"))
        self.assertEqual(matter.clean_code("mt:-24j06pf15380648g00"), "MT:-24J06PF15380648G00")
        self.assertIsNone(matter.clean_code("MT:<script>"))
        self.assertIsNone(matter.clean_code(None))


class PlanTest(unittest.TestCase):
    def p(self, n, action, value=None, last=None, ep=1):
        d = next(x for x in one(n) if x["id"].endswith(":%d" % ep))
        return matter.plan(d, n, ep, action, value, last)

    def test_lights_and_switches(self):
        self.assertEqual(self.p(LIGHT, "on"), [("cmd", 6, "On", {})])
        self.assertEqual(self.p(LIGHT, "toggle"), [("cmd", 6, "Toggle", {})])
        self.assertEqual(self.p(LIGHT, "level", "100")[0][3]["level"], 254)
        self.assertEqual(self.p(LIGHT, "level", 0), [("cmd", 6, "Off", {})])
        self.assertEqual(self.p(LIGHT, "temp", 2700)[0][3]["colorTemperatureMireds"], 370)
        self.assertEqual(self.p(LIGHT, "temp", 100000)[0][3]["colorTemperatureMireds"], 154)   # held to the lamp's coolest
        c = self.p(LIGHT, "colour", "#0000ff")[0]
        self.assertEqual((c[2], c[3]["hue"], c[3]["saturation"]), ("MoveToHueAndSaturation", 169, 254))
        self.assertEqual(self.p(LIGHT, "colour", "120,50")[0][3]["hue"], 85)
        self.assertEqual(self.p(LIGHT, "colour", [120, 50])[0][3]["hue"], 85)
        self.assertEqual(self.p(LIGHT, "colour", {"h": 120, "s": 50})[0][3]["saturation"], 127)
        self.assertIsNone(self.p(LIGHT, "colour", "red"))
        self.assertIsNone(self.p(LIGHT, "level", "loud"))
        self.assertIsNone(self.p(LIGHT, "target", 21))
        self.assertEqual(self.p(PLUG, "off"), [("cmd", 6, "Off", {})])
        self.assertIsNone(self.p(PLUG, "level", 50))

    def test_fan_cover_climate(self):
        self.assertEqual(self.p(FAN, "off"), [("write", "1/514/0", 0)])
        self.assertEqual(self.p(FAN, "on"), [("write", "1/514/0", 4)])
        self.assertEqual(self.p(FAN, "level", 30), [("write", "1/514/2", 30)])
        self.assertEqual(self.p(FAN, "toggle"), [("write", "1/514/0", 0)])
        self.assertEqual(self.p(BLIND, "on"), [("cmd", 258, "UpOrOpen", {})])
        self.assertEqual(self.p(BLIND, "toggle"), [("cmd", 258, "DownOrClose", {})])
        self.assertEqual(self.p(BLIND, "position", 75), [("cmd", 258, "GoToLiftPercentage", {"liftPercent100thsValue": 2500})])
        self.assertEqual(self.p(THERMO, "mode", "heat"), [("write", "1/513/28", 4)])
        self.assertEqual(self.p(THERMO, "mode", "heat_cool"), [("write", "1/513/28", 1)])
        self.assertIsNone(self.p(THERMO, "mode", "dry"))
        self.assertEqual(self.p(THERMO, "target", "22.3"), [("write", "1/513/17", 2250)])   # cooling: the cooling set point, in half degrees
        self.assertEqual(self.p(THERMO, "target", 99), [("write", "1/513/17", 3200)])
        self.assertEqual(self.p(THERMO, "off"), [("write", "1/513/28", 0)])
        self.assertEqual(self.p(AIRCON, "on"), [("write", "1/513/28", 3)])
        self.assertEqual(self.p(AIRCON, "on", last="dry"), [("write", "1/513/28", 8)])
        self.assertEqual(self.p(AIRCON, "target", 19), [("write", "1/513/17", 1900)])

    def test_sensors_only_read(self):
        for ep in range(1, 7):
            for action in matter.ACTIONS:
                self.assertIsNone(self.p(WEATHER, action, 1, ep=ep))


class FakeService:
    """Answers like the Matter service does: server info first, then start_listening, then events."""

    def __init__(self, nodes):
        self.nodes = {n["node_id"]: n for n in nodes}
        self.calls = []
        self.answers = {}
        self.ws = None

    async def handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws = ws
        await ws.send_json({"sdk_version": "fake", "schema_version": 15})
        async for msg in ws:
            d = json.loads(msg.data)
            self.calls.append((d["command"], d["args"]))
            a = self.answers.get(d["command"])
            if callable(a):
                a = a(d["args"])
            if a is None:
                a = {"result": list(self.nodes.values())} if d["command"] == "start_listening" else {"result": None}
            await ws.send_json(dict(a, message_id=d["message_id"]))
            if d["command"] == "device_command" and d["args"]["command_name"] in ("On", "Off"):
                await ws.send_json({"event": "attribute_updated", "data": [d["args"]["node_id"], "%d/6/0" % d["args"]["endpoint_id"],
                                                                            d["args"]["command_name"] == "On"]})
        return ws


def run(c):
    return asyncio.run(c)


class ServiceTest(unittest.TestCase):
    async def started(self, fake):
        app = web.Application()
        app.router.add_get("/ws", fake.handler)
        server = TestServer(app)
        await server.start_server()
        self.pushed = []
        m = matter.Matter(self.dir, {"server": "ws://127.0.0.1:%d/ws" % server.port}, on_change=self.pushed.append)
        await m.start()
        for _ in range(100):
            if m.ready:
                break
            await asyncio.sleep(0.02)
        return m, server

    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def test_devices_commands_and_live_changes(self):
        async def go():
            fake = FakeService([LIGHT, PLUG, LOCK, THERMO])
            m, server = await self.started(fake)
            try:
                self.assertTrue(m.ready)
                a = m.answer()
                self.assertEqual([d["id"] for d in a["devices"]], ["matter:1:1", "matter:10:1", "matter:16:1"])
                v = a["version"]
                self.assertNotIn("note", a)
                r = await m.command("matter:1:1", "on")
                self.assertTrue(r["ok"])
                self.assertEqual(r["state"], "on")
                self.assertEqual(fake.calls[-1], ("device_command", {"node_id": 1, "endpoint_id": 1, "cluster_id": 6, "command_name": "On", "payload": {}}))
                await asyncio.sleep(0.4)
                self.assertTrue(self.pushed and self.pushed[-1][0]["state"] == "on")
                self.assertGreater(m.answer()["version"], v)
                n = len(fake.calls)
                for bad in [("matter:14:1", "on"), ("matter:1:1", "unlock"), ("matter:99:1", "on"), ("light.x", "on"), ("matter:10:1", "target")]:
                    self.assertEqual((await m.command(*bad))["error"], "refused", bad)
                self.assertEqual(len(fake.calls), n)   # nothing reached a device
                r = await m.command("matter:16:1", "target", 21)
                self.assertEqual(fake.calls[-1], ("write_attribute", {"node_id": 16, "attribute_path": "1/513/17", "value": 2100}))
                fake.answers["device_command"] = {"error_code": 3, "details": "node not ready"}
                self.assertEqual((await m.command("matter:10:1", "off"))["error"], "unavailable")
                # a node going away and coming back
                await fake.ws.send_json({"event": "node_removed", "data": 10})
                await asyncio.sleep(0.1)
                self.assertNotIn("matter:10:1", [d["id"] for d in m.devices()])
                await fake.ws.send_json({"event": "node_added", "data": PLUG})
                await asyncio.sleep(0.1)
                self.assertIn("matter:10:1", [d["id"] for d in m.devices()])
            finally:
                await m.stop()
                await server.close()
        run(go())

    def test_adding_a_device(self):
        async def go():
            fake = FakeService([])
            m, server = await self.started(fake)
            try:
                fake.answers["commission_with_code"] = {"result": PLUG}
                r = await m.commission("0640-913-7006")
                self.assertEqual(r, {"ok": True, "device_ids": ["matter:10:1"]})
                self.assertEqual(fake.calls[-1], ("commission_with_code", {"code": "06409137006", "network_only": True, "discovery_timeout_s": 30}))
                # with an address: the code's passcode, straight to that address, no discovery
                fake.answers["parse_onboarding_payload"] = {"result": {"type": "manual", "short_discriminator": 13, "setup_pin_code": 60635739}}
                fake.answers["commission_on_network"] = {"result": FAN}
                r = await m.commission("06409137006", "[fd00::1234]:5540")
                self.assertEqual(r, {"ok": True, "device_ids": ["matter:11:1"]})
                self.assertEqual(fake.calls[-1], ("commission_on_network", {"setup_pin_code": 60635739, "ip_addr": "fd00::1234"}))
                self.assertEqual(matter.clean_address("192.0.2.50:5540"), "192.0.2.50")
                self.assertEqual(matter.clean_address("fe80::1%en0"), "fe80::1%en0")
                for bad in ["evil.example.com", "http://1.2.3.4", "1.2.3.4; rm", "[::1"]:
                    self.assertIsNone(matter.clean_address(bad), bad)
                n = len(fake.calls)
                self.assertEqual((await m.commission("06409137006", "not an address"))["error"], "unreachable")
                self.assertEqual((await m.commission("06409137007"))["error"], "wrong_code")
                self.assertEqual(len(fake.calls), n)   # a mistyped code never reaches the service
                cases = [({"error_code": 1, "reason": "passcode-mismatch", "details": "x"}, True, "wrong_code"),
                         ({"error_code": 1, "reason": "not-discovered", "details": "x"}, True, "expired"),
                         ({"error_code": 1, "reason": "timeout", "details": "x"}, False, "thread"),
                         ({"error_code": 1, "reason": "timeout", "details": "x"}, True, "unreachable"),
                         ({"error_code": 1, "reason": "attestation-rejected", "details": "x"}, True, "unreachable"),
                         ({"error_code": 0, "details": "boom"}, True, "unreachable")]
                for answer, route, key in cases:
                    fake.answers["commission_with_code"] = answer
                    with patch.object(matter, "thread_route", return_value=route):
                        r = await m.commission("06409137006")
                    self.assertEqual((r["ok"], r["error"]), (False, key), answer)
                    self.assertTrue(r["note"] and " - " not in r["note"] and "\u2014" not in r["note"] and "\u2013" not in r["note"])
                # a lock shared by mistake: Couch TV leaves its fabric at once
                fake.answers["commission_with_code"] = {"result": LOCK}
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "not_allowed")
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": 14}))
                self.assertEqual([d["id"] for d in m.devices()], ["matter:10:1", "matter:11:1"])   # the lock left, the plug and fan stay
            finally:
                await m.stop()
                await server.close()
        run(go())

    def test_rename_and_remove(self):
        async def go():
            fake = FakeService([PLUG, BRIDGE])
            m, server = await self.started(fake)
            try:
                self.assertEqual(m.rename("matter:10:1", "  Kitchen   kettle "), {"ok": True, "name": "Kitchen kettle"})
                self.assertEqual(next(d for d in m.devices() if d["id"] == "matter:10:1")["name"], "Kitchen kettle")
                path = os.path.join(self.dir, "matter-names.json")
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
                for bad in [("matter:10:1", ""), ("matter:10:1", "x" * 41), ("matter:10:1", "<b>"), ("matter:19:3", "Back door"), ("matter:5:1", "x")]:
                    self.assertEqual(m.rename(*bad)["error"], "refused", bad)
                self.assertEqual(matter.Matter(self.dir, {})._names, {"matter:10:1": "Kitchen kettle"})   # kept across a restart
                self.assertEqual(await m.remove("matter:19:3"), {"ok": False, "error": "refused"})   # the lock on the bridge
                self.assertEqual(await m.remove("matter:10:1"), {"ok": True, "removed": ["matter:10:1"]})
                self.assertEqual(await m.remove("matter:19:2"), {"ok": True, "removed": ["matter:19:2", "matter:19:4"]})   # the whole node
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": 19}))
                self.assertEqual(m.devices(), [])
                self.assertEqual(json.load(open(path)), {})
            finally:
                await m.stop()
                await server.close()
        run(go())

    def test_not_ready(self):
        async def go():
            m = matter.Matter(self.dir, {"server": "ws://127.0.0.1:9/ws"})
            await m.start()
            await asyncio.sleep(0.1)
            a = m.answer()
            self.assertEqual((a["devices"], a["ready"]), ([], False))
            self.assertIn("starting", a["note"])
            self.assertEqual((await m.commission("06409137006"))["error"], "unreachable")
            await m.stop()
        run(go())

    def test_why_not(self):
        self.assertIn("switched off", matter.Matter(self.dir, {"enabled": False}).why_not())
        with patch.object(matter, "ENTRY", "/nowhere/bin.js"):
            self.assertIn("scripts/matter-setup.sh", matter.Matter(self.dir, {}).why_not())
        with patch.object(matter, "ENTRY", __file__), patch.object(matter, "node_version", return_value=(20, 11)):
            self.assertIn("It has 20.11", matter.Matter(self.dir, {}).why_not())
        with patch.object(matter, "ENTRY", __file__), patch.object(matter, "node_version", return_value=None):
            self.assertIn("not installed", matter.Matter(self.dir, {}).why_not())
        with patch.object(matter, "ENTRY", __file__), patch.object(matter, "node_version", return_value=(22, 13)):
            self.assertIsNone(matter.Matter(self.dir, {}).why_not())
        m = matter.Matter(self.dir, {"test_devices": True})
        args = m.service_args()
        self.assertEqual(args[args.index("--listen-address") + 1], "127.0.0.1")   # never on the home network
        self.assertIn("--enable-test-net-dcl", args)
        self.assertNotIn("--enable-test-net-dcl", matter.Matter(self.dir, {}).service_args())
        self.assertEqual(args[args.index("--default-fabric-label") + 1], "Couch TV")
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.dir, "matter")).st_mode), 0o700)


class EndpointTest(unittest.TestCase):
    """The bridge's own endpoints: behind the same rule as Home Assistant's, and pushed to the TV pages."""

    def test_routes_and_guard(self):
        import server
        from aiohttp.test_utils import make_mocked_request
        paths = {(r.method, r.resource.canonical) for r in server.make_app().router.routes() if hasattr(r.resource, "canonical")}
        for p in [("GET", "/api/matter/devices"), ("GET", "/api/matter/events"), ("POST", "/api/matter/commission"), ("POST", "/api/matter/command"),
                  ("POST", "/api/matter/remove"), ("POST", "/api/matter/rename")]:
            self.assertIn(p, paths)
        req = make_mocked_request("GET", "/api/matter/devices")
        with patch.object(server.config, "PAIRING_KEY", ""), patch.object(server, "client_ip", return_value="192.0.2.77"), \
                patch.object(server, "_tv_ips", return_value={"192.0.2.5"}):
            with self.assertRaises(server.ApiError):
                run(server.h_matter_devices(req))
        with patch.object(server.config, "PAIRING_KEY", ""), patch.object(server, "client_ip", return_value="192.0.2.5"), \
                patch.object(server, "_tv_ips", return_value={"192.0.2.5"}):
            r = run(server.h_matter_devices(req))
            self.assertTrue({"ok", "devices", "ready", "version"} <= set(json.loads(r.body)))

    def test_push(self):
        import server
        q, q2 = asyncio.Queue(), asyncio.Queue()
        server.events_clients.add((q, "any-tv"))
        server.matter_clients.add(q2)
        try:
            with patch.object(server.MATTER, "nodes", {"10": PLUG}):
                server.push_matter()
            for msg in (q.get_nowait(), q2.get_nowait()):
                self.assertTrue(msg.startswith("event: matter\ndata: "))
                d = json.loads(msg.split("data: ", 1)[1])
                self.assertEqual((d["devices"][0]["id"], d["devices"][0]["state"]), ("matter:10:1", "on"))
                self.assertIn("version", d)
        finally:
            server.events_clients.discard((q, "any-tv"))
            server.matter_clients.discard(q2)

    def test_commission_answers_400_when_it_fails(self):
        import server
        from aiohttp.test_utils import make_mocked_request

        async def body(_):
            return {"code": "123"}
        req = make_mocked_request("POST", "/api/matter/commission")
        with patch.object(server.config, "PAIRING_KEY", "x" * 16), patch.object(server, "body", body):
            r = run(server.h_matter_commission(req))
        self.assertEqual((r.status, json.loads(r.body)["error"]), (400, "wrong_code"))


if __name__ == "__main__":
    unittest.main()
