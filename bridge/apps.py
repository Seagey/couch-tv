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
     "colour": "#00A8E1", "jw": ["amazonprimevideo", "amazonprime", "amazonprimevideowithads", "amazon"], "deeplink": "jw"},
    {"id": "apple-tv", "name": "Apple TV", "package": "com.apple.atve.androidtv.appletv", "colour": "#111111",
     "jw": ["appletvplus", "itunes"], "deeplink": "jw"},
    {"id": "paramount-plus", "name": "Paramount+", "package": "com.cbs.ca", "colour": "#0064FF",
     "jw": ["paramountplus", "paramountpluspremium", "paramountplusbasicwithads", "paramountplusessential"], "deeplink": "jw"},
    # US apps, added from a 2022 Samsung Q60B (#53). No bundled logos yet: the TV's own icon is used.
    {"id": "peacock", "name": "Peacock", "package": "com.peacocktv.peacockandroid", "colour": "#111111",
     "jw": ["peacocktv", "peacocktvpremium"], "deeplink": "jw"},
    {"id": "hulu", "name": "Hulu", "package": "com.hulu.livingroomplus", "colour": "#1CE783",
     "jw": ["hulu"], "deeplink": "jw"},
    {"id": "youtube-tv", "name": "YouTube TV", "package": "com.google.android.youtube.tvunplugged",
     "colour": "#FF0000", "jw": ["youtubetv"], "deeplink": "jw"},
    # Plex has no JustWatch intent here, so only the app opens. Listed so it ranks with the known apps
    # and is not pushed behind More apps (#56).
    {"id": "plex", "name": "Plex", "package": "com.plexapp.android", "colour": "#E5A00D",
     "jw": ["plex"], "deeplink": "app"},
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
    "paramount-plus": {"ids": ["3202110025305", "3201710014981", "rJyOSqC6Up.CBSAllAccess"], "app": "rJyOSqC6Up.PPlusIntl"},
    # US ids, from a 2022 Samsung Q60B (#53). Paramount+ in the US is the old CBS All Access package.
    "peacock": {"ids": ["gzcc4LRFBF.Peacock"]},
    "hulu": {"ids": ["LBUAQX1exg.Hulu"]},
    "youtube-tv": {"ids": ["PvWgqxV3Xa.YouTubeTV"]},
    "hbo-max": {"ids": ["3202301029760", "3201601007230"], "app": "5b8c3eb16b.BeamCTVDev"},
    "twitch": {"ids": ["3202203026841"], "app": "Jz7aUrV2Q4.Twitch"},
    "spotify": {"ids": ["3201606009684"], "app": "rJeHak5zRg.Spotify"},
}

# LG (webOS) app ids, for a TV with "kind": "lg" (bridge/lg.py, docs/LG.md). From public lists, not
# checked on a real LG yet: Netflix, YouTube and Prime Video are the ids LG's own integration notes
# and Connect SDK use; Disney+ is the least certain. Every other app is found on the TV by its name
# (the TV lists its apps with their titles; "names" are other titles the same app goes by), so
# this table only needs the ids a name would not find.
WEBOS = {
    "netflix": {"ids": ["netflix"]},
    "youtube": {"ids": ["youtube.leanback.v4"]},
    "prime-video": {"ids": ["amazon"], "names": ["Amazon Prime Video", "Prime Video"]},
    "disney-plus": {"ids": ["com.disney.disneyplus-prod"]},
    # Apple TV, HBO Max and Spotify: ids seen on a real LG OLED C1, webOS 6.5.3 (#28). Spotify's title
    # there is "Spotify – Música y podcasts", so a name would miss it.
    "apple-tv": {"ids": ["com.apple.appletv"], "names": ["Apple TV", "Apple TV+"]},
    "hbo-max": {"ids": ["com.wbd.stream"]},
    "spotify": {"ids": ["spotify-beehive"]},
    "abc-iview": {"ids": [], "names": ["ABC iview", "iview"]},
    "sbs-on-demand": {"ids": [], "names": ["SBS On Demand"]},
    "settings": {"ids": ["com.palm.app.settings"]},
    # US apps, seen on an LG OLED77GX, webOS 5.6.2 (#56).
    "plex": {"ids": ["cdp-30"]},
    "youtube-tv": {"ids": ["youtube.leanback.ytv.v1"]},
    "peacock": {"ids": ["com.peacock.tv"]},
}

