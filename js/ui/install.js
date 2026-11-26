// "Install this app" help: detection, the install guide sheet, and the running-as chip.
// Honest about iOS: no install prompt exists there, so we show Share > Add to Home Screen, and we say plainly
// that the Safari tab and the installed app keep SEPARATE data (install first, then add your data).
import { h } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { APP_NAME } from './brand.js';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; notify(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
export function onInstallStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function detect() {
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPadOS reports as Mac
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const android = /Android/.test(ua);
  const mac = !ios && /Mac/.test(navigator.platform || ua);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  let browser = 'other';
  if (/EdgiOS|Edg\//.test(ua)) browser = 'edge';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'chrome';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/Safari\//.test(ua)) browser = 'safari';
  const os = ios ? 'ios' : android ? 'android' : mac ? 'mac' : /Win/.test(ua) ? 'windows' : 'other';
  const phone = ios || android;
  return { os, browser, standalone, phone, canPrompt: !!deferredPrompt };
}

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const p = deferredPrompt;
  deferredPrompt = null;
  p.prompt();
  const choice = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
  notify();
  return choice.outcome;
}

/** Small chip telling people which store they are in (installed app vs browser tab). */
export function runningChip() {
  const { standalone } = detect();
  return h('span', { class: 'chip ' + (standalone ? 'chip--good' : '') },
    icon(standalone ? 'phone' : 'desktop'),
    standalone ? 'Running as installed app' : 'Running in the browser',
  );
}

const glyph = (name, label) => h('span', { class: 'glyph-inline', role: 'img', 'aria-label': label }, icon(name));

function step(title, text) {
  return h('li', null, h('div', null, h('div', { class: 'steps__title' }, title), text ? h('div', { class: 'steps__text' }, text) : null));
}

function panelIphone() {
  return h('div', { class: 'stack' },
    h('ol', { class: 'steps' },
      step('Open this page in Safari', 'Use the address you were sent. Other iPhone browsers can add it too, from their Share menu.'),
      step(['Tap the Share button ', glyph('share', 'Share')], 'It is the square with an arrow pointing up. If you cannot see it, tap the ... button first.'),
      step(['Scroll down and tap Add to Home Screen ', glyph('plus-square', 'Add to Home Screen')], 'If you see Open as Web App, leave it switched on.'),
      step('Tap Add', `${APP_NAME} now has its own icon. Open it from the Home Screen from now on.`),
    ),
    dataNote(),
  );
}

function panelAndroid() {
  const { canPrompt } = detect();
  return h('div', { class: 'stack' },
    canPrompt ? installButton() : null,
    h('ol', { class: 'steps' },
      step('Open this page in Chrome'),
      step(['Open the menu ', glyph('more', 'Menu')], 'The three dots at the top right.'),
      step('Tap Install app (or Add to Home screen)', 'Confirm, and the icon appears on your Home screen.'),
    ),
    dataNote(),
  );
}

function panelComputer() {
  const { canPrompt, os, browser } = detect();
  return h('div', { class: 'stack' },
    canPrompt ? installButton() : null,
    h('ol', { class: 'steps' },
      step('Chrome or Edge', 'Click the install icon at the right end of the address bar, or open the browser menu and choose Install. It then opens in its own window.'),
      step('Safari on a Mac (Sonoma or newer)', 'Choose File, then Add to Dock.'),
      step('Firefox', 'Firefox on computers cannot install web apps. Bookmark the page instead, it works the same in a tab.'),
    ),
    (os === 'mac' && browser === 'safari') || os === 'windows' || os === 'other' ? null : null,
    dataNote(),
  );
}

function installButton() {
  const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block', onclick: async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') btn.textContent = 'Installed. Open it from your apps.';
  } }, icon('download'), `Install ${APP_NAME}`);
  return btn;
}

function dataNote() {
  return h('div', { class: 'card card--tight' },
    h('div', { class: 'card__title' }, 'Install first, then add your data'),
    h('p', { class: 'card__sub' },
      'The browser and the installed app keep separate copies of your data, on your device only. Anything you added in a Safari tab will not show up in the installed app. To move it: Settings, Data, Export a backup in the browser, then Import it in the installed app.'),
  );
}

export function installGuideContent() {
  const d = detect();
  const initial = d.os === 'ios' ? 'ios' : d.os === 'android' ? 'android' : 'computer';
  const panels = { ios: panelIphone(), android: panelAndroid(), computer: panelComputer() };
  const holder = h('div', null);
  const show = (key) => { holder.replaceChildren(panels[key]); };

  const name = 'install-platform';
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Choose your device' },
    ...[['ios', 'iPhone'], ['android', 'Android'], ['computer', 'Computer']].map(([key, label]) =>
      h('label', null,
        h('input', { type: 'radio', name, value: key, checked: key === initial, onchange: () => show(key) }),
        h('span', null, label),
      )),
  );
  show(initial);

  return h('div', { class: 'stack' },
    d.standalone ? h('p', { class: 'chip chip--good' }, icon('check'), 'You are already using the installed app.') : null,
    seg,
    holder,
    h('p', { class: 'faint' }, 'Web apps cannot ring alarms or send reminders while closed. Your watch does the buzzing, this app keeps the score.'),
  );
}

export function openInstallGuide() {
  return openSheet({
    title: `Install ${APP_NAME}`,
    content: installGuideContent(),
    footer: [],
  });
}
