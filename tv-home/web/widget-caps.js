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
//   beta        (only some) the unofficial label: why this widget is marked unofficial, in one plain line
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
  // the way into Home settings on every home: a design's Settings button (top right), the Hold OK menu, or
  // the classic home's gear. The remote's own Settings button often opens the TV's menu instead, so say so.
  var OPEN = "Hold OK and pick Settings (or OK on the gear at the screen edge), then Home settings. The remote's Settings button opens the TV's menu.";
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
  // smart home is set up on the TV itself (Home settings, couch-tv Studio, Smart home): the launcher
  // talks to Home Assistant on a Google TV, Android TV or Fire TV; on a TV whose home a computer runs,
  // that computer does (bridge/smarthome.py)
  var SH_CONNECT = "Go down to couch-tv Studio, then Smart home. Type Home Assistant's address, then paste a token with the phone remote's Type on the TV (the steps are on the screen).";
  function shSteps(what, after) {
    var pick = "Tick your " + what + ", then pick Save and show on the home.";
    return {
      android: ["Needs Home Assistant, the smart home app, running at home. Not in it yet? Smart home, Add a device we don't list, shows how.", OPEN, SH_CONNECT, pick].concat(after || []).slice(0, 5),
      web: ["Needs Home Assistant running at home, and the home computer on: it talks to Home Assistant for this TV.", OPEN, SH_CONNECT, pick].concat(after || []).slice(0, 5),
      vidaa: ["Needs a computer at home that stays on, running couch-tv (setup option B): the website home cannot reach Home Assistant.", OPEN, SH_CONNECT, pick]
    };
  }
  var SMART_HOME = shSteps("rooms and scenes", ["Press Home: they show here."]);
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
  // Ask AI and From your AI (ask.js)
  var ASK_NEED = "The AI you choose: Claude, OpenAI, Google Gemini or another service, a model at home, or couch-tv at home";
  var AGENT_NEED = "The couch-tv TV app or a computer at home running couch-tv, for your agent to reach the TV";
  var OPEN_ASK = "Move to the Ask AI widget and press OK, then pick Set up.";

  var TOWN_NEED = "Your town, set on the TV";
  var PHOTOS_NEED = "Your photos on the TV, or one photo put in the widget";
  var WATCH_NEED = "The couch-tv TV app or a computer at home that stays on";
  var HA_NEED = "Home Assistant (a smart home app) running at home";
  // the smart home widgets (group C): set up on the TV (Home settings, couch-tv Studio, Smart home)
  function haSteps(what) { return shSteps(what, [].slice.call(arguments, 1)); }
  var HA_PLAT = function () { return plat("setup", "computer", "computer", { android: "Set up on the TV: Home settings, couch-tv Studio, Smart home. No computer needed.", web: "The home computer talks to Home Assistant for this TV.", vidaa: "Needs a computer at home: the website home cannot reach Home Assistant." }); };
  // the Up next queue: Spotify's queue, read with the person's own Spotify sign in
  var QUEUE_NEED = "Spotify connected on the home computer, or on the website home on a Hisense";
  var SPOTIFY_ON = "On that computer, connect Spotify once: open the couch-tv Spotify page on it and sign in (setup guide, Spotify Now playing).";

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
      setup: setup("nothing", ["Nothing to set up for the date.", "For the weather, " + OPEN.charAt(0).toLowerCase() + OPEN.slice(1), "Go down to Location, pick Search for a town or city, type your town, then press OK."]),
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
    memory: { name: "On this day", status: "setup", what: "Your photos taken on this date in other years, with how long ago", needs: [DATED_NEED, "Photos taken on this day in another year"],
      setup: setup("tv", {
        android: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add photos from a USB drive or this TV, and choose your photos. couch-tv notes the day each was taken.", "Photos added before this version have no day: add them again.", "On the day, the widget shows the photos from that date in other years."],
        web: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "The day comes from the photo itself, when its address lets the TV read it, or from a date in its name (like IMG_20231118)."],
        vidaa: [OPEN, "Go down to Look and scenes, then down to Your photos.", "Pick Add a photo from a web address, type the photo's address, then press OK.", "The day comes from the photo itself, when its address lets the TV read it, or from a date in its name (like IMG_20231118)."] }),
      until: "\"Add your photos\"; then \"No photos from this day\" on days with none, never another day's photo", build: "",
      ok: "Opens this day's photos full screen", platforms: plat("setup", "computer:partial", "setup:partial", { android: "Photos added from a USB drive or this TV keep the day they were taken.", web: "Only photos whose address lets the TV read them, or with a date in their name.", vidaa: "Only photos whose address lets the TV read them, or with a date in their name." }),
      sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

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
    // made on the TV from its own Keep watching (widget-web.js picks): no outside service, nothing leaves
    picks: { name: "Picks for you", status: "setup", what: "Shows the others at home are watching, and your own shows left part way, each ready to play",
      needs: [WATCH_NEED],
      setup: setup("computer", { android: WATCH.android.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]),
        web: WATCH.web.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]),
        vidaa: WATCH.vidaa.concat(["Picks come from what everyone at home has on the go: add people in Home settings, People."]) }),
      until: "\"No picks yet\" until shows are on the go on this TV", build: "",
      ok: "Opens every pick with Play. OK on a poster plays it", platforms: plat("setup", "computer:partial", "computer", { web: "Only shows started from couch-tv's home.", vidaa: "Only with a computer at home: the website home cannot." }), sizes: sz(["small", "medium", "wide"], [4, 3]) },

    // ---------- apps ----------
    app: { name: "One app", status: "works", what: "One app as a big icon", needs: ["The app installed on this TV"],
      setup: setup("tv", { android: ["Go to More apps at the end of your apps, then open App Store.", "Find the app and install it.", "Press Home: it shows in this widget."],
        web: ["Install the app from the TV's own app store.", "Keep the home computer on: it opens apps for couch-tv."],
        vidaa: ["Install the app from the TV's own app store.", "Needs a computer at home to open it: the website home cannot open apps."] }),
      until: "\"This app is not on this TV\"", build: "",
      ok: "Opens the app", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["tile", "small"], [2, 2]) },
    folder: { name: "App folder", status: "works", what: "A box of apps with a name", needs: ["The apps, picked in couch-tv Studio and installed on this TV"],
      setup: setup("designer", inStudio("pick the apps for it").concat(["Or on the TV: hold OK on an app to change, move or remove it, or on Add app to add one."])), until: "Apps this TV does not have are dimmed: \"Not on this TV\"", build: "",
      ok: "Opens the folder full screen, every app big", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["tile", "small", "tall", "medium", "large"], [2, 2]) },
    dock: { name: "Dock", status: "works", what: "A row of your apps", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up. Hold OK on an app to change, move or remove it."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it. The last one opens all your apps", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz([], [6, 2], [["row8", "Short row", 8, 2], ["row12", "Row", 12, 2], ["row18", "Full row", 18, 2]]) },
    appgrid: { name: "App grid", status: "works", what: "Rows of apps with their names", needs: ["Nothing: it shows this TV's apps"],
      setup: setup("nothing", ["Nothing to set up. Hold OK on an app to change, move or remove it."].concat(APPS_ORDER.slice(0))), until: "Always shows the TV's apps", build: "",
      ok: "OK on an app opens it", platforms: plat("works", "computer", "computer", { vidaa: "Needs a computer at home: the website home cannot open apps." }), sizes: sz(["small", "medium", "large", "xl"], [4, 4]) },
    games: { name: "Games", status: "works", what: "Game apps as tall tiles", needs: ["Game apps installed on this TV"],
      setup: setup("designer", inStudio("pick the game apps").concat(["Or on the TV: hold OK on a game to change, move or remove it."])), until: "Games this TV does not have are dimmed: \"Not on this TV\"", build: "",
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
    queue: { name: "Up next queue", status: "setup", what: "The next songs in your Spotify queue", needs: [QUEUE_NEED, "Only Spotify: TVs and other music apps do not share their queue"],
      setup: setup("computer", { android: ["Needs a computer at home that stays on, running couch-tv (setup option B).", SPOTIFY_ON, "Play music in Spotify on any phone, computer or speaker: the next songs in your queue show here."],
        web: ["Keep the home computer on: it runs couch-tv for this TV.", SPOTIFY_ON, "Play music in Spotify on any phone, computer or speaker: the next songs in your queue show here."],
        vidaa: ["With a home computer that stays on: connect Spotify once on it (open the couch-tv Spotify page on it and sign in).", "With the website home and no computer: sign in to Spotify once on your own couch-tv site (setup guide, Hisense VIDAA, Spotify).", "Play music in Spotify: the next songs in your queue show here."] }),
      until: "\"Needs Spotify connected\", and where it is set up", build: "",
      ok: "Opens the next ten songs, big", platforms: plat("computer", "computer", "setup", { android: "Needs a home computer with Spotify connected (setup option B). Only Spotify shares its queue.", web: "Works while the home computer is on, with Spotify connected on it.", vidaa: "Works with the home computer, or the website home with Spotify signed in." }), sizes: sz(["small", "tall", "large"], [4, 4]) },
    speakers: { name: "Speakers", status: "setup", what: "Each speaker, what it plays and its volume", needs: [HA_NEED, "Your speakers picked on the TV"],
      setup: setup("tv", haSteps("speakers (up to 6, any Home Assistant knows)", "Press Home: each speaker and its volume show here. OK opens them: louder, quieter, play and pause.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens the speakers: louder, quieter, play and pause for each", platforms: HA_PLAT(), sizes: sz(["wtile", "small", "tall"], [4, 2]) },

    // ---------- smart home (Home Assistant, through the Android home) ----------
    aircon: { name: "Aircon", status: "setup", what: "A room's set temperature, what it is now, and the other rooms", needs: [HA_NEED, "Your aircon rooms picked on the TV"],
      setup: setup("tv", SMART_HOME), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Aircon: every room, warmer and cooler, on and off, mode and fan", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "tall", "medium", "large"], [2, 2]) },
    scenes: { name: "Scenes", status: "setup", what: "Your Home Assistant scenes as big buttons (Movie night, Goodnight)", needs: [HA_NEED, "Your scenes picked on the TV"],
      setup: setup("tv", SMART_HOME), until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "OK on a button runs it. On a tile, OK opens every button", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },
    controls: { name: "Control Centre", status: "setup", what: "Lights, switches, fans and blinds as big switches", needs: [HA_NEED, "Your lights and switches picked on the TV"],
      setup: setup("tv", haSteps("lights, switches, fans and blinds (up to 16)", "Press Home: your switches show here. OK opens them big, and OK on one switches it.", "Locks, alarms, garage doors and gates never show: nothing that opens the house from a TV remote.")),
      until: "\"Needs Home Assistant\", and where it is set up", build: "",
      ok: "Opens Control Centre: every switch big, OK on one switches it", platforms: HA_PLAT(), sizes: sz(["tile", "wtile", "small", "medium", "wide", "large"], [2, 2]) },
    camera: { name: "Camera", status: "setup", what: "A still picture from a camera, new every 2 seconds (no video)", needs: [HA_NEED, "Your cameras picked on the TV"],
      setup: setup("tv", haSteps("cameras (up to 4)", "Press Home: a still from the camera shows here, new every 2 seconds while the home is on screen. There is no live video and no sound.")),
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
      setup: setup("tv", haSteps("sensors (up to 8: the pool, a rain gauge, humidity)", "Press Home: the reading shows here, with its last 24 hours.")),
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
    bins: { name: "Bin night", status: "setup", what: "Tonight's bins with their lid colours", needs: ["Your bin night and bins, picked in couch-tv Studio"],
      setup: setup("designer", inStudio("pick your bin night, the bins and whether they take turns. Nothing personal goes in the design")), until: "\"Set your bin night in couch-tv Studio\"", build: "",
      ok: "Nothing: it is to look at", platforms: plat("setup", "computer", "setup"), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    people: { name: "People", status: "works", what: "Who is watching. OK switches person", needs: ["The people who watch, added on the TV"],
      setup: setup("tv", [OPEN, "Go down to People and press OK.", "Pick Add a person, type a name, then press OK. Do it for everyone who watches.", "OK on a name in the widget switches whose shows you see. It does not sign anyone in or out of Netflix."]),
      until: "\"Add people in Home settings\"", build: "",
      ok: "OK on a name makes them the one watching", platforms: plat("setup", "computer", "setup"), sizes: sz(["line", "wline", "wtile"], [4, 1]) },
    agenda: { name: "Agenda", status: "setup", what: "Today's events with times and colours, from your own calendar", needs: [CAL_NEED, "Something to read the calendar: the couch-tv TV home, or a computer at home"],
      setup: setup("tv", {
        android: ["Find your calendar's private address on a phone or computer. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to couch-tv Studio, pick At home, then Add a calendar link.", "Type the address, or paste it with Type on the TV in the phone remote. Today's events show within a minute."],
        web: ["Find your calendar's private address on a phone or computer. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to couch-tv Studio, pick At home, then Add a calendar link.", "Type the address with the TV remote's keyboard. The home computer reads the calendar for this TV, so keep it on."],
        vidaa: ["Needs a computer at home that stays on, running couch-tv (setup option B). The website home cannot read a calendar.", "Find your calendar's private address. Google Calendar: the calendar's Settings, Secret address.", OPEN, "Go down to couch-tv Studio, pick At home, then Add a calendar link, and type the address."] }),
      until: "\"Add your calendar\"; then \"Nothing on today or tomorrow\" when the calendar is clear", build: "",
      ok: "Opens the day: every event on a timeline, then the rest of the week", platforms: plat("setup", "computer", "computer", { android: "The TV reads the calendar itself. The address stays on this TV, never in a design.", web: "The home computer reads the calendar for this TV.", vidaa: "Needs a computer at home: the website home cannot read a calendar." }),
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
      needs: ["Your title and words, typed in couch-tv Studio", "For a live number: a computer at home that stays on, running couch-tv"],
      setup: setup("designer", inStudio("type a title and its words").concat(["For a live number: on the home computer, add it to couch-tv's settings under Custom cards, with no words in the widget."])),
      until: "Always shows your words. A card for a live number with no computer: \"Needs a home computer\", and where", build: "",
      ok: "Opens every custom card big", platforms: EVERY(), sizes: sz(["tile", "wtile", "small"], [2, 2]) },
    quote: { name: "Quote", status: "works", what: "A short line for the day, or your own words", needs: ["Nothing: the lines come with couch-tv"],
      setup: setup("nothing", ["Nothing to set up.", "For your own words: open your design in couch-tv Studio, tap the widget and type them.", SEND]), until: "Always shows a line", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },
    word: { name: "Word of the day", status: "works", what: "A word and what it means", needs: ["Nothing: the words come with couch-tv"],
      setup: setup("nothing", NOTHING), until: "Always shows a word", build: "",
      ok: "Nothing: it is to look at", platforms: EVERY(), sizes: sz(["wtile", "small", "medium"], [4, 2]) },
    // the feed is read through couch-tv itself (the launcher, the on-TV app or the home computer's
    // bridge: widget-web.js, /api/webdata), never a server of ours; ABC News unless the design picks another
    news: { name: "Headlines", status: "works", what: "One to four of the latest headlines from a news feed you pick (ABC News unless you choose another)",
      needs: ["Nothing on a Google TV, Android TV or Fire TV: couch-tv reads the feed itself", "On other TVs, the home computer, which reads the feed for the TV"],
      setup: setup("designer", {
        android: ["Nothing to set up: the headlines come from ABC News.", "To pick another news source, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick the news source: ABC News, SBS, The Guardian, BBC or RNZ.", SEND],
        web: ["Keep the home computer on: it reads the news feed for this TV.", "To pick another news source, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick the news source: ABC News, SBS, The Guardian, BBC or RNZ.", SEND],
        vidaa: ["Needs a computer at home that stays on, running couch-tv (setup option B). The website home cannot read news feeds.", "To pick another news source, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick the news source.", SEND] }),
      until: "\"Getting the headlines\" for a moment. If the feed cannot be read, it says so and tries again in a few minutes", build: "",
      ok: "Opens the headlines: the latest six, with how long ago each came out", platforms: plat("works", "computer", "computer", { android: "couch-tv on the TV reads the feed: no computer needed.", vidaa: "Needs a computer at home: the website home cannot read news feeds." }), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    // ESPN's public scoreboards, asked by the TV itself (free, no key; unofficial, so they may change)
    sports: { name: "Scores", status: "works", beta: "Unofficial source: a free feed that may change. couch-tv can pause it for every TV, and then the widget says the feed is paused.", what: "This round's games with their scores, live ones first: AFL, NRL, A-League, Premier League, NBA, Big Bash or cricket",
      needs: ["Nothing: the TV reads the scores itself (the NRL unless you pick another)"],
      setup: setup("designer", {
        android: ["Nothing to set up: the widget shows the NRL.", "To pick another competition or your team, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket, and type your team if you like.", SEND],
        web: ["Keep the home computer on: it runs couch-tv for this TV.", "To pick another competition or your team, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket, and type your team if you like.", SEND],
        vidaa: ["Nothing to set up: the widget shows the NRL.", "To pick another competition or your team, open your design in couch-tv Studio on your phone.", "Tap the widget, then pick AFL, NRL, A-League, Premier League, NBA, Big Bash or Cricket, and type your team if you like.", SEND] }),
      until: "\"Getting the scores\" for a moment; \"No NRL games this week\" between seasons", build: "",
      ok: "Opens the round: every game with its score, live ones marked, and when the rest start", platforms: plat("works", "computer", "works", { web: "Works while the home computer is on (it runs couch-tv for this TV)." }), sizes: sz(["wtile", "small", "tall", "medium"], [4, 2]) },
    // Yahoo Finance's chart data (free, no key, unofficial), read through couch-tv itself (the launcher,
    // the on-TV app or the home computer's bridge: widget-web.js, /api/webdata), never a server of ours
    stocks: { name: "Markets", status: "works", beta: "Unofficial source: a free feed that may change. couch-tv can pause it for every TV, and then the widget says the feed is paused.", what: "Your watchlist: the ASX 200, the dollar and Bitcoin unless you pick others, each with today's move. ASX prices are about 20 minutes late",
      needs: ["Nothing on a Google TV, Android TV or Fire TV: couch-tv reads the prices itself", "On other TVs, the home computer, which reads the prices for the TV"],
      setup: setup("designer", {
        android: ["Nothing to set up: it shows the ASX 200, the Australian dollar and Bitcoin.", "To pick your own, open your design in couch-tv Studio on your phone.", "Tap the widget, then type up to six share codes, like BHP.AX or CBA.AX for ASX shares.", SEND],
        web: ["Keep the home computer on: it reads the prices for this TV.", "To pick your own, open your design in couch-tv Studio on your phone.", "Tap the widget, then type up to six share codes, like BHP.AX or CBA.AX for ASX shares.", SEND],
        vidaa: ["Needs a computer at home that stays on, running couch-tv (setup option B). The website home cannot read share prices.", "To pick your own, open your design in couch-tv Studio on your phone.", "Tap the widget, then type up to six share codes, like BHP.AX.", SEND] }),
      until: "\"Getting the prices\" for a moment. If they cannot be read, it says so and tries again in a few minutes", build: "",
      ok: "Opens the watchlist: each price, today's move and today's line", platforms: plat("works", "computer", "computer", { android: "couch-tv on the TV reads the prices: no computer needed.", vidaa: "Needs a computer at home: the website home cannot read share prices." }), sizes: sz(["tile", "wtile", "small", "tall"], [2, 2]) },
    // OSRM's free route server with OpenStreetMap roads, asked by the TV itself: the usual drive, no live
    // traffic (that needs a paid map service). Both places stay on the TV (Location, and Commute in
    // couch-tv Studio's section of Home settings), never in a design
    commute: { name: "Commute", status: "setup", what: "The usual drive to work or school by road, and when to leave to arrive on time. No live traffic",
      needs: ["Your town, and where you drive to, set on the TV (never in the design)"],
      setup: setup("tv", [OPEN, "Go down to Location and set your town, if it is not set yet.", "Go down to couch-tv Studio, then Commute, Where to. Type the town or suburb you drive to and pick it.", "For when to leave: in couch-tv Studio on your phone, tap the widget and set the arrive by time, then send it again."]),
      until: "\"Set where you drive to\", and where", build: "",
      ok: "Opens the drive: how long, how far, and when to leave", platforms: plat("setup", "computer", "setup", { android: "The places are kept on the TV. Drive time without traffic.", web: "Works while the home computer is on. The places are kept on the TV." }), sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- guests and the room ----------
    welcome: { name: "Welcome words", status: "works", what: "A greeting in your own words, or each guest by name with their check in or check out time from your bookings calendar", needs: ["The words, typed in couch-tv Studio", "For guest names: your Airbnb, Booking.com or VRBO calendar link, typed on the TV"],
      setup: setup("designer", {
        android: inStudio("type the words (no numbers or web addresses). For guest names, pick Guest name from: Bookings calendar").concat([
          "On the TV: Home settings, couch-tv Studio, At home, Guests. Paste your Airbnb, Booking.com or VRBO calendar link with the phone remote's Type on the TV.",
          "Set Check in from and Check out by. Airbnb's link has no names: type each guest's first name once under Next guest."]),
        web: inStudio("type the words (no numbers or web addresses). For guest names, pick Guest name from: Bookings calendar").concat([
          "On the TV: Home settings, couch-tv Studio, At home, Guests, and type your bookings calendar link. The home computer reads it, so keep it on.",
          "Set Check in from and Check out by. Airbnb's link has no names: type each guest's first name once under Next guest."]),
        vidaa: inStudio("type the words (no numbers or web addresses)").concat(["Guest names from a bookings calendar need a computer at home that stays on, running couch-tv (setup option B). The website home cannot read a calendar."]) }),
      until: "Always shows the words. With guest names on and no bookings link yet: \"Add your bookings calendar\", and where", build: "",
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
    screentime: { name: "Screen time", status: "setup", what: "Time in apps on this TV today, against a daily goal", needs: [SCREEN_NEED],
      setup: setup("tv", {
        android: ["Ask whoever set up couch-tv to switch on screen time from their computer (it allows one Android permission).", OPEN, "Or go down to couch-tv Studio, pick At home, then Allow screen time, and switch on Home.", "Pick Daily goal for the time left each day."],
        web: ["Not possible on this TV: only Google TV, Android TV and Fire TV share screen time."],
        vidaa: ["Not possible on this TV: only Google TV, Android TV and Fire TV share screen time."] }),
      until: "\"Allow screen time on this TV\", and where", build: "",
      ok: "Opens today's screen time, app by app", platforms: plat("setup", "no", "no", { android: "Counts every app on this TV, not one person.", web: "This TV does not share screen time.", vidaa: "This TV does not share screen time." }),
      sizes: sz(["tile", "wtile", "small", "medium"], [2, 2]) },

    // ---------- your own AI (ask.js, docs/ASK-AI.md and docs/AI-AGENT.md) ----------
    ask: { name: "Ask AI", status: "setup", what: "Ask anything by voice or typing, answered on the TV by the AI you pick",
      needs: [ASK_NEED, "Your own key for that service, kept on this TV (a model on a computer at home needs none)"],
      setup: setup("tv", {
        android: [OPEN_ASK, "Pick who answers: Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, a model at home (Ollama, LM Studio), another service, or couch-tv at home.",
          "Type the model name if it asks, then the key. With the phone remote, Type on the TV pastes it. The key stays on this TV.", "Pick Use it and try it: an answer shows on the TV.",
          "To ask: OK on the widget, then type, or press the microphone on the TV's keyboard and say it. Ask on the phone remote shows its answer here too."],
        web: [OPEN_ASK, "Pick who answers. couch-tv at home uses Claude on the home computer with your own Claude plan; or pick a service and type your own key.", "Pick Use it and try it: an answer shows on the TV.", "To ask: OK on the widget and type, or use Ask on the phone remote (its microphone too)."],
        vidaa: [OPEN_ASK, "Pick who answers: a service with your own key, or a model at home.", "Type the model name and the key with the TV remote, then pick Use it and try it.", "To ask: OK on the widget and type."] }),
      until: "\"Ask AI: pick who answers\", and OK sets it up step by step", build: "",
      ok: "Opens Ask AI: the answer in full, Ask a question and Set up",
      platforms: plat("setup", "setup", "setup", { android: "Your own key on this TV, a model at home, or couch-tv at home. Speak with the TV keyboard's microphone or the phone remote.",
        web: "Your own key on this TV, or the home computer's Claude on your own plan. Speak with the phone remote's microphone.", vidaa: "Your own key or a model at home, typed with the TV remote." }),
      sizes: sz(["wtile", "small", "medium", "wide", "large"], [4, 2]) },
    agent: { name: "From your AI", status: "setup", what: "Messages your own AI agent sends to the TV. The agent can also put a couch-tv Studio design on the TV (you press OK first)",
      needs: [AGENT_NEED, "An AI app that can use tools (MCP), such as Claude Desktop, Claude Code or Cursor, or any program on your network"],
      setup: setup("computer", [
        "Needs the couch-tv TV app (setup option C) or a computer at home running couch-tv (option B): they hold the TV's own address for your agent.",
        "In your AI app, add couch-tv's TV tools with the TV app's or home computer's address and pairing key. The guide Connect your own AI agent has the lines to copy.",
        "Ask your AI: \"Show 'Dinner is ready' on the TV\". It shows over the home and in this widget.",
        "To change the home: ask it to design one with couch-tv Studio's tools and send it. The TV asks \"Use this design?\" first: press OK."]),
      until: "\"Connect your AI agent\", and OK shows how", build: "",
      ok: "Opens the last message in full, and how to connect your agent",
      platforms: plat("computer", "computer", "computer", { android: "Through the couch-tv TV app (no computer at home needed) or a computer at home.", web: "Works while the home computer is on.", vidaa: "Needs a computer at home running couch-tv: the website home has nothing an agent can reach." }),
      sizes: sz(["wtile", "small", "medium", "wide"], [4, 2]) },

    // ---------- a smart stack (not a widget of its own: up to 10 widgets taking turns) ----------
    stack: { name: "Smart stack", status: "works", what: "Up to 10 widgets of one size taking turns in one place", needs: ["Whatever the widgets in it need"],
      setup: setup("designer", inStudio("drop widgets of the same size on top of each other")), until: "Each widget in it says what it needs", build: "",
      ok: "OK opens what the widget showing opens. Left and Right flick through", platforms: EVERY(), sizes: sz([], [2, 2]) }
  };

  // A widget couch-tv cannot fill yet always shows the same card on a TV (widgets.js soon()), so its
  // `until` says exactly that, rather than each record wording it its own way
  Object.keys(C).forEach(function (k) {
    if (C[k].status === "not-built") C[k].until = "A card on the widget: \"" + C[k].name + ": not on this TV\" and what it needs. OK on it shows this.";
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
  SHORT[HA_NEED] = ["Needs Home Assistant", "Home settings, couch-tv Studio, Smart home", "Needs Home Assistant"];
  SHORT[QUEUE_NEED] = ["Needs Spotify connected", "On the home computer. OK here shows how", "Needs Spotify"];
  SHORT[C.card.needs[0]] = ["Type your words in couch-tv Studio", "Or a live number from the home computer. OK here shows how", "Type your words"];
  SHORT[C.surf.needs[0]] = ["Set your town by the beach", "Home settings, Location", "Set your town"];
  var AT = "Settings (hold OK), Home settings, couch-tv Studio, At home";
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
    if (!c) return { line: tiny ? "Needs an update" : "This widget needs a newer couch-tv", sub: "" };
    if (c.status === "not-built") return { line: tiny ? "Not on this TV" : c.name + ": not on this TV", sub: c.needs[0].replace(/^Needs /, "It needs ") };
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
    // "" or the line saying why a widget is marked unofficial (its source is unofficial)
    beta: function (kind) { var c = C[kind]; return (c && c.beta) || ""; },
    card: card
  };
  root.CouchWidgetCaps = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
