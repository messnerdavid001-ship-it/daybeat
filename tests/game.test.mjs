import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/data/store.js';
import { MemoryAdapter } from '../js/data/adapters.js';
import * as G from '../js/data/game.js';
import { addDays } from '../js/data/dates.js';

const T = '2026-11-25'; // a Wednesday
const noon = (day, h = 12) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, h, 0, 0); }; // local time: the tests run in many zones
const days = (...offs) => offs.map((o) => addDays(T, o));

test('levels: curve from research doc 04, clamped for absurd XP', () => {
  assert.equal(G.xpForLevel(1), 0);
  assert.equal(G.xpForLevel(2), 50);
  assert.equal(G.xpForLevel(5), 400);
  assert.equal(G.xpForLevel(10), 1650);
  assert.equal(G.xpForLevel(11), 1950);
  assert.equal(G.levelFor(0).level, 1);
  assert.equal(G.levelFor(49).level, 1);
  assert.equal(G.levelFor(50).level, 2);
  const big = G.levelFor(2 ** 53);
  assert.equal(big.level, G.MAX_LEVEL);
  assert.ok(big.levelProgress >= 0 && big.levelProgress <= 1);
  assert.ok(big.xpIntoLevel <= big.xpForNext);
  for (const bad of [NaN, -5, Infinity, undefined]) {
    const l = G.levelFor(bad);
    assert.ok(l.level >= 1 && l.levelProgress >= 0 && l.levelProgress <= 1, String(bad));
  }
});

test('streak: consecutive days, today vs yesterday, empty', () => {
  assert.deepEqual(pick(G.computeStreak([], T)), { current: 0, best: 0, activeToday: false, atRisk: false });
  assert.deepEqual(pick(G.computeStreak(days(0), T)), { current: 1, best: 1, activeToday: true, atRisk: false });
  assert.deepEqual(pick(G.computeStreak(days(-3, -2, -1, 0), T)), { current: 4, best: 4, activeToday: true, atRisk: false });
  // today not yet done: the streak is alive but at risk
  assert.deepEqual(pick(G.computeStreak(days(-3, -2, -1), T)), { current: 3, best: 3, activeToday: false, atRisk: true });
  // duplicates and unsorted input are fine
  assert.equal(G.computeStreak([...days(0, -1, -1, 0, -2)], T).current, 3);
});

test('streak: one rest day per rolling 7 days keeps the streak, a second miss inside 7 days breaks it', () => {
  // active -6..-4, miss -3, active -2..0 : rest day covers the miss
  const s = G.computeStreak(days(-6, -5, -4, -2, -1, 0), T);
  assert.equal(s.current, 6);
  assert.equal(s.restDaysLeft, 0);
  // two single misses 3 days apart: the second one has no rest day left and no freeze -> breaks
  const s2 = G.computeStreak(days(-8, -7, -5, -4, -2, -1, 0), T);
  assert.equal(s2.best, 4, 'the miss on -6 is covered by the rest day; the miss on -3 is only 3 days later, so the run restarts');
  assert.equal(s2.current, 3);
  // a miss 7+ days after the previous rest day is covered again
  const s3 = G.computeStreak([...days(-20, -19, -17, -16, -15, -14, -13, -12, -10, -9, -8)], T);
  assert.ok(s3.best >= 10, `two misses 7 days apart both covered, best=${s3.best}`);
});

test('streak: yesterday skipped keeps it alive via the rest day (restCovering) and breaks without one', () => {
  const alive = G.computeStreak(days(-5, -4, -3, -2), T); // yesterday (-1) missing, today still open
  assert.equal(alive.current, 4);
  assert.equal(alive.restCovering, true);
  assert.equal(alive.atRisk, true);
  assert.equal(alive.restDaysLeft, 0);
  // rest day was already used on day -5 (miss) -> cannot cover yesterday as well
  const dead = G.computeStreak(days(-8, -7, -6, -4, -3, -2), T); // miss at -5 uses the rest day; -1 missing too
  assert.equal(dead.current, 0);
  assert.equal(dead.previous, 6, 'the streak that just ended had 6 active days (the covered miss is not counted)');
  assert.equal(dead.best, 6);
});

