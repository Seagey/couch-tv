#!/usr/bin/env python3
"""Line up the same video on two (or more) TVs. See sync/README.md.

Pure Python ADB (adb_shell, the key in ~/.android/adbkey), the same as the bridge and
tv-home/tools/tvadb.py, so it needs no `adb` binary and no new Local Network permission on a Mac.
Run it with the bridge's virtual environment. For people (docs/SYNC.md):

  .venv/bin/python sync/sync.py calibrate --tv living-room --tv bedroom --pkg <package>   (once per app)
  .venv/bin/python sync/sync.py play      --tv living-room --tv bedroom --pkg <package>   (every time)

For testers:

  .venv/bin/python sync/sync.py dry   --tv living-room --tv bedroom
  .venv/bin/python sync/sync.py state --tv living-room --tv bedroom --pkg <package>
  .venv/bin/python sync/sync.py sync  --tv living-room --tv bedroom --pkg <package>
  .venv/bin/python sync/sync.py firetest --tv living-room --pkg <package>

--tv takes an id or name from config.json ("tvs"), or [label=]host[:adbport[:udpport]]. Nothing about addresses
is kept in this file.

What changes a TV: only the play, calibrate, sync and firetest commands (pause, seek, play, speed on the target
app, through the helper app). `dry` and `state` only read: `cat /proc/uptime`, `dumpsys
media_session`, and with --helper the helper's state op and its UDP clock.

Clock maths. offset = TV elapsedRealtime minus Mac time, in ms, so  tv_time = mac_time + offset.
/proc/uptime is CLOCK_BOOTTIME, the same clock as SystemClock.elapsedRealtime, but it is printed to
10 ms and truncated, so a read is on average 5 ms short; that is corrected for below. With the
helper installed, a UDP clock server in it (Listener.kt) gives a sub millisecond reading instead.
"""
import argparse
import json
import os
import re
import socket
import statistics
import struct
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PLAYING, PAUSED, BUFFERING = 3, 2, 6
STATE_NAMES = ("NONE", "STOPPED", "PAUSED", "PLAYING", "FAST_FORWARDING", "REWINDING", "BUFFERING",
               "ERROR", "CONNECTING", "SKIPPING_TO_PREVIOUS", "SKIPPING_TO_NEXT", "SKIPPING_TO_QUEUE_ITEM")
HELPER = "dev.couchtv.sync"
UDP_PORT = 5417
UPTIME_QUANTUM_MS = 10.0   # /proc/uptime prints hundredths of a second, truncated


def mac_ms():
    """The Mac's clock for everything here: monotonic, in ms (perf_counter, high resolution)."""
    return time.perf_counter_ns() / 1e6


# ---------- one TV ----------
class Tv:
    def __init__(self, label, host, port=5555, udp_port=None):
        self.label, self.host, self.port = label, host, port
        self.udp_port = udp_port or UDP_PORT   # an emulator needs a redirected port on this Mac
        self.dev = None
        self.lock = threading.Lock()
        self.offset = None        # Offset, after measure()
        self.has_helper = None

    def connect(self):
        from adb_shell.adb_device import AdbDeviceTcp
        from adb_shell.auth.sign_pythonrsa import PythonRSASigner
        key = os.path.expanduser(os.environ.get("ADB_KEY", "~/.android/adbkey"))
        signer = PythonRSASigner(open(key + ".pub").read(), open(key).read())
        self.dev = AdbDeviceTcp(self.host, self.port, default_transport_timeout_s=15)
        self.dev.connect(rsa_keys=[signer], auth_timeout_s=10)

    def shell(self, cmd, timeout=15):
        """Run a shell command, reconnecting once if the Wi-Fi link dropped. Returns (text, mac_t0, mac_t1)."""
        with self.lock:
            for attempt in (1, 2):
                try:
                    if self.dev is None:
                        self.connect()
                    t0 = mac_ms()
                    out = self.dev.shell(cmd, timeout_s=timeout, read_timeout_s=timeout)
                    return out, t0, mac_ms()
                except Exception:
                    try:
                        self.dev.close()
                    except Exception:
                        pass
                    self.dev = None
                    if attempt == 2:
                        raise

    # ----- the helper app -----
    def op(self, op, **extras):
        """One helper command. Returns (json, mac_t0, mac_t1). The reply's own elapsed_ms is the TV's clock at reply."""
        args = " ".join(f"--es {k} {v}" for k, v in extras.items())
        out, t0, t1 = self.shell(f"am broadcast -a {HELPER}.CMD -n {HELPER}/.CmdReceiver --es op {op} {args}")
        m = re.search(r'data="(.*)"\s*$', out.strip(), re.S)
        if not m:
            return {"error": "no reply: " + out.strip()[:120]}, t0, t1
        try:
            return json.loads(m.group(1)), t0, t1
        except ValueError:
            return {"error": "bad reply: " + m.group(1)[:120]}, t0, t1

    def detect_helper(self):
        r, _, _ = self.op("ping")
        self.has_helper = "error" not in r
        return self.has_helper


