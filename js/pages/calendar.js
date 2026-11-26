// Calendar: month grid + agenda for the chosen day. Shows events, tasks (with a tick-off button) and alarms together.
// Also: manual events, local .ics file import (never uploaded) and "Add to my Calendar" export with real alerts.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { showAward } from '../ui/rewards.js';
import { fmtTime, fmtClock, fmtDate, fmtMonthYear, dateOfKey, plural, WEEKDAYS_LETTER, WEEKDAYS_LONG } from '../ui/format.js';
import { eventTimeText } from '../ui/events.js';
import { pageHead, emptyState, dataMissingCard, keepFocus } from '../ui/parts.js';
import { openCalendarExport } from '../ui/calexport.js';
import { finishTask } from '../ui/taskactions.js';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates, ics, tasks } = ctx.data;
  let first = true;
  let sel = KEY_RE.test(ctx.args[0] || '') ? ctx.args[0] : dates.todayKey();

  const weekStartPref = () => store.settings.get('weekStart', 1);
  const pref = () => store.settings.get('timeFormat', 'auto');

  // ------------------------------------------------------------ month maths
  function monthShift(key, delta) {
    const d = dateOfKey(key);
    const day = d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return dates.dayKey(target);
  }

  function gridFor(key) {
    const d = dateOfKey(key);
    const firstOfMonth = dates.dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
    const start = dates.weekStart(firstOfMonth, weekStartPref());
    const cells = Array.from({ length: 42 }, (_, i) => dates.addDays(start, i));
    return { cells, month: d.getMonth() };
  }

  function alarmsOn(key, alarms, now) {
    if (key < dates.todayKey(now)) return [];
    const dow = dates.dayOfWeek(key);
    return alarms.filter((al) => (al.days.length ? al.days.includes(dow) : (() => { const n = dates.nextAlarm(al, now); return n && dates.dayKey(n) === key; })()));
  }

  function countsFor(cells) {
    const from = cells[0], to = dates.addDays(cells[cells.length - 1], 1);
    const counts = new Map();
    const bump = (k, f) => { const c = counts.get(k) || { ev: 0, tk: 0, al: 0 }; c[f]++; counts.set(k, c); };
    for (const ev of store.list('event', { from, to })) {
      const { startMs, endMs } = dates.eventSpan(ev);
      let k = dates.dayKey(new Date(startMs));
      const lastKey = dates.dayKey(new Date(Math.max(startMs, endMs - 1)));
      for (let guard = 0; guard < 60 && k <= lastKey; guard++) {
        if (k >= from && k < to) bump(k, 'ev');
        k = dates.addDays(k, 1);
      }
    }
    for (const { task, day } of tasks.between(from, to)) if (!task.done) bump(day, 'tk');
    const alarms = store.list('alarm').filter((a) => a.enabled);
    const now = new Date();
    if (alarms.length) for (const key of cells) for (let i = 0; i < alarmsOn(key, alarms, now).length; i++) bump(key, 'al');
    return counts;
  }

  function select(key) { sel = key; keepFocus(root, render); }

  // ------------------------------------------------------------ event form
  function toInputDate(ev, which) {
    if (ev.allDay) return which === 'start' ? ev.start : ev.end;
    return dates.dayKey(which === 'start' ? ev.start : ev.end || ev.start);
  }
  function toInputTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function openForm(existing, dayKey) {
    const day = dayKey || sel;
    const startTime = existing && !existing.allDay ? toInputTime(existing.start) : '09:00';
    const endTime = existing && !existing.allDay ? toInputTime(existing.end || existing.start) : '10:00';
    let allDay = existing ? existing.allDay : false;

    const title = h('input', { class: 'input', type: 'text', id: 'ev-title', maxlength: 200, required: true, placeholder: 'What is on?', value: existing ? existing.title : '' });
    const sDate = h('input', { class: 'input', type: 'date', id: 'ev-sd', required: true, value: existing ? toInputDate(existing, 'start') : day });
    const eDate = h('input', { class: 'input', type: 'date', id: 'ev-ed', required: true, value: existing ? toInputDate(existing, 'end') : day });
    const sTime = h('input', { class: 'input', type: 'time', id: 'ev-st', value: startTime });
    const eTime = h('input', { class: 'input', type: 'time', id: 'ev-et', value: endTime });
    const place = h('input', { class: 'input', type: 'text', id: 'ev-loc', maxlength: 200, placeholder: 'Where (optional)', value: existing ? existing.location || '' : '' });
    const notes = h('textarea', { class: 'input textarea', id: 'ev-notes', maxlength: 2000, rows: 3, placeholder: 'Notes (optional)' }, existing ? existing.notes || '' : '');
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const timeRow = h('div', { class: 'two-col' },
      h('div', null, h('label', { class: 'field-label', for: 'ev-st' }, 'Starts'), sTime),
      h('div', null, h('label', { class: 'field-label', for: 'ev-et' }, 'Ends'), eTime));
    const allDayBox = h('input', { type: 'checkbox', class: 'switch-input', checked: allDay, onchange: (e) => { allDay = e.target.checked; timeRow.hidden = allDay; } });
    timeRow.hidden = allDay;

    async function save() {
      error.hidden = true;
      const t = title.value.trim();
      if (!t) { error.textContent = 'Give it a title.'; error.hidden = false; title.focus(); return; }
      if (!sDate.value || !eDate.value) { error.textContent = 'Pick the dates.'; error.hidden = false; return; }
      let start, end;
      if (allDay) {
        start = sDate.value; end = eDate.value;
        if (end < start) { error.textContent = 'It cannot end before it starts.'; error.hidden = false; return; }
      } else {
        const s = new Date(`${sDate.value}T${sTime.value || '00:00'}`);
        const e = new Date(`${eDate.value}T${eTime.value || sTime.value || '00:00'}`);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) { error.textContent = 'Check the times.'; error.hidden = false; return; }
        if (e < s) { error.textContent = 'It cannot end before it starts.'; error.hidden = false; return; }
        start = s.toISOString(); end = e.toISOString();
      }
      try {
        const rec = await store.put('event', { ...(existing ? { id: existing.id, uid: existing.uid } : {}), title: t, allDay, start, end, location: place.value.trim(), notes: notes.value.trim() });
        sheet.close('saved');
        sel = allDay ? start : dates.dayKey(start);
        toast(existing ? 'Event updated.' : 'Event added.');
        if (!existing) showAward(await game.award('event', { ref: rec.id }));
      } catch (e) { error.textContent = e.message || 'Could not save that event.'; error.hidden = false; }
    }

    async function remove() {
      const copy = { ...existing };
      try {
        await store.remove('event', existing.id);
        sheet.close('deleted');
        toast('Event deleted.', { action: { label: 'Undo', onClick: async () => { try { await store.put('event', copy); } catch (e) { toast(e.message); } } } });
      } catch (e) { error.textContent = e.message || 'Could not delete that event.'; error.hidden = false; }
    }

    const sheet = openSheet({
      title: existing ? 'Edit event' : 'New event',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div', null, h('label', { class: 'field-label', for: 'ev-title' }, 'Title'), title),
        h('label', { class: 'switch-row' }, h('span', null, 'All day'), allDayBox),
        h('div', { class: 'two-col' },
          h('div', null, h('label', { class: 'field-label', for: 'ev-sd' }, 'From'), sDate),
          h('div', null, h('label', { class: 'field-label', for: 'ev-ed' }, 'To'), eDate)),
        timeRow,
        h('div', null, h('label', { class: 'field-label', for: 'ev-loc' }, 'Place'), place),
        h('div', null, h('label', { class: 'field-label', for: 'ev-notes' }, 'Notes'), notes),
        error,
        h('button', { type: 'submit', hidden: true }, 'Save'),
      ),
      footer: [
        existing ? h('button', { type: 'button', class: 'btn btn--danger', onclick: remove }, icon('trash'), 'Delete') : null,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: save }, 'Save'),
      ],
      initialFocus: () => (existing ? null : title),
    });
  }

  // ------------------------------------------------------------ .ics import
  const picker = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, 'aria-hidden': 'true', tabindex: '-1', onchange: async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await ics.importFile(file);
      previewImport(res, file.name);
    } catch (err) { toast(err.message || 'Could not read that file.'); }
  } });

  function previewImport(res, name) {
    const n = res.events.length;
    const first5 = res.events.slice(0, 5);
    const sheet = openSheet({
      title: n ? `Add ${plural(n, 'event')}?` : 'Nothing to add',
      content: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, n
          ? 'The file was read on this device and went nowhere else. Importing the same file twice will not make duplicates.'
          : 'That file did not contain any events we could use.'),
        n ? h('ul', { class: 'plain rows' }, ...first5.map((ev) => h('li', { class: 'row' },
          h('span', { class: 'row__body' }, h('span', { class: 'row__title user-text clamp-1' }, ev.title),
            h('span', { class: 'row__sub' }, ev.allDay ? fmtDate(dateOfKey(ev.start)) : `${fmtDate(new Date(ev.start))}, ${fmtTime(new Date(ev.start), pref())}`))))) : null,
        n > 5 ? h('p', { class: 'faint' }, `and ${n - 5} more`) : null,
        res.skipped || (res.errors && res.errors.length) ? h('p', { class: 'faint' }, `${plural(res.skipped || 0, 'item')} skipped${res.errors && res.errors.length ? `, ${plural(res.errors.length, 'problem')} found` : ''}.${res.truncated ? ' The file was large, so only part of it was read.' : ''}`) : null,
      ),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
        n ? h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
          try {
            await store.putMany('event', res.events);
            sheet.close('ok');
            toast(`Added ${plural(n, 'event')} from ${name ? name.slice(0, 40) : 'your file'}.`);
            sel = dates.dayKey(res.events[0].start);
            showAward(await game.award('import', { ref: 'ics:' + Date.now().toString(36) }));
          } catch (e) { toast(e.message || 'Could not add those events.'); }
        } }, `Add ${plural(n, 'event')}`) : null,
      ],
    });
  }

  // ------------------------------------------------------------ rendering
  function monthCard() {
    const { cells, month } = gridFor(sel);
    const counts = countsFor(cells);
    const today = dates.todayKey();
    const ws = weekStartPref();
    const heads = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);

    const onKey = (e) => {
      const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (map[e.key]) { e.preventDefault(); select(dates.addDays(sel, map[e.key])); }
      else if (e.key === 'PageUp') { e.preventDefault(); select(monthShift(sel, -1)); }
      else if (e.key === 'PageDown') { e.preventDefault(); select(monthShift(sel, 1)); }
    };

    return h('section', { class: 'card calendar', 'aria-label': 'Month' },
      h('div', { class: 'cal-toolbar' },
        h('h2', { class: 'cal-title', 'aria-live': 'polite' }, fmtMonthYear(dateOfKey(sel))),
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => select(dates.todayKey()), 'data-fk': 'cal-today' }, 'Today'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => select(monthShift(sel, -1)), 'data-fk': 'cal-prev' }, icon('chevron-left')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => select(monthShift(sel, 1)), 'data-fk': 'cal-next' }, icon('chevron-right')))),
      h('div', { class: 'cal-grid cal-heads', 'aria-hidden': 'true' }, ...heads.map((d) => h('span', null, WEEKDAYS_LETTER[d]))),
      h('div', { class: 'cal-grid', role: 'group', 'aria-label': fmtMonthYear(dateOfKey(sel)), onkeydown: onKey },
        ...cells.map((key) => {
          const d = dateOfKey(key);
          const c = counts.get(key) || { ev: 0, tk: 0, al: 0 };
          const n = c.ev + c.tk + c.al;
          const cls = 'cal-cell' + (d.getMonth() !== month ? ' is-out' : '') + (key === today ? ' is-today' : '') + (key === sel ? ' is-sel' : '');
          return h('button', { type: 'button', class: cls, tabindex: key === sel ? '0' : '-1', 'data-fk': 'day-' + key, 'aria-pressed': String(key === sel),
            'aria-label': `${WEEKDAYS_LONG[d.getDay()]} ${fmtDate(d, { month: 'long', day: 'numeric' })}${key === today ? ', today' : ''}, ${n ? [c.ev ? plural(c.ev, 'event') : '', c.tk ? plural(c.tk, 'task') : '', c.al ? plural(c.al, 'alarm') : ''].filter(Boolean).join(', ') : 'nothing planned'}`,
            onclick: () => select(key) },
            h('span', { class: 'cal-num num' }, String(d.getDate())),
            h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
              ...[...Array(Math.min(c.ev, 3)).fill('ev'), ...Array(Math.min(c.tk, 3)).fill('tk'), ...Array(Math.min(c.al, 3)).fill('al')].slice(0, 3)
                .map((k) => h('i', { class: k === 'tk' ? 'task-dot' : k === 'al' ? 'alarm-dot' : null }))));
        })),
    );
  }

  const tickTask = (t, btn) => finishTask(ctx.data, t, btn);

  function agendaItems() {
    const next = dates.addDays(sel, 1);
    const items = [];
    for (const ev of store.list('event', { from: sel, to: next })) items.push({ kind: 'event', key: ev.allDay ? '00:00' : new Date(ev.start).toTimeString().slice(0, 5), ev });
    for (const { task } of tasks.between(sel, next)) items.push({ kind: 'task', key: task.time || '00:00', task });
    for (const a of alarmsOn(sel, store.list('alarm').filter((x) => x.enabled), new Date())) items.push({ kind: 'alarm', key: a.time, alarm: a });
    return items.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  }

  function agendaRow(it) {
    if (it.kind === 'event') {
      const ev = it.ev;
      return h('li', null,
        h('button', { type: 'button', class: 'row row--button', 'data-fk': 'ev-' + ev.id, onclick: () => openForm(ev), 'aria-label': `Edit ${ev.title}` },
          h('span', { class: 'row__time num' }, ev.allDay ? 'All day' : fmtTime(new Date(ev.start), pref())),
          h('span', { class: 'row__body' },
            h('span', { class: 'kind-tag' }, icon('calendar'), 'Event'),
            h('span', { class: 'row__title user-text clamp-2' }, ev.title),
            h('span', { class: 'row__sub user-text clamp-1' }, [
              !ev.allDay && ev.end && ev.end !== ev.start ? `until ${fmtTime(new Date(ev.end), pref())}` : (ev.allDay ? eventTimeText(ev, pref()) : ''),
              ev.location ? ` \u00b7 ${ev.location}` : '',
              ev.source === 'demo' ? ' \u00b7 sample' : '',
            ].join('').replace(/^ \u00b7 /, '')))));
    }
    if (it.kind === 'task') {
      const t = it.task;
      const real = !t.repeat || t.due === sel;   // a future repeat is shown for planning; only its current day can be ticked
      return h('li', null, h('div', { class: 'row' },
        real && !t.done ? h('button', { type: 'button', class: 'agenda-check', 'aria-label': `Mark done: ${t.title}`, 'data-fk': 'tk-' + t.id, onclick: (e) => tickTask(t, e.currentTarget) }, icon('check'))
          : h('span', { class: 'agenda-check' + (t.done ? ' is-on' : ''), 'aria-hidden': 'true' }, icon('check')),
        h('button', { type: 'button', class: 'row__body row__main', 'data-fk': 'tkrow-' + t.id, onclick: () => ctx.go('tasks'), 'aria-label': `Open tasks: ${t.title}` },
          h('span', { class: 'kind-tag' }, icon('tasks'), t.repeat ? 'Task, repeats' : 'Task'),
          h('span', { class: 'row__title user-text clamp-2' }, t.title),
          h('span', { class: 'row__sub' }, t.time ? fmtClock(t.time, pref()) : 'Any time', t.list ? ` \u00b7 #${t.list}` : '')),
      ));
    }
    const a = it.alarm;
    return h('li', null,
      h('a', { class: 'row row--button', href: '#/alarms', 'data-fk': 'al-' + a.id },
        h('span', { class: 'row__time num is-alarm' }, fmtClock(a.time, pref())),
        h('span', { class: 'row__body' }, h('span', { class: 'kind-tag' }, icon('alarm'), 'Alarm'), h('span', { class: 'row__title user-text clamp-1' }, a.label || 'Alarm'))));
  }

  function agendaCard() {
    const d = dateOfKey(sel);
    const items = agendaItems();
    const label = sel === dates.todayKey() ? 'Today' : fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    return h('section', { class: 'card agenda', 'aria-label': 'Agenda' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'card__title' }, label),
        h('button', { type: 'button', class: 'btn btn--tonal btn--sm', onclick: () => openAddMenu(sel), 'data-fk': 'agenda-add' }, icon('plus'), 'Add')),
      items.length
        ? h('ul', { class: 'plain rows' }, ...items.map(agendaRow))
        : emptyState({ iconName: 'calendar', compact: true, title: 'Nothing on. Suspicious.', text: 'Add something or enjoy it.' }),
    );
  }

  // ------------------------------------------------------------ add menu + quick task
  function openAddMenu(day) {
    const sheet = openSheet({
      title: sel === dates.todayKey() && day === sel ? 'Add to today' : `Add to ${fmtDate(dateOfKey(day), { weekday: 'short', month: 'short', day: 'numeric' })}`,
      content: h('div', { class: 'add-menu' },
        h('button', { type: 'button', class: 'btn btn--tonal', onclick: () => { sheet.close('event'); openForm(null, day); } }, icon('calendar'), 'Event'),
        h('button', { type: 'button', class: 'btn btn--tonal', onclick: () => { sheet.close('task'); openTaskQuick(day); } }, icon('tasks'), 'Task'),
        h('button', { type: 'button', class: 'btn btn--tonal', onclick: () => { sheet.close('alarm'); ctx.go('alarms'); } }, icon('alarm'), 'Alarm (on the Alarms page)')),
    });
  }

  function openTaskQuick(day) {
    const title = h('input', { class: 'input', type: 'text', id: 'qt-title', maxlength: 200, required: true, placeholder: 'What needs doing?' });
    const time = h('input', { class: 'input', type: 'time', id: 'qt-time', step: 60 });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    async function save() {
      const t = title.value.trim();
      if (!t) { error.textContent = 'Give it a title.'; error.hidden = false; title.focus(); return; }
      try {
        const r = await tasks.add({ title: t, due: day, time: time.value });
        sheet.close('saved');
        toast('Task added.');
        if (r.award && ((r.award.badgesEarned || []).length || (r.award.questsCompleted || []).length)) showAward(r.award);
      } catch (e) { error.textContent = e.message || 'Could not save that task.'; error.hidden = false; }
    }
    const sheet = openSheet({
      title: 'New task',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div', null, h('label', { class: 'field-label', for: 'qt-title' }, 'Task'), title),
        h('div', null, h('label', { class: 'field-label', for: 'qt-time' }, `Time on ${fmtDate(dateOfKey(day), { weekday: 'short', month: 'short', day: 'numeric' })} (optional)`), time),
        error, h('button', { type: 'submit', hidden: true }, 'Save'),
        h('p', { class: 'faint' }, 'Need repeats, steps or a reminder? Use the Tasks page.')),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'), h('button', { type: 'button', class: 'btn btn--primary', onclick: save }, 'Save')],
      initialFocus: () => title,
    });
  }

  function importCard() {
    const none = store.count('event') === 0;
    return h('section', { class: 'card span-2 import', 'aria-label': 'Import and export' },
      h('div', { class: 'import__row' },
        h('span', { class: 'row__icon' }, icon('upload')),
        h('div', { class: 'row__body' },
          h('p', { class: 'row__title' }, none ? 'Bring your calendar in' : 'Import a calendar file'),
          h('p', { class: 'row__sub' }, 'Export an .ics file from your calendar app and pick it here. It is read on this device only. This does not connect to any calendar, so import again to refresh.'))),
      h('button', { type: 'button', class: 'btn btn--tonal btn--block', onclick: () => picker.click(), 'data-fk': 'import' }, icon('upload'), 'Choose a calendar file'),
      h('div', { class: 'import__row' },
        h('span', { class: 'row__icon' }, icon('share')),
        h('div', { class: 'row__body' },
          h('p', { class: 'row__title' }, 'Get real alerts'),
          h('p', { class: 'row__sub' }, 'Daybeat cannot ring when it is closed. Send your tasks and alarms to your phone\u2019s own Calendar, which can.'))),
      h('button', { type: 'button', class: 'btn btn--tonal btn--block', onclick: () => openCalendarExport(ctx.data), 'data-fk': 'export' }, icon('share'), 'Add to my Calendar'),
    );
  }

  function render() {
    root.replaceChildren(
      pageHead({ eyebrow: 'Calendar', title: 'Your days', lede: 'Events, tasks and alarms, side by side.',
        actions: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openAddMenu(sel), 'data-fk': 'add-event' }, icon('plus'), 'Add')] }),
      h('div', { class: 'cal-layout' + (first ? ' stagger' : '') }, monthCard(), agendaCard(), importCard()),
      h('p', { class: 'legend', 'aria-label': 'Legend' }, h('span', null, h('i'), 'Event'), h('span', null, h('i', { class: 't' }), 'Task'), h('span', null, h('i', { class: 'a' }), 'Alarm')),
      picker,
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch(['event', 'task', 'alarm', 'settings', 'demo', 'import', 'wipe', 'bulk'], () => keepFocus(root, render));
}
