// The finish screen's four extras (lane D, 28 Nov 2026; mockups coord/mockups-1128/D): Set up Ask AI, Connect your own AI,
// Apps on this TV, Live from this TV. Self-contained like tidy.js: it adds its own cards to the finish screen's tools, builds its
// own sheets and talks only to /api/live/. Everything from the TV or the account goes on the page with textContent, never as HTML.
// The Ask AI key is typed into a password field, sent once to Setup (which sends it to the account) and the field is emptied.
(function () {
  "use strict";
  var KEY = (document.querySelector('meta[name="setup-key"]') || {}).content;
  var sheets = {}, info = null;

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-Key": KEY },
      body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || "That did not work. Try again.");
        return j;
      });
    });
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  }
  function button(cls, txt, id) { var b = el("button", cls, txt); b.type = "button"; if (id) b.id = id; return b; }
  function field(labelText, input) { var l = el("label", null, labelText); l.appendChild(input); return l; }
  function say(sec, t) { sec.querySelector(".hint").textContent = t || ""; }
  function lock(sec, on) { sec.querySelectorAll("button, input, select").forEach(function (b) { b.disabled = on; }); }

  function sheet(step, title, lead) {
    var sec = el("section", "sheet live");
    sec.dataset.step = step;
    sec.hidden = true;
    sec.appendChild(el("h1", null, title));
    if (lead) sec.appendChild(el("p", "lead", lead));
    var body = el("div", "live-body");
    sec.appendChild(body);
    var hint = el("p", "hint");
    hint.setAttribute("aria-live", "polite");
    sec.appendChild(hint);
    document.querySelector("main").insertBefore(sec, document.getElementById("error"));
    sheets[step] = sec;
    return body;
  }
  function show(step) {
    document.querySelectorAll("main > section").forEach(function (s) { s.hidden = s.dataset.step !== step; });
    window.scrollTo(0, 0);
  }
  function tvName() { return (info && info.tv) || "this TV"; }

  // ---------------- Ask AI ----------------
  function askSheet() {
    var b = sheet("live-ask", "Ask AI on this TV", "Ask a question on the TV and the answer shows in big words. You choose who answers.");
    var who = el("select"); who.id = "ask-provider";
    var base = el("input"); base.id = "ask-base"; base.placeholder = "https://..."; base.autocomplete = "off";
    var baseL = field("The service's address", base); baseL.hidden = true;
    var model = el("input"); model.id = "ask-model"; model.autocomplete = "off";
    var key = el("input"); key.id = "ask-key"; key.type = "password"; key.autocomplete = "off"; key.spellcheck = false;
    var where = el("p", "small"); where.id = "ask-where";
    b.appendChild(field("Who answers", who));
    b.appendChild(baseL);
    b.appendChild(field("Model (you can leave this empty)", model));
    b.appendChild(field("Your key", key));
    b.appendChild(where);
    var money = el("div", "warn money"); money.id = "ask-money";
    b.appendChild(money);
    var ul = el("ul", "ticks small");
    ["Kept locked in your Couch TV account. We never show it again, only its last 4.",
      "Sent only to this TV, and only to https:// addresses.",
      "Remove it any time: here, or your account, Connections, Remove my keys."].forEach(function (t) { ul.appendChild(el("li", null, t)); });
    b.appendChild(ul);
    var only = el("label", "tick"); var box = el("input"); box.type = "checkbox"; box.id = "ask-only"; box.checked = true; box.disabled = true;
    only.appendChild(box); only.appendChild(el("span", null, "")); only.id = "ask-only-l";
    b.appendChild(only);
    var act = el("div", "actions");
    var save = button("primary", "Save and send to this TV", "ask-save");
    var remove = button(null, "Remove the key", "ask-remove");
    act.appendChild(save); act.appendChild(remove);
    b.appendChild(act);
    var need = el("p", "warn"); need.id = "ask-link"; need.hidden = true;
    need.textContent = "Link this TV to your Couch TV account first (on this screen, Link it to your account). Then Ask AI is kept there.";
    b.appendChild(need);

    function pick() {
      var p = (info.providers || []).filter(function (x) { return x.id === who.value; })[0] || {};
      baseL.hidden = who.value !== "other";
      model.value = p.model || "";
      where.textContent = p.where ? "Get one at " + p.where + "." : "";
    }
    who.addEventListener("change", pick);
    save.addEventListener("click", function () {
      var sec = sheets["live-ask"];
      lock(sec, true); say(sec, "Saving it to your account.");
      api("/api/live/ask-save", { provider: who.value, base: base.value, model: model.value, key: key.value }).then(function (r) {
        key.value = "";
        say(sec, "Saved" + (r.last4 ? ", ends in " + r.last4 : "") + ". " +
          (r.sent ? tvName() + " gets it within a minute." : r.trusted ? tvName() + " gets it with the next design you send it." :
            "It waits in your account until " + tvName() + " is linked with a Yes on the same Wi-Fi."));
      }, function (e) { say(sec, e.message); }).then(function () { lock(sec, false); box.disabled = true; });
    });
    remove.addEventListener("click", function () {
      var sec = sheets["live-ask"];
      lock(sec, true);
      api("/api/live/ask-remove").then(function () { say(sec, "Removed from your account. " + tvName() + " drops it when it next checks in. Also remove the key at the AI company to stop any copy."); },
        function (e) { say(sec, e.message); }).then(function () { lock(sec, false); box.disabled = true; });
    });
    return function () {
      who.textContent = "";
      (info.providers || []).forEach(function (p) { var o = el("option", null, p.name); o.value = p.id; who.appendChild(o); });
      pick();
      money.textContent = "";
      money.appendChild(el("b", null, "This key can spend your money. "));
      money.appendChild(document.createTextNode((info.money_line || "").replace(/^This key can spend your money\.\s*/, "") +
        " Each answer on the TV is charged to your own account."));
      only.lastChild.textContent = "Only " + tvName() + " may use it";
      need.hidden = !!info.linked;
      save.disabled = remove.disabled = !info.linked;
    };
  }

  // ---------------- Connect your own AI ----------------
  function agentSheet() {
    var b = sheet("live-agent", "Connect your own AI", "Your AI app can show messages on the TV (“Dinner is ready”) and send it designs. The TV always asks “Use this design?” first.");
    var out = el("div"); out.id = "agent-lines";
    b.appendChild(out);
    var pair = el("div"); pair.id = "agent-pair"; pair.hidden = true;
    pair.appendChild(el("p", null, "Use the Couch TV app on " + "the TV" + ": it shows 6 numbers, you type them here. Once only."));
    var act = el("div", "actions");
    var code = button("primary", "Show a code on the TV", "agent-code");
    act.appendChild(code);
    pair.appendChild(act);
    var pin = el("input"); pin.id = "agent-pin"; pin.inputMode = "numeric"; pin.maxLength = 6; pin.autocomplete = "off";
    var row = el("span", "row"); row.appendChild(pin);
    var go = button("primary", "Pair", "agent-pair-go"); row.appendChild(go);
    var l = el("label", null, "The 6 numbers"); l.appendChild(row);
    pair.appendChild(l);
    b.appendChild(pair);

    function copyBox(title, help, text, id) {
      out.appendChild(el("h2", null, title));
      if (help) out.appendChild(el("p", null, help));
      var pre = el("pre", "lines", text); pre.id = id;
      out.appendChild(pre);
      var a = el("div", "actions"); var c = button("primary", "Copy"); a.appendChild(c); out.appendChild(a);
      c.addEventListener("click", function () {
        var done = function () { c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1500); };
        try { navigator.clipboard.writeText(text).then(done, function () {}); } catch (e) {}
      });
    }
    function draw(r) {
      out.textContent = "";
      copyBox("Claude Desktop", "Open Settings, Developer, Edit config, and add this inside mcpServers:", r.desktop.replace(/^\{\n|\n\}$/g, ""), "agent-desktop");
      copyBox("Claude Code", "", r.code, "agent-code-line");
      out.appendChild(el("p", "small", "Cursor: the same lines in .cursor/mcp.json. The key is a password for your TV: keep it to yourself."));
      pair.hidden = true;
    }
    code.addEventListener("click", function () {
      var sec = sheets["live-agent"];
      api("/api/live/agent-tv-code").then(function () { say(sec, "Look at the TV for 6 numbers."); pin.focus(); }, function (e) { say(sec, e.message); });
    });
    go.addEventListener("click", function () {
      var sec = sheets["live-agent"];
      lock(sec, true);
      api("/api/live/agent-tv-pair", { pin: pin.value }).then(function (r) { pin.value = ""; draw(r); say(sec, "Paired. Copy the lines into your AI app."); },
        function (e) { say(sec, e.message); }).then(function () { lock(sec, false); });
    });
    return function () {
      var sec = sheets["live-agent"];
      out.textContent = ""; say(sec, "");
      api("/api/live/agent-helper").then(function (r) {
        if (r.helper) { draw(r); return; }
        pair.hidden = false;
        say(sec, info.ontv ? "" : "Add the phone remote first (it puts the Couch TV app on the TV), or turn on the Couch TV Helper.");
      }, function (e) { say(sec, e.message); });
    };
  }

  // ---------------- Apps on this TV ----------------
  function appsSheet() {
    var b = sheet("live-apps", "Apps on this TV", "");
    var lead = sheets["live-apps"].querySelector(".lead") || el("p", "lead");
    lead.id = "apps-lead";
    sheets["live-apps"].insertBefore(lead, b);
    var list = el("ul", "applist"); list.id = "apps-list";
    b.appendChild(list);
    b.appendChild(el("p", "small", "Only the app names leave this computer. Nothing on the TV changes."));
    var act = el("div", "actions");
    var send = button("primary", "Send to my account", "apps-send");
    var again = button(null, "Look again", "apps-again");
    act.appendChild(send); act.appendChild(again);
    b.appendChild(act);
    function look() {
      var sec = sheets["live-apps"];
      list.textContent = ""; say(sec, "Looking at " + tvName() + ".");
      return api("/api/live/apps").then(function (r) {
        lead.textContent = r.count + " apps found on " + tvName() + ". The editor shows these first, and dims apps this TV does not have.";
        r.apps.slice(0, 30).forEach(function (a) { var li = el("li"); li.appendChild(el("i", null, a.name.charAt(0))); li.appendChild(document.createTextNode(a.name)); li.title = a.pkg; list.appendChild(li); });
        if (r.apps.length > 30) list.appendChild(el("li", null, "and " + (r.apps.length - 30) + " more"));
        say(sec, "");
        send.disabled = !info.linked || !r.count;
        if (!info.linked) say(sec, "Link this TV to your account first, then send them.");
      }, function (e) { say(sec, e.message); });
    }
    again.addEventListener("click", look);
    send.addEventListener("click", function () {
      var sec = sheets["live-apps"];
      lock(sec, true);
      api("/api/live/apps-send").then(function () { say(sec, "Sent. Open the editor: your apps show as On " + tvName() + "."); },
        function (e) { say(sec, e.message); }).then(function () { lock(sec, false); });
    });
    return look;
  }

  // ---------------- Live from this TV ----------------
  function watchSheet() {
    var b = sheet("live-watch", "Live from this TV", "These widgets show what is on the go. This is what they read on this TV, checked just now.");
    var rows = el("div", "live-rows"); rows.id = "watch-rows";
    b.appendChild(rows);
    var act = el("div", "actions");
    var again = button(null, "Check again", "watch-again");
    var remote = button("primary", "Turn on Now playing", "watch-music"); remote.hidden = true;
    act.appendChild(remote); act.appendChild(again);
    b.appendChild(act);
    b.appendChild(el("p", "small", "The show titles found stay on this page. Nothing is sent anywhere."));
    function row(title, sub, pill, cls) {
      var r = el("div", "live-row"), left = el("div");
      left.appendChild(el("h3", null, title)); left.appendChild(el("p", null, sub));
      r.appendChild(left); r.appendChild(el("span", "pill " + cls, pill));
      rows.appendChild(r);
    }
    function look() {
      var sec = sheets["live-watch"];
      rows.textContent = ""; say(sec, "Looking at " + tvName() + ".");
      return api("/api/live/watch").then(function (s) {
        var shows = s.keep.shows.map(function (x) { return x.title + " (" + x.app + ")"; }).join(", ");
        row("Keep watching, Keep watching row, Up next",
          s.keep.count ? s.keep.count + " on the go now: " + shows + "." : "Nothing on the go yet. Shows you start in Netflix, YouTube and most apps show here.",
          s.keep.ok ? "From the TV" : "Not shared", s.keep.ok ? "ok" : "warn");
        row("Picks for you", "Made on the TV from everyone's Keep watching. Add people in your account.", "From the TV", "ok");
        var np = s.now.playing ? "Playing now: " + (s.now.playing.title || "something") + " (" + s.now.playing.app + ")." : "Nothing playing now.";
        row("Now playing", (s.now.any_app ? "Any music app on this TV. " : "Off until you turn it on here. It lets Couch TV see the song playing in any music app. ") + np,
          s.now.any_app ? "On" : "Off", s.now.any_app ? "ok" : "warn");
        row("Plex and your imported history", "Need the Couch TV Helper on a computer that stays on.", s.helper ? "Helper on" : "Needs the Helper", s.helper ? "ok" : "dim");
        remote.hidden = !!s.now.any_app;
        say(sec, "");
      }, function (e) { say(sec, e.message); });
    }
    again.addEventListener("click", look);
    remote.addEventListener("click", function () {
      var sec = sheets["live-watch"];
      lock(sec, true);
      api("/api/live/music-on").then(function (r) { return look().then(function () { say(sec, r.now ? "Now playing is on. Play a song: it shows on the TV." : "Now playing is on. Press Home on the TV, then play a song."); }); },
        function (e) { say(sec, e.message); }).then(function () { lock(sec, false); });
    });
    return look;
  }

  var openers = {};
  function open(step) {
    api("/api/live/state").then(function (s) { info = s; show(step); openers[step](); }, function (e) {
      var t = document.getElementById("error-text"); if (t) { t.textContent = e.message; document.getElementById("error").hidden = false; }
    });
  }

  function tool(step, small, big, id) {
    var t = button("tool", null, id);
    var s = el("span"); s.appendChild(el("small", null, small)); s.appendChild(el("b", null, big));
    t.appendChild(s);
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), use = document.createElementNS(ns, "use");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); use.setAttribute("href", "#arrow"); svg.appendChild(use);
    t.appendChild(svg);
    t.addEventListener("click", function () { open(step); });
    return t;
  }

  function build() {
    var tools = document.querySelector('section[data-step="done"] .tools');
    if (!tools || document.getElementById("live-ask-go")) return;
    openers["live-ask"] = askSheet();
    openers["live-agent"] = agentSheet();
    openers["live-apps"] = appsSheet();
    openers["live-watch"] = watchSheet();
    tools.appendChild(tool("live-ask", "Questions answered on the TV", "Set up Ask AI", "live-ask-go"));
    tools.appendChild(tool("live-agent", "Claude, ChatGPT or Cursor", "Connect your own AI", "live-agent-go"));
    tools.appendChild(tool("live-apps", "For the app picker in the editor", "Apps on this TV", "live-apps-go"));
    tools.appendChild(tool("live-watch", "Keep watching and Now playing", "Live from this TV", "live-watch-go"));
    // the two that read the TV go when the TV connection does (Switch debugging off hides its own TV cards the same way)
    var dbg = document.getElementById("debug-off");
    if (dbg) {
      var mirror = function () { ["live-apps-go", "live-watch-go"].forEach(function (id) { document.getElementById(id).hidden = dbg.hidden; }); };
      new MutationObserver(mirror).observe(dbg, { attributes: true, attributeFilter: ["hidden"] });
      mirror();
    }
  }

  window.CouchLive = { open: open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
