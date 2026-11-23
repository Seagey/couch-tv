// Ask AI on the TV, and messages and designs from the person's own AI agent (docs/ASK-AI.md,
// docs/AI-AGENT.md). Two widgets and one sheet:
//
//   ask    "Ask AI": the last question and its answer, on the TV. OK opens the Ask sheet: type or say a
//          question (the microphone on the TV's keyboard, or the phone remote's Ask and its microphone)
//          and the answer shows on the TV.
//   agent  "From your AI": the last message the person's own AI agent sent to the TV.
//
// Who answers is the person's own choice, never couch-tv's and never couch-tv's money:
//   - their own AI service with their own key, kept on this TV only (Claude, OpenAI, Google Gemini,
//     OpenRouter, Groq, Mistral, any OpenAI compatible service, or a model on a computer at home such as
//     Ollama or LM Studio). The TV asks the service itself; nothing passes through couch-tv or Studio.
//   - or the couch-tv computer at home (Claude Code on their own Claude plan, bridge/claude.py) or the
//     couch-tv TV app (their key, saved on its setup page), through this home's own /api/ask.
//
// An agent the person connects (bridge/mcp_server.py tools, or POST /api/say/message and
// /api/say/design with the pairing key) reaches the TV through the home computer or the couch-tv TV
// app; the TV reads GET /api/say every few seconds. A design code from an agent is fetched by the TV
// exactly as a typed code is (design-code.js) and the TV asks "Use this design?" first, always.
//
// The key: only ever sent to the exact address it was saved with (scheme, host and port). Changing the
// address without typing a new key deletes it. On a Google TV, Android TV or Fire TV it is kept in the
// launcher's private store, left out of Android's backups (TVOS.keepPrivate, AtHome.kt); on other TVs
// in this TV's own browser storage. Never in a design, never in a share, never sent to Couch TV Studio.
//
// ES5 on purpose: old Android TV WebViews. Also a CommonJS module for tests.
(function (root) {
  "use strict";

  var W = typeof window !== "undefined" ? window : {};
  var DOC = typeof document !== "undefined" ? document : null;
  var Q = (W.location && W.location.search) || "";

  // ---------------- the services ----------------
  // wire: "anthropic" (the Messages API) or "openai" (chat completions, which covers the rest)
  var PROVIDERS = [
    { id: "anthropic", name: "Claude (Anthropic)", wire: "anthropic", base: "https://api.anthropic.com", model: "claude-haiku-5-5", key: true,
      where: "console.anthropic.com, API keys" },
    { id: "openai", name: "OpenAI (ChatGPT)", wire: "openai", base: "https://api.openai.com/v1", model: "", key: true, where: "platform.openai.com, API keys" },
    { id: "gemini", name: "Google Gemini", wire: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", key: true, where: "aistudio.google.com, Get API key" },
    { id: "openrouter", name: "OpenRouter", wire: "openai", base: "https://openrouter.ai/api/v1", model: "", key: true, where: "openrouter.ai, Keys" },
    { id: "groq", name: "Groq", wire: "openai", base: "https://api.groq.com/openai/v1", model: "", key: true, where: "console.groq.com, API keys" },
    { id: "mistral", name: "Mistral", wire: "openai", base: "https://api.mistral.ai/v1", model: "", key: true, where: "console.mistral.ai, API keys" },
    { id: "local", name: "A model at home (Ollama, LM Studio)", wire: "openai", base: "", model: "", key: false,
      where: "Ollama: start it with OLLAMA_ORIGINS=* so the TV may ask it. LM Studio: Developer, switch on Enable CORS and Serve on local network." },
    { id: "other", name: "Another service (OpenAI compatible)", wire: "openai", base: "", model: "", key: true, where: "The address it gives you, ending in /v1" }
  ];
  function provider(id) { for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i]; return null; }

  var SYSTEM = "You answer questions asked out loud in a living room. Your answer is shown in large words on a TV across the room. " +
    "Answer in plain words, in at most three short sentences. No markdown, no lists, no headings and no links. If you do not know, say so.";

  // ---------------- addresses: the same rules as the TV app (on-tv AskWire.kt) ----------------
  function hostOf(url) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(String(url || "")); return m ? m[1].toLowerCase() : ""; }
  function bareHost(h) { h = String(h || "").toLowerCase(); if (h.charAt(0) === "[") return h.slice(1, h.indexOf("]")); return h.replace(/:\d+$/, ""); }
  function isLocalHost(h) {
    h = bareHost(h);
    if (!h) return false;
    if (h === "localhost" || h === "::1" || /\.(local|lan|home\.arpa)$/.test(h)) return true;
    var p = h.split(".");
    if (p.length !== 4 || !p.every(function (x) { return /^\d{1,3}$/.test(x) && +x <= 255; })) return false;
    var a = +p[0], b = +p[1];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  // the TV itself: its own services are not an AI service
  function isThisDevice(h) { h = bareHost(h); return h === "localhost" || h === "::1" || h === "0.0.0.0" || /^127\./.test(h) || h === "[::]" || h === "::"; }
  // "" when the address may be used, else one plain sentence why not
  function baseProblem(url) {
    url = String(url || "").trim();
    if (!url) return "Type the service's web address.";
    if (url.length > 200) return "That address is too long.";
    var m = /^(https?):\/\/([^\/?#\s]+)(\/[^?#\s]*)?$/i.exec(url);
    if (!m) return "That is not a web address that ends at its path (no ? or #).";
    if (m[2].indexOf("@") >= 0) return "No name or password inside the address.";
    if (isThisDevice(m[2])) return "That address is this TV itself. Use the address of the computer that runs the model.";
    if (m[1].toLowerCase() === "http" && !isLocalHost(m[2])) return "Use https://. Plain http:// is only for a computer on your own network.";
    return "";
  }
  function originOf(url) { var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(url || "")); return m ? m[1].toLowerCase() : ""; }

  // ---------------- what is saved on this TV ----------------
  var CFG_KEY = "couchtv.ask", SECRET_KEY = "couchtv.ask.key", LAST_KEY = "couchtv.ask.last", SEEN_KEY = "couchtv.say.seen";
  var mem = {};
  function nat() { return W.TVOS || null; }
  function getItem(k, secret) {
    var T = nat();
    try { if (T && secret && T.keptPrivate) return T.keptPrivate(k); } catch (e) {}
    try { if (W.localStorage) return W.localStorage.getItem(k); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
  }
  function setItem(k, v, secret) {
    var T = nat();
    if (T && secret && T.keepPrivate) { try { T.keepPrivate(k, v === null ? "" : v); return; } catch (e) {} }
    try { if (W.localStorage) { if (v === null) W.localStorage.removeItem(k); else W.localStorage.setItem(k, v); return; } } catch (e) {}
    if (v === null) delete mem[k]; else mem[k] = v;
  }
  function readJson(k) { try { return JSON.parse(getItem(k) || "null"); } catch (e) { return null; } }
  function config() {
    var c = readJson(CFG_KEY) || {};
    var p = provider(c.provider);
    return { route: c.route === "home" ? "home" : c.route === "own" ? "own" : "", provider: p ? p.id : "", base: String(c.base || (p && p.base) || ""),
      model: String(c.model || (p && p.model) || ""), keyOrigin: String(c.keyOrigin || "") };
  }
  // the key, only while the address is still the one it was saved for
  function keyFor(c) {
    var k = getItem(SECRET_KEY, true) || "";
    return k && c.keyOrigin && c.keyOrigin === originOf(c.base) ? k : "";
  }
  // save a change; a new address without a new key deletes the old key
  function save(change) {
    var c = config(), p;
    if (change.route !== undefined) c.route = change.route;
    if (change.provider !== undefined && change.provider !== c.provider) {
      p = provider(change.provider);
      c.provider = p ? p.id : "";
      c.base = p ? p.base : "";
      c.model = p ? p.model : "";
    }
    if (change.base !== undefined) c.base = String(change.base).trim().replace(/\/+$/, "");
    if (change.model !== undefined) c.model = String(change.model).trim().slice(0, 120);
    if (change.key !== undefined) {
      var k = String(change.key).replace(/\s+/g, "");
      if (k) { setItem(SECRET_KEY, k, true); c.keyOrigin = originOf(c.base); }
      else { setItem(SECRET_KEY, null, true); c.keyOrigin = ""; }
    } else if (c.keyOrigin && c.keyOrigin !== originOf(c.base)) { setItem(SECRET_KEY, null, true); c.keyOrigin = ""; }
    setItem(CFG_KEY, JSON.stringify({ route: c.route, provider: c.provider, base: c.base, model: c.model, keyOrigin: c.keyOrigin }));
    return status();
  }
  function forget() { setItem(SECRET_KEY, null, true); setItem(CFG_KEY, null); return status(); }

  // ---------------- this home's own couch-tv (the computer at home or the TV app) ----------------
  function home() {
    var standalone = !!W.COUCH_STANDALONE, offline = standalone || /[?&]offline=1/.test(Q), mock = /[?&]mock\b/.test(Q);
    var api = decodeURIComponent((Q.match(/[?&]api=([^&]+)/) || [])[1] || "");
    var key = decodeURIComponent((Q.match(/[?&]key=([^&]+)/) || [])[1] || "") || (W.COUCH_WEBOS || W.COUCH_TIZEN || W.COUCH_SETTINGS || {}).key || "";
    if (!key) { try { key = W.localStorage.getItem("couchtv.key") || ""; } catch (e) {} }
    var tv = (Q.match(/[?&]tv=([a-z-]+)/) || [])[1] || "";
    return { on: !offline && !mock && !!W.XMLHttpRequest, api: api, key: key, tv: tv };
  }

  // the Google Play build of the on-TV app has no Ask AI (window.TVPLAY.askOff, HomeActivity.kt,
  // coord/GOOGLE-PLAY-BUILD.md): no Ask sheet, and an Ask AI widget in a design says it is not here
  function off() { try { return !!(W.TVPLAY && typeof W.TVPLAY.askOff === "function" && W.TVPLAY.askOff()); } catch (e) { return false; } }

  // what is set up, in plain words (never the key)
  function status() {
    var c = config(), p = provider(c.provider), h = home(), key = keyFor(c);
    var own = !!(p && c.model && !baseProblem(c.base) && (key || !p.key || (p.wire === "openai" && isLocalHost(hostOf(c.base)))));
    var route = c.route === "home" && h.on ? "home" : own ? "own" : h.on && c.route !== "own" ? "home" : "";
    return { ready: !!route, route: route, own: own, homeAvailable: h.on, provider: p ? p.id : "", providerName: p ? p.name : "",
      base: c.base, model: c.model, hasKey: !!key, needsKey: !!(p && p.key && !(p.wire === "openai" && isLocalHost(hostOf(c.base)))),
      by: route === "home" ? "Your Couch TV at home" : p ? p.name + (c.model ? ", " + c.model : "") : "" };
  }

  // ---------------- one request to a service ----------------
  // { url, headers, body } for a question (built here so tests can check it without a network)
  function request(c, key, text) {
    var p = provider(c.provider) || provider("other");
    if (p.wire === "anthropic") {
      return { url: c.base.replace(/\/+$/, "") + "/v1/messages",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: { model: c.model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: text }] } };
    }
    var h = { "content-type": "application/json" };
    if (key) h.authorization = "Bearer " + key;
    return { url: c.base.replace(/\/+$/, "") + "/chat/completions", headers: h,
      body: { model: c.model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }] } };
  }
  // the words of an answer, or null when it is not in the expected shape
  function answerOf(wire, j) {
    if (!j || typeof j !== "object") return null;
    if (wire === "anthropic") {
      var parts = (j.content || []).filter(function (x) { return x && x.type === "text" && typeof x.text === "string"; }).map(function (x) { return x.text; });
      return parts.length ? parts.join("\n").trim() : null;
    }
    var ch = j.choices && j.choices[0], m = ch && ch.message, t = m && m.content;
    if (typeof t === "string") return t.trim();
    if (t && t.length) return t.map(function (x) { return x && typeof x.text === "string" ? x.text : ""; }).join("").trim() || null;
    return null;
  }
  // plain words on a TV: no markdown marks, no links
  function plain(s, limit) {
    s = String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>]+/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return limit && s.length > limit ? s.slice(0, limit - 3).replace(/\s+\S*$/, "") + "..." : s;
  }
  // the service's own error sentence, cut to 200 characters, never anything else it sent
  function errorOf(status, raw) {
    var msg = "";
    try { var j = JSON.parse(raw); msg = (j && j.error && (typeof j.error === "string" ? j.error : j.error.message)) || (j && j.message) || ""; } catch (e) {}
    msg = typeof msg === "string" ? plain(msg, 200) : "";
    if (status === 401 || status === 403) return "The service refused the key" + (msg ? ": " + msg : ". Check it in Ask AI, Set up.");
    if (status === 404) return "The service does not know that model or address" + (msg ? ": " + msg : ". Check the model name in Ask AI, Set up.");
    if (status === 429) return "The service says too many questions, or no credit left" + (msg ? ": " + msg : ".");
    return msg ? "The service said: " + msg : "The service could not answer just now (" + status + ").";
  }
  function xhr(method, url, headers, body, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new W.XMLHttpRequest();
      x.open(method, url);
      x.timeout = timeout || 60000;
      Object.keys(headers || {}).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
      x.onload = function () { resolve({ status: x.status, text: x.responseText || "" }); };
      x.onerror = function () { reject(new Error("offline")); };
      x.ontimeout = function () { reject(new Error("slow")); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  // ---------------- asking ----------------
  var last = readJson(LAST_KEY), message = null, listeners = [];
  function changed() {
    try { setItem(LAST_KEY, last ? JSON.stringify(last) : null); } catch (e) {}
    try { if (W.CouchDesign && W.CouchDesign.dataChanged) { W.CouchDesign.dataChanged("ask", [last && last.at, last && last.pending, message && message.id]); } } catch (e) {}
    listeners.forEach(function (f) { try { f(); } catch (e) {} });
  }
  function ask(text, opts) {
    text = plain(text, 500);
    opts = opts || {};
    if (!text) return Promise.reject(new Error("Type or say a question first."));
    var s = status();
    if (!s.ready) return Promise.reject(new Error("Ask AI is not set up yet on this TV. Pick Set up."));
    var mine = { q: text, a: "", by: s.by, at: Date.now(), pending: true };
    last = mine; changed();
    var job;
    if (s.route === "home") {
      var h = home(), hd = { "Content-Type": "application/json" };
      if (h.key) hd.Authorization = "Bearer " + h.key;
      var b = { text: text };
      if (h.tv) b.tv = h.tv;
      job = xhr("POST", h.api + "/api/ask", hd, b, 95000).then(function (r) {
        var j = null; try { j = JSON.parse(r.text); } catch (e) {}
        if (r.status >= 200 && r.status < 300 && j && j.ok !== false) return plain(j.say || j.reply || "Done.", 1200);
        if (r.status === 409) throw new Error("The home computer's Claude ask is switched off (ask.enabled in config.json). Pick Set up to use your own AI service instead.");
        if (r.status === 501) throw new Error("Ask is off in the Couch TV app on this TV. Add your key on its setup page, or pick Set up to use your own AI service here.");
        if (r.status === 403) throw new Error("Ask is off for a kids profile.");
        throw new Error(plain((j && j.error) || "Couch TV at home could not answer just now.", 200));
      }, function () { throw new Error("Couch TV at home did not answer. Is the computer or the TV app on?"); });
    } else {
      var c = config(), rq = request(c, keyFor(c), text), wire = (provider(c.provider) || {}).wire;
      job = xhr("POST", rq.url, rq.headers, rq.body, 60000).then(function (r) {
        if (r.status < 200 || r.status >= 300) throw new Error(errorOf(r.status, r.text));
        var j = null; try { j = JSON.parse(r.text); } catch (e) {}
        var a = answerOf(wire, j);
        if (a === null) throw new Error("The service answered in a way Couch TV does not understand. Check the model name.");
        return plain(a, 1200) || "(no words in the answer)";
      }, function (e) {
        var local = isLocalHost(hostOf(c.base));
        throw new Error(e && e.message === "slow" ? "The service took too long to answer." : local
          ? "The model at home did not answer. Is that computer on, and does it allow the TV to ask (Ollama: OLLAMA_ORIGINS=*)?"
          : "The TV could not reach the service. Is the TV online?");
      });
    }
    return job.then(function (a) {
      if (last === mine) { mine.a = a; mine.pending = false; mine.at = Date.now(); changed(); }
      return mine;
    }, function (e) {
      if (last === mine) { mine.a = ""; mine.err = (e && e.message) || "That did not work."; mine.pending = false; changed(); }
      throw e;
    });
  }

  // ---------------- what the home computer or the TV app says (GET /api/say) ----------------
  var seen = readJson(SEEN_KEY) || { msg: 0, design: 0 }, pollT = null, firstPoll = true;
  function markSeen() { setItem(SEEN_KEY, JSON.stringify(seen)); }
  // Who asks: a home that can get designs (a design store set, the usual case) asks every 6 s so a design
  // sent from the phone shows at once; otherwise only once Ask AI is set up on this TV, while the Ask
  // sheet is open, or while an Ask AI or From your AI widget is on the home. ?home=1 tells the home
  // computer or the TV app it is the home asking (say.py heard), so the phone remote can say whether
  // the TV will see a design now.
  function wanted() {
    var c = readJson(CFG_KEY);
    if (c && (c.route || c.provider)) return true;
    if (sheet) return true;
    // a TV that can get designs listens for one sent from the phone remote (Send a design), so a
    // design chosen on the phone needs no presses on the TV but the "Use this design?" answer
    if (W.CouchDesignCode && W.CouchDesignCode.base && W.CouchDesignCode.base()) return true;
    try { return !!(DOC && DOC.querySelector && DOC.querySelector(".cw-k-ask, .cw-k-agent")); } catch (e) { return false; }
  }
  // force: the slow look every 30 s while the home is on screen, even with nothing set up, so the phone
  // remote's Scene buttons (g34) reach a TV with no design store and no Ask AI within half a minute
  function poll(force) {
    var h = home();
    if (!h.on || !(force || wanted())) return;
    var hd = {}; if (h.key) hd.Authorization = "Bearer " + h.key;
    xhr("GET", h.api + "/api/say?home=1" + (h.tv ? "&tv=" + h.tv : ""), hd, null, 8000).then(function (r) {
      var j = null; try { j = JSON.parse(r.text); } catch (e) {}
      if (!j || j.ok === false) return;
      took(j, Date.now());
    }, function () {});
  }
  // one answer from /api/say; now is the TV's clock (exported for tests)
  function took(j, now) {
    var a = j.ask;
    if (a && a.q && (!last || (a.at || 0) > (last.at || 0) + 500 || (last.pending && plain(a.q) === last.q && !a.pending && a.a))) {
      if (!(last && last.pending && !a.a)) { last = { q: plain(a.q, 400), a: plain(a.a, 1200), by: String(a.by || "Your Couch TV at home"), at: a.at || now, pending: !!a.pending }; changed(); }
    }
    var m = j.message;
    if (m && m.text && (m.at || 0) > (seen.msg || 0)) {
      seen.msg = m.at || now; markSeen();
      message = { id: m.at, text: plain(m.text, 280), from: plain(m.from || "Your AI", 24), at: m.at || now, seconds: Math.max(5, Math.min(600, +m.seconds || 30)) };
      changed();
      // a message sent long before this page started is not popped up again
      if (!firstPoll || now - message.at < 120000) banner(message);
    }
    var d = j.design;
    if (d && d.code && (d.at || 0) > (seen.design || 0)) {
      seen.design = d.at || now; markSeen();
      if (now - (d.at || now) < 600000) useDesign(d.code, d.from === "phone" ? "phone" : "ai");
    }
    // the phone remote's Scene buttons (g34): the next or the previous scene, if it was pressed in the last minute
    var sc = j.scene;
    if (sc && (sc.pick === "next" || sc.pick === "prev") && (sc.at || 0) > (seen.scene || 0)) {
      seen.scene = sc.at || now; markSeen();
      if (now - (sc.at || now) < 60000 && W.tv && W.tv.scene) W.tv.scene(sc.pick);
    }
    firstPoll = false;
  }
  // Couch TV Studio is opt in: an agent's design is used only where the person at this TV turned couch-tv
  // Studio on and designs are not switched off. An agent never turns it on, and never clears an off.
  function studioOff() {
    var v = null, off = null;
    // read as app.js kept() does: the launcher's own store first, then the page's
    try { var raw = nat() && nat().kept ? nat().kept("tvhome.designer") : null; if (raw == null) raw = W.localStorage.getItem("tvhome.designer"); v = JSON.parse(raw || "null"); } catch (e) {}
    try { off = W.localStorage.getItem("couchtv.design.off"); } catch (e) {}
    return v !== "on" || !!off;
  }
  // who: "phone" (the phone remote's Send a design) or "ai" (the person's own AI agent)
  function useDesign(code, who) {
    var C = W.CouchDesignCode, by = who === "phone" ? "your phone" : "your AI";
    if (!C || !C.get || !C.readCode(code)) { banner({ from: "Couch TV", text: "A design was sent, but this TV cannot get designs. Update Couch TV.", seconds: 15 }); return; }
    if (studioOff()) { banner({ from: "Couch TV", text: "A design came from " + by + ". Designs are switched off on this TV, so it was not used. To use designs, turn them on in Home settings, Designs.", seconds: 20 }); return; }
    banner({ from: "Couch TV", text: "Getting the design from " + by + "...", seconds: 20 });
    C.get(code).then(function () {
      // "Use this design?" comes first, as for a code typed at the TV; this TV's on or off choice is left as it is
      setTimeout(function () { try { W.location.reload(); } catch (e) {} }, 800);
    }, function (e) { banner({ from: "Couch TV", text: (e && e.message) || "That design could not be used.", seconds: 15 }); });
  }
  function startPolling() {
    if (pollT || !home().on) return;
    poll();
    var ticks = 0;
    pollT = setInterval(function () { ticks++; if (!DOC || !DOC.hidden) poll(ticks % 5 === 0); }, 6000);
  }

  // ---------------- a message over the home ----------------
  var bannerEl = null, bannerT = null;
  function banner(m) {
    if (!DOC || !DOC.body) return;
    if (!bannerEl) {
      bannerEl = DOC.createElement("div");
      bannerEl.className = "cask-banner";
      bannerEl.setAttribute("role", "status");
      DOC.body.appendChild(bannerEl);
    }
    while (bannerEl.firstChild) bannerEl.removeChild(bannerEl.firstChild);
    var f = DOC.createElement("b"); f.textContent = m.from || "Your AI";
    var t = DOC.createElement("span"); t.textContent = m.text;
    bannerEl.appendChild(f); bannerEl.appendChild(t);
    bannerEl.classList.add("on");
    clearTimeout(bannerT);
    bannerT = setTimeout(function () { bannerEl.classList.remove("on"); }, (m.seconds || 30) * 1000);
  }

  // ---------------- the widgets ----------------
  function kit() { return W.CouchWidgets && W.CouchWidgets.kit; }
  var DEMO_ASK = { q: "How far away is the moon?", a: "About 384,000 kilometres. Light from it takes just over a second to reach us.", by: "Claude (Anthropic)", at: 0 };
  var DEMO_MSG = { from: "Claude", text: "Your new autumn design is on its way. Press OK on the TV when it asks." };
  // the largest size from max down to 23 px at which the words fit whole in w x h (Inter, about 0.56 em a
  // letter, 1.2 lines); at 23 px the words are cut at a word and end in "..." so nothing spills over
  function fitWords(text, w, h, max) {
    text = String(text || "");
    var cap = function (fs) { var per = Math.max(1, Math.floor(w / (fs * 0.58))), rows = Math.max(1, Math.floor(h / (fs * 1.22))); return Math.floor(per * rows * 0.82); };
    for (var fs = max; fs > 23; fs--) if (cap(fs) >= text.length) return { fs: fs, text: text };
    var room = cap(23);
    return { fs: 23, text: text.length <= room ? text : text.slice(0, Math.max(1, room - 3)).replace(/\s+\S*$/, "") + "..." };
  }
  // centred unless the design says left or right (the same group as widgets.js ahCol and ahLab)
  var FLEX = { left: "flex-start", center: "center", right: "flex-end" };
  function col(K, o, root, kids) {
    var a = (o && o.opts && o.opts.align) || "";
    a = a === "left" || a === "right" ? a : "center";
    if (root) { root.classList.add("cw-ah"); root.setAttribute("data-align", a); }
    return K.E("div", "cw-col cw-ahcol", "width:100%;height:100%;min-height:0;justify-content:center;align-items:" + FLEX[a] + ";text-align:" + a, kids);
  }
  function labelRow(K, iconName, text) {
    return K.E("div", "cw-lab", "max-width:100%;flex:none", [K.ic(iconName, 30, "currentColor"), K.E("span", "cw-ell", "flex:0 1 auto;min-width:0;margin-right:0", [text])]);
  }
  // the question over its answer: up to two lines, wrapping (a question longer than that is shortened
  // at a word, never cut mid line); rows says how many lines it takes
  function askRow(K, text, w) {
    var f = fitWords(text, w - 40, 2 * 25 * 1.22, 25), per = Math.max(1, Math.floor((w - 40) / (f.fs * 0.58)));
    return { rows: f.text.length > per * 0.82 ? 2 : 1, el: K.E("div", "cw-lab", "max-width:100%;flex:none;white-space:normal;overflow:visible;text-overflow:clip;align-items:flex-start", [K.ic("mic", 30, "currentColor"),
      K.E("span", "", "flex:0 1 auto;min-width:0;margin-right:0;font-size:" + f.fs + "px;line-height:1.22;overflow-wrap:break-word", [f.text])]) };
  }
  // the empty card, at the side the design picks (widgets.js empty() is always in the middle)
  function blank(K, root, o, b, iconName, line, sub) {
    var a = o && o.opts && o.opts.align;
    if (a !== "left" && a !== "right") return K.empty(root, b, iconName, line, sub);
    root.classList.add("cw-empty"); root.setAttribute("data-empty", "1");
    K.add(root, col(K, o, root, [K.ic(iconName, 40, "currentColor"), K.E("div", "cw-e1", "max-width:100%", [line]), sub && b.h >= 220 && b.w >= 300 ? K.E("div", "cw-e2", "max-width:100%", [sub]) : null]));
    return root;
  }
  // this widget's own settings (widget-caps.js ask and agent): keep says how long the last answer or
  // message shows ("always" until the next, "hour", "day", or "never": the question stays private)
  function own(K, o, env, key, dflt) { var v = K.setting ? K.setting(o, env || {}, key) : undefined; return v === undefined || v === null || v === "" ? dflt : v; }
  var KEEP_MS = { hour: 3600000, day: 86400000 };
  function kept(K, o, env, at) {
    var k = own(K, o, env, "keep", "always");
    if (k === "never") return false;
    return !KEEP_MS[k] || !at || Date.now() - at < KEEP_MS[k];
  }
  function drawAsk(root, o, b, env) {
    var K = kit(); if (!K) return root;
    if (off() && !(env && env.demo)) return blank(K, root, o, b, "mic", "Ask AI", "Not in this version of Couch TV");
    var v = env && env.demo ? DEMO_ASK : last, s = status(), tiny = b.w < 300 || b.h < 220;
    if (v && !(env && env.demo) && !v.pending && !kept(K, o, env, v.at)) v = null;
    if (!(env && env.demo) && !s.ready) return blank(K, root, o, b, "mic", tiny ? "Set up Ask AI" : "Ask AI: pick who answers", "OK here sets it up, step by step");
    if (!v || !v.q) return blank(K, root, o, b, "mic", tiny ? "Ask AI" : "Ask anything", "Press OK, then type or say it. Or use Ask on the phone remote");
    var a = v.pending ? "Thinking..." : v.err ? v.err : v.a, w = b.w - 48, by = b.h >= 300, qr = askRow(K, v.q, w), h = b.h - 48 - 40 - (qr.rows - 1) * 31 - 12 - (by ? 44 : 0);
    if (b.w < 300) { var f0 = fitWords(a, w, b.h - 48, 34); K.add(root, col(K, o, root, [K.E("div", "", "font-size:" + f0.fs + "px;font-weight:650;line-height:1.2", [f0.text])])); return root; }
    var f = fitWords(a, w, h, 64);
    K.add(root, col(K, o, root, [qr.el,
      K.E("div", "", "max-width:100%;font-size:" + f.fs + "px;font-weight:680;line-height:1.2;margin-top:12px;letter-spacing:-.01em;overflow-wrap:break-word", [f.text]),
      by ? K.E("div", "cw-t23 cw-ell", "max-width:100%;margin-top:14px;color:var(--sub)", [v.pending ? "Asking " + (v.by || "your AI") : "Answered by " + (v.by || "your AI")]) : null]));
    return root;
  }
  function drawAgent(root, o, b, env) {
    var K = kit(); if (!K) return root;
    var m = env && env.demo ? DEMO_MSG : message, tiny = b.w < 300 || b.h < 220;
    if (m && !(env && env.demo) && !kept(K, o, env, m.at)) m = null;
    if (!m) {
      if (!home().on) return blank(K, root, o, b, "phone", tiny ? "Connect your AI" : "Connect your AI agent", "It needs the Couch TV app on this TV or a home computer. OK here shows how");
      return blank(K, root, o, b, "phone", tiny ? "No messages yet" : "Nothing from your AI yet", "OK here shows how to connect it");
    }
    var w = b.w - 48;
    if (b.w < 300) { var f0 = fitWords(m.text, w, b.h - 48, 34); K.add(root, col(K, o, root, [K.E("div", "", "font-size:" + f0.fs + "px;font-weight:650;line-height:1.2", [f0.text])])); return root; }
    var f = fitWords(m.text, w, b.h - 48 - 40 - 10, 60);
    K.add(root, col(K, o, root, [labelRow(K, "phone", own(K, o, env, "who", true) === false ? "From your AI" : "From " + m.from),
      K.E("div", "", "max-width:100%;font-size:" + f.fs + "px;font-weight:680;line-height:1.2;margin-top:10px;overflow-wrap:break-word", [f.text])]));
    return root;
  }

  // ---------------- the Ask sheet (typing, the answer and set up) ----------------
  var sheet = null;   // { el, stops: [{ el, ok, input }], cur, view }
  function E(tag, cls, text) { var e = DOC.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function stop(el, ok, input) { el.classList.add("cask-stop"); sheet.stops.push({ el: el, ok: ok || null, input: input || null }); return el; }
  function paint() {
    if (!sheet) return;
    sheet.stops.forEach(function (s, i) { s.el.classList.toggle("cask-f", i === sheet.cur); });
    var f = sheet.stops[sheet.cur];
    if (f && f.el.scrollIntoView) { try { f.el.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }
  function body() { var b = sheet.el.querySelector(".cask-body"); while (b.firstChild) b.removeChild(b.firstChild); sheet.stops = []; sheet.cur = 0; return b; }
  function line(b, cls, text) { var e = E("div", cls, text); b.appendChild(e); return e; }
  function button(b, text, ok, sub) {
    var e = E("div", "cask-btn"); e.appendChild(E("b", "", text)); if (sub) e.appendChild(E("span", "", sub));
    b.appendChild(e); return stop(e, ok);
  }
  function field(b, label, value, submit, opts) {
    opts = opts || {};
    var wrap = E("label", "cask-field"); wrap.appendChild(E("span", "", label));
    var inp = E("input"); inp.type = opts.secret ? "password" : "text"; inp.value = value || "";
    inp.setAttribute("autocomplete", "off"); inp.setAttribute("autocorrect", "off"); inp.setAttribute("spellcheck", "false");
    inp.setAttribute("autocapitalize", opts.caps ? "sentences" : "off"); inp.setAttribute("enterkeyhint", opts.go || "done");
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    wrap.appendChild(inp); b.appendChild(wrap);
    stop(wrap, function () { try { inp.focus(); } catch (e) {} }, { el: inp, submit: submit });
    return inp;
  }
  function open(view) {
    if (!DOC || !DOC.body || off()) return false;
    if (W.CouchDetail && W.CouchDetail.isOpen && W.CouchDetail.isOpen()) W.CouchDetail.close(true);
    if (!sheet) {
      var el = E("div", "cask"), panel = E("div", "cask-panel");
      var top = E("div", "cask-top"); top.appendChild(E("b", "", "Ask AI")); top.appendChild(E("span", "cask-by", ""));
      panel.appendChild(top); panel.appendChild(E("div", "cask-body"));
      panel.appendChild(E("div", "cask-foot", "Back closes. Up and Down move. OK picks."));
      el.appendChild(panel); DOC.body.appendChild(el);
      sheet = { el: el, stops: [], cur: 0 };
      DOC.documentElement.classList.add("cask-open");
    }
    show(view || (status().ready ? "ask" : "setup"));
    return true;
  }
  function close() {
    if (!sheet) return false;
    try { var a = DOC.activeElement; if (a && a.blur) a.blur(); } catch (e) {}
    if (sheet.el.parentNode) sheet.el.parentNode.removeChild(sheet.el);
    sheet = null;
    DOC.documentElement.classList.remove("cask-open");
    return true;
  }
  function by() { var s = status(); sheet.el.querySelector(".cask-by").textContent = s.ready ? "Answered by " + s.by : "Not set up yet"; }
  function show(view, arg) {
    if (!sheet) return;
    sheet.view = view;
    var b = body(); by();
    if (view === "ask") viewAsk(b);
    else if (view === "setup") viewSetup(b);
    else if (view === "service") viewService(b, arg);
    paint();
  }
  function viewAsk(b) {
    var s = status();
    if (!s.ready) { viewSetup(b); return; }
    var v = last;
    var answer = E("div", "cask-answer");
    function draw() {
      while (answer.firstChild) answer.removeChild(answer.firstChild);
      if (!last) { answer.appendChild(E("div", "cask-hint", "Ask anything. Press OK on the box, then the microphone on the TV's keyboard, to say it. Or use Ask on the phone remote: its answer shows here too.")); return; }
      answer.appendChild(E("div", "cask-q", last.q));
      answer.appendChild(E("div", "cask-a" + (last.err ? " err" : ""), last.pending ? "Thinking..." : last.err || last.a));
    }
    draw();
    field(b, "Your question", "", function (text) { if (!text.trim()) return; ask(text).then(draw, draw); draw(); }, { caps: true, go: "send", placeholder: "Type or say it" });
    b.appendChild(answer);
    button(b, "Set up", function () { show("setup"); }, "Who answers: " + s.by);
    sheet.redraw = draw;
    void v;
  }
  function viewSetup(b) {
    var s = status(), h = home();
    line(b, "cask-h", "Who answers your questions?");
    line(b, "cask-p", "Pick one. Your key stays on this TV and is only ever sent to the service you pick. Couch TV never sees it and never pays for it.");
    if (h.on) button(b, "Couch TV at home" + (s.route === "home" ? "  (in use)" : ""), function () { save({ route: "home" }); show("setup"); },
      "The home computer's Claude on your own Claude plan, or the Couch TV app on this TV with the key on its setup page");
    PROVIDERS.forEach(function (p) {
      button(b, p.name + (s.route === "own" && s.provider === p.id ? "  (in use)" : s.provider === p.id ? "  (saved)" : ""), function () { show("service", p.id); }, p.key ? "Your own key" : "No key: a home computer runs it");
    });
    if (s.provider || s.route) button(b, "Remove Ask AI from this TV", function () { forget(); show("setup"); }, "Deletes the key and the choices kept on this TV");
  }
  function viewService(b, id) {
    var p = provider(id);
    if (config().provider !== id) save({ provider: id });
    var c = config();
    line(b, "cask-h", p.name);
    line(b, "cask-p", "1. " + (p.key ? "Make a key made only for this TV: " + p.where + ". Set a monthly spend limit there." : p.where));
    if (!p.base || id === "other" || id === "local") {
      field(b, "2. The web address" + (id === "local" ? " (for example http://my-computer.local:11434/v1)" : ""), c.base, function (v) {
        var why = baseProblem(v); if (why) { note(why); return; } save({ base: v }); show("service", id);
      }, { placeholder: "https://..." });
    }
    field(b, (p.base && id !== "other" && id !== "local" ? "2. " : "3. ") + "The model name" + (p.model ? " (" + p.model + " is the tested one)" : ""), c.model, function (v) { save({ model: v }); show("service", id); },
      { placeholder: p.model || "As the service names it" });
    if (p.key) field(b, "The key (with the phone remote: Type on the TV pastes it)", "", function (v) { save({ key: v }); show("service", id); }, { secret: true, placeholder: keyFor(c) ? "Saved. Type a new one to change it" : "Paste or type it" });
    var s = status();
    button(b, s.own ? "Use it and try it" : "Use it", function () {
      var why = baseProblem(config().base), st;
      if (why) { note(why); return; }
      if (!config().model) { note("Type the model name first."); return; }
      save({ route: "own" }); st = status();
      if (!st.own) { note(p.key ? "Type the key first." : "Check the address."); return; }
      note("Asking it to say hello...");
      ask("Say hello to the people on the couch in one short sentence.").then(function (r) { note("It works: " + r.a); }, function (e) { note(e.message); });
    }, s.own ? "Saved. OK sends one short test question" : "");
    button(b, "Back", function () { show("setup"); });
  }
  function note(text) {
    if (!sheet) return;
    var n = sheet.el.querySelector(".cask-note");
    if (!n) { n = E("div", "cask-note"); sheet.el.querySelector(".cask-panel").appendChild(n); }
    n.textContent = text;
  }

  // ---------------- keys while the sheet is open (before the home and design.js see them) ----------------
  function isBack(e) { return ["Escape", "Esc", "GoBack", "BrowserBack"].indexOf(e.key) >= 0 || e.keyCode === 27 || e.keyCode === 10009 || e.keyCode === 461 || e.keyCode === 4; }
  function dir(e) {
    var k = e.key, c = e.keyCode;
    if (k === "ArrowUp" || k === "Up" || c === 38 || c === 19) return -1;
    if (k === "ArrowDown" || k === "Down" || c === 40 || c === 20) return 1;
    if (k === "ArrowLeft" || k === "Left" || c === 37 || c === 21) return -1;
    if (k === "ArrowRight" || k === "Right" || c === 39 || c === 22) return 1;
    return 0;
  }
  // a box filled in: in the set up steps the remote moves on to the next step
  function submitted(inp, v) {
    var at = sheet.cur, view = sheet.view;
    inp.submit(v);
    if (sheet && view !== "ask" && sheet.view === view) { sheet.cur = Math.min(at + 1, sheet.stops.length - 1); paint(); }
  }
  function isOk(e) { return e.key === "Enter" || e.key === "Select" || e.keyCode === 13 || e.keyCode === 23; }
  function onKey(e) {
    if (!sheet) return;
    var s = sheet.stops[sheet.cur], inp = s && s.input && DOC.activeElement === s.input.el ? s.input : null;
    e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type !== "keydown") return;
    if (inp) {
      if (isOk(e)) { e.preventDefault(); var v = inp.el.value; inp.el.blur(); submitted(inp, v); return; }
      if (isBack(e)) { e.preventDefault(); inp.el.blur(); return; }
      var vert = e.key === "ArrowUp" || e.key === "ArrowDown" || e.keyCode === 38 || e.keyCode === 40 || e.keyCode === 19 || e.keyCode === 20;
      if (vert) { e.preventDefault(); inp.el.blur(); sheet.cur = Math.max(0, Math.min(sheet.stops.length - 1, sheet.cur + dir(e))); paint(); }
      return;   // letters, Backspace, Left and Right edit the words
    }
    e.preventDefault();
    if (isBack(e) || e.key === "Backspace" || e.keyCode === 8) { if (sheet.view === "service") show("setup"); else if (sheet.view === "setup" && status().ready) show("ask"); else close(); return; }
    var d = dir(e);
    if (d) { sheet.cur = Math.max(0, Math.min(sheet.stops.length - 1, sheet.cur + d)); paint(); return; }
    if (isOk(e) && !e.repeat && s && s.ok) s.ok();
  }
  if (W.addEventListener) { W.addEventListener("keydown", onKey, true); W.addEventListener("keyup", onKey, true); }

  // ---------------- hooking in ----------------
  function hook() {
    var CW = W.CouchWidgets;
    if (CW && CW.define) { CW.define("ask", drawAsk); CW.define("agent", drawAgent); }
    startPolling();
  }
  if (DOC) { if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", hook); else setTimeout(hook, 0); }

  var API = {
    providers: function () { return PROVIDERS.map(function (p) { return { id: p.id, name: p.name, base: p.base, model: p.model, key: p.key, where: p.where }; }); },
    status: status, save: save, forget: forget, ask: ask, open: open, close: close, isOpen: function () { return !!sheet; }, off: off,
    last: function () { return last; }, message: function () { return message; },
    on: function (f) { listeners.push(f); },
    // the home network address a model at home is asked on, for the design page policy (designer-gate.js)
    connectOrigin: function () { var c = config(), o = originOf(c.base); return c.provider === "local" && /^http:\/\//.test(o) && isLocalHost(hostOf(o)) && !isThisDevice(hostOf(o)) ? o : ""; },
    // for the setup sheet and tests
    current: function () { return sheet ? { view: sheet.view, stops: sheet.stops.length, focus: sheet.cur, text: sheet.el.textContent } : null; },
    // the Android apps' Back (app.js tv.back, never a key): what the Back key does here; false with no sheet
    back: function () {
      if (!sheet) return false;
      var s = sheet.stops[sheet.cur];
      if (s && s.input && DOC.activeElement === s.input.el) { s.input.el.blur(); return true; }
      if (sheet.view === "service") show("setup"); else if (sheet.view === "setup" && status().ready) show("ask"); else close();
      return true;
    },
    move: function (d) { if (!sheet) return false; sheet.cur = Math.max(0, Math.min(sheet.stops.length - 1, sheet.cur + d)); paint(); return true; },
    ok: function () { if (!sheet) return false; var s = sheet.stops[sheet.cur]; if (s && s.input) { submitted(s.input, s.input.el.value); return true; } if (s && s.ok) s.ok(); return true; },
    type: function (text) { if (!sheet) return false; var s = sheet.stops[sheet.cur]; if (!s || !s.input) return false; s.input.el.value = text; return true; },
    draw: { ask: drawAsk, agent: drawAgent },
    _test: { wanted: wanted, baseProblem: baseProblem, isLocalHost: isLocalHost, request: request, answerOf: answerOf, errorOf: errorOf, plain: plain, took: took, keyFor: keyFor, config: config, SYSTEM: SYSTEM,
      reset: function () { last = null; message = null; seen = { msg: 0, design: 0 }; firstPoll = true; mem = {}; } }
  };
  root.CouchAsk = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