# ---------- clock offset ----------
class Offset:
    def __init__(self, off, unc, method, n, min_rtt, med_rtt, spread):
        self.off, self.unc, self.method, self.n = off, unc, method, n
        self.min_rtt, self.med_rtt, self.spread = min_rtt, med_rtt, spread

    def __str__(self):
        return (f"{self.method}: offset {self.off:.1f} ms +/- {self.unc:.1f} ms  "
                f"(n={self.n}, rtt min {self.min_rtt:.1f} / median {self.med_rtt:.1f} ms, spread of best {self.spread:.2f} ms)")


def _summarise(samples, method, floor_unc):
    """samples = [(rtt_ms, offset_ms)]. Keep the quarter with the smallest round trip (NTP style: a
    fast exchange has the least queueing on either leg), average their offsets (this also averages
    out the 10 ms steps of /proc/uptime, which move around between reads), and call the uncertainty
    half the smallest round trip plus the floor of the method."""
    samples = sorted(samples)
    best = samples[:max(3, len(samples) // 4)]
    offs = [o for _, o in best]
    spread = statistics.pstdev(offs) if len(offs) > 1 else 0.0
    rtts = [r for r, _ in samples]
    return Offset(statistics.mean(offs), samples[0][0] / 2 + floor_unc, method, len(samples),
                  samples[0][0], statistics.median(rtts), spread)


def measure_adb(tv, n=15):
    """tv_time - mac_time from repeated `cat /proc/uptime` read over ADB."""
    s = []
    for _ in range(n):
        out, t0, t1 = tv.shell("cat /proc/uptime")
        up_ms = float(out.split()[0]) * 1000 + UPTIME_QUANTUM_MS / 2   # truncated to 10 ms: add half a step
        s.append((t1 - t0, up_ms - (t0 + t1) / 2))
    return _summarise(s, "adb /proc/uptime", UPTIME_QUANTUM_MS / 2 * 0.5)


def measure_udp(tv, n=40):
    """tv_time - mac_time from the helper's UDP clock server (NTP exchange), or None if it does not answer."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.5)
    s = []
    try:
        for i in range(n):
            t1 = mac_ms()
            sock.sendto(struct.pack(">q", i), (tv.host, tv.udp_port))
            try:
                data, _ = sock.recvfrom(64)
            except socket.timeout:
                continue
            t4 = mac_ms()
            if len(data) != 24:
                continue
            _, rx, tx = struct.unpack(">qqq", data)
            rx, tx = rx / 1e6, tx / 1e6
            rtt = (t4 - t1) - (tx - rx)
            s.append((rtt, ((rx - t1) + (tx - t4)) / 2))
            time.sleep(0.02)
    finally:
        sock.close()
    return _summarise(s, "udp helper clock", 0.05) if len(s) >= 5 else None


def measure(tv, n_adb=15, n_udp=40, use_udp=True):
    tv.offset = (measure_udp(tv, n_udp) if use_udp else None) or measure_adb(tv, n_adb)
    return tv.offset


# ---------- reading a TV's playback ----------
def parse_dumpsys(text, pkg):
    """Pull one package's PlaybackState out of `cat /proc/uptime; dumpsys media_session` (the same
    fields bridge/server.py reads). Returns a dict like the helper's state op, or None."""
    cur, found = None, []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("package="):
            cur = {"pkg": line.split("=", 1)[1]}
            found.append(cur)
        elif line.startswith("state=PlaybackState") and cur is not None:
            m = re.search(r"\{state=([A-Z_]+)\((\d+)\)", line) or re.search(r"\{state=()(\d+)[,}]", line)
            cur["state"] = int(m.group(2)) if m else -1
            for k, key in (("position", "position"), ("last_update", "updated"), ("actions", "actions")):
                m = re.search(rf"[ {{]{key}=(-?\d+)", line)
                cur[k] = int(m.group(1)) if m else None
            m = re.search(r"speed=([-\d.]+)", line)
            cur["speed"] = float(m.group(1)) if m else 0.0
    if pkg is None:
        return found
    best = None
    for c in found:
        if c["pkg"] == pkg and "state" in c and (best is None or c["state"] in (PLAYING, BUFFERING)):
            best = c
    if best is not None and best.get("actions") is not None:
        best["can_seek"] = bool(best["actions"] & 256)
        best["can_speed"] = bool(best["actions"] & (1 << 18))
    return best


def read_state(tv, pkg):
    """The target app's playback state. Uses the helper if installed, else dumpsys (read only).
    Returns a dict with position, last_update (TV elapsed ms), speed, state, can_seek, can_speed,
    plus 'rtt' and 'source'."""
    if tv.has_helper is None:
        tv.detect_helper()
    if tv.has_helper:
        r, t0, t1 = tv.op("state", pkg=pkg)
        r["rtt"], r["source"] = t1 - t0, "helper"
        return r
    out, t0, t1 = tv.shell("cat /proc/uptime; dumpsys media_session", timeout=20)
    r = parse_dumpsys(out, pkg)
    if r is None:
        return {"error": f"no media session for {pkg}", "rtt": t1 - t0, "source": "dumpsys"}
    r["rtt"], r["source"] = t1 - t0, "dumpsys"
    return r


def position_at(tv, st, at_mac_ms):
    """Where the video is at one Mac instant: the reported position, moved on by the time since the
    app stamped it (on the TV's clock, converted from the Mac instant), times the speed."""
    if "error" in st or st.get("position") is None:
        return None
    if st["state"] != PLAYING or not st.get("last_update"):
        return float(st["position"])
    tv_now = at_mac_ms + tv.offset.off
    return st["position"] + (tv_now - st["last_update"]) * st["speed"]


def gaps_text(tvs, states, at):
    pos = [position_at(t, s, at) for t, s in zip(tvs, states)]
    if any(p is None for p in pos):
        return None, pos
    return pos[0] - pos[-1], pos


def show_states(tvs, states):
    for t, s in zip(tvs, states):
        if "error" in s:
            print(f"  {t.label}: {s['error']}")
            continue
        name = STATE_NAMES[s["state"]] if 0 <= s.get("state", -1) < len(STATE_NAMES) else s.get("state")
        print(f"  {t.label}: {name} pos {s['position']} ms speed {s['speed']} "
              f"seek={s.get('can_seek')} speed_ctl={s.get('can_speed')} read via {s['source']} in {s['rtt']:.0f} ms")


def read_all(tvs, pkg):
    with ThreadPoolExecutor(len(tvs)) as ex:
        return list(ex.map(lambda t: read_state(t, pkg), tvs))


def report_gap(tvs, pkg, label="gap", quiet=False):
    """Read every TV, extrapolate to one Mac instant, print the gap (first TV minus last TV)."""
    states = read_all(tvs, pkg)
    at = mac_ms()
    g, pos = gaps_text(tvs, states, at)
    if quiet:
        return g, states
    show_states(tvs, states)
    if g is None:
        print(f"  {label}: cannot compute")
        return None, states
    unc = sum(t.offset.unc ** 2 for t in (tvs[0], tvs[-1])) ** 0.5
    print(f"  {label}: {tvs[0].label} is {g:+.1f} ms vs {tvs[-1].label} (clock uncertainty +/- {unc:.1f} ms, "
          f"plus whatever the app's own position is out by)")
    return g, states


# ---------- commands ----------
def cmd_dry(a, tvs):
    """Read only. Clock offsets (repeated to show how steady they are), then states."""
    for t in tvs:
        t.connect()
        t.has_helper = t.detect_helper() if a.helper else False   # without --helper nothing but cat and dumpsys is run on the TV
    first = {}
    for rep in range(a.repeat):
        if rep:
            time.sleep(a.every)
        for t in tvs:
            o = measure(t, n_adb=a.samples, use_udp=a.helper and not a.no_udp)
            base = first.setdefault(t.label, (o.off, time.time()))
            drift = f"  moved {o.off - base[0]:+.2f} ms in {time.time() - base[1]:.0f} s" if rep else ""
            print(f"[{rep + 1}/{a.repeat}] {t.label}: {o}{drift}")
    if a.pkg:
        print("playback:")
        report_gap(tvs, a.pkg)
    else:
        print("media sessions (give --pkg to compare one):")
        for t in tvs:
            out, _, _ = t.shell("cat /proc/uptime; dumpsys media_session", timeout=20)
            for c in parse_dumpsys(out, None):
                if "state" in c:
                    st = STATE_NAMES[c["state"]] if 0 <= c["state"] < len(STATE_NAMES) else c["state"]
                    print(f"  {t.label}: {c['pkg']}  {st}  pos {c['position']}  seek={bool((c.get('actions') or 0) & 256)}")


def cmd_state(a, tvs):
    for t in tvs:
        t.connect()
        t.has_helper = t.detect_helper() if a.helper else False
    for t in tvs:
        measure(t, n_adb=a.samples, use_udp=a.helper and not a.no_udp)
        print(f"{t.label}: {t.offset}")
    report_gap(tvs, a.pkg)


PLAY_DELAY = {}   # --delay label=ms: start this TV's play later, for a TV whose player starts sooner


def schedule_all(tvs, op, pkg, at_mac, **extras):
    """Arm `op` on every TV for one Mac instant. Returns [(tv, reply, reply_arrived_in_time)]."""
    def one(t):
        at_tv = at_mac + t.offset.off + (PLAY_DELAY.get(t.label, 0.0) if op == "play" else 0.0)
        r, t0, t1 = t.op(op, pkg=pkg, at_elapsed_ms=f"{at_tv:.3f}", **extras)
        # the reply carries the TV's clock when it answered: that must be before the moment
        return t, r, ("error" not in r and r.get("elapsed_ms", 1e18) < at_tv)
    with ThreadPoolExecutor(len(tvs)) as ex:
        return list(ex.map(one, tvs))


def fire_reports(armed, at_mac):
    """Wait until just after the moment, then fetch each TV's report. Returns {label: report}."""
    time.sleep(max(0.0, (at_mac - mac_ms()) / 1000) + 0.4)
    out = {}
    for t, r, _ in armed:
        rep, _, _ = t.op("last", id=r.get("id", 0))
        out[t.label] = rep
    return out


def print_fire(tvs, reps, at_mac):
    """How close each command fired to the moment, in Mac time (via the clock offsets)."""
    fired = {}
    for t in tvs:
        r = reps.get(t.label, {})
        if "fired_ms" not in r:
            print(f"  {t.label}: no fire report ({r.get('error')})")
            continue
        fired[t.label] = r["fired_ms"] - t.offset.off
        print(f"  {t.label}: fired {r['fired_ms'] - r['want_ms']:+.2f} ms after the armed time on its own clock, "
              f"controller call took {r['call_ms']:.2f} ms")
    if len(fired) > 1:
        v = list(fired.values())
        print(f"  skew between TVs at fire: {max(v) - min(v):.1f} ms (clock uncertainty adds up to "
              f"+/- {sum(t.offset.unc for t in tvs):.1f} ms)")


def settle(tv, pkg, target, timeout=10.0):
    """Wait for a TV to finish a seek: not buffering, position near the target. Returns (seconds, position) or (None, last)."""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        s = read_state(tv, pkg)
        last = s.get("position")
        if "error" not in s and s["state"] != BUFFERING and abs(s["position"] - target) < 1500:
            return time.time() - t0, s["position"]
        time.sleep(0.15)
    return None, last


def cmd_sync(a, tvs):
    for t in tvs:
        t.connect()
        if not t.detect_helper():
            sys.exit(f"{t.label}: the helper app is not installed or not granted (README: Install). Sync needs it.")
    print("clock offsets:")
    for t in tvs:
        measure(t, n_adb=a.samples, use_udp=not a.no_udp)
        print(f"  {t.label}: {t.offset}")
    print("before:")
    g0, states = report_gap(tvs, a.pkg, "gap before")
    for t, s in zip(tvs, states):
        if "error" in s:
            sys.exit(f"{t.label}: {s['error']}")
        if not s.get("can_seek"):
            sys.exit(f"{t.label}: {a.pkg} does not advertise SEEK_TO, so it cannot be synced by seeking")
    target = a.pos if a.pos is not None else int(position_at(tvs[0], states[0], mac_ms()))
    print(f"pause both, seek both to {target} ms")
    with ThreadPoolExecutor(len(tvs)) as ex:
        list(ex.map(lambda t: t.op("pause", pkg=a.pkg), tvs))
        time.sleep(0.3)
        list(ex.map(lambda t: t.op("seek", pkg=a.pkg, pos_ms=target), tvs))
        res = list(ex.map(lambda t: settle(t, a.pkg, target), tvs))
    for t, (secs, pos) in zip(tvs, res):
        print(f"  {t.label}: settled in {secs:.2f} s at {pos} ms" if secs is not None else f"  {t.label}: did not settle (position {pos})")
    seek_lag_ms = 150.0   # how long a seek takes to land while playing; learnt from each seek trim below

    at = mac_ms() + a.lead
    print(f"play on both at one moment, {a.lead:.0f} ms ahead")
    armed = schedule_all(tvs, "play", a.pkg, at)
    for t, r, ok in armed:
        if not ok:
            print(f"  {t.label}: ARMED TOO LATE or failed ({r}); raise --lead")
    print_fire(tvs, fire_reports(armed, at), at)
    time.sleep(a.settle)
    g, states = report_gap(tvs, a.pkg, "gap after play")

    if not a.trim and g is not None and abs(g) > a.threshold:
        print(f"gap is over {a.threshold:.0f} ms; add --trim to try to close it (read the README first: on the emulator test "
              f"player a trim made the real gap worse, because the app's position report is not trustworthy to that level)")
    for attempt in range(1, (a.tries or 4) + 1):
        if not a.trim or g is None or abs(g) <= a.threshold:
            break
        ahead, behind = (tvs[0], tvs[-1]) if g > 0 else (tvs[-1], tvs[0])
        gap = abs(g)
        sb = states[tvs.index(behind)]
        if gap > 3000 or not (sb.get("can_speed") and a.speed):
            if gap < a.seek_min:
                print(f"stop: {gap:.0f} ms is below --seek-min ({a.seek_min:.0f} ms). {behind.label}'s app takes no "
                      f"speed change, and a seek is only trusted to land within about 100 ms")
                break
            # a small seek on the one behind: to where the other one will be when the seek lands
            at = mac_ms() + 800
            ref = states[tvs.index(ahead)]
            pos = position_at(ahead, ref, at + seek_lag_ms)
            print(f"trim {attempt}: seek {behind.label} to {pos:.0f} ms at +800 ms (gap {gap:.1f} ms)")
            armed = schedule_all([behind], "seek", a.pkg, at, pos_ms=f"{pos:.0f}")
            dur = 0.0
        else:
            dur = gap / 0.02
            at = mac_ms() + 800
            print(f"trim {attempt}: {behind.label} at 1.02x for {dur:.0f} ms (gap {gap:.1f} ms)")
            armed = schedule_all([behind], "speed", a.pkg, at, x="1.02")
            armed += schedule_all([behind], "speed", a.pkg, at + dur, x="1.0")
        time.sleep(max(0.0, (at - mac_ms()) / 1000) + dur / 1000 + a.settle)
        g, states = report_gap(tvs, a.pkg, f"gap after trim {attempt}")
        if dur == 0.0 and g is not None:
            # the seek was aimed at where the other TV would be after seek_lag_ms. Whatever gap is left is
            # the error in that guess (landed early: ahead by it; late: behind), so correct the guess.
            seek_lag_ms -= g if behind is tvs[0] else -g
    if g is not None:
        verdict = "within" if abs(g) <= a.threshold else "NOT within"
        print(f"result: {g:+.1f} ms, {verdict} {a.threshold} ms")


# ---------- retry mode ----------
def start_together(a, tvs, target):
    """One full start: pause both, seek both to `target`, wait for the seeks, timed play on both,
    wait, read the gap. Returns (gap ms, states, armed_ok)."""
    with ThreadPoolExecutor(len(tvs)) as ex:
        list(ex.map(lambda t: t.op("pause", pkg=a.pkg), tvs))
        time.sleep(0.3)
        list(ex.map(lambda t: t.op("seek", pkg=a.pkg, pos_ms=target), tvs))
        list(ex.map(lambda t: settle(t, a.pkg, target), tvs))
    at = mac_ms() + a.lead
    armed = schedule_all(tvs, "play", a.pkg, at)
    ok = all(good for _, _, good in armed)
    time.sleep(max(0.0, (at - mac_ms()) / 1000) + a.settle)
    g, states = report_gap(tvs, a.pkg, quiet=True)
    return g, states, ok


def pause_trim(a, tvs, g, bias):
    """The cheap correction: pause only the TV that is ahead at one exact moment and play it again
    `gap + bias` ms later (both armed on its own clock, so the pause length is exact). The TV loses
    that long plus its own resume latency, so `bias` (learnt per TV from the last residual) is
    normally negative. A pause cannot be shorter than nothing, so a gap smaller than the resume
    latency cannot be fixed this way. Returns (gap, states, armed_ok)."""
    ahead = tvs[0] if g > 0 else tvs[-1]
    dur = max(0.0, abs(g) + bias.get(ahead.label, 0.0))
    at = mac_ms() + 800
    armed = schedule_all([ahead], "pause", a.pkg, at)
    saved = dict(PLAY_DELAY)
    PLAY_DELAY.clear()
    armed += schedule_all([ahead], "play", a.pkg, at + dur)
    PLAY_DELAY.update(saved)
    ok = all(good for _, _, good in armed)
    time.sleep(max(0.0, (at + dur - mac_ms()) / 1000) + a.settle)
    g2, states = report_gap(tvs, a.pkg, quiet=True)
    if g2 is not None:
        resid = g2 if ahead is tvs[0] else -g2   # >0: the paused TV is still ahead, it was paused too briefly
        bias[ahead.label] = bias.get(ahead.label, 0.0) + 0.5 * resid
    return g2, states, ok, dur


def cmd_retry(a, tvs):
    """sync --retry: start both together, read the gap, and while it is over --target correct it
    (--fix redo: pause + seek + timed play again; --fix trim: pause-trim the TV that is ahead),
    up to --tries attempts in all (the first start counts as one). --runs repeats the whole thing."""
    for t in tvs:
        t.connect()
        if not t.detect_helper():
            sys.exit(f"{t.label}: the helper app is not installed or not granted (README: Install). Sync needs it.")
    log = open(a.log, "a") if a.log else None
    results = []
    for run in range(1, a.runs + 1):
        for t in tvs:
            measure(t, n_adb=a.samples, use_udp=not a.no_udp)
        states = read_all(tvs, a.pkg)
        for t, s in zip(tvs, states):
            if "error" in s:
                sys.exit(f"{t.label}: {s['error']}")
            if not s.get("can_seek"):
                sys.exit(f"{t.label}: {a.pkg} does not advertise SEEK_TO")
        target = a.pos if a.pos is not None else int(position_at(tvs[0], states[0], mac_ms()))
        bias, tries, t0 = {}, [], time.time()
        g, states, ok = start_together(a, tvs, target)
        tries.append(("start", g, time.time() - t0))
        while g is not None and abs(g) > a.target and len(tries) < a.tries:
            if a.fix == "trim" and abs(g) <= 3000:
                g, states, ok, dur = pause_trim(a, tvs, g, bias)
                tries.append((f"trim{dur:.0f}", g, time.time() - t0))
            else:
                g, states, ok = start_together(a, tvs, target)
                tries.append(("redo", g, time.time() - t0))
            if g is None:
                break
        gaps = [x[1] for x in tries if x[1] is not None]
        best = min(gaps, key=abs) if gaps else None
        rec = {"run": run, "fix": a.fix, "target": a.target, "tries": [[k, None if x is None else round(x, 1), round(s, 1)] for k, x, s in tries],
               "n": len(tries), "first": gaps[0] if gaps else None, "final": g, "best": best, "secs": round(time.time() - t0, 1), "armed_ok": ok}
        results.append(rec)
        print(f"run {run}/{a.runs} [{a.fix}]: " + "  ".join(f"{k}:{x:+.0f}" if x is not None else f"{k}:?" for k, x, _ in tries)
              + f"  -> final {g:+.1f} ms after {len(tries)} tries, best {best:+.1f}, {rec['secs']} s", flush=True)
        if log:
            log.write(json.dumps(rec) + "\n")
            log.flush()
    ok_runs = [r for r in results if r["final"] is not None]
    if ok_runs:
        fin = sorted(abs(r["final"]) for r in ok_runs)
        first = sorted(abs(r["first"]) for r in ok_runs)
        q = lambda v, f: v[min(len(v) - 1, int(f * len(v)))]
        print(f"summary [{a.fix}] over {len(ok_runs)} runs: |first gap| median {statistics.median(first):.0f} ms; "
              f"|final gap| median {statistics.median(fin):.0f}, p90 {q(fin, 0.9):.0f}, max {fin[-1]:.0f} ms; "
              f"within {a.target:.0f} ms: {sum(1 for x in fin if x <= a.target)}/{len(fin)}; "
              f"tries median {statistics.median(r['n'] for r in ok_runs):.0f}; seconds median {statistics.median(r['secs'] for r in ok_runs):.0f}")


def cmd_firetest(a, tvs):
    """How close to the armed moment does the helper fire? Arms a harmless command repeatedly on each TV."""
    for t in tvs:
        t.connect()
        if not t.detect_helper():
            sys.exit(f"{t.label}: helper not installed")
        measure(t, n_adb=a.samples, use_udp=not a.no_udp)
    states = read_all(tvs, a.pkg)
    late = {t.label: [] for t in tvs}
    skew = []
    for i in range(a.count):
        at = mac_ms() + 900
        armed = []
        for t, s in zip(tvs, states):
            extras = {"pos_ms": int(s["position"])} if a.op == "seek" else ({"x": "1.0"} if a.op == "speed" else {})
            armed += schedule_all([t], a.op, a.pkg, at, **extras)
        reps = fire_reports(armed, at)
        fired = []
        for t in tvs:
            r = reps.get(t.label, {})
            if "late_ms" in r:
                late[t.label].append(r["late_ms"])
                fired.append(r["fired_ms"] - t.offset.off)
        if len(fired) > 1:
            skew.append(max(fired) - min(fired))
    for lab, v in late.items():
        if v:
            print(f"{lab}: fired late by median {statistics.median(v):.3f} ms, max {max(v):.3f} ms, min {min(v):.3f} ms over {len(v)} fires")
    if skew:
        print(f"skew between TVs (via clock offsets): median {statistics.median(skew):.2f} ms, max {max(skew):.2f} ms")


# ---------- saved delays, calibrate and play (the commands for people) ----------
DELAYS_NAME = "sync-delays.json"
MAX_SANE_GAP_MS = 1000.0   # a gap bigger than this is a stall or a bad read, not the TVs' steady difference


def delays_path(config_path):
    """The saved delays live next to config.json (and git ignores them)."""
    return os.path.join(os.path.dirname(os.path.abspath(config_path)), DELAYS_NAME)


def load_delays(path, pkg):
    """{tv id: ms} saved for this app, or {} (no file, no entry, or a file that is not readable)."""
    try:
        with open(path) as f:
            data = json.load(f)
        return {str(k): float(v) for k, v in (data.get(pkg) or {}).items()}
    except (OSError, ValueError, AttributeError, TypeError):
        return {}


def save_delays(path, pkg, delays):
    """Add or replace this app's entry, keep every other app's. Written in one step so a crash
    cannot leave half a file."""
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data.setdefault(pkg, {}).update({k: round(v) for k, v in delays.items()})
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def summarise_gaps(gaps):
    """Signed gaps from the rounds. Drops anything missing or bigger than MAX_SANE_GAP_MS (a stall).
    Returns (kept, median or None)."""
    kept = [g for g in gaps if g is not None and abs(g) <= MAX_SANE_GAP_MS]
    return kept, (statistics.median(kept) if kept else None)


def delays_from_gap(first, second, gap):
    """gap = first minus second, positive when `first` is ahead. The one that is ahead starts later
    by the gap; the other has no delay."""
    return {first: max(gap, 0.0), second: max(-gap, 0.0)}


def choose_delays(saved, explicit, labels):
    """Saved delays for these TVs, then --delay on top (an explicit value always wins, 0 included)."""
    out = {k: v for k, v in saved.items() if k in labels}
    out.update(explicit)
    return out


def prepare(a, tvs):
    """Connect, check the helper, line up the clocks and read both TVs, stopping with a plain
    sentence when something is not ready. Returns the states."""
    for t in tvs:
        try:
            t.connect()
        except Exception as e:
            sys.exit(f"Cannot reach {t.label} ({t.host}). Is it on, on the same Wi-Fi, with ADB debugging allowed for this computer? ({type(e).__name__})")
        if not t.detect_helper():
            sys.exit(f"{t.label} does not have the sync helper set up. Run sync/install.sh with that TV's address first (docs/SYNC.md, step 1).")
    for t in tvs:
        measure(t, n_adb=a.samples, use_udp=not a.no_udp)
        print(f"{t.label}: clock lined up to within {t.offset.unc:.1f} ms ({t.offset.method})")
    states = read_all(tvs, a.pkg)
    for t, s in zip(tvs, states):
        if "error" in s:
            sys.exit(f"{t.label}: {a.pkg} has no show open. Open the same show on both TVs, press play once, then run this again. ({s['error'][:90]})")
        if not s.get("can_seek"):
            sys.exit(f"{t.label}: {a.pkg} does not let another app move its place in the show, so it cannot be synced.")
    return states


def start_position(a, tvs, states):
    return a.pos if a.pos is not None else int(position_at(tvs[0], states[0], mac_ms()))


def ahead_text(tvs, g):
    ahead, behind = (tvs[0], tvs[-1]) if g > 0 else (tvs[-1], tvs[0])
    return f"{ahead.label} is {abs(g):.0f} ms ahead of {behind.label}"


def cmd_calibrate(a, tvs):
    """Plain timed syncs (no delay), median signed gap, saved as each TV's play delay."""
    PLAY_DELAY.clear()
    states = prepare(a, tvs)
    target = start_position(a, tvs, states)
    first, last = tvs[0].label, tvs[-1].label
    print(f"Calibrating {a.pkg} on {first} and {last}: {a.rounds} plain syncs, roughly {a.rounds * 12} seconds. "
          f"Both TVs will pause, jump back and play a few times. Keep both on the same show.")
    gaps = []
    for i in range(1, a.rounds + 1):
        g, _, ok = start_together(a, tvs, target)
        gaps.append(g)
        print(f"  round {i}: " + ("could not read the gap" if g is None else ahead_text(tvs, g) if abs(g) >= 1 else "dead level"), flush=True)
    kept, med = summarise_gaps(gaps)
    if len(kept) < 3:
        sys.exit(f"Not enough good readings ({len(kept)} of {a.rounds}), so nothing was saved. Check both TVs are playing "
                 f"and not buffering, then run calibrate again.")
    spread = max(kept) - min(kept)
    delays = delays_from_gap(first, last, med)
    path = a.delays_file or delays_path(a.config)
    save_delays(path, a.pkg, delays)
    dropped = len(gaps) - len(kept)
    print(f"Found: {len(kept)} good readings" + (f" ({dropped} thrown away, a stall or a bad read)" if dropped else "")
          + f", from {min(kept):+.0f} to {max(kept):+.0f} ms, middle value {med:+.0f} ms.")
    if abs(med) < 5:
        print(f"{first} and {last} start together already, so no delay is needed.")
    else:
        slow = first if med > 0 else last
        print(f"{ahead_text(tvs, med)} when it starts (the middle of the readings). From now on {slow} starts {abs(med):.0f} ms later.")
    if spread > 50:
        print("The readings jump around a fair bit. Run calibrate again if play does not settle quickly.")
    print(f"Saved to {path}. Both TVs are still playing. Next: sync.py play --tv {first} --tv {last} --pkg {a.pkg}")


def cmd_play(a, tvs):
    """Start both together using the saved delays, and redo until under --target."""
    if PLAY_DELAY:
        print("Using delays: " + ", ".join(f"{k} {v:.0f} ms" for k, v in PLAY_DELAY.items()) + (" (saved by calibrate)" if a.saved_used else ""))
    else:
        print(f"No saved delays for {a.pkg} yet. It will still work, but may take more tries. "
              f"Run calibrate once to make it quicker (docs/SYNC.md, step 3).")
    states = prepare(a, tvs)
    target = start_position(a, tvs, states)
    print(f"Pausing both TVs, jumping to {target / 1000:.0f} s into the show, and pressing play together.")
    gaps = []
    for n in range(1, a.tries + 1):
        g, _, ok = start_together(a, tvs, target)
        if g is None:
            print(f"  try {n}: could not read where one TV is up to")
        else:
            gaps.append(g)
            print(f"  try {n}: {abs(g):.0f} ms apart" + ("" if ok else " (a TV got the start message late)"), flush=True)
            if abs(g) <= a.target and ok:
                print(f"In sync, about {abs(g):.0f} ms apart. Both TVs are playing.")
                print("That is what the two apps report for their own position. Picture and sound delays inside each TV are not counted.")
                return 0
    if not gaps:
        print(f"Could not tell how far apart the TVs are, so it cannot say they are in sync. Check both are still playing {a.pkg}.")
        return 1
    best = min(gaps, key=abs)
    print(f"Not in sync after {a.tries} tries: the closest was {abs(best):.0f} ms apart (wanted under {a.target:.0f}). "
          f"Both TVs are playing, a little out. Common causes: a TV buffering or on weak Wi-Fi, or delays that are out of date "
          f"(run calibrate again).")
    return 1


# ---------- plumbing ----------
def resolve_tv(spec, cfg):
    """id or name from config.json, or [label=]host[:adbport[:udpport]]."""
    label, _, rest = spec.partition("=")
    if not rest:
        label, rest = None, spec
    for t in (cfg or {}).get("tvs", []):
        if rest.lower() in ((t.get("id") or "").lower(), (t.get("name") or "").lower()):
            host = (t.get("host") or "").strip()   # a name is tried first, then "ip", as the bridge does
            try:
                socket.getaddrinfo(host, None, socket.AF_INET)
            except OSError:
                host = t.get("ip")
            return Tv(label or t.get("id") or rest, host, int(t.get("adb_port") or 5555))
    host, _, ports = rest.partition(":")
    port, _, udp = ports.partition(":")
    return Tv(label or host, host, int(port or 5555), int(udp) if udp else None)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cmd", choices=["calibrate", "play", "dry", "state", "sync", "firetest"])
    p.add_argument("--tv", action="append", required=True, help="id or name from config.json, or [label=]host[:adbport[:udpport]]; give two or more")
    p.add_argument("--config", default=os.environ.get("COUCH_CONFIG") or os.path.join(HERE, "..", "config.json"))
    p.add_argument("--pkg", help="the streaming app's package name")
    p.add_argument("--samples", type=int, default=15, help="ADB clock reads per TV (default 15)")
    p.add_argument("--helper", action="store_true", help="dry, state: use the helper app (broadcasts, UDP clock). Without it only read only shell commands run on the TV")
    p.add_argument("--no-udp", action="store_true", help="measure clocks over ADB only, even if the helper's UDP clock answers")
    p.add_argument("--repeat", type=int, default=1, help="dry: measure this many times")
    p.add_argument("--every", type=float, default=10, help="dry: seconds between repeats")
    p.add_argument("--pos", type=int, help="sync: seek both to this position in ms (default: where the first TV is now)")
    p.add_argument("--lead", type=float, default=1500, help="sync: ms between arming play and the moment (default 1500)")
    p.add_argument("--threshold", type=float, default=15, help="sync: stop when the gap is under this many ms (default 15)")
    p.add_argument("--trim", action="store_true", help="sync: after the timed play, try to close the gap with a speed nudge or a small seek (off by default, see README)")
    p.add_argument("--tries", type=int, default=None, help="sync: with --trim, trim attempts (default 4); with --retry or play, attempts in all, the first start included (default 6)")
    p.add_argument("--no-speed", dest="speed", action="store_false", help="sync: trim by seeking even if the app takes a speed change")
    p.add_argument("--seek-min", type=float, default=100, help="sync: when the app takes no speed change, do not trim by seeking a gap smaller than this many ms (default 100)")
    p.add_argument("--delay", action="append", default=[], help="sync, play: label=ms, start that TV's play this much later (a TV that is always ahead). Beats the saved delays")
    p.add_argument("--settle", type=float, default=1.5, help="sync: seconds to wait before reading the gap (default 1.5)")
    p.add_argument("--retry", action="store_true", help="sync: read the gap after the timed play and correct it until it is under --target (see --fix, --tries)")
    p.add_argument("--target", type=float, default=20, help="sync --retry: good enough, in ms (default 20)")
    p.add_argument("--fix", choices=["redo", "trim"], default="redo", help="sync --retry: redo = pause, seek and timed play again; trim = pause only the TV that is ahead and resume it later (default redo)")
    p.add_argument("--runs", type=int, default=1, help="sync --retry: repeat the whole sync this many times and summarise")
    p.add_argument("--log", help="sync --retry: append one JSON line per run to this file")
    p.add_argument("--rounds", type=int, default=6, help="calibrate: how many plain syncs to measure (default 6)")
    p.add_argument("--delays-file", help="calibrate, play, sync: where the saved delays live (default: sync-delays.json next to config.json)")
    p.add_argument("--count", type=int, default=10, help="firetest: how many fires (default 10)")
    p.add_argument("--op", default="seek", choices=["seek", "speed", "pause"], help="firetest: the command to arm (default seek to where it already is)")
    a = p.parse_args()
    explicit = {}
    for d in a.delay:
        lab, _, ms = d.partition("=")
        explicit[lab] = float(ms)
    try:
        cfg = json.load(open(a.config))
    except (OSError, ValueError):
        cfg = {}
    tvs = [resolve_tv(s, cfg) for s in a.tv]
    if a.cmd in ("state", "sync", "firetest", "play", "calibrate") and not a.pkg:
        sys.exit("--pkg is needed for this command")
    if a.cmd in ("sync", "play", "calibrate") and len(tvs) < 2:
        sys.exit(f"{a.cmd} needs two --tv")
    if a.cmd in ("play", "calibrate") and len(tvs) != 2:
        sys.exit(f"{a.cmd} works on exactly two TVs")
    # delays: what calibrate saved (sync and play only), then --delay on top
    saved = {}
    if a.cmd in ("sync", "play"):
        saved = load_delays(a.delays_file or delays_path(a.config), a.pkg)
    a.saved_used = any(t.label in saved and t.label not in explicit for t in tvs)
    PLAY_DELAY.update(choose_delays(saved, explicit, [t.label for t in tvs]))
    if a.cmd == "calibrate":
        return cmd_calibrate(a, tvs)
    if a.cmd == "play":
        a.tries = a.tries or 6
        sys.exit(cmd_play(a, tvs))
    if a.cmd == "sync" and PLAY_DELAY:
        print("play delays in use: " + ", ".join(f"{k} {v:.0f} ms" for k, v in PLAY_DELAY.items()))
    if a.cmd == "sync" and a.retry:
        a.tries = a.tries or 6
        return cmd_retry(a, tvs)
    {"dry": cmd_dry, "state": cmd_state, "sync": cmd_sync, "firetest": cmd_firetest}[a.cmd](a, tvs)


if __name__ == "__main__":
    main()
