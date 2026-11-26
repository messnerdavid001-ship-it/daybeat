// Demo (sample) data. Obviously fake: every title says "Sample", every name is made up, every row has source 'demo'.
// load() is idempotent (it replaces earlier demo rows); clear() removes ONLY demo rows.

import { KINDS, prepare } from './schema.js';
import { dayKey, toDate, addDays, zonedToInstant } from './dates.js';
import { compute, makeRow, questsForDay, BADGE_XP } from './game.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE = 'Sample data. You can clear it in Settings.';

const EVENTS = [
  [0, '09:30', 30, 'Sample: Team sync', 'Sample Office'],
  [0, '18:30', 60, 'Sample: Climbing session', 'Sample Gym'],
  [1, '08:00', 45, 'Sample: Dentist check-up', 'Sample Dental'],
  [1, '19:00', 120, 'Sample: Dinner with Sam', 'Sample Bistro'],
  [2, '12:30', 60, 'Sample: Lunch and learn', ''],
  [3, '07:00', 60, 'Sample: Long run', 'Sample Park'],
  [3, '15:00', 30, 'Sample: Call the landlord (pretend)', ''],
  [5, '10:00', 90, 'Sample: Farmers market', 'Sample Square'],
  [6, '20:00', 150, 'Sample: Movie night', 'Sample Cinema'],
  [8, '09:00', 60, 'Sample: Study group', 'Sample Library'],
  [10, '18:00', 60, 'Sample: Yoga class', 'Sample Studio'],
  [14, '13:00', 45, 'Sample: Haircut', 'Sample Salon'],
  [-1, '17:30', 60, 'Sample: Gym', 'Sample Gym'],
  [-2, '12:00', 45, 'Sample: Coffee with Dana', 'Sample Cafe'],
  [-4, '19:30', 120, 'Sample: Board games', 'Sample Flat'],
  [-6, '10:00', 180, 'Sample: Team offsite', 'Sample Venue'],
];
const ALL_DAY = [
  [9, 9, 'Sample: Pretend public holiday'],
  [11, 13, 'Sample: Weekend away'],
];

const ALARMS = [
  ['06:30', [1, 2, 3, 4, 5], true, 'Sample: Work day', 'Sample alarm. Mirror your real watch alarms here.'],
  ['07:45', [0, 6], true, 'Sample: Weekend lie-in', ''],
  ['05:45', [2, 4], true, 'Sample: Run day', ''],
  ['22:30', [], true, 'Sample: Wind down', ''],
  ['13:00', [], false, 'Sample: Nap', 'Switched off'],
];

const PINGS = [
  ['Sample Sam', -0.1, 'Running 10 min late, start without me (sample message)'],
  ['Demo Dana', -0.4, 'Are we still on for Friday? (made-up message)'],
  ['Pretend Pat', -1.2, 'Your sample package has been delivered to the sample porch.'],
  ['Fake Fran', -1.5, 'Happy birthday! This message is pretend.'],
  ['Sample Sam', -2.1, 'Did you see the trail map I sent? (demo)'],
  ['Demo Dana', -2.6, 'Pick up oat milk on the way, please (sample)'],
  ['Pretend Pat', -3.3, 'Meeting moved to 3pm. Sample text only.'],
  ['Fake Fran', -4.4, 'Lunch tomorrow? I know a made-up place.'],
  ['Sample Sam', -5.2, 'Great run today! (sample)'],
  ['Demo Dana', -6.1, 'Can you water my plant? It is a pretend plant.'],
  ['Pretend Pat', -7.6, 'Reminder: sample dentist appointment is tomorrow.'],
  ['Fake Fran', -9.0, 'Thanks for the lift! (demo message)'],
];

function atLocal(day, hhmm, extraMin = 0) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(zonedToInstant({ y, m, d, h, mi: mi + extraMin, s: 0 })).toISOString();
}

