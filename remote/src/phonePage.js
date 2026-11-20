// The phone's Home settings page (/setup) from the phone remote: Home settings on this phone, and
// Widgets on this TV (Sheets.jsx PhonePage). Plain functions, so tests/test_remote_phone_page.mjs runs
// them in node.

// Whether the page is there: the on-TV app serves it (its pairing script sets window.couchTv); a home
// computer serves it once its /api/health says phone_page (one without the page never says so).
export function hasPhonePage(onTv, health) {
  return !!onTv || (!!health && health.phone_page === true);
}

// The widgets on the TV's design that have settings to change on the phone: the same records the page
// draws (widget-caps.js settings, pre: true, where tv or phone, handed over in the At home view as
// design.widgets), each with at least one setting that shows now.
export function widgetsOf(j) {
  const d = j && j.live && j.athome && j.athome.design;
  if (!d || !d.on || !Array.isArray(d.widgets)) return [];
  return d.widgets.filter((w) => w && typeof w.key === 'string' && w.key && (w.settings || []).some((s) => s && s.shown !== false));
}

// The page at one widget: #widget=<id>, the id the TV's Hold OK, Edit on your phone QR carries (the
// widget's key is "<id>|<kind>"; the page opens the box whose key starts with that id).
export function phonePageLink(w, tv) {
  const k = String((w && w.key) || '');
  const id = k.lastIndexOf('|') > 0 ? k.slice(0, k.lastIndexOf('|')) : k;
  return setupLink(tv) + '#widget=' + encodeURIComponent(id);
}

// The page for the TV this remote drives: a home computer with more than one TV serves each TV's page at
// /setup?tv=<id> (the id the remote sends with every call, api.js tvId). No TV chosen: the default one.
// Only an id the page itself reads (setup.html TVQ: letters, digits, _ and -) is added.
export function setupLink(tv) {
  return '/setup' + (tv && /^[A-Za-z0-9_-]{1,40}$/.test(String(tv)) ? '?tv=' + tv : '');
}
