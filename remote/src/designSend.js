// Send a design from the phone (owner, 20 Nov 2026: "the least they have to do on their TV the
// better"). The phone remote sends a couch-tv Studio design code to the TV home through this home's own
// POST /api/say/design (the couch-tv TV app, Say.kt, or the computer at home, bridge/say.py). The TV
// home fetches the design itself and asks "Use this design?" first, always (tv-home/web/ask.js). Its
// focus starts on Keep my home, so the words say to pick Use this design, never just "press OK".
//
// couch-tv Studio hands a code over with a top level link to this page: http://<tv or computer>/#design=CODE
// (a fragment, so it is never in a request line or a log). A code that arrives by link is only sent after
// a tap (Send this design to the TV?), except for the round trip this remote started itself: the link
// to Studio carries this page's address and a one time nonce (#tv=<host:port>&n=<nonce>), the nonce is
// kept here, and Studio hands it back (#design=CODE&n=<nonce>). Only a matching nonce sends with no tap.
// No React here, so tests/test_phone_send.mjs checks it with plain node.

export const STUDIO = 'https://couchtv.joshuaseage.com';
const SHORT = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const NONCE_KEY = 'couchtv.studio.nonce';

// a design code as the TV reads it (tv-home/web/design-code.js readCode), or ''
export function readDesignCode(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length > 80) return '';
  const long = s.replace(/^CTV1-/i, '');
  if (/^[A-Za-z0-9_-]{43}$/.test(long)) return 'CTV1-' + long;
  const c = s.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 10) return '';
  for (const ch of c) if (!SHORT.includes(ch)) return '';
  return c.slice(0, 5) + '-' + c.slice(5);
}

// #design=CODE (and n=<nonce>) from Studio's hand off: the code ('' when there is none or it is not a
// code), the nonce, and the fragment without both, to put back in the address bar so a reload never
// offers it twice
export function takeDesignFromHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('&').filter(Boolean);
  let code = '', nonce = '';
  const rest = [];
  for (const p of parts) {
    if (p.indexOf('design=') === 0) { if (!code) { try { code = readDesignCode(decodeURIComponent(p.slice(7))); } catch { code = ''; } } }
    else if (p.indexOf('n=') === 0) { if (/^[A-Za-z0-9_-]{22}$/.test(p.slice(2))) nonce = p.slice(2); }
    else rest.push(p);
  }
  return { code, nonce, rest: rest.length ? '#' + rest.join('&') : '' };
}

// 16 random bytes, base64url
export function newNonce(rand = (b) => crypto.getRandomValues(b)) {
  const b = rand(new Uint8Array(16));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// the code goes with no tap only when Studio handed back the nonce this phone made, once
export function nonceMatches(given, kept) {
  return typeof given === 'string' && typeof kept === 'string' && /^[A-Za-z0-9_-]{22}$/.test(given) && given === kept;
}

// Studio's designer, told where this phone remote lives (only a private home address is passed on) and
// the nonce for the hand back
export function studioLink(host, nonce) {
  const h = String(host || '').toLowerCase();
  const home = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}\.(local|lan|home\.arpa))(:\d{1,5})?$/.test(h);
  if (!home) return STUDIO + '/design/';
  return STUDIO + '/design/#tv=' + encodeURIComponent(h) + (/^[A-Za-z0-9_-]{22}$/.test(nonce || '') ? '&n=' + nonce : '');
}

// TVs whose couch-tv home does not read /api/say (a Roku channel, the Apple TV app): no Send a design
export function canSend(kind) { return kind !== 'roku' && kind !== 'appletv' && kind !== 'apple-tv'; }

export const WORDS = {
  title: 'Send a design',
  note: 'Paste the code from couch-tv Studio. Then on the TV, pick Use this design and press OK.',
  placeholder: 'ABCDE-FGHJK',
  send: 'Send to the TV',
  choose: 'Choose a design in couch-tv Studio',
  notCode: 'That is not a design code. It looks like ABCDE-FGHJK.',
  sent: 'Sent. On the TV, pick Use this design, then press OK.',
  notListening: 'Sent. Open the Couch TV home on the TV in the next 10 minutes.',
  failed: 'The TV did not take it. Check this phone is on the home Wi-Fi and try again.',
  cannot: 'This TV can\'t take a design from the phone: type the code on the TV, in Home settings, Designs, Get a design.',
  ask: 'Send this design to the TV?',
  askSend: 'Send',
  askLater: 'Not now',
};

// The words in the phone's language: i18n.js has each as ds_<name> in every phone language block, and
// the app hands its t() over (setTranslate). Without it (the node tests) or for a missing word: WORDS.
let tr = null;
export function setTranslate(fn) { tr = typeof fn === 'function' ? fn : null; }
export function dsw(name) {
  const v = tr ? tr('ds_' + name) : null;
  return v && v !== 'ds_' + name ? v : WORDS[name];
}

// what to say after a send: the answer of POST /api/say/design ({ listening } says whether the TV home
// asked for news in the last half minute)
export function sentWords(answer) { return answer && answer.listening === false ? dsw('notListening') : dsw('sent'); }
