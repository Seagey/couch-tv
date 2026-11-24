"""What the menu's items do. One place, so the tray on each system and the browser page act the same."""
import subprocess
import sys
import threading
import webbrowser

from .. import __version__, linkin, paths
from . import autostart, bridge_proc, keepawake, menu, remove, status, update
from . import config as hconfig


def setup_command(frozen=None, exe=None):
    """Opens Couch TV Setup (its page): the same program without flags."""
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    exe = exe or sys.executable
    return [exe] if frozen else [exe, "-m", "couchtv_setup"]


class Controller:
    def __init__(self, data=None, sup=None, known=None, autostart_mod=autostart, opener=webbrowser.open,
                 spawn=subprocess.Popen, knock=status.knock, awake=None, updater=update):
        self.data = data
        self.cfg = hconfig.load(data)
        self.known = known if known is not None else self._known()
        self.sup = sup
        self.autostart = autostart_mod
        self.opener, self.spawn, self.knock = opener, spawn, knock
        self.awake = awake or keepawake.KeepAwake()
        self.updater = updater
        self.update_state = {"state": "up_to_date", "version": __version__}
        self.quit_event = threading.Event()
        self.on_quit = None

    def _known(self):
        import json
        try:
            return json.loads((paths.data() / "known-tvs.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def state(self):
        st = status.snapshot(self.cfg, self.known, self.sup, self.autostart.is_enabled(), self.knock)
        st["update"] = dict(self.update_state)
        st["awake"] = {"needed": any(t["kind"] in hconfig.KINDS for t in self.cfg["tvs"]), "allow_sleep": self.cfg["allow_sleep"]}
        return st

    def items(self):
        return menu.build(self.state())

    def act(self, item_id):
        """Runs one menu item. "off" is the confirmed turn off: the caller asks first."""
        fn = {"studio": self.open_studio, "setup": self.open_setup, "autostart": self.toggle_autostart,
              "pause": self.toggle_pause, "off": self.turn_off, "quit": self.quit,
              "sleep": self.toggle_sleep, "update": self.apply_update, "remove": self.remove_everything}.get(item_id)
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

    def toggle_sleep(self):
        self.cfg["allow_sleep"] = not self.cfg["allow_sleep"]
        hconfig.save(self.cfg, self.data)
        self.awake.update(self.cfg)

    def tick(self):
        """Every half minute: hold or release the keep awake assertion (on power, with a Samsung, LG or Roku TV)."""
        self.awake.update(self.cfg)

    def check_updates(self):
        """Looks for a newer release, downloads and checks it (signature, then checksum). Never raises."""
        if not self.cfg.get("updates", True):
            return
        r = self.updater.check()
        if r["state"] == "error":
            self.update_state = {"state": "error", "version": __version__}
        elif r["state"] == "up_to_date":
            self.update_state = {"state": "up_to_date", "version": __version__}
        else:
            tag = r["tag"].lstrip("v")
            self.update_state = {"state": "downloading", "version": tag}
            try:
                self.updater.stage(r["release"])
                self.update_state = {"state": "ready", "version": tag}
            except Exception:
                self.update_state = {"state": "error", "version": __version__}

    def start_background(self, every_s=86400, tick_s=30):
        def loop(fn, wait):
            while not self.quit_event.is_set():
                try:
                    fn()
                except Exception:
                    pass
                self.quit_event.wait(wait)
        threading.Thread(target=loop, args=(self.check_updates, every_s), daemon=True).start()
        threading.Thread(target=loop, args=(self.tick, tick_s), daemon=True).start()

    def apply_update(self):
        if self.update_state.get("state") == "ready" and self.updater.apply():
            self.quit()

    def remove_everything(self):
        """Stops the helper, then deletes what Setup keeps on this computer. The TV is not touched."""
        self.awake.release()
        remove.everything(stop=(self.sup.stop if self.sup else None))
        self.cfg = hconfig.default()
        self.quit()

    def turn_off(self):
        """Stops the bridge, removes the login item, sets the mode back to "once". The TV is not touched."""
        if self.sup:
            self.sup.stop()
        self.awake.release()
        self.autostart.disable()
        self.cfg = hconfig.turn_off(self.data)
        self.quit()

    def quit(self):
        self.awake.release()
        if self.sup:
            self.sup.stop()
        self.quit_event.set()
        if self.on_quit:
            self.on_quit()
        linkin.clear_running()
