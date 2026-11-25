// The "Tidy up your TV" screen (optional). Self-contained: it builds its own section, talks to the
// /api/tidy/ routes, and goes back to the plan when it is done or skipped. Everything from the TV goes
// on the page with textContent, never as HTML. Skipping changes nothing on the TV.
(function () {
  "use strict";
  var KEY = (document.querySelector('meta[name="setup-key"]') || {}).content;
  var TEXT = {
    ads: ["Fewer ads and less tracking", "Turns off the ad and viewing apps this TV has."],
    anim: ["Shorter menu animations", "Menu animations play for half as long."],
    idle: ["Stop idle screen adverts", "Turns off the idle screen. Only on TVs that have it."]
  };
  var sec, rows, note, state = null, busy = false, back = "plan";

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-Key": KEY },
      body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || "That did not work. Try again.");
        return j;
      });
    });
  }

  function job(path, body) {
    return api(path, body).then(function () {
      return new Promise(function (resolve, reject) {
        (function tick() {
          api("/api/job").then(function (j) {
            if (j.running) return setTimeout(tick, 700);
            if (j.error) return reject(new Error(j.error));
            resolve(j.result);
          }, reject);
        })();
      });
    });
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  }

  function say(t) { note.textContent = t || ""; }
  function lock(on) {
    busy = on;
    sec.querySelectorAll("button, input").forEach(function (b) { b.disabled = on; });
  }

  function build() {
    sec = el("section");
    sec.dataset.step = "tidy";
    sec.hidden = true;
    sec.className = "tidy";
    sec.appendChild(el("h1", null, "Tidy up your TV"));
    sec.appendChild(el("p", "lead", "Optional. Every switch starts off. Undo any time."));
    rows = el("div", "tidy-rows");
    sec.appendChild(rows);
    var links = el("div", "tidy-links");
    var speed = el("button", "tidy-link", "Check how smooth my TV runs");
    speed.id = "tidy-speed";
    var undo = el("button", "tidy-link", "Undo all");
    undo.id = "tidy-undo";
    links.appendChild(speed);
    links.appendChild(undo);
    sec.appendChild(links);
    note = el("p", "tidy-note");
    note.setAttribute("aria-live", "polite");
    sec.appendChild(note);
    var actions = el("div", "actions");
    var save = el("button", "primary", "Save");
    save.id = "tidy-save";
    var skip = el("button", null, "Skip");
    skip.id = "tidy-skip";
    actions.appendChild(save);
    actions.appendChild(skip);
    sec.appendChild(actions);
    var host = document.querySelector("section").parentNode;
    host.appendChild(sec);
    speed.addEventListener("click", checkSpeed);
    undo.addEventListener("click", undoAll);
    save.addEventListener("click", saveAll);
    skip.addEventListener("click", close);
  }

  function draw() {
    rows.textContent = "";
    state.switches.forEach(function (s) {
      var t = TEXT[s.id];
      if (!t) return;
      var row = el("div", "tidy-row");
      var left = el("div");
      left.appendChild(el("h2", null, t[0]));
      left.appendChild(el("p", null, t[1]));
      if (s.id === "ads" && s.count) left.appendChild(el("p", null, "This TV has " + s.count + " of them."));
      var res = el("p", "tidy-result");
      res.id = "tidy-res-" + s.id;
      res.hidden = true;
      left.appendChild(res);
      var sw = el("label", "tidy-switch");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.id = "tidy-" + s.id;
      box.checked = !!s.on;
      box.setAttribute("aria-label", t[0]);
      sw.appendChild(box);
      sw.appendChild(el("i"));
      row.appendChild(left);
      row.appendChild(sw);
      rows.appendChild(row);
    });
    if (!state.switches.length) rows.appendChild(el("p", "small", "This TV has nothing to tidy up."));
    sec.querySelector("#tidy-speed").hidden = !state.speed;
    sec.querySelector("#tidy-undo").hidden = !state.undo;
  }

  function showResults(results) {
    Object.keys(results || {}).forEach(function (id) {
      var p = sec.querySelector("#tidy-res-" + id);
      if (!p) return;
      p.textContent = results[id].words;
      p.hidden = false;
      p.className = "tidy-result" + (/refused|^left|not put|would not/i.test(results[id].status + " " + results[id].words) ? " tidy-bad" : "");
    });
  }

  function load() {
    say("Looking at this TV.");
    return api("/api/tidy/state").then(function (s) { state = s; draw(); say(""); });
  }

  function saveAll() {
    if (busy) return;
    if (!state) return close();             // this TV was never read: nothing to change
    var want = {}, changed = false;
    state.switches.forEach(function (s) {
      var on = sec.querySelector("#tidy-" + s.id).checked;
      if (on !== !!s.on) { want[s.id] = on; changed = true; }
    });
    if (!changed) return close();           // nothing asked for: nothing changed
    lock(true);
    say("Making the changes and checking each one.");
    job("/api/tidy/apply", want).then(function (r) {
      state = r.state;
      draw();                               // the switches show what the TV says, and Undo all appears
      showResults(r.results);
      say("Done.");
      lock(false);
      sec.querySelector("#tidy-save").textContent = "Continue";
      sec.querySelector("#tidy-skip").hidden = true;
    }, function (e) { say(e.message); lock(false); });
  }

  function undoAll() {
    if (busy) return;
    lock(true);
    say("Putting everything back.");
    job("/api/tidy/undo").then(function (r) {
      state = r.state;
      draw();
      showResults(r.results);
      say("Undo finished. Anything you changed yourself was left alone.");
      lock(false);
    }, function (e) { say(e.message); lock(false); });
  }

  function checkSpeed() {
    if (busy) return;
    lock(true);
    say("Checking for a few seconds. Keep the Couch TV home on screen.");
    job("/api/tidy/speed").then(function (r) {
      say(r.words.join(" "));
      lock(false);
    }, function (e) { say(e.message); lock(false); });
  }

  function close() {
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s.dataset.step !== back; });
    window.scrollTo(0, 0);
  }

  // Opens the screen. `from` is the data-step to return to.
  function open(from) {
    if (!sec) build();
    back = from || "plan";
    state = null;                           // never the last TV's switches
    rows.textContent = "";
    sec.querySelector("#tidy-speed").hidden = sec.querySelector("#tidy-undo").hidden = true;
    var save = sec.querySelector("#tidy-save");
    save.textContent = "Save";
    sec.querySelector("#tidy-skip").hidden = false;
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s !== sec; });
    window.scrollTo(0, 0);
    load().then(function () { lock(false); }, function (e) { say(e.message); });
  }

  window.CouchTidy = { open: open };
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest("[data-tidy-open]");
    if (t) open(t.dataset.tidyOpen);
  });
})();
