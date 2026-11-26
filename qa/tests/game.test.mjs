// QA tests (independent of backend's tests/): streak, XP, quests maths (js/data/game.js)
// Run all zones:  for z in UTC America/New_York Europe/London Australia/Lord_Howe Asia/Kolkata Pacific/Kiritimati Pacific/Pago_Pago America/Sao_Paulo; do TZ=$z node --test qa/tests/*.test.mjs; done
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// QA_DATA_DIR lets me run the same assertions against a patched copy if the real module cannot load yet.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.QA_DATA_DIR ? path.resolve(process.env.QA_DATA_DIR) : path.resolve(here, '../../js/data');
const dates = await import(pathToFileURL(path.join(dataDir, 'dates.js')).href);
const game = await import(pathToFileURL(path.join(dataDir, 'game.js')).href);

// ---------- streak maths (pure game.compute) ----------
const row = (type, day, xp = 5, ref = day) => ({ id: type === 'visit' ? `visit:${day}` : `${type}:${ref}`, type, day, xp, at: day + 'T09:00:00.000Z' });
const visits = (...days) => days.map((d) => row('visit', d));
const comp = (rows, today, extra = {}) => game.compute(rows, { today, ...extra });

test('empty ledger: zeros, no NaN anywhere', () => {
  const s = comp([], '2026-11-25');
  assert.equal(s.xp, 0); assert.equal(s.level, 1); assert.equal(s.streak.current, 0); assert.equal(s.streak.best, 0);
  assert.equal(s.streak.atRisk, false);
  const json = JSON.stringify(s, (k, v) => (k === 'rows' || k === 'counts' ? undefined : v));
  assert.ok(!/NaN|Infinity/.test(json));
  assert.equal(s.quests.length, 3);
});
test('5 consecutive days -> streak 5, active today', () => {
  const s = comp(visits('2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'), '2026-11-25');
  assert.equal(s.streak.current, 5); assert.equal(s.streak.best, 5); assert.equal(s.streak.activeToday, true); assert.equal(s.streak.atRisk, false);
});
test('midnight: active yesterday, nothing yet today -> streak alive and at risk; no credit invented', () => {
  const s = comp(visits('2026-11-23', '2026-11-24'), '2026-11-25');
  assert.equal(s.streak.current, 2); assert.equal(s.streak.activeToday, false); assert.equal(s.streak.atRisk, true);
});
test('one missed day is forgiven by the free rest day; the streak continues', () => {
  const s = comp(visits('2026-11-20', '2026-11-21', '2026-11-23', '2026-11-24'), '2026-11-24');
  assert.equal(s.streak.current, 4);
  assert.equal(s.streak.restDaysLeft, 0);
});
test('two single-day gaps inside 7 days: the second one breaks the streak (rest day already used)', () => {
  const s = comp(visits('2026-11-20', '2026-11-22', '2026-11-24'), '2026-11-24');
  assert.equal(s.streak.current, 1);
  assert.equal(s.streak.best, 2);
});
test('rest day available again after 7 days', () => {
  const days = ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-11'];
  const s = comp(visits(...days), '2026-11-11');
  assert.equal(s.streak.current, days.length);
});
test('two missed days in a row break the streak but best is kept', () => {
  const s = comp(visits('2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'), '2026-11-23');
  assert.equal(s.streak.current, 1); assert.equal(s.streak.best, 3);
});
test('rest day covers yesterday: active two days ago, nothing yesterday or today -> still alive (restCovering), then dead the day after', () => {
  const rows = visits('2026-11-22', '2026-11-23');
  const covering = comp(rows, '2026-11-25');
  assert.equal(covering.streak.current, 2); assert.equal(covering.streak.restCovering, true); assert.equal(covering.streak.atRisk, true);
  const dead = comp(rows, '2026-11-26');
  assert.equal(dead.streak.current, 0); assert.equal(dead.streak.best, 2);
});
test('clock moved BACK a day: rows from the "future" are ignored, no negative or NaN, no phantom credit', () => {
  const rows = visits('2026-11-23', '2026-11-24', '2026-11-25');
  const s = comp(rows, '2026-11-24');
  assert.equal(s.streak.current, 2); assert.equal(s.streak.activeToday, true);
  assert.ok(s.streak.current >= 0 && Number.isFinite(s.xp));
});
test('clock moved far FORWARD (3 days) then back: streak drops to 0 while ahead, comes back when the real date returns', () => {
  const rows = visits('2026-11-23', '2026-11-24', '2026-11-25');
  assert.equal(comp(rows, '2026-11-29').streak.current, 0);
  assert.equal(comp(rows, '2026-11-25').streak.current, 3);
});
test('year end and leap day boundaries keep the streak', () => {
  const s = comp(visits('2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'), '2027-01-02');
  assert.equal(s.streak.current, 4);
  const l = comp(visits('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-01');
  assert.equal(l.streak.current, 3);
});
test('time-zone change (flying east, local date jumps +2): rest day absorbs it once, not twice', () => {
  // Day keys recorded in New York, then in Auckland two calendar days later.
  const s = comp(visits('2026-11-24', '2026-11-26'), '2026-11-26');
  assert.equal(s.streak.current, 2);
});
test('time-zone change (flying west, local date goes BACK): same-day key twice does not double count', () => {
  const rows = [...visits('2026-11-26'), row('visit', '2026-11-26'), row('checkin', '2026-11-25', 20, 'c1')];
  const s = comp(rows, '2026-11-26');
  assert.equal(s.streak.current, 2); // 25th and 26th
});
test('levels: boundaries are consistent with xpForLevel (curve-agnostic); huge or invalid xp stay finite', () => {
  assert.equal(game.xpForLevel(1), 0);
  let prev = -1;
  for (let n = 1; n <= 60; n++) {
    const need = game.xpForLevel(n);
    assert.ok(need > prev, `xpForLevel must strictly increase (n=${n})`);
    prev = need;
    assert.equal(game.levelFor(need).level, n, `exactly at the threshold of level ${n}`);
    if (n > 1) assert.equal(game.levelFor(need - 1).level, n - 1, `one XP below level ${n}`);
    const l = game.levelFor(need);
    assert.equal(l.xpIntoLevel, 0); assert.equal(l.xpForNext, game.xpForLevel(n + 1) - need);
  }
  for (const bad of [-5, NaN, Infinity, 2 ** 53, 1e21]) { const l = game.levelFor(bad); assert.ok(Number.isFinite(l.level) && l.level >= 1, String(bad)); assert.ok(l.levelProgress >= 0 && l.levelProgress <= 1, String(bad)); }
});
test('daily quests: 3 distinct, stable for a day, vary over a month', () => {
  const a = game.questsForDay('2026-11-25').map((q) => q.id);
  const b = game.questsForDay('2026-11-25').map((q) => q.id);
  assert.deepEqual(a, b); assert.equal(new Set(a).size, 3);
  const variety = new Set(); let k = '2026-11-01';
  for (let i = 0; i < 30; i++) { variety.add(game.questsForDay(k).map((q) => q.id).sort().join()); k = dates.addDays(k, 1); }
  assert.ok(variety.size >= 5, `only ${variety.size} distinct quest sets in 30 days`);
});
test('weekly challenge is the same for every day of one week for both week starts', () => {
  for (const ws of [0, 1, 6]) {
    const first = comp([], '2026-11-23', { weekStart: ws }).weekly;
    for (let i = 0; i < 7; i++) {
      const day = dates.addDays(dates.weekStart('2026-11-25', ws), i);
      assert.equal(comp([], day, { weekStart: ws }).weekly.weekKey, dates.weekStart('2026-11-25', ws));
    }
    assert.ok(first.id);
  }
});
