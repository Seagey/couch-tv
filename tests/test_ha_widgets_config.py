"""The smart home widgets' part of the home_assistant section (tv-home/tools/home-config.py --ha):
Control Centre switches, cameras, sensors, energy and speakers go to the TV checked, nothing that
opens the house is ever passed on, and apply.sh's one line says what is set up without the token."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "tv-home", "tools", "home-config.py")
TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789"


def run(section, *args):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "config.json")
        with open(os.path.join(HERE, "..", "config.example.json")) as f:
            cfg = json.load(f)
        cfg["home_assistant"] = section
        with open(path, "w") as f:
            json.dump(cfg, f)
        env = dict(os.environ, COUCH_CONFIG=path, HOME_ASSISTANT_TOKEN=TOKEN)
        r = subprocess.run([sys.executable, TOOL, "--ha", *args], capture_output=True, text=True, env=env, timeout=60)
        return r.stdout.strip(), r.stderr


BASE = {"url": "http://ha.example:8123"}


class HaWidgetsConfig(unittest.TestCase):
    def section(self, **kw):
        out, err = run(dict(BASE, **kw))
        return (json.loads(base64.b64decode(out)) if out != "none" else None), err

    def test_widgets_alone_switch_smart_home_on(self):
        ha, _ = self.section(sensors=[{"entity": "sensor.pool", "name": "Pool"}])
        self.assertEqual(ha["sensors"], [{"entity": "sensor.pool", "name": "Pool"}])
        self.assertEqual(ha["token"], TOKEN)   # handed to the app only, never printed by --check

    def test_controls_keep_lights_switches_fans_and_blinds_only(self):
        ha, err = self.section(controls=["light.lounge", "switch.heater", "fan.bed", "cover.blinds", "lock.front_door",
                                         "alarm_control_panel.home", "cover.garage_door", "switch.front_gate", "light.front_door_light"])
        self.assertEqual([c["entity"] for c in ha["controls"]],
                         ["light.lounge", "switch.heater", "fan.bed", "cover.blinds", "light.front_door_light"])
        self.assertIn("nothing that opens the house", err)

    def test_limits_and_bad_ids(self):
        ha, _ = self.section(cameras=[f"camera.c{i}" for i in range(6)] + ["sensor.x"],
                             speakers=["media_player.kitchen", "speaker.kitchen"])
        self.assertEqual(len(ha["cameras"]), 4)
        self.assertEqual(ha["speakers"], [{"entity": "media_player.kitchen", "name": ""}])

    def test_energy(self):
        ha, _ = self.section(energy={"entity": "sensor.solar_today", "name": "Solar", "battery": "sensor.battery"})
        self.assertEqual(ha["energy"], {"entity": "sensor.solar_today", "name": "Solar", "battery": "sensor.battery"})
        ha, err = self.section(energy={"entity": "switch.solar"})
        self.assertIsNone(ha)
        self.assertIn("skipping energy", err)

    def test_check_line_counts_and_hides_the_token(self):
        out, _ = run(dict(BASE, climate=["climate.living"], controls=["light.a", "light.b"], cameras=["camera.yard"],
                          energy={"entity": "sensor.solar"}, doorbell={"entity": "event.ring"}), "--check")
        self.assertEqual(out.splitlines()[0], "smart home: 1 climate, 0 scenes, 2 controls, 1 cameras, energy, doorbell")
        self.assertEqual(out.splitlines()[1], "doorbell")
        self.assertNotIn(TOKEN, out)

    def test_old_sections_print_the_same_line(self):
        out, _ = run(dict(BASE, climate=["climate.a"], scenes=["scene.b"]), "--check")
        self.assertEqual(out, "smart home: 1 climate, 1 scenes")


if __name__ == "__main__":
    unittest.main()
