"""Measures how the couch-tv home runs on a TV and prints a block you can paste into an issue or into
docs/PERFORMANCE.md. It reads the TV over ADB and moves the focus along the home a few times; it
changes no setting. Only with --cold-start does it restart the home (see below).

What it measures:
  - the TV: model, Android, chip, graphics, memory, screen size, WebView and couch-tv versions
  - memory: the home's own process (PSS, with its Graphics and Java heap) and the WebView renderer(s)
  - smoothness: the time between frames the screen really shows while the focus moves along the row,
    from `dumpsys SurfaceFlinger --latency` (the page's own frame timer cannot see a screen that
    shows 30 frames a second while the page makes 60: #197)
  - with --cold-start: the time from a force stop to the first frame (`am start -W`). It restarts the
    home, so the Home button watch is switched off and on again afterwards, as apply.sh does.

The printed block has no address, network name, serial number or account in it.

Usage: TV_IP=<tv address> [ADB_PORT=5555] .venv/bin/python tv-home/tools/bench-tv.py [options]
  --moves N            how many times to move right x3 then left x3 (default 3)
  --cold-start         also time a cold start (restarts the home)
  --look NAME          the look in use (night, oled, classic), for the report
  --lighter yes|no     whether Lighter home is on, for the report
  --render-height N    the home.render_height in use (0 for none), for the report
  --json               print JSON instead of the table
The three "for the report" options only label the result: the TV does not tell them to this tool.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tvadb  # noqa: E402

PKG = "app.couchtv.launcher"
ACTIVITY = PKG + "/.MainActivity"


# ---- parsing (pure functions, tested in tests/test_bench_tv.py) ----

def prop_block(text):
    """The lines of `getprop` output we ask for, one per line, in order."""
    return [line.strip() for line in text.splitlines()]


def meminfo_kb(text, key):
    m = re.search(r"^%s:\s+(\d+)\s*kB" % re.escape(key), text, re.M)
    return int(m.group(1)) if m else None


def proc_meminfo(text):
    """Total, available and swapped-out memory in MB from /proc/meminfo."""
    total, avail = meminfo_kb(text, "MemTotal"), meminfo_kb(text, "MemAvailable")
    st, sf = meminfo_kb(text, "SwapTotal"), meminfo_kb(text, "SwapFree")
    mb = lambda kb: None if kb is None else round(kb / 1024)  # noqa: E731
    return {"ram_mb": mb(total), "available_mb": mb(avail),
            "swap_used_mb": None if st is None or sf is None else mb(st - sf)}


def process_meminfo(text):
    """PSS and the parts of it that matter, in MB, from `dumpsys meminfo <pid or package>`."""
    def kb(pattern):
        m = re.search(pattern, text)
        return None if not m else round(int(m.group(1)) / 1024, 1)
    out = {"pss_mb": kb(r"TOTAL PSS:\s+(\d+)"), "graphics_mb": kb(r"Graphics:\s+(\d+)"),
           "java_heap_mb": kb(r"Java Heap:\s+(\d+)")}
    for key, label in (("activities", "Activities"), ("webviews", "WebViews")):
        m = re.search(label + r":\s+(\d+)", text)
        out[key] = int(m.group(1)) if m else None
    return out


def webview_version(text):
    m = re.search(r"Current WebView package \(name, version\):\s*\(([^,]+),\s*([^)]+)\)", text)
    return m.group(2).strip() if m else None


def gles(text):
    m = re.search(r"GLES:\s*([^\n]+)", text)
    if not m:
        return None
    parts = [p.strip() for p in m.group(1).split(",")]
    return ", ".join(parts[:2])


def home_layer(text):
    """The SurfaceFlinger layer of the home's activity window (the one ending in MainActivity#N)."""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(PKG + "/") and "MainActivity#" in line:
            return line
    return None


def sandboxed_pids(ps_text):
    pids = []
    for line in ps_text.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit() and "sandboxed_process" in parts[1]:
            pids.append(int(parts[0]))
    return pids


