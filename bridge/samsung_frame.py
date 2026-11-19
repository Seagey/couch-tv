"""Samsung, the parts about switching on and off (docs/SAMSUNG.md, "Turning it on" and "Frame TVs").

samsung.SamsungTV with three changes, used for every "kind": "samsung" TV (server.py makes this
class instead of samsung.SamsungTV):

1. Opening couch-tv after Art Mode or standby. The TV is only treated as switched on once it has
   said so twice in a row within HOOK_SETTLE seconds: powered on and, on a Frame, out of Art Mode.
   A Frame leaving Art Mode can say "standby" for a moment on its way to the picture, and one whose
   Art Mode sleep timer ran out says "standby" and stays there. The first is opened, the second is
   left alone. A 19 Nov 2026 beginner test saw the old one-look check take a Frame being switched
   on from the phone for one going to sleep, and couch-tv never opened.
   A switch-on that turned out to be a TV going to sleep does not use up the hook: the next real
   switch-on is still seen.
2. The TV's network (MAC) address for Wake-on-LAN is learnt from the TV itself (its Wi-Fi MAC in
   http://<tv>:8001/api/v2/) and kept in data/samsung-<id>-mac.txt, so "mac" in config.json is no
   longer needed and a bridge restarted while the TV is off still knows it.
3. "On" from the phone never hangs. With no address to wake, or no answer WAKE_GIVE_UP seconds after
   the first wake packet, the phone is told at once to use the TV's remote (the TV's "Power On with
   Mobile" setting is what lets a Samsung on Wi-Fi wake from the network at all).

"Off" from the phone on a Frame is one press of power, which is Art Mode, as the Frame's own remote
does (server.py h_power). Nothing here holds power, so a Frame is never switched fully off.
"""
import asyncio
import logging
import os
import re
import time

import config
import samsung
from tv import TVUnavailable

HOOK_SETTLE = 15.0    # seconds the hook waits for the TV to say it is really on (a 2021 Frame took 9)
HOOK_STEP = 1.0
WAKE_GIVE_UP = 14.0   # seconds of wake packets before the phone is told to use the TV's remote
MAC = re.compile(r"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$")

log = logging.getLogger("samsung_frame")


class SamsungTV(samsung.SamsungTV):
    def __init__(self, cfg):
        super().__init__(cfg)
        self.mac_file = os.path.join(config.DATA, f"samsung-{self.id}-mac.txt")
        if not self.mac:
            self.mac = self._kept_mac()
        self._hook_busy = False
        self._wake_first = None
        self._wake_last = 0.0

    # ---------- the TV's own MAC address ----------
    def _kept_mac(self):
        try:
            with open(self.mac_file) as f:
                m = f.read().strip()
            return m if MAC.match(m) else None
        except OSError:
            return None

    def _learn_mac(self, dev):
        # the device field whose name ends in Mac (the Wi-Fi one on every Samsung seen so far)
        m = next((str(v).strip() for k, v in (dev or {}).items() if str(k).lower().endswith("mac") and v), "")
        if self.mac or not MAC.match(m) or m.replace(":", "").replace("-", "") in ("000000000000", "FFFFFFFFFFFF", "ffffffffffff"):
            return
        self.mac = m
        try:
            os.makedirs(os.path.dirname(self.mac_file), exist_ok=True)
            with open(self.mac_file, "w") as f:
                f.write(m)
        except OSError as e:
            log.info("could not keep the TV's address for waking it: %s", e)

    async def _read_device(self):
        try:
            j = await self._get_json("/api/v2/", timeout=2)
            dev = (j or {}).get("device") or {}
            self.power = dev.get("PowerState") or "on"   # older TVs leave it out and only answer when on
            self.frame = str(dev.get("FrameTVSupport")).lower() == "true"
            self._learn_mac(dev)
            return True
        except Exception:
            self.power = None
            return False

    # ---------- the hook ----------
    def _really_on(self):
        return self.power == "on" and not (self.frame and self.art_mode is True)

    async def _settled_on(self):
        """True once the TV says twice in a row that it is on (and out of Art Mode); False when
        it does not within HOOK_SETTLE seconds (it went to sleep, or back to Art Mode)."""
        end = time.monotonic() + HOOK_SETTLE
        in_a_row = 0
        while time.monotonic() < end:
            if await self._read_device() and self._really_on():
                in_a_row += 1
                if in_a_row >= 2:
                    return True
            else:
                in_a_row = 0
            await asyncio.sleep(HOOK_STEP)
        return False

    async def _hook(self):
        """The TV may just have come on. Once it has settled on, if nothing else is on screen,
        open couch-tv."""
        if not self.open_on_power_on or self._hook_busy:
            return
        if time.monotonic() - self._hook_at < 15:
            return   # the art channel and the watcher both saw the same switch-on
        if time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        self._hook_busy = True
        try:
            if not await self._settled_on():
                if self.frame:
                    self._note("Art Mode ended and the TV went to sleep, left alone")
                else:
                    self._note("TV did not stay on, left alone")
                return   # not a switch-on: the next real one is still seen
            self._hook_at = time.monotonic()
            if time.monotonic() < self.quiet_until:   # a phone command landed while it settled
                self._note("TV came on, left alone (a command is running)")
                return
            front = await self._front()
            if front == self.app_id:
                self._note("TV came on, couch-tv already open")
                return
            if front:
                self._note(f"TV came on in {self._package_of(front)}, left alone")
                return
            await self._open_couch()   # up to three tries: the TV can refuse just after Art Mode
        finally:
            self._hook_busy = False

    # ---------- switching on from the phone ----------
    async def wake(self):
        """Wake-on-LAN. server.py's power_on sends one every 2 seconds while the TV is off the
        network; this ends that early, so the phone hears "use the TV's remote" within seconds."""
        now = time.monotonic()
        if self._wake_first is None or now - self._wake_last > 10:
            self._wake_first = now   # a new "on", not the next packet of the same one
        self._wake_last = now
        if not self.mac or not self.wake_on_lan:
            raise TVUnavailable("the TV did not wake over the network (turn it on with its remote)",
                                key="err_tv_did_not_wake")
        if now - self._wake_first > WAKE_GIVE_UP and not self.connected:
            # this "on" is over: the next tap is a new one and sends a packet again, even within 10 s
            self._wake_first = None
            raise TVUnavailable("the TV did not wake over the network (turn it on with its remote)",
                                key="err_tv_did_not_wake")
        await super().wake()
