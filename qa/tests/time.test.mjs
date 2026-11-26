// QA tests (independent of backend's tests/): time zones, DST, day arithmetic (js/data/dates.js)
// Run all zones:  for z in UTC America/New_York Europe/London Australia/Lord_Howe Asia/Kolkata Pacific/Kiritimati Pacific/Pago_Pago America/Sao_Paulo; do TZ=$z node --test qa/tests/*.test.mjs; done
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dates from '../../js/data/dates.js';

const DEVICE_TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const iso = (ms) => new Date(ms).toISOString();

// ---------- DST gap / overlap (explicit zone, independent of the device zone) ----------
// Expected values derived by hand from the published rules (see comments), not from the implementation.
test('NY spring-forward gap: 02:30 on 2027-03-14 does not exist -> fires at 03:30 EDT (07:30Z)', () => {
  const t = dates.zonedToInstant({ y: 2027, m: 3, d: 14, h: 2, mi: 30 }, 'America/New_York');
  assert.equal(iso(t), '2027-03-14T07:30:00.000Z');
});
test('NY fall-back overlap: 01:30 on 2026-11-01 happens twice -> FIRST occurrence (EDT, 05:30Z)', () => {
  const t = dates.zonedToInstant({ y: 2026, m: 11, d: 1, h: 1, mi: 30 }, 'America/New_York');
  assert.equal(iso(t), '2026-11-01T05:30:00.000Z');
});
test('London gap 2027-03-28 01:30 -> 02:30 BST (01:30Z); overlap 2026-10-25 01:30 -> first (BST, 00:30Z)', () => {
  assert.equal(iso(dates.zonedToInstant({ y: 2027, m: 3, d: 28, h: 1, mi: 30 }, 'Europe/London')), '2027-03-28T01:30:00.000Z');
  assert.equal(iso(dates.zonedToInstant({ y: 2026, m: 10, d: 25, h: 1, mi: 30 }, 'Europe/London')), '2026-10-25T00:30:00.000Z');
});
test('Lord Howe 30-minute DST: gap 02:15 on 2026-10-04 -> 02:45 LHDT (15:45Z previous day); overlap 01:45 on 2027-04-04 -> first (LHDT, 14:45Z previous day)', () => {
  assert.equal(iso(dates.zonedToInstant({ y: 2026, m: 10, d: 4, h: 2, mi: 15 }, 'Australia/Lord_Howe')), '2026-10-03T15:45:00.000Z');
  assert.equal(iso(dates.zonedToInstant({ y: 2027, m: 4, d: 4, h: 1, mi: 45 }, 'Australia/Lord_Howe')), '2027-04-03T14:45:00.000Z');
});
test('Fixed-offset zones: Kolkata +5:30 and Kiritimati +14', () => {
  assert.equal(iso(dates.zonedToInstant({ y: 2026, m: 12, d: 1, h: 5, mi: 30 }, 'Asia/Kolkata')), '2026-12-01T00:00:00.000Z');
  assert.equal(iso(dates.zonedToInstant({ y: 2026, m: 12, d: 31, h: 23, mi: 30 }, 'Pacific/Kiritimati')), '2026-12-31T09:30:00.000Z');
});
test('unknown time zone gives NaN, not an exception or a wrong time', () => {
  assert.ok(Number.isNaN(dates.zonedToInstant({ y: 2026, m: 1, d: 1, h: 1 }, 'Mars/Olympus_Mons')));
  assert.equal(dates.isValidTimeZone('Mars/Olympus_Mons'), false);
});

// ---------- nextAlarm: real elapsed time across DST ----------
test('nextAlarm across NY spring-forward: 07:00 alarm is 7h away (not 8h) from 23:00 EST the night before', () => {
  const now = new Date('2027-03-14T04:00:00Z'); // 23:00 EST on 13 Mar
  const next = dates.nextAlarm({ time: '07:00', days: [], enabled: true }, now, 'America/New_York');
  assert.equal(iso(next.getTime()), '2027-03-14T11:00:00.000Z');
  assert.equal((next - now) / 3600000, 7);
});
test('nextAlarm across NY fall-back: 07:00 alarm is 7.5h away from 00:30 EDT', () => {
  const now = new Date('2026-11-01T04:30:00Z');
  const next = dates.nextAlarm({ time: '07:00', days: [], enabled: true }, now, 'America/New_York');
  assert.equal(iso(next.getTime()), '2026-11-01T12:00:00.000Z');
  assert.equal((next - now) / 3600000, 7.5);
});
test('nextAlarm: disabled -> null; bad time -> null; weekday filter finds next Monday', () => {
  const now = new Date('2026-11-25T12:00:00Z'); // Wednesday
  assert.equal(dates.nextAlarm({ time: '07:00', days: [], enabled: false }, now, 'UTC'), null);
  assert.equal(dates.nextAlarm({ time: '7:00', days: [], enabled: true }, now, 'UTC'), null);
  assert.equal(dates.nextAlarm({ time: '24:00', days: [], enabled: true }, now, 'UTC'), null);
  const mon = dates.nextAlarm({ time: '06:30', days: [1], enabled: true }, now, 'UTC');
  assert.equal(iso(mon.getTime()), '2026-11-30T06:30:00.000Z');
});
test('nextAlarm exactly at the alarm minute goes to the next occurrence (no immediate double fire)', () => {
  const now = new Date('2026-11-25T07:00:00.000Z');
  const next = dates.nextAlarm({ time: '07:00', days: [], enabled: true }, now, 'UTC');
  assert.equal(iso(next.getTime()), '2026-11-26T07:00:00.000Z');
});

