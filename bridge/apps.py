"""App catalogue for the living room TV.

`jw` lists the JustWatch package names (technicalName) that map to this app, so the show finder
knows which app opens which offer. `deeplink` says how a show opens in it, as tested on this TV
(see DEEPLINKS.md): "jw" means the JustWatch Android TV intent works, "search" means open the app
and search, "app" means only the app opens. `use_web` (a regex) opens the JustWatch web link cut
down to the show page instead of the intent; `cold` restarts the app first so it takes the link
("background" restarts it only when it is not on screen). `verify` waits until the app says it is
really playing before the bridge says so.
"""

APPS = [
    # Netflix left in the background for a while asks "Who's watching?" when a link brings it
    # back, and then drops the show. Started fresh it goes straight
    # to the show, resumed where the profile was up to, in about 20 s (DEEPLINKS.md).
    {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja", "colour": "#E50914",
     "jw": ["netflix", "netflixbasicwithads", "netflixkids"], "deeplink": "jw",
     "cold": "background", "verify": True},
    {"id": "youtube", "name": "YouTube", "package": "com.google.android.youtube.tv", "colour": "#FF0000",
     "jw": ["youtubered", "youtube"], "deeplink": "jw"},
    {"id": "stan", "name": "Stan", "package": "au.com.stan.and", "colour": "#0072F5",
     "jw": ["stan"], "deeplink": "jw"},
    {"id": "binge", "name": "Binge", "package": "au.com.streamotion.ares.tv", "colour": "#1E1EFF",
     "jw": ["binge"], "deeplink": "search"},
    {"id": "abc-iview", "name": "ABC iview", "package": "au.net.abc.iview", "colour": "#00C3A5",
     "jw": ["iview"], "deeplink": "jw"},
    {"id": "sbs-on-demand", "name": "SBS On Demand", "package": "com.sbs.ondemand.tv", "colour": "#FFCC00",
     "jw": ["sbsondemand"], "deeplink": "jw", "use_web": r"(https://www\.sbs\.com\.au/ondemand/[^/]+/[^/?#]+)",
     "cold": True},
    {"id": "disney-plus", "name": "Disney+", "package": "com.disney.disneyplus", "colour": "#113CCF",
     "jw": ["disneyplus"], "deeplink": "jw"},
    {"id": "prime-video", "name": "Prime Video", "package": "com.amazon.amazonvideo.livingroom",
     "colour": "#00A8E1", "jw": ["amazonprimevideo", "amazon"], "deeplink": "jw"},
    {"id": "apple-tv", "name": "Apple TV", "package": "com.apple.atve.androidtv.appletv", "colour": "#111111",
     "jw": ["appletvplus", "itunes"], "deeplink": "jw"},
    {"id": "paramount-plus", "name": "Paramount+", "package": "com.cbs.ca", "colour": "#0064FF",
     "jw": ["paramountplus", "paramountpluspremium", "paramountplusbasicwithads"], "deeplink": "jw"},
    {"id": "kayo", "name": "Kayo", "package": "au.com.kayosports.tv", "colour": "#00E676",
     "jw": [], "deeplink": "app"},
    {"id": "foxtel-go", "name": "Foxtel Go", "package": "au.com.foxtel.atv", "colour": "#F05A28",
     "jw": [], "deeplink": "app"},
    {"id": "9now", "name": "9Now", "package": "au.com.ninenow.ctv", "colour": "#00A9E0",
     "jw": ["ninenow"], "deeplink": "jw"},
    {"id": "7plus", "name": "7plus", "package": "com.swm.live", "colour": "#E4002B",
     "jw": ["sevenplus"], "deeplink": "jw"},
    {"id": "10play", "name": "10play", "package": "au.com.tenplay", "colour": "#0B0B0B",
     "jw": ["tenplay"], "deeplink": "jw"},
    {"id": "hbo-max", "name": "HBO Max", "package": "com.wbd.stream", "colour": "#002BE7",
     "jw": ["max", "hbomax"], "deeplink": "search"},
    {"id": "google-tv", "name": "Google TV", "package": "com.google.android.videos", "colour": "#4285F4",
     "jw": ["play", "googleplaymovies"], "deeplink": "app"},
    {"id": "twitch", "name": "Twitch", "package": "tv.twitch.android.app", "colour": "#9146FF",
     "jw": [], "deeplink": "app"},
    {"id": "spotify", "name": "Spotify", "package": "com.spotify.tv.android", "colour": "#1DB954",
     "jw": [], "deeplink": "app"},
    {"id": "moonlight", "name": "Moonlight", "package": "com.limelight", "colour": "#2A2A2A",
     "jw": [], "deeplink": "app"},
    {"id": "settings", "name": "Settings", "package": "com.android.tv.settings", "colour": "#5F6368",
     "jw": [], "deeplink": "app"},
    {"id": "home", "name": "Home", "package": "app.couchtv.launcher", "colour": "#000000",
     "jw": [], "deeplink": "app"},
]

