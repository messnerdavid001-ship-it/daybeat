// Small shared building blocks for pages.
import { h } from './dom.js';
import { icon } from './icons.js';

export function pageHead({ eyebrow, title, lede, actions }) {
  return h('header', { class: 'page-head' },
    eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
    h('div', { class: 'page-head__row' },
      h('h1', null, title),
      actions ? h('div', { class: 'cluster page-head__actions' }, actions) : null,
    ),
    lede ? h('p', { class: 'lede' }, lede) : null,
  );
}

/** Empty state that invites an action. actions = array of buttons/links */
export function emptyState({ iconName = 'sparkle', title, text, actions = [], compact = false }) {
  return h('div', { class: 'empty' + (compact ? ' empty--compact' : '') },
    h('div', { class: 'empty__art' }, icon(iconName)),
    h('h2', null, title),
    text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'cluster' }, ...actions) : null,
  );
}

export function sectionHead(title, trailing) {
  return h('div', { class: 'section-head' }, h('h2', null, title), trailing || null);
}

export function button(label, { kind = 'tonal', iconName, onClick, type = 'button', ...rest } = {}) {
  return h('button', { type, class: `btn btn--${kind}${rest.small ? ' btn--sm' : ''}${rest.block ? ' btn--block' : ''}`, onclick: onClick, ...(rest.attrs || {}) },
    iconName ? icon(iconName) : null, label);
}

export function link(label, href, { kind = 'ghost', iconName, small } = {}) {
  return h('a', { class: `btn btn--${kind}${small ? ' btn--sm' : ''}`, href }, iconName ? icon(iconName) : null, label);
}

/** Re-render while keeping keyboard focus on the element with the same data-fk (focus key). */
export function keepFocus(root, renderFn) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.getAttribute('data-fk') : null;
  renderFn();
  if (key) {
    const again = root.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      // keep the caret where it was in text boxes
      if (again.setSelectionRange && active && typeof active.selectionStart === 'number') {
        try { again.setSelectionRange(active.selectionStart, active.selectionEnd); } catch (e) { /* not a text field */ }
      }
    }
  }
}

/** Run fn every `ms` while the page is mounted and visible. Returns a stop function. */
export function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  const onVis = () => { if (!document.hidden) fn(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
}

export function dataMissingCard() {
  return h('div', { class: 'card' },
    emptyState({ iconName: 'info', title: 'Storage is not available', text: 'The app could not open its data store, so this page cannot show anything yet. Try reloading.',
      actions: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => location.reload() }, 'Reload')] }),
  );
}
