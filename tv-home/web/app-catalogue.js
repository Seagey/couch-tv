// The apps a design may name (couch-tv Studio's app picker, and the TV that opens them). A dock, an
// app row, a folder or an app tile in a design stores catalogue ids ("netflix", "stan", "iview"), never
// package names, so one design works on every kind of TV: the TV turns each id into the app it has
// installed (packages for its system, else the app's name in its list), and a person changes them with
// the remote (Hold OK on an app). Data only: no page, no network. Also a CommonJS module for tests.
//
// window.APP_CATALOGUE = { version, groups: [group names], apps: [{
//   id        short, lower case, never changes ("netflix")
//   name      the name people know
//   group     one of groups
//   regions   where it is offered, ISO country codes, main markets first
//   packages  { android: [Google TV and Android TV packages], fire: [Fire TV packages where they differ],
//               samsung: Tizen app id, lg: webOS app id, roku: channel id } ("" or [] when unknown)
//   names     other titles a TV may list it under (matched when no package matches)
//   icon      a picture under tv-home/web/app-icons/ ("app-icons/netflix.png"), or "" (the TV and the
//             designer then draw the name on a coloured tile)
//   colour    the tile colour when there is no icon
//   verified  true: every package here is in couch-tv's own tables (bridge/apps.py, app.js) and was
//             seen on a real TV; false: from public store listings, not yet seen on a TV (the name
//             match still finds the app when a package is wrong)
// }] }
//
// ES5 on purpose: old Android TV WebViews.
(function (root) {
  "use strict";
  var GROUPS = ["Streaming", "Free TV", "Sport", "Kids", "Music", "News", "Movies", "Games", "Tools"];
  var ICONS = { netflix: 1, youtube: 1, prime: 1, disney: 1, stan: 1, binge: 1, kayo: 1, iview: 1, sbs: 1, "7plus": 1, "9now": 1, "10play": 1,
    foxtel: 1, paramount: 1, appletv: 1, spotify: 1, max: 1, twitch: 1, dazn: 1, crunchyroll: 1, stremio: 1, raiplay: 1, now: 1, vtmgo: 1, vrtmax: 1 };
  var APPS = [];
  // a(id, name, group, regions, verified, android, more): more holds fire, samsung, lg, roku, names, colour
  function a(id, name, group, regions, verified, android, more) {
    more = more || {};
    APPS.push({ id: id, name: name, group: group, regions: regions, verified: !!verified,
      packages: { android: android || [], fire: more.fire || [], samsung: more.samsung || "", lg: more.lg || "", roku: more.roku || "" },
      names: more.names || [], icon: ICONS[id] ? "app-icons/" + id + ".png" : "", colour: more.colour || "#2a2a32" });
  }
  var AU = ["AU"], ANZ = ["AU", "NZ"], IN = ["IN"], US = ["US"], UK = ["GB"], WORLD = ["AU", "IN", "US", "GB", "CA", "NZ"];

  // ---------- Australia, the big ones (verified: bridge/apps.py, checked on real TVs) ----------
  a("netflix", "Netflix", "Streaming", WORLD, true, ["com.netflix.ninja"], { samsung: "org.tizen.netflix-app", lg: "netflix", roku: "12", colour: "#e50914" });
  a("youtube", "YouTube", "Streaming", WORLD, true, ["com.google.android.youtube.tv"], { fire: ["com.amazon.firetv.youtube"], samsung: "9Ur5IzDKqV.TizenYouTube", lg: "youtube.leanback.v4", roku: "837", colour: "#ff0000" });
  a("prime", "Prime Video", "Streaming", WORLD, true, ["com.amazon.amazonvideo.livingroom"], { samsung: "org.tizen.primevideo", lg: "amazon", roku: "13", names: ["Amazon Prime Video"], colour: "#00a8e1" });
  a("disney", "Disney+", "Streaming", WORLD, true, ["com.disney.disneyplus"], { samsung: "MCmYXNxgcu.DisneyPlus", lg: "com.disney.disneyplus-prod", roku: "291097", names: ["Disney Plus"], colour: "#113ccf" });
  a("stan", "Stan", "Streaming", AU, true, ["au.com.stan.and"], { samsung: "73iTZRTc34.Stan", colour: "#0072f5" });
  a("binge", "Binge", "Streaming", AU, true, ["au.com.streamotion.ares.tv"], { samsung: "as6cYRgkPy.Binge", names: ["BINGE"], colour: "#1e1eff" });
  a("kayo", "Kayo", "Sport", AU, true, ["au.com.kayosports.tv"], { samsung: "eYuOiOLYQX.KayoSports", names: ["Kayo Sports"], colour: "#00e676" });
  a("iview", "ABC iview", "Free TV", AU, true, ["au.net.abc.iview"], { samsung: "3201812017479", names: ["iview"], colour: "#00c3a5" });
  a("sbs", "SBS On Demand", "Free TV", AU, true, ["com.sbs.ondemand.tv"], { samsung: "3201510005981", colour: "#ffcc00" });
  a("7plus", "7plus", "Free TV", AU, true, ["com.swm.live"], { samsung: "icp4AvUPiA.7plus", colour: "#e4002b" });
  a("9now", "9Now", "Free TV", AU, true, ["au.com.ninenow.ctv"], { samsung: "Ne2ZsPWdKl.9NOW", colour: "#00a9e0" });
  a("10play", "10 Play", "Free TV", AU, true, ["au.com.tenplay"], { samsung: "KaLitts8bq.tenplaySamsungTizen", names: ["10play", "10"], colour: "#0b0b0b" });
  a("foxtel", "Foxtel Go", "Sport", AU, true, ["au.com.foxtel.atv"], { samsung: "AtbFvatetY.FoxtelTizenApp", names: ["Foxtel"], colour: "#f05a28" });
  a("paramount", "Paramount+", "Streaming", WORLD, true, ["com.cbs.ca"], { samsung: "rJyOSqC6Up.PPlusIntl", roku: "31440", names: ["Paramount Plus"], colour: "#0064ff" });
  a("appletv", "Apple TV", "Streaming", WORLD, true, ["com.apple.atve.androidtv.appletv"], { samsung: "com.samsung.tv.aria-video", lg: "com.apple.appletv", roku: "551012", names: ["Apple TV+"], colour: "#111111" });
  a("max", "HBO Max", "Streaming", ["AU", "US", "GB"], true, ["com.wbd.stream"], { samsung: "5b8c3eb16b.BeamCTVDev", lg: "com.wbd.stream", roku: "61322", names: ["Max"], colour: "#002be7" });
  a("spotify", "Spotify", "Music", WORLD, true, ["com.spotify.tv.android"], { samsung: "rJeHak5zRg.Spotify", lg: "spotify-beehive", roku: "22297", colour: "#1db954" });
  a("youtubemusic", "YouTube Music", "Music", WORLD, true, ["com.google.android.youtube.tvmusic"], { colour: "#ff0000" });
  a("googletv", "Google TV", "Movies", WORLD, true, ["com.google.android.videos"], { names: ["Google Play Movies"], colour: "#4285f4" });
  a("twitch", "Twitch", "Games", WORLD, true, ["tv.twitch.android.app"], { samsung: "Jz7aUrV2Q4.Twitch", roku: "50539", colour: "#9146ff" });
  a("plex", "Plex", "Tools", WORLD, true, ["com.plexapp.android"], { lg: "cdp-30", roku: "13535", colour: "#e5a00d" });
  a("audible", "Audible", "Music", WORLD, true, ["com.audible.application.firetv"], { fire: ["com.audible.application.firetv"], colour: "#f8991d" });
  a("moonlight", "Moonlight", "Games", WORLD, true, ["com.limelight"], { colour: "#2a2a2a" });

  // ---------- Australia, more ----------
  a("optussport", "Optus Sport", "Sport", AU, false, ["au.com.optus.sport"], { colour: "#00a3ad" });
  a("britbox", "BritBox", "Streaming", ["AU", "GB", "US", "CA"], false, ["com.britbox.us.firetv"], { names: ["BritBox"], colour: "#ffffff" });
  a("docplay", "DocPlay", "Movies", ANZ, false, ["com.docplay.androidtv"], { colour: "#e8442c" });
  a("hayu", "hayu", "Streaming", ["AU", "GB", "IE"], false, ["com.hayu.tv"], { colour: "#7b2cbf" });
  a("kanopy", "Kanopy", "Movies", ["AU", "US", "NZ", "CA"], false, ["com.kanopy"], { colour: "#1b1b1b" });
  a("beamafilm", "Beamafilm", "Movies", ANZ, false, [], { names: ["Beamafilm"], colour: "#ff5a00" });
  a("abclisten", "ABC listen", "Music", AU, false, ["au.net.abc.listen"], { colour: "#000000" });
  a("abcnews", "ABC News", "News", AU, false, ["au.net.abc.abcnews"], { colour: "#000000" });
  a("skynewsau", "Sky News Australia", "News", AU, false, ["au.com.skynews.app"], { names: ["Sky News"], colour: "#c8102e" });
  a("fetch", "Fetch", "Free TV", AU, false, [], { names: ["Fetch"], colour: "#ff4f00" });
  a("stansport", "Stan Sport", "Sport", AU, false, [], { names: ["Stan"], colour: "#0072f5" });
  a("abckids", "ABC Kids", "Kids", AU, false, ["au.net.abc.kidsiview"], { names: ["ABC Kids", "ABC Kids iview"], colour: "#00c3a5" });

  // ---------- India (not yet seen on a real TV except where marked) ----------
  a("hotstar", "JioHotstar", "Streaming", IN, false, ["in.startv.hotstar", "in.startv.hotstaronly"], { names: ["Hotstar", "Disney+ Hotstar", "JioHotstar"], colour: "#0f1014" });
  a("jiocinema", "JioCinema", "Streaming", IN, false, ["com.jio.media.ondemand", "com.jio.media.stb.ondemand"], { names: ["JioCinema"], colour: "#d4145a" });
  a("sonyliv", "SonyLIV", "Streaming", IN, false, ["com.sonyliv"], { names: ["Sony LIV", "SonyLIV"], colour: "#000000" });
  a("zee5", "ZEE5", "Streaming", IN, false, ["com.graymatrix.did"], { names: ["ZEE5"], colour: "#8230c6" });
  a("mxplayer", "MX Player", "Free TV", IN, false, ["com.mxtech.videoplayer.television", "com.mxtech.videoplayer.ad"], { lg: "com.mxplayer.lg", names: ["MX Player TV"], colour: "#1475e1" });
  a("hoichoi", "Hoichoi", "Streaming", IN, false, ["com.viewlift.hoichoi"], { lg: "com.hoichoi.tv", colour: "#e50000" });
  a("aha", "aha", "Streaming", IN, false, ["ahaflix.tv"], { names: ["aha", "aha Telugu"], colour: "#ff6c00" });
  a("sunnxt", "Sun NXT", "Streaming", IN, false, ["com.suntv.sunnxt"], { colour: "#f7a21b" });
  a("erosnow", "Eros Now", "Movies", IN, false, ["com.erosnow"], { colour: "#e31837" });
  a("altt", "ALTT", "Streaming", IN, false, ["com.balaji.alt"], { names: ["ALTBalaji", "ALTT"], colour: "#c4161c" });
  a("airtelxstream", "Airtel Xstream Play", "Streaming", IN, false, ["tv.accedo.airtel.wynk"], { names: ["Airtel Xstream"], colour: "#e40000" });
  a("tataplaybinge", "Tata Play Binge", "Streaming", IN, false, ["com.ttn.tataplaybinge"], { names: ["Tata Play Binge"], colour: "#e10070" });
  a("lionsgateplay", "Lionsgate Play", "Movies", IN, false, ["com.lionsgateplay.videoapp"], { colour: "#000000" });
  a("shemaroome", "ShemarooMe", "Streaming", IN, false, ["com.saranyu.shemarooworld"], { colour: "#f7c600" });
  a("etvwin", "ETV Win", "Streaming", IN, false, ["com.etvwin.mobile"], { colour: "#ffcc00" });
  a("chaupal", "Chaupal", "Streaming", IN, false, ["com.chaupal.app"], { colour: "#e8a300" });
  a("discoveryplusin", "discovery+", "Streaming", ["IN", "GB", "US"], false, ["com.discovery.discoveryplus.androidtv"], { names: ["discovery+", "Discovery Plus"], colour: "#2175d9" });
  a("waves", "Waves", "Free TV", IN, false, ["com.wavesott.app"], { lg: "com.wavesott.app", names: ["Waves OTT", "DD Waves"], colour: "#ff6f00" });
  a("fancode", "FanCode", "Sport", IN, false, ["com.dream11sportsguru"], { names: ["FanCode"], colour: "#ff5a00" });
  a("jiosaavn", "JioSaavn", "Music", IN, false, ["com.jio.media.jiobeats"], { names: ["JioSaavn"], colour: "#2bc5b4" });
  a("gaana", "Gaana", "Music", IN, false, ["com.gaana"], { colour: "#e72c30" });
  a("wynk", "Wynk Music", "Music", IN, false, ["com.bsbportal.music"], { colour: "#e40000" });
  a("aajtak", "Aaj Tak", "News", IN, false, ["in.AajTak.headlines"], { names: ["Aaj Tak", "AajTak"], colour: "#d71920" });
  a("ndtv", "NDTV", "News", IN, false, ["com.july.ndtv"], { colour: "#e51b23" });
  a("hungama", "Hungama", "Music", IN, false, ["com.hungama.myplay.activity"], { colour: "#f7a400" });

  // ---------- free TV, movies and series worldwide ----------
  a("tubi", "Tubi", "Free TV", ["AU", "US", "CA", "GB", "NZ"], false, ["com.tubitv"], { roku: "41468", colour: "#ff4f00" });
  a("plutotv", "Pluto TV", "Free TV", ["US", "GB", "CA"], false, ["tv.pluto.android"], { roku: "74519", colour: "#000000" });
  a("crunchyroll", "Crunchyroll", "Streaming", WORLD, false, ["com.crunchyroll.crunchyroid"], { lg: "com.crunchyroll.webapp", roku: "2595", colour: "#f47521" });
  a("mubi", "MUBI", "Movies", WORLD, false, ["com.mubi"], { colour: "#001489" });
  a("shudder", "Shudder", "Movies", ["AU", "US", "GB", "CA"], false, ["com.dramafever.shudder"], { colour: "#e2202c" });
  a("curiosity", "CuriosityStream", "Movies", WORLD, false, ["com.curiositystream.curiositystream"], { colour: "#0f4c81" });
  a("dailymotion", "Dailymotion", "Free TV", WORLD, false, ["com.dailymotion.dailymotion"], { lg: "com.dailymotion.dailymotion", colour: "#0066dc" });

  // ---------- United States ----------
  a("hulu", "Hulu", "Streaming", US, true, ["com.hulu.livingroomplus"], { samsung: "LBUAQX1exg.Hulu", roku: "2285", colour: "#1ce783" });
  a("peacock", "Peacock", "Streaming", US, true, ["com.peacocktv.peacockandroid"], { samsung: "gzcc4LRFBF.Peacock", lg: "com.peacock.tv", roku: "593099", names: ["Peacock TV"], colour: "#111111" });
  a("youtubetv", "YouTube TV", "Streaming", US, true, ["com.google.android.youtube.tvunplugged"], { samsung: "PvWgqxV3Xa.YouTubeTV", lg: "youtube.leanback.ytv.v1", roku: "195316", colour: "#ff0000" });
  a("sling", "Sling TV", "Streaming", US, false, ["com.sling"], { roku: "46041", colour: "#0f72e5" });
  a("fubo", "Fubo", "Sport", US, false, ["com.fubo.firetv.screen"], { names: ["fuboTV", "Fubo"], colour: "#fa4616" });
  a("philo", "Philo", "Streaming", US, false, ["com.philo.philo"], { colour: "#4a2aa6" });
  a("starz", "Starz", "Movies", US, false, ["com.bydeluxe.d3.android.program.starz"], { colour: "#000000" });
  a("mgmplus", "MGM+", "Movies", US, false, ["com.epix.epix.now"], { names: ["MGM+", "EPIX"], colour: "#000000" });
  a("amcplus", "AMC+", "Streaming", US, false, ["com.amcplus.amcfullepisodes"], { colour: "#000000" });
  a("fandango", "Fandango at Home", "Movies", US, false, ["air.com.vudu.air.DownloaderTablet"], { names: ["Vudu", "Fandango at Home"], colour: "#3399ff" });
  a("rokuchannel", "The Roku Channel", "Free TV", US, false, [], { roku: "151908", colour: "#6c3c97" });
  a("espn", "ESPN", "Sport", US, false, ["com.espn.score_center"], { roku: "34376", colour: "#cc0000" });
  a("nba", "NBA", "Sport", WORLD, false, ["com.nbaimd.gametime.nba2011"], { colour: "#1d428a" });
  a("f1tv", "F1 TV", "Sport", WORLD, false, ["com.formulaone.production"], { colour: "#e10600" });
  a("cnn", "CNN", "News", WORLD, false, ["com.cnn.mobile.android.tv"], { colour: "#cc0000" });
  a("bloomberg", "Bloomberg", "News", WORLD, false, ["com.bloomberg.btva"], { colour: "#000000" });
  a("pbskids", "PBS KIDS", "Kids", US, false, ["org.pbskids.video"], { colour: "#2638c4" });
  a("pandora", "Pandora", "Music", US, false, ["com.pandora.android.atv"], { colour: "#3668ff" });
  a("iheart", "iHeartRadio", "Music", ["US", "AU", "NZ", "CA"], false, ["com.clearchannel.iheartradio.controller"], { colour: "#c6002b" });

  // ---------- United Kingdom ----------
  a("iplayer", "BBC iPlayer", "Free TV", UK, false, ["uk.co.bbc.iplayer"], { colour: "#000000" });
  a("itvx", "ITVX", "Free TV", UK, false, ["air.ITVMobilePlayer"], { colour: "#102c3d" });
  a("channel4", "Channel 4", "Free TV", UK, false, ["com.channel4.ondemand"], { colour: "#000000" });
  a("my5", "My5", "Free TV", UK, false, ["com.channel5.my5"], { names: ["Channel 5", "My5"], colour: "#ff0080" });
  a("nowuk", "NOW", "Streaming", UK, false, ["com.nowtv.androidtv"], { names: ["NOW TV"], colour: "#00e5b2" });
  a("bbcnews", "BBC News", "News", WORLD, false, ["bbc.mobile.news.ww"], { colour: "#bb1919" });

  // ---------- Europe (seen on LG TVs, #40 and #45) ----------
  a("dazn", "DAZN", "Sport", WORLD, false, ["com.dazn"], { lg: "dazn", colour: "#0c161c" });
  a("raiplay", "RaiPlay", "Free TV", ["IT"], false, ["it.rainet.raiplay"], { lg: "it.rainet.raiplay", colour: "#0047bb" });
  a("now", "NOW Italia", "Streaming", ["IT"], false, [], { lg: "com.atlas.tv", names: ["NOW"], colour: "#00e5b2" });
  a("vtmgo", "VTM GO", "Free TV", ["BE"], false, ["be.vtmgo.app"], { lg: "be.vtmgo.app", colour: "#ff5a00" });
  a("vrtmax", "VRT MAX", "Free TV", ["BE"], false, ["be.vrt.vrtmax"], { lg: "be.vrt.vrtmax", colour: "#5dfc71" });

  // ---------- kids and music worldwide ----------
  a("youtubekids", "YouTube Kids", "Kids", WORLD, false, ["com.google.android.youtube.tvkids"], { names: ["YouTube Kids"], colour: "#ff0000" });
  a("applemusic", "Apple Music", "Music", WORLD, false, ["com.apple.android.music"], { lg: "com.apple.applemusic", colour: "#fa2d48" });
  a("amazonmusic", "Amazon Music", "Music", WORLD, false, ["com.amazon.music.tv"], { fire: ["com.amazon.bueller.music"], colour: "#25d1da" });
  a("tidal", "TIDAL", "Music", WORLD, false, ["com.aspiro.tidal"], { colour: "#000000" });
  a("deezer", "Deezer", "Music", WORLD, false, ["deezer.android.tv"], { colour: "#a238ff" });
  a("tunein", "TuneIn", "Music", WORLD, false, ["tunein.player"], { colour: "#1c203c" });
  a("soundcloud", "SoundCloud", "Music", WORLD, false, ["com.soundcloud.android"], { colour: "#ff5500" });

  // ---------- games ----------
  a("xbox", "Xbox", "Games", WORLD, false, ["com.microsoft.xcloud", "com.gamepass"], { lg: "com.microsoft.xbox", names: ["Xbox", "Xbox Game Pass"], colour: "#107c10" });
  a("geforcenow", "GeForce NOW", "Games", WORLD, false, ["com.nvidia.geforcenow"], { lg: "com.geforcenow.play", colour: "#76b900" });
  a("steamlink", "Steam Link", "Games", WORLD, false, ["com.valvesoftware.steamlink"], { colour: "#2a475e" });
  a("retroarch", "RetroArch", "Games", WORLD, false, ["com.retroarch"], { colour: "#e60012" });

  // ---------- tools ----------
  a("kodi", "Kodi", "Tools", WORLD, false, ["org.xbmc.kodi"], { fire: ["org.xbmc.kodi"], colour: "#17b2e7" });
  a("vlc", "VLC", "Tools", WORLD, false, ["org.videolan.vlc"], { fire: ["org.videolan.vlc"], colour: "#ff8800" });
  a("jellyfin", "Jellyfin", "Tools", WORLD, false, ["org.jellyfin.androidtv"], { colour: "#00a4dc" });
  a("stremio", "Stremio", "Tools", WORLD, false, ["com.stremio.one"], { lg: "io.strem.tv", colour: "#8a5aab" });
  a("nuvio", "Nuvio", "Tools", WORLD, true, ["com.nuvio.tv"], { colour: "#111111" });

  var CAT = { version: 1, groups: GROUPS, apps: APPS };

  // helpers for the TV and the designer: the catalogue stays plain data
  var BY_ID = {}, BY_PKG = {};
  APPS.forEach(function (x) {
    BY_ID[x.id] = x;
    var p = x.packages, all = [].concat(p.android, p.fire, p.samsung ? [p.samsung] : [], p.lg ? [p.lg] : [], p.roku ? [p.roku] : []);
    all.forEach(function (k) { if (k && !BY_PKG[k]) BY_PKG[k] = x.id; });
  });
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9+]/g, ""); }
  var HELP = {
    get: function (id) { return typeof id === "string" && own(BY_ID, id) ? BY_ID[id] : null; },
    // the catalogue id for a package or TV app id ("com.netflix.ninja" -> "netflix"), or null
    idOf: function (pkg) { return typeof pkg === "string" && own(BY_PKG, pkg) ? BY_PKG[pkg] : null; },
    // every package or app id the app may have on any TV
    packagesOf: function (id) { var x = HELP.get(id); if (!x) return []; var p = x.packages; return [].concat(p.android, p.fire, p.samsung ? [p.samsung] : [], p.lg ? [p.lg] : [], p.roku ? [p.roku] : []); },
    // the installed app (one of `installed`, [{ package, name }]) this catalogue id is on this TV, or null
    resolve: function (id, installed) {
      var x = HELP.get(id);
      if (!x || !installed || !installed.length) return null;
      var pk = HELP.packagesOf(id), i;
      for (i = 0; i < installed.length; i++) if (installed[i] && pk.indexOf(installed[i].package) >= 0) return installed[i];
      var names = [x.name].concat(x.names).map(norm);
      for (i = 0; i < installed.length; i++) if (installed[i] && names.indexOf(norm(installed[i].name)) >= 0) return installed[i];
      return null;
    }
  };
  root.APP_CATALOGUE = CAT;
  root.CouchApps = HELP;
  if (typeof module !== "undefined" && module.exports) module.exports = { APP_CATALOGUE: CAT, CouchApps: HELP };
})(typeof window !== "undefined" ? window : this);