# Samsung (Tizen) app ids, for a TV with "kind": "samsung" (bridge/samsung.py, docs/SAMSUNG.md).
# "ids": the ids the Samsung network remote opens, the one newer TVs use first. "app": the same
# app's Tizen id as a TV lists it (couch-tv's TV app matches on either). Checked on a 2021 Samsung
# (Tizen 6.0) in Australia in October 2026, except the two marked "checked": False (from public
# app lists, not installed on the test TV). Ids can change between TV years: the bridge asks the
# TV which ones it has and only uses those.
TIZEN = {
    "netflix": {"ids": ["3201907018807", "11101200001"], "app": "org.tizen.netflix-app"},
    "youtube": {"ids": ["111299001912"], "app": "9Ur5IzDKqV.TizenYouTube"},
    "prime-video": {"ids": ["3201910019365", "3201512006785"], "app": "org.tizen.primevideo"},
    "disney-plus": {"ids": ["3201901017640", "3202009021709", "3202204027038"], "app": "MCmYXNxgcu.DisneyPlus"},
    "apple-tv": {"ids": ["3201807016597"], "app": "com.samsung.tv.aria-video"},
    "stan": {"ids": ["3201606009798"], "app": "73iTZRTc34.Stan"},
    "binge": {"ids": ["3202010022098"], "app": "as6cYRgkPy.Binge"},
    "abc-iview": {"ids": ["3201812017479"], "checked": False},
    "sbs-on-demand": {"ids": ["3201510005981"], "checked": False},
    "9now": {"ids": ["3201607010031"], "app": "Ne2ZsPWdKl.9NOW"},
    "7plus": {"ids": ["3201803015934"], "app": "icp4AvUPiA.7plus"},
    "10play": {"ids": ["3201704012147"], "app": "KaLitts8bq.tenplaySamsungTizen"},
    "kayo": {"ids": ["3201910019354"], "app": "eYuOiOLYQX.KayoSports"},
    "foxtel-go": {"ids": ["3201910019449"], "app": "AtbFvatetY.FoxtelTizenApp"},
    "paramount-plus": {"ids": ["3202110025305", "3201710014981"], "app": "rJyOSqC6Up.PPlusIntl"},
    "hbo-max": {"ids": ["3202301029760", "3201601007230"], "app": "5b8c3eb16b.BeamCTVDev"},
    "twitch": {"ids": ["3202203026841"], "app": "Jz7aUrV2Q4.Twitch"},
    "spotify": {"ids": ["3201606009684"], "app": "rJeHak5zRg.Spotify"},
}

BY_ID = {a["id"]: a for a in APPS}
TIZEN_TO_PACKAGE = {tid: BY_ID[aid]["package"] for aid, t in TIZEN.items()
                    for tid in t["ids"] + ([t["app"]] if t.get("app") else [])}
BY_PACKAGE = {a["package"]: a for a in APPS}
BY_JW = {jw: a for a in APPS for jw in a["jw"]}

# Other packages that mean "the home screen" (our own launcher registers here).
HOME_PACKAGES = {"com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher",
                 "app.couchtv.launcher"}


def public(app, installed=None):
    """The shape the API returns for an app."""
    if app is None:
        return None
    out = {"id": app["id"], "name": app["name"], "package": app["package"], "colour": app["colour"]}
    if installed is not None or "installed" in app:
        out["installed"] = installed
    return out


def describe_package(package):
    """{id, name, package} for whatever package is in front on the TV."""
    if not package:
        return None
    if package in HOME_PACKAGES:
        return {"id": "home", "name": "Home", "package": package}
    app = BY_PACKAGE.get(package)
    if app:
        return {"id": app["id"], "name": app["name"], "package": package}
    return {"id": None, "name": package.split(".")[-1].replace("_", " ").title(), "package": package}
