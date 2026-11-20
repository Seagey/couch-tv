// On-TV mode only. The TV app adds this script to the phone remote's page before anything else.
// It pairs the phone once (6 digit code shown on the TV), then adds the token to every /api call,
// so the remote itself is unchanged and the same build works with the computer bridge.
(function () {
  'use strict';
  var KEY = 'couchtv.token';
  var token = null, autoPairing = false;
  try { token = localStorage.getItem(KEY); } catch (e) { /* private mode: the cookie still works */ }
  if (!token) { var m = document.cookie.match(/(?:^|; )couchtv_token=([^;]+)/); if (m) token = decodeURIComponent(m[1]); }
  // pictures the page shows from the TV (/api/photo/...) carry no header, only the cookie: keep it set
  else if (!/(?:^|; )couchtv_token=/.test(document.cookie)) document.cookie = 'couchtv_token=' + encodeURIComponent(token) + '; path=/; max-age=31536000; SameSite=Strict';

  function isApi(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin && u.pathname.indexOf('/api/') === 0; } catch (e) { return false; }
  }
  function isPair(url) { return /\/api\/pair/.test(String(url)); }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (isApi(url) && token) {
      init = Object.assign({}, init || {});
      var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      h.set('Authorization', 'Bearer ' + token);
      init.headers = h;
    }
    return realFetch(input, init).then(function (r) {
      if (r.status === 401 && isApi(url) && !isPair(url) && !autoPairing) showPairing('This phone needs to pair with the TV again.');
      return r;
    });
  };

  var RealES = window.EventSource;
  if (RealES) {
    var ES = function (url, cfg) {
      if (token && isApi(url)) url += (String(url).indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token);
      return new RealES(url, cfg);
    };
    ES.prototype = RealES.prototype; ES.CONNECTING = 0; ES.OPEN = 1; ES.CLOSED = 2;
    window.EventSource = ES;
  }

  function save(t) {
    token = t;
    try { localStorage.setItem(KEY, t); } catch (e) { }
    document.cookie = 'couchtv_token=' + encodeURIComponent(t) + '; path=/; max-age=31536000; SameSite=Strict';
  }

  var shown = false;
  function showPairing(why) {
    if (shown) return; shown = true;
    var css = document.createElement('style');
    css.textContent = '#ctv-pair{position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#0b0b0d;color:#f2ead8;display:flex;align-items:center;justify-content:center;padding:24px 16px;font:16px/1.4 -apple-system,system-ui,sans-serif}' +
      '#ctv-pair .box{width:100%;max-width:360px}#ctv-pair h1{font-size:26px;margin:0 0 8px}#ctv-pair p{color:#bdb6a7;margin:0 0 18px}' +
      '#ctv-pair input{width:100%;box-sizing:border-box;font-size:34px;letter-spacing:.3em;text-align:center;padding:14px;border-radius:14px;border:1px solid #3a3a40;background:#16161a;color:#f2ead8}' +
      '#ctv-pair button{width:100%;margin-top:12px;padding:15px;border-radius:14px;border:0;font-size:17px;font-weight:600}' +
      '#ctv-pair .go{background:#ffb52e;color:#111}#ctv-pair .ask{background:#222228;color:#f2ead8}#ctv-pair .msg{min-height:22px;margin-top:12px;color:#ffb52e}';
    document.head.appendChild(css);
    var d = document.createElement('div');
    d.id = 'ctv-pair';
    d.innerHTML = '<div class="box"><h1>Pair this phone</h1><p>' + (why || 'Type the 6 digit code shown on the TV.') + '</p>' +
      '<input id="ctv-pin" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" aria-label="Code from the TV">' +
      '<button class="go" id="ctv-go">Pair</button><button class="ask" id="ctv-ask">Show a code on the TV</button><div class="msg" id="ctv-msg" role="status"></div></div>';
    (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); })).then(function () {
      document.body.appendChild(d);
      var pin = document.getElementById('ctv-pin'), msg = document.getElementById('ctv-msg');
      document.getElementById('ctv-ask').onclick = function () {
        msg.textContent = 'Asking the TV…';
        realFetch('/api/pair/start', { method: 'POST' }).then(function (r) { return r.json(); })
          .then(function (j) { msg.textContent = j.ok ? 'The code is on the TV now.' : (j.error || 'The TV did not answer.'); })
          .catch(function () { msg.textContent = 'Can’t reach the TV.'; });
      };
      document.getElementById('ctv-go').onclick = function () {
        var code = (pin.value || '').replace(/\D/g, '');
        if (code.length !== 6) { msg.textContent = 'The code has 6 digits.'; return; }
        msg.textContent = 'Pairing…';
        realFetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: code, name: (navigator.platform || 'Phone') }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.ok && j.token) { save(j.token); msg.textContent = 'Paired.'; location.reload(); } else msg.textContent = j.error || 'That did not work.'; })
          .catch(function () { msg.textContent = 'Can’t reach the TV.'; });
      };
      pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('ctv-go').click(); });
    });
  }

  // One scan pairs: the TV's QR is http://<tv>:5400/#pin=123456 (SetupWords.qrLink). The code is
  // taken out of the address at once (so it is not kept in the history or a bookmark), then used
  // once, exactly as if it had been typed. It only ever travels in the request body of /api/pair.
  // The rest of the fragment (a #design=<code> from couch-tv Studio) is left for the remote.
  var pinFromQr = null;
  try {
    var hm = /(^|[#&])pin=(\d{6})(?=&|$)/.exec(location.hash || '');
    if (hm) {
      pinFromQr = hm[2];
      var rest = (location.hash || '').replace(/^#/, '').split('&').filter(function (p) { return p && p.indexOf('pin=') !== 0; }).join('&');
      history.replaceState(history.state, '', location.pathname + location.search + (rest ? '#' + rest : ''));
    }
  } catch (e) { pinFromQr = null; }
  function pairWith(code, then) {
    return realFetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: code, name: (navigator.platform || 'Phone') }) })
      .then(function (r) { return r.json(); }).then(then);
  }
  // while the scanned code is on its way, the page's own calls may answer 401: no "pair again" box
  // over it (the 401 guard above); cleared before any box this shows
  function pairFromQr() {
    autoPairing = true;
    pairWith(pinFromQr, function (j) {
      if (j.ok && j.token) { save(j.token); location.reload(); }
      else { autoPairing = false; showPairing(j.error || 'That code from the TV has run out. Scan the code on the TV again, or type the 6 digit code shown there.'); }
    }).catch(function () { autoPairing = false; showPairing('Can’t reach the TV. Check this phone is on the same Wi-Fi as the TV.'); });
  }

  window.couchTv = { token: function () { return token; }, pair: showPairing };
  if (pinFromQr) {
    // already paired with a token the TV still knows: nothing to do. Otherwise pair with the scanned code.
    if (!token) pairFromQr();
    else {
      autoPairing = true;   // a stale token: the page's first calls may 401 before the check below says so
      realFetch('/api/health', { headers: { Authorization: 'Bearer ' + token } }).then(function (r) { return r.json(); })
        .then(function (j) { if (!j || j.auth !== 'ok') pairFromQr(); else autoPairing = false; }).catch(function () { pairFromQr(); });
    }
  } else if (!token) showPairing();
})();
