import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/data/dates.js';

const iso = (ms) => new Date(ms).toISOString();
const w = (y, m, d, h, mi, s = 0) => ({ y, m, d, h, mi, s });

test('zonedToInstant: DST gap shifts forward, overlap picks the first occurrence (New York)', () => {
  assert.equal(iso(D.zonedToInstant(w(2026, 3, 8, 2, 30), 'America/New_York')), '2026-03-08T07:30:00.000Z'); // 02:30 does not exist -> 03:30 EDT
  assert.equal(iso(D.zonedToInstant(w(2026, 11, 1, 1, 30), 'America/New_York')), '2026-11-01T05:30:00.000Z'); // 01:30 twice -> first (EDT)
  assert.equal(iso(D.zonedToInstant(w(2026, 11, 25, 9, 0), 'America/New_York')), '2026-11-25T14:00:00.000Z');
});

test('zonedToInstant: half-hour DST (Lord Howe), fixed offsets (Kolkata) and far zones', () => {
  assert.equal(iso(D.zonedToInstant(w(2026, 10, 4, 2, 15), 'Australia/Lord_Howe')), '2026-10-03T15:45:00.000Z'); // gap 02:00-02:30
  assert.equal(iso(D.zonedToInstant(w(2026, 11, 25, 9, 0), 'Asia/Kolkata')), '2026-11-25T03:30:00.000Z');
  assert.equal(iso(D.zonedToInstant(w(2026, 11, 25, 0, 0), 'Pacific/Kiritimati')), '2026-11-24T10:00:00.000Z');
  assert.ok(Number.isNaN(D.zonedToInstant(w(2026, 1, 1, 0, 0), 'Not/AZone')));
});

test('device-zone and explicit-zone paths agree every 15 minutes around DST changes', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const [y, m, d] of [[2026, 3, 8], [2026, 3, 29], [2026, 10, 4], [2026, 10, 25], [2026, 11, 1], [2027, 3, 14]]) {
    for (let h = 0; h < 24; h++) {
      for (const mi of [0, 15, 30, 45]) {
        const a = D.zonedToInstant(w(y, m, d, h, mi));
        const b = D.zonedToInstant(w(y, m, d, h, mi), tz);
        assert.equal(a, b, `${y}-${m}-${d} ${h}:${mi} in ${tz}`);
      }
    }
  }
});

test('day keys: arithmetic, week start, differences, validation', () => {
  assert.equal(D.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(D.dayDiff('2026-11-01', '2026-11-25'), 24);
  assert.equal(D.dayDiff('2026-03-07', '2026-03-09'), 2); // DST weekend counts as two days
  assert.equal(D.dayOfWeek('2026-11-25'), 3);
  assert.equal(D.weekStart('2026-11-25', 1), '2026-11-23');
  assert.equal(D.weekStart('2026-11-22', 1), '2026-11-16');
  assert.equal(D.weekStart('2026-11-22', 0), '2026-11-22');
  for (const bad of ['2026-13-45', '2026-02-30', '2027-02-29', '2026-00-10', 'abcd-ef-gh', '2026-1-1']) {
    assert.throws(() => D.addDays(bad, 0), RangeError, bad);
    assert.equal(D.isValidDayKey(bad), false);
  }
  assert.equal(D.isValidDayKey('2028-02-29'), true);
});

test('dayKey in explicit zones (international date line and half-hour zones)', () => {
  const t = '2026-11-25T23:30:00Z';
  assert.equal(D.dayKey(t, 'Pacific/Kiritimati'), '2026-11-26'); // UTC+14
  assert.equal(D.dayKey(t, 'Pacific/Pago_Pago'), '2026-11-25'); // UTC-11
  assert.equal(D.dayKey(t, 'Asia/Kolkata'), '2026-11-26'); // UTC+5:30
  assert.equal(D.dayKey(t, 'America/Sao_Paulo'), '2026-11-25');
  assert.equal(D.dayKey('2026-11-25'), '2026-11-25');
  assert.throws(() => D.dayKey('not a date'), RangeError);
});

test('eventSpan and overlaps: all-day inclusive end, zero-length, timed', () => {
  const day = D.eventSpan({ allDay: true, start: '2026-11-01', end: '2026-11-01' });
  assert.equal(D.dayDiff('2026-11-01', '2026-11-02'), 1);
  assert.ok(day.endMs > day.startMs);
  assert.ok(D.overlaps(day, D.parseDayKey('2026-11-01').getTime(), D.parseDayKey('2026-11-02').getTime()));
  assert.ok(!D.overlaps(day, D.parseDayKey('2026-11-02').getTime(), D.parseDayKey('2026-11-03').getTime()));
  const point = D.eventSpan({ start: '2026-11-25T12:00:00.000Z' });
  assert.equal(point.startMs, point.endMs);
  assert.ok(D.overlaps(point, point.startMs, point.startMs + 1));
  assert.ok(!D.overlaps(point, point.startMs + 1, point.startMs + 5));
  const timed = D.eventSpan({ start: '2026-11-25T12:00:00.000Z', end: '2026-11-25T13:00:00.000Z' });
  assert.ok(D.overlaps(timed, timed.startMs - 10, timed.startMs + 10));
  assert.ok(!D.overlaps(timed, timed.endMs, timed.endMs + 10), 'end is exclusive');
});

test('nextAlarm: weekdays, once, disabled, and real elapsed time across DST (New York)', () => {
  const tz = 'America/New_York';
  const alarm = { time: '07:30', days: [1, 2, 3, 4, 5], enabled: true };
  // Wed 2026-11-25 12:00Z = 07:00 EST -> same day 07:30 EST
  assert.equal(D.nextAlarm(alarm, '2026-11-25T12:00:00Z', tz).toISOString(), '2026-11-25T12:30:00.000Z');
  // Fri 2026-11-27 after 07:30 -> skips the weekend, Monday 2026-11-30
  assert.equal(D.nextAlarm(alarm, '2026-11-27T13:00:00Z', tz).toISOString(), '2026-11-30T12:30:00.000Z');
  // 2026-03-07 (Sat) 23:00 EST alarm for Sunday only 02:30: gap -> 03:30 EDT
  const sun = { time: '02:30', days: [0], enabled: true };
  assert.equal(D.nextAlarm(sun, '2026-03-08T00:00:00Z', tz).toISOString(), '2026-03-08T07:30:00.000Z');
  // a daily 06:00 alarm: spring forward night is 23 hours long
  const daily = { time: '06:00', days: [], enabled: true };
  const a = D.nextAlarm(daily, '2026-03-07T12:00:00Z', tz); // Sat 07:00 EST -> next 06:00 is Sun 06:00 EDT = 10:00Z
  assert.equal(a.toISOString(), '2026-03-08T10:00:00.000Z');
  assert.equal(D.nextAlarm({ ...alarm, enabled: false }, '2026-11-25T12:00:00Z', tz), null);
  assert.equal(D.nextAlarm({ time: '99:99', days: [] }, '2026-11-25T12:00:00Z', tz), null);
});

test('toDate rejects garbage', () => {
  assert.throws(() => D.toDate('nonsense'), RangeError);
  assert.throws(() => D.toDate(new Date('x')), RangeError);
  assert.ok(D.toDate() instanceof Date);
});
