"""The design block in config.json is untrusted: the bridge hands it to the TV home without anything
that looks like a link or markup, and only when there is one (bridge/config.py, _design)."""
import json
import os
import sys
import tempfile
import unittest
import importlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))

TVS = [{"id": "lr", "name": "Living room", "address": "192.0.2.2"}]


def public_for(cfg):
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(cfg, f)
    f.close()
    os.environ["COUCH_CONFIG"] = f.name
    import config
    importlib.reload(config)
    try:
        return config.public()
    finally:
        os.unlink(f.name)


class DesignBlock(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("COUCH_CONFIG", None)

    def test_no_design_no_key(self):
        self.assertNotIn("design", public_for({"tvs": TVS}))

    def test_good_design_passes(self):
        d = {"v": 1, "elements": {"clock": {"y": 30}}, "background": {"image": "backgrounds/mine/sea.jpg"},
             "objects": [{"id": "t1", "type": "text", "text": "Welcome. Make yourself at home."}]}
        self.assertEqual(public_for({"tvs": TVS, "design": d})["design"], d)

    def test_links_and_markup_are_left_out(self):
        d = {"v": 1,
             "background": {"image": "http://198.51.100.7/beacon.jpg", "darken": 0.2},
             "home": {"video_url": "https://example.com/v.mp4"},
             "objects": [{"id": "t1", "type": "text", "text": "<script>alert(1)</script>"},
                         {"id": "t2", "type": "text", "text": "<img src=x onerror=alert(1)>"},
                         {"id": "t3", "type": "text", "text": "javascript:alert(1)"},
                         {"id": "t4", "type": "text", "text": "Movie night"}],
             "elements": {"clock": {"colour": "url(http://x/y)"}}}
        out = public_for({"tvs": TVS, "design": d})["design"]
        self.assertNotIn("image", out["background"])
        self.assertNotIn("video_url", out["home"])
        self.assertEqual([o.get("text") for o in out["objects"]], [None, None, None, "Movie night"])
        self.assertNotIn("colour", out["elements"]["clock"])
        self.assertNotIn("http", json.dumps(out))

    def test_a_photo_inside_the_design_is_kept(self):
        pic = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ//"
        out = public_for({"tvs": TVS, "design": {"background": {"image": pic}}})["design"]
        self.assertEqual(out["background"]["image"], pic)

    def test_huge_numbers_and_odd_keys(self):
        out = public_for({"tvs": TVS, "design": {"elements": {"clock": {"x": 1e300}}, "bad key<": 1}})["design"]
        self.assertNotIn("x", out["elements"]["clock"])
        self.assertNotIn("bad key<", out)

    def test_not_an_object_is_nothing(self):
        self.assertNotIn("design", public_for({"tvs": TVS, "design": "<script>"}))
        self.assertNotIn("design", public_for({"tvs": TVS, "design": []}))

    def test_design_store_https_only(self):
        self.assertNotIn("design_store", public_for({"tvs": TVS}))
        self.assertEqual(public_for({"tvs": TVS, "design_store": "https://Designs.example/"})["design_store"], "https://designs.example")
        self.assertEqual(public_for({"tvs": TVS, "design_store": "http://127.0.0.1:5490"})["design_store"], "http://127.0.0.1:5490")
        # "" turns getting a design by code off: the TV (web, Roku, Apple TV) is told so, not left to its default
        self.assertEqual(public_for({"tvs": TVS, "design_store": ""})["design_store"], "")
        for bad in ["http://designs.example", "https://designs.example/x", "javascript:alert(1)", "//evil", "https://a@example.com", 5]:
            self.assertNotIn("design_store", public_for({"tvs": TVS, "design_store": bad}), bad)


if __name__ == "__main__":
    unittest.main()
