// Thin client for the bridge (../../bridge/API.md). Relative URLs, so it works from any phone at home.

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Which TV this phone is driving. null means the bridge's default (the default TV), and then
// nothing is added to any call, exactly as before more than one TV existed.
let tvId = null;
export const setTvId = (id) => { tvId = id || null; };
const withTv = (path) => (tvId ? `${path}${path.includes('?') ? '&' : '?'}tv=${encodeURIComponent(tvId)}` : path);

// Every call gives up in the end, so the app never sits on "Loading" for ever.
// Ask and play wait longer: Claude thinks first, and waking a TV takes up to 25 s.
async function call(method, path, body, ms = 12000) {
  let res;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (tvId) { if (method === 'GET') path = withTv(path); else body = { ...(body || {}), tv: tvId }; }
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    throw e.name === 'AbortError' ? new ApiError('The bridge is taking too long. Try again.', 408) : new ApiError('Can’t reach the bridge', 0);
  } finally {
    clearTimeout(t);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !data || data.ok === false) {
    const msg = data?.error || (res.status === 503 ? 'TV not connected' : res.status === 404 ? 'Not found' : 'Something went wrong');
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const api = {
  now: () => call('GET', '/api/now'),
  apps: () => call('GET', '/api/apps'),
  recs: (who) => call('GET', `/api/recs?who=${encodeURIComponent(who)}`),
  continueList: (who) => call('GET', `/api/continue?who=${encodeURIComponent(who)}`),
  setWho: (who) => call('POST', '/api/who', { who }),
  openContinue: (id, who) => call('POST', '/api/continue/open', { id, who }, 60000),
  config: () => call('GET', '/api/config'),
  screens: () => call('GET', '/api/screens'),
  sleep: () => call('GET', '/api/sleep'),
  key: (key, hold = false) => call('POST', '/api/key', hold ? { key, hold: true } : { key }),
  text: (text) => call('POST', '/api/text', { text }),
  launch: (app) => call('POST', '/api/launch', { app }),
  play: (show, who) => call('POST', '/api/play', { ...show, who }, 60000),
  ask: (text, who) => call('POST', '/api/ask', { text, who }, 90000),
  power: (state) => call('POST', '/api/power', { state }, 40000),
  volume: (action, steps) => call('POST', '/api/volume', steps ? { action, steps } : { action }),
  setSleep: (minutes) => call('POST', '/api/sleep', { minutes }),
  openScreen: (id) => call('POST', '/api/screens/open', { id }),
  tvs: () => call('GET', '/api/tvs'),
  picture: (mode) => call('POST', '/api/picture', { mode }, 20000),   // a picture switch can take several seconds
  appOrder: () => call('GET', '/api/app-order'),
  saveAppOrder: (order, line) => call('POST', '/api/app-order', { order, line }),
  getPicture: () => call('GET', '/api/picture'),
  people: () => call('GET', '/api/people'),
  savePeople: (people) => call('POST', '/api/people', { people }),
  settings: () => call('GET', '/api/settings'),   // the TV home's Home settings (its language)
};

// Live TV state: server-sent events, with a slow poll as the fallback when the stream drops.
export function subscribeNow(onNow, onReach) {
  let es; let poll; let retry; let closed = false; let fails = 0;
  const start = () => {
    if (closed) return;
    clearTimeout(retry);
    es?.close();
    es = new EventSource(withTv('/api/events'));
    es.addEventListener('now', (e) => { fails = 0; onReach(true); try { onNow(JSON.parse(e.data)); } catch { /* ignore */ } });
    es.onerror = () => {
      es.close(); fails += 1;
      api.now().then((d) => { onReach(true); onNow(d); }).catch((err) => onReach(!(err.status === 0 || err.status === 408)));
      // Back off 2, 4, 8 s up to 15 s while the computer is away (it restarts, or the phone is off the Wi-Fi).
      retry = setTimeout(start, Math.min(15000, 1000 * 2 ** fails));
    };
  };
  start();
  // When the phone wakes or the app comes back to the front, refresh straight away. While the computer
  // is not answering, keep checking quickly (2, 4, 8, then every 15 s), so the remote comes back
  // by itself within seconds of the computer, not on the next 30 s poll.
  let away = 0; let recheck;
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    clearTimeout(recheck);
    api.now().then((d) => { away = 0; onReach(true); onNow(d); }).catch((err) => {
      const gone = err.status === 0 || err.status === 408;
      onReach(!gone);
      if (gone && !closed) { away += 1; recheck = setTimeout(wake, Math.min(15000, 1000 * 2 ** away)); }
    });
  };
  // Back from the lock screen or the page cache: iOS may have dropped the live stream, so reopen it.
  const resume = () => { wake(); if (!es || es.readyState === 2) { fails = 0; start(); } };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('tv:resume', resume);
  poll = setInterval(wake, 30000);
  return () => { closed = true; es?.close(); clearTimeout(retry); clearTimeout(recheck); clearInterval(poll); document.removeEventListener('visibilitychange', wake); window.removeEventListener('tv:resume', resume); };
}
