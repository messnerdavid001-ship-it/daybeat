// Streaks, XP, levels, daily quests, weekly challenge and badges.
// Everything is derived from one append-only ledger (kind 'action'), so it can never drift out of sync with the
// data and a backup restores it exactly. compute() and all definitions are pure and take an injected clock.
// Days are device-local day keys 'YYYY-MM-DD' (never UTC midnight); streak maths is calendar arithmetic on those keys,
// so DST changes and time-zone travel cannot add or remove a day.

import { DataError, prepare } from './schema.js';
import { dayKey, toDate, addDays, dayDiff, weekStart as weekStartOf } from './dates.js';

// Types the UI may award. 'task' = a self-reported tiny quest ("stretch for 60 seconds, tap done").
export const TYPES = Object.freeze(['visit', 'checkin', 'message', 'event', 'alarm', 'import', 'recap', 'backup', 'task', 'todo', 'todo_add']);
export const XP = Object.freeze({ visit: 2, checkin: 10, message: 3, event: 5, alarm: 5, import: 50, recap: 5, backup: 10, task: 0, todo: 6, todo_add: 2 });
// How many awards per day and type still pay XP (extra ones are recorded with 0 XP, up to ROWS_MAX rows).
export const DAILY_XP_CAP = Object.freeze({ visit: 1, checkin: 3, message: 5, event: 5, alarm: 3, import: 1, recap: 1, backup: 1, task: 3, todo: 10, todo_add: 5 });
export const ROWS_MAX = 20;
export const BADGE_XP = 20;
export const QUESTS_ALL_BONUS = 15;

export const MILESTONES = Object.freeze([3, 7, 14, 30, 50, 100, 365]);
export const FREEZE_EVERY = 7; // every 7 streak days earn one freeze
export const MAX_FREEZES = 2;
export const REST_WINDOW_DAYS = 7; // one free rest day per rolling 7 days

// Level n starts at xpForLevel(n) total XP: L2 50, L3 133, L4 250, L5 400, L10 1650, then +300 per level.
export function xpForLevel(n) {
  if (n <= 1) return 0;
  return n <= 10 ? Math.round((50 * (n * n - 1)) / 3) : 1650 + 300 * (n - 10);
}
export const MAX_LEVEL = 500;
export function levelFor(xp) {
  const x = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let n = 1;
  while (n < MAX_LEVEL && xpForLevel(n + 1) <= x) n++;
  const floor = xpForLevel(n);
  const span = xpForLevel(n + 1) - floor;
  const into = Math.min(span, x - floor);
  return { level: n, xpIntoLevel: into, xpForNext: span, levelProgress: span ? into / span : 0 };
}

const QUEST_POOL = Object.freeze([
  // metric = a ledger type counted automatically; 'task' = the user taps "done" (award('task', {ref: id}))
  { id: 'q_hello', title: 'Show up', desc: 'Open the app today', icon: 'sparkle', xp: 3, goal: 1, metric: 'visit' },
  { id: 'q_wake', title: 'Rise and shine', desc: 'Check in on a wake-up alarm', icon: 'sunrise', xp: 15, goal: 1, metric: 'checkin' },
  { id: 'q_finish', title: 'Check one off', desc: 'Finish a task', icon: 'check', xp: 10, goal: 1, metric: 'todo' },
  { id: 'q_triple', title: 'Triple play', desc: 'Finish 3 tasks', icon: 'target', xp: 18, goal: 3, metric: 'todo' },
  { id: 'q_addtask', title: 'Future you says thanks', desc: 'Add a task for later', icon: 'plus', xp: 6, goal: 1, metric: 'todo_add' },
  { id: 'q_plan', title: 'Plan ahead', desc: 'Add an event to your calendar', icon: 'calendar', xp: 10, goal: 1, metric: 'event' },
  { id: 'q_tune', title: 'Set the tone', desc: 'Add or change an alarm', icon: 'alarm', xp: 10, goal: 1, metric: 'alarm' },
  { id: 'q_look', title: 'Look back', desc: "Open this week's recap", icon: 'insights', xp: 8, goal: 1, metric: 'recap' },
  { id: 'q_glance', title: 'Peek at today', desc: "Look at today's first event", icon: 'today', xp: 5, goal: 1, metric: 'task' },
  { id: 'q_match', title: 'Alarm check', desc: 'Check your wake alarm still matches your watch', icon: 'clock', xp: 8, goal: 1, metric: 'task' },
  { id: 'q_stretch', title: 'Stretch it out', desc: 'Stretch for 60 seconds, then tap done', icon: 'heartbeat', xp: 8, goal: 1, metric: 'task' },
  { id: 'q_water', title: 'Hydrate', desc: 'Drink a glass of water, then tap done', icon: 'sparkle', xp: 5, goal: 1, metric: 'task' },
  { id: 'q_outside', title: 'Step outside', desc: 'Get 5 minutes of outside air, then tap done', icon: 'sun', xp: 8, goal: 1, metric: 'task' },
  { id: 'q_breathe', title: 'Five slow breaths', desc: 'Breathe slowly five times, then tap done', icon: 'moon', xp: 5, goal: 1, metric: 'task' },
  { id: 'q_steps', title: 'Walk a lap', desc: 'Take a short walk, then tap done', icon: 'steps', xp: 8, goal: 1, metric: 'task' },
]);

