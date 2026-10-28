import { useEffect, useRef, useState } from 'react';
import * as Ic from './icons.jsx';
import { tick } from './haptics.js';
import { logoFor } from './appLogos.js';
import { Sheet, personColour } from './Sheets.jsx';
import { t } from './i18n.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// Who is watching. Up to 3 names (Both counts as one) sit side by side as a segmented switch, like on the TV. With 4 or
// more it becomes one round avatar button (the current person's initial) that opens a short list.
const SEG_MAX = 3;
function WhoSwitch({ people, who, setWho }) {
  const [open, setOpen] = useState(false);
  const list = people || [];
  const options = [...list.map((p) => ({ id: p.id, name: p.name, colour: personColour(p) })), { id: 'both', name: t('both') }];
  if (options.length <= SEG_MAX) {
    return (
      <div className="seg glass" role="tablist" aria-label={t('whos_watching')}>
        {options.map((o) => (
          <button key={o.id} role="tab" aria-selected={who === o.id} className={who === o.id ? 'on' : ''}
            onClick={() => { tick(); setWho(o.id); }}>{o.name}</button>
        ))}
      </div>
    );
  }
  const cur = options.find((o) => o.id === who) || options[0];
  const pick = (id) => { tick(); setWho(id); setOpen(false); };
  return (
    <>
      <button className="round glass who-btn" aria-haspopup="dialog" aria-label={t('whos_watching_change', { name: cur.name })}
        onClick={() => { tick(); setOpen(true); }}>
        <span className="person-dot who-dot" style={{ background: cur.colour || 'rgba(255,255,255,0.28)' }}>{cur.id === 'both' ? <Ic.People size={18} /> : cur.name.slice(0, 1).toUpperCase()}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('whos_watching')} className="who-sheet">
        <div role="radiogroup" aria-label={t('whos_watching')}>
          {options.map((o) => (
            <button key={o.id} role="radio" aria-checked={who === o.id} className={`who-row ${who === o.id ? 'on' : ''}`} onClick={() => pick(o.id)}>
              <span className="person-dot" style={{ background: o.colour || 'rgba(255,255,255,0.28)' }}>{o.id === 'both' ? <Ic.People size={18} /> : o.name.slice(0, 1).toUpperCase()}</span>
              <span className="who-name">{o.name}</span>
              {who === o.id && <span className="who-tick" aria-hidden="true">&#10003;</span>}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

export function TopBar({ people, tvName, who, setWho, tv, appInfo, reach, sleepLeft, onPower, onMore }) {
  const status = reach === false ? t('not_connected')
    : !tv ? t('connecting')
      : !tv.tv_connected ? t('tv_not_connected')
        : tv.waking ? t('waking')
        : tv.power === 'off' ? t('off')
          : tv.app?.id === 'home' ? t('home')
            : appInfo?.name || t('on');
  // The now playing row names the app, and the pad says Off, Waking or can't reach, so the bar
  // only speaks up for the home screen, connecting and the sleep timer.
  const isApp = !(reach !== false && tv?.tv_connected && tv.power === 'on' && !tv.waking && tv.app?.id === 'home');
  // The status slot shows the sleep timer and the home screen.
  const parts = [
    sleepLeft && <span key="sleep"><Ic.Moon size={12} /> {sleepLeft}</span>,
    !isApp && <span key="st">{status}</span>,
  ].filter(Boolean);
  return (
    <header className="topbar">
      <WhoSwitch people={people} who={who} setWho={setWho} />
      <div className={`tvname ${parts.length ? '' : 'is-app'}`}>
        <b>{tvName || t('tv')}</b>
        <span>{parts.length ? parts.reduce((acc, p, i) => (i ? [...acc, ' · ', p] : [p]), []) : status}</span>
      </div>
      <button className="round glass" aria-label={t('more_controls')} onClick={() => { tick(); onMore(); }}><Ic.More /></button>
      <button className={`round glass power ${tv?.power === 'on' ? 'is-on' : ''}`} aria-label={tv?.power === 'on' ? t('turn_off') : t('turn_on')}
        onClick={() => { tick(); onPower(); }}><Ic.Power /></button>
    </header>
  );
}

// "7 min in", never a bare 7:38 that reads as the time of day.
const minsIn = (ms) => (ms < 60000 ? t('just_started') : t('min_in', { n: Math.floor(ms / 60000) }));

// Where the show is up to. The bridge reads the app's own position every few seconds; between reads
// the clock runs on here while it plays. The TV gives no length and cannot jump to a time, so the
// bar (read only) appears only when the bridge knows the episode and its length from JustWatch.
function Progress({ p, appName }) {
  const [now, setNow] = useState(Date.now());
  const playing = p.state === 'playing';
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [playing]);
  const since = playing && p.updated ? Math.max(0, now - new Date(p.updated).getTime()) : 0;
  const pos = Math.min(p.duration_ms || Infinity, (p.position_ms || 0) + since);
  const word = { playing: t('st_playing'), paused: t('st_paused'), buffering: t('st_buffering'), stopped: t('st_stopped') }[p.state];
  if (!p.duration_ms) {
    return (
      <div className="scrub-elapsed">
        <span className="scrub-clock">{minsIn(pos)}</span>
        {word && <span className={`scrub-state ${p.state}`}>{word}{appName ? t('on_app', { app: appName }) : ''}</span>}
      </div>
    );
  }
  const frac = pos / p.duration_ms;
  const left = p.duration_ms - pos;
  return (
    <div className="scrub">
      <div className="scrub-track" role="progressbar" aria-label="Where the show is up to"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <div className="scrub-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="scrub-times">
        <span>{minsIn(pos)}</span>
        {appName && <span className="scrub-app">{appName}</span>}
        <span>{t(p.duration_source === 'justwatch' ? 'about_left' : 'min_left', { n: Math.max(1, Math.round(left / 60000)) })}</span>
      </div>
    </div>
  );
}

export function NowPlaying({ tv, appInfo, onKey, roomy }) {
  const p = tv?.playing;
  const off = !tv || tv.power === 'off' || !tv.tv_connected;
  const [open, setOpen] = useState(roomy);
  useEffect(() => setOpen(roomy), [roomy]);
  let art; let title; let sub; let epTitle = null;
  if (p && !off) {
    art = p.poster ? <img src={p.poster} alt="" /> : logoFor(appInfo)
      ? <img className="art-logo" src={logoFor(appInfo)} alt="" />
      : <div className="art-app" style={{ background: appInfo?.colour }} />;
    title = p.title;
    sub = [p.season && t('season', { n: p.season }), p.episode && t('episode', { n: p.episode })].filter(Boolean).join(' · ') || null;
    epTitle = p.episode_title || null;
    if (!sub && !epTitle) sub = appInfo?.name || tv.app?.name;
  } else if (!off && appInfo && tv.app.id !== 'home') {
    // Only apps the bridge knows by name: system screens (Assistant, settings) have raw codenames.
    art = logoFor(appInfo)
      ? <img className="art-logo" src={logoFor(appInfo)} alt="" />
      : <div className="art-app" style={{ background: appInfo.colour || '#3a3a3c' }}>{appInfo.name}</div>;
    title = appInfo.name;
    sub = t('app_open', { app: appInfo.name });
  } else {
    return null;
  }
  const key = (k) => () => { tick(); onKey(k); };
  return (
    <section className={`now ${open ? 'open' : ''}`} aria-label={t('now_on_tv')}>
      <div className="now-head">
        <span className="now-art">{art}</span>
        <span className="now-text"><span className="now-title">{title}</span>{sub && <span className="now-sub">{sub}</span>}{epTitle && <span className="now-ep">{epTitle}</span>}</span>
        <button className="round now-chev-btn" aria-expanded={open} aria-label={open ? 'Show fewer controls' : 'Show all playback controls'}
          onClick={() => { tick(); setOpen(!open); }}><Ic.Chevron className="now-chev" size={20} /></button>
      </div>
      {p?.position_ms != null && <Progress p={p} appName={appInfo?.name} />}
      {open && (
        <div className="transport">
          <button className="round glass" aria-label="Previous episode" onClick={key('previous')}><Ic.Prev /></button>
          <button className="round glass" aria-label="Back 10 seconds" onClick={key('rewind')}><Ic.Replay /></button>
          <button className="round glass" aria-label="Forward 10 seconds" onClick={key('fast_forward')}><Ic.Forward /></button>
          <button className="round glass" aria-label="Next episode" onClick={key('next')}><Ic.Next /></button>
          <button className="round glass" aria-label="Subtitles" onClick={key('captions')}><Ic.Captions /></button>
        </div>
      )}
    </section>
  );
}

// The swipe pad. One D-pad step per STEP points of travel, so a long drag scrolls a row;
// a quick flick sends one step. Only a tap inside the middle circle is OK (a long press there
// is a held OK); a tap anywhere else moves towards that side, and holding it keeps moving.
// So a stray tap near an arrow never selects something.
// One finger at a time: a second finger is ignored, so two thumbs never send a stray key.
const STEP = 56; const FLICK = 22; const HOLD_MS = 550; const OK_R = 64;
const REPEAT_AFTER = 420; const REPEAT_EVERY = 160;

function zoneAt(r, x, y) {
  const dx = x - (r.left + r.width / 2); const dy = y - (r.top + r.height / 2);
  if (Math.hypot(dx, dy) <= OK_R) return 'ok';
  const nx = dx / (r.width / 2); const ny = dy / (r.height / 2);
  return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : (ny > 0 ? 'down' : 'up');
}

const stopTimers = (s) => { if (s) { clearTimeout(s.timer); clearInterval(s.timer); } };

// `offState` is null when the TV can be driven, else 'off' | 'waking' | 'unreachable'.
export function Pad({ onKey, offState, wakeError, onWake, onRetry, tvName, onLivingRoom }) {
  const ref = useRef(null);
  const g = useRef(null);
  const [lit, setLit] = useState(null);
  const [spot, setSpot] = useState(null);
  const disabled = Boolean(offState);
  useEffect(() => () => stopTimers(g.current), []);

  const flash = (dir) => { setLit(dir); clearTimeout(flash.t); flash.t = setTimeout(() => setLit(null), 140); };
  const send = (dir) => { onKey(dir); flash(dir); };

  const down = (e) => {
    if (disabled || g.current || !e.isPrimary || e.target.closest?.('.pad-msg, .sr-only')) return;
    ref.current.setPointerCapture(e.pointerId);
    const r = ref.current.getBoundingClientRect();
    const zone = zoneAt(r, e.clientX, e.clientY);
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY, ax: e.clientX, ay: e.clientY, steps: 0, moved: false, t: Date.now(), held: false, zone };
    g.current = s;
    s.timer = zone === 'ok'
      ? setTimeout(() => { if (g.current === s && !s.moved) { s.held = true; onKey('ok', true); flash('ok'); } }, HOLD_MS)
      : setTimeout(() => {
        if (g.current !== s || s.moved) return;
        s.held = true; send(zone);
        s.timer = setInterval(() => { if (g.current === s && !s.moved) send(zone); else clearInterval(s.timer); }, REPEAT_EVERY);
      }, REPEAT_AFTER);
    setSpot({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const move = (e) => {
    const s = g.current; if (!s || e.pointerId !== s.id) return;
    const r = ref.current.getBoundingClientRect();
    setSpot({ x: e.clientX - r.left, y: e.clientY - r.top });
    const dx = e.clientX - s.ax; const dy = e.clientY - s.ay;
    // Once the finger travels, it is a swipe: any hold or repeat stops, so directions never mix.
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) { s.moved = true; stopTimers(s); }
    if (!s.moved) return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= STEP) {
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      send(dir); s.steps += 1;
      s.ax += DIRS[dir][0] * STEP; s.ay += DIRS[dir][1] * STEP;
      if (Math.abs(dx) > Math.abs(dy)) s.ay = e.clientY; else s.ax = e.clientX;
    }
  };
  const up = (e) => {
    const s = g.current; if (!s || e.pointerId !== s.id) return;
    g.current = null; setSpot(null);
    stopTimers(s);
    const dx = e.clientX - s.x; const dy = e.clientY - s.y;
    if (s.held && !s.moved) { tick(); return; }
    if (!s.moved) { send(s.zone); tick(); return; }
    if (s.steps === 0 && Math.max(Math.abs(dx), Math.abs(dy)) >= FLICK) {
      send(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }
    tick();
  };
  const cancel = (e) => { const s = g.current; if (!s || e.pointerId !== s.id) return; stopTimers(s); g.current = null; setSpot(null); };

  let overlay = <p className="hint">{t('tap_middle')}</p>;
  if (offState === 'unpaired') {
    overlay = (
      <div className="pad-msg" aria-live="polite">
        <p><b>{t('not_set_up_tv', { name: (tvName || t('this')).toLowerCase() })}</b> {t('not_set_up_tv_more')}</p>
        <button className="pill glass" onClick={onLivingRoom}>{t('use_living_room')}</button>
      </div>
    );
  } else if (offState === 'unreachable') {
    overlay = (
      <div className="pad-msg" aria-live="polite">
        <p><b>{t('cant_reach')}</b> {t('home_wifi')}</p>
        <button className="pill glass" onClick={() => { tick(); onRetry(); }}>{t('try_again')}</button>
      </div>
    );
  } else if (offState) {
    overlay = (
      <div className="pad-msg" aria-live="polite">
        <button className="wake solid" disabled={offState === 'waking'} onClick={() => { tick(); onWake(); }}>
          {offState === 'waking' ? <><span className="spinner dark" /> {t('waking_tv')}</> : <><Ic.Power size={20} /> {t('turn_on_tv')}</>}
        </button>
        {wakeError && offState !== 'waking' && <p className="wake-err">{wakeError}</p>}
      </div>
    );
  }

  return (
    <div ref={ref} className={`pad glass ${disabled ? 'is-off' : ''}`} role="group"
      aria-label="Swipe pad. Swipe or tap an arrow to move, tap the middle to select."
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      {!disabled && (
        <div className="sr-only">
          {[['up', 'Up'], ['left', 'Left'], ['ok', 'Select'], ['right', 'Right'], ['down', 'Down']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { tick(); send(k); }}>{label}</button>
          ))}
        </div>
      )}
      {['up', 'down', 'left', 'right'].map((d) => <Ic.Chevron key={d} className={`chev ${d} ${lit === d ? 'lit' : ''}`} />)}
      <div className={`ring ${lit === 'ok' ? 'lit' : ''}`} />
      {spot && <div className="spot" style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }} />}
      {overlay}
    </div>
  );
}

// A button that repeats while held (volume). A tap acts when the finger lifts, like any iOS button,
// and a hold starts repeating after a moment. If the finger slides more than 10 points first, it was
// a swipe between Remote and Watch, so nothing is sent and the page swipe takes over.
// Keyboard, VoiceOver and Switch Control send a plain click, which also works.
function useRepeat(fn) {
  const t = useRef({ timer: null, id: null });
  const lastPointer = useRef(0);
  const stop = () => { clearTimeout(t.current.timer); clearInterval(t.current.timer); t.current = { timer: null, id: null }; };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e) => {
      stop();
      const s = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, timer: null };
      t.current = s;
      s.timer = setTimeout(() => { s.fired = true; fn(); s.timer = setInterval(fn, 160); }, 380);
    },
    onPointerMove: (e) => {
      const s = t.current;
      if (s.id === e.pointerId && !s.fired && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) stop();
    },
    onPointerUp: (e) => {
      const s = t.current;
      if (s.id !== e.pointerId) return;
      if (!s.fired) fn();
      stop(); tick();
      lastPointer.current = Date.now();
    },
    onPointerCancel: stop,
    onClick: () => { if (Date.now() - lastPointer.current > 600) { tick(); fn(); } },
  };
}

