import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, subscribeNow, setTvId } from './api.js';
import { tick } from './haptics.js';
import * as Ic from './icons.jsx';
import { TopBar, NowPlaying, Pad, Controls, AskButton } from './Remote.jsx';
import { Watch } from './Watch.jsx';
import { AskSheet, MoreSheet, ArrangeSheet, PeopleSheet, Onboarding } from './Sheets.jsx';
import { KidsSheet, PinSheet } from './Kids.jsx';
import { usePullDown, usePageDrag } from './gestures.js';
import { t, useLang, setTvLang } from './i18n.js';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const SERVICES = {
  'apple-tv': 'Apple TV+', 'abc-iview': 'ABC iview', 'sbs-on-demand': 'SBS On Demand', 'disney-plus': 'Disney+',
  'prime-video': 'Prime Video', 'paramount-plus': 'Paramount+', 'foxtel-go': 'Foxtel Go', 'kayo': 'Kayo', 'binge': 'Binge', 'stan': 'Stan',
};

// The screen size, kept current through every way a phone can change it. Opening or closing the
// iPhone Duo often happens with the app in the background, and iOS does not always send a resize,
// so it is also re-read on matchMedia changes, the visual viewport, a ResizeObserver on the page,
// and whenever the app comes back to the front.
function useSize() {
  const get = () => ({ w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight });
  const [s, set] = useState(get);
  useEffect(() => {
    let raf = 0;
    const f = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const n = get(); set((o) => (o.w === n.w && o.h === n.h ? o : n)); window.__tvMeasure?.(); });
    };
    const later = () => { f(); setTimeout(f, 300); };
    const mq = window.matchMedia?.('(min-width: 760px) and (min-height: 480px)');
    const vv = window.visualViewport;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;
    ro?.observe(document.documentElement);
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', later);
    window.addEventListener('pageshow', later);
    window.addEventListener('tv:resume', later);
    document.addEventListener('visibilitychange', later);
    vv?.addEventListener('resize', f);
    mq?.addEventListener?.('change', f);
    return () => {
      cancelAnimationFrame(raf); ro?.disconnect();
      window.removeEventListener('resize', f);
      window.removeEventListener('orientationchange', later);
      window.removeEventListener('pageshow', later);
      window.removeEventListener('tv:resume', later);
      document.removeEventListener('visibilitychange', later);
      vv?.removeEventListener('resize', f);
      mq?.removeEventListener?.('change', f);
    };
  }, []);
  return s;
}

// The ground is the artwork of what is on the TV, blurred. Two layers crossfade when it changes.
function Backdrop({ image, colour, off }) {
  const [layers, setLayers] = useState([{ key: 0, image, colour }]);
  useEffect(() => {
    let cancelled = false;
    const next = { key: Date.now(), image, colour };
    const swap = () => { if (!cancelled) setLayers((l) => [...l.slice(-1), next]); };
    if (image) { const im = new Image(); im.onload = swap; im.onerror = () => { next.image = null; swap(); }; im.src = image; } else swap();
    return () => { cancelled = true; };
  }, [image, colour]);
  return (
    <div className={`backdrop ${off ? 'off' : ''}`} aria-hidden="true">
      {layers.map((l, i) => (
        <div key={l.key} className={`bd-layer ${i === layers.length - 1 ? 'top' : ''}`}
          style={l.image ? { backgroundImage: `url("${l.image}")` } : { background: `radial-gradient(120% 70% at 50% 18%, color-mix(in srgb, ${l.colour || '#2a2a30'} 55%, #000), #050506 75%)` }} />
      ))}
      <div className="bd-shade" />
    </div>
  );
}

