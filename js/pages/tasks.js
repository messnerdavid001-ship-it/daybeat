// Tasks: quick add with plain-words parsing, smart views (Today, Upcoming, Someday, Done), repeats, subtasks.
// Finishing a task earns XP and keeps the streak alive (rules live in the data layer).
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ring } from '../ui/ring.js';
import { toast } from '../ui/toast.js';
import { openSheet, confirmSheet } from '../ui/sheet.js';
import { showAward, originOf } from '../ui/rewards.js';
import { segmented } from '../ui/pickers.js';
import { fmtDate, fmtClock, dateOfKey, plural } from '../ui/format.js';
import { pageHead, emptyState, dataMissingCard, keepFocus } from '../ui/parts.js';
import { openCalendarExport } from '../ui/calexport.js';
import { finishTask } from '../ui/taskactions.js';

const VIEWS = ['today', 'upcoming', 'someday', 'done'];
const VIEW_LABEL = { today: 'Today', upcoming: 'Upcoming', someday: 'Someday', done: 'Done' };
const PRI_NAMES = ['No priority', 'Low', 'Medium', 'High'];

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, tasks, calendarExport, dates } = ctx.data;
  let first = true;
  let view = VIEWS.includes(store.settings.get('ui_taskView', 'today')) ? store.settings.get('ui_taskView', 'today') : 'today';
  let listFilter = '';
  let draft = '';

  const pref = () => store.settings.get('timeFormat', 'auto');
  const todayKey = () => dates.todayKey();

  // ------------------------------------------------------------ wording
  function dueText(t, today, { withTime = true } = {}) {
    if (!t.due) return '';
    const words = tasks.dueWords(t.due, today);
    const day = words || fmtDate(dateOfKey(t.due));
    return withTime && t.time ? `${day}, ${fmtClock(t.time, pref())}` : day;
  }

  function lede(g, doneToday) {
    if (g.overdue.length) return `${plural(g.overdue.length, 'task')} overdue. One quick win gets you rolling.`;
    if (g.today.length) return `${g.today.length} left today${doneToday ? `, ${doneToday} already done` : ''}. You have got this.`;
    if (doneToday) return `${plural(doneToday, 'task')} done today. Nothing left. Go enjoy it.`;
    if (g.upcoming.length || g.someday.length) return 'Today is clear. Add something or look ahead.';
    return 'Add your first task. It takes five seconds.';
  }

  // ------------------------------------------------------------ actions
  const finish = (t, btn) => finishTask(ctx.data, t, btn);

  async function reopen(t) {
    try { await tasks.reopen(t.id); toast('Back on the list.'); } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------ the full form
  function openForm(existing, seed) {
    const base = existing || seed || {};
    const t = {
      title: base.title || '', notes: base.notes || '', due: base.due || '', time: base.time || '', priority: base.priority || 0,
      list: base.list || '', repeat: base.repeat || '', remindMin: base.remindMin ?? null, subtasks: (base.subtasks || []).map((s) => ({ ...s })),
    };
    const lists = [...new Set(store.list('task').map((x) => x.list).filter(Boolean))].sort();
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const showError = (m) => { error.textContent = m; error.hidden = false; };

    const title = h('input', { class: 'input', type: 'text', id: 'tk-title', maxlength: 200, required: true, placeholder: 'What needs doing?', value: t.title });
    const notes = h('textarea', { class: 'input textarea', id: 'tk-notes', maxlength: 2000, rows: 3, placeholder: 'Notes (optional)' }, t.notes);
    const due = h('input', { class: 'input', type: 'date', id: 'tk-due', value: t.due });
    const time = h('input', { class: 'input', type: 'time', id: 'tk-time', value: t.time, step: 60 });
    const quickDays = h('div', { class: 'cluster' }, ...[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([label, n]) =>
      h('button', { type: 'button', class: 'chip chip--button', onclick: () => { due.value = dates.addDays(todayKey(), n); syncTime(); } }, label)),
    h('button', { type: 'button', class: 'chip chip--button', onclick: () => { due.value = ''; time.value = ''; syncTime(); } }, 'No date'));
    function syncTime() { time.disabled = !due.value; if (!due.value) time.value = ''; }
    due.addEventListener('input', syncTime);
    syncTime();

    let priority = t.priority;
    const prio = segmented({ label: 'Priority', value: priority, options: PRI_NAMES.map((n, i) => ({ value: i, label: i === 0 ? 'None' : n })), onChange: (v) => { priority = Number(v); } });

    const list = h('input', { class: 'input', type: 'text', id: 'tk-list', maxlength: 24, list: 'tk-lists', placeholder: 'List or tag, like home', value: t.list });
    const listOpts = h('datalist', { id: 'tk-lists' }, ...lists.map((l) => h('option', { value: l })));
    const repeat = h('select', { class: 'input', id: 'tk-repeat' }, ...Object.entries(tasks.REPEAT_LABELS).map(([v, label]) => h('option', { value: v, selected: v === t.repeat }, label)));
    const remind = h('select', { class: 'input', id: 'tk-remind' },
      h('option', { value: '', selected: t.remindMin === null }, 'No reminder'),
      ...calendarExport.REMIND_CHOICES.map((c) => h('option', { value: String(c.value), selected: t.remindMin === c.value }, c.label)));

    // subtasks
    const subList = h('ul', { class: 'plain subtasks' });
    const subInput = h('input', { class: 'input', type: 'text', maxlength: 100, placeholder: 'Add a step', 'aria-label': 'New step' });
    function renderSubs() {
      subList.replaceChildren(...t.subtasks.map((s, i) => h('li', { class: 'subtask' },
        h('input', { type: 'checkbox', class: 'subtask__box', checked: s.d, 'aria-label': `Step done: ${s.t}`, onchange: (e) => { s.d = e.target.checked; renderSubs(); } }),
        h('span', { class: 'subtask__text user-text' + (s.d ? ' is-done' : '') }, s.t),
        h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': `Remove step: ${s.t}`, onclick: () => { t.subtasks.splice(i, 1); renderSubs(); } }, icon('x')))));
    }
    function addSub() {
      const v = subInput.value.trim();
      if (!v) return;
      if (t.subtasks.length >= 20) { showError('That is plenty of steps. Split it into two tasks.'); return; }
      t.subtasks.push({ t: v.slice(0, 100), d: false });
      subInput.value = '';
      renderSubs();
      subInput.focus();
    }
    subInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
    renderSubs();

    async function save() {
      error.hidden = true;
      const name = title.value.trim();
      if (!name) { showError('Give it a title.'); title.focus(); return; }
      if (subInput.value.trim()) addSub();
      const rec = {
        ...(existing ? { id: existing.id, done: existing.done, doneAt: existing.doneAt, lastDone: existing.lastDone } : {}),
        title: name, notes: notes.value.trim(), due: due.value, time: due.value ? time.value : '', priority, list: list.value.trim().replace(/^#/, '').replace(/\s+/g, '-'),
        repeat: due.value ? repeat.value : '', remindMin: remind.value === '' ? null : Number(remind.value), subtasks: t.subtasks,
      };
      try {
        if (existing) { await store.put('task', rec); toast('Task updated.'); sheet.close('saved'); }
        else { const r = await tasks.add(rec); sheet.close('saved'); toast('Task added.'); if (r.award && (r.award.badgesEarned || r.award.questsCompleted || []).length) showAward(r.award); }
      } catch (e) { showError(e.message || 'Could not save that task.'); }
    }

    async function remove() {
      const copy = { ...existing };
      try {
        await store.remove('task', existing.id);
        sheet.close('deleted');
        toast('Task deleted.', { action: { label: 'Undo', onClick: async () => { try { await store.put('task', copy); } catch (e) { toast(e.message); } } } });
      } catch (e) { showError(e.message || 'Could not delete that task.'); }
    }

    const sheet = openSheet({
      title: existing ? 'Edit task' : 'New task',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div', null, h('label', { class: 'field-label', for: 'tk-title' }, 'Task'), title),
        h('div', null, h('p', { class: 'field-label' }, 'When'), quickDays),
        h('div', { class: 'two-col' },
          h('div', null, h('label', { class: 'field-label', for: 'tk-due' }, 'Date'), due),
          h('div', null, h('label', { class: 'field-label', for: 'tk-time' }, 'Time'), time)),
        h('div', { class: 'two-col' },
          h('div', null, h('label', { class: 'field-label', for: 'tk-repeat' }, 'Repeat'), repeat),
          h('div', null, h('label', { class: 'field-label', for: 'tk-remind' }, 'Reminder'), remind)),
        h('div', null, h('p', { class: 'field-label' }, 'Priority'), prio),
        h('div', null, h('label', { class: 'field-label', for: 'tk-list' }, 'List'), list, listOpts),
        h('div', null, h('p', { class: 'field-label' }, 'Steps'), subList, h('div', { class: 'subtask-add' }, subInput, h('button', { type: 'button', class: 'btn btn--tonal btn--sm', onclick: addSub }, icon('plus'), 'Add'))),
        h('div', null, h('label', { class: 'field-label', for: 'tk-notes' }, 'Notes'), notes),
        h('p', { class: 'faint' }, 'Reminders only ring if you add the task to your phone’s Calendar. Use “Add to my Calendar” on this page.'),
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

  // ------------------------------------------------------------ quick add
  function previewChips(parsed, today) {
    const bits = [];
    for (const u of parsed.understood) {
      if (u.kind === 'due') bits.push(['calendar', dueText({ due: u.due, time: '' }, today)]);
      else if (u.kind === 'time') bits.push(['clock', fmtClock(u.time, pref())]);
      else if (u.kind === 'priority') bits.push(['flag', PRI_NAMES[u.priority]]);
      else if (u.kind === 'list') bits.push(['tasks', '#' + u.list]);
      else if (u.kind === 'repeat') bits.push(['repeat', tasks.REPEAT_LABELS[u.repeat]]);
    }
    return bits.map(([i, label]) => h('span', { class: 'chip chip--accent' }, icon(i), label));
  }

  function quickAdd() {
    const today = todayKey();
    const chips = h('div', { class: 'cluster quick__chips', 'aria-live': 'polite' });
    const input = h('input', { class: 'input quick__input', type: 'text', id: 'quick-add', 'data-fk': 'quick-add', maxlength: 240, autocomplete: 'off', enterkeyhint: 'done',
      placeholder: 'Add a task. Try “call mum tomorrow 5pm !high #home”', 'aria-label': 'Add a task', value: draft });
    const refresh = () => chips.replaceChildren(...(draft.trim() ? previewChips(tasks.parseQuickAdd(draft), today) : []));
    input.addEventListener('input', () => { draft = input.value; refresh(); });
    refresh();
    async function submit() {
      const text = draft.trim();
      if (!text) { input.focus(); return; }
      const p = tasks.parseQuickAdd(text);
      try {
        const r = await tasks.add({ title: p.title.slice(0, 200), due: p.due, time: p.time, priority: p.priority, list: p.list, repeat: p.due ? p.repeat : '' });
        draft = '';
        const when = p.due ? ` for ${dueText(p, today)}` : '';
        toast(`Added${when}.`);
        if (r.award && ((r.award.badgesEarned || []).length || (r.award.questsCompleted || []).length)) showAward(r.award);
        if (p.due && p.due > today && view === 'today') view = 'upcoming';
        if (!p.due && view === 'today') view = 'someday';
      } catch (e) { toast(e.message || 'Could not add that.'); }
    }
    return h('form', { class: 'card quick', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('div', { class: 'quick__row' },
        input,
        h('button', { type: 'submit', class: 'btn btn--primary', 'data-fk': 'quick-go', 'aria-label': 'Add task' }, icon('plus'), h('span', { class: 'quick__go' }, 'Add')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More options for a new task', 'data-fk': 'quick-more', onclick: () => { const p = tasks.parseQuickAdd(draft); openForm(null, draft.trim() ? { title: p.title, due: p.due, time: p.time, priority: p.priority, list: p.list, repeat: p.repeat } : null); } }, icon('pencil'))),
      chips);
  }

  // ------------------------------------------------------------ rows
  function taskRow(t, today, { showDue = true } = {}) {
    const overdue = !t.done && t.due && t.due < today;
    const subDone = t.subtasks.filter((s) => s.d).length;
    const meta = [];
    if (showDue && t.due) meta.push(h('span', { class: 'meta' + (overdue ? ' is-bad' : '') }, icon('calendar'), dueText(t, today)));
    else if (t.time) meta.push(h('span', { class: 'meta' }, icon('clock'), fmtClock(t.time, pref())));
    if (t.repeat) meta.push(h('span', { class: 'meta' }, icon('repeat'), tasks.REPEAT_LABELS[t.repeat].replace('Every ', '')));
    if (t.priority) meta.push(h('span', { class: `meta pri pri--${t.priority}` }, icon('flag'), PRI_NAMES[t.priority]));
    if (t.list) meta.push(h('span', { class: 'meta user-text' }, '#' + t.list));
    if (t.subtasks.length) meta.push(h('span', { class: 'meta' }, icon('check'), `${subDone}/${t.subtasks.length}`));
    if (t.source === 'demo') meta.push(h('span', { class: 'meta' }, 'sample'));
    return h('li', null,
      h('div', { class: 'task' + (t.done ? ' is-done' : '') + (overdue ? ' is-overdue' : '') },
        t.done
          ? h('button', { type: 'button', class: 'task__check is-on', 'aria-label': `Put back on the list: ${t.title}`, 'data-fk': 'chk-' + t.id, onclick: () => reopen(t) }, icon('check'))
          : h('button', { type: 'button', class: 'task__check', 'aria-label': `Mark done: ${t.title}`, 'data-fk': 'chk-' + t.id, onclick: (e) => finish(t, e.currentTarget) }, icon('check')),
        h('button', { type: 'button', class: 'task__main', 'data-fk': 'task-' + t.id, 'aria-label': `Edit task: ${t.title}`, onclick: () => openForm(t) },
          h('span', { class: 'task__title user-text clamp-2' }, t.title),
          meta.length ? h('span', { class: 'task__meta' }, ...meta) : null)));
  }

  const group = (label, items, today, opts = {}) => (items.length
    ? h('section', { class: 'tgroup' + (opts.bad ? ' is-bad' : ''), 'aria-label': label },
        h('h2', { class: 'tgroup__head' }, label, h('span', { class: 'tgroup__n num' }, String(items.length))),
        h('ul', { class: 'plain tlist' }, ...items.map((t) => taskRow(t, today, opts))))
    : null);

  // ------------------------------------------------------------ page
  function render() {
    const today = todayKey();
    const all = store.list('task');
    const lists = [...new Set(all.map((t) => t.list).filter(Boolean))].sort();
    if (listFilter && !lists.includes(listFilter)) listFilter = '';
    const filtered = listFilter ? all.filter((t) => t.list === listFilter) : all;
    const g = tasks.groupTasks(filtered, today);
    const doneToday = all.filter((t) => (t.done && t.doneAt && dates.dayKey(t.doneAt) === today) || (t.repeat && t.lastDone === today)).length;
    const totalToday = g.overdue.length + g.today.length + doneToday;

    const counts = { today: g.overdue.length + g.today.length, upcoming: g.upcoming.length, someday: g.someday.length, done: g.done.length };
    const tabs = h('div', { class: 'seg seg--tabs', role: 'radiogroup', 'aria-label': 'Which tasks' },
      ...VIEWS.map((v) => h('label', null,
        h('input', { type: 'radio', name: 'tview', value: v, checked: v === view, onchange: () => { view = v; store.settings.set('ui_taskView', v).catch(() => {}); keepFocus(root, render); } }),
        h('span', null, VIEW_LABEL[v], counts[v] ? h('b', { class: 'seg__n num' }, String(counts[v])) : null))));

    const filterBar = lists.length ? h('div', { class: 'cluster filters', role: 'group', 'aria-label': 'Filter by list' },
      h('button', { type: 'button', class: 'chip chip--button' + (listFilter === '' ? ' is-on' : ''), 'aria-pressed': String(listFilter === ''), 'data-fk': 'f-all', onclick: () => { listFilter = ''; keepFocus(root, render); } }, 'All'),
      ...lists.map((l) => h('button', { type: 'button', class: 'chip chip--button user-text' + (listFilter === l ? ' is-on' : ''), 'aria-pressed': String(listFilter === l), 'data-fk': 'f-' + l, onclick: () => { listFilter = l; keepFocus(root, render); } }, '#' + l))) : null;

    let body;
    if (view === 'today') {
      body = (g.overdue.length || g.today.length)
        ? [group('Overdue', g.overdue, today, { bad: true }), group('Today', g.today, today, { showDue: false })]
        : [h('div', { class: 'card' }, emptyState({ iconName: 'tasks', compact: true, title: doneToday ? 'All clear' : 'Nothing due today', text: doneToday ? 'Everything for today is done. That is a good feeling.' : 'Add a task above, or enjoy the quiet.' }))];
    } else if (view === 'upcoming') {
      const byDay = new Map();
      for (const t of g.upcoming) { if (!byDay.has(t.due)) byDay.set(t.due, []); byDay.get(t.due).push(t); }
      body = byDay.size
        ? [...byDay.entries()].map(([day, items]) => group(tasks.dueWords(day, today) ? `${tasks.dueWords(day, today)} · ${fmtDate(dateOfKey(day), { month: 'short', day: 'numeric' })}` : fmtDate(dateOfKey(day), { weekday: 'long', month: 'long', day: 'numeric' }), items, today, { showDue: false }))
        : [h('div', { class: 'card' }, emptyState({ iconName: 'calendar', compact: true, title: 'Nothing coming up', text: 'Give a task a date and it shows up here, and on your calendar.' }))];
    } else if (view === 'someday') {
      body = g.someday.length ? [group('No date', g.someday, today)]
        : [h('div', { class: 'card' }, emptyState({ iconName: 'inbox', compact: true, title: 'Nothing parked', text: 'Tasks without a date wait here until you are ready.' }))];
    } else {
      body = g.done.length
        ? [group('Finished', g.done.slice(0, 50), today), h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fk': 'clear-done', onclick: async () => {
          if (await confirmSheet({ title: 'Clear finished tasks?', message: `This removes ${plural(g.done.length, 'finished task')} from the list. Your XP and streak stay.`, confirmLabel: 'Clear', danger: true })) {
            try { const n = await tasks.clearDone(); toast(`Cleared ${plural(n, 'task')}.`); } catch (e) { toast(e.message); }
          } } }, icon('trash'), 'Clear finished'))]
        : [h('div', { class: 'card' }, emptyState({ iconName: 'check', compact: true, title: 'Nothing finished yet', text: 'Tick a task off and it lands here.' }))];
    }

    root.replaceChildren(
      pageHead({ eyebrow: 'Tasks', title: 'Get it done', lede: lede(g, doneToday),
        actions: [h('button', { type: 'button', class: 'btn btn--primary', 'data-fk': 'new-task', onclick: () => openForm(null) }, icon('plus'), 'New task')] }),
      h('div', { class: 'stack-lg' + (first ? ' stagger' : '') },
        totalToday > 0 ? h('section', { class: 'card todaybar', 'aria-label': 'Progress today' },
          ring({ value: doneToday / totalToday, size: 64, stroke: 8, animate: first, center: h('span', { class: 'num todaybar__n' }, `${doneToday}/${totalToday}`) }),
          h('div', null, h('p', { class: 'card__title' }, doneToday === totalToday ? 'Today is done' : 'Today’s progress'), h('p', { class: 'card__sub' }, doneToday === totalToday ? 'Streak secured. Nice one.' : `${plural(totalToday - doneToday, 'task')} to go.`))) : null,
        quickAdd(),
        tabs,
        filterBar,
        ...body.filter(Boolean),
        h('div', { class: 'cluster tfoot' },
          h('button', { type: 'button', class: 'btn btn--tonal', 'data-fk': 'to-cal', onclick: () => openCalendarExport(ctx.data) }, icon('calendar'), 'Add to my Calendar'),
          h('span', { class: 'faint' }, 'Get real alerts on your phone.')),
      ),
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch(['task', 'settings', 'demo', 'import', 'wipe', 'bulk'], () => keepFocus(root, render));

  // N focuses quick add (desktop)
  const onKey = (e) => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const q = root.querySelector('#quick-add');
    if (q) { e.preventDefault(); q.focus(); }
  };
  document.addEventListener('keydown', onKey);
  const tick = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && !root.contains(document.activeElement)) render(); }, 60000);
  return () => { document.removeEventListener('keydown', onKey); clearInterval(tick); };
}
