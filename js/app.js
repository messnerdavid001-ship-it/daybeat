// Entry point: boots theme, shell, data layer, then the router.
// Pages never import the data layer themselves; they receive it as ctx.data (easy to test, easy to mock).
import { initTheme, applyTheme, setPersist } from './ui/theme.js';
import { buildShell, setActive, announce } from './ui/shell.js';
import { startRouter, go } from './ui/router.js';
import { ROUTES, DEFAULT_ROUTE, routeById } from './ui/routes.js';
import { h, qs } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { APP_NAME } from './ui/brand.js';
import { mountNotices } from './ui/notices.js';
import { startAlerts } from './ui/alerts.js';

const view = qs('#view');
let data = null;            // the data-layer barrel (js/data/index.js), or null if it could not load
let storeInfo = null;       // result of store.init()
let current = null;         // { token, cleanup, controller }
let firstRender = true;
let routeToken = 0;

initTheme();
buildShell();

async function loadData() {
  try {
    data = await import('./data/index.js');
  } catch (err) {
    console.error('Data layer failed to load', err);
    return;
  }
  try {
    const { store, demo } = data;
    storeInfo = await store.init();
    if (storeInfo.firstRun && !storeInfo.readOnly) await demo.load();

    // theme + accent are persisted by the data layer (and mirrored for boot.js)
    applyTheme(store.settings.get('theme', 'system'), store.settings.get('accent', 'volt'));
    setPersist((key, value) => store.settings.set(key, value));

    // After the user's first real save, ask the browser to keep this data safe from clean-up (once).
    // Firefox would show a permission prompt for it, so it is skipped there; Safari and Chrome decide quietly.
    if (!/Firefox|FxiOS/.test(navigator.userAgent) && !store.settings.get('ui_persistAsked', false)) {
      const stop = store.onChange((ev) => {
        const userWrite = ev.reason === 'put' && ev.origin !== 'remote' && ev.kinds.some((k) => k !== 'action');
        if (!userWrite) return;
        stop();
        store.settings.set('ui_persistAsked', true).catch(() => {});
        store.requestPersistence().catch(() => {});
      });
    }
    store.onChange((ev) => {
      if (ev.reason === 'settings' || ev.reason === 'import' || ev.reason === 'wipe') {
        applyTheme(store.settings.get('theme', 'system'), store.settings.get('accent', 'volt'));
      }
      if (ev.reason === 'stale') toast('Daybeat was updated in another window. Reload to continue.', { duration: 0, action: { label: 'Reload', onClick: () => location.reload() } });
    });
  } catch (err) {
    console.error('Data layer failed to start', err);
    data = null;
  }
}

function makeContext(route, parsed, controller) {
  const unsubs = [];
  return {
    id: route.id,
    args: parsed.args,
    query: parsed.query,
    data,
    storeInfo,
    signal: controller.signal,
    go,
    toast,
    /** Re-render when any of these kinds change (or on '*'). Cleaned up when the user leaves the page. */
    watch(kinds, fn) {
      if (!data) return () => {};
      const off = data.store.onChange((ev) => {
        const k = ev.kinds || [];
        if (kinds === '*' || k.includes('*') || kinds.some((x) => k.includes(x) || x === ev.reason)) fn(ev);
      });
      unsubs.push(off);
      return off;
    },
    _dispose() { unsubs.forEach((u) => u()); unsubs.length = 0; },
  };
}

async function showRoute(parsed) {
  let route = routeById(parsed.id);
  if (!route) {
    // unknown or empty hash: go to the default page without leaving a history entry behind
    history.replaceState(null, '', location.pathname + location.search + '#/' + DEFAULT_ROUTE);
    route = routeById(DEFAULT_ROUTE);
    parsed = { id: route.id, args: [], query: new URLSearchParams() };
  }

  const token = ++routeToken;
  if (current) { try { current.cleanup?.(); } catch (e) { console.error(e); } current.ctx?._dispose(); current.controller.abort(); }
  const controller = new AbortController();
  const page = h('div', { class: 'page', 'data-page': route.id });
  view.replaceChildren(page);
  const ctx = makeContext(route, parsed, controller);
  current = { token, controller, ctx, cleanup: null };

  setActive(route.id);
  document.title = route.id === DEFAULT_ROUTE ? APP_NAME : `${route.label} · ${APP_NAME}`;

  try {
    const mod = await route.load();
    if (token !== routeToken) return;           // user already navigated elsewhere
    current.cleanup = (await mod.mount(page, ctx)) || null;
  } catch (err) {
    console.error('Page failed', route.id, err);
    if (token !== routeToken) return;
    page.replaceChildren(errorCard(err));
  }
  if (token !== routeToken) return;

  announce(route.label);
  if (!firstRender) {
    window.scrollTo(0, 0);
    const title = page.querySelector('h1');
    if (title) { title.setAttribute('tabindex', '-1'); title.classList.add('view-title'); title.focus({ preventScroll: true }); }
  }
  firstRender = false;
}

function errorCard(err) {
  return h('div', { class: 'card empty' },
    h('div', { class: 'empty__art' }, icon('info')),
    h('h1', null, 'That page did not load'),
    h('p', null, 'Something went wrong while opening this page. Your data is safe on this device. Try reloading.'),
    h('div', { class: 'cluster' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => location.reload() }, 'Reload'),
      h('a', { class: 'btn btn--ghost', href: '#/today' }, 'Back to Today'),
    ),
    h('p', { class: 'faint' }, String(err && err.message ? err.message : err)),
  );
}

async function main() {
  // A link like  .../#add=some%20text  is routed to Pings (saved messages) as a DRAFT that the user must confirm (see pages/messages.js).
  if (location.hash.startsWith('#add=')) {
    history.replaceState(null, '', location.pathname + location.search + '#/messages?text=' + location.hash.slice(5));
  }
  await loadData();
  mountNotices({ data, storeInfo });
  startRouter(showRoute);

  // service worker (offline + updates) lives in the data layer. `load` may already have fired by now.
  const registerWorker = () => {
    if (!data || !data.sw) return;
    try { if (localStorage.getItem('app.nosw') === '1') return; } catch (e) { /* storage blocked */ }   // developer switch: skip the offline cache while editing files
    data.sw.register({
      onUpdateReady: (apply) => toast('A new version is ready.', { duration: 0, action: { label: 'Reload', onClick: apply } }),
      onOfflineReady: () => toast('Ready to work offline.'),
      onError: (e) => console.warn('Service worker problem', e),
    });
  };
  if (document.readyState === 'complete') registerWorker(); else window.addEventListener('load', registerWorker, { once: true });

  // heads-up for alarms and timed tasks, only while the app is open (a closed web page cannot ring)
  if (data && storeInfo) { try { startAlerts(data); } catch (e) { console.warn('alerts not started', e); } }

  // first open of the day counts for the streak
  if (data && storeInfo && !storeInfo.readOnly) {
    try {
      const r = await data.game.award('visit');
      if (r && r.leveledUp) toast(`Level ${r.level}. Nice.`);
    } catch (e) { console.warn('visit award skipped', e); }
  }
}

main();
export { ROUTES };
