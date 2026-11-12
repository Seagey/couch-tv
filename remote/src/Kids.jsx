// Kids mode on the phone (docs/CONFIG.md, "Kids mode"): pick a kids profile, type the parent PIN
// once, then add shows by searching, remove them, choose the few apps the TV may show, change the
// PIN or switch kids mode off. Someone who is not a kids profile yet can be made one, with a new PIN.
// The PIN stays in this sheet's memory while it is open and is never saved on the phone.
import { useEffect, useRef, useState } from 'react';
import * as Ic from './icons.jsx';
import { tick } from './haptics.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { Sheet } from './Sheets.jsx';

const digits = (v) => v.replace(/\D/g, '').slice(0, 8);
const ok = (v) => /^\d{4,8}$/.test(v);

function PinField({ value, onChange, label, onSubmit, autoFocus }) {
  return (
    <form className="ask-field glass kids-pin" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={value} maxLength={8}
        onChange={(e) => onChange(digits(e.target.value))} placeholder={label} aria-label={label} autoFocus={autoFocus} />
      {onSubmit && <button type="submit" className="round solid small" aria-label={t('kids_unlock')} disabled={!ok(value)}><Ic.Send size={18} /></button>}
    </form>
  );
}

// The parent PIN, asked for once (moving the TV away from a kids profile)
export function PinSheet({ ask, onClose }) {
  const [pin, setPin] = useState('');
  useEffect(() => { setPin(''); }, [ask]);
  const go = () => { if (ok(pin)) { tick(); ask.go(pin); onClose(); } };
  return (
    <Sheet open={Boolean(ask)} onClose={onClose} title={t('kids_parent_pin')} className="arrange-sheet">
      <p className="note arrange-lede">{ask?.msg}</p>
      <PinField value={pin} onChange={setPin} label={t('kids_parent_pin')} onSubmit={go} />
    </Sheet>
  );
}

