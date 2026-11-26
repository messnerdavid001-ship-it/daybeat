// Garmin: your watch numbers, honestly. Daybeat cannot connect to a Garmin watch or account. Numbers arrive three ways:
// the "Export Your Data" zip from your Garmin account (read on this device only), typing them in, or nothing at all.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ring } from '../ui/ring.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { showAward } from '../ui/rewards.js';
import { segmented } from '../ui/pickers.js';
import { trendCard } from '../ui/charts.js';
import { fmtDate, fmtNumber, minutesToHM, plural, dateOfKey, WEEKDAYS_LETTER } from '../ui/format.js';
import { pageHead, emptyState, dataMissingCard, keepFocus } from '../ui/parts.js';

const RANGES = [7, 30, 90];
const DEFAULT_GOAL = 8000;

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates, garminExport } = ctx.data;
  let first = true;
  let range = RANGES.includes(store.settings.get('ui_garminRange', 30)) ? store.settings.get('ui_garminRange', 30) : 30;

  const goal = () => {
    const g = store.settings.get('ui_stepGoal', DEFAULT_GOAL);
    return Number.isFinite(g) && g >= 500 && g <= 100000 ? Math.round(g) : DEFAULT_GOAL;
  };

  // ------------------------------------------------------------ data helpers
  function rowsFor(days, todayKey) {
    return Array.from({ length: days }, (_, i) => {
      const key = dates.addDays(todayKey, i - (days - 1));
      const d = store.get('daily', key) || {};
      return { date: key, letter: days <= 14 ? WEEKDAYS_LETTER[dateOfKey(key).getDay()] : String(dateOfKey(key).getDate()), steps: d.steps, sleep: Number.isFinite(d.sleepMinutes) ? d.sleepMinutes : null, hr: d.restingHr, active: d.activeMinutes };
    });
  }

  function latest(allDaily) {
    return [...allDaily].reverse().find((d) => [d.steps, d.sleepMinutes, d.restingHr, d.activeMinutes].some((v) => Number.isFinite(v))) || null;
  }

  function goalStreak(todayKey) {
    const g = goal();
    const hit = (k) => { const d = store.get('daily', k); return d && Number.isFinite(d.steps) && d.steps >= g; };
    let k = hit(todayKey) ? todayKey : dates.addDays(todayKey, -1);
    let n = 0;
    while (hit(k) && n < 3650) { n++; k = dates.addDays(k, -1); }
    return n;
  }

  function bests(allDaily) {
    const pick = (field, better) => {
      let best = null;
      for (const d of allDaily) if (Number.isFinite(d[field]) && d[field] > 0 && (!best || better(d[field], best[field]))) best = d;
      return best;
    };
    return [
      { k: 'Most steps', best: pick('steps', (a, b) => a > b), fmt: (d) => fmtNumber(d.steps) },
      { k: 'Longest sleep', best: pick('sleepMinutes', (a, b) => a > b), fmt: (d) => minutesToHM(d.sleepMinutes) },
      { k: 'Lowest resting HR', best: pick('restingHr', (a, b) => a < b), fmt: (d) => `${d.restingHr} bpm` },
      { k: 'Most active minutes', best: pick('activeMinutes', (a, b) => a > b), fmt: (d) => `${d.activeMinutes} min` },
    ];
  }

  // ------------------------------------------------------------ add numbers by hand
  function numbersForm() {
    const today = dates.todayKey();
    const existing = store.get('daily', today);
    const num = (id, label, ph, val, max) => h('div', null, h('label', { class: 'field-label', for: id }, label), h('input', { class: 'input', id, type: 'number', inputmode: 'numeric', min: 0, max, step: 1, placeholder: ph, value: val === null || val === undefined ? '' : val }));
    const steps = num('d-steps', 'Steps', 'e.g. 8000', existing && existing.steps, 200000);
    const sleep = num('d-sleep', 'Sleep (hours)', 'e.g. 7.5', existing && existing.sleepMinutes ? +(existing.sleepMinutes / 60).toFixed(1) : '', 24);
    sleep.querySelector('input').step = 0.1;
    const hr = num('d-hr', 'Resting heart rate', 'e.g. 58', existing && existing.restingHr, 250);
    const act = num('d-act', 'Active minutes', 'e.g. 45', existing && existing.activeMinutes, 1440);
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const val = (box) => { const v = box.querySelector('input').value.trim(); return v === '' ? null : Number(v); };
    const sheet = openSheet({
      title: 'Add today’s numbers',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('p', { class: 'muted' }, 'Type in what your watch or the Garmin Connect app shows. Leave blank what you do not know. Stays on this device.'),
        h('div', { class: 'two-col' }, steps, sleep), h('div', { class: 'two-col' }, hr, act), err, h('button', { type: 'submit', hidden: true }, 'Save')),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'), h('button', { type: 'button', class: 'btn btn--primary', onclick: () => save() }, 'Save')],
      initialFocus: (d) => d.querySelector('input'),
    });
    async function save() {
      const sl = val(sleep);
      const rec = { id: today, date: today, steps: val(steps), sleepMinutes: sl === null ? null : Math.round(sl * 60), restingHr: val(hr), activeMinutes: val(act), note: existing ? existing.note : '' };
      if ([rec.steps, rec.sleepMinutes, rec.restingHr, rec.activeMinutes].every((v) => v === null)) { err.textContent = 'Add at least one number.'; err.hidden = false; return; }
      try {
        await store.put('daily', { ...rec, source: existing && existing.source === 'import' ? 'user' : undefined });
        sheet.close('ok');
        toast(rec.steps !== null && rec.steps >= goal() ? 'Saved. Step goal hit. Nice.' : 'Saved.');
      } catch (e) { err.textContent = e.message || 'Could not save.'; err.hidden = false; }
    }
  }

  function goalForm() {
    const input = h('input', { class: 'input', id: 'goal-in', type: 'number', inputmode: 'numeric', min: 500, max: 100000, step: 100, value: goal() });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const sheet = openSheet({
      title: 'Daily step goal',
      content: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div', null, h('label', { class: 'field-label', for: 'goal-in' }, 'Steps per day'), input), err, h('button', { type: 'submit', hidden: true }, 'Save')),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'), h('button', { type: 'button', class: 'btn btn--primary', onclick: () => save() }, 'Save')],
      initialFocus: () => input,
    });
    async function save() {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < 500 || v > 100000) { err.textContent = 'Pick a goal between 500 and 100,000.'; err.hidden = false; return; }
      try { await store.settings.set('ui_stepGoal', Math.round(v)); sheet.close('ok'); toast('Goal updated.'); } catch (e) { err.textContent = e.message; err.hidden = false; }
    }
  }

  // ------------------------------------------------------------ import the Garmin export
  const picker = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'aria-hidden': 'true', tabindex: '-1', onchange: async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const busy = openSheet({ title: 'Reading your export', dismissible: false, content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Reading the file on this device. Big exports can take a little while. Nothing is uploaded.')) });
    try {
      const res = await garminExport.parseFile(file);
      busy.close('done');
      setTimeout(() => preview(res, file.name), 260);
    } catch (err) {
      busy.close('failed');
      toast(err.message || 'Could not read that file.', { duration: 7000 });
    }
  } });

  function preview(res, name) {
    const p = garminExport.preview(res);
    const n = res.days.length;
    const sheet = openSheet({
      title: n ? `Add ${plural(n, 'day')} of numbers?` : 'Nothing to add',
      content: h('div', { class: 'stack' },
        n ? h('p', { class: 'muted' }, `Found ${plural(n, 'day')} from ${fmtDate(dateOfKey(res.stats.from), { month: 'short', day: 'numeric', year: 'numeric' })} to ${fmtDate(dateOfKey(res.stats.to), { month: 'short', day: 'numeric', year: 'numeric' })}: ${plural(p.new, 'new day')}, ${plural(p.existing, 'day')} already here (updated, your notes stay).`)
          : h('p', { class: 'muted' }, 'No daily numbers were found in that file. Was it the full data export from your Garmin account (not a single activity)?'),
        h('p', { class: 'faint' }, res.notStored),
        res.errorsTotal ? h('p', { class: 'faint' }, `${plural(res.errorsTotal, 'file')} could not be read and were skipped.${res.truncated ? ' The export was very large, so only part of it was read.' : ''}`) : null),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
        n ? h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
          try {
            const r = await garminExport.commit(res);
            await store.settings.set('ui_garminImportAt', new Date().toISOString());
            sheet.close('ok');
            toast(`Added ${plural(r.added, 'day')}, updated ${plural(r.updated, 'day')}.`);
            showAward(await game.award('import', { ref: 'zip:' + Date.now().toString(36) }));
          } catch (e) { toast(e.message || 'Could not add those numbers.'); }
        } }, `Add ${plural(n, 'day')}`) : null,
      ],
    });
  }

  function howTo() {
    const sheet = openSheet({
      title: 'Get your Garmin data',
      content: h('div', { class: 'stack' },
        h('ol', { class: 'steps' },
          h('li', null, 'Sign in to your Garmin account in a browser and find Data Management, then Export Your Data. Ask for the export.'),
          h('li', null, 'Garmin emails a link when it is ready. That can take from two days to a month. Download the .zip file.'),
          h('li', null, 'Come back here and choose the .zip. If you added Daybeat to your home screen, do this inside the home-screen app (it keeps its own data), and save the zip to the Files app first.')),
        h('p', { class: 'faint' }, 'Garmin’s own help pages have the current steps for your region, and they can change. Daybeat is unofficial and has no link to your Garmin account: it only reads the file you pick, on this device.')),
      footer: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => sheet.close('ok') }, 'Got it')],
    });
  }

  // ------------------------------------------------------------ pieces
  function snapshotCard(todayKey, allDaily) {
    const d = store.get('daily', todayKey) || latest(allDaily);
    const g = goal();
    if (!d) {
      return h('section', { class: 'card span-2' },
        emptyState({ iconName: 'watch', compact: true, title: 'No numbers yet', text: 'Import your Garmin export, or type in today’s steps, sleep and heart rate. They turn into charts and streaks here.',
          actions: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => picker.click(), 'data-fk': 'import-empty' }, icon('upload'), 'Import Garmin export'), h('button', { type: 'button', class: 'btn btn--tonal', onclick: numbersForm, 'data-fk': 'add-empty' }, icon('plus'), 'Add numbers')] }));
    }
    const isToday = d.date === todayKey;
    const streak = goalStreak(todayKey);
    const steps = Number.isFinite(d.steps) ? d.steps : null;
    return h('section', { class: 'card card--accent span-2', 'aria-label': 'Latest numbers' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, isToday ? 'Today' : `Latest: ${fmtDate(dateOfKey(d.date))}`), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fk': 'goal', onclick: goalForm }, `Goal ${fmtNumber(g)}`)),
      h('div', { class: 'gm-hero' },
        ring({ value: steps === null ? 0 : steps / g, size: 104, stroke: 11, animate: first, center: h('div', { class: 'level__num' }, h('small', null, 'STEPS'), h('span', { class: 'num' }, steps === null ? '–' : steps >= 10000 ? `${Math.round(steps / 100) / 10}k` : String(steps))) }),
        h('div', { class: 'stack' },
          h('p', { class: 'gm-hero__num num' }, steps === null ? 'No steps' : fmtNumber(steps), steps === null ? null : h('small', null, 'steps')),
          h('p', { class: 'card__sub' }, steps === null ? 'Add steps to see your ring.' : steps >= g ? 'Goal hit. Lovely.' : `${fmtNumber(g - steps)} to your goal.`),
          streak > 0 ? h('span', { class: 'chip chip--ink' }, icon('flame'), `${plural(streak, 'day')} at goal`) : null)),
      h('div', { class: 'cluster' },
        Number.isFinite(d.sleepMinutes) ? h('span', { class: 'chip chip--ink' }, icon('moon'), `Sleep ${minutesToHM(d.sleepMinutes)}`) : null,
        Number.isFinite(d.restingHr) ? h('span', { class: 'chip chip--ink' }, icon('heartbeat'), `Resting ${d.restingHr} bpm`) : null,
        Number.isFinite(d.activeMinutes) ? h('span', { class: 'chip chip--ink' }, icon('bolt'), `${d.activeMinutes} active min`) : null),
    );
  }

  function importCard() {
    const at = store.settings.get('ui_garminImportAt', '');
    const ago = at ? Math.max(0, dates.dayDiff(dates.dayKey(at), dates.todayKey())) : null;
    return h('section', { class: 'card span-2 import', 'aria-label': 'Import Garmin data' },
      h('div', { class: 'import__row' },
        h('span', { class: 'row__icon' }, icon('upload')),
        h('div', { class: 'row__body' },
          h('p', { class: 'row__title' }, ago === null ? 'Bring in your Garmin numbers' : 'Update from a new export'),
          h('p', { class: 'row__sub' }, ago === null
            ? 'Daybeat cannot connect to your watch or account. Request the Export Your Data zip from Garmin and pick it here. It is read on this device only.'
            : `Last import ${ago === 0 ? 'today' : plural(ago, 'day') + ' ago'}. New exports add the days since. Nothing syncs by itself.`))),
      h('div', { class: 'cluster' },
        h('button', { type: 'button', class: 'btn btn--tonal', onclick: () => picker.click(), 'data-fk': 'import' }, icon('upload'), 'Choose Garmin zip'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: howTo, 'data-fk': 'howto' }, icon('info'), 'How to get it'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: numbersForm, 'data-fk': 'add-numbers' }, icon('plus'), 'Add today by hand')),
    );
  }

  function bestsCard(allDaily) {
    const b = bests(allDaily).filter((x) => x.best);
    if (!b.length) return null;
    return h('section', { class: 'card span-2', 'aria-label': 'Personal bests' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, 'Personal bests')),
      h('div', { class: 'pb-grid' }, ...b.map((x) => h('div', { class: 'pb' }, h('p', { class: 'pb__k' }, x.k), h('p', { class: 'pb__v num' }, x.fmt(x.best)), h('p', { class: 'pb__d' }, fmtDate(dateOfKey(x.best.date), { month: 'short', day: 'numeric', year: 'numeric' }))))));
  }

  function watchCard() {
    return h('section', { class: 'card span-2', 'aria-label': 'Your watch calendar and alarms' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, 'Calendar and alarms from your watch')),
      h('p', { class: 'muted' }, 'Your watch gets its calendar from your phone’s calendar app, and alarms live on the watch. Daybeat cannot read either. Import the same calendar file and add your alarms by hand, then plan around them in one place.'),
      h('div', { class: 'cluster' },
        h('a', { class: 'btn btn--tonal', href: '#/calendar' }, icon('calendar'), 'Calendar'),
        h('a', { class: 'btn btn--tonal', href: '#/alarms' }, icon('alarm'), 'Alarms')));
  }

  // ------------------------------------------------------------ page
  function render() {
    const todayKey = dates.todayKey();
    const allDaily = store.list('daily');
    const rows = rowsFor(range, todayKey);
    const daysLabel = `last ${range} days`;
    const trends = [
      trendCard({ title: 'Steps', iconName: 'steps', rows, key: 'steps', fmt: fmtNumber, goal: goal(), daysLabel }),
      trendCard({ title: 'Sleep', iconName: 'moon', rows, key: 'sleep', fmt: minutesToHM, zero: false, daysLabel }),
      trendCard({ title: 'Resting heart rate', iconName: 'heartbeat', rows, key: 'hr', fmt: (n) => String(n), unit: 'bpm', zero: false, daysLabel }),
      trendCard({ title: 'Active minutes', iconName: 'bolt', rows, key: 'active', fmt: (n) => String(n), unit: 'min', daysLabel }),
    ].filter(Boolean);

    root.replaceChildren(
      pageHead({ eyebrow: 'Garmin', title: 'Your numbers', lede: 'Steps, sleep and heart rate from your Garmin export or typed in. Unofficial, and it never connects to your watch.',
        actions: [h('button', { type: 'button', class: 'btn btn--primary', 'data-fk': 'add-today', onclick: numbersForm }, icon('plus'), 'Add today')] }),
      h('div', { class: 'bento' + (first ? ' stagger' : '') },
        snapshotCard(todayKey, allDaily),
        importCard(),
        allDaily.length ? h('div', { class: 'span-2 stack' },
          h('div', { class: 'section-head' }, h('h2', null, 'Trends'),
            segmented({ label: 'Range', value: range, options: RANGES.map((r) => ({ value: r, label: `${r} days` })), onChange: (v) => { range = Number(v); store.settings.set('ui_garminRange', range).catch(() => {}); keepFocus(root, render); } })),
          trends.length ? h('div', { class: 'grid-cards' }, ...trends) : h('div', { class: 'card' }, emptyState({ iconName: 'insights', compact: true, title: `Nothing in the ${daysLabel}`, text: 'Pick a longer range, or import a newer export.' }))) : null,
        bestsCard(allDaily),
        watchCard(),
      ),
      picker,
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch(['daily', 'settings', 'demo', 'import', 'wipe', 'bulk'], () => keepFocus(root, render));
}
