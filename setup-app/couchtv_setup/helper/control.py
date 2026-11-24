"""What the menu's items do. One place, so the tray on each system and the browser page act the same."""
import subprocess
import sys
import threading
import webbrowser

from .. import linkin, paths
from . import autostart, bridge_proc, menu, status
from . import config as hconfig


def setup_command(frozen=None, exe=None):
    """Opens Couch TV Setup (its page): the same program without flags."""
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    exe = exe or sys.executable
    return [exe] if frozen else [exe, "-m", "couchtv_setup"]


class Controller:
    def __init__(self, data=None, sup=None, known=None, autostart_mod=autostart, opener=webbrowser.open,
                 spawn=subprocess.Popen, knock=status.knock):
        self.data = data
        self.cfg = hconfig.load(data)
        self.known = known if known is not None else self._known()
        self.sup = sup
        self.autostart = autostart_mod
        self.opener, self.spawn, self.knock = opener, spawn, knock
        self.quit_event = threading.Event()
        self.on_quit = None

    def _known(self):
        import json
        try:
            return json.loads((paths.data() / "known-tvs.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def state(self):
        return status.snapshot(self.cfg, self.known, self.sup, self.autostart.is_enabled(), self.knock)

    def items(self):
        return menu.build(self.state())

    def act(self, item_id):
        """Runs one menu item. "off" is the confirmed turn off: the caller asks first."""
        fn = {"studio": self.open_studio, "setup": self.open_setup, "autostart": self.toggle_autostart,
              "pause": self.toggle_pause, "off": self.turn_off, "quit": self.quit}.get(item_id)
        if fn:
            fn()
        return fn is not None

    def open_studio(self):
        self.opener(menu.STUDIO_URL)

    def open_setup(self):
        self.spawn(setup_command())

    def toggle_autostart(self):
        on = not self.autostart.is_enabled()
        if on:
            self.autostart.enable()
        else:
            self.autostart.disable()
        self.cfg["autostart"] = on
        hconfig.save(self.cfg, self.data)

    def toggle_pause(self):
        if self.sup.paused:
            self.sup.resume()
        else:
            self.sup.pause()

    def turn_off(self):
        """Stops the bridge, removes the login item, sets the mode back to "once". The TV is not touched."""
        if self.sup:
            self.sup.stop()
        self.autostart.disable()
        self.cfg = hconfig.turn_off(self.data)
        self.quit()

    def quit(self):
        if self.sup:
            self.sup.stop()
        self.quit_event.set()
        if self.on_quit:
            self.on_quit()
        linkin.clear_running()
