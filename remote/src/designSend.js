// Send a design from the phone (owner, 20 Nov 2026: "the least they have to do on their TV the
// better"). The phone remote sends a couch-tv Studio design code to the TV home through this home's own
// POST /api/say/design (the couch-tv TV app, Say.kt, or the computer at home, bridge/say.py). The TV
// home fetches the design itself and asks "Use this design?" first, always (tv-home/web/ask.js), so one
// press of OK on the TV is all that is left.
//
// couch-tv Studio hands a code over with a top level link to this page: http://<tv or computer>/#design=CODE
// (a fragment, so it is never in a request line or a log). The link to Studio carries this page's own
// address the same way (#tv=<host:port>), so Studio's Send to my TV knows where to hand it back.
// No React here, so tests/test_remote_design_send.mjs checks it with plain node.

export const STUDIO = 'https://couchtv.joshuaseage.com';
const SHORT = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

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

// #design=CODE from Studio's hand off: the code (or '' when there is none or it is not a code) and the
// fragment without it, to put back in the address bar so a reload never sends it twice
export function takeDesignFromHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('&').filter(Boolean);
  let code = '';
  const rest = [];
  for (const p of parts) {
    if (p.indexOf('design=') === 0) { if (!code) { try { code = readDesignCode(decodeURIComponent(p.slice(7))); } catch { code = ''; } } }
    else rest.push(p);
  }
  return { code, rest: rest.length ? '#' + rest.join('&') : '' };
}

// Studio's designer, told where this phone remote lives (only a private home address is passed on)
export function studioLink(host) {
  const h = String(host || '').toLowerCase();
  const home = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}\.(local|lan|home\.arpa))(:\d{1,5})?$/.test(h);
  return STUDIO + '/design/' + (home ? '#tv=' + encodeURIComponent(h) : '');
}

export const WORDS = {
  title: 'Send a design',
  note: 'Paste or type a code from couch-tv Studio. The TV asks "Use this design?" and you press OK. No typing on the TV.',
  placeholder: 'ABCDE-FGHJK',
  send: 'Send to the TV',
  choose: 'Choose a design in couch-tv Studio',
  notCode: 'That is not a design code. It looks like ABCDE-FGHJK.',
  sent: 'Sent. On the TV, press OK when it asks Use this design?',
  failed: 'The TV did not take it. Check this phone is on the home Wi-Fi and try again.',
};