def frame_gaps_ms(latency_text):
    """Gaps in ms between frames actually presented, from `dumpsys SurfaceFlinger --latency`.
    Pauses over 0.4 s (nothing moving) are not counted; unused rows hold a huge placeholder time."""
    rows = [line.split() for line in latency_text.splitlines()[1:] if len(line.split()) == 3]
    times = [int(r[1]) for r in rows if 0 < int(r[1]) < 2 ** 62]
    return [(b - a) / 1e6 for a, b in zip(times, times[1:]) if 0 < b - a < 400e6]


def frame_stats(gaps):
    if len(gaps) < 5:
        return None
    s = sorted(gaps)
    median = s[len(s) // 2]
    return {"frames": len(gaps) + 1, "median_ms": round(median, 1), "p90_ms": round(s[int(len(s) * 0.9)], 1),
            "fps": round(1000 / median), "slow_frames": sum(g > 34 for g in gaps)}


def watch_bound(text):
    """True when `Bound services:{Service[...` lists a service: the Home button watch is running."""
    return bool(re.search(r"Bound services:\{\s*Service", text))


def am_start_total_ms(text):
    m = re.search(r"TotalTime:\s*(\d+)", text)
    return int(m.group(1)) if m else None


# ---- on the TV ----

def measure(tv, moves, cold):
    sh = tv.shell
    info = {}
    props = prop_block(sh("getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; "
                          "getprop ro.build.version.sdk; getprop ro.board.platform; getprop ro.hardware"))
    props += [""] * (6 - len(props))
    info.update({"maker": props[0], "model": props[1], "android": props[2], "sdk": props[3], "chip": props[4] or props[5]})
    info["gpu"] = gles(sh("dumpsys SurfaceFlinger | grep -m1 GLES"))
    info.update(proc_meminfo(sh("cat /proc/meminfo")))
    wm = sh("wm size; wm density")
    sz = re.findall(r"(?:Physical|Override) size:\s*(\d+x\d+)", wm)
    dn = re.findall(r"(?:Physical|Override) density:\s*(\d+)", wm)
    info["screen"] = sz[-1] if sz else None
    info["density"] = int(dn[-1]) if dn else None
    info["webview"] = webview_version(sh("dumpsys webviewupdate | grep -m1 'Current WebView package'"))
    ver = re.search(r"versionName=(\S+)", sh("dumpsys package " + PKG + " | grep -m1 versionName"))
    info["couchtv"] = ver.group(1) if ver else None
    if not info["couchtv"]:
        raise RuntimeError("couch-tv is not installed on this TV (package %s)." % PKG)

    result = {"tv": info}

    if cold:
        keep = sh("settings get secure enabled_accessibility_services").strip()
        sh("am force-stop " + PKG)
        time.sleep(1)
        result["cold_start_ms"] = am_start_total_ms(sh("am start -W -n " + ACTIVITY))
        time.sleep(12)
        if keep and keep != "null":   # a force stop leaves the Home button watch crashed: off, then on (#37)
            # Android can take a while after a force stop: measured on an XGIMI, the first off then on at
            # about 20 s after the restart left it unbound and the second, 20 s later, bound it. So try again.
            result["watch_bound"] = False
            for _ in range(4):
                sh("settings put secure enabled_accessibility_services null")
                time.sleep(2)
                sh("settings put secure enabled_accessibility_services '%s'; settings put secure accessibility_enabled 1" % keep)
                time.sleep(5)
                if watch_bound(sh("dumpsys accessibility | grep -m1 'Bound services'")):
                    result["watch_bound"] = True
                    break
                time.sleep(12)

    if PKG not in sh("dumpsys activity activities | grep -m1 -i resumedActivity"):
        sh("input keyevent KEYCODE_HOME")
        time.sleep(4)
    time.sleep(3)

    mem = {"home": process_meminfo(sh("dumpsys meminfo " + PKG))}
    pids = sandboxed_pids(sh("ps -A -o PID,NAME | grep sandboxed_process"))
    rend = [process_meminfo(sh("dumpsys meminfo %d" % p)) for p in pids]
    mem["renderer_pss_mb"] = round(sum(r["pss_mb"] or 0 for r in rend), 1) if rend else None
    mem["renderer_count"] = len(rend)
    result["memory"] = mem

    layer = home_layer(sh("dumpsys SurfaceFlinger --list"))
    if layer:
        sh("dumpsys SurfaceFlinger --latency-clear '%s'" % layer)
        step = "input keyevent KEYCODE_DPAD_RIGHT; sleep 0.4; " * 3 + "input keyevent KEYCODE_DPAD_LEFT; sleep 0.4; " * 3
        for _ in range(moves):
            sh(step, 60)
        result["frames"] = frame_stats(frame_gaps_ms(sh("dumpsys SurfaceFlinger --latency '%s'" % layer)))
    else:
        result["frames"] = None
    return result


def table(r, labels):
    t, m, f = r["tv"], r["memory"], r.get("frames")
    h = m["home"]
    rows = [
        ("TV", " ".join(x for x in (t["maker"], t["model"]) if x)),
        ("Android", "%s (API %s)" % (t["android"], t["sdk"])),
        ("Chip / graphics", "%s / %s" % (t["chip"] or "?", t["gpu"] or "?")),
        ("Memory", "%s MB total, %s MB available, %s MB swapped out" % (t["ram_mb"], t["available_mb"], t["swap_used_mb"])),
        ("Screen", "%s at %s dpi" % (t["screen"], t["density"])),
        ("WebView / couch-tv", "%s / %s" % (t["webview"], t["couchtv"])),
        ("Settings", "look %s, Lighter home %s, render_height %s" % (labels["look"], labels["lighter"], labels["render_height"])),
        ("Home process", "%s MB PSS (Graphics %s MB, Java heap %s MB)" % (h["pss_mb"], h["graphics_mb"], h["java_heap_mb"])),
        ("WebView renderer", "%s MB PSS in %d process(es)" % (m["renderer_pss_mb"], m["renderer_count"]) if m["renderer_count"] else "not found"),
        ("Moving focus", "about %s fps, median %s ms, 90th percentile %s ms, %s frames slower than 34 ms (of %s)" % (
            f["fps"], f["median_ms"], f["p90_ms"], f["slow_frames"], f["frames"]) if f else "not measured (no frames seen)"),
    ]
    if "cold_start_ms" in r:
        rows.append(("Cold start", "%s ms to the first frame" % r["cold_start_ms"]))
    if r.get("watch_bound") is False:
        rows.append(("Warning", "the Home button watch is not running after the restart: run apply.sh, or switch it off and on in the TV's Accessibility settings"))
    width = max(len(k) for k, _ in rows)
    return "\n".join("%s  %s" % (k.ljust(width), v) for k, v in rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Measure the couch-tv home on a TV.")
    ap.add_argument("--moves", type=int, default=3)
    ap.add_argument("--cold-start", action="store_true")
    ap.add_argument("--look", default="unknown")
    ap.add_argument("--lighter", default="unknown")
    ap.add_argument("--render-height", default="unknown")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        tv = tvadb.Tv(tvadb.connect)
    except ConnectionError as e:
        tvadb.fail(str(e))
    try:
        r = measure(tv, max(1, min(a.moves, 20)), a.cold_start)
    except RuntimeError as e:
        tvadb.fail(str(e))
    finally:
        tv.close()
    labels = {"look": a.look, "lighter": a.lighter, "render_height": a.render_height}
    if a.json:
        r["settings"] = labels
        print(json.dumps(r, indent=2))
    else:
        print(table(r, labels))
        print("\n(This has no address, network name, serial number or account in it.)")


if __name__ == "__main__":
    main()