export function createDemo(store) {
  const I = store._internal;

  /** Build every demo row (plain drafts, not yet validated). */
  function build(when, seed, weekStart) {
    const today = dayKey(when);
    const rand = mulberry32(seed);
    const rows = { event: [], alarm: [], message: [], checkin: [], daily: [], action: [], task: [] };

    EVENTS.forEach(([off, hhmm, mins, title, location], i) => {
      const day = addDays(today, off);
      const start = atLocal(day, hhmm);
      rows.event.push({ id: `demo_ev_${i + 1}`, title, start, end: atLocal(day, hhmm, mins), location, notes: NOTE, uid: '' });
    });
    ALL_DAY.forEach(([a, b, title], i) => {
      rows.event.push({ id: `demo_ev_day_${i + 1}`, title, allDay: true, start: addDays(today, a), end: addDays(today, b), notes: NOTE });
    });

    ALARMS.forEach(([time, days, enabled, label, note], i) => {
      rows.alarm.push({ id: `demo_alarm_${i + 1}`, time, days, enabled, label, note });
    });

    PINGS.forEach(([from, off, text], i) => {
      const t = new Date(when.getTime() + off * 86400000).toISOString();
      rows.message.push({ id: `demo_ping_${i + 1}`, from, text, at: t, via: i % 3 === 0 ? 'paste' : 'manual', pinned: i === 1, tags: i === 1 ? ['plans'] : [] });
    });

    // [id suffix, due offset (null = someday), time, title, priority, list, repeat, done, subtasks]
    const TASKS = [
      ['1', -1, '', 'Sample: Send the pretend form', 3, 'admin', '', false, []],
      ['2', 0, '17:30', 'Sample: Reply to Sam', 2, 'people', '', false, []],
      ['3', 0, '18:30', 'Sample: Pick up groceries', 2, 'home', '', false, [['Oat milk', false], ['Bananas', true], ['Rice', false]]],
      ['4', 0, '', 'Sample: Read 10 pages', 1, 'me', 'daily', false, []],
      ['5', 0, '', 'Sample: Take out the bins', 0, 'home', 'weekly', false, []],
      ['6', 1, '09:00', 'Sample: Call the bank (pretend)', 2, 'admin', '', false, []],
      ['7', 3, '', 'Sample: Renew the gym pass', 1, 'health', '', false, []],
      ['8', 9, '', 'Sample: Plan the weekend away', 0, 'fun', '', false, []],
      ['9', null, '', 'Sample: Learn to juggle', 0, 'fun', '', false, []],
      ['10', null, '', 'Sample: Clear out the sample cupboard', 0, 'home', '', false, []],
      ['11', -1, '', 'Sample: Water the pretend plant', 0, 'home', '', true, []],
    ];
    for (const [n, off, time, title, priority, list, repeat, done, subs] of TASKS) {
      rows.task.push({
        id: `demo_task_${n}`, title, notes: off === 0 && n === '3' ? NOTE : '', due: off === null ? '' : addDays(today, off), time, priority, list, repeat, done,
        doneAt: done ? atLocal(addDays(today, -1), '19:00') : '', lastDone: '', subtasks: subs.map(([t, d]) => ({ t, d })),
      });
    }

    for (let off = -6; off <= -1; off++) {
      const day = addDays(today, off);
      const jitter = Math.floor(rand() * 25);
      rows.checkin.push({
        id: `demo_checkin_${day}`,
        day,
        at: atLocal(day, '06:30', jitter),
        alarmId: 'demo_alarm_1',
        mood: 3 + Math.floor(rand() * 3),
        note: off === -1 ? 'Sample check-in' : '',
      });
    }

    for (let off = -59; off <= 0; off++) {
      const day = addDays(today, off);
      const dow = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const partial = off === 0;
      rows.daily.push({
        id: day,
        date: day,
        steps: Math.round((weekend ? 6500 : 8500) * (partial ? 0.35 : 1) + rand() * 5500),
        sleepMinutes: partial ? null : Math.round(380 + rand() * 120 + (weekend ? 30 : 0)),
        restingHr: partial ? null : 52 + Math.floor(rand() * 9),
        activeMinutes: Math.round((partial ? 0.3 : 1) * (15 + rand() * 70)),
        note: '',
      });
    }

    // Ledger: a 6-day streak at level 3, so Quests and Today look alive on first run.
    const actions = [];
    const push = (type, ref, day, at, xp) => actions.push(makeRow(type, { ref, day, at, xp }));
    for (let off = -6; off <= -1; off++) {
      const day = addDays(today, off);
      const visitAt = atLocal(day, '06:40');
      push('visit', '', day, visitAt, 2);
      push('checkin', `demo_checkin_${day}`, day, atLocal(day, '06:30', 5), 10);
      if (off % 2 === 0) push('message', `demo_ping_${-off}`, day, atLocal(day, '12:15'), 3);
      for (const q of questsForDay(day)) {
        if (q.metric === 'visit' || q.metric === 'checkin') push('quest', q.id, day, atLocal(day, '06:45'), q.xp);
      }
    }
    for (let i = 0; i < 4; i++) {
      const state = compute(actions, { today, weekStart });
      const fresh = state.badges.filter((b) => b.earned && !state.rows.has(`badge:${b.id}`));
      if (!fresh.length) break;
      for (const b of fresh) push('badge', b.id, addDays(today, -1), atLocal(addDays(today, -1), '07:00'), BADGE_XP);
    }
    rows.action = actions;
    return rows;
  }

  async function load({ now, seed = 7 } = {}) {
    const when = toDate(now ?? I.now());
    return I.enqueue(async () => {
      I.assertWritable();
      const nowIso = I.nowIso();
      const draft = build(when, seed, store.settings.get('weekStart', 1));
      const puts = [];
      const keep = new Set();
      const added = {};
      for (const kind of KINDS) {
        added[kind] = 0;
        for (const d of draft[kind]) {
          const existing = I.cache(kind).get(d.id ?? d.date);
          if (existing && existing.source !== 'demo') continue; // never overwrite the user's own row
          const rec = prepare(kind, { ...d, source: 'demo' }, { nowIso, defaultSource: 'demo' });
          puts.push({ kind, record: rec });
          keep.add(`${kind}/${rec.id}`);
          added[kind]++;
        }
      }
      const removes = [];
      for (const kind of KINDS) for (const r of I.cache(kind).values()) if (r.source === 'demo' && !keep.has(`${kind}/${r.id}`)) removes.push({ kind, id: r.id });
      await I.commitNow({ puts, removes, settingSet: { demoMode: true }, reason: 'demo' });
      return { added, removed: removes.length };
    });
  }

  async function clear() {
    return I.enqueue(async () => {
      I.assertWritable();
      const removes = [];
      for (const kind of KINDS) for (const r of I.cache(kind).values()) if (r.source === 'demo') removes.push({ kind, id: r.id });
      await I.commitNow({ removes, settingSet: { demoMode: false }, reason: 'demo' });
      return { removed: removes.length };
    });
  }

  return { load, clear, isActive: () => store.settings.get('demoMode', false) === true };
}
