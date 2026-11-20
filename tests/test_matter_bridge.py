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
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from aiohttp import web

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_SERVICE = os.path.join(HERE, "fixtures", "fake_matter_service.py")
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import matter  # noqa: E402
REAL_MULTICAST_BLOCKED = matter.multicast_blocked   # ServiceTest patches it; its own test needs the real one

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
        # live run 21 Nov (contract test, list group): an off light still says its level and colour temperature
        self.assertTrue({"brightness", "level", "color_temp_kelvin"} <= set(d["attributes"]), d["attributes"])
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

    def test_name_rule_whole_words_every_language(self):
        """Fable 3 and 6: whole words only, in every language the home speaks, on blinds, plugs and on/off only lights."""
        def cover(nm):
            return bool(matter.devices_of(node(30, {1: ([514], {"258/14": 2500})}, basic={"0/40/5": nm})))
        shown = ["Outdoor blind", "Indoor blind", "Clock side blind", "Margate blind", "Block out blind", "Lounge blind",
                 "Doorway curtain", "Gateway shade", "Blocks", "Motor blind", "Kapalı perde", "Portal blind", "Studio blind",
                 "Bramble blind", "Report blind", "Grandeur blind", "Brave blind", "Bravo blind", "Torch blind"]
        hidden = ["Garage door", "garage", "Front gate", "Back door", "Door", "Lock", "Roller door", "Gate 2",
                  "Garagentor", "Haustür", "Tor", "Einfahrtstor", "Gartentor", "Türschloss",                 # de
                  "Garagedeur", "Voordeur", "Poort", "Tuinhek",                                              # nl
                  "Portail", "Porte du garage", "Porte de garage", "Barrière", "Serrure",                    # fr
                  "Puerta del garaje", "Portón", "Cochera", "Cerradura",                                    # es
                  "Cancello", "Porta del garage", "Portone", "Serratura", "Basculante",                      # it
                  "Portão", "Garagem", "Porta da garagem", "Fechadura",                                     # pt
                  "Garaj kapısı", "Kapı", "KAPI", "Kilit",                                                   # tr
                  "Garažna vrata", "Kapija", "Brava",                                                        # sr
                  "Brama garażowa", "Drzwi", "Zamek", "Garaż",                                               # pl
                  "Garáž", "Brána", "Dveře", "Zámek",                                                        # cs
                  "דלת המוסך", "שער", "הדלת",                                                                # he
                  "باب الكراج", "بوابة", "قفل", "المرآب"]                                                     # ar
        for nm in shown:
            self.assertTrue(cover(nm), nm)
        for nm in hidden:
            self.assertFalse(cover(nm), nm)
        # plugs and on/off only lights (what a garage door opener usually is) by the same rule
        for types, attrs in (([266], {"6/0": False}), ([256], {"6/0": False})):
            self.assertEqual(matter.devices_of(node(31, {1: (types, attrs)}, basic={"0/40/5": "Garage door"})), [])
            self.assertEqual(len(matter.devices_of(node(31, {1: (types, attrs)}, basic={"0/40/5": "Outdoor lamp"}))), 1)
        # a dimmable light called "Garage" is a light in the garage, and stays
        self.assertEqual(matter.devices_of(node(32, {1: ([257], {"6/0": True, "8/0": 100})}, basic={"0/40/5": "Garage"}))[0]["name"], "Garage")
        self.assertEqual(matter.devices_of(node(33, {1: ([43], {"514/0": 0})}, basic={"0/40/5": "Garage fan"}))[0]["domain"], "fan")

    def test_hvac_action_without_running_state(self):
        """Harness 09be187 (contract change 1): every climate device has hvac_action, also when the
        thermostat does not serve ThermostatRunningState (the fixture thermostat does not)."""
        def act(attrs):
            base = {"513/65532": 0b100011, "513/0": 2350, "513/17": 2400, "513/18": 2000}
            base.update(attrs)
            return one(node(70, {1: ([769], base)}))[0]["attributes"]["hvac_action"]
        self.assertEqual(act({"513/28": 3, "513/0": 2600}), "cooling")      # cool, room 26, set point 24
        self.assertEqual(act({"513/28": 3, "513/0": 2300}), "idle")
        self.assertEqual(act({"513/28": 4, "513/0": 1800}), "heating")      # heat, room 18, set point 20
        self.assertEqual(act({"513/28": 4, "513/0": 2100}), "idle")
        self.assertEqual(act({"513/28": 0}), "off")
        self.assertEqual(act({"513/28": 4, "513/8": 40}), "heating")         # heating demand 40 %
        self.assertEqual(act({"513/28": 3, "513/7": 0, "513/8": 0}), "idle")
        self.assertEqual(act({"513/28": 3, "513/41": 2}), "cooling")         # running state wins

    def test_joined_names(self):
        """Checker 21 Nov (A): names written as one word or with a number still say garage door, gate or door."""
        def cover(nm):
            return bool(matter.devices_of(node(30, {1: ([514], {"258/14": 2500})}, basic={"0/40/5": nm})))
        for nm in ("GarageDoor", "Garage2", "MyGarage", "Gate_1", "Door1", "garage_door", "FrontGate"):
            self.assertFalse(cover(nm), nm)
            self.assertTrue(matter.opens_house(nm), nm)
        for nm in ("Outdoor blind", "Indoor blind", "Margate blind", "Blind 2", "Bedroom_blind", "LoungeBlind"):
            self.assertTrue(cover(nm), nm)
        self.assertFalse(matter.opens_house(""))
        self.assertFalse(matter.opens_house(None))

    def test_closures_are_blocked(self):
        """Checker 21 Nov (D): Matter 1.5 Closure Control (0x0104) and Closure Dimension (0x0105) clusters and the
        Closure (560) and Closure Panel (561) device types never show, whatever else the endpoint serves."""
        self.assertEqual((matter.CLOSURE_CONTROL, matter.CLOSURE_DIMENSION), (0x0104, 0x0105))
        self.assertEqual(matter.BLOCKED_TYPES, {10, 118, 560, 561})
        for cl in (0x0104, 0x0105):
            n = node(60, {1: ([], {"6/0": True, "%d/0" % cl: 0})})
            self.assertEqual(one(n), [], cl)
            self.assertTrue(matter.blocked_only(n))
            n = node(61, {1: ([514], {"258/14": 0, "%d/0" % cl: 0})}, basic={"0/40/5": "Lounge blind"})
            self.assertEqual(one(n), [], cl)
        for t in (560, 561):
            self.assertEqual(one(node(62, {1: ([t], {"6/0": True})})), [], t)

    def test_no_hidden_text_controls_in_names(self):
        """Checker 21 Nov (G): zero width and text direction controls never reach the screen."""
        for ch in ("\u200b", "\u200f", "\u202a", "\u202e", "\u2066", "\u2069", "\x7f"):
            self.assertIsNone(matter.NAME.fullmatch("Lounge" + ch + "lamp"), repr(ch))
            self.assertEqual(matter.tidy_name("Lounge" + ch + "lamp"), "Lounge lamp", repr(ch))
        # "Gar\u200bage door" must not slip past the name rule
        n = node(63, {1: ([514], {"258/14": 0})}, basic={"0/40/5": "Garage\u200b door"})
        self.assertEqual(one(n), [])
        self.assertTrue(matter.NAME.fullmatch("Café lamp"))

    def test_device_names_follow_the_name_rule(self):
        """Fable 11: a device's own label goes through the same rule as a typed name."""
        n = node(34, {1: ([266], {"6/0": True})}, basic={"0/40/5": "  <b>Kettle</b>\n\x07plug  " + "x" * 60})
        name = one(n)[0]["name"]
        self.assertTrue(matter.NAME.fullmatch(name), name)
        self.assertTrue(name.startswith("b Kettle /b plug"), name)
        self.assertEqual(len(name), 40)
        self.assertEqual(one(node(35, {1: ([266], {"6/0": True})}, basic={"0/40/5": "<>\x01", "0/40/3": "Smart plug"}))[0]["name"], "Smart plug")
        self.assertEqual(one(node(36, {1: ([266], {"6/0": True})}, basic={"0/40/5": " \n ", "0/40/3": None}))[0]["name"], "Plug")

    def test_xy_colour_gives_hs(self):
        """Fable 10: a lamp in xy mode still has hs_color."""
        for rgb, hs in (((255, 0, 0), [0, 100]), ((0, 255, 0), [120, 100]), ((0, 0, 255), [240, 100]), ((255, 255, 255), None)):
            got = matter.xy_to_hs(*matter.rgb_to_xy(*rgb))
            if hs is None:
                self.assertLess(got[1], 3)
            else:
                self.assertEqual(got, hs, rgb)
        self.assertIsNone(matter.xy_to_hs(0.3, 0))
        on = json.loads(json.dumps(LIGHT))
        x, y = matter.rgb_to_xy(255, 0, 0)
        on["attributes"].update({"1/6/0": True, "1/8/0": 127, "1/768/8": 1, "1/768/3": round(x * 65536), "1/768/4": round(y * 65536)})
        a = one(on)[0]["attributes"]
        self.assertEqual((a["color_mode"], a["hs_color"]), ("xy", [0, 100]))
        self.assertEqual(len(a["xy_color"]), 2)

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
    """Answers like the Matter service does: server info first, then start_listening, then events. It listens
    on a unix socket, the only way the bridge reaches its Matter service."""

    def __init__(self, nodes):
        self.nodes = {n["node_id"]: n for n in nodes}
        self.calls = []
        self.answers = {}
        self.ws = None
        self.connections = 0
        self.connect_after_add = True   # the real service sends node_updated, available, once it holds a connection
        self.unanswered = set()         # node ids whose reads time out (switched off)

    async def handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws = ws
        self.connections += 1
        await ws.send_json({"sdk_version": "fake", "schema_version": 15})
        async for msg in ws:
            d = json.loads(msg.data)
            self.calls.append((d["command"], d["args"]))
            a = self.answers.get(d["command"])
            if d["command"] == "read_attribute" and d["args"]["node_id"] in self.unanswered:
                continue   # no answer at all, like a device that is off
            if callable(a):
                a = a(d["args"])
            if isinstance(a, dict) and "_delay" in a:   # a slow answer, like adding a device takes
                a = dict(a)
                await asyncio.sleep(a.pop("_delay"))
            if a is None:
                a = {"result": list(self.nodes.values())} if d["command"] == "start_listening" else {"result": None}
            await ws.send_json(dict(a, message_id=d["message_id"]))
            if d["command"] == "device_command" and d["args"]["command_name"] in ("On", "Off"):
                await ws.send_json({"event": "attribute_updated", "data": [d["args"]["node_id"], "%d/6/0" % d["args"]["endpoint_id"],
                                                                            d["args"]["command_name"] == "On"]})
            res = a.get("result")
            if d["command"].startswith("commission") and isinstance(res, dict) and self.connect_after_add:
                await asyncio.sleep(0.3)
                await ws.send_json({"event": "node_updated", "data": dict(res, available=True)})
            if d["command"] == "remove_node" and "error_code" not in a:
                self.nodes.pop(d["args"]["node_id"], None)
                await ws.send_json({"event": "node_removed", "data": d["args"]["node_id"]})
        return ws


