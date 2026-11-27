// The "Widget permissions" screen (lane F, 28 Nov 2026): the one Android "Allow" question that the doorbell card, Screen time and
// Batteries widgets need, given from this computer (widgetperms.py, /api/perms/). Every switch starts off; Save changes only what
// was switched; "Turn all off" puts Android's defaults back. Uses the Tidy screen's look (tidy.css). Everything from the TV goes on
// the page with textContent, never as HTML.
(function () {
  "use strict";
  var KEY = (document.querySelector('meta[name="setup-key"]') || {}).content;
  var sec, rows, note, state = null, busy = false, back = "done";

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-Key": KEY },
      body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "That did not work. Try again."); return j; });
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
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function say(t) { note.textContent = t || ""; }
  function lock(on) { busy = on; sec.querySelectorAll("button, input").forEach(function (b) { b.disabled = on; }); }

  function build() {
    sec = el("section");
    sec.dataset.step = "perms";
    sec.hidden = true;
    sec.className = "tidy";
    sec.appendChild(el("h1", null, "Widget permissions"));
    sec.appendChild(el("p", "lead", "Some widgets need Android to say yes once. Turn on the ones your designs use. Every switch starts off."));
    rows = el("div", "tidy-rows");
    sec.appendChild(rows);
    var links = el("div", "tidy-links");
    var off = el("button", "tidy-link", "Turn all off");
    off.id = "perms-off";
    links.appendChild(off);
    sec.appendChild(links);
    note = el("p", "tidy-note");
    note.setAttribute("aria-live", "polite");
    sec.appendChild(note);
    var actions = el("div", "actions");
    var save = el("button", "primary", "Save");
    save.id = "perms-save";
    var skip = el("button", null, "Back");
    skip.id = "perms-skip";
    actions.appendChild(save);
    actions.appendChild(skip);
    sec.appendChild(actions);
    document.querySelector("section").parentNode.appendChild(sec);
    off.addEventListener("click", allOff);
    save.addEventListener("click", saveAll);
    skip.addEventListener("click", close);
  }

  function draw() {
    rows.textContent = "";
    if (!state.installed) { rows.appendChild(el("p", "small", "Couch TV is not on this TV yet. Set it up first.")); return; }
    state.switches.forEach(function (s) {
      var row = el("div", "tidy-row"), left = el("div");
      left.appendChild(el("h2", null, s.label));
      left.appendChild(el("p", null, s.needed ? s.what : "This TV asks nothing for it."));
      var res = el("p", "tidy-result"); res.id = "perms-res-" + s.id; res.hidden = true; left.appendChild(res);
      row.appendChild(left);
      if (s.needed) {
        var sw = el("label", "tidy-switch"), box = document.createElement("input");
        box.type = "checkbox"; box.id = "perms-" + s.id; box.checked = !!s.on; box.setAttribute("aria-label", s.label);
        sw.appendChild(box); sw.appendChild(el("i")); row.appendChild(sw);
      }
      rows.appendChild(row);
    });
    sec.querySelector("#perms-off").hidden = !state.switches.some(function (s) { return s.on; });
  }
  function showResults(results) {
    Object.keys(results || {}).forEach(function (id) {
      var p = sec.querySelector("#perms-res-" + id);
      if (!p) return;
      p.textContent = results[id].words; p.hidden = false;
      p.className = "tidy-result" + (results[id].status === "refused" ? " tidy-bad" : "");
    });
  }
  function load() { say("Looking at this TV."); return api("/api/perms/state").then(function (s) { state = s; draw(); say(""); }); }
  function saveAll() {
    if (busy) return;
    if (!state || !state.installed) return close();
    var want = {}, changed = false;
    state.switches.forEach(function (s) {
      var b = sec.querySelector("#perms-" + s.id);
      if (b && b.checked !== !!s.on) { want[s.id] = b.checked; changed = true; }
    });
    if (!changed) return close();
    lock(true);
    say("Asking Android and checking each one.");
    job("/api/perms/apply", want).then(function (r) { state = r.state; draw(); showResults(r.results); say("Done."); lock(false); },
      function (e) { say(e.message); lock(false); });
  }
  function allOff() {
    if (busy) return;
    lock(true);
    say("Turning them all off.");
    job("/api/perms/off").then(function (s) { state = s; draw(); say("All off. Android asks again if a widget needs it."); lock(false); },
      function (e) { say(e.message); lock(false); });
  }
  function close() {
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s.dataset.step !== back; });
    window.scrollTo(0, 0);
  }
  function open(from) {
    if (!sec) build();
    back = from || "done";
    state = null;
    rows.textContent = "";
    sec.querySelector("#perms-off").hidden = true;
    document.querySelectorAll("section").forEach(function (s) { s.hidden = s !== sec; });
    window.scrollTo(0, 0);
    load().then(function () { lock(false); }, function (e) { say(e.message); });
  }

  window.CouchPerms = { open: open };
  var go = document.getElementById("perms-go");
  if (go) go.addEventListener("click", function () { open("done"); });
})();
