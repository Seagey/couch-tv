// Bridge mode pairing shim. Added to the phone remote's page by the bridge server.
// It pairs the phone once (by typing the pairing key or opening a ?pair=<key> link), then adds
// the key to every /api call, so the remote itself works seamlessly with authentication.
(function () {
  'use strict';
  var KEY = 'couchtv.key';
  var token = null;
  try {
    token = localStorage.getItem(KEY) || localStorage.getItem('couchtv.token');
  } catch (e) { /* private mode fallback */ }
  try {
    if (document.cookie.indexOf('couchtv_key=') >= 0) {
      document.cookie = 'couchtv_key=; path=/; max-age=0; SameSite=Strict';
    }
  } catch (e) {}

  // Auto-pair if ?pair=<key> or ?key=<key> was passed in the URL
  try {
    var q = location.search.match(/[?&](?:pair|key)=([^&]+)/);
    // Opened by the .local name, the page moves to the number address next (remote/index.html),
    // which is a different origin with its own storage: leave ?pair= on so it pairs there too.
    var lan = document.querySelector('meta[name="lan-ip"]');
    var moving = lan && lan.content && /\.local$/i.test(location.hostname);
    if (q) {
      token = decodeURIComponent(q[1]);
      save(token);
    }
    if (q && !moving) {
      var u = new URL(location.href);
      u.searchParams.delete('pair');
      u.searchParams.delete('key');
      history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    }
  } catch (e) {}

  function isApi(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.indexOf('/api/') === 0;
    } catch (e) {
      return false;
    }
  }
  function isPair(url) {
    return /\/api\/pair/.test(String(url)) || /\/api\/health/.test(String(url));
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (isApi(url) && token) {
      init = Object.assign({}, init || {});
      var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + token);
      init.headers = h;
    }
    return realFetch(input, init).then(function (r) {
      if (r.status === 401 && isApi(url) && !isPair(url)) {
        showPairing('This phone needs to pair with the bridge.');
      }
      return r;
    });
  };

  var RealES = window.EventSource;
  if (RealES) {
    var ES = function (url, cfg) {
      if (token && isApi(url) && String(url).indexOf('token=') < 0) {
        url += (String(url).indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token);
      }
      return new RealES(url, cfg);
    };
    ES.prototype = RealES.prototype;
    ES.CONNECTING = 0; ES.OPEN = 1; ES.CLOSED = 2;
    window.EventSource = ES;
  }

  function save(t) {
    token = t;
    try { localStorage.setItem(KEY, t); } catch (e) {}
    try {
      if (document.cookie.indexOf('couchtv_key=') >= 0) {
        document.cookie = 'couchtv_key=; path=/; max-age=0; SameSite=Strict';
      }
    } catch (e) {}
  }

  var shown = false;
  function showPairing(why) {
    if (shown) return;
    shown = true;
    var css = document.createElement('style');
    css.textContent = '#ctv-pair{position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#0b0b0d;color:#f2ead8;display:flex;align-items:center;justify-content:center;padding:24px 16px;font:16px/1.4 -apple-system,system-ui,sans-serif}' +
      '#ctv-pair .box{width:100%;max-width:360px}#ctv-pair h1{font-size:26px;margin:0 0 8px}#ctv-pair p{color:#bdb6a7;margin:0 0 18px}' +
      '#ctv-pair input{width:100%;box-sizing:border-box;font-size:20px;text-align:center;padding:14px;border-radius:14px;border:1px solid #3a3a40;background:#16161a;color:#f2ead8}' +
      '#ctv-pair button{width:100%;margin-top:12px;padding:15px;border-radius:14px;border:0;font-size:17px;font-weight:600}' +
      '#ctv-pair .go{background:#ffb52e;color:#111;cursor:pointer}#ctv-pair .msg{min-height:22px;margin-top:12px;color:#ffb52e;text-align:center}';
    document.head.appendChild(css);
    var d = document.createElement('div');
    d.id = 'ctv-pair';
    d.innerHTML = '<div class="box"><h1>Pair this phone</h1><p>' + (why || 'Type the pairing key from your computer or config.json.') + '</p>' +
      '<input id="ctv-key" type="password" autocomplete="current-password" placeholder="Pairing key" aria-label="Pairing key">' +
      '<button class="go" id="ctv-go">Pair</button><div class="msg" id="ctv-msg" role="status"></div></div>';
    (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); })).then(function () {
      document.body.appendChild(d);
      var keyInput = document.getElementById('ctv-key'), msg = document.getElementById('ctv-msg');
      document.getElementById('ctv-go').onclick = function () {
        var val = (keyInput.value || '').trim();
        if (!val) { msg.textContent = 'Please enter the pairing key.'; return; }
        msg.textContent = 'Pairing…';
        realFetch('/api/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: val })
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) {
              save(j.token || val);
              msg.textContent = 'Paired.';
              setTimeout(function () { location.reload(); }, 300);
            } else {
              msg.textContent = j.error || 'That pairing key is not right.';
            }
          })
          .catch(function () { msg.textContent = 'Can’t reach the bridge.'; });
      };
      keyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('ctv-go').click();
      });
      keyInput.focus();
    });
  }

  window.couchTv = {
    key: function () { return token; },
    token: function () { return token; },
    pair: showPairing
  };
})();
