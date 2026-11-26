// Today: what's next (tasks, events, alarm), the streak, today's quests, a one-tap check-in. Everything comes from ctx.data.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ring } from '../ui/ring.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { checkInNow, MOODS } from '../ui/checkin.js';
import { showAward, originOf } from '../ui/rewards.js';
import { fmtTime, fmtClock, fmtNumber, clockParts, fmtDate, untilText, greeting, plural, dateOfKey, WEEKDAYS_LETTER } from '../ui/format.js';
import { dayLabel, eventTimeText } from '../ui/events.js';
import { dataMissingCard, keepFocus, every } from '../ui/parts.js';
import { accentPicker } from '../ui/pickers.js';
import { questsCard } from '../ui/questcards.js';
import { finishTask } from '../ui/taskactions.js';


export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates, tasks } = ctx.data;
  let first = true;
  let draftName = null;   // survives the periodic re-render while the welcome card is being typed in

  // ---------------------------------------------------------------- state
  function readState() {
    const now = new Date();
    const nowMs = now.getTime();
    const todayKey = dates.todayKey(now);
    const snap = game.snapshot({ now });
    const pref = store.settings.get('timeFormat', 'auto');

    // events: everything overlapping the next two weeks, split into "now/next" and "today"
    const upcoming = store.list('event', { from: now, to: dates.addDays(todayKey, 15) })
      .map((ev) => ({ ev, span: dates.eventSpan(ev) }))
      .filter((x) => x.span.endMs > nowMs)
      .sort((a, b) => a.span.startMs - b.span.startMs);
    const timed = upcoming.find((x) => !x.ev.allDay);
    const next = timed || upcoming[0] || null;
    const todayEvents = store.list('event', { from: todayKey, to: dates.addDays(todayKey, 1) });

    // week strip: which of the last 7 days counted for the streak
    const activeDays = new Set(
      store.list('action', { from: dates.addDays(todayKey, -6), to: dates.addDays(todayKey, 1) })
        .filter((a) => game.TYPES.includes(a.type)).map((a) => a.day),
    );
    const week = Array.from({ length: 7 }, (_, i) => {
      const key = dates.addDays(todayKey, i - 6);
      return { key, letter: WEEKDAYS_LETTER[dateOfKey(key).getDay()], active: activeDays.has(key), today: key === todayKey };
    });

    const nextAlarm = store.list('alarm').filter((a) => a.enabled)
      .map((a) => ({ a, when: dates.nextAlarm(a, now) })).filter((x) => x.when)
      .sort((x, y) => x.when - y.when)[0] || null;
    const allTasks = store.list('task');
    const tg = tasks.groupTasks(allTasks, todayKey);
    const doneToday = allTasks.filter((t) => (t.done && t.doneAt && dates.dayKey(t.doneAt) === todayKey) || (t.repeat && t.lastDone === todayKey)).length;
    const dailyRows = store.list('daily');
    const daily = store.get('daily', todayKey) || [...dailyRows].reverse().find((d) => Number.isFinite(d.steps)) || null;
    const goalRaw = store.settings.get('ui_stepGoal', 8000);
    const stepGoal = Number.isFinite(goalRaw) && goalRaw >= 500 ? Math.round(goalRaw) : 8000;
    const todayCheckin = store.list('checkin').filter((c) => c.day === todayKey).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;

    return { now, nowMs, todayKey, snap, pref, next, todayEvents, week, nextAlarm, todayCheckin, tg, doneToday, daily, stepGoal,
      name: store.settings.get('name', ''), onboarded: store.settings.get('onboardingDone', false) };
  }

  // ---------------------------------------------------------------- actions
  const checkIn = (mood, button) => checkInNow(ctx.data, mood, button);

  async function markTask(quest, button) {
    try {
      const result = await game.award('task', { ref: quest.id });
      showAward(result, button ? originOf(button) : undefined);
    } catch (e) { toast(e.message || 'Could not mark that done.'); }
  }

  function changeMood(existing) {
    const sheet = openSheet({
      title: 'How are you feeling?',
      content: h('div', { class: 'moods', role: 'group', 'aria-label': 'Mood' },
        ...[1, 2, 3, 4, 5].map((m) => h('button', { type: 'button', class: 'mood' + (existing.mood === m ? ' is-on' : ''), 'aria-label': MOODS[m], onclick: async () => {
          try { await store.update('checkin', existing.id, { mood: m }); sheet.close('ok'); } catch (e) { toast(e.message); }
        } }, icon('mood-' + m), h('span', null, MOODS[m])))),
    });
  }

  // ---------------------------------------------------------------- pieces
  function lede(S) {
    const st = S.snap.streak;
    const left = S.tg.overdue.length + S.tg.today.length;
    if (S.tg.overdue.length) return `${plural(S.tg.overdue.length, 'task')} overdue. One quick win gets you rolling.`;
    if (left) return `${left} to do today${S.doneToday ? `, ${S.doneToday} done` : ''}.${st.current > 0 && !st.activeToday ? ' Finishing one keeps your streak.' : ''}`;
    if (S.doneToday) return `${plural(S.doneToday, 'task')} done today. Everything is ticked off.`;
    if (st.activeToday) return `Day ${st.current}, locked in. The rest of the day is yours.`;
    if (st.current > 0 && st.restCovering) return 'Rest day used. Streak safe. Do one small thing to keep it rolling.';
    if (st.current > 0) return `Day ${st.current} is waiting. One tap keeps it going.`;
    if (st.previous > 0) return `Streak paused at ${st.previous}. Fresh start, day 1 looks good on you.`;
    return 'Add a task or check in to start your streak.';
  }

  function welcomeCard(S) {
    const input = h('input', { class: 'input', type: 'text', maxlength: 40, autocomplete: 'nickname', placeholder: 'Your name or nickname', id: 'welcome-name', 'data-fk': 'welcome-name', value: draftName !== null ? draftName : S.name, oninput: (e) => { draftName = e.target.value; } });
    const finish = async (save) => {
      try {
        const name = input.value.trim();
        if (save && name) await store.settings.set('name', name);
        await store.settings.set('onboardingDone', true);
        if (save) toast(name ? `Nice to meet you, ${name}.` : 'All set. Have a look around.');
      } catch (e) { toast(e.message); }
    };
    return h('section', { class: 'card welcome span-2', 'aria-label': 'Make it yours' },
      h('h2', { class: 'card__title' }, 'Make it yours'),
      h('p', { class: 'card__sub' }, 'Pick a colour and a name. You can change both in Settings.'),
      h('div', { class: 'stack' },
        accentPicker(),
        h('div', null, h('label', { class: 'sr-only', for: 'welcome-name' }, 'What should we call you?'), input),
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: () => finish(true) }, 'Let\u2019s go'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => finish(false) }, 'Skip')),
      ),
    );
  }

  function checkinCard(S) {
    const done = S.todayCheckin;
    if (done) {
      return h('section', { class: 'card checkin is-done span-2', 'aria-label': 'Check-in' },
        h('div', { class: 'checkin__badge' }, icon(done.mood ? 'mood-' + done.mood : 'check')),
        h('div', { class: 'checkin__text' },
          h('h2', { class: 'card__title' }, 'Checked in'),
          h('p', { class: 'card__sub' }, `${fmtTime(new Date(done.at), S.pref)}${done.mood ? ' · feeling ' + MOODS[done.mood].toLowerCase() : ''}`)),
        done.mood ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fk': 'mood-change', onclick: () => changeMood(done) }, 'Change mood') : null,
      );
    }
    return h('section', { class: 'card checkin span-2', 'aria-label': 'Check-in' },
      h('h2', { class: 'card__title' }, 'How is today starting?'),
      h('p', { class: 'card__sub' }, 'One tap counts for your streak.'),
      h('div', { class: 'moods', role: 'group', 'aria-label': 'Pick a mood to check in' },
        ...[1, 2, 3, 4, 5].map((m) => h('button', { type: 'button', class: 'mood', 'aria-label': MOODS[m], 'data-fk': 'mood-' + m, onclick: (e) => checkIn(m, e.currentTarget) },
          icon('mood-' + m), h('span', null, MOODS[m])))),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm checkin__skip', 'data-fk': 'mood-none', onclick: (e) => checkIn(0, e.currentTarget) }, 'Just check in'),
    );
  }

  function heroCard(S) {
    if (!S.next) {
      return h('section', { class: 'card hero hero--empty span-2' },
        h('div', { class: 'empty empty--compact' },
          h('div', { class: 'empty__art' }, icon('calendar')),
          h('h2', null, 'Nothing on. Suspicious.'),
          h('p', null, 'No events coming up. Add one, import a calendar file, or enjoy the space.'),
          h('div', { class: 'cluster' },
            h('a', { class: 'btn btn--primary', href: '#/calendar' }, icon('plus'), 'Add an event'),
          ),
        ),
      );
    }
    const { ev, span } = S.next;
    const started = span.startMs <= S.nowMs;
    const startDay = ev.allDay ? ev.start : dates.dayKey(ev.start);
    const countdown = started ? `ends ${untilText(span.endMs - S.nowMs)}` : untilText(span.startMs - S.nowMs);
    const others = S.todayEvents.filter((e) => e.id !== ev.id).length;
    return h('a', { class: 'card card--accent hero span-2', href: '#/calendar/' + startDay, 'aria-label': `${started ? 'Happening now' : 'Up next'}: ${ev.title}` },
      h('div', { class: 'hero__top' },
        h('span', { class: 'chip chip--ink' }, started ? 'Happening now' : 'Up next'),
        h('span', { class: 'hero__count num' }, ev.allDay && !started ? dayLabel(startDay, S.todayKey, dates) : countdown),
      ),
      h('p', { class: 'hero__title user-text clamp-2' }, ev.title),
      h('p', { class: 'hero__when' }, `${dayLabel(startDay, S.todayKey, dates)}, ${eventTimeText(ev, S.pref)}`),
      ev.location ? h('p', { class: 'hero__where user-text clamp-1' }, icon('pin'), ev.location) : null,
      others > 0 ? h('p', { class: 'hero__more' }, `+ ${plural(others, 'more event')} today`) : null,
    );
  }

  function streakTile(S) {
    const st = S.snap.streak;
    return h('a', { class: 'card tile streak', href: '#/quests', 'aria-label': `Streak: ${plural(st.current, 'day')}. Open quests.` },
      h('div', { class: 'streak__top' },
        h('span', { class: 'streak__flame' + (st.current > 0 ? ' is-lit' : '') }, icon('flame')),
        h('span', { class: 'streak__num num' }, String(st.current)),
      ),
      h('p', { class: 'tile__label' }, st.current === 1 ? 'day streak' : 'day streak'),
      h('div', { class: 'week', role: 'img', 'aria-label': `Last 7 days: ${S.week.filter((d) => d.active).length} active` },
        ...S.week.map((d) => h('span', { class: 'week__day' + (d.active ? ' is-on' : '') + (d.today ? ' is-today' : '') }, h('i'), h('b', null, d.letter)))),
      h('p', { class: 'tile__foot' }, st.restDaysLeft ? 'Rest day ready' : 'Rest day used', st.best > st.current ? ` · best ${st.best}` : ''),
    );
  }

  function levelTile(S) {
    const g = S.snap;
    return h('a', { class: 'card tile level', href: '#/quests', 'aria-label': `Level ${g.level}, ${g.xpIntoLevel} of ${g.xpForNext} XP. Open quests.` },
      ring({ value: g.levelProgress, size: 88, stroke: 9, animate: first, center: h('div', { class: 'level__num' }, h('small', null, 'LVL'), h('span', { class: 'num' }, String(g.level))) }),
      h('p', { class: 'tile__label' }, `${g.xpIntoLevel} / ${g.xpForNext} XP`),
      h('p', { class: 'tile__foot' }, `${g.xpForNext - g.xpIntoLevel} XP to level ${g.level + 1}`),
    );
  }

  function alarmTile(S) {
    if (!S.nextAlarm) {
      return h('a', { class: 'card tile', href: '#/alarms' },
        h('p', { class: 'tile__eyebrow' }, icon('alarm'), 'Next alarm'),
        h('p', { class: 'tile__empty' }, 'None yet'),
        h('p', { class: 'tile__foot' }, 'Add the alarms you use'),
      );
    }
    const { a, when } = S.nextAlarm;
    const c = clockParts(a.time, S.pref);
    return h('a', { class: 'card tile', href: '#/alarms', 'aria-label': `Next alarm ${c.main} ${c.suffix}, ${untilText(when - S.nowMs)}. Open alarms.` },
      h('p', { class: 'tile__eyebrow' }, icon('alarm'), 'Next alarm'),
      h('p', { class: 'tile__big num' }, c.main, c.suffix ? h('small', null, c.suffix) : null),
      h('p', { class: 'tile__foot' }, untilText(when - S.nowMs), a.label ? ' · ' : '', a.label ? h('span', { class: 'user-text' }, a.label) : null),
    );
  }

  function tasksCard(S) {
    const items = [...S.tg.overdue, ...S.tg.today];
    const total = items.length + S.doneToday;
    return h('section', { class: 'card span-2 todaytasks', 'aria-label': 'Tasks for today' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'card__title' }, 'Tasks'),
        h('div', { class: 'cluster' },
          total ? h('span', { class: 'chip chip--accent' }, `${S.doneToday} of ${total} done`) : null,
          h('a', { class: 'btn btn--ghost btn--sm', href: '#/tasks', 'data-fk': 'all-tasks' }, 'All tasks'))),
      items.length
        ? h('ul', { class: 'plain tlist' }, ...items.slice(0, 5).map((t) => {
          const overdue = t.due < S.todayKey;
          return h('li', null, h('div', { class: 'task' + (overdue ? ' is-overdue' : '') },
            h('button', { type: 'button', class: 'task__check', 'aria-label': `Mark done: ${t.title}`, 'data-fk': 'tt-' + t.id, onclick: (e) => finishTask(ctx.data, t, e.currentTarget) }, icon('check')),
            h('a', { class: 'task__main', href: '#/tasks', 'aria-label': `Open tasks: ${t.title}` },
              h('span', { class: 'task__title user-text clamp-2' }, t.title),
              h('span', { class: 'task__meta' },
                overdue ? h('span', { class: 'meta is-bad' }, icon('calendar'), tasks.dueWords(t.due, S.todayKey) || fmtDate(dateOfKey(t.due))) : null,
                t.time ? h('span', { class: 'meta' }, icon('clock'), fmtClock(t.time, S.pref)) : null,
                t.priority === 3 ? h('span', { class: 'meta pri pri--3' }, icon('flag'), 'High') : null))));
        }))
        : h('div', { class: 'empty empty--compact' },
          h('div', { class: 'empty__art' }, icon('tasks')),
          h('h2', null, S.doneToday ? 'All clear' : 'Nothing due today'),
          h('p', null, S.doneToday ? 'Everything is ticked off. Enjoy it.' : 'Add a task and it lands here when it is due.'),
          h('div', { class: 'cluster' }, h('a', { class: 'btn btn--primary', href: '#/tasks' }, icon('plus'), 'Add a task'))),
      items.length > 5 ? h('p', { class: 'faint' }, `and ${items.length - 5} more`) : null,
    );
  }

  function garminTile(S) {
    const d = S.daily;
    if (!d || !Number.isFinite(d.steps)) {
      return h('a', { class: 'card tile', href: '#/garmin' },
        h('p', { class: 'tile__eyebrow' }, icon('watch'), 'Garmin'),
        h('p', { class: 'tile__empty' }, 'No numbers yet'),
        h('p', { class: 'tile__foot' }, 'Import your export or add steps'),
      );
    }
    const isToday = d.date === S.todayKey;
    const pct = Math.min(100, Math.round((d.steps / S.stepGoal) * 100));
    return h('a', { class: 'card tile', href: '#/garmin', 'aria-label': `${isToday ? 'Steps today' : 'Latest steps'}: ${fmtNumber(d.steps)}, ${pct} percent of your goal. Open Garmin.` },
      h('p', { class: 'tile__eyebrow' }, icon('steps'), isToday ? 'Steps today' : 'Latest steps'),
      h('p', { class: 'tile__big num' }, fmtNumber(d.steps)),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: { width: pct + '%' } })),
      h('p', { class: 'tile__foot' }, d.steps >= S.stepGoal ? 'Goal hit' : `${pct}% of ${fmtNumber(S.stepGoal)}`, isToday ? '' : ` \u00b7 ${fmtDate(dateOfKey(d.date), { month: 'short', day: 'numeric' })}`),
    );
  }

  function scheduleCard(S) {
    if (S.todayEvents.length < 2) return null;
    return h('section', { class: 'card span-2', 'aria-label': 'Today’s schedule' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, 'Today’s schedule'), h('a', { class: 'btn btn--ghost btn--sm', href: '#/calendar' }, 'Calendar')),
      h('ul', { class: 'plain rows' },
        ...S.todayEvents.slice(0, 6).map((ev) => h('li', { class: 'row' },
          h('span', { class: 'row__time num' }, ev.allDay ? 'All day' : fmtTime(new Date(ev.start), S.pref)),
          h('span', { class: 'row__body' }, h('span', { class: 'row__title user-text clamp-1' }, ev.title), ev.location ? h('span', { class: 'row__sub user-text clamp-1' }, ev.location) : null)))),
    );
  }

  // ---------------------------------------------------------------- render
  function render() {
    const S = readState();
    const when = S.now;
    const nameBit = S.name ? `, ${S.name}` : '';
    root.replaceChildren(
      h('header', { class: 'hello' },
        h('p', { class: 'eyebrow' }, fmtDate(when, { weekday: 'long', month: 'long', day: 'numeric' })),
        h('h1', { class: 'user-text clamp-2' }, `${greeting(when)}${nameBit}`),
        h('p', { class: 'lede' }, lede(S)),
      ),
      h('div', { class: 'bento' + (first ? ' stagger' : '') },
        heroCard(S),
        tasksCard(S),
        streakTile(S),
        levelTile(S),
        alarmTile(S),
        garminTile(S),
        checkinCard(S),
        questsCard(S.snap, { onTask: markTask }),
        S.onboarded ? null : welcomeCard(S),
        scheduleCard(S),
      ),
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch('*', () => keepFocus(root, render));
  const stop = every(30000, () => keepFocus(root, render));
  return stop;
}
