"""A pretend TV for the step tests: it keeps packages, switched off packages, the chosen home, the
accessibility list and the files under /data/local/tmp, and records every shell command it gets."""
import hashlib
import itertools
import re

_SERIALS = itertools.count(1)

GOOGLE_HOME = "com.google.android.apps.tv.launcherx"
WIZARD = "com.google.android.tungsten.setupwraith"
AMBIENT = "com.google.android.apps.tv.dreamx"


class FakeTv:
    def __init__(self, kind="google", disabled=(), installed=(), a11y="null", maker="Sony", sdk=34):
        self.ip = "192.0.2.10"
        self.serial = f"SER{next(_SERIALS)}"   # each pretend TV is a different TV for the records on this computer
        self.log = []
        self.maker = maker
        self.sdk = sdk
        if kind == "fire":
            self.packages = {"com.amazon.tv.launcher", "com.android.settings", "com.amazon.tv.acr"}
            self.home = "com.amazon.tv.launcher/.ui.HomeActivity"
            self.maker = "Amazon"
        elif kind == "android":
            self.packages = {"com.google.android.tvlauncher", "com.android.tv.settings"}
            self.home = "com.google.android.tvlauncher/.MainActivity"
        else:
            self.packages = {GOOGLE_HOME, WIZARD, AMBIENT, "com.android.tv.settings", "com.google.android.katniss"}
            self.home = GOOGLE_HOME + "/.home.HomeActivity"
        self.packages |= set(installed)
        self.disabled = set(disabled)
        self.chosen = None
        self.a11y = a11y
        self.files = {}
        self.front_pkg = self.home.split("/")[0]
        # Fire OS keeps Amazon's home as the chosen one whatever set-home-activity says (killy10o10's stick)
        self.refuse_home = kind == "fire"
        self.binds = True            # False: Fire OS lists the watch but does not bind it until a restart
        self.ontv_alias = False      # the on-TV app's HomeAlias is switched on
        self.other_homes = []        # other launchers installed (Projectivy...), with their own watch
        self.other_bound = []        # labels of other bound accessibility services
        self.fail_on = None
        self.app = "0.13.15"         # Couch TV's version once it is on the TV
        self.held = None             # the account link Couch TV keeps
        self.deaf = False            # True: Couch TV's SetupLink answers that it did not keep the link
        self.keys = []
        self.settings = {}           # Settings.Global values; a missing name is "null" (unset)
        self.refuse_settings = set() # names the TV ignores writes to (and deletes of)
        self.refuse_disable = set()  # packages the TV will not switch off (Fire OS protects some)
        self.gfxinfo = ""
        self.secure = {}             # Settings.Secure values for the screen saver; a missing name is "null"
        self.refuse_secure = set()   # names the TV ignores writes to
        self.dreams = ""             # what `dumpsys dreams` prints

    # what the steps call
    def prop(self, name):
        return {"ro.product.model": "TV1", "ro.product.manufacturer": self.maker, "ro.product.brand": self.maker,
                "ro.build.version.sdk": str(self.sdk), "ro.build.version.release": "14",
                "ro.serialno": self.serial, "ro.build.version.fireos": "8.0" if self.maker == "Amazon" else "",
                "ro.build.version.name": "Fire OS 8.1.8.5 (RS8185/3898)" if self.maker == "Amazon" else "14"}.get(name, "")

    def key(self, name):
        self.keys.append(name)
        if name == "HOME":
            ontv_watch = "dev.couchtv.ontv" in self.a11y
            # the alias alone only wins on a TV that lets it (Fire OS: only while its watch is on, seen on a real stick)
            if self.ontv_alias and "dev.couchtv.ontv" in self.packages and (ontv_watch or not getattr(self, "refuse_alias", False)):
                self.front_pkg = "dev.couchtv.ontv"
                return
            if "app.couchtv.launcher" in self.packages and ((self.chosen and not self.refuse_home) or (self._watch_on() and self.binds)):
                self.front_pkg = "app.couchtv.launcher"
            else:
                self.front_pkg = self.home.split("/")[0]

    def _watch_on(self):
        return "app.couchtv.launcher/.FireWatch" in self.a11y

    def install(self, path, progress=lambda f: None):
        self.log.append("INSTALL " + path)
        self.packages.add("app.couchtv.launcher" if "home" in path else "dev.couchtv.ontv")
        progress(1.0)
        return "Success"

    def shell(self, cmd, timeout_s=60):
        self.log.append(cmd)
        if self.fail_on and self.fail_on in cmd:
            from couchtv_setup.tv import TvError
            raise TvError("The TV stopped answering", "lost")
        out = []
        for part in [p.strip() for p in cmd.split(";")]:
            out.append(self._one(part))
        return "\n".join(o for o in out if o)

    def _one(self, c):
        if c.startswith("pm list packages -d"):
            return "\n".join("package:" + p for p in sorted(self.disabled & self.packages))
        if c.startswith("pm list packages"):
            return "\n".join("package:" + p for p in sorted(self.packages))
        if c.startswith("pm list features"):
            return "feature:android.software.leanback"
        if c.startswith("cmd package resolve-activity"):
            if self.ontv_alias and "dev.couchtv.ontv" in self.packages:
                return "priority=0\ndev.couchtv.ontv/dev.couchtv.ontv.HomeAlias"
            if self.chosen and self.chosen.split("/")[0] in self.packages:
                return "priority=0\n" + self.chosen
            return "priority=0\n" + self.home
        if c.startswith("pm query-activities") and "LAUNCHER" in c:
            if "LEANBACK" in c:
                return "priority=0 preferredOrder=0\ncom.netflix.ninja/.MainActivity\ncom.google.android.youtube.tv/.Main"
            return "priority=0\ncom.spotify.tv.android/.Main\ncom.netflix.ninja/.MainActivity"
        if c.startswith("pm query-activities"):
            homes = [self.home] + [p + "/.Home" for p in self.other_homes]
            if self.ontv_alias and "dev.couchtv.ontv" in self.packages:
                homes.append("dev.couchtv.ontv/dev.couchtv.ontv.HomeAlias")
            if "app.couchtv.launcher" in self.packages:
                homes.append("app.couchtv.launcher/.MainActivity")
            return "\n".join(homes)
        if c.startswith("cmd package set-home-activity"):
            act = c.split()[-1]
            if not self.refuse_home:
                self.chosen = act
            return "Success"
        if c.startswith("cmd shortcut get-default-launcher"):
            return "Launcher: ComponentInfo{" + (self.chosen or self.home) + "}"
        if c.startswith("pm disable dev.couchtv.ontv/"):
            if getattr(self, "refuse_alias", False):
                return "Exception occurred while executing 'disable':\njava.lang.SecurityException: Shell cannot change component state for dev.couchtv.ontv/dev.couchtv.ontv.HomeAlias to 2"
            self.ontv_alias = False
            return "Component enabled state changed to disabled"
        if c.startswith("pm revoke"):
            return ""
        if c.startswith("pm disable-user"):
            p = c.split()[-1]
            if p in self.refuse_disable:
                return f"Exception occurred while executing 'disable-user':\njava.lang.SecurityException: Shell cannot change state of {p}"
            self.disabled.add(p)
            return f"Package {p} new state: disabled-user"
        if c.startswith("pm enable"):
            p = c.split()[-1]
            self.disabled.discard(p)
            return f"Package {p} new state: enabled"
        if c.startswith("pm uninstall"):
            p = c.split()[-1]
            if p in self.packages:
                self.packages.discard(p)
                if self.chosen and self.chosen.startswith(p + "/"):
                    self.chosen = None
                return "Success"
            return "Failure [DELETE_FAILED_INTERNAL_ERROR]"
        if c.startswith("dumpsys package"):
            p = c.split()[2]
            if p not in self.packages:
                return ""
            flags = "flags=[ SYSTEM PERSISTENT ]" if p == "com.android.phone" else "flags=[ SYSTEM ]"
            return f"Package [{p}]\n    versionName={self.app}\n    {flags}" if "grep" not in c else f"    versionName={self.app}"
        if c.startswith(("am start", "am broadcast")):
            return self._am(c)
        if c.startswith("settings get secure enabled_accessibility_services"):
            return self.a11y
        if c.startswith("settings put secure enabled_accessibility_services"):
            self.a11y = c.split()[-1]
            return ""
        if c.startswith("settings delete secure enabled_accessibility_services"):
            self.a11y = "null"
            return ""
        m = re.match(r"settings (get|put|delete) secure (screensaver_\w+)(?: (\S+))?$", c)
        if m:
            if m.group(1) == "get":
                return self.secure.get(m.group(2), "null")
            if m.group(2) not in self.refuse_secure:
                if m.group(1) == "put":
                    self.secure[m.group(2)] = m.group(3)
                else:
                    self.secure.pop(m.group(2), None)
            return ""
        if c == "dumpsys dreams":
            return self.dreams
        m = re.match(r"settings get global (\S+)$", c)
        if m:
            return self.settings.get(m.group(1), "null")
        m = re.match(r"settings put global (\S+) (\S+)$", c)
        if m:
            if m.group(1) not in self.refuse_settings:
                self.settings[m.group(1)] = m.group(2)
            return ""
        m = re.match(r"settings delete global (\S+)$", c)
        if m:
            if m.group(1) not in self.refuse_settings:
                self.settings.pop(m.group(1), None)
            return ""
        if c.startswith("dumpsys gfxinfo") and not c.endswith("reset"):
            return self.gfxinfo
        if c.startswith("appops get"):
            return "SYSTEM_ALERT_WINDOW: default"
        if c == "dumpsys accessibility":
            labels = list(self.other_bound)
            if self.binds and "app.couchtv.launcher/.FireWatch" in self.a11y:
                labels.append("Home button watch")
            services = ",\n  ".join(f"Service[label={l}, feedbackType[FEEDBACK_GENERIC], capabilities=1, eventTypes=TYPES_ALL_MASK]"
                                     for l in labels)
            return ("ACCESSIBILITY MANAGER (dumpsys accessibility)\nUser state[\n  attributes:{id=0}\n"
                    f"  Bound services:{{{services}}}\n  Enabled services:{{{{{self.a11y}}}}}\n  Binding services:{{}}\n]")
        if c.startswith("dumpsys window") or c.startswith("dumpsys activity"):
            return f"  mCurrentFocus=Window{{1 u0 {self.front_pkg}/x}}"
        m = re.match(r"cat (\S+) 2>/dev/null", c)
        if m:
            return self.files.get(m.group(1), "")
        m = re.match(r"echo '([^']*)' > (\S+)", c)
        if m:
            self.files[m.group(2)] = m.group(1) + "\n"
            return ""
        m = re.match(r"printf '%s\\n' (.*) > (\S+)", c)
        if m:
            self.files[m.group(2)] = "\n".join(m.group(1).split()) + "\n"
            return ""
        m = re.match(r"rm -f (\S+)$", c)
        if m:
            self.files.pop(m.group(1), None)
            return ""
        if c.startswith("rm -rf /data/local/tmp/couchtv-setup"):
            self.files = {k: v for k, v in self.files.items() if not k.startswith("/data/local/tmp/couchtv-setup")}
            return ""
        return ""


    def _am(self, c):
        """What the real am answers, and what Couch TV does with the account link (0.13.13 on; SetupLink from 0.13.15)."""
        new = tuple(int(x) for x in self.app.split(".")) >= (0, 13, 15)
        link = re.search(r"--es account_link (\S+)", c)
        if c.startswith("am broadcast"):
            if not new or "app.couchtv.launcher" not in self.packages:
                return "Broadcasting: Intent { cmp=app.couchtv.launcher/.SetupLink }\nBroadcast completed: result=0"
            if self.deaf:
                return 'Broadcast completed: result=2, data="couchtv-link no"'
            self.held = link.group(1)
            return f'Broadcast completed: result=1, data="couchtv-link ok {hashlib.sha256(self.held.encode()).hexdigest()[:16]}"'
        if ".FromComputer" in c and not new:
            return "Starting: Intent { cmp=app.couchtv.launcher/.FromComputer (has extras) }\nError type 3\nError: Activity class {app.couchtv.launcher/app.couchtv.launcher.FromComputer} does not exist."
        if link and getattr(self, "no_start", False):
            return "Starting: Intent { cmp=x }\njava.lang.SecurityException: Permission Denial: starting Intent"
        if link:
            self.held = link.group(1)
        return "Starting: Intent { cmp=" + c.split("-n ")[1].split()[0] + " }"


def never_allows():
    """A TV that never lets a new computer in over Wi-Fi: it takes the connection on port 5555 but never
    shows "Allow USB debugging?" for the new key, so the wait runs out (what adb-shell raises then). Seen on a
    Toshiba (Hisense made) Google TV on Android 11, 19 November 2026."""
    from adb_shell.exceptions import AdbTimeoutError
    raise AdbTimeoutError("Never got one of the expected responses: [b'CNXN'] (transport_timeout_s = 45, read_timeout_s = 10)")
