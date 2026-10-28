import { useEffect, useState } from 'react';
import * as Ic from './icons.jsx';
import { tick } from './haptics.js';
import { logoFor } from './appLogos.js';
import { t } from './i18n.js';

// Names that fit under an icon, like the iPhone home screen.
const SHORT = { 'sbs-on-demand': 'SBS', 'prime-video': 'Prime Video', 'disney-plus': 'Disney+', 'paramount-plus': 'Paramount+', 'foxtel-go': 'Foxtel', 'hbo-max': 'HBO Max' };

function episode(s) {
  return [s.season && `S${s.season}`, s.episode && `E${s.episode}`].filter(Boolean).join(' · ');
}

function Poster({ show, sub, onPlay, dim }) {
  return (
    <button className={`poster ${dim ? 'dim' : ''}`} onClick={() => { tick(); onPlay(show); }}>
      <div className="poster-art">{show.poster ? <img src={show.poster} alt="" loading="lazy" /> : <span>{show.title}</span>}</div>
      <b>{show.title}</b>
      <small>{sub}</small>
    </button>
  );
}

export function Watch({ pull, people, who, recs, cont: contIn, apps, screens, serviceName, onPlay, onLaunch, onScreen, wide }) {
  const cont = contIn || [];
  const picks = (recs?.picks || []).filter((s) => s.playable !== false);
  const ready = (screens || []).filter((s) => s.ready);
  const [showPicks, setShowPicks] = useState(false);
  useEffect(() => setShowPicks(false), [who]);
  return (
    <div className={`watch ${wide ? 'wide' : ''}`}>
      {!wide && <div className="pull-zone" {...pull}><h2 className="large-title">{t('watch')}</h2></div>}

      <section>
        <h3>{t('keep_watching')}{who !== 'both' ? <span className="h3-who"> · {(people || []).find((p) => p.id === who)?.name || ''}</span> : null}</h3>
        {cont.length ? (
          <div className="shelf">
            {cont.map((s) => <Poster key={s.id || `${s.title}-${s.service}`} show={s} onPlay={onPlay}
              sub={[episode(s) || s.episode_title, s.app?.name || serviceName(s.service)].filter(Boolean).join(' · ')} />)}
          </div>
        ) : <p className="empty">{contIn === false ? t('couldnt_load') : contIn ? t('shows_wait') : t('loading')}</p>}
      </section>

      <section>
        <h3>{t('apps')}</h3>
        {apps === null && <p className="empty">{t('loading')}</p>}
        {apps === false && <p className="empty">{t('couldnt_load_apps')}</p>}
        <div className="apps">
          {(apps || []).filter((a) => a.installed !== false && !['settings', 'home', 'moonlight'].includes(a.id)).map((a) => (
            <button key={a.id} className="app-tile" style={{ '--tile': a.colour || '#3a3a3c' }} onClick={() => { tick(); onLaunch(a); }}>
              <span className="app-icon">{logoFor(a) ? <img src={logoFor(a)} alt="" /> : <span className="app-icon-name">{a.name}</span>}</span>
              <span className="app-label">{SHORT[a.id] || a.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{t('ideas_tonight')}</h3>
        {!showPicks ? (
          <button className="row-btn cell" onClick={() => { tick(); setShowPicks(true); }}>
            <span className="row-icon"><Ic.Sparkle /></span>
            <span className="row-text"><b>{t('suggest')}</b><small>{t('suggest_sub')}</small></span>
            <Ic.Chevron className="row-chev" />
          </button>
        ) : picks.length ? (
          <div className="shelf">
            {picks.map((s) => <Poster key={`${s.title}-p`} show={s} onPlay={onPlay} sub={s.reason} />)}
          </div>
        ) : <p className="empty">{recs === false ? t('couldnt_load_ideas') : recs ? t('no_ideas') : t('loading')}</p>}
      </section>

      {ready.length > 0 && (
        <section>
          <h3>{t('screens')}</h3>
          {ready.map((s) => (
            <button key={s.id} className={`row-btn cell ${s.ready ? '' : 'not-ready'}`} onClick={() => { tick(); onScreen(s); }}>
              <span className="row-icon"><Ic.Screen /></span>
              <span className="row-text"><b>{s.name}</b><small>{s.ready ? t('screen_sub') : s.note}</small></span>
              <Ic.Chevron className="row-chev" />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
