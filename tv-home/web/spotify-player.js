// Play on TV, for the standalone home (scripts/build-standalone.sh): the Now playing card's button
// moves what's playing on the Spotify account (a phone, say) to the TV and keeps it playing there.
//   1. The page becomes a Spotify speaker, "Couch TV" (Spotify's Web Playback SDK), and the site's
//      api/transfer moves the music to it: the home stays on screen. Confirmed on a Hisense VIDAA 9
//      (55U7N, Q0705): its browser plays Spotify like this.
//   2. If the browser can't (the SDK reports an error, or never gets ready), the TV's Spotify app opens
//      and api/transfer moves the music to it as soon as it shows up as a device (a VIDAA address; other
//      TVs only get option 1).
// The site's functions (standalone/api) hold the Spotify login; the page only ever gets a 1-hour
// access token from api/player-token, for the SDK. Needs Spotify Premium (Spotify's rule for both).
// window.CouchSpotify: warm() (load the player early), playHere(note).
(function () {
  "use strict";
  if (!window.COUCH_STANDALONE) return;
  var TVAPP = "https://api-partner.spotify.com/tvapp?platform=vidaa";
  // the site key (COUCH_SITE_KEY on the host), carried by the tile's address as ?sk= and kept here
  var SK = (location.search.match(/[?&]sk=([A-Za-z0-9_-]{8,128})/) || [])[1] || "";
  try { if (SK) localStorage.setItem("couchtv.sitekey", SK); else SK = localStorage.getItem("couchtv.sitekey") || ""; } catch (e) {}
  function url(path) { return SK ? path + (path.indexOf("?") < 0 ? "?" : "&") + "sk=" + encodeURIComponent(SK) : path; }
  var state = { sdk: null, player: null, deviceId: null, failed: false, busy: false };

  function loadSdk() {
    if (state.sdk) return state.sdk;
    state.sdk = new Promise(function (resolve, reject) {
      if (window.Spotify && window.Spotify.Player) return resolve();
      window.onSpotifyWebPlaybackSDKReady = resolve;
      var s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.onerror = function () { reject(new Error("couldn't load Spotify's player")); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error("Spotify's player took too long to load")); }, 15000);
    });
    return state.sdk;
  }
  function getToken(cb) {
    fetch(url("api/player-token"), { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok && j.token) cb(j.token); else state.failed = true; })
      .catch(function () { state.failed = true; });
  }
  // the player, connected and ready (its device id), or an error
  function player() {
    if (state.failed) return Promise.reject(new Error("this browser can't play Spotify itself"));
    if (state.deviceId) return Promise.resolve(state.deviceId);
    return loadSdk().then(function () {
      return new Promise(function (resolve, reject) {
        if (!state.player) {
          state.player = new window.Spotify.Player({ name: "Couch TV", getOAuthToken: getToken, volume: 1.0 });
          var fail = function (e) { state.failed = true; reject(new Error((e && e.message) || "player error")); };
          state.player.addListener("initialization_error", fail);   // e.g. no Widevine in this browser
          state.player.addListener("authentication_error", fail);
          state.player.addListener("account_error", fail);           // not Premium
          state.player.addListener("ready", function (d) { state.deviceId = d.device_id; resolve(d.device_id); });
          state.player.addListener("not_ready", function () { state.deviceId = null; });
          state.player.connect();
        }
        setTimeout(function () { if (!state.deviceId) { state.failed = true; reject(new Error("the player never got ready")); } }, 12000);
      });
    });
  }

  // Load the player while a song shows, so the press itself is quick (and inside the browser's
  // "someone pressed something" window, which it needs before it starts sound).
  function warm() { if (!state.failed && !state.deviceId) player().catch(function () {}); }

  function toTvApp(note) {
    if (note) note("Opening Spotify on the TV…");
    try {
      fetch(url("api/transfer"), { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "tvapp" }) }).catch(function () {});
    } catch (e) {}
    setTimeout(function () { location.href = TVAPP; }, 300);
  }

  function playHere(note) {
    if (state.busy) return;
    state.busy = true;
    if (state.player && state.player.activateElement) { try { state.player.activateElement(); } catch (e) {} }
    player().then(function (id) {
      return fetch(url("api/transfer"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id }) }).then(function (r) { return r.json(); }).then(function (j) {
        state.busy = false;
        if (note) note(j.ok ? "Playing on the TV" : "Spotify said no" + (j.error ? ": " + j.error : ""));
      });
    }).catch(function () {
      state.busy = false;
      toTvApp(note);
    });
  }

  window.CouchSpotify = { warm: warm, playHere: playHere, url: url };
})();
