// couch-tv Setup page. Everything that comes from the network or the TV is put on the page with
// textContent, never as HTML.
(function () {
  "use strict";
  var KEY = document.querySelector('meta[name="setup-key"]').content;
  var OS = document.querySelector('meta[name="setup-os"]').content;
  var $ = function (id) { return document.getElementById(id); };
  var state = { mode: "setup", ip: null, kind: null, facts: null, route: null, weather: null, remote: false };

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Key": KEY },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { var e = new Error(j.error || "Something went wrong."); e.code = j.code; throw e; }
        return j;
      });
    });
  }

  // A slow step runs as a job; this asks how it is going until it is done.
  function job(path, body, onProgress) {
    return api(path, body).then(function () {
      return new Promise(function (resolve, reject) {
        (function tick() {
          api("/api/job").then(function (j) {
            if (onProgress) onProgress(j.progress || 0, j.message || "");
            if (j.running) return setTimeout(tick, 700);
            if (j.error) { var e = new Error(j.error); e.code = j.code; return reject(e); }
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

  function fail(e) {
    $("error").textContent = e.message || String(e);
    $("error").hidden = false;
  }

  function text(id, t) { $(id).textContent = t; }

  document.querySelectorAll("[data-os]").forEach(function (el) { el.hidden = el.dataset.os !== OS; });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () { show(b.dataset.go); });
  });
  setInterval(function () { api("/api/ping").catch(function () {}); }, 20000);

  // ---- find ----

  function scan() {
    show("find");
    text("find-status", "Looking on your Wi-Fi…");
    $("found").textContent = "";
    $("find-help").hidden = true;
    job("/api/scan").then(function (r) {
      var tvs = r.tvs.filter(function (t) { return t.android; });
      text("find-status", tvs.length ? "Which one is it?" : "No TV found yet.");
      $("find-help").hidden = tvs.length > 0;
      tvs.forEach(function (t) {
        var b = document.createElement("button");
        var name = document.createElement("span");
        name.textContent = t.name || (t.adb_5555 ? "A TV with debugging on" : "Android TV");
        var small = document.createElement("small");
        small.textContent = t.ip;
        b.appendChild(name); b.appendChild(small);
        b.addEventListener("click", function () { pick(t.ip, t); });
        $("found").appendChild(b);
      });
    }, function (e) { fail(e); $("find-help").hidden = false; });
  }

  function pick(ip, seen) {
    state.ip = ip;
    api("/api/look", { ip: ip }).then(function (r) {
      if (r.kind === "samsung" || r.kind === "lg" || r.kind === "roku") {
        var names = { samsung: "Samsung", lg: "LG", roku: "Roku" };
        text("stop-title", "A " + names[r.kind] + " needs another way");
        text("stop-text", "couch-tv can go on a " + names[r.kind] + ", but not from this app: it needs a computer at home " +
          "that stays on and opens couch-tv each time the TV is switched on, and the Home button still opens " +
          names[r.kind] + "'s own menu. The guide on GitHub walks through it.");
        text("stop-more", "Or plug a Google TV box (for example the Google TV Streamer) into the TV's HDMI: this app can set that up, and it gets everything.");
        return show("stop");
      }
      var guess = seen && seen.name ? "google" : null;
      if (seen && seen.wireless_debugging) guess = "google";
      text("kind-line", r.kind === "android" ? "It looks like an Android based TV." :
        "It is not answering yet. That is normal for a Fire TV before ADB debugging is on. Pick what it is.");
      document.querySelectorAll("[data-kind]").forEach(function (b) { b.classList.toggle("guess", b.dataset.kind === guess); });
      show("kind");
    }, fail);
  }

  $("ip-go").addEventListener("click", function () { pick($("ip").value.trim(), null); });
  $("rescan").addEventListener("click", scan);

  document.querySelectorAll("[data-kind]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.kind = b.dataset.kind;
      if (state.kind === "google") return startGoogle();
      $("howto-android").hidden = state.kind !== "android";
      $("howto-fire").hidden = state.kind !== "fire";
      $("fire-note").hidden = state.kind !== "fire";
      text("classic-title", state.kind === "fire" ? "Switch on ADB debugging" : "Switch on debugging");
      show("dev-classic");
    });
  });

  // ---- Google TV: pairing code ----

  var portTimer = null;
  function startGoogle() {
    show("dev-google");
    $("code").value = "";
    $("pair-port").value = "";
    text("pair-status", "");
    clearInterval(portTimer);
    portTimer = setInterval(function () {
      if ($("pair-port").value || $("dev-google").hidden) return;
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

  $("connect-go").addEventListener("click", allow);
  $("allow-retry").addEventListener("click", allow);
  function allow() {
    show("allow");
    $("allow-retry").hidden = true;
    text("allow-status", "Tick Always allow from this computer, then press Allow on the TV. Waiting up to a minute and a half…");
    job("/api/connect", { ip: state.ip }).then(connected, function (e) {
      if (e.code === "not_allowed") return show("no-allow");
      fail(e);
      $("allow-retry").hidden = false;
      text("allow-status", "");
    });
  }

  // ---- connected: the plan, or the undo plan ----

  function connected(r) {
    state.facts = r.facts; state.route = r.route;
    var f = r.facts;
    if (!f.supported) {
      text("stop-title", "This TV is too old");
      text("stop-text", "This app needs Android 7.1 or newer, and this TV has Android " + f.android + ". A Google TV box plugged into the TV can run couch-tv.");
      text("stop-more", "On Android 6 (for example the Xiaomi Mi TV 4A), couch-tv is experimental and is set up from a computer with the guide on GitHub. Nothing was changed on the TV.");
      return show("stop");
    }
    if (state.mode === "undo") return undoPlan();
    text("device-line", "Connected to your " + f.name + " (" + (f.fire ? "Fire OS " + (f.fire_os || "") : "Android " + f.android) + ").");
    $("tcl-note").hidden = !f.tcl;
    refreshPlan();
    show("plan");
  }

  function refreshPlan() {
    api("/api/plan", { ambient_off: $("ambient").checked }).then(function (p) {
      var ul = $("plan-list"); ul.textContent = "";
      p.items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    }, fail);
  }
  $("ambient").addEventListener("change", refreshPlan);

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
    job("/api/setup", { ambient_off: $("ambient").checked, people: people, weather: state.weather }, working("Setting it up"))
      .then(function (r) {
        text("done-title", r.front ? "couch-tv is your home screen" : "couch-tv is on the TV");
        text("done-line", (r.front ? "It is on the screen now. " : "It is installed. ") +
          "Version " + r.apk.version + ", checked against " + r.apk.checked + ". " +
          homeWords({ ok: r.front, watch_bound: r.watch_bound, warning: r.warning }));
        $("remote-done").hidden = true;
        $("remote-adb-google").hidden = state.facts.fire;
        $("remote-adb-fire").hidden = !state.facts.fire;
        text("debug-why", state.route === "tls" ?
          "this switches Wireless debugging off. Skip it if you add the phone remote: that needs it on." :
          "this switches debugging off. Skip it if you add the phone remote and want it to press keys.");
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

  // ---- undo ----

  $("undo-start").addEventListener("click", function () { state.mode = "undo"; scan(); });
  $("setup-start").addEventListener("click", function () { state.mode = "setup"; scan(); });

  function undoPlan() {
    api("/api/undo/plan").then(function (p) {
      var ul = $("undo-list"); ul.textContent = "";
      var items = [];
      if (p.switch_back_on.length) items.push("Switch back on what couch-tv switched off (" + p.switch_back_on.length + ").");
      items.push("Switch off couch-tv's Home button watch and make " + p.home + " the home again.");
      if (p.home_installed) items.push("Remove the couch-tv home app.");
      if (p.ontv_installed) items.push("Remove the couch-tv phone remote app.");
      if (!p.home_installed && !p.ontv_installed) items.push("couch-tv is not on this TV, so there is nothing to remove.");
      items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
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

  function closeSetup() {
    api("/api/quit").then(function () { show("closed"); }, fail);
  }
  $("close-go").addEventListener("click", closeSetup);
  $("close-go2").addEventListener("click", closeSetup);
  $("close-top").addEventListener("click", closeSetup);

  show("welcome");
})();
