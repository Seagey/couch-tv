"""Runs the bridge (bridge/server.py) as a child process and brings it back if it stops, with a wait
that grows (2 s, 4 s, ... up to a minute) so a bridge that cannot start does not spin.

From the built app the child is the same program started with --bridge, which runs bridge/server.py
inside the app's own Python. From source it is `python -m couchtv_setup --bridge`.
"""
import os
import runpy
import subprocess
import sys
import threading
import time
from pathlib import Path


def bridge_dir():
    """bridge/ next to the app: bundled into the build, or the repo's own folder from source."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "bridge"
    return Path(__file__).resolve().parents[3] / "bridge"


def child_command(frozen=None, exe=None):
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    exe = exe or sys.executable
    return [exe, "--bridge"] if frozen else [exe, "-m", "couchtv_setup", "--bridge"]


def child_env(config_path, data_dir, port, base=None):
    env = dict(base if base is not None else os.environ)
    env.update({"COUCH_CONFIG": str(config_path), "COUCH_DATA": str(data_dir), "PORT": str(port),
                "COUCHTV_NO_BONJOUR": env.get("COUCHTV_NO_BONJOUR", "1")})
    return env


def run_bridge():
    """The child's own entry: runs bridge/server.py as __main__ (it imports its sibling modules)."""
    d = str(bridge_dir())
    sys.path.insert(0, d)
    runpy.run_path(os.path.join(d, "server.py"), run_name="__main__")


def backoff(failures):
    return min(60, 2 ** max(1, failures))


class Supervisor:
    def __init__(self, command, env, popen=subprocess.Popen, sleep=time.sleep, clock=time.time):
        self.command, self.env = command, env
        self.popen, self.sleep, self.clock = popen, sleep, clock
        self.proc = None
        self.failures = 0
        self.started = None
        self.paused = False
        self._stop = threading.Event()
        self._thread = None

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def start_once(self):
        """Starts the child now. A child that ran a minute counts as a good start (failures reset)."""
        if self.alive():
            return
        if self.started is not None and self.clock() - self.started > 60:
            self.failures = 0
        else:
            self.failures += 1 if self.started is not None else 0
        self.proc = self.popen(self.command, env=self.env, stdin=subprocess.DEVNULL)
        self.started = self.clock()

    def _loop(self):
        while not self._stop.is_set():
            if not self.paused and not self.alive():
                self.start_once()
                wait = backoff(self.failures)
            else:
                wait = 2
            self._stop.wait(wait)

    def start(self):
        self.paused = False
        self._stop.clear()
        if not self._thread or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def pause(self):
        self.paused = True
        self._kill()

    def resume(self):
        self.paused = False
        self.failures = 0

    def _kill(self):
        if self.alive():
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except Exception:
                self.proc.kill()

    def stop(self):
        self._stop.set()
        self._kill()
