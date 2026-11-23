"""Deep link test run against the real TV, through the running bridge.

For each app: open the JustWatch link, wait, note the app in front, save a screenshot, go home.
Usage: TV_IP=<tv address> ../.venv/bin/python test_deeplinks.py [case ...]   (screenshots land in data/deeplink-shots/)
Results are written up by hand in DEEPLINKS.md after looking at the screenshots.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

# These scripts drive a REAL TV through a running bridge (they play shows and write watch history).
# They refuse to run unless asked on purpose, so an agent running "all the tests" never fires them.
if os.environ.get("COUCHTV_REAL_TV") != "1":
    sys.exit("This drives a real TV. Set COUCHTV_REAL_TV=1 to run it on purpose.")


BRIDGE = "http://127.0.0.1:5400"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "deeplink-shots")

CASES = {
    "netflix": "intent://www.netflix.com/watch/80057281#Intent;launchFlags=0x00800000;scheme=https;package=com.netflix.ninja;S.source=30;end",
    "netflix-title": "https://www.netflix.com/title/80057281",
    "youtube": "https://www.youtube.com/watch?v=brZCOVlyPPo",
    "stan": "intent://programs/2844905#Intent;launchFlags=0x00800000;scheme=stan;end",
    "binge": "intent://binge.com.au/en-AU/show-detail/audio-description-colin-from-accounts/ArticleId:3udxzgxd8zfk13su9kz71t#Intent;scheme=https;end",
    "abc-iview": "intent://video/CH2003Q004S00#Intent;launchFlags=0x00800000;scheme=iview;end",
    "sbs-on-demand": "intent://ondemand/search/2172633667829#Intent;scheme=tvrecommendation;component=com.sbs.ondemand.tv/.recommendations.AppLinkActivity;end",
    "disney-plus": "intent://www.disneyplus.com/play/60da223c-d2a0-411a-95c9-665a839371f9#Intent;launchFlags=0x00800000;scheme=https;end",
    "prime-video": "intent://app.primevideo.com/detail?gti=amzn1.dv.gti.9ab600aa-6625-b547-cfc0-190e3ad8a27d&territory=AU#Intent;package=com.amazon.amazonvideo.livingroom;scheme=https;end",
    "apple-tv": "intent://tv.apple.com/au/show/bluey/umc.cmc.3ez94w3cvm4oeo9rugqsu6dx1#Intent;launchFlags=0x00800000;scheme=https;end",
    "9now": "intent://the-block/season-1/episode-1#Intent;scheme=ninenow;package=au.com.ninenow.ctv;end",
    "10play": "intent://tv/open?show_id=926193&video_id=1299456#Intent;scheme=tenplay;component=au.com.tenplay/.DeeplinkActivity;end",
}


ADB = os.environ.get("ADB", "adb")   # the adb program (Android platform-tools)


def front():
    out = subprocess.run([ADB, "-s", os.environ["TV_IP"] + ":" + (os.environ.get("ADB_PORT") or "5555"), "shell", "dumpsys", "activity", "activities"],
                         capture_output=True, text=True, timeout=15).stdout
    m = re.search(r"topResumedActivity=ActivityRecord\{\S+ u0 (\S+)", out)
    return m.group(1).rstrip("}") if m else None


def call(method, path, payload=None, raw=False):
    req = urllib.request.Request(BRIDGE + path, method=method,
                                 data=json.dumps(payload).encode() if payload else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        body = e.read()
    return body if raw else json.loads(body)


def main(names):
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        link = CASES[name]
        r = call("POST", "/api/launch", {"app": link})
        time.sleep(3)
        at3 = front()
        time.sleep(5)
        at8 = front()
        png = call("GET", "/api/screenshot", raw=True)
        path = os.path.join(OUT, f"{name}.png")
        with open(path, "wb") as f:
            f.write(png)
        print(json.dumps({"case": name, "launch_ok": r.get("ok"), "error": r.get("error"),
                          "front_3s": at3, "front_8s": at8, "shot": os.path.basename(path)}), flush=True)
        call("POST", "/api/key", {"key": "back"})
        time.sleep(1)
        call("POST", "/api/key", {"key": "home"})
        time.sleep(3)


if __name__ == "__main__":
    main(sys.argv[1:] or list(CASES))
