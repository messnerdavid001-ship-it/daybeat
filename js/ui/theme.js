// Theme + accent. The first paint is handled by js/ui/boot.js; this module changes them live.
// Persistence: the data layer owns it (store.settings 'theme' / 'accent', mirrored to localStorage
// 'app.theme' / 'app.accent' for boot.js). app.js wires that in with setPersist(); until then (or if the
// data layer is unavailable) we write the two localStorage keys ourselves so the shell still works.

export const THEMES = [
  { id: 'system', label: 'Auto', icon: 'auto' },
  { id: 'dark',   label: 'Dark', icon: 'moon' },
  { id: 'light',  label: 'Light', icon: 'sun' },
];

// `color` only feeds the swatch preview; the real values live in css/tokens.css
export const ACCENTS = [
  { id: 'volt',      label: 'Volt',      color: 'linear-gradient(135deg,#c6f432,#9be84a)' },
  { id: 'bubblegum', label: 'Bubblegum', color: 'linear-gradient(135deg,#ff5ca8,#ff7a6b)' },
  { id: 'sky',       label: 'Sky',       color: 'linear-gradient(135deg,#5cc8ff,#6fa3ff)' },
  { id: 'sunset',    label: 'Sunset',    color: 'linear-gradient(135deg,#ff8a3d,#ff6b57)' },
  { id: 'grape',     label: 'Grape',     color: 'linear-gradient(135deg,#9b7bff,#c47bff)' },
  { id: 'mint',      label: 'Mint',      color: 'linear-gradient(135deg,#3ddba4,#3dcfd9)' },
];

const BG = { dark: '#0f1115', light: '#f6f2ea' };
const root = document.documentElement;
let persist = null;
const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function setPersist(fn) { persist = typeof fn === 'function' ? fn : null; }

export function getTheme() { return root.getAttribute('data-theme-pref') || 'system'; }
export function getAccent() { return root.getAttribute('data-accent') || 'volt'; }
export function resolvedTheme() { return root.getAttribute('data-theme') || 'dark'; }

function resolve(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return mql && mql.matches ? 'light' : 'dark';
}

function paint(pref, accent) {
  const resolved = resolve(pref);
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-pref', pref);
  root.setAttribute('data-accent', accent);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', BG[resolved]);
    m.removeAttribute('media');
  });
  document.dispatchEvent(new CustomEvent('themechange', { detail: { pref, resolved, accent } }));
}

/** Apply values that came from storage (import, other tab). Does not persist. */
export function applyTheme(pref = 'system', accent = 'volt') {
  if (!THEMES.some((t) => t.id === pref)) pref = 'system';
  if (!ACCENTS.some((a) => a.id === accent)) accent = 'volt';
  paint(pref, accent);
}

function save(key, value) {
  if (persist) {
    Promise.resolve(persist(key, value)).catch(() => { /* data layer said no: keep the visual change */ });
  } else {
    try { localStorage.setItem('app.' + key, value); } catch (e) { /* storage blocked */ }
  }
}

export function setTheme(pref) {
  if (!THEMES.some((t) => t.id === pref)) return;
  paint(pref, getAccent());
  save('theme', pref);
}

export function setAccent(id) {
  if (!ACCENTS.some((a) => a.id === id)) return;
  paint(getTheme(), id);
  save('accent', id);
}

export function initTheme() {
  if (mql && mql.addEventListener) {
    mql.addEventListener('change', () => { if (getTheme() === 'system') paint('system', getAccent()); });
  }
}