def run(c):
    return asyncio.run(c)


async def serve(fake, sock):
    app = web.Application()
    app.router.add_get("/ws", fake.handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.UnixSite(runner, sock).start()
    return runner


async def until(cond, secs=5.0):
    for _ in range(int(secs / 0.02)):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return cond()


class ServiceTest(unittest.TestCase):
    async def started(self, fake):
        sock = os.path.join(self.dir, "fake.sock")
        runner = await serve(fake, sock)
        self.pushed = []
        m = matter.Matter(self.dir, {}, on_change=self.pushed.append, socket_path=sock, spawn=False)
        await m.start()
        await until(lambda: m.ready)
        return m, runner

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        # the computer running the tests may itself lack Local Network permission: the answers here
        # are about the service's errors, so multicast is taken as allowed unless a test says otherwise
        p = patch.object(matter, "multicast_blocked", return_value=False)
        p.start()
        self.addCleanup(p.stop)

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
                self.assertNotIn("reason", a)
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
                await server.cleanup()
        run(go())

    def test_a_command_that_changes_nothing_answers_at_once(self):
        """Fable 12: no report comes for a change that is not one, so the answer does not wait 2.5 s for it."""
        async def go():
            fake = FakeService([PLUG, FAN, THERMO, BLIND])
            m, server = await self.started(fake)
            try:
                for did, action, value in [("matter:10:1", "on", None), ("matter:11:1", "level", 66), ("matter:16:1", "mode", "cool"),
                                           ("matter:16:1", "target", 24), ("matter:12:1", "position", 75)]:
                    t = time.monotonic()
                    r = await m.command(did, action, value)
                    self.assertTrue(r["ok"], (did, action))
                    self.assertLess(time.monotonic() - t, 0.5, (did, action))
                # a real change with no report yet waits for it, at most 2.5 s
                t = time.monotonic()
                self.assertTrue((await m.command("matter:11:1", "level", 20))["ok"])
                self.assertGreater(time.monotonic() - t, 2.3)
                self.assertLess(time.monotonic() - t, 3.0)
                # an on that is one: the device's report ends the wait (the fake reports On and Off)
                t = time.monotonic()
                self.assertEqual((await m.command("matter:10:1", "off"))["state"], "off")
                self.assertLess(time.monotonic() - t, 1.0)
            finally:
                await m.stop()
                await server.cleanup()
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
                # with an address: the code's passcode, straight to that address, no discovery past 30 seconds
                fake.answers["parse_onboarding_payload"] = {"result": {"type": "manual", "short_discriminator": 13, "setup_pin_code": 60635739}}
                fake.answers["commission_on_network"] = {"result": FAN}
                r = await m.commission("06409137006", "[fd00::1234]:5540")
                self.assertEqual(r, {"ok": True, "device_ids": ["matter:11:1"]})
                self.assertEqual(fake.calls[-1], ("commission_on_network", {"setup_pin_code": 60635739, "ip_addr": "fd00::1234", "discovery_timeout_s": 30}))
                self.assertEqual(matter.clean_address("192.0.2.50:5540"), "192.0.2.50")
                self.assertEqual(matter.clean_address("192.0.2.50"), "192.0.2.50")
                self.assertEqual(matter.clean_address("[fd00::1]"), "fd00::1")
                for bad in ["evil.example.com", "http://1.2.3.4", "1.2.3.4; rm", "[::1", "999.1.1.1"]:
                    self.assertEqual(matter.address_problem(bad), (None, "address"), bad)
                # Fable 8: the service only ever tries port 5540 and ignores fe80: say so instead of pretending
                for bad, why in [("192.0.2.50:5641", "port"), ("[fd00::1]:80", "port"), ("fe80::1%en0", "link_local"), ("[fe80::1]:5540", "link_local")]:
                    self.assertEqual(matter.address_problem(bad), (None, why), bad)
                n = len(fake.calls)
                for addr, why in [("not an address", "address"), ("192.0.2.50:5641", "port"), ("fe80::1%en0", "link_local")]:
                    r = await m.commission("06409137006", addr)
                    self.assertEqual((r["ok"], r["error"], r["reason"]), (False, "unreachable", why), addr)
                    self.assertTrue(r["note"] and "—" not in r["note"] and " - " not in r["note"])
                self.assertEqual((await m.commission("06409137007"))["error"], "wrong_code")
                self.assertEqual(len(fake.calls), n)   # a mistyped code or a bad address never reaches the service
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
                    self.assertTrue(r["note"] and " - " not in r["note"] and "—" not in r["note"] and "–" not in r["note"])
                # a lock shared by mistake: Couch TV leaves its fabric at once
                fake.answers["commission_with_code"] = {"result": LOCK}
                r = await m.commission("06409137006")
                self.assertEqual((r["error"], r["reason"]), ("not_allowed", "blocked"))
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": 14}))
                self.assertEqual([d["id"] for d in m.devices()], ["matter:10:1", "matter:11:1"])   # the lock left, the plug and fan stay
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_nothing_to_show_is_never_kept(self):
        """Fable 2: a garage door, a speaker (type 34) or a switch that only sends (type 15) is left again at once."""
        async def go():
            fake = FakeService([])
            m, server = await self.started(fake)
            try:
                speaker = node(40, {1: ([34], {"6/0": True})})
                sender = node(41, {1: ([15], {"59/1": 0})})
                for n, reason in ((GARAGE, "blocked"), (speaker, "unsupported"), (sender, "unsupported"), (SMOKE, "blocked")):
                    fake.answers["commission_with_code"] = {"result": n}
                    before = len(fake.calls)
                    r = await m.commission("06409137006")
                    self.assertEqual((r["ok"], r["error"], r["reason"], r["device_ids"]), (False, "not_allowed", reason, []), n["node_id"])
                    self.assertIn(("remove_node", {"node_id": n["node_id"]}), fake.calls[before:])
                    self.assertNotIn(str(n["node_id"]), m.nodes)
                    self.assertTrue(r["note"].endswith("It is still in your other home app."))
                self.assertEqual(m.devices(), [])
                # leaving fails (the device stopped answering): it is forgotten here and left again later
                fake.answers["remove_node"] = {"error_code": 4, "details": "no answer"}
                fake.answers["commission_with_code"] = {"result": speaker}
                fake.nodes[40] = speaker   # the service still holds it
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "not_allowed")
                self.assertEqual(json.load(open(os.path.join(self.dir, "matter-forgotten.json"))), ["40"])
                self.assertEqual(m.devices(), [])
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_the_device_is_told_to_drop_the_fabric(self):
        """Live run 21 Nov: the service's remove_node only tells a device to drop its fabric while it
        holds a live subscription; straight after adding it has none, so the fixture lock and alarm kept
        Couch TV's keys. Couch TV now reads the fabric index the device gave it and sends RemoveFabric
        itself, then lets the service forget the node."""
        async def go():
            fake = FakeService([PLUG])
            m, server = await self.started(fake)
            try:
                holds = {"n": 1}     # how many reads still answer as Couch TV (the fabric is there)

                def read(a):
                    if a["attribute_path"] != "0/62/5":
                        return {"result": {}}
                    if holds["n"] <= 0:
                        return {"error_code": 4, "details": "no session"}
                    holds["n"] -= 1
                    return {"result": {"0/62/5": 3}}
                fake.answers["read_attribute"] = read
                fake.answers["device_command"] = {"error_code": 0, "details": "session closed"}   # what the device does
                fake.answers["commission_with_code"] = {"result": LOCK}
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "not_allowed")
                tail = [c for c in fake.calls if c[0] != "start_listening"][-4:]
                self.assertEqual(tail, [("read_attribute", {"node_id": 14, "attribute_path": "0/62/5"}),
                                        ("device_command", {"node_id": 14, "endpoint_id": 0, "cluster_id": 62,
                                                            "command_name": "RemoveFabric", "payload": {"fabricIndex": 3}}),
                                        ("read_attribute", {"node_id": 14, "attribute_path": "0/62/5"}),
                                        ("remove_node", {"node_id": 14})])
                # the same on remove from the TV; a device that missed the first RemoveFabric gets a second
                holds["n"] = 2
                n = len(fake.calls)
                r = await m.remove("matter:10:1")
                self.assertEqual(r["removed"], ["matter:10:1"])
                self.assertEqual([c[0] for c in fake.calls[n:]], ["read_attribute", "device_command", "read_attribute",
                                                                  "device_command", "read_attribute", "remove_node"])
                # live run: after RemoveFabric the service often lets the node go by itself, so remove_node
                # answers "node does not exist": that is a clean leave, nothing kept for later
                fake.answers["remove_node"] = {"error_code": 5, "details": "Node 15 does not exist"}
                fake.answers["commission_with_code"] = {"result": GARAGE}
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "not_allowed")
                self.assertFalse(os.path.exists(os.path.join(self.dir, "matter-forgotten.json")))
                fake.answers.pop("remove_node")
                # a device that does not take the command is still forgotten by the service, never kept
                holds["n"] = 9
                fake.answers["commission_with_code"] = {"result": SMOKE}
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "not_allowed")
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": SMOKE["node_id"]}))
                self.assertEqual(m.devices(), [])
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_a_second_add_while_one_runs_is_busy(self):
        """Contract change 15: a second commission while one runs answers at once, error and reason busy."""
        async def go():
            fake = FakeService([])
            m, server = await self.started(fake)
            try:
                fake.answers["commission_with_code"] = {"result": PLUG, "_delay": 1.0}
                first = asyncio.ensure_future(m.commission("06409137006"))
                await asyncio.sleep(0.2)
                t = time.monotonic()
                r = await m.commission("06409137006")
                self.assertLess(time.monotonic() - t, 0.5)
                self.assertEqual((r["ok"], r["error"], r["reason"], r["device_ids"]), (False, "busy", "busy", []))
                self.assertTrue(r["note"])
                self.assertEqual((await first)["ok"], True)
                # once the first has finished, the next one is taken again
                fake.answers["commission_with_code"] = {"error_code": 1, "reason": "not-discovered", "details": "x"}
                r = await m.commission("06409137006")
                self.assertEqual(r["error"], "expired")
                # an add that fails with an exception never leaves Couch TV stuck on busy
                with patch.object(m, "_commission", side_effect=RuntimeError("boom")):
                    with self.assertRaises(RuntimeError):
                        await m.commission("06409137006")
                self.assertFalse(m._adding)
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_every_refusal_has_a_reason(self):
        """Contract change 15: every answer that is not ok carries a non empty reason key."""
        async def go():
            fake = FakeService([PLUG, THERMO])
            m, server = await self.started(fake)
            try:
                answers = []

                async def add(answer, code="06409137006", address=None):
                    fake.answers["commission_with_code"] = answer
                    fake.answers["commission_on_network"] = answer
                    answers.append(("commission", await m.commission(code, address)))
                await add({"result": PLUG}, code="123")
                for a in ({"error_code": 1, "reason": "passcode-mismatch", "details": ""},
                          {"error_code": 1, "reason": "not-discovered", "details": ""},
                          {"error_code": 1, "reason": "other", "details": "already commissioned"},
                          {"error_code": 1, "reason": "attestation-rejected", "details": ""},
                          {"error_code": 1, "reason": "other", "details": "boom"},
                          {"result": None}):
                    await add(a)
                with patch.object(matter, "thread_route", return_value=False):
                    await add({"error_code": 1, "reason": "timeout", "details": ""})
                with patch.object(matter, "thread_route", return_value=True):
                    await add({"error_code": 1, "reason": "timeout", "details": ""})
                fake.answers["parse_onboarding_payload"] = {"result": {}}
                await add({"result": None}, address="192.0.2.9")
                await add({"result": None}, address="192.0.2.9:80")
                await add({"result": SMOKE})
                answers.append(("command", await m.command("matter:99:1", "on")))
                answers.append(("command", await m.command("matter:10:1", "dance")))
                answers.append(("command", await m.command("matter:10:1", "level", 50)))   # a plug has no level
                answers.append(("command", await m.command("matter:16:1", "mode", "party")))
                fake.answers["device_command"] = {"error_code": 7, "details": "boom"}
                answers.append(("command", await m.command("matter:10:1", "off")))
                fake.answers["device_command"] = {"error_code": 3, "details": "not ready"}
                answers.append(("command", await m.command("matter:10:1", "off")))
                fake.answers["write_attribute"] = {"result": [{"Status": 135}]}
                answers.append(("command", await m.command("matter:16:1", "mode", "cool")))
                answers.append(("rename", m.rename("matter:99:1", "Lamp")))
                answers.append(("rename", m.rename("matter:10:1", "")))
                answers.append(("rename", m.rename("matter:10:1", "x" * 41)))
                answers.append(("rename", m.rename("matter:10:1", "Garage door")))
                answers.append(("remove", await m.remove("matter:99:1")))
                self.assertEqual(len(answers), 24)
                for kind, r in answers:
                    self.assertIs(r["ok"], False, (kind, r))
                    self.assertTrue(isinstance(r.get("reason"), str) and r["reason"], (kind, r))
                reasons = [r["reason"] for _, r in answers]
                self.assertEqual(reasons, ["wrong_code", "wrong_code", "expired", "already", "not_certified", "failed",
                                           "unreachable", "thread", "unreachable", "wrong_code", "port", "blocked",
                                           "not_found", "bad_request", "bad_request", "bad_request", "failed", "not_ready",
                                           "device_refused", "not_found", "bad_name", "bad_name", "opens_house",
                                           "not_found"])
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_local_network_blocked_on_a_mac(self):
        """Launchd run on the MacBook, 21 Nov: with no Local Network permission mDNS fails with errno 65 and
        every add ends "expired". The answer then says why: error unreachable, reason local_network."""
        async def go():
            fake = FakeService([])
            m, server = await self.started(fake)
            try:
                fake.answers["commission_with_code"] = {"error_code": 1, "reason": "not-discovered", "details": ""}
                with patch.object(matter, "multicast_blocked", return_value=True):
                    r = await m.commission("06409137006")
                self.assertEqual((r["error"], r["reason"]), ("unreachable", "local_network"))
                self.assertIn("Local Network", r["note"])
                with patch.object(matter, "multicast_blocked", return_value=False):
                    r = await m.commission("06409137006")
                self.assertEqual((r["error"], r["reason"]), ("expired", "expired"))
                # a wrong passcode is the code, never the permission
                fake.answers["commission_with_code"] = {"error_code": 1, "reason": "passcode-mismatch", "details": ""}
                with patch.object(matter, "multicast_blocked", return_value=True):
                    self.assertEqual((await m.commission("06409137006"))["reason"], "wrong_code")
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_multicast_blocked_reads_the_errno(self):
        import errno
        import socket

        class Sock:
            def __init__(self, err):
                self.err = err

            def sendto(self, data, addr):
                if self.err:
                    raise OSError(self.err, "x")

            def close(self):
                pass
        with patch.object(matter.sys, "platform", "darwin"):
            for err, want in ((None, False), (errno.EHOSTUNREACH, True), (errno.EACCES, False)):
                with patch.object(socket, "socket", lambda *a, e=err: Sock(e)):
                    self.assertEqual(REAL_MULTICAST_BLOCKED(), want, err)
        with patch.object(matter.sys, "platform", "linux"):
            self.assertFalse(REAL_MULTICAST_BLOCKED())

    def test_already_added(self):
        """Live run 21 Nov: the same device shared a second time answers error already, not unreachable."""
        async def go():
            fake = FakeService([PLUG])
            m, server = await self.started(fake)
            try:
                fake.answers["commission_with_code"] = {"error_code": 1, "reason": "other", "details": "Commission failed: Commission "
                                                      "error: This device is already commissioned into this fabric."}
                r = await m.commission("06409137006")
                self.assertEqual((r["ok"], r["error"], r["device_ids"]), (False, "already", []))
                self.assertEqual([d["id"] for d in m.devices()], ["matter:10:1"])
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_a_device_that_stops_answering_shows_unavailable(self):
        """Live run 21 Nov: the service noticed a stopped plug only when its subscription ran out (over
        90 s). A device quiet for PROBE_QUIET seconds is asked for one value; no answer: unavailable;
        an answer again: back, and read once in full. A sleepy battery device (ICD) is never asked."""
        async def go():
            sleepy = node(50, {1: ([266], {"6/0": True})})
            sleepy["attributes"]["0/70/0"] = 300
            fake = FakeService([PLUG, sleepy])
            with patch.multiple(matter, PROBE_EVERY=0.1, PROBE_QUIET=0.3, PROBE_TIMEOUT=0.3):
                m, server = await self.started(fake)
                try:
                    fake.answers["read_attribute"] = {"result": {"0/40/0": 17}}
                    await asyncio.sleep(1.0)
                    self.assertEqual(m.devices()[0]["state"], "on")   # it answers: nothing changes
                    self.assertIn(("read_attribute", {"node_id": 10, "attribute_path": "0/40/0"}), fake.calls)
                    self.assertNotIn(50, [c[1].get("node_id") for c in fake.calls if c[0] == "read_attribute"])
                    fake.unanswered.add(10)
                    self.assertTrue(await until(lambda: m.devices()[0]["state"] == "unavailable", 3))
                    self.assertTrue(await until(lambda: self.pushed and self.pushed[-1][0]["state"] == "unavailable", 1))   # pushed to the TV
                    r = await m.command("matter:10:1", "off")
                    self.assertEqual(r["error"], "unavailable")
                    fake.unanswered.discard(10)
                    self.assertTrue(await until(lambda: m.devices()[0]["state"] == "on", 3))
                    self.assertTrue(await until(lambda: ("interview_node", {"node_id": 10}) in fake.calls, 2))
                    # a report from the device ends unavailable at once too
                    fake.unanswered.add(10)
                    self.assertTrue(await until(lambda: m.devices()[0]["state"] == "unavailable", 3))
                    await fake.ws.send_json({"event": "attribute_updated", "data": [10, "1/6/0", False]})
                    self.assertTrue(await until(lambda: m.devices()[0]["state"] == "off", 1))
                finally:
                    await m.stop()
                    await server.cleanup()
        run(go())

    def test_rename_and_remove(self):
        async def go():
            fake = FakeService([PLUG, BRIDGE, BLIND, GARAGE])
            m, server = await self.started(fake)
            try:
                self.assertEqual(m.rename("matter:10:1", "  Kitchen   kettle "), {"ok": True, "name": "Kitchen kettle"})
                self.assertEqual(next(d for d in m.devices() if d["id"] == "matter:10:1")["name"], "Kitchen kettle")
                path = os.path.join(self.dir, "matter-names.json")
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
                for bad in [("matter:10:1", ""), ("matter:10:1", "x" * 41), ("matter:10:1", "<b>"), ("matter:19:3", "Back door"), ("matter:5:1", "x")]:
                    self.assertEqual(m.rename(*bad)["error"], "refused", bad)
                # Fable 3: a name that would hide the device is refused, with the reason; whole words only
                for nm in ("Garage door", "Front gate", "Portail", "Puerta del garaje", "Haustür"):
                    r = m.rename("matter:12:1", nm)
                    self.assertEqual((r["ok"], r["reason"]), (False, "opens_house"), nm)
                self.assertEqual(m.rename("matter:12:1", "Outdoor blind"), {"ok": True, "name": "Outdoor blind"})
                self.assertIn("matter:12:1", [d["id"] for d in m.devices()])
                self.assertEqual(m.rename("matter:10:1", "Garage kettle")["reason"], "opens_house")   # a plug too
                self.assertEqual(matter.Matter(self.dir, {})._names, {"matter:10:1": "Kitchen kettle", "matter:12:1": "Outdoor blind"})   # kept across a restart
                # remove finds the node by any of its ids, shown or not: the lock behind the bridge, the hidden garage door
                self.assertEqual(await m.remove("matter:10:1"), {"ok": True, "removed": ["matter:10:1"]})
                self.assertEqual(await m.remove("matter:19:3"), {"ok": True, "removed": ["matter:19:2", "matter:19:4"]})   # the whole node
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": 19}))
                self.assertEqual(await m.remove("matter:13:1"), {"ok": True, "removed": []})
                self.assertEqual(fake.calls[-1], ("remove_node", {"node_id": 13}))
                for bad in ("matter:12:9", "matter:99:1", "light.x", None):
                    self.assertEqual(await m.remove(bad), {"ok": False, "error": "refused", "reason": "not_found"}, bad)
                self.assertEqual([d["id"] for d in m.devices()], ["matter:12:1"])
                self.assertEqual(json.load(open(path)), {"matter:12:1": "Outdoor blind"})
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_a_device_that_does_not_answer_is_forgotten_anyway(self):
        """Fable 9, contract change 7: removing a device that does not answer forgets it here, with a note."""
        async def go():
            fake = FakeService([PLUG, OFFLINE, FAN])
            m, server = await self.started(fake)
            try:
                # offline: the service removes it without contacting it (its decommissionNode does that)
                r = await m.remove("matter:20:1")
                self.assertEqual((r["ok"], r["removed"], r["reason"]), (True, ["matter:20:1"], "offline"))
                self.assertIn("remove it there", r["note"])
                # the service cannot leave it (an error, or no answer): forgotten here anyway, and left later
                fake.answers["remove_node"] = {"error_code": 4, "details": "Node 10 is not reachable"}
                r = await m.remove("matter:10:1")
                self.assertEqual((r["ok"], r["removed"], r["reason"]), (True, ["matter:10:1"], "not_answering"))
                self.assertNotIn("matter:10:1", [d["id"] for d in m.devices()])
                self.assertEqual(json.load(open(os.path.join(self.dir, "matter-forgotten.json"))), ["10"])
                self.assertEqual((await m.command("matter:10:1", "on"))["error"], "refused")
                # the service sends it again (a node update): still not shown
                await fake.ws.send_json({"event": "node_updated", "data": PLUG})
                await asyncio.sleep(0.1)
                self.assertEqual([d["id"] for d in m.devices()], ["matter:11:1"])
                self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.dir, "matter-forgotten.json")).st_mode), 0o600)
                # the next time the service is reached it is left properly, and then forgotten for good
                del fake.answers["remove_node"]
                n = fake.connections
                await fake.ws.close()
                self.assertTrue(await until(lambda: fake.connections > n and m.ready, 8))
                self.assertTrue(await until(lambda: not m._forgotten, 3))
                self.assertIn(("remove_node", {"node_id": 10}), fake.calls)
                self.assertEqual(json.load(open(os.path.join(self.dir, "matter-forgotten.json"))), [])
                self.assertEqual(matter.Matter(self.dir, {})._forgotten, set())
            finally:
                await m.stop()
                await server.cleanup()
        run(go())

    def test_not_ready(self):
        async def go():
            m = matter.Matter(self.dir, {}, socket_path=os.path.join(self.dir, "nobody.sock"), spawn=False)
            await m.start()
            await asyncio.sleep(0.1)
            a = m.answer()
            self.assertEqual((a["devices"], a["ready"], a["reason"]), ([], False, "starting"))
            self.assertIn("starting", a["note"])
            r = await m.commission("06409137006")
            self.assertEqual((r["error"], r["reason"]), ("unreachable", "starting"))
            await m.stop()
        run(go())

    def test_why_not_and_reason_keys(self):
        """Fable 13: every reason Matter is not ready has a key the screens translate."""
        def reason(section=None, **patches):
            async def go():
                m = matter.Matter(self.dir, section or {})
                with patch.multiple(matter, **patches) if patches else patch.object(matter, "LOG_CHECK", 60):
                    await m.start()
                a = m.answer()
                await m.stop()
                return a.get("reason"), a.get("note")
            return run(go())
        self.assertEqual(reason({"enabled": False})[0], "off")
        self.assertEqual(reason({"enabled": "no"})[0], "off")
        self.assertEqual(reason(ENTRY="/nowhere/bin.js")[0], "not_installed")
        self.assertEqual(reason(ENTRY=__file__, node_version=lambda *_: (20, 11)), ("node_old", "Matter needs Node.js 22.13 or newer on the home computer. It has 20.11."))
        self.assertEqual(reason(ENTRY=__file__, node_version=lambda *_: None)[0], "node_missing")
        with patch.object(matter, "ENTRY", __file__), patch.object(matter, "node_version", return_value=(22, 13)):
            self.assertIsNone(matter.Matter(self.dir, {}).why_not())
        for key in ("off", "not_installed", "node_missing", "node_old", "starting", "stopped"):
            self.assertRegex(key, r"^[a-z_]{2,24}$")   # what the screens accept (tv-home/web/matter.js)

    def test_service_never_on_a_network_port(self):
        """Fable 4: the service listens only on a unix socket in a folder only this user can open."""
        m = matter.Matter(self.dir, {"test_devices": True})
        args = m.service_args()
        sock = args[args.index("--listen-address") + 1]
        self.assertTrue(sock.startswith("/") and sock.endswith("/ws.sock"))
        self.assertLessEqual(len(sock.encode()), 104)
        self.assertNotIn("--port", args)
        for flag in ("--disable-dashboard", "--disable-ota", "--disable-thread-diagnostics", "--enable-test-net-dcl"):
            self.assertIn(flag, args)
        self.assertNotIn("--enable-test-net-dcl", matter.Matter(self.dir, {}).service_args())
        self.assertEqual(args[args.index("--default-fabric-label") + 1], "Couch TV")
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(sock)).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.dir, "matter")).st_mode), 0o700)
        # a bridge folder too deep for a socket path: a short folder of this user's own, mode 700
        deep = os.path.join(self.dir, *(["a-rather-long-folder-name"] * 5))
        s2 = matter.Matter(deep, {}).socket_path()
        self.assertLessEqual(len(s2.encode()), matter.SOCKET_MAX)
        st = os.lstat(os.path.dirname(s2))
        self.assertTrue(stat.S_ISDIR(st.st_mode))
        self.assertEqual((st.st_uid, stat.S_IMODE(st.st_mode)), (os.getuid(), 0o700))
        self.assertEqual(matter.Matter(deep, {}).socket_path(), s2)   # the same one every start
        # someone left a link where that folder goes: never followed, a fresh private folder instead
        d = os.path.dirname(s2)
        os.rmdir(d)
        os.symlink(self.dir, d)
        try:
            s3 = matter.Matter(deep, {}).socket_path()
            self.assertNotEqual(os.path.dirname(s3), d)
            st = os.lstat(os.path.dirname(s3))
            self.assertEqual((stat.S_ISDIR(st.st_mode), stat.S_IMODE(st.st_mode)), (True, 0o700))
            os.rmdir(os.path.dirname(s3))
        finally:
            os.remove(d)

    def test_old_server_and_port_settings_are_ignored(self):
        """Fable 4 and 7: no connecting to whatever listens on a TCP port; the "server" mode is gone."""
        async def go():
            hits = []

            async def h(request):
                hits.append(request.path)
                return web.Response(text="no")
            app = web.Application()
            app.router.add_get("/ws", h)
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "127.0.0.1", 0)
            await site.start()
            port = site._server.sockets[0].getsockname()[1]
            m = matter.Matter(self.dir, {"server": "ws://127.0.0.1:%d/ws" % port, "port": port},
                              socket_path=os.path.join(self.dir, "nobody.sock"), spawn=False)
            await m.start()
            await asyncio.sleep(0.5)
            self.assertEqual(hits, [])
            self.assertFalse(m.ready)
            await m.stop()
            await runner.cleanup()
        run(go())

    def test_bad_settings_never_crash(self):
        """Fable 15: whatever config.json says, the bridge starts."""
        for section in ({"port": "abc"}, {"port": None}, {"enabled": "maybe"}, {"node": 5}, {"node": ""}, {"test_devices": [1]},
                        ["matter"], "on", None, 5, {"server": 7}):
            m = matter.Matter(self.dir, section)
            self.assertIsInstance(m.node_bin, str)
            self.assertIsInstance(m.service_args(), list)
        self.assertFalse(matter.Matter(self.dir, {"test_devices": "no"}).test_devices)
        self.assertTrue(matter.Matter(self.dir, {"test_devices": "yes"}).test_devices)

    def test_service_log_kept_under_5_mb_while_running(self):
        """Fable 14: the log is trimmed while the service runs, not only when it starts."""
        m = matter.Matter(self.dir, {})
        path = m._logpath()
        with open(path, "ab") as lf:   # the service holds it open for appending, as it does
            lf.write(b"x" * (matter.LOG_MAX + 10))
            lf.flush()
            self.assertTrue(m._trim_log())
            self.assertEqual(os.path.getsize(path), 0)
            self.assertEqual(os.path.getsize(path + ".1"), matter.LOG_MAX + 10)
            lf.write(b"after\n")
            lf.flush()
        self.assertEqual(open(path, "rb").read(), b"after\n")
        self.assertFalse(m._trim_log())

        async def loop_trims():
            with patch.object(matter, "LOG_CHECK", 0.05):
                m2 = matter.Matter(self.dir, {})
                t = asyncio.ensure_future(m2._log_loop())
                with open(path, "ab") as lf:
                    lf.write(b"y" * (matter.LOG_MAX + 1))
                await asyncio.sleep(0.3)
                m2._stopping = True
                t.cancel()
            return os.path.getsize(path)
        self.assertEqual(run(loop_trims()), 0)


