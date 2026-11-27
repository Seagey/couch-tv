// The Smart home step (Phase 2 lane B, 28 Nov 2026; smarthome.py on the computer, mockups in couch-tv/coord/mockups-1128/B).
// Self-contained like tidy.js: it shows its own sections and goes back where it came from. Everything from the network goes on the
// page with textContent, never as HTML. No token or key ever reaches this page: the computer keeps them until they are locked in the account.
(function () {
  "use strict";
  var KEY = (document.querySelector('meta[name="setup-key"]') || {}).content;
  var $ = function (id) { return document.getElementById(id); };
  var back = "done", S = null, haWait = null, lastBase = "";

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-Key": KEY }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "That did not work. Try again."); return j; }); });
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
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function say(id, t) { $(id).textContent = t || ""; }
  function show(step) { document.querySelectorAll("section").forEach(function (s) { s.hidden = s.dataset.step !== step; }); window.scrollTo(0, 0); var h = document.querySelector('section[data-step="' + step + '"] h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }

  function state() { return api("/api/smart/state").then(function (s) { S = s; return s; }); }

  // ---- 1. what was found ----
  function row(ico, cls, title, sub, found, btn, onClick, done) {
    var li = el("li", "shrow" + (done ? " done" : ""));
    li.appendChild(el("span", "shico " + cls, ico));
    var g = el("div", "grow"); g.appendChild(el("b", null, title)); g.appendChild(el("small", null, sub)); li.appendChild(g);
    if (found) { var p = el("span", "pill " + (done ? "ok" : "ok")); p.appendChild(el("span", "dot")); p.appendChild(document.createTextNode(done ? "Connected" : "Found")); li.appendChild(p); }
    if (btn) { var b = el("button", done ? "" : "primary", btn); b.type = "button"; b.addEventListener("click", onClick); li.appendChild(b); }
    return li;
  }
  function paintFound() {
    var ul = $("sh-list"); ul.textContent = "";
    var any = false;
    if (S.ha) { ul.appendChild(row("HA", "ha", "Home Assistant", S.ha.host + ", " + S.ha.count + " things to show", true, "Change", function () { haConnect(lastBase); }, true)); any = true; }
    else S.ha_found.forEach(function (f) { ul.appendChild(row("HA", "ha", f.name || "Home Assistant", f.host, true, "Connect", function () { haConnect(f.base); })); any = true; });
    if (S.hue) { ul.appendChild(row("Hue", "hue", "Philips Hue Bridge", S.hue.lights.length + " lights", true, null, null, true)); any = true; }
    else S.hue_found.forEach(function (a) { ul.appendChild(row("Hue", "hue", "Philips Hue Bridge", "On your Wi-Fi", true, "Connect", function () { huePair(a); })); any = true; });
    if (S.airtouch) { ul.appendChild(row("AT", "at", "AirTouch 5 air con", S.airtouch.zones.length ? S.airtouch.zones.length + " zones" : "Found. The Couch TV Helper reads its zones.", true, null, null, true)); any = true; }
    else S.airtouch_found.forEach(function (a) { ul.appendChild(row("AT", "at", "AirTouch 5 air con", "On your Wi-Fi", true, "Connect", function () { atUse(a); })); any = true; });
    var m = S.matter || {};
    $("sh-matter-box").hidden = false;
    ul.appendChild(row("M", "mt", "Matter devices", (m.waiting ? m.waiting + " waiting to be added. " : "") + "Share them from Google Home, Apple Home, SmartThings or Alexa", false, "Add with a code", function () { $("sh-matter-box").open = true; $("sh-matter-code").focus(); }));
    say("sh-looking", any ? "" : "Nothing found yet. Check this computer is on the home Wi-Fi, or type an address below.");
    $("sh-next").disabled = !(S.ha || S.hue || S.airtouch);
  }
  function look() {
    say("sh-looking", "Looking on your Wi-Fi...");
    $("sh-list").textContent = "";
    return job("/api/smart/find").then(function () { return state(); }).then(paintFound, function (e) { say("sh-looking", e.message); });
  }

  // ---- 2. sign in ----
  function haConnect(base) {
    lastBase = base || lastBase;
    $("sh-ha-base").value = lastBase || "http://homeassistant.local:8123";
    say("sh-ha-status", "");
    show("smart-ha");
    api("/api/smart/ha-start", { base: lastBase }).then(waitHa, function (e) { say("sh-ha-status", e.message); $("sh-ha-tokbox").open = true; });
  }
  function waitHa() {
    clearTimeout(haWait);
    var t0 = Date.now();
    (function tick() {
      state().then(function (s) {
        if (s.ha) { show("smart"); paintFound(); say("sh-status", "Home Assistant is connected."); return; }
        if (Date.now() - t0 > 10 * 60 * 1000) { say("sh-ha-wait", "Still waiting. Use a token instead, below."); return; }
        if (document.querySelector('section[data-step="smart-ha"]').hidden) return;
        haWait = setTimeout(tick, 1500);
      });
    })();
  }
  function haToken() {
    say("sh-ha-status", "Checking...");
    var tok = $("sh-ha-token");
    job("/api/smart/ha-token", { base: $("sh-ha-base").value.trim(), token: tok.value.trim() }).then(function () {
      tok.value = "";
      return state();
    }).then(function () { show("smart"); paintFound(); say("sh-status", "Home Assistant is connected."); }, function (e) { say("sh-ha-status", e.message); });
  }

  // ---- Hue, AirTouch, Matter ----
  var hueAddr = "";
  function huePair(a) {
    hueAddr = a || hueAddr;
    show("smart-hue"); say("sh-hue-status", ""); say("sh-hue-wait", "Waiting for the button");
    job("/api/smart/hue", { address: hueAddr }).then(function () { return state(); }).then(function () { show("smart"); paintFound(); say("sh-status", "Hue is connected."); },
      function (e) { say("sh-hue-wait", "Not yet"); say("sh-hue-status", e.message); });
  }
  function atUse(a) {
    say("sh-status", "Reading the AirTouch zones...");
    job("/api/smart/airtouch", { address: a }).then(function () { return state(); }).then(function () { paintFound(); say("sh-status", "AirTouch is connected."); }, function (e) { say("sh-status", e.message); });
  }
  function matterAdd() {
    say("sh-matter-status", "Adding. This can take a minute...");
    job("/api/smart/matter", { code: $("sh-matter-code").value }).then(function () { $("sh-matter-code").value = ""; say("sh-matter-status", "Added. It shows on TVs the Couch TV Helper looks after."); },
      function (e) { say("sh-matter-status", e.message); });
  }

  // ---- 3. rooms for each TV ----
  function rooms() {
    show("smart-rooms");
    say("sh-rooms-note", ""); say("sh-save-status", "");
    var box = $("sh-tvs"); box.textContent = "";
    state().then(function (s) {
      if (!s.account) { say("sh-rooms-note", s.account_error || "Link Couch TV Setup to your account first, then come back here."); $("sh-save").disabled = true; return; }
      var tvs = s.account.tvs || [];
      if (!tvs.length) { say("sh-rooms-note", "No TVs in your account yet. Set up a TV first."); $("sh-save").disabled = true; return; }
      if (!s.account.trusted) say("sh-rooms-note", "To save keys, open Setup from the website's Set up my TV button on this computer.");
      $("sh-save").disabled = false;
      tvs.forEach(function (tv) { box.appendChild(tvCard(tv, s.choices)); });
    });
  }
  function had(tv, id) {
    var r = tv.room;
    if (!r) return true;   // no room yet: the whole house to start with
    var all = [].concat(r.climate || [], r.zones || [], r.lights || [], r.speakers || []);
    return all.indexOf(id) >= 0;
  }
  function tvCard(tv, ch) {
    var c = el("div", "card flat shtv"); c.dataset.tv = tv.id;
    var h = el("div", "tvh"); h.appendChild(el("span", "tvico")); var hd = el("div"); hd.appendChild(el("b", null, tv.name || "TV")); var sub = el("small"); hd.appendChild(sub); h.appendChild(hd); c.appendChild(h);
    var lab = el("label", null, "Room name"); var inp = el("input"); inp.value = (tv.room && tv.room.label) || ""; inp.maxLength = 30; inp.className = "sh-label"; lab.appendChild(inp); c.appendChild(lab);
    var sum = el("p", "shsum");
    function count() {
      var air = c.querySelectorAll('input[data-g="air"]'), on = c.querySelectorAll('input[data-g="air"]:checked');
      var allOn = c.querySelectorAll("input[type=checkbox]:checked").length === c.querySelectorAll("input[type=checkbox]").length;
      sub.textContent = allOn ? "Sees the whole house" : (inp.value.trim() || "Some rooms") + " only";
      sum.textContent = air.length ? "Sees " + on.length + " of " + air.length + " air con rooms" + (on.length < air.length ? ". Guests only reach their own room." : "") : "No air con found.";
      c.classList.toggle("on", !allOn);
    }
    [["air", "Air con"], ["lights", "Lights"], ["speakers", "Speakers"]].forEach(function (g) {
      var items = ch[g[0]] || [];
      if (!items.length) return;
      c.appendChild(el("h3", "shgrp", g[1]));
      items.forEach(function (it) {
        var l = el("label", "tick"), cb = el("input"); cb.type = "checkbox"; cb.dataset.g = g[0]; cb.value = it.id; cb.checked = had(tv, it.id);
        cb.addEventListener("change", count);
        l.appendChild(cb); l.appendChild(document.createTextNode(" " + it.name + " ")); l.appendChild(el("small", null, it.area ? it.area + ", " + it.from : it.from));
        c.appendChild(l);
      });
    });
    inp.addEventListener("input", count);
    c.appendChild(sum); count();
    return c;
  }
  function save() {
    var tvs = [];
    document.querySelectorAll("#sh-tvs .shtv").forEach(function (c) {
      var picks = { air: [], lights: [], speakers: [] };
      c.querySelectorAll("input[type=checkbox]:checked").forEach(function (cb) { picks[cb.dataset.g].push(cb.value); });
      tvs.push({ tv_id: c.dataset.tv, label: c.querySelector(".sh-label").value.trim(), picks: picks });
    });
    say("sh-save-status", "Saving to your account...");
    $("sh-save").disabled = true;
    job("/api/smart/save", { tvs: tvs }).then(function (r) {
      var ul = $("sh-done-list"); ul.textContent = "";
      var tick = function (t) { var li = el("li"); var i = el("span", "tick-icon sm"); i.innerHTML = '<svg aria-hidden="true"><use href="#check"/></svg>'; li.appendChild(i); li.appendChild(document.createTextNode(t)); ul.appendChild(li); };
      if (r.saved && r.saved.length) tick(r.saved.join(" and ") + (r.saved.length > 1 ? " keys are" : " key is") + " locked in your account");
      document.querySelectorAll("#sh-tvs .shtv").forEach(function (c) { tick(c.querySelector("b").textContent + ": " + c.querySelector("small").textContent.toLowerCase().replace(/^sees/, "sees")); });
      if (r.helper) tick("Hue and AirTouch are on the Couch TV Helper on this computer");
      if (r.helper_ha) tick("Home Assistant is on the Couch TV Helper too, for the Samsung, LG and other TVs it looks after");
      show("smart-done");
    }, function (e) { say("sh-save-status", e.message); }).then(function () { $("sh-save").disabled = false; });
  }

  function open(from) { back = from || "done"; show("smart"); state().then(paintFound).then(function () { if (!(S.ha_found.length || S.hue_found.length || S.airtouch_found.length || S.ha)) look(); }); }

  $("sh-again").addEventListener("click", look);
  $("sh-skip").addEventListener("click", function () { show(back); });
  $("sh-next").addEventListener("click", rooms);
  $("sh-ha-open").addEventListener("click", function () { haConnect(lastBase); });
  $("sh-ha-token-go").addEventListener("click", haToken);
  $("sh-ha-addr-go").addEventListener("click", function () { haConnect($("sh-ha-addr").value.trim()); });
  $("sh-hue-addr-go").addEventListener("click", function () { huePair($("sh-hue-addr").value.trim()); });
  $("sh-at-addr-go").addEventListener("click", function () { atUse($("sh-at-addr").value.trim()); });
  $("sh-hue-again").addEventListener("click", function () { huePair(); });
  $("sh-hue-skip").addEventListener("click", function () { show("smart"); });
  $("sh-matter-go").addEventListener("click", matterAdd);
  $("sh-save").addEventListener("click", save);
  $("sh-done").addEventListener("click", function () { show(back); });
  var go = $("smart-go"); if (go) go.addEventListener("click", function () { open("done"); });
  window.CouchSmart = { open: open };
})();
