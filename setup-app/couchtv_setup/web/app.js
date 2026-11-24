// couch-tv Setup page. Everything that comes from the network or the TV is put on the page with
// textContent, never as HTML.
(function () {
  "use strict";
  var KEY = document.querySelector('meta[name="setup-key"]').content;
  var OS = document.querySelector('meta[name="setup-os"]').content;
  var $ = function (id) { return document.getElementById(id); };
  var state = { mode: "setup", ip: null, kind: null, facts: null, route: null, weather: null, remote: false,
                look: null, tried: 0, devStep: "dev-classic" };

  // An error from this app's own server: plain words, a code, and the technical part as detail.
  function problem(j) {
    var e = new Error(j.error || "That step did not work. Try it again.");
    e.code = j.code; e.detail = j.detail; e.fix = j.fix;
    return e;
  }

  // The page could not reach couch-tv Setup on this computer at all (the app was closed).
  var LOST = "This page lost touch with couch-tv Setup on this computer. Open the app again, then start over.";

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Key": KEY },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw problem(j);
        return j;
      }, function (x) { var e = new Error(LOST); e.code = "lost_app"; e.detail = String(x); throw e; });
    }, function (x) { var e = new Error(LOST); e.code = "lost_app"; e.detail = String(x); throw e; });
  }

  // A slow step runs as a job; this asks how it is going until it is done.
  function job(path, body, onProgress) {
    return api(path, body).then(function () {
      return new Promise(function (resolve, reject) {
        (function tick() {
          api("/api/job").then(function (j) {
            if (onProgress) onProgress(j.progress || 0, j.message || "");
            if (j.running) return setTimeout(tick, 700);
            if (j.error) return reject(problem(j));
            resolve(j.result);
          }, reject);
        })();
      });
    });
  }

  function show(step) {
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s.dataset.step !== step; });
    $("error").hidden = true;
    window.scrollTo(0, 0);
  }

  // Plain words on the page; the technical part only behind Details. This computer blocking the app
  // from the home network gets its own screen with Look again.
  function fail(e) {
    if (e && e.code === "local_network_blocked") {
      text("blocked-text", e.message);
      show("blocked");
      return;
    }
    text("error-text", (e && e.message) || "That step did not work. Try it again.");
    text("error-detail", (e && e.detail) || "");
    $("error-more").hidden = !(e && e.detail);
    $("error").hidden = false;
  }

  function text(id, t) { $(id).textContent = t; }

  document.querySelectorAll("[data-os]").forEach(function (el) { el.hidden = el.dataset.os !== OS; });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () { show(b.dataset.go); });
  });
  setInterval(function () { api("/api/ping").catch(function () {}); }, 20000);

  // ---- find ----

  // The list finds TVs by itself and keeps looking while it is on screen, so a TV turns Ready on its own
  // once its switch is on (the person never comes back to press Next).
  var poll = null, openRow = null, rows = {};
  var PILL = { ready: ["Ready", "ready"], code: ["Type the code", "step"], pair: ["1 step on the TV", "step"],
               "switch": ["1 step on the TV", "step"], other: ["Found. Can't install from here yet", "other"] };

  function onFind() { return !document.querySelector('[data-step="find"]').hidden; }

  function scan() {
    show("find");
    text("find-status", "Looking on your Wi-Fi…");
    $("found").textContent = "";
    $("find-help").hidden = true;
    $("find-watch").hidden = true;
    $("guide").hidden = true;
    openRow = null; rows = {};
    lookAgain();
  }

  function lookAgain() {
    clearTimeout(poll);
    job("/api/scan").then(function (r) {
      if (!onFind() || state.mode !== "setup" && state.mode !== "undo") return;
      drawRows(r.tvs || []);
      poll = setTimeout(function () { if (onFind()) lookAgain(); }, 6000);
    }, function (e) { if (onFind()) { fail(e); $("find-help").hidden = false; } });
  }

  function stopLooking(then) {
    clearTimeout(poll); poll = null;
    // a scan may still be running: wait for it, so the next step is not told "still busy"
    (function wait() {
      api("/api/job").then(function (j) { if (j.running) return setTimeout(wait, 400); then(); }, then);
    })();
  }

  var HELPER_NAMES = { samsung: "Samsung", lg: "LG", roku: "Roku" };
  function helperKind(t) {
    return ({ Tizen: "samsung", webOS: "lg", "Roku OS": "roku" })[t.other] || null;
  }

  function drawRows(tvs) {
    var box = $("found");
    var before = rows; rows = {};
    box.textContent = "";
    var usable = tvs.filter(function (t) { return t.android || t.status === "other"; });
    text("find-status", usable.length ? (usable.length === 1 ? "Found your TV." : "Found " + usable.length + " TVs. Which one?") : "No TV found yet.");
    $("find-help").hidden = usable.length > 0;
    $("find-watch").hidden = !usable.length;
    usable.forEach(function (t) {
      rows[t.ip] = t;
      var row = document.createElement("div");
      row.className = "tvrow" + (openRow === t.ip ? " open" : "");
      var who = document.createElement("div"); who.className = "who";
      var b = document.createElement("b"); b.textContent = t.label;
      var small = document.createElement("small");
      small.textContent = [t.model && t.model !== t.label ? t.model : "", t.ip].filter(Boolean).join(", ");
      who.appendChild(b); who.appendChild(small);
      var pill = document.createElement("span");
      var p = PILL[t.status] || PILL["switch"];
      pill.className = "pill " + p[1]; pill.textContent = p[0];
      row.appendChild(who); row.appendChild(pill);
      if (t.status === "other") {
        var note = document.createElement("small");
        var kind = helperKind(t);
        note.textContent = kind ? "Needs the helper." : "Couch TV goes on this TV another way. See the guide on GitHub.";
        who.appendChild(document.createElement("br")); who.appendChild(note);
        if (kind) {
          var hb = document.createElement("button");
          hb.textContent = "Set up the helper";
          hb.addEventListener("click", function () { state.helperTv = { ip: t.ip, kind: kind, name: t.label }; text("helper-tv-title", "Your " + HELPER_NAMES[kind] + " TV needs the helper."); show("helper-tv"); });
          row.appendChild(hb);
        }
      } else {
        var go = document.createElement("button");
        go.className = t.status === "ready" ? "primary" : "";
        go.textContent = t.status === "ready" ? "Set up" : t.status === "code" ? "Type the code" : "Show me how";
        go.addEventListener("click", function () { rowAction(t.ip); });
        row.appendChild(go);
      }
      box.appendChild(row);
    });
    // the TV whose steps are open just became ready, or its pairing screen just opened
    if (openRow && rows[openRow] && before[openRow] && rows[openRow].status !== before[openRow].status) openGuide(rows[openRow]);
  }

  function rowAction(ip) {
    var t = rows[ip];
    if (!t) return;
    if (t.status === "ready" || t.status === "code") return setUpRow(t);
    openGuide(t);
  }

  function setUpRow(t) {
    state.ip = t.ip; state.look = t; state.tried = 0;
    state.kind = (t.known && t.known.kind) || state.kind || "google";
    state.devStep = "find";
    if (state.mode === "undo" && !t.adb_5555 && !t.wireless_debugging) return pick(t.ip, t);
    stopLooking(function () {
      if (t.adb_5555) return allow();
      if (t.status === "code") {
        startPair();
        if (t.pairing_port) { $("pair-port").value = t.pairing_port; text("pair-status", "Found the pairing screen. Type the 6 numbers and press Pair."); }
        return;
      }
      // Wireless debugging, paired with this computer before: straight in, no code
      text("find-status", "Connecting to " + t.label + "…");
      job("/api/connect-tls", { ip: t.ip, port: t.wireless_debugging }).then(connected, function (e) {
        fail(e); show("find"); lookAgain();
      });
    });
  }

  // The few steps on the TV for this TV's Android version, as little TV screens.
  function openGuide(t, extra) {
    openRow = t.ip;
    document.querySelectorAll(".tvrow").forEach(function (r) { r.classList.remove("open"); });
    var body = { row: t };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    api("/api/guide", body).then(function (g) {
      state.guide = { ip: t.ip, route: g.route, extra: extra || {} };
      text("guide-title", t.label + ": " + (g.route === "ready" ? "ready to set up" : "the steps on the TV"));
      var box = $("guide-steps"); box.textContent = "";
      g.steps.forEach(function (s, i) {
        var shot = document.createElement("div"); shot.className = "shot";
        var scr = document.createElement("div"); scr.className = "screen";
        var path = document.createElement("div"); path.className = "path"; path.textContent = s.path.join("  ›  ");
        scr.appendChild(path);
        var lit = document.createElement("div"); lit.className = "item lit"; lit.textContent = s.pick;
        var other = document.createElement("div"); other.className = "item"; other.textContent = "…";
        scr.appendChild(other); scr.appendChild(lit);
        var words = document.createElement("div");
        var h = document.createElement("h3"); h.textContent = (i + 1) + ". " + s.title;
        var ol = document.createElement("ul");
        s.lines.forEach(function (l) { var li = document.createElement("li"); li.textContent = l; ol.appendChild(li); });
        words.appendChild(h); words.appendChild(ol);
        shot.appendChild(scr); shot.appendChild(words);
        box.appendChild(shot);
      });
      $("guide-which").hidden = g.route !== "choose";
      $("guide-fire").hidden = g.route === "fire" || g.route === "ready";
      var next = $("guide-next");
      next.hidden = g.route === "choose";
      next.textContent = g.route === "pair" ? "I see the code" : g.route === "ready" ? "Set up" : "Done, connect";
      $("guide").hidden = false;
    }, fail);
  }

  document.querySelectorAll("[data-which]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = rows[openRow] || state.look; if (t) openGuide(t, { wireless: b.dataset.which === "wireless" });
    });
  });
  $("guide-fire").addEventListener("click", function () {
    var t = rows[openRow]; if (t) { state.kind = "fire"; openGuide(t, { kind: "fire" }); }
  });
  $("guide-next").addEventListener("click", function () {
    var t = rows[openRow]; if (!t) return;
    var g = state.guide || {};
    state.ip = t.ip; state.look = t; state.tried = 0; state.devStep = "find";
    if (g.route === "ready") return setUpRow(t);
    if (g.route === "pair") {
      return stopLooking(function () {
        startPair();
        if (t.pairing_port) $("pair-port").value = t.pairing_port;
      });
    }
    state.kind = g.route === "fire" ? "fire" : (t.known && t.known.kind) || "google";
    stopLooking(allow);
  });

  // What kind of TV it most likely is, from what we already know: a TV this app connected to before, then
  // what it announces. Google TV and Android TV announce themselves; a Fire TV only has ADB on 5555.
  function guessKind(seen, r) {
    var known = (seen && seen.known) || r.known;
    if (known && known.kind) return known.kind;
    var named = (seen && (seen.name || seen.wireless_debugging)) || r.android_remote;
    if (named) return "google";
    if (r.kind === "silent" || (r.adb_5555 && r.kind === "android")) return "fire";
    return null;
  }

  function pick(ip, seen) {
    state.ip = ip;
    api("/api/look", { ip: ip }).then(function (r) {
      state.look = r;
      if (r.kind === "samsung" || r.kind === "lg" || r.kind === "roku") {
        var names = { samsung: "Samsung", lg: "LG", roku: "Roku" };
        text("stop-title", "A " + names[r.kind] + " needs another way");
        text("stop-text", "couch-tv can go on a " + names[r.kind] + ", but not from this app: it needs a computer at home " +
          "that stays on and opens couch-tv each time the TV is switched on, and the Home button still opens " +
          names[r.kind] + "'s own menu. The guide on GitHub walks through it.");
        text("stop-more", "Or plug a Google TV box (for example the Google TV Streamer) into the TV's HDMI: this app can set that up, and it gets everything.");
        return show("stop");
      }
      var guess = guessKind(seen, r);
      if (state.mode === "undo") return undoShortcut(ip, seen, r, guess);
      return askKind(r, guess);
    }, fail);
  }

  // Undo on a TV this computer is already allowed on: no need to ask what it is again.
  function undoShortcut(ip, seen, r, guess) {
    api("/api/info").then(function (i) {
      if (i.connected && i.ip === ip && i.facts) return connected({ facts: i.facts, route: i.route });
      if (r.adb_5555) { state.kind = guess; return allow(); }
      askKind(r, guess);
    }, function () { askKind(r, guess); });
  }

  function askKind(r, guess) {
    {
      text("kind-line", guess === "fire" ? "It looks like a Fire TV." : r.kind === "android" ? "It looks like an Android based TV." :
        "It is not answering yet. That is normal for a Fire TV before ADB debugging is on. Pick what it is.");
      document.querySelectorAll("[data-kind]").forEach(function (b) { b.classList.toggle("guess", b.dataset.kind === guess); });
      show("kind");
      document.querySelectorAll("[data-kind]").forEach(function (b) { if (b.dataset.kind === guess) b.focus(); });
    }
  }

  $("ip-go").addEventListener("click", function () { stopLooking(function () { pick($("ip").value.trim(), null); }); });
  $("rescan").addEventListener("click", scan);

  document.querySelectorAll("[data-kind]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.kind = b.dataset.kind;
      state.tried = 0;
      var look = state.look || {};
      // Already answering on the network debugging port: no steps needed, straight to the Allow question.
      if (state.kind !== "fire" && look.adb_5555) {
        state.devStep = state.kind === "google" ? "dev-google" : "dev-classic";
        if (state.kind === "android") classicSteps("android");
        return allow();
      }
      if (state.kind === "google") return startGoogle();
      classicSteps(state.kind);
    });
  });

  function classicSteps(which) {
    $("howto-android").hidden = which !== "android";
    $("howto-usb").hidden = which !== "usb";
    $("howto-fire").hidden = which !== "fire";
    $("fire-note").hidden = which !== "fire";
    text("classic-title", which === "fire" ? "Switch on ADB debugging" : "Switch on USB debugging");
    state.devStep = "dev-classic";
    show("dev-classic");
  }

  // What this TV showed before anything was switched on decides which way in it needs.
  var ROUTE_WORDS = {
    pair: "This TV has Wireless debugging, so you will type a 6 number code from the TV. First, Developer options.",
    usb: "This TV runs Android 11, so it has no Wireless debugging: you will switch on USB debugging, and the TV asks to allow this computer. No cable is needed. First, Developer options.",
    unknown: "Google TVs on Android 12 or newer have Wireless debugging. Google TVs on Android 11 (many 2021 and 2022 Hisense, Toshiba and TCL TVs) only have USB debugging, and that works too, with no cable. Switch on Developer options, then pick what your TV shows."
  };

  function startGoogle() {
    var route = (state.look && state.look.route) || "unknown";
    text("route-line", ROUTE_WORDS[route] || ROUTE_WORDS.unknown);
    state.devStep = "dev-google";
    show("dev-google");
  }

  document.querySelectorAll("[data-dev]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.dev === "wireless") return startPair();
      classicSteps("usb");
    });
  });

  // ---- Google TV: pairing code ----

  var portTimer = null;
  function startPair() {
    show("dev-google-pair");
    $("code").value = "";
    $("pair-port").value = "";
    text("pair-status", "");
    clearInterval(portTimer);
    portTimer = setInterval(function () {
      if ($("pair-port").value || document.querySelector('[data-step="dev-google-pair"]').hidden) return;
      api("/api/pairing-port", { ip: state.ip }).then(function (r) {
        if (r.port && !$("pair-port").value) {
          $("pair-port").value = r.port;
          text("pair-status", "Found the pairing screen. Type the 6 numbers and press Pair.");
        }
      }, function () {});
    }, 3000);
  }

  $("pair-go").addEventListener("click", function () {
    var code = $("code").value.replace(/\D/g, ""), port = $("pair-port").value.replace(/\D/g, "");
    if (code.length !== 6) return fail(new Error("The code is the 6 numbers under Wi-Fi pairing code on the TV."));
    if (!port) return fail(new Error("Type the port too: the numbers after the colon under IP address & Port."));
    text("pair-status", "Pairing…");
    job("/api/pair", { ip: state.ip, code: code, port: Number(port) }, function (f, m) { if (m) text("pair-status", m + "…"); })
      .then(function (r) {
        clearInterval(portTimer);
        if (r.need_port) return show("tls-port");
        connected(r);
      }, function (e) { text("pair-status", ""); fail(e); });
  });

  $("tls-go").addEventListener("click", function () {
    text("tls-status", "Connecting…");
    job("/api/connect-tls", { ip: state.ip, port: Number($("tls-port").value.replace(/\D/g, "")) })
      .then(connected, function (e) { text("tls-status", ""); fail(e); });
  });

  // ---- Android TV and Fire TV: the Allow prompt ----

  $("connect-go").addEventListener("click", function () { state.tried = 0; allow(); });
  $("classic-back").addEventListener("click", function () {
    if (state.kind === "google") { state.devStep = "dev-google"; return show("dev-google"); }
    show("kind");
  });
  $("allow-retry").addEventListener("click", allow);
  $("allow-back").addEventListener("click", function () { clearInterval(countdown); show(state.devStep); if (state.devStep === "find") lookAgain(); });
  document.querySelectorAll(".fix-try").forEach(function (b) { b.addEventListener("click", allow); });
  document.querySelectorAll(".fix-back").forEach(function (b) {
    b.addEventListener("click", function () { show(state.devStep); });
  });
  $("fix-again").addEventListener("click", function () { state.tried = 0; allow(); });
  $("blocked-again").addEventListener("click", scan);

  // The fix screens and the phone route name Fire TV's menus on a Fire TV, the Android menus otherwise.
  function tvKindWords() {
    var fire = state.kind === "fire";
    document.querySelectorAll("[data-tvkind]").forEach(function (el) { el.hidden = (el.dataset.tvkind === "fire") !== fire; });
  }

  // One try: a short, honest wait with the seconds counting down. If the TV does not let this computer
  // in, the server names the next fix to show; after the last one comes the phone route, never a dead end.
  var countdown = null;
  function allow() {
    var wait = state.tried ? 30 : 45;
    show("allow");
    $("allow-retry").hidden = true;
    var left = wait;
    var say = function () {
      text("allow-status", "Tick Always allow from this computer, then press Allow on the TV. Waiting " + left + " more seconds…");
    };
    say();
    clearInterval(countdown);
    countdown = setInterval(function () { if (left > 1) { left -= 1; say(); } }, 1000);
    job("/api/connect", { ip: state.ip, kind: state.kind, tried: state.tried, wait: wait }).then(function (r) {
      clearInterval(countdown);
      connected(r);
    }, function (e) {
      clearInterval(countdown);
      if (e.fix) {
        state.tried += 1;
        tvKindWords();
        return show(e.fix);
      }
      if (e.code === "local_network_blocked") return fail(e);
      text("allow-status", "");
      $("allow-retry").hidden = false;
      fail(e);
    });
  }

  // ---- connected: the plan, or the undo plan ----

  function connected(r) {
    state.facts = r.facts; state.route = r.route;
    var f = r.facts;
    if (!f.supported) {
      text("stop-title", "This TV is too old");
      text("stop-text", "This app needs Android 7.1 or newer, and this TV has Android " + f.android + ". A Google TV box plugged into the TV can run couch-tv.");
      text("stop-more", "On Android 6 (for example the Xiaomi Mi TV 4A), couch-tv is set up from a computer with the guide on GitHub. Nothing was changed on the TV.");
      return show("stop");
    }
    if (state.mode === "undo") return undoPlan();
    state.ontvTakes = !!(f.ontv_home && f.ontv_home.takes_home);
    $("ontv-row").hidden = !state.ontvTakes;
    text("device-line", "Connected to your " + f.name + " (" + (f.fire ? "Fire OS " + (f.fire_os || "") : "Android " + f.android) + ").");
    $("tcl-note").hidden = !f.tcl;
    var t = rows[state.ip];
    if (t && !$("tv-room").value && t.known && t.known.room) $("tv-room").value = t.known.room;
    if (state.account) {
      $("plan-account").textContent = signedInWords(state.account.name || state.account.email) + ". Couch TV gets your home details" +
        (state.account.design ? " and \"" + state.account.design + "\"" : "") + " as it goes on.";
    }
    $("plan-account").hidden = !state.account;
    refreshPlan();
    show("plan");
  }

  function refreshPlan() {
    api("/api/plan", { ambient_off: $("ambient").checked, ontv_home_off: $("ontv-off").checked }).then(function (p) {
      var ul = $("plan-list"); ul.textContent = "";
      p.items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    }, fail);
  }
  $("ambient").addEventListener("change", refreshPlan);
  $("ontv-off").addEventListener("change", refreshPlan);

  // What to say after a check: couch-tv in front or not, the Home button watch running or not, and
  // any other launcher whose own Home override would fight it.
  function homeWords(r) {
    var w = [];
    if (r.watch_bound === false) {
      w.push(state.facts && state.facts.fire ?
        "The Home button watch is switched on, but Fire TV has not started it yet. Fire TV sometimes needs one restart for that: " +
        "Settings, My Fire TV, Restart. When the TV is back on its home, press Check it again." :
        "The Home button watch is switched on, but the TV has not started it yet. Restart the TV once. If Home still opens " +
        "the TV's own home after that, open this app again and set it up again.");
    } else if (!r.ok && r.other_front === "ontv") {
      w.push("couch-tv's other app (the on-TV app) was in front, not the TV's own home. It still has Home switched on: " +
        "open it and press Stop being the home screen, or run Setup again and let it switch that off.");
    } else if (!r.ok) {
      w.push("The TV's own home was in front when this looked. Press Home on the remote once more.");
    }
    if (r.warning) w.push(r.warning);
    return w.join(" ");
  }

  $("place-go").addEventListener("click", function () {
    var box = $("places"); box.textContent = "Looking…";
    api("/api/place", { q: $("place-q").value }).then(function (r) {
      box.textContent = "";
      if (!r.places.length) box.textContent = "No place by that name. Try the nearest town.";
      r.places.forEach(function (p) {
        var b = document.createElement("button");
        b.textContent = p.place + (p.area ? ", " + p.area : "");
        b.addEventListener("click", function () {
          state.weather = p;
          box.textContent = "Weather for " + p.place + (p.area ? ", " + p.area : "") + ".";
        });
        box.appendChild(b);
      });
    }, function (e) { box.textContent = ""; fail(e); });
  });

  function working(title) {
    text("work-title", title);
    $("work-bar").style.width = "0%";
    text("work-status", "Starting…");
    show("work");
    return function (f, m) {
      $("work-bar").style.width = Math.round(f * 100) + "%";
      if (m) text("work-status", m + "…");
    };
  }

  $("setup-go").addEventListener("click", function () {
    var people = $("people").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var room = $("tv-room").value.trim();
    var named = room ? api("/api/name-tv", { ip: state.ip, room: room }).catch(function () {}) : Promise.resolve();
    named.then(function () {
      return job("/api/setup", { ambient_off: $("ambient").checked, ontv_home_off: $("ontv-off").checked, people: people, weather: state.weather }, working("Setting it up"));
    })
      .then(function (r) {
        var ul = $("done-account"); ul.textContent = "";
        if (r.account) {
          var lines = ["Couch TV installed and checked"];
          if (r.account.linked) lines.push("Linked to your Couch TV account");
          else if (r.account.sent) lines.push(SENT);
          else if (r.account.error) lines.push("Not linked yet. " + r.account.error);
          if (r.account.people) lines.push("Added " + r.account.people + (r.account.people === 1 ? " person" : " people") + " from your home details");
          if (r.account.town) lines.push("Weather for " + r.account.town);
          if (r.account.design) lines.push("Sent \"" + r.account.design + "\" to the TV");
          lines.forEach(function (l) { var li = document.createElement("li"); li.textContent = l; ul.appendChild(li); });
        }
        if (r.account_error) { var ae = document.createElement("li"); ae.textContent = "Not linked yet. " + r.account_error; ul.appendChild(ae); checkAccount(); }
        ul.hidden = !r.account && !r.account_error;
        $("health-box").hidden = false;
        if (r.speed && r.speed.cls) {
          var sp = document.createElement("li");
          sp.textContent = "Measured how smoothly it draws: " + ({ a: "Slow", b: "Everyday", c: "Quick", d: "Fast" })[r.speed.cls] + " (Couch TV Studio uses this)";
          ul.appendChild(sp); ul.hidden = false;
        }
        if (r.kept_ontv) {
          text("done-title", "Left as it was");
          text("done-line", "couch-tv's other app (the on-TV app) is still your home screen, and nothing was installed.");
        } else {
          text("done-title", r.front ? "Couch TV is your home screen" : "Couch TV is on the TV");
          text("done-line", (r.front ? "It is on the screen now. " : "It is installed. ") +
            "Version " + r.apk.version + ", checked against " + r.apk.checked + ". " +
            homeWords({ ok: r.front, watch_bound: r.watch_bound, warning: r.warning, other_front: r.other_front }));
        }
        $("remote-done").hidden = true;
        $("remote-adb-google").hidden = state.facts.fire;
        $("remote-adb-fire").hidden = !state.facts.fire;
        if ($("debug-why")) text("debug-why", state.route === "tls" ?
          "this switches Wireless debugging off. Skip it if you add the phone remote: that needs it on." :
          "this switches debugging off. Skip it if you add the phone remote and want it to press keys.");
        linkCard(!!(r.account && r.account.linked));
        show("done");
      }, function (e) { show("plan"); fail(e); });
  });

  $("check-go").addEventListener("click", function () {
    job("/api/check").then(function (r) {
      text("done-line", (r.ok && r.watch_bound !== false ? "couch-tv came up when Home was pressed. " : "") + homeWords(r));
    }, fail);
  });

  $("remote-go").addEventListener("click", function () {
    var back = function () { show("done"); };
    job("/api/remote", {}, working("Adding the phone remote")).then(function (r) {
      state.remote = true;
      text("remote-addr", r.address);
      text("remote-setup", r.setup);
      $("remote-done").hidden = false;
      back();
    }, function (e) { back(); fail(e); });
  });

  $("remote-code").addEventListener("click", function () {
    api("/api/remote/code").then(function () { text("done-line", "The code is on the TV now. It lasts 3 minutes."); }, fail);
  });

  $("debug-off").addEventListener("click", function () {
    api("/api/debug-off").then(function () {
      text("debug-line", "Debugging is off. couch-tv keeps working.");
      $("debug-off").hidden = true;
    }, fail);
  });

  // ---- health report: shown in full, sent only after Send ----

  $("health-look").addEventListener("click", function () {
    api("/api/health/preview").then(function (r) {
      text("health-text", JSON.stringify(r.report, null, 2));
      $("health-send").hidden = !r.can_send;
      text("health-status", r.can_send ? "" : "Link your Couch TV account to send it.");
      $("health-show").hidden = false;
    }, fail);
  });
  $("health-send").addEventListener("click", function () {
    api("/api/health/send", { yes: true }).then(function (r) {
      text("health-status", "Sent. Thank you." + (r.ref ? " Reference " + r.ref + "." : ""));
      $("health-send").hidden = true;
    }, fail);
  });

  // ---- the Couch TV account (only when this Setup links accounts) ----

  // The account's display name, or null when it has none (Couch TV Studio never sends the email)
  function signedInWords(name) {
    return name ? "Signed in as " + name : "Signed in to your Couch TV account";
  }

  var SENT = "Sent to the TV. It shows as linked once the TV checks in.";
  var ASK_LINE = "Have a Couch TV account? Link it, and your design and home details go on the TV too.";
  function signedIn(acct) {
    state.account = acct;
    text("acct-top", signedInWords(acct.name || acct.email));
    $("acct-top").hidden = false;
    $("acct-out").hidden = false;
    text("acct-line", signedInWords(acct.name || acct.email) + ". Your design and home details go on the TV too.");
    $("acct-ask").hidden = true;
  }
  function signedOut() {
    state.account = null;
    $("acct-top").hidden = true; $("acct-out").hidden = true;
    text("acct-line", ASK_LINE);
    $("acct-ask").hidden = false;
    $("plan-account").hidden = true;
    if (!$("link-now").hidden) linkCard(false);
  }
  $("acct-out").addEventListener("click", function () { api("/api/sign-out").then(signedOut, fail); });
  // the server knows: signed out when the sign in ran out
  function checkAccount() {
    return api("/api/account").then(function (a) { if (a.account) signedIn(a.account); else if (state.account) signedOut(); }, function () {});
  }

  // "Link as X?": the code is not used, and nothing about the TV is sent, until Yes. The server keeps to that too.
  var askId = null, askThen = null;
  function ask(q, then) {
    if (!q || q.id === askId) return;
    askId = q.id; askThen = then || null;
    var x = q.account.name ? q.account.name + " (" + q.account.email + ")" : q.account.email;
    text("link-ask-who", "Link as " + x + "?");
    var was = q.instead_of && (q.instead_of.name || q.instead_of.email);
    text("link-ask-mail", was ? "Setup is signed in as " + was + " now. Yes switches accounts." : "Only press Yes if this is your account.");
    $("link-ask").hidden = false;
    $("link-ask-who").focus();
  }
  function askDone() { $("link-ask").hidden = true; askId = null; }
  $("link-ask-yes").addEventListener("click", function () {
    var id = askId, then = askThen;
    if (!id) return;
    $("link-ask-yes").disabled = true;
    api("/api/link-yes", { id: id }).then(function (r) {
      askDone(); signedIn(r.account);
      if (!$("link-now").hidden) linkCard(false);
      if (then) then();
    }, function (e) { askDone(); fail(e); }).then(function () { $("link-ask-yes").disabled = false; });
  });
  $("link-ask-no").addEventListener("click", function () {
    askDone();
    text("link-now-status", "Not linked. Sign in on the website as you, then use a new code.");
    if (!state.account) text("acct-line", "Not linked. Sign in on the website as you, then use a new code.");
    api("/api/link-no").catch(function () {});
  });

  api("/api/account").then(function (a) {
    state.studio = a.studio || null;
    if (a.mode === "off") { state.studio = null; return; }
    $("acct-box").hidden = false;
    if (a.account) signedIn(a.account);
    // opened from the website's Set up my TV button: whose account it is, and Yes or Not me
    if (a.ask) ask(a.ask);
    else if (a.handoff) api("/api/handoff", {}).then(function (r) { ask(r.ask); }, fail);
  }, function () {});

  // a link opened while this page was already up arrives here
  setInterval(function () {
    if ($("acct-box").hidden) return;
    api("/api/account").then(function (a) {
      if (a.account) { if (!state.account) signedIn(a.account); } else if (state.account) signedOut();
      if (a.ask) ask(a.ask);
      else if (a.handoff) api("/api/handoff", {}).then(function (r) { ask(r.ask); }, fail);
      else if (askId) askDone();
    }, function () {});
  }, 5000);

  $("acct-go").addEventListener("click", function () {
    api("/api/handoff", { code: $("acct-code").value }).then(function (r) { ask(r.ask); }, fail);
  });

  var devicePoll = null;
  $("acct-device").addEventListener("click", function () {
    api("/api/device/start").then(function (d) {
      var p = $("acct-device-code"); p.textContent = "";
      p.appendChild(document.createTextNode("On the Couch TV website, press Allow for the code "));
      var b = document.createElement("b"); b.textContent = d.user_code; p.appendChild(b);
      p.appendChild(document.createTextNode(". "));
      var a = document.createElement("a"); a.href = d.verify; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Open the website"; p.appendChild(a);
      p.hidden = false;
      window.open(d.verify, "_blank", "noopener");
      clearInterval(devicePoll);
      devicePoll = setInterval(function () {
        api("/api/device/poll").then(function (r) {
          if (r.ask) { clearInterval(devicePoll); $("acct-device-code").hidden = true; ask(r.ask); }
        }, function (e) { clearInterval(devicePoll); fail(e); });
      }, d.interval * 1000);
    }, fail);
  });

  // ---- link this TV (the last screen): Couch TV is already on the TV, so one step, no reinstall ----
  // Shown while the TV is not linked to the account. Signed in already (the website's button, or a code typed
  // earlier): one button. Not signed in: the code from the website, or the website's own Allow.
  var linkTimer = null;
  function linkCard(linked) {
    state.linked = linked;
    var offered = !linked && !!$("link-now") && state.studio !== null;
    $("link-now").hidden = !offered;
    $("link-done").hidden = !(linked && state.studio);
    if (linked && state.studio) $("open-editor").href = state.studio + "/design/";
    $("link-now-signed").hidden = !state.account;
    $("link-now-ask").hidden = !!state.account;
    $("link-fix").hidden = true;
    text("link-now-line", state.account ? signedInWords(state.account.name || state.account.email) + ". Linking sends this TV's model, speed and installed app names." :
      "Then you can send designs to it from the website.");
  }
  // every way linking can fail has a way on: sign in again, find the TV again, update Couch TV, or the same button
  function linkFailed(e) {
    text("link-now-status", e.message || "That did not work. Try again.");
    if (e.code === "signed_out" || e.code === "no_account") { signedOut(); linkCard(false); text("link-now-status", e.message); }
    var lost = { no_tv: 1, lost: 1, not_allowed: 1, not_paired: 1, closed: 1 }[e.code], old = e.code === "old_app" || e.code === "not_installed";
    $("link-fix").hidden = !(lost || old);
    text("link-fix-go", old ? "Update Couch TV" : "Find the TV");
    state.linkFix = old ? "plan" : "scan";
    if (lost) text("link-now-status", "This computer lost the TV. Switch debugging on there, then find it.");
  }
  $("link-fix-go").addEventListener("click", function () {
    if (state.linkFix === "plan") { refreshPlan(); show("plan"); return; }
    state.mode = "setup"; $("debug-off").hidden = false; text("debug-line", "Switching debugging off again is safest."); scan();
  });
  function linkRun() {
    text("link-now-status", "Linking…");
    job("/api/link-tv", {}, function (f, m) { if (m) text("link-now-status", m + "…"); }).then(function (r) {
      text("link-now-status", r.account && r.account.sent ? SENT : "");
      linkCard(!!(r.account && r.account.linked));
      if (r.account && (r.account.linked || r.account.sent)) {
        var ul = $("done-account"); ul.textContent = "";
        [r.account.linked ? "Linked to your Couch TV account" : SENT].concat(r.account.design ? ["Sent \"" + r.account.design + "\" to the TV"] : []).forEach(function (l) {
          var li = document.createElement("li"); li.textContent = l; ul.appendChild(li);
        });
        ul.hidden = false;
      }
    }, linkFailed);
  }
  $("link-signed-go").addEventListener("click", linkRun);
  $("link-go").addEventListener("click", function () {
    text("link-now-status", "Signing in…");
    api("/api/handoff", { code: $("link-code").value }).then(function (r) { text("link-now-status", ""); ask(r.ask, linkRun); },
      function (e) { text("link-now-status", e.message || "That code did not work."); });
  });
  $("link-device").addEventListener("click", function () {
    api("/api/device/start").then(function (d) {
      var p = $("link-device-code"); p.textContent = "";
      p.appendChild(document.createTextNode("On the Couch TV website, press Allow for the code "));
      var b = document.createElement("b"); b.textContent = d.user_code; p.appendChild(b);
      p.appendChild(document.createTextNode(". "));
      var a = document.createElement("a"); a.href = d.verify; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open the website"; p.appendChild(a);
      p.hidden = false;
      window.open(d.verify, "_blank", "noopener");
      clearInterval(linkTimer);
      linkTimer = setInterval(function () {
        api("/api/device/poll").then(function (r) {
          if (r.ask) { clearInterval(linkTimer); $("link-device-code").hidden = true; ask(r.ask, linkRun); }
        }, function (e) { clearInterval(linkTimer); text("link-now-status", e.message || "That did not work. Try again."); });
      }, d.interval * 1000);
    }, function (e) { text("link-now-status", e.message || "That did not work. Try again."); });
  });

  // ---- undo ----

  $("undo-start").addEventListener("click", function () { state.mode = "undo"; scan(); });
  $("setup-start").addEventListener("click", function () { state.mode = "setup"; scan(); });

  function undoPlan() {
    api("/api/undo/plan").then(function (p) {
      var ul = $("undo-list"); ul.textContent = "";
      var items = [];
      if (p.switch_back_on.length) items.push("Switch back on what couch-tv switched off (" + p.switch_back_on.length + ").");
      items.push("Switch off couch-tv's Home button watch and make " + (p.home_name || "the TV's own home") + " the home again.");
      if (p.home_installed) items.push("Remove the couch-tv home app.");
      if (p.ontv_installed) items.push("Remove the couch-tv phone remote app.");
      if (!p.home_installed && !p.ontv_installed) items.push("couch-tv is not on this TV, so there is nothing to remove.");
      items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      text("undo-details", p.home && p.home.indexOf("/") > 0 ? "Details: the home it goes back to is " + p.home + "." : "");
      show("undo");
    }, fail);
  }

  $("undo-go").addEventListener("click", function () {
    var off = $("undo-debug").checked;
    job("/api/undo", {}, working("Taking couch-tv off")).then(function () {
      var next = off ? api("/api/debug-off") : Promise.resolve();
      return next.then(function () { show("undone"); });
    }, function (e) { show("undo"); fail(e); });
  });

  // ---- extra features (Couch TV Helper) ----
  function helperOn(autostart, extra) {
    return api("/api/helper/on", { autostart: !!autostart }).then(function () {
      text("helper-on-line", OS === "mac" ? "Look for it in your menu bar." : "Look for it in your tray.");
      show("helper-on");
    }, fail);
  }
  $("finish-go").addEventListener("click", function () { show("extras"); });
  $("extras-done").addEventListener("click", function () { closeSetup(); });
  $("extras-on").addEventListener("click", function () { helperOn($("extras-autostart").checked); });
  $("helper-on-done").addEventListener("click", function () { closeSetup(); });
  $("helper-tv-go").addEventListener("click", function () {
    var t = state.helperTv;
    api("/api/helper/add-tv", t).then(function () { return helperOn($("helper-tv-autostart").checked); }, fail);
  });
  $("helper-later-go").addEventListener("click", function () { show("extras"); });

  function closeSetup() {
    api("/api/quit").then(function () { show("closed"); }, fail);
  }
  $("close-go2").addEventListener("click", closeSetup);
  $("close-go3").addEventListener("click", closeSetup);
  $("close-top").addEventListener("click", closeSetup);

  show("welcome");
  // Turn on later: Setup reopened while extra features are off, or opened by couchtv://helper/on
  api("/api/info").then(function (i) {
    var h = i.helper || {};
    $("helper-later").hidden = h.mode === "helper";
    if (h.intent === "helper" && h.mode !== "helper") show("extras");
  }, function () {});
})();
