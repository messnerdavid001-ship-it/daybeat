// Tasks: quick-add parsing, repeat rules, smart views and completing a task (with the XP award).
// Everything that does not touch the store is a pure function and takes an injectable clock, so it can be tested.
// Days are device-local day keys 'YYYY-MM-DD'; a task's `time` is a wall-clock 'HH:MM' on its due day.

import { DataError } from './schema.js';
import { addDays, dayDiff, dayKey, dayOfWeek, isValidDayKey, parseDayKey, toDate } from './dates.js';

export const PRIORITY_LABELS = Object.freeze(['', 'Low', 'Medium', 'High']);
export const REPEAT_LABELS = Object.freeze({ '': 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' });

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3));

const p2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ repeat rules

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The occurrence after `key` for a repeat rule (no clock involved). */
export function stepOnce(key, repeat) {
  if (repeat === 'daily') return addDays(key, 1);
  if (repeat === 'weekly') return addDays(key, 7);
  if (repeat === 'weekdays') {
    let k = addDays(key, 1);
    for (let i = 0; i < 3; i++) {
      const dow = dayOfWeek(k);
      if (dow !== 0 && dow !== 6) return k;
      k = addDays(k, 1);
    }
    return k;
  }
  if (repeat === 'monthly') {
    const y = +key.slice(0, 4);
    const m = +key.slice(5, 7);
    const d = +key.slice(8, 10);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${String(ny).padStart(4, '0')}-${p2(nm)}-${p2(Math.min(d, daysInMonth(ny, nm)))}`;
  }
  return key;
}

/**
 * The next due day after completing a repeating task: the first occurrence that is strictly after both the
 * current due day and today (so finishing an old overdue task does not leave it overdue again).
 * Monthly repeats keep the original day of month (Jan 31 -> Feb 28 -> Mar 31) via `anchor`.
 */
export function nextDue(task, today) {
  if (!task.repeat || !task.due) return null;
  const base = task.due > today ? task.due : today;
  const anchorDay = +task.due.slice(8, 10);
  let k = task.due;
  for (let i = 0; i < 4000; i++) {
    k = stepOnce(k, task.repeat);
    if (task.repeat === 'monthly') {
      const y = +k.slice(0, 4);
      const m = +k.slice(5, 7);
      k = `${k.slice(0, 8)}${p2(Math.min(anchorDay, daysInMonth(y, m)))}`;
    }
    if (k > base) return k;
  }
  return null;
}

/** Every day a task shows up inside [fromKey, toKey) including future repeats (display only, nothing is stored). */
export function occurrences(task, fromKey, toKey, limit = 400) {
  if (!task.due) return [];
  const out = [];
  let k = task.due;
  for (let i = 0; i < 5000 && out.length < limit && k < toKey; i++) {
    if (k >= fromKey) out.push(k);
    if (!task.repeat || task.done) break;
    const n = task.repeat === 'monthly' ? monthlyNext(task.due, k) : stepOnce(k, task.repeat);
    if (n <= k) break;
    k = n;
  }
  return out;
}

function monthlyNext(anchorKey, key) {
  const anchorDay = +anchorKey.slice(8, 10);
  const next = stepOnce(key, 'monthly');
  const y = +next.slice(0, 4);
  const m = +next.slice(5, 7);
  return `${next.slice(0, 8)}${p2(Math.min(anchorDay, daysInMonth(y, m)))}`;
}

// ------------------------------------------------------------------ quick-add parser

function weekdayAfter(todayKey, dow, { allowToday = false } = {}) {
  const diff = (dow - dayOfWeek(todayKey) + 7) % 7;
  return addDays(todayKey, diff === 0 ? (allowToday ? 0 : 7) : diff);
}

function to24(h, m, ap) {
  let hh = h;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  if (hh < 0 || hh > 23 || m < 0 || m > 59) return null;
  return `${p2(hh)}:${p2(m)}`;
}

function cut(text, re, fn) {
  const m = re.exec(text);
  if (!m) return { text, hit: false };
  const res = fn(m);
  if (res === false) return { text, hit: false };
  return { text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim(), hit: true, value: res };
}

/**
 * Turn "call mum tomorrow 5pm !high #home every week" into { title, due, time, priority, list, repeat, understood }.
 * Light on purpose: it only removes words it is sure about, and `understood` tells the UI what to show as chips.
 * A bare number is never read as a time.
 */
export function parseQuickAdd(input, { now } = {}) {
  const today = dayKey(toDate(now ?? new Date()));
  const nowD = toDate(now ?? new Date());
  let text = ` ${String(input ?? '').replace(/\s+/g, ' ').trim()} `;
  const out = { title: '', due: '', time: '', priority: 0, list: '', repeat: '', understood: [] };
  const take = (re, fn) => {
    const r = cut(text, re, fn);
    if (r.hit) text = ` ${r.text} `;
    return r.hit ? r : null;
  };

  // priority: !high !med !low !1 !2 !3 !!! !! !
  let r = take(/(^|\s)!(high|hi|h|med|medium|m|low|lo|l|1|2|3)(?=\s|$)/i, (m) => ({ h: 3, hi: 3, high: 3, 3: 3, m: 2, med: 2, medium: 2, 2: 2, l: 1, lo: 1, low: 1, 1: 1 }[m[2].toLowerCase()]));
  if (r) { out.priority = r.value; }
  else {
    r = take(/(^|\s)(!{1,3})(?=\s|$)/, (m) => m[2].length);
    if (r) out.priority = r.value;
  }

  // list: #home
  r = take(/(^|\s)#([\p{L}\p{N}_-]{1,24})(?=\s|$)/u, (m) => m[2]);
  if (r) out.list = r.value;

  // repeat
  r = take(/\bevery\s+(day|weekday|weekdays|week|month|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i, (m) => m[1].toLowerCase());
  let repeatDow = null;
  if (r) {
    const w = r.value;
    if (w === 'day') out.repeat = 'daily';
    else if (w === 'weekday' || w === 'weekdays') out.repeat = 'weekdays';
    else if (w === 'week') out.repeat = 'weekly';
    else if (w === 'month') out.repeat = 'monthly';
    else {
      out.repeat = 'weekly';
      repeatDow = DAY_ABBR.indexOf(w.slice(0, 3));
    }
  } else {
    r = take(/\b(daily|weekdays|weekly|monthly)\b/i, (m) => m[1].toLowerCase());
    if (r) out.repeat = r.value === 'daily' ? 'daily' : r.value === 'weekdays' ? 'weekdays' : r.value === 'weekly' ? 'weekly' : 'monthly';
  }

  // relative duration: in 2 days / in 3 weeks / in 45 min / in 2 hours
  r = take(/\bin\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/i, (m) => ({ n: +m[1], u: m[2].toLowerCase() }));
  if (r) {
    const { n, u } = r.value;
    if (/^(m|min)/.test(u)) {
      const t = new Date(nowD.getTime() + n * 60000);
      out.due = dayKey(t);
      out.time = `${p2(t.getHours())}:${p2(t.getMinutes())}`;
    } else if (/^h/.test(u)) {
      const t = new Date(nowD.getTime() + n * 3600000);
      out.due = dayKey(t);
      out.time = `${p2(t.getHours())}:${p2(t.getMinutes())}`;
    } else if (/^d/.test(u)) out.due = addDays(today, n);
    else out.due = addDays(today, n * 7);
  }

  // explicit dates
  if (!out.due) {
    r = take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => (isValidDayKey(m[0]) ? m[0] : false));
    if (r) out.due = r.value;
  }
  if (!out.due) {
    r = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const a = +m[1];
      const b = +m[2];
      if (a < 1 || a > 12 || b < 1 || b > 31) return false; // month/day (US style)
      let y = m[3] ? +m[3] : +today.slice(0, 4);
      if (y < 100) y += 2000;
      let k = `${String(y).padStart(4, '0')}-${p2(a)}-${p2(b)}`;
      if (!isValidDayKey(k)) return false;
      if (!m[3] && k < today) k = `${String(y + 1).padStart(4, '0')}-${p2(a)}-${p2(b)}`;
      return isValidDayKey(k) ? k : false;
    });
    if (r) out.due = r.value;
  }
  if (!out.due) {
    const monthRe = `(${MONTHS.join('|')}|${MONTH_ABBR.join('|')}|sept)`;
    const make = (mon, day) => {
      const mi = Math.max(MONTH_ABBR.indexOf(mon.slice(0, 3)), 0) + 1;
      if (day < 1 || day > 31) return false;
      let y = +today.slice(0, 4);
      let k = `${y}-${p2(mi)}-${p2(day)}`;
      if (!isValidDayKey(k)) return false;
      if (k < today) { y += 1; k = `${y}-${p2(mi)}-${p2(day)}`; }
      return isValidDayKey(k) ? k : false;
    };
    r = take(new RegExp(`\\b${monthRe}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) => make(m[1].toLowerCase(), +m[2]));
    if (!r) r = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthRe}\\b`, 'i'), (m) => make(m[2].toLowerCase(), +m[1]));
    if (r) out.due = r.value;
  }

  // words: today, tonight, tomorrow, next week, weekdays
  if (!out.due) {
    const wd = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)';
    const wdFull = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
    r = take(new RegExp(`\\b(today|tonight|tomorrow|tmrw|tmr|next week|next month|(?:next|this)\\s+${wd}|on\\s+${wd}|${wdFull})\\b`, 'i'), (m) => m[1].toLowerCase().replace(/\s+/g, ' '));
    if (r) {
      const w = r.value;
      if (w === 'today') out.due = today;
      else if (w === 'tonight') { out.due = today; if (!out.time) out.time = '20:00'; }
      else if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') out.due = addDays(today, 1);
      else if (w === 'next week') out.due = addDays(today, 7);
      else if (w === 'next month') out.due = stepOnce(today, 'monthly');
      else {
        const dow = DAY_ABBR.indexOf(w.replace(/^(next|this|on)\s+/, '').slice(0, 3));
        out.due = dow >= 0 ? weekdayAfter(today, dow, { allowToday: w.startsWith('this ') }) : '';
      }
    }
  }
  if (out.repeat === 'weekly' && repeatDow !== null && repeatDow >= 0 && !out.due) out.due = weekdayAfter(today, repeatDow, { allowToday: true });

  // time: 5pm, 5:30pm, 17:30, noon, midnight, morning, evening
  if (!out.time) {
    r = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?=\s|$|[.,;!?])/i, (m) => to24(+m[1], m[2] ? +m[2] : 0, m[3].toLowerCase().replace(/\./g, '')) || false);
    if (!r) r = take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => to24(+m[1], +m[2], '') || false);
    if (!r) r = take(/\b(?:at\s+)?(noon|midnight)\b/i, (m) => (m[1].toLowerCase() === 'noon' ? '12:00' : '00:00'));
    if (!r && out.due) r = take(/\b(?:in the\s+)?(morning|afternoon|evening)\b/i, (m) => ({ morning: '09:00', afternoon: '14:00', evening: '18:00' }[m[1].toLowerCase()]));
    if (r) out.time = r.value;
  }
  if (out.time && !out.due) {
    out.due = out.time > `${p2(nowD.getHours())}:${p2(nowD.getMinutes())}` ? today : addDays(today, 1);
  }

  out.title = text.replace(/\s{2,}/g, ' ').trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
  if (!out.title) out.title = String(input ?? '').trim();

  if (out.due) out.understood.push({ kind: 'due', due: out.due });
  if (out.time) out.understood.push({ kind: 'time', time: out.time });
  if (out.priority) out.understood.push({ kind: 'priority', priority: out.priority });
  if (out.list) out.understood.push({ kind: 'list', list: out.list });
  if (out.repeat) out.understood.push({ kind: 'repeat', repeat: out.repeat });
  return out;
}

// ------------------------------------------------------------------ views

const byDue = (a, b) => {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  const ta = a.time || '99:99';
  const tb = b.time || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.createdAt < b.createdAt ? -1 : 1;
};
const byPriorityThenCreated = (a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? -1 : 1);

/** Split a list of task records into the smart views, relative to today. Pure. */
export function groupTasks(tasks, today) {
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today).sort(byDue);
  const dueToday = open.filter((t) => t.due === today).sort(byDue);
  const upcoming = open.filter((t) => t.due && t.due > today).sort(byDue);
  const someday = open.filter((t) => !t.due).sort(byPriorityThenCreated);
  const done = tasks.filter((t) => t.done).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
  return { overdue, today: dueToday, upcoming, someday, done, openCount: open.length };
}

/** A friendly label for a due day, relative to today. */
export function dueWords(due, today) {
  if (!due) return 'Someday';
  const d = dayDiff(today, due);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < -1) return `${-d} days ago`;
  if (d < 7) return DAY_NAMES[dayOfWeek(due)].replace(/^./, (c) => c.toUpperCase());
  return null; // caller formats the date
}

// ------------------------------------------------------------------ store-backed operations

export function createTasks(store, game) {
  const I = store._internal;

  const today = (now) => dayKey(toDate(now ?? I.now()));

  function views(now) {
    return groupTasks(store.list('task'), today(now));
  }

  /** Tasks (including future repeats) landing on days in [fromKey, toKey): [{ task, day }] sorted by day then time. */
  function between(fromKey, toKey) {
    const out = [];
    for (const task of store.list('task')) {
      if (task.done && !task.doneAt) continue;
      for (const day of occurrences(task, fromKey, toKey)) out.push({ task, day });
      // finished one-off tasks stay visible on the day they were due
    }
    const key = (x) => `${x.day} ${x.task.time || '99:99'} ${x.task.title.toLowerCase()} ${x.task.id}`;
    return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  async function add(draft, { now } = {}) {
    const rec = await store.put('task', draft);
    let award = null;
    try {
      award = await game.award('todo_add', { ref: rec.id, now });
    } catch {
      /* the task is saved; a missing award must never fail the save */
    }
    return { task: rec, award };
  }

  /** Complete a task. Repeating tasks move to their next day instead of closing. Returns { previous, task, nextDue, award }. */
  async function complete(id, { now } = {}) {
    const t = store.get('task', id);
    if (!t) throw new DataError('not_found', 'That task no longer exists.');
    if (t.done) return { previous: t, task: t, nextDue: null, award: null };
    const nowD = toDate(now ?? I.now());
    const todayKey = dayKey(nowD);
    const occ = t.due || todayKey;
    let saved;
    let next = null;
    if (t.repeat && t.due) {
      next = nextDue(t, todayKey);
      saved = await store.update('task', id, { due: next, lastDone: occ, subtasks: t.subtasks.map((s) => ({ t: s.t, d: false })) });
    } else {
      saved = await store.update('task', id, { done: true, doneAt: nowD.toISOString(), lastDone: occ });
    }
    let award = null;
    try {
      award = await game.award('todo', { ref: `${id}:${occ}`.slice(0, 90), now: nowD });
    } catch {
      /* saved already */
    }
    return { previous: t, task: saved, nextDue: next, award };
  }

  /** Put a finished one-off task back to open. (XP already earned is not taken back.) */
  async function reopen(id) {
    const t = store.get('task', id);
    if (!t) throw new DataError('not_found', 'That task no longer exists.');
    return store.update('task', id, { done: false, doneAt: '' });
  }

  /** Put a task back exactly as it was before complete() (used by Undo). */
  async function restore(previous) {
    return store.put('task', previous);
  }

  async function clearDone() {
    const ids = store.list('task').filter((t) => t.done).map((t) => t.id);
    if (ids.length) await store.removeMany('task', ids);
    return ids.length;
  }

  return { parseQuickAdd, nextDue, occurrences, groupTasks, dueWords, views, between, add, complete, reopen, restore, clearDone, PRIORITY_LABELS, REPEAT_LABELS };
}

export { parseDayKey };
