// The phone's Home settings page, for a TV whose home a computer runs (bridge/phonepage.py).
//
// The on-TV app hands the phone's At home and widget changes straight into this page (HomeActivity,
// tv.atHomeEdit). With a home computer, the page asks the computer instead: GET /api/phone/inbox every
// 10 seconds, every second while a phone has the page open or a code is showing. Each change is applied
// here exactly as the on-TV app's hand over does (app.js atHomeEdit), and the answer goes back
// (POST /api/phone/done). What the phone reads back is this page's own At home view (app.js atHomeView),
// handed to the computer when it changes (POST /api/phone/view); a calendar link only ever as its host.
// When the phone changed Home settings (the town, a photo), the page takes the computer's copy (sync).
// "Show a code on the TV" on the phone's pairing screen: the code shows as a line on the home.
// Nothing here talks to anything but the home computer.
(function (W) {
  "use strict";
  var SLOW = 10000, FAST = 1000;
  var S = null;

  // o: { api(method, path, body, timeout) -> promise, read() -> view, edit(e) -> answer, sync(), words(code) -> text,
  //      qr() (the pairing code changed: draw the QR again) }
  function start(o) {
    if (S) return;
    S = { o: o, sent: null, settingsAt: undefined, timer: 0, busy: false, code: "" };
    step();
  }
  function stop() { if (S) { clearTimeout(S.timer); showCode(""); } S = null; }

  function canon(v) { try { return JSON.stringify(v === undefined ? null : v); } catch (e) { return ""; } }

  function later(fast) {
    if (!S) return;
    clearTimeout(S.timer);
    S.timer = setTimeout(step, fast ? FAST : SLOW);
  }

  function step() {
    if (!S || S.busy) return;
    if (W.document && W.document.hidden) { later(false); return; }
    S.busy = true;
    var me = S;
    me.o.api("GET", "/api/phone/inbox?home=1", null, 8000).then(function (box) {
      return took(box).then(function () { return box; });
    }).then(function (box) { me.busy = false; if (S === me) later(!!(box && box.fast)); },
      function () { me.busy = false; if (S === me) later(false); });
  }

  // one answer from the computer (exported for tests)
  function took(box) {
    if (!S || !box) return Promise.resolve();
    var me = S, o = me.o, chain = Promise.resolve();
    (Array.isArray(box.edits) ? box.edits : []).forEach(function (x) {
      chain = chain.then(function () {
        var r;
        try { r = x && x.edit && typeof x.edit === "object" ? o.edit(x.edit) : null; } catch (e) { r = null; }
        if (!r || typeof r !== "object") r = { ok: false, error: "At home is not in this version of the home." };
        return o.api("POST", "/api/phone/done", { id: x.id, result: r }).then(function () {}, function () {});
      });
    });
    return chain.then(function () {
      if (S !== me) return null;
      // the view the phone reads: handed over when it changed, or when the computer has none (it restarted)
      var v = null;
      try { v = o.read(); } catch (e) { v = null; }
      var c = canon(v), post = null;
      if (c !== me.sent || box.want_view) {
        post = o.api("POST", "/api/phone/view", { athome: v }).then(function () { me.sent = c; }, function () {});
      }
      showCode(box.pin && box.pin.code ? box.pin.code : "", box.pin && box.pin.seconds);
      // the code changed on the computer (a phone used it, 5 wrong tries threw it away, a new one): the QR and
      // the computer line ask again at once, so a used code never stays on the screen
      if (box.pin_gen !== undefined) {
        if (me.gen !== undefined && box.pin_gen !== me.gen && o.qr) { try { o.qr(); } catch (e) {} }
        me.gen = box.pin_gen;
      }
      // a town or a photo from the phone: the computer's copy of Home settings, now
      if (me.settingsAt === undefined) me.settingsAt = box.settings_at || null;
      else if ((box.settings_at || null) !== me.settingsAt) { me.settingsAt = box.settings_at || null; try { o.sync(); } catch (e) {} }
      return post;
    });
  }

  // the code for a phone that asked for one, as a line at the top of the home, until it runs out
  var line = null, lineT = 0;
  function showCode(code, seconds) {
    code = String(code || "").replace(/\D/g, "").slice(0, 6);
    var doc = W.document;
    clearTimeout(lineT);
    if (!code || !doc || !doc.body) { if (line && line.parentNode) line.parentNode.removeChild(line); line = null; if (S) S.code = ""; return; }
    if (S) S.code = code;
    if (!line) {
      line = doc.createElement("div");
      line.className = "phone-code";
      line.setAttribute("role", "status");
      line.style.cssText = "position:fixed;top:4vh;left:50%;transform:translateX(-50%);z-index:9999;padding:1.2vh 2.4vw;border-radius:2vh;" +
        "background:rgba(10,10,12,.88);color:#f2ead8;font:600 3vh/1.3 system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 1vh 4vh rgba(0,0,0,.5)";
      doc.body.appendChild(line);
    }
    var wfn = (S && S.o.words) || API.words, spaced = code.slice(0, 3) + " " + code.slice(3);
    var words = wfn ? wfn(spaced) : "Code for your phone: " + spaced;
    line.textContent = words;
    lineT = setTimeout(function () { showCode(""); }, Math.max(5, Math.min(180, +seconds || 180)) * 1000);
  }

  var API = { start: start, stop: stop, took: took, showCode: showCode, code: function () { return S ? S.code : ""; }, words: null };
  W.CouchPhonePage = API;
})(typeof window !== "undefined" ? window : this);
