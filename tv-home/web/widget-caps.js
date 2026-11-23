// What every widget needs to show real things, how to set it up on each kind of TV, what it shows
// until then, what OK opens, which TVs can run it, and the sizes it comes in. One record per widget
// kind, read by the TV (widgets.js draws the setup card from it, widget-detail.js the setup steps) and
// by Couch TV Studio (the info tips, the gallery badges and the size menu). Data only: no page, no
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
//   beta        (only some) the unofficial label: why this widget is marked unofficial, in one plain line
//   ok          what OK on the remote opens (the detail layer, widget-detail.js), or what it does
//   platforms   { <tvs/platform-setup.js key>: { on, need, note } }
//                 on    "yes" | "setup" | "partial" | "no" (the older field the designer reads)
//                 need  "works" (nothing to do), "setup" (a step on the TV or in Couch TV Studio),
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
  // Roku and Apple TV: Couch TV draws designs itself there (roku/channel/components/DesignLib.brs
  // dlWNative, tvos/CouchTV/DesignModel.swift DesignWidgets.native), but only these kinds; any other
  // kind is not on that TV. Both need a computer at home that stays on to open Couch TV.
  var NATIVE = {
    "Roku OS": ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "countdown", "date", "month", "weather", "bigtemp", "moon", "photo", "artframe",
      "keep", "keeprow", "app", "folder", "dock", "appgrid", "games", "people", "card", "quote", "welcome",
      // a smart stack: Roku draws one widget at a time, the next each minute (DesignLib.brs, the top of
      // dlWidget). Family note is not here: the note lives in the web home's own store, which a Roku lacks.
      "stack"],
    tvOS: ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "worldclock", "countdown", "date", "month", "weather", "bigtemp", "photo", "artframe",
      "keep", "keeprow", "app", "folder", "dock", "appgrid", "games", "people", "quick", "card", "quote", "welcome", "stack"]
  };
  var NATIVE_NAME = { "Roku OS": "Roku", tvOS: "Apple TV" };
  function drawnOn(kind, p) { return !!NATIVE[p] && NATIVE[p].indexOf(kind) >= 0; }
  // Fire TV on Vega OS, Philips on Titan OS, VIZIO and unknown TVs: their couch-tv (where there is one)
  // does not draw Couch TV Studio designs.
  var NO_HOME = "Designs don't show on this TV.";
  var NOT_HERE = ["Not possible on this TV: designs show on Google TV, Android TV, Fire TV, Samsung, LG, Hisense, Philips (older), TiVo OS, Panasonic, Roku and Apple TV."];
  var NOT_NATIVE = "Shows on Google TV, Android TV and Fire TV.";
  var NATIVE_PHOTO = { photo: true, artframe: true };
  var NATIVE_CHANGE = "To change this widget, change it in Couch TV Studio and send the design again.";
  var NATIVE_PHOTO_NOTE ="Shows the photo put in the widget in Couch TV Studio. This TV's own photos do not show here.";
  var NATIVE_SEND = { "Roku OS": "Tap Send to my TV, then on the Roku: press the star button, pick Get a design by code, and type the code.",
    tvOS: "Tap Send to my TV, then on the Apple TV: Settings, Home design, Get a design, and type the code." };

  function groupOf(p) { return ANDROID.indexOf(p) >= 0 ? "android" : WEB.indexOf(p) >= 0 ? "web" : VIDAA.indexOf(p) >= 0 ? "vidaa" : NATIVE[p] ? "native" : "none"; }
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
  var DEFAULT_NOTE = { works: "Works with nothing to set up.", setup: "Works once it is set up.", computer: "Needs a home computer that stays on, running Couch TV.", no: "Not possible on this TV." };
  // the usual three: works on the Android home, needs the home computer on a web TV, works on a VIDAA
  // (the website home with no computer, or the computer)
  var EVERY = function () { return plat("works", "computer", "works", { web: "Works while the home computer is on (it runs Couch TV for this TV)." }); };
  var NOWHERE = function (why) { return plat("no", "no", "no", { android: why, web: why, vidaa: why }); };
  function sz(s, min, x) { var o = { s: s, min: min }; if (x) o.x = x; return o; }
  // steps for each group; one list given for "all" is used for every group
  function setup(where, steps) {
    if (Object.prototype.toString.call(steps) === "[object Array]") steps = { android: steps, web: steps, vidaa: steps };
    return { where: where, how: steps.android.join(" "), steps: steps };
  }

  // ---------------- the words used again and again ----------------
  // the way into Home settings on every home: a design's Settings button (top right), the Hold OK menu, or
  // the classic home's gear. The remote's own Settings button often opens the TV's menu instead, so say so.
  var OPEN = "Hold OK and pick Settings (or OK on the gear at the screen edge), then Home settings. The remote's Settings button opens the TV's menu.";
  var SEND = "Tap Send to my TV, then on the TV: Home settings, Designs, Get a design, and type the code.";
  function inStudio(what) { return ["Open your design in Couch TV Studio on your phone.", "Tap the widget, then " + what + ".", SEND]; }
  var TOWN = [OPEN, "Go down to Location and press OK.", "Pick Search for a town or city, type your town, then press OK.", "Pick your town in the list. The weather shows within a minute."];
  // a weather widget can also have a place of its own (its Place setting, Hold OK on the widget)
  var TOWN_OWN = TOWN.concat(["Or for this widget only: hold OK on it, pick Edit on the TV, then Place."]);
  var BEACH = [OPEN, "Go down to Location and press OK.", "Pick Search for a town or city, type the beach town nearest you, then press OK.", "Pick it in the list. The swell shows within a minute (inland towns have no swell)."];
  var BEACH_OWN = BEACH.concat(["Or for this widget only: hold OK on it, pick Edit on the TV, then Beach."]);
  var PHOTOS_ANDROID = [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add photos from a USB drive or this TV, and choose up to 50 photos.", "Or put one photo in the widget itself, in Couch TV Studio."];
  var PHOTOS_LINK = [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "Or put one photo in the widget itself, in Couch TV Studio."];
  var NOTHING = ["Nothing to set up."];
  // the time widgets: nothing to set up, and their own settings are on the TV too (Hold OK, Edit on the TV)
  var EDIT_TV = "To change how it looks: hold OK on the widget, then pick Edit on the TV. Or change it in Couch TV Studio.";
  var CLOCK_STEPS = ["Nothing to set up.", EDIT_TV];
  var NOT_YET = ["Nothing to set up: Couch TV cannot show this."];
  var WATCH = {
    // the Couch TV home app alone reads Android's own Continue watching list (MainActivity.kt readWatchNext,
    // app.js refreshNow when there is no computer), the same for everyone; the on-TV app or a home computer
    // keeps each person's own
    android: ["Nothing more to set up: Couch TV's home shows the shows Android keeps under Continue watching. If the TV asks, allow it once.", "For each person's own list, add the Couch TV app on this TV or a home computer that stays on.", "Start a show, then come back to the home: the show is waiting here."],
    web: ["Keep the home computer on: it runs Couch TV for this TV.", "Start a show from Couch TV's home (Netflix, YouTube and some others).", "Come back to the home: the show is waiting here."],
    vidaa: ["Needs a home computer that stays on, running Couch TV. The website home cannot do this.", "Start a show from Couch TV's home.", "Come back to the home: the show is waiting here."]
  };
  // smart home is set up on the TV itself (Home settings, Designs, Smart home): the launcher
  // talks to Home Assistant on a Google TV, Android TV or Fire TV; on a TV whose home a computer runs,
  // that computer does (bridge/smarthome.py)
  var SH_CONNECT = "Go down to Designs, then Smart home. Type Home Assistant's address, then paste its access key with the phone remote's Type on the TV (the steps are on the screen).";
  function shSteps(what, after) {
    var pick = "Tick your " + what + ", then pick Save and show on the home.";
    return {
      android: ["Needs Home Assistant, the smart home app, running at home. Not in it yet? Smart home, Add a device we don't list, shows how.", OPEN, SH_CONNECT, pick].concat(after || []).slice(0, 5),
      web: ["Needs Home Assistant running at home, and the home computer on: it talks to Home Assistant for this TV.", OPEN, SH_CONNECT, pick].concat(after || []).slice(0, 5),
      vidaa: ["Needs a home computer that stays on, running Couch TV: the website home cannot reach Home Assistant.", OPEN, SH_CONNECT, pick]
    };
  }
  var SMART_HOME = shSteps("rooms and scenes", ["Press Home: they show here."]);
  // a widget that shows some of what Smart home has: which ones, picked on the widget itself
  var PICK_HERE = " Hold OK on the widget, then Edit on the TV, to pick which show here.";
  var APPS_ORDER = [OPEN, "Go down to Apps and press OK.", "OK moves an app between the home, More apps and hidden. Hold OK on an app to move it along."];

  // things typed at home: Home settings, Designs, At home (athome.js), kept on the TV only
  var AT_HOME = "Go down to Designs, then pick At home.";
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
  // Ask AI and From your AI (ask.js)
  var ASK_NEED = "The AI you choose: Claude, OpenAI, Google Gemini or another service, a model at home, or Couch TV at home";
  var AGENT_NEED = "The Couch TV app on this TV or a home computer running Couch TV, for your agent to reach the TV";
  var OPEN_ASK = "Move to the Ask AI widget and press OK, then pick Set up.";

  var TOWN_NEED = "Your town, set on the TV";
  var PHOTOS_NEED = "Your photos on the TV, or one photo put in the widget";
  var WATCH_NEED = "The Couch TV app on this TV or a home computer that stays on";
  var HA_NEED = "Home Assistant (a smart home app) running at home";
  // the smart home widgets (group C): set up on the TV (Home settings, Designs, Smart home)
  function haSteps(what) { return shSteps(what, [].slice.call(arguments, 1)); }
  var HA_PLAT = function () { return plat("setup", "computer", "computer", { android: "Set up on the TV: Home settings, Designs, Smart home. No computer needed.", web: "The home computer talks to Home Assistant for this TV.", vidaa: "Needs a home computer: the website home cannot reach Home Assistant." }); };
  // the Up next queue: Spotify's queue, read with the person's own Spotify sign in
  var QUEUE_NEED = "Spotify connected on the home computer, or on the website home on a Hisense";
  var SPOTIFY_ON = "On that computer, connect Spotify once: open the Couch TV Spotify page on it and sign in (setup guide, Spotify Now playing).";

  var C = {
    // ---------- time ----------
    clock: { name: "Digital clock", status: "works", what: "The time, with the date if you like", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", ["Nothing to set up.", EDIT_TV, "With Follow this TV, set 12 or 24 hour in Home settings, Look and scenes, Clock."]),
      until: "Always shows the time", build: "",
      ok: "Opens Timers: start a kitchen timer from the remote", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    tallclock: { name: "Tall clock", status: "works", what: "Tall thin digits that fill the space", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "xl", "hero", "full"], [2, 2]) },
    glassclock: { name: "Glass clock", status: "works", what: "Big digits filled with the scene's photo", needs: ["Nothing: the scenes come with Couch TV"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "wide", "xl", "hero"], [4, 2]) },
    analog: { name: "Analogue clock", status: "works", what: "A clock face with hands", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["tile", "small", "large"], [2, 2]) },
    flipclock: { name: "Flip clock", status: "works", what: "Digits on flip cards", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "medium", "wide"], [4, 2]) },
    wordclock: { name: "Time in words", status: "works", what: "\"Twenty to eight, Wednesday morning\"", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the time", build: "",
      ok: "Opens Timers", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    solar: { name: "Sun clock", status: "works", what: "The sun's path today, with sunrise and sunset", needs: [TOWN_NEED],
      setup: setup("tv", TOWN.concat(["Or a place for this widget alone: hold OK on it, then Edit on the TV, Place."])), until: "\"Set your town for the sun\", and where", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    worldclock: { name: "World clocks", status: "works", what: "The time in two to four cities", needs: ["Nothing: it uses the TV's own clock. Pick the cities on the TV or in Couch TV Studio"],
      setup: setup("nothing", ["Nothing to set up: with no cities picked it shows this TV's own town, London, New York and Tokyo.", "To pick the cities: hold OK on the widget, then pick Edit on the TV. Or pick them in Couch TV Studio."]), until: "Always shows the times", build: "",
      ok: "Opens World clocks: every city big, day or night", platforms: EVERY(), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    countdown: { name: "Countdown", status: "works", what: "Sleeps, days or weeks to a date", needs: ["The date and its name, picked on the TV or in Couch TV Studio"],
      setup: setup("designer", inStudio("pick the date, and a year for a one off day, and type its name").concat(["Or on the TV: hold OK on the widget, then pick Edit on the TV."])), until: "Always shows the count", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    date: { name: "Date", status: "works", what: "Today's date, with the weather if you like", needs: ["Nothing for the date. The weather line needs your town"],
      setup: setup("nothing", ["Nothing to set up for the date.", "For the weather, " + OPEN.charAt(0).toLowerCase() + OPEN.slice(1), "Go down to Location, pick Search for a town or city, type your town, then press OK.", "To show the weather or change the date style: hold OK on the widget, then pick Edit on the TV."]),
      until: "Always shows the date", build: "",
      ok: "Opens Calendar: this month and today", platforms: EVERY(), sizes: sz(["line", "wline", "tile", "small"], [2, 1]) },
    month: { name: "Month", status: "works", what: "This month's calendar, with today marked", needs: ["Nothing: it uses the TV's own clock"],
      setup: setup("nothing", CLOCK_STEPS), until: "Always shows the month", build: "",
      ok: "Opens Calendar: this month and next", platforms: EVERY(), sizes: sz(["tile", "small", "large"], [2, 2]) },
    timer: { name: "Timer", status: "works", what: "A ring counting down a timer you start with the remote", needs: ["Nothing: timers are kept on the TV"],
      setup: setup("nothing", ["Nothing to set up.", "To start one: move to the widget and press OK.", "Pick the minutes. It counts down here.", "For one press: hold OK on the widget, pick Edit on the TV, then set Quick start."]),
      until: "\"No timer. OK to start one\"", build: "",
      ok: "Opens Timers: 1 to 60 minutes, add a minute, cancel. With Quick start set, starts that timer straight away", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },

    // ---------- weather (free, straight from the TV, no account) ----------
    weather: { name: "Weather", status: "works", what: "Your town, the temperature, the sky, the high and low", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\", or \"Weather is off on this TV\"", build: "",
      ok: "Opens the forecast: the next 24 hours and the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    bigtemp: { name: "Big number", status: "works", what: "One huge temperature, coloured for the day", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "small", "medium", "large"], [2, 2]) },
    hourly: { name: "Hourly", status: "works", what: "The next few hours: time, sky and temperature", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: 24 hours with the chance of rain", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    week: { name: "This week", status: "works", what: "The next 7 days, with each day's high and low", needs: [TOWN_NEED],
      setup: setup("tv", TOWN.concat(["Or a place for this widget only: hold OK on it, pick Edit on the TV, then Place."])), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: the 7 days in full", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "tall", "medium", "large"], [4, 2]) },
    rain: { name: "Rain soon", status: "works", what: "Rain in the next three hours, as bars", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: the chance of rain by the hour", platforms: plat("setup", "computer", "setup"), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    uv: { name: "UV index", status: "works", what: "Today's UV and how strong it is", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\"", build: "",
      ok: "Opens the forecast: UV by the hour", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    sun: { name: "Sunrise and sunset", status: "works", what: "Today's sunrise and sunset, and the sun's path", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town for the sun\"", build: "",
      ok: "Opens the forecast: sunrise and sunset for the week", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    moon: { name: "Moon", status: "works", what: "Tonight's moon, the right way round for your half of the world, and the next full moon", needs: ["Nothing: worked out on the TV"],
      setup: setup("nothing", NOTHING), until: "Always shows the moon", build: "",
      ok: "Opens the moon: the next four weeks", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    air: { name: "Air quality", status: "works", what: "How clean the air is, as a number and a word", needs: [TOWN_NEED],
      setup: setup("tv", TOWN_OWN), until: "\"Set your town\"", build: "",
      ok: "Opens Air quality: the next 12 hours", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    surf: { name: "Surf", status: "works", what: "The swell (height, seconds apart, direction) and the wind at the beach picked for it, or your town", needs: ["Your town, set on the TV: pick the beach town nearest you", "A town near the coast: inland there is no swell"],
      setup: setup("tv", BEACH_OWN), until: "\"Set your town\", or \"No surf reading here\" inland", build: "",
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
    memory: { name: "On this day", status: "setup", what: "Your photos taken on this date in other years, with how long ago", needs: [DATED_NEED, "Photos taken on this day in another year"],
      setup: setup("tv", {
        android: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add photos from a USB drive or this TV, and choose your photos. Couch TV notes the day each was taken.", "Photos added before this version have no day: add them again.", "On the day, the widget shows the photos from that date in other years."],
        web: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "The day comes from the photo itself, when its address lets the TV read it, or from a date in its name (like IMG_20231118)."],
        vidaa: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "The day comes from the photo itself, when its address lets the TV read it, or from a date in its name (like IMG_20231118)."] }),
      until: "\"Add your photos\"; then \"No photos from this day\" on days with none, never another day's photo", build: "",
      ok: "Opens this day's photos full screen", platforms: plat("setup", "computer:partial", "setup:partial", { android: "Photos added from a USB drive or this TV keep the day they were taken.", web: "Only photos whose address lets the TV read them, or with a date in their name.", vidaa: "Only photos whose address lets the TV read them, or with a date in their name." }),
      sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- watching ----------
    keep: { name: "Keep watching", status: "setup", what: "The show you were watching (or the person picked for it), ready to carry on", needs: [WATCH_NEED],
      setup: setup("tv", WATCH), until: "\"Nothing to keep watching yet\": shows you start on this TV appear here", build: "",
      ok: "Opens Keep watching: every show on the go, each with Resume", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from Couch TV's home.", vidaa: "Only with a home computer: the website home cannot." }), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    keeprow: { name: "Keep watching row", status: "setup", what: "Two to five shows, with how far you got", needs: [WATCH_NEED],
      setup: setup("tv", WATCH), until: "\"Nothing to keep watching yet\"", build: "",
      ok: "OK on a poster plays it. Hold OK, then Open, for the whole list", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from Couch TV's home.", vidaa: "Only with a home computer: the website home cannot." }), sizes: sz(["medium", "wide", "hero"], [6, 2]) },
    upnext: { name: "Up next", status: "setup", what: "One show filling the space, with Resume and Start over. Beside Scores it shows your last game", needs: [WATCH_NEED],
      setup: setup("tv", WATCH), until: "\"Nothing to keep watching yet\", or \"No game to pick up\"", build: "",
      ok: "Resume plays it. Hold OK, then Open, for the whole list", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from Couch TV's home.", vidaa: "Only with a home computer: the website home cannot." }), sizes: sz(["medium", "wide", "xl", "hero", "full"], [8, 4]) },
    // made on the TV from its own Keep watching (widget-web.js picks): no outside service, nothing leaves
    picks: { name: "Picks for you", status: "setup", what: "Shows the others at home are watching, and your own shows left part way, each ready to play",
      needs: [WATCH_NEED],
      setup: setup("tv", { android: WATCH.android.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]),
        web: WATCH.web.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]),
        vidaa: WATCH.vidaa.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]) }),
      until: "\"No picks yet\" until shows are on the go on this TV", build: "",
      ok: "Opens every pick with Play. OK on a poster plays it", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from Couch TV's home.", vidaa: "Only with a home computer: the website home cannot." }), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- apps ----------
    app: { name: "One app", status: "works", what: "One app as a big icon", needs: ["The app installed on this TV"],
      setup: setup("tv", { android: ["Go to More apps at the end of your apps, then open App Store.", "Find the app and install it.", "Press Home: it shows in this widget."],
        web: ["Install the app from the TV's own app store.", "Keep the home computer on: it opens apps for Couch TV."],
        vidaa: ["Install the app from the TV's own app store.", "Needs a home computer to open it: the website home cannot open apps."] }),
      until: "\"This app is not on this TV\"", build: "",
      ok: "Opens the app", platforms: plat("works", "computer", "computer", { vidaa: "Needs a home computer: the website home cannot open apps." }), sizes: sz(["tile", "small"], [2, 2]) },
    folder: { name: "App folder", status: "works", what: "A box of apps with a name", needs: ["The apps, picked in Couch TV Studio or on the TV, and installed on this TV"],
      setup: setup("designer", inStudio("pick the apps for it").concat(["Or on the TV: hold OK on an app to change, move or remove it, or on Add app to add one."])), until: "Apps this TV does not have are dimmed: \"Not on this TV\"", build: "",
      ok: "Opens the folder full screen, every app big", platforms: plat("works", "computer", "computer", { vidaa: "Needs a home computer: the website home cannot open apps." }), sizes: sz(["tile", "small", "tall", "medium", "large"], [2, 2]) },
    dock: { name: "Dock", status: "works", what: "A row of your apps", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up. Hold OK on an app to change, move or remove it."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it. The All apps tile at the end, when it is on, opens every app", platforms: plat("works", "computer", "computer", { vidaa: "Needs a home computer: the website home cannot open apps." }), sizes: sz([], [6, 2], [["row8", "Short row", 8, 2], ["row12", "Row", 12, 2], ["row18", "Full row", 18, 2]]) },
    appgrid: { name: "App grid", status: "works", what: "Rows of apps with their names", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up. Hold OK on an app to change, move or remove it."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it", platforms: plat("works", "computer", "computer", { vidaa: "Needs a home computer: the website home cannot open apps." }), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    games: { name: "Games", status: "works", what: "Game apps as tall tiles", needs: ["Game apps installed on this TV"],
      setup: setup("designer", inStudio("pick the game apps").concat(["Or on the TV: hold OK on a game to change, move or remove it."])), until: "Games this TV does not have are dimmed: \"Not on this TV\"", build: "",
      ok: "OK on a game opens it", platforms: plat("works", "computer", "computer", { vidaa: "Needs a home computer: the website home cannot open apps." }), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- music ----------
    nowplaying: { name: "Now playing", status: "setup", what: "The song playing on this TV: cover, song and artist", needs: [WATCH_NEED],
      // any music app through the on-TV app or a home computer; Couch TV's home alone reads only Spotify's
      // media session (SpotifyPlayer.kt, home.spotify_player), so the computer is not the one way
      setup: setup("tv", { android: ["Any music app shows with the Couch TV app on this TV or a home computer. With neither, only Spotify shows, if it was switched on when Couch TV was set up.", OPEN, "Go down to Look and scenes, then Now playing card, and make it On.", "Play music in Spotify or any music app."],
        web: ["Not possible on this TV: it does not say what is playing."], vidaa: ["Not possible on this TV: it does not say what is playing."] }),
      until: "\"Nothing playing\" while nothing plays", build: "",
      ok: "Opens the player: back, play or pause, next, volume", platforms: plat("setup", "no", "no", { web: "This TV does not say what is playing.", vidaa: "This TV does not say what is playing." }), sizes: sz(["tile", "wtile", "small", "medium", "large"], [2, 2]) },
    soundscape: { name: "Soundscape", status: "works", what: "Rain, fire, waves or soft noise, played by the home", needs: ["Nothing: the sounds come with Couch TV"],
      setup: setup("nothing", ["Nothing to set up.", "Move to the widget and press OK to start or stop the sound."]), until: "Always ready", build: "",
      ok: "Starts or stops the sound", platforms: EVERY(), sizes: sz(["tile", "wtile"], [2, 2]) },
    queue: { name: "Up next queue", status: "setup", what: "The next songs in your Spotify queue", needs: [QUEUE_NEED, "Only Spotify: TVs and other music apps do not share their queue"],
      setup: setup("computer", { android: ["Needs a home computer that stays on, running Couch TV.", SPOTIFY_ON, "Play music in Spotify on any phone, computer or speaker: the next songs in your queue show here."],
        web: ["Keep the home computer on: it runs Couch TV for this TV.", SPOTIFY_ON, "Play music in Spotify on any phone, computer or speaker: the next songs in your queue show here."],
        vidaa: ["With a home computer that stays on: connect Spotify once on it (open the Couch TV Spotify page on it and sign in).", "With the website home and no computer: sign in to Spotify once on your own Couch TV site (setup guide, Hisense VIDAA, Spotify).", "Play music in Spotify: the next songs in your queue show here."] }),
      until: "\"Needs Spotify connected\", and where it is set up", build: "",
      ok: "Opens the next ten songs, big", platforms: plat("computer", "computer", "setup", { android: "Needs a home computer with Spotify connected. Only Spotify shares its queue.", web: "Works while the home computer is on, with Spotify connected on it.", vidaa: "Works with the home computer, or the website home with Spotify signed in." }), sizes: sz(["small", "tall", "large"], [4, 4]) },
    speakers: { name: "Speakers", status: "setup", what: "Each speaker, what it plays and its volume", needs: [HA_NEED, "Your speakers picked on the TV"],
      setup: setup("tv", haSteps("speakers (up to 6, any Home Assistant knows)", "Press Home: each speaker and its volume show here." + PICK_HERE)),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens the speakers: louder, quieter, play and pause for each", platforms: HA_PLAT(), sizes: sz(["wtile", "small", "tall"], [4, 2]) },

    // ---------- smart home (Home Assistant, through the Android home) ----------
    aircon: { name: "Aircon", status: "setup", what: "A room's set temperature, what it is now, and the other rooms", needs: [HA_NEED, "Your aircon rooms picked on the TV"],
      setup: setup("tv", shSteps("aircon rooms", ["Press Home: a room shows here. Hold OK on the widget, then Edit on the TV, to pick the room."])), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Aircon: every room, warmer and cooler, on and off, mode and fan", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    scenes: { name: "Scenes", status: "setup", what: "Your Home Assistant scenes as big buttons (Movie night, Goodnight)", needs: [HA_NEED, "Your scenes picked on the TV"],
      setup: setup("tv", shSteps("scenes", ["Press Home: they show here." + PICK_HERE])), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "OK on a button runs it. On a tile, OK opens every button", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    controls: { name: "Control Centre", status: "setup", what: "Lights, switches, fans and blinds as big switches", needs: [HA_NEED, "Your lights and switches picked on the TV"],
      setup: setup("tv", haSteps("lights, switches, fans and blinds (up to 16)", "Press Home: your switches show here." + PICK_HERE, "Locks, alarms, garage doors and gates never show on Couch TV: nothing that opens the house from a TV remote.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Control Centre: every switch big, OK on one switches it", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "large"], [2, 2]) },
    camera: { name: "Camera", status: "setup", what: "A still picture from a camera, new every 2 seconds (no video)", needs: [HA_NEED, "Your cameras picked on the TV"],
      setup: setup("tv", haSteps("cameras (up to 4)", "Press Home: a still shows here, new every 2 seconds (no video, no sound). Hold OK on it, then Edit on the TV, to pick the camera.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens the camera full screen, a new still every 2 seconds; Left and Right reach your other cameras", platforms: HA_PLAT(), sizes: sz(["wtile", "small", "medium", "large"], [4, 2]) },
    doorbell: { name: "Doorbell", status: "setup", what: "When the doorbell last rang, with a picture", needs: [HA_NEED, "Your doorbell picked on the TV"],
      setup: setup("tv", haSteps("doorbell and its camera", "Press Home: when it last rang shows here, with the picture the TV kept from that ring, or the door now.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens the last ring full screen: the picture from the ring, then the door now", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    energy: { name: "Solar and energy", status: "setup", what: "Power made or used today, by the hour", needs: [HA_NEED, "Your solar or energy sensor picked on the TV"],
      setup: setup("tv", haSteps("solar or power meter (kWh today, or watts)", "Press Home: today by the hour shows here, with power now and the battery if there is one.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Energy: today by the hour, power now and the battery", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium", "wide"], [2, 2]) },
    sensor: { name: "Sensor", status: "setup", what: "One reading (the pool, the rain gauge, humidity) and its last 24 hours", needs: [HA_NEED, "Your sensors picked on the TV"],
      setup: setup("tv", haSteps("sensors (up to 8: the pool, a rain gauge, humidity)", "Press Home: the reading shows here. Hold OK on it, then Edit on the TV, to pick the sensor.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens the reading big with its last 24 hours; Left and Right reach your other sensors", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    // the launcher reads Android's own Bluetooth battery levels (tv-home/android Batteries.kt)
    battery: { name: "Batteries", status: "setup", what: "The remotes, game controllers and headphones paired with this TV, and the charge left in each, as rings",
      needs: ["A Google TV, Android TV or Fire TV, with Bluetooth remotes or controllers that report their charge"],
      setup: setup("tv", {
        android: ["Pair the remote or controller with the TV as usual (Settings, Remotes and accessories).", "Move to the Batteries widget and press OK.", "On Android 12 and newer, pick Ask Android now, then Allow on Android's question. Older TVs ask nothing.", "The rings show the charge, lowest first. They update every few minutes."],
        web: ["Not possible on this TV: only Android shares the charge of paired remotes. A Google TV box or Fire TV stick plugged in shows it."],
        vidaa: ["Not possible on this TV: only Android shares the charge of paired remotes. A Google TV box or Fire TV stick plugged in shows it."] }),
      until: "\"Allow nearby devices\" on Android 12 and newer, or \"No charge to show\" when nothing paired reports one", build: "",
      ok: "Opens every paired device and its charge, and asks Android once on Android 12 and newer",
      platforms: plat("setup", "no", "no", { android: "Remotes, controllers and headphones paired by Bluetooth that report their charge.", web: "Only Android shares the charge of paired remotes.", vidaa: "Only Android shares the charge of paired remotes." }),
      sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- lists and the family ----------
    bins: { name: "Bin night", status: "setup", what: "Tonight's bins with their lid colours", needs: ["Your bin night and bins, set on the widget on the TV or in Couch TV Studio"],
      setup: setup("tv", ["Move to the Bin night widget, hold OK, then pick Edit on the TV.", "Pick the bin night, the names and lid colours of the bins, and whether they take turns.",
        "Taking turns? Pick which bin goes out this week, and Couch TV keeps count from there.", "Or set the same in Couch TV Studio: tap the widget, then send the design to your TV."]),
      until: "\"Set your bin night in this widget's settings\"", build: "",
      ok: "Nothing: it is to look at", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    people: { name: "People", status: "works", what: "Who is watching. OK switches person", needs: ["The people who watch, added on the TV"],
      setup: setup("tv", [OPEN, "Go down to People and press OK.", "Pick Add a person, type a name, then press OK. Do it for everyone who watches.", "OK on a name in the widget switches whose shows you see. It does not sign anyone in or out of Netflix."]),
      until: "\"Add people in Home settings\"", build: "",
      ok: "OK on a name makes them the one watching", platforms: plat("setup", "computer", "setup"), sizes: sz(["line", "wline", "wtile"], [4, 1]) },
    agenda: { name: "Agenda", status: "setup", what: "Today's events with times and colours (or tomorrow's, or the week's), from your own calendar and your bookings calendar", needs: [CAL_NEED, "Something to read the calendar: the Couch TV app on this TV, or a home computer"],
      setup: setup("tv", {
        android: ["Find your calendar's private address on a phone or computer. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to Designs, pick At home, then Add a calendar link.", "Type the address, or paste it with Type on the TV in the phone remote. Today's events show within a minute."],
        web: ["Find your calendar's private address on a phone or computer. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to Designs, pick At home, then Add a calendar link.", "Type the address with the TV remote's keyboard. The home computer reads the calendar for this TV, so keep it on."],
        vidaa: ["Needs a home computer that stays on, running Couch TV. The website home cannot read a calendar.", "Find your calendar's private address. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to Designs, pick At home, then Add a calendar link, and type the address."] }),
      until: "\"Add your calendar\"; then \"Nothing on today or tomorrow\" (or today, or this week, as picked) when the calendar is clear", build: "",
      ok: "Opens the day: every event on a timeline, then the rest of the week", platforms: plat("setup", "computer", "computer", { android: "The TV reads the calendar itself. The address stays on this TV, never in a design.", web: "The home computer reads the calendar for this TV.", vidaa: "Needs a home computer: the website home cannot read a calendar." }),
      sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    note: { name: "Family note", status: "setup", what: "A sticky note typed at home, with who it is from", needs: [NOTE_NEED],
      setup: setup("tv", typed(["Pick Write a note, type it, then press OK. Pick From to say who it is from."])), until: "\"Write a note\", and where", build: "",
      ok: "Opens the note big", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    list: { name: "List", status: "setup", what: "Shopping or to do, ticked with OK on the remote", needs: [LIST_NEED],
      setup: setup("tv", typed(["Pick Add a list and name it (up to 3), then Add an item for each thing.", "On the home, OK on the widget opens the list: OK ticks an item."])),
      until: "\"Add a list\", and where", build: "",
      ok: "Opens the whole list: OK ticks an item", platforms: plat("setup", "computer", "setup", KEPT), sizes: sz(["wtile", "small", "tall", "large"], [4, 2]) },

    // ---------- info ----------
    // a typed card (a title and words from the design) shows on every TV; a live number from home is the
    // extra that needs the computer at home (bridge/custom_cards.py)
    card: { name: "Custom card", status: "works", what: "Your own title and words, or a live number from your home: solar today, the pool",
      needs: ["Your title and words, typed in Couch TV Studio", "For a live number: a home computer that stays on, running Couch TV"],
      setup: setup("designer", inStudio("type a title and its words").concat(["For a live number: on the home computer, add it to Couch TV's settings under Custom cards, with no words in the widget."])),
      until: "Always shows your words. A card for a live number with no computer: \"Needs a home computer\", and where", build: "",
      ok: "Opens every custom card big", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    quote: { name: "Quote", status: "works", what: "A short line for the day, or your own words", needs: ["Nothing: the lines come with Couch TV"],
      setup: setup("nothing", ["Nothing to set up.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Kind of line, or type Your own words and Who said it."]), until: "Always shows a line", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    word: { name: "Word of the day", status: "works", what: "A word and what it means, in English or another language", needs: ["Nothing: the words come with Couch TV"],
      setup: setup("nothing", ["Nothing to set up.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Words in: English, Spanish, French, Italian, German or Japanese."]), until: "Always shows a word", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    // the feed is read through couch-tv itself (the launcher, the on-TV app or the home computer's
    // bridge: widget-web.js, /api/webdata), never a server of ours; ABC News unless the design picks another
    news: { name: "Headlines", status: "works", what: "One to four of the latest headlines from a news feed you pick (ABC News unless you choose another)",
      needs: ["Nothing on a Google TV, Android TV or Fire TV: Couch TV reads the feed itself", "On other TVs, the home computer, which reads the feed for the TV"],
      setup: setup("designer", {
        android: ["Nothing to set up: the headlines come from the best source for your country (ABC News in Australia).", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick News source: ABC News, SBS, The Guardian, BBC or RNZ, and How many headlines.", "Or in Couch TV Studio on your phone: tap the widget and pick them there, then send the design."],
        web: ["Keep the home computer on: it reads the news feed for this TV.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick News source: ABC News, SBS, The Guardian, BBC or RNZ, and How many headlines.", "Or in Couch TV Studio on your phone: tap the widget and pick them there, then send the design."],
        vidaa: ["Needs a home computer that stays on, running Couch TV. The website home cannot read news feeds.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick News source and How many headlines."] }),
      until: "\"Getting the headlines\" for a moment. If the feed cannot be read, it says so and tries again in a few minutes", build: "",
      ok: "Opens the headlines: the latest six, with how long ago each came out", platforms: plat("works", "computer", "computer", { android: "Couch TV on the TV reads the feed: no computer needed.", vidaa: "Needs a home computer: the website home cannot read news feeds." }), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    // ESPN's public scoreboards, asked by the TV itself (free, no key; unofficial, so they may change)
    sports: { name: "Scores", status: "works", beta: "Unofficial source: a free feed that may change. Couch TV can pause it for every TV, and then the widget says the feed is paused.", what: "This round's games with their scores, live ones first: AFL, NRL, A-League, Premier League, NBA, Big Bash or cricket",
      needs: ["Nothing: the TV reads the scores itself (the NRL unless you pick another)"],
      setup: setup("designer", {
        android: ["Nothing to set up: the widget shows the NRL.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Competition: AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket. Then Your team, from that competition's teams.", "Which games: every game, live games and your team, or only your team."],
        web: ["Keep the home computer on: it runs Couch TV for this TV.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Competition: AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket. Then Your team, from that competition's teams.", "Which games: every game, live games and your team, or only your team."],
        vidaa: ["Nothing to set up: the widget shows the NRL.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Competition: AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket. Then Your team, from that competition's teams.", "Which games: every game, live games and your team, or only your team."] }),
      until: "\"Getting the scores\" for a moment. Between seasons the last results or the first games, with \"Season over\" or \"Starts 17 Mar\"; \"No NRL games right now\" when there are none", build: "",
      ok: "Opens the round: every game with its score, live ones marked, and when the rest start", platforms: plat("works", "computer", "works", { web: "Works while the home computer is on (it runs Couch TV for this TV)." }), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    // Yahoo Finance's chart data (free, no key, unofficial), read through couch-tv itself (the launcher,
    // the on-TV app or the home computer's bridge: widget-web.js, /api/webdata), never a server of ours
    stocks: { name: "Markets", status: "works", beta: "Unofficial source: a free feed that may change. Couch TV can pause it for every TV, and then the widget says the feed is paused.", what: "Your watchlist: the ASX 200, the dollar and Bitcoin unless you pick others, each with today's move. ASX prices are about 20 minutes late",
      needs: ["Nothing on a Google TV, Android TV or Fire TV: Couch TV reads the prices itself", "On other TVs, the home computer, which reads the prices for the TV"],
      setup: setup("designer", {
        android: ["Nothing to set up: it shows the ASX 200, the Australian dollar and Bitcoin.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Shares and prices and type up to six codes with commas between, like BHP.AX, CBA.AX. Show the price turns the price on or off."],
        web: ["Keep the home computer on: it reads the prices for this TV.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Shares and prices and type up to six codes with commas between, like BHP.AX, CBA.AX. Show the price turns the price on or off."],
        vidaa: ["Needs a home computer that stays on, running Couch TV. The website home cannot read share prices.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Shares and prices and type up to six codes, like BHP.AX."] }),
      until: "\"Getting the prices\" for a moment. If they cannot be read, it says so and tries again in a few minutes", build: "",
      ok: "Opens the watchlist: each price, today's move and today's line", platforms: plat("works", "computer", "computer", { android: "Couch TV on the TV reads the prices: no computer needed.", vidaa: "Needs a home computer: the website home cannot read share prices." }), sizes: sz(["tile", "wtile", "small", "tall"], [2, 2]) },
    // OSRM's free route server with OpenStreetMap roads, asked by the TV itself: the usual drive, no live
    // traffic (that needs a paid map service). Both places stay on the TV (Location, and Commute in
    // Couch TV Studio's section of Home settings), never in a design
    commute: { name: "Commute", status: "setup", what: "The usual drive to work or school by road, and when to leave to arrive on time. No live traffic",
      needs: ["Your town, and where you drive to, set on the TV (never in the design)"],
      setup: setup("tv", [OPEN, "Go down to Location and set your town, if it is not set yet.", "On the TV: hold OK on the widget, then Edit on the TV (or Edit on your phone).", "Pick Where to: type the town or suburb you drive to and pick it. Leave from is your home's town unless you pick another.", "For when to leave: pick Arrive by and the minutes past the hour, then Minutes to spare and Weekdays only."]),
      until: "\"Set where you drive to\", and where", build: "",
      ok: "Opens the drive: how long, how far, and when to leave", platforms: plat("setup", "computer", "setup", { android: "The places are kept on the TV. Drive time without traffic.", web: "Works while the home computer is on. The places are kept on the TV." }), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- guests and the room ----------
    welcome: { name: "Welcome words", status: "works", what: "A greeting in your own words, or each guest by name with their check in or check out time from your bookings calendar", needs: ["The words, typed in Couch TV Studio, or on the TV (hold OK on the widget, Edit on the TV) or the phone", "For guest names: your Airbnb, Booking.com or VRBO calendar link, typed on the TV"],
      setup: setup("designer", {
        android: inStudio("type the words (no numbers or web addresses). For guest names, pick Guest name from: Bookings calendar").concat([
          "On the TV: Home settings, Designs, At home, Guests. Paste your Airbnb, Booking.com or VRBO calendar link with the phone remote's Type on the TV.",
          "Set Check in from and Check out by. Airbnb's link has no names: type each guest's first name once under Next guest."]),
        web: inStudio("type the words (no numbers or web addresses). For guest names, pick Guest name from: Bookings calendar").concat([
          "On the TV: Home settings, Designs, At home, Guests, and type your bookings calendar link. The home computer reads it, so keep it on.",
          "Set Check in from and Check out by. Airbnb's link has no names: type each guest's first name once under Next guest."]),
        vidaa: inStudio("type the words (no numbers or web addresses)").concat(["Guest names from a bookings calendar need a home computer that stays on, running Couch TV. The website home cannot read a calendar."]) }),
      until: "Always shows the words. With guest names on and no bookings link yet: \"Add your bookings calendar\", and where", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wline", "wtile", "medium", "wide"], [4, 1]) },
    quick: { name: "Quick buttons", status: "works", what: "Sleep timer, picture mode, look, input and more", needs: ["Nothing: buttons this TV cannot do are left out"],
      setup: setup("tv", { android: [OPEN, "Go down to Quick buttons and press OK.", "OK shows or hides a button. Hold OK on one to move it along.", "Or pick this widget's own buttons in Couch TV Studio."],
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
    screentime: { name: "Screen time", status: "setup", what: "Time in apps on this TV today, against a daily goal", needs: [SCREEN_NEED],
      setup: setup("tv", {
        android: ["Ask whoever set up Couch TV to switch on screen time from their computer (it allows one Android permission).", OPEN, "Or go down to Designs, pick At home, then Allow screen time, and switch on Home.", "Pick Daily goal for the time left each day."],
        web: ["Not possible on this TV: only Google TV, Android TV and Fire TV share screen time."],
        vidaa: ["Not possible on this TV: only Google TV, Android TV and Fire TV share screen time."] }),
      until: "\"Allow screen time on this TV\", and where", build: "",
      ok: "Opens today's screen time, app by app", platforms: plat("setup", "no", "no", { android: "Counts every app on this TV, not one person.", web: "This TV does not share screen time.", vidaa: "This TV does not share screen time." }),
      sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- your own AI (ask.js, docs/ASK-AI.md and docs/AI-AGENT.md) ----------
    ask: { name: "Ask AI", status: "setup", what: "Ask anything by voice or typing, answered on the TV by the AI you pick",
      needs: [ASK_NEED, "Your own key for that service, kept on this TV (a model on a home computer needs none)"],
      setup: setup("tv", {
        android: [OPEN_ASK, "Pick who answers: Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, a model at home (Ollama, LM Studio), another service, or Couch TV at home.",
          "Type the model name if it asks, then the key. With the phone remote, Type on the TV pastes it. The key stays on this TV.", "Pick Use it and try it: an answer shows on the TV.",
          "To ask: OK on the widget, then type, or press the microphone on the TV's keyboard and say it. Ask on the phone remote shows its answer here too."],
        web: [OPEN_ASK, "Pick who answers. Couch TV at home uses Claude on the home computer with your own Claude plan; or pick a service and type your own key.", "Pick Use it and try it: an answer shows on the TV.", "To ask: OK on the widget and type, or use Ask on the phone remote (its microphone too)."],
        vidaa: [OPEN_ASK, "Pick who answers: a service with your own key, or a model at home.", "Type the model name and the key with the TV remote, then pick Use it and try it.", "To ask: OK on the widget and type."] }),
      until: "\"Ask AI: pick who answers\", and OK sets it up step by step", build: "",
      ok: "Opens Ask AI: the answer in full, Ask a question and Set up",
      platforms: plat("setup", "setup", "setup", { android: "Your own key on this TV, a model at home, or Couch TV at home. Speak with the TV keyboard's microphone or the phone remote.",
        web: "Your own key on this TV, or the home computer's Claude on your own plan. Speak with the phone remote's microphone.", vidaa: "Your own key or a model at home, typed with the TV remote." }),
      sizes: sz(["wtile", "small", "medium", "wide", "large"], [4, 2]) },
    agent: { name: "From your AI", status: "setup", what: "Messages your own AI agent sends to the TV. The agent can also put a Couch TV Studio design on the TV (you press OK first)",
      needs: [AGENT_NEED, "An AI app that can use tools (MCP), such as Claude Desktop, Claude Code or Cursor, or any program on your network"],
      setup: setup("tv", [
        "Needs the Couch TV app on this TV, or a home computer running Couch TV: they hold the TV's own address for your agent.",
        "In your AI app, add Couch TV's TV tools with the TV app's or home computer's address and pairing key. The guide Connect your own AI agent has the lines to copy.",
        "Ask your AI: \"Show 'Dinner is ready' on the TV\". It shows over the home and in this widget.",
        "To change the home: ask it to design one with Couch TV Studio's tools and send it. The TV asks \"Use this design?\" first: press OK."]),
      until: "\"Connect your AI agent\", and OK shows how", build: "",
      ok: "Opens the last message in full, and how to connect your agent",
      platforms: plat("setup", "computer", "computer", { android: "Through the Couch TV app on this TV (no computer at home needed) or a home computer.", web: "Works while the home computer is on.", vidaa: "Needs a home computer running Couch TV: the website home has nothing an agent can reach." }),
      sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },

    // ---------- a smart stack (not a widget of its own: up to 10 widgets taking turns) ----------
    stack: { name: "Smart stack", status: "works", what: "Up to 10 widgets of one size taking turns in one place", needs: ["Whatever the widgets in it need"],
      setup: setup("designer", inStudio("drop widgets of the same size on top of each other")), until: "Each widget in it says what it needs", build: "",
      ok: "OK opens what the widget showing opens. Left and Right flick through", platforms: EVERY(), sizes: sz([], [2, 2]) }
  };

  // ---------------- each widget's own settings (docs/WIDGET-SETTINGS-CONTRACT.md) ----------------
  // A setting: { key, label, type, default, help } as the contract says, plus (WIDGET-SETTINGS-SPEC.md
  // section 5):
  //   store  "design": a public choice kept in the design (widget.opts[key]), which the TV may still
  //                     override for this widget (ST.widgets["<id>|<kind>"][key]);
  //          "tv":     kept on this TV only (ST.widgets), never in a design
  //   where  the screens that offer it: "studio", "tv" (Hold OK and Home settings), "phone"
  //   pre    true when it is needed before launch
  // and, by type: options [[value, label], ...] (choice), min max step (number), domain and many and
  // max (device), many and max (text: a list of words), from (tvlist: "lists", "photos", "people",
  // "calendars"), coast (place: beaches only), league (team: the key of the setting naming the
  // competition), when (only shown while another setting has this value, { key: value }; the value
  // "set" means while that setting differs from its own default), sets (the
  // design key a screen writes from this choice, worked out when it is saved), suggest (text: ready made
  // values to pick), private (never leaves the TV and the home Wi-Fi), needs ({ apps, bridge, ha }).
  // Two types beyond the contract's list: "tvlist" (one of the things kept on this TV: its lists, its
  // photos) and "image" (one photo put in the widget in Couch TV Studio).
  var ALL = ["studio", "tv", "phone"], ON_TV = ["tv", "phone"], STUDIO = ["studio"];
  function st(key, label, type, dflt, help, store, where, pre, more) {
    var s = { key: key, label: label, type: type, "default": dflt, help: help, store: store, where: where.slice(), pre: !!pre };
    if (more) Object.keys(more).forEach(function (k) { s[k] = more[k]; });
    return s;
  }
  var MONTHS = [[1, "January"], [2, "February"], [3, "March"], [4, "April"], [5, "May"], [6, "June"], [7, "July"], [8, "August"], [9, "September"], [10, "October"], [11, "November"], [12, "December"]];
  var YEARS = [["every", "Every year"]];
  for (var yr = 2026; yr <= 2040; yr++) YEARS.push([yr, String(yr)]);
  var HOURS = [["off", "No time set"]];
  for (var hr = 0; hr < 24; hr++) HOURS.push([hr, (hr % 12 || 12) + (hr < 12 ? "am" : "pm")]);
  var MINUTES = [];
  for (var mn = 0; mn < 60; mn += 5) MINUTES.push([mn, (mn < 10 ? "0" : "") + mn + " past the hour"]);
  var DAYS = [[0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"]];
  // the fixed lists the TV reads from (widget-web.js FEEDS, LEAGUES, TICKER_NAMES): ids, never links
  var FEED_OPTS = [["auto", "Best for your country"], ["abc", "ABC News"], ["abc-justin", "ABC News, just in"], ["abc-sport", "ABC Sport"], ["abc-business", "ABC Business"],
    ["sbs", "SBS News"], ["guardian", "The Guardian Australia"], ["bbc", "BBC World"], ["rnz", "RNZ"]];
  var LEAGUE_OPTS = [["afl", "AFL"], ["nrl", "NRL"], ["aleague", "A-League"], ["epl", "Premier League"], ["nba", "NBA"], ["bbl", "Big Bash"], ["cricket", "Cricket"]];
  var TICKER_OPTS = [["^AXJO", "ASX 200"], ["^AORD", "All Ords"], ["AUDUSD=X", "Australian dollar in US dollars"], ["AUDNZD=X", "Australian dollar in NZ dollars"],
    ["AUDEUR=X", "Australian dollar in euros"], ["AUDGBP=X", "Australian dollar in pounds"], ["AUDJPY=X", "Australian dollar in yen"], ["BTC-AUD", "Bitcoin"], ["ETH-AUD", "Ether"],
    ["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow Jones"], ["^FTSE", "FTSE 100"], ["^NZ50", "NZX 50"], ["^N225", "Nikkei"], ["GC=F", "Gold"], ["CL=F", "Oil"]];
  // the sport apps Up next's game mode looks in (widgets.js SPORT_APPS): any one of them will do
  var SPORT_APP_PKGS = ["au.com.kayosports.tv", "au.com.foxtel.atv", "au.com.ninenow.ctv", "com.swm.live", "au.com.tenplay", "com.dazn", "dazn"];

  var CLOCK_FMT = function () { return st("format", "12 or 24 hour", "choice", "auto", "Follow this TV uses the clock set in Home settings, Look and scenes.", "design", ALL, true,
    { options: [["auto", "Follow this TV"], ["12h", "12 hour"], ["24h", "24 hour"]] }); };
  var HEADING = function (help, pre) { return st("label", "Heading", "text", "", help, "design", ALL, pre !== false, { max: 40 }); };
  var PHOTO = function () { return st("photo", "Photo", "tvlist", "first", "Which of this TV's photos shows here. A photo put in the widget in Couch TV Studio shows instead. Add photos in Home settings, Look and scenes, Your photos.", "tv", ON_TV, true, { from: "photos", "private": true }); };
  var IMAGE = function () { return st("image", "Photo in the widget", "image", "", "Put one photo in the widget itself. It shows on every TV this design goes to.", "design", STUDIO, true); };
  // a heading that is not private: kept in the design since 0.13.10, so Couch TV Studio can set it too
  var HEADING_TV = function (help) { return st("label", "Heading", "text", "", help, "design", ALL, true, { max: 40 }); };
  var HA = { ha: true };
  var LIDS = [["#ffd60a", "Yellow"], ["#30d158", "Green"], ["#ff453a", "Red"], ["#0a84ff", "Blue"], ["#8e8e93", "Grey"], ["#1d1b18", "Black"], ["#a2845e", "Brown"], ["#bf5af2", "Purple"]];

  // a weather widget's own place (kept on this TV: Hold OK, Home settings or the phone) and its own
  // temperature unit (a design choice since 0.13.10, so Studio can set it; the TV can still change it for
  // itself; Roku and Apple TV draw designs in the home's own unit)
  var WX_TOWN = function (what, are) { return st("town", "Place", "place", "", "Where " + what + (are ? " are" : " is") + " for. Empty uses this home's town.", "tv", ON_TV, true, { "private": true }); };
  var DEGREES = function () { return st("degrees", "Temperature in", "choice", "auto", "Follow this TV uses Home settings, Weather, Units.", "design", ALL, true,
    { options: [["auto", "Follow this TV"], ["c", "Celsius (°C)"], ["f", "Fahrenheit (°F)"]] }); };

  // before launch (WIDGET-SETTINGS-SPEC.md section 2, the P items)
  var SETTINGS = {
    clock: [CLOCK_FMT()], tallclock: [CLOCK_FMT()], glassclock: [CLOCK_FMT()], flipclock: [CLOCK_FMT()],
    countdown: [
      st("label", "Name", "text", "", "What you are counting down to, like Ella's birthday.", "design", ALL, true, { max: 40 }),
      st("day", "Day", "number", 25, "The day of the month.", "design", ALL, true, { min: 1, max: 31, step: 1 }),
      st("month", "Month", "choice", 12, "The month of the day you are counting to.", "design", ALL, true, { options: MONTHS }),
      st("year", "Year", "choice", "every", "Pick a year for a one off day, like a wedding. Every year counts to the same day each year.", "design", ALL, true, { options: YEARS }),
      // a day that moves each year, worked out by the TV each year (widgets.js RULES); Day, Month and Year
      // are not used then
      st("rule", "Counts to", "choice", "date", "Easter, Mother's Day and Father's Day move each year. The TV works out the next one by itself.", "design", ALL, true,
        { options: [["date", "The day and month"], ["easter", "Easter Sunday"], ["mothers_day", "Mother's Day, second Sunday in May"], ["fathers_day", "Father's Day, first Sunday in September"], ["fathers_day_june", "Father's Day, third Sunday in June"]] }),
      st("unit", "Count in", "choice", "sleeps", "Sleeps suit children. Weeks suit a day far away. The two smallest sizes show only the number.", "design", ALL, true, { options: [["sleeps", "Sleeps"], ["days", "Days"], ["weeks", "Weeks"]] })
    ],
    // the weather widgets (WIDGET-SETTINGS-SPEC.md section 2, Weather): each one's own place, read for
    // that place alone (app.js airAndSurf), and its own units
    weather: [WX_TOWN("the weather"), st("place", "Show the town name", "toggle", true, "Turn off to show only the weather. A tile names only a place picked for it.", "design", ALL, true),
      st("hilo", "Show the high and low", "toggle", true, "Turn off to show only the temperature and the sky. A tile shows only those already.", "design", ALL, true), DEGREES()],
    bigtemp: [WX_TOWN("the temperature"), st("place", "Show the town name", "toggle", true, "Turn off to show only the temperature. A tile names only a place picked for it.", "design", ALL, true), DEGREES()],
    hourly: [WX_TOWN("the forecast"), st("hours", "How many hours", "choice", "auto", "A small widget shows only as many as fit.", "design", ALL, true,
      { options: [["auto", "As many as fit"], [4, "4"], [6, "6"], [8, "8"]] }), DEGREES()],
    rain: [WX_TOWN("the rain")],
    uv: [WX_TOWN("the UV")],
    sun: [WX_TOWN("sunrise and sunset", true)],
    moon: [st("hemi", "Moon seen from", "choice", "auto", "The moon looks the other way round south of the equator.", "design", ALL, true,
      { options: [["auto", "This home's town"], ["south", "The south"], ["north", "The north"]] })],
    air: [WX_TOWN("the air quality"), st("scale", "Scale", "choice", "auto", "Best for your country uses the American scale in the United States and the European one elsewhere.", "design", ALL, true,
      { options: [["auto", "Best for your country"], ["eu", "European"], ["us", "American"]] })],
    surf: [st("place", "Beach", "place", "", "Where the swell is read. Empty uses this home's town.", "tv", ON_TV, true, { coast: true, "private": true }),
      st("units", "Wave height in", "choice", "auto", "Best for your country uses feet in the United States and metres elsewhere.", "design", ALL, true,
        { options: [["auto", "Best for your country"], ["m", "Metres"], ["ft", "Feet"]] }),
      st("wind", "Wind in", "choice", "auto", "Best for your country uses miles an hour in the United States and kilometres an hour elsewhere.", "design", ALL, true,
        { options: [["auto", "Best for your country"], ["kmh", "Kilometres an hour"], ["kn", "Knots"], ["mph", "Miles an hour"]] })],
    aircon: [st("entity", "Room", "device", "", "Which aircon shows here. Empty shows the first one picked in Smart home.", "tv", ON_TV, true, { domain: "climate", needs: HA, "private": true }),
      st("others", "Show the other rooms", "toggle", true, "In a big widget, the other aircon rooms show beside this one.", "design", ALL, true)],
    controls: [st("switches", "Lights and switches", "device", [], "Which ones show here. None picked shows every one picked in Smart home. Locks, alarms, garage doors and gates never show on Couch TV.", "tv", ON_TV, true,
      { domain: ["light", "switch", "fan", "cover"], many: true, max: 16, needs: HA, "private": true })],
    camera: [st("cam", "Camera", "device", "", "Which camera shows here. Empty shows the first one picked in Smart home.", "tv", ON_TV, true, { domain: "camera", needs: HA, "private": true }),
      HEADING("A heading for this widget. Empty shows the camera's own name.")],
    sensor: [st("reading", "Sensor", "device", "", "Which sensor shows here. Empty shows the first one picked in Smart home.", "tv", ON_TV, true, { domain: "sensor", needs: HA, "private": true }),
      HEADING("A heading for this widget. Empty shows the sensor's own name.")],
    doorbell: [HEADING_TV("Empty shows the doorbell's own name."),
      st("picture", "Show the door camera", "toggle", true, "Off shows only when the doorbell last rang.", "design", ALL, true)],
    energy: [HEADING_TV("Empty shows the name from your smart home."),
      st("now", "Show power now", "toggle", true, "The power being made or used right now, beside today's total, in a big widget.", "design", ALL, true)],
    speakers: [st("players", "Speakers", "device", [], "Which speakers show here. None picked shows every one picked in Smart home.", "tv", ON_TV, true,
      { domain: "media_player", many: true, max: 6, needs: HA, "private": true })],
    scenes: [st("scenes", "Scenes", "device", [], "Which scenes show here. None picked shows every one picked in Smart home. Never one for a lock, alarm, garage door or gate. A script does what it was built to do.", "tv", ON_TV, true,
      { domain: ["scene", "script"], many: true, max: 10, needs: HA, "private": true })],
    battery: [st("low", "Red below", "number", 20, "A charge under this shows in red, so you know to charge it.", "design", ALL, true, { min: 5, max: 50, step: 5 })],
    news: [st("feed", "News source", "choice", "auto", "Where the headlines come from. Best for your country picks ABC News in Australia, BBC World in the UK and RNZ in New Zealand.", "design", ALL, true,
      { options: FEED_OPTS }),
      st("count", "How many headlines", "choice", "auto", "As many as fit shows more on a bigger widget. 1 or 2 always show, their words sized to fit, except on a widget one row tall, which has room for one.", "design", ALL, true, { options: [["auto", "As many as fit"], [1, "1"], [2, "2"]] })],
    sports: [
      st("league", "Competition", "choice", "nrl", "Which games show here.", "design", ALL, true, { options: LEAGUE_OPTS }),
      st("team", "Your team", "team", "", "Pick from the competition's teams. Cricket has no list: type the team's name and Couch TV checks it against the games it can see.", "design", ALL, true, { league: "league" }),
      st("games", "Which games", "choice", "all", "Only my team needs your team picked above.", "design", ALL, true, { options: [["all", "Every game"], ["live", "Live games and my team"], ["mine", "Only my team"]] })
    ],
    stocks: [st("tickers", "Shares and prices", "text", ["^AXJO", "AUDUSD=X", "BTC-AUD"], "Up to six, with commas between. A share's code like BHP.AX, ^AXJO for the ASX 200, AUDUSD=X for the dollar, BTC-AUD for Bitcoin.", "design", ALL, true,
      { many: true, max: 6, suggest: TICKER_OPTS }),
      st("price", "Show the price", "toggle", true, "Off shows only how much it moved today.", "design", ALL, true)],
    commute: [
      st("to", "Where to", "place", "", "The town or suburb you drive to. Kept in this TV's Home settings, never in a design.", "tv", ON_TV, true, { "private": true }),
      st("arrive_h", "Arrive by", "choice", "off", "Couch TV says when to leave to get there by then.", "design", ALL, true, { options: HOURS }),
      st("arrive_m", "Minutes past the hour", "choice", 0, "For 8:30am, pick 8am above and 30 past the hour here.", "design", ALL, true, { options: MINUTES, when: { arrive_h: "set" } }),
      st("buffer", "Minutes to spare", "number", 10, "Added to the drive when Couch TV says when to leave.", "design", ALL, true, { min: 0, max: 60, step: 5, when: { arrive_h: "set" } }),
      st("weekdays", "Weekdays only", "toggle", true, "Off works out when to leave on weekends too.", "design", ALL, true, { when: { arrive_h: "set" } }),
      st("from", "Leave from", "place", "", "Empty leaves from this home's town. Kept in this TV's Home settings, never in a design.", "tv", ON_TV, true, { "private": true })
    ],
    quote: [
      st("mood", "Kind of line", "choice", "all", "A new line each day, from the lines that come with Couch TV.", "design", ALL, true,
        { options: [["all", "A mix"], ["calm", "Slow down"], ["go", "Get going"], ["home", "Home and family"]] }),
      st("text", "Your own words", "text", "", "Shows instead of the line of the day. Empty goes back to the lines.", "design", ALL, true, { max: 120 }),
      st("sub", "Who said it", "text", "", "Shows under your own words.", "design", ALL, true, { max: 80, when: { text: "set" } })
    ],
    word: [
      st("lang", "Words in", "choice", "en", "Another language shows an everyday word, how to say it and what it means.", "design", ALL, true,
        { options: [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["it", "Italian"], ["de", "German"], ["ja", "Japanese"]] }),
      st("meaning", "Show what it means", "toggle", true, "Off shows only the word and how to say it, or for English what kind of word it is.", "design", ALL, true)
    ],
    ask: [st("keep", "Show the last answer", "choice", "always", "No keeps your questions private: the widget always just invites the next one.", "design", ALL, true,
      { options: [["always", "Until the next question"], ["hour", "For an hour"], ["never", "No"]] })],
    agent: [
      st("keep", "Show each message", "choice", "always", "After that the widget waits quietly for the next one.", "design", ALL, true,
        { options: [["always", "Until the next one"], ["hour", "For an hour"], ["day", "For a day"]] }),
      st("who", "Show who sent it", "toggle", true, "Off says From your AI instead of the agent's name.", "design", ALL, true)
    ],
    bins: [
      st("weekday", "Bin night", "choice", "none", "The night the bins go out.", "design", ALL, true, { options: [["none", "Not set yet"]].concat(DAYS) }),
      st("alt", "Taking turns", "toggle", false, "On when the two bins go out on alternate weeks.", "design", ALL, true),
      st("thisweek", "Which bin goes out this week", "choice", "a", "Pick the one going out this week and Couch TV keeps count from there.", "design", ALL, true,
        { options: [["a", "First bin"], ["b", "Second bin"]], when: { alt: true }, sets: "anchor" }),
      st("bin_a", "First bin", "text", "Recycling", "The name of the bin, like Recycling. A tile shows only the lid colours.", "design", ALL, true, { max: 20 }),
      st("bin_b", "Second bin", "text", "Garden", "The name of the other bin, like Garden. A tile shows only the lid colours.", "design", ALL, true, { max: 20 }),
      st("lid_a", "First bin's lid", "choice", "#ffd60a", "The colour of the first bin's lid.", "design", ALL, true, { options: LIDS }),
      st("lid_b", "Second bin's lid", "choice", "#30d158", "The colour of the second bin's lid.", "design", ALL, true, { options: LIDS })
    ]
  };
  // after launch (the L items in section 2): added to the end of each list, so a screen showing only
  // `pre` settings keeps its order
  var TOWN = function (what) { return st("town", "Place", "place", "", "Where " + what + " is for. Empty uses this home's town.", "tv", ON_TV, false, { "private": true }); };
  var CITY_OPTS = [["Australia/Brisbane", "Brisbane"], ["Australia/Sydney", "Sydney"], ["Australia/Perth", "Perth"], ["Pacific/Auckland", "Auckland"], ["Asia/Tokyo", "Tokyo"],
    ["Asia/Singapore", "Singapore"], ["Europe/London", "London"], ["Europe/Paris", "Paris"], ["America/New_York", "New York"], ["America/Los_Angeles", "Los Angeles"]];
  var LATER = {
    // the clocks, the date, the month, the countdown, the timer and the week's forecast: every one is
    // read by its renderer in widgets.js (and the Timers, World clocks and Calendar layers), so all are pre
    clock: [
      st("seconds", "Show seconds", "toggle", false, "Adds the seconds after the minutes.", "design", ALL, true),
      st("date", "Show the date", "toggle", true, "The date under the time, when the widget is tall enough.", "design", ALL, true),
      st("ampm", "Show am and pm", "toggle", true, "Only with the 12 hour clock, when the widget is wide enough.", "design", ALL, true)
    ],
    tallclock: [st("align", "Line up", "choice", "center", "Where the digits sit in the widget.", "design", ALL, true, { options: [["left", "Left"], ["center", "Middle"], ["right", "Right"]] })],
    glassclock: [st("scene", "Glass from", "choice", "auto", "The photo inside the digits.", "design", ALL, true,
      { options: [["auto", "This home's scene"], ["night", "Night"], ["fog", "Fog"], ["golden", "Golden hour"], ["dawn", "Dawn"], ["water", "Water"]] })],
    analog: [
      st("seconds", "Second hand", "toggle", true, "", "design", ALL, true),
      st("numbers", "Show the numbers", "toggle", false, "12, 3, 6 and 9 on the face.", "design", ALL, true)
    ],
    wordclock: [
      st("precise", "To the minute", "toggle", false, "Off says the time to the nearest five minutes, like ten past seven.", "design", ALL, true),
      st("dayline", "Show the day", "toggle", true, "Like Friday evening, under the time.", "design", ALL, true)
    ],
    worldclock: [
      st("cities", "Cities", "choice", [], "Up to four. None picked shows this TV's own town first, then London, New York and Tokyo.", "design", ALL, true, { options: CITY_OPTS, many: true, max: 4 }),
      CLOCK_FMT(),
      HEADING("Shows over the cities on the bigger sizes. Empty says World clock.")
    ],
    date: [
      st("show", "Shows", "choice", "date", "The weather needs your town, set in Home settings, Location.", "design", ALL, true,
        { options: [["date", "The date"], ["weather", "The weather"], ["both", "The date and the weather"]] }),
      st("dfmt", "Date style", "choice", "auto", "Day and date gets shorter when the widget is narrow.", "design", ALL, true,
        { options: [["auto", "Day and date"], ["short", "Short"], ["numeric", "Numbers only"], ["weekday", "Day of the week"], ["day_month", "Day and month"], ["full", "Day and date in full"]] }),
      st("place", "Show the town name", "toggle", true, "Beside the weather. Not on the two smallest sizes.", "design", ALL, true, { when: { show: "weather" } })
    ],
    month: [st("wstart", "Week starts on", "choice", "mon", "The smallest size shows only today.", "design", ALL, true, { options: [["mon", "Monday"], ["sun", "Sunday"]] })],
    timer: [
      st("minutes", "Quick start", "choice", 0, "OK on the widget starts a timer this long.", "design", ALL, true,
        { options: [[0, "Ask each time"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [20, "20 minutes"], [30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"]] }),
      st("label", "Timer name", "text", "", "A timer started from this widget has this name, like Pizza.", "design", ALL, true, { max: 24 })
    ],
    week: [
      st("town", "Place", "place", "", "Where the forecast is for. Empty uses this home's town.", "tv", ON_TV, true, { "private": true }),
      st("place", "Show the town name", "toggle", true, "Turn off to show only the forecast. The wide tile names only a place picked for it.", "design", ALL, true)
    ],
  };
  // the watching, apps and music widgets (keep to stack): every setting here is read by its renderer
  var WHOSE = function () { return st("person", "Whose shows", "tvlist", "auto", "Whoever is watching follows the person picked on the home. Add people in Home settings, People.", "tv", ON_TV, true,
    { from: "people", options: [["auto", "Whoever is watching"]], "private": true }); };
  // Hold OK on an app (Change app, Move, Remove, Add app) and the phone's Apps on this design change these
  var APPS_IN = function (label, help) { return st("apps", label, "apps", [], help, "design", ALL, true); };
  var ACROSS = function (more) { return st("cols", "Apps across", "choice", "auto", "How many apps in each row." + (more ? " " + more : ""), "design", ALL, true,
    { options: [["auto", "As many as fit"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]] }); };
  // the streaming apps Up next can take its show from (catalogue ids, app-catalogue.js)
  var SHOW_APPS = [["netflix", "Netflix"], ["youtube", "YouTube"], ["prime", "Prime Video"], ["disney", "Disney+"], ["stan", "Stan"], ["binge", "Binge"], ["iview", "ABC iview"],
    ["sbs", "SBS On Demand"], ["7plus", "7plus"], ["9now", "9Now"], ["10play", "10 Play"], ["kayo", "Kayo"], ["foxtel", "Foxtel Go"], ["paramount", "Paramount+"],
    ["appletv", "Apple TV"], ["max", "HBO Max"], ["dazn", "DAZN"], ["plex", "Plex"]];
  var QUICK_OPTS = [["sleep", "Sleep timer"], ["picture", "Picture"], ["look", "Look"], ["soundscape", "Soundscape"], ["screen_off", "Screen off"], ["headphones", "Headphones"],
    ["input", "Input"], ["bluetooth", "Bluetooth"], ["network", "Network"], ["tvsettings", "TV settings"], ["screensaver", "Screensaver"]];
  var WATCHING = {
    keep: [WHOSE()],
    keeprow: [HEADING("Empty shows Keep watching."),
      st("shows", "How many shows", "choice", "auto", "At most what fits in the widget.", "design", ALL, true, { options: [["auto", "As many as fit"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]] }), WHOSE()],
    // what it shows (the design key is still "sport", the game mode: false, true or auto), in plain words
    upnext: [st("sport", "What it shows", "choice", "auto", "Your next show is the show you were watching. Your last game is the last game watched in a sport app here, like Kayo or 7plus. The third choice shows it only beside Scores.", "design", ALL, true,
      { options: [[false, "Your next show"], [true, "Your last game"], ["auto", "Last game when Scores is on"]], needs: { apps: SPORT_APP_PKGS.slice() } }),
      st("apps", "Only from these apps", "choice", [], "None picked takes shows from any app.", "design", ALL, true, { options: SHOW_APPS, many: true, max: 6 })],
    picks: [HEADING("Empty shows Picks for you."),
      st("mix", "Picks from", "choice", "all", "Your own shows are the ones you left part way.", "design", ALL, true,
        { options: [["all", "Others at home and your own"], ["others", "Only what others are watching"], ["mine", "Only your own shows"]] })],
    nowplaying: [st("buttons", "Show the buttons", "toggle", true, "Previous, play and next under the song. A tile or small widget has no room for them.", "design", ALL, true),
      st("cover", "Show the cover", "toggle", true, "Off shows the song and artist only.", "design", ALL, true)],
    soundscape: [st("sound", "Sound", "choice", "rain", "OK on the widget plays it, and OK again stops it.", "design", ALL, true,
      { options: [["rain", "Rain"], ["fire", "Fire"], ["waves", "Waves"], ["brown", "Brown noise"]] }),
      st("volume", "Volume", "number", 50, "How loud this widget plays its sound.", "design", ALL, true, { min: 10, max: 100, step: 10 })],
    queue: [HEADING("Empty shows Up next."),
      st("count", "How many songs", "choice", "auto", "At most this many.", "design", ALL, true, { options: [["auto", "As many as fit"], [3, "3"], [5, "5"], [8, "8"]] })],
    games: [APPS_IN("Games", "Hold OK on a game to change, move or remove it."), HEADING("Empty shows Play.")],
    app: [APPS_IN("App", "Hold OK on it and pick Change app.")],
    folder: [st("label", "Folder name", "text", "", "Shown above the apps. On a tile it shows when the folder is opened. Empty shows no name.", "design", ALL, true, { max: 40 }),
      APPS_IN("Apps in the folder", "Hold OK on an app to change, move or remove it."), ACROSS("A tile always shows four small apps.")],
    dock: [APPS_IN("Apps", "None picked shows this TV's own apps. Hold OK on an app to change, move or remove it."),
      st("more", "All apps at the end", "toggle", true, "A tile at the end that opens every app.", "design", ALL, true)],
    appgrid: [APPS_IN("Apps", "None picked shows this TV's own apps. Hold OK on an app to change, move or remove it."), ACROSS(),
      st("names", "Show app names", "toggle", true, "Not shown on a small grid.", "design", ALL, true)],
    quick: [st("quick", "Buttons", "choice", [], "Up to six. None picked shows the home's own quick buttons. Buttons this TV cannot do are left out.", "design", ALL, true,
      { options: QUICK_OPTS, many: true, max: 6 })],
    stack: [st("turn", "Next widget", "choice", 20, "When the stack moves on to its next widget.", "design", ALL, true,
      { options: [[20, "Every 20 seconds"], [10, "Every 10 seconds"], [30, "Every 30 seconds"], [60, "Every minute"], [0, "By the time of day"]] })]
  };
  Object.keys(WATCHING).forEach(function (k) { SETTINGS[k] = WATCHING[k]; });
  Object.keys(LATER).forEach(function (k) { SETTINGS[k] = (SETTINGS[k] || []).concat(LATER[k]); });
  // a clock's own time zone (owner, 23 Nov 2026: Studio's Basic designer asks "Which time zone? Your TV's
  // time zone, or pick another"): an IANA id kept in the design; empty, or a zone the TV does not know,
  // keeps the TV's own time. Picked in Couch TV Studio or on the phone, never with the TV remote.
  ["clock", "tallclock", "glassclock", "flipclock", "analog", "wordclock"].forEach(function (k) {
    SETTINGS[k] = (SETTINGS[k] || []).concat([st("zone", "Time zone", "zone", "", "Empty uses this TV's own time zone.", "design", ["studio", "phone"], true)]);
  });
  // the sun clock: its own town, before launch (widgets.js R.solar names it and works the sun out for it)
  SETTINGS.solar = [st("town", "Place", "place", "", "Where the sun is for. Empty uses this home's town.", "tv", ON_TV, true, { "private": true })];
  // The family, guest and photo widgets (At home, kept on this TV: athome.js; this TV's photos and
  // people; the home computer's live cards). Every setting here is read by its renderer in widgets.js,
  // so all are before launch. Which list, note, calendars, people and photos point at what is really on
  // this TV (type tvlist), and stay on it.
  var HOME_SET = {
    photo: [PHOTO(), IMAGE(),
      st("fit", "Fill or fit", "choice", "cover", "Fit shows the whole photo with a border.", "design", ALL, true, { options: [["cover", "Fill the box"], ["contain", "Fit the whole photo"]] })],
    slideshow: [
      st("seconds_each", "Next photo every", "choice", 20, "How long each photo stays.", "design", ALL, true, { options: [[10, "10 seconds"], [20, "20 seconds"], [60, "1 minute"], [300, "5 minutes"]] }),
      st("shuffle", "Shuffle", "toggle", false, "On mixes up the order each day.", "design", ALL, true)],
    mosaic: [st("count", "How many photos", "choice", "auto", "Fewer photos show each one bigger.", "design", ALL, true, { options: [["auto", "As many as fit"], [3, "3"], [4, "4"], [5, "5"]] })],
    artframe: [PHOTO(), IMAGE(),
      st("mat", "Frame colour", "choice", "#fbf8f1", "The colour around the photo.", "design", ALL, true,
        { options: [["#fbf8f1", "Cream"], ["#ffffff", "White"], ["#1d1b18", "Black"], ["#8e8e93", "Grey"]] })],
    memory: [
      st("range", "Photos from", "choice", "day", "This week also shows photos taken up to three days either side of today, in other years.", "design", ALL, true,
        { options: [["day", "This day only"], ["week", "This week"]] }),
      st("ago", "Show how long ago", "toggle", true, "Off shows the year the photo was taken.", "design", ALL, true)],
    agenda: [
      st("calendars", "Calendars", "tvlist", "all", "Which of this TV's calendars show here. Add them in Home settings, Designs, At home.", "tv", ON_TV, true, { from: "calendars", "private": true }),
      st("days", "Days", "choice", "two", "Today and tomorrow shows tomorrow once today is clear.", "design", ALL, true, { options: [["today", "Today"], ["two", "Today and tomorrow"], ["week", "This week"]] })],
    people: [
      st("who", "Who shows", "tvlist", [], "None picked shows everyone. Add people in Home settings, People.", "tv", ON_TV, true, { from: "people", many: true, max: 8, "private": true }),
      st("names", "Show names", "toggle", true, "Off shows only each person's picture.", "design", ALL, true)],
    note: [st("byline", "Show who it is from", "toggle", true, "The name typed under From with the note. On a tile, only the name shows.", "design", ALL, true)],
    // the list always draws its own name, so it has no heading of its own
    list: [st("list", "List", "tvlist", "first", "Which of this TV's lists shows here. Add lists in Home settings, Designs, At home.", "tv", ON_TV, true, { from: "lists", "private": true }),
      st("done", "Show ticked items", "toggle", true, "Off hides what is already ticked.", "design", ALL, true)],
    guide: [st("sections", "Parts of the guide", "tvlist", [], "Which parts show here. None picked shows them all. Write the guide in Home settings, Designs, At home.", "tv", ON_TV, true,
      { from: "guide", many: true, max: 8, "private": true })],
    wifi: [st("hidepass", "Hide the password", "toggle", false, "On shows only the code to scan.", "design", ALL, true)],
    screentime: [st("appcount", "Apps shown", "choice", "auto", "Apps show beside the total on a Medium widget or bigger.", "design", ALL, true,
      { options: [["auto", "As many as fit"], [0, "None, only the total"], [3, "3"], [5, "5"]] })],
    welcome: [
      st("text", "Greeting", "text", "Welcome", "The big words, like Welcome or Hi there.", "design", ALL, true, { max: 80 }),
      st("sub", "Line under", "text", "", "A short line under the greeting. Empty shows none.", "design", ALL, true, { max: 80 }),
      st("source", "Guest name from", "choice", "typed", "Typed is the name set in At home, Guests, or on the phone remote.", "design", ALL, true,
        { options: [["typed", "Typed on the TV"], ["calendar", "Your bookings calendar"]] }),
      st("times", "Check in and out times", "toggle", true, "The line under says when the guest checks in or out.", "design", ALL, true, { when: { source: "calendar" } })],
    card: [
      st("label", "Title", "text", "", "The small heading. A card with no title and no words shows a live number.", "design", ALL, true, { max: 40 }),
      st("text", "Words", "text", "", "The big words on the card.", "design", ALL, true, { max: 80 }),
      st("live", "Live number", "tvlist", "turns", "For a card with no words: which live number from the home computer shows.", "tv", ON_TV, true, { from: "cards", "private": true })]
  };
  Object.keys(HOME_SET).forEach(function (k) { SETTINGS[k] = HOME_SET[k]; });
  Object.keys(SETTINGS).forEach(function (k) { if (C[k]) C[k].settings = SETTINGS[k]; });

  // A widget couch-tv cannot fill yet always shows the same card on a TV (widgets.js soon()), so its
  // `until` says exactly that, rather than each record wording it its own way
  Object.keys(C).forEach(function (k) {
    if (C[k].status === "not-built") C[k].until = "A card on the widget: \"" + C[k].name + ": not on this TV\" and what it needs. OK on it shows this.";
    // a TV whose couch-tv does not draw designs gets the same one step everywhere
    C[k].setup.steps.none = NOT_HERE.slice();
    // Roku and Apple TV: works (or set up first, as on a Samsung) for a kind Couch TV draws there, not
    // possible for the rest, with the honest line
    // A photo or art frame there shows only the photo put in the widget in Studio, never the TV's own.
    Object.keys(NATIVE).forEach(function (p) {
      var c = C[k], web = c.platforms.Tizen.need, need = c.status === "not-built" || !drawnOn(k, p) ? "no" : NATIVE_PHOTO[k] ? "setup" : web === "computer" || web === "works" ? "works" : web;
      c.platforms[p] = { on: onOf(need, "native"), need: need,
        note: need === "no" ? (c.status === "not-built" ? DEFAULT_NOTE.no : NOT_NATIVE) : NATIVE_PHOTO[k] ? NATIVE_PHOTO_NOTE : "Couch TV draws this on your " + NATIVE_NAME[p] + ", opened by the home computer." };
    });
  });

  // a Roku draws the moon as a plain disc with its name and how much is lit, the same way round everywhere
  C.moon.platforms["Roku OS"].note += " On a Roku the moon is a plain disc with its name and how much is lit, the same way round everywhere, and no next full moon.";

  // a Roku can run Couch TV as a channel alone (docs/ROKU.md): these read the home computer (HomeScene.brs,
  // the weather, the people and Keep watching come from it), so on a Roku they need it. An Apple TV always
  // has one.
  ["weather", "bigtemp", "keep", "keeprow", "people"].forEach(function (k) {
    C[k].platforms["Roku OS"] = { on: "setup", need: "computer", note: "Needs a home computer that stays on, running Couch TV: the Roku reads this from it." };
  });
  // a quote's built in lines are in the web home only: a Roku or an Apple TV shows the words typed in it
  ["Roku OS", "tvOS"].forEach(function (p) {
    C.quote.platforms[p] = { on: "setup", need: "setup", note: "Shows your own words only: type them in Couch TV Studio." };
  });
  // a smart stack on a Roku moves on once a minute, and the remote does not flick it
  C.stack.platforms["Roku OS"].note += " On a Roku it moves on to the next widget once a minute; Left and Right do not flick it.";

  // Samsung and LG: Couch TV is an app on the TV that runs with or without a home computer (docs/SAMSUNG.md,
  // docs/LG.md option A). The app reads the weather itself (Open-Meteo), keeps notes, lists and photos by web
  // address, and opens apps itself (samsung/app/tizen.js tizen.application, lg/app/webos.js luna
  // applicationManager), so these work without the computer, as on a VIDAA with no computer. News, markets,
  // the smart home, the agenda, Keep watching, the Spotify queue and the AI agent still need it.
  var APP_ALONE = { works: "Works in the Couch TV app, with or without a home computer.", setup: "Works in the Couch TV app once it is set up, with or without a home computer." };
  var OPENS_APPS = ["app", "folder", "dock", "appgrid", "games"], KEEP_PC = ["queue"];
  ["Tizen", "webOS"].forEach(function (p) {
    Object.keys(C).forEach(function (k) {
      var x = C[k].platforms[p], v = C[k].platforms.VIDAA;
      if (!x || x.need !== "computer" || KEEP_PC.indexOf(k) >= 0) return;
      var need = OPENS_APPS.indexOf(k) >= 0 ? "works" : v && (v.need === "works" || v.need === "setup") ? v.need : "";
      if (!need) return;
      var partial = x.on === "partial" || (v && v.on === "partial");
      C[k].platforms[p] = { on: partial ? "partial" : onOf(need, "web"), need: need, note: /computer/.test(x.note) ? APP_ALONE[need] : x.note };
    });
  });

  // the setup card a TV shows for a widget that has nothing real to show yet: the first line says what
  // is missing, the second where to go. Built only from this file, never from a design.
  var WHERE = { tv: "OK here shows the steps", phone: "Set up from the phone remote", computer: "OK here shows how to set it up", designer: "Set up in Couch TV Studio", nothing: "" };
  var SHORT = {};
  // [the line, where to go, the line for a tile (two short lines at most)]
  SHORT[TOWN_NEED] = ["Set your town", "Home settings, Location", "Set your town"];
  SHORT[PHOTOS_NEED] = ["Add your photos", "Home settings, Look and scenes, Your photos", "Add photos"];
  SHORT[WATCH_NEED] = ["Needs the Couch TV app on this TV or a home computer", "OK here shows how", "Needs setting up"];
  SHORT[HA_NEED] = ["Needs Home Assistant", "Home settings, Designs, Smart home", "Needs Home Assistant"];
  SHORT[QUEUE_NEED] = ["Needs Spotify connected", "On the home computer. OK here shows how", "Needs Spotify"];
  SHORT[C.card.needs[0]] = ["Type your words in Couch TV Studio", "Or a live number from the home computer. OK here shows how", "Type your words"];
  SHORT[C.surf.needs[0]] = ["Set your town by the beach", "Home settings, Location", "Set your town"];
  var AT = "Settings (hold OK), Home settings, Designs, At home";
  SHORT[NOTE_NEED] = ["Write a note", AT, "Write a note"];
  SHORT[LIST_NEED] = ["Add a list", AT, "Add a list"];
  SHORT[WIFI_NEED] = ["Add your guest Wi-Fi", AT, "Add Wi-Fi"];
  SHORT[GUIDE_NEED] = ["Write your house guide", AT, "Write a guide"];
  SHORT[CAL_NEED] = ["Add your calendar", AT, "Add a calendar"];
  SHORT[DATED_NEED] = ["Add your photos", "Home settings, Look and scenes, Your photos", "Add photos"];
  SHORT[SCREEN_NEED] = ["Allow screen time", AT, "Allow it first"];
  SHORT[ASK_NEED] = ["Ask AI: pick who answers", "OK here sets it up, step by step", "Set up Ask AI"];
  SHORT[AGENT_NEED] = ["Connect your AI agent", "OK here shows how", "Connect your AI"];
  SHORT[C.battery.needs[0]] = ["Allow nearby devices", "OK here asks Android", "Allow it first"];
  // tiny: the box is a tile, so the line has to fit two short lines (OK opens the whole record)
  function card(kind, tiny) {
    var c = C[kind];
    if (!c) return { line: tiny ? "Needs an update" : "This widget needs a newer Couch TV", sub: "" };
    if (c.status === "not-built") return { line: tiny ? "Not on this TV" : c.name + ": not on this TV", sub: c.needs[0].replace(/^Needs /, "It needs ") };
    var s = SHORT[c.needs[0]];
    if (s) return { line: tiny ? s[2] : s[0], sub: s[1] };
    // the TV never says which TVs a widget works on (owner, 23 Nov 2026): a need that names TVs is not drawn
    if (/Hisense|Samsung|Roku|Apple TV|Fire TV|Google TV|Android TV|website home/.test(c.needs[0])) return { line: tiny ? "Set up needed" : c.what, sub: "" };
    return { line: tiny ? "Set up needed" : c.needs[0], sub: WHERE[c.setup.where] || "" };
  }
  // the numbered steps for a widget on one TV system (a platform-setup.js key, or "android", "web",
  // "vidaa", "none")
  function steps(kind, platform) {
    var c = C[kind];
    if (!c) return [];
    var g = ["android", "web", "vidaa", "none"].indexOf(platform) >= 0 ? platform : groupOf(platform);
    if (g === "native") return nativeSteps(kind, NATIVE[platform] ? platform : "Roku OS");
    return (c.setup.steps[g] || c.setup.steps.android).slice();
  }
  // Roku and Apple TV have no Home settings and no Hold OK menu: a kind drawn there is set up on the
  // computer at home that opens Couch TV, and a design arrives by its own code screen
  function nativeSteps(kind, p) {
    var c = C[kind];
    if (c.status === "not-built" || !drawnOn(kind, p)) return [NOT_NATIVE];
    if (NATIVE_PHOTO[kind]) return ["Open your design in Couch TV Studio on your phone.", "Tap the widget, then put one photo in it.", NATIVE_SEND[p]];
    // the steps up to the first one on the TV's own menus (a Studio send becomes this TV's own), then
    // one line for the rest; a leading "Nothing to set up" stays
    var web = c.setup.steps.web || c.setup.steps.android, out = [], onTv = false;
    web.forEach(function (s) {
      if (onTv) return;
      if (s === SEND) { out.push(NATIVE_SEND[p]); return; }
      if (/hold OK|Home settings|^Go down to /i.test(s)) {
        onTv = true;
        if (/^Nothing to set up/.test(s) && !out.length) out.push("Nothing to set up.");
        return;
      }
      out.push(s);
    });
    if (onTv) out.push("Set on the home computer that opens Couch TV on your " + NATIVE_NAME[p] + ".");
    // there is no Hold OK menu on a Roku or an Apple TV, and the phone page cannot reach the design there
    out.push(NATIVE_CHANGE);
    return out;
  }

  // What a widget that is not set up yet says on the TV (owner, 23 Nov 2026): its name, one short line of
  // what it shows, then "Set up on your phone" and a code. The phone page (setup.html, #connect=<need>)
  // opens the step for `need`. Only private things a design never carries are here: the town, photos, a
  // calendar link, Spotify, Home Assistant, the guest WiFi, words typed at home and a team.
  var NEED = {
    town: ["solar", "weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "air", "surf", "date"],
    photos: ["photo", "slideshow", "mosaic", "artframe", "memory"],
    calendar: ["agenda"], spotify: ["queue"], wifi: ["wifi"], text: ["note", "list", "guide"], team: ["sports"],
    ha: ["speakers", "aircon", "scenes", "controls", "camera", "doorbell", "energy", "sensor"]
  };
  var NEED_OF = {};
  Object.keys(NEED).forEach(function (n) { NEED[n].forEach(function (k) { NEED_OF[k] = n; }); });
  // one short line each (widget-lines.js has them in every language)
  var FACE = {
    solar: "Sunrise and sunset", sun: "Sunrise and sunset", weather: "Your town's weather", bigtemp: "Your town's weather", hourly: "The next few hours",
    week: "The next 7 days", rain: "Rain in the next three hours", uv: "Today's UV", air: "How clean the air is", surf: "The swell at your beach",
    date: "Today's date and weather", photo: "One of your photos", artframe: "One of your photos", slideshow: "Your photos, one after another",
    mosaic: "A few of your photos", memory: "Photos from this day", agenda: "Your next events", queue: "Your Spotify queue",
    speakers: "Your speakers", aircon: "Your aircon", scenes: "Your scenes", controls: "Your lights and switches", camera: "Your camera",
    doorbell: "Your doorbell", energy: "Your solar and power", sensor: "A reading from your home", wifi: "A code guests scan to join",
    note: "A note for everyone", list: "Shopping or to do", guide: "What guests need to know", sports: "Your team's games"
  };
  function setupNeed(kind) { return NEED_OF[kind] || null; }
  // the name a waiting widget goes by on the TV, where it is not the kind's own name: the plain word people
  // know for it (the kind id and the name in Couch TV Studio and Home settings stay as they are)
  var FACE_NAME = { agenda: "Calendar" };
  function face(kind) { var c = C[kind]; return c && NEED_OF[kind] ? { name: FACE_NAME[kind] || c.name, line: FACE[kind] || "", need: NEED_OF[kind] } : null; }

  var API = {
    v: 2,
    // what a widget needs set up on the phone ("town", "photos", "calendar", "spotify", "wifi", "text",
    // "team", "ha") or null, and its face on the TV until then ({ name, line, need })
    setupNeed: setupNeed, face: face, needs: function () { return JSON.parse(JSON.stringify(NEED)); },
    platforms: PLATFORMS.slice(),
    groups: { android: ANDROID.slice(), web: WEB.slice(), vidaa: VIDAA.slice(), native: Object.keys(NATIVE) },
    // the kinds Couch TV draws itself on a Roku ("Roku OS") or an Apple TV ("tvOS"); [] elsewhere
    native: function (platform) { return (NATIVE[platform] || []).slice(); },
    groupOf: groupOf,
    kinds: function () { return Object.keys(C); },
    get: function (kind) { return C[kind] || null; },
    all: function () { return C; },
    on: function (kind, platform) { var c = C[kind]; return c && c.platforms[platform] ? c.platforms[platform].on : "no"; },
    need: function (kind, platform) { var c = C[kind]; return c && c.platforms[platform] ? c.platforms[platform].need : "no"; },
    steps: steps,
    // the widget's own settings (WIDGET-SETTINGS-CONTRACT.md): [] when it has none
    settings: function (kind) { var c = C[kind]; return (c && c.settings) || []; },
    // "" or the line saying why a widget is marked unofficial (its source is unofficial)
    beta: function (kind) { var c = C[kind]; return (c && c.beta) || ""; },
    card: card
  };
  root.CouchWidgetCaps = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
