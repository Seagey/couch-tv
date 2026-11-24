"""`couch-tv Setup --helper`: runs the bridge, the tray (or the browser page) and nothing else."""
import json
import sys
import webbrowser

from .. import paths
from . import bridge_proc, control, fallback, tray
from . import config as hconfig


def run(data=None, no_tray=False):
    cfg = hconfig.load(data)
    if cfg["mode"] != "helper":
        print("Extra features are off. Open Couch TV Setup and choose Add extra features.")
        return 1
    try:
        known = json.loads((paths.data() / "known-tvs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}
    cfg_path = hconfig.write_bridge_config(known, cfg, data)
    sup = bridge_proc.Supervisor(bridge_proc.child_command(), bridge_proc.child_env(cfg_path, paths.data() / "helper-data", cfg["port"]))
    (paths.data() / "helper-data").mkdir(parents=True, exist_ok=True)
    sup.start()
    ctl = control.Controller(data, sup, known)
    ctl.start_background()
    url = fallback.serve(ctl)
    print("Couch TV Helper is running. Menu page: " + url)
    if not no_tray and tray.run(ctl, url):
        sup.stop()
        return 0
    if not no_tray:
        webbrowser.open(url)
    try:
        ctl.quit_event.wait()
    except KeyboardInterrupt:
        pass
    sup.stop()
    return 0
