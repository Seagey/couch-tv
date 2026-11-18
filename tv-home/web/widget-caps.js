// What every widget needs to show real things, where that is set up, what it shows until then, what
// OK opens, which TVs can run it, and the sizes it comes in. One record per widget kind, read by the
// TV (widgets.js draws the setup card from it) and by TV Designer (the info tips, the gallery badges
// and the size menu). Data only: no page, no network.
//
// A record:
//   name        the widget's name
//   status      "works"      real on the TV with nothing more to set up
//               "setup"      real once the thing in `needs` is set up (said in `setup`)
//               "not-built"  couch-tv cannot fill it yet; `build` says what has to be written first
//   what        one line: what it shows on a real TV
//   needs       plain lines, each one thing it needs ("Needs Home Assistant on your network")
//   setup       { where, how }: where it is set up ("nothing", "tv", "phone", "computer", "designer")
//               and how, in plain words
//   until       what the person sees on the TV until it is set up: a setup card, never pretend data
//   build       for "not-built": what has to be built; otherwise ""
//   ok          what OK on the remote opens (the detail layer, widget-detail.js), or what it does
//   platforms   { <tvs/platform-setup.js key>: { on: "yes" | "setup" | "partial" | "no", note } }
//   sizes       { s: named sizes, min: [w, h] in half cells, x: extra sizes } (the shape of
//               tools/tv-designer/app/grid.js W[kind]; the smallest size that still reads comes first)
//
// ES5 on purpose: old Android TV WebViews. Also a CommonJS module for tests and the designer.
(function (root) {
  "use strict";

  // the keys of tools/tv-designer/tvs/platform-setup.js, in its order
  var PLATFORMS = ["Google TV", "Android TV", "Fire OS", "Vega OS", "Tizen", "webOS", "Roku OS", "VIDAA", "Titan OS", "Saphi", "tvOS",
    "TiVo OS", "SmartCast", "My Home Screen", "Other", "unknown"];
  // The TVs where couch-tv's home is the launcher app (it has Home Assistant, the TV's photos, the
  // on-TV app and what is playing): Google TV, Android TV, Fire OS.
  var ANDROID = ["Google TV", "Android TV", "Fire OS"];
  // The TVs where the home is the same web page, opened as an app or in the TV's browser by a
  // computer at home that stays on (docs/SAMSUNG.md, LG.md, VIDAA.md, PHILIPS-SAPHI.md, TIVO.md,
  // PANASONIC.md). No Home Assistant, no photos picked on the TV, no "what is playing".
  var WEB = ["Tizen", "webOS", "VIDAA", "Saphi", "TiVo OS", "My Home Screen"];
  // The rest have no couch-tv home that draws designs (Roku's is a channel, Apple TV's a native app,
  // Vega's its own app; Titan OS, SmartCast and unknown TVs have no home yet).
  var NO_HOME = "This TV's couch-tv home does not draw couch-tv Studio designs.";

  function row(on, note) { return { on: on, note: note || "" }; }
  // the platform table from what the Android home and the web home can do with this widget
  function plat(android, web, aNote, wNote) {
    var out = {};
    PLATFORMS.forEach(function (p) {
      if (ANDROID.indexOf(p) >= 0) out[p] = row(android, aNote || "");
      else if (WEB.indexOf(p) >= 0) out[p] = row(web, wNote || (web === "no" ? "Needs the Android home (Google TV, Android TV or Fire TV)." : "With the computer bridge running at home."));
      else out[p] = row("no", NO_HOME);
    });
    return out;
  }
  var EVERY = function (note) { return plat("yes", "yes", note, note || "With the computer bridge running at home."); };
  var ANDROID_ONLY = function (aNote) { return plat("setup", "no", aNote); };
  var NOWHERE = function (why) { return plat("no", "no", why, why); };
  function sz(s, min, x) { var o = { s: s, min: min }; if (x) o.x = x; return o; }
  function setup(where, how) { return { where: where, how: how }; }

  var HA_NEED = "Needs Home Assistant on your home network, with the TV given its own token";
  var HA_HOW = "On the computer that set up couch-tv: add a home_assistant section to config.json (docs/CONFIG.md, Smart home) and run apply.sh again. The token goes in .env, never in a design.";
  var BRIDGE_NEED = "Needs the computer bridge (a computer at home that stays on), or the couch-tv on-TV app";
  var BRIDGE_HOW = "Set up option B (the computer bridge) or option C (the on-TV app) from couch-tv's setup guide. Nothing is set up in the design.";
  var TOWN_NEED = "Needs your town (set when couch-tv was set up)";
  var TOWN_HOW = "On the TV: Home settings, Weather, Place. The weather comes free from Open-Meteo, no account.";
  var PHOTOS_NEED = "Needs photos on the TV, or a photo put in the design";
  var PHOTOS_HOW = "On the TV: Home settings, Your photos (up to 50, kept on the TV). Or drop a photo into the widget in couch-tv Studio.";

  var C = {
    // ---------- time ----------
    clock: { name: "Digital clock", status: "works", what: "The time from the TV's own clock, with the date if you like", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up. 12 or 24 hour follows the widget, else the TV's Home settings."), until: "Always shows the time", build: "",
      ok: "Opens Timers: start a kitchen timer from the remote", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    tallclock: { name: "Tall clock", status: "works", what: "Tall thin digits that fill the space", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    glassclock: { name: "Glass clock", status: "works", what: "The digits filled from the scene photo", needs: ["Nothing: uses the scene pictures that ship with couch-tv"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "small", "medium", "wide", "xl", "hero"], [4, 2]) },
    analog: { name: "Analogue clock", status: "works", what: "A face with hands", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "small", "large"], [2, 2]) },
    flipclock: { name: "Flip clock", status: "works", what: "Split flap digits", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "medium", "wide"], [4, 2]) },
    wordclock: { name: "Time in words", status: "works", what: "\"Twenty to eight, Wednesday morning\"", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    solar: { name: "Sun clock", status: "works", what: "The sun's arc today with sunrise and sunset, worked out on the TV", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town for the sun\", with where to do it", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    worldclock: { name: "World clocks", status: "works", what: "Two to four cities, worked out on the TV", needs: ["Nothing: the cities are picked in couch-tv Studio"],
      setup: setup("designer", "Pick the cities in couch-tv Studio."), until: "Always shows the times", build: "",
      ok: "Opens World clocks: every city big, with day and night", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    countdown: { name: "Countdown", status: "works", what: "Sleeps, days or weeks to a date", needs: ["Nothing: the date and words are picked in couch-tv Studio"],
      setup: setup("designer", "Pick the date and the words in couch-tv Studio."), until: "Always shows the count", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    date: { name: "Date", status: "works", what: "Today's date, with the weather if you like", needs: ["Nothing for the date. The weather line needs your town"],
      setup: setup("nothing", "Nothing for the date. For the weather line: " + TOWN_HOW), until: "Always shows the date", build: "",
      ok: "Opens Calendar: this month and today", platforms: EVERY("Works with no computer."), sizes: sz(["line", "wline", "tile", "small"], [2, 1]) },
    month: { name: "Month", status: "works", what: "This month's calendar, today marked", needs: ["Nothing: the TV's own clock"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the month", build: "",
      ok: "Opens Calendar: this month and next", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "small", "large"], [2, 2]) },
    timer: { name: "Timer", status: "works", what: "A ring counting down, started from the remote", needs: ["Nothing: timers are kept on the TV"],
      setup: setup("nothing", "Nothing to set up. Press OK on the widget, pick a time, and it counts down here."), until: "\"No timer running. OK to start one\"", build: "",
      ok: "Opens Timers: 1, 3, 5, 10, 15, 20, 30 and 60 minutes, add a minute, cancel", platforms: EVERY("Kept on this TV."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },

    // ---------- weather (Open-Meteo, free, no account) ----------
    weather: { name: "Weather", status: "works", what: "The place, the temperature, the sky, high and low", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\", or \"Weather is off on this TV\"", build: "",
      ok: "Opens the forecast: the next 24 hours and the week", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    bigtemp: { name: "Big number", status: "works", what: "One huge temperature on the colour of the day", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens the forecast", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["tile", "small", "medium", "large"], [2, 2]) },
    hourly: { name: "Hourly", status: "works", what: "The next hours: time, sky and temperature", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens the forecast: 24 hours with the chance of rain", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    week: { name: "This week", status: "works", what: "The next 7 days, with the range of each", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens the forecast: the 7 days in full", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["wtile", "small", "tall", "medium", "large"], [4, 2]) },
    rain: { name: "Rain soon", status: "works", what: "Rain in the next three hours, as bars", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens the forecast: the chance of rain by the hour", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    uv: { name: "UV index", status: "works", what: "Today's UV and its band", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens the forecast: UV by the hour", platforms: EVERY("Asks Open-Meteo straight from the TV."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    sun: { name: "Sunrise and sunset", status: "works", what: "Two times and the sun's arc, worked out on the TV", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town for the sun\"", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    moon: { name: "Moon", status: "works", what: "Tonight's moon and the next full moon, worked out on the TV", needs: ["Nothing: worked out on the TV"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows the moon", build: "",
      ok: "Opens the moon: the phases for the next four weeks", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    air: { name: "Air quality", status: "works", what: "The air quality number and band (European AQI, Open-Meteo's free air quality service)", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\"", build: "",
      ok: "Opens Air quality: the next 12 hours", platforms: EVERY("Asks Open-Meteo straight from the TV, only while this widget is on the home."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    surf: { name: "Surf", status: "works", what: "Swell height, period and direction, and the wind, for the sea nearest your town (Open-Meteo's free marine service)", needs: [TOWN_NEED, "A town near the coast: inland there is no swell to read"],
      setup: setup("tv", TOWN_HOW), until: "\"Set your town in Home settings\", or \"No surf reading here\" inland", build: "",
      ok: "Opens Surf: swell by the hour today", platforms: EVERY("Asks Open-Meteo straight from the TV, only while this widget is on the home."), sizes: sz(["wtile", "small", "medium"], [4, 2]) },

    // ---------- photos ----------
    photo: { name: "Photo", status: "setup", what: "One of the TV's photos, or one put in the design", needs: [PHOTOS_NEED],
      setup: setup("tv", PHOTOS_HOW), until: "\"Add your photos on the TV\", with where to do it", build: "",
      ok: "Opens the photos full screen, as a slideshow", platforms: plat("setup", "partial", "", "Only photos put into the design: photos are picked on the TV on Android only."), sizes: sz(["tile", "wtile", "small", "tall", "medium", "wide", "large", "xl", "hero", "full"], [2, 2]) },
    slideshow: { name: "Slideshow", status: "setup", what: "Flicks through the TV's photos", needs: [PHOTOS_NEED],
      setup: setup("tv", PHOTOS_HOW), until: "\"Add your photos on the TV\"", build: "",
      ok: "Opens the photos full screen: Left and Right to flick, OK to pause", platforms: plat("setup", "partial", "", "Only photos put into the design: photos are picked on the TV on Android only."), sizes: sz(["tile", "wtile", "small", "tall", "medium", "wide", "large", "xl", "hero", "full"], [2, 2]) },
    mosaic: { name: "Photo mosaic", status: "setup", what: "Three to five of the TV's photos in a collage", needs: [PHOTOS_NEED],
      setup: setup("tv", PHOTOS_HOW), until: "\"Add your photos on the TV\"", build: "",
      ok: "Opens the photos full screen, as a slideshow", platforms: plat("setup", "partial", "", "Only photos put into the design."), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    artframe: { name: "Art frame", status: "setup", what: "A photo in a mat with a label", needs: [PHOTOS_NEED],
      setup: setup("tv", PHOTOS_HOW), until: "\"Add your photos on the TV\"", build: "",
      ok: "Opens the picture full screen, without the mat", platforms: plat("setup", "partial", "", "Only photos put into the design."), sizes: sz(["small", "tall", "large", "xl", "hero", "full"], [4, 4]) },
    memory: { name: "On this day", status: "not-built", what: "A photo from this date in past years", needs: ["Needs couch-tv to read the date each photo was taken, on the TV"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"On this day is not on couch-tv yet\", and what it needs", build: "The launcher has to read each photo's taken date (EXIF) when it is added in Home settings, Your photos, and keep it on the TV.",
      ok: "Opens the photos from this day full screen (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- watching ----------
    keep: { name: "Keep watching", status: "setup", what: "What you were watching, one show at a time", needs: [BRIDGE_NEED],
      setup: setup("computer", BRIDGE_HOW), until: "\"Nothing to keep watching yet\": shows you start on this TV appear here", build: "",
      ok: "Opens Keep watching: every show you have on the go, Resume on each", platforms: plat("setup", "partial", "", "Only shows started through couch-tv (docs/SAMSUNG.md, LG.md, VIDAA.md)."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    keeprow: { name: "Keep watching row", status: "setup", what: "Two to five shows with how far you got", needs: [BRIDGE_NEED],
      setup: setup("computer", BRIDGE_HOW), until: "\"Nothing to keep watching yet\"", build: "",
      ok: "OK on a poster plays it. Hold OK, Open, for the full list", platforms: plat("setup", "partial", "", "Only shows started through couch-tv."), sizes: sz(["medium", "wide", "hero"], [6, 2]) },
    upnext: { name: "Up next", status: "setup", what: "One show filling the space: Resume or Start over", needs: [BRIDGE_NEED],
      setup: setup("computer", BRIDGE_HOW), until: "\"Nothing to keep watching yet\"", build: "",
      ok: "Resume plays it. Hold OK, Open, for the full list", platforms: plat("setup", "partial", "", "Only shows started through couch-tv."), sizes: sz(["medium", "wide", "xl", "hero", "full"], [8, 4]) },
    picks: { name: "Picks for you", status: "not-built", what: "\"Because you watched\" posters from the bridge's picks", needs: ["Needs the computer bridge with its picks running"],
      setup: setup("computer", "Set up option B (the computer bridge). The widget itself is not wired up yet."), until: "\"Picks for you are not on couch-tv's home yet\", and what it needs",
      build: "The home has to ask the bridge's /api/recs for the person watching and hand the answer to this widget, as it does for Keep watching.",
      ok: "Opens the picks, each one playable (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- apps ----------
    app: { name: "One app", status: "works", what: "A single app as a big icon", needs: ["The app installed on this TV"],
      setup: setup("tv", "Install the app on the TV. A design names it, the TV opens it."), until: "\"This app is not on this TV\"", build: "",
      ok: "Opens the app", platforms: plat("yes", "yes", "", "Opened through the computer bridge. VIDAA's standalone home cannot open apps."), sizes: sz(["tile", "small"], [2, 2]) },
    folder: { name: "App folder", status: "works", what: "A box of apps with a name", needs: ["The apps installed on this TV"],
      setup: setup("designer", "Pick the apps in couch-tv Studio. Apps this TV does not have are left out."), until: "\"These apps are not on this TV\"", build: "",
      ok: "Opens the folder full screen, every app in a grid", platforms: plat("yes", "yes", "", "Opened through the computer bridge."), sizes: sz(["tile", "small", "tall", "medium", "large"], [2, 2]) },
    dock: { name: "Dock", status: "works", what: "A row of your apps in a bar", needs: ["The apps installed on this TV"],
      setup: setup("nothing", "Nothing: it shows this TV's apps in your order."), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it. The last tile opens all apps", platforms: plat("yes", "yes", "", "Opened through the computer bridge."), sizes: sz([], [6, 2], [["row8", "Short row", 8, 2], ["row12", "Row", 12, 2], ["row18", "Full row", 18, 2]]) },
    appgrid: { name: "App grid", status: "works", what: "Rows of apps with their names", needs: ["The apps installed on this TV"],
      setup: setup("nothing", "Nothing: it shows this TV's apps in your order."), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it", platforms: plat("yes", "yes", "", "Opened through the computer bridge."), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    games: { name: "Games", status: "works", what: "Game apps as tall tiles", needs: ["Game apps installed on this TV"],
      setup: setup("designer", "Pick the game apps in couch-tv Studio."), until: "\"These apps are not on this TV\"", build: "",
      ok: "OK on a game opens it", platforms: plat("yes", "yes", "", "Opened through the computer bridge."), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- music ----------
    nowplaying: { name: "Now playing", status: "setup", what: "The song any app on this TV is playing: cover, song, artist", needs: [BRIDGE_NEED],
      setup: setup("computer", BRIDGE_HOW + " Android only lets those read what another app plays."), until: "\"Nothing playing\" while nothing plays", build: "",
      ok: "Opens the player: previous, play or pause, next, volume, the song's progress", platforms: plat("setup", "no", "", "Samsung, LG and the browser TVs do not tell the network what is playing."), sizes: sz(["tile", "wtile", "small", "medium", "large"], [2, 2]) },
    soundscape: { name: "Soundscape", status: "works", what: "Rain, fire, waves or brown noise, played by the home", needs: ["Nothing: the sounds ship with couch-tv"],
      setup: setup("nothing", "Nothing to set up."), until: "Always ready", build: "",
      ok: "Starts or stops the sound", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile"], [2, 2]) },
    queue: { name: "Up next queue", status: "not-built", what: "The next songs", needs: ["Needs a Spotify sign in on the computer bridge", "Android does not share an app's queue"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"The song queue is not on couch-tv yet\", and what it needs", build: "The bridge has to read the queue from the Spotify Web API (the person signs in to Spotify once on the computer) and hand it to the home.",
      ok: "Opens the queue (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["small", "tall", "large"], [4, 4]) },
    speakers: { name: "Speakers", status: "not-built", what: "Each room's speaker and its volume", needs: ["Needs Home Assistant speakers (media players) on couch-tv"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Speakers are not on couch-tv yet\", and what it needs", build: "HomeAssistant.kt has to allow media_player entities named in config.json (volume and play or pause), as it does for climate today.",
      ok: "Opens the speakers with a volume for each (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall"], [4, 2]) },

    // ---------- smart home (Home Assistant, through the Android launcher) ----------
    aircon: { name: "Aircon", status: "setup", what: "A room's set temperature, what it is now, and the other rooms", needs: [HA_NEED, "Your aircon rooms named in config.json (climate entities)"],
      setup: setup("computer", HA_HOW), until: "A card on the widget: \"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Aircon: every room, warmer and cooler, on and off, mode and fan speed", platforms: ANDROID_ONLY("Home Assistant goes through the Android launcher."), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    scenes: { name: "Scenes", status: "setup", what: "Your Home Assistant scenes and scripts as big buttons", needs: [HA_NEED, "The scenes named in config.json (scene or script entities)"],
      setup: setup("computer", HA_HOW), until: "A card on the widget: \"Needs Home Assistant\", and where it is set up", build: "",
      ok: "OK on a button runs it. On a tile, OK opens Scenes with every button", platforms: ANDROID_ONLY("Home Assistant goes through the Android launcher."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    controls: { name: "Control Centre", status: "not-built", what: "Lights, lamps, blinds and locks as toggles", needs: [HA_NEED, "Needs couch-tv to switch lights, switches and blinds (only aircon and scenes today)"],
      setup: setup("computer", "Today: put your lights in a Home Assistant scene and use the Scenes widget. " + HA_HOW), until: "\"Lights and switches are not on couch-tv yet\", and what it needs",
      build: "HomeAssistant.kt has to allow light, switch, cover and fan entities named in config.json (turn on, off, open, close), with the page asking for them as it asks for climate. Locks stay out on purpose: nothing that opens the house from a TV remote.",
      ok: "Opens Control Centre: every toggle big (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium", "wide", "large"], [2, 2]) },
    camera: { name: "Camera", status: "not-built", what: "A still from a camera, refreshed while on screen", needs: [HA_NEED, "Needs couch-tv to fetch camera pictures into the home"],
      setup: setup("nothing", "Nothing you can set up yet. The doorbell pop up (config.json, home_assistant) already shows a door camera over everything when it rings."),
      until: "\"Camera pictures are not on couch-tv's home yet\", and what it needs",
      build: "HomeAssistant.kt has to fetch camera_proxy stills for camera entities named in config.json and hand them to the page as pictures that never leave the house.",
      ok: "Opens the camera full screen, a new still every two seconds (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    doorbell: { name: "Doorbell", status: "not-built", what: "The last ring with a still", needs: [HA_NEED, "Needs the doorbell's last ring handed to the home"],
      setup: setup("nothing", "Nothing you can set up for this widget yet. The doorbell pop up already works: config.json, home_assistant, doorbell."),
      until: "\"The doorbell widget is not on couch-tv yet\", and that the pop up works", build: "The launcher already hears the doorbell (DoorbellWatch); it has to keep the last ring's time and still for the page.",
      ok: "Opens the last ring full screen (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    energy: { name: "Solar and energy", status: "not-built", what: "Made today, money back, the day's curve", needs: [HA_NEED, "Needs couch-tv to read Home Assistant sensors"],
      setup: setup("computer", "Today: show a solar number with a Custom card on the computer bridge (custom_cards in config.json)."), until: "\"Solar readings are not on couch-tv yet\", and the Custom card way round",
      build: "HomeAssistant.kt has to allow sensor entities named in config.json and return their readings; the widget then draws today's curve from Home Assistant's history.",
      ok: "Opens Energy: today by the hour (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    sensor: { name: "Sensor", status: "not-built", what: "One reading: pool, rain gauge, humidity", needs: [HA_NEED, "Needs couch-tv to read Home Assistant sensors"],
      setup: setup("computer", "Today: a Custom card on the computer bridge shows any number (custom_cards in config.json)."), until: "\"Sensors are not on couch-tv yet\", and the Custom card way round",
      build: "HomeAssistant.kt has to allow sensor entities named in config.json and return their state and unit.",
      ok: "Opens the reading with its last 24 hours (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    battery: { name: "Batteries", status: "not-built", what: "Remotes and controllers as rings", needs: ["Android TV does not tell apps a remote's or controller's battery"],
      setup: setup("nothing", "Nothing can be set up: the TV does not share it."), until: "\"Batteries are not available on a TV\"", build: "Not possible on the TV itself. Home Assistant's phone app could report phone batteries, through sensor support (see Sensor).",
      ok: "Nothing", platforms: NOWHERE("The TV does not share battery levels."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- lists and the family ----------
    bins: { name: "Bin night", status: "setup", what: "Tonight's bins with their lid colours", needs: ["Your bin night and bins, picked in couch-tv Studio"],
      setup: setup("designer", "Pick the night, the bins and whether they take turns in couch-tv Studio. Nothing personal goes in the design."), until: "\"Set your bin night in couch-tv Studio\"", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY("Works with no computer."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    people: { name: "People", status: "works", what: "Who is watching; OK switches", needs: ["People added when couch-tv was set up"],
      setup: setup("phone", "From the phone remote's People sheet, or config.json people. Switching here changes whose Keep watching shows, inside couch-tv only: it does not sign anyone in or out of Netflix or Google."),
      until: "\"Add people in Home settings\"", build: "",
      ok: "OK on a name makes them the one watching", platforms: plat("yes", "yes", "", "With the computer bridge running at home."), sizes: sz(["line", "wline", "wtile"], [4, 1]) },
    agenda: { name: "Agenda", status: "not-built", what: "Today's events with colours and times", needs: ["Needs a private calendar link (iCal) kept on the TV, read by the TV or the bridge"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Your calendar is not on couch-tv yet\", and what it needs",
      build: "Home settings has to keep a private iCal link (Google, Apple or Outlook) on the TV, never in a design, and the bridge or the TV has to read today's events from it.",
      ok: "Opens the day: every event on a timeline (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    note: { name: "Family note", status: "not-built", what: "A sticky note typed at home", needs: ["Needs a note typed from the phone remote and kept on the TV"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Family notes are not on couch-tv yet\", and what it needs",
      build: "The phone remote needs a Note sheet that saves the words on the TV (not in the design, which refuses digits and links).",
      ok: "Opens the note big (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    list: { name: "List", status: "not-built", what: "Reminders or shopping, ticked from the phone", needs: ["Needs Home Assistant to-do lists, or a list kept on the bridge"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Lists are not on couch-tv yet\", and what it needs",
      build: "HomeAssistant.kt has to allow todo entities named in config.json (read and tick), or the bridge has to keep a list the phone remote edits.",
      ok: "Opens the whole list, tick with OK (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall", "large"], [4, 2]) },

    // ---------- info ----------
    card: { name: "Custom card", status: "setup", what: "Any household number the computer bridge reads: solar today, the pool", needs: ["Needs the computer bridge, with custom_cards in config.json"],
      setup: setup("computer", "On the computer: add custom_cards to config.json (docs/CONFIG.md, Custom cards). Each card is a title, a value read from a file or link at home, and an optional app or link."),
      until: "A card on the widget: what it needs, and that it is set up on the computer at home", build: "",
      ok: "Opens every custom card big", platforms: plat("setup", "setup", "", "With the computer bridge running at home."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    quote: { name: "Quote", status: "works", what: "A short line for the day, from a list on the TV, or your own words", needs: ["Nothing: the lines ship with couch-tv"],
      setup: setup("nothing", "Nothing to set up. Type your own line in couch-tv Studio if you like."), until: "Always shows a line", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    word: { name: "Word of the day", status: "works", what: "A word and what it means, from a list on the TV", needs: ["Nothing: the words ship with couch-tv"],
      setup: setup("nothing", "Nothing to set up."), until: "Always shows a word", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY("Works with no computer."), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    news: { name: "Headlines", status: "not-built", what: "One to four headlines from a news feed", needs: ["Needs the computer bridge to read a news feed (RSS) for the TV"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Headlines are not on couch-tv yet\", and what it needs",
      build: "The bridge has to read a chosen RSS feed (ABC News and most Australian outlets publish one) and hand the titles to the home; a TV page cannot read most feeds itself (browsers block it).",
      ok: "Opens the headlines in full (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    sports: { name: "Scores", status: "not-built", what: "Scores for your teams", needs: ["Needs a free, reliable score feed for the NRL, AFL and A-League (none exists today)"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Scores are not on couch-tv yet\", and why",
      build: "A score source the TV may use: official feeds are paid, TheSportsDB's free tier is patchy for the NRL and AFL, and ESPN's are unofficial. Once one is picked, the bridge reads it for the chosen teams.",
      ok: "Opens the round: every game with its score (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    stocks: { name: "Markets", status: "not-built", what: "The ASX, a few shares and the dollar", needs: ["Needs a free market feed the TV may use"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Markets are not on couch-tv yet\", and why",
      build: "A market source: free share prices are unofficial or delayed; CoinGecko is free for crypto. The bridge would read it for the watchlist kept on the TV.",
      ok: "Opens the watchlist with today's charts (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "tall"], [2, 2]) },
    commute: { name: "Commute", status: "not-built", what: "Drive time and when to leave", needs: ["Needs live traffic, which only paid map services give"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Drive times are not on couch-tv yet\", and why",
      build: "A traffic source (paid) or OSRM's free drive time without traffic, with the home and work places kept on the TV only.",
      ok: "Opens the drive with when to leave (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- guests and the room ----------
    welcome: { name: "Welcome words", status: "works", what: "A greeting in your own words", needs: ["Nothing: the words are typed in couch-tv Studio"],
      setup: setup("designer", "Type the words in couch-tv Studio. No digits or web addresses: a design never carries those."), until: "Always shows the words", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY("Works with no computer."), sizes: sz(["wline", "wtile", "medium", "wide"], [4, 1]) },
    quick: { name: "Quick buttons", status: "works", what: "Sleep timer, picture mode, look, input and more", needs: ["Some buttons need the computer bridge or an Android TV (picture mode, input)"],
      setup: setup("designer", "Pick the buttons in couch-tv Studio. Picture mode needs the computer bridge; the home leaves out any button this TV cannot do."),
      until: "Buttons this TV cannot do are left out", build: "",
      ok: "OK on a button does it: the sleep timer, the next picture mode, the next look, the input list", platforms: plat("yes", "partial", "", "Picture mode is Android only (docs/SAMSUNG.md). The home leaves out any button this TV cannot do."), sizes: sz(["line", "wline", "tile", "wtile"], [2, 1]) },
    wifi: { name: "Guest Wi-Fi", status: "not-built", what: "The network and a code to join", needs: ["Needs the Wi-Fi name and password kept on the TV (never in a design)"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Guest Wi-Fi is not on couch-tv yet\", and what it needs",
      build: "Home settings has to keep the guest network's name and password on the TV, and the home has to draw the join code there. A password has digits, so it can never travel in a design.",
      ok: "Opens the join code big, for a phone camera (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["small", "medium", "wide"], [4, 4]) },
    guide: { name: "House guide", status: "not-built", what: "House guide, check out, around here", needs: ["Needs guest-tv's house guide screens opened from couch-tv"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"The house guide is not on couch-tv yet\", and what it needs", build: "couch-tv has to open guest-tv's guide screens, with the guide written on the TV.",
      ok: "Opens the house guide (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall"], [4, 2]) },
    screentime: { name: "Screen time", status: "not-built", what: "Minutes left today and bedtime", needs: ["Needs time limits in couch-tv's Kids mode (it has a PIN today, not a time limit)"],
      setup: setup("nothing", "Nothing you can set up yet."), until: "\"Screen time is not on couch-tv yet\", and what it needs", build: "Kids mode has to keep a daily limit and a bedtime on the TV and count what the kids profile watches.",
      ok: "Opens today's screen time (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- a smart stack (not a widget of its own: up to 10 widgets taking turns) ----------
    stack: { name: "Smart stack", status: "works", what: "Up to 10 widgets of one size taking turns in one place", needs: ["Whatever the widgets in it need"],
      setup: setup("designer", "Make it in couch-tv Studio: drop widgets of one size on each other."), until: "Each widget in it says what it needs", build: "",
      ok: "OK opens what the widget showing opens. Left and Right flick through it", platforms: EVERY("As its widgets."), sizes: sz([], [2, 2]) }
  };

  // A widget couch-tv cannot fill yet always shows the same card on a TV (widgets.js soon()), so its
  // `until` says exactly that, rather than each record wording it its own way
  Object.keys(C).forEach(function (k) {
    if (C[k].status === "not-built") C[k].until = "A card on the widget: \"" + C[k].name + ": not on couch-tv yet\" and what it needs. OK on it opens this record.";
  });

  // the setup card a TV shows for a widget that has nothing real to show yet: the first line says what
  // is missing, the second where it is set up. Built only from this file, never from a design.
  var WHERE = { tv: "Set up on this TV", phone: "Set up from the phone remote", computer: "Set up on the computer at home", designer: "Set up in couch-tv Studio", nothing: "" };
  var SHORT = {};
  // [the line, where it is set up, the line for a tile (two short lines at most)]
  SHORT[HA_NEED] = ["Needs Home Assistant", "Set up on the computer at home: config.json, Smart home", "Needs Home Assistant"];
  SHORT[BRIDGE_NEED] = ["Needs the computer bridge or the on-TV app", "couch-tv's setup guide, option B or C", "Needs the bridge"];
  SHORT[TOWN_NEED] = ["Set your town for the weather", "On this TV: Home settings, Weather, Place", "Set your town"];
  SHORT[PHOTOS_NEED] = ["Add your photos on the TV", "Home settings, Your photos", "Add photos"];
  // tiny: the box is a tile, so the line has to fit two short lines (OK opens the whole record)
  function card(kind, tiny) {
    var c = C[kind];
    if (!c) return { line: tiny ? "Needs an update" : "This widget needs a newer couch-tv", sub: "" };
    if (c.status === "not-built") return { line: tiny ? "Not built yet" : c.name + ": not on couch-tv yet", sub: c.needs[0].replace(/^Needs /, "It needs ") };
    var s = SHORT[c.needs[0]];
    if (s) return { line: tiny ? s[2] : s[0], sub: s[1] };
    return { line: tiny ? "Set up needed" : c.needs[0], sub: WHERE[c.setup.where] || "" };
  }

  var API = {
    v: 1,
    platforms: PLATFORMS.slice(),
    kinds: function () { return Object.keys(C); },
    get: function (kind) { return C[kind] || null; },
    all: function () { return C; },
    on: function (kind, platform) { var c = C[kind]; return c && c.platforms[platform] ? c.platforms[platform].on : "no"; },
    card: card
  };
  root.CouchWidgetCaps = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