const WEEKLY_POOL = Object.freeze([
  { id: 'w_early', title: 'Early-bird week', desc: 'Check in 4 times this week', icon: 'sunrise', xp: 60, goal: 4, metric: 'checkin' },
  { id: 'w_doer', title: 'Doer week', desc: 'Finish 10 tasks this week', icon: 'check', xp: 60, goal: 10, metric: 'todo' },
  { id: 'w_planner', title: 'Week planner', desc: 'Add 5 events this week', icon: 'calendar', xp: 50, goal: 5, metric: 'event' },
  { id: 'w_regular', title: 'Regular', desc: 'Open the app on 5 different days this week', icon: 'flame', xp: 40, goal: 5, metric: 'visit' },
]);

const BADGES = Object.freeze([
  { id: 'b_first_day', title: 'First day', desc: 'You showed up', icon: 'star', test: (c) => c.totalRows >= 1 },
  { id: 'b_first_checkin', title: 'First light', desc: 'Your first wake-up check-in', icon: 'sunrise', test: (c) => c.totals.checkin >= 1 },
  { id: 'b_checkin_10', title: 'Ten mornings', desc: '10 wake-up check-ins', icon: 'sun', test: (c) => c.totals.checkin >= 10 },
  { id: 'b_early_bird', title: 'Early bird', desc: 'Check in before 08:00 seven times', icon: 'sunrise', test: (c) => c.earlyCheckins >= 7 },
  { id: 'b_streak_3', title: 'Hat trick', desc: 'A 3-day streak', icon: 'flame', test: (c) => c.streak.best >= 3 },
  { id: 'b_streak_7', title: 'Full week', desc: 'A 7-day streak', icon: 'flame', test: (c) => c.streak.best >= 7 },
  { id: 'b_streak_14', title: 'Two weeks strong', desc: 'A 14-day streak', icon: 'flame', test: (c) => c.streak.best >= 14 },
  { id: 'b_streak_30', title: 'Month of momentum', desc: 'A 30-day streak', icon: 'crown', test: (c) => c.streak.best >= 30 },
  { id: 'b_streak_100', title: 'Hundred club', desc: 'A 100-day streak', icon: 'crown', test: (c) => c.streak.best >= 100 },
  { id: 'b_comeback', title: 'Comeback kid', desc: 'Return after 3 or more days away', icon: 'rocket', test: (c) => c.comeback },
  { id: 'b_todo_1', title: 'Checked off', desc: 'Finish your first task', icon: 'check', test: (c) => c.totals.todo >= 1 },
  { id: 'b_todo_10', title: 'Getting things done', desc: 'Finish 10 tasks', icon: 'target', test: (c) => c.totals.todo >= 10 },
  { id: 'b_todo_50', title: 'Task machine', desc: 'Finish 50 tasks', icon: 'bolt', test: (c) => c.totals.todo >= 50 },
  { id: 'b_event_5', title: 'Planner', desc: 'Add 5 events', icon: 'calendar', test: (c) => c.totals.event >= 5 },
  { id: 'b_alarm_1', title: 'Alarm architect', desc: 'Add your first alarm', icon: 'alarm', test: (c) => c.totals.alarm >= 1 },
  { id: 'b_ics', title: 'Calendar cleaner', desc: 'Import a calendar file', icon: 'calendar-check', test: (c) => c.imports.ics >= 1 },
  { id: 'b_zip', title: 'Data nerd', desc: 'Import a data export', icon: 'upload', test: (c) => c.imports.zip >= 1 },
  { id: 'b_backup', title: 'Backup hero', desc: 'Make a backup', icon: 'download', test: (c) => c.totals.backup >= 1 },
  { id: 'b_recap', title: 'Rear-view mirror', desc: 'Open a weekly recap', icon: 'insights', test: (c) => c.totals.recap >= 1 },
  { id: 'b_quest_10', title: 'Quest runner', desc: 'Complete 10 daily quests', icon: 'target', test: (c) => c.totals.quest >= 10 },
  { id: 'b_level_5', title: 'Level 5', desc: 'Reach level 5', icon: 'medal', test: (c) => c.level >= 5 },
  { id: 'b_level_10', title: 'Level 10', desc: 'Reach level 10', icon: 'crown', test: (c) => c.level >= 10 },
]);

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 3 daily quests for a day key. Same day -> same quests on every device. */
export function questsForDay(day) {
  const r = rng(hashString(`quests:${day}`));
  const pool = [...QUEST_POOL];
  const picked = [];
  while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return picked;
}

