// Alarms: your alarms in one place (a hand-kept mirror of the watch's alarms; the app cannot ring when closed or change the
// watch), the wake-up check-in, and "Add to my Calendar" so the phone's Calendar can fire real alerts.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { showAward } from '../ui/rewards.js';
import { checkInNow, MOODS } from '../ui/checkin.js';
import { clockParts, fmtClock, untilText, WEEKDAYS_SHORT, WEEKDAYS_LETTER, dateOfKey } from '../ui/format.js';
import { pageHead, emptyState, dataMissingCard, keepFocus, every } from '../ui/parts.js';
import { openCalendarExport } from '../ui/calexport.js';

const PRESETS = [
  { label: 'Weekdays 6:30', time: '06:30', days: [1, 2, 3, 4, 5], note: '' },
  { label: 'Weekends 9:00', time: '09:00', days: [0, 6], note: '' },
  { label: 'Power nap 14:00', time: '14:00', days: [], note: '' },
];

const SETS = [
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] },
  { label: 'Once', days: [] },
];

const sameDays = (a, b) => a.length === b.length && a.every((d) => b.includes(d));

function daysText(days) {
  if (!days || days.length === 0) return 'Once';
  const set = [...days].sort((a, b) => a - b);
  for (const s of SETS) if (s.days.length && sameDays(set, s.days)) return s.label;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((d) => set.includes(d)).map((d) => WEEKDAYS_SHORT[d]).join(', ');
}

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates } = ctx.data;
  let first = true;

  // ------------------------------------------------------------ add / edit form
  function openForm(existing, prefill) {
    const start = existing || prefill || { time: '07:00', days: [1, 2, 3, 4, 5], label: '', note: '', enabled: true };
    let days = [...(start.days || [])];
    const weekStart = store.settings.get('weekStart', 1);
    const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

    const timeInput = h('input', { class: 'input input--time num', type: 'time', id: 'alarm-time', required: true, value: start.time || '07:00', step: 60 });
    const label = h('input', { class: 'input', type: 'text', id: 'alarm-label', maxlength: 60, placeholder: 'Label (optional), like "Gym"', value: start.label || '' });
    const note = h('input', { class: 'input', type: 'text', id: 'alarm-note', maxlength: 200, placeholder: 'Note (optional)', value: start.note || '' });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    let enabled = existing ? existing.enabled : start.enabled !== false;

    const dayButtons = order.map((d) => {
      const b = h('button', { type: 'button', class: 'daybtn', 'aria-pressed': String(days.includes(d)), 'aria-label': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d],
        onclick: () => { days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]; sync(); } }, WEEKDAYS_LETTER[d]);
      b.dataset.day = String(d);
      return b;
    });
    const summary = h('p', { class: 'field-hint', 'aria-live': 'polite' });
    function sync() {
      dayButtons.forEach((b) => b.setAttribute('aria-pressed', String(days.includes(Number(b.dataset.day)))));
      summary.textContent = days.length ? `Repeats: ${daysText(days)}` : 'Rings once, then it is done.';
    }
    sync();

    const sets = h('div', { class: 'cluster' }, ...SETS.map((s) => h('button', { type: 'button', class: 'chip chip--button', onclick: () => { days = [...s.days]; sync(); } }, s.label)));

    const enableRow = h('label', { class: 'switch-row' },
      h('span', null, 'Switched on'),
      h('input', { type: 'checkbox', class: 'switch-input', checked: enabled, onchange: (e) => { enabled = e.target.checked; } }));

    async function save() {
      error.hidden = true;
      const time = timeInput.value;
      if (!/^\d{2}:\d{2}$/.test(time)) { error.textContent = 'Pick a time first.'; error.hidden = false; timeInput.focus(); return; }
      try {
        const rec = await store.put('alarm', { ...(existing ? { id: existing.id } : {}), time, days, enabled, label: label.value.trim(), note: note.value.trim() });
        sheet.close('saved');
        toast(existing ? 'Alarm updated.' : 'Alarm added.');
        const result = await game.award('alarm', { ref: `${rec.id}:${rec.updatedAt}`.slice(0, 90) });
        showAward(result);
      } catch (e) {
        error.textContent = e.message || 'Could not save that alarm.';
        error.hidden = false;
      }
    }

    async function remove() {
      const copy = { ...existing };
      try {
        await store.remove('alarm', existing.id);
        sheet.close('deleted');
        toast('Alarm deleted.', { action: { label: 'Undo', onClick: async () => { try { await store.put('alarm', copy); } catch (e) { toast(e.message); } } } });
      } catch (e) { error.textContent = e.message || 'Could not delete that alarm.'; error.hidden = false; }
    }

    const sheet = openSheet({
      title: existing ? 'Edit alarm' : 'New alarm',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div', null, h('label', { class: 'field-label', for: 'alarm-time' }, 'Time'), timeInput),
        h('div', null, h('p', { class: 'field-label', id: 'days-label' }, 'Days'),
          h('div', { class: 'days', role: 'group', 'aria-labelledby': 'days-label' }, ...dayButtons), summary, sets),
        h('div', null, h('label', { class: 'field-label', for: 'alarm-label' }, 'Label'), label),
        h('div', null, h('label', { class: 'field-label', for: 'alarm-note' }, 'Note'), note),
        enableRow,
        h('p', { class: 'faint' }, 'This keeps the alarm in Daybeat. It will not buzz on its own when the app is closed. Use \u201cAdd to my Calendar\u201d for a real alert, and set the alarm on your watch if you want it to wake you.'),
        error,
        h('button', { type: 'submit', hidden: true }, 'Save'),
      ),
      footer: [
        existing ? h('button', { type: 'button', class: 'btn btn--danger', onclick: remove }, icon('trash'), 'Delete') : null,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: save }, 'Save'),
      ],
      initialFocus: () => (existing ? null : timeInput),
    });
  }

  async function toggle(alarm, on) {
    try { await store.update('alarm', alarm.id, { enabled: on }); } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------ pieces
  function nextCard(S) {
    if (!S.next) {
      return h('section', { class: 'card span-2' },
        emptyState({
          iconName: 'alarm', compact: true,
          title: S.alarms.length ? 'All quiet' : 'No alarms yet',
          text: S.alarms.length ? 'Every alarm here is switched off.' : 'Add the alarms you use, including the ones on your watch, so you can plan your day around them.',
          actions: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openForm() }, icon('plus'), 'Add an alarm')],
        }),
        S.alarms.length ? null : h('div', { class: 'presets' },
          h('p', { class: 'field-hint' }, 'Quick start'),
          h('div', { class: 'cluster' }, ...PRESETS.map((p) => h('button', { type: 'button', class: 'chip chip--button', onclick: () => openForm(null, { ...p, enabled: true, label: '' }) }, p.label)))),
      );
    }
    const { a, when } = S.next;
    const c = clockParts(a.time, S.pref);
    return h('section', { class: 'card card--accent next-alarm span-2', 'aria-label': 'Next alarm' },
      h('span', { class: 'chip chip--ink' }, 'Next alarm'),
      h('p', { class: 'next-alarm__time num' }, c.main, c.suffix ? h('small', null, c.suffix) : null),
      h('p', { class: 'next-alarm__when' }, untilText(when - S.nowMs), a.label ? ' · ' : '', a.label ? h('span', { class: 'user-text' }, a.label) : null),
    );
  }

  function checkinCard(S) {
    const done = S.todayCheckin;
    return h('section', { class: 'card checkin span-2', 'aria-label': 'Wake-up check-in' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'card__title' }, 'Wake-up check-in'),
        h('span', { class: 'chip chip--accent' }, `${S.weekCheckins} this week`)),
      done
        ? h('p', { class: 'muted' }, `You checked in today. ${done.mood ? 'Feeling ' + MOODS[done.mood].toLowerCase() + '.' : ''} See you tomorrow.`)
        : h('p', { class: 'muted' }, 'Up? Tap once. It counts for your streak and your quests.'),
      done ? null : h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-fk': 'imup', onclick: (e) => checkInNow(ctx.data, 0, e.currentTarget) }, icon('sunrise'), 'I’m up'),
      h('div', { class: 'week', role: 'img', 'aria-label': `Check-ins in the last 7 days: ${S.week.filter((d) => d.on).length}` },
        ...S.week.map((d) => h('span', { class: 'week__day' + (d.on ? ' is-on' : '') + (d.today ? ' is-today' : '') }, h('i'), h('b', null, d.letter)))),
    );
  }

  function alarmRow(a, S) {
    const c = clockParts(a.time, S.pref);
    const nxt = a.enabled ? dates.nextAlarm(a, new Date(S.nowMs)) : null;
    return h('li', null,
      h('div', { class: 'alarm' + (a.enabled ? '' : ' is-off') },
        h('button', { type: 'button', class: 'alarm__main', 'data-fk': 'alarm-' + a.id, onclick: () => openForm(a), 'aria-label': `Edit alarm ${c.main} ${c.suffix}${a.label ? ', ' + a.label : ''}, ${daysText(a.days)}` },
          h('span', { class: 'alarm__time num' }, c.main, c.suffix ? h('small', null, c.suffix) : null),
          h('span', { class: 'alarm__meta' },
            h('span', { class: 'user-text clamp-1' }, a.label || 'Alarm'),
            h('span', { class: 'faint' }, daysText(a.days), nxt ? ` · ${untilText(nxt - S.nowMs)}` : ''))),
        h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(a.enabled), 'aria-label': `${a.enabled ? 'Switch off' : 'Switch on'} alarm ${c.main} ${c.suffix}`, 'data-fk': 'sw-' + a.id, onclick: () => toggle(a, !a.enabled) }, h('i')),
      ),
    );
  }

  function honestyNote(S) {
    return h('aside', { class: 'note span-2' }, icon('info'),
      h('div', { class: 'stack' },
        h('p', null, h('strong', null, 'Be honest with yourself about alarms. '), 'A website cannot ring, vibrate or wake you once it is closed, and it cannot read or change the alarms on your watch. Daybeat shows a heads-up only while it is open on screen.'),
        h('p', null, 'For a real alert, send your alarms to your phone\u2019s Calendar. For waking up, keep the alarm on your watch or phone clock too.'),
        S.alarms.length ? h('div', null, h('button', { type: 'button', class: 'btn btn--tonal btn--sm', 'data-fk': 'to-cal', onclick: () => openCalendarExport(ctx.data) }, icon('share'), 'Add to my Calendar')) : null));
  }

  function readState() {
    const now = new Date();
    const todayKey = dates.todayKey(now);
    const alarms = store.list('alarm');
    const next = alarms.filter((a) => a.enabled).map((a) => ({ a, when: dates.nextAlarm(a, now) })).filter((x) => x.when).sort((x, y) => x.when - y.when)[0] || null;
    const checkins = store.list('checkin');
    const days = new Set(checkins.map((c) => c.day));
    const week = Array.from({ length: 7 }, (_, i) => {
      const key = dates.addDays(todayKey, i - 6);
      return { key, on: days.has(key), today: key === todayKey, letter: WEEKDAYS_LETTER[dateOfKey(key).getDay()] };
    });
    return { nowMs: now.getTime(), pref: store.settings.get('timeFormat', 'auto'), alarms, next, week, weekCheckins: week.filter((d) => d.on).length,
      todayCheckin: checkins.filter((c) => c.day === todayKey)[0] || null };
  }

  function render() {
    const S = readState();
    root.replaceChildren(
      pageHead({ eyebrow: 'Alarms', title: 'Wake-up', lede: 'Your alarms in one place, plus a check-in for the mornings you make it.',
        actions: [h('button', { type: 'button', class: 'btn btn--primary', 'data-fk': 'add-alarm', onclick: () => openForm() }, icon('plus'), 'Add alarm')] }),
      h('div', { class: 'bento' + (first ? ' stagger' : '') },
        nextCard(S),
        checkinCard(S),
        S.alarms.length ? h('section', { class: 'span-2', 'aria-label': 'All alarms' }, h('ul', { class: 'plain alarm-list' }, ...S.alarms.map((a) => alarmRow(a, S)))) : null,
        honestyNote(S),
      ),
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch(['alarm', 'checkin', 'settings', 'demo', 'import', 'wipe', 'bulk'], () => keepFocus(root, render));
  return every(30000, () => keepFocus(root, render));
}
