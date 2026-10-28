"""One-time setup of a TV listed in config.json.

Run it with someone standing at that TV, because the TV shows things on screen.

Step 1, remote pairing. The TV shows a 6 character code when pairing starts.

    .venv/bin/python bridge/pair_tv.py living-room                 # a person types the code here

An AI agent has no keyboard to type into, so it does it in two runs:

    .venv/bin/python bridge/pair_tv.py living-room                 # run in the background: the TV
                                                                   # shows a code and this waits
    .venv/bin/python bridge/pair_tv.py living-room --code 1A2B3C   # the code the person read off
                                                                   # the TV; prints the result

The second run hands the code to the first and exits 0 when the TV accepted it. A code only works
for the pairing that showed it, so never reuse one from an earlier run. Makes a certificate for
this computer on first use (bridge/data/cert.pem), then marks the TV "paired": true in config.json.

Step 2, ADB (optional, for opening shows by deep link, screenshots, picture mode, now playing):
Developer options and USB debugging on, plus Network debugging if the TV has that switch (README
step 1), then re-run with --adb: the TV asks
"Allow USB debugging?"; tick "Always allow from this computer" and press OK. The port is the TV's
"adb_port" in config.json, else ADB_PORT, else 5555.

Afterwards restart the bridge (see README.md).
"""
import asyncio
import os
import socket
import sys
import time

from androidtvremote2 import AndroidTVRemote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
import config
CERT, KEY = os.path.join(config.DATA, "cert.pem"), os.path.join(config.DATA, "key.pem")
WAIT_S = 600


def load():
    return {"tvs": config.TVS}


def resolve(cfg):
    """The TV's IP. An empty "host" counts as none (resolving "" gives this computer, not the TV)."""
    host = (cfg.get("host") or "").strip()
    if host:
        try:
            return socket.gethostbyname(host)
        except OSError:
            pass
    return cfg["ip"]


def arg(name):
    """The value after --name on the command line, or None."""
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1].strip()
    return None


def files(tv_id):
    d = config.DATA
    return (os.path.join(d, f"pair-code-{tv_id}.txt"), os.path.join(d, f"pair-waiting-{tv_id}.txt"),
            os.path.join(d, f"pair-result-{tv_id}.txt"))


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def _remove(*paths):
    for p in paths:
        try:
            os.remove(p)
        except FileNotFoundError:
            pass


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def give_code(cfg, code):
    """Hand a code to the pairing run that is waiting for it, then report what the TV said."""
    code_file, waiting, result = files(cfg["id"])
    try:
        pid = int(open(waiting).read().strip() or 0)
    except (FileNotFoundError, ValueError):
        pid = 0
    if not pid or not _alive(pid):
        print("No pairing is waiting for a code. Start one first (it shows a code on the TV):\n"
              f"  .venv/bin/python bridge/pair_tv.py {cfg['id']}\n"
              "then run this again with the code that is on the TV now.")
        return False
    _remove(result)
    _write(code_file, code)
    for _ in range(90):
        if os.path.exists(result):
            text = open(result).read().strip()
            print(text)
            return text.startswith("ok")
        time.sleep(1)
    print("The pairing run did not answer within 90 seconds. Check its output.")
    return False


async def pair(cfg):
    code_file, waiting, result = files(cfg["id"])
    host = resolve(cfg)
    remote = AndroidTVRemote(config.CLIENT_NAME, CERT, KEY, host)
    await remote.async_generate_cert_if_missing()
    name, mac = await remote.async_get_name_and_mac()
    print(f"Found {name} at {host} (MAC {mac}).")
    _remove(code_file, result)
    await remote.async_start_pairing()
    _write(waiting, str(os.getpid()))
    print(f"A code is on the TV now. Type it and press Enter, or run:\n"
          f"  .venv/bin/python bridge/pair_tv.py {cfg['id']} --code <the code>", flush=True)
    loop = asyncio.get_running_loop()
    interactive = sys.stdin is not None and sys.stdin.isatty()
    typed = loop.run_in_executor(None, sys.stdin.readline) if interactive else None
    code = None
    try:
        for _ in range(WAIT_S):
            if typed and typed.done() and typed.result().strip():
                code = typed.result().strip()
                break
            if os.path.exists(code_file) and open(code_file).read().strip():
                code = open(code_file).read().strip()
                break
            await asyncio.sleep(1)
        if not code:
            print("No code within 10 minutes. Nothing changed.")
            _write(result, "error: no code within 10 minutes. Nothing changed.")
            return False
        try:
            await remote.async_finish_pairing(code)
        except Exception as e:
            msg = (f"error: the TV did not accept {code} ({type(e).__name__}). Nothing changed. "
                   "Start again: the TV shows a fresh code each time.")
            print(msg)
            _write(result, msg)
            remote.disconnect()
            return False
        await remote.async_connect()
        print("Paired and connected. TV reports", "on" if remote.is_on else "standby")
        remote.disconnect()
        for t in load()["tvs"]:
            if t["id"] == cfg["id"]:
                t["paired"] = True
                t["ip"] = host
                if mac and not t.get("mac"):
                    t["mac"] = mac.lower()
        config.save_tvs()
        print(f"Saved: {cfg['id']} is paired in config.json.")
        _write(result, f"ok: {cfg['id']} is paired.")
        return True
    finally:
        _remove(waiting, code_file)


async def adb_check(cfg):
    from adb_shell.adb_device_async import AdbDeviceTcpAsync
    from adb_shell.auth.sign_pythonrsa import PythonRSASigner
    from tv import ensure_adb_key
    key = ensure_adb_key()
    signer = PythonRSASigner(open(key + ".pub").read(), open(key).read())
    port = config.adb_port(cfg)
    dev = AdbDeviceTcpAsync(resolve(cfg), port, default_transport_timeout_s=9)
    print(f"Connecting over ADB (port {port}). If the TV asks \"Allow USB debugging?\", tick Always allow and OK.")
    try:
        ok = await dev.connect(rsa_keys=[signer], auth_timeout_s=60)
    except Exception as e:
        print(f"ADB did not connect on port {port} ({type(e).__name__}). Is USB debugging on (and Network debugging, if the TV has it)? "
              "TVs with only Wireless debugging: see README step 1.")
        return False
    if ok:
        print("ADB works:", (await dev.shell("getprop ro.product.model")).strip())
    await dev.close()
    return ok


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print(__doc__)
        sys.exit(1)
    tv_id = sys.argv[1]
    cfg = next((t for t in load()["tvs"] if t["id"] == tv_id), None)
    if not cfg:
        sys.exit(f"unknown tv {tv_id}; see config.json")
    if "--adb" in sys.argv:
        ok = asyncio.run(adb_check(cfg))
    elif arg("--code"):
        ok = give_code(cfg, arg("--code"))
    else:
        ok = asyncio.run(pair(cfg))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
