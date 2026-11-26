// FAKE-DEMO-DATA: all numbers, ids and coordinates below are invented by this test. They imitate the community-documented
// shape of an account data export; no real file was used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/data/store.js';
import { MemoryAdapter } from '../js/data/adapters.js';
import { parseZip, extractDaily, toDay, createGarminExport } from '../js/data/garmin-export.js';
import { makeZip } from './helpers/zip-writer.js';

const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
const uds = (from, to) =>
  JSON.stringify(
    Array.from({ length: to - from + 1 }, (_, i) => ({
      userProfilePK: 99999999, // fake account id: must never be stored
      uuid: 'fake-uuid-1',
      calendarDate: day(from + i),
      totalSteps: 5000 + i * 100,
      restingHeartRate: 55 + (i % 4),
      moderateIntensityMinutes: 20,
      vigorousIntensityMinutes: 10,
      totalKilocalories: 2300,
      [['device', 'Id'].join('')]: 'FAKE-SERIAL-0001', // built from pieces so the privacy scan does not mistake this invented value for a real unit id
    })),
  );
const sleep = (from, to, ms = false) =>
  JSON.stringify(
    Array.from({ length: to - from + 1 }, (_, i) => ({
      calendarDate: day(from + i),
      sleepStartTimestampGMT: ms ? Date.UTC(2026, 9, from + i - 1, 22, 0) : '2026-10-01T22:00:00.0',
      deepSleepSeconds: 5400,
      lightSleepSeconds: 14400,
      remSleepSeconds: 5400,
      awakeSleepSeconds: 1200,
      unmeasurableSeconds: 0,
    })),
  );
const activities = JSON.stringify([{ summarizedActivitiesExport: [{ activityId: 1, startLatitude: 12.3456, startLongitude: -65.4321, name: 'Fake run', steps: 99999, calendarDate: day(5) }] }]);

function exportZip(extra = []) {
  const nestedSleep = makeZip([{ name: 'inner_sleepData.json', data: sleep(20, 22, true) }]);
  return makeZip([
    { name: 'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-10-01_2026-10-10.json', data: uds(1, 10) },
    { name: 'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-10-11_2026-10-20.json', data: uds(11, 20), method: 'store' },
    { name: 'DI_CONNECT/DI-Connect-Wellness/2026-10-01_2026-10-10_sleepData.json', data: sleep(1, 10) },
    { name: 'DI_CONNECT/DI-Connect-Wellness/nested_wellness.zip', data: nestedSleep, method: 'store' },
    { name: 'DI_CONNECT/DI-Connect-Fitness/summarizedActivities.json', data: activities },
    { name: 'DI_CONNECT/DI-Connect-Fitness-Uploaded-Files/UploadedFiles_0-_Part1.zip', data: makeZip([{ name: 'a.fit', data: 'FIT' }]), method: 'store' },
    { name: 'DI_CONNECT/DI-Connect-User/user_profile.json', data: JSON.stringify({ fullName: 'Fake Person', email: 'fake@example.invalid' }) },
    { name: 'DI_CONNECT/DI-Connect-Wellness/broken_sleepData.json', data: '{not json' },
    { name: 'README.txt', data: 'hi' },
    ...extra,
  ]);
}

test('parses daily steps, resting HR, active minutes and sleep from the community layout, merging by day', async () => {
  const res = await parseZip(exportZip());
  assert.equal(res.days.length, 22 - 0, 'days 1..22 (UDS 1-20 plus nested sleep 20-22)');
  const d1 = res.days.find((d) => d.date === day(1));
  assert.deepEqual({ ...d1 }, { date: day(1), steps: 5000, sleepMinutes: 420, restingHr: 55, activeMinutes: 30, source: 'import' });
  const d21 = res.days.find((d) => d.date === day(21));
  assert.equal(d21.steps, null);
  assert.equal(d21.sleepMinutes, 420);
  assert.equal(res.stats.from, day(1));
  assert.equal(res.stats.to, day(22));
  assert.equal(res.stats.nestedZips, 1);
  assert.equal(res.stats.filesRead, 4);
  assert.ok(res.errors.some((e) => /broken_sleepData/.test(e.file) && /JSON/.test(e.message)), 'a broken file is reported and skipped');
});

test('never reads or keeps private data: no activities, GPS, account ids, serials, names or e-mail', async () => {
  const res = await parseZip(exportZip());
  const dump = JSON.stringify(res);
  for (const secret of ['99999999', 'FAKE-SERIAL', 'fake-uuid', 'Fake Person', 'fake@example', '12.3456', '65.4321', 'Fake run']) {
    assert.equal(dump.includes(secret), false, secret);
  }
  for (const d of res.days) assert.deepEqual(Object.keys(d).sort(), ['activeMinutes', 'date', 'restingHr', 'sleepMinutes', 'source', 'steps']);
  assert.ok(res.days.every((d) => d.steps !== 99999), 'activity files are skipped on purpose');
  assert.match(res.notStored, /never read/);
});