/** The weekly challenge for a week key (the first day of that week). */
export function weeklyFor(weekKey) {
  const r = rng(hashString(`weekly:${weekKey}`));
  return WEEKLY_POOL[Math.floor(r() * WEEKLY_POOL.length)];
}

const pub = ({ test, ...rest }) => ({ ...rest });

// ------------------------------------------------------------------ streak

const restFree = (lastRest, day) => lastRest === null || dayDiff(lastRest, day) >= REST_WINDOW_DAYS;

/**
 * Try to cover every missed day strictly between two active days (or up to yesterday) with the free rest day first,
 * then freezes. Returns the new { lastRest, freezes, usedRest, usedFreezes } or null if the streak would break.
 */
function tryCover(prev, until, st) {
  const missed = dayDiff(prev, until) - 1;
  if (missed <= 0) return { ...st, usedRest: 0, usedFreezes: 0 };
  if (missed > 1 + MAX_FREEZES) return null;
  let { lastRest, freezes } = st;
  let usedRest = 0;
  let usedFreezes = 0;
  for (let i = 1; i <= missed; i++) {
    const day = addDays(prev, i);
    if (restFree(lastRest, day)) {
      lastRest = day;
      usedRest++;
    } else if (freezes > 0) {
      freezes--;
      usedFreezes++;
    } else return null;
  }
  return { lastRest, freezes, usedRest, usedFreezes };
}

/**
 * Pure streak engine. days = sorted unique active day keys (any order is fine, duplicates ignored).
 * Rules: one tiny action makes a day active. ONE missed day per rolling 7 days is covered by a free rest day; up to 2
 * freezes (one earned for every 7 days of streak) cover further misses. A streak only breaks when a gap cannot be covered.
 */
export function computeStreak(activeDays, today) {
  const days = [...new Set(activeDays)].filter((d) => d <= today).sort();
  let run = 0;
  let best = 0;
  let prev = null;
  let st = { lastRest: null, freezes: 0 };
  let comeback = false;
  for (const d of days) {
    if (prev === null) run = 1;
    else {
      const gap = dayDiff(prev, d);
      if (gap >= 4) comeback = true;
      if (gap === 1) run++;
      else {
        const cov = tryCover(prev, d, st);
        if (cov) {
          st = { lastRest: cov.lastRest, freezes: cov.freezes };
          run++;
        } else run = 1;
      }
      if (run > 1 && run % FREEZE_EVERY === 0) st.freezes = Math.min(MAX_FREEZES, st.freezes + 1);
    }
    if (run > best) best = run;
    prev = d;
  }
  let current = 0;
  let restCovering = false;
  let freezesCovering = 0;
  let previous = 0;
  let after = st;
  if (prev !== null) {
    if (prev === today) current = run;
    else {
      const cov = tryCover(prev, today, st);
      if (cov) {
        current = run;
        after = { lastRest: cov.lastRest, freezes: cov.freezes };
        restCovering = cov.usedRest > 0;
        freezesCovering = cov.usedFreezes;
      } else previous = run;
    }
  }
  const activeToday = prev === today;
  const reached = MILESTONES.filter((m) => m <= current);
  return {
    current,
    best,
    activeToday,
    atRisk: !activeToday && current > 0,
    restDaysLeft: restFree(after.lastRest, today) ? 1 : 0,
    restCovering,
    freezes: after.freezes,
    freezesCovering,
    milestone: reached.length ? reached[reached.length - 1] : 0,
    nextMilestone: MILESTONES.find((m) => m > current) ?? null,
    previous,
    comeback,
    lastDay: prev,
  };
}

// ------------------------------------------------------------------ compute

/**
 * Pure: derive the whole game state from ledger rows.
 * actions: [{id,type,day,xp,at,ref}], opts: { today (day key), weekStart (0|1|6, default 1) }
 */