// The on-screen keyboard's height, from the visual viewport. iOS keeps the page the same size and
// slides the keyboard over it, so bottom sheets are lifted by --kb. Android with
// interactive-widget=resizes-content shrinks the page instead, and --kb stays 0.
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const root = document.documentElement;
    // Android shrinks the page instead: a typing field in focus and a page much shorter than it
    // was at this width means the keyboard is up too.
    let tallest = { w: window.innerWidth, h: window.innerHeight };
    const f = () => {
      if (window.innerWidth !== tallest.w) tallest = { w: window.innerWidth, h: window.innerHeight };
      tallest.h = Math.max(tallest.h, window.innerHeight);
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const typing = document.activeElement?.tagName === 'INPUT';
      const shrunk = typing && window.innerHeight < tallest.h - 120;
      const open = kb > 80 || shrunk;
      root.style.setProperty('--kb', `${kb > 80 ? kb : 0}px`);
      root.classList.toggle('kb-open', open);
      // iOS sometimes scrolls the whole page up to show the field; the sheet is already lifted.
      if (open && window.scrollY) window.scrollTo(0, 0);
    };
    const later = () => setTimeout(f, 50);
    vv.addEventListener('resize', f); vv.addEventListener('scroll', f); window.addEventListener('resize', f);
    document.addEventListener('focusin', later); document.addEventListener('focusout', later); f();
    return () => {
      vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); window.removeEventListener('resize', f);
      document.removeEventListener('focusin', later); document.removeEventListener('focusout', later);
    };
  }, []);
}

