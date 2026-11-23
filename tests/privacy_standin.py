"""A pretend TV for tests/test_privacy_clean.py. apply.sh and undo.sh run it as their Python
("$PY" "$T" ...), so it stands in for tv-home/tools/tvadb.py and home-config.py. It never talks to a
real TV. The TV's packages live in a JSON file (PRIVACY_STANDIN): "present", "disabled", "homes"
(packages with a HOME activity) and "persistent". Every shell command is logged in "log"."""
import json
import os
import sys

STATE = os.environ["PRIVACY_STANDIN"]


def load():
    with open(STATE) as f:
        return json.load(f)


def save(s):
    with open(STATE, "w") as f:
        json.dump(s, f)


def shell(cmd, s):
    s["log"].append(cmd)
    if cmd == "pm list packages -d":
        return "".join("package:%s\n" % p for p in s["disabled"])
    if cmd == "pm list packages":
        return "".join("package:%s\n" % p for p in s["present"])
    if cmd.startswith(("pm query-activities", "cmd package query-activities")):
        return "".join("%s/.Home\n" % p for p in s["homes"])
    if cmd.startswith("dumpsys package "):
        p = cmd.split()[-1]
        return "  pkgFlags=[ SYSTEM %s]\n" % ("PERSISTENT " if p in s["persistent"] else "")
    if cmd.startswith("pm disable-user --user 0 "):
        p = cmd.split()[-1]
        if p not in s["disabled"]:
            s["disabled"].append(p)
        return "Package %s new state: disabled-user\n" % p
    if cmd.startswith("pm enable "):
        p = cmd.split()[-1]
        if p in s["disabled"]:
            s["disabled"].remove(p)
        return "Package %s new state: enabled\n" % p
    if cmd.startswith("cmd shortcut get-default-launcher"):
        return "Launcher: ComponentInfo{app.couchtv.launcher/app.couchtv.launcher.MainActivity}\n"
    if cmd.startswith("cmd package resolve-activity"):
        return "priority=0\napp.couchtv.launcher/.MainActivity\n"
    if cmd.startswith("dumpsys window"):
        return "  mCurrentFocus=Window{1 u0 app.couchtv.launcher/app.couchtv.launcher.MainActivity}\n"
    if cmd.startswith("settings get"):
        return "null\n"
    return ""


def main():
    args = sys.argv[1:]
    if args and args[0].endswith("home-config.py"):
        print("none")
        return
    if not args or not args[0].endswith("tvadb.py"):
        sys.exit("privacy_standin: unexpected call %r" % args)
    s = load()
    cmd = args[1]
    if cmd == "shell":
        sys.stdout.write(shell(args[2], s))
    elif cmd in ("install", "keys"):
        s["log"].append(cmd)
    save(s)


if __name__ == "__main__":
    main()