// The bottom row, in thumb reach: back, home, play or pause, volume. Like Apple's TV Remote.
export function Controls({ tv, onKey, onVolume }) {
  const v = tv?.volume;
  const st = tv?.playing?.state;
  const upR = useRepeat(() => onVolume('up'));
  const downR = useRepeat(() => onVolume('down'));
  return (
    <div className="controls">
      <button className="round big glass" aria-label={t('back')} onClick={() => { tick(); onKey('back'); }}><Ic.Back /></button>
      <button className="round big glass" aria-label={t('home')} onClick={() => { tick(); onKey('home'); }}><Ic.Home /></button>
      <button className="round big glass" aria-label={st === 'playing' ? t('pause') : st === 'paused' ? t('play') : t('play_pause')}
        onClick={() => { tick(); onKey('play_pause'); }}>
        {st === 'playing' ? <Ic.Pause /> : st === 'paused' ? <Ic.Play /> : <Ic.PlayPause />}
      </button>
      <div className="volume glass" role="group" aria-label={t('volume')}>
        <button aria-label="Volume down" {...downR}><Ic.Minus /></button>
        <button className="vol-mid" aria-label={v?.muted ? 'Unmute' : 'Mute'} onClick={() => { tick(); onVolume('mute'); }}>
          {v?.muted ? <Ic.Muted size={20} /> : <Ic.Speaker size={20} />}
          {(v?.muted || v?.known) && <span>{v?.muted ? t('muted') : v.level}</span>}
        </button>
        <button aria-label="Volume up" {...upR}><Ic.Plus /></button>
      </div>
    </div>
  );
}

export function AskButton({ onAsk, quiet }) {
  return (
    <button className={`ask ${quiet ? 'quiet' : ''}`} onClick={onAsk}>
      <Ic.Mic size={22} /> {t('ask_for_show')}
    </button>
  );
}