export function compute(actions, { today, weekStart = 1 }) {
  const rows = new Map();
  const byDay = new Map();
  const totals = { checkin: 0, message: 0, event: 0, alarm: 0, import: 0, recap: 0, visit: 0, backup: 0, task: 0, todo: 0, todo_add: 0, quest: 0, badge: 0, weekly: 0 };
  const imports = { ics: 0, zip: 0 };
  let earlyCheckins = 0;
  let xp = 0;
  for (const a of actions) {
    rows.set(a.id, a);
    xp += a.xp;
    if (a.type in totals) totals[a.type]++;
    if (a.type === 'import') {
      const kind = String(a.ref).split(':')[0];
      if (kind in imports) imports[kind]++;
    }
    if (a.type === 'checkin' && new Date(a.at).getHours() < 8) earlyCheckins++;
    let d = byDay.get(a.day);
    if (!d) byDay.set(a.day, (d = {}));
    d[a.type] = (d[a.type] ?? 0) + 1;
  }

  const activeDays = [...byDay.entries()].filter(([day, c]) => TYPES.some((t) => c[t])).map(([day]) => day);
  const streak = computeStreak(activeDays, today);

  const lvl = levelFor(xp);
  const todayCounts = byDay.get(today) ?? {};
  const quests = questsForDay(today).map((q) => {
    const raw = q.metric === 'task' ? (rows.has(`task:${q.id}:${today}`) ? 1 : 0) : (todayCounts[q.metric] ?? 0);
    const done = raw >= q.goal || rows.has(`quest:${today}:${q.id}`);
    return { ...q, progress: done ? q.goal : Math.min(q.goal, raw), done };
  });
  const questsAllDone = quests.every((q) => q.done);

  const weekKey = weekStartOf(today, weekStart);
  const wDef = weeklyFor(weekKey);
  let wProgress = 0;
  for (let i = 0; i < 7; i++) wProgress += byDay.get(addDays(weekKey, i))?.[wDef.metric] ?? 0;
  const wDone = wProgress >= wDef.goal || rows.has(`weekly:${weekKey}`);
  const weekly = { ...wDef, weekKey, progress: wDone ? wDef.goal : Math.min(wDef.goal, wProgress), done: wDone };

  const ctx = { totals, imports, earlyCheckins, streak, comeback: streak.comeback, level: lvl.level, xp, totalRows: actions.length };
  const badges = BADGES.map((b) => {
    const row = rows.get(`badge:${b.id}`);
    return { ...pub(b), earned: !!row || b.test(ctx), earnedAt: row ? row.at : null };
  });

  return {
    today,
    xp,
    level: lvl.level,
    levelProgress: lvl.levelProgress,
    xpIntoLevel: lvl.xpIntoLevel,
    xpForNext: lvl.xpForNext,
    streak,
    quests,
    questsAllDone,
    weekly,
    badges,
    totals: { checkin: totals.checkin, message: totals.message, event: totals.event, alarm: totals.alarm, todo: totals.todo, quest: totals.quest, badge: totals.badge },
    counts: byDay, // internal: ledger counts per day and type
    rows, // internal
  };
}

/** Build one ledger row (not yet validated by the store). */
export function makeRow(type, { ref = '', day, at, xp }) {
  let id;
  if (type === 'visit') id = `visit:${day}`;
  else if (type === 'recap') id = `recap:${ref}`;
  else if (type === 'quest') id = `quest:${day}:${ref}`;
  else if (type === 'quests_all') id = `quests_all:${day}`;
  else if (type === 'weekly') id = `weekly:${ref}`;
  else if (type === 'badge') id = `badge:${ref}`;
  else if (type === 'task') id = `task:${ref}:${day}`;
  else id = `${type}:${ref}`;
  return { id, type, day, at, xp, ref };
}

const strip = ({ counts, rows, ...rest }) => rest;