export function KidsSheet({ open, onClose, onChanged }) {
  const [data, setData] = useState(null);        // {kids, people} from the bridge
  const [who, setWho] = useState(null);           // the person being looked at
  const [pin, setPin] = useState('');             // typed PIN
  const [unlocked, setUnlocked] = useState(null); // {who, pin} once the PIN was right
  const [newPin, setNewPin] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);       // a search result
  const [apps, setApps] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const search = useRef(null);

  const load = (keep) => api.kids().then((d) => {
    setData(d);
    if (!keep) {
      const first = (d.kids || [])[0]?.id || (d.people || [])[0]?.id || null;
      setWho(first);
    }
  }).catch((e) => { setData({ kids: [], people: [] }); setMsg(e.status === 404 ? t('kids_needs_update') : e.message); });

  useEffect(() => {
    if (!open) return;
    setData(null); setPin(''); setUnlocked(null); setNewPin(''); setQuery(''); setFound(null); setMsg('');
    load(false);
    api.apps().then((a) => setApps((a.apps || []).filter((x) => x.installed !== false && x.id !== 'home' && x.id !== 'settings'))).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const kid = data?.kids?.find((k) => k.id === who) || null;
  const person = data?.people?.find((p) => p.id === who) || null;
  const isOpen = unlocked && unlocked.who === who;

  const change = (body, done) => {
    setBusy(true); setMsg('');
    return api.kidsChange({ who, pin: unlocked?.pin || pin, ...body })
      .then((d) => { setData((x) => ({ ...(x || {}), kids: d.kids })); if (done) setMsg(done); onChanged?.(); return d; })
      .catch((e) => { setMsg(e.message); throw e; })
      .finally(() => setBusy(false));
  };
  const unlock = () => change({ action: 'check' }).then(() => { tick(); setUnlocked({ who, pin }); setPin(''); }).catch(() => setPin(''));
  const turnOn = () => api.kidsChange({ who, action: 'on', new_pin: newPin })
    .then((d) => { tick(); setData((x) => ({ ...(x || {}), kids: d.kids, people: (x?.people || []).map((p) => (p.id === who ? { ...p, kids: true } : p)) }));
      setUnlocked({ who, pin: newPin }); setNewPin(''); setMsg(t('kids_on_done', { name: person?.name || '' })); onChanged?.(); })
    .catch((e) => setMsg(e.message));

  const find = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setFound('…'); setMsg('');
    api.find(q).then((d) => setFound(d.result)).catch((er) => { setFound(null); setMsg(er.message); });
  };
  const add = (service) => {
    const r = found;
    tick();
    change({ action: 'add', show: { title: r.title, service, poster: r.poster, backdrop: r.backdrop } }, t('kids_added', { title: r.title }))
      .then(() => { setFound(null); setQuery(''); }).catch(() => {});
  };
  const remove = (s) => { tick(); change({ action: 'remove', id: s.id }, t('kids_removed', { title: s.title })).catch(() => {}); };
  const allowed = (kid?.apps || []).map((a) => a.package);
  const toggleApp = (pkg) => {
    tick();
    const next = allowed.includes(pkg) ? allowed.filter((p) => p !== pkg) : [...allowed, pkg];
    change({ action: 'apps', apps: next }).catch(() => {});
  };
  const setNew = () => change({ action: 'pin', new_pin: newPin }, t('kids_pin_changed'))
    .then(() => { setUnlocked({ who, pin: newPin }); setNewPin(''); }).catch(() => {});
  const turnOff = () => change({ action: 'off' }, t('kids_off_done', { name: person?.name || '' }))
    .then(() => { setUnlocked(null); setData((x) => ({ ...(x || {}), people: (x?.people || []).map((p) => (p.id === who ? { ...p, kids: false } : p)) })); }).catch(() => {});

  const playable = (found && typeof found === 'object' ? found.providers || [] : []).filter((p) => p.playable && p.kind !== 'rent' && p.kind !== 'buy');

  return (
    <Sheet open={open} onClose={onClose} title={t('kids_mode')} className="arrange-sheet kids-sheet">
      <p className="note arrange-lede">{t('kids_lede')}</p>
      {data === null && <p className="note">{t('loading')}</p>}
      {data && (data.people || []).length > 0 && (
        <div className="chips-row chips-wrap" role="radiogroup" aria-label={t('kids_who')}>
          {data.people.map((p) => (
            <button key={p.id} role="radio" aria-checked={p.id === who} className={`chip glass ${p.id === who ? 'on' : ''}`}
              onClick={() => { tick(); setWho(p.id); setMsg(''); setPin(''); setFound(null); }}>
              {p.kids && <Ic.Lock size={14} />} {p.name}
            </button>
          ))}
        </div>
      )}

      {person && !kid && (
        <section className="more-block">
          <h3><Ic.People size={16} /> {t('kids_make', { name: person.name })}</h3>
          <p className="note">{t('kids_make_note')}</p>
          <PinField value={newPin} onChange={setNewPin} label={t('kids_new_pin')} onSubmit={turnOn} />
        </section>
      )}

      {kid && !isOpen && (
        <section className="more-block">
          <h3><Ic.Lock size={16} /> {t('kids_unlock_for', { name: kid.name })}</h3>
          <PinField value={pin} onChange={setPin} label={t('kids_parent_pin')} onSubmit={unlock} autoFocus />
        </section>
      )}

      {kid && isOpen && (
        <>
          <section className="more-block">
            <h3>{t('kids_shelf', { name: kid.name })}</h3>
            {kid.shows.length === 0 && <p className="note">{t('kids_shelf_empty')}</p>}
            <ol className="arrange">
              {kid.shows.map((s) => (
                <li key={s.id} className="arrange-row glass">
                  {s.poster ? <img src={s.poster} alt="" /> : <span className="arrange-blank" />}
                  <b>{s.title}<small className="kids-sub">{[s.app?.name, s.season ? `S${s.season}${s.episode ? ` E${s.episode}` : ''}` : ''].filter(Boolean).join(' · ')}</small></b>
                  <button className="person-remove" aria-label={t('kids_remove', { title: s.title })} disabled={busy} onClick={() => remove(s)}><Ic.Close size={18} /></button>
                </li>
              ))}
            </ol>
            <form className="ask-field glass person-add" onSubmit={find}>
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('kids_search')} enterKeyHint="search" aria-label={t('kids_search')} />
              <button type="submit" className="round solid small" aria-label={t('kids_search')} disabled={!query.trim()}><Ic.Plus size={18} /></button>
            </form>
            {found === '…' && <p className="note">{t('loading')}</p>}
            {found && typeof found === 'object' && (
              <div className="kids-found glass">
                {found.poster && <img src={found.poster} alt="" />}
                <div>
                  <b>{found.title}{found.year ? ` (${found.year})` : ''}</b>
                  <p className="note">{playable.length ? t('kids_add_on') : t('kids_not_here')}</p>
                  <div className="chips-row chips-wrap">
                    {playable.map((p) => <button key={p.service} className="chip glass" disabled={busy} onClick={() => add(p.service)}>{p.name}</button>)}
                    {!playable.length && <button className="chip glass" disabled={busy} onClick={() => add(undefined)}>{t('kids_add_anyway')}</button>}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="more-block">
            <h3>{t('kids_apps')}</h3>
            <p className="note">{t('kids_apps_note')}</p>
            <div className="chips-row chips-wrap">
              {apps.map((a) => (
                <button key={a.package} role="switch" aria-checked={allowed.includes(a.package)} disabled={busy || (!allowed.includes(a.package) && allowed.length >= 6)}
                  className={`chip glass ${allowed.includes(a.package) ? 'on' : ''}`} onClick={() => toggleApp(a.package)}>{a.name}</button>
              ))}
            </div>
          </section>

          <section className="more-block">
            <h3>{t('kids_change_pin')}</h3>
            <PinField value={newPin} onChange={setNewPin} label={t('kids_new_pin')} onSubmit={setNew} />
            <button className="pill glass kids-off" disabled={busy} onClick={turnOff}>{t('kids_turn_off', { name: kid.name })}</button>
          </section>
        </>
      )}
      {msg && <p className="note arrange-msg" role="status">{msg}</p>}
    </Sheet>
  );
}
