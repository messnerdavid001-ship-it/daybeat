// Hash router: works under any GitHub Pages sub-path with no server rewrites.
//   #/today   #/calendar/2026-11-25   #/messages?text=Hi
// A route is { id, args: string[], query: URLSearchParams }.

export function parseHash(hash = window.location.hash) {
  let s = String(hash || '').replace(/^#/, '');
  const q = s.indexOf('?');
  const pathPart = q === -1 ? s : s.slice(0, q);
  const queryPart = q === -1 ? '' : s.slice(q + 1);
  const segs = pathPart.split('/').filter(Boolean).map((seg) => {
    try { return decodeURIComponent(seg); } catch (e) { return seg; }
  });
  return { id: segs[0] || '', args: segs.slice(1), query: new URLSearchParams(queryPart) };
}

export function href(id, ...args) {
  return '#/' + [id, ...args].map((a) => encodeURIComponent(String(a))).join('/');
}

export function go(id, ...args) {
  window.location.hash = href(id, ...args);
}

/** Replace the current URL without adding history (and without firing hashchange). */
export function replaceHash(hash) {
  const url = window.location.pathname + window.location.search + (hash || '');
  window.history.replaceState(null, '', url);
}

const isRouteHash = (hash) => hash === '' || hash === '#' || hash.startsWith('#/');

export function startRouter(onRoute) {
  // Plain in-page anchors (for example the skip link's #view) are not routes: leave the page alone.
  const run = (isFirst) => {
    const hash = window.location.hash;
    if (!isFirst && !isRouteHash(hash)) return;
    onRoute(isRouteHash(hash) ? parseHash(hash) : { id: '', args: [], query: new URLSearchParams() });
  };
  const onHash = () => run(false);
  window.addEventListener('hashchange', onHash);
  run(true);
  return () => window.removeEventListener('hashchange', onHash);
}