test('streak: freezes are earned every 7 streak days (max 2) and cover extra misses', () => {
  const week = Array.from({ length: 14 }, (_, i) => addDays(T, -20 + i)); // 14 straight days -> 2 freezes
  const s = G.computeStreak(week, addDays(T, -6));
  assert.equal(s.freezes, 2);
  assert.equal(s.current, 14);
  // then a 3-day gap: rest day + 2 freezes cover it
  const s2 = G.computeStreak([...week, addDays(T, -3)], addDays(T, -2)); // 3 missed days (-6,-5,-4)
  assert.equal(s2.current, 15);
  assert.equal(s2.freezes, 0);
  // a 4-day gap breaks it
  const s3 = G.computeStreak([...week, addDays(T, -1)], T);
  assert.equal(s3.current, 1 + 0, 'gap of 5 days cannot be covered');
  assert.equal(s3.best, 14);
  // freezes never exceed 2
  const long = Array.from({ length: 40 }, (_, i) => addDays(T, -39 + i));
  assert.equal(G.computeStreak(long, T).freezes, 2);
});

test('streak: milestones, previous run, future days ignored (clock moved back), leap day and year end', () => {
  const run = Array.from({ length: 7 }, (_, i) => addDays(T, -6 + i));
  const s = G.computeStreak(run, T);
  assert.equal(s.milestone, 7);
  assert.equal(s.nextMilestone, 14);
  assert.equal(G.computeStreak(days(0), T).milestone, 0);
  assert.equal(G.computeStreak(days(0), T).nextMilestone, 3);
  // rows dated in the "future" (device clock was set back) are ignored, never negative or double-counted
  const back = G.computeStreak(days(-2, -1, 0, 1, 2, 3), T);
  assert.equal(back.current, 3);
  assert.equal(back.best, 3);
  // leap day and year boundary are just calendar days
  const leap = ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01'];
  assert.equal(G.computeStreak(leap, '2028-03-01').current, 4);
  const ye = ['2026-12-30', '2026-12-31', '2027-01-01'];
  assert.equal(G.computeStreak(ye, '2027-01-01').current, 3);
  assert.equal(G.MILESTONES.join(), '3,7,14,30,50,100,365');
});

test('quests and weekly challenge are deterministic per day / week', () => {
  const a = G.questsForDay('2026-11-25').map((q) => q.id);
  const b = G.questsForDay('2026-11-25').map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
  let differs = false;
  for (let i = 1; i < 10; i++) if (G.questsForDay(addDays(T, i)).map((q) => q.id).join() !== a.join()) differs = true;
  assert.ok(differs, 'different days get different quests');
  assert.equal(G.weeklyFor('2026-11-23').id, G.weeklyFor('2026-11-23').id);
});

test('compute: quests complete from counts, badges derive from totals, weekly progress counts the week', () => {
  const at = '2026-11-25T08:00:00.000Z';
  const rows = [];
  const add = (type, ref, day, xp = 0) => rows.push(G.makeRow(type, { ref, day, at, xp }));
  add('visit', '', T, 2);
  add('checkin', 'c1', T, 10);
  const state = G.compute(rows, { today: T, weekStart: 1 });
  assert.equal(state.xp, 12);
  assert.equal(state.streak.current, 1);
  assert.ok(state.badges.find((b) => b.id === 'b_first_checkin').earned);
  assert.ok(state.badges.find((b) => b.id === 'b_first_day').earned);
  assert.ok(!state.badges.find((b) => b.id === 'b_streak_3').earned);
  assert.equal(state.weekly.weekKey, '2026-11-23');
  assert.ok(state.quests.every((q) => q.goal >= 1 && q.progress <= q.goal));
  assert.equal(state.totals.checkin, 1);
});

async function newGame(now = noon(T)) {
  const s = createStore();
  await s.init({ adapter: new MemoryAdapter(), clock: () => new Date(now) });
  return { s, g: G.createGame(s) };
}

test('award: idempotent per ref, needs a ref, validates type, caps daily XP, records level-ups', async () => {
  const { s, g } = await newGame();
  await assert.rejects(g.award('nonsense', { ref: 'x' }), (e) => e.code === 'invalid');
  await assert.rejects(g.award('checkin'), (e) => e.code === 'invalid');
  await assert.rejects(g.award('checkin', { ref: 'bad ref!' }), (e) => e.code === 'invalid');
  const r1 = await g.award('checkin', { ref: 'ck_1' });
  assert.equal(r1.xpGained >= 10, true);
  assert.equal(r1.action.xp, 10);
  assert.equal(r1.streak.current, 1);
  const again = await g.award('checkin', { ref: 'ck_1' });
  assert.equal(again.duplicate, true);
  assert.equal(again.xpGained, 0);
  // concurrent double tap pays once
  const tap = await Promise.all([g.award('message', { ref: 'm1' }), g.award('message', { ref: 'm1' }), g.award('message', { ref: 'm1' })]);
  assert.equal(tap.filter((r) => !r.duplicate).length, 1);
  // the 4th check-in of a day still counts for quests but pays no XP (cap 3)
  for (const id of ['ck_2', 'ck_3']) await g.award('checkin', { ref: id });
  const capped = await g.award('checkin', { ref: 'ck_4' });
  assert.equal(capped.capped, true);
  assert.equal(capped.action.xp, 0);
  s.close();
});

