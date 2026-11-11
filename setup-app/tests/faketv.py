"""A pretend TV for the step tests: it keeps packages, switched off packages, the chosen home, the
accessibility list and the files under /data/local/tmp, and records every shell command it gets."""
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
        self.other_homes = []        # other launchers installed (Projectivy...), with their own watch
        self.other_bound = []        # labels of other bound accessibility services
        self.fail_on = None
        self.keys = []

    # what the steps call
    def prop(self, name):
        return {"ro.product.model": "TV1", "ro.product.manufacturer": self.maker, "ro.product.brand": self.maker,
                "ro.build.version.sdk": str(self.sdk), "ro.build.version.release": "14",
                "ro.serialno": self.serial, "ro.build.version.fireos": "8.0" if self.maker == "Amazon" else "",
                "ro.build.version.name": "Fire OS 8.1.8.5 (RS8185/3898)" if self.maker == "Amazon" else "14"}.get(name, "")

    def key(self, name):
        self.keys.append(name)
        if name == "HOME":
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
            if self.chosen and self.chosen.split("/")[0] in self.packages:
                return "priority=0\n" + self.chosen
            return "priority=0\n" + self.home
        if c.startswith("pm query-activities"):
            homes = [self.home] + [p + "/.Home" for p in self.other_homes]
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
        if c.startswith("pm disable-user"):
            p = c.split()[-1]
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
            return f"Package [{p}]\n    versionName=0.12\n    {flags}" if "grep" not in c else "    versionName=0.12"
        if c.startswith("settings get secure enabled_accessibility_services"):
            return self.a11y
        if c.startswith("settings put secure enabled_accessibility_services"):
            self.a11y = c.split()[-1]
            return ""
        if c.startswith("settings delete secure enabled_accessibility_services"):
            self.a11y = "null"
            return ""
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
