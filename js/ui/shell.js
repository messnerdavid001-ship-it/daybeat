// Builds the navigation (sidebar, phone tab bar, top-bar buttons) from the route table and keeps it in sync.
import { h, qs } from './dom.js';
import { icon } from './icons.js';
import { href } from './router.js';
import { ROUTES } from './routes.js';

function navLink(route, className) {
  return h('a', { class: className, href: href(route.id), 'data-route': route.id },
    icon(route.icon),
    h('span', { class: className === 'tab' ? 'tab__label' : null }, route.label),
  );
}

export function buildShell() {
  // desktop sidebar: all pages
  const side = qs('#side-nav');
  side.replaceChildren(...ROUTES.filter((r) => !r.hidden).map((r) => navLink(r, 'nav-link')));

  // phone tab bar: the five main pages
  const tabs = qs('#tabbar-list');
  tabs.replaceChildren(...ROUTES.filter((r) => r.tab).map((r) => h('li', null, navLink(r, 'tab'))));

  // phone top bar: the pages that do not fit in the tab bar, as labelled icon buttons
  const actions = qs('#topbar-actions');
  for (const r of ROUTES.filter((x) => !x.tab && !x.hidden)) {
    actions.appendChild(h('a', { class: 'icon-btn only-phone', href: href(r.id), 'data-route': r.id, 'aria-label': r.label }, icon(r.icon)));
  }

  // The skip link keeps href="#view" as a no-JS fallback, but must not touch the hash router.
  const skip = qs('.skip-link');
  if (skip) skip.addEventListener('click', (e) => { e.preventDefault(); const v = qs('#view'); if (v) v.focus({ preventScroll: false }); });

  watchScroll();
  updateDate();
}

export function setActive(id) {
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.getAttribute('data-route') === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function watchScroll() {
  const bar = qs('.topbar');
  let ticking = false;
  const update = () => { bar.classList.toggle('is-scrolled', window.scrollY > 4); ticking = false; };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

export function updateDate() {
  const el = qs('#topbar-date');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Screen-reader announcement for route changes (the visible h1 also receives focus). */
export function announce(text) {
  const el = qs('#route-announcer');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}
