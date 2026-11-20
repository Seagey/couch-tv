"""The Matter controller's keys (chip.platform.KeyValueStore, chip.platform.ConfigurationManager and
files/matter/) let whoever holds them control every Matter device added on the TV. Neither app may put
them in a cloud backup or copy them to another device (Android 12 device to device transfer ignores
allowBackup="false")."""
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parents[1]
A = "{http://schemas.android.com/apk/res/android}"
MATTER = {("sharedpref", "chip.platform.KeyValueStore.xml"), ("sharedpref", "chip.platform.ConfigurationManager.xml"),
          ("file", "matter/")}


def excludes(el):
    return {(e.get("domain"), e.get("path")) for e in el.findall("exclude")}


def application(manifest):
    return ET.parse(manifest).getroot().find("application")


class Launcher(unittest.TestCase):
    XML = ROOT / "tv-home/android/app/src/main/res/xml"

    def test_manifest_points_at_both_rule_files(self):
        app = application(ROOT / "tv-home/android/app/src/main/AndroidManifest.xml")
        self.assertEqual(app.get(A + "fullBackupContent"), "@xml/backup_rules")
        self.assertEqual(app.get(A + "dataExtractionRules"), "@xml/data_extraction_rules")

    def test_android_11_backup_leaves_out_matter_keys(self):
        root = ET.parse(self.XML / "backup_rules.xml").getroot()
        self.assertEqual(root.tag, "full-backup-content")
        self.assertLessEqual(MATTER, excludes(root))
        self.assertEqual(root.findall("include"), [])   # an include list would replace "everything but"

    def test_android_12_cloud_backup_and_device_transfer_leave_out_matter_keys(self):
        root = ET.parse(self.XML / "data_extraction_rules.xml").getroot()
        for section in ("cloud-backup", "device-transfer"):
            el = root.find(section)
            self.assertIsNotNone(el, section)
            self.assertLessEqual(MATTER, excludes(el), section)
            self.assertEqual(el.findall("include"), [], section)
            # the Home Assistant token and the things typed at home stay out too
            self.assertLessEqual({("sharedpref", "ha.xml"), ("sharedpref", "athome.xml")}, excludes(el), section)


class OnTvApp(unittest.TestCase):
    def test_no_backup_and_no_device_transfer(self):
        app = application(ROOT / "on-tv/android/app/src/main/AndroidManifest.xml")
        self.assertEqual(app.get(A + "allowBackup"), "false")
        self.assertEqual(app.get(A + "dataExtractionRules"), "@xml/data_extraction_rules")
        root = ET.parse(ROOT / "on-tv/android/app/src/main/res/xml/data_extraction_rules.xml").getroot()
        for section in ("cloud-backup", "device-transfer"):
            el = root.find(section)
            self.assertIsNotNone(el, section)
            self.assertLessEqual({("root", "."), ("file", "."), ("sharedpref", "."), ("database", ".")}, excludes(el), section)
            self.assertEqual(el.findall("include"), [], section)


if __name__ == "__main__":
    unittest.main()
