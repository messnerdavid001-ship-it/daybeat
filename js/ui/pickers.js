// Theme and accent pickers, shared by Settings and the first-run welcome card.
import { h } from './dom.js';
import { icon } from './icons.js';
import { THEMES, ACCENTS, getTheme, getAccent, setTheme, setAccent } from './theme.js';

let uid = 0;

export function themePicker() {
  const name = 'theme-' + (++uid);
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' },
    ...THEMES.map((t) =>
      h('label', null,
        h('input', { type: 'radio', name, value: t.id, checked: getTheme() === t.id, onchange: () => setTheme(t.id) }),
        h('span', null, icon(t.icon), t.label),
      )),
  );
}

export function accentPicker() {
  const name = 'accent-' + (++uid);
  return h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' },
    ...ACCENTS.map((a) =>
      h('label', { class: 'swatch' },
        h('input', { type: 'radio', name, value: a.id, checked: getAccent() === a.id, 'aria-label': a.label, onchange: () => setAccent(a.id) }),
        h('span', { class: 'swatch__dot', style: { '--sw': a.color } }, icon('check')),
      )),
  );
}

/** Generic segmented control (radio group). options = [{value,label}] */
export function segmented({ label, options, value, onChange }) {
  const name = 'seg-' + (++uid);
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    ...options.map((o) => h('label', null,
      h('input', { type: 'radio', name, value: String(o.value), checked: String(o.value) === String(value), onchange: () => onChange(o.value) }),
      h('span', null, o.label))));
}