@unittest.skipIf(sys.platform == "win32", "no unix sockets")
class ProcessTest(unittest.TestCase):
    """Fable 12: the real start, restart, leftover and exit code paths, with a pretend service process
    started exactly the way the bridge starts the real one."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.patches = [patch.object(matter, "ENTRY", FAKE_SERVICE), patch.object(matter, "node_version", return_value=(22, 13))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def matter(self):
        return matter.Matter(self.dir, {"node": sys.executable})

    def alive(self, pid):
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        try:
            st = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True).stdout.strip()
        except OSError:
            st = ""
        return not st.startswith("Z")

    def test_start_restart_and_stop(self):
        async def go():
            m = self.matter()
            await m.start()
            try:
                self.assertTrue(await until(lambda: m.ready, 20), m.answer())
                pid = m.proc.pid
                self.assertEqual(int(open(m._pidfile()).read()), pid)
                args = json.load(open(os.path.join(self.dir, "matter", "args.json")))
                self.assertEqual(args[args.index("--listen-address") + 1], m.socket_path())
                self.assertNotIn("--port", args)
                # the service dies: the bridge says so, starts it again, and connects again
                m.proc.kill()
                self.assertTrue(await until(lambda: not m.ready, 5))
                self.assertIn(m.answer()["reason"], ("stopped", "starting"))
                self.assertTrue(await until(lambda: m.ready and m.proc and m.proc.pid != pid, 20), m.answer())
                pid2 = m.proc.pid
            finally:
                await m.stop()
            self.assertFalse(self.alive(pid2))
            self.assertFalse(os.path.exists(m._pidfile()))   # a clean stop leaves no pid file
        run(go())

    def test_a_leftover_service_is_ended_without_freezing_the_bridge(self):
        async def go():
            m = self.matter()
            args = m.service_args()
            # a service left by a bridge that was killed: not our child, so start it through a shell that exits
            out = subprocess.run(["sh", "-c", 'nohup "$@" >/dev/null 2>&1 & echo $!', "sh"] + args,
                                 capture_output=True, text=True).stdout.strip()
            pid = int(out)
            with open(m._pidfile(), "w") as f:
                f.write(str(pid))
            self.assertTrue(await until(lambda: os.path.exists(m.socket_path()), 10))
            ticks = []

            async def ticker():
                while True:
                    ticks.append(time.monotonic())
                    await asyncio.sleep(0.05)
            t = asyncio.ensure_future(ticker())
            started = time.monotonic()
            self.assertTrue(await m._end_leftover())
            took = time.monotonic() - started
            t.cancel()
            gaps = [b - a for a, b in zip(ticks, ticks[1:])]
            self.assertLess(max(gaps), 0.5)          # the event loop kept running all the while
            self.assertGreater(len(ticks), took / 0.05 / 2)
            self.assertTrue(await until(lambda: not self.alive(pid), 10))
            # a pid that is not our service is never touched
            other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            try:
                with open(m._pidfile(), "w") as f:
                    f.write(str(other.pid))
                self.assertFalse(await m._end_leftover())
                self.assertIsNone(other.poll())
            finally:
                other.kill()
                other.wait()
            with open(m._pidfile(), "w") as f:
                f.write("not a number")
            self.assertFalse(await m._end_leftover())
        run(go())

    def test_atexit_ends_the_service(self):
        async def go():
            m = self.matter()
            with patch.object(matter.atexit, "register") as reg:
                await m.start()
                try:
                    self.assertTrue(await until(lambda: m.ready, 20), m.answer())
                    self.assertEqual(reg.call_args[0][0], m._kill_at_exit)
                    p = m.proc
                    m._kill_at_exit()   # what runs when the bridge ends any way but a kill
                    await asyncio.wait_for(p.wait(), 10)
                    self.assertIsNotNone(p.returncode)
                finally:
                    await m.stop()
        run(go())


class EndpointTest(unittest.TestCase):
    """The bridge's own endpoints: behind the same rule as Home Assistant's, and pushed to the TV pages."""

    def test_routes_and_guard(self):
        import server
        from aiohttp.test_utils import make_mocked_request
        paths = {(r.method, r.resource.canonical) for r in server.make_app().router.routes() if hasattr(r.resource, "canonical")}
        for p in [("GET", "/api/matter/devices"), ("GET", "/api/matter/events"), ("POST", "/api/matter/commission"), ("POST", "/api/matter/command"),
                  ("POST", "/api/matter/remove"), ("POST", "/api/matter/rename")]:
            self.assertIn(p, paths)
        for h in ("h_matter_devices", "h_matter_events", "h_matter_commission", "h_matter_command", "h_matter_remove", "h_matter_rename"):
            self.assertEqual(getattr(server, h).__code__.co_name, "guarded", h)
        req = make_mocked_request("GET", "/api/matter/devices")
        with patch.object(server.config, "PAIRING_KEY", ""), patch.object(server, "client_ip", return_value="192.0.2.77"), \
                patch.object(server, "_tv_ips", return_value={"192.0.2.5"}):
            with self.assertRaises(server.ApiError):
                run(server.h_matter_devices(req))
        with patch.object(server.config, "PAIRING_KEY", ""), patch.object(server, "client_ip", return_value="192.0.2.5"), \
                patch.object(server, "_tv_ips", return_value={"192.0.2.5"}):
            r = run(server.h_matter_devices(req))
            self.assertTrue({"ok", "devices", "ready", "version"} <= set(json.loads(r.body)))

    def test_a_stuck_page_is_let_go(self):
        """Checker 21 Nov (C): a page that stops reading cannot hold the event handler: a write that takes
        longer than MATTER_WRITE_WAIT ends it like a reset, and the listener is removed."""
        import server
        from aiohttp.test_utils import make_mocked_request

        class Stuck:
            def __init__(self, *a, **k):
                self.writes = 0

            async def prepare(self, request):
                return None

            async def write(self, data):
                self.writes += 1
                await asyncio.sleep(3600)

        async def go():
            req = make_mocked_request("GET", "/api/matter/events")
            with patch.object(server.config, "PAIRING_KEY", ""), patch.object(server, "client_ip", return_value="192.0.2.5"), \
                    patch.object(server, "_tv_ips", return_value={"192.0.2.5"}), patch.object(server.web, "StreamResponse", Stuck), \
                    patch.object(server, "MATTER_WRITE_WAIT", 0.2):
                t = time.monotonic()
                resp = await asyncio.wait_for(server.h_matter_events(req), 5)
                self.assertLess(time.monotonic() - t, 2)
                self.assertEqual(resp.writes, 1)
                self.assertEqual(server.matter_clients, set())
        run(go())

    def test_nothing_blocks_the_event_loop(self):
        """Checker 21 Nov (B): node --version (start) and netstat or ip (a commission timeout) run in a thread."""
        import threading
        seen = {}

        def where(key, value):
            def f(*a, **k):
                seen[key] = threading.current_thread() is threading.main_thread()
                return value
            return f

        async def go():
            m = matter.Matter(tempfile.mkdtemp(), {}, spawn=True)
            with patch.object(m, "why_not", where("why_not", ("off", "Matter is switched off."))):
                await m.start()
            self.assertEqual((m.reason, seen["why_not"]), ("off", False))
            with patch.object(matter, "thread_route", where("thread_route", False)):
                r = await m._commission_error(matter.MatterError("timeout", None, "timed out"))
            self.assertEqual((r["error"], seen["thread_route"]), ("thread", False))
        run(go())

    def test_push_only_to_matter_listeners(self):
        """Fable 1: /api/events has no pairing rule, so Matter names and states never go there."""
        import server
        q, q2 = asyncio.Queue(), asyncio.Queue()
        server.events_clients.add((q, "any-tv"))
        server.matter_clients.add(q2)
        try:
            with patch.object(server.MATTER, "nodes", {"10": PLUG, "18": WEATHER}):
                server.push_matter()
            self.assertTrue(q.empty())
            msg = q2.get_nowait()
            self.assertTrue(msg.startswith("event: matter\ndata: "))
            d = json.loads(msg.split("data: ", 1)[1])
            self.assertEqual((d["devices"][0]["id"], d["devices"][0]["state"]), ("matter:10:1", "on"))
            self.assertIn("version", d)
            # a page that reads slowly keeps at most 20 lists, the newest last (it is never cut off)
            for _ in range(25):
                server.push_matter()
            self.assertIn(q2, server.matter_clients)
            self.assertEqual(q2.qsize(), 20)
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