// ---------- device zone vs explicit zone must agree everywhere (this process runs under TZ=$DEVICE_TZ) ----------
test(`dayKey(date) equals dayKey(date, "${DEVICE_TZ}") for every 15 minutes across 2026-2028 DST edges`, () => {
  let checked = 0;
  for (const [y, m, d] of [[2026, 3, 8], [2026, 3, 29], [2026, 10, 4], [2026, 10, 25], [2026, 11, 1], [2027, 3, 14], [2027, 3, 28], [2027, 4, 4], [2027, 10, 31], [2028, 2, 29], [2026, 12, 31]]) {
    const base = Date.UTC(y, m - 1, d, 0, 0, 0) - 36 * 3600000;
    for (let i = 0; i < 4 * 96; i++) {
      const t = new Date(base + i * 900000);
      assert.equal(dates.dayKey(t), dates.dayKey(t, DEVICE_TZ), `at ${t.toISOString()}`);
      checked++;
    }
  }
  assert.ok(checked > 1000);
});
test('device-zone zonedToInstant agrees with explicit-zone zonedToInstant around every DST edge', () => {
  for (const [y, m, d] of [[2026, 3, 8], [2026, 3, 29], [2026, 10, 4], [2026, 10, 25], [2026, 11, 1], [2027, 3, 14], [2027, 3, 28], [2027, 4, 4], [2027, 10, 31]]) {
    for (let h = 0; h < 24; h++) for (const mi of [0, 15, 30, 45]) {
      const a = dates.zonedToInstant({ y, m, d, h, mi });
      const b = dates.zonedToInstant({ y, m, d, h, mi }, DEVICE_TZ);
      assert.equal(a, b, `${y}-${m}-${d} ${h}:${mi} in ${DEVICE_TZ}: device=${iso(a)} explicit=${iso(b)}`);
    }
  }
});
test('parseDayKey returns local midnight for every day of 2026-2028 (first valid moment of the day)', () => {
  let key = '2026-01-01';
  for (let i = 0; i < 3 * 366; i++) {
    const dt = dates.parseDayKey(key);
    assert.equal(dates.dayKey(dt), key, key);
    assert.ok(dt.getHours() <= 1, `${key} midnight is ${dt.toString()}`); // 00:00, or 01:00 where midnight is skipped
    key = dates.addDays(key, 1);
  }
});

// ---------- day arithmetic ----------
test('addDays / dayDiff / weekStart across month ends, leap day and year end', () => {
  assert.equal(dates.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(dates.addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(dates.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dates.addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(dates.dayDiff('2026-03-07', '2026-03-09'), 2);
  assert.equal(dates.dayDiff('2026-10-30', '2026-11-02'), 3);
  for (const start of ['2026-03-01', '2026-10-01', '2027-03-10', '2028-02-20']) {
    let k = start;
    for (let i = 0; i < 60; i++) { assert.equal(dates.dayDiff(start, k), i); k = dates.addDays(k, 1); }
  }
  // 2026-11-25 is a Wednesday
  assert.equal(dates.weekStart('2026-11-25', 1), '2026-11-23');
  assert.equal(dates.weekStart('2026-11-25', 0), '2026-11-22');
  assert.equal(dates.weekStart('2026-11-25', 6), '2026-11-21');
  assert.equal(dates.weekStart('2026-11-23', 1), '2026-11-23');
  assert.equal(dates.weekStart('2026-11-22', 1), '2026-11-16');
});
test('garbage keys throw a RangeError instead of returning NaN dates', () => {
  assert.throws(() => dates.addDays('nope', 1), RangeError);
  assert.throws(() => dates.dayKey('garbage'), RangeError);
  assert.throws(() => dates.todayKey(NaN), RangeError);
});
test('F-010: day keys with an impossible month/day are rejected by the date helpers', () => {
  for (const bad of ['2026-13-45', '2026-02-30', '2027-02-29', '2026-00-10', '2026-04-31']) {
    assert.throws(() => dates.addDays(bad, 0), RangeError, bad);
  }
});