export function createGame(store) {
  const I = store._internal;

  const currentWeekStart = () => store.settings.get('weekStart', 1);

  function snapshot({ now } = {}) {
    const when = toDate(now ?? I.now());
    return strip(compute([...I.cache('action').values()], { today: dayKey(when), weekStart: currentWeekStart() }));
  }

  async function award(type, opts = {}) {
    if (!TYPES.includes(type)) throw new DataError('invalid', `Unknown award type "${String(type).slice(0, 20)}"`);
    const { ref } = opts;
    const needsRef = !['visit', 'recap', 'backup'].includes(type);
    if (needsRef && (typeof ref !== 'string' || !/^[A-Za-z0-9_.:-]{1,90}$/.test(ref))) {
      throw new DataError('invalid', `award("${type}") needs a ref (the id of the saved record)`);
    }
    return I.enqueue(async () => {
      I.assertWritable();
      const when = toDate(opts.now ?? opts.at ?? I.now());
      const at = when.toISOString();
      const today = dayKey(when);
      const ws = currentWeekStart();
      const existingRows = [...I.cache('action').values()];
      const before = compute(existingRows, { today, weekStart: ws });

      if (type === 'task' && !before.quests.some((q) => q.id === ref && q.metric === 'task')) {
        throw new DataError('invalid', 'That is not one of today’s tap-to-complete tasks.');
      }
      let refKey = ref;
      if (type === 'recap') refKey = weekStartOf(today, ws);
      else if (type === 'backup') refKey = today;
      const mainId = makeRow(type, { ref: refKey ?? '', day: today, at, xp: 0 }).id;
      if (before.rows.has(mainId)) {
        return { action: before.rows.get(mainId), xpGained: 0, level: before.level, leveledUp: false, streak: before.streak, milestoneReached: null, questsCompleted: [], badgesEarned: [], weeklyCompleted: false, capped: false, duplicate: true };
      }

      const doneToday = before.counts.get(today)?.[type] ?? 0;
      const capped = doneToday >= DAILY_XP_CAP[type];
      const newRows = [];
      if (doneToday < ROWS_MAX) newRows.push(makeRow(type, { ref: refKey ?? '', day: today, at, xp: capped ? 0 : XP[type] }));
      const all = () => [...existingRows, ...newRows];

      // Daily quests (+ bonus for finishing all three)
      const questsCompleted = [];
      let state = compute(all(), { today, weekStart: ws });
      for (const q of state.quests) {
        if (q.done && !state.rows.has(`quest:${today}:${q.id}`)) {
          newRows.push(makeRow('quest', { ref: q.id, day: today, at, xp: q.xp }));
          questsCompleted.push(q);
        }
      }
      state = compute(all(), { today, weekStart: ws });
      if (state.questsAllDone && !state.rows.has(`quests_all:${today}`)) {
        newRows.push(makeRow('quests_all', { day: today, at, xp: QUESTS_ALL_BONUS }));
      }
      // Weekly challenge
      let weeklyCompleted = false;
      state = compute(all(), { today, weekStart: ws });
      if (state.weekly.done && !state.rows.has(`weekly:${state.weekly.weekKey}`)) {
        newRows.push(makeRow('weekly', { ref: state.weekly.weekKey, day: today, at, xp: state.weekly.xp }));
        weeklyCompleted = true;
      }
      // Badges (a badge bonus can lift the level and unlock another badge, so repeat a few times)
      const badgesEarned = [];
      for (let i = 0; i < 4; i++) {
        state = compute(all(), { today, weekStart: ws });
        const fresh = state.badges.filter((b) => b.earned && !state.rows.has(`badge:${b.id}`));
        if (!fresh.length) break;
        for (const b of fresh) {
          newRows.push(makeRow('badge', { ref: b.id, day: today, at, xp: BADGE_XP }));
          badgesEarned.push(b);
        }
      }

      const records = newRows.map((r) => prepare('action', r, { nowIso: I.nowIso(), defaultSource: 'user' }));
      if (records.length) await I.commitNow({ puts: records.map((record) => ({ kind: 'action', record })), reason: 'put' });
      const after = compute(all(), { today, weekStart: ws });
      const crossed = MILESTONES.filter((m) => before.streak.current < m && after.streak.current >= m);
      return {
        action: records.find((r) => r.id === mainId) ?? null,
        xpGained: records.reduce((s, r) => s + r.xp, 0),
        level: after.level,
        leveledUp: after.level > before.level,
        streak: after.streak,
        milestoneReached: crossed.length ? crossed[crossed.length - 1] : null,
        questsCompleted,
        badgesEarned,
        weeklyCompleted,
        capped,
        duplicate: false,
      };
    });
  }

  return {
    TYPES,
    snapshot,
    award,
    compute: (actions, opts) => strip(compute(actions, opts)),
    computeStreak,
    questsForDay,
    weeklyFor,
    levelFor,
    xpForLevel,
    catalog: () => ({
      quests: QUEST_POOL,
      weekly: WEEKLY_POOL,
      badges: BADGES.map(pub),
      xp: XP,
      dailyXpCap: DAILY_XP_CAP,
      badgeXp: BADGE_XP,
      milestones: MILESTONES,
      maxFreezes: MAX_FREEZES,
    }),
  };
}
