"""A home computer with only the phone's Home settings page parts of the bridge, for the browser test
(tests/test_phone_settings_bridge_browser.mjs). The handlers, the middleware (key, origin, sizes) and the
TV home's files are the bridge's own (bridge/server.py, bridge/phonepage.py); the TV parts are left out,
so nothing here looks for or talks to a TV. Prints "PORT <n>" once it listens on 127.0.0.1.

  .venv/bin/python tests/phone_page_standin.py <data folder> <pairing key>
"""
import os
import sys

DATA, KEY = sys.argv[1], sys.argv[2]
os.environ["COUCH_DATA"] = DATA
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
from aiohttp import web  # noqa: E402
import config  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

config.PAIRING_KEY = KEY
store.DATA = DATA


async def h_quiet(request):
    """What the TV home asks for besides (now playing, apps...): nothing here, so it shows an empty home."""
    return server.ok()


def main():
    app = web.Application(middlewares=[server.middleware])
    r = app.router
    r.add_get("/api/health", server.h_health)
    r.add_post("/api/pair", server.h_pair)
    r.add_get("/api/settings", server.h_settings_get)
    r.add_post("/api/settings", server.h_settings_set)
    r.add_get("/api/guest", server.h_guest_get)
    r.add_post("/api/guest", server.h_guest_set)
    r.add_post("/api/pair/start", server.h_pair_start)
    r.add_get("/api/phone-link", server.h_phone_link)
    r.add_get("/api/athome", server.h_athome_get)
    r.add_post("/api/athome", server.h_athome_set)
    r.add_get("/api/phone/inbox", server.h_phone_inbox)
    r.add_post("/api/phone/view", server.h_phone_view)
    r.add_post("/api/phone/done", server.h_phone_done)
    r.add_post("/api/photos", server.h_photos_add)
    r.add_post("/api/photos/remove", server.h_photos_remove)
    r.add_get("/api/photo/{name}", server.h_photo_get)
    r.add_get("/setup", server.h_setup_page)
    r.add_get("/ontv/shim.js", server.h_setup_shim)
    for p in ("/api/now", "/api/apps", "/api/who", "/api/recs", "/api/continue", "/api/music", "/api/say", "/api/custom-cards", "/api/app-order", "/api/weather"):
        r.add_get(p, h_quiet)
    r.add_post("/api/who", h_quiet)
    r.add_route("OPTIONS", "/api/{tail:.*}", server.h_options)
    r.add_route("*", "/api/{tail:.*}", server.h_api_missing)
    r.add_get("/tv/config.js", server.h_tv_config_js)
    r.add_get("/tv/{path:.*}", server.static_handler(server.LAUNCHER_DIR, "TV home screen"))

    async def told(_):
        site = list(runner.sites)[0]
        print("PORT", site._server.sockets[0].getsockname()[1], flush=True)

    runner = web.AppRunner(app, access_log=None)

    async def go():
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        await told(None)
        import asyncio
        await asyncio.Event().wait()
    import asyncio
    asyncio.run(go())


if __name__ == "__main__":
    main()