export default function App() {
  useKeyboardInset();
  useLang();   // every word comes from i18n.js; a new language re-renders everything
  const [people, setPeople] = useState([{ id: 'person1', name: 'Person 1' }, { id: 'person2', name: 'Person 2' }]);
  // ask.enabled false in config.json hides Ask; people can be any number (none: everything shows as Both)
  const [askOn, setAskOn] = useState(true);
  // Glass app icons, the same look as the TV home's dock (#25): its Home settings, Look, Glass app
  // icons wins, else home.glass_icons in config.json. Off unless the TV has it on.
  // How clear the glass is, 1 to 5, follows the TV the same way (#29), and so does whether a
  // pressed app shows its colours or stays glass (Focused app, #32).
  const glass = useRef({ cfg: false, tv: null, amtCfg: 3, amtTv: null, focusCfg: null, focusTv: null });
  const showGlass = () => {
    const r = document.documentElement, g = glass.current, amt = g.amtTv ?? g.amtCfg;
    r.classList.toggle('glass-icons', g.tv ?? g.cfg);
    r.classList.toggle('gi-stay', (g.focusTv ?? g.focusCfg) === 'glass');
    for (let i = 1; i <= 5; i++) r.classList.toggle(`ga-${i}`, amt === i);
  };
  const amount = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? n : null);
  // Apps hidden on the TV (hold OK on an app, Hide from home; or Home settings, Apps) stay hidden here too.
  const [hidden, setHidden] = useState([]);
  // nobody set up: no picker, the remote shows everything
  useEffect(() => { if (!who && people.length === 0) setWho('both'); }, [people]); // eslint-disable-line react-hooks/exhaustive-deps
  // the kids profiles (people with kids_mode): no Ask for them (docs/CONFIG.md, "Kids mode")
  const kidIds = people.filter((p) => p.kids_mode).map((p) => p.id);
  const loadConfig = () => api.config().then((c) => { if (Array.isArray(c.people)) setPeople(c.people); }).catch(() => {});
  useEffect(() => { api.config().then((c) => { if (Array.isArray(c.people)) setPeople(c.people); if (c.ask && c.ask.enabled === false) setAskOn(false); glass.current.cfg = c.home?.glass_icons === true; glass.current.amtCfg = amount(c.home?.glass_amount) ?? 3; glass.current.focusCfg = c.home?.glass_focus ?? null; showGlass(); }).catch(() => {}); }, []);
  const [who, setWhoState] = useState(() => store.get('tv.who'));
  // Which TV this phone drives, remembered per phone. null is the bridge's default (living room).
  const [tvId, setTvIdState] = useState(() => { const id = store.get('tv.tv'); setTvId(id); return id; });
  const [tvs, setTvs] = useState([]);
  const [tv, setTv] = useState(null);
  const [reach, setReach] = useState(null);
  const [apps, setApps] = useState(null);
  const [recs, setRecs] = useState(null);
  const [cont, setCont] = useState(null);
  const [screens, setScreens] = useState([]);
  const [tab, setTab] = useState('remote');
  const [sheet, setSheet] = useState(null);
  // A sheet adds a history step, so the Android back button (or gesture) closes it instead of the app.
  useEffect(() => {
    const st = window.history.state;
    if (sheet && !st?.tvSheet) window.history.pushState({ ...(st || {}), tvSheet: true }, '');
    else if (!sheet && st?.tvSheet) window.history.back();
  }, [sheet]);
  useEffect(() => {
    const onPop = () => { if (!window.history.state?.tvSheet) setSheet(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [toast, setToast] = useState(null);
  const [sleepError, setSleepError] = useState(null);
  const [, setNowTick] = useState(0);
  const askInput = useRef(null);
  const { w, h } = useSize();
  const wide = w >= 760 && h >= 480;
  const standalone = typeof navigator !== 'undefined' && (navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

  const say = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() });
  }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), toast.text.length > 40 ? 4500 : 2600); return () => clearTimeout(t); }, [toast]);

  useEffect(() => { setTv(null); return subscribeNow(setTv, setReach); }, [tvId]);
  useEffect(() => {
    const load = () => api.tvs().then((d) => setTvs(d.tvs || [])).catch(() => {});
    load();
    // also every 10 minutes, so a Developer Mode warning shows without reopening the app
    const iv = setInterval(load, 600000);
    return () => clearInterval(iv);
  }, [reach, tvId]);
  // "Same as the TV": the language picked in the TV home's Home settings
  // and its look and hidden apps
  useEffect(() => { api.settings().then((d) => {
    const s = d.settings || {};
    setTvLang(s.lang);
    glass.current.tv = typeof s.glass_icons === 'boolean' ? s.glass_icons : null;
    glass.current.amtTv = amount(s.glass_amount);
    glass.current.focusTv = s.glass_focus === 'glass' || s.glass_focus === 'colour' ? s.glass_focus : null; showGlass();
    setHidden(Array.isArray(s.hidden_apps) ? s.hidden_apps : []);
  }).catch(() => {}); }, [reach, tvId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.apps().then((d) => setApps(d.apps)).catch(() => setApps((a) => a || false)); api.screens().then((d) => setScreens(d.screens)).catch(() => {}); }, [reach]);
  useEffect(() => { if (tab === 'watch' && apps === false) api.apps().then((d) => setApps(d.apps)).catch(() => {}); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const whoNow = useRef(who);
  whoNow.current = who;
  const loadRecs = useCallback(() => {
    if (!who) return;
    const w = who;
    api.recs(w).then((d) => { if (whoNow.current === w) setRecs(d); }).catch(() => { if (whoNow.current === w) setRecs((r) => r || false); });
    api.continueList(w).then((d) => { if (whoNow.current === w) setCont(d.items); }).catch(() => { if (whoNow.current === w) setCont(undefined); });
  }, [who, tvId]); // each TV keeps its own Keep watching
  useEffect(() => { setRecs(null); setCont(null); loadRecs(); const t = setInterval(loadRecs, 10 * 60000); return () => clearInterval(t); }, [loadRecs]);
  useEffect(() => { if (reach && recs === false) loadRecs(); }, [reach]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back from the lock screen: fetch the lists again, they may be hours old.
  useEffect(() => {
    const f = () => { loadRecs(); api.apps().then((d) => setApps(d.apps)).catch(() => {}); };
    window.addEventListener('tv:resume', f);
    return () => window.removeEventListener('tv:resume', f);
  }, [loadRecs]);
  useEffect(() => { const t = setInterval(() => setNowTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const setWho = (v) => { store.set('tv.who', v); setWhoState(v); };
  // Who is on the couch is shared with the bridge, so the phones and the TV home agree.
  // A tap on the switch tells the bridge; a change made elsewhere (TV, other phone) is followed here.
  // Moving the TV away from a kids profile needs the parent PIN: the bridge says so (403), and the
  // phone asks for it once and tries again.
  const [pinAsk, setPinAsk] = useState(null);
  const pickWho = (v, pin) => {
    setWho(v);
    api.setWho(v, pin).catch((e) => {
      if (couchRef.current) setWho(couchRef.current);
      if (e.status === 403 && kidIds.includes(couchRef.current)) {
        setPinAsk({ msg: pin ? e.message : t('kids_leave_pin', { name: people.find((p) => p.id === couchRef.current)?.name || '' }), go: (code) => pickWho(v, code) });
        return;
      }
      say(e.status === 429 ? e.message : t('cant_tell_who'), 'err');
    });
  };
  const couch = tv?.who;
  const couchRef = useRef(couch);
  couchRef.current = couch;
  useEffect(() => { if (couch && who && couch !== who) setWho(couch); }, [couch]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (p, okText) => {
    try { const r = await p; if (okText) say(typeof okText === 'function' ? okText(r) : okText); return r; } catch (e) {
      if (e.status === 0) setReach(false);
      say(e.message, 'err'); return null;
    }
  }, [say]);

  const appById = useMemo(() => Object.fromEntries((apps || []).map((a) => [a.id, a])), [apps]);
  const serviceName = (id) => appById[id]?.name || SERVICES[id] || id;

  const off = Boolean(tv) && (tv.power === 'off' || !tv.tv_connected);
  const thisTv = tvs.find((t) => t.id === (tvId || 'living-room'));
  const offState = reach === false ? 'unreachable' : thisTv && thisTv.paired === false ? 'unpaired'
    : !tv ? null : tv.waking ? 'waking' : off ? 'off' : null;
  const chooseTv = (id) => {
    const next = !id || id === 'living-room' ? null : id;
    store.set('tv.tv', next || ''); setTvId(next); setTvIdState(next); setWakeError(null);
  };
  const [wakeError, setWakeError] = useState(null);
  useEffect(() => { if (tv?.power === 'on') setWakeError(null); }, [tv?.power]);
  const onKey = (key, hold) => run(api.key(key, hold));
  const onVolume = (a) => run(api.volume(a));
  // A fully off TV leaves the Wi-Fi; the bridge tries Wake-on-LAN for up to 25 s, then gives up.
  const onWake = async () => {
    setWakeError(null);
    try { await api.power('on'); } catch (e) {
      if (e.status === 0) setReach(false);
      setWakeError(e.status === 503 ? t('didnt_wake') : e.message);
    }
  };
  const onRetry = () => api.now()
    .then((d) => { setTv(d); setReach(true); loadRecs(); api.apps().then((a) => setApps(a.apps)).catch(() => {}); })
    .catch(() => say(t('still_cant_reach'), 'err'));
  const onPower = () => (tv?.power === 'on' ? run(api.power('off')) : onWake());
  const onPlay = async (show) => {
    if (show.playable === false) { say(t('not_on_tv', { title: show.title, service: serviceName(show.service) })); return; }
    say(t('starting', { title: show.title }));
    const r = await run(show.id
      ? api.openContinue(show.id, who)
      : api.play({ title: show.title, season: show.season, episode: show.episode, service: show.service }, who));
    if (r) { say(r.method === 'deeplink' ? t('is_on', { title: r.title }) : r.note || t('opened', { app: r.app?.name })); loadRecs(); if (!wide) goTo('remote'); }
  };
  const onLaunch = (a) => run(api.launch(a.id), t('opening', { app: a.name })).then((r) => { if (r && !wide) goTo('remote'); });
  const onScreen = (s) => (s.ready ? run(api.openScreen(s.id), (r) => r.note || `Opening ${s.name}`) : say(s.note || t('not_set_up')));
  const onAsk = (text) => api.ask(text, who).then((r) => { loadRecs(); return r; });
  const onSleep = async (m) => {
    try { await api.setSleep(m); setSleepError(null); setTv((t) => t && ({ ...t, sleep: { ends: m ? new Date(Date.now() + m * 60000).toISOString() : null } })); say(m ? t('sleep_set', { n: m }) : t('sleep_off')); } catch (e) {
      setSleepError(e.status === 404 ? t('sleep_needs_update') : e.message);
    }
  };
  // Picture mode: only for TVs that have a "picture" entry in config.json.
  const [pictureInfo, setPictureInfo] = useState(null);
  useEffect(() => {
    setPictureInfo(null);
    if (sheet === 'more' && thisTv?.picture) api.getPicture().then(setPictureInfo).catch(() => {});
  }, [sheet, tvId]);
  const onPicture = async (mode) => {
    try { const r = await api.picture(mode); setPictureInfo((i) => ({ ...(i || {}), ...r })); setTv((t) => t && { ...t, picture: r.mode }); say(t('picture_now', { mode: pictureInfo?.modes?.find((m) => m.id === r.mode)?.name || r.mode })); } catch (e) { say(e.message, 'err'); }
  };
  // iOS only raises the keyboard if focus happens inside the tap itself, and a closed sheet is inert
  // (cannot take focus), so open it synchronously, then focus, all within the same tap.
  const openAsk = () => { tick(); flushSync(() => setSheet('ask')); askInput.current?.focus({ preventScroll: true }); };

  const sleepEnds = tv?.sleep?.ends;
  const sleepLeft = sleepEnds ? `${Math.max(0, Math.round((new Date(sleepEnds) - Date.now()) / 60000))}m` : null;
  const p = tv?.playing;
  // Keep wearing the last show while an app or menu without artwork is up, so the remote never goes flat grey.
  const lastArt = useRef(null);
  const fresh = p?.backdrop || p?.poster || null;
  if (fresh) lastArt.current = fresh;
  const artTv = useRef(tvId);
  if (artTv.current !== tvId) { artTv.current = tvId; lastArt.current = null; }
  const appColour = appById[tv?.app?.id]?.colour;
  const dark = off || Boolean(offState);
  const artwork = dark ? null : (fresh || (appColour ? null : lastArt.current));
  const tint = dark ? '#101012' : (appColour || null);

  // Swipe down from the top (top bar, now playing, the Watch title) pulls the TV menu down with the finger.
  const moreSheet = useRef(null);
  const pull = usePullDown(moreSheet, () => { tick(); setSheet('more'); });

  // Remote and Watch are two pages side by side; the phone's own scrolling moves between them.
  const pager = useRef(null);
  const tabsRef = useRef(null);
  // After the Duo closes (two panes back to one), or the width changes, put the pages back on the
  // tab that is showing, so the visible page and the active tab always agree.
  useEffect(() => {
    const el = pager.current; if (wide || !el) return;
    el.scrollLeft = tab === 'watch' ? el.clientWidth : 0;
    tabsRef.current?.style.setProperty('--p', tab === 'watch' ? '1' : '0');
  }, [wide, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (t) => {
    tick(); const el = pager.current;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (el) el.scrollTo({ left: t === 'watch' ? el.clientWidth : 0, behavior: still ? 'auto' : 'smooth' });
    setTab(t);
  };
  const onPage = (e) => {
    const el = e.currentTarget; const p = el.scrollLeft / Math.max(1, el.clientWidth);
    tabsRef.current?.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(3));
    const t = p > 0.5 ? 'watch' : 'remote';
    if (t !== tab) setTab(t);
  };
  // The pill can be dragged like the iPhone home bar, and the whole dock (Ask and the tabs) takes a
  // sideways swipe like the pages above it, so paging works from the top of the screen to the bottom.
  const pill = usePageDrag(pager, (t) => goTo(t), 'thumb');
  const dockDrag = usePageDrag(pager, (t) => goTo(t), 'content');
  const tabs = (
    <nav ref={tabsRef} className="tabs glass" aria-label="Sections" {...pill}>
      <span className="tabs-thumb" aria-hidden="true" />
      <button className={tab === 'remote' ? 'on' : ''} aria-current={tab === 'remote'} onClick={() => goTo('remote')}><Ic.Remote size={18} /> {t('remote')}</button>
      <button className={tab === 'watch' ? 'on' : ''} aria-current={tab === 'watch'} onClick={() => goTo('watch')}><Ic.Grid size={18} /> {t('watch')}</button>
    </nav>
  );

  const remote = (
    <div className="remote-col">
      <div className="pull-zone" {...pull}>
      {(() => { const d = (thisTv || (tvs.length === 1 ? tvs[0] : null))?.devmode; if (!d?.warning) return null; const said = d.warning_key ? t(d.warning_key, d.warning_vars) : d.warning; return <div className={`devwarn ${d.level || 'warn'}`} role="alert">{said === d.warning_key ? d.warning : said}</div>; })()}
      <TopBar people={people} tvName={thisTv?.name} who={who} setWho={pickWho} tv={tv} appInfo={appById[tv?.app?.id]} reach={reach} sleepLeft={sleepLeft} onPower={onPower} onMore={() => setSheet('more')} />
      {tv?.idle?.ends && (
        <div className="banner glass" role="status">
          <span>{t('idle_auto_off', { n: Math.max(1, Math.round((new Date(tv.idle.ends) - Date.now()) / 60000)) })}</span>
          <button onClick={() => { tick(); run(api.cancelIdle(), t('idle_snoozed')).then(() => setTv((cur) => cur && ({ ...cur, idle: null }))).catch(() => {}); }}>{t('idle_still_here')}</button>
        </div>
      )}
      {tvId && <button className="tv-chip glass" onClick={() => { tick(); setSheet('more'); }}><Ic.Screen size={15} /> {t('this_tv', { name: thisTv?.name || t('this') })}</button>}
      <NowPlaying tv={tv} appInfo={appById[tv?.app?.id]} onKey={onKey} roomy={h >= 760} />
      </div>
      <Pad onPointer={(thisTv || (tvs.length === 1 ? tvs[0] : null))?.kind === 'lg' ? (d) => api.pointer(d) : null} onKey={onKey} offState={offState} wakeError={wakeError} onWake={onWake} onRetry={onRetry}
        tvName={thisTv?.name} onLivingRoom={() => { tick(); chooseTv(null); }} />
      <Controls tv={tv} onKey={onKey} onVolume={onVolume} />
      {wide && askOn && !kidIds.includes(who) && <AskButton onAsk={openAsk} quiet={Boolean(offState)} />}
    </div>
  );
  const watch = <Watch pull={pull} people={people} who={who || people[0]?.id || 'both'} recs={recs} cont={cont === undefined ? (recs === false ? false : recs?.continue) : cont} apps={apps} hidden={hidden} screens={screens} serviceName={serviceName} onPlay={onPlay} onLaunch={onLaunch} onScreen={onScreen} wide={wide} />;

  return (
    <div className={`app ${wide ? 'is-wide' : ''} ${offState ? 'is-off' : ''}`}>
      <Backdrop image={artwork} colour={tint} off={dark} />
      {reach === false && !wide && tab === 'watch' && (
        <div className="banner glass" role="status"><Ic.Wifi size={18} /><span><b>{t('cant_reach')}</b> {t('home_wifi')}</span>
          <button onClick={() => { tick(); onRetry(); }}>{t('try_again')}</button></div>
      )}
      {wide ? (
        <main className="split">{remote}<div className="watch-col">{watch}</div></main>
      ) : (
        <main className="single">
          <div ref={pager} className="pager" onScroll={onPage}>
            <section className="page" aria-label="Remote" inert={tab !== 'remote'}>{remote}</section>
            <section className="page watch-page" aria-label="Watch" inert={tab !== 'watch'}>{watch}</section>
          </div>
          <div className="dock" {...dockDrag}>
            {askOn && !kidIds.includes(who) && <AskButton onAsk={openAsk} quiet={Boolean(offState)} />}
            {tabs}
          </div>
        </main>
      )}
      {toast && <div key={toast.id} className={`toast glass ${toast.kind}`} role="status">{toast.text}</div>}
      <AskSheet ref={askInput} open={sheet === 'ask'} onClose={() => setSheet(null)} who={who} recs={recs} onAsk={onAsk} onDone={(reply) => say(reply)} />
      <MoreSheet ref={moreSheet} open={sheet === 'more'} tvs={tvs} tvId={tvId || 'living-room'} onTv={(id) => { tick(); chooseTv(id); }}
        picture={tv?.picture} pictureInfo={pictureInfo} onPicture={onPicture} onClose={() => setSheet(null)} sleepEnds={sleepEnds} sleepError={sleepError} onSleep={onSleep}
        onKey={onKey} onText={(text) => run(api.text(text), t('sent_to_tv'))} onArrange={() => setSheet('arrange')} onPeople={() => setSheet('people')} onKids={() => setSheet('kids')} />
      <ArrangeSheet open={sheet === 'arrange'} onClose={() => setSheet(null)} tvName={thisTv?.name} hidden={hidden} />
      <KidsSheet open={sheet === 'kids'} onClose={() => setSheet(null)} onChanged={loadConfig} />
      <PinSheet ask={pinAsk} onClose={() => setPinAsk(null)} />
      <PeopleSheet open={sheet === 'people'} onClose={() => setSheet(null)} onSaved={(list) => { setPeople(list); if (who && who !== 'both' && !list.some((p) => p.id === who)) setWho(list[0]?.id || 'both'); }} />
      {!who && people.length > 0 && <Onboarding people={people} standalone={standalone} onPick={pickWho} />}
    </div>
  );
}
