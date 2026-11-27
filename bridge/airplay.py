"""AirPlay 2 speaker groups for the Speakers widget (lane C, 28 Nov 2026).

Ported from home-hub's Whole House (~/home-hub/hub/hubserver/airplay.py, built 21 Nov 2026). AirPlay 2 needs no
Google speaker group: a Mac's own Music app plays to any set of AirPlay 2 speakers in sync. So the bridge on a Mac:

    Spotify app  ->  librespot ("Whole House", a Spotify Connect speaker on this Mac, optional)
      ->  raw audio  ->  this module, at real time speed (silence while paused)
      ->  ffmpeg (MP3)  ->  http://127.0.0.1:<port>/whole-house.mp3 (loopback only)
      ->  Music.app (AppleScript)  ->  the chosen AirPlay 2 speakers, in sync, each with its own volume

The TV reads and drives it through the bridge: GET /api/airplay, POST /api/airplay/play, /stop, /volume.
What a TV may name is only a speaker Music itself lists, or a group from config.json (airplay.groups), never anything
else, and the speakers are only taken when someone asks (from a TV or by picking Whole House in Spotify).

Only on a Mac (Music.app and osascript). Elsewhere it says so and does nothing. librespot and ffmpeg are optional: without
them the TV still sees the speakers and their volume, and "Play here" sends whatever Music is playing to the group.

Never test this against real speakers: tests inject run_osascript (tests/test_airplay.py), and FAKE_AIRPLAY=1 in the
environment makes the bridge use a pretend Music with three pretend speakers (FakeMusic below).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import sys
import time

log = logging.getLogger("bridge.airplay")

RATE = 44100 * 2 * 2          # bytes per second of 16 bit stereo at 44.1 kHz
TICK = 0.02                   # seconds between two feeds to the encoder
AHEAD = RATE // 2             # read at most half a second ahead of real time
IDLE_RELEASE = 15 * 60        # let the speakers go after this long with no music
STREAM_PATH = "/whole-house.mp3"
MAX_SPEAKERS = 12
MAX_GROUPS = 6
READ_EVERY = 10               # seconds a read of Music's speaker list stays fresh
NAME = re.compile(r"^[^\x00-\x1f\x7f\"\\]{1,60}$")


def _q(s):
    """A string as an AppleScript literal."""
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def clean_name(n):
    n = " ".join(str(n or "").split())[:60]
    return n if NAME.match(n) else ""


def clean_groups(raw):
    """config.json airplay.groups: [{name, speakers: [AirPlay names]}], at most 6 groups of 12."""
    out = []
    for g in raw if isinstance(raw, list) else []:
        if not isinstance(g, dict):
            continue
        name = clean_name(g.get("name"))
        sp = []
        for s in g.get("speakers") or []:
            s = clean_name(s)
            if s and s.lower() not in [x.lower() for x in sp]:
                sp.append(s)
        if name and sp:
            out.append({"name": name, "speakers": sp[:MAX_SPEAKERS]})
    return out[:MAX_GROUPS]


class FakeMusic:
    """A pretend Music.app for tests and FAKE_AIRPLAY=1: three speakers, nothing leaves the computer."""

    def __init__(self):
        self.devices = {"Lounge": {"kind": "AirPlay device", "available": True, "volume": 40},
                        "Kitchen": {"kind": "AirPlay device", "available": True, "volume": 30},
                        "Deck": {"kind": "AirPlay device", "available": False, "volume": 55},
                        "This Mac": {"kind": "computer", "available": True, "volume": 100}}
        self.current = ["This Mac"]
        self.playing_url = ""
        self.scripts = []

    async def __call__(self, script, timeout=12):
        self.scripts.append(script)
        if "repeat with d in AirPlay devices" in script and "set r to" in script:
            return "\n".join("%s\t%s\t%s\t%s\t%s" % (n, d["kind"], "true" if d["available"] else "false",
                                                   "true" if n in self.current else "false", d["volume"])
                             for n, d in self.devices.items())
        m = re.search(r"set wanted to \{(.*)\}", script)
        if m:
            wanted = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
            got = [n for n in wanted if n in self.devices and self.devices[n]["available"]]
            if not got:
                raise RuntimeError("none of the speakers answered")
            self.current = got
            u = re.search(r'open location "([^"]+)"', script)
            if u:
                self.playing_url = u.group(1)
            elif "\nplay\n" in script:
                self.playing_url = self.playing_url or "music"
            return ""
        m = re.search(r'set sound volume of \(first AirPlay device whose name is "((?:[^"\\]|\\.)*)"\) to (\d+)', script)
        if m and m.group(1) in self.devices:
            self.devices[m.group(1)]["volume"] = int(m.group(2))
            return ""
        if "then stop" in script or script.strip().endswith("stop\nend tell"):
            self.playing_url = ""
            self.current = ["This Mac"]
            return ""
        return ""


class AirPlay:
    def __init__(self, data_dir, cfg=None, run_osascript=None, platform=None, which=shutil.which, on_change=lambda: None):
        ap = cfg if isinstance(cfg, dict) else {}
        self.on_change = on_change
        self.platform = platform or sys.platform
        fake = os.environ.get("FAKE_AIRPLAY") == "1"
        self.fake = FakeMusic() if fake and run_osascript is None else None
        self._osascript = run_osascript or self.fake or self._run_osascript
        self.mac = self.platform == "darwin" or run_osascript is not None or fake
        # off unless config.json has an "airplay" section (or FAKE_AIRPLAY=1): nothing asks Music anything otherwise
        self.enabled = (bool(ap) or fake or run_osascript is not None) and bool(ap.get("enabled", True)) and self.mac
        self.name = clean_name(ap.get("name")) or "Whole House"
        self.port = int(ap.get("stream_port") or 8791)
        lib = ap.get("librespot") or which("librespot") or "/opt/homebrew/bin/librespot"
        ffm = ap.get("ffmpeg") or which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
        # the Spotify Connect speaker only when both tools are on this Mac and it was not turned off
        self.librespot = lib if os.path.exists(str(lib)) else None
        self.ffmpeg = ffm if os.path.exists(str(ffm)) else None
        self.connect = self.enabled and bool(ap.get("spotify", True)) and bool(self.librespot and self.ffmpeg) and not fake and run_osascript is None
        self.groups = clean_groups(ap.get("groups"))
        self._state_file = os.path.join(data_dir, "airplay.json")
        saved = self._load()
        self.selected = [clean_name(s) for s in saved.get("selected", []) if clean_name(s)][:MAX_SPEAKERS]
        self.seen = {}                 # name -> {available, selected, volume, kind}
        self.read_at = 0.0
        self.error = ""
        self.active = False
        self.last_audio = 0.0
        self.active_since = 0.0
        self._activating = False
        self._buf = bytearray()
        self._clients = set()
        self._lib = None
        self._enc = None
        self._tasks = []
        self._enc_tasks = []
        self._runner = None
        self._lock = asyncio.Lock()
        self._stopping = False

    # ---------- small helpers ----------
    def _load(self):
        try:
            with open(self._state_file) as f:
                v = json.load(f)
                return v if isinstance(v, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self):
        try:
            tmp = self._state_file + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"selected": self.selected}, f)
            os.replace(tmp, self._state_file)
        except OSError:
            log.warning("airplay: could not save the speaker choice")

    async def _run_osascript(self, script, timeout=12):
        proc = await asyncio.create_subprocess_exec("osascript", "-e", script, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise TimeoutError("Music did not answer")
        if proc.returncode != 0:
            raise RuntimeError((err or b"").decode(errors="replace").strip()[:300])
        return (out or b"").decode(errors="replace").strip()

    def known(self, name):
        """The speaker's name as Music writes it, or "" when Music does not list it (or it is this Mac itself)."""
        n = clean_name(name).lower()
        for k, v in self.seen.items():
            if k.lower() == n and v.get("kind") != "computer":
                return k
        return ""

    def speakers(self):
        return [{"name": k, "available": v["available"], "selected": v["selected"], "volume": v["volume"]}
                for k, v in self.seen.items() if v.get("kind") != "computer"][:MAX_SPEAKERS]

    def state(self):
        """What a TV gets: names, on or off, volumes. Never an address."""
        if not self.enabled:
            return {"available": False, "reason": "mac" if not self.mac else "off"}
        return {"available": True, "name": self.name, "active": self.active, "spotify": self.connect,
                "selected": list(self.selected), "speakers": self.speakers(), "groups": self.groups,
                "playing": self.active and (time.monotonic() - self.last_audio < 10 if self.connect else True),
                **({"error": self.error} if self.error else {})}

    # ---------- Music.app: which speakers, how loud ----------
    async def read_devices(self, force=False):
        """Ask Music which AirPlay speakers it sees, which are in use and their volumes. Only reads."""
        if not self.enabled:
            return {}
        if not force and time.monotonic() - self.read_at < READ_EVERY and self.seen:
            return self.seen
        out = await self._osascript(
            'tell application "Music"\nset r to ""\nrepeat with d in AirPlay devices\n'
            'set r to r & (name of d) & tab & (kind of d as string) & tab & (available of d) & tab & (selected of d) & tab & (sound volume of d) & linefeed\n'
            'end repeat\nreturn r\nend tell')
        seen = {}
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) != 5:
                continue
            name = clean_name(parts[0])
            if not name:
                continue
            vol = parts[4].strip()
            seen[name] = {"kind": "computer" if parts[1].strip().lower() == "computer" else "airplay",
                          "available": parts[2].strip() == "true", "selected": parts[3].strip() == "true",
                          "volume": int(vol) if vol.isdigit() else None}
        self.seen = seen
        self.read_at = time.monotonic()
        self.error = ""
        return seen

    def _names_list(self, names):
        return "{" + ", ".join(_q(n) for n in names) + "}"

    def resolve(self, speakers=None, group=None):
        """The AirPlay names a request may use: a config group's, or speakers Music lists; never anything else."""
        if group:
            g = [x for x in self.groups if x["name"].lower() == clean_name(group).lower()]
            if not g:
                raise ValueError("group")
            names = g[0]["speakers"]
        else:
            names = speakers if isinstance(speakers, list) else self.selected
        out = []
        for n in names[:MAX_SPEAKERS]:
            k = self.known(n)
            if k and k not in out:
                out.append(k)
        if not out:
            raise ValueError("speakers")
        return out

    async def activate(self, speakers=None, group=None):
        """Play on these speakers together: the Whole House stream when librespot is here, else what Music plays."""
        if not self.enabled:
            raise RuntimeError("off")
        await self.read_devices(force=True)
        names = self.resolve(speakers, group)
        async with self._lock:
            self.selected = names
            self._save()
            url = "http://127.0.0.1:%d%s" % (self.port, STREAM_PATH)
            if self.connect:
                await self._start_encoder()
            tail = (('set mine to false\ntry\n'
                     'if player state is playing and (current stream URL as string) is %s then set mine to true\n'
                     'end try\nif not mine then open location %s\n') % (_q(url), _q(url))) if self.connect else "play\n"
            await self._osascript(
                'tell application "Music"\n'
                'set wanted to %s\n'
                'set devs to {}\n'
                'repeat with d in AirPlay devices\n'
                'if wanted contains (name of d as string) then set end of devs to d\n'
                'end repeat\n'
                'if devs is {} then error "none of the speakers answered"\n'
                'set current AirPlay devices to devs\n'
                'set sound volume to 100\n' % self._names_list(names) + tail + 'end tell', timeout=20)
            if not self.active:
                log.info("airplay: playing on %s", ", ".join(names))
                self.active_since = time.monotonic()
            self.active = True
        try:
            await self.read_devices(force=True)
        except Exception:
            pass
        self.on_change()

    async def release(self):
        """Stop Music playing our stream (or, without librespot, stop Music) so the speakers are free again."""
        async with self._lock:
            if not self.active:
                return
            url = "http://127.0.0.1:%d%s" % (self.port, STREAM_PATH)
            try:
                if self.connect:
                    await self._osascript('tell application "Music"\ntry\nif (current stream URL as string) is %s then stop\nend try\nend tell' % _q(url))
                else:
                    await self._osascript('tell application "Music"\nstop\nend tell')
            except Exception as e:
                log.warning("airplay: could not stop Music: %s", e)
            await self._stop_encoder()
            self.active = False
            log.info("airplay: speakers let go")
        self.on_change()

    async def set_volume(self, name, value):
        k = self.known(name)
        if not k:
            await self.read_devices(force=True)
            k = self.known(name)
        if not k:
            raise ValueError("speakers")
        v = max(0, min(100, int(value)))
        await self._osascript('tell application "Music"\nset sound volume of (first AirPlay device whose name is %s) to %d\nend tell' % (_q(k), v))
        self.seen[k]["volume"] = v
        self.on_change()

    # ---------- life ----------
    async def start(self):
        if not self.enabled:
            log.info("airplay: off (%s)", "not a Mac" if not self.mac else "turned off in config.json")
            return
        if self.connect:
            from aiohttp import web
            app = web.Application()
            app.router.add_get(STREAM_PATH, self._serve)
            self._runner = web.AppRunner(app, access_log=None)
            await self._runner.setup()
            await web.TCPSite(self._runner, "127.0.0.1", self.port).start()
            self._tasks.append(asyncio.create_task(self._librespot_loop(), name="airplay-librespot"))
        self._tasks += [asyncio.create_task(self._watch(), name="airplay-watch"),
                        asyncio.create_task(self._first_read(), name="airplay-first-read")]
        log.info("airplay: ready%s", (", %s on 127.0.0.1:%s" % (self.name, self.port)) if self.connect else " (speakers and volume only)")

    async def _first_read(self):
        """Only reads the speaker list. The first time, macOS asks once on the Mac's screen whether the bridge may
        control Music: asking now, while nothing depends on it, means the answer is there when needed."""
        try:
            real = self._osascript
            if real == self._run_osascript:
                self._osascript = lambda script, timeout=12: real(script, timeout=150)
            try:
                seen = await self.read_devices(force=True)
            finally:
                self._osascript = real
            log.info("airplay: Music sees %d speakers", len([v for v in seen.values() if v["kind"] != "computer"]))
        except Exception as e:
            self.error = "music"
            log.warning("airplay: Music did not answer (allow the bridge to control Music on the Mac): %s", e)

    async def stop(self):
        self._stopping = True
        for t in self._tasks + self._enc_tasks:
            t.cancel()
        for proc in (self._lib, self._enc):
            if proc and proc.returncode is None:
                proc.kill()
        if self._runner:
            await self._runner.cleanup()

    # ---------- librespot: the Spotify Connect speaker ----------
    async def _librespot_loop(self):
        cache = os.path.join(os.path.dirname(self._state_file), "librespot")
        os.makedirs(cache, mode=0o700, exist_ok=True)
        wait = 2
        while not self._stopping:
            started = time.monotonic()
            try:
                self._lib = await asyncio.create_subprocess_exec(
                    self.librespot, "--name", self.name, "--backend", "pipe", "--format", "S16",
                    "--bitrate", "320", "--initial-volume", "100", "--device-type", "speaker", "--group",
                    "--cache", cache, "--disable-audio-cache", "--quiet",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                await self._read_librespot(self._lib.stdout)
                await self._lib.wait()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("airplay: librespot failed")
            if self._stopping:
                return
            wait = 2 if time.monotonic() - started > 60 else min(wait * 2, 60)
            await asyncio.sleep(wait)

    async def _read_librespot(self, stream):
        while True:
            if len(self._buf) >= AHEAD:
                await asyncio.sleep(TICK)
                continue
            chunk = await stream.read(16384)
            if not chunk:
                return
            self._buf += chunk
            self.last_audio = time.monotonic()
            if not self.active and not self._activating and self.selected:
                # someone picked Whole House in Spotify: take the speakers chosen last time
                self._activating = True
                asyncio.ensure_future(self._activate_quietly())

    async def _activate_quietly(self):
        try:
            await self.activate()
        except Exception as e:
            log.warning("airplay: could not start the speakers: %s", e)
            await asyncio.sleep(10)
        finally:
            self._activating = False

    # ---------- the stream: real time pacer -> ffmpeg -> HTTP (loopback only) ----------
    async def _start_encoder(self):
        if self._enc and self._enc.returncode is None:
            return
        self._enc = await asyncio.create_subprocess_exec(
            self.ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "44100", "-ac", "2",
            "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        self._enc_tasks = [asyncio.create_task(self._feed(self._enc), name="airplay-feed"),
                           asyncio.create_task(self._fan_out(self._enc), name="airplay-fanout")]

    async def _stop_encoder(self):
        for t in self._enc_tasks:
            t.cancel()
        self._enc_tasks = []
        if self._enc and self._enc.returncode is None:
            self._enc.kill()
        self._enc = None

    async def _feed(self, enc):
        t0, sent = time.monotonic(), 0
        try:
            while enc.returncode is None:
                due = int((time.monotonic() - t0) * RATE) // 4 * 4
                n = due - sent
                if n > 0:
                    take = min(n, len(self._buf)) // 4 * 4
                    out = bytes(self._buf[:take]) + bytes(n - take)
                    del self._buf[:take]
                    enc.stdin.write(out)
                    await enc.stdin.drain()
                    sent = due
                await asyncio.sleep(TICK)
        except (ConnectionError, BrokenPipeError):
            pass

    async def _fan_out(self, enc):
        while True:
            chunk = await enc.stdout.read(4096)
            if not chunk:
                return
            for q in list(self._clients):
                if q.qsize() > 200:
                    self._clients.discard(q)
                    q.put_nowait(None)
                else:
                    q.put_nowait(chunk)

    async def _serve(self, request):
        from aiohttp import web
        if request.remote not in ("127.0.0.1", "::1"):
            raise web.HTTPForbidden()
        resp = web.StreamResponse(headers={"Content-Type": "audio/mpeg", "Cache-Control": "no-cache"})
        q = asyncio.Queue()
        self._clients.add(q)
        try:
            await resp.prepare(request)
            while True:
                chunk = await q.get()
                if chunk is None:
                    break
                await resp.write(chunk)
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            self._clients.discard(q)
        return resp

    # ---------- housekeeping ----------
    async def _watch(self):
        """Let the speakers go after a long silence; keep the speaker list fresh while they play."""
        while True:
            await asyncio.sleep(15)
            try:
                if self.active and self.connect and time.monotonic() - max(self.last_audio, self.active_since) > IDLE_RELEASE:
                    await self.release()
                elif self.active:
                    await self.read_devices(force=True)
                    self.on_change()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.info("airplay: check failed: %s", e)
