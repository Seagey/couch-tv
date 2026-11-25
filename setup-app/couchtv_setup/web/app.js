// Couch TV Setup page. Everything that comes from the network or the TV is put on the page with
// textContent, never as HTML.
(function () {
  "use strict";
  var KEY = document.querySelector('meta[name="setup-key"]').content;
  var OS = document.querySelector('meta[name="setup-os"]').content;
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";
  var state = { mode: "setup", ip: null, kind: null, facts: null, route: null, weather: null, remote: false,
                look: null, tried: 0, devStep: "dev-classic",
                accountMode: "off", studio: null, features: [], session: [], linked: null, design: null, tvName: "" };

  // Hooks that other pieces plug into. A hook is shown only when the server lists its feature in /api/info
  // ("features"), so a Setup without it simply hides it.
  //   link-tv: the finish screen's "Link it to your account" (HOOKS.linkNow runs it)
  //   tidy:    the finish screen's "Tidy up your TV" (fires the "setup:tidy" event on window)
  var HOOKS = {
    linkNow: function (onProgress) {
      return job("/api/link-tv", {}, onProgress).then(function (r) { return (r && r.account) || {}; });
    }
  };
  function hasFeature(name) { return state.features.indexOf(name) >= 0; }

  // An error from this app's own server: plain words, a code, and the technical part as detail.
  function problem(j) {
    var e = new Error(j.error || "That step did not work. Try it again.");
    e.code = j.code; e.detail = j.detail; e.fix = j.fix;
    return e;
  }

  // The page could not reach Couch TV Setup on this computer at all (the app was closed).
  var LOST = "This page lost touch with Couch TV Setup on this computer. Open the app again, then start over.";

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
            if (onProgress) onProgress(j.progress || 0, j.message || "", j);
            if (j.running) return setTimeout(tick, 700);
            if (j.error) return reject(problem(j));
            resolve(j.result);
          }, reject);
        })();
      });
    });
  }

  // ---- screens, the top bar and Back ----

  // The screens in the order the person walked them. Back goes to the one before, skipping screens that
  // only make sense while something is running (the Allow wait, the progress screen, the blocked screen).
  var nav = [], current = null, flow = 0;
  var TRANSIENT = { allow: 1, work: 1, blocked: 1, closed: 1 };
  var STAGE = { done: 2, extras: 2, "helper-on": 2 };   // tidy counts as part of Set up your TV
  var NO_STEPS = { closed: 1, undo: 1, undone: 1 };
  var workKind = "setup";

  function show(step, opts) {
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s.dataset.step !== step; });
    $("error").hidden = true;
    current = step;
    if (!(opts && opts.back)) {
      // coming back to a screen already walked cuts the way back to it (a screen that is only shown while something
      // runs is never cut to: it is skipped by Back anyway)
      var at = TRANSIENT[step] ? -1 : nav.lastIndexOf(step);
      if (at >= 0) nav.length = at + 1; else nav.push(step);
    }
    chrome(step);
    window.scrollTo(0, 0);
    var h = document.querySelector('section[data-step="' + step + '"] h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }

  function chrome(step) {
    var locked = step === "work";
    var back = $("back");
    back.disabled = locked || step === "welcome" || step === "closed";
    back.classList.toggle("locked", locked);
    $("back-note").hidden = !locked;
    if (locked) text("back-note", workKind === "setup" ? "Back is off while Couch TV installs." : "Back is off while this runs.");
    var bar = $("steps");
    bar.hidden = state.accountMode === "off" || state.mode === "undo" || !!NO_STEPS[step];
    var stage = STAGE[step] || 1;
    for (var i = 0; i < 3; i++) {
      var s = $("st-" + i), n = s.querySelector(".n");
      var done = i < stage && (i > 0 || !!state.account);
      s.className = "s" + (done ? " done" : "") + (i === stage ? " on1" : "");
      n.textContent = "";
      if (done) n.appendChild(icon("check")); else n.textContent = String(i + 1);
    }
  }

  function goBack() {
    if ($("back").disabled) return;
    var cur = nav.pop();
    while (nav.length && TRANSIENT[nav[nav.length - 1]]) nav.pop();
    var prev = nav[nav.length - 1];
    if (!prev) { nav.push(cur); return; }
    flow += 1;                      // an answer still on its way for the screen we leave is ignored
    clearInterval(countdown);
    if (cur === "find") { clearTimeout(poll); poll = null; }
    show(prev, { back: true });
    if (prev === "find") lookAgain();
  }
  $("back").addEventListener("click", goBack);
  $("plan-back").addEventListener("click", goBack);

  function icon(id, cls) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    var u = document.createElementNS(NS, "use");
    u.setAttribute("href", "#" + id);
    s.appendChild(u);
    return s;
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
    b.addEventListener("click", function () { if (b.dataset.go === "find") return scan(); show(b.dataset.go); });
  });
  setInterval(function () { api("/api/ping").catch(function () {}); }, 20000);

  // Enter in a box does what its button does
  function enter(id, btn) {
    $(id).addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); $(btn).click(); } });
  }

  // ---- find ----

  // The list finds TVs by itself and keeps looking while it is on screen, so a TV turns Ready on its own
  // once its switch is on (the person never comes back to press Next).
  var poll = null, openRow = null, rows = {}, detailsOpen = {};
  var PILL = { ready: ["Ready", "ok"], code: ["Type the code", "warn"], pair: ["One step on the TV", "warn"],
               "switch": ["One step on the TV", "warn"], other: ["Found. Can't install from here yet", "dim"] };

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

  // The next look: after ms, while the list is still on screen. An error or a busy answer never ends the
  // looking for good (only the app being closed, or the blocked screen, does).
  function lookSoon(ms) {
    clearTimeout(poll);
    poll = setTimeout(function () { if (onFind()) lookAgain(); }, ms);
  }

  function lookAgain() {
    clearTimeout(poll);
    var early = false;
    job("/api/scan", null, function (pr, msg, j) {
      // the TVs' own announcements arrive before the knocking is done: show them once, at once
      if (early || !j || !j.partial || !(j.partial.tvs || []).length) return;
      if (!onFind() || state.mode !== "setup" && state.mode !== "undo") return;
      early = true;
      drawRows(j.partial.tvs);
    }).then(function (r) {
      if (!onFind() || state.mode !== "setup" && state.mode !== "undo") return;
      $("error").hidden = true;
      drawRows(r.tvs || []);
      lookSoon(6000);
    }, function (e) {
      if (!onFind()) return;
      if (e && e.code === "busy") return lookSoon(1500);   // another step is finishing: look again soon, say nothing
      fail(e);
      $("find-help").hidden = false;
      if (e && e.code === "lost_app") return;              // the app was closed: nothing to look again with
      lookSoon(10000);
    });
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

  function pillEl(label, cls) {
    var pill = document.createElement("span");
    pill.className = "pill " + cls;
    if (cls === "ok") { var tk = document.createElement("span"); tk.className = "tick-icon sm"; tk.appendChild(icon("check")); pill.appendChild(tk); }
    else if (cls === "warn") { var d = document.createElement("span"); d.className = "dot"; pill.appendChild(d); }
    pill.appendChild(document.createTextNode(label));
    return pill;
  }

  function drawRows(tvs) {
    var box = $("found");
    var before = rows; rows = {};
    box.textContent = "";
    var usable = tvs.filter(function (t) { return t.android || t.status === "other"; });
    text("find-status", usable.length === 0 ? "No TV found yet." : usable.length === 1 ? "This one is on your Wi-Fi right now." : "These are on your Wi-Fi right now.");
    $("find-help").hidden = usable.length > 0;
    $("find-watch").hidden = !usable.length;
    usable.forEach(function (t) {
      rows[t.ip] = t;
      var card = document.createElement("div");
      card.className = "card tvc" + (openRow === t.ip ? " open" : "");
      // the TV, drawn small, with its own name on the screen
      var mini = document.createElement("div"); mini.className = "tvmini";
      var tv = document.createElement("div"); tv.className = "tv stand";
      var scr = document.createElement("div"); scr.className = "scr";
      var nm = document.createElement("span"); nm.textContent = t.label;
      scr.appendChild(nm); tv.appendChild(scr); mini.appendChild(tv); card.appendChild(mini);
      var h = document.createElement("h3"); h.textContent = t.label; card.appendChild(h);
      var kind = helperKind(t);
      var p = t.stale ? ["Looking for it again", "warn"] : t.status === "other" && kind ? ["Needs the Helper", "dim"] : (PILL[t.status] || PILL["switch"]);
      var state_ = document.createElement("div"); state_.className = "state"; state_.appendChild(pillEl(p[0], p[1])); card.appendChild(state_);
      // every card has the same rows (picture, name, state, note, button, details) so buttons line up across a row
      var note = document.createElement("p"); note.className = "small note";
      card.appendChild(note);
      if (t.status === "other") {
        note.textContent = kind ? "" : "Couch TV goes on this TV another way. See the guide on GitHub.";
        if (kind) {
          var hb = document.createElement("button"); hb.type = "button"; hb.className = "btn ghost";
          hb.textContent = "Set up the helper";
          hb.addEventListener("click", function () { state.helperTv = { ip: t.ip, kind: kind, name: t.label }; text("helper-tv-title", "Your " + HELPER_NAMES[kind] + " TV needs the helper."); show("helper-tv"); });
          card.appendChild(hb);
        } else {
          var ga = document.createElement("a"); ga.className = "btn ghost"; ga.target = "_blank"; ga.rel = "noopener";
          ga.href = "https://github.com/Seagey/couch-tv#will-it-work-on-my-tv"; ga.textContent = "Open the guide";
          card.appendChild(ga);
        }
      } else {
        var go = document.createElement("button"); go.type = "button";
        var undo = state.mode === "undo";
        // a TV a scan missed, or one whose debugging did not answer the check, is never offered as ready
        var sure = !t.stale && !t.adb_unconfirmed;
        var runs = sure && (t.status === "ready" || t.status === "code");
        go.className = "btn " + (runs ? "go" : "ghost");
        go.textContent = t.stale ? "Looking for it again…" : undo ? (runs && t.status === "ready" ? "Choose this TV" : runs ? "Type the code" : "Show me how") :
          runs && t.status === "ready" ? "Set up this TV" : runs ? "Type the code" : "Show me how";
        if (t.stale) go.disabled = true;
        go.addEventListener("click", function () { rowAction(t.ip); });
        card.appendChild(go);
      }
      // Details: what the TV said it is, and where it is
      var det = document.createElement("button"); det.type = "button"; det.className = "det";
      det.setAttribute("aria-expanded", detailsOpen[t.ip] ? "true" : "false");
      det.appendChild(icon("chev")); det.firstChild.setAttribute("viewBox", "0 0 12 12");
      det.appendChild(document.createTextNode("Details"));
      var more = document.createElement("div"); more.className = "detail"; more.hidden = !detailsOpen[t.ip];
      if (t.model) { more.appendChild(document.createTextNode("Reported as ")); var mb = document.createElement("b"); mb.textContent = t.model; more.appendChild(mb); more.appendChild(document.createElement("br")); }
      more.appendChild(document.createTextNode("Address " + t.ip));
      det.addEventListener("click", function () {
        detailsOpen[t.ip] = !detailsOpen[t.ip];
        det.setAttribute("aria-expanded", detailsOpen[t.ip] ? "true" : "false");
        more.hidden = !detailsOpen[t.ip];
      });
      var wrap = document.createElement("div"); wrap.className = "detwrap";
      wrap.appendChild(det); wrap.appendChild(more);
      card.appendChild(wrap);
      box.appendChild(card);
    });
    // the TV whose steps are open just became ready, or its pairing screen just opened
    if (openRow && rows[openRow] && before[openRow] && rows[openRow].status !== before[openRow].status) openGuide(rows[openRow]);
  }

  function rowAction(ip) {
    var t = rows[ip];
    if (!t || t.stale) return;
    if ((t.status === "ready" || t.status === "code") && !t.adb_unconfirmed) return setUpRow(t);
    openGuide(t);
  }

  function setUpRow(t) {
    state.ip = t.ip; state.look = t; state.tried = 0;
    state.kind = (t.known && t.known.kind) || state.kind || "google";
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
      var ok = guard();
      job("/api/connect-tls", { ip: t.ip, port: t.wireless_debugging }).then(function (r) { if (ok()) connected(r); }, function (e) {
        if (!ok()) return;
        fail(e); show("find"); lookAgain();
      });
    });
  }

  // An answer that arrives after the person pressed Back or started something else is ignored.
  function guard() { var s = ++flow; return function () { return s === flow; }; }

  // The few steps on the TV for this TV's Android version, as little TV screens.
  function openGuide(t, extra) {
    openRow = t.ip;
    document.querySelectorAll(".tvc").forEach(function (r) { r.classList.remove("open"); });
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
      var first = !$("guide").hidden;
      $("guide").hidden = false;
      if (!first) $("guide").scrollIntoView({ block: "nearest" });
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
    state.ip = t.ip; state.look = t; state.tried = 0;
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
        text("stop-text", "Couch TV can go on a " + names[r.kind] + ", but not from this app: it needs a computer at home " +
          "that stays on and opens Couch TV each time the TV is switched on, and the Home button still opens " +
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
  enter("ip", "ip-go");
  $("rescan").addEventListener("click", scan);
  $("nohere-go").addEventListener("click", function () { stopLooking(function () { show("nohere"); }); });
  $("nohere-look").addEventListener("click", scan);

  document.querySelectorAll("[data-kind]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.kind = b.dataset.kind;
      state.tried = 0;
      var look = state.look || {};
      // Already answering on the network debugging port: no steps needed, straight to the Allow question.
      if (state.kind !== "fire" && look.adb_5555) {
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
    show("dev-classic");
  }

  // What this TV showed before anything was switched on decides which way in it needs.
  var ROUTE_WORDS = {
    pair: "This TV has Wireless debugging, so you will type a 6 number code from the TV. First, Developer options.",
    usb: "This TV runs Android 11, so it has no Wireless debugging: you will switch on USB debugging, and the TV asks to allow this computer. No cable is needed. First, Developer options.",
    unknown: "Google TVs on Android 12 or newer have Wireless debugging. Google TVs on Android 11 only have USB debugging, and that works too, with no cable. Switch on Developer options, then pick what your TV shows."
  };

  function startGoogle() {
    var route = (state.look && state.look.route) || "unknown";
    text("route-line", ROUTE_WORDS[route] || ROUTE_WORDS.unknown);
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
    var ok = guard();
    job("/api/pair", { ip: state.ip, code: code, port: Number(port) }, function (f, m) { if (m && ok()) text("pair-status", m + "…"); })
      .then(function (r) {
        if (!ok()) return;
        clearInterval(portTimer);
        if (r.need_port) return show("tls-port");
        connected(r);
      }, function (e) { if (!ok()) return; text("pair-status", ""); fail(e); });
  });
  enter("code", "pair-go"); enter("pair-port", "pair-go");

  $("tls-go").addEventListener("click", function () {
    text("tls-status", "Connecting…");
    var ok = guard();
    job("/api/connect-tls", { ip: state.ip, port: Number($("tls-port").value.replace(/\D/g, "")) })
      .then(function (r) { if (ok()) connected(r); }, function (e) { if (!ok()) return; text("tls-status", ""); fail(e); });
  });
  enter("tls-port", "tls-go");

  // ---- Android TV and Fire TV: the Allow prompt ----

  $("connect-go").addEventListener("click", function () { state.tried = 0; allow(); });
  $("allow-retry").addEventListener("click", allow);
  document.querySelectorAll(".fix-try").forEach(function (b) { b.addEventListener("click", allow); });
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
    var ok = guard();
    show("allow");
    $("allow-retry").hidden = true;
    var left = wait;
    var say = function () {
      text("allow-status", "Tick Always allow from this computer, then press Allow on the TV. Waiting " + left + " more seconds…");
    };
    say();
    clearInterval(countdown);
    countdown = setInterval(function () { if (left > 1) { left -= 1; say(); } }, 1000);
    // an earlier try that was left with Back may still be running: wait for it first
    stopLooking(function () {
      if (!ok()) return;
      job("/api/connect", { ip: state.ip, kind: state.kind, tried: state.tried, wait: wait }).then(function (r) {
        if (!ok()) return;
        clearInterval(countdown);
        connected(r);
      }, function (e) {
        if (!ok()) return;
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
    });
  }

  // ---- connected: the plan, or the undo plan ----

  function tvName() { return $("tv-room").value.trim() || state.tvName || "this TV"; }
  function syncName() { text("plan-name", tvName()); }
  $("tv-room").addEventListener("input", syncName);
  enter("tv-room", "setup-go");

  function connected(r) {
    state.facts = r.facts; state.route = r.route;
    var f = r.facts;
    if (!f.supported) {
      text("stop-title", "This TV is too old");
      text("stop-text", "This app needs Android 7.1 or newer, and this TV has Android " + f.android + ". A Google TV box plugged into the TV can run Couch TV.");
      text("stop-more", "On Android 6 (for example the Xiaomi Mi TV 4A), Couch TV is set up from a computer with the guide on GitHub. Nothing was changed on the TV.");
      return show("stop");
    }
    if (state.mode === "undo") return undoPlan();
    state.ontvTakes = !!(f.ontv_home && f.ontv_home.takes_home);
    $("ontv-row").hidden = !state.ontvTakes;
    text("device-line", "Connected to your " + f.name + " (" + (f.fire ? "Fire OS " + (f.fire_os || "") : "Android " + f.android) + "). We will put Couch TV on it and make it the home screen.");
    $("tcl-note").hidden = !f.tcl;
    var t = rows[state.ip];
    state.tvName = (t && t.known && t.known.room) || (t && t.label) || f.name || "";
    $("tv-room").value = state.tvName;
    syncName();
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

  // What to say after a check: Couch TV in front or not, the Home button watch running or not, and
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
      w.push("Couch TV's other app (the on-TV app) was in front, not the TV's own home. It still has Home switched on: " +
        "open it and press Stop being the home screen, or run Setup again and let it switch that off.");
    } else if (!r.ok) {
      w.push("The TV's own home was in front when this looked. Press Home on the remote once more.");
    }
    if (r.warning) w.push(r.warning);
    return w.join(" ");
  }

  // ---- progress ----

  // The steps the person sees, in the order the setup really runs them. The server reports one number
  // (0 to 1) and a line of words; this turns them into which step is busy.
  var MILES = [
    { id: "found", t: "Found your TV" },
    { id: "allowed", t: "Allowed on the TV" },
    { id: "download", t: "Downloading and checking" },
    { id: "link", t: "Linking it to your account" },
    { id: "install", t: "Installing Couch TV" },
    { id: "home", t: "Making it your home screen" },
    { id: "smooth", t: "Checking the picture is smooth" }
  ];
  var miles = [];

  function milestoneAt(p, msg) {
    var ids = miles.map(function (m) { return m.id; });
    var now;
    if (/Measuring/i.test(msg || "")) now = "smooth";
    else if (p < 0.25) now = "download";
    else if (p < 0.27 && ids.indexOf("link") >= 0) now = "link";
    else if (p < 0.78) now = "install";
    else now = "home";
    return ids.indexOf(now);
  }

  function drawMiles(active) {
    var ul = $("work-steps");
    Array.prototype.forEach.call(ul.children, function (li, i) {
      li.className = i < active ? "done" : i === active ? "now" : "todo";
    });
    return active;
  }

  function working(title, kind, label) {
    workKind = kind || "generic";
    text("work-title", title);
    $("work-bar").style.width = "0%";
    $("work-mini").style.width = "0%";
    text("work-status", "Starting…");
    var ul = $("work-steps"); ul.textContent = "";
    miles = [];
    if (workKind === "setup") {
      miles = MILES.filter(function (m) { return m.id !== "link" || !!state.account; });
      miles.forEach(function (m) {
        var li = document.createElement("li");
        var mk = document.createElement("span"); mk.className = "mk"; mk.appendChild(icon("check"));
        li.appendChild(mk); li.appendChild(document.createTextNode(m.t)); ul.appendChild(li);
      });
      drawMiles(2);
    }
    ul.hidden = workKind !== "setup";
    text("work-label", label || (workKind === "setup" ? "Installing Couch TV" : title));
    text("work-sub", "Keep the TV on. We will tell you when it is done.");
    show("work");
    return function (f, m) {
      var pct = Math.round(f * 100) + "%";
      $("work-bar").style.width = pct;
      $("work-mini").style.width = pct;
      if (m) text("work-status", m + "…");
      if (workKind === "setup") {
        var a = drawMiles(milestoneAt(f, m));
        text("work-label", miles[a] ? miles[a].t : "Installing Couch TV");
      }
    };
  }

  // ---- the setup itself ----

  $("setup-go").addEventListener("click", function () {
    var room = $("tv-room").value.trim();
    var name = tvName();
    var named = room ? api("/api/name-tv", { ip: state.ip, room: room }).catch(function () {}) : Promise.resolve();
    named.then(function () {
      // names and a weather place are not asked here any more: an account's home details still go on the TV
      return job("/api/setup", { ambient_off: $("ambient").checked, ontv_home_off: $("ontv-off").checked, people: [], weather: null },
        working("Setting up " + name, "setup"));
    })
      .then(function (r) { finish(r, name); }, function (e) { show("plan"); fail(e); });
  });

  function finish(r, name) {
    var ul = $("done-account"); ul.textContent = "";
    var accountOn = state.accountMode !== "off";
    var lines = [];
    // Linked only when the server says so
    var linked = !!(r.account && r.account.linked);
    if (r.account) {
      lines.push("Couch TV installed and checked");
      if (linked) lines.push("Linked to your Couch TV account");
      else if (r.account.sent) lines.push(SENT);
      else if (r.account.error) lines.push("Not linked yet. " + r.account.error);
      if (r.account.people) lines.push("Added " + r.account.people + (r.account.people === 1 ? " person" : " people") + " from your home details");
      if (r.account.town) lines.push("Weather for " + r.account.town);
      if (r.account.design) lines.push("Sent \"" + r.account.design + "\" to the TV");
    }
    if (r.account_error) { lines.push("Not linked yet. " + r.account_error); checkAccount(); }
    if (r.speed && r.speed.cls) {
      lines.push("Measured how smoothly it draws: " + ({ a: "Slow", b: "Everyday", c: "Quick", d: "Fast" })[r.speed.cls] + (linked ? " (Couch TV Studio uses this)" : ""));
    }
    if (r.apk && !r.kept_ontv) lines.push("Version " + r.apk.version + ", checked against " + r.apk.checked);
    lines.forEach(function (l) { var li = document.createElement("li"); li.textContent = l; ul.appendChild(li); });
    ul.hidden = !lines.length;
    state.kept = !!r.kept_ontv;
    state.linked = accountOn && !state.kept ? linked : null;
    state.design = (r.account && r.account.design) || null;
    state.sent = !linked && !!(r.account && r.account.sent);   // the TV was told; it says "linked" when it checks in
    state.finishName = name;
    var notice = r.kept_ontv ? "Couch TV's other app (the on-TV app) is still your home screen, and nothing was installed." :
      homeWords({ ok: r.front, watch_bound: r.watch_bound, warning: r.warning, other_front: r.other_front });
    text("done-line", notice);
    $("done-line").hidden = !notice;
    if (!state.kept) addSession(name, state.linked);
    $("remote-adb-google").hidden = state.facts.fire;
    $("remote-adb-fire").hidden = !state.facts.fire;
    text("debug-why", state.route === "tls" ?
      "Skip this if you use the phone remote. It needs Wireless debugging on." :
      "Skip this if the phone remote should press keys.");
    renderFinish();
    show("done");
    if (tidyOn() && !state.kept) openTidy("done");   // the optional step between progress and Finish
  }

  // The finish screen follows what is true: ready, installed but not linked, or (no account on this Setup) just ready.
  function renderFinish() {
    var name = state.finishName || "Your TV";
    var accountOn = state.accountMode !== "off" && !state.kept;
    var linked = state.linked === true;
    var cta = $("studio-cta"), lk = $("link-cta");
    cta.hidden = true; lk.hidden = true;
    $("fin-cap").hidden = true;
    $("fl-panel").hidden = true;
    var badge = $("fin-badge");
    var finish = $("finish-go");
    if (state.kept) {
      badge.className = "pill dim";
      $("fin-badge-tick").hidden = true; $("fin-badge-dot").hidden = true;
      text("fin-badge-text", "Left as it was");
      text("done-title", "Left as it was");
      text("fin-lede", "Nothing was installed.");
      finish.className = "btn go big"; text("finish-text", "Finish");
    } else if (!accountOn) {
      badge.className = "pill ok";
      $("fin-badge-tick").hidden = false; $("fin-badge-dot").hidden = true;
      text("fin-badge-text", name + " is ready");
      text("done-title", "Couch TV is on your TV");
      text("fin-lede", "Couch TV is your home screen. Press Home on your TV remote to see it.");
      // No account link in this Setup: the design reaches the TV by a code made on the website
      if (state.studio) {
        cta.href = state.studio + "/design/"; cta.hidden = false;
        text("fin-cap", "Make a code there, then enter it in the TV's Home settings."); $("fin-cap").hidden = false;
      }
      finish.className = "btn go big"; text("finish-text", "Finish");
    } else if (linked) {
      badge.className = "pill ok";
      $("fin-badge-tick").hidden = false; $("fin-badge-dot").hidden = true;
      text("fin-badge-text", name + " is ready");
      text("done-title", "Couch TV is on your TV");
      text("fin-lede", state.design ? "You now have the " + state.design + " design on your TV." : "Couch TV is your home screen.");
      if (state.studio) {
        cta.href = state.studio + "/design/"; cta.hidden = false;
        text("fin-cap", "Opens the editor with " + name + " already linked."); $("fin-cap").hidden = false;
      }
      finish.className = "q"; text("finish-text", "Keep this one");
    } else {
      badge.className = "pill warn";
      $("fin-badge-tick").hidden = true; $("fin-badge-dot").hidden = false;
      text("fin-badge-text", "Installed. Not linked to your account");
      text("done-title", "Couch TV is on your TV");
      var can = hasFeature("link-tv");
      text("fin-lede", state.sent ? SENT : can ? "Link it to your account so Send and designs work." : "Couch TV is installed. It was not linked to your account.");
      if (can) { lk.hidden = false; text("fin-cap", "Nothing on the TV is installed again."); $("fin-cap").hidden = false; }
      finish.className = "q"; text("finish-text", "Not now");
    }
    $("design-tag").hidden = !(linked && state.design);
    if (state.design) text("design-tag", state.design);
    $("tidy-go").hidden = !tidyOn();
    drawSession();
  }

  // ---- the TVs set up in this session ----

  function addSession(name, linked) {
    var hit = state.session.filter(function (s) { return s.ip === state.ip; })[0];
    if (hit) { hit.name = name; hit.linked = linked; } else state.session.push({ ip: state.ip, name: name, linked: linked });
  }

  function drawSession() {
    var ul = $("session-list"); ul.textContent = "";
    state.session.forEach(function (s) {
      var li = document.createElement("li");
      var n = document.createElement("span"); n.textContent = s.name;
      li.appendChild(n);
      li.appendChild(s.linked === null ? pillEl("Set up", "ok") : s.linked ? pillEl("Linked", "ok") : pillEl("Installed, not linked", "warn"));
      ul.appendChild(li);
    });
    $("session-box").hidden = !state.session.length;
  }

  // ---- link it to the account, from the finish screen ----

  $("link-cta").addEventListener("click", function () {
    if (state.account) return linkRun();
    $("fl-panel").hidden = false;
    $("fl-code").focus();
  });

  // Every way linking can fail has a way on: sign in again, find the TV again, update Couch TV, or the same button.
  function linkFailed(e) {
    $("link-cta").disabled = false;
    var m = (e && e.message) || "That did not work. Try again.";
    var code = e && e.code;
    text("link-status", m); $("link-status").hidden = false;
    if (code === "signed_out" || code === "no_account") { signedOut(); $("link-status").hidden = false; text("link-status", m); }
    var lost = { no_tv: 1, lost: 1, not_allowed: 1, not_paired: 1, closed: 1 }[code], old = code === "old_app" || code === "not_installed";
    $("link-fix").hidden = !(lost || old);
    text("link-fix-go", old ? "Update Couch TV" : "Find the TV");
    state.linkFix = old ? "plan" : "scan";
    if (lost) text("link-status", "This computer lost the TV. Switch debugging on there, then find it.");
  }
  $("link-fix-go").addEventListener("click", function () {
    if (state.linkFix === "plan") { refreshPlan(); show("plan"); return; }
    state.mode = "setup"; $("debug-off").hidden = false; text("debug-line", "Switching debugging off again is safest."); scan();
  });

  function linkRun() {
    var st = $("link-status");
    text("link-status", "Linking…"); st.hidden = false;
    $("link-fix").hidden = true;
    $("link-cta").disabled = true;
    HOOKS.linkNow(function (f, m) { if (m) text("link-status", m + "…"); }).then(function (a) {
      $("link-cta").disabled = false;
      if (a.linked || a.sent) {
        state.linked = !!a.linked; state.sent = !a.linked;
        if (a.design) state.design = a.design;
        var hit = state.session.filter(function (s) { return s.ip === state.ip; })[0];
        if (hit) hit.linked = !!a.linked;
        var ul = $("done-account");
        [a.linked ? "Linked to your Couch TV account" : SENT].concat(a.design ? ["Sent \"" + a.design + "\" to the TV"] : []).forEach(function (l) {
          var li = document.createElement("li"); li.textContent = l; ul.appendChild(li);
        });
        ul.hidden = false;
        st.hidden = true;
        renderFinish();
      } else {
        text("link-status", "It is still not linked. Try again.");
      }
    }, linkFailed);
  }

  // A typed code or the website's Allow only asks "Link as X?". Setup is signed in, and the TV is linked, after Yes.
  $("fl-go").addEventListener("click", function () {
    text("fl-status", "Signing in…");
    api("/api/handoff", { code: $("fl-code").value }).then(function (r) { text("fl-status", ""); ask(r.ask, linkRun); },
      function (e) { text("fl-status", (e && e.message) || "That code did not work."); });
  });
  enter("fl-code", "fl-go");

  var linkTimer = null;
  $("fl-device").addEventListener("click", function () {
    api("/api/device/start").then(function (d) {
      var p = $("fl-device-code"); p.textContent = "";
      p.appendChild(document.createTextNode("On the Couch TV website, press Allow for the code "));
      var b = document.createElement("b"); b.textContent = d.user_code; p.appendChild(b);
      p.appendChild(document.createTextNode(". "));
      var a = document.createElement("a"); a.href = d.verify; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Open the website"; p.appendChild(a);
      p.hidden = false;
      window.open(d.verify, "_blank", "noopener");
      clearInterval(linkTimer);
      linkTimer = setInterval(function () {
        api("/api/device/poll").then(function (r) {
          if (r.ask) { clearInterval(linkTimer); $("fl-device-code").hidden = true; ask(r.ask, linkRun); }
        }, function (e) { clearInterval(linkTimer); text("fl-status", (e && e.message) || "That did not work. Try again."); });
      }, d.interval * 1000);
    }, function (e) { text("fl-status", (e && e.message) || "That did not work. Try again."); });
  });

  // ---- Tidy up your TV (optional; its own screen and code are in tidy.js, which this only opens) ----
  // It comes after the progress screen and before Finish, and can be skipped. window.CouchTidy exists
  // only when tidy.js is part of this Setup, so without it nothing here shows.
  function tidyOn() { return !!(window.CouchTidy && window.CouchTidy.open); }
  function openTidy(returnStep) { window.CouchTidy.open(returnStep || "done"); }
  $("tidy-go").addEventListener("click", function () { if (tidyOn()) openTidy("done"); });

  // Tidy shows and hides screens itself; keep Back and the step bar in line with whatever is on screen.
  new MutationObserver(function () {
    var vis = document.querySelector("section:not([hidden])");
    var step = vis && vis.dataset.step;
    if (!step || step === current) return;
    current = step;
    var at = nav.lastIndexOf(step);
    if (at >= 0) nav.length = at + 1; else nav.push(step);
    chrome(step);
  }).observe(document.querySelector("main"), { subtree: true, attributes: true, attributeFilter: ["hidden"] });

  // ---- set up another TV: a real reset of what belongs to the TV just done ----

  function resetTv() {
    flow += 1;
    askThen = null;                  // a question still open signs Setup in; it never links the next TV by itself
    clearInterval(countdown); clearInterval(portTimer); clearInterval(linkTimer);
    clearTimeout(poll); poll = null;
    state.ip = null; state.kind = null; state.facts = null; state.route = null; state.weather = null; state.remote = false;
    state.look = null; state.tried = 0; state.guide = null; state.helperTv = null; state.ontvTakes = false;
    state.linked = null; state.sent = false; state.design = null; state.tvName = ""; state.finishName = ""; state.kept = false;
    state.mode = "setup";
    openRow = null; rows = {}; detailsOpen = {};
    ["tv-room", "ip", "code", "pair-port", "tls-port", "fl-code", "undo-details-x"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    $("ambient").checked = false; $("ontv-off").checked = true; $("undo-debug").checked = false;
    $("helper-tv-autostart").checked = true;
    ["plan-list", "done-account", "undo-list", "guide-steps", "found", "fl-device-code", "session-list-x"].forEach(function (id) { if ($(id)) $(id).textContent = ""; });
    text("plan-name", "this TV"); text("done-line", ""); text("link-status", ""); text("fl-status", ""); text("pair-status", ""); text("tls-status", "");
    text("health-text", ""); text("health-status", ""); text("undo-details", "");
    ["done-line", "done-account", "link-status", "link-fix", "fl-panel", "guide", "ontv-row", "tcl-note", "plan-account", "fl-device-code"].forEach(function (id) { $(id).hidden = true; });
    $("health-send").hidden = false;
    ["remote-go", "health-look", "debug-off"].forEach(function (id) { $(id).hidden = false; });
    $("link-cta").disabled = false;
    text("debug-status", ""); text("remote-status", "");
  }

  $("another-go").addEventListener("click", function () {
    api("/api/reset-tv").then(function () {
      resetTv();
      nav = ["welcome"];
      scan();
    }, fail);
  });

  $("check-go").addEventListener("click", function () {
    job("/api/check").then(function (r) {
      var said = (r.ok && r.watch_bound !== false ? "Couch TV came up when Home was pressed. " : "") + homeWords(r);
      text("done-line", said); $("done-line").hidden = !said;
    }, fail);
  });

  $("remote-go").addEventListener("click", function () {
    var back = function () { show("done"); };
    job("/api/remote", {}, working("Adding the phone remote", "remote", "Adding the phone remote")).then(function (r) {
      state.remote = true;
      text("remote-addr", r.address);
      text("remote-setup", r.setup);
      text("remote-status", "");
      show("remote");
    }, function (e) { back(); fail(e); });
  });

  $("remote-code").addEventListener("click", function () {
    api("/api/remote/code").then(function () { text("remote-status", "The code is on the TV now. It lasts 3 minutes."); }, fail);
  });

  $("debug-off").addEventListener("click", function () { text("debug-status", ""); show("debug"); });
  $("debug-go").addEventListener("click", function () {
    api("/api/debug-off").then(function () {
      ["debug-off", "remote-go", "health-look", "tidy-go"].forEach(function (id) { $(id).hidden = true; });
      show("done");
      text("done-line", "Debugging is off. Couch TV keeps working."); $("done-line").hidden = false;
    }, fail);
  });

  // ---- health report: shown in full, sent only after Send ----

  $("health-look").addEventListener("click", function () {
    api("/api/health/preview").then(function (r) {
      text("health-text", JSON.stringify(r.report, null, 2));
      $("health-send").hidden = !r.can_send;
      text("health-status", r.can_send || state.accountMode === "off" ? "" : "Link your Couch TV account to send it.");
      show("health");
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
    text("acct-name", acct.name || acct.email || "Signed in");
    text("acct-av", acct.name ? acct.name.charAt(0).toUpperCase() : "✓");
    $("acct-top").hidden = false;
    $("acct-out").hidden = false;
    text("acct-line", signedInWords(acct.name || acct.email) + ". Your design and home details go on the TV too.");
    $("acct-ask").hidden = true;
    $("acct-box").hidden = true;   // the chip at the top says it now
    chrome(current || "welcome");
  }
  function signedOut() {
    state.account = null;
    $("acct-top").hidden = true; $("acct-out").hidden = true;
    text("acct-line", ASK_LINE);
    $("acct-ask").hidden = false;
    $("acct-box").hidden = state.accountMode === "off";
    $("plan-account").hidden = true;
    chrome(current || "welcome");
    if (current === "done") renderFinish();
  }
  $("acct-out").addEventListener("click", function () { api("/api/sign-out").then(signedOut, fail); });
  // the server knows: signed out when the sign in ran out
  function checkAccount() {
    return api("/api/account").then(function (a) { if (a.account) signedIn(a.account); else if (state.account) signedOut(); }, function () {});
  }

  // "Link as X?": the code is not used, and nothing about the TV is sent, until Yes. The server keeps to that too.
  var askId = null, askThen = null;
  function ask(q, then) {
    if (!q) return;
    if (q.id === askId) { if (then) askThen = then; return; }   // the 5 s look may have shown it first
    askId = q.id; askThen = then || null;
    var x = q.account.email + (q.account.name ? ", " + q.account.name : "");   // the name is only what its account says
    text("link-ask-who", "Link as " + x + "?");
    var was = q.instead_of && (q.instead_of.name || q.instead_of.email);
    text("link-ask-mail", was ? "Setup is signed in as " + was + " now. Yes switches accounts." : "Only press Yes if you just asked for this. Check the email is yours.");
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
      $("fl-panel").hidden = true;
      // the question can outlive the screen that asked it: only Finish of that same TV goes on to link it
      if (then && current === "done") then(); else if (current === "done") renderFinish();
    }, function (e) { askDone(); fail(e); }).then(function () { $("link-ask-yes").disabled = false; });
  });
  $("link-ask-no").addEventListener("click", function () {
    askDone();
    text("fl-status", "Not linked. Sign in on the website as you, then use a new code.");
    if (!state.account) text("acct-line", "Not linked. Sign in on the website as you, then use a new code.");
    api("/api/link-no").catch(function () {});
  });

  api("/api/account").then(function (a) {
    state.accountMode = a.mode || "off";
    chrome(current || "welcome");
    if (a.mode === "off") return;
    $("acct-box").hidden = false;
    if (a.account) signedIn(a.account);
    // opened from the website's Set up my TV button: whose account it is, and Yes or Not me
    if (a.ask) ask(a.ask);
    else if (a.handoff) api("/api/handoff", {}).then(function (r) { ask(r.ask); }, fail);
  }, function () {});

  // a link opened while this page was already up arrives here
  setInterval(function () {
    if (state.accountMode === "off") return;
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
  enter("acct-code", "acct-go");

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

  // ---- undo ----

  $("undo-start").addEventListener("click", function () { state.mode = "undo"; scan(); });
  $("setup-start").addEventListener("click", function () { state.mode = "setup"; scan(); });

  function undoPlan() {
    api("/api/undo/plan").then(function (p) {
      var ul = $("undo-list"); ul.textContent = "";
      var items = [];
      if (p.switch_back_on.length) items.push("Switch back on what Couch TV switched off (" + p.switch_back_on.length + ").");
      items.push("Switch off Couch TV's Home button watch and make " + (p.home_name || "the TV's own home") + " the home again.");
      if (p.home_installed) items.push("Remove the Couch TV home app.");
      if (p.ontv_installed) items.push("Remove the Couch TV phone remote app.");
      if (!p.home_installed && !p.ontv_installed) items.push("Couch TV is not on this TV, so there is nothing to remove.");
      items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      text("undo-details", p.home && p.home.indexOf("/") > 0 ? "Details: the home it goes back to is " + p.home + "." : "");
      show("undo");
    }, fail);
  }

  $("undo-go").addEventListener("click", function () {
    var off = $("undo-debug").checked;
    job("/api/undo", {}, working("Taking Couch TV off", "undo", "Taking Couch TV off")).then(function () {
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
    state.features = i.features || [];
    state.studio = i.studio || null;
    if (state.studio) { $("studio-top").href = state.studio + "/"; $("studio-top").hidden = false; }
    $("helper-later").hidden = h.mode === "helper";
    if (h.intent === "helper" && h.mode !== "helper") show("extras");
  }, function () {});
})();
