"""Keep the computer awake while the helper is on, power is plugged in, and a Samsung, LG or Roku TV is set up
(those TVs only open Couch TV while this computer is awake). Never on battery. Never for Google TV only homes.
"Let this computer sleep" (allow_sleep in helper.json) switches it off. Lid close still sleeps a laptop.

- Mac: `caffeinate -i -s` (-s keeps it awake only on power; the assertion is released with the process)
- Windows: SetThreadExecutionState from a thread of its own
- Linux: `systemd-inhibit --what=idle:sleep ... sleep infinity`
"""
import ctypes
import glob
import subprocess
import sys
import threading

from . import config as hconfig

ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001


def wanted(cfg, on_power):
    """Should we hold the assertion right now?"""
    return (cfg.get("mode") == "helper" and not cfg.get("allow_sleep") and on_power is True
            and any(t.get("kind") in hconfig.KINDS for t in cfg.get("tvs") or []))


def on_power(system=None, run=subprocess.run, glob_=glob.glob, read=lambda p: open(p).read(), winstatus=None):
    """True on mains power, False on battery, None when it cannot tell (treated as battery)."""
    system = system or sys.platform
    try:
        if system == "darwin":
            return "AC Power" in run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=5).stdout
        if system == "win32":
            return (winstatus() if winstatus else _win_ac()) == 1
        mains = [p for p in glob_("/sys/class/power_supply/*/type") if read(p).strip() == "Mains"]
        if not mains:
            return True   # a desktop has no battery
        return any(read(p.replace("type", "online")).strip() == "1" for p in mains)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _win_ac():
    class S(ctypes.Structure):
        _fields_ = [("ACLineStatus", ctypes.c_ubyte), ("BatteryFlag", ctypes.c_ubyte), ("BatteryLifePercent", ctypes.c_ubyte),
                    ("SystemStatusFlag", ctypes.c_ubyte), ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]
    s = S()
    ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s))
    return s.ACLineStatus


def command(system=None):
    system = system or sys.platform
    if system == "darwin":
        return ["caffeinate", "-i", "-s"]
    if system == "win32":
        return None
    return ["systemd-inhibit", "--what=idle:sleep", "--who=Couch TV Helper", "--why=A TV needs this computer awake", "sleep", "infinity"]


class KeepAwake:
    def __init__(self, popen=subprocess.Popen, system=None):
        self.popen, self.system = popen, system or sys.platform
        self.proc = None
        self.holding = False
        self._win = None

    def set(self, hold):
        """Takes or releases the assertion. Returns whether it is held now."""
        if hold and not self.holding:
            cmd = command(self.system)
            try:
                if cmd:
                    self.proc = self.popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
                self.holding = True
            except (OSError, AttributeError):
                self.holding = False
        elif not hold and self.holding:
            self.release()
        return self.holding

    def release(self):
        if self.proc is not None:
            self.proc.terminate()
            self.proc = None
        elif self.system == "win32":
            try:
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
            except (OSError, AttributeError):
                pass
        self.holding = False

    def update(self, cfg, power=None):
        return self.set(wanted(cfg, on_power(self.system) if power is None else power))