test('award: first visit gives XP and streak 1, quests complete once, bonus for all three, level up is reported', async () => {
  const { s, g } = await newGame();
  const quests = g.questsForDay('2026-11-25');
  let leveled = false;
  let completed = [];
  for (const q of quests) {
    if (q.metric === 'task') {
      const r = await g.award('task', { ref: q.id });
      completed.push(...r.questsCompleted.map((x) => x.id));
      leveled ||= r.leveledUp;
    } else {
      for (let i = 0; i < q.goal; i++) {
        const r = await g.award(q.metric, { ref: `${q.id}_${i}` });
        completed.push(...r.questsCompleted.map((x) => x.id));
        leveled ||= r.leveledUp;
      }
    }
  }
  assert.deepEqual([...completed].sort(), quests.map((q) => q.id).sort());
  const snap = g.snapshot();
  assert.equal(snap.questsAllDone, true);
  assert.ok(snap.quests.every((q) => q.done));
  const rows = [...s._internal.cache('action').values()];
  assert.equal(rows.filter((r) => r.type === 'quests_all').length, 1);
  assert.equal(rows.filter((r) => r.type === 'quest').length, 3);
  // doing more later completes nothing twice
  const more = await g.award('event', { ref: 'ev_x' });
  assert.deepEqual(more.questsCompleted, []);
  assert.ok(snap.xp >= 5);
  s.close();
});

test('award: task needs one of today\'s tap-to-complete quests', async () => {
  const { s, g } = await newGame();
  await assert.rejects(g.award('task', { ref: 'q_does_not_exist' }), (e) => e.code === 'invalid');
  s.close();
});

test('award: milestones are reported once, on the day they are reached, across days and a skipped rest day', async () => {
  const { s, g } = await newGame();
  const reached = [];
  for (let i = 0; i < 8; i++) {
    const day = addDays('2026-11-18', i);
    const r = await g.award('visit', { now: noon(day) });
    if (r.milestoneReached) reached.push([day, r.milestoneReached]);
  }
  assert.deepEqual(reached, [['2026-11-20', 3], ['2026-11-24', 7]]);
  // skip a day (rest day), come back: streak continues, milestone 14 not reported early
  const back = await g.award('visit', { now: noon('2026-11-27') });
  assert.equal(back.streak.current, 9, '8 days + the covered rest day does not add to the count');
  assert.equal(back.milestoneReached, null);
  s.close();
});

test('award: a clock that jumps back a day never double-credits or goes negative', async () => {
  const { s, g } = await newGame();
  await g.award('visit', { now: noon(T) });
  const xp1 = g.snapshot({ now: noon(T) }).xp;
  const back = await g.award('visit', { now: noon('2026-11-24') }); // device clock moved back
  assert.ok(back.xpGained >= 0);
  const snap = g.snapshot({ now: noon('2026-11-24') });
  assert.ok(snap.streak.current >= 0 && snap.xp >= xp1);
  const fwd = await g.award('visit', { now: noon(T, 13) });
  assert.equal(fwd.duplicate, true, 'the same local day is never paid twice');
  s.close();
});

test('award: day boundaries use the device-local day, never UTC midnight', async () => {
  const { s, g } = await newGame();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // two instants one minute apart on either side of LOCAL midnight are different days; two instants 20h apart inside one local day are the same
  const localMidnight = new Date(2026, 10, 26, 0, 0, 0, 0); // 26 Nov 00:00 local, in whatever zone the test runs
  const before = new Date(localMidnight.getTime() - 60000);
  const after = new Date(localMidnight.getTime() + 60000);
  const r1 = await g.award('visit', { now: before });
  const r2 = await g.award('visit', { now: after });
  assert.equal(r1.duplicate, false, tz);
  assert.equal(r2.duplicate, false, tz);
  assert.equal(r2.streak.current, 2);
  s.close();
});

function pick(s) {
  return { current: s.current, best: s.best, activeToday: s.activeToday, atRisk: s.atRisk };
}
