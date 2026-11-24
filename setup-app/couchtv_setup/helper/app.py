"""`couch-tv Setup --helper`: runs the bridge, the tray (or the browser page) and nothing else."""
import json
import os
import sys
import webbrowser

from .. import paths
from . import bridge_proc, control, fallback, tray
from . import config as hconfig


def run(data=None, no_tray=False):
    # the build's smoke test (tests/smoke_helper.py) has no desktop to show a tray on: it asks for the page only
    no_tray = no_tray or os.environ.get("COUCHTV_HELPER_NO_TRAY") == "1"
    cfg = hconfig.load(data)
    if cfg["mode"] != "helper":
        print("Extra features are off. Open Couch TV Setup and choose Add extra features.")
        return 1
    try:
        known = json.loads((paths.data() / "known-tvs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}
    # An update that renamed the program leaves the start with the computer entry and (on Windows) the couchtv://
    # link pointing at the old name: point them at this program. Never stops the helper.
    try:
        from . import autostart
        from .. import linkin
        autostart.refresh()
        linkin.register_windows()
    except Exception:
        pass
    cfg_path = hconfig.write_bridge_config(known, cfg, data)
    sup = bridge_proc.Supervisor(bridge_proc.child_command(), bridge_proc.child_env(cfg_path, paths.data() / "helper-data", cfg["port"]))
    (paths.data() / "helper-data").mkdir(parents=True, exist_ok=True)
    sup.start()
    ctl = control.Controller(data, sup, known)
    ctl.start_background()
    url = fallback.serve(ctl)
    print("Couch TV Helper is running. Menu page: " + url)
    if os.environ.get("COUCHTV_HELPER_NO_TRAY") == "1":   # the built program has no console on Windows: say it in a file
        (paths.data() / "helper-menu-url.txt").write_text(url, encoding="utf-8")
    if not no_tray and tray.run(ctl, url):
        sup.stop()
        return 0
    if not no_tray and not os.environ.get("COUCHTV_SETUP_NO_BROWSER"):
        webbrowser.open(url)
    try:
        ctl.quit_event.wait()
    except KeyboardInterrupt:
        pass
    sup.stop()
    return 0
