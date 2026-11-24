"""The menu bar item (Mac, rumps) and the tray icon (Windows and Linux, pystray). Both are optional
imports: when one is missing, or the desktop has no tray (GNOME without the AppIndicator extension),
run() says False and app.py shows the same menu as a local browser page instead.
"""
import sys
import webbrowser

from . import menu

COLOURS = {"green": (46, 160, 67), "amber": (230, 160, 20), "grey": (140, 140, 140)}
CONFIRM = {"off": ("Turn off extra features?", "Couch TV stays on your TV. The helper stops and will not start with this computer."),
           "remove": ("Remove everything from this computer?", "This deletes the TV key, settings and downloads kept here. Couch TV stays on your TV.")}


def icon_image(colour):
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((6, 14, 58, 46), 6, outline=(235, 235, 235), width=5)
    d.ellipse((38, 38, 62, 62), fill=COLOURS[colour] + (255,), outline=(20, 20, 20), width=2)
    return img


def run(ctl, fallback_url=None):
    """Shows the tray and blocks until Quit. False when there is no tray to show."""
    try:
        if sys.platform == "darwin":
            return _run_rumps(ctl)
        return _run_pystray(ctl, fallback_url)
    except Exception as e:   # no library, no display, no tray host: use the browser page
        print("No tray available (%s: %s). Using the browser page." % (type(e).__name__, e))
        return False


def _run_rumps(ctl):
    import rumps   # noqa: only on a Mac

    app = rumps.App("Couch TV Helper", title="Couch TV", quit_button=None)

    def pick(item):
        if item.id in CONFIRM:
            if not rumps.alert(CONFIRM[item.id][0], CONFIRM[item.id][1], ok="Continue", cancel="Cancel"):
                return
        ctl.act(item.id)
        if ctl.quit_event.is_set():
            rumps.quit_application()

    def refresh(_=None):
        items = ctl.items()
        app.menu.clear()
        for it in items:
            if it["id"] == "-":
                app.menu.add(rumps.separator)
                continue
            m = rumps.MenuItem(it["label"], callback=pick if it.get("enabled") else None)
            m.id = it["id"]
            m.state = 1 if it.get("checked") else 0
            app.menu.add(m)

    refresh()
    rumps.Timer(refresh, 5).start()
    app.run()
    return True


def _run_pystray(ctl, fallback_url):
    import pystray   # noqa: Windows and Linux

    def confirm(item_id):
        try:
            import tkinter
            from tkinter import messagebox
            root = tkinter.Tk()
            root.withdraw()
            ok = messagebox.askokcancel(*CONFIRM[item_id])
            root.destroy()
            return ok
        except Exception:
            if fallback_url:
                webbrowser.open(fallback_url)   # the page asks there
            return False

    def make_callback(item_id):
        def cb(icon, _item):
            if item_id in CONFIRM and not confirm(item_id):
                return
            ctl.act(item_id)
            if ctl.quit_event.is_set():
                icon.stop()
        return cb

    def entries():
        out = []
        for it in ctl.items():
            if it["id"] == "-":
                out.append(pystray.Menu.SEPARATOR)
            else:
                out.append(pystray.MenuItem(it["label"], make_callback(it["id"]), enabled=bool(it.get("enabled")),
                                            checked=(lambda _i, v=it["checked"]: v) if "checked" in it else None))
        return tuple(out)

    state = ctl.state()
    icon = pystray.Icon("couch-tv-helper", icon_image(menu.dot(state)), "Couch TV Helper", pystray.Menu(entries))
    if not icon.HAS_MENU and False:   # pragma: no cover
        return False

    def poll(icon):
        icon.visible = True
        while not ctl.quit_event.wait(5):
            s = ctl.state()
            icon.icon = icon_image(menu.dot(s))
            icon.update_menu()

    icon.run(setup=lambda i: __import__("threading").Thread(target=poll, args=(i,), daemon=True).start())
    return True
