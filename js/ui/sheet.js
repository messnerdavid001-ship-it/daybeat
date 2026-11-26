// Modal sheet on a native <dialog>: focus trap, Esc to close, inert background and focus return come free.
// Bottom sheet on phones, centred card on wide screens (css/components.css).
import { h } from './dom.js';
import { icon } from './icons.js';

let uid = 0;
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * openSheet({ title, content, footer, dismissible, onClose, initialFocus })
 *  - content / footer: Node(s) built with h()
 *  - dismissible: false = Esc / backdrop / X do nothing (use for "must choose" dialogs)
 * Returns { el, close(result), setDismissible(bool) }.
 */
export function openSheet({ title, content, footer, dismissible = true, onClose, initialFocus, className = '' }) {
  const titleId = 'sheet-title-' + (++uid);
  let canDismiss = dismissible;
  let closing = false;

  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => close('x') }, icon('x'));
  const dialog = h('dialog', { class: 'sheet ' + className, 'aria-labelledby': titleId },
    h('div', { class: 'sheet__panel' },
      h('div', { class: 'sheet__grab', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet__head' },
        h('h2', { id: titleId }, title),
        closeBtn,
      ),
      h('div', { class: 'sheet__body' }, content),
      footer ? h('div', { class: 'sheet__foot' }, footer) : null,
    ),
  );

  function close(result) {
    if (closing) return;
    closing = true;
    const finish = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
      if (onClose) onClose(result);
    };
    if (reducedMotion()) finish();
    else {
      dialog.classList.add('is-closing');
      setTimeout(finish, 230);
    }
  }

  // clicking the dimmed area (the dialog element itself, outside the panel) closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog && canDismiss) close('backdrop'); });
  // Esc
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (canDismiss) close('esc'); });

  closeBtn.hidden = !canDismiss;
  document.body.appendChild(dialog);
  dialog.showModal();
  if (typeof initialFocus === 'function') {
    const el = initialFocus(dialog);
    if (el) el.focus();
  }

  return {
    el: dialog,
    close,
    setDismissible(v) { canDismiss = !!v; closeBtn.hidden = !canDismiss; },
  };
}

/** Simple yes/no dialog. Resolves true when confirmed. */
export function confirmSheet({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet({
      title,
      content: h('p', { class: 'muted' }, message),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, cancelLabel),
        h('button', { type: 'button', class: 'btn ' + (danger ? 'btn--danger-solid' : 'btn--primary'), onclick: () => { answer = true; sheet.close('ok'); } }, confirmLabel),
      ],
      onClose: () => resolve(answer),
    });
  });
}
