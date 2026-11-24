"""Two things Setup measures on a connected TV, so Couch TV Studio knows the real TV (owner, 24 Nov 2026):

1. speed_test(): a short speed test while the Couch TV home is on screen. Android's own frame
   counters for the home (dumpsys gfxinfo, reset first, then read after a few seconds of the
   scenes moving), plus the chip (cores, top clock, SoC name) and the graphics renderer. It turns
   into a measured speed class (a to d, Studio's classes in tvs.js) that the speed bar can use
   instead of its estimate. Read only, except that it presses nothing and only resets the home's
   own frame counters.

2. health_report(): only when the person presses "Send a health report" and says yes. Couch TV's
   versions, free storage, memory, the last Couch TV crash or "not responding" summary (first lines
   only), whether the TV reaches the internet, and recent log lines from Couch TV's own process only
   (never another app's), with addresses, e-mail addresses and long tokens blanked out.
"""
import re
import time

HOME_PKG = "app.couchtv.launcher"
ONTV_PKG = "dev.couchtv.ontv"

# ---- 1. speed ----


def parse_gfxinfo(out):
    """Frames, janky frames and the 50th, 90th and 99th percentile frame times (ms) from dumpsys gfxinfo."""
    def num(pattern, cast=int):
        m = re.search(pattern, out or "")
        return cast(m.group(1)) if m else None
    return {"frames": num(r"Total frames rendered:\s*(\d+)"),
            "janky": num(r"Janky frames:\s*(\d+)"),
            "p50": num(r"50th percentile:\s*(\d+)ms"),
            "p90": num(r"90th percentile:\s*(\d+)ms"),
            "p99": num(r"99th percentile:\s*(\d+)ms")}


def parse_chip(cpuinfo, maxfreqs, soc="", hardware=""):
    """Cores (from /proc/cpuinfo "processor" lines), the top clock in MHz (from cpuinfo_max_freq, kHz),
    and the chip's name when Android says it (ro.soc.model, else ro.hardware)."""
    cores = len(re.findall(r"(?m)^processor\s*:", cpuinfo or "")) or None
    freqs = [int(x) for x in re.findall(r"\b(\d{5,8})\b", maxfreqs or "")]
    return {"cores": cores, "mhz": max(freqs) // 1000 if freqs else None,
            "soc": (soc or hardware or "").strip()[:40] or None}


def parse_gpu(surfaceflinger):
    m = re.search(r"GLES:\s*([^\n]+)", surfaceflinger or "")
    return m.group(1).strip()[:80] if m else None


def measured_class(frames):
    """Studio's speed classes from how the home really drew: the 90th percentile frame time while the
    scenes moved. At 60 frames a second a frame has 16.7 ms. Too few frames says nothing: None."""
    if not frames or not frames.get("frames") or frames["frames"] < 30 or frames.get("p90") is None:
        return None
    p90 = frames["p90"]
    if p90 <= 17:
        return "d" if (frames.get("janky") or 0) <= frames["frames"] * 0.02 else "c"
    if p90 <= 24:
        return "c"
    if p90 <= 40:
        return "b"
    return "a"


def speed_test(tv, seconds=8, sleep=time.sleep):
    """Runs with the Couch TV home on screen (just after setup). Returns the "speed" part of the TV
    profile: {"measured": true, "cls", "frames", "janky", "p50", "p90", "p99", "seconds", "cores",
    "mhz", "soc", "gpu"}; "cls" is None when the home drew too few frames to say."""
    tv.shell(f"dumpsys gfxinfo {HOME_PKG} reset")
    sleep(seconds)
    frames = parse_gfxinfo(tv.shell(f"dumpsys gfxinfo {HOME_PKG}"))
    chip = parse_chip(tv.shell("cat /proc/cpuinfo"),
                      tv.shell("cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq"),
                      tv.prop("ro.soc.model"), tv.prop("ro.hardware"))
    out = {"measured": True, "cls": measured_class(frames), "seconds": seconds}
    out.update(frames)
    out.update(chip)
    out["gpu"] = parse_gpu(tv.shell("dumpsys SurfaceFlinger | grep -m1 GLES"))
    return out


# ---- 2. health report ----

SCRUB = [
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "<address>"),
    (re.compile(r"\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b", re.I), "<address>"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b", re.I), "<mac>"),
    (re.compile(r"https?://\S+"), "<link>"),
    (re.compile(r"\b[A-Za-z0-9_\-]{24,}\b"), "<token>"),
]


def scrub(line):
    for rx, sub in SCRUB:
        line = rx.sub(sub, line)
    return line[:300]


def crash_summary(dropbox, pkg_prefix="app.couchtv"):
    """The first lines of the newest crash or "not responding" entry that belongs to a Couch TV app, from
    dumpsys dropbox --print. Entries of other apps are skipped whole."""
    entries = re.split(r"(?m)^={5,}[ \t]*$", dropbox or "")
    ours = [e for e in entries if re.search(rf"(?m)^Process:\s*({re.escape(pkg_prefix)}|dev\.couchtv)", e)]
    if not ours:
        return None
    lines = [l for l in ours[-1].strip().splitlines() if l.strip()][:8]
    return [scrub(l) for l in lines]


def free_mb(df):
    """Free space on /data in MB, from df -k /data."""
    for line in (df or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 4 and parts[3].isdigit():
            return int(parts[3]) // 1024
    return None


def health_report(tv, versions):
    """Collects the report (read only). versions: {"home": "0.13.12", "ontv": None}."""
    def ask(cmd):
        try:
            return tv.shell(cmd)
        except Exception:
            return ""
    from .tvprofile import mem_mb
    meminfo = ask("cat /proc/meminfo")
    avail = re.search(r"MemAvailable:\s+(\d+)", meminfo)
    pid = ask(f"pidof {HOME_PKG}").strip().split()
    log = ask(f"logcat -d -t 200 --pid={pid[0]}") if pid and pid[0].isdigit() else ""
    online = "1 received" in ask("ping -c 1 -W 2 1.1.1.1") or " 0% packet loss" in ask("ping -c 1 -W 2 8.8.8.8")
    return {
        "v": 1, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "couchtv": versions, "android": tv.prop("ro.build.version.release"), "sdk": tv.prop("ro.build.version.sdk"),
        "memMb": mem_mb(meminfo), "memFreeMb": int(avail.group(1)) // 1024 if avail else None,
        "storageFreeMb": free_mb(ask("df -k /data")),
        "running": bool(pid and pid[0].isdigit()),
        "crash": crash_summary(ask("dumpsys dropbox --print data_app_crash")),
        "anr": crash_summary(ask("dumpsys dropbox --print data_app_anr")),
        "online": online,
        "log": [scrub(l) for l in log.splitlines()[-200:] if l.strip()],
    }
