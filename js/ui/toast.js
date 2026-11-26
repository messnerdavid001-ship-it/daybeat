// Small status messages. Region is <div id="toasts" role="status" aria-live="polite"> in index.html.
import { h } from './dom.js';

const MAX_VISIBLE = 3;

/**
 * toast('Saved')                      -> auto-dismisses
 * toast('Alarm deleted', { action: { label: 'Undo', onClick } })
 * Returns a dismiss function. Text is always set as a text node.
 */
export function toast(message, { action, duration = 4200 } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return () => {};

  while (region.children.length >= MAX_VISIBLE) region.firstElementChild.remove();

  let timer = null;
  const el = h('div', { class: 'toast' },
    h('span', { class: 'toast__msg' }, message),
    action ? h('button', { type: 'button', class: 'toast__btn', onclick: () => { dismiss(); action.onClick?.(); } }, action.label) : null,
  );

  function dismiss() {
    if (!el.isConnected || el.classList.contains('is-leaving')) return;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 400);
  }

  region.appendChild(el);
  if (duration > 0) timer = setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
  return dismiss;
}