# LG apps with no Android twin in APPS (so no package to invent): LG id -> name. The LG app shows
# them by that name and opens them by that id with no app list, and uses a bundled logo named
# <LG id>.png from remote/src/app-logos when there is one. Seen on an LG OLED C4 in Italy, webOS 24 (#45).
WEBOS_ONLY = {
    "it.rainet.raiplay": "RaiPlay",
    "com.atlas.tv": "NOW",
    "dazn": "DAZN",
    "com.crunchyroll.webapp": "Crunchyroll",
}

# Roku channel ids, for a TV with "kind": "roku" (bridge/roku.py, docs/ROKU.md). Built from Roku's
# documentation and community lists, NOT checked on a real Roku. Only these four ids were confirmed
# from pages that were read (Netflix 12, YouTube 837, Hulu 2285 and Prime Video 13, in
# github.com/zakwht/roku docs/api.md and forum.developer.roku.com/t/external-control-app-id-help/1975).
# The rest are the ids Roku's channel store URLs and community lists give and are UNVERIFIED: the
# driver only uses an id when the Roku's own app list (query/apps) contains it, and otherwise finds
# the app by its name ("names", the titles a Roku lists it under, which differ by country). Roku
# channels in Australia are fewer than in the US: ABC iview, SBS On Demand and 10play were reported
# missing from some Australian stores, so they only show if the Roku lists them.
ROKU = {
    "netflix": {"ids": ["12"]},
    "youtube": {"ids": ["837"]},
    "prime-video": {"ids": ["13"], "names": ["Amazon Prime Video", "Prime Video"]},
    "hulu": {"ids": ["2285"]},
    "disney-plus": {"ids": ["291097"], "names": ["Disney+", "Disney Plus"]},
    "hbo-max": {"ids": ["61322"], "names": ["Max", "HBO Max"]},
    "paramount-plus": {"ids": ["31440"], "names": ["Paramount+", "Paramount Plus"]},
    "peacock": {"ids": ["593099"], "names": ["Peacock TV", "Peacock"]},
    "apple-tv": {"ids": ["551012"], "names": ["Apple TV", "Apple TV+"]},
    "plex": {"ids": ["13535"]},
    "spotify": {"ids": ["22297"]},
    "twitch": {"ids": ["50539"]},
    "youtube-tv": {"ids": ["195316"], "names": ["YouTube TV"]},
    "stan": {"ids": [], "names": ["Stan"]},
    "binge": {"ids": [], "names": ["BINGE", "Binge"]},
    "abc-iview": {"ids": [], "names": ["ABC iview", "iview"]},
    "sbs-on-demand": {"ids": [], "names": ["SBS On Demand"]},
    "9now": {"ids": [], "names": ["9Now"]},
    "7plus": {"ids": [], "names": ["7plus"]},
    "10play": {"ids": [], "names": ["10", "10 play", "10play"]},
    "kayo": {"ids": [], "names": ["Kayo Sports", "Kayo"]},
    "foxtel-go": {"ids": [], "names": ["Foxtel Go", "Foxtel"]},
}

BY_ID = {a["id"]: a for a in APPS}
TIZEN_TO_PACKAGE = {tid: BY_ID[aid]["package"] for aid, t in TIZEN.items()
                    for tid in t["ids"] + ([t["app"]] if t.get("app") else [])}
WEBOS_TO_PACKAGE = {lid: BY_ID[aid]["package"] for aid, w in WEBOS.items() for lid in w["ids"]}
ROKU_TO_PACKAGE = {rid: BY_ID[aid]["package"] for aid, r in ROKU.items() for rid in r["ids"]}
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