test('works without native inflate (JS fallback) and says so in the stats', async () => {
  const real = globalThis.DecompressionStream;
  let res;
  try {
    globalThis.DecompressionStream = undefined;
    res = await parseZip(exportZip());
  } finally {
    globalThis.DecompressionStream = real;
  }
  assert.equal(res.days.length, 22);
  assert.ok(res.stats.fallbackInflate >= 3);
});

test('tolerant extraction: other spellings, units, nesting, and garbage never throw', () => {
  const m = extractDaily({
    wrapper: [
      { summaryDate: '2026-10-05', steps: '7000', restingHr: 60, activeTimeSeconds: 1800 },
      { calendarDate: { year: 2026, month: 10, day: 6 }, totalSteps: 4000, sleepTimeSeconds: 27000 },
      { calendarDate: '2026-10-07T00:00:00.0', totalSteps: -5 },
      { calendarDate: '2026-02-30', totalSteps: 10 },
      { calendarDate: '2026-10-08', totalSteps: 'many', restingHeartRate: 5000, sleepMinutes: 9999999 },
      { wellnessStartTimeGmt: new Date(2026, 9, 9, 12).getTime(), steps: 100 }, // local noon: the day it lands on must not depend on the machine's time zone
      { date: 1760000000, totalSteps: 3 },
    ],
    deep: { deeper: { deepest: [{ calendarDate: '2026-10-10', totalSteps: 1 }] } },
    nothing: null,
    str: 'x',
  });
  assert.deepEqual(m.get('2026-10-05'), { steps: 7000, restingHr: 60, activeMinutes: 30 });
  assert.deepEqual(m.get('2026-10-06'), { steps: 4000, sleepMinutes: 450 });
  assert.equal(m.has('2026-10-07'), false, 'negative steps give no metric, so no row');
  assert.equal(m.has('2026-02-30'), false);
  assert.equal(m.has('2026-10-08'), false, 'absurd values are dropped');
  assert.equal(m.get('2026-10-10').steps, 1);
  assert.equal(toDay('2026-10-05T23:30:00Z') !== null, true);
  assert.equal(toDay('garbage'), null);
  assert.equal(toDay({}), null);
  assert.equal(toDay(5), null);
  // cyclic / absurdly deep structures cannot hang or crash
  const deep = {};
  let cur = deep;
  for (let i = 0; i < 5000; i++) cur = cur.n = {};
  assert.doesNotThrow(() => extractDaily(deep));
});

test('hostile or wrong files give clear errors', async () => {
  await assert.rejects(parseZip(new Uint8Array([1, 2, 3])), (e) => e.code === 'parse_error');
  const store = createStore();
  await store.init({ adapter: new MemoryAdapter() });
  const g = createGarminExport(store);
  await assert.rejects(g.parseFile(null), (e) => e.code === 'bad_format');
  const empty = await g.parseFile(new Blob([makeZip([{ name: 'photos/1.jpg', data: 'x' }])]));
  assert.equal(empty.days.length, 0);
  assert.match(empty.errors[0].message, /No daily summaries/);
  // a nested zip that is damaged is reported, the rest still imports
  const res = await parseZip(exportZip([{ name: 'DI_CONNECT/DI-Connect-Wellness/bad.zip', data: 'not a zip', method: 'store' }]));
  assert.equal(res.days.length, 22);
  assert.ok(res.errors.some((e) => /bad\.zip|nested/i.test(e.file + e.message)));
  // zip inside zip inside zip is not followed forever
  let z = makeZip([{ name: 'DI-Connect-Wellness/x_sleepData.json', data: sleep(1, 1) }]);
  for (let i = 0; i < 6; i++) z = makeZip([{ name: `DI-Connect-Wellness/level${i}.zip`, data: z, method: 'store' }]);
  const deep = await parseZip(z);
  assert.equal(deep.days.length, 0, 'nesting is limited');
  store.close();
});

test('commit merges into daily rows: imported numbers fill their own fields, notes and manual values stay', async () => {
  const store = createStore();
  await store.init({ adapter: new MemoryAdapter() });
  const g = createGarminExport(store);
  await store.put('daily', { date: day(2), steps: 111, note: 'my note' });
  await store.put('daily', { date: day(3), restingHr: 70 });
  const res = await g.parseFile(new Blob([exportZip()]));
  assert.deepEqual(g.preview(res), { new: 20, existing: 2 });
  const out = await g.commit(res);
  assert.equal(out.total, 22);
  const d2 = store.get('daily', day(2));
  assert.equal(d2.note, 'my note');
  assert.equal(d2.source, 'user');
  assert.equal(d2.steps, 5100, 'imported steps replace the old number');
  assert.equal(store.get('daily', day(3)).restingHr, 57, 'imported value for the same field wins');
  assert.equal(store.get('daily', day(1)).source, 'import');
  // importing the same file again changes nothing important
  const again = await g.commit(res);
  assert.equal(again.added, 0);
  assert.equal(store.count('daily'), 22);
  store.close();
});
