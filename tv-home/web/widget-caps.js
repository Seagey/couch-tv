// What every widget needs to show real things, how to set it up on each kind of TV, what it shows
// until then, what OK opens, which TVs can run it, and the sizes it comes in. One record per widget
// kind, read by the TV (widgets.js draws the setup card from it, widget-detail.js the setup steps) and
// by couch-tv Studio (the info tips, the gallery badges and the size menu). Data only: no page, no
// network.
//
// A record:
//   name        the widget's name
//   status      "works"      real on the TV with nothing more to set up
//               "setup"      real once the thing in `needs` is set up (the steps in `setup`)
//               "not-built"  couch-tv cannot fill it yet; `build` says what has to be written first
//   what        one line: what it shows on a real TV
//   needs       plain lines, each one thing it needs
//   setup       { where, how, steps }:
//                 where  "nothing", "tv", "phone", "computer" or "designer": where it is set up
//                 how    the steps for a Google TV, Android TV or Fire TV as one plain line (kept for
//                        the designer's older tips)
//                 steps  { android: [...], web: [...], vidaa: [...] }: numbered steps, each one thing
//                        the person does, with the real menu names on the TV. "android" is Google TV,
//                        Android TV and Fire TV; "web" is Samsung, LG, Philips, TiVo OS and Panasonic,
//                        where a computer at home runs the home; "vidaa" is a Hisense VIDAA TV, which
//                        can also run the home as a website with no computer. API.steps(kind, platform)
//                        picks the right list.
//   until       what the person sees on the TV until it is set up: a setup card, never pretend data
//   build       for "not-built": what has to be built; otherwise ""
//   ok          what OK on the remote opens (the detail layer, widget-detail.js), or what it does
//   platforms   { <tvs/platform-setup.js key>: { on, need, note } }
//                 on    "yes" | "setup" | "partial" | "no" (the older field the designer reads)
//                 need  "works" (nothing to do), "setup" (a step on the TV or in couch-tv Studio),
//                       "computer" (needs a computer at home that stays on) or "no" (not possible)
//                 note  one plain line about that TV
//   sizes       { s: named sizes, min: [w, h] in half cells, x: extra sizes } (the shape of
//               tools/tv-designer/app/grid.js W[kind]; the smallest size that still reads comes first)
//
// ES5 on purpose: old Android TV WebViews. Also a CommonJS module for tests and the designer.
(function (root) {
  "use strict";

  // the keys of tools/tv-designer/tvs/platform-setup.js, in its order
  var PLATFORMS = ["Google TV", "Android TV", "Fire OS", "Vega OS", "Tizen", "webOS", "Roku OS", "VIDAA", "Titan OS", "Saphi", "tvOS",
    "TiVo OS", "SmartCast", "My Home Screen", "Other", "unknown"];
  // Google TV, Android TV and Fire TV: couch-tv's home is the TV's own home app (it has Home
  // Assistant, the TV's photos, the on-TV app and what is playing).
  var ANDROID = ["Google TV", "Android TV", "Fire OS"];
  // Samsung, LG, Philips (Saphi), TiVo OS and Panasonic: the same home as a web page, opened by a
  // computer at home that stays on (docs/SAMSUNG.md, LG.md, PHILIPS-SAPHI.md, TIVO.md, PANASONIC.md).
  var WEB = ["Tizen", "webOS", "Saphi", "TiVo OS", "My Home Screen"];
  // Hisense VIDAA: a computer at home, or the home as a website with no computer (docs/VIDAA.md); the
  // website cannot open apps.
  var VIDAA = ["VIDAA"];
  // Roku, Apple TV, Fire TV on Vega OS, Philips on Titan OS, VIZIO and unknown TVs: their couch-tv
  // (where there is one) does not draw couch-tv Studio designs.
  var NO_HOME = "couch-tv Studio designs do not show on this TV yet.";
  var NOT_HERE = ["Not possible on this TV: couch-tv Studio designs show on Google TV, Android TV, Fire TV, Samsung, LG, Hisense, Philips (older), TiVo OS and Panasonic TVs."];

  function groupOf(p) { return ANDROID.indexOf(p) >= 0 ? "android" : WEB.indexOf(p) >= 0 ? "web" : VIDAA.indexOf(p) >= 0 ? "vidaa" : "none"; }
  // the older "on" from the honest need: on a Samsung or LG the home itself runs from the computer, so
  // a widget that works the moment the home runs was always "yes" there
  function onOf(need, group) { return need === "works" ? "yes" : need === "no" ? "no" : need === "computer" && group === "web" ? "yes" : "setup"; }
  // the table: one need (and note) for each group; "web:partial" style overrides keep an older "partial"
  function plat(a, w, v, notes) {
    notes = notes || {};
    var out = {};
    PLATFORMS.forEach(function (p) {
      var g = groupOf(p), spec = g === "android" ? a : g === "web" ? w : g === "vidaa" ? v : "no", parts = String(spec).split(":"), need = parts[0];
      out[p] = { on: parts[1] || onOf(need, g), need: need, note: g === "none" ? NO_HOME : notes[g] || DEFAULT_NOTE[need] || "" };
    });
    return out;
  }
  var DEFAULT_NOTE = { works: "Works with nothing to set up.", setup: "Works once it is set up.", computer: "Needs a computer at home that stays on, running couch-tv.", no: "Not possible on this TV." };
  // the usual three: works on the Android home, needs the home computer on a web TV, works on a VIDAA
  // (the website home with no computer, or the computer)
  var EVERY = function () { return plat("works", "computer", "works", { web: "Works while the home computer is on (it runs couch-tv for this TV)." }); };
  var NOWHERE = function (why) { return plat("no", "no", "no", { android: why, web: why, vidaa: why }); };
  function sz(s, min, x) { var o = { s: s, min: min }; if (x) o.x = x; return o; }
  // steps for each group; one list given for "all" is used for every group
  function setup(where, steps) {
    if (Object.prototype.toString.call(steps) === "[object Array]") steps = { android: steps, web: steps, vidaa: steps };
    return { where: where, how: steps.android.join(" "), steps: steps };
  }

  // ---------------- the words used again and again ----------------
  var OPEN = "Press Settings on the remote (or OK on the gear at the end of your apps), then pick Home settings.";
  var SEND = "Tap Send to my TV, then on the TV: Home settings, couch-tv Studio, Get a design, and type the code.";
  function inStudio(what) { return ["Open your design in couch-tv Studio on your phone.", "Tap the widget, then " + what + ".", SEND]; }
  var TOWN = [OPEN, "Go down to Location and press OK.", "Pick Search for a town or city, type your town, then press OK.", "Pick your town in the list. The weather shows within a minute."];
  var BEACH = [OPEN, "Go down to Location and press OK.", "Pick Search for a town or city, type the beach town nearest you, then press OK.", "Pick it in the list. The swell shows within a minute (inland towns have no swell)."];
  var PHOTOS_ANDROID = [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add photos from a USB drive or this TV, and choose up to 50 photos.", "Or put one photo in the widget itself, in couch-tv Studio."];
  var PHOTOS_LINK = [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "Or put one photo in the widget itself, in couch-tv Studio."];
  var NOTHING = ["Nothing to set up."];
  var NOT_YET = ["Nothing to set up: couch-tv cannot show this yet."];
  var WATCH = {
    android: ["Ask whoever set up couch-tv to add the couch-tv TV app (setup option C) or a home computer that stays on (option B).", "Start a show from couch-tv's home.", "Come back to the home: the show is waiting here."],
    web: ["Keep the home computer on: it runs couch-tv for this TV.", "Start a show from couch-tv's home (Netflix, YouTube and some others).", "Come back to the home: the show is waiting here."],
    vidaa: ["Needs a computer at home that stays on, running couch-tv (setup option B). The website home cannot do this.", "Start a show from couch-tv's home.", "Come back to the home: the show is waiting here."]
  };
  var SMART_HOME = {
    android: ["Needs Home Assistant, the smart home app, running at home.", "Whoever set up couch-tv adds your rooms once on their computer (setup guide, Smart home) and puts couch-tv on the TV again.", "Press Home: your rooms show here."],
    web: ["Not possible on this TV: smart home controls need a Google TV, Android TV or Fire TV."],
    vidaa: ["Not possible on this TV: smart home controls need a Google TV, Android TV or Fire TV."]
  };
  var APPS_ORDER = [OPEN, "Go down to Apps and press OK.", "OK moves an app between the home, More apps and hidden. Hold OK on an app to move it along."];

  // things typed at home: Home settings, couch-tv Studio, At home (athome.js), kept on the TV only
  var AT_HOME = "Go down to couch-tv Studio, then pick At home.";
  var TYPE_PHONE = "Typing is quicker with the phone remote: Type on the TV puts the words in the box.";
  var TYPE_TV = "Type with the TV remote's keyboard, then press OK.";
  function typed(first) { return { android: [OPEN, AT_HOME].concat(first, [TYPE_PHONE]).slice(0, 5), web: [OPEN, AT_HOME].concat(first, [TYPE_TV]).slice(0, 5), vidaa: [OPEN, AT_HOME].concat(first, [TYPE_TV]).slice(0, 5) }; }
  var KEPT = { android: "Kept on this TV only, never in a design.", web: "Kept on this TV only, never in a design. The home computer has to be on.", vidaa: "Kept in this TV's browser only, never in a design." };
  var NOTE_NEED = "A note typed on the TV";
  var LIST_NEED = "A list typed on the TV";
  var WIFI_NEED = "The guest Wi-Fi's name and password, typed on the TV";
  var GUIDE_NEED = "The guide, typed on the TV";
  var CAL_NEED = "Your calendar's private address, typed on the TV";
  var DATED_NEED = "Your photos on the TV, with the day each was taken";
  var SCREEN_NEED = "A Google TV, Android TV or Fire TV that allows screen time";

  var TOWN_NEED = "Your town, set on the TV";
  var PHOTOS_NEED = "Your photos on the TV, or one photo put in the widget";
  var WATCH_NEED = "The couch-tv TV app or a computer at home that stays on";
  var HA_NEED = "Home Assistant (a smart home app) running at home";

  var C = {
    // ---------- time ----------
    clock: { name: "Digital clock", status: "works", what: "The time, with the date if you like", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", ["Nothing to set up.", "For 12 or 24 hour: " + OPEN.charAt(0).toLowerCase() + OPEN.slice(1), "Go down to Look and scenes, then press OK on Clock."]),
      until: "Always shows the time", build: "",
      ok: "Opens Timers: start a kitchen timer from the remote", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    tallclock: { name: "Tall clock", status: "works", what: "Tall thin digits that fill the space", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", NOTHING), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    glassclock: { name: "Glass clock", status: "works", what: "Big digits filled with the scene's photo", needs: ["Nothing: the scenes come with couch-tv"],
      setup: setup("nothing", NOTHING), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "wide", "xl", "hero"], [4, 2]) },
    analog: { name: "Analogue clock", status: "works", what: "A clock face with hands", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", NOTHING), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["tile", "small", "large"], [2, 2]) },
    flipclock: { name: "Flip clock", status: "works", what: "Digits on flip cards", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", NOTHING), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "medium", "wide"], [4, 2]) },
    wordclock: { name: "Time in words", status: "works", what: "\"Twenty to eight, Wednesday morning\"", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", NOTHING), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    solar: { name: "Sun clock", status: "works", what: "The sun's path today, with sunrise and sunset", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town for the sun\", and where", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    worldclock: { name: "World clocks", status: "works", what: "The time in two to four cities", needs: ["The cities, picked in couch-tv Studio"],
      setup: setup("designer", inStudio("pick the cities")), until: "Always shows the times", build: "",
      ok: "Opens World clocks: every city big, day or night", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    countdown: { name: "Countdown", status: "works", what: "Sleeps, days or weeks to a date", needs: ["The date and its name, picked in couch-tv Studio"],
      setup: setup("designer", inStudio("pick the date and type its name")), until: "Always shows the count", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    date: { name: "Date", status: "works", what: "Today's date, with the weather if you like", needs: ["Nothing for the date. The weather line needs your town"],
      setup: setup("nothing", ["Nothing to set up for the date.", "For the weather line, set your town: " + OPEN.charAt(0).toLowerCase() + OPEN.slice(1), "Go down to Location, pick Search for a town or city, type your town, then press OK."]),
      until: "Always shows the date", build: "",
      ok: "Opens Calendar: this month and today", platforms: EVERY(), sizes: sz(["line", "wline", "tile", "small"], [2, 1]) },
    month: { name: "Month", status: "works", what: "This month's calendar, with today marked", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", NOTHING), until: "Always shows the month", build: "",
      ok: "Opens Calendar: this month and next", platforms: EVERY(), sizes: sz(["tile", "small", "large"], [2, 2]) },
    timer: { name: "Timer", status: "works", what: "A ring counting down a timer you start with the remote", needs: ["Nothing: timers are kept on the TV"],
      setup: setup("nothing", ["Nothing to set up.", "To start one: move to the widget and press OK.", "Pick the minutes. It counts down here."]),
      until: "\"No timer. OK to start one\"", build: "",
      ok: "Opens Timers: 1 to 60 minutes, add a minute, cancel", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },

    // ---------- weather (free, straight from the TV, no account) ----------
    weather: { name: "Weather", status: "works", what: "Your town, the temperature, the sky, the high and low", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\", or \"Weather is off on this TV\"", build: "",
      ok: "Opens the forecast: the next 24 hours and the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    bigtemp: { name: "Big number", status: "works", what: "One huge temperature, coloured for the day", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "small", "medium", "large"], [2, 2]) },
    hourly: { name: "Hourly", status: "works", what: "The next few hours: time, sky and temperature", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: 24 hours with the chance of rain", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    week: { name: "This week", status: "works", what: "The next 7 days, with each day's high and low", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: the 7 days in full", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "tall", "medium", "large"], [4, 2]) },
    rain: { name: "Rain soon", status: "works", what: "Rain in the next three hours, as bars", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: the chance of rain by the hour", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    uv: { name: "UV index", status: "works", what: "Today's UV and how strong it is", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: UV by the hour", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    sun: { name: "Sunrise and sunset", status: "works", what: "Today's sunrise and sunset, and the sun's path", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town for the sun\"", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    moon: { name: "Moon", status: "works", what: "Tonight's moon and the next full moon", needs: ["Nothing: worked out on the TV"],
      setup: setup("nothing", NOTHING), until: "Always shows the moon", build: "",
      ok: "Opens the moon: the next four weeks", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    air: { name: "Air quality", status: "works", what: "How clean the air is, as a number and a word", needs: [TOWN_NEED],
      setup: setup("tv", TOWN), until: "\"Set your town\"", build: "",
      ok: "Opens Air quality: the next 12 hours", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    surf: { name: "Surf", status: "works", what: "The swell (height, seconds apart, direction) and the wind at the coast nearest your town", needs: ["Your town, set on the TV: pick the beach town nearest you", "A town near the coast: inland there is no swell"],
      setup: setup("tv", BEACH), until: "\"Set your town\", or \"No surf reading here\" inland", build: "",
      ok: "Opens Surf: the swell by the hour today", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium"], [4, 2]) },

    // ---------- photos ----------
    photo: { name: "Photo", status: "setup", what: "One of your photos", needs: [PHOTOS_NEED],
      setup: setup("tv", { android: PHOTOS_ANDROID, web: PHOTOS_LINK, vidaa: PHOTOS_LINK }), until: "\"Add your photos\", and where", build: "",
      ok: "Opens your photos full screen, as a slideshow", platforms: plat("setup", "computer:partial", "setup:partial", { web: "Photos are added by web address on this TV (no USB).", vidaa: "Photos are added by web address on this TV (no USB)." }), sizes: sz(["tile", "wtile", "small", "tall", "medium", "wide", "large", "xl", "hero", "full"], [2, 2]) },
    slideshow: { name: "Slideshow", status: "setup", what: "Your photos, one after another", needs: [PHOTOS_NEED],
      setup: setup("tv", { android: PHOTOS_ANDROID, web: PHOTOS_LINK, vidaa: PHOTOS_LINK }), until: "\"Add your photos\"", build: "",
      ok: "Opens your photos full screen: Left and Right to flick, OK to pause", platforms: plat("setup", "computer:partial", "setup:partial", { web: "Photos are added by web address on this TV (no USB).", vidaa: "Photos are added by web address on this TV (no USB)." }), sizes: sz(["tile", "wtile", "small", "tall", "medium", "wide", "large", "xl", "hero", "full"], [2, 2]) },
    mosaic: { name: "Photo mosaic", status: "setup", what: "Three to five of your photos in a collage", needs: [PHOTOS_NEED],
      setup: setup("tv", { android: PHOTOS_ANDROID, web: PHOTOS_LINK, vidaa: PHOTOS_LINK }), until: "\"Add your photos\"", build: "",
      ok: "Opens your photos full screen, as a slideshow", platforms: plat("setup", "computer:partial", "setup:partial", { web: "Photos are added by web address on this TV (no USB).", vidaa: "Photos are added by web address on this TV (no USB)." }), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    artframe: { name: "Art frame", status: "setup", what: "One photo in a frame with a label", needs: [PHOTOS_NEED],
      setup: setup("tv", { android: PHOTOS_ANDROID, web: PHOTOS_LINK, vidaa: PHOTOS_LINK }), until: "\"Add your photos\"", build: "",
      ok: "Opens the picture full screen, without the frame", platforms: plat("setup", "computer:partial", "setup:partial", { web: "Photos are added by web address on this TV (no USB).", vidaa: "Photos are added by web address on this TV (no USB)." }), sizes: sz(["small", "tall", "large", "xl", "hero", "full"], [4, 4]) },
    memory: { name: "On this day", status: "not-built", what: "A photo from this date in past years", needs: ["Needs couch-tv to know the date each photo was taken"],
      setup: setup("nothing", NOT_YET), until: "\"On this day: not on couch-tv yet\", and what it needs", build: "The launcher has to read each photo's taken date (EXIF) when it is added in Home settings, Your photos, and keep it on the TV.",
      ok: "Opens the photos from this day full screen (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- watching ----------
    keep: { name: "Keep watching", status: "setup", what: "The show you were watching, ready to carry on", needs: [WATCH_NEED],
      setup: setup("computer", WATCH), until: "\"Nothing to keep watching yet\": shows you start on this TV appear here", build: "",
      ok: "Opens Keep watching: every show on the go, each with Resume", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from couch-tv's home.", vidaa: "Only with a computer at home: the website home cannot." }), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    keeprow: { name: "Keep watching row", status: "setup", what: "Two to five shows, with how far you got", needs: [WATCH_NEED],
      setup: setup("computer", WATCH), until: "\"Nothing to keep watching yet\"", build: "",
      ok: "OK on a poster plays it. Hold OK, then Open, for the whole list", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from couch-tv's home.", vidaa: "Only with a computer at home: the website home cannot." }), sizes: sz(["medium", "wide", "hero"], [6, 2]) },
    upnext: { name: "Up next", status: "setup", what: "One show filling the space, with Resume and Start over. Beside Scores it shows your last game", needs: [WATCH_NEED],
      setup: setup("computer", WATCH), until: "\"Nothing to keep watching yet\", or \"No game to pick up\"", build: "",
      ok: "Resume plays it. Hold OK, then Open, for the whole list", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from couch-tv's home.", vidaa: "Only with a computer at home: the website home cannot." }), sizes: sz(["medium", "wide", "xl", "hero", "full"], [8, 4]) },
    picks: { name: "Picks for you", status: "not-built", what: "\"Because you watched\" posters", needs: ["Needs couch-tv's picks brought to the home (they are on the home computer only)"],
      setup: setup("nothing", NOT_YET), until: "\"Picks for you: not on couch-tv yet\", and what it needs",
      build: "The home has to ask the bridge's /api/recs for the person watching and hand the answer to this widget, as it does for Keep watching.",
      ok: "Opens the picks, each one playable (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- apps ----------
    app: { name: "One app", status: "works", what: "One app as a big icon", needs: ["The app installed on this TV"],
      setup: setup("tv", { android: ["Go to More apps at the end of your apps, then open App Store.", "Find the app and install it.", "Press Home: it shows in this widget."],
        web: ["Install the app from the TV's own app store.", "Keep the home computer on: it opens apps for couch-tv."],
        vidaa: ["Install the app from the TV's own app store.", "Needs a computer at home to open it: the website home cannot open apps."] }),
      until: "\"This app is not on this TV\"", build: "",
      ok: "Opens the app", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["tile", "small"], [2, 2]) },
    folder: { name: "App folder", status: "works", what: "A box of apps with a name", needs: ["The apps, picked in couch-tv Studio and installed on this TV"],
      setup: setup("designer", inStudio("pick the apps for it. Apps this TV does not have are left out")), until: "\"These apps are not on this TV\"", build: "",
      ok: "Opens the folder full screen, every app big", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["tile", "small", "tall", "medium", "large"], [2, 2]) },
    dock: { name: "Dock", status: "works", what: "A row of your apps", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it. The last one opens all your apps", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz([], [6, 2], [["row8", "Short row", 8, 2], ["row12", "Row", 12, 2], ["row18", "Full row", 18, 2]]) },
    appgrid: { name: "App grid", status: "works", what: "Rows of apps with their names", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    games: { name: "Games", status: "works", what: "Game apps as tall tiles", needs: ["Game apps installed on this TV"],
      setup: setup("designer", inStudio("pick the game apps")), until: "\"These apps are not on this TV\"", build: "",
      ok: "OK on a game opens it", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- music ----------
    nowplaying: { name: "Now playing", status: "setup", what: "The song playing on this TV: cover, song and artist", needs: [WATCH_NEED],
      setup: setup("computer", { android: ["Ask whoever set up couch-tv to add the couch-tv TV app (setup option C) or a home computer that stays on (option B).", OPEN, "Go down to Look and scenes, then Now playing card, and make it On.", "Play music in Spotify or any music app."],
        web: ["Not possible on this TV: it does not say what is playing."], vidaa: ["Not possible on this TV: it does not say what is playing."] }),
      until: "\"Nothing playing\" while nothing plays", build: "",
      ok: "Opens the player: back, play or pause, next, volume", platforms: plat("setup", "no", "no", { web: "This TV does not say what is playing.", vidaa: "This TV does not say what is playing." }), sizes: sz(["tile", "wtile", "small", "medium", "large"], [2, 2]) },
    soundscape: { name: "Soundscape", status: "works", what: "Rain, fire, waves or soft noise, played by the home", needs: ["Nothing: the sounds come with couch-tv"],
      setup: setup("nothing", ["Nothing to set up.", "Move to the widget and press OK to start or stop the sound."]), until: "Always ready", build: "",
      ok: "Starts or stops the sound", platforms: EVERY(), sizes: sz(["tile", "wtile"], [2, 2]) },
    queue: { name: "Up next queue", status: "not-built", what: "The next songs", needs: ["Needs couch-tv to read your Spotify queue (TVs do not share it)"],
      setup: setup("nothing", NOT_YET), until: "\"Up next queue: not on couch-tv yet\", and what it needs", build: "The bridge has to read the queue from the Spotify Web API (the person signs in to Spotify once on the computer) and hand it to the home.",
      ok: "Opens the queue (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["small", "tall", "large"], [4, 4]) },
    speakers: { name: "Speakers", status: "not-built", what: "Each room's speaker and its volume", needs: ["Needs couch-tv to control Home Assistant speakers"],
      setup: setup("nothing", NOT_YET), until: "\"Speakers: not on couch-tv yet\", and what it needs", build: "HomeAssistant.kt has to allow media_player entities named in config.json (volume and play or pause), as it does for climate today.",
      ok: "Opens the speakers with a volume for each (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall"], [4, 2]) },

    // ---------- smart home (Home Assistant, through the Android home) ----------
    aircon: { name: "Aircon", status: "setup", what: "A room's set temperature, what it is now, and the other rooms", needs: [HA_NEED, "Your aircon rooms added once on a computer"],
      setup: setup("computer", SMART_HOME), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Aircon: every room, warmer and cooler, on and off, mode and fan", platforms: plat("setup", "no", "no", { android: "Set up once from a computer; after that no computer is needed.", web: "Smart home needs a Google TV, Android TV or Fire TV.", vidaa: "Smart home needs a Google TV, Android TV or Fire TV." }), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    scenes: { name: "Scenes", status: "setup", what: "Your Home Assistant scenes as big buttons (Movie night, Goodnight)", needs: [HA_NEED, "Your scenes added once on a computer"],
      setup: setup("computer", SMART_HOME), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "OK on a button runs it. On a tile, OK opens every button", platforms: plat("setup", "no", "no", { android: "Set up once from a computer; after that no computer is needed.", web: "Smart home needs a Google TV, Android TV or Fire TV.", vidaa: "Smart home needs a Google TV, Android TV or Fire TV." }), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    controls: { name: "Control Centre", status: "not-built", what: "Lights, lamps and blinds as switches", needs: ["Needs couch-tv to switch lights and blinds (today it does aircon and scenes)"],
      setup: setup("nothing", ["Nothing to set up yet.", "Until then: put your lights in a Home Assistant scene and use the Scenes widget."]), until: "\"Control Centre: not on couch-tv yet\", and what it needs",
      build: "HomeAssistant.kt has to allow light, switch, cover and fan entities named in config.json (turn on, off, open, close), with the page asking for them as it asks for climate. Locks stay out on purpose: nothing that opens the house from a TV remote.",
      ok: "Opens Control Centre: every switch big (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium", "wide", "large"], [2, 2]) },
    camera: { name: "Camera", status: "not-built", what: "A picture from a camera, new every few seconds", needs: ["Needs couch-tv to bring camera pictures into the home"],
      setup: setup("nothing", ["Nothing to set up yet.", "The doorbell pop up already works: it shows the door camera over everything when someone rings (set up once on a computer)."]),
      until: "\"Camera: not on couch-tv yet\", and what it needs",
      build: "HomeAssistant.kt has to fetch camera_proxy stills for camera entities named in config.json and hand them to the page as pictures that never leave the house.",
      ok: "Opens the camera full screen, a new picture every two seconds (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    doorbell: { name: "Doorbell", status: "not-built", what: "The last ring, with a picture", needs: ["Needs the doorbell's last ring kept for the home"],
      setup: setup("nothing", ["Nothing to set up for this widget yet.", "The doorbell pop up already works (set up once on a computer)."]),
      until: "\"Doorbell: not on couch-tv yet\", and that the pop up works", build: "The launcher already hears the doorbell (DoorbellWatch); it has to keep the last ring's time and still for the page.",
      ok: "Opens the last ring full screen (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    energy: { name: "Solar and energy", status: "not-built", what: "Power made today, and the day's curve", needs: ["Needs couch-tv to read Home Assistant sensors"],
      setup: setup("nothing", ["Nothing to set up yet.", "Until then: a Custom card can show today's solar number (needs a home computer)."]), until: "\"Solar and energy: not on couch-tv yet\", and the Custom card way round",
      build: "HomeAssistant.kt has to allow sensor entities named in config.json and return their readings; the widget then draws today's curve from Home Assistant's history.",
      ok: "Opens Energy: today by the hour (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    sensor: { name: "Sensor", status: "not-built", what: "One reading: the pool, the rain gauge, the humidity", needs: ["Needs couch-tv to read Home Assistant sensors"],
      setup: setup("nothing", ["Nothing to set up yet.", "Until then: a Custom card can show any number (needs a home computer)."]), until: "\"Sensor: not on couch-tv yet\", and the Custom card way round",
      build: "HomeAssistant.kt has to allow sensor entities named in config.json and return their state and unit.",
      ok: "Opens the reading with its last 24 hours (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    battery: { name: "Batteries", status: "not-built", what: "Remotes and controllers as rings", needs: ["Needs the TV to share battery levels (TVs do not)"],
      setup: setup("nothing", ["Nothing can be set up: TVs do not share battery levels."]), until: "\"Batteries: not on couch-tv yet\", and why", build: "Not possible on the TV itself. Home Assistant's phone app could report phone batteries, through sensor support (see Sensor).",
      ok: "Nothing", platforms: NOWHERE("TVs do not share battery levels."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- lists and the family ----------
    bins: { name: "Bin night", status: "setup", what: "Tonight's bins with their lid colours", needs: ["Your bin night and bins, picked in couch-tv Studio"],
      setup: setup("designer", inStudio("pick your bin night, the bins and whether they take turns. Nothing personal goes in the design")), until: "\"Set your bin night in couch-tv Studio\"", build: "",
      ok: "Nothing: it is to look at", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    people: { name: "People", status: "works", what: "Who is watching. OK switches person", needs: ["The people who watch, added on the TV"],
      setup: setup("tv", [OPEN, "Go down to People and press OK.", "Pick Add a person, type a name, then press OK. Do it for everyone who watches.", "OK on a name in the widget switches whose shows you see. It does not sign anyone in or out of Netflix."]),
      until: "\"Add people in Home settings\"", build: "",
      ok: "OK on a name makes them the one watching", platforms: plat("setup", "computer", "setup"), sizes: sz(["line", "wline", "wtile"], [4, 1]) },
    agenda: { name: "Agenda", status: "not-built", what: "Today's events with times and colours", needs: ["Needs your calendar on the TV, kept private"],
      setup: setup("nothing", NOT_YET), until: "\"Agenda: not on couch-tv yet\", and what it needs",
      build: "Home settings has to keep a private iCal link (Google, Apple or Outlook) on the TV, never in a design, and the bridge or the TV has to read today's events from it.",
      ok: "Opens the day: every event on a timeline (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    note: { name: "Family note", status: "setup", what: "A sticky note typed at home, with who it is from", needs: [NOTE_NEED],
      setup: setup("tv", typed(["Pick Write a note, type it, then press OK. Pick From to say who it is from."])), until: "\"Write a note\", and where", build: "",
      ok: "Opens the note big", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    list: { name: "List", status: "setup", what: "Shopping or to do, ticked with OK on the remote", needs: [LIST_NEED],
      setup: setup("tv", typed(["Pick Add a list and name it (up to 3), then Add an item for each thing.", "On the home, OK on the widget opens the list: OK ticks an item."])),
      until: "\"Add a list\", and where", build: "",
      ok: "Opens the whole list: OK ticks an item", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["wtile", "small", "tall", "large"], [4, 2]) },

    // ---------- info ----------
    card: { name: "Custom card", status: "setup", what: "A number from your home: solar today, the pool", needs: ["A computer at home that stays on, running couch-tv"],
      setup: setup("computer", ["Needs a computer at home that stays on, running couch-tv (setup option B).", "On that computer, add each card to couch-tv's settings file under Custom cards: a title and where to read the number.", "Press Home: the cards show here."]),
      until: "\"Needs a home computer\", and where it is set up", build: "",
      ok: "Opens every custom card big", platforms: plat("computer", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot." }), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    quote: { name: "Quote", status: "works", what: "A short line for the day, or your own words", needs: ["Nothing: the lines come with couch-tv"],
      setup: setup("nothing", ["Nothing to set up.", "For your own words: open your design in couch-tv Studio, tap the widget and type them.", SEND]), until: "Always shows a line", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    word: { name: "Word of the day", status: "works", what: "A word and what it means", needs: ["Nothing: the words come with couch-tv"],
      setup: setup("nothing", NOTHING), until: "Always shows a word", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    news: { name: "Headlines", status: "not-built", what: "One to four news headlines", needs: ["Needs couch-tv to read a news feed for the TV"],
      setup: setup("nothing", NOT_YET), until: "\"Headlines: not on couch-tv yet\", and what it needs",
      build: "The bridge has to read a chosen RSS feed (ABC News and most Australian outlets publish one) and hand the titles to the home; a TV page cannot read most feeds itself (browsers block it).",
      ok: "Opens the headlines in full (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    sports: { name: "Scores", status: "not-built", what: "Scores for your teams", needs: ["Needs a free, reliable score feed for the NRL, AFL and A-League (none exists today)"],
      setup: setup("nothing", NOT_YET), until: "\"Scores: not on couch-tv yet\", and why",
      build: "A score source the TV may use: official feeds are paid, TheSportsDB's free tier is patchy for the NRL and AFL, and ESPN's are unofficial. Once one is picked, the bridge reads it for the chosen teams.",
      ok: "Opens the round: every game with its score (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    stocks: { name: "Markets", status: "not-built", what: "The ASX, a few shares and the dollar", needs: ["Needs a free share price feed the TV may use"],
      setup: setup("nothing", NOT_YET), until: "\"Markets: not on couch-tv yet\", and why",
      build: "A market source: free share prices are unofficial or delayed; CoinGecko is free for crypto. The bridge would read it for the watchlist kept on the TV.",
      ok: "Opens the watchlist with today's charts (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "tall"], [2, 2]) },
    commute: { name: "Commute", status: "not-built", what: "Drive time and when to leave", needs: ["Needs live traffic, which only paid map services give"],
      setup: setup("nothing", NOT_YET), until: "\"Commute: not on couch-tv yet\", and why",
      build: "A traffic source (paid) or OSRM's free drive time without traffic, with the home and work places kept on the TV only.",
      ok: "Opens the drive with when to leave (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- guests and the room ----------
    welcome: { name: "Welcome words", status: "works", what: "A greeting in your own words", needs: ["The words, typed in couch-tv Studio"],
      setup: setup("designer", inStudio("type the words (no numbers or web addresses)")), until: "Always shows the words", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wline", "wtile", "medium", "wide"], [4, 1]) },
    quick: { name: "Quick buttons", status: "works", what: "Sleep timer, picture mode, look, input and more", needs: ["Nothing: buttons this TV cannot do are left out"],
      setup: setup("tv", { android: [OPEN, "Go down to Quick buttons and press OK.", "OK shows or hides a button. Hold OK on one to move it along.", "Or pick this widget's own buttons in couch-tv Studio."],
        web: [OPEN, "Go down to Quick buttons and press OK.", "OK shows or hides a button. Picture mode and input need a Google TV, Android TV or Fire TV."],
        vidaa: [OPEN, "Go down to Quick buttons and press OK.", "OK shows or hides a button. Picture mode and input need a Google TV, Android TV or Fire TV."] }),
      until: "Buttons this TV cannot do are left out", build: "",
      ok: "OK on a button does it: the sleep timer, the next picture mode, the next look, the input list", platforms: plat("works", "computer:partial", "works:partial", { web: "Some buttons (picture mode, input) need a Google TV, Android TV or Fire TV.", vidaa: "Some buttons (picture mode, input) need a Google TV, Android TV or Fire TV." }), sizes: sz(["line", "wline", "tile", "wtile"], [2, 1]) },
    wifi: { name: "Guest Wi-Fi", status: "setup", what: "Your guest network, its password and a code a phone camera joins with", needs: [WIFI_NEED],
      setup: setup("tv", typed(["Pick Network name and type the guest network's name, then Password.", "Guests point their phone camera at the code on the widget."])),
      until: "\"Add your guest Wi-Fi\", and where", build: "",
      ok: "Opens the join code big, for a phone camera", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["small", "medium", "wide"], [4, 4]) },
    guide: { name: "House guide", status: "setup", what: "Check out, the bins, around here: what guests need to know", needs: [GUIDE_NEED],
      setup: setup("tv", typed(["Pick Add to the guide, type a heading like Check out, then its words. Up to 8."])), until: "\"Write your house guide\", and where", build: "",
      ok: "Opens the whole guide", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["wtile", "small", "tall"], [4, 2]) },
    screentime: { name: "Screen time", status: "not-built", what: "Minutes left today and bedtime", needs: ["Needs daily time limits in Kids mode (it has a PIN today, not a limit)"],
      setup: setup("nothing", NOT_YET), until: "\"Screen time: not on couch-tv yet\", and what it needs", build: "Kids mode has to keep a daily limit and a bedtime on the TV and count what the kids profile watches.",
      ok: "Opens today's screen time (once built)", platforms: NOWHERE("Not built yet."), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- a smart stack (not a widget of its own: up to 10 widgets taking turns) ----------
    stack: { name: "Smart stack", status: "works", what: "Up to 10 widgets of one size taking turns in one place", needs: ["Whatever the widgets in it need"],
      setup: setup("designer", inStudio("drop widgets of the same size on top of each other")), until: "Each widget in it says what it needs", build: "",
      ok: "OK opens what the widget showing opens. Left and Right flick through", platforms: EVERY(), sizes: sz([], [2, 2]) }
  };

  // A widget couch-tv cannot fill yet always shows the same card on a TV (widgets.js soon()), so its
  // `until` says exactly that, rather than each record wording it its own way
  Object.keys(C).forEach(function (k) {
    if (C[k].status === "not-built") C[k].until = "A card on the widget: \"" + C[k].name + ": not on couch-tv yet\" and what it needs. OK on it shows this.";
    // a TV whose couch-tv does not draw designs gets the same one step everywhere
    C[k].setup.steps.none = NOT_HERE.slice();
  });

  // the setup card a TV shows for a widget that has nothing real to show yet: the first line says what
  // is missing, the second where to go. Built only from this file, never from a design.
  var WHERE = { tv: "OK here shows the steps", phone: "Set up from the phone remote", computer: "OK here shows how to set it up", designer: "Set up in couch-tv Studio", nothing: "" };
  var SHORT = {};
  // [the line, where to go, the line for a tile (two short lines at most)]
  SHORT[TOWN_NEED] = ["Set your town", "Home settings, Location", "Set your town"];
  SHORT[PHOTOS_NEED] = ["Add your photos", "Home settings, Look and scenes, Your photos", "Add photos"];
  SHORT[WATCH_NEED] = ["Needs the couch-tv TV app or a home computer", "OK here shows how", "Needs setting up"];
  SHORT[HA_NEED] = ["Needs Home Assistant", "Set up once on a computer. OK here shows how", "Needs Home Assistant"];
  SHORT[C.card.needs[0]] = ["Needs a home computer", "OK here shows how to set it up", "Needs a computer"];
  SHORT[C.surf.needs[0]] = ["Set your town by the beach", "Home settings, Location", "Set your town"];
  var AT = "Home settings, couch-tv Studio, At home";
  SHORT[NOTE_NEED] = ["Write a note", AT, "Write a note"];
  SHORT[LIST_NEED] = ["Add a list", AT, "Add a list"];
  SHORT[WIFI_NEED] = ["Add your guest Wi-Fi", AT, "Add Wi-Fi"];
  SHORT[GUIDE_NEED] = ["Write your house guide", AT, "Write a guide"];
  SHORT[CAL_NEED] = ["Add your calendar", AT, "Add a calendar"];
  SHORT[DATED_NEED] = ["Add your photos", "Home settings, Look and scenes, Your photos", "Add photos"];
  SHORT[SCREEN_NEED] = ["Allow screen time", AT, "Allow it first"];
  // tiny: the box is a tile, so the line has to fit two short lines (OK opens the whole record)
  function card(kind, tiny) {
    var c = C[kind];
    if (!c) return { line: tiny ? "Needs an update" : "This widget needs a newer couch-tv", sub: "" };
    if (c.status === "not-built") return { line: tiny ? "Not built yet" : c.name + ": not on couch-tv yet", sub: c.needs[0].replace(/^Needs /, "It needs ") };
    var s = SHORT[c.needs[0]];
    if (s) return { line: tiny ? s[2] : s[0], sub: s[1] };
    return { line: tiny ? "Set up needed" : c.needs[0], sub: WHERE[c.setup.where] || "" };
  }
  // the numbered steps for a widget on one TV system (a platform-setup.js key, or "android", "web",
  // "vidaa", "none")
  function steps(kind, platform) {
    var c = C[kind];
    if (!c) return [];
    var g = ["android", "web", "vidaa", "none"].indexOf(platform) >= 0 ? platform : groupOf(platform);
    return (c.setup.steps[g] || c.setup.steps.android).slice();
  }

  var API = {
    v: 2,
    platforms: PLATFORMS.slice(),
    groups: { android: ANDROID.slice(), web: WEB.slice(), vidaa: VIDAA.slice() },
    groupOf: groupOf,
    kinds: function () { return Object.keys(C); },
    get: function (kind) { return C[kind] || null; },
    all: function () { return C; },
    on: function (kind, platform) { var c = C[kind]; return c && c.platforms[platform] ? c.platforms[platform].on : "no"; },
    need: function (kind, platform) { var c = C[kind]; return c && c.platforms[platform] ? c.platforms[platform].need : "no"; },
    steps: steps,
    card: card
  };
  root.CouchWidgetCaps = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
